-- Decisão 137 (01/10/2026): cancela a remessa de teste PE000029 e faz a
-- remessa cancelada deixar de travar o título.
--
-- 1. A PE000029 foi gerada para conferir o arquivo da PP fora do cadastro
--    (PP-00102) e não vai ao banco. O Tiago autorizou cancelar ("Pode
--    cancelar"), como a PE000023 em 30/09. Ela é identificada pelo hash do
--    arquivo, para não depender de id gerado.
-- 2. `_documento_em_remessa` (usada por `baixar_parcela_pp` e
--    `baixar_conta_avulsa`) olhava só se o título tinha item em alguma
--    remessa, sem ver o status dela. Com isso, o título de uma remessa
--    cancelada continuava só aceitando a baixa do valor cheio, sem
--    retenção. A devolução da folha já ignorava a cancelada; agora a baixa
--    também.
--
-- Mudança de status de UM registro (autorizada) e troca do corpo de uma
-- função, sem mudar assinatura nem grants.

create or replace function public._documento_em_remessa(p_documento_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.cnab_remessas_itens i
      join public.cnab_remessas r on r.id = i.remessa_id
     where i.origem_id = p_documento_id
       and r.status <> 'cancelado'
  );
$function$;

with cancelada as (
  update public.cnab_remessas
     set status = 'cancelado',
         observacoes = 'Arquivo de teste da decisão 137 (PP-00102, chave fora do cadastro), conferido e não transmitido. Cancelado com autorização do Tiago em 01/10/2026.'
   where hash_arquivo = 'c0729416c8a2b3696b85858de7508db9ab3900d0c57881c6601362be094bf5d8'
     and sequencial_arquivo = 29
     and status = 'gerado'
  returning id, tenant_id, gerado_por, sequencial_arquivo
)
insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
select c.tenant_id, c.gerado_por, 'cnab.remessa_cancelada', 'cnab_remessa', c.id::text,
       jsonb_build_object(
         'sequencial', c.sequencial_arquivo,
         'motivo', 'Arquivo de teste da decisão 137 (PP-00102), conferido e não transmitido ao banco.',
         'origem', 'migration 20261001400005'
       )
  from cancelada c;
