-- =====================================================================
-- Rename cosmético: gp_responsavel_id -> responsavel_id em orcamentos.
--
-- Motivação: docs iniciais chamavam de "GP responsável" mas o campo
-- semanticamente é só "responsável" (o responsável pode ser qualquer
-- membro do tenant, não necessariamente com título de GP).
--
-- Rename inclui: coluna, índice e FK constraint. Não muda RLS nem GRANTs
-- (policies referenciam a tabela por nome, não a coluna).
-- =====================================================================

alter table public.orcamentos
  rename column gp_responsavel_id to responsavel_id;

alter index public.idx_orcamentos_gp
  rename to idx_orcamentos_responsavel;

alter table public.orcamentos
  rename constraint orcamentos_gp_responsavel_id_fkey
  to orcamentos_responsavel_id_fkey;
