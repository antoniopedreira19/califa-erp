/**
 * Testes dos prazos do job — decisão 075, nota de 15/09/2026.
 *
 * Rode com:  node --import tsx --test lib/calculos/prazos-do-job.test.ts
 *
 * JOB-0029 (aberto em 01/09/2026, R$ 31.919,72) e JOB-0033 (aberto em
 * 10/09/2026, R$ 113.897,60) são os do Projeto Teste; JOB-0034 é o Fee de
 * teste, com três meses previstos. Os números são os que o Tiago aprovou.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calcularPrazosDoJob,
  dataMediaPonderada,
  diasEntre,
} from "./prazos-do-job";
import type { NotaDoJob } from "./esteira-faturamento";

const ABERTURA_29 = "2026-09-01T12:58:02.99+00:00";
const ABERTURA_33 = "2026-09-10T15:21:44.082+00:00";

function nota(
  id: string,
  emissao: string,
  valorTotal: number,
  parte: number,
  titulos: { valor: number; vencimento: string }[],
): NotaDoJob {
  return {
    id,
    numero: id,
    data_emissao: emissao,
    valor_total: valorTotal,
    parte_do_job: parte,
    titulos: titulos.map((t) => ({ ...t, status: "em_aberto" })),
  };
}

test("sem nota: segue pelo previsto, até a última parcela (JOB-0034)", () => {
  const prazos = calcularPrazosDoJob({
    abertura: "2026-09-14T10:00:00+00:00",
    faturamentoPrevisto: "2026-12-31",
    notas: [],
    previsoesRecebimento: ["2026-11-20", "2026-12-20", "2027-01-20"],
  });
  assert.deepEqual(prazos, { faturamento: 108, recebimento: 20, total: 128 });
});

test("NF TESTE-ESTEIRA: cada job conta a sua parte do título da nota", () => {
  const teste = (parte: number) =>
    nota("TESTE-ESTEIRA", "2026-09-14", 2, parte, [
      { valor: 2, vencimento: "2026-09-30" },
    ]);

  assert.deepEqual(
    calcularPrazosDoJob({
      abertura: ABERTURA_29,
      faturamentoPrevisto: "2026-09-30",
      notas: [teste(1)],
      previsoesRecebimento: ["2026-09-30"],
    }),
    { faturamento: 13, recebimento: 16, total: 29 },
  );
  assert.deepEqual(
    calcularPrazosDoJob({
      abertura: ABERTURA_33,
      faturamentoPrevisto: "2026-09-30",
      notas: [teste(1)],
      previsoesRecebimento: ["2026-09-30"],
    }),
    { faturamento: 4, recebimento: 16, total: 20 },
  );
});

test("duas notas de pesos diferentes: 75% em 14/09 e 25% em 15/10", () => {
  const notas = [
    nota("101", "2026-09-14", 85423.2, 85423.2, [
      { valor: 85423.2, vencimento: "2026-09-30" },
    ]),
    nota("102", "2026-10-15", 28474.4, 28474.4, [
      { valor: 28474.4, vencimento: "2026-10-30" },
    ]),
  ];

  assert.equal(
    dataMediaPonderada(notas.map((n) => ({ data: n.data_emissao, peso: n.parte_do_job }))),
    "2026-09-22",
  );
  assert.deepEqual(
    calcularPrazosDoJob({
      abertura: ABERTURA_33,
      faturamentoPrevisto: "2026-09-30",
      notas,
      previsoesRecebimento: ["2026-09-30"],
    }),
    { faturamento: 12, recebimento: 16, total: 28 },
  );
});

test("NFs agrupadas meio a meio: o peso é sobre o que já foi faturado", () => {
  // NF A (14/09) e NF B (15/10), cada uma com metade dos dois jobs.
  const nfA = (parte: number) =>
    nota("A", "2026-09-14", 72908.66, parte, [
      { valor: 72908.66, vencimento: "2026-09-30" },
    ]);
  const nfB = (parte: number) =>
    nota("B", "2026-10-15", 72908.66, parte, [
      { valor: 72908.66, vencimento: "2026-10-30" },
    ]);
  const job29 = (notas: NotaDoJob[]) =>
    calcularPrazosDoJob({
      abertura: ABERTURA_29,
      faturamentoPrevisto: "2026-09-30",
      notas,
      previsoesRecebimento: ["2026-09-30"],
    });
  const job33 = (notas: NotaDoJob[]) =>
    calcularPrazosDoJob({
      abertura: ABERTURA_33,
      faturamentoPrevisto: "2026-09-30",
      notas,
      previsoesRecebimento: ["2026-09-30"],
    });

  // Só a NF A: ela é 100% do que já foi faturado de cada job.
  assert.equal(job29([nfA(15959.86)]).faturamento, 13);
  assert.equal(job33([nfA(56948.8)]).faturamento, 4);

  // As duas: emissão média em 30/09 e recebimento médio em 15/10, para os dois.
  assert.deepEqual(job29([nfA(15959.86), nfB(15959.86)]), {
    faturamento: 29,
    recebimento: 15,
    total: 44,
  });
  assert.deepEqual(job33([nfA(56948.8), nfB(56948.8)]), {
    faturamento: 20,
    recebimento: 15,
    total: 35,
  });
});

test("nota emitida ainda sem título: o recebimento cai no previsto", () => {
  assert.deepEqual(
    calcularPrazosDoJob({
      abertura: ABERTURA_33,
      faturamentoPrevisto: "2026-09-30",
      notas: [nota("101", "2026-09-14", 100, 100, [])],
      previsoesRecebimento: ["2026-09-30"],
    }),
    { faturamento: 4, recebimento: 16, total: 20 },
  );
});

test("meio dia arredonda para a data mais tardia, sem erro de ponto flutuante", () => {
  // 7,5 dias depois de 30/09 — em ponto flutuante a conta não fecha exata.
  assert.equal(
    dataMediaPonderada([
      { data: "2026-09-30", peso: 85423.2 },
      { data: "2026-10-30", peso: 28474.4 },
    ]),
    "2026-10-08",
  );
  assert.equal(
    dataMediaPonderada([
      { data: "2026-09-14", peso: 1 },
      { data: "2026-09-15", peso: 1 },
    ]),
    "2026-09-15",
  );
  assert.equal(dataMediaPonderada([]), null);
  assert.equal(dataMediaPonderada([{ data: "2026-09-14", peso: 0 }]), null);
});

test("faturamento + recebimento é sempre o total", () => {
  const casos = [
    [nota("x", "2026-09-17", 3, 1, [{ valor: 1, vencimento: "2026-10-03" }, { valor: 2, vencimento: "2026-11-11" }])],
    [
      nota("y", "2026-09-11", 10, 7, [{ valor: 10, vencimento: "2026-10-01" }]),
      nota("z", "2026-10-02", 5, 3, [{ valor: 5, vencimento: "2026-12-24" }]),
    ],
  ];
  for (const notas of casos) {
    const p = calcularPrazosDoJob({
      abertura: ABERTURA_29,
      faturamentoPrevisto: null,
      notas,
      previsoesRecebimento: [],
    });
    assert.equal((p.faturamento ?? 0) + (p.recebimento ?? 0), p.total);
  }
});

test("sem a ponta que fecha o prazo, o campo fica nulo", () => {
  assert.deepEqual(
    calcularPrazosDoJob({
      abertura: null,
      faturamentoPrevisto: null,
      notas: [],
      previsoesRecebimento: [],
    }),
    { faturamento: null, recebimento: null, total: null },
  );
  assert.equal(diasEntre("2026-09-01", null), null);
  assert.equal(diasEntre("2026-09-01", "2026-09-30"), 29);
});
