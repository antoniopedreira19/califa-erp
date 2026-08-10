-- =====================================================================
-- Chat de PPs no job: adiciona escopo pra separar a thread de PPs da
-- thread geral (Comunicação). Reusa jobs_mensagens e jobs_chat_leituras
-- em vez de tabelas paralelas — infra idêntica (RLS, realtime, policies).
--
-- Ver spec: docs/superpowers/specs/2026-08-10-chat-pps-no-job-design.md
-- =====================================================================

do $$ begin
  create type chat_escopo as enum ('geral', 'pps');
exception when duplicate_object then null;
end $$;

-- jobs_mensagens: cada mensagem pertence a um escopo. Default 'geral'
-- mantém o chat de Comunicação existente funcionando sem backfill.
alter table public.jobs_mensagens
  add column if not exists escopo chat_escopo not null default 'geral';

-- Índice composto: as duas queries de leitura são "todas as mensagens
-- desse job nesse escopo, em ordem". Pega os dois filtros e a ordenação.
create index if not exists idx_jobs_msg_job_escopo
  on public.jobs_mensagens(job_id, escopo, created_at);

-- jobs_chat_leituras: cada pessoa tem uma leitura por escopo por job.
-- PK muda pra (job_id, profile_id, escopo). Registros existentes viram
-- 'geral' pelo default, o que preserva a semântica atual do chat de
-- Comunicação (que ficou como 'geral').
alter table public.jobs_chat_leituras
  add column if not exists escopo chat_escopo not null default 'geral';

do $$ begin
  alter table public.jobs_chat_leituras
    drop constraint jobs_chat_leituras_pkey;
exception when undefined_object then null;
end $$;

do $$ begin
  alter table public.jobs_chat_leituras
    add constraint jobs_chat_leituras_pkey
    primary key (job_id, profile_id, escopo);
exception when duplicate_table then null;
end $$;
