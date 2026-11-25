-- Acerto de dado: P-0077/26-01 v1 no fechamento padrão do internacional
-- (revisão da decisão 206, 25/11/2026).
--
-- O orçamento nasceu em 16/10 com a categoria Evento (nacional) e a v1 ficou
-- com int. taxes 0% e sem moeda. Em 23/11 a categoria passou a Internacional;
-- até o commit bac4fa9f a troca não levava a versão ao padrão, e o pop-up
-- "Exceção" não oferecia "Voltar ao padrão" sem exceção registrada.
--
-- Em 25/11 o administrador duplicou a v1 (a v2 nasceu no padrão). A v1 fica
-- como rascunho e, por decisão do Tiago (25/11), também vai ao padrão: o
-- mesmo que a troca de categoria faz agora (int. taxes 18,02%, custo de
-- transação R$ 0,00, impostos BR 19,53% como já estão, moeda USD). A v2 não
-- é tocada. Câmbio (data e cotação) continua em branco.
--
-- Guardado: só muda se a versão ainda estiver aberta e com 0% sem exceção.
-- Roda como postgres: o gatilho versao_fechamento_internacional_no_padrao só
-- confere o papel authenticated, e o valor gravado é o padrão de qualquer
-- forma.

do $$
declare
  v_versao constant uuid := 'd1557746-0902-45c9-8e97-bcc5ddeb0f5c';
  v_antes record;
begin
  select id, tenant_id, orcamento_id, status, percentual_int_taxes, percentual_imposto,
         int_transaction_costs, moeda_estrangeira
    into v_antes
    from public.versoes_orcamento
   where id = v_versao
     and status not in ('aprovada', 'cancelada')
     and percentual_int_taxes = 0
     and excecao_fechamento_motivo is null;

  if not found then
    raise notice 'P-0077/26-01 v1 já não está no estado do acerto; nada a fazer.';
    return;
  end if;

  update public.versoes_orcamento
     set percentual_int_taxes = 18.02,
         int_transaction_costs = 0,
         moeda_estrangeira = coalesce(nullif(trim(moeda_estrangeira), ''), 'USD')
   where id = v_versao;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (
    v_antes.tenant_id, 'versao_orcamento', v_versao::text,
    'versao_orcamento.excecao_fechamento_removida', null,
    jsonb_build_object(
      'orcamento_id', v_antes.orcamento_id,
      'origem', 'migration 20261125740001 (revisão da decisão 206)',
      'de', jsonb_build_object('intTaxes', v_antes.percentual_int_taxes, 'imposto', v_antes.percentual_imposto,
                               'itc', v_antes.int_transaction_costs, 'moeda', v_antes.moeda_estrangeira),
      'para', jsonb_build_object('intTaxes', 18.02, 'imposto', v_antes.percentual_imposto, 'itc', 0,
                                 'moeda', coalesce(nullif(trim(v_antes.moeda_estrangeira), ''), 'USD')),
      'motivo_anterior', null
    )
  );
end $$;
