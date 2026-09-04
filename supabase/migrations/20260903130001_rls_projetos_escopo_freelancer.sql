-- Fecha buraco descoberto na Task 6: `projetos` estava fora da
-- migration `20260903120001_rls_papeis_e_escopo_freelancer.sql`. Sem
-- essa policy, o Freelancer via a lista de projetos inteira (18) mesmo
-- estando so em um.
--
-- Reaplica o padrao ja usado nas outras 14 tabelas operacionais.

drop policy if exists projetos_select on public.projetos;
create policy projetos_select on public.projetos
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or is_freelancer_do_projeto(id)
  )
);

drop policy if exists projetos_update on public.projetos;
create policy projetos_update on public.projetos
for update
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or is_freelancer_do_projeto(id)
  )
)
with check (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or is_freelancer_do_projeto(id)
  )
);
