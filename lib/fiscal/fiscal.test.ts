/**
 * Testes do módulo fiscal (entrega 1): os mesmos números do protótipo
 * aprovado em 02/10/2026. Rodar: node --import tsx --test lib/fiscal/fiscal.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ajustarVencimento, vencimentoNoMesSeguinte, type FeriadoDoVencimento } from "./datas";
import {
  impostosDaNota,
  retencoesPadrao,
  situacaoDoCredito,
  valoresRetidos,
  vencimentoDasRetencoes,
  codigoDoCnae,
  type CnaeDoCalculo,
  type EstabelecimentoDoCalculo,
} from "./calculos";

const FERIADOS: FeriadoDoVencimento[] = [
  { data: "2026-11-20", nome: "Dia da Consciência Negra", municipio: null },
  { data: "2026-12-25", nome: "Natal", municipio: null },
  { data: "2026-12-08", nome: "Nossa Senhora da Conceição da Praia", municipio: "Salvador" },
];

const SALVADOR: EstabelecimentoDoCalculo = {
  id: "ca-ssa",
  nome: "California · Salvador",
  municipio: "Salvador",
  iss_dia: 5,
  iss_retido_dia: 5,
  iss_regra: "prorroga",
  municipio_da_matriz: "Salvador",
  regime: "lucro_real",
  regime_caixa: false,
};

const PUBLICIDADE: CnaeDoCalculo = {
  id: "c1",
  codigo: "73.19-0-99",
  subitem: null,
  descricao: "Outras atividades de publicidade não especificadas anteriormente",
  aliquota_iss: 2,
  aliquota_pis: 1.65,
  aliquota_cofins: 7.6,
  cumulativo: false,
};

test("ISS prorroga do sábado para a segunda; PIS/COFINS antecipam do Natal", () => {
  const r = impostosDaNota(SALVADOR, PUBLICIDADE, 68000, "2026-11-11", FERIADOS);
  const iss = r.impostos.find((i) => i.imposto === "ISS")!;
  assert.equal(iss.valor, 1360);
  assert.equal(iss.vencimento.data, "2026-12-07"); // 05/12/2026 é sábado
  assert.match(iss.vencimento.motivo ?? "", /sábado · prorroga/);
  const pis = r.impostos.find((i) => i.imposto === "PIS")!;
  assert.equal(pis.valor, 1122);
  assert.equal(pis.vencimento.data, "2026-12-24"); // 25/12 é Natal
  assert.equal(r.nomeDaCompetencia, "novembro/2026");
  assert.equal(r.cumulativo, false);
});

test("feriado municipal só vale no município", () => {
  assert.equal(ajustarVencimento("2026-12-08", "prorroga", FERIADOS, "Salvador").data, "2026-12-09");
  assert.equal(ajustarVencimento("2026-12-08", "prorroga", FERIADOS, "São Paulo").data, "2026-12-08");
});

test("ISS de Santo André no dia 20 com a Consciência Negra prorroga para 23/11", () => {
  assert.equal(vencimentoNoMesSeguinte("2026-10", 20, "prorroga", FERIADOS, "Santo André").data, "2026-11-23");
});

test("12.08 é cumulativo e lucro presumido pelo caixa avisa o recebimento", () => {
  const cnae1208: CnaeDoCalculo = { ...PUBLICIDADE, codigo: "82.30-0-01", subitem: "12.08", aliquota_pis: 0.65, aliquota_cofins: 3, cumulativo: true };
  assert.equal(codigoDoCnae(cnae1208), "82.30-0-01 · 12.08");
  assert.equal(impostosDaNota(SALVADOR, cnae1208, 55000, "2026-11-11", FERIADOS).cumulativo, true);
  const hitlab = { ...SALVADOR, regime: "lucro_presumido" as const, regime_caixa: true };
  assert.equal(impostosDaNota(hitlab, PUBLICIDADE, 40000, "2026-11-17", FERIADOS).pelaCaixa, true);
});

test("retenções do regime normal na PP de R$ 18.000 e as guias", () => {
  const v = valoresRetidos(18000, retencoesPadrao("normal"));
  assert.equal(v.total, 1107);
  assert.equal(v.liquido, 16893);
  assert.equal(v.darf5952, 837);
  assert.equal(v.darf1708, 270);
  assert.deepEqual(retencoesPadrao("simples"), {});
  // pagamento em 20/11/2026 → guias no dia 20/12 (domingo) → antecipa para 18/12
  assert.equal(vencimentoDasRetencoes("2026-11-20", FERIADOS, "Salvador").data, "2026-12-18");
});

test("crédito de PIS/COFINS: a confirmar, retirado e presumido", () => {
  const base = { valor: 18000, emissao: "2026-11-03", regimeDoTomador: "lucro_real" as const, retirado: false, jobTemNotaDeSaida: false, jobFaturadoNoCumulativo: false };
  const a = situacaoDoCredito(base);
  assert.equal(a.estado, "confirmar");
  assert.equal(a.total, 1665);
  assert.equal(a.mes, "novembro/2026");
  assert.equal(situacaoDoCredito({ ...base, retirado: true, motivoRetirado: "reembolso de despesa do cliente" }).estado, "nao");
  assert.equal(situacaoDoCredito({ ...base, regimeDoTomador: "lucro_presumido" }).gera, false);
  assert.equal(situacaoDoCredito({ ...base, jobTemNotaDeSaida: true }).estado, "sim");
  assert.equal(situacaoDoCredito({ ...base, jobTemNotaDeSaida: true, jobFaturadoNoCumulativo: true }).estado, "nao");
});
