-- =====================================================================
-- PP de Verba de Produção — prestação de contas + anexos
--
-- Prestação é IMUTÁVEL (decisão do Antonio, 2026-08-26): não reabre.
-- Se apurou errado, o caminho é estornar o lançamento da devolução
-- (RPC própria da devolução), e não editar a prestação. Por isso a tabela
-- não tem status — nasce fechada, com fechada_em/fechada_por.
--
-- valor_gasto é o número que o usuário digitou; valor_devolvido é
-- calculado (pp.valor − valor_gasto) e persistido para tornar a leitura
-- direta (sem join com pedidos_compra pra saber quanto voltou).
--
-- Uma prestação por PP: uniq_prestacao_por_pp. Anexo cascade porque
-- prestação sem sua prova não tem função.
-- =====================================================================

create table if not exists public.pp_verba_prestacoes (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  pedido_compra_id  uuid not null references public.pedidos_compra(id) on delete restrict,
  valor_gasto       numeric(14,2) not null,
  valor_devolvido   numeric(14,2) not null,
  fechada_em        timestamptz not null default now(),
  fechada_por       uuid not null references public.profiles(id),

  constraint uniq_prestacao_por_pp unique (pedido_compra_id),
  constraint chk_prestacao_valor_gasto_positivo check (valor_gasto > 0),
  constraint chk_prestacao_valor_devolvido_nao_negativo check (valor_devolvido >= 0)
);

create index if not exists idx_pp_verba_prestacoes_tenant
  on public.pp_verba_prestacoes(tenant_id);

create table if not exists public.pp_verba_prestacoes_anexos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  prestacao_id          uuid not null references public.pp_verba_prestacoes(id) on delete cascade,
  arquivo_path          text not null,
  arquivo_nome_original text not null,
  arquivo_tamanho_bytes bigint not null,
  arquivo_mimetype      text not null,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),

  constraint chk_prestacao_anexo_tamanho_positivo check (arquivo_tamanho_bytes > 0)
);

create index if not exists idx_pp_verba_prestacoes_anexos_prestacao
  on public.pp_verba_prestacoes_anexos(prestacao_id);

-- RLS + GRANT
alter table public.pp_verba_prestacoes enable row level security;
alter table public.pp_verba_prestacoes_anexos enable row level security;

drop policy if exists pp_verba_prestacoes_select on public.pp_verba_prestacoes;
create policy pp_verba_prestacoes_select on public.pp_verba_prestacoes
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists pp_verba_prestacoes_insert on public.pp_verba_prestacoes;
create policy pp_verba_prestacoes_insert on public.pp_verba_prestacoes
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists pp_verba_prestacoes_anexos_select on public.pp_verba_prestacoes_anexos;
create policy pp_verba_prestacoes_anexos_select on public.pp_verba_prestacoes_anexos
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists pp_verba_prestacoes_anexos_insert on public.pp_verba_prestacoes_anexos;
create policy pp_verba_prestacoes_anexos_insert on public.pp_verba_prestacoes_anexos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

-- Sem UPDATE/DELETE em prestação: é imutável. Anexo cascade apaga
-- automaticamente se a prestação for removida em manutenção manual do
-- DBA (cascade não checa GRANT).
grant select, insert on public.pp_verba_prestacoes to authenticated;
grant select, insert on public.pp_verba_prestacoes_anexos to authenticated;

comment on table public.pp_verba_prestacoes is
  'Prestação de contas de PP de Verba de Produção. Uma por PP. Imutável: valor_gasto e anexos não editam depois de gravados.';
