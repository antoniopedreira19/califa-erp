-- ---------------------------------------------------------------------------
-- Editar PP gerada refaz o parcelamento — e refazer é apagar as parcelas
-- antigas e inserir as novas (02/09/2026, decisão 039 §4).
--
-- `pedidos_compra_parcelas` nasceu (20260817000002) com select, insert e
-- update para `authenticated`, e sem DELETE: até aqui nenhum fluxo apagava
-- parcela — a correção da rejeitada mantém o número de parcelas e só
-- redivide valores. O primeiro "Salvar alterações" de uma PP gerada tomou
-- "permission denied for table pedidos_compra_parcelas".
--
-- A policy é estreita de propósito: só parcela de PP que ainda está
-- `gerada`. Parcela de PP no financeiro pode ter pagamento, fatura de
-- cartão ou lançamento pendurado, e não é para ser apagada por ninguém.
--
-- Aditiva: grant + policy. Encontrada na verificação em navegador.
-- ---------------------------------------------------------------------------

grant delete on public.pedidos_compra_parcelas to authenticated;

drop policy if exists pp_parcelas_delete on public.pedidos_compra_parcelas;
create policy pp_parcelas_delete on public.pedidos_compra_parcelas
  for delete
  using (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1
        from public.pedidos_compra pp
       where pp.id = pedido_compra_id
         and pp.status = 'gerada'
    )
  );

comment on policy pp_parcelas_delete on public.pedidos_compra_parcelas is
  'Só a parcela de PP ainda gerada pode ser apagada: é a edição do rascunho refazendo o parcelamento (decisão 039).';
