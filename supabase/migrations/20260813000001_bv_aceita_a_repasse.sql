-- =====================================================================
-- A · Repasse (AR) passa a aceitar BV — além da PP que já emitia.
--
-- Até aqui a regra era "BV só em A ou D", pelo critério "o cliente paga
-- o fornecedor diretamente". A decisão 003 dizia, com essas palavras,
-- que o AR não tinha BV: "sem pagamento direto, não há comissão a
-- negociar com o fornecedor".
--
-- Decisão do time em 13/08/2026: no A · Repasse existem AS DUAS coisas.
-- O principal passa pela California e é repassado ao fornecedor — isso
-- continua gerando Pedido de Produção —, e ainda assim há comissão a
-- negociar com esse fornecedor, que é o BV. AR vira o único tipo com as
-- duas calhas na mesma linha.
--
-- Mudança ADITIVA de propósito: a função só afrouxa a condição (passa a
-- aceitar mais um tipo). Nenhum BV existente é tocado, nenhuma coluna
-- muda, e nada é removido.
--
-- O que NÃO muda, também de propósito:
--   * `REGRAS_TIPO_CUSTO.AR.calha` segue "PP" em lib/calculos — AR
--     continua gerando previsão de desembolso exatamente como hoje
--     (decisão 004). Faturamento previsto, valor do job, honorários e
--     imposto ficam idênticos.
--   * O BV segue sem abater custo e sem entrar em rentabilidade, como
--     desde 20260807000001_itens_bv.sql.
--
-- Espelho no código: `TIPOS_COM_BV` em lib/calculos/versao-totais.ts.
-- Mudar um sem o outro deixa a tela oferecendo um BV que o banco recusa
-- (ou escondendo um que ele aceitaria).
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

  v_aceita := v_tipo in ('A', 'AR', 'D');

  -- Antes da abertura do job não existe cópia, e a versão decide sozinha.
  -- Depois, a cópia pode ter andado com a errata e é ela que vale
  -- (20260807000003_bv_tipo_segue_copia_do_job.sql).
  if not v_aceita then
    select exists (
      select 1
      from public.jobs_itens_orcado o
      where o.item_versao_id = new.item_versao_id
        and o.tipo_custo in ('A', 'AR', 'D')
    ) into v_aceita;
  end if;

  if not v_aceita then
    raise exception 'BV só pode ser lançado em item de custo tipo A, A · Repasse ou D.';
  end if;

  if new.tenant_id <> v_tenant then
    raise exception 'Tenant do BV difere do tenant do item.';
  end if;

  return new;
end$$;

-- SECURITY DEFINER só faz sentido chamada pelo trigger. Ninguém invoca
-- direto do cliente.
revoke all on function public.bv_exige_item_com_bv() from public, anon, authenticated;

-- O trigger já existe desde 20260807000002 e aponta para esta função —
-- recriado aqui só para a migration ser auto-suficiente se rodada limpa.
drop trigger if exists trg_itens_bv_tipo_com_bv on public.itens_bv;
create trigger trg_itens_bv_tipo_com_bv
  before insert or update of item_versao_id, tenant_id on public.itens_bv
  for each row execute function public.bv_exige_item_com_bv();
