/**
 * O card de Totais da Mídia Off (decisão 147).
 *
 * O mesmo frame do `TotaisCard` da planilha nacional, com o vocabulário
 * dele: Faturamento previsto, Valor do Job, Custo planejado, Resultado
 * operacional e geral. A diferença de leitura fica na coluna da esquerda:
 * no nacional, honorários e impostos SOMAM ao total dos custos; aqui,
 * veículos e honorários DECOMPÕEM o total orçado (o cliente paga o
 * negociado e o imposto sai de dentro dos honorários). Por isso as três
 * linhas da decomposição vêm recuadas, com o filete à esquerda.
 */

import { Calculator, Info } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { formatarAliquota } from "@/lib/impostos";
import type { FechamentoMidia, ParametrosMidia } from "@/lib/calculos/midia-off";

const brl = (v: number) => formatCurrency(v, "BRL");
const pctNum = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

export function TotaisMidia({
  f,
  p,
  titulo,
}: {
  f: FechamentoMidia;
  p: ParametrosMidia;
  titulo: string;
}) {
  const pctHonorarios = String(Number(p.honorarios.toFixed(4))).replace(".", ",");
  const base = p.base === "negociado" ? "do negociado" : "do líquido do veículo";
  const temResultado = f.resultadoGeral !== null;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center gap-2 border-b border-border p-6">
        <Calculator className="h-5 w-5 text-california-red" />
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight">{titulo}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Orçado · valores calculados a partir das linhas dos meios.</p>
        </div>
      </div>

      <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
        {/* Fechamento do orçado */}
        <div className="p-6">
          <p className="mb-3.5 text-[13px] font-bold uppercase tracking-[0.07em] text-foreground">
            Fechamento do orçado · por meio
          </p>
          <div className="space-y-1.5">
            {f.porMeio.map(({ meio, conta }) => (
              <Linha key={meio.chave} label={`Sub-total ${meio.meio}`} value={conta.total} />
            ))}
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3">
              <span className="text-sm font-bold">Total orçado</span>
              <span className="whitespace-nowrap font-mono text-[15px] font-bold">{brl(f.valorJob)}</span>
            </div>
            <div className="ml-1 space-y-1 border-l-2 border-border pl-3">
              <Linha parte label="Veículos · A · Direto" value={f.veiculosDireto} />
              <Linha parte label="Veículos · A · Repasse" value={f.veiculosRepasse} />
              <Linha parte label={`Honorários (${pctHonorarios}%)`} value={f.honorarios} />
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3.5">
              <span className="text-sm font-semibold">Faturamento previsto</span>
              <span className="whitespace-nowrap font-mono text-lg font-bold text-california-red">
                {brl(f.faturamentoPrevisto)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 pt-1">
              <span className="text-sm font-semibold">Valor do Job</span>
              <span className="whitespace-nowrap font-mono text-lg font-bold text-foreground">{brl(f.valorJob)}</span>
            </div>
          </div>
        </div>

        {/* Resultado */}
        <div className="p-6">
          <p className="mb-3.5 text-[13px] font-bold uppercase tracking-[0.07em] text-foreground">Resultado</p>
          <div className="space-y-1.5">
            <Linha label="Valor do Job" value={f.valorJob} />
            <Linha label="− Impostos" detalhe={`(${formatarAliquota(p.imposto)}% dos honorários)`} value={f.imposto} />
            <Linha label="− Custo planejado" detalhe="(veículos)" value={f.custoPlanejado} />
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3">
              <span className="text-sm font-semibold">Resultado operacional</span>
              <span
                className={cn(
                  "whitespace-nowrap font-mono text-base font-bold",
                  f.resultadoOperacional >= 0 ? "text-emerald-700" : "text-california-red",
                )}
              >
                {brl(f.resultadoOperacional)}
              </span>
            </div>
          </div>

          <div
            className={cn(
              "mt-2.5 rounded-xl border p-4",
              !temResultado
                ? "border-border bg-muted/30"
                : f.resultadoGeral! >= 0
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-rose-200 bg-rose-50",
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p
                  className={cn(
                    "text-sm font-semibold",
                    !temResultado ? "text-muted-foreground" : f.resultadoGeral! >= 0 ? "text-emerald-800" : "text-california-red",
                  )}
                >
                  Resultado geral
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-[11.5px]",
                    !temResultado ? "text-muted-foreground" : f.resultadoGeral! >= 0 ? "text-emerald-700" : "text-california-red",
                  )}
                >
                  {temResultado ? "Resultado operacional ÷ valor do job" : "Preencha as linhas para ver o resultado."}
                </p>
              </div>
              <span
                className={cn(
                  "whitespace-nowrap font-mono text-[26px] font-bold leading-none",
                  !temResultado ? "text-muted-foreground" : f.resultadoGeral! >= 0 ? "text-emerald-700" : "text-california-red",
                )}
              >
                {temResultado ? pctNum(f.resultadoGeral!) : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-b-2xl">
        <div className="flex items-start gap-2 border-t border-border bg-muted/30 px-6 py-4 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            <strong className="text-foreground">Veículos</strong> = {String(p.veiculo).replace(".", ",")}% do negociado ·{" "}
            <strong className="text-foreground">Honorários</strong> = {pctHonorarios}% {base} ·{" "}
            <strong className="text-foreground">Impostos</strong> saem dos honorários ·{" "}
            <strong className="text-foreground">Faturamento previsto</strong> = honorários + veículos em A · Repasse ·{" "}
            <strong className="text-foreground">Valor do Job</strong> = o total orçado ·{" "}
            <strong className="text-foreground">Resultado operacional</strong> = valor do job − impostos − custo
            planejado (as notas dos veículos) · <strong className="text-foreground">Resultado geral</strong> = resultado
            operacional ÷ valor do job.
          </p>
        </div>
      </div>
    </div>
  );
}

/** A linha do nacional. `parte`: uma das parcelas que decompõem o total
 *  orçado — mesma cor, um ponto menor; zerada, apaga. */
function Linha({
  label,
  detalhe,
  value,
  parte,
}: {
  label: string;
  detalhe?: string;
  value: number;
  parte?: boolean;
}) {
  const zerado = Math.abs(value) < 0.005;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn("text-muted-foreground", parte ? "text-[13px]" : "text-sm", parte && zerado && "text-[#a9a7a1]")}>
        {label}
        {detalhe && (
          <>
            {" "}
            <span className="text-[#a9a7a1]">{detalhe}</span>
          </>
        )}
      </span>
      <span className={cn("whitespace-nowrap font-mono", parte ? "text-[12.5px]" : "text-[13px]", parte && zerado && "text-[#b8b6b1]")}>
        {brl(value)}
      </span>
    </div>
  );
}
