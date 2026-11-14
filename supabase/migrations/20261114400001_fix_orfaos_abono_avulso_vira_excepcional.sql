-- Conserta 4 lançamentos órfãos criados pelos imports 21.22.23 e
-- FeriasPendencias. O script usava tipo 'abono_avulso' pra abonos
-- isolados (quando a planilha só tinha linha de abono, sem usufruto
-- no mesmo aquisitivo), mas a constraint chk_ferias_lancamento_abono_
-- avulso_sem_periodo força periodo_id = null pra abono_avulso. Com
-- isso o período correspondente ficava sem vínculo e continuava
-- "vencido sem gozo" na UI.
--
-- O tipo correto é 'abono_excepcional' — aceita periodo_id (já é usado
-- em 74 outros lançamentos no banco). Este fix:
--   1. Desabilita trigger de validação de saldo temporariamente
--   2. UPDATE nos 4 lançamentos: tipo abono_avulso → abono_excepcional
--      + seta periodo_id apontando pro aquisitivo correto
--   3. Reabilita trigger
--   4. UPDATE no_op nos 4 períodos pra disparar recálculo de status
--
-- Impacto esperado:
--   - Wilson 2020/2021: 0 → 30d gozado → regularizado
--   - Wilson 2021/2022: 15 → 30d gozado → regularizado
--   - Natalia 2018/2019: 0 → 30d gozado → regularizado
--   - João Victor 2023/2024: 10 → 20d gozado (parcial, ainda vencido)
--
-- Backup em _backup_20261114400_califa_ferias_lancamentos antes.

begin;

do $$
declare v_nome text;
begin
  select nome into v_nome from public.tenants where id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  if v_nome is null then raise exception 'Tenant não encontrado'; end if;
  if v_nome <> 'Agência California' then raise exception 'Tenant errado: %', v_nome; end if;
end $$;

create table if not exists public._backup_20261114400_califa_ferias_lancamentos as
  select * from public.colaboradores_ferias_lancamentos
   where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
     and tipo = 'abono_avulso'
     and periodo_id is null;

alter table public.colaboradores_ferias_lancamentos
  disable trigger trg_ferias_lancamentos_valida_saldo;

-- Wilson 2020/2021: 30d abono isolado
update public.colaboradores_ferias_lancamentos
   set tipo = 'abono_excepcional',
       periodo_id = '9731b70b-f5fb-4fbc-94c3-ae1287369713'
 where id = '0cebbdac-6c64-487e-9b93-6db50fff425a';

-- Wilson 2021/2022: 15d abono isolado
update public.colaboradores_ferias_lancamentos
   set tipo = 'abono_excepcional',
       periodo_id = 'd32dcb6e-ca90-44d0-9df1-19aad16431dd'
 where id = 'ec7e51cd-2186-4a85-8315-3f76a2b6e535';

-- Natalia 2018/2019: 30d abono isolado
update public.colaboradores_ferias_lancamentos
   set tipo = 'abono_excepcional',
       periodo_id = '5d4fe40c-4ac4-4221-8a3d-6bd5b48aad9d'
 where id = '267f4fbf-05dc-426a-81c0-a4d0746a158f';

-- João Victor 2023/2024: 10d abono isolado
update public.colaboradores_ferias_lancamentos
   set tipo = 'abono_excepcional',
       periodo_id = '9dabaadd-4cbc-4424-a70c-8e4ee95642a2'
 where id = '9e037263-98bd-4783-9662-945221187506';

alter table public.colaboradores_ferias_lancamentos
  enable trigger trg_ferias_lancamentos_valida_saldo;

-- Força recálculo de status dos 4 períodos afetados
update public.colaboradores_ferias_periodos
   set updated_at = now()
 where id in (
   '9731b70b-f5fb-4fbc-94c3-ae1287369713',
   'd32dcb6e-ca90-44d0-9df1-19aad16431dd',
   '5d4fe40c-4ac4-4221-8a3d-6bd5b48aad9d',
   '9dabaadd-4cbc-4424-a70c-8e4ee95642a2'
 );

commit;
