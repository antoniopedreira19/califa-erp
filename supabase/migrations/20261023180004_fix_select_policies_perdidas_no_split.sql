-- Fix da regressão da migration 20261023180002: o DO block que quebrou
-- policies FOR ALL em INSERT + UPDATE + DELETE perdeu a cobertura de
-- SELECT que a policy FOR ALL fazia implicitamente. 5 tabelas ficaram
-- sem NENHUMA policy FOR SELECT:
--
--   - pedidos_compra_a_emitir_anexos  (causou a falha reportada por Sofia
--     ao tentar anexar NF: o SELECT dos anexos atuais retornava vazio
--     silenciosamente, confundindo o sincronizador)
--   - decimo_terceiro_adiantamentos
--   - decimo_terceiro_folhas
--   - decimo_terceiro_linhas
--   - fiscal_receitas_anteriores
--
-- Para cada uma, recria a policy FOR SELECT com o mesmo qual do
-- `_update` (que é equivalente ao qual original da FOR ALL).

-- pedidos_compra_a_emitir_anexos: acesso é o da PP a emitir (EXISTS
-- no pai carrega o RLS da PP a emitir — ver 20261007300002_pp_a_emitir).
create policy ppae_anexos_all_select on public.pedidos_compra_a_emitir_anexos
  as permissive for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and exists (
      select 1 from public.pedidos_compra_a_emitir p
      where p.id = pedidos_compra_a_emitir_anexos.a_emitir_id
    )
  );

-- Décimo terceiro: admin + rh (como estava na FOR ALL original).
create policy decimo_terceiro_adiantamentos_rh_admin_all_select
  on public.decimo_terceiro_adiantamentos
  as permissive for select to authenticated
  using (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id));

create policy decimo_terceiro_folhas_rh_admin_all_select
  on public.decimo_terceiro_folhas
  as permissive for select to authenticated
  using (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id));

create policy decimo_terceiro_linhas_rh_admin_all_select
  on public.decimo_terceiro_linhas
  as permissive for select to authenticated
  using (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id));

-- Fiscal: admin + financeiro no tenant.
create policy fiscal_receitas_anteriores_modify_select
  on public.fiscal_receitas_anteriores
  as permissive for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (is_tenant_admin(tenant_id) or is_tenant_financeiro(tenant_id))
  );
