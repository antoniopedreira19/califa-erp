-- =============================================================
-- Remove subsistema de notificações de férias (2026-10-03)
--
-- Decisão de produto: as notificações de férias eram desorganizadas
-- (fanout a todos admins/RHs criando ruído no card operacional,
-- misturadas no mesmo lugar que notificações pessoais do /perfil).
-- Vamos substituir por um **hub central de notificações multi-módulo**
-- numa feature futura, que separa escopo (pessoal vs operacional) e
-- cobre também financeiro, jobs, orçamentos.
--
-- Esta migration apaga TUDO relacionado a notificações de férias:
--  - Job pg_cron de alertas diários
--  - Funções de notificação e rotina
--  - Policies RLS específicas
--  - Tabela colaboradores_ferias_notificacoes (CASCADE drops indexes)
--  - Enum ferias_notificacao_tipo
--
-- Preservado (usado por rescisões):
--  - fn_calcular_meses_rescisao
--
-- A doc em `docs/modulos/rh/40-hub-notificacoes-pendencia.md` registra
-- o plano futuro.
-- =============================================================

-- 1) Desagenda o job de pg_cron primeiro (antes de dropar a função
-- que ele chama). unschedule ignora job inexistente.
do $$
begin
  perform cron.unschedule('ferias_rotina_diaria');
exception when others then
  -- Se pg_cron não estiver instalado ou job não existir, segue.
  null;
end$$;

-- 2) Dropa a tabela CASCADE — leva junto índices e policies.
drop table if exists public.colaboradores_ferias_notificacoes cascade;

-- 3) Dropa as funções (ordem reversa de dependência).
drop function if exists public.fn_rotina_diaria_ferias();
drop function if exists public.fn_destinatarios_ferias(uuid, uuid, boolean, boolean, boolean);
drop function if exists public.fn_criar_notificacao_ferias(
  uuid, public.ferias_notificacao_tipo, uuid, uuid[], text, text, jsonb, uuid, uuid
);

-- 4) Dropa o enum (nenhuma coluna mais usa).
drop type if exists public.ferias_notificacao_tipo;
