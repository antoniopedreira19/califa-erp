-- RH e financeiro passam a ler tenant_members do proprio tenant.
--
-- Policy antiga `tenant_members_select` so deixa o proprio user OU admin ler.
-- RH operacionalmente precisa listar quem e membro do tenant (ex: dialog de
-- transferir responsavel de freelancer, atribuir responsavel em novo cadastro).
-- Financeiro mesma coisa (pode transferir responsavel em alguns fluxos).
--
-- Mudanca aditiva: policy nova PERMISSIVE pra SELECT. Policies permissivas
-- sao ORed — nada do que ja funciona para.

create policy "tenant_members_select_rh_financeiro"
on public.tenant_members
for select
to authenticated
using (
  is_tenant_rh(tenant_id)
  or is_tenant_financeiro(tenant_id)
);
