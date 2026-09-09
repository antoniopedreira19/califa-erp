-- Motivo: Fase 2B - quando um user aceita o convite, o admin pode ter
-- pre-configurado permissoes de empresa/regional no metadata. Esta
-- migration estende handle_new_user para ler raw_user_meta_data.permissoes
-- e criar linhas em empresa_members.
--
-- Formato do metadata (grava no createConvite ou reinviteUser em Task 8):
--   {
--     "nome": "...",
--     "tenant_id": "<uuid>",
--     "permissoes": {
--       "escopo": "todas" | "personalizado",
--       "empresas": [   // apenas se escopo=personalizado
--         { "empresa_id": "<uuid>", "regionais": null | ["<uuid>", ...] }
--       ]
--     }
--   }
--   regionais=null significa "amplo" (regional_id=NULL em empresa_members).
--   regionais=[uuid, uuid, ...] cria uma linha por regional.
--
-- Aditivo: se metadata ausente ou malformado, o trigger nao cria linha
-- de empresa_members - o admin adiciona depois pela tela. Backward
-- compat com convites antigos (que soh gravam { nome }).
--
-- Corpo atual (verificado via pg_proc): so criava profile.
-- tenant_members eh inserido depois pela server action de convite.
-- Aqui adicionamos o bloco de permissoes ao final, preservando o
-- comportamento antigo.
--
-- Ver docs/superpowers/specs/2026-09-09-empresa-members-permissoes-design.md

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_tenant_id     uuid;
  v_permissoes    jsonb;
  v_escopo        text;
  v_empresas      jsonb;
  v_empresa_entry jsonb;
  v_empresa_id    uuid;
  v_regionais     jsonb;
  v_regional_id   uuid;
begin
  -- Preserva comportamento anterior: cria profile default.
  insert into public.profiles (id, nome, email, role, ativo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email,
    'gerente_producao',
    true
  )
  on conflict (id) do nothing;

  -- Novo: aplica permissoes pre-configuradas no convite.
  v_permissoes := new.raw_user_meta_data -> 'permissoes';
  v_tenant_id  := (new.raw_user_meta_data ->> 'tenant_id')::uuid;

  if v_permissoes is null or v_tenant_id is null then
    return new;  -- convite antigo ou sem metadata: nada a fazer
  end if;

  v_escopo := v_permissoes ->> 'escopo';

  if v_escopo = 'todas' then
    -- Cria 1 linha amplo por empresa ativa do tenant
    insert into public.empresa_members(tenant_id, user_id, empresa_id, regional_id, status, created_by)
    select v_tenant_id, new.id, e.id, null, 'ativo', null
    from public.empresas e
    where e.tenant_id = v_tenant_id and e.ativo = true
    on conflict on constraint uq_empresa_members do nothing;

  elsif v_escopo = 'personalizado' then
    v_empresas := v_permissoes -> 'empresas';
    if v_empresas is not null and jsonb_typeof(v_empresas) = 'array' then
      for v_empresa_entry in select * from jsonb_array_elements(v_empresas) loop
        v_empresa_id := (v_empresa_entry ->> 'empresa_id')::uuid;
        v_regionais  := v_empresa_entry -> 'regionais';

        if v_regionais is null or jsonb_typeof(v_regionais) = 'null' then
          -- Amplo pra essa empresa
          insert into public.empresa_members(tenant_id, user_id, empresa_id, regional_id, status, created_by)
          values (v_tenant_id, new.id, v_empresa_id, null, 'ativo', null)
          on conflict on constraint uq_empresa_members do nothing;
        elsif jsonb_typeof(v_regionais) = 'array' then
          -- Restrito: uma linha por regional listada
          for v_regional_id in
            select (value #>> '{}')::uuid from jsonb_array_elements(v_regionais)
          loop
            insert into public.empresa_members(tenant_id, user_id, empresa_id, regional_id, status, created_by)
            values (v_tenant_id, new.id, v_empresa_id, v_regional_id, 'ativo', null)
            on conflict on constraint uq_empresa_members do nothing;
          end loop;
        end if;
      end loop;
    end if;
  end if;

  return new;
exception when others then
  -- Metadata malformado nao deve bloquear a criacao do user.
  -- Loga em audit_events e segue.
  begin
    insert into public.audit_events(tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
    values (v_tenant_id, new.id, 'convite.permissoes_falhou', 'user', new.id::text,
            jsonb_build_object('erro', SQLERRM, 'permissoes_raw', v_permissoes));
  exception when others then
    -- audit tambem falhou (ex: tabela ainda sem row de tenant): engole em silencio
    null;
  end;
  return new;
end $$;
