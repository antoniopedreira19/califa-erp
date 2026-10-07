import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alterarRecebimento,
  somarMeses,
  type MesDoEnvio,
  type RecebimentoDoMes,
} from "./recebimento-por-mes";

// Decisão 149: a data de recebimento de cada mês no envio do Fee e do
// Always On. Só o primeiro mês sugere, e só nos meses vazios.

const trimestre: MesDoEnvio[] = [
  { mes: "2026-10-01", faturamento: 72449.36 },
  { mes: "2026-11-01", faturamento: 72449.36 },
  { mes: "2026-12-01", faturamento: 72449.36 },
];
const vazio = (): RecebimentoDoMes[] =>
  trimestre.map((m) => ({ mes: m.mes, data: "", sugerida: false }));
const datas = (l: RecebimentoDoMes[]) => l.map((r) => r.data);

test("somarMeses mantém o dia e vira o último dia do mês quando ele não existe", () => {
  assert.equal(somarMeses("2026-11-20", 1), "2026-12-20");
  assert.equal(somarMeses("2026-11-20", 2), "2027-01-20");
  assert.equal(somarMeses("2026-10-31", 1), "2026-11-30");
  assert.equal(somarMeses("2027-01-31", 1), "2027-02-28");
});

test("o primeiro mês sugere a data dos meses seguintes vazios", () => {
  const l = alterarRecebimento(vazio(), trimestre, "2026-10-01", "2026-11-20");
  assert.deepEqual(datas(l), ["2026-11-20", "2026-12-20", "2027-01-20"]);
  assert.deepEqual(l.map((r) => r.sugerida), [false, true, true]);
});

test("mês do meio não mexe em nenhum outro", () => {
  const l = alterarRecebimento(vazio(), trimestre, "2026-11-01", "2026-12-10");
  assert.deepEqual(datas(l), ["", "2026-12-10", ""]);
});

test("mês já preenchido não muda quando o primeiro é escolhido", () => {
  const comNovembro = alterarRecebimento(vazio(), trimestre, "2026-11-01", "2026-12-10");
  const l = alterarRecebimento(comNovembro, trimestre, "2026-10-01", "2026-11-20");
  assert.deepEqual(datas(l), ["2026-11-20", "2026-12-10", "2027-01-20"]);
});

test("mudar o primeiro de novo não mexe nos meses já preenchidos e tira o 'sugerida'", () => {
  const primeira = alterarRecebimento(vazio(), trimestre, "2026-10-01", "2026-11-20");
  const l = alterarRecebimento(primeira, trimestre, "2026-10-01", "2026-11-25");
  assert.deepEqual(datas(l), ["2026-11-25", "2026-12-20", "2027-01-20"]);
  assert.deepEqual(l.map((r) => r.sugerida), [false, false, false]);
});

test("limpar o primeiro não apaga os outros; escolher de novo preenche só o que ficou vazio", () => {
  const primeira = alterarRecebimento(vazio(), trimestre, "2026-10-01", "2026-11-20");
  const semDezembro = alterarRecebimento(primeira, trimestre, "2026-12-01", "");
  const limpo = alterarRecebimento(semDezembro, trimestre, "2026-10-01", "");
  assert.deepEqual(datas(limpo), ["", "2026-12-20", ""]);
  const l = alterarRecebimento(limpo, trimestre, "2026-10-01", "2026-11-05");
  assert.deepEqual(datas(l), ["2026-11-05", "2026-12-20", "2027-01-05"]);
});

test("mês sem faturamento não recebe sugestão, e o primeiro é o primeiro COM faturamento", () => {
  const meses: MesDoEnvio[] = [
    { mes: "2026-10-01", faturamento: 0 },
    { mes: "2026-11-01", faturamento: 1000 },
    { mes: "2026-12-01", faturamento: 1000 },
  ];
  const linhas = meses.map((m) => ({ mes: m.mes, data: "", sugerida: false }));
  const l = alterarRecebimento(linhas, meses, "2026-11-01", "2026-12-15");
  assert.deepEqual(datas(l), ["", "2026-12-15", "2027-01-15"]);
});
