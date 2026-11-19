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
 *
 * Blindado: se qualquer coisa falhar na leitura do payload ou no
 * render do modal, retorna null e loga. O /perfil continua carregando
 * normalmente — sem o wizard, mas sem derrubar o layout inteiro no
 * global-error. Caso de 19/11/2026 (Jessica recém-convidada viu "Algo
 * quebrou ao carregar o sistema" no primeiro acesso). Fallback silencioso
 * é melhor do que tela branca pra quem acabou de ser convidado.
 */
export async function InjetarBoasVindas() {
  try {
    const payload = await lerMeuPerfilCompleto();
    if (!payload) return null;

    const { colaborador } = payload;
    if (colaborador.tipo_contratacao === "socio") return null;
    if (colaborador.perfil_completado_em) return null;

    return <ModalBoasVindas payload={payload} />;
  } catch (e) {
    console.error(
      "[boas-vindas.injetar] falha ao preparar modal — layout segue sem ele:",
      e instanceof Error ? e.message : e,
      e instanceof Error && e.stack ? `\n${e.stack}` : "",
    );
    return null;
  }
}
