-- =====================================================================
-- Mídia Off, entrega 5 (decisão 275, 23/11/2026): encerrar a veiculação
-- antes do fim e estender, com o registro planejado → realizado.
-- ---------------------------------------------------------------------
-- Regras do Tiago (15/10 e 23/11/2026):
-- - o cliente paga só o que foi ao ar: encerrar antes corta as inserções
--   depois do último dia (grade) ou encurta o período com o negociado
--   proporcional sugerido e editável (1c);
-- - a extensão é LINHA NOVA, sem planejado inicial, no mês em que vai ao
--   ar — e o mês entra no job se ainda não estiver nele;
-- - o mês enviado ao faturamento não muda; o motivo é opcional;
-- - nada passa pela errata: a cópia do job passa a ser a campanha como
--   está, e o planejado inicial fica na versão aprovada e no registro;
-- - a previsão de recebimento do financeiro se ajusta sozinha pela
--   diferença de cada mês (23/11/2026, "Ajusta sozinha"), como na edição
--   do orçado pelo financeiro (decisão 224) — a de impostos também; o mês
--   novo da extensão ganha a previsão dele.
--
-- 1) `jobs_midia_alteracoes`: uma mudança (encerramento ou extensão), com
--    a data, o motivo e quem fez.
-- 2) `jobs_midia_alteracoes_linhas`: cada linha que mudou, com o antes e o
--    depois (o antes nulo na extensão) e os negociados.
-- 3) `jobs_itens_orcado.midia_extensao_id`: a linha nascida de uma
--    extensão. Não é linha vermelha: o cliente paga por ela, e a vermelha
--    tem orçado zero (`chk_jio_linha_vermelha_zerada`).
-- 4) `registrar_alteracao_da_midia(job, p)`: aplica a mudança numa
--    transação só — as linhas, o mês novo, o registro, os espelhos do job
--    e as previsões. As contas (a mídia, o faturamento de cada mês) saem do
--    servidor (`actions-midia-realizado.ts`), como na errata; a função
--    confere o papel, o job, o mês enviado e que cada linha é do job.
--
-- Mudança aditiva: tabelas novas, coluna nova nula, função nova.
-- =====================================================================

create table if not exists public.jobs_midia_alteracoes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  job_id      uuid not null references public.jobs(id) on delete cascade,
  tipo        text not null check (tipo in ('encerramento', 'extensao')),
  -- Encerramento: o último dia no ar. Extensão: o 1º dia do mês dela.
  data        date not null,
  motivo      text check (motivo is null or length(btrim(motivo)) between 1 and 500),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_jobs_midia_alteracoes_job
  on public.jobs_midia_alteracoes(job_id, created_at);
create index if not exists idx_jobs_midia_alteracoes_tenant
  on public.jobs_midia_alteracoes(tenant_id);
create index if not exists idx_jobs_midia_alteracoes_autor
  on public.jobs_midia_alteracoes(created_by);

create table if not exists public.jobs_midia_alteracoes_linhas (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete restrict,
  alteracao_id        uuid not null references public.jobs_midia_alteracoes(id) on delete cascade,
  job_item_orcado_id  uuid not null references public.jobs_itens_orcado(id) on delete cascade,
  antes               jsonb,
  depois              jsonb not null,
  negociado_antes     numeric(14,2),
  negociado_depois    numeric(14,2) not null
);

create index if not exists idx_jobs_midia_alteracoes_linhas_alteracao
  on public.jobs_midia_alteracoes_linhas(alteracao_id);
create index if not exists idx_jobs_midia_alteracoes_linhas_linha
  on public.jobs_midia_alteracoes_linhas(job_item_orcado_id);
create index if not exists idx_jobs_midia_alteracoes_linhas_tenant
  on public.jobs_midia_alteracoes_linhas(tenant_id);

alter table public.jobs_itens_orcado
  add column if not exists midia_extensao_id uuid
    references public.jobs_midia_alteracoes(id) on delete restrict;
create index if not exists idx_jio_midia_extensao
  on public.jobs_itens_orcado(midia_extensao_id) where midia_extensao_id is not null;

comment on column public.jobs_itens_orcado.midia_extensao_id is
  'Mídia Off (decisão 275): a linha nasceu de uma extensão da veiculação — sem planejado inicial, só realizado.';

-- ---- RLS ------------------------------------------------------------------
alter table public.jobs_midia_alteracoes enable row level security;
alter table public.jobs_midia_alteracoes_linhas enable row level security;

drop policy if exists jobs_midia_alteracoes_select on public.jobs_midia_alteracoes;
create policy jobs_midia_alteracoes_select on public.jobs_midia_alteracoes
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists jobs_midia_alteracoes_insert on public.jobs_midia_alteracoes;
create policy jobs_midia_alteracoes_insert on public.jobs_midia_alteracoes
  for insert to authenticated
  with check (
    tenant_id in (select public.current_tenant_ids())
    and (select public.session_role()) = any (array['administrador', 'gerente_producao']::public.app_role[])
    and created_by = (select auth.uid())
  );

drop policy if exists jobs_midia_alteracoes_linhas_select on public.jobs_midia_alteracoes_linhas;
create policy jobs_midia_alteracoes_linhas_select on public.jobs_midia_alteracoes_linhas
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists jobs_midia_alteracoes_linhas_insert on public.jobs_midia_alteracoes_linhas;
create policy jobs_midia_alteracoes_linhas_insert on public.jobs_midia_alteracoes_linhas
  for insert to authenticated
  with check (
    tenant_id in (select public.current_tenant_ids())
    and (select public.session_role()) = any (array['administrador', 'gerente_producao']::public.app_role[])
  );

revoke all on public.jobs_midia_alteracoes from anon;
revoke all on public.jobs_midia_alteracoes_linhas from anon;
grant select, insert on public.jobs_midia_alteracoes to authenticated;
grant select, insert on public.jobs_midia_alteracoes_linhas to authenticated;

comment on table public.jobs_midia_alteracoes is
  'Mídia Off (decisão 275): o registro planejado → realizado — encerrar a veiculação antes e estender. Só cresce.';
comment on table public.jobs_midia_alteracoes_linhas is
  'Mídia Off (decisão 275): cada linha de uma mudança da veiculação, com o antes e o depois.';

-- ---- A função ---------------------------------------------------------------
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

  return jsonb_build_object('alteracao_id', v_alt, 'linha_id', v_nova);
end;
$$;

revoke all on function public.registrar_alteracao_da_midia(uuid, jsonb) from public, anon;
grant execute on function public.registrar_alteracao_da_midia(uuid, jsonb) to authenticated;
