-- =============================================================================
-- O saldo inicial da California Santander passa para 01/10/2026 (decisão 211, A5)
-- =============================================================================
-- Pedido do Tiago em 27/10/2026: "a California Santander direto no banco por
-- causa da trava (R$ 0,00 em 01/10; as baixas de agosto e setembro ficam antes
-- do início)".
--
-- Com o 3T carregado no histórico, que vai até 30/09, o sistema começa em
-- 01/10. A conta corrente fecha todo dia em R$ 0,00 no extrato do banco: a
-- aplicação automática (ContaMax) leva o que sobra, e a conta de aplicação
-- entra à parte. Por isso o saldo inicial é R$ 0,00 em 01/10, como no
-- extrato. Hoje a conta tem R$ 100.000,00 em 01/08/2026, valor de antes da
-- implantação.
--
-- O cadastro não deixa mudar o saldo inicial nem a data de conta com
-- lançamento (`contas-bancarias/actions.ts`), e esta tem 25 baixas de PP: por
-- isso é migration. As 8 baixas de agosto e setembro ficam antes do início e
-- deixam de somar no saldo do sistema; elas estão no histórico da planilha. As
-- 17 de outubro continuam somando.
--
-- Mudança DESTRUTIVA (sobrescreve valor preenchido), confirmada pelo Tiago,
-- que responde por conta bancária e conciliação desde 27/10/2026. A linha só
-- muda se ainda estiver como estava (R$ 100.000,00 em 01/08/2026), e a troca
-- fica na auditoria, como a edição pela tela.
-- =============================================================================

do $$
declare
  v_tiago constant uuid := 'fa61a319-6409-4d02-93c5-8d8be2746673';
  v_conta public.contas_bancarias%rowtype;
  v_n     integer;
begin
  select count(*) into v_n
    from public.contas_bancarias
   where nome = 'California Santander';
  if v_n <> 1 then
    raise exception 'Esperava uma conta "California Santander" e achei %.', v_n;
  end if;

  select * into v_conta
    from public.contas_bancarias
   where nome = 'California Santander'
     and saldo_inicial = 100000
     and saldo_inicial_data = date '2026-08-01'
   for update;
  if not found then
    raise notice 'A California Santander já não está com R$ 100.000,00 em 01/08/2026: nada a fazer.';
    return;
  end if;

  update public.contas_bancarias
     set saldo_inicial = 0,
         saldo_inicial_data = date '2026-10-01'
   where id = v_conta.id;

  insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
  values (
    v_conta.tenant_id, v_tiago, 'conta_bancaria.atualizada', 'conta_bancaria', v_conta.id::text,
    jsonb_build_object(
      'nome', v_conta.nome,
      'banco', v_conta.banco,
      'saldo_inicial_de', v_conta.saldo_inicial,
      'saldo_inicial_para', 0,
      'saldo_inicial_data_de', v_conta.saldo_inicial_data,
      'saldo_inicial_data_para', '2026-10-01',
      'motivo', 'O sistema começa em 01/10/2026, depois do histórico da planilha (decisão 211). A conta corrente fecha em R$ 0,00 no extrato; a aplicação automática fica numa conta à parte. As baixas de agosto e setembro ficam antes do início.',
      'origem', 'migration 20261027100001'
    )
  );
end
$$;
