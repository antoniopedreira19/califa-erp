-- =====================================================================
-- A fatura fechada volta a abrir, e a paga volta a fechada
--
-- Faltava o caminho de volta. Fechar era porta de mão única: se o valor
-- não batesse com o banco, ou se aparecesse uma compra retroativa depois
-- do fechamento, não havia o que fazer — a compra ia para a competência
-- seguinte e a fatura ficava errada para sempre.
--
--     aberta  ⇄  fechada  ⇄  paga
--             reabrir     estornar
--
-- REABRIR desfaz o FECHAMENTO. Os lançamentos do fechamento são
-- derivados: nascem inteiros, deterministicamente, a partir dos itens da
-- fatura, e nenhum deles corresponde a dinheiro que saiu do banco — a
-- fatura ainda não foi paga. Então reabrir os APAGA, e o fechamento
-- seguinte os recria. Contra-lançar aqui encheria o razão do cartão de
-- pares +150/−150 a cada correção, sem nenhum ganho.
--
-- ESTORNAR desfaz o PAGAMENTO, e aí o dinheiro saiu de verdade. Esse não
-- se apaga: ganha contra-lançamento, como toda baixa estornada no
-- sistema, porque o extrato do banco também mostra as duas pernas.
--
-- Fatura paga não reabre direto: primeiro estorna o pagamento, depois
-- reabre. A RPC recusa e diz isso.
--
-- Quem separa um caso do outro é `papel_na_fatura`, da migration
-- anterior — sem ela seria preciso deduzir por conta, origem e forma de
-- pagamento, uma dedução que quebraria em silêncio no dia em que alguém
-- mudasse qualquer um dos três.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Reabrir: desfaz o fechamento
-- ---------------------------------------------------------------------
create or replace function public.reabrir_fatura_cartao(
  p_fatura_id uuid,
  p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_uid uuid;
  v_fatura     faturas_cartao%rowtype;
  v_apagados   integer;
  v_voltaram   integer;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  if p_motivo is null or length(btrim(p_motivo)) < 3 then
    raise exception 'Diga por que a fatura está sendo reaberta.';
  end if;

  select * into v_fatura from faturas_cartao where id = p_fatura_id;
  if not found then raise exception 'Fatura não encontrada.'; end if;

  if not is_tenant_member(v_fatura.tenant_id) then
    raise exception 'Sem permissão nesta fatura.';
  end if;

  if v_fatura.status = 'aberta' then
    raise exception 'A fatura % já está aberta.', v_fatura.codigo;
  end if;
  if v_fatura.status = 'paga' then
    raise exception
      'A fatura % já foi paga. Estorne a baixa dela primeiro — reabrir sem isso deixaria o extrato do banco com um pagamento sem fatura.',
      v_fatura.codigo;
  end if;

  -- Apaga só o que o fechamento criou. `papel_na_fatura` existe
  -- justamente para não precisar deduzir isto por conta e origem.
  delete from lancamentos_financeiros
   where fatura_cartao_id = p_fatura_id
     and papel_na_fatura in ('item', 'ajuste');
  get diagnostics v_apagados = row_count;

  -- Os itens voltam a "aprovada": eles estão de novo esperando o
  -- fechamento, e é assim que a aba Cartão volta a mostrá-los.
  update contas_avulsas
     set status = 'aprovada',
         pago_em = null,
         pago_por = null,
         conta_bancaria_baixa_id = null
   where fatura_cartao_id = p_fatura_id
     and status = 'baixada';
  get diagnostics v_voltaram = row_count;

  update faturas_cartao
     set status = 'aberta',
         valor_cobrado = null,
         fechada_em = null,
         fechada_por = null
   where id = p_fatura_id;

  insert into audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_fatura.tenant_id, 'fatura_cartao', p_fatura_id::text,
    'fatura_cartao.reaberta', v_caller_uid,
    jsonb_build_object(
      'codigo', v_fatura.codigo,
      'motivo', btrim(p_motivo),
      'valor_cobrado_anterior', v_fatura.valor_cobrado,
      'lancamentos_apagados', v_apagados,
      'itens_reabertos', v_voltaram
    )
  );

  return p_fatura_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- Estornar o pagamento: desfaz a baixa, sem apagar nada
-- ---------------------------------------------------------------------
create or replace function public.estornar_baixa_fatura_cartao(
  p_fatura_id uuid,
  p_motivo text
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_uid uuid;
  v_fatura     faturas_cartao%rowtype;
  v_pag        record;
  v_novo       uuid;
  v_ids        uuid[] := '{}';
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  if p_motivo is null or length(btrim(p_motivo)) < 3 then
    raise exception 'Diga por que a baixa está sendo estornada.';
  end if;

  select * into v_fatura from faturas_cartao where id = p_fatura_id;
  if not found then raise exception 'Fatura não encontrada.'; end if;

  if not is_tenant_member(v_fatura.tenant_id) then
    raise exception 'Sem permissão nesta fatura.';
  end if;

  if v_fatura.status <> 'paga' then
    raise exception 'Só fatura paga tem baixa para estornar (status atual: %).', v_fatura.status;
  end if;

  -- Contra-lançamento, não delete: aqui o dinheiro saiu de verdade, e o
  -- extrato do banco também vai mostrar as duas pernas.
  for v_pag in
    select * from lancamentos_financeiros
     where fatura_cartao_id = p_fatura_id
       and papel_na_fatura = 'pagamento'
     order by created_at
  loop
    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      forma_pagamento, cartao_credito_id, fatura_cartao_id, papel_na_fatura,
      origem, criado_por
    ) values (
      v_pag.tenant_id, v_pag.empresa_id, v_pag.conta_bancaria_id,
      current_date, v_pag.valor,
      case when v_pag.natureza = 'saida' then 'entrada' else 'saida' end::natureza_lancamento,
      'Estorno · ' || substring(v_pag.descricao, 1, 170),
      v_pag.plano_conta_tipo_id, v_pag.plano_conta_subtipo_id,
      null, v_fatura.cartao_credito_id, p_fatura_id, 'pagamento_estorno',
      'manual', v_caller_uid
    )
    returning id into v_novo;

    v_ids := v_ids || v_novo;
  end loop;

  if array_length(v_ids, 1) is null then
    raise exception 'A fatura % está paga mas não tem lançamento de pagamento. Avise o suporte.', v_fatura.codigo;
  end if;

  update faturas_cartao set status = 'fechada' where id = p_fatura_id;

  insert into audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_fatura.tenant_id, 'fatura_cartao', p_fatura_id::text,
    'fatura_cartao.baixa_estornada', v_caller_uid,
    jsonb_build_object(
      'codigo', v_fatura.codigo,
      'motivo', btrim(p_motivo),
      'valor', v_fatura.valor_cobrado,
      'lancamentos', to_jsonb(v_ids)
    )
  );

  return v_ids;
end;
$function$;

revoke execute on function public.fechar_fatura_cartao(uuid, numeric, uuid, uuid, text) from public;
grant  execute on function public.fechar_fatura_cartao(uuid, numeric, uuid, uuid, text) to authenticated;

revoke execute on function public.dar_baixa_fatura_cartao(uuid, date, uuid, uuid, uuid) from public;
grant  execute on function public.dar_baixa_fatura_cartao(uuid, date, uuid, uuid, uuid) to authenticated;

revoke execute on function public.reabrir_fatura_cartao(uuid, text) from public;
grant  execute on function public.reabrir_fatura_cartao(uuid, text) to authenticated;

revoke execute on function public.estornar_baixa_fatura_cartao(uuid, text) from public;
grant  execute on function public.estornar_baixa_fatura_cartao(uuid, text) to authenticated;
