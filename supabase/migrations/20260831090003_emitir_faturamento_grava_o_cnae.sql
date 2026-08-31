-- ---------------------------------------------------------------------------
-- `emitir_faturamento` passa a gravar o CNAE da nota.
--
-- Terceira da trinca de 31/08/2026: a 090001 tirou o CNAE do envio, a
-- 090002 criou `faturamentos.cnae` como NOT NULL, e sem esta a emissão
-- quebraria — a RPC monta o INSERT com a lista de colunas explícita, então
-- a coluna nova não entraria sozinha e o NOT NULL barraria toda emissão.
--
-- A checagem do CNAE vem ANTES de qualquer escrita, junto das outras
-- validações de entrada, para o erro sair em português em vez de vazar
-- como violação de constraint. O `nullif(trim(...))` cobre os dois vazios
-- que o payload pode trazer: ausente e string em branco.
--
-- O resto da função é idêntico ao que já estava no banco.
-- ---------------------------------------------------------------------------

create or replace function public.emitir_faturamento(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id      uuid := (payload->>'tenant_id')::uuid;
  v_empresa_id     uuid := (payload->>'empresa_id')::uuid;
  v_origem_tipo    faturamento_origem := (payload->>'origem_tipo')::faturamento_origem;
  v_origem_id      uuid := nullif(payload->>'origem_id', '')::uuid;
  v_cliente_id     uuid := nullif(payload->>'cliente_id', '')::uuid;
  v_fornecedor_id  uuid := nullif(payload->>'fornecedor_id', '')::uuid;
  v_valor_total    numeric(14,2) := (payload->>'valor_total')::numeric;
  v_tipo_id        uuid := nullif(payload->>'plano_conta_tipo_id', '')::uuid;
  v_subtipo_id     uuid := nullif(payload->>'plano_conta_subtipo_id', '')::uuid;
  v_emitido_por    uuid := (payload->>'emitido_por')::uuid;
  -- Novo em 31/08/2026: classificação fiscal da nota, informada pelo
  -- financeiro no drawer "Faturar".
  v_cnae           text := nullif(trim(payload->>'cnae'), '');
  v_faturamento_id uuid;
  v_parcelas       jsonb := payload->'parcelas';
  v_itens          jsonb := coalesce(payload->'itens', '[]'::jsonb);
  v_soma_parcelas  numeric(14,2) := 0;
  v_soma_itens     numeric(14,2) := 0;
  v_parcela        jsonb;
  v_item           jsonb;
  v_subtipo_tipo   uuid;
  v_par            jobs_envio_faturamento_parcelas%rowtype;
  v_ja             numeric(14,2);
  v_saldo          numeric(14,2);
  v_codigo         text;
  v_save_previsto  numeric(14,2);
  v_save_ja        numeric(14,2);
begin
  if not public.is_tenant_member(v_tenant_id) then
    raise exception 'Sem acesso a este tenant.';
  end if;

  if v_cnae is null then
    raise exception 'Informe o CNAE a ser utilizado na nota.';
  end if;

  if jsonb_array_length(v_parcelas) < 1 then
    raise exception 'Faturamento precisa de pelo menos uma parcela.';
  end if;

  if v_tipo_id is not null or v_subtipo_id is not null then
    if v_tipo_id is null or v_subtipo_id is null then
      raise exception 'Informe tipo e subtipo juntos, ou nenhum dos dois.';
    end if;
    select tipo_id into v_subtipo_tipo
      from public.plano_contas_subtipos where id = v_subtipo_id;
    if not found then raise exception 'Subtipo não encontrado.'; end if;
    if v_subtipo_tipo <> v_tipo_id then
      raise exception 'Subtipo não pertence ao tipo escolhido.';
    end if;
  end if;

  if jsonb_array_length(v_itens) = 0 then
    if v_origem_tipo = 'avulso' then
      v_itens := jsonb_build_array(jsonb_build_object(
        'origem_tipo', 'avulso', 'origem_id', null,
        'envio_parcela_id', null, 'valor', v_valor_total));
    else
      v_itens := jsonb_build_array(jsonb_build_object(
        'origem_tipo', v_origem_tipo, 'origem_id', v_origem_id,
        'envio_parcela_id', null, 'valor', v_valor_total));
    end if;
  end if;

  for v_parcela in select * from jsonb_array_elements(v_parcelas)
  loop
    v_soma_parcelas := v_soma_parcelas + (v_parcela->>'valor')::numeric;
  end loop;

  if abs(v_soma_parcelas - v_valor_total) > 0.01 then
    raise exception 'Soma das parcelas (R$ %) não bate com valor total (R$ %).',
      v_soma_parcelas, v_valor_total;
  end if;

  for v_item in select * from jsonb_array_elements(v_itens)
  loop
    v_soma_itens := v_soma_itens + (v_item->>'valor')::numeric;
  end loop;

  if abs(v_soma_itens - v_valor_total) > 0.01 then
    raise exception 'Soma dos jobs desta NF (R$ %) não bate com o valor total (R$ %).',
      v_soma_itens, v_valor_total;
  end if;

  for v_item in select * from jsonb_array_elements(v_itens)
  loop
    if nullif(v_item->>'envio_parcela_id', '') is not null then
      select * into v_par
        from public.jobs_envio_faturamento_parcelas
       where id = (v_item->>'envio_parcela_id')::uuid;
      if not found then
        raise exception 'Parcela de faturamento não encontrada.';
      end if;
      if v_par.tenant_id <> v_tenant_id then
        raise exception 'Parcela de faturamento de outro tenant.';
      end if;

      select coalesce(sum(fi.valor), 0)::numeric(14,2) into v_ja
        from public.faturamento_itens fi
        join public.faturamentos f on f.id = fi.faturamento_id
       where fi.envio_parcela_id = v_par.id
         and f.status = 'emitido';

      v_saldo := v_par.valor - v_ja;
      if (v_item->>'valor')::numeric > v_saldo + 0.01 then
        select codigo into v_codigo from public.jobs where id = v_par.job_id;
        raise exception
          '% (parcela %): o valor a faturar (R$ %) não pode ser maior que o saldo a faturar (R$ %).',
          coalesce(v_codigo, 'Job'), v_par.ordem,
          (v_item->>'valor')::numeric, v_saldo;
      end if;
    end if;

    if (v_item->>'origem_tipo') = 'save' then
      if v_par.job_id is distinct from (v_item->>'origem_id')::uuid then
        raise exception 'O saldo em save só pode ser faturado na nota do job que o gerou.';
      end if;

      select coalesce(faturamento_save_previsto, 0)::numeric(14,2) into v_save_previsto
        from public.jobs where id = (v_item->>'origem_id')::uuid;

      select coalesce(sum(fi.valor), 0)::numeric(14,2) into v_save_ja
        from public.faturamento_itens fi
        join public.faturamentos f on f.id = fi.faturamento_id
       where fi.origem_tipo = 'save'
         and fi.origem_id = (v_item->>'origem_id')::uuid
         and f.status = 'emitido';

      if v_save_ja + (v_item->>'valor')::numeric > v_save_previsto + 0.01 then
        select codigo into v_codigo from public.jobs where id = (v_item->>'origem_id')::uuid;
        raise exception
          '% gerou R$ % de saldo em save e R$ % já saiu em nota: não cabe faturar mais R$ %.',
          coalesce(v_codigo, 'O job'), v_save_previsto, v_save_ja, (v_item->>'valor')::numeric;
      end if;
    end if;

    if (v_item->>'origem_tipo') = 'bv' then
      if exists (
        select 1 from public.faturamento_itens fi
          join public.faturamentos f on f.id = fi.faturamento_id
         where fi.origem_tipo = 'bv'
           and fi.origem_id = (v_item->>'origem_id')::uuid
           and f.status = 'emitido'
      ) then
        raise exception 'Este BV já foi faturado.';
      end if;
    end if;
  end loop;

  insert into public.faturamentos (
    tenant_id, empresa_id, origem_tipo, origem_id,
    cliente_id, fornecedor_id,
    numero_nf, serie, data_emissao, valor_total, descricao, cnae,
    anexo_nf_path, plano_conta_tipo_id, plano_conta_subtipo_id,
    emitido_por
  ) values (
    v_tenant_id, v_empresa_id, v_origem_tipo, v_origem_id,
    v_cliente_id, v_fornecedor_id,
    payload->>'numero_nf', coalesce(nullif(payload->>'serie', ''), '1'),
    (payload->>'data_emissao')::date, v_valor_total, payload->>'descricao', v_cnae,
    payload->>'anexo_nf_path', v_tipo_id, v_subtipo_id,
    v_emitido_por
  )
  returning id into v_faturamento_id;

  for v_item in select * from jsonb_array_elements(v_itens)
  loop
    insert into public.faturamento_itens (
      tenant_id, faturamento_id, origem_tipo, origem_id,
      envio_parcela_id, valor
    ) values (
      v_tenant_id, v_faturamento_id,
      (v_item->>'origem_tipo')::faturamento_origem,
      nullif(v_item->>'origem_id', '')::uuid,
      nullif(v_item->>'envio_parcela_id', '')::uuid,
      (v_item->>'valor')::numeric
    );
  end loop;

  for v_parcela in select * from jsonb_array_elements(v_parcelas)
  loop
    insert into public.titulos_receber (
      tenant_id, empresa_id, faturamento_id,
      numero_parcela, valor, data_vencimento,
      data_previsao_recebimento, data_previsao_recebimento_primeira
    ) values (
      v_tenant_id, v_empresa_id, v_faturamento_id,
      (v_parcela->>'numero')::smallint,
      (v_parcela->>'valor')::numeric,
      (v_parcela->>'data_vencimento')::date,
      (v_parcela->>'data_vencimento')::date,
      (v_parcela->>'data_vencimento')::date
    );
  end loop;

  return v_faturamento_id;
end;
$function$;
