"use client";

/**
 * Aba "Títulos a Receber" (Tela 3.3) — espelho da aba Títulos a Pagar.
 *
 * Três datas convivem em cada linha, e confundi-las é o erro fácil:
 *
 * - **Vencimento** — o que a nota diz. IMUTÁVEL; o banco reverte qualquer
 *   tentativa de alterá-lo (trigger `congela_previsao_recebimento_primeira`).
 * - **Previsão de recebimento** — quando o financeiro espera receber.
 *   Repactuável pelo lápis; destacada em âmbar quando difere do
 *   vencimento. É ela que o fluxo de caixa lê.
 * - **Data de recebimento** — quando o dinheiro entrou. Só existe depois
 *   da baixa, e não existe baixa sem ela.
 *
 * Assim como em Contas a Pagar (decisão 016 §9), esta aba só dá baixa:
 * estorno e cancelamento de NF não têm porta aqui, seguindo o protótipo.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Banknote, Check, CheckCheck, Layers, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ContatosCobrancaInline,
  type ContatoCobranca,
} from "@/components/financeiro/contatos-cobranca";
import type {
  ContaBancaria,
  PlanoContaTipo,
  PlanoContaSubtipo,
  TituloReceberStatus,
} from "@/lib/types";
import {
  BaixaRecebimentoDialog,
  type BaixaRecebimentoAlvo,
} from "./baixa-recebimento-dialog";
import {
  EditarPrevisaoDialog,
  type EditarPrevisaoAlvo,
} from "./editar-previsao-dialog";
import { darBaixaTitulo, repactuarPrevisaoRecebimento } from "./actions";

export interface TituloRow {
  id: string;
  numero_parcela: number;
  total_parcelas: number;
  valor: number;
  data_vencimento: string;
  data_previsao_recebimento: string;
  data_previsao_recebimento_primeira: string;
  status: TituloReceberStatus;
  pago_em: string | null;
  empresa_id: string;
  faturamento_id: string;
  fat_numero_nf: string;
  fat_data_emissao: string;
  fat_descricao: string;
  contraparte_nome: string;
  jobs_cobertos: string[];
  /** Contatos de cobrança dos jobs que a nota cobre, sem repetição
   *  (docs/decisions/012). Vazio nos jobs anteriores a 17/08/2026. */
  contatos: ContatoCobranca[];
  conta_nome: string | null;
  centro_nome: string | null;
}

interface Props {
  rows: TituloRow[];
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function TitulosList({ rows, contas, tipos, subtipos }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [baixando, setBaixando] = React.useState<TituloRow | null>(null);
  const [editando, setEditando] = React.useState<TituloRow | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const alvoBaixa: BaixaRecebimentoAlvo | null = baixando
    ? {
        numeroNf: baixando.fat_numero_nf,
        cliente: baixando.contraparte_nome,
        jobs: baixando.jobs_cobertos,
        parcela: `${baixando.numero_parcela}/${baixando.total_parcelas}`,
        vencimento: baixando.data_vencimento,
        previsao: baixando.data_previsao_recebimento,
        valor: baixando.valor,
        empresaId: baixando.empresa_id,
      }
    : null;

  const alvoEdicao: EditarPrevisaoAlvo | null = editando
    ? {
        numeroNf: editando.fat_numero_nf,
        parcela: `${editando.numero_parcela}/${editando.total_parcelas}`,
        cliente: editando.contraparte_nome,
        vencimento: editando.data_vencimento,
        primeiraPrevisao: editando.data_previsao_recebimento_primeira,
        previsaoAtual: editando.data_previsao_recebimento,
      }
    : null;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full min-w-[1400px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-[150px] px-3.5 py-3 font-semibold">Vencimento</th>
              <th className="w-[150px] px-3.5 py-3 font-semibold">
                Previsão de recebimento
              </th>
              <th className="w-[130px] px-4 py-3 font-semibold">Nota fiscal</th>
              <th className="min-w-[140px] px-4 py-3 font-semibold">Cliente</th>
              <th className="min-w-[250px] px-4 py-3 font-semibold">Jobs cobertos</th>
              <th className="w-[130px] px-3.5 py-3 font-semibold">
                Data de recebimento
              </th>
              <th className="px-4 py-3 text-right font-semibold">Valor</th>
              <th className="w-[72px] px-3 py-3 font-semibold">Parcela</th>
              <th className="w-[96px] px-3.5 py-3 font-semibold">Status</th>
              <th className="w-[160px] px-4 py-3 text-right font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  Nenhum título a receber ainda. Emita uma NF na aba Faturamento.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const recebido = r.status === "pago";
              const cancelado = r.status === "cancelado";
              const adiada = r.data_previsao_recebimento !== r.data_vencimento;
              const agrupada = r.jobs_cobertos.length > 1;
              return (
                <tr
                  key={r.id}
                  onClick={() => {
                    if (recebido || cancelado) return;
                    setErro(null);
                    setBaixando(r);
                  }}
                  className={cn(
                    "border-b border-border transition-colors last:border-0 hover:bg-accent/40",
                    !recebido && !cancelado && "cursor-pointer",
                  )}
                >
                  <td className="px-3.5 py-3">
                    <div className="flex items-center gap-2">
                      {!recebido && !cancelado && (
                        <button
                          type="button"
                          title="Editar previsão de recebimento"
                          onClick={(e) => {
                            e.stopPropagation();
                            setErro(null);
                            setEditando(r);
                          }}
                          className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md border border-border bg-white text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                      <span className="whitespace-nowrap font-mono text-xs">
                        {formatDate(r.data_vencimento)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3.5 py-3">
                    <span
                      className={cn(
                        "whitespace-nowrap font-mono text-xs",
                        adiada ? "font-bold text-amber-800" : "font-medium",
                      )}
                    >
                      {formatDate(r.data_previsao_recebimento)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-xs font-bold text-california-red">
                        NF {r.fat_numero_nf}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Emitida {formatDate(r.fat_data_emissao)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px]">{r.contraparte_nome}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {agrupada && (
                        <span className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                          <Layers className="h-3 w-3" />
                          Agrupada · {r.jobs_cobertos.length} jobs
                        </span>
                      )}
                      <span className="font-mono text-[11.5px] text-muted-foreground text-pretty">
                        {r.jobs_cobertos.join("  ·  ")}
                      </span>
                      {/* A quem cobrar este título. Numa NF agrupada são os
                          contatos de todos os jobs da nota, sem repetir
                          (docs/decisions/012). */}
                      <ContatosCobrancaInline contatos={r.contatos} />
                    </div>
                  </td>
                  <td className="px-3.5 py-3">
                    <span
                      className={cn(
                        "whitespace-nowrap font-mono text-xs",
                        recebido
                          ? "font-bold text-emerald-700"
                          : "text-muted-foreground/50",
                      )}
                    >
                      {recebido ? formatDate(r.pago_em) : "—"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                    {formatMoney(r.valor)}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                    {r.numero_parcela}/{r.total_parcelas}
                  </td>
                  <td className="px-3.5 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        cancelado
                          ? "border-border bg-muted text-muted-foreground"
                          : recebido
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
                      )}
                    >
                      {cancelado ? "Cancelado" : recebido ? "Recebido" : "Em aberto"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {recebido ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                          <Check className="h-3 w-3" />
                          Conciliação
                        </span>
                        <span className="whitespace-nowrap text-[11px] text-muted-foreground/80">
                          {r.conta_nome ?? "—"} · {r.centro_nome ?? "—"}
                        </span>
                      </div>
                    ) : cancelado ? null : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setErro(null);
                          setBaixando(r);
                        }}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-700 px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-emerald-800"
                      >
                        <Banknote className="h-3.5 w-3.5" />
                        Baixar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <BaixaRecebimentoDialog
        open={baixando !== null}
        onOpenChange={(o) => {
          if (!o) {
            setBaixando(null);
            setErro(null);
          }
        }}
        alvo={alvoBaixa}
        contas={contas}
        tipos={tipos}
        subtipos={subtipos}
        pending={pending}
        erro={erro}
        onConfirm={(payload) => {
          const alvo = baixando;
          if (!alvo) return;
          startTransition(async () => {
            const res = await darBaixaTitulo({ titulo_id: alvo.id, ...payload });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setBaixando(null);
            setErro(null);
            setToast(
              `Baixa registrada · ${formatMoney(alvo.valor)} enviado para a conciliação.`,
            );
            router.refresh();
          });
        }}
      />

      <EditarPrevisaoDialog
        open={editando !== null}
        onOpenChange={(o) => {
          if (!o) {
            setEditando(null);
            setErro(null);
          }
        }}
        alvo={alvoEdicao}
        pending={pending}
        erro={erro}
        onSalvar={(novaData) => {
          const alvo = editando;
          if (!alvo) return;
          startTransition(async () => {
            const res = await repactuarPrevisaoRecebimento({
              titulo_id: alvo.id,
              data_previsao_recebimento: novaData,
            });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setEditando(null);
            setErro(null);
            setToast(`Previsão de recebimento atualizada para ${formatDate(novaData)}.`);
            router.refresh();
          });
        }}
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
          <span className="text-sm font-semibold text-emerald-900">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
