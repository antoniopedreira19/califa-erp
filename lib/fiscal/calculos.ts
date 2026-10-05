/**
 * Cálculos do módulo fiscal usados nas telas da entrega 1 (02/10/2026):
 * os impostos de uma nota de saída (Faturar), as retenções na fonte da PP e
 * o crédito de PIS/COFINS da NF do fornecedor (Aprovar PP).
 *
 * Funções puras: recebem o que o cadastro de impostos devolve
 * (`lib/fiscal/cadastro.ts`) e não leem banco. A regra de cada uma veio do
 * protótipo aprovado e da pesquisa de 01/10/2026 (docs/superpowers/specs/
 * 2026-10-01-modulo-fiscal-pesquisa-tributaria.md).
 */
import type { ImpostoRetido } from "@/lib/types";
import {
  mesDe,
  nomeDoMes,
  r2,
  vencimentoNoMesSeguinte,
  type FeriadoDoVencimento,
  type RegraDoVencimento,
  type Vencimento,
} from "./datas";

// ---------------------------------------------------------------------------
// O que os cálculos precisam do cadastro (forma mínima, para reuso e teste)
// ---------------------------------------------------------------------------

export interface EstabelecimentoDoCalculo {
  id: string;
  nome: string;
  municipio: string;
  iss_dia: number;
  iss_retido_dia: number;
  iss_regra: RegraDoVencimento;
  /** Município da matriz da PJ: os federais vencem por ela. */
  municipio_da_matriz: string;
  regime: "lucro_real" | "lucro_presumido";
  regime_caixa: boolean;
}

export interface CnaeDoCalculo {
  id: string;
  codigo: string;
  subitem: string | null;
  descricao: string;
  aliquota_iss: number | null;
  aliquota_pis: number;
  aliquota_cofins: number;
  cumulativo: boolean;
}

/** "82.30-0-01 · 12.08" (com o subitem da LC 116 quando o CNAE se divide). */
export function codigoDoCnae(c: Pick<CnaeDoCalculo, "codigo" | "subitem">) {
  return c.subitem ? `${c.codigo} · ${c.subitem}` : c.codigo;
}

/** "82.30-0-01 · 12.08 — Serviços de organização de feiras…". */
export function rotuloDoCnae(c: Pick<CnaeDoCalculo, "codigo" | "subitem" | "descricao">) {
  return `${codigoDoCnae(c)} — ${c.descricao}`;
}

// ---------------------------------------------------------------------------
// Impostos de uma nota de saída (bloco "Impostos desta nota" do Faturar)
// ---------------------------------------------------------------------------

export interface ImpostoDaNota {
  imposto: "ISS" | "PIS" | "COFINS";
  aliquota: number;
  valor: number;
  vencimento: Vencimento;
  /** Texto curto da regra ("dia 5 do mês seguinte · Salvador"). */
  regra: string;
}

export interface ImpostosDaNota {
  competencia: string;
  /** "novembro/2026". */
  nomeDaCompetencia: string;
  impostos: ImpostoDaNota[];
  total: number;
  /** PIS/COFINS cumulativos (12.08, ou PJ no lucro presumido): sem crédito. */
  cumulativo: boolean;
  /**
   * Lucro presumido pelo caixa (Hitlab): PIS, COFINS, IRPJ e CSLL nascem no
   * RECEBIMENTO, não na emissão — a tela avisa em vez de dar o vencimento.
   */
  pelaCaixa: boolean;
}

export function impostosDaNota(
  estab: EstabelecimentoDoCalculo,
  cnae: CnaeDoCalculo,
  valor: number,
  emissao: string,
  feriados: readonly FeriadoDoVencimento[],
  diaPisCofins = 25,
): ImpostosDaNota {
  const competencia = mesDe(emissao);
  const iss = r2((valor * (cnae.aliquota_iss ?? 0)) / 100);
  const vIss = vencimentoNoMesSeguinte(competencia, estab.iss_dia, estab.iss_regra, feriados, estab.municipio);
  const vPc = vencimentoNoMesSeguinte(competencia, diaPisCofins, "antecipa", feriados, estab.municipio_da_matriz);
  const pis = r2((valor * cnae.aliquota_pis) / 100);
  const cofins = r2((valor * cnae.aliquota_cofins) / 100);
  const impostos: ImpostoDaNota[] = [];
  if (cnae.aliquota_iss != null) {
    impostos.push({
      imposto: "ISS",
      aliquota: cnae.aliquota_iss,
      valor: iss,
      vencimento: vIss,
      regra: `dia ${estab.iss_dia} do mês seguinte · ${estab.municipio}`,
    });
  }
  impostos.push(
    { imposto: "PIS", aliquota: cnae.aliquota_pis, valor: pis, vencimento: vPc, regra: `dia ${diaPisCofins} do mês seguinte · pela matriz` },
    { imposto: "COFINS", aliquota: cnae.aliquota_cofins, valor: cofins, vencimento: vPc, regra: `dia ${diaPisCofins} do mês seguinte · pela matriz` },
  );
  return {
    competencia,
    nomeDaCompetencia: nomeDoMes(competencia),
    impostos,
    total: r2(impostos.reduce((s, i) => s + i.valor, 0)),
    cumulativo: cnae.cumulativo || estab.regime === "lucro_presumido",
    pelaCaixa: estab.regime === "lucro_presumido" && estab.regime_caixa,
  };
}

// ---------------------------------------------------------------------------
// Retenções na fonte da PP (decididas na aprovação; a baixa chega com elas)
// ---------------------------------------------------------------------------

export type RegimeDoFornecedor = "normal" | "simples" | "mei";

export interface ParametrosDeRetencao {
  csrf_pis: number;
  csrf_cofins: number;
  csrf_csll: number;
  irrf_servicos: number;
  retencoes_dia: number;
}

export const PARAMETROS_DE_RETENCAO_PADRAO: ParametrosDeRetencao = {
  csrf_pis: 0.65,
  csrf_cofins: 3,
  csrf_csll: 1,
  irrf_servicos: 1.5,
  retencoes_dia: 20,
};

export type AliquotasRetidas = Partial<Record<ImpostoRetido, number>>;

/**
 * O padrão de retenção pelo regime do fornecedor: no regime normal, PIS,
 * COFINS e CSLL (CSRF) e IRRF; optante do Simples e MEI não sofrem retenção
 * de PIS/COFINS/CSLL e IRRF (IN SRF 459/2004 e Lei 9.430, art. 64). Sem
 * regime informado, segue o normal (é a regra; o Simples é a exceção que
 * precisa da declaração). ISS retido depende do município: não entra no padrão.
 */
export function retencoesPadrao(regime: RegimeDoFornecedor | null, p: ParametrosDeRetencao = PARAMETROS_DE_RETENCAO_PADRAO): AliquotasRetidas {
  if (regime === "simples" || regime === "mei") return {};
  return { PIS: p.csrf_pis, COFINS: p.csrf_cofins, CSLL: p.csrf_csll, IRRF: p.irrf_servicos };
}

export interface ValoresRetidos {
  porImposto: Partial<Record<ImpostoRetido, number>>;
  total: number;
  liquido: number;
  /** As guias que as retenções geram (CSRF = PIS+COFINS+CSLL, DARF 5952; IRRF, DARF 1708). */
  darf5952: number;
  darf1708: number;
  iss: number;
}

export function valoresRetidos(base: number, aliquotas: AliquotasRetidas): ValoresRetidos {
  const porImposto: Partial<Record<ImpostoRetido, number>> = {};
  for (const [imp, aliq] of Object.entries(aliquotas) as Array<[ImpostoRetido, number | undefined]>) {
    if (aliq && aliq > 0) porImposto[imp] = r2((base * aliq) / 100);
  }
  const total = r2(Object.values(porImposto).reduce((s, v) => s + (v ?? 0), 0));
  return {
    porImposto,
    total,
    liquido: r2(base - total),
    darf5952: r2((porImposto.PIS ?? 0) + (porImposto.COFINS ?? 0) + (porImposto.CSLL ?? 0)),
    darf1708: porImposto.IRRF ?? 0,
    iss: porImposto.ISS ?? 0,
  };
}

/** Vencimento das guias federais de retenção: dia 20 do mês seguinte ao PAGAMENTO, antecipa. */
export function vencimentoDasRetencoes(
  dataPagamento: string,
  feriados: readonly FeriadoDoVencimento[],
  municipioDaMatriz: string,
  dia = PARAMETROS_DE_RETENCAO_PADRAO.retencoes_dia,
) {
  return vencimentoNoMesSeguinte(mesDe(dataPagamento), dia, "antecipa", feriados, municipioDaMatriz);
}

// ---------------------------------------------------------------------------
// Crédito de PIS/COFINS da NF do fornecedor
// ---------------------------------------------------------------------------

export type EstadoDoCredito = "sim" | "nao";

export interface SituacaoDoCredito {
  estado: EstadoDoCredito;
  gera: boolean;
  motivo: string;
  pis: number;
  cofins: number;
  total: number;
  /** "novembro/2026": o mês da emissão da NF. */
  mes: string | null;
}

export interface EntradaDoCredito {
  /** Valor da NF do fornecedor (base do crédito). */
  valor: number;
  emissao: string | null;
  /** Regime da PJ tomadora (o CNPJ para o qual a NF saiu). */
  regimeDoTomador: "lucro_real" | "lucro_presumido";
  /** O financeiro tirou o crédito, com motivo. */
  retirado: boolean;
  motivoRetirado?: string | null;
  aliquotaPis?: number;
  aliquotaCofins?: number;
}

/**
 * Regra aprovada (01 e 02/10/2026, revista pela decisão 146 em 04/10/2026):
 * todo custo com NF de fornecedor pessoa jurídica gera crédito no mês da
 * EMISSÃO da NF (inclusive Simples e MEI); não gera se a PJ tomadora está no
 * lucro presumido (cumulativo) ou se o financeiro tirou, com motivo. O valor
 * aqui é o crédito cheio: a Apuração tira dele a parte da receita do mês no
 * 12.08 (rateio proporcional, Lei 10.833/2003, art. 3º, § 8º, II). O job não
 * entra na regra.
 */
export function situacaoDoCredito(e: EntradaDoCredito): SituacaoDoCredito {
  const aPis = e.aliquotaPis ?? 1.65;
  const aCofins = e.aliquotaCofins ?? 7.6;
  const pis = r2((e.valor * aPis) / 100);
  const cofins = r2((e.valor * aCofins) / 100);
  const mes = e.emissao ? nomeDoMes(mesDe(e.emissao)) : null;
  const base = { pis, cofins, total: r2(pis + cofins), mes };
  if (e.regimeDoTomador === "lucro_presumido")
    return { ...base, estado: "nao", gera: false, motivo: "O CNPJ tomador está no lucro presumido: PIS/COFINS cumulativos, sem crédito." };
  if (e.retirado)
    return {
      ...base,
      estado: "nao",
      gera: false,
      motivo: e.motivoRetirado ? `Marcado pelo financeiro como sem crédito: ${e.motivoRetirado}.` : "Marcado pelo financeiro como sem crédito.",
    };
  return {
    ...base,
    estado: "sim",
    gera: true,
    motivo: `Fornecedor PJ com NF. É o crédito cheio: se a PJ tomadora tiver nota no 12.08 ${mes ? `em ${mes}` : "no mês da emissão"}, a parte do 12.08 na receita do mês sai dele (rateio proporcional).`,
  };
}

/** Os motivos da caixa "Não gera crédito" (a lista do protótipo aprovado). */
export const MOTIVOS_SEM_CREDITO = [
  "Serviço não é insumo do job",
  "Reembolso de despesa do cliente",
  "Nota de outro tipo de serviço",
  "Outro",
] as const;
