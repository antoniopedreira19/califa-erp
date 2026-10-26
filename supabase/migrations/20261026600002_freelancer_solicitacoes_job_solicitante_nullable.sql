-- A re-migração do AgCaliforniaRH (26/10/2026) trouxe 40 solicitações. Duas
-- condições do schema original estavam travando a importação:
--
-- 1. job_id NOT NULL: as solicitações antigas guardavam só `nome_job` (texto)
--    e apontavam pra jobs do RH antigo (342 linhas) que não existem no ERP.
--    O texto preservado está em `freelancer_solicitacoes.nome_job` (adicionado
--    na migration anterior). job_id vira opcional.
--
-- 2. solicitante_id NOT NULL: 1 solicitação do RH antigo foi criada pelo perfil
--    de teste `gpteste@teste.com`, que não existe no ERP. A regra do negócio
--    não exige solicitante (ex: solicitações cadastradas por script, auditoria
--    perdida). O gate real de quem pode criar ou aprovar está nas Server Actions
--    e nas policies RLS, não neste NOT NULL.
--
-- Mudança aditiva: nenhuma linha existente é afetada, as 40 recém-importadas
-- passam a caber.
alter table public.freelancer_solicitacoes
  alter column job_id drop not null,
  alter column solicitante_id drop not null;
