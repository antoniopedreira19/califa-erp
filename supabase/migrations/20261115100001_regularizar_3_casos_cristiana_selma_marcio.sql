-- Regulariza 3 aquisitivos vencidos com saldo parcial, confirmados pelo
-- RH como "gozados mas confusão na planilha":
--
--   Cristiana Dantas 2017/2018: 28/30 → +2 dias usufruto
--   Selma Pereira    2018/2019: 20/30 → +10 dias usufruto
--   Márcio Vieira    2019/2020: 11/30 → +19 dias usufruto
--
-- Datas sintéticas colocadas nos últimos dias do concessivo pra não
-- colidir com gozos existentes (meio/início do concessivo). Mesma
-- técnica dos imports 20261114xxx.

begin;

do $$
declare v_nome text;
begin
  select nome into v_nome from public.tenants where id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  if v_nome <> 'Agência California' then raise exception 'Tenant errado: %', v_nome; end if;
end $$;

-- Cristiana Dantas 2017/2018: +2 dias
insert into public.colaboradores_ferias_lancamentos
  (tenant_id, colaborador_id, periodo_id, tipo, dias, dias_abono,
   data_inicio, data_fim, status, lancado_direto_por_rh,
   solicitado_por, aprovado_por, aprovado_em, observacao)
values (
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
  '0d0d0e62-8f5b-4729-9713-b579c2510549',
  '5a95e675-adef-430e-afab-9a965bc7fdc2',
  'usufruto', 2, 0,
  '2019-06-29', '2019-06-30',
  'concluido', true,
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  now(),
  'Regularização manual — gozo confirmado pelo RH fora da planilha original'
);

-- Selma Pereira 2018/2019: +10 dias
insert into public.colaboradores_ferias_lancamentos
  (tenant_id, colaborador_id, periodo_id, tipo, dias, dias_abono,
   data_inicio, data_fim, status, lancado_direto_por_rh,
   solicitado_por, aprovado_por, aprovado_em, observacao)
values (
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
  '4170222d-3c2c-4c66-bd9c-bc18ff8ca716',
  '19f54218-bf37-48a4-9d10-4ceab2e369d3',
  'usufruto', 10, 0,
  '2020-07-22', '2020-07-31',
  'concluido', true,
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  now(),
  'Regularização manual — gozo confirmado pelo RH fora da planilha original'
);

-- Márcio Vieira 2019/2020: +19 dias
insert into public.colaboradores_ferias_lancamentos
  (tenant_id, colaborador_id, periodo_id, tipo, dias, dias_abono,
   data_inicio, data_fim, status, lancado_direto_por_rh,
   solicitado_por, aprovado_por, aprovado_em, observacao)
values (
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
  'dfd96ca7-4a96-4f19-b06b-38dd69f5338b',
  'e0169edb-ac33-462a-b482-dfa1c5c2f2d8',
  'usufruto', 19, 0,
  '2021-01-11', '2021-01-29',
  'concluido', true,
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  '3a933b18-156d-48b3-b100-a8099292b1c2',
  now(),
  'Regularização manual — gozo confirmado pelo RH fora da planilha original'
);

-- Força recálculo de status dos 3 períodos
update public.colaboradores_ferias_periodos
   set updated_at = now()
 where id in (
   '5a95e675-adef-430e-afab-9a965bc7fdc2',
   '19f54218-bf37-48a4-9d10-4ceab2e369d3',
   'e0169edb-ac33-462a-b482-dfa1c5c2f2d8'
 );

commit;
