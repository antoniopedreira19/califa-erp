-- =============================================================================
-- A conciliação marca a linha do extrato como do histórico (decisão 211, A6)
-- =============================================================================
-- Decisão do Tiago em 27/10/2026: "Os movimentos de outubro dos jobs até o 3T
-- entram no histórico, como uma carga própria, e a conciliação marca essas
-- linhas do extrato como do histórico." A cauda (migration 20261027100007)
-- traz esses movimentos para depois do início das contas (01/10). Aqui:
--
-- 1. A linha da cauda (`historico_movimentos` de carga `cauda` ativa) liga à
--    linha do extrato pela coluna nova `extrato_linha_id`, como o lançamento
--    liga (`lancamentos_financeiros.extrato_linha_id`). A linha do extrato
--    fica conciliada `como 'historico'`; sozinha (`resolvida_sozinha =
--    'historico'`) quando a tela a resolve na leitura.
-- 2. `conciliar_linha_pelo_historico`: confere a conta, a cauda ativa, o
--    início da conta e a soma, e liga. `desfazer_conciliacao` solta.
-- 3. A conta conta a cauda: o saldo do sistema no fechamento e no resumo das
--    contas soma os movimentos da cauda desde o início da conta, e o
--    fechamento pede a linha do banco também para eles.
-- 4. A cauda nova substitui a ativa e apaga as linhas dela: as linhas do
--    extrato que estavam ligadas voltam a pendentes (sem `sem_auto`, para a
--    tela ligar de novo à cauda nova).
--
-- Aditiva: coluna e índice novos, valores novos nas duas checagens, view e
-- funções reescritas com a regra de antes mais a da cauda.
-- =============================================================================

alter table public.historico_movimentos
  add column if not exists extrato_linha_id uuid references public.extrato_linhas(id) on delete set null;
create index if not exists idx_historico_movimentos_extrato_linha
  on public.historico_movimentos (extrato_linha_id) where extrato_linha_id is not null;
comment on column public.historico_movimentos.extrato_linha_id is
  'A linha do extrato do banco que a movimentação da cauda concilia (decisão 211, A6).';

alter table public.extrato_linhas drop constraint if exists chk_extrato_linha_conciliada_como;
alter table public.extrato_linhas add constraint chk_extrato_linha_conciliada_como
  check (conciliada_como is null or conciliada_como = any (array['ligacao', 'baixa', 'avulso', 'regra', 'par', 'correcao', 'historico']));
alter table public.extrato_linhas drop constraint if exists extrato_linhas_resolvida_sozinha_check;
alter table public.extrato_linhas add constraint extrato_linhas_resolvida_sozinha_check
  check (resolvida_sozinha = any (array['manual', 'titulo', 'remessa', 'regra', 'historico']));

-- A linha conciliada: com lançamento ou com movimento da cauda.
create or replace view public.vw_extrato_linhas with (security_invoker = true) as
 select id, tenant_id, conta_bancaria_id, importacao_id, digital, data, valor, tipo, historico, documento, fitid,
        ordem, ignorada_em, ignorada_por, motivo_ignorada, resolvida_sozinha, avaliada_em, sem_auto, created_at,
        conciliada_como, conciliada_em, conciliada_por, desfazer, grupo,
        (exists (select 1 from public.lancamentos_financeiros f where f.extrato_linha_id = l.id)
         or exists (select 1 from public.historico_movimentos h where h.extrato_linha_id = l.id)) as conciliada
   from public.extrato_linhas l;

create or replace function public._linha_pendente(p_linha_id uuid)
returns extrato_linhas
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_linha extrato_linhas%rowtype;
begin
  select * into v_linha from public.extrato_linhas where id = p_linha_id for update;
  if not found then raise exception 'Linha do extrato não encontrada.'; end if;
  perform public._exige_financeiro_conciliacao(v_linha.tenant_id);
  if v_linha.ignorada_em is not null then
    raise exception 'Esta linha do banco está ignorada: desfaça antes.';
  end if;
  if exists (select 1 from public.lancamentos_financeiros where extrato_linha_id = v_linha.id)
     or exists (select 1 from public.historico_movimentos where extrato_linha_id = v_linha.id) then
    raise exception 'Esta linha do banco já está conciliada.';
  end if;
  return v_linha;
end;
$function$;

create or replace function public.conciliar_linha_pelo_historico(
  p_linha_id uuid,
  p_movimento_ids uuid[],
  p_sozinha text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid;
  v_linha  extrato_linhas%rowtype;
  v_inicio date;
  v_n      integer;
  v_soma   numeric;
begin
  v_linha := public._linha_pendente(p_linha_id);
  v_uid := public._exige_financeiro_conciliacao(v_linha.tenant_id);
  if p_sozinha is not null and p_sozinha <> 'historico' then
    raise exception 'Resolução inválida: %.', p_sozinha;
  end if;
  if coalesce(cardinality(p_movimento_ids), 0) = 0 then
    raise exception 'Escolha as linhas do histórico que esta linha do banco paga.';
  end if;
  select saldo_inicial_data into v_inicio from public.contas_bancarias where id = v_linha.conta_bancaria_id;

  perform 1 from public.historico_movimentos where id = any (p_movimento_ids) for update;
  select count(*)::int, coalesce(sum(h.valor), 0)
    into v_n, v_soma
    from public.historico_movimentos h
    join public.historico_cargas c on c.id = h.carga_id
   where h.id = any (p_movimento_ids)
     and h.tenant_id = v_linha.tenant_id
     and h.conta_bancaria_id = v_linha.conta_bancaria_id
     and h.extrato_linha_id is null
     and c.tipo = 'cauda' and c.situacao = 'ativa'
     and h.data >= v_inicio;
  if v_n <> (select count(distinct x) from unnest(p_movimento_ids) x) then
    raise exception 'Alguma linha do histórico não é da cauda desta conta ou já está conciliada: recarregue a página.';
  end if;
  if abs(v_soma - v_linha.valor) >= 0.005 then
    raise exception 'A soma das linhas do histórico (%) não bate com a linha do banco (%).',
      public._moeda_br(v_soma), public._moeda_br(v_linha.valor);
  end if;

  update public.historico_movimentos set extrato_linha_id = v_linha.id where id = any (p_movimento_ids);
  update public.extrato_linhas
     set conciliada_como = 'historico',
         conciliada_em = now(),
         conciliada_por = v_uid,
         desfazer = null,
         grupo = null,
         resolvida_sozinha = p_sozinha
   where id = v_linha.id;

  perform public._auditar_extrato(v_linha, 'extrato.conciliado', v_uid,
    jsonb_build_object('como', 'historico', 'sozinha', p_sozinha, 'historico', to_jsonb(p_movimento_ids)));

  return jsonb_build_object('historico', to_jsonb(p_movimento_ids));
end;
$function$;

revoke all on function public.conciliar_linha_pelo_historico(uuid, uuid[], text) from public, anon;
grant execute on function public.conciliar_linha_pelo_historico(uuid, uuid[], text) to authenticated;

create or replace function public.desfazer_conciliacao(p_linha_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

    -- A linha do histórico (A6): solta a cauda; nada a cancelar.
    if r_linha.conciliada_como = 'historico' then
      update public.historico_movimentos set extrato_linha_id = null where extrato_linha_id = r_linha.id;
      update public.extrato_linhas
         set conciliada_como = null, conciliada_em = null, conciliada_por = null, desfazer = null,
             grupo = null, resolvida_sozinha = null, sem_auto = true
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
$function$;

-- A cauda da conta: os movimentos da carga `cauda` ativa desde o início da conta.
create or replace function public._historico_cauda_da_conta(p_conta_id uuid, p_de date, p_ate date)
returns table(id uuid, data date, valor numeric, extrato_linha_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select h.id, h.data, h.valor, h.extrato_linha_id
    from public.historico_movimentos h
    join public.historico_cargas c on c.id = h.carga_id
    join public.contas_bancarias b on b.id = h.conta_bancaria_id
   where h.conta_bancaria_id = p_conta_id
     and c.tipo = 'cauda' and c.situacao = 'ativa'
     and h.data >= b.saldo_inicial_data
     and h.data between coalesce(p_de, h.data) and coalesce(p_ate, h.data);
$function$;
revoke all on function public._historico_cauda_da_conta(uuid, date, date) from public, anon, authenticated;

create or replace function public._condicoes_do_fechamento(p_conta_id uuid, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
     and not exists (select 1 from public.lancamentos_financeiros f where f.extrato_linha_id = l.id)
     and not exists (select 1 from public.historico_movimentos h where h.extrato_linha_id = l.id);

  select count(*)::int into v_sem_linha
    from (
      select f.data_movimento as data
        from public.lancamentos_financeiros f
       where f.conta_bancaria_id = p_conta_id
         and f.extrato_linha_id is null
         and f.data_movimento <= p_ate
      union all
      select h.data
        from public._historico_cauda_da_conta(p_conta_id, null, p_ate) h
       where h.extrato_linha_id is null
    ) s
   where exists (
       select 1 from public.extrato_importacoes i
        where i.conta_bancaria_id = p_conta_id
          and i.periodo_inicio is not null
          and s.data >= i.periodo_inicio
          and s.data <= public._dia_completo_da_importacao(i.periodo_fim, i.gerado_em)
     );

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

  v_sistema := v_conta.saldo_inicial;
  if p_ate >= v_conta.saldo_inicial_data then
    v_sistema := v_sistema + coalesce((
      select sum(case when natureza = 'entrada' then valor else -valor end)
        from public.lancamentos_financeiros
       where conta_bancaria_id = p_conta_id
         and data_movimento >= v_conta.saldo_inicial_data
         and data_movimento <= p_ate), 0)
      + coalesce((select sum(h.valor) from public._historico_cauda_da_conta(p_conta_id, null, p_ate) h), 0);
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
$function$;

create or replace function public.conciliacao_resumo_contas(p_tenant_id uuid, p_de date, p_ate date)
returns table(conta_id uuid, saldo_atual numeric, creditos_periodo numeric, debitos_periodo numeric, lancamentos_periodo integer, ultimo_movimento date)
language sql
stable
set search_path to 'public'
as $function$
  with movimentos as (
    select l.conta_bancaria_id, l.data_movimento as data,
           case when l.natureza = 'entrada' then l.valor else -l.valor end as valor
      from lancamentos_financeiros l
     where l.tenant_id = p_tenant_id
    union all
    -- A cauda do histórico (A6): os movimentos dos jobs até o 3T depois do
    -- início da conta também são da conta.
    select h.conta_bancaria_id, h.data, h.valor
      from historico_movimentos h
      join historico_cargas hc on hc.id = h.carga_id and hc.tipo = 'cauda' and hc.situacao = 'ativa'
     where h.tenant_id = p_tenant_id
  )
  select
    c.id as conta_id,
    (c.saldo_inicial + coalesce(sum(
      case
        when m.data >= c.saldo_inicial_data
         and m.data <= (select public.hoje_em_sao_paulo())
        then m.valor
      end
    ), 0))::numeric(14,2) as saldo_atual,
    coalesce(sum(m.valor) filter (
      where m.valor > 0
        and m.data between p_de and p_ate
    ), 0)::numeric(14,2) as creditos_periodo,
    coalesce(sum(-m.valor) filter (
      where m.valor < 0
        and m.data between p_de and p_ate
    ), 0)::numeric(14,2) as debitos_periodo,
    count(m.data) filter (
      where m.data between p_de and p_ate
    )::int as lancamentos_periodo,
    max(m.data) as ultimo_movimento
  from contas_bancarias c
  left join movimentos m
    on m.conta_bancaria_id = c.id
  where c.tenant_id = p_tenant_id
  group by c.id, c.saldo_inicial, c.saldo_inicial_data;
$function$;

-- A cauda nova apaga as linhas da antiga: as linhas do extrato ligadas a ela
-- voltam a pendentes, sem `sem_auto`, para a tela ligar à cauda nova.
create or replace function public._historico_apagar_linhas(p_cargas uuid[])
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.extrato_linhas
     set conciliada_como = null, conciliada_em = null, conciliada_por = null, desfazer = null,
         grupo = null, resolvida_sozinha = null, avaliada_em = null
   where id in (select extrato_linha_id from public.historico_movimentos
                 where carga_id = any(p_cargas) and extrato_linha_id is not null);
  delete from public.historico_movimentos where carga_id = any(p_cargas);
  delete from public.historico_notas where carga_id = any(p_cargas);
  delete from public.historico_jobs where carga_id = any(p_cargas);
  delete from public.historico_rateio_regional where carga_id = any(p_cargas);
  delete from public.historico_saldos where carga_id = any(p_cargas);
$function$;
