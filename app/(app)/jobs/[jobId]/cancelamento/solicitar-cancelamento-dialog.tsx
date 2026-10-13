"use client";

/**
 * O pop-up do pedido de cancelamento do job aberto (decisão 169).
 *
 * O que trava o pedido aparece antes do motivo, no mesmo quadro vermelho da
 * decisão 143:
 *   * PP paga — não se desfaz pelo sistema; fale com o financeiro;
 *   * PP aprovada — só o financeiro reprova;
 *   * PP gerada, em avaliação ou rejeitada — a produção cancela daqui mesmo,
 *     num "Tem certeza?" por cima (dois passos, como na 143);
 *   * o resto (envio para faturamento, lançamento, recebimento antes da NF,
 *     desembolso, save) vem pronto do banco (`trava_do_cancelamento_do_job`).
 *
 * O botão de enviar fica travado enquanto houver trava; o banco confere de
 * novo no pedido e outra vez na aprovação.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Ban, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency } from "@/lib/utils";
import {
  cancelarPPsDoPedidoDeCancelamento,
  solicitarCancelamentoDoJob,
} from "../actions-cancelamento";

const MIN_MOTIVO = 10;
const MAX_MOTIVO = 500;

/** Uma PP do job, como o pop-up a mostra. */
export interface PPDoPedido {
  id: string;
  codigo: string;
  /** Fornecedor, ou "Verba de produção". */
  quem: string;
  valor: number;
  status: "gerada" | "em_avaliacao" | "rejeitada" | "aprovada" | "pago";
}

const ROTULO_DO_STATUS: Record<PPDoPedido["status"], string> = {
  gerada: "gerada",
  em_avaliacao: "em avaliação",
  rejeitada: "rejeitada",
  aprovada: "aprovada",
  pago: "paga",
};

/** "a PP-00100", "a PP-00100 e a PP-00101", "a PP-00100, a PP-00101 e a PP-00102". */
function listaDeCodigos(codigos: string[]): string {
  const comArtigo = codigos.map((c) => `a ${c}`);
  if (comArtigo.length <= 1) return comArtigo.join("");
  return `${comArtigo.slice(0, -1).join(", ")} e ${comArtigo[comArtigo.length - 1]}`;
}

function LinhasDePP({ pps }: { pps: PPDoPedido[] }) {
  return (
    <span className="mt-1.5 block space-y-0.5">
      {pps.map((pp) => (
        <span key={pp.id} className="block">
          <span className="font-mono font-semibold">{pp.codigo}</span>
          {" · "}
          {pp.quem}
          {" · "}
          <span className="font-mono">{formatCurrency(pp.valor)}</span>
          {" · "}
          {ROTULO_DO_STATUS[pp.status]}
        </span>
      ))}
    </span>
  );
}

export function SolicitarCancelamentoDialog({
  open,
  onOpenChange,
  jobId,
  jobCodigo,
  pps,
  travaForaDasPPs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobCodigo: string;
  /** As PPs do job fora de `cancelada`. */
  pps: PPDoPedido[];
  /** A trava do banco que não é de PP (faturamento, lançamento, save…),
   *  ou nula. */
  travaForaDasPPs: string | null;
}) {
  const router = useRouter();
  const [motivo, setMotivo] = React.useState("");
  const [tentou, setTentou] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // O "Tem certeza?" das PPs, por cima (decisão 143).
  const [confirmandoPPs, setConfirmandoPPs] = React.useState(false);
  const [erroPPs, setErroPPs] = React.useState<string | null>(null);
  const [cancelandoPPs, startCancelarPPs] = React.useTransition();
  // Entre o "ok" e a lista nova chegar pelo refresh, o pop-up de cima fica
  // em "processando" — sem isto ele ofereceria de novo PPs já canceladas.
  const [concluindo, setConcluindo] = React.useState(false);
  const chaveDaLista = pps.map((pp) => pp.id).join(",");
  const chaveAnterior = React.useRef(chaveDaLista);
  React.useEffect(() => {
    if (chaveAnterior.current === chaveDaLista) return;
    chaveAnterior.current = chaveDaLista;
    if (concluindo) {
      setConcluindo(false);
      setConfirmandoPPs(false);
    }
  }, [chaveDaLista, concluindo]);

  React.useEffect(() => {
    if (open) {
      setMotivo("");
      setTentou(false);
      setErro(null);
    }
  }, [open]);

  const pagas = pps.filter((pp) => pp.status === "pago");
  const aprovadas = pps.filter((pp) => pp.status === "aprovada");
  const aCancelar = pps.filter(
    (pp) => pp.status === "gerada" || pp.status === "em_avaliacao" || pp.status === "rejeitada",
  );
  const travaDoBanco = pps.length === 0 ? travaForaDasPPs : null;
  const travado = pps.length > 0 || travaDoBanco !== null;
  const curto = motivo.trim().length < MIN_MOTIVO;
  const uma = aCancelar.length === 1;

  function enviar() {
    setTentou(true);
    if (curto || travado) return;
    setErro(null);
    startTransition(async () => {
      const res = await solicitarCancelamentoDoJob(jobId, motivo.trim());
      if (!res.ok) {
        setErro(res.message);
        router.refresh();
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  function cancelarPPs() {
    setErroPPs(null);
    startCancelarPPs(async () => {
      const res = await cancelarPPsDoPedidoDeCancelamento(
        jobId,
        aCancelar.map((pp) => pp.id),
      );
      if (!res.ok) {
        setErroPPs(res.message);
        router.refresh();
        return;
      }
      setConcluindo(true);
      router.refresh();
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <div className="flex items-start gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
                <Ban className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 pr-6">
                <DialogTitle className="text-[19px]">
                  Solicitar o cancelamento de <span className="whitespace-nowrap">{jobCodigo}</span>?
                </DialogTitle>
                <DialogDescription className="pt-1.5 text-[13.5px] leading-relaxed">
                  O financeiro decide na Abertura de Job. Até lá, o job fica parado: sem PP nova, errata
                  nem envio para faturamento.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {pagas.length > 0 && (
            <div className="rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2.5 text-xs text-california-red">
              {pagas.length === 1
                ? `A ${pagas[0].codigo} já foi paga: job com pagamento feito não se cancela pelo sistema. Fale com o financeiro.`
                : `${pagas.length} PPs já foram pagas: job com pagamento feito não se cancela pelo sistema. Fale com o financeiro.`}
              <LinhasDePP pps={pagas} />
            </div>
          )}
          {aprovadas.length > 0 && (
            <div className="rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2.5 text-xs text-california-red">
              {aprovadas.length === 1
                ? `A ${aprovadas[0].codigo} já foi aprovada pelo financeiro: só ele a reprova. Peça a reprovação antes.`
                : `${aprovadas.length} PPs já foram aprovadas pelo financeiro: só ele as reprova. Peça a reprovação antes.`}
              <LinhasDePP pps={aprovadas} />
            </div>
          )}
          {aCancelar.length > 0 && (
            <div className="rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2.5 text-xs text-california-red">
              {uma
                ? "Antes, a PP do job precisa ser cancelada:"
                : `Antes, as ${aCancelar.length} PPs do job precisam ser canceladas:`}
              <LinhasDePP pps={aCancelar} />
              <button
                type="button"
                onClick={() => {
                  setErroPPs(null);
                  setConfirmandoPPs(true);
                }}
                className="mt-2.5 inline-flex items-center rounded-lg border border-california-red/40 bg-white px-3 py-1.5 text-xs font-semibold text-california-red transition-colors hover:bg-california-red/5"
              >
                {uma ? "Cancelar a PP" : `Cancelar as ${aCancelar.length} PPs`}
              </button>
            </div>
          )}
          {travaDoBanco && (
            <div className="rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2.5 text-xs text-california-red">
              {travaDoBanco}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2.5">
              <label htmlFor="motivo-cancelamento" className="text-[12.5px] font-semibold">
                Motivo do cancelamento <span className="text-california-red">*</span>
              </label>
              <span className="font-mono text-[11px] text-muted-foreground">
                {motivo.length}/{MAX_MOTIVO}
              </span>
            </div>
            <textarea
              id="motivo-cancelamento"
              value={motivo}
              onChange={(ev) => {
                setMotivo(ev.target.value.slice(0, MAX_MOTIVO));
                setTentou(false);
              }}
              rows={4}
              className={cn(
                "min-h-[104px] w-full resize-y rounded-lg border bg-white px-3.5 py-3 text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-california-red/20",
                tentou && curto ? "border-california-red" : "border-border",
              )}
              placeholder="Ex.: o cliente cancelou o lançamento e a ação não vai acontecer. Combinado com ele por e-mail."
            />
            {tentou && curto && (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-california-red">
                <AlertCircle className="h-3 w-3" />
                Escreva o motivo com pelo menos {MIN_MOTIVO} caracteres.
              </span>
            )}
          </div>

          {erro && (
            <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={enviar}
              disabled={pending || travado || curto}
              title={travado ? "Resolva o que está acima antes de enviar" : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Send className="h-4 w-4" />
              {pending ? "Enviando..." : "Enviar ao financeiro"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmandoPPs}
        onOpenChange={(o) => !o && !cancelandoPPs && !concluindo && setConfirmandoPPs(false)}
        title={uma ? `Cancelar a ${aCancelar[0]?.codigo ?? "PP"}?` : `Cancelar as ${aCancelar.length} PPs?`}
        description={
          <>
            Tem certeza?{" "}
            {uma
              ? `A ${aCancelar[0]?.codigo} será cancelada.`
              : (() => {
                  const l = listaDeCodigos(aCancelar.map((pp) => pp.codigo));
                  return `${l.charAt(0).toUpperCase()}${l.slice(1)} serão canceladas.`;
                })()}{" "}
            O PDF e os anexos ficam guardados no histórico.
            <span className="mt-3 block">Depois você volta ao pop-up anterior para enviar o pedido.</span>
            {erroPPs && <span className="mt-3 block text-xs text-california-red">{erroPPs}</span>}
          </>
        }
        confirmLabel={uma ? "Sim, cancelar a PP" : "Sim, cancelar as PPs"}
        cancelLabel="Voltar"
        pending={cancelandoPPs || concluindo}
        onConfirm={cancelarPPs}
      />
    </>
  );
}
