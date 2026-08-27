-- =====================================================================
-- chk_estorno_consistente aceita pp_devolucao_verba_estornada
--
-- estornar_baixa_devolucao_verba insere o reverso com
-- estorno_de_lancamento_id NOT NULL, mas o CHECK só reconhecia
-- pp_estorno e avulsa_estorno como origens legítimas dessa situação —
-- pp_devolucao_verba_estornada caía na branch que exige NULL, causando
-- CHECK violation em todo estorno de devolução de verba.
--
-- Adiciona pp_devolucao_verba_estornada à lista. NÃO toca em outros
-- valores fora do escopo desta feature (titulo_estorno e desembolso_estorno
-- podem ter gap similar mas são de outra frente).
-- =====================================================================

alter table public.lancamentos_financeiros
  drop constraint if exists chk_estorno_consistente;

alter table public.lancamentos_financeiros
  add constraint chk_estorno_consistente check (
    (
      origem in ('pp_estorno'::origem_lancamento, 'avulsa_estorno'::origem_lancamento, 'pp_devolucao_verba_estornada'::origem_lancamento)
      and estorno_de_lancamento_id is not null
    )
    or
    (
      origem not in ('pp_estorno'::origem_lancamento, 'avulsa_estorno'::origem_lancamento, 'pp_devolucao_verba_estornada'::origem_lancamento)
      and estorno_de_lancamento_id is null
    )
  );
