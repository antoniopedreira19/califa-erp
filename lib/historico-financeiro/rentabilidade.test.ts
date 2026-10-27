/**
 * Testes da rentabilidade dos jobs do histórico (decisão 211, A4): o resultado
 * e o fee líquido como as colunas das abas Res. Jobs, os grupos por cliente,
 * marca e job, e os percentuais. Os valores são fictícios.
 *
 * Rode com:  node --import tsx --test lib/historico-financeiro/rentabilidade.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { contasDoJob, montarRentabilidade, type JobDoHistorico } from "./rentabilidade";

const job = (chave: string, receita: number, imposto: number, custo: number, extra: Partial<JobDoHistorico> = {}): JobDoHistorico => ({
  chave,
  nome: `JOB ${chave} EXEMPLO`,
  empresa: "Agência California",
  trimestre: "1T",
  clienteId: null,
  cliente: null,
  marcaId: null,
  marca: null,
  feePercentual: 0.12,
  receita,
  imposto,
  custo,
  ...extra,
});

test("o resultado e o fee líquido seguem as colunas da aba Res. Jobs", () => {
  // Receita 112.000, imposto 2.240 e custo 50.000: o fee de 12% por dentro de 109.760 é 11.760.
  const c = contasDoJob(job("A", 112_000, 2_240, 50_000));
  assert.equal(c.resultado, 59_760);
  assert.equal(Math.round(c.fee * 100) / 100, 11_760);
  assert.equal(Math.round(c.rentabilidade * 100) / 100, 48_000);
  // Sem percentual na planilha, o fee fica zero e a rentabilidade é o resultado.
  const semFee = contasDoJob(job("B", 1_000, 0, 400, { feePercentual: null }));
  assert.equal(semFee.fee, 0);
  assert.equal(semFee.rentabilidade, 600);
});

test("os grupos por cliente somam os jobs e calculam o % sobre a receita do grupo", () => {
  const jobs = [
    job("A", 1_000, 50, 400, { clienteId: "c1", cliente: "CLIENTE 001 EXEMPLO" }),
    job("B", 3_000, 150, 1_000, { clienteId: "c1", cliente: "CLIENTE 001 EXEMPLO" }),
    job("C", 1_000, 0, 900, { cliente: "Cliente 002 da planilha" }),
    job("D", 500, 0, 100),
  ];
  const r = montarRentabilidade(jobs, "cliente");
  assert.deepEqual(r.linhas.map((l) => [l.rotulo, l.jobs, l.receita]), [
    ["CLIENTE 001 EXEMPLO", 2, 4_000],
    ["Cliente 002 da planilha", 1, 1_000],
    ["(sem cliente)", 1, 500],
  ]);
  const c1 = r.linhas[0];
  assert.equal(c1.resultado, 2_400);
  assert.equal(c1.resultadoPct, 60);
  assert.equal(c1.representatividadePct, (4_000 / 5_500) * 100);
  assert.equal(r.total.receita, 5_500);
  assert.equal(r.total.representatividadePct, 100);
  // O total é o mesmo em todas as visões.
  for (const visao of ["marca", "job"] as const) assert.equal(montarRentabilidade(jobs, visao).total.resultado, r.total.resultado);
});

test("na visão por job, o detalhe traz o cliente e a marca", () => {
  const r = montarRentabilidade([job("A", 100, 0, 0, { cliente: "CLIENTE 001 EXEMPLO", marca: "MARCA 001" })], "job");
  assert.equal(r.linhas[0].rotulo, "JOB A EXEMPLO");
  assert.equal(r.linhas[0].detalhe, "CLIENTE 001 EXEMPLO · MARCA 001");
});

test("sem receita, os percentuais ficam vazios, e os jobs sem fee são contados", () => {
  const r = montarRentabilidade([job("A", 0, 0, 300, { feePercentual: null })], "job");
  assert.equal(r.linhas[0].resultadoPct, null);
  assert.equal(r.linhas[0].rentabilidadePct, null);
  assert.equal(r.linhas[0].resultado, -300);
  assert.equal(r.semFee, 1);
});
