-- =====================================================================
-- Plano de contas — passo 2 (DESTRUTIVO — aprovado pelo usuário)
--
-- Racional:
--   Padroniza codigo do tipo em numérico com 2 dígitos zero-padded
--   ("01".."99"), casando com o padrão de chart of accounts. Isso permite
--   remover `ordem`: código zero-padded ordena naturalmente por texto.
--
--   Justificativa da segurança:
--   - `lancamentos_financeiros` tem 0 linhas neste tenant → rename
--     de código não perde dado.
--   - FKs (`plano_conta_tipo_id`, `plano_conta_subtipo_id`) usam UUID,
--     não código → renomear código não quebra referências.
--
--   Passos:
--   1. Relaxar chk_tipo_codigo_formato pra aceitar ^[0-9]{2}$
--   2. Renomear os 15 tipos alfa → numérico, preservando ordem atual
--   3. Endurecer chk pra permitir SOMENTE ^[0-9]{2}$ (limpa o alfa)
--   4. Marcar subtipo.codigo como NOT NULL (backfill já foi no passo 1)
--   5. Dropar coluna `ordem` em tipos e subtipos
-- =====================================================================

-- 1) Relaxa temporariamente o check pra permitir ambos formatos durante o update
alter table public.plano_contas_tipos
  drop constraint if exists chk_tipo_codigo_formato;

alter table public.plano_contas_tipos
  add constraint chk_tipo_codigo_formato check (codigo ~ '^([A-Z]{2,6}|[0-9]{2})$');

-- 2) Rename dos 15 tipos do tenant California (mapping por ordem atual)
--    Idempotente: só atualiza se ainda estiver com código alfa.
update public.plano_contas_tipos set codigo = '01' where codigo = 'REC';
update public.plano_contas_tipos set codigo = '02' where codigo = 'CO';
update public.plano_contas_tipos set codigo = '03' where codigo = 'CT';
update public.plano_contas_tipos set codigo = '04' where codigo = 'CF';
update public.plano_contas_tipos set codigo = '05' where codigo = 'DP';
update public.plano_contas_tipos set codigo = '06' where codigo = 'DM';
update public.plano_contas_tipos set codigo = '07' where codigo = 'DA';
update public.plano_contas_tipos set codigo = '08' where codigo = 'DC';
update public.plano_contas_tipos set codigo = '09' where codigo = 'DT';
update public.plano_contas_tipos set codigo = '10' where codigo = 'RF';
update public.plano_contas_tipos set codigo = '11' where codigo = 'DJ';
update public.plano_contas_tipos set codigo = '12' where codigo = 'EMP';
update public.plano_contas_tipos set codigo = '13' where codigo = 'IMOB';
update public.plano_contas_tipos set codigo = '14' where codigo = 'PL';
update public.plano_contas_tipos set codigo = '15' where codigo = 'DL';

-- 3) Endurece o check pra permitir SÓ numérico daqui pra frente
alter table public.plano_contas_tipos
  drop constraint chk_tipo_codigo_formato;

alter table public.plano_contas_tipos
  add constraint chk_tipo_codigo_formato check (codigo ~ '^[0-9]{2}$');

-- 4) Subtipo.codigo agora é obrigatório
alter table public.plano_contas_subtipos
  alter column codigo set not null;

-- 5) Dropa coluna ordem
alter table public.plano_contas_tipos     drop column ordem;
alter table public.plano_contas_subtipos  drop column ordem;
