-- Migration: fn_beneficios_listar_colaboradores v2 — adiciona qtde_dependentes
--
-- Mudança: coluna nova `qtde_dependentes` conta dependentes do colaborador
-- que estão incluídos em pelo menos um vínculo ativo na competência (distinct).
-- Como adicionar coluna muda o shape do RETURNS TABLE, é necessário DROP + CREATE.

drop function if exists public.fn_beneficios_listar_colaboradores(uuid, int, int, text, uuid, public.beneficio_modo_custeio);

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
  qtde_dependentes int,
  custo_empresa numeric,
  custo_colaborador numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with v_competencia as (
    select
      make_date(p_ano, p_mes, 1) as inicio,
      (make_date(p_ano, p_mes, 1) + interval '1 month' - interval '1 day')::date as fim
  ),
  linhas as (
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
           and cb.data_inicio <= (select fim from v_competencia)
           and (cb.data_fim is null or cb.data_fim >= (select inicio from v_competencia))
      )
  ),
  deps_por_colab as (
    -- Dependentes distintos do colaborador que estão em pelo menos 1 vínculo
    -- ativo na competência via colaborador_beneficio_dependente.
    select
      cb.colaborador_id as colab_id,
      count(distinct cbd.dependente_id)::int as qtde
    from public.colaborador_beneficio cb
    join public.colaborador_beneficio_dependente cbd
      on cbd.colaborador_beneficio_id = cb.id
    join public.dependentes d on d.id = cbd.dependente_id and d.ativo
    where cb.data_inicio <= (select fim from v_competencia)
      and (cb.data_fim is null or cb.data_fim >= (select inicio from v_competencia))
      and cbd.data_inicio <= (select fim from v_competencia)
      and (cbd.data_fim is null or cbd.data_fim >= (select inicio from v_competencia))
    group by cb.colaborador_id
  ),
  todos as (
    select colab_id, colab_nome, tc, beneficio_id, beneficio_nome, beneficio_tipo,
           valor_empresa_titular, valor_desconto_folha_total
      from linhas
    union all
    select colab_id, colab_nome, tc,
           null::uuid, null::text, null::public.beneficio_tipo,
           0::numeric, 0::numeric
      from colabs_sem_vinculo
  )
  select
    t.colab_id,
    max(t.colab_nome),
    max(t.tc),
    coalesce(jsonb_agg(jsonb_build_object(
      'beneficio_id', t.beneficio_id,
      'nome', t.beneficio_nome,
      'tipo', t.beneficio_tipo
    )) filter (where t.beneficio_id is not null), '[]'::jsonb) as planos_ativos,
    coalesce(max(d.qtde), 0) as qtde_dependentes,
    coalesce(sum(t.valor_empresa_titular), 0) as custo_empresa,
    coalesce(sum(t.valor_desconto_folha_total), 0) as custo_colaborador
  from todos t
  left join deps_por_colab d on d.colab_id = t.colab_id
  group by t.colab_id
  order by max(t.colab_nome);
$$;

grant execute on function public.fn_beneficios_listar_colaboradores(uuid, int, int, text, uuid, public.beneficio_modo_custeio)
  to authenticated;

comment on function public.fn_beneficios_listar_colaboradores(uuid, int, int, text, uuid, public.beneficio_modo_custeio) is
  'v2 (2026-10-05): adiciona qtde_dependentes — conta distinct de dep ativo em qualquer vinculo ativo do colaborador na competencia.';
