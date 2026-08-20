-- Racional: baixa em lote da fatura do cartão de crédito. Recebe um array
-- jsonb de títulos mistos (origem 'pp', 'avulso' ou 'recorrencia') e despacha
-- cada item para a RPC de baixa individual correspondente — dentro de uma única
-- transação PL/pgSQL. Falha em qualquer item aborta todos: a fatura do cartão
-- é tratada como unidade atômica, seja ela completa ou não.
--
-- Reutiliza as constraints uniques de idempotência já existentes:
--   uniq_baixa_ativa_por_parcela, uniq_baixa_ativa_por_avulsa,
--   uniq_baixa_ativa_por_pp_sem_parcela.
--
-- Chamado pela server action `darBaixaLoteCartao` (actions-cartao.ts).
-- Ver spec seções 3.7 e 4.4.
--
-- Deliberadamente fora de escopo: validação de tenant cruzado entre títulos
-- (as RPCs internas já validam is_tenant_member + empresa_id), e lock
-- otimista de concorrência (o unique de baixa ativa cobre o caso).

create or replace function dar_baixa_lote_cartao(
  p_titulos              jsonb,
  p_pago_em              date,
  p_conta_bancaria_id    uuid,
  p_plano_conta_tipo_id  uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por           uuid
) returns uuid[]
language plpgsql
security invoker
as $$
declare
  v_titulo  jsonb;
  v_origem  text;
  v_id      uuid;
  v_lanc    uuid;
  v_ids     uuid[] := '{}';
begin
  if jsonb_typeof(p_titulos) <> 'array' then
    raise exception 'p_titulos deve ser array jsonb';
  end if;
  if jsonb_array_length(p_titulos) = 0 then
    raise exception 'Nenhum título selecionado';
  end if;

  for v_titulo in select * from jsonb_array_elements(p_titulos) loop
    v_origem := v_titulo->>'origem';
    v_id     := (v_titulo->>'id')::uuid;

    if v_origem = 'pp' then
      v_lanc := dar_baixa_pp_parcela(
        v_id,
        p_pago_em,
        p_conta_bancaria_id,
        p_plano_conta_tipo_id,
        p_plano_conta_subtipo_id,
        p_criado_por
      );
    elsif v_origem in ('avulso', 'recorrencia') then
      v_lanc := dar_baixa_avulsa_com_plano(
        v_id,
        p_pago_em,
        p_conta_bancaria_id,
        p_plano_conta_tipo_id,
        p_plano_conta_subtipo_id
      );
    else
      raise exception 'origem desconhecida: %', v_origem;
    end if;

    v_ids := v_ids || v_lanc;
  end loop;

  return v_ids;
end;
$$;

grant execute on function
  dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid)
  to authenticated;
