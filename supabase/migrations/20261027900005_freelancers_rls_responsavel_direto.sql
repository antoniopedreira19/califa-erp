-- Policy nova pra GP/produtor ler freelas onde ele é responsavel direto
-- (via `freelancers.responsavel_id`, independente de ter contrato).
--
-- Soma com a policy `freelancers_select_responsavel_contrato` (criada em
-- 20261027900001) que permite ler via contrato. Policies permissivas são
-- ORed — então o GP vê o freela se é dono (freelancers.responsavel_id) OU
-- se tem contrato onde é responsavel. Isso evita "sumir" freela quando o
-- contrato encerra ou é transferido.
--
-- Performance: filtra por `freelancers.responsavel_id`, que tem index
-- (idx_freelancers_responsavel criado em 20261027900003). (select auth.uid())
-- segue o padrão initplan.

create policy "freelancers_select_responsavel_direto"
on public.freelancers
for select
to authenticated
using (
  responsavel_id = (select auth.uid())
);
