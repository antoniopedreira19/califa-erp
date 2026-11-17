-- Motivo: suporte a "adiantamento integral do 13º" — quando marcado, o
-- colaborador não gera linha na folha de 13º do ano. Aditiva. Default
-- false mantém o comportamento atual pra todos os registros existentes.
--
-- Nada de índice: a coluna é booleana, a seletividade pra integral=true
-- dentro do subset (colaborador_id, ano) é baixa e o índice composto em
-- (colaborador_id, ano) já cobre as queries de filtro.

alter table public.decimo_terceiro_adiantamentos
  add column integral boolean not null default false;

comment on column public.decimo_terceiro_adiantamentos.integral is
  'Quando true, este adiantamento quita o 13º inteiro: o colaborador não gera linha em decimo_terceiro_linhas do mesmo ano.';
