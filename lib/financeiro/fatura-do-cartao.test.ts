/**
 * Testes do atraso do pagamento (decisão 196) e da fatura escolhida na
 * baixa no cartão (decisão 197).
 *
 * Rode com:  node --import tsx --test lib/financeiro/fatura-do-cartao.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { atrasoDoPagamento, textoDoAtraso } from "./atraso-do-pagamento";
import {
  competenciaParaOBanco,
  datasDaCompetencia,
  faturaDestino,
  opcoesDeFatura,
  rotuloDaCompetencia,
  type CartaoDaFatura,
  type FaturaDoCartaoNaBaixa,
} from "./fatura-do-cartao";

// --- O atraso, contado do primeiro dia útil -----------------------------------

test("vencimento no sábado, pago na segunda: em dia", () => {
  // 17/10/2026 é sábado.
  const a = atrasoDoPagamento("2026-10-19", "2026-10-17");
  assert.equal(a.dias, 0);
  assert.equal(a.fimDeSemana, "sábado");
  assert.equal(a.vencimentoUtil, "2026-10-19");
});

test("vencimento no sábado, pago na terça: 1 dia", () => {
  assert.equal(atrasoDoPagamento("2026-10-20", "2026-10-17").dias, 1);
});

test("vencimento no domingo conta a partir da segunda", () => {
  // 18/10/2026 é domingo.
  assert.equal(atrasoDoPagamento("2026-10-19", "2026-10-18").dias, 0);
  assert.equal(atrasoDoPagamento("2026-10-21", "2026-10-18").dias, 2);
});

test("vencimento num dia útil: dias corridos", () => {
  // 15/10/2026 é quinta.
  const a = atrasoDoPagamento("2026-10-21", "2026-10-15");
  assert.equal(a.dias, 6);
  assert.equal(a.fimDeSemana, null);
  assert.equal(textoDoAtraso(a, "2026-10-15"), "6 dias depois do vencimento (15/10/2026)");
});

test("pago antes do vencimento ou sem datas: zero", () => {
  assert.equal(atrasoDoPagamento("2026-10-10", "2026-10-15").dias, 0);
  assert.equal(atrasoDoPagamento(null, "2026-10-15").dias, 0);
  assert.equal(atrasoDoPagamento("2026-10-10", null).dias, 0);
});

test("o texto do atraso diz de onde a contagem começa no fim de semana", () => {
  const a = atrasoDoPagamento("2026-10-20", "2026-10-17");
  assert.equal(textoDoAtraso(a, "2026-10-17"), "1 dia depois do vencimento (17/10/2026, sábado, conta a partir de 19/10/2026)");
});

// --- A fatura do cartão -------------------------------------------------------

// Os cartões de teste do banco: fecha no dia 25, vence no dia 5.
const CARTAO: CartaoDaFatura = { id: "c1", dia_fechamento_fatura: 25, dia_vencimento_fatura: 5 };

const fatura = (
  competenciaFechamento: string,
  status: FaturaDoCartaoNaBaixa["status"],
  codigo: string,
  dataVencimento: string,
): FaturaDoCartaoNaBaixa => ({ id: codigo, codigo, cartaoId: "c1", competenciaFechamento, dataVencimento, status });

test("as datas da competência: fecha no dia 25, vence no dia 5 do mês seguinte", () => {
  assert.deepEqual(datasDaCompetencia(CARTAO, 2026, 10), { competencia: "2026-10", fecha: "2026-10-25", vence: "2026-11-05" });
  // Dezembro vira o ano.
  assert.deepEqual(datasDaCompetencia(CARTAO, 2026, 12), { competencia: "2026-12", fecha: "2026-12-25", vence: "2027-01-05" });
});

test("fechamento no dia 31 em mês curto cai no último dia", () => {
  const c: CartaoDaFatura = { id: "c2", dia_fechamento_fatura: 31, dia_vencimento_fatura: 10 };
  assert.equal(datasDaCompetencia(c, 2027, 2).fecha, "2027-02-28");
});

test("cartão sem dia de fechamento vence no próprio mês", () => {
  const c: CartaoDaFatura = { id: "c3", dia_fechamento_fatura: null, dia_vencimento_fatura: 20 };
  assert.deepEqual(datasDaCompetencia(c, 2026, 10), { competencia: "2026-10", fecha: "2026-10-20", vence: "2026-10-20" });
});

test("o pagamento até o fechamento cai na competência do mês; depois, na seguinte", () => {
  assert.equal(faturaDestino(CARTAO, "2026-10-21", [])?.competencia, "2026-10");
  assert.equal(faturaDestino(CARTAO, "2026-10-25", [])?.competencia, "2026-10");
  assert.equal(faturaDestino(CARTAO, "2026-10-26", [])?.competencia, "2026-11");
});

test("competência fechada empurra para a próxima", () => {
  const faturas = [fatura("2026-10-25", "fechada", "FC-00010", "2026-11-05")];
  const d = faturaDestino(CARTAO, "2026-10-21", faturas);
  assert.equal(d?.competencia, "2026-11");
  assert.equal(d?.existente, null);
});

test("a fatura aberta da competência é a de destino, com as datas dela", () => {
  const faturas = [fatura("2026-10-25", "aberta", "FC-00010", "2026-11-06")];
  const d = faturaDestino(CARTAO, "2026-10-21", faturas);
  assert.equal(d?.existente?.codigo, "FC-00010");
  assert.equal(d?.vence, "2026-11-06");
});

test("as opções: as abertas, a da data (nova) e a competência seguinte à última", () => {
  // Como o ZZ Teste Fatia 2 em 21/10/2026: 09/2026 paga, 11/2026 aberta.
  const faturas = [
    fatura("2026-09-25", "paga", "FC-00003", "2026-10-05"),
    fatura("2026-11-25", "aberta", "FC-00006", "2026-12-05"),
  ];
  const destino = faturaDestino(CARTAO, "2026-10-21", faturas);
  const ops = opcoesDeFatura(CARTAO, faturas, destino);
  assert.deepEqual(
    ops.map((o) => [o.competencia, o.existente?.codigo ?? "nova", o.padrao]),
    [
      ["2026-10", "nova", true],
      ["2026-11", "FC-00006", false],
      ["2026-12", "nova", false],
    ],
  );
});

test("fechada e paga nunca entram nas opções", () => {
  const faturas = [
    fatura("2026-09-25", "fechada", "FC-00004", "2026-10-05"),
    fatura("2026-10-25", "paga", "FC-00005", "2026-11-05"),
  ];
  const ops = opcoesDeFatura(CARTAO, faturas, faturaDestino(CARTAO, "2026-10-21", faturas));
  assert.ok(ops.every((o) => o.existente === null || o.existente.status === "aberta"));
  assert.deepEqual(ops.map((o) => o.competencia), ["2026-11", "2026-12"]);
});

test("faturas de outro cartão não contam", () => {
  const outra: FaturaDoCartaoNaBaixa = { ...fatura("2026-10-25", "aberta", "FC-00099", "2026-11-05"), cartaoId: "outro" };
  const ops = opcoesDeFatura(CARTAO, [outra], faturaDestino(CARTAO, "2026-10-21", [outra]));
  assert.deepEqual(ops.map((o) => o.existente), [null, null]);
});

test("o rótulo e o que vai ao banco", () => {
  assert.equal(rotuloDaCompetencia("2026-10"), "out/26");
  assert.equal(competenciaParaOBanco("2026-10"), "2026-10-01");
});
