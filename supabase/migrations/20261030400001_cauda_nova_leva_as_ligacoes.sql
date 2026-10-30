-- =====================================================================
-- A cauda nova leva as ligações da antiga (decisão 211, A6; 30/10/2026)
-- =====================================================================
--
-- O Tiago ampliou a cauda: além dos jobs até o 3T, tudo de outubro sem job,
-- do DRE, com competência até o 3T (folha de setembro, impostos, custos
-- fixos, contas avulsas, imobilizado), fora empréstimo e mútuo. A cauda nova
-- substitui a ativa — e a troca soltava todas as linhas do banco ligadas à
-- antiga (664 linhas), que a conciliação teria de refazer.
--
-- Agora, na troca de cauda, o movimento novo com a mesma digital (a mesma
-- linha da planilha), a mesma conta e o mesmo valor herda a ligação com o
-- banco do antigo, e essa linha do banco não é solta. Só se solta a linha
-- cujo movimento sumiu da cauda nova. A carga de período continua como era.
-- =====================================================================

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
