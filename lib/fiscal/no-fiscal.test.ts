/**
 * O bloco "No fiscal" das baixas (módulo fiscal, entrega 2): o mês e o
 * vencimento de cada guia que a baixa faz nascer, com feriado e fim de semana.
 * Rodar: node --import tsx --test lib/fiscal/no-fiscal.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  efeitoDoLote,
  efeitoDoPagamento,
  efeitoDoRecebimento,
  regimeNaData,
  valorVigente,
  type FiscalDoLote,
  type FiscalDoPagamento,
  type FiscalDoRecebimento,
} from "./no-fiscal";

// Os feriados do cadastro real (fiscal_feriados) que os casos usam.
const FERIADOS = [
  { data: "2026-11-02", nome: "Finados", municipio: null },
  { data: "2026-11-15", nome: "Proclamação da República", municipio: null },
  { data: "2026-11-20", nome: "Dia da Consciência Negra", municipio: null },
  { data: "2026-12-08", nome: "Nossa Senhora da Conceição da Praia", municipio: "Salvador" },
  { data: "2026-12-25", nome: "Natal", municipio: null },
];

const CALIFORNIA = { id: "pj-california", nome: "California", municipio_da_matriz: "Salvador" };
const GOCRAZY = { id: "pj-gocrazy", nome: "GoCrazy", municipio_da_matriz: "Santo André" };
const HITLAB = { id: "pj-hitlab", nome: "Hitlab", municipio_da_matriz: "Salvador" };

const REGIMES = [
  { empresa_contabil_id: CALIFORNIA.id, regime: "lucro_real" as const, regime_caixa: false, vigencia_inicio: "2026-01-01", vigencia_fim: null },
  { empresa_contabil_id: GOCRAZY.id, regime: "lucro_real" as const, regime_caixa: false, vigencia_inicio: "2026-01-01", vigencia_fim: null },
  { empresa_contabil_id: HITLAB.id, regime: "lucro_presumido" as const, regime_caixa: true, vigencia_inicio: "2026-01-01", vigencia_fim: null },
];

/** A PP-00110: NF 602 de 01/10/2026 para a California · Salvador. */
const PP: FiscalDoPagamento = {
  nf: { numero: "602", emissao: "2026-10-01" },
  tomador: { nome: "California · Salvador", municipio: "Salvador", uf: "BA", iss_retido_dia: 5, iss_regra: "prorroga" },
  pj: CALIFORNIA,
  feriados: FERIADOS,
  dia_das_retencoes: [{ valor: 20, vigencia_inicio: "2026-01-01" }],
  primeira_competencia: "2026-10",
};

/** 6,15% de R$ 8.000: PIS 0,65%, COFINS 3%, CSLL 1% e IRRF 1,5%. */
const RETIDOS_DA_PP = { ISS: 0, PIS: 52, COFINS: 240, CSLL: 80, IRRF: 120 };

// ---------------------------------------------------------------------------
// Pagamento de PP
// ---------------------------------------------------------------------------

test("PP-00110 paga em outubro: DARF 5952 e 1708 de outubro, e o dia 20/11 (feriado) antecipa", () => {
  const e = efeitoDoPagamento(PP, "2026-10-02", RETIDOS_DA_PP);
  assert.deepEqual(e.darfs, [
    { codigo: "5952", rotulo: "PIS/COFINS/CSLL retidos", valor: 372 },
    { codigo: "1708", rotulo: "IRRF", valor: 120 },
  ]);
  assert.equal(e.competencia, "2026-10");
  assert.deepEqual(e.vencimento, {
    data: "2026-11-19",
    motivo: "20/11/2026 é feriado (Dia da Consciência Negra) · antecipa",
  });
  assert.equal(e.darfsForaDaApuracao, false);
  assert.equal(e.iss, null);
});

test("o mês é o do PAGAMENTO: paga em novembro, vence em 20/12 (domingo) e antecipa para sexta", () => {
  const e = efeitoDoPagamento(PP, "2026-11-30", RETIDOS_DA_PP);
  assert.equal(e.competencia, "2026-11");
  assert.deepEqual(e.vencimento, { data: "2026-12-18", motivo: "20/12/2026 é domingo · antecipa" });
});

test("mudou a data, muda a guia: paga em dezembro, vence em 20/01/2027 (quarta), sem ajuste", () => {
  const e = efeitoDoPagamento(PP, "2026-12-01", RETIDOS_DA_PP);
  assert.equal(e.competencia, "2026-12");
  assert.deepEqual(e.vencimento, { data: "2027-01-20", motivo: null });
});

test("o dia das retenções é o vigente no fim do mês do pagamento", () => {
  const f = { ...PP, dia_das_retencoes: [{ valor: 20, vigencia_inicio: "2026-01-01" }, { valor: 15, vigencia_inicio: "2027-01-01" }] };
  assert.equal(efeitoDoPagamento(f, "2026-12-10", RETIDOS_DA_PP).vencimento?.data, "2027-01-20");
  assert.equal(efeitoDoPagamento(f, "2027-01-10", RETIDOS_DA_PP).vencimento?.data, "2027-02-15");
});

test("só IRRF: só o DARF 1708; retenção desligada: nenhuma guia", () => {
  const soIrrf = efeitoDoPagamento(PP, "2026-10-02", { IRRF: 120 });
  assert.deepEqual(soIrrf.darfs.map((d) => d.codigo), ["1708"]);
  const nada = efeitoDoPagamento(PP, "2026-10-02", null);
  assert.deepEqual(nada.darfs, []);
  assert.equal(nada.vencimento, null);
  assert.equal(nada.iss, null);
});

test("sem data: as guias aparecem, sem mês nem vencimento", () => {
  const e = efeitoDoPagamento(PP, "", RETIDOS_DA_PP);
  assert.equal(e.darfs.length, 2);
  assert.equal(e.competencia, null);
  assert.equal(e.vencimento, null);
});

test("ISS retido: mês da EMISSÃO da NF, no município do tomador, e não o do pagamento", () => {
  const e = efeitoDoPagamento(PP, "2026-12-15", { ...RETIDOS_DA_PP, ISS: 400 });
  assert.equal(e.competencia, "2026-12");
  assert.deepEqual(e.iss, {
    valor: 400,
    competencia: "2026-10",
    vencimento: { data: "2026-11-05", motivo: null },
    foraDaApuracao: false,
  });
});

test("ISS retido com o dia 5 num sábado: prorroga para segunda", () => {
  const f = { ...PP, nf: { numero: "700", emissao: "2026-11-10" } };
  assert.deepEqual(efeitoDoPagamento(f, "2026-11-20", { ISS: 100 }).iss?.vencimento, {
    data: "2026-12-07",
    motivo: "05/12/2026 é sábado · prorroga",
  });
});

test("o feriado municipal só vale no município do tomador", () => {
  const salvador = { ...PP, nf: { numero: "701", emissao: "2026-11-10" }, tomador: { ...PP.tomador, iss_retido_dia: 8 } };
  assert.deepEqual(efeitoDoPagamento(salvador, "2026-11-20", { ISS: 100 }).iss?.vencimento, {
    data: "2026-12-09",
    motivo: "08/12/2026 é feriado (Nossa Senhora da Conceição da Praia) · prorroga",
  });
  const saoPaulo = { ...salvador, tomador: { ...salvador.tomador, nome: "California · São Paulo", municipio: "São Paulo", uf: "SP" } };
  assert.deepEqual(efeitoDoPagamento(saoPaulo, "2026-11-20", { ISS: 100 }).iss?.vencimento, { data: "2026-12-08", motivo: null });
});

test("os federais vencem pelo município da MATRIZ da PJ tomadora", () => {
  // Um feriado só de Santo André no dia 20: a GoCrazy antecipa, a California não.
  const feriados = [...FERIADOS, { data: "2027-01-20", nome: "Feriado local", municipio: "Santo André" }];
  const california = efeitoDoPagamento({ ...PP, feriados }, "2026-12-10", RETIDOS_DA_PP);
  const gocrazy = efeitoDoPagamento({ ...PP, feriados, pj: GOCRAZY }, "2026-12-10", RETIDOS_DA_PP);
  assert.equal(california.vencimento?.data, "2027-01-20");
  assert.equal(gocrazy.vencimento?.data, "2027-01-19");
});

test("pagamento de antes do módulo (setembro/2026) fica fora da Apuração", () => {
  const e = efeitoDoPagamento(PP, "2026-09-30", RETIDOS_DA_PP);
  assert.equal(e.competencia, "2026-09");
  assert.equal(e.darfsForaDaApuracao, true);
});

// ---------------------------------------------------------------------------
// Recebimento de NF
// ---------------------------------------------------------------------------

const NOTA_CALIFORNIA: FiscalDoRecebimento = {
  nota: { numero: "1180", emissao: "2026-10-05" },
  emissor: { nome: "California · Salvador", municipio: "Salvador", uf: "BA" },
  pj: CALIFORNIA,
  regimes: REGIMES,
  cnae: { aliquota_pis: 1.65, aliquota_cofins: 7.6 },
  guia_iss: null,
  compensa_iss: true,
  feriados: FERIADOS,
  dia_do_pis_cofins: [{ valor: 25, vigencia_inicio: "2026-01-01" }],
  primeira_competencia: "2026-10",
};

const NOTA_HITLAB: FiscalDoRecebimento = {
  ...NOTA_CALIFORNIA,
  nota: { numero: "1204", emissao: "2026-10-20" },
  emissor: { nome: "Hitlab · Salvador", municipio: "Salvador", uf: "BA" },
  pj: HITLAB,
  cnae: { aliquota_pis: 0.65, aliquota_cofins: 3 },
};

test("lucro real sem retenção: nada muda, a nota já entrou na emissão", () => {
  const e = efeitoDoRecebimento(NOTA_CALIFORNIA, "2026-11-16", 10000, null);
  assert.equal(e.regime, "lucro_real");
  assert.deepEqual(e.linhas, [{ tipo: "nada_muda", competencia_nota: "2026-10", antes_do_modulo: false }]);
});

test("sem data: pede a data", () => {
  assert.deepEqual(efeitoDoRecebimento(NOTA_CALIFORNIA, "", 10000, null).linhas, [{ tipo: "sem_data" }]);
});

test("retidos pelo cliente: PIS/COFINS no mês do recebimento, CSLL/IRRF no trimestre", () => {
  const e = efeitoDoRecebimento(NOTA_CALIFORNIA, "2027-01-08", 10000, { PIS: 65, COFINS: 300, CSLL: 100, IRRF: 150 });
  assert.deepEqual(e.linhas, [
    { tipo: "pis_cofins_retidos", pis: true, cofins: true, competencia: "2027-01" },
    { tipo: "csll_irrf_retidos", csll: true, irrf: true, trimestre: "1º trimestre/2027" },
  ]);
  const soIrrf = efeitoDoRecebimento(NOTA_CALIFORNIA, "2026-11-16", 10000, { IRRF: 150 });
  assert.deepEqual(soIrrf.linhas, [{ tipo: "csll_irrf_retidos", csll: false, irrf: true, trimestre: "4º trimestre/2026" }]);
});

test("ISS retido antes de aprovada a guia: sai da apuração do mês da nota", () => {
  const e = efeitoDoRecebimento(NOTA_CALIFORNIA, "2026-10-28", 10000, { ISS: 500 });
  assert.deepEqual(e.linhas, [{ tipo: "iss_do_cliente", competencia_nota: "2026-10" }]);
});

test("ISS retido depois de aprovada a guia: ISS a recuperar (no mesmo dia, ainda abate a guia)", () => {
  const f = { ...NOTA_CALIFORNIA, guia_iss: { aprovada_em: "2026-11-03", paga_em: "2026-11-05" } };
  assert.deepEqual(efeitoDoRecebimento(f, "2026-11-16", 10000, { ISS: 500 }).linhas, [
    { tipo: "iss_a_recuperar", competencia_nota: "2026-10", aprovada_em: "2026-11-03", paga_em: "2026-11-05", compensa: true },
  ]);
  assert.deepEqual(efeitoDoRecebimento(f, "2026-11-03", 10000, { ISS: 500 }).linhas, [
    { tipo: "iss_do_cliente", competencia_nota: "2026-10" },
  ]);
  const restituir = { ...f, compensa_iss: false };
  const linha = efeitoDoRecebimento(restituir, "2026-11-16", 10000, { ISS: 500 }).linhas[0];
  assert.equal(linha.tipo === "iss_a_recuperar" && linha.compensa, false);
});

test("presumido pelo caixa: PIS e COFINS do CNAE sobre o bruto, vencendo no dia 25 do mês seguinte", () => {
  const e = efeitoDoRecebimento(NOTA_HITLAB, "2026-11-16", 10000, null);
  assert.equal(e.regime, "lucro_presumido");
  assert.equal(e.regime_caixa, true);
  assert.deepEqual(e.linhas, [
    {
      tipo: "caixa",
      pis: 65,
      aliquota_pis: 0.65,
      cofins: 300,
      aliquota_cofins: 3,
      vencimento: { data: "2026-12-24", motivo: "25/12/2026 é feriado (Natal) · antecipa" },
      trimestre: "4º trimestre/2026",
    },
  ]);
});

test("presumido pelo caixa com o dia 25 num domingo: antecipa para sexta", () => {
  const linha = efeitoDoRecebimento(NOTA_HITLAB, "2027-03-10", 2000, null).linhas[0];
  assert.equal(linha.tipo, "caixa");
  assert.deepEqual(linha.tipo === "caixa" && linha.vencimento, {
    data: "2027-04-23",
    motivo: "25/04/2027 é domingo · antecipa",
  });
});

test("recebimento de antes do módulo fica fora da Apuração", () => {
  assert.deepEqual(efeitoDoRecebimento(NOTA_CALIFORNIA, "2026-09-30", 10000, { ISS: 500 }).linhas, [
    { tipo: "antes_do_modulo", competencia: "2026-09", primeira: "2026-10" },
  ]);
});

test("nota emitida antes do módulo: o ISS retido não tem guia para abater", () => {
  const f = { ...NOTA_CALIFORNIA, nota: { numero: "1", emissao: "2026-09-24" } };
  assert.deepEqual(efeitoDoRecebimento(f, "2026-10-15", 10000, { ISS: 500 }).linhas, [
    { tipo: "iss_antes_do_modulo", competencia_nota: "2026-09", primeira: "2026-10" },
  ]);
  assert.deepEqual(efeitoDoRecebimento(f, "2026-10-15", 10000, null).linhas, [
    { tipo: "nada_muda", competencia_nota: "2026-09", antes_do_modulo: true },
  ]);
});

// ---------------------------------------------------------------------------
// Baixa em lote
// ---------------------------------------------------------------------------

const LOTE: FiscalDoLote = {
  parcelas: { "parc-602": CALIFORNIA, "parc-900": GOCRAZY },
  titulos: { "tit-hitlab": HITLAB, "tit-california": CALIFORNIA },
  regimes: REGIMES,
  feriados: FERIADOS,
  dia_das_retencoes: [{ valor: 20, vigencia_inicio: "2026-01-01" }],
  primeira_competencia: "2026-10",
};

test("lote: soma só as PPs com NF registrada e dá o vencimento de cada PJ", () => {
  const e = efeitoDoLote(
    LOTE,
    "2026-10-02",
    [
      { parcelaId: "parc-602", retencoes: [{ imposto: "PIS", valor: 52 }, { imposto: "COFINS", valor: 240 }, { imposto: "CSLL", valor: 80 }, { imposto: "IRRF", valor: 120 }] },
      { parcelaId: "parc-900", retencoes: [{ imposto: "ISS", valor: 50 }, { imposto: "IRRF", valor: 15 }] },
      // Sem NF registrada: não está no mapa e não entra na Apuração.
      { parcelaId: "parc-sem-nf", retencoes: [{ imposto: "IRRF", valor: 999 }] },
    ],
    [],
  );
  assert.equal(e.competencia, "2026-10");
  assert.equal(e.foraDaApuracao, false);
  assert.deepEqual(e.retencoes, {
    csrf: 372,
    irrf: 135,
    iss: 50,
    vencimentos: [
      { pj: "California", vencimento: { data: "2026-11-19", motivo: "20/11/2026 é feriado (Dia da Consciência Negra) · antecipa" } },
      { pj: "GoCrazy", vencimento: { data: "2026-11-19", motivo: "20/11/2026 é feriado (Dia da Consciência Negra) · antecipa" } },
    ],
  });
  assert.equal(e.caixa, null);
});

test("lote: recebimento de PJ no presumido pelo caixa avisa; lucro real e sem CNPJ emissor, não", () => {
  const e = efeitoDoLote(LOTE, "2026-11-16", [], ["tit-hitlab", "tit-california", "tit-sem-emissor"]);
  assert.equal(e.retencoes, null);
  assert.deepEqual(e.caixa, { pjs: ["Hitlab"], trimestre: "4º trimestre/2026" });
  assert.equal(efeitoDoLote(LOTE, "", [], ["tit-hitlab"]).caixa, null);
});

test("lote sem retenção nem presumido: nada a dizer", () => {
  const e = efeitoDoLote(LOTE, "2026-10-02", [{ parcelaId: "parc-602", retencoes: [] }], ["tit-california"]);
  assert.equal(e.retencoes, null);
  assert.equal(e.caixa, null);
});

// ---------------------------------------------------------------------------
// Vigência
// ---------------------------------------------------------------------------

test("vigência do parâmetro e do regime", () => {
  const linhas = [{ valor: 20, vigencia_inicio: "2026-01-01" }, { valor: 18, vigencia_inicio: "2026-11-01" }];
  assert.equal(valorVigente(linhas, "2026-10-31", 99), 20);
  assert.equal(valorVigente(linhas, "2026-11-30", 99), 18);
  assert.equal(valorVigente([], "2026-11-30", 99), 99);
  assert.deepEqual(regimeNaData(REGIMES, HITLAB.id, "2026-10-10"), { regime: "lucro_presumido", regime_caixa: true });
  assert.deepEqual(regimeNaData(REGIMES, "pj-sem-registro", "2026-10-10"), { regime: "lucro_real", regime_caixa: false });
});
