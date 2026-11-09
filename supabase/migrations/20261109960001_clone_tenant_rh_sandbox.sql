-- ============================================================================
-- CLONE DO TENANT CALIFORNIA PRO TENANT CALIFORNIA SANDBOX (RH + referenciais)
-- ============================================================================
-- Objetivo: criar um tenant "California Sandbox" com cópia 100% real do dominio
-- RH da California (colaboradores, alocacoes, salarios, ferias, beneficios,
-- dependentes, folha, 13o, freelancers, contratacoes) + referenciais necessarios
-- (empresas, empresas_contabeis, regionais, niveis, plano_contas, parametros).
--
-- Permite validar o modulo de RH com volume e dados reais sem tocar o California.
--
-- Estrategia:
--   1. Cria tenant Sandbox novo.
--   2. Monta uma tabela temporaria tmp_id_map (entidade, old_id, new_id) com
--      UUIDs novos pra cada linha a clonar, pra todas as tabelas de uma vez.
--   3. INSERTs em ordem de dependencia, resolvendo FKs via subquery no map.
--   4. UPDATEs pos-insert pra fechar auto-referencias (colaboradores.lider_id,
--      beneficios.beneficio_base_id) e FKs ciclicas (folha_pagamento <->
--      decimo_terceiro_linhas e ferias_lancamentos).
--
-- Tratamentos especiais (UNIQUE globais / FKs que saem do escopo clonado):
--   - colaboradores.user_id              -> NULL  (UNIQUE global; evita duplicar auth user)
--   - freelancers.legado_id              -> NULL  (UNIQUE global)
--   - freelancer_contratos.legado_id     -> NULL  (UNIQUE global)
--   - freelancer_solicitacoes.legado_id  -> NULL  (UNIQUE global)
--   - freelancer_contratos.job_id        -> NULL  (jobs nao estao no clone)
--   - freelancer_solicitacoes.job_id     -> NULL
--   - freelancer_solicitacoes.token      -> gen_random_uuid()::text  (UNIQUE global)
--   - contratacoes.token                 -> gen_random_uuid()::text  (UNIQUE global)
--   - colaboradores_ferias_lancamentos.conta_avulsa_id -> NULL (contas_avulsas fora do escopo)
--   - decimo_terceiro_adiantamentos.conta_avulsa_id    -> NULL (idem)
--   - freelancer_contratos.origem_sistema -> 'ag_california_rh' quando o clonado
--       ficaria sem job_id e sem job_interno_id, pra satisfazer o CHECK
--       freelancer_contratos_job_obrigatorio_em_novos. Semanticamente faz
--       sentido: no sandbox nao ha jobs, entao viram "legados" por definicao.
--
-- O que NAO e clonado (ja existe hoje, decisao consciente):
--   - profiles  (global por auth user, nao tem tenant_id)
--   - auth.users, clientes, fornecedores, jobs, orcamentos, financeiro inteiro
--   - audit_events (sandbox se preenche ao usar)
-- ============================================================================

-- IMPORTANTE: session_replication_role = replica desabilita TODAS as triggers
-- (incluindo audit, validacoes de dominio e geracao automatica de linhas). Isso
-- e necessario porque:
--   1. Varias triggers de validacao (ex: trg_colaboradores_salarios_valor_recibo)
--      rejeitam linhas de historico recopiadas como se fossem novas.
--   2. Outras triggers (ex: auto-gerar colaboradores_ferias_periodos) criariam
--      duplicatas das linhas que estamos clonando.
--   3. Audit events do clone poluiria o historico — o sandbox e uma copia
--      estrutural, nao uma sequencia de eventos reais do usuario.
-- A ordem de insercao abaixo respeita manualmente todas as FKs.

set session_replication_role = replica;

do $$
declare
  v_california uuid;
  v_sandbox    uuid := gen_random_uuid();
  v_count      int;
begin

  select id into v_california from tenants where nome = 'Agência California';
  if v_california is null then
    raise exception 'Tenant Agência California nao encontrado';
  end if;

  -- =========================================================================
  -- 0. Cria tenant Sandbox
  -- =========================================================================

  insert into tenants (id, nome, slug, status, created_at, updated_at)
  select v_sandbox, 'California Sandbox', 'california-sandbox', status, now(), now()
  from tenants where id = v_california;

  raise notice 'Tenant Sandbox criado: %', v_sandbox;

  -- =========================================================================
  -- 1. Monta tmp_id_map (new UUIDs pra todas as linhas a clonar)
  -- =========================================================================

  create temp table tmp_id_map (
    entidade text not null,
    old_id   uuid not null,
    new_id   uuid not null default gen_random_uuid(),
    primary key (entidade, old_id)
  ) on commit drop;

  create index on tmp_id_map (entidade);

  insert into tmp_id_map (entidade, old_id)
    select 'empresas', id from empresas where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'empresas_contabeis', id from empresas_contabeis where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'regionais', id from regionais where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'niveis', id from niveis where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'empresa_members', id from empresa_members where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'empresas_rateios_regionais', id from empresas_rateios_regionais where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'financeiro_parametros', id from financeiro_parametros where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'plano_contas_tipos', id from plano_contas_tipos where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'plano_contas_subtipos', id from plano_contas_subtipos where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'beneficios', id from beneficios where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'beneficio_faixas_preco', bfp.id
    from beneficio_faixas_preco bfp
    join beneficios b on b.id = bfp.beneficio_id where b.tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'colaboradores', id from colaboradores where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'dependentes', id from dependentes where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'colaborador_beneficio', id from colaborador_beneficio where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'colaborador_beneficio_dependente', cbd.id
    from colaborador_beneficio_dependente cbd
    join colaborador_beneficio cb on cb.id = cbd.colaborador_beneficio_id
    where cb.tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'beneficio_fechamento_mensal', id from beneficio_fechamento_mensal where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'beneficio_fechamento_linha', id from beneficio_fechamento_linha where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'colaboradores_salarios', id from colaboradores_salarios where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'colaboradores_alocacoes', id from colaboradores_alocacoes where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'colaboradores_alocacoes_itens', id from colaboradores_alocacoes_itens where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'colaboradores_alocacoes_itens_regionais', id from colaboradores_alocacoes_itens_regionais where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'colaboradores_ferias_periodos', id from colaboradores_ferias_periodos where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'colaboradores_ferias_lancamentos', id from colaboradores_ferias_lancamentos where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'colaboradores_nf_anexos', id from colaboradores_nf_anexos where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'folhas_pagamento', id from folhas_pagamento where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'folhas_pagamento_alocacoes', id from folhas_pagamento_alocacoes where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'folha_importacoes', id from folha_importacoes where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'decimo_terceiro_folhas', id from decimo_terceiro_folhas where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'decimo_terceiro_linhas', id from decimo_terceiro_linhas where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'decimo_terceiro_adiantamentos', id from decimo_terceiro_adiantamentos where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'contratacoes', id from contratacoes where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'freelancers', id from freelancers where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'freelancer_cargos', id from freelancer_cargos where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'freelancer_jobs_internos', id from freelancer_jobs_internos where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'freelancer_contratos', id from freelancer_contratos where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'freelancer_contrato_historico', id from freelancer_contrato_historico where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'freelancer_solicitacoes', id from freelancer_solicitacoes where tenant_id = v_california;
  insert into tmp_id_map (entidade, old_id)
    select 'freelancer_solicitacao_mensagens', fsm.id
    from freelancer_solicitacao_mensagens fsm
    join freelancer_solicitacoes fs on fs.id = fsm.solicitacao_id
    where fs.tenant_id = v_california;

  -- =========================================================================
  -- 2. INSERTs em ordem de dependencia
  -- =========================================================================

  -- 2.1 tenant_members: mesmos user_ids, novo tenant_id
  insert into tenant_members (id, tenant_id, user_id, role, status, created_at, updated_at)
  select gen_random_uuid(), v_sandbox, user_id, role, status, now(), now()
  from tenant_members where tenant_id = v_california;

  -- 2.2 empresas
  insert into empresas (
    id, tenant_id, razao_social, nome_fantasia, cnpj, inscricao_estadual,
    inscricao_municipal, logradouro, numero, complemento, bairro, cidade, uf,
    cep, telefone, email, local_pagamento, instrucoes_nf, principal, ativo,
    created_by, created_at, updated_at
  )
  select
    m.new_id, v_sandbox, e.razao_social, e.nome_fantasia, e.cnpj,
    e.inscricao_estadual, e.inscricao_municipal, e.logradouro, e.numero,
    e.complemento, e.bairro, e.cidade, e.uf, e.cep, e.telefone, e.email,
    e.local_pagamento, e.instrucoes_nf, e.principal, e.ativo, e.created_by,
    e.created_at, e.updated_at
  from empresas e
  join tmp_id_map m on m.entidade = 'empresas' and m.old_id = e.id
  where e.tenant_id = v_california;

  -- 2.3 regionais (depende de empresas)
  insert into regionais (
    id, tenant_id, nome, ativo, created_by, created_at, updated_at,
    empresa_id, disponivel_em_projetos
  )
  select
    m.new_id, v_sandbox, r.nome, r.ativo, r.created_by, r.created_at,
    r.updated_at,
    (select new_id from tmp_id_map where entidade = 'empresas' and old_id = r.empresa_id),
    r.disponivel_em_projetos
  from regionais r
  join tmp_id_map m on m.entidade = 'regionais' and m.old_id = r.id
  where r.tenant_id = v_california;

  -- 2.4 empresas_contabeis (depende de empresas + regionais)
  insert into empresas_contabeis (
    id, tenant_id, razao_social, nome_fantasia, cnpj, ativo, created_at,
    updated_at, created_by, endereco_logradouro, endereco_cidade, endereco_cep,
    endereco_uf, de_teste, empresa_gerencial_id, regional_padrao_id,
    iof_do_mutuo_abaixo_do_lucro
  )
  select
    m.new_id, v_sandbox, ec.razao_social, ec.nome_fantasia, ec.cnpj, ec.ativo,
    ec.created_at, ec.updated_at, ec.created_by, ec.endereco_logradouro,
    ec.endereco_cidade, ec.endereco_cep, ec.endereco_uf, ec.de_teste,
    (select new_id from tmp_id_map where entidade = 'empresas' and old_id = ec.empresa_gerencial_id),
    (select new_id from tmp_id_map where entidade = 'regionais' and old_id = ec.regional_padrao_id),
    ec.iof_do_mutuo_abaixo_do_lucro
  from empresas_contabeis ec
  join tmp_id_map m on m.entidade = 'empresas_contabeis' and m.old_id = ec.id
  where ec.tenant_id = v_california;

  -- 2.5 niveis
  insert into niveis (id, tenant_id, codigo, descricao, ordem, ativo, created_by, created_at, updated_at)
  select m.new_id, v_sandbox, n.codigo, n.descricao, n.ordem, n.ativo, n.created_by, n.created_at, n.updated_at
  from niveis n
  join tmp_id_map m on m.entidade = 'niveis' and m.old_id = n.id
  where n.tenant_id = v_california;

  -- 2.6 empresa_members (depende de empresas + regionais, mesmos users)
  insert into empresa_members (id, tenant_id, user_id, empresa_id, regional_id, status, created_by, created_at, updated_at)
  select
    m.new_id, v_sandbox, em.user_id,
    (select new_id from tmp_id_map where entidade = 'empresas' and old_id = em.empresa_id),
    (select new_id from tmp_id_map where entidade = 'regionais' and old_id = em.regional_id),
    em.status, em.created_by, em.created_at, em.updated_at
  from empresa_members em
  join tmp_id_map m on m.entidade = 'empresa_members' and m.old_id = em.id
  where em.tenant_id = v_california;

  -- 2.7 empresas_rateios_regionais
  insert into empresas_rateios_regionais (id, tenant_id, empresa_id, ano_vigencia, regional_id, percentual, created_at, updated_at, created_by)
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'empresas' and old_id = err.empresa_id),
    err.ano_vigencia,
    (select new_id from tmp_id_map where entidade = 'regionais' and old_id = err.regional_id),
    err.percentual, err.created_at, err.updated_at, err.created_by
  from empresas_rateios_regionais err
  join tmp_id_map m on m.entidade = 'empresas_rateios_regionais' and m.old_id = err.id
  where err.tenant_id = v_california;

  -- 2.8 financeiro_parametros
  insert into financeiro_parametros (id, tenant_id, chave, valor, atualizado_por, atualizado_em, created_at)
  select m.new_id, v_sandbox, fp.chave, fp.valor, fp.atualizado_por, fp.atualizado_em, fp.created_at
  from financeiro_parametros fp
  join tmp_id_map m on m.entidade = 'financeiro_parametros' and m.old_id = fp.id
  where fp.tenant_id = v_california;

  -- 2.9 plano_contas_tipos
  insert into plano_contas_tipos (id, tenant_id, codigo, nome, natureza_padrao, ativo, created_at, updated_at, created_by)
  select m.new_id, v_sandbox, pct.codigo, pct.nome, pct.natureza_padrao, pct.ativo, pct.created_at, pct.updated_at, pct.created_by
  from plano_contas_tipos pct
  join tmp_id_map m on m.entidade = 'plano_contas_tipos' and m.old_id = pct.id
  where pct.tenant_id = v_california;

  -- 2.10 plano_contas_subtipos
  insert into plano_contas_subtipos (id, tenant_id, tipo_id, nome, ativo, created_at, updated_at, created_by, codigo)
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'plano_contas_tipos' and old_id = pcs.tipo_id),
    pcs.nome, pcs.ativo, pcs.created_at, pcs.updated_at, pcs.created_by, pcs.codigo
  from plano_contas_subtipos pcs
  join tmp_id_map m on m.entidade = 'plano_contas_subtipos' and m.old_id = pcs.id
  where pcs.tenant_id = v_california;

  -- 2.11 beneficios (beneficio_base_id auto-ref NULL agora; UPDATE depois)
  insert into beneficios (
    id, tenant_id, nome, operadora, tipo, modelo_preco, percentual_empresa_titular,
    percentual_colaborador_dependentes, valor_flat, beneficio_base_id, codigo_externo,
    ativo, observacao, created_at, updated_at, dia_vencimento_fatura,
    vencimento_mes_seguinte, fornecedor_id, empresa_id, regional_id
  )
  select
    m.new_id, v_sandbox, b.nome, b.operadora, b.tipo, b.modelo_preco,
    b.percentual_empresa_titular, b.percentual_colaborador_dependentes, b.valor_flat,
    null,  -- beneficio_base_id: 2a passada
    b.codigo_externo, b.ativo, b.observacao, b.created_at, b.updated_at,
    b.dia_vencimento_fatura, b.vencimento_mes_seguinte,
    b.fornecedor_id,  -- fornecedor fica apontando pro California (fora do escopo clonado)
    (select new_id from tmp_id_map where entidade = 'empresas' and old_id = b.empresa_id),
    (select new_id from tmp_id_map where entidade = 'regionais' and old_id = b.regional_id)
  from beneficios b
  join tmp_id_map m on m.entidade = 'beneficios' and m.old_id = b.id
  where b.tenant_id = v_california;

  -- 2.12 beneficio_faixas_preco
  insert into beneficio_faixas_preco (id, beneficio_id, idade_min, idade_max, valor, created_at, updated_at)
  select
    m.new_id,
    (select new_id from tmp_id_map where entidade = 'beneficios' and old_id = bfp.beneficio_id),
    bfp.idade_min, bfp.idade_max, bfp.valor, bfp.created_at, bfp.updated_at
  from beneficio_faixas_preco bfp
  join tmp_id_map m on m.entidade = 'beneficio_faixas_preco' and m.old_id = bfp.id;

  -- 2.13 freelancer_cargos
  insert into freelancer_cargos (id, tenant_id, nome, ativo, created_at, created_by)
  select m.new_id, v_sandbox, fc.nome, fc.ativo, fc.created_at, fc.created_by
  from freelancer_cargos fc
  join tmp_id_map m on m.entidade = 'freelancer_cargos' and m.old_id = fc.id
  where fc.tenant_id = v_california;

  -- 2.14 freelancer_jobs_internos
  insert into freelancer_jobs_internos (id, tenant_id, nome, descricao, arquivado_em, arquivado_por, created_by, updated_by, created_at, updated_at)
  select m.new_id, v_sandbox, fji.nome, fji.descricao, fji.arquivado_em, fji.arquivado_por, fji.created_by, fji.updated_by, fji.created_at, fji.updated_at
  from freelancer_jobs_internos fji
  join tmp_id_map m on m.entidade = 'freelancer_jobs_internos' and m.old_id = fji.id
  where fji.tenant_id = v_california;

  -- 2.15 folha_importacoes
  insert into folha_importacoes (id, tenant_id, competencia_ano, competencia_mes, arquivo_nome, arquivo_hash, linhas_total, linhas_criadas, linhas_atualizadas, linhas_ignoradas, warnings, totalizadores_pdf, uploaded_by, uploaded_at)
  select m.new_id, v_sandbox, fi.competencia_ano, fi.competencia_mes, fi.arquivo_nome, fi.arquivo_hash, fi.linhas_total, fi.linhas_criadas, fi.linhas_atualizadas, fi.linhas_ignoradas, fi.warnings, fi.totalizadores_pdf, fi.uploaded_by, fi.uploaded_at
  from folha_importacoes fi
  join tmp_id_map m on m.entidade = 'folha_importacoes' and m.old_id = fi.id
  where fi.tenant_id = v_california;

  -- 2.16 colaboradores (nivel_id remapeado; lider_id e user_id NULL por ora)
  insert into colaboradores (
    id, tenant_id, nome, email, tipo_contratacao, cpf, funcao, nivel_id,
    data_admissao, data_encerramento, status, created_by, created_at, updated_at,
    banco_codigo, banco_nome, agencia, agencia_dv, conta, conta_dv, tipo_conta,
    pix_tipo, pix_chave, data_nascimento, area, cnpj, telefone, rg, razao_social,
    pj_natureza, cep, logradouro, numero, complemento, bairro, cidade, uf,
    lider_id, email_pessoal, user_id
  )
  select
    m.new_id, v_sandbox, c.nome, c.email, c.tipo_contratacao, c.cpf, c.funcao,
    (select new_id from tmp_id_map where entidade = 'niveis' and old_id = c.nivel_id),
    c.data_admissao, c.data_encerramento, c.status, c.created_by, c.created_at,
    c.updated_at, c.banco_codigo, c.banco_nome, c.agencia, c.agencia_dv, c.conta,
    c.conta_dv, c.tipo_conta, c.pix_tipo, c.pix_chave, c.data_nascimento, c.area,
    c.cnpj, c.telefone, c.rg, c.razao_social, c.pj_natureza, c.cep, c.logradouro,
    c.numero, c.complemento, c.bairro, c.cidade, c.uf,
    null,  -- lider_id: 2a passada
    c.email_pessoal,
    null   -- user_id: UNIQUE global
  from colaboradores c
  join tmp_id_map m on m.entidade = 'colaboradores' and m.old_id = c.id
  where c.tenant_id = v_california;

  -- 2.17 dependentes
  insert into dependentes (id, tenant_id, colaborador_id, nome, cpf, data_nascimento, parentesco, ativo, data_inicio, data_fim, observacao, created_at, updated_at)
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = d.colaborador_id),
    d.nome, d.cpf, d.data_nascimento, d.parentesco, d.ativo, d.data_inicio, d.data_fim, d.observacao, d.created_at, d.updated_at
  from dependentes d
  join tmp_id_map m on m.entidade = 'dependentes' and m.old_id = d.id
  where d.tenant_id = v_california;

  -- 2.18 colaboradores_salarios
  insert into colaboradores_salarios (id, tenant_id, colaborador_id, valor, data_inicio, data_fim, motivo, aprovado_por, created_by, created_at, valor_recibo)
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = cs.colaborador_id),
    cs.valor, cs.data_inicio, cs.data_fim, cs.motivo, cs.aprovado_por, cs.created_by, cs.created_at, cs.valor_recibo
  from colaboradores_salarios cs
  join tmp_id_map m on m.entidade = 'colaboradores_salarios' and m.old_id = cs.id
  where cs.tenant_id = v_california;

  -- 2.19 colaboradores_alocacoes
  insert into colaboradores_alocacoes (id, tenant_id, colaborador_id, empresa_id, regional_id, data_inicio, data_fim, motivo, created_by, created_at, usa_rateio_empresa)
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = ca.colaborador_id),
    (select new_id from tmp_id_map where entidade = 'empresas' and old_id = ca.empresa_id),
    (select new_id from tmp_id_map where entidade = 'regionais' and old_id = ca.regional_id),
    ca.data_inicio, ca.data_fim, ca.motivo, ca.created_by, ca.created_at, ca.usa_rateio_empresa
  from colaboradores_alocacoes ca
  join tmp_id_map m on m.entidade = 'colaboradores_alocacoes' and m.old_id = ca.id
  where ca.tenant_id = v_california;

  -- 2.20 colaboradores_alocacoes_itens
  insert into colaboradores_alocacoes_itens (id, tenant_id, alocacao_id, empresa_id, percentual_empresa, usa_rateio_empresa, created_at)
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'colaboradores_alocacoes' and old_id = cai.alocacao_id),
    (select new_id from tmp_id_map where entidade = 'empresas' and old_id = cai.empresa_id),
    cai.percentual_empresa, cai.usa_rateio_empresa, cai.created_at
  from colaboradores_alocacoes_itens cai
  join tmp_id_map m on m.entidade = 'colaboradores_alocacoes_itens' and m.old_id = cai.id
  where cai.tenant_id = v_california;

  -- 2.21 colaboradores_alocacoes_itens_regionais
  insert into colaboradores_alocacoes_itens_regionais (id, tenant_id, alocacao_item_id, regional_id, percentual_regional, created_at)
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'colaboradores_alocacoes_itens' and old_id = cair.alocacao_item_id),
    (select new_id from tmp_id_map where entidade = 'regionais' and old_id = cair.regional_id),
    cair.percentual_regional, cair.created_at
  from colaboradores_alocacoes_itens_regionais cair
  join tmp_id_map m on m.entidade = 'colaboradores_alocacoes_itens_regionais' and m.old_id = cair.id
  where cair.tenant_id = v_california;

  -- 2.22 colaboradores_ferias_periodos
  -- (trigger de auto-geracao esta desabilitada pelo session_replication_role = replica no topo)
  insert into colaboradores_ferias_periodos (id, tenant_id, colaborador_id, numero, aquisitivo_inicio, aquisitivo_fim, concessivo_inicio, concessivo_fim, dias_direito, status, observacao, created_at, updated_at, data_limite_gozo)
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = cfp.colaborador_id),
    cfp.numero, cfp.aquisitivo_inicio, cfp.aquisitivo_fim, cfp.concessivo_inicio, cfp.concessivo_fim, cfp.dias_direito, cfp.status, cfp.observacao, cfp.created_at, cfp.updated_at, cfp.data_limite_gozo
  from colaboradores_ferias_periodos cfp
  join tmp_id_map m on m.entidade = 'colaboradores_ferias_periodos' and m.old_id = cfp.id
  where cfp.tenant_id = v_california;

  -- 2.23 colaboradores_ferias_lancamentos (conta_avulsa_id NULL — fora do escopo)
  insert into colaboradores_ferias_lancamentos (
    id, tenant_id, colaborador_id, periodo_id, tipo, data_inicio, data_fim, dias,
    status, solicitado_por, aprovado_por, aprovado_em, motivo_reprovacao,
    observacao, lancado_direto_por_rh, valor_base_remuneracao, valor_ferias,
    valor_um_terco, valor_abono, valor_total, recibo_url, recibo_gerado_em,
    conta_avulsa_id, created_at, updated_at, dias_abono
  )
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = cfl.colaborador_id),
    (select new_id from tmp_id_map where entidade = 'colaboradores_ferias_periodos' and old_id = cfl.periodo_id),
    cfl.tipo, cfl.data_inicio, cfl.data_fim, cfl.dias, cfl.status, cfl.solicitado_por,
    cfl.aprovado_por, cfl.aprovado_em, cfl.motivo_reprovacao, cfl.observacao,
    cfl.lancado_direto_por_rh, cfl.valor_base_remuneracao, cfl.valor_ferias,
    cfl.valor_um_terco, cfl.valor_abono, cfl.valor_total, cfl.recibo_url, cfl.recibo_gerado_em,
    null,  -- conta_avulsa_id: contas_avulsas fora do escopo
    cfl.created_at, cfl.updated_at, cfl.dias_abono
  from colaboradores_ferias_lancamentos cfl
  join tmp_id_map m on m.entidade = 'colaboradores_ferias_lancamentos' and m.old_id = cfl.id
  where cfl.tenant_id = v_california;

  -- 2.24 colaboradores_nf_anexos
  insert into colaboradores_nf_anexos (id, tenant_id, colaborador_id, competencia_ano, competencia_mes, arquivo_path, arquivo_nome, arquivo_tamanho_bytes, uploaded_by, uploaded_at, created_at, updated_at, escopo_tipo, escopo_id)
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = cna.colaborador_id),
    cna.competencia_ano, cna.competencia_mes, cna.arquivo_path, cna.arquivo_nome, cna.arquivo_tamanho_bytes, cna.uploaded_by, cna.uploaded_at, cna.created_at, cna.updated_at, cna.escopo_tipo, cna.escopo_id
  from colaboradores_nf_anexos cna
  join tmp_id_map m on m.entidade = 'colaboradores_nf_anexos' and m.old_id = cna.id
  where cna.tenant_id = v_california;

  -- 2.25 colaborador_beneficio
  insert into colaborador_beneficio (id, tenant_id, colaborador_id, beneficio_id, modo_custeio, data_inicio, data_fim, observacao, created_by, created_at, updated_at)
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = cb.colaborador_id),
    (select new_id from tmp_id_map where entidade = 'beneficios' and old_id = cb.beneficio_id),
    cb.modo_custeio, cb.data_inicio, cb.data_fim, cb.observacao, cb.created_by, cb.created_at, cb.updated_at
  from colaborador_beneficio cb
  join tmp_id_map m on m.entidade = 'colaborador_beneficio' and m.old_id = cb.id
  where cb.tenant_id = v_california;

  -- 2.26 colaborador_beneficio_dependente
  insert into colaborador_beneficio_dependente (id, colaborador_beneficio_id, dependente_id, data_inicio, data_fim, created_at)
  select
    m.new_id,
    (select new_id from tmp_id_map where entidade = 'colaborador_beneficio' and old_id = cbd.colaborador_beneficio_id),
    (select new_id from tmp_id_map where entidade = 'dependentes' and old_id = cbd.dependente_id),
    cbd.data_inicio, cbd.data_fim, cbd.created_at
  from colaborador_beneficio_dependente cbd
  join tmp_id_map m on m.entidade = 'colaborador_beneficio_dependente' and m.old_id = cbd.id;

  -- 2.27 beneficio_fechamento_mensal
  insert into beneficio_fechamento_mensal (id, tenant_id, ano, mes, fechado_em, fechado_por, reaberto_em, reaberto_por, observacao)
  select m.new_id, v_sandbox, bfm.ano, bfm.mes, bfm.fechado_em, bfm.fechado_por, bfm.reaberto_em, bfm.reaberto_por, bfm.observacao
  from beneficio_fechamento_mensal bfm
  join tmp_id_map m on m.entidade = 'beneficio_fechamento_mensal' and m.old_id = bfm.id
  where bfm.tenant_id = v_california;

  -- 2.28 beneficio_fechamento_linha
  insert into beneficio_fechamento_linha (
    id, tenant_id, fechamento_id, colaborador_beneficio_id, colaborador_id,
    beneficio_id, beneficio_nome, beneficio_operadora, beneficio_tipo,
    modo_custeio, valor_titular, valor_dependentes_total, valor_integral,
    valor_empresa, valor_colaborador, qtd_dependentes_na_competencia, created_at
  )
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'beneficio_fechamento_mensal' and old_id = bfl.fechamento_id),
    (select new_id from tmp_id_map where entidade = 'colaborador_beneficio' and old_id = bfl.colaborador_beneficio_id),
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = bfl.colaborador_id),
    (select new_id from tmp_id_map where entidade = 'beneficios' and old_id = bfl.beneficio_id),
    bfl.beneficio_nome, bfl.beneficio_operadora, bfl.beneficio_tipo, bfl.modo_custeio,
    bfl.valor_titular, bfl.valor_dependentes_total, bfl.valor_integral,
    bfl.valor_empresa, bfl.valor_colaborador, bfl.qtd_dependentes_na_competencia, bfl.created_at
  from beneficio_fechamento_linha bfl
  join tmp_id_map m on m.entidade = 'beneficio_fechamento_linha' and m.old_id = bfl.id
  where bfl.tenant_id = v_california;

  -- 2.29 decimo_terceiro_folhas
  insert into decimo_terceiro_folhas (id, tenant_id, ano, status, criada_em, criada_por, recalculada_em, recalculada_por, created_at, updated_at)
  select m.new_id, v_sandbox, dtf.ano, dtf.status, dtf.criada_em, dtf.criada_por, dtf.recalculada_em, dtf.recalculada_por, dtf.created_at, dtf.updated_at
  from decimo_terceiro_folhas dtf
  join tmp_id_map m on m.entidade = 'decimo_terceiro_folhas' and m.old_id = dtf.id
  where dtf.tenant_id = v_california;

  -- 2.30 folhas_pagamento (cross-refs NULL agora; UPDATE depois)
  insert into folhas_pagamento (
    id, tenant_id, colaborador_id, competencia_ano, competencia_mes, salario_base,
    status, created_by, created_at, updated_at, motivo_pendencia, enviada_em,
    enviada_por, aprovada_em, aprovada_por, reprovada_em, reprovada_por,
    data_pagamento, paga_em, paga_por, origem, data_pagamento_prevista, tipo,
    lancamento_ferias_id, anexo_url, desconto_beneficios, decimo_terceiro_linha_id,
    tipo_folha_ferias, decimo_terceiro_adiantamento_id
  )
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = fp.colaborador_id),
    fp.competencia_ano, fp.competencia_mes, fp.salario_base, fp.status, fp.created_by,
    fp.created_at, fp.updated_at, fp.motivo_pendencia, fp.enviada_em, fp.enviada_por,
    fp.aprovada_em, fp.aprovada_por, fp.reprovada_em, fp.reprovada_por, fp.data_pagamento,
    fp.paga_em, fp.paga_por, fp.origem, fp.data_pagamento_prevista, fp.tipo,
    null,  -- lancamento_ferias_id: 2a passada
    fp.anexo_url, fp.desconto_beneficios,
    null,  -- decimo_terceiro_linha_id: 2a passada
    fp.tipo_folha_ferias,
    null   -- decimo_terceiro_adiantamento_id: 2a passada
  from folhas_pagamento fp
  join tmp_id_map m on m.entidade = 'folhas_pagamento' and m.old_id = fp.id
  where fp.tenant_id = v_california;

  -- 2.31 folhas_pagamento_alocacoes
  insert into folhas_pagamento_alocacoes (id, tenant_id, folha_id, empresa_id, regional_id, percentual, created_at)
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'folhas_pagamento' and old_id = fpa.folha_id),
    (select new_id from tmp_id_map where entidade = 'empresas' and old_id = fpa.empresa_id),
    (select new_id from tmp_id_map where entidade = 'regionais' and old_id = fpa.regional_id),
    fpa.percentual, fpa.created_at
  from folhas_pagamento_alocacoes fpa
  join tmp_id_map m on m.entidade = 'folhas_pagamento_alocacoes' and m.old_id = fpa.id
  where fpa.tenant_id = v_california;

  -- 2.32 decimo_terceiro_linhas
  insert into decimo_terceiro_linhas (
    id, tenant_id, folha_id, colaborador_id, snapshot_nome, snapshot_cpf,
    snapshot_tipo_contratacao, snapshot_funcao, snapshot_data_admissao,
    snapshot_salario, snapshot_empresa_id, avos, total_adiantado, primeira_parcela,
    segunda_parcela, desconto_inss, desconto_irrf, total_bruto, total_liquido,
    editado_manualmente, salario_editado, avos_editado, obs, created_at, updated_at,
    created_by, updated_by, snapshot_valor_recibo, parte_clt_primeira_parcela,
    parte_clt_segunda_parcela, parte_clt_desconto_inss, parte_clt_desconto_irrf,
    parte_clt_total_liquido, parte_pj_primeira_parcela, parte_pj_segunda_parcela,
    parte_pj_total_liquido, teve_reajuste_no_ano
  )
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'decimo_terceiro_folhas' and old_id = dtl.folha_id),
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = dtl.colaborador_id),
    dtl.snapshot_nome, dtl.snapshot_cpf, dtl.snapshot_tipo_contratacao, dtl.snapshot_funcao,
    dtl.snapshot_data_admissao, dtl.snapshot_salario,
    (select new_id from tmp_id_map where entidade = 'empresas' and old_id = dtl.snapshot_empresa_id),
    dtl.avos, dtl.total_adiantado, dtl.primeira_parcela, dtl.segunda_parcela,
    dtl.desconto_inss, dtl.desconto_irrf, dtl.total_bruto, dtl.total_liquido,
    dtl.editado_manualmente, dtl.salario_editado, dtl.avos_editado, dtl.obs,
    dtl.created_at, dtl.updated_at, dtl.created_by, dtl.updated_by,
    dtl.snapshot_valor_recibo, dtl.parte_clt_primeira_parcela, dtl.parte_clt_segunda_parcela,
    dtl.parte_clt_desconto_inss, dtl.parte_clt_desconto_irrf, dtl.parte_clt_total_liquido,
    dtl.parte_pj_primeira_parcela, dtl.parte_pj_segunda_parcela, dtl.parte_pj_total_liquido,
    dtl.teve_reajuste_no_ano
  from decimo_terceiro_linhas dtl
  join tmp_id_map m on m.entidade = 'decimo_terceiro_linhas' and m.old_id = dtl.id
  where dtl.tenant_id = v_california;

  -- 2.33 decimo_terceiro_adiantamentos (conta_avulsa_id NULL — fora do escopo)
  insert into decimo_terceiro_adiantamentos (id, tenant_id, ano, colaborador_id, data, valor, obs, conta_avulsa_id, created_at, created_by, folha_pagamento_id)
  select
    m.new_id, v_sandbox, dta.ano,
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = dta.colaborador_id),
    dta.data, dta.valor, dta.obs,
    null,
    dta.created_at, dta.created_by,
    (select new_id from tmp_id_map where entidade = 'folhas_pagamento' and old_id = dta.folha_pagamento_id)
  from decimo_terceiro_adiantamentos dta
  join tmp_id_map m on m.entidade = 'decimo_terceiro_adiantamentos' and m.old_id = dta.id
  where dta.tenant_id = v_california;

  -- 2.34 contratacoes (token regen; FKs remap)
  insert into contratacoes (
    id, tenant_id, created_by, created_at, updated_at, nome, email, cargo,
    salario_proposto, data_admissao, empresa_id, regional_id, tipo_contratacao,
    nivel_id, area, pj_natureza, cpf, cnpj, razao_social, rg, telefone,
    data_nascimento, cep, logradouro, numero, complemento, bairro, cidade, uf,
    banco_codigo, banco_nome, agencia, agencia_dv, conta, conta_dv, tipo_conta,
    pix_tipo, pix_chave, status, motivo_recusa, motivo_desistencia,
    proposta_enviada_em, aceite_em, dados_completados_em, contrato_gerado_em,
    contrato_assinado_anexado_em, efetivada_em, token, token_expira_em,
    contrato_gerado_path, contrato_assinado_path, virou_colaborador_id, lider_id
  )
  select
    m.new_id, v_sandbox, ct.created_by, ct.created_at, ct.updated_at, ct.nome,
    ct.email, ct.cargo, ct.salario_proposto, ct.data_admissao,
    (select new_id from tmp_id_map where entidade = 'empresas' and old_id = ct.empresa_id),
    (select new_id from tmp_id_map where entidade = 'regionais' and old_id = ct.regional_id),
    ct.tipo_contratacao,
    (select new_id from tmp_id_map where entidade = 'niveis' and old_id = ct.nivel_id),
    ct.area, ct.pj_natureza, ct.cpf, ct.cnpj, ct.razao_social, ct.rg, ct.telefone,
    ct.data_nascimento, ct.cep, ct.logradouro, ct.numero, ct.complemento, ct.bairro,
    ct.cidade, ct.uf, ct.banco_codigo, ct.banco_nome, ct.agencia, ct.agencia_dv,
    ct.conta, ct.conta_dv, ct.tipo_conta, ct.pix_tipo, ct.pix_chave, ct.status,
    ct.motivo_recusa, ct.motivo_desistencia, ct.proposta_enviada_em, ct.aceite_em,
    ct.dados_completados_em, ct.contrato_gerado_em, ct.contrato_assinado_anexado_em,
    ct.efetivada_em,
    gen_random_uuid()::text,  -- token: UNIQUE global
    ct.token_expira_em, ct.contrato_gerado_path, ct.contrato_assinado_path,
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = ct.virou_colaborador_id),
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = ct.lider_id)
  from contratacoes ct
  join tmp_id_map m on m.entidade = 'contratacoes' and m.old_id = ct.id
  where ct.tenant_id = v_california;

  -- 2.35 freelancers (legado_id NULL)
  insert into freelancers (
    id, tenant_id, nome_social, nome_completo, cpf, rg, data_nascimento, email,
    celular, cep, rua, numero, complemento, bairro, cidade, cnpj, razao_social,
    cartao_cnpj_url, tipo_pagamento, banco, agencia, conta, pix_chave, cor_raca,
    identidade_genero, deficiencia, saude_obs, contato_emergencia, acao_prevista,
    origem, created_at, updated_at, created_by, updated_by, legado_id, pix_tipo,
    tipo_conta, responsavel_id, endereco_legado
  )
  select
    m.new_id, v_sandbox, f.nome_social, f.nome_completo, f.cpf, f.rg,
    f.data_nascimento, f.email, f.celular, f.cep, f.rua, f.numero, f.complemento,
    f.bairro, f.cidade, f.cnpj, f.razao_social, f.cartao_cnpj_url, f.tipo_pagamento,
    f.banco, f.agencia, f.conta, f.pix_chave, f.cor_raca, f.identidade_genero,
    f.deficiencia, f.saude_obs, f.contato_emergencia, f.acao_prevista, f.origem,
    f.created_at, f.updated_at, f.created_by, f.updated_by,
    null,  -- legado_id: UNIQUE global
    f.pix_tipo, f.tipo_conta, f.responsavel_id, f.endereco_legado
  from freelancers f
  join tmp_id_map m on m.entidade = 'freelancers' and m.old_id = f.id
  where f.tenant_id = v_california;

  -- 2.36 freelancer_contratos (job_id NULL, legado_id NULL)
  insert into freelancer_contratos (
    id, tenant_id, freelancer_id, job_id, responsavel_id, nome_job, cargo, tipo,
    valor, data_inicio, data_termino, cidade, observacoes, status_real, arquivo_url,
    minuta_url, data_termino_original, distrato_minuta_url, distrato_arquivo_url,
    distrato_data_proposta, distrato_motivo, distrato_solicitado_em,
    distrato_solicitado_por, origem_sistema, created_at, updated_at, created_by,
    updated_by, legado_id, job_interno_id, efetivado_colaborador_id
  )
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'freelancers' and old_id = fc.freelancer_id),
    null,  -- job_id: jobs nao clonados
    fc.responsavel_id, fc.nome_job, fc.cargo, fc.tipo, fc.valor, fc.data_inicio,
    fc.data_termino, fc.cidade, fc.observacoes, fc.status_real, fc.arquivo_url,
    fc.minuta_url, fc.data_termino_original, fc.distrato_minuta_url,
    fc.distrato_arquivo_url, fc.distrato_data_proposta, fc.distrato_motivo,
    fc.distrato_solicitado_em, fc.distrato_solicitado_por,
    case when fc.job_interno_id is not null then fc.origem_sistema else 'ag_california_rh' end,
    fc.created_at, fc.updated_at, fc.created_by, fc.updated_by,
    null,  -- legado_id: UNIQUE global
    (select new_id from tmp_id_map where entidade = 'freelancer_jobs_internos' and old_id = fc.job_interno_id),
    (select new_id from tmp_id_map where entidade = 'colaboradores' and old_id = fc.efetivado_colaborador_id)
  from freelancer_contratos fc
  join tmp_id_map m on m.entidade = 'freelancer_contratos' and m.old_id = fc.id
  where fc.tenant_id = v_california;

  -- 2.37 freelancer_contrato_historico
  insert into freelancer_contrato_historico (id, tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por, alterado_em)
  select
    m.new_id, v_sandbox,
    (select new_id from tmp_id_map where entidade = 'freelancer_contratos' and old_id = fch.contrato_id),
    fch.campo, fch.valor_anterior, fch.valor_novo, fch.alterado_por, fch.alterado_em
  from freelancer_contrato_historico fch
  join tmp_id_map m on m.entidade = 'freelancer_contrato_historico' and m.old_id = fch.id
  where fch.tenant_id = v_california;

  -- 2.38 freelancer_solicitacoes (token regen; job_id/legado_id NULL)
  insert into freelancer_solicitacoes (
    id, tenant_id, token, solicitante_id, nome_freela, cpf_freela, job_id, cargo,
    valor, tipo, data_inicio, data_termino, cidade, observacoes, status,
    aprovado_por, aprovado_em, expira_em, rejeitado_por, rejeitado_em,
    rejeicao_motivo, cancelado_por, cancelado_em, freelancer_id, contrato_id,
    created_at, updated_at, legado_id, nome_job, job_interno_id
  )
  select
    m.new_id, v_sandbox,
    gen_random_uuid()::text,  -- token: UNIQUE global
    fs.solicitante_id, fs.nome_freela, fs.cpf_freela,
    null,  -- job_id: jobs nao clonados
    fs.cargo, fs.valor, fs.tipo, fs.data_inicio, fs.data_termino, fs.cidade,
    fs.observacoes, fs.status, fs.aprovado_por, fs.aprovado_em, fs.expira_em,
    fs.rejeitado_por, fs.rejeitado_em, fs.rejeicao_motivo, fs.cancelado_por,
    fs.cancelado_em,
    (select new_id from tmp_id_map where entidade = 'freelancers' and old_id = fs.freelancer_id),
    (select new_id from tmp_id_map where entidade = 'freelancer_contratos' and old_id = fs.contrato_id),
    fs.created_at, fs.updated_at,
    null,  -- legado_id: UNIQUE global
    fs.nome_job,
    (select new_id from tmp_id_map where entidade = 'freelancer_jobs_internos' and old_id = fs.job_interno_id)
  from freelancer_solicitacoes fs
  join tmp_id_map m on m.entidade = 'freelancer_solicitacoes' and m.old_id = fs.id
  where fs.tenant_id = v_california;

  -- 2.39 freelancer_solicitacao_mensagens
  insert into freelancer_solicitacao_mensagens (id, solicitacao_id, autor_id, texto, created_at)
  select
    m.new_id,
    (select new_id from tmp_id_map where entidade = 'freelancer_solicitacoes' and old_id = fsm.solicitacao_id),
    fsm.autor_id, fsm.texto, fsm.created_at
  from freelancer_solicitacao_mensagens fsm
  join tmp_id_map m on m.entidade = 'freelancer_solicitacao_mensagens' and m.old_id = fsm.id;

  -- 2.40 freelancer_solicitacao_mensagens_leituras (sem PK uuid, PK composta)
  insert into freelancer_solicitacao_mensagens_leituras (solicitacao_id, user_id, last_read_at)
  select
    (select new_id from tmp_id_map where entidade = 'freelancer_solicitacoes' and old_id = fsml.solicitacao_id),
    fsml.user_id, fsml.last_read_at
  from freelancer_solicitacao_mensagens_leituras fsml
  join freelancer_solicitacoes fs on fs.id = fsml.solicitacao_id
  where fs.tenant_id = v_california;

  -- =========================================================================
  -- 3. 2a passada: fechar auto-referencias e FKs ciclicas
  -- =========================================================================

  -- 3.1 colaboradores.lider_id (self-ref)
  update colaboradores c_novo
     set lider_id = (
       select new_id from tmp_id_map
       where entidade = 'colaboradores' and old_id = c_antigo.lider_id
     )
    from colaboradores c_antigo
    join tmp_id_map m on m.entidade = 'colaboradores' and m.old_id = c_antigo.id
   where c_novo.id = m.new_id
     and c_novo.tenant_id = v_sandbox
     and c_antigo.lider_id is not null;

  -- 3.2 beneficios.beneficio_base_id (self-ref)
  update beneficios b_novo
     set beneficio_base_id = (
       select new_id from tmp_id_map
       where entidade = 'beneficios' and old_id = b_antigo.beneficio_base_id
     )
    from beneficios b_antigo
    join tmp_id_map m on m.entidade = 'beneficios' and m.old_id = b_antigo.id
   where b_novo.id = m.new_id
     and b_novo.tenant_id = v_sandbox
     and b_antigo.beneficio_base_id is not null;

  -- 3.3 folhas_pagamento.decimo_terceiro_linha_id, decimo_terceiro_adiantamento_id, lancamento_ferias_id
  update folhas_pagamento fp_novo
     set decimo_terceiro_linha_id = (
           select new_id from tmp_id_map
           where entidade = 'decimo_terceiro_linhas' and old_id = fp_antigo.decimo_terceiro_linha_id
         ),
         decimo_terceiro_adiantamento_id = (
           select new_id from tmp_id_map
           where entidade = 'decimo_terceiro_adiantamentos' and old_id = fp_antigo.decimo_terceiro_adiantamento_id
         ),
         lancamento_ferias_id = (
           select new_id from tmp_id_map
           where entidade = 'colaboradores_ferias_lancamentos' and old_id = fp_antigo.lancamento_ferias_id
         )
    from folhas_pagamento fp_antigo
    join tmp_id_map m on m.entidade = 'folhas_pagamento' and m.old_id = fp_antigo.id
   where fp_novo.id = m.new_id
     and fp_novo.tenant_id = v_sandbox
     and (
       fp_antigo.decimo_terceiro_linha_id is not null
       or fp_antigo.decimo_terceiro_adiantamento_id is not null
       or fp_antigo.lancamento_ferias_id is not null
     );

  -- =========================================================================
  -- 4. Conferencia final: logs de contagem pra auditoria
  -- =========================================================================

  select count(*) into v_count from colaboradores where tenant_id = v_sandbox;
  raise notice 'Colaboradores clonados: %', v_count;

  select count(*) into v_count from freelancers where tenant_id = v_sandbox;
  raise notice 'Freelancers clonados: %', v_count;

  select count(*) into v_count from freelancer_contratos where tenant_id = v_sandbox;
  raise notice 'Freelancer contratos clonados: %', v_count;

  select count(*) into v_count from folhas_pagamento where tenant_id = v_sandbox;
  raise notice 'Folhas de pagamento clonadas: %', v_count;

  select count(*) into v_count from tenant_members where tenant_id = v_sandbox;
  raise notice 'Membros do tenant Sandbox: %', v_count;

  raise notice '=== CLONE CONCLUIDO. Tenant Sandbox id: % ===', v_sandbox;

end $$;

set session_replication_role = origin;
