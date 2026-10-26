"use client";

/**
 * O fechamento da conciliação na tela (task 029, fase 4, decisão 205),
 * portado do protótipo aprovado (`banco.jsx`: `BannerDoFechamento`,
 * `ReabrirDialog` e o botão de fechar de `AbaBancoRecomendada`):
 *
 * - a faixa no topo das três abas da conta: fechada (o caixa travado, com
 *   "Reabrir o período") ou reaberta (o motivo, o histórico e "Fechar de
 *   novo até dd/mm");
 * - na Conciliação automática, o botão "Fechar a conciliação até dd/mm",
 *   que só liga com as três condições, e "Reabrir o período";
 * - o reabrir pede o motivo, com pelo menos 10 caracteres.
 *
 * As condições e a trava são do banco; a tela só mostra e chama.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCheck, Lock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dataBR } from "@/components/financeiro/planilha-de-titulos/planilha";
import {
  botaoDoFechamento,
  diaMes,
  eventosDoHistorico,
  linhaDoHistorico,
  type FechamentoDaConta,
} from "@/lib/conciliacao/fechamento";
import { fecharConciliacao, reabrirConciliacao } from "./actions-fechamento";

type Aviso = { tom: "ok" | "erro"; texto: string };

const VARIANTES = {
  escuro: "bg-[#282828] text-white hover:bg-black",
  contorno: "border border-border bg-white text-foreground hover:bg-muted/50",
  contornoVermelho: "border border-california-red/40 bg-white text-california-red hover:bg-california-red/5",
  primario: "bg-california-red text-white hover:bg-california-red-hover",
} as const;

function Botao({
  children,
  onClick,
  variante,
  disabled,
  title,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variante: keyof typeof VARIANTES;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTES[variante],
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Fechar e reabrir, com o aviso do resultado e a página relida. */
function useAcoesDoFechamento(contaId: string, contaNome: string) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [aviso, setAviso] = React.useState<Aviso | null>(null);

  React.useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 7000);
    return () => clearTimeout(t);
  }, [aviso]);

  function fechar(ate: string) {
    setAviso(null);
    startTransition(async () => {
      const r = await fecharConciliacao(contaId, ate);
      setAviso(
        r.ok
          ? {
              tom: "ok",
              texto: `Conciliação da ${contaNome} fechada até ${dataBR(ate)}. Lançamento até essa data só muda reabrindo o período.`,
            }
          : { tom: "erro", texto: r.message },
      );
      router.refresh();
    });
  }

  /** Devolve a mensagem de erro, ou `null` quando reabriu. */
  function reabrir(motivo: string, ate: string, depois: (erro: string | null) => void) {
    startTransition(async () => {
      const r = await reabrirConciliacao(contaId, motivo);
      if (!r.ok) {
        depois(r.message);
        return;
      }
      depois(null);
      setAviso({ tom: "ok", texto: `Período até ${dataBR(ate)} reaberto. O motivo ficou na auditoria.` });
      router.refresh();
    });
  }

  const avisoNaTela = aviso && (
    <div
      role="status"
      className={cn(
        "fixed bottom-6 right-6 z-50 flex max-w-[600px] items-center gap-3 rounded-xl border px-4 py-3 shadow-elevated",
        aviso.tom === "ok" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50",
      )}
    >
      {aviso.tom === "ok" ? (
        <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0 text-california-red" />
      )}
      <span className={cn("text-sm font-semibold", aviso.tom === "ok" ? "text-emerald-900" : "text-red-900")}>{aviso.texto}</span>
      <button
        type="button"
        onClick={() => setAviso(null)}
        aria-label="Fechar aviso"
        className={aviso.tom === "ok" ? "text-emerald-700 hover:text-emerald-900" : "text-california-red hover:text-red-900"}
      >
        ×
      </button>
    </div>
  );

  return { pending, fechar, reabrir, avisoNaTela };
}

// ---------------------------------------------------------------------------
// A faixa do fechamento (protótipo: `BannerDoFechamento`)
// ---------------------------------------------------------------------------

export function FaixaDoFechamento({
  contaId,
  contaNome,
  bancoNome,
  fechamento,
}: {
  contaId: string;
  contaNome: string;
  bancoNome: string;
  fechamento: FechamentoDaConta;
}) {
  const { pending, fechar, reabrir, avisoNaTela } = useAcoesDoFechamento(contaId, contaNome);
  const [reabrindo, setReabrindo] = React.useState(false);
  const ultimo = fechamento.ultimo;
  if (!ultimo) return null;
  const historico = linhaDoHistorico(fechamento.registros);

  const reabrirDialog = reabrindo && fechamento.ativo && (
    <ReabrirDialog
      ate={fechamento.ativo.ate}
      contaNome={contaNome}
      bancoNome={bancoNome}
      pending={pending}
      onFechar={() => setReabrindo(false)}
      onConfirmar={(motivo, depois) => reabrir(motivo, fechamento.ativo?.ate ?? "", depois)}
    />
  );

  if (!fechamento.ativo) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <Unlock className="h-4 w-4 shrink-0" />
          <span className="min-w-[280px] flex-1">
            <strong>Período reaberto</strong> em {formatDiaBr(ultimo.reabertoEm)} por {ultimo.reabertoPor ?? "—"}: “
            {ultimo.motivo}”. Os lançamentos até {dataBR(ultimo.ate)} voltaram a poder mudar. Feche de novo quando terminar.
            <span className="mt-0.5 block text-amber-800/70">Histórico: {historico}</span>
          </span>
          <Botao variante="escuro" disabled={pending} onClick={() => fechar(ultimo.ate)}>
            <Lock className="h-4 w-4" />
            Fechar de novo até {dataBR(ultimo.ate)}
          </Botao>
        </div>
        {avisoNaTela}
      </>
    );
  }

  const ativo = fechamento.ativo;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-xs text-slate-800">
        <Lock className="h-4 w-4 shrink-0" />
        <span className="min-w-[280px] flex-1">
          <strong>Conciliação fechada até {dataBR(ativo.ate)}</strong> · por {ativo.fechadoPor} em {formatDiaBr(ativo.fechadoEm)}.
          O caixa desta conta até essa data não muda (o Extrato e o DFC): baixa, cancelamento, estorno e troca de data ou de
          centro de custo pedem reabrir o período. O DRE, por competência, tem fechamento próprio.
          {eventosDoHistorico(fechamento.registros) > 1 && <span className="mt-0.5 block opacity-70">Histórico: {historico}</span>}
        </span>
        <Botao variante="contornoVermelho" disabled={pending} onClick={() => setReabrindo(true)}>
          <Unlock className="h-4 w-4" />
          Reabrir o período
        </Botao>
      </div>
      {reabrirDialog}
      {avisoNaTela}
    </>
  );
}

// ---------------------------------------------------------------------------
// O botão de fechar, na Conciliação automática
// ---------------------------------------------------------------------------

export function BotoesDoFechamento({
  contaId,
  contaNome,
  bancoNome,
  fechamento,
  ocupado,
}: {
  contaId: string;
  contaNome: string;
  bancoNome: string;
  fechamento: FechamentoDaConta;
  /** A aba está trabalhando (uma ação, a automação da importação). */
  ocupado: boolean;
}) {
  const { pending, fechar, reabrir, avisoNaTela } = useAcoesDoFechamento(contaId, contaNome);
  const [reabrindo, setReabrindo] = React.useState(false);
  const ativo = fechamento.ativo;
  const b = botaoDoFechamento(fechamento.condicoes, ativo?.ate ?? null);
  const ate = b.ate;

  const dica = b.jaFechada
    ? undefined
    : `Fecha até ${ate ? dataBR(ate) : "—"}, o último dia completo dos extratos importados (o dia em que o arquivo foi gerado não conta). Disponível quando as linhas até lá estiverem conciliadas, nenhuma baixa estiver fora do banco e o saldo desse dia bater.${
        b.faltas.length ? ` Falta: ${b.faltas.join("; ")}.` : ""
      }`;

  return (
    <>
      <Botao
        className="ml-auto"
        variante={b.podeFechar ? "escuro" : "contorno"}
        disabled={!b.podeFechar || pending || ocupado}
        title={dica}
        onClick={() => ate && fechar(ate)}
      >
        <Lock className="h-4 w-4" />
        {b.jaFechada && ativo
          ? `Conciliação fechada até ${dataBR(ativo.ate)}`
          : `Fechar a conciliação até ${ate ? dataBR(ate) : "—"}`}
      </Botao>
      {ativo && (
        <Botao variante="contornoVermelho" disabled={pending || ocupado} onClick={() => setReabrindo(true)}>
          <Unlock className="h-4 w-4" />
          Reabrir o período
        </Botao>
      )}
      {reabrindo && ativo && (
        <ReabrirDialog
          ate={ativo.ate}
          contaNome={contaNome}
          bancoNome={bancoNome}
          pending={pending}
          onFechar={() => setReabrindo(false)}
          onConfirmar={(motivo, depois) => reabrir(motivo, ativo.ate, depois)}
        />
      )}
      {avisoNaTela}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reabrir o período (protótipo: `ReabrirDialog`)
// ---------------------------------------------------------------------------

function ReabrirDialog({
  ate,
  contaNome,
  bancoNome,
  pending,
  onFechar,
  onConfirmar,
}: {
  ate: string;
  contaNome: string;
  bancoNome: string;
  pending: boolean;
  onFechar: () => void;
  onConfirmar: (motivo: string, depois: (erro: string | null) => void) => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Unlock className="h-4 w-4 text-california-red" />
            Reabrir a conciliação até {diaMes(ate)}
          </DialogTitle>
          <DialogDescription>
            {contaNome}
            {bancoNome ? ` · ${bancoNome}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-900">
          Os lançamentos desta conta até {dataBR(ate)} voltam a aceitar baixa, cancelamento, estorno e troca de data ou de
          centro de custo. A conciliação precisa ser fechada de novo. A reabertura, com o motivo, fica registrada na auditoria.
        </div>
        <div className="space-y-1">
          <label htmlFor="reabrir-motivo" className="text-xs font-semibold">
            Motivo <span className="text-california-red">*</span>
          </label>
          <textarea
            id="reabrir-motivo"
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              setErro(null);
            }}
            rows={3}
            placeholder="Ex.: a baixa do frete de 19/10 foi feita na conta errada"
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-california-red focus:outline-none"
          />
        </div>
        <DialogFooter className="items-center gap-2">
          {erro && <p className="mr-auto text-xs font-semibold text-california-red">{erro}</p>}
          <Botao variante="contorno" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="primario"
            disabled={pending}
            onClick={() => {
              if (motivo.trim().length < 10) {
                setErro("Explique o motivo (pelo menos 10 caracteres).");
                return;
              }
              onConfirmar(motivo.trim(), (e) => {
                if (e) setErro(e);
                else onFechar();
              });
            }}
          >
            {pending ? "Reabrindo…" : "Reabrir o período"}
          </Botao>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
