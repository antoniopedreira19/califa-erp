-- Decisão 150 (07/10/2026), entrega 1: a errata cancela a linha em vez de
-- apagá-la, e não mexe mais no planejado.
--
-- Por quê: o planejado do job passou a ser o da ABERTURA (decisão do Tiago
-- em 07/10/2026). Uma linha apagada levava junto o custo planejado dela, e
-- o resultado planejado subia sem nada ter mudado no plano. Cancelada, a
-- linha fica na planilha com o orçado zerado e o planejado intacto.
--
-- O que muda:
--   1. `jobs_itens_orcado` ganha a marca da linha cancelada: quando, quem e
--      por qual errata. Linha cancelada tem orçado zero (o banco cobra).
--   2. `registrar_errata_do_job` aceita `canceladas`: zera o unitário
--      orçado, grava a marca e dá as PPs da linha por concluídas — linha
--      cancelada não recebe PP, e sem o marco ela travaria o encerramento
--      e o "Concluir PPs" para sempre (decisão 052).
--   3. A correção de uma linha já cancelada é recusada.
--
-- O que fica de fora, de propósito:
--   - `removidas` continua apagando a linha, como antes: é o caminho de uma
--     aba aberta antes do deploy. A tela nova só manda `canceladas`.
--   - O planejado enviado nas `alteradas` continua sendo gravado como
--     veio: quem passa a mandar sempre o planejado atual é a action
--     (`planejadoDaErrata`), e o trigger tem a última palavra em save e no
--     Interno.
--   - Reativar uma linha cancelada depois de confirmada não existe: dentro
--     da errata em edição, "Reativar" só desfaz o rascunho.

alter table public.jobs_itens_orcado
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por uuid,
  add column if not exists cancelada_errata_id uuid
    references public.jobs_erratas(id) on delete set null;

comment on column public.jobs_itens_orcado.cancelada_em is
  'Decisão 150: linha cancelada por errata. Fica na planilha com o orçado zerado; o planejado da abertura continua contando. Não recebe PP nem BV.';
comment on column public.jobs_itens_orcado.cancelada_por is
  'Decisão 150: quem registrou a errata que cancelou a linha (auth.uid()).';
comment on column public.jobs_itens_orcado.cancelada_errata_id is
  'Decisão 150: a errata que cancelou a linha.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_jio_cancelada_zerada'
       and conrelid = 'public.jobs_itens_orcado'::regclass
  ) then
    alter table public.jobs_itens_orcado
      add constraint chk_jio_cancelada_zerada
      check (cancelada_em is null or valor_unitario_orcado = 0);
  end if;
end $$;

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

  -- ---- Cancelamentos (decisão 150) ----
  -- O orçado vai a zero e o planejado fica: é o planejado da abertura, e
  -- ele continua contando no resultado planejado. As PPs da linha ficam
  -- dadas por concluídas — ela não recebe mais nenhuma.
  for v_id in
    select (x #>> '{}')::uuid
      from jsonb_array_elements(coalesce(p->'canceladas', '[]'::jsonb)) x
  loop
    update public.jobs_itens_orcado
       set valor_unitario_orcado = 0,
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
$function$;
