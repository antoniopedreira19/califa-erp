-- Decisão 136 (01/10/2026): qualquer GP age em qualquer job.
--
-- A prestação de contas da verba de produção era aceita do responsável
-- pela verba, do GP RESPONSÁVEL do job ou de um administrador (decisão 081).
-- Com vários GPs cobrindo os mesmos jobs (férias, por exemplo), a regra
-- passa a ser: o responsável pela verba, QUALQUER GP ou um administrador.
--
-- Só muda a checagem de quem pode prestar contas; o resto da função é a
-- versão de `20260915170001_verba_devolucao_total_sem_documento.sql`,
-- copiada sem alteração. Quem enviou a prestação continua gravado em
-- `pp_verba_prestacoes.fechada_por`.

create or replace function public.enviar_prestacao_verba(
  p_pp_id uuid,
  p_documentos jsonb,
  p_sem_gasto boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid          uuid := auth.uid();
  v_pp           pedidos_compra%rowtype;
  v_papel        text;
  v_prest        pp_verba_prestacoes%rowtype;
  v_prest_id     uuid;
  v_doc          jsonb;
  v_valor        numeric;
  v_soma         numeric(14,2) := 0;
  v_prefixo      text;
  v_ids_mantidos uuid[];
begin
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

  if v_pp.verba_producao is not true then
    raise exception 'Esta PP não é de verba de produção.';
  end if;
  if v_pp.status <> 'pago' then
    raise exception 'A prestação de contas abre depois que a verba estiver paga.';
  end if;

  -- Decisão 136: qualquer GP, e não só o responsável do job.
  if not (
    v_papel in ('administrador', 'gerente_producao')
    or v_pp.responsavel_verba_id = v_uid
  ) then
    raise exception 'Só o responsável pela verba, um GP ou um administrador presta contas desta verba.';
  end if;

  select * into v_prest
    from public.pp_verba_prestacoes
   where pedido_compra_id = p_pp_id
   for update;
  if found and v_prest.status = 'em_avaliacao' then
    raise exception 'A prestação desta verba já está com o financeiro.';
  end if;
  if found and v_prest.status = 'aprovada' then
    raise exception 'A prestação desta verba já foi aprovada.';
  end if;

  if coalesce(p_sem_gasto, false) then
    if p_documentos is not null
       and jsonb_typeof(p_documentos) = 'array'
       and jsonb_array_length(p_documentos) > 0 then
      raise exception 'Sem gasto, a prestação vai sem documento. Retire os documentos ou desmarque "não houve gasto".';
    end if;
    p_documentos := '[]'::jsonb;
  elsif p_documentos is null
     or jsonb_typeof(p_documentos) <> 'array'
     or jsonb_array_length(p_documentos) = 0 then
    raise exception 'Anexe ao menos um documento — NF ou recibo.';
  end if;

  v_prefixo := v_pp.tenant_id::text || '/verba-prestacoes/' || v_pp.id::text || '/';

  -- Valida o conjunto inteiro antes de gravar qualquer coisa.
  for v_doc in select value from jsonb_array_elements(p_documentos) loop
    v_valor := nullif(v_doc->>'valor', '')::numeric;
    if v_valor is null or v_valor <= 0 then
      raise exception 'Informe o valor de cada documento.';
    end if;
    if coalesce(v_doc->>'documento_tipo', '') not in ('nota_fiscal', 'recibo') then
      raise exception 'Só NF e recibo comprovam gasto da verba.';
    end if;
    if nullif(v_doc->>'id', '') is not null then
      if v_prest.id is null or not exists (
        select 1 from public.pp_verba_prestacoes_anexos a
         where a.id = (v_doc->>'id')::uuid and a.prestacao_id = v_prest.id
      ) then
        raise exception 'Documento não pertence a esta prestação.';
      end if;
    else
      if left(coalesce(v_doc->>'path', ''), length(v_prefixo)) <> v_prefixo then
        raise exception 'Documento em caminho inválido.';
      end if;
      if coalesce(btrim(v_doc->>'nome_original'), '') = ''
         or coalesce(nullif(v_doc->>'tamanho_bytes', '')::bigint, 0) <= 0
         or coalesce(v_doc->>'mimetype', '') = '' then
        raise exception 'Documento sem arquivo válido.';
      end if;
    end if;
    v_soma := v_soma + round(v_valor, 2);
  end loop;

  if v_soma > v_pp.valor then
    raise exception 'Os documentos somam R$ %, acima da verba de R$ %. O excedente precisa de uma PP nova.',
      translate(to_char(v_soma, 'FM999,999,999,990.00'), ',.', '.,'),
      translate(to_char(v_pp.valor, 'FM999,999,999,990.00'), ',.', '.,');
  end if;

  if v_prest.id is null then
    insert into public.pp_verba_prestacoes (
      tenant_id, pedido_compra_id, valor_gasto, valor_devolvido, fechada_por, status
    ) values (
      v_pp.tenant_id, v_pp.id, v_soma, v_pp.valor - v_soma, v_uid, 'em_avaliacao'
    )
    returning id into v_prest_id;
  else
    v_prest_id := v_prest.id;
    update public.pp_verba_prestacoes
       set valor_gasto     = v_soma,
           valor_devolvido = v_pp.valor - v_soma,
           status          = 'em_avaliacao',
           fechada_em      = now(),
           fechada_por     = v_uid
     where id = v_prest_id;
  end if;

  select coalesce(array_agg((d.value->>'id')::uuid), '{}')
    into v_ids_mantidos
    from jsonb_array_elements(p_documentos) d
   where nullif(d.value->>'id', '') is not null;

  delete from public.pp_verba_prestacoes_anexos
   where prestacao_id = v_prest_id
     and not (id = any (v_ids_mantidos));

  for v_doc in select value from jsonb_array_elements(p_documentos) loop
    if nullif(v_doc->>'id', '') is not null then
      update public.pp_verba_prestacoes_anexos
         set documento_tipo   = (v_doc->>'documento_tipo')::documento_tipo,
             documento_numero = nullif(btrim(coalesce(v_doc->>'documento_numero', '')), ''),
             valor            = round((v_doc->>'valor')::numeric, 2)
       where id = (v_doc->>'id')::uuid;
    else
      insert into public.pp_verba_prestacoes_anexos (
        tenant_id, prestacao_id, arquivo_path, arquivo_nome_original,
        arquivo_tamanho_bytes, arquivo_mimetype, documento_tipo,
        documento_numero, valor, created_by
      ) values (
        v_pp.tenant_id, v_prest_id, v_doc->>'path', btrim(v_doc->>'nome_original'),
        (v_doc->>'tamanho_bytes')::bigint, v_doc->>'mimetype',
        (v_doc->>'documento_tipo')::documento_tipo,
        nullif(btrim(coalesce(v_doc->>'documento_numero', '')), ''),
        round((v_doc->>'valor')::numeric, 2), v_uid
      );
    end if;
  end loop;

  return v_prest_id;
end;
$function$;

comment on function public.enviar_prestacao_verba(uuid, jsonb, boolean) is
  'Prestação de contas da verba de produção. Presta o responsável pela verba, qualquer GP ou um administrador (decisão 136; até 01/10/2026 era o GP responsável do job).';
