-- =====================================================================
-- SAVE — quanto do faturamento previsto do job é saldo em save
--
-- POR QUE MATERIALIZAR, e não calcular na view:
--
-- A conta do save é a mesma matriz de alavancas de `REGRAS_TIPO_CUSTO`,
-- que vive em `lib/calculos/versao-totais.ts`. A `vw_fluxo_caixa` precisa
-- do número para dividir a previsão de recebimento entre "recebimento do
-- job" e "recebimento do save" — e escrever a matriz em SQL criaria um
-- SEGUNDO lugar onde ela mora, com os dois divergindo na primeira
-- alteração de tipo de custo.
--
-- `jobs.faturamento_previsto` já resolve isso do mesmo jeito: é espelho
-- denormalizado, escrito pelo TypeScript na abertura e reescrito pela
-- errata. Esta coluna anda colada nele, escrita nas MESMAS três portas:
--
--   1. `abertura-actions.ts`      — quando o job nasce
--   2. `actions-errata.ts`        — quando a errata mexe no orçado
--   3. `save-errata-actions.ts`   — quando a errata mexe no save
--
-- Vale a invariante, garantida por `scripts/conferir-save.ts`:
--   faturamento_previsto = faturamento_save_previsto
--                        + fechamento sobre os custos do job
--
-- Backfill zero: nenhum job existente tem linha em save, então o valor
-- correto para todos eles é o default.
-- =====================================================================

alter table public.jobs
  add column if not exists faturamento_save_previsto numeric(14,2) not null default 0;

comment on column public.jobs.faturamento_save_previsto is
  'Quanto de `faturamento_previsto` é saldo em save: o principal das linhas em save mais os honorários e o imposto proporcionais (decisão 028 §4). Espelho escrito pelo TypeScript, como `faturamento_previsto` — não calcular em SQL.';
