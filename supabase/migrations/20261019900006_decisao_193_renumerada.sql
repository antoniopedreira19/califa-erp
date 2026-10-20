-- A decisão da conta ou do PIX do titular da verba virou 193.
--
-- A migration 20261019900005 foi aplicada como "decisão 191". Antes do push,
-- outra sessão publicou a 191 (o item da planilha no PDF da PP) e reservou a
-- 192; quem ainda não tinha publicado mudou de número. Esta migration só troca
-- os comentários das duas funções que citam o número. O corpo do gatilho
-- `pp_foto_do_colaborador` segue dizendo 191, como foi aplicado (reescrever a
-- função só pelo comentário faria o repositório divergir da definição viva).

comment on function public.pix_do_cadastro_do_freelancer(uuid) is
  'Decisão 193: o PIX do cadastro de freelas que vai automático para a PP de verba (tipo deduzido com segurança: e-mail, aleatória, CNPJ ou o CPF da própria pessoa), já no formato do banco, e o CPF do freela. Nenhuma linha = o freela digita o pagamento na PP. Só para o gatilho e para pessoas_para_verba.';

comment on function public.pessoas_para_verba(uuid) is
  'Decisões 164, 171 e 193: quem pode ser titular da verba (colaboradores ativos do RH e freelas não encerrados), só nome, função, o segundo dado da linha e se paga pelo cadastro (sim ou não, nunca o dado). Só para quem gera PP.';
