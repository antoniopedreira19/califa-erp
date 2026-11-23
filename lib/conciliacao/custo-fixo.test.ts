/**
 * Testes do reconhecimento do custo fixo (decisão 272): a regra sozinha e o
 * passo 3 do motor com ela.
 *
 * Rode com:  node --import tsx --test lib/conciliacao/custo-fixo.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { reconhecerCustoFixo, type CustoFixoDoTitulo } from "./custo-fixo";
import { casar, type TituloDoMotor } from "./motor";

const fixo: CustoFixoDoTitulo = { codigo: "REC-00001", variavel: false, textoNoExtrato: null };
const varia: CustoFixoDoTitulo = { codigo: "REC-00007", variavel: true, textoNoExtrato: null };
const debito: CustoFixoDoTitulo = { codigo: "REC-00006", variavel: false, textoNoExtrato: "DEBITO AUTOMATICO FIBRA" };
const linha = (data: string, valor: number, historico = "PAGAMENTO DE TITULO") => ({ data, valor, historico });

test("custo fixo: valor exato um dia depois do vencimento (domingo → segunda)", () => {
  const r = reconhecerCustoFixo(fixo, linha("2026-11-09", -18500), "2026-11-08", 18500);
  assert.ok(r);
  assert.equal(r.valorIgual, true);
  assert.equal(r.diasDoVencimento, 1);
  assert.equal(r.motivo, "custo fixo REC-00001 · valor exato · 1 dia depois do vencimento (08/11)");
});

test("custo fixo: a conta do dia 20 paga no lote do dia 9 (11 dias antes) entra; 13 dias antes não", () => {
  assert.ok(reconhecerCustoFixo(fixo, linha("2026-11-09", -1240), "2026-11-20", 1240));
  assert.equal(reconhecerCustoFixo(fixo, linha("2026-11-07", -1240), "2026-11-20", 1240), null);
  assert.equal(reconhecerCustoFixo(fixo, linha("2026-11-26", -1240), "2026-11-20", 1240), null);
});

test("custo fixo de valor fixo: valor diferente não entra", () => {
  assert.equal(reconhecerCustoFixo(fixo, linha("2026-11-09", -18600), "2026-11-08", 18500), null);
});

test("conta que varia: até 20% entra e diz a diferença; acima não", () => {
  const r = reconhecerCustoFixo(varia, linha("2026-11-09", -1951.08), "2026-11-08", 1874.32);
  assert.ok(r);
  assert.equal(r.valorIgual, false);
  assert.equal(r.diferenca, 76.76);
  assert.match(r.motivo, /conta que varia: R\$\s1\.874,32 previsto, R\$\s1\.951,08 no banco \(\+R\$\s76,76\)/);
  assert.equal(reconhecerCustoFixo(varia, linha("2026-11-09", -2300), "2026-11-08", 1874.32), null);
});

test("débito automático: o texto do extrato pesa a favor, sem acento nem espaço", () => {
  const r = reconhecerCustoFixo(debito, linha("2026-11-09", -699.9, "Débito automático fibra exemplo"), "2026-11-08", 699.9);
  assert.ok(r);
  assert.equal(r.bonus, 40);
  assert.match(r.motivo, /débito automático pelo texto do extrato/);
});

test("entrada no banco nunca paga custo fixo", () => {
  assert.equal(reconhecerCustoFixo(fixo, linha("2026-11-09", 18500), "2026-11-08", 18500), null);
});

// --- No motor -------------------------------------------------------------------

const titulo = (id: string, liquido: number, extra: Partial<TituloDoMotor> = {}): TituloDoMotor => ({
  id,
  lado: "pagar",
  origem: "recorrencia",
  ref: id,
  contraparte: "FORNECEDOR 001 EXEMPLO",
  vencimento: "2026-11-08",
  valor: liquido,
  liquido,
  forma: null,
  centro: { tipo: "04", sub: "Aluguel" },
  ...extra,
});
const vazio = { titulos: [], lancamentos: [], lotes: [], regras: [] };
const mov = (data: string, valor: number, historico = "PAGAMENTO DE TITULO") => ({ ordem: 0, data, valor, historico });

test("motor: sem o custo fixo, o título do dia 08 não é sugerido para a linha do dia 09", () => {
  const [r] = casar([mov("2026-11-09", -18500)], { ...vazio, titulos: [titulo("pagar|recorrencia|1", 18500)] });
  assert.notEqual(r.estado, "sugestao");
});

test("motor: com o custo fixo, o título é sugerido e a frase diz por quê", () => {
  const [r] = casar([mov("2026-11-09", -18500)], {
    ...vazio,
    titulos: [titulo("pagar|recorrencia|1", 18500, { custoFixo: fixo })],
  });
  assert.equal(r.estado, "sugestao");
  assert.equal(r.titulo?.id, "pagar|recorrencia|1");
  assert.equal(r.confianca, "alta");
  assert.equal(r.motivo, "custo fixo REC-00001 · valor exato · 1 dia depois do vencimento (08/11)");
});

test("motor: a conta que varia vem como média, nunca como certa", () => {
  const [r] = casar([mov("2026-11-09", -1951.08)], {
    ...vazio,
    titulos: [titulo("pagar|recorrencia|7", 1874.32, { custoFixo: varia })],
  });
  assert.equal(r.estado, "sugestao");
  assert.equal(r.confianca, "media");
});

test("motor: o valor exato no mesmo dia continua pela regra de sempre", () => {
  const [r] = casar([mov("2026-11-08", -18500)], {
    ...vazio,
    titulos: [titulo("pagar|recorrencia|1", 18500, { custoFixo: fixo })],
  });
  assert.equal(r.estado, "sugestao");
  assert.match(r.motivo ?? "", /^valor exato/);
});
