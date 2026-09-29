-- Decisão 126 (Tiago, 29/09/2026): as colunas `codigo_anterior` saem do
-- banco. Elas guardavam o código de antes da decisão 114 e foram esvaziadas
-- pela 20260929700001; o código do app parou de lê-las em `f6a93b7d`, que já
-- está em produção. O Tiago autorizou a remoção.
--
-- Trava: se alguma das quatro colunas ainda tiver valor, nada é removido.
-- O índice `idx_jobs_codigo_anterior` sai junto com a coluna de `jobs`
-- (era o único objeto que dependia delas).
--
-- Os valores de antes estão na cópia de segurança da operação
-- (`banco.json`), fora do repositório.

do $$
begin
  if exists (select 1 from public.jobs where codigo_anterior is not null)
     or exists (select 1 from public.projetos where codigo_anterior is not null)
     or exists (select 1 from public.orcamentos where codigo_anterior is not null)
     or exists (select 1 from public.projetos_financeiro where codigo_anterior is not null)
  then
    raise exception 'codigo_anterior ainda tem valor — nada removido';
  end if;
end;
$$;

alter table public.jobs drop column codigo_anterior;
alter table public.projetos drop column codigo_anterior;
alter table public.orcamentos drop column codigo_anterior;
alter table public.projetos_financeiro drop column codigo_anterior;
