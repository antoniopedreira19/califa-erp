-- =====================================================================
-- Observações do job
--
-- Origem: revisão do handoff "Abertura de Job.dc.html" (31/07/2026). O
-- modal de abertura ganha um campo livre de contexto para quem vai
-- abrir o job no financeiro — condições comerciais, dependências, o que
-- foi combinado com o cliente.
--
-- Nullable e opcional: é contexto, não regra. O limite de 500 vem do
-- contador do handoff e vive também no Zod (`OBSERVACOES_MAX`); o CHECK
-- aqui é a rede de segurança do banco.
-- =====================================================================

alter table public.jobs
  add column if not exists observacoes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_observacoes_tamanho'
  ) then
    alter table public.jobs
      add constraint jobs_observacoes_tamanho
      check (observacoes is null or length(observacoes) <= 500);
  end if;
end$$;

comment on column public.jobs.observacoes is
  'Contexto livre para quem abre o job no financeiro. Informado na abertura.';
