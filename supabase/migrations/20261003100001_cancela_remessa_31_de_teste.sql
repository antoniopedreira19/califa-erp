-- 03/10/2026: cancela a remessa CNAB PE000031, gerada em 02/10/2026 às 17:04
-- só com as 4 PPs de teste do TES (PP-00079, PP-00102, PP-00110 e PP-00111,
-- todas do FORNECEDOR TESTE LTDA; R$ 15.300,00) na conta California
-- Santander. Não vai ao banco: transmitida, ela tentaria pagar o fornecedor
-- de teste. Enquanto não cancelada, ela também trava a baixa dessas PPs e
-- tira delas a retenção da aprovação (`_documento_em_remessa`).
--
-- O Tiago autorizou cancelar ("Cancelar a remessa") em 03/10/2026, como a
-- PE000023 (30/09) e a PE000029 (01/10, migration 20261001400005). A tela
-- não tem cancelamento de remessa; é o mesmo padrão: mudança de status de UM
-- registro, identificado pelo hash do arquivo e pelo sequencial (sem depender
-- de id gerado), com o evento na auditoria.

with cancelada as (
  update public.cnab_remessas
     set status = 'cancelado',
         observacoes = 'Remessa gerada só com as PPs de teste do TES (PP-00079, PP-00102, PP-00110, PP-00111), não transmitida. Cancelada com autorização do Tiago em 03/10/2026.'
   where hash_arquivo = 'e0d5e7598e21b3774a324c8fcb7522b48fe9a780d2883f787183880b4dfd3f16'
     and sequencial_arquivo = 31
     and status = 'gerado'
  returning id, tenant_id, gerado_por, sequencial_arquivo
)
insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
select c.tenant_id, c.gerado_por, 'cnab.remessa_cancelada', 'cnab_remessa', c.id::text,
       jsonb_build_object(
         'sequencial', c.sequencial_arquivo,
         'motivo', 'Remessa só com as PPs de teste do TES, não transmitida ao banco.',
         'origem', 'migration 20261003100001'
       )
  from cancelada c;
