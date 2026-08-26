-- =====================================================================
-- pp_verba_devolucoes — o "título negativo" gerado quando a prestação de
-- contas apura sobra. Aparece na aba Títulos a Pagar (via vw_a_pagar) e
-- precisa ser baixada quando o TED do responsável cai na conta.
--
-- POR QUE TABELA PRÓPRIA (e não reuso de contas_avulsas): rastreabilidade
-- limpa (FK direto pra prestação e PP), fluxo próprio (sem aprovação —
-- devolução é entrada), origem própria no lançamento
-- (pp_devolucao_verba). Precedente: desembolsos (2026-08-20).
--
-- data_pagamento_primeira é congelada pela trigger genérica
-- congela_data_pagamento_primeira, mesma que serve pedidos_compra_parcelas
-- e contas_avulsas — os nomes de coluna batem.
--
-- CHECKs de lancamentos_financeiros ampliados: chk_origem_contraparte_tem_id
-- e chk_origem_tem_referencia precisam reconhecer pp_devolucao_verba e
-- pp_devolucao_verba_estornada, apontando para pp_verba_devolucao_id.
-- chk_estorno_consistente NÃO precisa de ajuste: não há valor *_estorno
-- no enum para este domínio (o padrão é _estornada, não _estorno).
-- =====================================================================

create table if not exists public.pp_verba_devolucoes (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete restrict,
  empresa_id              uuid not null references public.empresas(id) on delete restrict,
  prestacao_id            uuid not null references public.pp_verba_prestacoes(id) on delete restrict,
  pedido_compra_id        uuid not null references public.pedidos_compra(id) on delete restrict,
  valor                   numeric(14,2) not null,
  data_pagamento          date not null,
  data_pagamento_primeira date not null,
  pago_em                 date,
  pago_por                uuid references public.profiles(id),
  lancamento_id           uuid references public.lancamentos_financeiros(id) on delete restrict,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint uniq_devolucao_por_prestacao unique (prestacao_id),
  constraint chk_devolucao_valor_positivo check (valor > 0)
);

create index if not exists idx_pp_verba_devolucoes_tenant
  on public.pp_verba_devolucoes(tenant_id);

-- Fila do financeiro: devoluções aguardando baixa. Parcial porque
-- devolução paga sai da fila.
create index if not exists idx_pp_verba_devolucoes_a_baixar
  on public.pp_verba_devolucoes(tenant_id, data_pagamento)
  where pago_em is null;

-- Índices de FK para evitar sequential scans em joins e deletes
create index if not exists idx_pp_verba_devolucoes_empresa
  on public.pp_verba_devolucoes(empresa_id);

create index if not exists idx_pp_verba_devolucoes_pedido_compra
  on public.pp_verba_devolucoes(pedido_compra_id);

create index if not exists idx_pp_verba_devolucoes_lancamento
  on public.pp_verba_devolucoes(lancamento_id);

create index if not exists idx_pp_verba_devolucoes_pago_por
  on public.pp_verba_devolucoes(pago_por)
  where pago_por is not null;

drop trigger if exists trg_pp_verba_devolucoes_updated_at on public.pp_verba_devolucoes;
create trigger trg_pp_verba_devolucoes_updated_at
before update on public.pp_verba_devolucoes
for each row execute function public.set_updated_at();

-- Reusa a trigger genérica de congelar data_pagamento_primeira.
drop trigger if exists trg_congela_primeira_data on public.pp_verba_devolucoes;
create trigger trg_congela_primeira_data
before update on public.pp_verba_devolucoes
for each row execute function public.congela_data_pagamento_primeira();

alter table public.pp_verba_devolucoes enable row level security;

drop policy if exists pp_verba_devolucoes_select on public.pp_verba_devolucoes;
create policy pp_verba_devolucoes_select on public.pp_verba_devolucoes
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists pp_verba_devolucoes_insert on public.pp_verba_devolucoes;
create policy pp_verba_devolucoes_insert on public.pp_verba_devolucoes
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists pp_verba_devolucoes_update on public.pp_verba_devolucoes;
create policy pp_verba_devolucoes_update on public.pp_verba_devolucoes
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.pp_verba_devolucoes to authenticated;

-- FK opcional em lancamentos_financeiros: aponta pra devolução quando
-- origem = 'pp_devolucao_verba' (ou sua versão estornada).
alter table public.lancamentos_financeiros
  add column if not exists pp_verba_devolucao_id uuid
    references public.pp_verba_devolucoes(id) on delete restrict;

create index if not exists idx_lancamentos_pp_verba_devolucao
  on public.lancamentos_financeiros(pp_verba_devolucao_id);

comment on table public.pp_verba_devolucoes is
  'Devolução do saldo não gasto de uma PP de Verba de Produção. Uma por prestação. Aparece em Contas a Pagar via vw_a_pagar como origem pp_devolucao_verba (entrada — "título negativo").';

-- =====================================================================
-- Ampliar CHECKs de lancamentos_financeiros para reconhecer as novas
-- origens de devolução de verba.
--
-- chk_origem_contraparte_tem_id: garante que lançamentos de devolução de
-- verba têm pp_verba_devolucao_id preenchido.
--
-- chk_origem_tem_referencia: garante mutual exclusividade — lançamento de
-- devolução de verba não pode ter pedido_compra_id, conta_avulsa_id, etc.
-- =====================================================================

alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_contraparte_tem_id;

alter table public.lancamentos_financeiros
  add constraint chk_origem_contraparte_tem_id check (
    (
      origem = any(array['pp_baixa'::origem_lancamento, 'pp_baixa_estornada'::origem_lancamento, 'pp_estorno'::origem_lancamento])
      and pedido_compra_id is not null
    ) or (
      origem = any(array['avulsa_baixa'::origem_lancamento, 'avulsa_baixa_estornada'::origem_lancamento, 'avulsa_estorno'::origem_lancamento])
      and conta_avulsa_id is not null
    ) or (
      origem = any(array['titulo_baixa'::origem_lancamento, 'titulo_baixa_estornada'::origem_lancamento, 'titulo_estorno'::origem_lancamento])
      and titulo_receber_id is not null
    ) or (
      origem = any(array['desembolso_baixa'::origem_lancamento, 'desembolso_baixa_estornada'::origem_lancamento, 'desembolso_estorno'::origem_lancamento])
      and desembolso_id is not null
    ) or (
      origem = any(array['pp_devolucao_verba'::origem_lancamento, 'pp_devolucao_verba_estornada'::origem_lancamento])
      and pp_verba_devolucao_id is not null
    ) or (
      origem = 'manual'::origem_lancamento
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null
    )
  );

alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_tem_referencia;

alter table public.lancamentos_financeiros
  add constraint chk_origem_tem_referencia check (
    (
      origem = any(array['pp_baixa'::origem_lancamento, 'pp_baixa_estornada'::origem_lancamento, 'pp_estorno'::origem_lancamento])
      and pedido_compra_id is not null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null
      and pp_verba_devolucao_id is null
    ) or (
      origem = any(array['avulsa_baixa'::origem_lancamento, 'avulsa_baixa_estornada'::origem_lancamento, 'avulsa_estorno'::origem_lancamento])
      and conta_avulsa_id is not null
      and pedido_compra_id is null
      and titulo_receber_id is null
      and desembolso_id is null
      and pp_verba_devolucao_id is null
    ) or (
      origem = any(array['titulo_baixa'::origem_lancamento, 'titulo_baixa_estornada'::origem_lancamento, 'titulo_estorno'::origem_lancamento])
      and titulo_receber_id is not null
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and desembolso_id is null
      and pp_verba_devolucao_id is null
    ) or (
      origem = any(array['desembolso_baixa'::origem_lancamento, 'desembolso_baixa_estornada'::origem_lancamento, 'desembolso_estorno'::origem_lancamento])
      and desembolso_id is not null
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and pp_verba_devolucao_id is null
    ) or (
      origem = any(array['pp_devolucao_verba'::origem_lancamento, 'pp_devolucao_verba_estornada'::origem_lancamento])
      and pp_verba_devolucao_id is not null
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null
    ) or (
      origem = 'manual'::origem_lancamento
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null
      and pp_verba_devolucao_id is null
    )
  );
