import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Users,
  Plus,
  UserPlus,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  UserCheck,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/empty-state";
import { ColaboradoresList, type ColaboradorRow } from "./colaboradores-list";

export const dynamic = "force-dynamic";

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function competenciaAnterior(ano: number, mes: number): { ano: number; mes: number } {
  if (mes === 1) return { ano: ano - 1, mes: 12 };
  return { ano, mes: mes - 1 };
}

function janelaDoMes(ano: number, mes: number): { inicio: string; fim: string } {
  const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${ano}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
  return { inicio, fim };
}

export default async function ColaboradoresPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();

  const agora = new Date();
  const anoAtual = agora.getFullYear();
  const mesAtual = agora.getMonth() + 1;
  const prev = competenciaAnterior(anoAtual, mesAtual);

  const jAtual = janelaDoMes(anoAtual, mesAtual);
  const jPrev = janelaDoMes(prev.ano, prev.mes);

  // Colaboradores + níveis + cards agregados (agora com o mês anterior)
  // em paralelo — docs/PERFORMANCE.md §B.
  const [
    colaboradoresRes,
    niveisRes,
    ativosCountRes,
    admissoesMesRes,
    admissoesPrevMesRes,
    demissoesMesRes,
    demissoesPrevMesRes,
    folhaAtualRes,
    folhaPrevRes,
  ] = await Promise.all([
    supabase
      .from("colaboradores")
      .select(
        "id, nome, tipo_contratacao, funcao, status, data_admissao, data_encerramento, nivel:niveis(id, codigo)",
      )
      .eq("tenant_id", session.activeTenant.id)
      .order("nome", { ascending: true }),
    supabase
      .from("niveis")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo"),
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .gte("data_admissao", jAtual.inicio)
      .lte("data_admissao", jAtual.fim),
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .gte("data_admissao", jPrev.inicio)
      .lte("data_admissao", jPrev.fim),
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .gte("data_encerramento", jAtual.inicio)
      .lte("data_encerramento", jAtual.fim),
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .gte("data_encerramento", jPrev.inicio)
      .lte("data_encerramento", jPrev.fim),
    supabase
      .from("folhas_pagamento")
      .select("salario_base")
      .eq("tenant_id", session.activeTenant.id)
      .eq("competencia_ano", anoAtual)
      .eq("competencia_mes", mesAtual),
    supabase
      .from("folhas_pagamento")
      .select("salario_base")
      .eq("tenant_id", session.activeTenant.id)
      .eq("competencia_ano", prev.ano)
      .eq("competencia_mes", prev.mes),
  ]);

  if (colaboradoresRes.error) {
    console.error("[rh.colaboradores.page]", colaboradoresRes.error.message);
  }

  const linhas: ColaboradorRow[] = ((colaboradoresRes.data ?? []) as any[]).map(
    (c) => ({
      id: c.id,
      nome: c.nome,
      tipo_contratacao: c.tipo_contratacao,
      funcao: c.funcao,
      status: c.status,
      data_admissao: c.data_admissao,
      data_encerramento: c.data_encerramento,
      nivel_codigo: c.nivel?.codigo ?? null,
    }),
  );

  const niveisAtivosCount = niveisRes.count ?? 0;

  const ativosCount = ativosCountRes.count ?? 0;
  const admissoesMes = admissoesMesRes.count ?? 0;
  const admissoesPrev = admissoesPrevMesRes.count ?? 0;
  const demissoesMes = demissoesMesRes.count ?? 0;
  const demissoesPrev = demissoesPrevMesRes.count ?? 0;

  const folhaAtualLinhas =
    (folhaAtualRes.data ?? []) as { salario_base: string | number }[];
  const folhaPrevLinhas =
    (folhaPrevRes.data ?? []) as { salario_base: string | number }[];
  const folhaAtualGerada = folhaAtualLinhas.length > 0;
  const folhaAtualValor = folhaAtualLinhas.reduce(
    (acc, l) => acc + Number(l.salario_base),
    0,
  );
  const folhaPrevValor = folhaPrevLinhas.reduce(
    (acc, l) => acc + Number(l.salario_base),
    0,
  );

  const brl = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const nomeMesAtual = `${NOMES_MES[mesAtual - 1]}/${anoAtual}`;
  const nomeMesAnterior = `${NOMES_MES[prev.mes - 1].slice(0, 3)}/${prev.ano}`;

  // Ativos no início do mês = ativos_hoje - admissões_no_mês + demissões_no_mês.
  // Não precisa de histórico de mudanças de status — as duas datas dizem tudo.
  const ativosInicioMes = ativosCount - admissoesMes + demissoesMes;
  const deltaAtivos = ativosCount - ativosInicioMes; // = admissoesMes - demissoesMes

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="RH"
        title="Colaboradores"
        description="Cadastro do quadro atual e inativos. Nível de cargo, alocação por empresa e regional, histórico salarial."
        icon={Users}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icone={<UserCheck className="h-4 w-4" />}
          rotulo="Colaboradores ativos"
          valorPrincipal={String(ativosCount)}
          rodape={
            <DeltaAbsoluto
              diff={deltaAtivos}
              legenda="vs início do mês"
              zeroLabel="Sem mudança no mês"
            />
          }
        />
        <KpiCard
          icone={<Wallet className="h-4 w-4" />}
          rotulo={`Folha de ${nomeMesAtual}`}
          valorPrincipal={
            folhaAtualGerada ? brl.format(folhaAtualValor) : "—"
          }
          rodape={
            folhaAtualGerada ? (
              <DeltaPercentual
                atual={folhaAtualValor}
                anterior={folhaPrevValor}
                nomeAnterior={nomeMesAnterior}
              />
            ) : (
              <span className="text-xs text-muted-foreground">
                Folha não gerada
              </span>
            )
          }
          destaque={folhaAtualGerada}
        />
        <KpiCard
          icone={<ArrowUpRight className="h-4 w-4" />}
          rotulo="Admissões no mês"
          valorPrincipal={String(admissoesMes)}
          rodape={
            <DeltaAbsoluto
              diff={admissoesMes - admissoesPrev}
              legenda={`vs ${nomeMesAnterior} (${admissoesPrev})`}
              zeroLabel={`Mesma coisa vs ${nomeMesAnterior}`}
            />
          }
          tom={admissoesMes > 0 ? "verde" : undefined}
        />
        <KpiCard
          icone={<ArrowDownRight className="h-4 w-4" />}
          rotulo="Demissões no mês"
          valorPrincipal={String(demissoesMes)}
          rodape={
            <DeltaAbsoluto
              diff={demissoesMes - demissoesPrev}
              legenda={`vs ${nomeMesAnterior} (${demissoesPrev})`}
              zeroLabel={`Mesma coisa vs ${nomeMesAnterior}`}
              // Delta positivo (mais demissões) é ruim aqui — inverte cor.
              inverterCor
            />
          }
          tom={demissoesMes > 0 ? "vermelho" : undefined}
        />
      </div>

      {linhas.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="Nenhum colaborador cadastrado ainda"
          description="Cadastre o primeiro colaborador para começar a alimentar o quadro da agência."
          action={
            <Link
              href="/rh/colaboradores/novo"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Cadastrar colaborador
            </Link>
          }
        />
      ) : (
        <ColaboradoresList
          colaboradores={linhas}
          niveisAtivosCount={niveisAtivosCount}
        />
      )}
    </div>
  );
}

function KpiCard({
  icone,
  rotulo,
  valorPrincipal,
  rodape,
  destaque,
  tom,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valorPrincipal: string;
  rodape: React.ReactNode;
  destaque?: boolean;
  tom?: "verde" | "vermelho";
}) {
  const corValor =
    tom === "verde" && valorPrincipal !== "0"
      ? "text-emerald-700"
      : tom === "vermelho" && valorPrincipal !== "0"
        ? "text-california-red"
        : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft flex flex-col justify-between min-h-[128px]">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-california-red/10 text-california-red">
          {icone}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide">
          {rotulo}
        </span>
      </div>
      <div className="mt-3">
        <p
          className={`font-bold tabular-nums leading-none ${
            destaque ? "text-3xl" : "text-2xl"
          } ${corValor}`}
        >
          {valorPrincipal}
        </p>
        <div className="mt-2">{rodape}</div>
      </div>
    </div>
  );
}

function DeltaAbsoluto({
  diff,
  legenda,
  zeroLabel,
  inverterCor,
}: {
  diff: number;
  legenda: string;
  zeroLabel: string;
  inverterCor?: boolean;
}) {
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        {zeroLabel}
      </span>
    );
  }
  const positivo = diff > 0;
  const eBom = inverterCor ? !positivo : positivo;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        eBom ? "text-emerald-700" : "text-california-red"
      }`}
    >
      {positivo ? (
        <ArrowUpRight className="h-3 w-3" />
      ) : (
        <ArrowDownRight className="h-3 w-3" />
      )}
      {positivo ? "+" : ""}
      {diff} {legenda}
    </span>
  );
}

function DeltaPercentual({
  atual,
  anterior,
  nomeAnterior,
}: {
  atual: number;
  anterior: number;
  nomeAnterior: string;
}) {
  if (anterior === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        Primeira folha registrada
      </span>
    );
  }
  const diff = atual - anterior;
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        Estável vs {nomeAnterior}
      </span>
    );
  }
  const pct = (diff / anterior) * 100;
  const positivo = diff > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        positivo ? "text-emerald-700" : "text-california-red"
      }`}
    >
      {positivo ? (
        <ArrowUpRight className="h-3 w-3" />
      ) : (
        <ArrowDownRight className="h-3 w-3" />
      )}
      {positivo ? "+" : "−"}
      {Math.abs(pct).toFixed(1).replace(".", ",")}% vs {nomeAnterior}
    </span>
  );
}
