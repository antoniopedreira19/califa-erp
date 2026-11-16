-- =====================================================================
-- Perfil do colaborador — endurece funções e revoga execute do public
-- =====================================================================
--
-- Correção dos alertas do advisor pós-20261116700001:
--
-- 1. `tg_colaboradores_documentos_updated_at`: fixar search_path (até
--    trigger tem que ter, por padrão do projeto).
--
-- 2. Funções helper (`colaborador_eh_do_usuario_logado` e
--    `colaborador_do_path_eh_do_usuario`) podem ser SECURITY INVOKER —
--    só retornam booleano baseado em auth.uid(), não dão upgrade de
--    privilégio. Mantê-las como DEFINER é overhead desnecessário.
--
-- 3. RPCs SECURITY DEFINER (`atualizar_meu_perfil_colaborador`,
--    `completar_meu_perfil_colaborador`): revogar EXECUTE do `public`
--    (role implícito que cobre `anon`). Só `authenticated` deve poder
--    chamar. A função checa auth.uid() internamente, mas endurecer na
--    borda é o padrão do projeto.
-- =====================================================================

-- 1. Trigger com search_path fixo
create or replace function public.tg_colaboradores_documentos_updated_at()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 2. Helpers viram SECURITY INVOKER
create or replace function public.colaborador_eh_do_usuario_logado(p_colaborador_id uuid)
  returns boolean
  language sql
  stable security invoker
  set search_path = public
as $$
  select exists (
    select 1 from public.colaboradores
    where id = p_colaborador_id
      and user_id = (select auth.uid())
  );
$$;

create or replace function public.colaborador_do_path_eh_do_usuario(p_path text)
  returns boolean
  language plpgsql
  stable security invoker
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

-- 3. Revogar EXECUTE do public nas 4 funções (helpers + 2 RPCs).
--    O GRANT TO authenticated da 20261116700001 continua valendo.
revoke execute on function public.colaborador_eh_do_usuario_logado(uuid)        from public;
revoke execute on function public.colaborador_do_path_eh_do_usuario(text)       from public;
revoke execute on function public.atualizar_meu_perfil_colaborador(jsonb)       from public;
revoke execute on function public.completar_meu_perfil_colaborador()            from public;
