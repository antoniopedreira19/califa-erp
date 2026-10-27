-- Permite que GP/produtor leia os freelancers dos quais é responsavel em
-- qualquer contrato (ativo ou encerrado). Antes só admin/rh/financeiro liam
-- a tabela, o que bloqueava a lista /freelancers pra o próprio GP ver os
-- freelas que ele mesmo gerencia.
--
-- Mudança aditiva: adiciona uma segunda policy PERMISSIVE pra SELECT. Policies
-- permissivas são ORed, então nenhum acesso existente é removido. Admin/RH/
-- financeiro continuam vendo tudo pela policy antiga `freelancers_select`.
--
-- Performance: o EXISTS filtra por responsavel_id (já existe o index
-- idx_freelancer_contratos_responsavel) + tenant_id + freelancer_id (FK). O
-- (select auth.uid()) segue o padrão initplan documentado em docs/PERFORMANCE.md.
create policy "freelancers_select_responsavel_contrato"
on public.freelancers
for select
to authenticated
using (
  exists (
    select 1
    from public.freelancer_contratos fc
    where fc.freelancer_id = freelancers.id
      and fc.tenant_id = freelancers.tenant_id
      and fc.responsavel_id = (select auth.uid())
  )
);
