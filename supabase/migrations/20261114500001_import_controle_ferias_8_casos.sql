-- Import cirúrgico de 8 lançamentos da planilha
-- "Controle e Planejamento de Férias - Agência California 2026 (1).xlsx"
-- que resolvem/melhoram pendências específicas no tenant Califa.
--
-- Casos (banco → após):
--   1. Selma 2015/2016:    0d  → 30d  (regulariza)
--   2. Fabiane 2024/2025:  0d  → 30d  (regulariza, 20 us + 10 abono)
--   3. Mateus 2024/2025:   20d → 30d  (regulariza, +10 abono)
--   4. Raphael 2024/2025:  20d → 30d  (regulariza, +10 abono)
--   5. João Victor 2023/24:20d → 30d  (regulariza, +10 abono)
--   6. Bernardo 2022/2023: 25d → 30d  (regulariza, +5 usufruto)
--   7. Bianca 2025/2026:   15d → 25d  (reduz pendência, +10 usufruto)
--   8. Isadora 2025/2026:  0d  → 12d  (reduz pendência, +12 usufruto)
--
-- Regras aplicadas (confirmadas pelo usuário):
--   - Cap em 30d por aquisitivo (já respeitado, nenhum estoura)
--   - Abono isolado (sem usufruto novo) usa abono_excepcional + periodo_id
--     (NÃO abono_avulso — ver 20261114400001)
--   - Usufruto + abono no mesmo aquisitivo → 1 abono_combinado
--   - Datas reais da planilha quando disponíveis; sintéticas para abonos
--     usando concessivo_inicio + 183d
--
-- Backup em _backup_20261114500_...

begin;

do $$
declare v_nome text;
begin
  select nome into v_nome from public.tenants where id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  if v_nome <> 'Agência California' then raise exception 'Tenant errado: %', v_nome; end if;
end $$;

create table if not exists public._backup_20261114500_califa_ferias_lancamentos as
  select * from public.colaboradores_ferias_lancamentos
   where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';

alter table public.colaboradores_ferias_lancamentos
  disable trigger trg_ferias_lancamentos_valida_saldo;

-- Profile admin (Tiago Mendonça) pra solicitado_por e aprovado_por
-- (constraint NOT NULL em solicitado_por)

-- 1. Selma 2015/2016: 30d usufruto CLT
insert into public.colaboradores_ferias_lancamentos
  (tenant_id, colaborador_id, periodo_id, tipo, dias, dias_abono,
   data_inicio, data_fim, status, lancado_direto_por_rh,
   solicitado_por, aprovado_por, aprovado_em, observacao)
values (
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
  '4170222d-3c2c-4c66-bd9c-bc18ff8ca716',
  '4f3ac251-73c3-4061-a2e8-74d89614a3d8',
  'usufruto', 30, 0,
  '2018-08-02', '2018-08-31',
  'concluido', true,
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  now(),
  '[Import ControleFerias.xlsx 1516 · CLT]'
);

-- 2. Fabiane 2024/2025: 20d usufruto CLT + 10d abono = abono_combinado
insert into public.colaboradores_ferias_lancamentos
  (tenant_id, colaborador_id, periodo_id, tipo, dias, dias_abono,
   data_inicio, data_fim, status, lancado_direto_por_rh,
   solicitado_por, aprovado_por, aprovado_em, observacao)
values (
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
  'a7f67460-9009-4ef4-8a99-4aa9aa93c5e4',
  '94bee0c6-9d6e-42c7-80ec-1ffc549265a1',
  'abono_combinado', 30, 10,
  '2025-10-01', '2025-10-20',
  'concluido', true,
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  now(),
  '[Import ControleFerias.xlsx 2425 · Combinado CLT+Abono]'
);

-- 3. Mateus 2024/2025: +10d abono_excepcional (banco já tem 20 usufruto)
insert into public.colaboradores_ferias_lancamentos
  (tenant_id, colaborador_id, periodo_id, tipo, dias, dias_abono,
   data_inicio, data_fim, status, lancado_direto_por_rh,
   solicitado_por, aprovado_por, aprovado_em, observacao)
values (
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
  '242579fd-8dd2-4ca7-bbfd-b721b028f5b8',
  'bb315649-550f-40d0-9d15-41e9b5d3922a',
  'abono_excepcional', 10, 0,
  '2026-04-03', '2026-04-12',  -- conc_ini 2025-10-02 + 183d
  'concluido', true,
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  now(),
  '[Import ControleFerias.xlsx 2425 · Abono · aquisitivo 2024/2025]'
);

-- 4. Raphael 2024/2025: +10d abono_excepcional (banco já tem 20 usufruto)
insert into public.colaboradores_ferias_lancamentos
  (tenant_id, colaborador_id, periodo_id, tipo, dias, dias_abono,
   data_inicio, data_fim, status, lancado_direto_por_rh,
   solicitado_por, aprovado_por, aprovado_em, observacao)
values (
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
  '8a55ae64-399d-4cb7-84fe-9622b690d0e0',
  '91061716-2c79-44ce-b995-61f56ec04da2',
  'abono_excepcional', 10, 0,
  '2025-08-31', '2025-09-09',  -- conc_ini 2025-03-01 + 183d
  'concluido', true,
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  now(),
  '[Import ControleFerias.xlsx 2425 · Abono · aquisitivo 2024/2025]'
);

-- 5. João Victor 2023/2024: +10d abono_excepcional (banco já tem 20 usufruto)
insert into public.colaboradores_ferias_lancamentos
  (tenant_id, colaborador_id, periodo_id, tipo, dias, dias_abono,
   data_inicio, data_fim, status, lancado_direto_por_rh,
   solicitado_por, aprovado_por, aprovado_em, observacao)
values (
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
  'c7e9e7e8-c779-4e57-9e6e-e8f687d34679',
  '9dabaadd-4cbc-4424-a70c-8e4ee95642a2',
  'abono_excepcional', 10, 0,
  '2024-08-31', '2024-09-09',  -- conc_ini 2024-03-01 + 183d
  'concluido', true,
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  now(),
  '[Import ControleFerias.xlsx 2324 · Abono · aquisitivo 2023/2024]'
);

-- 6. Bernardo 2022/2023: +5d usufruto PJ
insert into public.colaboradores_ferias_lancamentos
  (tenant_id, colaborador_id, periodo_id, tipo, dias, dias_abono,
   data_inicio, data_fim, status, lancado_direto_por_rh,
   solicitado_por, aprovado_por, aprovado_em, observacao)
values (
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
  '6435a9c6-ff93-49f8-9e2c-fae03f0fae21',
  'd22064fd-5513-41cc-937e-7d95dd4b7966',
  'usufruto', 5, 0,
  '2024-06-03', '2024-06-07',
  'concluido', true,
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  now(),
  '[Import ControleFerias.xlsx 2024 · PJ]'
);

-- 7. Bianca 2025/2026: +10d usufruto PJ
insert into public.colaboradores_ferias_lancamentos
  (tenant_id, colaborador_id, periodo_id, tipo, dias, dias_abono,
   data_inicio, data_fim, status, lancado_direto_por_rh,
   solicitado_por, aprovado_por, aprovado_em, observacao)
values (
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
  '8655396a-50bd-41fd-a283-224d5b749d63',
  'f2434869-33ef-4a27-9122-6b5567f8c079',
  'usufruto', 10, 0,
  '2026-08-31', '2026-09-09',
  'concluido', true,
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  now(),
  '[Import ControleFerias.xlsx 2526 · PJ]'
);

-- 8. Isadora 2025/2026: +12d usufruto PJ
insert into public.colaboradores_ferias_lancamentos
  (tenant_id, colaborador_id, periodo_id, tipo, dias, dias_abono,
   data_inicio, data_fim, status, lancado_direto_por_rh,
   solicitado_por, aprovado_por, aprovado_em, observacao)
values (
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
  '7a64d9a9-d68e-49ab-80a7-aaf1947fb058',
  '2d27b759-57cc-4d6f-96fe-2ee5bc1085de',
  'usufruto', 12, 0,
  '2026-05-18', '2026-05-29',
  'concluido', true,
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  now(),
  '[Import ControleFerias.xlsx 2526 · PJ]'
);

alter table public.colaboradores_ferias_lancamentos
  enable trigger trg_ferias_lancamentos_valida_saldo;

-- Força recálculo de status dos 8 períodos afetados
update public.colaboradores_ferias_periodos
   set updated_at = now()
 where id in (
   '4f3ac251-73c3-4061-a2e8-74d89614a3d8', -- Selma 15/16
   '94bee0c6-9d6e-42c7-80ec-1ffc549265a1', -- Fabiane 24/25
   'bb315649-550f-40d0-9d15-41e9b5d3922a', -- Mateus 24/25
   '91061716-2c79-44ce-b995-61f56ec04da2', -- Raphael 24/25
   '9dabaadd-4cbc-4424-a70c-8e4ee95642a2', -- João Victor 23/24
   'd22064fd-5513-41cc-937e-7d95dd4b7966', -- Bernardo 22/23
   'f2434869-33ef-4a27-9122-6b5567f8c079', -- Bianca 25/26
   '2d27b759-57cc-4d6f-96fe-2ee5bc1085de'  -- Isadora 25/26
 );

commit;
