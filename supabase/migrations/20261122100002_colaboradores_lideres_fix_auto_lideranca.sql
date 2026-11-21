-- Fix do CHECK invalido de `colaboradores_lideres` criado em 20261122100001.
--
-- Problema: o CHECK comparava `colaborador_id <> lider_id`, mas esses
-- campos sao chaves de tabelas diferentes (colaboradores.id vs profiles.id)
-- que nunca sao iguais na pratica. Entao a constraint nunca disparava e
-- nao impedia auto-lideranca (o profile do colaborador apontando como
-- lider dele mesmo).
--
-- Fix: remove o CHECK bagunçado e substitui por trigger BEFORE INSERT que
-- faz o lookup de `colaboradores.user_id` e compara com o `lider_id`
-- sendo inserido.
BEGIN;

ALTER TABLE public.colaboradores_lideres
  DROP CONSTRAINT IF EXISTS colaboradores_lideres_check;

CREATE OR REPLACE FUNCTION public.fn_colab_lider_rejeita_auto()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  user_do_colab uuid;
BEGIN
  SELECT user_id INTO user_do_colab
    FROM public.colaboradores WHERE id = NEW.colaborador_id;

  IF user_do_colab IS NOT NULL AND user_do_colab = NEW.lider_id THEN
    RAISE EXCEPTION 'Colaborador não pode ser líder de si mesmo (colaborador_id=%, lider_id=%).',
      NEW.colaborador_id, NEW.lider_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_colab_lider_rejeita_auto
BEFORE INSERT ON public.colaboradores_lideres
FOR EACH ROW
EXECUTE FUNCTION public.fn_colab_lider_rejeita_auto();

COMMIT;
