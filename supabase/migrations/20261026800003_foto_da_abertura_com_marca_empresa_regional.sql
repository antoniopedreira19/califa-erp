-- =====================================================================
-- A foto do registro da abertura guarda marca, empresa e regional
-- (decisão 214, 26/10/2026)
-- ---------------------------------------------------------------------
-- O registro do financeiro passa a ter Marca, Empresa e Regional
-- editáveis (migration 20261026800002). A foto de cada confirmação
-- (`jobs_aberturas`, decisão 059) guarda os três, como guarda categoria e
-- serviço: o "Visualizar" do histórico mostra o que ficou registrado.
-- Foto anterior a esta migration fica com os três nulos ("—").
--
-- Mudança aditiva: três colunas nulas. `on delete set null` porque a foto
-- é histórico e não deve segurar a exclusão de nada.
-- =====================================================================

alter table public.jobs_aberturas
  add column if not exists empresa_id uuid references public.empresas(id) on delete set null,
  add column if not exists regional_id uuid references public.regionais(id) on delete set null,
  add column if not exists produto_id uuid references public.cliente_produtos(id) on delete set null;

comment on column public.jobs_aberturas.produto_id is
  'Marca do job registrada nesta foto (decisão 214). Nula nas fotos anteriores a 26/10/2026.';
