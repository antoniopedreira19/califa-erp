-- Motivo: ajuste da migration anterior (20261027700003). O constraint existente
-- chk_ferias_lancamento_datas força dias = (data_fim - data_inicio) + 1,
-- o que bloqueia abono_combinado onde `dias = dias_folga + dias_abono`
-- (dias_folga = fim - ini + 1; dias total = consumido do saldo).
-- Spec: docs/superpowers/specs/2026-10-27-solicitar-ferias-modal-abono-combinado-design.md

ALTER TABLE public.colaboradores_ferias_lancamentos
  DROP CONSTRAINT IF EXISTS chk_ferias_lancamento_datas;

ALTER TABLE public.colaboradores_ferias_lancamentos
  ADD CONSTRAINT chk_ferias_lancamento_datas
  CHECK (
    data_fim >= data_inicio
    AND (
      (tipo = 'abono_combinado' AND dias = ((data_fim - data_inicio) + 1) + dias_abono)
      OR (tipo <> 'abono_combinado' AND dias = ((data_fim - data_inicio) + 1))
    )
  );
