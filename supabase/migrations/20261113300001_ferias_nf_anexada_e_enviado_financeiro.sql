-- Introduz os status `nf_anexada` e `enviado_financeiro` no fluxo de férias
-- e separa duas transições que até agora andavam coladas:
--
--   1) Colaborador anexa NF        ->  status lança 'aprovado'  → 'nf_anexada'
--   2) RH clica "Enviar pro Financeiro"  ->  status lança 'nf_anexada' → 'enviado_financeiro'
--      + folhas_pagamento (tipo ferias) desse lançamento: rascunho → enviada
--
-- Hoje o fluxo colapsava: a view `vw_people_aprovar_financeiro` só mostra
-- folhas em 'enviada', mas `criarFolhasDePagamentoDeFerias` inserem em
-- 'rascunho' e ninguém as empurrava — na prática férias nunca chegavam
-- na aba People do Contas a Pagar. Esta migration é só a fundação (enum
-- values + trigger automático do nf_anexada). A transição manual ficará
-- na server action `enviarProFinanceiro`, que escreve `enviado_financeiro`
-- no lançamento e `enviada` nas folhas num só UPDATE guardado por RLS.
--
-- `aguardando_financeiro` (valor morto no enum desde 20261026700007)
-- continua existindo pra não precisar fazer DROP+recreate do enum. Nada
-- escreve mais nele.
--
-- Checado antes: SELECT status, count(*) mostra 0 linhas em
-- aguardando_financeiro, 1 em aprovado, 398 em concluido. Sem backfill.

-- ============================================================
-- 1. Enum: 2 valores novos
-- ============================================================
ALTER TYPE ferias_lancamento_status ADD VALUE IF NOT EXISTS 'nf_anexada' AFTER 'aprovado';
ALTER TYPE ferias_lancamento_status ADD VALUE IF NOT EXISTS 'enviado_financeiro' AFTER 'nf_anexada';

-- ============================================================
-- 2. Trigger: NF anexada → status = nf_anexada (automático)
-- ============================================================
-- Quando o colaborador (ou o RH em nome dele) faz upload de NF pra
-- um lançamento de férias que está em 'aprovado', o status do
-- lançamento vira 'nf_anexada'. Reversível: se a NF for apagada
-- antes do envio pro financeiro, volta pra 'aprovado'.

CREATE OR REPLACE FUNCTION public.fn_sincroniza_status_lanc_por_nf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- INSERT ou UPDATE que CRIA anexo ferias: tenta subir pra nf_anexada.
  -- Só promove se o lançamento ainda está em 'aprovado' — se já está
  -- em 'enviado_financeiro' ou 'concluido' não retroage (anexar uma
  -- segunda NF ou substituir a primeira não reverte o fluxo).
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE')
     AND NEW.escopo_tipo IN ('ferias_usufruto', 'ferias_abono')
     AND NEW.escopo_id IS NOT NULL
  THEN
    UPDATE public.colaboradores_ferias_lancamentos
       SET status = 'nf_anexada'
     WHERE id = NEW.escopo_id
       AND status = 'aprovado';
  END IF;

  -- DELETE de anexo: se o lançamento está em 'nf_anexada' e não
  -- sobra nenhuma NF, volta pra 'aprovado'. Não mexe em quem já
  -- passou pra 'enviado_financeiro' (financeiro já pegou — RH
  -- precisa reverter manualmente, com audit).
  IF TG_OP = 'DELETE'
     AND OLD.escopo_tipo IN ('ferias_usufruto', 'ferias_abono')
     AND OLD.escopo_id IS NOT NULL
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.colaboradores_nf_anexos
       WHERE escopo_tipo = OLD.escopo_tipo
         AND escopo_id   = OLD.escopo_id
         AND id <> OLD.id
    ) THEN
      UPDATE public.colaboradores_ferias_lancamentos
         SET status = 'aprovado'
       WHERE id = OLD.escopo_id
         AND status = 'nf_anexada';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_nf_anexo_sincroniza_lanc ON public.colaboradores_nf_anexos;

CREATE TRIGGER trg_nf_anexo_sincroniza_lanc
AFTER INSERT OR UPDATE OR DELETE ON public.colaboradores_nf_anexos
FOR EACH ROW
EXECUTE FUNCTION public.fn_sincroniza_status_lanc_por_nf();

COMMENT ON FUNCTION public.fn_sincroniza_status_lanc_por_nf() IS
  'Mantém colaboradores_ferias_lancamentos.status sincronizado com a presença de NF. INSERT/UPDATE anexo ferias_* + lanc em aprovado → nf_anexada. DELETE anexo + lanc em nf_anexada sem outras NFs → volta pra aprovado. Não retroage em lancs já em enviado_financeiro ou concluido.';
