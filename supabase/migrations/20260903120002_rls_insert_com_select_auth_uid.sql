-- Corrige `auth.uid()` direto em duas policies INSERT antigas (Task 001).
--
-- Advisor `auth_rls_initplan` reportou que `orcamentos_insert` e
-- `versoes_insert` ainda usavam `auth.uid()` no `with check`, o que faz
-- Postgres re-avaliar a funcao por linha. Padrao correto e
-- `(select auth.uid())` — avaliado uma vez por statement.
--
-- Regra H do docs/PERFORMANCE.md, aplicada agora que estamos revendo
-- toda a superficie de RLS na Task 5 do projeto de permissoes.

drop policy if exists orcamentos_insert on public.orcamentos;
create policy orcamentos_insert on public.orcamentos
for insert
with check (
  is_tenant_member(tenant_id)
  and (
    created_by is null
    or created_by = (select auth.uid())
  )
);

drop policy if exists versoes_insert on public.versoes_orcamento;
create policy versoes_insert on public.versoes_orcamento
for insert
with check (
  is_tenant_member(tenant_id)
  and (
    created_by is null
    or created_by = (select auth.uid())
  )
);
