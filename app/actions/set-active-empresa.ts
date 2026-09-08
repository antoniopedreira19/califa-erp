"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";

/**
 * Grava/limpa o cookie `active_empresa_id`. Recebe:
 *   - null → apaga o cookie (equivale a "Todas as empresas")
 *   - uuid → grava o id (precisa ser de uma empresa do tenant do usuário)
 *
 * Depois de gravar, revalida `/` para forçar rerun de server components.
 */
export async function setActiveEmpresa(empresaId: string | null): Promise<void> {
  const session = await requireSession();

  if (empresaId !== null) {
    const pertence = session.empresas.some((e) => e.id === empresaId);
    if (!pertence) {
      throw new Error("Empresa fora do escopo do tenant.");
    }
  }

  const store = cookies();
  if (empresaId === null) {
    store.delete("active_empresa_id");
  } else {
    store.set("active_empresa_id", empresaId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  revalidatePath("/");
}
