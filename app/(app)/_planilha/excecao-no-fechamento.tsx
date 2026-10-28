"use client";

/**
 * A exceção no fechamento do orçamento internacional (decisão 206): o
 * pop-up em que o administrador a registra, o selo da versão e o aviso que
 * o financeiro vê na abertura do job. As regras moram em
 * `lib/calculos/excecao-fechamento.ts`; o banco confere de novo.
 */

import * as React from "react";
import { AlertCircle, CheckCircle2, ShieldAlert, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import { formatDataHoraListaBr } from "@/lib/formatar-data-hora";
import {
  FECHAMENTO_PADRAO,
  desviosDoPadrao,
  erroDasTaxas,
  formatarPercentualDoFechamento,
  lerNumeroDigitado,
  resumoDosDesvios,
  type ExcecaoDoFechamento,
  type TaxasDoFechamento,
} from "@/lib/calculos/excecao-fechamento";

/** "Administrador Teste · 22/10/2026 · 14:20" */
function autoria(excecao: ExcecaoDoFechamento): string {
  return `${excecao.porNome ?? "Usuário removido"} · ${formatDataHoraListaBr(excecao.em)}`;
}

/* ---- O selo da versão --------------------------------------------------- */

/** A pílula na linha de parâmetros da versão; a dica traz o que mudou, o
 *  motivo, quem e quando. */
export function SeloExcecao({
  excecao,
  taxas,
}: {
  excecao: ExcecaoDoFechamento;
  taxas: TaxasDoFechamento;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-[22px] cursor-help items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 text-[11px] font-semibold text-amber-800">
          <ShieldAlert className="h-3 w-3" />
          Exceção no fechamento
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[360px] text-xs leading-relaxed">
        <div className="space-y-1.5">
          {desviosDoPadrao(taxas).map((d) => (
            <div key={d.linha} className="flex justify-between gap-4">
              <span>{d.rotulo}</span>
              <span className="font-mono">
                {d.valor} <span className="opacity-60">· padrão {d.padrao}</span>
              </span>
            </div>
          ))}
          <p className="border-t border-white/20 pt-1.5">“{excecao.motivo}”</p>
          <p className="opacity-70">{autoria(excecao)}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/* ---- O pop-up do administrador ----------------------------------------- */

export function ExcecaoDialog({
  open,
  onOpenChange,
  excecao,
  atual,
  fee,
  faturamento,
  pending,
  erro,
  onAplicar,
  onRemover,
  vaiAoComite,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  excecao: ExcecaoDoFechamento | null;
  /** As três taxas como a versão está agora. */
  atual: TaxasDoFechamento;
  /** Fee da versão, em % — não é exceção; só aparece para conferir. */
  fee: number;
  /** Decisão 225: a versão com exceção será aprovada pelo Comitê. */
  vaiAoComite: boolean;
  /** Faturamento previsto da versão com estas três taxas e o fee atual. */
  faturamento: (t: TaxasDoFechamento) => number;
  pending: boolean;
  erro: string | null;
  onAplicar: (e: TaxasDoFechamento & { motivo: string }) => void;
  onRemover: () => void;
}) {
  const [intTaxes, setIntTaxes] = React.useState("");
  const [imposto, setImposto] = React.useState("");
  const [itc, setItc] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [planilha, setPlanilha] = React.useState("");

  // Abrir de novo recomeça dos valores da versão, não do rascunho anterior.
  React.useEffect(() => {
    if (!open) return;
    setIntTaxes(String(atual.intTaxes).replace(".", ","));
    setImposto(String(atual.imposto).replace(".", ","));
    setItc(String(atual.itc).replace(".", ","));
    setMotivo(excecao?.motivo ?? "");
    setPlanilha("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const valores: TaxasDoFechamento = {
    intTaxes: lerNumeroDigitado(intTaxes),
    imposto: lerNumeroDigitado(imposto),
    itc: lerNumeroDigitado(itc || "0"),
  };
  const erroDosValores = erroDasTaxas(valores);
  const foraDoPadrao = erroDosValores === null && desviosDoPadrao(valores).length > 0;
  const semMotivo = motivo.trim() === "";

  const hoje = faturamento(atual);
  const comExcecao = erroDosValores === null ? faturamento(valores) : null;
  const referencia = lerNumeroDigitado(planilha);
  const diferenca =
    comExcecao !== null && Number.isFinite(referencia)
      ? Math.round((comExcecao - referencia) * 100) / 100
      : null;

  let motivoDoBotao: string | null = null;
  if (erroDosValores) motivoDoBotao = erroDosValores;
  else if (!foraDoPadrao) motivoDoBotao = "Os três valores estão no padrão: não há exceção a aplicar.";
  else if (semMotivo) motivoDoBotao = "Escreva o motivo para aplicar.";

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="max-h-[88vh] max-w-[560px] overflow-y-auto">
        <DialogHeader>
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <DialogTitle className="pt-4 text-[19px]">Exceção no fechamento</DialogTitle>
          <DialogDescription className="text-[13.5px] leading-relaxed">
            Vale só para esta versão. O padrão do sistema não muda, e o financeiro é avisado na
            abertura do job.
            {vaiAoComite && " Com a exceção, a aprovação da versão passa pelo Comitê de Aprovações."}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-xl border border-border">
          <div className="grid grid-cols-[minmax(0,1fr)_120px_150px] items-center gap-x-4 border-b border-border bg-muted/40 px-4 py-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            <span>Linha</span>
            <span className="text-right">Padrão do sistema</span>
            <span>Nesta versão</span>
          </div>
          <LinhaDoPopup
            id="excecao-int-taxes"
            rotulo="Int. taxes"
            padrao={FECHAMENTO_PADRAO.intTaxes}
            padraoTexto={formatarPercentualDoFechamento(FECHAMENTO_PADRAO.intTaxes)}
            sufixo="%"
            valor={intTaxes}
            onChange={setIntTaxes}
          />
          <LinhaDoPopup
            id="excecao-impostos-br"
            rotulo="Impostos BR"
            padrao={FECHAMENTO_PADRAO.imposto}
            padraoTexto={formatarPercentualDoFechamento(FECHAMENTO_PADRAO.imposto)}
            sufixo="%"
            valor={imposto}
            onChange={setImposto}
          />
          <LinhaDoPopup
            id="excecao-transacao"
            rotulo="Int. transaction costs"
            dica="Custo fixo somado ao invoice, sem imposto. Ex.: taxa cambial."
            padrao={FECHAMENTO_PADRAO.itc}
            padraoTexto={formatCurrency(FECHAMENTO_PADRAO.itc)}
            prefixo="R$"
            valor={itc}
            onChange={setItc}
            ultima
          />
        </div>
        <p className="-mt-1 text-xs text-muted-foreground">
          Fee da versão: <strong className="text-foreground">{formatarPercentualDoFechamento(fee)}</strong>.
          Ele não é exceção e continua no “Editar”.
        </p>

        <label className="block" htmlFor="excecao-motivo">
          <span className="text-[13px] font-semibold">
            Motivo <span className="text-california-red">*</span>
          </span>
          <textarea
            id="excecao-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Ex.: contas a receber confirmou com a contabilidade que não há IR retido no exterior e que o ISS é abatido."
            className="mt-1.5 w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/70 focus:border-california-red/50"
          />
        </label>

        <div className="rounded-xl border border-border bg-[#fbfbfa] px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-semibold">Faturamento previsto</span>
            <span className="font-mono text-[13px]">
              <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                {formatCurrency(hoje)}
              </span>{" "}
              →{" "}
              <strong className="text-california-red">
                {comExcecao === null ? "—" : formatCurrency(comExcecao)}
              </strong>
            </span>
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <label htmlFor="excecao-planilha" className="text-[13px] text-muted-foreground">
              Invoicing da planilha (para conferir)
            </label>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">R$</span>
              <input
                id="excecao-planilha"
                value={planilha}
                onChange={(e) => setPlanilha(e.target.value)}
                inputMode="decimal"
                placeholder="opcional"
                className="h-7 w-[130px] rounded-md border border-border bg-white px-2 text-right font-mono text-[13px] outline-none focus:border-california-red/50"
              />
            </span>
          </div>
          {diferenca !== null && (
            <p
              className={cn(
                "mt-2.5 flex items-center justify-end gap-1.5 text-[12.5px] font-semibold",
                Math.abs(diferenca) < 0.01 ? "text-emerald-700" : "text-amber-700",
              )}
            >
              {Math.abs(diferenca) < 0.01 ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Bate com a planilha
                </>
              ) : (
                <>
                  <AlertCircle className="h-3.5 w-3.5" />
                  {diferenca > 0 ? "Acima" : "Abaixo"} da planilha em {formatCurrency(Math.abs(diferenca))}.
                  Confira também o fee.
                </>
              )}
            </p>
          )}
        </div>

        {erro && (
          <div className="flex items-start gap-2 text-xs text-california-red">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2.5">
          {excecao ? (
            <button
              type="button"
              onClick={onRemover}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-california-red disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              Voltar ao padrão
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={motivoDoBotao !== null || pending}
              title={motivoDoBotao ?? undefined}
              onClick={() => onAplicar({ ...valores, motivo: motivo.trim() })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-[18px] py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              {pending ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <ShieldAlert className="h-4 w-4" />
              )}
              {excecao ? "Salvar exceção" : "Aplicar exceção"}
            </button>
          </div>
        </div>
        {motivoDoBotao && (
          <p className="-mt-2 text-right text-xs text-muted-foreground">{motivoDoBotao}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinhaDoPopup({
  id,
  rotulo,
  dica,
  padrao,
  padraoTexto,
  prefixo,
  sufixo,
  valor,
  onChange,
  ultima,
}: {
  id: string;
  rotulo: string;
  dica?: string;
  padrao: number;
  padraoTexto: string;
  prefixo?: string;
  sufixo?: string;
  valor: string;
  onChange: (v: string) => void;
  ultima?: boolean;
}) {
  const n = lerNumeroDigitado(valor || "0");
  const mudou = Number.isFinite(n) && Math.abs(n - padrao) > 1e-9;
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_120px_150px] items-center gap-x-4 px-4 py-2.5",
        !ultima && "border-b border-border",
      )}
    >
      <label htmlFor={id} className="text-[13.5px]">
        {rotulo}
        {dica && (
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{dica}</span>
        )}
      </label>
      <span className="text-right font-mono text-[13px] text-muted-foreground">{padraoTexto}</span>
      <span className="inline-flex items-center gap-1.5">
        {prefixo && <span className="text-xs text-muted-foreground">{prefixo}</span>}
        <input
          id={id}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          className={cn(
            "h-8 w-[104px] rounded-md border bg-white px-2 text-right font-mono text-[13px] font-medium outline-none focus:border-california-red/50",
            mudou ? "border-amber-300 bg-amber-50/60 text-amber-800" : "border-border",
          )}
        />
        {sufixo && <span className="text-xs text-muted-foreground">{sufixo}</span>}
      </span>
    </div>
  );
}

/* ---- O aviso ao financeiro ---------------------------------------------- */

/** A faixa da página "Abrir job no financeiro", entre o cabeçalho e as abas. */
export function FaixaExcecaoNaAbertura({
  excecao,
  taxas,
}: {
  excecao: ExcecaoDoFechamento;
  taxas: TaxasDoFechamento;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
      <div className="min-w-0 text-[13px] leading-relaxed">
        <p>
          <strong>Exceção no fechamento.</strong>{" "}
          {desviosDoPadrao(taxas).map((d, i) => (
            <React.Fragment key={d.linha}>
              {i > 0 && <span className="text-amber-700/60"> · </span>}
              {d.rotulo} <strong className="font-mono">{d.valor}</strong>{" "}
              <span className="text-amber-800/70">(padrão {d.padrao})</span>
            </React.Fragment>
          ))}
        </p>
        <p className="text-amber-800/80">
          “{excecao.motivo}” — {autoria(excecao)}
        </p>
      </div>
    </div>
  );
}

/** A linha da exceção no pop-up "Abrir … no financeiro?". */
export function ExcecaoNaConfirmacao({ taxas }: { taxas: TaxasDoFechamento }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
      <span>
        <strong>Exceção no fechamento:</strong> {resumoDosDesvios(taxas)}.
      </span>
    </div>
  );
}
