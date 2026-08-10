-- =====================================================================
-- O tipo que vale para o BV passa a ser o da CÓPIA do job também.
--
-- Problema que isto resolve: a planilha do job lê
-- `jobs_itens_orcado.tipo_custo` (a cópia), mas o trigger validava
-- `versoes_orcamento_itens.tipo_custo` (a versão aprovada). A errata
-- altera só a cópia — de propósito, para que a versão continue sendo o
-- que o cliente aprovou. Resultado: um item que a errata levou de B para
-- A mostrava "+BV" na tela e era recusado pelo banco com uma mensagem
-- que contradizia o que o usuário estava vendo.
--
-- Decisão do time: depois da errata, quem manda é a cópia. Se a planilha
-- do job diz A, o BV grava.
--
-- Índice usado pelo EXISTS: `idx_jio_item_versao`, criado na migration
-- de erratas (20260804054350).
-- =====================================================================

create or replace function public.bv_exige_item_com_bv()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo public.tipo_custo;
  v_tenant uuid;
  v_aceita boolean;
begin
  select tipo_custo, tenant_id into v_tipo, v_tenant
  from public.versoes_orcamento_itens
  where id = new.item_versao_id;

  if v_tipo is null then
    raise exception 'Item da versão não encontrado.';
  end if;

  v_aceita := v_tipo in ('A', 'D');

  -- Antes da abertura do job não existe cópia, e a versão decide sozinha.
  -- Depois, a cópia pode ter andado com a errata e é ela que vale.
  if not v_aceita then
    select exists (
      select 1
      from public.jobs_itens_orcado o
      where o.item_versao_id = new.item_versao_id
        and o.tipo_custo in ('A', 'D')
    ) into v_aceita;
  end if;

  if not v_aceita then
    raise exception 'BV só pode ser lançado em item de custo tipo A ou D.';
  end if;

  if new.tenant_id <> v_tenant then
    raise exception 'Tenant do BV difere do tenant do item.';
  end if;

  return new;
end$$;

revoke all on function public.bv_exige_item_com_bv() from public, anon, authenticated;
