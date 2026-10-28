-- Decisão 224, revisão de 28/10/2026 — os parâmetros do job também mudam
-- depois da abertura.
--
-- Pedido do Tiago (28/10/2026): fee, impostos e as taxas do internacional,
-- e não só o câmbio, editáveis pelo financeiro depois da abertura, em
-- qualquer modelo, com as regras do "Editar orçado" (decisão 115): até a
-- primeira nota emitida ou o encerramento, e a previsão de recebimento, os
-- recolhimentos de imposto e o envio ainda sem nota acompanham.
--
-- Esta migration só tira de `registrar_alteracao_do_financeiro` a recusa
-- "depois da abertura só o câmbio muda" (20261027980001). A janela do job
-- (fila, aberto, em produção) continua a mesma; a trava da nota fica na
-- action, como no "Editar orçado", e a parcela do envio que virou nota
-- continua recusada pela função. O resto do corpo é o de 20261027980001.

create or replace function public.registrar_alteracao_do_financeiro(p_job_id uuid, p jsonb)
 returns uuid
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job     record;
  v_linha   record;
  v_uid     uuid := (select auth.uid());
  v_id      uuid;
  v_row     jsonb;
  v_tipo    public.tipo_custo;
  v_gravado public.tipo_custo;
  v_lanc    text;
  v_na_fila boolean;
  v_plan_u  numeric;
  v_plan_q  numeric;
  v_plan_d  numeric;
  a         jsonb := p->'alteracao';
  -- Decisão 224: os parâmetros do job.
  v_par     jsonb := p->'parametros'->'para';
  v_atual   record;
begin
  select j.id, j.tenant_id, j.status, j.data_abertura_financeiro
    into v_job
    from public.jobs j
   where j.id = p_job_id
   for update;
  if not found then
    raise exception 'Job não encontrado.';
  end if;

  -- Da fila da abertura até a primeira nota (a action confere) ou o
  -- encerramento (aqui também).
  if not (
       v_job.status = 'aguardando_abertura'
    or (v_job.data_abertura_financeiro is not null
        and v_job.status in ('aberto', 'em_producao'))
  ) then
    raise exception 'O orçado só é editado pelo financeiro na abertura do job ou com o job aberto: depois do encerramento, não muda mais.';
  end if;

  -- Na fila, o job ainda não abriu: a edição é parte do valor inicial
  -- (revisão de 13/10/2026) e o planejado também se edita (14/10/2026).
  v_na_fila := v_job.status = 'aguardando_abertura';

  -- ---- Os parâmetros (decisão 224): na fila e com o job aberto, até o
  --      encerramento (a janela de cima). A trava da primeira nota fica na
  --      action, como a do orçado; a parcela do envio que virou nota é
  --      recusada aqui embaixo (P4).
  if v_par is not null then
    select * into v_atual from public.vw_parametros_do_job where job_id = p_job_id;
    if not found then
      raise exception 'O job não tem versão aprovada: não há parâmetros para alterar.';
    end if;

    insert into public.jobs_parametros (
      job_id, tenant_id,
      percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs,
      moeda_estrangeira, cambio_cotacao, cambio_compra, cambio_venda, cambio_data,
      percentual_veiculo, base_honorarios, updated_by
    ) values (
      p_job_id, v_job.tenant_id,
      (v_par->>'percentual_honorarios')::numeric, (v_par->>'percentual_imposto')::numeric,
      (v_par->>'percentual_int_taxes')::numeric, (v_par->>'int_transaction_costs')::numeric,
      nullif(v_par->>'moeda_estrangeira', ''), (v_par->>'cambio_cotacao')::numeric,
      (v_par->>'cambio_compra')::numeric, (v_par->>'cambio_venda')::numeric,
      nullif(v_par->>'cambio_data', '')::date,
      (v_par->>'percentual_veiculo')::numeric, v_par->>'base_honorarios', v_uid
    )
    on conflict (job_id) do update set
      percentual_honorarios = excluded.percentual_honorarios,
      percentual_imposto    = excluded.percentual_imposto,
      percentual_int_taxes  = excluded.percentual_int_taxes,
      int_transaction_costs = excluded.int_transaction_costs,
      moeda_estrangeira     = excluded.moeda_estrangeira,
      cambio_cotacao        = excluded.cambio_cotacao,
      cambio_compra         = excluded.cambio_compra,
      cambio_venda          = excluded.cambio_venda,
      cambio_data           = excluded.cambio_data,
      percentual_veiculo    = excluded.percentual_veiculo,
      base_honorarios       = excluded.base_honorarios,
      updated_by            = excluded.updated_by,
      updated_at            = now();
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
    parametros,
    created_by
  ) values (
    v_job.tenant_id, p_job_id, a->>'motivo',
    (a->>'custo_orcado_antes')::numeric, (a->>'custo_orcado_depois')::numeric,
    (a->>'valor_job_antes')::numeric, (a->>'valor_job_depois')::numeric,
    (a->>'faturamento_previsto_antes')::numeric, (a->>'faturamento_previsto_depois')::numeric,
    coalesce(a->'recebimento_antes', '[]'::jsonb), coalesce(a->'recebimento_depois', '[]'::jsonb),
    coalesce(a->'impostos_antes', '[]'::jsonb), coalesce(a->'impostos_depois', '[]'::jsonb),
    coalesce(a->'envio_antes', '[]'::jsonb), coalesce(a->'envio_depois', '[]'::jsonb),
    p->'parametros',
    v_uid
  )
  returning id into v_id;

  for v_row in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb))
  loop
    insert into public.jobs_alteracoes_financeiro_itens (
      tenant_id, alteracao_id, job_item_orcado_id,
      item_nome, grupo_nome, mes, tipo_custo, tipo_custo_para,
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
      v_job.tenant_id, v_id, (v_row->>'job_item_orcado_id')::uuid,
      v_row->>'item_nome', v_row->>'grupo_nome', nullif(v_row->>'mes', '')::date,
      (v_row->>'tipo_custo')::public.tipo_custo,
      -- Aba aberta antes da revisão de 08/10 não manda o tipo novo: só valor.
      coalesce(nullif(v_row->>'tipo_custo_para', ''), v_row->>'tipo_custo')::public.tipo_custo,
      (v_row->>'valor_unitario_de')::numeric, (v_row->>'valor_unitario_para')::numeric,
      (v_row->>'quantidade_de')::numeric, (v_row->>'quantidade_para')::numeric,
      (v_row->>'dias_meses_de')::numeric, (v_row->>'dias_meses_para')::numeric,
      (v_row->>'total_de')::numeric, (v_row->>'total_para')::numeric,
      -- Aba aberta antes da revisão de 14/10 não manda o planejado.
      (v_row->>'valor_unitario_planejado_de')::numeric, (v_row->>'valor_unitario_planejado_para')::numeric,
      (v_row->>'quantidade_planejada_de')::numeric, (v_row->>'quantidade_planejada_para')::numeric,
      (v_row->>'dias_meses_planejado_de')::numeric, (v_row->>'dias_meses_planejado_para')::numeric,
      (v_row->>'total_planejado_de')::numeric, (v_row->>'total_planejado_para')::numeric,
      (v_row->>'efeito_valor_job')::numeric, (v_row->>'efeito_faturamento_previsto')::numeric
    );
  end loop;

  -- ---- As linhas: os valores do orçado (P1), o tipo de custo e, na fila,
  --      o planejado ----
  for v_row in select * from jsonb_array_elements(coalesce(p->'linhas', '[]'::jsonb))
  loop
    select o.id, o.item, o.tipo_custo,
           o.valor_unitario_planejado, o.quantidade_planejada, o.dias_meses_planejado
      into v_linha
      from public.jobs_itens_orcado o
     where o.id = (v_row->>'id')::uuid
       and o.job_id = p_job_id
       and o.linha_vermelha = false;
    if not found then
      raise exception 'Uma das linhas alteradas não pertence a este job, ou é linha vermelha.';
    end if;

    v_tipo := coalesce(nullif(v_row->>'tipo_custo', '')::public.tipo_custo, v_linha.tipo_custo);

    -- O tipo só muda enquanto nada foi lançado no item (Tiago, 08/10/2026).
    if v_tipo <> v_linha.tipo_custo then
      select l.lancamento into v_lanc
        from public.lancamentos_nas_linhas_do_job(array[v_linha.id]) l;
      if v_lanc is not null then
        raise exception '"%" já tem %: o tipo de custo só muda enquanto nada foi lançado no item.',
          v_linha.item,
          case v_lanc
            when 'pp' then 'Pedido de Produção'
            when 'pp_a_emitir' then 'PP a emitir'
            else 'BV'
          end;
      end if;
    end if;

    -- O planejado: o do payload, ou o de hoje quando ele não vem.
    v_plan_u := coalesce((v_row->>'valor_unitario_planejado')::numeric, v_linha.valor_unitario_planejado);
    v_plan_q := coalesce((v_row->>'quantidade_planejada')::numeric, v_linha.quantidade_planejada);
    v_plan_d := coalesce((v_row->>'dias_meses_planejado')::numeric, v_linha.dias_meses_planejado);

    -- Depois da abertura o planejado é o da abertura (decisão 151).
    if not v_na_fila and (
         v_plan_u is distinct from v_linha.valor_unitario_planejado
      or v_plan_q is distinct from v_linha.quantidade_planejada
      or v_plan_d is distinct from v_linha.dias_meses_planejado
    ) then
      raise exception '"%": o planejado só é editado pelo financeiro com o job na fila da abertura. Depois dela, ele é o da abertura.',
        v_linha.item;
    end if;

    update public.jobs_itens_orcado
       set valor_unitario_orcado = (v_row->>'valor_unitario_orcado')::numeric,
           quantidade_orcada = (v_row->>'quantidade_orcada')::numeric,
           dias_meses_orcado = (v_row->>'dias_meses_orcado')::numeric,
           tipo_custo = v_tipo,
           valor_unitario_planejado = v_plan_u,
           quantidade_planejada = v_plan_q,
           dias_meses_planejado = v_plan_d,
           updated_at = now()
     where id = v_linha.id
    returning tipo_custo into v_gravado;

    -- No Interno o trigger regrava F · Interno (decisão 105).
    if v_gravado <> v_tipo then
      raise exception 'No serviço Interno o tipo de custo é sempre F · Interno.';
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
  -- Na fila, a foto da abertura anda junto: o job abre com o valor editado
  -- (revisão de 13/10/2026). Depois da abertura, ela não muda (§3, item 8).
  update public.jobs
     set valor_total = (p->'espelhos'->>'valor_total')::numeric,
         faturamento_previsto = (p->'espelhos'->>'faturamento_previsto')::numeric,
         faturamento_save_previsto = (p->'espelhos'->>'faturamento_save_previsto')::numeric,
         valor_job_abertura = case
           when v_na_fila then (p->'espelhos'->>'valor_total')::numeric
           else valor_job_abertura
         end,
         faturamento_previsto_abertura = case
           when v_na_fila then (p->'espelhos'->>'faturamento_previsto')::numeric
           else faturamento_previsto_abertura
         end
   where id = p_job_id;

  return v_id;
end;
$function$;
