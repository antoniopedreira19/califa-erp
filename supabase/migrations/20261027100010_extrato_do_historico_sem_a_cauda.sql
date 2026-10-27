-- =============================================================================
-- O histórico antes do início da conta não conta a cauda (decisão 211, A6)
-- =============================================================================
-- O Extrato da conta mostra, antes do início dela no sistema, o histórico da
-- planilha (A3, `historico_extrato_da_conta`), com o aviso "esta conta tem
-- histórico de ... a ..., antes de começar no sistema". Com a cauda
-- (migration 20261027100007), a cobertura passou a ir até 23/10/2026, e o
-- aviso dizia que o histórico vai além do início da conta.
--
-- A cauda é depois do início da conta e já entra no Extrato na ordem do dia,
-- com os lançamentos (`cauda-no-extrato.ts`). Aqui a função lê só as cargas
-- de período: a mesma regra de antes, sem a cauda. Aditiva.
-- =============================================================================

create or replace function public.historico_extrato_da_conta(p_conta_bancaria_id uuid, p_de date, p_ate date, p_limite integer default 3000)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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

  -- Só as cargas de período: a cauda é depois do início da conta e entra no
  -- Extrato com os lançamentos (A6).
  select coalesce(array_agg(id), '{}') into v_cargas
    from public.historico_cargas
   where tenant_id = v_conta.tenant_id and situacao = 'ativa' and tipo = 'periodo';
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
$function$;
