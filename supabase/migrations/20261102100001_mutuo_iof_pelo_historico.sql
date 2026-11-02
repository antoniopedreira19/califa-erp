-- =====================================================================
-- Mútuo (decisão 230): o IOF que já está no histórico da planilha
-- =====================================================================
--
-- A guia de 15/10 da GoCrazy, do mútuo com a Community, já existe como linha
-- do histórico (CT 2T 2026), conciliada com o banco. Lançá-la pela linha do
-- banco contaria o dinheiro duas vezes no saldo e no fluxo, e tirá-la do
-- histórico a tiraria da DRE. Aqui ela só é marcada: a linha não muda, e a
-- tela de mútuos soma o valor dela no IOF do par.
--
-- A marcação vai pela digital, e não pelo id: o id morre a cada troca de cauda,
-- e a digital é a mesma linha da planilha numa versão nova. Se a descrição, o
-- fornecedor ou o Tipo da linha mudarem na planilha, a digital muda e a soma
-- perde a guia: o saldo e a DRE não sentem, só o IOF pago da tela.
--
-- A view lê só carga ativa e devolve uma linha por digital: a mesma linha em
-- duas cargas ativas não soma duas vezes.
-- =====================================================================

create table if not exists public.mutuos_iof_historico (
  tenant_id              uuid not null references public.tenants(id) on delete restrict,
  digital                text not null check (length(digital) between 8 and 64),
  pagador_empresa_contabil_id uuid not null references public.empresas_contabeis(id) on delete restrict,
  com_empresa_contabil_id uuid references public.empresas_contabeis(id) on delete restrict,
  com_fornecedor_id      uuid references public.fornecedores(id) on delete restrict,
  created_at             timestamptz not null default now(),
  primary key (tenant_id, digital),
  constraint chk_mutuos_iof_historico_uma_parte check (
    (com_empresa_contabil_id is null) <> (com_fornecedor_id is null)
  )
);

comment on table public.mutuos_iof_historico is
  'Linha do histórico da planilha que é IOF de um mútuo (decisão 230). Só marca a linha pela digital: o dinheiro continua no histórico.';

create index if not exists idx_mutuos_iof_historico_com_empresa
  on public.mutuos_iof_historico (com_empresa_contabil_id) where com_empresa_contabil_id is not null;
create index if not exists idx_mutuos_iof_historico_com_fornecedor
  on public.mutuos_iof_historico (com_fornecedor_id) where com_fornecedor_id is not null;

alter table public.mutuos_iof_historico enable row level security;

drop policy if exists mutuos_iof_historico_select on public.mutuos_iof_historico;
create policy mutuos_iof_historico_select on public.mutuos_iof_historico
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
  );

revoke all on public.mutuos_iof_historico from public, anon;
grant select on public.mutuos_iof_historico to authenticated;

create or replace view public.vw_mutuos_iof_historico
with (security_invoker = true) as
select distinct on (m.tenant_id, m.digital)
  m.tenant_id,
  m.digital,
  m.pagador_empresa_contabil_id,
  m.com_empresa_contabil_id,
  m.com_fornecedor_id,
  abs(h.valor)::numeric(14,2) as valor
from public.mutuos_iof_historico m
join public.historico_movimentos h on h.tenant_id = m.tenant_id and h.digital = m.digital
join public.historico_cargas c on c.id = h.carga_id and c.situacao = 'ativa'
order by m.tenant_id, m.digital, c.concluida_em desc;

comment on view public.vw_mutuos_iof_historico is
  'O IOF marcado em mutuos_iof_historico, com o valor da linha na carga ativa. Sem linha ativa, não aparece.';

revoke all on public.vw_mutuos_iof_historico from public, anon;
grant select on public.vw_mutuos_iof_historico to authenticated;

-- A guia de 15/10/2026 da GoCrazy, linha 4050 da aba Santander Go Crazy.
insert into public.mutuos_iof_historico (tenant_id, digital, pagador_empresa_contabil_id, com_fornecedor_id)
select a.tenant_id, '4cdae56bd8adf692', a.credor_empresa_contabil_id, a.devedor_fornecedor_id
  from public.mutuos_saldo_abertura a
  join public.empresas_contabeis c on c.id = a.credor_empresa_contabil_id
  join public.fornecedores f on f.id = a.devedor_fornecedor_id
 where c.nome_fantasia = 'GoCrazy'
   and f.nome = 'Community'
on conflict do nothing;
