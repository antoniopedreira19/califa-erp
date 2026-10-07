-- A decisão da errata que cancela a linha nasceu como 150 e foi renumerada
-- para 151 antes de publicar (07/10/2026): a frente da Mídia Off já tinha o
-- 150 (Cadastro de Veículos) no worktree dela, criado antes. Regra do
-- Tiago para colisão de número: a mais nova move.
--
-- As migrations 20261007100001 e 20261007100002 já tinham sido aplicadas
-- citando "Decisão 150" e ficam como estão — migration aplicada não se
-- reescreve. Esta corrige só o que o banco mostra: os comentários das
-- colunas. Os comentários DENTRO de `registrar_errata_do_job` continuam
-- dizendo 150; o arquivo da decisão registra isso.

comment on column public.jobs_itens_orcado.cancelada_em is
  'Decisão 151: linha cancelada por errata. Fica na planilha com o orçado zerado; o planejado da abertura continua contando. Não recebe PP nem BV.';
comment on column public.jobs_itens_orcado.cancelada_por is
  'Decisão 151: quem registrou a errata que cancelou a linha (auth.uid()).';
comment on column public.jobs_itens_orcado.cancelada_errata_id is
  'Decisão 151: a errata que cancelou a linha.';
