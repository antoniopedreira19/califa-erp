-- =====================================================================
-- Backfill: pacotes atuais em colaboradores_alocacoes_itens + regionais
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Task 1 criou a hierarquia nova:
--   • colaboradores_alocacoes_itens (fatia por empresa)
--   • colaboradores_alocacoes_itens_regionais (divisão regional, se aplicável)
--
-- Esta migration backfilla TODOS os pacotes legados (vigentes e históricos)
-- que têm empresa_id IS NOT NULL, preservando o histórico completo da
-- alocação para fins operacionais (folha, geração de custo, auditoria).
--
-- Lógica:
--   1. Pra cada linha em colaboradores_alocacoes com empresa_id IS NOT NULL:
--      → INSERT em _itens com empresa_id e percentual_empresa = 100,
--        usa_rateio_empresa = valor legado da linha mãe.
--
--   2. Se usa_rateio_empresa = false E regional_id IS NOT NULL:
--      → INSERT em _itens_regionais com regional_id e percentual_regional = 100.
--
--   3. Se usa_rateio_empresa = true OU regional_id IS NULL:
--      → Nenhuma linha em _itens_regionais (a folha expande via
--        empresas_rateios_regionais ou não divide por regional).
--
-- Pré-aplicação (2026-10-28 18:00 UTC):
--   • 214 linhas com empresa_id IS NOT NULL
--   • 188 com regional_id IS NOT NULL + usa_rateio_empresa = false
--   • 26 com usa_rateio_empresa = true
--   • 0 em estado inválido (regional_id null + usa_rateio_empresa false)
--
-- Esperado pós-aplicação:
--   • colaboradores_alocacoes_itens: 214 linhas (1 item por pacote)
--   • colaboradores_alocacoes_itens_regionais: 188 linhas (1 regional por item)
--   • Invariante: sum(percentual_empresa) = 100 por alocacao_id
--   • Invariante: sum(percentual_regional) = 100 por alocacao_item_id
--     (quando usa_rateio_empresa = false)
--
-- =====================================================================

BEGIN;

-- Inserir itens: 1 linha por pacote legado com empresa_id IS NOT NULL
WITH itens_inseridos AS (
  INSERT INTO public.colaboradores_alocacoes_itens (
    id,
    tenant_id,
    alocacao_id,
    empresa_id,
    percentual_empresa,
    usa_rateio_empresa,
    created_at
  )
  SELECT
    gen_random_uuid(),
    ca.tenant_id,
    ca.id,
    ca.empresa_id,
    100.00,
    ca.usa_rateio_empresa,
    now()
  FROM public.colaboradores_alocacoes ca
  WHERE ca.empresa_id IS NOT NULL
  RETURNING id, alocacao_id, usa_rateio_empresa, empresa_id
)
-- Inserir regionais: quando usa_rateio_empresa = false E regional_id IS NOT NULL
INSERT INTO public.colaboradores_alocacoes_itens_regionais (
  id,
  tenant_id,
  alocacao_item_id,
  regional_id,
  percentual_regional,
  created_at
)
SELECT
  gen_random_uuid(),
  ca.tenant_id,
  ii.id,
  ca.regional_id,
  100.00,
  now()
FROM public.colaboradores_alocacoes ca
INNER JOIN itens_inseridos ii ON ii.alocacao_id = ca.id
WHERE ca.regional_id IS NOT NULL
  AND ca.usa_rateio_empresa = false;

COMMIT;
