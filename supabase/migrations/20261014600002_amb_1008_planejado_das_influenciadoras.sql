-- =====================================================================
-- AMB-1008/26: o planejado das 5 influenciadoras zeradas na fila vai a
-- zero — correção de dado autorizada pelo Tiago (14/10/2026)
--
-- O que aconteceu: as influenciadoras eram de outra abertura. Em 28/09 o
-- financeiro zerou o orçado delas na fila (D/M 0, "para não gerar tanto
-- retrabalho") e pediu à abertura uma abertura separada para elas. O
-- planejado ficou em R$ 20.450,00 — a edição do financeiro não mexia no
-- planejado até a 20261014600001. Com a revisão de 13/10 (a edição na fila
-- entra no valor inicial), esse planejado sem orçado levou o Resultado op.
-- (planejado) de R$ 54.596,80 para R$ 31.290,10.
--
-- A correção, nas linhas conferidas com o Tiago antes (ordem 89 a 93,
-- grupos INFLUS - SALVADOR e INFLUS - RECIFE, tipo A, sem PP, BV, save nem
-- realizado): D/M do planejado de 1 para 0. R$ Unit. e QT ficam, para as
-- linhas e o histórico continuarem na planilha. O Resultado op. (planejado)
-- vai a R$ 51.740,10 (18,3%). O custo previsto (R$ 175.990,00), a curva e
-- o fluxo de caixa não mudam: o tipo A não entra neles.
--
-- O job já está aberto, então a correção entra pelo banco, e não pela
-- tela (o planejado só se edita na fila). Fica registrada no card
-- "Alterações do Financeiro", em nome do Tiago, como ele pediu, com o
-- planejado de → para de cada linha. Sobrescreve valor existente:
-- autorizada pelo Tiago em 14/10/2026 ("Sim, as 5"; "No card, em seu
-- nome").
-- =====================================================================

do $$
declare
  v_job    record;
  v_autor  uuid;
  v_id     uuid;
  v_linhas int;
  v_receb  jsonb;
  v_imp    jsonb;
begin
  select j.id, j.tenant_id, j.status, j.valor_total, j.faturamento_previsto
    into v_job
    from public.jobs j
   where j.codigo = 'AMB-1008/26';
  if not found then
    raise exception 'AMB-1008/26 não encontrado.';
  end if;

  -- O autor: o Tiago, administrador do tenant do job.
  select p.id
    into v_autor
    from public.profiles p
    join public.tenant_members tm on tm.user_id = p.id and tm.tenant_id = v_job.tenant_id
   where p.nome = 'Tiago Mendonça'
     and tm.role = 'administrador'
     and tm.status = 'ativo';
  if v_autor is null then
    raise exception 'Perfil do Tiago não encontrado como administrador do tenant.';
  end if;

  -- Exatamente as 5 linhas conferidas, no estado em que foram conferidas.
  select count(*)
    into v_linhas
    from public.jobs_itens_orcado o
   where o.job_id = v_job.id
     and o.ordem between 89 and 93
     and o.tipo_custo = 'A'
     and o.total_orcado = 0
     and o.dias_meses_planejado = 1
     and o.em_save = false
     and o.cancelada_em is null
     and o.linha_vermelha = false
     and o.item in (
       'Flávia Najar @flavianajar (Lifestyle Premium)',
       'Livia Cady @liviacady (Wellness)',
       'Ane Riccó @anericco (Wellness)',
       'Valmir Wanderley @valmirwanderley (Wellness)',
       'Maria Luiza Kehrle @malukehrle (Wellness)'
     );
  if v_linhas <> 5 then
    raise exception 'Esperava as 5 linhas conferidas do AMB-1008/26 e encontrei %. Nada foi alterado.', v_linhas;
  end if;

  -- O recebimento e os impostos não mudam: a foto de antes e a de depois
  -- são a mesma, e o card não mostra nada para eles.
  select coalesce(jsonb_agg(jsonb_build_object('data_prevista', r.data_prevista, 'valor', r.valor)
                            order by r.data_prevista, r.ordem), '[]'::jsonb)
    into v_receb
    from public.jobs_previsao_recebimento r
   where r.job_id = v_job.id;
  select coalesce(jsonb_agg(jsonb_build_object('data_prevista', r.data_prevista, 'valor', r.valor)
                            order by r.ordem), '[]'::jsonb)
    into v_imp
    from public.jobs_previsao_impostos r
   where r.job_id = v_job.id;

  insert into public.jobs_alteracoes_financeiro (
    tenant_id, job_id, motivo,
    custo_orcado_antes, custo_orcado_depois,
    valor_job_antes, valor_job_depois,
    faturamento_previsto_antes, faturamento_previsto_depois,
    recebimento_antes, recebimento_depois,
    impostos_antes, impostos_depois,
    envio_antes, envio_depois,
    created_by
  )
  select v_job.tenant_id, v_job.id,
         'As influenciadoras eram de outra abertura: o orçado delas foi zerado na fila em 28/09/2026, e agora o planejado também (D/M 0), para não derrubar a rentabilidade do job. Correção feita pelo banco, com o job já aberto.',
         round(sum(o.total_orcado), 2), round(sum(o.total_orcado), 2),
         v_job.valor_total, v_job.valor_total,
         v_job.faturamento_previsto, v_job.faturamento_previsto,
         v_receb, v_receb,
         v_imp, v_imp,
         '[]'::jsonb, '[]'::jsonb,
         v_autor
    from public.jobs_itens_orcado o
   where o.job_id = v_job.id
     and o.cancelada_em is null
  returning id into v_id;

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
  )
  select v_job.tenant_id, v_id, o.id,
         o.item, coalesce(g.nome, '—'), null, o.tipo_custo, o.tipo_custo,
         o.valor_unitario_orcado, o.valor_unitario_orcado,
         o.quantidade_orcada, o.quantidade_orcada,
         o.dias_meses_orcado, o.dias_meses_orcado,
         round(o.total_orcado, 2), round(o.total_orcado, 2),
         o.valor_unitario_planejado, o.valor_unitario_planejado,
         o.quantidade_planejada, o.quantidade_planejada,
         o.dias_meses_planejado, 0,
         round(o.total_planejado, 2), 0,
         0, 0
    from public.jobs_itens_orcado o
    left join public.jobs_grupos g on g.id = o.job_grupo_id
   where o.job_id = v_job.id
     and o.ordem between 89 and 93
     and o.tipo_custo = 'A'
     and o.total_orcado = 0
     and o.dias_meses_planejado = 1;

  update public.jobs_itens_orcado o
     set dias_meses_planejado = 0,
         updated_at = now()
   where o.job_id = v_job.id
     and o.ordem between 89 and 93
     and o.tipo_custo = 'A'
     and o.total_orcado = 0
     and o.dias_meses_planejado = 1;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 5 then
    raise exception 'A correção mexeria em % linhas, e não nas 5 conferidas. Nada foi alterado.', v_linhas;
  end if;
end;
$$;
