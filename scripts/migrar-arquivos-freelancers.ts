/**
 * Migra arquivos (PDFs de contrato + minutas DOCX + cartões CNPJ) do bucket
 * do sistema RH antigo (AgCaliforniaRH) pro bucket do califa-erp, seguindo o
 * schema de paths que o RLS do bucket novo exige.
 *
 * Pré-requisito: Task 028 (import de metadados via MCP) já rodou.
 * Os freelancers e contratos têm `legado_id` apontando pro ID antigo —
 * é por aí que o script casa origem com destino.
 *
 * Uso (--env-file nativo do Node 20+):
 *   # Primeiro: dry-run (não baixa nem faz upload, só mostra o que faria)
 *   node --env-file=.env.local --import tsx scripts/migrar-arquivos-freelancers.ts --dry-run
 *
 *   # Rodar de verdade:
 *   node --env-file=.env.local --import tsx scripts/migrar-arquivos-freelancers.ts
 *
 *   # Só uma fase:
 *   node --env-file=.env.local --import tsx scripts/migrar-arquivos-freelancers.ts --so=contratos
 *   node --env-file=.env.local --import tsx scripts/migrar-arquivos-freelancers.ts --so=cartoes
 *
 * Env vars obrigatórias (todas service role, nunca commitar):
 *   AG_RH_SUPABASE_URL                — URL do projeto antigo (xhonefoafiipfislsaql)
 *   AG_RH_SUPABASE_SERVICE_ROLE_KEY   — service role do projeto antigo
 *   NEXT_PUBLIC_SUPABASE_URL          — URL do califa-erp (já no .env.local)
 *   SUPABASE_SERVICE_ROLE_KEY         — service role do califa-erp (já no .env.local)
 *
 * Buckets envolvidos:
 *   Origem (RH antigo):
 *     - `contratos`: minuta DOCX + assinado PDF + distratos
 *     - `documentos`: cartões CNPJ (PDF, PNG, JPG, GIF, JPEG)
 *   Destino (califa-erp):
 *     - `freelancer-arquivos` (privado), paths:
 *         {tenant_id}/contratos/{contrato_id}/{tipo}.{ext}
 *         {tenant_id}/freelancers/{freelancer_id}/cartao-cnpj.{ext}
 *     onde tipo ∈ {minuta, assinado, distrato-minuta, distrato-assinado}
 *
 * Comportamento:
 *   - Idempotente: antes de upload, confere se já existe no destino. Se existe,
 *     pula download+upload (mas confirma que o UPDATE da linha tá feito).
 *   - Em erro de um arquivo, loga e continua. Resumo final mostra sucessos/falhas.
 *   - Não deleta nada no bucket antigo (deixa pra limpeza manual depois do OK).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const TENANT_ID = "d2a02c10-9c7e-4157-8dd5-84bbf5a7044c";

type Argv = { dryRun: boolean; so: "tudo" | "contratos" | "cartoes" };

function parseArgs(): Argv {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const soFlag = argv.find((a) => a.startsWith("--so="));
  const so = (soFlag?.split("=")[1] ?? "tudo") as Argv["so"];
  if (!["tudo", "contratos", "cartoes"].includes(so)) {
    console.error(`❌ --so inválido: ${so}. Use tudo | contratos | cartoes.`);
    process.exit(1);
  }
  return { dryRun, so };
}

function env(nome: string): string {
  const v = process.env[nome];
  if (!v) {
    console.error(`❌ Env var faltando: ${nome}`);
    process.exit(1);
  }
  return v;
}

function extDe(path: string): string {
  const idx = path.lastIndexOf(".");
  if (idx < 0) return "bin";
  return path.slice(idx + 1).toLowerCase();
}

function contentType(ext: string): string {
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif")
    return `image/${ext === "jpg" ? "jpeg" : ext}`;
  return "application/octet-stream";
}

interface Resultado {
  tentados: number;
  pulados_ja_existe: number;
  copiados: number;
  erros: Array<{ contexto: string; erro: string }>;
}

function somaResultado(r: Resultado): void {
  r.tentados += 1;
}

/** Copia um arquivo do bucket antigo pro novo e atualiza a coluna URL no destino. */
async function copiarArquivo(opts: {
  antigo: SupabaseClient;
  novo: SupabaseClient;
  dryRun: boolean;
  bucketOrigem: string;
  pathOrigem: string;
  bucketDestino: string;
  pathDestino: string;
  tabelaDestino: string;
  colunaUrl: string;
  idLinhaDestino: string;
  resultado: Resultado;
  contexto: string;
}): Promise<void> {
  const {
    antigo,
    novo,
    dryRun,
    bucketOrigem,
    pathOrigem,
    bucketDestino,
    pathDestino,
    tabelaDestino,
    colunaUrl,
    idLinhaDestino,
    resultado,
    contexto,
  } = opts;

  somaResultado(resultado);

  if (dryRun) {
    console.log(`[dry] ${bucketOrigem}:${pathOrigem} → ${bucketDestino}:${pathDestino}`);
    return;
  }

  // 1. Já existe no destino?
  const dirDestino = pathDestino.slice(0, pathDestino.lastIndexOf("/"));
  const nomeArquivoDestino = pathDestino.slice(pathDestino.lastIndexOf("/") + 1);
  const { data: existentes } = await novo.storage.from(bucketDestino).list(dirDestino, {
    limit: 100,
    search: nomeArquivoDestino,
  });
  const jaTem = existentes?.some((o) => o.name === nomeArquivoDestino) ?? false;

  if (!jaTem) {
    // 2. Baixa do antigo
    const { data: blob, error: downloadErr } = await antigo.storage
      .from(bucketOrigem)
      .download(pathOrigem);
    if (downloadErr || !blob) {
      resultado.erros.push({ contexto, erro: `download: ${downloadErr?.message ?? "sem blob"}` });
      return;
    }

    // 3. Upload no novo
    const ext = extDe(pathDestino);
    const { error: uploadErr } = await novo.storage
      .from(bucketDestino)
      .upload(pathDestino, blob, { contentType: contentType(ext), upsert: false });
    if (uploadErr) {
      resultado.erros.push({ contexto, erro: `upload: ${uploadErr.message}` });
      return;
    }
    resultado.copiados += 1;
  } else {
    resultado.pulados_ja_existe += 1;
  }

  // 4. UPDATE da linha no destino com o path novo
  const { error: updateErr } = await novo
    .from(tabelaDestino)
    .update({ [colunaUrl]: pathDestino })
    .eq("id", idLinhaDestino);
  if (updateErr) {
    resultado.erros.push({ contexto, erro: `update ${tabelaDestino}.${colunaUrl}: ${updateErr.message}` });
  }
}

async function migrarContratos(opts: {
  antigo: SupabaseClient;
  novo: SupabaseClient;
  dryRun: boolean;
}): Promise<Resultado> {
  const { antigo, novo, dryRun } = opts;
  const resultado: Resultado = { tentados: 0, pulados_ja_existe: 0, copiados: 0, erros: [] };

  console.log("\n=== CONTRATOS ===");

  // 1. Lista todos os contratos migrados no destino, com seu legado_id
  const { data: contratos, error } = await novo
    .from("freelancer_contratos")
    .select("id, legado_id, tenant_id")
    .eq("tenant_id", TENANT_ID)
    .not("legado_id", "is", null);

  if (error) {
    console.error("❌ Falhou ao listar contratos:", error.message);
    return resultado;
  }
  console.log(`Encontrados ${contratos?.length ?? 0} contratos migrados.`);

  for (const c of contratos ?? []) {
    // 2. Pega as URLs antigas
    const { data: antigo_c, error: errAntigo } = await antigo
      .from("contratos")
      .select("arquivo_url, minuta_url, distrato_arquivo_url, distrato_minuta_url")
      .eq("id", c.legado_id)
      .maybeSingle();
    if (errAntigo) {
      resultado.erros.push({ contexto: `contrato ${c.id}`, erro: `select origem: ${errAntigo.message}` });
      continue;
    }
    if (!antigo_c) continue;

    const mapeamento: Array<{ pathAntigo: string | null; tipo: string; coluna: string }> = [
      { pathAntigo: antigo_c.arquivo_url, tipo: "assinado", coluna: "arquivo_url" },
      { pathAntigo: antigo_c.minuta_url, tipo: "minuta", coluna: "minuta_url" },
      { pathAntigo: antigo_c.distrato_arquivo_url, tipo: "distrato-assinado", coluna: "distrato_arquivo_url" },
      { pathAntigo: antigo_c.distrato_minuta_url, tipo: "distrato-minuta", coluna: "distrato_minuta_url" },
    ];

    for (const m of mapeamento) {
      if (!m.pathAntigo) continue;
      const ext = extDe(m.pathAntigo);
      const pathDestino = `${TENANT_ID}/contratos/${c.id}/${m.tipo}.${ext}`;
      await copiarArquivo({
        antigo,
        novo,
        dryRun,
        bucketOrigem: "contratos",
        pathOrigem: m.pathAntigo,
        bucketDestino: "freelancer-arquivos",
        pathDestino,
        tabelaDestino: "freelancer_contratos",
        colunaUrl: m.coluna,
        idLinhaDestino: c.id,
        resultado,
        contexto: `contrato ${c.id} / ${m.tipo}`,
      });
    }
  }

  return resultado;
}

async function migrarCartoes(opts: {
  antigo: SupabaseClient;
  novo: SupabaseClient;
  dryRun: boolean;
}): Promise<Resultado> {
  const { antigo, novo, dryRun } = opts;
  const resultado: Resultado = { tentados: 0, pulados_ja_existe: 0, copiados: 0, erros: [] };

  console.log("\n=== CARTÕES CNPJ ===");

  const { data: freelas, error } = await novo
    .from("freelancers")
    .select("id, legado_id, tenant_id")
    .eq("tenant_id", TENANT_ID)
    .not("legado_id", "is", null);

  if (error) {
    console.error("❌ Falhou ao listar freelancers:", error.message);
    return resultado;
  }
  console.log(`Encontrados ${freelas?.length ?? 0} freelancers migrados.`);

  for (const f of freelas ?? []) {
    const { data: antigo_f, error: errAntigo } = await antigo
      .from("freelancers")
      .select("cartao_cnpj_url")
      .eq("id", f.legado_id)
      .maybeSingle();
    if (errAntigo) {
      resultado.erros.push({ contexto: `freelancer ${f.id}`, erro: `select origem: ${errAntigo.message}` });
      continue;
    }
    if (!antigo_f?.cartao_cnpj_url) continue;

    const ext = extDe(antigo_f.cartao_cnpj_url);
    const pathDestino = `${TENANT_ID}/freelancers/${f.id}/cartao-cnpj.${ext}`;

    await copiarArquivo({
      antigo,
      novo,
      dryRun,
      bucketOrigem: "documentos",
      pathOrigem: antigo_f.cartao_cnpj_url,
      bucketDestino: "freelancer-arquivos",
      pathDestino,
      tabelaDestino: "freelancers",
      colunaUrl: "cartao_cnpj_url",
      idLinhaDestino: f.id,
      resultado,
      contexto: `freelancer ${f.id} / cartao-cnpj`,
    });
  }

  return resultado;
}

function imprimirResultado(nome: string, r: Resultado): void {
  console.log(`\n--- ${nome} ---`);
  console.log(`Tentativas: ${r.tentados}`);
  console.log(`Copiados: ${r.copiados}`);
  console.log(`Pulados (já existia): ${r.pulados_ja_existe}`);
  console.log(`Erros: ${r.erros.length}`);
  for (const e of r.erros.slice(0, 10)) {
    console.log(`  × [${e.contexto}] ${e.erro}`);
  }
  if (r.erros.length > 10) {
    console.log(`  ... (${r.erros.length - 10} erros a mais omitidos)`);
  }
}

async function main() {
  const { dryRun, so } = parseArgs();

  const antigo = createClient(
    env("AG_RH_SUPABASE_URL"),
    env("AG_RH_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const novo = createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  console.log(`Modo: ${dryRun ? "DRY-RUN (não escreve nada)" : "EXECUÇÃO REAL"}`);
  console.log(`Fase(s): ${so}`);

  let rContratos: Resultado | null = null;
  let rCartoes: Resultado | null = null;

  if (so === "tudo" || so === "contratos") {
    rContratos = await migrarContratos({ antigo, novo, dryRun });
  }
  if (so === "tudo" || so === "cartoes") {
    rCartoes = await migrarCartoes({ antigo, novo, dryRun });
  }

  console.log("\n=== RESUMO ===");
  if (rContratos) imprimirResultado("Contratos", rContratos);
  if (rCartoes) imprimirResultado("Cartões CNPJ", rCartoes);

  const totalErros = (rContratos?.erros.length ?? 0) + (rCartoes?.erros.length ?? 0);
  process.exit(totalErros > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("💥 Erro fatal:", e);
  process.exit(1);
});
