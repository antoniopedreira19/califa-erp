import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FECHAMENTO_PADRAO,
  compraDaCotacao,
  cotacaoValida,
  desviosDoPadrao,
  erroDasTaxas,
  foraDoPadrao,
  lerNumeroDigitado,
  resumoDosDesvios,
  vendaDaCotacao,
} from "./excecao-fechamento";
import { calcularTotaisVersao } from "./versao-totais";
import { bloqueioAprovacaoVersao } from "@/lib/validations/versoes";

test("o padrão não tem desvio; impostos BR em 0 é versão sem alíquota, não exceção", () => {
  assert.equal(foraDoPadrao(FECHAMENTO_PADRAO), false);
  assert.equal(foraDoPadrao({ ...FECHAMENTO_PADRAO, imposto: 0 }), false);
});

test("o 0% gravado no SOF é desvio, como cada uma das três taxas", () => {
  assert.deepEqual(desviosDoPadrao({ ...FECHAMENTO_PADRAO, intTaxes: 0 }).map((d) => d.linha), ["intTaxes"]);
  assert.deepEqual(
    desviosDoPadrao({ intTaxes: 0.37, imposto: 17.03, itc: 550 }).map((d) => d.linha),
    ["intTaxes", "imposto", "itc"],
  );
  assert.equal(
    resumoDosDesvios({ intTaxes: 0.37, imposto: 17.03, itc: 550 }),
    "Int. taxes 0,37% · Impostos BR 17,03% · Int. transaction costs R$ 550,00",
  );
});

test("compra e venda saem da cotação, em quatro casas", () => {
  assert.equal(compraDaCotacao(5.0022), 4.8022);
  assert.equal(vendaDaCotacao(5.0022), 5.2022);
  assert.equal(cotacaoValida(0.2), false);
  assert.equal(cotacaoValida(5), true);
});

test("número digitado em pt-BR", () => {
  assert.equal(lerNumeroDigitado("0,37"), 0.37);
  assert.equal(lerNumeroDigitado("309.011,95"), 309011.95);
  assert.equal(lerNumeroDigitado("R$ 550"), 550);
  assert.ok(Number.isNaN(lerNumeroDigitado("")));
});

test("taxas fora do que o banco aceita são recusadas", () => {
  assert.equal(erroDasTaxas({ intTaxes: 0.37, imposto: 17.03, itc: 550 }), null);
  assert.notEqual(erroDasTaxas({ intTaxes: 100, imposto: 17.03, itc: 0 }), null);
  assert.notEqual(erroDasTaxas({ intTaxes: 0.37, imposto: 17.03, itc: -1 }), null);
});

// O caso que motivou a decisão 206: com fee 13% e a exceção, a cadeia do
// sistema fecha exatamente no INVOICING da planilha da produção.
test("SOF-P002/26-01: a exceção fecha em R$ 309.011,95", () => {
  const itens = [{ tipo_custo: "B" as const, total_orcado: 225_649.5, em_save: false, save_consumido: 0 }];
  const t = calcularTotaisVersao(itens, 13, 17.03, { percentualIntTaxes: 0.37, intTransactionCosts: 550 });
  assert.equal(Math.round(t.faturamentoPrevisto * 100) / 100, 309_011.95);
  assert.equal(Math.round(t.faturamento.intTaxes * 100) / 100, 946.94);
  assert.equal(Math.round(t.faturamento.imposto * 100) / 100, 52_531.07);
});

const base = {
  parServicoCategoria: null,
  cambioInternacional: { moeda: "USD", compra: 4.8022, cotacao: 5.0022, venda: 5.2022, data: "2026-06-02" },
  qtdItens: 1,
  qtdItensComValor: 1,
  mesesSemItens: null,
  linhasSemVeiculo: null,
};

test("aprovação: fora do padrão sem exceção é barrada, com exceção passa", () => {
  const sof = { intTaxes: 0, imposto: 19.53, itc: 0 };
  assert.match(
    bloqueioAprovacaoVersao({ ...base, percentualImposto: 19.53, fechamentoInternacional: { taxas: sof, comExcecao: false } }) ?? "",
    /fora do padrão sem exceção registrada \(Int\. taxes 0%\)/,
  );
  const excecao = { intTaxes: 0.37, imposto: 17.03, itc: 550 };
  assert.equal(
    bloqueioAprovacaoVersao({ ...base, percentualImposto: 17.03, fechamentoInternacional: { taxas: excecao, comExcecao: true } }),
    null,
  );
  // No padrão, aprova como sempre; o nacional não tem o degrau.
  assert.equal(
    bloqueioAprovacaoVersao({ ...base, percentualImposto: 19.53, fechamentoInternacional: { taxas: FECHAMENTO_PADRAO, comExcecao: false } }),
    null,
  );
  assert.equal(
    bloqueioAprovacaoVersao({ ...base, cambioInternacional: null, percentualImposto: 19.53, fechamentoInternacional: null }),
    null,
  );
});
