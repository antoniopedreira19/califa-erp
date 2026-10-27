-- Permite que GP/produtor leia os freelancer_contratos nos quais ele é o
-- responsavel. Espelha a policy aditiva criada hoje em `freelancers`
-- (20261027900001_freelancers_rls_gp_responsavel_le.sql).
--
-- Contexto: em 21/10 (20261021000005_fechar_rls_freelancers_e_buckets.sql)
-- fechamos SELECT de `freelancer_contratos` pra admin+rh+financeiro pra tapar
-- vazamento de PII. A policy nova de hoje reabriu `freelancers` pro GP via
-- EXISTS em contratos, mas esqueceu de espelhar aqui. Como a view
-- `freelancers_com_status` é `security_invoker=true` e usa left join em
-- freelancer_contratos pra puxar responsavel_id/cargo/data_termino, o join
-- vinha vazio pro GP e `.eq("responsavel_id", profile.id)` em
-- app/(app)/freelancers/lista/page.tsx descartava 100% das linhas. Resultado:
-- Carol (GP) via 0 freelancers na lista, mesmo tendo 4 com ela como RESP.
--
-- Mudança aditiva: nova policy PERMISSIVE pra SELECT. Policies permissivas
-- são ORed, então nenhum acesso existente é removido. GP só vê contratos
-- onde ele mesmo é responsavel — a PII dos demais continua restrita a
-- admin+rh+financeiro.
--
-- Performance: filtra por responsavel_id, que já tem index
-- (idx_freelancer_contratos_responsavel). O (select auth.uid()) segue o
-- padrão initplan documentado em docs/PERFORMANCE.md.
create policy "freelancer_contratos_select_responsavel"
on public.freelancer_contratos
for select
to authenticated
using (
  responsavel_id = (select auth.uid())
);
