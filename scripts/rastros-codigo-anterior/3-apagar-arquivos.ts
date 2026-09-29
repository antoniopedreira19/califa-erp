// Passo 3 — apaga os arquivos com código antigo que nenhuma PP usa mais
// (decisão 126). Roda depois da migration 20260929700001, que aponta a
// PP-00040 e a PP-00091 para o documento único.
//
//   npx tsx scripts/rastros-codigo-anterior/3-apagar-arquivos.ts            # só lista
//   npx tsx scripts/rastros-codigo-anterior/3-apagar-arquivos.ts --apagar   # apaga
//
// Sai do Storage:
//   - todo PDF de PP da cópia que nenhuma PP nem parcela aponta hoje: as
//     versões antigas soltas e os documentos por parcela de antes da 112;
//   - as planilhas importadas da cópia (o Tiago escolheu apagar: viraram
//     versões dos orçamentos e nenhuma tela as lê).
//
// Cada arquivo só sai se: está na cópia, a cópia local confere com o
// manifesto (SHA-256), o arquivo de hoje é o mesmo da cópia (MD5) e — no caso
// dos PDFs — nenhum ponteiro do banco o usa, lido de novo logo antes de
// apagar. Qualquer falha deixa o arquivo onde está e entra no relatório.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUCKET_IMPORTACOES,
  BUCKET_PPS,
  PASTA_BACKUP,
  clienteDeServico,
  listarBucket,
  md5,
  sha256,
} from "./comum";

const APAGAR = process.argv.includes("--apagar");

type ItemDoManifesto = { bucket: string; path: string; md5: string; sha256: string; tamanho: number };

const manifesto = JSON.parse(
  readFileSync(join(PASTA_BACKUP, "manifesto.json"), "utf8"),
) as ItemDoManifesto[];

/** Todo caminho que uma PP ou parcela usa hoje, de qualquer tenant. */
async function ponteirosVivos(s: ReturnType<typeof clienteDeServico>): Promise<Set<string>> {
  const [pps, parcelas] = await Promise.all([
    s.from("pedidos_compra").select("pdf_path").limit(10000),
    s.from("pedidos_compra_parcelas").select("pdf_path").limit(10000),
  ]);
  if (pps.error || parcelas.error) {
    throw new Error(`ler ponteiros: ${pps.error?.message ?? parcelas.error?.message}`);
  }
  return new Set(
    [...(pps.data ?? []), ...(parcelas.data ?? [])]
      .map((r: { pdf_path: string | null }) => r.pdf_path)
      .filter((p): p is string => Boolean(p)),
  );
}

async function main() {
  const s = clienteDeServico();

  const vivos = await ponteirosVivos(s);
  const hojePps = new Map(
    (await listarBucket(s, BUCKET_PPS)).map((a) => [a.path, a] as const),
  );
  const hojeImportacoes = new Map(
    (await listarBucket(s, BUCKET_IMPORTACOES)).map((a) => [a.path, a] as const),
  );

  const candidatos = manifesto.filter(
    (f) =>
      (f.bucket === BUCKET_PPS && !vivos.has(f.path)) ||
      f.bucket === BUCKET_IMPORTACOES,
  );

  const relatorio: Array<Record<string, unknown>> = [];
  const aApagar: Record<string, string[]> = { [BUCKET_PPS]: [], [BUCKET_IMPORTACOES]: [] };

  for (const f of candidatos) {
    const nota: Record<string, unknown> = { bucket: f.bucket, path: f.path };
    try {
      const local = join(PASTA_BACKUP, "storage", f.bucket, f.path);
      if (!existsSync(local)) throw new Error("sem cópia local");
      if (sha256(readFileSync(local)) !== f.sha256) throw new Error("cópia local difere do manifesto");

      const hoje = (f.bucket === BUCKET_PPS ? hojePps : hojeImportacoes).get(f.path);
      if (!hoje) throw new Error("não existe mais no Storage");
      const { data, error } = await s.storage.from(f.bucket).download(f.path);
      if (error || !data) throw new Error(`baixar: ${error?.message}`);
      if (md5(Buffer.from(await data.arrayBuffer())) !== f.md5) {
        throw new Error("o arquivo de hoje não é o da cópia");
      }
      nota.ok = true;
      aApagar[f.bucket].push(f.path);
    } catch (e) {
      nota.erro = e instanceof Error ? e.message : String(e);
    }
    relatorio.push(nota);
  }

  const resumo: Record<string, unknown> = {
    modo: APAGAR ? "apagar" : "lista",
    pdfs_de_pp: aApagar[BUCKET_PPS].length,
    planilhas: aApagar[BUCKET_IMPORTACOES].length,
    recusados: relatorio.filter((r) => r.erro).map((r) => `${r.path}: ${r.erro}`),
  };

  if (APAGAR) {
    // Os ponteiros de novo, logo antes: um PDF que voltou a ser usado fica.
    const vivosAgora = await ponteirosVivos(s);
    const pdfs = aApagar[BUCKET_PPS].filter((p) => !vivosAgora.has(p));
    if (pdfs.length !== aApagar[BUCKET_PPS].length) {
      throw new Error("um PDF passou a ser usado entre a conferência e a remoção — nada apagado");
    }
    const apagados: string[] = [];
    for (const [bucket, paths] of Object.entries(aApagar)) {
      for (let i = 0; i < paths.length; i += 50) {
        const lote = paths.slice(i, i + 50);
        const { data, error } = await s.storage.from(bucket).remove(lote);
        if (error) throw new Error(`apagar em ${bucket}: ${error.message}`);
        apagados.push(...(data ?? []).map((o: { name: string }) => `${bucket}/${o.name}`));
      }
    }
    // Conferência: nenhum dos apagados continua no bucket.
    const restantes = new Set([
      ...(await listarBucket(s, BUCKET_PPS)).map((a) => `${BUCKET_PPS}/${a.path}`),
      ...(await listarBucket(s, BUCKET_IMPORTACOES)).map((a) => `${BUCKET_IMPORTACOES}/${a.path}`),
    ]);
    const esperados = Object.entries(aApagar).flatMap(([b, ps]) => ps.map((p) => `${b}/${p}`));
    resumo.apagados = apagados.length;
    resumo.ainda_no_storage = esperados.filter((p) => restantes.has(p));
    resumo.confirmados_pelo_storage = esperados.filter((p) => !restantes.has(p)).length;
  }

  writeFileSync(
    join(PASTA_BACKUP, APAGAR ? "apagados.json" : "a-apagar.json"),
    JSON.stringify({ resumo, relatorio }, null, 2),
  );
  console.log(JSON.stringify(resumo, null, 2));
}

main().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
