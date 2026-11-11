-- ============================================================================
-- CATEGORIAS E SERVIÇOS NO SANDBOX
-- ============================================================================
-- O tenant california-sandbox não tinha nenhuma linha em categorias_dominio:
-- os 48 orçamentos e 21 jobs levados para lá (migration 20261109970002)
-- continuaram apontando para as categorias e serviços da produção, que o RLS
-- (is_tenant_member(tenant_id)) esconde de quem está no Sandbox. Efeito: para
-- o usuário do Sandbox o orçamento fica sem categoria, e o job Always On
-- (TES-1002/26) aparece como job comum, sem meses, com a errata na regra do
-- envio único. A migration 970002 já avisava: "Resolver sob demanda".
--
-- O que faz (autorizado pelo Tiago em 10/11/2026, para testar a errata
-- mensal no Sandbox):
--   1. copia para o Sandbox as 17 categorias/serviços da produção, com os
--      mesmos atributos (escopo, nome, modelo da planilha, serviço exclusivo,
--      interno, em breve), e o vínculo de serviço exclusivo apontando para a
--      cópia;
--   2. troca categoria_id/servico_id SÓ nas linhas do Sandbox (48 orçamentos,
--      21 jobs) da categoria da produção para a cópia.
-- A produção não muda. Gatilhos ligados; ensaiada em transação desfeita.
-- Cada contagem confere a levantada em 10/11/2026 e aborta se mudar.
-- ============================================================================

do $$
declare
  v_p    uuid;
  v_s    uuid;
  r      record;
  v_novo uuid;
  v_map  jsonb := '{}';
  v_n    int;
begin
  select id into v_p from public.tenants where slug = 'agencia-california';
  select id into v_s from public.tenants where slug = 'california-sandbox';
  if v_p is null or v_s is null then
    raise exception 'Tenants agencia-california / california-sandbox não encontrados.';
  end if;
  if (select count(*) from public.categorias_dominio where tenant_id = v_s) <> 0 then
    raise exception 'O Sandbox já tem categorias: nada foi feito.';
  end if;

  -- 1. As cópias. Os serviços sem vínculo primeiro, para o serviço exclusivo
  --    já ter a cópia quando a categoria que aponta para ele entrar.
  for r in select * from public.categorias_dominio where tenant_id = v_p
           order by (servico_exclusivo_id is not null), escopo, nome loop
    insert into public.categorias_dominio
      (tenant_id, escopo, nome, ativo, modelo_planilha, servico_exclusivo_id,
       investimento_interno, aceita_servico_interno, em_breve, created_by)
    values
      (v_s, r.escopo, r.nome, r.ativo, r.modelo_planilha,
       case when r.servico_exclusivo_id is null then null
            else (v_map->>r.servico_exclusivo_id::text)::uuid end,
       r.investimento_interno, r.aceita_servico_interno, r.em_breve, r.created_by)
    returning id into v_novo;
    v_map := v_map || jsonb_build_object(r.id::text, v_novo::text);
  end loop;
  select count(*) into v_n from jsonb_object_keys(v_map);
  if v_n <> 17 then raise exception 'categorias copiadas: % (esperado 17)', v_n; end if;

  -- 2. As linhas do Sandbox passam a apontar para as cópias.
  update public.orcamentos o
     set categoria_id = coalesce((v_map->>o.categoria_id::text)::uuid, o.categoria_id),
         servico_id   = coalesce((v_map->>o.servico_id::text)::uuid, o.servico_id)
   where o.tenant_id = v_s and (v_map ? o.categoria_id::text or v_map ? o.servico_id::text);
  get diagnostics v_n = row_count; if v_n <> 48 then raise exception 'orcamentos: % (esperado 48)', v_n; end if;

  update public.projetos x set categoria_id = (v_map->>x.categoria_id::text)::uuid
   where x.tenant_id = v_s and v_map ? x.categoria_id::text;

  update public.jobs j
     set categoria_id = coalesce((v_map->>j.categoria_id::text)::uuid, j.categoria_id),
         servico_id   = coalesce((v_map->>j.servico_id::text)::uuid, j.servico_id)
   where j.tenant_id = v_s and (v_map ? j.categoria_id::text or v_map ? j.servico_id::text);
  get diagnostics v_n = row_count; if v_n <> 21 then raise exception 'jobs: % (esperado 21)', v_n; end if;

  update public.historico_jobs h set servico_id = (v_map->>h.servico_id::text)::uuid
   where h.tenant_id = v_s and v_map ? h.servico_id::text;

  -- Nada do Sandbox aponta mais para categoria da produção.
  select count(*) into v_n from (
    select categoria_id c from public.orcamentos where tenant_id = v_s union all
    select servico_id from public.orcamentos where tenant_id = v_s union all
    select categoria_id from public.projetos where tenant_id = v_s union all
    select categoria_id from public.jobs where tenant_id = v_s union all
    select servico_id from public.jobs where tenant_id = v_s union all
    select servico_id from public.historico_jobs where tenant_id = v_s) z
   where z.c in (select id from public.categorias_dominio where tenant_id = v_p);
  if v_n <> 0 then raise exception 'ainda apontando para a produção: %', v_n; end if;

  raise notice 'Categorias copiadas para o Sandbox e linhas do Sandbox reapontadas.';
end $$;
