/**
 * Motor de apuração do módulo fiscal (entrega 2 — Apuração e Impostos a
 * Pagar, 02/10/2026).
 *
 * Porta, em funções puras, do motor do protótipo aprovado pelo Tiago em
 * 02/10/2026 (regras fechadas em 01 e 02/10/2026 e na pesquisa tributária de
 * docs/superpowers/specs/2026-10-01-modulo-fiscal-pesquisa-tributaria.md).
 * Recebe o cadastro de impostos (`lib/fiscal/cadastro.ts`) e os fatos já
 * lidos do banco — notas de saída, recebimentos, NFs de fornecedor e os
 * pagamentos delas — e devolve as guias com a memória de cálculo. Não lê banco.
 *
 * As guias:
 * - ISS próprio, por CNPJ emissor e mês da EMISSÃO da nota: menos o ISS que o
 *   cliente reteve e o ISS a compensar (Salvador);
 * - PIS e COFINS, por PJ e mês, pela matriz. Lucro real: débito pela emissão,
 *   crédito sobre o custo (NF do fornecedor emitida no mês) menos a parte da
 *   receita do mês no 12.08 (rateio proporcional, decisão 146) e saldo
 *   credor que passa de mês; a receita do 12.08 (regime cumulativo) vai em
 *   guia própria, DARF 8109 e 2172, sem crédito (decisão 144). Lucro
 *   presumido pelo caixa: débito pelo RECEBIMENTO, sem crédito;
 * - IRPJ e CSLL, por PJ e trimestre, em até 3 cotas (lucro real: estimativa
 *   pelo lucro bruto; presumido: presunção sobre o recebido, com a LC 224/2025);
 * - retenções feitas ao pagar fornecedores: CSRF (DARF 5952) e IRRF (DARF
 *   1708) pelo mês do PAGAMENTO, com o que foi de fato retido na baixa; ISS
 *   retido pela EMISSÃO da NF do fornecedor, no CNPJ tomador.
 *
 * O que muda em relação ao protótipo está anotado onde acontece: procure
 * "Diferença do protótipo".
 */
import { formatBRL } from "@/lib/format";
import type { FiscalCnae, FiscalEstabelecimento, ImpostoRetido, RegimeTributarioPJ } from "@/lib/types";
import { feriadosDoCalculo, parametroVigente, regimeDaPJ, type CadastroFiscal } from "./cadastro";
import { codigoDoCnae } from "./calculos";
import { codigoDarf } from "./codigos-darf";
import {
  ajustarVencimento,
  dataBr,
  mesDe,
  nomeDoMes,
  proximoMes,
  r2,
  ultimoDiaDoMes,
  vencimentoNoMesSeguinte,
  type FeriadoDoVencimento,
  type RegraDoVencimento,
  type Vencimento,
} from "./datas";

export type { ImpostoRetido } from "@/lib/types";

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export type Tributo = "ISS" | "PIS" | "COFINS" | "IRPJ" | "CSLL" | "ISS_RET" | "CSRF" | "IRRF";

/** O job de um fato, com a empresa gerencial e a regional (as chaves do rateio). */
export interface JobDoFato {
  job_id: string;
  codigo: string;
  nome: string;
  empresa_id: string;
  empresa_nome: string;
  regional_id: string | null;
  regional_nome: string | null;
}

/** Nota fiscal de saída com o CNPJ emissor e o CNAE escolhidos no Faturar. */
export interface NotaSaidaFiscal {
  id: string;
  numero: string;
  estabelecimento_id: string;
  /** A linha de `fiscal_cnaes` da nota; o motor usa a versão vigente na emissão. */
  cnae_id: string;
  emissao: string;
  /** Quando a nota entrou no sistema: antes disso ela não existe para o cálculo. */
  conhecida_em: string;
  valor: number;
  /** Os jobs que a nota cobre, com a parte de cada um (é o peso no rateio). */
  jobs: Array<JobDoFato & { valor: number }>;
}

/** Baixa de um título a receber: o bruto (líquido + retidos) e o que o cliente reteve. */
export interface RecebimentoFiscal {
  id: string;
  nota_id: string;
  data: string;
  bruto: number;
  retido: Partial<Record<ImpostoRetido, number>>;
}

/** Baixa de uma PP: o bruto (base das retenções) e o que a agência de fato reteve. */
export interface PagamentoDeFornecedor {
  id: string;
  data: string;
  bruto: number;
  retido: Partial<Record<ImpostoRetido, number>>;
  /**
   * Decisão 152: a PP que pagou e o job dela. A nota pode cobrir mais de uma
   * PP; os pagamentos de cada PP vão na primeira nota dela, com o próprio
   * código e job (sem eles, valem os da nota).
   */
  pp?: string;
  job?: JobDoFato;
}

/**
 * NF do fornecedor registrada na aprovação da PP. Decisão 152: uma linha por
 * nota do cadastro, que conta UMA vez, pelo valor total, mesmo cobrindo mais
 * de uma PP.
 */
export interface NotaFornecedorFiscal {
  id: string;
  /** "PP-00121", ou "PP-00121, PP-00125" quando a nota cobre mais de uma PP. */
  pp: string;
  /** As PPs (aprovadas ou pagas) que a nota cobre. Sem ele, `id` é a PP. */
  pp_ids?: string[];
  numero: string;
  fornecedor_nome: string;
  job: JobDoFato;
  /** O CNPJ para o qual a NF saiu: quem toma o crédito e recolhe o ISS retido. */
  tomador_estabelecimento_id: string;
  emissao: string;
  valor: number;
  /** As alíquotas de retenção decididas na aprovação (o ISS retido sai daqui). */
  aliquotas_aprovacao: Partial<Record<ImpostoRetido, number>>;
  /** O financeiro tirou o crédito de PIS/COFINS desta NF, com motivo. */
  sem_credito: boolean;
  motivo_sem_credito: string | null;
  pagamentos: PagamentoDeFornecedor[];
}

export interface FatosFiscais {
  notas: NotaSaidaFiscal[];
  recebimentos: RecebimentoFiscal[];
  notasFornecedor: NotaFornecedorFiscal[];
}

/** Cota do IRPJ/CSLL: a 1ª sem juros, a 2ª com 1% e a 3ª com a Selic + 1%. */
export interface Cota {
  numero: number;
  vencimento: string;
  principal: number;
  jurosPct: number;
  juros: number;
}

/** Uma aprovação de guia — a original ou uma diferença —, como o banco guarda. */
export interface AprovacaoFiscal {
  chave: string;
  data: string;
  /** O apurado pelo sistema na hora da aprovação (o valor inteiro, também na diferença). */
  valor_calculado: number;
  /** O valor da guia da contabilidade; na diferença, o da guia complementar. */
  valor_guia: number;
  diferenca: boolean;
  /** Os `ARecuperar.id` compensados nesta guia (ISS de Salvador). */
  compensacoes_usadas: string[];
  /** IRPJ/CSLL: as cotas aprovadas (`cotasDe` sobre o valor da guia). */
  cotas: Cota[] | null;
}

export interface ItemMemoria {
  grupo: "debito" | "credito" | "rateio_credito" | "retido" | "saldo" | "compensacao" | "base" | "info";
  rotulo: string;
  detalhe?: string;
  base?: number;
  aliquota?: number;
  /** Com sinal: + soma ao imposto, − abate. Nas linhas "base", o valor da linha. */
  valor: number;
  job_id?: string;
  nota_id?: string;
  pp?: string;
}

export interface RateioDaGuia {
  empresa_id: string;
  empresa_nome: string;
  regional_id: string | null;
  regional_nome: string | null;
  valor: number;
  pct: number;
}

/**
 * ISS que o cliente reteve depois de aprovada a guia da competência da nota:
 * a agência já pagou aquele ISS. Salvador permite compensar nas guias
 * seguintes; nos outros municípios, pede-se restituição.
 */
export interface ARecuperar {
  /** `rec-<recebimento_id>`: é o identificador que vai em `compensacoes_usadas`. */
  id: string;
  estabelecimento_id: string;
  nota_id: string;
  recebimento_id: string;
  data: string;
  valor: number;
  competencia_nota: string;
  forma: "compensar" | "restituir";
}

export interface Guia {
  /** `${prefixo}|${estabelecimento_id ou empresa_contabil_id}|${competencia}`. */
  chave: string;
  tributo: Tributo;
  titulo: string;
  codigo: string | null;
  empresa_contabil_id: string;
  estabelecimento_id: string | null;
  local: string;
  /** "2026-10" ou "2026-T4". */
  competencia: string;
  rotulo_competencia: string;
  periodo: "mensal" | "trimestral";
  vencimento: string;
  vencimento_motivo: string | null;
  regra_vencimento: string;
  memoria: ItemMemoria[];
  apurado: number;
  saldo_credor_gerado: number;
  base: number;
  rateio: RateioDaGuia[];
  avisos: string[];
  /** IRPJ/CSLL: a prévia das cotas. */
  cotas?: Cota[];
  /** ISS de Salvador: o ISS a recuperar compensado nesta guia (sugerido ou aprovado). */
  compensacoes?: ARecuperar[];
}

export type EstadoGuia = "em_curso" | "a_aprovar" | "aprovada" | "diferenca";

/** A primeira competência apurada pelo módulo (outubro de 2026). */
export const PRIMEIRA_COMPETENCIA = "2026-10";

/** Os títulos de Impostos a Pagar que uma aprovação gera (cotas no IRPJ/CSLL, complementar na diferença). */
export interface TituloDaAprovacao {
  origem: "apuracao" | "diferenca";
  cota_numero: number | null;
  cota_total: number | null;
  juros_pct: number | null;
  vencimento: string;
  principal: number;
  juros: number;
  valor: number;
  descricao: string;
  rateio: RateioDaGuia[];
}

export const nomeGuia = (g: Pick<Guia, "titulo" | "codigo">) => `${g.titulo}${g.codigo ? ` · DARF ${g.codigo}` : ""}`;

// ---------------------------------------------------------------------------
// Datas do período (as que ./datas ainda não tem)
// ---------------------------------------------------------------------------

/** "2026-11-04T10:00:00Z" → "2026-11-04". */
const dia = (s: string) => s.slice(0, 10);

/** "2026-11" ou "2026-11-04" → "2026-T4". */
export function trimestreDe(s: string) {
  const [y, m] = s.split("-").map(Number);
  return `${y}-T${Math.ceil(m / 3)}`;
}

function mesesDoTrimestre(t: string) {
  const [y, q] = t.split("-T").map(Number);
  return [1, 2, 3].map((i) => `${y}-${String((q - 1) * 3 + i).padStart(2, "0")}`);
}

/** "2026-T4" → "2026-12-31". */
export const fimDoTrimestre = (t: string) => ultimoDiaDoMes(mesesDoTrimestre(t)[2]);

function proximoTrimestre(t: string) {
  const [y, q] = t.split("-T").map(Number);
  return q === 4 ? `${y + 1}-T1` : `${y}-T${q + 1}`;
}

function mesAnterior(c: string) {
  const [y, m] = c.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** "2026-T4" → "4º trimestre/2026". */
export function nomeDoTrimestre(t: string) {
  const [y, q] = t.split("-T");
  return `${q}º trimestre/${y}`;
}

const fimDoPeriodo = (g: Pick<Guia, "periodo" | "competencia">) =>
  g.periodo === "mensal" ? ultimoDiaDoMes(g.competencia) : fimDoTrimestre(g.competencia);

function competenciasAte(asOf: string) {
  const out: string[] = [];
  for (let c = PRIMEIRA_COMPETENCIA; c <= mesDe(asOf); c = proximoMes(c)) out.push(c);
  return out;
}

// ---------------------------------------------------------------------------
// Parâmetros e regime (do cadastro, com vigência)
// ---------------------------------------------------------------------------

type ChaveDoParametro =
  | "irpj"
  | "irpj_adicional"
  | "irpj_adicional_limite_mes"
  | "csll"
  | "presuncao_servicos"
  | "presuncao_lc224"
  | "lc224_limite_trimestre"
  | "selic_estimada_mes"
  | "pis_cofins_dia"
  | "retencoes_dia"
  | "credito_pis"
  | "credito_cofins"
  | "darf_minimo";

/** A carga inicial (migrations 20261002100001 e 20261002100300), se faltar a linha no cadastro. */
const PARAMETROS_PADRAO: Record<ChaveDoParametro, number> = {
  irpj: 15,
  irpj_adicional: 10,
  irpj_adicional_limite_mes: 20000,
  csll: 9,
  presuncao_servicos: 32,
  presuncao_lc224: 35.2,
  lc224_limite_trimestre: 1250000,
  selic_estimada_mes: 1.1,
  pis_cofins_dia: 25,
  retencoes_dia: 20,
  credito_pis: 1.65,
  credito_cofins: 7.6,
  darf_minimo: 10,
};

/**
 * O parâmetro vigente na data. Datas usadas: o fim do período para as
 * alíquotas e os dias de vencimento da guia; a emissão da NF para o crédito;
 * o vencimento da cota para a Selic estimada.
 */
const parametro = (cad: CadastroFiscal, chave: ChaveDoParametro, data: string) =>
  parametroVigente(cad, chave, dia(data))?.valor ?? PARAMETROS_PADRAO[chave];

/**
 * Diferença do protótipo: lá só havia lucro real e "presumido" (a Hitlab,
 * pelo caixa). Lucro presumido SEM regime de caixa não foi desenhado; até a
 * regra ser definida, ele segue o mesmo ramo (pelo recebimento) e a guia avisa.
 */
const AVISO_PRESUMIDO_COMPETENCIA =
  "Lucro presumido pela competência: só o regime de caixa foi aprovado, então o cálculo segue o recebimento até a regra ser definida com a contabilidade.";

interface RegimeDaGuia {
  regime: RegimeTributarioPJ;
  /** O ramo do motor do protótipo. */
  ramo: "real" | "presumido";
  avisos: string[];
}

function regimeDaGuia(cad: CadastroFiscal, pj: string, data: string): RegimeDaGuia {
  const r = regimeDaPJ(cad, pj, dia(data));
  if (r.regime === "lucro_real") return { regime: r.regime, ramo: "real", avisos: [] };
  return { regime: r.regime, ramo: "presumido", avisos: r.regime_caixa ? [] : [AVISO_PRESUMIDO_COMPETENCIA] };
}

/** Municípios que permitem compensar o ISS pago a mais (pesquisa de 01/10/2026). */
export const MUNICIPIOS_QUE_COMPENSAM_ISS = new Set(["Salvador"]);

// ---------------------------------------------------------------------------
// Contexto de um cálculo: índices montados uma vez por chamada
// ---------------------------------------------------------------------------

type SituacaoDoCredito = { gera: boolean; estado: "sim" | "nao"; motivo: string };

/**
 * A receita de uma PJ num mês, para o rateio proporcional do crédito de
 * PIS/COFINS (decisão 146): as notas emitidas no mês por todos os CNPJs dela.
 */
export interface ReceitaDoRateio {
  total: number;
  /** A parte no regime cumulativo (o 12.08): é a parte do crédito que sai. */
  cumulativa: number;
  /** Os CNAEs cumulativos dessas notas, pelo subitem quando há ("12.08"). */
  cnaes: string[];
}

interface Contexto {
  cad: CadastroFiscal;
  fatos: FatosFiscais;
  asOf: string;
  feriados: FeriadoDoVencimento[];
  /** Na ordem do cadastro (ordem, nome). */
  estabelecimentos: FiscalEstabelecimento[];
  /** As PJs (empresa_contabil_id), na ordem dos estabelecimentos. */
  pjs: string[];
  estab(id: string): FiscalEstabelecimento;
  pjDoEstab(id: string): string;
  matriz(pj: string): FiscalEstabelecimento;
  /** A guia desta chave já foi aprovada: ela sai mesmo sem fato (decisão 145, item 6). */
  aprovada(chave: string): boolean;
  /** As notas que o sistema já conhecia em `asOf`. */
  conhecidas: NotaSaidaFiscal[];
  /** Uma nota conhecida em `asOf`. */
  nota(id: string): NotaSaidaFiscal | undefined;
  cnae(n: NotaSaidaFiscal): FiscalCnae;
  recebimentosDaNota(id: string): RecebimentoFiscal[];
  credito(nf: NotaFornecedorFiscal): SituacaoDoCredito;
  /** A receita da PJ no mês ("AAAA-MM"), com as notas conhecidas em `asOf`. */
  receitaDoRateio(pj: string, comp: string): ReceitaDoRateio;
}

const vigenteEm = (c: Pick<FiscalCnae, "vigencia_inicio" | "vigencia_fim">, data: string) =>
  c.vigencia_inicio <= data && (c.vigencia_fim === null || c.vigencia_fim >= data);

/** Os CNPJs na ordem do cadastro (ordem, nome). */
const ordenarEstabelecimentos = (lista: readonly FiscalEstabelecimento[]) =>
  [...lista].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));

/** A matriz da PJ; sem matriz no cadastro, o primeiro CNPJ dela na ordem. */
function matrizEntre(estabelecimentos: readonly FiscalEstabelecimento[], pj: string): FiscalEstabelecimento {
  const e =
    estabelecimentos.find((x) => x.empresa_contabil_id === pj && x.papel === "matriz") ??
    estabelecimentos.find((x) => x.empresa_contabil_id === pj);
  if (!e) throw new Error(`A PJ ${pj} não tem CNPJ no cadastro de impostos.`);
  return e;
}

/** A matriz da PJ: é o município dela que vale nos vencimentos federais. */
export const matrizDaPJ = (cad: CadastroFiscal, pj: string) => matrizEntre(ordenarEstabelecimentos(cad.estabelecimentos), pj);

/**
 * O CNAE da nota na versão vigente na emissão: a alíquota que muda ganha
 * linha nova com vigência, e a nota guarda a linha escolhida no Faturar.
 */
function cnaeVigenteNaEmissao(cad: CadastroFiscal, escolhido: FiscalCnae, emissao: string): FiscalCnae {
  const vigente = cad.cnaes
    .filter(
      (c) =>
        c.estabelecimento_id === escolhido.estabelecimento_id &&
        c.codigo === escolhido.codigo &&
        (c.subitem ?? "") === (escolhido.subitem ?? "") &&
        vigenteEm(c, emissao),
    )
    .sort((a, b) => Number(b.ativo) - Number(a.ativo) || b.vigencia_inicio.localeCompare(a.vigencia_inicio))[0];
  return vigente ?? escolhido;
}

/** O CNAE de uma nota com as alíquotas vigentes na emissão: o mesmo que as guias usam. */
export function cnaeNaEmissao(cad: CadastroFiscal, n: Pick<NotaSaidaFiscal, "numero" | "cnae_id" | "emissao">): FiscalCnae {
  const escolhido = cad.cnaes.find((c) => c.id === n.cnae_id);
  if (!escolhido) throw new Error(`O CNAE da NF ${n.numero} não está no cadastro de impostos.`);
  return cnaeVigenteNaEmissao(cad, escolhido, dia(n.emissao));
}

function criarContexto(
  cad: CadastroFiscal,
  fatos: FatosFiscais,
  asOfInformado: string,
  aprovadas: ReadonlySet<string> = new Set(),
): Contexto {
  const asOf = dia(asOfInformado);
  const estabelecimentos = ordenarEstabelecimentos(cad.estabelecimentos);
  const estabPorId = new Map(estabelecimentos.map((e) => [e.id, e]));
  const pjs = [...new Set(estabelecimentos.map((e) => e.empresa_contabil_id))];
  const estab = (id: string) => {
    const e = estabPorId.get(id);
    if (!e) throw new Error(`O CNPJ ${id} não está no cadastro de impostos.`);
    return e;
  };
  const matriz = (pj: string) => matrizEntre(estabelecimentos, pj);

  const conhecidas = fatos.notas.filter((n) => dia(n.conhecida_em) <= asOf);
  const notaPorId = new Map(conhecidas.map((n) => [n.id, n]));

  const cnaePorId = new Map(cad.cnaes.map((c) => [c.id, c]));
  const cnaeDaNota = new Map<string, FiscalCnae>();
  const cnae = (n: NotaSaidaFiscal) => {
    const pronto = cnaeDaNota.get(n.id);
    if (pronto) return pronto;
    const escolhido = cnaePorId.get(n.cnae_id);
    if (!escolhido) throw new Error(`O CNAE da NF ${n.numero} não está no cadastro de impostos.`);
    const c = cnaeVigenteNaEmissao(cad, escolhido, dia(n.emissao));
    cnaeDaNota.set(n.id, c);
    return c;
  };

  const recebimentosPorNota = new Map<string, RecebimentoFiscal[]>();
  for (const r of fatos.recebimentos) {
    const lista = recebimentosPorNota.get(r.nota_id);
    if (lista) lista.push(r);
    else recebimentosPorNota.set(r.nota_id, [r]);
  }

  const creditos = new Map<string, SituacaoDoCredito>();
  const receitas = new Map<string, ReceitaDoRateio>();
  const ctx: Contexto = {
    cad,
    fatos,
    asOf,
    aprovada: (chave: string) => aprovadas.has(chave),
    feriados: feriadosDoCalculo(cad),
    estabelecimentos,
    pjs,
    estab,
    pjDoEstab: (id) => estab(id).empresa_contabil_id,
    matriz,
    conhecidas,
    nota: (id) => notaPorId.get(id),
    cnae,
    recebimentosDaNota: (id) => recebimentosPorNota.get(id) ?? [],
    credito: (nf) => {
      let s = creditos.get(nf.id);
      if (!s) {
        s = situacaoDoCredito(ctx, nf);
        creditos.set(nf.id, s);
      }
      return s;
    },
    receitaDoRateio: (pj, comp) => {
      const k = `${pj}|${comp}`;
      let r = receitas.get(k);
      if (!r) {
        r = receitaDoRateio(ctx, pj, comp);
        receitas.set(k, r);
      }
      return r;
    },
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// Crédito de PIS/COFINS da NF do fornecedor
// ---------------------------------------------------------------------------

/**
 * A regra do protótipo (`situacaoCredito`), com a "Hitlab" generalizada para
 * "o CNPJ tomador está no lucro presumido" e o "sem crédito" vindo da
 * aprovação da PP. Diferença do protótipo (decisão 146, 04/10/2026): o job
 * não entra mais na regra. Lá, o custo do job faturado no 12.08 não dava
 * crédito (e o de mês anterior era estornado no mês da nota); mas nada nos
 * documentos fiscais liga a NF do fornecedor à nota de saída, e a lei só
 * aceita a apropriação direta com contabilidade de custos integrada à
 * escrituração (Lei 10.833/2003, art. 3º, § 8º, I). Toda NF de fornecedor PJ
 * dá o crédito cheio, e a guia do mês tira a parte do 12.08 pelo rateio
 * proporcional (`receitaDoRateio`).
 */
function situacaoDoCredito(ctx: Contexto, nf: NotaFornecedorFiscal): SituacaoDoCredito {
  const pjTomadora = ctx.pjDoEstab(nf.tomador_estabelecimento_id);
  if (regimeDaPJ(ctx.cad, pjTomadora, dia(nf.emissao)).regime === "lucro_presumido")
    return { gera: false, estado: "nao", motivo: "O CNPJ tomador está no lucro presumido: PIS/COFINS cumulativos, sem crédito." };
  if (nf.sem_credito) {
    const motivo = nf.motivo_sem_credito?.trim().replace(/\.+$/, "");
    return {
      gera: false,
      estado: "nao",
      motivo: motivo ? `Marcado pelo financeiro como sem crédito: ${motivo}.` : "Marcado pelo financeiro como sem crédito.",
    };
  }
  return {
    gera: true,
    estado: "sim",
    motivo: "Fornecedor PJ com NF: crédito no mês da emissão, menos a parte da receita do mês no 12.08 (rateio proporcional).",
  };
}

/** A situação do crédito de PIS/COFINS de uma NF de fornecedor, vista em `asOf`. */
export function situacaoDoCreditoDaNF(
  cad: CadastroFiscal,
  fatos: FatosFiscais,
  nf: NotaFornecedorFiscal,
  asOf: string,
): { gera: boolean; estado: "sim" | "nao"; motivo: string } {
  return situacaoDoCredito(criarContexto(cad, fatos, asOf), nf);
}

/** Alíquota cheia do crédito (PIS + COFINS) na emissão da NF. */
const aliquotaDoCredito = (cad: CadastroFiscal, nf: NotaFornecedorFiscal) =>
  parametro(cad, "credito_pis", nf.emissao) + parametro(cad, "credito_cofins", nf.emissao);

/**
 * A receita da PJ no mês para o rateio proporcional do crédito (decisão 146;
 * Lei 10.637/2002 e Lei 10.833/2003, art. 3º, § 8º, II): o custo é comum às
 * duas receitas, e o crédito fica na proporção da receita não cumulativa na
 * receita bruta total do mês. A receita é a das notas emitidas no mês, em
 * todos os CNPJs da PJ; a cumulativa, a das notas em CNAE cumulativo (o
 * 12.08). Sem receita cumulativa no mês (inclusive sem receita nenhuma), o
 * crédito fica inteiro.
 */
function receitaDoRateio(ctx: Contexto, pj: string, comp: string): ReceitaDoRateio {
  let total = 0;
  let cumulativa = 0;
  const cnaes: string[] = [];
  for (const n of ctx.conhecidas) {
    if (ctx.pjDoEstab(n.estabelecimento_id) !== pj || mesDe(n.emissao) !== comp) continue;
    total += n.valor;
    const c = ctx.cnae(n);
    if (!c.cumulativo) continue;
    cumulativa += n.valor;
    const rotulo = c.subitem ?? c.codigo;
    if (!cnaes.includes(rotulo)) cnaes.push(rotulo);
  }
  return { total: r2(total), cumulativa: r2(cumulativa), cnaes };
}

/** A fração do crédito que sai pelo rateio: a receita cumulativa sobre a total (0 sem receita). */
const parteQueSai = (r: ReceitaDoRateio) => (r.total > 0 ? r.cumulativa / r.total : 0);

// ---------------------------------------------------------------------------
// Rateio por empresa gerencial e regional
// ---------------------------------------------------------------------------

interface Peso {
  job: JobDoFato;
  peso: number;
}

/**
 * Os pesos de uma nota no rateio. Diferença do protótipo: a nota pode cobrir
 * vários jobs, e cada um pesa pela sua parte (`jobs[].valor`).
 */
function pesosDaNota(n: NotaSaidaFiscal, valor: number): Peso[] {
  if (n.jobs.length === 1) return [{ job: n.jobs[0], peso: valor }];
  const soma = n.jobs.reduce((s, j) => s + j.valor, 0);
  if (soma <= 0) return [];
  return n.jobs.map((j) => ({ job: j, peso: (valor * j.valor) / soma }));
}

function rateioPor(pesos: Peso[], total: number): RateioDaGuia[] {
  const grupos = new Map<string, Peso>();
  for (const p of pesos) {
    const k = `${p.job.empresa_id}|${p.job.regional_id ?? ""}`;
    const g = grupos.get(k);
    if (g) g.peso += p.peso;
    else grupos.set(k, { job: p.job, peso: p.peso });
  }
  const lista = [...grupos.values()].filter((x) => x.peso > 0).sort((a, b) => b.peso - a.peso);
  const soma = lista.reduce((s, x) => s + x.peso, 0);
  if (!soma) return [];
  let acumulado = 0;
  return lista.map((x, i) => {
    const valor = i === lista.length - 1 ? r2(total - acumulado) : r2((total * x.peso) / soma);
    acumulado = r2(acumulado + valor);
    return {
      empresa_id: x.job.empresa_id,
      empresa_nome: x.job.empresa_nome,
      regional_id: x.job.regional_id,
      regional_nome: x.job.regional_nome,
      valor,
      pct: r2((x.peso / soma) * 100),
    };
  });
}

/**
 * O rateio da guia levado a outro total (o valor da guia aprovada, a cota com
 * juros, a complementar). Diferença do protótipo: se o rateio da guia está
 * zerado (apurado zero) e o título tem valor, reparte pelo percentual em vez
 * de zerar.
 */
export function escalarRateio(rateio: RateioDaGuia[], total: number): RateioDaGuia[] {
  const somaValor = rateio.reduce((s, x) => s + x.valor, 0);
  const somaPct = rateio.reduce((s, x) => s + x.pct, 0);
  const peso = somaValor ? (x: RateioDaGuia) => x.valor / somaValor : somaPct ? (x: RateioDaGuia) => x.pct / somaPct : null;
  if (!peso) return rateio.map((x) => ({ ...x, valor: 0 }));
  let acumulado = 0;
  return rateio.map((x, i) => {
    const valor = i === rateio.length - 1 ? r2(total - acumulado) : r2(peso(x) * total);
    acumulado = r2(acumulado + valor);
    return { ...x, valor };
  });
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/** 1.65 → "1,65"; 15 → "15". */
const pct = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const r4 = (v: number) => Math.round((v + Number.EPSILON) * 10000) / 10000;

/** ["São Paulo", "Fortaleza"] → "São Paulo e Fortaleza". */
function juntar(itens: string[]) {
  return itens.length <= 1 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** "NF 2051 · TES-1101/26 Lançamento Verão"; com vários jobs, só os códigos. */
export function comJobs(prefixo: string, n: Pick<NotaSaidaFiscal, "jobs">) {
  if (!n.jobs.length) return prefixo;
  if (n.jobs.length === 1) return `${prefixo} · ${n.jobs[0].codigo} ${n.jobs[0].nome}`;
  return `${prefixo} · ${juntar(n.jobs.map((j) => j.codigo))}`;
}

/** O `job_id` do item só quando a nota é de um job só. */
const jobDaNota = (n: NotaSaidaFiscal): { job_id?: string } => (n.jobs.length === 1 ? { job_id: n.jobs[0].job_id } : {});

function textoDaRegra(regra: RegraDoVencimento) {
  if (regra === "antecipa") return "em dia não útil, antecipa";
  if (regra === "prorroga") return "em dia não útil, prorroga";
  return "em dia não útil, vale o dia útil anterior";
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** 20000 → "R$ 20 mil"; 5000000 → "R$ 5 milhões"; o resto, em reais. */
function valorCurto(v: number) {
  if (v >= 1e6 && v % 1e6 === 0) return `R$ ${pct(v / 1e6)} ${v === 1e6 ? "milhão" : "milhões"}`;
  if (v >= 1000 && v % 1000 === 0) return `R$ ${pct(v / 1000)} mil`;
  return formatBRL(v);
}

/** "California · Salvador" → "California". */
const nomeDaMatriz = (m: FiscalEstabelecimento) => m.nome.split(" · ")[0].trim() || m.nome;

/**
 * O nome da PJ, tirado do nome da matriz ("California · Salvador" →
 * "California"): o cadastro de impostos não traz `empresas_contabeis`.
 */
export const nomeDaPJ = (cad: CadastroFiscal, pj: string) => nomeDaMatriz(matrizDaPJ(cad, pj));

/** "Federal · California (matriz, soma São Paulo e Fortaleza)". */
function localFederal(ctx: Contexto, pj: string, comFiliais: boolean) {
  const nome = nomeDaMatriz(ctx.matriz(pj));
  const filiais = comFiliais
    ? ctx.estabelecimentos.filter((e) => e.empresa_contabil_id === pj && e.papel === "filial" && e.ativo).map((e) => e.municipio)
    : [];
  return filiais.length ? `Federal · ${nome} (matriz, soma ${juntar(filiais)})` : `Federal · ${nome}`;
}

const somaDaMemoria = (memoria: ItemMemoria[]) => r2(memoria.reduce((s, i) => s + i.valor, 0));

// ---------------------------------------------------------------------------
// ISS próprio, por CNPJ emissor e mês (pela emissão da nota)
// ---------------------------------------------------------------------------

function guiaIss(
  ctx: Contexto,
  e: FiscalEstabelecimento,
  comp: string,
  aprov: AprovacaoFiscal | undefined,
  livres: ARecuperar[],
): Guia | null {
  const notas = ctx.conhecidas.filter((n) => n.estabelecimento_id === e.id && mesDe(n.emissao) === comp);
  // Depois de aprovada a guia, o ISS que o cliente reteve vira ISS a recuperar.
  const limiteRetido = aprov ? dia(aprov.data) : ctx.asOf;
  const memoria: ItemMemoria[] = [];
  const pesos: Peso[] = [];
  let base = 0;
  for (const n of notas) {
    const c = ctx.cnae(n);
    const aliquota = c.aliquota_iss ?? 0;
    base += n.valor;
    // A nota registrada num mês depois da emissão (retroativa) diz quando entrou.
    const registrada = mesDe(n.conhecida_em) > mesDe(n.emissao) ? ` · registrada em ${dataBr(n.conhecida_em)}` : "";
    memoria.push({
      grupo: "debito",
      rotulo: comJobs(`NF ${n.numero}`, n),
      detalhe: `${codigoDoCnae(c)}${registrada}`,
      base: n.valor,
      aliquota,
      valor: r2((n.valor * aliquota) / 100),
      ...jobDaNota(n),
      nota_id: n.id,
    });
    pesos.push(...pesosDaNota(n, n.valor));
    for (const r of ctx.recebimentosDaNota(n.id)) {
      const iss = r.retido.ISS;
      if (!iss || dia(r.data) > limiteRetido || dia(r.data) > ctx.asOf) continue;
      memoria.push({
        grupo: "retido",
        rotulo: `ISS retido pelo cliente · NF ${n.numero}`,
        detalhe: `recebida em ${dataBr(r.data)} · quem recolhe é o cliente`,
        valor: -iss,
        nota_id: n.id,
      });
    }
  }
  const aCompensar = livres.filter((a) => a.estabelecimento_id === e.id && a.forma === "compensar");
  let compensacoes: ARecuperar[] | undefined;
  if (aCompensar.length && (!aprov || aprov.compensacoes_usadas.length)) {
    compensacoes = aprov ? aCompensar.filter((a) => aprov.compensacoes_usadas.includes(a.id)) : aCompensar;
    for (const a of compensacoes)
      memoria.push({
        grupo: "compensacao",
        rotulo: `ISS a compensar · NF ${ctx.nota(a.nota_id)?.numero ?? "—"}`,
        detalhe: `o cliente reteve em ${dataBr(a.data)}, depois de paga a guia de ${nomeDoMes(a.competencia_nota)}`,
        valor: -a.valor,
        nota_id: a.nota_id,
      });
  }
  if (!memoria.length && !ctx.aprovada(`iss|${e.id}|${comp}`)) return null;
  const soma = somaDaMemoria(memoria);
  const v = vencimentoNoMesSeguinte(comp, e.iss_dia, e.iss_regra, ctx.feriados, e.municipio);
  return {
    chave: `iss|${e.id}|${comp}`,
    tributo: "ISS",
    titulo: "ISS próprio",
    codigo: null,
    empresa_contabil_id: e.empresa_contabil_id,
    estabelecimento_id: e.id,
    local: `${e.municipio}-${e.uf}`,
    competencia: comp,
    rotulo_competencia: nomeDoMes(comp),
    periodo: "mensal",
    vencimento: v.data,
    vencimento_motivo: v.motivo,
    regra_vencimento: `dia ${e.iss_dia} do mês seguinte · ${textoDaRegra(e.iss_regra)}`,
    memoria,
    apurado: Math.max(0, soma),
    saldo_credor_gerado: 0,
    base: r2(base),
    rateio: rateioPor(pesos, Math.max(0, soma)),
    // A observação do vencimento no cadastro ("dia 20 ... a confirmar"), como o "aConfirmar" do protótipo.
    avisos: e.observacao ? [e.observacao] : [],
    ...(compensacoes ? { compensacoes } : {}),
  };
}

// ---------------------------------------------------------------------------
// PIS e COFINS, por PJ e mês (pela matriz, somando as filiais)
// ---------------------------------------------------------------------------

/**
 * PIS ou COFINS de um recebimento no lucro presumido pelo caixa: o bruto
 * recebido na alíquota do CNAE da nota (`cnaeNaEmissao`).
 */
export function debitoNoCaixa(c: Pick<FiscalCnae, "aliquota_pis" | "aliquota_cofins">, tributo: "PIS" | "COFINS", bruto: number) {
  return r2((bruto * (tributo === "PIS" ? c.aliquota_pis : c.aliquota_cofins)) / 100);
}

/** O dia `pis_cofins_dia` vigente no último dia do mês, no mês seguinte, antecipando o dia não útil. */
function vencimentoPisCofins(
  cad: CadastroFiscal,
  comp: string,
  municipio: string,
  feriados: readonly FeriadoDoVencimento[],
): Vencimento & { dia: number } {
  const diaDoVencimento = parametro(cad, "pis_cofins_dia", ultimoDiaDoMes(comp));
  return { ...vencimentoNoMesSeguinte(comp, diaDoVencimento, "antecipa", feriados, municipio), dia: diaDoVencimento };
}

/**
 * O vencimento do PIS e da COFINS de uma PJ numa competência, o mesmo da
 * guia: o dia `pis_cofins_dia` vigente no último dia do mês, no mês
 * seguinte, antecipando o dia não útil, no município da matriz e com os
 * feriados do cadastro.
 */
export const vencimentoDoPisCofins = (cad: CadastroFiscal, pj: string, comp: string) =>
  vencimentoPisCofins(cad, comp, matrizDaPJ(cad, pj).municipio, feriadosDoCalculo(cad));

/**
 * A parte do PIS/COFINS de uma PJ que a guia cobre. No lucro real, a receita
 * do regime cumulativo (o 12.08) se recolhe em DARF próprio (8109 e 2172), e
 * o crédito só se desconta do valor apurado no não cumulativo (Lei
 * 10.833/2003, art. 3º, caput: "do valor apurado na forma do art. 2º"):
 * duas guias (decisão 144). No presumido tudo é cumulativo: uma guia só.
 */
export type ParteDoPisCofins = "toda" | "nao_cumulativa" | "cumulativa";

/** A chave da guia de PIS/COFINS: a parte cumulativa do lucro real é `pis_cum|…` e `cofins_cum|…`. */
export const chaveDoPisCofins = (tributo: "PIS" | "COFINS", pj: string, comp: string, parte: ParteDoPisCofins = "toda") =>
  `${tributo.toLowerCase()}${parte === "cumulativa" ? "_cum" : ""}|${pj}|${comp}`;

function guiaPisCofins(
  ctx: Contexto,
  pj: string,
  comp: string,
  tributo: "PIS" | "COFINS",
  parte: ParteDoPisCofins,
  saldoAnterior: number,
): Guia | null {
  const fim = ultimoDiaDoMes(comp);
  const reg = regimeDaGuia(ctx.cad, pj, fim);
  const cumulativa = parte === "cumulativa";
  const aliquotaDaNota = (c: FiscalCnae) => (tributo === "PIS" ? c.aliquota_pis : c.aliquota_cofins);
  const aliquotaDoCreditoDoTributo = (nf: NotaFornecedorFiscal) =>
    parametro(ctx.cad, tributo === "PIS" ? "credito_pis" : "credito_cofins", nf.emissao);
  /** A nota é desta guia: na parte cumulativa só o CNAE cumulativo; na não cumulativa, o resto. */
  const daParte = (n: NotaSaidaFiscal) => parte === "toda" || ctx.cnae(n).cumulativo === cumulativa;
  const memoria: ItemMemoria[] = [];
  const pesos: Peso[] = [];
  // Guia não cumulativa sem nota no mês (só crédito, ou só nota do 12.08): o
  // rateio vai pelos jobs dos custos com crédito — a aprovação precisa dele
  // quando a guia da contabilidade vem com valor.
  const pesosDosCreditos: Peso[] = [];
  let base = 0;
  // O crédito do mês, já sem a parte do 12.08: o aviso de saldo credor olha.
  let creditoLiquido = 0;

  if (reg.ramo === "real") {
    for (const n of ctx.conhecidas) {
      if (ctx.pjDoEstab(n.estabelecimento_id) !== pj || mesDe(n.emissao) !== comp || !daParte(n)) continue;
      const c = ctx.cnae(n);
      const a = aliquotaDaNota(c);
      base += n.valor;
      memoria.push({
        grupo: "debito",
        rotulo: comJobs(`NF ${n.numero}`, n),
        detalhe: `${ctx.estab(n.estabelecimento_id).nome} · ${codigoDoCnae(c)}${c.cumulativo ? " · regime cumulativo, sem crédito" : ""}`,
        base: n.valor,
        aliquota: a,
        valor: r2((n.valor * a) / 100),
        ...jobDaNota(n),
        nota_id: n.id,
      });
      pesos.push(...pesosDaNota(n, n.valor));
    }
  }
  if (reg.ramo === "real" && !cumulativa) {
    // Créditos: custos com NF de fornecedor emitida no mês, pelo valor cheio.
    let creditoCheio = 0;
    for (const nf of ctx.fatos.notasFornecedor) {
      if (ctx.pjDoEstab(nf.tomador_estabelecimento_id) !== pj || mesDe(nf.emissao) !== comp || dia(nf.emissao) > ctx.asOf) continue;
      const s = ctx.credito(nf);
      const j = nf.job;
      if (!s.gera) {
        memoria.push({ grupo: "info", rotulo: `${nf.pp} · NF ${nf.numero} · ${j.codigo}`, detalhe: s.motivo, base: nf.valor, valor: 0, job_id: j.job_id, pp: nf.pp });
        continue;
      }
      const a = aliquotaDoCreditoDoTributo(nf);
      const valor = r2((nf.valor * a) / 100);
      creditoCheio = r2(creditoCheio + valor);
      pesosDosCreditos.push({ job: j, peso: valor });
      memoria.push({
        grupo: "credito",
        rotulo: `${nf.pp} · NF ${nf.numero} · ${j.codigo} ${j.nome}`,
        detalhe: `crédito sobre custo · emitida em ${dataBr(nf.emissao)}`,
        base: nf.valor,
        aliquota: a,
        valor: -valor,
        job_id: j.job_id,
        pp: nf.pp,
      });
    }
    // Rateio proporcional (decisão 146): a parte da receita do mês no 12.08 sai do crédito.
    const receita = ctx.receitaDoRateio(pj, comp);
    const sai = r2(creditoCheio * parteQueSai(receita));
    if (sai > 0)
      memoria.push({
        grupo: "rateio_credito",
        rotulo: `Parte do ${juntar(receita.cnaes)} na receita do mês`,
        detalhe: `${formatBRL(receita.cumulativa)} de ${formatBRL(receita.total)} emitidos em ${nomeDoMes(comp)}: essa parte do crédito sai (${tributo === "PIS" ? "Lei 10.637/2002" : "Lei 10.833/2003"}, art. 3º, § 8º, II)`,
        base: creditoCheio,
        aliquota: r4(parteQueSai(receita) * 100),
        valor: sai,
      });
    creditoLiquido = r2(creditoCheio - sai);
  } else if (reg.ramo !== "real") {
    // Presumido pelo caixa: o que entrou no mês, pelo bruto, na alíquota do CNAE da nota.
    for (const r of ctx.fatos.recebimentos) {
      if (mesDe(r.data) !== comp || dia(r.data) > ctx.asOf) continue;
      const n = ctx.nota(r.nota_id);
      if (!n || ctx.pjDoEstab(n.estabelecimento_id) !== pj) continue;
      const c = ctx.cnae(n);
      base += r.bruto;
      memoria.push({
        grupo: "debito",
        rotulo: comJobs(`Recebimento da NF ${n.numero}`, n),
        detalhe: `recebido em ${dataBr(r.data)} · regime de caixa`,
        base: r.bruto,
        aliquota: aliquotaDaNota(c),
        valor: debitoNoCaixa(c, tributo, r.bruto),
        ...jobDaNota(n),
        nota_id: n.id,
      });
      pesos.push(...pesosDaNota(n, r.bruto));
    }
  }

  // Retenções sofridas no mês (o cliente reteve ao pagar): abatem a guia da
  // parte da nota retida (no lucro real, a do 12.08 abate a cumulativa).
  for (const r of ctx.fatos.recebimentos) {
    if (mesDe(r.data) !== comp || dia(r.data) > ctx.asOf) continue;
    const n = ctx.nota(r.nota_id);
    if (!n || ctx.pjDoEstab(n.estabelecimento_id) !== pj || !daParte(n)) continue;
    const v = r.retido[tributo];
    if (!v) continue;
    memoria.push({
      grupo: "retido",
      rotulo: `${tributo} ${tributo === "PIS" ? "retido" : "retida"} pelo cliente · NF ${n.numero}`,
      detalhe: `recebida em ${dataBr(r.data)} · antecipação do imposto`,
      valor: -v,
      nota_id: n.id,
    });
  }
  // Na parte cumulativa não há crédito: o saldo que passa de mês é retenção não usada.
  if (saldoAnterior > 0)
    memoria.push({
      grupo: "saldo",
      rotulo: `${cumulativa ? "Saldo" : "Saldo credor"} de ${nomeDoMes(mesAnterior(comp))}`,
      detalhe: cumulativa ? "retenção que passou do mês anterior" : "crédito que passou do mês anterior",
      valor: -saldoAnterior,
    });
  if (!memoria.length && !ctx.aprovada(chaveDoPisCofins(tributo, pj, comp, parte))) return null;

  const soma = somaDaMemoria(memoria);
  const v = vencimentoPisCofins(ctx.cad, comp, ctx.matriz(pj).municipio, ctx.feriados);
  const avisos = [...reg.avisos];
  // No não cumulativo, o saldo é de crédito quando há crédito no mês (já sem a parte do 12.08) ou vindo do anterior.
  const sobraDeCredito = !cumulativa && (creditoLiquido > 0 || saldoAnterior > 0);
  if (soma < 0)
    avisos.push(
      `${sobraDeCredito ? "Crédito maior" : "Retenção maior"} que o débito: ${formatBRL(-soma)} passam para ${nomeDoMes(proximoMes(comp))}.`,
    );
  return {
    chave: chaveDoPisCofins(tributo, pj, comp, parte),
    tributo,
    titulo: cumulativa ? (tributo === "PIS" ? "PIS cumulativo" : "COFINS cumulativa") : tributo,
    codigo: codigoDarf(tributo, reg.regime, { cumulativo: cumulativa }),
    empresa_contabil_id: pj,
    estabelecimento_id: null,
    local: localFederal(ctx, pj, true),
    competencia: comp,
    rotulo_competencia: nomeDoMes(comp),
    periodo: "mensal",
    vencimento: v.data,
    vencimento_motivo: v.motivo,
    regra_vencimento: `dia ${v.dia} do mês seguinte · em dia não útil, antecipa`,
    memoria,
    apurado: Math.max(0, soma),
    saldo_credor_gerado: soma < 0 ? -soma : 0,
    base: r2(base),
    rateio: rateioPor(pesos.length ? pesos : pesosDosCreditos, Math.max(0, soma)),
    avisos,
  };
}

// ---------------------------------------------------------------------------
// IRPJ e CSLL, por PJ e trimestre, em cotas
// ---------------------------------------------------------------------------

/**
 * As cotas do IRPJ/CSLL (Lei 9.430/1996, art. 5º): até 3, no último dia útil
 * de cada mês do trimestre seguinte; cota mínima de R$ 1.000 e, abaixo de
 * R$ 2.000, cota única. A 2ª leva 1% e a 3ª a Selic estimada + 1%.
 */
export function cotasDe(total: number, trimestre: string, cidade: string, cad: CadastroFiscal): Cota[] {
  const meses = mesesDoTrimestre(proximoTrimestre(trimestre));
  const feriados = feriadosDoCalculo(cad);
  let n = 3;
  if (total < 2000) n = 1;
  else if (total / 3 < 1000) n = total / 2 >= 1000 ? 2 : 1;
  const parte = r2(total / n);
  return Array.from({ length: n }, (_, i) => {
    const vencimento = ajustarVencimento(ultimoDiaDoMes(meses[i]), "ultimo_util", feriados, cidade).data;
    const principal = i === n - 1 ? r2(total - parte * (n - 1)) : parte;
    const jurosPct = i === 0 ? 0 : i === 1 ? 1 : r2(parametro(cad, "selic_estimada_mes", vencimento) + 1);
    return { numero: i + 1, vencimento, principal, jurosPct, juros: r2((principal * jurosPct) / 100) };
  });
}

function guiasIrpjCsll(ctx: Contexto, pj: string, t: string): Guia[] {
  const meses = mesesDoTrimestre(t);
  const dentro = (d: string) => meses.includes(mesDe(d));
  const fim = fimDoTrimestre(t);
  const p = (chave: ChaveDoParametro) => parametro(ctx.cad, chave, fim);
  const reg = regimeDaGuia(ctx.cad, pj, fim);
  const memIr: ItemMemoria[] = [];
  const memCs: ItemMemoria[] = [];
  const pesos: Peso[] = [];
  const avisos = [...reg.avisos];
  let baseIr = 0;
  let baseCs = 0;
  let receitaRef = 0;

  if (reg.ramo === "real") {
    const notas = ctx.conhecidas.filter((n) => ctx.pjDoEstab(n.estabelecimento_id) === pj && dentro(n.emissao));
    let receita = 0;
    let iss = 0;
    let pis = 0;
    let cofins = 0;
    for (const n of notas) {
      const c = ctx.cnae(n);
      receita += n.valor;
      iss += (n.valor * (c.aliquota_iss ?? 0)) / 100;
      pis += (n.valor * c.aliquota_pis) / 100;
      cofins += (n.valor * c.aliquota_cofins) / 100;
      pesos.push(...pesosDaNota(n, n.valor));
    }
    const custos = ctx.fatos.notasFornecedor.filter(
      (nf) => ctx.pjDoEstab(nf.tomador_estabelecimento_id) === pj && dentro(nf.emissao) && dia(nf.emissao) <= ctx.asOf,
    );
    let custo = 0;
    let creditos = 0;
    // Os CNAEs cujo rateio tirou crédito no trimestre (decisão 146): o detalhe da linha diz.
    const rateados: string[] = [];
    for (const nf of custos) {
      custo += nf.valor;
      if (!ctx.credito(nf).gera) continue;
      // O crédito de cada mês, menos a parte da receita do mês no 12.08 (como nas guias de PIS/COFINS).
      const receitaDoMes = ctx.receitaDoRateio(pj, mesDe(nf.emissao));
      const sai = parteQueSai(receitaDoMes);
      creditos += ((nf.valor * aliquotaDoCredito(ctx.cad, nf)) / 100) * (1 - sai);
      if (sai > 0) for (const c of receitaDoMes.cnaes) if (!rateados.includes(c)) rateados.push(c);
    }
    receita = r2(receita);
    iss = r2(iss);
    pis = r2(pis);
    cofins = r2(cofins);
    custo = r2(custo);
    creditos = r2(creditos);
    const receitaLiquida = r2(receita - iss - pis - cofins);
    const custoLiquido = r2(custo - creditos);
    const lucro = r2(receitaLiquida - custoLiquido);
    receitaRef = receita;
    const linhas: ItemMemoria[] = [
      { grupo: "base", rotulo: "Faturamento do trimestre", detalhe: plural(notas.length, "nota emitida", "notas emitidas"), valor: receita },
      {
        grupo: "base",
        rotulo: "(−) ISS, PIS e COFINS das notas",
        detalhe: `ISS ${formatBRL(iss)} · PIS ${formatBRL(pis)} · COFINS ${formatBRL(cofins)}`,
        valor: -r2(iss + pis + cofins),
      },
      { grupo: "base", rotulo: "(=) Receita líquida", valor: receitaLiquida },
      {
        grupo: "base",
        rotulo: "(−) Custo dos jobs",
        detalhe: `${plural(custos.length, "NF de fornecedor emitida", "NFs de fornecedor emitidas")} no trimestre`,
        valor: -custo,
      },
      {
        grupo: "base",
        rotulo: "(+) Créditos de PIS/COFINS sobre o custo",
        detalhe: `o crédito volta para a agência: o custo de verdade é menor${
          rateados.length ? ` · sem a parte do ${juntar(rateados)} na receita (rateio proporcional)` : ""
        }`,
        valor: creditos,
      },
      {
        grupo: "base",
        rotulo: "(=) Lucro bruto do trimestre",
        detalhe: "estimativa · o Lucro Real também desconta folha, aluguel e outras despesas; a guia da contabilidade fecha a diferença",
        valor: lucro,
      },
    ];
    memIr.push(...linhas.map((l) => ({ ...l })));
    memCs.push(...linhas.map((l) => ({ ...l })));
    baseIr = baseCs = Math.max(0, lucro);
    if (lucro <= 0)
      avisos.push(
        "Lucro bruto do trimestre negativo: IRPJ e CSLL ficam zerados. A compensação de prejuízo entra como ajuste justificado na aprovação.",
      );
  }
  const aliquotaIrpj = p("irpj");
  const aliquotaAdicional = p("irpj_adicional");
  const aliquotaCsll = p("csll");
  const limiteMes = p("irpj_adicional_limite_mes");
  const limite = limiteMes * 3;
  // O IRPJ (15% + adicional) e a CSLL de uma base presumida: as contas do ajuste do ano da LC 224.
  const impostoDaBase = (tributo: "IRPJ" | "CSLL", base: number) =>
    tributo === "IRPJ"
      ? r2((base * aliquotaIrpj) / 100 + (Math.max(0, base - limite) * aliquotaAdicional) / 100)
      : r2((base * aliquotaCsll) / 100);
  let deducaoIr = 0;
  let deducaoCs = 0;
  const avisosIr: string[] = [];
  const avisosCs: string[] = [];

  if (reg.ramo !== "real") {
    const recebimentos = ctx.fatos.recebimentos.filter((r) => {
      if (!dentro(r.data) || dia(r.data) > ctx.asOf) return false;
      const n = ctx.nota(r.nota_id);
      return !!n && ctx.pjDoEstab(n.estabelecimento_id) === pj;
    });
    const recebido = r2(recebimentos.reduce((s, r) => s + r.bruto, 0));
    for (const r of recebimentos) pesos.push(...pesosDaNota(ctx.nota(r.nota_id)!, r.bruto));
    receitaRef = recebido;
    const presuncao = p("presuncao_servicos");
    const presuncaoLc224 = p("presuncao_lc224");
    const baseDe = (receita: number, excesso: number) =>
      r2(((receita - excesso) * presuncao) / 100 + (excesso * presuncaoLc224) / 100);
    for (const tributo of ["IRPJ", "CSLL"] as const) {
      const lc = lc224DoTrimestre(ctx, pj, t, tributo, recebido);
      const acima = lc.excesso;
      const ate = r2(recebido - acima);
      const base = baseDe(recebido, acima);
      const mem = tributo === "IRPJ" ? memIr : memCs;
      mem.push({
        grupo: "base",
        rotulo: "Recebido no trimestre (regime de caixa)",
        detalhe: `${plural(recebimentos.length, "recebimento", "recebimentos")}, pelo bruto`,
        valor: recebido,
      });
      mem.push(...lc.linhas);
      mem.push({
        grupo: "base",
        rotulo:
          lc.limite === null
            ? `Presunção de ${pct(presuncao)}%`
            : lc.completo
              ? `Presunção de ${pct(presuncao)}% até o limite`
              : `Presunção de ${pct(presuncao)}% até ${formatBRL(lc.limite)}`,
        base: ate,
        aliquota: presuncao,
        valor: r2((ate * presuncao) / 100),
      });
      if (acima > 0)
        mem.push({
          grupo: "base",
          rotulo: lc.completo
            ? `Presunção de ${pct(presuncaoLc224)}% sobre o que passa do limite (LC 224/2025)`
            : `Presunção de ${pct(presuncaoLc224)}% acima de ${formatBRL(lc.limite ?? lc.lt)} (LC 224/2025)`,
          detalhe: `acréscimo de ${pct(r2((presuncaoLc224 / presuncao - 1) * 100))}% na presunção sobre a receita acima de ${valorCurto(lc.lt * 4)} por ano, controlada por trimestre`,
          base: acima,
          aliquota: presuncaoLc224,
          valor: r2((acima * presuncaoLc224) / 100),
        });
      mem.push({ grupo: "base", rotulo: "(=) Base presumida", valor: base });
      // 4º trimestre: o acréscimo pago a mais nos trimestres anteriores volta como dedução (§5º).
      const deducao = r2(
        lc.recalculos.reduce(
          (soma, x) => soma + impostoDaBase(tributo, baseDe(x.receita, x.excessoPago)) - impostoDaBase(tributo, baseDe(x.receita, x.excessoDevido)),
          0,
        ),
      );
      if (tributo === "IRPJ") {
        baseIr = base;
        deducaoIr = deducao;
        avisosIr.push(...lc.avisos);
      } else {
        baseCs = base;
        deducaoCs = deducao;
        avisosCs.push(...lc.avisos);
      }
    }
  }

  const ir15 = r2((baseIr * aliquotaIrpj) / 100);
  const adicional = r2((Math.max(0, baseIr - limite) * aliquotaAdicional) / 100);
  memIr.push({ grupo: "debito", rotulo: `IRPJ ${pct(aliquotaIrpj)}%`, base: baseIr, aliquota: aliquotaIrpj, valor: ir15 });
  memIr.push({
    grupo: "debito",
    rotulo: `Adicional de ${pct(aliquotaAdicional)}%`,
    detalhe: `só sobre o que passa de ${formatBRL(limite)} no trimestre (${valorCurto(limiteMes)} por mês)`,
    base: Math.max(0, r2(baseIr - limite)),
    aliquota: aliquotaAdicional,
    valor: adicional,
  });
  memCs.push({ grupo: "debito", rotulo: `CSLL ${pct(aliquotaCsll)}%`, base: baseCs, aliquota: aliquotaCsll, valor: r2((baseCs * aliquotaCsll) / 100) });

  // Retenções sofridas no trimestre: o IRRF abate só o IRPJ de 15%, nunca o adicional.
  let irrf = 0;
  let csllRetida = 0;
  for (const r of ctx.fatos.recebimentos) {
    if (!dentro(r.data) || dia(r.data) > ctx.asOf) continue;
    const n = ctx.nota(r.nota_id);
    if (!n || ctx.pjDoEstab(n.estabelecimento_id) !== pj) continue;
    if (r.retido.IRRF) {
      irrf += r.retido.IRRF;
      memIr.push({ grupo: "retido", rotulo: `IRRF retido pelo cliente · NF ${n.numero}`, detalhe: `recebida em ${dataBr(r.data)}`, valor: -r.retido.IRRF, nota_id: n.id });
    }
    if (r.retido.CSLL) {
      csllRetida += r.retido.CSLL;
      memCs.push({ grupo: "retido", rotulo: `CSLL retida pelo cliente · NF ${n.numero}`, detalhe: `recebida em ${dataBr(r.data)}`, valor: -r.retido.CSLL, nota_id: n.id });
    }
  }
  let irDevido = r2(Math.max(0, ir15 - irrf) + adicional);
  let csDevido = r2(Math.max(0, (baseCs * aliquotaCsll) / 100 - csllRetida));
  // A dedução do ajuste do ano da LC 224 (4º trimestre): até o imposto do
  // trimestre; o que sobra se restitui ou compensa, a pedido (§§7º e 8º).
  const deduzir = (tributo: "IRPJ" | "CSLL", devido: number, deducao: number, mem: ItemMemoria[], av: string[]) => {
    if (deducao <= 0) return devido;
    const usada = r2(Math.min(devido, deducao));
    mem.push({
      grupo: "saldo",
      rotulo: "(−) Acréscimo da LC 224 pago a mais no ano",
      detalhe: "ajuste do 4º trimestre (IN RFB 2.305/2025, art. 15, §5º): os trimestres anteriores refeitos pelo excedente do ano",
      valor: -usada,
    });
    if (deducao - usada >= 0.01)
      av.push(
        `O acréscimo da LC 224 pago a mais passa do ${tributo} deste trimestre: ${formatBRL(r2(deducao - usada))} podem ser restituídos ou compensados, a pedido, com Selic (IN RFB 2.305/2025, art. 15, §§7º e 8º).`,
      );
    return r2(devido - usada);
  };
  irDevido = deduzir("IRPJ", irDevido, deducaoIr, memIr, avisosIr);
  csDevido = deduzir("CSLL", csDevido, deducaoCs, memCs, avisosCs);
  // Diferença do protótipo: lá IRPJ e CSLL dividiam a lista de avisos, e este (só do IRPJ) aparecia também na CSLL.
  const avisosIrpj = [...avisos, ...avisosIr];
  if (irrf > ir15)
    avisosIrpj.push(
      `IRRF retido maior que os ${pct(aliquotaIrpj)}%: o excedente vira saldo negativo, que a contabilidade recupera por PER/DCOMP.`,
    );

  const cidade = ctx.matriz(pj).municipio;
  const guia = (tributo: "IRPJ" | "CSLL", memoria: ItemMemoria[], apurado: number, avisosDaGuia: string[]): Guia => {
    const cotas = cotasDe(apurado, t, cidade, ctx.cad);
    return {
      chave: `${tributo.toLowerCase()}|${pj}|${t}`,
      tributo,
      titulo: tributo === "IRPJ" ? "IRPJ (com adicional)" : "CSLL",
      codigo: codigoDarf(tributo, reg.regime),
      empresa_contabil_id: pj,
      estabelecimento_id: null,
      local: localFederal(ctx, pj, true),
      competencia: t,
      rotulo_competencia: nomeDoTrimestre(t),
      periodo: "trimestral",
      vencimento: cotas[0].vencimento,
      vencimento_motivo: null,
      regra_vencimento: "último dia útil de cada mês do trimestre seguinte · 2ª cota com 1% e 3ª com Selic + 1%",
      memoria,
      apurado,
      saldo_credor_gerado: 0,
      base: receitaRef,
      rateio: rateioPor(pesos, apurado),
      avisos: avisosDaGuia,
      cotas,
    };
  };
  return [guia("IRPJ", memIr, irDevido, avisosIrpj), guia("CSLL", memCs, csDevido, [...avisos, ...avisosCs])];
}

// ---------------------------------------------------------------------------
// LC 224/2025 no lucro presumido (decisão 145, item 7)
// ---------------------------------------------------------------------------

/**
 * Desde quando o acréscimo vale (LC 224/2025, art. 14; IN RFB 2.305/2025,
 * art. 3º): o IRPJ em janeiro/2026; a CSLL, pela noventena, em abril/2026 —
 * o limite dela em 2026 é de três trimestres (Perguntas e Respostas da
 * Receita, itens 12 e 13).
 */
const INICIO_DA_LC224: Record<"IRPJ" | "CSLL", string> = { IRPJ: "2026-01-01", CSLL: "2026-04-01" };

interface Lc224DoTrimestre {
  /** A receita do trimestre que vai à presunção majorada. */
  excesso: number;
  /** O limite de um trimestre (R$ 1,25 milhão, o parâmetro). */
  lt: number;
  /** O limite aplicado ao trimestre; `null` fora da vigência. */
  limite: number | null;
  /** A receita do ano é conhecida: valem a sobra e o ajuste do 4º trimestre. */
  completo: boolean;
  linhas: ItemMemoria[];
  /** 4º trimestre: os trimestres anteriores refeitos pelo excedente do ano (§5º, I e II). */
  recalculos: Array<{ receita: number; excessoPago: number; excessoDevido: number }>;
  avisos: string[];
}

/**
 * O excedente da LC 224 num trimestre, pela IN RFB 2.305/2025, art. 15, na
 * redação da IN 2.306/2026:
 * - o limite do trimestre é R$ 1,25 milhão, comparado com a receita do
 *   próprio trimestre; a sobra de um trimestre abaixo do limite passa para os
 *   seguintes do mesmo ano (§§2º a 4º); o excedente nunca passa;
 * - no 4º trimestre confere-se o ano (§5º): receita do ano até o limite
 *   anual, nenhum acréscimo, e o pago a mais antes volta como dedução; acima
 *   dele, o 4º trimestre leva o que falta para o excedente do ano, ou nada,
 *   refazendo os anteriores na proporção quando eles pagaram mais.
 * No regime de caixa, a receita é a recebida (a norma não diz; é a mesma
 * receita da base). Antes do início da Apuração, a do cadastro
 * (`receitasAnteriores`); sem ela, vale o limite do próprio trimestre, como
 * antes — erra para mais — e a guia avisa.
 */
function lc224DoTrimestre(ctx: Contexto, pj: string, t: string, tributo: "IRPJ" | "CSLL", recebido: number): Lc224DoTrimestre {
  const lt = parametro(ctx.cad, "lc224_limite_trimestre", fimDoTrimestre(t));
  const [ano, q] = t.split("-T").map(Number);
  const inicio = INICIO_DA_LC224[tributo];
  if (fimDoTrimestre(t) < inicio) return { excesso: 0, lt, limite: null, completo: true, linhas: [], recalculos: [], avisos: [] };
  const qInicio = Number(inicio.slice(0, 4)) === ano ? Math.ceil(Number(inicio.slice(5, 7)) / 3) : 1;
  const primeiro = trimestreDe(PRIMEIRA_COMPETENCIA);
  const receitaDe = (tk: string): number | null => {
    if (tk >= primeiro)
      return r2(
        ctx.fatos.recebimentos
          .filter((r) => {
            if (trimestreDe(r.data) !== tk || dia(r.data) > ctx.asOf) return false;
            const n = ctx.nota(r.nota_id);
            return !!n && ctx.pjDoEstab(n.estabelecimento_id) === pj;
          })
          .reduce((soma, r) => soma + r.bruto, 0),
      );
    const informada = ctx.cad.receitasAnteriores.find((x) => x.empresa_contabil_id === pj && x.trimestre === tk);
    return informada ? informada.receita_bruta : null;
  };
  const anteriores: Array<{ tk: string; receita: number | null }> = [];
  for (let k = qInicio; k < q; k++) anteriores.push({ tk: `${ano}-T${k}`, receita: receitaDe(`${ano}-T${k}`) });

  const faltam = anteriores.filter((a) => a.receita === null).map((a) => a.tk);
  if (faltam.length) {
    const excesso = r2(Math.max(0, recebido - lt));
    return {
      excesso,
      lt,
      limite: lt,
      completo: false,
      linhas: [],
      recalculos: [],
      avisos:
        excesso > 0 || q === 4
          ? [
              `LC 224/2025: falta informar a receita recebida ${
                faltam.length > 1
                  ? `nos ${juntar(faltam.map((tk) => `${tk.split("-T")[1]}º`))} trimestres de ${ano}`
                  : `no ${faltam[0].split("-T")[1]}º trimestre de ${ano}`
              } no cadastro de impostos (aba Parâmetros). Até lá, vale o limite do próprio trimestre, sem a sobra do ano nem o ajuste do 4º trimestre: o ${tributo} pode sair maior.`,
            ]
          : [],
    };
  }

  let sobra = 0;
  let somaExcessos = 0;
  const pagos: Array<{ receita: number; excesso: number }> = [];
  for (const a of anteriores) {
    const receita = a.receita ?? 0;
    const limiteK = r2(lt + sobra);
    const excessoK = r2(Math.max(0, receita - limiteK));
    sobra = r2(Math.max(0, limiteK - receita));
    somaExcessos = r2(somaExcessos + excessoK);
    pagos.push({ receita, excesso: excessoK });
  }

  if (q < 4) {
    const limite = r2(lt + sobra);
    return {
      excesso: r2(Math.max(0, recebido - limite)),
      lt,
      limite,
      completo: true,
      linhas: [
        {
          grupo: "base",
          rotulo: `Limite da LC 224 no trimestre: ${formatBRL(limite)}`,
          detalhe:
            sobra > 0
              ? `${formatBRL(lt)} + a sobra de ${formatBRL(sobra)} dos trimestres anteriores de ${ano} (IN RFB 2.305/2025, art. 15, §4º)`
              : `${formatBRL(lt)} por trimestre; a sobra passa para os trimestres seguintes do ano`,
          valor: 0,
        },
      ],
      recalculos: [],
      avisos: [],
    };
  }

  // 4º trimestre: o ano inteiro (§5º).
  const receitaAno = r2(pagos.reduce((soma, x) => soma + x.receita, 0) + recebido);
  const limiteAno = r2(lt * (4 - qInicio + 1));
  const excessoAno = r2(Math.max(0, receitaAno - limiteAno));
  let excesso = 0;
  let recalculos: Lc224DoTrimestre["recalculos"] = [];
  if (receitaAno <= limiteAno) {
    recalculos = pagos.filter((x) => x.excesso > 0).map((x) => ({ receita: x.receita, excessoPago: x.excesso, excessoDevido: 0 }));
  } else if (excessoAno < somaExcessos) {
    recalculos = pagos
      .filter((x) => x.excesso > 0)
      .map((x) => ({ receita: x.receita, excessoPago: x.excesso, excessoDevido: r2((x.excesso / somaExcessos) * excessoAno) }));
  } else {
    excesso = r2(excessoAno - somaExcessos);
  }
  return {
    excesso,
    lt,
    limite: lt,
    completo: true,
    linhas: [
      {
        grupo: "base",
        rotulo: `Ajuste do ano da LC 224: ${formatBRL(receitaAno)} recebidos em ${ano}`,
        detalhe: `limite de ${formatBRL(limiteAno)} no ano${qInicio > 1 ? ` (o ${tributo} só a partir do ${nomeDoTrimestre(`${ano}-T${qInicio}`)})` : ""}; ${
          excessoAno > 0 ? `${formatBRL(excessoAno)} passam do limite no ano` : "nada passa do limite no ano"
        } (IN RFB 2.305/2025, art. 15, §5º)`,
        valor: 0,
      },
    ],
    recalculos,
    avisos: [],
  };
}

// ---------------------------------------------------------------------------
// Retenções feitas nos pagamentos a fornecedores
// ---------------------------------------------------------------------------

/** "PIS 0,65% + COFINS 3% + CSLL 1%", pelo que foi de fato retido no pagamento. */
function partesDaCsrf(pg: PagamentoDeFornecedor) {
  return (["PIS", "COFINS", "CSLL"] as const)
    .filter((k) => (pg.retido[k] ?? 0) > 0)
    .map((k) => {
      const v = pg.retido[k] ?? 0;
      return pg.bruto > 0 ? `${k} ${pct(r4((v / pg.bruto) * 100))}%` : `${k} ${formatBRL(v)}`;
    })
    .join(" + ");
}

function guiasRetencoes(ctx: Contexto, pj: string, comp: string): Guia[] {
  const out: Guia[] = [];
  const fim = ultimoDiaDoMes(comp);
  const matriz = ctx.matriz(pj);
  const regime = regimeDaPJ(ctx.cad, pj, fim).regime;

  // Federais: pelo mês do PAGAMENTO e pelo que foi DE FATO retido na baixa.
  // Diferença do protótipo: lá o valor era alíquota da aprovação × pagamento.
  for (const tributo of ["CSRF", "IRRF"] as const) {
    const memoria: ItemMemoria[] = [];
    const pesos: Peso[] = [];
    for (const nf of ctx.fatos.notasFornecedor) {
      if (ctx.pjDoEstab(nf.tomador_estabelecimento_id) !== pj) continue;
      for (const pg of nf.pagamentos) {
        if (mesDe(pg.data) !== comp || dia(pg.data) > ctx.asOf) continue;
        const valor =
          tributo === "CSRF" ? r2((pg.retido.PIS ?? 0) + (pg.retido.COFINS ?? 0) + (pg.retido.CSLL ?? 0)) : r2(pg.retido.IRRF ?? 0);
        if (valor <= 0) continue;
        const j = pg.job ?? nf.job;
        const pp = pg.pp ?? nf.pp;
        memoria.push({
          grupo: "debito",
          rotulo: `${pp} · NF ${nf.numero} · ${nf.fornecedor_nome}`,
          detalhe: `pago em ${dataBr(pg.data)} · ${j.codigo} ${j.nome}${tributo === "CSRF" ? ` · ${partesDaCsrf(pg)}` : ""}`,
          base: pg.bruto,
          ...(pg.bruto > 0 ? { aliquota: r4((valor / pg.bruto) * 100) } : {}),
          valor,
          job_id: j.job_id,
          pp,
        });
        pesos.push({ job: j, peso: pg.bruto });
      }
    }
    if (!memoria.length && !ctx.aprovada(`${tributo.toLowerCase()}|${pj}|${comp}`)) continue;
    const soma = somaDaMemoria(memoria);
    const diaDoVencimento = parametro(ctx.cad, "retencoes_dia", fim);
    const v = vencimentoNoMesSeguinte(comp, diaDoVencimento, "antecipa", ctx.feriados, matriz.municipio);
    out.push({
      chave: `${tributo.toLowerCase()}|${pj}|${comp}`,
      tributo,
      titulo: tributo === "CSRF" ? "PIS/COFINS/CSLL retidos de fornecedores" : "IRRF retido de fornecedores",
      codigo: codigoDarf(tributo, regime),
      empresa_contabil_id: pj,
      estabelecimento_id: null,
      local: localFederal(ctx, pj, false),
      competencia: comp,
      rotulo_competencia: nomeDoMes(comp),
      periodo: "mensal",
      vencimento: v.data,
      vencimento_motivo: v.motivo,
      regra_vencimento: `dia ${diaDoVencimento} do mês seguinte ao pagamento · em dia não útil, antecipa`,
      memoria,
      apurado: soma,
      saldo_credor_gerado: 0,
      base: r2(memoria.reduce((s, i) => s + (i.base ?? 0), 0)),
      rateio: rateioPor(pesos, soma),
      avisos: [],
    });
  }

  // ISS retido: pela EMISSÃO da NF do fornecedor, no município do CNPJ tomador.
  for (const e of ctx.estabelecimentos) {
    if (e.empresa_contabil_id !== pj) continue;
    const memoria: ItemMemoria[] = [];
    const pesos: Peso[] = [];
    for (const nf of ctx.fatos.notasFornecedor) {
      const aliquota = nf.aliquotas_aprovacao.ISS ?? 0;
      if (nf.tomador_estabelecimento_id !== e.id || aliquota <= 0 || mesDe(nf.emissao) !== comp || dia(nf.emissao) > ctx.asOf) continue;
      const j = nf.job;
      memoria.push({
        grupo: "debito",
        rotulo: `${nf.pp} · NF ${nf.numero} · ${nf.fornecedor_nome}`,
        detalhe: `NF emitida em ${dataBr(nf.emissao)} · ${j.codigo} ${j.nome}`,
        base: nf.valor,
        aliquota,
        valor: r2((nf.valor * aliquota) / 100),
        job_id: j.job_id,
        pp: nf.pp,
      });
      pesos.push({ job: j, peso: nf.valor });
    }
    if (!memoria.length && !ctx.aprovada(`issret|${e.id}|${comp}`)) continue;
    const soma = somaDaMemoria(memoria);
    // Diferença do protótipo: lá o ISS retido sempre prorrogava; aqui segue a regra do município no cadastro.
    const v = vencimentoNoMesSeguinte(comp, e.iss_retido_dia, e.iss_regra, ctx.feriados, e.municipio);
    out.push({
      chave: `issret|${e.id}|${comp}`,
      tributo: "ISS_RET",
      titulo: "ISS retido de fornecedores",
      codigo: null,
      empresa_contabil_id: pj,
      estabelecimento_id: e.id,
      local: `${e.municipio}-${e.uf}`,
      competencia: comp,
      rotulo_competencia: nomeDoMes(comp),
      periodo: "mensal",
      vencimento: v.data,
      vencimento_motivo: v.motivo,
      regra_vencimento: `dia ${e.iss_retido_dia} do mês seguinte à emissão da NF · ${textoDaRegra(e.iss_regra)}`,
      memoria,
      apurado: soma,
      saldo_credor_gerado: 0,
      base: r2(memoria.reduce((s, i) => s + (i.base ?? 0), 0)),
      rateio: rateioPor(pesos, soma),
      avisos: [],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// ISS a recuperar
// ---------------------------------------------------------------------------

/** A aprovação que vale para o cálculo de cada guia: a original (a diferença não a substitui). */
function aprovacaoPorChave(aprovacoes: AprovacaoFiscal[]) {
  const m = new Map<string, AprovacaoFiscal>();
  for (const a of aprovacoes) if (!a.diferenca || !m.has(a.chave)) m.set(a.chave, a);
  return m;
}

function todosARecuperar(ctx: Contexto, aprovadas: Map<string, AprovacaoFiscal>): ARecuperar[] {
  const out: ARecuperar[] = [];
  for (const r of ctx.fatos.recebimentos) {
    const iss = r.retido.ISS;
    if (!iss || dia(r.data) > ctx.asOf) continue;
    const n = ctx.nota(r.nota_id);
    if (!n) continue;
    const a = aprovadas.get(`iss|${n.estabelecimento_id}|${mesDe(n.emissao)}`);
    if (!a || dia(a.data) >= dia(r.data)) continue;
    const e = ctx.estab(n.estabelecimento_id);
    out.push({
      id: `rec-${r.id}`,
      estabelecimento_id: e.id,
      nota_id: n.id,
      recebimento_id: r.id,
      data: dia(r.data),
      valor: iss,
      competencia_nota: mesDe(n.emissao),
      forma: MUNICIPIOS_QUE_COMPENSAM_ISS.has(e.municipio) ? "compensar" : "restituir",
    });
  }
  return out;
}

/**
 * O ISS a recuperar em `asOf`: retido pelo cliente depois de aprovada a guia
 * da competência da nota, e ainda não compensado numa guia aprovada (os de
 * restituição ficam até a contabilidade concluir o pedido).
 */
export function issARecuperar(cad: CadastroFiscal, fatos: FatosFiscais, aprovacoes: AprovacaoFiscal[], asOf: string): ARecuperar[] {
  const usados = new Set(aprovacoes.flatMap((a) => a.compensacoes_usadas));
  return todosARecuperar(criarContexto(cad, fatos, asOf), aprovacaoPorChave(aprovacoes)).filter((x) => !usados.has(x.id));
}

// ---------------------------------------------------------------------------
// Apuração completa em `asOf`, com as aprovações já feitas
// ---------------------------------------------------------------------------

/**
 * Todas as guias de PRIMEIRA_COMPETENCIA até o mês de `asOf` (e os
 * trimestres delas), com o que o sistema sabia em `asOf`. A competência em
 * curso sai como estimativa; o estado de cada guia vem de `estadoDaGuia`.
 */
export function calcularApuracao(cad: CadastroFiscal, fatos: FatosFiscais, asOf: string, aprovacoes: AprovacaoFiscal[]): Guia[] {
  const ctx = criarContexto(cad, fatos, asOf, new Set(aprovacoes.filter((a) => !a.diferenca).map((a) => a.chave)));
  const aprovadas = aprovacaoPorChave(aprovacoes);
  const aRecuperar = todosARecuperar(ctx, aprovadas);
  const competencias = competenciasAte(ctx.asOf);
  const out: Guia[] = [];
  const saldo = new Map<string, number>();
  for (const comp of competencias) {
    for (const e of ctx.estabelecimentos) {
      // A compensação entra na primeira guia de ISS depois do recebimento que ainda não a usou.
      const prefixo = `iss|${e.id}|`;
      const candidatos = aRecuperar.filter((a) => a.estabelecimento_id === e.id && mesDe(a.data) <= comp && comp > a.competencia_nota);
      const usadosAntes = new Set(
        aprovacoes.flatMap((a) => (a.chave.startsWith(prefixo) && a.chave < `${prefixo}${comp}` ? a.compensacoes_usadas : [])),
      );
      const g = guiaIss(ctx, e, comp, aprovadas.get(`${prefixo}${comp}`), candidatos.filter((c) => !usadosAntes.has(c.id)));
      if (g) out.push(g);
    }
    for (const pj of ctx.pjs) {
      // Lucro real: a parte não cumulativa e, em guia própria, a cumulativa (o 12.08).
      const partes: readonly ParteDoPisCofins[] =
        regimeDaGuia(ctx.cad, pj, ultimoDiaDoMes(comp)).ramo === "real" ? ["nao_cumulativa", "cumulativa"] : ["toda"];
      for (const tributo of ["PIS", "COFINS"] as const) {
        for (const parte of partes) {
          const k = `${tributo}|${pj}|${parte}`;
          const g = guiaPisCofins(ctx, pj, comp, tributo, parte, saldo.get(k) ?? 0);
          saldo.set(k, g ? g.saldo_credor_gerado : 0);
          if (g) out.push(g);
        }
      }
      out.push(...guiasRetencoes(ctx, pj, comp));
    }
  }
  const trimestres = [...new Set(competencias.map(trimestreDe))];
  for (const t of trimestres)
    for (const pj of ctx.pjs)
      out.push(
        ...guiasIrpjCsll(ctx, pj, t).filter(
          (g) => g.memoria.some((m) => m.grupo === "base" && m.valor !== 0) || ctx.aprovada(g.chave),
        ),
      );
  // A guia aprovada que perdeu todos os fatos (notas canceladas depois) não
  // some: sai zerada, como diferença para menos, e diz o que fazer à mão.
  for (const g of out) if (ctx.aprovada(g.chave) && semFatos(g)) g.avisos.push(AVISO_SEM_FATOS);
  aplicarDarfMinimo(out, ctx.cad);
  return out;
}

/** A guia não tem mais nada que a sustente: nenhuma linha (ou, no trimestre, nenhuma base). */
function semFatos(g: Guia): boolean {
  if (g.periodo === "trimestral") return !g.memoria.some((m) => m.grupo === "base" && m.valor !== 0);
  return g.memoria.length === 0;
}

/** O aviso da guia aprovada sem fatos (decisão 145, item 6): o que fazer fica com o financeiro. */
export const AVISO_SEM_FATOS =
  "Hoje esta guia não tem nenhum fato: as notas (ou os pagamentos) dela foram cancelados depois da aprovação. O imposto que ainda não foi pago se cancela em Impostos a Pagar, com motivo; o que já foi pago fica a recuperar, com a contabilidade.";

// ---------------------------------------------------------------------------
// DARF mínimo
// ---------------------------------------------------------------------------

/** Os tributos pagos por DARF: o mínimo vale para eles (o ISS é municipal). */
const POR_DARF = new Set<Tributo>(["PIS", "COFINS", "IRPJ", "CSLL", "CSRF", "IRRF"]);

/** Soma dois rateios por empresa gerencial e regional (os valores; o % sai do `escalarRateio`). */
function somarRateios(a: RateioDaGuia[], b: RateioDaGuia[]): RateioDaGuia[] {
  const m = new Map<string, RateioDaGuia>();
  for (const x of [...a, ...b]) {
    const k = `${x.empresa_id}|${x.regional_id ?? ""}`;
    const y = m.get(k);
    if (y) m.set(k, { ...y, valor: r2(y.valor + x.valor), pct: y.pct + x.pct });
    else m.set(k, { ...x });
  }
  return [...m.values()];
}

/**
 * DARF mínimo (Lei 9.430/1996, art. 68; decisão 145, item 3): não se paga
 * DARF abaixo de R$ 10,00 (`darf_minimo`). O valor de um código que fica
 * abaixo dele soma à guia do mesmo código e da mesma PJ no período seguinte,
 * até chegar ao mínimo, e se paga no vencimento desse último período. A guia
 * abaixo do mínimo fica com apurado zero (não gera título) e diz para onde
 * o valor foi; a seguinte mostra de onde ele veio. O que veio não se abate
 * de crédito: é imposto de um período já fechado. Sem guia no período
 * seguinte, o valor segue esperando a próxima guia do código.
 *
 * Roda sobre as guias na ordem em que `calcularApuracao` as monta (os meses
 * em ordem, depois os trimestres em ordem); muda as guias no lugar.
 */
function aplicarDarfMinimo(guias: Guia[], cad: CadastroFiscal): void {
  const pendente = new Map<string, { valor: number; de: string; rateio: RateioDaGuia[] }>();
  for (const g of guias) {
    if (!POR_DARF.has(g.tributo) || !g.codigo) continue;
    // A família é o código: a chave sem a competência (`pis_cum|<PJ>`, `irrf|<PJ>`…).
    const familia = g.chave.slice(0, g.chave.lastIndexOf("|"));
    const vindo = pendente.get(familia);
    if (vindo) {
      pendente.delete(familia);
      g.memoria.push({
        grupo: "debito",
        rotulo: `Vindo de ${vindo.de} (abaixo do DARF mínimo)`,
        detalhe: "o valor abaixo de R$ 10,00 soma ao período seguinte, no mesmo código; não se abate de crédito",
        valor: vindo.valor,
      });
      g.apurado = r2(g.apurado + vindo.valor);
      g.rateio = escalarRateio(somarRateios(g.rateio, vindo.rateio), g.apurado);
    }
    const minimo = parametro(cad, "darf_minimo", fimDoPeriodo(g));
    if (g.apurado > 0 && g.apurado < minimo) {
      const proximo =
        g.periodo === "trimestral" ? nomeDoTrimestre(proximoTrimestre(g.competencia)) : nomeDoMes(proximoMes(g.competencia));
      pendente.set(familia, { valor: g.apurado, de: g.rotulo_competencia, rateio: g.rateio });
      g.memoria.push({
        grupo: "saldo",
        rotulo: `Abaixo do DARF mínimo (${formatBRL(minimo)})`,
        detalhe: `não se paga: passa para ${proximo}, no mesmo código (Lei 9.430/1996, art. 68)`,
        valor: -g.apurado,
      });
      g.avisos.push(
        `Abaixo do DARF mínimo de ${formatBRL(minimo)}: ${formatBRL(g.apurado)} passam para a guia de ${proximo}, no mesmo código.`,
      );
      g.apurado = 0;
      g.rateio = escalarRateio(g.rateio, 0);
    }
    if (g.periodo === "trimestral" && (vindo || g.apurado === 0)) {
      g.cotas = cotasDe(g.apurado, g.competencia, matrizDaPJ(cad, g.empresa_contabil_id).municipio, cad);
      g.vencimento = g.cotas[0].vencimento;
    }
  }
}

/**
 * Em curso até o fim do período; depois, a aprovar. Aprovada, vira
 * "diferença" quando o cálculo de hoje se afasta do calculado na última
 * aprovação (nota retroativa, custo novo...). `aprovacao` é a original.
 */
export function estadoDaGuia(
  g: Guia,
  hoje: string,
  aprovacoes: AprovacaoFiscal[],
): { estado: EstadoGuia; delta: number; aprovacao?: AprovacaoFiscal } {
  const minhas = aprovacoes.filter((a) => a.chave === g.chave).sort((a, b) => a.data.localeCompare(b.data));
  if (!minhas.length) return { estado: dia(hoje) <= fimDoPeriodo(g) ? "em_curso" : "a_aprovar", delta: 0 };
  const ultima = minhas[minhas.length - 1];
  const delta = r2(g.apurado - ultima.valor_calculado);
  if (Math.abs(delta) >= 0.01) return { estado: "diferenca", delta, aprovacao: minhas[0] };
  return { estado: "aprovada", delta: 0, aprovacao: minhas[0] };
}

// ---------------------------------------------------------------------------
// Títulos de Impostos a Pagar
// ---------------------------------------------------------------------------

/**
 * O vencimento da guia complementar: o legal da guia original (decisão 145,
 * item 2). O imposto vence na data do período, e pagar depois disso é
 * atraso, com multa e juros na baixa (Lei 9.430/1996, art. 61); não existe
 * prazo a mais por a diferença aparecer depois. No IRPJ/CSLL, o da 1ª cota
 * (ou da cota única).
 */
export function vencimentoDaComplementar(g: Pick<Guia, "periodo" | "vencimento" | "cotas">): string {
  return g.periodo === "trimestral" ? g.cotas?.[0]?.vencimento ?? g.vencimento : g.vencimento;
}

/**
 * Os títulos de uma aprovação: a complementar na diferença (no vencimento
 * legal da guia original, `vencimentoDaComplementar`; até 04/10/2026,
 * 5 dias depois da aprovação, como no protótipo), as cotas no IRPJ/CSLL (as
 * da aprovação; sem elas, as da guia) e um título nos demais. Guia sem valor
 * não gera título.
 *
 * Diferença do protótipo: a descrição usa o `local` da guia ("Salvador-BA",
 * "Federal · California…") no lugar do nome do CNPJ, que a Guia não carrega.
 */
export function titulosDaAprovacao(g: Guia, a: AprovacaoFiscal): TituloDaAprovacao[] {
  const descricao = `${g.titulo} · ${g.rotulo_competencia} · ${g.local}`;
  const simples = (origem: "apuracao" | "diferenca", vencimento: string, valor: number, texto: string): TituloDaAprovacao => ({
    origem,
    cota_numero: null,
    cota_total: null,
    juros_pct: null,
    vencimento,
    principal: valor,
    juros: 0,
    valor,
    descricao: texto,
    rateio: escalarRateio(g.rateio, valor),
  });
  if (a.diferenca)
    return a.valor_guia > 0 ? [simples("diferenca", vencimentoDaComplementar(g), a.valor_guia, `${descricao} · complementar`)] : [];
  if (g.periodo === "trimestral") {
    const cotas = a.cotas ?? g.cotas ?? [];
    return cotas
      .filter((c) => c.principal > 0)
      .map((c) => {
        const valor = r2(c.principal + c.juros);
        return {
          origem: "apuracao" as const,
          cota_numero: c.numero,
          cota_total: cotas.length,
          juros_pct: c.jurosPct,
          vencimento: c.vencimento,
          principal: c.principal,
          juros: c.juros,
          valor,
          descricao: `${descricao} · cota ${c.numero}/${cotas.length}`,
          rateio: escalarRateio(g.rateio, valor),
        };
      });
  }
  return a.valor_guia > 0 ? [simples("apuracao", g.vencimento, a.valor_guia, descricao)] : [];
}

// ---------------------------------------------------------------------------
// Peças da projeção do que falta receber (`./a-apurar.ts`)
// ---------------------------------------------------------------------------

/**
 * As guias de IRPJ e CSLL de uma PJ num trimestre, calculadas em `asOf` com
 * os fatos dados: a mesma conta de `calcularApuracao`. A projeção do "a
 * apurar no recebimento" chama duas vezes — com os fatos de hoje (a guia em
 * curso) e com os recebimentos previstos somados aos fatos (a guia que o
 * trimestre vai ter).
 */
export function guiasIrpjCsllDoTrimestre(cad: CadastroFiscal, fatos: FatosFiscais, pj: string, trimestre: string, asOf: string): Guia[] {
  return guiasIrpjCsll(criarContexto(cad, fatos, asOf), pj, trimestre);
}

/** O rateio de um total pelos jobs das notas, cada nota pesando pelo valor dado (como nas guias do caixa). */
export function rateioPelasNotas(itens: ReadonlyArray<{ nota: NotaSaidaFiscal; valor: number }>, total: number): RateioDaGuia[] {
  return rateioPor(itens.flatMap((i) => pesosDaNota(i.nota, i.valor)), total);
}
