-- =====================================================================
-- Comunicação do job: thread entre Produção e Financeiro.
-- Ver design "Chat Job.dc.html".
--
-- Só as mensagens humanas moram aqui. Os cards automáticos ("Job aberto",
-- "Errata registrada") são montados na leitura a partir de `jobs` e
-- `jobs_erratas` — não duplicam dado, não precisam de backfill e nunca
-- divergem da fonte.
-- =====================================================================

do $$ begin
  create type chat_area as enum ('producao', 'financeiro');
exception when duplicate_object then null;
end $$;

create table if not exists public.jobs_mensagens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  job_id uuid not null references public.jobs(id) on delete cascade,
  autor_id uuid not null references public.profiles(id),
  -- Derivada do papel de quem envia, não escolhida no formulário: o
  -- rótulo só vale alguma coisa se ninguém puder falar pelo outro time.
  area chat_area not null,
  texto text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_jobs_msg_job on public.jobs_mensagens(job_id, created_at);
create index if not exists idx_jobs_msg_tenant on public.jobs_mensagens(tenant_id);

-- Marca até onde cada pessoa já leu a thread, pro contador de não lidas.
create table if not exists public.jobs_chat_leituras (
  tenant_id uuid not null references public.tenants(id),
  job_id uuid not null references public.jobs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  lida_ate timestamptz not null default now(),
  primary key (job_id, profile_id)
);

create index if not exists idx_chat_leituras_tenant on public.jobs_chat_leituras(tenant_id);

alter table public.jobs_mensagens enable row level security;
alter table public.jobs_chat_leituras enable row level security;

do $$ begin
  create policy jobs_mensagens_select on public.jobs_mensagens
    for select using (is_tenant_member(tenant_id));
  -- Só insere em nome de si mesmo. Mensagem enviada não se edita nem se
  -- apaga: é registro de conversa entre times.
  create policy jobs_mensagens_insert on public.jobs_mensagens
    for insert with check (
      is_tenant_member(tenant_id) and autor_id = (select auth.uid())
    );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy jobs_chat_leituras_select on public.jobs_chat_leituras
    for select using (is_tenant_member(tenant_id));
  create policy jobs_chat_leituras_insert on public.jobs_chat_leituras
    for insert with check (
      is_tenant_member(tenant_id) and profile_id = (select auth.uid())
    );
  create policy jobs_chat_leituras_update on public.jobs_chat_leituras
    for update using (
      is_tenant_member(tenant_id) and profile_id = (select auth.uid())
    ) with check (
      is_tenant_member(tenant_id) and profile_id = (select auth.uid())
    );
exception when duplicate_object then null;
end $$;

grant select, insert on public.jobs_mensagens to authenticated;
grant select, insert, update on public.jobs_chat_leituras to authenticated;
