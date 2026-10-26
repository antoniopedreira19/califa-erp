/**
 * O resultado por regional do histórico (decisão 211, A4): as linhas da DRE
 * regional da planilha — as abas "DRE Califa Regional" e "DRE CMH Regional"
 * do Fechamento, que somam as Res. Jobs e as Gerencial: o faturamento, o
 * imposto e o custo operacional, os gastos fixos da regional e os gerais, o
 * lucro, o benefício tributário, a receita financeira, o imobilizado e a
 * participação nos lucros —, refeitas dos lançamentos do histórico numa regra
 * só:
 *   - o faturamento e o custo operacional do job se dividem pelas partes dele
 *     (o grupo "RATEIO %" das abas Res. Jobs). O imposto é o teórico: o
 *     faturamento × a alíquota do job ("Imp Real %"), com a mesma divisão;
 *   - o benefício do ISS e do PERSE (o imposto teórico menos o imposto pago,
 *     Tipo CT) se rateia, trimestre a trimestre, pelo faturamento de cada
 *     regional, e entra depois do lucro líquido;
 *   - o resto: o lançamento com regional entra na regional dele (o job que a
 *     planilha não divide também); o TD ("todas as regionais") se rateia pelo
 *     percentual do ano da planilha, o da tabela de rateio do histórico (no
 *     4T 2024, o imobilizado e o PL seguem a linha 147 da Gerencial 24);
 *   - o que não tem regional fica em "Sem regional", e a soma das colunas
 *     fecha com a DRE do histórico na última linha.
 * O sinal é o da DRE do histórico, com o custo negativo. A planilha não segue
 * uma regra só (o benefício ora pelo faturamento, ora job a job; o TD ÷4 em
 * alguns trimestres); as diferenças estão na decisão 211.
 */
import { CONTAS_PROPRIAS, TEXTO_DA_REGRA, aplicar, type Regra } from "./dre";

export type EmpresaDoRegional = "Agência California" | "CCH";

/**
 * As empresas com rateio, a sigla do Tipo e as regionais na ordem das abas
 * Gerencial, com os códigos da planilha que não são o nome no sistema (a
 * coluna Reg e a divisão dos jobs; a Urbia não é regional do sistema). O
 * código de outra empresa (o "NE" num lançamento da CMH) fica sem regional.
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
  /** A regional do lançamento ou da parte do job (o nome no sistema, ou o código da planilha); nula no TD e no que não tem regional. */
  regional: string | null;
  /** TD: de todas as regionais, para ratear. */
  todas: boolean;
  /** O faturamento ou o custo operacional dividido pelas partes do job, e não pela regional do lançamento. */
  peloJob: boolean;
  credito: number;
  debito: number;
  /** No faturamento: o imposto teórico, o valor × a alíquota do job (zero sem job ou sem alíquota). */
  teorico: number;
};
/** O mesmo, pela chave de empréstimo da coluna Jobs ("FIT 1T 2024"). */
export type AgregadoRegionalJobs = Omit<AgregadoRegional, "sigla" | "grupo" | "peloJob" | "teorico"> & { prefixo: string };

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

/**
 * As partes de um job como o pacote leva ("NE:0.25;SP:0.75"), divididas pela
 * soma, como a função do banco divide; vazio quando a planilha não divide o
 * job (ou as partes somam zero).
 */
export function partesDoJob(texto: string | null): { codigo: string; parte: number }[] {
  const partes = (texto ?? "")
    .split(";")
    .filter(Boolean)
    .map((p) => {
      const [codigo, valor] = p.split(":");
      return { codigo, parte: Number(valor) };
    });
  const soma = partes.reduce((s, p) => s + p.parte, 0);
  return soma === 0 ? [] : partes.map((p) => ({ codigo: p.codigo, parte: p.parte / soma }));
}

type Origem = { grupos: readonly string[] } | { jobs: string };
/** De quais lançamentos a linha sai: só os da regional (e os sem regional), só o TD rateado, ou tudo. */
type Parte = "regional" | "td" | "tudo";
type ItemDoModelo =
  | { tipo: "linha"; chave: string; rotulo: string; origem: Origem; regra: Regra; parte: Parte; dentroDeGrupo?: true }
  /** O imposto teórico do faturamento, com a divisão do faturamento. */
  | { tipo: "teorico"; chave: string; rotulo: string }
  /** O benefício do ISS e do PERSE: o teórico menos o pago, rateado pelo faturamento de cada trimestre. */
  | { tipo: "beneficio"; chave: string; rotulo: string }
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
  { tipo: "teorico", chave: "IMP", rotulo: "Imposto sem o benefício" },
  custo("CO", "Custo operacional", ["CO"]),
  { tipo: "total", chave: "RO", rotulo: "Resultado operacional", soma: ["REC", "IMP", "CO"] },
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

const DEPOIS_DO_LUCRO: ItemDoModelo[] = [
  { tipo: "beneficio", chave: "BEN", rotulo: "Benefício tributário (ISS + PERSE)" },
  entrada("RF", "Receita financeira", ["RF"]),
  { tipo: "total", chave: "RAB", rotulo: "Resultado após o benefício", soma: ["LL", "BEN", "RF"] },
];

/** As linhas de cada empresa, na ordem da tela. */
export const MODELOS_DO_REGIONAL: Readonly<Record<EmpresaDoRegional, readonly ItemDoModelo[]>> = {
  "Agência California": [
    ...ATE_O_LUCRO,
    { tipo: "linha", chave: "PERDA", rotulo: "Perda (FitDance)", origem: { jobs: "FIT" }, regra: "credito-debito", parte: "tudo" },
    { tipo: "total", chave: "LL", rotulo: "Lucro líquido", soma: ["RO", "GFR", "GFG", "OUT", "PERDA"] },
    ...DEPOIS_DO_LUCRO,
    custo("IMOB", "Imobilizado", ["IMOB"]),
    custo("PL", "Participação nos lucros", ["PL"]),
    { tipo: "total", chave: "LLI", rotulo: "Lucro após investimento", soma: ["RAB", "IMOB", "PL"] },
  ],
  CCH: [
    ...ATE_O_LUCRO,
    { tipo: "total", chave: "LL", rotulo: "Lucro líquido", soma: ["RO", "GFR", "GFG", "OUT"] },
    ...DEPOIS_DO_LUCRO,
    custo("IMOB", "Imobilizado", ["IMOB"]),
    custo("DOC", "Investimento Doca", ["DOC"]),
    custo("MK", "Makkna", ["MK"]),
    custo("PL", "Participação nos lucros", ["PL"]),
    { tipo: "total", chave: "LLI", rotulo: "Lucro após investimento", soma: ["RAB", "IMOB", "DOC", "MK", "PL"] },
  ],
};

/** As chaves da coluna Jobs que o resultado por regional usa. */
export const PREFIXOS_DO_REGIONAL: readonly string[] = ["FIT"];

/** Os grupos que a divisão do job reparte (o resto segue a regional do lançamento). */
const DIVIDIDOS_PELO_JOB = ["REC", "CO"];

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
  /** O faturamento que não veio dividido por um job (sem job, ou job que a planilha não divide): ficou na regional do lançamento. */
  faturamentoSemDivisao: number;
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
  // Os lançamentos da empresa, sem os das contas próprias de outra empresa.
  const daSigla = porGrupo.filter((a) => a.sigla === sigla && !deOutraEmpresa.has(a.aba));
  const dosJobs = porJobs.filter((a) => !deOutraEmpresa.has(a.aba));

  // As regionais da tela: as da empresa com lançamento ou com percentual no ano, na ordem da aba.
  const comLancamento = new Set(
    [...daSigla, ...dosJobs].flatMap((a) => {
      const r = daEmpresa(a.regional);
      return r ? [r] : [];
    }),
  );
  const comPercentual = new Set(doAno.filter((r) => r.percentual > 0).map((r) => r.regional));
  const colunas = ordem.filter((r) => comLancamento.has(r) || comPercentual.has(r));

  type Exatos = { regionais: number[]; semRegional: number };
  const vazio = (): Exatos => ({ regionais: colunas.map(() => 0), semRegional: 0 });
  /** Um valor na regional dele, o TD pelo percentual do trimestre e grupo, e o resto em "Sem regional". */
  const alocar = (destino: Exatos, a: { regional: string | null; todas: boolean; trimestre: number }, grupo: string, v: number, parte: Parte) => {
    if (a.todas) {
      if (parte === "regional") return;
      const p = percentuais(a.trimestre, grupo);
      let rateado = 0;
      colunas.forEach((r, i) => {
        const pct = p.get(r) ?? 0;
        destino.regionais[i] += v * pct;
        rateado += pct;
      });
      // O que o percentual não cobre (ano sem rateio) fica sem regional.
      destino.semRegional += v * (1 - rateado);
    } else {
      if (parte === "td") return;
      const regional = daEmpresa(a.regional);
      const i = regional ? colunas.indexOf(regional) : -1;
      if (i >= 0) destino.regionais[i] += v;
      else destino.semRegional += v;
    }
  };

  const exatos = new Map<string, Exatos>();
  const itens = MODELOS_DO_REGIONAL[empresa];
  for (const item of itens) {
    const valor = vazio();
    if (item.tipo === "linha") {
      const { origem, regra, parte } = item;
      if ("grupos" in origem) {
        for (const a of daSigla) {
          if (trimestres.includes(a.trimestre) && origem.grupos.includes(a.grupo)) alocar(valor, a, a.grupo, aplicar(regra, a.credito, a.debito), parte);
        }
      } else {
        for (const a of dosJobs) {
          if (trimestres.includes(a.trimestre) && a.prefixo === origem.jobs) alocar(valor, a, "", aplicar(regra, a.credito, a.debito), parte);
        }
      }
    } else if (item.tipo === "teorico") {
      for (const a of daSigla) {
        if (trimestres.includes(a.trimestre) && a.grupo === "REC") alocar(valor, a, "REC", -a.teorico, "tudo");
      }
    } else if (item.tipo === "beneficio") {
      // Trimestre a trimestre, como a planilha: o benefício do trimestre pelo faturamento de cada regional nele.
      for (const t of trimestres) {
        const doTrimestre = daSigla.filter((a) => a.trimestre === t);
        const teorico = doTrimestre.filter((a) => a.grupo === "REC").reduce((s, a) => s + a.teorico, 0);
        const pago = doTrimestre.filter((a) => a.grupo === "CT").reduce((s, a) => s + a.debito - a.credito, 0);
        const beneficio = teorico - pago;
        if (beneficio === 0) continue;
        const faturamento = vazio();
        for (const a of doTrimestre) if (a.grupo === "REC") alocar(faturamento, a, "REC", a.credito - a.debito, "tudo");
        const total = faturamento.regionais.reduce((s, f) => s + f, 0) + faturamento.semRegional;
        // Sem faturamento no trimestre, não há por onde ratear.
        if (Math.abs(total) < 0.005) {
          valor.semRegional += beneficio;
          continue;
        }
        faturamento.regionais.forEach((f, i) => (valor.regionais[i] += (beneficio * f) / total));
        valor.semRegional += (beneficio * faturamento.semRegional) / total;
      }
    } else {
      continue;
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
    const e = exatos.get(item.chave);
    if (!e) continue;
    const r = arredondarComTotal([...e.regionais, e.semRegional]);
    const semRegional = r.pop()!;
    arredondados.set(item.chave, comTotal(r, semRegional));
    origens.set(item.chave, origemDaLinha(item, sigla));
  }
  const linhas: LinhaDoRegional[] = [];
  for (const item of itens) {
    if (item.tipo === "grupo" || item.tipo === "total") {
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
      tipo: item.tipo === "grupo" || item.tipo === "total" ? item.tipo : "linha",
      nivel: item.tipo === "linha" && item.dentroDeGrupo ? 1 : 0,
      origem: origens.get(item.chave)!,
      ...v,
    });
  }

  const semDivisao = daSigla
    .filter((a) => trimestres.includes(a.trimestre) && a.grupo === "REC" && !a.peloJob)
    .reduce((s, a) => s + emCentavos(a.credito - a.debito), 0);
  return { colunas, temSemRegional: linhas.some((l) => l.semRegional !== 0), faturamentoSemDivisao: semDivisao / 100, linhas };
}

/** De onde a linha sai, em palavras, para a dica da tela. */
function origemDaLinha(item: ItemDoModelo, sigla: string): string {
  const tipo = (grupos: readonly string[]) => `Tipo ${grupos.map((g) => [sigla, g].filter(Boolean).join(" ")).join(" e ")}`;
  if (item.tipo === "teorico") {
    return `${tipo(["REC"])} × a alíquota do job (Imp Real % das abas Res. Jobs) · com a divisão do faturamento`;
  }
  if (item.tipo === "beneficio") {
    return `Imposto teórico − imposto pago (${tipo(["CT"])}) de cada trimestre · rateado pelo faturamento de cada regional no trimestre`;
  }
  if (item.tipo !== "linha") return "";
  const fonte = "grupos" in item.origem ? tipo(item.origem.grupos) : `Coluna Jobs "${item.origem.jobs} nT"`;
  const parte =
    "grupos" in item.origem && item.origem.grupos.some((g) => DIVIDIDOS_PELO_JOB.includes(g))
      ? "a divisão do job (RATEIO % das abas Res. Jobs); sem ela, a regional do lançamento e o TD pelo percentual do ano"
      : item.parte === "regional"
        ? "só os lançamentos com regional"
        : item.parte === "td"
          ? "só o TD, pelo percentual do ano"
          : "a regional de cada lançamento e o TD pelo percentual do ano";
  return `${fonte} · ${TEXTO_DA_REGRA[item.regra]} · ${parte}`;
}
