-- =====================================================================
-- RPC transacional pra emitir NF + criar N titulos filhos.
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

create or replace function public.emitir_faturamento(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id     uuid := (payload->>'tenant_id')::uuid;
  v_empresa_id    uuid := (payload->>'empresa_id')::uuid;
  v_origem_tipo   faturamento_origem := (payload->>'origem_tipo')::faturamento_origem;
  v_origem_id     uuid := nullif(payload->>'origem_id', '')::uuid;
  v_cliente_id    uuid := nullif(payload->>'cliente_id', '')::uuid;
  v_fornecedor_id uuid := nullif(payload->>'fornecedor_id', '')::uuid;
  v_valor_total   numeric(14,2) := (payload->>'valor_total')::numeric;
  v_tipo_id       uuid := (payload->>'plano_conta_tipo_id')::uuid;
  v_subtipo_id    uuid := (payload->>'plano_conta_subtipo_id')::uuid;
  v_emitido_por   uuid := (payload->>'emitido_por')::uuid;
  v_faturamento_id uuid;
  v_parcelas      jsonb := payload->'parcelas';
  v_soma_parcelas numeric(14,2) := 0;
  v_parcela       jsonb;
  v_subtipo_tipo  uuid;
begin
  if not public.is_tenant_member(v_tenant_id) then
    raise exception 'Sem acesso a este tenant.';
  end if;

  if jsonb_array_length(v_parcelas) < 1 then
    raise exception 'Faturamento precisa de pelo menos uma parcela.';
  end if;

  -- Valida subtipo pertence ao tipo
  select tipo_id into v_subtipo_tipo
    from public.plano_contas_subtipos where id = v_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> v_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  -- Soma parcelas e valida bate com valor_total
  for v_parcela in select * from jsonb_array_elements(v_parcelas)
  loop
    v_soma_parcelas := v_soma_parcelas + (v_parcela->>'valor')::numeric;
  end loop;

  if abs(v_soma_parcelas - v_valor_total) > 0.01 then
    raise exception 'Soma das parcelas (R$ %) não bate com valor total (R$ %).',
      v_soma_parcelas, v_valor_total;
  end if;

  -- INSERT faturamento
  insert into public.faturamentos (
    tenant_id, empresa_id, origem_tipo, origem_id,
    cliente_id, fornecedor_id,
    numero_nf, serie, data_emissao, valor_total, descricao,
    anexo_nf_path, plano_conta_tipo_id, plano_conta_subtipo_id,
    emitido_por
  ) values (
    v_tenant_id, v_empresa_id, v_origem_tipo, v_origem_id,
    v_cliente_id, v_fornecedor_id,
    payload->>'numero_nf', payload->>'serie',
    (payload->>'data_emissao')::date, v_valor_total, payload->>'descricao',
    payload->>'anexo_nf_path', v_tipo_id, v_subtipo_id,
    v_emitido_por
  )
  returning id into v_faturamento_id;

  -- INSERT parcelas
  for v_parcela in select * from jsonb_array_elements(v_parcelas)
  loop
    insert into public.titulos_receber (
      tenant_id, empresa_id, faturamento_id,
      numero_parcela, valor, data_vencimento
    ) values (
      v_tenant_id, v_empresa_id, v_faturamento_id,
      (v_parcela->>'numero')::smallint,
      (v_parcela->>'valor')::numeric,
      (v_parcela->>'data_vencimento')::date
    );
  end loop;

  return v_faturamento_id;
end;
$$;

grant execute on function public.emitir_faturamento(jsonb) to authenticated;
