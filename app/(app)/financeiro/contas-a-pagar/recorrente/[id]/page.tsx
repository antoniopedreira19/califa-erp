import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Repeat } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import type {
  ContaAvulsaRecorrente,
  ContaAvulsaStatus,
  PlanoContaTipo,
  PlanoContaSubtipo,
  RateioLinhaInput,
} from "@/lib/types";
import {
  EditarRecorrenteButton,
  PausarRecorrenteButton,
  ReativarRecorrenteButton,
  ExcluirRecorrenteButton,
} from "./acoes-client";
import { HistoricoOcorrencias } from "./historico-ocorrencias";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers locais
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const MESES_ABR = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function formatFrequenciaResumo(r: ContaAvulsaRecorrente): string {
  if (r.frequencia === "mensal") return `Mensal · dia ${r.dia_do_mes}`;
  if (r.frequencia === "quinzenal")
    return `Quinzenal · ${r.dia_quinzena_1} e ${r.dia_quinzena_2}`;
  return `Anual · ${r.dia_do_ano_dia}/${MESES_ABR[(r.dia_do_ano_mes ?? 1) - 1]}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function RecorrenteDetalhesPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  // Query principal com embeds
  const { data: rec, error } = await supabase
    .from("contas_avulsas_recorrentes")
    .select(`
      *,
      empresa:empresas(razao_social, nome_fantasia),
      fornecedor:fornecedores(nome, razao_social),
      cliente:clientes(nome_fantasia, razao_social),
      job:jobs(codigo, nome),
      tipo:plano_contas_tipos(codigo, nome),
      subtipo:plano_contas_subtipos(nome)
    `)
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (error || !rec) notFound();

  // Queries paralelas: instâncias geradas + listas auxiliares para o drawer
  const [
    ocorrenciasRes,
    empresasRes,
    tiposRes,
    subtiposRes,
    fornecedoresRes,
    clientesRes,
    jobsRes,
    rateioRes,
    regionaisRes,
  ] = await Promise.all([
    supabase
      .from("contas_avulsas")
      .select("id, data_prevista_pagamento, status, valor, pago_em")
      .eq("recorrente_id", params.id)
      .order("data_prevista_pagamento", { ascending: false }),
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    supabase
      .from("plano_contas_tipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("ordem"),
    supabase
      .from("plano_contas_subtipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("fornecedores")
      .select("id, nome, razao_social")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome"),
    supabase
      .from("clientes")
      .select("id, nome_fantasia, razao_social")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    supabase
      .from("jobs")
      .select("id, codigo, nome, regional_id, projeto:projetos!inner(cliente_id)")
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado")
      .order("created_at", { ascending: false })
      .limit(500),
    // Rateio de regional desta recorrência
    supabase
      .from("contas_avulsas_recorrentes_regionais")
      .select("regional_id, percentual")
      .eq("recorrente_id", params.id)
      .eq("tenant_id", session.activeTenant.id),
    // Regionais ativas (para o editor de rateio no drawer)
    supabase
      .from("regionais")
      .select("id, nome, ativo")
      .eq("tenant_id", session.activeTenant.id)
      .order("nome"),
  ]);

  // Mapeamentos auxiliares
  const empresas = (empresasRes.data ?? []).map(
    (e: { id: string; razao_social: string | null; nome_fantasia: string | null }) => ({
      id: e.id,
      nome: (e.razao_social ?? e.nome_fantasia) as string,
    }),
  );
  const fornecedores = (fornecedoresRes.data ?? []).map(
    (f: { id: string; nome: string; razao_social: string | null }) => ({
      id: f.id,
      nome: (f.razao_social ?? f.nome) as string,
    }),
  );
  const clientes = (clientesRes.data ?? []).map(
    (cl: { id: string; nome_fantasia: string; razao_social: string | null }) => ({
      id: cl.id,
      nome: (cl.razao_social ?? cl.nome_fantasia) as string,
    }),
  );
  const jobs = ((jobsRes.data ?? []) as Array<{
    id: string;
    codigo: string;
    nome: string;
    regional_id: string | null;
    projeto: { cliente_id: string } | { cliente_id: string }[] | null;
  }>).map((j) => {
    const proj = Array.isArray(j.projeto) ? j.projeto[0] : j.projeto;
    return {
      id: j.id,
      codigo: j.codigo,
      nome: j.nome,
      cliente_id: proj?.cliente_id ?? null,
      regional_id: j.regional_id ?? null,
    };
  });
  const tipos = (tiposRes.data ?? []) as PlanoContaTipo[];
  const subtipos = (subtiposRes.data ?? []) as PlanoContaSubtipo[];

  // Rateio regional desta recorrência
  const rateioInicial: RateioLinhaInput[] = (
    (rateioRes.data ?? []) as Array<{ regional_id: string; percentual: string | number }>
  ).map((r) => ({
    regional_id: r.regional_id,
    percentual: Number(r.percentual),
  }));

  // Regionais (para o editor de rateio no drawer)
  const regionaisList = (regionaisRes.data ?? []).map(
    (r: { id: string; nome: string; ativo: boolean }) => ({
      id: r.id,
      nome: r.nome,
      ativo: r.ativo,
    }),
  );

  // Ocorrências geradas
  const ocorrencias = (ocorrenciasRes.data ?? []).map(
    (o: {
      id: string;
      data_prevista_pagamento: string | null;
      status: ContaAvulsaStatus;
      valor: string;
      pago_em: string | null;
    }) => ({
      id: o.id,
      data_prevista_pagamento: o.data_prevista_pagamento,
      status: o.status,
      valor: Number(o.valor),
      pago_em: o.pago_em,
    }),
  );

  // Cast amplo do registro principal
  const r = rec as Record<string, unknown> & {
    id: string;
    tenant_id: string;
    empresa_id: string;
    descricao: string;
    valor: string;
    fornecedor_id: string | null;
    cliente_id: string | null;
    job_id: string | null;
    plano_conta_tipo_id: string;
    plano_conta_subtipo_id: string;
    frequencia: ContaAvulsaRecorrente["frequencia"];
    dia_do_mes: number | null;
    dia_quinzena_1: number | null;
    dia_quinzena_2: number | null;
    dia_do_ano_dia: number | null;
    dia_do_ano_mes: number | null;
    proxima_data: string;
    data_fim: string | null;
    ativo: boolean;
    criado_por: string;
    created_at: string;
    updated_at: string;
    empresa: { razao_social: string | null; nome_fantasia: string | null } | null;
    fornecedor: { nome: string; razao_social: string | null } | null;
    cliente: { nome_fantasia: string; razao_social: string | null } | null;
    job: { codigo: string; nome: string } | null;
    tipo: { codigo: string; nome: string } | null;
    subtipo: { nome: string } | null;
  };

  // Objeto tipado para o drawer
  const recorrenteParaDrawer: ContaAvulsaRecorrente = {
    id: r.id,
    tenant_id: r.tenant_id,
    empresa_id: r.empresa_id,
    descricao: r.descricao,
    valor: r.valor,
    fornecedor_id: r.fornecedor_id,
    cliente_id: r.cliente_id,
    job_id: r.job_id,
    plano_conta_tipo_id: r.plano_conta_tipo_id,
    plano_conta_subtipo_id: r.plano_conta_subtipo_id,
    frequencia: r.frequencia,
    dia_do_mes: r.dia_do_mes,
    dia_quinzena_1: r.dia_quinzena_1,
    dia_quinzena_2: r.dia_quinzena_2,
    dia_do_ano_dia: r.dia_do_ano_dia,
    dia_do_ano_mes: r.dia_do_ano_mes,
    proxima_data: r.proxima_data,
    data_fim: r.data_fim,
    ativo: r.ativo,
    criado_por: r.criado_por,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };

  const geradasCount = ocorrencias.length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Breadcrumb + Header */}
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/financeiro" prefetch={false} className="hover:text-california-red">
            Financeiro
          </Link>
          <ChevronRight className="h-3 w-3" />
          <Link
            href="/financeiro/contas-a-pagar"
            prefetch={false}
            className="hover:text-california-red"
          >
            Contas a Pagar
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">
            {r.descricao.length > 60
              ? r.descricao.slice(0, 60) + "..."
              : r.descricao}
          </span>
        </nav>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <Repeat className="h-5 w-5 text-california-red" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{r.descricao}</h1>
              {r.ativo ? (
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                  Ativa
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                  Parada
                </span>
              )}
            </div>
          </div>

          {/* Botões de ação contextuais */}
          <div className="flex items-center gap-2">
            {r.ativo ? (
              <>
                <EditarRecorrenteButton
                  recorrente={recorrenteParaDrawer}
                  tenantId={session.activeTenant.id}
                  empresas={empresas}
                  tipos={tipos}
                  subtipos={subtipos}
                  fornecedores={fornecedores}
                  clientes={clientes}
                  jobs={jobs}
                  regionais={regionaisList}
                  rateioInicial={rateioInicial}
                />
                <PausarRecorrenteButton
                  recorrenteId={r.id}
                  descricao={r.descricao}
                />
              </>
            ) : (
              <ReativarRecorrenteButton
                recorrenteId={r.id}
                descricao={r.descricao}
              />
            )}
            <ExcluirRecorrenteButton
              recorrenteId={r.id}
              descricao={r.descricao}
              geradasCount={geradasCount}
            />
          </div>
        </div>
      </header>

      {/* Card Detalhes */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
          Detalhes
        </h2>
        <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">Empresa</span>
          <span>{r.empresa?.razao_social ?? r.empresa?.nome_fantasia ?? "—"}</span>

          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-semibold">
            {formatCurrency(Number(r.valor), "BRL")}
          </span>

          <span className="text-muted-foreground">Fornecedor</span>
          <span>{r.fornecedor?.razao_social ?? r.fornecedor?.nome ?? "—"}</span>

          <span className="text-muted-foreground">Cliente</span>
          <span>{r.cliente?.razao_social ?? r.cliente?.nome_fantasia ?? "—"}</span>

          <span className="text-muted-foreground">Job</span>
          <span>
            {r.job ? `${r.job.codigo} · ${r.job.nome}` : "—"}
          </span>

          <span className="text-muted-foreground">Plano de contas</span>
          <span>
            {r.tipo ? (
              <>
                <span className="font-mono">{r.tipo.codigo}</span>
                {r.subtipo ? ` · ${r.subtipo.nome}` : ""}
              </>
            ) : (
              "—"
            )}
          </span>
        </div>
      </div>

      {/* Card Recorrência */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
          Recorrência
        </h2>
        <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">Frequência</span>
          <span>
            <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {formatFrequenciaResumo(recorrenteParaDrawer)}
            </span>
          </span>

          <span className="text-muted-foreground">Próxima data</span>
          <span className="font-mono">{formatDate(r.proxima_data)}</span>

          <span className="text-muted-foreground">Data de fim</span>
          <span className="font-mono">{formatDate(r.data_fim)}</span>
        </div>
      </div>

      {/* Card Histórico de ocorrências */}
      <HistoricoOcorrencias ocorrencias={ocorrencias} />
    </div>
  );
}
