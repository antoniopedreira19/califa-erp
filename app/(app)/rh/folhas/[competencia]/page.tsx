import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import type {
  Empresa,
  FolhaLinhaStatus,
  Nivel,
} from "@/lib/types";
import { FolhaCompetenciaView, type FolhaLinha } from "./folha-competencia-view";

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

function parseCompetencia(chave: string): { ano: number; mes: number } | null {
  const m = chave.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || ano < 2020 || ano > 2099) return null;
  return { ano, mes };
}

export default async function FolhaCompetenciaPage({
  params,
}: {
  params: { competencia: string };
}) {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.folhas.ver")) {
    redirect("/home?reason=sem_permissao_rh");
  }

  const competencia = parseCompetencia(params.competencia);
  if (!competencia) notFound();
  const { ano, mes } = competencia;

  const supabase = createClient();

  // Passo 1: folhas + empresas + regionais em paralelo (sem embed pesado).
  // Empresas (4) e regionais (9) do tenant são pequenas — vira Map local
  // pra hidratar o snapshot de alocação sem embed aninhado, que era o que
  // deixava a query pesada (docs/PERFORMANCE.md §C — N+1 / embed pesado).
  const [linhasRes, empresasRes, regionaisRes] = await Promise.all([
    supabase
      .from("folhas_pagamento")
      .select(
        "id, salario_base, status, motivo_pendencia, colaborador_id",
      )
      .eq("tenant_id", session.activeTenant.id)
      .eq("competencia_ano", ano)
      .eq("competencia_mes", mes)
      .order("created_at", { ascending: true }),
    supabase
      .from("empresas")
      .select("id, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome_fantasia"),
    supabase
      .from("regionais")
      .select("id, nome, empresa_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
  ]);

  if (linhasRes.error) {
    console.error("[folha.competencia.linhas]", linhasRes.error.message);
  }

  const folhasRaw = (linhasRes.data ?? []) as {
    id: string;
    salario_base: string | number;
    status: FolhaLinhaStatus;
    motivo_pendencia: string | null;
    colaborador_id: string;
  }[];

  const folhaIds = folhasRaw.map((f) => f.id);
  const colaboradorIds = Array.from(
    new Set(folhasRaw.map((f) => f.colaborador_id)),
  );

  // Passo 2: colaboradores + alocacoes em paralelo (in-clauses baseados
  // no passo 1). Só campos necessários pra render — sem tipos aninhados.
  const [colaboradoresRes, alocacoesRes] = await Promise.all([
    colaboradorIds.length > 0
      ? supabase
          .from("colaboradores")
          .select(
            "id, nome, funcao, tipo_contratacao, nivel:niveis(codigo)",
          )
          .in("id", colaboradorIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    folhaIds.length > 0
      ? supabase
          .from("folhas_pagamento_alocacoes")
          .select("id, folha_id, empresa_id, regional_id, percentual")
          .in("folha_id", folhaIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);

  const colaboradorPorId = new Map<
    string,
    {
      id: string;
      nome: string;
      funcao: string;
      tipo_contratacao: string;
      nivel_codigo: string | null;
    }
  >();
  for (const c of ((colaboradoresRes.data ?? []) as any[])) {
    colaboradorPorId.set(c.id, {
      id: c.id,
      nome: c.nome,
      funcao: c.funcao,
      tipo_contratacao: c.tipo_contratacao,
      nivel_codigo: c.nivel?.codigo ?? null,
    });
  }

  const empresaNomePorId = new Map<string, string>();
  for (const e of ((empresasRes.data ?? []) as any[])) {
    empresaNomePorId.set(e.id, e.nome_fantasia);
  }
  const regionalNomePorId = new Map<string, string>();
  for (const r of ((regionaisRes.data ?? []) as any[])) {
    regionalNomePorId.set(r.id, r.nome);
  }

  const alocacoesPorFolha = new Map<
    string,
    {
      id: string;
      empresa_id: string;
      regional_id: string;
      percentual: string;
      empresa_nome: string;
      regional_nome: string;
    }[]
  >();
  for (const a of ((alocacoesRes.data ?? []) as any[])) {
    const lista = alocacoesPorFolha.get(a.folha_id) ?? [];
    lista.push({
      id: a.id,
      empresa_id: a.empresa_id,
      regional_id: a.regional_id,
      percentual: String(a.percentual),
      empresa_nome: empresaNomePorId.get(a.empresa_id) ?? "",
      regional_nome: regionalNomePorId.get(a.regional_id) ?? "",
    });
    alocacoesPorFolha.set(a.folha_id, lista);
  }

  const linhas: FolhaLinha[] = folhasRaw.map((l) => {
    const c = colaboradorPorId.get(l.colaborador_id);
    return {
      id: l.id,
      salario_base: String(l.salario_base),
      status: l.status,
      motivo_pendencia: l.motivo_pendencia,
      colaborador: {
        id: c?.id ?? "",
        nome: c?.nome ?? "—",
        funcao: c?.funcao ?? "—",
        tipo_contratacao: (c?.tipo_contratacao ?? "clt") as any,
        nivel_codigo: c?.nivel_codigo ?? null,
      },
      alocacoes: alocacoesPorFolha.get(l.id) ?? [],
    };
  });

  const empresas = (empresasRes.data ?? []) as Pick<Empresa, "id" | "nome_fantasia">[];
  const regionais = (regionaisRes.data ?? []) as {
    id: string;
    nome: string;
    empresa_id: string;
  }[];

  const podeEditar = pode(session.activeRole, "rh.folhas.editar_rh");

  const totalGeral = linhas.reduce((acc, l) => acc + Number(l.salario_base), 0);
  const contagem = {
    enviada: 0,
    aprovada: 0,
    pendente_correcao: 0,
    paga: 0,
  };
  for (const l of linhas) {
    if (l.status === "enviada") contagem.enviada += 1;
    else if (l.status === "aprovada") contagem.aprovada += 1;
    else if (l.status === "pendente_correcao") contagem.pendente_correcao += 1;
    else if (l.status === "paga") contagem.paga += 1;
  }

  const brl = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <Link
          href="/rh/folhas"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para folhas
        </Link>
        <header className="mt-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <Receipt className="h-5 w-5 text-california-red" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">
              Folha de {NOMES_MES[mes - 1]}/{ano}
            </h1>
          </div>
        </header>
      </div>

      {linhas.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
          <CardResumo
            titulo="Total da folha"
            valor={brl.format(totalGeral)}
            className="col-span-2 md:col-span-2"
            destaque
          />
          <CardResumo
            titulo="Colaboradores"
            valor={String(linhas.length)}
          />
          <CardResumo titulo="Enviadas" valor={String(contagem.enviada)} />
          <CardResumo
            titulo="Pendências"
            valor={String(contagem.pendente_correcao)}
            tom={contagem.pendente_correcao > 0 ? "vermelho" : undefined}
          />
          <CardResumo
            titulo="Aprovadas"
            valor={String(contagem.aprovada)}
          />
          <CardResumo
            titulo="Pagas"
            valor={String(contagem.paga)}
            tom={contagem.paga > 0 ? "verde" : undefined}
            className="col-span-2 md:col-span-1"
          />
        </div>
      )}

      <FolhaCompetenciaView
        linhas={linhas}
        empresas={empresas}
        regionais={regionais}
        podeEditar={podeEditar}
      />
    </div>
  );
}

function CardResumo({
  titulo,
  valor,
  destaque,
  tom,
  className,
}: {
  titulo: string;
  valor: string;
  destaque?: boolean;
  tom?: "vermelho" | "verde";
  className?: string;
}) {
  const corValor = destaque
    ? "text-foreground"
    : tom === "vermelho"
      ? "text-california-red"
      : tom === "verde"
        ? "text-emerald-700"
        : "text-foreground";
  return (
    <div
      className={`rounded-xl border border-border bg-background p-4 ${className ?? ""}`}
    >
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
    </div>
  );
}
