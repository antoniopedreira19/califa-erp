-- Fix de review da migration 20261026700001:
--   C1: fn_valida_nf_anexo_escopo e fn_barra_nf_anexo_sem_escopo_id precisavam
--       de SECURITY DEFINER pra que o trigger pudesse consultar
--       folhas_pagamento, colaboradores_ferias_lancamentos e
--       decimo_terceiro_linhas mesmo quando o caller não tem SELECT direto
--       nessas tabelas (todas têm RLS). Sem SECURITY DEFINER o trigger rodava
--       como SECURITY INVOKER e a EXISTS() retornava falso para linhas que
--       existem mas o RLS escondia do caller — falso-negativo silencioso.
--   I1: trg_barra_nf_anexo_sem_escopo_id cobria apenas INSERT. Um
--       UPDATE SET escopo_id = NULL passava silenciosamente. Trocado para
--       BEFORE INSERT OR UPDATE OF escopo_id.

-- ============================================================
-- 1. fn_valida_nf_anexo_escopo — idêntica à original + SECURITY DEFINER
-- ============================================================
CREATE OR REPLACE FUNCTION fn_valida_nf_anexo_escopo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Só valida quando escopo_id foi fornecido
  IF NEW.escopo_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.escopo_tipo = 'folha_mensal' THEN
    IF NOT EXISTS (
      SELECT 1 FROM folhas_pagamento WHERE id = NEW.escopo_id
    ) THEN
      RAISE EXCEPTION
        'escopo_id % nao encontrado em folhas_pagamento (escopo_tipo=folha_mensal)',
        NEW.escopo_id;
    END IF;

  ELSIF NEW.escopo_tipo IN ('ferias_usufruto', 'ferias_abono') THEN
    IF NOT EXISTS (
      SELECT 1 FROM colaboradores_ferias_lancamentos WHERE id = NEW.escopo_id
    ) THEN
      RAISE EXCEPTION
        'escopo_id % nao encontrado em colaboradores_ferias_lancamentos (escopo_tipo=%)',
        NEW.escopo_id, NEW.escopo_tipo;
    END IF;

  ELSIF NEW.escopo_tipo IN ('decimo_terceiro_p1', 'decimo_terceiro_p2') THEN
    IF NOT EXISTS (
      SELECT 1 FROM decimo_terceiro_linhas WHERE id = NEW.escopo_id
    ) THEN
      RAISE EXCEPTION
        'escopo_id % nao encontrado em decimo_terceiro_linhas (escopo_tipo=%)',
        NEW.escopo_id, NEW.escopo_tipo;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 2. fn_barra_nf_anexo_sem_escopo_id — idêntica à original + SECURITY DEFINER
-- ============================================================
CREATE OR REPLACE FUNCTION fn_barra_nf_anexo_sem_escopo_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.escopo_id IS NULL THEN
    RAISE EXCEPTION
      'escopo_id nao pode ser NULL ao inserir em colaboradores_nf_anexos';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. Recriar trg_barra_nf_anexo_sem_escopo_id cobrindo INSERT e UPDATE
--    (fix I1: antes só cobria INSERT)
-- ============================================================
DROP TRIGGER IF EXISTS trg_barra_nf_anexo_sem_escopo_id ON colaboradores_nf_anexos;

CREATE TRIGGER trg_barra_nf_anexo_sem_escopo_id
  BEFORE INSERT OR UPDATE OF escopo_id ON colaboradores_nf_anexos
  FOR EACH ROW
  EXECUTE FUNCTION fn_barra_nf_anexo_sem_escopo_id();
