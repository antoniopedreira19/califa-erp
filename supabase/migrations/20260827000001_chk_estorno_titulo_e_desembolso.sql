-- =====================================================================
-- chk_estorno_consistente aceita titulo_estorno e desembolso_estorno
--
-- Diagnostico feito em 27/08/2026: as RPCs estornar_baixa_titulo (do
-- contas a receber) e estornar_baixa_desembolso_parcela inserem
-- lancamento com estorno_de_lancamento_id NOT NULL. Mas o CHECK
-- chk_estorno_consistente nunca foi atualizado para incluir essas
-- origens — a primeira tentativa de estorno em qualquer dos dois
-- fluxos ia quebrar com CHECK violation. Bug latente: zero linhas
-- com essas origens hoje.
--
-- Fix preventivo: amplia a lista das duas branches do CHECK com
-- titulo_estorno e desembolso_estorno. Mesma familia das migrations
-- 000008 e 000009 (CHECKs desatualizados quando novas origens foram
-- adicionadas).
-- =====================================================================

alter table public.lancamentos_financeiros
  drop constraint if exists chk_estorno_consistente;

alter table public.lancamentos_financeiros
  add constraint chk_estorno_consistente check (
    (
      origem in (
        'pp_estorno'::origem_lancamento,
        'avulsa_estorno'::origem_lancamento,
        'pp_devolucao_verba_estornada'::origem_lancamento,
        'titulo_estorno'::origem_lancamento,
        'desembolso_estorno'::origem_lancamento
      )
      and estorno_de_lancamento_id is not null
    )
    or
    (
      origem not in (
        'pp_estorno'::origem_lancamento,
        'avulsa_estorno'::origem_lancamento,
        'pp_devolucao_verba_estornada'::origem_lancamento,
        'titulo_estorno'::origem_lancamento,
        'desembolso_estorno'::origem_lancamento
      )
      and estorno_de_lancamento_id is null
    )
  );
