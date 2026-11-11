-- =============================================================================
-- 20261111800001 — O saldo de cada dia em aberto, para o cadeado do dia avisar
-- antes do clique (decisão 254; Tiago, 11/11/2026)
-- =============================================================================
-- Na conciliação dia a dia, o cadeado do dia aparecia livre assim que as
-- pendências zeravam, mesmo com o saldo do banco diferente do sistema (uma
-- linha ignorada, por exemplo). Quem recusava era o `fechar_conciliacao`, só
-- depois do clique. O Tiago pediu o aviso antes.
--
-- `saldos_dos_dias_em_aberto(conta)` devolve, para cada dia com linha do
-- banco depois do fechamento ativo e até o último dia completo dos extratos,
-- os dois saldos e a diferença. A conta é a MESMA do fechamento: a função só
-- chama `_condicoes_do_fechamento` dia a dia, sem repetir a regra.
--
-- Só leitura, aditiva. Mesma permissão das outras da conciliação (admin e
-- financeiro, por `_exige_financeiro_conciliacao`).
-- =============================================================================

create or replace function public.saldos_dos_dias_em_aberto(p_conta_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_conta  contas_bancarias%rowtype;
  v_max    date;
  v_de     date;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  perform public._exige_financeiro_conciliacao(v_conta.tenant_id);

  select max(public._dia_completo_da_importacao(i.periodo_fim, i.gerado_em)) into v_max
    from public.extrato_importacoes i
   where i.conta_bancaria_id = p_conta_id;
  if v_max is null then
    return '[]'::jsonb;
  end if;
  v_de := greatest(v_conta.saldo_inicial_data,
                   coalesce(public._conciliacao_fechada_ate(p_conta_id) + 1, v_conta.saldo_inicial_data));

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'data', d.data,
             'saldo_banco', c.cond->'saldo_banco',
             'saldo_sistema', c.cond->'saldo_sistema',
             'diferenca', c.cond->'diferenca') order by d.data)
      from (select distinct l.data
              from public.extrato_linhas l
             where l.conta_bancaria_id = p_conta_id
               and l.data >= v_de
               and l.data <= v_max) d
     cross join lateral (select public._condicoes_do_fechamento(p_conta_id, d.data) as cond) c
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.saldos_dos_dias_em_aberto(uuid) from public, anon;
grant execute on function public.saldos_dos_dias_em_aberto(uuid) to authenticated;
comment on function public.saldos_dos_dias_em_aberto(uuid) is
  'Decisão 254: o saldo do banco, o do sistema e a diferença em cada dia em aberto com linha do banco (depois do fechamento ativo, até o último dia completo dos extratos), pela mesma conta do fechamento. Para o cadeado do dia avisar antes do clique.';
