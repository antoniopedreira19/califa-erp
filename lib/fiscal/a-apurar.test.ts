/**
 * "<PJ> · a apurar no recebimento" (módulo fiscal, 03/10/2026): as linhas do
 * bloco da Apuração, o vencimento e o PIS/COFINS de cada título, o IRPJ/CSLL
 * por trimestre do recebimento e a não duplicidade com a "Apuração em curso"
 * e com o cronograma de impostos da abertura.
 * Rodar: node --import tsx --test lib/fiscal/a-apurar.test.ts
 *
 * Os fatos são os da Hitlab no protótipo aprovado (NF 1204 de R$ 1,6 mi em
 * duas parcelas, NF 1205 de R$ 40 mil): os números esperados do IRPJ/CSLL
 * batem com as guias que o motor dá quando tudo já foi recebido
 * (`apuracao.test.ts`, 06/01/2027: IRPJ R$ 128.320,00 e CSLL R$ 48.355,20).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FiscalCnae, FiscalEstabelecimento, FiscalFeriado, FiscalParametro, FiscalRegime, RegimeTributarioPJ } from "@/lib/types";
import type { CadastroFiscal } from "./cadastro";
import {
  blocosAApurar,
  irpjCsllAApurar,
  montarTitulosAApurar,
  notasAConsultar,
  pjsNoCaixa,
  type TituloAApurar,
} from "./a-apurar";
import { calcularApuracao, cotasDe, estadoDaGuia, type FatosFiscais, type JobDoFato, type NotaSaidaFiscal, type RecebimentoFiscal } from "./apuracao";
import { cronogramaQueSobra, saidasAApurar, saidasDaApuracao, saidasDoCronogramaDeImpostos } from "./fluxo-fiscal";

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

const T = "tenant-teste";
const EM = "2026-10-02T12:00:00Z";

const regime = (pj: string, r: RegimeTributarioPJ, caixa: boolean): FiscalRegime => ({
  id: `regime-${pj}`,
  tenant_id: T,
  empresa_contabil_id: pj,
  regime: r,
  regime_caixa: caixa,
  vigencia_inicio: "2026-01-01",
  vigencia_fim: null,
  observacao: null,
  created_at: EM,
  updated_at: EM,
});

const estab = (id: string, pj: string, nome: string, ordem: number): FiscalEstabelecimento => ({
  id,
  tenant_id: T,
  empresa_contabil_id: pj,
  nome,
  cnpj: "00000000000000",
  papel: "matriz",
  municipio: "Salvador",
  uf: "BA",
  iss_dia: 5,
  iss_retido_dia: 5,
  iss_regra: "prorroga",
  ativo: true,
  ordem,
  observacao: null,
  created_at: EM,
  updated_at: EM,
});

const cnae = (estabelecimento: string, codigo: string, iss: number, pis: number, cofins: number, inicio = "2026-01-01"): FiscalCnae => ({
  id: `${estabelecimento}:${codigo}:${inicio}`,
  tenant_id: T,
  estabelecimento_id: estabelecimento,
  codigo,
  subitem: null,
  descricao: codigo,
  aliquota_iss: iss,
  aliquota_pis: pis,
  aliquota_cofins: cofins,
  cumulativo: pis < 1,
  vigencia_inicio: inicio,
  vigencia_fim: null,
  ativo: true,
  created_at: EM,
  updated_at: EM,
});

const feriado = (data: string, nome: string, municipio: string | null = null): FiscalFeriado => ({
  id: `feriado-${data}-${municipio ?? "nacional"}`,
  tenant_id: T,
  data,
  nome,
  municipio,
  created_at: EM,
});

const parametro = (chave: string, valor: number, vigencia = "2026-01-01"): FiscalParametro => ({
  id: `parametro-${chave}-${vigencia}`,
  tenant_id: T,
  chave,
  valor,
  descricao: chave,
  vigencia_inicio: vigencia,
  created_at: EM,
  updated_at: EM,
});

const PARAMETROS = [
  parametro("irpj", 15),
  parametro("irpj_adicional", 10),
  parametro("irpj_adicional_limite_mes", 20000),
  parametro("csll", 9),
  parametro("presuncao_servicos", 32),
  parametro("presuncao_lc224", 35.2),
  parametro("lc224_limite_trimestre", 1250000),
  parametro("selic_estimada_mes", 1.1),
  parametro("pis_cofins_dia", 25),
  parametro("retencoes_dia", 20),
];

const CAD: CadastroFiscal = {
  regimes: [regime("california", "lucro_real", false), regime("hitlab", "lucro_presumido", true)],
  estabelecimentos: [estab("ca-ssa", "california", "California · Salvador", 1), estab("hit", "hitlab", "Hitlab · Salvador", 2)],
  cnaes: [
    cnae("ca-ssa", "73.19-0-99", 2, 1.65, 7.6),
    cnae("hit", "90.01-9-99", 5, 0.65, 3),
    cnae("hit", "59.20-1-00", 5, 0.65, 3),
  ],
  feriados: [
    feriado("2026-11-02", "Finados"),
    feriado("2026-11-15", "Proclamação da República"),
    feriado("2026-11-20", "Dia da Consciência Negra"),
    feriado("2026-12-25", "Natal"),
    feriado("2026-12-31", "Sem expediente bancário ao público"),
    feriado("2027-01-01", "Confraternização Universal"),
    feriado("2027-02-08", "Carnaval"),
    feriado("2027-02-09", "Carnaval"),
    feriado("2026-12-08", "Nossa Senhora da Conceição da Praia", "Salvador"),
  ],
  parametros: PARAMETROS,
  receitasAnteriores: [],
};

// ---------------------------------------------------------------------------
// Fatos
// ---------------------------------------------------------------------------

const job = (id: string, codigo: string, nome: string, empresa: string, regional: string): JobDoFato => ({
  job_id: id,
  codigo,
  nome,
  empresa_id: empresa,
  empresa_nome: empresa === "hitlab-g" ? "Hitlab" : "Agência California",
  regional_id: `${empresa}:${regional}`,
  regional_nome: regional,
});

const J1107 = job("j1107", "TES-1107/26", "Festival Hitlab", "hitlab-g", "Hitlab");
const J1108 = job("j1108", "TES-1108/26", "Licenciamento de trilha", "hitlab-g", "Hitlab");
const J1101 = job("j1101", "TES-1101/26", "Lançamento Verão", "agencia", "NE");

const nota = (id: string, numero: string, cnaeId: string, emissao: string, valor: number, jobs: Array<JobDoFato & { valor: number }>): NotaSaidaFiscal => ({
  id,
  numero,
  estabelecimento_id: cnaeId.split(":")[0],
  cnae_id: cnaeId,
  emissao,
  conhecida_em: emissao,
  valor,
  jobs,
});

const NF1204 = nota("nf2056", "1204", "hit:90.01-9-99:2026-01-01", "2026-10-27", 1600000, [{ ...J1107, valor: 1600000 }]);
const NF1205 = nota("nf2059", "1205", "hit:59.20-1-00:2026-01-01", "2026-11-17", 40000, [{ ...J1108, valor: 40000 }]);
const NF2051 = nota("nf2051", "2051", "ca-ssa:73.19-0-99:2026-01-01", "2026-10-06", 145000, [{ ...J1101, valor: 145000 }]);

const rec = (id: string, notaId: string, data: string, bruto: number): RecebimentoFiscal => ({ id, nota_id: notaId, data, bruto, retido: {} });
const RC3 = rec("rc3", "nf2056", "2026-11-16", 800000);
const RC7 = rec("rc7", "nf2059", "2026-11-30", 40000);

/** Os fatos que o sistema conhece em `hoje` (como o banco: nada do futuro). */
function fatosEm(hoje: string, extras: RecebimentoFiscal[] = []): FatosFiscais {
  return {
    notas: [NF1204, NF1205, NF2051].filter((n) => n.conhecida_em <= hoje),
    recebimentos: [RC3, RC7, ...extras].filter((r) => r.data <= hoje),
    notasFornecedor: [],
  };
}

const titulo = (id: string, notaId: string, numero: number, total: number, valor: number, previsao: string, recebido = 0): TituloAApurar => ({
  id,
  nota_id: notaId,
  numero_parcela: numero,
  total_parcelas: total,
  valor,
  previsao,
  recebido,
});

const soma = (xs: Array<{ valor: number }>) => Math.round(xs.reduce((s, x) => s + x.valor, 0) * 100) / 100;

// ---------------------------------------------------------------------------
// As PJs, as notas e os títulos
// ---------------------------------------------------------------------------

test("só a PJ do lucro presumido pelo caixa entra; presumido sem caixa e lucro real, não", () => {
  assert.deepEqual(pjsNoCaixa(CAD, "2026-10-03"), ["hitlab"]);
  const semCaixa: CadastroFiscal = { ...CAD, regimes: [regime("california", "lucro_real", false), regime("hitlab", "lucro_presumido", false)] };
  assert.deepEqual(pjsNoCaixa(semCaixa, "2026-10-03"), []);
});

test("notas a consultar: só as da PJ do caixa que os recebimentos ainda não quitaram", () => {
  // 04/12: a NF 1204 recebeu metade; a NF 1205 está quitada; a NF 2051 é da California.
  assert.deepEqual(notasAConsultar(CAD, fatosEm("2026-12-04"), "2026-12-04"), ["nf2056"]);
  // Sem PJ do caixa, nada a consultar.
  const semCaixa: CadastroFiscal = { ...CAD, regimes: [regime("hitlab", "lucro_presumido", false)] };
  assert.deepEqual(notasAConsultar(semCaixa, fatosEm("2026-12-04"), "2026-12-04"), []);
});

test("títulos do banco: parcelas sem as canceladas, a previsão (ou o vencimento) e o baixado (líquido + retidos)", () => {
  const titulos = montarTitulosAApurar(
    [
      { id: "a1", faturamento_id: "n1", numero_parcela: 1, valor: "500.00", data_vencimento: "2026-10-30", data_previsao_recebimento: null, status: "em_aberto" },
      { id: "a2", faturamento_id: "n1", numero_parcela: 2, valor: "500.00", data_vencimento: "2026-11-30", data_previsao_recebimento: "2026-12-07", status: "em_aberto" },
      { id: "a3", faturamento_id: "n1", numero_parcela: 3, valor: "500.00", data_vencimento: "2026-12-30", data_previsao_recebimento: "2026-12-30", status: "pago" },
      { id: "a4", faturamento_id: "n1", numero_parcela: 4, valor: "500.00", data_vencimento: "2027-01-30", data_previsao_recebimento: null, status: "cancelado" },
    ],
    [{ documento_id: "a1", baixado: "120.50" }],
  );
  assert.deepEqual(titulos, [
    { id: "a1", nota_id: "n1", numero_parcela: 1, total_parcelas: 3, valor: 500, previsao: "2026-10-30", recebido: 120.5 },
    { id: "a2", nota_id: "n1", numero_parcela: 2, total_parcelas: 3, valor: 500, previsao: "2026-12-07", recebido: 0 },
  ]);
});

// ---------------------------------------------------------------------------
// As linhas do bloco
// ---------------------------------------------------------------------------

test("linhas do bloco em 04/11/2026: as duas parcelas da NF 1204, PIS + COFINS pelo CNAE (0,65% + 3%), e a NF da California fora", () => {
  const hoje = "2026-11-04";
  const blocos = blocosAApurar(
    CAD,
    fatosEm(hoje),
    [
      titulo("t2", "nf2056", 2, 2, 800000, "2026-12-15"),
      titulo("t1", "nf2056", 1, 2, 800000, "2026-11-16"),
      titulo("tc", "nf2051", 1, 1, 145000, "2026-11-20"),
    ],
    hoje,
  );
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].pj, "hitlab");
  assert.equal(blocos[0].pj_nome, "Hitlab");
  const [p1, p2] = blocos[0].linhas;
  assert.equal(blocos[0].linhas.length, 2);
  // Pela previsão de recebimento.
  assert.equal(p1.rotulo, "NF 1204 · parcela 1/2 · TES-1107/26 Festival Hitlab");
  assert.equal(p2.rotulo, "NF 1204 · parcela 2/2 · TES-1107/26 Festival Hitlab");
  assert.deepEqual(
    [p1.previsao, p1.recebimento, p1.a_receber, p1.pis, p1.cofins, p1.pis_cofins, p1.vencimento, p1.trimestre, p1.rotulo_trimestre],
    ["2026-11-16", "2026-11-16", 800000, 5200, 24000, 29200, "2026-12-24", "2026-T4", "4º trimestre/2026"],
  );
  // 25/12 é Natal: antecipa para 24/12 (o mesmo vencimento da guia de PIS de novembro no motor).
  assert.equal(p1.vencimento_motivo, "25/12/2026 é feriado (Natal) · antecipa");
  assert.deepEqual([p2.pis_cofins, p2.vencimento, p2.vencimento_motivo], [29200, "2027-01-25", null]);
  assert.equal(p1.job_id, "j1107");
  assert.deepEqual(
    p1.rateio.map((r) => [r.empresa_id, r.regional_id, r.valor, r.pct]),
    [["hitlab-g", "hitlab-g:Hitlab", 29200, 100]],
  );
});

test("o que já foi recebido sai da linha; título quitado não tem linha; sem título em aberto, não há bloco", () => {
  const hoje = "2026-11-20";
  const parcial = rec("rc-parcial", "nf2059", "2026-11-19", 15000);
  const blocos = blocosAApurar(
    CAD,
    fatosEm(hoje, [parcial]),
    [titulo("t1", "nf2056", 1, 2, 800000, "2026-11-16", 800000), titulo("t5", "nf2059", 1, 1, 40000, "2026-11-30", 15000)],
    hoje,
  );
  assert.equal(blocos[0].linhas.length, 1);
  const l = blocos[0].linhas[0];
  // R$ 25.000 que faltam: PIS R$ 162,50 + COFINS R$ 750,00.
  assert.deepEqual([l.rotulo, l.a_receber, l.pis, l.cofins, l.pis_cofins], ["NF 1205 · parcela 1/1 · TES-1108/26 Licenciamento de trilha", 25000, 162.5, 750, 912.5]);
  assert.deepEqual(blocosAApurar(CAD, fatosEm(hoje), [titulo("t1", "nf2056", 1, 2, 800000, "2026-11-16", 800000)], hoje), []);
});

test("nota com vários jobs: os códigos no rótulo, sem job no item e o PIS + COFINS rateado pela parte de cada um", () => {
  const nf = nota("nf-dupla", "1300", "hit:90.01-9-99:2026-01-01", "2026-10-20", 10000, [
    { ...J1107, valor: 7500 },
    { ...job("j9", "TES-1109/26", "Podcast", "hitlab-g", "Podcast"), valor: 2500 },
  ]);
  const fatos: FatosFiscais = { notas: [nf], recebimentos: [], notasFornecedor: [] };
  const [l] = blocosAApurar(CAD, fatos, [titulo("td", "nf-dupla", 1, 1, 10000, "2026-11-10")], "2026-10-21")[0].linhas;
  assert.equal(l.rotulo, "NF 1300 · parcela 1/1 · TES-1107/26 e TES-1109/26");
  assert.equal(l.job_id, null);
  assert.equal(l.pis_cofins, 365);
  assert.deepEqual(
    l.rateio.map((r) => [r.regional_nome, r.valor]),
    [["Hitlab", 273.75], ["Podcast", 91.25]],
  );
});

// ---------------------------------------------------------------------------
// Vencimento e alíquotas pelo cadastro
// ---------------------------------------------------------------------------

test("vencimento: o dia vigente no fim do mês do recebimento, no mês seguinte, antecipando o feriado de Salvador", () => {
  // A partir de novembro, o PIS/COFINS passa a vencer no dia 8 (troca de parâmetro com vigência).
  const cad: CadastroFiscal = { ...CAD, parametros: [...PARAMETROS, parametro("pis_cofins_dia", 8, "2026-11-01")] };
  const [outubro, novembro] = blocosAApurar(
    cad,
    fatosEm("2026-10-28"),
    [titulo("t1", "nf2056", 1, 2, 800000, "2026-10-30"), titulo("t2", "nf2056", 2, 2, 800000, "2026-11-16")],
    "2026-10-28",
  )[0].linhas;
  // Recebido em outubro: o dia 25 (o de 31/10), 25/11/2026 é quarta.
  assert.deepEqual([outubro.vencimento, outubro.vencimento_motivo], ["2026-11-25", null]);
  // Recebido em novembro: o dia 8 → 08/12/2026, feriado em Salvador (município da matriz) → 07/12.
  assert.deepEqual(
    [novembro.vencimento, novembro.vencimento_motivo],
    ["2026-12-07", "08/12/2026 é feriado (Nossa Senhora da Conceição da Praia) · antecipa"],
  );
});

test("alíquota do CNAE vigente na emissão: a mudança depois da nota não vale para ela", () => {
  const cad: CadastroFiscal = { ...CAD, cnaes: [...CAD.cnaes, cnae("hit", "90.01-9-99", 5, 1.65, 7.6, "2026-11-01")] };
  const [l] = blocosAApurar(cad, fatosEm("2026-11-04"), [titulo("t1", "nf2056", 1, 2, 1000, "2026-11-16")], "2026-11-04")[0].linhas;
  // A NF 1204 saiu em 27/10: continua 0,65% + 3%.
  assert.deepEqual([l.pis, l.cofins], [6.5, 30]);
});

test("previsão vencida é lida em amanhã: o mês do PIS/COFINS e o trimestre do IRPJ/CSLL andam com ela", () => {
  // Em 31/12/2026 a parcela prevista para 15/12 ainda não entrou: o dinheiro só pode entrar em 01/01/2027.
  const hoje = "2026-12-31";
  const [l] = blocosAApurar(CAD, fatosEm(hoje), [titulo("t2", "nf2056", 2, 2, 800000, "2026-12-15")], hoje)[0].linhas;
  assert.deepEqual(
    [l.previsao, l.recebimento, l.vencimento, l.trimestre, l.rotulo_trimestre],
    ["2026-12-15", "2027-01-01", "2027-02-25", "2027-T1", "1º trimestre/2027"],
  );
});

// ---------------------------------------------------------------------------
// IRPJ e CSLL por trimestre do recebimento
// ---------------------------------------------------------------------------

test("IRPJ/CSLL em 04/11/2026: nada recebido no trimestre, a projeção é a guia inteira com R$ 1,6 mi (LC 224 acima de R$ 1,25 mi)", () => {
  const hoje = "2026-11-04";
  const fatos = fatosEm(hoje);
  const blocos = blocosAApurar(CAD, fatos, [titulo("t1", "nf2056", 1, 2, 800000, "2026-11-16"), titulo("t2", "nf2056", 2, 2, 800000, "2026-12-15")], hoje);
  const [t4] = irpjCsllAApurar(CAD, fatos, blocos, hoje);
  // Base: 1,25 mi × 32% + 0,35 mi × 35,2% = 523.200. IRPJ: 15% (78.480) + 10% sobre 463.200 (46.320). CSLL: 9%.
  assert.deepEqual([t4.trimestre, t4.irpj, t4.csll], ["2026-T4", 124800, 47088]);
  assert.deepEqual(t4.cotas, [
    { numero: 1, vencimento: "2027-01-29", valor: 57296 },
    { numero: 2, vencimento: "2027-02-26", valor: 57868.96 },
    { numero: 3, vencimento: "2027-03-31", valor: 58499.22 },
  ]);
  assert.deepEqual(t4.rateio.map((r) => [r.regional_id, r.valor]), [["hitlab-g:Hitlab", 171888]]);
});

test("IRPJ/CSLL em 04/12/2026: só a diferença para a guia em curso, e a soma das duas é a guia com tudo recebido", () => {
  const hoje = "2026-12-04";
  const fatos = fatosEm(hoje);
  const blocos = blocosAApurar(
    CAD,
    fatos,
    [titulo("t1", "nf2056", 1, 2, 800000, "2026-11-16", 800000), titulo("t2", "nf2056", 2, 2, 800000, "2026-12-15")],
    hoje,
  );
  const [t4] = irpjCsllAApurar(CAD, fatos, blocos, hoje);
  const emCurso = calcularApuracao(CAD, fatos, hoje, []);
  const irpjEmCurso = emCurso.find((g) => g.chave === "irpj|hitlab|2026-T4")!;
  const csllEmCurso = emCurso.find((g) => g.chave === "csll|hitlab|2026-T4")!;
  // A guia em curso (R$ 840 mil recebidos) é a do motor: R$ 61.200,00 e R$ 24.192,00.
  assert.deepEqual([irpjEmCurso.apurado, csllEmCurso.apurado], [61200, 24192]);
  assert.deepEqual([t4.irpj, t4.csll], [67120, 24163.2]);
  // Com tudo recebido (06/01/2027 no motor): R$ 128.320,00 e R$ 48.355,20 — cada real numa etapa só.
  const tudo = calcularApuracao(CAD, fatosEm("2027-01-06", [rec("rc9", "nf2056", "2026-12-15", 800000)]), "2027-01-06", []);
  assert.equal(tudo.find((g) => g.chave === "irpj|hitlab|2026-T4")!.apurado, Math.round((61200 + t4.irpj) * 100) / 100);
  assert.equal(tudo.find((g) => g.chave === "csll|hitlab|2026-T4")!.apurado, Math.round((24192 + t4.csll) * 100) / 100);
  // As cotas da diferença, pelo `cotasDe` do motor, IRPJ e CSLL somados cota a cota.
  const ir = cotasDe(67120, "2026-T4", "Salvador", CAD);
  const cs = cotasDe(24163.2, "2026-T4", "Salvador", CAD);
  assert.deepEqual(
    t4.cotas.map((c) => c.valor),
    ir.map((c, k) => Math.round((c.principal + c.juros + cs[k].principal + cs[k].juros) * 100) / 100),
  );
  assert.deepEqual(t4.cotas.map((c) => c.valor), [30427.73, 30732, 31066.72]);
});

test("IRPJ/CSLL de recebimento previsto para o trimestre seguinte entra na guia dele, com as cotas do trimestre depois", () => {
  const hoje = "2026-12-31";
  const fatos = fatosEm(hoje);
  const blocos = blocosAApurar(CAD, fatos, [titulo("t2", "nf2056", 2, 2, 800000, "2026-12-15")], hoje);
  const [t1] = irpjCsllAApurar(CAD, fatos, blocos, hoje);
  // R$ 800 mil em 2027-T1: base 256.000; IRPJ 38.400 + 19.600 de adicional; CSLL 23.040.
  assert.deepEqual([t1.trimestre, t1.rotulo_trimestre, t1.irpj, t1.csll], ["2027-T1", "1º trimestre/2027", 58000, 23040]);
  assert.deepEqual(
    t1.cotas.map((c) => c.vencimento),
    ["2027-04-30", "2027-05-31", "2027-06-30"],
  );
});

// ---------------------------------------------------------------------------
// No fluxo de caixa
// ---------------------------------------------------------------------------

test("no fluxo: PIS e COFINS por título com o job; IRPJ e CSLL por cota; os textos do protótipo", () => {
  const hoje = "2026-12-04";
  const fatos = fatosEm(hoje);
  const blocos = blocosAApurar(
    CAD,
    fatos,
    [titulo("t1", "nf2056", 1, 2, 800000, "2026-11-16", 800000), titulo("t2", "nf2056", 2, 2, 800000, "2026-12-15")],
    hoje,
  );
  const itens = saidasAApurar(blocos, irpjCsllAApurar(CAD, fatos, blocos, hoje), hoje);
  assert.deepEqual(
    itens.map((i) => [i.descricao, i.data_evento, i.valor, i.job_id, i.empresa_id, i.regional_id]),
    [
      ["Hitlab · a apurar no recebimento · PIS e COFINS da NF 1204/2", "2027-01-25", 29200, "j1107", "hitlab-g", "hitlab-g:Hitlab"],
      ["Hitlab · a apurar no recebimento · IRPJ e CSLL do 4º trimestre/2026 · cota 1/3", "2027-01-29", 30427.73, null, "hitlab-g", "hitlab-g:Hitlab"],
      ["Hitlab · a apurar no recebimento · IRPJ e CSLL do 4º trimestre/2026 · cota 2/3", "2027-02-26", 30732, null, "hitlab-g", "hitlab-g:Hitlab"],
      ["Hitlab · a apurar no recebimento · IRPJ e CSLL do 4º trimestre/2026 · cota 3/3", "2027-03-31", 31066.72, null, "hitlab-g", "hitlab-g:Hitlab"],
    ],
  );
  assert.ok(itens.every((i) => i.classe === "previsao" && i.origem_tipo === "a_apurar" && i.natureza === "saida" && i.conta_bancaria_id === null));
  assert.equal(new Set(itens.map((i) => i.origem_id)).size, itens.length);
});

test("no fluxo: cota única sem 'cota 1/1'; IRPJ/CSLL rateado na proporção do que falta receber de cada job", () => {
  const hoje = "2026-11-04";
  const nfA = nota("nf-a", "1400", "hit:90.01-9-99:2026-01-01", "2026-10-20", 9000, [{ ...J1107, valor: 9000 }]);
  const nfB = nota("nf-b", "1401", "hit:90.01-9-99:2026-01-01", "2026-10-21", 3000, [{ ...job("j9", "TES-1109/26", "Podcast", "hitlab-g", "Podcast"), valor: 3000 }]);
  const fatos: FatosFiscais = { notas: [nfA, nfB], recebimentos: [], notasFornecedor: [] };
  const blocos = blocosAApurar(CAD, fatos, [titulo("ta", "nf-a", 1, 1, 9000, "2026-11-10"), titulo("tb", "nf-b", 1, 1, 3000, "2026-11-12")], hoje);
  const [t4] = irpjCsllAApurar(CAD, fatos, blocos, hoje);
  // R$ 12 mil: base 3.840; IRPJ 576 e CSLL 345,60 — abaixo de R$ 2 mil, cota única.
  assert.deepEqual([t4.irpj, t4.csll, t4.cotas.length], [576, 345.6, 1]);
  const irpjCsll = saidasAApurar([], [t4], hoje);
  assert.deepEqual(
    irpjCsll.map((i) => [i.descricao, i.regional_id, i.valor]),
    [
      ["Hitlab · a apurar no recebimento · IRPJ e CSLL do 4º trimestre/2026", "hitlab-g:Hitlab", 691.2],
      ["Hitlab · a apurar no recebimento · IRPJ e CSLL do 4º trimestre/2026", "hitlab-g:Podcast", 230.4],
    ],
  );
});

test("não duplica com a Apuração em curso: o PIS e a COFINS do recebido estão na guia; os do que falta, só aqui", () => {
  const hoje = "2026-11-20";
  const fatos = fatosEm(hoje);
  const guias = calcularApuracao(CAD, fatos, hoje, []).map((g) => ({ ...g, ...estadoDaGuia(g, hoje, []) }));
  const blocos = blocosAApurar(
    CAD,
    fatos,
    [titulo("t1", "nf2056", 1, 2, 800000, "2026-11-16", 800000), titulo("t2", "nf2056", 2, 2, 800000, "2026-12-15")],
    hoje,
  );
  const emCurso = saidasDaApuracao(guias, hoje).filter((i) => /^(pis|cofins)\|hitlab\|2026-11$/.test(i.origem_id));
  const aApurar = saidasAApurar(blocos, [], hoje);
  // R$ 800 mil recebidos em novembro (guia em curso) + R$ 800 mil a receber (a apurar) = R$ 1,6 mi × 3,65%, uma vez.
  assert.equal(soma(emCurso), 29200);
  assert.equal(soma(aApurar), 29200);
  assert.equal(soma(emCurso) + soma(aApurar), 58400);
});

test("não duplica com o cronograma da abertura: a nota emitida já tirou a parte dela, e o que falta receber dela fica só aqui", () => {
  const hoje = "2026-11-04";
  // Job de R$ 2 mi com o cronograma da decisão 100 (19,53%); a NF 1204 faturou R$ 1,6 mi dele.
  const linhas = [
    { id: "c1", ordem: 1, data_prevista: "2026-11-25", valor: 195300 },
    { id: "c2", ordem: 2, data_prevista: "2026-12-24", valor: 195300 },
  ];
  const cronograma = saidasDoCronogramaDeImpostos(
    [{ id: "j1107", codigo: "TES-1107/26", empresa_id: "hitlab-g", regional_id: "hitlab-g:Hitlab", faturamento_previsto: 2000000, faturado: 1600000, linhas }],
    hoje,
  );
  // Sobra só o imposto dos R$ 400 mil ainda não faturados (20% do cronograma).
  assert.equal(soma(cronograma), 78120);
  assert.deepEqual(cronogramaQueSobra(linhas, 1600000, 2000000).map((l) => l.resta), [0, 78120]);
  // Os R$ 1,6 mi faturados aparecem uma vez: o que falta receber, aqui; o recebido, na guia.
  const blocos = blocosAApurar(CAD, fatosEm(hoje), [titulo("t1", "nf2056", 1, 2, 800000, "2026-11-16"), titulo("t2", "nf2056", 2, 2, 800000, "2026-12-15")], hoje);
  const aReceber = blocos.flatMap((b) => b.linhas).reduce((s, l) => s + l.a_receber, 0);
  const recebido = fatosEm(hoje).recebimentos.filter((r) => r.nota_id === "nf2056").reduce((s, r) => s + r.bruto, 0);
  assert.equal(aReceber + recebido, 1600000);
});
