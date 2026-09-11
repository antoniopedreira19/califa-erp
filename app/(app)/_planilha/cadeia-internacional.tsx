"use client";

/** A cadeia de faturamento do orçamento internacional — o bloco de sete
 *  linhas do card de Totais (decisão 072).
 *
 *  Compartilhado entre a versão do orçamento e a planilha interna do job:
 *  os dois mostram o MESMO fechamento, e duas cópias divergiriam na
 *  primeira correção — que é exatamente o que este projeto já viu
 *  acontecer com a legenda e com as cores de bloco.
 */

import * as React from "react";
import { cn, formatCurrency } from "@/lib/utils";
import type { FechamentoLado } from "@/lib/calculos/versao-totais";
import {
  emMoedaEstrangeira,
  formatarTaxa,
  type MoedaEstrangeira,
} from "./moeda-estrangeira";

/** Percentual como o ERP escreve: 19,53 e não 19.53. */
function formatPct(n: number): string {
  return n.toString().replace(".", ",");
}

/**
 * A cadeia de faturamento do orçamento internacional (decisão 072).
 *
 * Sete linhas, cada uma somando na seguinte até o **invoice** — é o
 * caminho que a planilha "Modelo de planilha interna - Internacional
 * 2026" percorre nas células G5 → G11, e a ordem importa: as int. taxes
 * são retidas LÁ FORA, então o que chega ao Brasil já as contém, e é
 * sobre esse total que o imposto daqui corre.
 *
 * Duas colunas de valor: a moeda estrangeira (BRL ÷ taxa de compra) e o
 * BRL. Aqui a moeda vem COM o código na frente — ao contrário da
 * planilha, onde o cabeçalho da coluna já o diz —, porque as duas ficam
 * lado a lado e sem prefixo virariam dois números sem dono.
 */
export function CadeiaInternacional({
  faturamento,
  valorJob,
  saveGerado,
  moeda,
  moedaEstrangeira,
  percentualHonorarios,
  percentualIntTaxes,
  percentualImposto,
}: {
  faturamento: FechamentoLado;
  valorJob: number;
  /** `null` quando a versão não tem save — a linha nem aparece. */
  saveGerado: number | null;
  moeda: string;
  /** `null` enquanto a taxa de compra não foi preenchida: a cadeia roda
   *  igual, só sem a coluna convertida. */
  moedaEstrangeira: MoedaEstrangeira | null;
  percentualHonorarios: number;
  percentualIntTaxes: number;
  percentualImposto: number;
}) {
  // O total recebido no exterior é a soma das três primeiras linhas — não
  // um campo à parte. Calcular aqui, a partir das mesmas parcelas que a
  // tela mostra, é o que garante que a coluna feche na vertical.
  const totalRecebidoExterior =
    faturamento.principal + faturamento.honorarios + faturamento.intTaxes;

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.07em] text-foreground">
        Cadeia internacional · faturamento
      </p>
      <div
        className={cn(
          "grid items-baseline gap-x-4 gap-y-1.5",
          moedaEstrangeira
            ? "grid-cols-[minmax(0,1fr)_auto_auto]"
            : "grid-cols-[minmax(0,1fr)_auto]",
        )}
      >
        <span />
        {moedaEstrangeira && (
          <span className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {moedaEstrangeira.codigo}
          </span>
        )}
        <span className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          BRL
        </span>

        <LinhaCadeia
          label="Sub-total faturável"
          valor={faturamento.principal}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
        />
        <LinhaCadeia
          label={`Fee (${formatPct(percentualHonorarios)}%)`}
          valor={faturamento.honorarios}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
        />
        <LinhaCadeia
          label={`Int. taxes (${formatPct(percentualIntTaxes)}% · gross-up)`}
          valor={faturamento.intTaxes}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
        />
        <LinhaCadeia
          label="Total recebido no exterior"
          valor={totalRecebidoExterior}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
          somatorio
        />
        <LinhaCadeia
          label="Int. transaction costs"
          valor={faturamento.intTransactionCosts}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
        />
        <LinhaCadeia
          label={`Impostos BR (${formatPct(percentualImposto)}% · gross-up)`}
          valor={faturamento.imposto}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
        />
        <LinhaCadeia
          label="Faturamento previsto (Invoice)"
          valor={faturamento.total}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
          destaque
        />
        <LinhaCadeia
          label="Valor do Job"
          valor={valorJob}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
          forte
        />
        {saveGerado !== null && (
          <LinhaCadeia
            label="Save gerado"
            valor={saveGerado}
            moeda={moeda}
            moedaEstrangeira={moedaEstrangeira}
            forte
            cor="text-[#5f5d57]"
          />
        )}
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
        Fee sobre o sub-total da base · int. taxes em gross-up sobre
        sub-total&nbsp;+&nbsp;fee · impostos BR em gross-up sobre o total
        recebido no exterior · os custos de transação entram depois dele e
        não compõem base de imposto.{" "}
        {moedaEstrangeira ? (
          <>
            Conversão para{" "}
            <strong className="text-foreground">
              {moedaEstrangeira.codigo}
            </strong>{" "}
            pela taxa de compra ({formatarTaxa(moedaEstrangeira.compra)}).
          </>
        ) : (
          <strong className="text-foreground">
            Preencha a taxa de compra em &quot;Editar&quot;, no cabeçalho da
            versão, para ver os valores na moeda estrangeira e a coluna dela
            na planilha.
          </strong>
        )}
      </p>
    </div>
  );
}

/** Uma linha da cadeia: rótulo, valor na moeda estrangeira, valor em BRL.
 *
 *  Fragmento de três células, e não um `<div>` próprio: as três colunas
 *  são do grid do pai, e envolvê-las quebraria o alinhamento vertical que
 *  faz a coluna somar na vertical. */
function LinhaCadeia({
  label,
  valor,
  moeda,
  moedaEstrangeira,
  somatorio,
  destaque,
  forte,
  cor,
}: {
  label: string;
  valor: number;
  moeda: string;
  moedaEstrangeira: MoedaEstrangeira | null;
  /** Fecha um trecho da cadeia (o total recebido no exterior). */
  somatorio?: boolean;
  /** O invoice — o número que a nota cobra. */
  destaque?: boolean;
  /** Valor do job e save gerado: negrito, sem a borda do somatório. */
  forte?: boolean;
  cor?: string;
}) {
  const borda = somatorio || destaque ? "mt-1 border-t border-border pt-2" : "";
  const peso = destaque || forte || somatorio ? "font-semibold" : "";
  return (
    <>
      <span
        className={cn(
          "text-sm",
          borda,
          peso || "text-muted-foreground",
          cor,
        )}
      >
        {label}
      </span>
      {moedaEstrangeira && (
        <span
          className={cn(
            "whitespace-nowrap text-right font-mono text-[13px] text-muted-foreground",
            borda,
            peso,
            cor,
          )}
        >
          {emMoedaEstrangeira(valor, moedaEstrangeira)}
        </span>
      )}
      <span
        className={cn(
          "whitespace-nowrap text-right font-mono text-[13px]",
          borda,
          peso,
          destaque && "text-base font-bold text-california-red",
          cor,
        )}
      >
        {formatCurrency(valor, moeda)}
      </span>
    </>
  );
}

