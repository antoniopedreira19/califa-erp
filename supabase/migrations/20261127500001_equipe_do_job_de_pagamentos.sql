-- Decisão 282 — A equipe do job de pagamentos (27/11/2026)
--
-- Feedback da produção sobre os jobs de pagamentos (decisão 266): ninguém
-- administra a equipe e ninguém, fora o GP de papel, envia a PP. O caso
-- real: os quatro jobs "Pagamentos Atrasados" (CAL-1004 a 1007) dividem o
-- mesmo projeto escondido e, por isso, uma equipe só. Protótipo v10
-- aprovado pelo Tiago em 27/11/2026 ("B · De cada job", botão "+" com
-- lista para marcar, chave "Envia PP" por produtor):
--
--   * a equipe é de CADA job de pagamentos, e não mais do projeto escondido
--     (um por projeto unificado) — tabela nova `jobs_equipe_de_pagamentos`;
--   * cada produtor da equipe tem a chave "Envia PP": ligada, ele envia a PP
--     ao financeiro como o GP (decisão 136) e como o Produtor Responsável com
--     a chave (decisão 174). Pode ser mais de um. GP e administrador enviam
--     sempre (o papel); freelancer gera PP e não envia;
--   * quem muda a equipe: o administrador, o financeiro, os GPs e os
--     produtores (e quem criou o job). Pelo Equipe da página do job, no
--     módulo Jobs e no Financeiro, e já no formulário de criação.
--
-- A equipe do projeto escondido (`projeto_responsaveis`, papel `equipe`)
-- continua existindo e passa a ser a SOMA das equipes dos jobs vivos dele,
-- gravada pela mesma função. É ela que a RLS do freelancer
-- (`is_freelancer_do_projeto`) e o "Meus" da lista de Jobs e da Home leem:
-- assim nada disso muda. O projeto escondido é do job de pagamentos (só a
-- função `criar_job_de_pagamentos` o cria), então a função só reescreve a
-- equipe de projetos `de_pagamentos`.
--
-- O que já existe: a equipe atual dos projetos escondidos (no dia, uma
-- produtora no P-0182/26, dos quatro jobs reais) é copiada para cada job
-- dele, com a chave DESLIGADA — liga-se pelo Equipe. Nada é apagado.
--
-- Tudo é aditivo: tabela nova, funções novas, a `produtor_envia_pp_do_job`
-- com um ramo a mais (o resto igual) e a `criar_job_de_pagamentos` com um
-- parâmetro a mais, opcional, no fim (o corpo igual até o retorno). A
-- tabela só se escreve pelas funções: GRANT de select para `authenticated`,
-- nada para `anon`.

-- ---------------------------------------------------------------------------
-- 1. A tabela
-- ---------------------------------------------------------------------------
create table public.jobs_equipe_de_pagamentos (
  job_id       uuid        not null references public.jobs(id) on delete cascade,
  profile_id   uuid        not null references public.profiles(id) on delete restrict,
  tenant_id    uuid        not null references public.tenants(id) on delete restrict,
  envia_pp     boolean     not null default false,
  incluido_por uuid        references public.profiles(id) on delete set null,
  incluido_em  timestamptz not null default now(),
  primary key (job_id, profile_id)
);

comment on table public.jobs_equipe_de_pagamentos is
  'Decisão 282: a equipe de cada job de pagamentos e a chave "Envia PP" de cada produtor. Escreve-se só por salvar_equipe_do_job_de_pagamentos e criar_job_de_pagamentos.';

create index idx_jobs_equipe_de_pagamentos_profile on public.jobs_equipe_de_pagamentos (profile_id);
create index idx_jobs_equipe_de_pagamentos_tenant on public.jobs_equipe_de_pagamentos (tenant_id);
create index idx_jobs_equipe_de_pagamentos_incluido_por on public.jobs_equipe_de_pagamentos (incluido_por)
  where incluido_por is not null;

alter table public.jobs_equipe_de_pagamentos enable row level security;

-- Leitura como a da equipe do projeto (`projeto_responsaveis_select`): todo
-- membro do tenant. Sem policy de escrita: só as funções gravam.
create policy jobs_equipe_de_pagamentos_select on public.jobs_equipe_de_pagamentos
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

revoke all on public.jobs_equipe_de_pagamentos from public, anon, authenticated;
grant select on public.jobs_equipe_de_pagamentos to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Gravar a equipe (interna: sem checar quem chama)
-- ---------------------------------------------------------------------------
-- `p_membros`: [{ "profile_id": uuid, "envia_pp": boolean }]. Quem entra
-- precisa ser membro ativo da produção (administrador, GP, produtor ou
-- freelancer); quem já estava e saiu do tenant pode continuar. A chave só
-- fica ligada para quem tem o papel de produtor.
create or replace function public._gravar_equipe_do_job_de_pagamentos(
  p_job_id  uuid,
  p_membros jsonb,
  p_uid     uuid
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenant  uuid;
  v_projeto uuid;
  v_membros jsonb := coalesce(p_membros, '[]'::jsonb);
begin
  select j.tenant_id, j.projeto_id
    into v_tenant, v_projeto
    from public.jobs j
   where j.id = p_job_id and j.de_pagamentos;
  if v_tenant is null then
    raise exception 'Job de pagamentos não encontrado.' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(v_membros) <> 'array' then
    raise exception 'A equipe veio num formato inválido. Recarregue a página.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_membros) > 200 then
    raise exception 'A equipe passou de 200 pessoas.' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_membros) e
     where jsonb_typeof(e.value) <> 'object'
        or coalesce(e.value->>'profile_id', '') !~ '^[0-9a-fA-F-]{36}$'
  ) then
    raise exception 'A equipe veio num formato inválido. Recarregue a página.' using errcode = 'check_violation';
  end if;

  -- Quem entra agora precisa estar ativo e ser da produção.
  if exists (
    select 1
      from jsonb_array_elements(v_membros) e
     where not exists (
             select 1 from public.jobs_equipe_de_pagamentos x
              where x.job_id = p_job_id and x.profile_id = (e.value->>'profile_id')::uuid)
       and not exists (
             select 1 from public.tenant_members tm
              where tm.tenant_id = v_tenant
                and tm.user_id = (e.value->>'profile_id')::uuid
                and tm.status = 'ativo'
                and tm.role in ('administrador', 'gerente_producao', 'produtor', 'freelancer'))
  ) then
    raise exception 'Só entra na equipe quem é da produção e está ativo. Recarregue a página.'
      using errcode = 'check_violation';
  end if;

  delete from public.jobs_equipe_de_pagamentos x
   where x.job_id = p_job_id
     and not exists (
           select 1 from jsonb_array_elements(v_membros) e
            where (e.value->>'profile_id')::uuid = x.profile_id);

  insert into public.jobs_equipe_de_pagamentos (job_id, profile_id, tenant_id, envia_pp, incluido_por)
  select p_job_id,
         m.profile_id,
         v_tenant,
         m.envia_pp and exists (
           select 1 from public.tenant_members tm
            where tm.tenant_id = v_tenant and tm.user_id = m.profile_id
              and tm.status = 'ativo' and tm.role = 'produtor'),
         p_uid
    from (
      select distinct on ((e.value->>'profile_id')::uuid)
             (e.value->>'profile_id')::uuid as profile_id,
             coalesce((e.value->>'envia_pp')::boolean, false) as envia_pp
        from jsonb_array_elements(v_membros) e
    ) m
  on conflict (job_id, profile_id) do update
     set envia_pp = excluded.envia_pp
   where public.jobs_equipe_de_pagamentos.envia_pp is distinct from excluded.envia_pp;

  -- A equipe do projeto escondido = a soma das equipes dos jobs vivos dele.
  -- Só o papel `equipe` (o `gp` do projeto, se houver, fica como está).
  delete from public.projeto_responsaveis pr
   where pr.projeto_id = v_projeto
     and pr.papel = 'equipe'
     and exists (select 1 from public.projetos p where p.id = v_projeto and p.de_pagamentos)
     and not exists (
           select 1
             from public.jobs_equipe_de_pagamentos x
             join public.jobs j on j.id = x.job_id
            where j.projeto_id = v_projeto
              and j.status <> 'cancelado'
              and x.profile_id = pr.profile_id);

  insert into public.projeto_responsaveis (projeto_id, profile_id, tenant_id, papel)
  select distinct v_projeto, x.profile_id, v_tenant, 'equipe'::public.papel_projeto
    from public.jobs_equipe_de_pagamentos x
    join public.jobs j on j.id = x.job_id
    join public.projetos p on p.id = j.projeto_id and p.de_pagamentos
   where j.projeto_id = v_projeto
     and j.status <> 'cancelado'
  on conflict (projeto_id, profile_id) do nothing;
end;
$$;

revoke all on function public._gravar_equipe_do_job_de_pagamentos(uuid, jsonb, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. O "Salvar" do Equipe
-- ---------------------------------------------------------------------------
create or replace function public.salvar_equipe_do_job_de_pagamentos(
  p_job_id  uuid,
  p_membros jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_papel   text := coalesce((select public.session_role())::text, '');
  v_tenant  uuid;
  v_status  text;
  v_criador uuid;
begin
  if v_uid is null then
    raise exception 'Sua sessão expirou. Entre de novo.' using errcode = '42501';
  end if;

  select j.tenant_id, j.status::text, j.created_by
    into v_tenant, v_status, v_criador
    from public.jobs j
   where j.id = p_job_id and j.de_pagamentos;
  if v_tenant is null or v_tenant not in (select public.current_tenant_ids()) then
    raise exception 'Job de pagamentos não encontrado.' using errcode = '42501';
  end if;
  if not (
    v_papel in ('administrador', 'financeiro', 'gerente_producao', 'produtor')
    or v_criador = v_uid
  ) then
    raise exception 'Seu papel não muda a equipe deste job.' using errcode = '42501';
  end if;
  if v_status in ('encerrado', 'finalizado', 'cancelado') then
    raise exception 'O job está encerrado: a equipe não muda mais.' using errcode = 'check_violation';
  end if;

  perform public._gravar_equipe_do_job_de_pagamentos(p_job_id, p_membros, v_uid);
end;
$$;

revoke all on function public.salvar_equipe_do_job_de_pagamentos(uuid, jsonb) from public, anon;
grant execute on function public.salvar_equipe_do_job_de_pagamentos(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Quem envia PP: o Produtor Responsável com a chave (decisão 174) ou,
--    no job de pagamentos, o produtor da equipe com a chave (282)
-- ---------------------------------------------------------------------------
-- Mesma definição de antes, com o segundo `exists`. Todas as policies e
-- funções que já chamam esta (PP, anexos, prestação da verba, correção da
-- NF) passam a tratar esse produtor como tratam o Produtor Responsável.
create or replace function public.produtor_envia_pp_do_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
      from public.jobs j
     where j.id = p_job_id
       and j.produtor_envia_pp
       and j.produtor_id = (select auth.uid())
       and public.is_tenant_member(j.tenant_id)
  )
  or exists (
    select 1
      from public.jobs_equipe_de_pagamentos x
      join public.jobs j on j.id = x.job_id
     where x.job_id = p_job_id
       and x.profile_id = (select auth.uid())
       and x.envia_pp
       and j.de_pagamentos
       and public.is_tenant_member(j.tenant_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. A equipe já no formulário de criação
-- ---------------------------------------------------------------------------
-- O mesmo corpo de 20261118700001, com `p_equipe` (opcional, no fim) gravado
-- na mesma transação antes do retorno. A assinatura muda, então a antiga sai
-- e a nova entra com as mesmas permissões. Quem chama pelos nomes dos
-- parâmetros (a action) continua funcionando sem o `p_equipe`.
drop function public.criar_job_de_pagamentos(uuid, uuid, smallint, smallint, text, text, uuid, text, text, text, text, text);

create function public.criar_job_de_pagamentos(
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
  p_codigo_orcamento text,
  p_equipe jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  -- Decisão 282: a equipe escolhida no formulário.
  if p_equipe is not null and jsonb_typeof(p_equipe) = 'array' and jsonb_array_length(p_equipe) > 0 then
    perform public._gravar_equipe_do_job_de_pagamentos(v_job, p_equipe, v_uid);
  end if;

  return jsonb_build_object(
    'job_id', v_job,
    'codigo', p_codigo_job,
    'projeto_financeiro_id', v_pf,
    'projeto_financeiro_novo', v_novo is not null and p_projeto_financeiro_id is null,
    'projeto_id', v_projeto,
    'orcamento_id', v_orc
  );
end;
$function$;

revoke all on function public.criar_job_de_pagamentos(uuid, uuid, smallint, smallint, text, text, uuid, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.criar_job_de_pagamentos(uuid, uuid, smallint, smallint, text, text, uuid, text, text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. O que já existe: a equipe do projeto escondido vai para cada job dele
-- ---------------------------------------------------------------------------
-- Com a chave desligada: ninguém passa a enviar PP sem alguém ligar.
insert into public.jobs_equipe_de_pagamentos (job_id, profile_id, tenant_id, envia_pp, incluido_por, incluido_em)
select j.id, pr.profile_id, j.tenant_id, false, null, pr.created_at
  from public.jobs j
  join public.projetos p on p.id = j.projeto_id and p.de_pagamentos
  join public.projeto_responsaveis pr on pr.projeto_id = j.projeto_id and pr.papel = 'equipe'
 where j.de_pagamentos
   and j.status <> 'cancelado'
on conflict (job_id, profile_id) do nothing;

notify pgrst, 'reload schema';
