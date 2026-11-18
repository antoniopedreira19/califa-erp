-- Decisão 266 — Job de Pagamentos (18/11/2026)
--
-- O financeiro cria, pela aba Visualizar Jobs, um job já ABERTO que não
-- passa por orçamento nem pela fila de abertura, para a produção lançar os
-- custos de pagamentos que não pertencem a um job de cliente. Regras do
-- Tiago (protótipo aprovado em 18/11/2026):
--
--   * o cliente do job é a própria empresa (empresas.cliente_id); CCH e
--     Ventura ganham cliente (CCH, VEN) e o cliente CAL passa a se chamar
--     "Agência California" (mesmo código, mesmos jobs);
--   * sem GP e sem produtor responsáveis — o banco passa a aceitar o vazio
--     SÓ no job (e no projeto da produção) de pagamentos;
--   * do Interno, só o "não fatura": tipo F · Interno, sem save, sem
--     honorário, imposto ou faturamento. O planejado NÃO acompanha o orçado
--     (o orçado é sempre zero) e as linhas entram sem errata;
--   * o job sempre tem orçamento e versão aprovada (as linhas da planilha do
--     job se ancoram nos agrupamentos da versão), então a função cria, na
--     mesma transação, um projeto da produção (um por projeto unificado) e
--     um orçamento aprovado e vazio. Os dois ficam fora do módulo
--     Orçamentos (projetos.de_pagamentos).
--
-- Tudo é aditivo: colunas novas com default, CHECKs que valem para as
-- linhas existentes, funções novas e o `planejado_espelha_orcado` com um
-- ramo a mais no começo (o resto igual à definição de 20260925100001).

-- ---------------------------------------------------------------------------
-- 1. O cliente de cada empresa
-- ---------------------------------------------------------------------------
alter table public.empresas
  add column if not exists cliente_id uuid references public.clientes(id) on delete restrict;
create index if not exists idx_empresas_cliente_id on public.empresas (cliente_id);
comment on column public.empresas.cliente_id is
  'O cliente que é a própria empresa: é o cliente (e a sigla do código) do job de pagamentos (decisão 266).';

-- O CAL é a Agência California: só o nome fantasia muda (pedido do Tiago).
update public.clientes
   set nome_fantasia = 'Agência California', updated_at = now()
 where id = '87c949b0-039f-4f83-86ec-478e8ca20dc9'
   and nome_fantasia = 'CALIFORNIA FILMES E PUBLICIDADE FORTALEZA';

-- CCH e Ventura (tenant Agência California): o cliente nasce com os dados
-- da própria empresa, lidos da tabela (nada de dado literal aqui).
insert into public.clientes (tenant_id, nome_fantasia, razao_social, cnpj, codigo_curto, status)
select e.tenant_id,
       e.nome_fantasia,
       e.razao_social,
       nullif(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g'), ''),
       v.sigla,
       'ativo'
  from public.empresas e
  join (values ('1703fd52-a36c-4701-816c-a0bcc868351d'::uuid, 'CCH'),
               ('3b0edb30-9cb0-4604-b563-33b42be51bc2'::uuid, 'VEN')) as v(empresa_id, sigla)
    on v.empresa_id = e.id
 where not exists (
   select 1 from public.clientes c
    where c.tenant_id = e.tenant_id and c.codigo_curto = v.sigla
 );

-- O vínculo. Sandbox: só a Empresa Teste (cliente Teste), para os testes.
update public.empresas e
   set cliente_id = m.cliente_id
  from (
    select '304039bd-509d-4536-aa26-44e7091ee718'::uuid as empresa_id,
           '87c949b0-039f-4f83-86ec-478e8ca20dc9'::uuid as cliente_id   -- Agência California → CAL
    union all
    select 'a61067d9-b46b-40b0-8541-4850f13aa47c'::uuid,
           'abc63a94-8067-4db8-8ddd-70895325eae7'::uuid                -- Hitlab → HIT
    union all
    select e2.id, c.id                                                 -- CCH → CCH, Ventura → VEN
      from public.empresas e2
      join public.clientes c
        on c.tenant_id = e2.tenant_id
       and c.codigo_curto = case e2.id
             when '1703fd52-a36c-4701-816c-a0bcc868351d'::uuid then 'CCH'
             when '3b0edb30-9cb0-4604-b563-33b42be51bc2'::uuid then 'VEN'
           end
     where e2.id in ('1703fd52-a36c-4701-816c-a0bcc868351d', '3b0edb30-9cb0-4604-b563-33b42be51bc2')
    union all
    select 'c8111dca-4063-42b2-80be-14fbb372b50f'::uuid,
           'b32075ad-e6d0-4f13-aea9-af227937a4cb'::uuid                -- Sandbox: Empresa Teste → TES
  ) m
 where e.id = m.empresa_id
   and e.cliente_id is null;

-- ---------------------------------------------------------------------------
-- 2. O serviço e a categoria Pagamentos
-- ---------------------------------------------------------------------------
alter table public.categorias_dominio
  add column if not exists job_de_pagamentos boolean not null default false;
comment on column public.categorias_dominio.job_de_pagamentos is
  'O serviço e a categoria do job de pagamentos (decisão 266). Não aparecem para escolha em nenhum formulário; são do sistema.';

-- O serviço segue o Interno (investimento_interno = true): só FI, sem save,
-- sem faturamento. O planejado livre vem da marca do job (seção 4).
insert into public.categorias_dominio
  (tenant_id, escopo, nome, modelo_planilha, investimento_interno, aceita_servico_interno, job_de_pagamentos, ativo)
select t.id, 'projeto', 'Pagamentos', 'nacional', true, false, true, true
  from public.tenants t
 where not exists (
   select 1 from public.categorias_dominio c
    where c.tenant_id = t.id and c.escopo = 'projeto' and lower(c.nome) = 'pagamentos'
 );

insert into public.categorias_dominio
  (tenant_id, escopo, nome, modelo_planilha, investimento_interno, aceita_servico_interno, servico_exclusivo_id, job_de_pagamentos, ativo)
select s.tenant_id, 'orcamento', 'Pagamentos', 'nacional', false, false, s.id, true, true
  from public.categorias_dominio s
 where s.escopo = 'projeto' and s.job_de_pagamentos
   and not exists (
     select 1 from public.categorias_dominio c
      where c.tenant_id = s.tenant_id and c.escopo = 'orcamento' and lower(c.nome) = 'pagamentos'
   );

-- Só o sistema mexe nos dois (renomear, desativar ou apagar quebraria os jobs).
create or replace function public.guarda_categoria_de_pagamentos()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if new.job_de_pagamentos then
      raise exception 'O serviço e a categoria Pagamentos são do sistema.' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.job_de_pagamentos then
      raise exception 'O serviço e a categoria Pagamentos são do sistema.' using errcode = '42501';
    end if;
    return old;
  end if;
  if (old.job_de_pagamentos or new.job_de_pagamentos)
     and (new.job_de_pagamentos is distinct from old.job_de_pagamentos
          or new.nome is distinct from old.nome
          or new.ativo is distinct from old.ativo
          or new.escopo is distinct from old.escopo
          or new.investimento_interno is distinct from old.investimento_interno
          or new.modelo_planilha is distinct from old.modelo_planilha
          or new.servico_exclusivo_id is distinct from old.servico_exclusivo_id) then
    raise exception 'O serviço e a categoria Pagamentos são do sistema.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guarda_categoria_de_pagamentos on public.categorias_dominio;
create trigger trg_guarda_categoria_de_pagamentos
  before insert or update or delete on public.categorias_dominio
  for each row execute function public.guarda_categoria_de_pagamentos();

-- ---------------------------------------------------------------------------
-- 3. A marca do job e do projeto de pagamentos; GP vazio só neles
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists de_pagamentos boolean not null default false;
comment on column public.jobs.de_pagamentos is
  'Job de pagamentos (decisão 266): criado pelo financeiro, sem GP nem produtor, planejado livre e linhas sem errata.';

alter table public.projetos
  add column if not exists de_pagamentos boolean not null default false,
  add column if not exists projeto_financeiro_de_pagamentos_id uuid
    references public.projetos_financeiro(id) on delete set null;
comment on column public.projetos.de_pagamentos is
  'Projeto da produção que nasce por baixo dos jobs de pagamentos (decisão 266). Fica fora do módulo Orçamentos.';
comment on column public.projetos.projeto_financeiro_de_pagamentos_id is
  'O projeto unificado a que este projeto de pagamentos corresponde: um projeto da produção por projeto unificado.';
create unique index if not exists uniq_projetos_de_pagamentos_por_projeto_financeiro
  on public.projetos (projeto_financeiro_de_pagamentos_id)
  where projeto_financeiro_de_pagamentos_id is not null;
create index if not exists idx_jobs_de_pagamentos on public.jobs (tenant_id) where de_pagamentos;

alter table public.jobs alter column responsavel_id drop not null;
alter table public.jobs drop constraint if exists chk_jobs_gp_vazio_so_no_de_pagamentos;
alter table public.jobs add constraint chk_jobs_gp_vazio_so_no_de_pagamentos
  check (responsavel_id is not null or de_pagamentos);

alter table public.projetos alter column responsavel_id drop not null;
alter table public.projetos drop constraint if exists chk_projetos_gp_vazio_so_no_de_pagamentos;
alter table public.projetos add constraint chk_projetos_gp_vazio_so_no_de_pagamentos
  check (responsavel_id is not null or de_pagamentos);

-- A marca só nasce pela função da seção 5 e não muda. No job de pagamentos,
-- GP, produtor, serviço e categoria ficam como nasceram (a Equipe e o
-- "Editar registro" esbarram aqui).
create or replace function public.guarda_job_de_pagamentos()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.de_pagamentos and current_user = 'authenticated' then
      raise exception 'O job de pagamentos nasce só pelo “Criar Job de Pagamentos”.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.de_pagamentos is distinct from old.de_pagamentos then
    raise exception 'A marca de job de pagamentos não muda.' using errcode = '42501';
  end if;
  if new.de_pagamentos then
    if new.responsavel_id is not null or new.produtor_id is not null then
      raise exception 'O job de pagamentos não tem GP nem produtor responsável.' using errcode = '42501';
    end if;
    if new.servico_id is distinct from old.servico_id or new.categoria_id is distinct from old.categoria_id then
      raise exception 'O serviço e a categoria do job de pagamentos não mudam.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_guarda_de_pagamentos on public.jobs;
create trigger trg_jobs_guarda_de_pagamentos
  before insert or update on public.jobs
  for each row execute function public.guarda_job_de_pagamentos();

create or replace function public.guarda_projeto_de_pagamentos()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if (new.de_pagamentos or new.projeto_financeiro_de_pagamentos_id is not null)
       and current_user = 'authenticated' then
      raise exception 'O projeto de pagamentos nasce só com o job de pagamentos.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.de_pagamentos is distinct from old.de_pagamentos then
    raise exception 'A marca de projeto de pagamentos não muda.' using errcode = '42501';
  end if;
  if current_user = 'authenticated'
     and new.projeto_financeiro_de_pagamentos_id is distinct from old.projeto_financeiro_de_pagamentos_id then
    raise exception 'O projeto de pagamentos acompanha o projeto unificado do sistema.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projetos_guarda_de_pagamentos on public.projetos;
create trigger trg_projetos_guarda_de_pagamentos
  before insert or update on public.projetos
  for each row execute function public.guarda_projeto_de_pagamentos();

-- ---------------------------------------------------------------------------
-- 4. O planejado do job de pagamentos não espelha o orçado
-- ---------------------------------------------------------------------------
-- Igual à definição de 20260925100001, com um ramo a mais no começo: no job
-- de pagamentos a linha é F · Interno, sem save, com o orçado sempre zero e
-- o planejado que a produção digitou.
create or replace function public.planejado_espelha_orcado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_interno boolean;
begin
  if tg_table_name = 'jobs_itens_orcado'
     and exists (select 1 from jobs j where j.id = new.job_id and j.de_pagamentos) then
    if new.em_save or coalesce(new.save_consumido, 0) > 0 then
      raise exception 'O job de pagamentos não usa save.'
        using errcode = 'check_violation';
    end if;
    new.tipo_custo            := 'FI';
    new.valor_unitario_orcado := 0;
    return new;
  end if;

  if tg_table_name = 'versoes_orcamento_itens' then
    select public.orcamento_de_investimento_interno(v.orcamento_id)
      into v_interno
      from versoes_orcamento v
     where v.id = new.versao_orcamento_id;
  else
    select public.orcamento_de_investimento_interno(j.orcamento_id)
      into v_interno
      from jobs j
     where j.id = new.job_id;
  end if;

  if coalesce(v_interno, false) then
    if new.em_save or coalesce(new.save_consumido, 0) > 0 then
      raise exception 'O serviço Interno não usa save: é investimento da California, sem crédito de cliente a gerar ou consumir.'
        using errcode = 'check_violation';
    end if;
    new.tipo_custo               := 'FI';
    new.valor_unitario_planejado := coalesce(new.valor_unitario_orcado, 0);
    new.quantidade_planejada     := coalesce(new.quantidade_orcada, 0);
    new.dias_meses_planejado     := coalesce(new.dias_meses_orcado, 0);
    return new;
  end if;

  -- Linha em save não tem custo neste projeto: o serviço não acontece
  -- aqui, então não há fornecedor a pagar (decisão 028 §9).
  if new.em_save then
    new.valor_unitario_planejado := 0;
    new.quantidade_planejada     := 0;
    new.dias_meses_planejado     := 0;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. criar_job_de_pagamentos: tudo numa transação
-- ---------------------------------------------------------------------------
-- Os códigos chegam da Server Action, gerados pelos mesmos geradores do resto
-- do sistema (lib/codigos/*): job SIGLA-1NNN/AA pelo cliente da empresa,
-- projeto unificado F-NNNN/AA, projeto P-NNNN/AA e orçamento <projeto>-NN.
-- As constraints de unicidade cobrem a corrida entre dois cliques.
create or replace function public.criar_job_de_pagamentos(
  p_empresa_id uuid,
  p_regional_id uuid,
  p_trimestre smallint,
  p_ano smallint,
  p_nome text,
  p_descritivo text,
  p_projeto_financeiro_id uuid,
  p_projeto_financeiro_novo text,
  p_codigo_job text,
  p_codigo_projeto_financeiro text,
  p_codigo_projeto text,
  p_codigo_orcamento text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_papel     text := coalesce((select public.session_role())::text, '');
  v_nome      text := btrim(coalesce(p_nome, ''));
  v_desc      text := btrim(coalesce(p_descritivo, ''));
  v_novo      text := nullif(btrim(coalesce(p_projeto_financeiro_novo, '')), '');
  v_hoje      date := (now() at time zone 'America/Sao_Paulo')::date;
  v_tenant    uuid;
  v_ativa     boolean;
  v_cliente   uuid;
  v_servico   uuid;
  v_categoria uuid;
  v_pf        uuid;
  v_pf_nome   text;
  v_projeto   uuid;
  v_proj_emp  uuid;
  v_orc       uuid;
  v_versao    uuid;
  v_grupo_v   uuid;
  v_job       uuid;
begin
  if v_uid is null then
    raise exception 'Sua sessão expirou. Entre de novo.' using errcode = '42501';
  end if;
  if v_papel not in ('administrador', 'financeiro') then
    raise exception 'Só o administrador ou o financeiro cria job de pagamentos.' using errcode = '42501';
  end if;
  if char_length(v_nome) < 2 or char_length(v_nome) > 200 then
    raise exception 'Informe o nome do job.' using errcode = 'check_violation';
  end if;
  if char_length(v_desc) < 10 or char_length(v_desc) > 500 then
    raise exception 'Escreva o descritivo do job com 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  if p_trimestre is null or p_trimestre not between 1 and 4 or p_ano is null or p_ano not between 2000 and 2100 then
    raise exception 'Escolha a competência.' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_codigo_job), '') = '' or coalesce(btrim(p_codigo_orcamento), '') = '' then
    raise exception 'Não foi possível gerar o código do job. Tente de novo.';
  end if;

  -- Empresa, cliente e regional
  select e.tenant_id, e.ativo, e.cliente_id
    into v_tenant, v_ativa, v_cliente
    from public.empresas e
   where e.id = p_empresa_id;
  if not found or v_tenant not in (select public.current_tenant_ids()) then
    raise exception 'Empresa não encontrada.' using errcode = '42501';
  end if;
  if not coalesce(v_ativa, false) then
    raise exception 'A empresa está inativa.' using errcode = 'check_violation';
  end if;
  if v_cliente is null then
    raise exception 'A empresa ainda não tem cadastro de cliente. Avise o administrador.' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.regionais r
     where r.id = p_regional_id and r.empresa_id = p_empresa_id and r.ativo and r.disponivel_em_projetos
  ) then
    raise exception 'A regional não é desta empresa.' using errcode = 'check_violation';
  end if;
  if not public.can_access_empresa_regional(v_uid, p_empresa_id, p_regional_id) then
    raise exception 'Você não tem acesso a esta empresa e regional.' using errcode = '42501';
  end if;

  select c.id into v_servico from public.categorias_dominio c
   where c.tenant_id = v_tenant and c.escopo = 'projeto' and c.job_de_pagamentos and c.ativo;
  select c.id into v_categoria from public.categorias_dominio c
   where c.tenant_id = v_tenant and c.escopo = 'orcamento' and c.job_de_pagamentos and c.ativo;
  if v_servico is null or v_categoria is null then
    raise exception 'O serviço Pagamentos não está cadastrado.';
  end if;

  -- Projeto unificado: um existente da empresa (decisão 228) ou um novo
  -- (decisão 119), com o cliente da empresa.
  if p_projeto_financeiro_id is not null then
    select pf.id, pf.nome into v_pf, v_pf_nome
      from public.projetos_financeiro pf
     where pf.id = p_projeto_financeiro_id and pf.tenant_id = v_tenant and pf.ativo;
    if v_pf is null then
      raise exception 'Projeto unificado não encontrado. Recarregue a página.' using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.jobs j
       where j.projeto_financeiro_id = v_pf and j.status <> 'cancelado' and j.empresa_id <> p_empresa_id
    ) then
      raise exception 'Este projeto unificado é de outra empresa.' using errcode = 'check_violation';
    end if;
  elsif v_novo is not null then
    if coalesce(btrim(p_codigo_projeto_financeiro), '') = '' then
      raise exception 'Não foi possível gerar o código do projeto. Tente de novo.';
    end if;
    if exists (
      select 1 from public.projetos_financeiro pf
       where pf.tenant_id = v_tenant
         and public.nome_de_projeto_normalizado(pf.nome) = public.nome_de_projeto_normalizado(v_novo)
    ) then
      raise exception 'Já existe um projeto unificado chamado “%”. Escolha-o na lista.', v_novo
        using errcode = 'unique_violation';
    end if;
    insert into public.projetos_financeiro (tenant_id, codigo, nome, cliente_id, ativo, created_by)
    values (v_tenant, p_codigo_projeto_financeiro, v_novo, v_cliente, true, v_uid)
    returning id, nome into v_pf, v_pf_nome;
  else
    raise exception 'Escolha ou crie o projeto unificado.' using errcode = 'check_violation';
  end if;

  -- O projeto da produção: um por projeto unificado.
  select p.id, p.empresa_id into v_projeto, v_proj_emp
    from public.projetos p
   where p.projeto_financeiro_de_pagamentos_id = v_pf;
  if v_projeto is null then
    if coalesce(btrim(p_codigo_projeto), '') = '' then
      raise exception 'Não foi possível gerar o código do projeto. Tente de novo.';
    end if;
    insert into public.projetos (
      tenant_id, codigo, nome, cliente_id, responsavel_id, status, data_inicio_prevista,
      categoria_id, regional_id, empresa_id, produto_id, de_pagamentos,
      projeto_financeiro_de_pagamentos_id, created_by
    ) values (
      v_tenant, p_codigo_projeto, v_pf_nome, v_cliente, null, 'ativo', v_hoje,
      v_servico, p_regional_id, p_empresa_id, null, true,
      v_pf, v_uid
    )
    returning id into v_projeto;
  elsif v_proj_emp <> p_empresa_id then
    raise exception 'Este projeto unificado é de outra empresa.' using errcode = 'check_violation';
  end if;

  -- O orçamento aprovado e vazio por baixo do job.
  insert into public.orcamentos (
    tenant_id, codigo, nome, status, projeto_id, categoria_id, servico_id, empresa_id,
    regional_id, cliente_id, produto_id, gp_responsavel_id, produtor_id, descritivo,
    data_inicio_prevista, aprovado_em, aprovado_por, created_by
  ) values (
    v_tenant, p_codigo_orcamento, v_nome, 'job_criado', v_projeto, v_categoria, v_servico, p_empresa_id,
    p_regional_id, v_cliente, null, null, null, v_desc,
    v_hoje, now(), v_uid, v_uid
  )
  returning id into v_orc;

  insert into public.versoes_orcamento (
    tenant_id, orcamento_id, numero_versao, nome, status, moeda, percentual_honorarios,
    percentual_imposto, save_por_padrao, aprovado_em, aprovado_por, created_by
  ) values (
    v_tenant, v_orc, 1, 'V1', 'aprovada', 'BRL', 0,
    0, false, now(), v_uid, v_uid
  )
  returning id into v_versao;

  update public.orcamentos set versao_aprovada_id = v_versao where id = v_orc;

  -- Um agrupamento vazio: sem nenhum, a Planilha Interna não tem onde
  -- receber a primeira linha.
  insert into public.versoes_orcamento_grupos (tenant_id, versao_orcamento_id, nome, ordem)
  values (v_tenant, v_versao, 'Pagamentos', 1)
  returning id into v_grupo_v;

  insert into public.jobs (
    tenant_id, codigo, projeto_id, orcamento_id, versao_orcamento_aprovada_id, nome,
    nome_financeiro, produto, produto_id, regional_id, cidade, responsavel_id, produtor_id,
    valor_total, valor_job_abertura, faturamento_previsto, faturamento_previsto_abertura,
    faturamento_save_previsto, custo_previsto_total, status, observacoes, empresa_id,
    categoria_id, servico_id, competencia_trimestre, competencia_ano,
    data_abertura_financeiro, aberto_por, projeto_financeiro_id, cliente_id, created_by,
    de_pagamentos
  ) values (
    v_tenant, p_codigo_job, v_projeto, v_orc, v_versao, v_nome,
    v_nome, null, null, p_regional_id, null, null, null,
    0, 0, 0, 0,
    0, 0, 'aberto', v_desc, p_empresa_id,
    v_categoria, v_servico, p_trimestre, p_ano,
    now(), v_uid, v_pf, v_cliente, v_uid,
    true
  )
  returning id into v_job;

  insert into public.jobs_grupos (tenant_id, job_id, grupo_versao_id, nome, ordem)
  values (v_tenant, v_job, v_grupo_v, 'Pagamentos', 1);

  insert into public.jobs_competencias (tenant_id, job_id, trimestre, ano, percentual, created_by)
  values (v_tenant, v_job, p_trimestre, p_ano, 100, v_uid);

  -- A foto da abertura, como a do "Abrir job" (decisão 111).
  insert into public.jobs_aberturas (
    tenant_id, job_id, numero, tipo, registrado_em, registrado_por, nome_financeiro,
    projeto_financeiro_id, categoria_id, servico_id, empresa_id, regional_id, produto_id,
    competencias, curva, recebimento, impostos, valor_job, faturamento_previsto,
    custo_previsto, imposto_previsto
  ) values (
    v_tenant, v_job, 1, 'abertura', now(), v_uid, v_nome,
    v_pf, v_categoria, v_servico, p_empresa_id, p_regional_id, null,
    jsonb_build_array(jsonb_build_object('trimestre', p_trimestre, 'ano', p_ano, 'percentual', 100)),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0, 0,
    0, 0
  );

  return jsonb_build_object(
    'job_id', v_job,
    'codigo', p_codigo_job,
    'projeto_financeiro_id', v_pf,
    'projeto_financeiro_novo', v_novo is not null and p_projeto_financeiro_id is null,
    'projeto_id', v_projeto,
    'orcamento_id', v_orc
  );
end;
$$;

revoke all on function public.criar_job_de_pagamentos(uuid, uuid, smallint, smallint, text, text, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.criar_job_de_pagamentos(uuid, uuid, smallint, smallint, text, text, uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. salvar_planilha_do_job_de_pagamentos: linhas e planejado sem errata
-- ---------------------------------------------------------------------------
-- p_conteudo = {
--   grupos:     [{chave, nome}],                         agrupamentos novos
--   linhas:     [{chave, grupo_id, item, linha_vermelha,
--                 valor_unitario_planejado, quantidade_planejada,
--                 dias_meses_planejado}],                  linhas novas
--   alteracoes: [{job_item_orcado_id, valor_unitario_planejado,
--                 quantidade_planejada, dias_meses_planejado}]
-- }
-- O orçado fica zero e o tipo é FI (o gatilho da seção 4 garante). A linha
-- vermelha continua sem planejado (chk_jio_linha_vermelha_zerada).
create or replace function public.salvar_planilha_do_job_de_pagamentos(
  p_job_id uuid,
  p_conteudo jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_papel   text := coalesce((select public.session_role())::text, '');
  v_job     record;
  v_ancora  uuid;
  v_g       jsonb;
  v_l       jsonb;
  v_a       jsonb;
  v_gid     uuid;
  v_id      uuid;
  v_ordem   integer;
  v_verm    boolean;
  v_pu      numeric;
  v_pq      numeric;
  v_pd      numeric;
  v_ids     jsonb := '{}'::jsonb;
  v_grupos  jsonb := '{}'::jsonb;
  v_novos   jsonb := coalesce(p_conteudo->'grupos', '[]'::jsonb);
  v_linhas  jsonb := coalesce(p_conteudo->'linhas', '[]'::jsonb);
  v_alts    jsonb := coalesce(p_conteudo->'alteracoes', '[]'::jsonb);
  v_mexidas integer := 0;
begin
  if v_uid is null then
    raise exception 'Sua sessão expirou. Entre de novo.' using errcode = '42501';
  end if;
  if v_papel not in ('administrador', 'gerente_producao', 'produtor') then
    raise exception 'Só o administrador, o GP ou o produtor mexe na planilha do job.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_novos) <> 'array' or jsonb_typeof(v_linhas) <> 'array' or jsonb_typeof(v_alts) <> 'array' then
    raise exception 'Pedido inválido.';
  end if;
  if jsonb_array_length(v_linhas) = 0 and jsonb_array_length(v_alts) = 0 then
    raise exception 'Nada mudou na planilha.';
  end if;

  select j.id, j.tenant_id, j.status, j.de_pagamentos, j.empresa_id, j.regional_id
    into v_job
    from public.jobs j
   where j.id = p_job_id
   for update;
  if not found or v_job.tenant_id not in (select public.current_tenant_ids()) then
    raise exception 'Job não encontrado.' using errcode = '42501';
  end if;
  if not v_job.de_pagamentos then
    raise exception 'Só o job de pagamentos salva a planilha sem errata.' using errcode = '42501';
  end if;
  if v_job.status not in ('aberto', 'em_producao') then
    raise exception 'A planilha só muda com o job em ''Aberto'' ou ''Em produção''.' using errcode = 'check_violation';
  end if;
  if not public.can_access_empresa_regional(v_uid, v_job.empresa_id, v_job.regional_id) then
    raise exception 'Você não tem acesso a este job.' using errcode = '42501';
  end if;

  -- A âncora dos agrupamentos novos: o agrupamento da versão (o job de
  -- pagamentos tem um só, "Pagamentos").
  select g.grupo_versao_id into v_ancora
    from public.jobs_grupos g
   where g.job_id = p_job_id
   order by g.ordem
   limit 1;

  -- ---- Agrupamentos novos ----
  select coalesce(max(g.ordem), 0) into v_ordem from public.jobs_grupos g where g.job_id = p_job_id;
  for v_g in select * from jsonb_array_elements(v_novos)
  loop
    if btrim(coalesce(v_g->>'nome', '')) = '' then
      raise exception 'O agrupamento novo precisa de um nome.';
    end if;
    if exists (
      select 1 from public.jobs_grupos g
       where g.job_id = p_job_id and g.removido_em is null
         and lower(btrim(g.nome)) = lower(btrim(v_g->>'nome'))
    ) then
      raise exception 'Já existe um agrupamento com esse nome neste job.';
    end if;
    v_ordem := v_ordem + 1;
    insert into public.jobs_grupos (tenant_id, job_id, grupo_versao_id, nome, ordem, criado_por)
    values (v_job.tenant_id, p_job_id, v_ancora, btrim(v_g->>'nome'), v_ordem, v_uid)
    returning id into v_gid;
    v_grupos := v_grupos || jsonb_build_object(v_g->>'chave', v_gid);
  end loop;

  -- ---- Linhas novas ----
  for v_l in select * from jsonb_array_elements(v_linhas)
  loop
    if btrim(coalesce(v_l->>'item', '')) = '' then
      raise exception 'Toda linha nova precisa de uma descrição.';
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
        raise exception 'O agrupamento da linha não é deste job. Recarregue a página.';
      end if;
    end if;

    v_verm := coalesce((v_l->>'linha_vermelha')::boolean, false);
    v_pu := case when v_verm then 0 else coalesce((v_l->>'valor_unitario_planejado')::numeric, 0) end;
    v_pq := case when v_verm then 0 else coalesce((v_l->>'quantidade_planejada')::numeric, 0) end;
    v_pd := case when v_verm then 0 else coalesce((v_l->>'dias_meses_planejado')::numeric, 0) end;
    if v_pu < 0 or v_pq < 0 or v_pd < 0 then
      raise exception 'O planejado não pode ser negativo.' using errcode = 'check_violation';
    end if;

    select coalesce(max(o.ordem), 0) + 1 into v_ordem
      from public.jobs_itens_orcado o
     where o.job_id = p_job_id and o.job_grupo_id = v_gid;

    insert into public.jobs_itens_orcado (
      tenant_id, job_id, item_versao_id, errata_origem_id, linha_vermelha, criada_por,
      job_grupo_id, grupo_id, ordem, item, tipo_custo,
      valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
      valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
    ) values (
      v_job.tenant_id, p_job_id, null, null, v_verm, v_uid,
      v_gid,
      (select g.grupo_versao_id from public.jobs_grupos g where g.id = v_gid),
      v_ordem, btrim(v_l->>'item'), 'FI',
      0, 1, 1,
      v_pu, v_pq, v_pd
    )
    returning id into v_id;

    insert into public.jobs_itens_realizado (
      tenant_id, job_id, item_id, job_item_orcado_id,
      valor_unitario_realizado, quantidade_realizada, dias_meses_realizado, created_by
    ) values (
      v_job.tenant_id, p_job_id, null, v_id, 0, 0, 0, v_uid
    );

    v_ids := v_ids || jsonb_build_object(coalesce(v_l->>'chave', v_id::text), v_id);
  end loop;

  -- ---- Planejado das linhas que já existem ----
  for v_a in select * from jsonb_array_elements(v_alts)
  loop
    v_pu := coalesce((v_a->>'valor_unitario_planejado')::numeric, 0);
    v_pq := coalesce((v_a->>'quantidade_planejada')::numeric, 0);
    v_pd := coalesce((v_a->>'dias_meses_planejado')::numeric, 0);
    if v_pu < 0 or v_pq < 0 or v_pd < 0 then
      raise exception 'O planejado não pode ser negativo.' using errcode = 'check_violation';
    end if;
    update public.jobs_itens_orcado o
       set valor_unitario_planejado = v_pu,
           quantidade_planejada     = v_pq,
           dias_meses_planejado     = v_pd,
           updated_at               = now()
     where o.id = nullif(v_a->>'job_item_orcado_id', '')::uuid
       and o.job_id = p_job_id
       and not o.linha_vermelha
       and o.cancelada_em is null
       and not o.em_save;
    if not found then
      raise exception 'Uma das linhas não pode ter o planejado alterado. Recarregue a página.';
    end if;
    v_mexidas := v_mexidas + 1;
  end loop;

  return v_ids || jsonb_build_object('grupos', v_grupos, 'alteradas', v_mexidas);
end;
$$;

revoke all on function public.salvar_planilha_do_job_de_pagamentos(uuid, jsonb) from public, anon;
grant execute on function public.salvar_planilha_do_job_de_pagamentos(uuid, jsonb) to authenticated;
