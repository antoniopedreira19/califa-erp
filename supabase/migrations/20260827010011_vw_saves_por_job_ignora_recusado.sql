-- Save: job recusado ou cancelado não oferece crédito.
--
-- `vw_saves_por_job` filtrava só por "gerou algo" (`gerado > 0`), sem olhar
-- o status do job. Consequência encontrada no teste ponta a ponta de
-- 27/08/2026: um job que a produção enviou e o financeiro REPROVOU
-- continuava aparecendo no seletor de save com saldo cheio — e o crédito
-- podia ser consumido por outro job, apontando para uma origem que não vai
-- existir. O mesmo vale para job cancelado.
--
-- O que NÃO muda: `aguardando_abertura` segue oferecendo saldo. O crédito
-- nasce do compromisso do cliente, e o ERP já trata `faturamento_previsto`
-- como compromisso desde a abertura do job (decisão 028). Encerrado também
-- segue: o saldo é do cliente e sobrevive ao encerramento da origem.
--
-- Recriada inteira porque `create or replace view` não aceita mudança de
-- lista de colunas — e aqui a lista é a mesma, mas o `create or replace`
-- de uma view com LATERAL exige o corpo completo de todo jeito.

create or replace view public.vw_saves_por_job as
select
  j.id                                                             as job_id,
  j.tenant_id,
  j.codigo                                                         as job_codigo,
  j.nome                                                           as job_nome,
  j.status                                                         as job_status,
  p.cliente_id,
  coalesce(g.gerado, 0)::numeric(14,2)                             as saldo_gerado,
  coalesce(f.consumido, 0)::numeric(14,2)                          as consumido,
  coalesce(r.reservado, 0)::numeric(14,2)                          as reservado,
  (coalesce(g.gerado, 0) - coalesce(f.consumido, 0))::numeric(14,2) as disponivel,
  coalesce(g.linhas, 0::bigint)                                    as linhas_em_save,
  v.percentual_honorarios,
  v.percentual_imposto
from public.jobs j
join public.projetos p on p.id = j.projeto_id
left join public.versoes_orcamento v on v.id = j.versao_orcamento_aprovada_id
left join lateral (
  select sum(o.total_orcado) as gerado, count(*) as linhas
    from public.jobs_itens_orcado o
   where o.job_id = j.id and o.em_save
) g on true
left join lateral (
  select sum(c.valor) as consumido
    from public.vw_saves_consumos_firmes c
   where c.job_origem_id = j.id and c.firme
) f on true
left join lateral (
  select sum(c.valor) as reservado
    from public.vw_saves_consumos_firmes c
   where c.job_origem_id = j.id and not c.firme
) r on true
where coalesce(g.gerado, 0) > 0
  -- Job que o financeiro recusou, ou que foi cancelado, não existe para o
  -- financeiro (mesma régua de `dados-abertos.ts`) e não tem crédito a dar.
  and j.status not in ('rejeitado_financeiro', 'cancelado');

alter view public.vw_saves_por_job set (security_invoker = on);
grant select on public.vw_saves_por_job to authenticated;

comment on view public.vw_saves_por_job is
  'Saldo de save por JOB de origem: gerado, consumido (firme), reservado '
  '(rascunho) e disponível. Exclui job recusado pelo financeiro e job '
  'cancelado. Ver docs/decisions/028-save-entre-jobs.md.';
