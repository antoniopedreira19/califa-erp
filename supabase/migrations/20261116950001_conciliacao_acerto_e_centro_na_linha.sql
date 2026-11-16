-- =============================================================================
-- 20261116950001 — Conciliação dia a dia: o acerto da linha guardado no banco,
-- o centro de custo trocado na linha e o valor do título corrigido pela linha
-- (decisão 262, parte 1; Tiago, 16/11/2026)
-- =============================================================================
-- A Conciliação automática passou a trabalhar assim (protótipo aprovado em
-- 16/11/2026, versão 56): a linha do banco vem vazia, o financeiro escolhe o
-- lançamento (a sugestão do sistema é a primeira opção), escolhe o ajuste da
-- diferença quando há, pode trocar o centro de custo de qualquer lançamento,
-- e concilia a linha ("Conciliar") ou tudo o que foi acertado de uma vez.
--
-- 1. O acerto fica guardado no banco até a conciliação (escolha do Tiago:
--    sobrevive a recarregar a página e a trocar de computador; outra pessoa
--    do financeiro continua). Duas tabelas de rascunho, só da conciliação:
--    - `conciliacao_acertos`: por linha do banco, os lançamentos escolhidos
--      (as chaves da tela: "t:<título>", "l:<lançamento>", "h:<planilha>"),
--      o ajuste e o caso especial (regra, PIX que voltou, mútuo).
--    - `conciliacao_centros`: o centro de custo escolhido para um lançamento
--      (vale onde ele aparecer: na linha, na sugestão, em Só no sistema). O
--      subtipo pode ficar por escolher (o tipo trocado primeiro).
--    Gravam pelas funções `salvar_acerto_da_linha` e
--    `salvar_centro_da_conciliacao` (admin e financeiro). A linha conciliada
--    não guarda acerto: a função apaga. A retirada do extrato apaga o acerto
--    das linhas (on delete cascade).
--
-- 2. O centro de custo trocado na linha é gravado na conciliação:
--    - título: a baixa sai com o centro escolhido (a baixa de sempre);
--    - baixa já feita: `trocar_centro_dos_lancamentos` (os juros da baixa
--      ficam com o centro deles; período aberto pelo gatilho de sempre);
--    - linha da planilha: `trocar_centro_das_previsoes` (o plano e a sigla do
--      grupo da linha; só a linha ainda sem banco).
--    Sem restrição de tipo (pedido do Tiago: "não faça restrições"). Audita.
--
-- 3. "Corrigir o valor do título" (o custo fixo com valor estimado):
--    `corrigir_valor_do_titulo_pela_linha` passa o título avulso em aberto ao
--    valor que o banco pagou, antes da baixa pela linha. Só título avulso (ou
--    de recorrência) em aberto, linha de pagamento ainda sem conciliação,
--    período aberto. Audita `conta_avulsa.valor_corrigido`.
--
-- Mudança ADITIVA: duas tabelas e cinco funções novas. Nenhuma função ou
-- tabela existente muda. GRANT de execute para `authenticated`, nada para
-- `anon`; as tabelas só têm leitura direta (a escrita é pelas funções).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. As tabelas do acerto
-- -----------------------------------------------------------------------------
create table if not exists public.conciliacao_acertos (
  extrato_linha_id   uuid primary key references public.extrato_linhas(id) on delete cascade,
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  conta_bancaria_id  uuid not null references public.contas_bancarias(id) on delete restrict,
  itens              text[] not null default '{}',
  ajuste             text check (ajuste is null or ajuste in ('juros', 'retencao', 'parcial', 'correcao', 'valor')),
  especial           jsonb,
  acertado_por       uuid not null references public.profiles(id),
  acertado_em        timestamptz not null default now()
);
comment on table public.conciliacao_acertos is
  'Decisão 262: o acerto de uma linha do banco na Conciliação automática (os lançamentos escolhidos, o ajuste, o caso especial), guardado até a conciliação. Grava por salvar_acerto_da_linha.';
create index if not exists idx_conciliacao_acertos_conta on public.conciliacao_acertos (conta_bancaria_id);
create index if not exists idx_conciliacao_acertos_tenant on public.conciliacao_acertos (tenant_id);
create index if not exists idx_conciliacao_acertos_por on public.conciliacao_acertos (acertado_por);

create table if not exists public.conciliacao_centros (
  conta_bancaria_id       uuid not null references public.contas_bancarias(id) on delete restrict,
  item                    text not null check (item ~ '^[tlh]:.+'),
  tenant_id               uuid not null references public.tenants(id) on delete restrict,
  plano_conta_tipo_id     uuid not null references public.plano_contas_tipos(id) on delete restrict,
  plano_conta_subtipo_id  uuid references public.plano_contas_subtipos(id) on delete restrict,
  escolhido_por           uuid not null references public.profiles(id),
  escolhido_em            timestamptz not null default now(),
  primary key (conta_bancaria_id, item)
);
comment on table public.conciliacao_centros is
  'Decisão 262: o centro de custo escolhido na Conciliação automática para um lançamento (título, baixa ou linha da planilha), aplicado quando ele é conciliado. O subtipo pode ficar por escolher. Grava por salvar_centro_da_conciliacao.';
create index if not exists idx_conciliacao_centros_tenant on public.conciliacao_centros (tenant_id);
create index if not exists idx_conciliacao_centros_tipo on public.conciliacao_centros (plano_conta_tipo_id);
create index if not exists idx_conciliacao_centros_subtipo on public.conciliacao_centros (plano_conta_subtipo_id);
create index if not exists idx_conciliacao_centros_por on public.conciliacao_centros (escolhido_por);

alter table public.conciliacao_acertos enable row level security;
alter table public.conciliacao_centros enable row level security;
drop policy if exists conciliacao_acertos_select on public.conciliacao_acertos;
create policy conciliacao_acertos_select on public.conciliacao_acertos
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
  );
drop policy if exists conciliacao_centros_select on public.conciliacao_centros;
create policy conciliacao_centros_select on public.conciliacao_centros
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
  );
revoke all on public.conciliacao_acertos from public, anon, authenticated;
revoke all on public.conciliacao_centros from public, anon, authenticated;
grant select on public.conciliacao_acertos to authenticated;
grant select on public.conciliacao_centros to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Guardar o acerto e o centro (rascunho; sem auditoria, nada é gravado no
--    caixa até a conciliação)
-- -----------------------------------------------------------------------------
create or replace function public.salvar_acerto_da_linha(p_linha_id uuid, p_itens text[], p_ajuste text, p_especial jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  v_conta  uuid;
  v_feita  boolean;
  v_uid    uuid;
begin
  select l.tenant_id, l.conta_bancaria_id, (l.conciliada_como is not null or l.ignorada_em is not null)
    into v_tenant, v_conta, v_feita
    from public.extrato_linhas l
   where l.id = p_linha_id;
  if not found then
    raise exception 'A linha do banco não existe mais: recarregue a página.';
  end if;
  v_uid := public._exige_financeiro_conciliacao(v_tenant);

  -- Sem itens e sem caso especial (o "Desfazer o acerto"), ou a linha já resolvida: sai o acerto.
  if v_feita or (coalesce(cardinality(p_itens), 0) = 0 and p_especial is null and p_ajuste is null) then
    delete from public.conciliacao_acertos where extrato_linha_id = p_linha_id;
    return;
  end if;
  if coalesce(cardinality(p_itens), 0) > 200 then
    raise exception 'Lançamentos demais numa linha.';
  end if;
  if exists (select 1 from unnest(p_itens) x where x !~ '^[tlh]:.+') then
    raise exception 'Lançamento inválido no acerto.';
  end if;

  insert into public.conciliacao_acertos (extrato_linha_id, tenant_id, conta_bancaria_id, itens, ajuste, especial, acertado_por, acertado_em)
  values (p_linha_id, v_tenant, v_conta, coalesce(p_itens, '{}'), p_ajuste, p_especial, v_uid, now())
  on conflict (extrato_linha_id) do update
     set itens = excluded.itens, ajuste = excluded.ajuste, especial = excluded.especial,
         acertado_por = excluded.acertado_por, acertado_em = excluded.acertado_em;
end;
$function$;
comment on function public.salvar_acerto_da_linha(uuid, text[], text, jsonb) is
  'Decisão 262: guarda (ou tira) o acerto de uma linha do banco na Conciliação automática, até a conciliação. Admin e financeiro.';
revoke all on function public.salvar_acerto_da_linha(uuid, text[], text, jsonb) from public, anon;
grant execute on function public.salvar_acerto_da_linha(uuid, text[], text, jsonb) to authenticated;

create or replace function public.salvar_centro_da_conciliacao(p_conta_id uuid, p_item text, p_tipo_id uuid, p_subtipo_id uuid)
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
  if p_tipo_id is null then
    delete from public.conciliacao_centros where conta_bancaria_id = p_conta_id and item = p_item;
    return;
  end if;
  if not exists (select 1 from public.plano_contas_tipos t where t.id = p_tipo_id and t.tenant_id = v_tenant) then
    raise exception 'O tipo não é deste cadastro.';
  end if;
  if p_subtipo_id is not null
     and not exists (select 1 from public.plano_contas_subtipos s where s.id = p_subtipo_id and s.tipo_id = p_tipo_id) then
    raise exception 'O subtipo não é deste tipo.';
  end if;

  insert into public.conciliacao_centros (conta_bancaria_id, item, tenant_id, plano_conta_tipo_id, plano_conta_subtipo_id, escolhido_por, escolhido_em)
  values (p_conta_id, p_item, v_tenant, p_tipo_id, p_subtipo_id, v_uid, now())
  on conflict (conta_bancaria_id, item) do update
     set plano_conta_tipo_id = excluded.plano_conta_tipo_id, plano_conta_subtipo_id = excluded.plano_conta_subtipo_id,
         escolhido_por = excluded.escolhido_por, escolhido_em = excluded.escolhido_em;
end;
$function$;
comment on function public.salvar_centro_da_conciliacao(uuid, text, uuid, uuid) is
  'Decisão 262: guarda (ou tira, com tipo nulo) o centro de custo escolhido na Conciliação automática para um lançamento. Admin e financeiro.';
revoke all on function public.salvar_centro_da_conciliacao(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.salvar_centro_da_conciliacao(uuid, text, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Gravar o centro trocado: a baixa já feita e a linha da planilha
-- -----------------------------------------------------------------------------
create or replace function public.trocar_centro_dos_lancamentos(p_lancamento_ids uuid[], p_tipo_id uuid, p_subtipo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid;
  v_ids     uuid[];
  v_n       integer;
  v_tenant  uuid;
  v_de      jsonb;
begin
  if p_tipo_id is null or p_subtipo_id is null or coalesce(cardinality(p_lancamento_ids), 0) = 0 then
    raise exception 'Escolha o tipo e o subtipo do centro de custo.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_lancamento_ids) x;
  perform 1 from public.lancamentos_financeiros where id = any (v_ids) for update;
  select count(*)::int, (min(l.tenant_id::text))::uuid into v_n, v_tenant
    from public.lancamentos_financeiros l where l.id = any (v_ids);
  if v_n <> cardinality(v_ids) then
    raise exception 'Algum lançamento não existe mais: recarregue a página.';
  end if;
  if exists (select 1 from public.lancamentos_financeiros l where l.id = any (v_ids) and l.tenant_id <> v_tenant) then
    raise exception 'Os lançamentos são de cadastros diferentes.';
  end if;
  v_uid := public._exige_financeiro_conciliacao(v_tenant);
  if not exists (select 1 from public.plano_contas_subtipos s join public.plano_contas_tipos t on t.id = s.tipo_id
                  where s.id = p_subtipo_id and t.id = p_tipo_id and t.tenant_id = v_tenant) then
    raise exception 'O subtipo não é deste tipo.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'tipo', l.plano_conta_tipo_id, 'subtipo', l.plano_conta_subtipo_id)), '[]'::jsonb)
    into v_de
    from public.lancamentos_financeiros l
   where l.id = any (v_ids) and l.origem::text <> 'juros_baixa';
  -- Os juros da baixa ficam com o centro deles. O período fechado barra pelo gatilho de sempre.
  update public.lancamentos_financeiros l
     set plano_conta_tipo_id = p_tipo_id, plano_conta_subtipo_id = p_subtipo_id
   where l.id = any (v_ids) and l.origem::text <> 'juros_baixa';

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_tenant, 'lancamento_financeiro', (v_ids[1])::text, 'lancamento.centro_alterado', v_uid,
          jsonb_build_object('de', v_de, 'para', jsonb_build_object('tipo', p_tipo_id, 'subtipo', p_subtipo_id),
                             'origem', 'conciliacao_dia_a_dia'));
  return jsonb_build_object('lancamentos', jsonb_array_length(v_de));
end;
$function$;
comment on function public.trocar_centro_dos_lancamentos(uuid[], uuid, uuid) is
  'Decisão 262: troca o centro de custo de uma baixa já feita, escolhido na linha da Conciliação automática (os juros da baixa ficam com o deles). Admin e financeiro; período aberto; auditado.';
revoke all on function public.trocar_centro_dos_lancamentos(uuid[], uuid, uuid) from public, anon;
grant execute on function public.trocar_centro_dos_lancamentos(uuid[], uuid, uuid) to authenticated;

create or replace function public.trocar_centro_das_previsoes(p_movimento_ids uuid[], p_tipo_id uuid, p_subtipo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid;
  v_ids     uuid[];
  v_n       integer;
  v_tenant  uuid;
  v_codigo  text;
  v_sigla   text;
  v_de      jsonb;
begin
  if p_tipo_id is null or p_subtipo_id is null or coalesce(cardinality(p_movimento_ids), 0) = 0 then
    raise exception 'Escolha o tipo e o subtipo do centro de custo.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_movimento_ids) x;
  perform 1 from public.historico_movimentos where id = any (v_ids) for update;
  select count(*)::int, (min(h.tenant_id::text))::uuid into v_n, v_tenant
    from public.historico_movimentos h where h.id = any (v_ids);
  if v_n <> cardinality(v_ids) then
    raise exception 'Alguma linha da planilha não existe mais: recarregue a página.';
  end if;
  if exists (select 1 from public.historico_movimentos h where h.id = any (v_ids) and (h.tenant_id <> v_tenant or h.extrato_linha_id is not null)) then
    raise exception 'A linha da planilha já está conciliada: desfaça antes de trocar o centro de custo.';
  end if;
  v_uid := public._exige_financeiro_conciliacao(v_tenant);
  select t.codigo into v_codigo
    from public.plano_contas_subtipos s join public.plano_contas_tipos t on t.id = s.tipo_id
   where s.id = p_subtipo_id and t.id = p_tipo_id and t.tenant_id = v_tenant;
  if v_codigo is null then
    raise exception 'O subtipo não é deste tipo.';
  end if;
  -- A sigla do grupo, como a planilha escreve (decisão 243).
  v_sigla := case v_codigo
    when '01' then 'REC' when '02' then 'CO' when '03' then 'CT' when '04' then 'CF' when '05' then 'DP'
    when '06' then 'DM' when '07' then 'DA' when '08' then 'DC' when '09' then 'DT' when '10' then 'RF'
    when '11' then 'DJ' when '12' then 'EMP' when '13' then 'IMOB' when '14' then 'PL' when '15' then 'DL'
    else null end;

  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'tipo', h.plano_conta_tipo_id, 'subtipo', h.plano_conta_subtipo_id, 'grupo', h.grupo)), '[]'::jsonb)
    into v_de
    from public.historico_movimentos h where h.id = any (v_ids);
  update public.historico_movimentos h
     set plano_conta_tipo_id = p_tipo_id, plano_conta_subtipo_id = p_subtipo_id, grupo = coalesce(v_sigla, h.grupo)
   where h.id = any (v_ids);

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_tenant, 'historico_movimento', (v_ids[1])::text, 'historico.centro_alterado', v_uid,
          jsonb_build_object('de', v_de, 'para', jsonb_build_object('tipo', p_tipo_id, 'subtipo', p_subtipo_id, 'grupo', v_sigla),
                             'origem', 'conciliacao_dia_a_dia'));
  return jsonb_build_object('linhas', cardinality(v_ids));
end;
$function$;
comment on function public.trocar_centro_das_previsoes(uuid[], uuid, uuid) is
  'Decisão 262: troca o centro de custo (e a sigla do grupo) de linhas da planilha ainda sem banco, escolhido na linha da Conciliação automática. Admin e financeiro; auditado.';
revoke all on function public.trocar_centro_das_previsoes(uuid[], uuid, uuid) from public, anon;
grant execute on function public.trocar_centro_das_previsoes(uuid[], uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. "Corrigir o valor do título": o título avulso passa ao valor do banco
-- -----------------------------------------------------------------------------
create or replace function public.corrigir_valor_do_titulo_pela_linha(p_linha_id uuid, p_conta_avulsa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid;
  v_tenant  uuid;
  v_conta   uuid;
  v_data    date;
  v_valor   numeric;
  v_feita   boolean;
  v_de      numeric;
  v_status  text;
  v_nat     text;
begin
  select l.tenant_id, l.conta_bancaria_id, l.data, l.valor, (l.conciliada_como is not null or l.ignorada_em is not null)
    into v_tenant, v_conta, v_data, v_valor, v_feita
    from public.extrato_linhas l where l.id = p_linha_id;
  if not found then
    raise exception 'A linha do banco não existe mais: recarregue a página.';
  end if;
  v_uid := public._exige_financeiro_conciliacao(v_tenant);
  if v_feita then
    raise exception 'A linha do banco já está conciliada.';
  end if;
  if v_valor >= 0 then
    raise exception 'Só uma linha de pagamento corrige o valor do título.';
  end if;
  perform public._exige_periodo_aberto(v_conta, v_data);

  select a.valor, a.status::text, a.natureza::text into v_de, v_status, v_nat
    from public.contas_avulsas a
   where a.id = p_conta_avulsa_id and a.tenant_id = v_tenant
   for update;
  if not found then
    raise exception 'O título não existe mais: recarregue a página.';
  end if;
  if v_status <> 'aprovada' then
    raise exception 'O título não está em aberto.';
  end if;
  if v_nat <> 'saida' then
    raise exception 'Só um título a pagar corrige o valor pela linha de pagamento.';
  end if;

  update public.contas_avulsas set valor = abs(v_valor) where id = p_conta_avulsa_id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_tenant, 'conta_avulsa', p_conta_avulsa_id::text, 'conta_avulsa.valor_corrigido', v_uid,
          jsonb_build_object('de', v_de, 'para', abs(v_valor), 'extrato_linha_id', p_linha_id, 'origem', 'conciliacao_dia_a_dia'));
  return jsonb_build_object('de', v_de, 'para', abs(v_valor));
end;
$function$;
comment on function public.corrigir_valor_do_titulo_pela_linha(uuid, uuid) is
  'Decisão 262: o ajuste "Corrigir o valor do título" da Conciliação automática — o título avulso em aberto (custo fixo com valor estimado) passa ao valor que o banco pagou, antes da baixa pela linha. Admin e financeiro; período aberto; auditado.';
revoke all on function public.corrigir_valor_do_titulo_pela_linha(uuid, uuid) from public, anon;
grant execute on function public.corrigir_valor_do_titulo_pela_linha(uuid, uuid) to authenticated;
