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
  alvoDoRepasse,
  cortarLinha,
  diasEntre,
  infoDoRealizado,
  linhaDaExtensao,
  proporcionalDoPeriodo,
  faltaDoVeiculoNoMes,
  listaDoQueFalta,
  piorRepasse,
  situacaoDoRepasse,
  veiculosNoMes,
  comAContaDaMidia,
  composicao,
  decomposicaoDoRepasse,
  planejadoDaLinhaMidia,
  ultimaVeiculacaoDaCampanha,
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

// ---- Entrega 3 da decisão 167: a PP do repasse ---------------------------

test("planejado da linha do job: a parte do veículo no unitário", () => {
  const p = planejadoDaLinhaMidia(
    { valor_unitario_orcado: 2500, quantidade_orcada: 4, dias_meses_orcado: 2 },
    P20,
  );
  assert.deepEqual(p, { valor_unitario_planejado: 2000, quantidade_planejada: 4, dias_meses_planejado: 2 });
  // Seis casas: 80% de 1.234,56 não pode virar centavo a mais.
  const q = planejadoDaLinhaMidia(
    { valor_unitario_orcado: 1234.56, quantidade_orcada: 3, dias_meses_orcado: 1 },
    P20,
  );
  assert.equal(q.valor_unitario_planejado, 987.648);
});

test("alvo do repasse: a nota do veículo na mídia, o orçado no nacional", () => {
  assert.equal(alvoDoRepasse(20000, P20), 16000);
  assert.equal(alvoDoRepasse("20000", null), 20000);
  assert.equal(alvoDoRepasse(null, P20), 0);
});

test("PP do repasse pré-preenchida: decompõe só quando fecha no centavo", () => {
  assert.deepEqual(decomposicaoDoRepasse(16000, 4, 2), { unitario: 2000, quantidade: 4, dm: 2 });
  // 1.000 em 3 não fecha no centavo: vai inteiro, 1 × 1.
  assert.deepEqual(decomposicaoDoRepasse(1000, 3, 1), { unitario: 1000, quantidade: 1, dm: 1 });
  // Quantidade ou períodos zerados contam como 1.
  assert.deepEqual(decomposicaoDoRepasse(500, 0, 0), { unitario: 500, quantidade: 1, dm: 1 });
});

test("fim da campanha: a maior última veiculação entre os meses", () => {
  assert.equal(ultimaVeiculacaoDaCampanha(["2026-11-20", null, "2026-12-31"]), "2026-12-31");
  assert.equal(ultimaVeiculacaoDaCampanha([null, null]), null);
});

// ---- Entrega 4 (decisão 274): os veículos de cada mês --------------------

test("situação da PP do repasse: gerar, enviar, fechar, enviada e paga", () => {
  assert.equal(situacaoDoRepasse([], false), "a_gerar");
  assert.equal(situacaoDoRepasse([{ status: "cancelada" }], false), "a_gerar");
  assert.equal(situacaoDoRepasse([{ status: "gerada" }], true), "a_enviar");
  assert.equal(situacaoDoRepasse([{ status: "aprovada" }, { status: "rejeitada" }], true), "a_enviar");
  assert.equal(situacaoDoRepasse([{ status: "em_avaliacao" }], false), "por_fechar");
  assert.equal(situacaoDoRepasse([{ status: "aprovada" }, { status: "pago" }], true), "enviada");
  assert.equal(situacaoDoRepasse([{ status: "pago" }, { status: "cancelada" }], true), "paga");
  assert.equal(piorRepasse(["paga", "a_enviar", "enviada"]), "a_enviar");
  assert.equal(piorRepasse([]), null);
});

test("o que falta ao veículo no mês: AP, PI, a NF do Direto e a PP do Repasse", () => {
  const base = { nota: 1000, temDireto: true, repasse: null, temAP: false, temPI: false, temNF: false };
  assert.deepEqual(faltaDoVeiculoNoMes(base), ["AP", "PI", "NF"]);
  assert.deepEqual(faltaDoVeiculoNoMes({ ...base, temAP: true, temPI: true, temNF: true }), []);
  assert.deepEqual(
    faltaDoVeiculoNoMes({ ...base, temDireto: false, repasse: "a_enviar", temAP: true, temPI: true }),
    ["envio da PP do repasse"],
  );
  // Sem veiculação no mês, nada é pedido.
  assert.deepEqual(faltaDoVeiculoNoMes({ ...base, nota: 0 }), []);
  assert.equal(listaDoQueFalta(["AP", "PI", "NF"]), "AP, PI e NF");
});

test("veículos do mês: agrupa as linhas pelo veículo, com os documentos dele", () => {
  const linhas = [
    { id: "l1", fornecedorId: "v1", tipo: "A", negociado: 1000, meio: "TV Fechada", repasse: null },
    { id: "l2", fornecedorId: "v1", tipo: "AR", negociado: 500, meio: "Rádio", repasse: "enviada" as const },
    { id: "l3", fornecedorId: "v2", tipo: "AR", negociado: 2000, meio: "OOH", repasse: "a_gerar" as const },
    { id: "l4", fornecedorId: null, tipo: "A", negociado: 300, meio: "OOH", repasse: null },
  ];
  const docs = [
    { fornecedorId: "v1", mes: "2026-12-01", tipo: "ap" },
    { fornecedorId: "v1", mes: "2026-12-01", tipo: "pi" },
    { fornecedorId: "v1", mes: "2026-11-01", tipo: "nf" },
  ];
  const vs = veiculosNoMes("2026-12-01", linhas, docs, P20);
  assert.equal(vs.length, 2);
  const [v1, v2] = vs;
  assert.deepEqual(v1.linhaIds, ["l1", "l2"]);
  assert.deepEqual(v1.tipos, ["A", "AR"]);
  assert.equal(v1.negociado, 1500);
  assert.equal(v1.nota, 1200);
  // A NF de novembro não vale para dezembro.
  assert.deepEqual(v1.falta, ["NF"]);
  assert.deepEqual(v2.falta, ["AP", "PI", "PP do repasse"]);
});

// ---- Entrega 5 (decisão 275): encerrar antes e estender -----------------

const OUTDOOR = {
  valor_unitario_orcado: 2500,
  quantidade_orcada: 4,
  dias_meses_orcado: 2,
  total_orcado: 20000,
  insercoes_por_dia: null,
  data_inicio: "2026-12-01",
  data_fim: "2026-12-31",
};

test("proporcional do período: os dias que ficaram no ar", () => {
  assert.equal(diasEntre("2026-12-01", "2026-12-31"), 31);
  // O exemplo do protótipo: o outdoor de dezembro encerrado em 15/12.
  assert.deepEqual(proporcionalDoPeriodo(OUTDOOR, "2026-12-15"), { valor: 9677.42, dias: 15, total: 31 });
  assert.deepEqual(proporcionalDoPeriodo(OUTDOOR, "2026-11-30"), { valor: 0, dias: 0, total: 31 });
  assert.deepEqual(proporcionalDoPeriodo(OUTDOOR, "2026-12-31"), { valor: 20000, dias: 31, total: 31 });
});

test("cortar a linha por período: o fim vira o dia e o negociado o proporcional (ou o digitado)", () => {
  const c = cortarLinha(OUTDOOR, "2026-12-01", "2026-12-15")!;
  assert.equal(c.data_fim, "2026-12-15");
  assert.equal(c.total, 9677.42);
  assert.equal(Math.round(2500 * 4 * c.dias_meses_orcado * 100) / 100, 9677.42);
  assert.equal(c.dias, 15);
  const editado = cortarLinha(OUTDOOR, "2026-12-01", "2026-12-15", 10000)!;
  assert.equal(editado.total, 10000);
  // Depois do fim, nada a cortar.
  assert.equal(cortarLinha(OUTDOOR, "2026-12-01", "2026-12-31"), null);
  // Antes do início: não vai ao ar.
  const cancelada = cortarLinha(OUTDOOR, "2026-12-01", "2026-11-30")!;
  assert.equal(cancelada.total, 0);
  assert.equal(cancelada.data_fim, "2026-12-01");
});

test("cortar a linha da grade: as inserções depois do dia saem", () => {
  const tv = {
    valor_unitario_orcado: 1100,
    quantidade_orcada: 7,
    dias_meses_orcado: 1,
    total_orcado: 7700,
    insercoes_por_dia: { "2": 3, "10": 4 },
    data_inicio: null,
    data_fim: null,
  };
  const c = cortarLinha(tv, "2026-11-01", "2026-11-05")!;
  assert.deepEqual(c.insercoes_por_dia, { "2": 3 });
  assert.deepEqual(c.diasCortados, { "10": 4 });
  assert.equal(c.quantidade_orcada, 3);
  assert.equal(c.total, 3300);
});

test("linha da extensão: no unitário da linha de origem", () => {
  const g = linhaDaExtensao({ valor_unitario_orcado: 1100, quantidade_orcada: 7 }, { forma: "grade", dias: { "3": 2, "4": 0, "5": 2 } });
  assert.deepEqual(g.insercoes_por_dia, { "3": 2, "5": 2 });
  assert.equal(g.total, 4400);
  const p = linhaDaExtensao(OUTDOOR, { forma: "periodo", inicio: "2027-01-01", fim: "2027-01-15", valor: 9677.42 });
  assert.equal(p.total, 9677.42);
  assert.equal(Math.round(2500 * 4 * p.dias_meses_orcado * 100) / 100, 9677.42);
});

test("o que mudou na linha: encerrada, cancelada, extensão e igual", () => {
  const P = { honorarios: 13, imposto: 19.53, base: "liquido" as const, veiculo: 80 };
  const corte = cortarLinha(OUTDOOR, "2026-12-01", "2026-12-15")!;
  const atual = { ...OUTDOOR, ...corte, total_orcado: corte.total };
  const info = infoDoRealizado(atual, OUTDOOR, "2026-12-15", P);
  assert.equal(info.status, "encerrada");
  assert.equal(info.rotulo, "Encerrada em 15/12");
  assert.equal(info.fimPlanejado, "2026-12-31");
  assert.equal(info.textoPeriodos, "15 de 31 dias");
  assert.equal(info.contaPlanejada?.totalNegociado, 20000);
  assert.equal(infoDoRealizado(OUTDOOR, OUTDOOR, null, P).status, "igual");
  const ext = infoDoRealizado({ ...OUTDOOR, data_inicio: "2027-01-01", data_fim: "2027-01-15" }, null, null, P);
  assert.equal(ext.status, "extensao");
  assert.equal(ext.textoPeriodos, "15 dias");
  const tv = { valor_unitario_orcado: 1100, quantidade_orcada: 7, dias_meses_orcado: 1, total_orcado: 7700, insercoes_por_dia: { "2": 3, "10": 4 }, data_inicio: null, data_fim: null };
  const c2 = cortarLinha(tv, "2026-11-01", "2026-11-05")!;
  const i2 = infoDoRealizado({ ...tv, ...c2, total_orcado: c2.total }, tv, "2026-11-05", P);
  assert.equal(i2.rotulo, "Encerrada em 05/11");
  assert.deepEqual(i2.diasCortados, { "10": 4 });
  const c3 = cortarLinha(tv, "2026-11-01", "2026-11-01")!;
  assert.equal(infoDoRealizado({ ...tv, ...c3, total_orcado: c3.total }, tv, "2026-11-01", P).status, "cancelada");
});

test("AP e PI de antes da extensão não a cobrem", () => {
  const linhas = [
    { id: "l1", fornecedorId: "v1", tipo: "A", negociado: 1000, meio: "OOH", repasse: null },
    { id: "x1", fornecedorId: "v1", tipo: "A", negociado: 500, meio: "OOH", repasse: null, extensaoEm: "2026-12-10T10:00:00Z" },
  ];
  const docs = [
    { fornecedorId: "v1", mes: "2026-12-01", tipo: "ap", criadoEm: "2026-12-01T10:00:00Z" },
    { fornecedorId: "v1", mes: "2026-12-01", tipo: "pi", criadoEm: "2026-12-11T10:00:00Z" },
    { fornecedorId: "v1", mes: "2026-12-01", tipo: "nf", criadoEm: "2026-12-12T10:00:00Z" },
  ];
  const [v] = veiculosNoMes("2026-12-01", linhas, docs, P20);
  assert.equal(v.apAntesDaExtensao, true);
  assert.equal(v.piAntesDaExtensao, false);
  assert.deepEqual(v.falta, ["AP da extensão"]);
});
