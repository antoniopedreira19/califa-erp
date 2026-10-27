-- =============================================================================
-- O faturamento dos jobs do histórico (decisão 211, A4)
-- =============================================================================
-- Decidido pelo Tiago em 26/10/2026: o relatório "Faturamento dos jobs do
-- histórico" lê as notas do job, como o par do Faturamento de Jobs do
-- sistema. O histórico não tem o valor contratado do job, então a comparação
-- passa a ser faturado × recebido:
--   - faturado: o valor das notas emitidas do job, em qualquer data (as
--     canceladas e as previsões não entram no histórico);
--   - recebido: as notas com data de recebimento na planilha;
--   - a receber: as notas sem essa data.
-- O período é o ano e o trimestre do job (a aba Res. Jobs e a coluna T), como
-- na rentabilidade dos jobs do histórico.
--
--   1. `historico_faturamento_jobs`: os jobs de um ano, com cliente, marca e
--      trimestre, e o número de notas emitidas, o faturado e o recebido de
--      cada um nas cargas ativas. A cobertura traz também a versão da
--      planilha, porque o recebimento é o que essa versão registra. A situação
--      do job e o a receber ficam em `lib/historico-financeiro/faturamento.ts`.
--
-- Mudança ADITIVA: uma função nova, de leitura. As notas já têm índice por
-- carga e job (`idx_historico_notas_job`).
-- =============================================================================

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
  -- recente. As notas somam todas as cargas ativas, em qualquer data.
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
  ), notas as (
    select n.job_chave,
           count(*) as notas,
           sum(coalesce(n.valor, 0)) as faturado,
           sum(coalesce(n.valor, 0)) filter (where n.recebimento is not null) as recebido
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
           'notas', coalesce(nt.notas, 0), 'faturado', coalesce(nt.faturado, 0), 'recebido', coalesce(nt.recebido, 0))), '[]'::jsonb)
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
