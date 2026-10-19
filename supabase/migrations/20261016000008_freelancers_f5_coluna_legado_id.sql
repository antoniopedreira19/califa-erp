-- Task 028 — Freelancers (Fase 5): coluna legado_id
--
-- Adiciona `legado_id uuid unique` em freelancers e freelancer_contratos
-- pra ancorar a migração dos registros do AgCaliforniaRH. Idempotência da
-- migração vem dessa coluna (ON CONFLICT (legado_id) DO NOTHING).

alter table public.freelancers
  add column if not exists legado_id uuid;

create unique index if not exists uq_freelancers_legado_id
  on public.freelancers (legado_id)
  where legado_id is not null;

comment on column public.freelancers.legado_id is
  'ID original no AgCaliforniaRH quando o registro veio por migração (Task 028). Null em cadastros novos do califa-erp.';

alter table public.freelancer_contratos
  add column if not exists legado_id uuid;

create unique index if not exists uq_freelancer_contratos_legado_id
  on public.freelancer_contratos (legado_id)
  where legado_id is not null;

comment on column public.freelancer_contratos.legado_id is
  'ID original no AgCaliforniaRH quando o contrato veio por migração (Task 028). Null em contratos novos.';
