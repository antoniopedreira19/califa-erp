-- =====================================================================
-- PP de Verba de Produção — extensão de pedidos_compra
--
-- Verba de Produção é um subtipo de PP: em vez de pagar a um fornecedor,
-- a PP é paga a um responsável (profile do tenant) que fica com o dinheiro
-- e presta contas ao final. A regra de coerência ("verba ↔ tem responsável
-- e não tem fornecedor; não-verba ↔ tem fornecedor e não tem responsável")
-- vive numa CHECK — sem ela, o front esqueceria de trocar um campo pelo
-- outro em algum edge case e o banco aceitaria PP com os dois preenchidos.
--
-- Aditiva: verba_producao nasce false por default; PPs existentes já têm
-- fornecedor_id preenchido, então a constraint fecha para todas elas sem
-- backfill.
-- =====================================================================

alter table public.pedidos_compra
  add column if not exists verba_producao boolean not null default false,
  add column if not exists responsavel_verba_id uuid
    references public.profiles(id) on delete restrict;

-- fornecedor_id passa a ser opcional: nulo quando é verba. A CHECK abaixo
-- garante que sempre um dos dois lados esteja preenchido.
alter table public.pedidos_compra
  alter column fornecedor_id drop not null;

alter table public.pedidos_compra
  drop constraint if exists chk_pp_verba_producao_coerencia;

alter table public.pedidos_compra
  add constraint chk_pp_verba_producao_coerencia check (
    (verba_producao = true  and fornecedor_id is null     and responsavel_verba_id is not null)
    or
    (verba_producao = false and fornecedor_id is not null and responsavel_verba_id is null)
  );

create index if not exists idx_pp_responsavel_verba
  on public.pedidos_compra(responsavel_verba_id)
  where verba_producao = true;

comment on column public.pedidos_compra.verba_producao is
  'true quando esta PP é Verba de Produção: paga ao responsável em vez do fornecedor, com prestação de contas obrigatória depois de paga.';

comment on column public.pedidos_compra.responsavel_verba_id is
  'Profile do tenant que assume o dinheiro da verba. Obrigatório quando verba_producao=true; nulo caso contrário. Garantido pela chk_pp_verba_producao_coerencia.';
