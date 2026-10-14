-- =====================================================================
-- O financeiro edita também o PLANEJADO enquanto o job está na fila da
-- abertura — revisão da decisão 115 (14/10/2026)
--
-- Pedido do Tiago, com o AMB-1008/26: o financeiro zerou na fila o orçado
-- de 5 influenciadoras que eram de outra abertura ("ajustou para não gerar
-- tanto retrabalho"), mas o planejado delas ficou — a edição do financeiro
-- não mexia no planejado. Depois da revisão de 13/10 (a edição na fila
-- entra no valor inicial), esse planejado sem orçado derrubou o resultado
-- planejado do job. "O financeiro deve poder editar o planejado também
-- enquanto o job ainda não tiver sido aberto."
--
-- A regra, confirmada pelo Tiago no mesmo dia:
--   * no "Editar orçado" do job em `aguardando_abertura`, abrem também
--     R$ Unit., QT e D/M do planejado;
--   * depois da abertura o planejado continua travado (decisão 151: o
--     planejado do job é o da abertura);
--   * as exceções do orçado valem: Interno (o planejado espelha o orçado,
--     decisão 105), save e linha vermelha ficam fechados;
--   * motivo obrigatório, com o planejado de → para no pop-up e no card;
--   * o custo previsto da aba Abertura do Job acompanha (é o planejado dos
--     tipos com PP); o cronograma de desembolsos não — o formulário mostra
--     a diferença e a abertura não confirma até a soma bater.
--
-- O que muda:
--
-- 1. `jobs_alteracoes_financeiro_itens` ganha o planejado de → para
--    (R$ Unit., QT, D/M e total). Nulo nas linhas gravadas antes desta
--    revisão: o histórico não guardava o planejado, e inventar o de então
--    seria pior do que deixar em branco. Aditiva.
--
-- 2. `registrar_alteracao_do_financeiro` grava o planejado da linha quando
--    ele vem no payload e recusa a mudança fora da fila. Payload sem
--    planejado (aba aberta antes desta revisão) mantém o de hoje. No
--    Interno a action não manda o planejado: o gatilho
--    `planejado_espelha_orcado` o faz seguir o orçado, como antes. O resto
--    da função é o da 20261013800001, sem alteração.
-- =====================================================================

-- ---- 1. O planejado no histórico ----
alter table public.jobs_alteracoes_financeiro_itens
  add column if not exists valor_unitario_planejado_de numeric,
  add column if not exists valor_unitario_planejado_para numeric,
  add column if not exists quantidade_planejada_de numeric,
  add column if not exists quantidade_planejada_para numeric,
  add column if not exists dias_meses_planejado_de numeric,
  add column if not exists dias_meses_planejado_para numeric,
  add column if not exists total_planejado_de numeric,
  add column if not exists total_planejado_para numeric;

comment on column public.jobs_alteracoes_financeiro_itens.total_planejado_de is
  'Total PLANEJADO da linha antes da alteracao. Nulo nas linhas gravadas antes de 14/10/2026, quando o historico nao guardava o planejado (revisao da decisao 115).';
comment on column public.jobs_alteracoes_financeiro_itens.total_planejado_para is
  'Total PLANEJADO da linha depois da alteracao; igual ao de quando so o orcado mudou. O financeiro so muda o planejado com o job na fila da abertura (revisao da decisao 115, 14/10/2026).';

-- ---- 2. A gravação ----
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

revoke all on function public.registrar_alteracao_do_financeiro(uuid, jsonb) from public, anon;
grant execute on function public.registrar_alteracao_do_financeiro(uuid, jsonb) to authenticated;

comment on function public.registrar_alteracao_do_financeiro(uuid, jsonb) is
  'Grava uma alteracao do orcado feita pelo financeiro (decisao 115) numa transacao: historico, valores e tipo de custo das linhas, envio sem nota, previsoes de recebimento e de impostos e os espelhos do job. Com o job na fila da abertura, a foto da abertura anda junto (revisao de 13/10/2026) e o planejado da linha tambem se edita; fora da fila, o planejado e recusado (revisao de 14/10/2026). O tipo so muda em linha sem PP, PP a emitir ou BV (revisao de 08/10/2026). Aceita o job na fila da abertura e o aberto ou em producao; recusa o resto. SECURITY INVOKER.';
