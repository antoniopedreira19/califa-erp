"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";

/**
 * Grava/limpa o cookie `active_empresa_ids`. Recebe:
 *   - [] → apaga o cookie (equivale a "todas selecionadas")
 *   - [id1, id2, ...] → grava CSV; todos os ids precisam ser de empresas
 *     do tenant do usuário.
 *
 * Depois de gravar, revalida `/` para forçar rerun de server components.
 */
export async function setActiveEmpresas(ids: string[]): Promise<void> {
  const session = await requireSession();

  if (ids.length > 0) {
    const validos = new Set(session.empresas.map((e) => e.id));
    for (const id of ids) {
      if (!validos.has(id)) {
        throw new Error(`Empresa ${id} fora do escopo do tenant.`);
      }
    }
  }

  const store = cookies();
  if (ids.length === 0) {
    store.delete("active_empresa_ids");
  } else {
    store.set("active_empresa_ids", ids.join(","), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  revalidatePath("/");
}
