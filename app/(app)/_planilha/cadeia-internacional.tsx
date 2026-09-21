"use client";

/** A cadeia de faturamento do orçamento internacional — o bloco do card de
 *  Totais (decisão 072).
 *
 *  Compartilhado entre a versão do orçamento e a planilha interna do job:
 *  os dois mostram o MESMO fechamento, e duas cópias divergiriam na
 *  primeira correção — que é exatamente o que este projeto já viu
 *  acontecer com a legenda e com as cores de bloco.
 *
 *  Desenho: "Orcamento Internacional - Planilha e Totais" (Claude Design
 *  `69342d83`), aplicado por inteiro em 21/09/2026 — a caixa azul da
 *  cadeia até o invoice, e o Valor do job numa caixa própria abaixo dela.
 *  A explicação das duas bases, que no design fica sob o Valor do job, é
 *  um tópico da legenda no pé do card (`TextoSaveInternacional`), como no
 *  nacional; e a nota de conversão também desceu para a legenda
 *  (`NotaDaConversao`), que é onde o design a coloca.
 */

import * as React from "react";
import { Globe } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { FechamentoLado } from "@/lib/calculos/versao-totais";
import { CADEIA_INTERNACIONAL } from "./blocos";
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

  // As duas caixas usam as MESMAS colunas: o valor do job fica alinhado
  // sob o invoice, na moeda e em BRL.
  const colunas = moedaEstrangeira
    ? "grid-cols-[minmax(0,1fr)_auto_auto]"
    : "grid-cols-[minmax(0,1fr)_auto]";

  return (
    <>
      <div
        className={cn(
          "mt-5 overflow-hidden rounded-xl border",
          CADEIA_INTERNACIONAL.caixa,
        )}
      >
        <div
          className={cn(
            "flex items-center gap-[7px] border-b px-4 pb-2.5 pt-[11px]",
            CADEIA_INTERNACIONAL.fio,
          )}
        >
          <Globe
            className={cn("h-[13px] w-[13px]", CADEIA_INTERNACIONAL.texto)}
            aria-hidden
          />
          <p
            className={cn(
              "text-[11px] font-bold uppercase tracking-[0.08em]",
              CADEIA_INTERNACIONAL.texto,
            )}
          >
            Cadeia internacional · faturamento
          </p>
        </div>

        <div
          className={cn(
            "grid items-baseline gap-x-[18px] gap-y-[9px] px-4 pb-[15px] pt-3",
            colunas,
          )}
        >
          <span />
          {moedaEstrangeira && (
            <span
              className={cn(
                "text-right text-[9px] font-bold uppercase tracking-[0.07em]",
                CADEIA_INTERNACIONAL.textoSuave,
              )}
            >
              {moedaEstrangeira.codigo}
            </span>
          )}
          <span className="text-right text-[9px] font-bold uppercase tracking-[0.07em] text-[#8a8880]">
            BRL
          </span>

          <LinhaCadeia
            rotulo="Sub-total faturável"
            valor={faturamento.principal}
            moeda={moeda}
            moedaEstrangeira={moedaEstrangeira}
            tipo="base"
          />
          <LinhaCadeia
            rotulo="Fee"
            detalhe={`(${formatPct(percentualHonorarios)}%)`}
            valor={faturamento.honorarios}
            moeda={moeda}
            moedaEstrangeira={moedaEstrangeira}
          />
          <LinhaCadeia
            rotulo="Int. taxes"
            detalhe={`(${formatPct(percentualIntTaxes)}%)`}
            valor={faturamento.intTaxes}
            moeda={moeda}
            moedaEstrangeira={moedaEstrangeira}
          />
          <LinhaCadeia
            rotulo="Total recebido no exterior"
            valor={totalRecebidoExterior}
            moeda={moeda}
            moedaEstrangeira={moedaEstrangeira}
            tipo="somatorio"
          />
          <LinhaCadeia
            rotulo="Int. transaction costs"
            valor={faturamento.intTransactionCosts}
            moeda={moeda}
            moedaEstrangeira={moedaEstrangeira}
          />
          <LinhaCadeia
            rotulo="Impostos BR"
            detalhe={`(${formatPct(percentualImposto)}%)`}
            valor={faturamento.imposto}
            moeda={moeda}
            moedaEstrangeira={moedaEstrangeira}
          />
          <LinhaCadeia
            rotulo="Faturamento previsto"
            detalhe="(Invoice)"
            valor={faturamento.total}
            moeda={moeda}
            moedaEstrangeira={moedaEstrangeira}
            tipo="invoice"
          />
        </div>
      </div>

      {/* O Valor do job fica FORA da caixa azul: ele não é um degrau da
          cadeia do faturamento, é a mesma cadeia sobre outra base. */}
      <div
        className={cn(
          "mt-3 grid items-baseline gap-x-[18px] gap-y-[9px] rounded-xl border border-[#e5e4e0] bg-[#fbfbfa] px-4 pb-[15px] pt-[13px]",
          colunas,
        )}
      >
        <span className="text-sm font-bold text-foreground">Valor do job</span>
        {moedaEstrangeira && (
          <span
            className={cn(
              "whitespace-nowrap text-right font-mono text-base font-bold",
              CADEIA_INTERNACIONAL.texto,
            )}
          >
            {emMoedaEstrangeira(valorJob, moedaEstrangeira)}
          </span>
        )}
        <span className="whitespace-nowrap text-right font-mono text-sm font-bold text-foreground">
          {formatCurrency(valorJob, moeda)}
        </span>
        {saveGerado !== null && (
          <>
            <span className="text-[13.5px] text-[#5f5d57]">Save gerado</span>
            {moedaEstrangeira && (
              <span className="whitespace-nowrap text-right font-mono text-[13px] text-[#8a8880]">
                {emMoedaEstrangeira(saveGerado, moedaEstrangeira)}
              </span>
            )}
            <span className="whitespace-nowrap text-right font-mono text-[13px] text-[#5f5d57]">
              {formatCurrency(saveGerado, moeda)}
            </span>
          </>
        )}
      </div>
    </>
  );
}

/**
 * A última frase da legenda do internacional: de onde vem a coluna na
 * moeda estrangeira — ou, sem a taxa de compra, o que falta preencher.
 * Estava num parágrafo sob a cadeia; o design a põe no pé do card.
 */
export function NotaDaConversao({
  moedaEstrangeira,
}: {
  moedaEstrangeira: MoedaEstrangeira | null;
}) {
  return moedaEstrangeira ? (
    <>
      Conversão para{" "}
      <strong className="text-foreground">{moedaEstrangeira.codigo}</strong>{" "}
      pela taxa de compra ({formatarTaxa(moedaEstrangeira.compra)}).
    </>
  ) : (
    <strong className="text-foreground">
      Preencha a taxa de compra em &quot;Editar&quot;, no cabeçalho da versão,
      para ver os valores na moeda estrangeira e a coluna dela na planilha.
    </strong>
  );
}

/**
 * O tópico do save na legenda do internacional: a mesma cadeia sobre a
 * base do valor do job, com os números da tela. Só existe com save — sem
 * ele as duas bases são a mesma e não há o que explicar.
 */
export function TextoSaveInternacional({
  job,
  moeda,
}: {
  job: FechamentoLado;
  moeda: string;
}) {
  return (
    <>
      A <strong className="text-foreground">mesma cadeia</strong> sobre a base
      do valor do job ({formatCurrency(job.base, moeda)}): fee{" "}
      {formatCurrency(job.honorarios, moeda)}, int. taxes{" "}
      {formatCurrency(job.intTaxes, moeda)}, impostos BR{" "}
      {formatCurrency(job.imposto, moeda)}. A linha em save fica no
      faturamento e sai do job; a linha paga por crédito de outro job faz o
      contrário.
    </>
  );
}

/** Uma linha da cadeia: rótulo, valor na moeda estrangeira, valor em BRL.
 *
 *  Fragmento de três células, e não um `<div>` próprio: as três colunas
 *  são do grid do pai, e envolvê-las quebraria o alinhamento vertical que
 *  faz a coluna somar na vertical. Cada célula leva o próprio fio, e o
 *  espaço entre colunas deixa os três fios separados, como no design. */
function LinhaCadeia({
  rotulo,
  detalhe,
  valor,
  moeda,
  moedaEstrangeira,
  tipo = "comum",
}: {
  rotulo: string;
  /** Parêntese em tom apagado: o percentual, "(Invoice)". */
  detalhe?: string;
  valor: number;
  moeda: string;
  moedaEstrangeira: MoedaEstrangeira | null;
  /** `base` abre a cadeia; `somatorio` fecha o trecho no exterior;
   *  `invoice` é o número que a nota cobra. */
  tipo?: "comum" | "base" | "somatorio" | "invoice";
}) {
  const fio =
    tipo === "somatorio"
      ? cn("border-t pt-2.5", CADEIA_INTERNACIONAL.fio)
      : tipo === "invoice"
        ? cn("border-t pt-[11px]", CADEIA_INTERNACIONAL.fioForte)
        : "";

  const rotuloClasse =
    tipo === "invoice"
      ? "text-sm font-bold text-foreground"
      : tipo === "comum"
        ? "text-[13.5px] text-muted-foreground"
        : "text-[13.5px] font-semibold text-foreground";

  const moedaClasse =
    tipo === "invoice"
      ? "text-base font-bold text-california-red"
      : tipo === "somatorio"
        ? cn("text-[13px] font-bold", CADEIA_INTERNACIONAL.texto)
        : tipo === "base"
          ? cn("text-[13px] font-semibold", CADEIA_INTERNACIONAL.texto)
          : cn("text-[13px]", CADEIA_INTERNACIONAL.valor);

  const brlClasse =
    tipo === "invoice"
      ? "text-sm font-bold text-[#c0333d]"
      : tipo === "somatorio"
        ? "text-[13px] font-semibold text-foreground"
        : "text-[13px] text-[#3f3d38]";

  return (
    <>
      <span className={cn(rotuloClasse, fio)}>
        {rotulo}
        {detalhe && (
          <>
            {" "}
            <span
              className={
                tipo === "invoice"
                  ? "font-medium text-[#8a8880]"
                  : "text-[#a9a7a1]"
              }
            >
              {detalhe}
            </span>
          </>
        )}
      </span>
      {moedaEstrangeira && (
        <span
          className={cn(
            "whitespace-nowrap text-right font-mono",
            moedaClasse,
            fio,
          )}
        >
          {emMoedaEstrangeira(valor, moedaEstrangeira)}
        </span>
      )}
      <span
        className={cn("whitespace-nowrap text-right font-mono", brlClasse, fio)}
      >
        {formatCurrency(valor, moeda)}
      </span>
    </>
  );
}
