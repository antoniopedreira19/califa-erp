/**
 * A4 da importação do histórico financeiro (decisão 211): confere o resultado
 * por regional do histórico (`lib/historico-financeiro/regional.ts`) contra as
 * abas Gerencial da planilha.
 *
 * Compara, trimestre a trimestre e regional a regional, as linhas em que a
 * planilha e o histórico seguem a mesma fonte: o custo fixo e a despesa com
 * pessoal da regional (os lançamentos com a regional), os mesmos do TD
 * rateados pelo percentual do ano, o imobilizado e a participação nos lucros
 * (a regional e o TD). Onde a planilha usa outro critério, já medido na
 * decisão 211 (o TD ÷4 em alguns trimestres), a diferença sai marcada.
 *
 * Uso (as opções de fonte são as de `movimentos-para-conferir.ts`):
 *   npx tsx scripts/historico-financeiro/conferir-regional.ts <pasta-da-versao> [--padronizado --com-previsoes]
 *
 * Saída em <pasta-da-versao>/validacao/regional*.csv.
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

(async () => {
  const [pasta, ...opcoes] = process.argv.slice(2);
  if (!pasta) throw new Error("Uso: conferir-regional.ts <pasta-da-versao> [--carga <arquivo>] [--padronizado [--com-previsoes]]");
  const versao = resolve(pasta);
  const { movimentos, fonte } = await lerMovimentos(versao, opcoes);
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

  // As somas por ano, como a função do banco devolve.
  const porGrupo = new Map<number, Map<string, AgregadoRegional>>();
  const porJobs = new Map<number, Map<string, AgregadoRegionalJobs>>();
  for (const m of movimentos) {
    if (m.ano !== null && m.grupo !== null && m.trimestre !== null) {
      const chave = [m.sigla, m.grupo, m.trimestre, m.aba, m.regional ?? "", m.todas].join("|");
      if (!porGrupo.has(m.ano)) porGrupo.set(m.ano, new Map());
      const s = porGrupo.get(m.ano)!.get(chave) ?? { sigla: m.sigla, grupo: m.grupo, trimestre: m.trimestre, aba: m.aba, regional: m.regional, todas: m.todas, credito: 0, debito: 0 };
      s.credito += m.credito;
      s.debito += m.debito;
      porGrupo.get(m.ano)!.set(chave, s);
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

  const celulas = await lerGerenciais(join(versao, "origem.xlsx"));
  const saida = [BOM + linhaCsv(["aba", "ano", "trimestre", "linha_da_planilha", "chave", "regional", "planilha", "sistema", "diferenca", "situacao"])];
  const contagem = new Map<string, number>();
  const difere: string[] = [];
  const cache = new Map<string, ReturnType<typeof montarRegional>>();
  for (const c of celulas) {
    const empresa = EMPRESA_DA_REGIONAL(c.regional);
    const k = `${empresa}|${c.ano}|${c.trimestre}`;
    if (!cache.has(k)) {
      cache.set(
        k,
        montarRegional(
          empresa, c.ano, c.trimestre,
          [...(porGrupo.get(c.ano)?.values() ?? [])], [...(porJobs.get(c.ano)?.values() ?? [])],
          rateio.filter((r) => r.empresa === empresa),
        ),
      );
    }
    const r = cache.get(k)!;
    const linha = r.linhas.find((l) => l.chave === c.chave)!;
    const i = r.colunas.indexOf(c.regional);
    const sistema = i >= 0 ? linha.regionais[i] : 0;
    const d = Math.round((sistema - c.valor) * 100) / 100;
    const situacao =
      Math.abs(d) < 0.01 ? "bate" : Math.abs(d) < 1 ? "centavos" : EXCECOES.has(`${empresa}|${c.ano}|${c.trimestre}|${c.chave}`) ? "exceção da planilha" : "difere";
    contagem.set(`${c.aba}|${situacao}`, (contagem.get(`${c.aba}|${situacao}`) ?? 0) + 1);
    saida.push(linhaCsv([c.aba, c.ano, c.trimestre, c.linha, c.chave, c.regional, c.valor.toFixed(2), sistema.toFixed(2), d.toFixed(2), situacao]));
    if (situacao === "difere") difere.push(`${c.aba} ${c.trimestre}T L${c.linha} ${c.chave} ${c.regional}: planilha ${fmt(c.valor)} · sistema ${fmt(sistema)} (${d > 0 ? "+" : ""}${fmt(d)})`);
  }
  await mkdir(join(versao, "validacao"), { recursive: true });
  const nome = fonte === "carga" ? "regional.csv" : `regional-${fonte}.csv`;
  await writeFile(join(versao, "validacao", nome), saida.join("\n") + "\n", "utf8");
  for (const [k, n] of [...contagem].sort()) console.log(k.replace("|", ": "), n);
  console.log(difere.join("\n"));
})();
