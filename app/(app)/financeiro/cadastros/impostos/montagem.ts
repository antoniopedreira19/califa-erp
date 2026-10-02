/**
 * Montagem pura das abas do cadastro de impostos (módulo fiscal, 02/10/2026):
 * as linhas de CNAE com vigência, os parâmetros vigentes e os programados, e
 * os textos de valor da aba Parâmetros e dos dias federais da aba
 * Vencimentos. Sem React e sem banco, para testar.
 */
import type { FiscalCnae, FiscalParametro } from "@/lib/types";

// ---------------------------------------------------------------------------
// CNAEs: a linha que vale hoje e as programadas
// ---------------------------------------------------------------------------

export interface LinhaDeCnae {
  /** codigo|subitem */
  chave: string;
  /** A linha que vale hoje (nula quando o CNAE só começa no futuro). */
  vigente: FiscalCnae | null;
  /** As que começam depois de hoje, em ordem de data. */
  programadas: FiscalCnae[];
}

/**
 * Um item por CNAE (código + subitem) do CNPJ: a alíquota de hoje e as já
 * programadas. As linhas fechadas no passado são histórico e não aparecem.
 */
export function linhasDeCnae(cnaes: readonly FiscalCnae[], estabelecimentoId: string, hoje: string): LinhaDeCnae[] {
  const grupos = new Map<string, LinhaDeCnae>();
  for (const c of cnaes) {
    if (c.estabelecimento_id !== estabelecimentoId || !c.ativo) continue;
    const chave = `${c.codigo}|${c.subitem ?? ""}`;
    const g = grupos.get(chave) ?? { chave, vigente: null, programadas: [] };
    if (c.vigencia_inicio <= hoje && (c.vigencia_fim === null || c.vigencia_fim >= hoje)) {
      g.vigente = c;
    } else if (c.vigencia_inicio > hoje) {
      g.programadas.push(c);
    }
    grupos.set(chave, g);
  }
  return Array.from(grupos.values())
    .filter((g) => g.vigente !== null || g.programadas.length > 0)
    .map((g) => ({ ...g, programadas: g.programadas.sort((a, b) => a.vigencia_inicio.localeCompare(b.vigencia_inicio)) }))
    .sort((a, b) => {
      const x = a.vigente ?? a.programadas[0];
      const y = b.vigente ?? b.programadas[0];
      return x.codigo.localeCompare(y.codigo) || (x.subitem ?? "").localeCompare(y.subitem ?? "");
    });
}

// ---------------------------------------------------------------------------
// Parâmetros
// ---------------------------------------------------------------------------

/** O valor de uma chave numa data: a linha mais recente que já começou. */
export function valorNaData(parametros: readonly FiscalParametro[], chave: string, data: string): number | undefined {
  let melhor: FiscalParametro | undefined;
  for (const p of parametros) {
    if (p.chave !== chave || p.vigencia_inicio > data) continue;
    if (!melhor || p.vigencia_inicio > melhor.vigencia_inicio) melhor = p;
  }
  return melhor?.valor;
}

/** O valor mais recente de uma chave (inclusive o programado) e a data em que começa. */
export function ultimaVersao(parametros: readonly FiscalParametro[], chave: string): FiscalParametro | undefined {
  let melhor: FiscalParametro | undefined;
  for (const p of parametros) {
    if (p.chave !== chave) continue;
    if (!melhor || p.vigencia_inicio > melhor.vigencia_inicio) melhor = p;
  }
  return melhor;
}

export const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
export const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "dia": dia do mês de 1 a 31 (os vencimentos dos federais). */
export type FormatoDoCampo = "pct" | "moeda" | "dia";

export interface CampoDeParametro {
  chave: string;
  rotulo: string;
  formato: FormatoDoCampo;
}

export interface LinhaDeParametro {
  id: string;
  rotulo: string;
  campos: CampoDeParametro[];
  /** Texto da coluna Valor, com os valores das chaves. */
  valor: (v: Record<string, number>) => string;
  observacao: (v: Record<string, number>) => string;
}

/**
 * As linhas da aba Parâmetros, na ordem e com os textos do protótipo
 * aprovado. Uma linha só aparece quando todas as chaves dela existem no
 * banco (a Selic estimada e o DARF mínimo dependem da migration
 * 20261002100300).
 */
export function linhasDeParametro(nomesNoPresumido: string): LinhaDeParametro[] {
  return [
    {
      id: "irpj",
      rotulo: "IRPJ",
      campos: [{ chave: "irpj", rotulo: "IRPJ (%)", formato: "pct" }],
      valor: (v) => pct(v.irpj),
      observacao: () => "Sobre o lucro bruto (Real) ou a base presumida (Presumido).",
    },
    {
      id: "irpj_adicional",
      rotulo: "Adicional de IRPJ",
      campos: [
        { chave: "irpj_adicional", rotulo: "Adicional (%)", formato: "pct" },
        { chave: "irpj_adicional_limite_mes", rotulo: "Limite por mês", formato: "moeda" },
      ],
      valor: (v) => `${pct(v.irpj_adicional)} acima de ${moeda(v.irpj_adicional_limite_mes)} por mês`,
      observacao: (v) =>
        `${moeda(v.irpj_adicional_limite_mes * 3)} no trimestre, por empresa (a California soma matriz e filiais). Não se abate IRRF do adicional. Lei 9.249/1995, art. 3º, §1º.`,
    },
    {
      id: "csll",
      rotulo: "CSLL",
      campos: [{ chave: "csll", rotulo: "CSLL (%)", formato: "pct" }],
      valor: (v) => pct(v.csll),
      observacao: () => "Sem adicional.",
    },
    {
      id: "presuncao",
      rotulo: nomesNoPresumido ? `Presunção (${nomesNoPresumido})` : "Presunção",
      campos: [{ chave: "presuncao_servicos", rotulo: "Presunção (%)", formato: "pct" }],
      valor: (v) => pct(v.presuncao_servicos),
      observacao: () => "Serviços em geral.",
    },
    {
      id: "lc224",
      rotulo: "Acréscimo da LC 224/2025",
      campos: [
        { chave: "presuncao_lc224", rotulo: "Presunção (%)", formato: "pct" },
        { chave: "lc224_limite_trimestre", rotulo: "Limite por trimestre", formato: "moeda" },
      ],
      valor: (v) => `${pct(v.presuncao_lc224)} acima de ${moeda(v.lc224_limite_trimestre)} por trimestre`,
      observacao: () =>
        "Receita acima de R$ 5 milhões no ano. IRPJ desde 01/01/2026; CSLL desde 01/04/2026. Sobra de limite de trimestres anteriores: R$ 0,00 (pendência com a contabilidade).",
    },
    {
      id: "csrf",
      rotulo: "Retenção de PIS/COFINS/CSLL (CSRF)",
      campos: [
        { chave: "csrf_pis", rotulo: "PIS (%)", formato: "pct" },
        { chave: "csrf_cofins", rotulo: "COFINS (%)", formato: "pct" },
        { chave: "csrf_csll", rotulo: "CSLL (%)", formato: "pct" },
      ],
      valor: (v) =>
        `${pct(Math.round((v.csrf_pis + v.csrf_cofins + v.csrf_csll) * 10000) / 10000)} (${pct(v.csrf_pis)} + ${pct(v.csrf_cofins)} + ${pct(v.csrf_csll)})`,
      observacao: () => "Só para os serviços da lista da Lei 10.833/2003, art. 30; optante do Simples não sofre.",
    },
    {
      id: "irrf",
      rotulo: "IRRF sobre serviços",
      campos: [{ chave: "irrf_servicos", rotulo: "IRRF (%)", formato: "pct" }],
      valor: (v) => pct(v.irrf_servicos),
      observacao: () => "Serviços profissionais e propaganda; optante do Simples e MEI não sofrem.",
    },
    {
      id: "selic",
      rotulo: "Selic estimada (3ª cota)",
      campos: [{ chave: "selic_estimada_mes", rotulo: "Selic estimada ao mês (%)", formato: "pct" }],
      valor: (v) => `${pct(v.selic_estimada_mes)} + 1%`,
      observacao: () => "Só para a previsão; o valor da guia manda.",
    },
    {
      id: "darf_minimo",
      rotulo: "DARF mínimo",
      campos: [{ chave: "darf_minimo", rotulo: "Valor mínimo", formato: "moeda" }],
      valor: (v) => moeda(v.darf_minimo),
      observacao: () => "Abaixo disso, o valor acumula para o mês seguinte.",
    },
  ];
}

/**
 * Os dias de vencimento dos federais: o lápis das linhas de PIS/COFINS e das
 * DARF de retenção, na aba Vencimentos, abre a edição de parâmetro com estas
 * linhas. Não entram na aba Parâmetros (como no protótipo aprovado). A regra
 * de dia não útil (antecipa) é da lei e não é parâmetro.
 */
export const LINHA_DIA_PIS_COFINS: LinhaDeParametro = {
  id: "pis_cofins_dia",
  rotulo: "Vencimento do PIS e da COFINS",
  campos: [{ chave: "pis_cofins_dia", rotulo: "Dia do vencimento", formato: "dia" }],
  valor: (v) => `dia ${v.pis_cofins_dia} do mês seguinte`,
  observacao: () => "Em dia não útil, antecipa (regra da lei).",
};

export const LINHA_DIA_RETENCOES: LinhaDeParametro = {
  id: "retencoes_dia",
  rotulo: "Vencimento das retenções federais",
  campos: [{ chave: "retencoes_dia", rotulo: "Dia do vencimento", formato: "dia" }],
  valor: (v) => `dia ${v.retencoes_dia} do mês seguinte ao pagamento`,
  observacao: () => "DARF 5952 e DARF 1708. Em dia não útil, antecipa (regra da lei).",
};

export interface ParametroNaTela {
  linha: LinhaDeParametro;
  /** Valores de hoje, por chave. */
  hoje: Record<string, number>;
  /** Datas futuras em que algum valor da linha muda, com os valores dali em diante. */
  programados: Array<{ data: string; valores: Record<string, number> }>;
}

/**
 * Uma linha com os valores de hoje e os programados; nula quando falta
 * alguma das chaves dela no banco.
 */
export function parametroNaTela(
  parametros: readonly FiscalParametro[],
  hoje: string,
  linha: LinhaDeParametro,
): ParametroNaTela | null {
  const chaves = linha.campos.map((c) => c.chave);
  if (!chaves.every((k) => parametros.some((p) => p.chave === k))) return null;
  const valoresEm = (data: string) => {
    const v: Record<string, number> = {};
    for (const k of chaves) {
      // Se a chave só começa depois da data, mostra a primeira versão.
      v[k] = valorNaData(parametros, k, data) ?? primeiraVersao(parametros, k);
    }
    return v;
  };
  const datasFuturas = Array.from(
    new Set(parametros.filter((p) => chaves.includes(p.chave) && p.vigencia_inicio > hoje).map((p) => p.vigencia_inicio)),
  ).sort();
  return {
    linha,
    hoje: valoresEm(hoje),
    programados: datasFuturas.map((d) => ({ data: d, valores: valoresEm(d) })),
  };
}

/** As linhas da aba que têm todas as chaves no banco, com os valores de hoje e os programados. */
export function parametrosNaTela(
  parametros: readonly FiscalParametro[],
  hoje: string,
  nomesNoPresumido: string,
): ParametroNaTela[] {
  const out: ParametroNaTela[] = [];
  for (const linha of linhasDeParametro(nomesNoPresumido)) {
    const item = parametroNaTela(parametros, hoje, linha);
    if (item) out.push(item);
  }
  return out;
}

function primeiraVersao(parametros: readonly FiscalParametro[], chave: string): number {
  let melhor: FiscalParametro | undefined;
  for (const p of parametros) {
    if (p.chave !== chave) continue;
    if (!melhor || p.vigencia_inicio < melhor.vigencia_inicio) melhor = p;
  }
  return melhor?.valor ?? 0;
}

/** Junta nomes: ["California", "GoCrazy", "Hitlab"] → "California, GoCrazy e Hitlab". */
export function juntarNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "2026-11-20" → "sexta". */
export function diaDaSemana(dataIso: string): string {
  const [y, m, d] = dataIso.slice(0, 10).split("-").map(Number);
  return SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "2026-11-20" → "20/11/26" (coluna "Desde" da tabela de CNAEs). */
export function dataCurta(dataIso: string): string {
  const [y, m, d] = dataIso.slice(0, 10).split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
