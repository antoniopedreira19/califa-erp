import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, FileText, Paperclip, Wallet } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import {
  desembolsoStatusLabel,
  type DesembolsoStatus,
} from "@/lib/types";
import { ParcelasLista } from "./parcelas-lista";
import { BaixarAnexoDesembolsoButton } from "./baixar-anexo-button";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function statusBadgeClass(status: DesembolsoStatus): string {
  switch (status) {
    case "em_avaliacao":
      return "inline-flex items-center rounded-full border border-[#bfdbfe] bg-[#eff6ff] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#1d4ed8]";
    case "aprovada":
      return "inline-flex items-center rounded-full border border-[#fde68a] bg-[#fffbeb] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#92400e]";
    case "pago":
      return "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700";
    case "rejeitada":
      return "inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-700";
    case "cancelada":
      return "inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-600";
  }
}

export default async function DesembolsoDetalhePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();

  // Gate: criador pode ver, admin/financeiro podem sempre
  // (RLS já protege; aqui apenas redirecionamos se necessário)
  const supabase = createClient();

  // Fetch principal em Promise.all
  const [desembolsoRes, parcelasRes, regionaisRes, anexosRes, auditRes] =
    await Promise.all([
      supabase
        .from("desembolsos")
        .select(`
          *,
          empresa:empresas(razao_social, nome_fantasia),
          fornecedor:fornecedores(nome, razao_social),
          cliente:clientes(nome_fantasia, razao_social),
          job:jobs(codigo, nome),
          criador:profiles!desembolsos_criado_por_fkey(nome),
          aprovador:profiles!desembolsos_aprovada_por_fkey(nome),
          rejeitador:profiles!desembolsos_rejeitada_por_fkey(nome),
          cancelador:profiles!desembolsos_cancelada_por_fkey(nome)
        `)
        .eq("id", params.id)
        .eq("tenant_id", session.activeTenant.id)
        .maybeSingle(),

      supabase
        .from("desembolsos_parcelas")
        .select("id, numero, data_vencimento, data_pagamento, data_pagamento_primeira, valor, pago_em, pago_por")
        .eq("desembolso_id", params.id)
        .eq("tenant_id", session.activeTenant.id)
        .order("numero"),

      supabase
        .from("desembolsos_regionais")
        .select("regional_id, percentual, regional:regionais(nome)")
        .eq("desembolso_id", params.id),

      supabase
        .from("desembolsos_anexos")
        .select("id, arquivo_nome_original, arquivo_tamanho_bytes, created_at")
        .eq("desembolso_id", params.id)
        .eq("tenant_id", session.activeTenant.id)
        .order("created_at"),

      supabase
        .from("audit_events")
        .select("id, acao, metadata, created_at, actor_user_id")
        .eq("entidade_tipo", "desembolso")
        .eq("entidade_id", params.id)
        .eq("tenant_id", session.activeTenant.id)
        .order("created_at", { ascending: true }),
    ]);

  if (desembolsoRes.error || !desembolsoRes.data) {
    notFound();
  }

  // Verificar acesso: não-admin/financeiro só vê o próprio
  const isAdminOrFinanceiro =
    session.activeRole === "administrador" || session.activeRole === "financeiro";
  const d = desembolsoRes.data as Record<string, unknown> & {
    id: string;
    tenant_id: string;
    codigo: string;
    empresa_id: string;
    descricao: string;
    valor: string;
    status: DesembolsoStatus;
    fornecedor_id: string | null;
    cliente_id: string | null;
    job_id: string | null;
    data_prevista_pagamento: string | null;
    motivo_rejeicao: string | null;
    motivo_cancelamento: string | null;
    criado_por: string;
    aprovada_por: string | null;
    aprovada_em: string | null;
    rejeitada_por: string | null;
    rejeitada_em: string | null;
    cancelada_por: string | null;
    cancelada_em: string | null;
    pago_em: string | null;
    pago_por: string | null;
    created_at: string;
    updated_at: string;
    empresa: { razao_social: string | null; nome_fantasia: string | null } | null;
    fornecedor: { nome: string; razao_social: string | null } | null;
    cliente: { nome_fantasia: string; razao_social: string | null } | null;
    job: { codigo: string; nome: string } | null;
    criador: { nome: string } | null;
    aprovador: { nome: string } | null;
    rejeitador: { nome: string } | null;
    cancelador: { nome: string } | null;
  };

  if (!isAdminOrFinanceiro && d.criado_por !== session.profile.id) {
    redirect("/financeiro/desembolsos?reason=sem_permissao");
  }

  const parcelas = (parcelasRes.data ?? []);
  const regionais = (regionaisRes.data ?? []) as unknown as Array<{
    regional_id: string;
    percentual: number | string;
    regional: { nome: string } | null;
  }>;
  const anexos = (anexosRes.data ?? []) as Array<{
    id: string;
    arquivo_nome_original: string;
    arquivo_tamanho_bytes: number;
    created_at: string;
  }>;
  const auditEvents = (auditRes.data ?? []) as Array<{
    id: string;
    acao: string;
    metadata: Record<string, unknown>;
    created_at: string;
    actor_user_id: string | null;
  }>;

  const empresaNome =
    d.empresa?.razao_social ?? d.empresa?.nome_fantasia ?? "—";

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Breadcrumb + Header */}
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link
            href="/financeiro"
            prefetch={false}
            className="hover:text-california-red transition-colors"
          >
            Financeiro
          </Link>
          <ChevronRight className="h-3 w-3" />
          <Link
            href="/financeiro/desembolsos"
            prefetch={false}
            className="hover:text-california-red transition-colors"
          >
            Desembolsos
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">{d.codigo}</span>
        </nav>

        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Wallet className="h-5 w-5 text-california-red" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{d.descricao}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-xs text-muted-foreground">
                {d.codigo}
              </span>
              <span className={statusBadgeClass(d.status)}>
                {desembolsoStatusLabel(d.status)}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Box de rejeição */}
      {d.status === "rejeitada" && (
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase text-red-700">
            Desembolso rejeitado
          </h2>
          <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <span className="text-muted-foreground">Motivo</span>
            <span>{d.motivo_rejeicao ?? "—"}</span>
            <span className="text-muted-foreground">Rejeitado por</span>
            <span>{d.rejeitador?.nome ?? "—"}</span>
            <span className="text-muted-foreground">Em</span>
            <span>{formatDateTime(d.rejeitada_em)}</span>
          </div>
        </div>
      )}

      {/* Box de cancelamento */}
      {d.status === "cancelada" && (
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase text-gray-600">
            Desembolso cancelado
          </h2>
          <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <span className="text-muted-foreground">Motivo</span>
            <span>{d.motivo_cancelamento ?? "—"}</span>
            <span className="text-muted-foreground">Cancelado por</span>
            <span>{d.cancelador?.nome ?? "—"}</span>
            <span className="text-muted-foreground">Em</span>
            <span>{formatDateTime(d.cancelada_em)}</span>
          </div>
        </div>
      )}

      {/* Card Dados básicos */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
          Dados do desembolso
        </h2>
        <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">Valor total</span>
          <span className="font-mono font-semibold">
            {formatCurrency(Number(d.valor), "BRL")}
          </span>

          <span className="text-muted-foreground">Empresa</span>
          <span>{empresaNome}</span>

          <span className="text-muted-foreground">Fornecedor</span>
          <span>
            {d.fornecedor?.razao_social ?? d.fornecedor?.nome ?? "—"}
          </span>

          <span className="text-muted-foreground">Cliente</span>
          <span>
            {d.cliente?.razao_social ?? d.cliente?.nome_fantasia ?? "—"}
          </span>

          <span className="text-muted-foreground">Job</span>
          <span>
            {d.job ? `${d.job.codigo} · ${d.job.nome}` : "—"}
          </span>

          <span className="text-muted-foreground">Data prevista de pagamento</span>
          <span>{formatDate(d.data_prevista_pagamento)}</span>

          <span className="text-muted-foreground">Criado por</span>
          <span>
            {d.criador?.nome ?? "—"}{" "}
            <span className="text-muted-foreground text-xs">
              em {formatDateTime(d.created_at)}
            </span>
          </span>

          {d.aprovada_em && (
            <>
              <span className="text-muted-foreground">Aprovado por</span>
              <span>
                {d.aprovador?.nome ?? "—"}{" "}
                <span className="text-muted-foreground text-xs">
                  em {formatDateTime(d.aprovada_em)}
                </span>
              </span>
            </>
          )}

          {d.status === "pago" && d.pago_em && (
            <>
              <span className="text-muted-foreground">Pago em</span>
              <span>{formatDateTime(d.pago_em)}</span>
            </>
          )}
        </div>
      </div>

      {/* Seção Parcelas */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
          Parcelas ({parcelas.length})
        </h2>
        <ParcelasLista parcelas={parcelas} />
      </div>

      {/* Seção Rateio regional */}
      {regionais.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
            Rateio regional
          </h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Regional</th>
                  <th className="px-3 py-2 text-right font-medium">Percentual</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {regionais.map((r) => (
                  <tr
                    key={r.regional_id}
                    className="border-t border-border"
                  >
                    <td className="px-3 py-2">
                      {r.regional?.nome ?? r.regional_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {Number(r.percentual).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatCurrency(
                        (Number(d.valor) * Number(r.percentual)) / 100,
                        "BRL",
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Seção Anexos */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
          <Paperclip className="mr-1.5 inline-block h-4 w-4" />
          Anexos ({anexos.length})
        </h2>
        {anexos.length > 0 ? (
          <ul className="space-y-1">
            {anexos.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded border border-border bg-white p-2 text-xs"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{a.arquivo_nome_original}</span>
                <span className="shrink-0 text-muted-foreground">
                  {(a.arquivo_tamanho_bytes / 1024).toFixed(0)} KB
                </span>
                <BaixarAnexoDesembolsoButton anexoId={a.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Sem anexos.</p>
        )}
      </div>

      {/* Seção Histórico de auditoria */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
          Histórico
        </h2>
        {auditEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sem registros de histórico.
          </p>
        ) : (
          <ol className="space-y-2">
            {auditEvents.map((ev) => (
              <li
                key={ev.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs"
              >
                <span className="mt-0.5 shrink-0 font-mono text-muted-foreground">
                  {formatDateTime(ev.created_at)}
                </span>
                <span className="font-semibold">{ev.acao}</span>
                {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                  <span className="text-muted-foreground truncate">
                    {Object.entries(ev.metadata)
                      .filter(([k]) => !["codigo"].includes(k))
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
