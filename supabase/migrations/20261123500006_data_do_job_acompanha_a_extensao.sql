-- =====================================================================
-- Decisão 275 (pendência de 23/11/2026, Tiago: "corrija"): a data de fim
-- do job acompanha a extensão da veiculação.
-- ---------------------------------------------------------------------
-- Estender a veiculação para depois do fim previsto do job deixava o job
-- "terminando" antes da campanha (o calendário do financeiro e o período
-- do job mostravam a data antiga). Agora `registrar_alteracao_da_midia`
-- recebe `data_fim_prevista` (o último dia no ar da extensão, calculado no
-- servidor) e, na extensão, move `jobs.data_fim_prevista` para ele quando
-- vai além. Nunca encurta: encerrar antes não muda a data do job.
--
-- Mesma função da 20261123500004, com o bloco novo antes do `return`.
-- `create or replace` mantém assinatura e GRANTs; reafirmados abaixo.
-- =====================================================================

create or replace function public.registrar_alteracao_da_midia(p_job_id uuid, p jsonb)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_job       record;
  v_tipo      text := p->>'tipo';
  v_alt       uuid;
  v_l         jsonb;
  v_linha     record;
  v_mes_linha date;
  v_e         jsonb;
  v_base      record;
  v_mes       date;
  v_mes_id    uuid;
  v_ancora    uuid;
  v_grupo_job uuid;
  v_nova      uuid;
  v_ordem     integer;
  v_r         jsonb;
begin
  if v_uid is null
     or coalesce((select public.session_role())::text, '') not in ('administrador', 'gerente_producao') then
    raise exception 'Só o administrador ou o GP encerra ou estende a veiculação.';
  end if;
  if v_tipo not in ('encerramento', 'extensao') then
    raise exception 'Mudança da veiculação inválida.';
  end if;

  select j.id, j.tenant_id, j.status, j.versao_orcamento_aprovada_id, c.modelo_planilha
    into v_job
    from public.jobs j
    join public.orcamentos o on o.id = j.orcamento_id
    left join public.categorias_dominio c on c.id = o.categoria_id
   where j.id = p_job_id
   for update of j;
  if not found or not public.is_tenant_member(v_job.tenant_id) then
    raise exception 'Job não encontrado.';
  end if;
  if v_job.modelo_planilha is distinct from 'midia_off' then
    raise exception 'Só o job de Mídia Off encerra ou estende a veiculação.';
  end if;
  if v_job.status not in ('aberto', 'em_producao') then
    raise exception 'A veiculação só muda com o job aberto.';
  end if;

  insert into public.jobs_midia_alteracoes (tenant_id, job_id, tipo, data, motivo, created_by)
  values (
    v_job.tenant_id, p_job_id, v_tipo, (p->>'data')::date,
    nullif(btrim(coalesce(p->>'motivo', '')), ''), v_uid
  )
  returning id into v_alt;

  if v_tipo = 'encerramento' then
    if jsonb_typeof(p->'linhas') <> 'array' or jsonb_array_length(p->'linhas') = 0 then
      raise exception 'Nenhuma linha a encerrar.';
    end if;
    for v_l in select * from jsonb_array_elements(p->'linhas')
    loop
      select o.id, o.cancelada_em, m.mes
        into v_linha
        from public.jobs_itens_orcado o
        join public.versoes_orcamento_grupos g on g.id = o.grupo_id
        join public.versoes_orcamento_meses m on m.id = g.mes_id
       where o.id = (v_l->>'id')::uuid
         and o.job_id = p_job_id
       for update of o;
      if not found or v_linha.cancelada_em is not null then
        raise exception 'Uma das linhas não é deste job. Recarregue a página.';
      end if;
      v_mes_linha := v_linha.mes;
      if exists (select 1 from public.jobs_envio_faturamento e where e.job_id = p_job_id and e.mes = v_mes_linha)
         or exists (select 1 from public.novo_faturamento_do_job(p_job_id) n where n.mes = v_mes_linha) then
        raise exception 'Uma das linhas está em mês que já foi ao faturamento: ele não muda.';
      end if;

      update public.jobs_itens_orcado
         set quantidade_orcada = (v_l->>'quantidade_orcada')::numeric,
             dias_meses_orcado = (v_l->>'dias_meses_orcado')::numeric,
             insercoes_por_dia = case when jsonb_typeof(v_l->'insercoes_por_dia') = 'object' then v_l->'insercoes_por_dia' else null end,
             data_fim          = nullif(v_l->>'data_fim', '')::date,
             updated_at        = now()
       where id = v_linha.id;

      insert into public.jobs_midia_alteracoes_linhas (
        tenant_id, alteracao_id, job_item_orcado_id, antes, depois, negociado_antes, negociado_depois
      ) values (
        v_job.tenant_id, v_alt, v_linha.id, v_l->'antes', v_l->'depois',
        (v_l->>'negociado_antes')::numeric, (v_l->>'negociado_depois')::numeric
      );
    end loop;
  else
    v_e := p->'extensao';
    select o.*, g.meio as g_meio, g.formato as g_formato, g.forma_compra as g_forma, g.nome as g_nome,
           jg.nome as jg_nome
      into v_base
      from public.jobs_itens_orcado o
      join public.versoes_orcamento_grupos g on g.id = o.grupo_id
      left join public.jobs_grupos jg on jg.id = o.job_grupo_id
     where o.id = (v_e->>'base_id')::uuid
       and o.job_id = p_job_id
       and o.cancelada_em is null;
    if not found then
      raise exception 'A linha da extensão não é deste job. Recarregue a página.';
    end if;

    v_mes := (v_e->>'mes')::date;
    if v_mes is null or extract(day from v_mes) <> 1 then
      raise exception 'O mês da extensão veio sem data. Recarregue a página.';
    end if;
    if exists (select 1 from public.jobs_envio_faturamento e where e.job_id = p_job_id and e.mes = v_mes)
       or exists (select 1 from public.novo_faturamento_do_job(p_job_id) n where n.mes = v_mes) then
      raise exception 'O mês da extensão já foi ao faturamento: ele não muda.';
    end if;

    select m.id into v_mes_id
      from public.versoes_orcamento_meses m
     where m.versao_orcamento_id = v_job.versao_orcamento_aprovada_id
       and m.mes = v_mes;
    if v_mes_id is null then
      -- O mês entra no job, na versão aprovada, como na errata de mês novo
      -- (decisão 219).
      insert into public.versoes_orcamento_meses (tenant_id, versao_orcamento_id, mes, created_by)
      values (v_job.tenant_id, v_job.versao_orcamento_aprovada_id, v_mes, v_uid)
      returning id into v_mes_id;
    end if;

    -- O agrupamento do meio da linha no mês: o do job, se já existir.
    select jg.id into v_grupo_job
      from public.jobs_grupos jg
      join public.versoes_orcamento_grupos g on g.id = jg.grupo_versao_id
     where jg.job_id = p_job_id
       and jg.removido_em is null
       and jg.mes_id = v_mes_id
       and g.meio is not distinct from v_base.g_meio
       and g.formato is not distinct from v_base.g_formato
     order by jg.ordem
     limit 1;
    if v_grupo_job is null then
      insert into public.versoes_orcamento_grupos (
        tenant_id, versao_orcamento_id, nome, ordem, mes_id, meio, formato, forma_compra
      ) values (
        v_job.tenant_id, v_job.versao_orcamento_aprovada_id, v_base.g_nome,
        (select coalesce(max(g.ordem), 0) + 1 from public.versoes_orcamento_grupos g
          where g.versao_orcamento_id = v_job.versao_orcamento_aprovada_id),
        v_mes_id, v_base.g_meio, v_base.g_formato, v_base.g_forma
      )
      returning id into v_ancora;
      insert into public.jobs_grupos (tenant_id, job_id, grupo_versao_id, mes_id, nome, ordem, criado_por)
      values (
        v_job.tenant_id, p_job_id, v_ancora, v_mes_id, coalesce(v_base.jg_nome, v_base.g_nome),
        (select coalesce(max(jg.ordem), 0) + 1 from public.jobs_grupos jg where jg.job_id = p_job_id),
        v_uid
      )
      returning id into v_grupo_job;
    else
      select jg.grupo_versao_id into v_ancora from public.jobs_grupos jg where jg.id = v_grupo_job;
    end if;

    select coalesce(max(o.ordem), 0) + 1 into v_ordem
      from public.jobs_itens_orcado o
     where o.job_id = p_job_id and o.job_grupo_id = v_grupo_job;

    insert into public.jobs_itens_orcado (
      tenant_id, job_id, item_versao_id, errata_origem_id, linha_vermelha, criada_por,
      job_grupo_id, grupo_id, ordem, item, tipo_custo, categoria_id,
      valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
      valor_unitario_planejado, quantidade_planejada, dias_meses_planejado,
      fornecedor_id, praca, peca, formato, detalhe, unidade_periodo,
      valor_unitario_tabela, percentual_desconto,
      insercoes_por_dia, data_inicio, data_fim, midia_extensao_id
    ) values (
      v_job.tenant_id, p_job_id, null, null, false, v_uid,
      v_grupo_job, v_ancora, v_ordem, v_base.item, v_base.tipo_custo, v_base.categoria_id,
      v_base.valor_unitario_orcado,
      (v_e->>'quantidade_orcada')::numeric, (v_e->>'dias_meses_orcado')::numeric,
      (v_e->>'valor_unitario_planejado')::numeric, (v_e->>'quantidade_planejada')::numeric,
      (v_e->>'dias_meses_planejado')::numeric,
      v_base.fornecedor_id, v_base.praca, v_base.peca, v_base.formato, v_base.detalhe, v_base.unidade_periodo,
      v_base.valor_unitario_tabela, v_base.percentual_desconto,
      case when jsonb_typeof(v_e->'insercoes_por_dia') = 'object' then v_e->'insercoes_por_dia' else null end,
      nullif(v_e->>'data_inicio', '')::date, nullif(v_e->>'data_fim', '')::date, v_alt
    )
    returning id into v_nova;

    insert into public.jobs_itens_realizado (
      tenant_id, job_id, item_id, job_item_orcado_id,
      valor_unitario_realizado, quantidade_realizada, dias_meses_realizado, created_by
    ) values (v_job.tenant_id, p_job_id, null, v_nova, 0, 0, 0, v_uid);

    insert into public.jobs_midia_alteracoes_linhas (
      tenant_id, alteracao_id, job_item_orcado_id, antes, depois, negociado_antes, negociado_depois
    ) values (
      v_job.tenant_id, v_alt, v_nova, null, v_e->'depois', null, (v_e->>'negociado')::numeric
    );
  end if;

  -- ---- Os espelhos do job (o valor e o faturamento de hoje) ----
  if jsonb_typeof(p->'espelhos') = 'object' then
    update public.jobs
       set valor_total = (p->'espelhos'->>'valor_total')::numeric,
           faturamento_previsto = (p->'espelhos'->>'faturamento_previsto')::numeric,
           faturamento_save_previsto = coalesce((p->'espelhos'->>'faturamento_save_previsto')::numeric, faturamento_save_previsto)
     where id = p_job_id;
  end if;

  -- ---- As previsões do financeiro acompanham a diferença ----
  for v_r in select * from jsonb_array_elements(coalesce(p->'recebimento'->'atualizar', '[]'::jsonb))
  loop
    update public.jobs_previsao_recebimento
       set valor = (v_r->>'valor')::numeric, updated_at = now()
     where id = (v_r->>'id')::uuid and job_id = p_job_id;
    if not found then
      raise exception 'A previsão de recebimento não é deste job. Recarregue a página.';
    end if;
  end loop;
  for v_r in select * from jsonb_array_elements(coalesce(p->'recebimento'->'criar', '[]'::jsonb))
  loop
    insert into public.jobs_previsao_recebimento (tenant_id, job_id, ordem, data_prevista, valor, mes, created_by)
    values (
      v_job.tenant_id, p_job_id,
      (select coalesce(max(r.ordem), 0) + 1 from public.jobs_previsao_recebimento r where r.job_id = p_job_id),
      (v_r->>'data_prevista')::date, (v_r->>'valor')::numeric, nullif(v_r->>'mes', '')::date, v_uid
    );
  end loop;
  for v_r in select * from jsonb_array_elements(coalesce(p->'impostos'->'atualizar', '[]'::jsonb))
  loop
    update public.jobs_previsao_impostos
       set valor = (v_r->>'valor')::numeric, updated_at = now()
     where id = (v_r->>'id')::uuid and job_id = p_job_id;
    if not found then
      raise exception 'A previsão de impostos não é deste job. Recarregue a página.';
    end if;
  end loop;

  -- ---- A data do job acompanha a extensão (pendência de 23/11) ----
  -- Só empurra para frente: o fim previsto do job passa a ser o último dia
  -- da extensão quando ele vai além. Encerrar antes não mexe na data.
  if v_tipo = 'extensao' and nullif(p->>'data_fim_prevista', '') is not null then
    update public.jobs
       set data_fim_prevista = (p->>'data_fim_prevista')::date
     where id = p_job_id
       and (data_fim_prevista is null or data_fim_prevista < (p->>'data_fim_prevista')::date);
  end if;

  return jsonb_build_object('alteracao_id', v_alt, 'linha_id', v_nova);
end;
$$;

revoke all on function public.registrar_alteracao_da_midia(uuid, jsonb) from public, anon;
grant execute on function public.registrar_alteracao_da_midia(uuid, jsonb) to authenticated;
