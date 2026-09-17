-- =====================================================================
-- RH — Fase 6: colaboradores_salarios (histórico = movimentação salarial)
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Histórico salarial do colaborador. Cada linha é uma MUDANÇA. Salário
-- vigente = linha com data_fim IS NULL (unique parcial garante uma só
-- por colaborador). Não existe tabela separada de "movimentação
-- salarial" — o próprio histórico É a movimentação:
--
--   • Salário sobe de R$ 3.000 → R$ 4.000:
--       UPDATE linha vigente SET data_fim = today
--       INSERT nova linha com valor=4000, data_inicio=today
--       (delta = 1.000 é derivado da comparação com a linha anterior)
--
-- Dependências:
--   • public.tenants                                  — Task 001
--   • public.colaboradores                            — Fase 4
--   • public.profiles                                 — Task 001
--   • public.is_tenant_admin(uuid), is_tenant_rh(uuid)
--
-- Decisões (docs/modulos/rh/03-modelo-de-dados.md §Tabela colaboradores_salarios):
--   • Um único salário vigente por colaborador — unique parcial em
--     (colaborador_id) WHERE data_fim IS NULL.
--   • Não há trigger de "obrigatório ter salário vigente" — colaborador
--     pode existir sem salário registrado (cadastro rápido). Antes da
--     folha, será exigido pela server action da folha.
--   • Folha (fase futura) CONGELA o salário no snapshot — mesma lógica
--     da alocação. Aqui é fonte-verdade viva; snapshot vem depois.
--   • DELETE liberado para admin/rh — escape hatch para erro de
--     digitação. corrigirSalarioAtual (UPDATE) é o caminho padrão.
--
-- Aditivo do começo ao fim.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------

create table if not exists public.colaboradores_salarios (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  colaborador_id  uuid not null references public.colaboradores(id) on delete cascade,

  valor           numeric(14,2) not null,
  data_inicio     date not null,
  data_fim        date,

  motivo          text,
  aprovado_por    uuid references public.profiles(id),

  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),

  constraint chk_salarios_valor_positivo check (valor > 0),
  constraint chk_salarios_periodo_valido check (data_fim is null or data_fim >= data_inicio)
);

comment on table public.colaboradores_salarios is
  'Historico salarial do colaborador. Cada linha e uma MUDANCA de salario. Salario vigente = linha com data_fim IS NULL (unique parcial garante uma so). Movimentacao salarial nao existe como tabela separada — este historico ja e a movimentacao.';
comment on column public.colaboradores_salarios.valor is
  'Salario ou pro-labore mensal em BRL. Congelado no snapshot da folha na fase futura (Camada 2).';
comment on column public.colaboradores_salarios.motivo is
  'Livre. Padrao esperado: dissidio, promocao, reclassificacao, correcao contratual.';
comment on column public.colaboradores_salarios.aprovado_por is
  'Profile de quem aprovou a mudanca. Opcional no MVP (workflow de aprovacao e fase futura).';


-- ---------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------

-- Um único salário vigente por colaborador.
create unique index if not exists uniq_salario_vigente_por_colaborador
  on public.colaboradores_salarios (colaborador_id)
  where data_fim is null;

create index if not exists idx_salarios_colaborador
  on public.colaboradores_salarios (colaborador_id);

create index if not exists idx_salarios_tenant
  on public.colaboradores_salarios (tenant_id);


-- ---------------------------------------------------------------------
-- 3. RLS + policies (admin OR rh — inclui DELETE)
-- ---------------------------------------------------------------------

alter table public.colaboradores_salarios enable row level security;

drop policy if exists salarios_select on public.colaboradores_salarios;
create policy salarios_select on public.colaboradores_salarios
  for select to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists salarios_insert on public.colaboradores_salarios;
create policy salarios_insert on public.colaboradores_salarios
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists salarios_update on public.colaboradores_salarios;
create policy salarios_update on public.colaboradores_salarios
  for update to authenticated
  using  (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists salarios_delete on public.colaboradores_salarios;
create policy salarios_delete on public.colaboradores_salarios
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));


-- ---------------------------------------------------------------------
-- 4. GRANT (inclui DELETE)
-- ---------------------------------------------------------------------

grant select, insert, update, delete on public.colaboradores_salarios to authenticated;
