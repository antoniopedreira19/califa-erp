"use client";

/**
 * A faixa "Cancelamentos" da fila da Abertura de Job (decisão 169): a linha
 * de cada pedido, o pop-up que o revisa, a recusa e a confirmação da
 * aprovação. Mesmo desenho da conferência da abertura
 * (`conferencia-dialog.tsx`) e da reprovação (`reprovar-dialog.tsx`).
 *
 * "Visualizar job" abre o job como em "Visualizar Jobs", já na Planilha
 * Interna. Enquanto o pop-up está aberto a URL da fila carrega
 * `?revisar=<job>`; o rastro do Voltar (decisão 108) guarda essa URL, e quem
 * volta do job encontra o mesmo pop-up aberto.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Ban,
  Briefcase,
  Check,
  CornerUpLeft,
  MessageSquare,
  Send,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import { formatDataAsHoraBr } from "./formatos";
import type { CancelamentoNaFila } from "./cancelamentos";
import { aprovarCancelamentoDoJob, recusarCancelamentoDoJob } from "./actions-cancelamento";
import {
  BotaoDaFila,
  CelulaCodigo,
  CelulaEnviado,
  CelulaGp,
  CelulaJob,
  CelulaProjeto,
  CLASSE_DA_CELULA,
  CLASSE_DA_LINHA,
  SeloDaFila,
} from "./fila-celulas";

/** Um pedido da faixa, com o "há 2 horas" pronto (calculado no servidor). */
export interface CancelamentoDaFila extends CancelamentoNaFila {
  enviado_em_label: string;
}

const MIN_TEXTO = 10;
const MAX_TEXTO = 500;

/** Grava (ou tira) o `?revisar=` da URL sem passar pelo router — o mesmo
 *  jeito com que as abas desta tela guardam a escolha. */
function marcarRevisaoNaUrl(jobId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (jobId) url.searchParams.set("revisar", jobId);
  else url.searchParams.delete("revisar");
  window.history.replaceState(null, "", url.toString());
}

/** Uma linha da faixa Cancelamentos — as colunas da fila. */
export function LinhaCancelamentoNaFila({
  c,
  onAbrir,
}: {
  c: CancelamentoDaFila;
  onAbrir: () => void;
}) {
  const abertoEm = c.abertoEm ? formatDataAsHoraBr(c.abertoEm).slice(0, 10) : null;
  return (
    <tr
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir();
        }
      }}
      className={CLASSE_DA_LINHA}
    >
      <td className={CLASSE_DA_CELULA}>
        <CelulaCodigo codigo={c.codigo} />
      </td>
      <td className={CLASSE_DA_CELULA}>
        <CelulaJob
          nome={c.nome}
          // A data saiu da pílula (14/10/2026) e ocupa o lugar do período.
          periodo={
            abertoEm ? (
              <>
                <span className="font-sans">aberto em</span> {abertoEm}
              </>
            ) : null
          }
          selo={
            <SeloDaFila
              tipo="cancelamento"
              dica={`Pedido de cancelamento${abertoEm ? ` · job aberto em ${abertoEm}` : ""}`}
            />
          }
        />
      </td>
      <td className={CLASSE_DA_CELULA}>
        <CelulaProjeto
          codigo={c.projetoCodigo}
          nome={c.projetoNome}
          cliente={[c.clienteNome, c.produto].filter(Boolean).join(" · ") || "—"}
        />
      </td>
      <td className={CLASSE_DA_CELULA}>
        <CelulaGp nome={c.responsavelNome} />
      </td>
      <td className={CLASSE_DA_CELULA}>
        <CelulaEnviado nome={c.pedido.solicitadoPorNome} quando={c.enviado_em_label} reenvio={false} />
      </td>
      <td className={`${CLASSE_DA_CELULA} whitespace-nowrap font-semibold tabular-nums`}>
        {formatCurrency(c.valorTotal)}
      </td>
      <td className={CLASSE_DA_CELULA}>
        <BotaoDaFila acao="cancelamento" onClick={onAbrir} />
      </td>
    </tr>
  );
}

/**
 * A revisão do pedido, com a recusa e a confirmação da aprovação por cima.
 * Recebe `null` com o pop-up fechado.
 */
export function RevisarCancelamentoDialog({
  c,
  onOpenChange,
}: {
  c: CancelamentoDaFila | null;
  onOpenChange: (aberto: boolean) => void;
}) {
  const [recusando, setRecusando] = React.useState(false);
  const [confirmando, setConfirmando] = React.useState(false);

  React.useEffect(() => {
    marcarRevisaoNaUrl(c ? c.jobId : null);
    if (c) {
      setRecusando(false);
      setConfirmando(false);
    }
  }, [c]);

  if (!c) return null;

  const dados: { rotulo: string; valor: string; mono?: boolean }[] = [
    { rotulo: "Job", valor: c.nome },
    { rotulo: "Código", valor: c.codigo, mono: true },
    { rotulo: "Projeto", valor: c.projetoNome ?? "—" },
    { rotulo: "Empresa", valor: c.empresaNome ?? "—" },
    { rotulo: "Cliente", valor: c.clienteNome ?? "—" },
    { rotulo: "GP Responsável", valor: c.responsavelNome ?? "—" },
    {
      rotulo: "Aberto em",
      valor: c.abertoEm
        ? `${formatDataAsHoraBr(c.abertoEm)}${c.abertoPorNome ? ` · ${c.abertoPorNome}` : ""}`
        : "—",
    },
    { rotulo: "Regional", valor: c.regionalNome ?? "—" },
  ];

  const desfaz: { rotulo: string; detalhe: string; valor: string }[] = [
    {
      rotulo: "Recebimento previsto",
      detalhe: "sai do fluxo de caixa",
      valor: formatCurrency(c.recebimentoPrevisto),
    },
    {
      rotulo: "Custo previsto",
      detalhe: "sai do fluxo de caixa e da rentabilidade",
      valor: formatCurrency(c.custoPrevisto),
    },
    {
      rotulo: "Impostos previstos",
      detalhe: "saem da previsão de impostos",
      valor: formatCurrency(c.impostosPrevistos),
    },
    ...(c.projetoFinanceiroCodigo
      ? [
          {
            rotulo: "Projeto financeiro",
            detalhe: c.projetoFinanceiroFicaInativo
              ? "fica inativo: só tinha este job"
              : "continua ativo: tem outros jobs",
            valor: c.projetoFinanceiroCodigo,
          },
        ]
      : []),
  ];

  const resumoPlanilha =
    c.planilha.itens > 0
      ? `${c.planilha.grupos} ${c.planilha.grupos === 1 ? "agrupamento" : "agrupamentos"} · ${c.planilha.itens} ${c.planilha.itens === 1 ? "item" : "itens"} · orçado ${formatCurrency(c.planilha.orcado)}`
      : "Planilha interna sem itens.";

  return (
    <>
      {!recusando && (
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent className="max-h-[88vh] max-w-[540px] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-start gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
                  <Ban className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1 pr-6">
                  <DialogTitle className="text-[19px]">
                    Cancelar o job <span className="whitespace-nowrap">{c.codigo}</span>?
                  </DialogTitle>
                  <DialogDescription className="pt-1.5 text-[13.5px] leading-relaxed">
                    Pedido da produção. Aprovado, o job sai do módulo de Jobs e das listas do financeiro,
                    e o orçamento fica como <strong className="text-foreground">Job cancelado</strong>.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex items-start gap-2.5 rounded-xl border border-california-red/15 bg-california-red/5 px-4 py-3 text-[13px] leading-relaxed">
              <Send className="mt-0.5 h-4 w-4 shrink-0 text-california-red" />
              <div className="min-w-0">
                <div>
                  <span className="text-muted-foreground">Solicitado por</span>{" "}
                  <strong className="font-semibold text-foreground">{c.pedido.solicitadoPorNome}</strong>{" "}
                  <span className="text-muted-foreground">
                    em {formatDataAsHoraBr(c.pedido.solicitadoEm)}
                  </span>
                </div>
                <div className="mt-0.5 whitespace-pre-wrap text-[12.5px] text-foreground">
                  “{c.pedido.motivo}”
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 rounded-xl border border-border px-4 py-4">
              {dados.map((d) => (
                <div key={d.rotulo} className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-muted-foreground">{d.rotulo}</span>
                  <span
                    className={
                      d.mono
                        ? "text-right font-mono text-[13px] font-semibold"
                        : "text-right text-[13px] font-semibold"
                    }
                  >
                    {d.valor}
                  </span>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
                <span className="text-[13px] font-semibold">Valor total</span>
                <span className="font-mono text-base font-bold">{formatCurrency(c.valorTotal)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-[12.5px] font-semibold">O que o cancelamento desfaz</p>
              <div className="space-y-2 rounded-lg border border-border bg-muted px-3.5 py-3 text-[12.5px] leading-relaxed">
                {desfaz.map((l) => (
                  <div key={l.rotulo} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-foreground">
                      {l.rotulo} <span className="text-muted-foreground">· {l.detalhe}</span>
                    </span>
                    <span className="shrink-0 font-mono font-semibold">{l.valor}</span>
                  </div>
                ))}
              </div>
              <p className="px-0.5 text-[11.5px] text-muted-foreground">
                Nada é apagado: o job, as PPs e as previsões ficam guardados como histórico.
              </p>
            </div>

            {/* O job como o financeiro o abre em "Visualizar Jobs", já na
                Planilha Interna. O Voltar de lá traz de volta a este pop-up
                (o `?revisar=` da URL). */}
            <Link
              href={`/financeiro/jobs/${c.jobId}?aba=planilha&revisar=${c.jobId}`}
              prefetch={false}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/50 px-4 py-3 text-left transition-colors hover:border-california-red/50 hover:bg-california-red/5"
            >
              <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-border bg-white text-california-red">
                <Briefcase className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">Visualizar job</p>
                <p className="text-[11.5px] text-muted-foreground">Abre na Planilha Interna · {resumoPlanilha}</p>
              </div>
              <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setRecusando(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold text-california-red transition-colors hover:border-california-red hover:bg-california-red/5"
              >
                <CornerUpLeft className="h-4 w-4" />
                Recusar
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-[18px] py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-california-red-hover"
              >
                <Check className="h-4 w-4" />
                Aprovar cancelamento
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {confirmando && (
        <ConfirmarAprovacaoDialog
          c={c}
          onVoltar={() => setConfirmando(false)}
          onAprovado={() => {
            setConfirmando(false);
            onOpenChange(false);
          }}
        />
      )}

      {recusando && (
        <RecusarCancelamentoDialog
          c={c}
          onVoltar={() => setRecusando(false)}
          onRecusado={() => {
            setRecusando(false);
            onOpenChange(false);
          }}
        />
      )}
    </>
  );
}

/** A confirmação da aprovação, com a observação que vai ao rastro do
 *  orçamento — só aqui, e não na revisão (pedido do Tiago, 13/10/2026). */
function ConfirmarAprovacaoDialog({
  c,
  onVoltar,
  onAprovado,
}: {
  c: CancelamentoDaFila;
  onVoltar: () => void;
  onAprovado: () => void;
}) {
  const router = useRouter();
  const [observacao, setObservacao] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function aprovar() {
    setErro(null);
    startTransition(async () => {
      const res = await aprovarCancelamentoDoJob(c.pedido.id, observacao.trim());
      if (!res.ok) {
        setErro(res.message);
        router.refresh();
        return;
      }
      onAprovado();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onVoltar()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-california-red/10 text-california-red">
            <Ban className="h-5 w-5" />
          </div>
          <DialogTitle className="pt-4 text-[19px]">
            Aprovar o cancelamento de <span className="whitespace-nowrap">{c.codigo}</span>?
          </DialogTitle>
          <DialogDescription className="text-[13.5px] leading-relaxed">
            O job deixa o módulo de Jobs e as listas do financeiro, e as previsões saem do fluxo de caixa. O
            sistema não desfaz o cancelamento.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2.5">
            <label htmlFor="obs-cancelamento" className="text-[12.5px] font-semibold">
              Observação <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <span className="font-mono text-[11px] text-muted-foreground">
              {observacao.length}/{MAX_TEXTO}
            </span>
          </div>
          <textarea
            id="obs-cancelamento"
            value={observacao}
            onChange={(ev) => setObservacao(ev.target.value.slice(0, MAX_TEXTO))}
            rows={3}
            className="min-h-[88px] w-full resize-y rounded-lg border border-border bg-white px-3.5 py-3 text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-california-red/20"
            placeholder="Fica no histórico do orçamento, junto do motivo da produção."
          />
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
            onClick={onVoltar}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={aprovar}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check className="h-4 w-4" />
            {pending ? "Cancelando..." : "Sim, cancelar o job"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecusarCancelamentoDialog({
  c,
  onVoltar,
  onRecusado,
}: {
  c: CancelamentoDaFila;
  onVoltar: () => void;
  onRecusado: () => void;
}) {
  const router = useRouter();
  const [justificativa, setJustificativa] = React.useState("");
  const [tentou, setTentou] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const curto = justificativa.trim().length < MIN_TEXTO;

  function enviar() {
    setTentou(true);
    if (curto) return;
    setErro(null);
    startTransition(async () => {
      const res = await recusarCancelamentoDoJob(c.pedido.id, justificativa.trim());
      if (!res.ok) {
        setErro(res.message);
        router.refresh();
        return;
      }
      onRecusado();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onVoltar()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-california-red/10 text-california-red">
            <CornerUpLeft className="h-5 w-5" />
          </div>
          <DialogTitle className="pt-4 text-[19px]">
            Recusar o cancelamento de <span className="whitespace-nowrap">{c.codigo}</span>?
          </DialogTitle>
          <DialogDescription className="text-[13.5px] leading-relaxed">
            Escreva por que o job deve continuar. A justificativa aparece na página do job, para a produção.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2.5">
            <label htmlFor="motivo-recusa-cancelamento" className="text-[12.5px] font-semibold">
              Justificativa <span className="text-california-red">*</span>
            </label>
            <span className="font-mono text-[11px] text-muted-foreground">
              {justificativa.length}/{MAX_TEXTO}
            </span>
          </div>
          <textarea
            id="motivo-recusa-cancelamento"
            value={justificativa}
            onChange={(ev) => {
              setJustificativa(ev.target.value.slice(0, MAX_TEXTO));
              setTentou(false);
            }}
            rows={4}
            className={cn(
              "min-h-[104px] w-full resize-y rounded-lg border bg-white px-3.5 py-3 text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-california-red/20",
              tentou && curto ? "border-california-red" : "border-border",
            )}
            placeholder="Ex.: há uma nota de serviço já combinada com o cliente para este job. Fale comigo antes de cancelar."
          />
          {tentou && curto && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-california-red">
              <AlertCircle className="h-3 w-3" />
              Escreva a justificativa com pelo menos {MIN_TEXTO} caracteres.
            </span>
          )}
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3">
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Solicitado por <strong className="text-foreground">{c.pedido.solicitadoPorNome}</strong> em{" "}
            {formatDataAsHoraBr(c.pedido.solicitadoEm)}. O job volta a{" "}
            <strong className="text-foreground">Aberto</strong>, com PP, errata e faturamento liberados.
          </p>
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
            onClick={onVoltar}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={enviar}
            disabled={pending || curto}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Send className="h-4 w-4" />
            {pending ? "Enviando..." : "Enviar justificativa"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
