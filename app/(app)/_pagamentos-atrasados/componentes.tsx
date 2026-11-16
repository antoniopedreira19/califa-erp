"use client";

/**
 * As peças de tela dos pagamentos atrasados (decisão 259).
 *
 * Toda sinalização do atraso é vermelha (#b91c1c), como o relógio da linha,
 * os botões e os selos. Os textos da liberação e da conclusão vão no plural
 * ("Liberar pagamentos atrasados", "Concluir pagamentos atrasados"); o que
 * fala de UMA PP fica no singular ("Nova PP de pagamento atrasado").
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Clock, FilePenLine, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import {
  competenciaCurta,
  competenciaLonga,
  dicaDaLiberacao,
  dicaDaPPAtrasada,
  frase,
  type LiberacaoPagamentosAtrasados,
} from "@/lib/pagamentos-atrasados";
import {
  cancelarConclusaoDosPagamentosAtrasados,
  concluirPagamentosAtrasados,
  lerConclusaoDosPagamentosAtrasados,
  liberarPagamentosAtrasados,
  pedirConclusaoDosPagamentosAtrasados,
  type ConclusaoDosPagamentosAtrasados,
} from "./actions";

const VERMELHO = "text-[#b91c1c]";
/** Os selos da liberação. */
const TAG_LIBERADO =
  "inline-flex flex-none items-center gap-1 rounded-full border border-[#fca5a5] bg-[#fef2f2] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-[#b91c1c]";
/** A marca de UMA PP de pagamento atrasado. */
const TAG_PP =
  "inline-flex flex-none items-center gap-1 rounded-full border border-[#fca5a5] bg-[#fef2f2] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.05em] text-[#b91c1c]";
const BOTAO =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/30 hover:bg-california-red/[0.06]";

// ---------------------------------------------------------------------------
// Marcas
// ---------------------------------------------------------------------------

/** O relógio vermelho no fim do nome do item, na Planilha Interna. A linha
 *  não fica vermelha: vermelha é a linha vermelha. */
export function RelogioDaLinhaAtrasada({ titulo }: { titulo: string }) {
  return (
    <span title={titulo} aria-label={titulo} className="inline-flex flex-none items-center text-[#b91c1c]">
      <Clock className="h-3 w-3" aria-hidden />
    </span>
  );
}

/** "Atrasado · 4T/26" — a marca de UMA PP (sublinha da planilha, cartão do
 *  Destrinchar realizado). */
export function SeloDaPPAtrasada({
  liberacao,
  className,
}: {
  liberacao: LiberacaoPagamentosAtrasados;
  className?: string;
}) {
  return (
    <span
      title={dicaDaPPAtrasada(liberacao)}
      className={cn(TAG_PP, "whitespace-nowrap font-sans not-italic", className ?? "ml-2 align-middle")}
    >
      <Clock className="h-2.5 w-2.5" aria-hidden />
      Atrasado · {competenciaCurta(liberacao.trimestre, liberacao.ano)}
    </span>
  );
}

/** Na aba PPs do job, a coluna do código é estreita (e a PP aprovada em
 *  parcelas já leva "1/2" embaixo): só o relógio, logo depois do código. */
export function RelogioDaPPAtrasada({ liberacao }: { liberacao: LiberacaoPagamentosAtrasados }) {
  const titulo = dicaDaPPAtrasada(liberacao);
  return (
    <span title={titulo} aria-label={titulo} className="ml-1 inline-flex translate-y-[1px] items-center text-[#b91c1c]">
      <Clock className="h-3 w-3" aria-hidden />
    </span>
  );
}

/** Contas a Pagar: na fileira de selos embaixo do código (a da Verba e do
 *  Reembolso, decisão 257). */
export function SeloAtrasadoNaLista({ liberacao }: { liberacao: LiberacaoPagamentosAtrasados }) {
  return (
    <span
      title={dicaDaPPAtrasada(liberacao)}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-[#fef2f2] px-1.5 py-0.5 font-sans text-[10px] font-medium text-[#b91c1c]"
    >
      <Clock className="h-2.5 w-2.5" aria-hidden />
      Atrasado · {competenciaCurta(liberacao.trimestre, liberacao.ano)}
    </span>
  );
}

/** Contas a Pagar: o cartão corporativo leva "Cartão" embaixo do código,
 *  como a Verba e o Reembolso. */
export function SeloCartaoNaLista() {
  return (
    <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-sans text-[10px] font-medium text-amber-800">
      Cartão
    </span>
  );
}

/** O topo da tela da PP (fundo escuro). */
export function SeloDaPPAtrasadaNaTela({ liberacao }: { liberacao: LiberacaoPagamentosAtrasados }) {
  return (
    <span
      title={dicaDaPPAtrasada(liberacao)}
      className="inline-flex items-center gap-1.5 rounded-md border border-[#fca5a5] bg-[#b91c1c] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white"
    >
      <Clock className="h-3 w-3" aria-hidden />
      Pagamento atrasado · {competenciaLonga(liberacao.trimestre, liberacao.ano)}
    </span>
  );
}

/** O tipo da PP, no painel Dados da tela da PP. */
export function SeloDoTipoDaPP({ rotulo }: { rotulo: string }) {
  return (
    <span className="inline-flex rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
      {rotulo}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Destrinchar realizado e formulário da PP
// ---------------------------------------------------------------------------

/** No topo do Destrinchar realizado do job liberado. */
export function SeloDoPainelLiberado({ liberacao }: { liberacao: LiberacaoPagamentosAtrasados }) {
  return (
    <span title={dicaDaLiberacao(liberacao)} className={cn(TAG_LIBERADO, "w-fit py-px text-[9px]")}>
      <Clock className="h-2.5 w-2.5" aria-hidden />
      Pagamentos atrasados liberados · competência {competenciaLonga(liberacao.trimestre, liberacao.ano)}
    </span>
  );
}

/** No lugar do "Nova PP para este item", no job liberado. */
export function BotaoNovaPPAtrasada({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Esta PP sai marcada como pagamento atrasado, com a competência que o financeiro liberou."
      className={cn(
        "inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50",
        VERMELHO,
      )}
    >
      <Clock className="h-3.5 w-3.5 text-[#b91c1c]" />
      Nova PP de pagamento atrasado
    </button>
  );
}

/** O texto de apoio do rodapé do Destrinchar realizado no job liberado. */
export function rodapeDoPainelAtrasado(liberacao: LiberacaoPagamentosAtrasados): string {
  return `Job encerrado: a PP sai como pagamento atrasado, competência ${competenciaLonga(liberacao.trimestre, liberacao.ano)}, e o item continua completo.`;
}

/** O aviso no topo do formulário da PP. */
export function FaixaDoFormularioAtrasado({ liberacao }: { liberacao: LiberacaoPagamentosAtrasados }) {
  return (
    <div className="rounded-xl border border-[#fca5a5] bg-[#fef2f2] px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#b91c1c]">
        <Clock className="h-3.5 w-3.5" aria-hidden />
        Pagamento atrasado · competência {competenciaLonga(liberacao.trimestre, liberacao.ano)}
      </p>
      <p className="mt-1 text-[12px] leading-snug text-[#991b1b]">
        Liberado pelo financeiro{liberacao.liberadoPorNome ? ` (${liberacao.liberadoPorNome})` : ""} em{" "}
        {formatDiaBr(liberacao.liberadoEm)}. Esta PP sai marcada como pagamento atrasado, e o item continua completo.
      </p>
      {liberacao.motivo && (
        <p className="mt-1.5 text-[12px] leading-snug text-[#991b1b]">
          <span className="font-semibold">Motivo:</span> {liberacao.motivo}
        </p>
      )}
    </div>
  );
}

/** No fim do formulário da PP atrasada, no lugar do "Esta é a última PP
 *  deste item?": a pergunta sobre o job inteiro. Sim: nenhuma PP atrasada
 *  sai mais neste job, em nenhum item; a conclusão vai ao financeiro junto
 *  com esta PP, quando ela for enviada. */
export const PerguntaConcluirPPsAtrasadas = React.forwardRef<
  HTMLDivElement,
  {
    valor: boolean | null;
    onChange: (v: boolean) => void;
    falta: boolean;
    disabled?: boolean;
  }
>(function PerguntaConcluirPPsAtrasadas({ valor, onChange, falta, disabled }, ref) {
  const opcoes: Array<{ v: boolean; rotulo: string }> = [
    { v: false, rotulo: "Não, ainda faltam PPs" },
    { v: true, rotulo: "Sim, concluir PPs atrasadas" },
  ];
  return (
    <div ref={ref} className="flex scroll-mt-4 flex-col gap-2 border-t border-border pt-4">
      <span className="text-xs font-medium">Esta é a última PP atrasada deste job? *</span>
      <div className="grid grid-cols-2 gap-2.5">
        {opcoes.map((o) => {
          const escolhida = valor === o.v;
          return (
            <button
              key={o.rotulo}
              type="button"
              role="radio"
              aria-checked={escolhida}
              onClick={() => onChange(o.v)}
              disabled={disabled}
              className={cn(
                "flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left text-[13px] font-semibold transition-colors disabled:opacity-50",
                escolhida && o.v
                  ? "border-[#b91c1c] bg-[#fef2f2] text-[#b91c1c]"
                  : escolhida
                    ? "border-foreground bg-muted"
                    : falta
                      ? "border-california-red bg-white"
                      : "border-border bg-white hover:bg-muted/60",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-[15px] w-[15px] flex-none items-center justify-center rounded-full border-[1.5px]",
                  escolhida ? (o.v ? "border-[#b91c1c]" : "border-foreground") : "border-[#C9C4B8]",
                )}
              >
                <span
                  className={cn(
                    "h-[7px] w-[7px] rounded-full",
                    escolhida ? (o.v ? "bg-[#b91c1c]" : "bg-foreground") : "bg-transparent",
                  )}
                />
              </span>
              {o.rotulo}
            </button>
          );
        })}
      </div>
      {falta && (
        <span className="text-[11.5px] font-semibold text-california-red">
          Responda se esta é a última PP atrasada deste job.
        </span>
      )}
      <span className="text-[11px] leading-snug text-muted-foreground">
        {valor === true
          ? "Nenhuma PP atrasada sai mais neste job, em nenhum item. A conclusão vai ao financeiro junto com esta PP, quando você enviá-la; ele confere e trava a planilha."
          : valor === false
            ? "A liberação continua aberta para as próximas PPs atrasadas, em qualquer item."
            : "Vale para o job inteiro, não só para este item."}
      </span>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Barra da planilha: produção
// ---------------------------------------------------------------------------

/** O selo da produção: liberado (com a competência) ou com a conclusão
 *  enviada ao financeiro (com o "Cancelar conclusão"). */
export function SeloPagamentosAtrasadosNaProducao({
  jobId,
  liberacao,
  podeConcluir,
}: {
  jobId: string;
  liberacao: LiberacaoPagamentosAtrasados;
  podeConcluir: boolean;
}) {
  const [modo, setModo] = React.useState<ModoConclusao | null>(null);
  if (liberacao.encerradoEm) return null;
  if (liberacao.conclusaoPedidaEm) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          title={`Concluído${liberacao.conclusaoPedidaPorNome ? ` por ${liberacao.conclusaoPedidaPorNome}` : ""} em ${formatDiaBr(liberacao.conclusaoPedidaEm)}. O financeiro confere e trava a planilha. ${frase(dicaDaLiberacao(liberacao))}`}
          className={TAG_LIBERADO}
        >
          <Clock className="h-3 w-3" aria-hidden />
          Conclusão enviada ao financeiro · {competenciaCurta(liberacao.trimestre, liberacao.ano)}
        </span>
        {podeConcluir && (
          <button type="button" className={cn(BOTAO, VERMELHO)} onClick={() => setModo("cancelar")}>
            <Undo2 className="h-3.5 w-3.5 text-[#b91c1c]" />
            Cancelar conclusão
          </button>
        )}
        <DialogoDaConclusao jobId={jobId} liberacao={liberacao} modo={modo} onFechar={() => setModo(null)} />
      </span>
    );
  }
  return (
    <span
      title={`${frase(dicaDaLiberacao(liberacao))} Toda PP gerada neste job, em qualquer linha, sai como pagamento atrasado.`}
      className={TAG_LIBERADO}
    >
      <Clock className="h-3 w-3" aria-hidden />
      Pagamentos atrasados liberados · {competenciaCurta(liberacao.trimestre, liberacao.ano)}
    </span>
  );
}

/** À direita do "Editar planilha": a produção conclui. Some com a conclusão
 *  enviada e quando o financeiro conclui. */
export function BotaoConcluirPagamentosAtrasados({
  jobId,
  liberacao,
}: {
  jobId: string;
  liberacao: LiberacaoPagamentosAtrasados;
}) {
  const [modo, setModo] = React.useState<ModoConclusao | null>(null);
  if (liberacao.encerradoEm || liberacao.conclusaoPedidaEm) return null;
  return (
    <>
      <button
        type="button"
        className={cn(BOTAO, VERMELHO)}
        title="Lançou tudo? O financeiro confere e trava a planilha de novo."
        onClick={() => setModo("pedir")}
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-[#b91c1c]" />
        Concluir pagamentos atrasados
      </button>
      <DialogoDaConclusao jobId={jobId} liberacao={liberacao} modo={modo} onFechar={() => setModo(null)} />
    </>
  );
}

/** A barra de baixo do "Editar planilha" no job fechado e liberado: a mesma
 *  barra da linha vermelha de hoje ("Planilha em edição"), com o texto do
 *  job encerrado — aqui não há errata. */
export function BarraPagamentosAtrasados({
  liberacao,
  linhas,
  faltaNomear,
  salvando,
  erro,
  semAR,
  onDescartar,
  onDesfazer,
  podeDesfazer,
  onSalvar,
}: {
  liberacao: LiberacaoPagamentosAtrasados;
  linhas: number;
  faltaNomear: boolean;
  salvando: boolean;
  erro: string | null;
  /** O job já foi faturado: a linha vermelha nova não aceita AR. */
  semAR: boolean;
  onDescartar: () => void;
  onDesfazer: () => void;
  podeDesfazer: boolean;
  onSalvar: () => void;
}) {
  const resumo =
    linhas === 0 ? "nenhuma alteração" : linhas === 1 ? "1 linha vermelha nova" : `${linhas} linhas vermelhas novas`;
  return (
    <div className="sticky bottom-0 z-30 -mx-1 mt-2 rounded-2xl border border-california-red/30 bg-card/95 px-4 py-3 shadow-elevated backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 rounded-lg bg-california-red/10 p-1.5">
            <FilePenLine className="h-4 w-4 text-california-red" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-foreground">Planilha em edição · {resumo}</p>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Job encerrado: só entra linha vermelha nova, para o custo que o orçamento não tinha. As linhas que já
              existem não mudam.{" "}
              <span className="font-semibold text-[#b91c1c]">
                A PP dela sai como pagamento atrasado, competência {competenciaLonga(liberacao.trimestre, liberacao.ano)}.
              </span>
              {semAR && " Sem custo AR: o job já foi faturado."}
            </p>
            {erro && (
              <p role="alert" className="mt-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-california-red">
                <AlertCircle className="h-3.5 w-3.5 flex-none" />
                {erro}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDesfazer}
            disabled={!podeDesfazer}
            title="Desfazer o último passo (Cmd+Z / Ctrl+Z)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Desfazer
          </button>
          <button
            type="button"
            onClick={onDescartar}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Descartar
          </button>
          <button
            type="button"
            onClick={onSalvar}
            disabled={linhas === 0 || salvando}
            title={faltaNomear ? "Preencha a descrição de cada linha antes de salvar." : undefined}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            <FilePenLine className="h-3.5 w-3.5" />
            {salvando
              ? "Salvando…"
              : linhas > 1
                ? "Salvar linhas vermelhas"
                : linhas === 1
                  ? "Salvar linha vermelha"
                  : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barra da planilha: financeiro
// ---------------------------------------------------------------------------

/** Na barra da Planilha Interna do job fechado, no financeiro: liberar,
 *  confirmar a conclusão da produção ou concluir sozinho. */
export function PagamentosAtrasadosNoFinanceiro({
  jobId,
  liberacao,
  competencias,
  competenciaPadrao,
  competenciaDoJob,
  avisoAR,
}: {
  jobId: string;
  /** A liberação ainda não encerrada (aberta ou com a conclusão pedida). */
  liberacao: LiberacaoPagamentosAtrasados | null;
  competencias: Array<{ trimestre: number; ano: number }>;
  competenciaPadrao: { trimestre: number; ano: number };
  /** "2T/2026": o trimestre do job, para referência. */
  competenciaDoJob: string | null;
  /** O job já foi faturado e tem linha AR: as linhas AR ficam de fora. */
  avisoAR: boolean;
}) {
  const router = useRouter();
  const [liberando, setLiberando] = React.useState(false);
  const [concluindo, setConcluindo] = React.useState<ModoConclusao | null>(null);
  const [valor, setValor] = React.useState(`${competenciaPadrao.ano}-${competenciaPadrao.trimestre}`);
  const [motivo, setMotivo] = React.useState("");
  const [faltaMotivo, setFaltaMotivo] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  function fechar() {
    if (salvando) return;
    setLiberando(false);
    setFaltaMotivo(false);
    setErro(null);
  }

  async function liberar() {
    if (!motivo.trim()) {
      setFaltaMotivo(true);
      return;
    }
    const [ano, trimestre] = valor.split("-").map(Number);
    setSalvando(true);
    setErro(null);
    const r = await liberarPagamentosAtrasados(jobId, { trimestre, ano, motivo: motivo.trim() });
    setSalvando(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    setLiberando(false);
    setMotivo("");
    setFaltaMotivo(false);
    router.refresh();
  }

  return (
    <>
      {liberacao?.conclusaoPedidaEm ? (
        <span className="inline-flex items-center gap-1.5">
          <span
            title={`Concluído pela produção${liberacao.conclusaoPedidaPorNome ? ` (${liberacao.conclusaoPedidaPorNome})` : ""} em ${formatDiaBr(liberacao.conclusaoPedidaEm)}. ${frase(dicaDaLiberacao(liberacao))}`}
            className={TAG_LIBERADO}
          >
            <Clock className="h-3 w-3" aria-hidden />
            Conclusão pedida · {competenciaCurta(liberacao.trimestre, liberacao.ano)}
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#b91c1c] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#991b1b]"
            onClick={() => setConcluindo("confirmar")}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Confirmar conclusão
          </button>
        </span>
      ) : liberacao ? (
        <span className="inline-flex items-center gap-1.5">
          <span title={dicaDaLiberacao(liberacao)} className={TAG_LIBERADO}>
            <Clock className="h-3 w-3" aria-hidden />
            Pagamentos atrasados liberados · {competenciaCurta(liberacao.trimestre, liberacao.ano)}
          </span>
          <button type="button" className={cn(BOTAO, VERMELHO)} onClick={() => setConcluindo("encerrar")}>
            <CheckCircle2 className="h-3.5 w-3.5 text-[#b91c1c]" />
            Concluir pagamentos atrasados
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={cn(BOTAO, VERMELHO)}
          title="Permite que a produção gere PP neste job fechado, em qualquer linha. Toda PP gerada assim sai marcada como pagamento atrasado."
          onClick={() => setLiberando(true)}
        >
          <Clock className="h-3.5 w-3.5 text-[#b91c1c]" />
          Liberar pagamentos atrasados
        </button>
      )}

      <Dialog open={liberando} onOpenChange={(v) => !v && fechar()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Liberar pagamentos atrasados</DialogTitle>
            <DialogDescription>
              A produção poderá gerar PP em qualquer linha deste job e criar linha vermelha para custo que o orçamento
              não tinha. Toda PP gerada assim sai marcada como pagamento atrasado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="competencia-dos-atrasados" className="text-xs font-semibold text-foreground">
              Competência dos novos lançamentos
            </label>
            <Select value={valor} onValueChange={setValor}>
              <SelectTrigger id="competencia-dos-atrasados" className="h-9 w-[140px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {competencias.map((c) => (
                  <SelectItem key={`${c.ano}-${c.trimestre}`} value={`${c.ano}-${c.trimestre}`}>
                    {competenciaLonga(c.trimestre, c.ano)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {competenciaDoJob && <p className="text-[11.5px] text-muted-foreground">O job é do {competenciaDoJob}.</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="motivo-dos-atrasados" className="text-xs font-semibold text-foreground">
              Motivo dos pagamentos atrasados *
            </label>
            <textarea
              id="motivo-dos-atrasados"
              value={motivo}
              onChange={(e) => {
                setMotivo(e.target.value);
                if (e.target.value.trim()) setFaltaMotivo(false);
              }}
              rows={3}
              maxLength={500}
              placeholder="Ex.: a nota do fornecedor chegou depois do encerramento."
              className={cn(
                "w-full resize-none rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-foreground/40",
                faltaMotivo ? "border-california-red" : "border-border",
              )}
            />
            {faltaMotivo && (
              <p className="text-[11.5px] font-semibold text-california-red">Escreva o motivo dos pagamentos atrasados.</p>
            )}
            <p className="text-[11.5px] text-muted-foreground">
              Fica gravado na liberação e aparece para a produção e para o financeiro, na dica dos selos.
            </p>
          </div>
          {avisoAR && (
            <p className="rounded-lg border border-[#fca5a5] bg-[#fef2f2] px-3 py-2 text-[12px] leading-snug text-[#991b1b]">
              Este job já foi faturado: as linhas de custo AR ficam de fora dos pagamentos atrasados.
            </p>
          )}
          {erro && (
            <p role="alert" className="flex items-center gap-1.5 text-[12px] font-semibold text-california-red">
              <AlertCircle className="h-3.5 w-3.5 flex-none" />
              {erro}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={fechar} disabled={salvando}>
              Voltar
            </Button>
            <Button onClick={() => void liberar()} disabled={salvando}>
              {salvando ? "Salvando…" : "Liberar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {liberacao && (
        <DialogoDaConclusao jobId={jobId} liberacao={liberacao} modo={concluindo} onFechar={() => setConcluindo(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Concluir: o diálogo dos quatro caminhos
// ---------------------------------------------------------------------------

/** pedir: a produção conclui · cancelar: a produção desiste · encerrar: o
 *  financeiro conclui sozinho · confirmar: o financeiro confirma a produção. */
export type ModoConclusao = "pedir" | "cancelar" | "encerrar" | "confirmar";

export function DialogoDaConclusao({
  jobId,
  liberacao,
  modo,
  onFechar,
}: {
  jobId: string;
  liberacao: LiberacaoPagamentosAtrasados;
  modo: ModoConclusao | null;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [dados, setDados] = React.useState<ConclusaoDosPagamentosAtrasados | null>(null);
  const [carregando, setCarregando] = React.useState(false);

  // O resumo e as pendências vêm do banco na hora de abrir.
  React.useEffect(() => {
    if (!modo || modo === "cancelar") return;
    let vivo = true;
    setCarregando(true);
    setDados(null);
    void lerConclusaoDosPagamentosAtrasados(jobId).then((r) => {
      if (!vivo) return;
      setCarregando(false);
      if (r.ok) setDados(r.dados);
      else setErro(r.message);
    });
    return () => {
      vivo = false;
    };
  }, [jobId, modo]);

  const quem = liberacao.conclusaoPedidaPorNome ?? "A produção";
  const quando = liberacao.conclusaoPedidaEm ? formatDiaBr(liberacao.conclusaoPedidaEm) : "";
  const T: Record<ModoConclusao, { titulo: string; desc: string; botao: string }> = {
    pedir: {
      titulo: "Concluir os pagamentos atrasados?",
      desc: "Vai ao financeiro, que confere e trava a planilha de novo. Enquanto isso, não sai PP nova nem linha vermelha neste job; até o financeiro confirmar, dá para cancelar a conclusão.",
      botao: "Concluir e enviar ao financeiro",
    },
    cancelar: {
      titulo: "Cancelar a conclusão?",
      desc: "A liberação volta a ficar aberta: a produção pode gerar PP e criar linha vermelha de novo. O financeiro deixa de ver o pedido de conclusão.",
      botao: "Cancelar a conclusão",
    },
    encerrar: {
      titulo: "Concluir os pagamentos atrasados?",
      desc: "Mesmo sem a produção ter concluído. A planilha volta a travar: a produção não gera mais PP nem cria linha neste job. As PPs que já foram ao financeiro seguem o fluxo delas.",
      botao: "Concluir e travar a planilha",
    },
    confirmar: {
      titulo: "Confirmar a conclusão?",
      desc: `${quem} concluiu os pagamentos atrasados${quando ? ` em ${quando}` : ""}. Ao confirmar, a planilha volta a travar e a produção não lança mais nada neste job.`,
      botao: "Confirmar e travar a planilha",
    },
  };
  const t = modo ? T[modo] : null;
  const pendencias = dados?.pendencias ?? [];
  const travado = salvando || (modo !== "cancelar" && (carregando || pendencias.length > 0));

  async function confirmar() {
    if (!modo) return;
    setSalvando(true);
    setErro(null);
    const r =
      modo === "pedir"
        ? await pedirConclusaoDosPagamentosAtrasados(jobId)
        : modo === "cancelar"
          ? await cancelarConclusaoDosPagamentosAtrasados(jobId)
          : await concluirPagamentosAtrasados(jobId);
    setSalvando(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    onFechar();
    router.refresh();
  }

  return (
    <Dialog
      open={modo !== null}
      onOpenChange={(v) => {
        if (v || salvando) return;
        setErro(null);
        onFechar();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t?.titulo}</DialogTitle>
          <DialogDescription>{t?.desc}</DialogDescription>
        </DialogHeader>
        {modo !== "cancelar" && (
          <div className="space-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[12.5px]">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Lançado na liberação · competência {competenciaLonga(liberacao.trimestre, liberacao.ano)}
            </p>
            {carregando || !dados ? (
              <p className="text-muted-foreground">Carregando…</p>
            ) : (
              <>
                <p>
                  <span className="font-semibold">
                    {dados.pps === 0 ? "Nenhuma PP" : dados.pps === 1 ? "1 PP" : `${dados.pps} PPs`}
                  </span>
                  {dados.pps > 0 && <> de pagamento atrasado · {formatCurrency(dados.valor, "BRL")}</>}
                </p>
                {dados.linhas > 0 && (
                  <p>{dados.linhas === 1 ? "1 linha vermelha criada" : `${dados.linhas} linhas vermelhas criadas`}</p>
                )}
              </>
            )}
            {liberacao.motivo && (
              <p className="text-muted-foreground">
                <span className="font-semibold text-foreground">Motivo:</span> {liberacao.motivo}
              </p>
            )}
          </div>
        )}
        {modo !== "cancelar" && pendencias.length > 0 && (
          <div role="alert" className="rounded-lg border border-[#fca5a5] bg-[#fef2f2] px-3 py-2.5 text-[12.5px] text-[#991b1b]">
            <p className="font-semibold">Antes de concluir, resolva:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {pendencias.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        {erro && (
          <p role="alert" className="flex items-center gap-1.5 text-[12px] font-semibold text-california-red">
            <AlertCircle className="h-3.5 w-3.5 flex-none" />
            {erro}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setErro(null);
              onFechar();
            }}
            disabled={salvando}
          >
            Voltar
          </Button>
          <Button onClick={() => void confirmar()} disabled={travado}>
            {salvando ? "Salvando…" : t?.botao}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
