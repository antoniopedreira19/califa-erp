-- =============================================================================
-- A rentabilidade dos jobs do histórico (decisão 211, A4)
-- =============================================================================
-- Decidido pelo Tiago em 26/10/2026: o relatório "Rentabilidade dos jobs do
-- histórico" mostra as duas contas das abas Res. Jobs da planilha:
--   - o resultado: a receita do job (TOTAL RECEITA) menos o imposto das notas
--     dele (IMPOSTO) menos o custo (TOTAL CO), como o Result. Op do relatório
--     de Rentabilidade de Jobs;
--   - a rentabilidade: o resultado menos o fee líquido, que a planilha calcula
--     por dentro sobre a receita menos o imposto, com o percentual de fee de
--     cada job (12% na California, 15% na CCH, 13% em alguns jobs).
-- Vale só para os dados históricos importados; os jobs novos continuam com os
-- honorários das planilhas internas.
--
--   1. `historico_jobs.fee_percentual`: o percentual de fee do job, em fração,
--      lido da coluna logo depois de "FEE LÍQUIDO". Nasce vazio; a carga
--      refeita pela tela o preenche.
--   2. Índice dos lançamentos por job, para somar a receita e o custo de cada
--      um.
--   3. `historico_gravar_parte`: a carga grava o percentual.
--   4. `historico_rentabilidade_jobs`: os jobs de um ano (a aba Res. Jobs),
--      com cliente, marca, trimestre, fee e as somas de cada um nas cargas
--      ativas — a receita (Tipo REC, crédito − débito), o custo (Tipo CO,
--      débito − crédito) e o imposto das notas emitidas. A conta do resultado
--      e da rentabilidade fica em `lib/historico-financeiro/rentabilidade.ts`.
--
-- Mudança ADITIVA: uma coluna que nasce vazia, um índice, a função da carga
-- trocada pela mesma assinatura e uma função nova.
-- =============================================================================

alter table public.historico_jobs
  add column fee_percentual numeric
    check (fee_percentual is null or (fee_percentual > 0 and fee_percentual < 1));

comment on column public.historico_jobs.fee_percentual is
  'O percentual de fee do job, em fração (0.12), lido da coluna logo depois de "FEE LÍQUIDO" das abas Res. Jobs. A planilha calcula o fee líquido por dentro: (receita − imposto) × fee ÷ (1 + fee).';

create index idx_historico_movimentos_job
  on public.historico_movimentos (carga_id, job_chave)
  where job_chave is not null;

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
      codigo_antigo, job_id, job_codigo, fora_do_resultado, outras_abas, rateio_regional, imposto_teorico_percentual,
      fee_percentual
    )
    select v_carga.tenant_id, v_carga.id, r.chave, r.nome, e.id, r.empresa, r.aba, r.linha, r.ano, r.trimestre, r.projeto,
           cl.id, r.cliente_planilha, mc.id, r.marca_planilha, sv.id, r.servico_planilha, r.gp, r.data_inicio,
           rg.id, r.regional, coalesce(r.regional_todas, false), r.regional_planilha, r.regional_por, r.marcador,
           r.status_planilha, r.codigo_antigo, jb.id, r.job_codigo, r.fora_do_resultado, r.outras_abas,
           rt.rateio, r.imposto_teorico_percentual, r.fee_percentual
      from jsonb_to_recordset(p_linhas) as r(
             chave text, nome text, empresa text, aba text, linha integer, ano smallint, trimestre text, projeto text,
             cliente_sigla text, cliente_planilha text, marca text, marca_planilha text, servico text,
             servico_planilha text, gp text, data_inicio date, regional text, regional_todas boolean,
             regional_planilha text, regional_por text, marcador text, status_planilha text, codigo_antigo text,
             job_codigo text, fora_do_resultado text, outras_abas text, rateio_regional text,
             imposto_teorico_percentual numeric, fee_percentual numeric)
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
   where tenant_id = p_tenant_id and situacao = 'ativa';

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
       and m.carga_id = any(v_cargas)
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

revoke all on function public.historico_rentabilidade_jobs(uuid, integer) from public, anon;
grant execute on function public.historico_rentabilidade_jobs(uuid, integer) to authenticated;
