-- =====================================================================
-- Mídia System: a prestação da PP só é aprovada depois da PP (decisão 216,
-- 26/10/2026)
-- ---------------------------------------------------------------------
-- Na verba, a prestação só existe depois do pagamento, então o financeiro
-- nunca tinha as duas conferências abertas ao mesmo tempo. Na PP da
-- auditoria, o envio da prestação não espera o pagamento (migration
-- 20261027700001): a PP que foi sem NF na véspera da liberação pode estar
-- ainda em avaliação quando a NF chega. Aprovar a prestação antes registraria
-- a NF no cadastro de notas para uma PP que o financeiro ainda pode rejeitar.
--
-- A ordem passa a ser: primeiro a PP, depois a prestação. A produção continua
-- mandando a NF quando quiser; só a aprovação espera. Reprovar a prestação
-- segue livre. Só muda o trecho marcado em `aprovar_prestacao_verba`.
-- =====================================================================

create or replace function public.aprovar_prestacao_verba(p_pp_id uuid, p_data_prevista date, p_notas jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_pp        public.pedidos_compra%rowtype;
  v_papel     text;
  v_prest     public.pp_verba_prestacoes%rowtype;
  v_dev_id    uuid;
  v_soma      numeric(14,2);
  v_saldo     numeric(14,2);
  a           public.pp_verba_prestacoes_anexos%rowtype;
  v_cfg       jsonb;
  v_sem_cred  boolean;
  v_motivo    text;
  v_forn      uuid;
  v_nota      uuid;
  v_notas     uuid[] := '{}';
  v_midia     boolean;
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id for update;
  if not found then raise exception 'PP não encontrada.'; end if;
  v_midia := public._pp_da_auditoria_liberada(v_pp);

  select tm.role::text into v_papel
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
   where tm.user_id = v_uid
     and tm.tenant_id = v_pp.tenant_id
     and tm.status = 'ativo'
     and p.ativo = true;
  if v_papel is null then raise exception 'Sem acesso a esta PP.'; end if;
  if v_papel not in ('administrador', 'financeiro') then
    raise exception 'Só administrador ou financeiro aprova prestação de contas.';
  end if;

  select * into v_prest
    from public.pp_verba_prestacoes
   where pedido_compra_id = p_pp_id
   for update;
  if not found or v_prest.status = 'rascunho' then
    raise exception 'Esta verba ainda não tem prestação de contas.';
  end if;
  if v_prest.status = 'aprovada' then
    raise exception 'Esta prestação já foi aprovada.';
  end if;
  if v_prest.status = 'reprovada' then
    raise exception 'Esta prestação foi reprovada e está com a produção.';
  end if;
  -- A PP da auditoria: primeiro a PP, depois a prestação (decisão 216).
  if v_midia and v_pp.status not in ('aprovada', 'pago') then
    raise exception 'Aprove a PP antes da prestação de contas.';
  end if;

  perform public._conferir_documentos_da_prestacao(v_prest.id);
  select coalesce(sum(valor), 0) into v_soma
    from public.pp_verba_prestacoes_anexos
   where prestacao_id = v_prest.id and valor is not null;
  if v_soma > v_pp.valor then
    if v_midia then
      raise exception 'As NFs somam R$ %, acima do valor da PP (R$ %).',
        translate(to_char(v_soma, 'FM999,999,999,990.00'), ',.', '.,'),
        translate(to_char(v_pp.valor, 'FM999,999,999,990.00'), ',.', '.,');
    end if;
    raise exception 'Os documentos somam R$ %, acima da verba de R$ %.',
      translate(to_char(v_soma, 'FM999,999,999,990.00'), ',.', '.,'),
      translate(to_char(v_pp.valor, 'FM999,999,999,990.00'), ',.', '.,');
  end if;
  -- Decisão 216: a PP da auditoria foi paga cheia ao fornecedor. Não há
  -- saldo a devolver, e o realizado do item não cai.
  v_saldo := case when v_midia then 0 else v_pp.valor - v_soma end;
  if v_saldo > 0 and p_data_prevista is null then
    raise exception 'Informe a data prevista da devolução.';
  end if;

  for a in
    select * from public.pp_verba_prestacoes_anexos
     where prestacao_id = v_prest.id and documento_tipo = 'nota_fiscal'
     order by created_at, id
  loop
    select e.value into v_cfg
      from jsonb_array_elements(case when jsonb_typeof(p_notas) = 'array' then p_notas else '[]'::jsonb end) e
     where e.value->>'documento_id' = a.id::text
     limit 1;
    v_sem_cred := coalesce((v_cfg->>'credito_retirado')::boolean, false);
    v_motivo := nullif(btrim(coalesce(v_cfg->>'credito_motivo', '')), '');
    if v_sem_cred and v_motivo is null then
      raise exception 'Escolha por que a NF % não gera crédito de PIS/COFINS.', a.documento_numero;
    end if;
    if not exists (
      select 1 from public.fiscal_estabelecimentos e
       where e.id = a.tomador_estabelecimento_id and e.tenant_id = v_pp.tenant_id and e.ativo
    ) then
      raise exception 'Escolha o CNPJ tomador da NF % entre os CNPJs ativos do cadastro de impostos.', a.documento_numero;
    end if;

    select f.id into v_forn
      from public.fornecedores f
     where f.tenant_id = v_pp.tenant_id and f.cpf_cnpj = a.emitente_documento;
    if v_forn is null then
      insert into public.fornecedores (
        tenant_id, tipo_pessoa, nome, razao_social, cpf_cnpj, sem_dados_pagamento, created_by
      ) values (
        v_pp.tenant_id, 'juridica', btrim(a.emitente_nome), btrim(a.emitente_nome),
        a.emitente_documento, true, v_uid
      )
      returning id into v_forn;
    end if;

    select n.id into v_nota
      from public.notas_fiscais_fornecedor n
     where n.tenant_id = v_pp.tenant_id
       and n.fornecedor_id = v_forn
       and n.numero_chave = public.chave_do_numero_da_nf(a.documento_numero)
     for update;
    if v_nota is null then
      insert into public.notas_fiscais_fornecedor (
        tenant_id, fornecedor_id, numero, data_emissao, valor, tomador_estabelecimento_id,
        criada_por, registrada_em, registrada_por, registrada_na_pp_id,
        credito_pis_cofins_retirado, credito_pis_cofins_motivo
      ) values (
        v_pp.tenant_id, v_forn, btrim(a.documento_numero), a.documento_data, a.valor,
        a.tomador_estabelecimento_id, v_uid, now(), v_uid, v_pp.id,
        v_sem_cred, case when v_sem_cred then v_motivo end
      )
      returning id into v_nota;
    else
      if v_nota = any(v_notas) then
        raise exception 'A NF % foi anexada duas vezes nesta prestação.', a.documento_numero;
      end if;
      update public.notas_fiscais_fornecedor
         set registrada_na_pp_id = coalesce(registrada_na_pp_id, v_pp.id),
             registrada_por = coalesce(registrada_por, v_uid),
             credito_pis_cofins_retirado = case when registrada_em is null then v_sem_cred
                                                else credito_pis_cofins_retirado end,
             credito_pis_cofins_motivo = case when registrada_em is null
                                              then (case when v_sem_cred then v_motivo end)
                                              else credito_pis_cofins_motivo end,
             registrada_em = coalesce(registrada_em, now())
       where id = v_nota;
    end if;
    v_notas := v_notas || v_nota;

    update public.pp_verba_prestacoes_anexos set nota_fiscal_id = v_nota where id = a.id;
  end loop;

  update public.pp_verba_prestacoes
     set status          = 'aprovada',
         aprovada_em     = now(),
         aprovada_por    = v_uid,
         valor_gasto     = v_soma,
         valor_devolvido = v_saldo,
         documentos_na_aprovacao = (
           select coalesce(
             jsonb_agg(jsonb_build_object(
               'id', x.id,
               'nome', x.arquivo_nome_original,
               'documento_tipo', x.documento_tipo,
               'documento_numero', x.documento_numero,
               'documento_data', x.documento_data,
               'valor', x.valor,
               'tomador_estabelecimento_id', x.tomador_estabelecimento_id,
               'emitente_documento', x.emitente_documento,
               'emitente_nome', x.emitente_nome,
               'descricao', x.descricao,
               'nota_fiscal_id', x.nota_fiscal_id
             ) order by x.created_at, x.id),
             '[]'::jsonb
           )
             from public.pp_verba_prestacoes_anexos x
            where x.prestacao_id = v_prest.id
         )
   where id = v_prest.id;

  if v_saldo > 0 then
    insert into public.pp_verba_devolucoes (
      tenant_id, empresa_id, prestacao_id, pedido_compra_id, valor,
      data_pagamento, data_pagamento_primeira
    ) values (
      v_pp.tenant_id, v_pp.empresa_id, v_prest.id, v_pp.id, v_saldo,
      p_data_prevista, p_data_prevista
    )
    returning id into v_dev_id;
  end if;

  return v_dev_id;
end;
$function$;
