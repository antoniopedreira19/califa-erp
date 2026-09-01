-- As colunas do REALIZADO passam a somar R$ Unit., QT e D/M das PPs.
--
-- Ate aqui a funcao derivava a decomposicao por rateio: `quantidade` era a
-- soma, mas `dias_meses` era forcado a 1 e o unitario saia de
-- `total / quantidade`. Foi escrita assim na decisao 022, quando a PP nao
-- TINHA decomposicao para oferecer.
--
-- Desde a 035 a PP guarda `valor_unitario` e `dias_meses`, e a planilha
-- passou a contradizer o formulario: uma PP digitada como
-- R$ 1.234,00 x 3 x 2 aparecia no REALIZADO como R$ 2.468,00 x 3 x 1.
-- Regra escolhida pelo Tiago em 01/09/2026: soma os tres.
--
-- ⚠️ Consequencia conhecida e aceita: com MAIS DE UMA PP no item, a linha
-- deixa de multiplicar. `total_realizado` continua sendo a soma dos
-- `valor` das PPs (menos devolucoes de verba) e NAO o produto das somas —
-- item com 2 PPs somando R$ 18.000 exibe R$ 48.000 x 0,75 x 2, cujo
-- produto seria R$ 72.000. Quem manda no dinheiro e `total_realizado`; as
-- outras tres colunas sao exibicao, e nenhum calculo do sistema deriva
-- valor delas.

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
  v_devolvido   numeric;
begin
  if p_item_realizado_id is null then
    return;
  end if;

  select coalesce(sum(valor), 0),
         coalesce(sum(quantidade), 0),
         coalesce(sum(valor_unitario), 0),
         coalesce(sum(dias_meses), 0)
    into v_total, v_qtd, v_unit, v_dm
    from public.pedidos_compra
   where item_realizado_id = p_item_realizado_id
     and status <> 'cancelada';

  select coalesce(sum(pv.valor_devolvido), 0)
    into v_devolvido
    from public.pp_verba_prestacoes pv
    join public.pedidos_compra pp on pp.id = pv.pedido_compra_id
   where pp.item_realizado_id = p_item_realizado_id
     and pp.status <> 'cancelada';

  update public.jobs_itens_realizado
     set total_realizado          = round(v_total - v_devolvido, 2),
         quantidade_realizada     = v_qtd,
         dias_meses_realizado     = v_dm,
         valor_unitario_realizado = round(v_unit, 2)
   where id = p_item_realizado_id;
end;
$function$;

-- Reprocessa o que ja existe: sem isso as linhas antigas ficariam com a
-- decomposicao velha ate a proxima PP mexer no item.
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
