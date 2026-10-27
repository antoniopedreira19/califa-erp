/**
 * O resultado por regional do histórico (decisão 211, A4): as linhas da DRE
 * regional da planilha — as abas "DRE Califa Regional" e "DRE CMH Regional"
 * do Fechamento, que somam as Res. Jobs e as Gerencial: o faturamento, o
 * imposto e o custo operacional, os gastos fixos da regional e os gerais, o
 * lucro, o benefício tributário, a receita financeira, o imobilizado, a
 * participação nos lucros e os projetos proprietários —, refeitas dos
 * lançamentos do histórico numa regra só:
 *   - o faturamento e o custo operacional do job se dividem pelas partes dele
 *     (o grupo "RATEIO %" das abas Res. Jobs). O imposto é o teórico: o
 *     faturamento × a alíquota do job ("Imp Real %"), com a mesma divisão;
 *   - os projetos proprietários (o job sem divisão com "COPA" ou "CMH" na
 *     coluna REGIONAL) saem dessas linhas e entram num bloco abaixo do
 *     resultado, somados só no lucro após investimento, divididos como o
 *     Fechamento divide: a Copa metade no NE e metade no SP, os da CCH na Doca
 *     (Tiago, 26/10/2026);
 *   - o benefício do ISS e do PERSE (o imposto teórico menos o imposto pago,
 *     Tipo CT) se rateia, trimestre a trimestre, pelo faturamento de cada
 *     regional e dos projetos, e entra depois do lucro líquido;
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

/** Um projeto proprietário: o nome na tela e a parte de cada regional nele. */
export type ProjetoProprietario = { rotulo: string; divisao: Readonly<Record<string, number>> };

/**
 * As empresas com rateio, a sigla do Tipo e as regionais na ordem das abas
 * Gerencial, com os códigos da planilha que não são o nome no sistema: os da
 * coluna Reg e da divisão dos jobs (a Urbia não é regional do sistema), e os
 * que só a coluna Reg usa — nas linhas da CMH, "NE" é a Doca e "SP" é a Agency
 * (Tiago, 26/10/2026). Outro código de outra empresa (o "RJ" numa linha da
 * CMH, ou o "NE" da divisão de um job da California) fica sem regional.
 *
 * Os projetos proprietários, pelo texto da coluna REGIONAL do job, com a
 * divisão das fórmulas do Fechamento: "DRE Califa Regional", linhas 300 a 303
 * (a soma dos jobs "COPA" ÷ 2, no NE e no SP), e "DRE CMH Regional", linhas
 * 250 a 253 (os jobs "CMH", na Doca).
 */
export const EMPRESAS_DO_REGIONAL: readonly {
  empresa: EmpresaDoRegional;
  sigla: string;
  regionais: readonly string[];
  codigos: Readonly<Record<string, string>>;
  codigosDoLancamento: Readonly<Record<string, string>>;
  projetos: Readonly<Record<string, ProjetoProprietario>>;
}[] = [
  {
    empresa: "Agência California",
    sigla: "",
    regionais: ["NE", "NO", "SP", "RJ", "SS", "BH"],
    codigos: { BH: "BH" },
    codigosDoLancamento: {},
    projetos: { COPA: { rotulo: "Copa", divisao: { NE: 0.5, SP: 0.5 } } },
  },
  {
    empresa: "CCH",
    sigla: "CMH",
    regionais: ["Agency", "Doca", "Urbia"],
    codigos: { AGE: "Agency", DOC: "Doca", URB: "Urbia" },
    codigosDoLancamento: { NE: "Doca", SP: "Agency" },
    projetos: { CMH: { rotulo: "Projetos da CCH", divisao: { Doca: 1 } } },
  },
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
  /** O texto da coluna REGIONAL do job que a planilha não divide ("COPA", "CMH"): marca os projetos proprietários. */
  regionalDoJob: string | null;
  credito: number;
  debito: number;
  /** No faturamento: o imposto teórico, o valor × a alíquota do job (zero sem job ou sem alíquota). */
  teorico: number;
};
/** O mesmo, pela chave de empréstimo da coluna Jobs ("FIT 1T 2024"). */
export type AgregadoRegionalJobs = Omit<AgregadoRegional, "sigla" | "grupo" | "peloJob" | "regionalDoJob" | "teorico"> & { prefixo: string };

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

/** Os projetos proprietários de uma empresa em palavras: "Copa (NE 50% e SP 50%)". */
export function descricaoDosProjetos(empresa: EmpresaDoRegional): string {
  const { projetos } = EMPRESAS_DO_REGIONAL.find((e) => e.empresa === empresa)!;
  return Object.values(projetos)
    .map((p) => `${p.rotulo} (${Object.entries(p.divisao).map(([r, parte]) => `${r} ${Math.round(parte * 100)}%`).join(" e ")})`)
    .join("; ");
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
  /** Uma linha do bloco dos projetos proprietários. */
  | { tipo: "projeto"; chave: string; rotulo: string; parte: "faturamento" | "imposto" | "custo" | "beneficio" }
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

/** O bloco dos projetos proprietários, abaixo do resultado, como no Fechamento. Sem projeto no período, ele não aparece. */
const PROJETOS: ItemDoModelo[] = [
  { tipo: "grupo", chave: "PROJ", rotulo: "Projetos proprietários", membros: ["PREC", "PIMP", "PCO", "PBEN"] },
  { tipo: "projeto", chave: "PREC", rotulo: "Faturamento dos projetos", parte: "faturamento" },
  { tipo: "projeto", chave: "PIMP", rotulo: "Imposto dos projetos", parte: "imposto" },
  { tipo: "projeto", chave: "PCO", rotulo: "Custo operacional dos projetos", parte: "custo" },
  { tipo: "projeto", chave: "PBEN", rotulo: "Benefício tributário dos projetos", parte: "beneficio" },
];
const CHAVES_DOS_PROJETOS = ["PROJ", "PREC", "PIMP", "PCO", "PBEN"];

/** As linhas de cada empresa, na ordem da tela. */
export const MODELOS_DO_REGIONAL: Readonly<Record<EmpresaDoRegional, readonly ItemDoModelo[]>> = {
  "Agência California": [
    ...ATE_O_LUCRO,
    { tipo: "linha", chave: "PERDA", rotulo: "Perda (FitDance)", origem: { jobs: "FIT" }, regra: "credito-debito", parte: "tudo" },
    { tipo: "total", chave: "LL", rotulo: "Lucro líquido", soma: ["RO", "GFR", "GFG", "OUT", "PERDA"] },
    ...DEPOIS_DO_LUCRO,
    custo("IMOB", "Imobilizado", ["IMOB"]),
    custo("PL", "Participação nos lucros", ["PL"]),
    ...PROJETOS,
    { tipo: "total", chave: "LLI", rotulo: "Lucro após investimento", soma: ["RAB", "IMOB", "PL", "PROJ"] },
  ],
  CCH: [
    ...ATE_O_LUCRO,
    { tipo: "total", chave: "LL", rotulo: "Lucro líquido", soma: ["RO", "GFR", "GFG", "OUT"] },
    ...DEPOIS_DO_LUCRO,
    custo("IMOB", "Imobilizado", ["IMOB"]),
    custo("DOC", "Investimento Doca", ["DOC"]),
    custo("MK", "Makkna", ["MK"]),
    custo("PL", "Participação nos lucros", ["PL"]),
    ...PROJETOS,
    { tipo: "total", chave: "LLI", rotulo: "Lucro após investimento", soma: ["RAB", "IMOB", "DOC", "MK", "PL", "PROJ"] },
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
  /** 1: linha dentro de um grupo (Gastos fixos da regional, Gastos fixos gerais, Projetos proprietários). */
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
  /** O faturamento que não veio dividido por um job nem é de projeto (sem job, ou job que a planilha não divide): ficou na regional do lançamento. */
  faturamentoSemDivisao: number;
  /** O período tem projeto proprietário (o bloco aparece)? */
  temProjetos: boolean;
  linhas: LinhaDoRegional[];
};

const centavos = (n: number) => Math.round(n * 100);

/**
 * Arredonda cada parte em centavos sem perder o total: o centavo que sobra vai
 * para as partes de maior fração (o método do maior resto). `totalEmCentavos`
 * fixa o total quando ele vem de fora (o centavo que fecha o imposto pago).
 */
export function arredondarComTotal(valores: readonly number[], totalEmCentavos?: number): number[] {
  const total = totalEmCentavos ?? centavos(valores.reduce((s, v) => s + v, 0));
  const exatos = valores.map((v) => v * 100);
  const piso = exatos.map((v) => Math.floor(v));
  let falta = total - piso.reduce((s, v) => s + v, 0);
  // O resto com seis casas: um empate (meio centavo) não muda de lado com o ruído do ponto flutuante, e fica na ordem das colunas.
  const ordem = exatos.map((v, i) => ({ i, resto: Math.round((v - Math.floor(v)) * 1e6) / 1e6 })).sort((a, b) => b.resto - a.resto);
  const resultado = [...piso];
  for (const { i } of ordem) {
    if (falta <= 0) break;
    resultado[i] += 1;
    falta -= 1;
  }
  // O total de fora pode ficar abaixo da soma dos pisos: tira das partes de menor fração.
  for (const { i } of [...ordem].reverse()) {
    if (falta >= 0) break;
    resultado[i] -= 1;
    falta += 1;
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
  const { sigla, regionais: ordem, codigos, codigosDoLancamento, projetos } = EMPRESAS_DO_REGIONAL.find((e) => e.empresa === empresa)!;
  /**
   * A regional da empresa, pelo nome ou pelo código da planilha (os só da
   * coluna Reg, fora da divisão dos jobs); outra coisa fica sem regional.
   */
  const daEmpresa = (a: { regional: string | null; peloJob?: boolean }) => {
    if (a.regional === null) return null;
    if (ordem.includes(a.regional)) return a.regional;
    const codigo = a.regional.toUpperCase();
    return codigos[codigo] ?? (a.peloJob ? undefined : codigosDoLancamento[codigo]) ?? null;
  };
  /** O projeto proprietário do faturamento ou do custo operacional, pelo texto da coluna REGIONAL do job. */
  const projetoDe = (a: AgregadoRegional): ProjetoProprietario | undefined =>
    DIVIDIDOS_PELO_JOB.includes(a.grupo) && !a.peloJob && a.regionalDoJob ? projetos[a.regionalDoJob.toUpperCase()] : undefined;
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
  const doPeriodo = (a: { trimestre: number }) => trimestres.includes(a.trimestre);

  // As regionais da tela: as da empresa com lançamento (ou com parte num projeto) ou com percentual no ano, na ordem da aba.
  const comLancamento = new Set([
    ...daSigla.flatMap((a) => {
      const projeto = projetoDe(a);
      if (projeto) return Object.keys(projeto.divisao);
      const r = daEmpresa(a);
      return r ? [r] : [];
    }),
    ...dosJobs.flatMap((a) => {
      const r = daEmpresa(a);
      return r ? [r] : [];
    }),
  ]);
  const comPercentual = new Set(doAno.filter((r) => r.percentual > 0).map((r) => r.regional));
  const colunas = ordem.filter((r) => comLancamento.has(r) || comPercentual.has(r));

  type Exatos = { regionais: number[]; semRegional: number };
  const vazio = (): Exatos => ({ regionais: colunas.map(() => 0), semRegional: 0 });
  /** Um valor na regional dele, o TD pelo percentual do trimestre e grupo, e o resto em "Sem regional". */
  const alocar = (
    destino: Exatos,
    a: { regional: string | null; todas: boolean; trimestre: number; peloJob?: boolean },
    grupo: string,
    v: number,
    parte: Parte,
  ) => {
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
      const regional = daEmpresa(a);
      const i = regional ? colunas.indexOf(regional) : -1;
      if (i >= 0) destino.regionais[i] += v;
      else destino.semRegional += v;
    }
  };
  /** Um valor de projeto pela divisão dele. */
  const alocarNoProjeto = (destino: Exatos, projeto: ProjetoProprietario, v: number) => {
    for (const [regional, parte] of Object.entries(projeto.divisao)) {
      const i = colunas.indexOf(regional);
      if (i >= 0) destino.regionais[i] += v * parte;
      else destino.semRegional += v * parte;
    }
  };

  // O benefício, trimestre a trimestre como a planilha: o teórico menos o pago, pelo faturamento de
  // cada regional e de cada projeto no trimestre; a parte dos projetos vai para o bloco deles.
  const beneficio = { operacao: vazio(), projetos: vazio() };
  for (const t of trimestres) {
    const doTrimestre = daSigla.filter((a) => a.trimestre === t);
    const teorico = doTrimestre.filter((a) => a.grupo === "REC").reduce((s, a) => s + a.teorico, 0);
    const pago = doTrimestre.filter((a) => a.grupo === "CT").reduce((s, a) => s + a.debito - a.credito, 0);
    const doTrimestreTodo = teorico - pago;
    if (doTrimestreTodo === 0) continue;
    const faturamento = { operacao: vazio(), projetos: vazio() };
    for (const a of doTrimestre) {
      if (a.grupo !== "REC") continue;
      const projeto = projetoDe(a);
      if (projeto) alocarNoProjeto(faturamento.projetos, projeto, a.credito - a.debito);
      else alocar(faturamento.operacao, a, "REC", a.credito - a.debito, "tudo");
    }
    const somaDe = (e: Exatos) => e.regionais.reduce((s, f) => s + f, 0) + e.semRegional;
    const total = somaDe(faturamento.operacao) + somaDe(faturamento.projetos);
    // Sem faturamento no trimestre, não há por onde ratear.
    if (Math.abs(total) < 0.005) {
      beneficio.operacao.semRegional += doTrimestreTodo;
      continue;
    }
    for (const parte of ["operacao", "projetos"] as const) {
      faturamento[parte].regionais.forEach((f, i) => (beneficio[parte].regionais[i] += (doTrimestreTodo * f) / total));
      beneficio[parte].semRegional += (doTrimestreTodo * faturamento[parte].semRegional) / total;
    }
  }

  const exatos = new Map<string, Exatos>();
  const itens = MODELOS_DO_REGIONAL[empresa];
  for (const item of itens) {
    const valor = vazio();
    if (item.tipo === "linha") {
      const { origem, regra, parte } = item;
      if ("grupos" in origem) {
        for (const a of daSigla) {
          if (doPeriodo(a) && origem.grupos.includes(a.grupo) && !projetoDe(a)) alocar(valor, a, a.grupo, aplicar(regra, a.credito, a.debito), parte);
        }
      } else {
        for (const a of dosJobs) {
          if (doPeriodo(a) && a.prefixo === origem.jobs) alocar(valor, a, "", aplicar(regra, a.credito, a.debito), parte);
        }
      }
    } else if (item.tipo === "teorico") {
      for (const a of daSigla) {
        if (doPeriodo(a) && a.grupo === "REC" && !projetoDe(a)) alocar(valor, a, "REC", -a.teorico, "tudo");
      }
    } else if (item.tipo === "beneficio") {
      exatos.set(item.chave, beneficio.operacao);
      continue;
    } else if (item.tipo === "projeto") {
      if (item.parte === "beneficio") {
        exatos.set(item.chave, beneficio.projetos);
        continue;
      }
      for (const a of daSigla) {
        const projeto = projetoDe(a);
        if (!projeto || !doPeriodo(a)) continue;
        if (item.parte === "faturamento" && a.grupo === "REC") alocarNoProjeto(valor, projeto, a.credito - a.debito);
        else if (item.parte === "imposto" && a.grupo === "REC") alocarNoProjeto(valor, projeto, -a.teorico);
        else if (item.parte === "custo" && a.grupo === "CO") alocarNoProjeto(valor, projeto, a.credito - a.debito);
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

  // O imposto teórico e o benefício somam, sem arredondar, o imposto pago (Tipo CT) do período. Arredondadas
  // uma a uma, as quatro linhas podem errar o centavo: o benefício da operação fecha o centavo.
  const totalEmCentavos = (chave: string) => {
    const e = exatos.get(chave);
    return e ? emCentavos(e.regionais.reduce((s, v) => s + v, 0) + e.semRegional) : 0;
  };
  const pagoEmCentavos = daSigla
    .filter((a) => doPeriodo(a) && a.grupo === "CT")
    .reduce((s, a) => s + emCentavos(a.debito - a.credito), 0);
  const beneficioEmCentavos = -pagoEmCentavos - totalEmCentavos("IMP") - totalEmCentavos("PIMP") - totalEmCentavos("PBEN");

  // Primeiro as linhas, arredondadas sem perder o total; depois os grupos e os totais, que somam
  // as linhas como aparecem na tela (o grupo vem antes das linhas dele).
  const arredondados = new Map<string, { regionais: number[]; semRegional: number; total: number }>();
  const origens = new Map<string, string>();
  for (const item of itens) {
    const e = exatos.get(item.chave);
    if (!e) continue;
    const r = arredondarComTotal([...e.regionais, e.semRegional], item.tipo === "beneficio" ? beneficioEmCentavos : undefined);
    const semRegional = r.pop()!;
    arredondados.set(item.chave, comTotal(r, semRegional));
    origens.set(item.chave, origemDaLinha(item, sigla, projetos));
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
      nivel: (item.tipo === "linha" && item.dentroDeGrupo) || item.tipo === "projeto" ? 1 : 0,
      origem: origens.get(item.chave)!,
      ...v,
    });
  }

  // Sem projeto no período, o bloco dele não aparece.
  const temProjetos = daSigla.some((a) => doPeriodo(a) && projetoDe(a) !== undefined);
  const visiveis = temProjetos ? linhas : linhas.filter((l) => !CHAVES_DOS_PROJETOS.includes(l.chave));
  const semDivisao = daSigla
    .filter((a) => doPeriodo(a) && a.grupo === "REC" && !a.peloJob && !projetoDe(a))
    .reduce((s, a) => s + emCentavos(a.credito - a.debito), 0);
  return {
    colunas,
    temSemRegional: visiveis.some((l) => l.semRegional !== 0),
    faturamentoSemDivisao: semDivisao / 100,
    temProjetos,
    linhas: visiveis,
  };
}

/** De onde a linha sai, em palavras, para a dica da tela. */
function origemDaLinha(item: ItemDoModelo, sigla: string, projetos: Readonly<Record<string, ProjetoProprietario>>): string {
  const tipo = (grupos: readonly string[]) => `Tipo ${grupos.map((g) => [sigla, g].filter(Boolean).join(" ")).join(" e ")}`;
  const marcas = Object.keys(projetos).map((m) => `"${m}"`).join(" ou ");
  const divisao = Object.values(projetos)
    .map((p) => Object.entries(p.divisao).map(([r, parte]) => `${r} ${Math.round(parte * 100)}%`).join(" e "))
    .join("; ");
  const dosProjetos = `jobs com ${marcas} na coluna REGIONAL das abas Res. Jobs`;
  if (item.tipo === "teorico") {
    return `${tipo(["REC"])} × a alíquota do job (Imp Real % das abas Res. Jobs) · com a divisão do faturamento, sem os projetos proprietários`;
  }
  if (item.tipo === "beneficio") {
    return `Imposto teórico − imposto pago (${tipo(["CT"])}) de cada trimestre · rateado pelo faturamento de cada regional no trimestre, sem a parte dos projetos proprietários`;
  }
  if (item.tipo === "projeto") {
    const fonte =
      item.parte === "faturamento"
        ? `${tipo(["REC"])} dos ${dosProjetos} · crédito − débito`
        : item.parte === "imposto"
          ? `${tipo(["REC"])} dos ${dosProjetos} × a alíquota do job (Imp Real %)`
          : item.parte === "custo"
            ? `${tipo(["CO"])} dos ${dosProjetos} · débito − crédito`
            : "A parte do benefício de cada trimestre que cabe ao faturamento dos projetos";
    return `${fonte} · dividido como o Fechamento: ${divisao}`;
  }
  if (item.tipo !== "linha") return "";
  const fonte = "grupos" in item.origem ? tipo(item.origem.grupos) : `Coluna Jobs "${item.origem.jobs} nT"`;
  const parte =
    "grupos" in item.origem && item.origem.grupos.some((g) => DIVIDIDOS_PELO_JOB.includes(g))
      ? "a divisão do job (RATEIO % das abas Res. Jobs); sem ela, a regional do lançamento e o TD pelo percentual do ano; sem os projetos proprietários"
      : item.parte === "regional"
        ? "só os lançamentos com regional"
        : item.parte === "td"
          ? "só o TD, pelo percentual do ano"
          : "a regional de cada lançamento e o TD pelo percentual do ano";
  return `${fonte} · ${TEXTO_DA_REGRA[item.regra]} · ${parte}`;
}
