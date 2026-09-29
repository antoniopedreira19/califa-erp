-- =====================================================================
-- Excluir título a receber criado por engano (decisão 124 §5, Tiago,
-- 29/09/2026)
-- =====================================================================
--
-- O recebimento avulso, o rendimento e a transferência nascem em aberto
-- pelo "Criar" de Títulos a Receber. Criados por engano, não tinham como
-- sair: o protótipo não previa exclusão. O Tiago aprovou o "Excluir" na
-- linha em aberto.
--
-- Só título EM ABERTO: o baixado cancela a baixa antes (decisão 120), para
-- a exclusão nunca apagar movimento do extrato. O rateio, os anexos e o
-- histórico da conta avulsa saem junto (FKs em cascata); a transferência a
-- transferir não tem linha no extrato.
--
-- SECURITY DEFINER com a régua de admin ou financeiro: a transferência não
-- tem política de DELETE (escrita só por função), e as duas exclusões
-- gravam o log na mesma transação.
-- =====================================================================

create or replace function public.excluir_titulo_receber_avulso(p_conta_avulsa_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid     uuid;
  v_avulsa  contas_avulsas%rowtype;
begin
  select * into v_avulsa from public.contas_avulsas where id = p_conta_avulsa_id for update;
  if not found or v_avulsa.tipo_entrada is null then
    raise exception 'Título não encontrado.';
  end if;

  v_uid := public._baixa_exige_financeiro(v_avulsa.tenant_id);

  if v_avulsa.status <> 'aprovada' then
    raise exception 'Este título já foi recebido. Para excluir, cancele a baixa antes.';
  end if;

  delete from public.contas_avulsas where id = p_conta_avulsa_id;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_avulsa.tenant_id, 'conta_avulsa', v_avulsa.id::text,
    'conta_avulsa.excluida', v_uid,
    jsonb_build_object(
      'codigo', v_avulsa.codigo,
      'tipo_entrada', v_avulsa.tipo_entrada,
      'descricao', v_avulsa.descricao,
      'valor', v_avulsa.valor,
      'empresa_id', v_avulsa.empresa_id,
      'data_prevista', v_avulsa.data_prevista_pagamento
    )
  );
end;
$$;

revoke all on function public.excluir_titulo_receber_avulso(uuid) from public, anon;
grant execute on function public.excluir_titulo_receber_avulso(uuid) to authenticated;

create or replace function public.excluir_transferencia(p_transferencia_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid;
  v_tr  transferencias_contas%rowtype;
begin
  select * into v_tr from public.transferencias_contas where id = p_transferencia_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;

  v_uid := public._baixa_exige_financeiro(v_tr.tenant_id);

  if v_tr.status <> 'a_transferir' then
    raise exception 'Esta transferência já foi feita. Para excluir, cancele a baixa antes.';
  end if;

  delete from public.transferencias_contas where id = p_transferencia_id;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_tr.tenant_id, 'transferencia_contas', v_tr.id::text,
    'transferencia.excluida', v_uid,
    jsonb_build_object(
      'codigo', v_tr.codigo,
      'valor', v_tr.valor,
      'data_prevista', v_tr.data_prevista,
      'conta_origem_id', v_tr.conta_origem_id,
      'conta_destino_id', v_tr.conta_destino_id,
      'descricao', v_tr.descricao
    )
  );
end;
$$;

revoke all on function public.excluir_transferencia(uuid) from public, anon;
grant execute on function public.excluir_transferencia(uuid) to authenticated;
