"use client";

/**
 * O pop-up que fecha a edição do orçado pelo financeiro (decisão 115). É o
 * pop-up da errata (`ErrataConfirmarDialog`) com três trocas:
 *
 * - a consequência: em vez de "devolve o job ao mural de abertura", a
 *   alteração vale na hora, sem aprovação;
 * - o que acompanha: o envio para faturamento (job enviado e ainda sem
 *   nota) e a previsão de recebimento, parcela a parcela — a curva de
 *   desembolso não, nem no serviço Interno (Tiago, 28/09/2026);
 * - o campo obrigatório: "Motivo da alteração".
 *
 * Do protótipo aprovado em 28/09/2026 (artifact `Re8sXDJpj8gzEk1tnCrt48`).
 */

import * as React from "react";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FilePenLine,
  Send,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatCurrency } from "@/lib/utils";
import { ERRATA } from "@/app/(app)/_planilha/blocos";
import type { LinhaAlteradaPeloFinanceiro } from "@/lib/calculos/alteracao-financeiro";

interface ParDeValores {
  antes: number;
  depois: number;
}

/** Uma parcela que muda: o rótulo ("05/11/2026", "Parcela 1 · 05/11/2026")
 *  e o valor antes e depois. */
export interface ParcelaQueAcompanha {
  chave: string;
  rotulo: string;
  antes: number;
  depois: number;
}

interface Props {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  jobCodigo: string;
  jobNome: string;
  resumo: string;
  mudancas: LinhaAlteradaPeloFinanceiro[];
  orcado: ParDeValores;
  faturamento: ParDeValores;
  valorJob: ParDeValores;
  moeda: string;
  /** Parcelas do envio para faturamento que acompanham — só com o job
   *  enviado e ainda sem nota. Vazio nos outros casos. */
  envio: ParcelaQueAcompanha[];
  /** Parcelas da previsão de recebimento que acompanham. */
  recebimento: ParcelaQueAcompanha[];
  /** Serviço Interno (decisão 105): o planejado é igual ao orçado e anda
   *  junto. Nos outros, o planejado não muda. */
  planejadoAcompanha: boolean;
  /** Job ainda na fila da abertura (decisão 115): não há previsão gravada
   *  nem envio, e quem acompanha é o formulário da abertura. */
  naAbertura: boolean;
  salvando: boolean;
  erro: string | null;
  onConfirmar: (motivo: string) => void;
}

function corDoDelta(delta: number): string {
  if (delta > 0) return "text-[#c2410c]";
  if (delta < 0) return "text-[#047857]";
  return "text-muted-foreground";
}

function comSinal(v: number, moeda: string): string {
  const s = formatCurrency(Math.abs(v), moeda);
  if (Math.round(v * 100) === 0) return s;
  return `${v > 0 ? "+" : "−"}${s}`;
}

function LinhaDeValor({
  rotulo,
  par,
  moeda,
  forte,
}: {
  rotulo: string;
  par: ParDeValores;
  moeda: string;
  forte?: boolean;
}) {
  // O delta é a diferença entre os dois valores que o job passa a ter,
  // arredondados — a mesma conta da barra (ver `ErrataBarra`).
  const centavos = (n: number) => Math.round(n * 100);
  const delta = (centavos(par.depois) - centavos(par.antes)) / 100;
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span
        className={cn(
          "text-[12.5px]",
          forte ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {rotulo}
      </span>
      <div className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="font-mono text-[11.5px] text-muted-foreground line-through">
          {formatCurrency(par.antes, moeda)}
        </span>
        <span
          className={cn(
            "font-mono font-bold text-foreground",
            forte ? "text-[13.5px]" : "text-[12.5px]",
          )}
        >
          {formatCurrency(par.depois, moeda)}
        </span>
        <span className={cn("font-mono text-[11.5px] font-bold", corDoDelta(delta))}>
          {comSinal(delta, moeda)}
        </span>
      </div>
    </div>
  );
}

function Parcelas({ linhas, moeda }: { linhas: ParcelaQueAcompanha[]; moeda: string }) {
  return (
    <div className="space-y-1">
      {linhas.map((p) => (
        <div
          key={p.chave}
          className="flex items-baseline justify-between gap-3 font-mono text-[11.5px]"
        >
          <span className="text-muted-foreground">{p.rotulo}</span>
          <span className="flex items-baseline gap-2">
            <span className="text-muted-foreground line-through">
              {formatCurrency(p.antes, moeda)}
            </span>
            <ArrowRight className="h-3 w-3 self-center text-[#c9c9c9]" />
            <span className="font-semibold text-foreground">
              {formatCurrency(p.depois, moeda)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function EdicaoFinanceiroConfirmarDialog({
  open,
  onOpenChange,
  jobCodigo,
  jobNome,
  resumo,
  mudancas,
  orcado,
  faturamento,
  valorJob,
  moeda,
  envio,
  recebimento,
  planejadoAcompanha,
  naAbertura,
  salvando,
  erro,
  onConfirmar,
}: Props) {
  const [motivo, setMotivo] = React.useState("");

  // Zera a cada abertura, como a descrição da errata.
  React.useEffect(() => {
    if (open) setMotivo("");
  }, [open]);

  const podeConfirmar = motivo.trim().length >= 5 && !salvando && mudancas.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[620px] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-california-red/10 p-2">
              <FilePenLine className="h-4.5 w-4.5 text-california-red" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[19px]">Confirmar alteração do orçado</DialogTitle>
              <DialogDescription className="pt-1.5 text-[13px] leading-relaxed">
                {jobCodigo} · {jobNome} · {resumo}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <section className="rounded-xl border border-border">
            <h3 className="border-b border-border px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              O que muda no orçado
            </h3>
            <ul className="divide-y divide-border">
              {mudancas.map((m) => {
                const delta = (Math.round(m.totalPara * 100) - Math.round(m.totalDe * 100)) / 100;
                return (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-3.5 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={ERRATA.tagAlterada}>Alterada</span>
                      <span className="truncate text-[12.5px] text-foreground">{m.item}</span>
                    </div>
                    <div className="flex items-baseline gap-2 whitespace-nowrap font-mono text-[11.5px]">
                      <span className="text-muted-foreground">{formatCurrency(m.totalDe, moeda)}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-foreground">{formatCurrency(m.totalPara, moeda)}</span>
                      <span className={cn("font-bold", corDoDelta(delta))}>
                        {comSinal(delta, moeda)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-xl border border-border px-3.5 py-2">
            <LinhaDeValor rotulo="Total do orçado" par={orcado} moeda={moeda} />
            <LinhaDeValor rotulo="Faturamento previsto" par={faturamento} moeda={moeda} />
            <LinhaDeValor rotulo="Valor do job" par={valorJob} moeda={moeda} forte />
          </section>

          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-california-red" />
            <div className="space-y-1">
              <p className="text-[12.5px] font-semibold text-foreground">
                A alteração vale na hora, sem aprovação
              </p>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                {naAbertura
                  ? "Não passa pela produção. A planilha, os Totais e o formulário da aba Abertura do Job mudam assim que você confirmar, e a previsão de recebimento que você já preencheu acompanha, com as mesmas datas; "
                  : "Não passa pela produção e não devolve o job ao mural de abertura. A planilha, os Totais e o cabeçalho do job mudam assim que você confirmar; "}
                {planejadoAcompanha
                  ? "no serviço Interno o planejado acompanha o orçado, e o realizado fica como está."
                  : "o planejado e o realizado ficam como estão."}
              </p>
            </div>
          </div>

          {envio.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
              <Send className="mt-0.5 h-4 w-4 flex-none text-california-red" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-[12.5px] font-semibold text-foreground">
                  O envio para faturamento acompanha
                </p>
                <Parcelas linhas={envio} moeda={moeda} />
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  O job já foi enviado e nenhuma nota saiu: o valor enviado e
                  as parcelas passam a ser os novos, com as mesmas datas. A
                  primeira nota emitida, mesmo que de uma parcela só, trava a
                  edição — e o encerramento do job também.
                </p>
              </div>
            </div>
          )}

          {recebimento.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
              <CalendarClock className="mt-0.5 h-4 w-4 flex-none text-california-red" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-[12.5px] font-semibold text-foreground">
                  A previsão de recebimento acompanha
                </p>
                <Parcelas linhas={recebimento} moeda={moeda} />
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  Cada parcela na mesma proporção, com as mesmas datas; os
                  recolhimentos de impostos previstos acompanham do mesmo
                  jeito. Para mudar data ou dividir em outras parcelas, use o
                  Editar registro, na aba Abertura do Job.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <label
                htmlFor="motivo-alteracao-financeiro"
                className="text-[12.5px] font-semibold text-foreground"
              >
                Motivo da alteração
              </label>
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-california-red">
                obrigatório
              </span>
            </div>
            <Textarea
              id="motivo-alteracao-financeiro"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={500}
              autoFocus
              placeholder="Ex.: Valor do item corrigido conforme o pedido de compra do cliente."
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Vai para Alterações do Financeiro, na aba Informações do Job, e
              para o fio da Comunicação — com o seu nome, data e hora. O
              orçado aprovado da versão não muda: a alteração fica registrada
              sobre ele.
            </p>
          </div>

          {erro && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2.5"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-california-red" />
              <span className="text-[12px] text-foreground">{erro}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
              className="inline-flex items-center rounded-lg border border-border bg-white px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground disabled:opacity-50"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={() => onConfirmar(motivo.trim())}
              disabled={!podeConfirmar}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              <FilePenLine className="h-3.5 w-3.5" />
              {salvando ? "Gravando…" : "Confirmar alteração"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
