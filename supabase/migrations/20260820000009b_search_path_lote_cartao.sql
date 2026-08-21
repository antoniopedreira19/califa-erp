-- Patch: adiciona set search_path = public em dar_baixa_lote_cartao.
-- A função já estava na migration 20260820000009, mas faltou o search_path.
-- Re-aplicar com search_path (padrão do projeto).

create or replace function dar_baixa_lote_cartao(
  p_titulos jsonb,
  p_pago_em date,
  p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por uuid
) returns uuid[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_titulo jsonb;
  v_origem text;
  v_id uuid;
  v_lanc uuid;
  v_ids uuid[] := '{}';
begin
  if jsonb_typeof(p_titulos) <> 'array' then
    raise exception 'p_titulos deve ser array jsonb';
  end if;
  if jsonb_array_length(p_titulos) = 0 then
    raise exception 'Nenhum título selecionado';
  end if;

  for v_titulo in select * from jsonb_array_elements(p_titulos) loop
    v_origem := v_titulo->>'origem';
    v_id := (v_titulo->>'id')::uuid;

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
    elsif v_origem = 'desembolso' then
      v_lanc := dar_baixa_desembolso_parcela(
        v_id,
        p_pago_em,
        p_conta_bancaria_id,
        p_plano_conta_tipo_id,
        p_plano_conta_subtipo_id,
        p_criado_por
      );
    else
      raise exception 'origem desconhecida: %', v_origem;
    end if;

    v_ids := v_ids || v_lanc;
  end loop;

  return v_ids;
end;
$$;

comment on function dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid) is
  'Baixa lote de títulos (PP, avulsos, recorrências, ou desembolsos) em uma única transação. Padrão herdado de dar_baixa_lote_pp.';

revoke execute on function dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid) from public;
grant execute on function dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid) to authenticated;
