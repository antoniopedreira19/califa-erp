/**
 * O resultado por regional do histórico (decisão 211, A4): as linhas das abas
 * Gerencial da planilha — o resultado operacional, os gastos fixos da regional
 * e os gerais, o lucro, o imobilizado, a participação nos lucros e a receita
 * financeira —, refeitas dos lançamentos do histórico numa regra só:
 *   - o lançamento com regional entra na regional dele;
 *   - o TD ("todas as regionais") se rateia pelo percentual do ano da planilha,
 *     o da tabela de rateio do histórico (no 4T 2024, o imobilizado e o PL
 *     seguem a linha 147 da Gerencial 24, que a tabela registra);
 *   - o que não tem regional fica em "Sem regional", e a soma das colunas
 *     fecha com a DRE do histórico.
 * O sinal é o da DRE do histórico, com o custo negativo, como nas abas
 * Gerencial. Elas não seguem uma regra só (o resultado dos jobs só no 4T, a
 * despesa administrativa ora pela regional, ora pelo total da DRE, o TD ÷4 em
 * alguns trimestres); as diferenças estão na decisão 211.
 */
import { CONTAS_PROPRIAS, TEXTO_DA_REGRA, aplicar, type Regra } from "./dre";

export type EmpresaDoRegional = "Agência California" | "CCH";

/**
 * As empresas com rateio, a sigla do Tipo e as regionais na ordem das abas
 * Gerencial, com os códigos da coluna Reg da planilha que o cadastro do sistema
 * não tem (a Urbia não é regional do sistema). O código de outra empresa (o
 * "NE" num lançamento da CMH) fica sem regional.
 */
export const EMPRESAS_DO_REGIONAL: readonly {
  empresa: EmpresaDoRegional;
  sigla: string;
  regionais: readonly string[];
  codigos: Readonly<Record<string, string>>;
}[] = [
  { empresa: "Agência California", sigla: "", regionais: ["NE", "NO", "SP", "RJ", "SS", "BH"], codigos: { BH: "BH" } },
  { empresa: "CCH", sigla: "CMH", regionais: ["Agency", "Doca", "Urbia"], codigos: { AGE: "Agency", DOC: "Doca", URB: "Urbia" } },
];

/** A soma de crédito e débito por sigla, grupo, trimestre de competência, conta (a aba) e regional, num ano. */
export type AgregadoRegional = {
  sigla: string;
  grupo: string;
  trimestre: number;
  aba: string;
  /** A regional do lançamento (o nome no sistema, ou o código da planilha); nula no TD e no que não tem regional. */
  regional: string | null;
  /** TD: de todas as regionais, para ratear. */
  todas: boolean;
  credito: number;
  debito: number;
};
/** O mesmo, pela chave de empréstimo da coluna Jobs ("FIT 1T 2024"). */
export type AgregadoRegionalJobs = Omit<AgregadoRegional, "sigla" | "grupo"> & { prefixo: string };

/** Uma linha da tabela de rateio: o percentual de uma regional no ano, ou num trimestre e grupo do ano. */
export type PercentualDoRateio = {
  ano: number;
  trimestre: number | null;
  empresa: string;
  grupo: string | null;
  regional: string;
  percentual: number;
  origem: string;
};

type Origem = { grupos: readonly string[] } | { jobs: string };
/** De quais lançamentos a linha sai: só os da regional (e os sem regional), só o TD rateado, ou tudo. */
type Parte = "regional" | "td" | "tudo";
type ItemDoModelo =
  | { tipo: "linha"; chave: string; rotulo: string; origem: Origem; regra: Regra; parte: Parte; dentroDeGrupo?: true }
  | { tipo: "grupo"; chave: string; rotulo: string; membros: readonly string[] }
  | { tipo: "total"; chave: string; rotulo: string; soma: readonly string[] };

const custo = (chave: string, rotulo: string, grupos: string[], parte: Parte = "tudo", dentroDeGrupo?: true): ItemDoModelo => ({
  tipo: "linha", chave, rotulo, origem: { grupos }, regra: "-(debito-credito)", parte, ...(dentroDeGrupo && { dentroDeGrupo }),
});
const entrada = (chave: string, rotulo: string, grupos: string[]): ItemDoModelo => ({
  tipo: "linha", chave, rotulo, origem: { grupos }, regra: "credito-debito", parte: "tudo",
});

const ATE_O_LUCRO: ItemDoModelo[] = [
  entrada("REC", "Faturamento", ["REC"]),
  custo("CT", "Imposto", ["CT"]),
  custo("CO", "Custo operacional", ["CO"]),
  { tipo: "total", chave: "RO", rotulo: "Resultado operacional", soma: ["REC", "CT", "CO"] },
  { tipo: "grupo", chave: "GFR", rotulo: "Gastos fixos da regional", membros: ["CFR", "DPR"] },
  custo("CFR", "Custo fixo", ["CF"], "regional", true),
  custo("DPR", "Despesa com pessoal", ["DP"], "regional", true),
  { tipo: "grupo", chave: "GFG", rotulo: "Gastos fixos gerais", membros: ["CFG", "DPG", "DM", "DA", "DC", "DT"] },
  custo("CFG", "Custo fixo (rateio)", ["CF"], "td", true),
  custo("DPG", "Despesa com pessoal (rateio)", ["DP"], "td", true),
  custo("DM", "Despesa de marketing", ["DM"], "tudo", true),
  custo("DA", "Despesa administrativa", ["DA"], "tudo", true),
  custo("DC", "Despesa comercial", ["DC"], "tudo", true),
  custo("DT", "Despesa trabalhista", ["DT"], "tudo", true),
  entrada("OUT", "Juros e empréstimos", ["DJ", "EMP"]),
];

/** As linhas de cada empresa, na ordem da tela. */
export const MODELOS_DO_REGIONAL: Readonly<Record<EmpresaDoRegional, readonly ItemDoModelo[]>> = {
  "Agência California": [
    ...ATE_O_LUCRO,
    { tipo: "linha", chave: "PERDA", rotulo: "Perda (FitDance)", origem: { jobs: "FIT" }, regra: "credito-debito", parte: "tudo" },
    { tipo: "total", chave: "LL", rotulo: "Lucro líquido", soma: ["RO", "GFR", "GFG", "OUT", "PERDA"] },
    custo("IMOB", "Imobilizado", ["IMOB"]),
    custo("PL", "Participação nos lucros", ["PL"]),
    entrada("RF", "Receita financeira", ["RF"]),
    { tipo: "total", chave: "LLI", rotulo: "Lucro após investimento", soma: ["LL", "IMOB", "PL", "RF"] },
  ],
  CCH: [
    ...ATE_O_LUCRO,
    { tipo: "total", chave: "LL", rotulo: "Lucro líquido", soma: ["RO", "GFR", "GFG", "OUT"] },
    custo("IMOB", "Imobilizado", ["IMOB"]),
    custo("DOC", "Investimento Doca", ["DOC"]),
    custo("MK", "Makkna", ["MK"]),
    custo("PL", "Participação nos lucros", ["PL"]),
    entrada("RF", "Receita financeira", ["RF"]),
    { tipo: "total", chave: "LLI", rotulo: "Lucro após investimento", soma: ["LL", "IMOB", "DOC", "MK", "PL", "RF"] },
  ],
};

/** As chaves da coluna Jobs que o resultado por regional usa. */
export const PREFIXOS_DO_REGIONAL: readonly string[] = ["FIT"];

export type LinhaDoRegional = {
  chave: string;
  rotulo: string;
  tipo: "linha" | "grupo" | "total";
  /** 1: linha dentro de um grupo (Gastos fixos da regional, Gastos fixos gerais). */
  nivel: 0 | 1;
  /** De onde a linha sai, para a dica da tela. */
  origem: string;
  /** O valor de cada regional, na ordem de `colunas`. */
  regionais: number[];
  semRegional: number;
  total: number;
};

export type ResultadoPorRegional = {
  /** As regionais com lançamento ou com percentual no ano. */
  colunas: string[];
  /** Algum lançamento ficou sem regional (ou TD sem percentual)? */
  temSemRegional: boolean;
  linhas: LinhaDoRegional[];
};

const centavos = (n: number) => Math.round(n * 100);

/**
 * Arredonda cada parte em centavos sem perder o total: o centavo que sobra vai
 * para as partes de maior fração (o método do maior resto).
 */
export function arredondarComTotal(valores: readonly number[]): number[] {
  const total = centavos(valores.reduce((s, v) => s + v, 0));
  const exatos = valores.map((v) => v * 100);
  const piso = exatos.map((v) => Math.floor(v));
  let falta = total - piso.reduce((s, v) => s + v, 0);
  const ordem = exatos.map((v, i) => ({ i, resto: v - Math.floor(v) })).sort((a, b) => b.resto - a.resto);
  const resultado = [...piso];
  for (const { i } of ordem) {
    if (falta <= 0) break;
    resultado[i] += 1;
    falta -= 1;
  }
  return resultado.map((c) => c / 100);
}

/**
 * O resultado por regional de uma empresa num ano: no ano inteiro (`trimestre`
 * nulo) ou num trimestre. `rateio` traz as linhas da tabela de rateio da
 * empresa no ano.
 */
export function montarRegional(
  empresa: EmpresaDoRegional,
  ano: number,
  trimestre: number | null,
  porGrupo: readonly AgregadoRegional[],
  porJobs: readonly AgregadoRegionalJobs[],
  rateio: readonly PercentualDoRateio[],
): ResultadoPorRegional {
  const { sigla, regionais: ordem, codigos } = EMPRESAS_DO_REGIONAL.find((e) => e.empresa === empresa)!;
  /** A regional da empresa, pelo nome ou pelo código da planilha; outra coisa fica sem regional. */
  const daEmpresa = (regional: string | null) =>
    regional === null ? null : ordem.includes(regional) ? regional : codigos[regional.toUpperCase()] ?? null;
  const deOutraEmpresa = new Set(
    Object.entries(CONTAS_PROPRIAS).flatMap(([dona, abas]) => (dona === empresa ? [] : abas ?? [])),
  );
  const trimestres = trimestre ? [trimestre] : [1, 2, 3, 4];
  const doAno = rateio.filter((r) => r.ano === ano && r.empresa === empresa);
  /** O percentual de cada regional num trimestre e grupo: a linha própria do trimestre e grupo, ou a do ano. */
  const percentuais = (t: number, grupo: string): Map<string, number> => {
    const proprias = doAno.filter((r) => r.trimestre === t && r.grupo === grupo);
    const linhas = proprias.length ? proprias : doAno.filter((r) => r.trimestre === null && r.grupo === null);
    return new Map(linhas.map((r) => [r.regional, r.percentual / 100]));
  };

  // As regionais da tela: as da empresa com lançamento ou com percentual no ano, na ordem da aba.
  const comLancamento = new Set(
    [...porGrupo.filter((a) => a.sigla === sigla), ...porJobs].flatMap((a) => {
      const r = deOutraEmpresa.has(a.aba) ? null : daEmpresa(a.regional);
      return r ? [r] : [];
    }),
  );
  const comPercentual = new Set(doAno.filter((r) => r.percentual > 0).map((r) => r.regional));
  const colunas = ordem.filter((r) => comLancamento.has(r) || comPercentual.has(r));

  type Exatos = { regionais: number[]; semRegional: number };
  const exatos = new Map<string, Exatos>();
  const linhas: LinhaDoRegional[] = [];
  const itens = MODELOS_DO_REGIONAL[empresa];

  for (const item of itens) {
    if (item.tipo !== "linha") continue;
    const valor: Exatos = { regionais: colunas.map(() => 0), semRegional: 0 };
    const fontes =
      "grupos" in item.origem
        ? porGrupo.filter((a) => a.sigla === sigla && (item.origem as { grupos: readonly string[] }).grupos.includes(a.grupo))
        : porJobs.filter((a) => a.prefixo === (item.origem as { jobs: string }).jobs);
    for (const a of fontes) {
      if (!trimestres.includes(a.trimestre) || deOutraEmpresa.has(a.aba)) continue;
      const v = aplicar(item.regra, a.credito, a.debito);
      if (a.todas) {
        if (item.parte === "regional") continue;
        const grupo = "grupo" in a ? (a as AgregadoRegional).grupo : "";
        const p = percentuais(a.trimestre, grupo);
        let rateado = 0;
        colunas.forEach((r, i) => {
          const pct = p.get(r) ?? 0;
          valor.regionais[i] += v * pct;
          rateado += pct;
        });
        // O que o percentual não cobre (ano sem rateio) fica sem regional.
        valor.semRegional += v * (1 - rateado);
      } else {
        if (item.parte === "td") continue;
        const regional = daEmpresa(a.regional);
        const i = regional ? colunas.indexOf(regional) : -1;
        if (i >= 0) valor.regionais[i] += v;
        else valor.semRegional += v;
      }
    }
    exatos.set(item.chave, valor);
  }

  // Soma em centavos para não acumular erro de ponto flutuante.
  const emCentavos = (v: number) => Math.round(v * 100);
  const comTotal = (regionais: number[], semRegional: number) => ({
    regionais,
    semRegional,
    total: (regionais.reduce((s, v) => s + emCentavos(v), 0) + emCentavos(semRegional)) / 100,
  });

  // Primeiro as linhas, arredondadas sem perder o total; depois os grupos e os totais, que somam
  // as linhas como aparecem na tela (o grupo vem antes das linhas dele).
  const arredondados = new Map<string, { regionais: number[]; semRegional: number; total: number }>();
  const origens = new Map<string, string>();
  for (const item of itens) {
    if (item.tipo !== "linha") continue;
    const e = exatos.get(item.chave)!;
    const r = arredondarComTotal([...e.regionais, e.semRegional]);
    const semRegional = r.pop()!;
    arredondados.set(item.chave, comTotal(r, semRegional));
    const grupos = "grupos" in item.origem ? item.origem.grupos.map((g) => [sigla, g].filter(Boolean).join(" ")).join(" e ") : null;
    const fonte = grupos ? `Tipo ${grupos}` : `Coluna Jobs "${(item.origem as { jobs: string }).jobs} nT"`;
    const parte =
      item.parte === "regional"
        ? "só os lançamentos com regional"
        : item.parte === "td"
          ? "só o TD, pelo percentual do ano"
          : "a regional de cada lançamento e o TD pelo percentual do ano";
    origens.set(item.chave, `${fonte} · ${TEXTO_DA_REGRA[item.regra]} · ${parte}`);
  }
  for (const item of itens) {
    if (item.tipo !== "linha") {
      const partes = (item.tipo === "grupo" ? item.membros : item.soma).map((c) => arredondados.get(c));
      const regionais = colunas.map((_, i) => partes.reduce((s, p) => s + emCentavos(p?.regionais[i] ?? 0), 0) / 100);
      const semRegional = partes.reduce((s, p) => s + emCentavos(p?.semRegional ?? 0), 0) / 100;
      arredondados.set(item.chave, comTotal(regionais, semRegional));
      origens.set(item.chave, item.tipo === "grupo" ? "Soma das linhas do grupo" : "Soma das linhas de cima");
    }
    const v = arredondados.get(item.chave)!;
    linhas.push({
      chave: item.chave,
      rotulo: item.rotulo,
      tipo: item.tipo,
      nivel: item.tipo === "linha" && item.dentroDeGrupo ? 1 : 0,
      origem: origens.get(item.chave)!,
      ...v,
    });
  }

  return { colunas, temSemRegional: linhas.some((l) => l.semRegional !== 0), linhas };
}
