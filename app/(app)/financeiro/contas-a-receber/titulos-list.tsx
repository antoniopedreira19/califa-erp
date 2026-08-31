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
 * A aba dá baixa e, desde 31/08/2026, deixa CONFERIR a baixa já feita —
 * o botão de olho da linha recebida abre o `BaixaRegistradaDialog`, o
 * mesmo de Títulos a Pagar, com o estorno em dois tempos lá dentro. É a
 * simetria que o Tiago pediu; o protótipo desta tela ainda mostra só o
 * texto "Conciliação" na linha recebida. Cancelamento de NF continua sem
 * porta aqui (decisão 016 §9).
 *
 * INADIMPLÊNCIA (31/08/2026): a pastilha vermelha e o "N dias de atraso"
 * saem de `data_vencimento < hoje`, e NÃO da coluna `inadimplente_desde`.
 * A coluna é o registro que sobrevive ao pagamento, para o relatório; a
 * tela não depende dela, então uma rotina que falhe não deixa a aba
 * mentindo.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Banknote, CheckCheck, Eye, Layers, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BotaoInfo,
  InfoFaturamentoModal,
  type InfoFaturamento,
} from "@/components/financeiro/info-faturamento-modal";
import {
  BaixaRegistradaDialog,
  type BaixaRegistradaAlvo,
} from "@/components/financeiro/baixa-registrada-dialog";
import type { ContatoCobranca } from "@/lib/data/contatos-cobranca";
import type { InfoJob } from "./faturar-drawer";
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
import {
  darBaixaTitulo,
  estornarBaixaTitulo,
  repactuarPrevisaoRecebimento,
} from "./actions";

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
  /** Rótulos dos jobs DISTINTOS que a nota cobre, sem repetição. A nota com
   *  save e a com dois faturamentos parciais têm mais de um item do mesmo
   *  job, e listá-lo duas vezes lia como erro (31/08/2026). */
  jobs_cobertos: string[];
  /** Os mesmos jobs, com id — o botão `i` mostra a PO de cada um. */
  jobs: Array<{ job_id: string; codigo: string }>;
  /** Dia em que passou do vencimento sem ser recebido. Registro histórico:
   *  sobrevive à baixa. A pastilha da tela NÃO depende dele. */
  inadimplente_desde: string | null;
  conta_nome: string | null;
  centro_nome: string | null;
}

interface Props {
  rows: TituloRow[];
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  /** PO, instrução do GP e contatos, por job — o conteúdo do botão `i`. */
  infoPorJob: Record<string, InfoJob>;
}

/** Hoje em ISO local. `toISOString` volta em UTC e erra o dia à noite. */
function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Dias corridos entre o vencimento e hoje. Só faz sentido em atraso. */
function diasDeAtraso(vencimento: string): number {
  const [y, m, d] = vencimento.slice(0, 10).split("-").map(Number);
  const venc = new Date(y, m - 1, d);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((hoje.getTime() - venc.getTime()) / 86400000));
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** NF agrupada junta os contatos de todos os jobs — sem repetir o mesmo. */
function dedupContatos(lista: ContatoCobranca[]): ContatoCobranca[] {
  const vistos = new Set<string>();
  return lista.filter((c) => {
    const chave = `${c.nome?.trim() ?? ""}|${c.email?.trim().toLowerCase() ?? ""}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

export function TitulosList({
  rows,
  contas,
  tipos,
  subtipos,
  infoPorJob,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [baixando, setBaixando] = React.useState<TituloRow | null>(null);
  const [conferindo, setConferindo] = React.useState<TituloRow | null>(null);
  const [editando, setEditando] = React.useState<TituloRow | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<InfoFaturamento | null>(null);
  const [filtroStatus, setFiltroStatus] = React.useState<
    "todos" | "abertos" | "inadimplentes" | "recebidos"
  >("todos");

  const hoje = hojeIso();

  /**
   * Inadimplente é o título que passou do VENCIMENTO sem ser recebido
   * (Tiago, 31/08/2026). Não da previsão: a previsão anda — ela é
   * repactuada à mão ou rolada de semana em semana pela rotina diária —, e
   * o vencimento é o que a nota diz e nunca muda.
   */
  const estaInadimplente = React.useCallback(
    (r: TituloRow) =>
      r.status !== "pago" && r.status !== "cancelado" && r.data_vencimento < hoje,
    [hoje],
  );

  const chips = React.useMemo(
    () => [
      { chave: "todos" as const, rotulo: "Todos", n: rows.length },
      {
        chave: "abertos" as const,
        rotulo: "Em aberto",
        n: rows.filter((r) => r.status === "em_aberto" && !estaInadimplente(r)).length,
      },
      {
        chave: "inadimplentes" as const,
        rotulo: "Inadimplentes",
        n: rows.filter(estaInadimplente).length,
      },
      {
        chave: "recebidos" as const,
        rotulo: "Recebidos",
        n: rows.filter((r) => r.status === "pago").length,
      },
    ],
    [rows, estaInadimplente],
  );

  const visiveis = React.useMemo(
    () =>
      rows.filter((r) => {
        if (filtroStatus === "abertos") {
          return r.status === "em_aberto" && !estaInadimplente(r);
        }
        if (filtroStatus === "inadimplentes") return estaInadimplente(r);
        if (filtroStatus === "recebidos") return r.status === "pago";
        return true;
      }),
    [rows, filtroStatus, estaInadimplente],
  );

  /** O conteúdo do botão `i` de um título. */
  function infoDoTitulo(r: TituloRow): InfoFaturamento {
    return {
      referencia: `NF ${r.fat_numero_nf} · parcela ${r.numero_parcela}/${r.total_parcelas} · ${r.contraparte_nome}`,
      pos: r.jobs.map((j) => ({
        job: j.codigo,
        po: infoPorJob[j.job_id]?.po ?? null,
      })),
      // Nota já emitida: vale a descrição que saiu NELA, e não mais a
      // instrução que o GP mandou no envio.
      descricaoNf: r.fat_descricao,
      contatos: dedupContatos(
        r.jobs.flatMap((j) => infoPorJob[j.job_id]?.contatos ?? []),
      ),
    };
  }

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

  const alvoConferencia: BaixaRegistradaAlvo | null = conferindo
    ? {
        titulo: `NF ${conferindo.fat_numero_nf} — ${conferindo.fat_descricao}`,
        origem: conferindo.jobs_cobertos.join(" · ") || conferindo.contraparte_nome,
        parcela: `${conferindo.numero_parcela}/${conferindo.total_parcelas}`,
        valor: conferindo.valor,
        pagoEm: conferindo.pago_em,
        contaNome: conferindo.conta_nome,
        centroNome: conferindo.centro_nome,
        dataPagamento: conferindo.pago_em,
        vencOriginal: conferindo.data_vencimento,
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
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.chave}
            type="button"
            onClick={() => setFiltroStatus(c.chave)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filtroStatus === c.chave
                ? "border-california-red bg-california-red/10 text-california-red"
                : "border-border bg-white text-muted-foreground hover:bg-muted/50",
            )}
          >
            {c.rotulo}
            <span
              className={cn(
                "font-semibold tabular-nums",
                filtroStatus === c.chave
                  ? "text-california-red"
                  : "text-muted-foreground/70",
              )}
            >
              {c.n}
            </span>
          </button>
        ))}
      </div>

      {/* A caixa reserva 46px à direita para a calha, e o botão `i` mora numa
          célula de largura ZERO — a calha nunca alarga a tabela
          (`app/(app)/_planilha/calha.tsx`). */}
      <div className="overflow-x-auto pb-1.5">
      <div className="mr-[46px] box-border w-max min-w-[calc(100%-46px)] rounded-2xl border border-border bg-card shadow-soft">
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
              <th className="w-0 p-0" />
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && (
              <tr>
                <td
                  colSpan={11}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  {rows.length === 0
                    ? "Nenhum título a receber ainda. Emita uma NF na aba Faturamento."
                    : "Nenhum título com esse status."}
                </td>
              </tr>
            )}
            {visiveis.map((r) => {
              const recebido = r.status === "pago";
              const cancelado = r.status === "cancelado";
              const adiada = r.data_previsao_recebimento !== r.data_vencimento;
              const inadimplente = estaInadimplente(r);
              const agrupada = r.jobs_cobertos.length > 1;
              return (
                <tr
                  key={r.id}
                  onClick={() => {
                    if (cancelado) return;
                    setErro(null);
                    // Recebido abre a baixa registrada, em leitura; em aberto
                    // abre o formulário de baixa.
                    if (recebido) setConferindo(r);
                    else setBaixando(r);
                  }}
                  className={cn(
                    "border-b border-border transition-colors last:border-0 hover:bg-accent/40",
                    !cancelado && "cursor-pointer",
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
                      {/* Só os jobs, sem repetição. O contato de cobrança
                          mudou para o botão `i` em 31/08/2026. */}
                      <span className="font-mono text-[11.5px] text-muted-foreground text-pretty">
                        {r.jobs_cobertos.join("  ·  ")}
                      </span>
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
                    <div className="flex flex-col items-start gap-0.5">
                      <span
                        className={cn(
                          "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          cancelado
                            ? "border-border bg-muted text-muted-foreground"
                            : recebido
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : inadimplente
                                ? "border-[#fecaca] bg-[#fef2f2] text-[#b3323c]"
                                : "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
                        )}
                      >
                        {cancelado
                          ? "Cancelado"
                          : recebido
                            ? "Recebido"
                            : inadimplente
                              ? "Inadimplente"
                              : "Em aberto"}
                      </span>
                      {inadimplente && (
                        <span className="whitespace-nowrap text-[10.5px] font-bold text-[#b3323c]">
                          {diasDeAtraso(r.data_vencimento)}{" "}
                          {diasDeAtraso(r.data_vencimento) === 1
                            ? "dia de atraso"
                            : "dias de atraso"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {recebido ? (
                      <div className="flex items-center justify-end gap-2.5">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-[11.5px] text-muted-foreground">
                            Conciliação
                          </span>
                          <span className="whitespace-nowrap text-[11px] text-muted-foreground/80">
                            {r.conta_nome ?? "—"} · {r.centro_nome ?? "—"}
                          </span>
                        </div>
                        {/* Simetria com Títulos a Pagar (31/08/2026): a linha
                            baixada abre a baixa registrada, e é lá dentro
                            que mora o estorno, em dois tempos. */}
                        <button
                          type="button"
                          title="Ver a baixa registrada — e estornar, se preciso"
                          aria-label="Ver baixa registrada"
                          onClick={(e) => {
                            e.stopPropagation();
                            setErro(null);
                            setConferindo(r);
                          }}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
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
                        Dar baixa
                      </button>
                    )}
                  </td>
                  <td className="relative w-0 p-0">
                    <BotaoInfo
                      className="absolute left-3 top-1/2 h-[30px] w-[30px] -translate-y-1/2 shadow-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInfo(infoDoTitulo(r));
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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

      <BaixaRegistradaDialog
        open={conferindo !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConferindo(null);
            setErro(null);
          }
        }}
        alvo={alvoConferencia}
        pending={pending}
        erro={erro}
        sentido="receber"
        onEstornar={(motivo) => {
          const alvo = conferindo;
          if (!alvo) return;
          startTransition(async () => {
            const res = await estornarBaixaTitulo({
              titulo_id: alvo.id,
              motivo,
            });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setConferindo(null);
            setErro(null);
            setToast(
              `Baixa estornada · ${formatMoney(alvo.valor)} voltou para Em aberto.`,
            );
            router.refresh();
          });
        }}
      />

      <InfoFaturamentoModal
        info={info}
        onOpenChange={(aberto) => {
          if (!aberto) setInfo(null);
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
