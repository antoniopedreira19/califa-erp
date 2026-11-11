-- =============================================================================
-- 20261111700001 — Retirar o extrato que teve uma correção de baixa já
-- desfeita (decisão 254; Tiago, 11/11/2026)
-- =============================================================================
-- O roteiro de teste da 254 mostrou que "Retirar este extrato" recusava o
-- arquivo com qualquer correção de baixa registrada, mesmo a já desfeita: o
-- registro da correção (`baixa_correcoes`) aponta para a linha do banco, com
-- FK RESTRICT. Como só o último arquivo da conta sai, os anteriores ficavam
-- presos junto. O Tiago decidiu que a correção desfeita não prende mais.
--
-- O registro da correção NÃO é apagado: ele é o histórico do título (o ⓘ o lê
-- pelo documento, não pela linha). Ao retirar o extrato, a correção desfeita
-- só perde a ligação com a linha que vai embora.
--
-- 1. `baixa_correcoes.extrato_linha_id` passa a aceitar nulo, e um CHECK
--    garante que só a correção DESFEITA fica sem linha. A FK continua
--    RESTRICT: a correção em vigor segue impedindo apagar a linha.
-- 2. `previa_de_retirar_extrato` e `retirar_extrato` só tratam como presa a
--    linha com correção em vigor (ou IOF de mútuo, que não muda). O
--    `retirar_extrato` solta as desfeitas antes de apagar as linhas e guarda
--    os ids delas na auditoria (`correcoes_desfeitas_sem_a_linha`).
--
-- Aditiva: nenhuma linha existente muda (todas têm a linha preenchida), as
-- funções são as desta mesma decisão, com a mesma assinatura e os mesmos
-- GRANTs.
-- =============================================================================

alter table public.baixa_correcoes alter column extrato_linha_id drop not null;

alter table public.baixa_correcoes
  add constraint chk_baixa_correcao_sem_linha_so_desfeita
  check (extrato_linha_id is not null or desfeita_em is not null);

comment on column public.baixa_correcoes.extrato_linha_id is
  'A linha do banco que pediu a correção. Nula só na correção já desfeita cujo extrato foi retirado (decisão 254): o registro fica como histórico do título.';

create or replace function public.previa_de_retirar_extrato(p_conta_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_conta   contas_bancarias%rowtype;
  v_imp     extrato_importacoes%rowtype;
  v_linhas  integer;
  v_conc    integer;
  v_ign     integer;
  v_min     date;
  v_ate     date;
  v_presas  integer;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  perform public._exige_financeiro_conciliacao(v_conta.tenant_id);

  select * into v_imp from public.extrato_importacoes
   where conta_bancaria_id = p_conta_id
   order by created_at desc, id desc
   limit 1;
  if not found then raise exception 'Esta conta não tem extrato importado.'; end if;

  select count(*)::int,
         (count(*) filter (where v.conciliada))::int,
         (count(*) filter (where not v.conciliada and v.ignorada_em is not null))::int,
         min(v.data)
    into v_linhas, v_conc, v_ign, v_min
    from public.vw_extrato_linhas v
   where v.importacao_id = v_imp.id;
  v_ate := public._conciliacao_fechada_ate(p_conta_id);

  select count(*)::int into v_presas
    from public.extrato_linhas l
   where l.importacao_id = v_imp.id
     and (exists (select 1 from public.baixa_correcoes c where c.extrato_linha_id = l.id and c.desfeita_em is null)
          or exists (select 1 from public.mutuos_iof_historico m where m.extrato_linha_id = l.id));

  return jsonb_build_object(
    'importacao_id', v_imp.id,
    'arquivo', v_imp.arquivo_nome,
    'linhas', v_linhas,
    'conciliadas', v_conc,
    'ignoradas', v_ign,
    'fechado_ate', case when v_ate is not null and v_min is not null and v_min <= v_ate then v_ate else null end,
    'presas', v_presas
  );
end;
$function$;
revoke all on function public.previa_de_retirar_extrato(uuid) from public, anon;
grant execute on function public.previa_de_retirar_extrato(uuid) to authenticated;

create or replace function public.retirar_extrato(
  p_conta_id uuid,
  p_importacao_id uuid,
  p_motivo text,
  p_conciliacoes_desfeitas integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid;
  v_conta   contas_bancarias%rowtype;
  v_imp     extrato_importacoes%rowtype;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_linhas  integer;
  v_conc    integer;
  v_ign     integer;
  v_min     date;
  v_ate     date;
  v_corr    uuid[];
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  v_uid := public._exige_financeiro_conciliacao(v_conta.tenant_id);

  select * into v_imp from public.extrato_importacoes
   where conta_bancaria_id = p_conta_id
   order by created_at desc, id desc
   limit 1
   for update;
  if not found then raise exception 'Esta conta não tem extrato importado.'; end if;
  if v_imp.id is distinct from p_importacao_id then
    raise exception 'Outro extrato foi importado nesta conta depois: recarregue a página.';
  end if;
  if coalesce(p_conciliacoes_desfeitas, 0) > 0 and length(v_motivo) < 10 then
    raise exception 'Explique o motivo (pelo menos 10 caracteres).';
  end if;
  if length(v_motivo) > 1000 then
    raise exception 'O motivo passa de 1.000 caracteres: resuma.';
  end if;

  perform 1 from public.extrato_linhas where importacao_id = v_imp.id for update;
  select count(*)::int,
         (count(*) filter (where v.conciliada))::int,
         (count(*) filter (where not v.conciliada and v.ignorada_em is not null))::int,
         min(v.data)
    into v_linhas, v_conc, v_ign, v_min
    from public.vw_extrato_linhas v
   where v.importacao_id = v_imp.id;
  if v_conc > 0 then
    raise exception '% deste extrato: desfaça a conciliação antes de retirar.',
      case when v_conc = 1 then '1 linha ainda está conciliada' else v_conc || ' linhas ainda estão conciliadas' end;
  end if;
  v_ate := public._conciliacao_fechada_ate(p_conta_id);
  if v_ate is not null and v_min is not null and v_min <= v_ate then
    raise exception 'A conciliação desta conta está fechada até %, e este extrato tem linhas nesse período: reabra a conciliação antes de retirar o extrato.',
      to_char(v_ate, 'DD/MM')
      using errcode = '55000';
  end if;
  if exists (
    select 1 from public.extrato_linhas l
     where l.importacao_id = v_imp.id
       and (exists (select 1 from public.baixa_correcoes c where c.extrato_linha_id = l.id and c.desfeita_em is null)
            or exists (select 1 from public.mutuos_iof_historico m where m.extrato_linha_id = l.id))
  ) then
    raise exception 'Este extrato tem linha com correção de baixa em vigor ou IOF de mútuo registrado no histórico: ele não pode ser retirado.';
  end if;

  -- A correção já desfeita continua no histórico do título, sem a linha do banco.
  with soltas as (
    update public.baixa_correcoes c
       set extrato_linha_id = null
     where c.desfeita_em is not null
       and c.extrato_linha_id in (select l.id from public.extrato_linhas l where l.importacao_id = v_imp.id)
    returning c.id
  )
  select array_agg(id) into v_corr from soltas;

  delete from public.extrato_linhas where importacao_id = v_imp.id;
  delete from public.extrato_importacoes where id = v_imp.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_conta.tenant_id, 'extrato_importacao', v_imp.id::text, 'extrato.retirado', v_uid,
          jsonb_build_object('conta_bancaria_id', p_conta_id, 'arquivo', v_imp.arquivo_nome,
                             'periodo_inicio', v_imp.periodo_inicio, 'periodo_fim', v_imp.periodo_fim,
                             'importado_em', v_imp.created_at, 'importado_por', v_imp.importado_por,
                             'linhas', v_linhas, 'ignoradas', v_ign,
                             'conciliacoes_desfeitas', coalesce(p_conciliacoes_desfeitas, 0),
                             'correcoes_desfeitas_sem_a_linha', coalesce(to_jsonb(v_corr), '[]'::jsonb),
                             'motivo', nullif(v_motivo, '')));
  return jsonb_build_object('arquivo', v_imp.arquivo_nome, 'linhas', v_linhas);
end;
$function$;
revoke all on function public.retirar_extrato(uuid, uuid, text, integer) from public, anon;
grant execute on function public.retirar_extrato(uuid, uuid, text, integer) to authenticated;
comment on function public.retirar_extrato(uuid, uuid, text, integer) is
  'Decisão 254: retira o ÚLTIMO extrato importado da conta (as linhas dele e o arquivo), só com todas as linhas sem conciliação e o período aberto. A tela desfaz as conciliações antes, pelo desfazer_conciliacao. A correção de baixa já desfeita fica no histórico, sem a linha. Audita extrato.retirado.';
