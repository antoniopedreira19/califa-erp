-- 20260821000004 — permitir DELETE em versoes_orcamento
--
-- Contexto: o botão "Cancelar versão" virou "Deletar versão" em 21/08/2026
-- (decisão 023). Cancelar era um UPDATE de status, e a tabela nunca precisou
-- de DELETE: `versoes_orcamento` tem policy de SELECT, INSERT e UPDATE, e
-- GRANT correspondente, mas nada de DELETE — enquanto `..._grupos` e
-- `..._itens`, que sempre foram apagáveis pela tela, têm os dois.
--
-- Sem isto a nova action falha com "permission denied for table
-- versoes_orcamento", que é o GRANT faltando (não a policy — a policy
-- ausente daria 0 linhas afetadas, em silêncio).
--
-- Mudança ADITIVA: um GRANT e uma policy. Nada é apagado nem alterado.
--
-- A policy usa `is_tenant_member(tenant_id)`, igual às vizinhas
-- (`versoes_update`, `grupos_delete`) — a função já resolve a sessão pelo
-- caminho cacheado, então não há `auth.uid()` solto por linha.
--
-- Quem pode deletar O QUÊ é decidido na server action `deletarVersao`:
-- versão aprovada, versão que virou job e a última versão do orçamento são
-- recusadas lá. Aqui embaixo fica só a fronteira de tenant, que é o papel do
-- RLS. As travas de negócio no servidor continuam sendo o que vale — a tela
-- só esconde o botão.

grant delete on table public.versoes_orcamento to authenticated;

drop policy if exists versoes_delete on public.versoes_orcamento;

create policy versoes_delete
  on public.versoes_orcamento
  for delete
  to authenticated
  using (is_tenant_member(tenant_id));
