/**
 * O regime tributário do fornecedor no cadastro (módulo fiscal, entrega 1).
 * Rodar: node --import tsx --test lib/fiscal/regime-do-fornecedor.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consultaDoCadastro,
  origemDoRegime,
  regimeConsultadoEmParaGravar,
  regimeDaConsultaDoCnpj,
  regimeDepoisDaConsulta,
  type ConsultaDoRegime,
} from "./regime-do-fornecedor";
import { fornecedorSchema } from "@/lib/validations/fornecedores";

const CNPJ = "64582932000172";
const OUTRO_CNPJ = "11222333000181";
const SIMPLES: ConsultaDoRegime = { cnpj: CNPJ, em: "2026-10-02", regime: "simples" };

test("a resposta da BrasilAPI dá o regime: MEI antes do Simples; sem opção, normal", () => {
  assert.equal(regimeDaConsultaDoCnpj({ opcao_pelo_simples: true, opcao_pelo_mei: true }), "mei");
  assert.equal(regimeDaConsultaDoCnpj({ opcao_pelo_simples: true, opcao_pelo_mei: false }), "simples");
  // Excluída do Simples (Banco do Brasil na BrasilAPI: false com datas).
  assert.equal(regimeDaConsultaDoCnpj({ opcao_pelo_simples: false, opcao_pelo_mei: false }), "normal");
  // Nunca optou (Petrobras na BrasilAPI: tudo nulo).
  assert.equal(regimeDaConsultaDoCnpj({ opcao_pelo_simples: null, opcao_pelo_mei: null }), "normal");
});

test("resposta sem os campos de opção não deduz regime", () => {
  assert.equal(regimeDaConsultaDoCnpj({ razao_social: "X" }), null);
  assert.equal(regimeDaConsultaDoCnpj(null), null);
  assert.equal(regimeDaConsultaDoCnpj("texto"), null);
});

test("a consulta entra no campo vazio e no lugar de outra consulta; o escolhido à mão fica", () => {
  assert.equal(regimeDepoisDaConsulta(null, null, "simples"), "simples");
  // O CNPJ foi corrigido: o regime da consulta anterior dá lugar ao novo.
  assert.equal(regimeDepoisDaConsulta("simples", SIMPLES, "normal"), "normal");
  // Escolhido à mão (diferente da consulta anterior, ou sem consulta): fica.
  assert.equal(regimeDepoisDaConsulta("mei", SIMPLES, "normal"), "mei");
  assert.equal(regimeDepoisDaConsulta("normal", null, "simples"), "normal");
});

test("embaixo do campo: preenchido pela consulta, ou âmbar quando trocado à mão", () => {
  assert.deepEqual(origemDoRegime("simples", SIMPLES, CNPJ), {
    texto: "Preenchido pela consulta do CNPJ em 02/10/2026",
    alterado: false,
  });
  assert.deepEqual(origemDoRegime("normal", SIMPLES, CNPJ), {
    texto: "Alterado manualmente — a consulta do CNPJ em 02/10/2026 indicou Simples Nacional.",
    alterado: true,
  });
  assert.deepEqual(origemDoRegime("simples", { ...SIMPLES, regime: "normal" }, CNPJ), {
    texto: "Alterado manualmente — a consulta do CNPJ em 02/10/2026 indicou regime normal.",
    alterado: true,
  });
  assert.deepEqual(origemDoRegime("normal", { ...SIMPLES, regime: "mei" }, "64.582.932/0001-72"), {
    texto: "Alterado manualmente — a consulta do CNPJ em 02/10/2026 indicou MEI.",
    alterado: true,
  });
});

test("sem regime, sem consulta, ou com a consulta de outro CNPJ: nada embaixo do campo", () => {
  assert.equal(origemDoRegime(null, SIMPLES, CNPJ), null);
  assert.equal(origemDoRegime("simples", null, CNPJ), null);
  assert.equal(origemDoRegime("simples", SIMPLES, OUTRO_CNPJ), null);
});

test("a data da consulta só se grava com o regime que ela indicou, para o CNPJ consultado", () => {
  assert.equal(regimeConsultadoEmParaGravar("simples", SIMPLES, CNPJ), "2026-10-02");
  assert.equal(regimeConsultadoEmParaGravar("normal", SIMPLES, CNPJ), null);
  assert.equal(regimeConsultadoEmParaGravar("simples", SIMPLES, OUTRO_CNPJ), null);
  assert.equal(regimeConsultadoEmParaGravar(null, SIMPLES, CNPJ), null);
  assert.equal(regimeConsultadoEmParaGravar("simples", null, CNPJ), null);
});

test("a edição abre com a consulta gravada", () => {
  assert.deepEqual(
    consultaDoCadastro({ cpf_cnpj: CNPJ, regime_tributario: "mei", regime_consultado_em: "2026-09-21" }),
    { cnpj: CNPJ, em: "2026-09-21", regime: "mei" },
  );
  assert.equal(
    consultaDoCadastro({ cpf_cnpj: CNPJ, regime_tributario: "mei", regime_consultado_em: null }),
    null,
  );
  assert.equal(
    consultaDoCadastro({ cpf_cnpj: CNPJ, regime_tributario: null, regime_consultado_em: "2026-09-21" }),
    null,
  );
  assert.equal(consultaDoCadastro(undefined), null);
});

// ---------------------------------------------------------------------------
// O servidor (lib/validations/fornecedores.ts)
// ---------------------------------------------------------------------------

const BASE = {
  tipo_pessoa: "juridica",
  nome: "Prime Comunicação",
  razao_social: "Prime Comunicação e Marketing Ltda",
  cpf_cnpj: CNPJ,
  email: "contato@fornecedor.com.br",
  telefone: "11987654321",
  pix_tipo: "cnpj",
  pix_chave: CNPJ,
};

test("o regime vai ao banco com a data da consulta e a declaração do Simples", () => {
  const r = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "simples",
    regime_consultado_em: "2026-10-02",
    declaracao_simples_recebida: "true",
  });
  assert.ok(r.success);
  assert.equal(r.data.regime_tributario, "simples");
  assert.equal(r.data.regime_consultado_em, "2026-10-02");
  assert.equal(r.data.declaracao_simples_recebida, true);
});

test("regime vazio é nulo, e a data da consulta não fica sozinha", () => {
  const r = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "",
    regime_consultado_em: "2026-10-02",
    declaracao_simples_recebida: "false",
  });
  assert.ok(r.success);
  assert.equal(r.data.regime_tributario, null);
  assert.equal(r.data.regime_consultado_em, null);
  assert.equal(r.data.declaracao_simples_recebida, false);
});

test("a declaração de optante só fica no Simples", () => {
  const r = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "normal",
    regime_consultado_em: "",
    declaracao_simples_recebida: "true",
  });
  assert.ok(r.success);
  assert.equal(r.data.regime_tributario, "normal");
  assert.equal(r.data.regime_consultado_em, null);
  assert.equal(r.data.declaracao_simples_recebida, false);
});

test("pessoa física não tem regime", () => {
  const r = fornecedorSchema.safeParse({
    ...BASE,
    tipo_pessoa: "fisica",
    cpf_cnpj: "52998224725",
    pix_tipo: "cpf",
    pix_chave: "52998224725",
    regime_tributario: "mei",
    regime_consultado_em: "2026-10-02",
    declaracao_simples_recebida: "true",
  });
  assert.ok(r.success);
  assert.equal(r.data.regime_tributario, null);
  assert.equal(r.data.regime_consultado_em, null);
  assert.equal(r.data.declaracao_simples_recebida, false);
});

test("regime fora da lista e data malformada são recusados", () => {
  const regime = fornecedorSchema.safeParse({ ...BASE, regime_tributario: "lucro_real" });
  assert.ok(!regime.success);
  assert.ok(regime.error.issues.some((i) => i.path.includes("regime_tributario")));
  const data = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "normal",
    regime_consultado_em: "02/10/2026",
  });
  assert.ok(!data.success);
  assert.ok(data.error.issues.some((i) => i.path.includes("regime_consultado_em")));
});

test("sem os campos do regime (quem não os manda), tudo nulo e sem declaração", () => {
  const r = fornecedorSchema.safeParse(BASE);
  assert.ok(r.success);
  assert.equal(r.data.regime_tributario, null);
  assert.equal(r.data.regime_consultado_em, null);
  assert.equal(r.data.declaracao_simples_recebida, false);
});
