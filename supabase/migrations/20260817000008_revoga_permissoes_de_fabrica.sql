-- =====================================================================
-- P2 — Revoga as 4 permissões de fábrica de `anon` e `authenticated`
-- =====================================================================
--
-- O QUE ESTA MIGRATION CORRIGE
--
-- Em TODOS os 53 objetos do schema `public` (tabelas e views), os papéis
-- `anon` (visitante SEM login) e `authenticated` (qualquer sessão com
-- login) carregam quatro permissões que ninguém deste projeto concedeu:
--
--   TRUNCATE    esvaziar a tabela inteira, de uma vez
--   TRIGGER     instalar gatilho — código que roda a cada escrita
--   REFERENCES  criar chave estrangeira apontando para a tabela
--   MAINTAIN    rodar manutenção (VACUUM, REINDEX, LOCK TABLE…)
--
-- O `anon` não tem NENHUMA das quatro do dia a dia — não lê, não insere,
-- não altera, não apaga. Sobraram exatamente essas.
--
-- ORIGEM: padrão de fábrica do Supabase para o schema `public`
-- (`pg_default_acl`), herdado por toda tabela criada desde a primeira,
-- em 21/07/2026. NÃO vem de migration deste projeto — a
-- `20260721000003_task001_grants_authenticated.sql` e a
-- `20260725000001_grants_service_role.sql` concedem só o que era
-- pretendido. O que nunca havia sido auditado é o que o Supabase já
-- tinha concedido sozinho, antes de qualquer linha nossa.
--
-- POR QUE O TRUNCATE É O QUE IMPORTA
--
-- A RLS **não protege** contra ele. `DELETE` passa pela policy e só
-- alcança o tenant de quem pede; `TRUNCATE` não é operação de linha, e a
-- policy NEM É CONSULTADA. Esvazia tudo.
--
-- EXPOSIÇÃO PRÁTICA HOJE: BAIXA. A única porta externa é o PostgREST,
-- que só sabe ler/inserir/alterar/apagar linha e chamar RPC — não existe
-- verbo de TRUNCATE nele. Deixa de ser baixa se alguém cadastrar uma RPC
-- que trunque (o `anon` poderia chamá-la), ou se a string de conexão
-- direta vazar.
--
-- POR QUE ISTO NÃO É "CADASTRO DE USUÁRIOS E PERMISSÕES"
--
-- São duas camadas diferentes. `anon` e `authenticated` são papéis do
-- BANCO, não pessoas. As roles do ERP (administrador, financeiro,
-- produção) vivem em `tenant_members`, uma camada acima, e esta
-- migration não encosta nelas.
--
-- IMPACTO NO APP: NENHUM. O sistema não usa nenhum dos quatro verbos em
-- nenhum dos dois papéis. Ler, inserir, alterar e apagar seguem
-- exatamente como estão — nada aqui os toca.
--
-- LADO DESTRUTIVO: é REVOKE (tira permissão), e alcança o banco TODO,
-- inclusive tabelas do módulo da outra frente. Autorizado pelo Tiago em
-- 17/08/2026, que assumiu comunicar o Antonio. Nenhum dado é lido,
-- movido ou apagado.
-- =====================================================================

revoke truncate, trigger, references, maintain
  on all tables in schema public
  from anon, authenticated;

-- Sem esta segunda parte, a PRÓXIMA tabela criada nasce com as quatro de
-- volta — foi exatamente o que aconteceu hoje, quando o número subiu de
-- 49 para 53 objetos com as migrations do dia.
--
-- Vale para objetos criados pelo papel que executa esta migration
-- (`postgres`), que é o do fluxo do MCP. Existe um segundo molde
-- registrado por `supabase_admin`, que só se aplica a tabela criada por
-- AQUELE papel — coisa que o nosso fluxo nunca faz, e que nossa conexão
-- não tem poder para alterar.
alter default privileges in schema public
  revoke truncate, trigger, references, maintain
  on tables from anon, authenticated;

-- CONFERÊNCIA
--
--   with acl as (
--     select c.relname, (aclexplode(c.relacl)).grantee::regrole::text papel,
--            (aclexplode(c.relacl)).privilege_type priv
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--     where n.nspname = 'public' and c.relkind in ('r','v')
--   )
--   select papel, priv, count(distinct relname)
--   from acl where papel in ('anon','authenticated')
--   group by 1,2 order by 1,2;
--
-- Esperado: `anon` some da lista por inteiro; `authenticated` fica só com
-- SELECT, INSERT, UPDATE e DELETE.
