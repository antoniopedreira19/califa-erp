-- Adiciona Antonio Pedreira (profile ba2e2ba1-...) como segundo lider
-- dos 6 colaboradores com solicitacao de ferias em `aguardando_gestor`.
--
-- Contexto: pedido operacional em 21/11/2026 noite pro Antonio conseguir
-- aprovar as pendencias que ja estao na fila do fluxo lider->RH. Como
-- agora o modelo e N:N (migration 20261122100001), inserimos uma linha
-- extra por colaborador sem tocar no lider original.
--
-- Trigger de sync (`trg_sync_colaborador_lider_cache`) vai manter o
-- `colaboradores.lider_id` cache apontando pro lider ORIGINAL — Antonio
-- entra com created_at NOW(), posterior ao do backfill.
--
-- IDs especificados em vez de WHERE status='aguardando_gestor' solto
-- pra garantir atomicidade (nova solicitacao que entre entre leitura e
-- UPDATE nao e afetada).
BEGIN;

INSERT INTO public.colaboradores_lideres (colaborador_id, lider_id)
SELECT c.id, 'ba2e2ba1-1ba0-4e3d-99de-5d9d89877381'::uuid
  FROM public.colaboradores c
 WHERE c.id IN (
   '4147af36-c0d6-42be-b8d0-eac26daa452d',
   '489f3415-674e-4a35-a8cc-7d6c62f8c03e',
   '4c771873-911f-4369-a6fd-d32cfb068f79',
   '9546a783-e82a-4c18-805c-2b8d92bf80d4',
   '979c372b-c322-4f8e-a198-faa2bdcdabd6',
   '9af4e31b-c7db-4627-a07e-4dc1f83310c3'
 )
ON CONFLICT (colaborador_id, lider_id) DO NOTHING;

-- Trava: Antonio tem que estar como lider dos 6 depois do INSERT.
DO $$
DECLARE
  esperado INT := 6;
  atualizado INT;
BEGIN
  SELECT COUNT(*) INTO atualizado
    FROM public.colaboradores_lideres cl
   WHERE cl.lider_id = 'ba2e2ba1-1ba0-4e3d-99de-5d9d89877381'::uuid
     AND cl.colaborador_id IN (
       '4147af36-c0d6-42be-b8d0-eac26daa452d',
       '489f3415-674e-4a35-a8cc-7d6c62f8c03e',
       '4c771873-911f-4369-a6fd-d32cfb068f79',
       '9546a783-e82a-4c18-805c-2b8d92bf80d4',
       '979c372b-c322-4f8e-a198-faa2bdcdabd6',
       '9af4e31b-c7db-4627-a07e-4dc1f83310c3'
     );

  IF atualizado <> esperado THEN
    RAISE EXCEPTION 'Backfill divergente: esperado 6 vinculos pro Antonio, encontrado %.', atualizado;
  END IF;
END$$;

COMMIT;
