-- ===========================================================================
-- A PP aprovada que não deve seguir volta para a produção
-- ===========================================================================
-- Decisão 083 (Tiago, 15/09/2026). A produção não cancela PP aprovada — ela
-- já é título a pagar (decisão 027) — e pede ao financeiro. O financeiro
-- APENAS REPROVA: a PP volta para `rejeitada`, a mesma caixa da rejeição de
-- quem estava em avaliação, e a produção corrige e reenvia ou cancela (1a).
--
-- `desaprovar_pp` (18/08/2026) fazia quase isso e sai daqui. Ela devolvia a
-- PP para `em_avaliacao` — que não é o destino combinado — e deixava três
-- pontas soltas: aceitava PP com parcela já paga, mantinha a parcela dentro
-- da fatura do cartão e não apagava as escolhas da aprovação. Nenhuma tela a
-- chamava; foi usada uma vez, em 18/08/2026.
--
-- O que a reprovação desfaz:
--   • as datas que o financeiro escolheu na aprovação (4a) — o vencimento
--     negociado com o fornecedor (`data_vencimento`) fica, e a produção pode
--     mudá-lo antes de reenviar;
--   • a forma de pagamento, o cartão e o plano de contas da aprovação;
--   • os documentos congelados na aprovação (decisão 070), porque a PP volta
--     a aceitar anexo;
--   • o vínculo da parcela com a fatura ABERTA do cartão.
--
-- O que ela recusa:
--   • parcela já paga (2a): o dinheiro saiu, e desfazer isso é estorno de
--     baixa, não reprovação;
--   • parcela em fatura fechada, paga ou cancelada (3a): o financeiro reabre
--     a fatura antes — tirar a parcela de uma fatura fechada mudaria um
--     valor já cobrado.
--
-- Diferente de `aprovar_pp_com_data`, o papel é checado AQUI também: a
-- função é executável por qualquer usuário autenticado, e reprovar é do
-- financeiro e do administrador (6a).

drop function if exists public.desaprovar_pp(uuid, text);

create or replace function public.reprovar_pp_aprovada(p_pp_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid      uuid := auth.uid();
  v_pp       pedidos_compra%rowtype;
  v_papel    text;
  v_pagas    integer;
  v_fatura   text;
begin
  if p_motivo is null or char_length(btrim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_pp from public.pedidos_compra where id = p_pp_id for update;
  if not found then raise exception 'PP não encontrada.'; end if;

  select tm.role::text into v_papel
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
   where tm.user_id = v_uid
     and tm.tenant_id = v_pp.tenant_id
     and tm.status = 'ativo'
     and p.ativo = true;
  if v_papel is null then raise exception 'Sem acesso a esta PP.'; end if;
  if v_papel not in ('administrador', 'financeiro') then
    raise exception 'Só o financeiro ou um administrador reprova uma PP aprovada.';
  end if;

  if v_pp.status <> 'aprovada' then
    raise exception 'Só PP aprovada pode ser reprovada (status atual: %).', v_pp.status;
  end if;

  select count(*) into v_pagas
    from public.pedidos_compra_parcelas
   where pedido_compra_id = p_pp_id
     and pago_em is not null;
  if v_pagas > 0 then
    raise exception 'A PP já tem % parcela(s) paga(s). Estorne as baixas antes de reprovar.', v_pagas;
  end if;

  select f.codigo into v_fatura
    from public.pedidos_compra_parcelas par
    join public.faturas_cartao f on f.id = par.fatura_cartao_id
   where par.pedido_compra_id = p_pp_id
     and f.status <> 'aberta'
   limit 1;
  if v_fatura is not null then
    raise exception 'Uma parcela está na fatura % do cartão, que não está aberta. Reabra a fatura antes de reprovar.', v_fatura;
  end if;

  update public.pedidos_compra_parcelas
     set fatura_cartao_id        = null,
         data_pagamento          = null,
         data_pagamento_primeira = null
   where pedido_compra_id = p_pp_id;

  update public.pedidos_compra
     set status                     = 'rejeitada',
         rejeitada_por              = v_uid,
         rejeitada_em               = now(),
         motivo_rejeicao            = btrim(p_motivo),
         aprovada_em                = null,
         aprovada_por               = null,
         anexos_na_aprovacao        = null,
         prazo_pagamento_financeiro = null,
         forma_pagamento            = null,
         cartao_credito_id          = null,
         plano_conta_tipo_id        = null,
         plano_conta_subtipo_id     = null
   where id = p_pp_id;
end;
$$;

revoke execute on function public.reprovar_pp_aprovada(uuid, text) from public;
grant  execute on function public.reprovar_pp_aprovada(uuid, text) to authenticated;

comment on function public.reprovar_pp_aprovada(uuid, text) is
  'Financeiro reprova uma PP já aprovada: ela volta para rejeitada, com motivo, e a produção corrige e reenvia ou cancela. Recusa PP com parcela paga ou em fatura de cartão não aberta. Decisão 083.';
