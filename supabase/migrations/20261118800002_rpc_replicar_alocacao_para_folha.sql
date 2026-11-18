-- =====================================================================
-- RPC replicar_alocacao_para_folha: replica o pacote vigente para UMA
-- folha específica
-- =====================================================================
--
-- POR QUE
--
-- A RPC `gerar_folha_da_competencia` v2 (20261028100004) replica a
-- alocação do colaborador para `folhas_pagamento_alocacoes` **apenas**
-- durante a geração da folha mensal (tipo=salario). O resto dos fluxos
-- que inserem em `folhas_pagamento` — 13º (parcelas + adiantamento) e
-- férias — NÃO replicavam, deixando essas folhas sem snapshot de rateio.
--
-- Esta função extrai a lógica de expansão para que qualquer caller
-- (actions do RH, migration de backfill, trigger futura) possa replicar
-- a alocação atual do colaborador para uma folha existente.
--
-- O QUE
--
-- - Parâmetro: `p_folha_id` da folha já inserida em `folhas_pagamento`.
-- - Lê tenant_id, colaborador_id e competencia_ano da folha.
-- - Idempotente: se já há linhas em `folhas_pagamento_alocacoes` com esse
--   folha_id, não faz nada e retorna 0.
-- - Se o colaborador não tem pacote vigente: retorna 0 (não lança erro;
--   quem chama decide se é fatal).
-- - Expansão idêntica à RPC v2: itens do pacote × (rateio padrão da
--   empresa | regionais explícitas), com fallback para modelo legado.
-- - Correção de rounding: ajusta a ÚLTIMA linha para fechar em 100.
--
-- Retorna: int com o número de linhas inseridas.
--
-- USO ESPERADO
--
-- Chamada após `INSERT INTO folhas_pagamento ... RETURNING id`:
--   SELECT replicar_alocacao_para_folha(<id_da_folha>);
--
-- Nos clientes JS: `await supabase.rpc('replicar_alocacao_para_folha',
-- { p_folha_id: id })`.
--
-- RLS: a função roda no contexto do usuário. As policies de INSERT em
-- `folhas_pagamento_alocacoes` autorizam admin/rh/financeiro — os três
-- callers (fechar parcela 13º, lançar adiantamento, criar férias) são
-- RH. A função NÃO é SECURITY DEFINER.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.replicar_alocacao_para_folha(
  p_folha_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_id    uuid;
  v_colab_id     uuid;
  v_ano          integer;
  v_pacote_id    uuid;
  v_item_count   integer;

  v_item         record;
  v_reg          record;

  v_leg_empresa_id   uuid;
  v_leg_regional_id  uuid;
  v_leg_usa_rateio   boolean;

  v_linhas_ids   uuid[] := '{}';
  v_soma_pct     numeric := 0;
  v_pct_final    numeric;
  v_diff         numeric;
  v_ultimo_id    uuid;

  v_tem_problema boolean := false;
BEGIN
  -- Lê metadados da folha
  SELECT fp.tenant_id, fp.colaborador_id, fp.competencia_ano
    INTO v_tenant_id, v_colab_id, v_ano
    FROM folhas_pagamento fp
   WHERE fp.id = p_folha_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'replicar_alocacao_para_folha: folha % não encontrada', p_folha_id;
  END IF;

  -- Idempotência: já tem alocação, sai
  IF EXISTS (SELECT 1 FROM folhas_pagamento_alocacoes
              WHERE folha_id = p_folha_id) THEN
    RETURN 0;
  END IF;

  -- Pacote vigente do colaborador
  SELECT a.id INTO v_pacote_id
    FROM colaboradores_alocacoes a
   WHERE a.colaborador_id = v_colab_id
     AND a.tenant_id      = v_tenant_id
     AND a.data_fim IS NULL;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Conta itens multi-empresa
  SELECT count(*) INTO v_item_count
    FROM colaboradores_alocacoes_itens
   WHERE alocacao_id = v_pacote_id
     AND tenant_id   = v_tenant_id;

  -- ----------------------------------------------------------------
  -- Caminho legado (sem itens): empresa_id/regional_id na linha mãe
  -- ----------------------------------------------------------------
  IF v_item_count = 0 THEN
    SELECT a.empresa_id, a.regional_id, a.usa_rateio_empresa
      INTO v_leg_empresa_id, v_leg_regional_id, v_leg_usa_rateio
      FROM colaboradores_alocacoes a
     WHERE a.id = v_pacote_id;

    IF v_leg_empresa_id IS NULL THEN
      RETURN 0;
    END IF;

    IF v_leg_usa_rateio IS TRUE THEN
      INSERT INTO folhas_pagamento_alocacoes
            (tenant_id, folha_id, empresa_id, regional_id, percentual)
      SELECT v_tenant_id, p_folha_id, v_leg_empresa_id, er.regional_id, er.percentual
        FROM empresas_rateios_regionais er
       WHERE er.tenant_id    = v_tenant_id
         AND er.empresa_id   = v_leg_empresa_id
         AND er.ano_vigencia = v_ano
         AND er.percentual   > 0;
    ELSE
      IF v_leg_regional_id IS NULL THEN
        RETURN 0;
      END IF;
      INSERT INTO folhas_pagamento_alocacoes
            (tenant_id, folha_id, empresa_id, regional_id, percentual)
      VALUES (v_tenant_id, p_folha_id, v_leg_empresa_id, v_leg_regional_id, 100);
    END IF;

    RETURN (SELECT count(*)::int FROM folhas_pagamento_alocacoes WHERE folha_id = p_folha_id);
  END IF;

  -- ----------------------------------------------------------------
  -- Modelo multi-empresa: expande itens × regionais
  -- ----------------------------------------------------------------
  FOR v_item IN
    SELECT i.id, i.empresa_id, i.percentual_empresa, i.usa_rateio_empresa
      FROM colaboradores_alocacoes_itens i
     WHERE i.alocacao_id = v_pacote_id
       AND i.tenant_id   = v_tenant_id
     ORDER BY i.created_at
  LOOP
    IF v_item.usa_rateio_empresa THEN
      FOR v_reg IN
        SELECT er.regional_id, er.percentual
          FROM empresas_rateios_regionais er
         WHERE er.tenant_id    = v_tenant_id
           AND er.empresa_id   = v_item.empresa_id
           AND er.ano_vigencia = v_ano
           AND er.percentual   > 0
         ORDER BY er.regional_id
      LOOP
        v_pct_final := ROUND(
          v_item.percentual_empresa * v_reg.percentual / 100.0, 2
        );
        INSERT INTO folhas_pagamento_alocacoes
              (tenant_id, folha_id, empresa_id, regional_id, percentual)
        VALUES (v_tenant_id, p_folha_id, v_item.empresa_id, v_reg.regional_id, v_pct_final)
        RETURNING id INTO v_ultimo_id;

        v_linhas_ids := v_linhas_ids || v_ultimo_id;
        v_soma_pct   := v_soma_pct + v_pct_final;
      END LOOP;
    ELSE
      FOR v_reg IN
        SELECT r2.regional_id, r2.percentual_regional AS percentual
          FROM colaboradores_alocacoes_itens_regionais r2
         WHERE r2.alocacao_item_id = v_item.id
           AND r2.tenant_id        = v_tenant_id
         ORDER BY r2.regional_id
      LOOP
        v_pct_final := ROUND(
          v_item.percentual_empresa * v_reg.percentual / 100.0, 2
        );
        INSERT INTO folhas_pagamento_alocacoes
              (tenant_id, folha_id, empresa_id, regional_id, percentual)
        VALUES (v_tenant_id, p_folha_id, v_item.empresa_id, v_reg.regional_id, v_pct_final)
        RETURNING id INTO v_ultimo_id;

        v_linhas_ids := v_linhas_ids || v_ultimo_id;
        v_soma_pct   := v_soma_pct + v_pct_final;
      END LOOP;
    END IF;
  END LOOP;

  -- Correção de rounding: ajusta última linha para fechar em 100
  IF cardinality(v_linhas_ids) > 0 THEN
    v_diff := 100.00 - v_soma_pct;
    v_ultimo_id := v_linhas_ids[cardinality(v_linhas_ids)];
    IF abs(v_diff) >= 0.01 THEN
      UPDATE folhas_pagamento_alocacoes
         SET percentual = percentual + v_diff
       WHERE id = v_ultimo_id;
    END IF;
  END IF;

  RETURN cardinality(v_linhas_ids);
END;
$$;

COMMENT ON FUNCTION public.replicar_alocacao_para_folha(uuid) IS
  'Replica a alocação vigente do colaborador para folhas_pagamento_alocacoes '
  'de uma folha já criada. Idempotente. Retorna número de linhas inseridas. '
  'Usado pelas actions de 13º (fechar parcela/adiantamento) e férias.';

GRANT EXECUTE ON FUNCTION public.replicar_alocacao_para_folha(uuid) TO authenticated;
