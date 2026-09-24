-- =============================================================================
-- A errata comum do job grava numa transação só (Tiago, 24/09/2026)
-- =============================================================================
--
-- `registrarErrata` (app/(app)/jobs/[jobId]/realizado/actions-errata.ts)
-- gravava em sete chamadas separadas: a errata no histórico, as linhas
-- novas (com a âncora de realizado), os itens da errata, as linhas
-- alteradas, as removidas, o BV que perdeu a razão de existir e, por fim,
-- os números do job com a revisão da abertura. Cada falha no meio tinha o
-- seu "desfazer" manual, e as do fim não tinham nenhum: o histórico dizia
-- que a linha mudou e ela não mudou ("Errata registrada, mas o item X não
-- foi atualizado. Avise o suporte"), ou a linha mudou e o faturamento
-- previsto e a revisão não. A errata de SAVE já grava tudo de uma vez
-- desde a 099.
--
-- `registrar_errata_do_job` faz as mesmas gravações, na mesma ordem, numa
-- transação: ou tudo, ou nada. A action continua fazendo as conferências
-- (travas de PP, BV, save, A · Repasse, remoção) e as contas (antes e
-- depois como o financeiro vê); a função só grava o que recebe.
--
-- SECURITY INVOKER de propósito: roda como quem chama, com as MESMAS
-- policies de RLS que a action usava pelo cliente do usuário, e com as
-- travas de banco valendo (`save_trava_linha_job`, `chk_jio_linha_vermelha_
-- zerada`…). Uma trava que dispare no meio desfaz a errata inteira.
--
-- Payload (jsonb):
--   errata      {titulo, custo_orcado_antes, custo_orcado_depois,
--                valor_job_antes, valor_job_depois,
--                faturamento_previsto_antes, faturamento_previsto_depois}
--   novas       [{chave, grupo_id, ordem, item, tipo_custo, linha_vermelha,
--                 valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
--                 valor_unitario_planejado, quantidade_planejada,
--                 dias_meses_planejado}]
--   itens       [colunas de jobs_erratas_itens, com `job_item_orcado_id`
--                ou `chave_nova` (a linha nova criada aqui)]
--   alteradas   [{id, tipo_custo, valor_unitario_orcado, quantidade_orcada,
--                 dias_meses_orcado, valor_unitario_planejado,
--                 quantidade_planejada, dias_meses_planejado}]
--   removidas   [id, ...]
--   bv_cancelar [job_item_orcado_id, ...]  (BV "a negociar" dessas linhas)
--   espelhos    {valor_total, faturamento_previsto, faturamento_save_previsto}
--   devolve_ao_mural boolean
--
-- Devolve {errata_id, bvs_cancelados: [{id, valor, job_item_orcado_id}]}.
-- Nenhum dado muda nesta migration.
-- =============================================================================

create or replace function public.registrar_errata_do_job(p_job_id uuid, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
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
begin
  select j.id, j.tenant_id, j.abertura_em_revisao
    into v_job
    from public.jobs j
   where j.id = p_job_id
   for update;
  if not found then
    raise exception 'Job não encontrado.';
  end if;

  -- ---- A errata ----
  insert into public.jobs_erratas (
    tenant_id, job_id, titulo,
    custo_orcado_antes, custo_orcado_depois,
    valor_job_antes, valor_job_depois,
    faturamento_previsto_antes, faturamento_previsto_depois,
    created_by
  ) values (
    v_job.tenant_id, p_job_id, e->>'titulo',
    (e->>'custo_orcado_antes')::numeric, (e->>'custo_orcado_depois')::numeric,
    (e->>'valor_job_antes')::numeric, (e->>'valor_job_depois')::numeric,
    (e->>'faturamento_previsto_antes')::numeric, (e->>'faturamento_previsto_depois')::numeric,
    v_uid
  )
  returning id into v_errata_id;

  -- ---- Linhas novas, com a âncora de realizado ----
  for v_nova in select * from jsonb_array_elements(coalesce(p->'novas', '[]'::jsonb))
  loop
    insert into public.jobs_itens_orcado (
      tenant_id, job_id, item_versao_id, errata_origem_id, linha_vermelha,
      grupo_id, ordem, item, tipo_custo,
      valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
      valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
    ) values (
      v_job.tenant_id, p_job_id, null, v_errata_id, (v_nova->>'linha_vermelha')::boolean,
      (v_nova->>'grupo_id')::uuid, (v_nova->>'ordem')::integer, v_nova->>'item',
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

  -- ---- Correções ----
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
       and job_id = p_job_id;
    if not found then
      raise exception 'Uma das linhas alteradas não pertence a este job.';
    end if;
  end loop;

  -- ---- Remoções (por último: a errata já guarda o nome da linha) ----
  delete from public.jobs_itens_orcado o
   where o.job_id = p_job_id
     and o.id in (select (x #>> '{}')::uuid
                    from jsonb_array_elements(coalesce(p->'removidas', '[]'::jsonb)) x);

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

  return jsonb_build_object('errata_id', v_errata_id, 'bvs_cancelados', v_bvs);
end;
$$;

revoke all on function public.registrar_errata_do_job(uuid, jsonb) from public, anon;
grant execute on function public.registrar_errata_do_job(uuid, jsonb) to authenticated;

comment on function public.registrar_errata_do_job(uuid, jsonb) is
  'Errata comum do job numa transação (24/09/2026): errata, linhas novas com âncora, itens, alteradas, removidas, BV cancelado, números do job e revisão da abertura. SECURITY INVOKER: valem a RLS e as travas de quem chama.';
