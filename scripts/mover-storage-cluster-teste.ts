/**
 * Move os 124 arquivos do cluster "Empresa Teste" dentro do mesmo bucket,
 * trocando o prefixo do tenant no path:
 *   d2a02c10-9c7e-4157-8dd5-84bbf5a7044c/... (agencia-california)
 *     -> db9278e5-1293-407f-bd33-d71b7061a849/... (california-sandbox)
 *
 * Alinha com as migrations 20261109970001 + 20261109970002, que moveram
 * a Empresa Teste e descendentes (40 jobs, 75 PPs, lançamentos, etc.) pro
 * sandbox. Sem este script, os arquivos no Storage ficam inacessíveis pelo
 * sandbox (a RLS do bucket filtra pelo tenant extraído do primeiro segmento
 * do path) e permanecem acessíveis por prod — o que contamina o prod.
 *
 * Buckets afetados (varredura via MCP mostrou 124 arquivos):
 *   - pedidos-compra      (123)
 *   - envios-faturamento  (1)
 *
 * Como o move é dentro do MESMO bucket (só renomeia a key), usa
 * `storage.from(bucket).move(old, new)` que faz COPY+DELETE server-side.
 *
 * Uso:
 *   node --env-file=.env.local --import tsx scripts/mover-storage-cluster-teste.ts --dry-run
 *   node --env-file=.env.local --import tsx scripts/mover-storage-cluster-teste.ts
 */

import { createClient } from "@supabase/supabase-js";

const PROD_TENANT = "d2a02c10-9c7e-4157-8dd5-84bbf5a7044c";
const SANDBOX_TENANT = "db9278e5-1293-407f-bd33-d71b7061a849";
const EMPRESA_TESTE_ID = "c8111dca-4063-42b2-80be-14fbb372b50f";

const dryRun = process.argv.includes("--dry-run");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !key) {
  console.error("Faltou NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local");
  process.exit(1);
}

const supa = createClient(url, key, { auth: { persistSession: false } });

type MovePlan = {
  bucket: string;
  oldPath: string;
  newPath: string;
};

async function listarArquivosACopiar(): Promise<MovePlan[]> {
  // Confirma pelo DB quais jobs/PPs são do cluster (já moveram pro sandbox).
  const { data: jobs, error: errJ } = await supa
    .from("jobs")
    .select("id")
    .eq("tenant_id", SANDBOX_TENANT)
    .eq("empresa_id", EMPRESA_TESTE_ID);
  if (errJ) throw errJ;
  const jobIds = new Set((jobs ?? []).map((j) => j.id as string));

  const { data: pps, error: errP } = await supa
    .from("pedidos_compra")
    .select("id, job_id")
    .eq("tenant_id", SANDBOX_TENANT)
    .in("job_id", Array.from(jobIds));
  if (errP) throw errP;
  const ppIds = new Set((pps ?? []).map((p) => p.id as string));

  const clusterIds = new Set<string>([...jobIds, ...ppIds]);

  // Lista todos os objetos do tenant prod nos dois buckets, filtra pelos cluster IDs.
  const planos: MovePlan[] = [];
  for (const bucket of ["pedidos-compra", "envios-faturamento"]) {
    // storage.list() é paginado por folder e não funciona bem pra varredura
    // profunda; mais eficiente: query SQL direta em storage.objects via RPC não
    // está disponível aqui, então usamos list recursivo no path do tenant.
    const objetos = await listarRecursivo(bucket, PROD_TENANT);
    for (const obj of objetos) {
      const segmentos = obj.split("/");
      if (segmentos.length < 2) continue;
      const segundo = segmentos[1]; // job_id ou pp_id
      if (!clusterIds.has(segundo)) continue;
      const newPath = obj.replace(`${PROD_TENANT}/`, `${SANDBOX_TENANT}/`);
      planos.push({ bucket, oldPath: obj, newPath });
    }
  }
  return planos;
}

async function listarRecursivo(bucket: string, prefix: string): Promise<string[]> {
  const result: string[] = [];
  const pilha = [prefix];
  while (pilha.length) {
    const atual = pilha.pop()!;
    const { data, error } = await supa.storage.from(bucket).list(atual, { limit: 1000 });
    if (error) throw new Error(`list ${bucket}/${atual}: ${error.message}`);
    for (const item of data ?? []) {
      const path = `${atual}/${item.name}`;
      if (item.id === null) {
        // é folder
        pilha.push(path);
      } else {
        result.push(path);
      }
    }
  }
  return result;
}

async function main() {
  console.log(`Modo: ${dryRun ? "DRY-RUN" : "EXECUÇÃO REAL"}`);
  console.log("Levantando arquivos a mover…");
  const planos = await listarArquivosACopiar();
  console.log(`Total: ${planos.length} arquivos`);

  // Agrupar por bucket pra log
  const porBucket: Record<string, number> = {};
  for (const p of planos) porBucket[p.bucket] = (porBucket[p.bucket] ?? 0) + 1;
  console.log("Por bucket:", porBucket);

  if (dryRun) {
    console.log("Primeiros 5 planos:");
    planos.slice(0, 5).forEach((p) => console.log(`  [${p.bucket}] ${p.oldPath} -> ${p.newPath}`));
    return;
  }

  let ok = 0;
  let falhas: Array<{ plano: MovePlan; erro: string }> = [];
  for (const [i, plano] of planos.entries()) {
    const { error } = await supa.storage.from(plano.bucket).move(plano.oldPath, plano.newPath);
    if (error) {
      falhas.push({ plano, erro: error.message });
      console.error(`FALHA [${i + 1}/${planos.length}] [${plano.bucket}] ${plano.oldPath}: ${error.message}`);
    } else {
      ok++;
      if ((i + 1) % 20 === 0) console.log(`Progresso: ${i + 1}/${planos.length}`);
    }
  }

  console.log(`\nResumo: ${ok} movidos, ${falhas.length} falhas`);
  if (falhas.length) {
    console.log("\nFalhas:");
    falhas.forEach((f) => console.log(`  [${f.plano.bucket}] ${f.plano.oldPath}: ${f.erro}`));
    process.exit(1);
  }

  console.log(
    "\nOK. Agora aplique a migration 20261109970003_storage_paths_pro_sandbox.sql pra atualizar\n" +
    "as colunas de path nas tabelas (pedidos_compra_anexos, jobs_envio_faturamento_anexos).",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
