-- Generaliza colaboradores_nf_anexos pra suportar NFs de folha mensal,
-- férias, abono e 13° (parcelas 1 e 2). Chave antiga (colab, ano, mês) vira
-- índice secundário pra folha mensal; chave nova é (colab, escopo_tipo,
-- escopo_id). Adiciona valor 'aguardando_financeiro' em
-- ferias_lancamento_status pro novo fluxo de aprovação pelo financeiro.
-- Spec: docs/superpowers/specs/2026-10-26-quadro-nf-colaborador-design.md

-- ============================================================
-- 1. Enum nf_anexo_escopo
-- ============================================================
CREATE TYPE nf_anexo_escopo AS ENUM (
  'folha_mensal',
  'ferias_usufruto',
  'ferias_abono',
  'decimo_terceiro_p1',
  'decimo_terceiro_p2'
);

-- ============================================================
-- 2. Adicionar colunas novas (nullable inicialmente para permitir backfill)
-- ============================================================
ALTER TABLE colaboradores_nf_anexos
  ADD COLUMN escopo_tipo nf_anexo_escopo,
  ADD COLUMN escopo_id   uuid;

-- ============================================================
-- 3. Backfill: linhas existentes são todas de folha mensal.
--    escopo_id = max(f.id) de folhas_pagamento com mesma
--    (tenant_id, colaborador_id, competencia_ano, competencia_mes).
--    Linhas sem match ficam com escopo_id = NULL e recebem RAISE NOTICE.
-- ============================================================
DO $$
DECLARE
  v_orfas integer;
BEGIN
  -- Nota: max(uuid) não existe no Postgres; ordenamos por created_at DESC
  -- e pegamos o id da folha mais recentemente criada para a competência.
  UPDATE colaboradores_nf_anexos AS a
  SET
    escopo_tipo = 'folha_mensal',
    escopo_id   = (
      SELECT f.id
      FROM folhas_pagamento f
      WHERE f.tenant_id       = a.tenant_id
        AND f.colaborador_id  = a.colaborador_id
        AND f.competencia_ano = a.competencia_ano
        AND f.competencia_mes = a.competencia_mes
      ORDER BY f.created_at DESC
      LIMIT 1
    );

  SELECT count(*) INTO v_orfas
  FROM colaboradores_nf_anexos
  WHERE escopo_id IS NULL;

  IF v_orfas > 0 THEN
    RAISE NOTICE 'BACKFILL: % linhas orfas encontradas (escopo_id IS NULL) em colaboradores_nf_anexos', v_orfas;
  END IF;
END;
$$;

-- ============================================================
-- 4. SET NOT NULL em escopo_tipo (todas as linhas foram preenchidas)
-- ============================================================
ALTER TABLE colaboradores_nf_anexos
  ALTER COLUMN escopo_tipo SET NOT NULL;

-- ============================================================
-- 5. Drop do unique index antigo e criação como índice não-único
--    (mantemos as colunas pra queries de folha mensal)
-- ============================================================
DROP INDEX IF EXISTS colaboradores_nf_anexos_competencia_idx;

CREATE INDEX colaboradores_nf_anexos_competencia_idx
  ON colaboradores_nf_anexos (tenant_id, colaborador_id, competencia_ano, competencia_mes);

-- ============================================================
-- 6. Unique parcial: (colab, escopo_tipo, escopo_id) WHERE escopo_id IS NOT NULL
-- ============================================================
CREATE UNIQUE INDEX uniq_nf_anexos_escopo
  ON colaboradores_nf_anexos (tenant_id, colaborador_id, escopo_tipo, escopo_id)
  WHERE escopo_id IS NOT NULL;

-- ============================================================
-- 7. Trigger: valida que escopo_id existe na tabela correta
--    de acordo com escopo_tipo.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_valida_nf_anexo_escopo()
RETURNS trigger
LANGUAGE plpgsql
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

CREATE TRIGGER trg_valida_nf_anexo_escopo
  BEFORE INSERT OR UPDATE OF escopo_tipo, escopo_id
  ON colaboradores_nf_anexos
  FOR EACH ROW
  EXECUTE FUNCTION fn_valida_nf_anexo_escopo();

-- ============================================================
-- 8. Trigger: bloqueia INSERT com escopo_id IS NULL após backfill.
--    Somente a migration acima pode criar linhas sem escopo_id.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_barra_nf_anexo_sem_escopo_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.escopo_id IS NULL THEN
    RAISE EXCEPTION
      'escopo_id nao pode ser NULL ao inserir em colaboradores_nf_anexos';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_barra_nf_anexo_sem_escopo_id
  BEFORE INSERT
  ON colaboradores_nf_anexos
  FOR EACH ROW
  EXECUTE FUNCTION fn_barra_nf_anexo_sem_escopo_id();

-- ============================================================
-- 9. Novo valor em ferias_lancamento_status
-- ============================================================
ALTER TYPE ferias_lancamento_status ADD VALUE 'aguardando_financeiro' BEFORE 'aprovado';

-- ============================================================
-- 10. GRANT defensivo (reaplicar não quebra)
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON colaboradores_nf_anexos TO authenticated;
