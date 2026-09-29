// Passo 1 — cópia de segurança, só leitura. Baixa os PDFs das PPs (em uso e
// soltos; os anexos enviados pelas pessoas não mudam e ficam de fora) e as
// planilhas importadas, confere tamanho e MD5 de cada um contra o Storage,
// e guarda os valores do banco que os passos seguintes vão mudar.
//
//   npx tsx scripts/rastros-codigo-anterior/1-backup.ts
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  BUCKET_IMPORTACOES,
  BUCKET_PPS,
  PASTA_BACKUP,
  TENANT_ID,
  clienteDeServico,
  listarBucket,
  md5,
  sha256,
} from "./comum";

async function main() {
  if (existsSync(join(PASTA_BACKUP, "manifesto.json"))) {
    throw new Error("A cópia já existe — não sobrescrevo. Apague a pasta à mão se quiser refazer.");
  }
  const s = clienteDeServico();

  const pps = (await listarBucket(s, BUCKET_PPS)).filter(
    (a) => a.path.endsWith(".pdf") && !a.path.includes("/anexos/"),
  );
  const importacoes = await listarBucket(s, BUCKET_IMPORTACOES);
  const arquivos = [...pps, ...importacoes];

  const manifesto: Array<Record<string, unknown>> = [];
  let totalBytes = 0;
  for (const a of arquivos) {
    const { data, error } = await s.storage.from(a.bucket).download(a.path);
    if (error || !data) throw new Error(`baixar ${a.bucket}/${a.path}: ${error?.message}`);
    const buf = Buffer.from(await data.arrayBuffer());
    if (buf.length !== a.tamanho) {
      throw new Error(`tamanho diferente em ${a.path}: ${buf.length} × ${a.tamanho}`);
    }
    const hashMd5 = md5(buf);
    // O eTag do Storage é o MD5 do conteúdo em upload de uma parte só.
    if (a.etag && /^[0-9a-f]{32}$/.test(a.etag) && a.etag !== hashMd5) {
      throw new Error(`MD5 diferente em ${a.path}: ${hashMd5} × ${a.etag}`);
    }
    const destino = join(PASTA_BACKUP, "storage", a.bucket, a.path);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, buf);
    totalBytes += buf.length;
    manifesto.push({ ...a, md5: hashMd5, sha256: sha256(buf) });
  }

  // Valores do banco que os próximos passos mudam.
  const ler = async (tabela: string, colunas: string) => {
    const { data, error } = await s
      .from(tabela)
      .select(colunas)
      .eq("tenant_id", TENANT_ID)
      .limit(10000);
    if (error) throw new Error(`ler ${tabela}: ${error.message}`);
    return data;
  };
  const banco = {
    projetos: await ler("projetos", "id, codigo, codigo_anterior"),
    orcamentos: await ler("orcamentos", "id, codigo, codigo_anterior"),
    projetos_financeiro: await ler("projetos_financeiro", "id, codigo, codigo_anterior"),
    jobs: await ler("jobs", "id, codigo, codigo_anterior, observacoes"),
    codigos_de_projeto_usados: await ler("codigos_de_projeto_usados", "tenant_id, codigo, projeto_id, registrado_em"),
    orcamento_importacoes: await ler("orcamento_importacoes", "*"),
    pedidos_compra: await ler("pedidos_compra", "id, codigo, status, job_id, pdf_path, updated_at"),
    pedidos_compra_parcelas: await ler("pedidos_compra_parcelas", "id, pedido_compra_id, numero, pdf_path, updated_at"),
  };

  mkdirSync(PASTA_BACKUP, { recursive: true });
  writeFileSync(join(PASTA_BACKUP, "banco.json"), JSON.stringify(banco, null, 2));
  writeFileSync(join(PASTA_BACKUP, "manifesto.json"), JSON.stringify(manifesto, null, 2));

  console.log(
    JSON.stringify(
      {
        pdfs_de_pp: pps.length,
        planilhas_importadas: importacoes.length,
        arquivos: arquivos.length,
        mb: Math.round((totalBytes / 1048576) * 100) / 100,
        banco: Object.fromEntries(Object.entries(banco).map(([k, v]) => [k, (v ?? []).length])),
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
