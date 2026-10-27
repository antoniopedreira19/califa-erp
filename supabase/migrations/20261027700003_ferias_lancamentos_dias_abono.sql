-- Motivo: suportar abono_combinado end-to-end (colaborador tira X dias +
-- vende Y no mesmo pedido). Hoje o campo não existe; cálculo trata
-- abono_combinado como usufruto puro (valor_abono=0), gerando bug latente
-- (2ª folha com salario_base=0). Nenhum lançamento existente é combinado
-- (confirmado via MCP: 277/277 rows são tipo='usufruto').
-- Spec: docs/superpowers/specs/2026-10-27-solicitar-ferias-modal-abono-combinado-design.md

ALTER TABLE public.colaboradores_ferias_lancamentos
  ADD COLUMN IF NOT EXISTS dias_abono int NOT NULL DEFAULT 0
  CHECK (dias_abono >= 0);

COMMENT ON COLUMN public.colaboradores_ferias_lancamentos.dias_abono IS
  'Dias que o colaborador vende dentro do bloco de férias (só aplica a tipo=abono_combinado). Pra outros tipos sempre 0. O campo dias (existente) é o TOTAL consumido do saldo (dias_folga + dias_abono).';

ALTER TABLE public.colaboradores_ferias_lancamentos
  ADD CONSTRAINT chk_dias_abono_so_combinado
  CHECK (
    (tipo = 'abono_combinado' AND dias_abono > 0)
    OR (tipo <> 'abono_combinado' AND dias_abono = 0)
  );
