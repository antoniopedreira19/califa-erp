/**
 * As saídas de imposto no Fluxo de caixa (módulo fiscal, entrega 2 —
 * 02/10/2026). Funções PURAS: recebem o que os carregadores
 * (`fluxo-fiscal-dados.ts`) leram e devolvem itens no formato da
 * `vw_fluxo_caixa`.
 *
 * O protótipo aprovado (`copias/central-fluxo/dados-do-fluxo.ts`) põe cada
 * real numa etapa só:
 *   - previsão · "Recolhimento de impostos": o cronograma da abertura do job
 *     (decisão 100), menos a parte já faturada, consumida da data mais
 *     próxima para a mais distante;
 *   - previsão · Apuração: guia em curso ou a aprovar (e a diferença ainda
 *     não aprovada), como estimativa, pelo vencimento (IRPJ/CSLL por cota,
 *     com os juros);
 *   - previsão · "<PJ> · a apurar no recebimento" (PJ do lucro presumido
 *     pelo caixa, `./a-apurar.ts`): o que falta receber dos títulos das
 *     notas dela — PIS e COFINS no mês seguinte ao recebimento previsto,
 *     IRPJ e CSLL do trimestre do recebimento, em cotas, só o que a guia em
 *     curso ainda não tem;
 *   - título · imposto a pagar (guia aprovada ou lançamento avulso), pelo
 *     vencimento;
 *   - movimento · a baixa do imposto — já está na view (origem
 *     `imposto_baixa`); aqui só se junta numa linha por imposto.
 * A previsão vencida é lida em hoje + 1, como a de recebimento; o título e
 * o movimento ficam na data deles, como os da PP.
 *
 * E a parcela de PP com ISS retido sai do fluxo SEM o ISS: desde a emissão
 * da NF do fornecedor, ele está na guia de ISS retido (Apuração → imposto a
 * pagar). Sem isso o mesmo real estaria na PP e na guia.
 */
import { addDias, r2 } from "./datas";
import { escalarRateio, type EstadoGuia, type Guia, type RateioDaGuia } from "./apuracao";
import type { BlocoAApurar, IrpjCsllAApurar } from "./a-apurar";

/** Um item do fluxo, no formato da `vw_fluxo_caixa`, com a empresa para o filtro do cabeçalho. */
export interface SaidaFiscalDoFluxo {
  classe: "titulo" | "previsao";
  origem_tipo: "imposto" | "apuracao" | "previsao_imposto" | "a_apurar";
  origem_id: string;
  conta_bancaria_id: null;
  empresa_id: string | null;
  regional_id: string | null;
  job_id: string | null;
  data_evento: string;
  valor: number;
  natureza: "saida";
  descricao: string;
}

/** Previsão vencida é lida em hoje + 1 (a regra da previsão de recebimento). */
export const rolar = (data: string, hoje: string) => (data < hoje ? addDias(hoje, 1) : data);

// ---------------------------------------------------------------------------
// Título: imposto a pagar
// ---------------------------------------------------------------------------

export interface ImpostoEmAberto {
  id: string;
  tributo: string;
  codigo_receita: string | null;
  descricao: string;
  vencimento: string;
  valor: number;
  rateio: Array<{ empresa_id: string; regional_id: string | null; valor: number; ordem: number }>;
}

/**
 * O nome do imposto no fluxo: a guia e a descrição do título de Impostos a
 * Pagar ("DARF 6912 · PIS · outubro/2026 · Federal · California…"). O mesmo
 * texto vale para o título e para a baixa, para a linha não mudar de nome
 * quando passa de uma etapa para a outra.
 */
export function descricaoDoImposto(t: Pick<ImpostoEmAberto, "tributo" | "codigo_receita" | "descricao">) {
  const municipal = t.tributo === "ISS" || t.tributo === "ISS_RET";
  const guia = municipal ? "Guia municipal" : t.codigo_receita ? `DARF ${t.codigo_receita}` : "Guia";
  return `${guia} · ${t.descricao}`;
}

/** Os impostos a pagar em aberto, um item por parte do rateio (a tela junta de volta pelo `origem_id`). */
export function saidasDosImpostosAPagar(impostos: ImpostoEmAberto[]): SaidaFiscalDoFluxo[] {
  const out: SaidaFiscalDoFluxo[] = [];
  for (const t of impostos) {
    const descricao = descricaoDoImposto(t);
    const partes = [...t.rateio].sort((a, b) => a.ordem - b.ordem);
    const base = {
      classe: "titulo" as const,
      origem_tipo: "imposto" as const,
      origem_id: t.id,
      conta_bancaria_id: null,
      job_id: null,
      data_evento: t.vencimento,
      natureza: "saida" as const,
      descricao,
    };
    if (partes.length === 0) {
      // A função do banco não baixa imposto sem rateio; no fluxo ele entra inteiro, sem empresa.
      out.push({ ...base, empresa_id: null, regional_id: null, valor: r2(t.valor) });
      continue;
    }
    for (const p of partes) out.push({ ...base, empresa_id: p.empresa_id, regional_id: p.regional_id, valor: r2(p.valor) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Previsão: guia da Apuração ainda não aprovada
// ---------------------------------------------------------------------------

export type GuiaComEstado = Guia & { estado: EstadoGuia; delta: number };

/**
 * Uma estimativa no fluxo, um item por parte do rateio (a tela junta as
 * partes de volta pelo `origem_id`); sem rateio, inteira e sem empresa.
 */
function previsaoRateada(
  out: SaidaFiscalDoFluxo[],
  base: Omit<SaidaFiscalDoFluxo, "empresa_id" | "regional_id" | "valor">,
  rateio: RateioDaGuia[],
  total: number,
) {
  const partes = escalarRateio(rateio, total).filter((p) => p.valor !== 0);
  if (partes.length === 0) {
    out.push({ ...base, empresa_id: null, regional_id: null, valor: total });
    return;
  }
  for (const p of partes) out.push({ ...base, empresa_id: p.empresa_id, regional_id: p.regional_id, valor: p.valor });
}

/**
 * A guia em curso ou a aprovar, e a diferença ainda não aprovada, como
 * estimativa pelo vencimento. A guia aprovada já virou título (acima).
 */
export function saidasDaApuracao(guias: GuiaComEstado[], hoje: string): SaidaFiscalDoFluxo[] {
  const out: SaidaFiscalDoFluxo[] = [];
  for (const g of guias) {
    if (g.estado === "aprovada") continue;
    const estimativa = (valor: number, data: string, prefixo: string, cota?: { numero: number; total: number }) => {
      const total = r2(valor);
      if (total <= 0.009) return;
      previsaoRateada(
        out,
        {
          classe: "previsao",
          origem_tipo: "apuracao",
          origem_id: `${g.chave}${cota ? `|${cota.numero}` : ""}`,
          conta_bancaria_id: null,
          job_id: null,
          data_evento: rolar(data, hoje),
          natureza: "saida",
          descricao: `${prefixo} · ${g.titulo} · ${g.rotulo_competencia} · ${g.local}${cota ? ` · cota ${cota.numero}/${cota.total}` : ""}`,
        },
        g.rateio,
        total,
      );
    };
    if (g.estado === "diferenca") {
      estimativa(g.delta, g.vencimento, "Diferença a aprovar");
      continue;
    }
    const prefixo = g.estado === "em_curso" ? "Apuração em curso" : "Apuração a aprovar";
    if (g.cotas?.length) {
      for (const c of g.cotas) estimativa(c.principal + c.juros, c.vencimento, prefixo, { numero: c.numero, total: g.cotas.length });
    } else estimativa(g.apurado, g.vencimento, prefixo);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Previsão: "<PJ> · a apurar no recebimento" (lucro presumido pelo caixa)
// ---------------------------------------------------------------------------

/**
 * O que falta receber dos títulos das notas da PJ do caixa (`./a-apurar.ts`):
 * o PIS e a COFINS de cada título no vencimento do mês seguinte ao
 * recebimento previsto, com o job da nota; o IRPJ e a CSLL de cada
 * trimestre, uma linha por cota. A guia em curso (acima) fica com o que já
 * entrou; aqui, só o resto.
 */
export function saidasAApurar(blocos: BlocoAApurar[], irpjCsll: IrpjCsllAApurar[], hoje: string): SaidaFiscalDoFluxo[] {
  const out: SaidaFiscalDoFluxo[] = [];
  for (const b of blocos) {
    for (const l of b.linhas) {
      if (l.pis_cofins <= 0.009) continue;
      previsaoRateada(
        out,
        {
          classe: "previsao",
          origem_tipo: "a_apurar",
          origem_id: `a_apurar|pis-cofins|${l.titulo_id}`,
          conta_bancaria_id: null,
          job_id: l.job_id,
          data_evento: rolar(l.vencimento, hoje),
          natureza: "saida",
          descricao: `${b.pj_nome} · a apurar no recebimento · PIS e COFINS da NF ${l.numero_nf}/${l.parcela_numero}`,
        },
        l.rateio,
        l.pis_cofins,
      );
    }
  }
  for (const t of irpjCsll) {
    for (const c of t.cotas) {
      if (c.valor <= 0.009) continue;
      previsaoRateada(
        out,
        {
          classe: "previsao",
          origem_tipo: "a_apurar",
          origem_id: `a_apurar|irpj-csll|${t.pj}|${t.trimestre}|${c.numero}`,
          conta_bancaria_id: null,
          job_id: null,
          data_evento: rolar(c.vencimento, hoje),
          natureza: "saida",
          descricao: `${t.pj_nome} · a apurar no recebimento · IRPJ e CSLL do ${t.rotulo_trimestre}${
            t.cotas.length > 1 ? ` · cota ${c.numero}/${t.cotas.length}` : ""
          }`,
        },
        t.rateio,
        c.valor,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Previsão: o cronograma de impostos da abertura, abatido pelo faturamento
// ---------------------------------------------------------------------------

export interface LinhaDoCronograma {
  id: string;
  ordem: number;
  data_prevista: string;
  valor: number;
}

/**
 * O que sobra do cronograma de recolhimento de impostos da abertura
 * (decisão 100): cada nota tira a parte dela — o imposto previsto na
 * proporção do faturado sobre o faturamento previsto —, da data mais
 * próxima para a mais distante (o protótipo, `impostosQueSobram`).
 */
export function cronogramaQueSobra(
  linhas: LinhaDoCronograma[],
  faturado: number,
  faturamentoPrevisto: number,
): Array<LinhaDoCronograma & { resta: number; posicao: number; total: number }> {
  const ordenadas = [...linhas].sort((a, b) => a.data_prevista.localeCompare(b.data_prevista) || a.ordem - b.ordem);
  const previsto = r2(ordenadas.reduce((s, l) => s + l.valor, 0));
  const saiu = faturamentoPrevisto > 0.004 ? r2((previsto * Math.max(0, faturado)) / faturamentoPrevisto) : 0;
  let falta = Math.min(previsto, saiu);
  return ordenadas.map((l, i) => {
    const tira = Math.min(l.valor, Math.max(0, falta));
    falta = r2(falta - tira);
    return { ...l, resta: r2(l.valor - tira), posicao: i + 1, total: ordenadas.length };
  });
}

export interface JobDoCronograma {
  id: string;
  codigo: string;
  empresa_id: string | null;
  regional_id: string | null;
  faturamento_previsto: number;
  faturado: number;
  linhas: LinhaDoCronograma[];
}

/** "Recolhimento de impostos · TES-1001/26 1/2" — o mesmo formato do "Cronograma de desembolsos" da view. */
export function saidasDoCronogramaDeImpostos(jobs: JobDoCronograma[], hoje: string): SaidaFiscalDoFluxo[] {
  const out: SaidaFiscalDoFluxo[] = [];
  for (const j of jobs) {
    for (const l of cronogramaQueSobra(j.linhas, j.faturado, j.faturamento_previsto)) {
      if (l.resta <= 0.009) continue;
      out.push({
        classe: "previsao",
        origem_tipo: "previsao_imposto",
        origem_id: l.id,
        conta_bancaria_id: null,
        empresa_id: j.empresa_id,
        regional_id: j.regional_id,
        job_id: j.id,
        data_evento: rolar(l.data_prevista, hoje),
        valor: l.resta,
        natureza: "saida",
        descricao: `Recolhimento de impostos · ${j.codigo} ${l.posicao}/${l.total}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// A parcela de PP com ISS retido
// ---------------------------------------------------------------------------

/**
 * As PPs cujo ISS retido já está numa guia de ISS retido, com a alíquota:
 * as que aparecem na memória das guias `ISS_RET` (é o motor quem decide —
 * NF emitida a partir da primeira competência, tomador no cadastro).
 */
export function ppsComIssNaGuia(
  guias: Guia[],
  notasFornecedor: ReadonlyArray<{
    id: string;
    pp: string;
    /** Decisão 152: as PPs da nota. Sem ele, `id` é a PP. */
    pp_ids?: string[];
    aliquotas_aprovacao: Partial<Record<string, number>>;
  }>,
): Map<string, number> {
  const naGuia = new Set(guias.filter((g) => g.tributo === "ISS_RET").flatMap((g) => g.memoria.map((m) => m.pp).filter(Boolean)));
  const out = new Map<string, number>();
  for (const nf of notasFornecedor) {
    const aliquota = nf.aliquotas_aprovacao.ISS ?? 0;
    if (!(aliquota > 0) || !naGuia.has(nf.pp)) continue;
    for (const pp of nf.pp_ids ?? [nf.id]) out.set(pp, aliquota);
  }
  return out;
}

/** O valor da parcela de PP em aberto sem o ISS retido (o protótipo: `t.valor − t.valor × ISS%`). */
export const parcelaSemIssRetido = (valor: number, aliquotaIss: number) => r2(valor - r2((valor * aliquotaIss) / 100));
