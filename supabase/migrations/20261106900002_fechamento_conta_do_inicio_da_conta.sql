-- =============================================================================
-- As condições do fechamento contam do início da conta em diante
-- (decisão 211, "Recomeçar as contas no último extrato")
-- =============================================================================
-- Com o recomeço de 03/11/2026 (20261106900001), o que vem antes do início da
-- conta é histórico: não soma no saldo, e o Tiago decidiu em 06/11/2026 que
-- também sai da fila do financeiro ("Sim, a fila começa em 03/11"). As linhas
-- do banco e as baixas de antes do início se resolvem com as lacunas do
-- histórico.
--
-- `_condicoes_do_fechamento` contava as linhas pendentes e as baixas sem linha
-- de qualquer data até o dia do fechamento: as 248 linhas de outubro das
-- quatro contas travariam o primeiro fechamento depois do recomeço. Agora as
-- duas contagens começam em `saldo_inicial_data`, como já faziam o saldo do
-- sistema desta função e `_historico_cauda_da_conta`.
--
-- Aditiva: nenhum dado muda; a função mantém a assinatura, o SECURITY DEFINER
-- e o GRANT que tinha.
-- =============================================================================

create or replace function public._condicoes_do_fechamento(p_conta_id uuid, p_ate date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_conta       contas_bancarias%rowtype;
  v_pendentes   integer;
  v_sem_linha   integer;
  v_saldo_banco numeric;
  v_saldo_em    date;
  v_banco       numeric;
  v_sistema     numeric;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_id;
  if not found or p_ate is null then
    return null;
  end if;

  select count(*)::int into v_pendentes
    from public.extrato_linhas l
   where l.conta_bancaria_id = p_conta_id
     and l.data >= v_conta.saldo_inicial_data
     and l.data <= p_ate
     and l.ignorada_em is null
     and not exists (select 1 from public.lancamentos_financeiros f where f.extrato_linha_id = l.id)
     and not exists (select 1 from public.historico_movimentos h where h.extrato_linha_id = l.id);

  select count(*)::int into v_sem_linha
    from (
      select f.data_movimento as data
        from public.lancamentos_financeiros f
       where f.conta_bancaria_id = p_conta_id
         and f.extrato_linha_id is null
         and f.data_movimento >= v_conta.saldo_inicial_data
         and f.data_movimento <= p_ate
      union all
      select h.data
        from public._historico_cauda_da_conta(p_conta_id, null, p_ate) h
       where h.extrato_linha_id is null
    ) s
   where exists (
       select 1 from public.extrato_importacoes i
        where i.conta_bancaria_id = p_conta_id
          and i.periodo_inicio is not null
          and s.data >= i.periodo_inicio
          and s.data <= public._dia_completo_da_importacao(i.periodo_fim, i.gerado_em)
     );

  select i.saldo_banco, i.saldo_em into v_saldo_banco, v_saldo_em
    from public.extrato_importacoes i
   where i.conta_bancaria_id = p_conta_id and i.saldo_banco is not null and i.saldo_em is not null
   order by i.saldo_em desc, i.created_at desc
   limit 1;
  if v_saldo_banco is not null then
    v_banco := v_saldo_banco
      - coalesce((select sum(valor) from public.extrato_linhas
                   where conta_bancaria_id = p_conta_id and data > p_ate and data <= v_saldo_em), 0)
      + coalesce((select sum(valor) from public.extrato_linhas
                   where conta_bancaria_id = p_conta_id and data > v_saldo_em and data <= p_ate), 0);
  end if;

  v_sistema := v_conta.saldo_inicial;
  if p_ate >= v_conta.saldo_inicial_data then
    v_sistema := v_sistema + coalesce((
      select sum(case when natureza = 'entrada' then valor else -valor end)
        from public.lancamentos_financeiros
       where conta_bancaria_id = p_conta_id
         and data_movimento >= v_conta.saldo_inicial_data
         and data_movimento <= p_ate), 0)
      + coalesce((select sum(h.valor) from public._historico_cauda_da_conta(p_conta_id, null, p_ate) h), 0);
  end if;

  return jsonb_build_object(
    'ate', p_ate,
    'linhas_pendentes', v_pendentes,
    'sem_linha', v_sem_linha,
    'saldo_banco', round(v_banco, 2),
    'saldo_sistema', round(v_sistema, 2),
    'diferenca', case when v_banco is null then null else round(v_banco - v_sistema, 2) end
  );
end;
$function$;
