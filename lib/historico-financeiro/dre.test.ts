/**
 * Testes da DRE do histórico (decisão 211, A4): as linhas de cada empresa, a
 * regra de sinal de cada linha, os subtotais e as contas próprias. Os valores
 * são fictícios.
 *
 * Rode com:  node --import tsx --test lib/historico-financeiro/dre.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODELOS_DA_DRE,
  PREFIXOS_DA_DRE,
  chaveDaColunaJobs,
  montarDre,
  type AgregadoPorGrupo,
  type AgregadoPorJobs,
  type LinhaDaDre,
} from "./dre";

const g = (sigla: string, grupo: string, trimestre: number, credito: number, debito: number, aba = "Conta Exemplo"): AgregadoPorGrupo => ({
  sigla, grupo, trimestre, aba, credito, debito,
});
const j = (prefixo: string, trimestre: number, credito: number, debito: number, aba = "Conta Exemplo"): AgregadoPorJobs => ({
  prefixo, trimestre, aba, credito, debito,
});
const linha = (dre: LinhaDaDre[], chave: string) => {
  const l = dre.find((x) => x.chave === chave);
  assert.ok(l, `linha ${chave} não encontrada`);
  return l;
};

test("receita é crédito − débito; custo é débito − crédito e subtrai no subtotal", () => {
  const dre = montarDre(
    "Agência California",
    [g("", "REC", 1, 1000, 100), g("", "CO", 1, 50, 400), g("", "CT", 1, 0, 30)],
    [],
  );
  assert.deepEqual(linha(dre, "REC").trimestres, [900, 0, 0, 0]);
  assert.deepEqual(linha(dre, "CO").trimestres, [350, 0, 0, 0]);
  assert.equal(linha(dre, "RB").trimestres[0], 900 - 350 - 30);
  assert.equal(linha(dre, "RB").subtotal, true);
});

test("a sigla do Tipo separa as empresas", () => {
  const somas = [g("", "REC", 1, 1000, 0), g("CMH", "REC", 1, 200, 0), g("HIT", "REC", 2, 30, 0)];
  assert.equal(linha(montarDre("Agência California", somas, []), "REC").ano, 1000);
  assert.equal(linha(montarDre("CCH", somas, []), "REC").ano, 200);
  assert.deepEqual(linha(montarDre("Hitlab", somas, []), "REC").trimestres, [0, 30, 0, 0]);
  assert.equal(linha(montarDre("Ventura", somas, []), "REC").ano, 0);
});

test("empréstimos e mútuo: o crédito na linha do (+), o débito negativo na do (−)", () => {
  const dre = montarDre("Agência California", [g("", "EMP", 3, 500, 200), g("", "MÚTUO INT", 3, 70, 90)], []);
  assert.equal(linha(dre, "EMP+").trimestres[2], 500);
  assert.equal(linha(dre, "EMP-").trimestres[2], -200);
  assert.equal(linha(dre, "MUTUO+").trimestres[2], 70);
  assert.equal(linha(dre, "MUTUO-").trimestres[2], -90);
});

test("saídas (juros, imobilizado, bonificação, distribuição) aparecem negativas e descontam o crédito", () => {
  const dre = montarDre("Agência California", [g("", "IMOB", 1, 10, 110), g("", "PL", 1, 0, 40), g("", "DL", 1, 25, 125)], []);
  assert.equal(linha(dre, "IMOB").trimestres[0], -100);
  assert.equal(linha(dre, "PL").trimestres[0], -40);
  assert.equal(linha(dre, "LL").trimestres[0], -140);
  assert.equal(linha(dre, "DL").trimestres[0], -100);
  assert.equal(linha(dre, "REINV").trimestres[0], -240);
});

test("a bonificação fica depois do resultado líquido operacional em todas as empresas", () => {
  for (const [empresa, itens] of Object.entries(MODELOS_DA_DRE)) {
    const chaves = itens.map((i) => i.chave);
    assert.ok(chaves.indexOf("RLO") < chaves.indexOf("PL"), empresa);
    assert.ok(chaves.indexOf("PL") < chaves.indexOf("LL"), empresa);
  }
});

test("as linhas da coluna Jobs somam crédito − débito pela chave, só na empresa que tem a linha", () => {
  const jobs = [j("CMH", 1, 300, 1000), j("HIT", 2, 0, 50), j("HIT CMH", 2, 0, 20), j("FIT", 1, 0, 400)];
  const california = montarDre("Agência California", [], jobs);
  assert.equal(linha(california, "J-CMH").trimestres[0], -700);
  assert.equal(linha(california, "J-HIT").trimestres[1], -50);
  assert.equal(linha(california, "J-FIT").trimestres[0], -400);
  assert.equal(linha(montarDre("Hitlab", [], jobs), "J-CMH").trimestres[1], -20);
  // A DRE CMH não tem linha de empréstimo: a "FIT" da coluna Jobs é a perda da California.
  assert.equal(montarDre("CCH", [], jobs).some((l) => l.chave.startsWith("J-")), false);
});

test("a conta própria da Hitlab só entra na DRE da Hitlab", () => {
  const somas = [g("", "DA", 1, 0, 100), g("", "DA", 1, 0, 7, "Santander Hitlab"), g("HIT", "DA", 1, 0, 9, "Santander Hitlab")];
  const jobs = [j("HIT", 1, 0, 50), j("HIT", 1, 500, 0, "Santander Hitlab")];
  const california = montarDre("Agência California", somas, jobs);
  assert.equal(linha(california, "DA").trimestres[0], 100);
  assert.equal(linha(california, "J-HIT").trimestres[0], -50);
  assert.equal(linha(montarDre("Hitlab", somas, jobs), "DA").trimestres[0], 9);
});

test("o ano é a soma dos trimestres, em centavos", () => {
  const dre = montarDre("Agência California", [g("", "REC", 1, 0.1, 0), g("", "REC", 2, 0.2, 0)], []);
  assert.equal(linha(dre, "REC").ano, 0.3);
});

test("a chave da coluna Jobs: maiúsculas, um espaço, trimestre e ano no fim", () => {
  assert.deepEqual(chaveDaColunaJobs("CMH 1T 2025"), { prefixo: "CMH", trimestre: 1, ano: 2025 });
  assert.deepEqual(chaveDaColunaJobs("  hit   fit 3T  2024 "), { prefixo: "HIT FIT", trimestre: 3, ano: 2024 });
  assert.equal(chaveDaColunaJobs("CMH 1T2025"), null);
  assert.equal(chaveDaColunaJobs("Marca X - Evento"), null);
  assert.equal(chaveDaColunaJobs(null), null);
});

test("as chaves que a função do banco soma são as das linhas de empréstimo", () => {
  assert.deepEqual([...PREFIXOS_DA_DRE].sort(), ["CMH", "CMT", "FIT", "HIT", "HIT CMH", "HIT FIT", "IFL", "VT"]);
});
