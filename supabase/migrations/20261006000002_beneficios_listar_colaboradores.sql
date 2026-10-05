-- Migration: Benefícios — função de listagem para a tab Colaboradores (S3)
-- Plano: docs/modulos/rh/52-beneficios-plano-de-execucao.md
--
-- Função que agrega os vínculos ativos de cada colaborador ativo do tenant
-- numa única linha, com planos como jsonb, pra alimentar a tabela da UI.
-- Filtros opcionais por busca de nome, benefício específico e modo de custeio.
-- RLS do chamador vale (SECURITY INVOKER).

create or replace function public.fn_beneficios_listar_colaboradores(
  p_tenant_id uuid,
  p_ano int,
  p_mes int,
  p_busca text default null,
  p_beneficio_id uuid default null,
  p_modo public.beneficio_modo_custeio default null
)
returns table (
  colaborador_id uuid,
  nome text,
  tipo_contratacao text,
  planos_ativos jsonb,
  custo_empresa numeric,
  custo_colaborador numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with linhas as (
    select
      c.id as colab_id,
      c.nome as colab_nome,
      c.tipo_contratacao::text as tc,
      f.*
    from public.colaboradores c
    cross join lateral public.fn_beneficios_custo_mensal(p_ano, p_mes, c.id) f
    where c.tenant_id = p_tenant_id
      and c.status = 'ativo'
      and (p_busca is null or c.nome ilike '%' || p_busca || '%')
      and (p_beneficio_id is null or f.beneficio_id = p_beneficio_id)
      and (p_modo is null or f.modo_custeio = p_modo)
  ),
  colabs_sem_vinculo as (
    -- Mantém colaboradores sem benefício na lista quando não há filtro de benefício/modo
    select
      c.id as colab_id,
      c.nome as colab_nome,
      c.tipo_contratacao::text as tc
    from public.colaboradores c
    where c.tenant_id = p_tenant_id
      and c.status = 'ativo'
      and (p_busca is null or c.nome ilike '%' || p_busca || '%')
      and p_beneficio_id is null
      and p_modo is null
      and not exists (
        select 1 from public.colaborador_beneficio cb
         where cb.colaborador_id = c.id
           and cb.data_inicio <= (make_date(p_ano, p_mes, 1) + interval '1 month' - interval '1 day')::date
           and (cb.data_fim is null or cb.data_fim >= make_date(p_ano, p_mes, 1))
      )
  ),
  todos as (
    select
      colab_id,
      colab_nome,
      tc,
      beneficio_id,
      beneficio_nome,
      beneficio_tipo,
      valor_empresa_titular,
      valor_desconto_folha_total
    from linhas
    union all
    select
      colab_id,
      colab_nome,
      tc,
      null::uuid,
      null::text,
      null::public.beneficio_tipo,
      0::numeric,
      0::numeric
    from colabs_sem_vinculo
  )
  select
    colab_id,
    max(colab_nome),
    max(tc),
    coalesce(jsonb_agg(jsonb_build_object(
      'beneficio_id', beneficio_id,
      'nome', beneficio_nome,
      'tipo', beneficio_tipo
    )) filter (where beneficio_id is not null), '[]'::jsonb) as planos_ativos,
    coalesce(sum(valor_empresa_titular), 0) as custo_empresa,
    coalesce(sum(valor_desconto_folha_total), 0) as custo_colaborador
  from todos
  group by colab_id
  order by max(colab_nome);
$$;

grant execute on function public.fn_beneficios_listar_colaboradores(uuid, int, int, text, uuid, public.beneficio_modo_custeio)
  to authenticated;

comment on function public.fn_beneficios_listar_colaboradores(uuid, int, int, text, uuid, public.beneficio_modo_custeio) is
  'Lista colaboradores ativos do tenant com seus benefícios ativos na competência. Suporta filtros opcionais (busca por nome, benefício, modo). Usado pela tab Colaboradores de /rh/beneficios.';
