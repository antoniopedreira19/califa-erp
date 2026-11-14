-- Prepara o tenant Agência California para importar a planilha 21.22.23.xlsx
-- (gozos entre 2022 e 2024, aquisitivos 21/22 e 22/23). Diferente do import
-- de 2026-11-13 (FériasAtt), este é CIRÚRGICO: só mexe nos lançamentos de
-- 24 colaboradores específicos que hoje têm pendência "vencido sem gozo"
-- nesses períodos.
--
-- Esta migration faz APENAS:
--   1. Guarda de segurança: aborta se o tenant alvo não for Califa.
--   2. Backup da tabela atual em _backup_20261114_califa_ferias_lancamentos.
--   3. Desabilita a trigger trg_ferias_lancamentos_valida_saldo
--      temporariamente — o script tmp-importar-ferias-21-23.js precisa
--      inserir sem bloqueio (cap em 30 é aplicado no script).
--      A trigger é reabilitada pela migration 20261114100002.
--
-- Os INSERTs dos lançamentos vêm em passo separado (script JS), porque
-- envolvem dados identificáveis (nomes de pessoas reais).

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

-- 1) Backup --------------------------------------------------------------
create table if not exists public._backup_20261114_califa_ferias_lancamentos as
select *
  from public.colaboradores_ferias_lancamentos
 where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';

-- 2) Desabilita trigger de validação de saldo ---------------------------
-- O script vai inserir lançamentos de períodos antigos (21/22, 22/23)
-- com cap em 30d já aplicado em memória. A trigger não precisa validar —
-- vai ser reabilitada em migration separada após rodar o script.

alter table public.colaboradores_ferias_lancamentos
  disable trigger trg_ferias_lancamentos_valida_saldo;

commit;
