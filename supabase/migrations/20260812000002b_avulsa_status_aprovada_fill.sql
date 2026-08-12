-- =====================================================================
-- Contas avulsas: preenche aprovada_em/aprovada_por + migra pendente -> aprovada
-- =====================================================================

-- 2. Colunas de auditoria da aprovação
alter table public.contas_avulsas
  add column if not exists aprovada_em timestamptz,
  add column if not exists aprovada_por uuid references public.profiles(id);

-- 3. Retro fill pra linhas existentes (pendente + baixada, todas foram
-- criadas como "pendente" — nossa versão nova diria "aprovada")
update public.contas_avulsas
   set aprovada_em = coalesce(aprovada_em, created_at),
       aprovada_por = coalesce(aprovada_por, criado_por)
 where aprovada_em is null;

comment on column public.contas_avulsas.aprovada_em is
  'Retroativo pra linhas anteriores a 2026-08-12 = created_at (aprovação implícita)';

-- 4. Migra status: pendente -> aprovada
update public.contas_avulsas
   set status = 'aprovada'
 where status = 'pendente';

-- 5. Novo default é 'aprovada' (nasce aprovada)
alter table public.contas_avulsas
  alter column status set default 'aprovada';

-- 6. Constraint nova: se status é aprovada ou baixada, precisa de aprovada_em/aprovada_por
alter table public.contas_avulsas
  drop constraint if exists chk_avulsa_baixa_consistente;

alter table public.contas_avulsas
  add constraint chk_avulsa_aprovada_consistente check (
    -- aprovada ou baixada exigem os campos de aprovação
    (status in ('aprovada','baixada')
      and aprovada_em is not null
      and aprovada_por is not null)
    or
    -- pendente (legacy, tolerado até Migration B) não exige
    status = 'pendente'
  );

alter table public.contas_avulsas
  add constraint chk_avulsa_baixa_consistente check (
    (status = 'baixada'
      and pago_em is not null
      and pago_por is not null
      and conta_bancaria_baixa_id is not null)
    or
    (status <> 'baixada'
      and pago_em is null
      and pago_por is null
      and conta_bancaria_baixa_id is null)
  );

-- 7. Índice partial pra "A pagar" (aprovadas por vencimento)
create index if not exists idx_avulsas_aprovada_prazo
  on public.contas_avulsas(tenant_id, data_prevista_pagamento)
  where status = 'aprovada';
