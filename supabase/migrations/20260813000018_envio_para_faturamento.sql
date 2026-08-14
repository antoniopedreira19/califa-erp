-- =====================================================================
-- Envio do job para faturamento
--
-- Até aqui não existia passo entre "job aberto" e "financeiro emite a
-- NF": a `vw_faturamento_pendente` listava TODO job aberto com
-- faturamento previsto, e o financeiro descobria sozinho o que estava
-- pronto para faturar. Faltavam justamente as informações que só a
-- produção tem — número da PO, CNAE a usar, portal do cliente onde a
-- nota é lançada e a data de vencimento acordada.
--
-- Esta migration cria esse passo:
--
--   1. `cliente_portais` — os portais de fornecedor do cliente. São
--      VÁRIOS por cliente (decisão do time, 13/08/2026: certos clientes
--      têm mais de um portal), cadastrados uma vez e reaproveitados em
--      todo job daquele cliente.
--   2. `jobs_envio_faturamento` — o envio em si, um por job.
--   3. `vw_faturamento_pendente` passa a exigir o envio: o financeiro só
--      vê na fila o que a produção liberou, já com PO, CNAE e portal.
--
-- ⚠️ Consequência conhecida e aceita pelo time: jobs abertos que ainda
-- não foram enviados SOMEM da aba Faturamento até alguém enviá-los. É o
-- ponto da mudança — a fila deixa de ser "todo job aberto" e passa a ser
-- "todo job liberado pela produção".
--
-- CNAE fica como texto livre nesta fase (decisão do time): não existe
-- cadastro de CNAE no projeto e criar um agora seria antecipar estrutura
-- sem uso definido. Quando virar lista, o campo vira FK.
-- =====================================================================

-- ---------- 1. Portais do cliente ----------
create table if not exists public.cliente_portais (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  -- Como o time chama aquele portal ("Coupa", "Ariba", "Portal NF").
  nome text not null,
  url text not null,
  ativo boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_cliente_portal_nome check (length(trim(nome)) > 0),
  constraint chk_cliente_portal_url check (length(trim(url)) > 0),
  constraint uniq_cliente_portal_nome unique (cliente_id, nome)
);

create index if not exists idx_cliente_portais_cliente
  on public.cliente_portais(cliente_id);
create index if not exists idx_cliente_portais_tenant
  on public.cliente_portais(tenant_id);

drop trigger if exists trg_cliente_portais_updated_at on public.cliente_portais;
create trigger trg_cliente_portais_updated_at
  before update on public.cliente_portais
  for each row execute function public.set_updated_at();

alter table public.cliente_portais enable row level security;

drop policy if exists cliente_portais_select on public.cliente_portais;
create policy cliente_portais_select on public.cliente_portais
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists cliente_portais_insert on public.cliente_portais;
create policy cliente_portais_insert on public.cliente_portais
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists cliente_portais_update on public.cliente_portais;
create policy cliente_portais_update on public.cliente_portais
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists cliente_portais_delete on public.cliente_portais;
create policy cliente_portais_delete on public.cliente_portais
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.cliente_portais to authenticated;

comment on table public.cliente_portais is
  'Portais de fornecedor do cliente, onde a NF e lancada. Varios por cliente; o envio para faturamento escolhe um.';

-- ---------- 2. Envio para faturamento ----------
create table if not exists public.jobs_envio_faturamento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  -- Um envio por job: o valor vai travado no faturamento previsto
  -- inteiro, então não há envio parcial. NF parcial continua possível do
  -- lado do financeiro, que é onde `faturamentos` controla o saldo.
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  -- Cópia do `faturamento_previsto` no instante do envio. Cópia, e não
  -- leitura em tempo real, porque errata posterior mudaria o valor que a
  -- produção declarou ter liberado.
  valor_faturado numeric(14, 2) not null,
  -- Nem todo cliente emite PO.
  numero_po text,
  -- Vencimento acordado. Nasce da data prevista na abertura do job e é
  -- editável no envio.
  data_faturamento date not null,
  -- Texto livre nesta fase — ver cabeçalho.
  cnae text not null,
  portal_id uuid references public.cliente_portais(id) on delete set null,
  -- Snapshot da URL escolhida: se o portal for editado ou removido do
  -- cadastro depois, o registro do envio continua dizendo para onde a
  -- nota devia ir.
  portal_url text,
  enviado_em timestamptz not null default now(),
  enviado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_envio_valor_positivo check (valor_faturado > 0),
  constraint chk_envio_cnae check (length(trim(cnae)) > 0)
);

create index if not exists idx_envio_faturamento_job
  on public.jobs_envio_faturamento(job_id);
create index if not exists idx_envio_faturamento_tenant
  on public.jobs_envio_faturamento(tenant_id);
create index if not exists idx_envio_faturamento_portal
  on public.jobs_envio_faturamento(portal_id);
-- A fila do financeiro ordena por vencimento.
create index if not exists idx_envio_faturamento_data
  on public.jobs_envio_faturamento(tenant_id, data_faturamento);

drop trigger if exists trg_envio_faturamento_updated_at on public.jobs_envio_faturamento;
create trigger trg_envio_faturamento_updated_at
  before update on public.jobs_envio_faturamento
  for each row execute function public.set_updated_at();

alter table public.jobs_envio_faturamento enable row level security;

drop policy if exists envio_faturamento_select on public.jobs_envio_faturamento;
create policy envio_faturamento_select on public.jobs_envio_faturamento
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists envio_faturamento_insert on public.jobs_envio_faturamento;
create policy envio_faturamento_insert on public.jobs_envio_faturamento
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists envio_faturamento_update on public.jobs_envio_faturamento;
create policy envio_faturamento_update on public.jobs_envio_faturamento
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Sem DELETE: envio para faturamento é evento, não rascunho. Desfazer
-- vira decisão de negócio própria, com registro.

grant select, insert, update on public.jobs_envio_faturamento to authenticated;

comment on table public.jobs_envio_faturamento is
  'Liberacao do job pela producao para o financeiro faturar: valor, PO, vencimento, CNAE e portal. Um por job; alimenta vw_faturamento_pendente.';

-- ---------- 3. A fila passa a exigir o envio ----------
-- Só o ramo 'job' muda; o ramo 'bv' fica exatamente como estava.
create or replace view public.vw_faturamento_pendente as
 select 'job'::text as origem_tipo,
    j.id as origem_id,
    j.tenant_id,
    j.empresa_id,
    j.codigo,
    j.nome as descricao,
    p.cliente_id,
    null::uuid as fornecedor_id,
    -- O valor que a produção liberou, não o previsto corrente.
    -- Cast para `numeric` puro: a coluna original vinha de
    -- `jobs.faturamento_previsto` (sem precisão declarada), e
    -- `create or replace view` exige tipo idêntico.
    ef.valor_faturado::numeric as valor_previsto,
    coalesce(sum(f.valor_total) filter (where f.status = 'emitido'::faturamento_status), 0::numeric)::numeric(14,2) as valor_ja_faturado,
    (ef.valor_faturado - coalesce(sum(f.valor_total) filter (where f.status = 'emitido'::faturamento_status), 0::numeric))::numeric(14,2) as saldo,
    -- Vencimento acordado no envio, não a data prevista da abertura.
    ef.data_faturamento as data_prevista
   from jobs j
     join projetos p on p.id = j.projeto_id
     join jobs_envio_faturamento ef on ef.job_id = j.id
     left join faturamentos f on f.origem_tipo = 'job'::faturamento_origem and f.origem_id = j.id
  where j.status = 'aberto'::job_status
    and ef.valor_faturado > 0::numeric
  group by j.id, p.cliente_id, ef.valor_faturado, ef.data_faturamento
 having (ef.valor_faturado - coalesce(sum(f.valor_total) filter (where f.status = 'emitido'::faturamento_status), 0::numeric)) > 0::numeric
union all
 select 'bv'::text as origem_tipo,
    bv.id as origem_id,
    bv.tenant_id,
    null::uuid as empresa_id,
    null::text as codigo,
    'BV — '::text || v.item as descricao,
    null::uuid as cliente_id,
    bv.fornecedor_id,
    bv.valor as valor_previsto,
    0::numeric(14,2) as valor_ja_faturado,
    bv.valor as saldo,
    bv.prazo_repasse as data_prevista
   from itens_bv bv
     join versoes_orcamento_itens v on v.id = bv.item_versao_id
  where bv.situacao = 'confirmado'::bv_situacao
    and not (exists ( select 1
           from faturamentos f
          where f.origem_tipo = 'bv'::faturamento_origem and f.origem_id = bv.id and f.status = 'emitido'::faturamento_status));

comment on view public.vw_faturamento_pendente is
  'Fila de faturamento. Job so entra depois de enviado pela producao (jobs_envio_faturamento); BV entra quando confirmado.';
