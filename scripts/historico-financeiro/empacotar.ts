/**
 * Pacote de carga do histórico financeiro (decisão 211, A1): junta num .json o
 * que uma carga leva — os movimentos e as notas do período, os jobs das abas
 * de resultado, o rateio das abas Gerencial e os saldos da planilha — para a
 * tela Financeiro › Cadastros › Histórico da planilha carregar.
 *
 * Uso:
 *   npx tsx scripts/historico-financeiro/empacotar.ts <pasta-da-versao> --carga "1ª carga"
 *   npx tsx scripts/historico-financeiro/empacotar.ts <pasta-da-versao> --carga "3T 2026"
 *   npx tsx scripts/historico-financeiro/empacotar.ts <pasta-da-versao> --nome "Teste da A1" \
 *     --de 2023-01-01 --ate 2023-01-31 --conta "BB California"
 *
 *   npx tsx scripts/historico-financeiro/empacotar.ts <pasta-da-versao> --cauda
 *   npx tsx scripts/historico-financeiro/empacotar.ts <pasta-da-versao> --so-dre
 *
 * A cauda (A6) vai do dia seguinte ao corte até o dia em que a planilha foi
 * baixada e leva só os movimentos e as notas dos jobs até o 3T de 2026 que
 * não existem no sistema (sem `job_sistema` no de-para); os jobs do 4T, os
 * do sistema e o que não é de job entram pelo sistema. Sem rateio nem saldos.
 *
 * O só DRE vai do mesmo dia até a mesma data e leva as linhas de
 * <pasta-da-versao>/so-dre/linhas.json ({ "ids": [...] }, os ids do
 * padronizado): o que já foi pago pelo sistema e precisa contar no resultado
 * sem contar no saldo. Leva também os jobs citados, porque o relatório regional
 * divide o custo pelo job da mesma carga. Sem notas, rateio nem saldos.
 *
 * Com `--conta` (pode repetir), a carga leva só os movimentos e os saldos
 * daquelas contas e só os jobs que os movimentos e as notas citam: serve para
 * uma carga pequena de teste. O período vai do primeiro dia de um mês ao
 * último de outro, porque os saldos são do fim do mês, e não passa do corte.
 *
 * O pacote é conferido aqui como a tela e o servidor vão conferir. Saída em
 * <pasta-da-versao>/cargas/<nome>.json — com dado da planilha, fica em tmp/,
 * fora do git.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { CORTE } from "../../lib/historico-financeiro/abas";
import { lerCsv } from "../../lib/historico-financeiro/csv";
import { lerTabelaCsv } from "../../lib/historico-financeiro/depara";
import {
  FONTES_DO_RATEIO,
  jobDaCauda,
  movimentoDaCauda,
  movimentosSoDre,
  linhaDeJob,
  linhaDeMovimento,
  linhaDeNota,
  linhasDeSaldo,
  linhasDoRateio,
  type LinhaLida,
} from "../../lib/historico-financeiro/empacotar";
import {
  COLUNAS_DO_PACOTE,
  FORMATO_DO_PACOTE,
  TABELAS_DO_PACOTE,
  lerPacote,
  linhaComoObjeto,
  somaEmTexto,
  type Pacote,
  type TabelaDoPacote,
  type TabelaEmbalada,
  type ValorDoPacote,
} from "../../lib/historico-financeiro/pacote";
import type { Manifesto } from "./extrair";

const USO =
  'Uso: npx tsx scripts/historico-financeiro/empacotar.ts <pasta-da-versao> --carga "1ª carga"\n' +
  '  ou: … <pasta-da-versao> --nome "Teste da A1" --de 2023-01-01 --ate 2023-01-31 [--conta "BB California"]\n' +
  '  ou: … <pasta-da-versao> --cauda\n' +
  '  ou: … <pasta-da-versao> --so-dre';

const NOME_DA_CAUDA = "Outubro 2026 · competência até o 3T";
const NOME_DO_SO_DRE = "Outubro 2026 · só DRE";

const PERIODOS: Record<string, [string, string]> = {
  "1ª carga": ["2023-01-01", "2026-06-30"],
  "3T 2026": ["2026-07-01", "2026-09-30"],
};

type Opcoes = { carga?: string; nome?: string; de?: string; ate?: string; contas: string[]; cauda?: boolean; soDre?: boolean };

function lerArgumentos(args: string[]): { pasta: string | undefined; opcoes: Opcoes } {
  const opcoes: Opcoes = { contas: [] };
  for (let k = 1; k < args.length; k += 2) {
    const chave = args[k];
    if (chave === "--cauda" || chave === "--so-dre") {
      if (chave === "--cauda") opcoes.cauda = true;
      else opcoes.soDre = true;
      k -= 1; // sem valor
      continue;
    }
    const valor = args[k + 1];
    if (valor === undefined) throw new Error(`Falta o valor de ${chave}.`);
    if (chave === "--carga") opcoes.carga = valor;
    else if (chave === "--nome") opcoes.nome = valor;
    else if (chave === "--de") opcoes.de = valor;
    else if (chave === "--ate") opcoes.ate = valor;
    else if (chave === "--conta") opcoes.contas.push(valor);
    else throw new Error(`Opção desconhecida: ${chave}.`);
  }
  return { pasta: args[0], opcoes };
}

const ultimoDiaDoMes = (data: string) => {
  const [ano, mes] = data.split("-").map(Number);
  return new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
};

const nomeDeArquivo = (nome: string) =>
  nome
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const embalar = (tabela: TabelaDoPacote, linhas: ValorDoPacote[][]): TabelaEmbalada => ({
  colunas: COLUNAS_DO_PACOTE[tabela].map((c) => c.nome),
  linhas,
});

const valoresDaColuna = (tabela: TabelaDoPacote, embalada: TabelaEmbalada, coluna: string) => {
  const k = COLUNAS_DO_PACOTE[tabela].findIndex((c) => c.nome === coluna);
  return embalada.linhas.map((l) => l[k] as number | null);
};

async function main() {
  const { pasta, opcoes } = lerArgumentos(process.argv.slice(2));
  if (!pasta) {
    console.error(USO);
    process.exit(1);
  }
  const versao = resolve(pasta);
  if (opcoes.cauda) return empacotarCauda(versao);
  if (opcoes.soDre) return empacotarSoDre(versao);
  const padrao = opcoes.carga ? PERIODOS[opcoes.carga] : undefined;
  if (opcoes.carga && !padrao) {
    throw new Error(`Carga desconhecida: ${opcoes.carga}. Use ${Object.keys(PERIODOS).join(" ou ")}, ou --nome com --de e --ate.`);
  }
  const nome = opcoes.nome ?? opcoes.carga;
  const de = opcoes.de ?? padrao?.[0];
  const ate = opcoes.ate ?? padrao?.[1];
  if (!nome || !de || !ate) throw new Error(`Diga a carga, ou o nome e o período.\n${USO}`);
  if (!/^\d{4}-\d{2}-01$/.test(de) || ultimoDiaDoMes(ate) !== ate) {
    throw new Error("O período vai do primeiro dia de um mês ao último dia de outro: os saldos são do fim do mês.");
  }
  if (de > ate) throw new Error("O período começa depois de terminar.");
  if (ate > CORTE) throw new Error(`O histórico vai até ${CORTE}: depois disso vale o sistema.`);

  const manifesto: Manifesto = JSON.parse(await readFile(join(versao, "bruto", "manifesto.json"), "utf8"));
  const ler = async (...caminho: string[]): Promise<LinhaLida[]> => {
    const tabela = await lerTabelaCsv(join(versao, ...caminho));
    if (!tabela) throw new Error(`Não achei ${join(...caminho)}: rode a padronização (E2) e a validação (E3) antes.`);
    return tabela;
  };
  const [movimentos, notas, jobs, saldos] = await Promise.all([
    ler("padronizado", "movimentos.csv"),
    ler("padronizado", "notas.csv"),
    ler("padronizado", "jobs.csv"),
    ler("validacao", "saldos.csv"),
  ]);

  const contas = new Set(opcoes.contas);
  for (const c of contas) {
    if (!saldos.some((s) => s.conta === c)) throw new Error(`A conta "${c}" não aparece no padronizado.`);
  }
  const daCarga = (conta: string) => contas.size === 0 || contas.has(conta);

  const movs = movimentos.filter((m) => m.data >= de && m.data <= ate && daCarga(m.conta));
  const nts = notas.filter((n) => (n.situacao === "emitida" || n.situacao === "cancelada") && n.emissao >= de && n.emissao <= ate);
  const citados = new Set([...movs.map((m) => m.job_id), ...nts.map((n) => n.job_id)].filter(Boolean));
  const jbs = contas.size === 0 ? jobs : jobs.filter((j) => citados.has(j.id));

  const rateio: ValorDoPacote[][] = [];
  const abas = new Map<string, Map<number, string[]>>();
  for (const fonte of FONTES_DO_RATEIO) {
    let aba = abas.get(fonte.aba);
    if (!aba) {
      const noManifesto = manifesto.abas.find((a) => a.nome === fonte.aba);
      if (!noManifesto) throw new Error(`A aba ${fonte.aba} não está no manifesto.`);
      const linhas = lerCsv(await readFile(join(versao, "bruto", noManifesto.arquivo), "utf8")).slice(1);
      aba = new Map(linhas.map((l) => [Number(l[0]), l]));
      abas.set(fonte.aba, aba);
    }
    const { linhas, soma } = linhasDoRateio(fonte, aba);
    if (linhas.length === 0) throw new Error(`${fonte.aba}, linha ${fonte.linha}: nenhum percentual.`);
    if (Math.abs(soma - 100) > 0.001) console.warn(`Aviso: ${fonte.aba}, linha ${fonte.linha} soma ${soma}%, e não 100%.`);
    rateio.push(...linhas);
  }

  const mesesPorConta = new Map<string, LinhaLida[]>();
  for (const s of saldos) {
    if (!daCarga(s.conta)) continue;
    mesesPorConta.set(s.conta, [...(mesesPorConta.get(s.conta) ?? []), s]);
  }
  const sld = [...mesesPorConta.keys()].sort().flatMap((c) => linhasDeSaldo(c, mesesPorConta.get(c)!, de, ate));

  const tabelas: Pacote["tabelas"] = {
    rateio: embalar("rateio", rateio),
    saldos: embalar("saldos", sld),
    jobs: embalar("jobs", jbs.map(linhaDeJob)),
    notas: embalar("notas", nts.map(linhaDeNota)),
    movimentos: embalar("movimentos", movs.map(linhaDeMovimento)),
  };
  await gravarPacote(versao, manifesto, { nome, de, ate, tipo: "periodo" }, tabelas);
}

async function gravarPacote(versao: string, manifesto: Manifesto, carga: Pacote["carga"], tabelas: Pacote["tabelas"]) {
  const pacote: Pacote = {
    formato: FORMATO_DO_PACOTE,
    carga,
    planilha: {
      versao: (manifesto.origem.exportado_em || basename(versao)).slice(0, 10),
      arquivo: manifesto.origem.arquivo,
      sha256: manifesto.origem.sha256,
      exportado_em: manifesto.origem.exportado_em || null,
    },
    esperado: {
      movimentos: { linhas: tabelas.movimentos.linhas.length, soma: somaEmTexto(valoresDaColuna("movimentos", tabelas.movimentos, "valor")) },
      notas: { linhas: tabelas.notas.linhas.length, soma: somaEmTexto(valoresDaColuna("notas", tabelas.notas, "valor")) },
      jobs: { linhas: tabelas.jobs.linhas.length },
      rateio: { linhas: tabelas.rateio.linhas.length },
      saldos: { linhas: tabelas.saldos.linhas.length },
    },
    tabelas,
  };

  // A mesma conferência da tela (cabeçalho e colunas) e do servidor (cada linha).
  const texto = JSON.stringify(pacote);
  const lido = lerPacote(texto);
  if (!lido.ok) throw new Error(lido.message);
  for (const tabela of TABELAS_DO_PACOTE) {
    tabelas[tabela].linhas.forEach((l, k) => {
      const r = linhaComoObjeto(tabela, l);
      if (!r.ok) throw new Error(`${tabela}, linha ${k + 1} do pacote: ${r.message}.`);
    });
  }

  const pastaDeSaida = join(versao, "cargas");
  await mkdir(pastaDeSaida, { recursive: true });
  const arquivo = join(pastaDeSaida, `${nomeDeArquivo(carga.nome)}.json`);
  await writeFile(arquivo, texto);
  console.log(
    JSON.stringify(
      { arquivo, megabytes: Math.round((Buffer.byteLength(texto) / 1e6) * 10) / 10, carga: pacote.carga, esperado: pacote.esperado },
      null,
      2,
    ),
  );
}

/** A cauda (A6): do dia seguinte ao corte até a versão da planilha, o que é de competência até o 3T e fica fora do
 *  sistema — os jobs até o 3T que não existem nele e, sem job, o DRE até o 3T (`movimentoDaCauda`). */
async function empacotarCauda(versao: string) {
  const manifesto: Manifesto = JSON.parse(await readFile(join(versao, "bruto", "manifesto.json"), "utf8"));
  const ler = async (...caminho: string[]): Promise<LinhaLida[]> => {
    const tabela = await lerTabelaCsv(join(versao, ...caminho));
    if (!tabela) throw new Error(`Não achei ${join(...caminho)}: rode a padronização (E2) antes.`);
    return tabela;
  };
  const [movimentos, notas, jobs] = await Promise.all([
    ler("padronizado", "movimentos.csv"),
    ler("padronizado", "notas.csv"),
    ler("padronizado", "jobs.csv"),
  ]);
  const de = diaSeguinte(CORTE);
  const ate = (manifesto.origem.exportado_em || basename(versao)).slice(0, 10);
  if (ate < de) throw new Error(`A planilha é de ${ate}: não tem nada depois do corte.`);

  const daCauda = new Set(jobs.filter(jobDaCauda).map((j) => j.id));
  const movs = movimentos.filter((m) => m.carga === "depois do corte" && m.data >= de && m.data <= ate && movimentoDaCauda(m, daCauda));
  const nts = notas.filter(
    (n) => (n.situacao === "emitida" || n.situacao === "cancelada") && n.emissao >= de && n.emissao <= ate && daCauda.has(n.job_id),
  );
  const citados = new Set([...movs.map((m) => m.job_id), ...nts.map((n) => n.job_id)].filter(Boolean));
  const jbs = jobs.filter((j) => citados.has(j.id));

  const tabelas: Pacote["tabelas"] = {
    rateio: embalar("rateio", []),
    saldos: embalar("saldos", []),
    jobs: embalar("jobs", jbs.map(linhaDeJob)),
    notas: embalar("notas", nts.map(linhaDeNota)),
    movimentos: embalar("movimentos", movs.map(linhaDeMovimento)),
  };
  await gravarPacote(versao, manifesto, { nome: NOME_DA_CAUDA, de, ate, tipo: "cauda" }, tabelas);
}

/** O só DRE: do dia seguinte ao corte até a versão da planilha, as linhas da lista (`movimentosSoDre`) e os jobs delas. */
async function empacotarSoDre(versao: string) {
  const manifesto: Manifesto = JSON.parse(await readFile(join(versao, "bruto", "manifesto.json"), "utf8"));
  const ler = async (...caminho: string[]): Promise<LinhaLida[]> => {
    const tabela = await lerTabelaCsv(join(versao, ...caminho));
    if (!tabela) throw new Error(`Não achei ${join(...caminho)}: rode a padronização (E2) antes.`);
    return tabela;
  };
  const [movimentos, jobs] = await Promise.all([ler("padronizado", "movimentos.csv"), ler("padronizado", "jobs.csv")]);
  const lista: { ids: string[] } = JSON.parse(await readFile(join(versao, "so-dre", "linhas.json"), "utf8"));
  const de = diaSeguinte(CORTE);
  const ate = (manifesto.origem.exportado_em || basename(versao)).slice(0, 10);

  const daCauda = new Set(jobs.filter(jobDaCauda).map((j) => j.id));
  const movs = movimentosSoDre(movimentos, new Set(lista.ids), daCauda);
  const citados = new Set(movs.map((m) => m.job_id).filter(Boolean));

  const tabelas: Pacote["tabelas"] = {
    rateio: embalar("rateio", []),
    saldos: embalar("saldos", []),
    jobs: embalar("jobs", jobs.filter((j) => citados.has(j.id)).map(linhaDeJob)),
    notas: embalar("notas", []),
    movimentos: embalar("movimentos", movs.map(linhaDeMovimento)),
  };
  await gravarPacote(versao, manifesto, { nome: NOME_DO_SO_DRE, de, ate, tipo: "so_dre" }, tabelas);
}

const diaSeguinte = (data: string) => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
