-- =====================================================================
-- Aprovação financeira PP — status 'aprovada' + colunas + RPCs
-- Ver spec: docs/superpowers/specs/2026-08-12-aprovacao-financeira-fluxo-caixa-design.md
-- =====================================================================

-- 1. Adiciona 'aprovada' ao enum pp_status (regra do Postgres: valor não pode
-- ser usado na mesma transação em que é ADDed — a Task 2+ é que usa)
alter type pp_status add value if not exists 'aprovada' before 'pago';

-- 2. Colunas de auditoria da aprovação
alter table public.pedidos_compra
  add column if not exists aprovada_em timestamptz,
  add column if not exists aprovada_por uuid references public.profiles(id);

-- 3. Índice partial pra listagem "A pagar" (PPs aprovadas por vencimento)
create index if not exists idx_pp_aprovada_prazo
  on public.pedidos_compra(tenant_id, prazo_pagamento_financeiro)
  where status = 'aprovada';

-- 4. RPC aprovar_pp
create or replace function public.aprovar_pp(p_pp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp        pedidos_compra%rowtype;
  v_user_id   uuid := auth.uid();
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if not public.is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem acesso a esta PP.';
  end if;
  if v_pp.status <> 'em_avaliacao' then
    raise exception 'PP precisa estar em avaliação (status atual: %).', v_pp.status;
  end if;

  update public.pedidos_compra
     set status = 'aprovada',
         aprovada_em = now(),
         aprovada_por = v_user_id
   where id = p_pp_id;
end;
$$;

grant execute on function public.aprovar_pp(uuid) to authenticated;

-- 5. RPC desaprovar_pp — devolve pra em_avaliacao com motivo
create or replace function public.desaprovar_pp(p_pp_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp        pedidos_compra%rowtype;
begin
  if p_motivo is null or length(trim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if not public.is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem acesso a esta PP.';
  end if;
  if v_pp.status <> 'aprovada' then
    raise exception 'PP não está aprovada (status atual: %).', v_pp.status;
  end if;

  update public.pedidos_compra
     set status = 'em_avaliacao',
         aprovada_em = null,
         aprovada_por = null
   where id = p_pp_id;
end;
$$;

grant execute on function public.desaprovar_pp(uuid, text) to authenticated;
