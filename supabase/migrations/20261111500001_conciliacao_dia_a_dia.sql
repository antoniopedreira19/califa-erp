-- =============================================================================
-- 20261111500001 — A conciliação dia a dia: mudar a data da baixa e da
-- previsão da planilha, e retirar o extrato importado (decisão 253; Tiago,
-- 11/11/2026)
-- =============================================================================
-- A Conciliação automática passou a trabalhar um dia por vez, e a
-- correspondência só vale no mesmo dia (o motor, em `lib/conciliacao`). Com
-- isso, o que está no dia errado precisa mudar de dia sem cancelar e refazer,
-- e o extrato importado errado precisa sair. Três peças, todas deste módulo:
--
-- 1. `mudar_data_da_baixa(lancamentos, data)`: a baixa lançada no dia errado
--    muda de dia. Usa a mesma `_mudar_data_do_lancamento` que a conciliação já
--    usa ao ligar a baixa à linha do banco (acompanha os juros e o `pago_em`
--    do documento). Só a baixa ainda SEM linha do banco (a conciliada tem a
--    data do banco: desfaz-se antes), com o período aberto na data antiga e na
--    nova, e sem data futura. Audita `baixa.data_alterada`.
--
-- 2. A data da previsão da planilha (carga `previsao`, decisão 232):
--    `historico_previsoes_datas` guarda a data ajustada pela tela, por conta e
--    pela impressão digital da linha da planilha. A digital é a mesma de uma
--    carga para a outra enquanto a linha da planilha não muda: a carga nova
--    NÃO sobrescreve a data ajustada (decisão do Tiago). Se a linha mudar na
--    planilha (outra data, outro valor), a digital muda e vale a planilha.
--    - `mudar_data_da_previsao(movimento, data)`: grava o ajuste e a data;
--      voltar à data da planilha apaga o ajuste. Audita
--      `historico.previsao_data_alterada`.
--    - `_historico_previsao_com_data_ajustada` (gatilho novo, BEFORE INSERT):
--      a linha da carga nova com ajuste registrado nasce na data ajustada, com
--      a da planilha em `data_prevista`.
--    - `_historico_previsao_na_data_do_banco` (já existia): ao desligar a
--      previsão da linha do banco, ela volta à data ajustada, se houver, e não
--      à da planilha. Sem ajuste, o comportamento é o de antes.
--
-- 3. Retirar o extrato importado (arquivo errado, ou recomeçar):
--    - `previa_de_retirar_extrato(conta)`: o último arquivo da conta e o que
--      sairia (linhas, conciliadas, ignoradas, a trava do fechamento).
--    - `retirar_extrato(conta, importação, motivo, desfeitas)`: apaga as
--      linhas do arquivo e o arquivo. Só o ÚLTIMO importado: a linha repetida
--      entre dois arquivos pertence ao primeiro que a trouxe, e retirar um
--      arquivo antigo abriria buracos no período do mais novo. Só com todas as
--      linhas dele sem conciliação: a tela desfaz antes, linha a linha, pelo
--      `desfazer_conciliacao` de sempre (que cancela a baixa nascida na
--      conciliação). O motivo é obrigatório quando houve conciliação desfeita.
--      Audita `extrato.retirado`.
--
-- Acesso: admin e financeiro (`_exige_financeiro_conciliacao`), os mesmos de
-- fechar e reabrir. GRANT de execute para `authenticated`, nada para `anon`.
--
-- Mudança ADITIVA: uma tabela, um gatilho e cinco funções novas. A única
-- função existente que muda é `_historico_previsao_na_data_do_banco`, e só
-- passa a olhar o ajuste (sem ajuste, igual). `retirar_extrato` apaga linhas
-- quando alguém a chama pela tela, com auditoria; a migration não apaga nada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A data da baixa
-- -----------------------------------------------------------------------------
create or replace function public.mudar_data_da_baixa(p_lancamento_ids uuid[], p_data date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid;
  v_ids      uuid[];
  v_n        integer;
  v_contas   integer;
  v_ligados  integer;
  v_tenant   uuid;
  v_conta    uuid;
  v_datas    jsonb := '[]'::jsonb;
  r          record;
begin
  if p_data is null or coalesce(cardinality(p_lancamento_ids), 0) = 0 then
    raise exception 'Escolha a baixa e a data nova.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_lancamento_ids) x;

  perform 1 from public.lancamentos_financeiros where id = any (v_ids) for update;
  select count(*)::int,
         count(distinct l.conta_bancaria_id)::int,
         (count(*) filter (where l.extrato_linha_id is not null))::int,
         (min(l.tenant_id::text))::uuid,
         (min(l.conta_bancaria_id::text))::uuid
    into v_n, v_contas, v_ligados, v_tenant, v_conta
    from public.lancamentos_financeiros l
   where l.id = any (v_ids);
  if v_n <> cardinality(v_ids) then
    raise exception 'Algum lançamento não existe mais: recarregue a página.';
  end if;
  v_uid := public._exige_financeiro_conciliacao(v_tenant);
  if exists (select 1 from public.lancamentos_financeiros l where l.id = any (v_ids) and l.tenant_id <> v_tenant) or v_contas <> 1 then
    raise exception 'Os lançamentos são de contas diferentes.';
  end if;
  if v_ligados > 0 then
    raise exception 'A baixa já está conciliada com o banco: desfaça a conciliação antes de mudar a data.';
  end if;
  if p_data > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A baixa não pode ter data futura.';
  end if;

  perform public._exige_periodo_aberto(v_conta, p_data);
  for r in
    select l.id, l.data_movimento
      from public.lancamentos_financeiros l
     where l.id = any (v_ids) and l.origem <> 'juros_baixa' and l.data_movimento <> p_data
     order by l.created_at, l.id
  loop
    perform public._exige_periodo_aberto(v_conta, r.data_movimento);
    perform public._mudar_data_do_lancamento(r.id, p_data);
    v_datas := v_datas || jsonb_build_object('id', r.id, 'de', r.data_movimento);
  end loop;

  if jsonb_array_length(v_datas) > 0 then
    insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
    values (v_tenant, 'lancamento_financeiro', (v_datas->0->>'id'), 'baixa.data_alterada', v_uid,
            jsonb_build_object('conta_bancaria_id', v_conta, 'para', p_data, 'lancamentos', v_datas,
                               'origem', 'conciliacao_dia_a_dia'));
  end if;
  return jsonb_build_object('para', p_data, 'datas', v_datas);
end;
$function$;
revoke all on function public.mudar_data_da_baixa(uuid[], date) from public, anon;
grant execute on function public.mudar_data_da_baixa(uuid[], date) to authenticated;
comment on function public.mudar_data_da_baixa(uuid[], date) is
  'Decisão 253: a baixa ainda sem linha do banco muda de dia (a mesma troca de data que a conciliação faz ao ligar), com o período aberto, sem data futura e com auditoria.';

-- -----------------------------------------------------------------------------
-- 2. A data da previsão da planilha
-- -----------------------------------------------------------------------------
create table if not exists public.historico_previsoes_datas (
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  conta_bancaria_id  uuid not null references public.contas_bancarias(id) on delete restrict,
  digital            text not null,
  data               date not null,
  data_da_planilha   date not null,
  ajustada_por       uuid not null references public.profiles(id),
  ajustada_em        timestamptz not null default now(),
  primary key (tenant_id, conta_bancaria_id, digital)
);
comment on table public.historico_previsoes_datas is
  'Decisão 253: a data que o financeiro deu, pela conciliação, a uma previsão da planilha. Guardada pela impressão digital da linha da planilha, para a carga nova das previsões não sobrescrever a data ajustada.';
create index if not exists idx_historico_previsoes_datas_conta on public.historico_previsoes_datas (conta_bancaria_id);
create index if not exists idx_historico_previsoes_datas_por on public.historico_previsoes_datas (ajustada_por);

alter table public.historico_previsoes_datas enable row level security;
drop policy if exists historico_previsoes_datas_select on public.historico_previsoes_datas;
create policy historico_previsoes_datas_select on public.historico_previsoes_datas
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
  );
revoke all on public.historico_previsoes_datas from public, anon, authenticated;
grant select on public.historico_previsoes_datas to authenticated;

-- A previsão ligada ao banco fica com a data do banco; desligada, com a
-- ajustada pela tela (se houver) ou com a da planilha.
create or replace function public._historico_previsao_na_data_do_banco()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.historico_cargas c where c.id = new.carga_id and c.tipo = 'previsao') then
    return new;
  end if;
  new.data_prevista := coalesce(old.data_prevista, old.data);
  if new.extrato_linha_id is null then
    new.data := coalesce(
      (select a.data from public.historico_previsoes_datas a
        where a.tenant_id = new.tenant_id and a.conta_bancaria_id = new.conta_bancaria_id and a.digital = new.digital),
      new.data_prevista);
  else
    new.data := coalesce((select e.data from public.extrato_linhas e where e.id = new.extrato_linha_id), new.data);
  end if;
  return new;
end;
$function$;
revoke all on function public._historico_previsao_na_data_do_banco() from public, anon, authenticated;

-- A linha da carga nova das previsões com data ajustada registrada nasce na
-- data ajustada, e a da planilha fica em `data_prevista`.
create or replace function public._historico_previsao_com_data_ajustada()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_data date;
begin
  if new.extrato_linha_id is not null then
    return new;
  end if;
  select a.data into v_data
    from public.historico_previsoes_datas a
   where a.tenant_id = new.tenant_id and a.conta_bancaria_id = new.conta_bancaria_id and a.digital = new.digital;
  if not found then
    return new;
  end if;
  if not exists (select 1 from public.historico_cargas c where c.id = new.carga_id and c.tipo = 'previsao') then
    return new;
  end if;
  new.data_prevista := coalesce(new.data_prevista, new.data);
  new.data := v_data;
  return new;
end;
$function$;
revoke all on function public._historico_previsao_com_data_ajustada() from public, anon, authenticated;

drop trigger if exists trg_historico_previsao_com_data_ajustada on public.historico_movimentos;
create trigger trg_historico_previsao_com_data_ajustada
  before insert on public.historico_movimentos
  for each row
  execute function public._historico_previsao_com_data_ajustada();

create or replace function public.mudar_data_da_previsao(p_movimento_id uuid, p_data date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid;
  v_h         historico_movimentos%rowtype;
  v_carga     historico_cargas%rowtype;
  v_planilha  date;
begin
  if p_data is null then raise exception 'Escolha a data nova.'; end if;
  select * into v_h from public.historico_movimentos where id = p_movimento_id for update;
  if not found then raise exception 'Previsão não encontrada: recarregue a página.'; end if;
  v_uid := public._exige_financeiro_conciliacao(v_h.tenant_id);
  select * into v_carga from public.historico_cargas where id = v_h.carga_id;
  if v_carga.tipo <> 'previsao' or v_carga.situacao <> 'ativa' then
    raise exception 'Só a previsão da planilha muda de data por aqui.';
  end if;
  if v_h.extrato_linha_id is not null then
    raise exception 'Esta previsão já está conciliada com o banco: desfaça a conciliação antes de mudar a data.';
  end if;
  v_planilha := coalesce(v_h.data_prevista, v_h.data);
  if v_h.data = p_data then
    return jsonb_build_object('de', v_h.data, 'para', p_data, 'data_da_planilha', v_planilha);
  end if;

  if p_data = v_planilha then
    -- De volta à data da planilha: o ajuste deixa de existir.
    delete from public.historico_previsoes_datas
     where tenant_id = v_h.tenant_id and conta_bancaria_id = v_h.conta_bancaria_id and digital = v_h.digital;
  else
    insert into public.historico_previsoes_datas (tenant_id, conta_bancaria_id, digital, data, data_da_planilha, ajustada_por)
    values (v_h.tenant_id, v_h.conta_bancaria_id, v_h.digital, p_data, v_planilha, v_uid)
    on conflict (tenant_id, conta_bancaria_id, digital)
    do update set data = excluded.data, ajustada_por = excluded.ajustada_por, ajustada_em = now();
  end if;
  update public.historico_movimentos set data = p_data, data_prevista = v_planilha where id = v_h.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_h.tenant_id, 'historico_movimento', v_h.id::text, 'historico.previsao_data_alterada', v_uid,
          jsonb_build_object('conta_bancaria_id', v_h.conta_bancaria_id, 'digital', v_h.digital, 'valor', v_h.valor,
                             'de', v_h.data, 'para', p_data, 'data_da_planilha', v_planilha));
  return jsonb_build_object('de', v_h.data, 'para', p_data, 'data_da_planilha', v_planilha);
end;
$function$;
revoke all on function public.mudar_data_da_previsao(uuid, date) from public, anon;
grant execute on function public.mudar_data_da_previsao(uuid, date) to authenticated;
comment on function public.mudar_data_da_previsao(uuid, date) is
  'Decisão 253: a previsão da planilha ainda sem linha do banco muda de data pela conciliação. O ajuste fica em historico_previsoes_datas (pela digital) e sobrevive à carga nova.';

-- -----------------------------------------------------------------------------
-- 3. Retirar o extrato importado
-- -----------------------------------------------------------------------------
create or replace function public.previa_de_retirar_extrato(p_conta_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_conta   contas_bancarias%rowtype;
  v_imp     extrato_importacoes%rowtype;
  v_linhas  integer;
  v_conc    integer;
  v_ign     integer;
  v_min     date;
  v_ate     date;
  v_presas  integer;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  perform public._exige_financeiro_conciliacao(v_conta.tenant_id);

  select * into v_imp from public.extrato_importacoes
   where conta_bancaria_id = p_conta_id
   order by created_at desc, id desc
   limit 1;
  if not found then raise exception 'Esta conta não tem extrato importado.'; end if;

  select count(*)::int,
         (count(*) filter (where v.conciliada))::int,
         (count(*) filter (where not v.conciliada and v.ignorada_em is not null))::int,
         min(v.data)
    into v_linhas, v_conc, v_ign, v_min
    from public.vw_extrato_linhas v
   where v.importacao_id = v_imp.id;
  v_ate := public._conciliacao_fechada_ate(p_conta_id);

  select count(*)::int into v_presas
    from public.extrato_linhas l
   where l.importacao_id = v_imp.id
     and (exists (select 1 from public.baixa_correcoes c where c.extrato_linha_id = l.id)
          or exists (select 1 from public.mutuos_iof_historico m where m.extrato_linha_id = l.id));

  return jsonb_build_object(
    'importacao_id', v_imp.id,
    'arquivo', v_imp.arquivo_nome,
    'linhas', v_linhas,
    'conciliadas', v_conc,
    'ignoradas', v_ign,
    'fechado_ate', case when v_ate is not null and v_min is not null and v_min <= v_ate then v_ate else null end,
    'presas', v_presas
  );
end;
$function$;
revoke all on function public.previa_de_retirar_extrato(uuid) from public, anon;
grant execute on function public.previa_de_retirar_extrato(uuid) to authenticated;

create or replace function public.retirar_extrato(
  p_conta_id uuid,
  p_importacao_id uuid,
  p_motivo text,
  p_conciliacoes_desfeitas integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid;
  v_conta   contas_bancarias%rowtype;
  v_imp     extrato_importacoes%rowtype;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_linhas  integer;
  v_conc    integer;
  v_ign     integer;
  v_min     date;
  v_ate     date;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  v_uid := public._exige_financeiro_conciliacao(v_conta.tenant_id);

  select * into v_imp from public.extrato_importacoes
   where conta_bancaria_id = p_conta_id
   order by created_at desc, id desc
   limit 1
   for update;
  if not found then raise exception 'Esta conta não tem extrato importado.'; end if;
  if v_imp.id is distinct from p_importacao_id then
    raise exception 'Outro extrato foi importado nesta conta depois: recarregue a página.';
  end if;
  if coalesce(p_conciliacoes_desfeitas, 0) > 0 and length(v_motivo) < 10 then
    raise exception 'Explique o motivo (pelo menos 10 caracteres).';
  end if;
  if length(v_motivo) > 1000 then
    raise exception 'O motivo passa de 1.000 caracteres: resuma.';
  end if;

  perform 1 from public.extrato_linhas where importacao_id = v_imp.id for update;
  select count(*)::int,
         (count(*) filter (where v.conciliada))::int,
         (count(*) filter (where not v.conciliada and v.ignorada_em is not null))::int,
         min(v.data)
    into v_linhas, v_conc, v_ign, v_min
    from public.vw_extrato_linhas v
   where v.importacao_id = v_imp.id;
  if v_conc > 0 then
    raise exception '% deste extrato: desfaça a conciliação antes de retirar.',
      case when v_conc = 1 then '1 linha ainda está conciliada' else v_conc || ' linhas ainda estão conciliadas' end;
  end if;
  v_ate := public._conciliacao_fechada_ate(p_conta_id);
  if v_ate is not null and v_min is not null and v_min <= v_ate then
    raise exception 'A conciliação desta conta está fechada até %, e este extrato tem linhas nesse período: reabra a conciliação antes de retirar o extrato.',
      to_char(v_ate, 'DD/MM')
      using errcode = '55000';
  end if;
  if exists (
    select 1 from public.extrato_linhas l
     where l.importacao_id = v_imp.id
       and (exists (select 1 from public.baixa_correcoes c where c.extrato_linha_id = l.id)
            or exists (select 1 from public.mutuos_iof_historico m where m.extrato_linha_id = l.id))
  ) then
    raise exception 'Este extrato tem linha com correção de baixa ou IOF de mútuo registrados no histórico: ele não pode ser retirado.';
  end if;

  delete from public.extrato_linhas where importacao_id = v_imp.id;
  delete from public.extrato_importacoes where id = v_imp.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_conta.tenant_id, 'extrato_importacao', v_imp.id::text, 'extrato.retirado', v_uid,
          jsonb_build_object('conta_bancaria_id', p_conta_id, 'arquivo', v_imp.arquivo_nome,
                             'periodo_inicio', v_imp.periodo_inicio, 'periodo_fim', v_imp.periodo_fim,
                             'importado_em', v_imp.created_at, 'importado_por', v_imp.importado_por,
                             'linhas', v_linhas, 'ignoradas', v_ign,
                             'conciliacoes_desfeitas', coalesce(p_conciliacoes_desfeitas, 0),
                             'motivo', nullif(v_motivo, '')));
  return jsonb_build_object('arquivo', v_imp.arquivo_nome, 'linhas', v_linhas);
end;
$function$;
revoke all on function public.retirar_extrato(uuid, uuid, text, integer) from public, anon;
grant execute on function public.retirar_extrato(uuid, uuid, text, integer) to authenticated;
comment on function public.retirar_extrato(uuid, uuid, text, integer) is
  'Decisão 253: retira o ÚLTIMO extrato importado da conta (as linhas dele e o arquivo), só com todas as linhas sem conciliação e o período aberto. A tela desfaz as conciliações antes, pelo desfazer_conciliacao. Audita extrato.retirado.';
