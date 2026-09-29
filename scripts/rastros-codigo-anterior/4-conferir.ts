// Passo 4 — conferência final, só leitura (decisão 126).
//
//   npx tsx scripts/rastros-codigo-anterior/4-conferir.ts
//
// Baixa todo PDF de PP que está no Storage (fora os anexos) e lê o texto:
// cada um tem de ter uma linha de código só, "Job: <código do job da PP>",
// e nenhum código antigo, "Projeto:" ou "Orçamento:". Confere também que os
// PDFs no bucket e os ponteiros do banco são o mesmo conjunto, que cada PP
// aponta para o arquivo que o passo 2 subiu (SHA-256), e que nenhum nome de
// arquivo, nos dois buckets, carrega código antigo.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { linhasDoPdf } from "./pdf-texto";
import { BUCKET_IMPORTACOES, BUCKET_PPS, PASTA_BACKUP, clienteDeServico, listarBucket, sha256 } from "./comum";

// O código de antes da decisão 114: JOB-NNNN, e SIGLA-0NNN/AA em qualquer
// grafia de arquivo ("/", "_" ou "-" antes do ano).
const CODIGO_ANTIGO = /JOB-\d{4}|(^|[^0-9A-Za-z])[A-Za-z0-9]{1,6}-0\d{3}[/_-]\d{2}(?!\d)/;

async function main() {
  const s = clienteDeServico();
  const gravacao = JSON.parse(
    readFileSync(join(PASTA_BACKUP, "gravacao", "relatorio.json"), "utf8"),
  ) as Array<{ pp: string; sha256?: string }>;
  const shaDaGravacao = new Map(gravacao.map((g) => [g.pp, g.sha256] as const));

  const { data: pps, error } = await s
    .from("pedidos_compra")
    .select("id, codigo, pdf_path, job:jobs(codigo), parcelas:pedidos_compra_parcelas(pdf_path)");
  if (error || !pps) throw new Error(`ler PPs: ${error?.message}`);

  const noBucket = (await listarBucket(s, BUCKET_PPS)).filter(
    (a) => a.path.endsWith(".pdf") && !a.path.includes("/anexos/"),
  );
  const caminhosNoBucket = new Set(noBucket.map((a) => a.path));
  const ponteiros = new Set<string>();

  const problemas: string[] = [];
  for (const pp of pps as unknown as Array<{
    codigo: string;
    pdf_path: string | null;
    job: { codigo: string } | null;
    parcelas: Array<{ pdf_path: string | null }>;
  }>) {
    if (!pp.pdf_path) {
      problemas.push(`${pp.codigo}: sem PDF`);
      continue;
    }
    ponteiros.add(pp.pdf_path);
    for (const pa of pp.parcelas) {
      if (pa.pdf_path) ponteiros.add(pa.pdf_path);
      if (pa.pdf_path !== pp.pdf_path) problemas.push(`${pp.codigo}: parcela aponta para outro documento`);
    }
    if (!caminhosNoBucket.has(pp.pdf_path)) {
      problemas.push(`${pp.codigo}: o arquivo do ponteiro não existe`);
      continue;
    }
    const { data, error: e } = await s.storage.from(BUCKET_PPS).download(pp.pdf_path);
    if (e || !data) {
      problemas.push(`${pp.codigo}: baixar: ${e?.message}`);
      continue;
    }
    const buf = Buffer.from(await data.arrayBuffer());
    const esperado = shaDaGravacao.get(pp.codigo);
    if (esperado && sha256(buf) !== esperado) problemas.push(`${pp.codigo}: não é o arquivo que o passo 2 subiu`);
    if (!esperado) problemas.push(`${pp.codigo}: PP fora da gravação (nova desde a cópia?)`);

    const linhas = linhasDoPdf(buf);
    const codigoPP = linhas.filter((l) => /^(Job|Projeto|Orçamento): /.test(l));
    if (codigoPP.length !== 1 || codigoPP[0] !== `Job: ${pp.job?.codigo}`) {
      problemas.push(`${pp.codigo}: linhas de código ${JSON.stringify(codigoPP)} (job ${pp.job?.codigo})`);
    }
    const antigas = linhas.filter((l) => CODIGO_ANTIGO.test(l));
    if (antigas.length > 0) problemas.push(`${pp.codigo}: código antigo no texto ${JSON.stringify(antigas)}`);
    if (!linhas.some((l) => l === `Pedido de Compra ${pp.codigo}` || l.includes(pp.codigo))) {
      problemas.push(`${pp.codigo}: o número da PP não aparece no documento`);
    }
  }

  const soltos = [...caminhosNoBucket].filter((p) => !ponteiros.has(p));
  const semArquivo = [...ponteiros].filter((p) => !caminhosNoBucket.has(p));

  const importacoes = await listarBucket(s, BUCKET_IMPORTACOES);
  const nomesAntigos = [
    ...noBucket.map((a) => a.path),
    ...importacoes.map((a) => a.path),
  ].filter((p) => CODIGO_ANTIGO.test(p.split("/").slice(-1)[0]));

  console.log(
    JSON.stringify(
      {
        pps: pps.length,
        pdfs_no_bucket: noBucket.length,
        pdfs_soltos: soltos,
        ponteiros_sem_arquivo: semArquivo,
        planilhas_importadas_no_bucket: importacoes.length,
        nomes_de_arquivo_com_codigo_antigo: nomesAntigos,
        problemas,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
