/**
 * Testes da esteira do faturamento — decisão 075.
 *
 * Rode com:  node --import tsx --test lib/calculos/esteira-faturamento.test.ts
 *
 * Os números são os do Projeto Teste (`0-0001/26`): JOB-0029 com
 * faturamento previsto de R$ 31.919,72 e JOB-0033 com R$ 113.897,60. Nenhum
 * destes cenários precisa de nota emitida no banco — é para isso que a
 * regra mora em `lib/calculos/`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classificarFaturamento,
  consolidarNotasDoJob,
  type NotaDoJob,
} from "./esteira-faturamento";

const HOJE = "2026-09-14";

// NF agrupada de R$ 145.817,32 em 2 títulos de R$ 72.908,66.
const TOTAL_AGRUPADA = 145817.32;
function agrupada(
  parte: number,
  titulos: NotaDoJob["titulos"],
): NotaDoJob {
  return {
    id: "nf-agrupada",
    numero: "500",
    data_emissao: "2026-09-01",
    valor_total: TOTAL_AGRUPADA,
    parte_do_job: parte,
    titulos,
  };
}

test("sem nota: a classificação antiga continua valendo", () => {
  const semEnvio = consolidarNotasDoJob([], false, HOJE);
  assert.equal(semEnvio.situacao, "aguardando_envio");
  assert.equal(semEnvio.valor_faturado, null);
  assert.equal(semEnvio.numeros_nf, null);

  assert.equal(consolidarNotasDoJob([], true, HOJE).situacao, "enviado");
  // Nada a faturar (decisão 105): era "faturado" até 25/09/2026.
  assert.equal(
    consolidarNotasDoJob([], false, HOJE, true).situacao,
    "sem_faturamento",
  );
});

test("NF agrupada: cada job mostra a sua parte, nunca o total da nota", () => {
  const titulos = [
    { valor: 72908.66, vencimento: "2026-10-01", status: "em_aberto" },
    { valor: 72908.66, vencimento: "2026-11-01", status: "em_aberto" },
  ];
  const j29 = consolidarNotasDoJob([agrupada(31919.72, titulos)], true, HOJE);
  const j33 = consolidarNotasDoJob([agrupada(113897.6, titulos)], true, HOJE);

  assert.equal(j29.situacao, "faturado");
  assert.equal(j29.valor_faturado, 31919.72);
  assert.equal(j33.valor_faturado, 113897.6);
  assert.equal(j29.numeros_nf, "500");
  // As partes somam a nota — o total da agrupada não aparece duas vezes.
  assert.equal(
    Math.round(((j29.valor_faturado ?? 0) + (j33.valor_faturado ?? 0)) * 100) / 100,
    TOTAL_AGRUPADA,
  );
});

test("NF agrupada: um título vencido deixa TODOS os jobs da nota inadimplentes", () => {
  const titulos = [
    { valor: 72908.66, vencimento: "2026-09-10", status: "em_aberto" },
    { valor: 72908.66, vencimento: "2026-08-10", status: "pago" },
  ];
  const j29 = consolidarNotasDoJob([agrupada(31919.72, titulos)], true, HOJE);
  const j33 = consolidarNotasDoJob([agrupada(113897.6, titulos)], true, HOJE);

  assert.equal(j29.situacao, "inadimplente");
  assert.equal(j33.situacao, "inadimplente");
  assert.equal(j29.vencimento_em_aberto, "2026-09-10");
});

test("NF agrupada: o recebido é rateado pela parte do job", () => {
  const titulos = [
    { valor: 72908.66, vencimento: "2026-09-10", status: "em_aberto" },
    { valor: 72908.66, vencimento: "2026-08-10", status: "pago" },
  ];
  const j29 = consolidarNotasDoJob([agrupada(31919.72, titulos)], true, HOJE);
  const j33 = consolidarNotasDoJob([agrupada(113897.6, titulos)], true, HOJE);

  // 72.908,66 × 31.919,72 ÷ 145.817,32
  assert.equal(j29.valor_recebido, 15959.86);
  assert.equal(j33.valor_recebido, 56948.8);
  // O rateio não cria nem some dinheiro: soma o que entrou (±1 centavo).
  assert.ok(Math.abs(j29.valor_recebido + j33.valor_recebido - 72908.66) <= 0.01);
});

test("NF agrupada: só liquida quando todos os títulos da nota estão pagos", () => {
  const pagos = [
    { valor: 72908.66, vencimento: "2026-08-10", status: "pago" },
    { valor: 72908.66, vencimento: "2026-09-10", status: "pago" },
  ];
  const j29 = consolidarNotasDoJob([agrupada(31919.72, pagos)], true, HOJE);
  assert.equal(j29.situacao, "liquidado");
  assert.equal(j29.valor_recebido, 31919.72);
  assert.equal(j29.vencimento_em_aberto, null);
});

test("job em várias notas: soma as partes e lista os números em ordem de emissão", () => {
  const nf102: NotaDoJob = {
    id: "nf-102",
    numero: "102",
    data_emissao: "2026-10-01",
    valor_total: 56948.8,
    parte_do_job: 56948.8,
    titulos: [{ valor: 56948.8, vencimento: "2026-10-30", status: "em_aberto" }],
  };
  const nf101: NotaDoJob = {
    id: "nf-101",
    numero: "101",
    data_emissao: "2026-09-01",
    valor_total: 56948.8,
    parte_do_job: 56948.8,
    titulos: [{ valor: 56948.8, vencimento: "2026-09-30", status: "pago" }],
  };
  // A ordem de leitura do banco não pode mudar o resultado.
  const r = consolidarNotasDoJob([nf102, nf101], true, HOJE);

  assert.equal(r.valor_faturado, 113897.6);
  assert.equal(r.numeros_nf, "101 · 102");
  assert.equal(r.situacao, "faturado");
  assert.equal(r.valor_recebido, 56948.8);
  assert.equal(r.vencimento_em_aberto, "2026-10-30");
});

test("job em várias notas: um título vencido em qualquer uma basta", () => {
  const r = consolidarNotasDoJob(
    [
      {
        id: "a",
        numero: "101",
        data_emissao: "2026-08-01",
        valor_total: 56948.8,
        parte_do_job: 56948.8,
        titulos: [{ valor: 56948.8, vencimento: "2026-08-30", status: "pago" }],
      },
      {
        id: "b",
        numero: "102",
        data_emissao: "2026-09-01",
        valor_total: 56948.8,
        parte_do_job: 56948.8,
        titulos: [{ valor: 56948.8, vencimento: "2026-09-13", status: "em_aberto" }],
      },
    ],
    true,
    HOJE,
  );
  assert.equal(r.situacao, "inadimplente");
});

test("nota de um job com item de save: a parte é a nota inteira, como antes", () => {
  // Item próprio R$ 30.000 + item de save R$ 1.919,72 na mesma nota. Com
  // dois itens o `origem_id` do cabeçalho fica nulo — a leitura antiga
  // perdia esta nota.
  const r = consolidarNotasDoJob(
    [
      {
        id: "nf-save",
        numero: "200",
        data_emissao: "2026-09-01",
        valor_total: 31919.72,
        parte_do_job: 30000 + 1919.72,
        titulos: [{ valor: 31919.72, vencimento: "2026-09-30", status: "em_aberto" }],
      },
    ],
    true,
    HOJE,
  );
  assert.equal(r.valor_faturado, 31919.72);
  assert.equal(r.situacao, "faturado");
});

test("vencer hoje não é inadimplência (regra antiga preservada)", () => {
  assert.equal(
    classificarFaturamento(
      true,
      true,
      [{ valor: 1, vencimento: HOJE, status: "em_aberto" }],
      HOJE,
    ),
    "faturado",
  );
});

test("job mensal com mês a faturar não liquida, mesmo com as notas pagas (078)", () => {
  const pago = [{ valor: 100, vencimento: "2026-10-20", status: "pago" }];
  assert.equal(classificarFaturamento(true, true, pago, "2026-11-01"), "liquidado");
  assert.equal(
    classificarFaturamento(true, true, pago, "2026-11-01", false, true),
    "faturado",
  );
  // Vencido continua vencendo antes de tudo.
  const vencido = [{ valor: 100, vencimento: "2026-10-20", status: "em_aberto" }];
  assert.equal(
    classificarFaturamento(true, true, vencido, "2026-11-01", false, true),
    "inadimplente",
  );
});
