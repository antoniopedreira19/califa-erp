-- =====================================================================
-- Correção: lancar_pela_regra grava a natureza como o enum dela
-- (task 029, fase 3, entrega 3B — decisão 200)
-- =====================================================================
--
-- Na 20261021700004 o `case` da natureza devolvia texto, e o insert em
-- `lancamentos_financeiros.natureza` (enum `natureza_lancamento`) recusava:
-- achado no teste da função, antes de qualquer uso pela tela. Troca só o
-- corpo da função, com a mesma assinatura e as mesmas permissões.
-- =====================================================================

create or replace function public.lancar_pela_regra(p_linha_id uuid, p_regra_id uuid, p_sozinha boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid;
  v_linha  extrato_linhas%rowtype;
  v_regra  extrato_regras%rowtype;
  v_id     uuid;
  v_desc   text;
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

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor, natureza, descricao,
    plano_conta_tipo_id, plano_conta_subtipo_id, origem, extrato_linha_id, criado_por
  ) values (
    v_linha.tenant_id, v_regra.empresa_id, v_linha.conta_bancaria_id, v_linha.data, abs(v_linha.valor),
    (case when v_linha.valor < 0 then 'saida' else 'entrada' end)::natureza_lancamento, v_desc,
    v_regra.plano_conta_tipo_id, v_regra.plano_conta_subtipo_id, 'manual', v_linha.id, v_uid
  ) returning id into v_id;

  update public.extrato_regras set usos = usos + 1 where id = v_regra.id;
  update public.extrato_linhas
     set conciliada_como = 'regra', conciliada_em = now(), conciliada_por = v_uid,
         desfazer = jsonb_build_object('regra_id', v_regra.id), grupo = null,
         resolvida_sozinha = case when p_sozinha then 'regra' else null end
   where id = v_linha.id;

  perform public._auditar_extrato(v_linha, 'extrato.lancado_pela_regra', v_uid,
    jsonb_build_object('regra_id', v_regra.id, 'padrao', v_regra.padrao, 'lancamento', v_id, 'sozinha', p_sozinha));
  return v_id;
end;
$$;

