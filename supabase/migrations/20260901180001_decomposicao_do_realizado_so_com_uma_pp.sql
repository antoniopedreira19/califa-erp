-- A decomposicao do REALIZADO so aparece quando o item tem UMA PP.
--
-- A 035 §7 fez as tres colunas somarem o trio das PPs. Com uma PP no item
-- — o caso comum — a linha ficou identica ao que o GP digitou, que era o
-- objetivo. Com VARIAS, porem, a soma nao descreve compra nenhuma: o item
-- "Locacao de som e luz", com 2 PPs somando R$ 18.000, exibia
-- R$ 48.000,00 x 0,75 x 2, cujo produto seria R$ 72.000. Um unitario de
-- R$ 48.000 para um custo de R$ 18.000 nao e so inutil, e enganoso.
--
-- Regra do Tiago (01/09/2026): com mais de uma PP, as tres colunas ficam
-- ZERADAS e quem quiser a quebra abre a tela de PPs do item.
--
-- Zerar e o suficiente porque as duas telas que leem essas colunas ja
-- tratam zero como "—": `CelulaLeitura` na Planilha Interna e os
-- formatadores do card da visao agregada. Nenhuma mudanca de UI.
--
-- `total_realizado` NAO muda: continua sendo a soma dos `valor` das PPs
-- menos as devolucoes de verba, e continua correto nos dois casos. O que
-- deixa de ser exibido e so a quebra.

create or replace function public.recalcular_realizado_do_item(p_item_realizado_id uuid)
 returns void
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_total       numeric;
  v_qtd         numeric;
  v_unit        numeric;
  v_dm          numeric;
  v_n_pps       integer;
  v_devolvido   numeric;
begin
  if p_item_realizado_id is null then
    return;
  end if;

  select count(*),
         coalesce(sum(valor), 0),
         coalesce(sum(quantidade), 0),
         coalesce(sum(valor_unitario), 0),
         coalesce(sum(dias_meses), 0)
    into v_n_pps, v_total, v_qtd, v_unit, v_dm
    from public.pedidos_compra
   where item_realizado_id = p_item_realizado_id
     and status <> 'cancelada';

  select coalesce(sum(pv.valor_devolvido), 0)
    into v_devolvido
    from public.pp_verba_prestacoes pv
    join public.pedidos_compra pp on pp.id = pv.pedido_compra_id
   where pp.item_realizado_id = p_item_realizado_id
     and pp.status <> 'cancelada';

  -- Uma PP: a soma E o trio daquela PP, entao a linha reproduz o que foi
  -- digitado. Mais de uma: nao existe decomposicao unica, e somar tres
  -- compras diferentes produziria um unitario que nunca foi contratado.
  if v_n_pps <> 1 then
    v_unit := 0;
    v_qtd  := 0;
    v_dm   := 0;
  end if;

  update public.jobs_itens_realizado
     set total_realizado          = round(v_total - v_devolvido, 2),
         quantidade_realizada     = v_qtd,
         dias_meses_realizado     = v_dm,
         valor_unitario_realizado = round(v_unit, 2)
   where id = p_item_realizado_id;
end;
$function$;

-- Reprocessa o que ja existe.
do $$
declare r record;
begin
  for r in select distinct item_realizado_id
             from public.pedidos_compra
            where item_realizado_id is not null
  loop
    perform public.recalcular_realizado_do_item(r.item_realizado_id);
  end loop;
end $$;
