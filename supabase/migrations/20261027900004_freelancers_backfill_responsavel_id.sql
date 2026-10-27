-- Backfill de `freelancers.responsavel_id` a partir do contrato mais relevante
-- de cada freela. Ordem de prioridade copiada do CTE `contrato_ativo` da view
-- `freelancers_com_status`:
--   1) contrato vigente ativo (data_inicio <= hoje <= data_termino, status_real=true)
--   2) contrato futuro ativo (data_inicio > hoje, status_real=true)
--   3) resto (encerrados, data_termino passada, status_real=false)
-- Dentro do tier: data_inicio desc, depois created_at desc.
--
-- Backfill só preenche quem está NULL (preserva valor manual se já tiver sido
-- setado por algum fluxo entre a migration anterior e esta). Freelas sem
-- contrato nenhum ficam com responsavel_id NULL — RH precisa atribuir
-- manualmente (ou será coberto pela próxima migration que exige o campo em
-- fluxos novos).

begin;

with ranked as (
  select distinct on (c.freelancer_id)
    c.freelancer_id,
    c.responsavel_id
  from public.freelancer_contratos c
  where c.responsavel_id is not null
  order by c.freelancer_id,
    case
      when c.data_inicio is not null and c.data_termino is not null
           and c.data_inicio <= current_date and c.data_termino >= current_date
           and c.status_real = true then 1
      when c.data_inicio is not null and c.data_inicio > current_date
           and c.status_real = true then 2
      else 3
    end,
    c.data_inicio desc nulls last,
    c.created_at desc
)
update public.freelancers f
set responsavel_id = r.responsavel_id
from ranked r
where f.id = r.freelancer_id
  and f.responsavel_id is null;

commit;
