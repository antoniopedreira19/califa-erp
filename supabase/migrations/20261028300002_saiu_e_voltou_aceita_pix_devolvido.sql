-- =====================================================================
-- "Saiu e voltou" aceita o "PIX DEVOLVIDO" (decisão 211; Tiago, 28/10/2026)
-- =====================================================================
--
-- O Santander escreve a volta do PIX de dois jeitos: "DEVOLUCAO DE PIX" e
-- "PIX DEVOLVIDO". `registrar_saiu_e_voltou` só aceitava o primeiro, e a
-- devolução de R$ 4.200,00 de 02/10 (a que a planilha lança como estorno)
-- não fechava o par com a saída do mesmo dia. O motor (`formaDoHistorico`)
-- passa a reconhecer os dois, e a função também. Nada mais muda; o
-- `create or replace` mantém o GRANT (authenticated; nada para anon).
-- =====================================================================

create or replace function public.registrar_saiu_e_voltou(
  p_saida_id uuid,
  p_volta_id uuid,
  p_referencia text default null,
  p_fornecedor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid;
  v_saida  extrato_linhas%rowtype;
  v_volta  extrato_linhas%rowtype;
  v_grupo  uuid := gen_random_uuid();
  v_ref    text := nullif(substring(btrim(coalesce(p_referencia, '')), 1, 160), '');
  v_s      uuid;
  v_v      uuid;
begin
  v_saida := public._linha_pendente(p_saida_id);
  v_volta := public._linha_pendente(p_volta_id);
  v_uid := public._exige_financeiro_conciliacao(v_saida.tenant_id);
  if v_saida.tenant_id <> v_volta.tenant_id or v_saida.conta_bancaria_id <> v_volta.conta_bancaria_id then
    raise exception 'As duas linhas precisam ser da mesma conta.';
  end if;
  if not (v_saida.valor < 0 and v_volta.valor > 0 and abs(v_saida.valor + v_volta.valor) < 0.005
          and v_saida.data = v_volta.data) then
    raise exception 'A saída e a devolução precisam ter o mesmo valor, no mesmo dia.';
  end if;
  if public._normalizar_historico(v_volta.historico) not like '%DEVOLUCAO%'
     and public._normalizar_historico(v_volta.historico) not like '%DEVOLVID%' then
    raise exception 'A linha de entrada não é uma devolução do banco.';
  end if;
  if p_fornecedor_id is not null
     and not exists (select 1 from public.fornecedores where id = p_fornecedor_id and tenant_id = v_saida.tenant_id) then
    raise exception 'Fornecedor não encontrado.';
  end if;

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor, natureza, descricao,
    fornecedor_id, origem, extrato_linha_id, criado_por
  ) values (
    v_saida.tenant_id, null, v_saida.conta_bancaria_id, v_saida.data, abs(v_saida.valor), 'saida',
    'PIX que voltou' || coalesce(' · ' || v_ref, ''), p_fornecedor_id, 'devolucao_bancaria', v_saida.id, v_uid
  ) returning id into v_s;
  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor, natureza, descricao,
    fornecedor_id, origem, extrato_linha_id, criado_por
  ) values (
    v_volta.tenant_id, null, v_volta.conta_bancaria_id, v_volta.data, v_volta.valor, 'entrada',
    'Devolução do PIX' || coalesce(' · ' || v_ref, ''), p_fornecedor_id, 'devolucao_bancaria', v_volta.id, v_uid
  ) returning id into v_v;

  update public.extrato_linhas
     set conciliada_como = 'par', conciliada_em = now(), conciliada_por = v_uid,
         desfazer = null, grupo = v_grupo, resolvida_sozinha = null
   where id in (v_saida.id, v_volta.id);

  perform public._auditar_extrato(v_saida, 'extrato.saiu_e_voltou', v_uid,
    jsonb_build_object('devolucao', v_volta.id, 'lancamentos', jsonb_build_array(v_s, v_v), 'referencia', v_ref));
  return jsonb_build_object('saida', v_s, 'volta', v_v, 'grupo', v_grupo);
end;
$function$;
