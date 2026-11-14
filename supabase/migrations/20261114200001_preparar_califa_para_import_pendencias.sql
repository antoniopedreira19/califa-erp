-- Prepara o tenant Agência California para importar FeriasPendencias.xlsx
-- (gozos antigos: aquisitivos 1819, 1920, 2021 + alguns 2324 que faltaram).
--
-- Mesma técnica do import 21.22.23 (migrations 20261114100001/02):
--   1. Guarda de segurança: aborta se tenant alvo não for Califa
--   2. Backup separado (_backup_20261114200_...)
--   3. Desabilita trigger trg_ferias_lancamentos_valida_saldo
-- Reabilita em 20261114200002 após o script tmp-importar-pendencias.js.

begin;

do $$
declare
  v_nome text;
begin
  select nome into v_nome
    from public.tenants
   where id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  if v_nome is null then
    raise exception 'Tenant d2a02c10-9c7e-4157-8dd5-84bbf5a7044c não encontrado. Abortando.';
  end if;
  if v_nome <> 'Agência California' then
    raise exception 'Tenant alvo não é Agência California (encontrou: %). Abortando.', v_nome;
  end if;
end $$;

create table if not exists public._backup_20261114200_califa_ferias_lancamentos as
select *
  from public.colaboradores_ferias_lancamentos
 where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';

alter table public.colaboradores_ferias_lancamentos
  disable trigger trg_ferias_lancamentos_valida_saldo;

commit;
