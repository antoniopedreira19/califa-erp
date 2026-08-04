-- =====================================================================
-- Realtime na thread de Comunicação.
--
-- Só `jobs_mensagens` entra na publicação: é a única tabela onde duas
-- pessoas escrevem ao mesmo tempo. Erratas e abertura chegam junto no
-- refresh disparado pelo evento, porque a thread é montada no servidor.
--
-- O RLS continua valendo no canal: o Realtime do Supabase aplica as
-- policies da tabela, então ninguém recebe mensagem de outro tenant.
-- =====================================================================

alter publication supabase_realtime add table public.jobs_mensagens;

-- REPLICA IDENTITY FULL não é necessário: o payload de INSERT já traz a
-- row inteira, e é só de INSERT que o chat depende.
