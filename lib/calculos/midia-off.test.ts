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
  composicao,
  contaDaLinha,
  diasDoMes,
  fechamentoDosItens,
  fechar,
  lerNumero,
  linhaDoItem,
  quantidadeDaLinha,
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
