-- Backfill: cria rescisão em `rascunho` pra cada colaborador inativo
-- nos últimos 90 dias que ainda não tem rescisão aberta. Idempotente
-- pelo NOT EXISTS no índice único parcial.
--
-- Colaboradores com admissão posterior ao encerramento (dado quebrado)
-- ficam de fora: `fn_calcular_meses_rescisao` levanta exceção nesse
-- caso, então o filtro `data_encerramento >= data_admissao` protege o
-- INSERT. RH precisa corrigir a data no cadastro antes.
--
-- Snapshot entra null se o colaborador não tem salário vigente — o
-- usuário vê "Cálculo pendente" na tela e clica em Recalcular depois
-- de cadastrar o salário.

insert into rescisoes (
  tenant_id, colaborador_id, data_rescisao, status,
  salario_vigente, saldo_salario_dias, saldo_salario_valor,
  avos_ferias, valor_ferias, valor_um_terco_ferias,
  avos_decimo, valor_decimo_terceiro,
  total_bruto, total_liquido
)
with alvo as (
  select c.id as colaborador_id,
         c.tenant_id,
         c.data_admissao,
         c.data_encerramento as dem
    from colaboradores c
   where c.status = 'inativo'
     and c.data_encerramento is not null
     and c.data_encerramento >= c.data_admissao
     and c.data_encerramento >= (now() - interval '90 days')::date
     and not exists (
       select 1 from rescisoes r
        where r.colaborador_id = c.id
          and r.status in ('rascunho','enviada_financeiro','paga')
     )
), sal as (
  select a.*,
         (select cs.valor
            from colaboradores_salarios cs
           where cs.colaborador_id = a.colaborador_id
             and cs.tenant_id = a.tenant_id
             and cs.data_inicio <= a.dem
             and (cs.data_fim is null or cs.data_fim >= a.dem)
           order by cs.data_inicio desc limit 1) as salario
    from alvo a
), computado as (
  select s.*,
         fn_calcular_meses_rescisao(s.colaborador_id, s.dem) as avos_ferias,
         greatest(
           0,
           (case when extract(day from s.dem)::int >= 15
                   then extract(month from s.dem)::int
                 else extract(month from s.dem)::int - 1 end)
           -
           (case when extract(year from s.data_admissao) < extract(year from s.dem) then 1
                 when extract(day from s.data_admissao)::int <= 15
                   then extract(month from s.data_admissao)::int
                 else extract(month from s.data_admissao)::int + 1 end)
           + 1
         ) as avos_decimo
    from sal s
)
select
  c.tenant_id,
  c.colaborador_id,
  c.dem,
  'rascunho'::rescisao_status,
  c.salario,
  case when c.salario is null then null else extract(day from c.dem)::int end,
  case when c.salario is null then null
       else round((c.salario / 30) * extract(day from c.dem)::numeric, 2) end,
  c.avos_ferias,
  case when c.salario is null then null else round((c.salario / 12) * c.avos_ferias, 2) end,
  case when c.salario is null then null else round(((c.salario / 12) * c.avos_ferias) / 3, 2) end,
  c.avos_decimo,
  case when c.salario is null then null else round((c.salario / 12) * c.avos_decimo, 2) end,
  case when c.salario is null then null
       else round(
         (c.salario / 30) * extract(day from c.dem)::numeric
         + round((c.salario / 12) * c.avos_ferias, 2)
         + round(((c.salario / 12) * c.avos_ferias) / 3, 2)
         + round((c.salario / 12) * c.avos_decimo, 2),
       2) end,
  case when c.salario is null then null
       else round(
         (c.salario / 30) * extract(day from c.dem)::numeric
         + round((c.salario / 12) * c.avos_ferias, 2)
         + round(((c.salario / 12) * c.avos_ferias) / 3, 2)
         + round((c.salario / 12) * c.avos_decimo, 2),
       2) end
from computado c;
