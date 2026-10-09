-- =====================================================================
-- Editar orçado do financeiro: o tipo de custo também muda — revisão da
-- decisão 115 (08/10/2026)
--
-- Pedido do Tiago, com o AMB-1029/26 na fila da abertura: "Quero que
-- também seja possível modificar o tipo de custo em 'Editar Orçado' pelo
-- financeiro". Até aqui o tipo era só da errata (decisão 115, P1).
--
-- A regra, respondida por ele no mesmo dia: qualquer tipo, "do mesmo modo
-- que com a realização de erratas, só será possível realizar modificações
-- enquanto nada tiver sido adicionado no item". Lido como: a linha troca
-- de tipo enquanto não tem PP (em qualquer situação, a emitir inclusive)
-- nem BV. PP e BV cancelados não contam. Os VALORES da linha com PP
-- continuam editáveis, como a P2 decidiu.
--
-- O que muda:
--
-- 1. `jobs_alteracoes_financeiro_itens.tipo_custo_para`: o tipo depois da
--    alteração. `tipo_custo` continua sendo o de antes. As linhas já
--    gravadas (nenhuma trocou tipo) recebem o mesmo tipo, e a coluna
--    passa a NOT NULL. O backfill só preenche a coluna nova.
--
-- 2. `lancamentos_nas_linhas_do_job(uuid[])`: o que já foi lançado em
--    cada linha — 'pp', 'pp_a_emitir' ou 'bv'. SECURITY DEFINER porque a
--    RLS de `pedidos_compra` filtra por empresa e regional: a trava não
--    pode depender do que o usuário enxerga. Só devolve linha de tenant de
--    que o usuário é membro. A action a chama para a mensagem; a função
--    abaixo, para a trava.
--
-- 3. `registrar_alteracao_do_financeiro` grava o tipo novo e recusa a
--    troca em linha com lançamento. No serviço Interno o trigger
--    `planejado_espelha_orcado` regrava F · Interno: a função confere o
--    que ficou gravado e recusa, em vez de deixar o histórico dizendo um
--    tipo que a linha não tem. O resto não muda (ver a 20260928300004).
-- =====================================================================

-- ---- 1. O tipo depois da alteração, no histórico ----
alter table public.jobs_alteracoes_financeiro_itens
  add column if not exists tipo_custo_para public.tipo_custo;

update public.jobs_alteracoes_financeiro_itens
   set tipo_custo_para = tipo_custo
 where tipo_custo_para is null;

alter table public.jobs_alteracoes_financeiro_itens
  alter column tipo_custo_para set not null;

comment on column public.jobs_alteracoes_financeiro_itens.tipo_custo is
  'Tipo de custo da linha ANTES da alteracao (decisao 115).';
comment on column public.jobs_alteracoes_financeiro_itens.tipo_custo_para is
  'Tipo de custo da linha DEPOIS da alteracao; igual a tipo_custo quando so o valor mudou (revisao da decisao 115, 08/10/2026).';

-- ---- 2. O que já foi lançado em cada linha ----
create or replace function public.lancamentos_nas_linhas_do_job(p_ids uuid[])
returns table (job_item_orcado_id uuid, lancamento text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select o.id,
         case
           when exists (
             select 1
               from public.jobs_itens_realizado r
               join public.pedidos_compra pc on pc.item_realizado_id = r.id
              where r.job_item_orcado_id = o.id
                and pc.status <> 'cancelada'
           ) then 'pp'
           when exists (
             select 1
               from public.jobs_itens_realizado r
               join public.pedidos_compra_a_emitir a on a.item_realizado_id = r.id
              where r.job_item_orcado_id = o.id
                and a.excluida_em is null
                and a.pp_id is null
           ) then 'pp_a_emitir'
           when exists (
             select 1
               from public.itens_bv b
              where b.job_item_orcado_id = o.id
                and b.situacao <> 'cancelado'
           ) then 'bv'
         end
    from public.jobs_itens_orcado o
   where o.id = any(p_ids)
     and public.is_tenant_member(o.tenant_id);
$function$;

revoke all on function public.lancamentos_nas_linhas_do_job(uuid[]) from public, anon;
grant execute on function public.lancamentos_nas_linhas_do_job(uuid[]) to authenticated;

comment on function public.lancamentos_nas_linhas_do_job(uuid[]) is
  'O que ja foi lancado em cada linha do job: pp (PP nao cancelada), pp_a_emitir ou bv (nao cancelado); nulo quando nada. Trava a troca de tipo de custo no Editar orcado do financeiro (revisao da decisao 115). SECURITY DEFINER: a RLS de pedidos_compra filtra por empresa.';

-- ---- 3. A gravação, com o tipo ----
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
      efeito_valor_job, efeito_faturamento_previsto
    ) values (
      v_job.tenant_id, v_id, (v_row->>'job_item_orcado_id')::uuid,
      v_row->>'item_nome', v_row->>'grupo_nome', nullif(v_row->>'mes', '')::date,
      (v_row->>'tipo_custo')::public.tipo_custo,
      -- Aba aberta antes desta revisão não manda o tipo novo: só valor.
      coalesce(nullif(v_row->>'tipo_custo_para', ''), v_row->>'tipo_custo')::public.tipo_custo,
      (v_row->>'valor_unitario_de')::numeric, (v_row->>'valor_unitario_para')::numeric,
      (v_row->>'quantidade_de')::numeric, (v_row->>'quantidade_para')::numeric,
      (v_row->>'dias_meses_de')::numeric, (v_row->>'dias_meses_para')::numeric,
      (v_row->>'total_de')::numeric, (v_row->>'total_para')::numeric,
      (v_row->>'efeito_valor_job')::numeric, (v_row->>'efeito_faturamento_previsto')::numeric
    );
  end loop;

  -- ---- As linhas: os valores do orçado (P1) e o tipo de custo ----
  for v_row in select * from jsonb_array_elements(coalesce(p->'linhas', '[]'::jsonb))
  loop
    select o.id, o.item, o.tipo_custo
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

    update public.jobs_itens_orcado
       set valor_unitario_orcado = (v_row->>'valor_unitario_orcado')::numeric,
           quantidade_orcada = (v_row->>'quantidade_orcada')::numeric,
           dias_meses_orcado = (v_row->>'dias_meses_orcado')::numeric,
           tipo_custo = v_tipo,
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
  'Grava uma alteracao do orcado feita pelo financeiro (decisao 115) numa transacao: historico, valores e tipo de custo das linhas, envio sem nota, previsoes de recebimento e de impostos e os espelhos do job. O tipo so muda em linha sem PP, PP a emitir ou BV (revisao de 08/10/2026). Aceita o job na fila da abertura e o aberto ou em producao; recusa o resto. SECURITY INVOKER.';
