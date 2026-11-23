-- Decisão 277 (entrega 2, 23/11/2026, pedido do Tiago): o saldo credor da
-- contabilidade.
--
-- Por quê: no PIS e na COFINS não cumulativos, quando o crédito passa do
-- débito, a guia sai zerada e o crédito que sobra vai para o mês seguinte.
-- Até aqui o mês seguinte partia do saldo que o SISTEMA calculou, mesmo
-- quando a guia foi aprovada com outro valor (o da contabilidade). Enquanto
-- nem tudo é lançado pelo sistema, o saldo certo é o da contabilidade.
--
-- O que faz (só acrescenta):
-- 1. `fiscal_aprovacoes.saldo_credor_contabil`: o saldo credor que a
--    contabilidade levou para o mês seguinte. Nulo = vale o calculado.
-- 2. `definir_saldo_credor_contabil(tenant, chave, valor)`: grava (ou limpa,
--    com nulo) o saldo na aprovação da guia — na hora de aprovar ou depois,
--    quando a contabilidade mandar o número. Só admin e financeiro, só na
--    guia de PIS ou COFINS não cumulativos já aprovada, com auditoria.

alter table public.fiscal_aprovacoes
  add column if not exists saldo_credor_contabil numeric(14,2);

alter table public.fiscal_aprovacoes
  drop constraint if exists chk_fiscal_aprovacao_saldo_contabil;
alter table public.fiscal_aprovacoes
  add constraint chk_fiscal_aprovacao_saldo_contabil
  check (saldo_credor_contabil is null or saldo_credor_contabil >= 0);

comment on column public.fiscal_aprovacoes.saldo_credor_contabil is
  'Decisão 277: o saldo credor de PIS/COFINS não cumulativos que a contabilidade levou para o mês seguinte. Nulo = o mês seguinte parte do saldo calculado.';

create or replace function public.definir_saldo_credor_contabil(
  p_tenant_id uuid,
  p_chave     text,
  p_valor     numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid;
  v_id    uuid;
  v_trib  text;
  v_antes numeric;
begin
  v_uid := public._exige_financeiro_fiscal(p_tenant_id);

  if p_valor is not null and p_valor < 0 then
    raise exception 'O saldo credor não pode ser negativo.';
  end if;

  select a.id, a.tributo, a.saldo_credor_contabil into v_id, v_trib, v_antes
    from public.fiscal_aprovacoes a
   where a.tenant_id = p_tenant_id and a.chave = p_chave and not a.diferenca;
  if v_id is null then
    raise exception 'A guia ainda não foi aprovada.';
  end if;
  -- Só o não cumulativo tem crédito (a chave da parte cumulativa é pis_cum|… e cofins_cum|…).
  if v_trib not in ('PIS', 'COFINS') or p_chave like 'pis_cum|%' or p_chave like 'cofins_cum|%' then
    raise exception 'Só a guia de PIS ou COFINS não cumulativos tem saldo credor.';
  end if;

  update public.fiscal_aprovacoes
     set saldo_credor_contabil = case when p_valor is null then null else round(p_valor, 2) end
   where id = v_id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (
    p_tenant_id, 'fiscal_aprovacao', v_id::text, 'fiscal.saldo_credor_contabil', v_uid,
    jsonb_build_object('chave', p_chave, 'de', v_antes, 'para', p_valor)
  );
end;
$$;

revoke all on function public.definir_saldo_credor_contabil(uuid, text, numeric) from public, anon;
grant execute on function public.definir_saldo_credor_contabil(uuid, text, numeric) to authenticated;
