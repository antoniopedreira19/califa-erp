-- =====================================================================
-- Rateio regional: escrita só pra admin, leitura pra admin + rh
-- =====================================================================
--
-- Decisão em 2026-09-23: a gestão do rateio anual por regional é regra
-- de negócio configurada pelo admin (fica em /admin/rateios-regionais).
-- RH puro (role='rh') continua lendo pra oferecer/mostrar o toggle no
-- cadastro do colaborador, mas não edita.
--
-- Aditivo do lado do banco (a UI já é gate admin via requireAdmin).
-- =====================================================================

drop policy if exists "rateios insert" on public.empresas_rateios_regionais;
drop policy if exists "rateios update" on public.empresas_rateios_regionais;
drop policy if exists "rateios delete" on public.empresas_rateios_regionais;

create policy "rateios insert" on public.empresas_rateios_regionais
  for insert to authenticated
  with check (is_tenant_admin(tenant_id));

create policy "rateios update" on public.empresas_rateios_regionais
  for update to authenticated
  using (is_tenant_admin(tenant_id))
  with check (is_tenant_admin(tenant_id));

create policy "rateios delete" on public.empresas_rateios_regionais
  for delete to authenticated
  using (is_tenant_admin(tenant_id));
