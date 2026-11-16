-- =====================================================================
-- Perfil do colaborador — dados complementares + documentos
-- =====================================================================
--
-- Toda pessoa que acessa o sistema (tem user_id em colaboradores, status
-- ativo e tipo_contratacao != 'socio') precisa preencher um perfil
-- completo antes de deixar de ver o modal de boas-vindas.
--
-- Esta migration:
--
-- 1. Enums novos pros campos categóricos (estado civil, tamanho de
--    camiseta, etnia, gênero, orientação, PCD, tipo de documento).
--
-- 2. Colunas novas em `colaboradores` pra dados complementares que a
--    planilha "Boas-vindas à California" já coletava via Google Forms:
--    nome_preferido, cidade_origem, estado_civil, possui_filhos,
--    vegetariano, restricao_alimentar, contato de emergência, hobbies,
--    curiosidade, tamanho_camiseta, diversidade e saúde.
--
-- 3. `perfil_completado_em` — a "chave" que desliga o modal. Enquanto
--    NULL, o modal aparece em toda sessão nova. Ao gravar, nunca mais.
--
-- 4. Tabela nova `colaboradores_documentos` — upload de documentos
--    pessoais (RG, CPF, CNPJ, CCMEI, comprovante de residência, PIS,
--    CTPS, título de eleitor, foto). Metadado aqui, arquivo no bucket.
--
-- 5. Bucket novo `colaboradores-documentos` (privado) com RLS:
--    - RH/admin leem e escrevem tudo do tenant.
--    - Colaborador lê e escreve só a sua própria pasta.
--    - Path: {tenant_id}/{colaborador_id}/{tipo}/{uuid}-{nome}
--
-- 6. RPCs SECURITY DEFINER:
--    - `atualizar_meu_perfil_colaborador(...)` — colaborador edita os
--      campos permitidos do próprio cadastro. RLS de colaboradores
--      continua fechada pra UPDATE do colaborador comum; quem pode
--      salvar é a RPC, com whitelist de campos.
--    - `completar_meu_perfil_colaborador()` — valida tudo preenchido
--      (campos + documentos conforme tipo_contratacao) e marca
--      perfil_completado_em = now(). Idempotente — se já completou,
--      não faz nada.
--
-- Campos sensíveis (etnia, gênero, orientação, PCD, saúde) aceitam
-- `prefiro_nao_informar` como valor válido; na lógica de completude
-- isso conta como preenchido.
--
-- Sócios (tipo_contratacao = 'socio') não veem o modal — a UI filtra.
-- Nada na migration bloqueia o sócio de usar as RPCs; a lógica é só na
-- camada de apresentação, decisão combinada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------

create type public.estado_civil as enum (
  'solteiro',
  'casado',
  'uniao_estavel',
  'divorciado',
  'viuvo',
  'separado'
);

create type public.tamanho_camiseta as enum (
  'pp', 'p', 'm', 'g', 'gg', 'xg', 'xxg'
);

create type public.etnia as enum (
  'branca',
  'preta',
  'parda',
  'amarela',
  'indigena',
  'prefiro_nao_informar'
);

create type public.genero_identidade as enum (
  'mulher_cis',
  'mulher_trans',
  'homem_cis',
  'homem_trans',
  'nao_binario',
  'outro',
  'prefiro_nao_informar'
);

create type public.orientacao_sexual as enum (
  'heterossexual',
  'homossexual',
  'bissexual',
  'assexual',
  'pansexual',
  'outro',
  'prefiro_nao_informar'
);

create type public.pcd_opcao as enum (
  'nao',
  'sim',
  'prefiro_nao_informar'
);

create type public.colaborador_documento_tipo as enum (
  'foto',
  'cnpj',
  'ccmei',
  'rg_cnh',
  'cpf',
  'comprovante_residencia',
  'pis',
  'ctps',
  'titulo_eleitor',
  'outro'
);

-- ---------------------------------------------------------------------
-- 2. COLUNAS NOVAS em `colaboradores`
-- ---------------------------------------------------------------------

alter table public.colaboradores
  add column if not exists nome_preferido        text,
  add column if not exists cidade_origem         text,
  add column if not exists estado_civil          public.estado_civil,
  add column if not exists possui_filhos         boolean,
  add column if not exists vegetariano           boolean,
  add column if not exists restricao_alimentar   text,
  add column if not exists emergencia_nome       text,
  add column if not exists emergencia_parentesco text,
  add column if not exists emergencia_telefone   text,
  add column if not exists hobbies               text,
  add column if not exists curiosidade           text,
  add column if not exists tamanho_camiseta      public.tamanho_camiseta,
  add column if not exists etnia                 public.etnia,
  add column if not exists genero_identidade     public.genero_identidade,
  add column if not exists orientacao_sexual     public.orientacao_sexual,
  add column if not exists pcd                   public.pcd_opcao,
  add column if not exists pcd_descricao         text,
  add column if not exists observacao_saude      text,
  add column if not exists foto_path             text,
  add column if not exists perfil_completado_em  timestamptz;

comment on column public.colaboradores.nome_preferido is
  'Como gosta de ser chamado (apelido / nome social). Usado na UI em vez do nome formal quando preenchido.';
comment on column public.colaboradores.cidade_origem is
  'Cidade de onde o colaborador é (≠ endereço residencial atual).';
comment on column public.colaboradores.possui_filhos is
  'Flag sim/não. Dados dos filhos continuam em `dependentes`.';
comment on column public.colaboradores.pcd is
  'Pessoa com Deficiência: nao / sim / prefiro_nao_informar. Quando sim, usa `pcd_descricao` pro texto livre.';
comment on column public.colaboradores.foto_path is
  'Path do arquivo de foto no bucket `colaboradores-documentos`. Atalho — a linha também existe em `colaboradores_documentos` com tipo=foto.';
comment on column public.colaboradores.perfil_completado_em is
  'Timestamp de quando o colaborador completou o perfil pela primeira vez via wizard de boas-vindas. Enquanto NULL, o modal aparece em toda sessão nova.';

-- ---------------------------------------------------------------------
-- 3. TABELA `colaboradores_documentos`
-- ---------------------------------------------------------------------

create table if not exists public.colaboradores_documentos (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  colaborador_id         uuid not null references public.colaboradores(id) on delete cascade,
  tipo                   public.colaborador_documento_tipo not null,
  arquivo_path           text not null,
  arquivo_nome           text not null,
  arquivo_tamanho_bytes  integer,
  mime_type              text,
  uploaded_by            uuid references auth.users(id),
  uploaded_at            timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists colaboradores_documentos_colaborador_idx
  on public.colaboradores_documentos (colaborador_id);
create index if not exists colaboradores_documentos_tenant_idx
  on public.colaboradores_documentos (tenant_id);
create index if not exists colaboradores_documentos_tipo_idx
  on public.colaboradores_documentos (colaborador_id, tipo);

comment on table public.colaboradores_documentos is
  'Documentos pessoais anexados pelo colaborador (RG, CPF, CNPJ, CCMEI, comprovante, PIS, CTPS, título, foto). Metadado aqui, arquivo no bucket `colaboradores-documentos`. Vários por tipo (RG frente+verso, CTPS multi-página).';

alter table public.colaboradores_documentos enable row level security;

grant select, insert, delete on public.colaboradores_documentos to authenticated;

-- Função helper: o colaborador autenticado é dono deste id?
create or replace function public.colaborador_eh_do_usuario_logado(p_colaborador_id uuid)
  returns boolean
  language sql
  stable security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.colaboradores
    where id = p_colaborador_id
      and user_id = (select auth.uid())
  );
$$;

grant execute on function public.colaborador_eh_do_usuario_logado(uuid) to authenticated;

-- SELECT: RH/admin do tenant OU dono
create policy colaboradores_documentos_select
  on public.colaboradores_documentos for select
  to authenticated
  using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or colaborador_eh_do_usuario_logado(colaborador_id)
  );

-- INSERT: RH/admin OU dono
create policy colaboradores_documentos_insert
  on public.colaboradores_documentos for insert
  to authenticated
  with check (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or colaborador_eh_do_usuario_logado(colaborador_id)
  );

-- DELETE: RH/admin OU dono
create policy colaboradores_documentos_delete
  on public.colaboradores_documentos for delete
  to authenticated
  using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or colaborador_eh_do_usuario_logado(colaborador_id)
  );

-- ---------------------------------------------------------------------
-- 4. BUCKET `colaboradores-documentos` + storage policies
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('colaboradores-documentos', 'colaboradores-documentos', false)
on conflict (id) do nothing;

-- Helper: dado um caminho {tenant}/{colaborador}/..., devolve se o
-- auth.uid() atual é o user_id do colaborador da pasta. Retorna false
-- quando o segmento não é uuid válido ou o colaborador não existe —
-- evita que pasta fora do padrão derrube a listagem do bucket
-- (mesmo problema do incidente de 19/10/2026 em pedidos-compra).
create or replace function public.colaborador_do_path_eh_do_usuario(p_path text)
  returns boolean
  language plpgsql
  stable security definer
  set search_path = public, storage
as $$
declare
  v_segmentos text[];
  v_colab_id  uuid;
begin
  v_segmentos := storage.foldername(p_path);
  if array_length(v_segmentos, 1) < 2 then
    return false;
  end if;
  begin
    v_colab_id := v_segmentos[2]::uuid;
  exception when others then
    return false;
  end;
  return exists (
    select 1 from public.colaboradores
    where id = v_colab_id
      and user_id = (select auth.uid())
  );
end;
$$;

grant execute on function public.colaborador_do_path_eh_do_usuario(text) to authenticated;

create policy colaboradores_documentos_storage_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'colaboradores-documentos'
    and (
      coalesce(is_tenant_admin(public.tenant_do_caminho_no_storage(name)), false)
      or coalesce(is_tenant_rh(public.tenant_do_caminho_no_storage(name)), false)
      or colaborador_do_path_eh_do_usuario(name)
    )
  );

create policy colaboradores_documentos_storage_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'colaboradores-documentos'
    and (
      coalesce(is_tenant_admin(public.tenant_do_caminho_no_storage(name)), false)
      or coalesce(is_tenant_rh(public.tenant_do_caminho_no_storage(name)), false)
      or colaborador_do_path_eh_do_usuario(name)
    )
  );

create policy colaboradores_documentos_storage_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'colaboradores-documentos'
    and (
      coalesce(is_tenant_admin(public.tenant_do_caminho_no_storage(name)), false)
      or coalesce(is_tenant_rh(public.tenant_do_caminho_no_storage(name)), false)
      or colaborador_do_path_eh_do_usuario(name)
    )
  );

-- ---------------------------------------------------------------------
-- 5. RPC: atualizar_meu_perfil_colaborador
-- ---------------------------------------------------------------------
--
-- Whitelist de campos editáveis pelo colaborador. Qualquer outro campo
-- (status, tipo_contratacao, nivel, data_admissao, lider_id, email
-- corporativo) continua só pra RH/admin.
--
-- Parâmetros opcionais: se p_definir_X for true, o campo é atualizado
-- (inclusive pra null). Se false, mantém o valor atual. Isso permite
-- "limpar" um campo (ex: pessoa deixou de ser vegetariana).
-- ---------------------------------------------------------------------

create or replace function public.atualizar_meu_perfil_colaborador(
  p_dados jsonb
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_colab_id uuid;
begin
  -- Identifica o colaborador do usuário logado.
  select id into v_colab_id
  from public.colaboradores
  where user_id = (select auth.uid())
    and status = 'ativo';

  if v_colab_id is null then
    raise exception 'usuario_sem_colaborador'
      using errcode = '42501';
  end if;

  -- Atualiza cada campo apenas se a chave existir no JSON (permite
  -- null explícito pra limpar).
  update public.colaboradores set
    nome_preferido = case when p_dados ? 'nome_preferido'
      then nullif(trim(p_dados->>'nome_preferido'), '') else nome_preferido end,
    cidade_origem = case when p_dados ? 'cidade_origem'
      then nullif(trim(p_dados->>'cidade_origem'), '') else cidade_origem end,
    estado_civil = case when p_dados ? 'estado_civil'
      then nullif(p_dados->>'estado_civil', '')::public.estado_civil else estado_civil end,
    possui_filhos = case when p_dados ? 'possui_filhos'
      then (p_dados->>'possui_filhos')::boolean else possui_filhos end,
    vegetariano = case when p_dados ? 'vegetariano'
      then (p_dados->>'vegetariano')::boolean else vegetariano end,
    restricao_alimentar = case when p_dados ? 'restricao_alimentar'
      then nullif(trim(p_dados->>'restricao_alimentar'), '') else restricao_alimentar end,
    emergencia_nome = case when p_dados ? 'emergencia_nome'
      then nullif(trim(p_dados->>'emergencia_nome'), '') else emergencia_nome end,
    emergencia_parentesco = case when p_dados ? 'emergencia_parentesco'
      then nullif(trim(p_dados->>'emergencia_parentesco'), '') else emergencia_parentesco end,
    emergencia_telefone = case when p_dados ? 'emergencia_telefone'
      then nullif(trim(p_dados->>'emergencia_telefone'), '') else emergencia_telefone end,
    hobbies = case when p_dados ? 'hobbies'
      then nullif(trim(p_dados->>'hobbies'), '') else hobbies end,
    curiosidade = case when p_dados ? 'curiosidade'
      then nullif(trim(p_dados->>'curiosidade'), '') else curiosidade end,
    tamanho_camiseta = case when p_dados ? 'tamanho_camiseta'
      then nullif(p_dados->>'tamanho_camiseta', '')::public.tamanho_camiseta else tamanho_camiseta end,
    etnia = case when p_dados ? 'etnia'
      then nullif(p_dados->>'etnia', '')::public.etnia else etnia end,
    genero_identidade = case when p_dados ? 'genero_identidade'
      then nullif(p_dados->>'genero_identidade', '')::public.genero_identidade else genero_identidade end,
    orientacao_sexual = case when p_dados ? 'orientacao_sexual'
      then nullif(p_dados->>'orientacao_sexual', '')::public.orientacao_sexual else orientacao_sexual end,
    pcd = case when p_dados ? 'pcd'
      then nullif(p_dados->>'pcd', '')::public.pcd_opcao else pcd end,
    pcd_descricao = case when p_dados ? 'pcd_descricao'
      then nullif(trim(p_dados->>'pcd_descricao'), '') else pcd_descricao end,
    observacao_saude = case when p_dados ? 'observacao_saude'
      then nullif(trim(p_dados->>'observacao_saude'), '') else observacao_saude end,
    foto_path = case when p_dados ? 'foto_path'
      then nullif(trim(p_dados->>'foto_path'), '') else foto_path end,
    -- Campos que ele também preenche (já existiam no cadastro).
    email_pessoal = case when p_dados ? 'email_pessoal'
      then nullif(trim(p_dados->>'email_pessoal'), '') else email_pessoal end,
    telefone = case when p_dados ? 'telefone'
      then nullif(trim(p_dados->>'telefone'), '') else telefone end,
    data_nascimento = case when p_dados ? 'data_nascimento'
      then nullif(p_dados->>'data_nascimento', '')::date else data_nascimento end,
    rg = case when p_dados ? 'rg'
      then nullif(trim(p_dados->>'rg'), '') else rg end,
    cpf = case when p_dados ? 'cpf'
      then nullif(trim(p_dados->>'cpf'), '') else cpf end,
    cnpj = case when p_dados ? 'cnpj'
      then nullif(trim(p_dados->>'cnpj'), '') else cnpj end,
    razao_social = case when p_dados ? 'razao_social'
      then nullif(trim(p_dados->>'razao_social'), '') else razao_social end,
    pj_natureza = case when p_dados ? 'pj_natureza'
      then nullif(p_dados->>'pj_natureza', '')::public.pj_natureza else pj_natureza end,
    cep = case when p_dados ? 'cep'
      then nullif(trim(p_dados->>'cep'), '') else cep end,
    logradouro = case when p_dados ? 'logradouro'
      then nullif(trim(p_dados->>'logradouro'), '') else logradouro end,
    numero = case when p_dados ? 'numero'
      then nullif(trim(p_dados->>'numero'), '') else numero end,
    complemento = case when p_dados ? 'complemento'
      then nullif(trim(p_dados->>'complemento'), '') else complemento end,
    bairro = case when p_dados ? 'bairro'
      then nullif(trim(p_dados->>'bairro'), '') else bairro end,
    cidade = case when p_dados ? 'cidade'
      then nullif(trim(p_dados->>'cidade'), '') else cidade end,
    uf = case when p_dados ? 'uf'
      then nullif(trim(p_dados->>'uf'), '') else uf end,
    banco_codigo = case when p_dados ? 'banco_codigo'
      then nullif(trim(p_dados->>'banco_codigo'), '') else banco_codigo end,
    banco_nome = case when p_dados ? 'banco_nome'
      then nullif(trim(p_dados->>'banco_nome'), '') else banco_nome end,
    agencia = case when p_dados ? 'agencia'
      then nullif(trim(p_dados->>'agencia'), '') else agencia end,
    agencia_dv = case when p_dados ? 'agencia_dv'
      then nullif(trim(p_dados->>'agencia_dv'), '') else agencia_dv end,
    conta = case when p_dados ? 'conta'
      then nullif(trim(p_dados->>'conta'), '') else conta end,
    conta_dv = case when p_dados ? 'conta_dv'
      then nullif(trim(p_dados->>'conta_dv'), '') else conta_dv end,
    tipo_conta = case when p_dados ? 'tipo_conta'
      then nullif(p_dados->>'tipo_conta', '')::public.tipo_conta_bancaria else tipo_conta end,
    pix_tipo = case when p_dados ? 'pix_tipo'
      then nullif(p_dados->>'pix_tipo', '')::public.pix_tipo_chave else pix_tipo end,
    pix_chave = case when p_dados ? 'pix_chave'
      then nullif(trim(p_dados->>'pix_chave'), '') else pix_chave end,
    updated_at = now()
  where id = v_colab_id;
end;
$$;

grant execute on function public.atualizar_meu_perfil_colaborador(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 6. RPC: completar_meu_perfil_colaborador
-- ---------------------------------------------------------------------
--
-- Valida que todos os campos obrigatórios estão preenchidos e que todos
-- os documentos obrigatórios conforme tipo_contratacao estão lá.
-- Marca perfil_completado_em = now().
--
-- Sócio não é bloqueado aqui (filtro é na UI), mas na prática ele não
-- chega a chamar essa função porque o modal não aparece pra ele.
-- ---------------------------------------------------------------------

create or replace function public.completar_meu_perfil_colaborador()
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_c public.colaboradores%rowtype;
  v_docs_obrigatorios public.colaborador_documento_tipo[];
  v_tipo public.colaborador_documento_tipo;
  v_pendentes text[] := '{}';
  v_doc_pendentes text[] := '{}';
begin
  select * into v_c
  from public.colaboradores
  where user_id = (select auth.uid())
    and status = 'ativo';

  if v_c.id is null then
    raise exception 'usuario_sem_colaborador'
      using errcode = '42501';
  end if;

  if v_c.perfil_completado_em is not null then
    return;  -- idempotente
  end if;

  -- Campos obrigatórios pra todos.
  if nullif(trim(v_c.nome_preferido), '') is null then v_pendentes := v_pendentes || 'nome_preferido'; end if;
  if v_c.data_nascimento is null                     then v_pendentes := v_pendentes || 'data_nascimento'; end if;
  if nullif(trim(v_c.cidade_origem), '') is null     then v_pendentes := v_pendentes || 'cidade_origem'; end if;
  if v_c.estado_civil is null                        then v_pendentes := v_pendentes || 'estado_civil'; end if;
  if v_c.possui_filhos is null                       then v_pendentes := v_pendentes || 'possui_filhos'; end if;
  if v_c.tamanho_camiseta is null                    then v_pendentes := v_pendentes || 'tamanho_camiseta'; end if;
  if nullif(trim(v_c.telefone), '') is null          then v_pendentes := v_pendentes || 'telefone'; end if;
  if nullif(trim(v_c.rg), '') is null                then v_pendentes := v_pendentes || 'rg'; end if;
  if nullif(trim(v_c.cpf), '') is null               then v_pendentes := v_pendentes || 'cpf'; end if;
  if nullif(trim(v_c.cep), '') is null               then v_pendentes := v_pendentes || 'cep'; end if;
  if nullif(trim(v_c.logradouro), '') is null        then v_pendentes := v_pendentes || 'logradouro'; end if;
  if nullif(trim(v_c.numero), '') is null            then v_pendentes := v_pendentes || 'numero'; end if;
  if nullif(trim(v_c.bairro), '') is null            then v_pendentes := v_pendentes || 'bairro'; end if;
  if nullif(trim(v_c.cidade), '') is null            then v_pendentes := v_pendentes || 'cidade'; end if;
  if nullif(trim(v_c.uf), '') is null                then v_pendentes := v_pendentes || 'uf'; end if;
  if nullif(trim(v_c.banco_codigo), '') is null      then v_pendentes := v_pendentes || 'banco_codigo'; end if;
  if nullif(trim(v_c.agencia), '') is null           then v_pendentes := v_pendentes || 'agencia'; end if;
  if nullif(trim(v_c.conta), '') is null             then v_pendentes := v_pendentes || 'conta'; end if;
  if v_c.tipo_conta is null                          then v_pendentes := v_pendentes || 'tipo_conta'; end if;
  if v_c.pix_tipo is null                            then v_pendentes := v_pendentes || 'pix_tipo'; end if;
  if nullif(trim(v_c.pix_chave), '') is null         then v_pendentes := v_pendentes || 'pix_chave'; end if;
  if v_c.vegetariano is null                         then v_pendentes := v_pendentes || 'vegetariano'; end if;
  if v_c.etnia is null                               then v_pendentes := v_pendentes || 'etnia'; end if;
  if v_c.genero_identidade is null                   then v_pendentes := v_pendentes || 'genero_identidade'; end if;
  if v_c.orientacao_sexual is null                   then v_pendentes := v_pendentes || 'orientacao_sexual'; end if;
  if v_c.pcd is null                                 then v_pendentes := v_pendentes || 'pcd'; end if;
  if nullif(trim(v_c.emergencia_nome), '') is null         then v_pendentes := v_pendentes || 'emergencia_nome'; end if;
  if nullif(trim(v_c.emergencia_parentesco), '') is null   then v_pendentes := v_pendentes || 'emergencia_parentesco'; end if;
  if nullif(trim(v_c.emergencia_telefone), '') is null     then v_pendentes := v_pendentes || 'emergencia_telefone'; end if;
  if nullif(trim(v_c.hobbies), '') is null           then v_pendentes := v_pendentes || 'hobbies'; end if;
  if nullif(trim(v_c.curiosidade), '') is null       then v_pendentes := v_pendentes || 'curiosidade'; end if;

  -- Campos obrigatórios condicionais.
  if v_c.tipo_contratacao in ('pj', 'mei', 'clt_recibo') then
    if nullif(trim(v_c.cnpj), '') is null          then v_pendentes := v_pendentes || 'cnpj'; end if;
    if nullif(trim(v_c.razao_social), '') is null  then v_pendentes := v_pendentes || 'razao_social'; end if;
    if v_c.pj_natureza is null                     then v_pendentes := v_pendentes || 'pj_natureza'; end if;
  end if;

  -- Documentos obrigatórios conforme tipo_contratacao.
  v_docs_obrigatorios := case v_c.tipo_contratacao
    when 'pj'         then array['cnpj','rg_cnh','cpf']::public.colaborador_documento_tipo[]
    when 'mei'        then array['cnpj','ccmei','rg_cnh','cpf']::public.colaborador_documento_tipo[]
    when 'clt'        then array['rg_cnh','cpf','comprovante_residencia','pis','ctps','titulo_eleitor']::public.colaborador_documento_tipo[]
    when 'clt_recibo' then array['rg_cnh','cpf','comprovante_residencia','pis','ctps','titulo_eleitor']::public.colaborador_documento_tipo[]
    when 'estagio'    then array['rg_cnh','cpf','comprovante_residencia','ctps']::public.colaborador_documento_tipo[]
    when 'socio'      then array[]::public.colaborador_documento_tipo[]
    else array[]::public.colaborador_documento_tipo[]
  end;

  foreach v_tipo in array v_docs_obrigatorios loop
    if not exists (
      select 1 from public.colaboradores_documentos
      where colaborador_id = v_c.id and tipo = v_tipo
    ) then
      v_doc_pendentes := v_doc_pendentes || v_tipo::text;
    end if;
  end loop;

  if array_length(v_pendentes, 1) > 0 or array_length(v_doc_pendentes, 1) > 0 then
    raise exception 'perfil_incompleto: campos=% documentos=%',
      coalesce(array_to_string(v_pendentes, ','), ''),
      coalesce(array_to_string(v_doc_pendentes, ','), '')
      using errcode = '23514';
  end if;

  update public.colaboradores
    set perfil_completado_em = now(),
        updated_at = now()
  where id = v_c.id;
end;
$$;

grant execute on function public.completar_meu_perfil_colaborador() to authenticated;

-- ---------------------------------------------------------------------
-- 7. Trigger pra manter updated_at em colaboradores_documentos
-- ---------------------------------------------------------------------

create or replace function public.tg_colaboradores_documentos_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_colaboradores_documentos_updated_at
  before update on public.colaboradores_documentos
  for each row execute function public.tg_colaboradores_documentos_updated_at();
