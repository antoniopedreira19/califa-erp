-- =====================================================================
-- Correção de dado (13/10/2026, pedida e autorizada pelo Tiago): o GP de
-- três jobs AMBEV abertos passa a ser o GP que o Tiago indicou (perfil
-- c1079379-…, papel GP, ativo).
--
--   AMB-1008/26 (orçamento AMB-P003/26-01): o GP era uma pessoa com o papel
--     Produtor, que também é a produtora do job. O GP novo já é GP
--     Responsável do projeto AMB-P003/26; o projeto não muda aqui.
--   AMB-1003/26 e AMB-1007/26 (AMB-P005/26-01 e -02): o GP era o usuário de
--     teste "GP Teste" (gp_teste@califa-erp.local) num projeto real. O
--     AMB-P005/26 só tem esses dois orçamentos, e o GP Teste era o único GP
--     Responsável dele: a troca vale também para o projeto (GP Responsável
--     e `projetos.responsavel_id`), senão o GP novo não estaria na lista de
--     GP do projeto e o editor do orçamento recusaria salvar.
--
-- Job e orçamento mudam juntos, como no envio para abertura (decisão 135):
-- o GP do job veio do orçamento. Produtor, status e valores não mudam.
--
-- Cada passo confere o valor antigo antes de escrever e para tudo se ele
-- tiver mudado. Auditoria em `audit_events` (`*.gp_corrigido`), com o
-- Tiago como autor e `origem: correcao_pelo_mcp`.
--
-- Aplicada pelo MCP buscando os perfis pelo e-mail. Aqui eles vêm pelo id,
-- com o mesmo efeito: o repositório é público e e-mail de colaborador não
-- se versiona. Já aplicada: rodar de novo para na primeira conferência,
-- sem escrever nada.
-- =====================================================================

do $$
declare
  v_tenant  uuid;
  v_gp_novo uuid;
  v_tiago   uuid;
  v_gp_teste uuid;
  v_gp_produtora uuid;
  v_p005    uuid;
  v_n       int;
  r         record;
begin
  select id into v_gp_novo  from public.profiles where id = 'c1079379-8ce2-450d-9243-f06699d9739d';
  select id into v_tiago    from public.profiles where id = '3a933b18-156d-48b3-b100-a8099292b1c2';
  select id into v_gp_teste from public.profiles where id = '17d0424a-6b26-4e2a-bb47-cf1e3597d69b'; -- GP Teste
  select o.gp_responsavel_id, o.tenant_id into v_gp_produtora, v_tenant
    from public.orcamentos o where o.codigo = 'AMB-P003/26-01';
  select id into v_p005 from public.projetos where codigo = 'AMB-P005/26';

  if v_gp_novo is null or v_tiago is null or v_gp_teste is null or v_gp_produtora is null or v_p005 is null then
    raise exception 'Correção do GP: cadastro esperado não encontrado.';
  end if;
  if not exists (
    select 1 from public.tenant_members
     where user_id = v_gp_novo and tenant_id = v_tenant
       and role = 'gerente_producao' and status = 'ativo'
  ) then
    raise exception 'Correção do GP: o GP novo não é GP ativo.';
  end if;

  -- Os três jobs e os três orçamentos, com o GP antigo de cada um.
  for r in
    select j.id as job_id, j.codigo as job, o.id as orc_id, o.codigo as orc,
           case when j.codigo = 'AMB-1008/26' then v_gp_produtora else v_gp_teste end as gp_antigo
      from public.jobs j
      join public.orcamentos o on o.id = j.orcamento_id
     where j.codigo in ('AMB-1003/26', 'AMB-1007/26', 'AMB-1008/26')
  loop
    update public.jobs set responsavel_id = v_gp_novo
     where id = r.job_id and responsavel_id = r.gp_antigo;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'Correção do GP: o GP do job % mudou desde a leitura.', r.job;
    end if;

    update public.orcamentos set gp_responsavel_id = v_gp_novo
     where id = r.orc_id and gp_responsavel_id = r.gp_antigo;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'Correção do GP: o GP do orçamento % mudou desde a leitura.', r.orc;
    end if;

    insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
    values
      (v_tenant, v_tiago, 'job.gp_corrigido', 'job', r.job_id::text,
       jsonb_build_object('job', r.job, 'gp_anterior', r.gp_antigo, 'gp_novo', v_gp_novo,
                          'origem', 'correcao_pelo_mcp', 'migration', '20261013900001')),
      (v_tenant, v_tiago, 'orcamento.gp_corrigido', 'orcamento', r.orc_id::text,
       jsonb_build_object('orcamento', r.orc, 'gp_anterior', r.gp_antigo, 'gp_novo', v_gp_novo,
                          'origem', 'correcao_pelo_mcp', 'migration', '20261013900001'));
  end loop;

  if (select count(*) from public.jobs
       where codigo in ('AMB-1003/26', 'AMB-1007/26', 'AMB-1008/26')
         and responsavel_id = v_gp_novo) <> 3 then
    raise exception 'Correção do GP: esperava 3 jobs com o GP novo.';
  end if;

  -- AMB-P005/26: o GP novo entra no lugar do GP Teste como GP Responsável.
  update public.projeto_responsaveis set profile_id = v_gp_novo
   where projeto_id = v_p005 and profile_id = v_gp_teste and papel = 'gp';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'Correção do GP: o GP Teste não é mais GP Responsável do AMB-P005/26.';
  end if;

  update public.projetos set responsavel_id = v_gp_novo
   where id = v_p005 and responsavel_id = v_gp_teste;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'Correção do GP: o responsável do AMB-P005/26 mudou desde a leitura.';
  end if;

  insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
  values (v_tenant, v_tiago, 'projeto.gp_corrigido', 'projeto', v_p005::text,
          jsonb_build_object('projeto', 'AMB-P005/26', 'gp_anterior', v_gp_teste, 'gp_novo', v_gp_novo,
                             'origem', 'correcao_pelo_mcp', 'migration', '20261013900001'));
end;
$$;
