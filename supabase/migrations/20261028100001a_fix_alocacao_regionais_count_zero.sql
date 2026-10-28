-- =====================================================================
-- Fix: enforce_alocacao_item_regionais_soma_100 agora rejeita count=0
-- =====================================================================
--
-- PROBLEMA (encontrado em code review, fix round 1)
--
-- A versão anterior do trigger só validava quando v_soma > 0:
--
--   IF v_soma > 0 AND abs(v_soma - 100.00) >= 0.01 THEN RAISE ...
--
-- Isso deixava passar o estado inválido: item com usa_rateio_empresa = false
-- sem nenhuma regional na tabela filha (count = 0, soma = 0 via COALESCE).
-- Spec exige: quando usa_rateio_empresa = false, deve existir pelo menos
-- 1 regional e a soma deve ser exatamente 100.
--
-- FIX A: substituir v_soma > 0 por v_count = 0 OR abs(v_soma-100) >= 0.01
-- no trigger existente em colaboradores_alocacoes_itens_regionais.
-- Cobre: INSERT de regional que resulta em soma errada; DELETE de regional
-- que deixa count=0 ou soma != 100.
--
-- FIX B (novo): adicionar trigger em colaboradores_alocacoes_itens que
-- verifica regionais ao inserir/atualizar o item com usa_rateio_empresa=false.
-- Cobre: INSERT de item com usa_rateio_empresa=false sem nenhuma regional
-- (o trigger de regionais nunca dispara nesse path, pois nenhuma linha de
-- regional é tocada).
--
-- Quando usa_rateio_empresa = true, ambos os triggers retornam NULL sem
-- validar (lista vazia é válida; outro trigger bloqueia insert de regional).
-- =====================================================================

-- ---------------------------------------------------------------------
-- FIX A: CREATE OR REPLACE da função que verifica regionais
-- Agora usa COUNT(*) além de SUM para rejeitar count=0
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_alocacao_item_regionais_soma_100()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item_id    uuid;
  v_usa_rateio boolean;
  v_count      integer;
  v_soma       numeric(10,2);
BEGIN
  v_item_id := COALESCE(NEW.alocacao_item_id, OLD.alocacao_item_id);

  -- Verificar flag do item pai
  SELECT usa_rateio_empresa INTO v_usa_rateio
  FROM public.colaboradores_alocacoes_itens
  WHERE id = v_item_id;

  -- Se usa rateio padrão, lista de regionais deve estar vazia (outro trigger
  -- bloqueia insert), então aqui não há nada pra validar
  IF v_usa_rateio IS TRUE THEN
    RETURN NULL;
  END IF;

  -- Quando usa_rateio_empresa = false: deve haver regionais somando 100
  SELECT COUNT(*), COALESCE(SUM(percentual_regional), 0)
    INTO v_count, v_soma
  FROM public.colaboradores_alocacoes_itens_regionais
  WHERE alocacao_item_id = v_item_id;

  IF v_count = 0 OR abs(v_soma - 100.00) >= 0.01 THEN
    RAISE EXCEPTION
      'enforce_alocacao_item_regionais_soma_100: item % tem % regionais com soma = %; quando usa_rateio_empresa = false deve haver pelo menos 1 regional e a soma deve ser exatamente 100.',
      v_item_id, v_count, v_soma
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.enforce_alocacao_item_regionais_soma_100() IS
  'Valida que, quando usa_rateio_empresa = false, o item possui pelo menos 1 regional com soma de percentual_regional = 100. Quando usa_rateio_empresa = true, ignora (lista deve estar vazia). Fix round 1: antes aceitava count=0 silenciosamente.';

-- ---------------------------------------------------------------------
-- FIX B: novo trigger em colaboradores_alocacoes_itens
-- Cobre o path onde o item é inserido com usa_rateio_empresa=false mas
-- nenhuma regional existe ainda — o trigger de regionais nunca dispararia.
-- É DEFERRABLE INITIALLY DEFERRED para permitir inserir item + regionais
-- na mesma transação (mesma janela que o trigger original de regionais).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_alocacao_item_regionais_nao_vazia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
  v_soma  numeric(10,2);
BEGIN
  -- Só valida quando usa_rateio_empresa = false
  IF NEW.usa_rateio_empresa IS TRUE OR NEW.usa_rateio_empresa IS NULL THEN
    RETURN NULL;
  END IF;

  -- Verifica se há regionais somando 100 para este item
  SELECT COUNT(*), COALESCE(SUM(percentual_regional), 0)
    INTO v_count, v_soma
  FROM public.colaboradores_alocacoes_itens_regionais
  WHERE alocacao_item_id = NEW.id;

  IF v_count = 0 OR abs(v_soma - 100.00) >= 0.01 THEN
    RAISE EXCEPTION
      'enforce_alocacao_item_regionais_nao_vazia: item % (empresa %) tem % regionais com soma = %; quando usa_rateio_empresa = false deve haver pelo menos 1 regional e a soma deve ser exatamente 100.',
      NEW.id, NEW.empresa_id, v_count, v_soma
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.enforce_alocacao_item_regionais_nao_vazia() IS
  'Valida que, ao inserir ou atualizar um item com usa_rateio_empresa = false, já existem regionais somando 100. Complementa enforce_alocacao_item_regionais_soma_100 que só dispara quando uma regional é tocada. DEFERRABLE INITIALLY DEFERRED para permitir inserir item + regionais na mesma transação.';

REVOKE EXECUTE ON FUNCTION public.enforce_alocacao_item_regionais_nao_vazia()
  FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_alocacao_item_regionais_nao_vazia
  ON public.colaboradores_alocacoes_itens;

CREATE CONSTRAINT TRIGGER trg_alocacao_item_regionais_nao_vazia
  AFTER INSERT OR UPDATE OF usa_rateio_empresa
  ON public.colaboradores_alocacoes_itens
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_alocacao_item_regionais_nao_vazia();
