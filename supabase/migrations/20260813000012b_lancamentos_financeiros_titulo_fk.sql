-- =====================================================================
-- Segunda migration da extensao de lancamentos_financeiros p/ titulos.
-- (separada porque ADD VALUE precisa commit antes de ser usado)
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

-- 2) Coluna FK em lancamentos_financeiros
alter table public.lancamentos_financeiros
  add column if not exists titulo_receber_id uuid
    references public.titulos_receber(id) on delete restrict;

create index if not exists idx_lanc_titulo
  on public.lancamentos_financeiros(titulo_receber_id);

-- 3) Unique parcial pra baixa ativa (evita duplicar baixa do mesmo titulo)
create unique index if not exists uniq_baixa_ativa_por_titulo
  on public.lancamentos_financeiros(titulo_receber_id)
  where origem = 'titulo_baixa';

-- 4) FK reversa em titulos_receber
alter table public.titulos_receber
  drop constraint if exists titulos_receber_lancamento_id_fkey;

alter table public.titulos_receber
  add constraint titulos_receber_lancamento_id_fkey
  foreign key (lancamento_id)
  references public.lancamentos_financeiros(id)
  on delete restrict;

-- 5) Atualiza constraint chk_origem_pp_tem_pp_id -> chk_origem_contraparte_tem_id
--    (renomeia + amplia pra cobrir titulo)
alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_pp_tem_pp_id;

alter table public.lancamentos_financeiros
  add constraint chk_origem_contraparte_tem_id check (
    (origem in ('pp_baixa','pp_baixa_estornada','pp_estorno') and pedido_compra_id is not null)
    or
    (origem in ('avulsa_baixa','avulsa_baixa_estornada','avulsa_estorno') and conta_avulsa_id is not null)
    or
    (origem in ('titulo_baixa','titulo_baixa_estornada','titulo_estorno') and titulo_receber_id is not null)
    or
    (origem = 'manual'
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null)
  );
