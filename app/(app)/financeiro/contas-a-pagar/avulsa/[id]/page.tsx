import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight, FileText, Paperclip } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import type {
  ContaAvulsa,
  ContaAvulsaAnexo,
  ContaAvulsaHistorico,
  ContaAvulsaStatus,
  NaturezaLancamento,
  PlanoContaTipo,
  PlanoContaSubtipo,
} from "@/lib/types";
import { contaAvulsaStatusLabel } from "@/lib/types";
import {
  EditarAvulsaButton,
  ExcluirAvulsaButton,
  BaixarAvulsaModalClient,
  CancelarBaixaAvulsaModalClient,
  BaixarAnexoButton,
} from "./acoes-client";
import { HistoricoMudancas } from "./historico-mudancas";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export default async function AvulsaDetalhesPage({
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

  // Carrega conta com todos os embeds
  const { data: conta, error } = await supabase
    .from("contas_avulsas")
    .select(`
      *,
      empresa:empresas(razao_social, nome_fantasia),
      fornecedor:fornecedores(nome, razao_social),
      cliente:clientes(nome_fantasia, razao_social),
      job:jobs(codigo, nome),
      tipo:plano_contas_tipos(codigo, nome),
      subtipo:plano_contas_subtipos(nome),
      conta_bancaria:contas_bancarias!conta_bancaria_baixa_id(nome, banco),
      pago_por_profile:profiles!pago_por(nome)
    `)
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (error || !conta) notFound();

  // Queries paralelas: anexos + histórico + listas auxiliares (para modais/drawer)
  const [
    anexosRes,
    historicoRes,
    contasRes,
    empresasRes,
    tiposRes,
    subtiposRes,
    fornecedoresRes,
    clientesRes,
    jobsRes,
  ] = await Promise.all([
    supabase
      .from("contas_avulsas_anexos")
      .select("*")
      .eq("conta_avulsa_id", params.id),
    supabase
      .from("contas_avulsas_historico")
      .select("*, alterado_por_profile:profiles!alterado_por(nome)")
      .eq("conta_avulsa_id", params.id)
      .order("alterado_em", { ascending: false }),
    supabase
      .from("contas_bancarias")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("empresa_id", (conta as unknown as { empresa_id: string }).empresa_id)
      .eq("ativo", true),
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
      .select("id, codigo, nome, projeto:projetos!inner(cliente_id)")
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  // conta vem do Supabase com embeds — usar cast amplo para acessar joins
  const c = conta as Record<string, unknown> & {
    id: string;
    tenant_id: string;
    empresa_id: string;
    descricao: string;
    valor: string;
    natureza: NaturezaLancamento;
    data_prevista_pagamento: string | null;
    status: ContaAvulsaStatus;
    fornecedor_id: string | null;
    cliente_id: string | null;
    job_id: string | null;
    plano_conta_tipo_id: string;
    plano_conta_subtipo_id: string;
    pago_em: string | null;
    pago_por: string | null;
    conta_bancaria_baixa_id: string | null;
    criado_por: string;
    created_at: string;
    updated_at: string;
    empresa: { razao_social: string | null; nome_fantasia: string | null } | null;
    fornecedor: { nome: string; razao_social: string | null } | null;
    cliente: { nome_fantasia: string; razao_social: string | null } | null;
    job: { codigo: string; nome: string } | null;
    tipo: { codigo: string; nome: string } | null;
    subtipo: { nome: string } | null;
    conta_bancaria: { nome: string; banco: string } | null;
    pago_por_profile: { nome: string } | null;
  };

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
    projeto: { cliente_id: string } | { cliente_id: string }[] | null;
  }>).map((j) => {
    const proj = Array.isArray(j.projeto) ? j.projeto[0] : j.projeto;
    return {
      id: j.id,
      codigo: j.codigo,
      nome: j.nome,
      cliente_id: proj?.cliente_id ?? null,
    };
  });
  const tipos = (tiposRes.data ?? []) as PlanoContaTipo[];
  const subtipos = (subtiposRes.data ?? []) as PlanoContaSubtipo[];
  const contasBancarias = (contasRes.data ?? []) as import("@/lib/types").ContaBancaria[];

  const contaParaDrawer: ContaAvulsa = {
    id: c.id,
    tenant_id: c.tenant_id,
    empresa_id: c.empresa_id,
    descricao: c.descricao,
    valor: c.valor,
    natureza: c.natureza,
    data_prevista_pagamento: c.data_prevista_pagamento,
    status: c.status,
    fornecedor_id: c.fornecedor_id,
    cliente_id: c.cliente_id,
    job_id: c.job_id,
    plano_conta_tipo_id: c.plano_conta_tipo_id,
    plano_conta_subtipo_id: c.plano_conta_subtipo_id,
    pago_em: c.pago_em,
    pago_por: c.pago_por,
    conta_bancaria_baixa_id: c.conta_bancaria_baixa_id,
    criado_por: c.criado_por,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Breadcrumb + Header */}
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/financeiro" className="hover:text-california-red">
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
            {c.descricao.length > 60
              ? c.descricao.slice(0, 60) + "..."
              : c.descricao}
          </span>
        </nav>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <FileText className="h-5 w-5 text-california-red" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{c.descricao}</h1>
              <span
                className={
                  c.status === "pendente"
                    ? "inline-flex items-center rounded-full border border-[#fde68a] bg-[#fffbeb] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#92400e]"
                    : "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700"
                }
              >
                {contaAvulsaStatusLabel(c.status)}
              </span>
            </div>
          </div>

          {/* Botões de ação dependem do status */}
          <div className="flex items-center gap-2">
            {c.status === "pendente" && (
              <>
                <EditarAvulsaButton
                  conta={contaParaDrawer}
                  tenantId={session.activeTenant.id}
                  empresas={empresas}
                  tipos={tipos}
                  subtipos={subtipos}
                  fornecedores={fornecedores}
                  clientes={clientes}
                  jobs={jobs}
                />
                <BaixarAvulsaModalClient
                  contaId={c.id}
                  descricao={c.descricao}
                  valor={Number(c.valor)}
                  contas={contasBancarias}
                />
                <ExcluirAvulsaButton
                  contaId={c.id}
                  descricao={c.descricao}
                />
              </>
            )}
            {c.status === "baixada" && (
              <CancelarBaixaAvulsaModalClient
                contaId={c.id}
                descricao={c.descricao}
              />
            )}
          </div>
        </div>
      </header>

      {/* Card Detalhes */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
          Detalhes
        </h2>
        <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-semibold">
            {formatCurrency(Number(c.valor), "BRL")}
            {" · "}
            {c.natureza === "entrada" ? "Entrada" : "Saída"}
          </span>

          <span className="text-muted-foreground">Empresa</span>
          <span>{c.empresa?.razao_social ?? c.empresa?.nome_fantasia ?? "—"}</span>

          <span className="text-muted-foreground">Data prevista de pagamento</span>
          <span>{formatDate(c.data_prevista_pagamento)}</span>

          <span className="text-muted-foreground">Fornecedor</span>
          <span>{c.fornecedor?.razao_social ?? c.fornecedor?.nome ?? "—"}</span>

          <span className="text-muted-foreground">Cliente</span>
          <span>{c.cliente?.razao_social ?? c.cliente?.nome_fantasia ?? "—"}</span>

          <span className="text-muted-foreground">Job</span>
          <span>
            {c.job ? `${c.job.codigo} · ${c.job.nome}` : "—"}
          </span>

          <span className="text-muted-foreground">Plano de contas</span>
          <span>
            {c.tipo ? (
              <>
                <span className="font-mono">{c.tipo.codigo}</span>
                {c.subtipo ? ` · ${c.subtipo.nome}` : ""}
              </>
            ) : (
              "—"
            )}
          </span>
        </div>
      </div>

      {/* Card Baixa — só se baixada */}
      {c.status === "baixada" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase text-emerald-700">
            Baixa registrada
          </h2>
          <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <span className="text-muted-foreground">Pago em</span>
            <span>{formatDate(c.pago_em)}</span>

            <span className="text-muted-foreground">Por</span>
            <span>{c.pago_por_profile?.nome ?? "—"}</span>

            <span className="text-muted-foreground">Conta bancária</span>
            <span>
              {c.conta_bancaria
                ? `${c.conta_bancaria.nome} (${c.conta_bancaria.banco})`
                : "—"}
            </span>
          </div>
        </div>
      )}

      {/* Card Anexos */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
          <Paperclip className="mr-1.5 inline-block h-4 w-4" />
          Anexos ({(anexosRes.data ?? []).length})
        </h2>
        {anexosRes.data && anexosRes.data.length > 0 ? (
          <ul className="space-y-1">
            {(anexosRes.data as ContaAvulsaAnexo[]).map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded border border-border bg-white p-2 text-xs"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{a.arquivo_nome_original}</span>
                <span className="shrink-0 text-muted-foreground">
                  {(a.arquivo_tamanho_bytes / 1024).toFixed(0)} KB
                </span>
                <BaixarAnexoButton anexoId={a.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Sem anexos.</p>
        )}
      </div>

      {/* Card Histórico */}
      <HistoricoMudancas
        historico={
          (historicoRes.data ?? []) as Array<
            ContaAvulsaHistorico & {
              alterado_por_profile: { nome: string } | null;
            }
          >
        }
      />
    </div>
  );
}
