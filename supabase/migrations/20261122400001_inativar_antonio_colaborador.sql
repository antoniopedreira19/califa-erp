-- Inativa o colaborador Antonio Pedreira (id 13357bec-...) e remove ele
-- como lider dos 6 colaboradores que estavam na fila de ferias.
--
-- Antonio foi adicionado como segundo lider dos 6 em 20261122200001 pra
-- testar o fluxo. Teste concluido; reverte agora + inativa o colab (que
-- nasceu como placeholder, 0 folhas, 0 ferias).
--
-- Importante: NAO toca no Auth (`profiles.id` ba2e2ba1-...) — esse profile
-- continua logando como administrador do sistema. Apenas o REGISTRO de
-- colaborador vira inativo.
BEGIN;

-- 1. Remove como lider dos 6 colabs do teste
DELETE FROM public.colaboradores_lideres
 WHERE lider_id = 'ba2e2ba1-1ba0-4e3d-99de-5d9d89877381'::uuid;

-- 2. Marca colaborador como inativo
UPDATE public.colaboradores
   SET status = 'inativo',
       data_encerramento = CURRENT_DATE
 WHERE id = '13357bec-a60c-4820-a49e-8396c89a3de5'::uuid
   AND tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid
   AND status = 'ativo';

-- 3. Trava: ambas as condicoes bateram
DO $$
DECLARE
  ainda_lidera INT;
  colab_inativo BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO ainda_lidera
    FROM public.colaboradores_lideres
   WHERE lider_id = 'ba2e2ba1-1ba0-4e3d-99de-5d9d89877381'::uuid;

  SELECT (status = 'inativo') INTO colab_inativo
    FROM public.colaboradores
   WHERE id = '13357bec-a60c-4820-a49e-8396c89a3de5'::uuid;

  IF ainda_lidera <> 0 THEN
    RAISE EXCEPTION 'Antonio ainda lidera % colaboradores (esperava 0)', ainda_lidera;
  END IF;

  IF NOT colab_inativo THEN
    RAISE EXCEPTION 'Colaborador Antonio nao ficou inativo';
  END IF;
END$$;

COMMIT;
