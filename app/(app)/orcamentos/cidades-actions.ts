"use server";

import { requireSession } from "@/lib/auth/session";
import { listarCidades } from "@/lib/data/cidades";

/**
 * Busca de cidades do combobox, feita no servidor.
 *
 * O cadastro comporta a lista completa do Brasil, então a busca NÃO pode
 * ser feita no cliente: a cada pausa na digitação consultamos o banco e
 * trazemos só os primeiros resultados (`LIMITE_CIDADES`). Sem termo,
 * devolve as primeiras em ordem alfabética.
 */
export async function buscarCidades(
  termo: string,
): Promise<{ id: string; nome: string }[]> {
  const session = await requireSession();
  return listarCidades(session.activeTenant.id, termo);
}
