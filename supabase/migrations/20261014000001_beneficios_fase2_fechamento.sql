-- Migration: Benefícios — Fase 2 (Fechamento Mensal)
-- Spec: docs/modulos/rh/53-beneficios-fechamento-mensal.md
-- ADR: docs/decisions/174-beneficios-integracao-folha-e-dre.md
-- Plano: docs/modulos/rh/55-beneficios-fase-2-plano-de-execucao.md (S1)
--
-- Esta migration cria a infra de fechamento mensal:
-- 2 tabelas (beneficio_fechamento_mensal, beneficio_fechamento_linha)
-- 2 colunas em beneficios (dia_vencimento_fatura, vencimento_mes_seguinte)
-- 1 função SQL (fn_beneficios_calcular_fechamento)
-- 1 view (vw_dre_despesa_pessoal_ajustada_mensal — DRE opção B.3 do ADR 174)
-- Policies RLS iguais às de Fase 1; UPDATE em _linha propositalmente ausente (snapshot imutável).
--
-- Zero UI nesta fase. UI de fechamento entra na Fase 3 junto com "Aplicar descontos".
-- 100% aditiva — nenhuma mudança destrutiva.
--
-- Rulings aplicadas (ver .superpowers/sdd/.../progress.md):
-- - FK alvo = public.profiles (não "perfis"); convenção de Fase 1.
-- - colaborador_beneficio usa data_inicio/data_fim (não iniciado/encerrado).
-- - fn_beneficios_custo_mensal assinatura real: (p_ano int, p_mes int, p_colaborador_id uuid).
-- - Nova fn_beneficios_calcular_fechamento itera colaboradores do tenant e reusa a fn Fase 1.
-- - Mapeamento: valor_titular ← valor_integral_titular;
--               valor_integral ← valor_integral_titular + valor_dependentes_total;
--               valor_empresa ← valor_empresa_titular;
--               valor_colaborador ← valor_desconto_folha_total;
--               qtd_dependentes_na_competencia ← qtde_dependentes.

begin;

-- =============================================================================
-- 1. Colunas de vencimento em beneficios + seed
-- =============================================================================

alter table public.beneficios
  add column dia_vencimento_fatura int check (dia_vencimento_fatura between 1 and 31),
  add column vencimento_mes_seguinte boolean not null default true;

comment on column public.beneficios.dia_vencimento_fatura is
  'Dia do mês em que vence o boleto da operadora. Fase 3 usa isso + vencimento_mes_seguinte para calcular data_vencimento da avulsa gerada.';
comment on column public.beneficios.vencimento_mes_seguinte is
  'Se true, o vencimento cai no mês seguinte à competência (SulAmerica, Bradesco). Se false, no mês da própria competência.';

update public.beneficios
set dia_vencimento_fatura = 5
where operadora ilike 'SulAmerica%';

update public.beneficios
set dia_vencimento_fatura = 29
where operadora ilike 'Bradesco%';

-- =============================================================================
-- 2. Tabela beneficio_fechamento_mensal (cabeçalho)
-- =============================================================================

create table public.beneficio_fechamento_mensal (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  ano int not null check (ano between 2024 and 2100),
  mes int not null check (mes between 1 and 12),
  fechado_em timestamptz not null default now(),
  fechado_por uuid not null references public.profiles(id) on delete restrict,
  reaberto_em timestamptz,
  reaberto_por uuid references public.profiles(id) on delete restrict,
  observacao text,

  constraint uq_fechamento_tenant_competencia unique (tenant_id, ano, mes)
);

create index idx_fechamento_mensal_tenant on public.beneficio_fechamento_mensal (tenant_id, ano, mes);

comment on table public.beneficio_fechamento_mensal is
  'Snapshot da competência de benefícios. Uma linha por (tenant, ano, mes). Enquanto reaberto_em is null, o fechamento está vigente e aparece no DRE via vw_dre_despesa_pessoal_ajustada_mensal.';

-- =============================================================================
-- 3. Tabela beneficio_fechamento_linha (detalhe, imutável)
-- =============================================================================

create table public.beneficio_fechamento_linha (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  fechamento_id uuid not null references public.beneficio_fechamento_mensal(id) on delete cascade,

  colaborador_beneficio_id uuid not null references public.colaborador_beneficio(id) on delete restrict,
  colaborador_id uuid not null references public.colaboradores(id) on delete restrict,
  beneficio_id uuid not null references public.beneficios(id) on delete restrict,

  beneficio_nome text not null,
  beneficio_operadora text not null,
  beneficio_tipo public.beneficio_tipo not null,

  modo_custeio public.beneficio_modo_custeio not null,

  valor_titular numeric(10, 2) not null check (valor_titular >= 0),
  valor_dependentes_total numeric(10, 2) not null default 0 check (valor_dependentes_total >= 0),
  valor_integral numeric(10, 2) not null check (valor_integral >= 0),
  valor_empresa numeric(10, 2) not null check (valor_empresa >= 0),
  valor_colaborador numeric(10, 2) not null check (valor_colaborador >= 0),

  qtd_dependentes_na_competencia int not null default 0 check (qtd_dependentes_na_competencia >= 0),

  created_at timestamptz not null default now(),

  constraint chk_fechamento_linha_soma
    check (abs((valor_empresa + valor_colaborador) - valor_integral) < 0.01)
);

create index idx_fechamento_linha_fechamento on public.beneficio_fechamento_linha (fechamento_id);
create index idx_fechamento_linha_colaborador on public.beneficio_fechamento_linha (colaborador_id);
create index idx_fechamento_linha_beneficio on public.beneficio_fechamento_linha (beneficio_id);
create index idx_fechamento_linha_operadora on public.beneficio_fechamento_linha (beneficio_operadora);

comment on table public.beneficio_fechamento_linha is
  'Detalhe do fechamento: uma linha por colaborador_beneficio ativo na competência. Imutável após inserção — não aceita UPDATE (sem policy, sem grant). Para corrigir, desaplicar o fechamento (apaga via cascade) e aplicar de novo.';

-- =============================================================================
-- 4. Função fn_beneficios_calcular_fechamento (cálculo puro, não grava)
-- =============================================================================

create or replace function public.fn_beneficios_calcular_fechamento(
  p_tenant_id uuid,
  p_ano int,
  p_mes int
)
returns table (
  colaborador_beneficio_id uuid,
  colaborador_id uuid,
  beneficio_id uuid,
  beneficio_nome text,
  beneficio_operadora text,
  beneficio_tipo public.beneficio_tipo,
  modo_custeio public.beneficio_modo_custeio,
  valor_titular numeric,
  valor_dependentes_total numeric,
  valor_integral numeric,
  valor_empresa numeric,
  valor_colaborador numeric,
  qtd_dependentes_na_competencia int
)
language plpgsql
security invoker
stable
as $$
declare
  r_colab record;
  r_fn record;
begin
  -- Itera por todos os colaboradores do tenant com pelo menos 1 vínculo ativo na competência.
  -- "Ativo na competência" = data_inicio <= último dia do mês AND (data_fim is null OR data_fim > primeiro dia do mês).
  for r_colab in
    select distinct c.id as col_id
    from public.colaboradores c
    join public.colaborador_beneficio cb on cb.colaborador_id = c.id
    where c.tenant_id = p_tenant_id
      and cb.data_inicio <= (make_date(p_ano, p_mes, 1) + interval '1 month' - interval '1 day')::date
      and (cb.data_fim is null or cb.data_fim > make_date(p_ano, p_mes, 1))
  loop
    -- Reusa a função de cálculo da Fase 1 (idade na competência, faixa, modo custeio, deps).
    for r_fn in
      select
        fn.vinculo_id,
        fn.beneficio_id as b_id,
        fn.beneficio_nome,
        fn.beneficio_tipo as b_tipo,
        fn.modo_custeio as b_modo,
        fn.valor_integral_titular,
        fn.valor_empresa_titular,
        fn.valor_dependentes_total as deps_total,
        fn.valor_desconto_folha_total,
        fn.qtde_dependentes,
        b.operadora as b_operadora
      from public.fn_beneficios_custo_mensal(p_ano, p_mes, r_colab.col_id) fn
      join public.beneficios b on b.id = fn.beneficio_id
    loop
      colaborador_beneficio_id := r_fn.vinculo_id;
      colaborador_id := r_colab.col_id;
      beneficio_id := r_fn.b_id;
      beneficio_nome := r_fn.beneficio_nome;
      beneficio_operadora := r_fn.b_operadora;
      beneficio_tipo := r_fn.b_tipo;
      modo_custeio := r_fn.b_modo;
      valor_titular := r_fn.valor_integral_titular;
      valor_dependentes_total := r_fn.deps_total;
      valor_integral := r_fn.valor_integral_titular + r_fn.deps_total;
      valor_empresa := r_fn.valor_empresa_titular;
      valor_colaborador := r_fn.valor_desconto_folha_total;
      qtd_dependentes_na_competencia := r_fn.qtde_dependentes;
      return next;
    end loop;
  end loop;
end;
$$;

comment on function public.fn_beneficios_calcular_fechamento is
  'Calcula o snapshot da competência (p_ano, p_mes) para o tenant. Retorna uma linha por colaborador_beneficio ativo. Fase 3 insere o resultado em beneficio_fechamento_linha dentro de uma transação com beneficio_fechamento_mensal. Executa com SECURITY INVOKER — RLS do chamador aplicada. Reusa fn_beneficios_custo_mensal da Fase 1 para a lógica de idade/faixa/custeio.';

grant execute on function public.fn_beneficios_calcular_fechamento(uuid, int, int) to authenticated;

-- =============================================================================
-- 5. View vw_dre_despesa_pessoal_ajustada_mensal (DRE opção B.3)
-- =============================================================================

create view public.vw_dre_despesa_pessoal_ajustada_mensal as
select
  f.tenant_id,
  f.ano,
  f.mes,
  coalesce(sum(l.valor_integral), 0) as valor_bruto_beneficios,
  coalesce(sum(l.valor_empresa), 0) as valor_dre_beneficios,
  coalesce(sum(l.valor_colaborador), 0) as valor_dre_pessoal_ajuste
from public.beneficio_fechamento_mensal f
join public.beneficio_fechamento_linha l on l.fechamento_id = f.id
where f.reaberto_em is null
group by f.tenant_id, f.ano, f.mes;

comment on view public.vw_dre_despesa_pessoal_ajustada_mensal is
  'Ajuste do DRE para benefícios conforme ADR 174 (opção B.3). A avulsa de operadora entra no banco com valor cheio no subtipo "Benefícios"; esta view permite ao DRE separar: valor_dre_beneficios (parte empresa, despesa real do subtipo Benefícios 05.002) e valor_dre_pessoal_ajuste (repasse do colaborador, soma em Despesa com Pessoal 05.015 ou equivalente). Fechamentos reabertos (reaberto_em not null) são ignorados. Fonte-verdade: docs/decisions/174-beneficios-integracao-folha-e-dre.md.';

-- =============================================================================
-- 6. RLS + Policies
-- =============================================================================

alter table public.beneficio_fechamento_mensal enable row level security;
alter table public.beneficio_fechamento_linha enable row level security;

-- --- beneficio_fechamento_mensal (4 policies) ---

create policy "sel_fechamento_mensal_admin_rh"
  on public.beneficio_fechamento_mensal for select
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "ins_fechamento_mensal_admin_rh"
  on public.beneficio_fechamento_mensal for insert
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "upd_fechamento_mensal_admin_rh"
  on public.beneficio_fechamento_mensal for update
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "del_fechamento_mensal_admin_rh"
  on public.beneficio_fechamento_mensal for delete
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

-- --- beneficio_fechamento_linha (4 policies — sem UPDATE!) ---

create policy "sel_fechamento_linha_admin_rh"
  on public.beneficio_fechamento_linha for select
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "sel_fechamento_linha_colaborador_proprio"
  on public.beneficio_fechamento_linha for select
  using (public.is_colaborador_proprio(colaborador_id));

create policy "ins_fechamento_linha_admin_rh"
  on public.beneficio_fechamento_linha for insert
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "del_fechamento_linha_admin_rh"
  on public.beneficio_fechamento_linha for delete
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

-- Deliberadamente nenhuma policy de UPDATE em _linha. Snapshot é imutável.

-- =============================================================================
-- 7. GRANTs (zero para anon; UPDATE em _linha deliberadamente ausente)
-- =============================================================================

grant select, insert, update, delete on public.beneficio_fechamento_mensal to authenticated;
grant select, insert, delete on public.beneficio_fechamento_linha to authenticated;
grant select on public.vw_dre_despesa_pessoal_ajustada_mensal to authenticated;

commit;
