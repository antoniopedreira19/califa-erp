-- Save: só job JÁ ENVIADO para faturamento oferece crédito.
--
-- Regra do Tiago (01/09/2026): "apenas o save de um job já enviado para
-- faturamento deverá ficar disponível para poder ser consumido".
--
-- ⚠️ Isto REVERTE, de propósito, o que a `20260827010011` deixou escrito.
-- Aquela migration registrou que `aguardando_abertura` seguiria oferecendo
-- saldo, com o argumento de que "o crédito nasce do compromisso do cliente
-- e o ERP trata `faturamento_previsto` como compromisso desde a abertura
-- (decisão 028)". A régua agora é outra e mais restrita: compromisso não
-- basta — o crédito só existe depois que a nota daquele job foi pedida.
-- O motivo é o mesmo que sustenta a porta do envio (`lib/data/
-- envio-faturamento.ts`): depois do envio o valor está congelado, e é só
-- aí que o saldo para de se mexer. Antes disso, errata e save ainda podem
-- alterar o número que geraria o crédito.
--
-- `jobs_envio_faturamento` é única por job — é o mesmo teste que
-- `jobJaEnviadoParaFaturamento` faz no TypeScript, agora no lugar onde a
-- oferta é montada.
--
-- O que NÃO muda: consumo JÁ GRAVADO continua valendo. Esta view só monta
-- a lista do que se pode passar a consumir; ela não desfaz nada. No dado
-- de hoje o efeito é um só job saindo do seletor (JOB-0021, R$ 1.000,00 de
-- saldo, sem envio) — os outros três com saldo já foram enviados.
--
-- Recriada inteira: `create or replace view` exige o corpo completo, e o
-- corpo usa LATERAL.

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
  and j.status not in ('rejeitado_financeiro', 'cancelado')
  -- E o crédito só passa a ser oferecido depois do envio para faturamento.
  and exists (
    select 1
      from public.jobs_envio_faturamento ef
     where ef.job_id = j.id
       and ef.tenant_id = j.tenant_id
  );

alter view public.vw_saves_por_job set (security_invoker = on);
grant select on public.vw_saves_por_job to authenticated;

comment on view public.vw_saves_por_job is
  'Saldo de save por job, para o seletor de consumo. Só entra job que '
  'gerou save, não foi recusado nem cancelado, e JÁ FOI ENVIADO para '
  'faturamento (regra de 01/09/2026). Consumo já gravado não é afetado.';
