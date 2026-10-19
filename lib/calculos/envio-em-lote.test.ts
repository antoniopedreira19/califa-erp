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
  parcelasDaParte,
  ratearNotas,
  type JobParaRatear,
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
