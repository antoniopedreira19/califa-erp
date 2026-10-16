-- =====================================================================
-- A errata volta a abrir o planejado e a linha cancelada sai da conta dos
-- dois lados — volta atrás da decisão 151 (15/10/2026)
--
-- Pedido do Tiago em 14/10/2026: "permitindo que uma errata possa incluir
-- um planejado a um novo item, apagar linhas (ou zerá-las), e fazendo com
-- que apenas o valor do job atual apareça no resumo, visto que erratas que
-- adicionam ou retiram itens geralmente são feitas antes do job ocorrer".
-- Respostas no mesmo dia: a linha que sai é ZERADA (não apagada); o
-- planejado abre na linha nova E na existente que a errata corrige.
--
-- No banco, só o cancelamento muda: `registrar_errata_do_job` zera também
-- o R$ Unit. do planejado da linha cancelada. O planejado que a errata
-- manda para a linha nova e para a alterada já era gravado como vinha —
-- quem o travava era a action (`planejadoDaErrata`), que muda no mesmo
-- commit. O resto da função é o da 20261009300001, sem alteração (corpo
-- conferido contra o banco pelo md5 antes de gerar este arquivo).
--
-- Sem backfill: nos jobs reais não há linha cancelada (conferido em
-- 15/10/2026); as canceladas de teste ficam com o planejado que tinham.
-- =====================================================================

create or replace function public.registrar_errata_do_job(p_job_id uuid, p jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job       record;
  v_uid       uuid := (select auth.uid());
  v_errata_id uuid;
  v_nova      jsonb;
  v_id        uuid;
  v_novas     jsonb := '{}'::jsonb;
  v_it        jsonb;
  v_alt       jsonb;
  v_bvs       jsonb;
  e           jsonb := p->'errata';
  -- Decisão 159: a errata pronta que este envio consome, e quem a preparou.
  v_pronta    uuid := nullif(p->>'errata_pronta_id', '')::uuid;
  v_preparada uuid;
  -- Decisão 162: a organização, e as chaves dos agrupamentos novos.
  est         jsonb := coalesce(p->'estrutura', '{}'::jsonb);
  v_grupos    jsonb := '{}'::jsonb;
  v_g         jsonb;
  v_gid       uuid;
  v_mes       uuid;
  v_ordem     integer;
begin
  -- Decisão 159: só o GP e o administrador registram errata. O produtor
  -- deixa a errata pronta para envio (`jobs_erratas_prontas`).
  if coalesce((select public.session_role())::text, '') not in ('administrador', 'gerente_producao') then
    raise exception 'Só o GP ou o administrador envia a errata ao financeiro. O produtor deixa a errata pronta para envio.';
  end if;

  select j.id, j.tenant_id, j.abertura_em_revisao, j.versao_orcamento_aprovada_id
    into v_job
    from public.jobs j
   where j.id = p_job_id
   for update;
  if not found then
    raise exception 'Job não encontrado.';
  end if;

  -- Decisão 159: com pronta parada no job, a errata nova é ELA. O "for
  -- update" do job acima já serializa dois envios da mesma pronta.
  if v_pronta is not null then
    select ep.preparada_por
      into v_preparada
      from public.jobs_erratas_prontas ep
     where ep.id = v_pronta
       and ep.job_id = p_job_id
       and ep.situacao = 'pronta'
     for update;
    if not found then
      raise exception 'A errata pronta para envio já foi enviada ou descartada. Recarregue a página.';
    end if;
  elsif exists (
    select 1
      from public.jobs_erratas_prontas ep
     where ep.job_id = p_job_id
       and ep.situacao = 'pronta'
  ) then
    raise exception 'Este job tem uma errata pronta para envio. Revise e envie essa errata, ou descarte-a antes de fazer outra.';
  end if;

  -- ---- A errata ----
  insert into public.jobs_erratas (
    tenant_id, job_id, titulo,
    custo_orcado_antes, custo_orcado_depois,
    valor_job_antes, valor_job_depois,
    faturamento_previsto_antes, faturamento_previsto_depois,
    created_by, preparada_por, estrutura
  ) values (
    v_job.tenant_id, p_job_id, e->>'titulo',
    (e->>'custo_orcado_antes')::numeric, (e->>'custo_orcado_depois')::numeric,
    (e->>'valor_job_antes')::numeric, (e->>'valor_job_depois')::numeric,
    (e->>'faturamento_previsto_antes')::numeric, (e->>'faturamento_previsto_depois')::numeric,
    v_uid, v_preparada,
    -- Decisão 162: o que mudou na organização, como o pop-up mostrou.
    case when jsonb_typeof(est->'resumo') = 'array' and jsonb_array_length(est->'resumo') > 0
         then est->'resumo' end
  )
  returning id into v_errata_id;

  -- ---- Decisão 162: agrupamentos renomeados ----
  -- Em dois passos, para dois agrupamentos poderem trocar de nome entre si.
  for v_g in select * from jsonb_array_elements(coalesce(est->'grupos_renomeados', '[]'::jsonb))
  loop
    update public.jobs_grupos
       set nome = '~' || id::text, updated_at = now()
     where id = (v_g->>'id')::uuid
       and job_id = p_job_id
       and removido_em is null;
    if not found then
      raise exception 'Um dos agrupamentos renomeados não é deste job.';
    end if;
  end loop;
  for v_g in select * from jsonb_array_elements(coalesce(est->'grupos_renomeados', '[]'::jsonb))
  loop
    update public.jobs_grupos
       set nome = btrim(v_g->>'nome'), updated_at = now()
     where id = (v_g->>'id')::uuid
       and job_id = p_job_id;
  end loop;

  -- ---- Decisão 162: agrupamentos novos ----
  -- A âncora tem de ser um agrupamento da versão aprovada deste job; o mês
  -- vem dela. Entram no fim da ordem.
  select coalesce(max(g.ordem), 0) into v_ordem
    from public.jobs_grupos g where g.job_id = p_job_id;
  for v_g in select * from jsonb_array_elements(coalesce(est->'grupos_novos', '[]'::jsonb))
  loop
    select v.mes_id into v_mes
      from public.versoes_orcamento_grupos v
     where v.id = (v_g->>'ancora')::uuid
       and v.versao_orcamento_id = v_job.versao_orcamento_aprovada_id;
    if not found then
      raise exception 'Um dos agrupamentos novos não pertence à versão aprovada deste job.';
    end if;
    v_ordem := v_ordem + 1;
    insert into public.jobs_grupos (
      tenant_id, job_id, grupo_versao_id, mes_id, nome, ordem, criado_na_errata_id
    ) values (
      v_job.tenant_id, p_job_id, (v_g->>'ancora')::uuid, v_mes,
      btrim(v_g->>'nome'), v_ordem, v_errata_id
    )
    returning id into v_gid;
    v_grupos := v_grupos || jsonb_build_object(v_g->>'chave', v_gid);
  end loop;

  -- ---- Linhas novas, com a âncora de realizado ----
  -- Decisão 162: o agrupamento da linha é o do JOB (ou a chave de um novo);
  -- o gatilho `jio_grupo_do_job` põe a âncora em `grupo_id`.
  for v_nova in select * from jsonb_array_elements(coalesce(p->'novas', '[]'::jsonb))
  loop
    v_gid := case
      when v_grupos ? (v_nova->>'grupo_id') then (v_grupos->>(v_nova->>'grupo_id'))::uuid
      else (v_nova->>'grupo_id')::uuid
    end;
    -- A tela de antes desta decisão manda o agrupamento da VERSÃO: vale o
    -- do job que o copia. Fica enquanto houver aba aberta da versão antiga.
    if v_gid is not null and not exists (
      select 1 from public.jobs_grupos g where g.id = v_gid and g.job_id = p_job_id
    ) then
      select g.id into v_gid
        from public.jobs_grupos g
       where g.job_id = p_job_id
         and g.grupo_versao_id = v_gid
         and g.criado_na_errata_id is null
         and g.removido_em is null;
    end if;
    if v_gid is null then
      raise exception 'Uma das linhas novas veio sem agrupamento. Recarregue a página.';
    end if;
    insert into public.jobs_itens_orcado (
      tenant_id, job_id, item_versao_id, errata_origem_id, linha_vermelha,
      job_grupo_id, grupo_id, ordem, item, tipo_custo,
      valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
      valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
    ) values (
      v_job.tenant_id, p_job_id, null, v_errata_id, (v_nova->>'linha_vermelha')::boolean,
      v_gid,
      (select g.grupo_versao_id from public.jobs_grupos g where g.id = v_gid),
      (v_nova->>'ordem')::integer, v_nova->>'item',
      (v_nova->>'tipo_custo')::public.tipo_custo,
      (v_nova->>'valor_unitario_orcado')::numeric, (v_nova->>'quantidade_orcada')::numeric,
      (v_nova->>'dias_meses_orcado')::numeric,
      (v_nova->>'valor_unitario_planejado')::numeric, (v_nova->>'quantidade_planejada')::numeric,
      (v_nova->>'dias_meses_planejado')::numeric
    )
    returning id into v_id;

    insert into public.jobs_itens_realizado (
      tenant_id, job_id, item_id, job_item_orcado_id,
      valor_unitario_realizado, quantidade_realizada, dias_meses_realizado,
      created_by
    ) values (
      v_job.tenant_id, p_job_id, null, v_id, 0, 0, 0, v_uid
    );

    v_novas := v_novas || jsonb_build_object(v_nova->>'chave', v_id);
  end loop;

  -- ---- Itens da errata (o histórico) ----
  for v_it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb))
  loop
    insert into public.jobs_erratas_itens (
      tenant_id, errata_id, job_item_orcado_id, acao, linha_vermelha,
      grupo_id, item_nome, grupo_nome,
      tipo_custo_de, tipo_custo_para,
      valor_unitario_de, valor_unitario_para,
      quantidade_de, quantidade_para,
      dias_meses_de, dias_meses_para,
      total_de, total_para,
      valor_unitario_planejado_de, valor_unitario_planejado_para,
      quantidade_planejada_de, quantidade_planejada_para,
      dias_meses_planejado_de, dias_meses_planejado_para,
      total_planejado_de, total_planejado_para,
      efeito_valor_job, efeito_faturamento_previsto
    ) values (
      v_job.tenant_id, v_errata_id,
      case
        when v_it ? 'chave_nova' then (v_novas->>(v_it->>'chave_nova'))::uuid
        else nullif(v_it->>'job_item_orcado_id', '')::uuid
      end,
      (v_it->>'acao')::public.errata_acao,
      (v_it->>'linha_vermelha')::boolean,
      nullif(v_it->>'grupo_id', '')::uuid, v_it->>'item_nome', v_it->>'grupo_nome',
      nullif(v_it->>'tipo_custo_de', '')::public.tipo_custo,
      nullif(v_it->>'tipo_custo_para', '')::public.tipo_custo,
      (v_it->>'valor_unitario_de')::numeric, (v_it->>'valor_unitario_para')::numeric,
      (v_it->>'quantidade_de')::numeric, (v_it->>'quantidade_para')::numeric,
      (v_it->>'dias_meses_de')::numeric, (v_it->>'dias_meses_para')::numeric,
      (v_it->>'total_de')::numeric, (v_it->>'total_para')::numeric,
      (v_it->>'valor_unitario_planejado_de')::numeric, (v_it->>'valor_unitario_planejado_para')::numeric,
      (v_it->>'quantidade_planejada_de')::numeric, (v_it->>'quantidade_planejada_para')::numeric,
      (v_it->>'dias_meses_planejado_de')::numeric, (v_it->>'dias_meses_planejado_para')::numeric,
      (v_it->>'total_planejado_de')::numeric, (v_it->>'total_planejado_para')::numeric,
      (v_it->>'efeito_valor_job')::numeric, (v_it->>'efeito_faturamento_previsto')::numeric
    );
  end loop;

  -- ---- Correções (linha cancelada não se corrige) ----
  for v_alt in select * from jsonb_array_elements(coalesce(p->'alteradas', '[]'::jsonb))
  loop
    update public.jobs_itens_orcado
       set valor_unitario_orcado = (v_alt->>'valor_unitario_orcado')::numeric,
           quantidade_orcada = (v_alt->>'quantidade_orcada')::numeric,
           dias_meses_orcado = (v_alt->>'dias_meses_orcado')::numeric,
           tipo_custo = (v_alt->>'tipo_custo')::public.tipo_custo,
           valor_unitario_planejado = (v_alt->>'valor_unitario_planejado')::numeric,
           quantidade_planejada = (v_alt->>'quantidade_planejada')::numeric,
           dias_meses_planejado = (v_alt->>'dias_meses_planejado')::numeric,
           updated_at = now()
     where id = (v_alt->>'id')::uuid
       and job_id = p_job_id
       and cancelada_em is null;
    if not found then
      raise exception 'Uma das linhas alteradas não pertence a este job ou já foi cancelada.';
    end if;
  end loop;

  -- ---- Cancelamentos (decisão 151; revisão de 15/10/2026) ----
  -- O orçado E o planejado vão a zero (R$ Unit.; QT e D/M ficam, para a
  -- linha seguir legível): a linha sai da conta dos dois lados. Até
  -- 15/10/2026 o planejado ficava, porque era "o da abertura". As PPs da
  -- linha ficam dadas por concluídas — ela não recebe mais nenhuma.
  for v_id in
    select (x #>> '{}')::uuid
      from jsonb_array_elements(coalesce(p->'canceladas', '[]'::jsonb)) x
  loop
    update public.jobs_itens_orcado
       set valor_unitario_orcado = 0,
           valor_unitario_planejado = 0,
           cancelada_em = now(),
           cancelada_por = v_uid,
           cancelada_errata_id = v_errata_id,
           updated_at = now()
     where id = v_id
       and job_id = p_job_id
       and cancelada_em is null;
    if not found then
      raise exception 'Uma das linhas canceladas não pertence a este job ou já estava cancelada.';
    end if;

    update public.jobs_itens_realizado
       set pps_concluidas_em = coalesce(pps_concluidas_em, now()),
           pps_concluidas_por = coalesce(pps_concluidas_por, v_uid)
     where job_item_orcado_id = v_id
       and job_id = p_job_id;
  end loop;

  -- ---- Remoções (só de aba aberta antes da decisão 150) ----
  delete from public.jobs_itens_orcado o
   where o.job_id = p_job_id
     and o.id in (select (x #>> '{}')::uuid
                    from jsonb_array_elements(coalesce(p->'removidas', '[]'::jsonb)) x);

  -- ---- Decisão 162: a sequência das linhas ----
  -- Cada linha no agrupamento e na posição da tela. A linha nova vem pela
  -- chave. O gatilho confere que o agrupamento é do job, que está de pé e
  -- que a linha não muda de mês.
  for v_g in select * from jsonb_array_elements(coalesce(est->'ordem', '[]'::jsonb))
  loop
    v_id := case
      when v_g ? 'chave_nova' then (v_novas->>(v_g->>'chave_nova'))::uuid
      else (v_g->>'id')::uuid
    end;
    v_gid := case
      when v_grupos ? (v_g->>'grupo') then (v_grupos->>(v_g->>'grupo'))::uuid
      else (v_g->>'grupo')::uuid
    end;
    if v_id is null or v_gid is null then
      raise exception 'A nova ordem das linhas veio incompleta. Recarregue a página.';
    end if;
    update public.jobs_itens_orcado
       set job_grupo_id = v_gid,
           ordem = (v_g->>'ordem')::integer,
           updated_at = now()
     where id = v_id
       and job_id = p_job_id
       and (job_grupo_id is distinct from v_gid or ordem is distinct from (v_g->>'ordem')::integer);
    if not found and not exists (
      select 1 from public.jobs_itens_orcado o where o.id = v_id and o.job_id = p_job_id
    ) then
      raise exception 'Uma das linhas da nova ordem não pertence a este job.';
    end if;
  end loop;

  -- ---- Decisão 162: agrupamentos que ficaram vazios ----
  for v_gid in
    select (x #>> '{}')::uuid
      from jsonb_array_elements(coalesce(est->'grupos_removidos', '[]'::jsonb)) x
  loop
    if exists (select 1 from public.jobs_itens_orcado o where o.job_grupo_id = v_gid) then
      raise exception 'Um agrupamento marcado para sair ainda tem linhas. Recarregue a página.';
    end if;
    update public.jobs_grupos
       set removido_em = now(),
           removido_na_errata_id = v_errata_id,
           updated_at = now()
     where id = v_gid
       and job_id = p_job_id
       and removido_em is null;
    if not found then
      raise exception 'Um dos agrupamentos removidos não é deste job ou já tinha saído.';
    end if;
  end loop;

  -- Decisão 162: dois agrupamentos de pé com o mesmo nome no mesmo mês.
  if exists (
    select 1
      from public.jobs_grupos g
     where g.job_id = p_job_id
       and g.removido_em is null
     group by g.mes_id, lower(btrim(g.nome))
    having count(*) > 1
  ) then
    raise exception 'Já existe um agrupamento com esse nome neste job.';
  end if;

  -- ---- BV "a negociar" que perdeu a razão de existir ----
  with cancelados as (
    update public.itens_bv b
       set situacao = 'cancelado'
     where b.tenant_id = v_job.tenant_id
       and b.situacao = 'a_negociar'
       and b.job_item_orcado_id in (
             select (x #>> '{}')::uuid
               from jsonb_array_elements(coalesce(p->'bv_cancelar', '[]'::jsonb)) x)
    returning b.id, b.valor, b.job_item_orcado_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'valor', c.valor, 'job_item_orcado_id', c.job_item_orcado_id)), '[]'::jsonb)
    into v_bvs
    from cancelados c;

  -- ---- Números do job e a revisão da abertura ----
  update public.jobs j
     set valor_total = (p->'espelhos'->>'valor_total')::numeric,
         faturamento_previsto = (p->'espelhos'->>'faturamento_previsto')::numeric,
         faturamento_save_previsto = (p->'espelhos'->>'faturamento_save_previsto')::numeric,
         abertura_em_revisao = case
           when (p->>'devolve_ao_mural')::boolean then true
           else j.abertura_em_revisao end,
         -- "Desde" é a PRIMEIRA errata ainda não revisada (14/09/2026).
         abertura_revisao_desde = case
           when (p->>'devolve_ao_mural')::boolean and coalesce(v_job.abertura_em_revisao, false) = false
             then now()
           else j.abertura_revisao_desde end,
         abertura_revisao_errata_id = case
           when (p->>'devolve_ao_mural')::boolean then v_errata_id
           else j.abertura_revisao_errata_id end
   where j.id = p_job_id;

  -- Decisão 159: a pronta sai de cena junto com a errata que ela virou.
  if v_pronta is not null then
    update public.jobs_erratas_prontas
       set situacao = 'enviada',
           errata_id = v_errata_id,
           enviada_por = v_uid,
           enviada_em = now()
     where id = v_pronta;
  end if;

  return jsonb_build_object('errata_id', v_errata_id, 'bvs_cancelados', v_bvs);
end;
$function$;

revoke all on function public.registrar_errata_do_job(uuid, jsonb) from public, anon;
grant execute on function public.registrar_errata_do_job(uuid, jsonb) to authenticated;

comment on column public.jobs_itens_orcado.cancelada_em is
  'Quando a linha foi cancelada por errata (decisao 151). A linha fica na planilha com o orcado e, desde 15/10/2026, o planejado zerados; nao recebe PP, BV nem save.';
