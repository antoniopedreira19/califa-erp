/**
 * Testes do faturamento dos jobs do histórico (decisão 211, A4): a situação de
 * cada job pelas notas dele, os grupos por cliente, marca e job, e o total.
 * Os valores são fictícios.
 *
 * Rode com:  node --import tsx --test lib/historico-financeiro/faturamento.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { montarFaturamento, situacaoDoJob, type JobFaturadoDoHistorico } from "./faturamento";

const job = (chave: string, notas: number, faturado: number, recebido: number, extra: Partial<JobFaturadoDoHistorico> = {}): JobFaturadoDoHistorico => ({
  chave,
  nome: `JOB ${chave} EXEMPLO`,
  empresa: "Agência California",
  trimestre: "1T",
  clienteId: null,
  cliente: null,
  marcaId: null,
  marca: null,
  notas,
  faturado,
  recebido,
  ...extra,
});

test("a situação do job sai das notas dele", () => {
  assert.equal(situacaoDoJob(job("A", 0, 0, 0)), "sem_nota");
  assert.equal(situacaoDoJob(job("B", 2, 1_000, 0)), "a_receber");
  assert.equal(situacaoDoJob(job("C", 2, 1_000, 400)), "parcial");
  assert.equal(situacaoDoJob(job("D", 2, 1_000, 1_000)), "recebido");
  // A soma em ponto flutuante não deixa um job recebido como parcial.
  assert.equal(situacaoDoJob(job("E", 3, 0.1 + 0.2, 0.3)), "recebido");
  // Nota de valor zero sem recebimento não deixa nada a receber.
  assert.equal(situacaoDoJob(job("F", 1, 0, 0)), "recebido");
});

test("os grupos por cliente somam as notas, o faturado e o a receber", () => {
  const jobs = [
    job("A", 2, 1_000, 1_000, { clienteId: "c1", cliente: "CLIENTE 001 EXEMPLO" }),
    job("B", 1, 3_000, 0, { clienteId: "c1", cliente: "CLIENTE 001 EXEMPLO" }),
    job("C", 1, 5_000, 2_000, { cliente: "Cliente 002 da planilha" }),
    job("D", 0, 0, 0),
  ];
  const r = montarFaturamento(jobs, "cliente");
  assert.deepEqual(
    r.linhas.map((l) => [l.rotulo, l.jobs, l.notas, l.faturado, l.recebido, l.aReceber, l.situacao]),
    [
      ["Cliente 002 da planilha", 1, 1, 5_000, 2_000, 3_000, null],
      ["CLIENTE 001 EXEMPLO", 2, 3, 4_000, 1_000, 3_000, null],
      ["(sem cliente)", 1, 0, 0, 0, 0, null],
    ],
  );
  assert.deepEqual([r.total.jobs, r.total.notas, r.total.faturado, r.total.recebido, r.total.aReceber], [4, 4, 9_000, 3_000, 6_000]);
  assert.equal(r.semNota, 1);
  // O total é o mesmo em todas as visões.
  for (const visao of ["marca", "job"] as const) assert.deepEqual(montarFaturamento(jobs, visao).total, r.total);
});

test("na visão por job, cada linha traz a situação, o cliente e a marca", () => {
  const r = montarFaturamento(
    [
      job("A", 1, 100, 0, { cliente: "CLIENTE 001 EXEMPLO", marca: "MARCA 001" }),
      job("B", 0, 0, 0),
      job("C", 2, 300, 300),
    ],
    "job",
  );
  assert.deepEqual(
    r.linhas.map((l) => [l.rotulo, l.situacao, l.detalhe]),
    [
      ["JOB C EXEMPLO", "recebido", null],
      ["JOB A EXEMPLO", "a_receber", "CLIENTE 001 EXEMPLO · MARCA 001"],
      ["JOB B EXEMPLO", "sem_nota", null],
    ],
  );
});
