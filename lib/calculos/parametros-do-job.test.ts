/**
 * Decisões 224 e 233: o pedido de parâmetros do job, que o "Editar
 * planilha" do financeiro e a errata da produção conferem do mesmo jeito.
 * Dados sintéticos.
 *
 * Rodar: `node --import tsx --test lib/calculos/parametros-do-job.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { camposDaAlteracao, parametrosDoPedido, type ParametrosPedidos } from "./parametros-do-job";
import { sobraErrata } from "./linha-vermelha-fora-da-errata";
import type { ParametrosDoJobGravados } from "@/lib/types";

const nacional: ParametrosDoJobGravados = {
  percentual_honorarios: 13,
  percentual_imposto: 19.53,
  percentual_int_taxes: 0,
  int_transaction_costs: 0,
  moeda_estrangeira: null,
  cambio_cotacao: null,
  cambio_compra: null,
  cambio_venda: null,
  cambio_data: null,
  percentual_veiculo: 80,
  base_honorarios: "negociado",
};

const internacional: ParametrosDoJobGravados = {
  ...nacional,
  percentual_imposto: 14.25,
  percentual_int_taxes: 6,
  int_transaction_costs: 150,
  moeda_estrangeira: "USD",
  cambio_cotacao: 5.4,
  cambio_compra: 5.2,
  cambio_venda: 5.6,
  cambio_data: "2026-11-03",
};

const pedidoDe = (p: ParametrosDoJobGravados): ParametrosPedidos => ({
  percentual_honorarios: p.percentual_honorarios,
  percentual_imposto: p.percentual_imposto,
  percentual_int_taxes: p.percentual_int_taxes,
  int_transaction_costs: p.int_transaction_costs,
  moeda_estrangeira: p.moeda_estrangeira,
  cambio_cotacao: p.cambio_cotacao,
  cambio_data: p.cambio_data,
  percentual_veiculo: p.percentual_veiculo,
  base_honorarios: p.base_honorarios === "liquido" ? "liquido" : "negociado",
});

test("nada mudou: o pedido não vira alteração", () => {
  const r = parametrosDoPedido(nacional, pedidoDe(nacional), "nacional");
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.parametros, null);
});

test("nacional: honorários mudam, o resto fica", () => {
  const r = parametrosDoPedido(nacional, { ...pedidoDe(nacional), percentual_honorarios: 15 }, "nacional");
  assert.ok(r.ok && r.parametros);
  assert.deepEqual(r.parametros.campos, ["percentual_honorarios"]);
  assert.equal(r.parametros.para.percentual_honorarios, 15);
  assert.deepEqual(camposDaAlteracao(r.parametros.de, r.parametros.para, "nacional"), [
    { rotulo: "Honorários", de: "13%", para: "15%" },
  ]);
});

test("nacional: int. taxes do pedido não entram (o modelo não tem)", () => {
  const r = parametrosDoPedido(nacional, { ...pedidoDe(nacional), percentual_int_taxes: 9 }, "nacional");
  assert.equal(r.ok && r.parametros, null);
});

test("nacional: alíquota fora da lista é recusada", () => {
  const r = parametrosDoPedido(nacional, { ...pedidoDe(nacional), percentual_imposto: 10 }, "nacional");
  assert.deepEqual(r, { ok: false, message: "Escolha a alíquota de impostos na lista." });
});

test("internacional: fee, int. taxes e câmbio — compra e venda saem da cotação", () => {
  const r = parametrosDoPedido(
    internacional,
    { ...pedidoDe(internacional), percentual_honorarios: 10, percentual_int_taxes: 7, cambio_cotacao: 5.5 },
    "internacional",
  );
  assert.ok(r.ok && r.parametros);
  assert.equal(r.parametros.para.cambio_compra, 5.3);
  assert.equal(r.parametros.para.cambio_venda, 5.7);
  assert.deepEqual(
    camposDaAlteracao(r.parametros.de, r.parametros.para, "internacional").map((c) => c.rotulo),
    ["Fee", "Int. taxes", "Cotação", "Compra"],
  );
});

test("internacional: câmbio sem moeda é recusado", () => {
  const r = parametrosDoPedido(
    { ...internacional, moeda_estrangeira: null },
    { ...pedidoDe(internacional), moeda_estrangeira: null, cambio_cotacao: 5.5 },
    "internacional",
  );
  assert.deepEqual(r, { ok: false, message: "Escolha a moeda do job." });
});

test("errata só de parâmetros (com linha vermelha à parte) ainda é errata", () => {
  const vazio = { alteracoes: [], novas: [], cancelamentos: [], remocoes: [], meses_novos: [], estrutura: null };
  assert.equal(sobraErrata(vazio), false);
  assert.equal(sobraErrata({ ...vazio, parametros: pedidoDe(nacional) }), true);
  assert.equal(sobraErrata({ ...vazio, parametros: null }), false);
});
