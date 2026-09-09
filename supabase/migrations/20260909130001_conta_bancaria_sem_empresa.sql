-- =====================================================================
-- A conta bancária deixa de ter empresa
--
-- Fecha o que a `20260829100001` começou. Lá a trava de empresa saiu das
-- oito funções de baixa, com a regra enunciada pelo Tiago:
--
--   "Jobs sempre estarão associados a empresas, e os faturamentos e NFs
--    também... Porém, as contas em si não são específicas de uma empresa."
--
-- Faltava o CADASTRO. O efeito apareceu em 09/09/2026: conta nova não
-- aparecia para pagar título de outra empresa. As telas de baixa já foram
-- corrigidas (decisão 064); agora o campo sai do cadastro.
--
-- ---------------------------------------------------------------------
-- Por que as policies mudam junto
--
-- Uma primeira tentativa de soltar o NOT NULL, mais cedo hoje, falhou no
-- teste de gravação: `contas_bancarias_select` e `_modify` chamam
-- `can_access_empresa_regional(auth.uid(), empresa_id, null)`, que compara
-- `e.id = p_empresa_id`. Com `empresa_id` nulo os dois `exists` dão
-- false — a conta não nascia e ficaria INVISÍVEL para todo mundo.
--
-- A correção é CIRÚRGICA, nas duas policies desta tabela: conta sem
-- empresa é de todo mundo do tenant. `can_access_empresa_regional` NÃO é
-- tocada — ela serve 13 tabelas (jobs, orcamentos, projetos,
-- faturamentos, cartoes_credito…), quase todas da outra frente, e mudar
-- o comportamento dela para `null` mexeria em todas de uma vez.
--
-- `alter policy` em vez de drop/create: altera in-place, sem janela em
-- que a tabela fica sem política.
--
-- A checagem de tenant continua sendo a de sempre — conta sem empresa
-- NÃO vaza entre tenants.
-- ---------------------------------------------------------------------
--
-- A coluna FICA, a pedido do Tiago (09/09/2026): vestígio para o dia em
-- que a agência quiser dividir contas por empresa de novo. Quem já tem
-- empresa, mantém; a conta-espelho do cartão continua herdando a do
-- cartão pelo trigger `sincronizar_conta_do_cartao`.
-- =====================================================================

alter policy contas_bancarias_select on public.contas_bancarias
  using (
    tenant_id in (select current_tenant_ids())
    and (
      empresa_id is null
      or can_access_empresa_regional((select auth.uid()), empresa_id, null)
    )
  );

alter policy contas_bancarias_modify on public.contas_bancarias
  using (
    tenant_id in (select current_tenant_ids())
    and (
      empresa_id is null
      or can_access_empresa_regional((select auth.uid()), empresa_id, null)
    )
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and (
      empresa_id is null
      or can_access_empresa_regional((select auth.uid()), empresa_id, null)
    )
  );

alter table public.contas_bancarias
  alter column empresa_id drop not null;

comment on column public.contas_bancarias.empresa_id is
  'VESTÍGIO (09/09/2026), mantido para o caso de a agência voltar a dividir contas por empresa. Nulo em toda conta cadastrada a partir desta data; preenchido nas antigas e na conta-espelho do cartão, que herda do cartão pelo trigger. A conta NÃO pertence a uma empresa: paga documento de qualquer uma, e a empresa que vai para o lançamento é a do DOCUMENTO. Nada deve FILTRAR conta por esta coluna.';
