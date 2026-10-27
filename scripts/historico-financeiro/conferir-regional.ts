/**
 * A4 da importação do histórico financeiro (decisão 211): confere o resultado
 * por regional do histórico (`lib/historico-financeiro/regional.ts`) contra a
 * planilha, em duas frentes:
 *
 *   - as abas Gerencial (sempre): trimestre a trimestre e regional a regional,
 *     as linhas em que a planilha e o histórico seguem a mesma fonte — o custo
 *     fixo e a despesa com pessoal da regional (os lançamentos com a regional),
 *     os mesmos do TD rateados pelo percentual do ano, o imobilizado e a
 *     participação nos lucros (a regional e o TD). Onde a planilha usa outro
 *     critério, já medido na decisão 211 (o TD ÷4 em alguns trimestres), a
 *     diferença sai marcada;
 *   - a DRE regional do Fechamento (com `--fechamento`): as abas "DRE Califa
 *     Regional" e "DRE CMH Regional" — o faturamento, o imposto teórico, o
 *     custo operacional e o benefício do ISS e do PERSE de cada regional.
 *
 * A soma dos movimentos repete a função do banco: o faturamento e o custo
 * operacional do job que a planilha divide saem pelas partes dele, com o
 * imposto teórico (o faturamento × a alíquota do job).
 *
 * Uso (as opções de fonte são as de `movimentos-para-conferir.ts`):
 *   npx tsx scripts/historico-financeiro/conferir-regional.ts <pasta-da-versao> \
 *     [--padronizado --com-previsoes] [--fechamento <Fechamento.xlsx>]
 *
 * Saída em <pasta-da-versao>/validacao/regional*.csv e regional-fechamento*.csv.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BOM, linhaCsv } from "../../lib/historico-financeiro/csv";
import { chaveDaColunaJobs } from "../../lib/historico-financeiro/dre";
import { lerPacote } from "../../lib/historico-financeiro/pacote";
import { normalizarTexto } from "../../lib/historico-financeiro/regras";
import {
  PREFIXOS_DO_REGIONAL,
  montarRegional,
  partesDoJob,
  type AgregadoRegional,
  type AgregadoRegionalJobs,
  type EmpresaDoRegional,
  type PercentualDoRateio,
} from "../../lib/historico-financeiro/regional";
import { abrirXlsx, linhasDaAba } from "../../lib/historico-financeiro/xlsx-em-fluxo";
import { lerMovimentos } from "./movimentos-para-conferir";

/** As abas Gerencial de 2023 a 2026; a de 2026 tem as colunas da CMH ao lado. */
const ABAS: readonly { aba: string; ano: number }[] = [
  { aba: "Gerencial 23", ano: 2023 },
  { aba: "Gerencial 24", ano: 2024 },
  { aba: "Gerencial 25", ano: 2025 },
  { aba: "Gerencial 26", ano: 2026 },
  { aba: "Gerencial 23 CMH", ano: 2023 },
  { aba: "Gerencial 24 CMH", ano: 2024 },
  { aba: "Gerencial 25 CMH", ano: 2025 },
];
const REGIONAL_DA_COLUNA: Record<string, string> = {
  NE: "NE", NO: "NO", SP: "SP", SS: "SS", RJ: "RJ", BH: "BH", AGE: "Agency", AGENCY: "Agency", DOC: "Doca", DOCA: "Doca", URB: "Urbia", URBIA: "Urbia",
};
const EMPRESA_DA_REGIONAL = (r: string): EmpresaDoRegional => (["Agency", "Doca", "Urbia"].includes(r) ? "CCH" : "Agência California");

/** O rótulo da linha Gerencial (sem acento, sem espaço) → a linha do modelo. Só a primeira de cada bloco. */
const POR_ROTULO: [RegExp, string][] = [
  [/^CUSTOFIXOREGIONAL$/, "CFR"],
  [/^DESPESACPESSOALREGIONAL$/, "DPR"],
  [/^CUSTOFIXOGERAL$/, "CFG"],
  [/^DESPESACPESSOALGERAL$/, "DPG"],
  [/^IMOBILIZADO/, "IMOB"],
  [/PARTICIPA..ONOSLUCROS$|PARTICIPACAOLUCROS$/, "PL"],
];

/** Os trimestres em que a planilha não usa o percentual do ano (decisão 211). */
const EXCECOES = new Set([
  "Agência California|2023|1|IMOB", "Agência California|2023|4|CFG", "Agência California|2023|4|DPG", "Agência California|2023|4|PL",
  "Agência California|2025|3|IMOB", "Agência California|2025|4|IMOB", "Agência California|2025|4|PL", "Agência California|2026|4|IMOB",
  "CCH|2023|1|IMOB", "CCH|2025|4|PL",
]);

/** As abas da DRE regional do Fechamento e a regional de cada coluna (na CMH, "SE"/"NE" são Agency e Doca). */
const DRES_REGIONAIS: readonly { aba: string; empresa: EmpresaDoRegional; colunas: Record<string, string> }[] = [
  { aba: "DRE Califa Regional", empresa: "Agência California", colunas: { NE: "NE", NO: "NO", SP: "SP", SS: "SS", RJ: "RJ", BH: "BH" } },
  { aba: "DRE CMH Regional", empresa: "CCH", colunas: { SE: "Agency", AGE: "Agency", NE: "Doca", DOC: "Doca", URB: "Urbia" } },
];
/** O rótulo da linha da DRE regional (sem acento, sem espaço) → a linha do modelo. Só a primeira de cada bloco. */
const POR_ROTULO_DA_DRE: [RegExp, string][] = [
  [/^FATURAMENTO$/, "REC"],
  [/^IMPOSTOSEMPERSE$|^IMPOSTO$/, "IMP"],
  [/^CUSTOOPERACIONAL$/, "CO"],
  // O bloco dos projetos proprietários ("DRE Califa Regional", 300 a 303; "DRE CMH Regional", 250 a 253), antes do benefício geral.
  [/^RECPROPIETARIOS$|^RECEITAPROJETOS$/, "PREC"],
  [/^COCOPA$|^DESPESASPROJETOS$/, "PCO"],
  [/^IMPOSTOPROPIETARIOS$|^IMPOSTOSPROJETOS$/, "PIMP"],
  [/^BENEFICIOTRIBUTARIOPROPIETARIOS$|^BENEFICIOTRIBUTARIOPROJETOS$/, "PBEN"],
  [/^BENEFICIOTRIBUTARIO/, "BEN"],
];
/**
 * Os trimestres em que a DRE regional não segue a regra do sistema (decisão
 * 211): o benefício job a job, e não pelo faturamento; a CMH de 1T e 2T 2023
 * toda na Agency; o 4T 2023 da CMH, com o custo tributário que a DRE da
 * planilha lança no crédito (R$ 58.426,48) e dois jobs da Doca sem o imposto
 * teórico (R$ 484,35).
 */
const EXCECOES_DA_DRE = new Set([
  "Agência California|2024|2|BEN", "Agência California|2025|2|BEN", "Agência California|2025|3|BEN", "Agência California|2025|4|BEN",
  "Agência California|2026|4|BEN",
  ...["REC", "IMP", "CO", "BEN"].flatMap((l) => [`CCH|2023|1|${l}`, `CCH|2023|2|${l}`]),
  "CCH|2023|3|BEN", "CCH|2023|4|BEN", "CCH|2023|4|IMP",
  // Os projetos proprietários de 2026: o imposto teórico da Copa digitado nas linhas 85 e 91 da Res. Jobs 2026, o benefício
  // da Copa digitado (R$ 1.520.000,00) e o dos projetos da CCH em zero, e o imposto real (não o teórico) dos projetos da CCH.
  "Agência California|2026|2|PIMP", "Agência California|2026|2|PBEN", "Agência California|2026|2|BEN",
  "CCH|2026|1|PIMP", "CCH|2026|1|PBEN",
]);

const numero = (t: string | undefined) => {
  const n = Number((t ?? "").trim());
  return (t ?? "").trim() === "" || Number.isNaN(n) ? 0 : n;
};
const fmt = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Celula = { aba: string; ano: number; trimestre: number; chave: string; regional: string; linha: number; valor: number };

async function lerGerenciais(arquivo: string): Promise<Celula[]> {
  const x = await abrirXlsx(arquivo);
  const celulas: Celula[] = [];
  for (const { aba, ano } of ABAS) {
    const e = x.abas.find((a) => a.nome === aba);
    if (!e) throw new Error(`Aba ${aba} não encontrada`);
    let trimestre = 0;
    let colunas = new Map<number, string>();
    let vistas = new Set<string>();
    for await (const l of linhasDaAba(x.caminho, x.entrada(e.entrada), x.contexto)) {
      const a = (l.celulas.get(1) ?? "").trim();
      const bloco = /^DRE - Total\s+([1-4])/i.exec(a);
      if (bloco) {
        trimestre = Number(bloco[1]);
        colunas = new Map(
          [...l.celulas.entries()].flatMap(([c, v]) => (REGIONAL_DA_COLUNA[v.trim().toUpperCase()] ? [[c, REGIONAL_DA_COLUNA[v.trim().toUpperCase()]] as [number, string]] : [])),
        );
        vistas = new Set();
        continue;
      }
      if (!trimestre || !a) continue;
      const rotulo = normalizarTexto(a).replace(/ /g, "");
      const achado = POR_ROTULO.find(([re]) => re.test(rotulo));
      if (!achado || vistas.has(achado[1])) continue;
      vistas.add(achado[1]);
      for (const [c, regional] of colunas) {
        if (!l.textosDasFormulas.has(c) && (l.celulas.get(c) ?? "").trim() === "") continue;
        celulas.push({ aba, ano, trimestre, chave: achado[1], regional, linha: l.numero, valor: numero(l.celulas.get(c)) });
      }
    }
  }
  return celulas;
}

/**
 * As células da DRE regional do Fechamento: um bloco por ano ("DRE 2025"), com
 * os trimestres lado a lado. A linha do título diz o trimestre de cada coluna
 * ("1T 2025"; o semestre e o ano ficam de fora) e a linha "Valor Total | % |
 * NE | NO …", a regional. Na CMH, a coluna "SE" repete a da Agency: vale a
 * primeira de cada trimestre.
 */
async function lerDresRegionais(arquivo: string): Promise<(Celula & { empresa: EmpresaDoRegional })[]> {
  const x = await abrirXlsx(arquivo);
  const celulas: (Celula & { empresa: EmpresaDoRegional })[] = [];
  for (const { aba, empresa, colunas: daColuna } of DRES_REGIONAIS) {
    const e = x.abas.find((a) => a.nome === aba);
    if (!e) throw new Error(`Aba ${aba} não encontrada`);
    let ano = 0;
    let titulos: [number, number][] = [];
    let colunas = new Map<number, { trimestre: number; regional: string }>();
    let vistas = new Set<string>();
    for await (const l of linhasDaAba(x.caminho, x.entrada(e.entrada), x.contexto)) {
      const a = (l.celulas.get(1) ?? "").trim();
      const valores = [...l.celulas.entries()].sort((p, q) => p[0] - q[0]);
      const doAno = /DRE(?:\s+CMH)?\s+((?:19|20)\d\d)/i.exec(a);
      if (doAno || /^DRE California$/i.test(a)) {
        ano = doAno ? Number(doAno[1]) : 2021;
        vistas = new Set();
        // O trimestre de cada título; 0 no semestre e no total, que ficam de fora.
        titulos = valores.flatMap(([c, v]): [number, number][] => {
          const t = v.trim().toUpperCase();
          const tri = /^([1-4])T\s+\d{4}$/.exec(t);
          return c === 1 ? [] : tri ? [[c, Number(tri[1])]] : /^(1S|2S|TOTAL)\b|^\d{4}$/.test(t) ? [[c, 0]] : [];
        });
        continue;
      }
      if (valores.some(([, v]) => /^Valor Total$/i.test(v.trim()))) {
        colunas = new Map();
        const ocupadas = new Set<string>();
        for (const [c, v] of valores) {
          const regional = daColuna[v.trim().toUpperCase()];
          const trimestre = [...titulos].reverse().find(([ct]) => ct <= c)?.[1] ?? 0;
          if (!regional || !trimestre || ocupadas.has(`${trimestre}|${regional}`)) continue;
          ocupadas.add(`${trimestre}|${regional}`);
          colunas.set(c, { trimestre, regional });
        }
        continue;
      }
      if (!ano || !a) continue;
      const achado = POR_ROTULO_DA_DRE.find(([re]) => re.test(normalizarTexto(a).replace(/ /g, "")));
      if (!achado || vistas.has(achado[1])) continue;
      vistas.add(achado[1]);
      for (const [c, { trimestre, regional }] of colunas) {
        const texto = (l.celulas.get(c) ?? "").trim();
        if (texto === "" || Number.isNaN(Number(texto))) continue;
        celulas.push({ aba, empresa, ano, trimestre, chave: achado[1], regional, linha: l.numero, valor: Number(texto) });
      }
    }
  }
  return celulas;
}

(async () => {
  const [pasta, ...opcoes] = process.argv.slice(2);
  if (!pasta) throw new Error("Uso: conferir-regional.ts <pasta-da-versao> [--carga <arquivo>] [--padronizado [--com-previsoes]] [--fechamento <arquivo>]");
  const versao = resolve(pasta);
  const iFechamento = opcoes.indexOf("--fechamento");
  const fechamento = iFechamento >= 0 ? opcoes[iFechamento + 1] : undefined;
  const { movimentos, jobs, fonte } = await lerMovimentos(versao, opcoes);
  const pacote = lerPacote(await readFile(join(versao, "cargas", "1a-carga.json"), "utf8"));
  if (!pacote.ok) throw new Error(pacote.message);
  const t = pacote.pacote.tabelas.rateio;
  const rateio: PercentualDoRateio[] = t.linhas.map((l) => {
    const o = Object.fromEntries(t.colunas.map((c, i) => [c, l[i]]));
    return {
      ano: Number(o.ano), trimestre: o.trimestre === null ? null : Number(o.trimestre), empresa: String(o.empresa),
      grupo: o.grupo === null ? null : String(o.grupo), regional: String(o.regional), percentual: Number(o.percentual), origem: String(o.origem),
    };
  });

  // As somas por ano, como a função do banco devolve: o REC e o CO do job com divisão, pelas partes dele.
  const porGrupo = new Map<number, Map<string, AgregadoRegional>>();
  const porJobs = new Map<number, Map<string, AgregadoRegionalJobs>>();
  for (const m of movimentos) {
    if (m.ano !== null && m.grupo !== null && m.trimestre !== null) {
      const job = m.grupo === "REC" || m.grupo === "CO" ? jobs.get(m.jobChave ?? "") : undefined;
      const partes = partesDoJob(job?.rateio ?? null);
      const regionalDoJob = job?.regional ? job.regional.trim().toUpperCase() || null : null;
      const destinos = partes.length
        ? partes.map((p) => ({ regional: p.codigo, todas: false, peloJob: true, regionalDoJob: null, parte: p.parte }))
        : [{ regional: m.regional, todas: m.todas, peloJob: false, regionalDoJob, parte: 1 }];
      if (!porGrupo.has(m.ano)) porGrupo.set(m.ano, new Map());
      for (const d of destinos) {
        const chave = [m.sigla, m.grupo, m.trimestre, m.aba, d.regional ?? "", d.todas, d.peloJob, d.regionalDoJob ?? ""].join("|");
        const s = porGrupo.get(m.ano)!.get(chave) ?? {
          sigla: m.sigla, grupo: m.grupo, trimestre: m.trimestre, aba: m.aba, regional: d.regional, todas: d.todas, peloJob: d.peloJob,
          regionalDoJob: d.regionalDoJob, credito: 0, debito: 0, teorico: 0,
        };
        s.credito += m.credito * d.parte;
        s.debito += m.debito * d.parte;
        if (m.grupo === "REC") s.teorico += (m.credito - m.debito) * d.parte * (job?.taxa ?? 0);
        porGrupo.get(m.ano)!.set(chave, s);
      }
    }
    const j = chaveDaColunaJobs(m.jobs);
    if (j && PREFIXOS_DO_REGIONAL.includes(j.prefixo)) {
      const chave = [j.prefixo, j.trimestre, m.aba, m.regional ?? "", m.todas].join("|");
      if (!porJobs.has(j.ano)) porJobs.set(j.ano, new Map());
      const s = porJobs.get(j.ano)!.get(chave) ?? { prefixo: j.prefixo, trimestre: j.trimestre, aba: m.aba, regional: m.regional, todas: m.todas, credito: 0, debito: 0 };
      s.credito += m.credito;
      s.debito += m.debito;
      porJobs.get(j.ano)!.set(chave, s);
    }
  }
  const cache = new Map<string, ReturnType<typeof montarRegional>>();
  const doSistema = (empresa: EmpresaDoRegional, ano: number, trimestre: number) => {
    const k = `${empresa}|${ano}|${trimestre}`;
    if (!cache.has(k)) {
      cache.set(
        k,
        montarRegional(
          empresa, ano, trimestre,
          [...(porGrupo.get(ano)?.values() ?? [])], [...(porJobs.get(ano)?.values() ?? [])],
          rateio.filter((r) => r.empresa === empresa),
        ),
      );
    }
    return cache.get(k)!;
  };
  /** Compara as células e escreve o CSV; devolve as linhas que diferem fora das exceções. */
  const comparar = async (
    celulas: (Celula & { empresa: EmpresaDoRegional })[],
    excecoes: Set<string>,
    nomeDaExcecao: string,
    arquivo: string,
  ) => {
    const saida = [BOM + linhaCsv(["aba", "ano", "trimestre", "linha_da_planilha", "chave", "regional", "planilha", "sistema", "diferenca", "situacao"])];
    const contagem = new Map<string, number>();
    const difere: string[] = [];
    for (const c of celulas) {
      const r = doSistema(c.empresa, c.ano, c.trimestre);
      // Sem projeto no período, o bloco dos projetos não aparece: vale zero.
      const linha = r.linhas.find((l) => l.chave === c.chave);
      const i = r.colunas.indexOf(c.regional);
      const sistema = linha && i >= 0 ? linha.regionais[i] : 0;
      const d = Math.round((sistema - c.valor) * 100) / 100;
      const situacao =
        Math.abs(d) < 0.01 ? "bate" : Math.abs(d) < 1 ? "centavos" : excecoes.has(`${c.empresa}|${c.ano}|${c.trimestre}|${c.chave}`) ? nomeDaExcecao : "difere";
      contagem.set(`${c.aba}|${situacao}`, (contagem.get(`${c.aba}|${situacao}`) ?? 0) + 1);
      saida.push(linhaCsv([c.aba, c.ano, c.trimestre, c.linha, c.chave, c.regional, c.valor.toFixed(2), sistema.toFixed(2), d.toFixed(2), situacao]));
      if (situacao === "difere") difere.push(`${c.aba} ${c.ano} ${c.trimestre}T L${c.linha} ${c.chave} ${c.regional}: planilha ${fmt(c.valor)} · sistema ${fmt(sistema)} (${d > 0 ? "+" : ""}${fmt(d)})`);
    }
    await mkdir(join(versao, "validacao"), { recursive: true });
    await writeFile(join(versao, "validacao", arquivo), saida.join("\n") + "\n", "utf8");
    for (const [k, n] of [...contagem].sort()) console.log(k.replace("|", ": "), n);
    console.log(difere.join("\n"));
  };

  const sufixo = fonte === "carga" ? "" : `-${fonte}`;
  const gerenciais = await lerGerenciais(join(versao, "origem.xlsx"));
  await comparar(
    gerenciais.map((c) => ({ ...c, empresa: EMPRESA_DA_REGIONAL(c.regional) })),
    new Set([...EXCECOES]),
    "exceção da planilha",
    `regional${sufixo}.csv`,
  );
  if (fechamento) {
    console.log("\n— DRE regional do Fechamento —");
    const dres = (await lerDresRegionais(resolve(fechamento))).filter((c) => c.ano >= 2023);
    await comparar(dres, EXCECOES_DA_DRE, "exceção da planilha", `regional-fechamento${sufixo}.csv`);
  }
})();
