-- ===========================================================================
-- Devolução total sem documento: a verba que não foi gasta
-- ===========================================================================
-- Decisão 081, nota de 15/09/2026 (Tiago: "crie o caminho de devolução total
-- sem documento").
--
-- Até aqui a prestação exigia ao menos um documento com valor, e a verba que
-- não foi gasta não tinha como ser prestada. Agora a produção marca "não
-- houve gasto": a prestação vai sem documento, com gasto zero, e a aprovação
-- cria o estorno da verba inteira — pelo mesmo caminho de sempre.
--
-- O "sem gasto" é EXPLÍCITO (parâmetro `p_sem_gasto`), e não deduzido de uma
-- lista vazia: mandar a lista vazia sem marcar continua recusado, e marcar com
-- documento também.
--
-- Muda uma trava da prestação: `valor_gasto` passa de > 0 para >= 0. A
-- coerência "gasto zero só sem documento" fica na função, porque cada
-- documento continua valendo mais que zero.

alter table public.pp_verba_prestacoes
  drop constraint chk_prestacao_valor_gasto_positivo,
  add constraint chk_prestacao_valor_gasto_nao_negativo check (valor_gasto >= 0);

-- A assinatura ganha um parâmetro: a de dois parâmetros sai para não ficar
-- uma sobrecarga antiga que ignora o "sem gasto".
drop function public.enviar_prestacao_verba(uuid, jsonb);

create function public.enviar_prestacao_verba(
  p_pp_id uuid,
  p_documentos jsonb,
  p_sem_gasto boolean default false
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid          uuid := auth.uid();
  v_pp           pedidos_compra%rowtype;
  v_papel        text;
  v_resp_job     uuid;
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

  select responsavel_id into v_resp_job from public.jobs where id = v_pp.job_id;
  if not (
    v_papel = 'administrador'
    or v_pp.responsavel_verba_id = v_uid
    or v_resp_job = v_uid
  ) then
    raise exception 'Só o responsável pela verba, o responsável do job ou um administrador presta contas desta verba.';
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
$$;

revoke execute on function public.enviar_prestacao_verba(uuid, jsonb, boolean) from public;
grant  execute on function public.enviar_prestacao_verba(uuid, jsonb, boolean) to authenticated;

comment on function public.enviar_prestacao_verba(uuid, jsonb, boolean) is
  'Produção envia (ou reenvia, se reprovada) a prestação da verba paga: documentos NF/recibo com valor, gasto = soma, nunca acima da verba — ou, com p_sem_gasto, sem documento e com a verba inteira a devolver. Decisão 081.';
comment on column public.pp_verba_prestacoes.valor_gasto is
  'Soma dos valores dos documentos. Nunca passa do valor da PP (decisão 081, 5a). Zero quando a produção declarou que não houve gasto — aí a prestação não tem documento.';
