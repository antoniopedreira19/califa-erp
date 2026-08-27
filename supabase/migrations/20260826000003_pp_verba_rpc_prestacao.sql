-- =====================================================================
-- RPC fechar_prestacao_verba_pp — versão 1 (sem devolução ainda)
--
-- Fecha a prestação de contas de uma PP de Verba de Produção. Nesta
-- migration, só insere pp_verba_prestacoes; a criação do "título negativo"
-- (pp_verba_devolucoes) entra na migration 20260826000006 quando a tabela
-- já existir e o enum origem_lancamento já tiver o valor novo.
--
-- Validações:
--   • PP existe, tenant, verba_producao=true, status='pago'.
--   • Ainda não tem prestação (unique defende, mas o erro é mais claro
--     se checarmos antes).
--   • 0 < valor_gasto <= pp.valor.
--
-- Anexos entram fora deste RPC — o server action sobe arquivos ao
-- Storage e insere em pp_verba_prestacoes_anexos com o prestacao_id que
-- este RPC retorna.
-- =====================================================================

create or replace function public.fechar_prestacao_verba_pp(
  p_pp_id       uuid,
  p_valor_gasto numeric,
  p_fechada_por uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp             pedidos_compra%rowtype;
  v_prestacao_id   uuid;
  v_valor_devolvido numeric(14,2);
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;

  if not public.is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem acesso a esta PP.';
  end if;

  if v_pp.verba_producao is not true then
    raise exception 'Esta PP não é de Verba de Produção.';
  end if;

  if v_pp.status <> 'pago' then
    raise exception 'A prestação de contas só pode ser feita depois que a PP for totalmente paga (status atual: %).', v_pp.status;
  end if;

  if exists (select 1 from public.pp_verba_prestacoes where pedido_compra_id = p_pp_id) then
    raise exception 'Esta PP já tem prestação de contas registrada.';
  end if;

  if p_valor_gasto is null or p_valor_gasto <= 0 then
    raise exception 'Informe um valor gasto maior que zero.';
  end if;

  if p_valor_gasto > v_pp.valor then
    raise exception 'O valor gasto (%) não pode ser maior que o valor da PP (%).',
      to_char(p_valor_gasto, 'FM999999999990.00'),
      to_char(v_pp.valor,    'FM999999999990.00');
  end if;

  v_valor_devolvido := v_pp.valor - p_valor_gasto;

  insert into public.pp_verba_prestacoes (
    tenant_id, pedido_compra_id, valor_gasto, valor_devolvido, fechada_por
  ) values (
    v_pp.tenant_id, v_pp.id, p_valor_gasto, v_valor_devolvido, p_fechada_por
  )
  returning id into v_prestacao_id;

  -- A criação do pp_verba_devolucoes (quando valor_devolvido > 0) entra
  -- na versão 2 deste RPC, na migration 20260826000006.

  return v_prestacao_id;
end;
$$;

comment on function public.fechar_prestacao_verba_pp(uuid, numeric, uuid) is
  'Fecha a prestação de contas de uma PP de Verba de Produção paga. Versão 1: só grava a prestação. Versão 2 (migration 20260826000006) passa a gerar também a devolução quando valor_devolvido > 0.';

revoke execute on function public.fechar_prestacao_verba_pp(uuid, numeric, uuid) from public;
grant  execute on function public.fechar_prestacao_verba_pp(uuid, numeric, uuid) to authenticated;
