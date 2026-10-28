-- =====================================================================
-- A regional na regra do extrato (decisão 211; Tiago, 28/10/2026)
-- =====================================================================
--
-- A regra do extrato lançava sem regional: na gerencial California isso é
-- o "TD" da planilha (a despesa administrativa rateada entre as regionais).
-- Mas as tarifas da conta Santander GoCrazy, na planilha, são da regional
-- SS — e o Tiago decidiu fazer como a planilha: "Colocando as tarifas da
-- conta GO CRAZY como SS."
--
--   * `extrato_regras.regional_id` (opcional): vazio continua sendo TD.
--     Tem de ser regional da empresa da regra.
--   * `criar_regra_do_extrato` ganha `p_regional_id` (padrão nulo). A
--     assinatura muda, então a função antiga sai e a nova entra com o mesmo
--     GRANT (authenticated; nada para anon).
--   * `lancar_pela_regra` grava a regional da regra no lançamento.
--   * A regra "TAR" da Santander GoCrazy recebe SS, e as 12 tarifas de
--     outubro que ela já lançou (sem regional) também: só preenche o vazio.
-- =====================================================================

alter table public.extrato_regras
  add column if not exists regional_id uuid references public.regionais(id) on delete restrict;

create index if not exists extrato_regras_regional_idx
  on public.extrato_regras (regional_id) where regional_id is not null;

comment on column public.extrato_regras.regional_id is
  'A regional do lançamento da regra. Vazio: todas as regionais da empresa (o "TD" da planilha, rateado).';

-- ---------------------------------------------------------------------
-- Criar a regra, com a regional
-- ---------------------------------------------------------------------

drop function if exists public.criar_regra_do_extrato(uuid, text, uuid, uuid, uuid, boolean);

create or replace function public.criar_regra_do_extrato(
  p_conta_bancaria_id uuid,
  p_padrao text,
  p_tipo_id uuid,
  p_subtipo_id uuid,
  p_empresa_id uuid,
  p_todas_as_contas boolean default false,
  p_regional_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid;
  v_conta   contas_bancarias%rowtype;
  v_padrao  text := public._normalizar_historico(p_padrao);
  v_sub     uuid;
  v_id      uuid;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  v_uid := public._exige_financeiro_conciliacao(v_conta.tenant_id);
  if length(v_padrao) < 3 then
    raise exception 'O começo do histórico precisa ter pelo menos 3 letras.';
  end if;
  select tipo_id into v_sub from public.plano_contas_subtipos where id = p_subtipo_id and tenant_id = v_conta.tenant_id;
  if v_sub is null or v_sub <> p_tipo_id then
    raise exception 'Escolha o centro de custo e o subtipo da regra.';
  end if;
  if not exists (select 1 from public.empresas where id = p_empresa_id and tenant_id = v_conta.tenant_id) then
    raise exception 'Escolha a empresa da regra.';
  end if;
  if p_regional_id is not null and not exists (
    select 1 from public.regionais
     where id = p_regional_id and tenant_id = v_conta.tenant_id and empresa_id = p_empresa_id and ativo
  ) then
    raise exception 'A regional precisa ser da empresa da regra.';
  end if;
  if exists (
    select 1 from public.extrato_regras
     where tenant_id = v_conta.tenant_id and ativa and padrao = v_padrao
       and coalesce(conta_bancaria_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(case when p_todas_as_contas then null else v_conta.id end, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'Já existe uma regra para "%"%.', v_padrao,
      case when p_todas_as_contas then ' em todas as contas' else ' nesta conta' end;
  end if;

  insert into public.extrato_regras (
    tenant_id, conta_bancaria_id, padrao, plano_conta_tipo_id, plano_conta_subtipo_id, empresa_id, regional_id, criada_por
  ) values (
    v_conta.tenant_id, case when p_todas_as_contas then null else v_conta.id end, v_padrao,
    p_tipo_id, p_subtipo_id, p_empresa_id, p_regional_id, v_uid
  ) returning id into v_id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_conta.tenant_id, 'extrato_regra', v_id::text, 'extrato.regra_criada', v_uid,
          jsonb_build_object('conta_bancaria_id', case when p_todas_as_contas then null else v_conta.id end,
                             'padrao', v_padrao, 'tipo_id', p_tipo_id, 'subtipo_id', p_subtipo_id, 'empresa_id', p_empresa_id,
                             'regional_id', p_regional_id));
  return v_id;
end;
$function$;

revoke all on function public.criar_regra_do_extrato(uuid, text, uuid, uuid, uuid, boolean, uuid) from public, anon;
grant execute on function public.criar_regra_do_extrato(uuid, text, uuid, uuid, uuid, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Lançar pela regra, com a regional
-- ---------------------------------------------------------------------

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
      tenant_id, empresa_id, regional_id, conta_bancaria_id, data_movimento, valor, natureza, descricao,
      plano_conta_tipo_id, plano_conta_subtipo_id, origem, extrato_linha_id, criado_por
    ) values (
      v_linha.tenant_id, v_regra.empresa_id, v_regra.regional_id, v_linha.conta_bancaria_id, v_linha.data, abs(v_linha.valor),
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
                       'transferencia_id', v_tr, 'regional_id', v_regra.regional_id));
  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- SS na regra "TAR" da Santander GoCrazy e nas 12 tarifas já lançadas
-- (só onde a regional está vazia; autor: o Tiago, 3a933b18)
-- ---------------------------------------------------------------------

do $$
declare
  v_tenant  uuid := 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  v_conta   uuid := '6ba5ea71-44bd-4f69-9e16-baa229fde531';
  v_ss      uuid;
  v_regra   uuid;
  v_ids     uuid[];
begin
  select r.id into v_ss
    from public.regionais r join public.empresas e on e.id = r.empresa_id
   where r.tenant_id = v_tenant and r.nome = 'SS' and e.nome_fantasia = 'Agência California';
  select id into v_regra
    from public.extrato_regras
   where tenant_id = v_tenant and conta_bancaria_id = v_conta and padrao = 'TAR' and ativa and conta_destino_id is null;
  if v_ss is null or v_regra is null then
    raise exception 'Regional SS ou regra TAR da GoCrazy não encontrada.';
  end if;

  update public.extrato_regras set regional_id = v_ss where id = v_regra and regional_id is null;

  select array_agg(f.id) into v_ids
    from public.lancamentos_financeiros f
    join public.extrato_linhas l on l.id = f.extrato_linha_id
   where l.conta_bancaria_id = v_conta and l.conciliada_como = 'regra'
     and (l.desfazer->>'regra_id')::uuid = v_regra
     and f.origem = 'manual' and f.regional_id is null;
  if coalesce(array_length(v_ids, 1), 0) <> 12 then
    raise exception 'Esperava 12 tarifas da GoCrazy pela regra, achei %.', coalesce(array_length(v_ids, 1), 0);
  end if;

  update public.lancamentos_financeiros set regional_id = v_ss where id = any(v_ids) and regional_id is null;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_tenant, 'extrato_regra', v_regra::text, 'extrato.regra_regional', '3a933b18-156d-48b3-b100-a8099292b1c2',
          jsonb_build_object('regional_id', v_ss, 'lancamentos', to_jsonb(v_ids), 'migration', '20261028300001',
                             'motivo', 'Tarifas da conta GoCrazy na regional SS, como a planilha (Tiago, 28/10/2026).'));
end $$;
