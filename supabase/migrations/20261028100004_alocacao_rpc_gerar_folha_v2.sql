-- =====================================================================
-- gerar_folha_da_competencia v2: explode pacote multi-empresa
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- A v1 da RPC lia colaboradores_alocacoes.empresa_id e regional_id
-- (modelo de 1 empresa por colaborador). Com o novo modelo hierárquico
-- (Task 7 de 2026-10-28) um colaborador tem N itens em
-- colaboradores_alocacoes_itens, cada item com M regionais em
-- colaboradores_alocacoes_itens_regionais (ou uso do rateio padrão da
-- empresa via empresas_rateios_regionais).
--
-- FORMULA DE EXPLOSÃO (spec task-7-brief.md):
--   Para cada item (empresa) do pacote:
--     Se usa_rateio_empresa = true:
--       Para cada linha de empresas_rateios_regionais (empresa, ano):
--         percentual_final = round(item.percentual_empresa × rateio.percentual / 100, 2)
--     Se usa_rateio_empresa = false:
--       Para cada linha de colaboradores_alocacoes_itens_regionais do item:
--         percentual_final = round(item.percentual_empresa × regional.percentual_regional / 100, 2)
--   Correção de rounding na ÚLTIMA linha inserida para cada folha:
--     diff = 100 - sum(percentual_final); última_linha.percentual += diff
--
-- INVARIANTES MANTIDAS:
--   - Mesma signature e return type (jsonb) da v1.
--   - Só gera folhas tipo='salario'; folhas de FÉRIAS não são afetadas.
--   - Colaboradores já com folha origem='california' no período são ignorados.
--   - Status = 'rascunho', origem = 'california'.
--   - Fallback para modelo legado (empresa_id/regional_id na linha mãe) quando
--     o pacote ainda não passou pelo backfill da Task 2.
--
-- TRIGGER folhas_pagamento_alocacoes.trg_folha_alocacao_soma_100:
--   DEFERRABLE INITIALLY DEFERRED — dispara no COMMIT, não por INSERT.
--   Os INSERTs parciais dentro do loop não violam o trigger.
--
-- =====================================================================

CREATE OR REPLACE FUNCTION public.gerar_folha_da_competencia(
  p_tenant_id  uuid,
  p_ano        integer,
  p_mes        integer
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_primeiro         date    := make_date(p_ano, p_mes, 1);
  v_ultimo           date    := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_criado_por       uuid    := (SELECT auth.uid());
  v_candidatos       integer;
  v_criadas          integer := 0;
  v_sem_sal          text[]  := '{}';
  v_sem_aloc         text[]  := '{}';
  v_sem_rat          text[]  := '{}';
  v_folha_id         uuid;

  -- Loop principal
  r                  record;

  -- Pacote vigente do candidato
  v_pacote_id        uuid;
  v_item_count       integer;

  -- Loop de itens do pacote
  v_item             record;

  -- Loop de regionais de cada item
  v_reg              record;
  v_reg_count        integer;

  -- Acumuladores para correção de rounding por folha
  v_linhas_ids       uuid[]    := '{}';
  v_soma_pct         numeric   := 0;
  v_pct_final        numeric;
  v_diff             numeric;
  v_ultimo_id        uuid;

  -- Flags de validação por colaborador
  v_tem_problema        boolean;
  v_bloqueado_sem_rat   boolean;

  -- Variáveis para fallback legado (pacote sem itens)
  v_leg_empresa_id   uuid;
  v_leg_regional_id  uuid;
  v_leg_usa_rateio   boolean;
BEGIN
  -- ----------------------------------------------------------------
  -- Passo 1: conta candidatos elegíveis (mesma lógica da v1)
  -- ----------------------------------------------------------------
  SELECT COUNT(*) INTO v_candidatos
    FROM colaboradores c
   WHERE c.tenant_id          = p_tenant_id
     AND c.tipo_contratacao  IN ('pj', 'mei', 'clt_recibo')
     AND c.data_admissao     <= v_ultimo
     AND (c.status = 'ativo' OR c.data_encerramento >= v_primeiro);

  -- ----------------------------------------------------------------
  -- Passo 2: loop nos candidatos sem folha california nesta competência
  -- ----------------------------------------------------------------
  FOR r IN
    SELECT c.id,
           c.nome,
           s.colaborador_id IS NOT NULL                              AS tem_salario,
           CASE WHEN c.tipo_contratacao = 'clt_recibo'
                THEN s.valor_recibo
                ELSE s.valor
           END                                                       AS salario
      FROM colaboradores c
      LEFT JOIN colaboradores_salarios s
             ON s.colaborador_id = c.id
            AND s.tenant_id      = p_tenant_id
            AND s.data_fim IS NULL
     WHERE c.tenant_id          = p_tenant_id
       AND c.tipo_contratacao  IN ('pj', 'mei', 'clt_recibo')
       AND c.data_admissao     <= v_ultimo
       AND (c.status = 'ativo' OR c.data_encerramento >= v_primeiro)
       AND NOT EXISTS (
             SELECT 1
               FROM folhas_pagamento f
              WHERE f.tenant_id       = p_tenant_id
                AND f.competencia_ano = p_ano
                AND f.competencia_mes = p_mes
                AND f.origem          = 'california'
                AND f.colaborador_id  = c.id
           )
     ORDER BY c.nome
  LOOP
    -- Sem salário → pula
    IF NOT r.tem_salario OR r.salario IS NULL THEN
      v_sem_sal := v_sem_sal || r.nome;
      CONTINUE;
    END IF;

    -- ----------------------------------------------------------------
    -- Buscar pacote de alocação vigente
    -- ----------------------------------------------------------------
    SELECT a.id INTO v_pacote_id
      FROM colaboradores_alocacoes a
     WHERE a.colaborador_id = r.id
       AND a.tenant_id      = p_tenant_id
       AND a.data_fim IS NULL;

    IF NOT FOUND THEN
      v_sem_aloc := v_sem_aloc || r.nome;
      CONTINUE;
    END IF;

    -- Conta itens do pacote (modelo multi-empresa)
    SELECT COUNT(*) INTO v_item_count
      FROM colaboradores_alocacoes_itens
     WHERE alocacao_id = v_pacote_id
       AND tenant_id   = p_tenant_id;

    -- ----------------------------------------------------------------
    -- FALLBACK LEGADO: pacote sem itens = modelo v1 (empresa_id na
    -- linha mãe). Acontece enquanto o backfill da Task 2 não rodou.
    -- ----------------------------------------------------------------
    IF v_item_count = 0 THEN
      SELECT a.empresa_id,
             a.regional_id,
             a.usa_rateio_empresa
        INTO v_leg_empresa_id,
             v_leg_regional_id,
             v_leg_usa_rateio
        FROM colaboradores_alocacoes a
       WHERE a.id = v_pacote_id;

      IF v_leg_empresa_id IS NULL THEN
        v_sem_aloc := v_sem_aloc || r.nome;
        CONTINUE;
      END IF;

      IF v_leg_usa_rateio IS TRUE THEN
        IF NOT EXISTS (
          SELECT 1
            FROM empresas_rateios_regionais er
           WHERE er.tenant_id    = p_tenant_id
             AND er.empresa_id   = v_leg_empresa_id
             AND er.ano_vigencia = p_ano
             AND er.percentual   > 0
        ) THEN
          v_sem_rat := v_sem_rat || r.nome;
          CONTINUE;
        END IF;
      ELSIF v_leg_regional_id IS NULL THEN
        v_sem_aloc := v_sem_aloc || r.nome;
        CONTINUE;
      END IF;

      -- Cria folha (legado)
      INSERT INTO folhas_pagamento (
        tenant_id, colaborador_id, competencia_ano, competencia_mes,
        salario_base, status, origem, created_by
      ) VALUES (
        p_tenant_id, r.id, p_ano, p_mes,
        r.salario, 'rascunho', 'california', v_criado_por
      )
      RETURNING id INTO v_folha_id;

      -- NOTA (I1 — invariante do caminho legado):
      -- Este INSERT...SELECT não acumula v_linhas_ids e portanto não passa pela
      -- correção de rounding do modelo multi-empresa. Isso é seguro porque folhas
      -- legadas usam uma única empresa com percentual_empresa = 100 %, e as linhas
      -- de empresas_rateios_regionais para essa empresa devem somar exatamente 100.
      -- Se o cadastro estiver correto, o multiplicador é 100 % × rateio = rateio
      -- e a soma fecha por construção sem ajuste. Este caminho é transitório e será
      -- removido após o backfill universal de colaboradores_alocacoes_pacotes.
      IF v_leg_usa_rateio IS TRUE THEN
        INSERT INTO folhas_pagamento_alocacoes
              (tenant_id, folha_id, empresa_id, regional_id, percentual)
        SELECT p_tenant_id, v_folha_id, v_leg_empresa_id, er.regional_id, er.percentual
          FROM empresas_rateios_regionais er
         WHERE er.tenant_id    = p_tenant_id
           AND er.empresa_id   = v_leg_empresa_id
           AND er.ano_vigencia = p_ano
           AND er.percentual   > 0;
      ELSE
        INSERT INTO folhas_pagamento_alocacoes
              (tenant_id, folha_id, empresa_id, regional_id, percentual)
        VALUES (p_tenant_id, v_folha_id, v_leg_empresa_id, v_leg_regional_id, 100);
      END IF;

      v_criadas := v_criadas + 1;
      CONTINUE;
    END IF;

    -- ----------------------------------------------------------------
    -- MODELO MULTI-EMPRESA: valida antes de criar folha
    -- ----------------------------------------------------------------
    v_tem_problema      := FALSE;
    v_bloqueado_sem_rat := FALSE;

    FOR v_item IN
      SELECT i.id,
             i.empresa_id,
             i.percentual_empresa,
             i.usa_rateio_empresa
        FROM colaboradores_alocacoes_itens i
       WHERE i.alocacao_id = v_pacote_id
         AND i.tenant_id   = p_tenant_id
       ORDER BY i.created_at
    LOOP
      IF v_item.usa_rateio_empresa THEN
        -- Precisa ter rateio configurado no ano
        IF NOT EXISTS (
          SELECT 1
            FROM empresas_rateios_regionais er
           WHERE er.tenant_id    = p_tenant_id
             AND er.empresa_id   = v_item.empresa_id
             AND er.ano_vigencia = p_ano
             AND er.percentual   > 0
        ) THEN
          v_bloqueado_sem_rat := TRUE;
          v_tem_problema := TRUE;
          EXIT;
        END IF;
      ELSE
        -- Precisa ter regionais explícitas (estado inválido se vazio)
        SELECT COUNT(*) INTO v_reg_count
          FROM colaboradores_alocacoes_itens_regionais r2
         WHERE r2.alocacao_item_id = v_item.id
           AND r2.tenant_id        = p_tenant_id;

        IF v_reg_count = 0 THEN
          v_tem_problema := TRUE;
          EXIT;
        END IF;
      END IF;
    END LOOP;

    IF v_tem_problema THEN
      IF v_bloqueado_sem_rat THEN
        v_sem_rat := v_sem_rat || r.nome;
      ELSE
        v_sem_aloc := v_sem_aloc || r.nome;
      END IF;
      CONTINUE;
    END IF;

    -- ----------------------------------------------------------------
    -- Tudo ok: cria folha
    -- ----------------------------------------------------------------
    INSERT INTO folhas_pagamento (
      tenant_id, colaborador_id, competencia_ano, competencia_mes,
      salario_base, status, origem, created_by
    ) VALUES (
      p_tenant_id, r.id, p_ano, p_mes,
      r.salario, 'rascunho', 'california', v_criado_por
    )
    RETURNING id INTO v_folha_id;

    -- Reinicia acumuladores para esta folha
    v_linhas_ids := '{}';
    v_soma_pct   := 0;

    -- ----------------------------------------------------------------
    -- Explode itens → regionais → INSERT em folhas_pagamento_alocacoes
    -- O trigger trg_folha_alocacao_soma_100 é DEFERRABLE INITIALLY
    -- DEFERRED — INSERTs parciais não violam a validação.
    -- ----------------------------------------------------------------
    FOR v_item IN
      SELECT i.id,
             i.empresa_id,
             i.percentual_empresa,
             i.usa_rateio_empresa
        FROM colaboradores_alocacoes_itens i
       WHERE i.alocacao_id = v_pacote_id
         AND i.tenant_id   = p_tenant_id
       ORDER BY i.created_at
    LOOP
      IF v_item.usa_rateio_empresa THEN
        -- Expande via rateio padrão da empresa
        FOR v_reg IN
          SELECT er.regional_id, er.percentual
            FROM empresas_rateios_regionais er
           WHERE er.tenant_id    = p_tenant_id
             AND er.empresa_id   = v_item.empresa_id
             AND er.ano_vigencia = p_ano
             AND er.percentual   > 0
           ORDER BY er.regional_id
        LOOP
          v_pct_final := ROUND(
            v_item.percentual_empresa * v_reg.percentual / 100.0,
            2
          );

          INSERT INTO folhas_pagamento_alocacoes
                (tenant_id, folha_id, empresa_id, regional_id, percentual)
          VALUES (p_tenant_id, v_folha_id, v_item.empresa_id, v_reg.regional_id, v_pct_final)
          RETURNING id INTO v_ultimo_id;

          v_linhas_ids := v_linhas_ids || v_ultimo_id;
          v_soma_pct   := v_soma_pct + v_pct_final;
        END LOOP;

      ELSE
        -- Expande via regionais explícitas do item
        FOR v_reg IN
          SELECT r2.regional_id, r2.percentual_regional
            FROM colaboradores_alocacoes_itens_regionais r2
           WHERE r2.alocacao_item_id = v_item.id
             AND r2.tenant_id        = p_tenant_id
           ORDER BY r2.regional_id
        LOOP
          v_pct_final := ROUND(
            v_item.percentual_empresa * v_reg.percentual_regional / 100.0,
            2
          );

          INSERT INTO folhas_pagamento_alocacoes
                (tenant_id, folha_id, empresa_id, regional_id, percentual)
          VALUES (p_tenant_id, v_folha_id, v_item.empresa_id, v_reg.regional_id, v_pct_final)
          RETURNING id INTO v_ultimo_id;

          v_linhas_ids := v_linhas_ids || v_ultimo_id;
          v_soma_pct   := v_soma_pct + v_pct_final;
        END LOOP;
      END IF;
    END LOOP;

    -- ----------------------------------------------------------------
    -- Correção de rounding: ajusta a ÚLTIMA linha para fechar em 100
    -- (diff típico: ±0.01 a ±0.04 por arredondamento de 2 casas decimais)
    -- ----------------------------------------------------------------
    IF cardinality(v_linhas_ids) > 0 THEN
      v_diff      := 100.00 - v_soma_pct;
      v_ultimo_id := v_linhas_ids[cardinality(v_linhas_ids)];

      IF abs(v_diff) >= 0.01 THEN
        UPDATE folhas_pagamento_alocacoes
           SET percentual = percentual + v_diff
         WHERE id = v_ultimo_id;
      END IF;
    END IF;

    v_criadas := v_criadas + 1;
  END LOOP;

  -- ----------------------------------------------------------------
  -- Resultado — mesma estrutura da v1
  -- ----------------------------------------------------------------
  RETURN jsonb_build_object(
    'criadas',              v_criadas,
    'ja_existiam',          v_candidatos - (
                              v_criadas
                              + cardinality(v_sem_sal)
                              + cardinality(v_sem_aloc)
                              + cardinality(v_sem_rat)
                            ),
    'pulados_sem_salario',  to_jsonb(v_sem_sal),
    'pulados_sem_alocacao', to_jsonb(v_sem_aloc),
    'pulados_sem_rateio',   to_jsonb(v_sem_rat)
  );
END;
$$;

COMMENT ON FUNCTION public.gerar_folha_da_competencia(uuid, integer, integer) IS
  'v2 (2026-10-28): explode pacote multi-empresa. Para cada colaborador elegível '
  '(PJ/MEI/CLT_recibo), lê o pacote vigente em colaboradores_alocacoes_itens e '
  'gera N linhas em folhas_pagamento_alocacoes com percentual_final = '
  'item.percentual_empresa × regional_pct / 100. Correção de rounding na última linha. '
  'Fallback para modelo legado (empresa_id/regional_id na linha mãe) quando o pacote não '
  'tem itens (backfill ainda não executado). '
  'Signature e return type idênticos à v1.';

-- GRANT não muda: já existe da versão anterior
GRANT EXECUTE ON FUNCTION public.gerar_folha_da_competencia(uuid, integer, integer)
  TO authenticated;
