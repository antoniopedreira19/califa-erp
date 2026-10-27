-- =============================================================================
-- O fluxo de caixa conta a cauda do histórico (decisão 211, A6)
-- =============================================================================
-- A cauda (migrations 20261027100007 e 100008) põe no histórico da planilha
-- os pagamentos e recebimentos de outubro dos jobs até o 3T que não existem
-- no sistema, e a conciliação já os conta no saldo da conta. O fluxo de caixa
-- ainda não os via: o realizado de outubro ficava sem eles, e o saldo
-- projetado errava pelo mesmo tanto.
--
-- 1. `vw_fluxo_caixa` ganha o ramo `historico`: cada movimento da cauda
--    ativa, desde o início da conta, como movimento realizado na conta
--    (`origem_lancamento = 'historico'`), com a empresa e a regional que a
--    planilha deu. Sem job do sistema: `vw_fluxo_caixa_job_totais` não muda.
-- 2. `fc_saldos_por_conta` soma a cauda até a data, como os lançamentos.
--
-- Como em 20261027100002, o ramo é acrescentado à definição no ar
-- (`pg_get_viewdef`), e a migration confere que o resto ficou igual.
-- =============================================================================

do $$
declare
  v_antes  text;
  v_depois text;
  c_ramo   constant text := $ramo$
UNION ALL
 SELECT 'realizado'::text AS situacao,
    'historico'::text AS origem_tipo,
    h.id AS origem_id,
    h.tenant_id,
    h.empresa_id,
    h.conta_bancaria_id,
    h.data AS data_evento,
    abs(h.valor)::numeric(14,2) AS valor,
        CASE
            WHEN h.valor >= 0::numeric THEN 'entrada'::natureza_lancamento
            ELSE 'saida'::natureza_lancamento
        END AS natureza,
    'Histórico da planilha · '::text || COALESCE(h.job_nome, h.descricao, 'jobs até o 3T'::text) AS descricao,
    NULL::uuid AS fornecedor_id,
    NULL::uuid AS cliente_id,
    NULL::uuid AS job_id,
    'movimento'::text AS classe,
    h.regional_id,
    'historico'::text AS origem_lancamento
   FROM historico_movimentos h
     JOIN historico_cargas hc ON hc.id = h.carga_id AND hc.tipo = 'cauda'::text AND hc.situacao = 'ativa'::text
     JOIN contas_bancarias cb ON cb.id = h.conta_bancaria_id
  WHERE h.data >= cb.saldo_inicial_data
$ramo$;
begin
  v_antes := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);

  if position('''historico''::text AS origem_tipo' in v_antes) > 0 then
    return; -- já tem o ramo da cauda
  end if;

  v_antes := rtrim(v_antes, E'; \n');
  execute 'create or replace view public.vw_fluxo_caixa as ' || v_antes || c_ramo;

  v_depois := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  if left(v_depois, length(v_antes)) <> v_antes
     or position('''historico''::text AS origem_tipo' in v_depois) = 0 then
    raise exception 'public.vw_fluxo_caixa: a definição no ar não é a esperada';
  end if;
end
$$;

create or replace function public.fc_saldos_por_conta(p_data date)
returns table(conta_bancaria_id uuid, saldo numeric)
language sql
stable
set search_path to ''
as $function$
  with movimentos as (
    select l.conta_bancaria_id, l.data_movimento as data,
           case when l.natureza = 'entrada' then l.valor else -l.valor end as valor
      from public.lancamentos_financeiros l
     where l.data_movimento <= p_data
    union all
    -- A cauda do histórico (decisão 211, A6): valor com sinal.
    select h.conta_bancaria_id, h.data, h.valor
      from public.historico_movimentos h
      join public.historico_cargas hc on hc.id = h.carga_id and hc.tipo = 'cauda' and hc.situacao = 'ativa'
     where h.data <= p_data
  )
  select c.id,
         (c.saldo_inicial + coalesce(sum(m.valor), 0))::numeric(14,2)
  from public.contas_bancarias c
  left join movimentos m
         on m.conta_bancaria_id = c.id
        and m.data >= c.saldo_inicial_data
  where c.ativo
  group by c.id, c.saldo_inicial;
$function$;
