/**
 * Testes da conta da Mídia Off — decisão 147.
 *
 * Rode com:  node --import tsx --test lib/calculos/midia-off.test.ts
 *
 * Os números são sintéticos: as planilhas de referência dos PMs (Pátria,
 * Zé Delivery, Brahma, Nacional Gás) são dado comercial de cliente e não
 * entram no repositório. A conta foi conferida contra elas no protótipo
 * aprovado em 06/10/2026, e este módulo bate com ele nos cinco exemplos.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  comAContaDaMidia,
  composicao,
  contaDaLinha,
  desembolsoDaMidia,
  diaSeguinte,
  diasDoMes,
  fechamentoDosItens,
  fechar,
  lerNumero,
  linhaDoItem,
  mesEmVeiculacao,
  notaDoVeiculo,
  quantidadeDaLinha,
  realizadoDaLinhaMidia,
  ultimaVeiculacaoDoMes,
  type LinhaMidia,
  type MeioDaVersao,
  type ParametrosMidia,
} from "./midia-off";
import { erroDoPeriodoDaCampanha } from "./meses-trimestre";

const P20: ParametrosMidia = { honorarios: 20, imposto: 19.53, base: "negociado", veiculo: 80 };
const P13_LIQ: ParametrosMidia = { honorarios: 13, imposto: 19.53, base: "liquido", veiculo: 80 };

function linha(parcial: Partial<LinhaMidia>): LinhaMidia {
  return {
    id: "l",
    grupoId: "g",
    forma: "grade",
    tipo: "A",
    praca: "",
    veiculoId: null,
    descricao: "",
    detalhe: "",
    peca: "A",
    formato: "",
    dias: {},
    inicio: null,
    fim: null,
    qtde: 0,
    periodos: 0,
    unidadePeriodo: "",
    unitTabela: 0,
    desconto: 0,
    unitNegociado: 0,
    ...parcial,
  };
}

const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test("grade: a quantidade é a soma das inserções do mês", () => {
  assert.equal(quantidadeDaLinha(linha({ dias: { 1: 2, 2: 3, 15: 1 } })), 6);
});

test("período: a quantidade é qtde × períodos", () => {
  assert.equal(quantidadeDaLinha(linha({ forma: "periodo", qtde: 4, periodos: 3 })), 12);
});

test("honorários sobre o negociado: veículo 80%, honorários 20%, total = negociado", () => {
  const c = contaDaLinha(linha({ dias: { 1: 2, 2: 3 }, unitNegociado: 1000, unitTabela: 2500 }), P20);
  perto(c.totalNegociado, 5000);
  perto(c.totalTabela, 12500);
  perto(c.notaVeiculo, 4000);
  perto(c.notaAgencia, 1000);
  perto(c.total, 5000);
});

test("honorários sobre o líquido (AMBEV): 13% do veículo", () => {
  const c = contaDaLinha(linha({ dias: { 1: 5 }, unitNegociado: 1000 }), P13_LIQ);
  perto(c.notaVeiculo, 4000);
  perto(c.notaAgencia, 520);
  perto(c.total, 4520);
});

test("composição: 13% do líquido viram 10,4% do negociado, e 9,6% ficam com o cliente", () => {
  const c = composicao(P13_LIQ);
  perto(c.honorarios, 10.4);
  perto(c.total, 90.4);
  perto(c.cliente, 9.6);
});

test("fechamento: faturamento = honorários + veículos em A · Repasse; impostos de dentro dos honorários", () => {
  const meios: MeioDaVersao[] = [
    { chave: "tv", meio: "TV Fechada", formato: 'Filme 30"', forma: "grade" },
    { chave: "ooh", meio: "OOH · Outdoor", formato: "9 x 3 m", forma: "periodo" },
  ];
  const linhas = [
    linha({ id: "a", grupoId: "tv", dias: { 1: 10 }, unitNegociado: 1000 }),
    linha({ id: "b", grupoId: "ooh", forma: "periodo", tipo: "AR", qtde: 2, periodos: 1, unitNegociado: 2500 }),
  ];
  const f = fechar(meios, linhas, (l) => l.grupoId, P20);
  // negociado 10.000 + 5.000; veículos 12.000 (4.000 em AR); honorários 3.000.
  perto(f.valorJob, 15000);
  perto(f.custoPlanejado, 12000);
  perto(f.veiculosRepasse, 4000);
  perto(f.veiculosDireto, 8000);
  perto(f.honorarios, 3000);
  perto(f.faturamentoPrevisto, 7000);
  perto(f.imposto, 3000 * 0.1953);
  perto(f.resultadoOperacional, 15000 - 3000 * 0.1953 - 12000);
  perto(f.resultadoGeral!, ((15000 - 3000 * 0.1953 - 12000) / 15000) * 100);
  assert.deepEqual(
    f.porMeio.map((m) => [m.meio.chave, m.conta.total]),
    [
      ["tv", 10000],
      ["ooh", 5000],
    ],
  );
});

test("o fechamento pelo gravado (total negociado) é o mesmo da planilha", () => {
  const linhas = [
    linha({ id: "a", dias: { 3: 4 }, unitNegociado: 812.5 }),
    linha({ id: "b", forma: "periodo", tipo: "AR", qtde: 3, periodos: 2, unitNegociado: 1333.33 }),
  ];
  for (const p of [P20, P13_LIQ]) {
    const daPlanilha = fechar([], linhas, () => "x", p);
    const doGravado = fechamentoDosItens(
      linhas.map((l) => ({ tipo_custo: l.tipo, total_orcado: l.unitNegociado * quantidadeDaLinha(l) })),
      p,
    );
    perto(doGravado.valorJob, daPlanilha.valorJob);
    perto(doGravado.faturamentoPrevisto, daPlanilha.faturamentoPrevisto);
    perto(doGravado.resultadoOperacional, daPlanilha.resultadoOperacional);
  }
});

test("sem linhas, não há resultado geral", () => {
  assert.equal(fechamentoDosItens([], P20).resultadoGeral, null);
});

test("do item gravado: desconto em %, inserções do jsonb, A · Repasse", () => {
  const l = linhaDoItem(
    {
      id: "i",
      grupo_id: "g",
      tipo_custo: "AR",
      praca: "Nacional",
      fornecedor_id: "f",
      item: "Jornal",
      detalhe: null,
      peca: "B",
      formato: 'Filme 30"',
      insercoes_por_dia: { "1": 2, "2": 0, "30": 1 },
      data_inicio: null,
      data_fim: null,
      quantidade_orcada: 3,
      dias_meses_orcado: 1,
      unidade_periodo: null,
      valor_unitario_tabela: 1000,
      percentual_desconto: 60,
      valor_unitario_orcado: 400,
    },
    "grade",
  );
  assert.equal(l.tipo, "AR");
  assert.equal(l.desconto, 0.6);
  assert.deepEqual(l.dias, { 1: 2, 30: 1 });
  assert.equal(l.veiculoId, "f");
});

test("os dias do mês: setembro com 30, fevereiro com 28 ou 29", () => {
  assert.equal(diasDoMes("2026-09").length, 30);
  assert.equal(diasDoMes("2026-02-01").length, 28);
  assert.equal(diasDoMes("2028-02").length, 29);
  // 01/09/2026 é uma terça.
  assert.equal(diasDoMes("2026-09")[0].inicial, "T");
  assert.equal(diasDoMes("2026-09")[4].fimDeSemana, true);
});

test("número digitado em pt-BR", () => {
  assert.equal(lerNumero("1.234,56"), 1234.56);
  assert.equal(lerNumero("R$ 10,5"), 10.5);
  assert.equal(lerNumero("60%"), 60);
  assert.equal(lerNumero(""), null);
  assert.equal(lerNumero("abc"), null);
});

test("período da campanha: sem a trava do trimestre, com teto de 24 meses", () => {
  assert.equal(erroDoPeriodoDaCampanha("2026-07-01", "2027-03-31"), null);
  assert.equal(erroDoPeriodoDaCampanha("2026-09-15", "2026-10-15"), null);
  assert.match(erroDoPeriodoDaCampanha(null, "2026-09-30") ?? "", /início e o fim/);
  assert.match(erroDoPeriodoDaCampanha("2026-09-30", "2026-07-01") ?? "", /posterior/);
  assert.match(erroDoPeriodoDaCampanha("2026-01-01", "2062-01-01") ?? "", /24 meses/);
});

// ---- O job da Mídia Off (decisão 167) -------------------------------------

test("última veiculação: o maior dia com inserção e o maior fim de período", () => {
  // Grade com inserção nos dias 2 e 10, e um dia zerado depois deles.
  assert.equal(
    ultimaVeiculacaoDoMes("2026-11-01", [
      { insercoes_por_dia: { "2": 3, "10": 4, "28": 0 }, data_fim: null },
    ]),
    "2026-11-10",
  );
  // O período que cruza o mês entra no mês em que começa, e o fim conta.
  assert.equal(
    ultimaVeiculacaoDoMes("2026-11-01", [
      { insercoes_por_dia: { "5": 1 }, data_fim: null },
      { insercoes_por_dia: null, data_fim: "2026-12-06" },
    ]),
    "2026-12-06",
  );
  assert.equal(ultimaVeiculacaoDoMes("2026-11-01", []), null);
});

test("o mês libera no dia seguinte à última veiculação", () => {
  assert.equal(diaSeguinte("2026-11-10"), "2026-11-11");
  assert.equal(diaSeguinte("2026-12-31"), "2027-01-01");
  assert.equal(mesEmVeiculacao("2026-11-01", "2026-11-10", "2026-11-10"), true);
  assert.equal(mesEmVeiculacao("2026-11-01", "2026-11-10", "2026-11-11"), false);
  // Sem data nas linhas, vale o fim do mês.
  assert.equal(mesEmVeiculacao("2026-11-01", null, "2026-11-30"), true);
  assert.equal(mesEmVeiculacao("2026-11-01", null, "2026-12-01"), false);
});

test("desembolso: só a nota dos veículos em A · Repasse", () => {
  const itens = [
    { tipo_custo: "A", total_orcado: 2000 },
    { tipo_custo: "AR", total_orcado: 20000 },
  ];
  assert.equal(desembolsoDaMidia(itens, P20), 16000);
  assert.equal(desembolsoDaMidia([{ tipo_custo: "A", total_orcado: 2000 }], P20), 0);
});

test("realizado da linha: nota do veículo no A · Direto, PPs no A · Repasse", () => {
  // P20: veículo 80%.
  assert.equal(notaDoVeiculo(2000, P20), 1600);
  assert.equal(realizadoDaLinhaMidia("A", 2000, 999, P20, true), 1600);
  assert.equal(realizadoDaLinhaMidia("AR", 20000, 0, P20, true), 0);
  assert.equal(realizadoDaLinhaMidia("AR", 20000, 16000, P20, true), 16000);
  // Antes da abertura no financeiro não há realizado.
  assert.equal(realizadoDaLinhaMidia("A", 2000, 0, P20, false), 0);
});

test("os campos planos do job pela conta da mídia", () => {
  const p: ParametrosMidia = { honorarios: 12, imposto: 19.53, base: "negociado", veiculo: 80 };
  const f = fechamentoDosItens(
    [
      { tipo_custo: "A", total_orcado: 2000 },
      { tipo_custo: "A", total_orcado: 5000 },
    ],
    p,
  );
  const t = comAContaDaMidia(
    {
      honorarios: 0,
      imposto: 0,
      intTaxes: 9,
      intTransactionCosts: 9,
      deducoesDoResultado: 0,
      faturamentoPrevisto: 0,
      valorJob: 0,
      outro: "fica",
    },
    f,
  );
  assert.equal(t.valorJob, 6440);
  assert.equal(t.faturamentoPrevisto, 840);
  assert.equal(t.honorarios, 840);
  assert.equal(Math.round(t.imposto * 100) / 100, 164.05);
  assert.equal(t.deducoesDoResultado, t.imposto);
  assert.equal(t.intTaxes, 0);
  assert.equal(t.outro, "fica");
});
