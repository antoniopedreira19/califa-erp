/**
 * A4 da importação do histórico financeiro (decisão 211): confere a DRE do
 * histórico (`lib/historico-financeiro/dre.ts`) contra as abas DRE da planilha.
 *
 * Para cada empresa e cada ano de 2023 a 2026, a DRE é montada com os
 * movimentos do pacote de uma carga — o mesmo que foi gravado no banco — e
 * comparada, linha a linha e trimestre a trimestre, com o total que a aba DRE
 * da planilha mostra. Quando uma linha difere, o terminal mostra de quais
 * contas (abas) veio o valor do sistema, para separar a regra (o sinal, as
 * contas que a planilha não soma) do que falta carregar.
 *
 * Uso:
 *   npx tsx scripts/historico-financeiro/conferir-dre.ts <pasta-da-versao> [--carga cargas/1a-carga.json]
 *   npx tsx scripts/historico-financeiro/conferir-dre.ts <pasta-da-versao> --padronizado [--com-previsoes] [--de 2023-01-01] [--ate 2026-09-30]
 *
 * Com `--padronizado`, os movimentos vêm do padronizado inteiro (todas as
 * datas, ou só as do período): mostra o que a próxima carga resolve e o que
 * fica como diferença de regra. Com `--com-previsoes`, entram também as
 * linhas com data futura, que a DRE da planilha soma.
 *
 * Saída em <pasta-da-versao>/validacao/: dre.csv, dre-padronizado.csv ou
 * dre-padronizado-com-previsoes.csv.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BOM, linhaCsv } from "../../lib/historico-financeiro/csv";
import {
  EMPRESAS_DA_DRE,
  MODELOS_DA_DRE,
  PREFIXOS_DA_DRE,
  chaveDaColunaJobs,
  montarDre,
  type AgregadoPorGrupo,
  type AgregadoPorJobs,
  type EmpresaDaDre,
} from "../../lib/historico-financeiro/dre";
import { normalizarTexto } from "../../lib/historico-financeiro/regras";
import { abrirXlsx, linhasDaAba } from "../../lib/historico-financeiro/xlsx-em-fluxo";
import { lerMovimentos } from "./movimentos-para-conferir";

const ANOS = [2023, 2024, 2025, 2026];
const COLUNAS = ["1", "2", "3", "4", "ano"] as const;

/** O rótulo da planilha (sem acento, sem espaço) → a chave da linha no modelo. */
const POR_ROTULO: [RegExp, string][] = [
  [/^RECEITA$/, "REC"],
  [/^CUSTOOPERACIONAL$/, "CO"],
  [/^CUSTOTRIBUTARIO$/, "CT"],
  [/^RESULTADOBRUTOOPERACIONAL/, "RB"],
  [/^CUSTOFIXO$/, "CF"],
  [/^DESPESACPESSOAL$/, "DP"],
  [/^DESPESAMKT$/, "DM"],
  [/^DESPESAADM$/, "DA"],
  [/^DESPESACOMERCIAL$/, "DC"],
  [/^DESPESATRABALHISTA$/, "DT"],
  [/^RESLIQUIDOOPERACIONALANTES/, "RLOA"],
  [/^RECEITAFINANCEIRA$/, "RF"],
  [/^DESPESACJUROS$/, "DJ"],
  [/^EMPRESTIMOS$/, "EMP"],
  [/^RESLIQUIDOOPERACIONAL$/, "RLO"],
  [/^IMOBILIZADO$/, "IMOB"],
  [/^BONIFICACAO$/, "PL"],
  [/^DOCA/, "DOC"],
  [/^MAKKNA/, "MK"],
  [/^LUCROLIQUIDO$/, "LL"],
  [/^DISTRIBUICAODELUCRO$/, "DL"],
  [/^PERDA$/, "J-FIT"],
  [/^EMPRESTIMOAOFITDANCE$/, "J-FIT"],
  [/^EMPRESTIMOACMH$/, "J-CMH"],
  [/^EMPRESTIMOAHITLAB$/, "J-HIT"],
  [/^EMPRESTIMOACOMMUNITY$/, "J-CMT"],
  [/^EMPRESTIMOAIFL$/, "J-IFL"],
  [/^EMPRESTIMOAVENTURA$/, "J-VT"],
  [/^MUTUOINTERNO$/, "MUTUO"],
  [/^PROVISAOTRABALHISTA$/, "PT"],
  [/^REIVESTIMENTONOCAIXA$/, "REINV"],
];

type LinhaDaPlanilha = { linha: number; chave: string; valores: number[] };

function chaveDoRotulo(rotulo: string): string | null {
  const t = normalizarTexto(rotulo).replace(/ /g, "");
  const achado = POR_ROTULO.find(([re]) => re.test(t));
  if (!achado) return null;
  const [, chave] = achado;
  // Empréstimos e mútuo aparecem duas vezes: o "(+)" é o crédito, o "(-)" o débito.
  if (chave === "EMP" || chave === "MUTUO") return `${chave}${/^\s*\(\s*\+/.test(rotulo) ? "+" : "-"}`;
  return chave;
}

const numero = (texto: string | undefined) => {
  const n = Number((texto ?? "").trim());
  return (texto ?? "").trim() === "" || Number.isNaN(n) ? 0 : n;
};

/** Os blocos de 2023 a 2026 de uma aba DRE: por ano, as linhas com o total de cada trimestre e do ano. */
async function lerAbaDaDre(arquivo: Awaited<ReturnType<typeof abrirXlsx>>, aba: string) {
  const e = arquivo.abas.find((a) => a.nome === aba);
  if (!e) throw new Error(`Aba ${aba} não encontrada`);
  const porAno = new Map<number, LinhaDaPlanilha[]>();
  let ano = 0;
  let totais: number[] = [];
  let depoisDoImobilizado = false;
  for await (const l of linhasDaAba(arquivo.caminho, arquivo.entrada(e.entrada), arquivo.contexto)) {
    const a = (l.celulas.get(1) ?? "").trim();
    // Embaixo das DREs vêm os totais e a "DRE acumulado x caixa", com cópias de blocos de outros anos.
    if (/^(TOTAIS NA DRE|DRE ACUMULADO)/i.test(a)) break;
    const mAno = /COMPET[EÊ]NCIA\s+((?:19|20)\d\d)/i.exec(a);
    if (mAno) {
      ano = Number(mAno[1]);
      totais = [];
      depoisDoImobilizado = false;
      continue;
    }
    if (!ANOS.includes(ano)) continue;
    if (/^GRUPO$/i.test(a)) {
      // As cinco colunas TOTAL do bloco: os quatro trimestres e o ano.
      totais = [...l.celulas.entries()].filter(([, v]) => /^TOTAL$/i.test(v.trim())).map(([c]) => c).sort((x, y) => x - y);
      continue;
    }
    if (totais.length < 5) continue;
    let chave = a ? chaveDoRotulo(a) : null;
    // Na DRE CMH, o lucro líquido é uma linha sem rótulo, depois do imobilizado (e da Doca e da Makkna).
    if (!a && depoisDoImobilizado && l.textosDasFormulas.size > 0) chave = "LL";
    if (!chave) continue;
    if (chave === "IMOB") depoisDoImobilizado = true;
    if (chave === "LL" || chave === "DL") depoisDoImobilizado = false;
    const valores = totais.slice(0, 5).map((c) => numero(l.celulas.get(c)));
    if (!porAno.has(ano)) porAno.set(ano, []);
    porAno.get(ano)!.push({ linha: l.numero, chave, valores });
  }
  return porAno;
}

const fmt = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const [pasta, ...opcoes] = process.argv.slice(2);
  if (!pasta) throw new Error("Uso: conferir-dre.ts <pasta-da-versao> [--carga <arquivo>] [--padronizado [--com-previsoes] --de AAAA-MM-DD --ate AAAA-MM-DD]");
  const versao = resolve(pasta);
  const { movimentos, fonte } = await lerMovimentos(versao, opcoes);

  // As somas por ano, como a função do banco devolve, e por conta, para explicar as diferenças.
  const grupos = new Map<number, Map<string, AgregadoPorGrupo>>();
  const jobs = new Map<number, Map<string, AgregadoPorJobs>>();
  for (const r of movimentos) {
    const { aba, credito, debito } = r;
    if (r.ano !== null && r.grupo !== null && r.trimestre !== null) {
      const chave = `${r.sigla}|${r.grupo}|${r.trimestre}|${aba}`;
      if (!grupos.has(r.ano)) grupos.set(r.ano, new Map());
      const m = grupos.get(r.ano)!;
      const s = m.get(chave) ?? { sigla: r.sigla, grupo: r.grupo, trimestre: r.trimestre, aba, credito: 0, debito: 0 };
      s.credito += credito;
      s.debito += debito;
      m.set(chave, s);
    }
    const j = chaveDaColunaJobs(r.jobs);
    if (j && PREFIXOS_DA_DRE.includes(j.prefixo)) {
      const chave = `${j.prefixo}|${j.trimestre}|${aba}`;
      if (!jobs.has(j.ano)) jobs.set(j.ano, new Map());
      const m = jobs.get(j.ano)!;
      const s = m.get(chave) ?? { prefixo: j.prefixo, trimestre: j.trimestre, aba, credito: 0, debito: 0 };
      s.credito += credito;
      s.debito += debito;
      m.set(chave, s);
    }
  }

  const arquivo = await abrirXlsx(join(versao, "origem.xlsx"));
  const saida: string[] = [BOM + linhaCsv(["empresa", "ano", "chave", "rotulo", "trimestre", "planilha", "sistema", "diferenca", "situacao"])];
  const resumo: string[] = [];
  for (const { empresa, sigla, aba } of EMPRESAS_DA_DRE) {
    const planilha = await lerAbaDaDre(arquivo, aba);
    for (const ano of ANOS) {
      const linhasDaPlanilha = planilha.get(ano);
      if (!linhasDaPlanilha) {
        resumo.push(`${empresa} ${ano}: a planilha não tem a DRE do ano`);
        continue;
      }
      const g = [...(grupos.get(ano)?.values() ?? [])];
      const jb = [...(jobs.get(ano)?.values() ?? [])];
      const dre = montarDre(empresa as EmpresaDaDre, g, jb);
      const daPlanilha = new Map<string, number[]>();
      for (const l of linhasDaPlanilha) {
        const s = daPlanilha.get(l.chave) ?? [0, 0, 0, 0, 0];
        daPlanilha.set(l.chave, s.map((v, i) => v + l.valores[i]));
      }
      const chavesDoModelo = new Set(MODELOS_DA_DRE[empresa as EmpresaDaDre].map((i) => i.chave));
      for (const linha of dre) {
        const p = daPlanilha.get(linha.chave);
        const s = [...linha.trimestres, linha.ano];
        const difs: string[] = [];
        COLUNAS.forEach((col, i) => {
          const vp = p ? p[i] : 0;
          const d = Math.round((s[i] - vp) * 100) / 100;
          const situacao = !p && s[i] !== 0 ? "linha só no sistema" : Math.abs(d) < 0.01 ? "bate" : Math.abs(d) < 1 ? "centavos" : "difere";
          saida.push(linhaCsv([empresa, ano, linha.chave, linha.rotulo, col, vp.toFixed(2), s[i].toFixed(2), d.toFixed(2), situacao]));
          if (situacao === "difere" || situacao === "linha só no sistema") difs.push(`${col === "ano" ? "ano" : `${col}T`} ${fmt(vp)} → ${fmt(s[i])} (${d > 0 ? "+" : ""}${fmt(d)})`);
        });
        if (difs.length && !linha.subtotal) {
          resumo.push(`${empresa} ${ano} ${linha.chave}: ${difs.join(" · ")}`);
          resumo.push(`    por conta no sistema: ${porConta(linha.chave, empresa as EmpresaDaDre, sigla, g, jb)}`);
        } else if (difs.length) {
          resumo.push(`${empresa} ${ano} ${linha.chave} (subtotal): ${difs.join(" · ")}`);
        }
      }
      for (const [chave, v] of daPlanilha) {
        if (chavesDoModelo.has(chave)) continue;
        const situacao = v.every((x) => Math.abs(x) < 0.01) ? "linha só na planilha, zerada" : "linha só na planilha";
        COLUNAS.forEach((col, i) => saida.push(linhaCsv([empresa, ano, chave, "", col, v[i].toFixed(2), "0.00", (-v[i]).toFixed(2), situacao])));
        resumo.push(`${empresa} ${ano} ${chave}: ${situacao} (${v.map(fmt).join(" | ")})`);
      }
    }
  }
  await mkdir(join(versao, "validacao"), { recursive: true });
  const nome = fonte === "carga" ? "dre.csv" : `dre-${fonte}.csv`;
  await writeFile(join(versao, "validacao", nome), saida.join("\n") + "\n", "utf8");
  console.log(resumo.join("\n"));
})();


/** De quais contas vem o valor da linha no sistema, no ano (antes da regra): crédito e débito por aba. */
function porConta(
  chave: string,
  empresa: EmpresaDaDre,
  sigla: string,
  g: readonly AgregadoPorGrupo[],
  jb: readonly AgregadoPorJobs[],
): string {
  const item = MODELOS_DA_DRE[empresa].find((i) => i.chave === chave);
  if (!item || item.tipo !== "linha") return "—";
  const origem = item.origem;
  const linhas =
    "grupo" in origem
      ? g.filter((a) => a.sigla === sigla && a.grupo === origem.grupo)
      : jb.filter((a) => a.prefixo === origem.jobs);
  const porAba = new Map<string, { c: number; d: number }>();
  for (const a of linhas) {
    const s = porAba.get(a.aba) ?? { c: 0, d: 0 };
    porAba.set(a.aba, { c: s.c + a.credito, d: s.d + a.debito });
  }
  return [...porAba].map(([aba, s]) => `${aba} C ${fmt(s.c)} D ${fmt(s.d)}`).join("; ") || "nada";
}
