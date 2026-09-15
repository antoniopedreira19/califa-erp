-- ===========================================================================
-- Enviar, aprovar e reprovar a prestação de contas da verba
-- ===========================================================================
-- Decisão 081. Substitui `fechar_prestacao_verba_pp`, que fechava a
-- prestação e criava a devolução numa tacada só.
--
--   enviar_prestacao_verba   — produção: responsável pela verba, responsável
--                              do job ou administrador (pergunta 6a). Grava
--                              a prestação e o conjunto inteiro de
--                              documentos; no reenvio de uma reprovada,
--                              substitui o conjunto.
--   aprovar_prestacao_verba  — administrador ou financeiro. Guarda os
--                              documentos conferidos e, havendo saldo, cria
--                              o estorno com a data prevista escolhida.
--   reprovar_prestacao_verba — administrador ou financeiro, com motivo.
--
-- O realizado do item passa a descontar o saldo só da prestação APROVADA
-- (antes descontava no instante do fechamento, antes de alguém conferir).
--
-- O estorno continua gravado com valor positivo e, na baixa, como ENTRADA
-- (decisão 081, pergunta 8a): é o dinheiro voltando, como o extrato mostra.
-- Quem o apresenta como despesa negativa são as telas. Muda só o rótulo:
-- "Estorno de verba".

create or replace function public.enviar_prestacao_verba(
  p_pp_id uuid,
  p_documentos jsonb
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

  if p_documentos is null
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

create or replace function public.aprovar_prestacao_verba(
  p_pp_id uuid,
  p_data_prevista date
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_pp     pedidos_compra%rowtype;
  v_papel  text;
  v_prest  pp_verba_prestacoes%rowtype;
  v_dev_id uuid;
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
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
    raise exception 'Só administrador ou financeiro aprova prestação de contas.';
  end if;

  select * into v_prest
    from public.pp_verba_prestacoes
   where pedido_compra_id = p_pp_id
   for update;
  if not found then
    raise exception 'Esta verba ainda não tem prestação de contas.';
  end if;
  if v_prest.status = 'aprovada' then
    raise exception 'Esta prestação já foi aprovada.';
  end if;
  if v_prest.status = 'reprovada' then
    raise exception 'Esta prestação foi reprovada e está com a produção.';
  end if;
  if v_prest.valor_devolvido > 0 and p_data_prevista is null then
    raise exception 'Informe a data prevista da devolução.';
  end if;

  update public.pp_verba_prestacoes
     set status       = 'aprovada',
         aprovada_em  = now(),
         aprovada_por = v_uid,
         documentos_na_aprovacao = (
           select coalesce(
             jsonb_agg(jsonb_build_object(
               'id', a.id,
               'nome', a.arquivo_nome_original,
               'documento_tipo', a.documento_tipo,
               'documento_numero', a.documento_numero,
               'valor', a.valor
             ) order by a.created_at),
             '[]'::jsonb
           )
             from public.pp_verba_prestacoes_anexos a
            where a.prestacao_id = v_prest.id
         )
   where id = v_prest.id;

  if v_prest.valor_devolvido > 0 then
    insert into public.pp_verba_devolucoes (
      tenant_id, empresa_id, prestacao_id, pedido_compra_id, valor,
      data_pagamento, data_pagamento_primeira
    ) values (
      v_pp.tenant_id, v_pp.empresa_id, v_prest.id, v_pp.id, v_prest.valor_devolvido,
      p_data_prevista, p_data_prevista
    )
    returning id into v_dev_id;
  end if;

  return v_dev_id;
end;
$$;

create or replace function public.reprovar_prestacao_verba(
  p_pp_id uuid,
  p_motivo text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_pp    pedidos_compra%rowtype;
  v_papel text;
  v_prest pp_verba_prestacoes%rowtype;
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
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
    raise exception 'Só administrador ou financeiro reprova prestação de contas.';
  end if;

  select * into v_prest
    from public.pp_verba_prestacoes
   where pedido_compra_id = p_pp_id
   for update;
  if not found then
    raise exception 'Esta verba ainda não tem prestação de contas.';
  end if;
  if v_prest.status <> 'em_avaliacao' then
    raise exception 'Só prestação em avaliação pode ser reprovada.';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'O motivo precisa ter pelo menos 10 caracteres.';
  end if;

  update public.pp_verba_prestacoes
     set status            = 'reprovada',
         motivo_reprovacao = btrim(p_motivo),
         reprovada_em      = now(),
         reprovada_por     = v_uid
   where id = v_prest.id;
end;
$$;

revoke execute on function public.enviar_prestacao_verba(uuid, jsonb) from public;
grant  execute on function public.enviar_prestacao_verba(uuid, jsonb) to authenticated;
revoke execute on function public.aprovar_prestacao_verba(uuid, date) from public;
grant  execute on function public.aprovar_prestacao_verba(uuid, date) to authenticated;
revoke execute on function public.reprovar_prestacao_verba(uuid, text) from public;
grant  execute on function public.reprovar_prestacao_verba(uuid, text) to authenticated;

-- A função antiga fechava e criava a devolução sem conferência. A tela que
-- a chamava sai no mesmo commit; nenhuma prestação foi gravada por ela.
drop function if exists public.fechar_prestacao_verba_pp(uuid, numeric, uuid);

-- ---------------------------------------------------------------------------
-- Realizado: desconta o saldo só da prestação aprovada
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_realizado_do_item(p_item_realizado_id uuid)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_total       numeric;
  v_qtd         numeric;
  v_unit        numeric;
  v_dm          numeric;
  v_n_pps       integer;
  v_devolvido   numeric;
begin
  if p_item_realizado_id is null then
    return;
  end if;

  -- Toda PP que existe no item pesa; só o cancelamento tira (11/09/2026).
  select count(*),
         coalesce(sum(valor), 0),
         coalesce(sum(quantidade), 0),
         coalesce(sum(valor_unitario), 0),
         coalesce(sum(dias_meses), 0)
    into v_n_pps, v_total, v_qtd, v_unit, v_dm
    from public.pedidos_compra
   where item_realizado_id = p_item_realizado_id
     and status <> 'cancelada';

  -- Só a prestação APROVADA desconta o saldo (decisão 081): enviada ou
  -- reprovada, ninguém conferiu ainda o que foi gasto.
  select coalesce(sum(pv.valor_devolvido), 0)
    into v_devolvido
    from public.pp_verba_prestacoes pv
    join public.pedidos_compra pp on pp.id = pv.pedido_compra_id
   where pp.item_realizado_id = p_item_realizado_id
     and pp.status <> 'cancelada'
     and pv.status = 'aprovada';

  -- A decomposição (R$ Unit. · QT · D/M) só faz sentido com uma PP: com
  -- duas, somar unitários de fornecedores diferentes seria ficção.
  if v_n_pps <> 1 then
    v_unit := 0;
    v_qtd  := 0;
    v_dm   := 0;
  end if;

  update public.jobs_itens_realizado
     set total_realizado          = round(v_total - v_devolvido, 2),
         quantidade_realizada     = v_qtd,
         dias_meses_realizado     = v_dm,
         valor_unitario_realizado = round(v_unit, 2)
   where id = p_item_realizado_id;
end;
$$;

-- A aprovação é um UPDATE de status: o gatilho passa a ouvir isso também.
drop trigger if exists trg_prestacao_recalcula_realizado on public.pp_verba_prestacoes;
create trigger trg_prestacao_recalcula_realizado
  after insert or update of status on public.pp_verba_prestacoes
  for each row execute function public.prestacao_verba_recalcula_realizado();

-- ---------------------------------------------------------------------------
-- Baixa e estorno da baixa: só o rótulo muda (decisão 081, pergunta 6a)
-- ---------------------------------------------------------------------------
create or replace function public.dar_baixa_devolucao_verba(
  p_devolucao_id uuid,
  p_pago_em date,
  p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_dev            pp_verba_devolucoes%rowtype;
  v_pp             pedidos_compra%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  select * into v_dev from public.pp_verba_devolucoes where id = p_devolucao_id;
  if not found then raise exception 'Estorno de verba não encontrado.'; end if;

  if not public.is_tenant_member(v_dev.tenant_id) then
    raise exception 'Sem acesso a este estorno de verba.';
  end if;

  if v_dev.pago_em is not null then
    raise exception 'Este estorno de verba já foi baixado.';
  end if;

  select * into v_pp from public.pedidos_compra where id = v_dev.pedido_compra_id;
  if not found then raise exception 'PP do estorno de verba não encontrada.'; end if;

  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  -- Sem trava de empresa: a conta paga despesa de mais de uma
  -- empresa (29/08/2026). Quem diz a empresa é o documento, e o
  -- lançamento abaixo já a grava de lá.
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do recebimento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo
    from public.plano_contas_subtipos
   where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  v_descricao := 'Estorno de verba ' || v_pp.codigo
                 || ' — ' || substring(v_pp.servico, 1, 140);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, pp_verba_devolucao_id,
    origem, criado_por
  ) values (
    v_dev.tenant_id, v_dev.empresa_id, p_conta_bancaria_id, p_pago_em, v_dev.valor,
    'entrada', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    null, v_pp.job_id, v_pp.id, v_dev.id,
    'pp_devolucao_verba', p_criado_por
  )
  returning id into v_lancamento_id;

  update public.pp_verba_devolucoes
     set pago_em       = p_pago_em,
         pago_por      = p_criado_por,
         lancamento_id = v_lancamento_id
   where id = p_devolucao_id;

  return v_lancamento_id;
end;
$$;

create or replace function public.estornar_baixa_devolucao_verba(
  p_devolucao_id uuid,
  p_motivo text,
  p_criado_por uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_dev        pp_verba_devolucoes%rowtype;
  v_pp         pedidos_compra%rowtype;
  v_original   lancamentos_financeiros%rowtype;
  v_reverso_id uuid;
  v_descricao  text;
begin
  select * into v_dev from public.pp_verba_devolucoes where id = p_devolucao_id;
  if not found then raise exception 'Estorno de verba não encontrado.'; end if;

  if not public.is_tenant_member(v_dev.tenant_id) then
    raise exception 'Sem acesso a este estorno de verba.';
  end if;

  if v_dev.pago_em is null then
    raise exception 'Este estorno de verba não está baixado.';
  end if;

  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo do estorno.';
  end if;

  select * into v_pp from public.pedidos_compra where id = v_dev.pedido_compra_id;
  if not found then raise exception 'PP do estorno de verba não encontrada.'; end if;

  select * into v_original
    from public.lancamentos_financeiros
   where id = v_dev.lancamento_id;
  if not found then
    raise exception 'Lançamento da baixa do estorno de verba não encontrado.';
  end if;

  v_descricao := 'Baixa desfeita · estorno de verba ' || v_pp.codigo
                 || ' — ' || substring(p_motivo, 1, 180);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, pp_verba_devolucao_id,
    estorno_de_lancamento_id, origem, criado_por
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    'saida', v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    null, v_original.job_id, v_original.pedido_compra_id, v_original.pp_verba_devolucao_id,
    v_original.id, 'pp_devolucao_verba_estorno', p_criado_por
  )
  returning id into v_reverso_id;

  update public.lancamentos_financeiros
     set origem = 'pp_devolucao_verba_estornada'
   where id = v_original.id;

  update public.pp_verba_devolucoes
     set pago_em       = null,
         pago_por      = null,
         lancamento_id = null
   where id = p_devolucao_id;

  return v_reverso_id;
end;
$$;

comment on function public.enviar_prestacao_verba(uuid, jsonb) is
  'Produção envia (ou reenvia, se reprovada) a prestação da verba paga: documentos NF/recibo com valor, gasto = soma, nunca acima da verba. Decisão 081.';
comment on function public.aprovar_prestacao_verba(uuid, date) is
  'Financeiro aprova a prestação em avaliação: guarda os documentos conferidos e, com saldo, cria o estorno de verba na data prevista. Retorna o id do estorno (ou null). Decisão 081.';
comment on function public.reprovar_prestacao_verba(uuid, text) is
  'Financeiro reprova a prestação em avaliação, com motivo; ela volta para a produção corrigir. Decisão 081.';
