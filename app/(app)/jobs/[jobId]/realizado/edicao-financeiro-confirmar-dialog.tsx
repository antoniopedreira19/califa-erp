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
 * Desde 08/10/2026 o tipo de custo também muda: a linha mostra o de → para,
 * e o pop-up avisa quando o custo previsto muda sem a curva acompanhar.
 * Desde 14/10/2026, com o job na fila da abertura, o planejado também muda:
 * a linha mostra o planejado de → para, na cor do bloco Planejado.
 * Desde 28/10/2026, o faturamento que nasce sem previsão de recebimento para
 * acompanhar (o job, ou o mês do mensal, que abriu sem faturamento) pede a
 * data de recebimento aqui, e a confirmação espera todas.
 * Desde 30/10/2026 ("Editar planilha") os parâmetros do job mudam no mesmo
 * pop-up, e com o job aberto ele é aberto pelo rodapé da aba Abertura do
 * Job (opção C): mostra como ficam as previsões que a revisão grava junto,
 * e nada acompanha sozinho — só o envio ainda sem nota.
 */

import * as React from "react";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FilePenLine,
  Send,
  Wallet,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { cn, formatCurrency } from "@/lib/utils";
import { ERRATA, PLANEJADO } from "@/app/(app)/_planilha/blocos";
import {
  deltaDoCustoPrevisto,
  planejadoMudou,
  type LinhaAlteradaPeloFinanceiro,
} from "@/lib/calculos/alteracao-financeiro";
import { tipoGeraDesembolso } from "@/lib/calculos/versao-totais";
import { tipoCustoLabel } from "@/lib/types";
import type { EdicaoRegistroAberturaInput } from "@/lib/validations/abertura-financeiro";

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

/** O faturamento que nasce sem previsão de recebimento para acompanhar: o
 *  mês do mensal (`mes` no primeiro dia) ou o job (`mes` nulo), e quanto
 *  entra. A data vem do campo do pop-up. */
export interface RecebimentoSemPrevisao {
  mes: string | null;
  rotulo: string;
  valor: number;
}

/** O mês seguinte ao de referência, onde o calendário abre — como a data de
 *  recebimento do mensal na abertura (decisão 149). */
function mesSeguinte(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  const prox = m === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: m + 1 };
  return `${prox.ano}-${String(prox.mes).padStart(2, "0")}-01`;
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
  /** O faturamento que nasce sem previsão para acompanhar: pede a data. */
  recebimentoSemPrevisao: RecebimentoSemPrevisao[];
  /** Serviço Interno (decisão 105): o planejado é igual ao orçado e anda
   *  junto. Nos outros, o planejado não muda. */
  planejadoAcompanha: boolean;
  /** Job ainda na fila da abertura (decisão 115): não há previsão gravada
   *  nem envio, e quem acompanha é o formulário da abertura. */
  naAbertura: boolean;
  /** Os parâmetros do job que mudam junto (decisão 224). `[]` sem
   *  mudança. */
  parametros: Array<{ rotulo: string; de: string; para: string }>;
  /** O registro da abertura que a revisão grava junto (opção C), ou
   *  `null` na alteração que grava sozinha. */
  revisao: EdicaoRegistroAberturaInput | null;
  salvando: boolean;
  erro: string | null;
  onConfirmar: (
    motivo: string,
    recebimentosNovos: Array<{ mes: string | null; data_prevista: string }>,
  ) => void;
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
  recebimentoSemPrevisao,
  planejadoAcompanha,
  naAbertura,
  parametros,
  revisao,
  salvando,
  erro,
  onConfirmar,
}: Props) {
  const [motivo, setMotivo] = React.useState("");
  // A data de cada faturamento que nasce, pela chave do mês ("" = o job).
  const [datas, setDatas] = React.useState<Record<string, string>>({});

  // Zera a cada abertura, como a descrição da errata.
  React.useEffect(() => {
    if (open) {
      setMotivo("");
      setDatas({});
    }
  }, [open]);

  const chaveDe = (r: RecebimentoSemPrevisao) => r.mes ?? "";
  const faltaData = recebimentoSemPrevisao.some((r) => !datas[chaveDe(r)]);
  const podeConfirmar =
    motivo.trim().length >= 5 &&
    !salvando &&
    (mudancas.length > 0 || parametros.length > 0) &&
    !faltaData;

  // A troca de tipo (08/10/2026) mexe no que a planilha mostra além do
  // orçado: o realizado de A e D é o próprio orçado, e o dos tipos com PP é
  // a soma das PPs; e o custo previsto é o planejado dos tipos com PP.
  const trocaDeCalha = mudancas.some(
    (m) => tipoGeraDesembolso(m.tipoCustoDe) !== tipoGeraDesembolso(m.tipoCustoPara),
  );
  const deltaCusto = deltaDoCustoPrevisto(mudancas);
  // O planejado só muda com o job na fila (14/10/2026); no Interno ele
  // segue o orçado e o texto de lá já diz isso.
  const mudaPlanejado = !planejadoAcompanha && mudancas.some(planejadoMudou);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[620px] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-california-red/10 p-2">
              <FilePenLine className="h-4.5 w-4.5 text-california-red" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[19px]">
                {revisao ? "Confirmar alteração e revisão da abertura" : "Confirmar alteração da planilha"}
              </DialogTitle>
              <DialogDescription className="pt-1.5 text-[13px] leading-relaxed">
                {jobCodigo} · {jobNome} · {resumo}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {parametros.length > 0 && (
            <section className="rounded-xl border border-border">
              <h3 className="border-b border-border px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                O que muda nos parâmetros
              </h3>
              <ul className="divide-y divide-border">
                {parametros.map((c) => (
                  <li key={c.rotulo} className="flex items-center justify-between gap-3 px-3.5 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={ERRATA.tagAlterada}>Alterado</span>
                      <span className="truncate text-[12.5px] text-foreground">{c.rotulo}</span>
                    </div>
                    <div className="flex items-baseline gap-2 whitespace-nowrap font-mono text-[11.5px]">
                      <span className="text-muted-foreground">{c.de}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-bold text-foreground">{c.para}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className={cn("rounded-xl border border-border", mudancas.length === 0 && "hidden")}>
            <h3 className="border-b border-border px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {mudaPlanejado ? "O que muda na planilha" : "O que muda no orçado"}
            </h3>
            <ul className="divide-y divide-border">
              {mudancas.map((m) => {
                const delta = (Math.round(m.totalPara * 100) - Math.round(m.totalDe * 100)) / 100;
                const tipoMudou = m.tipoCustoDe !== m.tipoCustoPara;
                const planMudou = !planejadoAcompanha && planejadoMudou(m);
                const deltaPlan =
                  (Math.round(m.planejadoPara * 100) - Math.round(m.planejadoDe * 100)) / 100;
                return (
                  <li key={m.id} className="px-3.5 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={ERRATA.tagAlterada}>Alterada</span>
                      <span className="truncate text-[12.5px] text-foreground">{m.item}</span>
                      {tipoMudou && (
                        <span
                          title={`Tipo de custo: ${tipoCustoLabel(m.tipoCustoDe)} → ${tipoCustoLabel(m.tipoCustoPara)}`}
                          className="inline-flex flex-none items-center gap-1 rounded-full border border-[#ddd6c9] bg-[#f1f0ec] px-2 py-0.5 font-mono text-[10.5px] font-semibold text-foreground"
                        >
                          <span className="text-muted-foreground line-through">{m.tipoCustoDe}</span>
                          <ArrowRight className="h-2.5 w-2.5 text-[#a8a29e]" />
                          {m.tipoCustoPara}
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-2 whitespace-nowrap font-mono text-[11.5px]">
                      {planMudou && (
                        <span className="font-sans text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Orçado
                        </span>
                      )}
                      {delta === 0 ? (
                        // Só o tipo (ou só o planejado) mudou: o orçado da
                        // linha é o mesmo.
                        <span className="text-foreground">{formatCurrency(m.totalPara, moeda)}</span>
                      ) : (
                        <>
                          <span className="text-muted-foreground">{formatCurrency(m.totalDe, moeda)}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-foreground">{formatCurrency(m.totalPara, moeda)}</span>
                          <span className={cn("font-bold", corDoDelta(delta))}>
                            {comSinal(delta, moeda)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {planMudou && (
                    <div className="mt-1 flex items-baseline justify-end gap-2 whitespace-nowrap font-mono text-[11.5px]">
                      <span className={cn("font-sans text-[10px] font-semibold uppercase tracking-wider", PLANEJADO.texto)}>
                        Planejado
                      </span>
                      <span className="text-muted-foreground">{formatCurrency(m.planejadoDe, moeda)}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className={PLANEJADO.texto}>{formatCurrency(m.planejadoPara, moeda)}</span>
                      {deltaPlan !== 0 && (
                        <span className={cn("font-bold", PLANEJADO.texto)}>{comSinal(deltaPlan, moeda)}</span>
                      )}
                    </div>
                  )}
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

          {revisao && <PrevisoesDaRevisao registro={revisao} moeda={moeda} />}

          {/* Com a revisão, o pop-up não explica: o rodapé que o abriu já
              disse tudo (Tiago, 30/10/2026: "Desnecessário"). */}
          <div
            className={cn(
              "flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3",
              revisao && "hidden",
            )}
          >
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
                  : mudaPlanejado
                    ? "o planejado das linhas alteradas passa a ser o novo, e o realizado fica como está."
                    : trocaDeCalha && !naAbertura
                      ? "o planejado fica como está, e o realizado da linha que troca de tipo passa a seguir o tipo novo: em A e D é o orçado; nos tipos com PP, a soma das PPs."
                      : "o planejado e o realizado ficam como estão."}
              </p>
            </div>
          </div>

          {!revisao && Math.round(deltaCusto * 100) !== 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
              <Wallet className="mt-0.5 h-4 w-4 flex-none text-california-red" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-[12.5px] font-semibold text-foreground">
                  O custo previsto muda {comSinal(deltaCusto, moeda)}, e a curva
                  de desembolso não acompanha
                </p>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {naAbertura
                    ? "O custo previsto é o planejado das linhas com PP. Ajuste o cronograma de desembolsos na aba Abertura do Job antes de abrir o job: a abertura confere a soma contra o custo previsto."
                    : "O custo previsto é o planejado das linhas com PP. Para a curva nova, ajuste as datas no Editar registro, na aba Abertura do Job, que confere a soma contra o custo previsto."}
                </p>
              </div>
            </div>
          )}

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

          {recebimentoSemPrevisao.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
              <CalendarClock className="mt-0.5 h-4 w-4 flex-none text-california-red" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-[12.5px] font-semibold text-foreground">
                  {recebimentoSemPrevisao.length === 1 && recebimentoSemPrevisao[0].mes === null
                    ? "O job não tem previsão de recebimento: informe a data"
                    : "Meses sem previsão de recebimento: informe a data"}
                </p>
                <div className="space-y-1.5">
                  {recebimentoSemPrevisao.map((r) => {
                    const chave = chaveDe(r);
                    const id = `recebimento-novo-${chave || "job"}`;
                    return (
                      <div key={chave || "job"} className="flex items-center justify-between gap-3">
                        <label htmlFor={id} className="min-w-0 text-[12px] text-foreground">
                          <span>{r.rotulo.charAt(0).toUpperCase() + r.rotulo.slice(1)}</span>
                          <span className="ml-2 font-mono text-[11.5px] font-semibold">
                            {formatCurrency(r.valor, moeda)}
                          </span>
                        </label>
                        <DatePicker
                          id={id}
                          name={id}
                          value={datas[chave] ?? ""}
                          mesInicial={r.mes ? mesSeguinte(r.mes) : undefined}
                          placeholder="Selecione a data"
                          className="w-[190px]"
                          onDateChange={(d) =>
                            setDatas((atual) => ({
                              ...atual,
                              [chave]: d
                                ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                                : "",
                            }))
                          }
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {recebimentoSemPrevisao.length === 1 && recebimentoSemPrevisao[0].mes === null
                    ? "Não há parcela de recebimento para acompanhar a alteração: o job ganha uma, com esta data e o valor que entra."
                    : "Não há parcela de recebimento nesses meses para acompanhar a alteração: cada um ganha uma, com a data informada e o valor que entra."}{" "}
                  Para dividir em outras parcelas, use o Editar registro, na aba
                  Abertura do Job.
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
              onClick={() =>
                onConfirmar(
                  motivo.trim(),
                  recebimentoSemPrevisao.map((r) => ({
                    mes: r.mes,
                    data_prevista: datas[chaveDe(r)] ?? "",
                  })),
                )
              }
              disabled={!podeConfirmar}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              <FilePenLine className="h-3.5 w-3.5" />
              {salvando
                ? "Gravando…"
                : revisao
                  ? "Registrar alteração e revisão"
                  : "Confirmar alteração"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Como ficam as previsões que a revisão da abertura grava junto (opção C). */
function PrevisoesDaRevisao({
  registro,
  moeda,
}: {
  registro: EdicaoRegistroAberturaInput;
  moeda: string;
}) {
  const blocos: Array<{ rotulo: string; um: string; varios: string; linhas: Array<{ data_prevista: string; valor: number }> }> = [
    { rotulo: "Previsão de recebimento", um: "parcela", varios: "parcelas", linhas: registro.recebimento },
    { rotulo: "Curva de desembolso", um: "data", varios: "datas", linhas: registro.curva },
    { rotulo: "Recolhimento de impostos", um: "data", varios: "datas", linhas: registro.impostos },
  ];
  return (
    <section className="rounded-xl border border-border">
      <h3 className="border-b border-border px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        Como ficam as previsões da abertura
      </h3>
      <ul className="divide-y divide-border">
        {blocos.map((b) => {
          const total = b.linhas.reduce((s, l) => s + l.valor, 0);
          const datas =
            b.linhas.length === 0
              ? "—"
              : b.linhas.length === 1
                ? dataBr(b.linhas[0].data_prevista)
                : `${dataBr(b.linhas[0].data_prevista)} → ${dataBr(b.linhas[b.linhas.length - 1].data_prevista)}`;
          return (
            <li key={b.rotulo} className="flex items-center justify-between gap-3 px-3.5 py-2">
              <span className="min-w-0 text-[12.5px] text-foreground">
                {b.rotulo}
                <span className="ml-2 text-[11.5px] text-muted-foreground">
                  {b.linhas.length === 0
                    ? "nenhuma"
                    : `${b.linhas.length} ${b.linhas.length === 1 ? b.um : b.varios}`}{" "}
                  · <span className="font-mono">{datas}</span>
                </span>
              </span>
              <span className="whitespace-nowrap font-mono text-[11.5px] font-bold text-foreground">
                {formatCurrency(total, moeda)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function dataBr(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
