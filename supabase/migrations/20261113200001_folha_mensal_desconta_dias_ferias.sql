-- =============================================================================
-- Folha mensal desconta automaticamente os dias de férias do colaborador
-- =============================================================================
-- Até hoje: o `gerar_folha_da_competencia` gravava `salario_base = salario
-- integral`, sem olhar pra férias. Na CLT, se o colaborador tirou 16 dias de
-- férias em um mês de 30 dias, a folha mensal deve pagar só os 14 dias
-- trabalhados (14/30 do salário). O que se pagava a mais virava pagamento
-- duplicado dos dias de férias (que já foram pagos na folha de férias).
--
-- O que muda:
--
-- 1. `fn_dias_ferias_na_competencia(colab, ano, mes)`: função pura que
--    soma quantos dias de usufruto do colaborador caem dentro do mês,
--    olhando `colaboradores_ferias_lancamentos` com status in
--    ('aprovado', 'concluido'). Abono puro (avulso/excepcional) NÃO
--    desconta — a pessoa estava trabalhando, só vendeu dias. Pro
--    abono_combinado, desconta só (dias - dias_abono) que é a parte
--    efetivamente gozada.
--
-- 2. `gerar_folha_da_competencia`: antes do INSERT, chama a função nova
--    e calcula `salario_base = salario × (30 - dias_ferias) / 30`.
--    Retorna também um array `descontados` no JSON com os colaboradores
--    afetados, pra UI mostrar lista expansível.
--
-- 3. `fn_recalcular_folha_mensal_por_ferias(colab, ano, mes)`: função que
--    recalcula o `salario_base` de uma folha específica EM RASCUNHO.
--    Chamada pelo trigger abaixo. Se a folha não existe ou está fora do
--    status rascunho, não faz nada.
--
-- 4. Trigger em `colaboradores_ferias_lancamentos`: quando um lançamento
--    é inserido, atualizado ou deletado em status aprovado/concluído,
--    recalcula as folhas mensais em rascunho dos meses afetados.
--    Se a folha já foi enviada (status != rascunho), não mexe — a
--    aprovação de férias nesse caso vai gerar aviso na UI pro RH ajustar
--    manualmente.
-- =============================================================================

begin;

-- 1. Função pura que soma os dias de usufruto do colaborador na competência
create or replace function public.fn_dias_ferias_na_competencia(
  p_colaborador_id uuid,
  p_ano            integer,
  p_mes            integer
)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  with mes as (
    select
      make_date(p_ano, p_mes, 1)                          as primeiro,
      (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date as ultimo
  ),
  lancs as (
    select
      l.tipo,
      l.dias,
      l.dias_abono,
      l.data_inicio,
      l.data_fim
    from colaboradores_ferias_lancamentos l
    where l.colaborador_id = p_colaborador_id
      and l.status in ('aprovado', 'concluido')
      and l.tipo in ('usufruto', 'abono_combinado')
  )
  select coalesce(sum(dias_no_mes), 0)::integer
    from (
      select
        -- Dias de folga = dias total - dias de abono (0 pra usufruto puro).
        -- Pro abono_combinado, a parte abono não desconta (venda), só a folga.
        case
          when l.tipo = 'abono_combinado' then l.dias - l.dias_abono
          else l.dias
        end as dias_folga_total,
        -- Intervalo real do lançamento (podem atravessar o mês).
        l.data_inicio as ini_lanc,
        l.data_fim    as fim_lanc,
        -- Dias do lançamento que caem dentro da competência.
        greatest(
          0,
          (least(l.data_fim, m.ultimo) - greatest(l.data_inicio, m.primeiro) + 1)
        ) as dias_no_mes_integral
      from lancs l
      cross join mes m
    ) x,
    lateral (
      -- Pro abono_combinado, se o lançamento pega 2 meses, só a parte de
      -- folga desconta. Como a folga fica no início do bloco (depois o
      -- abono), uma aproximação razoável é proporcional: dias_folga_total ×
      -- (dias_no_mes / dias_total). Pra usufruto puro, dias_folga_total ==
      -- dias_no_mes_integral.
      select
        case
          when (x.fim_lanc - x.ini_lanc + 1) = 0 then 0
          else
            round(
              x.dias_no_mes_integral::numeric *
              x.dias_folga_total::numeric /
              (x.fim_lanc - x.ini_lanc + 1)::numeric
            )::integer
        end as dias_no_mes
    ) y;
$$;

revoke all on function public.fn_dias_ferias_na_competencia(uuid, integer, integer) from public, anon;
grant execute on function public.fn_dias_ferias_na_competencia(uuid, integer, integer) to authenticated;

comment on function public.fn_dias_ferias_na_competencia(uuid, integer, integer) is
  'Quantos dias de usufruto o colaborador teve dentro da competência (ano, mês). Soma de lançamentos aprovado/concluído, tipo usufruto ou abono_combinado (parte folga apenas). Abono puro não entra.';

-- 2. Atualiza gerar_folha_da_competencia pra descontar férias
create or replace function public.gerar_folha_da_competencia(
  p_tenant_id uuid,
  p_ano       integer,
  p_mes       integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_primeiro       date := make_date(p_ano, p_mes, 1);
  v_ultimo         date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_criado_por     uuid := (select auth.uid());
  v_candidatos     integer;
  v_criadas        integer := 0;
  v_sem_sal        text[] := '{}';
  v_sem_aloc       text[] := '{}';
  v_sem_rat        text[] := '{}';
  v_descontados    jsonb := '[]'::jsonb;
  v_folha_id       uuid;
  v_dias_ferias    integer;
  v_salario_final  numeric;
  r                record;
begin
  select count(*) into v_candidatos
    from colaboradores c
   where c.tenant_id = p_tenant_id
     and c.tipo_contratacao in ('pj', 'mei', 'clt_recibo')
     and c.data_admissao <= v_ultimo
     and (c.status = 'ativo' or c.data_encerramento >= v_primeiro);

  for r in
    select c.id,
           c.nome,
           s.colaborador_id is not null as tem_salario,
           case when c.tipo_contratacao = 'clt_recibo' then s.valor_recibo else s.valor end as salario,
           a.colaborador_id is not null as tem_alocacao,
           a.empresa_id,
           a.regional_id,
           a.usa_rateio_empresa
      from colaboradores c
      left join colaboradores_salarios s
        on s.colaborador_id = c.id and s.tenant_id = p_tenant_id and s.data_fim is null
      left join colaboradores_alocacoes a
        on a.colaborador_id = c.id and a.tenant_id = p_tenant_id and a.data_fim is null
     where c.tenant_id = p_tenant_id
       and c.tipo_contratacao in ('pj', 'mei', 'clt_recibo')
       and c.data_admissao <= v_ultimo
       and (c.status = 'ativo' or c.data_encerramento >= v_primeiro)
       and not exists (
         select 1 from folhas_pagamento f
          where f.tenant_id = p_tenant_id
            and f.colaborador_id = c.id
            and f.competencia_ano = p_ano
            and f.competencia_mes = p_mes
            and f.origem = 'california'
            and f.tipo = 'salario'
       )
  loop
    if not r.tem_salario or r.salario is null or r.salario <= 0 then
      v_sem_sal := v_sem_sal || r.nome;
      continue;
    end if;

    if not r.tem_alocacao then
      v_sem_aloc := v_sem_aloc || r.nome;
      continue;
    end if;

    if r.usa_rateio_empresa then
      if not exists (
        select 1 from empresas_rateios_regionais er
         where er.tenant_id = p_tenant_id
           and er.empresa_id = r.empresa_id
           and er.ano_vigencia = p_ano
           and er.percentual > 0
      ) then
        v_sem_rat := v_sem_rat || r.nome;
        continue;
      end if;
    elsif r.regional_id is null then
      v_sem_aloc := v_sem_aloc || r.nome;
      continue;
    end if;

    -- Dias de férias no mês e salário descontado
    v_dias_ferias := public.fn_dias_ferias_na_competencia(r.id, p_ano, p_mes);
    if v_dias_ferias > 0 then
      v_salario_final := round(r.salario * (30 - v_dias_ferias) / 30.0, 2);
      v_descontados := v_descontados || jsonb_build_object(
        'nome', r.nome,
        'dias_ferias', v_dias_ferias,
        'salario_original', r.salario,
        'salario_ajustado', v_salario_final
      );
    else
      v_salario_final := r.salario;
    end if;

    insert into folhas_pagamento (
      tenant_id, colaborador_id, competencia_ano, competencia_mes,
      salario_base, status, origem, created_by
    ) values (
      p_tenant_id, r.id, p_ano, p_mes,
      v_salario_final, 'rascunho', 'california', v_criado_por
    )
    returning id into v_folha_id;

    if r.usa_rateio_empresa then
      insert into folhas_pagamento_alocacoes (tenant_id, folha_id, empresa_id, regional_id, percentual)
      select p_tenant_id, v_folha_id, r.empresa_id, er.regional_id, er.percentual
        from empresas_rateios_regionais er
       where er.tenant_id = p_tenant_id
         and er.empresa_id = r.empresa_id
         and er.ano_vigencia = p_ano
         and er.percentual > 0;
    else
      insert into folhas_pagamento_alocacoes (tenant_id, folha_id, empresa_id, regional_id, percentual)
      values (p_tenant_id, v_folha_id, r.empresa_id, r.regional_id, 100);
    end if;

    v_criadas := v_criadas + 1;
  end loop;

  return jsonb_build_object(
    'criadas', v_criadas,
    'ja_existiam', v_candidatos - (v_criadas + cardinality(v_sem_sal) + cardinality(v_sem_aloc) + cardinality(v_sem_rat)),
    'pulados_sem_salario', to_jsonb(v_sem_sal),
    'pulados_sem_alocacao', to_jsonb(v_sem_aloc),
    'pulados_sem_rateio', to_jsonb(v_sem_rat),
    'descontados', v_descontados
  );
end;
$$;

revoke all on function public.gerar_folha_da_competencia(uuid, integer, integer) from public, anon;
grant execute on function public.gerar_folha_da_competencia(uuid, integer, integer) to authenticated;

comment on function public.gerar_folha_da_competencia(uuid, integer, integer) is
  'Gera a folha da California de uma competência, em rascunho, descontando automaticamente os dias de férias do mês. O JSON retornado traz "descontados" para a UI listar os colaboradores afetados.';

-- 3. Função pra recalcular o salario_base de UMA folha em rascunho.
-- Retorna true se recalculou, false se folha não está em rascunho ou não existe.
create or replace function public.fn_recalcular_folha_mensal_por_ferias(
  p_colaborador_id uuid,
  p_ano            integer,
  p_mes            integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folha_id       uuid;
  v_tenant_id      uuid;
  v_salario_base   numeric;
  v_salario_full   numeric;
  v_tipo_contr     tipo_contratacao;
  v_dias_ferias    integer;
  v_ultimo         date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
begin
  -- Pega a folha de salário California dessa competência que esteja em rascunho
  select f.id, f.tenant_id
    into v_folha_id, v_tenant_id
    from folhas_pagamento f
   where f.colaborador_id = p_colaborador_id
     and f.competencia_ano = p_ano
     and f.competencia_mes = p_mes
     and f.origem = 'california'
     and f.tipo = 'salario'
     and f.status = 'rascunho'
   limit 1;

  if v_folha_id is null then
    return false;
  end if;

  -- Salário base cheio vigente
  select
    case when c.tipo_contratacao = 'clt_recibo' then s.valor_recibo else s.valor end
    into v_salario_full
    from colaboradores c
    left join colaboradores_salarios s
      on s.colaborador_id = c.id and s.data_fim is null
   where c.id = p_colaborador_id;

  if v_salario_full is null or v_salario_full <= 0 then
    return false;
  end if;

  v_dias_ferias := public.fn_dias_ferias_na_competencia(p_colaborador_id, p_ano, p_mes);
  v_salario_base := round(v_salario_full * (30 - v_dias_ferias) / 30.0, 2);

  update folhas_pagamento
     set salario_base = v_salario_base,
         updated_at = now()
   where id = v_folha_id;

  return true;
end;
$$;

revoke all on function public.fn_recalcular_folha_mensal_por_ferias(uuid, integer, integer) from public, anon;
grant execute on function public.fn_recalcular_folha_mensal_por_ferias(uuid, integer, integer) to authenticated;

comment on function public.fn_recalcular_folha_mensal_por_ferias(uuid, integer, integer) is
  'Recalcula salario_base da folha California em rascunho descontando dias de usufruto no mês. Retorna false se a folha não existe ou já foi enviada.';

-- 4. Trigger: ao aprovar/concluir/editar/deletar lançamentos, atualiza as
-- folhas em rascunho dos meses afetados.
create or replace function public.fn_trg_ferias_recalc_folhas_mensais()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_colab_id    uuid;
  v_ini         date;
  v_fim         date;
  v_mes_atual   date;
  v_ano         integer;
  v_mes         integer;
begin
  -- Só reage a usufruto ou abono_combinado — abono puro não desconta.
  if tg_op = 'DELETE' then
    if old.tipo not in ('usufruto', 'abono_combinado') then return old; end if;
    if old.status not in ('aprovado', 'concluido') then return old; end if;
    v_colab_id := old.colaborador_id;
    v_ini := old.data_inicio;
    v_fim := old.data_fim;
  else
    if new.tipo not in ('usufruto', 'abono_combinado') then return new; end if;
    if new.status not in ('aprovado', 'concluido') then return new; end if;
    v_colab_id := new.colaborador_id;
    v_ini := new.data_inicio;
    v_fim := new.data_fim;
  end if;

  -- Itera pelos meses que o lançamento atravessa (geralmente 1, às vezes 2)
  v_mes_atual := date_trunc('month', v_ini)::date;
  while v_mes_atual <= v_fim loop
    v_ano := extract(year from v_mes_atual)::integer;
    v_mes := extract(month from v_mes_atual)::integer;
    perform public.fn_recalcular_folha_mensal_por_ferias(v_colab_id, v_ano, v_mes);
    v_mes_atual := (v_mes_atual + interval '1 month')::date;
  end loop;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

-- Dispara em INSERT (lançamento direto do RH), UPDATE de status/datas,
-- e DELETE (quando a aba Pendências apaga lançamentos).
drop trigger if exists trg_ferias_recalc_folhas_mensais on colaboradores_ferias_lancamentos;
create trigger trg_ferias_recalc_folhas_mensais
  after insert or update of status, data_inicio, data_fim, dias, dias_abono, tipo
            or delete
   on colaboradores_ferias_lancamentos
   for each row
   execute function public.fn_trg_ferias_recalc_folhas_mensais();

commit;
