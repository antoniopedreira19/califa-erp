-- O ajuste de abertura no Extrato (pedido do Tiago em 16/11/2026, revisão das
-- decisões 211 e 091).
--
-- O problema: no recomeço de 06/11 (migration 20261106900001), oito contas
-- passaram a começar no sistema em 03/11 com o saldo do banco. O que veio
-- antes virou histórico, e a diferença entre o histórico e o saldo do banco
-- ficou só como "número de controle", fora da tela. O Extrato mostrava dois
-- blocos que não se ligavam (histórico parado em 30/09 e sistema a partir de
-- 0), e as linhas da planilha de outubro (a cauda antes do início) não
-- apareciam em lugar nenhum.
--
-- A regra (Tiago, 16/11): um extrato só, com saldo contínuo. Antes do início
-- da conta, o histórico da planilha (cargas `periodo` e `cauda`, e a previsão
-- já ligada ao banco) e as baixas do sistema com data anterior; na véspera do
-- início, a linha "Ajuste de abertura · diferença a identificar", que leva o
-- saldo exatamente ao saldo inicial do banco. O ajuste é CALCULADO, nunca
-- gravado: saldo inicial − (histórico + baixas antes do início). Quando um
-- lançamento que falta entra no histórico (ou uma baixa antiga entra no
-- sistema), o ajuste diminui sozinho; o saldo a partir do início não muda.
-- Fora do DRE. A carga `so_dre` continua fora do saldo (decisão 211).
--
-- 1. `contas_bancarias.saldo_inicial_do_banco`: a conta cujo saldo inicial veio
--    do extrato do banco. Só nela o Extrato junta o histórico e mostra o
--    ajuste. As contas que começaram com R$ 0,00 sem conferir o banco ficam
--    de fora até receberem o saldo do extrato (o ajuste nelas mediria o saldo
--    que falta, não a lacuna).
-- 2. Marca as oito contas do recomeço de 03/11 (coluna nova, valor novo:
--    aditivo).
-- 3. `extrato_antes_do_inicio`: o trecho do período antes do início, o saldo
--    contínuo antes dele, as linhas da planilha, as baixas do sistema que uma
--    linha do histórico já registra (decisão 261, para não contar duas vezes)
--    e o ajuste. Devolve null para conta sem a marca.

alter table public.contas_bancarias
  add column if not exists saldo_inicial_do_banco boolean not null default false;

comment on column public.contas_bancarias.saldo_inicial_do_banco is
  'O saldo inicial veio do extrato do banco (recomeço de 03/11/2026). O Extrato junta o histórico antes do início e mostra o ajuste de abertura (saldo inicial − histórico e baixas antes do início).';

update public.contas_bancarias
   set saldo_inicial_do_banco = true
 where id in (
   '18f505b2-81ad-4076-83d7-6a020b6f79ae', -- California Santander
   '82ff921c-a54b-4844-af40-f6eedb88eb00', -- Santander ContaMax California
   '2106c129-3aa7-4994-90cd-22f81821b1af', -- BB California
   '3b25fc6b-e48a-4616-9ead-fd98318ad7c2', -- BB Rende Fácil California
   '6ba5ea71-44bd-4f69-9e16-baa229fde531', -- Santander GoCrazy
   '8d360b9a-e4d5-435f-a0a5-f06effbe046f', -- Santander ContaMax GoCrazy
   '48420543-bdee-473b-932a-f32c627d1a25', -- Santander Hitlab
   '384fb143-0ef1-459e-8b65-4a67fcd5265f'  -- Santander ContaMax Hitlab
 )
   and saldo_inicial_data = date '2026-11-03'
   and not saldo_inicial_do_banco;

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
           from public.historico_movimentos m
           join public.historico_cargas c on c.id = m.carga_id and c.situacao = 'ativa'
          where m.lancamento_id = l.id
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
           'pp_codigo', pc.codigo)
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
    left join public.lancamentos_financeiros lf on lf.id = x.lancamento_id
    left join public.pedidos_compra pc on pc.id = lf.pedido_compra_id;

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
         from public.historico_movimentos m
         join public.historico_cargas c on c.id = m.carga_id and c.situacao = 'ativa'
        where m.lancamento_id = l.id
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

revoke all on function public.extrato_antes_do_inicio(uuid, date, date, integer) from public, anon;
grant execute on function public.extrato_antes_do_inicio(uuid, date, date, integer) to authenticated;

comment on function public.extrato_antes_do_inicio(uuid, date, date, integer) is
  'Extrato da conta antes do início no sistema (saldo inicial do banco): histórico que conta no saldo, baixas do sistema com data anterior e o ajuste de abertura calculado. Null para conta sem saldo_inicial_do_banco.';
