/**
 * Testes da situação de recebimento da nota emitida (decisão 260): a
 * situação da nota inteira e os pedaços que viram linhas nos chips.
 * Rodar: node --import tsx --test "app/(app)/financeiro/contas-a-receber/situacao-da-nota.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recebimentoDaNota, type TituloDaNota } from "./situacao-da-nota";

const HOJE = "2026-11-16";

function titulo(t: Partial<TituloDaNota> & { valor: number; data_vencimento: string }): TituloDaNota {
  return { status: "em_aberto", baixado: 0, baixas: [], pago_em: null, ...t };
}

test("sem título nenhum, a nota inteira está a receber", () => {
  const r = recebimentoDaNota([], HOJE, 1000);
  assert.equal(r.situacao, "a_receber");
  assert.equal(r.detalhe, null);
  assert.deepEqual(
    r.partes.map((p) => [p.tipo, p.valor]),
    [["a_receber", 1000]],
  );
});

test("nada recebido e nada vencido: a receber, uma linha", () => {
  const r = recebimentoDaNota([titulo({ valor: 25000, data_vencimento: "2026-12-05" })], HOJE, 25000);
  assert.equal(r.situacao, "a_receber");
  assert.deepEqual(
    r.partes.map((p) => [p.tipo, p.valor]),
    [["a_receber", 25000]],
  );
  assert.match(r.partes[0].dica, /05\/12\/2026/);
});

test("todas as parcelas pagas: recebida, com a data do último pagamento", () => {
  const r = recebimentoDaNota(
    [
      titulo({ valor: 100, data_vencimento: "2026-09-10", status: "pago", baixado: 100, pago_em: "2026-09-09" }),
      titulo({ valor: 50, data_vencimento: "2026-10-10", status: "pago", baixado: 50, pago_em: "2026-10-16" }),
    ],
    HOJE,
    150,
  );
  assert.equal(r.situacao, "recebida");
  assert.equal(r.detalhe, "Em 16/10/2026");
  assert.deepEqual(
    r.partes.map((p) => [p.tipo, p.valor]),
    [["recebido", 150]],
  );
});

test("paga, vencida sem nada e a vencer recebida pela metade: três pedaços, inadimplente", () => {
  // O caso da NF 312 do protótipo: a 1 paga, a 2 vencida, a 3 pela metade.
  const r = recebimentoDaNota(
    [
      titulo({ valor: 93005.65 - 25365.17, data_vencimento: "2026-09-26", status: "pago", baixado: 93005.65 - 25365.17, pago_em: "2026-09-25" }),
      titulo({ valor: 50730.35, data_vencimento: "2026-10-26" }),
      titulo({ valor: 50730.35, data_vencimento: "2026-11-26", baixado: 25365.17, baixas: [{}] }),
    ],
    HOJE,
    169101.18,
  );
  assert.equal(r.situacao, "inadimplente");
  assert.equal(r.detalhe, "Vencida há 21 dias");
  assert.deepEqual(
    r.partes.map((p) => [p.tipo, p.valor]),
    [
      ["recebido", 93005.65],
      ["inadimplente", 50730.35],
      ["a_receber", 25365.18],
    ],
  );
  const soma = r.partes.reduce((s, p) => s + p.valor, 0);
  assert.equal(Math.round(soma * 100) / 100, 169101.18);
});

test("parcela vencida que já começou a ser paga não é inadimplente (decisão 125)", () => {
  const r = recebimentoDaNota(
    [titulo({ valor: 1000, data_vencimento: "2026-11-01", baixado: 400, baixas: [{}] })],
    HOJE,
    1000,
  );
  assert.equal(r.situacao, "parcial");
  assert.match(r.detalhe ?? "", /^Falta R\$\s600,00$/);
  assert.deepEqual(
    r.partes.map((p) => [p.tipo, p.valor]),
    [
      ["recebido", 400],
      ["a_receber", 600],
    ],
  );
  assert.match(r.partes[1].dica, /já começou a ser paga/);
});

test("título cancelado não conta", () => {
  const r = recebimentoDaNota(
    [
      titulo({ valor: 500, data_vencimento: "2026-10-01", status: "cancelado" }),
      titulo({ valor: 500, data_vencimento: "2026-12-01" }),
    ],
    HOJE,
    1000,
  );
  assert.equal(r.situacao, "a_receber");
  assert.deepEqual(
    r.partes.map((p) => [p.tipo, p.valor]),
    [["a_receber", 500]],
  );
});
