-- Várias baixas numa linha da planilha (decisão 270, revisão de 23/11/2026;
-- pedido do Tiago: "Sim, faça").
--
-- O caso: o financeiro paga duas verbas da mesma pessoa num PIX só, e a
-- planilha registra o PIX numa linha que cita as duas PPs (ANI-1012 em
-- outubro: "PP00185 PP00178", R$ 1.800,00 = 900 + 900; e outras três linhas
-- assim). No sistema, cada PP tem a sua baixa. A ligação da decisão 261
-- morava na linha (`historico_movimentos.lancamento_id`): uma linha apontava
-- para uma baixa só, e duas baixas não cabiam.
--
-- 1. `historico_movimento_baixas`: a ligação vira um par linha × baixa. Uma
--    linha com várias baixas (um PIX, duas PPs), uma baixa com várias linhas
--    (a parcela paga em duas transferências no mesmo dia, decisão 261) ou
--    várias com várias, desde que somem o mesmo valor. Só leitura para admin
--    e financeiro; a escrita é pelas funções.
-- 2. As 14 ligações que já existem (12 da decisão 261 e 2 de 23/11) vêm para
--    a tabela. A coluna antiga fica, sem uso, até o OK para removê-la.
-- 3. `ligar_baixa_ao_historico(baixas[], linhas[])`: mesma conta, mesmo dia,
--    antes do início da conta, nada ligado ainda, e a soma das linhas igual à
--    soma das baixas. A versão de uma baixa só (manhã de 23/11) sai.
-- 4. `baixar_parcela_pp_pelo_historico` (decisão 261) grava na tabela. A
--    liberação `app.baixa_pelo_historico` sai: a baixa comum já aceita a data.
-- 5. `extrato_antes_do_inicio` e `historico_extrato_da_conta` leem da tabela:
--    a baixa ligada a uma linha que conta no saldo não se repete, e a linha
--    mostra os códigos de todas as PPs ligadas ("PP-00178, PP-00185").
--    A linha do só DRE não aparece no Extrato (fica fora do saldo): ligada a
--    ela, a baixa continua contando, e a ligação fica só registrada (corrige
--    o que a 20261123600001 dizia sobre o só DRE mostrar a PP).

-- 1. ---------------------------------------------------------------------------
create table if not exists public.historico_movimento_baixas (
  historico_movimento_id uuid not null references public.historico_movimentos(id) on delete cascade,
  lancamento_id          uuid not null references public.lancamentos_financeiros(id) on delete cascade,
  tenant_id              uuid not null references public.tenants(id),
  ligado_por             uuid,
  created_at             timestamptz not null default now(),
  primary key (historico_movimento_id, lancamento_id)
);

comment on table public.historico_movimento_baixas is
  'Decisão 270: a linha da planilha (histórico) que registra uma baixa do sistema com data antes do início da conta. Par linha × baixa: uma linha pode registrar várias baixas (um PIX para duas PPs) e uma baixa várias linhas. Cancelar a baixa ou apagar a linha solta o par.';

create index if not exists idx_historico_movimento_baixas_lancamento
  on public.historico_movimento_baixas (lancamento_id);
create index if not exists idx_historico_movimento_baixas_tenant
  on public.historico_movimento_baixas (tenant_id);

alter table public.historico_movimento_baixas enable row level security;

drop policy if exists historico_movimento_baixas_select on public.historico_movimento_baixas;
create policy historico_movimento_baixas_select on public.historico_movimento_baixas
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (
      tenant_id in (select public.current_tenant_ids_com_papel('administrador'::app_role))
      or tenant_id in (select public.current_tenant_ids_com_papel('financeiro'::app_role))
    )
  );

revoke all on public.historico_movimento_baixas from anon, authenticated;
grant select on public.historico_movimento_baixas to authenticated;

-- 2. ---------------------------------------------------------------------------
insert into public.historico_movimento_baixas (historico_movimento_id, lancamento_id, tenant_id, created_at)
select h.id, h.lancamento_id, h.tenant_id, now()
  from public.historico_movimentos h
 where h.lancamento_id is not null
on conflict do nothing;

comment on column public.historico_movimentos.lancamento_id is
  'OBSOLETA desde 23/11/2026 (decisão 270): a ligação da linha com a baixa mora em historico_movimento_baixas. Não ler nem gravar; remover com o OK do Tiago.';

-- 3. ---------------------------------------------------------------------------
drop function if exists public.ligar_baixa_ao_historico(uuid, uuid[]);

create or replace function public.ligar_baixa_ao_historico(p_lancamento_ids uuid[], p_movimento_ids uuid[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant  uuid;
  v_uid     uuid;
  v_n       integer;
  v_contas  integer;
  v_datas   integer;
  v_conta   uuid;
  v_data    date;
  v_inicio  date;
  v_baixas  numeric;
  v_linhas  numeric;
begin
  if coalesce(cardinality(p_lancamento_ids), 0) = 0 then
    raise exception 'Escolha as baixas que a linha da planilha registra.';
  end if;
  if coalesce(cardinality(p_movimento_ids), 0) = 0 then
    raise exception 'Escolha as linhas da planilha que registram este pagamento.';
  end if;

  perform 1 from public.lancamentos_financeiros where id = any (p_lancamento_ids) for update;
  select (array_agg(tenant_id))[1] into v_tenant
    from public.lancamentos_financeiros where id = any (p_lancamento_ids);
  if v_tenant is null then raise exception 'Baixa não encontrada.'; end if;
  v_uid := public._exige_financeiro_para_baixar(v_tenant);

  select count(*)::int,
         count(distinct l.conta_bancaria_id)::int,
         count(distinct l.data_movimento)::int,
         (array_agg(l.conta_bancaria_id))[1],
         min(l.data_movimento),
         coalesce(sum(case when l.natureza = 'entrada' then l.valor else -l.valor end), 0)
    into v_n, v_contas, v_datas, v_conta, v_data, v_baixas
    from public.lancamentos_financeiros l
   where l.id = any (p_lancamento_ids)
     and l.tenant_id = v_tenant
     and l.estorno_de_lancamento_id is null
     and l.conta_bancaria_id is not null
     and l.extrato_linha_id is null
     and not exists (select 1 from public.historico_movimento_baixas b where b.lancamento_id = l.id);
  if v_n <> (select count(distinct x) from unnest(p_lancamento_ids) x) then
    raise exception 'Alguma baixa é estorno, não tem conta ou já está ligada ao banco ou à planilha: recarregue a página.';
  end if;
  if v_contas <> 1 or v_datas <> 1 then
    raise exception 'As baixas precisam ser da mesma conta e do mesmo dia.';
  end if;
  select saldo_inicial_data into v_inicio from public.contas_bancarias where id = v_conta;
  if v_data >= v_inicio then
    raise exception 'Baixa a partir de % se concilia com o banco, não com a planilha.',
      to_char(v_inicio, 'DD/MM/YYYY');
  end if;

  perform 1 from public.historico_movimentos where id = any (p_movimento_ids) for update;
  select count(*)::int, coalesce(sum(h.valor), 0)
    into v_n, v_linhas
    from public.historico_movimentos h
    join public.historico_cargas c on c.id = h.carga_id
   where h.id = any (p_movimento_ids)
     and h.tenant_id = v_tenant
     and c.situacao = 'ativa'
     and c.tipo in ('periodo', 'cauda', 'so_dre')
     and h.extrato_linha_id is null
     and h.conta_bancaria_id = v_conta
     and h.data = v_data
     and not exists (select 1 from public.historico_movimento_baixas b where b.historico_movimento_id = h.id);
  if v_n <> (select count(distinct x) from unnest(p_movimento_ids) x) then
    raise exception 'Alguma linha não é da mesma conta e do mesmo dia das baixas, não é de carga ativa ou já está ligada: recarregue a página.';
  end if;

  if abs(v_linhas - v_baixas) >= 0.005 then
    raise exception 'As linhas da planilha somam % e as baixas, %: confira as linhas ou os valores das baixas.',
      public._moeda_br(abs(v_linhas)), public._moeda_br(abs(v_baixas));
  end if;

  insert into public.historico_movimento_baixas (historico_movimento_id, lancamento_id, tenant_id, ligado_por)
  select distinct m.id, l.id, v_tenant, v_uid
    from unnest(p_movimento_ids) as m(id)
   cross join unnest(p_lancamento_ids) as l(id);
end;
$function$;

revoke all on function public.ligar_baixa_ao_historico(uuid[], uuid[]) from public, anon;
grant execute on function public.ligar_baixa_ao_historico(uuid[], uuid[]) to authenticated;

comment on function public.ligar_baixa_ao_historico(uuid[], uuid[]) is
  'Decisão 270: a conciliação do histórico. Liga baixas com data antes do início da conta às linhas da planilha (carga ativa periodo/cauda/so_dre) da mesma conta e do mesmo dia, quando as somas batem. Várias baixas numa linha (um PIX, duas PPs) ou várias linhas numa baixa.';

-- 4. ---------------------------------------------------------------------------
create or replace function public.baixar_parcela_pp_pelo_historico(p_parcela_id uuid, p_movimento_ids uuid[], p_tipo_id uuid, p_subtipo_id uuid, p_forma_pagamento forma_pagamento)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_parcela     pedidos_compra_parcelas%rowtype;
  v_n           integer;
  v_soma        numeric;
  v_contas      integer;
  v_datas       integer;
  v_conta_id    uuid;
  v_data        date;
  v_inicio      date;
  v_aberto      numeric;
  v_lancamento  uuid;
begin
  if coalesce(cardinality(p_movimento_ids), 0) = 0 then
    raise exception 'Escolha as linhas do histórico que pagaram esta parcela.';
  end if;
  if p_forma_pagamento is null then
    raise exception 'Informe a forma do pagamento.';
  end if;
  if p_forma_pagamento = 'cartao_credito' then
    raise exception 'O cartão não se baixa pelo histórico: o item entra na fatura.';
  end if;

  select * into v_parcela from public.pedidos_compra_parcelas where id = p_parcela_id for update;
  if not found then raise exception 'Parcela não encontrada.'; end if;
  perform public._exige_financeiro_para_baixar(v_parcela.tenant_id);

  perform 1 from public.historico_movimentos where id = any (p_movimento_ids) for update;
  select count(*)::int,
         coalesce(sum(h.valor), 0),
         count(distinct h.conta_bancaria_id)::int,
         count(distinct h.data)::int,
         (array_agg(h.conta_bancaria_id))[1],
         min(h.data)
    into v_n, v_soma, v_contas, v_datas, v_conta_id, v_data
    from public.historico_movimentos h
    join public.historico_cargas c on c.id = h.carga_id
   where h.id = any (p_movimento_ids)
     and h.tenant_id = v_parcela.tenant_id
     and c.situacao = 'ativa'
     and c.tipo in ('periodo', 'cauda', 'so_dre')
     and h.conta_bancaria_id is not null
     and h.valor < 0
     and h.extrato_linha_id is null
     -- Decisão 270: a ligação mora em historico_movimento_baixas.
     and not exists (select 1 from public.historico_movimento_baixas b where b.historico_movimento_id = h.id);
  if v_n <> (select count(distinct x) from unnest(p_movimento_ids) x) then
    raise exception 'Alguma linha do histórico não é uma saída de carga ativa, ou já está ligada a um pagamento: recarregue a página.';
  end if;
  if v_contas <> 1 or v_datas <> 1 then
    raise exception 'As linhas do histórico precisam ser da mesma conta e do mesmo dia.';
  end if;

  select saldo_inicial_data into v_inicio from public.contas_bancarias where id = v_conta_id;
  if v_data >= v_inicio then
    raise exception 'Pagamento a partir de % se baixa pela conciliação com o banco, não pelo histórico.',
      to_char(v_inicio, 'DD/MM/YYYY');
  end if;

  v_aberto := v_parcela.valor - public._bruto_baixado('pp_baixa', p_parcela_id);
  -- 17/11/2026: a soma pode ser menor que o que falta (pagamento em mais de um dia).
  if -v_soma - v_aberto >= 0.005 then
    raise exception 'As linhas do histórico somam %, e a parcela tem só % a pagar: ajuste o valor da PP antes.',
      public._moeda_br(-v_soma), public._moeda_br(v_aberto);
  end if;

  -- Decisão 270: a baixa comum já aceita a data antes do início da conta.
  v_lancamento := public.baixar_parcela_pp(
    p_parcela_id, v_data, v_conta_id, p_tipo_id, p_subtipo_id,
    p_forma_pagamento, null, -v_soma, '[]'::jsonb, 0, null
  );

  insert into public.historico_movimento_baixas (historico_movimento_id, lancamento_id, tenant_id, ligado_por)
  select distinct m.id, v_lancamento, v_parcela.tenant_id, auth.uid()
    from unnest(p_movimento_ids) as m(id);

  return v_lancamento;
end;
$function$;

-- 5. ---------------------------------------------------------------------------
create or replace function public.extrato_antes_do_inicio(
  p_conta_bancaria_id uuid,
  p_de date,
  p_ate date,
  p_limite integer default 4000
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_conta      public.contas_bancarias%rowtype;
  v_vespera    date;
  v_abertura   numeric;
  v_na_vespera numeric;
  v_de         date;
  v_ate        date;
  v_anterior   numeric;
  v_resumo     record;
  v_linhas     jsonb;
  v_ligados    jsonb;
  v_base       jsonb;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found or not v_conta.saldo_inicial_do_banco then
    return null;
  end if;
  if not (public.is_tenant_admin(v_conta.tenant_id) or public.is_tenant_financeiro(v_conta.tenant_id)) then
    return null;
  end if;

  v_vespera := v_conta.saldo_inicial_data - 1;

  -- O saldo da planilha na abertura da carga mais antiga (como em
  -- historico_extrato_da_conta).
  select s.saldo_planilha into v_abertura
    from public.historico_saldos s
    join public.historico_cargas c
      on c.id = s.carga_id and c.situacao = 'ativa' and c.tipo = 'periodo' and c.tenant_id = v_conta.tenant_id
   where s.conta_bancaria_id = v_conta.id and s.abertura
   order by s.mes
   limit 1;
  v_abertura := coalesce(v_abertura, 0);

  -- O histórico que conta no saldo e as baixas do sistema que nenhuma linha
  -- dele registra, até a véspera do início.
  with hist as (
    select m.data, m.valor
      from public.historico_movimentos m
      join public.historico_cargas c on c.id = m.carga_id and c.situacao = 'ativa' and c.tenant_id = v_conta.tenant_id
     where m.conta_bancaria_id = v_conta.id
       and m.data <= v_vespera
       and (c.tipo in ('periodo', 'cauda') or (c.tipo = 'previsao' and m.extrato_linha_id is not null))
  ), sis as (
    select l.data_movimento as data,
           case when l.natureza = 'entrada' then l.valor else -l.valor end as valor
      from public.lancamentos_financeiros l
     where l.conta_bancaria_id = v_conta.id
       and l.tenant_id = v_conta.tenant_id
       and l.data_movimento <= v_vespera
       and not exists (
         select 1
           from public.historico_movimento_baixas b
           join public.historico_movimentos m on m.id = b.historico_movimento_id
           join public.historico_cargas c on c.id = m.carga_id and c.situacao = 'ativa'
          where b.lancamento_id = l.id
            and (c.tipo in ('periodo', 'cauda') or (c.tipo = 'previsao' and m.extrato_linha_id is not null)))
  ), tudo as (
    select data, valor from hist
    union all
    select data, valor from sis
  )
  select v_abertura + coalesce(sum(valor), 0),
         v_abertura + coalesce(sum(valor) filter (where data < p_de), 0)
    into v_na_vespera, v_anterior
    from tudo;

  v_base := jsonb_build_object(
    'corte', v_conta.saldo_inicial_data,
    'vespera', v_vespera,
    'saldo_inicial', v_conta.saldo_inicial,
    'historico_na_vespera', round(v_na_vespera, 2),
    'ajuste', round(v_conta.saldo_inicial - v_na_vespera, 2),
    'periodo', null);

  v_de := p_de;
  v_ate := least(p_ate, v_vespera);
  if v_de > v_ate then
    return v_base;
  end if;

  select coalesce(sum(m.valor) filter (where m.valor > 0), 0) as creditos,
         coalesce(-sum(m.valor) filter (where m.valor < 0), 0) as debitos,
         count(*) as total
    into v_resumo
    from public.historico_movimentos m
    join public.historico_cargas c on c.id = m.carga_id and c.situacao = 'ativa' and c.tenant_id = v_conta.tenant_id
   where m.conta_bancaria_id = v_conta.id
     and m.data between v_de and v_ate
     and (c.tipo in ('periodo', 'cauda') or (c.tipo = 'previsao' and m.extrato_linha_id is not null));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'data', x.data, 'valor', x.valor, 'carga', x.tipo, 'classe', x.classe,
           'descricao', x.descricao, 'fornecedor', x.fornecedor, 'job', x.job_nome,
           'tipo_codigo', t.codigo, 'tipo_nome', t.nome, 'subtipo_nome', s.nome,
           'competencia_trimestre', x.competencia_trimestre, 'competencia_ano', x.competencia_ano,
           'empresa', x.empresa_nome, 'regional', x.regional_nome, 'todas', x.regional_todas,
           'pp_codigo', pp.codigos)
           order by x.data, x.ordem_carga, x.aba, x.linha), '[]'::jsonb)
    into v_linhas
    from (select m.*, c.tipo, case c.tipo when 'periodo' then 0 when 'cauda' then 1 else 2 end as ordem_carga
            from public.historico_movimentos m
            join public.historico_cargas c on c.id = m.carga_id and c.situacao = 'ativa' and c.tenant_id = v_conta.tenant_id
           where m.conta_bancaria_id = v_conta.id
             and m.data between v_de and v_ate
             and (c.tipo in ('periodo', 'cauda') or (c.tipo = 'previsao' and m.extrato_linha_id is not null))
           order by m.data, ordem_carga, m.aba, m.linha
           limit greatest(p_limite, 0)) x
    left join public.plano_contas_tipos t on t.id = x.plano_conta_tipo_id
    left join public.plano_contas_subtipos s on s.id = x.plano_conta_subtipo_id
    -- Decisão 270: a linha pode registrar mais de uma baixa (um PIX para
    -- duas PPs): os códigos saem juntos.
    left join lateral (
      select string_agg(distinct pc.codigo, ', ' order by pc.codigo) as codigos
        from public.historico_movimento_baixas b
        join public.lancamentos_financeiros lf on lf.id = b.lancamento_id
        join public.pedidos_compra pc on pc.id = lf.pedido_compra_id
       where b.historico_movimento_id = x.id
    ) pp on true;

  -- As baixas do período que uma linha do histórico já registra: o Extrato
  -- não as repete na parte do sistema.
  select coalesce(jsonb_agg(distinct l.id), '[]'::jsonb)
    into v_ligados
    from public.lancamentos_financeiros l
   where l.conta_bancaria_id = v_conta.id
     and l.tenant_id = v_conta.tenant_id
     and l.data_movimento between v_de and v_ate
     and exists (
       select 1
         from public.historico_movimento_baixas b
         join public.historico_movimentos m on m.id = b.historico_movimento_id
         join public.historico_cargas c on c.id = m.carga_id and c.situacao = 'ativa'
        where b.lancamento_id = l.id
          and (c.tipo in ('periodo', 'cauda') or (c.tipo = 'previsao' and m.extrato_linha_id is not null)));

  return v_base || jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'saldo_anterior', round(v_anterior, 2),
    'creditos', v_resumo.creditos,
    'debitos', v_resumo.debitos,
    'total', v_resumo.total,
    'linhas', v_linhas,
    'ligados', v_ligados);
end;
$function$;

create or replace function public.historico_extrato_da_conta(p_conta_bancaria_id uuid, p_de date, p_ate date, p_limite integer default 3000)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_conta     public.contas_bancarias%rowtype;
  v_cargas    uuid[];
  v_primeiro  date;
  v_ultimo    date;
  v_abertura  numeric;
  v_de        date;
  v_ate       date;
  v_base      jsonb;
  v_resumo    record;
  v_linhas    jsonb;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then return null; end if;
  if not (public.is_tenant_admin(v_conta.tenant_id) or public.is_tenant_financeiro(v_conta.tenant_id)) then
    return null;
  end if;

  -- Só as cargas de período: a cauda é depois do início da conta e entra no
  -- Extrato com os lançamentos (A6).
  select coalesce(array_agg(id), '{}') into v_cargas
    from public.historico_cargas
   where tenant_id = v_conta.tenant_id and situacao = 'ativa' and tipo = 'periodo';
  select min(data), max(data) into v_primeiro, v_ultimo
    from public.historico_movimentos
   where conta_bancaria_id = v_conta.id and carga_id = any(v_cargas);

  v_base := jsonb_build_object(
    'corte', v_conta.saldo_inicial_data,
    'cobertura', case when v_primeiro is null then null
                      else jsonb_build_object('de', v_primeiro, 'ate', v_ultimo) end,
    'periodo', null);
  if v_primeiro is null then return v_base; end if;

  -- O pedaço do período no histórico: do primeiro movimento ao dia antes de a
  -- conta começar no sistema.
  v_de := greatest(p_de, v_primeiro);
  v_ate := least(p_ate, v_conta.saldo_inicial_data - 1);
  if v_de > v_ate then return v_base; end if;

  -- A abertura da carga mais antiga: o saldo da planilha no fim do mês antes dela.
  select s.saldo_planilha into v_abertura
    from public.historico_saldos s
   where s.conta_bancaria_id = v_conta.id and s.carga_id = any(v_cargas) and s.abertura
   order by s.mes
   limit 1;

  select coalesce(sum(m.valor) filter (where m.valor > 0), 0) as creditos,
         coalesce(-sum(m.valor) filter (where m.valor < 0), 0) as debitos,
         count(*) as total
    into v_resumo
    from public.historico_movimentos m
   where m.conta_bancaria_id = v_conta.id and m.carga_id = any(v_cargas)
     and m.data between v_de and v_ate;

  -- Decisão 261: a baixa ligada à linha e o código da PP dela.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'data', m.data, 'valor', m.valor, 'classe', m.classe,
           'descricao', m.descricao, 'fornecedor', m.fornecedor, 'job', m.job_nome,
           'tipo_codigo', t.codigo, 'tipo_nome', t.nome, 'subtipo_nome', s.nome,
           'competencia_trimestre', m.competencia_trimestre, 'competencia_ano', m.competencia_ano,
           'empresa', m.empresa_nome, 'regional', m.regional_nome, 'todas', m.regional_todas,
           'tipo_planilha', m.tipo_planilha, 'cod', m.cod, 'aba', m.aba, 'linha', m.linha,
           'lancamento_ids', coalesce(lig.ids, '[]'::jsonb), 'pp_codigo', lig.codigos)
           order by m.data, m.linha), '[]'::jsonb)
    into v_linhas
    from (select *
            from public.historico_movimentos
           where conta_bancaria_id = v_conta.id and carga_id = any(v_cargas)
             and data between v_de and v_ate
           order by data, linha
           limit greatest(p_limite, 0)) m
    left join public.plano_contas_tipos t on t.id = m.plano_conta_tipo_id
    left join public.plano_contas_subtipos s on s.id = m.plano_conta_subtipo_id
    -- Decisão 270: as baixas que a linha registra (pode ser mais de uma).
    left join lateral (
      select jsonb_agg(b.lancamento_id) as ids,
             string_agg(distinct pc.codigo, ', ' order by pc.codigo) as codigos
        from public.historico_movimento_baixas b
        join public.lancamentos_financeiros lf on lf.id = b.lancamento_id
        left join public.pedidos_compra pc on pc.id = lf.pedido_compra_id
       where b.historico_movimento_id = m.id
    ) lig on true;

  return v_base || jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'saldo_anterior', coalesce(v_abertura, 0) + coalesce((
        select sum(m.valor) from public.historico_movimentos m
         where m.conta_bancaria_id = v_conta.id and m.carga_id = any(v_cargas) and m.data < v_de), 0),
    'creditos', v_resumo.creditos,
    'debitos', v_resumo.debitos,
    'total', v_resumo.total,
    'linhas', v_linhas);
end;
$function$;
