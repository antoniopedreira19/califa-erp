/**
 * A4 da importação do histórico financeiro (decisão 211): confere a
 * rentabilidade dos jobs do histórico (`lib/historico-financeiro/rentabilidade.ts`)
 * contra as abas Res. Jobs da planilha, job a job: as colunas TOTAL RECEITA,
 * IMPOSTO, TOTAL CO, RESULTADO, FEE LÍQUIDO e RENTABILIDADE da linha de cada
 * job (a da aba mais nova em que ele aparece).
 *
 * A soma de cada job repete a função do banco: a receita pelo Tipo REC, o
 * custo pelo Tipo CO e o imposto pelas notas emitidas do job, em qualquer
 * data; o fee, pelo percentual do job.
 *
 * Uso (as opções de fonte são as de `movimentos-para-conferir.ts`):
 *   npx tsx scripts/historico-financeiro/conferir-rentabilidade.ts <pasta-da-versao> [--padronizado --com-previsoes]
 *
 * Saída em <pasta-da-versao>/validacao/rentabilidade*.csv.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SINONIMOS_DO_RESULTADO, colunasPorNome } from "../../lib/historico-financeiro/colunas";
import { BOM, lerCsv, linhaCsv } from "../../lib/historico-financeiro/csv";
import { normalizarTexto } from "../../lib/historico-financeiro/regras";
import { contasDoJob, type ContasDoJob } from "../../lib/historico-financeiro/rentabilidade";
import type { Manifesto } from "./extrair";
import { lerImpostosDasNotas, lerMovimentos } from "./movimentos-para-conferir";

/** As colunas que se comparam, pelo nome do cabeçalho da aba (sem acento). */
const METRICAS: readonly { chave: keyof ContasDoJob; cabecalhos: readonly string[] }[] = [
  { chave: "receita", cabecalhos: ["TOTAL RECEITA"] },
  { chave: "imposto", cabecalhos: ["IMPOSTO", "TOTAL IMPOSTO"] },
  { chave: "custo", cabecalhos: ["TOTAL CO", "TOTAL CUSTO OP"] },
  { chave: "resultado", cabecalhos: ["RESULTADO"] },
  { chave: "fee", cabecalhos: ["FEE LIQUIDO"] },
  { chave: "rentabilidade", cabecalhos: ["RENTABILIDADE"] },
];

const numero = (t: string | undefined) => {
  const n = Number((t ?? "").trim());
  return (t ?? "").trim() === "" || Number.isNaN(n) ? 0 : n;
};
const fmt = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const [pasta, ...opcoes] = process.argv.slice(2);
  if (!pasta) throw new Error("Uso: conferir-rentabilidade.ts <pasta-da-versao> [--carga <arquivo>] [--padronizado [--com-previsoes]]");
  const versao = resolve(pasta);
  const { movimentos, jobs, fonte } = await lerMovimentos(versao, opcoes);
  const impostos = await lerImpostosDasNotas(versao, opcoes);

  // A receita e o custo de cada job, como a função do banco soma.
  const somas = new Map<string, { receita: number; custo: number }>();
  for (const m of movimentos) {
    if (!m.jobChave || (m.grupo !== "REC" && m.grupo !== "CO")) continue;
    const s = somas.get(m.jobChave) ?? { receita: 0, custo: 0 };
    if (m.grupo === "REC") s.receita += m.credito - m.debito;
    else s.custo += m.debito - m.credito;
    somas.set(m.jobChave, s);
  }

  // As linhas de cada aba Res. Jobs, pelo número da linha, e a coluna de cada métrica.
  const manifesto: Manifesto = JSON.parse(await readFile(join(versao, "bruto", "manifesto.json"), "utf8"));
  const abas = new Map<string, { linhas: Map<number, string[]>; colunas: Map<keyof ContasDoJob, number> }>();
  const daAba = async (aba: string) => {
    if (!abas.has(aba)) {
      const arquivo = manifesto.abas.find((a) => a.nome === aba)?.arquivo;
      if (!arquivo) throw new Error(`A aba ${aba} não está no manifesto.`);
      const linhas = lerCsv(await readFile(join(versao, "bruto", arquivo), "utf8")).slice(1);
      const iCab = linhas.slice(0, 6).findIndex((l) => l.some((c, i) => i > 0 && normalizarTexto(c) === "CLIENTE"));
      const cabecalho = linhas[iCab] ?? [];
      const doResultado = colunasPorNome(cabecalho, SINONIMOS_DO_RESULTADO);
      const colunas = new Map<keyof ContasDoJob, number>();
      for (const m of METRICAS) {
        const i = ["receita", "imposto", "custo"].includes(m.chave)
          ? doResultado.get(m.chave) ?? -1
          : cabecalho.findIndex((c, k) => k > 0 && m.cabecalhos.includes(normalizarTexto(c)));
        if (i > 0) colunas.set(m.chave, i);
      }
      abas.set(aba, { linhas: new Map(linhas.map((l) => [Number(l[0]), l])), colunas });
    }
    return abas.get(aba)!;
  };

  const saida = [BOM + linhaCsv(["aba", "linha", "metrica", "planilha", "sistema", "diferenca", "situacao"])];
  const contagem = new Map<string, number>();
  const totais = new Map<string, { planilha: number; sistema: number }>();
  const difere: string[] = [];
  for (const [chave, job] of [...jobs].sort((a, b) => a[1].aba.localeCompare(b[1].aba) || a[1].linha - b[1].linha)) {
    const ano = Number(/(\d{4})$/.exec(job.aba)?.[1]);
    if (!(ano >= 2021 && ano <= 2026)) continue;
    const { linhas, colunas } = await daAba(job.aba);
    const linha = linhas.get(job.linha);
    if (!linha) continue;
    const s = somas.get(chave) ?? { receita: 0, custo: 0 };
    const sistema = contasDoJob({ receita: s.receita, custo: s.custo, imposto: impostos.get(chave) ?? 0, feePercentual: job.fee });
    for (const m of METRICAS) {
      const i = colunas.get(m.chave);
      if (i === undefined) continue;
      const planilha = numero(linha[i]);
      const d = Math.round((sistema[m.chave] - planilha) * 100) / 100;
      const situacao = Math.abs(d) < 0.01 ? "bate" : Math.abs(d) < 1 ? "centavos" : "difere";
      contagem.set(`${job.aba}|${m.chave}|${situacao}`, (contagem.get(`${job.aba}|${m.chave}|${situacao}`) ?? 0) + 1);
      const t = totais.get(`${job.aba}|${m.chave}`) ?? { planilha: 0, sistema: 0 };
      t.planilha += planilha;
      t.sistema += sistema[m.chave];
      totais.set(`${job.aba}|${m.chave}`, t);
      saida.push(linhaCsv([job.aba, job.linha, m.chave, planilha.toFixed(2), sistema[m.chave].toFixed(2), d.toFixed(2), situacao]));
      if (situacao === "difere") difere.push(`${job.aba} L${job.linha} ${m.chave}: planilha ${fmt(planilha)} · sistema ${fmt(sistema[m.chave])} (${d > 0 ? "+" : ""}${fmt(d)})`);
    }
  }
  await mkdir(join(versao, "validacao"), { recursive: true });
  await writeFile(join(versao, "validacao", fonte === "carga" ? "rentabilidade.csv" : `rentabilidade-${fonte}.csv`), saida.join("\n") + "\n", "utf8");

  const porAba = new Map<string, string[]>();
  for (const [k, n] of contagem) {
    const [aba, metrica, situacao] = k.split("|");
    porAba.set(aba, [...(porAba.get(aba) ?? []), `${metrica} ${situacao} ${n}`]);
  }
  for (const [aba, partes] of [...porAba].sort()) {
    const t = (m: string) => totais.get(`${aba}|${m}`);
    console.log(`${aba}: ${partes.sort().join(" · ")}`);
    console.log(`  receita ${fmt(t("receita")?.planilha ?? 0)} × ${fmt(t("receita")?.sistema ?? 0)} · resultado ${fmt(t("resultado")?.planilha ?? 0)} × ${fmt(t("resultado")?.sistema ?? 0)} · rentabilidade ${fmt(t("rentabilidade")?.planilha ?? 0)} × ${fmt(t("rentabilidade")?.sistema ?? 0)}`);
  }
  if (difere.length) console.log(`\n${difere.length} células diferem:\n${difere.slice(0, 60).join("\n")}`);
})();
