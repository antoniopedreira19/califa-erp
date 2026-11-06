-- =============================================================================
-- As contas com extrato recomeçam em 03/11/2026 com o saldo do banco
-- (decisão 211, "Recomeçar as contas no último extrato")
-- =============================================================================
-- Pedido do Tiago em 03/11/2026 ("Faremos o recomendado de recomeçar no ultimo
-- extrato, e depois vamos preenchendo as lacunas por aqui") e confirmado em
-- 06/11/2026, com a tabela abaixo: "Sim, aplicar".
--
-- A conciliação passa ao financeiro com o saldo do banco. Os extratos de
-- 03/11 mostram as quatro contas correntes em R$ 0,00 no fim de 02/11: o banco
-- aplica sozinho o que sobra (ContaMax na Santander, Rende Fácil no BB). As
-- aplicações levam o saldo de 30/09, já conferido com o extrato delas, mais as
-- aplicações e os resgates de outubro que os extratos das correntes mostram.
-- Falta só o rendimento de outubro, que entra como receita financeira quando o
-- extrato da aplicação chegar.
--
--   Conta                          saldo de 01/10     saldo de 03/11
--   California Santander                     0,00               0,00
--   Santander ContaMax California        14.648,13         414.229,23
--   BB California                            0,00               0,00
--   BB Rende Fácil California           132.975,94         595.978,67
--   Santander GoCrazy                        0,00               0,00
--   Santander ContaMax GoCrazy           68.516,98         103.561,12
--   Santander Hitlab                         0,00               0,00
--   Santander ContaMax Hitlab            32.827,98           5.621,50
--
-- O que vem antes de 03/11 nessas contas (a cauda, as baixas e as linhas do
-- banco) deixa de somar no saldo e fica como histórico; as lacunas se
-- resolvem lá, sem mexer no saldo. As outras contas, sem extrato, não mudam.
--
-- Mudança DESTRUTIVA (sobrescreve o saldo inicial e a data de contas com
-- lançamento, que a tela não deixa trocar), confirmada pelo Tiago, que responde
-- por conta bancária e conciliação. Cada conta só muda se ainda estiver como
-- estava, e a troca fica na auditoria, como a edição pela tela.
-- =============================================================================

do $$
declare
  v_tiago constant uuid := '3a933b18-156d-48b3-b100-a8099292b1c2';
  v_conta public.contas_bancarias%rowtype;
  r       record;
begin
  for r in
    select * from (values
      ('18f505b2-81ad-4076-83d7-6a020b6f79ae'::uuid, 0::numeric,         0::numeric),
      ('82ff921c-a54b-4844-af40-f6eedb88eb00'::uuid, 14648.13::numeric,  414229.23::numeric),
      ('2106c129-3aa7-4994-90cd-22f81821b1af'::uuid, 0::numeric,         0::numeric),
      ('3b25fc6b-e48a-4616-9ead-fd98318ad7c2'::uuid, 132975.94::numeric, 595978.67::numeric),
      ('6ba5ea71-44bd-4f69-9e16-baa229fde531'::uuid, 0::numeric,         0::numeric),
      ('8d360b9a-e4d5-435f-a0a5-f06effbe046f'::uuid, 68516.98::numeric,  103561.12::numeric),
      ('48420543-bdee-473b-932a-f32c627d1a25'::uuid, 0::numeric,         0::numeric),
      ('384fb143-0ef1-459e-8b65-4a67fcd5265f'::uuid, 32827.98::numeric,  5621.50::numeric)
    ) as t(id, de, para)
  loop
    select * into v_conta
      from public.contas_bancarias
     where id = r.id
       and saldo_inicial = r.de
       and saldo_inicial_data = date '2026-10-01'
     for update;
    if not found then
      raise notice 'A conta % já não está com o saldo de 01/10: fica como está.', r.id;
      continue;
    end if;

    update public.contas_bancarias
       set saldo_inicial = r.para,
           saldo_inicial_data = date '2026-11-03'
     where id = v_conta.id;

    insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
    values (
      v_conta.tenant_id, v_tiago, 'conta_bancaria.atualizada', 'conta_bancaria', v_conta.id::text,
      jsonb_build_object(
        'nome', v_conta.nome,
        'banco', v_conta.banco,
        'saldo_inicial_de', v_conta.saldo_inicial,
        'saldo_inicial_para', r.para,
        'saldo_inicial_data_de', v_conta.saldo_inicial_data,
        'saldo_inicial_data_para', '2026-11-03',
        'motivo', 'A conta recomeça em 03/11/2026 com o saldo do banco no fim de 02/11 (decisão 211). A conciliação passa ao financeiro; o que vem antes fica no histórico, e as lacunas se resolvem lá.',
        'origem', 'migration 20261106900001'
      )
    );
  end loop;
end
$$;
