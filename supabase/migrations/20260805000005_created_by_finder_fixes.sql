-- =====================================================================
-- Task 011 — final-review fixes: created_by columns + fornecedores embed fix
--
-- Adds created_by audit column to 3 tables that the actions already
-- reference but that the original migrations did not include.
-- =====================================================================

alter table public.contas_bancarias
  add column if not exists created_by uuid references public.profiles(id);

alter table public.plano_contas_tipos
  add column if not exists created_by uuid references public.profiles(id);

alter table public.plano_contas_subtipos
  add column if not exists created_by uuid references public.profiles(id);
