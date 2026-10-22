/**
 * A exceção no fechamento do orçamento internacional (decisão 206).
 *
 * O fechamento padrão do internacional é fixo: int. taxes 18,02% (IR 17,64%
 * + IOF 0,37%), impostos BR 19,53% (a lista da decisão 096) e nenhum custo
 * de transação. Fugir dele é uma exceção daquela versão, registrada só pelo
 * administrador, com motivo — e não vira regra: a versão nova nasce no
 * padrão. O gatilho `versao_fechamento_internacional_no_padrao` confere o
 * mesmo no banco.
 *
 * Também mora aqui o câmbio derivado da cotação: compra e venda são sempre
 * a cotação −0,20 e +0,20, como a planilha da produção calcula
 * (`B104 = B103 − 0,2`, `B105 = B103 + 0,2`).
 */
import { ALIQUOTA_IMPOSTO_PADRAO, PERCENTUAL_INT_TAXES_PADRAO } from "@/lib/impostos";

export interface TaxasDoFechamento {
  /** Int. taxes, em %. */
  intTaxes: number;
  /** Impostos BR, em %. */
  imposto: number;
  /** Int. transaction costs, em BRL. */
  itc: number;
}

export const FECHAMENTO_PADRAO: TaxasDoFechamento = {
  intTaxes: PERCENTUAL_INT_TAXES_PADRAO,
  imposto: ALIQUOTA_IMPOSTO_PADRAO,
  itc: 0,
};

/** A exceção registrada numa versão, como a tela mostra. */
export interface ExcecaoDoFechamento {
  motivo: string;
  /** Nome do administrador; nulo se o usuário não existe mais. */
  porNome: string | null;
  /** ISO do registro. */
  em: string;
}

export type LinhaDoFechamento = "intTaxes" | "imposto" | "itc";

export interface Desvio {
  linha: LinhaDoFechamento;
  rotulo: string;
  valor: string;
  padrao: string;
}

const iguais = (a: number, b: number, tolerancia = 1e-6) => Math.abs(a - b) < tolerancia;

/** Percentual como o ERP escreve: 0,37% / 17,03% / 18,02%. */
export function formatarPercentualDoFechamento(n: number): string {
  return `${String(Math.round(n * 1e6) / 1e6).replace(".", ",")}%`;
}

function formatarReais(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * O que foge do padrão, linha a linha e na ordem da cadeia. Impostos BR em
 * 0 não é desvio: é a versão que ainda não teve a alíquota escolhida, e a
 * aprovação já barra isso por conta própria.
 */
export function desviosDoPadrao(t: TaxasDoFechamento): Desvio[] {
  const lista: Desvio[] = [];
  if (!iguais(t.intTaxes, FECHAMENTO_PADRAO.intTaxes)) {
    lista.push({
      linha: "intTaxes",
      rotulo: "Int. taxes",
      valor: formatarPercentualDoFechamento(t.intTaxes),
      padrao: formatarPercentualDoFechamento(FECHAMENTO_PADRAO.intTaxes),
    });
  }
  if (!iguais(t.imposto, FECHAMENTO_PADRAO.imposto) && !iguais(t.imposto, 0)) {
    lista.push({
      linha: "imposto",
      rotulo: "Impostos BR",
      valor: formatarPercentualDoFechamento(t.imposto),
      padrao: formatarPercentualDoFechamento(FECHAMENTO_PADRAO.imposto),
    });
  }
  if (!iguais(t.itc, FECHAMENTO_PADRAO.itc, 0.005)) {
    lista.push({
      linha: "itc",
      rotulo: "Int. transaction costs",
      valor: formatarReais(t.itc),
      padrao: formatarReais(FECHAMENTO_PADRAO.itc),
    });
  }
  return lista;
}

export function foraDoPadrao(t: TaxasDoFechamento): boolean {
  return desviosDoPadrao(t).length > 0;
}

/** "Int. taxes 0,37% · Impostos BR 17,03% · Int. transaction costs R$ 550,00" */
export function resumoDosDesvios(t: TaxasDoFechamento): string {
  return desviosDoPadrao(t)
    .map((d) => `${d.rotulo} ${d.valor}`)
    .join(" · ");
}

/** Recusa de valores fora do que o banco aceita. `null` quando valem. */
export function erroDasTaxas(t: TaxasDoFechamento): string | null {
  const pct = (n: number) => Number.isFinite(n) && n >= 0 && n < 100;
  if (!pct(t.intTaxes)) return "Int. taxes precisa ser um percentual entre 0 e 100.";
  if (!pct(t.imposto)) return "Impostos BR precisa ser um percentual entre 0 e 100.";
  if (!Number.isFinite(t.itc) || t.itc < 0) {
    return "O custo de transação precisa ser zero ou um valor positivo.";
  }
  return null;
}

/* ---- Câmbio --------------------------------------------------------------- */

/** A diferença fixa entre a cotação do dia e as taxas de compra e venda. */
export const SPREAD_DO_CAMBIO = 0.2;

const quatroCasas = (n: number) => Math.round(n * 10000) / 10000;

export function compraDaCotacao(cotacao: number): number {
  return quatroCasas(cotacao - SPREAD_DO_CAMBIO);
}

export function vendaDaCotacao(cotacao: number): number {
  return quatroCasas(cotacao + SPREAD_DO_CAMBIO);
}

/** A cotação só vale acima do spread: a compra não pode ficar em zero. */
export function cotacaoValida(cotacao: number): boolean {
  return Number.isFinite(cotacao) && cotacao > SPREAD_DO_CAMBIO;
}

/** "0,37" → 0.37; "309.011,95" → 309011.95; vazio ou torto → NaN. */
export function lerNumeroDigitado(texto: string): number {
  let t = texto.trim().replace(/\s|R\$/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  return t === "" ? NaN : Number(t);
}
