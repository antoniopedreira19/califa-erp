import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFolhaContabilidadeTexto } from "./parse-folha-contabilidade";

const fixture = readFileSync(
  join(__dirname, "__fixtures__", "folha-092025.txt"),
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
  const caroline = r.linhas.find((l) => l.nome.startsWith("CAROLINE"));
  assert.ok(caroline, "CAROLINE deve ser encontrada");
  assert.equal(caroline!.cpf, "41589196813");
  assert.equal(caroline!.cpf.length, 11);
  assert.match(caroline!.cpf, /^\d+$/);
});

test("converte valor para centavos (inteiro)", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const caroline = r.linhas.find((l) => l.nome.startsWith("CAROLINE"));
  assert.equal(caroline?.valor, 198840); // R$ 1.988,40
});

test("converte valor com milhares (ponto como separador)", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const mariana = r.linhas.find((l) => l.nome.startsWith("MARIANA"));
  assert.equal(mariana?.valor, 842173); // R$ 8.421,73
});

test("converte data_pagamento para ISO yyyy-mm-dd", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const caroline = r.linhas.find((l) => l.nome.startsWith("CAROLINE"));
  assert.equal(caroline?.data_pagamento, "2026-10-05");
});

test("categoriza linha pela seção correta", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const estagiario = r.linhas.find((l) => l.nome.startsWith("EDUARDO"));
  assert.equal(estagiario?.secao, "estagiarios");
  const contribuinte = r.linhas.find((l) => l.nome.startsWith("BRUNO"));
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

test("texto sem seção Empregados dispara erro claro", () => {
  const textoTruncado =
    "RELAÇÃO GERAL DOS LÍQUIDOS\nCNPJ: 19.437.976/0001-54\nCompetência: 09/2026\n";
  assert.throws(
    () => parseFolhaContabilidadeTexto(textoTruncado),
    /seção .*Empregados.* não encontrada/i,
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
