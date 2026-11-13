-- Prepara o tenant Agência California para importar o histórico de férias
-- extraído da planilha FériasAtt (abas 2023, 2024, 2025, Férias 2026).
--
-- Esta migration roda APENAS a parte destrutiva e versionada:
--   1. Backup das tabelas atuais em _backup_20261113_califa_*
--   2. Mudar data_admissao do Philipe (2020-04-01 -> 2024-08-08)
--      — decisão: a planilha tem 2 linhas dele e o vigente é o contrato
--        novo, PJ, admitido em 2024-08-08.
--   3. Apagar todos os lançamentos de férias dos 203 colaboradores ativos
--      (vão ser reinseridos pelo script tmp-importar-historico-ferias.js
--      a partir da planilha, com as regras já definidas: dedupe CLT+Recibo,
--      split pay, combinados do RH, descartes manuais).
--   4. UPDATE no-op em data_admissao em todos os ativos para disparar o
--      trigger trg_colaboradores_gerar_ferias_periodos e regenerar os
--      períodos aquisitivos a partir da data correta.
--
-- Os INSERTs dos lançamentos novos vêm em passo separado (script TS),
-- porque envolvem dados identificáveis (nomes que a planilha identifica)
-- e nenhum arquivo versionado deve conter PII.
--
-- Guarda de segurança: o DO $$ inicial aborta se o tenant_id não bater
-- com "Agência California" exato. Isso impede acidente de executar no
-- Sandbox ou em qualquer outro tenant.

begin;

-- Guarda de segurança ----------------------------------------------------
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

-- 1) Backup das tabelas atuais ------------------------------------------
-- Snapshots versionados por data; podem ser dropados depois da validação
-- em produção (sugestão: 30 dias).

create table if not exists public._backup_20261113_califa_ferias_periodos as
select *
  from public.colaboradores_ferias_periodos
 where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';

create table if not exists public._backup_20261113_califa_ferias_lancamentos as
select *
  from public.colaboradores_ferias_lancamentos
 where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';

-- 2) Apagar lançamentos atuais dos colaboradores ATIVOS -----------------
-- Precisa vir antes do UPDATE em data_admissao, senão o trigger
-- fn_gerar_ferias_periodos abortaria (ele bloqueia regeneração quando
-- há lançamentos ativos).

delete from public.colaboradores_ferias_lancamentos
 where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
   and colaborador_id in (
     select id from public.colaboradores
      where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
        and status = 'ativo'
   );

-- 3) Caso Philipe — nova data de admissão --------------------------------
-- Colaborador com UUID 6ca2d4cd-11ca-4d1e-aa60-4af180515b2c.
-- Admissão original: 2020-04-01.
-- Nova: 2024-08-08 (linha "Ativo" PJ na planilha ColaboradoresAtualizados;
-- a linha antiga 2020 foi marcada como "Desligado" lá).
-- O trigger regenera todos os períodos aquisitivos dele automaticamente.

update public.colaboradores
   set data_admissao = date '2024-08-08'
 where id = '6ca2d4cd-11ca-4d1e-aa60-4af180515b2c'
   and tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';

-- 4) Regenerar períodos de todos os demais ativos ------------------------
-- O trigger fn_gerar_ferias_periodos só age quando new.data_admissao IS
-- DISTINCT FROM old.data_admissao. Fazer UPDATE SET data_admissao =
-- data_admissao NÃO dispara. Por isso usamos a técnica das duas UPDATEs:
-- +1 dia (dispara, gera períodos com data errada), -1 dia (dispara de novo,
-- gera períodos com a data correta que fica no final). O trigger apaga e
-- recria os períodos a cada chamada, então o estado final é consistente.

update public.colaboradores
   set data_admissao = data_admissao + 1
 where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
   and status = 'ativo'
   and tipo_contratacao <> 'socio'
   and data_admissao is not null
   and id <> '6ca2d4cd-11ca-4d1e-aa60-4af180515b2c';

update public.colaboradores
   set data_admissao = data_admissao - 1
 where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
   and status = 'ativo'
   and tipo_contratacao <> 'socio'
   and data_admissao is not null
   and id <> '6ca2d4cd-11ca-4d1e-aa60-4af180515b2c';

commit;
