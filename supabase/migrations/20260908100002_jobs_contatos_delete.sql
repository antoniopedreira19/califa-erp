-- 20260908100002 — `jobs_contatos` passa a aceitar DELETE
--
-- Decisão 057 (docs/decisions/057-rejeicao-e-cancelamento-do-envio-a-abertura.md).
--
-- A tabela nasceu em 20260817000001 sem grant nem policy de DELETE, de
-- propósito: "a tela de edição de contatos, quando existir, adiciona o
-- grant e a policy de delete". A tela chegou por outro caminho — o
-- reenvio do job devolvido refaz o formulário de abertura inteiro, e os
-- contatos de cobrança são substituídos pelos da tela: apaga os do envio
-- anterior e grava os novos. Sem isto o reenvio parava em "permission
-- denied for table jobs_contatos" (visto no primeiro teste, 08/09/2026).
--
-- Mesmo predicado das policies irmãs (`is_tenant_member`), para as quatro
-- operações lerem a mesma regra.

drop policy if exists jobs_contatos_delete on public.jobs_contatos;
create policy jobs_contatos_delete on public.jobs_contatos
  for delete to authenticated
  using (public.is_tenant_member(tenant_id));

grant delete on public.jobs_contatos to authenticated;
