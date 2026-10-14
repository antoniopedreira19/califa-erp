-- Migration: Benefícios — Fase 3 (Schema + Seed de fornecedores)
-- Spec: docs/modulos/rh/54-beneficios-integracao-folha.md
-- ADR: docs/decisions/174-beneficios-integracao-folha-e-dre.md
-- Plano: docs/modulos/rh/56-beneficios-fase-3-plano-de-execucao.md (S1)
--
-- Esta migration adiciona:
-- - Colunas em beneficios (fornecedor_id, empresa_id)
-- - Coluna em folhas_pagamento (desconto_beneficios)
-- - Coluna em contas_avulsas (beneficio_fechamento_id)
-- - Seed: SulAmerica Saude + Bradesco Dental em fornecedores
-- - UPDATE: beneficios aponta pra fornecedor + Agência California como empresa
--
-- 100% aditiva. Nenhuma mudança destrutiva. Dados bancários dos fornecedores
-- são preenchidos manualmente por Daniel em /financeiro/fornecedores depois.

begin;

-- =============================================================================
-- 1. Colunas em beneficios + índices + comments
-- =============================================================================

alter table public.beneficios
  add column fornecedor_id uuid references public.fornecedores(id) on delete restrict,
  add column empresa_id uuid references public.empresas(id) on delete restrict;

create index idx_beneficios_fornecedor on public.beneficios (fornecedor_id)
  where fornecedor_id is not null;
create index idx_beneficios_empresa on public.beneficios (empresa_id)
  where empresa_id is not null;

comment on column public.beneficios.fornecedor_id is
  'Fornecedor da operadora (SulAmerica, Bradesco). Lido pelo aplicar_fechamento_beneficios para popular a avulsa gerada. Null = benefício sem integração com Contas a Pagar.';
comment on column public.beneficios.empresa_id is
  'Empresa (CNPJ) que paga a fatura do benefício. Default no seed = Agência California. Null = benefício sem integração com Contas a Pagar.';

-- =============================================================================
-- 2. Coluna em folhas_pagamento
-- =============================================================================

alter table public.folhas_pagamento
  add column desconto_beneficios numeric(10, 2) not null default 0
    check (desconto_beneficios >= 0);

comment on column public.folhas_pagamento.desconto_beneficios is
  'Valor subtraido do salario_base ao aplicar o fechamento mensal de beneficios (Fase 3). salario_base armazena o valor LIQUIDO (pos-desconto); esta coluna existe para auditoria e para a reversao em Desaplicar. So populado em linhas com origem california (PJ gerada). Linhas CLT (origem contabilidade) ficam sempre em 0.';

-- =============================================================================
-- 3. Coluna em contas_avulsas + FK + índice
-- =============================================================================

alter table public.contas_avulsas
  add column beneficio_fechamento_id uuid
    references public.beneficio_fechamento_mensal(id) on delete restrict;

create index idx_contas_avulsas_beneficio_fechamento
  on public.contas_avulsas (beneficio_fechamento_id)
  where beneficio_fechamento_id is not null;

comment on column public.contas_avulsas.beneficio_fechamento_id is
  'Avulsa de operadora de beneficio (SulAmerica/Bradesco) gerada pelo fechamento mensal da Fase 3. Permite rastrear a fatura ao snapshot (quem contribuiu com quanto). Null em todas as outras avulsas.';

-- =============================================================================
-- 4. INSERT em fornecedores (SulAmerica + Bradesco Dental)
-- =============================================================================

insert into public.fornecedores (tenant_id, nome)
values
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, 'SulAmerica Saude'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, 'Bradesco Dental');

-- =============================================================================
-- 5. UPDATE em beneficios populando fornecedor + empresa (Agência California)
-- =============================================================================

update public.beneficios
set
  fornecedor_id = (
    select id from public.fornecedores
    where nome = 'SulAmerica Saude'
      and tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid
  ),
  empresa_id = '304039bd-509d-4536-aa26-44e7091ee718'::uuid
where operadora ilike 'SulAmerica%';

update public.beneficios
set
  fornecedor_id = (
    select id from public.fornecedores
    where nome = 'Bradesco Dental'
      and tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid
  ),
  empresa_id = '304039bd-509d-4536-aa26-44e7091ee718'::uuid
where operadora ilike 'Bradesco%';

commit;
