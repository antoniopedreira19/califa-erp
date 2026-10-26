-- =============================================================================
-- O resultado por regional pela divisão de cada job (decisão 211, A4)
-- =============================================================================
-- A DRE regional da planilha (as abas "DRE Califa Regional" e "DRE CMH
-- Regional" do Fechamento) divide o faturamento, o imposto e o custo
-- operacional pelos jobs: cada linha das abas Res. Jobs traz a parte de cada
-- regional (o grupo "RATEIO %", com o código da regional embaixo) e a
-- alíquota teórica do job ("Imp Real %"). O imposto da regional é o teórico
-- (faturamento × alíquota); o benefício do ISS e do PERSE (o teórico menos o
-- imposto pago, Tipo CT) se rateia depois pelo faturamento de cada regional.
--
--   1. `historico_jobs` ganha a divisão (`rateio_regional`, objeto
--      {"NE": 0.25, "SP": 0.75}, só as partes que não são zero, como a
--      planilha registra) e a alíquota (`imposto_teorico_percentual`, fração).
--   2. `historico_gravar_parte`: o pacote leva a divisão como texto
--      ("NE:0.25;SP:0.75"), conferido aqui antes de virar objeto.
--   3. `historico_regional`: o REC e o CO do job com divisão saem divididos
--      pelas partes dele, com a marca `pelo_job`; o REC leva o imposto teórico
--      (`teorico`). O resto continua na regional do lançamento. A regra das
--      linhas fica em `lib/historico-financeiro/regional.ts`.
--
-- Os jobs das cargas já gravadas ficam com as colunas novas vazias até a
-- carga ser refeita pela tela (o pacote novo traz as duas colunas).
--
-- Mudança ADITIVA: duas colunas que nascem vazias e as duas funções trocadas
-- pela mesma assinatura.
-- =============================================================================

alter table public.historico_jobs
  add column rateio_regional jsonb
    check (rateio_regional is null or jsonb_typeof(rateio_regional) = 'object'),
  add column imposto_teorico_percentual numeric
    check (imposto_teorico_percentual is null or imposto_teorico_percentual between 0 and 1);

comment on column public.historico_jobs.rateio_regional is
  'A parte de cada regional no job (grupo "RATEIO %" das abas Res. Jobs), pelo código da planilha: {"NE": 0.25, "SP": 0.75}. Só as partes que não são zero; nulo quando a planilha não divide o job.';
comment on column public.historico_jobs.imposto_teorico_percentual is
  'A alíquota teórica do job ("Imp Real %" das abas Res. Jobs), em fração (0.1953).';

create or replace function public.historico_gravar_parte(p_carga_id uuid, p_tabela text, p_linhas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carga  public.historico_cargas%rowtype;
  v_uid    uuid;
  v_texto  text;
  v_n      integer;
  v_feitas integer;
begin
  -- FOR SHARE: a conclusão (FOR UPDATE) espera a parte que está entrando.
  select * into v_carga from public.historico_cargas where id = p_carga_id for share;
  if not found then raise exception 'Carga não encontrada.'; end if;
  v_uid := public._exige_financeiro_historico(v_carga.tenant_id);
  if v_carga.situacao <> 'carregando' then
    raise exception 'Esta carga não está em andamento.';
  end if;
  if v_carga.criada_por <> v_uid then
    raise exception 'Só quem começou a carga envia as partes dela.';
  end if;
  if jsonb_typeof(p_linhas) is distinct from 'array' then
    raise exception 'A parte não tem linhas.';
  end if;
  v_n := jsonb_array_length(p_linhas);
  if v_n = 0 or v_n > 2000 then
    raise exception 'Cada parte leva de 1 a 2.000 linhas.';
  end if;

  -- A conta é a única ligação obrigatória: o histórico não cria conta.
  if p_tabela in ('movimentos', 'saldos') then
    select r.conta into v_texto
      from jsonb_to_recordset(p_linhas) as r(conta text)
     where not exists (select 1 from public.contas_bancarias c
                        where c.tenant_id = v_carga.tenant_id and c.nome = r.conta)
     limit 1;
    if found then
      raise exception 'A conta "%" não está cadastrada: cadastre a conta antes de carregar o histórico dela.', v_texto;
    end if;
  end if;

  if p_tabela = 'movimentos' then
    if exists (select 1 from jsonb_to_recordset(p_linhas) as r(data date)
                where r.data is null or r.data < v_carga.periodo_de or r.data > v_carga.periodo_ate) then
      raise exception 'Há movimento fora do período da carga (% a %).',
        to_char(v_carga.periodo_de, 'DD/MM/YYYY'), to_char(v_carga.periodo_ate, 'DD/MM/YYYY');
    end if;
    insert into public.historico_movimentos (
      tenant_id, carga_id, conta_bancaria_id, data, valor, credito_planilha, debito_planilha, classe,
      empresa_id, empresa_nome, sigla_planilha, grupo, cod, competencia_trimestre, competencia_ano,
      plano_conta_tipo_id, plano_conta_subtipo_id, plano_codigo,
      regional_id, regional_nome, regional_todas, regional_planilha,
      job_chave, job_nome, job_coluna, tipo_planilha, descricao, fornecedor, parcela, documento, observacao,
      contrapartida, coluna_jobs, coluna_evento, coluna_reg, coluna_reg_cmh, dre_extra, ano_comp, aba, linha, digital
    )
    select v_carga.tenant_id, v_carga.id, c.id, r.data, round(r.valor, 2),
           round(r.credito_planilha, 2), round(r.debito_planilha, 2), r.classe,
           e.id, r.empresa, r.sigla_planilha, r.grupo, r.cod, r.competencia_trimestre, r.competencia_ano,
           pt.id, ps.id, nullif(concat_ws('.', r.plano_tipo, r.plano_subtipo), ''),
           rg.id, r.regional, coalesce(r.regional_todas, false), r.regional_planilha,
           r.job_chave, r.job_nome, r.job_coluna, r.tipo_planilha, r.descricao, r.fornecedor, r.parcela,
           r.documento, r.observacao, r.contrapartida, r.coluna_jobs, r.coluna_evento, r.coluna_reg,
           r.coluna_reg_cmh, r.dre_extra, r.ano_comp, r.aba, r.linha, r.digital
      from jsonb_to_recordset(p_linhas) as r(
             conta text, data date, valor numeric, credito_planilha numeric, debito_planilha numeric, classe text,
             empresa text, sigla_planilha text, grupo text, cod text, competencia_trimestre smallint,
             competencia_ano smallint, plano_tipo text, plano_subtipo text, regional text, regional_todas boolean,
             regional_planilha text, job_chave text, job_nome text, job_coluna text, tipo_planilha text,
             descricao text, fornecedor text, parcela text, documento text, observacao text, contrapartida text,
             coluna_jobs text, coluna_evento text, coluna_reg text, coluna_reg_cmh text, dre_extra text,
             ano_comp text, aba text, linha integer, digital text)
      cross join lateral (select c.id from public.contas_bancarias c
                           where c.tenant_id = v_carga.tenant_id and c.nome = r.conta
                           order by c.created_at limit 1) c
      left join lateral (select e.id from public.empresas e
                          where e.tenant_id = v_carga.tenant_id and coalesce(e.nome_fantasia, e.razao_social) = r.empresa
                          order by e.created_at limit 1) e on true
      left join lateral (select t.id from public.plano_contas_tipos t
                          where t.tenant_id = v_carga.tenant_id and t.codigo = r.plano_tipo
                          order by t.created_at limit 1) pt on true
      left join lateral (select s.id from public.plano_contas_subtipos s
                          where s.tipo_id = pt.id and s.codigo = r.plano_subtipo
                          order by s.created_at limit 1) ps on true
      left join lateral (select g.id from public.regionais g
                          where g.tenant_id = v_carga.tenant_id and g.empresa_id = e.id and g.nome = r.regional
                          order by g.created_at limit 1) rg on true
    on conflict do nothing;

  elsif p_tabela = 'notas' then
    if exists (select 1 from jsonb_to_recordset(p_linhas) as r(emissao date)
                where r.emissao < v_carga.periodo_de or r.emissao > v_carga.periodo_ate) then
      raise exception 'Há nota emitida fora do período da carga (% a %).',
        to_char(v_carga.periodo_de, 'DD/MM/YYYY'), to_char(v_carga.periodo_ate, 'DD/MM/YYYY');
    end if;
    insert into public.historico_notas (
      tenant_id, carga_id, empresa_id, empresa_nome, empresa_por, estabelecimento, numero, situacao, classe,
      emissao, competencia_trimestre, competencia_ano, vencimento, recebimento,
      valor, deducao, valor_tributavel, iss, pis, cofins, csll, ir, adicional_ir, retencoes, total_impostos,
      job_chave, job_nome, coluna_job, cliente, municipio, cnae, obs, observacao, aba, linha
    )
    select v_carga.tenant_id, v_carga.id, e.id, r.empresa, r.empresa_por, r.estabelecimento, r.numero, r.situacao, r.classe,
           r.emissao, r.competencia_trimestre, r.competencia_ano, r.vencimento, r.recebimento,
           round(r.valor, 2), round(r.deducao, 2), round(r.valor_tributavel, 2), round(r.iss, 2), round(r.pis, 2),
           round(r.cofins, 2), round(r.csll, 2), round(r.ir, 2), round(r.adicional_ir, 2), round(r.retencoes, 2),
           round(r.total_impostos, 2), r.job_chave, r.job_nome, r.coluna_job, r.cliente, r.municipio, r.cnae,
           r.obs, r.observacao, r.aba, r.linha
      from jsonb_to_recordset(p_linhas) as r(
             empresa text, empresa_por text, estabelecimento text, numero text, situacao text, classe text,
             emissao date, competencia_trimestre smallint, competencia_ano smallint, vencimento date, recebimento date,
             valor numeric, deducao numeric, valor_tributavel numeric, iss numeric, pis numeric, cofins numeric,
             csll numeric, ir numeric, adicional_ir numeric, retencoes numeric, total_impostos numeric,
             job_chave text, job_nome text, coluna_job text, cliente text, municipio text, cnae text,
             obs text, observacao text, aba text, linha integer)
      left join lateral (select e.id from public.empresas e
                          where e.tenant_id = v_carga.tenant_id and coalesce(e.nome_fantasia, e.razao_social) = r.empresa
                          order by e.created_at limit 1) e on true
    on conflict do nothing;

  elsif p_tabela = 'jobs' then
    -- A divisão do job vem como texto ("NE:0.25;SP:0.75") e vira um objeto.
    select r.chave into v_texto
      from jsonb_to_recordset(p_linhas) as r(chave text, rateio_regional text)
     where r.rateio_regional !~ '^[A-Z0-9]+( [A-Z0-9]+)*:-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?(;[A-Z0-9]+( [A-Z0-9]+)*:-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?)*$'
     limit 1;
    if found then
      raise exception 'A divisão por regional do job "%" não tem o formato esperado.', v_texto;
    end if;
    insert into public.historico_jobs (
      tenant_id, carga_id, chave, nome, empresa_id, empresa_nome, aba, linha, ano, trimestre, projeto,
      cliente_id, cliente_planilha, marca_id, marca_planilha, servico_id, servico_planilha, gp, data_inicio,
      regional_id, regional_nome, regional_todas, regional_planilha, regional_por, marcador, status_planilha,
      codigo_antigo, job_id, job_codigo, fora_do_resultado, outras_abas, rateio_regional, imposto_teorico_percentual
    )
    select v_carga.tenant_id, v_carga.id, r.chave, r.nome, e.id, r.empresa, r.aba, r.linha, r.ano, r.trimestre, r.projeto,
           cl.id, r.cliente_planilha, mc.id, r.marca_planilha, sv.id, r.servico_planilha, r.gp, r.data_inicio,
           rg.id, r.regional, coalesce(r.regional_todas, false), r.regional_planilha, r.regional_por, r.marcador,
           r.status_planilha, r.codigo_antigo, jb.id, r.job_codigo, r.fora_do_resultado, r.outras_abas,
           rt.rateio, r.imposto_teorico_percentual
      from jsonb_to_recordset(p_linhas) as r(
             chave text, nome text, empresa text, aba text, linha integer, ano smallint, trimestre text, projeto text,
             cliente_sigla text, cliente_planilha text, marca text, marca_planilha text, servico text,
             servico_planilha text, gp text, data_inicio date, regional text, regional_todas boolean,
             regional_planilha text, regional_por text, marcador text, status_planilha text, codigo_antigo text,
             job_codigo text, fora_do_resultado text, outras_abas text, rateio_regional text,
             imposto_teorico_percentual numeric)
      left join lateral (select jsonb_object_agg(split_part(p.parte, ':', 1), split_part(p.parte, ':', 2)::numeric) as rateio
                           from unnest(string_to_array(r.rateio_regional, ';')) as p(parte)) rt on true
      left join lateral (select e.id from public.empresas e
                          where e.tenant_id = v_carga.tenant_id and coalesce(e.nome_fantasia, e.razao_social) = r.empresa
                          order by e.created_at limit 1) e on true
      left join lateral (select c.id from public.clientes c
                          where c.tenant_id = v_carga.tenant_id and c.codigo_curto = r.cliente_sigla
                          order by c.created_at limit 1) cl on true
      left join lateral (select p.id from public.cliente_produtos p
                          where p.cliente_id = cl.id and p.nome = r.marca
                          order by p.created_at limit 1) mc on true
      left join lateral (select s.id from public.categorias_dominio s
                          where s.tenant_id = v_carga.tenant_id and s.escopo::text = 'projeto' and s.nome = r.servico
                          order by s.created_at limit 1) sv on true
      left join lateral (select g.id from public.regionais g
                          where g.tenant_id = v_carga.tenant_id and g.empresa_id = e.id and g.nome = r.regional
                          order by g.created_at limit 1) rg on true
      left join lateral (select j.id from public.jobs j
                          where j.tenant_id = v_carga.tenant_id and j.codigo = r.job_codigo
                          order by j.created_at limit 1) jb on true
    on conflict do nothing;

  elsif p_tabela = 'rateio' then
    select r.empresa into v_texto
      from jsonb_to_recordset(p_linhas) as r(empresa text)
     where not exists (select 1 from public.empresas e
                        where e.tenant_id = v_carga.tenant_id and coalesce(e.nome_fantasia, e.razao_social) = r.empresa)
     limit 1;
    if found then
      raise exception 'A empresa "%" do rateio não está cadastrada.', v_texto;
    end if;
    insert into public.historico_rateio_regional (
      tenant_id, carga_id, ano, trimestre, empresa_id, grupo, regional_id, regional_nome, percentual, origem
    )
    select v_carga.tenant_id, v_carga.id, r.ano, r.trimestre, e.id, r.grupo, rg.id, r.regional, r.percentual, r.origem
      from jsonb_to_recordset(p_linhas) as r(
             ano smallint, trimestre smallint, empresa text, grupo text, regional text, percentual numeric, origem text)
      cross join lateral (select e.id from public.empresas e
                           where e.tenant_id = v_carga.tenant_id and coalesce(e.nome_fantasia, e.razao_social) = r.empresa
                           order by e.created_at limit 1) e
      left join lateral (select g.id from public.regionais g
                          where g.tenant_id = v_carga.tenant_id and g.empresa_id = e.id and g.nome = r.regional
                          order by g.created_at limit 1) rg on true
    on conflict do nothing;

  elsif p_tabela = 'saldos' then
    if exists (select 1 from jsonb_to_recordset(p_linhas) as r(mes date)
                where r.mes is null
                   or r.mes < (date_trunc('month', v_carga.periodo_de) - interval '1 month')::date
                   or r.mes > v_carga.periodo_ate) then
      raise exception 'Há saldo fora do período da carga.';
    end if;
    insert into public.historico_saldos (tenant_id, carga_id, conta_bancaria_id, mes, saldo_planilha, movimento, abertura)
    select v_carga.tenant_id, v_carga.id, c.id, r.mes, round(r.saldo_planilha, 2), round(r.movimento, 2),
           coalesce(r.abertura, false)
      from jsonb_to_recordset(p_linhas) as r(conta text, mes date, saldo_planilha numeric, movimento numeric, abertura boolean)
      cross join lateral (select c.id from public.contas_bancarias c
                           where c.tenant_id = v_carga.tenant_id and c.nome = r.conta
                           order by c.created_at limit 1) c
    on conflict do nothing;

  else
    raise exception 'Tabela desconhecida: %.', p_tabela;
  end if;

  get diagnostics v_feitas = row_count;
  return v_feitas;
end;
$$;

revoke all on function public.historico_gravar_parte(uuid, text, jsonb) from public, anon;
grant execute on function public.historico_gravar_parte(uuid, text, jsonb) to authenticated;


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
   where tenant_id = p_tenant_id and situacao = 'ativa';

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
  -- se calculam uma vez (CTE materializada), e não uma vez por movimento.
  with partes as materialized (
    select j.carga_id, j.chave, e.key as codigo, e.value::numeric / s.soma as parte
      from public.historico_jobs j
     cross join lateral (select sum(v.value::numeric) as soma from jsonb_each_text(j.rateio_regional) as v) as s
     cross join lateral jsonb_each_text(j.rateio_regional) as e
     where j.tenant_id = p_tenant_id
       and j.carga_id = any(v_cargas)
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
       and m.carga_id = any(v_cargas)
       and m.competencia_ano = p_ano
       and m.competencia_trimestre is not null
       and m.grupo is not null
     group by 1, 2, 3, 4, 5, 6, 7, 8
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sigla', g.sigla, 'grupo', g.grupo, 'trimestre', g.trimestre, 'aba', g.aba,
           'regional', g.regional, 'todas', g.todas, 'pelo_job', g.pelo_job,
           'credito', g.credito, 'debito', g.debito, 'teorico', g.teorico)), '[]'::jsonb)
    into v_grupos
    from (
      select s.sigla, s.grupo, s.trimestre, s.aba,
             coalesce(p.codigo, s.regional) as regional,
             p.codigo is null and s.todas as todas,
             p.codigo is not null as pelo_job,
             sum(s.credito * coalesce(p.parte, 1)) as credito,
             sum(s.debito * coalesce(p.parte, 1)) as debito,
             sum(case when s.grupo = 'REC'
                      then (s.credito - s.debito) * coalesce(p.parte, 1) * coalesce(j.imposto_teorico_percentual, 0)
                      else 0 end) as teorico
        from somas s
        left join public.historico_jobs j on j.carga_id = s.carga_id and j.chave = s.job_chave
        left join partes p on p.carga_id = s.carga_id and p.chave = s.job_chave
       group by 1, 2, 3, 4, 5, 6, 7
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
       and m.carga_id = any(v_cargas)
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

revoke all on function public.historico_regional(uuid, integer, text[]) from public, anon;
grant execute on function public.historico_regional(uuid, integer, text[]) to authenticated;
