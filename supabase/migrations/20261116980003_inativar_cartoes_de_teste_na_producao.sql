-- Inativa os dois cartões de teste que ficaram na produção (OK do Tiago em
-- 16/11/2026: "Sim, inativar").
--
-- Por quê: "ZZ Teste Empresa Teste" e "ZZ Teste Fatia 2" estavam ativos no
-- tenant Agência California e apareciam na aprovação de PP. Oito PPs reais
-- foram aprovadas neles: PP-00044, PP-00210 (paga), PP-00824 e PP-00950 no
-- primeiro; PP-00272, PP-00719, PP-01084 e PP-01192 no segundo (a última em
-- 13/11). Inativar tira os dois da aprovação de PP, da avulsa e da baixa.
--
-- O que muda e o que não muda:
-- - É o mesmo que o "Inativar" do cadastro de cartões (`inativarCartao`):
--   `cartoes_credito.ativo = false`, com a mesma auditoria
--   (`cartao_credito.inativado`). O gatilho `sincronizar_conta_do_cartao`
--   leva o `ativo` à conta-espelho e mantém a empresa dela.
-- - As PPs, os lançamentos e as faturas não mudam. Na baixa das 7 PPs
--   aprovadas, o diálogo deixa de pré-escolher o cartão de teste (só oferece
--   cartões ativos), e o financeiro escolhe o certo; `cartao_lancar_item` e
--   `rotear_pp_para_cartao` recusam cartão inativo.
-- - A fatura aberta FC-00002 ("ZZ Teste Fatia 2") tem a PP-00210 paga
--   (R$ 8.000,00): continua lá até o Tiago decidir o cartão certo.
-- - Reversível pelo "Reativar" do cadastro.

do $$
declare
  v_producao uuid;
  v_n        int;
begin
  select id into v_producao from public.tenants where nome = 'Agência California';
  if v_producao is null then
    raise exception 'tenant da produção não encontrado';
  end if;

  update public.cartoes_credito
     set ativo = false
   where id in ('33416603-f18a-4abf-a142-7f67ec9e09aa',  -- ZZ Teste Empresa Teste
                '4c989cda-e6ac-4a27-b3d1-e5b84c6e2704')  -- ZZ Teste Fatia 2
     and tenant_id = v_producao
     and ativo;
  get diagnostics v_n = row_count;
  if v_n <> 2 then
    raise exception 'esperava inativar 2 cartões, inativaria %', v_n;
  end if;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  select v_producao, 'cartao_credito', c.id::text, 'cartao_credito.inativado', null,
         jsonb_build_object('origem', 'migration 20261116980003',
                            'motivo', 'cartão de teste na produção, com PPs reais aprovadas nele')
    from public.cartoes_credito c
   where c.id in ('33416603-f18a-4abf-a142-7f67ec9e09aa', '4c989cda-e6ac-4a27-b3d1-e5b84c6e2704');
end $$;
