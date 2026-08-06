-- =====================================================================
-- Orçamento ganha Regional, Cidade, GP Responsável e Produtor Responsável
--
-- Origem: revisão da tela "Projetos & Orçamentos" (06/08/2026).
--
-- Regional e Cidade desceram do projeto para o orçamento: a peça é que
-- tem praça, não a iniciativa inteira. A Regional do orçamento precisa
-- ser uma das regionais do projeto — regra de aplicação, porque o banco
-- só garantiria isso com FK composta e duplicação de projeto_id em
-- projeto_regionais.
--
-- GP Responsável e Produtor Responsável nascem aqui e são o que a
-- abertura de job grava: `jobs.responsavel_id` recebe o GP e
-- `jobs.produtor_id` (criado abaixo) recebe o produtor. Antes o job
-- herdava `projetos.responsavel_id`.
--
-- Tudo nullable no banco (há 9 orçamentos gravados sem esses dados);
-- a obrigatoriedade vive no Zod do formulário.
-- =====================================================================

-- 1) Colunas novas em orcamentos ---------------------------------------
alter table public.orcamentos
  add column if not exists regional_id uuid
  references public.regionais(id) on delete restrict;

alter table public.orcamentos
  add column if not exists cidade_id uuid
  references public.cidades(id) on delete restrict;

alter table public.orcamentos
  add column if not exists gp_responsavel_id uuid
  references public.profiles(id) on delete restrict;

alter table public.orcamentos
  add column if not exists produtor_id uuid
  references public.profiles(id) on delete restrict;

create index if not exists idx_orcamentos_regional  on public.orcamentos(regional_id);
create index if not exists idx_orcamentos_cidade    on public.orcamentos(cidade_id);
create index if not exists idx_orcamentos_gp        on public.orcamentos(gp_responsavel_id);
create index if not exists idx_orcamentos_produtor  on public.orcamentos(produtor_id);

comment on column public.orcamentos.regional_id is
  'Regional da peça. Deve ser uma das regionais do projeto (validado na server action).';
comment on column public.orcamentos.gp_responsavel_id is
  'GP responsável. Vira jobs.responsavel_id na abertura.';
comment on column public.orcamentos.produtor_id is
  'Produtor responsável. Vira jobs.produtor_id na abertura.';

-- 2) jobs.produtor_id ---------------------------------------------------
alter table public.jobs
  add column if not exists produtor_id uuid
  references public.profiles(id) on delete restrict;

create index if not exists idx_jobs_produtor on public.jobs(produtor_id);

comment on column public.jobs.produtor_id is
  'Produtor responsável, herdado do orçamento na abertura.';
