-- Saldos dos dias em aberto (Conciliação): as somas uma vez só, acumuladas dia a dia.
--
-- Diagnóstico (16/11/2026, depois da 20261116990002):
--   * saldos_dos_dias_em_aberto chamava _condicoes_do_fechamento uma vez POR DIA
--     em aberto. Cada chamada refazia tudo desde o início da conta: o saldo do
--     banco, o saldo do sistema (lançamentos + cauda do histórico) e ainda duas
--     contagens que esta tela não usa (linhas pendentes e lançamentos sem linha).
--     ~27 ms por dia: 221 ms com os 8 dias em aberto de hoje na conta principal,
--     e crescendo a cada dia sem conciliar (média 0,6 s e picos de 1,8 s sob
--     carga em 16/11).
--
-- A troca: o mesmo cálculo do _condicoes_do_fechamento, só com as três colunas
-- que a tela mostra, feito numa passada. Cada fonte é lida uma vez, agrupada por
-- dia, e cada dia soma o que veio até ele:
--   * saldo do banco(d) = saldo informado na importação mais recente com saldo
--     - extrato até a data desse saldo + extrato até d. É a mesma conta do
--     original (que subtrai o extrato entre d e a data do saldo, ou soma o que
--     vem depois dela), escrita como diferença de acumulados.
--   * saldo do sistema(d) = saldo inicial + lançamentos da conta (do início da
--     conta até d, entrada soma, saída subtrai) + cauda do histórico até d
--     (_historico_cauda_da_conta, a mesma função do original).
--   * diferença = banco - sistema antes de arredondar; tudo round(…, 2); sem
--     saldo informado em nenhuma importação, banco e diferença saem null.
-- As CTEs vão "materialized" de propósito: sem isso o Postgres as reexecuta
-- dentro de cada dia e o ganho some (testado: 96 ms em vez de 10 ms).
--
-- O resultado NÃO muda:
--   * Conferido antes de aplicar em TODOS os dias de extrato de todas as 6
--     contas com importação, nos dois tenants, incluindo os dias anteriores ao
--     recomeço (78 dias): o jsonb de cada dia saiu idêntico ao montado com
--     _condicoes_do_fechamento.
--   * Mesmo cabeçalho: STABLE, SECURITY DEFINER, mesma exigência de admin ou
--     financeiro (_exige_financeiro_conciliacao), mesmo período (do dia seguinte
--     ao fechamento, ou do saldo inicial, até o último dia completo importado).
--   * _condicoes_do_fechamento fica como está: condicoes_do_fechamento (um dia
--     só, com as contagens) continua usando a função.
--
-- Medido (conta principal, 29 dias de extrato): 392 ms -> 10 ms.

create or replace function public.saldos_dos_dias_em_aberto(p_conta_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_conta       contas_bancarias%rowtype;
  v_max         date;
  v_de          date;
  v_saldo_banco numeric;
  v_saldo_em    date;
  v_banco_base  numeric;
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

  -- O saldo do banco parte do mesmo ponto do _condicoes_do_fechamento.
  select i.saldo_banco, i.saldo_em into v_saldo_banco, v_saldo_em
    from public.extrato_importacoes i
   where i.conta_bancaria_id = p_conta_id and i.saldo_banco is not null and i.saldo_em is not null
   order by i.saldo_em desc, i.created_at desc
   limit 1;
  if v_saldo_banco is not null then
    v_banco_base := v_saldo_banco
      - coalesce((select sum(valor) from public.extrato_linhas
                   where conta_bancaria_id = p_conta_id and data <= v_saldo_em), 0);
  end if;

  return coalesce((
    with dias as materialized (
      select distinct l.data
        from public.extrato_linhas l
       where l.conta_bancaria_id = p_conta_id
         and l.data >= v_de
         and l.data <= v_max
    ),
    extrato as materialized (
      select e.data, sum(e.valor) as v
        from public.extrato_linhas e
       where e.conta_bancaria_id = p_conta_id
         and e.data <= v_max
       group by e.data
    ),
    lancamentos as materialized (
      select f.data_movimento as data,
             sum(case when f.natureza = 'entrada' then f.valor else -f.valor end) as v
        from public.lancamentos_financeiros f
       where f.conta_bancaria_id = p_conta_id
         and f.data_movimento >= v_conta.saldo_inicial_data
         and f.data_movimento <= v_max
       group by f.data_movimento
    ),
    historico as materialized (
      select h.data, sum(h.valor) as v
        from public._historico_cauda_da_conta(p_conta_id, null, v_max) h
       group by h.data
    ),
    por_dia as (
      select d.data,
             case when v_saldo_banco is null then null
                  else v_banco_base + coalesce((select sum(x.v) from extrato x where x.data <= d.data), 0)
             end as banco,
             v_conta.saldo_inicial
               + coalesce((select sum(x.v) from lancamentos x where x.data <= d.data), 0)
               + coalesce((select sum(x.v) from historico x where x.data <= d.data), 0) as sistema
        from dias d
    )
    select jsonb_agg(jsonb_build_object(
             'data', p.data,
             'saldo_banco', round(p.banco, 2),
             'saldo_sistema', round(p.sistema, 2),
             'diferenca', case when p.banco is null then null else round(p.banco - p.sistema, 2) end)
           order by p.data)
      from por_dia p
  ), '[]'::jsonb);
end;
$function$;
