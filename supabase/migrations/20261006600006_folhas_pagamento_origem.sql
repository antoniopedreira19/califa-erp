-- Discrimina origem da linha de folha e permite coexistência de duas linhas
-- para o mesmo colaborador híbrido na mesma competência (uma california + uma contabilidade).
-- data_pagamento_prevista guarda a data que veio no PDF da contabilidade.
-- Spec: docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md (D1, D3)

ALTER TABLE public.folhas_pagamento
  ADD COLUMN origem public.folha_origem NOT NULL DEFAULT 'california',
  ADD COLUMN data_pagamento_prevista date NULL;

COMMENT ON COLUMN public.folhas_pagamento.origem IS
  'california = gerada por gerarFolha; contabilidade = importada do PDF Relação Geral dos Líquidos.';

COMMENT ON COLUMN public.folhas_pagamento.data_pagamento_prevista IS
  'Data de pagamento sugerida pela contabilidade (vem no PDF). NULL para linhas california.';

-- A unique anterior era um UNIQUE INDEX (não CONSTRAINT), por isso DROP INDEX e não ALTER TABLE ... DROP CONSTRAINT.
-- Também não incluía tenant_id, que aproveitamos para blindar multi-tenant.
DROP INDEX IF EXISTS public.uniq_folha_por_colaborador_competencia;

CREATE UNIQUE INDEX folhas_pagamento_tenant_ano_mes_colab_origem_idx
  ON public.folhas_pagamento (tenant_id, competencia_ano, competencia_mes, colaborador_id, origem);

CREATE INDEX folhas_pagamento_competencia_origem_idx
  ON public.folhas_pagamento (tenant_id, competencia_ano, competencia_mes, origem);
