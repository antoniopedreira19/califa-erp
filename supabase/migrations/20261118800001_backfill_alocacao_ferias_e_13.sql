-- =====================================================================
-- Backfill de folhas_pagamento_alocacoes para folhas de férias e 13°
-- =====================================================================
--
-- POR QUE
--
-- A RPC `gerar_folha_da_competencia` v2 (migration 20261028100004) replica
-- a alocação vigente do colaborador em `folhas_pagamento_alocacoes` para
-- cada folha mensal (`tipo = 'salario'`) gerada. Quando o módulo de 13º
-- foi construído (ADRs 220-222, outubro/2026) e as folhas de férias
-- passaram a nascer como registros de `folhas_pagamento` (tipo=ferias),
-- esse passo NÃO foi replicado. Resultado: 183 folhas de
-- `decimo_terceiro_1a_parcela` + 3 folhas de `ferias` existiam sem
-- rateio regional.
--
-- O impacto não é só a coluna Alocação vazia na aba People do financeiro.
-- Toda consulta que faz DRE por regional, fluxo de caixa por regional
-- ou relatório de rentabilidade regional lê de `folhas_pagamento_alocacoes`
-- e perde o custo de 13º e férias nos meses em que caem — distorce a
-- margem regional de nov/dez.
--
-- O QUE
--
-- Inserir N linhas em `folhas_pagamento_alocacoes` para cada folha sem
-- alocação, usando a MESMA lógica de explosão da RPC v2:
--
--   - Busca pacote de alocação vigente (colaboradores_alocacoes.data_fim
--     IS NULL).
--   - Se o pacote tem itens em colaboradores_alocacoes_itens (modelo
--     multi-empresa): expande por itens × (rateio padrão da empresa no
--     ano | regionais explícitas do item).
--   - Se o pacote é legado (empresa_id/regional_id na linha mãe):
--     expande por rateio padrão ou gera linha única 100%.
--
-- DRY RUN confirmou (18/11/2026):
--   - 186 folhas-alvo
--   - 186 vão expandir com sucesso (0 bloqueadas)
--   - 186 linhas resultantes (todos 1:1 — 1 empresa + 1 regional 100%)
--   - 186 folhas com soma = 100 EXATA (nenhuma precisa correção de rounding)
--
-- NOTAS
--
-- 1. "Alocação atual": usa a vigente no momento do backfill, não a vigente
--    na data de fechamento da parcela. Decisão do Daniel/Antonio em
--    18/11/2026 (nenhum colaborador mudou de regional em 2026, então os
--    dois critérios dão o mesmo resultado hoje).
-- 2. Idempotente: filtra `fpa.id IS NULL`, então re-rodar não duplica.
-- 3. O trigger `trg_folha_alocacao_soma_100` é DEFERRABLE INITIALLY
--    DEFERRED — todos os INSERTs dentro desta migration só são validados
--    no COMMIT, e como cada folha soma 100 exato, passa.
-- 4. Esta migration apenas CORRIGE o dado. A geração futura (actions do
--    RH que criam folhas de 13º e férias) continua sem replicar o rateio;
--    isso vira commit separado.
-- 5. A view `vw_people_aprovar_financeiro` ainda tem o guard
--    `escopo_tipo = 'folha_mensal'` no subquery de `alocacao_resumo`,
--    mantido por enquanto (a aba People consome `folhas_pagamento_alocacoes`
--    direto, não usa a coluna da view).
-- =====================================================================

-- Backfill: INSERT set-based usando a lógica da RPC v2.
WITH folhas_alvo AS (
  SELECT fp.id AS folha_id,
         fp.tenant_id,
         fp.colaborador_id,
         fp.competencia_ano
  FROM folhas_pagamento fp
  LEFT JOIN folhas_pagamento_alocacoes fpa ON fpa.folha_id = fp.id
  WHERE fpa.id IS NULL
    AND fp.tipo IN ('ferias', 'decimo_terceiro_1a_parcela')
),
pacote AS (
  SELECT fa.*,
         ca.id AS alocacao_id,
         ca.empresa_id AS leg_empresa_id,
         ca.regional_id AS leg_regional_id,
         ca.usa_rateio_empresa AS leg_usa_rateio,
         (SELECT count(*) FROM colaboradores_alocacoes_itens i
           WHERE i.alocacao_id = ca.id) AS n_itens
  FROM folhas_alvo fa
  LEFT JOIN colaboradores_alocacoes ca
    ON ca.tenant_id      = fa.tenant_id
   AND ca.colaborador_id = fa.colaborador_id
   AND ca.data_fim IS NULL
),
-- Modelo multi-empresa: expande por itens × regionais
multi AS (
  SELECT p.tenant_id, p.folha_id, i.empresa_id,
         CASE WHEN i.usa_rateio_empresa THEN er.regional_id
              ELSE r2.regional_id END AS regional_id,
         ROUND(
           i.percentual_empresa *
           CASE WHEN i.usa_rateio_empresa THEN er.percentual
                ELSE r2.percentual_regional END
           / 100.0, 2
         ) AS percentual
  FROM pacote p
  JOIN colaboradores_alocacoes_itens i ON i.alocacao_id = p.alocacao_id
  LEFT JOIN empresas_rateios_regionais er
    ON er.tenant_id = p.tenant_id
   AND er.empresa_id = i.empresa_id
   AND er.ano_vigencia = p.competencia_ano
   AND er.percentual > 0
   AND i.usa_rateio_empresa
  LEFT JOIN colaboradores_alocacoes_itens_regionais r2
    ON r2.alocacao_item_id = i.id
   AND NOT i.usa_rateio_empresa
  WHERE p.n_itens > 0
    AND (
      (i.usa_rateio_empresa AND er.regional_id IS NOT NULL)
      OR
      (NOT i.usa_rateio_empresa AND r2.regional_id IS NOT NULL)
    )
),
-- Modelo legado: empresa_id/regional_id direto na linha mãe
leg AS (
  SELECT p.tenant_id, p.folha_id, p.leg_empresa_id AS empresa_id,
         CASE WHEN p.leg_usa_rateio THEN er.regional_id
              ELSE p.leg_regional_id END AS regional_id,
         CASE WHEN p.leg_usa_rateio THEN er.percentual
              ELSE 100 END AS percentual
  FROM pacote p
  LEFT JOIN empresas_rateios_regionais er
    ON er.tenant_id = p.tenant_id
   AND er.empresa_id = p.leg_empresa_id
   AND er.ano_vigencia = p.competencia_ano
   AND er.percentual > 0
   AND p.leg_usa_rateio
  WHERE p.n_itens = 0
    AND p.leg_empresa_id IS NOT NULL
    AND (
      (p.leg_usa_rateio AND er.regional_id IS NOT NULL)
      OR
      (NOT p.leg_usa_rateio AND p.leg_regional_id IS NOT NULL)
    )
)
INSERT INTO folhas_pagamento_alocacoes
  (tenant_id, folha_id, empresa_id, regional_id, percentual)
SELECT tenant_id, folha_id, empresa_id, regional_id, percentual FROM multi
UNION ALL
SELECT tenant_id, folha_id, empresa_id, regional_id, percentual FROM leg;

-- Verificação pós-backfill: nenhuma folha de férias ou 13° pode ficar
-- sem alocação ou com soma ≠ 100.
DO $$
DECLARE
  v_sem_aloc int;
  v_soma_errada int;
  v_total_linhas int;
  v_folhas_cobertas int;
BEGIN
  -- Folhas de férias/13° que ainda não têm alocação (precisa ser 0)
  SELECT count(*) INTO v_sem_aloc
  FROM folhas_pagamento fp
  LEFT JOIN folhas_pagamento_alocacoes fpa ON fpa.folha_id = fp.id
  WHERE fp.tipo IN ('ferias', 'decimo_terceiro_1a_parcela')
    AND fpa.id IS NULL;

  -- Folhas de férias/13° com soma de % ≠ 100 (precisa ser 0)
  SELECT count(*) INTO v_soma_errada
  FROM (
    SELECT fp.id, sum(fpa.percentual) AS soma
    FROM folhas_pagamento fp
    JOIN folhas_pagamento_alocacoes fpa ON fpa.folha_id = fp.id
    WHERE fp.tipo IN ('ferias', 'decimo_terceiro_1a_parcela')
    GROUP BY fp.id
    HAVING round(sum(fpa.percentual), 2) <> 100.00
  ) s;

  -- Métricas totais
  SELECT count(*), count(DISTINCT fpa.folha_id)
    INTO v_total_linhas, v_folhas_cobertas
  FROM folhas_pagamento fp
  JOIN folhas_pagamento_alocacoes fpa ON fpa.folha_id = fp.id
  WHERE fp.tipo IN ('ferias', 'decimo_terceiro_1a_parcela');

  RAISE NOTICE '[backfill_alocacao_ferias_e_13] % folhas cobertas, % linhas totais',
    v_folhas_cobertas, v_total_linhas;

  IF v_sem_aloc > 0 THEN
    RAISE EXCEPTION 'Backfill falhou: % folhas de férias/13° ficaram sem alocação', v_sem_aloc;
  END IF;

  IF v_soma_errada > 0 THEN
    RAISE EXCEPTION 'Backfill falhou: % folhas de férias/13° com soma de %% ≠ 100', v_soma_errada;
  END IF;
END $$;
