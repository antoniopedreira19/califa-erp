-- ============================================================================
-- Dias/meses do ORÇADO pode ser zero (decisão 109, 27/09/2026)
-- ============================================================================
--
-- Pedido do Tiago em 27/09/2026: o D/M do orçado passa a aceitar zero, como
-- a quantidade já aceita desde 15/09/2026 (decisão 078). Sem trava nenhuma:
-- nem na edição da planilha, nem na importação, nem na aprovação da versão.
-- Quem confere o item com D/M zero é o financeiro, na abertura do job.
--
-- O motivo imediato é a importação: a planilha da agência usa D/M 0 para o
-- item bonificado ("Motion (Bonificado 100%)" = R$ 3.000 × 1 × 0 na
-- planilha da Budweiser). O parser trocava o 0 por 1, porque este CHECK
-- derrubaria o insert — e a versão nascia com R$ 3.000 a mais que o TOTAL
-- da própria planilha.
--
-- O que muda: o CHECK `itens_dias_meses_positivo` (> 0) dá lugar a
-- `itens_dias_meses_nao_negativo` (>= 0), no mesmo desenho do
-- `itens_quantidade_nao_negativa`. Nenhuma linha é tocada: toda linha que
-- existe tem D/M > 0, e o CHECK novo é mais largo que o antigo.
--
-- O que fica de fora, de propósito:
--   - o padrão da coluna segue 1 (item novo nasce com QT 1 e D/M 1);
--   - o D/M do PLANEJADO já aceitava zero (`itens_planejado_dm_nao_negativo`);
--   - a PP continua exigindo D/M > 0 (`pedidos_compra_dias_meses_positivo`):
--     os fatores da PP são do GP, não copiados do orçado;
--   - nenhuma função do banco compara ou divide por dias_meses (conferido em
--     pg_proc em 27/09/2026), então nada abaixo depende do D/M ser positivo.
-- ============================================================================

alter table public.versoes_orcamento_itens
  drop constraint if exists itens_dias_meses_positivo;

alter table public.versoes_orcamento_itens
  drop constraint if exists itens_dias_meses_nao_negativo;

alter table public.versoes_orcamento_itens
  add constraint itens_dias_meses_nao_negativo check (dias_meses_orcado >= 0);
