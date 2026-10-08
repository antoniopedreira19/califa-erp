import { test } from "node:test";
import assert from "node:assert/strict";
import { lerDadosBrutosDaNF, SCHEMA_DADOS_NF } from "./ler-nf";

/** Mock mínimo do shape que lerDadosBrutosDaNF usa. */
function fakeClient(respostaJson: string, tokensIn = 1000, tokensOut = 100) {
  return {
    responses: {
      create: async () => ({
        output_text: respostaJson,
        usage: { input_tokens: tokensIn, output_tokens: tokensOut },
      }),
    },
  } as unknown as Parameters<typeof lerDadosBrutosDaNF>[1];
}

test("SCHEMA_DADOS_NF tem todos os 9 campos obrigatórios do spec", () => {
  const required = SCHEMA_DADOS_NF.required ?? [];
  assert.deepEqual([...required].sort(), [
    "cnpj_emissor",
    "cnpj_tomador",
    "confianca_baixa",
    "data_emissao",
    "descricao_servico",
    "numero_nf",
    "razao_social_emissor",
    "razao_social_tomador",
    "valor_total",
  ]);
});

test("lerDadosBrutosDaNF parseia resposta e retorna tokens", async () => {
  const resposta = JSON.stringify({
    numero_nf: "12345",
    data_emissao: "2026-10-01",
    razao_social_emissor: "FORNECEDOR TESTE LTDA",
    cnpj_emissor: "11222333000144",
    razao_social_tomador: "CALIFORNIA FILMES",
    cnpj_tomador: "19437976000154",
    valor_total: 5000,
    descricao_servico: "Produção audiovisual",
    confianca_baixa: false,
  });
  const r = await lerDadosBrutosDaNF(Buffer.from("fake-pdf"), fakeClient(resposta, 2000, 200));
  assert.equal(r.dados.numero_nf, "12345");
  assert.equal(r.dados.cnpj_emissor, "11222333000144");
  assert.equal(r.dados.valor_total, 5000);
  assert.equal(r.dados.confianca_baixa, false);
  assert.equal(r.tokensIn, 2000);
  assert.equal(r.tokensOut, 200);
});

test("lerDadosBrutosDaNF retorna nulls quando IA diz que não identificou", async () => {
  const resposta = JSON.stringify({
    numero_nf: null,
    data_emissao: null,
    razao_social_emissor: null,
    cnpj_emissor: null,
    razao_social_tomador: null,
    cnpj_tomador: null,
    valor_total: null,
    descricao_servico: null,
    confianca_baixa: true,
  });
  const r = await lerDadosBrutosDaNF(Buffer.from("fake"), fakeClient(resposta));
  assert.equal(r.dados.numero_nf, null);
  assert.equal(r.dados.confianca_baixa, true);
});

test("lerDadosBrutosDaNF lança erro se resposta não é JSON válido", async () => {
  await assert.rejects(() =>
    lerDadosBrutosDaNF(Buffer.from("fake"), fakeClient("isto não é json")),
  );
});
