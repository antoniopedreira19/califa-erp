-- Expõe `valor`, `tipo`, `data_inicio` e `data_termino` do contrato mais recente
-- na view `freelancers_lookup`, pra que o modal "Buscar freelancer" mostre
-- quanto e em qual período o freelancer foi/está contratado antes de outro GP
-- iniciar uma nova contratação (comparativo pedido pelo Daniel em 25/11/2026).
--
-- Decisão: o comentário original da view (20261020000002) marcava valor como
-- "não expor". Essa trava tinha sentido antes de existir fluxo de solicitação
-- entre GPs — agora, GP/produtor precisa ver o preço praticado pelo colega pra
-- não desalinhar o cachê do mesmo freela entre contratos sobrepostos. A view
-- continua escondendo PII (CPF, RG, email, celular, endereço, dados bancários,
-- cartão CNPJ, dados de saúde). Só `valor` + período (do contrato ativo mais
-- recente) entram na lista.
--
-- Fonte dos campos: a mesma lateral join que alimentava `cargo_contrato` /
-- `nome_job`. Sem contrato nenhum (`c.id is null`), todos vêm NULL. Pro freela
-- com só contrato encerrado, aparece o último (pra servir de referência
-- histórica de cachê).

begin;

drop view if exists public.freelancers_lookup;

create view public.freelancers_lookup
with (security_invoker = false) as
select
  f.id,
  f.tenant_id,
  f.nome_social,
  f.nome_completo,
  c.cargo as cargo_contrato,
  c.nome_job,
  c.responsavel_id,
  p.nome as responsavel_nome,
  c.valor as valor_contrato,
  c.tipo as tipo_contrato,
  c.data_inicio as data_inicio_contrato,
  c.data_termino as data_termino_contrato,
  case
    when c.id is null then 'sem_contrato'
    when c.status_real = true
         and c.data_inicio is not null
         and c.data_inicio <= current_date
         and (c.data_termino is null or c.data_termino >= current_date)
      then 'ativo'
    else 'inativo'
  end as status_vinculo
from public.freelancers f
left join lateral (
  select
    co.id, co.cargo, co.nome_job, co.responsavel_id,
    co.valor, co.tipo, co.status_real, co.data_inicio, co.data_termino,
    co.created_at
  from public.freelancer_contratos co
  where co.freelancer_id = f.id
    and co.tenant_id = f.tenant_id
  order by
    case when co.status_real then 0 else 1 end,
    co.data_inicio desc nulls last,
    co.created_at desc
  limit 1
) c on true
left join public.profiles p on p.id = c.responsavel_id;

revoke all on public.freelancers_lookup from anon;
revoke all on public.freelancers_lookup from authenticated;
grant select on public.freelancers_lookup to authenticated;

commit;
