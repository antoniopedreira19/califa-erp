-- =============================================================================
-- A folha do mês seguinte nasce sozinha, em rascunho (decisão 218)
-- =============================================================================
-- Pedido do Tiago em 27/10/2026: "a folha do mês seguinte nasce em rascunho
-- sozinha com a antecedência das recorrências". Autorizou mexer no código
-- da frente do Antonio para isso ("Pode alterar você [...] mesmo sendo
-- código do Antonio").
--
-- 1. `gerar_folha_da_competencia(tenant, ano, mes)`: a geração que o botão
--    "Gerar folha" do RH fazia no TypeScript (`rh/folhas/actions.ts`,
--    `gerarFolha`), passada para o banco sem mudar a regra, para o botão e a
--    rotina diária usarem a mesma. Entra o PJ, o MEI e a parte Recibo do
--    CLT com recibo que esteve ativo em algum dia da competência; o CLT, o
--    estágio e o sócio continuam vindo do PDF da contabilidade. Pula quem já
--    tem linha da California na competência, quem não tem salário vigente,
--    quem não tem alocação vigente e quem usa o rateio da empresa sem
--    rateio no ano. A alocação "toda a empresa" se expande pelo rateio da
--    empresa no ano; só entra regional com percentual acima de zero, como o
--    comentário do TypeScript já dizia (a tabela recusa alocação com 0%).
--    `security invoker`: chamada pelo botão, roda com a RLS de quem clicou,
--    como antes. Tudo numa transação: a soma 100 das alocações é conferida
--    no fim, e se falhar nada fica (antes, o TypeScript apagava à mão).
-- 2. `gerar_folhas_automaticas(p_hoje)`: roda todo dia às 06:00 UTC (03:00
--    em Brasília) pelo pg_cron. A competência nasce quando o pagamento dela
--    (dia 03 do mês seguinte, a mesma data da "Folha prevista" do fluxo e
--    do título da aprovação) cai dentro da antecedência das recorrências
--    (`recorrencia_antecedencia_dias()`, 30 dias): a folha 11/2026 nasce em
--    03/11/2026. Nasce uma vez: se a competência já tem linha de salário da
--    California (gerada pelo botão, por exemplo), a rotina não mexe; quem
--    entrar depois entra pelo botão, como hoje. Fica na auditoria como
--    `folha.gerada`, sem autor e com `automatica: true`.
-- =============================================================================

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
  v_primeiro   date := make_date(p_ano, p_mes, 1);
  v_ultimo     date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_criado_por uuid := (select auth.uid());
  v_candidatos integer;
  v_criadas    integer := 0;
  v_sem_sal    text[] := '{}';
  v_sem_aloc   text[] := '{}';
  v_sem_rat    text[] := '{}';
  v_folha_id   uuid;
  r            record;
begin
  -- Passo 1: quem entra (PJ, MEI e a parte Recibo do CLT com recibo).
  select count(*) into v_candidatos
    from colaboradores c
   where c.tenant_id = p_tenant_id
     and c.tipo_contratacao in ('pj', 'mei', 'clt_recibo')
     and c.data_admissao <= v_ultimo
     and (c.status = 'ativo' or c.data_encerramento >= v_primeiro);

  -- Passos 2 a 4: quem ainda não tem linha da California, com salário e
  -- alocação vigentes.
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
         select 1
           from folhas_pagamento f
          where f.tenant_id = p_tenant_id
            and f.competencia_ano = p_ano
            and f.competencia_mes = p_mes
            and f.origem = 'california'
            and f.colaborador_id = c.id
       )
     order by c.nome
  loop
    if not r.tem_salario or r.salario is null then
      v_sem_sal := v_sem_sal || r.nome;
      continue;
    end if;
    if not r.tem_alocacao then
      v_sem_aloc := v_sem_aloc || r.nome;
      continue;
    end if;
    if r.usa_rateio_empresa then
      if not exists (
        select 1
          from empresas_rateios_regionais er
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

    -- Passo 5: a linha, em rascunho, da California.
    insert into folhas_pagamento (
      tenant_id, colaborador_id, competencia_ano, competencia_mes,
      salario_base, status, origem, created_by
    ) values (
      p_tenant_id, r.id, p_ano, p_mes,
      r.salario, 'rascunho', 'california', v_criado_por
    )
    returning id into v_folha_id;

    -- Passo 6: o retrato da alocação (a regional, ou o rateio da empresa).
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
    'pulados_sem_rateio', to_jsonb(v_sem_rat)
  );
end;
$$;

revoke all on function public.gerar_folha_da_competencia(uuid, integer, integer) from public, anon;
grant execute on function public.gerar_folha_da_competencia(uuid, integer, integer) to authenticated;

comment on function public.gerar_folha_da_competencia(uuid, integer, integer) is
  'Gera a folha da California (PJ, MEI e Recibo do CLT com recibo) de uma competência, em rascunho. Idempotente por colaborador. Usada pelo botão "Gerar folha" do RH e pela rotina diária (decisão 218).';

create or replace function public.gerar_folhas_automaticas(p_hoje date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje   date := coalesce(p_hoje, public.hoje_em_sao_paulo());
  v_limite date := coalesce(p_hoje, public.hoje_em_sao_paulo()) + public.recorrencia_antecedencia_dias();
  v_tenant uuid;
  v_comp   date;
  v_ano    integer;
  v_mes    integer;
  v_res    jsonb;
  v_total  integer := 0;
begin
  -- A soma 100 das alocações é conferida no fim de cada comando, e não no
  -- fim da transação: a competência que falhar volta sozinha, com o aviso,
  -- sem levar as outras.
  set constraints public.trg_folha_alocacao_soma_100 immediate;

  for v_tenant in select t.id from tenants t order by t.id loop
    for v_comp in
      select m::date
        from generate_series(date_trunc('month', v_hoje), date_trunc('month', v_limite), interval '1 month') m
    loop
      -- O pagamento da competência é o dia 03 do mês seguinte.
      continue when (v_comp + interval '1 month 2 days')::date > v_limite;

      v_ano := extract(year from v_comp)::integer;
      v_mes := extract(month from v_comp)::integer;

      -- Nasce uma vez: competência com linha de salário da California fica
      -- como está.
      continue when exists (
        select 1
          from folhas_pagamento f
         where f.tenant_id = v_tenant
           and f.competencia_ano = v_ano
           and f.competencia_mes = v_mes
           and f.origem = 'california'
           and f.tipo = 'salario'
      );

      begin
        v_res := public.gerar_folha_da_competencia(v_tenant, v_ano, v_mes);
        if (v_res->>'criadas')::integer > 0 then
          insert into audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
          values (
            v_tenant, null, 'folha.gerada', 'folha', to_char(v_comp, 'YYYY-MM'),
            v_res || jsonb_build_object(
              'ano', v_ano,
              'mes', v_mes,
              'origem', 'california',
              'tipos_incluidos', jsonb_build_array('pj', 'mei', 'clt_recibo'),
              'automatica', true
            )
          );
          v_total := v_total + (v_res->>'criadas')::integer;
        end if;
      exception when others then
        raise warning 'gerar_folhas_automaticas: folha %/% do tenant % não gerada: %', v_mes, v_ano, v_tenant, sqlerrm;
      end;
    end loop;
  end loop;

  return v_total;
end;
$$;

revoke all on function public.gerar_folhas_automaticas(date) from public, anon, authenticated;

comment on function public.gerar_folhas_automaticas(date) is
  'Rotina diária (pg_cron): gera em rascunho a folha da competência cujo pagamento (dia 03 do mês seguinte) cai dentro de recorrencia_antecedencia_dias(), se ela ainda não tem linha de salário da California (decisão 218).';

-- Mesmo horário das outras rotinas: 06:00 UTC = 03:00 em Brasília. Nome
-- repetido atualiza o job, então rodar a migration de novo é seguro.
select cron.schedule(
  'gerar-folhas-automaticas',
  '0 6 * * *',
  $$select public.gerar_folhas_automaticas();$$
);
