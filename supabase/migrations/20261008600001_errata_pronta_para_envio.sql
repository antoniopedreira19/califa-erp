-- =====================================================================
-- Errata pronta para envio — decisão 159 (08/10/2026)
--
-- Pedido do Tiago: a errata se divide em duas etapas quando quem a faz é
-- o PRODUTOR. Ele corrige a planilha, escreve a descrição (opcional para
-- ele) e deixa a errata "pronta para envio"; quem a envia ao financeiro é
-- um GP (ou o administrador), que pode mexer na planilha e corrigir ou
-- escrever a descrição — obrigatória para ele. Até o envio a errata pronta
-- não pesa em nada: o orçado do job, o faturamento previsto e o mural do
-- financeiro seguem como estavam.
--
-- As respostas que moldam este arquivo (todas as recomendações aceitas):
--   1. uma errata pronta por job (índice único parcial em `situacao`);
--   2. o GP pode mexer na planilha da pronta antes de enviar — o envio
--      grava o que ele confirmou, e a pronta só registra que foi enviada;
--   3. qualquer produtor, GP ou administrador edita ou descarta a pronta;
--   4. o envio para faturamento fica travado com pronta parada (a trava é
--      da action `enviarJobParaFaturamento`, como a da revisão da abertura);
--   5. aviso ao GP fora da página do job fica para a fase de notificações.
--
-- O que muda no que já existe:
--   * `registrar_errata_do_job` passa a conferir o PAPEL: só GP e
--     administrador registram. Até aqui a função (SECURITY INVOKER) e a
--     policy de `jobs_erratas` aceitavam qualquer membro que não fosse
--     freelancer — o produtor, que não via o botão, registrava por chamada
--     direta. A policy fica como está: a função é o único caminho de
--     escrita por `authenticated` (a errata de save passa pela
--     `save_registrar_errata`, que é SECURITY DEFINER).
--   * a mesma função consome a pronta (`errata_pronta_id` no payload) na
--     mesma transação, e recusa errata nova enquanto houver pronta parada
--     no job — senão uma correção passaria por cima da outra.
--   * `jobs_erratas.preparada_por`: quem preparou a errata que o GP enviou.
--     O autor (`created_by`) continua sendo quem enviou. A FK nova para
--     `profiles` não confunde os embeds de hoje: todos usam a dica
--     `profiles!created_by`.
--
-- Histórico sem DELETE: a pronta enviada ou descartada fica, com quem fez
-- e quando. Depois de sair de `pronta` a linha não muda mais (gatilho).
-- =====================================================================

create table if not exists public.jobs_erratas_prontas (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id),
  job_id                      uuid not null references public.jobs(id) on delete cascade,
  situacao                    text not null default 'pronta'
                                check (situacao in ('pronta', 'enviada', 'descartada')),
  -- O que a errata decide, no formato que vai à action no envio:
  -- {alteracoes: [...], novas: [...], cancelamentos: [...]}.
  conteudo                    jsonb not null
                                check (jsonb_typeof(conteudo) = 'object'),
  -- Opcional para quem prepara; o GP escreve ou corrige no envio.
  descricao                   text
                                check (descricao is null or char_length(btrim(descricao)) between 1 and 500),
  -- "2 linhas alteradas · 1 linha nova", para a faixa não remontar a planilha.
  resumo                      text not null,
  -- A conta no momento em que foi deixada pronta. No envio vale a conta de
  -- novo, com a planilha de então.
  custo_orcado_antes          numeric(14,2) not null,
  custo_orcado_depois         numeric(14,2) not null,
  valor_job_antes             numeric(14,2) not null,
  valor_job_depois            numeric(14,2) not null,
  faturamento_previsto_antes  numeric(14,2) not null,
  faturamento_previsto_depois numeric(14,2) not null,
  -- A última gravação: quem editou a pronta passa a ser quem a preparou.
  preparada_por               uuid not null references public.profiles(id),
  preparada_em                timestamptz not null default now(),
  -- O envio: a errata registrada, quem enviou e quando.
  errata_id                   uuid references public.jobs_erratas(id) on delete set null,
  enviada_por                 uuid references public.profiles(id),
  enviada_em                  timestamptz,
  descartada_por              uuid references public.profiles(id),
  descartada_em               timestamptz,
  created_by                  uuid references public.profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint chk_errata_pronta_enviada
    check ((situacao = 'enviada') = (enviada_em is not null)),
  constraint chk_errata_pronta_descartada
    check ((situacao = 'descartada') = (descartada_em is not null))
);

-- Uma pronta por job (decisão 159, resposta 1).
create unique index if not exists uq_jobs_erratas_prontas_uma_por_job
  on public.jobs_erratas_prontas (job_id)
  where situacao = 'pronta';
create index if not exists idx_jobs_erratas_prontas_job
  on public.jobs_erratas_prontas (job_id, created_at desc);
create index if not exists idx_jobs_erratas_prontas_tenant
  on public.jobs_erratas_prontas (tenant_id);
create index if not exists idx_jobs_erratas_prontas_errata
  on public.jobs_erratas_prontas (errata_id);
create index if not exists idx_jobs_erratas_prontas_preparada_por
  on public.jobs_erratas_prontas (preparada_por);

alter table public.jobs_erratas_prontas enable row level security;

-- Quem faz errata: administrador, GP e produtor. O financeiro não vê a
-- pronta — ela não foi enviada; o freelancer não faz errata.
drop policy if exists jobs_erratas_prontas_select on public.jobs_erratas_prontas;
create policy jobs_erratas_prontas_select on public.jobs_erratas_prontas
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (select public.session_role()) in (
      'administrador'::public.app_role,
      'gerente_producao'::public.app_role,
      'produtor'::public.app_role
    )
  );

drop policy if exists jobs_erratas_prontas_insert on public.jobs_erratas_prontas;
create policy jobs_erratas_prontas_insert on public.jobs_erratas_prontas
  for insert to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and (select public.session_role()) in (
      'administrador'::public.app_role,
      'gerente_producao'::public.app_role,
      'produtor'::public.app_role
    )
    and situacao = 'pronta'
    and preparada_por = (select auth.uid())
  );

drop policy if exists jobs_erratas_prontas_update on public.jobs_erratas_prontas;
create policy jobs_erratas_prontas_update on public.jobs_erratas_prontas
  for update to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (select public.session_role()) in (
      'administrador'::public.app_role,
      'gerente_producao'::public.app_role,
      'produtor'::public.app_role
    )
  )
  with check (
    public.is_tenant_member(tenant_id)
    and (select public.session_role()) in (
      'administrador'::public.app_role,
      'gerente_producao'::public.app_role,
      'produtor'::public.app_role
    )
    -- Quem edita a pronta passa a ser quem a preparou. Enviar e descartar
    -- não mexem nesse campo.
    and (situacao <> 'pronta' or preparada_por = (select auth.uid()))
  );

revoke all on table public.jobs_erratas_prontas from public, anon;
grant select, insert, update on public.jobs_erratas_prontas to authenticated;

-- ---- A pronta só anda para a frente ----
-- Enviada ou descartada, não muda mais. Enviar é do GP e do administrador,
-- e só com a errata registrada (quem faz isso é `registrar_errata_do_job`).
-- Job e tenant não trocam. Editar a pronta carimba a hora.
create or replace function public.errata_pronta_guarda()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.situacao <> 'pronta' then
    raise exception 'Esta errata pronta já foi enviada ou descartada. Recarregue a página.';
  end if;
  if new.job_id <> old.job_id or new.tenant_id <> old.tenant_id then
    raise exception 'A errata pronta não muda de job.';
  end if;
  if new.situacao = 'enviada' then
    if new.errata_id is null then
      raise exception 'A errata pronta só é dada por enviada junto com a errata registrada.';
    end if;
    if coalesce((select public.session_role())::text, '') not in ('administrador', 'gerente_producao') then
      raise exception 'Só o GP ou o administrador envia a errata ao financeiro.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_errata_pronta_guarda on public.jobs_erratas_prontas;
create trigger trg_errata_pronta_guarda
  before update on public.jobs_erratas_prontas
  for each row execute function public.errata_pronta_guarda();

-- ---- Quem preparou a errata enviada ----
alter table public.jobs_erratas
  add column if not exists preparada_por uuid references public.profiles(id);

create index if not exists idx_erratas_preparada_por
  on public.jobs_erratas (preparada_por);

-- ---- registrar_errata_do_job: papel, e a pronta consumida junto ----
-- Corpo igual ao de 20261007100002 (decisão 151), com três acréscimos
-- marcados "Decisão 159".
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
begin
  -- Decisão 159: só o GP e o administrador registram errata. O produtor
  -- deixa a errata pronta para envio (`jobs_erratas_prontas`).
  if coalesce((select public.session_role())::text, '') not in ('administrador', 'gerente_producao') then
    raise exception 'Só o GP ou o administrador envia a errata ao financeiro. O produtor deixa a errata pronta para envio.';
  end if;

  select j.id, j.tenant_id, j.abertura_em_revisao
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
    created_by, preparada_por
  ) values (
    v_job.tenant_id, p_job_id, e->>'titulo',
    (e->>'custo_orcado_antes')::numeric, (e->>'custo_orcado_depois')::numeric,
    (e->>'valor_job_antes')::numeric, (e->>'valor_job_depois')::numeric,
    (e->>'faturamento_previsto_antes')::numeric, (e->>'faturamento_previsto_depois')::numeric,
    v_uid, v_preparada
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
revoke all on function public.errata_pronta_guarda() from public, anon;

comment on table public.jobs_erratas_prontas is
  'Errata deixada PRONTA PARA ENVIO pelo produtor (decisao 159): um GP ou o administrador revisa e envia ao financeiro. Uma pronta por job; enviada ou descartada, nao muda mais. Ate o envio nao mexe no job.';
comment on column public.jobs_erratas_prontas.conteudo is
  'O que a errata decide, no formato da action registrarErrata: {alteracoes, novas, cancelamentos}. O GP abre a errata a partir dele.';
comment on column public.jobs_erratas_prontas.descricao is
  'A "Descricao da errata" de quem preparou. Opcional; o GP escreve ou corrige no envio, e a errata registrada guarda a dele.';
comment on column public.jobs_erratas_prontas.preparada_por is
  'Quem gravou a pronta pela ultima vez. Vai para jobs_erratas.preparada_por no envio.';
comment on column public.jobs_erratas.preparada_por is
  'Decisao 159: quem preparou a errata que o GP enviou (a errata pronta para envio). Nulo na errata feita e enviada pela mesma pessoa. O autor continua em created_by.';
