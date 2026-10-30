import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFolhaContabilidadeTexto } from "./parse-folha-contabilidade";

const fixture = readFileSync(
  join(__dirname, "__fixtures__", "folha-092025.txt"),
  "utf8",
);

const fixtureNomeQuebrado = readFileSync(
  join(__dirname, "__fixtures__", "folha-nome-quebrado.txt"),
  "utf8",
);

test("extrai header: CNPJ e competência", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  assert.equal(r.cnpj_emissor, "19437976000154");
  assert.equal(r.competencia_ano, 2026);
  assert.equal(r.competencia_mes, 9);
});

test("extrai contagens e total do rodapé", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  assert.equal(r.totalizadores.empregados, 30);
  assert.equal(r.totalizadores.estagiarios, 2);
  assert.equal(r.totalizadores.contribuintes, 1);
  assert.equal(r.totalizadores.total_empresa, 12528145); // R$ 125.281,45 em centavos
});

test("extrai todas as 33 linhas (30+2+1)", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  assert.equal(r.linhas.length, 33);
  assert.equal(r.linhas.filter((l) => l.secao === "empregados").length, 30);
  assert.equal(r.linhas.filter((l) => l.secao === "estagiarios").length, 2);
  assert.equal(r.linhas.filter((l) => l.secao === "contribuintes").length, 1);
});

test("normaliza CPF (remove pontos e traços)", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const primeiro = r.linhas.find((l) => l.nome === "COLABORADOR EXEMPLO 01");
  assert.ok(primeiro, "COLABORADOR EXEMPLO 01 deve ser encontrado");
  assert.equal(primeiro!.cpf, "19000000100");
  assert.equal(primeiro!.cpf.length, 11);
  assert.match(primeiro!.cpf, /^\d+$/);
});

test("converte valor para centavos (inteiro)", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const primeiro = r.linhas.find((l) => l.nome === "COLABORADOR EXEMPLO 01");
  assert.equal(primeiro?.valor, 198840); // R$ 1.988,40
});

test("converte valor com milhares (ponto como separador)", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const decimoQuinto = r.linhas.find((l) => l.nome === "COLABORADOR EXEMPLO 15");
  assert.equal(decimoQuinto?.valor, 842173); // R$ 8.421,73
});

test("converte data_pagamento para ISO yyyy-mm-dd", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const primeiro = r.linhas.find((l) => l.nome === "COLABORADOR EXEMPLO 01");
  assert.equal(primeiro?.data_pagamento, "2026-10-05");
});

test("categoriza linha pela seção correta", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const estagiario = r.linhas.find((l) => l.nome === "ESTAGIARIO EXEMPLO 01");
  assert.equal(estagiario?.secao, "estagiarios");
  const contribuinte = r.linhas.find((l) => l.nome === "CONTRIBUINTE EXEMPLO 01");
  assert.equal(contribuinte?.secao, "contribuintes");
});

test("soma dos empregados é consistente (positiva e menor que o total)", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const somaEmpregados = r.linhas
    .filter((l) => l.secao === "empregados")
    .reduce((acc, l) => acc + l.valor, 0);
  assert.ok(somaEmpregados > 0);
  assert.ok(somaEmpregados < r.totalizadores.total_empresa);
});

test("soma de todas as seções bate exatamente com o totalizador do rodapé", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const soma = r.linhas.reduce((acc, l) => acc + l.valor, 0);
  assert.equal(soma, r.totalizadores.total_empresa);
});

test("texto sem nenhuma linha de colaborador dispara erro claro", () => {
  const textoTruncado =
    "RELAÇÃO GERAL DOS LÍQUIDOS\nCNPJ: 19.437.976/0001-54\nCompetência: 09/2026\n";
  assert.throws(
    () => parseFolhaContabilidadeTexto(textoTruncado),
    /nenhuma linha.*extra[íi]da/i,
  );
});

test("texto sem CNPJ dispara erro claro", () => {
  const textoSemCnpj = "RELAÇÃO GERAL DOS LÍQUIDOS\nCompetência: 09/2026\n";
  assert.throws(
    () => parseFolhaContabilidadeTexto(textoSemCnpj),
    /CNPJ.*não encontrado/i,
  );
});

test("texto sem Competência dispara erro claro", () => {
  const textoSemComp =
    "RELAÇÃO GERAL DOS LÍQUIDOS\nCNPJ: 19.437.976/0001-54\n";
  assert.throws(
    () => parseFolhaContabilidadeTexto(textoSemComp),
    /Compet[eê]ncia.*não encontrada/i,
  );
});

// Regressão: PDF 10/2026 da contabilidade trunca nomes compridos na coluna
// "Nome do empregado" e o pdf-parse quebra o nome em 2 linhas. O parser
// antigo descartava a pessoa inteira (nome + CPF + valor) por causa da linha
// de continuação entre CPF e data. Ver conversa de 2026-10-30.

test("extrai colaborador cujo nome quebra em 2 linhas (regressão PDF 10/2026)", () => {
  const r = parseFolhaContabilidadeTexto(fixtureNomeQuebrado);
  const col02 = r.linhas.find((l) => l.cpf === "19000000200");
  assert.ok(col02, "colaborador com nome quebrado deve ser extraído, não descartado");
  assert.equal(col02!.nome, "COLABORADOR DE NOME MUITO LONGO EXEMPLO 02");
  assert.equal(col02!.valor, 200000);
  assert.equal(col02!.data_pagamento, "2026-11-05");
  assert.equal(col02!.secao, "empregados");
});

test("extrai dois colaboradores com nome quebrado em sequência", () => {
  const r = parseFolhaContabilidadeTexto(fixtureNomeQuebrado);
  const col03 = r.linhas.find((l) => l.cpf === "19000000300");
  assert.ok(col03, "segundo colaborador com nome quebrado seguido do primeiro");
  assert.equal(col03!.nome, "OUTRO COLABORADOR DE NOME MUITO LONGO EXEMPLO 03");
  assert.equal(col03!.valor, 300000);
});

test("fixture com nomes quebrados: todas as 6 linhas extraídas", () => {
  const r = parseFolhaContabilidadeTexto(fixtureNomeQuebrado);
  assert.equal(r.linhas.length, 6);
  assert.equal(r.linhas.filter((l) => l.secao === "empregados").length, 4);
  assert.equal(r.linhas.filter((l) => l.secao === "estagiarios").length, 1);
  assert.equal(r.linhas.filter((l) => l.secao === "contribuintes").length, 1);
});

test("fixture com nomes quebrados: soma bate", () => {
  const r = parseFolhaContabilidadeTexto(fixtureNomeQuebrado);
  const soma = r.linhas.reduce((acc, l) => acc + l.valor, 0);
  assert.equal(soma, 1110000); // R$ 11.100,00 em centavos
});
