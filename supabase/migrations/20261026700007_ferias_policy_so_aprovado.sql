-- Migration: 20261026700007_ferias_policy_so_aprovado.sql
--
-- Final review C2: simplifica a policy ferias_lancamentos_financeiro_select.
--
-- Contexto:
--   Task 2 (20261026700003) criou a policy com:
--     status IN ('aguardando_financeiro', 'aprovado')
--   O valor 'aguardando_financeiro' foi adicionado ao enum em Task 1
--   (20261026700001) mas o fluxo real nunca escreve esse status. O RH aprova
--   via fn_aprovar_ferias (status → 'aprovado') sem passar por
--   'aguardando_financeiro'. A policy estava dependendo de um valor morto.
--
-- Fix: simplifica para status = 'aprovado', que é o único valor que o fluxo
--   real produz para linhas visíveis ao financeiro.
--
-- Nota: o valor 'aguardando_financeiro' permanece no enum ferias_lancamento_status
--   como vestígio (remover enum value requer migration separada com reescrita de
--   coluna e confirmação explícita, por ser operação destrutiva).

DROP POLICY IF EXISTS ferias_lancamentos_financeiro_select
  ON public.colaboradores_ferias_lancamentos;

CREATE POLICY ferias_lancamentos_financeiro_select
  ON public.colaboradores_ferias_lancamentos
  FOR SELECT TO authenticated
  USING (
    public.is_tenant_financeiro(tenant_id)
    AND status = 'aprovado'
  );
