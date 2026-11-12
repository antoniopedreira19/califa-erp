-- =====================================================================
-- Decisão 255 (12/11/2026): a busca de fornecedor por digitação.
--
-- O combo de fornecedor da PP (e o do BV, e o campo do financeiro) recebia
-- o cadastro INTEIRO dos ativos na carga da página. O PostgREST deste
-- projeto devolve no máximo 1.000 linhas por consulta: com a carga da
-- "Base Fornecedores California" (cerca de 3.000 fornecedores novos), quem
-- ficasse depois do milésimo em ordem alfabética sumiria da lista, sem
-- erro nenhum. E o docs/PERFORMANCE.md já proíbe carregar cadastro que
-- cresce inteiro num select ("traga as primeiras N e busque o resto por
-- digitação").
--
-- Esta função é a busca: os ativos do tenant cujo nome, razão social ou
-- documento contêm o que foi digitado, sem diferença de acento nem de
-- maiúscula (como o filtro do combo fazia no navegador), os que COMEÇAM
-- pelo termo primeiro, no máximo 100 por vez. Termo vazio devolve os
-- primeiros em ordem alfabética, para o combo abrir cheio. Documento só
-- entra na busca a partir de 3 dígitos.
--
-- SECURITY INVOKER: o RLS de `fornecedores` (membro do tenant) continua
-- valendo; o `p_tenant_id` só escolhe o tenant ativo da sessão.
-- =====================================================================

create or replace function public.buscar_fornecedores(
  p_tenant_id uuid,
  p_termo text default '',
  p_limite integer default 30
)
returns table (
  id uuid,
  nome text,
  razao_social text,
  cpf_cnpj text,
  status public.cadastro_status
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with t as (
    select
      -- `%`, `_` e `\` digitados valem como texto, não como curinga.
      nullif(
        replace(replace(replace(public.unaccent(lower(btrim(coalesce(p_termo, '')))), '\', '\\'), '%', '\%'), '_', '\_'),
        ''
      ) as termo,
      nullif(regexp_replace(coalesce(p_termo, ''), '\D', '', 'g'), '') as digitos
  )
  select f.id, f.nome, f.razao_social, f.cpf_cnpj, f.status
  from public.fornecedores f
  cross join t
  where f.tenant_id = p_tenant_id
    and f.status = 'ativo'
    and (
      t.termo is null
      or public.unaccent(lower(f.nome)) like '%' || t.termo || '%'
      or public.unaccent(lower(coalesce(f.razao_social, ''))) like '%' || t.termo || '%'
      or (length(t.digitos) >= 3 and f.cpf_cnpj like '%' || t.digitos || '%')
    )
  order by
    (
      t.termo is not null
      and (
        public.unaccent(lower(f.nome)) like t.termo || '%'
        or public.unaccent(lower(coalesce(f.razao_social, ''))) like t.termo || '%'
      )
    ) desc,
    f.nome,
    f.id
  limit least(greatest(coalesce(p_limite, 30), 1), 100);
$$;

comment on function public.buscar_fornecedores(uuid, text, integer) is
  'Decisão 255: fornecedores ativos do tenant por nome, razão social ou documento (sem acento), os que começam pelo termo primeiro; no máximo 100. Alimenta os combos de fornecedor no lugar da lista inteira.';

revoke all on function public.buscar_fornecedores(uuid, text, integer) from public, anon;
grant execute on function public.buscar_fornecedores(uuid, text, integer) to authenticated;
