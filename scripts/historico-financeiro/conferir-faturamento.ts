/**
 * A4 da importação do histórico financeiro (decisão 211): confere o
 * faturamento dos jobs do histórico (`lib/historico-financeiro/faturamento.ts`)
 * contra a planilha, job a job.
 *
 * As abas Res. Jobs não têm coluna de faturado: a coluna IMPOSTO de cada job
 * soma, por SUMIFS, o Total Impostos das abas de Faturamento cujo JOB é o nome
 * do job. A conferência refaz esse SUMIFS em cada linha de job, com as mesmas
 * abas e o mesmo critério da fórmula, somando o Valor das notas emitidas
 * (número na coluna NF) no período da carga — o faturado — e o das que têm
 * data de Recebimento — o recebido —, e compara com as notas do pacote ligadas
 * ao job, como a função do banco soma.
 *
 * Uso:
 *   npx tsx scripts/historico-financeiro/conferir-faturamento.ts <pasta-da-versao> [--carga cargas/1a-carga.json]
 *
 * Saída em <pasta-da-versao>/validacao/faturamento.csv.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SINONIMOS_DA_NOTA, SINONIMOS_DO_RESULTADO, celula, colunasPorNome } from "../../lib/historico-financeiro/colunas";
import { BOM, indiceDaColuna, lerCsv, linhaCsv } from "../../lib/historico-financeiro/csv";
import { predicadoDoCriterio } from "../../lib/historico-financeiro/formulas";
import { lerPacote } from "../../lib/historico-financeiro/pacote";
import { lerData, lerNumero, normalizarTexto } from "../../lib/historico-financeiro/regras";
import { abrirXlsx, linhasDaAba } from "../../lib/historico-financeiro/xlsx-em-fluxo";
import type { Manifesto } from "./extrair";
import { emCentavos } from "./movimentos-para-conferir";

type Somas = { notas: number; faturado: number; recebido: number };
const METRICAS = ["notas", "faturado", "recebido"] as const;
const vazio = (): Somas => ({ notas: 0, faturado: 0, recebido: 0 });

/** Um termo da coluna IMPOSTO: SUMIFS('<aba>'!V:V,'<aba>'!B:B,A20). */
type Termo = { aba: string; colunaDoCriterio: number; criterio: string };
const TERMO = /SUMIFS\('([^']+)'!\$?[A-Z]+\$?\d*:\$?[A-Z]+\$?\d*,'([^']+)'!\$?([A-Z]+)\$?\d*:\$?[A-Z]+\$?\d*,\$?([A-Z]+)\$?(\d+)\)/g;

const fmt = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const [pasta, ...opcoes] = process.argv.slice(2);
  if (!pasta) throw new Error("Uso: conferir-faturamento.ts <pasta-da-versao> [--carga <arquivo>]");
  const versao = resolve(pasta);
  const i = opcoes.indexOf("--carga");
  const lido = lerPacote(await readFile(join(versao, i >= 0 ? opcoes[i + 1] : "cargas/1a-carga.json"), "utf8"));
  if (!lido.ok) throw new Error(lido.message);
  const { carga, tabelas } = lido.pacote;

  // O sistema: as notas emitidas do pacote, por job, como a função do banco soma.
  const sistema = new Map<string, Somas>();
  {
    const t = tabelas.notas;
    const [iJob, iSituacao, iValor, iRecebimento] = ["job_chave", "situacao", "valor", "recebimento"].map((nome) => t.colunas.indexOf(nome));
    for (const r of t.linhas) {
      if (r[iSituacao] !== "emitida" || r[iJob] === null) continue;
      const s = sistema.get(String(r[iJob])) ?? vazio();
      const valor = emCentavos(Number(r[iValor] ?? 0));
      s.notas += 1;
      s.faturado += valor;
      if (r[iRecebimento] !== null) s.recebido += valor;
      sistema.set(String(r[iJob]), s);
    }
  }
  const jobs = (() => {
    const t = tabelas.jobs;
    const [iChave, iAba, iLinha, iAno] = ["chave", "aba", "linha", "ano"].map((nome) => t.colunas.indexOf(nome));
    return t.linhas
      .map((r) => ({ chave: String(r[iChave]), aba: String(r[iAba]), linha: Number(r[iLinha]), ano: Number(r[iAno]) }))
      .filter((j) => j.ano >= 2023 && j.ano <= 2026);
  })();

  // A planilha: as linhas do bruto, pelo número da linha.
  const manifesto: Manifesto = JSON.parse(await readFile(join(versao, "bruto", "manifesto.json"), "utf8"));
  const bruto = new Map<string, string[][]>();
  const daAba = async (aba: string) => {
    if (!bruto.has(aba)) {
      const arquivo = manifesto.abas.find((a) => a.nome === aba)?.arquivo;
      if (!arquivo) throw new Error(`A aba ${aba} não está no manifesto.`);
      bruto.set(aba, lerCsv(await readFile(join(versao, "bruto", arquivo), "utf8")).slice(1));
    }
    return bruto.get(aba)!;
  };

  // As notas emitidas de uma aba de Faturamento no período da carga, com o JOB como está na célula.
  const notasDaAba = new Map<string, { colunaDoJob: number; notas: { job: string; valor: number; recebida: boolean }[] }>();
  const faturamento = async (aba: string) => {
    if (!notasDaAba.has(aba)) {
      const linhas = await daAba(aba);
      const iCab = linhas.slice(0, 6).findIndex((l) => l.some((c, k) => k > 0 && k < 4 && normalizarTexto(c) === "NF"));
      if (iCab < 0) throw new Error(`A aba ${aba} não tem o cabeçalho NF.`);
      const colunas = colunasPorNome(linhas[iCab], SINONIMOS_DA_NOTA);
      const notas: { job: string; valor: number; recebida: boolean }[] = [];
      for (const l of linhas.slice(iCab + 1)) {
        const c = (campo: string) => celula(l, colunas, campo);
        const emissao = lerData(c("emissao"));
        const valor = lerNumero(c("valor"));
        if (!/^\d+(\.0+)?$/.test(c("nf")) || !emissao || emissao < carga.de || emissao > carga.ate || valor === null) continue;
        notas.push({ job: l[colunas.get("job") ?? -1] ?? "", valor: emCentavos(valor), recebida: lerData(c("recebimento")) !== null });
      }
      notasDaAba.set(aba, { colunaDoJob: colunas.get("job") ?? -1, notas });
    }
    return notasDaAba.get(aba)!;
  };

  // As fórmulas da coluna IMPOSTO das abas Res. Jobs que têm jobs no pacote.
  const xlsx = await abrirXlsx(join(versao, "origem.xlsx"));
  const termos = new Map<string, Termo[] | null>();
  for (const aba of [...new Set(jobs.map((j) => j.aba))]) {
    const linhas = await daAba(aba);
    const iCab = linhas.slice(0, 6).findIndex((l) => l.some((c, k) => k > 0 && normalizarTexto(c) === "CLIENTE"));
    const coluna = colunasPorNome(linhas[iCab] ?? [], SINONIMOS_DO_RESULTADO).get("imposto");
    const doJob = new Set(jobs.filter((j) => j.aba === aba).map((j) => j.linha));
    const entrada = xlsx.abas.find((a) => a.nome === aba);
    if (!entrada || coluna === undefined) continue;
    const porNumero = new Map(linhas.map((l) => [Number(l[0]), l]));
    for await (const l of linhasDaAba(xlsx.caminho, xlsx.entrada(entrada.entrada), xlsx.contexto)) {
      if (!doJob.has(l.numero)) continue;
      const f = l.textosDasFormulas.get(coluna) ?? "";
      const lista: Termo[] = [];
      for (const m of f.matchAll(TERMO)) {
        if (m[1] !== m[2] || Number(m[5]) !== l.numero) continue;
        lista.push({ aba: m[2], colunaDoCriterio: indiceDaColuna(m[3]), criterio: porNumero.get(l.numero)?.[indiceDaColuna(m[4])] ?? "" });
      }
      termos.set(`${aba}|${l.numero}`, lista.length > 0 ? lista : null);
    }
  }

  const saida = [BOM + linhaCsv(["aba", "linha", "metrica", "planilha", "sistema", "diferenca", "situacao"])];
  const contagem = new Map<string, number>();
  const totais = new Map<string, Somas & { s: Somas }>();
  const difere: string[] = [];
  const somar = (k: string) => contagem.set(k, (contagem.get(k) ?? 0) + 1);
  for (const job of jobs.sort((a, b) => a.aba.localeCompare(b.aba) || a.linha - b.linha)) {
    const lista = termos.get(`${job.aba}|${job.linha}`);
    if (!lista) {
      somar(`${job.aba}|sem fórmula de Faturamento`);
      continue;
    }
    const planilha = vazio();
    for (const t of lista) {
      const fat = await faturamento(t.aba);
      if (fat.colunaDoJob !== t.colunaDoCriterio) throw new Error(`A fórmula de ${job.aba} L${job.linha} procura o job fora da coluna JOB de ${t.aba}.`);
      const casa = predicadoDoCriterio(t.criterio).casa;
      for (const n of fat.notas) {
        if (!casa(n.job)) continue;
        planilha.notas += 1;
        planilha.faturado += n.valor;
        if (n.recebida) planilha.recebido += n.valor;
      }
    }
    const s = sistema.get(job.chave) ?? vazio();
    const t = totais.get(job.aba) ?? { ...vazio(), s: vazio() };
    for (const m of METRICAS) {
      const d = Math.round((s[m] - planilha[m]) * 100) / 100;
      const situacao = Math.abs(d) < 0.005 ? "bate" : "difere";
      somar(`${job.aba}|${m} ${situacao}`);
      t[m] += planilha[m];
      t.s[m] += s[m];
      saida.push(linhaCsv([job.aba, job.linha, m, planilha[m].toFixed(2), s[m].toFixed(2), d.toFixed(2), situacao]));
      if (situacao === "difere") difere.push(`${job.aba} L${job.linha} ${m}: planilha ${fmt(planilha[m])} · sistema ${fmt(s[m])}`);
    }
    totais.set(job.aba, t);
  }
  await mkdir(join(versao, "validacao"), { recursive: true });
  await writeFile(join(versao, "validacao", "faturamento.csv"), saida.join("\n") + "\n", "utf8");

  const porAba = new Map<string, string[]>();
  for (const [k, n] of contagem) {
    const [aba, rotulo] = k.split("|");
    porAba.set(aba, [...(porAba.get(aba) ?? []), `${rotulo} ${n}`]);
  }
  for (const [aba, partes] of [...porAba].sort()) {
    const t = totais.get(aba);
    console.log(`${aba}: ${partes.sort().join(" · ")}`);
    if (t) console.log(`  notas ${t.notas} × ${t.s.notas} · faturado ${fmt(t.faturado)} × ${fmt(t.s.faturado)} · recebido ${fmt(t.recebido)} × ${fmt(t.s.recebido)}`);
  }
  if (difere.length) console.log(`\n${difere.length} células diferem:\n${difere.slice(0, 80).join("\n")}`);
})();
