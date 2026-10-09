-- Decisão 164 (09/10/2026), complemento: o nome social do freela entra na
-- busca do formulário.
--
-- Por quê: na planilha de freelas, 36 dos 69 que estão trabalhando têm um
-- nome social de uma palavra só (o apelido), e um deles se repete. Como
-- nome da lista ele não separa ninguém; na busca, ajuda o GP que conhece a
-- pessoa pelo apelido. A lista mostra o nome completo, como o RH.
--
-- `pessoas_para_verba` ganha a coluna `busca`. A função nasceu na migration
-- anterior e ainda não tem quem a chame, então é recriada (o tipo de retorno
-- muda e o Postgres não troca isso com CREATE OR REPLACE).

alter table public.freelas
  add column if not exists nome_social text;

comment on column public.freelas.nome_social is
  'Como a pessoa é chamada (na planilha, muitas vezes o apelido). Só entra na busca do formulário; o nome da lista é o completo.';

drop function if exists public.pessoas_para_verba(uuid);

create function public.pessoas_para_verba(p_tenant_id uuid)
returns table (id uuid, origem text, nome text, funcao text, detalhe text, busca text)
language sql
stable
security definer
set search_path = public
as $$
  with quem as (
    select tm.role::text as papel
      from public.tenant_members tm
      join public.profiles p on p.id = tm.user_id
     where tm.user_id = (select auth.uid())
       and tm.tenant_id = p_tenant_id
       and tm.status = 'ativo'
       and p.ativo
  )
  select c.id, 'colaborador'::text, c.nome, c.funcao, c.tipo_contratacao::text, null::text
    from public.colaboradores c
   where c.tenant_id = p_tenant_id
     and c.status = 'ativo'
     and exists (select 1 from quem where papel in ('administrador', 'gerente_producao', 'produtor', 'freelancer'))
  union all
  select f.id, 'freela'::text, f.nome, f.funcao, f.cidade, f.nome_social
    from public.freelas f
   where f.tenant_id = p_tenant_id
     and f.ativo
     and exists (select 1 from quem where papel in ('administrador', 'gerente_producao', 'produtor', 'freelancer'))
     and not exists (
       select 1 from public.colaboradores c
        where c.tenant_id = p_tenant_id
          and c.status = 'ativo'
          and f.cpf is not null
          and regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') = f.cpf
     )
$$;

comment on function public.pessoas_para_verba(uuid) is
  'Decisão 164: quem pode ser titular da verba de alimentação ou de transporte — colaboradores ativos do RH e freelas ativos, sem repetir. Só para quem gera PP.';

revoke all on function public.pessoas_para_verba(uuid) from public, anon;
grant execute on function public.pessoas_para_verba(uuid) to authenticated;
