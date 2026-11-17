-- O Fundo Fixo California passa do tipo "caixa" para "investimento" (pedido
-- do Tiago em 16/11/2026: "Essa conta não é usada tanto no dia a dia como
-- um caixa. Acredito que seja melhor classificá-la como investimento").
--
-- A conta foi criada em 26/10 na importação do histórico (decisão 211, A2)
-- como "caixa", sem regra do Tiago por trás. Na lista da Conciliação ela era
-- a única do tipo e aparecia sozinha como "Caixa" (−R$ 911,20, por falta do
-- saldo inicial).
--
-- O que muda: o tipo, só. Na lista da Conciliação ela passa ao grupo
-- "Investimento" (o grupo "Caixa" some, sem conta), e passa a ser opção de
-- conta de aplicação no rendimento do recebimento avulso
-- (`criar_titulo_receber_avulso` aceita só tipo investimento). Nenhuma tela
-- esconde conta de investimento na hora de pagar, baixar ou conciliar;
-- `conta_corrente_id` segue nulo (não é aplicação automática). Saldo inicial,
-- data e lançamentos não mudam.
--
-- Valor existente sobrescrito: autorizado pelo Tiago no pedido. Auditado como
-- a edição do cadastro (`conta_bancaria.atualizada`).

do $$
declare
  v_producao uuid;
  v_n        int;
begin
  select id into v_producao from public.tenants where nome = 'Agência California';

  update public.contas_bancarias
     set tipo = 'investimento'
   where id = '18591f4e-ff98-4d3e-a023-756d16d6ecdf'  -- Fundo Fixo California
     and tenant_id = v_producao
     and tipo = 'caixa';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'esperava trocar o tipo de 1 conta, trocaria %', v_n;
  end if;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_producao, 'conta_bancaria', '18591f4e-ff98-4d3e-a023-756d16d6ecdf', 'conta_bancaria.atualizada', null,
          jsonb_build_object('diff', jsonb_build_object('tipo', jsonb_build_object('de', 'caixa', 'para', 'investimento')),
                             'origem', 'migration 20261116980004'));
end $$;
