// Operação única de 29/09/2026 (decisão 124): apagar os rastros do código
// anterior (decisão 114) — PDFs das PPs refeitos com o código novo, PDFs
// soltos e planilhas importadas apagados. Este arquivo tem o que os passos
// dividem: leitura do .env.local, cliente de serviço e a pasta da cópia.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const TENANT_ID = "d2a02c10-9c7e-4157-8dd5-84bbf5a7044c";
export const BUCKET_PPS = "pedidos-compra";
export const BUCKET_IMPORTACOES = "orcamento-importacoes";

/** Cópia de segurança, fora do repositório (autorizada pelo Tiago em 29/09). */
export const PASTA_BACKUP =
  "/Users/tiagomendonca/Documents/California/backups/codigos-antigos-2026-09-29";

export function lerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const linha of readFileSync(".env.local", "utf8").split("\n")) {
    const i = linha.indexOf("=");
    if (i > 0 && !linha.trim().startsWith("#")) {
      env[linha.slice(0, i).trim()] = linha
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

export function clienteDeServico(): SupabaseClient {
  const env = lerEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export function md5(buf: Buffer): string {
  return createHash("md5").update(buf).digest("hex");
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface ArquivoListado {
  bucket: string;
  path: string;
  tamanho: number;
  etag: string | null;
  atualizado: string | null;
}

/** Lista recursiva de um bucket (a API lista uma pasta por vez). */
export async function listarBucket(
  s: SupabaseClient,
  bucket: string,
  prefixo = "",
): Promise<ArquivoListado[]> {
  const saida: ArquivoListado[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await s.storage
      .from(bucket)
      .list(prefixo, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`listar ${bucket}/${prefixo}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const item of data) {
      const caminho = prefixo ? `${prefixo}/${item.name}` : item.name;
      if (item.id === null) {
        // Pasta: desce.
        saida.push(...(await listarBucket(s, bucket, caminho)));
      } else {
        const meta = (item.metadata ?? {}) as { size?: number; eTag?: string };
        saida.push({
          bucket,
          path: caminho,
          tamanho: Number(meta.size ?? 0),
          etag: meta.eTag ? meta.eTag.replace(/"/g, "") : null,
          atualizado: item.updated_at ?? item.created_at ?? null,
        });
      }
    }
    if (data.length < 1000) break;
    offset += data.length;
  }
  return saida;
}
