-- =============================================================================
-- A regra do extrato que vira transferência entre contas (decisão 211, A5)
-- =============================================================================
-- Combinado com o Tiago em 27/10/2026 ("vamos fazer as duas contas para ter
-- as contas de aplicação") e pedido em 28/10/2026: "Pode fazer a regra que
-- transforma cada aplicação e cada resgate do extrato em transferência entre
-- a conta corrente e a conta de aplicação, como combinamos."
--
-- A conta corrente fecha o dia em R$ 0,00: o banco aplica o que sobra
-- (APLICACAO CONTAMAX, BB RENDE FÁCIL) e resgata o que falta (RESGATE
-- CONTAMAX AUTOMATICO). Cada linha dessas é dinheiro indo e voltando entre a
-- corrente e a conta de investimento, que o sistema tem desde 27/10.
--
-- 1. `extrato_regras.conta_destino_id`: a regra com conta de destino não
--    lança no centro de custo; cria e efetiva uma transferência entre contas
--    (decisão 124, `transferencias_contas`). Sem centro, subtipo e empresa:
--    as três colunas deixam de ser obrigatórias, e uma checagem exige ou o
--    centro inteiro, ou a conta de destino.
-- 2. `criar_regra_de_transferencia`: confere a conta de destino (ativa, outra
--    conta, do mesmo CNPJ, não cartão), como a transferência confere.
-- 3. `lancar_pela_regra`: com conta de destino, o sentido vem do sinal da
--    linha (saída: da corrente para a aplicação; entrada: da aplicação para
--    a corrente), na data e no valor do banco. A perna da conta da linha se
--    liga a ela; a outra fica na conta de investimento.
-- 4. `desfazer_conciliacao`: na linha da regra de transferência, apaga as
--    duas pernas e a transferência, com auditoria.
--
-- O rendimento da aplicação não passa pela corrente: entra na conta de
-- investimento como receita financeira, à parte.
--
-- Aditiva: coluna nova, NOT NULL afrouxado com checagem no lugar, função nova
-- e duas funções reescritas com a regra de antes mais a da transferência.
-- =============================================================================

alter table public.extrato_regras
  add column if not exists conta_destino_id uuid references public.contas_bancarias(id) on delete restrict;
create index if not exists idx_extrato_regras_conta_destino
  on public.extrato_regras (conta_destino_id) where conta_destino_id is not null;
comment on column public.extrato_regras.conta_destino_id is
  'Regra de transferência: a linha do banco vira transferência entre a conta da linha e esta conta (a de aplicação), no sentido do sinal (decisão 211, A5).';

alter table public.extrato_regras alter column plano_conta_tipo_id drop not null;
alter table public.extrato_regras alter column plano_conta_subtipo_id drop not null;
alter table public.extrato_regras alter column empresa_id drop not null;
alter table public.extrato_regras drop constraint if exists chk_extrato_regra_centro_ou_destino;
alter table public.extrato_regras add constraint chk_extrato_regra_centro_ou_destino check (
  (conta_destino_id is null and plano_conta_tipo_id is not null and plano_conta_subtipo_id is not null and empresa_id is not null)
  or (conta_destino_id is not null and plano_conta_tipo_id is null and plano_conta_subtipo_id is null and empresa_id is null)
);

create or replace function public.criar_regra_de_transferencia(
  p_conta_bancaria_id uuid,
  p_padrao text,
  p_conta_destino_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid;
  v_conta   contas_bancarias%rowtype;
  v_destino contas_bancarias%rowtype;
  v_padrao  text := public._normalizar_historico(p_padrao);
  v_id      uuid;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  v_uid := public._exige_financeiro_conciliacao(v_conta.tenant_id);
  if length(v_padrao) < 3 then
    raise exception 'O começo do histórico precisa ter pelo menos 3 letras.';
  end if;
  select * into v_destino from public.contas_bancarias where id = p_conta_destino_id and tenant_id = v_conta.tenant_id;
  if not found then raise exception 'Escolha a conta de destino.'; end if;
  if v_destino.id = v_conta.id then
    raise exception 'A conta de destino precisa ser diferente desta.';
  end if;
  if not v_destino.ativo then raise exception 'A conta % está inativa.', v_destino.nome; end if;
  if v_destino.cartao_credito_id is not null or v_conta.cartao_credito_id is not null then
    raise exception 'Transferência é entre contas bancárias, não com o cartão.';
  end if;
  if v_destino.empresa_contabil_id is distinct from v_conta.empresa_contabil_id then
    raise exception 'Transferência só entre contas do mesmo CNPJ.';
  end if;
  if exists (
    select 1 from public.extrato_regras
     where tenant_id = v_conta.tenant_id and ativa and padrao = v_padrao and conta_bancaria_id = v_conta.id
  ) then
    raise exception 'Já existe uma regra para "%" nesta conta.', v_padrao;
  end if;

  insert into public.extrato_regras (tenant_id, conta_bancaria_id, padrao, conta_destino_id, criada_por)
  values (v_conta.tenant_id, v_conta.id, v_padrao, v_destino.id, v_uid)
  returning id into v_id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_conta.tenant_id, 'extrato_regra', v_id::text, 'extrato.regra_criada', v_uid,
          jsonb_build_object('conta_bancaria_id', v_conta.id, 'padrao', v_padrao, 'conta_destino_id', v_destino.id,
                             'transferencia', true));
  return v_id;
end;
$function$;

revoke all on function public.criar_regra_de_transferencia(uuid, text, uuid) from public, anon;
grant execute on function public.criar_regra_de_transferencia(uuid, text, uuid) to authenticated;

create or replace function public.lancar_pela_regra(p_linha_id uuid, p_regra_id uuid, p_sozinha boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid;
  v_linha  extrato_linhas%rowtype;
  v_regra  extrato_regras%rowtype;
  v_id     uuid;
  v_desc   text;
  v_tr     uuid;
  v_codigo text;
  v_pernas uuid[];
begin
  v_linha := public._linha_pendente(p_linha_id);
  v_uid := public._exige_financeiro_conciliacao(v_linha.tenant_id);
  select * into v_regra from public.extrato_regras where id = p_regra_id for update;
  if not found or not v_regra.ativa or v_regra.tenant_id <> v_linha.tenant_id
     or (v_regra.conta_bancaria_id is not null and v_regra.conta_bancaria_id <> v_linha.conta_bancaria_id) then
    raise exception 'Regra não encontrada para esta conta.';
  end if;
  if left(public._normalizar_historico(v_linha.historico), length(v_regra.padrao)) <> v_regra.padrao then
    raise exception 'O histórico desta linha não começa por "%".', v_regra.padrao;
  end if;

  v_desc := substring(btrim(v_linha.historico), 1, 240);
  if length(v_desc) < 3 then v_desc := 'Lançamento do extrato do banco'; end if;

  if v_regra.conta_destino_id is not null then
    -- A regra de transferência: o sinal da linha diz o sentido.
    v_codigo := public.gerar_codigo_transferencia(v_linha.tenant_id);
    insert into public.transferencias_contas (
      tenant_id, codigo, conta_origem_id, conta_destino_id, valor, data_prevista, descricao, criado_por
    ) values (
      v_linha.tenant_id, v_codigo,
      case when v_linha.valor < 0 then v_linha.conta_bancaria_id else v_regra.conta_destino_id end,
      case when v_linha.valor < 0 then v_regra.conta_destino_id else v_linha.conta_bancaria_id end,
      abs(v_linha.valor), v_linha.data, v_desc, v_uid
    ) returning id into v_tr;

    insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
    values (v_linha.tenant_id, 'transferencia_contas', v_tr::text, 'transferencia.criada', v_uid,
            jsonb_build_object('codigo', v_codigo, 'valor', abs(v_linha.valor), 'data_prevista', v_linha.data,
                               'ja_transferida', true, 'pela_regra', v_regra.id, 'extrato_linha_id', v_linha.id));

    v_pernas := public._efetivar_transferencia(v_tr, v_linha.data, v_uid);
    -- [saída, entrada]: a perna desta conta é a saída quando o dinheiro sai dela.
    v_id := case when v_linha.valor < 0 then v_pernas[1] else v_pernas[2] end;
    update public.lancamentos_financeiros set extrato_linha_id = v_linha.id where id = v_id;
  else
    insert into public.lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor, natureza, descricao,
      plano_conta_tipo_id, plano_conta_subtipo_id, origem, extrato_linha_id, criado_por
    ) values (
      v_linha.tenant_id, v_regra.empresa_id, v_linha.conta_bancaria_id, v_linha.data, abs(v_linha.valor),
      (case when v_linha.valor < 0 then 'saida' else 'entrada' end)::natureza_lancamento, v_desc,
      v_regra.plano_conta_tipo_id, v_regra.plano_conta_subtipo_id, 'manual', v_linha.id, v_uid
    ) returning id into v_id;
  end if;

  update public.extrato_regras set usos = usos + 1 where id = v_regra.id;
  update public.extrato_linhas
     set conciliada_como = 'regra', conciliada_em = now(), conciliada_por = v_uid,
         desfazer = jsonb_build_object('regra_id', v_regra.id)
                    || case when v_tr is null then '{}'::jsonb else jsonb_build_object('transferencia_id', v_tr) end,
         grupo = null,
         resolvida_sozinha = case when p_sozinha then 'regra' else null end
   where id = v_linha.id;

  perform public._auditar_extrato(v_linha, 'extrato.lancado_pela_regra', v_uid,
    jsonb_build_object('regra_id', v_regra.id, 'padrao', v_regra.padrao, 'lancamento', v_id, 'sozinha', p_sozinha,
                       'transferencia_id', v_tr));
  return v_id;
end;
$function$;

create or replace function public.desfazer_conciliacao(p_linha_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid;
  v_linha     extrato_linhas%rowtype;
  r_linha     extrato_linhas%rowtype;
  r_l         lancamentos_financeiros%rowtype;
  d           jsonb;
  v_cancelar  jsonb := '[]'::jsonb;
  v_item      jsonb;
  v_linhas    uuid[] := '{}';
  v_cor       baixa_correcoes%rowtype;
  v_ret       numeric;
  v_tr        transferencias_contas%rowtype;
  v_perna     record;
begin
  select * into v_linha from public.extrato_linhas where id = p_linha_id for update;
  if not found then raise exception 'Linha do extrato não encontrada.'; end if;
  v_uid := public._exige_financeiro_conciliacao(v_linha.tenant_id);

  perform public._exige_periodo_aberto(l.conta_bancaria_id, l.data)
     from public.extrato_linhas l
    where l.id = v_linha.id or (v_linha.grupo is not null and l.grupo = v_linha.grupo);
  perform public._exige_periodo_aberto(f.conta_bancaria_id, f.data_movimento)
     from public.lancamentos_financeiros f
     join public.extrato_linhas l on l.id = f.extrato_linha_id
    where l.id = v_linha.id or (v_linha.grupo is not null and l.grupo = v_linha.grupo);

  for r_linha in
    select * from public.extrato_linhas
     where id = v_linha.id or (v_linha.grupo is not null and grupo = v_linha.grupo)
     order by ordem
     for update
  loop
    v_linhas := v_linhas || r_linha.id;

    if r_linha.ignorada_em is not null then
      update public.extrato_linhas
         set ignorada_em = null, ignorada_por = null, motivo_ignorada = null, sem_auto = true
       where id = r_linha.id;
      continue;
    end if;

    -- A linha do histórico (A6): solta a cauda; nada a cancelar.
    if r_linha.conciliada_como = 'historico' then
      update public.historico_movimentos set extrato_linha_id = null where extrato_linha_id = r_linha.id;
      update public.extrato_linhas
         set conciliada_como = null, conciliada_em = null, conciliada_por = null, desfazer = null,
             grupo = null, resolvida_sozinha = null, sem_auto = true
       where id = r_linha.id;
      continue;
    end if;

    if not exists (select 1 from public.lancamentos_financeiros where extrato_linha_id = r_linha.id) then
      continue;
    end if;

    if r_linha.conciliada_como in ('baixa', 'avulso') then
      for r_l in
        select * from public.lancamentos_financeiros
         where extrato_linha_id = r_linha.id and origem <> 'juros_baixa'
      loop
        v_item := public._cancelamento_da_baixa(r_l);
        if v_item is not null and not v_cancelar @> jsonb_build_array(v_item) then
          v_cancelar := v_cancelar || jsonb_build_array(v_item);
        end if;
      end loop;
      update public.extrato_linhas set sem_auto = true where id = r_linha.id;
    elsif r_linha.conciliada_como in ('regra', 'par') then
      if r_linha.conciliada_como = 'regra' and r_linha.desfazer ? 'regra_id' then
        update public.extrato_regras set usos = greatest(usos - 1, 0) where id = (r_linha.desfazer->>'regra_id')::uuid;
      end if;
      if r_linha.conciliada_como = 'regra' and r_linha.desfazer ? 'transferencia_id' then
        -- A regra de transferência: as duas pernas e a transferência saem.
        select * into v_tr from public.transferencias_contas
         where id = (r_linha.desfazer->>'transferencia_id')::uuid for update;
        if found then
          perform public._exige_periodo_aberto(f.conta_bancaria_id, f.data_movimento)
             from public.lancamentos_financeiros f where f.transferencia_id = v_tr.id;
          for v_perna in
            select l.id from public.lancamentos_financeiros l where l.transferencia_id = v_tr.id for update
          loop
            perform public._apagar_lancamento_de_baixa(v_perna.id);
          end loop;
          delete from public.transferencias_contas where id = v_tr.id;
          insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
          values (v_tr.tenant_id, 'transferencia_contas', v_tr.id::text, 'transferencia.excluida', v_uid,
                  jsonb_build_object('codigo', v_tr.codigo, 'valor', v_tr.valor, 'data_prevista', v_tr.data_prevista,
                                     'conta_origem_id', v_tr.conta_origem_id, 'conta_destino_id', v_tr.conta_destino_id,
                                     'motivo', 'Conciliação pela regra desfeita', 'extrato_linha_id', r_linha.id));
        end if;
      end if;
      delete from public.lancamentos_financeiros
       where extrato_linha_id = r_linha.id and origem in ('manual', 'devolucao_bancaria');
    elsif r_linha.conciliada_como = 'correcao' then
      select * into v_cor from public.baixa_correcoes where id = (r_linha.desfazer->>'correcao_id')::uuid for update;
      if not found then raise exception 'A correção desta linha não foi achada.'; end if;
      perform public.cancelar_baixa_lancamento(v_cor.lancamento_id, 'Correção pela conciliação com o banco desfeita');
      select coalesce(sum((x->>'valor')::numeric), 0) into v_ret from jsonb_array_elements(v_cor.de->'retencoes') x;
      perform public._refazer_baixa(
        v_cor.documento_origem, v_cor.documento_id, (v_cor.de->>'data')::date, r_linha.conta_bancaria_id,
        (v_cor.de->>'tipo_id')::uuid, (v_cor.de->>'subtipo_id')::uuid, (v_cor.de->>'forma')::forma_pagamento,
        (v_cor.de->>'principal')::numeric + v_ret, v_cor.de->'retencoes', (v_cor.de->>'juros')::numeric);
      update public.baixa_correcoes set desfeita_em = now(), desfeita_por = v_uid where id = v_cor.id;
    else
      update public.lancamentos_financeiros set extrato_linha_id = null where extrato_linha_id = r_linha.id;
      for d in select value from jsonb_array_elements(coalesce(r_linha.desfazer->'datas', '[]'::jsonb)) loop
        if exists (select 1 from public.lancamentos_financeiros where id = (d->>'id')::uuid) then
          perform public._mudar_data_do_lancamento((d->>'id')::uuid, (d->>'de')::date);
        end if;
      end loop;
    end if;

    if r_linha.conciliada_como is distinct from 'baixa' and r_linha.conciliada_como is distinct from 'avulso' then
      update public.extrato_linhas
         set conciliada_como = null, conciliada_em = null, conciliada_por = null, desfazer = null,
             grupo = null, resolvida_sozinha = null, sem_auto = true
       where id = r_linha.id;
    end if;
  end loop;

  perform public._auditar_extrato(v_linha, 'extrato.conciliacao_desfeita', v_uid,
    jsonb_build_object('linhas', to_jsonb(v_linhas), 'como', v_linha.conciliada_como,
                       'ignorada', v_linha.ignorada_em is not null, 'cancelar', v_cancelar));
  return jsonb_build_object('linhas', to_jsonb(v_linhas), 'cancelar', v_cancelar);
end;
$function$;
