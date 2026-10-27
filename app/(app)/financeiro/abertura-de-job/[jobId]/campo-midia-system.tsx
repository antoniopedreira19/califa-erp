"use client";

/**
 * A Mídia System no "Registro no financeiro" (decisão 216): a caixa que o
 * financeiro marca na abertura (ou no "Editar registro") e, no job aberto,
 * o estado da auditoria com o botão "Liberar NFs".
 *
 * O botão mora aqui, e não na faixa do topo, porque é onde a marcação foi
 * feita, e a aba "Abertura do Job" só o financeiro vê (escolha do Tiago no
 * protótipo, 26/10/2026). Liberar não passa pelo "Editar registro": não é
 * revisão do registro, é o fim da auditoria.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PPStatusChip } from "@/app/(app)/jobs/[jobId]/pps/pp-status-chip";
import { cn, formatCurrency } from "@/lib/utils";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import type { PPStatus } from "@/lib/types";
import type { SituacaoMidia } from "@/lib/calculos/midia-system";
import { liberarNfsMidiaSystem } from "../actions-midia-system";

/** Uma PP que foi sem NF na auditoria, como a confirmação lista. */
export interface PPSemNfNaAuditoria {
  id: string;
  codigo: string;
  item: string | null;
  fornecedor: string | null;
  status: PPStatus;
  valor: number;
  situacao: SituacaoMidia;
}

/** O que o campo precisa além da caixa. Na fila: liberação nula e lista
 *  vazia — o job ainda não tem PP no financeiro. */
export interface MidiaSystemNaAbertura {
  liberadoEm: string | null;
  liberadoPorNome: string | null;
  pps: PPSemNfNaAuditoria[];
}

export const MIDIA_SYSTEM_NA_FILA: MidiaSystemNaAbertura = { liberadoEm: null, liberadoPorNome: null, pps: [] };

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function resumoDaAuditoria(info: MidiaSystemNaAbertura): string {
  if (!info.liberadoEm) {
    if (info.pps.length === 0) return "Nenhuma PP foi sem NF até agora.";
    const total = info.pps.reduce((s, p) => s + p.valor, 0);
    return `${plural(info.pps.length, "PP sem NF", "PPs sem NF")} · ${formatCurrency(total)}`;
  }
  const aguardando = info.pps.filter((p) => p.situacao === "aguardando" || p.situacao === "reprovada").length;
  const emAvaliacao = info.pps.filter((p) => p.situacao === "em_avaliacao").length;
  const partes = [
    aguardando > 0 ? `${aguardando} aguardando prestação` : null,
    emAvaliacao > 0 ? `${emAvaliacao} em avaliação` : null,
  ].filter(Boolean);
  return `Liberadas em ${formatDiaBr(info.liberadoEm)}${info.liberadoPorNome ? ` por ${info.liberadoPorNome}` : ""}${
    partes.length ? ` · ${partes.join(" · ")}` : ""
  }`;
}

export function CampoMidiaSystem({
  modo,
  travado,
  marcado,
  marcadoNoRegistro,
  onMarcar,
  info,
  jobId,
  jobCodigo,
}: {
  modo: string;
  travado: boolean;
  /** A caixa como está na tela. */
  marcado: boolean;
  /** Como está gravado — a trava da edição olha o gravado, não a tela. */
  marcadoNoRegistro: boolean;
  onMarcar: (v: boolean) => void;
  info: MidiaSystemNaAbertura;
  jobId: string;
  jobCodigo: string;
}) {
  const id = React.useId();
  const naFila = modo === "abertura";
  // Na edição, a caixa não volta atrás depois que a auditoria andou. O
  // banco confere de novo (`jobs_guarda_midia_system`).
  const trava =
    !naFila && !travado && marcadoNoRegistro
      ? info.liberadoEm
        ? "As NFs já foram liberadas: a marcação não muda mais."
        : info.pps.some((p) => p.situacao === "sem_nf")
          ? "Já há PPs sem NF: para encerrar a auditoria, use “Liberar NFs”."
          : null
      : null;
  const editavel = !travado && !trava;

  const texto = editavel
    ? "Job auditado pelo cliente: as PPs podem ir ao financeiro sem NF até o financeiro liberar as notas."
    : trava
      ? trava
      : marcado
        ? resumoDaAuditoria(info)
        : "Job sem auditoria da Mídia System: as PPs vão com a NF.";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-3 md:col-span-2",
        marcado ? "border-cyan-200 bg-cyan-50/40" : "border-border bg-white",
      )}
    >
      <Checkbox
        id={id}
        checked={marcado}
        disabled={!editavel}
        onCheckedChange={(v) => onMarcar(v === true)}
        className="h-[18px] w-[18px] rounded-[5px]"
      />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className={cn("flex flex-wrap items-center gap-2 text-[12.5px] font-semibold", editavel && "cursor-pointer")}
        >
          Mídia System
          {travado && marcado && (
            info.liberadoEm ? (
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-px text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                NFs liberadas
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-dashed border-amber-400 bg-amber-50 px-2 py-px text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                Auditoria em andamento
              </span>
            )
          )}
        </label>
        <p className={cn("mt-0.5 text-[11.5px]", trava ? "text-amber-800" : "text-muted-foreground")}>{texto}</p>
      </div>
      {travado && marcado && !info.liberadoEm && (
        <BotaoLiberarNfs jobId={jobId} jobCodigo={jobCodigo} pps={info.pps} />
      )}
    </div>
  );
}

/** "Liberar NFs" e a confirmação com as PPs que foram sem NF. */
function BotaoLiberarNfs({
  jobId,
  jobCodigo,
  pps,
}: {
  jobId: string;
  jobCodigo: string;
  pps: PPSemNfNaAuditoria[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const total = pps.reduce((s, p) => s + p.valor, 0);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setErro(null);
          setAberto(true);
        }}
        className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg bg-california-red px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-california-red-hover"
      >
        <Receipt className="h-4 w-4" />
        Liberar NFs
      </button>
      <ConfirmDialog
        open={aberto}
        onOpenChange={(o) => !pending && setAberto(o)}
        title={`Liberar as NFs do ${jobCodigo}?`}
        contentClassName="sm:max-w-[560px]"
        variant="primary"
        confirmLabel="Liberar NFs"
        cancelLabel="Voltar"
        pending={pending}
        description={
          <div className="space-y-3">
            <p className="leading-relaxed">
              A auditoria da Mídia System terminou. As PPs que foram sem NF entram na prestação de contas. As
              próximas PPs voltam a exigir a NF no envio.
            </p>
            {pps.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-border text-foreground">
                <table className="w-full table-fixed border-collapse text-[12.5px]">
                  <colgroup>
                    <col className="w-[86px]" />
                    <col />
                    <col className="w-[108px]" />
                    <col className="w-[124px]" />
                  </colgroup>
                  <tbody>
                    {pps.map((pp) => (
                      <tr key={pp.id} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2 align-middle font-mono text-[11.5px]">{pp.codigo}</td>
                        <td className="px-1 py-2 align-middle">
                          <span className="block truncate font-semibold">{pp.item ?? "—"}</span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">
                            {pp.fornecedor ?? "—"}
                          </span>
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <PPStatusChip status={pp.status} />
                        </td>
                        <td className="px-3 py-2 text-right align-middle font-mono font-semibold tabular-nums">
                          {formatCurrency(pp.valor)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/50">
                      <td
                        colSpan={3}
                        className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground"
                      >
                        {plural(pps.length, "PP sem NF", "PPs sem NF")}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold tabular-nums">{formatCurrency(total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-xs">
                Nenhuma PP foi sem NF: liberar só faz as próximas voltarem a exigir a nota.
              </p>
            )}
            {erro && (
              <p className="rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2 text-xs text-california-red">
                {erro}
              </p>
            )}
          </div>
        }
        onConfirm={() => {
          setErro(null);
          startTransition(async () => {
            const res = await liberarNfsMidiaSystem(jobId);
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setAberto(false);
            router.refresh();
          });
        }}
      />
    </>
  );
}
