import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Plus, UserPlus } from "lucide-react";
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

export default async function ColaboradoresPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();

  // Datas da competência atual — usadas nos cards de admissão/demissão do mês
  // e no filtro da folha atual.
  const agora = new Date();
  const anoAtual = agora.getFullYear();
  const mesAtual = agora.getMonth() + 1; // 1..12
  const primeiroDia = `${anoAtual}-${String(mesAtual).padStart(2, "0")}-01`;
  const ultimoDiaNum = new Date(anoAtual, mesAtual, 0).getDate();
  const ultimoDia = `${anoAtual}-${String(mesAtual).padStart(2, "0")}-${String(ultimoDiaNum).padStart(2, "0")}`;

  // Colaboradores + níveis + cards agregados em paralelo (docs/PERFORMANCE.md §B).
  const [
    colaboradoresRes,
    niveisRes,
    ativosCountRes,
    admissoesMesRes,
    demissoesMesRes,
    folhaAtualRes,
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
      .gte("data_admissao", primeiroDia)
      .lte("data_admissao", ultimoDia),
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .gte("data_encerramento", primeiroDia)
      .lte("data_encerramento", ultimoDia),
    // Folha da competência atual: só o valor. Payload mínimo (docs/PERFORMANCE.md §C).
    supabase
      .from("folhas_pagamento")
      .select("salario_base")
      .eq("tenant_id", session.activeTenant.id)
      .eq("competencia_ano", anoAtual)
      .eq("competencia_mes", mesAtual),
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
  const demissoesMes = demissoesMesRes.count ?? 0;
  const folhaAtualLinhas =
    (folhaAtualRes.data ?? []) as { salario_base: string | number }[];
  const folhaAtualGerada = folhaAtualLinhas.length > 0;
  const folhaAtualValor = folhaAtualLinhas.reduce(
    (acc, l) => acc + Number(l.salario_base),
    0,
  );

  const brl = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const nomeMesAtual = `${NOMES_MES[mesAtual - 1]}/${anoAtual}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="RH"
        title="Colaboradores"
        description="Cadastro do quadro atual e inativos. Nível de cargo, alocação por empresa e regional, histórico salarial."
        icon={Users}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <CardColaborador
          titulo="Colaboradores ativos"
          valor={String(ativosCount)}
        />
        <CardColaborador
          titulo={`Folha de ${nomeMesAtual}`}
          valor={folhaAtualGerada ? brl.format(folhaAtualValor) : "—"}
          hint={folhaAtualGerada ? undefined : "Folha não gerada"}
          destaque={folhaAtualGerada}
        />
        <CardColaborador
          titulo="Admissões no mês"
          valor={String(admissoesMes)}
          tom={admissoesMes > 0 ? "verde" : undefined}
        />
        <CardColaborador
          titulo="Demissões no mês"
          valor={String(demissoesMes)}
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

function CardColaborador({
  titulo,
  valor,
  hint,
  destaque,
  tom,
}: {
  titulo: string;
  valor: string;
  hint?: string;
  destaque?: boolean;
  tom?: "verde" | "vermelho";
}) {
  const corValor =
    tom === "verde"
      ? "text-emerald-700"
      : tom === "vermelho"
        ? "text-california-red"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {titulo}
      </p>
      <p
        className={`mt-2 font-bold tabular-nums ${
          destaque ? "text-3xl" : "text-2xl"
        } ${corValor}`}
      >
        {valor}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
