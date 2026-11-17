-- Lista do extrato da Conciliação: a coluna "conciliada" procura pelo índice, linha a linha.
--
-- Diagnóstico (16/11/2026, depois da 20261116990001):
--   * A lista da Conciliação (vw_extrato_linhas filtrada por conta, com
--     "conciliada is false or data no período") levava ~210 ms sozinha e média de
--     0,95 s sob carga, com picos de 3,1 s.
--   * A coluna era EXISTS(lancamentos) OR EXISTS(historico_movimentos). EXISTS
--     dentro de OR não vira semi-join, e o Postgres escolhia a forma "hashed
--     SubPlan": varria os 70 mil movimentos do histórico inteiros (~83 ms) DUAS
--     vezes por consulta (uma no filtro, outra na coluna), mesmo existindo o índice
--     parcial idx_historico_movimentos_extrato_linha.
--
-- A troca: cada EXISTS vira uma subconsulta escalar com LIMIT 1. Subconsulta
-- escalar não tem forma "hashed", então o Postgres consulta o índice só para as
-- linhas do extrato que a tela pede (idx_lancamentos_extrato_linha e
-- idx_historico_movimentos_extrato_linha, os dois parciais em extrato_linha_id).
--
-- O resultado NÃO muda:
--   * "existe pelo menos uma linha" = "a primeira linha devolve true"; coalesce
--     leva o "nenhuma" a false, como o EXISTS. A coluna continua boolean e nunca
--     nula.
--   * A view continua security_invoker: as duas subconsultas seguem passando pelo
--     RLS de quem consulta, como antes.
--   * Conferido antes de aplicar, como cada um dos 14 usuários de teste (um por
--     papel e situação, nos dois tenants): 8.072 linhas de extrato visíveis,
--     6.470 conciliadas nas duas formas, zero divergências.
--   * Colunas, ordem, tipos e permissões iguais (create or replace view mantém o
--     GRANT; o security_invoker vai repetido porque o replace troca as opções).
--
-- Medido com o usuário administrador e com o do financeiro:
--   lista da Conciliação (1.000 linhas)     209–215 ms -> 35–39 ms
--   pendentes dos Mútuos (511 linhas)            154 ms -> 41 ms
--   contagem do tenant / de uma importação       47 / 23 ms -> iguais
--   uma linha só (ações da conciliação)            4 ms -> igual

set local lock_timeout = '5s';

create or replace view public.vw_extrato_linhas
with (security_invoker = true) as
select
  l.id,
  l.tenant_id,
  l.conta_bancaria_id,
  l.importacao_id,
  l.digital,
  l.data,
  l.valor,
  l.tipo,
  l.historico,
  l.documento,
  l.fitid,
  l.ordem,
  l.ignorada_em,
  l.ignorada_por,
  l.motivo_ignorada,
  l.resolvida_sozinha,
  l.avaliada_em,
  l.sem_auto,
  l.created_at,
  l.conciliada_como,
  l.conciliada_em,
  l.conciliada_por,
  l.desfazer,
  l.grupo,
  coalesce((select true from public.lancamentos_financeiros f where f.extrato_linha_id = l.id limit 1), false)
    or coalesce((select true from public.historico_movimentos h where h.extrato_linha_id = l.id limit 1), false)
    as conciliada
from public.extrato_linhas l;
