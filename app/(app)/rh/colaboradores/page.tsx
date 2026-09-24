import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Users,
  Plus,
  UserPlus,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeft,
  Minus,
  UserCheck,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  ColaboradoresList,
  type ColaboradorRow,
  type EmpresaOpcao,
  type RegionalOpcao,
} from "./colaboradores-list";

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

  // Colaboradores + salários vigentes + alocações vigentes + agregados em
  // paralelo — docs/PERFORMANCE.md §B. Salário e alocação vigentes vêm
  // separadamente pra não gerar embed pesado e pra permitir filtrar
  // `data_fim is null` cirurgicamente.
  const [
    colaboradoresRes,
    salariosVigentesRes,
    alocacoesVigentesRes,
    niveisRes,
    ativosCountRes,
    admissoesMesRes,
    admissoesPrevMesRes,
    demissoesMesRes,
    demissoesPrevMesRes,
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
      .from("colaboradores_salarios")
      .select("colaborador_id, salario_base")
      .eq("tenant_id", session.activeTenant.id)
      .is("data_fim", null),
    supabase
      .from("colaboradores_alocacoes")
      .select(
        "colaborador_id, usa_rateio_empresa, empresa_id, regional_id, empresa:empresas(id, nome_fantasia), regional:regionais(id, nome)",
      )
      .eq("tenant_id", session.activeTenant.id)
      .is("data_fim", null),
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
      .eq("competencia_ano", prev.ano)
      .eq("competencia_mes", prev.mes),
  ]);

  if (colaboradoresRes.error) {
    console.error("[rh.colaboradores.page]", colaboradoresRes.error.message);
  }

  // Mapa colaborador → salário vigente (BRL number).
  const salarioPorColaborador = new Map<string, number>();
  for (const s of (salariosVigentesRes.data ?? []) as {
    colaborador_id: string;
    salario_base: string | number;
  }[]) {
    salarioPorColaborador.set(s.colaborador_id, Number(s.salario_base));
  }

  // Mapa colaborador → alocação vigente com empresa/regional já resolvidas.
  type AlocacaoVigenteEmb = {
    colaborador_id: string;
    usa_rateio_empresa: boolean;
    empresa_id: string;
    regional_id: string | null;
    empresa: { id: string; nome_fantasia: string } | null;
    regional: { id: string; nome: string } | null;
  };
  const alocacaoPorColaborador = new Map<
    string,
    {
      empresa_id: string;
      empresa_nome: string;
      regional_id: string | null;
      regional_nome: string | null;
      usa_rateio_empresa: boolean;
    }
  >();
  const empresasMap = new Map<string, string>(); // id → nome
  const regionaisPorEmpresa = new Map<string, Map<string, string>>(); // empresa_id → (regional_id → nome)
  for (const a of (alocacoesVigentesRes.data ?? []) as unknown as AlocacaoVigenteEmb[]) {
    if (!a.empresa) continue;
    empresasMap.set(a.empresa.id, a.empresa.nome_fantasia);
    if (a.regional) {
      const bucket =
        regionaisPorEmpresa.get(a.empresa.id) ??
        new Map<string, string>();
      bucket.set(a.regional.id, a.regional.nome);
      regionaisPorEmpresa.set(a.empresa.id, bucket);
    }
    alocacaoPorColaborador.set(a.colaborador_id, {
      empresa_id: a.empresa.id,
      empresa_nome: a.empresa.nome_fantasia,
      regional_id: a.regional?.id ?? null,
      regional_nome: a.regional?.nome ?? null,
      usa_rateio_empresa: a.usa_rateio_empresa,
    });
  }

  const linhas: ColaboradorRow[] = ((colaboradoresRes.data ?? []) as any[]).map(
    (c) => {
      const aloc = alocacaoPorColaborador.get(c.id);
      return {
        id: c.id,
        nome: c.nome,
        tipo_contratacao: c.tipo_contratacao,
        funcao: c.funcao,
        status: c.status,
        data_admissao: c.data_admissao,
        data_encerramento: c.data_encerramento,
        nivel_codigo: c.nivel?.codigo ?? null,
        salario_vigente: salarioPorColaborador.get(c.id) ?? null,
        empresa_id: aloc?.empresa_id ?? null,
        empresa_nome: aloc?.empresa_nome ?? null,
        regional_id: aloc?.regional_id ?? null,
        regional_nome: aloc?.regional_nome ?? null,
        usa_rateio_empresa: aloc?.usa_rateio_empresa ?? false,
      };
    },
  );

  // Opções pros filtros de empresa e regional. Empresas vêm da tabela real
  // pra cobrir também as que não têm ninguém alocado (raro, mas correto).
  const empresasRes = await supabase
    .from("empresas")
    .select("id, nome_fantasia")
    .eq("tenant_id", session.activeTenant.id)
    .order("nome_fantasia", { ascending: true });
  const empresasOpcoes: EmpresaOpcao[] = ((empresasRes.data ?? []) as {
    id: string;
    nome_fantasia: string;
  }[]).map((e) => ({ id: e.id, nome: e.nome_fantasia }));

  const regionaisRes = await supabase
    .from("regionais")
    .select("id, nome, empresa_id")
    .eq("tenant_id", session.activeTenant.id)
    .order("nome", { ascending: true });
  const regionaisOpcoes: RegionalOpcao[] = ((regionaisRes.data ?? []) as {
    id: string;
    nome: string;
    empresa_id: string;
  }[]).map((r) => ({ id: r.id, nome: r.nome, empresa_id: r.empresa_id }));

  const niveisAtivosCount = niveisRes.count ?? 0;

  const ativosCount = ativosCountRes.count ?? 0;
  const admissoesMes = admissoesMesRes.count ?? 0;
  const admissoesPrev = admissoesPrevMesRes.count ?? 0;
  const demissoesMes = demissoesMesRes.count ?? 0;
  const demissoesPrev = demissoesPrevMesRes.count ?? 0;

  // Valor da folha atual = soma dos salários vigentes de colaboradores
  // ATIVOS. Reflete o custo do quadro no minuto atual, independente de
  // a folha da competência ter sido gerada.
  const idsAtivos = new Set(
    linhas.filter((l) => l.status === "ativo").map((l) => l.id),
  );
  let folhaAtualValor = 0;
  for (const [colaboradorId, salario] of salarioPorColaborador) {
    if (idsAtivos.has(colaboradorId)) folhaAtualValor += salario;
  }

  const folhaPrevLinhas =
    (folhaPrevRes.data ?? []) as { salario_base: string | number }[];
  const folhaPrevValor = folhaPrevLinhas.reduce(
    (acc, l) => acc + Number(l.salario_base),
    0,
  );
  const temFolhaPrev = folhaPrevLinhas.length > 0;

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
      <Link
        href="/rh"
        prefetch={false}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3 w-3" />
        Voltar para RH
      </Link>

      <PageHeader
        eyebrow="RH"
        title="Colaboradores"
        description="Quadro atual da agência, valor total da folha e alocação por empresa e regional. Clique em um colaborador para ver o detalhe."
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
          rotulo={`Valor da folha (${nomeMesAtual})`}
          valorPrincipal={brl.format(folhaAtualValor)}
          rodape={
            temFolhaPrev ? (
              <DeltaPercentual
                atual={folhaAtualValor}
                anterior={folhaPrevValor}
                nomeAnterior={nomeMesAnterior}
              />
            ) : (
              <span className="text-xs text-muted-foreground">
                Soma dos {ativosCount} salários vigentes
              </span>
            )
          }
          destaque
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
          empresasOpcoes={empresasOpcoes}
          regionaisOpcoes={regionaisOpcoes}
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
