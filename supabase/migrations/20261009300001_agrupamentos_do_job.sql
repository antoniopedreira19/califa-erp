-- =====================================================================
-- Agrupamentos do job e a errata que organiza a planilha — decisão 162
-- (09/10/2026)
--
-- Pedido do Tiago: na Planilha Interna do job, a ERRATA passa a organizar
-- a planilha — o item muda de lugar pela alça (como no orçamento, decisão
-- 104) e pode trocar de agrupamento; o agrupamento se renomeia e nasce; e o
-- que ficar vazio sai quando a errata é confirmada. Fora da errata nada
-- disso existe.
--
-- Respostas que moldam este arquivo (09/10/2026):
--   1. o nome novo vale SÓ NO JOB: a versão aprovada continua como o cliente
--      aprovou. Por isso o job ganha agrupamentos próprios, como já tem a
--      cópia das linhas (`jobs_itens_orcado`) — e não um filtro na tabela da
--      versão (a regra do módulo: estrutura paralela, nunca filtro na
--      compartilhada);
--   2. o item pode trocar de agrupamento (no mensal, dentro do mês);
--   3. admin, GP e produtor — os papéis da errata (decisão 159);
--   4. a errata que só organiza devolve o job ao mural como qualquer errata,
--      e o financeiro vê que nenhum valor mudou (`jobs_erratas.estrutura`);
--   5. o agrupamento que ficar vazio sai na confirmação.
--
-- O desenho:
--   * `jobs_grupos` — os agrupamentos do job. Nasce com a cópia dos da
--     versão aprovada (backfill abaixo para os jobs que já existem; a
--     abertura copia os do job novo). `grupo_versao_id` é a ÂNCORA na
--     versão: no agrupamento copiado, o original; no criado por errata, um
--     agrupamento da versão do MESMO MÊS. Removido não se apaga: ganha
--     `removido_em` (o histórico das erratas aponta para ele).
--   * `jobs_itens_orcado.job_grupo_id` — o agrupamento do job da linha, que
--     a tela usa. `grupo_id` (FK para a versão) FICA, e o gatilho
--     `jio_grupo_do_job` o mantém igual à âncora do agrupamento do job. É
--     ele que diz o MÊS da linha a quem já o lê (faturamento mensal,
--     espelhos, `mes_do_pedido`, travas de mês enviado) — nada disso muda.
--     Por isso a linha não troca de mês: o gatilho recusa.
--   * `jobs_erratas.estrutura` — o que a errata mudou na organização, com
--     os nomes, para o histórico e para o financeiro.
--   * `registrar_errata_do_job` aplica a organização na mesma transação.
--   * As três funções de save que guardam o nome do agrupamento no pedido
--     passam a guardar o nome do JOB.
--
-- Tudo aditivo: tabela nova, coluna nova preenchida por backfill (estava
-- vazia), gatilho novo, funções recriadas. Nenhuma linha existente perde
-- valor; `grupo_id` não muda em linha nenhuma neste arquivo.
-- =====================================================================

-- ---- 1. Os agrupamentos do job ----------------------------------------

create table if not exists public.jobs_grupos (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id),
  job_id                 uuid not null references public.jobs(id) on delete cascade,
  -- A âncora na versão aprovada: o agrupamento copiado, ou (no criado por
  -- errata) um agrupamento da versão do mesmo mês. Dá o mês às linhas.
  grupo_versao_id        uuid not null references public.versoes_orcamento_grupos(id) on delete cascade,
  -- O mês do modelo mensal (decisão 078), o mesmo da âncora. Fica aqui para
  -- a tela agrupar por mês sem ler a versão.
  mes_id                 uuid references public.versoes_orcamento_meses(id),
  nome                   text not null
                           check (char_length(btrim(nome)) between 1 and 120),
  ordem                  integer not null default 0,
  -- A errata que criou o agrupamento; `null` no copiado da versão.
  criado_na_errata_id    uuid references public.jobs_erratas(id) on delete set null,
  -- Agrupamento que ficou vazio numa errata: sai da tela, fica no banco.
  removido_em            timestamptz,
  removido_na_errata_id  uuid references public.jobs_erratas(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_jobs_grupos_job
  on public.jobs_grupos (job_id, ordem);
create index if not exists idx_jobs_grupos_tenant
  on public.jobs_grupos (tenant_id);
create index if not exists idx_jobs_grupos_grupo_versao
  on public.jobs_grupos (grupo_versao_id);
create index if not exists idx_jobs_grupos_mes
  on public.jobs_grupos (mes_id);
create index if not exists idx_jobs_grupos_criado_na_errata
  on public.jobs_grupos (criado_na_errata_id);
create index if not exists idx_jobs_grupos_removido_na_errata
  on public.jobs_grupos (removido_na_errata_id);

comment on table public.jobs_grupos is
  'Decisão 162 (09/10/2026): os agrupamentos da Planilha Interna do job. Cópia dos da versão aprovada na abertura; a errata renomeia, cria e remove (removido_em). A versão aprovada não muda.';
comment on column public.jobs_grupos.grupo_versao_id is
  'A âncora na versão aprovada: o agrupamento copiado, ou um da versão do mesmo mês. jobs_itens_orcado.grupo_id acompanha a âncora (gatilho jio_grupo_do_job) e é de onde sai o mês da linha.';

alter table public.jobs_grupos enable row level security;

-- As mesmas portas de `jobs_itens_orcado`: membro do tenant, e o
-- freelancer só no projeto dele. Quem escreve é a função da errata e a
-- abertura do job; não há DELETE (o removido fica).
drop policy if exists jobs_grupos_select on public.jobs_grupos;
create policy jobs_grupos_select on public.jobs_grupos
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (
      (select public.session_role()) <> 'freelancer'::public.app_role
      or exists (
        select 1 from public.jobs j
         where j.id = jobs_grupos.job_id
           and public.is_freelancer_do_projeto(j.projeto_id)
      )
    )
  );

drop policy if exists jobs_grupos_insert on public.jobs_grupos;
create policy jobs_grupos_insert on public.jobs_grupos
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists jobs_grupos_update on public.jobs_grupos;
create policy jobs_grupos_update on public.jobs_grupos
  for update to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (
      (select public.session_role()) <> 'freelancer'::public.app_role
      or exists (
        select 1 from public.jobs j
         where j.id = jobs_grupos.job_id
           and public.is_freelancer_do_projeto(j.projeto_id)
      )
    )
  )
  with check (public.is_tenant_member(tenant_id));

revoke all on table public.jobs_grupos from public, anon;
grant select, insert, update on public.jobs_grupos to authenticated;

-- ---- 2. A linha aponta para o agrupamento do job -----------------------

alter table public.jobs_itens_orcado
  add column if not exists job_grupo_id uuid references public.jobs_grupos(id);

create index if not exists idx_jio_job_grupo
  on public.jobs_itens_orcado (job_grupo_id);

comment on column public.jobs_itens_orcado.job_grupo_id is
  'Decisão 162: o agrupamento do job (jobs_grupos) em que a linha aparece. grupo_id continua apontando para a versão — a âncora deste agrupamento — e dá o mês.';

-- ---- 3. Backfill: os jobs que já existem ganham os agrupamentos ---------
-- Todos os agrupamentos da versão aprovada, inclusive os vazios: é o que a
-- Planilha Interna mostrava até aqui.
insert into public.jobs_grupos (tenant_id, job_id, grupo_versao_id, mes_id, nome, ordem)
select j.tenant_id, j.id, g.id, g.mes_id, g.nome, g.ordem
  from public.jobs j
  join public.versoes_orcamento_grupos g
    on g.versao_orcamento_id = j.versao_orcamento_aprovada_id
 where not exists (
         select 1 from public.jobs_grupos x
          where x.job_id = j.id
            and x.grupo_versao_id = g.id
            and x.criado_na_errata_id is null
       );

-- E cada linha aponta para o agrupamento do job que copia o dela. Só
-- preenche o que está vazio.
update public.jobs_itens_orcado o
   set job_grupo_id = x.id
  from public.jobs_grupos x
 where o.job_grupo_id is null
   and x.job_id = o.job_id
   and x.grupo_versao_id = o.grupo_id
   and x.criado_na_errata_id is null;

alter table public.jobs_itens_orcado
  alter column job_grupo_id set not null;

-- ---- 4. O gatilho que liga a linha ao agrupamento do job ----------------
--
-- * Linha nova SEM agrupamento do job (a abertura e todo caminho antigo):
--   vai para o agrupamento do job que copia o da versão em `grupo_id` — e,
--   se ele ainda não existe, nasce aqui.
-- * Linha COM agrupamento do job: ele precisa ser deste job e estar de pé,
--   e `grupo_id` passa a ser a âncora dele. Ao trocar de agrupamento a
--   linha não troca de mês.
create or replace function public.jio_grupo_do_job()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id        uuid;
  v_job       uuid;
  v_ancora    uuid;
  v_mes       uuid;
  v_removido  timestamptz;
  v_mes_antes uuid;
begin
  if new.job_grupo_id is null then
    select g.id into v_id
      from public.jobs_grupos g
     where g.job_id = new.job_id
       and g.grupo_versao_id = new.grupo_id
       and g.criado_na_errata_id is null
     order by g.removido_em nulls first
     limit 1;
    if v_id is null then
      insert into public.jobs_grupos (tenant_id, job_id, grupo_versao_id, mes_id, nome, ordem)
      select new.tenant_id, new.job_id, v.id, v.mes_id, v.nome, v.ordem
        from public.versoes_orcamento_grupos v
       where v.id = new.grupo_id
      returning id into v_id;
    end if;
    new.job_grupo_id := v_id;
    return new;
  end if;

  select g.job_id, g.grupo_versao_id, g.mes_id, g.removido_em
    into v_job, v_ancora, v_mes, v_removido
    from public.jobs_grupos g
   where g.id = new.job_grupo_id;
  if not found or v_job <> new.job_id then
    raise exception 'O agrupamento não é deste job.';
  end if;
  if v_removido is not null then
    raise exception 'Este agrupamento foi removido numa errata anterior.';
  end if;
  if tg_op = 'UPDATE' and old.job_grupo_id is distinct from new.job_grupo_id then
    select g.mes_id into v_mes_antes from public.jobs_grupos g where g.id = old.job_grupo_id;
    if v_mes_antes is distinct from v_mes then
      raise exception 'A linha não muda de mês: leve-a para um agrupamento do mesmo mês.';
    end if;
  end if;
  new.grupo_id := v_ancora;
  return new;
end;
$$;

drop trigger if exists trg_jio_grupo_do_job on public.jobs_itens_orcado;
create trigger trg_jio_grupo_do_job
  before insert or update of job_grupo_id on public.jobs_itens_orcado
  for each row execute function public.jio_grupo_do_job();

-- ---- 5. O que a errata mudou na organização ----------------------------
-- A lista que o pop-up mostrou ao confirmar, com os nomes daquele momento:
-- [{tipo: "grupo_novo"|"grupo_renomeado"|"grupo_removido"|"item_movido"|
--   "ordem", ...}]. Nula na errata que não mexeu na organização.
alter table public.jobs_erratas
  add column if not exists estrutura jsonb
    check (estrutura is null or jsonb_typeof(estrutura) = 'array');

comment on column public.jobs_erratas.estrutura is
  'Decisão 162: o que a errata mudou na organização da planilha (agrupamento novo, renomeado, removido; item movido; ordem), com os nomes. Errata só com isto não muda valor.';

-- ---- 6. registrar_errata_do_job: a organização na mesma transação --------
-- Corpo igual ao de 20261008600001 (decisão 159), com os acréscimos
-- marcados "Decisão 162". A ordem importa: os agrupamentos novos nascem
-- antes das linhas novas (que podem cair neles), a sequência das linhas é
-- gravada depois de tudo existir, e os removidos saem por último — só se
-- estiverem vazios.
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
  -- Decisão 159: a errata pronta que este envio consome, e quem a preparou.
  v_pronta    uuid := nullif(p->>'errata_pronta_id', '')::uuid;
  v_preparada uuid;
  -- Decisão 162: a organização, e as chaves dos agrupamentos novos.
  est         jsonb := coalesce(p->'estrutura', '{}'::jsonb);
  v_grupos    jsonb := '{}'::jsonb;
  v_g         jsonb;
  v_gid       uuid;
  v_mes       uuid;
  v_ordem     integer;
begin
  -- Decisão 159: só o GP e o administrador registram errata. O produtor
  -- deixa a errata pronta para envio (`jobs_erratas_prontas`).
  if coalesce((select public.session_role())::text, '') not in ('administrador', 'gerente_producao') then
    raise exception 'Só o GP ou o administrador envia a errata ao financeiro. O produtor deixa a errata pronta para envio.';
  end if;

  select j.id, j.tenant_id, j.abertura_em_revisao, j.versao_orcamento_aprovada_id
    into v_job
    from public.jobs j
   where j.id = p_job_id
   for update;
  if not found then
    raise exception 'Job não encontrado.';
  end if;

  -- Decisão 159: com pronta parada no job, a errata nova é ELA. O "for
  -- update" do job acima já serializa dois envios da mesma pronta.
  if v_pronta is not null then
    select ep.preparada_por
      into v_preparada
      from public.jobs_erratas_prontas ep
     where ep.id = v_pronta
       and ep.job_id = p_job_id
       and ep.situacao = 'pronta'
     for update;
    if not found then
      raise exception 'A errata pronta para envio já foi enviada ou descartada. Recarregue a página.';
    end if;
  elsif exists (
    select 1
      from public.jobs_erratas_prontas ep
     where ep.job_id = p_job_id
       and ep.situacao = 'pronta'
  ) then
    raise exception 'Este job tem uma errata pronta para envio. Revise e envie essa errata, ou descarte-a antes de fazer outra.';
  end if;

  -- ---- A errata ----
  insert into public.jobs_erratas (
    tenant_id, job_id, titulo,
    custo_orcado_antes, custo_orcado_depois,
    valor_job_antes, valor_job_depois,
    faturamento_previsto_antes, faturamento_previsto_depois,
    created_by, preparada_por, estrutura
  ) values (
    v_job.tenant_id, p_job_id, e->>'titulo',
    (e->>'custo_orcado_antes')::numeric, (e->>'custo_orcado_depois')::numeric,
    (e->>'valor_job_antes')::numeric, (e->>'valor_job_depois')::numeric,
    (e->>'faturamento_previsto_antes')::numeric, (e->>'faturamento_previsto_depois')::numeric,
    v_uid, v_preparada,
    -- Decisão 162: o que mudou na organização, como o pop-up mostrou.
    case when jsonb_typeof(est->'resumo') = 'array' and jsonb_array_length(est->'resumo') > 0
         then est->'resumo' end
  )
  returning id into v_errata_id;

  -- ---- Decisão 162: agrupamentos renomeados ----
  -- Em dois passos, para dois agrupamentos poderem trocar de nome entre si.
  for v_g in select * from jsonb_array_elements(coalesce(est->'grupos_renomeados', '[]'::jsonb))
  loop
    update public.jobs_grupos
       set nome = '~' || id::text, updated_at = now()
     where id = (v_g->>'id')::uuid
       and job_id = p_job_id
       and removido_em is null;
    if not found then
      raise exception 'Um dos agrupamentos renomeados não é deste job.';
    end if;
  end loop;
  for v_g in select * from jsonb_array_elements(coalesce(est->'grupos_renomeados', '[]'::jsonb))
  loop
    update public.jobs_grupos
       set nome = btrim(v_g->>'nome'), updated_at = now()
     where id = (v_g->>'id')::uuid
       and job_id = p_job_id;
  end loop;

  -- ---- Decisão 162: agrupamentos novos ----
  -- A âncora tem de ser um agrupamento da versão aprovada deste job; o mês
  -- vem dela. Entram no fim da ordem.
  select coalesce(max(g.ordem), 0) into v_ordem
    from public.jobs_grupos g where g.job_id = p_job_id;
  for v_g in select * from jsonb_array_elements(coalesce(est->'grupos_novos', '[]'::jsonb))
  loop
    select v.mes_id into v_mes
      from public.versoes_orcamento_grupos v
     where v.id = (v_g->>'ancora')::uuid
       and v.versao_orcamento_id = v_job.versao_orcamento_aprovada_id;
    if not found then
      raise exception 'Um dos agrupamentos novos não pertence à versão aprovada deste job.';
    end if;
    v_ordem := v_ordem + 1;
    insert into public.jobs_grupos (
      tenant_id, job_id, grupo_versao_id, mes_id, nome, ordem, criado_na_errata_id
    ) values (
      v_job.tenant_id, p_job_id, (v_g->>'ancora')::uuid, v_mes,
      btrim(v_g->>'nome'), v_ordem, v_errata_id
    )
    returning id into v_gid;
    v_grupos := v_grupos || jsonb_build_object(v_g->>'chave', v_gid);
  end loop;

  -- ---- Linhas novas, com a âncora de realizado ----
  -- Decisão 162: o agrupamento da linha é o do JOB (ou a chave de um novo);
  -- o gatilho `jio_grupo_do_job` põe a âncora em `grupo_id`.
  for v_nova in select * from jsonb_array_elements(coalesce(p->'novas', '[]'::jsonb))
  loop
    v_gid := case
      when v_grupos ? (v_nova->>'grupo_id') then (v_grupos->>(v_nova->>'grupo_id'))::uuid
      else (v_nova->>'grupo_id')::uuid
    end;
    -- A tela de antes desta decisão manda o agrupamento da VERSÃO: vale o
    -- do job que o copia. Fica enquanto houver aba aberta da versão antiga.
    if v_gid is not null and not exists (
      select 1 from public.jobs_grupos g where g.id = v_gid and g.job_id = p_job_id
    ) then
      select g.id into v_gid
        from public.jobs_grupos g
       where g.job_id = p_job_id
         and g.grupo_versao_id = v_gid
         and g.criado_na_errata_id is null
         and g.removido_em is null;
    end if;
    if v_gid is null then
      raise exception 'Uma das linhas novas veio sem agrupamento. Recarregue a página.';
    end if;
    insert into public.jobs_itens_orcado (
      tenant_id, job_id, item_versao_id, errata_origem_id, linha_vermelha,
      job_grupo_id, grupo_id, ordem, item, tipo_custo,
      valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
      valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
    ) values (
      v_job.tenant_id, p_job_id, null, v_errata_id, (v_nova->>'linha_vermelha')::boolean,
      v_gid,
      (select g.grupo_versao_id from public.jobs_grupos g where g.id = v_gid),
      (v_nova->>'ordem')::integer, v_nova->>'item',
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

  -- ---- Decisão 162: a sequência das linhas ----
  -- Cada linha no agrupamento e na posição da tela. A linha nova vem pela
  -- chave. O gatilho confere que o agrupamento é do job, que está de pé e
  -- que a linha não muda de mês.
  for v_g in select * from jsonb_array_elements(coalesce(est->'ordem', '[]'::jsonb))
  loop
    v_id := case
      when v_g ? 'chave_nova' then (v_novas->>(v_g->>'chave_nova'))::uuid
      else (v_g->>'id')::uuid
    end;
    v_gid := case
      when v_grupos ? (v_g->>'grupo') then (v_grupos->>(v_g->>'grupo'))::uuid
      else (v_g->>'grupo')::uuid
    end;
    if v_id is null or v_gid is null then
      raise exception 'A nova ordem das linhas veio incompleta. Recarregue a página.';
    end if;
    update public.jobs_itens_orcado
       set job_grupo_id = v_gid,
           ordem = (v_g->>'ordem')::integer,
           updated_at = now()
     where id = v_id
       and job_id = p_job_id
       and (job_grupo_id is distinct from v_gid or ordem is distinct from (v_g->>'ordem')::integer);
    if not found and not exists (
      select 1 from public.jobs_itens_orcado o where o.id = v_id and o.job_id = p_job_id
    ) then
      raise exception 'Uma das linhas da nova ordem não pertence a este job.';
    end if;
  end loop;

  -- ---- Decisão 162: agrupamentos que ficaram vazios ----
  for v_gid in
    select (x #>> '{}')::uuid
      from jsonb_array_elements(coalesce(est->'grupos_removidos', '[]'::jsonb)) x
  loop
    if exists (select 1 from public.jobs_itens_orcado o where o.job_grupo_id = v_gid) then
      raise exception 'Um agrupamento marcado para sair ainda tem linhas. Recarregue a página.';
    end if;
    update public.jobs_grupos
       set removido_em = now(),
           removido_na_errata_id = v_errata_id,
           updated_at = now()
     where id = v_gid
       and job_id = p_job_id
       and removido_em is null;
    if not found then
      raise exception 'Um dos agrupamentos removidos não é deste job ou já tinha saído.';
    end if;
  end loop;

  -- Decisão 162: dois agrupamentos de pé com o mesmo nome no mesmo mês.
  if exists (
    select 1
      from public.jobs_grupos g
     where g.job_id = p_job_id
       and g.removido_em is null
     group by g.mes_id, lower(btrim(g.nome))
    having count(*) > 1
  ) then
    raise exception 'Já existe um agrupamento com esse nome neste job.';
  end if;

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

  -- Decisão 159: a pronta sai de cena junto com a errata que ela virou.
  if v_pronta is not null then
    update public.jobs_erratas_prontas
       set situacao = 'enviada',
           errata_id = v_errata_id,
           enviada_por = v_uid,
           enviada_em = now()
     where id = v_pronta;
  end if;

  return jsonb_build_object('errata_id', v_errata_id, 'bvs_cancelados', v_bvs);
end;
$function$;

revoke all on function public.registrar_errata_do_job(uuid, jsonb) from public, anon;
grant execute on function public.registrar_errata_do_job(uuid, jsonb) to authenticated;

-- ---- 7. O pedido de save guarda o nome do agrupamento do JOB --------------
-- `save_pedir`, `save_enviar_pendentes` e `save_registrar_errata` (decisão
-- 099) gravam o nome do agrupamento da linha no pedido e no histórico.
-- Com o job renomeando agrupamentos, o nome certo é o do job. A troca é
-- feita no corpo que está no banco, trecho a trecho, e PARA se o trecho não
-- for achado — assim nenhum outro pedaço das funções muda.
do $$
declare
  v_def  text;
  v_novo text;
begin
  -- save_pedir
  v_def := pg_get_functiondef('public.save_pedir(uuid, public.save_aprovacao_tipo, jsonb, jsonb, jsonb)'::regprocedure);
  v_novo := replace(v_def,
    'select g.nome into v_grupo from public.versoes_orcamento_grupos g where g.id = o.grupo_id;',
    'select g.nome into v_grupo from public.jobs_grupos g where g.id = o.job_grupo_id;');
  if v_novo = v_def then raise exception 'save_pedir: trecho do agrupamento não encontrado'; end if;
  execute v_novo;

  -- save_registrar_errata
  v_def := pg_get_functiondef('public.save_registrar_errata(uuid, jsonb)'::regprocedure);
  v_novo := replace(v_def,
    'select g.nome into v_grupo from public.versoes_orcamento_grupos g where g.id = o.grupo_id;',
    'select g.nome into v_grupo from public.jobs_grupos g where g.id = o.job_grupo_id;');
  if v_novo = v_def then raise exception 'save_registrar_errata: trecho do agrupamento não encontrado'; end if;
  execute v_novo;

  -- save_enviar_pendentes
  v_def := pg_get_functiondef('public.save_enviar_pendentes(uuid, text, jsonb)'::regprocedure);
  v_novo := replace(v_def,
    'left join public.versoes_orcamento_grupos g on g.id = o.grupo_id',
    'left join public.jobs_grupos g on g.id = o.job_grupo_id');
  if v_novo = v_def then raise exception 'save_enviar_pendentes: trecho do agrupamento não encontrado'; end if;
  execute v_novo;
end;
$$;
