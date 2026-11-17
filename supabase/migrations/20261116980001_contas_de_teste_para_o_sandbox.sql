-- As duas contas bancárias de teste que ficaram no tenant da produção vão
-- para o California Sandbox (pedido do Tiago em 16/11/2026).
--
-- Por quê: a mudança da Empresa Teste para o Sandbox (10/11, migration
-- 20261110990001) levou as empresas contábeis "Empresa Teste" e "Empresa
-- Teste Presumido", os lançamentos e os títulos dessas contas, mas deixou as
-- duas linhas de `contas_bancarias` na produção. Resultado: a Conciliação da
-- produção mostrava "Teste" (R$ 27.809,53) e "Conta Teste Presumido"
-- (R$ 100.000,00) num grupo sem empresa ("—"), somando R$ 127.809,53 no
-- saldo consolidado da agência; e no Sandbox os 4 lançamentos e os 2 títulos
-- apontavam para uma conta que o Sandbox não enxerga.
--
-- Conferido antes (16/11/2026): tudo que aponta para estas duas contas já
-- está no Sandbox — 4 lançamentos e 2 títulos a receber da "Teste"; nada na
-- "Conta Teste Presumido". Nenhum job, avulsa, remessa, transferência,
-- extrato, regra, fechamento, histórico, acerto ou centro aponta para elas.
-- As empresas contábeis das duas (de_teste) já são do Sandbox.
--
-- Fora daqui, de propósito: os cartões "ZZ Teste Empresa Teste" e "ZZ Teste
-- Fatia 2" continuam na produção, porque têm PPs reais (aprovadas e pagas)
-- apontando para eles. Qual cartão é o certo de cada PP é decisão do Tiago.
--
-- Mudança de tenant de linha existente: autorizada pelo Tiago no pedido.

do $$
declare
  v_sandbox  uuid;
  v_producao uuid;
  v_movidas  int;
begin
  select id into v_sandbox  from public.tenants where nome = 'California Sandbox';
  select id into v_producao from public.tenants where nome = 'Agência California';
  if v_sandbox is null or v_producao is null then
    raise exception 'tenant do Sandbox ou da produção não encontrado';
  end if;

  -- Trava: se alguma linha da produção passou a apontar para estas contas
  -- depois da conferência, nada se move.
  if exists (select 1 from public.lancamentos_financeiros
              where conta_bancaria_id in ('27c3787d-570b-4363-a93c-d7e9d15bfee5', '26490a97-de56-4ec1-9b05-12627a0f9571')
                and tenant_id <> v_sandbox)
     or exists (select 1 from public.titulos_receber
              where conta_bancaria_recebimento_id in ('27c3787d-570b-4363-a93c-d7e9d15bfee5', '26490a97-de56-4ec1-9b05-12627a0f9571')
                and tenant_id <> v_sandbox)
     or exists (select 1 from public.contas_avulsas
              where (conta_bancaria_baixa_id in ('27c3787d-570b-4363-a93c-d7e9d15bfee5', '26490a97-de56-4ec1-9b05-12627a0f9571')
                  or conta_bancaria_prevista_id in ('27c3787d-570b-4363-a93c-d7e9d15bfee5', '26490a97-de56-4ec1-9b05-12627a0f9571'))
                and tenant_id <> v_sandbox)
     or exists (select 1 from public.jobs
              where (conta_impostos_id in ('27c3787d-570b-4363-a93c-d7e9d15bfee5', '26490a97-de56-4ec1-9b05-12627a0f9571')
                  or conta_pagamento_id in ('27c3787d-570b-4363-a93c-d7e9d15bfee5', '26490a97-de56-4ec1-9b05-12627a0f9571')
                  or conta_recebimento_id in ('27c3787d-570b-4363-a93c-d7e9d15bfee5', '26490a97-de56-4ec1-9b05-12627a0f9571'))
                and tenant_id <> v_sandbox)
  then
    raise exception 'há linha fora do Sandbox apontando para as contas de teste: conferir antes de mover';
  end if;

  update public.contas_bancarias
     set tenant_id = v_sandbox
   where id in ('27c3787d-570b-4363-a93c-d7e9d15bfee5', '26490a97-de56-4ec1-9b05-12627a0f9571')
     and tenant_id = v_producao;
  get diagnostics v_movidas = row_count;

  if v_movidas <> 2 then
    raise exception 'esperava mover 2 contas, moveria %', v_movidas;
  end if;
end $$;
