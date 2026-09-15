-- Quantidade orçada zero passa a valer (decisão do Tiago, 15/09/2026; 078).
--
-- Na planilha interna da agência (aba SUL da planilha da Ânima), QT 0 marca o
-- item que fica listado no mês sem ser cobrado — o Gerente de Projeto de
-- janeiro, por exemplo. A regra antiga (`quantidade_orcada > 0`, task 004)
-- obrigava a importação a trocar o 0 por 1, e o orçado do mês saía acima do da
-- própria planilha (R$ 57.727,43 contra R$ 42.727,43 em janeiro).
--
-- O padrão de item novo continua 1: muda só o que o banco aceita.
--
-- A mudança ALARGA a regra: nenhuma linha existente deixa de valer e nada é
-- regravado. Ficam como estão:
--   - `itens_dias_meses_positivo` (D/M > 0) — a resposta foi sobre QT;
--   - `pp_quantidade_positiva` (quantidade da PP) — outro domínio.
-- `total_orcado` é GENERATED (unitário × QT × D/M) e fecha em zero sozinho.

alter table public.versoes_orcamento_itens
  drop constraint if exists itens_quantidade_positiva;

alter table public.versoes_orcamento_itens
  add constraint itens_quantidade_nao_negativa check (quantidade_orcada >= 0);

comment on constraint itens_quantidade_nao_negativa on public.versoes_orcamento_itens is
  'Quantidade orçada zero vale: item listado sem cobrança no mês (planilha interna). Padrão de item novo segue 1. Decisão 078, 15/09/2026.';
