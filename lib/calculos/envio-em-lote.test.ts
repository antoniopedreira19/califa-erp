/**
 * Testes do rateio do envio em lote — decisão 188 (19/10/2026).
 *
 * Rode com:  node --import tsx --test lib/calculos/envio-em-lote.test.ts
 *
 * O caso grande tem a forma do Fee Ânima: 4 jobs mensais e 18 notas, uma por
 * instituição, sem que nenhum grupo de notas inteiras feche um job — o
 * rateio proporcional tem de fechar cada job no centavo.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MANUAL,
  PROPORCIONAL,
  centavos,
  centavosDoJobNasNotas,
  copiarNotas,
  escalarCentavos,
  parcelasDaParte,
  ratearNotas,
  trocarMesNoTexto,
  type JobParaRatear,
  type NotaParaCopiar,
  type NotaParaRatear,
} from "./envio-em-lote";

const somaDaNota = (p: Record<string, number>) => Object.values(p).reduce((s, x) => s + x, 0);

test("uma nota para todos os jobs: cada job inteiro nela", () => {
  const jobs: JobParaRatear[] = [
    { id: "a", valor: 84500 },
    { id: "b", valor: 38900 },
  ];
  const notas: NotaParaRatear[] = [{ id: "n1", valor: 123400, modo: PROPORCIONAL }];
  const p = ratearNotas(notas, jobs);
  assert.deepEqual(p.n1, { a: 8450000, b: 3890000 });
});

test("18 notas proporcionais fecham os 4 jobs no centavo", () => {
  const jobs: JobParaRatear[] = [
    { id: "mg", valor: 175000 },
    { id: "ne", valor: 152380.4 },
    { id: "sp", valor: 190000 },
    { id: "sul", valor: 161420.55 },
  ];
  const valores = [
    113056.52, 138739.06, 117226.61, 37004.2, 39046.07, 27576.84, 20415.74, 34626.23, 37300.48,
    16465.09, 5637.95, 2418.76, 6471.41, 3795.22, 17868.75, 8266.54, 11158.37, 41727.11,
  ];
  const notas: NotaParaRatear[] = valores.map((v, i) => ({ id: `n${i}`, valor: v, modo: PROPORCIONAL }));
  const p = ratearNotas(notas, jobs);
  for (const j of jobs) assert.equal(centavosDoJobNasNotas(p, j.id), centavos(j.valor), j.id);
  notas.forEach((n) => assert.equal(somaDaNota(p[n.id]), centavos(n.valor), n.id));
});

test("nota só de um job: o resto dele vai para as proporcionais", () => {
  const jobs: JobParaRatear[] = [
    { id: "a", valor: 1000 },
    { id: "b", valor: 1000 },
  ];
  const notas: NotaParaRatear[] = [
    { id: "n1", valor: 600, modo: "a" },
    { id: "n2", valor: 1400, modo: PROPORCIONAL },
  ];
  const p = ratearNotas(notas, jobs);
  assert.deepEqual(p.n1, { a: 60000 });
  assert.deepEqual(p.n2, { a: 40000, b: 100000 });
});

test("dividida à mão entra como foi escrita", () => {
  const jobs: JobParaRatear[] = [
    { id: "a", valor: 500 },
    { id: "b", valor: 500 },
  ];
  const notas: NotaParaRatear[] = [
    { id: "n1", valor: 300, modo: MANUAL, manual: { a: 100, b: 200 } },
    { id: "n2", valor: 700, modo: PROPORCIONAL },
  ];
  const p = ratearNotas(notas, jobs);
  assert.deepEqual(p.n1, { a: 10000, b: 20000 });
  assert.deepEqual(p.n2, { a: 40000, b: 30000 });
});

test("parcelas da parte: iguais, sobra na última, de 30 em 30 dias", () => {
  const ps = parcelasDaParte(10001, 3, "2026-11-10");
  assert.deepEqual(ps, [
    { valor: 33.33, data_vencimento: "2026-11-10" },
    { valor: 33.33, data_vencimento: "2026-12-10" },
    { valor: 33.35, data_vencimento: "2027-01-09" },
  ]);
});

// ---------------------------------------------------------------------------
// Copiar de um envio anterior (entrega 3)
// ---------------------------------------------------------------------------

test("escalar mantém a proporção e fecha os centavos na última", () => {
  const novos = escalarCentavos([10000, 20000, 30001], 70000);
  assert.equal(novos.reduce((a, b) => a + b, 0), 70000);
  assert.deepEqual(novos.slice(0, 2), [11666, 23333]);
});

test("o mês troca na caixa em que estava, e o ano vira na virada", () => {
  assert.equal(
    trocarMesNoTexto("Conteúdo de Outubro para a OUTUBRO SA, referente a outubro", "2026-10-01", "2026-11-01"),
    "Conteúdo de Novembro para a NOVEMBRO SA, referente a novembro",
  );
  assert.equal(
    trocarMesNoTexto("Fee de dezembro de 2026 e dezembro/2026", "2026-12-01", "2027-01-01"),
    "Fee de janeiro de 2027 e janeiro/2027",
  );
  // Mês de outro ano não é o mês do envio; e "Março" com cedilha.
  assert.equal(trocarMesNoTexto("ref. outubro/2025", "2026-10-01", "2026-11-01"), "ref. outubro/2025");
  assert.equal(trocarMesNoTexto("Serviços de Março", "2027-03-01", "2027-04-01"), "Serviços de Abril");
  // Parte de outra palavra não troca.
  assert.equal(trocarMesNoTexto("maiores", "2026-05-01", "2026-06-01"), "maiores");
});

test("copiar: valores na proporção; Só o job de fora e à mão voltam para Proporcional", () => {
  const notas: NotaParaCopiar[] = [
    { tomador: "BH", cnpj: "11222333000181", exterior: false, valor: 600, descritivo: "outubro", modo: PROPORCIONAL },
    { tomador: "SP", cnpj: "11222333000181", exterior: false, valor: 300, descritivo: "outubro", modo: "sp" },
    { tomador: "RJ", cnpj: null, exterior: true, valor: 100, descritivo: "", modo: MANUAL },
  ];
  const r = copiarNotas(notas, {
    jobs: ["mg", "sp"],
    totalCentavos: 200000,
    ajustar: true,
    mesDe: "2026-10-01",
    mesPara: "2026-11-01",
  });
  assert.equal(r.ajustou, true);
  assert.deepEqual(
    r.notas.map((n) => n.valor),
    [1200, 600, 200],
  );
  assert.deepEqual(
    r.notas.map((n) => n.modo),
    [PROPORCIONAL, "sp", PROPORCIONAL],
  );
  assert.equal(r.voltaramDeManual, 1);
  assert.equal(r.voltaramDeJob, 0);
  assert.equal(r.trocouMes, true);
  assert.equal(r.notas[0].descritivo, "novembro");
  assert.equal(r.notas[2].exterior, true);

  const iguais = copiarNotas(notas, { jobs: ["mg"], totalCentavos: 200000, ajustar: false, mesDe: null, mesPara: null });
  assert.equal(iguais.ajustou, false);
  assert.deepEqual(
    iguais.notas.map((n) => n.valor),
    [600, 300, 100],
  );
  assert.equal(iguais.voltaramDeJob, 1);
  assert.equal(iguais.trocouMes, false);
});
