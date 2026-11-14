-- Prepara o tenant Agência California para importar 15.18.xlsx
-- (gozos muito antigos: aquisitivos 1516, 1617, 1718 — fecha a ponta
-- que FeriasPendencias e 21.22.23 não cobriam).
--
-- Mesma técnica: backup + desabilita trigger.

begin;

do $$
declare v_nome text;
begin
  select nome into v_nome from public.tenants where id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  if v_nome is null then raise exception 'Tenant não encontrado. Abortando.'; end if;
  if v_nome <> 'Agência California' then raise exception 'Tenant alvo errado: %', v_nome; end if;
end $$;

create table if not exists public._backup_20261114300_califa_ferias_lancamentos as
  select * from public.colaboradores_ferias_lancamentos
   where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';

alter table public.colaboradores_ferias_lancamentos
  disable trigger trg_ferias_lancamentos_valida_saldo;

commit;
