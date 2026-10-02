/**
 * O bloco "No fiscal" das baixas (módulo fiscal, entrega 2 — 02/10/2026): o
 * efeito de cada baixa na Apuração, como no protótipo aprovado pelo Tiago.
 *
 * - **Pagamento de PP com NF registrada:** as retenções feitas na baixa
 *   geram a CSRF (PIS/COFINS/CSLL, DARF 5952) e o IRRF (DARF 1708) do mês
 *   do PAGAMENTO, pela matriz da PJ tomadora, vencendo no dia
 *   `retencoes_dia` do mês seguinte (em dia não útil, antecipa); o ISS
 *   retido vai para a guia do mês da EMISSÃO da NF, no município do CNPJ
 *   tomador (dia `iss_retido_dia`, pela regra do município).
 * - **Recebimento de NF com CNPJ emissor:** o que o cliente reteve abate
 *   qual imposto e em qual período; o ISS retido sai da guia da emissão
 *   (ou vira ISS a recuperar, se a guia já estava aprovada quando o cliente
 *   pagou); no lucro presumido pelo caixa, o recebimento gera PIS e COFINS
 *   e entra na base do IRPJ e da CSLL do trimestre.
 * - **Baixa em lote:** a soma das retenções dos pagamentos e o aviso do
 *   presumido pelo caixa nos recebimentos.
 *
 * As mesmas regras do motor (`lib/fiscal/apuracao.ts`: `guiasRetencoes`,
 * `guiaPisCofins`, `guiaIss`, `todosARecuperar`), sem rodar a apuração
 * inteira: funções puras sobre o que a Server Action
 * (`app/(app)/financeiro/actions-no-fiscal.ts`) lê ao abrir a baixa,
 * refeitas a cada mudança de data, valor e retidos do formulário.
 *
 * Testes: node --import tsx --test lib/fiscal/no-fiscal.test.ts
 */
import type { ImpostoRetido, RegimeTributarioPJ, RegraDeVencimentoFiscal } from "@/lib/types";
import { CODIGO_DARF_CSRF, CODIGO_DARF_IRRF } from "./codigos-darf";
import {
  mesDe,
  r2,
  ultimoDiaDoMes,
  vencimentoNoMesSeguinte,
  type FeriadoDoVencimento,
  type Vencimento,
} from "./datas";
import { textoDoTrimestre } from "./faturar";

// ---------------------------------------------------------------------------
// O que a Server Action devolve (o cadastro mínimo de cada baixa)
// ---------------------------------------------------------------------------

/** Uma linha de parâmetro do cadastro (`fiscal_parametros`), com a vigência. */
export interface ParametroComVigencia {
  valor: number;
  vigencia_inicio: string;
}

/** Uma linha de `fiscal_regimes` da PJ. */
export interface RegimeComVigencia {
  empresa_contabil_id: string;
  regime: RegimeTributarioPJ;
  regime_caixa: boolean;
  vigencia_inicio: string;
  vigencia_fim: string | null;
}

/** A PJ (empresa contábil) de um CNPJ: nome curto e o município da matriz,
 *  por onde vencem os federais. */
export interface PJDoFiscal {
  id: string;
  /** "California": o nome da matriz antes do " · ", como no motor. */
  nome: string;
  municipio_da_matriz: string;
}

/** Baixa de uma parcela de PP com a NF do fornecedor registrada na aprovação. */
export interface FiscalDoPagamento {
  nf: { numero: string; emissao: string };
  /** O CNPJ para o qual a NF saiu: de quem são as guias. */
  tomador: {
    nome: string;
    municipio: string;
    uf: string;
    iss_retido_dia: number;
    iss_regra: RegraDeVencimentoFiscal;
  };
  pj: PJDoFiscal;
  feriados: FeriadoDoVencimento[];
  /** `retencoes_dia`. */
  dia_das_retencoes: ParametroComVigencia[];
  /** A primeira competência apurada pelo módulo ("2026-10"). */
  primeira_competencia: string;
}

/** Baixa de um título de nota fiscal emitida com CNPJ emissor e CNAE. */
export interface FiscalDoRecebimento {
  nota: { numero: string; emissao: string };
  /** O CNPJ que emitiu a nota. */
  emissor: { nome: string; municipio: string; uf: string };
  pj: PJDoFiscal;
  /** Os regimes da PJ do emissor (o que vale é o da data). */
  regimes: RegimeComVigencia[];
  /** PIS e COFINS do CNAE da nota, na versão vigente na emissão. */
  cnae: { aliquota_pis: number; aliquota_cofins: number };
  /**
   * A guia de ISS próprio do mês da emissão, se já aprovada: o dia da
   * aprovação original e o do pagamento do título dela. Nula sem aprovação.
   */
  guia_iss: { aprovada_em: string; paga_em: string | null } | null;
  /** O município do emissor deixa compensar o ISS pago a mais (Salvador);
   *  nos outros, pede-se restituição. */
  compensa_iss: boolean;
  feriados: FeriadoDoVencimento[];
  /** `pis_cofins_dia`. */
  dia_do_pis_cofins: ParametroComVigencia[];
  primeira_competencia: string;
}

/** A baixa em lote: só o que entra na Apuração vem no mapa. */
export interface FiscalDoLote {
  /** Por parcela de PP com NF registrada: a PJ tomadora. */
  parcelas: Record<string, PJDoFiscal>;
  /** Por título de nota com CNPJ emissor: a PJ emissora. */
  titulos: Record<string, PJDoFiscal>;
  regimes: RegimeComVigencia[];
  feriados: FeriadoDoVencimento[];
  dia_das_retencoes: ParametroComVigencia[];
  primeira_competencia: string;
}

// ---------------------------------------------------------------------------
// Vigência (as mesmas regras de `parametroVigente` e `regimeDaPJ`, em
// lib/fiscal/cadastro.ts, sobre as linhas que a Server Action manda)
// ---------------------------------------------------------------------------

/** O valor vigente na data: a linha mais recente que já começou. */
export function valorVigente(linhas: readonly ParametroComVigencia[], data: string, padrao: number): number {
  const linha = linhas
    .filter((p) => p.vigencia_inicio <= data)
    .sort((a, b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio))[0];
  return linha?.valor ?? padrao;
}

/** O regime da PJ na data (lucro real quando não houver registro). */
export function regimeNaData(
  regimes: readonly RegimeComVigencia[],
  pjId: string,
  data: string,
): { regime: RegimeTributarioPJ; regime_caixa: boolean } {
  const r = regimes
    .filter(
      (x) =>
        x.empresa_contabil_id === pjId &&
        x.vigencia_inicio <= data &&
        (x.vigencia_fim === null || x.vigencia_fim >= data),
    )
    .sort((a, b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio))[0];
  return { regime: r?.regime ?? "lucro_real", regime_caixa: r?.regime_caixa ?? false };
}

/** Os padrões do motor, se faltar a linha no cadastro. */
const DIA_DAS_RETENCOES = 20;
const DIA_DO_PIS_COFINS = 25;

/** Dia 20 do mês seguinte ao pagamento (o dia vigente no fim do mês), antecipa, pela matriz. */
function vencimentoDasRetencoes(
  competencia: string,
  dias: readonly ParametroComVigencia[],
  feriados: readonly FeriadoDoVencimento[],
  municipioDaMatriz: string,
): Vencimento {
  const dia = valorVigente(dias, ultimoDiaDoMes(competencia), DIA_DAS_RETENCOES);
  return vencimentoNoMesSeguinte(competencia, dia, "antecipa", feriados, municipioDaMatriz);
}

type Retidos = Partial<Record<ImpostoRetido, number>>;

const retido = (r: Retidos | null, imposto: ImpostoRetido) => {
  const v = r?.[imposto] ?? 0;
  return Number.isFinite(v) && v > 0 ? r2(v) : 0;
};

// ---------------------------------------------------------------------------
// Pagamento de PP
// ---------------------------------------------------------------------------

export interface DarfDaBaixa {
  codigo: string;
  rotulo: string;
  valor: number;
}

export interface EfeitoDoPagamento {
  /** DARF 5952 (PIS/COFINS/CSLL) e 1708 (IRRF), só os com valor. */
  darfs: DarfDaBaixa[];
  /** O mês do pagamento ("2026-10"); nulo enquanto não há data. */
  competencia: string | null;
  vencimento: Vencimento | null;
  /** O mês do pagamento é anterior à primeira competência do módulo. */
  darfsForaDaApuracao: boolean;
  /** O ISS retido, na guia do mês da emissão da NF. Nulo sem ISS retido. */
  iss: {
    valor: number;
    competencia: string;
    vencimento: Vencimento;
    foraDaApuracao: boolean;
  } | null;
}

/**
 * O que a baixa de uma parcela de PP faz nascer na Apuração. `retidos`:
 * os valores retidos do formulário (nulo com a retenção desligada).
 */
export function efeitoDoPagamento(
  f: FiscalDoPagamento,
  pagoEm: string,
  retidos: Retidos | null,
): EfeitoDoPagamento {
  const csrf = r2(retido(retidos, "PIS") + retido(retidos, "COFINS") + retido(retidos, "CSLL"));
  const irrf = retido(retidos, "IRRF");
  const iss = retido(retidos, "ISS");
  const darfs: DarfDaBaixa[] = [];
  if (csrf > 0) darfs.push({ codigo: CODIGO_DARF_CSRF, rotulo: "PIS/COFINS/CSLL retidos", valor: csrf });
  if (irrf > 0) darfs.push({ codigo: CODIGO_DARF_IRRF, rotulo: "IRRF", valor: irrf });

  const competencia = pagoEm ? mesDe(pagoEm) : null;
  const vencimento =
    competencia && darfs.length > 0
      ? vencimentoDasRetencoes(competencia, f.dia_das_retencoes, f.feriados, f.pj.municipio_da_matriz)
      : null;

  const mesDaNF = mesDe(f.nf.emissao);
  return {
    darfs,
    competencia,
    vencimento,
    darfsForaDaApuracao: competencia !== null && competencia < f.primeira_competencia,
    iss:
      iss > 0
        ? {
            valor: iss,
            competencia: mesDaNF,
            vencimento: vencimentoNoMesSeguinte(
              mesDaNF,
              f.tomador.iss_retido_dia,
              f.tomador.iss_regra,
              f.feriados,
              f.tomador.municipio,
            ),
            foraDaApuracao: mesDaNF < f.primeira_competencia,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Recebimento de NF
// ---------------------------------------------------------------------------

export type LinhaDoRecebimento =
  | { tipo: "sem_data" }
  /** O recebimento é de antes do módulo: nada dele entra na Apuração. */
  | { tipo: "antes_do_modulo"; competencia: string; primeira: string }
  /** Lucro presumido pelo caixa: o recebimento é o fato gerador. */
  | {
      tipo: "caixa";
      pis: number;
      aliquota_pis: number;
      cofins: number;
      aliquota_cofins: number;
      vencimento: Vencimento;
      trimestre: string;
    }
  /** O ISS retido depois de aprovada a guia do mês da nota. */
  | {
      tipo: "iss_a_recuperar";
      competencia_nota: string;
      aprovada_em: string;
      paga_em: string | null;
      compensa: boolean;
    }
  /** O ISS retido antes de aprovada a guia: sai da apuração do mês da nota. */
  | { tipo: "iss_do_cliente"; competencia_nota: string }
  /** A nota é de antes do módulo: não há guia de ISS dela para abater. */
  | { tipo: "iss_antes_do_modulo"; competencia_nota: string; primeira: string }
  | { tipo: "pis_cofins_retidos"; pis: boolean; cofins: boolean; competencia: string }
  | { tipo: "csll_irrf_retidos"; csll: boolean; irrf: boolean; trimestre: string }
  /** Lucro real sem retenção: a nota já entrou na emissão. */
  | { tipo: "nada_muda"; competencia_nota: string; antes_do_modulo: boolean };

export interface EfeitoDoRecebimento {
  /** O regime da PJ do emissor na data do recebimento (ou na emissão, sem data). */
  regime: RegimeTributarioPJ;
  regime_caixa: boolean;
  linhas: LinhaDoRecebimento[];
}

/**
 * O efeito da baixa de um título de NF. `valor`: o valor a dar baixa (o
 * bruto: líquido + retidos), que é a base do presumido pelo caixa.
 * `retidos`: o que o cliente reteve (nulo com a retenção desligada).
 */
export function efeitoDoRecebimento(
  f: FiscalDoRecebimento,
  data: string,
  valor: number,
  retidos: Retidos | null,
): EfeitoDoRecebimento {
  const { regime, regime_caixa } = regimeNaData(f.regimes, f.pj.id, data || f.nota.emissao);
  const base = { regime, regime_caixa };
  if (!data) return { ...base, linhas: [{ tipo: "sem_data" }] };

  const competencia = mesDe(data);
  if (competencia < f.primeira_competencia) {
    return { ...base, linhas: [{ tipo: "antes_do_modulo", competencia, primeira: f.primeira_competencia }] };
  }

  const ret = {
    ISS: retido(retidos, "ISS"),
    PIS: retido(retidos, "PIS"),
    COFINS: retido(retidos, "COFINS"),
    CSLL: retido(retidos, "CSLL"),
    IRRF: retido(retidos, "IRRF"),
  };
  const temRetencao = Object.values(ret).some((x) => x > 0);
  const competenciaNota = mesDe(f.nota.emissao);
  const notaAntes = competenciaNota < f.primeira_competencia;
  const trimestre = textoDoTrimestre(data);
  const linhas: LinhaDoRecebimento[] = [];

  // Presumido (o motor segue o recebimento também sem o regime de caixa,
  // com aviso na guia): PIS e COFINS pelo bruto, na alíquota do CNAE.
  if (regime === "lucro_presumido") {
    const dia = valorVigente(f.dia_do_pis_cofins, ultimoDiaDoMes(competencia), DIA_DO_PIS_COFINS);
    linhas.push({
      tipo: "caixa",
      pis: r2((valor * f.cnae.aliquota_pis) / 100),
      aliquota_pis: f.cnae.aliquota_pis,
      cofins: r2((valor * f.cnae.aliquota_cofins) / 100),
      aliquota_cofins: f.cnae.aliquota_cofins,
      vencimento: vencimentoNoMesSeguinte(competencia, dia, "antecipa", f.feriados, f.pj.municipio_da_matriz),
      trimestre,
    });
  }

  if (ret.ISS > 0) {
    if (notaAntes) {
      linhas.push({ tipo: "iss_antes_do_modulo", competencia_nota: competenciaNota, primeira: f.primeira_competencia });
    } else if (f.guia_iss && f.guia_iss.aprovada_em < data) {
      // Mesma fronteira do motor: aprovada ANTES do dia do recebimento vira
      // ISS a recuperar; no mesmo dia, ainda abate a guia.
      linhas.push({
        tipo: "iss_a_recuperar",
        competencia_nota: competenciaNota,
        aprovada_em: f.guia_iss.aprovada_em,
        paga_em: f.guia_iss.paga_em,
        compensa: f.compensa_iss,
      });
    } else {
      linhas.push({ tipo: "iss_do_cliente", competencia_nota: competenciaNota });
    }
  }

  if (ret.PIS > 0 || ret.COFINS > 0) {
    linhas.push({ tipo: "pis_cofins_retidos", pis: ret.PIS > 0, cofins: ret.COFINS > 0, competencia });
  }
  if (ret.CSLL > 0 || ret.IRRF > 0) {
    linhas.push({ tipo: "csll_irrf_retidos", csll: ret.CSLL > 0, irrf: ret.IRRF > 0, trimestre });
  }
  if (regime === "lucro_real" && !temRetencao) {
    linhas.push({ tipo: "nada_muda", competencia_nota: competenciaNota, antes_do_modulo: notaAntes });
  }
  return { ...base, linhas };
}

// ---------------------------------------------------------------------------
// Baixa em lote
// ---------------------------------------------------------------------------

export interface PagamentoNoLote {
  /** A parcela de PP (`pedidos_compra_parcelas.id`). */
  parcelaId: string;
  /** O que a baixa dela vai reter (a retenção da aprovação sobre o que falta). */
  retencoes: ReadonlyArray<{ imposto: ImpostoRetido; valor: number }>;
}

export interface EfeitoDoLote {
  /** O mês da data do lote ("2026-10"); nulo sem data. */
  competencia: string | null;
  /** A data do lote é anterior à primeira competência do módulo. */
  foraDaApuracao: boolean;
  /** As retenções das PPs com NF registrada. Nulo sem retenção nenhuma. */
  retencoes: {
    csrf: number;
    irrf: number;
    iss: number;
    /** O vencimento das guias federais de cada PJ (5952 e 1708). */
    vencimentos: Array<{ pj: string; vencimento: Vencimento }>;
  } | null;
  /** As PJs no presumido pelo caixa com recebimento no lote. Nulo sem nenhuma ou sem data. */
  caixa: { pjs: string[]; trimestre: string } | null;
}

export function efeitoDoLote(
  f: FiscalDoLote,
  data: string,
  pagamentos: readonly PagamentoNoLote[],
  titulosDeNota: readonly string[],
): EfeitoDoLote {
  const competencia = data ? mesDe(data) : null;
  let csrf = 0;
  let irrf = 0;
  let iss = 0;
  const pjsDasRetencoes = new Map<string, PJDoFiscal>();
  for (const p of pagamentos) {
    const pj = f.parcelas[p.parcelaId];
    if (!pj) continue;
    const de = Object.fromEntries(p.retencoes.map((r) => [r.imposto, r.valor])) as Retidos;
    const daPP = { csrf: r2(retido(de, "PIS") + retido(de, "COFINS") + retido(de, "CSLL")), irrf: retido(de, "IRRF") };
    csrf = r2(csrf + daPP.csrf);
    irrf = r2(irrf + daPP.irrf);
    iss = r2(iss + retido(de, "ISS"));
    if (daPP.csrf > 0 || daPP.irrf > 0) pjsDasRetencoes.set(pj.id, pj);
  }
  const retencoes =
    csrf > 0 || irrf > 0 || iss > 0
      ? {
          csrf,
          irrf,
          iss,
          vencimentos: competencia
            ? [...pjsDasRetencoes.values()].map((pj) => ({
                pj: pj.nome,
                vencimento: vencimentoDasRetencoes(competencia, f.dia_das_retencoes, f.feriados, pj.municipio_da_matriz),
              }))
            : [],
        }
      : null;

  let caixa: EfeitoDoLote["caixa"] = null;
  if (data) {
    const pjs = new Map<string, string>();
    for (const id of titulosDeNota) {
      const pj = f.titulos[id];
      if (pj && regimeNaData(f.regimes, pj.id, data).regime === "lucro_presumido") pjs.set(pj.id, pj.nome);
    }
    if (pjs.size > 0) caixa = { pjs: [...pjs.values()], trimestre: textoDoTrimestre(data) };
  }

  return {
    competencia,
    foraDaApuracao: competencia !== null && competencia < f.primeira_competencia,
    retencoes,
    caixa,
  };
}
