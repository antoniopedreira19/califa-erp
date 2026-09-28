-- =====================================================================
-- Editar orçado do financeiro: só a previsão de recebimento acompanha, e
-- o encerramento trava a edição — decisão 115 (28/09/2026)
--
-- Duas respostas do Tiago, no mesmo dia, depois de ver a entrega:
--
-- 1. "É a previsão de recebimento que deve acompanhar, como vc colocou o
--    design." A curva de desembolso NÃO acompanha a alteração, nem no
--    serviço Interno — onde o planejado continua espelhando o orçado
--    (`planejado_espelha_orcado`), "até quando o financeiro o edita". Isto
--    desfaz o que a 20260928300002 tinha ligado: a função volta a não
--    tocar em `jobs_previsao_custo` nem em `jobs.custo_previsto_total`.
--    As colunas `curva_antes` / `curva_depois` ficam (remover coluna é
--    mudança destrutiva): só as 2 alterações de teste do TES-1009/26, de
--    28/09/2026, as preenchem, e nada mais escreve nelas.
--
-- 2. "Isso devemos travar, tanto faturar, quanto ao encerrar o job (desse
--    modo, sempre estará travado ao ser finalizado)." A edição vale até a
--    primeira nota OU o encerramento, o que vier antes. A action já
--    confere; a função passa a conferir também o status, como a última
--    porta: job aberto no financeiro (`data_abertura_financeiro`) e ainda
--    `aberto` ou `em_producao` (o `JOB_STATUS_ABERTO` do código). A trava da
--    nota segue na action, que sabe ler as notas do job pelos itens
--    (decisão 075); aqui fica a das parcelas do envio.
-- =====================================================================

comment on column public.jobs_alteracoes_financeiro.curva_antes is
  'Sem uso desde a 20260928300003: a curva de desembolso nao acompanha a alteracao do financeiro (Tiago, 28/09/2026). So as 2 alteracoes de teste do TES-1009/26 a preenchem.';
comment on column public.jobs_alteracoes_financeiro.curva_depois is
  'Sem uso desde a 20260928300003 — ver curva_antes.';

create or replace function public.registrar_alteracao_do_financeiro(p_job_id uuid, p jsonb)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job   record;
  v_uid   uuid := (select auth.uid());
  v_id    uuid;
  v_row   jsonb;
  a       jsonb := p->'alteracao';
begin
  select j.id, j.tenant_id, j.status, j.data_abertura_financeiro
    into v_job
    from public.jobs j
   where j.id = p_job_id
   for update;
  if not found then
    raise exception 'Job não encontrado.';
  end if;

  -- Até a primeira nota (a action confere) ou o encerramento (aqui também).
  if v_job.data_abertura_financeiro is null
     or v_job.status not in ('aberto', 'em_producao') then
    raise exception 'O orçado só é editado pelo financeiro com o job aberto: depois do encerramento, não muda mais.';
  end if;

  -- ---- O histórico ----
  insert into public.jobs_alteracoes_financeiro (
    tenant_id, job_id, motivo,
    custo_orcado_antes, custo_orcado_depois,
    valor_job_antes, valor_job_depois,
    faturamento_previsto_antes, faturamento_previsto_depois,
    recebimento_antes, recebimento_depois,
    impostos_antes, impostos_depois,
    envio_antes, envio_depois,
    created_by
  ) values (
    v_job.tenant_id, p_job_id, a->>'motivo',
    (a->>'custo_orcado_antes')::numeric, (a->>'custo_orcado_depois')::numeric,
    (a->>'valor_job_antes')::numeric, (a->>'valor_job_depois')::numeric,
    (a->>'faturamento_previsto_antes')::numeric, (a->>'faturamento_previsto_depois')::numeric,
    coalesce(a->'recebimento_antes', '[]'::jsonb), coalesce(a->'recebimento_depois', '[]'::jsonb),
    coalesce(a->'impostos_antes', '[]'::jsonb), coalesce(a->'impostos_depois', '[]'::jsonb),
    coalesce(a->'envio_antes', '[]'::jsonb), coalesce(a->'envio_depois', '[]'::jsonb),
    v_uid
  )
  returning id into v_id;

  for v_row in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb))
  loop
    insert into public.jobs_alteracoes_financeiro_itens (
      tenant_id, alteracao_id, job_item_orcado_id,
      item_nome, grupo_nome, mes, tipo_custo,
      valor_unitario_de, valor_unitario_para,
      quantidade_de, quantidade_para,
      dias_meses_de, dias_meses_para,
      total_de, total_para,
      efeito_valor_job, efeito_faturamento_previsto
    ) values (
      v_job.tenant_id, v_id, (v_row->>'job_item_orcado_id')::uuid,
      v_row->>'item_nome', v_row->>'grupo_nome', nullif(v_row->>'mes', '')::date,
      (v_row->>'tipo_custo')::public.tipo_custo,
      (v_row->>'valor_unitario_de')::numeric, (v_row->>'valor_unitario_para')::numeric,
      (v_row->>'quantidade_de')::numeric, (v_row->>'quantidade_para')::numeric,
      (v_row->>'dias_meses_de')::numeric, (v_row->>'dias_meses_para')::numeric,
      (v_row->>'total_de')::numeric, (v_row->>'total_para')::numeric,
      (v_row->>'efeito_valor_job')::numeric, (v_row->>'efeito_faturamento_previsto')::numeric
    );
  end loop;

  -- ---- As linhas: só os valores do orçado (P1) ----
  for v_row in select * from jsonb_array_elements(coalesce(p->'linhas', '[]'::jsonb))
  loop
    update public.jobs_itens_orcado
       set valor_unitario_orcado = (v_row->>'valor_unitario_orcado')::numeric,
           quantidade_orcada = (v_row->>'quantidade_orcada')::numeric,
           dias_meses_orcado = (v_row->>'dias_meses_orcado')::numeric,
           updated_at = now()
     where id = (v_row->>'id')::uuid
       and job_id = p_job_id
       and linha_vermelha = false;
    if not found then
      raise exception 'Uma das linhas alteradas não pertence a este job, ou é linha vermelha.';
    end if;
  end loop;

  -- ---- O envio, antes dos números do job (ver a 20260928300001) ----
  for v_row in select * from jsonb_array_elements(coalesce(p->'envios', '[]'::jsonb))
  loop
    update public.jobs_envio_faturamento
       set valor_faturado = (v_row->>'valor_faturado')::numeric
     where id = (v_row->>'id')::uuid
       and job_id = p_job_id;
    if not found then
      raise exception 'O envio para faturamento não pertence a este job.';
    end if;
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p->'parcelas_envio', '[]'::jsonb))
  loop
    -- Parcela que já virou nota não se reescreve (P4).
    if exists (
      select 1
        from public.faturamento_itens fi
        join public.faturamentos f on f.id = fi.faturamento_id
       where fi.envio_parcela_id = (v_row->>'id')::uuid
         and f.status = 'emitido'
    ) then
      raise exception 'Uma parcela do envio já virou nota emitida: o orçado desse faturamento não muda mais.';
    end if;
    update public.jobs_envio_faturamento_parcelas
       set valor = (v_row->>'valor')::numeric
     where id = (v_row->>'id')::uuid
       and job_id = p_job_id;
    if not found then
      raise exception 'Uma parcela do envio não pertence a este job.';
    end if;
  end loop;

  -- ---- As previsões da abertura (P3): recebimento e impostos ----
  for v_row in select * from jsonb_array_elements(coalesce(p->'recebimento', '[]'::jsonb))
  loop
    update public.jobs_previsao_recebimento
       set valor = (v_row->>'valor')::numeric
     where id = (v_row->>'id')::uuid
       and job_id = p_job_id;
    if not found then
      raise exception 'Uma parcela da previsão de recebimento não pertence a este job.';
    end if;
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p->'impostos', '[]'::jsonb))
  loop
    update public.jobs_previsao_impostos
       set valor = (v_row->>'valor')::numeric
     where id = (v_row->>'id')::uuid
       and job_id = p_job_id;
    if not found then
      raise exception 'Um recolhimento de imposto previsto não pertence a este job.';
    end if;
  end loop;

  -- ---- Os números do job ----
  update public.jobs
     set valor_total = (p->'espelhos'->>'valor_total')::numeric,
         faturamento_previsto = (p->'espelhos'->>'faturamento_previsto')::numeric,
         faturamento_save_previsto = (p->'espelhos'->>'faturamento_save_previsto')::numeric
   where id = p_job_id;

  return v_id;
end;
$function$;

revoke all on function public.registrar_alteracao_do_financeiro(uuid, jsonb) from public, anon;
grant execute on function public.registrar_alteracao_do_financeiro(uuid, jsonb) to authenticated;

comment on function public.registrar_alteracao_do_financeiro(uuid, jsonb) is
  'Grava uma alteracao do orcado feita pelo financeiro (decisao 115) numa transacao: historico, valores das linhas, envio sem nota, previsoes de recebimento e de impostos e os espelhos do job. Recusa job fora de aberto/em producao (o encerramento trava). SECURITY INVOKER.';
