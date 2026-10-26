/**
 * Testes do resultado por regional do histórico (decisão 211, A4): a regional
 * de cada lançamento, o TD pelo percentual do ano, o que fica sem regional, os
 * grupos e totais, e o arredondamento que não perde o total. Os valores são
 * fictícios.
 *
 * Rode com:  node --import tsx --test lib/historico-financeiro/regional.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { montarDre } from "./dre";
import {
  arredondarComTotal,
  montarRegional,
  type AgregadoRegional,
  type AgregadoRegionalJobs,
  type PercentualDoRateio,
  type ResultadoPorRegional,
} from "./regional";

const g = (
  grupo: string,
  trimestre: number,
  regional: string | null,
  credito: number,
  debito: number,
  extra: Partial<AgregadoRegional> = {},
): AgregadoRegional => ({ sigla: "", grupo, trimestre, aba: "Conta Exemplo", regional, todas: false, credito, debito, ...extra });
const td = (grupo: string, trimestre: number, credito: number, debito: number, extra: Partial<AgregadoRegional> = {}) =>
  g(grupo, trimestre, null, credito, debito, { todas: true, ...extra });
const rateio = (ano: number, pcts: Record<string, number>, extra: Partial<PercentualDoRateio> = {}): PercentualDoRateio[] =>
  Object.entries(pcts).map(([regional, percentual]) => ({
    ano, trimestre: null, empresa: "Agência California", grupo: null, regional, percentual, origem: "Gerencial de exemplo", ...extra,
  }));
const RATEIO_2025 = rateio(2025, { NE: 25, NO: 20, SP: 30, RJ: 25 });

const linha = (r: ResultadoPorRegional, chave: string) => {
  const l = r.linhas.find((x) => x.chave === chave);
  assert.ok(l, `linha ${chave} não encontrada`);
  return l;
};
const daRegional = (r: ResultadoPorRegional, chave: string, regional: string) => linha(r, chave).regionais[r.colunas.indexOf(regional)];

test("o lançamento entra na sua regional, o TD pelo percentual do ano e o resto fica sem regional", () => {
  const r = montarRegional(
    "Agência California",
    2025,
    null,
    [g("CF", 1, "NE", 0, 100), g("CF", 1, null, 0, 7), td("CF", 1, 0, 1000)],
    [],
    RATEIO_2025,
  );
  assert.deepEqual(r.colunas, ["NE", "NO", "SP", "RJ"]);
  assert.equal(daRegional(r, "CFR", "NE"), -100);
  assert.equal(linha(r, "CFR").semRegional, -7);
  assert.deepEqual(linha(r, "CFG").regionais, [-250, -200, -300, -250]);
  assert.equal(linha(r, "CFG").semRegional, 0);
  assert.equal(linha(r, "GFG").total, -1000);
  assert.equal(linha(r, "GFR").total, -107);
});

test("as linhas que somam tudo fecham com a DRE do histórico", () => {
  const somas = [
    g("REC", 1, "SP", 5000, 0), g("CO", 1, "SP", 0, 2000), g("CT", 1, null, 0, 300), g("DA", 2, "NO", 10, 90), td("DA", 2, 0, 400),
    g("RF", 3, null, 50, 0), td("IMOB", 4, 0, 80), g("PL", 4, "RJ", 0, 20), g("DJ", 1, null, 0, 15), g("EMP", 1, "NE", 100, 0),
  ];
  const r = montarRegional("Agência California", 2025, null, somas, [], RATEIO_2025);
  const dre = montarDre("Agência California", somas, []);
  const daDre = (chave: string) => dre.find((l) => l.chave === chave)!.ano;
  assert.equal(linha(r, "REC").total, daDre("REC"));
  assert.equal(linha(r, "CO").total, -daDre("CO"));
  assert.equal(linha(r, "CT").total, -daDre("CT"));
  assert.equal(linha(r, "DA").total, -daDre("DA"));
  assert.equal(linha(r, "RF").total, daDre("RF"));
  // O lucro após investimento é o lucro líquido da DRE (sem perda nos dados).
  assert.equal(linha(r, "LLI").total, daDre("LL"));
});

test("a linha própria de um trimestre e grupo vale no lugar da do ano", () => {
  const tabela = [
    ...rateio(2024, { NE: 30, NO: 15, SP: 40, RJ: 15 }),
    ...rateio(2024, { NE: 25, NO: 20, SP: 30, RJ: 25 }, { trimestre: 4, grupo: "IMOB" }),
  ];
  const r = montarRegional("Agência California", 2024, null, [td("IMOB", 4, 0, 100), td("IMOB", 1, 0, 100)], [], tabela);
  // 1T pelo ano (30/15/40/15) e 4T pela linha própria (25/20/30/25).
  assert.deepEqual(linha(r, "IMOB").regionais, [-55, -35, -70, -40]);
});

test("ano sem rateio: o TD fica sem regional", () => {
  const r = montarRegional("Agência California", 2030, null, [td("CF", 1, 0, 500)], [], RATEIO_2025);
  assert.deepEqual(r.colunas, []);
  assert.equal(linha(r, "CFG").semRegional, -500);
  assert.equal(r.temSemRegional, true);
});

test("um trimestre só", () => {
  const r = montarRegional("Agência California", 2025, 2, [g("REC", 1, "NE", 100, 0), g("REC", 2, "NE", 40, 0)], [], RATEIO_2025);
  assert.equal(daRegional(r, "REC", "NE"), 40);
});

test("a conta própria da Hitlab não entra na California", () => {
  const r = montarRegional(
    "Agência California",
    2025,
    null,
    [g("DA", 1, "NE", 0, 10), g("DA", 1, "NE", 0, 99, { aba: "Santander Hitlab" })],
    [],
    RATEIO_2025,
  );
  assert.equal(daRegional(r, "DA", "NE"), -10);
});

test("a CCH usa a sigla dela, as regionais dela e a Doca e a Makkna", () => {
  const somas = [
    g("CF", 1, "Doca", 0, 100, { sigla: "CMH" }),
    td("CF", 1, 0, 200, { sigla: "CMH" }),
    g("DOC", 2, "Doca", 0, 50, { sigla: "CMH" }),
    g("CF", 1, "NE", 0, 999),
  ];
  const tabela: PercentualDoRateio[] = [
    { ano: 2025, trimestre: null, empresa: "CCH", grupo: null, regional: "Agency", percentual: 50, origem: "x" },
    { ano: 2025, trimestre: null, empresa: "CCH", grupo: null, regional: "Doca", percentual: 50, origem: "x" },
    { ano: 2025, trimestre: null, empresa: "CCH", grupo: null, regional: "Urbia", percentual: 0, origem: "x" },
  ];
  const r = montarRegional("CCH", 2025, null, somas, [], tabela);
  assert.deepEqual(r.colunas, ["Agency", "Doca"]);
  assert.equal(daRegional(r, "CFR", "Doca"), -100);
  assert.deepEqual(linha(r, "CFG").regionais, [-100, -100]);
  assert.equal(daRegional(r, "DOC", "Doca"), -50);
  assert.equal(linha(r, "LLI").total, -350);
});

test("a perda da FitDance sai da coluna Jobs, com a regional do lançamento", () => {
  const jobs: AgregadoRegionalJobs[] = [{ prefixo: "FIT", trimestre: 1, aba: "Conta Exemplo", regional: null, todas: true, credito: 0, debito: 400 }];
  const r = montarRegional("Agência California", 2025, null, [], jobs, RATEIO_2025);
  assert.deepEqual(linha(r, "PERDA").regionais, [-100, -80, -120, -100]);
});

test("o arredondamento não perde o total", () => {
  assert.deepEqual(arredondarComTotal([0.333, 0.333, 0.334]), [0.33, 0.33, 0.34]);
  const partes = arredondarComTotal([10.005, 20.005, 30.005]);
  assert.equal(Math.round(partes.reduce((s, v) => s + v, 0) * 100), Math.round((10.005 + 20.005 + 30.005) * 100));
});

test("o código da planilha vale quando o sistema não tem a regional, e o de outra empresa fica sem regional", () => {
  const somas = [
    g("CF", 1, "URB", 0, 30, { sigla: "CMH" }),
    g("CF", 1, "NE", 0, 70, { sigla: "CMH" }),
    g("CF", 1, "Doca", 0, 10, { sigla: "CMH" }),
  ];
  const r = montarRegional("CCH", 2023, null, somas, [], []);
  assert.deepEqual(r.colunas, ["Doca", "Urbia"]);
  assert.equal(daRegional(r, "CFR", "Urbia"), -30);
  assert.equal(linha(r, "CFR").semRegional, -70);
  const california = montarRegional("Agência California", 2025, null, [g("DA", 1, "N", 0, 5), g("DA", 1, "SSA", 0, 6)], [], RATEIO_2025);
  assert.equal(linha(california, "DA").semRegional, -11);
});
