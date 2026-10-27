-- =============================================================================
-- A Santander Hitlab passa a começar em 01/10/2026 (decisão 211, A5)
-- =============================================================================
-- Pedido do Tiago em 27/10/2026: "Pode criar as 4 contas de aplicação com o
-- saldo do extrato em 01/10, ajustar a Santander GoCrazy e a BB California
-- pela tela e a Santander Hitlab por migration, como você propôs."
--
-- Como a California Santander (20261027100001): o sistema começa em 01/10,
-- depois do histórico da planilha, que vai até 30/09. A conta corrente fecha
-- todo dia em R$ 0,00 no extrato (a aplicação automática leva o que sobra),
-- e o saldo da aplicação em 30/09 (R$ 32.827,98, igual à planilha) está na
-- conta de investimento "Santander ContaMax Hitlab", criada pela tela.
--
-- Muda só a data: o saldo inicial já é R$ 0,00. A tela não deixa mudar a
-- data de conta com lançamento (`contas-bancarias/actions.ts`), e esta tem
-- 5 baixas de PP, todas de 14/10/2026: continuam depois do início e
-- continuam somando.
--
-- Mudança DESTRUTIVA (sobrescreve valor preenchido), confirmada pelo Tiago.
-- A linha só muda se ainda estiver como estava (R$ 0,00 em 11/09/2026), e a
-- troca fica na auditoria, como a edição pela tela.
-- =============================================================================

do $$
declare
  v_tiago constant uuid := '3a933b18-156d-48b3-b100-a8099292b1c2';
  v_conta public.contas_bancarias%rowtype;
  v_n     integer;
begin
  select count(*) into v_n
    from public.contas_bancarias
   where nome = 'Santander Hitlab';
  if v_n <> 1 then
    raise exception 'Esperava uma conta "Santander Hitlab" e achei %.', v_n;
  end if;

  select * into v_conta
    from public.contas_bancarias
   where nome = 'Santander Hitlab'
     and saldo_inicial = 0
     and saldo_inicial_data = date '2026-09-11'
   for update;
  if not found then
    raise notice 'A Santander Hitlab já não está com R$ 0,00 em 11/09/2026: nada a fazer.';
    return;
  end if;

  if exists (
    select 1
      from public.lancamentos_financeiros l
     where l.conta_bancaria_id = v_conta.id
       and l.data_movimento < date '2026-10-01'
  ) then
    raise exception 'A Santander Hitlab tem lançamento antes de 01/10/2026: confira antes de mudar a data.';
  end if;

  update public.contas_bancarias
     set saldo_inicial_data = date '2026-10-01'
   where id = v_conta.id;

  insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
  values (
    v_conta.tenant_id, v_tiago, 'conta_bancaria.atualizada', 'conta_bancaria', v_conta.id::text,
    jsonb_build_object(
      'nome', v_conta.nome,
      'banco', v_conta.banco,
      'saldo_inicial_de', v_conta.saldo_inicial,
      'saldo_inicial_para', v_conta.saldo_inicial,
      'saldo_inicial_data_de', v_conta.saldo_inicial_data,
      'saldo_inicial_data_para', '2026-10-01',
      'motivo', 'O sistema começa em 01/10/2026, depois do histórico da planilha (decisão 211). A conta corrente fecha em R$ 0,00 no extrato; a aplicação automática fica na conta Santander ContaMax Hitlab.',
      'origem', 'migration 20261027100006'
    )
  );
end
$$;
