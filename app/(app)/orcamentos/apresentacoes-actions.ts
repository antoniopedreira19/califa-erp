"use server";

// As apresentações do projeto (decisão 213). O arquivo sobe do navegador
// direto para o bucket privado `projetos-apresentacoes` (até 50 MB), no
// padrão da declaração do Simples (decisão 142): o caminho nasce aqui, com
// o tenant da sessão, e o arquivo não passa pelo corpo da Server Action (o
// Next corta em 1 MB). Quem grava a linha é `criarProjeto`/
// `atualizarProjeto`, que conferem de novo o caminho.

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { checarPermissao } from "@/lib/permissoes-server";
import {
  BUCKET_DAS_APRESENTACOES,
  apresentacaoDoTenant,
  caminhoDaApresentacao,
  recusaDaApresentacao,
} from "@/lib/apresentacoes-do-projeto";
import { removerApresentacoesSoltas } from "@/lib/data/apresentacoes-do-projeto";

/** Reserva o caminho `<tenant>/<uuid>-<nome>` para o navegador subir o
 *  arquivo. O gate é o do formulário do projeto. */
export async function reservarApresentacao(input: {
  nome: string;
  tamanho: number;
}): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const nome = String(input?.nome ?? "");
  const recusa = recusaDaApresentacao(nome, Number(input?.tamanho ?? 0));
  if (recusa) return { ok: false, message: recusa };
  return {
    ok: true,
    path: caminhoDaApresentacao(session.activeTenant.id, crypto.randomUUID(), nome),
  };
}

/** URL assinada (10 minutos) para abrir a apresentação numa aba nova.
 *  Quem é do tenant abre: a ficha do job mostra o card PROJETO a todos. */
export async function urlDaApresentacao(
  path: string,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const session = await requireSession();
  if (typeof path !== "string" || !apresentacaoDoTenant(path, session.activeTenant.id)) {
    return { ok: false, message: "Arquivo não encontrado." };
  }
  const { data, error } = await createClient()
    .storage.from(BUCKET_DAS_APRESENTACOES)
    .createSignedUrl(path, 60 * 10);
  if (error || !data) {
    console.error("[projetos.apresentacoes.url]", error?.message);
    return { ok: false, message: "Não foi possível abrir o arquivo." };
  }
  return { ok: true, url: data.signedUrl };
}

/** O formulário fechou sem salvar, ou tirou da lista um arquivo que subiu
 *  e ainda não foi gravado: ele sai do bucket. */
export async function descartarApresentacoes(paths: string[]): Promise<void> {
  const session = await requireSession();
  await removerApresentacoesSoltas(
    createClient(),
    session.activeTenant.id,
    Array.isArray(paths) ? paths : [],
  );
}
