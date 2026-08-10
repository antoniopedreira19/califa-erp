-- =====================================================================
-- Task 013 — Habilita pg_cron (para geração automática de ocorrências
-- de contas avulsas recorrentes).
--
-- Extensão fica no schema `extensions` (padrão Supabase). Chamadas usam
-- `cron.schedule('nome', 'expressão cron UTC', $$sql$$)`.
--
-- IMPORTANTE: cron.schedule usa UTC. A conversão de fuso é feita na
-- expressão: '0 6 * * *' = 06:00 UTC = 03:00 America/Sao_Paulo.
-- =====================================================================

create extension if not exists pg_cron with schema extensions;

grant usage on schema cron to postgres;
