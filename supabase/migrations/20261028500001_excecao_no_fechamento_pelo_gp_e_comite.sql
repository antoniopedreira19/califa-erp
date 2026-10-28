-- Decisão 225 — o GP registra a exceção no fechamento do internacional, e a
-- versão com exceção passa pelo Comitê de Aprovações.
--
-- Pedido do Tiago (28/10/2026): a Exceção no fechamento (decisão 206), que
-- era só do administrador, passa a ser usada também pelo GP; a versão com
-- exceção precisa da aprovação do Comitê (decisão 223). Respostas dele:
--   * é uma regra nova do Comitê, ligada por padrão, a última da seção
--     "Abertura de job" das Configurações;
--   * o administrador segue a chave "O administrador aprova direto na tela",
--     como nas outras regras;
--   * depois de aprovada pelo Comitê, a exceção só volta ao Comitê se as
--     taxas mudarem. Se voltarem ao padrão (a exceção sai), a versão aprova
--     sem o Comitê — a regra só pega com a exceção registrada.
--
-- O que muda:
--   1. `comite_config.excecao_ligada` (padrão true) e o padrão em
--      `comite_regras`.
--   2. `comite_situacao_da_versao`: a regra pega com a exceção registrada; o
--      pedido aprovado do orçamento cobre a exceção enquanto as três taxas
--      forem as do retrato aprovado.
--   3. `comite_pedido_guarda`: o retrato do pedido guarda as taxas da
--      exceção (`snapshot.excecao`, nulo sem exceção).
--   4. `versao_confere_limites_na_aprovacao`: a frase do motivo.
--   5. `versao_fechamento_internacional_no_padrao`: o GP (gerente_producao)
--      também registra, altera e remove a exceção.

-- ---- 1. A regra --------------------------------------------------------------

alter table public.comite_config
  add column if not exists excecao_ligada boolean not null default true;

comment on column public.comite_config.excecao_ligada is
  'Decisão 225: a versão com exceção no fechamento do internacional precisa do Comitê.';

create or replace function public.comite_regras(p_tenant_id uuid)
 returns comite_config
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v public.comite_config;
begin
  select * into v from public.comite_config where tenant_id = p_tenant_id;
  if not found then
    v.tenant_id := p_tenant_id;
    v.resultado_ligado := true;
    v.resultado_minimo := 20;
    v.planejado_ligado := true;
    v.pp_ligado := true;
    v.linhas_vermelhas := false;
    v.tolerancia_ligada := false;
    v.tolerancia_valor := 0;
    v.tolerancia_pct := 0;
    v.admin_direto := true;
    v.excecao_ligada := true;
  end if;
  return v;
end;
$function$;

-- ---- 2. A situação da versão -------------------------------------------------

create or replace function public.comite_retrato_da_excecao(v public.versoes_orcamento)
 returns jsonb
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select case when v.excecao_fechamento_motivo is null then null
    else jsonb_build_object(
      'int_taxes', v.percentual_int_taxes,
      'imposto', v.percentual_imposto,
      'itc', v.int_transaction_costs)
  end;
$function$;

comment on function public.comite_retrato_da_excecao(public.versoes_orcamento) is
  'Decisão 225: as três taxas da exceção no fechamento da versão, para o retrato do pedido ao Comitê (nulo sem exceção).';

create or replace function public.comite_situacao_da_versao(p_versao_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_versao public.versoes_orcamento;
  v_cfg public.comite_config;
  v_itens integer;
  v_resultado numeric;
  v_planejado_pega boolean;
  v_resultado_pega boolean;
  v_excecao_pega boolean;
  v_aprovado public.comite_pedidos;
  v_coberta boolean := false;
begin
  select * into v_versao from public.versoes_orcamento where id = p_versao_id;
  if not found or not public.is_tenant_member(v_versao.tenant_id) then return null; end if;
  if public.orcamento_de_investimento_interno(v_versao.orcamento_id) then
    return jsonb_build_object('regra', false, 'interno', true);
  end if;

  v_cfg := public.comite_regras(v_versao.tenant_id);
  select l.itens_acima, l.resultado_geral into v_itens, v_resultado
    from public.versao_limites(p_versao_id) l;
  v_planejado_pega := v_cfg.planejado_ligado and coalesce(v_itens, 0) > 0;
  v_resultado_pega := v_cfg.resultado_ligado and v_resultado is not null
                      and v_resultado < v_cfg.resultado_minimo - 0.000000001;
  -- Decisão 225: só com a exceção registrada. As taxas de volta ao padrão
  -- tiram a exceção, e a regra deixa de pegar.
  v_excecao_pega := coalesce(v_cfg.excecao_ligada, true) and v_versao.excecao_fechamento_motivo is not null;

  select * into v_aprovado
    from public.comite_pedidos p
   where p.tipo = 'versao' and p.orcamento_id = v_versao.orcamento_id and p.status = 'aprovado'
   order by p.decidido_em desc
   limit 1;
  if found then
    v_coberta := coalesce(v_itens, 0) <= coalesce((v_aprovado.snapshot->>'itens_acima')::int, 0)
      and (v_resultado is null
           or (v_aprovado.snapshot->>'resultado_geral') is null
           or v_resultado >= (v_aprovado.snapshot->>'resultado_geral')::numeric - 0.000000001)
      -- A exceção aprovada cobre as mesmas três taxas; taxa diferente volta.
      and (not v_excecao_pega or (
            (v_aprovado.snapshot->'excecao') is not null
        and jsonb_typeof(v_aprovado.snapshot->'excecao') = 'object'
        and (v_aprovado.snapshot->'excecao'->>'int_taxes')::numeric = v_versao.percentual_int_taxes
        and (v_aprovado.snapshot->'excecao'->>'imposto')::numeric = v_versao.percentual_imposto
        and (v_aprovado.snapshot->'excecao'->>'itc')::numeric = v_versao.int_transaction_costs));
  end if;

  return jsonb_build_object(
    'regra', v_planejado_pega or v_resultado_pega or v_excecao_pega,
    'planejado', v_planejado_pega,
    'resultado', v_resultado_pega,
    'excecao', v_excecao_pega,
    'itens_acima', coalesce(v_itens, 0),
    'resultado_geral', v_resultado,
    'resultado_minimo', v_cfg.resultado_minimo,
    'coberta', v_coberta,
    'direto', v_cfg.admin_direto and public.is_tenant_admin(v_versao.tenant_id)
  );
end;
$function$;

-- ---- 3. O retrato do pedido --------------------------------------------------

create or replace function public.comite_pedido_guarda()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_lim record;
  v_versao public.versoes_orcamento;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pendente' then
      raise exception 'O pedido ao Comitê nasce pendente.';
    end if;
    if (select auth.uid()) is not null then
      new.enviado_por := (select auth.uid());
    end if;
    new.enviado_em := now();
    new.decidido_por := null;
    new.decidido_em := null;
    new.comentario := null;
    if new.tipo = 'versao' then
      select v.orcamento_id into new.orcamento_id
        from public.versoes_orcamento v
       where v.id = new.versao_orcamento_id and v.tenant_id = new.tenant_id;
      if new.orcamento_id is null then
        raise exception 'Versão não encontrada.';
      end if;
      select * into v_versao from public.versoes_orcamento where id = new.versao_orcamento_id;
      select l.itens_acima, l.resultado_geral, l.valor_job into v_lim
        from public.versao_limites(new.versao_orcamento_id) l;
      new.snapshot := jsonb_build_object('itens_acima', v_lim.itens_acima, 'resultado_geral', v_lim.resultado_geral, 'valor_job', v_lim.valor_job,
                                         'excecao', public.comite_retrato_da_excecao(v_versao));
    else
      select a.job_id, a.item_realizado_id into new.job_id, new.item_realizado_id
        from public.pedidos_compra_a_emitir a
       where a.id = new.pp_a_emitir_id and a.tenant_id = new.tenant_id and a.excluida_em is null and a.pp_id is null;
      if new.job_id is null then
        raise exception 'PP a emitir não encontrada.';
      end if;
      new.snapshot := public.comite_retrato_da_pp(new.pp_a_emitir_id);
    end if;
    return new;
  end if;

  if old.status <> 'pendente' then
    raise exception 'Este pedido ao Comitê já foi encerrado.' using errcode = '42501';
  end if;
  if new.tenant_id <> old.tenant_id or new.tipo <> old.tipo
     or new.versao_orcamento_id is distinct from old.versao_orcamento_id
     or new.orcamento_id is distinct from old.orcamento_id
     or new.pp_a_emitir_id is distinct from old.pp_a_emitir_id
     or new.job_id is distinct from old.job_id
     or new.item_realizado_id is distinct from old.item_realizado_id
     or new.enviado_por <> old.enviado_por or new.enviado_em <> old.enviado_em
     or new.motivo <> old.motivo then
    raise exception 'O pedido ao Comitê não pode ser alterado.' using errcode = '42501';
  end if;

  if new.status = 'cancelado' then
    new.decidido_por := null;
    new.decidido_em := null;
    new.snapshot := old.snapshot;
  elsif new.status in ('aprovado', 'devolvido') then
    if (select auth.uid()) is not null and not public.pode_decidir_no_comite(old.tenant_id) then
      raise exception 'Só um membro do Comitê de Aprovações decide este pedido.' using errcode = '42501';
    end if;
    new.decidido_por := coalesce((select auth.uid()), new.decidido_por);
    new.decidido_em := now();
    if old.tipo = 'versao' then
      select * into v_versao from public.versoes_orcamento where id = old.versao_orcamento_id;
      select l.itens_acima, l.resultado_geral, l.valor_job into v_lim
        from public.versao_limites(old.versao_orcamento_id) l;
      new.snapshot := jsonb_build_object('itens_acima', v_lim.itens_acima, 'resultado_geral', v_lim.resultado_geral, 'valor_job', v_lim.valor_job,
                                         'excecao', public.comite_retrato_da_excecao(v_versao));
    else
      new.snapshot := public.comite_retrato_da_pp(old.pp_a_emitir_id);
    end if;
  elsif new.status = 'pendente' then
    new.snapshot := old.snapshot;
  end if;
  return new;
end;
$function$;

-- ---- 4. A frase do motivo na aprovação --------------------------------------

create or replace function public.versao_confere_limites_na_aprovacao()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_sit jsonb;
begin
  if new.status <> 'aprovada' or old.status = 'aprovada' then return new; end if;
  v_sit := public.comite_situacao_da_versao(new.id);
  if v_sit is null or not coalesce((v_sit->>'regra')::boolean, false) then return new; end if;
  if (v_sit->>'direto')::boolean or (v_sit->>'coberta')::boolean then return new; end if;
  raise exception 'Esta versão precisa da aprovação do Comitê de Aprovações: %. Solicite a aprovação.',
    concat_ws(' e ',
      case when (v_sit->>'planejado')::boolean then 'há item com planejado acima do orçado' end,
      case when (v_sit->>'resultado')::boolean
        then 'o resultado geral está abaixo de '
             || replace(replace(to_char((v_sit->>'resultado_minimo')::numeric, 'FM990.0'), '.0', ''), '.', ',') || '%' end,
      case when (v_sit->>'excecao')::boolean then 'há exceção no fechamento do internacional' end)
    using errcode = '42501';
end;
$function$;

-- ---- 5. O GP registra a exceção -----------------------------------------------

create or replace function public.versao_fechamento_internacional_no_padrao()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_modelo text;
  v_mudou_excecao boolean;
  v_mudou_taxas boolean;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  select c.modelo_planilha::text into v_modelo
    from public.orcamentos o
    left join public.categorias_dominio c on c.id = o.categoria_id
   where o.id = new.orcamento_id and o.tenant_id = new.tenant_id;

  if v_modelo is distinct from 'internacional' then
    if new.excecao_fechamento_motivo is not null
       and (tg_op = 'INSERT' or old.excecao_fechamento_motivo is null) then
      raise exception 'A exceção no fechamento só existe no orçamento internacional.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  v_mudou_excecao := case
    when tg_op = 'INSERT' then new.excecao_fechamento_motivo is not null
    else new.excecao_fechamento_motivo is distinct from old.excecao_fechamento_motivo
      or new.excecao_fechamento_por is distinct from old.excecao_fechamento_por
      or new.excecao_fechamento_em is distinct from old.excecao_fechamento_em
  end;

  -- Decisão 225: o GP também registra a exceção (a aprovação vai ao Comitê).
  if v_mudou_excecao
     and not public.is_tenant_admin(new.tenant_id)
     and (select public.session_role()) is distinct from 'gerente_producao'::app_role then
    raise exception 'Só o administrador ou o GP registra, altera ou remove a exceção no fechamento.'
      using errcode = '42501';
  end if;

  -- Versão nova sem exceção nasce no padrão.
  if tg_op = 'INSERT' and new.excecao_fechamento_motivo is null then
    new.percentual_int_taxes := 18.02;
    new.int_transaction_costs := 0;
    if new.percentual_imposto not in (0, 19.53) then
      new.percentual_imposto := 19.53;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Tirar a exceção conta como mudar as taxas: sem ela, elas têm de
    -- voltar ao padrão no mesmo update.
    v_mudou_taxas :=
      new.percentual_int_taxes is distinct from old.percentual_int_taxes
      or new.int_transaction_costs is distinct from old.int_transaction_costs
      or new.percentual_imposto is distinct from old.percentual_imposto
      or (old.excecao_fechamento_motivo is not null and new.excecao_fechamento_motivo is null);

    if v_mudou_taxas and new.excecao_fechamento_motivo is null and (
      new.percentual_int_taxes <> 18.02
      or new.int_transaction_costs <> 0
      or new.percentual_imposto not in (0, 19.53)
    ) then
      raise exception 'Fora do padrão (int. taxes 18,02%%, impostos BR 19,53%%, sem custo de transação), o fechamento do internacional só muda pela Exceção no fechamento.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;
