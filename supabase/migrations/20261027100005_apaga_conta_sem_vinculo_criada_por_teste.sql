-- =============================================================================
-- Apaga a conta de login criada por engano em 18/09/2026 num teste
-- =============================================================================
-- Em 18/09/2026, uma sessão do Claude Code testou uma tela entrando sem senha
-- pelo link mágico do Supabase (`generate_link`) e usou o email pessoal do
-- Tiago, o da conta do Claude Code, e não o do ERP. O email não existia, e o
-- Supabase criou uma conta nova (fa61a319-6409-4d02-93c5-8d8be2746673), com
-- perfil mas sem tenant nem empresa: entrou uma vez e caiu em "sem acesso".
-- Não aparece em Usuários, que lista os membros do tenant. Depois, três
-- migrations a usaram como autor de auditoria; a 20261027100004 corrigiu as
-- três para o usuário do Tiago no ERP.
--
-- Mudança DESTRUTIVA (apaga linha), confirmada pelo Tiago em 27/10/2026:
-- "Pode apagar a conta [...] (fa61a319) do banco." Conferido antes: nenhuma
-- linha do sistema aponta para ela além do próprio perfil e do login
-- (nenhum membro de tenant ou empresa, auditoria, arquivo ou sessão). Apagar
-- o usuário do `auth` leva junto, em cascata, o perfil e a identidade.
-- A migration só apaga se ela continuar sem vínculo.
-- =============================================================================

do $$
declare
  c_conta constant uuid := 'fa61a319-6409-4d02-93c5-8d8be2746673';
begin
  if not exists (select 1 from auth.users where id = c_conta) then
    raise notice 'A conta já não existe: nada a fazer.';
    return;
  end if;

  if exists (select 1 from public.tenant_members where user_id = c_conta)
     or exists (select 1 from public.empresa_members where user_id = c_conta)
     or exists (select 1 from public.audit_events where actor_user_id = c_conta)
     or exists (select 1 from storage.objects where owner_id = c_conta::text) then
    raise exception 'A conta % tem vínculo no sistema: não apago.', c_conta;
  end if;

  delete from auth.users where id = c_conta;
end
$$;
