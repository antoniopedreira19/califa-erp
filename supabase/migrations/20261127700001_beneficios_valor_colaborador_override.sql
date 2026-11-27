-- Caso excepcional: override do desconto em folha de um vínculo específico.
--
-- Modelo: 2 colunas aditivas em colaborador_beneficio. Quando
-- valor_colaborador_override é preenchido, fn_beneficios_custo_mensal
-- usa esse valor em vez do cálculo pelo rateio padrão. O valor_integral
-- (cobrado da operadora) continua vindo da tabela; o override só muda a
-- repartição interna entre California e colaborador:
--
--   integral     = da tabela (ex: 688,34)
--   colaborador  = override quando existir (ex: 100,00)
--   empresa      = integral - colaborador (ex: 588,34)
--
-- Motivo é obrigatório junto com o valor (check constraint) pra o override
-- nao virar divida invisivel. Mudanca de valor fica em audit_events, feita
-- pela server action.

begin;

alter table public.colaborador_beneficio
  add column valor_colaborador_override numeric(10, 2) null,
  add column override_motivo text null;

alter table public.colaborador_beneficio
  add constraint chk_cb_override_tem_motivo
  check (
    (valor_colaborador_override is null and override_motivo is null)
    or (valor_colaborador_override is not null and override_motivo is not null
        and length(trim(override_motivo)) > 0
        and valor_colaborador_override >= 0)
  );

comment on column public.colaborador_beneficio.valor_colaborador_override is
  'Quando preenchido, substitui o desconto em folha calculado pelo rateio. Guarda o valor TOTAL (titular + dependentes) que o colaborador paga neste benefício. empresa = integral - override. NULL = segue o cálculo padrão.';
comment on column public.colaborador_beneficio.override_motivo is
  'Justificativa obrigatória quando o override está ativo. Visível no card do vínculo e no breakdown do mês.';

-- fn_beneficios_custo_mensal: quando override existe, substitui o desconto do
-- colaborador e recalcula a parte empresa como integral - override.

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
  valor_desconto_folha_total numeric,
  valor_desconto_padrao numeric,
  tem_override boolean,
  override_motivo text
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
      va.valor_colaborador_override,
      va.override_motivo,
      b.nome as beneficio_nome,
      b.tipo as beneficio_tipo,
      b.modelo_preco,
      b.valor_flat,
      b.percentual_empresa_titular,
      b.iof_percentual,
      b.beneficio_base_id,
      extract(year from age(v_data_competencia, c.data_nascimento))::int as idade_titular,
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
          coalesce((
            select round(bfp.valor * (1 + ct.iof_percentual), 2)
              from public.beneficio_faixas_preco bfp
             where bfp.beneficio_id = ct.beneficio_base_id
               and ct.idade_titular >= bfp.idade_min
               and (bfp.idade_max is null or ct.idade_titular <= bfp.idade_max)
             limit 1
          ), 0)
      end as valor_empresa_titular_calculado
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
  ),
  consolidado as (
    select
      crt.vinculo_id,
      crt.beneficio_id,
      crt.beneficio_nome,
      crt.beneficio_tipo,
      crt.modo_custeio,
      crt.percentual_empresa_titular,
      crt.idade_titular,
      crt.valor_integral_titular,
      coalesce(cd.qtde_dependentes, 0) as qtde_dependentes,
      coalesce(cd.valor_dependentes_total, 0) as valor_dependentes_total,
      crt.valor_empresa_titular_calculado,
      (crt.valor_integral_titular - crt.valor_empresa_titular_calculado)
        + coalesce(cd.valor_dependentes_total, 0) as valor_desconto_calculado,
      crt.valor_colaborador_override,
      crt.override_motivo
    from calc_rateio_titular crt
    left join calc_dependentes cd on cd.vinculo_id = crt.vinculo_id
  )
  select
    cs.vinculo_id,
    cs.beneficio_id,
    cs.beneficio_nome,
    cs.beneficio_tipo,
    cs.modo_custeio,
    cs.percentual_empresa_titular,
    cs.idade_titular,
    cs.valor_integral_titular,
    -- valor_empresa_titular: quando tem override, empresa cobre (integral_total - override) - deps
    -- quando nao tem override, mantem o calculo do rateio
    case
      when cs.valor_colaborador_override is not null then
        greatest(
          (cs.valor_integral_titular + cs.valor_dependentes_total - cs.valor_colaborador_override)
          - cs.valor_dependentes_total,
          0
        )
      else cs.valor_empresa_titular_calculado
    end as valor_empresa_titular,
    -- valor_colaborador_titular: parte do override atribuida ao titular (o que sobrar dos deps)
    case
      when cs.valor_colaborador_override is not null then
        greatest(cs.valor_colaborador_override - cs.valor_dependentes_total, 0)
      else (cs.valor_integral_titular - cs.valor_empresa_titular_calculado)
    end as valor_colaborador_titular,
    cs.qtde_dependentes,
    cs.valor_dependentes_total,
    coalesce(cs.valor_colaborador_override, cs.valor_desconto_calculado) as valor_desconto_folha_total,
    cs.valor_desconto_calculado as valor_desconto_padrao,
    (cs.valor_colaborador_override is not null) as tem_override,
    cs.override_motivo
  from consolidado cs;
end;
$$;

grant execute on function public.fn_beneficios_custo_mensal(int, int, uuid)
  to authenticated;

commit;
