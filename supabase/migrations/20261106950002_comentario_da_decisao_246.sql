-- O comentário da função nova aponta para a decisão certa (246).
-- A 20261106950001 foi aplicada quando a decisão ainda era a 245, número que
-- outra frente publicou no main antes deste push (o prazo de envio das PPs de
-- 20/11). Só o `comment on` muda; nenhuma linha, nenhum código.
comment on function public.cancelar_envio_prestacao_verba(uuid) is
  'Decisão 246: a produção cancela o envio da prestação em avaliação. Volta a rascunho (primeiro envio) ou a reprovada (reenvio), com os mesmos documentos; sem documento, o rascunho some. Devolve rascunho, reprovada ou sem_prestacao.';
