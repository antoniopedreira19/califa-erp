-- Revisão da decisão 115 (28/10/2026) — no "Editar orçado" do financeiro,
-- o tipo de custo da linha com PP e a data do faturamento que nasce.
--
-- Pedido do Tiago (28/10/2026), ao corrigir o UER-1002/26 (Always On aberto
-- com as 35 linhas em F · Interno, que deviam ser A · Repasse, com os
-- honorários zerados pelos parâmetros do job):
--
-- 1. A linha com PP — inclusive a que já chegou ao financeiro — e a com PP a
--    emitir passam a trocar de tipo, mas só entre os tipos que geram PP
--    (AR, B, C, F, FI). A e D continuam fora: neles o cliente paga o
--    fornecedor direto, e a PP emitida perderia o sentido. O BV segue
--    travando a troca. A errata da produção não muda (decisão 040).
-- 2. O job (ou o mês do mensal) que abriu sem faturamento e não tem previsão
--    de recebimento deixa de recusar a alteração que cria faturamento: o
--    pop-up do Salvar pede a data, e a função insere a parcela nova, com o
--    valor do faturamento que entra. Antes, a frase mandava pedir errata à
--    produção, que devolve o job à revisão da abertura.
--
-- `travas_do_tipo_nas_linhas_do_job` é a irmã de
-- `lancamentos_nas_linhas_do_job`, que devolve um rótulo só e esconde o BV
-- quando a linha também tem PP. A antiga fica (aditivo): ninguém mais a
-- chama depois deste commit, mas apagá-la não é preciso.
--
-- O corpo de `registrar_alteracao_do_financeiro` é o de 20261028400001
-- (parâmetros do job depois da abertura), com a trava do tipo trocada e o
-- bloco da previsão nova antes dos números do job.

create or replace function public.travas_do_tipo_nas_linhas_do_job(p_ids uuid[])
 returns table(job_item_orcado_id uuid, tem_pp boolean, tem_pp_a_emitir boolean, tem_bv boolean)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  -- Definer pelo mesmo motivo da `lancamentos_nas_linhas_do_job`: a RLS de
  -- `pedidos_compra` filtra por empresa, e a trava não pode depender do que
  -- o usuário enxerga.
  select o.id,
         exists (
           select 1
             from public.jobs_itens_realizado r
             join public.pedidos_compra pc on pc.item_realizado_id = r.id
            where r.job_item_orcado_id = o.id
              and pc.status <> 'cancelada'
         ),
         exists (
           select 1
             from public.jobs_itens_realizado r
             join public.pedidos_compra_a_emitir a on a.item_realizado_id = r.id
            where r.job_item_orcado_id = o.id
              and a.excluida_em is null
              and a.pp_id is null
         ),
         exists (
           select 1
             from public.itens_bv b
            where b.job_item_orcado_id = o.id
              and b.situacao <> 'cancelado'
         )
    from public.jobs_itens_orcado o
   where o.id = any(p_ids)
     and public.is_tenant_member(o.tenant_id);
$function$;

revoke all on function public.travas_do_tipo_nas_linhas_do_job(uuid[]) from public, anon;
grant execute on function public.travas_do_tipo_nas_linhas_do_job(uuid[]) to authenticated;

comment on function public.travas_do_tipo_nas_linhas_do_job(uuid[]) is
  'O que cada linha do job tem lançado (PP fora de cancelada, PP a emitir aberta, BV fora de cancelado), cada coisa à parte, para a troca de tipo de custo no Editar orçado do financeiro (revisão da decisão 115, 28/10/2026).';

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
  v_trava   record;
  v_ordem   smallint;
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

    -- O tipo só muda enquanto nada foi lançado no item (Tiago, 08/10/2026),
    -- com a exceção de 28/10/2026: a linha com PP ou PP a emitir troca
    -- entre os tipos que geram PP (AR, B, C, F, FI — a calha PP da decisão
    -- 004). O BV segue travando, e a PP em linha A ou D (dado antigo) também.
    if v_tipo <> v_linha.tipo_custo then
      select t.tem_pp, t.tem_pp_a_emitir, t.tem_bv into v_trava
        from public.travas_do_tipo_nas_linhas_do_job(array[v_linha.id]) t;
      if v_trava.tem_bv then
        raise exception '"%" já tem BV: o tipo de custo só muda enquanto nada foi lançado no item.',
          v_linha.item;
      end if;
      if (v_trava.tem_pp or v_trava.tem_pp_a_emitir)
         and not (v_linha.tipo_custo in ('AR', 'B', 'C', 'F', 'FI')
                  and v_tipo in ('AR', 'B', 'C', 'F', 'FI')) then
        raise exception '"%" já tem %: o tipo de custo só muda entre os tipos que geram PP (A · Repasse, B, C, F · Externo e F · Interno).',
          v_linha.item,
          case when v_trava.tem_pp then 'Pedido de Produção' else 'PP a emitir' end;
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

  -- ---- A previsão nova (revisão de 28/10/2026) ----
  -- O mês do mensal (ou o job, nos outros modelos) que passa a faturar sem
  -- previsão de recebimento para acompanhar: a data vem do pop-up do
  -- financeiro, e o valor é o faturamento que entra. Na fila não: lá quem
  -- preenche a previsão é o formulário da abertura.
  for v_row in select * from jsonb_array_elements(coalesce(p->'recebimento_novo', '[]'::jsonb))
  loop
    if v_na_fila then
      raise exception 'Na fila da abertura, a previsão de recebimento é preenchida no formulário da abertura.';
    end if;
    if nullif(v_row->>'data_prevista', '') is null or coalesce((v_row->>'valor')::numeric, 0) <= 0 then
      raise exception 'A previsão de recebimento nova precisa de data e de valor.';
    end if;
    if exists (
      select 1
        from public.jobs_previsao_recebimento r
       where r.job_id = p_job_id
         and (nullif(v_row->>'mes', '') is null
              or r.mes = nullif(v_row->>'mes', '')::date)
    ) then
      raise exception 'Este faturamento já tem previsão de recebimento: ela acompanha a alteração, sem data nova.';
    end if;
    select coalesce(max(r.ordem), 0) + 1 into v_ordem
      from public.jobs_previsao_recebimento r
     where r.job_id = p_job_id;
    insert into public.jobs_previsao_recebimento (
      tenant_id, job_id, ordem, data_prevista, valor, mes, created_by
    ) values (
      v_job.tenant_id, p_job_id, v_ordem,
      (v_row->>'data_prevista')::date, (v_row->>'valor')::numeric,
      nullif(v_row->>'mes', '')::date, v_uid
    );
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

comment on function public.registrar_alteracao_do_financeiro(uuid, jsonb) is
  'Grava uma alteracao do orcado feita pelo financeiro (decisao 115) e os parametros do job (decisao 224) numa transacao: historico, valores e tipo de custo das linhas, envio sem nota, previsoes de recebimento e de impostos e os espelhos do job. Com o job na fila da abertura, a foto da abertura anda junto (revisao de 13/10/2026) e o planejado da linha tambem se edita; fora da fila, o planejado e recusado (revisao de 14/10/2026). O tipo muda em linha sem nada lancado (revisao de 08/10/2026) e, desde 28/10/2026, tambem na linha com PP ou PP a emitir, entre os tipos com PP (AR, B, C, F, FI); BV trava. Desde 28/10/2026, recebimento_novo cria a previsao do faturamento que nasce sem previsao para acompanhar, fora da fila. Aceita o job na fila da abertura e o aberto ou em producao; recusa o resto. SECURITY INVOKER.';
