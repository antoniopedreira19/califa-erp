/**
 * Testes das contas da conciliação dia a dia (decisão 254): o saldo do banco
 * depois de cada linha e os dias da conta.
 *
 * Rode com:  node --import tsx --test lib/conciliacao/dia-a-dia.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { avisoDoSaldo, diasDaConta, mesesDaConta, saldosDoExtrato } from "./dia-a-dia";

const l = (id: string, data: string, ordem: number, valor: number) => ({ id, data, ordem, valor });

test("o saldo depois de cada linha parte do saldo do fim do dia conferido e anda nas duas direções", () => {
  const linhas = [
    l("d", "2026-11-05", 0, 2000),
    l("b", "2026-11-04", 1, -300),
    l("a", "2026-11-04", 0, -1000),
    l("c", "2026-11-04", 2, 50.5),
    l("e", "2026-11-06", 0, -700),
  ];
  // O banco fechou o dia 05/11 com R$ 10.000,00.
  const saldos = saldosDoExtrato(linhas, { ate: "2026-11-05", saldo: 10000 });
  assert.deepEqual(
    ["a", "b", "c", "d", "e"].map((id) => saldos.get(id)),
    // Abertura do dia 04: 10.000 − 2.000 − 50,50 + 300 + 1.000 = 9.249,50.
    [8249.5, 7949.5, 8000, 10000, 9300],
  );
});

test("sem saldo informado pelo extrato, nenhuma linha tem saldo", () => {
  assert.equal(saldosDoExtrato([l("a", "2026-11-04", 0, -10)], null).size, 0);
});

test("o saldo ignora a ordem em que as linhas chegam e desempata pelo id", () => {
  const linhas = [l("y", "2026-11-04", 0, -1), l("x", "2026-11-04", 0, -2)];
  const saldos = saldosDoExtrato(linhas, { ate: "2026-11-04", saldo: 100 });
  assert.equal(saldos.get("x"), 101);
  assert.equal(saldos.get("y"), 100);
});

const linha = (data: string, pendente: boolean) => ({ data, linha: true, pendente });
const baixaSemLinha = (data: string) => ({ data, linha: false, pendente: true });

test("os dias da conta: fechado, pronto, pendente e em andamento", () => {
  const dias = diasDaConta(
    [
      linha("2026-11-03", false),
      linha("2026-11-04", false),
      linha("2026-11-04", false),
      linha("2026-11-05", true),
      linha("2026-11-05", false),
      baixaSemLinha("2026-11-05"),
      linha("2026-11-06", false),
      linha("2026-11-07", true),
    ],
    "2026-11-03",
    "2026-11-06",
  );
  assert.deepEqual(
    dias.map((d) => [d.data, d.linhas, d.pendentes, d.estado]),
    [
      ["2026-11-03", 1, 0, "fechado"],
      ["2026-11-04", 2, 0, "pronto"],
      // A linha pendente e a baixa sem linha contam; a baixa não é linha do banco.
      ["2026-11-05", 2, 2, "pendente"],
      ["2026-11-06", 1, 0, "pronto"],
      // Depois do último dia completo do extrato.
      ["2026-11-07", 1, 1, "andamento"],
    ],
  );
});

test("o saldo do dia que não bate é avisado na hora", () => {
  const saldos = [
    { data: "2026-11-04", saldo_banco: 91358.08, saldo_sistema: 91348.08, diferenca: 10 },
    { data: "2026-11-06", saldo_banco: null, saldo_sistema: 400, diferenca: null },
  ];
  const sem = (t: string | null) => (t ?? "").replace(/\u00a0/g, " ");
  assert.equal(sem(avisoDoSaldo(saldos, "2026-11-04")), "O saldo de 04/11 não bate: banco R$ 91.358,08, sistema R$ 91.348,08 (diferença de R$ 10,00).");
  // O extrato sem saldo também é recusado pelo servidor.
  assert.match(avisoDoSaldo(saldos, "2026-11-06") ?? "", /não informa o saldo do banco/);
  // Batendo (ou com diferença de arredondamento), nada a avisar; dia que o servidor não informou, também não.
  assert.equal(avisoDoSaldo([{ data: "2026-11-04", saldo_banco: 100, saldo_sistema: 100, diferenca: 0 }], "2026-11-04"), null);
  assert.equal(avisoDoSaldo(saldos, "2026-11-10"), null);
});

test("os meses: o que falta em cada um, em ordem, e o saldo por último", () => {
  const dias = diasDaConta(
    [linha("2026-09-30", false), linha("2026-10-05", false), linha("2026-10-30", false), linha("2026-11-03", true), linha("2026-11-04", true), linha("2026-11-10", false)],
    "2026-09-30",
    "2026-11-09",
  );
  const meses = mesesDaConta(dias, [], "2026-11-09");
  // Setembro está fechado: não aparece.
  assert.deepEqual(meses.map((m) => [m.mes, m.fim, m.dias.length]), [
    ["2026-10", "2026-10-31", 2],
    ["2026-11", "2026-11-30", 3],
  ]);
  // Outubro todo conciliado e o extrato passa de 31/10: fecha.
  assert.deepEqual(meses[0].faltas, []);
  assert.deepEqual(meses[1].faltas, [
    "Feche outubro antes: os meses fecham em ordem.",
    "Faltam 2 itens em 2 dias (03/11, 04/11).",
    "O extrato importado vai até 09/11: o mês fecha quando o extrato chegar a 30/11.",
  ]);
  // O saldo do último dia do mês que não bate segura o mês, depois das pendências.
  const saldo = [{ data: "2026-10-30", saldo_banco: 500, saldo_sistema: 400, diferenca: 100 }];
  assert.match(mesesDaConta(dias, saldo, "2026-11-09")[0].faltas.join(" "), /O saldo de 30\/10 não bate/);
  // Sem extrato do mês inteiro, não fecha.
  assert.deepEqual(mesesDaConta(diasDaConta([linha("2026-10-05", false)], null, "2026-10-29"), [], "2026-10-29")[0].faltas, [
    "O extrato importado vai até 29/10: o mês fecha quando o extrato chegar a 31/10.",
  ]);
});

test("sem extrato completo, nenhum dia fecha", () => {
  const dias = diasDaConta([linha("2026-11-04", false)], null, null);
  assert.equal(dias[0].estado, "andamento");
});
