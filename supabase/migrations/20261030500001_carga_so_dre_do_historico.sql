-- =====================================================================
-- A carga "só DRE" do histórico (decisão 211; Tiago, 30/10/2026)
-- =====================================================================
--
-- O único DRE do sistema lê as cargas do histórico. Em outubro, o que já
-- foi pago pelo sistema (PP baixada, tarifa lançada pela regra) tem o caixa
-- nos lançamentos e não aparece no DRE; na cauda, contaria duas vezes no
-- saldo. O Tiago aprovou fazer essas linhas contarem no resultado e não no
-- saldo.
--
-- A carga de tipo `so_dre` faz isso sem mexer em quem lê: o DRE, o regional
-- e a rentabilidade somam todas as cargas ativas, e o saldo, o extrato e a
-- conciliação leem só as de tipo `cauda`.
--
--   * `tipo` ganha 'so_dre' (o CHECK é o mesmo, com um valor a mais).
--   * `historico_iniciar_carga`: como a cauda, começa depois do corte.
--   * `historico_concluir_carga`: a nova substitui a ativa do mesmo tipo, e
--     a mesma linha da planilha não pode estar na cauda e no só DRE: contaria
--     duas vezes no resultado.
--
-- Aditiva: nenhuma linha existente muda. As funções mantêm o GRANT que têm.
-- =====================================================================

alter table public.historico_cargas drop constraint historico_cargas_tipo_check;
alter table public.historico_cargas add constraint historico_cargas_tipo_check check (
  tipo = any (array['periodo', 'cauda', 'so_dre'])
);

create or replace function public.historico_iniciar_carga(p_tenant_id uuid, p_cabecalho jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid := public._exige_financeiro_historico(p_tenant_id);
  v_de       date := (p_cabecalho->'carga'->>'de')::date;
  v_ate      date := (p_cabecalho->'carga'->>'ate')::date;
  v_tipo     text := coalesce(p_cabecalho->'carga'->>'tipo', 'periodo');
  v_esperado jsonb := p_cabecalho->'esperado';
  v_cruzada  record;
  v_id       uuid;
begin
  if v_de is null or v_ate is null or v_de > v_ate then
    raise exception 'O período da carga é inválido.';
  end if;
  if v_tipo not in ('periodo', 'cauda', 'so_dre') then
    raise exception 'Tipo de carga desconhecido: %.', v_tipo;
  end if;
  if v_tipo = 'periodo' and v_ate > date '2026-09-30' then
    raise exception 'O histórico vai até 30/09/2026: a partir de 01/10/2026 vale o sistema, e só a cauda dos jobs até o 3T entra depois disso.';
  end if;
  if v_tipo = 'cauda' and v_de <= date '2026-09-30' then
    raise exception 'A cauda começa depois do corte, em 01/10/2026.';
  end if;
  if v_tipo = 'so_dre' and v_de <= date '2026-09-30' then
    raise exception 'A carga só DRE começa depois do corte, em 01/10/2026.';
  end if;
  if jsonb_typeof(v_esperado) is distinct from 'object'
     or exists (select 1 from unnest(array['rateio', 'saldos', 'jobs', 'notas', 'movimentos']) t
                 where jsonb_typeof(v_esperado->t->'linhas') is distinct from 'number')
     or v_esperado->'movimentos'->>'soma' is null
     or v_esperado->'notas'->>'soma' is null then
    raise exception 'O pacote não diz quantas linhas traz: gere-o de novo pelo script empacotar.ts.';
  end if;
  if exists (select 1 from public.historico_cargas where tenant_id = p_tenant_id and situacao = 'carregando') then
    raise exception 'Já há uma carga em andamento. Conclua ou descarte essa carga antes de começar outra.';
  end if;
  -- A cauda e o só DRE substituem a ativa do tipo ao concluir; só a carga de
  -- período cruza.
  select nome, periodo_de, periodo_ate into v_cruzada
    from public.historico_cargas
   where tenant_id = p_tenant_id and situacao = 'ativa' and tipo = 'periodo'
     and periodo_de <= v_ate and periodo_ate >= v_de
     and not (v_tipo = 'periodo' and periodo_de = v_de and periodo_ate = v_ate)
   limit 1;
  if found then
    raise exception 'O período cruza o da carga "%" (% a %). Carregue o mesmo período, que a substitui, ou desfaça aquela carga antes.',
      v_cruzada.nome, to_char(v_cruzada.periodo_de, 'DD/MM/YYYY'), to_char(v_cruzada.periodo_ate, 'DD/MM/YYYY');
  end if;

  insert into public.historico_cargas (
    tenant_id, nome, tipo, periodo_de, periodo_ate, planilha_versao, planilha_arquivo, planilha_sha256,
    pacote_arquivo, pacote_sha256, esperado, criada_por
  ) values (
    p_tenant_id, btrim(p_cabecalho->'carga'->>'nome'), v_tipo, v_de, v_ate,
    (p_cabecalho->'planilha'->>'versao')::date, p_cabecalho->'planilha'->>'arquivo', p_cabecalho->'planilha'->>'sha256',
    p_cabecalho->'pacote'->>'arquivo', p_cabecalho->'pacote'->>'sha256', v_esperado, v_uid
  )
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.historico_concluir_carga(p_carga_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_carga     public.historico_cargas%rowtype;
  v_uid       uuid;
  v_linhas    jsonb;
  v_tabela    text;
  v_soma      numeric;
  v_antigas   uuid[];
  v_cruzada   record;
  v_herdadas  integer := 0;
  v_repetidas integer;
begin
  select * into v_carga from public.historico_cargas where id = p_carga_id for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  v_uid := public._exige_financeiro_historico(v_carga.tenant_id);
  if v_carga.situacao <> 'carregando' then
    raise exception 'Esta carga não está em andamento.';
  end if;

  v_linhas := public._historico_contar_linhas(v_carga.id);
  foreach v_tabela in array array['rateio', 'saldos', 'jobs', 'notas', 'movimentos'] loop
    if (v_linhas->>v_tabela)::integer is distinct from (v_carga.esperado->v_tabela->>'linhas')::integer then
      raise exception 'A carga não está completa: % de % linhas de %.',
        v_linhas->>v_tabela, coalesce(v_carga.esperado->v_tabela->>'linhas', '?'), v_tabela;
    end if;
  end loop;
  select coalesce(sum(valor), 0) into v_soma from public.historico_movimentos where carga_id = v_carga.id;
  if v_soma is distinct from (v_carga.esperado->'movimentos'->>'soma')::numeric then
    raise exception 'A soma dos movimentos no banco (%) não bate com a do pacote (%).',
      v_soma, v_carga.esperado->'movimentos'->>'soma';
  end if;
  select coalesce(sum(valor), 0) into v_soma from public.historico_notas where carga_id = v_carga.id;
  if v_soma is distinct from (v_carga.esperado->'notas'->>'soma')::numeric then
    raise exception 'A soma das notas no banco (%) não bate com a do pacote (%).',
      v_soma, v_carga.esperado->'notas'->>'soma';
  end if;

  -- Outra carga de período ativa pode ter sido concluída com período cruzado
  -- depois que esta começou.
  select nome, periodo_de, periodo_ate into v_cruzada
    from public.historico_cargas
   where tenant_id = v_carga.tenant_id and situacao = 'ativa' and tipo = 'periodo'
     and periodo_de <= v_carga.periodo_ate and periodo_ate >= v_carga.periodo_de
     and not (v_carga.tipo = 'periodo' and periodo_de = v_carga.periodo_de and periodo_ate = v_carga.periodo_ate)
   limit 1;
  if found then
    raise exception 'O período cruza o da carga "%" (% a %). Desfaça aquela carga antes de concluir esta.',
      v_cruzada.nome, to_char(v_cruzada.periodo_de, 'DD/MM/YYYY'), to_char(v_cruzada.periodo_ate, 'DD/MM/YYYY');
  end if;

  -- A mesma linha da planilha na cauda e no só DRE contaria duas vezes no
  -- resultado.
  if v_carga.tipo in ('cauda', 'so_dre') then
    select count(*)::int into v_repetidas
      from public.historico_movimentos n
      join public.historico_movimentos o on o.digital = n.digital
      join public.historico_cargas c on c.id = o.carga_id
     where n.carga_id = v_carga.id
       and c.tenant_id = v_carga.tenant_id
       and c.situacao = 'ativa'
       and c.tipo in ('cauda', 'so_dre')
       and c.tipo <> v_carga.tipo;
    if v_repetidas > 0 then
      raise exception '% linha(s) desta carga já estão na carga ativa de outro tipo e contariam duas vezes no resultado.', v_repetidas;
    end if;
  end if;

  -- Substitui a carga ativa do mesmo período; a cauda, a cauda ativa; o só
  -- DRE, o só DRE ativo.
  select coalesce(array_agg(id), '{}') into v_antigas
    from public.historico_cargas
   where tenant_id = v_carga.tenant_id and situacao = 'ativa'
     and ((v_carga.tipo = 'periodo' and tipo = 'periodo'
           and periodo_de = v_carga.periodo_de and periodo_ate = v_carga.periodo_ate)
       or (v_carga.tipo = 'cauda' and tipo = 'cauda')
       or (v_carga.tipo = 'so_dre' and tipo = 'so_dre'));
  if cardinality(v_antigas) > 0 then
    if v_carga.tipo = 'cauda' then
      -- A mesma linha da planilha (digital), na mesma conta e no mesmo valor,
      -- herda a ligação com o banco; a antiga larga, e a linha do banco fica.
      with herdadas as (
        update public.historico_movimentos n
           set extrato_linha_id = o.extrato_linha_id
          from public.historico_movimentos o
         where n.carga_id = v_carga.id
           and o.carga_id = any(v_antigas)
           and o.extrato_linha_id is not null
           and n.extrato_linha_id is null
           and n.digital = o.digital
           and n.conta_bancaria_id is not distinct from o.conta_bancaria_id
           and n.valor = o.valor
        returning o.id
      )
      update public.historico_movimentos
         set extrato_linha_id = null
       where id in (select id from herdadas);
      get diagnostics v_herdadas = row_count;
    end if;
    perform public._historico_apagar_linhas(v_antigas);
    update public.historico_cargas
       set situacao = 'substituida', encerrada_em = now(), encerrada_por = v_uid, substituida_por = v_carga.id
     where id = any(v_antigas);
  end if;

  update public.historico_cargas
     set situacao = 'ativa', gravado = v_linhas, concluida_em = now(), concluida_por = v_uid
   where id = v_carga.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_carga.tenant_id, 'historico_carga', v_carga.id::text, 'historico.carga_concluida', v_uid,
          jsonb_build_object('nome', v_carga.nome, 'tipo', v_carga.tipo, 'periodo_de', v_carga.periodo_de, 'periodo_ate', v_carga.periodo_ate,
                             'planilha_versao', v_carga.planilha_versao, 'pacote', v_carga.pacote_arquivo,
                             'linhas', v_linhas, 'substituidas', to_jsonb(v_antigas), 'ligacoes_herdadas', v_herdadas));

  return jsonb_build_object('linhas', v_linhas, 'substituidas', cardinality(v_antigas), 'ligacoes_herdadas', v_herdadas);
end;
$function$;
