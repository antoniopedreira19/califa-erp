# 56 — Plano de Execução do Subsistema Benefícios (Fase 3 — Integração com Folha)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar o plano sessão por sessão. Steps usam checkbox (`- [ ]`).

**Goal:** Entregar o botão "Aplicar descontos" na página da competência da folha, a tab Fechamentos read-only em `/rh/beneficios`, e a transação atômica que fecha competência + reduz salário PJ + gera avulsas por operadora.

**Architecture:** 2 migrations aditivas (schema+seed; RPCs). Server actions finos em `lib/actions/beneficios/fechamento.ts` chamam RPCs plpgsql SECURITY DEFINER. UI: `CheckpointRow` novo no checklist da folha (modificar) + tab Fechamentos em `/rh/beneficios` (novo) + página de detalhe `/rh/beneficios/fechamentos/[id]` (novo). Preview dos valores pelo `confirm()` nativo via query ao vivo em `fn_beneficios_calcular_fechamento`.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Supabase (Postgres + RLS + RPC), Tailwind, shadcn/ui + Radix, lucide-react.

**Spec:**
- [`54-beneficios-integracao-folha.md`](54-beneficios-integracao-folha.md) — spec detalhado da Fase 3.
- [`../../decisions/174-beneficios-integracao-folha-e-dre.md`](../../decisions/174-beneficios-integracao-folha-e-dre.md) — ADR 174 (fonte-verdade).
- [`53-beneficios-fechamento-mensal.md`](53-beneficios-fechamento-mensal.md) — infra consumida (Fase 2).
- [`50-beneficios.md`](50-beneficios.md) §7 — resumo das fases.

## Global Constraints

Herdadas de `CLAUDE.md` e das specs:

- **Ortografia pt-BR em toda string visível** (acentos, cedilha, til). Mensagens de erro + confirms + rótulos de UI com acento correto. Identificadores em código podem ficar sem acento.
- **`docs/FLUXO-BANCO.md`**: nada aplicado sem migration versionada; MCP só para `apply_migration` + `execute_sql`; conferência pós pelo MCP. Fase 3 é **100% aditiva** — zero mudança destrutiva.
- **`docs/PERFORMANCE.md`**: `<Link>` em lista de 5+ itens → `prefetch={false}`; agregação separada do embed; GRANT explícito para `authenticated`; policies usam `(select auth.uid())` via helpers.
- **`lib/types.ts` é escrito à mão**: migration que mexe em coluna usada pela UI atualiza o tipo no mesmo commit.
- **Audit em evento sensível**: aplicar/desaplicar benefícios → `log_audit_event` com ação no padrão `beneficio.fechamento.<verbo>`.
- **RLS gate**: admin+rh escrevem; colaborador lê o próprio via `is_colaborador_proprio`. Padrão herdado de Férias.
- **Trabalhar direto em `main`**: convenção do projeto (ver memória do user). Nenhuma branch sem autorização explícita.
- **Push é manual**: nenhum `git push` automático ao fim das sessões.
- **Sem suite de testes automatizada**. Verificação é: `tsc` + `pnpm lint` + `pnpm build` + conferência MCP + teste manual no browser com `antonio@pevetech.com.br` numa competência de teste.

## Review Focus

Classes de input e falhas que o spec implica mas que nenhum step automatizado garante. Cada linha tem o step que a exercita.

1. **Dependente incluído com `data_inicio` no mesmo mês da competência**: deve entrar no snapshot (regra atual `data_inicio <= último dia do mês`); se `data_inicio > último dia`, não entra. **Pinado em S2 §Step 2.9** via teste manual MCP com dep sintético.
2. **Vínculo encerrando no meio do mês** (`data_fim` entre dia 1 e dia 30): ainda entra no snapshot — regra `data_fim > primeiro dia do mês`. **Pinado em S2 §Step 2.9** via vinculo sintético.
3. **Fornecedor sem CNPJ ou dados bancários**: `aplicar` roda normalmente; só a remessa não é gerada. Pagamento manual pelo PDF (ADR 174 §1.8). **Pinado em S2 §Step 2.8** via fornecedor mínimo sem CNPJ.
4. **Edição do catálogo DEPOIS do fechamento**: mudar `percentual_empresa_titular` não altera snapshot já fechado (imutável). **Pinado em S5 §Step 5.9** via teste manual browser.
5. **Tentar aplicar com fornecedor_id null em algum benefício ativo**: server action retorna erro `catalogo_incompleto` com nome do benefício. **Pinado em S3 §Step 3.6** via teste MCP seguido de call pela server action.

---

## 1. Filosofia

- **1 sessão = 1 commit no mínimo, 1 PR no máximo.** 5 sessões, cada uma termina em commit em `main`.
- **Backend antes de UI.** S1-S3 constroem o chão; S4-S5 constroem o telhado.
- **Precondição manual antes de S4:** Daniel completa dados bancários dos 2 fornecedores em `/financeiro/fornecedores`. S1 cria os fornecedores mínimos; o preenchimento é humano.
- **Teste manual com competência de teste.** S5 termina com uma competência real (nova, de teste) aplicada e desaplicada ponta a ponta por Daniel + Antonio.
- **Nenhuma dívida de spec**: mudança de regra descoberta durante a implementação volta pro [`54-beneficios-integracao-folha.md`](54-beneficios-integracao-folha.md) no mesmo commit.

## 2. Visão macro: 5 sessões

```
S1 ─ Banco: Migration 1 (schema + seed de fornecedores + colunas em beneficios/folhas/avulsas)
      ↓
S2 ─ Banco: Migration 2 (RPCs aplicar/desaplicar) + verificação MCP ponta a ponta
      ↓
S3 ─ Tipos + Server actions + Queries
      ↓
S4 ─ UI: Checkpoint na folha (modificar checklist-competencia.tsx + 2 botões novos)
      ↓
S5 ─ UI: Tab Fechamentos + Página de detalhe + Teste manual ponta a ponta
```

Estimativa: **5 sessões de 2-4h cada**. Dependências lineares.

## 3. Mapa de arquivos

### Banco (S1 e S2)
- **Criar**: `supabase/migrations/2026MMDD000001_beneficios_fase3_schema.sql` (data definida no momento da sessão).
- **Criar**: `supabase/migrations/2026MMDD000002_beneficios_fase3_rpcs.sql`.

### Tipos (S3)
- **Modificar**: `lib/types.ts` — adicionar `AplicarBeneficiosResult`, `FechamentoRow`, `FechamentoDetalhe` + atualizar `Beneficio` com novas colunas + atualizar `FolhaPagamento` com `desconto_beneficios` + atualizar `ContaAvulsa` com `beneficio_fechamento_id`.

### Server actions + queries (S3)
- **Criar**: `lib/actions/beneficios/fechamento.ts` — `aplicarBeneficios`, `desaplicarBeneficios`.
- **Modificar**: `lib/queries/beneficios.ts` — adicionar `listarFechamentos`, `obterFechamento`, `temAvulsaPaga`, `obterFechamentoVigenteDaCompetencia`, `previsualizarAplicacao`.

### UI folha (S4)
- **Modificar**: `app/(app)/rh/folhas/_components/checklist-competencia.tsx` — grid 3-col + 3º `CheckpointRow`.
- **Criar**: `app/(app)/rh/folhas/_components/botao-aplicar-beneficios.tsx`.
- **Criar**: `app/(app)/rh/folhas/_components/botao-desaplicar-beneficios.tsx`.
- **Modificar**: `app/(app)/rh/folhas/[competencia]/page.tsx` — passa `beneficios` prop novo pro checklist, baseado em query de fechamento vigente.

### UI benefícios (S5)
- **Modificar**: `app/(app)/rh/beneficios/page.tsx` — 3ª tab "Fechamentos".
- **Criar**: `app/(app)/rh/beneficios/_components/tab-fechamentos.tsx` — tabela + filtro ano.
- **Criar**: `app/(app)/rh/beneficios/fechamentos/[id]/page.tsx` — página de detalhe server component.
- **Criar**: `app/(app)/rh/beneficios/fechamentos/[id]/_components/cabecalho-fechamento.tsx` — PageHeader + KPIs + ações.
- **Criar**: `app/(app)/rh/beneficios/fechamentos/[id]/_components/cards-por-operadora.tsx`.
- **Criar**: `app/(app)/rh/beneficios/fechamentos/[id]/_components/tabela-linhas-fechamento.tsx`.

---

## 4. Sessão a sessão

### S1 — Migration 1 (schema + seed)

**Objetivo**: adicionar colunas em `beneficios`/`folhas_pagamento`/`contas_avulsas` e popular `fornecedores` com SulAmerica + Bradesco Dental, com `beneficios` apontando pra eles.

- [ ] **Step 1.1 — Auditoria MCP pré-escrita**

Via MCP, confirmar:
```sql
-- UUIDs reais em uso
select id, nome from public.fornecedores
  where unaccent(lower(nome)) like unaccent(lower('%sulamerica%'))
     or unaccent(lower(nome)) like unaccent(lower('%bradesco%'));
-- Esperado: 0 linhas (fornecedores ainda não existem).

select id, nome_fantasia from public.empresas
  where unaccent(lower(nome_fantasia)) like unaccent(lower('%agência california%'));
-- Esperado: 1 linha. ID = 304039bd-509d-4536-aa26-44e7091ee718 (confirmar).

-- Confirma colunas atuais de contas_avulsas (não deve ter beneficio_fechamento_id)
select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'contas_avulsas'
    and column_name = 'beneficio_fechamento_id';
-- Esperado: 0 linhas.

-- Confirma estrutura de folhas_pagamento (não deve ter desconto_beneficios)
select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'folhas_pagamento'
    and column_name = 'desconto_beneficios';
-- Esperado: 0 linhas.

-- Confirma estrutura de beneficios (não deve ter fornecedor_id nem empresa_id)
select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'beneficios'
    and column_name in ('fornecedor_id', 'empresa_id');
-- Esperado: 0 linhas.

-- Confirma que subtipo 05.002 Benefícios existe
select id, codigo, nome from public.plano_contas_subtipos
  where codigo = '05.002';
-- Esperado: 1 linha; guardar id pra referência.
```

Se qualquer check falhar com resultado inesperado, parar e pedir instrução.

- [ ] **Step 1.2 — Criar arquivo de migration com cabeçalho**

Criar `supabase/migrations/2026MMDD000001_beneficios_fase3_schema.sql` (MMDD = data real da sessão):

```sql
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

-- (steps abaixo)

commit;
```

- [ ] **Step 1.3 — Colunas em `beneficios` + índices + comments**

```sql
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
  'Empresa (CNPJ) que paga a fatura do benefício. Default no seed = Agência California. Null = usar empresa principal via lookup (fallback na server action).';
```

- [ ] **Step 1.4 — Coluna em `folhas_pagamento` + check + comment**

```sql
alter table public.folhas_pagamento
  add column desconto_beneficios numeric(10, 2) not null default 0
    check (desconto_beneficios >= 0);

comment on column public.folhas_pagamento.desconto_beneficios is
  'Valor subtraído do salario_base ao aplicar o fechamento mensal de benefícios (Fase 3). salario_base armazena o valor LÍQUIDO (pós-desconto); esta coluna existe para auditoria e para a reversão em "Desaplicar". Só populado em linhas com origem=''california'' (PJ gerada). Linhas CLT (origem=''contabilidade'') ficam sempre em 0.';
```

- [ ] **Step 1.5 — Coluna em `contas_avulsas` + FK + índice + comment**

```sql
alter table public.contas_avulsas
  add column beneficio_fechamento_id uuid
    references public.beneficio_fechamento_mensal(id) on delete restrict;

create index idx_contas_avulsas_beneficio_fechamento
  on public.contas_avulsas (beneficio_fechamento_id)
  where beneficio_fechamento_id is not null;

comment on column public.contas_avulsas.beneficio_fechamento_id is
  'Avulsa de operadora de benefício (SulAmerica/Bradesco) gerada pelo fechamento mensal da Fase 3. Permite rastrear a fatura ao snapshot (quem contribuiu com quanto). Null em todas as outras avulsas.';
```

- [ ] **Step 1.6 — INSERTs em `fornecedores` (SulAmerica + Bradesco)**

```sql
insert into public.fornecedores (tenant_id, nome)
values
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, 'SulAmerica Saude'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, 'Bradesco Dental');
```

**Nota:** se a tabela `fornecedores` tiver colunas NOT NULL além de `tenant_id`/`nome` (ex.: `tipo`), o Step 1.1 deve ter mapeado isso; completar o INSERT com os valores mínimos requeridos.

- [ ] **Step 1.7 — UPDATE em `beneficios` populando fornecedor + empresa**

```sql
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
```

- [ ] **Step 1.8 — Fechar `commit;` e aplicar via MCP**

Confirmar que `commit;` fecha a transação. Rodar `apply_migration` com o conteúdo completo do arquivo.

Esperado: `{ success: true }`.

- [ ] **Step 1.9 — Verificação pós-migration (via MCP)**

```sql
-- 1. Colunas em beneficios populadas
select nome, operadora, fornecedor_id, empresa_id, dia_vencimento_fatura
from public.beneficios
where ativo = true
order by operadora, nome;
-- Esperado: todas as linhas com fornecedor_id e empresa_id NOT NULL, dia_vencimento_fatura preenchido.

-- 2. Fornecedores criados
select id, nome from public.fornecedores
where unaccent(lower(nome)) like unaccent(lower('%sulamerica%'))
   or unaccent(lower(nome)) like unaccent(lower('%bradesco%'));
-- Esperado: 2 linhas.

-- 3. Coluna em folhas_pagamento
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'folhas_pagamento'
  and column_name = 'desconto_beneficios';
-- Esperado: 1 linha, default = 0.

-- 4. Coluna em contas_avulsas
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'contas_avulsas'
  and column_name = 'beneficio_fechamento_id';
-- Esperado: 1 linha.

-- 5. Nenhuma folha existente teve desconto_beneficios mudado (default = 0)
select count(*) from public.folhas_pagamento where desconto_beneficios != 0;
-- Esperado: 0.
```

- [ ] **Step 1.10 — Commit da S1**

```bash
git add supabase/migrations/2026MMDD000001_beneficios_fase3_schema.sql
git commit -m "feat(rh/beneficios): Fase 3 S1 — schema + seed de fornecedores

- Colunas novas em beneficios (fornecedor_id, empresa_id)
- Coluna nova em folhas_pagamento (desconto_beneficios)
- Coluna nova em contas_avulsas (beneficio_fechamento_id)
- Seed: SulAmerica Saude + Bradesco Dental em fornecedores
- UPDATE: catálogo aponta pros fornecedores + Agência California como empresa

Precondição manual pendente: Daniel completa dados bancários dos 2 fornecedores
em /financeiro/fornecedores antes do primeiro Aplicar descontos em produção.

Spec: docs/modulos/rh/54-beneficios-integracao-folha.md"
```

Push manual.

---

### S2 — Migration 2 (RPCs aplicar/desaplicar)

**Objetivo**: criar as 2 RPCs plpgsql SECURITY DEFINER que fazem a transação atômica. Verificação ponta a ponta via MCP com dado real.

- [ ] **Step 2.1 — Auditoria MCP pré-escrita**

```sql
-- Confirma assinatura da criar_conta_avulsa existente
select pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as returns
from pg_proc p where proname = 'criar_conta_avulsa';
-- Esperado: 1 linha, aceita jsonb; conferir se já aceita beneficio_fechamento_id no p_dados ou se precisa de ajuste.

-- Confirma que gerar_codigo_avulsa existe
select proname from pg_proc where proname = 'gerar_codigo_avulsa';
-- Esperado: 1 linha.

-- Confirma helpers RLS da Fase 2 ainda existem
select proname from pg_proc
where proname in ('is_tenant_admin', 'is_tenant_rh');
```

**Decisão condicional:** se `criar_conta_avulsa` NÃO aceita `beneficio_fechamento_id` hoje, acrescentar na própria Migration 2 um bloco que a ALTER para aceitar (ou copiar o corpo em `aplicar_fechamento_beneficios` fazendo INSERT direto em `contas_avulsas` com `beneficio_fechamento_id`). Decidir no momento com base no diff da RPC atual. Documentar a decisão como ruling no ledger.

- [ ] **Step 2.2 — Criar arquivo de migration**

Criar `supabase/migrations/2026MMDD000002_beneficios_fase3_rpcs.sql`:

```sql
-- Migration: Benefícios — Fase 3 (RPCs aplicar/desaplicar fechamento)
-- Spec: docs/modulos/rh/54-beneficios-integracao-folha.md §3.5, §3.6
-- Plano: docs/modulos/rh/56-beneficios-fase-3-plano-de-execucao.md (S2)
--
-- Cria 2 RPCs plpgsql SECURITY DEFINER:
-- - aplicar_fechamento_beneficios(tenant, ano, mes) → fecha competência + reduz PJ + gera 2 avulsas.
-- - desaplicar_fechamento_beneficios(fechamento_id) → reverte folha + apaga avulsas + marca reaberto.
-- Transação atômica implícita de função.

begin;

-- (steps abaixo)

commit;
```

- [ ] **Step 2.3 — RPC `aplicar_fechamento_beneficios`**

Escrever conforme §3.5 do spec. Estrutura:

```sql
create or replace function public.aplicar_fechamento_beneficios(
  p_tenant_id uuid,
  p_ano int,
  p_mes int
)
returns table (
  fechamento_id uuid,
  qtd_vinculos int,
  total_empresa numeric,
  total_colaborador numeric,
  folha_linhas_afetadas int,
  avulsas jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fechamento_id uuid;
  v_subtipo_id uuid;
  v_qtd_vinculos int;
  v_total_empresa numeric := 0;
  v_total_colaborador numeric := 0;
  v_folha_linhas_afetadas int;
  v_avulsas jsonb := '[]'::jsonb;
  v_data_venc date;
  v_descricao text;
  v_codigo text;
  v_conta_id uuid;
  r_bad record;
  r_op record;
begin
  -- Precondição 1: permissão
  if not (public.is_tenant_admin(p_tenant_id) or public.is_tenant_rh(p_tenant_id)) then
    raise exception 'permissao_negada';
  end if;

  -- Precondição 2: catálogo completo (todo benefício ativo tem fornecedor+empresa+vencimento)
  select nome into r_bad
  from public.beneficios
  where ativo = true
    and tenant_id = p_tenant_id
    and (fornecedor_id is null or empresa_id is null or dia_vencimento_fatura is null)
  limit 1;
  if found then
    raise exception 'catalogo_incompleto: %', r_bad.nome;
  end if;

  -- Precondição 3: não há fechamento vigente pra competência
  if exists (
    select 1 from public.beneficio_fechamento_mensal
    where tenant_id = p_tenant_id and ano = p_ano and mes = p_mes
      and reaberto_em is null
  ) then
    raise exception 'competencia_ja_aplicada';
  end if;

  -- Precondição 4: pelo menos 1 vínculo ativo
  if not exists (
    select 1 from public.colaboradores c
    join public.colaborador_beneficio cb on cb.colaborador_id = c.id
    where c.tenant_id = p_tenant_id
      and cb.data_inicio <= (make_date(p_ano, p_mes, 1) + interval '1 month' - interval '1 day')::date
      and (cb.data_fim is null or cb.data_fim > make_date(p_ano, p_mes, 1))
  ) then
    raise exception 'nenhum_vinculo_ativo';
  end if;

  -- 1. Insere cabeçalho (ou reaproveita um já reaberto da mesma competência)
  insert into public.beneficio_fechamento_mensal
    (tenant_id, ano, mes, fechado_em, fechado_por, reaberto_em, reaberto_por)
  values (p_tenant_id, p_ano, p_mes, now(), auth.uid(), null, null)
  returning id into v_fechamento_id;

  -- 2. Insere linhas via fn_beneficios_calcular_fechamento
  insert into public.beneficio_fechamento_linha (
    tenant_id, fechamento_id,
    colaborador_beneficio_id, colaborador_id, beneficio_id,
    beneficio_nome, beneficio_operadora, beneficio_tipo, modo_custeio,
    valor_titular, valor_dependentes_total, valor_integral, valor_empresa, valor_colaborador,
    qtd_dependentes_na_competencia
  )
  select
    p_tenant_id, v_fechamento_id,
    colaborador_beneficio_id, colaborador_id, beneficio_id,
    beneficio_nome, beneficio_operadora, beneficio_tipo, modo_custeio,
    valor_titular, valor_dependentes_total, valor_integral, valor_empresa, valor_colaborador,
    qtd_dependentes_na_competencia
  from public.fn_beneficios_calcular_fechamento(p_tenant_id, p_ano, p_mes);

  select count(*),
         coalesce(sum(valor_empresa), 0),
         coalesce(sum(valor_colaborador), 0)
    into v_qtd_vinculos, v_total_empresa, v_total_colaborador
    from public.beneficio_fechamento_linha
   where fechamento_id = v_fechamento_id;

  -- 3. Reduz salario_base das linhas PJ (origem='california')
  with desc_por_col as (
    select l.colaborador_id, sum(l.valor_colaborador) as desc_total
    from public.beneficio_fechamento_linha l
    where l.fechamento_id = v_fechamento_id
    group by l.colaborador_id
  )
  update public.folhas_pagamento fp
    set salario_base = fp.salario_base - d.desc_total,
        desconto_beneficios = d.desc_total
    from desc_por_col d
   where fp.colaborador_id = d.colaborador_id
     and fp.competencia_ano = p_ano
     and fp.competencia_mes = p_mes
     and fp.origem = 'california';
  get diagnostics v_folha_linhas_afetadas = row_count;

  -- 4. Subtipo plano de contas 05.002 Benefícios
  select id into v_subtipo_id
    from public.plano_contas_subtipos
   where codigo = '05.002'
   limit 1;
  if v_subtipo_id is null then
    raise exception 'subtipo_05002_nao_encontrado';
  end if;

  -- 5. Cria 1 avulsa por operadora
  for r_op in
    select
      b.fornecedor_id,
      b.empresa_id,
      b.operadora,
      b.dia_vencimento_fatura,
      b.vencimento_mes_seguinte,
      sum(l.valor_integral) as valor_cheio,
      count(*) as qtd_vinculos_op,
      min(b.tipo_id) as plano_conta_tipo_id
    from public.beneficio_fechamento_linha l
    join public.beneficios b on b.id = l.beneficio_id
    where l.fechamento_id = v_fechamento_id
    group by b.fornecedor_id, b.empresa_id, b.operadora,
             b.dia_vencimento_fatura, b.vencimento_mes_seguinte
  loop
    v_data_venc := case
      when r_op.vencimento_mes_seguinte
        then (make_date(p_ano, p_mes, 1) + interval '1 month' + ((r_op.dia_vencimento_fatura - 1) || ' days')::interval)::date
      else make_date(p_ano, p_mes, r_op.dia_vencimento_fatura)
    end;
    v_descricao := format('Benefícios %s · competência %s/%s',
      r_op.operadora, lpad(p_mes::text, 2, '0'), p_ano);

    -- Insere avulsa (via RPC existente OU insert direto se mais simples; decisão
    -- condicional do Step 2.1 informa qual caminho).
    -- Caminho preferido: criar_conta_avulsa aceita beneficio_fechamento_id.
    v_conta_id := public.criar_conta_avulsa(jsonb_build_object(
      'tenant_id', p_tenant_id,
      'empresa_id', r_op.empresa_id,
      'fornecedor_id', r_op.fornecedor_id,
      'descricao', v_descricao,
      'valor', r_op.valor_cheio,
      'data_prevista_pagamento', v_data_venc,
      'natureza', 'despesa',
      'plano_conta_subtipo_id', v_subtipo_id,
      'beneficio_fechamento_id', v_fechamento_id,
      'competencia', make_date(p_ano, p_mes, 1)
    ));

    v_avulsas := v_avulsas || jsonb_build_object(
      'id', v_conta_id,
      'operadora', r_op.operadora,
      'valor', r_op.valor_cheio
    );
  end loop;

  return query select v_fechamento_id, v_qtd_vinculos, v_total_empresa,
                      v_total_colaborador, v_folha_linhas_afetadas, v_avulsas;
end;
$$;

grant execute on function public.aplicar_fechamento_beneficios(uuid, int, int) to authenticated;
```

**Se Step 2.1 revelar que `criar_conta_avulsa` não aceita `beneficio_fechamento_id`:** acrescentar na mesma migration um `CREATE OR REPLACE` da `criar_conta_avulsa` com o campo novo (aditivo — não quebra chamadas existentes). Ou, alternativamente, substituir a chamada acima por um `insert into contas_avulsas (...)` direto. A escolha depende do que a RPC atual faz além do insert simples (ex.: validações, logs). Decidir no momento.

- [ ] **Step 2.4 — RPC `desaplicar_fechamento_beneficios`**

```sql
create or replace function public.desaplicar_fechamento_beneficios(
  p_fechamento_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f public.beneficio_fechamento_mensal%rowtype;
  v_avulsa_paga record;
begin
  select * into v_f
    from public.beneficio_fechamento_mensal
    where id = p_fechamento_id;
  if not found then
    raise exception 'fechamento_nao_encontrado';
  end if;

  if not (public.is_tenant_admin(v_f.tenant_id) or public.is_tenant_rh(v_f.tenant_id)) then
    raise exception 'permissao_negada';
  end if;

  if v_f.reaberto_em is not null then
    raise exception 'ja_reaberto';
  end if;

  -- Trava: alguma avulsa já paga?
  select codigo into v_avulsa_paga
    from public.contas_avulsas
    where beneficio_fechamento_id = p_fechamento_id
      and pago_em is not null
    limit 1;
  if found then
    raise exception 'avulsa_ja_paga: %', v_avulsa_paga.codigo;
  end if;

  -- 1. Reverte salario_base nas linhas PJ
  update public.folhas_pagamento
     set salario_base = salario_base + desconto_beneficios,
         desconto_beneficios = 0
   where competencia_ano = v_f.ano
     and competencia_mes = v_f.mes
     and origem = 'california'
     and desconto_beneficios > 0;

  -- 2. Apaga avulsas geradas (sem pago_em, por garantia da trava acima)
  delete from public.contas_avulsas
   where beneficio_fechamento_id = p_fechamento_id;

  -- 3. Apaga linhas do snapshot
  delete from public.beneficio_fechamento_linha
   where fechamento_id = p_fechamento_id;

  -- 4. Marca cabeçalho reaberto (histórico fica)
  update public.beneficio_fechamento_mensal
     set reaberto_em = now(),
         reaberto_por = auth.uid()
   where id = p_fechamento_id;
end;
$$;

grant execute on function public.desaplicar_fechamento_beneficios(uuid) to authenticated;
```

- [ ] **Step 2.5 — Fechar `commit;` e aplicar via MCP**

Rodar `apply_migration`. Esperado: `{ success: true }`.

- [ ] **Step 2.6 — Aplicar RPC em competência de teste e conferir dados**

```sql
-- Em MCP write, cria competência de teste
select * from public.aplicar_fechamento_beneficios(
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid,
  2026, 11
);
-- Esperado: 1 linha com qtd_vinculos > 0, total_empresa > 0, total_colaborador > 0,
-- folha_linhas_afetadas >= 0 (pode ser 0 se não houver folha PJ nessa competência de teste),
-- avulsas = jsonb array com 2 objetos.

-- Confere snapshot
select count(*) as linhas, sum(valor_integral) as total
  from public.beneficio_fechamento_linha l
  join public.beneficio_fechamento_mensal m on m.id = l.fechamento_id
  where m.ano = 2026 and m.mes = 11;

-- Confere avulsas criadas
select operadora, valor, data_prevista_pagamento, beneficio_fechamento_id
  from public.contas_avulsas ca
  join public.fornecedores f on f.id = ca.fornecedor_id
  cross join lateral (select nome as operadora from public.fornecedores where id = ca.fornecedor_id) op
  where ca.beneficio_fechamento_id is not null
  order by ca.data_prevista_pagamento;
-- Esperado: 2 linhas (SulAmerica + Bradesco) com vencimento correto.

-- Confere redução de salário (se houver folha PJ)
select colaborador_id, salario_base, desconto_beneficios
  from public.folhas_pagamento
  where competencia_ano = 2026 and competencia_mes = 11
    and origem = 'california'
    and desconto_beneficios > 0
  limit 5;
```

- [ ] **Step 2.7 — Desaplica e confere reversão**

```sql
select id from public.beneficio_fechamento_mensal where ano = 2026 and mes = 11;
-- Guarda o UUID.

select public.desaplicar_fechamento_beneficios('<uuid>'::uuid);

-- Confere
select reaberto_em, reaberto_por from public.beneficio_fechamento_mensal
  where ano = 2026 and mes = 11;
-- Esperado: reaberto_em preenchido.

select count(*) from public.beneficio_fechamento_linha
  where fechamento_id = '<uuid>';
-- Esperado: 0.

select count(*) from public.contas_avulsas where beneficio_fechamento_id = '<uuid>';
-- Esperado: 0.

select count(*) from public.folhas_pagamento
  where competencia_ano = 2026 and competencia_mes = 11
    and origem = 'california' and desconto_beneficios > 0;
-- Esperado: 0.
```

- [ ] **Step 2.8 — Review Focus 3 (fornecedor sem CNPJ)**

Com SulAmerica/Bradesco criados em S1 **sem CNPJ**, a RPC Step 2.6 já rodou com fornecedores incompletos. Confirmar que a avulsa foi criada normalmente e aparece em `/financeiro/contas-a-pagar` (apenas sem possibilidade de remessa; pagamento manual pelo PDF).

- [ ] **Step 2.9 — Review Focus 1 e 2 (datas de borda)**

Via MCP, criar vínculo sintético com `data_inicio = make_date(2026, 11, 15)` e re-rodar `select * from fn_beneficios_calcular_fechamento(tenant, 2026, 11)`. Esperado: o vínculo aparece. Depois criar outro com `data_inicio = make_date(2026, 12, 1)`: NÃO aparece em novembro.

Criar vínculo com `data_fim = make_date(2026, 11, 15)`: aparece em novembro (data_fim > primeiro dia do mês = 2026-11-01). Com `data_fim = make_date(2026, 10, 31)`: NÃO aparece em novembro.

Documentar no ledger qualquer surpresa.

- [ ] **Step 2.10 — Limpeza + commit da S2**

```sql
-- Apagar a competência de teste 2026-11 e vínculos sintéticos
delete from public.beneficio_fechamento_mensal where ano = 2026 and mes = 11;
delete from public.colaborador_beneficio where observacao like '%teste S2%';
```

```bash
git add supabase/migrations/2026MMDD000002_beneficios_fase3_rpcs.sql
git commit -m "feat(rh/beneficios): Fase 3 S2 — RPCs aplicar/desaplicar fechamento

- aplicar_fechamento_beneficios: fecha competência + reduz PJ + gera 2 avulsas
- desaplicar_fechamento_beneficios: reverte folha + apaga avulsas + marca reaberto
- SECURITY DEFINER com check interno de permissão
- Precondições validadas: catálogo completo, competência não aplicada, vínculos ativos
- Trava: desaplicar só se nenhuma avulsa paga

Testado ponta a ponta em competência sintética 2026-11 (aplicar+desaplicar).

Spec: docs/modulos/rh/54-beneficios-integracao-folha.md §3.5, §3.6"
```

---

### S3 — Tipos + Server actions + Queries

**Objetivo**: camada TypeScript que a UI das sessões S4 e S5 vai consumir.

- [ ] **Step 3.1 — Atualizar `lib/types.ts`**

Adicionar/atualizar conforme §8 do spec:

```ts
// Atualizar interface Beneficio existente para incluir as colunas novas:
// fornecedor_id, empresa_id (nullable)

// Atualizar interface FolhaPagamento existente:
// desconto_beneficios: number (default 0)

// Atualizar interface ContaAvulsa existente:
// beneficio_fechamento_id: string | null

// Adicionar os novos tipos:
export interface AplicarBeneficiosResult {
  fechamentoId: string;
  totalEmpresa: number;
  totalColaborador: number;
  qtdVinculos: number;
  folhaLinhasAfetadas: number;
  avulsas: Array<{ id: string; operadora: string; valor: number }>;
}

export interface FechamentoRow extends BeneficioFechamentoMensal {
  fechado_por_nome: string | null;
  total_empresa: number;
  total_colaborador: number;
  valor_integral: number;
  qtd_vinculos: number;
}

export interface FechamentoDetalhe {
  cabecalho: FechamentoRow;
  por_operadora: Array<{
    operadora: string;
    qtd_vinculos: number;
    valor_integral: number;
    valor_empresa: number;
    valor_colaborador: number;
    avulsa_id: string | null;
    avulsa_codigo: string | null;
    avulsa_vencimento: string | null;
    avulsa_pago_em: string | null;
  }>;
  linhas: BeneficioFechamentoLinha[];
}

export interface PreviewAplicacao {
  qtdVinculos: number;
  totalEmpresa: number;
  totalColaborador: number;
  totalIntegral: number;
  porOperadora: Array<{
    operadora: string;
    valorIntegral: number;
    qtdVinculos: number;
    dataVencimento: string; // ISO
  }>;
}
```

- [ ] **Step 3.2 — Criar `lib/actions/beneficios/fechamento.ts`**

Server actions conforme §4 do spec. Importa `createClient`, `getActiveTenant`, `logAuditEvent`, `revalidatePath`.

Trata erros `permissao_negada`, `competencia_ja_aplicada`, `catalogo_incompleto`, `nenhum_vinculo_ativo`, `ja_reaberto`, `avulsa_ja_paga`, `fechamento_nao_encontrado` com mensagens pt-BR explícitas.

Retorno discriminado union `{ ok: true, ... } | { ok: false, message: string }`.

- [ ] **Step 3.3 — Atualizar `lib/queries/beneficios.ts`**

Adicionar as 5 queries:

```ts
export async function listarFechamentos(
  supabase: SupabaseClient,
  tenantId: string,
  ano: number,
): Promise<FechamentoRow[]> {
  // SELECT fechamento_mensal LEFT JOIN profiles LEFT JOIN agregados (COUNT, SUM) do _linha
  // Ordenar por mes DESC
}

export async function obterFechamento(
  supabase: SupabaseClient,
  fechamentoId: string,
): Promise<FechamentoDetalhe | null> {
  // 3 queries em Promise.all: cabeçalho+profile, agregados por operadora + avulsa join, linhas completas
}

export async function temAvulsaPaga(
  supabase: SupabaseClient,
  fechamentoId: string,
): Promise<boolean> {
  // SELECT 1 FROM contas_avulsas WHERE beneficio_fechamento_id = X AND pago_em IS NOT NULL LIMIT 1
}

export async function obterFechamentoVigenteDaCompetencia(
  supabase: SupabaseClient,
  tenantId: string,
  ano: number,
  mes: number,
): Promise<FechamentoRow | null> {
  // Cabeçalho + agregados, filtro reaberto_em IS NULL
}

export async function previsualizarAplicacao(
  supabase: SupabaseClient,
  tenantId: string,
  ano: number,
  mes: number,
): Promise<PreviewAplicacao> {
  // Chama fn_beneficios_calcular_fechamento via RPC, agrega por operadora
  // Calcula data_vencimento com base em beneficios.dia_vencimento_fatura/vencimento_mes_seguinte
}
```

- [ ] **Step 3.4 — tsc verde**

```bash
pnpm tsc --noEmit
```

Esperado: EXIT=0.

- [ ] **Step 3.5 — lint verde**

```bash
pnpm lint
```

Esperado: EXIT=0 (warning pre-existente em multi-select.tsx não conta).

- [ ] **Step 3.6 — Review Focus 5 (catalogo_incompleto)**

Teste manual via Node REPL ou script temporário:
```ts
// Zera fornecedor_id de um benefício ativo via MCP write
// update beneficios set fornecedor_id = null where nome = 'Bradesco Dental';
// Chama aplicarBeneficios({ ano: 2026, mes: 11 }) → esperado: { ok: false, message: "Catálogo de benefícios incompleto: Bradesco Dental..." }
// Reverte: update beneficios set fornecedor_id = (select id from fornecedores where nome = 'Bradesco Dental') where nome = 'Bradesco Dental';
```

Documentar no ledger.

- [ ] **Step 3.7 — Commit da S3**

```bash
git add lib/types.ts lib/actions/beneficios/fechamento.ts lib/queries/beneficios.ts
git commit -m "feat(rh/beneficios): Fase 3 S3 — tipos, server actions e queries

- Tipos novos: AplicarBeneficiosResult, FechamentoRow, FechamentoDetalhe, PreviewAplicacao
- Server actions: aplicarBeneficios, desaplicarBeneficios (chama RPCs da S2 + audit)
- Queries: listarFechamentos, obterFechamento, temAvulsaPaga, obterFechamentoVigenteDaCompetencia, previsualizarAplicacao
- Mensagens de erro pt-BR explícitas; direcionam onde consertar

Spec: docs/modulos/rh/54-beneficios-integracao-folha.md §4"
```

---

### S4 — UI: Checkpoint na folha

**Objetivo**: 3º checkpoint "Benefícios aplicados" no checklist da competência, com botão Aplicar/Desaplicar funcionais.

- [ ] **Step 4.1 — Leitura do arquivo-chave**

Reler `app/(app)/rh/folhas/_components/checklist-competencia.tsx` por inteiro (é client component, ~190 linhas). Entender o padrão `CheckpointRow` + `ChecklistCompetencia` + a lógica `podeEnviar`.

- [ ] **Step 4.2 — Expandir props de `ChecklistCompetencia`**

Adicionar prop `beneficios`:

```ts
beneficios: {
  aplicado: boolean;
  fechamentoId: string | null;
  qtdVinculos: number;
  totalEmpresa: number;
  totalColaborador: number;
  totalIntegral: number;
  avulsaPaga: boolean;
};
```

Atualizar `podeEnviar`: `temPj && temClt && props.beneficios.aplicado && props.rascunhosAEnviar > 0`.

Adicionar tooltip no botão Enviar quando `!props.beneficios.aplicado`: "Aplique os descontos de benefícios antes de enviar."

- [ ] **Step 4.3 — Grid passa de 2 para 3 colunas**

```tsx
<div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
```

- [ ] **Step 4.4 — 3º CheckpointRow**

```tsx
<CheckpointRow
  feito={props.beneficios.aplicado}
  rotulo="Benefícios aplicados"
  detalhe={
    props.beneficios.aplicado
      ? `${props.beneficios.qtdVinculos} vínculos · ${brl.format(props.beneficios.totalIntegral)}`
      : "Nenhuma competência fechada ainda"
  }
  acao={
    props.podeEditar && temPj && temClt && !props.beneficios.aplicado ? (
      <BotaoAplicarBeneficios ano={props.ano} mes={props.mes} />
    ) : props.podeEditar && props.beneficios.aplicado && !props.beneficios.avulsaPaga ? (
      <BotaoDesaplicarBeneficios fechamentoId={props.beneficios.fechamentoId!} />
    ) : null
  }
/>
```

- [ ] **Step 4.5 — Criar `botao-aplicar-beneficios.tsx`**

Client component. Chama `previsualizarAplicacao` ao montar (ou on-click, pra evitar query extra se não clicar). Monta texto do `confirm()`:

```ts
"use client";

import * as React from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { aplicarBeneficios } from "@/lib/actions/beneficios/fechamento";
import { previsualizarAplicacao } from "./server-actions-wrapper"; // ou direct

export function BotaoAplicarBeneficios(props: { ano: number; mes: number }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  async function handleClick() {
    setErro(null);
    const prev = await previsualizarAplicacao(props.ano, props.mes);
    const texto = montarTextoConfirm(prev, props.ano, props.mes);
    if (!confirm(texto)) return;
    startTransition(async () => {
      const r = await aplicarBeneficios({ ano: props.ano, mes: props.mes });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
        {pending ? "Aplicando..." : "Aplicar descontos"}
      </button>
      {erro && <p className="mt-1 text-xs text-red-700">{erro}</p>}
    </>
  );
}

function montarTextoConfirm(prev: PreviewAplicacao, ano: number, mes: number): string {
  const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const linhasOperadora = prev.porOperadora
    .map((op) => `• ${op.operadora}: ${brl(op.valorIntegral)} (vence ${formatarData(op.dataVencimento)})`)
    .join("\n");
  return [
    `Aplicar descontos de benefícios à competência ${mes}/${ano}?`,
    ``,
    `Isso vai:`,
    `• Reduzir ${brl(prev.totalColaborador)} das linhas PJ (${prev.qtdVinculos} vínculos).`,
    `• Gerar avulsas:`,
    linhasOperadora,
    `• Marcar a competência como fechada em Benefícios.`,
    ``,
    `Depois disso, não dá pra reaplicar sem desaplicar primeiro.`,
  ].join("\n");
}
```

**Nota de implementação:** `previsualizarAplicacao` precisa ser chamada do client. Opções: (a) server action wrapper que retorna o preview; (b) query via `supabase` client-side (não ideal, RLS pode variar). Preferido (a).

- [ ] **Step 4.6 — Criar `botao-desaplicar-beneficios.tsx`**

Client component similar, com `confirm()`:

```
"Desaplicar os descontos de benefícios desta competência?

Isso vai:
• Reverter a redução de salário nas linhas PJ.
• Apagar as 2 avulsas geradas (SulAmerica + Bradesco).
• Marcar a competência como reaberta.

Só funciona se nenhuma avulsa foi paga."
```

Chama `desaplicarBeneficios({ fechamentoId })`.

- [ ] **Step 4.7 — Modificar `app/(app)/rh/folhas/[competencia]/page.tsx`**

Server component existente. Adicionar query `obterFechamentoVigenteDaCompetencia` + `temAvulsaPaga` em paralelo com as queries atuais via `Promise.all`. Passar prop `beneficios` para `<ChecklistCompetencia>`.

Caso `fechamento === null`: `beneficios = { aplicado: false, fechamentoId: null, qtdVinculos: 0, totalEmpresa: 0, totalColaborador: 0, totalIntegral: 0, avulsaPaga: false }`.

- [ ] **Step 4.8 — tsc/lint/build**

```bash
pnpm tsc --noEmit && pnpm lint && pnpm build
```

Esperado: tudo verde.

- [ ] **Step 4.9 — Teste manual browser**

Rodar `pnpm dev`. Abrir `/rh/folhas/2026-11` (ou competência de teste). Esperado:
- Grid com 3 colunas.
- 3º checkpoint "Benefícios aplicados" com estado inicial não feito, botão "Aplicar descontos" visível (se PJ+CLT verdes).
- Clicar em "Aplicar descontos": modal confirm aparece com totais e vencimentos corretos.
- Confirmar: botão vira "Aplicando...", depois a página recarrega mostrando "☑ Benefícios aplicados · N · R$ Xk" + botão "Desaplicar".
- "Enviar ao financeiro" habilitou (se já estava com rascunhos).
- Clicar em "Desaplicar": modal confirm → volta pro estado inicial.

Documentar qualquer surpresa no ledger.

- [ ] **Step 4.10 — Commit da S4**

```bash
git add app/(app)/rh/folhas/_components/checklist-competencia.tsx \
         app/(app)/rh/folhas/_components/botao-aplicar-beneficios.tsx \
         app/(app)/rh/folhas/_components/botao-desaplicar-beneficios.tsx \
         app/(app)/rh/folhas/[competencia]/page.tsx
git commit -m "feat(rh/beneficios): Fase 3 S4 — checkpoint na folha

- 3º CheckpointRow 'Benefícios aplicados' no grid 3-col do checklist
- Botão 'Aplicar descontos' só quando PJ+CLT verdes; confirm() nativo com preview
- Botão 'Desaplicar' secundário; oculto se qualquer avulsa paga
- 'Enviar ao financeiro' ganha dependência dos 3 checkpoints
- Preview via previsualizarAplicacao (fn_beneficios_calcular_fechamento ao vivo)

Spec: docs/modulos/rh/54-beneficios-integracao-folha.md §5.1"
```

---

### S5 — UI: Tab Fechamentos + Página de detalhe

**Objetivo**: tab "Fechamentos" read-only em `/rh/beneficios` listando competências fechadas + página de detalhe `/rh/beneficios/fechamentos/[id]` com breakdown por operadora e tabela de linhas. Teste ponta a ponta ao final.

- [ ] **Step 5.1 — Modificar `app/(app)/rh/beneficios/page.tsx`**

Adicionar 3ª tab "Fechamentos". A tab lazy-renderiza `<TabFechamentos tenantId={tenantId} />`.

Reusa o padrão `<Tabs>` já em uso (ver tabs Colaboradores/Catálogo).

- [ ] **Step 5.2 — Criar `tab-fechamentos.tsx`**

Server component (não precisa de interatividade além de link clicável). Server-side query `listarFechamentos(ano)` com default ano atual.

Filtro de ano é query param (`?ano=2026`). Server component re-renderiza quando param muda.

```tsx
export async function TabFechamentos({ tenantId, ano }: { tenantId: string; ano: number }) {
  const supabase = await createClient();
  const fechamentos = await listarFechamentos(supabase, tenantId, ano);
  const anosDisponiveis = await listarAnosComFechamento(supabase, tenantId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SelectAno value={ano} options={anosDisponiveis} /> {/* link que muda ?ano= */}
      </div>
      {fechamentos.length === 0 ? (
        <EmptyState mensagem={`Nenhuma competência fechada em ${ano}. Fechamentos são criados pela página da folha mensal.`} />
      ) : (
        <TabelaFechamentos linhas={fechamentos} />
      )}
    </div>
  );
}
```

`<TabelaFechamentos>` client component (porque usa `router.push` ao clicar na linha).

Padrão linha clicável (memória `feedback_ui_linha_clicavel`): a linha inteira é um `<Link href="/rh/beneficios/fechamentos/[id]">`.

- [ ] **Step 5.3 — Criar página `/rh/beneficios/fechamentos/[id]/page.tsx`**

Server component:

```tsx
export default async function FechamentoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { tenantId } = await getActiveTenant();
  const [detalhe, avulsaPaga] = await Promise.all([
    obterFechamento(supabase, id),
    temAvulsaPaga(supabase, id),
  ]);
  if (!detalhe) notFound();

  return (
    <div className="space-y-6">
      <CabecalhoFechamento detalhe={detalhe} avulsaPaga={avulsaPaga} />
      <KpisFechamento detalhe={detalhe} />
      <CardsPorOperadora operadoras={detalhe.por_operadora} />
      <TabelaLinhasFechamento linhas={detalhe.linhas} />
    </div>
  );
}
```

- [ ] **Step 5.4 — Criar `cabecalho-fechamento.tsx`**

Client component (botão Desaplicar). Reusa o padrão `PageHeader` + chip de status + botão de ação.

```tsx
<PageHeader
  breadcrumb={[
    { label: "Benefícios", href: "/rh/beneficios" },
    { label: "Fechamentos", href: "/rh/beneficios?tab=fechamentos" },
    { label: labelCompetencia(detalhe.cabecalho.ano, detalhe.cabecalho.mes) },
  ]}
  titulo={labelCompetencia(detalhe.cabecalho.ano, detalhe.cabecalho.mes)}
  subtitulo={`Fechado em ${formatDate(detalhe.cabecalho.fechado_em)} por ${detalhe.cabecalho.fechado_por_nome}`}
  acoes={
    detalhe.cabecalho.reaberto_em === null && !avulsaPaga ? (
      <BotaoDesaplicarBeneficios fechamentoId={detalhe.cabecalho.id} />
    ) : null
  }
/>
```

Chip de status: "☑ Aplicado" verde ou "⟲ Reaberto em DD/MM" cinza.

- [ ] **Step 5.5 — Criar `kpis-fechamento.tsx`**

3 cards (reusa o padrão de KPI cards do /financeiro — memória `feedback_kpi_cards_ricos`):

- Custo empresa (valor_dre_beneficios do snapshot) — ícone Building
- Custo colaborador (valor_dre_pessoal_ajuste) — ícone Users
- Valor integral (bruto da fatura) — ícone Receipt

- [ ] **Step 5.6 — Criar `cards-por-operadora.tsx`**

Horizontal flex (ou grid 2-col em sm+). Cada card:

```
┌─ SulAmérica Saude ────────┐
│ 145 vínculos              │
│ Integral:  R$ 110.500,00  │
│ Empresa:   R$ 56.300,00   │
│ Colab.:    R$ 54.200,00   │
│ Vencimento: 05/11/2026    │
│ [Ver avulsa gerada →]     │
└───────────────────────────┘
```

Link usa `<Link prefetch={false} href={`/financeiro/contas-a-pagar/avulsa/${avulsaId}`}>`.

- [ ] **Step 5.7 — Criar `tabela-linhas-fechamento.tsx`**

Client component com filtros simples (busca por nome + filtro operadora). Padrão idêntico ao da tab Colaboradores.

Colunas: Colaborador | Benefício | Operadora | Modo custeio | Idade (`qtd_dependentes_na_competencia` dá pra inferir mas não é obrigatório) | Titular | Deps | Integral | Empresa | Colab.

Usa `table-fixed` com `colgroup` padrão (memória sobre planilhas; aqui não é planilha mas o padrão é consistente).

- [ ] **Step 5.8 — tsc/lint/build**

```bash
pnpm tsc --noEmit && pnpm lint && pnpm build
```

Esperado: tudo verde.

- [ ] **Step 5.9 — Teste manual ponta a ponta + Review Focus 4**

Em `pnpm dev`:

1. Navegar `/rh/beneficios` → tab Fechamentos → ver lista (pode estar vazia ou ter test anterior).
2. Ir pra `/rh/folhas/2026-11` → "Aplicar descontos" → confirmar.
3. Voltar pra `/rh/beneficios?tab=fechamentos` → ver nova linha.
4. Clicar na linha → ver página de detalhe com KPIs, cards de operadora, tabela.
5. Clicar em "Ver avulsa gerada" → navegar pro financeiro.
6. **Review Focus 4**: voltar e editar o `percentual_empresa_titular` do SulAmerica Direto no catálogo (mudar de 60 pra 70). Reabrir a página de detalhe do fechamento. Esperado: valores **inalterados** (snapshot imutável).
7. Voltar os valores do catálogo e desaplicar via botão na página.

Documentar surpresas no ledger.

- [ ] **Step 5.10 — Commit da S5**

```bash
git add app/(app)/rh/beneficios/page.tsx \
         app/(app)/rh/beneficios/_components/tab-fechamentos.tsx \
         app/(app)/rh/beneficios/fechamentos/
git commit -m "feat(rh/beneficios): Fase 3 S5 — tab Fechamentos + página de detalhe

- Tab 'Fechamentos' em /rh/beneficios (read-only, lista cronológica, filtro ano)
- Página /rh/beneficios/fechamentos/[id] com breakdown por operadora e tabela de linhas
- Botão 'Desaplicar' no cabeçalho da página (oculto se avulsa paga ou já reaberto)
- Linha clicável completa; prefetch={false} nos links pro financeiro
- Teste ponta a ponta: aplicar → ver no tab → ver detalhe → desaplicar

Fase 3 completa. Spec: docs/modulos/rh/54-beneficios-integracao-folha.md"
```

---

## 5. Critérios de conclusão da Fase 3

Fase 3 está pronta quando **todos** os seguintes forem verdadeiros:

- [ ] 2 migrations aplicadas em produção via MCP.
- [ ] Checklist §10 do spec todo verde.
- [ ] `lib/types.ts`, `lib/actions/beneficios/fechamento.ts`, `lib/queries/beneficios.ts` atualizados.
- [ ] UI do checkpoint na folha funcionando: aplicar/desaplicar/habilitar "Enviar".
- [ ] Tab Fechamentos em `/rh/beneficios` listando + página de detalhe funcionando.
- [ ] 1 competência real aplicada em produção com Daniel conferindo os valores contra a fatura antes do primeiro pagamento.
- [ ] `tsc`, `lint`, `build` limpos em todas as sessões.
- [ ] 5 commits em `main` (um por sessão), sem push automático.
- [ ] Precondição: Daniel completou dados bancários dos 2 fornecedores em `/financeiro/fornecedores`.

## 6. O que vem depois (fora deste plano)

- **Fase 4**: tela de DRE lendo `vw_dre_despesa_pessoal_ajustada_mensal` via `vw_dre_mensal` mestra. Fora de prazo pactuado.
- **Remessa de pagamento** pros 2 fornecedores novos (ADR 174 §1.8).
- **Reconciliação com fatura real** da operadora (ADR 174 §5).
