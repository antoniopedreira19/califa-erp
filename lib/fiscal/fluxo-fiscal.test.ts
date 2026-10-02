/**
 * As saídas de imposto no Fluxo de caixa (módulo fiscal, entrega 2).
 * Rodar: node --import tsx --test lib/fiscal/fluxo-fiscal.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Guia, ItemMemoria } from "./apuracao";
import {
  cronogramaQueSobra,
  descricaoDoImposto,
  parcelaSemIssRetido,
  ppsComIssNaGuia,
  rolar,
  saidasDaApuracao,
  saidasDoCronogramaDeImpostos,
  saidasDosImpostosAPagar,
  type GuiaComEstado,
} from "./fluxo-fiscal";

const HOJE = "2026-11-04";
const soma = (xs: Array<{ valor: number }>) => Math.round(xs.reduce((s, x) => s + x.valor, 0) * 100) / 100;

function guia(p: Partial<GuiaComEstado> & Pick<GuiaComEstado, "chave" | "estado">): GuiaComEstado {
  return {
    tributo: "PIS",
    titulo: "PIS",
    codigo: "6912",
    empresa_contabil_id: "pj-cal",
    estabelecimento_id: null,
    local: "Federal · California",
    competencia: "2026-10",
    rotulo_competencia: "outubro/2026",
    periodo: "mensal",
    vencimento: "2026-11-25",
    vencimento_motivo: null,
    regra_vencimento: "",
    memoria: [],
    apurado: 1000,
    saldo_credor_gerado: 0,
    base: 0,
    rateio: [
      { empresa_id: "e1", empresa_nome: "California", regional_id: "r-sp", regional_nome: "SP", valor: 600, pct: 60 },
      { empresa_id: "e1", empresa_nome: "California", regional_id: "r-ba", regional_nome: "BA", valor: 400, pct: 40 },
    ],
    avisos: [],
    delta: 0,
    ...p,
  };
}

test("previsão vencida é lida em hoje + 1; a futura fica na data", () => {
  assert.equal(rolar("2026-11-03", HOJE), "2026-11-05");
  assert.equal(rolar(HOJE, HOJE), HOJE);
  assert.equal(rolar("2026-12-01", HOJE), "2026-12-01");
});

test("nome do imposto: guia municipal no ISS, DARF no federal, Guia sem código", () => {
  assert.equal(descricaoDoImposto({ tributo: "ISS", codigo_receita: null, descricao: "ISS · outubro/2026 · Salvador-BA" }), "Guia municipal · ISS · outubro/2026 · Salvador-BA");
  assert.equal(descricaoDoImposto({ tributo: "ISS_RET", codigo_receita: null, descricao: "x y z" }), "Guia municipal · x y z");
  assert.equal(descricaoDoImposto({ tributo: "PIS", codigo_receita: "6912", descricao: "PIS · outubro/2026" }), "DARF 6912 · PIS · outubro/2026");
  assert.equal(descricaoDoImposto({ tributo: "OUTRO", codigo_receita: null, descricao: "Taxa" }), "Guia · Taxa");
});

test("imposto a pagar: um item por parte do rateio, no vencimento, somando o título", () => {
  const itens = saidasDosImpostosAPagar([
    {
      id: "imp-1",
      tributo: "COFINS",
      codigo_receita: "5856",
      descricao: "COFINS · outubro/2026 · Federal · California",
      vencimento: "2026-11-25",
      valor: 3000,
      rateio: [
        { empresa_id: "e1", regional_id: "r-ba", valor: 1200, ordem: 2 },
        { empresa_id: "e1", regional_id: "r-sp", valor: 1800, ordem: 1 },
      ],
    },
  ]);
  assert.equal(itens.length, 2);
  assert.deepEqual(itens.map((i) => i.regional_id), ["r-sp", "r-ba"]);
  assert.ok(itens.every((i) => i.classe === "titulo" && i.origem_id === "imp-1" && i.data_evento === "2026-11-25" && i.job_id === null));
  assert.equal(soma(itens), 3000);
  assert.equal(itens[0].descricao, "DARF 5856 · COFINS · outubro/2026 · Federal · California");
});

test("Apuração: a aprovada fica de fora (já é título); em curso e a aprovar viram previsão rateada", () => {
  const itens = saidasDaApuracao(
    [
      guia({ chave: "pis|pj|2026-10", estado: "aprovada" }),
      guia({ chave: "pis|pj|2026-11", estado: "em_curso", competencia: "2026-11", rotulo_competencia: "novembro/2026", vencimento: "2026-12-24", apurado: 500 }),
      guia({ chave: "cofins|pj|2026-10", estado: "a_aprovar", titulo: "COFINS", vencimento: "2026-11-03", apurado: 1000 }),
    ],
    HOJE,
  );
  const emCurso = itens.filter((i) => i.origem_id === "pis|pj|2026-11");
  const aAprovar = itens.filter((i) => i.origem_id === "cofins|pj|2026-10");
  assert.equal(itens.filter((i) => i.origem_id === "pis|pj|2026-10").length, 0);
  assert.equal(soma(emCurso), 500);
  assert.equal(soma(aAprovar), 1000);
  assert.deepEqual(aAprovar.map((i) => i.valor), [600, 400]);
  // Vencida e ainda não aprovada: lida em hoje + 1.
  assert.ok(aAprovar.every((i) => i.data_evento === "2026-11-05"));
  assert.equal(emCurso[0].descricao, "Apuração em curso · PIS · novembro/2026 · Federal · California");
  assert.equal(aAprovar[0].descricao, "Apuração a aprovar · COFINS · outubro/2026 · Federal · California");
  assert.ok(itens.every((i) => i.classe === "previsao" && i.origem_tipo === "apuracao"));
});

test("Apuração: IRPJ/CSLL por cota, com os juros; diferença só quando o apurado subiu", () => {
  const cotas = [
    { numero: 1, vencimento: "2027-01-29", principal: 3000, jurosPct: 0, juros: 0 },
    { numero: 2, vencimento: "2027-02-26", principal: 3000, jurosPct: 1, juros: 30 },
    { numero: 3, vencimento: "2027-03-31", principal: 3000, jurosPct: 2, juros: 60 },
  ];
  const itens = saidasDaApuracao(
    [
      guia({ chave: "irpj|pj|2026-T4", estado: "em_curso", titulo: "IRPJ", periodo: "trimestral", apurado: 9000, cotas }),
      guia({ chave: "iss|e|2026-10", estado: "diferenca", delta: 250, vencimento: "2026-11-10" }),
      guia({ chave: "iss|e|2026-09", estado: "diferenca", delta: -80 }),
    ],
    HOJE,
  );
  const porCota = (n: number) => soma(itens.filter((i) => i.origem_id === `irpj|pj|2026-T4|${n}`));
  assert.deepEqual([porCota(1), porCota(2), porCota(3)], [3000, 3030, 3060]);
  assert.ok(itens.find((i) => i.origem_id === "irpj|pj|2026-T4|3")!.descricao.endsWith(" · cota 3/3"));
  const dif = itens.filter((i) => i.origem_id === "iss|e|2026-10");
  assert.equal(soma(dif), 250);
  assert.ok(dif[0].descricao.startsWith("Diferença a aprovar · "));
  assert.equal(itens.filter((i) => i.origem_id === "iss|e|2026-09").length, 0);
});

test("Apuração: guia sem rateio entra inteira, sem empresa", () => {
  const itens = saidasDaApuracao([guia({ chave: "csrf|pj|2026-10", estado: "a_aprovar", rateio: [], apurado: 120 })], HOJE);
  assert.equal(itens.length, 1);
  assert.equal(itens[0].empresa_id, null);
  assert.equal(itens[0].valor, 120);
});

test("cronograma: o faturado tira a parte dele, da data mais próxima para a mais distante", () => {
  const linhas = [
    { id: "i2", ordem: 2, data_prevista: "2026-12-20", valor: 1953 },
    { id: "i1", ordem: 1, data_prevista: "2026-11-20", valor: 1953 },
  ];
  // Nada faturado: o cronograma inteiro.
  assert.deepEqual(cronogramaQueSobra(linhas, 0, 20000).map((l) => [l.id, l.resta]), [["i1", 1953], ["i2", 1953]]);
  // Faturou 75% do previsto: sai 75% do imposto (2.929,50), primeiro da linha de novembro.
  assert.deepEqual(cronogramaQueSobra(linhas, 15000, 20000).map((l) => [l.id, l.resta]), [["i1", 0], ["i2", 976.5]]);
  // Faturou mais que o previsto: nada sobra (e não fica negativo).
  assert.deepEqual(cronogramaQueSobra(linhas, 25000, 20000).map((l) => l.resta), [0, 0]);
  // Sem faturamento previsto, não há proporção: o cronograma fica.
  assert.deepEqual(cronogramaQueSobra(linhas, 5000, 0).map((l) => l.resta), [1953, 1953]);
});

test("cronograma no fluxo: o que sobra, com o job, rolado se venceu", () => {
  const itens = saidasDoCronogramaDeImpostos(
    [
      {
        id: "job-1",
        codigo: "TES-1001/26",
        empresa_id: "e1",
        regional_id: "r-ba",
        faturamento_previsto: 20000,
        faturado: 10000,
        linhas: [
          { id: "i1", ordem: 1, data_prevista: "2026-10-20", valor: 1000 },
          { id: "i2", ordem: 2, data_prevista: "2026-10-25", valor: 1000 },
          { id: "i3", ordem: 3, data_prevista: "2026-12-20", valor: 1000 },
        ],
      },
    ],
    HOJE,
  );
  // 50% faturado tira 1.500: some a 1ª, sobra metade da 2ª (vencida → amanhã) e a 3ª inteira.
  assert.deepEqual(itens.map((i) => [i.origem_id, i.valor, i.data_evento]), [
    ["i2", 500, "2026-11-05"],
    ["i3", 1000, "2026-12-20"],
  ]);
  assert.equal(itens[0].descricao, "Recolhimento de impostos · TES-1001/26 2/3");
  assert.ok(itens.every((i) => i.job_id === "job-1" && i.origem_tipo === "previsao_imposto" && i.classe === "previsao"));
});

test("ISS retido: só a PP que está numa guia de ISS retido sai do título sem o ISS", () => {
  const item = (pp: string): ItemMemoria => ({ grupo: "debito", rotulo: pp, valor: 10, pp });
  const guias = [
    { tributo: "ISS_RET", memoria: [item("PP-00110")] },
    { tributo: "ISS", memoria: [item("PP-00111")] },
  ] as unknown as Guia[];
  const pps = ppsComIssNaGuia(guias, [
    { id: "pp-110", pp: "PP-00110", aliquotas_aprovacao: { ISS: 5 } },
    { id: "pp-111", pp: "PP-00111", aliquotas_aprovacao: { ISS: 2 } },
    { id: "pp-112", pp: "PP-00112", aliquotas_aprovacao: {} },
  ]);
  assert.deepEqual([...pps.entries()], [["pp-110", 5]]);
  assert.equal(parcelaSemIssRetido(8000, 5), 7600);
  assert.equal(parcelaSemIssRetido(333.33, 2), 326.66);
});
