/**
 * Testes das contas da conciliação dia a dia (decisão 253): o saldo do banco
 * depois de cada linha e os dias da conta.
 *
 * Rode com:  node --import tsx --test lib/conciliacao/dia-a-dia.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { diasDaConta, motivoDeNaoFechar, saldosDoExtrato } from "./dia-a-dia";

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
  assert.equal(motivoDeNaoFechar(dias, "2026-11-04"), null);
  assert.equal(motivoDeNaoFechar(dias, "2026-11-05"), "Faltam 2 itens para fechar este dia.");
  // O dia 06 está pronto, mas fechar é fechar ATÉ ele: o 05 vem antes.
  assert.equal(motivoDeNaoFechar(dias, "2026-11-06"), "Resolva antes 05/11: a conta fecha um dia depois do outro.");
  assert.match(motivoDeNaoFechar(dias, "2026-11-07") ?? "", /ainda não está completo/);
});

test("sem extrato completo, nenhum dia fecha", () => {
  const dias = diasDaConta([linha("2026-11-04", false)], null, null);
  assert.equal(dias[0].estado, "andamento");
});
