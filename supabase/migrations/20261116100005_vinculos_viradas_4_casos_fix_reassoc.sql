-- Subsistema "Vínculos de Colaborador" — Fase 1, Sessão S4 (fix).
-- Spec: docs/modulos/rh/70-vinculos-colaborador.md
--
-- Correção da reassociação de lançamentos feita na S4
-- (20261116100004_vinculos_viradas_4_casos.sql).
--
-- Bug encontrado após aplicar S4: a reassociação de lançamentos usava
-- `order by aquisitivo_inicio desc limit 1`, assumindo que um aquisitivo
-- PJ novo sempre teria `aquisitivo_inicio` posterior a um CLT antigo que
-- cobria a mesma data. Esse não era o caso quando o CLT antigo (gerado
-- pelo trigger original a partir da data_admissao) tinha ciclo anual
-- começando numa data POSTERIOR ao início do PJ correspondente.
--
-- Exemplos reais:
--   - Caso 1 (virada 2024-12-19): lanç 2025-04-29 casava com CLT antigo
--     numero 2 (2025-04-18→2026-04-17, inicia 2025-04-18) E com PJ novo
--     numero 6 (2024-12-19→2025-12-18, inicia 2024-12-19). O desc pegou
--     o CLT (data start maior). Correto: PJ (numero maior = criado depois).
--   - Caso 2 (virada 2026-05-01): lanç 2026-10-14 casava com CLT numero 3
--     (inicia 2026-10-14) e PJ numero 6 (inicia 2026-05-01). Idem.
--   - Caso 3 (virada 2024-09-18): lanç 2026-09-01 casava com CLT numero 9
--     (inicia 2026-04-04) e PJ numero 13 (inicia 2025-09-18). Idem.
--
-- 4 lançamentos ficaram presos em aquisitivos CLT indevidos.
--
-- Fix: reassociar lançs pós-virada filtrando apenas aquisitivos com
-- `aquisitivo_inicio >= v_virada` (que são os PJ novos) e preferindo
-- `numero desc`. Depois deletar aquisitivos CLT pós-virada que ficaram
-- órfãos (sem lançs) após a correção.

begin;

alter table public.colaborador_vinculos
  disable trigger trg_vinculo_regenera_ferias;
alter table public.colaborador_vinculos
  disable trigger trg_vinculo_sincroniza_colab;
alter table public.colaboradores_ferias_lancamentos
  disable trigger trg_ferias_lancamentos_valida_saldo;

-- Caso 1 (virada 2024-12-19)
update public.colaboradores_ferias_lancamentos l
   set periodo_id = (
     select p.id from public.colaboradores_ferias_periodos p
     where p.colaborador_id = l.colaborador_id
       and l.data_inicio between p.aquisitivo_inicio and p.aquisitivo_fim
       and p.aquisitivo_inicio >= '2024-12-19'
     order by p.numero desc
     limit 1
   )
 where l.colaborador_id = '979c372b-c322-4f8e-a198-faa2bdcdabd6'
   and l.data_inicio >= '2024-12-19';

-- Marcos (virada 2026-05-01)
update public.colaboradores_ferias_lancamentos l
   set periodo_id = (
     select p.id from public.colaboradores_ferias_periodos p
     where p.colaborador_id = l.colaborador_id
       and l.data_inicio between p.aquisitivo_inicio and p.aquisitivo_fim
       and p.aquisitivo_inicio >= '2026-05-01'
     order by p.numero desc
     limit 1
   )
 where l.colaborador_id = '7e759263-9821-45df-ad8b-fbede4eb4c4e'
   and l.data_inicio >= '2026-05-01';

-- Caso 3 (virada 2024-09-18)
update public.colaboradores_ferias_lancamentos l
   set periodo_id = (
     select p.id from public.colaboradores_ferias_periodos p
     where p.colaborador_id = l.colaborador_id
       and l.data_inicio between p.aquisitivo_inicio and p.aquisitivo_fim
       and p.aquisitivo_inicio >= '2024-09-18'
     order by p.numero desc
     limit 1
   )
 where l.colaborador_id = '2fb560a9-8a9a-433f-acc3-e946fc18db85'
   and l.data_inicio >= '2024-09-18';

-- Deletar aquisitivos CLT pós-virada órfãos.
-- Critério: aquisitivo_inicio >= virada, numero < min(numero dos PJ novos),
-- e sem lanç após reassociação.
-- Caso 1: PJ novos começam em numero 6.
delete from public.colaboradores_ferias_periodos p
 where p.colaborador_id = '979c372b-c322-4f8e-a198-faa2bdcdabd6'
   and p.aquisitivo_inicio >= '2024-12-19'
   and p.numero < 6
   and not exists (select 1 from public.colaboradores_ferias_lancamentos l where l.periodo_id = p.id);

-- Marcos: PJ novos começam em numero 6.
delete from public.colaboradores_ferias_periodos p
 where p.colaborador_id = '7e759263-9821-45df-ad8b-fbede4eb4c4e'
   and p.aquisitivo_inicio >= '2026-05-01'
   and p.numero < 6
   and not exists (select 1 from public.colaboradores_ferias_lancamentos l where l.periodo_id = p.id);

-- Caso 3: PJ novos começam em numero 12.
delete from public.colaboradores_ferias_periodos p
 where p.colaborador_id = '2fb560a9-8a9a-433f-acc3-e946fc18db85'
   and p.aquisitivo_inicio >= '2024-09-18'
   and p.numero < 12
   and not exists (select 1 from public.colaboradores_ferias_lancamentos l where l.periodo_id = p.id);

alter table public.colaborador_vinculos
  enable trigger trg_vinculo_regenera_ferias;
alter table public.colaborador_vinculos
  enable trigger trg_vinculo_sincroniza_colab;
alter table public.colaboradores_ferias_lancamentos
  enable trigger trg_ferias_lancamentos_valida_saldo;

update public.colaboradores_ferias_periodos
   set updated_at = now()
 where colaborador_id in (
   '979c372b-c322-4f8e-a198-faa2bdcdabd6',
   '7e759263-9821-45df-ad8b-fbede4eb4c4e',
   '2fb560a9-8a9a-433f-acc3-e946fc18db85'
 );

commit;
