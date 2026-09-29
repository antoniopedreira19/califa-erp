// Passo 5 — reconferência independente, só leitura (decisão 126), pedida
// pelo Tiago depois da operação: "precisa estar 100% correto".
//
//   npx tsx scripts/rastros-codigo-anterior/5-reconferir.ts   (da raiz do repositório)
//
// Compara o que está HOJE no banco e no Storage com a cópia de segurança,
// sem usar a lógica nem os relatórios de comparação do passo 2:
//   - o texto dos PDFs é lido pelo PDFKit da Apple (`pdfkit-texto.js`, via
//     osascript), não pelo extrator do projeto;
//   - cada PDF novo é comparado linha a linha com o antigo da cópia; só
//     passam as trocas combinadas: o código ("Orçamento" vira "Job" com o
//     código do job, "Projeto" sai), cliente e marca nas 11 PPs do Beats, e
//     a tabela de parcelas nas 2 parceladas, conferida contra o banco e
//     contra os PDFs antigos de cada parcela;
//   - o banco é comparado com `banco.json` (status, updated_at, ponteiros,
//     códigos, descritivos, importações, registro de números usados);
//   - o Storage: o que sumiu é exatamente o que o passo 3 apagou.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BUCKET_IMPORTACOES, BUCKET_PPS, PASTA_BACKUP, clienteDeServico, listarBucket, sha256 } from "./comum";

const JXA = join(process.cwd(), "scripts", "rastros-codigo-anterior", "pdfkit-texto.js");
const PASTA_ATUAL = join(PASTA_BACKUP, "reconferencia");

// As trocas que o Tiago aprovou, PP por PP.
const BEATS = new Set([
  "PP-00043", "PP-00049", "PP-00069", "PP-00070", "PP-00071", "PP-00072",
  "PP-00073", "PP-00074", "PP-00075", "PP-00076", "PP-00077",
]);
const PARCELADAS = new Set(["PP-00040", "PP-00091"]);
const VERSAO_RENOMEADA = {
  id: "79426728-02cc-4dad-aa9c-2855207ca72a",
  antes: "Importada de interna-TES-0001_26-01-v3.xlsx",
  depois: "Importada de interna-Orcamento de Teste-v3.xlsx",
};
const IMPORTACOES_RENOMEADAS: Record<string, { nome: string; sufixo: string }> = {
  "interna-TES-0001-26-01-v3.xlsx": { nome: "interna-Orcamento de Teste-v3.xlsx", sufixo: "interna-Orcamento_de_Teste-v3.xlsx" },
  "interna-TES-0001_26-01-v3.xlsx": { nome: "interna-Orcamento de Teste-v3.xlsx", sufixo: "interna-Orcamento_de_Teste-v3.xlsx" },
  "interna-TES-0002_26-04-v1.xlsx": { nome: "interna-Teste Importcao-v1.xlsx", sufixo: "interna-Teste_Importcao-v1.xlsx" },
};
const DESCRITIVO_TROCADO = { job: "TES-1003/26", de: "JOB-0032", para: "TES-1001/26" };

const CODIGO_ANTIGO = /JOB-\d{4}|(^|[^0-9A-Za-z])[A-Za-z0-9]{1,6}-0\d{3}[/_-]\d{2}(?!\d)/;

const problemas: string[] = [];
const falha = (m: string) => problemas.push(m);

function textoPdfKit(arquivo: string): string[] {
  const saida = execFileSync("osascript", ["-l", "JavaScript", JXA, arquivo], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (saida.startsWith("ERRO:")) throw new Error(saida.trim());
  return saida.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Linhas só de um lado (LCS). */
function diferenca(a: string[], b: string[]) {
  const t: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const saiu: string[] = [];
  const entrou: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) saiu.push(a[i++]);
    else entrou.push(b[j++]);
  }
  while (i < a.length) saiu.push(a[i++]);
  while (j < b.length) entrou.push(b[j++]);
  return { saiu, entrou };
}

const reais = (v: number) =>
  "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

// Linhas da parte de parcelas, antes (um PDF por parcela) e depois (tabela).
const LINHA_DE_PARCELA =
  /^(Prazo de Pagto: \d{2}\/\d{2}\/\d{4}|Parcela: \d+\/\d+|Parcelas: \d+|Valor da parcela \(\d+\/\d+\): R\$ [\d.,]+|Valor total do pedido: R\$ [\d.,]+|PARCELAS DO PEDIDO|Parcela Prazo de Pagto Valor|\d+\/\d+ \d{2}\/\d{2}\/\d{4} R\$ [\d.,]+)$/;

type Banco = {
  pedidos_compra: Array<{ id: string; codigo: string; status: string; job_id: string; pdf_path: string; updated_at: string }>;
  pedidos_compra_parcelas: Array<{ id: string; pedido_compra_id: string; numero: number; pdf_path: string; updated_at: string }>;
  jobs: Array<{ id: string; codigo: string; observacoes: string | null }>;
  projetos: Array<{ id: string; codigo: string }>;
  orcamentos: Array<{ id: string; codigo: string }>;
  projetos_financeiro: Array<{ id: string; codigo: string }>;
  codigos_de_projeto_usados: Array<{ tenant_id: string; codigo: string; projeto_id: string | null; registrado_em: string }>;
  orcamento_importacoes: Array<Record<string, unknown> & { id: string; arquivo_nome_original: string; arquivo_path: string }>;
};

async function main() {
  const s = clienteDeServico();
  const banco = JSON.parse(readFileSync(join(PASTA_BACKUP, "banco.json"), "utf8")) as Banco;
  const manifesto = JSON.parse(readFileSync(join(PASTA_BACKUP, "manifesto.json"), "utf8")) as Array<{
    bucket: string; path: string; sha256: string;
  }>;
  const apagados = JSON.parse(readFileSync(join(PASTA_BACKUP, "apagados.json"), "utf8")) as {
    relatorio: Array<{ bucket: string; path: string; ok?: boolean }>;
  };
  const gravacao = JSON.parse(readFileSync(join(PASTA_BACKUP, "gravacao", "relatorio.json"), "utf8")) as Array<{
    pp: string; sha256?: string;
  }>;

  const ler = async <T>(tabela: string, colunas: string): Promise<T[]> => {
    const { data, error } = await s.from(tabela).select(colunas).limit(10000);
    if (error) throw new Error(`ler ${tabela}: ${error.message}`);
    return (data ?? []) as T[];
  };
  const [pps, parcelas, jobs, projetos, orcamentos, projFin, registro, importacoes, versao] = await Promise.all([
    ler<{ id: string; codigo: string; status: string; job_id: string; pdf_path: string; updated_at: string; tenant_id: string }>(
      "pedidos_compra", "id, codigo, status, job_id, pdf_path, updated_at, tenant_id"),
    ler<{ id: string; pedido_compra_id: string; numero: number; data_vencimento: string; valor: number; pdf_path: string; updated_at: string }>(
      "pedidos_compra_parcelas", "id, pedido_compra_id, numero, data_vencimento, valor, pdf_path, updated_at"),
    ler<{ id: string; codigo: string; observacoes: string | null; produto: string | null; projeto_id: string }>(
      "jobs", "id, codigo, observacoes, produto, projeto_id"),
    ler<{ id: string; codigo: string; cliente: { nome_fantasia: string } | null }>(
      "projetos", "id, codigo, cliente:clientes(nome_fantasia)"),
    ler<{ id: string; codigo: string }>("orcamentos", "id, codigo"),
    ler<{ id: string; codigo: string }>("projetos_financeiro", "id, codigo"),
    ler<{ tenant_id: string; codigo: string; projeto_id: string | null; registrado_em: string }>(
      "codigos_de_projeto_usados", "tenant_id, codigo, projeto_id, registrado_em"),
    ler<Record<string, unknown> & { id: string; arquivo_nome_original: string; arquivo_path: string }>("orcamento_importacoes", "*"),
    ler<{ id: string; nome: string | null }>("versoes_orcamento", "id, nome"),
  ]);

  // ---------- 1. PPs e parcelas: nada mudou além do ponteiro das 2 ----------
  const ppAgora = new Map(pps.map((p) => [p.id, p] as const));
  if (pps.length !== banco.pedidos_compra.length) falha(`PPs: ${pps.length} hoje × ${banco.pedidos_compra.length} na cópia`);
  for (const b of banco.pedidos_compra) {
    const a = ppAgora.get(b.id);
    if (!a) { falha(`${b.codigo}: sumiu`); continue; }
    if (a.codigo !== b.codigo) falha(`${b.codigo}: número mudou para ${a.codigo}`);
    if (a.status !== b.status) falha(`${b.codigo}: status ${b.status} → ${a.status}`);
    if (a.job_id !== b.job_id) falha(`${b.codigo}: job mudou`);
    if (a.updated_at !== b.updated_at) falha(`${b.codigo}: updated_at mudou (${b.updated_at} → ${a.updated_at})`);
    const canonico = `${a.tenant_id}/${a.job_id}/${a.id}/pp-${a.codigo}.pdf`;
    if (PARCELADAS.has(b.codigo)) {
      if (a.pdf_path !== canonico) falha(`${b.codigo}: ponteiro não é o documento único`);
    } else if (a.pdf_path !== b.pdf_path) falha(`${b.codigo}: ponteiro mudou`);
  }
  const parcelaAgora = new Map(parcelas.map((p) => [p.id, p] as const));
  if (parcelas.length !== banco.pedidos_compra_parcelas.length) falha(`Parcelas: ${parcelas.length} hoje × ${banco.pedidos_compra_parcelas.length}`);
  for (const b of banco.pedidos_compra_parcelas) {
    const a = parcelaAgora.get(b.id);
    if (!a) { falha(`parcela ${b.id}: sumiu`); continue; }
    if (a.numero !== b.numero || a.pedido_compra_id !== b.pedido_compra_id) falha(`parcela ${b.id}: número ou PP mudou`);
    if (a.updated_at !== b.updated_at) falha(`parcela ${b.id}: updated_at mudou`);
    if (a.pdf_path !== ppAgora.get(a.pedido_compra_id)?.pdf_path) falha(`parcela ${b.id}: não aponta para o documento da PP`);
  }

  // ---------- 2. O texto de cada PDF, antigo × novo, pelo PDFKit ----------
  const jobPorId = new Map(jobs.map((j) => [j.id, j] as const));
  const projetoPorId = new Map(projetos.map((p) => [p.id, p] as const));
  const shaGravacao = new Map(gravacao.map((g) => [g.pp, g.sha256] as const));
  const manifestoPorPath = new Map(manifesto.map((m) => [`${m.bucket}/${m.path}`, m] as const));
  let pdfsConferidos = 0;
  let trocasDeCadastro = 0;
  let tabelasDeParcela = 0;

  for (const b of banco.pedidos_compra) {
    const pp = ppAgora.get(b.id);
    if (!pp) continue;
    const job = jobPorId.get(pp.job_id);
    const projeto = job ? projetoPorId.get(job.projeto_id) : undefined;
    if (!job || !projeto) { falha(`${pp.codigo}: job ou projeto não encontrado`); continue; }

    // Cópia: o documento de antes e os por parcela, conferidos contra o manifesto.
    const antigosPaths = Array.from(new Set([
      b.pdf_path,
      ...banco.pedidos_compra_parcelas.filter((x) => x.pedido_compra_id === b.id).map((x) => x.pdf_path),
    ].filter(Boolean)));
    const antigos = new Map<string, string[]>();
    for (const p of antigosPaths) {
      const local = join(PASTA_BACKUP, "storage", BUCKET_PPS, p);
      const buf = readFileSync(local);
      if (sha256(buf) !== manifestoPorPath.get(`${BUCKET_PPS}/${p}`)?.sha256) falha(`${pp.codigo}: cópia de ${p} não bate com o manifesto`);
      antigos.set(p, textoPdfKit(local));
    }

    // Hoje: baixado do Storage.
    const { data, error } = await s.storage.from(BUCKET_PPS).download(pp.pdf_path);
    if (error || !data) { falha(`${pp.codigo}: baixar o atual: ${error?.message}`); continue; }
    const buf = Buffer.from(await data.arrayBuffer());
    if (sha256(buf) !== shaGravacao.get(pp.codigo)) falha(`${pp.codigo}: o arquivo de hoje não é o que o passo 2 subiu`);
    const local = join(PASTA_ATUAL, pp.pdf_path);
    mkdirSync(dirname(local), { recursive: true });
    writeFileSync(local, buf);
    const novas = textoPdfKit(local);
    pdfsConferidos++;

    // Troca esperada, a partir do documento de antes (o da PP, que no caso
    // das parceladas é o da parcela 1).
    const clienteHoje = projeto.cliente?.nome_fantasia ?? "";
    const marcaHoje = job.produto ?? "";
    const esperado: string[] = [];
    for (const l of antigos.get(b.pdf_path) ?? []) {
      if (l.startsWith("Projeto: ")) continue;
      if (l.startsWith("Orçamento: ")) { esperado.push(`Job: ${job.codigo}`); continue; }
      if (BEATS.has(pp.codigo) && l === "Cliente: Novo") { esperado.push(`Cliente: ${clienteHoje}`); trocasDeCadastro++; continue; }
      if (BEATS.has(pp.codigo) && l === "Marca: Novo") { esperado.push(`Marca: ${marcaHoje}`); trocasDeCadastro++; continue; }
      esperado.push(l);
    }
    const { saiu, entrou } = diferenca(esperado, novas);
    const foraDoCombinado = PARCELADAS.has(pp.codigo)
      ? [...saiu, ...entrou].filter((l) => !LINHA_DE_PARCELA.test(l))
      : [...saiu, ...entrou];
    if (foraDoCombinado.length > 0) falha(`${pp.codigo}: diferença fora do combinado ${JSON.stringify({ saiu, entrou })}`);

    // Regras do documento novo.
    const linhasDeCodigo = novas.filter((l) => /^(Job|Projeto|Orçamento): /.test(l));
    if (linhasDeCodigo.length !== 1 || linhasDeCodigo[0] !== `Job: ${job.codigo}`) {
      falha(`${pp.codigo}: linhas de código ${JSON.stringify(linhasDeCodigo)} (job ${job.codigo})`);
    }
    const comCodigoAntigo = novas.filter((l) => CODIGO_ANTIGO.test(l));
    if (comCodigoAntigo.length > 0) falha(`${pp.codigo}: código antigo no texto ${JSON.stringify(comCodigoAntigo)}`);
    if (!novas.includes(pp.codigo)) falha(`${pp.codigo}: o número da PP não aparece no documento`);
    if (BEATS.has(pp.codigo) && !(novas.includes("Cliente: AMBEV") && novas.includes("Marca: BEATS"))) {
      falha(`${pp.codigo}: cliente e marca não são AMBEV / BEATS`);
    }

    // As parceladas: a tabela bate com o banco e com os PDFs de antes.
    if (PARCELADAS.has(pp.codigo)) {
      tabelasDeParcela++;
      const doBanco = parcelas.filter((x) => x.pedido_compra_id === pp.id).sort((x, y) => x.numero - y.numero);
      const n = doBanco.length;
      const linhasTabela = novas.filter((l) => /^\d+\/\d+ \d{2}\/\d{2}\/\d{4} R\$ [\d.,]+$/.test(l));
      const esperadas = doBanco.map((x) => `${x.numero}/${n} ${dataBr(x.data_vencimento)} ${reais(Number(x.valor))}`);
      if (JSON.stringify(linhasTabela) !== JSON.stringify(esperadas)) {
        falha(`${pp.codigo}: tabela ${JSON.stringify(linhasTabela)} × banco ${JSON.stringify(esperadas)}`);
      }
      if (!novas.includes(`Parcelas: ${n}`)) falha(`${pp.codigo}: sem "Parcelas: ${n}"`);
      const total = doBanco.reduce((acc, x) => acc + Number(x.valor), 0);
      if (!novas.includes(`Valor total do pedido: ${reais(total)}`)) falha(`${pp.codigo}: total ${reais(total)} não aparece`);
      for (const x of doBanco) {
        const doc = banco.pedidos_compra_parcelas.find((y) => y.id === x.id)?.pdf_path;
        const velho = doc ? antigos.get(doc) ?? [] : [];
        const prazo = velho.find((l) => l.startsWith("Prazo de Pagto: "))?.slice("Prazo de Pagto: ".length);
        const valor = velho.find((l) => l.startsWith(`Valor da parcela (${x.numero}/${n}): `))?.split(": ")[1];
        if (prazo !== dataBr(x.data_vencimento) || valor !== reais(Number(x.valor))) {
          falha(`${pp.codigo}: parcela ${x.numero} no PDF antigo (${prazo}, ${valor}) × tabela nova`);
        }
      }
    }
  }

  // ---------- 3. Storage: o que sumiu é o que o passo 3 apagou ----------
  const apagadosOk = new Set(apagados.relatorio.filter((r) => r.ok).map((r) => `${r.bucket}/${r.path}`));
  const hojePps = (await listarBucket(s, BUCKET_PPS)).filter((a) => a.path.endsWith(".pdf") && !a.path.includes("/anexos/"));
  const hojeImp = await listarBucket(s, BUCKET_IMPORTACOES);
  const hoje = new Set([...hojePps.map((a) => `${BUCKET_PPS}/${a.path}`), ...hojeImp.map((a) => `${BUCKET_IMPORTACOES}/${a.path}`)]);
  const ponteirosHoje = new Set(pps.map((p) => `${BUCKET_PPS}/${p.pdf_path}`));
  for (const m of manifesto) {
    const chave = `${m.bucket}/${m.path}`;
    const existe = hoje.has(chave);
    if (existe && !ponteirosHoje.has(chave)) falha(`Storage: ${chave} ficou, sem ninguém apontar`);
    if (!existe && !apagadosOk.has(chave)) falha(`Storage: ${chave} sumiu sem estar na lista do passo 3`);
  }
  for (const chave of hoje) {
    if (!manifestoPorPath.has(chave) && !ponteirosHoje.has(chave)) falha(`Storage: arquivo novo solto ${chave}`);
  }
  if (hojePps.length !== pps.length) falha(`Storage: ${hojePps.length} PDFs de PP × ${pps.length} PPs`);

  // ---------- 4. Banco: códigos, descritivos, importações, versão, registro ----------
  const compararCodigos = (nome: string, antes: Array<{ id: string; codigo: string }>, agora: Array<{ id: string; codigo: string }>) => {
    const m = new Map(agora.map((x) => [x.id, x.codigo] as const));
    for (const x of antes) {
      if (!m.has(x.id)) falha(`${nome} ${x.codigo}: sumiu`);
      else if (m.get(x.id) !== x.codigo) falha(`${nome} ${x.codigo}: código mudou para ${m.get(x.id)}`);
    }
  };
  compararCodigos("projeto", banco.projetos, projetos);
  compararCodigos("orçamento", banco.orcamentos, orcamentos);
  compararCodigos("projeto do financeiro", banco.projetos_financeiro, projFin);
  compararCodigos("job", banco.jobs, jobs);

  let descritivosIguais = 0;
  for (const b of banco.jobs) {
    const a = jobPorId.get(b.id);
    if (!a) continue;
    const esperado = b.codigo === DESCRITIVO_TROCADO.job
      ? (b.observacoes ?? "").split(DESCRITIVO_TROCADO.de).join(DESCRITIVO_TROCADO.para)
      : b.observacoes;
    if ((a.observacoes ?? null) !== (esperado ?? null)) falha(`descritivo do ${b.codigo} diferente do esperado`);
    else descritivosIguais++;
  }

  const impAgora = new Map(importacoes.map((x) => [x.id, x] as const));
  for (const b of banco.orcamento_importacoes) {
    const a = impAgora.get(b.id);
    if (!a) { falha(`importação ${b.id}: sumiu`); continue; }
    const troca = IMPORTACOES_RENOMEADAS[b.arquivo_nome_original];
    const esperado = { ...b };
    if (troca) {
      esperado.arquivo_nome_original = troca.nome;
      esperado.arquivo_path = b.arquivo_path.slice(0, b.arquivo_path.length - b.arquivo_nome_original.length) + troca.sufixo;
    }
    for (const k of Object.keys(esperado)) {
      if (JSON.stringify(a[k]) !== JSON.stringify(esperado[k])) falha(`importação ${b.id}: ${k} diferente do esperado`);
    }
  }
  const v = versao.find((x) => x.id === VERSAO_RENOMEADA.id);
  if (v?.nome !== VERSAO_RENOMEADA.depois) falha(`versão ${VERSAO_RENOMEADA.id}: nome "${v?.nome}"`);
  if (versao.some((x) => x.nome === VERSAO_RENOMEADA.antes)) falha("ainda há versão com o nome antigo");

  // Registro: os do formato novo que já havia ficam; os antigos viram P, mesmo projeto.
  const regAgora = new Map(registro.map((r) => [`${r.tenant_id}|${r.codigo}`, r] as const));
  const regEsperado = new Map<string, string | null>();
  for (const r of banco.codigos_de_projeto_usados) {
    const codigo = r.codigo.replace(/^(.+)-0(\d{3,})\/(\d{2})$/, "$1-P$2/$3");
    const chave = `${r.tenant_id}|${codigo}`;
    if (regEsperado.has(chave) && regEsperado.get(chave) !== r.projeto_id) falha(`registro: ${codigo} com dois projetos`);
    regEsperado.set(chave, r.projeto_id);
  }
  for (const [chave, projetoId] of regEsperado) {
    const a = regAgora.get(chave);
    if (!a) falha(`registro: falta ${chave}`);
    else if (a.projeto_id !== projetoId) falha(`registro: ${chave} com outro projeto`);
  }
  for (const r of registro) {
    if (/-0\d{3,}\/\d{2}$/.test(r.codigo)) falha(`registro: ainda no formato antigo ${r.codigo}`);
    if (!regEsperado.has(`${r.tenant_id}|${r.codigo}`)) falha(`registro: linha nova ${r.codigo} (conferir se é de hoje)`);
  }

  const resumo = {
    pps: pps.length,
    parcelas: parcelas.length,
    pdfs_conferidos_pelo_pdfkit: pdfsConferidos,
    trocas_de_cliente_e_marca: trocasDeCadastro,
    tabelas_de_parcela_conferidas: tabelasDeParcela,
    pdfs_de_pp_no_storage: hojePps.length,
    planilhas_no_storage: hojeImp.length,
    descritivos_conferidos: descritivosIguais,
    importacoes_conferidas: banco.orcamento_importacoes.length,
    registro: `${registro.length} linhas (esperado ${regEsperado.size})`,
    problemas,
  };
  writeFileSync(join(PASTA_BACKUP, "reconferencia.json"), JSON.stringify(resumo, null, 2));
  console.log(JSON.stringify(resumo, null, 2));
}

main().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
