import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUCKET_DAS_APRESENTACOES,
  apresentacaoDoTenant,
  recusaDaApresentacao,
  type ApresentacaoDoProjeto,
} from "@/lib/apresentacoes-do-projeto";

/**
 * As apresentações de um projeto, da mais antiga à mais nova (decisão 213).
 * Devolve a PROMISE da consulta embrulhada, para quem chama pôr no
 * `Promise.all` que já tem (docs/PERFORMANCE.md).
 */
export async function listarApresentacoesDoProjeto(
  supabase: SupabaseClient<any, any, any>,
  tenantId: string,
  projetoId: string,
): Promise<ApresentacaoDoProjeto[]> {
  const { data, error } = await supabase
    .from("projeto_apresentacoes")
    .select("storage_path, nome_arquivo, tamanho_bytes, tipo")
    .eq("tenant_id", tenantId)
    .eq("projeto_id", projetoId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[projetos.apresentacoes.listar]", error.message);
    return [];
  }
  return (data ?? []).map((a: any) => ({
    path: a.storage_path,
    nome: a.nome_arquivo,
    tamanho: Number(a.tamanho_bytes),
    tipo: a.tipo ?? null,
  }));
}

/**
 * Regrava as apresentações do projeto com a lista do formulário: sai a
 * linha que não veio (e o arquivo dela, do bucket), entra a que é nova.
 * Caminho de outro tenant é ignorado. `null` = o formulário não mandou o
 * campo, nada muda.
 */
export async function sincronizarApresentacoes(
  supabase: SupabaseClient<any, any, any>,
  tenantId: string,
  projetoId: string,
  profileId: string,
  lista: ApresentacaoDoProjeto[] | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (lista === null) return { ok: true };
  const validas = lista.filter(
    (a) =>
      apresentacaoDoTenant(a.path, tenantId) &&
      recusaDaApresentacao(a.nome, a.tamanho) === null,
  );

  const { data: atuais, error: errLer } = await supabase
    .from("projeto_apresentacoes")
    .select("id, storage_path")
    .eq("tenant_id", tenantId)
    .eq("projeto_id", projetoId);
  if (errLer) {
    console.error("[projetos.apresentacoes.ler]", errLer.message);
    return { ok: false, message: "Não foi possível gravar as apresentações." };
  }

  const ficam = new Set(validas.map((a) => a.path));
  const existentes = new Set((atuais ?? []).map((a: any) => a.storage_path as string));
  const saem = (atuais ?? []).filter((a: any) => !ficam.has(a.storage_path));
  const entram = validas.filter((a) => !existentes.has(a.path));

  if (saem.length > 0) {
    const { error } = await supabase
      .from("projeto_apresentacoes")
      .delete()
      .in("id", saem.map((a: any) => a.id));
    if (error) {
      console.error("[projetos.apresentacoes.delete]", error.message);
      return { ok: false, message: "Não foi possível gravar as apresentações." };
    }
    // O arquivo sai junto: nenhum outro projeto aponta para ele.
    await supabase.storage
      .from(BUCKET_DAS_APRESENTACOES)
      .remove(saem.map((a: any) => a.storage_path));
  }

  if (entram.length > 0) {
    const { error } = await supabase.from("projeto_apresentacoes").insert(
      entram.map((a) => ({
        tenant_id: tenantId,
        projeto_id: projetoId,
        nome_arquivo: a.nome,
        storage_path: a.path,
        tamanho_bytes: a.tamanho,
        tipo: a.tipo,
        created_by: profileId,
      })),
    );
    if (error) {
      console.error("[projetos.apresentacoes.insert]", error.message);
      return { ok: false, message: "Não foi possível gravar as apresentações." };
    }
  }
  return { ok: true };
}

/** Tira do bucket os arquivos que subiram e não foram gravados (o
 *  formulário fechou sem salvar, ou o arquivo saiu da lista antes). Só sai
 *  o que nenhuma linha aponta. */
export async function removerApresentacoesSoltas(
  supabase: SupabaseClient<any, any, any>,
  tenantId: string,
  paths: string[],
): Promise<void> {
  const doTenant = paths.filter((p) => typeof p === "string" && apresentacaoDoTenant(p, tenantId));
  if (doTenant.length === 0) return;
  const { data } = await supabase
    .from("projeto_apresentacoes")
    .select("storage_path")
    .eq("tenant_id", tenantId)
    .in("storage_path", doTenant);
  const gravados = new Set((data ?? []).map((a: any) => a.storage_path as string));
  const soltos = doTenant.filter((p) => !gravados.has(p));
  if (soltos.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET_DAS_APRESENTACOES).remove(soltos);
  if (error) console.error("[projetos.apresentacoes.descartar]", error.message);
}
