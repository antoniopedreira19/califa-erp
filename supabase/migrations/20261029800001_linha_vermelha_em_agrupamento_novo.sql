-- Decisão 226, revisão de 29/10/2026: o agrupamento novo só de linhas
-- vermelhas também sai da errata.
--
-- Na 226 a vermelha criada num agrupamento novo ficava na errata, porque o
-- agrupamento só nascia com ela (decisão 162). O Tiago decidiu: o
-- agrupamento novo composto APENAS por linhas vermelhas nasce junto com
-- elas, fora da errata. Com item normal ou linha movida para ele, segue
-- errata, com as vermelhas dentro (caso real: o BOC-1003/26 tinha uma errata
-- pronta com 7 vermelhas num agrupamento novo "LINHA VERMELHA").
--
-- 1. `jobs_grupos.criado_por`: quem criou o agrupamento fora da errata. O
--    histórico da planilha (decisão 186) tira o agrupamento junto da linha
--    vermelha que o criou.
-- 2. `adicionar_linhas_vermelhas_do_job` passa a aceitar, no segundo
--    parâmetro, `{grupos: [...], linhas: [...]}` além da lista de linhas de
--    antes. Cada agrupamento vem com a chave do rascunho, o nome e a âncora
--    (agrupamento da versão aprovada do mesmo mês, como na errata); a linha
--    aponta para o agrupamento pela chave. Mesma assinatura: nada de função
--    duplicada.
--
-- Aditiva: coluna nova anulável e a função com o mesmo contrato de antes.

alter table public.jobs_grupos
  add column if not exists criado_por uuid;

comment on column public.jobs_grupos.criado_por is
  'Decisão 226: quem criou o agrupamento fora da errata, junto de linhas vermelhas. Nulo nos da versão e nos criados por errata (criado_na_errata_id).';

create or replace function public.adicionar_linhas_vermelhas_do_job(
  p_job_id uuid,
  p_linhas jsonb
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job    record;
  v_uid    uuid := (select auth.uid());
  v_l      jsonb;
  v_g      jsonb;
  v_gid    uuid;
  v_mes    uuid;
  v_id     uuid;
  v_ordem  integer;
  v_ids    jsonb := '{}'::jsonb;
  v_grupos jsonb := '{}'::jsonb;
  -- Antes da revisão de 29/10/2026 o parâmetro era só a lista de linhas.
  v_lista  jsonb := case when jsonb_typeof(p_linhas) = 'array' then p_linhas else coalesce(p_linhas->'linhas', '[]'::jsonb) end;
  v_novos  jsonb := case when jsonb_typeof(p_linhas) = 'object' then coalesce(p_linhas->'grupos', '[]'::jsonb) else '[]'::jsonb end;
begin
  if coalesce((select public.session_role())::text, '') not in ('administrador', 'gerente_producao', 'produtor') then
    raise exception 'Só o administrador, o GP ou o produtor cria linha vermelha.';
  end if;

  if jsonb_typeof(v_lista) <> 'array' or jsonb_array_length(v_lista) = 0 then
    raise exception 'Nenhuma linha vermelha informada.';
  end if;

  select j.id, j.tenant_id, j.versao_orcamento_aprovada_id
    into v_job
    from public.jobs j
   where j.id = p_job_id
   for update;
  if not found then
    raise exception 'Job não encontrado.';
  end if;

  -- ---- Agrupamentos novos, só de linhas vermelhas ----
  select coalesce(max(g.ordem), 0) into v_ordem
    from public.jobs_grupos g where g.job_id = p_job_id;
  for v_g in select * from jsonb_array_elements(v_novos)
  loop
    if btrim(coalesce(v_g->>'nome', '')) = '' then
      raise exception 'O agrupamento novo precisa de um nome.';
    end if;
    select v.mes_id into v_mes
      from public.versoes_orcamento_grupos v
     where v.id = nullif(v_g->>'ancora', '')::uuid
       and v.versao_orcamento_id = v_job.versao_orcamento_aprovada_id;
    if not found then
      raise exception 'O agrupamento novo não pertence à versão aprovada deste job. Recarregue a página.';
    end if;
    if exists (
      select 1 from public.jobs_grupos g
       where g.job_id = p_job_id
         and g.removido_em is null
         and g.mes_id is not distinct from v_mes
         and lower(btrim(g.nome)) = lower(btrim(v_g->>'nome'))
    ) then
      raise exception 'Já existe um agrupamento com esse nome neste job.';
    end if;
    v_ordem := v_ordem + 1;
    insert into public.jobs_grupos (
      tenant_id, job_id, grupo_versao_id, mes_id, nome, ordem, criado_por
    ) values (
      v_job.tenant_id, p_job_id, (v_g->>'ancora')::uuid, v_mes,
      btrim(v_g->>'nome'), v_ordem, v_uid
    )
    returning id into v_gid;
    v_grupos := v_grupos || jsonb_build_object(v_g->>'chave', v_gid);
  end loop;

  -- ---- As linhas ----
  for v_l in select * from jsonb_array_elements(v_lista)
  loop
    if btrim(coalesce(v_l->>'item', '')) = '' then
      raise exception 'Toda linha vermelha precisa de uma descrição.';
    end if;

    if v_grupos ? (v_l->>'grupo_id') then
      v_gid := (v_grupos->>(v_l->>'grupo_id'))::uuid;
    else
      select g.id into v_gid
        from public.jobs_grupos g
       where g.id = nullif(v_l->>'grupo_id', '')::uuid
         and g.job_id = p_job_id
         and g.removido_em is null;
      if not found then
        raise exception 'O agrupamento da linha vermelha não é deste job. Recarregue a página.';
      end if;
    end if;

    select coalesce(max(o.ordem), 0) + 1 into v_ordem
      from public.jobs_itens_orcado o
     where o.job_id = p_job_id
       and o.job_grupo_id = v_gid;

    insert into public.jobs_itens_orcado (
      tenant_id, job_id, item_versao_id, errata_origem_id, linha_vermelha, criada_por,
      job_grupo_id, grupo_id, ordem, item, tipo_custo,
      valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
      valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
    ) values (
      v_job.tenant_id, p_job_id, null, null, true, v_uid,
      v_gid,
      (select g.grupo_versao_id from public.jobs_grupos g where g.id = v_gid),
      v_ordem, btrim(v_l->>'item'),
      (v_l->>'tipo_custo')::public.tipo_custo,
      0, 1, 1,
      0, 0, 0
    )
    returning id into v_id;

    insert into public.jobs_itens_realizado (
      tenant_id, job_id, item_id, job_item_orcado_id,
      valor_unitario_realizado, quantidade_realizada, dias_meses_realizado,
      created_by
    ) values (
      v_job.tenant_id, p_job_id, null, v_id, 0, 0, 0, v_uid
    );

    v_ids := v_ids || jsonb_build_object(coalesce(v_l->>'chave', v_id::text), v_id);
  end loop;

  -- O agrupamento novo sem linha não nasce (decisão 162): aqui ele nunca
  -- fica vazio, porque só vem com as vermelhas dele.
  return v_ids || jsonb_build_object('grupos', v_grupos);
end;
$$;

comment on function public.adicionar_linhas_vermelhas_do_job(uuid, jsonb) is
  'Decisão 226: grava linhas vermelhas no job sem errata — e, desde 29/10/2026, o agrupamento novo só delas. Recebe a lista de linhas ou {grupos, linhas}. Devolve {chave: id, grupos: {chave: id}}.';

revoke all on function public.adicionar_linhas_vermelhas_do_job(uuid, jsonb) from public, anon;
grant execute on function public.adicionar_linhas_vermelhas_do_job(uuid, jsonb) to authenticated;
