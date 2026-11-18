-- =====================================================================
-- Adiantamento de 13º: colaborador híbrido ganha destino da parte
-- =====================================================================
--
-- POR QUE
--
-- Pro colaborador híbrido (clt_recibo), o adiantamento de 13º hoje é
-- sempre rateado proporcional entre a parte CLT e a parte PJ, usando
-- `(salario - valor_recibo) / salario`. Decisão do dia a dia (RH):
-- em alguns adiantamentos o colaborador quer receber só pela parte CLT
-- (ou só pela parte PJ — às vezes porque o recibo não sai no mês, ou
-- por preferência do colaborador). Hoje o sistema não oferece essa
-- escolha.
--
-- O QUE
--
-- Nova coluna `destino` no enum de 3 valores:
--   - 'ambos' (default, comportamento atual: split proporcional)
--   - 'clt'   (todo o valor adiantado vai pra parte CLT)
--   - 'pj'    (todo o valor adiantado vai pra parte PJ)
--
-- Tipo de contratação não-híbrido ignora o destino (sempre vira a única
-- folha correspondente).
--
-- Backfill:
--   - Linhas existentes ficam com destino='ambos' (default) — preserva
--     o comportamento anterior.
--
-- Downstream:
--   - `montarFolhasAdiantamento` (TS) passa a aceitar destino e gera
--     1 folha (CLT ou PJ) quando o destino é específico.
--   - `calcularLinhaDecimoTerceiro` (TS) passa a aceitar o split
--     explícito por parte, pra o abatimento da 1ª parcela respeitar o
--     destino escolhido em cada adiantamento.
-- =====================================================================

ALTER TABLE public.decimo_terceiro_adiantamentos
  ADD COLUMN destino text NOT NULL DEFAULT 'ambos'
    CHECK (destino IN ('ambos', 'clt', 'pj'));

COMMENT ON COLUMN public.decimo_terceiro_adiantamentos.destino IS
  'Pro colaborador híbrido (clt_recibo), qual parte do 13º o adiantamento quita: '
  'ambos (rateio proporcional), clt (só a parte CLT), pj (só a parte PJ). '
  'Ignorado para CLT puro, PJ e MEI (não há split).';
