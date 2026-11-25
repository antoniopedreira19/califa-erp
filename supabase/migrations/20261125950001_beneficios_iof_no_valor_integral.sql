-- =============================================================================
-- Adiciona IOF no cálculo de benefícios.
--
-- Problema: beneficio_faixas_preco.valor e beneficios.valor_flat guardam apenas
-- o *prêmio* da operadora. A fatura real cobra prêmio + IOF (2,38% em seguro-
-- saúde SulAmérica). O cálculo mostrado na tela e no futuro snapshot da Fase 2
-- ficava ~2,38% abaixo do valor efetivamente pago e descontado em folha.
--
-- Ex.: ALINE 37 anos, Especial, 11/2026
--   prêmio faixa 34-38      = R$ 866,93
--   IOF 2,38%               = R$  20,63
--   valor fatura (integral) = R$ 887,56
--   rateio 60/40 → empresa R$ 532,54 / colab R$ 355,02
--
-- Decisão: adicionar coluna aditiva beneficios.iof_percentual (fração decimal,
-- ex.: 0.0238 = 2,38%) e aplicá-la no valor_integral_titular e no
-- valor_dependentes_total dentro de fn_beneficios_custo_mensal. O rateio
-- empresa/colaborador continua sendo % sobre o integral com IOF, o que casa
-- com o ADR 174 §1.3 ("valor cheio da fatura" vira a avulsa).
--
-- Default = 0 (não altera benefício que já estiver certo). Atualizamos só
-- SulAmerica Saude pra 0,0238 nesta mesma migration, porque temos evidência
-- da fatura 11/2026. Bradesco Dental fica em 0 por enquanto — quem edita o
-- catálogo ajusta quando tiver o boleto em mãos.
-- =============================================================================

begin;

-- 1) Coluna aditiva no catálogo

alter table public.beneficios
  add column iof_percentual numeric(5, 4) not null default 0;

alter table public.beneficios
  add constraint chk_beneficios_iof_percentual_range
  check (iof_percentual >= 0 and iof_percentual < 1);

comment on column public.beneficios.iof_percentual is
  'Alíquota de IOF aplicada sobre o prêmio da operadora. Fração decimal: 0.0238 = 2,38%. Soma-se ao valor da faixa (ou ao valor_flat) para formar o valor_integral usado em rateio, upgrade e snapshot do fechamento mensal. Default 0 — produto sem IOF.';

-- 2) Preencher IOF dos benefícios com evidência de fatura

update public.beneficios
   set iof_percentual = 0.0238
 where operadora = 'SulAmerica Saude';

-- 3) fn_beneficios_custo_mensal: aplicar IOF no integral titular e dependentes

drop function if exists public.fn_beneficios_custo_mensal(int, int, uuid);

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
  percentual_empresa_titular int,
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
      b.iof_percentual,
      b.beneficio_base_id,
      extract(year from age(v_data_competencia, c.data_nascimento))::int as idade_titular,
      -- valor integral com IOF = prêmio × (1 + iof). Arredonda no final para
      -- bater centavo-a-centavo com o boleto da operadora.
      case
        when b.modelo_preco = 'flat' then
          round(b.valor_flat * (1 + b.iof_percentual), 2)
        else (
          select round(bfp.valor * (1 + b.iof_percentual), 2)
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
          -- Empresa paga valor equivalente ao benefício base na mesma faixa,
          -- também incluindo IOF da operadora (base é sempre da mesma
          -- operadora que o produto "upgrade").
          coalesce((
            select round(bfp.valor * (1 + ct.iof_percentual), 2)
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
          when d.id is null then 0
          when b.modelo_preco = 'flat' then
            round(b.valor_flat * (1 + b.iof_percentual), 2)
          else (
            select round(bfp.valor * (1 + b.iof_percentual), 2)
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
    crt.percentual_empresa_titular,
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
