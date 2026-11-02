-- =====================================================================
-- As previsões da planilha no sistema (decisão 232; Tiago, 02/11/2026)
-- =====================================================================
--
-- A planilha soma lançamentos com data futura: recebimentos de notas, custos
-- de job, pessoal, contas fixas e impostos que ainda vão acontecer. O Tiago
-- decidiu ("Carga agora, títulos depois") lançá-los já, para a conciliação
-- reconhecê-los quando o banco mostrar o movimento, e a DRE ter o seletor
-- "Só realizado / Com previsões". Conforme cada módulo assumir a sua parte
-- (faturamento, PPs, folha, Fiscal), a previsão daquele tipo sai da carga.
--
--   * `historico_cargas.tipo` ganha 'previsao'.
--   * `historico_movimentos.data_prevista`: a data da planilha. Ao ligar a
--     previsão a uma linha do banco, o gatilho põe em `data` a data do banco;
--     ao desligar, devolve a prevista. Assim o saldo, o extrato e o fluxo
--     tratam a previsão realizada como a cauda, sem outra regra de data.
--   * Quem lê o saldo (`_historico_cauda_da_conta`, `fc_saldos_por_conta`,
--     `conciliacao_resumo_contas`, `vw_fluxo_caixa`) soma a previsão só
--     depois de ligada ao banco.
--   * `conciliar_linha_pelo_historico` aceita a linha das previsões da conta.
--   * `historico_dre` ganha `p_previsoes`: falso, só as realizadas; verdadeiro,
--     todas. A versão de três argumentos continua e chama a nova com falso.
--     O regional e a rentabilidade contam só as realizadas.
--   * `historico_iniciar_carga`: como a cauda, começa depois do corte.
--   * `historico_concluir_carga`: as previsões novas substituem as ativas; a
--     mesma linha (digital, conta e valor) herda a ligação, e a já ligada que
--     a versão nova não traz continua. A cauda nova que traz como realizada a
--     previsão ligada (mesma conta, valor e dia) herda a ligação, e a
--     previsão sai.
--
-- Aditiva: nenhuma linha existente muda, e as funções mantêm assinatura e
-- GRANT (a DRE ganha uma versão a mais, com GRANT para authenticated).
-- =====================================================================

alter table public.historico_cargas drop constraint historico_cargas_tipo_check;
alter table public.historico_cargas add constraint historico_cargas_tipo_check check (
  tipo = any (array['periodo', 'cauda', 'so_dre', 'previsao'])
);

alter table public.historico_movimentos add column if not exists data_prevista date;
comment on column public.historico_movimentos.data_prevista is
  'A data da previsão na planilha (carga previsao, decisão 232). Ligada ao banco, a previsão passa a ter em data a data da linha do banco; desligada, volta a esta.';

-- A previsão ligada ao banco fica com a data do banco; desligada, com a prevista.
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
    new.data := new.data_prevista;
  else
    new.data := coalesce((select e.data from public.extrato_linhas e where e.id = new.extrato_linha_id), new.data);
  end if;
  return new;
end;
$function$;
revoke all on function public._historico_previsao_na_data_do_banco() from public, anon, authenticated;

drop trigger if exists trg_historico_previsao_na_data_do_banco on public.historico_movimentos;
create trigger trg_historico_previsao_na_data_do_banco
  before update of extrato_linha_id on public.historico_movimentos
  for each row
  when (old.extrato_linha_id is distinct from new.extrato_linha_id)
  execute function public._historico_previsao_na_data_do_banco();

create or replace function public.historico_iniciar_carga(p_tenant_id uuid, p_cabecalho jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid := public._exige_financeiro_historico(p_tenant_id);
  v_de       date := (p_cabecalho->'carga'->>'de')::date;
  v_ate      date := (p_cabecalho->'carga'->>'ate')::date;
  v_tipo     text := coalesce(p_cabecalho->'carga'->>'tipo', 'periodo');
  v_esperado jsonb := p_cabecalho->'esperado';
  v_cruzada  record;
  v_id       uuid;
begin
  if v_de is null or v_ate is null or v_de > v_ate then
    raise exception 'O período da carga é inválido.';
  end if;
  if v_tipo not in ('periodo', 'cauda', 'so_dre', 'previsao') then
    raise exception 'Tipo de carga desconhecido: %.', v_tipo;
  end if;
  if v_tipo = 'periodo' and v_ate > date '2026-09-30' then
    raise exception 'O histórico vai até 30/09/2026: a partir de 01/10/2026 vale o sistema, e só a cauda dos jobs até o 3T entra depois disso.';
  end if;
  if v_tipo = 'cauda' and v_de <= date '2026-09-30' then
    raise exception 'A cauda começa depois do corte, em 01/10/2026.';
  end if;
  if v_tipo = 'so_dre' and v_de <= date '2026-09-30' then
    raise exception 'A carga só DRE começa depois do corte, em 01/10/2026.';
  end if;
  if v_tipo = 'previsao' and v_de <= date '2026-09-30' then
    raise exception 'As previsões começam depois do corte, em 01/10/2026.';
  end if;
  if jsonb_typeof(v_esperado) is distinct from 'object'
     or exists (select 1 from unnest(array['rateio', 'saldos', 'jobs', 'notas', 'movimentos']) t
                 where jsonb_typeof(v_esperado->t->'linhas') is distinct from 'number')
     or v_esperado->'movimentos'->>'soma' is null
     or v_esperado->'notas'->>'soma' is null then
    raise exception 'O pacote não diz quantas linhas traz: gere-o de novo pelo script empacotar.ts.';
  end if;
  if exists (select 1 from public.historico_cargas where tenant_id = p_tenant_id and situacao = 'carregando') then
    raise exception 'Já há uma carga em andamento. Conclua ou descarte essa carga antes de começar outra.';
  end if;
  -- A cauda, o só DRE e as previsões substituem a ativa do tipo ao concluir; só a carga de
  -- período cruza.
  select nome, periodo_de, periodo_ate into v_cruzada
    from public.historico_cargas
   where tenant_id = p_tenant_id and situacao = 'ativa' and tipo = 'periodo'
     and periodo_de <= v_ate and periodo_ate >= v_de
     and not (v_tipo = 'periodo' and periodo_de = v_de and periodo_ate = v_ate)
   limit 1;
  if found then
    raise exception 'O período cruza o da carga "%" (% a %). Carregue o mesmo período, que a substitui, ou desfaça aquela carga antes.',
      v_cruzada.nome, to_char(v_cruzada.periodo_de, 'DD/MM/YYYY'), to_char(v_cruzada.periodo_ate, 'DD/MM/YYYY');
  end if;

  insert into public.historico_cargas (
    tenant_id, nome, tipo, periodo_de, periodo_ate, planilha_versao, planilha_arquivo, planilha_sha256,
    pacote_arquivo, pacote_sha256, esperado, criada_por
  ) values (
    p_tenant_id, btrim(p_cabecalho->'carga'->>'nome'), v_tipo, v_de, v_ate,
    (p_cabecalho->'planilha'->>'versao')::date, p_cabecalho->'planilha'->>'arquivo', p_cabecalho->'planilha'->>'sha256',
    p_cabecalho->'pacote'->>'arquivo', p_cabecalho->'pacote'->>'sha256', v_esperado, v_uid
  )
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.historico_concluir_carga(p_carga_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_carga     public.historico_cargas%rowtype;
  v_uid       uuid;
  v_linhas    jsonb;
  v_tabela    text;
  v_soma      numeric;
  v_antigas   uuid[];
  v_cruzada   record;
  v_herdadas  integer := 0;
  v_repetidas integer;
begin
  select * into v_carga from public.historico_cargas where id = p_carga_id for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  v_uid := public._exige_financeiro_historico(v_carga.tenant_id);
  if v_carga.situacao <> 'carregando' then
    raise exception 'Esta carga não está em andamento.';
  end if;

  v_linhas := public._historico_contar_linhas(v_carga.id);
  foreach v_tabela in array array['rateio', 'saldos', 'jobs', 'notas', 'movimentos'] loop
    if (v_linhas->>v_tabela)::integer is distinct from (v_carga.esperado->v_tabela->>'linhas')::integer then
      raise exception 'A carga não está completa: % de % linhas de %.',
        v_linhas->>v_tabela, coalesce(v_carga.esperado->v_tabela->>'linhas', '?'), v_tabela;
    end if;
  end loop;
  select coalesce(sum(valor), 0) into v_soma from public.historico_movimentos where carga_id = v_carga.id;
  if v_soma is distinct from (v_carga.esperado->'movimentos'->>'soma')::numeric then
    raise exception 'A soma dos movimentos no banco (%) não bate com a do pacote (%).',
      v_soma, v_carga.esperado->'movimentos'->>'soma';
  end if;
  select coalesce(sum(valor), 0) into v_soma from public.historico_notas where carga_id = v_carga.id;
  if v_soma is distinct from (v_carga.esperado->'notas'->>'soma')::numeric then
    raise exception 'A soma das notas no banco (%) não bate com a do pacote (%).',
      v_soma, v_carga.esperado->'notas'->>'soma';
  end if;

  -- Outra carga de período ativa pode ter sido concluída com período cruzado
  -- depois que esta começou.
  select nome, periodo_de, periodo_ate into v_cruzada
    from public.historico_cargas
   where tenant_id = v_carga.tenant_id and situacao = 'ativa' and tipo = 'periodo'
     and periodo_de <= v_carga.periodo_ate and periodo_ate >= v_carga.periodo_de
     and not (v_carga.tipo = 'periodo' and periodo_de = v_carga.periodo_de and periodo_ate = v_carga.periodo_ate)
   limit 1;
  if found then
    raise exception 'O período cruza o da carga "%" (% a %). Desfaça aquela carga antes de concluir esta.',
      v_cruzada.nome, to_char(v_cruzada.periodo_de, 'DD/MM/YYYY'), to_char(v_cruzada.periodo_ate, 'DD/MM/YYYY');
  end if;

  -- A mesma linha da planilha na cauda e no só DRE contaria duas vezes no
  -- resultado.
  if v_carga.tipo in ('cauda', 'so_dre', 'previsao') then
    select count(*)::int into v_repetidas
      from public.historico_movimentos n
      join public.historico_movimentos o on o.digital = n.digital
      join public.historico_cargas c on c.id = o.carga_id
     where n.carga_id = v_carga.id
       and c.tenant_id = v_carga.tenant_id
       and c.situacao = 'ativa'
       and c.tipo in ('cauda', 'so_dre', 'previsao')
       and c.tipo <> v_carga.tipo;
    if v_repetidas > 0 then
      raise exception '% linha(s) desta carga já estão na carga ativa de outro tipo e contariam duas vezes no resultado.', v_repetidas;
    end if;
  end if;

  -- Substitui a carga ativa do mesmo período; a cauda, a cauda ativa; o só
  -- DRE, o só DRE ativo; as previsões, as previsões ativas.
  select coalesce(array_agg(id), '{}') into v_antigas
    from public.historico_cargas
   where tenant_id = v_carga.tenant_id and situacao = 'ativa'
     and ((v_carga.tipo = 'periodo' and tipo = 'periodo'
           and periodo_de = v_carga.periodo_de and periodo_ate = v_carga.periodo_ate)
       or (v_carga.tipo = 'cauda' and tipo = 'cauda')
       or (v_carga.tipo = 'so_dre' and tipo = 'so_dre')
       or (v_carga.tipo = 'previsao' and tipo = 'previsao'));
  if cardinality(v_antigas) > 0 then
    if v_carga.tipo in ('cauda', 'previsao') then
      -- A mesma linha da planilha (digital), na mesma conta e no mesmo valor,
      -- herda a ligação com o banco; a antiga larga, e a linha do banco fica.
      with herdadas as (
        update public.historico_movimentos n
           set extrato_linha_id = o.extrato_linha_id
          from public.historico_movimentos o
         where n.carga_id = v_carga.id
           and o.carga_id = any(v_antigas)
           and o.extrato_linha_id is not null
           and n.extrato_linha_id is null
           and n.digital = o.digital
           and n.conta_bancaria_id is not distinct from o.conta_bancaria_id
           and n.valor = o.valor
        returning o.id
      )
      update public.historico_movimentos
         set extrato_linha_id = null
       where id in (select id from herdadas);
      get diagnostics v_herdadas = row_count;
    end if;
    -- A previsão já ligada ao banco que a versão nova não traz continua: o
    -- dinheiro aconteceu. Ela passa para a carga nova (decisão 232).
    if v_carga.tipo = 'previsao' then
      update public.historico_movimentos
         set carga_id = v_carga.id
       where carga_id = any(v_antigas)
         and extrato_linha_id is not null;
    end if;
    perform public._historico_apagar_linhas(v_antigas);
    -- A linha do banco que perdeu parte das linhas da planilha voltou a
    -- pendente: a parte herdada larga, e a conciliação recomeça inteira.
    if v_carga.tipo = 'cauda' then
      update public.historico_movimentos n
         set extrato_linha_id = null
        from public.extrato_linhas e
       where n.carga_id = v_carga.id
         and e.id = n.extrato_linha_id
         and e.conciliada_em is null;
    end if;
    update public.historico_cargas
       set situacao = 'substituida', encerrada_em = now(), encerrada_por = v_uid, substituida_por = v_carga.id
     where id = any(v_antigas);
  end if;

  -- A cauda nova traz como realizada a previsão que já estava ligada ao banco
  -- (mesma conta, valor e dia): a linha da cauda herda a ligação, e a
  -- previsão sai (decisão 232).
  if v_carga.tipo = 'cauda' then
    with realizadas as (
      select distinct on (p.id) p.id as previsao_id, n.id as cauda_id, p.extrato_linha_id
        from public.historico_movimentos p
        join public.historico_cargas pc on pc.id = p.carga_id and pc.tipo = 'previsao' and pc.situacao = 'ativa'
        join public.historico_movimentos n
          on n.carga_id = v_carga.id
         and n.extrato_linha_id is null
         and n.conta_bancaria_id is not distinct from p.conta_bancaria_id
         and n.valor = p.valor
         and n.data = p.data
       where pc.tenant_id = v_carga.tenant_id
         and p.extrato_linha_id is not null
       order by p.id, n.id
    ), herdou as (
      update public.historico_movimentos n
         set extrato_linha_id = r.extrato_linha_id
        from realizadas r
       where n.id = r.cauda_id
      returning r.previsao_id
    )
    delete from public.historico_movimentos where id in (select previsao_id from herdou);
  end if;

  update public.historico_cargas
     set situacao = 'ativa', gravado = v_linhas, concluida_em = now(), concluida_por = v_uid
   where id = v_carga.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_carga.tenant_id, 'historico_carga', v_carga.id::text, 'historico.carga_concluida', v_uid,
          jsonb_build_object('nome', v_carga.nome, 'tipo', v_carga.tipo, 'periodo_de', v_carga.periodo_de, 'periodo_ate', v_carga.periodo_ate,
                             'planilha_versao', v_carga.planilha_versao, 'pacote', v_carga.pacote_arquivo,
                             'linhas', v_linhas, 'substituidas', to_jsonb(v_antigas), 'ligacoes_herdadas', v_herdadas));

  return jsonb_build_object('linhas', v_linhas, 'substituidas', cardinality(v_antigas), 'ligacoes_herdadas', v_herdadas);
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
     and c.tipo in ('cauda', 'previsao') and c.situacao = 'ativa'
     and h.data >= v_inicio;
  if v_n <> (select count(distinct x) from unnest(p_movimento_ids) x) then
    raise exception 'Alguma linha do histórico não é da cauda nem das previsões desta conta, ou já está conciliada: recarregue a página.';
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
     and c.situacao = 'ativa'
     and (c.tipo = 'cauda' or (c.tipo = 'previsao' and h.extrato_linha_id is not null))
     and h.data >= b.saldo_inicial_data
     and h.data between coalesce(p_de, h.data) and coalesce(p_ate, h.data);
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
      join historico_cargas hc on hc.id = h.carga_id and hc.situacao = 'ativa'
       and (hc.tipo = 'cauda' or (hc.tipo = 'previsao' and h.extrato_linha_id is not null))
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

create or replace function public.fc_saldos_por_conta(p_data date)
returns table(conta_bancaria_id uuid, saldo numeric)
language sql
stable
set search_path to ''
as $function$
  with movimentos as (
    select l.conta_bancaria_id, l.data_movimento as data,
           case when l.natureza = 'entrada' then l.valor else -l.valor end as valor
      from public.lancamentos_financeiros l
     where l.data_movimento <= p_data
    union all
    -- A cauda do histórico (decisão 211, A6): valor com sinal.
    select h.conta_bancaria_id, h.data, h.valor
      from public.historico_movimentos h
      join public.historico_cargas hc on hc.id = h.carga_id and hc.situacao = 'ativa'
       and (hc.tipo = 'cauda' or (hc.tipo = 'previsao' and h.extrato_linha_id is not null))
     where h.data <= p_data
  )
  select c.id,
         (c.saldo_inicial + coalesce(sum(m.valor), 0))::numeric(14,2)
  from public.contas_bancarias c
  left join movimentos m
         on m.conta_bancaria_id = c.id
        and m.data >= c.saldo_inicial_data
  where c.ativo
  group by c.id, c.saldo_inicial;
$function$;

create or replace function public.historico_dre(
  p_tenant_id uuid,
  p_ano integer,
  p_prefixos text[],
  p_previsoes boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cargas    uuid[];
  v_previstas uuid[];
  v_cobertura jsonb;
  v_grupos    jsonb;
  v_jobs      jsonb;
  v_abertas   integer;
begin
  if not (public.is_tenant_admin(p_tenant_id) or public.is_tenant_financeiro(p_tenant_id)) then
    return null;
  end if;

  select coalesce(array_agg(id), '{}'),
         case when count(*) = 0 then null
              else jsonb_build_object('de', min(periodo_de), 'ate', max(periodo_ate)) end
    into v_cargas, v_cobertura
    from public.historico_cargas
   where tenant_id = p_tenant_id and situacao = 'ativa' and tipo <> 'previsao';

  -- As previsões (decisão 232) só contam depois de ligadas ao banco.
  select coalesce(array_agg(id), '{}') into v_previstas
    from public.historico_cargas
   where tenant_id = p_tenant_id and situacao = 'ativa' and tipo = 'previsao';

  -- As linhas do Tipo: o lerTipo da padronização já separou sigla, grupo e trimestre.
  select coalesce(jsonb_agg(jsonb_build_object(
           'sigla', g.sigla, 'grupo', g.grupo, 'trimestre', g.trimestre, 'aba', g.aba,
           'credito', g.credito, 'debito', g.debito)), '[]'::jsonb)
    into v_grupos
    from (
      select coalesce(m.sigla_planilha, '') as sigla, m.grupo, m.competencia_trimestre as trimestre, m.aba,
             sum(coalesce(m.credito_planilha, 0)) as credito,
             sum(coalesce(m.debito_planilha, 0)) as debito
        from public.historico_movimentos m
       where m.tenant_id = p_tenant_id
         and (m.carga_id = any(v_cargas)
              or (m.carga_id = any(v_previstas) and (p_previsoes or m.extrato_linha_id is not null)))
         and m.competencia_ano = p_ano
         and m.competencia_trimestre is not null
         and m.grupo is not null
       group by 1, 2, 3, 4
    ) g;

  -- As linhas da coluna Jobs: o texto em maiúsculas e com um espaço só, como
  -- `chaveDaColunaJobs` lê, igual a uma das chaves do ano ("CMH 1T 2025"). A
  -- comparação direta com as chaves possíveis evita a expressão regular em cada
  -- linha (a coluna guarda também o nome de milhares de jobs).
  select coalesce(jsonb_agg(jsonb_build_object(
           'prefixo', j.prefixo, 'trimestre', j.trimestre, 'aba', j.aba,
           'credito', j.credito, 'debito', j.debito)), '[]'::jsonb)
    into v_jobs
    from (
      select k.prefixo, k.trimestre, m.aba,
             sum(coalesce(m.credito_planilha, 0)) as credito,
             sum(coalesce(m.debito_planilha, 0)) as debito
        from public.historico_movimentos m
        join (
          select p.prefixo, t.trimestre::smallint as trimestre,
                 p.prefixo || ' ' || t.trimestre || 'T ' || p_ano as chave
            from unnest(p_prefixos) as p(prefixo)
           cross join generate_series(1, 4) as t(trimestre)
        ) k on k.chave = upper(regexp_replace(btrim(m.coluna_jobs), '\s+', ' ', 'g'))
       where m.tenant_id = p_tenant_id
         and (m.carga_id = any(v_cargas)
              or (m.carga_id = any(v_previstas) and (p_previsoes or m.extrato_linha_id is not null)))
         and right(btrim(m.coluna_jobs), 4) = p_ano::text
       group by 1, 2, 3
    ) j;

  -- Quantas previsões do ano ainda não aconteceram: a tela diz o que o seletor soma.
  select count(*)::int into v_abertas
    from public.historico_movimentos m
   where m.tenant_id = p_tenant_id
     and m.carga_id = any(v_previstas)
     and m.extrato_linha_id is null
     and m.competencia_ano = p_ano;

  return jsonb_build_object('cobertura', v_cobertura, 'grupos', v_grupos, 'jobs', v_jobs, 'previstas', v_abertas);
end;
$$;


-- A versão de três argumentos (a tela de antes) segue: só o realizado.
create or replace function public.historico_dre(p_tenant_id uuid, p_ano integer, p_prefixos text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.historico_dre(p_tenant_id, p_ano, p_prefixos, false);
$$;
revoke all on function public.historico_dre(uuid, integer, text[]) from public, anon;
grant execute on function public.historico_dre(uuid, integer, text[]) to authenticated;
revoke all on function public.historico_dre(uuid, integer, text[], boolean) from public, anon;
grant execute on function public.historico_dre(uuid, integer, text[], boolean) to authenticated;

create or replace function public.historico_regional(
  p_tenant_id uuid,
  p_ano integer,
  p_prefixos text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cargas    uuid[];
  v_previstas uuid[];
  v_cobertura jsonb;
  v_rateio    jsonb;
  v_grupos    jsonb;
  v_jobs      jsonb;
begin
  if not (public.is_tenant_admin(p_tenant_id) or public.is_tenant_financeiro(p_tenant_id)) then
    return null;
  end if;

  select coalesce(array_agg(id), '{}'),
         case when count(*) = 0 then null
              else jsonb_build_object('de', min(periodo_de), 'ate', max(periodo_ate)) end
    into v_cargas, v_cobertura
    from public.historico_cargas
   where tenant_id = p_tenant_id and situacao = 'ativa' and tipo <> 'previsao';

  -- As previsões (decisão 232) só contam depois de ligadas ao banco.
  select coalesce(array_agg(id), '{}') into v_previstas
    from public.historico_cargas
   where tenant_id = p_tenant_id and situacao = 'ativa' and tipo = 'previsao';

  select coalesce(jsonb_agg(jsonb_build_object(
           'ano', r.ano, 'trimestre', r.trimestre, 'empresa', e.nome_fantasia, 'grupo', r.grupo,
           'regional', r.regional_nome, 'percentual', r.percentual, 'origem', r.origem)
           order by r.ano, e.nome_fantasia, r.trimestre nulls first, r.grupo nulls first, r.regional_nome), '[]'::jsonb)
    into v_rateio
    from public.historico_rateio_regional r
    join public.empresas e on e.id = r.empresa_id
   where r.tenant_id = p_tenant_id
     and r.carga_id = any(v_cargas);

  -- O faturamento (REC) e o custo operacional (CO) do job que a planilha divide
  -- se dividem pelas partes dele, somadas a 1 (a regional vem como o código da
  -- planilha, "NE" ou "AGE"); o resto fica na regional do lançamento. No
  -- faturamento vai também o imposto teórico: o valor × a alíquota do job.
  -- Os movimentos se somam por job antes da divisão, e as partes de cada job
  -- se calculam uma vez (CTE materializada), e não uma vez por movimento. Do
  -- job que a planilha não divide vai também o texto da coluna REGIONAL das
  -- abas Res. Jobs ("COPA", "CMH"): a tela separa por ele os projetos
  -- proprietários.
  with partes as materialized (
    select j.carga_id, j.chave, e.key as codigo, e.value::numeric / s.soma as parte
      from public.historico_jobs j
     cross join lateral (select sum(v.value::numeric) as soma from jsonb_each_text(j.rateio_regional) as v) as s
     cross join lateral jsonb_each_text(j.rateio_regional) as e
     where j.tenant_id = p_tenant_id
       and j.carga_id = any(v_cargas || v_previstas)
       and s.soma <> 0
  ), somas as (
    select coalesce(m.sigla_planilha, '') as sigla, m.grupo, m.competencia_trimestre as trimestre, m.aba,
           case when m.regional_todas then null
                else coalesce(m.regional_nome, nullif(upper(btrim(m.regional_planilha)), '')) end as regional,
           m.regional_todas as todas, m.carga_id,
           case when m.grupo in ('REC', 'CO') then m.job_chave end as job_chave,
           sum(coalesce(m.credito_planilha, 0)) as credito,
           sum(coalesce(m.debito_planilha, 0)) as debito
      from public.historico_movimentos m
     where m.tenant_id = p_tenant_id
       and (m.carga_id = any(v_cargas) or (m.carga_id = any(v_previstas) and m.extrato_linha_id is not null))
       and m.competencia_ano = p_ano
       and m.competencia_trimestre is not null
       and m.grupo is not null
     group by 1, 2, 3, 4, 5, 6, 7, 8
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sigla', g.sigla, 'grupo', g.grupo, 'trimestre', g.trimestre, 'aba', g.aba,
           'regional', g.regional, 'todas', g.todas, 'pelo_job', g.pelo_job,
           'regional_do_job', g.regional_do_job,
           'credito', g.credito, 'debito', g.debito, 'teorico', g.teorico)), '[]'::jsonb)
    into v_grupos
    from (
      select s.sigla, s.grupo, s.trimestre, s.aba,
             coalesce(p.codigo, s.regional) as regional,
             p.codigo is null and s.todas as todas,
             p.codigo is not null as pelo_job,
             case when p.codigo is null then nullif(upper(btrim(j.regional_planilha)), '') end as regional_do_job,
             sum(s.credito * coalesce(p.parte, 1)) as credito,
             sum(s.debito * coalesce(p.parte, 1)) as debito,
             sum(case when s.grupo = 'REC'
                      then (s.credito - s.debito) * coalesce(p.parte, 1) * coalesce(j.imposto_teorico_percentual, 0)
                      else 0 end) as teorico
        from somas s
        left join public.historico_jobs j on j.carga_id = s.carga_id and j.chave = s.job_chave
        left join partes p on p.carga_id = s.carga_id and p.chave = s.job_chave
       group by 1, 2, 3, 4, 5, 6, 7, 8
    ) g;

  -- A chave de cada linha se calcula uma vez (CTE materializada), só nas linhas
  -- que têm a primeira palavra de alguma chave: a coluna guarda também o nome
  -- de milhares de jobs, e com poucas chaves o banco repetiria a conta por par.
  with candidatos as materialized (
    select m.aba,
           case when m.regional_todas then null
                else coalesce(m.regional_nome, nullif(upper(btrim(m.regional_planilha)), '')) end as regional,
           m.regional_todas as todas,
           coalesce(m.credito_planilha, 0) as credito,
           coalesce(m.debito_planilha, 0) as debito,
           upper(regexp_replace(btrim(m.coluna_jobs), '\s+', ' ', 'g')) as chave
      from public.historico_movimentos m
     where m.tenant_id = p_tenant_id
       and (m.carga_id = any(v_cargas) or (m.carga_id = any(v_previstas) and m.extrato_linha_id is not null))
       and right(btrim(m.coluna_jobs), 4) = p_ano::text
       and upper(m.coluna_jobs) like any (array(select '%' || split_part(x, ' ', 1) || '%' from unnest(p_prefixos) as x))
  ), chaves as (
    select p.prefixo, t.trimestre::smallint as trimestre,
           p.prefixo || ' ' || t.trimestre || 'T ' || p_ano as chave
      from unnest(p_prefixos) as p(prefixo)
     cross join generate_series(1, 4) as t(trimestre)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'prefixo', j.prefixo, 'trimestre', j.trimestre, 'aba', j.aba,
           'regional', j.regional, 'todas', j.todas, 'credito', j.credito, 'debito', j.debito)), '[]'::jsonb)
    into v_jobs
    from (
      select k.prefixo, k.trimestre, c.aba, c.regional, c.todas,
             sum(c.credito) as credito, sum(c.debito) as debito
        from candidatos c
        join chaves k on k.chave = c.chave
       group by 1, 2, 3, 4, 5
    ) j;

  return jsonb_build_object('cobertura', v_cobertura, 'rateio', v_rateio, 'grupos', v_grupos, 'jobs', v_jobs);
end;
$$;

create or replace function public.historico_rentabilidade_jobs(
  p_tenant_id uuid,
  p_ano integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cargas    uuid[];
  v_previstas uuid[];
  v_cobertura jsonb;
  v_jobs      jsonb;
begin
  if not (public.is_tenant_admin(p_tenant_id) or public.is_tenant_financeiro(p_tenant_id)) then
    return null;
  end if;

  select coalesce(array_agg(id), '{}'),
         case when count(*) = 0 then null
              else jsonb_build_object('de', min(periodo_de), 'ate', max(periodo_ate)) end
    into v_cargas, v_cobertura
    from public.historico_cargas
   where tenant_id = p_tenant_id and situacao = 'ativa' and tipo <> 'previsao';

  -- As previsões (decisão 232) só contam depois de ligadas ao banco.
  select coalesce(array_agg(id), '{}') into v_previstas
    from public.historico_cargas
   where tenant_id = p_tenant_id and situacao = 'ativa' and tipo = 'previsao';

  -- Os jobs do ano: cada carga traz todos, e vale o da carga ativa mais
  -- recente. A receita, o custo e o imposto somam todas as cargas ativas,
  -- em qualquer data, como as colunas das abas Res. Jobs.
  with jobs as (
    select distinct on (j.chave)
           j.chave, j.nome, j.empresa_nome, j.trimestre, j.cliente_id, j.cliente_planilha,
           j.marca_id, j.marca_planilha, j.fee_percentual
      from public.historico_jobs j
      join public.historico_cargas c on c.id = j.carga_id
     where j.tenant_id = p_tenant_id
       and j.carga_id = any(v_cargas)
       and j.ano = p_ano
     order by j.chave, c.created_at desc
  ), movimentos as (
    select m.job_chave,
           sum(case when m.grupo = 'REC'
                    then coalesce(m.credito_planilha, 0) - coalesce(m.debito_planilha, 0) else 0 end) as receita,
           sum(case when m.grupo = 'CO'
                    then coalesce(m.debito_planilha, 0) - coalesce(m.credito_planilha, 0) else 0 end) as custo
      from public.historico_movimentos m
     where m.tenant_id = p_tenant_id
       and (m.carga_id = any(v_cargas) or (m.carga_id = any(v_previstas) and m.extrato_linha_id is not null))
       and m.job_chave in (select chave from jobs)
       and m.grupo in ('REC', 'CO')
     group by 1
  ), notas as (
    select n.job_chave, sum(coalesce(n.total_impostos, 0)) as imposto
      from public.historico_notas n
     where n.tenant_id = p_tenant_id
       and n.carga_id = any(v_cargas)
       and n.job_chave in (select chave from jobs)
       and n.situacao = 'emitida'
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', j.chave, 'nome', j.nome, 'empresa', j.empresa_nome, 'trimestre', j.trimestre,
           'cliente_id', j.cliente_id, 'cliente', coalesce(cl.nome_fantasia, cl.razao_social, j.cliente_planilha),
           'marca_id', j.marca_id, 'marca', coalesce(mc.nome, j.marca_planilha),
           'fee_percentual', j.fee_percentual,
           'receita', coalesce(mv.receita, 0), 'custo', coalesce(mv.custo, 0), 'imposto', coalesce(nt.imposto, 0))), '[]'::jsonb)
    into v_jobs
    from jobs j
    left join movimentos mv on mv.job_chave = j.chave
    left join notas nt on nt.job_chave = j.chave
    left join public.clientes cl on cl.id = j.cliente_id
    left join public.cliente_produtos mc on mc.id = j.marca_id;

  return jsonb_build_object('cobertura', v_cobertura, 'jobs', v_jobs);
end;
$$;

-- O fluxo de caixa soma a previsão só depois de ligada ao banco.
do $$
declare
  v_antes  text := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  v_alvo   text := '(hc.tipo = ''cauda''::text)';
  v_novo   text := '((hc.tipo = ''cauda''::text) OR ((hc.tipo = ''previsao''::text) AND (h.extrato_linha_id IS NOT NULL)))';
  v_depois text;
begin
  if position('previsao' in v_antes) > 0 then
    return; -- já tem a previsão
  end if;
  if (length(v_antes) - length(replace(v_antes, v_alvo, ''))) / length(v_alvo) <> 1 then
    raise exception 'public.vw_fluxo_caixa: o ramo da cauda não está como esperado';
  end if;
  execute 'create or replace view public.vw_fluxo_caixa as ' || replace(rtrim(v_antes, E'; \n'), v_alvo, v_novo);
  v_depois := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  if position('previsao' in v_depois) = 0 then
    raise exception 'public.vw_fluxo_caixa: a troca não pegou';
  end if;
end
$$;

revoke all on function public.conciliar_linha_pelo_historico(uuid, uuid[], text) from public, anon;
grant execute on function public.conciliar_linha_pelo_historico(uuid, uuid[], text) to authenticated;
revoke all on function public._historico_cauda_da_conta(uuid, date, date) from public, anon, authenticated;
