/**
 * Testes do motor de apuração (módulo fiscal, entrega 2). Rodar:
 * node --import tsx --test lib/fiscal/apuracao.test.ts
 *
 * 1. Equivalência com o protótipo aprovado em 02/10/2026. O cadastro e os
 *    fatos abaixo são os de `dados.ts` do protótipo (5 CNPJs, regimes,
 *    CNAEs usados, feriados, parâmetros, 11 notas, 9 recebimentos, 14 NFs de
 *    fornecedor). Os números esperados saíram do motor do protótipo, rodado
 *    nas três datas simuladas (04/11/2026, 04/12/2026 e 06/01/2027) com as
 *    aprovações que a simulação dele gera (`linhaDeBase`, em `simulacao.ts`).
 *    Nada aqui importa o protótipo: os números estão colados.
 * 2. Casos de borda do sistema real.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type {
  FiscalCnae,
  FiscalEstabelecimento,
  FiscalFeriado,
  FiscalParametro,
  FiscalRegime,
  ImpostoRetido,
  RegimeTributarioPJ,
} from "@/lib/types";
import type { CadastroFiscal } from "./cadastro";
import { addDias, r2, ultimoDiaDoMes } from "./datas";
import {
  calcularApuracao,
  cotasDe,
  escalarRateio,
  estadoDaGuia,
  issARecuperar,
  nomeGuia,
  situacaoDoCreditoDaNF,
  titulosDaAprovacao,
  type AprovacaoFiscal,
  type Cota,
  type EstadoGuia,
  type FatosFiscais,
  type Guia,
  type JobDoFato,
  type NotaFornecedorFiscal,
  type NotaSaidaFiscal,
  type RateioDaGuia,
  type RecebimentoFiscal,
  type TituloDaAprovacao,
  vencimentoDaComplementar,
} from "./apuracao";

// ---------------------------------------------------------------------------
// O cadastro do protótipo (dados.ts)
// ---------------------------------------------------------------------------

const T = "tenant-teste";
const EM = "2026-10-02T12:00:00Z";

const regime = (pj: string, r: RegimeTributarioPJ, caixa: boolean, inicio = "2026-01-01"): FiscalRegime => ({
  id: `regime-${pj}-${inicio}`,
  tenant_id: T,
  empresa_contabil_id: pj,
  regime: r,
  regime_caixa: caixa,
  vigencia_inicio: inicio,
  vigencia_fim: null,
  observacao: null,
  created_at: EM,
  updated_at: EM,
});

const estab = (
  id: string,
  pj: string,
  nome: string,
  papel: "matriz" | "filial",
  cnpj: string,
  municipio: string,
  uf: string,
  dia: number,
  ordem: number,
  observacao: string | null = null,
): FiscalEstabelecimento => ({
  id,
  tenant_id: T,
  empresa_contabil_id: pj,
  nome,
  cnpj,
  papel,
  municipio,
  uf,
  iss_dia: dia,
  iss_retido_dia: dia,
  iss_regra: "prorroga",
  ativo: true,
  ordem,
  observacao,
  created_at: EM,
  updated_at: EM,
});

const OBS_SANTO_ANDRE =
  "Dia 20 informado pela planilha; o regulamento da LC municipal 6/2025 não foi localizado (pendência com a contabilidade).";

const ESTABELECIMENTOS = [
  estab("ca-ssa", "california", "California · Salvador", "matriz", "19437976000154", "Salvador", "BA", 5, 1),
  estab("ca-sp", "california", "California · São Paulo", "filial", "19437976000235", "São Paulo", "SP", 10, 2),
  estab("ca-for", "california", "California · Fortaleza", "filial", "19437976000316", "Fortaleza", "CE", 10, 3),
  estab("gc", "gocrazy", "GoCrazy · Santo André", "matriz", "29943648000183", "Santo André", "SP", 20, 4, OBS_SANTO_ANDRE),
  estab("hit", "hitlab", "Hitlab · Salvador", "matriz", "04409741000181", "Salvador", "BA", 5, 5),
];

const DESCRICAO: Record<string, string> = {
  "59.11-1-99": "Atividades de produção cinematográfica, de vídeos e de programas de televisão não especificadas anteriormente",
  "59.20-1-00": "Atividades de gravação de som e de edição de música",
  "73.19-0-04": "Consultoria em publicidade",
  "73.19-0-99": "Outras atividades de publicidade não especificadas anteriormente",
  "82.30-0-01": "Serviços de organização de feiras, congressos, exposições e festas",
  "90.01-9-99": "Artes cênicas, espetáculos e atividades complementares não especificadas anteriormente",
};

const cnae = (
  estabelecimento: string,
  codigo: string,
  subitem: string | null,
  iss: number | null,
  pis = 1.65,
  cofins = 7.6,
  cumulativo = false,
): FiscalCnae => ({
  id: `${estabelecimento}:${codigo}${subitem ? `-${subitem}` : ""}`,
  tenant_id: T,
  estabelecimento_id: estabelecimento,
  codigo,
  subitem,
  descricao: DESCRICAO[codigo] ?? codigo,
  aliquota_iss: iss,
  aliquota_pis: pis,
  aliquota_cofins: cofins,
  cumulativo,
  vigencia_inicio: "2026-01-01",
  vigencia_fim: null,
  ativo: true,
  created_at: EM,
  updated_at: EM,
});

/** Os CNAEs que as notas do protótipo usam, com as alíquotas da planilha. */
const CNAES = [
  cnae("ca-ssa", "73.19-0-99", null, 2),
  cnae("ca-ssa", "73.19-0-04", null, 2),
  cnae("ca-ssa", "59.20-1-00", null, 2),
  cnae("ca-ssa", "82.30-0-01", "12.08", 2, 0.65, 3, true),
  cnae("ca-ssa", "82.30-0-01", "17.10", 2),
  cnae("ca-sp", "73.19-0-99", null, 5),
  cnae("ca-for", "82.30-0-01", "17.10", 5),
  cnae("gc", "59.11-1-99", null, 2),
  cnae("hit", "90.01-9-99", null, 5, 0.65, 3, true),
  cnae("hit", "59.20-1-00", null, 5, 0.65, 3, true),
];

const feriado = (data: string, nome: string, municipio: string | null = null): FiscalFeriado => ({
  id: `feriado-${data}-${municipio ?? "nacional"}`,
  tenant_id: T,
  data,
  nome,
  municipio,
  created_at: EM,
});

const FERIADOS = [
  ...(
    [
      ["2026-01-01", "Confraternização Universal"],
      ["2026-02-16", "Carnaval"],
      ["2026-02-17", "Carnaval"],
      ["2026-04-03", "Sexta-feira Santa"],
      ["2026-04-21", "Tiradentes"],
      ["2026-05-01", "Dia do Trabalho"],
      ["2026-06-04", "Corpus Christi"],
      ["2026-09-07", "Independência"],
      ["2026-10-12", "Nossa Senhora Aparecida"],
      ["2026-11-02", "Finados"],
      ["2026-11-15", "Proclamação da República"],
      ["2026-11-20", "Dia da Consciência Negra"],
      ["2026-12-25", "Natal"],
      ["2026-12-31", "Sem expediente bancário ao público"],
      ["2027-01-01", "Confraternização Universal"],
      ["2027-02-08", "Carnaval"],
      ["2027-02-09", "Carnaval"],
      ["2027-03-26", "Sexta-feira Santa"],
      ["2027-04-21", "Tiradentes"],
      ["2027-05-01", "Dia do Trabalho"],
      ["2027-05-27", "Corpus Christi"],
    ] as const
  ).map(([d, n]) => feriado(d, n)),
  feriado("2026-06-24", "São João", "Salvador"),
  feriado("2026-07-02", "Independência da Bahia", "Salvador"),
  feriado("2026-12-08", "Nossa Senhora da Conceição da Praia", "Salvador"),
  feriado("2026-01-25", "Aniversário de São Paulo", "São Paulo"),
  feriado("2026-07-09", "Revolução Constitucionalista", "São Paulo"),
  feriado("2026-03-19", "São José", "Fortaleza"),
  feriado("2026-03-25", "Data Magna do Ceará", "Fortaleza"),
  feriado("2026-08-15", "Nossa Senhora da Assunção", "Fortaleza"),
  feriado("2026-04-08", "Aniversário da cidade (a confirmar)", "Santo André"),
  feriado("2026-07-09", "Revolução Constitucionalista", "Santo André"),
];

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

/** O `PARAMETROS` do protótipo, nas chaves de `fiscal_parametros`. */
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
  parametro("credito_pis", 1.65),
  parametro("credito_cofins", 7.6),
  parametro("csrf_pis", 0.65),
  parametro("csrf_cofins", 3),
  parametro("csrf_csll", 1),
  parametro("irrf_servicos", 1.5),
];

const CAD: CadastroFiscal = {
  regimes: [regime("california", "lucro_real", false), regime("gocrazy", "lucro_real", false), regime("hitlab", "lucro_presumido", true)],
  estabelecimentos: ESTABELECIMENTOS,
  cnaes: CNAES,
  feriados: FERIADOS,
  parametros: PARAMETROS,
};

// ---------------------------------------------------------------------------
// Os fatos do protótipo (dados.ts)
// ---------------------------------------------------------------------------

const EMPRESAS = { agencia: "Agência California", cch: "CCH", hitlab: "Hitlab" } as const;

const job = (id: string, codigo: string, nome: string, empresa: keyof typeof EMPRESAS, regional: string): JobDoFato => ({
  job_id: id,
  codigo,
  nome,
  empresa_id: empresa,
  empresa_nome: EMPRESAS[empresa],
  regional_id: `${empresa}:${regional}`,
  regional_nome: regional,
});

const J = {
  j1101: job("j1101", "TES-1101/26", "Lançamento Verão", "agencia", "NE"),
  j1102: job("j1102", "TES-1102/26", "Convenção de Vendas", "agencia", "NE"),
  j1103: job("j1103", "TES-1103/26", "Ativação Shopping", "agencia", "SP"),
  j1104: job("j1104", "TES-1104/26", "Feira Nordeste", "agencia", "NE"),
  j1105: job("j1105", "TES-1105/26", "Campanha Digital Q4", "cch", "Agency"),
  j1106: job("j1106", "TES-1106/26", "Filme Institucional", "agencia", "SS"),
  j1107: job("j1107", "TES-1107/26", "Festival Hitlab", "hitlab", "Hitlab"),
  j1108: job("j1108", "TES-1108/26", "Licenciamento de trilha", "hitlab", "Hitlab"),
  j1109: job("j1109", "TES-1109/26", "Gravação de Podcast", "agencia", "RJ"),
  j1110: job("j1110", "TES-1110/26", "Evento de Fim de Ano", "agencia", "NE"),
  j1111: job("j1111", "TES-1111/26", "Ação Promocional", "cch", "Doca"),
  j1112: job("j1112", "TES-1112/26", "Lançamento de Produto", "agencia", "NE"),
};
type IdDoJob = keyof typeof J;

const nota = (
  id: string,
  numero: string,
  estabelecimento: string,
  cnaeChave: string,
  emissao: string,
  valor: number,
  jobId: IdDoJob,
  conhecidaEm = emissao,
): NotaSaidaFiscal => ({
  id,
  numero,
  estabelecimento_id: estabelecimento,
  cnae_id: `${estabelecimento}:${cnaeChave}`,
  emissao,
  conhecida_em: conhecidaEm,
  valor,
  jobs: [{ ...J[jobId], valor }],
});

const NOTAS = [
  nota("nf2051", "2051", "ca-ssa", "73.19-0-99", "2026-10-06", 145000, "j1101"),
  nota("nf2052", "512", "ca-sp", "73.19-0-99", "2026-10-09", 62000, "j1103"),
  nota("nf2053", "318", "ca-for", "82.30-0-01-17.10", "2026-10-14", 48000, "j1104"),
  nota("nf2054", "2054", "ca-ssa", "73.19-0-04", "2026-10-20", 30000, "j1105"),
  nota("nf2055", "877", "gc", "59.11-1-99", "2026-10-22", 80000, "j1106"),
  nota("nf2056", "1204", "hit", "90.01-9-99", "2026-10-27", 1600000, "j1107"),
  nota("nf2057", "2057", "ca-ssa", "82.30-0-01-12.08", "2026-11-11", 55000, "j1102"),
  nota("nf2059", "1205", "hit", "59.20-1-00", "2026-11-17", 40000, "j1108"),
  // A nota retroativa: data de outubro, registrada só em 03/12.
  nota("nf2058", "2058", "ca-ssa", "73.19-0-99", "2026-10-30", 12000, "j1111", "2026-12-03"),
  nota("nf2060", "2060", "ca-ssa", "59.20-1-00", "2026-12-04", 25000, "j1109"),
  nota("nf2061", "2061", "ca-ssa", "82.30-0-01-17.10", "2026-12-11", 120000, "j1110"),
];

const recebimento = (
  id: string,
  notaId: string,
  data: string,
  bruto: number,
  retido: Partial<Record<ImpostoRetido, number>> = {},
): RecebimentoFiscal => ({ id, nota_id: notaId, data, bruto, retido });

const RECEBIMENTOS = [
  recebimento("rc1", "nf2052", "2026-10-28", 62000, { ISS: 3100 }),
  recebimento("rc2", "nf2053", "2026-11-10", 48000, { PIS: 312, COFINS: 1440, CSLL: 480, IRRF: 720 }),
  recebimento("rc3", "nf2056", "2026-11-16", 800000),
  recebimento("rc4", "nf2054", "2026-11-18", 30000, { ISS: 600, IRRF: 450 }),
  recebimento("rc5", "nf2051", "2026-11-20", 145000, { IRRF: 2175 }),
  recebimento("rc6", "nf2055", "2026-11-23", 80000, { IRRF: 1200 }),
  recebimento("rc7", "nf2059", "2026-11-30", 40000),
  recebimento("rc8", "nf2057", "2026-12-14", 55000, { IRRF: 825 }),
  recebimento("rc9", "nf2056", "2026-12-15", 800000),
];

const FORNECEDOR = {
  f1: "Produtora Alfa Ltda.",
  f2: "Cenografia Gama Ltda.",
  f3: "Som & Luz Eventos ME",
  f4: "Estúdio Beta Ltda.",
  f5: "Fulano Fotografia MEI",
  f6: "Consultoria Ômega Ltda.",
} as const;

/** A retenção do regime normal (no protótipo, "CSRF 4,65% + IRRF 1,5%"). */
const RETENCAO_NORMAL: Partial<Record<ImpostoRetido, number>> = { PIS: 0.65, COFINS: 3, CSLL: 1, IRRF: 1.5 };

const retidoPor = (valor: number, aliquotas: Partial<Record<ImpostoRetido, number>>) => {
  const out: Partial<Record<ImpostoRetido, number>> = {};
  for (const [imposto, aliquota] of Object.entries(aliquotas) as Array<[ImpostoRetido, number]>) out[imposto] = r2((valor * aliquota) / 100);
  return out;
};

const nfo = (
  id: string,
  pp: string,
  numero: string,
  fornecedor: keyof typeof FORNECEDOR,
  jobId: IdDoJob,
  tomador: string,
  emissao: string,
  valor: number,
  pagoEm: string,
  aliquotas: Partial<Record<ImpostoRetido, number>> = {},
): NotaFornecedorFiscal => ({
  id,
  pp,
  numero,
  fornecedor_nome: FORNECEDOR[fornecedor],
  job: J[jobId],
  tomador_estabelecimento_id: tomador,
  emissao,
  valor,
  aliquotas_aprovacao: aliquotas,
  sem_credito: false,
  motivo_sem_credito: null,
  // A baixa retém o que a aprovação decidiu (sem ajuste na baixa).
  pagamentos: [{ id: `pg-${id}`, data: pagoEm, bruto: valor, retido: retidoPor(valor, aliquotas) }],
});

const NOTAS_FORNECEDOR = [
  nfo("nfo1", "PP-00121", "4410", "f1", "j1101", "ca-ssa", "2026-10-05", 50000, "2026-10-20"),
  nfo("nfo2", "PP-00122", "1187", "f2", "j1102", "ca-ssa", "2026-10-08", 25000, "2026-10-20"),
  nfo("nfo3", "PP-00123", "902", "f3", "j1103", "ca-sp", "2026-10-07", 31000, "2026-11-09"),
  nfo("nfo4", "PP-00124", "1190", "f2", "j1104", "ca-for", "2026-10-12", 22000, "2026-11-09"),
  nfo("nfo5", "PP-00125", "77", "f5", "j1105", "ca-ssa", "2026-10-16", 9000, "2026-10-20"),
  nfo("nfo6", "PP-00126", "3021", "f4", "j1106", "gc", "2026-10-15", 41000, "2026-11-09"),
  nfo("nfo7", "PP-00127", "558", "f6", "j1101", "ca-ssa", "2026-10-19", 12000, "2026-11-09", RETENCAO_NORMAL),
  nfo("nfo8", "PP-00131", "4455", "f1", "j1101", "ca-ssa", "2026-11-04", 14000, "2026-11-20"),
  nfo("nfo9", "PP-00132", "931", "f3", "j1102", "ca-ssa", "2026-11-05", 15000, "2026-11-20"),
  nfo("nfo10", "PP-00133", "1202", "f2", "j1110", "ca-ssa", "2026-11-18", 30000, "2026-12-08", { ISS: 5 }),
  nfo("nfo11", "PP-00134", "3044", "f4", "j1109", "ca-ssa", "2026-11-25", 8000, "2026-12-08"),
  nfo("nfo12", "PP-00135", "590", "f6", "j1110", "ca-ssa", "2026-12-02", 12000, "2026-12-18", RETENCAO_NORMAL),
  nfo("nfo13", "PP-00136", "4490", "f1", "j1110", "ca-ssa", "2026-12-07", 40000, "2026-12-18"),
  nfo("nfo14", "PP-00137", "3060", "f4", "j1112", "ca-ssa", "2026-11-27", 20000, "2026-12-08"),
];

/** Todos os fatos, sem filtro de data: o motor filtra por `asOf`. */
const FATOS: FatosFiscais = { notas: NOTAS, recebimentos: RECEBIMENTOS, notasFornecedor: NOTAS_FORNECEDOR };

// ---------------------------------------------------------------------------
// Utilidades dos testes
// ---------------------------------------------------------------------------

type DataSimulada = "2026-11-04" | "2026-12-04" | "2027-01-06";
const DATAS: DataSimulada[] = ["2026-11-04", "2026-12-04", "2027-01-06"];

type LinhaDoRateio = [string, string | null, number, number];
const resumoDoRateio = (r: RateioDaGuia[]): LinhaDoRateio[] => r.map((x) => [x.empresa_nome, x.regional_nome, x.valor, x.pct]);
const resumoDasCotas = (c: Cota[]) => c.map((x): [number, string, number, number, number] => [x.numero, x.vencimento, x.principal, x.jurosPct, x.juros]);
const semNbsp = (s: string) => s.replace(/ /g, " ");

function guiaDe(guias: Guia[], chave: string) {
  const g = guias.find((x) => x.chave === chave);
  assert.ok(g, `a guia ${chave} não saiu`);
  return g;
}

const fimDoPeriodoDaGuia = (g: Guia) => {
  if (g.periodo === "mensal") return ultimoDiaDoMes(g.competencia);
  const [ano, tri] = g.competencia.split("-T").map(Number);
  return ultimoDiaDoMes(`${ano}-${String(tri * 3).padStart(2, "0")}`);
};

/** A NF 2058 entrou em 03/12; a simulação do protótipo aprova a diferença 2 dias depois. */
const DATA_DA_DIFERENCA = "2026-12-05";

/**
 * A linha de base do protótipo (`linhaDeBase`, em simulacao.ts), refeita
 * com este motor: cada guia fechada é aprovada pelo calculado 2 dias antes do
 * vencimento (nunca antes do fim do período), e a diferença da nota
 * retroativa é aprovada em 05/12. As aprovações dependem do cálculo em cada
 * data intermediária, então conferi-las confere o motor nessas datas também.
 */
function simular(hoje: DataSimulada) {
  const aprovacoes: AprovacaoFiscal[] = [];
  const titulos: Array<TituloDaAprovacao & { chave: string }> = [];
  const candidatos = calcularApuracao(CAD, FATOS, hoje, [])
    .filter((g) => fimDoPeriodoDaGuia(g) < hoje)
    .map((g) => {
      const vencimento = g.periodo === "trimestral" ? g.cotas?.[0]?.vencimento ?? g.vencimento : g.vencimento;
      return { chave: g.chave, data: [addDias(fimDoPeriodoDaGuia(g), 1), addDias(vencimento, -2)].sort()[1] };
    })
    .sort((a, b) => a.data.localeCompare(b.data) || a.chave.localeCompare(b.chave));
  for (const c of candidatos) {
    if (c.data >= hoje) continue;
    const g = calcularApuracao(CAD, FATOS, c.data, aprovacoes).find((x) => x.chave === c.chave);
    if (!g) continue;
    const a: AprovacaoFiscal = {
      chave: g.chave,
      data: c.data,
      valor_calculado: g.apurado,
      valor_guia: g.apurado,
      diferenca: false,
      compensacoes_usadas: g.compensacoes?.map((x) => x.id) ?? [],
      cotas: g.cotas ?? null,
    };
    aprovacoes.push(a);
    titulos.push(...titulosDaAprovacao(g, a).map((t) => ({ ...t, chave: g.chave })));
  }
  if (DATA_DA_DIFERENCA < hoje) {
    for (const g of calcularApuracao(CAD, FATOS, DATA_DA_DIFERENCA, aprovacoes)) {
      const s = estadoDaGuia(g, DATA_DA_DIFERENCA, aprovacoes);
      if (s.estado !== "diferenca") continue;
      const a: AprovacaoFiscal = {
        chave: g.chave,
        data: DATA_DA_DIFERENCA,
        valor_calculado: g.apurado,
        valor_guia: s.delta,
        diferenca: true,
        compensacoes_usadas: [],
        cotas: null,
      };
      aprovacoes.push(a);
      titulos.push(...titulosDaAprovacao(g, a).map((t) => ({ ...t, chave: g.chave })));
    }
  }
  return { aprovacoes, titulos };
}

const aprovacoesEm = (hoje: DataSimulada) =>
  APROVACOES_DO_PROTOTIPO.filter((a) => (a.diferenca ? DATA_DA_DIFERENCA < hoje : a.data < hoje));

// ---------------------------------------------------------------------------
// O que o motor do protótipo deu (rodado em 02/10/2026)
// ---------------------------------------------------------------------------

interface GuiaEsperada {
  chave: string;
  apurado: number;
  vencimento: string;
  saldo: number;
  itens: number;
  estado: EstadoGuia;
  delta: number;
  rateio: LinhaDoRateio[];
  cotas?: Array<[number, string, number, number, number]>;
  compensacoes?: string[];
}

interface TituloEsperado {
  chave: string;
  origem: "apuracao" | "diferenca";
  vencimento: string;
  principal: number;
  juros: number;
  valor: number;
  rateio: LinhaDoRateio[];
}

/**
 * Diferença do protótipo (decisão 144, 04/10/2026): no lucro real, o 12.08
 * sai em guia própria (`pis_cum|…` e `cofins_cum|…`, DARF 8109 e 2172), e o
 * crédito não o abate mais. Mudaram, só por isso, as guias de PIS/COFINS da
 * California de novembro (o débito da NF 2057 saiu; o saldo credor sobe
 * R$ 357,50 e R$ 1.650,00) e de dezembro (o saldo que chega é maior), e
 * entraram as duas guias cumulativas de novembro, as aprovações e os
 * títulos delas.
 */
const ESPERADO: Record<DataSimulada, GuiaEsperada[]> = {
  "2026-11-04": [
    { chave: "iss|ca-ssa|2026-10", apurado: 3500, vencimento: "2026-11-05", saldo: 0, itens: 2, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 2900, 82.86], ["CCH", "Agency", 600, 17.14]] },
    { chave: "iss|ca-sp|2026-10", apurado: 0, vencimento: "2026-11-10", saldo: 0, itens: 2, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "SP", 0, 100]] },
    { chave: "iss|ca-for|2026-10", apurado: 2400, vencimento: "2026-11-10", saldo: 0, itens: 1, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 2400, 100]] },
    { chave: "iss|gc|2026-10", apurado: 1600, vencimento: "2026-11-23", saldo: 0, itens: 1, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "SS", 1600, 100]] },
    { chave: "iss|hit|2026-10", apurado: 80000, vencimento: "2026-11-05", saldo: 0, itens: 1, estado: "aprovada", delta: 0, rateio: [["Hitlab", "Hitlab", 80000, 100]] },
    { chave: "pis|california|2026-10", apurado: 2244, vencimento: "2026-11-25", saldo: 0, itens: 10, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 1519.62, 67.72], ["Agência California", "SP", 488.17, 21.75], ["CCH", "Agency", 236.21, 10.53]] },
    { chave: "cofins|california|2026-10", apurado: 10336, vencimento: "2026-11-25", saldo: 0, itens: 10, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 6999.47, 67.72], ["Agência California", "SP", 2248.53, 21.75], ["CCH", "Agency", 1088, 10.53]] },
    { chave: "pis|gocrazy|2026-10", apurado: 643.5, vencimento: "2026-11-25", saldo: 0, itens: 2, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "SS", 643.5, 100]] },
    { chave: "cofins|gocrazy|2026-10", apurado: 2964, vencimento: "2026-11-25", saldo: 0, itens: 2, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "SS", 2964, 100]] },
    { chave: "pis|california|2026-11", apurado: 0, vencimento: "2026-12-24", saldo: 231, itens: 1, estado: "em_curso", delta: 0, rateio: [] },
    { chave: "cofins|california|2026-11", apurado: 0, vencimento: "2026-12-24", saldo: 1064, itens: 1, estado: "em_curso", delta: 0, rateio: [] },
    { chave: "irpj|california|2026-T4", apurado: 19428.75, vencimento: "2027-01-29", saldo: 0, itens: 8, estado: "em_curso", delta: 0, rateio: [["Agência California", "NE", 13157.01, 67.72], ["Agência California", "SP", 4226.61, 21.75], ["CCH", "Agency", 2045.13, 10.53]], cotas: [[1, "2027-01-29", 6476.25, 0, 0], [2, "2027-02-26", 6476.25, 1, 64.76], [3, "2027-03-31", 6476.25, 2.1, 136]] },
    { chave: "csll|california|2026-T4", apurado: 9154.35, vencimento: "2027-01-29", saldo: 0, itens: 7, estado: "em_curso", delta: 0, rateio: [["Agência California", "NE", 6199.26, 67.72], ["Agência California", "SP", 1991.47, 21.75], ["CCH", "Agency", 963.62, 10.53]], cotas: [[1, "2027-01-29", 3051.45, 0, 0], [2, "2027-02-26", 3051.45, 1, 30.51], [3, "2027-03-31", 3051.45, 2.1, 64.08]] },
    { chave: "irpj|gocrazy|2026-T4", apurado: 5068.88, vencimento: "2027-01-29", saldo: 0, itens: 8, estado: "em_curso", delta: 0, rateio: [["Agência California", "SS", 5068.88, 100]], cotas: [[1, "2027-01-29", 1689.63, 0, 0], [2, "2027-02-26", 1689.63, 1, 16.9], [3, "2027-03-31", 1689.62, 2.1, 35.48]] },
    { chave: "csll|gocrazy|2026-T4", apurado: 3041.33, vencimento: "2027-01-29", saldo: 0, itens: 7, estado: "em_curso", delta: 0, rateio: [["Agência California", "SS", 3041.33, 100]], cotas: [[1, "2027-01-29", 1013.78, 0, 0], [2, "2027-02-26", 1013.78, 1, 10.14], [3, "2027-03-31", 1013.77, 2.1, 21.29]] },
  ],
  "2026-12-04": [
    { chave: "iss|ca-ssa|2026-10", apurado: 3740, vencimento: "2026-11-05", saldo: 0, itens: 3, estado: "diferenca", delta: 240, rateio: [["Agência California", "NE", 2900, 77.54], ["CCH", "Agency", 600, 16.04], ["CCH", "Doca", 240, 6.42]] },
    { chave: "iss|ca-sp|2026-10", apurado: 0, vencimento: "2026-11-10", saldo: 0, itens: 2, estado: "aprovada", delta: 0, rateio: [["Agência California", "SP", 0, 100]] },
    { chave: "iss|ca-for|2026-10", apurado: 2400, vencimento: "2026-11-10", saldo: 0, itens: 1, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 2400, 100]] },
    { chave: "iss|gc|2026-10", apurado: 1600, vencimento: "2026-11-23", saldo: 0, itens: 1, estado: "aprovada", delta: 0, rateio: [["Agência California", "SS", 1600, 100]] },
    { chave: "iss|hit|2026-10", apurado: 80000, vencimento: "2026-11-05", saldo: 0, itens: 1, estado: "aprovada", delta: 0, rateio: [["Hitlab", "Hitlab", 80000, 100]] },
    { chave: "pis|california|2026-10", apurado: 2442, vencimento: "2026-11-25", saldo: 0, itens: 11, estado: "diferenca", delta: 198, rateio: [["Agência California", "NE", 1586.89, 64.98], ["Agência California", "SP", 509.78, 20.88], ["CCH", "Agency", 246.67, 10.1], ["CCH", "Doca", 98.66, 4.04]] },
    { chave: "cofins|california|2026-10", apurado: 11248, vencimento: "2026-11-25", saldo: 0, itens: 11, estado: "diferenca", delta: 912, rateio: [["Agência California", "NE", 7309.31, 64.98], ["Agência California", "SP", 2348.07, 20.88], ["CCH", "Agency", 1136.16, 10.1], ["CCH", "Doca", 454.46, 4.04]] },
    { chave: "pis|gocrazy|2026-10", apurado: 643.5, vencimento: "2026-11-25", saldo: 0, itens: 2, estado: "aprovada", delta: 0, rateio: [["Agência California", "SS", 643.5, 100]] },
    { chave: "cofins|gocrazy|2026-10", apurado: 2964, vencimento: "2026-11-25", saldo: 0, itens: 2, estado: "aprovada", delta: 0, rateio: [["Agência California", "SS", 2964, 100]] },
    { chave: "iss|ca-ssa|2026-11", apurado: 500, vencimento: "2026-12-07", saldo: 0, itens: 2, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 500, 100]], compensacoes: ["rec-rc4"] },
    { chave: "iss|hit|2026-11", apurado: 2000, vencimento: "2026-12-07", saldo: 0, itens: 1, estado: "a_aprovar", delta: 0, rateio: [["Hitlab", "Hitlab", 2000, 100]] },
    { chave: "pis|california|2026-11", apurado: 0, vencimento: "2026-12-24", saldo: 1087.5, itens: 7, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 0, 100]] },
    { chave: "pis_cum|california|2026-11", apurado: 357.5, vencimento: "2026-12-24", saldo: 0, itens: 1, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 357.5, 100]] },
    { chave: "cofins|california|2026-11", apurado: 0, vencimento: "2026-12-24", saldo: 5012, itens: 7, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 0, 100]] },
    { chave: "cofins_cum|california|2026-11", apurado: 1650, vencimento: "2026-12-24", saldo: 0, itens: 1, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 1650, 100]] },
    { chave: "csrf|california|2026-11", apurado: 558, vencimento: "2026-12-18", saldo: 0, itens: 1, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 558, 100]] },
    { chave: "irrf|california|2026-11", apurado: 180, vencimento: "2026-12-18", saldo: 0, itens: 1, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 180, 100]] },
    { chave: "issret|ca-ssa|2026-11", apurado: 1500, vencimento: "2026-12-07", saldo: 0, itens: 1, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 1500, 100]] },
    { chave: "pis|hitlab|2026-11", apurado: 5460, vencimento: "2026-12-24", saldo: 0, itens: 2, estado: "a_aprovar", delta: 0, rateio: [["Hitlab", "Hitlab", 5460, 100]] },
    { chave: "cofins|hitlab|2026-11", apurado: 25200, vencimento: "2026-12-24", saldo: 0, itens: 2, estado: "a_aprovar", delta: 0, rateio: [["Hitlab", "Hitlab", 25200, 100]] },
    { chave: "iss|ca-ssa|2026-12", apurado: 0, vencimento: "2027-01-05", saldo: 0, itens: 2, estado: "em_curso", delta: 0, rateio: [["Agência California", "RJ", 0, 100]], compensacoes: ["rec-rc4"] },
    { chave: "pis|california|2026-12", apurado: 0, vencimento: "2027-01-25", saldo: 873, itens: 3, estado: "em_curso", delta: 0, rateio: [["Agência California", "RJ", 0, 100]] },
    { chave: "cofins|california|2026-12", apurado: 0, vencimento: "2027-01-25", saldo: 4024, itens: 3, estado: "em_curso", delta: 0, rateio: [["Agência California", "RJ", 0, 100]] },
    { chave: "irpj|california|2026-T4", apurado: 17056.88, vencimento: "2027-01-29", saldo: 0, itens: 11, estado: "em_curso", delta: 0, rateio: [["Agência California", "NE", 11220.44, 65.78], ["Agência California", "SP", 2805.11, 16.45], ["CCH", "Agency", 1357.31, 7.96], ["Agência California", "RJ", 1131.09, 6.63], ["CCH", "Doca", 542.93, 3.18]], cotas: [[1, "2027-01-29", 5685.63, 0, 0], [2, "2027-02-26", 5685.63, 1, 56.86], [3, "2027-03-31", 5685.62, 2.1, 119.4]] },
    { chave: "csll|california|2026-T4", apurado: 9024.67, vencimento: "2027-01-29", saldo: 0, itens: 8, estado: "em_curso", delta: 0, rateio: [["Agência California", "NE", 5936.65, 65.78], ["Agência California", "SP", 1484.16, 16.45], ["CCH", "Agency", 718.14, 7.96], ["Agência California", "RJ", 598.45, 6.63], ["CCH", "Doca", 287.27, 3.18]], cotas: [[1, "2027-01-29", 3008.22, 0, 0], [2, "2027-02-26", 3008.22, 1, 30.08], [3, "2027-03-31", 3008.23, 2.1, 63.17]] },
    { chave: "irpj|gocrazy|2026-T4", apurado: 3868.88, vencimento: "2027-01-29", saldo: 0, itens: 9, estado: "em_curso", delta: 0, rateio: [["Agência California", "SS", 3868.88, 100]], cotas: [[1, "2027-01-29", 1289.63, 0, 0], [2, "2027-02-26", 1289.63, 1, 12.9], [3, "2027-03-31", 1289.62, 2.1, 27.08]] },
    { chave: "csll|gocrazy|2026-T4", apurado: 3041.33, vencimento: "2027-01-29", saldo: 0, itens: 7, estado: "em_curso", delta: 0, rateio: [["Agência California", "SS", 3041.33, 100]], cotas: [[1, "2027-01-29", 1013.78, 0, 0], [2, "2027-02-26", 1013.78, 1, 10.14], [3, "2027-03-31", 1013.77, 2.1, 21.29]] },
    { chave: "irpj|hitlab|2026-T4", apurado: 61200, vencimento: "2027-01-29", saldo: 0, itens: 5, estado: "em_curso", delta: 0, rateio: [["Hitlab", "Hitlab", 61200, 100]], cotas: [[1, "2027-01-29", 20400, 0, 0], [2, "2027-02-26", 20400, 1, 204], [3, "2027-03-31", 20400, 2.1, 428.4]] },
    { chave: "csll|hitlab|2026-T4", apurado: 24192, vencimento: "2027-01-29", saldo: 0, itens: 4, estado: "em_curso", delta: 0, rateio: [["Hitlab", "Hitlab", 24192, 100]], cotas: [[1, "2027-01-29", 8064, 0, 0], [2, "2027-02-26", 8064, 1, 80.64], [3, "2027-03-31", 8064, 2.1, 169.34]] },
  ],
  "2027-01-06": [
    { chave: "iss|ca-ssa|2026-10", apurado: 3740, vencimento: "2026-11-05", saldo: 0, itens: 3, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 2900, 77.54], ["CCH", "Agency", 600, 16.04], ["CCH", "Doca", 240, 6.42]] },
    { chave: "iss|ca-sp|2026-10", apurado: 0, vencimento: "2026-11-10", saldo: 0, itens: 2, estado: "aprovada", delta: 0, rateio: [["Agência California", "SP", 0, 100]] },
    { chave: "iss|ca-for|2026-10", apurado: 2400, vencimento: "2026-11-10", saldo: 0, itens: 1, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 2400, 100]] },
    { chave: "iss|gc|2026-10", apurado: 1600, vencimento: "2026-11-23", saldo: 0, itens: 1, estado: "aprovada", delta: 0, rateio: [["Agência California", "SS", 1600, 100]] },
    { chave: "iss|hit|2026-10", apurado: 80000, vencimento: "2026-11-05", saldo: 0, itens: 1, estado: "aprovada", delta: 0, rateio: [["Hitlab", "Hitlab", 80000, 100]] },
    { chave: "pis|california|2026-10", apurado: 2442, vencimento: "2026-11-25", saldo: 0, itens: 11, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 1586.89, 64.98], ["Agência California", "SP", 509.78, 20.88], ["CCH", "Agency", 246.67, 10.1], ["CCH", "Doca", 98.66, 4.04]] },
    { chave: "cofins|california|2026-10", apurado: 11248, vencimento: "2026-11-25", saldo: 0, itens: 11, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 7309.31, 64.98], ["Agência California", "SP", 2348.07, 20.88], ["CCH", "Agency", 1136.16, 10.1], ["CCH", "Doca", 454.46, 4.04]] },
    { chave: "pis|gocrazy|2026-10", apurado: 643.5, vencimento: "2026-11-25", saldo: 0, itens: 2, estado: "aprovada", delta: 0, rateio: [["Agência California", "SS", 643.5, 100]] },
    { chave: "cofins|gocrazy|2026-10", apurado: 2964, vencimento: "2026-11-25", saldo: 0, itens: 2, estado: "aprovada", delta: 0, rateio: [["Agência California", "SS", 2964, 100]] },
    { chave: "iss|ca-ssa|2026-11", apurado: 500, vencimento: "2026-12-07", saldo: 0, itens: 2, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 500, 100]], compensacoes: ["rec-rc4"] },
    { chave: "iss|hit|2026-11", apurado: 2000, vencimento: "2026-12-07", saldo: 0, itens: 1, estado: "aprovada", delta: 0, rateio: [["Hitlab", "Hitlab", 2000, 100]] },
    { chave: "pis|california|2026-11", apurado: 0, vencimento: "2026-12-24", saldo: 1087.5, itens: 7, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 0, 100]] },
    { chave: "pis_cum|california|2026-11", apurado: 357.5, vencimento: "2026-12-24", saldo: 0, itens: 1, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 357.5, 100]] },
    { chave: "cofins|california|2026-11", apurado: 0, vencimento: "2026-12-24", saldo: 5012, itens: 7, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 0, 100]] },
    { chave: "cofins_cum|california|2026-11", apurado: 1650, vencimento: "2026-12-24", saldo: 0, itens: 1, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 1650, 100]] },
    { chave: "csrf|california|2026-11", apurado: 558, vencimento: "2026-12-18", saldo: 0, itens: 1, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 558, 100]] },
    { chave: "irrf|california|2026-11", apurado: 180, vencimento: "2026-12-18", saldo: 0, itens: 1, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 180, 100]] },
    { chave: "issret|ca-ssa|2026-11", apurado: 1500, vencimento: "2026-12-07", saldo: 0, itens: 1, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 1500, 100]] },
    { chave: "pis|hitlab|2026-11", apurado: 5460, vencimento: "2026-12-24", saldo: 0, itens: 2, estado: "aprovada", delta: 0, rateio: [["Hitlab", "Hitlab", 5460, 100]] },
    { chave: "cofins|hitlab|2026-11", apurado: 25200, vencimento: "2026-12-24", saldo: 0, itens: 2, estado: "aprovada", delta: 0, rateio: [["Hitlab", "Hitlab", 25200, 100]] },
    { chave: "iss|ca-ssa|2026-12", apurado: 2900, vencimento: "2027-01-05", saldo: 0, itens: 2, estado: "aprovada", delta: 0, rateio: [["Agência California", "NE", 2400, 82.76], ["Agência California", "RJ", 500, 17.24]] },
    { chave: "pis|california|2026-12", apurado: 447, vencimento: "2027-01-25", saldo: 0, itens: 5, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 369.93, 82.76], ["Agência California", "RJ", 77.07, 17.24]] },
    { chave: "cofins|california|2026-12", apurado: 2056, vencimento: "2027-01-25", saldo: 0, itens: 5, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 1701.52, 82.76], ["Agência California", "RJ", 354.48, 17.24]] },
    { chave: "csrf|california|2026-12", apurado: 558, vencimento: "2027-01-20", saldo: 0, itens: 1, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 558, 100]] },
    { chave: "irrf|california|2026-12", apurado: 180, vencimento: "2027-01-20", saldo: 0, itens: 1, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 180, 100]] },
    { chave: "pis|hitlab|2026-12", apurado: 5200, vencimento: "2027-01-25", saldo: 0, itens: 1, estado: "a_aprovar", delta: 0, rateio: [["Hitlab", "Hitlab", 5200, 100]] },
    { chave: "cofins|hitlab|2026-12", apurado: 24000, vencimento: "2027-01-25", saldo: 0, itens: 1, estado: "a_aprovar", delta: 0, rateio: [["Hitlab", "Hitlab", 24000, 100]] },
    { chave: "irpj|california|2026-T4", apurado: 33781.88, vencimento: "2027-01-29", saldo: 0, itens: 12, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 25013.54, 74.04], ["Agência California", "SP", 4214.24, 12.47], ["CCH", "Agency", 2039.15, 6.04], ["Agência California", "RJ", 1699.29, 5.03], ["CCH", "Doca", 815.66, 2.41]], cotas: [[1, "2027-01-29", 11260.63, 0, 0], [2, "2027-02-26", 11260.63, 1, 112.61], [3, "2027-03-31", 11260.62, 2.1, 236.47]] },
    { chave: "csll|california|2026-T4", apurado: 15342.68, vencimento: "2027-01-29", saldo: 0, itens: 8, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "NE", 11360.37, 74.04], ["Agência California", "SP", 1913.98, 12.47], ["CCH", "Agency", 926.12, 6.04], ["Agência California", "RJ", 771.76, 5.03], ["CCH", "Doca", 370.45, 2.41]], cotas: [[1, "2027-01-29", 5114.23, 0, 0], [2, "2027-02-26", 5114.23, 1, 51.14], [3, "2027-03-31", 5114.22, 2.1, 107.4]] },
    { chave: "irpj|gocrazy|2026-T4", apurado: 3868.88, vencimento: "2027-01-29", saldo: 0, itens: 9, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "SS", 3868.88, 100]], cotas: [[1, "2027-01-29", 1289.63, 0, 0], [2, "2027-02-26", 1289.63, 1, 12.9], [3, "2027-03-31", 1289.62, 2.1, 27.08]] },
    { chave: "csll|gocrazy|2026-T4", apurado: 3041.33, vencimento: "2027-01-29", saldo: 0, itens: 7, estado: "a_aprovar", delta: 0, rateio: [["Agência California", "SS", 3041.33, 100]], cotas: [[1, "2027-01-29", 1013.78, 0, 0], [2, "2027-02-26", 1013.78, 1, 10.14], [3, "2027-03-31", 1013.77, 2.1, 21.29]] },
    { chave: "irpj|hitlab|2026-T4", apurado: 128320, vencimento: "2027-01-29", saldo: 0, itens: 6, estado: "a_aprovar", delta: 0, rateio: [["Hitlab", "Hitlab", 128320, 100]], cotas: [[1, "2027-01-29", 42773.33, 0, 0], [2, "2027-02-26", 42773.33, 1, 427.73], [3, "2027-03-31", 42773.34, 2.1, 898.24]] },
    { chave: "csll|hitlab|2026-T4", apurado: 48355.2, vencimento: "2027-01-29", saldo: 0, itens: 5, estado: "a_aprovar", delta: 0, rateio: [["Hitlab", "Hitlab", 48355.2, 100]], cotas: [[1, "2027-01-29", 16118.4, 0, 0], [2, "2027-02-26", 16118.4, 1, 161.18], [3, "2027-03-31", 16118.4, 2.1, 338.49]] },
  ],
};

/**
 * As aprovações da simulação do protótipo em 06/01/2027 (as das outras datas
 * são o começo desta lista). A última é um efeito da simulação dele: a
 * diferença de 05/12 é calculada já com a aprovação de 03/01 da mesma guia.
 */
const APROVACOES_DO_PROTOTIPO: AprovacaoFiscal[] = [
  { chave: "iss|ca-ssa|2026-10", data: "2026-11-03", valor_calculado: 3500, valor_guia: 3500, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "iss|hit|2026-10", data: "2026-11-03", valor_calculado: 80000, valor_guia: 80000, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "iss|ca-for|2026-10", data: "2026-11-08", valor_calculado: 2400, valor_guia: 2400, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "iss|ca-sp|2026-10", data: "2026-11-08", valor_calculado: 0, valor_guia: 0, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "iss|gc|2026-10", data: "2026-11-21", valor_calculado: 1600, valor_guia: 1600, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "cofins|california|2026-10", data: "2026-11-23", valor_calculado: 10336, valor_guia: 10336, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "cofins|gocrazy|2026-10", data: "2026-11-23", valor_calculado: 2964, valor_guia: 2964, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "pis|california|2026-10", data: "2026-11-23", valor_calculado: 2244, valor_guia: 2244, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "pis|gocrazy|2026-10", data: "2026-11-23", valor_calculado: 643.5, valor_guia: 643.5, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "iss|ca-ssa|2026-11", data: "2026-12-05", valor_calculado: 500, valor_guia: 500, diferenca: false, compensacoes_usadas: ["rec-rc4"], cotas: null },
  { chave: "iss|hit|2026-11", data: "2026-12-05", valor_calculado: 2000, valor_guia: 2000, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "issret|ca-ssa|2026-11", data: "2026-12-05", valor_calculado: 1500, valor_guia: 1500, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "csrf|california|2026-11", data: "2026-12-16", valor_calculado: 558, valor_guia: 558, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "irrf|california|2026-11", data: "2026-12-16", valor_calculado: 180, valor_guia: 180, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "cofins_cum|california|2026-11", data: "2026-12-22", valor_calculado: 1650, valor_guia: 1650, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "cofins|california|2026-11", data: "2026-12-22", valor_calculado: 0, valor_guia: 0, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "cofins|hitlab|2026-11", data: "2026-12-22", valor_calculado: 25200, valor_guia: 25200, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "pis_cum|california|2026-11", data: "2026-12-22", valor_calculado: 357.5, valor_guia: 357.5, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "pis|california|2026-11", data: "2026-12-22", valor_calculado: 0, valor_guia: 0, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "pis|hitlab|2026-11", data: "2026-12-22", valor_calculado: 5460, valor_guia: 5460, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "iss|ca-ssa|2026-12", data: "2027-01-03", valor_calculado: 2900, valor_guia: 2900, diferenca: false, compensacoes_usadas: [], cotas: null },
  { chave: "iss|ca-ssa|2026-10", data: "2026-12-05", valor_calculado: 3740, valor_guia: 240, diferenca: true, compensacoes_usadas: [], cotas: null },
  { chave: "pis|california|2026-10", data: "2026-12-05", valor_calculado: 2442, valor_guia: 198, diferenca: true, compensacoes_usadas: [], cotas: null },
  { chave: "cofins|california|2026-10", data: "2026-12-05", valor_calculado: 11248, valor_guia: 912, diferenca: true, compensacoes_usadas: [], cotas: null },
  { chave: "iss|ca-ssa|2026-12", data: "2026-12-05", valor_calculado: 500, valor_guia: -2400, diferenca: true, compensacoes_usadas: [], cotas: null },
];

/** As complementares vencem na data legal da guia original (decisão 145; no protótipo, 5 dias depois da aprovação). */
const TITULOS_DO_PROTOTIPO: TituloEsperado[] = [
  { chave: "iss|ca-ssa|2026-10", origem: "apuracao", vencimento: "2026-11-05", principal: 3500, juros: 0, valor: 3500, rateio: [["Agência California", "NE", 2900, 82.86], ["CCH", "Agency", 600, 17.14]] },
  { chave: "iss|hit|2026-10", origem: "apuracao", vencimento: "2026-11-05", principal: 80000, juros: 0, valor: 80000, rateio: [["Hitlab", "Hitlab", 80000, 100]] },
  { chave: "iss|ca-for|2026-10", origem: "apuracao", vencimento: "2026-11-10", principal: 2400, juros: 0, valor: 2400, rateio: [["Agência California", "NE", 2400, 100]] },
  { chave: "iss|gc|2026-10", origem: "apuracao", vencimento: "2026-11-23", principal: 1600, juros: 0, valor: 1600, rateio: [["Agência California", "SS", 1600, 100]] },
  { chave: "cofins|california|2026-10", origem: "apuracao", vencimento: "2026-11-25", principal: 10336, juros: 0, valor: 10336, rateio: [["Agência California", "NE", 6999.47, 67.72], ["Agência California", "SP", 2248.53, 21.75], ["CCH", "Agency", 1088, 10.53]] },
  { chave: "cofins|gocrazy|2026-10", origem: "apuracao", vencimento: "2026-11-25", principal: 2964, juros: 0, valor: 2964, rateio: [["Agência California", "SS", 2964, 100]] },
  { chave: "pis|california|2026-10", origem: "apuracao", vencimento: "2026-11-25", principal: 2244, juros: 0, valor: 2244, rateio: [["Agência California", "NE", 1519.62, 67.72], ["Agência California", "SP", 488.17, 21.75], ["CCH", "Agency", 236.21, 10.53]] },
  { chave: "pis|gocrazy|2026-10", origem: "apuracao", vencimento: "2026-11-25", principal: 643.5, juros: 0, valor: 643.5, rateio: [["Agência California", "SS", 643.5, 100]] },
  { chave: "iss|ca-ssa|2026-11", origem: "apuracao", vencimento: "2026-12-07", principal: 500, juros: 0, valor: 500, rateio: [["Agência California", "NE", 500, 100]] },
  { chave: "iss|hit|2026-11", origem: "apuracao", vencimento: "2026-12-07", principal: 2000, juros: 0, valor: 2000, rateio: [["Hitlab", "Hitlab", 2000, 100]] },
  { chave: "issret|ca-ssa|2026-11", origem: "apuracao", vencimento: "2026-12-07", principal: 1500, juros: 0, valor: 1500, rateio: [["Agência California", "NE", 1500, 100]] },
  { chave: "csrf|california|2026-11", origem: "apuracao", vencimento: "2026-12-18", principal: 558, juros: 0, valor: 558, rateio: [["Agência California", "NE", 558, 100]] },
  { chave: "irrf|california|2026-11", origem: "apuracao", vencimento: "2026-12-18", principal: 180, juros: 0, valor: 180, rateio: [["Agência California", "NE", 180, 100]] },
  { chave: "cofins_cum|california|2026-11", origem: "apuracao", vencimento: "2026-12-24", principal: 1650, juros: 0, valor: 1650, rateio: [["Agência California", "NE", 1650, 100]] },
  { chave: "cofins|hitlab|2026-11", origem: "apuracao", vencimento: "2026-12-24", principal: 25200, juros: 0, valor: 25200, rateio: [["Hitlab", "Hitlab", 25200, 100]] },
  { chave: "pis_cum|california|2026-11", origem: "apuracao", vencimento: "2026-12-24", principal: 357.5, juros: 0, valor: 357.5, rateio: [["Agência California", "NE", 357.5, 100]] },
  { chave: "pis|hitlab|2026-11", origem: "apuracao", vencimento: "2026-12-24", principal: 5460, juros: 0, valor: 5460, rateio: [["Hitlab", "Hitlab", 5460, 100]] },
  { chave: "iss|ca-ssa|2026-12", origem: "apuracao", vencimento: "2027-01-05", principal: 2900, juros: 0, valor: 2900, rateio: [["Agência California", "NE", 2400, 82.76], ["Agência California", "RJ", 500, 17.24]] },
  { chave: "iss|ca-ssa|2026-10", origem: "diferenca", vencimento: "2026-11-05", principal: 240, juros: 0, valor: 240, rateio: [["Agência California", "NE", 186.1, 77.54], ["CCH", "Agency", 38.5, 16.04], ["CCH", "Doca", 15.4, 6.42]] },
  { chave: "pis|california|2026-10", origem: "diferenca", vencimento: "2026-11-25", principal: 198, juros: 0, valor: 198, rateio: [["Agência California", "NE", 128.67, 64.98], ["Agência California", "SP", 41.33, 20.88], ["CCH", "Agency", 20, 10.1], ["CCH", "Doca", 8, 4.04]] },
  { chave: "cofins|california|2026-10", origem: "diferenca", vencimento: "2026-11-25", principal: 912, juros: 0, valor: 912, rateio: [["Agência California", "NE", 592.65, 64.98], ["Agência California", "SP", 190.38, 20.88], ["CCH", "Agency", 92.12, 10.1], ["CCH", "Doca", 36.85, 4.04]] },
];

// ---------------------------------------------------------------------------
// 1. Equivalência com o protótipo
// ---------------------------------------------------------------------------

describe("equivalência com o protótipo aprovado em 02/10/2026", () => {
  for (const hoje of DATAS) {
    test(`${hoje}: cada guia com o apurado, vencimento, saldo credor, memória, rateio, cotas e estado do protótipo`, () => {
      const aprovacoes = aprovacoesEm(hoje);
      const guias = calcularApuracao(CAD, FATOS, hoje, aprovacoes);
      assert.deepEqual(
        guias.map((g) => g.chave),
        ESPERADO[hoje].map((e) => e.chave),
      );
      for (const esperada of ESPERADO[hoje]) {
        const g = guiaDe(guias, esperada.chave);
        const s = estadoDaGuia(g, hoje, aprovacoes);
        assert.deepEqual(
          {
            chave: g.chave,
            apurado: g.apurado,
            vencimento: g.vencimento,
            saldo: g.saldo_credor_gerado,
            itens: g.memoria.length,
            estado: s.estado,
            delta: s.delta,
            rateio: resumoDoRateio(g.rateio),
            ...(g.cotas ? { cotas: resumoDasCotas(g.cotas) } : {}),
            ...(g.compensacoes ? { compensacoes: g.compensacoes.map((c) => c.id) } : {}),
          },
          esperada,
        );
      }
    });

    test(`${hoje}: a simulação refeita com este motor gera as mesmas aprovações do protótipo`, () => {
      assert.deepEqual(simular(hoje).aprovacoes, aprovacoesEm(hoje));
    });
  }

  test("os títulos das aprovações (vencimento, principal, juros, valor e rateio) batem com os do protótipo", () => {
    const { titulos } = simular("2027-01-06");
    assert.deepEqual(
      titulos.map((t) => ({
        chave: t.chave,
        origem: t.origem,
        vencimento: t.vencimento,
        principal: t.principal,
        juros: t.juros,
        valor: t.valor,
        rateio: resumoDoRateio(t.rateio),
      })),
      TITULOS_DO_PROTOTIPO,
    );
  });

  test("ISS a recuperar: a NF 2054 retida em 18/11, depois da guia de outubro aprovada, é compensada em novembro", () => {
    assert.deepEqual(issARecuperar(CAD, FATOS, aprovacoesEm("2026-11-04"), "2026-11-04"), []);
    assert.deepEqual(issARecuperar(CAD, FATOS, aprovacoesEm("2026-12-04"), "2026-12-04"), [
      {
        id: "rec-rc4",
        estabelecimento_id: "ca-ssa",
        nota_id: "nf2054",
        recebimento_id: "rc4",
        data: "2026-11-18",
        valor: 600,
        competencia_nota: "2026-10",
        forma: "compensar",
      },
    ]);
    // Compensada na guia de novembro aprovada em 05/12: sai da lista.
    assert.deepEqual(issARecuperar(CAD, FATOS, aprovacoesEm("2027-01-06"), "2027-01-06"), []);
  });

  test("os textos da memória são os do protótipo", () => {
    const guias = calcularApuracao(CAD, FATOS, "2026-12-04", aprovacoesEm("2026-12-04"));
    const item = (chave: string, i: number) => {
      const m = guiaDe(guias, chave).memoria[i];
      return [m.grupo, semNbsp(m.rotulo), semNbsp(m.detalhe ?? "")];
    };
    assert.deepEqual(item("iss|ca-ssa|2026-10", 2), ["debito", "NF 2058 · TES-1111/26 Ação Promocional", "73.19-0-99 · registrada em 03/12/2026"]);
    assert.deepEqual(item("iss|ca-sp|2026-10", 1), ["retido", "ISS retido pelo cliente · NF 512", "recebida em 28/10/2026 · quem recolhe é o cliente"]);
    assert.deepEqual(item("iss|ca-ssa|2026-11", 1), [
      "compensacao",
      "ISS a compensar · NF 2054",
      "o cliente reteve em 18/11/2026, depois de paga a guia de outubro/2026",
    ]);
    // O 12.08 vai na guia própria (decisão 144); a não cumulativa fica com créditos e estorno.
    assert.deepEqual(item("pis_cum|california|2026-11", 0), [
      "debito",
      "NF 2057 · TES-1102/26 Convenção de Vendas",
      "California · Salvador · 82.30-0-01 · 12.08 · regime cumulativo, sem crédito",
    ]);
    assert.deepEqual(item("pis|california|2026-11", 1), ["info", "PP-00132 · NF 931 · TES-1102/26", "Job faturado no 82.30-0-01 · 12.08 (NF 2057): custo sem crédito."]);
    assert.deepEqual(item("pis|california|2026-11", 2), [
      "credito",
      "PP-00133 · NF 1202 · TES-1110/26 Evento de Fim de Ano",
      "crédito sobre custo · emitida em 18/11/2026 · job ainda sem nota (a confirmar)",
    ]);
    assert.deepEqual(item("pis|california|2026-11", 5), [
      "estorno",
      "Estorno do crédito · PP-00122 · NF 1187",
      "TES-1102/26 faturado no 12.08 (NF 2057); o crédito entrou em outubro/2026",
    ]);
    assert.deepEqual(item("pis|california|2026-11", 6), ["retido", "PIS retido pelo cliente · NF 318", "recebida em 10/11/2026 · antecipação do imposto"]);
    // COFINS é feminino: "retida" (no protótipo, "retido").
    assert.deepEqual(item("cofins|california|2026-11", 6), ["retido", "COFINS retida pelo cliente · NF 318", "recebida em 10/11/2026 · antecipação do imposto"]);
    assert.deepEqual(item("pis|california|2026-12", 2), ["saldo", "Saldo credor de novembro/2026", "crédito que passou do mês anterior"]);
    assert.deepEqual(item("csrf|california|2026-11", 0), [
      "debito",
      "PP-00127 · NF 558 · Consultoria Ômega Ltda.",
      "pago em 09/11/2026 · TES-1101/26 Lançamento Verão · PIS 0,65% + COFINS 3% + CSLL 1%",
    ]);
    assert.equal(guiaDe(guias, "csrf|california|2026-11").memoria[0].aliquota, 4.65);
    assert.deepEqual(item("issret|ca-ssa|2026-11", 0), ["debito", "PP-00133 · NF 1202 · Cenografia Gama Ltda.", "NF emitida em 18/11/2026 · TES-1110/26 Evento de Fim de Ano"]);
    assert.deepEqual(item("pis|hitlab|2026-11", 0), ["debito", "Recebimento da NF 1204 · TES-1107/26 Festival Hitlab", "recebido em 16/11/2026 · regime de caixa"]);
    assert.deepEqual(item("irpj|california|2026-T4", 1), [
      "base",
      "(−) ISS, PIS e COFINS das notas",
      "ISS R$ 10.840,00 · PIS R$ 5.670,50 · COFINS R$ 26.122,00",
    ]);
    assert.deepEqual(item("irpj|california|2026-T4", 7), ["debito", "Adicional de 10%", "só sobre o que passa de R$ 60.000,00 no trimestre (R$ 20 mil por mês)"]);
    // Plural certo (no protótipo, "1 notas emitidas").
    assert.deepEqual(item("irpj|gocrazy|2026-T4", 0), ["base", "Faturamento do trimestre", "1 nota emitida"]);
    assert.deepEqual(item("irpj|gocrazy|2026-T4", 3), ["base", "(−) Custo dos jobs", "1 NF de fornecedor emitida no trimestre"]);
    assert.deepEqual(
      guiaDe(guias, "pis|california|2026-11").avisos.map(semNbsp),
      ["Crédito maior que o débito: R$ 1.087,50 passam para dezembro/2026."],
    );

    const emJaneiro = calcularApuracao(CAD, FATOS, "2027-01-06", aprovacoesEm("2027-01-06"));
    const hitlab = guiaDe(emJaneiro, "irpj|hitlab|2026-T4");
    assert.deepEqual(
      hitlab.memoria.slice(0, 4).map((m) => [semNbsp(m.rotulo), semNbsp(m.detalhe ?? ""), m.base ?? null, m.aliquota ?? null, m.valor]),
      [
        ["Recebido no trimestre (regime de caixa)", "3 recebimentos, pelo bruto", null, null, 1640000],
        ["Presunção de 32% até R$ 1.250.000,00", "", 1250000, 32, 400000],
        [
          "Presunção de 35,2% acima de R$ 1.250.000,00 (LC 224/2025)",
          "acréscimo de 10% na presunção sobre a receita acima de R$ 5 milhões por ano, controlada por trimestre",
          390000,
          35.2,
          137280,
        ],
        ["(=) Base presumida", "", null, null, 537280],
      ],
    );
    assert.equal(hitlab.avisos.length, 1);
    assert.match(hitlab.avisos[0], /^LC 224\/2025 aplicada/);
  });

  test("títulos, códigos, locais e regras de vencimento das guias", () => {
    const guias = calcularApuracao(CAD, FATOS, "2027-01-06", aprovacoesEm("2027-01-06"));
    const resumo = (chave: string) => {
      const g = guiaDe(guias, chave);
      return [nomeGuia(g), g.local, g.rotulo_competencia, g.regra_vencimento, g.estabelecimento_id, g.empresa_contabil_id];
    };
    assert.deepEqual(resumo("iss|gc|2026-10"), [
      "ISS próprio",
      "Santo André-SP",
      "outubro/2026",
      "dia 20 do mês seguinte · em dia não útil, prorroga",
      "gc",
      "gocrazy",
    ]);
    assert.deepEqual(guiaDe(guias, "iss|gc|2026-10").avisos, [OBS_SANTO_ANDRE]);
    assert.equal(guiaDe(guias, "iss|gc|2026-10").vencimento_motivo, "20/11/2026 é feriado (Dia da Consciência Negra) · prorroga");
    assert.deepEqual(resumo("pis|california|2026-12"), [
      "PIS · DARF 6912",
      "Federal · California (matriz, soma São Paulo e Fortaleza)",
      "dezembro/2026",
      "dia 25 do mês seguinte · em dia não útil, antecipa",
      null,
      "california",
    ]);
    assert.deepEqual(resumo("cofins|hitlab|2026-12").slice(0, 2), ["COFINS · DARF 2172", "Federal · Hitlab"]);
    // A parte cumulativa do lucro real (o 12.08) tem DARF próprio (decisão 144).
    assert.deepEqual(resumo("pis_cum|california|2026-11"), [
      "PIS cumulativo · DARF 8109",
      "Federal · California (matriz, soma São Paulo e Fortaleza)",
      "novembro/2026",
      "dia 25 do mês seguinte · em dia não útil, antecipa",
      null,
      "california",
    ]);
    assert.equal(nomeGuia(guiaDe(guias, "cofins_cum|california|2026-11")), "COFINS cumulativa · DARF 2172");
    assert.deepEqual(resumo("csrf|california|2026-12").slice(0, 4), [
      "PIS/COFINS/CSLL retidos de fornecedores · DARF 5952",
      "Federal · California",
      "dezembro/2026",
      "dia 20 do mês seguinte ao pagamento · em dia não útil, antecipa",
    ]);
    assert.equal(nomeGuia(guiaDe(guias, "irrf|california|2026-12")), "IRRF retido de fornecedores · DARF 1708");
    assert.deepEqual(resumo("issret|ca-ssa|2026-11").slice(0, 4), [
      "ISS retido de fornecedores",
      "Salvador-BA",
      "novembro/2026",
      "dia 5 do mês seguinte à emissão da NF · em dia não útil, prorroga",
    ]);
    assert.deepEqual(resumo("irpj|california|2026-T4").slice(0, 4), [
      "IRPJ (com adicional) · DARF 0220",
      "Federal · California (matriz, soma São Paulo e Fortaleza)",
      "4º trimestre/2026",
      "último dia útil de cada mês do trimestre seguinte · 2ª cota com 1% e 3ª com Selic + 1%",
    ]);
    // 6012 é a CSLL do lucro real trimestral; 6773 é o ajuste anual (decisão 144).
    assert.equal(nomeGuia(guiaDe(guias, "csll|california|2026-T4")), "CSLL · DARF 6012");
    assert.equal(nomeGuia(guiaDe(guias, "irpj|hitlab|2026-T4")), "IRPJ (com adicional) · DARF 2089");
    assert.equal(nomeGuia(guiaDe(guias, "csll|hitlab|2026-T4")), "CSLL · DARF 2372");
  });
});

// ---------------------------------------------------------------------------
// 2. Casos de borda
// ---------------------------------------------------------------------------

const SEM_FATOS: FatosFiscais = { notas: [], recebimentos: [], notasFornecedor: [] };

const notaDeTeste = (parcial: Partial<NotaSaidaFiscal> & Pick<NotaSaidaFiscal, "id" | "emissao" | "valor">): NotaSaidaFiscal => ({
  numero: parcial.id.toUpperCase(),
  estabelecimento_id: "ca-ssa",
  cnae_id: "ca-ssa:73.19-0-99",
  conhecida_em: parcial.emissao,
  jobs: [{ ...J.j1101, valor: parcial.valor }],
  ...parcial,
});

const nfDeTeste = (
  parcial: Partial<NotaFornecedorFiscal> & Pick<NotaFornecedorFiscal, "id" | "emissao" | "valor">,
): NotaFornecedorFiscal => ({
  pp: `PP-${parcial.id}`,
  numero: parcial.id,
  fornecedor_nome: "Fornecedor Teste Ltda.",
  job: J.j1101,
  tomador_estabelecimento_id: "ca-ssa",
  aliquotas_aprovacao: {},
  sem_credito: false,
  motivo_sem_credito: null,
  pagamentos: [],
  ...parcial,
});

const aprovacao = (chave: string, data: string, valor: number, extra: Partial<AprovacaoFiscal> = {}): AprovacaoFiscal => ({
  chave,
  data,
  valor_calculado: valor,
  valor_guia: valor,
  diferenca: false,
  compensacoes_usadas: [],
  cotas: null,
  ...extra,
});

describe("casos de borda", () => {
  test("nota com dois jobs: o rateio divide pela parte de cada job, também no regime de caixa", () => {
    const n = notaDeTeste({ id: "n1", emissao: "2026-10-10", valor: 100000, jobs: [{ ...J.j1101, valor: 60000 }, { ...J.j1109, valor: 40000 }] });
    const h = notaDeTeste({
      id: "h1",
      estabelecimento_id: "hit",
      cnae_id: "hit:90.01-9-99",
      emissao: "2026-10-05",
      valor: 200000,
      jobs: [{ ...J.j1107, valor: 150000 }, { ...J.j1105, valor: 50000 }],
    });
    const fatos: FatosFiscais = { ...SEM_FATOS, notas: [n, h], recebimentos: [recebimento("r1", "h1", "2026-10-20", 100000)] };
    const guias = calcularApuracao(CAD, fatos, "2026-11-04", []);

    const iss = guiaDe(guias, "iss|ca-ssa|2026-10");
    assert.equal(iss.apurado, 2000);
    assert.deepEqual(resumoDoRateio(iss.rateio), [
      ["Agência California", "NE", 1200, 60],
      ["Agência California", "RJ", 800, 40],
    ]);
    assert.equal(iss.memoria[0].rotulo, "NF N1 · TES-1101/26 e TES-1109/26");
    assert.equal(iss.memoria[0].job_id, undefined);

    const pis = guiaDe(guias, "pis|california|2026-10");
    assert.equal(pis.apurado, 1650);
    assert.deepEqual(resumoDoRateio(pis.rateio), [
      ["Agência California", "NE", 990, 60],
      ["Agência California", "RJ", 660, 40],
    ]);
    assert.deepEqual(resumoDoRateio(guiaDe(guias, "irpj|california|2026-T4").rateio).map((r) => r[3]), [60, 40]);

    // Hitlab: o recebimento de R$ 100 mil reparte 75% / 25% pelos jobs da nota.
    const pisHitlab = guiaDe(guias, "pis|hitlab|2026-10");
    assert.equal(pisHitlab.apurado, 650);
    assert.deepEqual(resumoDoRateio(pisHitlab.rateio), [
      ["Hitlab", "Hitlab", 487.5, 75],
      ["CCH", "Agency", 162.5, 25],
    ]);

    // O "job tem nota" vale para qualquer job da nota.
    const custo = nfDeTeste({ id: "c1", job: J.j1109, emissao: "2026-10-12", valor: 1000 });
    assert.equal(situacaoDoCreditoDaNF(CAD, { ...fatos, notasFornecedor: [custo] }, custo, "2026-11-04").estado, "sim");
  });

  test("nota registrada depois: só entra quando o sistema a conhece, e a guia aprovada vira diferença", () => {
    const antiga = notaDeTeste({ id: "n1", emissao: "2026-10-05", valor: 10000 });
    const retroativa = notaDeTeste({ id: "n2", emissao: "2026-10-30", conhecida_em: "2026-12-03", valor: 5000, jobs: [{ ...J.j1111, valor: 5000 }] });
    const fatos: FatosFiscais = { ...SEM_FATOS, notas: [antiga, retroativa] };
    const chave = "iss|ca-ssa|2026-10";

    const antes = guiaDe(calcularApuracao(CAD, fatos, "2026-11-04", []), chave);
    assert.equal(antes.apurado, 200);
    assert.equal(antes.memoria.length, 1);
    const original = aprovacao(chave, "2026-11-03", 200);
    assert.equal(estadoDaGuia(antes, "2026-11-04", [original]).estado, "aprovada");

    const depois = guiaDe(calcularApuracao(CAD, fatos, "2026-12-04", [original]), chave);
    assert.equal(depois.apurado, 300);
    assert.equal(depois.memoria[1].detalhe, "73.19-0-99 · registrada em 03/12/2026");
    const s = estadoDaGuia(depois, "2026-12-04", [original]);
    assert.equal(s.estado, "diferenca");
    assert.equal(s.delta, 100);
    assert.equal(s.aprovacao, original);

    // A complementar vence na data legal da guia original — 05/11, já passada: nasce
    // vencida, e a baixa leva multa e juros (decisão 145) — e reparte como a guia
    // (200 NE + 100 Doca).
    const dif = aprovacao(chave, "2026-12-05", 300, { valor_guia: 100, diferenca: true });
    const [titulo, ...resto] = titulosDaAprovacao(depois, dif);
    assert.equal(resto.length, 0);
    assert.equal(titulo.origem, "diferenca");
    assert.equal(titulo.vencimento, "2026-11-05");
    assert.equal(titulo.vencimento, vencimentoDaComplementar(depois));
    assert.equal(titulo.valor, 100);
    assert.equal(titulo.descricao, "ISS próprio · outubro/2026 · Salvador-BA · complementar");
    assert.deepEqual(resumoDoRateio(titulo.rateio), [
      ["Agência California", "NE", 66.67, 66.67],
      ["CCH", "Doca", 33.33, 33.33],
    ]);
    // Aprovada a diferença, a guia volta a "aprovada"; a aprovação de referência segue a original.
    const depoisDaDiferenca = estadoDaGuia(depois, "2026-12-06", [original, dif]);
    assert.equal(depoisDaDiferenca.estado, "aprovada");
    assert.equal(depoisDaDiferenca.aprovacao, original);

    // Diferença para menos (o valor da complementar fica negativo): não gera título.
    assert.deepEqual(titulosDaAprovacao(depois, aprovacao(chave, "2026-12-05", 150, { valor_guia: -50, diferenca: true })), []);
  });

  test("retenção editada na baixa: CSRF e IRRF saem pelo que foi de fato retido, no mês de cada pagamento", () => {
    const nf = nfDeTeste({
      id: "c1",
      emissao: "2026-10-05",
      valor: 10000,
      fornecedor_nome: "Consultoria Ômega Ltda.",
      aliquotas_aprovacao: RETENCAO_NORMAL,
      pagamentos: [
        // Na baixa, o financeiro tirou o PIS e o IRRF desta parcela.
        { id: "p1", data: "2026-10-20", bruto: 6000, retido: { COFINS: 180, CSLL: 60 } },
        { id: "p2", data: "2026-11-10", bruto: 4000, retido: { PIS: 26, COFINS: 120, CSLL: 40, IRRF: 60 } },
      ],
    });
    const guias = calcularApuracao(CAD, { ...SEM_FATOS, notasFornecedor: [nf] }, "2026-12-04", []);

    const outubro = guiaDe(guias, "csrf|california|2026-10");
    assert.equal(outubro.apurado, 240);
    assert.equal(outubro.base, 6000);
    assert.equal(outubro.memoria[0].aliquota, 4);
    assert.match(outubro.memoria[0].detalhe ?? "", /· COFINS 3% \+ CSLL 1%$/);
    assert.equal(outubro.vencimento, "2026-11-19"); // 20/11 é feriado: antecipa
    assert.equal(guias.some((g) => g.chave === "irrf|california|2026-10"), false);

    assert.equal(guiaDe(guias, "csrf|california|2026-11").apurado, 186);
    assert.equal(guiaDe(guias, "irrf|california|2026-11").apurado, 60);
    assert.equal(guiaDe(guias, "irrf|california|2026-11").vencimento, "2026-12-18"); // 20/12 é domingo
  });

  test("ISS retido do fornecedor sai pela emissão da NF, no CNPJ tomador, pela alíquota da aprovação", () => {
    const nf = nfDeTeste({
      id: "c1",
      tomador_estabelecimento_id: "ca-sp",
      emissao: "2026-10-28",
      valor: 8000,
      aliquotas_aprovacao: { ISS: 2.5 },
      pagamentos: [{ id: "p1", data: "2026-11-05", bruto: 8000, retido: { ISS: 200 } }],
    });
    const g = guiaDe(calcularApuracao(CAD, { ...SEM_FATOS, notasFornecedor: [nf] }, "2026-11-04", []), "issret|ca-sp|2026-10");
    assert.equal(g.apurado, 200);
    assert.equal(g.vencimento, "2026-11-10");
    assert.equal(g.estabelecimento_id, "ca-sp");
  });

  test("saldo credor passa para o mês seguinte, inclusive por um mês sem movimento", () => {
    const fatos: FatosFiscais = {
      notas: [notaDeTeste({ id: "n1", emissao: "2026-10-10", valor: 10000 }), notaDeTeste({ id: "n2", emissao: "2026-12-10", valor: 100000 })],
      recebimentos: [],
      notasFornecedor: [nfDeTeste({ id: "c1", emissao: "2026-10-15", valor: 50000 })],
    };
    const guias = calcularApuracao(CAD, fatos, "2027-01-06", []);
    const outubro = guiaDe(guias, "pis|california|2026-10");
    assert.equal(outubro.apurado, 0);
    assert.equal(outubro.saldo_credor_gerado, 660); // 165 de débito − 825 de crédito
    assert.deepEqual(outubro.avisos.map(semNbsp), ["Crédito maior que o débito: R$ 660,00 passam para novembro/2026."]);

    const novembro = guiaDe(guias, "pis|california|2026-11");
    assert.deepEqual(
      novembro.memoria.map((m) => [m.grupo, m.rotulo, m.valor]),
      [["saldo", "Saldo credor de outubro/2026", -660]],
    );
    assert.equal(novembro.saldo_credor_gerado, 660);

    const dezembro = guiaDe(guias, "pis|california|2026-12");
    assert.equal(dezembro.apurado, 990); // 1.650 − 660
    assert.equal(dezembro.saldo_credor_gerado, 0);
    assert.equal(dezembro.memoria.at(-1)?.rotulo, "Saldo credor de novembro/2026");
    assert.equal(guiaDe(guias, "cofins|california|2026-12").apurado, 4560); // 7.600 − 3.040
  });

  test("cotas do IRPJ/CSLL: 1, 2 ou 3 parcelas, e a 3ª com a Selic vigente no cadastro", () => {
    assert.deepEqual(resumoDasCotas(cotasDe(1999.99, "2026-T4", "Salvador", CAD)), [[1, "2027-01-29", 1999.99, 0, 0]]);
    assert.deepEqual(resumoDasCotas(cotasDe(2500, "2026-T4", "Salvador", CAD)), [
      [1, "2027-01-29", 1250, 0, 0],
      [2, "2027-02-26", 1250, 1, 12.5],
    ]);
    assert.deepEqual(resumoDasCotas(cotasDe(2999.99, "2026-T4", "Salvador", CAD)), [
      [1, "2027-01-29", 1500, 0, 0],
      [2, "2027-02-26", 1499.99, 1, 15],
    ]);
    assert.deepEqual(resumoDasCotas(cotasDe(9000.01, "2026-T4", "Salvador", CAD)), [
      [1, "2027-01-29", 3000, 0, 0],
      [2, "2027-02-26", 3000, 1, 30],
      [3, "2027-03-31", 3000.01, 2.1, 63],
    ]);
    const novaSelic: CadastroFiscal = { ...CAD, parametros: [...PARAMETROS, parametro("selic_estimada_mes", 1.25, "2027-03-01")] };
    assert.deepEqual(resumoDasCotas(cotasDe(9000.01, "2026-T4", "Salvador", novaSelic))[2], [3, "2027-03-31", 3000.01, 2.25, 67.5]);
    assert.deepEqual(resumoDasCotas(cotasDe(0, "2026-T4", "Salvador", CAD)), [[1, "2027-01-29", 0, 0, 0]]);
  });

  test("títulos do IRPJ: um por cota, com os juros e o rateio da guia; guia sem valor não gera título", () => {
    const guias = calcularApuracao(CAD, FATOS, "2027-01-06", aprovacoesEm("2027-01-06"));
    const irpj = guiaDe(guias, "irpj|california|2026-T4");
    const titulos = titulosDaAprovacao(irpj, aprovacao(irpj.chave, "2027-01-27", irpj.apurado, { cotas: irpj.cotas ?? null }));
    assert.deepEqual(
      titulos.map((t) => [t.cota_numero, t.cota_total, t.juros_pct, t.vencimento, t.principal, t.juros, t.valor]),
      [
        [1, 3, 0, "2027-01-29", 11260.63, 0, 11260.63],
        [2, 3, 1, "2027-02-26", 11260.63, 112.61, 11373.24],
        [3, 3, 2.1, "2027-03-31", 11260.62, 236.47, 11497.09],
      ],
    );
    for (const t of titulos) assert.equal(r2(t.rateio.reduce((s, x) => s + x.valor, 0)), t.valor);
    assert.equal(titulos[2].descricao, "IRPJ (com adicional) · 4º trimestre/2026 · Federal · California (matriz, soma São Paulo e Fortaleza) · cota 3/3");
    // Cota única escolhida na aprovação.
    const unica = titulosDaAprovacao(irpj, aprovacao(irpj.chave, "2027-01-27", 33000, { cotas: [{ numero: 1, vencimento: "2027-01-29", principal: 33000, jurosPct: 0, juros: 0 }] }));
    assert.deepEqual(unica.map((t) => [t.cota_numero, t.cota_total, t.valor]), [[1, 1, 33000]]);
    // ISS sem valor (São Paulo, todo retido pelo cliente): confirmada, sem título.
    assert.deepEqual(titulosDaAprovacao(guiaDe(guias, "iss|ca-sp|2026-10"), aprovacao("iss|ca-sp|2026-10", "2026-11-08", 0)), []);
  });

  test("rateio zerado (apurado zero) com guia da contabilidade com valor: o título reparte pelo percentual", () => {
    const rateio: RateioDaGuia[] = [
      { empresa_id: "agencia", empresa_nome: "Agência California", regional_id: "agencia:SP", regional_nome: "SP", valor: 0, pct: 100 },
    ];
    assert.deepEqual(escalarRateio(rateio, 50).map((x) => x.valor), [50]);
    const dois: RateioDaGuia[] = [
      { ...rateio[0], valor: 0, pct: 60 },
      { ...rateio[0], regional_id: "agencia:NE", regional_nome: "NE", valor: 0, pct: 40 },
    ];
    assert.deepEqual(escalarRateio(dois, 100).map((x) => x.valor), [60, 40]);
    assert.deepEqual(escalarRateio([], 100), []);
  });

  test("estorno do 12.08: uma vez por job, na primeira nota, e só do custo que deu crédito", () => {
    const j = J.j1102;
    const fatos: FatosFiscais = {
      notas: [
        notaDeTeste({ id: "n1", cnae_id: "ca-ssa:82.30-0-01-12.08", emissao: "2026-11-11", valor: 55000, jobs: [{ ...j, valor: 55000 }] }),
        notaDeTeste({ id: "n2", cnae_id: "ca-ssa:82.30-0-01-12.08", emissao: "2026-12-10", valor: 20000, jobs: [{ ...j, valor: 20000 }] }),
      ],
      recebimentos: [],
      notasFornecedor: [
        nfDeTeste({ id: "c-out", job: j, emissao: "2026-10-08", valor: 25000 }),
        nfDeTeste({ id: "c-sem", job: j, emissao: "2026-10-09", valor: 7000, sem_credito: true, motivo_sem_credito: "Reembolso de despesa do cliente" }),
        nfDeTeste({ id: "c-nov", job: j, emissao: "2026-11-05", valor: 15000 }),
      ],
    };
    const guias = calcularApuracao(CAD, fatos, "2027-01-06", []);
    const estornos = (chave: string) => guiaDe(guias, chave).memoria.filter((m) => m.grupo === "estorno").map((m) => [m.pp, m.valor]);
    assert.deepEqual(estornos("pis|california|2026-11"), [["PP-c-out", 412.5]]);
    assert.deepEqual(estornos("cofins|california|2026-11"), [["PP-c-out", 1900]]);
    // Dezembro só tem a segunda nota do 12.08: nenhum estorno, e a guia não cumulativa nem sai.
    assert.equal(guias.find((g) => g.chave === "pis|california|2026-12"), undefined);
    assert.deepEqual(estornos("pis_cum|california|2026-12"), []);
    // Novembro: o saldo credor de outubro (o crédito estornado) zera a guia não cumulativa,
    // e o débito do 12.08 sai inteiro na cumulativa.
    assert.equal(guiaDe(guias, "pis|california|2026-11").apurado, 0);
    assert.equal(guiaDe(guias, "pis_cum|california|2026-11").apurado, 357.5);
    // O custo de novembro já nasce sem crédito.
    const info = guiaDe(guias, "pis|california|2026-11").memoria.find((m) => m.pp === "PP-c-nov");
    assert.equal(info?.grupo, "info");
    assert.equal(info?.detalhe, "Job faturado no 82.30-0-01 · 12.08 (NF N1): custo sem crédito.");
    // IRPJ: o crédito estornado no trimestre sai dos créditos (25.000 × 9,25% − 25.000 × 9,25% = 0).
    const creditos = guiaDe(guias, "irpj|california|2026-T4").memoria.find((m) => m.rotulo.startsWith("(+) Créditos"));
    assert.equal(creditos?.valor, 0);
  });

  test("12.08 no lucro real: guia própria (8109/2172), o crédito não a abate, e a retenção da nota do 12.08 sim", () => {
    const fatos: FatosFiscais = {
      notas: [
        notaDeTeste({ id: "n-normal", emissao: "2026-11-03", valor: 100000, jobs: [{ ...J.j1101, valor: 100000 }] }),
        notaDeTeste({ id: "n-1208", cnae_id: "ca-ssa:82.30-0-01-12.08", emissao: "2026-11-05", valor: 50000, jobs: [{ ...J.j1102, valor: 50000 }] }),
        notaDeTeste({ id: "n-1208b", cnae_id: "ca-ssa:82.30-0-01-12.08", emissao: "2026-12-07", valor: 10000, jobs: [{ ...J.j1102, valor: 10000 }] }),
      ],
      recebimentos: [
        { id: "r1", nota_id: "n-1208", data: "2026-11-20", bruto: 50000, retido: { PIS: 100 } },
        { id: "r2", nota_id: "n-1208b", data: "2026-12-15", bruto: 10000, retido: { PIS: 100 } },
      ],
      notasFornecedor: [nfDeTeste({ id: "c1", job: J.j1101, emissao: "2026-11-10", valor: 120000 })],
    };
    const guias = calcularApuracao(CAD, fatos, "2027-01-06", []);
    const pis = guiaDe(guias, "pis|california|2026-11");
    const pisCum = guiaDe(guias, "pis_cum|california|2026-11");
    const cofinsCum = guiaDe(guias, "cofins_cum|california|2026-11");
    // Não cumulativo: 1.650,00 de débito contra 1.980,00 de crédito; sobram 330,00 de saldo credor.
    assert.deepEqual([pis.codigo, pis.apurado, pis.saldo_credor_gerado], ["6912", 0, 330]);
    assert.ok(pis.memoria.every((m) => m.nota_id !== "n-1208"));
    // Cumulativo: 50.000,00 × 0,65% = 325,00, menos os 100,00 retidos na nota do 12.08. Antes da
    // decisão 144, o crédito abatia este débito e nada se pagava em novembro.
    assert.deepEqual([pisCum.titulo, pisCum.codigo, pisCum.apurado], ["PIS cumulativo", "8109", 225]);
    assert.deepEqual(pisCum.memoria.map((m) => [m.grupo, m.valor]), [["debito", 325], ["retido", -100]]);
    assert.deepEqual([cofinsCum.titulo, cofinsCum.codigo, cofinsCum.apurado], ["COFINS cumulativa", "2172", 1500]);
    // Dezembro: retenção maior que o débito do 12.08 passa de mês, sem virar crédito.
    const dezembro = guiaDe(guias, "pis_cum|california|2026-12");
    assert.deepEqual([dezembro.apurado, dezembro.saldo_credor_gerado], [0, 35]);
    assert.deepEqual(dezembro.avisos.map(semNbsp), ["Retenção maior que o débito: R$ 35,00 passam para janeiro/2027."]);
    assert.deepEqual(
      guiaDe(guias, "pis_cum|california|2027-01").memoria.map((m) => [semNbsp(m.rotulo), m.detalhe, m.valor]),
      [["Saldo de dezembro/2026", "retenção que passou do mês anterior", -35]],
    );
    // O saldo credor do não cumulativo segue na guia não cumulativa.
    assert.equal(guiaDe(guias, "pis|california|2026-12").memoria.at(-1)?.rotulo, "Saldo credor de novembro/2026");
  });

  test("DARF mínimo: abaixo de R$ 10,00 não se paga e soma à guia seguinte do mesmo código (decisão 145)", () => {
    const pagamento = (id: string, data: string, irrf: number) => ({ id, data, bruto: irrf / 0.015, retido: { IRRF: irrf } });
    const fatos: FatosFiscais = {
      ...SEM_FATOS,
      notasFornecedor: [
        nfDeTeste({ id: "f1", emissao: "2026-11-03", valor: 600, pagamentos: [pagamento("p1", "2026-11-10", 9)] }),
        nfDeTeste({ id: "f2", emissao: "2026-12-01", valor: 40, pagamentos: [pagamento("p2", "2026-12-10", 0.6)] }),
        nfDeTeste({ id: "f3", emissao: "2027-01-02", valor: 400, pagamentos: [pagamento("p3", "2027-01-05", 6)] }),
      ],
    };
    const guias = calcularApuracao(CAD, fatos, "2027-02-10", []);
    const nov = guiaDe(guias, "irrf|california|2026-11");
    const dez = guiaDe(guias, "irrf|california|2026-12");
    const jan = guiaDe(guias, "irrf|california|2027-01");
    // Novembro: R$ 9,00 não se paga e passa para dezembro.
    assert.equal(nov.apurado, 0);
    assert.deepEqual(nov.memoria.at(-1) && [nov.memoria.at(-1)!.grupo, semNbsp(nov.memoria.at(-1)!.rotulo), nov.memoria.at(-1)!.valor], [
      "saldo",
      "Abaixo do DARF mínimo (R$ 10,00)",
      -9,
    ]);
    assert.deepEqual(nov.avisos.map(semNbsp), ["Abaixo do DARF mínimo de R$ 10,00: R$ 9,00 passam para a guia de dezembro/2026, no mesmo código."]);
    // Dezembro: 0,60 + 9,00 = 9,60, ainda abaixo: passa para janeiro.
    assert.equal(dez.apurado, 0);
    assert.equal(dez.memoria.find((m) => m.rotulo.startsWith("Vindo de"))?.valor, 9);
    // Janeiro: 6,00 + 9,60 = 15,60 — paga-se no vencimento de janeiro, com o rateio de onde veio.
    assert.equal(jan.apurado, 15.6);
    assert.equal(semNbsp(jan.memoria.find((m) => m.rotulo.startsWith("Vindo de"))!.rotulo), "Vindo de dezembro/2026 (abaixo do DARF mínimo)");
    assert.equal(r2(jan.rateio.reduce((s, x) => s + x.valor, 0)), 15.6);
    // E vira título no valor inteiro, no vencimento de janeiro.
    const [titulo] = titulosDaAprovacao(jan, aprovacao(jan.chave, "2027-02-18", 15.6));
    assert.deepEqual([titulo.valor, titulo.vencimento], [15.6, jan.vencimento]);
    assert.deepEqual(titulosDaAprovacao(nov, aprovacao(nov.chave, "2026-12-18", 0)), []);
  });

  test("crédito de PIS/COFINS da NF do fornecedor: presumido, tirado, 12.08, a confirmar e sim", () => {
    const notas = [
      notaDeTeste({ id: "n1708", cnae_id: "ca-ssa:82.30-0-01-17.10", emissao: "2026-10-10", valor: 1000, jobs: [{ ...J.j1104, valor: 1000 }] }),
      notaDeTeste({ id: "n1208", cnae_id: "ca-ssa:82.30-0-01-12.08", emissao: "2026-11-10", valor: 1000, jobs: [{ ...J.j1102, valor: 1000 }] }),
    ];
    const fatos: FatosFiscais = { ...SEM_FATOS, notas };
    const situacao = (parcial: Partial<NotaFornecedorFiscal>) =>
      situacaoDoCreditoDaNF(CAD, fatos, nfDeTeste({ id: "c1", emissao: "2026-10-20", valor: 1000, ...parcial }), "2026-12-04");

    assert.deepEqual(situacao({ tomador_estabelecimento_id: "hit" }), {
      gera: false,
      estado: "nao",
      motivo: "O CNPJ tomador está no lucro presumido: PIS/COFINS cumulativos, sem crédito.",
    });
    assert.equal(situacao({ sem_credito: true, motivo_sem_credito: "Reembolso de despesa do cliente." }).motivo, "Marcado pelo financeiro como sem crédito: Reembolso de despesa do cliente.");
    assert.equal(situacao({ sem_credito: true }).motivo, "Marcado pelo financeiro como sem crédito.");
    assert.equal(situacao({ job: J.j1104 }).estado, "sim");
    assert.equal(situacao({ job: J.j1112 }).estado, "confirmar");
    // 12.08 depois do custo: o custo de outubro dá crédito (estornado em novembro)…
    assert.equal(situacao({ job: J.j1102 }).estado, "sim");
    // …e o de novembro em diante, não.
    assert.deepEqual(situacao({ job: J.j1102, emissao: "2026-11-20" }), {
      gera: false,
      estado: "nao",
      motivo: "Job faturado no 82.30-0-01 · 12.08 (NF N1208): custo sem crédito.",
    });
    // Visto antes de a nota do 12.08 existir, ainda é "a confirmar".
    assert.equal(situacaoDoCreditoDaNF(CAD, fatos, nfDeTeste({ id: "c1", job: J.j1102, emissao: "2026-10-20", valor: 1000 }), "2026-11-04").estado, "confirmar");
  });

  test("ISS a recuperar: São Paulo pede restituição e não entra como compensação; Salvador compensa uma vez só", () => {
    const sp = notaDeTeste({ id: "nsp", estabelecimento_id: "ca-sp", cnae_id: "ca-sp:73.19-0-99", emissao: "2026-10-09", valor: 10000 });
    const ssa = notaDeTeste({ id: "nssa", emissao: "2026-10-09", valor: 10000 });
    const fatos: FatosFiscais = {
      notas: [sp, ssa, notaDeTeste({ id: "nssa2", emissao: "2026-11-09", valor: 50000 })],
      recebimentos: [recebimento("rsp", "nsp", "2026-11-20", 10000, { ISS: 500 }), recebimento("rssa", "nssa", "2026-11-20", 10000, { ISS: 200 })],
      notasFornecedor: [],
    };
    const outubro = [aprovacao("iss|ca-sp|2026-10", "2026-11-08", 500), aprovacao("iss|ca-ssa|2026-10", "2026-11-03", 200)];
    const aRecuperar = issARecuperar(CAD, fatos, outubro, "2026-12-04");
    assert.deepEqual(
      aRecuperar.map((a) => [a.id, a.estabelecimento_id, a.valor, a.forma]),
      [
        ["rec-rsp", "ca-sp", 500, "restituir"],
        ["rec-rssa", "ca-ssa", 200, "compensar"],
      ],
    );
    const guias = calcularApuracao(CAD, fatos, "2026-12-04", outubro);
    // A guia aprovada não muda com a retenção posterior (ela vira ISS a recuperar).
    assert.equal(estadoDaGuia(guiaDe(guias, "iss|ca-sp|2026-10"), "2026-12-04", outubro).estado, "aprovada");
    assert.equal(guiaDe(guias, "iss|ca-sp|2026-10").memoria.length, 1);
    // Salvador: sugerida na guia de novembro (1.000 − 200).
    const novembro = guiaDe(guias, "iss|ca-ssa|2026-11");
    assert.equal(novembro.apurado, 800);
    assert.deepEqual(novembro.compensacoes?.map((c) => c.id), ["rec-rssa"]);

    // Aprovada novembro com a compensação: some da lista e não volta em dezembro.
    const comNovembro = [...outubro, aprovacao("iss|ca-ssa|2026-11", "2026-12-05", 800, { compensacoes_usadas: ["rec-rssa"] })];
    assert.deepEqual(issARecuperar(CAD, fatos, comNovembro, "2027-01-06").map((a) => a.id), ["rec-rsp"]);
    const emJaneiro = calcularApuracao(CAD, fatos, "2027-01-06", comNovembro);
    assert.equal(guiaDe(emJaneiro, "iss|ca-ssa|2026-11").apurado, 800);
    assert.equal(emJaneiro.some((g) => g.chave === "iss|ca-ssa|2026-12"), false);

    // Aprovada novembro SEM a compensação: a sugestão passa para a guia seguinte.
    const semCompensar = [...outubro, aprovacao("iss|ca-ssa|2026-11", "2026-12-05", 1000)];
    const dezembro = calcularApuracao(CAD, { ...fatos, notas: [...fatos.notas, notaDeTeste({ id: "nssa3", emissao: "2026-12-09", valor: 50000 })] }, "2027-01-06", semCompensar);
    assert.equal(guiaDe(dezembro, "iss|ca-ssa|2026-11").apurado, 1000);
    assert.deepEqual(guiaDe(dezembro, "iss|ca-ssa|2026-12").compensacoes?.map((c) => c.id), ["rec-rssa"]);
  });

  test("CNAE vigente na data: a alíquota nova vale para a nota emitida depois, mesmo apontando a linha antiga", () => {
    const antiga = { ...CNAES[0], vigencia_fim: "2026-10-31" };
    const nova = { ...CNAES[0], id: "ca-ssa:73.19-0-99:nova", aliquota_iss: 3, vigencia_inicio: "2026-11-01" };
    const cad: CadastroFiscal = { ...CAD, cnaes: [antiga, nova, ...CNAES.slice(1)] };
    const fatos: FatosFiscais = {
      ...SEM_FATOS,
      notas: [notaDeTeste({ id: "n1", emissao: "2026-10-10", valor: 10000 }), notaDeTeste({ id: "n2", emissao: "2026-11-10", valor: 10000 })],
    };
    const guias = calcularApuracao(cad, fatos, "2026-12-04", []);
    assert.equal(guiaDe(guias, "iss|ca-ssa|2026-10").apurado, 200);
    assert.equal(guiaDe(guias, "iss|ca-ssa|2026-11").apurado, 300);
  });

  test("lucro presumido sem regime de caixa: segue o recebimento e avisa (regra a definir)", () => {
    const cad: CadastroFiscal = { ...CAD, regimes: [regime("california", "lucro_real", false), regime("gocrazy", "lucro_presumido", false), regime("hitlab", "lucro_presumido", true)] };
    const n = notaDeTeste({ id: "n1", estabelecimento_id: "gc", cnae_id: "gc:59.11-1-99", emissao: "2026-10-10", valor: 10000, jobs: [{ ...J.j1106, valor: 10000 }] });
    const fatos: FatosFiscais = { ...SEM_FATOS, notas: [n], recebimentos: [recebimento("r1", "n1", "2026-10-25", 10000)] };
    const pis = guiaDe(calcularApuracao(cad, fatos, "2026-11-04", []), "pis|gocrazy|2026-10");
    assert.equal(pis.codigo, "8109");
    assert.equal(pis.memoria[0].rotulo, "Recebimento da NF N1 · TES-1106/26 Filme Institucional");
    assert.match(pis.avisos[0], /^Lucro presumido pela competência/);
  });

  test("antes da primeira competência não há guia, e fatos depois de asOf não entram", () => {
    assert.deepEqual(calcularApuracao(CAD, FATOS, "2026-09-30", []), []);
    const guias = calcularApuracao(CAD, FATOS, "2026-10-15", []);
    // A NF 2054 é de 20/10: ainda não entra no ISS de Salvador.
    assert.equal(guiaDe(guias, "iss|ca-ssa|2026-10").apurado, 2900);
    // O cliente de São Paulo só retém em 28/10.
    assert.equal(guiaDe(guias, "iss|ca-sp|2026-10").apurado, 3100);
    assert.equal(guiaDe(guias, "iss|ca-sp|2026-10").memoria.length, 1);
    // A nota da Hitlab é de 27/10 e os pagamentos com retenção, de novembro.
    assert.equal(guias.some((g) => g.chave.startsWith("iss|hit|") || g.chave.startsWith("csrf|") || g.chave.includes("hitlab")), false);
    // PIS de outubro: as 3 notas até 15/10 (R$ 255 mil) menos o crédito das 4 NFs até 15/10 (R$ 128 mil).
    assert.equal(guiaDe(guias, "pis|california|2026-10").apurado, 2095.5);
    assert.equal(estadoDaGuia(guiaDe(guias, "iss|ca-ssa|2026-10"), "2026-10-15", []).estado, "em_curso");
  });
});
