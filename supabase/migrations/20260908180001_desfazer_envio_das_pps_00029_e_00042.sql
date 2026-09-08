-- ---------------------------------------------------------------------------
-- 20260908180001 — PP-00029 e PP-00042 voltam a `gerada`: o envio ao
-- financeiro é desfeito.
--
-- Pedido do Tiago em 08/09/2026, sobre o JOB-0031 (IMC STELLA ARTOIS):
-- devolver duas PPs ao estado anterior ao envio, "como se ainda não
-- tivessem sido enviadas ao financeiro".
--
--   PP-00029 · R$ 2.000,00 · item "Produtor Master / Campo Salvador" (EQUIPE)
--   PP-00042 · R$   800,00 · item "Verba de Produção (Shooting, PDV's)"
--                                 (SALVADOR - 2 DIÁRIAS | 1 PDV POR DIÁRIA)
--
-- Não existe superfície no sistema que faça isso: `enviarPedidoCompraAoFinanceiro`
-- (decisão 039) é caminho de mão única — o financeiro devolve por rejeição,
-- que é outro estado e continua pesando no realizado. Daí a correção vir por
-- migration, como a 20260908100001.
--
-- É o inverso EXATO do envio: as três colunas que a action grava, e só elas.
--   status                 em_avaliacao -> gerada
--   enviada_financeiro_em  -> null
--   enviada_financeiro_por -> null
--
-- O que muda por tabela:
--   · `jobs_itens_realizado` — o trigger `trg_pp_recalcula_realizado` refaz o
--     realizado dos dois itens. PP `gerada` não é realizado (decisão 039 §4),
--     então os dois voltam a zero e o realizado do job cai R$ 2.800,00.
--   · `pps_concluidas_em` dos itens NÃO é tocada: o marco é resposta sobre o
--     ITEM, não sobre o envio (decisão 052).
--   · Previsão de custo NÃO muda: `gerada` e `em_avaliacao` estão as duas em
--     `sem_titulo` na `vw_fluxo_caixa_job` (20260904200002).
--   · Parcelas e anexos ficam onde estão — é o estado normal de uma PP gerada
--     (20260902160003).
--
-- Conferido antes de aplicar: nenhuma das duas foi aprovada, paga, rejeitada
-- ou cancelada, e não há lançamento financeiro, prestação de contas nem
-- devolução apontando para elas. O `where` repete essas condições como trava:
-- se o financeiro tiver mexido entre a conferência e a aplicação, o update
-- não pega a linha em vez de atropelar o trabalho dele.
--
-- Destrutiva (sobrescreve valor existente e some com realizado já lançado).
-- Autorizada pelo Tiago em 08/09/2026. Idempotente: rodar de novo não
-- encontra nada, porque exige `em_avaliacao`.
-- ---------------------------------------------------------------------------

with revertidas as (
  update public.pedidos_compra pc
     set status                 = 'gerada',
         enviada_financeiro_em  = null,
         enviada_financeiro_por = null
   where pc.tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
     and pc.job_id    = '56983667-011a-4098-8cb9-62194d1f456a'
     and pc.codigo in ('PP-00029', 'PP-00042')
     and pc.status = 'em_avaliacao'
     and pc.aprovada_em  is null
     and pc.rejeitada_em is null
     and pc.cancelada_em is null
     and pc.pago_em      is null
     and not exists (
       select 1
         from public.lancamentos_financeiros lf
        where lf.pedido_compra_id = pc.id
     )
  returning pc.id,
            pc.tenant_id,
            pc.codigo,
            pc.job_id,
            pc.item_realizado_id,
            pc.valor,
            pc.verba_producao
)
insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
select r.tenant_id,
       null,
       'pedido_compra.envio_desfeito',
       'pedido_compra',
       r.id::text,
       jsonb_build_object(
         'pp_codigo',          r.codigo,
         'valor',              r.valor,
         'job_id',             r.job_id,
         'item_realizado_id',  r.item_realizado_id,
         'verba_producao',     r.verba_producao,
         'status_anterior',    'em_avaliacao',
         'status_novo',        'gerada',
         'origem',             'migration 20260908180001',
         'autorizado_por',     'Tiago, em 08/09/2026'
       )
  from revertidas r;
