-- Reverte a inativacao de 8 colaboradores aplicada por engano na Lista 1 (01/11/2026).
--
-- Contexto: a Lista 1 foi montada a partir da aba "Dados dos ursos" do arquivo
-- 4novos.xlsx, versao DESATUALIZADA da planilha mestre. A planilha correta e
-- ColaboradoresAtualizados.xlsx, onde cada colaborador com historico aparece em
-- 2 linhas: contrato antigo encerrado (CLT/Estagio/Recibo) e contrato PJ vigente.
-- O script da inativacao pegou a linha antiga, inativando 8 pessoas que estao
-- de fato ativas na California/CCH. Os outros 15 da Lista 1 foram inativados
-- corretamente (bate com a planilha atualizada) e NAO entram nesta reversao.
--
-- O que reverter para cada um dos 8 (UUIDs listados abaixo):
--   1. colaboradores.status -> 'ativo', data_encerramento -> NULL
--   2. colaboradores_alocacoes.data_fim -> NULL (todas as alocacoes fechadas)
--   3. colaboradores_salarios.data_fim -> NULL (todos os salarios fechados)
--   4. colaborador_beneficio.data_fim -> NULL (todos os beneficios fechados)

BEGIN;

WITH ids AS (
  SELECT unnest(ARRAY[
    'bff3f3a7-7713-432f-b81e-f6f21bee79e4'::uuid,
    '2fb560a9-8a9a-433f-acc3-e946fc18db85'::uuid,
    '82d74bbb-bb42-4f6f-8f37-af9b2bd0bb02'::uuid,
    '893f6600-773f-4f37-8c55-10a274415a1d'::uuid,
    '7e759263-9821-45df-ad8b-fbede4eb4c4e'::uuid,
    '8d8a29ff-b251-4352-9dcf-2f32c89d82dc'::uuid,
    '6ca2d4cd-11ca-4d1e-aa60-4af180515b2c'::uuid,
    'cc6309d5-11e2-4559-a0d2-f15ff63e28b4'::uuid
  ]) AS colab_id
)
UPDATE colaboradores c
SET status = 'ativo',
    data_encerramento = NULL,
    updated_at = now()
FROM ids
WHERE c.id = ids.colab_id;

UPDATE colaboradores_alocacoes
SET data_fim = NULL
WHERE colaborador_id IN (
  'bff3f3a7-7713-432f-b81e-f6f21bee79e4',
  '2fb560a9-8a9a-433f-acc3-e946fc18db85',
  '82d74bbb-bb42-4f6f-8f37-af9b2bd0bb02',
  '893f6600-773f-4f37-8c55-10a274415a1d',
  '7e759263-9821-45df-ad8b-fbede4eb4c4e',
  '8d8a29ff-b251-4352-9dcf-2f32c89d82dc',
  '6ca2d4cd-11ca-4d1e-aa60-4af180515b2c',
  'cc6309d5-11e2-4559-a0d2-f15ff63e28b4'
)
AND data_fim IS NOT NULL;

UPDATE colaboradores_salarios
SET data_fim = NULL
WHERE colaborador_id IN (
  'bff3f3a7-7713-432f-b81e-f6f21bee79e4',
  '2fb560a9-8a9a-433f-acc3-e946fc18db85',
  '82d74bbb-bb42-4f6f-8f37-af9b2bd0bb02',
  '893f6600-773f-4f37-8c55-10a274415a1d',
  '7e759263-9821-45df-ad8b-fbede4eb4c4e',
  '8d8a29ff-b251-4352-9dcf-2f32c89d82dc',
  '6ca2d4cd-11ca-4d1e-aa60-4af180515b2c',
  'cc6309d5-11e2-4559-a0d2-f15ff63e28b4'
)
AND data_fim IS NOT NULL;

UPDATE colaborador_beneficio
SET data_fim = NULL
WHERE colaborador_id IN (
  'bff3f3a7-7713-432f-b81e-f6f21bee79e4',
  '2fb560a9-8a9a-433f-acc3-e946fc18db85',
  '82d74bbb-bb42-4f6f-8f37-af9b2bd0bb02',
  '893f6600-773f-4f37-8c55-10a274415a1d',
  '7e759263-9821-45df-ad8b-fbede4eb4c4e',
  '8d8a29ff-b251-4352-9dcf-2f32c89d82dc',
  '6ca2d4cd-11ca-4d1e-aa60-4af180515b2c',
  'cc6309d5-11e2-4559-a0d2-f15ff63e28b4'
)
AND data_fim IS NOT NULL;

COMMIT;
