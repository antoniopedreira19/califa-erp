-- ---------------------------------------------------------------------------
-- PP gerada: o envio ao financeiro vira ação própria, o teto por PP sai, e
-- o realizado deixa de contar PP que ainda não foi enviada (02/09/2026).
--
-- Decisões do Tiago em 02/09/2026 (docs/decisions/039):
--
--   1. "Gerar PP" cria a PP com status `gerada` (enum estendido na migration
--      anterior). Ela fica no job, editável e cancelável, até alguém enviá-la
--      ao financeiro — só então entra em `em_avaliacao`, como hoje.
--   2. O envio é registrado: `enviada_financeiro_em` / `enviada_financeiro_por`.
--      `emitida_por` continua sendo quem GEROU. As PPs existentes foram todas
--      enviadas na própria geração (era o único caminho), então o backfill
--      copia `created_at` e `emitida_por` — preenche o que estava vazio, não
--      sobrescreve nada.
--   3. Não há mais "máximo aceito nesta PP". O trigger `pp_valida_saldo_do_item`
--      barrava a soma das PPs acima do ORÇADO do item; sai. O que resta é a
--      regra de ENVIO, na server action: acima do PLANEJADO do item, só o
--      responsável do job ou administrador envia, com confirmação explícita.
--   4. PP gerada conta só nas pendências. Ela fica FORA do realizado da
--      planilha (`recalcular_realizado_do_item`), fora do consumo que congela a
--      previsão da abertura e fora de tudo que o financeiro vê. Rejeitada segue
--      contando, como antes — ela ocupa o item até ser corrigida ou cancelada.
--
-- Aditiva, exceto pela remoção do trigger, autorizada pelo Tiago em
-- 02/09/2026 ("Sim, derrubar").
-- ---------------------------------------------------------------------------

-- ---------- 1. Registro do envio ao financeiro ----------
alter table public.pedidos_compra
  add column if not exists enviada_financeiro_em timestamptz,
  add column if not exists enviada_financeiro_por uuid references public.profiles(id);

comment on column public.pedidos_compra.enviada_financeiro_em is
  'Quando a PP saiu de gerada e entrou em avaliação no financeiro. Nula enquanto gerada.';
comment on column public.pedidos_compra.enviada_financeiro_por is
  'Quem enviou a PP ao financeiro. Pode diferir de emitida_por, que é quem gerou.';
comment on column public.pedidos_compra.emitida_por is
  'Quem GEROU a PP. Desde 02/09/2026 gerar não envia: o envio fica em enviada_financeiro_por.';
comment on column public.pedidos_compra.status is
  'gerada: no job, ainda não enviada ao financeiro (02/09/2026) · em_avaliacao: no financeiro · aprovada · pago · rejeitada · cancelada.';

-- Toda PP anterior a esta migration foi enviada no ato da geração.
update public.pedidos_compra
   set enviada_financeiro_em  = created_at,
       enviada_financeiro_por = emitida_por
 where status <> 'gerada'
   and enviada_financeiro_em is null;

-- ---------- 2. Fim do teto por PP ----------
drop trigger if exists trg_pp_valida_saldo_do_item on public.pedidos_compra;
drop function if exists public.pp_valida_saldo_do_item();

-- ---------- 3. Realizado sem PP gerada ----------
-- Mesma função de 20260901180001, com um filtro a mais: `gerada` não pesa.
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

  -- PP gerada ainda não saiu do job: não é realizado (02/09/2026).
  select count(*),
         coalesce(sum(valor), 0),
         coalesce(sum(quantidade), 0),
         coalesce(sum(valor_unitario), 0),
         coalesce(sum(dias_meses), 0)
    into v_n_pps, v_total, v_qtd, v_unit, v_dm
    from public.pedidos_compra
   where item_realizado_id = p_item_realizado_id
     and status not in ('cancelada', 'gerada');

  select coalesce(sum(pv.valor_devolvido), 0)
    into v_devolvido
    from public.pp_verba_prestacoes pv
    join public.pedidos_compra pp on pp.id = pv.pedido_compra_id
   where pp.item_realizado_id = p_item_realizado_id
     and pp.status not in ('cancelada', 'gerada');

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
  'Realizado do item = soma das PPs que chegaram ao financeiro (fora cancelada e gerada) menos devoluções de verba. Decomposição só com uma PP.';

-- ---------- 4. Contagem de pendências por job ----------
-- O chip da calha carrega quantas PPs geradas o item tem, e a página do
-- job lê todas as PPs dele de uma vez. Índice parcial para esse recorte
-- não pesar conforme o histórico cresce.
create index if not exists idx_pp_geradas_por_job
  on public.pedidos_compra (job_id)
  where status = 'gerada';
