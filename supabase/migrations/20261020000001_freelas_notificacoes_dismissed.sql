-- Pool global de "lidos" do painel Novidades do /freelancers.
--
-- 1 row por item marcado como visto. Pool compartilhado entre todos os
-- usuários autenticados do tenant: RH A clica ✓, RH B vê o item sumir ao vivo
-- via Realtime.
--
-- notification_id é texto porque cada tipo de notificação encapsula seu id com
-- um prefixo semântico:
--   freelas:novo:<freelancer_id>
--   freelas:aditivo:<contrato_id>
--   freelas:preenchimento:<contrato_id>
--   freelas:distrato-solicitado:<contrato_id>
--   freelas:solicitacao-concluida:<solicitacao_id>
--
-- Dismiss é PERMANENTE (sem UPDATE/DELETE). Se o fluxo gerar o mesmo item de
-- novo (ex.: aditivo novo em contrato já dismissado), use um id diferente.
--
-- Tabela genérica (sem prefixo `freelancer_`) pra que outros módulos possam
-- reusar no futuro — a prefixação fica no `notification_id`.

begin;

create table if not exists public.notificacoes_dismissed (
  notification_id text primary key,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  dismissed_at    timestamptz not null default now(),
  dismissed_by    uuid references public.profiles(id) on delete set null
);

create index if not exists idx_notificacoes_dismissed_tenant
  on public.notificacoes_dismissed (tenant_id);

alter table public.notificacoes_dismissed enable row level security;

drop policy if exists notificacoes_dismissed_select on public.notificacoes_dismissed;
create policy notificacoes_dismissed_select on public.notificacoes_dismissed
  for select using (is_tenant_member(tenant_id));

drop policy if exists notificacoes_dismissed_insert on public.notificacoes_dismissed;
create policy notificacoes_dismissed_insert on public.notificacoes_dismissed
  for insert with check (
    is_tenant_member(tenant_id)
    and dismissed_by = (select auth.uid())
  );

-- Sem UPDATE/DELETE: dismissal é permanente.

grant select, insert on public.notificacoes_dismissed to authenticated;

-- Publica no Realtime pra propagar INSERTs entre clientes.
do $$
begin
  alter publication supabase_realtime add table public.notificacoes_dismissed;
exception when duplicate_object then null;
end $$;

commit;
