-- =====================================================================
-- RPC trocar_pacote_alocacao: transação atômica para troca de pacote
-- =====================================================================
--
-- POR QUE ESTA RPC EXISTE
--
-- O novo modelo de alocação multi-empresa exige que fechar a vigente,
-- criar o pacote novo, inserir N itens e M regionais aconteçam numa
-- única transação. Sem a RPC, o frontend precisaria orquestrar múltiplas
-- calls independentes — janela de inconsistência garantida se qualquer
-- call falhar no meio.
--
-- SECURITY INVOKER: o RLS do chamador continua valendo. A função não
-- eleva privilégio — se authenticated não tem acesso à tabela, a RPC
-- também não tem.
--
-- TRIGGERS DEFERRED: os triggers de soma 100 são DEFERRABLE INITIALLY
-- DEFERRED (migration 100001 e 100001a). Eles disparam no COMMIT da
-- transação, não a cada INSERT individual — isso permite inserir item
-- + regionais em sequência dentro da mesma chamada sem falso positivo.
--
-- LÓGICA DE FECHAMENTO DA VIGENTE (espelho de alterarAlocacao):
--   a) data_mudanca > data_inicio da vigente → UPDATE data_fim = data_mudanca - 1
--   b) data_mudanca <= data_inicio da vigente → DELETE (correção de erro recém-criado)
--
-- FORMATO DE p_itens:
--   [
--     {
--       "empresa_id": "uuid",
--       "percentual_empresa": 60.00,
--       "usa_rateio_empresa": true,
--       "regionais": []
--     },
--     {
--       "empresa_id": "uuid",
--       "percentual_empresa": 40.00,
--       "usa_rateio_empresa": false,
--       "regionais": [
--         {"regional_id": "uuid", "percentual_regional": 100.00}
--       ]
--     }
--   ]
--
-- Ver: docs/superpowers/specs/2026-10-28-alocacao-multi-empresa-design.md
-- =====================================================================

CREATE OR REPLACE FUNCTION public.trocar_pacote_alocacao(
  p_tenant_id       uuid,
  p_colaborador_id  uuid,
  p_data_mudanca    date,
  p_motivo          text,
  p_itens           jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_pacote_id      uuid;
  v_vigente_id     uuid;
  v_vigente_inicio date;
  v_item           jsonb;
  v_regional       jsonb;
  v_item_id        uuid;
  v_empresa_id     uuid;
  v_regional_id    uuid;
  v_empresa_tenant uuid;
  v_regional_emp   uuid;
  v_item_idx       integer := 0;
BEGIN
  -- ---------------------------------------------------------------
  -- 1) Validação básica do jsonb
  -- ---------------------------------------------------------------
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'trocar_pacote_alocacao: p_itens deve ser um array JSON não nulo.'
      USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'trocar_pacote_alocacao: p_itens não pode ser vazio — pacote precisa de pelo menos um item.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------------------------------------------------------------
  -- 2) Validação de cada item: empresa existe no tenant; regional
  --    pertence à empresa quando informada
  -- ---------------------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_item_idx := v_item_idx + 1;

    -- Valida que empresa_id existe e pertence ao tenant
    v_empresa_id := (v_item->>'empresa_id')::uuid;

    SELECT tenant_id INTO v_empresa_tenant
    FROM public.empresas
    WHERE id = v_empresa_id;

    IF NOT FOUND OR v_empresa_tenant <> p_tenant_id THEN
      RAISE EXCEPTION 'trocar_pacote_alocacao: item % — empresa % não encontrada no tenant.'
        , v_item_idx, v_empresa_id
        USING ERRCODE = 'P0001';
    END IF;

    -- Valida cada regional: deve pertencer à empresa do item
    FOR v_regional IN SELECT * FROM jsonb_array_elements(v_item->'regionais') LOOP
      v_regional_id := (v_regional->>'regional_id')::uuid;

      SELECT empresa_id INTO v_regional_emp
      FROM public.regionais
      WHERE id = v_regional_id;

      IF NOT FOUND OR v_regional_emp <> v_empresa_id THEN
        RAISE EXCEPTION 'trocar_pacote_alocacao: item % — regional % não pertence à empresa %.'
          , v_item_idx, v_regional_id, v_empresa_id
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END LOOP;

  -- ---------------------------------------------------------------
  -- 3) Fechar ou deletar a alocação vigente (data_fim IS NULL)
  -- ---------------------------------------------------------------
  SELECT id, data_inicio
    INTO v_vigente_id, v_vigente_inicio
  FROM public.colaboradores_alocacoes
  WHERE colaborador_id = p_colaborador_id
    AND tenant_id      = p_tenant_id
    AND data_fim IS NULL;

  IF FOUND THEN
    IF p_data_mudanca <= v_vigente_inicio THEN
      -- Correção de alocação recém-criada: DELETE em vez de fechar
      DELETE FROM public.colaboradores_alocacoes
      WHERE id = v_vigente_id;
    ELSE
      -- Fechamento normal: data_fim = data_mudanca - 1 dia
      UPDATE public.colaboradores_alocacoes
         SET data_fim = p_data_mudanca - interval '1 day'
       WHERE id = v_vigente_id;
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- 4) Criar o novo pacote (linha mãe)
  --    empresa_id e usa_rateio_empresa ficam NULL no modelo multi-empresa
  --    (colunas legadas — vide migration 100001)
  -- ---------------------------------------------------------------
  INSERT INTO public.colaboradores_alocacoes (
    tenant_id,
    colaborador_id,
    empresa_id,
    usa_rateio_empresa,
    data_inicio,
    motivo
  ) VALUES (
    p_tenant_id,
    p_colaborador_id,
    NULL,    -- legado — não usado no modelo multi-empresa
    NULL,    -- legado — não usado no modelo multi-empresa
    p_data_mudanca,
    p_motivo
  )
  RETURNING id INTO v_pacote_id;

  -- ---------------------------------------------------------------
  -- 5) Inserir itens e regionais
  --    Os triggers de soma 100 são DEFERRED — disparam no COMMIT.
  -- ---------------------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    -- Insere item (empresa)
    INSERT INTO public.colaboradores_alocacoes_itens (
      tenant_id,
      alocacao_id,
      empresa_id,
      percentual_empresa,
      usa_rateio_empresa
    ) VALUES (
      p_tenant_id,
      v_pacote_id,
      (v_item->>'empresa_id')::uuid,
      (v_item->>'percentual_empresa')::numeric,
      (v_item->>'usa_rateio_empresa')::boolean
    )
    RETURNING id INTO v_item_id;

    -- Insere regionais do item
    FOR v_regional IN SELECT * FROM jsonb_array_elements(v_item->'regionais') LOOP
      INSERT INTO public.colaboradores_alocacoes_itens_regionais (
        tenant_id,
        alocacao_item_id,
        regional_id,
        percentual_regional
      ) VALUES (
        p_tenant_id,
        v_item_id,
        (v_regional->>'regional_id')::uuid,
        (v_regional->>'percentual_regional')::numeric
      );
    END LOOP;
  END LOOP;

  -- ---------------------------------------------------------------
  -- 6) Retorna id do pacote novo
  --    Os triggers DEFERRED validam soma 100 aqui, no COMMIT.
  -- ---------------------------------------------------------------
  RETURN v_pacote_id;
END;
$$;

COMMENT ON FUNCTION public.trocar_pacote_alocacao(uuid, uuid, date, text, jsonb) IS
  'Troca atômica de pacote de alocação multi-empresa. Fecha (ou deleta) a vigente, cria pacote novo com N itens e M regionais numa única transação. Retorna o id uuid do pacote novo. SECURITY INVOKER: RLS do caller vale. Os triggers de soma 100 em colaboradores_alocacoes_itens e colaboradores_alocacoes_itens_regionais são DEFERRABLE INITIALLY DEFERRED — validam no COMMIT.';

-- GRANT EXECUTE para authenticated (anon não tem acesso)
GRANT EXECUTE ON FUNCTION public.trocar_pacote_alocacao(uuid, uuid, date, text, jsonb)
  TO authenticated;
