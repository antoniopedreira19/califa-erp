/**
 * Testes do faturamento dos jobs do histórico (decisão 211, A4): a situação de
 * cada job pelas notas dele, os grupos por cliente, marca e job, e o total.
 * Os valores são fictícios.
 *
 * Rode com:  node --import tsx --test lib/historico-financeiro/faturamento.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobsDoEmissor, montarFaturamento, montarPorCnpj, rotuloDoEmissor, situacaoDoJob, type JobFaturadoDoHistorico, type NotaDoHistorico } from "./faturamento";

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
  emissores: {},
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

test("o filtro do emissor troca as somas do job pelas notas dele", () => {
  const jobs = [
    job("A", 3, 1_000, 600, { emissores: { "California · Salvador": { notas: 2, faturado: 700, recebido: 600 }, "GoCrazy · São Paulo": { notas: 1, faturado: 300, recebido: 0 } } }),
    job("B", 0, 0, 0),
  ];
  assert.equal(jobsDoEmissor(jobs, null).length, 2);
  const go = jobsDoEmissor(jobs, "GoCrazy · São Paulo");
  assert.deepEqual(go.map((j) => [j.chave, j.notas, j.faturado, j.recebido]), [["A", 1, 300, 0]]);
  assert.equal(rotuloDoEmissor("GoCrazy (aba Faturamento Go Crazy)"), "GoCrazy");
  assert.equal(rotuloDoEmissor("California · Salvador"), "California · Salvador");
});

const nota = (estabelecimento: string, emissao: string, valor: number, extra: Partial<NotaDoHistorico> = {}): NotaDoHistorico => ({
  estabelecimento, aba: "Faturamento Exemplo", linha: 1, numero: "1", classe: "job", empresa: "Agência California",
  job: "JOB 001 EXEMPLO", cliente: "CLIENTE 001 EXEMPLO", emissao, vencimento: null, recebimento: null, valor, impostos: 0, ...extra,
});

test("por CNPJ, cada nota cai no mês da emissão e a fora de job soma marcada", () => {
  const r = montarPorCnpj([
    nota("A", "2025-01-10", 100, { recebimento: "2025-02-01" }),
    nota("A", "2025-01-20", 50, { classe: "distribuição de lucro", recebimento: "2025-01-20" }),
    nota("A", "2025-12-01", 30),
    nota("B", "2025-03-05", 500, { recebimento: "2025-04-01" }),
  ]);
  assert.deepEqual(r.linhas.map((l) => [l.rotulo, l.notas, l.faturado, l.recebido, l.aReceber, l.foraDeJob]), [
    ["B", 1, 500, 500, 0, 0],
    ["A", 3, 180, 150, 30, 50],
  ]);
  assert.equal(r.linhas[1].meses[0], 150);
  assert.equal(r.linhas[1].meses[11], 30);
  assert.deepEqual([r.total.notas, r.total.faturado, r.total.aReceber, r.total.meses[2]], [4, 680, 30, 500]);
});
