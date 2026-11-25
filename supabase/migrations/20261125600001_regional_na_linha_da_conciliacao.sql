-- =============================================================================
-- 20261125600001 — Conciliação: a regional trocada na linha, como o centro de
-- custo (decisão 280; Tiago, 25/11/2026)
-- =============================================================================
-- Pedido do Tiago: na Conciliação automática, trocar a regional (coluna REG)
-- do mesmo jeito que o Tipo e o Subtipo, com as regionais da empresa do
-- lançamento e o TD (o rateio da tabela da empresa, como o colaborador TD do
-- RH e a recorrência TD da decisão 272).
--
-- Decidido pelo Tiago (25/11/2026), com os números de produção:
-- - lançamento de JOB (PP, NF de job, estorno de verba, recebimento antes da
--   NF) NÃO troca: a regional é a do job (decisão 069 continua valendo);
-- - no que não tem job, a troca grava NO DOCUMENTO: o rateio do avulso
--   (`contas_avulsas_regionais`), da nota avulsa (`faturamentos_regionais`),
--   do desembolso (`desembolsos_regionais`), a regional da baixa manual
--   (`lancamentos_financeiros.regional_id`) e a da linha da planilha
--   (`historico_movimentos`). Títulos, Fluxo e DRE passam a mostrar a nova;
--   previsto e realizado continuam iguais.
--
-- 1. `conciliacao_regionais`: o rascunho, como `conciliacao_centros` — a
--    regional escolhida para um lançamento (chave da tela "t:", "l:", "h:"),
--    guardada até a conciliação (sobrevive a recarregar a página e a trocar
--    de pessoa). Grava por `salvar_regional_da_conciliacao`.
--
-- 2. `trocar_regional_pela_conciliacao`: aplicada na hora do Conciliar,
--    antes da baixa/ligação da linha (como `trocar_centro_das_previsoes`).
--    - TD = a tabela `empresas_rateios_regionais` da empresa do documento, do
--      ano da data do lançamento (ou o último antes dele), copiada para o
--      rateio do documento; na baixa manual e na linha da planilha, TD é
--      "sem regional" / `regional_todas`, como já são hoje.
--    - Recusa: job, folha (alocação do RH), notas de sócio, nota do save
--      avulso (decisão 247), imposto, fatura do cartão, transferência e
--      mútuo; linha da planilha já conciliada; e período fechado em
--      qualquer baixa do documento (`_exige_periodo_aberto`).
--    - Audita cada documento (`*.regional_alterada`, de/para).
--
-- Mudança ADITIVA: uma tabela e três funções novas. Nenhuma função, view ou
-- tabela existente muda de forma. As funções escrevem em rateios que hoje já
-- são editados pelas telas de cada documento (mesmas travas de soma 100%).
-- GRANT de execute para `authenticated`, nada para `anon`; a tabela só tem
-- leitura direta (a escrita é pela função).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. O rascunho
-- -----------------------------------------------------------------------------
create table if not exists public.conciliacao_regionais (
  conta_bancaria_id  uuid not null references public.contas_bancarias(id) on delete restrict,
  item               text not null check (item ~ '^[tlh]:.+'),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  regional_id        uuid references public.regionais(id) on delete restrict,
  td                 boolean not null default false,
  escolhido_por      uuid not null references public.profiles(id),
  escolhido_em       timestamptz not null default now(),
  primary key (conta_bancaria_id, item),
  constraint ck_conciliacao_regionais_uma_escolha check ((td and regional_id is null) or (not td and regional_id is not null))
);
comment on table public.conciliacao_regionais is
  'Decisão 280: a regional escolhida na Conciliação automática para um lançamento (uma regional da empresa ou TD, o rateio da tabela), aplicada ao documento quando ele é conciliado. Grava por salvar_regional_da_conciliacao.';
create index if not exists idx_conciliacao_regionais_tenant on public.conciliacao_regionais (tenant_id);
create index if not exists idx_conciliacao_regionais_regional on public.conciliacao_regionais (regional_id);
create index if not exists idx_conciliacao_regionais_por on public.conciliacao_regionais (escolhido_por);

alter table public.conciliacao_regionais enable row level security;
drop policy if exists conciliacao_regionais_select on public.conciliacao_regionais;
create policy conciliacao_regionais_select on public.conciliacao_regionais
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
  );
revoke all on public.conciliacao_regionais from public, anon, authenticated;
grant select on public.conciliacao_regionais to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Guardar a escolha (rascunho; sem auditoria, nada muda no caixa ainda)
-- -----------------------------------------------------------------------------
create or replace function public.salvar_regional_da_conciliacao(p_conta_id uuid, p_item text, p_regional_id uuid, p_td boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  v_uid    uuid;
begin
  select c.tenant_id into v_tenant from public.contas_bancarias c where c.id = p_conta_id;
  if not found then
    raise exception 'A conta não existe mais: recarregue a página.';
  end if;
  v_uid := public._exige_financeiro_conciliacao(v_tenant);
  if p_item is null or p_item !~ '^[tlh]:.+' then
    raise exception 'Lançamento inválido.';
  end if;
  if p_regional_id is null and not coalesce(p_td, false) then
    delete from public.conciliacao_regionais where conta_bancaria_id = p_conta_id and item = p_item;
    return;
  end if;
  if not coalesce(p_td, false)
     and not exists (select 1 from public.regionais g where g.id = p_regional_id and g.tenant_id = v_tenant and g.ativo) then
    raise exception 'A regional não é deste cadastro.';
  end if;

  insert into public.conciliacao_regionais (conta_bancaria_id, item, tenant_id, regional_id, td, escolhido_por, escolhido_em)
  values (p_conta_id, p_item, v_tenant, case when coalesce(p_td, false) then null else p_regional_id end, coalesce(p_td, false), v_uid, now())
  on conflict (conta_bancaria_id, item) do update
     set regional_id = excluded.regional_id, td = excluded.td,
         escolhido_por = excluded.escolhido_por, escolhido_em = excluded.escolhido_em;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 3. O rateio da escolha: uma regional da empresa (100%) ou o TD da tabela
--    (o ano do lançamento ou o último antes dele, como a recorrência TD).
--    Devolve [{regional_id, percentual}]. Interna: sem GRANT.
-- -----------------------------------------------------------------------------
create or replace function public._rateio_da_regional_escolhida(p_tenant uuid, p_empresa uuid, p_regional_id uuid, p_td boolean, p_ano integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_ano  integer;
  v_soma numeric;
  v_out  jsonb;
begin
  if p_empresa is null then
    raise exception 'O lançamento não tem empresa: a regional não muda por aqui.';
  end if;
  if coalesce(p_td, false) then
    select max(r.ano_vigencia) into v_ano
      from public.empresas_rateios_regionais r
     where r.tenant_id = p_tenant and r.empresa_id = p_empresa and r.ano_vigencia <= p_ano;
    select coalesce(sum(r.percentual), 0),
           jsonb_agg(jsonb_build_object('regional_id', r.regional_id, 'percentual', r.percentual) order by r.percentual desc)
      into v_soma, v_out
      from public.empresas_rateios_regionais r
     where r.tenant_id = p_tenant and r.empresa_id = p_empresa and r.ano_vigencia = v_ano;
    if v_ano is null or abs(v_soma - 100) > 0.01 then
      raise exception 'Esta empresa não tem a tabela de rateio (TD) completa. Escolha uma regional.';
    end if;
    return v_out;
  end if;
  if p_regional_id is null then
    raise exception 'Escolha a regional.';
  end if;
  if not exists (select 1 from public.regionais g
                  where g.id = p_regional_id and g.tenant_id = p_tenant and g.empresa_id = p_empresa and g.ativo) then
    raise exception 'Escolha uma regional da empresa do lançamento.';
  end if;
  return jsonb_build_array(jsonb_build_object('regional_id', p_regional_id, 'percentual', 100));
end;
$function$;

-- -----------------------------------------------------------------------------
-- 4. Aplicar a escolha ao documento (no Conciliar)
--    p_tipo: 'avulsa' (ids de contas_avulsas), 'desembolso' (ids de
--    desembolsos_parcelas), 'titulo_receber' (ids de titulos_receber),
--    'baixa' (ids de lancamentos_financeiros) ou 'planilha' (ids de
--    historico_movimentos).
-- -----------------------------------------------------------------------------
create or replace function public.trocar_regional_pela_conciliacao(p_tipo text, p_ids uuid[], p_regional_id uuid, p_td boolean, p_data date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid;
  v_tenant    uuid;
  v_td        boolean := coalesce(p_td, false);
  v_ano       integer := extract(year from coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date))::integer;
  v_ids       uuid[];
  v_avulsas   uuid[] := '{}';
  v_desembs   uuid[] := '{}';
  v_fats      uuid[] := '{}';
  v_lancs     uuid[] := '{}';
  v_hist      uuid[] := '{}';
  v_rateio    jsonb;
  v_de        jsonb;
  v_docs      integer := 0;
  r           record;
begin
  if p_tipo is null or p_tipo not in ('avulsa', 'desembolso', 'titulo_receber', 'baixa', 'planilha')
     or coalesce(cardinality(p_ids), 0) = 0 or cardinality(p_ids) > 100 then
    raise exception 'Lançamento inválido.';
  end if;
  if not v_td and p_regional_id is null then
    raise exception 'Escolha a regional.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_ids) x;

  -- O cadastro (tenant) de quem pede: o do primeiro documento; todos têm de ser dele.
  v_tenant := case p_tipo
    when 'avulsa'         then (select a.tenant_id from public.contas_avulsas a where a.id = v_ids[1])
    when 'desembolso'     then (select d.tenant_id from public.desembolsos_parcelas d where d.id = v_ids[1])
    when 'titulo_receber' then (select t.tenant_id from public.titulos_receber t where t.id = v_ids[1])
    when 'baixa'          then (select l.tenant_id from public.lancamentos_financeiros l where l.id = v_ids[1])
    else                       (select h.tenant_id from public.historico_movimentos h where h.id = v_ids[1])
  end;
  if v_tenant is null then
    raise exception 'O lançamento não existe mais: recarregue a página.';
  end if;
  v_uid := public._exige_financeiro_conciliacao(v_tenant);

  -- 4.1 De cada lançamento, o documento que guarda a regional
  if p_tipo = 'avulsa' then
    v_avulsas := v_ids;
  elsif p_tipo = 'desembolso' then
    select coalesce(array_agg(distinct d.desembolso_id), '{}') into v_desembs
      from public.desembolsos_parcelas d where d.id = any (v_ids) and d.tenant_id = v_tenant;
  elsif p_tipo = 'titulo_receber' then
    if exists (select 1 from public.titulos_receber t where t.id = any (v_ids) and t.faturamento_id is null) then
      raise exception 'O título não tem nota: a regional não muda por aqui.';
    end if;
    select coalesce(array_agg(distinct t.faturamento_id), '{}') into v_fats
      from public.titulos_receber t where t.id = any (v_ids) and t.tenant_id = v_tenant;
  elsif p_tipo = 'planilha' then
    v_hist := v_ids;
  else
    for r in
      select l.id, l.tenant_id, l.origem::text as origem, l.job_id, l.conta_avulsa_id, l.desembolso_id, l.titulo_receber_id
        from public.lancamentos_financeiros l
       where l.id = any (v_ids) and l.origem::text <> 'juros_baixa'
    loop
      if r.tenant_id <> v_tenant then
        raise exception 'Os lançamentos são de cadastros diferentes.';
      end if;
      if r.origem like 'pp\_%' or r.origem = 'recebimento_antes_nf' or r.job_id is not null then
        raise exception 'Lançamento de job: a regional é a do job (decisão 069).';
      elsif r.origem like 'transferencia%' or r.origem like 'mutuo%' then
        raise exception 'Transferência entre contas não tem regional.';
      elsif r.origem = 'imposto_baixa' then
        raise exception 'Imposto: o rateio da regional vem da apuração.';
      elsif r.origem like 'fatura\_cartao%' then
        raise exception 'Fatura do cartão: cada compra tem a regional dela.';
      elsif r.origem = 'avulsa_baixa' and r.conta_avulsa_id is not null then
        v_avulsas := v_avulsas || r.conta_avulsa_id;
      elsif r.origem = 'desembolso_baixa' and r.desembolso_id is not null then
        v_desembs := v_desembs || r.desembolso_id;
      elsif r.origem = 'titulo_baixa' and r.titulo_receber_id is not null then
        v_fats := v_fats || (select t.faturamento_id from public.titulos_receber t where t.id = r.titulo_receber_id);
      elsif r.origem = 'manual' then
        v_lancs := v_lancs || r.id;
      else
        raise exception 'A regional deste lançamento não muda por aqui.';
      end if;
    end loop;
  end if;

  -- 4.2 Avulso (e recorrência: só esta ocorrência)
  for r in
    select a.* from public.contas_avulsas a where a.id = any (v_avulsas) order by a.id for update
  loop
    if r.tenant_id <> v_tenant then
      raise exception 'Os lançamentos são de cadastros diferentes.';
    end if;
    if r.job_id is not null then
      raise exception 'Avulso de job: a regional é a do job (decisão 069).';
    end if;
    if r.folha_id is not null or r.colaborador_id is not null or r.beneficio_fechamento_id is not null then
      raise exception 'Folha: a regional vem da alocação do colaborador no RH.';
    end if;
    if public._eh_notas_de_socio(r.plano_conta_subtipo_id) then
      raise exception 'Notas de sócio: a regional é a das notas e não muda.';
    end if;
    perform public._exige_periodo_aberto(l.conta_bancaria_id, l.data_movimento)
       from public.lancamentos_financeiros l where l.conta_avulsa_id = r.id;
    v_rateio := public._rateio_da_regional_escolhida(v_tenant, r.empresa_id, p_regional_id, v_td, v_ano);
    select coalesce(jsonb_agg(jsonb_build_object('regional_id', x.regional_id, 'percentual', x.percentual) order by x.percentual desc), '[]'::jsonb)
      into v_de from public.contas_avulsas_regionais x where x.conta_avulsa_id = r.id;
    delete from public.contas_avulsas_regionais where conta_avulsa_id = r.id;
    insert into public.contas_avulsas_regionais (tenant_id, conta_avulsa_id, regional_id, percentual)
    select v_tenant, r.id, (e->>'regional_id')::uuid, (e->>'percentual')::numeric
      from jsonb_array_elements(v_rateio) e;
    insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
    values (v_tenant, 'conta_avulsa', r.id::text, 'conta_avulsa.regional_alterada', v_uid,
            jsonb_build_object('de', v_de, 'para', v_rateio, 'td', v_td, 'origem', 'conciliacao_dia_a_dia'));
    v_docs := v_docs + 1;
  end loop;

  -- 4.3 Desembolso (não tem job: CHECK desembolso_nao_tem_job)
  for r in
    select d.* from public.desembolsos d where d.id = any (v_desembs) order by d.id for update
  loop
    if r.tenant_id <> v_tenant then
      raise exception 'Os lançamentos são de cadastros diferentes.';
    end if;
    perform public._exige_periodo_aberto(l.conta_bancaria_id, l.data_movimento)
       from public.lancamentos_financeiros l where l.desembolso_id = r.id;
    v_rateio := public._rateio_da_regional_escolhida(v_tenant, r.empresa_id, p_regional_id, v_td, v_ano);
    select coalesce(jsonb_agg(jsonb_build_object('regional_id', x.regional_id, 'percentual', x.percentual) order by x.percentual desc), '[]'::jsonb)
      into v_de from public.desembolsos_regionais x where x.desembolso_id = r.id;
    delete from public.desembolsos_regionais where desembolso_id = r.id;
    insert into public.desembolsos_regionais (desembolso_id, regional_id, percentual)
    select r.id, (e->>'regional_id')::uuid, (e->>'percentual')::numeric
      from jsonb_array_elements(v_rateio) e;
    insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
    values (v_tenant, 'desembolso', r.id::text, 'desembolso.regional_alterada', v_uid,
            jsonb_build_object('de', v_de, 'para', v_rateio, 'td', v_td, 'origem', 'conciliacao_dia_a_dia'));
    v_docs := v_docs + 1;
  end loop;

  -- 4.4 Nota avulsa (a nota de job ou de BV fica na regional do job)
  for r in
    select f.* from public.faturamentos f where f.id = any (v_fats) order by f.id for update
  loop
    if r.tenant_id <> v_tenant then
      raise exception 'Os lançamentos são de cadastros diferentes.';
    end if;
    if r.origem_tipo::text <> 'avulso' then
      raise exception 'NF de job: a regional é a do job (decisão 069).';
    end if;
    if exists (select 1 from public.saves_avulsos s where s.faturamento_id = r.id) then
      raise exception 'Nota do save avulso: a regional é a do job que consumir o save (decisão 247).';
    end if;
    perform public._exige_periodo_aberto(l.conta_bancaria_id, l.data_movimento)
       from public.lancamentos_financeiros l
       join public.titulos_receber t on t.id = l.titulo_receber_id
      where t.faturamento_id = r.id;
    v_rateio := public._rateio_da_regional_escolhida(v_tenant, r.empresa_id, p_regional_id, v_td, v_ano);
    select coalesce(jsonb_agg(jsonb_build_object('regional_id', x.regional_id, 'percentual', x.percentual) order by x.percentual desc), '[]'::jsonb)
      into v_de from public.faturamentos_regionais x where x.faturamento_id = r.id;
    delete from public.faturamentos_regionais where faturamento_id = r.id;
    insert into public.faturamentos_regionais (tenant_id, faturamento_id, regional_id, percentual)
    select v_tenant, r.id, (e->>'regional_id')::uuid, (e->>'percentual')::numeric
      from jsonb_array_elements(v_rateio) e;
    insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
    values (v_tenant, 'faturamento', r.id::text, 'faturamento.regional_alterada', v_uid,
            jsonb_build_object('de', v_de, 'para', v_rateio, 'td', v_td, 'origem', 'conciliacao_dia_a_dia'));
    v_docs := v_docs + 1;
  end loop;

  -- 4.5 Baixa manual (regra do extrato, lançamento à mão): a regional dela; TD = sem regional, como a tarifa
  for r in
    select l.* from public.lancamentos_financeiros l where l.id = any (v_lancs) order by l.id for update
  loop
    perform public._exige_periodo_aberto(r.conta_bancaria_id, r.data_movimento);
    perform public._rateio_da_regional_escolhida(v_tenant, r.empresa_id, p_regional_id, v_td, v_ano);
    update public.lancamentos_financeiros
       set regional_id = case when v_td then null else p_regional_id end
     where id = r.id;
    insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
    values (v_tenant, 'lancamento_financeiro', r.id::text, 'lancamento.regional_alterada', v_uid,
            jsonb_build_object('de', r.regional_id, 'para', case when v_td then null else p_regional_id end, 'td', v_td,
                               'origem', 'conciliacao_dia_a_dia'));
    v_docs := v_docs + 1;
  end loop;

  -- 4.6 Linha da planilha ainda sem banco: a regional dela; TD = "todas", como a planilha escreve
  for r in
    select h.* from public.historico_movimentos h where h.id = any (v_hist) order by h.id for update
  loop
    if r.tenant_id <> v_tenant then
      raise exception 'Os lançamentos são de cadastros diferentes.';
    end if;
    if r.extrato_linha_id is not null then
      raise exception 'A linha da planilha já está conciliada: desfaça antes de trocar a regional.';
    end if;
    perform public._rateio_da_regional_escolhida(v_tenant, r.empresa_id, p_regional_id, v_td, v_ano);
    update public.historico_movimentos h
       set regional_id    = case when v_td then null else p_regional_id end,
           regional_nome  = case when v_td then null else (select g.nome from public.regionais g where g.id = p_regional_id) end,
           regional_todas = v_td
     where h.id = r.id;
    insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
    values (v_tenant, 'historico_movimento', r.id::text, 'historico.regional_alterada', v_uid,
            jsonb_build_object('de', jsonb_build_object('regional', r.regional_id, 'nome', r.regional_nome, 'todas', r.regional_todas),
                               'para', jsonb_build_object('regional', case when v_td then null else p_regional_id end, 'todas', v_td),
                               'origem', 'conciliacao_dia_a_dia'));
    v_docs := v_docs + 1;
  end loop;

  if v_docs = 0 then
    raise exception 'O lançamento não existe mais: recarregue a página.';
  end if;
  return jsonb_build_object('documentos', v_docs);
end;
$function$;

revoke all on function public.salvar_regional_da_conciliacao(uuid, text, uuid, boolean) from public, anon;
revoke all on function public._rateio_da_regional_escolhida(uuid, uuid, uuid, boolean, integer) from public, anon, authenticated;
revoke all on function public.trocar_regional_pela_conciliacao(text, uuid[], uuid, boolean, date) from public, anon;
grant execute on function public.salvar_regional_da_conciliacao(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.trocar_regional_pela_conciliacao(text, uuid[], uuid, boolean, date) to authenticated;
