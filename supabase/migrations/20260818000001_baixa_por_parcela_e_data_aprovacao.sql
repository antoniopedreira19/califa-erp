-- ---------------------------------------------------------------------
-- Correções encontradas na verificação no navegador de 18/08/2026
-- ---------------------------------------------------------------------
--
-- Duas regras que o plano de telas exigia e que o banco não estava
-- cumprindo. Foram descobertas exercitando a esteira inteira com dado
-- real (JOB-0015 / PP-00009, R$ 12.000,00 em 3 parcelas).
--
-- 1) BAIXA POR PARCELA ESTAVA BLOQUEADA A PARTIR DA SEGUNDA.
--
--    A `20260805000003_lancamentos_financeiros.sql` criou
--
--        create unique index uniq_baixa_ativa_por_pp
--          on lancamentos_financeiros(pedido_compra_id)
--         where origem = 'pp_baixa';
--
--    quando UMA PP tinha UMA baixa. A `20260817000004_titulos_a_pagar.sql`
--    introduziu `pedidos_compra_parcelas`, acrescentou
--    `lancamentos_financeiros.pedido_compra_parcela_id` e passou a
--    inserir UM lançamento POR PARCELA — mas não substituiu o índice.
--    Resultado: a 1ª parcela baixava e da 2ª em diante o Postgres
--    recusava com `duplicate key value violates unique constraint
--    "uniq_baixa_ativa_por_pp"`, mensagem que chegava crua ao usuário.
--    A PP parcelada nunca chegava a `pago`.
--
--    A unicidade continua existindo, só que na granularidade certa: uma
--    baixa ativa por PARCELA. O estorno segue funcionando porque troca a
--    origem para `pp_baixa_estornada`, saindo do índice parcial.
--
--    O índice antigo é recriado como um caso de borda: lançamento de
--    baixa SEM parcela não existe mais no fluxo (a função sempre grava
--    `pedido_compra_parcela_id`), mas se algum aparecer, ele continua
--    limitado a um por PP — que era a regra de antes.
--
-- 2) APROVAR PP SEM DATA DE PAGAMENTO PASSAVA NO SERVIDOR.
--
--    A decisão 016 fez da "Data de pagamento" o campo que a aprovação
--    exige: é ela que vira o vencimento do título em Títulos a Pagar e
--    que desloca as demais parcelas. A tela barra, mas a action e esta
--    RPC não olhavam o campo — chamada direta aprovava a PP com
--    `prazo_pagamento_financeiro` nulo, e os títulos nasciam com a data
--    de pagamento vazia e sem 1ª data registrada. A trava passa a valer
--    aqui, que é o último portão.
--
-- Nada de dado é tocado: o único lançamento `pp_baixa` do banco já tem
-- `pedido_compra_parcela_id` preenchido.
--
-- ⚠️ Conhecido e deliberadamente FORA desta migration:
--    `estornar_baixa_pp` (estorno da PP inteira) ainda pega `limit 1`
--    dos lançamentos de baixa e devolve a PP a `aprovada` sem limpar
--    `pago_em` das parcelas. Desde a decisão 016 ela não tem porta na
--    interface, e consertá-la exige decidir a semântica do estorno com
--    parcelas — assunto de outra entrega.

-- ---------------------------------------------------------------------
-- 1. Unicidade da baixa: por PARCELA, não por PP
-- ---------------------------------------------------------------------

drop index if exists public.uniq_baixa_ativa_por_pp;

create unique index if not exists uniq_baixa_ativa_por_parcela
  on public.lancamentos_financeiros(pedido_compra_parcela_id)
  where origem = 'pp_baixa' and pedido_compra_parcela_id is not null;

comment on index public.uniq_baixa_ativa_por_parcela is
  'Uma baixa ativa por parcela de PP. Substitui uniq_baixa_ativa_por_pp '
  '(18/08/2026): desde as parcelas de PP, cada parcela gera seu próprio '
  'lançamento, e a unicidade por PP travava da 2ª parcela em diante.';

create unique index if not exists uniq_baixa_ativa_por_pp_sem_parcela
  on public.lancamentos_financeiros(pedido_compra_id)
  where origem = 'pp_baixa' and pedido_compra_parcela_id is null;

comment on index public.uniq_baixa_ativa_por_pp_sem_parcela is
  'Caso de borda: lançamento de baixa sem parcela vinculada mantém a '
  'regra antiga de um por PP. O fluxo atual sempre grava a parcela.';

-- ---------------------------------------------------------------------
-- 2. aprovar_pp exige a data de pagamento escolhida pelo financeiro
-- ---------------------------------------------------------------------

create or replace function public.aprovar_pp(p_pp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp        pedidos_compra%rowtype;
  v_user_id   uuid := auth.uid();
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if not public.is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem acesso a esta PP.';
  end if;
  if v_pp.status <> 'em_avaliacao' then
    raise exception 'PP precisa estar em avaliação (status atual: %).', v_pp.status;
  end if;

  -- Decisão 016: a data escolhida na aprovação vira o vencimento do
  -- título e desloca as demais parcelas pelo mesmo número de dias.
  -- Sem ela o título nasce sem data de pagamento e sem 1ª data
  -- registrada, o que quebra a repactuação.
  if v_pp.prazo_pagamento_financeiro is null then
    raise exception 'Escolha a data de pagamento antes de aprovar a PP.';
  end if;

  update public.pedidos_compra
     set status = 'aprovada',
         aprovada_em = now(),
         aprovada_por = v_user_id
   where id = p_pp_id;
end;
$$;

comment on function public.aprovar_pp(uuid) is
  'Aprova a PP em avaliação. Desde 18/08/2026 exige '
  'prazo_pagamento_financeiro preenchido (decisão 016).';

revoke execute on function public.aprovar_pp(uuid) from public;
grant  execute on function public.aprovar_pp(uuid) to authenticated;
