-- Spec: docs/superpowers/specs/2026-10-28-13o-nf-fluxo-design.md
-- Fundação de schema para ligar 13° (adiantamento) no quadro de NF do colaborador
-- e no tab People do financeiro.
--
-- O que esta migration faz:
--   1. Adiciona 'decimo_terceiro_adiantamento' ao enum nf_anexo_escopo.
--   2. Adiciona 'decimo_terceiro_adiantamento' ao enum folha_tipo.
--   3. Adiciona FK folhas_pagamento.decimo_terceiro_adiantamento_id -> decimo_terceiro_adiantamentos(id).
--   4. Adiciona FK decimo_terceiro_adiantamentos.folha_pagamento_id -> folhas_pagamento(id).
--   5. Recria fn_valida_nf_anexo_escopo adicionando ELSIF para o novo escopo_tipo.
--   6. GRANTs: as três tabelas já têm GRANT ALL para authenticated no nível de tabela;
--      nenhum GRANT adicional de coluna é necessário.
--
-- NOTA DE APLICAÇÃO: os dois ALTER TYPE ... ADD VALUE não podem rodar dentro de uma
-- transação (limitação do Postgres). Portanto esta migration é aplicada via MCP em
-- DOIS calls separados:
--   - Call 1: apenas os dois ALTER TYPE (blocos 1 e 2)
--   - Call 2: todo o restante (blocos 3 a 5)
-- O arquivo no repositório é único; os dois calls documentam a razão acima.

-- ============================================================
-- BLOCO 1 — enum nf_anexo_escopo: novo valor
-- ============================================================

ALTER TYPE public.nf_anexo_escopo ADD VALUE IF NOT EXISTS 'decimo_terceiro_adiantamento';

-- ============================================================
-- BLOCO 2 — enum folha_tipo: novo valor
-- ============================================================

ALTER TYPE public.folha_tipo ADD VALUE IF NOT EXISTS 'decimo_terceiro_adiantamento';

-- ============================================================
-- BLOCO 3 — FK folhas_pagamento -> decimo_terceiro_adiantamentos
-- ============================================================

ALTER TABLE public.folhas_pagamento
  ADD COLUMN IF NOT EXISTS decimo_terceiro_adiantamento_id uuid NULL
    REFERENCES public.decimo_terceiro_adiantamentos(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_folhas_pagamento_decimo_terceiro_adiantamento_id
  ON public.folhas_pagamento (decimo_terceiro_adiantamento_id)
  WHERE decimo_terceiro_adiantamento_id IS NOT NULL;

-- ============================================================
-- BLOCO 4 — FK decimo_terceiro_adiantamentos -> folhas_pagamento
-- ============================================================

ALTER TABLE public.decimo_terceiro_adiantamentos
  ADD COLUMN IF NOT EXISTS folha_pagamento_id uuid NULL
    REFERENCES public.folhas_pagamento(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_decimo_terceiro_adiantamentos_folha_pagamento_id
  ON public.decimo_terceiro_adiantamentos (folha_pagamento_id)
  WHERE folha_pagamento_id IS NOT NULL;

-- ============================================================
-- BLOCO 5 — Trigger fn_valida_nf_anexo_escopo: adicionar ELSIF
--           para decimo_terceiro_adiantamento.
--           Preservar todos os branches existentes intactos.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_valida_nf_anexo_escopo()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_catalog'
AS $function$
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

  ELSIF NEW.escopo_tipo = 'decimo_terceiro_adiantamento' THEN
    IF NOT EXISTS (
      SELECT 1 FROM decimo_terceiro_adiantamentos WHERE id = NEW.escopo_id
    ) THEN
      RAISE EXCEPTION
        'Adiantamento de 13° não encontrado: %',
        NEW.escopo_id;
    END IF;

  END IF;

  RETURN NEW;
END;
$function$;
