-- =====================================================================
-- Realizado do item deduz devolucao de verba
--
-- Ate aqui: total_realizado do item = soma(pp.valor) das PPs nao canceladas.
-- Trigger `pp_recalcula_realizado` (migration 20260821000001) mantem essa
-- soma atualizada em pedidos_compra.
--
-- Problema: PP verba de R$ 50k com prestacao de R$ 40k gasto e R$ 10k
-- devolvidos continua marcando R$ 50k no realizado do item — o custo
-- BRUTO da PP, nao o custo EFETIVO. Confuso pro usuario que ve o valor
-- no realizado e nao entende porque nao bate com "quanto sobrou de fato".
--
-- Solucao: amplia a formula pra subtrair valor_devolvido das prestacoes
-- do item. Prestacao existe = valor efetivo eh valor_gasto; nao existe =
-- valor bruto (sem devolucao a subtrair, ou porque nao eh verba, ou porque
-- verba mas ainda nao prestou contas).
--
-- Formula nova: sum(pp.valor) - sum(prestacao.valor_devolvido)
--
-- Alternativa equivalente: sum(coalesce(prestacao.valor_gasto, pp.valor)).
-- Escolhida a primeira porque preserva o padrao "soma tudo, depois deduz"
-- da migration original e nao requer LEFT JOIN.
--
-- Trigger novo em pp_verba_prestacoes: quando prestacao eh criada,
-- dispara recalcular do item correspondente. Prestacao eh imutavel
-- (task 3), entao so INSERT dispara.
-- =====================================================================

-- ---------- 1. Nova versao de recalcular_realizado_do_item ----------

create or replace function public.recalcular_realizado_do_item(p_item_realizado_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_total       numeric;
  v_qtd         numeric;
  v_devolvido   numeric;
begin
  if p_item_realizado_id is null then
    return;
  end if;

  select coalesce(sum(valor), 0), coalesce(sum(quantidade), 0)
    into v_total, v_qtd
    from public.pedidos_compra
   where item_realizado_id = p_item_realizado_id
     and status <> 'cancelada';

  -- Devolucao de verba: subtrai do total do item.
  -- LEFT-side: pp.item_realizado_id = X e pp.status <> cancelada; da PP,
  -- pega prestacao (unica por PP) e o valor_devolvido dela. Se PP nao
  -- eh verba, nao tem prestacao, nao contribui.
  select coalesce(sum(pv.valor_devolvido), 0)
    into v_devolvido
    from public.pp_verba_prestacoes pv
    join public.pedidos_compra pp on pp.id = pv.pedido_compra_id
   where pp.item_realizado_id = p_item_realizado_id
     and pp.status <> 'cancelada';

  update public.jobs_itens_realizado
     set total_realizado          = round(v_total - v_devolvido, 2),
         quantidade_realizada     = v_qtd,
         dias_meses_realizado     = case when v_qtd > 0 then 1 else 0 end,
         valor_unitario_realizado = case
                                      when v_qtd > 0 then round((v_total - v_devolvido) / v_qtd, 2)
                                      else 0
                                    end
   where id = p_item_realizado_id;
end;
$$;

comment on function public.recalcular_realizado_do_item(uuid) is
  'Reescreve o realizado de um item a partir das PPs nao canceladas dele, DEDUZINDO valor_devolvido das prestacoes de verba. Fonte unica: chamada pelos triggers em pedidos_compra e pp_verba_prestacoes.';


-- ---------- 2. Trigger em pp_verba_prestacoes ----------

create or replace function public.prestacao_verba_recalcula_realizado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item_realizado_id uuid;
begin
  -- Prestacao aponta pra pedido_compra, que aponta pra item_realizado.
  -- Precisamos do item pra recalcular.
  select pp.item_realizado_id
    into v_item_realizado_id
    from public.pedidos_compra pp
   where pp.id = new.pedido_compra_id;

  perform public.recalcular_realizado_do_item(v_item_realizado_id);
  return new;
end;
$$;

comment on function public.prestacao_verba_recalcula_realizado() is
  'Ao criar prestacao de contas de PP verba, dispara recalculo do realizado do item da PP para que a devolucao seja deduzida. Prestacao eh imutavel (nao ha UPDATE nem DELETE).';

drop trigger if exists trg_prestacao_recalcula_realizado on public.pp_verba_prestacoes;
create trigger trg_prestacao_recalcula_realizado
after insert on public.pp_verba_prestacoes
for each row execute function public.prestacao_verba_recalcula_realizado();


-- ---------- 3. Backfill ----------
--
-- Se ja existe prestacao no banco (deveria haver zero em produção real
-- neste momento — feature acabou de subir), recalcula os itens afetados
-- para refletir a nova formula.

do $$
declare
  r record;
begin
  for r in
    select distinct pp.item_realizado_id
      from public.pp_verba_prestacoes pv
      join public.pedidos_compra pp on pp.id = pv.pedido_compra_id
     where pp.status <> 'cancelada'
       and pv.valor_devolvido > 0
  loop
    perform public.recalcular_realizado_do_item(r.item_realizado_id);
  end loop;
end;
$$;
