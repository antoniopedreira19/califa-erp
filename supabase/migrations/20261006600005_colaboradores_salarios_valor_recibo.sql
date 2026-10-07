-- Divide o salário de colaboradores clt_recibo em duas partes:
--   valor         = total mensal do contrato (inalterado)
--   valor_recibo  = parcela paga como RPA pela California (gera folha interna)
-- A parcela CLT (paga pela contabilidade) é derivada: valor - valor_recibo.
-- CHECK via trigger: valor_recibo preenchido se e somente se tipo_contratacao='clt_recibo'.
-- Backfill 50/50 aplicado em vigentes e histórico; operador ajusta caso a caso depois.
-- Spec: docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md (D2)

ALTER TABLE public.colaboradores_salarios
  ADD COLUMN valor_recibo numeric(14,2) NULL;

COMMENT ON COLUMN public.colaboradores_salarios.valor_recibo IS
  'Parcela RPA do salário de colaborador clt_recibo. NULL para outros tipos. Parcela CLT derivada = valor - valor_recibo.';

-- Trigger de coerência: valor_recibo preenchido IFF o colaborador é clt_recibo.
CREATE OR REPLACE FUNCTION public.trg_colaboradores_salarios_valor_recibo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo public.tipo_contratacao;
BEGIN
  SELECT tipo_contratacao INTO v_tipo
  FROM public.colaboradores
  WHERE id = NEW.colaborador_id;

  IF v_tipo = 'clt_recibo' THEN
    IF NEW.valor_recibo IS NULL THEN
      RAISE EXCEPTION 'valor_recibo é obrigatório para colaborador clt_recibo (colaborador_id=%)', NEW.colaborador_id;
    END IF;
    IF NEW.valor_recibo < 0 OR NEW.valor_recibo > NEW.valor THEN
      RAISE EXCEPTION 'valor_recibo (%) fora do intervalo [0, valor=%]', NEW.valor_recibo, NEW.valor;
    END IF;
  ELSE
    IF NEW.valor_recibo IS NOT NULL THEN
      RAISE EXCEPTION 'valor_recibo deve ser NULL para tipo_contratacao=% (colaborador_id=%)', v_tipo, NEW.colaborador_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER colaboradores_salarios_valor_recibo_check
  BEFORE INSERT OR UPDATE ON public.colaboradores_salarios
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_colaboradores_salarios_valor_recibo();

-- Backfill 50/50: parcela RPA inicial = metade do total. Operador ajusta caso a caso.
UPDATE public.colaboradores_salarios cs
SET valor_recibo = round(cs.valor / 2, 2)
FROM public.colaboradores c
WHERE c.id = cs.colaborador_id
  AND c.tipo_contratacao = 'clt_recibo'
  AND cs.valor_recibo IS NULL;
