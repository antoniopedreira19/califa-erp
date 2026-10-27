-- =============================================================================
-- O faturamento do histórico por CNPJ emissor (decisão 211, A4)
-- =============================================================================
-- Decidido pelo Tiago em 26/10/2026: o relatório "Faturamento dos jobs do
-- histórico" ganha a visão por CNPJ, equivalente às abas de Faturamento da
-- planilha (uma por CNPJ ou estabelecimento), e ela é a visão padrão:
--   - a nota cai no mês da data de emissão;
--   - entram todas as notas emitidas da aba, com as sem job e as de
--     distribuição de lucro marcadas à parte; as canceladas ficam fora;
--   - um CNPJ abre a lista das notas dele.
-- As visões por job ganham o filtro do emissor.
--
--   1. `historico_faturamento_notas`: as notas emitidas de um ano, pela data
--      de emissão, com o estabelecimento (a aba), a classe e o job.
--   2. `historico_faturamento_jobs`: cada job traz também as notas por
--      emissor, para o filtro. Mesma assinatura.
--
-- Mudança ADITIVA: uma função nova e uma trocada pela mesma assinatura, as
-- duas só de leitura. A emissão já tem índice (`idx_historico_notas_emissao`).
-- =============================================================================

create or replace function public.historico_faturamento_notas(
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
  v_notas     jsonb;
begin
  if not (public.is_tenant_admin(p_tenant_id) or public.is_tenant_financeiro(p_tenant_id)) then
    return null;
  end if;

  select coalesce(array_agg(id), '{}'),
         case when count(*) = 0 then null
              else jsonb_build_object('de', min(periodo_de), 'ate', max(periodo_ate), 'versao', max(planilha_versao)) end
    into v_cargas, v_cobertura
    from public.historico_cargas
   where tenant_id = p_tenant_id and situacao = 'ativa';

  select coalesce(jsonb_agg(jsonb_build_object(
           'estabelecimento', n.estabelecimento, 'aba', n.aba, 'linha', n.linha, 'numero', n.numero,
           'classe', n.classe, 'empresa', n.empresa_nome, 'job', coalesce(n.job_nome, n.coluna_job),
           'cliente', n.cliente, 'emissao', n.emissao, 'vencimento', n.vencimento, 'recebimento', n.recebimento,
           'valor', coalesce(n.valor, 0), 'impostos', coalesce(n.total_impostos, 0))
           order by n.emissao, n.aba, n.linha), '[]'::jsonb)
    into v_notas
    from public.historico_notas n
   where n.tenant_id = p_tenant_id
     and n.carga_id = any(v_cargas)
     and n.situacao = 'emitida'
     and n.emissao >= make_date(p_ano, 1, 1)
     and n.emissao < make_date(p_ano + 1, 1, 1);

  return jsonb_build_object('cobertura', v_cobertura, 'notas', v_notas);
end;
$$;

revoke all on function public.historico_faturamento_notas(uuid, integer) from public, anon;
grant execute on function public.historico_faturamento_notas(uuid, integer) to authenticated;

create or replace function public.historico_faturamento_jobs(
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
              else jsonb_build_object('de', min(periodo_de), 'ate', max(periodo_ate), 'versao', max(planilha_versao)) end
    into v_cargas, v_cobertura
    from public.historico_cargas
   where tenant_id = p_tenant_id and situacao = 'ativa';

  -- Os jobs do ano: cada carga traz todos, e vale o da carga ativa mais
  -- recente. As notas somam todas as cargas ativas, em qualquer data, por
  -- emissor (a aba de Faturamento).
  with jobs as (
    select distinct on (j.chave)
           j.chave, j.nome, j.empresa_nome, j.trimestre, j.cliente_id, j.cliente_planilha,
           j.marca_id, j.marca_planilha
      from public.historico_jobs j
      join public.historico_cargas c on c.id = j.carga_id
     where j.tenant_id = p_tenant_id
       and j.carga_id = any(v_cargas)
       and j.ano = p_ano
     order by j.chave, c.created_at desc
  ), por_emissor as (
    select n.job_chave, n.estabelecimento,
           count(*) as notas,
           sum(coalesce(n.valor, 0)) as faturado,
           coalesce(sum(coalesce(n.valor, 0)) filter (where n.recebimento is not null), 0) as recebido
      from public.historico_notas n
     where n.tenant_id = p_tenant_id
       and n.carga_id = any(v_cargas)
       and n.job_chave in (select chave from jobs)
       and n.situacao = 'emitida'
     group by 1, 2
  ), notas as (
    select job_chave, sum(notas) as notas, sum(faturado) as faturado, sum(recebido) as recebido,
           jsonb_object_agg(estabelecimento, jsonb_build_object('notas', notas, 'faturado', faturado, 'recebido', recebido)) as emissores
      from por_emissor
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', j.chave, 'nome', j.nome, 'empresa', j.empresa_nome, 'trimestre', j.trimestre,
           'cliente_id', j.cliente_id, 'cliente', coalesce(cl.nome_fantasia, cl.razao_social, j.cliente_planilha),
           'marca_id', j.marca_id, 'marca', coalesce(mc.nome, j.marca_planilha),
           'notas', coalesce(nt.notas, 0), 'faturado', coalesce(nt.faturado, 0), 'recebido', coalesce(nt.recebido, 0),
           'emissores', coalesce(nt.emissores, '{}'::jsonb))), '[]'::jsonb)
    into v_jobs
    from jobs j
    left join notas nt on nt.job_chave = j.chave
    left join public.clientes cl on cl.id = j.cliente_id
    left join public.cliente_produtos mc on mc.id = j.marca_id;

  return jsonb_build_object('cobertura', v_cobertura, 'jobs', v_jobs);
end;
$$;

revoke all on function public.historico_faturamento_jobs(uuid, integer) from public, anon;
grant execute on function public.historico_faturamento_jobs(uuid, integer) to authenticated;
