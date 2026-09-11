-- =====================================================================
-- A PP gerada volta a contar no realizado do item (11/09/2026)
--
-- Decisão do Tiago em 11/09/2026 (docs/decisions/074), revendo o §4 da
-- decisão 039 (02/09/2026).
--
-- COMO ESTAVA
-- -----------
-- Desde 02/09/2026 o realizado do item somava só as PPs que CHEGARAM ao
-- financeiro: `status not in ('cancelada', 'gerada')`. O racional era que
-- a PP apenas gerada ainda pode ser editada ou cancelada dentro do job,
-- sem passar por ninguém, e somá-la faria o item parecer mais gasto do
-- que está.
--
-- O QUE ISSO CAUSOU NA TELA
-- -------------------------
-- Um job com todas as PPs geradas e nenhuma enviada — o caso do JOB-0025,
-- com 7 PPs e R$ 15.230,94 — mostrava realizado zerado em toda linha,
-- "Em PPs emitidas: R$ 0,00" no painel do item e "sem realizado" no card
-- do topo. O GP que acabou de gerar as PPs lia a planilha como se nada
-- tivesse sido feito.
--
-- COMO FICA
-- ---------
-- Realizado do item = soma das PPs NÃO CANCELADAS (a gerada entra), menos
-- as devoluções de verba das mesmas PPs. O cancelamento continua sendo o
-- único jeito de tirar dinheiro de um item.
--
-- O QUE **NÃO** MUDA (decidido junto, 11/09/2026):
--   * o consumo que congela a previsão de custo da abertura
--     (`financeiro/abertura-de-job/consumo.ts`) segue contando só PP
--     enviada — PP gerada não pode congelar previsão no financeiro;
--   * a trava da errata (decisão 040) segue olhando `ppChegouAoFinanceiro`:
--     linha com PP apenas gerada continua entrando em errata;
--   * `vw_fluxo_caixa` não é tocada: a previsão por item marcado (decisão
--     052) já trata `gerada` no lugar dela, como PP sem título.
--
-- Aditiva: só a função muda, e o backfill preenche realizado que hoje
-- está em zero por causa do filtro que sai. Backfill autorizado pelo
-- Tiago em 11/09/2026, ao escolher o alcance da correção.
-- =====================================================================

-- ---------- 1. A função volta a contar a PP gerada ----------
--
-- Mesma forma da versão de 02/09/2026 (20260902160002), com `gerada` de
-- volta nos dois recortes — o da soma e o das devoluções de verba.
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

  -- Toda PP que existe no item pesa; só o cancelamento tira (11/09/2026).
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

  -- A decomposição (R$ Unit. · QT · D/M) só faz sentido com uma PP: com
  -- duas, somar unitários de fornecedores diferentes seria ficção.
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

comment on function public.recalcular_realizado_do_item(uuid) is
  'Realizado do item = soma das PPs nao canceladas (a gerada conta desde 11/09/2026, decisao 074) menos devolucoes de verba. Decomposicao so com uma PP.';

comment on column public.jobs_itens_realizado.total_realizado is
  'Soma das PPs nao canceladas do item, mantida pelo trigger trg_pp_recalcula_realizado. A PP apenas gerada conta desde 11/09/2026 (decisao 074). Nao e digitada. Em item A e D (que nao geram PP) fica 0 e a aplicacao le o orcado no lugar.';

comment on column public.pedidos_compra.status is
  'gerada: no job, ainda nao enviada ao financeiro — conta no realizado do item (074) mas nao consome previsao da abertura · em_avaliacao: no financeiro · aprovada · pago · rejeitada · cancelada.';

-- ---------- 2. Backfill: itens que têm PP gerada ----------
--
-- Só eles mudam de número. Loop explícito, e não `select f(id) from ...`:
-- a função escreve na mesma tabela que estaria sendo varrida.
do $$
declare
  r record;
begin
  for r in
    select distinct pc.item_realizado_id as id
      from public.pedidos_compra pc
     where pc.status = 'gerada'
       and pc.item_realizado_id is not null
  loop
    perform public.recalcular_realizado_do_item(r.id);
  end loop;
end;
$$;

grant execute on function public.recalcular_realizado_do_item(uuid) to authenticated;
