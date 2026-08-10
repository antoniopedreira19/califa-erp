-- =====================================================================
-- Task 012 — Novos valores no enum origem_lancamento
-- OBS: migration isolada por restrição do Postgres (ADD VALUE não pode
-- ser usado no mesmo statement que consome o valor).
-- =====================================================================

alter type origem_lancamento add value if not exists 'avulsa_baixa';
alter type origem_lancamento add value if not exists 'avulsa_baixa_estornada';
alter type origem_lancamento add value if not exists 'avulsa_estorno';
