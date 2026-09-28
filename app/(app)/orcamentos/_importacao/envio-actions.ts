"use server";

import { requireSession } from "@/lib/auth/session";
import { descartarEnvio, novoCaminhoDeEnvio } from "@/lib/importacao/envio";
import { recusaDoArquivo } from "@/lib/importacao/limites";

/**
 * Reserva o caminho onde o navegador sobe a planilha (decisão 110). O
 * caminho nasce aqui, e não no cliente, para a pasta ser sempre a do
 * tenant da sessão — é ela que a policy de INSERT do bucket libera.
 */
export async function prepararEnvioPlanilha(input: {
  nome: string;
  tamanho: number;
}): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const session = await requireSession();
  const nome = String(input?.nome ?? "");
  const tamanho = Number(input?.tamanho ?? 0);
  const recusa = recusaDoArquivo(nome, tamanho);
  if (recusa) return { ok: false, message: recusa };
  return { ok: true, path: novoCaminhoDeEnvio(session.activeTenant.id, nome) };
}

/** Apaga o arquivo de uma importação fechada sem gravar. */
export async function descartarEnvioPlanilha(path: string): Promise<void> {
  const session = await requireSession();
  await descartarEnvio(String(path ?? ""), session.activeTenant.id);
}
