-- =============================================================================
-- O histórico da planilha no Extrato da Conciliação (decisão 211, A3)
-- =============================================================================
-- O Extrato de cada conta mostra o histórico da planilha antes de a conta
-- começar no sistema (a data do saldo inicial dela), só para leitura, com o
-- saldo contínuo a partir do saldo de abertura da carga mais antiga.
--
-- `historico_extrato_da_conta` devolve, para uma conta e um período, o
-- pedaço do período que cai no histórico das cargas ativas: o saldo antes
-- dele, os créditos, os débitos, quantas linhas há e as linhas em si (até
-- `p_limite`, na ordem da planilha: data e linha), com o tipo e o subtipo do
-- plano de contas. Devolve também o início da conta no sistema e o período que
-- o histórico cobre, para a tela apontar o caminho quando o período escolhido
-- não tem histórico.
--
-- SECURITY DEFINER com a trava de papel lida uma vez: pela RLS, a soma do
-- saldo anterior conferiria admin e financeiro em cada uma das dezenas de
-- milhares de linhas de uma conta. Sem o papel, a função devolve nulo (a
-- tela já é só de admin e financeiro).
--
-- Mudança ADITIVA: só a função nova.
-- =============================================================================

create or replace function public.historico_extrato_da_conta(
  p_conta_bancaria_id uuid,
  p_de date,
  p_ate date,
  p_limite integer default 3000
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_conta     public.contas_bancarias%rowtype;
  v_cargas    uuid[];
  v_primeiro  date;
  v_ultimo    date;
  v_abertura  numeric;
  v_de        date;
  v_ate       date;
  v_base      jsonb;
  v_resumo    record;
  v_linhas    jsonb;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then return null; end if;
  if not (public.is_tenant_admin(v_conta.tenant_id) or public.is_tenant_financeiro(v_conta.tenant_id)) then
    return null;
  end if;

  select coalesce(array_agg(id), '{}') into v_cargas
    from public.historico_cargas
   where tenant_id = v_conta.tenant_id and situacao = 'ativa';
  select min(data), max(data) into v_primeiro, v_ultimo
    from public.historico_movimentos
   where conta_bancaria_id = v_conta.id and carga_id = any(v_cargas);

  v_base := jsonb_build_object(
    'corte', v_conta.saldo_inicial_data,
    'cobertura', case when v_primeiro is null then null
                      else jsonb_build_object('de', v_primeiro, 'ate', v_ultimo) end,
    'periodo', null);
  if v_primeiro is null then return v_base; end if;

  -- O pedaço do período no histórico: do primeiro movimento ao dia antes de a
  -- conta começar no sistema.
  v_de := greatest(p_de, v_primeiro);
  v_ate := least(p_ate, v_conta.saldo_inicial_data - 1);
  if v_de > v_ate then return v_base; end if;

  -- A abertura da carga mais antiga: o saldo da planilha no fim do mês antes dela.
  select s.saldo_planilha into v_abertura
    from public.historico_saldos s
   where s.conta_bancaria_id = v_conta.id and s.carga_id = any(v_cargas) and s.abertura
   order by s.mes
   limit 1;

  select coalesce(sum(m.valor) filter (where m.valor > 0), 0) as creditos,
         coalesce(-sum(m.valor) filter (where m.valor < 0), 0) as debitos,
         count(*) as total
    into v_resumo
    from public.historico_movimentos m
   where m.conta_bancaria_id = v_conta.id and m.carga_id = any(v_cargas)
     and m.data between v_de and v_ate;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'data', m.data, 'valor', m.valor, 'classe', m.classe,
           'descricao', m.descricao, 'fornecedor', m.fornecedor, 'job', m.job_nome,
           'tipo_codigo', t.codigo, 'tipo_nome', t.nome, 'subtipo_nome', s.nome,
           'competencia_trimestre', m.competencia_trimestre, 'competencia_ano', m.competencia_ano,
           'empresa', m.empresa_nome, 'regional', m.regional_nome, 'todas', m.regional_todas,
           'tipo_planilha', m.tipo_planilha, 'cod', m.cod, 'aba', m.aba, 'linha', m.linha)
           order by m.data, m.linha), '[]'::jsonb)
    into v_linhas
    from (select *
            from public.historico_movimentos
           where conta_bancaria_id = v_conta.id and carga_id = any(v_cargas)
             and data between v_de and v_ate
           order by data, linha
           limit greatest(p_limite, 0)) m
    left join public.plano_contas_tipos t on t.id = m.plano_conta_tipo_id
    left join public.plano_contas_subtipos s on s.id = m.plano_conta_subtipo_id;

  return v_base || jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'saldo_anterior', coalesce(v_abertura, 0) + coalesce((
        select sum(m.valor) from public.historico_movimentos m
         where m.conta_bancaria_id = v_conta.id and m.carga_id = any(v_cargas) and m.data < v_de), 0),
    'creditos', v_resumo.creditos,
    'debitos', v_resumo.debitos,
    'total', v_resumo.total,
    'linhas', v_linhas);
end;
$$;

revoke all on function public.historico_extrato_da_conta(uuid, date, date, integer) from public, anon;
grant execute on function public.historico_extrato_da_conta(uuid, date, date, integer) to authenticated;
