/**
 * Carrega os campos de `auth.users` relevantes pro card "Acesso ao sistema"
 * do RH (invited_at, last_sign_in_at, email_confirmed_at). RLS não permite
 * SELECT direto nessa tabela, então usamos service client.
 *
 * **Chamar apenas de server component ou server action após validar role
 * admin/rh.** Não há guard interno.
 */

import { createServiceClient } from "@/lib/supabase/server";

export type AcessoColaborador = {
  user_id: string;
  auth_email: string | null;
  invited_at: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
};

export async function carregarAcessoColaborador(
  userId: string,
): Promise<AcessoColaborador | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[acesso-colaborador] SUPABASE_SERVICE_ROLE_KEY ausente no ambiente.",
    );
    return null;
  }

  const service = createServiceClient();
  const { data, error } = await service.auth.admin.getUserById(userId);

  if (error || !data?.user) {
    if (error) {
      console.error("[acesso-colaborador.getUserById]", error.message);
    }
    return null;
  }

  const u = data.user;
  return {
    user_id: u.id,
    auth_email: u.email ?? null,
    invited_at: u.invited_at ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null,
    email_confirmed_at: u.email_confirmed_at ?? null,
  };
}
