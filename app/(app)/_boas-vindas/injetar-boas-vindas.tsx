import { lerMeuPerfilCompleto } from "./actions";
import { ModalBoasVindas } from "./modal-boas-vindas";

/**
 * Server component — lê o colaborador vinculado ao user logado e,
 * quando couber, injeta o modal de boas-vindas. Chamado no layout.
 *
 * Condições pra o modal aparecer:
 *   - Usuário tem vínculo em colaboradores (user_id = auth.uid()).
 *   - Status ativo.
 *   - tipo_contratacao != 'socio'.
 *   - perfil_completado_em IS NULL.
 *
 * O cliente ainda filtra uma camada extra (sessionStorage) pra não
 * reaparecer dentro da mesma sessão depois de fechado.
 */
export async function InjetarBoasVindas() {
  const payload = await lerMeuPerfilCompleto();
  if (!payload) return null;

  const { colaborador } = payload;
  if (colaborador.tipo_contratacao === "socio") return null;
  if (colaborador.perfil_completado_em) return null;

  return <ModalBoasVindas payload={payload} />;
}
