-- Motivo: separa 'folha de férias puras' de 'folha de abono' pra permitir
-- NFs distintas no caso de abono_combinado (2 folhas, 2 NFs).
-- Spec: docs/superpowers/specs/2026-10-26-quadro-nf-colaborador-design.md
-- Ruling: progress.md "Task 4-6 redesenhadas"

ALTER TABLE public.folhas_pagamento
  ADD COLUMN IF NOT EXISTS tipo_folha_ferias text
  CHECK (tipo_folha_ferias IN ('usufruto', 'abono'));

COMMENT ON COLUMN public.folhas_pagamento.tipo_folha_ferias IS
  'Null exceto quando tipo=''ferias''. Distingue folha de férias (usufruto) de folha de abono. Pra abono_combinado, cria-se 2 folhas pro mesmo lancamento_ferias_id — uma usufruto, uma abono.';

-- Backfill: folhas de férias existentes recebem 'usufruto' por default
-- (não há abono_combinado em produção hoje).
UPDATE public.folhas_pagamento
   SET tipo_folha_ferias = 'usufruto'
 WHERE tipo = 'ferias'
   AND tipo_folha_ferias IS NULL;
