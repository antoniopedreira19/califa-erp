-- =====================================================================
-- A errata passa a corrigir o PLANEJADO junto com o orçado — e o
-- histórico guarda os dois lados dele.
--
-- Até aqui a errata só escrevia no bloco ORÇADO. O planejado da linha
-- corrigida ficava como veio da versão aprovada (ou zerado, na linha
-- nova), e quem precisava ajustá-lo não tinha caminho: a planilha do job
-- não tem edição de planejado fora da errata.
--
-- Regra do Tiago (07/09/2026, decisão 054): na errata o planejado da
-- linha só abre quando o ORÇADO dela também mudou — linha nova (que é
-- orçado novo por definição) ou linha existente com R$ Unit., QT ou D/M
-- do orçado alterados. Em `A` e `D` o trigger `planejado_espelha_orcado`
-- continua mandando: o planejado segue o orçado e a tela não abre a
-- célula. Na linha vermelha e na linha em save, idem (zero, cobrado pelo
-- banco).
--
-- `jobs_erratas_itens` ganha a fotografia do planejado de cada linha,
-- pelo mesmo motivo das colunas do orçado: a errata é histórico, e um
-- planejado que mudou sem registro seria um número que ninguém explica
-- depois. Todas nulas: as erratas anteriores a esta migration não
-- tocavam o planejado e não têm o que preencher — a tela mostra
-- travessão, não inventa número.
--
-- Tudo aditivo. Nenhuma linha existente é alterada.
-- =====================================================================

alter table public.jobs_erratas_itens
  add column if not exists valor_unitario_planejado_de numeric,
  add column if not exists valor_unitario_planejado_para numeric,
  add column if not exists quantidade_planejada_de numeric,
  add column if not exists quantidade_planejada_para numeric,
  add column if not exists dias_meses_planejado_de numeric,
  add column if not exists dias_meses_planejado_para numeric,
  add column if not exists total_planejado_de numeric,
  add column if not exists total_planejado_para numeric;

comment on column public.jobs_erratas_itens.valor_unitario_planejado_de is
  'R$ Unit. do PLANEJADO antes da errata. Nulo nas erratas anteriores a 07/09/2026, quando a errata não tocava o planejado.';
comment on column public.jobs_erratas_itens.valor_unitario_planejado_para is
  'R$ Unit. do PLANEJADO depois da errata. Em A e D é o espelho do orçado (trigger planejado_espelha_orcado).';
comment on column public.jobs_erratas_itens.total_planejado_de is
  'Total planejado da linha antes da errata (unitário × QT × D/M). Nulo nas erratas anteriores a 07/09/2026.';
comment on column public.jobs_erratas_itens.total_planejado_para is
  'Total planejado da linha depois da errata. Só difere do "de" quando o orçado da linha também mudou (decisão 054).';

-- Permissões — a tabela já as tinha; repetir é o padrão de toda migration
-- deste projeto. Nada para `anon`.
grant select, insert, update, delete on public.jobs_erratas_itens to authenticated;
