-- Motivo: manter comportamento identico no dia 1 apos criar
-- empresa_members. Todo user existente (menos admin, que sempre bypassa)
-- ganha acesso amplo a todas as empresas ativas do tenant. Admin
-- restringe depois, gradualmente, sem quebrar ninguem.
--
-- Aditivo, idempotente (on conflict do nothing).
--
-- Ver docs/superpowers/specs/2026-09-09-empresa-members-permissoes-design.md

insert into public.empresa_members (
  tenant_id, user_id, empresa_id, regional_id, status, created_by
)
select
  tm.tenant_id,
  tm.user_id,
  e.id,
  null,
  'ativo',
  null
from public.tenant_members tm
join public.empresas e on e.tenant_id = tm.tenant_id and e.ativo = true
where tm.status = 'ativo'
  and tm.role in ('financeiro', 'produtor', 'freelancer', 'gerente_producao')
on conflict on constraint uq_empresa_members do nothing;
