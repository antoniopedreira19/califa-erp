-- Decisão 183 (16/10/2026, pedido do Tiago): a conta bancária da Empresa
-- Teste Presumido.
--
-- Por quê: a decisão 181 criou as duas PJs de teste. A Empresa Teste já
-- tinha contas (a "Conta Teste", a "Teste" e a do cartão "ZZ Teste Empresa
-- Teste"), mas a Empresa Teste Presumido nasceu sem nenhuma: na Conciliação,
-- visão "Teste", ela aparecia vazia, e não havia conta dela para dar baixa
-- nos testes do caminho da Hitlab (recebimento, guia, conciliação).
--
-- O que faz (só acrescenta): a "Conta Teste Presumido", conta corrente da
-- Empresa Teste Presumido no "Banco Teste", com saldo inicial de
-- R$ 100.000,00 em 01/09/2026 — o mesmo da "Conta Teste" da Empresa Teste.
-- Sem empresa gerencial (decisão 064: a conta paga documento de qualquer
-- empresa); a RLS mostra a conta sem empresa a todo o tenant.

do $$
declare
  v_tenant uuid;
  v_pj uuid;
begin
  select id, tenant_id into strict v_pj, v_tenant
    from public.empresas_contabeis where cnpj = '77777777000191' and de_teste;
  if exists (select 1 from public.contas_bancarias where empresa_contabil_id = v_pj) then
    raise notice 'A Empresa Teste Presumido já tem conta: nada a fazer.';
    return;
  end if;
  insert into public.contas_bancarias
    (tenant_id, empresa_id, empresa_contabil_id, nome, banco, tipo, saldo_inicial, saldo_inicial_data, ativo, ordem)
  values
    (v_tenant, null, v_pj, 'Conta Teste Presumido', 'Banco Teste', 'corrente', 100000, '2026-09-01', true, 0);
end $$;
