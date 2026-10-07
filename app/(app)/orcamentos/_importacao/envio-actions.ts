"use server";

import { requireSession } from "@/lib/auth/session";
import { pode } from "@/lib/permissoes";
import { checarPermissao } from "@/lib/permissoes-server";
import {
  descartarEnvioDaSessao,
  limparEnviosAntigos,
  novoCaminhoDeEnvio,
} from "@/lib/importacao/envio";
import { recusaDoArquivo } from "@/lib/importacao/limites";

/**
 * Reserva o caminho onde o navegador sobe a planilha (decisão 110). O
 * caminho nasce aqui, e não no cliente, para a pasta ser sempre a do
 * tenant da sessão — é ela que a policy de INSERT do bucket libera.
 *
 * Aproveita para apagar os envios do tenant esquecidos há mais de um dia
 * (decisão 129): o arquivo importado não fica guardado.
 */
export async function prepararEnvioPlanilha(input: {
  nome: string;
  tamanho: number;
}): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const session = await requireSession();
  // Só quem importa sobe planilha (07/10/2026). Cada porta da importação
  // pede `orcamentos.criar` (versão nova) ou `orcamentos.editar` (sobrescrever
  // e agregada); vale qualquer das duas. A policy de INSERT do bucket confere
  // o mesmo papel no Storage.
  if (
    !pode(session.activeRole, "orcamentos.criar") &&
    !pode(session.activeRole, "orcamentos.editar")
  ) {
    const gate = await checarPermissao(session, "orcamentos.editar");
    if (!gate.ok) return { ok: false, message: gate.message };
  }
  const nome = String(input?.nome ?? "");
  const tamanho = Number(input?.tamanho ?? 0);
  const recusa = recusaDoArquivo(nome, tamanho);
  if (recusa) return { ok: false, message: recusa };
  await limparEnviosAntigos(session.activeTenant.id);
  return { ok: true, path: novoCaminhoDeEnvio(session.activeTenant.id, nome) };
}

/** Apaga o arquivo de uma importação fechada sem gravar, ou de um
 *  rascunho abandonado no editor do projeto. Com a sessão de quem pediu:
 *  só o próprio arquivo sai (07/10/2026). */
export async function descartarEnvioPlanilha(path: string): Promise<void> {
  const session = await requireSession();
  await descartarEnvioDaSessao(String(path ?? ""), session.activeTenant.id);
}
