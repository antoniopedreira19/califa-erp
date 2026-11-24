-- freelancer_solicitacoes: data_termino vira obrigatória.
--
-- Até hoje o form calculava data_termino a partir da duração digitada e,
-- se a duração ficasse em branco, mandava NULL pro banco — a UI caía num
-- fallback "A partir de ...". Em 24/11/2026 travamos a entrada: o front
-- bloqueia submit sem duração e o Zod exige a data. Esta migration
-- fecha o buraco no banco:
--
--   1. Backfill das 2 linhas legadas que ficaram com data_termino NULL
--      (mesmo caso: Lívia, tipo diárias, "2 diárias de 3"). Cada linha
--      vira 1 diária -> data_termino = data_inicio. Confirmado pelo
--      condutor da sessão em 24/11/2026.
--   2. ALTER COLUMN NOT NULL em data_inicio e data_termino.

update public.freelancer_solicitacoes
set data_termino = data_inicio
where data_termino is null;

alter table public.freelancer_solicitacoes
  alter column data_inicio set not null,
  alter column data_termino set not null;
