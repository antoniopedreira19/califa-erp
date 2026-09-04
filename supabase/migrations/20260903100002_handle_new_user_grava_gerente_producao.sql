-- handle_new_user tinha 'gestao_projetos' hardcoded como role default
-- do novo profile. Como renomeamos esse valor do enum para
-- 'gerente_producao' na migration anterior, a funcao precisa acompanhar
-- -- caso contrario o proximo convite de usuario quebra ao inserir na
-- profiles.
--
-- Continua sendo apenas o default do trigger. A tela de convite
-- sobrescreve com o role real escolhido pelo admin logo depois do
-- signup (ver app/(app)/admin/usuarios/actions.ts, funcao convidar).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, nome, email, role, ativo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email,
    'gerente_producao',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
