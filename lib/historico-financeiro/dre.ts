/**
 * A DRE do histórico (decisão 211, A4): a DRE por competência das abas DRE da
 * planilha financeira — California, CMH (a CCH no sistema), Hitlab e Ventura —
 * refeita a partir dos lançamentos do histórico.
 *
 * Cada linha da planilha soma os lançamentos com o Tipo dela (empresa, grupo e
 * trimestre: "CMH CO 1T 2025"), ou, nos empréstimos entre empresas e na perda
 * da FitDance, os lançamentos com a chave na coluna Jobs ("CMH 1T 2025").
 *
 * A planilha não é uniforme, e aqui as diferenças viram uma regra só:
 *   - o sinal: uma mesma linha desconta o crédito numa conta e não desconta na
 *     outra. Aqui a receita é crédito − débito; o custo e a despesa, débito −
 *     crédito; os empréstimos e o mútuo seguem separados pelo sinal, como na
 *     planilha;
 *   - as contas: cada DRE soma só as contas que tem como coluna, e a lista
 *     muda de um ano para outro. Aqui cada DRE soma todas as contas (a sigla
 *     do Tipo já diz de qual empresa é a linha), menos as contas próprias de
 *     outra empresa: a Santander da Hitlab só entra na DRE da Hitlab, como na
 *     planilha;
 *   - a ordem: a bonificação fica depois do imobilizado em todas, como na DRE
 *     da California desde 2024 (na da CMH, da Hitlab e da Ventura ela vem
 *     antes do resultado líquido operacional). O lucro líquido não muda.
 * As diferenças para a planilha, com os números, estão na decisão 211.
 */

export type EmpresaDaDre = "Agência California" | "CCH" | "Hitlab" | "Ventura";

/** As empresas da DRE, com a sigla do Tipo na planilha e a aba da DRE dela. */
export const EMPRESAS_DA_DRE: readonly { empresa: EmpresaDaDre; sigla: string; aba: string }[] = [
  { empresa: "Agência California", sigla: "", aba: "DRE" },
  { empresa: "CCH", sigla: "CMH", aba: "DRE CMH" },
  { empresa: "Hitlab", sigla: "HIT", aba: "DRE HIT" },
  { empresa: "Ventura", sigla: "VT", aba: "DRE Ventura" },
];

/** As contas (pela aba da planilha) que são de uma empresa só: não entram na DRE das outras. */
export const CONTAS_PROPRIAS: Readonly<Partial<Record<EmpresaDaDre, readonly string[]>>> = {
  Hitlab: ["Santander Hitlab"],
};

/** A soma de crédito e débito por sigla, grupo, trimestre de competência e conta (a aba), num ano. */
export type AgregadoPorGrupo = { sigla: string; grupo: string; trimestre: number; aba: string; credito: number; debito: number };
/** A soma de crédito e débito por chave da coluna Jobs ("CMH", "HIT FIT"), trimestre e conta (a aba), num ano. */
export type AgregadoPorJobs = { prefixo: string; trimestre: number; aba: string; credito: number; debito: number };

type Regra = "credito-debito" | "debito-credito" | "credito" | "-debito" | "-(debito-credito)";

type ItemDoModelo =
  | {
      tipo: "linha";
      chave: string;
      rotulo: string;
      origem: { grupo: string } | { jobs: string };
      regra: Regra;
      /** Como a linha entra no subtotal seguinte: o custo aparece positivo e subtrai. */
      sinal: 1 | -1;
    }
  | { tipo: "subtotal"; chave: string; rotulo: string };

const receita = (chave: string, rotulo: string): ItemDoModelo => ({
  tipo: "linha", chave, rotulo, origem: { grupo: chave }, regra: "credito-debito", sinal: 1,
});
const custo = (chave: string, rotulo: string): ItemDoModelo => ({
  tipo: "linha", chave, rotulo, origem: { grupo: chave }, regra: "debito-credito", sinal: -1,
});
/** A saída que a planilha já mostra negativa (juros, imobilizado, distribuição…) e soma no subtotal. */
const saida = (chave: string, rotulo: string, grupo = chave): ItemDoModelo => ({
  tipo: "linha", chave, rotulo, origem: { grupo }, regra: "-(debito-credito)", sinal: 1,
});
const jobs = (chave: string, rotulo: string, prefixo: string): ItemDoModelo => ({
  tipo: "linha", chave, rotulo, origem: { jobs: prefixo }, regra: "credito-debito", sinal: 1,
});
const subtotal = (chave: string, rotulo: string): ItemDoModelo => ({ tipo: "subtotal", chave, rotulo });

const ATE_O_FINANCEIRO: ItemDoModelo[] = [
  receita("REC", "(+) Receita"),
  custo("CO", "(−) Custo operacional"),
  custo("CT", "(−) Custo tributário"),
  subtotal("RB", "Resultado bruto operacional"),
  custo("CF", "(−) Custo fixo"),
  custo("DP", "(−) Despesa com pessoal"),
  custo("DM", "(−) Despesa de marketing"),
  custo("DA", "(−) Despesa administrativa"),
  custo("DC", "(−) Despesa comercial"),
  custo("DT", "(−) Despesa trabalhista"),
  subtotal("RLOA", "Resultado líquido operacional antes da receita financeira"),
  receita("RF", "(+) Receita financeira"),
  saida("DJ", "(−) Despesa com juros"),
  { tipo: "linha", chave: "EMP+", rotulo: "(+) Empréstimos", origem: { grupo: "EMP" }, regra: "credito", sinal: 1 },
  { tipo: "linha", chave: "EMP-", rotulo: "(−) Empréstimos", origem: { grupo: "EMP" }, regra: "-debito", sinal: 1 },
  subtotal("RLO", "Resultado líquido operacional"),
  saida("IMOB", "(−) Imobilizado"),
  saida("PL", "(−) Bonificação"),
];

const MUTUO: ItemDoModelo[] = [
  { tipo: "linha", chave: "MUTUO-", rotulo: "(−) Mútuo interno", origem: { grupo: "MÚTUO INT" }, regra: "-debito", sinal: 1 },
  { tipo: "linha", chave: "MUTUO+", rotulo: "(+) Mútuo interno", origem: { grupo: "MÚTUO INT" }, regra: "credito", sinal: 1 },
];

/** As linhas da DRE de cada empresa, na ordem da tela. */
export const MODELOS_DA_DRE: Readonly<Record<EmpresaDaDre, readonly ItemDoModelo[]>> = {
  "Agência California": [
    ...ATE_O_FINANCEIRO,
    subtotal("LL", "Lucro líquido"),
    saida("DL", "Distribuição de lucro"),
    jobs("J-FIT", "Perda (FitDance)", "FIT"),
    jobs("J-CMH", "Empréstimo à CCH", "CMH"),
    jobs("J-HIT", "Empréstimo à Hitlab", "HIT"),
    jobs("J-CMT", "Empréstimo à Community", "CMT"),
    jobs("J-IFL", "Empréstimo à Infloo", "IFL"),
    jobs("J-VT", "Empréstimo à Ventura", "VT"),
    ...MUTUO,
    saida("PT", "Provisão trabalhista"),
    subtotal("REINV", "Reinvestimento no caixa"),
  ],
  // A linha "Empréstimo ao FitDance" da DRE CMH não tem fórmula (N/A e #REF!):
  // a chave "FIT" da coluna Jobs é a perda da California.
  CCH: [
    ...ATE_O_FINANCEIRO,
    saida("DOC", "(−) Doca"),
    saida("MK", "(−) Makkna"),
    subtotal("LL", "Lucro líquido"),
    saida("DL", "Distribuição de lucro"),
    saida("PT", "Provisão trabalhista"),
    subtotal("REINV", "Reinvestimento no caixa"),
  ],
  Hitlab: [
    ...ATE_O_FINANCEIRO,
    subtotal("LL", "Lucro líquido"),
    saida("DL", "Distribuição de lucro"),
    jobs("J-FIT", "Empréstimo à FitDance", "HIT FIT"),
    jobs("J-CMH", "Empréstimo à CCH", "HIT CMH"),
    ...MUTUO,
    saida("PT", "Provisão trabalhista"),
    subtotal("REINV", "Reinvestimento no caixa"),
  ],
  Ventura: [
    ...ATE_O_FINANCEIRO,
    subtotal("LL", "Lucro líquido"),
    saida("DL", "Distribuição de lucro"),
    saida("PT", "Provisão trabalhista"),
    subtotal("REINV", "Reinvestimento no caixa"),
  ],
};

/** As chaves da coluna Jobs que alguma DRE usa: a função do banco só soma estas. */
export const PREFIXOS_DA_DRE: readonly string[] = [
  ...new Set(
    Object.values(MODELOS_DA_DRE).flatMap((itens) =>
      itens.flatMap((i) => (i.tipo === "linha" && "jobs" in i.origem ? [i.origem.jobs] : [])),
    ),
  ),
];

/**
 * A chave de empréstimo de um texto da coluna Jobs: "CMH 1T 2025" vira CMH,
 * 1º trimestre, 2025. Maiúsculas e um espaço só, como a função do banco lê.
 */
export function chaveDaColunaJobs(texto: string | null): { prefixo: string; trimestre: number; ano: number } | null {
  if (!texto) return null;
  const m = /^(.*\S) ([1-4])T ((?:19|20)\d\d)$/.exec(texto.trim().replace(/\s+/g, " ").toUpperCase());
  return m ? { prefixo: m[1], trimestre: Number(m[2]), ano: Number(m[3]) } : null;
}

export type LinhaDaDre = {
  chave: string;
  rotulo: string;
  subtotal: boolean;
  /** Do 1º ao 4º trimestre. */
  trimestres: [number, number, number, number];
  ano: number;
  /** De onde a linha sai, para a dica da tela. */
  origem: string;
};

const centavos = (n: number) => Math.round(n * 100);
const deCentavos = (c: number) => c / 100;

function aplicar(regra: Regra, credito: number, debito: number): number {
  if (regra === "credito-debito") return credito - debito;
  if (regra === "debito-credito") return debito - credito;
  if (regra === "credito") return credito;
  if (regra === "-debito") return -debito;
  return -(debito - credito);
}

const TEXTO_DA_REGRA: Record<Regra, string> = {
  "credito-debito": "crédito − débito",
  "debito-credito": "débito − crédito",
  credito: "o crédito",
  "-debito": "o débito, negativo",
  "-(debito-credito)": "débito − crédito, negativo",
};

/**
 * A DRE de uma empresa num ano, a partir das somas do ano. Os valores vão em
 * centavos; cada subtotal soma as linhas desde o começo, com o sinal de cada uma.
 */
export function montarDre(
  empresa: EmpresaDaDre,
  porGrupo: readonly AgregadoPorGrupo[],
  porJobs: readonly AgregadoPorJobs[],
): LinhaDaDre[] {
  const sigla = EMPRESAS_DA_DRE.find((e) => e.empresa === empresa)!.sigla;
  const deOutraEmpresa = new Set(
    Object.entries(CONTAS_PROPRIAS).flatMap(([dona, abas]) => (dona === empresa ? [] : abas ?? [])),
  );
  const somar = (mapa: Map<string, { credito: number; debito: number }>, chave: string, credito: number, debito: number) => {
    const s = mapa.get(chave) ?? { credito: 0, debito: 0 };
    mapa.set(chave, { credito: s.credito + credito, debito: s.debito + debito });
  };
  const doGrupo = new Map<string, { credito: number; debito: number }>();
  for (const a of porGrupo) {
    if (a.sigla === sigla && !deOutraEmpresa.has(a.aba)) somar(doGrupo, `${a.grupo}|${a.trimestre}`, a.credito, a.debito);
  }
  const doJobs = new Map<string, { credito: number; debito: number }>();
  for (const a of porJobs) if (!deOutraEmpresa.has(a.aba)) somar(doJobs, `${a.prefixo}|${a.trimestre}`, a.credito, a.debito);

  const linhas: LinhaDaDre[] = [];
  let acumulado = [0, 0, 0, 0];
  for (const item of MODELOS_DA_DRE[empresa]) {
    if (item.tipo === "subtotal") {
      linhas.push({
        chave: item.chave,
        rotulo: item.rotulo,
        subtotal: true,
        trimestres: acumulado.map(deCentavos) as LinhaDaDre["trimestres"],
        ano: deCentavos(acumulado.reduce((s, v) => s + v, 0)),
        origem: "Soma das linhas de cima",
      });
      continue;
    }
    const porTipo = "grupo" in item.origem;
    const chave = porTipo ? (item.origem as { grupo: string }).grupo : (item.origem as { jobs: string }).jobs;
    const fonte = porTipo ? doGrupo : doJobs;
    const valores = [1, 2, 3, 4].map((t) => {
      const s = fonte.get(`${chave}|${t}`);
      return s ? centavos(aplicar(item.regra, s.credito, s.debito)) : 0;
    });
    acumulado = acumulado.map((v, k) => v + item.sinal * valores[k]);
    linhas.push({
      chave: item.chave,
      rotulo: item.rotulo,
      subtotal: false,
      trimestres: valores.map(deCentavos) as LinhaDaDre["trimestres"],
      ano: deCentavos(valores.reduce((s, v) => s + v, 0)),
      origem: porTipo
        ? `Tipo "${[sigla, chave].filter(Boolean).join(" ")} nT" · ${TEXTO_DA_REGRA[item.regra]}`
        : `Coluna Jobs "${chave} nT" · ${TEXTO_DA_REGRA[item.regra]}`,
    });
  }
  return linhas;
}
