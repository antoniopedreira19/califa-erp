-- =====================================================================
-- Task 012 — Wiring de contas_avulsas em lancamentos_financeiros
-- Roda APÓS 20260806000002 (que adiciona os valores no enum).
-- =====================================================================

-- 1) Nova coluna FK
alter table public.lancamentos_financeiros
  add column if not exists conta_avulsa_id uuid references public.contas_avulsas(id) on delete restrict;

create index if not exists idx_lanc_avulsa on public.lancamentos_financeiros(conta_avulsa_id);

-- 2) Substituir CHECK chk_origem_pp_tem_pp_id pelo novo
alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_pp_tem_pp_id;

alter table public.lancamentos_financeiros
  add constraint chk_origem_tem_referencia check (
    (origem in ('pp_baixa','pp_baixa_estornada','pp_estorno')
      and pedido_compra_id is not null and conta_avulsa_id is null)
    or
    (origem in ('avulsa_baixa','avulsa_baixa_estornada','avulsa_estorno')
      and conta_avulsa_id is not null and pedido_compra_id is null)
    or
    (origem = 'manual' and pedido_compra_id is null and conta_avulsa_id is null)
  );

-- 3) Substituir CHECK chk_estorno_consistente
alter table public.lancamentos_financeiros
  drop constraint if exists chk_estorno_consistente;

alter table public.lancamentos_financeiros
  add constraint chk_estorno_consistente check (
    (origem in ('pp_estorno','avulsa_estorno') and estorno_de_lancamento_id is not null)
    or
    (origem not in ('pp_estorno','avulsa_estorno') and estorno_de_lancamento_id is null)
  );

-- 4) Unique parcial pra baixa ativa por avulsa
create unique index if not exists uniq_baixa_ativa_por_avulsa
  on public.lancamentos_financeiros(conta_avulsa_id)
  where origem = 'avulsa_baixa';
