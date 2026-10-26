-- Prepara freelancer_solicitacoes para absorver a re-migração do AgCaliforniaRH.
--
-- Por que: a re-migração do dia 26/10/2026 precisa importar as 40 solicitações
-- do RH antigo. Duas colunas faltavam:
--   - legado_id uuid unique: ancora pra idempotência da importação (ON CONFLICT).
--     Mesma estratégia que freelancers e freelancer_contratos (Task 028).
--   - nome_job text: no RH antigo a solicitação guardava só o nome do job como
--     texto (sem FK). No ERP temos job_id FK pra public.jobs, mas nenhum dos
--     342 jobs antigos existe aqui. Preservar o texto evita perder a referência
--     que o RH usa na UI de "pendente de aprovação".
alter table public.freelancer_solicitacoes
  add column if not exists legado_id uuid,
  add column if not exists nome_job text;

create unique index if not exists uq_freelancer_solicitacoes_legado_id
  on public.freelancer_solicitacoes (legado_id)
  where legado_id is not null;

comment on column public.freelancer_solicitacoes.legado_id is
  'ID original no AgCaliforniaRH quando a solicitação veio por migração (26/10/2026). Null em novas.';

comment on column public.freelancer_solicitacoes.nome_job is
  'Nome do job (texto) do RH antigo quando job_id não pôde ser mapeado para um job real do califa-erp.';
