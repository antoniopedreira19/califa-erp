-- =====================================================================
-- BV passa a valer para custo tipo A **ou D**.
--
-- Decisão do time na parte 2 (tela de acompanhamento do job). O critério
-- real do BV não é a letra, é "o cliente paga o fornecedor diretamente":
--   A — faturamento direto para cliente;
--   D — faturamento direto para cliente, com visão interna para agência/GP.
-- Nos dois o dinheiro sai do cliente para o fornecedor, então sobra
-- comissão a negociar. B (bi-tributação) e C passam pela California e
-- seguem sem BV — nessas linhas a calha mostra Pedido de Produção.
--
-- Vale nas DUAS telas: o BV é um registro só, compartilhado entre a
-- versão do orçamento e a planilha do job. Um BV criado num item D pelo
-- job seria rejeitado pelo trigger antigo.
--
-- A função troca de nome junto com a regra: `bv_exige_item_tipo_a` mentia
-- a partir daqui.
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
begin
  select tipo_custo, tenant_id into v_tipo, v_tenant
  from public.versoes_orcamento_itens
  where id = new.item_versao_id;

  if v_tipo is null then
    raise exception 'Item da versão não encontrado.';
  end if;

  if v_tipo not in ('A', 'D') then
    raise exception 'BV só pode ser lançado em item de custo tipo A ou D.';
  end if;

  if new.tenant_id <> v_tenant then
    raise exception 'Tenant do BV difere do tenant do item.';
  end if;

  return new;
end$$;

revoke all on function public.bv_exige_item_com_bv() from public, anon, authenticated;

drop trigger if exists trg_itens_bv_tipo_a on public.itens_bv;
drop trigger if exists trg_itens_bv_tipo_com_bv on public.itens_bv;
create trigger trg_itens_bv_tipo_com_bv
  before insert or update of item_versao_id, tenant_id on public.itens_bv
  for each row execute function public.bv_exige_item_com_bv();

drop function if exists public.bv_exige_item_tipo_a();
