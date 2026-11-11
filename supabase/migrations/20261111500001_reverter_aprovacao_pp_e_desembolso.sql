-- =============================================================================
-- 20261111500001 — Reverter a aprovação da PP e do desembolso (decisão 253)
-- =============================================================================
-- No Contas a Pagar, o financeiro reverte a aprovação de uma PP, de um
-- desembolso ou de uma linha da folha enquanto o título não tem baixa, e
-- escolhe na hora para onde ele volta:
--
--   • "avaliacao": volta para "Em avaliação", para aprovar de novo ou rejeitar;
--   • "rejeitar":  fica rejeitado, com o motivo, para quem enviou refazer.
--
-- Esta migration traz as duas funções do banco (a folha continua na action,
-- `devolverFolhaParaAprovacao`, que já desfazia a aprovação dela):
--
-- • `reverter_aprovacao_pp`: as mesmas travas da `reprovar_pp_aprovada`
--   (papel administrador ou financeiro, PP aprovada, nenhuma parcela com
--   baixa, nenhuma parcela em fatura de cartão que não esteja aberta) e o
--   mesmo desfazer da aprovação (datas das parcelas, fatura, forma de
--   pagamento, cartão, tipo e subtipo, prazo e a foto dos anexos). Em
--   "avaliacao", a PP volta para `em_avaliacao` e o "aprovar pagamento fora
--   do cadastro" é desmarcado, para ser marcado de novo na próxima aprovação.
--   O gatilho `pp_registra_evento` grava o evento `aprovacao_desfeita` (já
--   existente) e a função põe o motivo nele. Em "rejeitar", chama a própria
--   `reprovar_pp_aprovada`, que segue valendo.
-- • `reverter_aprovacao_desembolso`: papel administrador ou financeiro,
--   desembolso aprovado, nenhuma parcela paga. Desfaz as datas de pagamento
--   das parcelas e a forma de pagamento, como a aprovação as gravou.
--
-- Remessa: por decisão do Tiago (10/11/2026), o arquivo de remessa não trava
-- a reversão da PP e do desembolso — hoje não há registro de remessa gerada e
-- descartada. (A folha mantém a trava que já tinha: lá a reversão apaga o
-- título, e o item da remessa ficaria apontando para nada.)
--
-- Mudança ADITIVA: só duas funções novas. EXECUTE para `authenticated`, nada
-- para `anon`.
-- =============================================================================

create or replace function public.reverter_aprovacao_pp(
  p_pp_id   uuid,
  p_destino text,
  p_motivo  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_pp     pedidos_compra%rowtype;
  v_papel  text;
  v_pagas  integer;
  v_fatura text;
begin
  if p_destino not in ('avaliacao', 'rejeitar') then
    raise exception 'Escolha para onde a PP volta.';
  end if;

  if p_destino = 'rejeitar' then
    -- A reprovação de PP aprovada que já existia: mesmas travas, mesmo efeito.
    perform public.reprovar_pp_aprovada(p_pp_id, p_motivo);
    return;
  end if;

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
    raise exception 'Só o financeiro ou um administrador reverte a aprovação de uma PP.';
  end if;

  if v_pp.status <> 'aprovada' then
    raise exception 'Só PP aprovada pode ter a aprovação revertida (status atual: %).', v_pp.status;
  end if;

  select count(*) into v_pagas
    from public.pedidos_compra_parcelas par
   where par.pedido_compra_id = p_pp_id
     and (
       par.pago_em is not null
       or exists (
         select 1 from public.lancamentos_financeiros l
          where l.pedido_compra_parcela_id = par.id and l.origem = 'pp_baixa'
       )
     );
  if v_pagas > 0 then
    raise exception 'A PP já tem % parcela(s) com baixa. Cancele as baixas antes de reverter.', v_pagas;
  end if;

  select f.codigo into v_fatura
    from public.pedidos_compra_parcelas par
    join public.faturas_cartao f on f.id = par.fatura_cartao_id
   where par.pedido_compra_id = p_pp_id
     and f.status <> 'aberta'
   limit 1;
  if v_fatura is not null then
    raise exception 'Uma parcela está na fatura % do cartão, que não está aberta. Reabra a fatura antes de reverter.', v_fatura;
  end if;

  update public.pedidos_compra_parcelas
     set fatura_cartao_id        = null,
         data_pagamento          = null,
         data_pagamento_primeira = null
   where pedido_compra_id = p_pp_id;

  update public.pedidos_compra
     set status                                 = 'em_avaliacao',
         aprovada_em                            = null,
         aprovada_por                           = null,
         anexos_na_aprovacao                    = null,
         prazo_pagamento_financeiro             = null,
         forma_pagamento                        = null,
         cartao_credito_id                      = null,
         plano_conta_tipo_id                    = null,
         plano_conta_subtipo_id                 = null,
         pagamento_fora_do_cadastro_aprovado_por = null,
         pagamento_fora_do_cadastro_aprovado_em  = null
   where id = p_pp_id;

  -- O gatilho acabou de gravar o `aprovacao_desfeita` (com now(), o mesmo
  -- instante desta transação): o motivo entra nele.
  update public.pedidos_compra_eventos
     set motivo = btrim(p_motivo)
   where pedido_compra_id = p_pp_id
     and evento = 'aprovacao_desfeita'
     and em = now()
     and motivo is null;
end;
$$;

comment on function public.reverter_aprovacao_pp(uuid, text, text) is
  'Decisão 253: reverte a aprovação de uma PP sem baixa — volta para avaliação (motivo no evento aprovacao_desfeita) ou rejeita (reprovar_pp_aprovada). Só administrador ou financeiro.';

revoke all on function public.reverter_aprovacao_pp(uuid, text, text) from public, anon;
grant execute on function public.reverter_aprovacao_pp(uuid, text, text) to authenticated;


create or replace function public.reverter_aprovacao_desembolso(
  p_desembolso_id uuid,
  p_destino       text,
  p_motivo        text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_d     desembolsos%rowtype;
  v_papel text;
  v_pagas integer;
begin
  if p_destino not in ('avaliacao', 'rejeitar') then
    raise exception 'Escolha para onde o desembolso volta.';
  end if;
  if p_motivo is null or char_length(btrim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_d from public.desembolsos where id = p_desembolso_id for update;
  if not found then raise exception 'Desembolso não encontrado.'; end if;

  select tm.role::text into v_papel
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
   where tm.user_id = v_uid
     and tm.tenant_id = v_d.tenant_id
     and tm.status = 'ativo'
     and p.ativo = true;
  if v_papel is null then raise exception 'Sem acesso a este desembolso.'; end if;
  if v_papel not in ('administrador', 'financeiro') then
    raise exception 'Só o financeiro ou um administrador reverte a aprovação de um desembolso.';
  end if;

  if v_d.status <> 'aprovada' then
    raise exception 'Só desembolso aprovado pode ter a aprovação revertida (status atual: %).', v_d.status;
  end if;

  select count(*) into v_pagas
    from public.desembolsos_parcelas par
   where par.desembolso_id = p_desembolso_id
     and (
       par.pago_em is not null
       or exists (select 1 from public.lancamentos_financeiros l where l.desembolso_parcela_id = par.id)
     );
  if v_pagas > 0 then
    raise exception 'O desembolso já tem % parcela(s) com baixa. Cancele as baixas antes de reverter.', v_pagas;
  end if;

  update public.desembolsos_parcelas
     set data_pagamento          = null,
         data_pagamento_primeira = null
   where desembolso_id = p_desembolso_id;

  if p_destino = 'avaliacao' then
    update public.desembolsos
       set status            = 'em_avaliacao',
           aprovada_em       = null,
           aprovada_por      = null,
           forma_pagamento   = null,
           cartao_credito_id = null
     where id = p_desembolso_id;
  else
    update public.desembolsos
       set status            = 'rejeitada',
           motivo_rejeicao   = btrim(p_motivo),
           rejeitada_por     = v_uid,
           rejeitada_em      = now(),
           aprovada_em       = null,
           aprovada_por      = null,
           forma_pagamento   = null,
           cartao_credito_id = null
     where id = p_desembolso_id;
  end if;
end;
$$;

comment on function public.reverter_aprovacao_desembolso(uuid, text, text) is
  'Decisão 253: reverte a aprovação de um desembolso sem baixa — volta para avaliação ou rejeita, com motivo. Só administrador ou financeiro.';

revoke all on function public.reverter_aprovacao_desembolso(uuid, text, text) from public, anon;
grant execute on function public.reverter_aprovacao_desembolso(uuid, text, text) to authenticated;
