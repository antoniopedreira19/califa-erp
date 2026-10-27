/**
 * Testes do resultado por regional do histórico (decisão 211, A4): a regional
 * de cada lançamento, a divisão do job, o imposto teórico e o benefício, o TD
 * pelo percentual do ano, o que fica sem regional, os grupos e totais, e o
 * arredondamento que não perde o total. Os valores são fictícios.
 *
 * Rode com:  node --import tsx --test lib/historico-financeiro/regional.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { montarDre } from "./dre";
import {
  arredondarComTotal,
  descricaoDosProjetos,
  montarRegional,
  partesDoJob,
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
): AgregadoRegional => ({
  sigla: "", grupo, trimestre, aba: "Conta Exemplo", regional, todas: false, peloJob: false, regionalDoJob: null, credito, debito, teorico: 0, ...extra,
});
/** Uma parte do job: o faturamento ou o custo já dividido, com o imposto teórico no faturamento. */
const job = (grupo: string, trimestre: number, regional: string, credito: number, debito: number, teorico = 0, extra: Partial<AgregadoRegional> = {}) =>
  g(grupo, trimestre, regional, credito, debito, { peloJob: true, teorico, ...extra });
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
  // Sem alíquota, o imposto teórico é zero e o benefício devolve o imposto pago com sinal trocado.
  assert.equal(linha(r, "IMP").total + linha(r, "BEN").total, -daDre("CT"));
  assert.equal(linha(r, "DA").total, -daDre("DA"));
  assert.equal(linha(r, "RF").total, daDre("RF"));
  // O lucro após investimento é o lucro líquido da DRE (sem perda nos dados).
  assert.equal(linha(r, "LLI").total, daDre("LL"));
});

test("o faturamento e o custo do job se dividem pelas partes dele, com o imposto teórico", () => {
  const somas = [
    job("REC", 1, "NE", 250, 0, 48.83), job("REC", 1, "SP", 750, 0, 146.48),
    job("CO", 1, "NE", 0, 100), job("CO", 1, "SP", 0, 300),
    // O job que a planilha não divide fica na regional do lançamento.
    g("REC", 1, "RJ", 500, 0, { teorico: 97.65 }),
  ];
  const r = montarRegional("Agência California", 2025, null, somas, [], RATEIO_2025);
  assert.deepEqual(linha(r, "REC").regionais, [250, 0, 750, 500]);
  assert.deepEqual(linha(r, "IMP").regionais, [-48.83, 0, -146.48, -97.65]);
  assert.deepEqual(linha(r, "CO").regionais, [-100, 0, -300, 0]);
  assert.deepEqual(linha(r, "RO").regionais, [101.17, 0, 303.52, 402.35]);
  assert.match(linha(r, "REC").origem, /divisão do job/);
});

test("o benefício é o teórico menos o pago, rateado pelo faturamento de cada trimestre", () => {
  const somas = [
    // 1T: NE fatura 300 e SP 100; teórico 80, pago 20: benefício 60 (45 e 15).
    job("REC", 1, "NE", 300, 0, 60), job("REC", 1, "SP", 100, 0, 20), g("CT", 1, null, 0, 20),
    // 2T: só SP fatura; teórico 40, pago 50: benefício −10, todo em SP.
    job("REC", 2, "SP", 200, 0, 40), g("CT", 2, null, 0, 50),
  ];
  const r = montarRegional("Agência California", 2025, null, somas, [], RATEIO_2025);
  assert.deepEqual(linha(r, "BEN").regionais, [45, 0, 5, 0]);
  assert.equal(linha(r, "BEN").semRegional, 0);
  assert.equal(linha(r, "IMP").total + linha(r, "BEN").total, -70);
  // No trimestre, o rateio é o do faturamento dele.
  assert.deepEqual(linha(montarRegional("Agência California", 2025, 2, somas, [], RATEIO_2025), "BEN").regionais, [0, 0, -10, 0]);
  // O benefício entra depois do lucro líquido, com a receita financeira.
  const chaves = r.linhas.map((l) => l.chave);
  assert.ok(chaves.indexOf("LL") < chaves.indexOf("BEN") && chaves.indexOf("BEN") < chaves.indexOf("RF"));
  assert.ok(chaves.indexOf("RAB") < chaves.indexOf("IMOB"));
});

test("sem faturamento no trimestre, o benefício fica sem regional", () => {
  const r = montarRegional("Agência California", 2025, null, [g("CT", 3, null, 0, 30)], [], RATEIO_2025);
  assert.equal(linha(r, "BEN").semRegional, -30);
  assert.equal(linha(r, "LLI").total, -30);
});

test("a divisão do job da CCH vem pelo código da planilha, e o código de outra empresa fica sem regional", () => {
  const somas = [
    job("REC", 1, "AGE", 600, 0, 0, { sigla: "CMH" }),
    job("REC", 1, "DOC", 300, 0, 0, { sigla: "CMH" }),
    job("REC", 1, "SN", 100, 0, 0, { sigla: "CMH" }),
  ];
  const r = montarRegional("CCH", 2025, null, somas, [], []);
  assert.deepEqual(r.colunas, ["Agency", "Doca"]);
  assert.deepEqual(linha(r, "REC").regionais, [600, 300]);
  assert.equal(linha(r, "REC").semRegional, 100);
});

test("as partes do job se dividem pela soma, como o banco divide", () => {
  assert.deepEqual(partesDoJob("NE:0.25;SP:0.75"), [{ codigo: "NE", parte: 0.25 }, { codigo: "SP", parte: 0.75 }]);
  assert.deepEqual(partesDoJob("NE:25;SP:75"), [{ codigo: "NE", parte: 0.25 }, { codigo: "SP", parte: 0.75 }]);
  assert.deepEqual(partesDoJob(null), []);
  assert.deepEqual(partesDoJob(""), []);
  assert.deepEqual(partesDoJob("NE:0;SP:0"), []);
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
    g("CF", 1, "RJ", 0, 70, { sigla: "CMH" }),
    g("CF", 1, "Doca", 0, 10, { sigla: "CMH" }),
  ];
  const r = montarRegional("CCH", 2023, null, somas, [], []);
  assert.deepEqual(r.colunas, ["Doca", "Urbia"]);
  assert.equal(daRegional(r, "CFR", "Urbia"), -30);
  assert.equal(linha(r, "CFR").semRegional, -70);
  const california = montarRegional("Agência California", 2025, null, [g("DA", 1, "N", 0, 5), g("DA", 1, "SSA", 0, 6)], [], RATEIO_2025);
  assert.equal(linha(california, "DA").semRegional, -11);
});

test("nas linhas da CMH, NE é a Doca e SP é a Agency; na divisão de um job, não", () => {
  const somas = [
    g("CF", 1, "NE", 0, 70, { sigla: "CMH" }),
    g("CF", 1, "SP", 0, 5, { sigla: "CMH" }),
    g("CF", 1, "Doca", 0, 10, { sigla: "CMH" }),
    // A divisão de um job da California numa linha da CMH: o "NE" é a regional da California.
    job("CO", 1, "NE", 0, 40, 0, { sigla: "CMH" }),
  ];
  const r = montarRegional("CCH", 2026, null, somas, [], []);
  assert.deepEqual(r.colunas, ["Agency", "Doca"]);
  assert.deepEqual(linha(r, "CFR").regionais, [-5, -80]);
  assert.equal(linha(r, "CO").semRegional, -40);
});

test("os projetos proprietários saem das linhas de cima e entram no bloco, divididos como o Fechamento", () => {
  const RATEIO_2026 = rateio(2026, { NE: 15, NO: 15, SP: 40, RJ: 25, SS: 5 });
  const somas = [
    job("REC", 2, "NE", 1000, 0, 195.3),
    // A Copa: o faturamento marcado SP e o custo marcado NE no lançamento; o job tem "COPA" na regional.
    g("REC", 2, "SP", 400, 0, { regionalDoJob: "COPA", teorico: 78.12 }),
    g("CO", 2, "NE", 0, 600, { regionalDoJob: "COPA" }),
    g("CT", 2, null, 0, 100),
  ];
  const r = montarRegional("Agência California", 2026, null, somas, [], RATEIO_2026);
  assert.equal(r.temProjetos, true);
  assert.equal(linha(r, "REC").total, 1000);
  assert.equal(daRegional(r, "REC", "SP"), 0);
  assert.equal(linha(r, "CO").total, 0);
  assert.deepEqual([daRegional(r, "PREC", "NE"), daRegional(r, "PREC", "SP")], [200, 200]);
  assert.deepEqual([daRegional(r, "PCO", "NE"), daRegional(r, "PCO", "SP")], [-300, -300]);
  assert.deepEqual([daRegional(r, "PIMP", "NE"), daRegional(r, "PIMP", "SP")], [-39.06, -39.06]);
  // O benefício (273,42 − 100) se divide pelo faturamento: 1.000 da operação e 400 dos projetos.
  assert.equal(linha(r, "BEN").total, 123.87);
  assert.equal(linha(r, "PBEN").total, 49.55);
  const imposto = ["IMP", "PIMP", "BEN", "PBEN"].reduce((s, c) => s + Math.round(linha(r, c).total * 100), 0) / 100;
  assert.equal(imposto, -100);
  // O bloco vem depois do resultado e só entra no lucro após investimento, que fecha com a DRE.
  const chaves = r.linhas.map((l) => l.chave);
  assert.ok(chaves.indexOf("PL") < chaves.indexOf("PROJ") && chaves.indexOf("PROJ") < chaves.indexOf("LLI"));
  assert.equal(linha(r, "PROJ").total, -228.57);
  const dre = montarDre("Agência California", somas, []);
  assert.equal(linha(r, "LLI").total, dre.find((l) => l.chave === "LL")!.ano);
  assert.equal(r.faturamentoSemDivisao, 0);
});

test("os projetos da CCH vão para a Doca, e sem projeto no período o bloco não aparece", () => {
  const somas = [
    g("CO", 1, "Agency", 0, 50, { sigla: "CMH", regionalDoJob: "CMH" }),
    g("REC", 1, "NE", 30, 0, { sigla: "CMH", regionalDoJob: "CMH" }),
    job("REC", 2, "AGE", 100, 0, 0, { sigla: "CMH" }),
  ];
  const r = montarRegional("CCH", 2026, 1, somas, [], []);
  // As colunas são as regionais com lançamento no ano (a Agency, pelo job do 2T).
  assert.deepEqual(r.colunas, ["Agency", "Doca"]);
  assert.deepEqual(linha(r, "PCO").regionais, [0, -50]);
  assert.deepEqual(linha(r, "PREC").regionais, [0, 30]);
  assert.equal(r.linhas.find((l) => l.chave === "REC")!.total, 0);
  const semProjeto = montarRegional("CCH", 2026, 2, somas, [], []);
  assert.equal(semProjeto.temProjetos, false);
  assert.ok(!semProjeto.linhas.some((l) => ["PROJ", "PREC", "PIMP", "PCO", "PBEN"].includes(l.chave)));
  // O texto de outra marca na regional do job não é projeto: segue a regional do lançamento.
  const outro = montarRegional("CCH", 2026, 1, [g("REC", 1, "Doca", 10, 0, { sigla: "CMH", regionalDoJob: "COPA" })], [], []);
  assert.equal(outro.temProjetos, false);
  assert.equal(daRegional(outro, "REC", "Doca"), 10);
});

test("a descrição dos projetos de cada empresa", () => {
  assert.equal(descricaoDosProjetos("Agência California"), "Copa (NE 50% e SP 50%)");
  assert.equal(descricaoDosProjetos("CCH"), "Projetos da CCH (Doca 100%)");
});

test("o imposto teórico e o benefício, com os dos projetos, fecham o imposto pago no centavo", () => {
  // Valores quebrados em vários trimestres e regionais (gerador fixo, para o teste se repetir igual).
  let semente = 7;
  const aleatorio = () => ((semente = (semente * 48271) % 2147483647) / 2147483647);
  const RATEIO_2026 = rateio(2026, { NE: 15, NO: 15, SP: 40, RJ: 25, SS: 5 });
  for (let caso = 0; caso < 200; caso++) {
    const somas: AgregadoRegional[] = [];
    for (const t of [1, 2]) {
      for (const r of ["NE", "SP", "RJ"]) {
        const v = Math.round(aleatorio() * 1e7) / 100;
        somas.push(job("REC", t, r, v, 0, v * (0.1 + aleatorio() * 0.1)));
      }
      const copa = Math.round(aleatorio() * 1e7) / 100;
      somas.push(g("REC", t, "SP", copa, 0, { regionalDoJob: "COPA", teorico: copa * 0.1953 }));
      somas.push(g("CO", t, "NE", 0, Math.round(aleatorio() * 1e7) / 100, { regionalDoJob: "COPA" }));
      somas.push(g("CT", t, null, 0, Math.round(aleatorio() * 1e6) / 100));
    }
    const r = montarRegional("Agência California", 2026, null, somas, [], RATEIO_2026);
    const imposto = ["IMP", "PIMP", "BEN", "PBEN"].reduce((s, c) => s + Math.round(linha(r, c).total * 100), 0);
    const pago = somas.filter((a) => a.grupo === "CT").reduce((s, a) => s + Math.round(a.debito * 100), 0);
    assert.equal(imposto, -pago, `caso ${caso}`);
    const dre = montarDre("Agência California", somas, []);
    assert.equal(linha(r, "LLI").total, dre.find((l) => l.chave === "LL")!.ano, `caso ${caso}`);
  }
});
