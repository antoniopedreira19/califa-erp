import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparFolhaNoExtrato, folhaDaBaixa } from "./folha-no-extrato";

const outubro = { competencia_ano: 2026, competencia_mes: 10, tipo: "salario" };

test("a folha da baixa: a competência e o tipo, só na baixa da avulsa", () => {
  assert.deepEqual(folhaDaBaixa("avulsa_baixa", outubro), { chave: "salario|2026-10", rotulo: "Folha de pagamento 10/2026" });
  assert.deepEqual(folhaDaBaixa("avulsa_baixa", { ...outubro, tipo: "ferias" }), { chave: "ferias|2026-10", rotulo: "Férias 10/2026" });
  assert.equal(folhaDaBaixa("avulsa_baixa", null), null);
  // Um tipo que a faixa não conhece fica sem faixa.
  assert.equal(folhaDaBaixa("avulsa_baixa", { ...outubro, tipo: "decimo_terceiro" }), null);
  assert.equal(folhaDaBaixa("manual", outubro), null);
});

const folha = folhaDaBaixa("avulsa_baixa", outubro);
const linha = (id: string, data: string, comFolha = true) => ({ id, data_movimento: data, folha: comFolha ? folha : null });

test("os pagamentos seguidos da mesma folha no mesmo dia viram uma faixa; a ordem não muda", () => {
  const itens = agruparFolhaNoExtrato([
    linha("tarifa", "2026-10-19", false),
    linha("p1", "2026-10-19"),
    linha("p2", "2026-10-19"),
    linha("p3", "2026-10-19"),
    linha("pix", "2026-10-19", false),
    // O pagamento que falhou e saiu no dia seguinte: a faixa desse dia.
    linha("p4", "2026-10-20"),
  ]);
  assert.deepEqual(
    itens.map((i) => (i.tipo === "linha" ? i.linha.id : `${i.rotulo} ${i.data} ${i.linhas.map((l) => l.id).join(",")}`)),
    ["tarifa", "Folha de pagamento 10/2026 2026-10-19 p1,p2,p3", "pix", "Folha de pagamento 10/2026 2026-10-20 p4"],
  );
});

test("outra linha no meio fecha a faixa, e as chaves não se repetem", () => {
  const itens = agruparFolhaNoExtrato([linha("p1", "2026-10-19"), linha("x", "2026-10-19", false), linha("p2", "2026-10-19")]);
  const faixas = itens.filter((i) => i.tipo === "folha");
  assert.equal(faixas.length, 2);
  assert.notEqual(faixas[0].chave, faixas[1].chave);
});
