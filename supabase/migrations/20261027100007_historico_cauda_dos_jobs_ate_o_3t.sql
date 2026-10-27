-- =============================================================================
-- A cauda do histórico: outubro dos jobs até o 3T (decisão 211, A6)
-- =============================================================================
-- Decisão do Tiago em 27/10/2026, depois do inventário do 4T: "Os movimentos
-- de outubro dos jobs até o 3T entram no histórico, como uma carga própria, e
-- a conciliação marca essas linhas do extrato como do histórico. No sistema
-- ficam só os jobs do 4T." E, perguntado sobre os jobs do 3T que já existem
-- no sistema (cerca de 15, com PPs): "Ficam no sistema".
--
-- Até aqui o histórico ia até 30/09/2026 e a função recusava carga depois
-- disso. Passa a haver dois tipos de carga:
--
-- - `periodo`: a de sempre, até 30/09/2026.
-- - `cauda`: do dia seguinte ao corte em diante, com os movimentos e as notas
--   dos jobs até o 3T de 2026 (ou de ano anterior) que não existem no
--   sistema. O script `empacotar.ts --cauda` escolhe as linhas; os jobs do
--   4T, os do sistema e o que não é de job entram pelo sistema.
--
-- A cauda cresce a cada planilha nova (01/10 a 25/10, depois 01/10 a 31/10...),
-- então a cauda nova substitui a ativa ao concluir, qualquer que seja o
-- período, e não "cruza" com ela. A carga de período continua como era.
--
-- Aditiva: coluna nova com padrão, e as duas funções reescritas com a mesma
-- regra para as cargas de período.
-- =============================================================================

alter table public.historico_cargas
  add column if not exists tipo text not null default 'periodo';

alter table public.historico_cargas
  drop constraint if exists historico_cargas_tipo_check;
alter table public.historico_cargas
  add constraint historico_cargas_tipo_check check (tipo in ('periodo', 'cauda'));

comment on column public.historico_cargas.tipo is
  'periodo: a planilha de um período até 30/09/2026. cauda: depois do corte, só os movimentos e as notas dos jobs até o 3T que não existem no sistema (decisão 211, A6); a cauda nova substitui a ativa.';

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
  if v_tipo not in ('periodo', 'cauda') then
    raise exception 'Tipo de carga desconhecido: %.', v_tipo;
  end if;
  if v_tipo = 'periodo' and v_ate > date '2026-09-30' then
    raise exception 'O histórico vai até 30/09/2026: a partir de 01/10/2026 vale o sistema, e só a cauda dos jobs até o 3T entra depois disso.';
  end if;
  if v_tipo = 'cauda' and v_de <= date '2026-09-30' then
    raise exception 'A cauda começa depois do corte, em 01/10/2026.';
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
  -- A cauda substitui a cauda ativa ao concluir; só a carga de período cruza.
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

  -- Substitui a carga ativa do mesmo período; a cauda, a cauda ativa.
  select coalesce(array_agg(id), '{}') into v_antigas
    from public.historico_cargas
   where tenant_id = v_carga.tenant_id and situacao = 'ativa'
     and ((v_carga.tipo = 'periodo' and tipo = 'periodo'
           and periodo_de = v_carga.periodo_de and periodo_ate = v_carga.periodo_ate)
       or (v_carga.tipo = 'cauda' and tipo = 'cauda'));
  if cardinality(v_antigas) > 0 then
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
                             'linhas', v_linhas, 'substituidas', to_jsonb(v_antigas)));

  return jsonb_build_object('linhas', v_linhas, 'substituidas', cardinality(v_antigas));
end;
$function$;
