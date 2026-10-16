-- =============================================================================
-- Decisão 176 — só a numeração: o comentário da tabela dizia "Decisão 175"
-- (15/10/2026)
-- =============================================================================
--
-- A migration 20261015300001 (trocar o GP e o Produtor Responsáveis do job
-- aberto) nasceu como decisão 175 e foi aplicada assim. Antes do push, outra
-- sessão já tinha a 175 (a errata que volta a abrir o planejado): a troca dos
-- responsáveis virou a 176. O arquivo da 20261015300001 já diz 176; aqui o
-- banco passa a dizer o mesmo no único lugar em que guardava o número — o
-- comentário da tabela. As funções não citam o número.
--
-- Sem mudança de comportamento, de grant ou de RLS.
-- =============================================================================

comment on table public.jobs_trocas_de_responsavel is
  'Decisão 176: cada troca do GP ou do Produtor Responsável de job aberto. Grava só trocar_responsavel_do_job; a Comunicação do job mostra um card por linha.';
