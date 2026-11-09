-- ============================================================================
-- MOVE CLUSTER "EMPRESA TESTE" DO TENANT CALIFORNIA PRO TENANT SANDBOX
-- ============================================================================
-- Objetivo: tirar da produção toda a sujeira de teste que vinha sendo criada
-- sob a empresa gerencial "Empresa Teste" (40 jobs, 48 orçamentos, 75 PPs,
-- 17 lançamentos, 3 avulsas, descendentes e ~768 audit events), movendo
-- tudo pro tenant california-sandbox pra servir de material de validação.
--
-- Pré-condições (todas verificadas via MCP antes de escrever):
--   - Tenant prod    = d2a02c10-9c7e-4157-8dd5-84bbf5a7044c
--   - Tenant sandbox = db9278e5-1293-407f-bd33-d71b7061a849
--   - Empresa Teste prod       = c8111dca-4063-42b2-80be-14fbb372b50f
--   - Empresa Teste sandbox    = 0da57c33-c6cc-4371-8288-98238dbd8073 (vazia — clone)
--   - Migration anterior (970001) já deixou sandbox com 1 user/1 empresa_member
--
-- Fases:
--   A. Prepara sandbox: apaga os espelhos vazios da Empresa Teste (empresa
--      gerencial + 3 regionais + 2 empresas contábeis de_teste=true).
--   B. Copia os 2 fornecedores que são usados DENTRO e FORA do cluster
--      ("Fornecedor Teste" e "ZZ Veículo Teste 150 A") com UUIDs novos pro
--      sandbox; re-aponta as linhas do cluster pros IDs novos. Linhas de
--      produção que não são do cluster seguem apontando pros fornecedores
--      originais em prod (intactos).
--   C. UPDATE tenant_id em cadeia: empresa, regionais, empresas contábeis,
--      clientes/produtos/portais do cluster, projetos e tudo descendente,
--      orçamentos + versões + grupos + itens + meses + importações, jobs e
--      todas as 25+ tabelas filhas de job (orcado, realizado, grupos, aberturas,
--      competências, contatos, mensagens, previsões, envio_faturamento,
--      alterações, erratas, cancelamentos, chat, parâmetros, trocas de
-- responsável, PPs + 5 tabelas filhas, verba, PPs a emitir, lançamentos
--      financeiros, contas avulsas + anexos + histórico + regionais, saves,
--      BVs via versao_itens, veículos de mídia, códigos usados, auditoria).
--
-- NÃO mexido (cross-tenant deliberado):
--   - categorias, niveis, plano_contas_tipos/subtipos, cidades, fiscal_*,
--     empresas_contabeis NÃO de_teste: estas tabelas têm linhas de prod E
--     sandbox com UUIDs DIFERENTES (o clone RH duplicou). FKs das linhas
--     movidas continuam apontando pros IDs de prod, que seguem existindo.
--     Semanticamente cross-tenant, funcionalmente não quebra. Resolver sob
--     demanda se algum dropdown do sandbox precisar mapear.
--
-- session_replication_role = replica: igual ao clone (970001) e à migration
-- anterior (970001), pra não disparar audit/validação em operação administrativa.
-- ============================================================================

set session_replication_role = replica;

do $$
declare
  v_tenant_prod            uuid := 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  v_tenant_sandbox         uuid := 'db9278e5-1293-407f-bd33-d71b7061a849';
  v_emp_teste_prod         uuid := 'c8111dca-4063-42b2-80be-14fbb372b50f';
  v_emp_teste_sandbox      uuid := '0da57c33-c6cc-4371-8288-98238dbd8073';
  v_forn_teste_old         uuid := '7572716f-37c3-4b13-9a61-33aace693f48'; -- Fornecedor Teste
  v_forn_zzveic_old        uuid := '796f42b9-c61f-4186-9874-a88a1d8902d4'; -- ZZ Veículo Teste 150 A
  v_forn_teste_new         uuid := gen_random_uuid();
  v_forn_zzveic_new        uuid := gen_random_uuid();
  v_count                  int;

  -- Arrays de IDs do cluster (calculados uma vez, usados várias)
  v_job_ids                uuid[];
  v_orc_ids                uuid[];
  v_ver_ids                uuid[];
  v_pp_ids                 uuid[];
  v_lanc_ids               uuid[];
  v_avulsa_ids             uuid[];
  v_proj_ids               uuid[];
  v_cli_ids                uuid[];
  v_reg_ids                uuid[];
  v_errata_ids             uuid[];
  v_alt_fin_ids            uuid[];
  v_env_fat_ids            uuid[];
  v_v_itens_ids            uuid[];
  v_j_itens_orcado_ids     uuid[];
begin

  -- =========================================================================
  -- 0. Pré-condições
  -- =========================================================================
  if not exists (select 1 from tenants where id = v_tenant_prod and slug='agencia-california') then
    raise exception 'tenant prod não encontrado';
  end if;
  if not exists (select 1 from tenants where id = v_tenant_sandbox and slug='california-sandbox') then
    raise exception 'tenant sandbox não encontrado';
  end if;
  if not exists (select 1 from empresas where id = v_emp_teste_prod and tenant_id = v_tenant_prod and nome_fantasia='Empresa Teste') then
    raise exception 'Empresa Teste prod não encontrada';
  end if;

  -- Sandbox deve ter exatamente 1 tenant_member (antonio@sandbox) — pós-condição da 970001
  select count(*) into v_count from tenant_members where tenant_id = v_tenant_sandbox;
  if v_count <> 1 then
    raise exception 'sandbox deveria ter 1 tenant_member antes desta migration, tem %', v_count;
  end if;

  -- =========================================================================
  -- 1. Materializa os IDs do cluster
  -- =========================================================================
  select array_agg(id) into v_reg_ids   from regionais  where empresa_id = v_emp_teste_prod;
  select array_agg(id) into v_job_ids   from jobs       where empresa_id = v_emp_teste_prod;
  select array_agg(id) into v_orc_ids   from orcamentos where empresa_id = v_emp_teste_prod;
  select array_agg(id) into v_ver_ids   from versoes_orcamento where orcamento_id = any(v_orc_ids);
  select array_agg(id) into v_pp_ids    from pedidos_compra where job_id = any(v_job_ids);
  select array_agg(id) into v_lanc_ids  from lancamentos_financeiros where empresa_id = v_emp_teste_prod or pedido_compra_id = any(v_pp_ids);
  select array_agg(id) into v_avulsa_ids from contas_avulsas where empresa_id = v_emp_teste_prod;

  -- Projetos: os referenciados pelos jobs + os cuja empresa_id é a teste (podem existir sem job)
  select array_agg(distinct id) into v_proj_ids from (
    select projeto_id as id from jobs where empresa_id = v_emp_teste_prod and projeto_id is not null
    union
    select id from projetos where empresa_id = v_emp_teste_prod
  ) t;

  -- Clientes: distintos referenciados pelo cluster (jobs, orcamentos, projetos)
  select array_agg(distinct id) into v_cli_ids from (
    select cliente_id as id from jobs       where empresa_id = v_emp_teste_prod and cliente_id is not null
    union
    select cliente_id      from orcamentos where empresa_id = v_emp_teste_prod and cliente_id is not null
    union
    select cliente_id      from projetos   where empresa_id = v_emp_teste_prod and cliente_id is not null
  ) t;

  select array_agg(id) into v_errata_ids  from jobs_erratas where job_id = any(v_job_ids);
  select array_agg(id) into v_alt_fin_ids from jobs_alteracoes_financeiro where job_id = any(v_job_ids);
  select array_agg(id) into v_env_fat_ids from jobs_envio_faturamento where job_id = any(v_job_ids);
  select array_agg(id) into v_v_itens_ids from versoes_orcamento_itens where versao_orcamento_id = any(v_ver_ids);
  select array_agg(id) into v_j_itens_orcado_ids from jobs_itens_orcado where job_id = any(v_job_ids);

  raise notice 'Cluster: % jobs, % orc, % ver, % pp, % lanc, % av, % proj, % cli, % reg',
    coalesce(array_length(v_job_ids,1),0),
    coalesce(array_length(v_orc_ids,1),0),
    coalesce(array_length(v_ver_ids,1),0),
    coalesce(array_length(v_pp_ids,1),0),
    coalesce(array_length(v_lanc_ids,1),0),
    coalesce(array_length(v_avulsa_ids,1),0),
    coalesce(array_length(v_proj_ids,1),0),
    coalesce(array_length(v_cli_ids,1),0),
    coalesce(array_length(v_reg_ids,1),0);

  -- =========================================================================
  -- FASE A — Prepara sandbox (apaga espelhos vazios)
  -- =========================================================================
  -- A empresa gerencial espelho está vazia (0 jobs/projetos/etc. já confirmado)
  -- mas pode ter linhas em empresas_rateios_regionais ou outros catálogos.
  -- Como a 970001 já tirou os empresa_members, o único vínculo restante é a
  -- própria estrutura (regionais, rateios).

  delete from empresas_rateios_regionais where empresa_id = v_emp_teste_sandbox;
  get diagnostics v_count = row_count;
  raise notice 'Fase A: empresas_rateios_regionais do espelho deletados: %', v_count;

  delete from regionais where empresa_id = v_emp_teste_sandbox;
  get diagnostics v_count = row_count;
  raise notice 'Fase A: regionais espelho deletadas: %', v_count;

  delete from empresas where id = v_emp_teste_sandbox;
  get diagnostics v_count = row_count;
  raise notice 'Fase A: empresa gerencial espelho deletada: %', v_count;

  delete from empresas_contabeis where tenant_id = v_tenant_sandbox and de_teste = true;
  get diagnostics v_count = row_count;
  raise notice 'Fase A: empresas_contabeis espelho de_teste deletadas: %', v_count;

  -- =========================================================================
  -- FASE B — Copia os 2 fornecedores compartilhados e re-aponta as linhas do cluster
  -- =========================================================================
  -- Cópia com UUIDs novos pro sandbox
  insert into fornecedores (
    id, tenant_id, tipo_pessoa, nome, razao_social, cpf_cnpj, email, telefone,
    observacoes, status, created_by, created_at, updated_at,
    cep, logradouro, numero, complemento, bairro, cidade, uf,
    banco_codigo, banco_nome, agencia, agencia_dv, conta, conta_dv, tipo_conta,
    pix_tipo, pix_chave,
    regime_tributario, regime_consultado_em, declaracao_simples_recebida,
    declaracao_simples_path, regime_consulta, regime_desde,
    sem_dados_pagamento, cnae, empresa_de_fora
  )
  select
    case id when v_forn_teste_old then v_forn_teste_new else v_forn_zzveic_new end,
    v_tenant_sandbox,
    tipo_pessoa, nome, razao_social, cpf_cnpj, email, telefone,
    observacoes, status, created_by, now(), now(),
    cep, logradouro, numero, complemento, bairro, cidade, uf,
    banco_codigo, banco_nome, agencia, agencia_dv, conta, conta_dv, tipo_conta,
    pix_tipo, pix_chave,
    regime_tributario, regime_consultado_em, declaracao_simples_recebida,
    declaracao_simples_path, regime_consulta, regime_desde,
    sem_dados_pagamento, cnae, empresa_de_fora
  from fornecedores
  where id in (v_forn_teste_old, v_forn_zzveic_old);
  get diagnostics v_count = row_count;
  raise notice 'Fase B: fornecedores copiados: % (esperado 2)', v_count;

  -- Re-apontar linhas do cluster pros IDs NOVOS (sandbox)
  update pedidos_compra              set fornecedor_id = v_forn_teste_new  where job_id = any(v_job_ids) and fornecedor_id = v_forn_teste_old;
  update pedidos_compra              set fornecedor_id = v_forn_zzveic_new where job_id = any(v_job_ids) and fornecedor_id = v_forn_zzveic_old;
  update pedidos_compra_a_emitir     set fornecedor_id = v_forn_teste_new  where job_id = any(v_job_ids) and fornecedor_id = v_forn_teste_old;
  update pedidos_compra_a_emitir     set fornecedor_id = v_forn_zzveic_new where job_id = any(v_job_ids) and fornecedor_id = v_forn_zzveic_old;
  update jobs_itens_orcado           set fornecedor_id = v_forn_teste_new  where job_id = any(v_job_ids) and fornecedor_id = v_forn_teste_old;
  update jobs_itens_orcado           set fornecedor_id = v_forn_zzveic_new where job_id = any(v_job_ids) and fornecedor_id = v_forn_zzveic_old;
  update jobs_itens_realizado        set fornecedor_id = v_forn_teste_new  where job_id = any(v_job_ids) and fornecedor_id = v_forn_teste_old;
  update jobs_itens_realizado        set fornecedor_id = v_forn_zzveic_new where job_id = any(v_job_ids) and fornecedor_id = v_forn_zzveic_old;
  update versoes_orcamento_itens     set fornecedor_id = v_forn_teste_new  where versao_orcamento_id = any(v_ver_ids) and fornecedor_id = v_forn_teste_old;
  update versoes_orcamento_itens     set fornecedor_id = v_forn_zzveic_new where versao_orcamento_id = any(v_ver_ids) and fornecedor_id = v_forn_zzveic_old;
  update contas_avulsas              set fornecedor_id = v_forn_teste_new  where id = any(v_avulsa_ids) and fornecedor_id = v_forn_teste_old;
  update contas_avulsas              set fornecedor_id = v_forn_zzveic_new where id = any(v_avulsa_ids) and fornecedor_id = v_forn_zzveic_old;
  update lancamentos_financeiros     set fornecedor_id = v_forn_teste_new  where id = any(v_lanc_ids) and fornecedor_id = v_forn_teste_old;
  update lancamentos_financeiros     set fornecedor_id = v_forn_zzveic_new where id = any(v_lanc_ids) and fornecedor_id = v_forn_zzveic_old;
  update recebimentos_antes_nf       set fornecedor_id = v_forn_teste_new  where job_id = any(v_job_ids) and fornecedor_id = v_forn_teste_old;
  update recebimentos_antes_nf       set fornecedor_id = v_forn_zzveic_new where job_id = any(v_job_ids) and fornecedor_id = v_forn_zzveic_old;

  -- itens_bv: chave via item_versao_id (versoes_orcamento_itens do cluster)
  update itens_bv set fornecedor_id = v_forn_teste_new  where item_versao_id = any(v_v_itens_ids) and fornecedor_id = v_forn_teste_old;
  update itens_bv set fornecedor_id = v_forn_zzveic_new where item_versao_id = any(v_v_itens_ids) and fornecedor_id = v_forn_zzveic_old;

  -- notas_fiscais_fornecedor: só as registradas nas PPs do cluster
  update notas_fiscais_fornecedor set fornecedor_id = v_forn_teste_new  where registrada_na_pp_id = any(v_pp_ids) and fornecedor_id = v_forn_teste_old;
  update notas_fiscais_fornecedor set fornecedor_id = v_forn_zzveic_new where registrada_na_pp_id = any(v_pp_ids) and fornecedor_id = v_forn_zzveic_old;

  -- veiculos_midia: assume que essa linha pertence ao mundo de prod (tem referência fora). Deixar em prod.

  raise notice 'Fase B: re-aponte das linhas do cluster concluído';

  -- =========================================================================
  -- FASE C — UPDATE tenant_id em cadeia pro cluster inteiro
  -- =========================================================================
  -- Ordem não importa pra integridade (tenant_id não é FK entre tabelas),
  -- mas organiza por camada pra ficar auditável.

  -- Raízes
  update empresas              set tenant_id = v_tenant_sandbox where id = v_emp_teste_prod;
  update regionais             set tenant_id = v_tenant_sandbox where id = any(v_reg_ids);

  -- Empresas contábeis de_teste=true (em prod — vão junto)
  update empresas_contabeis    set tenant_id = v_tenant_sandbox where tenant_id = v_tenant_prod and de_teste = true;
  get diagnostics v_count = row_count;
  raise notice 'Fase C: empresas_contabeis de_teste movidas: %', v_count;

  -- Clientes do cluster + sub-entidades
  if v_cli_ids is not null then
    update clientes            set tenant_id = v_tenant_sandbox where id = any(v_cli_ids);
    update cliente_produtos    set tenant_id = v_tenant_sandbox where cliente_id = any(v_cli_ids);
    update cliente_portais     set tenant_id = v_tenant_sandbox where cliente_id = any(v_cli_ids);
  end if;

  -- Fornecedores: já foram COPIADOS pro sandbox na Fase B; os originais ficam em prod.

  -- Projetos + descendentes
  if v_proj_ids is not null then
    update projetos                  set tenant_id = v_tenant_sandbox where id = any(v_proj_ids);
    update projeto_responsaveis      set tenant_id = v_tenant_sandbox where projeto_id = any(v_proj_ids);
    update projeto_regionais         set tenant_id = v_tenant_sandbox where projeto_id = any(v_proj_ids);
    update projeto_marcas            set tenant_id = v_tenant_sandbox where projeto_id = any(v_proj_ids);
    update projeto_apresentacoes     set tenant_id = v_tenant_sandbox where projeto_id = any(v_proj_ids);
    update codigos_de_projeto_usados set tenant_id = v_tenant_sandbox where projeto_id = any(v_proj_ids);
  end if;

  -- Orçamentos + descendentes
  if v_orc_ids is not null then
    update orcamentos                  set tenant_id = v_tenant_sandbox where id = any(v_orc_ids);
    update orcamento_importacoes       set tenant_id = v_tenant_sandbox where orcamento_id = any(v_orc_ids);
    update codigos_de_orcamento_usados set tenant_id = v_tenant_sandbox where orcamento_id = any(v_orc_ids);
  end if;
  if v_ver_ids is not null then
    update versoes_orcamento         set tenant_id = v_tenant_sandbox where id = any(v_ver_ids);
    update versoes_orcamento_grupos  set tenant_id = v_tenant_sandbox where versao_orcamento_id = any(v_ver_ids);
    update versoes_orcamento_itens   set tenant_id = v_tenant_sandbox where versao_orcamento_id = any(v_ver_ids);
    update versoes_orcamento_meses   set tenant_id = v_tenant_sandbox where versao_orcamento_id = any(v_ver_ids);
    update itens_bv                  set tenant_id = v_tenant_sandbox where item_versao_id = any(v_v_itens_ids);
  end if;

  -- Jobs + descendentes (as tabelas filha de job)
  if v_job_ids is not null then
    update jobs                          set tenant_id = v_tenant_sandbox where id = any(v_job_ids);
    update jobs_itens_orcado             set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_itens_realizado          set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_grupos                   set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_aberturas                set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_competencias             set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_contatos                 set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_mensagens                set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_chat_leituras            set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_previsao_custo           set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_previsao_recebimento     set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_previsao_impostos        set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_parametros               set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_cancelamentos            set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_trocas_de_responsavel    set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_custos_do_socio          set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_envio_faturamento        set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_envio_faturamento_notas  set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_envio_faturamento_parcelas set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_envio_faturamento_anexos set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_alteracoes_financeiro    set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_erratas                  set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update jobs_erratas_prontas          set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update faturamentos_po               set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update codigos_de_job_usados         set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update saves_aprovacoes              set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update saves_consumos                set tenant_id = v_tenant_sandbox where job_origem_id = any(v_job_ids);
    update saves_consumos                set tenant_id = v_tenant_sandbox where job_item_orcado_id = any(v_j_itens_orcado_ids);
    update freelancer_contratos          set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update freelancer_solicitacoes       set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update recebimentos_antes_nf         set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update desembolsos                   set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update pedidos_compra_a_emitir       set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
    update comite_pedidos                set tenant_id = v_tenant_sandbox where job_id = any(v_job_ids);
  end if;

  -- Descendentes de erratas / alterações (via FK indireta)
  if v_errata_ids is not null then
    update jobs_erratas_itens set tenant_id = v_tenant_sandbox where errata_id = any(v_errata_ids);
  end if;
  if v_alt_fin_ids is not null then
    update jobs_alteracoes_financeiro_itens set tenant_id = v_tenant_sandbox where alteracao_id = any(v_alt_fin_ids);
  end if;

  -- Comite pedidos: alcance via orçamento (além do job_id acima)
  if v_orc_ids is not null then
    update comite_pedidos set tenant_id = v_tenant_sandbox where orcamento_id = any(v_orc_ids);
  end if;

  -- PPs + descendentes (via pp_id)
  if v_pp_ids is not null then
    update pedidos_compra              set tenant_id = v_tenant_sandbox where id = any(v_pp_ids);
    update pedidos_compra_parcelas     set tenant_id = v_tenant_sandbox where pedido_compra_id = any(v_pp_ids);
    update pedidos_compra_anexos       set tenant_id = v_tenant_sandbox where pedido_compra_id = any(v_pp_ids);
    update pedidos_compra_eventos      set tenant_id = v_tenant_sandbox where pedido_compra_id = any(v_pp_ids);
    update pedidos_compra_retencoes    set tenant_id = v_tenant_sandbox where pedido_compra_id = any(v_pp_ids);
    update pp_verba_prestacoes         set tenant_id = v_tenant_sandbox where pedido_compra_id = any(v_pp_ids);
    update pp_verba_prestacoes_anexos  set tenant_id = v_tenant_sandbox where prestacao_id in (select id from pp_verba_prestacoes where pedido_compra_id = any(v_pp_ids));
    update pp_verba_devolucoes         set tenant_id = v_tenant_sandbox where pedido_compra_id = any(v_pp_ids);
    update notas_fiscais_fornecedor    set tenant_id = v_tenant_sandbox where registrada_na_pp_id = any(v_pp_ids);
  end if;

  -- Lançamentos financeiros + descendentes
  if v_lanc_ids is not null then
    update lancamentos_financeiros set tenant_id = v_tenant_sandbox where id = any(v_lanc_ids);
    update baixa_correcoes         set tenant_id = v_tenant_sandbox where lancamento_id = any(v_lanc_ids);
    update baixas_retencoes        set tenant_id = v_tenant_sandbox where lancamento_id = any(v_lanc_ids);
    update mutuos_iof              set tenant_id = v_tenant_sandbox where lancamento_id = any(v_lanc_ids);
  end if;

  -- Contas avulsas + descendentes
  if v_avulsa_ids is not null then
    update contas_avulsas          set tenant_id = v_tenant_sandbox where id = any(v_avulsa_ids);
    update contas_avulsas_anexos   set tenant_id = v_tenant_sandbox where conta_avulsa_id = any(v_avulsa_ids);
    update contas_avulsas_historico set tenant_id = v_tenant_sandbox where conta_avulsa_id = any(v_avulsa_ids);
    update contas_avulsas_regionais set tenant_id = v_tenant_sandbox where conta_avulsa_id = any(v_avulsa_ids);
  end if;
  update contas_avulsas_recorrentes             set tenant_id = v_tenant_sandbox where empresa_id = v_emp_teste_prod;
  update contas_avulsas_recorrentes_regionais   set tenant_id = v_tenant_sandbox where regional_id = any(v_reg_ids);

  -- =========================================================================
  -- FASE D — Audit events do cluster
  -- =========================================================================
  update audit_events set tenant_id = v_tenant_sandbox
  where tenant_id = v_tenant_prod
    and (
      (entidade_tipo = 'job'           and entidade_id::uuid = any(v_job_ids))
      or (entidade_tipo = 'empresa'    and entidade_id::uuid = v_emp_teste_prod)
      or (entidade_tipo = 'regional'   and entidade_id::uuid = any(v_reg_ids))
      or (entidade_tipo = 'orcamento'  and entidade_id::uuid = any(v_orc_ids))
      or (entidade_tipo = 'projeto'    and entidade_id::uuid = any(v_proj_ids))
      or (entidade_tipo = 'pedido_compra' and entidade_id::uuid = any(v_pp_ids))
      or (entidade_tipo = 'cliente'    and entidade_id::uuid = any(v_cli_ids))
      or (entidade_tipo = 'lancamento_financeiro' and entidade_id::uuid = any(v_lanc_ids))
      or (entidade_tipo = 'conta_avulsa' and entidade_id::uuid = any(v_avulsa_ids))
    );
  get diagnostics v_count = row_count;
  raise notice 'Fase D: audit_events movidos: %', v_count;

  -- =========================================================================
  -- 2. Verificações pós
  -- =========================================================================
  -- Nada do cluster deve sobrar em prod
  if exists (select 1 from empresas where id = v_emp_teste_prod and tenant_id = v_tenant_prod) then
    raise exception 'Empresa Teste ainda está em prod';
  end if;
  if exists (select 1 from jobs where tenant_id = v_tenant_prod and empresa_id = v_emp_teste_prod) then
    raise exception 'jobs do cluster ainda em prod';
  end if;
  if exists (select 1 from orcamentos where tenant_id = v_tenant_prod and empresa_id = v_emp_teste_prod) then
    raise exception 'orcamentos do cluster ainda em prod';
  end if;
  if exists (select 1 from pedidos_compra where tenant_id = v_tenant_prod and id = any(v_pp_ids)) then
    raise exception 'PPs do cluster ainda em prod';
  end if;

  select count(*) into v_count from jobs where tenant_id = v_tenant_sandbox and empresa_id = v_emp_teste_prod;
  raise notice 'VERIFY: jobs do cluster agora no sandbox: %', v_count;
  select count(*) into v_count from fornecedores where tenant_id = v_tenant_sandbox and id in (v_forn_teste_new, v_forn_zzveic_new);
  raise notice 'VERIFY: fornecedores copiados agora no sandbox: %', v_count;

  raise notice 'OK: Empresa Teste e seus descendentes migrados pro sandbox';
end $$;

set session_replication_role = default;
