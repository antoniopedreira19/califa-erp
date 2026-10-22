-- =============================================================================
-- 20261021800001 — O fechamento da conciliação com o banco (task 029, fase 4:
-- M4.1 e M4.3; decisão 203)
-- =============================================================================
-- Depois de conferir a conta com o extrato do banco, o financeiro FECHA a
-- conciliação até um dia: o caixa da conta até ali (o Extrato e o DFC) não muda
-- mais, até alguém reabrir com motivo (especificação, seção 6; protótipo,
-- `fecharPeriodo`, `reabrirPeriodo` e `diaCompleto` em `main.jsx`).
--
-- • `conciliacao_fechamentos` (M4.1): uma linha por fechamento. Um ATIVO por
--   conta (índice único parcial); o histórico são as linhas inativas — as
--   reabertas (com quem, quando e o motivo) e as que um fechamento mais
--   adiante substituiu.
-- • `condicoes_do_fechamento(conta)`: até onde dá para fechar e as três
--   condições, calculadas no banco. A tela usa a MESMA função para ligar o
--   botão, e `fechar_conciliacao` confere por ela: o botão e a recusa nunca
--   divergem.
--   - até onde: o último dia completo dos extratos importados (o fim do
--     período, se o arquivo foi gerado depois dele; a véspera, se no mesmo
--     dia, no dia de Brasília — `diaCompleto` de `banco-dados.ts`);
--   - nenhuma linha do banco até lá pendente (sem lançamento e não ignorada);
--   - nenhum lançamento da conta até lá, num dia que o extrato cobre por
--     inteiro, sem linha do banco;
--   - o saldo do dia bate: o do banco é o saldo informado (LEDGERBAL) da
--     importação mais recente menos as linhas depois do dia; o do sistema é o
--     saldo inicial da conta mais os lançamentos até o dia
--     (`calcularSaldoAnterior`).
-- • `fechar_conciliacao(conta, até)` (M4.3): confere tudo e grava. Com um
--   fechamento ativo, só fecha MAIS ADIANTE (o ativo vira histórico); para
--   voltar atrás, reabre-se.
-- • `reabrir_conciliacao(conta, motivo)` (M4.3): motivo com pelo menos 10
--   caracteres.
-- • A trava das linhas do banco (M4.2, a parte do módulo): conciliar, ignorar
--   e desfazer linha com data até o fechamento são recusados, e o extrato que
--   traz movimento NOVO até lá também (reimportar o mesmo arquivo continua
--   valendo: a linha repetida não entra). `desfazer_conciliacao` confere antes
--   de mexer, porque o desfazer da baixa cancela pela tela depois dele.
--   A trava dos lançamentos é a migration seguinte (tabela de outro módulo).
--
-- Acesso: só admin e financeiro leem (RLS) e só eles fecham e reabrem (trava
-- de papel nas funções SECURITY DEFINER). GRANT de select para
-- `authenticated`, nada para `anon`. Auditoria: `conciliacao.fechada` e
-- `conciliacao.reaberta`.
--
-- Mudança ADITIVA: tabela, índices, funções e gatilho novos; a
-- `desfazer_conciliacao` (deste módulo) ganha só a conferência do fechamento.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Os fechamentos (M4.1)
-- -----------------------------------------------------------------------------
create table public.conciliacao_fechamentos (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete restrict,
  conta_bancaria_id   uuid not null references public.contas_bancarias(id) on delete restrict,
  ate                 date not null,
  fechado_em          timestamptz not null default now(),
  fechado_por         uuid not null references public.profiles(id),
  reaberto_em         timestamptz,
  reaberto_por        uuid references public.profiles(id),
  motivo_reabertura   text,
  ativo               boolean not null default true,
  constraint chk_conciliacao_fechamento_reabertura check (
    (reaberto_em is null) = (reaberto_por is null)
    and (reaberto_em is null) = (motivo_reabertura is null)
  ),
  constraint chk_conciliacao_fechamento_reaberto_inativo check (reaberto_em is null or not ativo),
  constraint chk_conciliacao_fechamento_motivo check (
    motivo_reabertura is null or length(btrim(motivo_reabertura)) between 10 and 1000
  )
);

comment on table public.conciliacao_fechamentos is
  'O fechamento da conciliação com o banco (decisão 203): um ativo por conta; com ele, o caixa da conta até `ate` não muda até reabrir. As linhas inativas são o histórico (reabertas, com o motivo, ou substituídas por um fechamento mais adiante).';

create unique index uq_conciliacao_fechamentos_ativo on public.conciliacao_fechamentos (conta_bancaria_id) where ativo;
create index idx_conciliacao_fechamentos_conta on public.conciliacao_fechamentos (tenant_id, conta_bancaria_id, fechado_em desc);
create index idx_conciliacao_fechamentos_fechado_por on public.conciliacao_fechamentos (fechado_por);
create index idx_conciliacao_fechamentos_reaberto_por on public.conciliacao_fechamentos (reaberto_por) where reaberto_por is not null;

alter table public.conciliacao_fechamentos enable row level security;

create policy conciliacao_fechamentos_select on public.conciliacao_fechamentos
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

revoke all on public.conciliacao_fechamentos from public, anon, authenticated;
grant select on public.conciliacao_fechamentos to authenticated;

-- -----------------------------------------------------------------------------
-- 2. A trava: até quando a conta está fechada
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER: o gatilho dos lançamentos roda também para quem não lê
-- os fechamentos pela RLS (uma RPC de outro papel), e a trava vale para todos.
create or replace function public._conciliacao_fechada_ate(p_conta_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select ate from public.conciliacao_fechamentos where conta_bancaria_id = p_conta_id and ativo;
$$;

revoke all on function public._conciliacao_fechada_ate(uuid) from public, anon, authenticated;

create or replace function public._exige_periodo_aberto(p_conta_id uuid, p_data date)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ate date;
begin
  if p_conta_id is null or p_data is null then return; end if;
  v_ate := public._conciliacao_fechada_ate(p_conta_id);
  if v_ate is not null and p_data <= v_ate then
    raise exception 'Período fechado até %: reabra a conciliação para mudar esse lançamento.', to_char(v_ate, 'DD/MM')
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function public._exige_periodo_aberto(uuid, date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. A trava das linhas do banco
-- -----------------------------------------------------------------------------
create or replace function public.extrato_linha_respeita_o_fechamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ate date;
begin
  if tg_op = 'INSERT' then
    v_ate := public._conciliacao_fechada_ate(new.conta_bancaria_id);
    if v_ate is null or new.data > v_ate then
      return new;
    end if;
    -- A linha repetida não entra (o `on conflict` da importação a descarta):
    -- reimportar um arquivo que cobre o período fechado continua valendo.
    if not exists (
      select 1 from public.extrato_linhas
       where tenant_id = new.tenant_id and conta_bancaria_id = new.conta_bancaria_id and digital = new.digital
    ) then
      raise exception 'O arquivo traz um movimento novo de %, e a conciliação desta conta está fechada até %: reabra a conciliação para importar este extrato.',
        to_char(new.data, 'DD/MM/YYYY'), to_char(v_ate, 'DD/MM')
        using errcode = '55000';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform public._exige_periodo_aberto(old.conta_bancaria_id, old.data);
    return old;
  end if;

  if (new.data, new.valor, new.conta_bancaria_id, new.ignorada_em, new.conciliada_como, new.grupo, new.desfazer)
     is distinct from
     (old.data, old.valor, old.conta_bancaria_id, old.ignorada_em, old.conciliada_como, old.grupo, old.desfazer) then
    perform public._exige_periodo_aberto(old.conta_bancaria_id, old.data);
    perform public._exige_periodo_aberto(new.conta_bancaria_id, new.data);
  end if;
  return new;
end;
$$;

revoke all on function public.extrato_linha_respeita_o_fechamento() from public, anon, authenticated;

create trigger trg_extrato_linha_respeita_o_fechamento
  before insert or update or delete on public.extrato_linhas
  for each row execute function public.extrato_linha_respeita_o_fechamento();

-- O desfazer confere o fechamento ANTES de mexer: o da baixa nascida na
-- conciliação devolve as baixas para a tela cancelar, e a recusa viria só
-- depois, com a auditoria do desfazer já gravada. O resto é o de antes
-- (20261021700004).
create or replace function public.desfazer_conciliacao(p_linha_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid;
  v_linha     extrato_linhas%rowtype;
  r_linha     extrato_linhas%rowtype;
  r_l         lancamentos_financeiros%rowtype;
  d           jsonb;
  v_cancelar  jsonb := '[]'::jsonb;
  v_item      jsonb;
  v_linhas    uuid[] := '{}';
  v_cor       baixa_correcoes%rowtype;
  v_ret       numeric;
begin
  select * into v_linha from public.extrato_linhas where id = p_linha_id for update;
  if not found then raise exception 'Linha do extrato não encontrada.'; end if;
  v_uid := public._exige_financeiro_conciliacao(v_linha.tenant_id);

  -- O fechamento (decisão 203): a linha, as do grupo e os lançamentos ligados.
  perform public._exige_periodo_aberto(l.conta_bancaria_id, l.data)
     from public.extrato_linhas l
    where l.id = v_linha.id or (v_linha.grupo is not null and l.grupo = v_linha.grupo);
  perform public._exige_periodo_aberto(f.conta_bancaria_id, f.data_movimento)
     from public.lancamentos_financeiros f
     join public.extrato_linhas l on l.id = f.extrato_linha_id
    where l.id = v_linha.id or (v_linha.grupo is not null and l.grupo = v_linha.grupo);

  for r_linha in
    select * from public.extrato_linhas
     where id = v_linha.id or (v_linha.grupo is not null and grupo = v_linha.grupo)
     order by ordem
     for update
  loop
    v_linhas := v_linhas || r_linha.id;

    if r_linha.ignorada_em is not null then
      update public.extrato_linhas
         set ignorada_em = null, ignorada_por = null, motivo_ignorada = null, sem_auto = true
       where id = r_linha.id;
      continue;
    end if;
    if not exists (select 1 from public.lancamentos_financeiros where extrato_linha_id = r_linha.id) then
      continue;
    end if;

    if r_linha.conciliada_como in ('baixa', 'avulso') then
      for r_l in
        select * from public.lancamentos_financeiros
         where extrato_linha_id = r_linha.id and origem <> 'juros_baixa'
      loop
        v_item := public._cancelamento_da_baixa(r_l);
        if v_item is not null and not v_cancelar @> jsonb_build_array(v_item) then
          v_cancelar := v_cancelar || jsonb_build_array(v_item);
        end if;
      end loop;
      update public.extrato_linhas set sem_auto = true where id = r_linha.id;
    elsif r_linha.conciliada_como in ('regra', 'par') then
      if r_linha.conciliada_como = 'regra' and r_linha.desfazer ? 'regra_id' then
        update public.extrato_regras set usos = greatest(usos - 1, 0) where id = (r_linha.desfazer->>'regra_id')::uuid;
      end if;
      delete from public.lancamentos_financeiros
       where extrato_linha_id = r_linha.id and origem in ('manual', 'devolucao_bancaria');
    elsif r_linha.conciliada_como = 'correcao' then
      select * into v_cor from public.baixa_correcoes where id = (r_linha.desfazer->>'correcao_id')::uuid for update;
      if not found then raise exception 'A correção desta linha não foi achada.'; end if;
      perform public.cancelar_baixa_lancamento(v_cor.lancamento_id, 'Correção pela conciliação com o banco desfeita');
      select coalesce(sum((x->>'valor')::numeric), 0) into v_ret from jsonb_array_elements(v_cor.de->'retencoes') x;
      perform public._refazer_baixa(
        v_cor.documento_origem, v_cor.documento_id, (v_cor.de->>'data')::date, r_linha.conta_bancaria_id,
        (v_cor.de->>'tipo_id')::uuid, (v_cor.de->>'subtipo_id')::uuid, (v_cor.de->>'forma')::forma_pagamento,
        (v_cor.de->>'principal')::numeric + v_ret, v_cor.de->'retencoes', (v_cor.de->>'juros')::numeric);
      update public.baixa_correcoes set desfeita_em = now(), desfeita_por = v_uid where id = v_cor.id;
    else
      update public.lancamentos_financeiros set extrato_linha_id = null where extrato_linha_id = r_linha.id;
      for d in select value from jsonb_array_elements(coalesce(r_linha.desfazer->'datas', '[]'::jsonb)) loop
        if exists (select 1 from public.lancamentos_financeiros where id = (d->>'id')::uuid) then
          perform public._mudar_data_do_lancamento((d->>'id')::uuid, (d->>'de')::date);
        end if;
      end loop;
    end if;

    if r_linha.conciliada_como is distinct from 'baixa' and r_linha.conciliada_como is distinct from 'avulso' then
      update public.extrato_linhas
         set conciliada_como = null, conciliada_em = null, conciliada_por = null, desfazer = null,
             grupo = null, resolvida_sozinha = null, sem_auto = true
       where id = r_linha.id;
    end if;
  end loop;

  perform public._auditar_extrato(v_linha, 'extrato.conciliacao_desfeita', v_uid,
    jsonb_build_object('linhas', to_jsonb(v_linhas), 'como', v_linha.conciliada_como,
                       'ignorada', v_linha.ignorada_em is not null, 'cancelar', v_cancelar));
  return jsonb_build_object('linhas', to_jsonb(v_linhas), 'cancelar', v_cancelar);
end;
$$;

revoke all on function public.desfazer_conciliacao(uuid) from public, anon;
grant execute on function public.desfazer_conciliacao(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. As condições do fechamento
-- -----------------------------------------------------------------------------
-- O último dia completo de uma importação: o fim do período, se o arquivo foi
-- gerado depois dele (no dia de Brasília); a véspera, se no mesmo dia.
create or replace function public._dia_completo_da_importacao(p_fim date, p_gerado_em timestamptz)
returns date
language sql
stable
set search_path = public
as $$
  select case
    when p_fim is null then null
    when p_gerado_em is not null and (p_gerado_em at time zone 'America/Sao_Paulo')::date > p_fim then p_fim
    else p_fim - 1
  end;
$$;

revoke all on function public._dia_completo_da_importacao(date, timestamptz) from public, anon, authenticated;

-- As três condições num dia, sem trava de papel (quem chama confere).
create or replace function public._condicoes_do_fechamento(p_conta_id uuid, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_conta       contas_bancarias%rowtype;
  v_pendentes   integer;
  v_sem_linha   integer;
  v_saldo_banco numeric;
  v_saldo_em    date;
  v_banco       numeric;
  v_sistema     numeric;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_id;
  if not found or p_ate is null then
    return null;
  end if;

  select count(*)::int into v_pendentes
    from public.extrato_linhas l
   where l.conta_bancaria_id = p_conta_id
     and l.data <= p_ate
     and l.ignorada_em is null
     and not exists (select 1 from public.lancamentos_financeiros f where f.extrato_linha_id = l.id);

  select count(*)::int into v_sem_linha
    from public.lancamentos_financeiros f
   where f.conta_bancaria_id = p_conta_id
     and f.extrato_linha_id is null
     and f.data_movimento <= p_ate
     and exists (
       select 1 from public.extrato_importacoes i
        where i.conta_bancaria_id = p_conta_id
          and i.periodo_inicio is not null
          and f.data_movimento >= i.periodo_inicio
          and f.data_movimento <= public._dia_completo_da_importacao(i.periodo_fim, i.gerado_em)
     );

  -- O saldo do banco no fim do dia: o informado na importação mais recente,
  -- andando pelas linhas entre a data dele e o dia.
  select i.saldo_banco, i.saldo_em into v_saldo_banco, v_saldo_em
    from public.extrato_importacoes i
   where i.conta_bancaria_id = p_conta_id and i.saldo_banco is not null and i.saldo_em is not null
   order by i.saldo_em desc, i.created_at desc
   limit 1;
  if v_saldo_banco is not null then
    v_banco := v_saldo_banco
      - coalesce((select sum(valor) from public.extrato_linhas
                   where conta_bancaria_id = p_conta_id and data > p_ate and data <= v_saldo_em), 0)
      + coalesce((select sum(valor) from public.extrato_linhas
                   where conta_bancaria_id = p_conta_id and data > v_saldo_em and data <= p_ate), 0);
  end if;

  -- O saldo do sistema no fim do dia (`calcularSaldoAnterior` do dia seguinte).
  v_sistema := v_conta.saldo_inicial;
  if p_ate >= v_conta.saldo_inicial_data then
    v_sistema := v_sistema + coalesce((
      select sum(case when natureza = 'entrada' then valor else -valor end)
        from public.lancamentos_financeiros
       where conta_bancaria_id = p_conta_id
         and data_movimento >= v_conta.saldo_inicial_data
         and data_movimento <= p_ate), 0);
  end if;

  return jsonb_build_object(
    'ate', p_ate,
    'linhas_pendentes', v_pendentes,
    'sem_linha', v_sem_linha,
    'saldo_banco', round(v_banco, 2),
    'saldo_sistema', round(v_sistema, 2),
    'diferenca', case when v_banco is null then null else round(v_banco - v_sistema, 2) end
  );
end;
$$;

revoke all on function public._condicoes_do_fechamento(uuid, date) from public, anon, authenticated;

-- Para a tela: até onde dá para fechar e as condições nesse dia.
create or replace function public.condicoes_do_fechamento(p_conta_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_conta  contas_bancarias%rowtype;
  v_ate    date;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  perform public._exige_financeiro_conciliacao(v_conta.tenant_id);

  select max(public._dia_completo_da_importacao(i.periodo_fim, i.gerado_em)) into v_ate
    from public.extrato_importacoes i
   where i.conta_bancaria_id = p_conta_id;
  if v_ate is null then
    return jsonb_build_object('ate', null);
  end if;
  return public._condicoes_do_fechamento(p_conta_id, v_ate);
end;
$$;

revoke all on function public.condicoes_do_fechamento(uuid) from public, anon;
grant execute on function public.condicoes_do_fechamento(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Fechar e reabrir (M4.3)
-- -----------------------------------------------------------------------------
create or replace function public.fechar_conciliacao(p_conta_id uuid, p_ate date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid;
  v_conta   contas_bancarias%rowtype;
  v_max     date;
  v_ativo   conciliacao_fechamentos%rowtype;
  v_cond    jsonb;
  v_n       integer;
  v_id      uuid;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  v_uid := public._exige_financeiro_conciliacao(v_conta.tenant_id);
  if p_ate is null then raise exception 'Escolha até que dia fechar.'; end if;

  select max(public._dia_completo_da_importacao(i.periodo_fim, i.gerado_em)) into v_max
    from public.extrato_importacoes i
   where i.conta_bancaria_id = p_conta_id;
  if v_max is null then
    raise exception 'Importe o extrato do banco antes de fechar a conciliação.';
  end if;
  if p_ate > v_max then
    raise exception 'Dá para fechar só até %, o último dia completo dos extratos importados.', to_char(v_max, 'DD/MM');
  end if;

  select * into v_ativo from public.conciliacao_fechamentos
   where conta_bancaria_id = p_conta_id and ativo
   for update;
  if found and p_ate <= v_ativo.ate then
    raise exception 'A conciliação desta conta já está fechada até %.', to_char(v_ativo.ate, 'DD/MM');
  end if;

  v_cond := public._condicoes_do_fechamento(p_conta_id, p_ate);
  v_n := (v_cond->>'linhas_pendentes')::int;
  if v_n > 0 then
    raise exception '% até % sem conciliar: concilie ou ignore antes de fechar.',
      case when v_n = 1 then '1 linha do banco' else v_n || ' linhas do banco' end, to_char(p_ate, 'DD/MM');
  end if;
  v_n := (v_cond->>'sem_linha')::int;
  if v_n > 0 then
    raise exception '% até % sem linha no extrato do banco: corrija ou cancele antes de fechar.',
      case when v_n = 1 then '1 lançamento' else v_n || ' lançamentos' end, to_char(p_ate, 'DD/MM');
  end if;
  if v_cond->>'diferenca' is null then
    raise exception 'O extrato importado não informa o saldo do banco: importe um arquivo com o saldo para fechar.';
  end if;
  if (v_cond->>'diferenca')::numeric <> 0 then
    raise exception 'O saldo de % não bate: banco %, sistema %.', to_char(p_ate, 'DD/MM'),
      public._moeda_br((v_cond->>'saldo_banco')::numeric), public._moeda_br((v_cond->>'saldo_sistema')::numeric);
  end if;

  if v_ativo.id is not null then
    update public.conciliacao_fechamentos set ativo = false where id = v_ativo.id;
  end if;
  insert into public.conciliacao_fechamentos (tenant_id, conta_bancaria_id, ate, fechado_por)
  values (v_conta.tenant_id, p_conta_id, p_ate, v_uid)
  returning id into v_id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_conta.tenant_id, 'conciliacao_fechamento', v_id::text, 'conciliacao.fechada', v_uid,
          jsonb_build_object('conta_bancaria_id', p_conta_id, 'ate', p_ate, 'antes_ate', v_ativo.ate,
                             'saldo', v_cond->'saldo_banco'));
  return v_id;
end;
$$;

revoke all on function public.fechar_conciliacao(uuid, date) from public, anon;
grant execute on function public.fechar_conciliacao(uuid, date) to authenticated;

create or replace function public.reabrir_conciliacao(p_conta_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid;
  v_conta   contas_bancarias%rowtype;
  v_ativo   conciliacao_fechamentos%rowtype;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  v_uid := public._exige_financeiro_conciliacao(v_conta.tenant_id);
  if length(v_motivo) < 10 then
    raise exception 'Explique o motivo (pelo menos 10 caracteres).';
  end if;
  if length(v_motivo) > 1000 then
    raise exception 'O motivo passa de 1.000 caracteres: resuma.';
  end if;

  select * into v_ativo from public.conciliacao_fechamentos
   where conta_bancaria_id = p_conta_id and ativo
   for update;
  if not found then
    raise exception 'A conciliação desta conta não está fechada.';
  end if;

  update public.conciliacao_fechamentos
     set ativo = false, reaberto_em = now(), reaberto_por = v_uid, motivo_reabertura = v_motivo
   where id = v_ativo.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_conta.tenant_id, 'conciliacao_fechamento', v_ativo.id::text, 'conciliacao.reaberta', v_uid,
          jsonb_build_object('conta_bancaria_id', p_conta_id, 'ate', v_ativo.ate, 'motivo', v_motivo));
end;
$$;

revoke all on function public.reabrir_conciliacao(uuid, text) from public, anon;
grant execute on function public.reabrir_conciliacao(uuid, text) to authenticated;
