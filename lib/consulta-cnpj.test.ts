/**
 * A resposta do CNPJ.ws, reserva da BrasilAPI na consulta do cadastro.
 * Rodar: node --import tsx --test lib/consulta-cnpj.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { respostaDoCnpjWs } from "./consulta-cnpj";
import { consultaDaRespostaDoCnpj } from "./fiscal/regime-do-fornecedor";

const CNPJ = "64582932000172";
const HOJE = "2026-10-09";

/** O desenho da resposta de `publica.cnpj.ws/cnpj/{cnpj}` (09/10/2026),
 *  com dados fictícios. */
function respostaWs(simples: unknown) {
  return {
    cnpj_raiz: "64582932",
    razao_social: "64.582.932 FULANO DE TAL",
    simples,
    estabelecimento: {
      cnpj: CNPJ,
      nome_fantasia: null,
      situacao_cadastral: "Ativa",
      tipo_logradouro: "RUA",
      logradouro: "DAS FLORES",
      numero: "100",
      complemento: null,
      bairro: "CENTRO",
      cep: "88000000",
      cidade: { id: 1, nome: "Florianópolis", ibge_id: 4205407 },
      estado: { id: 24, nome: "Santa Catarina", sigla: "SC", ibge_id: 42 },
    },
  };
}

test("MEI no CNPJ.ws vira MEI desde a data de opção, como na BrasilAPI", () => {
  const dados = respostaDoCnpjWs(
    respostaWs({
      simples: "Sim",
      mei: "Sim",
      data_opcao_simples: "2024-07-21",
      data_opcao_mei: "2024-07-21",
      data_exclusao_simples: null,
      data_exclusao_mei: null,
    }),
  );
  assert.ok(dados);
  assert.equal(dados.opcao_pelo_mei, true);
  assert.deepEqual(consultaDaRespostaDoCnpj(dados, CNPJ, HOJE), {
    cnpj: CNPJ,
    em: HOJE,
    regime: "mei",
    desde: "2024-07-21",
  });
});

test("optante do Simples sem MEI vira Simples", () => {
  const dados = respostaDoCnpjWs(
    respostaWs({ simples: "Sim", mei: "Não", data_opcao_simples: "2019-01-01", data_opcao_mei: null }),
  );
  assert.equal(consultaDaRespostaDoCnpj(dados, CNPJ, HOJE)?.regime, "simples");
  assert.equal(consultaDaRespostaDoCnpj(dados, CNPJ, HOJE)?.desde, "2019-01-01");
});

test("excluída do Simples e empresa que nunca optou (simples nulo) viram Lucro Real ou Presumido", () => {
  const excluida = respostaDoCnpjWs(
    respostaWs({ simples: "Não", mei: "Não", data_opcao_simples: "2010-01-01", data_exclusao_simples: "2015-12-31" }),
  );
  assert.equal(consultaDaRespostaDoCnpj(excluida, CNPJ, HOJE)?.regime, "normal");
  const nunca = respostaDoCnpjWs(respostaWs(null));
  assert.equal(nunca?.opcao_pelo_simples, false);
  assert.equal(consultaDaRespostaDoCnpj(nunca, CNPJ, HOJE)?.regime, "normal");
});

test("endereço e nomes nos campos da BrasilAPI; o que falta vai vazio", () => {
  const dados = respostaDoCnpjWs(respostaWs(null));
  assert.deepEqual(
    {
      razao_social: dados?.razao_social,
      nome_fantasia: dados?.nome_fantasia,
      situacao: dados?.descricao_situacao_cadastral,
      cep: dados?.cep,
      logradouro: dados?.logradouro,
      numero: dados?.numero,
      complemento: dados?.complemento,
      bairro: dados?.bairro,
      municipio: dados?.municipio,
      uf: dados?.uf,
    },
    {
      razao_social: "64.582.932 FULANO DE TAL",
      // Como a BrasilAPI: "" no MEI sem nome fantasia (o formulário não
      // troca o nome pela razão social).
      nome_fantasia: "",
      situacao: "Ativa",
      cep: "88000000",
      logradouro: "DAS FLORES",
      numero: "100",
      complemento: "",
      bairro: "CENTRO",
      municipio: "Florianópolis",
      uf: "SC",
    },
  );
});

test("resposta sem estabelecimento (erro, corpo vazio) não vira dado", () => {
  assert.equal(respostaDoCnpjWs(null), null);
  assert.equal(respostaDoCnpjWs({ status: 429, titulo: "Muitas requisições" }), null);
});
