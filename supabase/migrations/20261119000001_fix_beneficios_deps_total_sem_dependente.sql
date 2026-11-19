-- =============================================================================
-- FIX: fn_beneficios_custo_mensal inflava valor_dependentes_total quando
--      o vínculo era modelo_preco='flat' e não havia dependente ativo.
--
-- PROBLEMA
--   A CTE calc_dependentes faz LEFT JOIN em colaborador_beneficio_dependente
--   e em dependentes. Quando não há dependente ativo, o LEFT JOIN devolve
--   uma linha-sentinela com d.id = NULL. A expressão interna do SUM era:
--       case
--         when b.modelo_preco = 'flat' then b.valor_flat
--         else (select bfp.valor from beneficio_faixas_preco bfp
--               where ... age(v_data_competencia, d.data_nascimento) ...)
--       end
--   No ramo 'flat' o valor retornado não depende de d.* (vem de b). Com
--   d.id = NULL, b.modelo_preco continua 'flat' e b.valor_flat é somado
--   indevidamente, inflando valor_dependentes_total em exatamente um "flat"
--   por vínculo sem dependente. No ramo 'faixa_etaria' a subquery casa
--   NULL >= idade_min como NULL e devolve NULL (comportamento correto).
--
--   Impacto observado em Nov/2026: 44 vínculos de Bradesco Dental ativos
--   sem dependentes somavam ~R$ 585/mês a mais no desconto de folha e no
--   fechamento mensal.
--
-- CORREÇÃO
--   Blindar a expressão com `when d.id is null then 0` antes do ramo flat.
--   Mantém o comportamento quando há dependente real.
-- =============================================================================

begin;

create or replace function public.fn_beneficios_custo_mensal(
  p_ano int,
  p_mes int,
  p_colaborador_id uuid
)
returns table (
  vinculo_id uuid,
  beneficio_id uuid,
  beneficio_nome text,
  beneficio_tipo public.beneficio_tipo,
  modo_custeio public.beneficio_modo_custeio,
  idade_titular int,
  valor_integral_titular numeric,
  valor_empresa_titular numeric,
  valor_colaborador_titular numeric,
  qtde_dependentes int,
  valor_dependentes_total numeric,
  valor_desconto_folha_total numeric
)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
declare
  v_data_competencia date;
begin
  v_data_competencia := make_date(p_ano, p_mes, 1);

  return query
  with vinculos_ativos as (
    select cb.*
      from public.colaborador_beneficio cb
     where cb.colaborador_id = p_colaborador_id
       and cb.data_inicio <= (v_data_competencia + interval '1 month' - interval '1 day')::date
       and (cb.data_fim is null or cb.data_fim >= v_data_competencia)
  ),
  calc_titular as (
    select
      va.id as vinculo_id,
      va.beneficio_id,
      va.modo_custeio,
      b.nome as beneficio_nome,
      b.tipo as beneficio_tipo,
      b.modelo_preco,
      b.valor_flat,
      b.percentual_empresa_titular,
      b.beneficio_base_id,
      extract(year from age(v_data_competencia, c.data_nascimento))::int as idade_titular,
      case
        when b.modelo_preco = 'flat' then b.valor_flat
        else (
          select bfp.valor
            from public.beneficio_faixas_preco bfp
           where bfp.beneficio_id = b.id
             and extract(year from age(v_data_competencia, c.data_nascimento))::int >= bfp.idade_min
             and (bfp.idade_max is null
                  or extract(year from age(v_data_competencia, c.data_nascimento))::int <= bfp.idade_max)
           limit 1
        )
      end as valor_integral_titular
    from vinculos_ativos va
    join public.beneficios b on b.id = va.beneficio_id
    join public.colaboradores c on c.id = p_colaborador_id
  ),
  calc_rateio_titular as (
    select
      ct.*,
      case
        when ct.modo_custeio = 'rateado' then
          round(ct.valor_integral_titular * ct.percentual_empresa_titular / 100.0, 2)
        when ct.modo_custeio = 'integral_empresa' then
          ct.valor_integral_titular
        when ct.modo_custeio = 'integral_empresa_com_upgrade' then
          coalesce((
            select bfp.valor
              from public.beneficio_faixas_preco bfp
             where bfp.beneficio_id = ct.beneficio_base_id
               and ct.idade_titular >= bfp.idade_min
               and (bfp.idade_max is null or ct.idade_titular <= bfp.idade_max)
             limit 1
          ), 0)
      end as valor_empresa_titular
    from calc_titular ct
  ),
  calc_dependentes as (
    select
      va.id as vinculo_id,
      count(d.id)::int as qtde_dependentes,
      coalesce(sum(
        case
          -- Sem dependente real (LEFT JOIN sentinela): não soma nada.
          when d.id is null then 0
          when b.modelo_preco = 'flat' then b.valor_flat
          else (
            select bfp.valor
              from public.beneficio_faixas_preco bfp
             where bfp.beneficio_id = b.id
               and extract(year from age(v_data_competencia, d.data_nascimento))::int >= bfp.idade_min
               and (bfp.idade_max is null
                    or extract(year from age(v_data_competencia, d.data_nascimento))::int <= bfp.idade_max)
             limit 1
          )
        end
      ), 0) as valor_dependentes_total
    from vinculos_ativos va
    join public.beneficios b on b.id = va.beneficio_id
    left join public.colaborador_beneficio_dependente cbd
      on cbd.colaborador_beneficio_id = va.id
      and cbd.data_inicio <= (v_data_competencia + interval '1 month' - interval '1 day')::date
      and (cbd.data_fim is null or cbd.data_fim >= v_data_competencia)
    left join public.dependentes d on d.id = cbd.dependente_id and d.ativo
    group by va.id
  )
  select
    crt.vinculo_id,
    crt.beneficio_id,
    crt.beneficio_nome,
    crt.beneficio_tipo,
    crt.modo_custeio,
    crt.idade_titular,
    crt.valor_integral_titular,
    crt.valor_empresa_titular,
    (crt.valor_integral_titular - crt.valor_empresa_titular) as valor_colaborador_titular,
    coalesce(cd.qtde_dependentes, 0) as qtde_dependentes,
    coalesce(cd.valor_dependentes_total, 0) as valor_dependentes_total,
    ((crt.valor_integral_titular - crt.valor_empresa_titular) + coalesce(cd.valor_dependentes_total, 0))
      as valor_desconto_folha_total
  from calc_rateio_titular crt
  left join calc_dependentes cd on cd.vinculo_id = crt.vinculo_id;
end;
$$;

grant execute on function public.fn_beneficios_custo_mensal(int, int, uuid)
  to authenticated;

commit;
