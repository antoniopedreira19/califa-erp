/**
 * E2 da importação do histórico financeiro (decisão 211): lê os CSVs brutos
 * da E1 e escreve, para a versão da planilha, os movimentos, as notas e os
 * jobs num formato único, a lista de pendências e as propostas de de-para.
 *
 * Uso:
 *   npx tsx scripts/historico-financeiro/padronizar.ts <pasta-da-versao> <pasta-do-retrato-do-sistema> [<pasta-do-de-para>]
 *
 * Com a pasta do de-para aprovado (`aprovar-depara.ts`), os valores do
 * sistema (subtipo do plano, cliente, marca, serviço, regional) saem dela;
 * o que ela ainda não tem sai da proposta e é contado no resumo.
 *
 * Saída em <pasta-da-versao>/padronizado/:
 *   - movimentos.csv  — linhas das contas já realizadas (até a data da exportação),
 *                       com a carga em que entram (D3); contas "fora" (D2) não entram;
 *   - previsoes.csv   — linhas com data futura: previsões, para a virada do 4T;
 *   - notas.csv       — notas emitidas e previsões de faturamento;
 *   - jobs.csv        — os jobs das abas de resultado de 2021 em diante;
 *   - pendencias.csv  — o que não fecha, só da primeira carga (2023 a 30/06/2026);
 *   - propostas/*.csv — de-para proposto de plano de contas, cliente, marca,
 *                       serviço e regional (de 2023 até o corte), para aprovação;
 *   - resumo.json     — contagens por aba e por pendência.
 *
 * As regras estão em `lib/historico-financeiro/regras.ts`, com teste. Nada
 * aqui grava no banco: a carga é outra etapa (A1/A2).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  CORTE,
  EMPRESA_DA_ABA_DE_RESULTADO,
  PAPEL_DAS_ABAS,
  cargaDaData,
  type AbaDeConta,
  type AbaDeFaturamento,
  type AbaDeResultado,
  type Carga,
} from "../../lib/historico-financeiro/abas";
import { SINONIMOS_DA_CONTA, SINONIMOS_DA_NOTA, SINONIMOS_DO_RESULTADO, celula, colunasPorNome } from "../../lib/historico-financeiro/colunas";
import { BOM, lerCsv, linhaCsv } from "../../lib/historico-financeiro/csv";
import {
  chaveDaMarca,
  chaveDaRegional,
  chaveDoCliente,
  chaveDoPlano,
  chaveDoServico,
  lerDePara,
  valorAprovado,
  type DePara,
} from "../../lib/historico-financeiro/depara";
import {
  GRUPOS_DE_JOB,
  GRUPO_SEM_TIPO_PROPOSTO,
  TIPO_DO_PLANO_POR_GRUPO,
  arredondar,
  chaveDeNome,
  colunaDoJob,
  ehCodigoAntigo,
  ehDistribuicaoDeLucro,
  empresaDaSigla,
  inicioDoResumo,
  lerCompetencia,
  linhaEhJob,
  lerData,
  lerNumero,
  lerTipo,
  lerValor,
  normalizarTexto,
  notaCancelada,
  pareceJob,
  proporCliente,
  proporMarca,
  proporServico,
  regionalDaLinha,
  regionalMaisFrequente,
  type ClienteDoSistema,
  type Proposta,
} from "../../lib/historico-financeiro/regras";
import type { Manifesto } from "./extrair";

// ---------------------------------------------------------------- leitura

type Linhas = string[][];

async function lerAba(pastaBruto: string, manifesto: Manifesto, nome: string): Promise<Linhas> {
  const aba = manifesto.abas.find((a) => a.nome === nome);
  if (!aba) throw new Error(`A aba "${nome}" não está no manifesto.`);
  return lerCsv(await readFile(join(pastaBruto, aba.arquivo), "utf8")).slice(1);
}

async function lerRetrato(pasta: string) {
  const linhas = async (arquivo: string) =>
    (await readFile(join(pasta, arquivo), "utf8"))
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => l.split("|"));
  const clientes: ClienteDoSistema[] = (await linhas("clientes.txt")).map(([sigla, fantasia, razao, marcas]) => ({
    sigla,
    fantasia,
    razao,
    marcas: (marcas ?? "").split(";").filter(Boolean),
  }));
  const plano = (await linhas("plano.txt")).map(([tipo, tipoNome, subtipo, subtipoNome]) => ({ tipo, tipoNome, subtipo, subtipoNome }));
  const regionais = (await linhas("regionais.txt")).map(([empresa, regional]) => ({ empresa, regional }));
  const jobs = (await linhas("jobs.txt")).map((p) => ({ codigo: p[0], nomeFinanceiro: p.slice(1, -3).join("|") }));
  return { clientes, plano, regionais, jobs };
}


// ---------------------------------------------------------------- pendências

type Pendencia = { tipo: string; aba: string; linha: string; data: string; valor: string; encontrado: string; detalhe: string };

const pendencias: Pendencia[] = [];
function pendencia(p: Partial<Pendencia> & { tipo: string; aba: string }) {
  pendencias.push({ linha: "", data: "", valor: "", encontrado: "", detalhe: "", ...p });
}

// ---------------------------------------------------------------- jobs

const NAO_E_LINHA_DE_JOB = new Set(["PLANILHA RESULTADO DE JOB", "DRE", "DIFERENCA AUDITORIA", "JOBS", "JOB", "TOTAL"]);

type Job = {
  id: string;
  nome: string;
  coluna: "job" | "evento";
  empresa: string;
  empresaDaAba: string;
  aba: string;
  ano: number;
  linha: string;
  trimestre: string;
  projeto: string;
  cliente: string;
  marca: string;
  servico: string;
  gp: string;
  dataInicio: string;
  regional: string;
  status: string;
  codigoAntigo: string;
  receita: string;
  custo: string;
  imposto: string;
  outrasAbas: string[];
};

function lerJobs(abasDeResultado: { nome: string; papel: AbaDeResultado; linhas: Linhas }[]): Job[] {
  const porId = new Map<string, Job>();
  for (const { nome: aba, papel, linhas } of [...abasDeResultado].sort((a, b) => b.papel.ano - a.papel.ano)) {
    const iCab = linhas.slice(0, 6).findIndex((l) => l.some((c, i) => i > 0 && normalizarTexto(c) === "CLIENTE"));
    if (iCab < 0) continue;
    const colunas = colunasPorNome(linhas[iCab], SINONIMOS_DO_RESULTADO);
    if (!colunas.has("data_inicio") && colunas.has("data")) colunas.set("data_inicio", colunas.get("data")!);
    const daPrimeiraCarga = papel.ano >= 2023 && papel.ano <= 2026;
    for (const l of linhas.slice(iCab + 1)) {
      const nome = (l[1] ?? "").trim();
      const c = (campo: string) => celula(l, colunas, campo);
      if (inicioDoResumo(nome)) break;
      if (NAO_E_LINHA_DE_JOB.has(normalizarTexto(nome)) || normalizarTexto(nome).startsWith("TOTAL")) continue;
      if (!linhaEhJob(nome, c("cliente"), c("trimestre"))) continue;
      // As abas da CMH e da Hitlab guardam o código do sistema antigo na coluna STATUS.
      const codigoAntigo = ehCodigoAntigo(c("codigo_antigo")) ? c("codigo_antigo") : ehCodigoAntigo(c("status")) ? c("status") : "";
      const id = `${papel.coluna}:${normalizarTexto(nome)}`;
      const job: Job = {
        id,
        nome,
        coluna: papel.coluna,
        empresa: EMPRESA_DA_ABA_DE_RESULTADO[papel.empresaDaAba],
        empresaDaAba: papel.empresaDaAba,
        aba,
        ano: papel.ano,
        linha: l[0],
        trimestre: c("trimestre"),
        projeto: c("projeto"),
        cliente: c("cliente"),
        marca: c("marca"),
        servico: c("servico"),
        gp: c("gp"),
        dataInicio: lerData(c("data_inicio")) ?? "",
        regional: c("regional"),
        status: ehCodigoAntigo(c("status")) ? "" : c("status"),
        codigoAntigo,
        receita: c("receita"),
        custo: c("custo"),
        imposto: c("imposto"),
        outrasAbas: [],
      };
      const ja = porId.get(id);
      if (ja) {
        ja.outrasAbas.push(`${aba}:${l[0]}`);
        const difere = ["cliente", "marca", "servico", "projeto"].filter(
          (k) => normalizarTexto(String(ja[k as keyof Job])) !== normalizarTexto(String(job[k as keyof Job])),
        );
        if (difere.length && daPrimeiraCarga)
          pendencia({ tipo: "Job repetido com dados diferentes", aba, linha: l[0], encontrado: nome, detalhe: `Difere em ${difere.join(", ")} de ${ja.aba}:${ja.linha}` });
        continue;
      }
      porId.set(id, job);
      if (!daPrimeiraCarga) continue;
      if (lerNumero(job.servico) !== null && job.servico !== "")
        pendencia({ tipo: "Colunas trocadas no resultado", aba, linha: l[0], encontrado: job.servico, detalhe: `Serviço com número no job "${nome}"` });
    }
  }
  return [...porId.values()];
}

// ---------------------------------------------------------------- movimentos

const COLUNAS_DO_MOVIMENTO = [
  "id", "digital", "aba", "linha", "conta", "conta_situacao", "carga", "data", "natureza", "valor", "credito_planilha", "debito_planilha",
  "classe", "empresa", "sigla_planilha", "grupo", "cod", "competencia_trimestre", "competencia_ano",
  "plano_tipo", "plano_subtipo", "regional_planilha", "regional", "regional_todas",
  "job_id", "job_nome", "job_achado_em", "coluna_jobs", "coluna_evento", "tipo_planilha",
  "descricao", "fornecedor", "parcela", "documento", "observacao", "contrapartida", "dre_extra", "ano_comp", "coluna_reg", "coluna_reg_cmh",
] as const;

type Movimento = Record<(typeof COLUNAS_DO_MOVIMENTO)[number], string>;

type PropostaDoPlano = { tipo: string; subtipo: string; como: string };

function criarPropostaDoPlano(plano: { tipo: string; tipoNome: string; subtipo: string; subtipoNome: string }[], descricoes: Map<string, string>) {
  const cache = new Map<string, PropostaDoPlano>();
  return (grupo: string, cod: string): PropostaDoPlano => {
    const chave = `${grupo}|${normalizarTexto(cod)}`;
    const pronta = cache.get(chave);
    if (pronta) return pronta;
    const semTipo = GRUPO_SEM_TIPO_PROPOSTO[grupo];
    const tipo = TIPO_DO_PLANO_POR_GRUPO[grupo] ?? semTipo?.tipo;
    let proposta: PropostaDoPlano;
    if (!tipo) {
      proposta = { tipo: "", subtipo: "", como: "grupo sem tipo no plano" };
    } else {
      const subtipos = plano.filter((p) => p.tipo === tipo);
      const geral = subtipos.find((s) => s.subtipo === "999") ?? subtipos.find((s) => normalizarTexto(s.subtipoNome) === "OUTROS");
      const descricao = descricoes.get(semTipo?.descricoesDe ? `${semTipo.descricoesDe}|${normalizarTexto(cod)}` : chave) ?? "";
      const alvo = chaveDeNome(descricao === "13.0" ? "13 Salario" : descricao);
      const igual = alvo ? subtipos.find((s) => chaveDeNome(s.subtipoNome) === alvo) : undefined;
      const parecido = alvo && !igual
        ? subtipos.filter((s) => s.subtipo !== "999" && (chaveDeNome(s.subtipoNome).includes(alvo.split(" ")[0]) || alvo.includes(chaveDeNome(s.subtipoNome).split(" ")[0])))
        : [];
      const escolhido = igual ?? (parecido.length === 1 ? parecido[0] : geral);
      const como = semTipo
        ? "grupo sem tipo: proposto"
        : igual
          ? "igual"
          : parecido.length === 1
            ? "parecido"
            : subtipos.length === 1
              ? "tipo com um subtipo só"
              : "geral";
      proposta = { tipo, subtipo: escolhido ? `${tipo}.${escolhido.subtipo}` : "", como };
    }
    cache.set(chave, proposta);
    return proposta;
  };
}

// ---------------------------------------------------------------- notas

/** A coluna Obs. das abas de faturamento diz de qual empresa gerencial é a nota. */
const EMPRESA_DA_OBS: Readonly<Record<string, string>> = {
  CALIFA: "Agência California",
  CALI: "Agência California",
  "CALIFA DP": "Agência California",
  SS: "Agência California",
  CMH: "CCH",
  "CMH FIT": "CCH",
  HITLAB: "Hitlab",
  HIT: "Hitlab",
  FIT: "FitDance",
};

const COLUNAS_DA_NOTA = [
  "id", "aba", "linha", "estabelecimento", "situacao", "classe", "carga", "numero", "emissao", "competencia_trimestre", "competencia_ano",
  "vencimento", "recebimento", "valor", "deducao", "valor_tributavel", "iss", "pis", "cofins", "csll", "ir", "adicional_ir",
  "retencoes", "total_impostos", "empresa", "empresa_por", "job_id", "job_nome", "coluna_job", "cliente", "municipio", "cnae", "obs", "observacao",
] as const;

// ---------------------------------------------------------------- principal

async function main() {
  const [pastaArg, retratoArg, deparaArg] = process.argv.slice(2);
  if (!pastaArg || !retratoArg) {
    console.error("Uso: npx tsx scripts/historico-financeiro/padronizar.ts <pasta-da-versao> <pasta-do-retrato-do-sistema> [<pasta-do-de-para>]");
    process.exit(1);
  }
  const depara: DePara | null = deparaArg ? await lerDePara(resolve(deparaArg)) : null;
  const semAprovacao: Record<keyof DePara, Set<string>> = { plano: new Set(), clientes: new Set(), marcas: new Set(), servicos: new Set(), regionais: new Set() };
  /** O valor do sistema: o aprovado, se o texto está no de-para; senão, a proposta. */
  const final = (tipo: keyof DePara, chave: string, proposta: string) => {
    if (!depara) return proposta;
    const aprovado = depara[tipo].get(chave);
    if (aprovado !== undefined) return aprovado;
    semAprovacao[tipo].add(chave);
    return proposta;
  };
  const pasta = resolve(pastaArg);
  const pastaBruto = join(pasta, "bruto");
  const saida = join(pasta, "padronizado");
  await mkdir(join(saida, "propostas"), { recursive: true });
  const manifesto: Manifesto = JSON.parse(await readFile(join(pastaBruto, "manifesto.json"), "utf8"));
  const retrato = await lerRetrato(resolve(retratoArg));
  /** A regional, se ela existe no sistema para a empresa (a "Urbia" da CMH, por exemplo, não existe). */
  const regionalDoSistema = (empresa: string, nome: string) =>
    nome && retrato.regionais.some((r) => r.empresa === empresa && r.regional === nome) ? nome : "";
  const dataDaVersao = manifesto.origem.exportado_em.slice(0, 10);
  const resumo: Record<string, unknown> = { versao: manifesto.origem, data_da_versao: dataDaVersao, corte: CORTE };

  const abasNovas = manifesto.abas.filter((a) => !PAPEL_DAS_ABAS[a.nome]).map((a) => a.nome);
  resumo.abas_sem_regra = abasNovas;

  // Jobs
  const abasDeResultado: { nome: string; papel: AbaDeResultado; linhas: Linhas }[] = [];
  for (const a of manifesto.abas) {
    const papel = PAPEL_DAS_ABAS[a.nome];
    if (papel?.papel === "resultado" && papel.ano >= 2021) abasDeResultado.push({ nome: a.nome, papel, linhas: await lerAba(pastaBruto, manifesto, a.nome) });
  }
  const jobs = lerJobs(abasDeResultado);
  const indice = { job: new Map<string, Job>(), evento: new Map<string, Job>() };
  for (const j of jobs) indice[j.coluna].set(normalizarTexto(j.nome), j);
  const jobsDoSistema = new Map(retrato.jobs.map((j) => [normalizarTexto(j.nomeFinanceiro), j.codigo]));

  // Descrições do plano da planilha (aba Centro de Custo Código)
  const descricoes = new Map<string, string>();
  for (const l of (await lerAba(pastaBruto, manifesto, "Centro de Custo Código")).slice(1)) {
    if (l[1] && l[3]) descricoes.set(`${normalizarTexto(l[1])}|${normalizarTexto(l[3])}`, l[2] ?? "");
  }
  const propostaDoPlano = criarPropostaDoPlano(retrato.plano, descricoes);

  // Movimentos
  const movimentos: Movimento[] = [];
  const previsoes: Movimento[] = [];
  const porAba: Record<string, Record<string, number>> = {};
  const digitais = new Map<string, number>();
  const usoDoPlano = new Map<string, { grupo: string; cod: string; linhas: number; valor: number }>();
  const regionaisVistas = new Map<string, { empresa: string; valor: string; ocorrencias: number }>();

  for (const a of manifesto.abas) {
    const papel = PAPEL_DAS_ABAS[a.nome];
    if (papel?.papel !== "conta") continue;
    const conta = papel as AbaDeConta;
    const contagem: Record<string, number> = {};
    porAba[a.nome] = contagem;
    const contar = (k: string) => (contagem[k] = (contagem[k] ?? 0) + 1);
    const linhas = await lerAba(pastaBruto, manifesto, a.nome);
    const colunas = colunasPorNome(linhas[0], SINONIMOS_DA_CONTA);
    for (const l of linhas.slice(1)) {
      const c = (campo: string) => celula(l, colunas, campo);
      if (!c("data") && !c("credito") && !c("debito") && !c("tipo") && !c("descricao")) continue;
      contar("linhas");
      if (conta.situacao === "fora") {
        contar("fora do escopo (D2)");
        continue;
      }
      const valor = lerValor(c("credito"), c("debito"));
      if (!valor.ok && valor.motivo === "sem valor") {
        contar("sem valor");
        continue;
      }
      const data = lerData(c("data"));
      const carga: Carga | null = data ? cargaDaData(data) : null;
      if (!data) {
        contar("data inválida");
        pendencia({ tipo: "Data inválida", aba: a.nome, linha: l[0], encontrado: c("data"), valor: c("credito") || c("debito"), detalhe: c("descricao") });
        continue;
      }
      if (!valor.ok) {
        contar(valor.motivo);
        if (carga === "1ª carga") pendencia({ tipo: "Valor que não fecha", aba: a.nome, linha: l[0], data, encontrado: `crédito ${c("credito")} · débito ${c("debito")}`, detalhe: valor.motivo });
        continue;
      }
      const tipo = lerTipo(c("tipo"));
      const sigla = tipo.classe === "dre" ? tipo.sigla : null;
      const empresa = tipo.classe === "dre" ? empresaDaSigla(sigla) : "";
      const { regional, todas } = empresa ? regionalDaLinha(empresa, c("reg"), c("reg_cmh")) : { regional: null, todas: false };
      // O texto de regional que a linha traz, na coluna que vale para a empresa.
      const regionalNaLinha = empresa === "CCH" ? c("reg_cmh") || c("reg") : empresa === "Agência California" ? c("reg") : "";
      const regionalFinal = regionalNaLinha
        ? final("regionais", chaveDaRegional(empresa, regionalNaLinha), regionalDoSistema(empresa, regional ?? ""))
        : regionalDoSistema(empresa, regional ?? "");

      // Job: pela coluna que a planilha usa para a empresa; se não achar, pela outra.
      const preferida = colunaDoJob(sigla);
      const outra = preferida === "job" ? "evento" : "job";
      const naPreferida = indice[preferida].get(normalizarTexto(c(preferida)));
      const naOutra = indice[outra].get(normalizarTexto(c(outra)));
      const job = naPreferida ?? naOutra;
      const achadoEm = naPreferida ? preferida : naOutra ? `${outra} (coluna trocada)` : "";
      const futura = data > dataDaVersao;

      if (carga === "1ª carga" && !futura) {
        if (tipo.classe === "invalido")
          pendencia({ tipo: "Tipo sem padrão", aba: a.nome, linha: l[0], data, valor: String(valor.valor), encontrado: c("tipo"), detalhe: tipo.motivo });
        if (tipo.classe === "dre" && GRUPOS_DE_JOB.has(tipo.grupo) && !job && pareceJob(c(preferida)))
          pendencia({ tipo: "Job não encontrado", aba: a.nome, linha: l[0], data, valor: String(valor.valor), encontrado: c(preferida), detalhe: `Procurado na coluna ${preferida === "job" ? "Jobs" : "Evento"} (Tipo ${c("tipo")})` });
        if (naPreferida && naOutra && naPreferida !== naOutra)
          pendencia({ tipo: "Job nas duas colunas", aba: a.nome, linha: l[0], data, valor: String(valor.valor), encontrado: `${c("job")} | ${c("evento")}`, detalhe: "Jobs e Evento apontam jobs diferentes" });
      }

      const plano = tipo.classe === "dre" ? propostaDoPlano(tipo.grupo, c("cod")) : { tipo: "", subtipo: "", como: "" };
      const subtipo = tipo.classe === "dre" ? final("plano", chaveDoPlano(tipo.grupo, c("cod")), plano.subtipo) : "";
      const base =[a.nome, data, valor.natureza, valor.valor, normalizarTexto(c("descricao")), normalizarTexto(c("fornecedor")), c("tipo"), c("job"), c("evento")].join("|");
      const vez = (digitais.get(base) ?? 0) + 1;
      digitais.set(base, vez);
      const movimento: Movimento = {
        id: `${a.nome}:${l[0]}`,
        digital: createHash("sha1").update(`${base}|${vez}`).digest("hex").slice(0, 16),
        aba: a.nome,
        linha: l[0],
        conta: conta.conta,
        conta_situacao: conta.situacao,
        carga: futura ? "previsão" : carga ?? "",
        data,
        natureza: valor.natureza,
        valor: valor.valor.toFixed(2),
        credito_planilha: valor.credito ? String(valor.credito) : "",
        debito_planilha: valor.debito ? String(valor.debito) : "",
        classe: tipo.classe === "invalido" ? "sem classificação" : tipo.classe,
        empresa,
        sigla_planilha: sigla ?? "",
        grupo: tipo.classe === "dre" ? tipo.grupo : "",
        cod: c("cod"),
        competencia_trimestre: tipo.classe === "dre" && tipo.trimestre ? String(tipo.trimestre) : "",
        competencia_ano: tipo.classe === "dre" ? String(tipo.ano) : "",
        plano_tipo: subtipo ? subtipo.split(".")[0] : plano.tipo,
        plano_subtipo: subtipo,
        regional_planilha: regionalNaLinha,
        regional: regionalFinal,
        regional_todas: todas ? "sim" : "",
        job_id: job?.id ?? "",
        job_nome: job?.nome ?? "",
        job_achado_em: achadoEm,
        coluna_jobs: c("job"),
        coluna_evento: c("evento"),
        tipo_planilha: c("tipo"),
        descricao: c("descricao"),
        fornecedor: c("fornecedor"),
        parcela: c("parcela"),
        documento: c("documento"),
        observacao: c("observacao"),
        contrapartida: tipo.classe === "transferencia" ? tipo.contrapartida : "",
        dre_extra: c("dre_extra"),
        ano_comp: c("ano_comp"),
        // As colunas Reg e CMH Reg como vieram: as abas Gerencial (relatório por regional) somam por elas.
        coluna_reg: c("reg"),
        coluna_reg_cmh: c("reg_cmh"),
      };
      if (futura) {
        contar("previsão (data futura)");
        previsoes.push(movimento);
        continue;
      }
      contar(`realizado · ${carga}`);
      movimentos.push(movimento);
      // As propostas de de-para cobrem tudo o que vai ser carregado: a primeira carga e o 3T.
      if (carga !== "1ª carga" && carga !== "3T 2026") continue;
      if (tipo.classe === "dre") {
        const chavePlano = `${tipo.grupo}|${normalizarTexto(c("cod"))}`;
        const uso = usoDoPlano.get(chavePlano) ?? { grupo: tipo.grupo, cod: c("cod"), linhas: 0, valor: 0 };
        uso.linhas++;
        uso.valor += valor.natureza === "saida" ? valor.valor : -valor.valor;
        usoDoPlano.set(chavePlano, uso);
      }
      if (regionalNaLinha) {
        const chave = `${empresa}|${normalizarTexto(regionalNaLinha)}`;
        const r = regionaisVistas.get(chave) ?? { empresa, valor: regionalNaLinha, ocorrencias: 0 };
        r.ocorrencias++;
        regionaisVistas.set(chave, r);
      }
    }
  }

  // Notas
  const notas: Record<(typeof COLUNAS_DA_NOTA)[number], string>[] = [];
  for (const a of manifesto.abas) {
    const papel = PAPEL_DAS_ABAS[a.nome];
    if (papel?.papel !== "faturamento" || (papel as AbaDeFaturamento).situacao === "fora") continue;
    const fat = papel as AbaDeFaturamento;
    const contagem: Record<string, number> = {};
    porAba[a.nome] = contagem;
    const contar = (k: string) => (contagem[k] = (contagem[k] ?? 0) + 1);
    const linhas = await lerAba(pastaBruto, manifesto, a.nome);
    const iCab = linhas.slice(0, 6).findIndex((l) => l.some((c, i) => i > 0 && i < 4 && normalizarTexto(c) === "NF"));
    if (iCab < 0) {
      pendencia({ tipo: "Aba de faturamento sem cabeçalho", aba: a.nome });
      continue;
    }
    const cab = linhas[iCab];
    const colunas = colunasPorNome(cab, SINONIMOS_DA_NOTA);
    const depois = (campo: string) => {
      const i = colunas.get(campo);
      return i !== undefined && normalizarTexto(cab[i + 1] ?? "") === "T" ? i + 1 : -1;
    };
    const colCompetencia = depois("emissao");
    for (const l of linhas.slice(iCab + 1)) {
      const c = (campo: string) => celula(l, colunas, campo);
      const nf = c("nf");
      if (!nf && !c("job") && !c("valor")) continue;
      const valor = lerNumero(c("valor"));
      const emitida = /^\d+(\.0+)?$/.test(nf);
      const previsao = /^PREV/i.test(nf);
      contar("linhas");
      const emissao = lerData(c("emissao")) ?? "";
      const carga = previsao ? "previsão" : emissao ? cargaDaData(emissao) : "";
      if (!emitida && !previsao) {
        contar("sem número de nota");
        if (valor && carga === "1ª carga") pendencia({ tipo: "Nota sem número", aba: a.nome, linha: l[0], data: emissao, valor: c("valor"), encontrado: nf, detalhe: c("job") });
        continue;
      }
      if (emitida && !emissao && !valor) {
        // Número de nota sem emissão e sem valor: nota cancelada ou número pulado.
        contar("número de NF sem nota (cancelada ou pulada)");
        continue;
      }
      if (emitida && !emissao) {
        contar("emissão inválida");
        pendencia({ tipo: "Data inválida", aba: a.nome, linha: l[0], valor: c("valor"), encontrado: c("emissao"), detalhe: `Emissão da NF ${nf}` });
        continue;
      }
      if (valor === null) {
        contar("valor não numérico");
        if (carga === "1ª carga") pendencia({ tipo: "Valor que não fecha", aba: a.nome, linha: l[0], data: emissao, encontrado: c("valor"), detalhe: `NF ${nf}` });
        continue;
      }
      const cancelada = notaCancelada(c("job"));
      const job = cancelada ? undefined : indice.job.get(normalizarTexto(c("job"))) ?? indice.evento.get(normalizarTexto(c("job")));
      const distribuicao = !job && !cancelada && ehDistribuicaoDeLucro(c("obs"), c("cliente"), c("job"), fat.notasDeSocio);
      const pelaObs = EMPRESA_DA_OBS[normalizarTexto(c("obs"))];
      const empresa = job?.empresa ?? (distribuicao ? fat.empresa : pelaObs) ?? "";
      const situacao = cancelada ? "cancelada" : emitida ? "emitida" : "previsão";
      const classe = job ? "job" : distribuicao ? "distribuição de lucro" : "sem job";
      if (situacao === "emitida" && carga === "1ª carga") {
        if (!empresa)
          pendencia({ tipo: "Nota sem empresa", aba: a.nome, linha: l[0], data: emissao, valor: c("valor"), encontrado: `Obs. "${c("obs")}"`, detalhe: `NF ${nf} · job "${c("job")}" não achado` });
        if (classe === "sem job" && pareceJob(c("job")))
          pendencia({ tipo: "Job da nota não encontrado", aba: a.nome, linha: l[0], data: emissao, valor: c("valor"), encontrado: c("job"), detalhe: `NF ${nf}` });
      }
      const comp = lerCompetencia(colCompetencia >= 0 ? l[colCompetencia] ?? "" : "");
      const numero = (k: string) => {
        const n = lerNumero(c(k));
        return n === null || c(k) === "" ? "" : arredondar(n).toFixed(2);
      };
      contar(situacao === "previsão" ? "previsão de faturamento" : `nota ${situacao} · ${carga}`);
      notas.push({
        id: `${a.nome}:${l[0]}`,
        aba: a.nome,
        linha: l[0],
        estabelecimento: fat.estabelecimento,
        situacao,
        classe,
        carga,
        numero: emitida ? String(Number(nf)) : "",
        emissao,
        competencia_trimestre: comp ? String(comp.trimestre) : "",
        competencia_ano: comp ? String(comp.ano) : "",
        vencimento: lerData(c("vencimento")) ?? "",
        recebimento: lerData(c("recebimento")) ?? "",
        valor: arredondar(valor).toFixed(2),
        deducao: numero("deducao"),
        valor_tributavel: numero("valor_tributavel"),
        iss: numero("iss"),
        pis: numero("pis"),
        cofins: numero("cofins"),
        csll: numero("csll"),
        ir: numero("ir"),
        adicional_ir: numero("adicional_ir"),
        retencoes: numero("retencoes"),
        total_impostos: numero("total_impostos"),
        empresa,
        empresa_por: job ? "job" : distribuicao ? "estabelecimento" : pelaObs ? "Obs." : "",
        job_id: job?.id ?? "",
        job_nome: job?.nome ?? "",
        coluna_job: c("job"),
        cliente: c("cliente"),
        municipio: c("municipio"),
        cnae: c("cnae"),
        obs: c("obs"),
        observacao: c("observacao"),
      });
    }
  }

  // Propostas de de-para
  const clientesPorSigla = new Map(retrato.clientes.map((c) => [c.sigla, c]));
  const jobsDaCarga = jobs.filter((j) => j.ano >= 2022 && j.ano <= 2026);
  const contarPor = <T,>(itens: T[], chave: (t: T) => string) => {
    const m = new Map<string, number>();
    for (const t of itens) {
      const k = chave(t);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const propostaCliente = new Map<string, Proposta>();
  for (const nome of contarPor(jobsDaCarga, (j) => j.cliente.trim()).keys()) propostaCliente.set(nome, proporCliente(nome, retrato.clientes));

  const linhasClientes = [...contarPor(jobsDaCarga, (j) => j.cliente.trim())].sort((a, b) => b[1] - a[1]).map(([nome, n]) => {
    const p = propostaCliente.get(nome)!;
    const cli = clientesPorSigla.get(p.valor);
    return [nome, n, p.valor, cli ? cli.fantasia : "", p.como];
  });
  const linhasMarcas = [...contarPor(jobsDaCarga, (j) => (j.marca.trim() ? `${j.cliente.trim()}|${j.marca.trim()}` : ""))].sort((a, b) => b[1] - a[1]).map(([chave, n]) => {
    const [cliente, marca] = chave.split("|");
    const cli = clientesPorSigla.get(propostaCliente.get(cliente)?.valor ?? "");
    const p = proporMarca(marca, cli);
    return [cliente, marca, n, cli?.sigla ?? "", p.valor, p.como];
  });
  const linhasServicos = [...contarPor(jobsDaCarga, (j) => j.servico.trim())].sort((a, b) => b[1] - a[1]).map(([s, n]) => {
    const p = proporServico(s);
    return [s, n, p.valor, p.como];
  });
  const NOMES_DA_REGIONAL: Record<string, string> = { AGE: "Agency", DOC: "Doca", HIT: "Hitlab" };
  const regionalProposta = (empresa: string, valor: string) => {
    const v = normalizarTexto(valor);
    if (v === "TD") return { regional: "", como: "todas (rateio)" };
    // "COPA" marca os jobs da Copa nos relatórios; a regional de verdade está nos lançamentos (Tiago, 25/10/2026).
    if (v === "COPA") return { regional: "", como: "marcador: regional pelos lançamentos" };
    const nome = NOMES_DA_REGIONAL[v] ?? v;
    const alvo = retrato.regionais.find((r) => r.empresa === empresa && normalizarTexto(r.regional) === normalizarTexto(nome));
    return alvo ? { regional: alvo.regional, como: "igual" } : { regional: "", como: "sem par" };
  };
  for (const j of jobsDaCarga) {
    if (!j.regional) continue;
    const chave = `${j.empresa}|${normalizarTexto(j.regional)}`;
    const r = regionaisVistas.get(chave) ?? { empresa: j.empresa, valor: j.regional, ocorrencias: 0 };
    r.ocorrencias++;
    regionaisVistas.set(chave, r);
  }
  const linhasRegionais = [...regionaisVistas.values()]
    .sort((a, b) => b.ocorrencias - a.ocorrencias)
    .map((r) => {
      const p = regionalProposta(r.empresa, r.valor);
      return [r.empresa, r.valor, r.ocorrencias, p.regional, p.como];
    });
  const linhasPlano = [...usoDoPlano.values()]
    .sort((a, b) => b.linhas - a.linhas)
    .map((u) => {
      const p = propostaDoPlano(u.grupo, u.cod);
      const sub = retrato.plano.find((s) => `${s.tipo}.${s.subtipo}` === p.subtipo);
      return [u.grupo, u.cod, descricoes.get(`${u.grupo}|${normalizarTexto(u.cod)}`) ?? "", u.linhas, arredondar(u.valor).toFixed(2), p.subtipo, sub ? `${sub.tipoNome} · ${sub.subtipoNome}` : "", p.como];
    });

  // Regional do job: a da planilha, quando existe no sistema; senão, a que mais
  // aparece nos lançamentos do job (é a dos lançamentos que a DRE usa).
  const regionaisDoJob = new Map<string, string[]>();
  for (const m of [...movimentos, ...previsoes]) {
    if (!m.job_id || !m.regional) continue;
    const lista = regionaisDoJob.get(m.job_id) ?? [];
    lista.push(m.regional);
    regionaisDoJob.set(m.job_id, lista);
  }
  const jobsComLancamento = new Set([...movimentos, ...previsoes].map((m) => m.job_id).filter(Boolean));
  /** Job da Copa sem nenhum lançamento: cancelado, sai dos relatórios de resultado (Tiago, 25/10/2026). */
  const foraDoResultado = (j: Job) => (normalizarTexto(j.regional) === "COPA" && !jobsComLancamento.has(j.id) ? "Copa sem lançamento" : "");
  const regionalDoJob = (j: Job) => {
    // "TD" é o job de todas as regionais, em rateio: não se escolhe uma.
    if (normalizarTexto(j.regional) === "TD") return { regional: "", por: "todas (rateio)" };
    const pelaPlanilha = j.regional ? final("regionais", chaveDaRegional(j.empresa, j.regional), regionalProposta(j.empresa, j.regional).regional) : "";
    if (pelaPlanilha) return { regional: pelaPlanilha, por: "planilha" };
    const pelosLancamentos = regionalMaisFrequente(regionaisDoJob.get(j.id) ?? []);
    return { regional: pelosLancamentos, por: pelosLancamentos ? "lançamentos" : "" };
  };

  // Pendências de cadastro na primeira carga: regional do job sem par nem na planilha nem nos lançamentos.
  // "COPA" (marcador) e "TD" (todas as regionais) não são pendência, mesmo sem regional no fim.
  for (const j of jobsDaCarga.filter((j) => j.ano >= 2023)) {
    if (j.regional && !["COPA", "TD"].includes(normalizarTexto(j.regional)) && !regionalDoJob(j).regional)
      pendencia({ tipo: "Regional sem par", aba: j.aba, linha: j.linha, encontrado: j.regional, detalhe: `Job "${j.nome}" (${j.empresa})` });
  }

  // Escrita
  const escrever = (arquivo: string, cabecalho: readonly string[], linhas: (readonly (string | number)[])[]) =>
    writeFile(join(saida, arquivo), BOM + [cabecalho, ...linhas].map(linhaCsv).join(""));
  const comoLinha = <K extends string>(colunas: readonly K[], r: Record<K, string>) => colunas.map((k) => r[k]);

  await escrever("movimentos.csv", COLUNAS_DO_MOVIMENTO, movimentos.map((m) => comoLinha(COLUNAS_DO_MOVIMENTO, m)));
  await escrever("previsoes.csv", COLUNAS_DO_MOVIMENTO, previsoes.map((m) => comoLinha(COLUNAS_DO_MOVIMENTO, m)));
  await escrever("notas.csv", COLUNAS_DA_NOTA, notas.map((n) => comoLinha(COLUNAS_DA_NOTA, n)));
  await escrever(
    "jobs.csv",
    [
      "id", "nome", "empresa", "aba_da_planilha", "aba", "ano", "linha", "trimestre", "projeto", "cliente", "marca", "servico", "gp", "data_inicio",
      "regional_planilha", "marcador", "status", "codigo_antigo", "job_sistema", "cliente_sistema", "marca_sistema", "servico_sistema", "regional",
      "regional_por", "fora_do_resultado", "outras_abas", "planilha_receita", "planilha_custo", "planilha_imposto",
    ],
    jobs.map((j) => {
      const pc = proporCliente(j.cliente, retrato.clientes);
      const cliente = j.cliente ? final("clientes", chaveDoCliente(j.cliente), valorAprovado(pc.valor, pc.como)) : "";
      const pm = proporMarca(j.marca, clientesPorSigla.get(cliente));
      const marca = j.marca ? final("marcas", chaveDaMarca(j.cliente, j.marca), valorAprovado(pm.valor, pm.como)) : "";
      const ps = proporServico(j.servico);
      const servico = j.servico ? final("servicos", chaveDoServico(j.servico), valorAprovado(ps.valor, ps.como)) : "";
      const { regional, por } = regionalDoJob(j);
      return [
        j.id, j.nome, j.empresa, j.empresaDaAba, j.aba, j.ano, j.linha, j.trimestre, j.projeto, j.cliente, j.marca, j.servico, j.gp, j.dataInicio,
        j.regional, normalizarTexto(j.regional) === "COPA" ? "Copa" : "", j.status, j.codigoAntigo, jobsDoSistema.get(normalizarTexto(j.nome)) ?? "",
        cliente, marca, servico, regional, por, foraDoResultado(j), j.outrasAbas.join(" "), j.receita, j.custo, j.imposto,
      ];
    }),
  );
  await escrever("pendencias.csv", ["tipo", "aba", "linha", "data", "valor", "encontrado", "detalhe"], pendencias.map((p) => [p.tipo, p.aba, p.linha, p.data, p.valor, p.encontrado, p.detalhe]));
  await escrever("propostas/plano.csv", ["grupo", "cod", "descricao_na_planilha", "linhas_2023_ate_o_corte", "saldo_saidas_menos_entradas", "subtipo_proposto", "nome_no_sistema", "como"], linhasPlano);
  await escrever("propostas/clientes.csv", ["cliente_na_planilha", "jobs", "sigla_proposta", "cliente_no_sistema", "como"], linhasClientes);
  await escrever("propostas/marcas.csv", ["cliente_na_planilha", "marca_na_planilha", "jobs", "cliente_proposto", "marca_proposta", "como"], linhasMarcas);
  await escrever("propostas/servicos.csv", ["servico_na_planilha", "jobs", "servico_proposto", "como"], linhasServicos);
  await escrever("propostas/regionais.csv", ["empresa", "regional_na_planilha", "ocorrencias", "regional_proposta", "como"], linhasRegionais);

  const porTipo: Record<string, number> = {};
  for (const p of pendencias) porTipo[p.tipo] = (porTipo[p.tipo] ?? 0) + 1;
  const somaComo = (linhas: (string | number)[][], i: number) => {
    const m: Record<string, number> = {};
    for (const l of linhas) m[String(l[i])] = (m[String(l[i])] ?? 0) + 1;
    return m;
  };
  Object.assign(resumo, {
    por_aba: porAba,
    jobs: { total: jobs.length, por_aba: Object.fromEntries(contarPor(jobs, (j) => j.aba)), no_sistema: jobs.filter((j) => jobsDoSistema.has(normalizarTexto(j.nome))).length },
    movimentos: { realizados: movimentos.length, previsoes: previsoes.length, por_carga: Object.fromEntries(contarPor(movimentos, (m) => m.carga)) },
    notas: {
      total: notas.length,
      por_carga: Object.fromEntries(contarPor(notas, (n) => `${n.situacao} · ${n.carga}`)),
      por_classe_na_1a_carga: Object.fromEntries(contarPor(notas.filter((n) => n.carga === "1ª carga"), (n) => `${n.situacao} · ${n.classe}`)),
    },
    de_para: depara
      ? { pasta: resolve(deparaArg!), textos_sem_aprovacao: Object.fromEntries(Object.entries(semAprovacao).map(([k, v]) => [k, v.size])) }
      : "só propostas",
    pendencias_da_1a_carga: porTipo,
    propostas: {
      plano: somaComo(linhasPlano, 7),
      clientes: somaComo(linhasClientes, 4),
      marcas: somaComo(linhasMarcas, 5),
      servicos: somaComo(linhasServicos, 3),
      regionais: somaComo(linhasRegionais, 4),
    },
  });
  await writeFile(join(saida, "resumo.json"), JSON.stringify(resumo, null, 2) + "\n");
  console.log(JSON.stringify({ ...resumo, por_aba: undefined, versao: undefined }, null, 2));
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.stack : erro);
  process.exit(1);
});
