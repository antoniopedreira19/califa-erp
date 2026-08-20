# Desembolsos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir `desembolso` como 4ª origem de "Contas a Pagar" — nova entidade com workflow tipo PP (em_avaliacao → aprovada → pago), rateio regional como avulsa, parcelas próprias e anexos; nova página `/financeiro/desembolsos` para qualquer usuário lançar/acompanhar; nova aba "Pedidos de Desembolsos" em Contas a Pagar para admin/financeiro aprovar/rejeitar; integração aditiva com "Títulos a Pagar" e "Títulos a Pagar (Cartão)" via 4º branch nos dispatchs por origem já existentes.

**Architecture:** 4 tabelas novas (`desembolsos`, `desembolsos_parcelas`, `desembolsos_regionais`, `desembolsos_anexos`) espelhando estruturas de PP. 3 RPCs próprias (`aprovar_desembolso_com_data`, `dar_baixa_desembolso_parcela`, `estornar_baixa_desembolso_parcela`) copiadas do padrão PP. Extensão aditiva em `lancamentos_financeiros` (novo enum, nova FK, constraints ampliadas). Views `vw_a_pagar` e `vw_fluxo_caixa` recriadas para incluir a 4ª origem. UI reusa `FormaPagamentoField`, `parcelasParaFatura`, `proximaFatura`.

**Tech Stack:** Next.js 14 App Router (server components + server actions), React 18, TypeScript 5, Supabase Postgres (RLS + RPC + views), React Hook Form + Zod, Tailwind + shadcn/ui, MCP Supabase para aplicar migrations.

**Spec:** [docs/superpowers/specs/2026-08-20-desembolsos-design.md](../specs/2026-08-20-desembolsos-design.md)

## Global Constraints

- **Fluxo de banco (docs/FLUXO-BANCO.md)**: toda estrutura nasce de migration versionada. Ler → migration → `apply_migration` via MCP → conferir → commit da migration junto do código.
- **RLS + GRANT**: toda tabela nova tem RLS ativado, policies via `is_tenant_member(tenant_id)`, `GRANT` explícito a `authenticated` (nada a `anon`). Toda função nova recebe `revoke execute ... from public; grant execute ... to authenticated`.
- **Índices em FK**: `desembolso_id` (parcelas, regionais, anexos, lancamentos) e `cartao_credito_id` (parcial `where cartao_credito_id is not null`).
- **`lib/types.ts` no mesmo commit** da migration que mexe em coluna consumida pelo frontend.
- **Ortografia pt-BR completa** em toda string visível: labels, placeholders, botões, mensagens de erro/toast, empty states.
- **Componente compartilhado**: reusar `FormaPagamentoField` (Task 5 de cartões) nos 3 formulários. Reusar helper `parcelasParaFatura` e `proximaFatura` para cálculo de datas quando cartão.
- **`SUPABASE_SERVICE_ROLE_KEY` nunca no navegador**.
- **Regras críticas não frontend-only**: Zod roda no server action, RPC valida `is_tenant_member` internamente.
- **Auditoria**: eventos novos por ação (criado, aprovada, rejeitada, cancelada, parcela_paga, parcela_baixa_estornada).
- **Sem framework de testes**: verificação = `npm run typecheck` + `npm run lint` + `npm run build` + MCP queries + smoke manual no browser.
- **Data cartão >= hoje** — validação server-side no `criarDesembolso` para `data_prevista_pagamento` quando `forma_pagamento = 'cartao_credito'` (padrão herdado da conta avulsa).
- **Prefixo migration**: próximo número = `20260820000006`. Sequência: `_6_desembolsos` → `_7_desembolso_enum_lancamentos` → `_8_desembolso_wiring_lancamentos` → `_9_desembolso_rpcs` → `_10_views_a_pagar_e_fluxo_caixa_desembolso`.

---

## File Structure

**Novos arquivos:**
- `supabase/migrations/20260820000006_desembolsos.sql` — enum + 4 tabelas + índices + RLS + GRANT + triggers + `gerar_codigo_desembolso`.
- `supabase/migrations/20260820000007_desembolso_enum_lancamentos.sql` — só `ADD VALUE` no enum `origem_lancamento`.
- `supabase/migrations/20260820000008_desembolso_wiring_lancamentos.sql` — coluna FK `desembolso_id` + `desembolso_parcela_id` em `lancamentos_financeiros`, ampliação de `chk_origem_tem_referencia` e `chk_origem_contraparte_tem_id`, unique parcial `uniq_baixa_ativa_por_desembolso_parcela`, índices.
- `supabase/migrations/20260820000009_desembolso_rpcs.sql` — 3 RPCs de desembolso + patch em `dar_baixa_lote_cartao`.
- `supabase/migrations/20260820000010_views_a_pagar_e_fluxo_caixa_desembolso.sql` — `create or replace` de `vw_a_pagar` e `vw_fluxo_caixa` incluindo 4ª origem.
- `lib/validations/desembolso.ts` — Zod schemas.
- `app/(app)/financeiro/desembolsos/actions.ts` — server actions.
- `app/(app)/financeiro/desembolsos/page.tsx` — server component.
- `app/(app)/financeiro/desembolsos/desembolsos-list.tsx` — client tabela + filtros.
- `app/(app)/financeiro/desembolsos/desembolso-drawer.tsx` — client form de criação.
- `app/(app)/financeiro/desembolsos/[id]/page.tsx` — server component de detalhe.
- `app/(app)/financeiro/desembolsos/[id]/parcelas-lista.tsx` — client tabela de parcelas (se aprovado).
- `app/(app)/financeiro/contas-a-pagar/desembolsos-list.tsx` — client, aba "Pedidos de Desembolsos".
- `app/(app)/financeiro/contas-a-pagar/aprovar-desembolso-dialog.tsx` — client modal para aprovar com data.
- `app/(app)/financeiro/contas-a-pagar/rejeitar-desembolso-dialog.tsx` — client modal para rejeitar com motivo.

**Arquivos modificados:**
- `lib/types.ts` — `Desembolso`, `DesembolsoStatus`, `DesembolsoParcela`, `OrigemLancamento` estendido, `OrigemTitulo` union estendido.
- `lib/auth/audit.ts` — 7 chaves novas no union `AuditAction`.
- `components/sidebar.tsx` — link "Desembolsos" no menu Financeiro.
- `app/(app)/financeiro/page.tsx` — card "Desembolsos" na home do módulo financeiro (se aplicável ao padrão da página).
- `app/(app)/financeiro/contas-a-pagar/page.tsx` — SELECT novo em `Promise.all` (desembolsos em avaliação/aprovada/pago), 4º loop construindo `TituloRow` a partir de `desembolsos_parcelas`, ajuste no filtro da aba comum, props para tabs (pedidos de desembolsos + count).
- `app/(app)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx` — 6ª aba entre "PPs" e "Recorrências".
- `app/(app)/financeiro/contas-a-pagar/titulos-pagar-list.tsx` — `OrigemTitulo` inclui `'desembolso'`; nenhum shape novo em `TituloRow`.
- `app/(app)/financeiro/contas-a-pagar/actions-titulos.ts` — schema `origem` enum ganha `'desembolso'`; branch novo em `darBaixaTitulo` e `estornarBaixaTitulo`.
- `app/(app)/financeiro/contas-a-pagar/actions-cartao.ts` — schema `origem` enum ganha `'desembolso'`; batch SELECT ganha 3ª query em `desembolsos_parcelas` para audit individual.
- `app/(app)/financeiro/contas-a-pagar/titulos-cartao-list.tsx` — nenhuma mudança lógica; se houver enum literal, estender.

---

## Task 1: Migration base — enum status + 4 tabelas + `gerar_codigo_desembolso`

**Files:**
- Create: `supabase/migrations/20260820000006_desembolsos.sql`
- Modify: `lib/types.ts`

**Interfaces:**
- Consumes: enum `forma_pagamento` (Task 1 cartões), tabela `cartoes_credito` (Task 1 cartões), tabelas `tenants`, `empresas`, `profiles`, `fornecedores`, `clientes`, `jobs`, `regionais`.
- Produces:
  - enum `desembolso_status` com valores `em_avaliacao | aprovada | pago | rejeitada | cancelada`.
  - Tabela `desembolsos` (22 colunas + constraints).
  - Tabela `desembolsos_parcelas` (10 colunas).
  - Tabela `desembolsos_regionais` (3 colunas).
  - Tabela `desembolsos_anexos` (7 colunas).
  - Função `gerar_codigo_desembolso(p_tenant_id uuid) returns text` — retorna `DES-NNNNN` sequencial por tenant.
  - Trigger `congela_data_pagamento_primeira` em `desembolsos_parcelas` (reusa função existente).
  - Types TS: `DesembolsoStatus`, `desembolsoStatusLabel`, `Desembolso`, `DesembolsoParcela`.

- [ ] **Step 1: Ler o banco pelo MCP**

Chamar `mcp__supabase__execute_sql`:

```sql
select
  (select count(*) from pg_type where typname = 'desembolso_status') as enum_desembolso,
  (select count(*) from information_schema.tables where table_name = 'desembolsos') as tabela;
```

Esperado: `enum_desembolso=0, tabela=0`.

- [ ] **Step 2: Criar migration**

Arquivo: `supabase/migrations/20260820000006_desembolsos.sql`

```sql
-- =====================================================================
-- Desembolsos — 4ª origem de "Contas a Pagar"
-- =====================================================================
--
-- Nova entidade com workflow tipo PP (em_avaliacao → aprovada → pago),
-- rateio regional como avulsa e parcelas próprias. Qualquer membro do
-- tenant cria; admin/financeiro aprova/rejeita. Ver
-- docs/superpowers/specs/2026-08-20-desembolsos-design.md, seção 4.1.
--
-- Aditiva: 4 tabelas novas, 1 enum novo, 1 função de sequencial, 1
-- trigger de congelamento de data (reusa função existente). Zero
-- alteração em código existente.
-- =====================================================================

create type desembolso_status as enum
  ('em_avaliacao', 'aprovada', 'pago', 'rejeitada', 'cancelada');

create table desembolsos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  codigo text not null,
  empresa_id uuid not null references empresas(id),
  descricao text not null,
  valor numeric(14, 2) not null check (valor > 0),
  forma_pagamento forma_pagamento null,
  cartao_credito_id uuid null references cartoes_credito(id),
  status desembolso_status not null default 'em_avaliacao',
  fornecedor_id uuid null references fornecedores(id),
  cliente_id uuid null references clientes(id),
  job_id uuid null references jobs(id),
  data_prevista_pagamento date null,
  motivo_rejeicao text null,
  motivo_cancelamento text null,
  criado_por uuid not null references profiles(id),
  aprovada_por uuid null references profiles(id),
  aprovada_em timestamptz null,
  rejeitada_por uuid null references profiles(id),
  rejeitada_em timestamptz null,
  cancelada_por uuid null references profiles(id),
  cancelada_em timestamptz null,
  pago_em timestamptz null,
  pago_por uuid null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_desembolso_codigo_por_tenant unique (tenant_id, codigo),
  constraint desembolso_descricao_nao_vazia check (length(trim(descricao)) > 0),
  constraint chk_desembolso_cartao check (
    (forma_pagamento = 'cartao_credito' and cartao_credito_id is not null)
    or (forma_pagamento is distinct from 'cartao_credito' and cartao_credito_id is null)
  )
);

comment on column desembolsos.forma_pagamento is
  'Nullable para casos edge onde o desembolso é criado antes de definir forma. Server action exige NOT NULL na criação normal.';

create index idx_desembolsos_tenant_status on desembolsos (tenant_id, status);
create index idx_desembolsos_criado_por on desembolsos (tenant_id, criado_por);
create index idx_desembolsos_job on desembolsos (tenant_id, job_id) where job_id is not null;
create index idx_desembolsos_cartao
  on desembolsos (tenant_id, cartao_credito_id)
  where cartao_credito_id is not null;

create table desembolsos_parcelas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  desembolso_id uuid not null references desembolsos(id) on delete cascade,
  numero smallint not null check (numero >= 1),
  data_vencimento date not null,
  data_pagamento date null,
  data_pagamento_primeira date null,
  valor numeric(14, 2) not null check (valor > 0),
  pago_em date null,
  pago_por uuid null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_desembolso_parcela_numero unique (desembolso_id, numero)
);

comment on column desembolsos_parcelas.data_vencimento is
  'Vencimento ORIGINAL da parcela — informado na criação. Congelado após emissão.';
comment on column desembolsos_parcelas.data_pagamento is
  'Data de pagamento vigente, repactuável pelo lápis da aba Títulos a Pagar. Nasce na aprovação.';
comment on column desembolsos_parcelas.data_pagamento_primeira is
  'A primeira data de pagamento definida. Congelada por trigger — repactuar não altera.';

create index idx_desembolsos_parcelas_desembolso on desembolsos_parcelas (desembolso_id);
create index idx_desembolsos_parcelas_a_pagar
  on desembolsos_parcelas (tenant_id, data_pagamento)
  where pago_em is null;

create table desembolsos_regionais (
  desembolso_id uuid not null references desembolsos(id) on delete cascade,
  regional_id uuid not null references regionais(id),
  percentual numeric(5, 2) not null check (percentual > 0 and percentual <= 100),
  primary key (desembolso_id, regional_id)
);

create table desembolsos_anexos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  desembolso_id uuid not null references desembolsos(id) on delete cascade,
  arquivo_path text not null,
  arquivo_nome_original text not null,
  arquivo_tamanho_bytes bigint not null check (arquivo_tamanho_bytes >= 0),
  criado_por uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_desembolsos_anexos_desembolso on desembolsos_anexos (desembolso_id);

-- RLS
alter table desembolsos enable row level security;
alter table desembolsos_parcelas enable row level security;
alter table desembolsos_regionais enable row level security;
alter table desembolsos_anexos enable row level security;

create policy desembolsos_select on desembolsos
  for select to authenticated using (is_tenant_member(tenant_id));
create policy desembolsos_insert on desembolsos
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy desembolsos_update on desembolsos
  for update to authenticated
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy desembolsos_delete on desembolsos
  for delete to authenticated using (is_tenant_member(tenant_id));

create policy desembolsos_parcelas_select on desembolsos_parcelas
  for select to authenticated using (is_tenant_member(tenant_id));
create policy desembolsos_parcelas_insert on desembolsos_parcelas
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy desembolsos_parcelas_update on desembolsos_parcelas
  for update to authenticated
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy desembolsos_parcelas_delete on desembolsos_parcelas
  for delete to authenticated using (is_tenant_member(tenant_id));

create policy desembolsos_regionais_select on desembolsos_regionais
  for select to authenticated
  using (exists (select 1 from desembolsos d where d.id = desembolso_id and is_tenant_member(d.tenant_id)));
create policy desembolsos_regionais_insert on desembolsos_regionais
  for insert to authenticated
  with check (exists (select 1 from desembolsos d where d.id = desembolso_id and is_tenant_member(d.tenant_id)));
create policy desembolsos_regionais_update on desembolsos_regionais
  for update to authenticated
  using (exists (select 1 from desembolsos d where d.id = desembolso_id and is_tenant_member(d.tenant_id)))
  with check (exists (select 1 from desembolsos d where d.id = desembolso_id and is_tenant_member(d.tenant_id)));
create policy desembolsos_regionais_delete on desembolsos_regionais
  for delete to authenticated
  using (exists (select 1 from desembolsos d where d.id = desembolso_id and is_tenant_member(d.tenant_id)));

create policy desembolsos_anexos_select on desembolsos_anexos
  for select to authenticated using (is_tenant_member(tenant_id));
create policy desembolsos_anexos_insert on desembolsos_anexos
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy desembolsos_anexos_update on desembolsos_anexos
  for update to authenticated
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy desembolsos_anexos_delete on desembolsos_anexos
  for delete to authenticated using (is_tenant_member(tenant_id));

grant select, insert, update, delete on desembolsos to authenticated;
grant select, insert, update, delete on desembolsos_parcelas to authenticated;
grant select, insert, update, delete on desembolsos_regionais to authenticated;
grant select, insert, update, delete on desembolsos_anexos to authenticated;

-- Triggers
create trigger trg_desembolsos_updated_at
  before update on desembolsos
  for each row execute function set_updated_at();

create trigger trg_desembolsos_parcelas_updated_at
  before update on desembolsos_parcelas
  for each row execute function set_updated_at();

-- Reusa a função `congela_data_pagamento_primeira()` que já existe (criada
-- na migration 20260817000004_titulos_a_pagar).
create trigger trg_congela_primeira_data
  before update on desembolsos_parcelas
  for each row execute function congela_data_pagamento_primeira();

-- Sequencial DES-NNNNN por tenant (mesmo padrão de gerar_codigo_pp).
create or replace function gerar_codigo_desembolso(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prox integer;
  v_codigo text;
begin
  perform pg_advisory_xact_lock(hashtext('desembolso_seq_' || p_tenant_id::text));

  select coalesce(max(cast(substring(codigo from '^DES-(\d+)$') as integer)), 0) + 1
    into v_prox
    from desembolsos
    where tenant_id = p_tenant_id
      and codigo ~ '^DES-\d+$';

  v_codigo := 'DES-' || lpad(v_prox::text, 5, '0');
  return v_codigo;
end;
$$;

revoke execute on function gerar_codigo_desembolso(uuid) from public;
grant execute on function gerar_codigo_desembolso(uuid) to authenticated;
```

- [ ] **Step 3: Aplicar migration via MCP**

`mcp__supabase-write__apply_migration` com name = `desembolsos`.

- [ ] **Step 4: Conferir aplicação via MCP**

```sql
select
  (select array_agg(v::text) from unnest(enum_range(null::desembolso_status)) as v) as enum_values,
  (select count(*) from information_schema.columns where table_name='desembolsos') as cols_desembolsos,
  (select count(*) from information_schema.columns where table_name='desembolsos_parcelas') as cols_parcelas,
  (select count(*) from pg_policies where tablename in ('desembolsos','desembolsos_parcelas','desembolsos_regionais','desembolsos_anexos')) as policies,
  (select has_function_privilege('authenticated','gerar_codigo_desembolso(uuid)','EXECUTE')) as auth_exec_gerar_codigo;
```

Esperado: `enum_values={em_avaliacao,aprovada,pago,rejeitada,cancelada}`; `cols_desembolsos=26`; `cols_parcelas=11`; `policies=16`; `auth_exec_gerar_codigo=true`.

Testar sequencial:
```sql
select gerar_codigo_desembolso((select id from tenants limit 1));
-- esperado: DES-00001 (ou próximo disponível se testes anteriores criaram)
```

- [ ] **Step 5: Atualizar `lib/types.ts`**

Adicionar na região "Task 012: contas_avulsas" (após `ContaAvulsa`, aproximadamente linha 1520):

```typescript
// ---------- Desembolsos (20/08/2026) ----------

export type DesembolsoStatus =
  | "em_avaliacao"
  | "aprovada"
  | "pago"
  | "rejeitada"
  | "cancelada";

export const desembolsoStatusLabel = (s: DesembolsoStatus): string =>
  ({
    em_avaliacao: "Em avaliação",
    aprovada: "Aprovada",
    pago: "Pago",
    rejeitada: "Rejeitada",
    cancelada: "Cancelada",
  })[s];

export interface Desembolso {
  id: string;
  tenant_id: string;
  codigo: string;
  empresa_id: string;
  descricao: string;
  valor: string; // numeric → string
  forma_pagamento: FormaPagamento | null;
  cartao_credito_id: string | null;
  status: DesembolsoStatus;
  fornecedor_id: string | null;
  cliente_id: string | null;
  job_id: string | null;
  data_prevista_pagamento: string | null;
  motivo_rejeicao: string | null;
  motivo_cancelamento: string | null;
  criado_por: string;
  aprovada_por: string | null;
  aprovada_em: string | null;
  rejeitada_por: string | null;
  rejeitada_em: string | null;
  cancelada_por: string | null;
  cancelada_em: string | null;
  pago_em: string | null;
  pago_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface DesembolsoParcela {
  id: string;
  tenant_id: string;
  desembolso_id: string;
  numero: number;
  data_vencimento: string;
  data_pagamento: string | null;
  data_pagamento_primeira: string | null;
  valor: string;
  pago_em: string | null;
  pago_por: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 6: Rodar typecheck + lint**

`npm run typecheck && npm run lint`. Ambos passam.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260820000006_desembolsos.sql lib/types.ts
git commit -m "feat(financeiro): base de desembolsos (4 tabelas + gerar_codigo)"
```

---

## Task 2: Migration enum values em `origem_lancamento`

**Files:**
- Create: `supabase/migrations/20260820000007_desembolso_enum_lancamentos.sql`

**Interfaces:**
- Consumes: enum `origem_lancamento` existente.
- Produces: 3 valores novos no enum: `desembolso_baixa`, `desembolso_baixa_estornada`, `desembolso_estorno`.

**Nota crítica**: `ADD VALUE` num enum precisa commit separado antes de ser usado em constraints/queries. Por isso migration solo.

- [ ] **Step 1: Criar migration**

Arquivo: `supabase/migrations/20260820000007_desembolso_enum_lancamentos.sql`

```sql
-- =====================================================================
-- Novos valores no enum origem_lancamento para desembolsos.
-- Migration separada porque ADD VALUE precisa commit antes de ser usado
-- em constraints (padrão já documentado em 20260813000012).
-- =====================================================================

alter type origem_lancamento add value if not exists 'desembolso_baixa';
alter type origem_lancamento add value if not exists 'desembolso_baixa_estornada';
alter type origem_lancamento add value if not exists 'desembolso_estorno';
```

- [ ] **Step 2: Aplicar migration via MCP**

`mcp__supabase-write__apply_migration` com name = `desembolso_enum_lancamentos`.

- [ ] **Step 3: Conferir**

```sql
select array_agg(v::text order by v::text) as origens
from unnest(enum_range(null::origem_lancamento)) v
where v::text like 'desembolso%';
```

Esperado: `{desembolso_baixa,desembolso_baixa_estornada,desembolso_estorno}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260820000007_desembolso_enum_lancamentos.sql
git commit -m "feat(financeiro): enum origem_lancamento com valores desembolso_*"
```

---

## Task 3: Migration wiring — `lancamentos_financeiros` aceita desembolso

**Files:**
- Create: `supabase/migrations/20260820000008_desembolso_wiring_lancamentos.sql`
- Modify: `lib/types.ts` (estender `OrigemLancamento` + `OrigemTitulo`)

**Interfaces:**
- Consumes: enum `origem_lancamento` estendido (Task 2), tabelas `desembolsos` + `desembolsos_parcelas` (Task 1).
- Produces:
  - Coluna `desembolso_id uuid null references desembolsos(id)` em `lancamentos_financeiros`.
  - Coluna `desembolso_parcela_id uuid null references desembolsos_parcelas(id)` em `lancamentos_financeiros`.
  - Índices em ambas as FKs.
  - Constraint `uniq_baixa_ativa_por_desembolso_parcela` (unique parcial).
  - Constraints `chk_origem_tem_referencia` e `chk_origem_contraparte_tem_id` reescritas para aceitar as 3 origens novas.
  - Types TS: `OrigemLancamento` estendido com 3 novos valores; `OrigemTitulo` union estendido com `"desembolso"`.

- [ ] **Step 1: Ler estado atual pelo MCP**

```sql
-- Ver definição atual das constraints
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.lancamentos_financeiros'::regclass
  and conname in ('chk_origem_tem_referencia','chk_origem_contraparte_tem_id');
```

Cole a saída no report para basear a nova versão fielmente.

- [ ] **Step 2: Criar migration**

Arquivo: `supabase/migrations/20260820000008_desembolso_wiring_lancamentos.sql`

```sql
-- =====================================================================
-- Wiring de desembolso em lancamentos_financeiros:
-- - FKs para desembolso e parcela.
-- - Índices.
-- - Unique parcial para idempotência da baixa.
-- - Constraints check ampliadas.
--
-- Depende de: 20260820000006 (tabelas), 20260820000007 (enum values).
-- =====================================================================

alter table lancamentos_financeiros
  add column if not exists desembolso_id uuid null
    references desembolsos(id) on delete restrict,
  add column if not exists desembolso_parcela_id uuid null
    references desembolsos_parcelas(id) on delete restrict;

comment on column lancamentos_financeiros.desembolso_id is
  'Desembolso que este lançamento quitou (via desembolso_baixa) ou estornou. Nulo em outras origens.';
comment on column lancamentos_financeiros.desembolso_parcela_id is
  'Parcela do desembolso que este lançamento quitou. Nulo em lançamento que não veio de baixa de parcela.';

create index if not exists idx_lancamentos_desembolso
  on lancamentos_financeiros (desembolso_id)
  where desembolso_id is not null;

create index if not exists idx_lancamentos_desembolso_parcela
  on lancamentos_financeiros (desembolso_parcela_id)
  where desembolso_parcela_id is not null;

-- Idempotência: uma parcela só tem uma baixa ativa.
create unique index if not exists uniq_baixa_ativa_por_desembolso_parcela
  on lancamentos_financeiros (desembolso_parcela_id)
  where desembolso_parcela_id is not null
    and origem = 'desembolso_baixa';

-- Constraints check ampliadas — mantém regra existente + adiciona ramo desembolso.
alter table lancamentos_financeiros
  drop constraint if exists chk_origem_tem_referencia;

alter table lancamentos_financeiros
  add constraint chk_origem_tem_referencia check (
    (origem in ('pp_baixa','pp_baixa_estornada','pp_estorno')
      and pedido_compra_id is not null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null)
    or
    (origem in ('avulsa_baixa','avulsa_baixa_estornada','avulsa_estorno')
      and conta_avulsa_id is not null
      and pedido_compra_id is null
      and titulo_receber_id is null
      and desembolso_id is null)
    or
    (origem in ('titulo_baixa','titulo_baixa_estornada','titulo_estorno')
      and titulo_receber_id is not null
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and desembolso_id is null)
    or
    (origem in ('desembolso_baixa','desembolso_baixa_estornada','desembolso_estorno')
      and desembolso_id is not null
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null)
    or
    (origem = 'manual'
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null)
  );

alter table lancamentos_financeiros
  drop constraint if exists chk_origem_contraparte_tem_id;

alter table lancamentos_financeiros
  add constraint chk_origem_contraparte_tem_id check (
    (origem in ('pp_baixa','pp_baixa_estornada','pp_estorno') and pedido_compra_id is not null)
    or
    (origem in ('avulsa_baixa','avulsa_baixa_estornada','avulsa_estorno') and conta_avulsa_id is not null)
    or
    (origem in ('titulo_baixa','titulo_baixa_estornada','titulo_estorno') and titulo_receber_id is not null)
    or
    (origem in ('desembolso_baixa','desembolso_baixa_estornada','desembolso_estorno') and desembolso_id is not null)
    or
    (origem = 'manual'
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null)
  );
```

- [ ] **Step 3: Aplicar migration via MCP**

`mcp__supabase-write__apply_migration` com name = `desembolso_wiring_lancamentos`.

- [ ] **Step 4: Conferir**

```sql
select
  (select count(*) from information_schema.columns
    where table_name='lancamentos_financeiros'
      and column_name in ('desembolso_id','desembolso_parcela_id')) as cols_novas,
  (select count(*) from pg_indexes
    where indexname in ('idx_lancamentos_desembolso','idx_lancamentos_desembolso_parcela','uniq_baixa_ativa_por_desembolso_parcela')) as indices,
  (select conname from pg_constraint
    where conrelid='public.lancamentos_financeiros'::regclass
      and conname='chk_origem_tem_referencia') as chk_ref,
  (select conname from pg_constraint
    where conrelid='public.lancamentos_financeiros'::regclass
      and conname='chk_origem_contraparte_tem_id') as chk_contra;
```

Esperado: `cols_novas=2`, `indices=3`, `chk_ref='chk_origem_tem_referencia'`, `chk_contra='chk_origem_contraparte_tem_id'`.

Testar constraint (deve falhar):
```sql
insert into lancamentos_financeiros
  (tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor, natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id, origem, criado_por)
values
  ((select id from tenants limit 1), (select id from empresas limit 1),
   (select id from contas_bancarias limit 1), current_date, 100, 'saida', 'teste',
   (select id from plano_contas_tipos limit 1), (select id from plano_contas_subtipos limit 1),
   'desembolso_baixa', (select id from profiles limit 1));
-- esperado: erro por chk_origem_contraparte_tem_id (falta desembolso_id)
```

- [ ] **Step 5: Atualizar `lib/types.ts`**

Estender `OrigemLancamento`:

```typescript
export type OrigemLancamento =
  | "pp_baixa"
  | "pp_baixa_estornada"
  | "pp_estorno"
  | "avulsa_baixa"
  | "avulsa_baixa_estornada"
  | "avulsa_estorno"
  | "titulo_baixa"
  | "titulo_baixa_estornada"
  | "titulo_estorno"
  | "desembolso_baixa"
  | "desembolso_baixa_estornada"
  | "desembolso_estorno"
  | "manual";
```

E `OrigemTitulo` (em `titulos-pagar-list.tsx` ou onde estiver definido — provavelmente em `titulos-pagar-list.tsx`):

```typescript
export type OrigemTitulo = "pp" | "avulso" | "recorrencia" | "desembolso";
```

Rodar `grep -r "OrigemTitulo" .` para achar os call sites; nenhum deve quebrar (o union apenas se expande).

- [ ] **Step 6: Rodar typecheck + lint**

`npm run typecheck && npm run lint`. Passar.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260820000008_desembolso_wiring_lancamentos.sql lib/types.ts
git commit -m "feat(financeiro): lancamentos_financeiros aceita origem desembolso"
```

---

## Task 4: Migration RPCs + patch em `dar_baixa_lote_cartao`

**Files:**
- Create: `supabase/migrations/20260820000009_desembolso_rpcs.sql`

**Interfaces:**
- Consumes: tabelas + enum (Tasks 1-3), função `is_tenant_member`, função `proxima_fatura_cartao` (Task 4 cartões).
- Produces:
  - `aprovar_desembolso_com_data(p_desembolso_id uuid, p_data_pagamento date) returns void`.
  - `dar_baixa_desembolso_parcela(p_parcela_id, p_pago_em, p_conta_bancaria_id, p_plano_conta_tipo_id, p_plano_conta_subtipo_id, p_criado_por) returns uuid`.
  - `estornar_baixa_desembolso_parcela(p_parcela_id uuid, p_motivo text, p_criado_por uuid) returns uuid`.
  - Patch em `dar_baixa_lote_cartao` para aceitar origem `'desembolso'`.

- [ ] **Step 1: Ler assinaturas atuais das RPCs pai (padrão) via MCP**

```sql
select proname, pg_get_function_identity_arguments(oid) as args, pg_get_function_result(oid) as returns
from pg_proc
where proname in ('aprovar_pp_com_data','dar_baixa_pp_parcela','dar_baixa_lote_cartao');
```

Cole a saída no report.

Também ler o corpo de `dar_baixa_lote_cartao` para saber o formato exato do dispatch:

```sql
select prosrc from pg_proc where proname = 'dar_baixa_lote_cartao';
```

- [ ] **Step 2: Criar migration**

Arquivo: `supabase/migrations/20260820000009_desembolso_rpcs.sql`

```sql
-- =====================================================================
-- RPCs de desembolso + patch em dar_baixa_lote_cartao.
-- Padrão herdado de aprovar_pp_com_data / dar_baixa_pp_parcela /
-- estornar_baixa_pp_parcela (migrations 20260817000004 e 20260818000002).
-- =====================================================================

-- 1. Aprovar desembolso definindo a data de pagamento.
create or replace function aprovar_desembolso_com_data(
  p_desembolso_id uuid,
  p_data_pagamento date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desembolso     desembolsos%rowtype;
  v_user_id        uuid := auth.uid();
  v_venc_primeira  date;
  v_delta          integer;
begin
  if v_user_id is null then raise exception 'Sessão inválida.'; end if;

  select * into v_desembolso from desembolsos where id = p_desembolso_id;
  if not found then raise exception 'Desembolso não encontrado.'; end if;

  if not is_tenant_member(v_desembolso.tenant_id) then
    raise exception 'Sem acesso a este desembolso.';
  end if;

  if v_desembolso.status <> 'em_avaliacao' then
    raise exception 'Desembolso precisa estar em avaliação (status atual: %).', v_desembolso.status;
  end if;

  if p_data_pagamento is null then
    raise exception 'Escolha a data de pagamento antes de aprovar.';
  end if;

  select data_vencimento into v_venc_primeira
    from desembolsos_parcelas
   where desembolso_id = p_desembolso_id
   order by numero
   limit 1;

  if v_venc_primeira is null then
    raise exception 'Desembolso sem parcelas — não é possível aprovar.';
  end if;

  v_delta := p_data_pagamento - v_venc_primeira;

  update desembolsos_parcelas
     set data_pagamento          = data_vencimento + v_delta,
         data_pagamento_primeira = coalesce(data_pagamento_primeira,
                                            data_vencimento + v_delta)
   where desembolso_id = p_desembolso_id;

  update desembolsos
     set status       = 'aprovada',
         aprovada_em  = now(),
         aprovada_por = v_user_id
   where id = p_desembolso_id;
end;
$$;

comment on function aprovar_desembolso_com_data(uuid, date) is
  'Aprova o desembolso e define a data de pagamento das parcelas, deslocando todas pelo mesmo delta em relação ao vencimento da 1ª. Padrão herdado de aprovar_pp_com_data.';

revoke execute on function aprovar_desembolso_com_data(uuid, date) from public;
grant execute on function aprovar_desembolso_com_data(uuid, date) to authenticated;


-- 2. Dar baixa em uma parcela.
create or replace function dar_baixa_desembolso_parcela(
  p_parcela_id             uuid,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por             uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela        desembolsos_parcelas%rowtype;
  v_desembolso     desembolsos%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_total          integer;
  v_em_aberto      integer;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  select * into v_parcela from desembolsos_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  if not is_tenant_member(v_parcela.tenant_id) then
    raise exception 'Sem acesso a esta parcela.';
  end if;

  if v_parcela.pago_em is not null then
    raise exception 'Esta parcela já está paga.';
  end if;

  select * into v_desembolso from desembolsos where id = v_parcela.desembolso_id;
  if not found then raise exception 'Desembolso não encontrado.'; end if;

  if v_desembolso.status <> 'aprovada' then
    raise exception 'O desembolso precisa estar aprovado antes da baixa (status atual: %).', v_desembolso.status;
  end if;

  select * into v_conta from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_desembolso.empresa_id then
    raise exception 'Conta bancária não pertence à empresa do desembolso.';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo
    from plano_contas_subtipos
   where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  select count(*)::int into v_total
    from desembolsos_parcelas
   where desembolso_id = v_desembolso.id;

  update desembolsos_parcelas
     set pago_em  = p_pago_em,
         pago_por = p_criado_por
   where id = p_parcela_id;

  v_descricao := 'Desembolso ' || v_desembolso.codigo
                 || ' ' || v_parcela.numero || '/' || v_total
                 || ' — ' || substring(v_desembolso.descricao, 1, 140);

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id,
    desembolso_id, desembolso_parcela_id,
    origem, criado_por
  ) values (
    v_desembolso.tenant_id, v_desembolso.empresa_id, p_conta_bancaria_id, p_pago_em, v_parcela.valor,
    'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_desembolso.fornecedor_id, v_desembolso.cliente_id, v_desembolso.job_id,
    v_desembolso.id, v_parcela.id,
    'desembolso_baixa', p_criado_por
  )
  returning id into v_lancamento_id;

  -- Promove desembolso a "pago" quando não sobra parcela em aberto.
  select count(*)::int into v_em_aberto
    from desembolsos_parcelas
   where desembolso_id = v_desembolso.id and pago_em is null;

  if v_em_aberto = 0 then
    update desembolsos
       set status   = 'pago',
           pago_em  = now(),
           pago_por = p_criado_por
     where id = v_desembolso.id;
  end if;

  return v_lancamento_id;
end;
$$;

comment on function dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid) is
  'Baixa UMA parcela de desembolso aprovado, gera o lançamento com o valor da parcela e promove o desembolso a pago quando a última parcela é quitada. Padrão herdado de dar_baixa_pp_parcela.';

revoke execute on function dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid) from public;
grant execute on function dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid) to authenticated;


-- 3. Estornar a baixa de uma parcela.
create or replace function estornar_baixa_desembolso_parcela(
  p_parcela_id uuid,
  p_motivo     text,
  p_criado_por uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela        desembolsos_parcelas%rowtype;
  v_desembolso     desembolsos%rowtype;
  v_lanc_original  lancamentos_financeiros%rowtype;
  v_lanc_reverso_id uuid;
begin
  select * into v_parcela from desembolsos_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  if not is_tenant_member(v_parcela.tenant_id) then
    raise exception 'Sem acesso a esta parcela.';
  end if;

  if v_parcela.pago_em is null then
    raise exception 'Esta parcela não está paga.';
  end if;

  if p_motivo is null or length(trim(p_motivo)) < 10 then
    raise exception 'Motivo do estorno precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_desembolso from desembolsos where id = v_parcela.desembolso_id;

  -- Localiza o lançamento ativo da baixa desta parcela.
  select * into v_lanc_original
    from lancamentos_financeiros
   where desembolso_parcela_id = p_parcela_id
     and origem = 'desembolso_baixa'
     and cancelado_em is null
   limit 1;

  if not found then
    raise exception 'Lançamento de baixa da parcela não encontrado ou já estornado.';
  end if;

  -- Marca o lançamento original como estornado.
  update lancamentos_financeiros
     set origem       = 'desembolso_baixa_estornada',
         cancelado_em = now(),
         cancelado_por = p_criado_por
   where id = v_lanc_original.id;

  -- Cria o lançamento reverso (entrada = mesmo valor, sinal contrário).
  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id,
    desembolso_id, desembolso_parcela_id,
    origem, criado_por
  ) values (
    v_lanc_original.tenant_id, v_lanc_original.empresa_id, v_lanc_original.conta_bancaria_id, current_date, v_lanc_original.valor,
    'entrada', 'Estorno: ' || substring(p_motivo, 1, 200), v_lanc_original.plano_conta_tipo_id, v_lanc_original.plano_conta_subtipo_id,
    v_lanc_original.fornecedor_id, v_lanc_original.cliente_id, v_lanc_original.job_id,
    v_lanc_original.desembolso_id, v_lanc_original.desembolso_parcela_id,
    'desembolso_estorno', p_criado_por
  )
  returning id into v_lanc_reverso_id;

  -- Desmarca parcela como paga.
  update desembolsos_parcelas
     set pago_em  = null,
         pago_por = null
   where id = p_parcela_id;

  -- Se o desembolso estava 'pago', volta para 'aprovada'.
  if v_desembolso.status = 'pago' then
    update desembolsos
       set status   = 'aprovada',
           pago_em  = null,
           pago_por = null
     where id = v_desembolso.id;
  end if;

  return v_lanc_reverso_id;
end;
$$;

comment on function estornar_baixa_desembolso_parcela(uuid, text, uuid) is
  'Estorna a baixa de UMA parcela de desembolso. Padrão herdado de estornar_baixa_pp_parcela.';

revoke execute on function estornar_baixa_desembolso_parcela(uuid, text, uuid) from public;
grant execute on function estornar_baixa_desembolso_parcela(uuid, text, uuid) to authenticated;


-- 4. Patch em dar_baixa_lote_cartao: aceita origem 'desembolso'.
create or replace function dar_baixa_lote_cartao(
  p_titulos jsonb,
  p_pago_em date,
  p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por uuid
) returns uuid[]
language plpgsql
security invoker
as $$
declare
  v_titulo jsonb;
  v_origem text;
  v_id uuid;
  v_lanc uuid;
  v_ids uuid[] := '{}';
begin
  if jsonb_typeof(p_titulos) <> 'array' then
    raise exception 'p_titulos deve ser array jsonb';
  end if;
  if jsonb_array_length(p_titulos) = 0 then
    raise exception 'Nenhum título selecionado';
  end if;

  for v_titulo in select * from jsonb_array_elements(p_titulos) loop
    v_origem := v_titulo->>'origem';
    v_id := (v_titulo->>'id')::uuid;

    if v_origem = 'pp' then
      v_lanc := dar_baixa_pp_parcela(
        v_id, p_pago_em,
        p_conta_bancaria_id, p_plano_conta_tipo_id,
        p_plano_conta_subtipo_id, p_criado_por
      );
    elsif v_origem in ('avulso','recorrencia') then
      v_lanc := dar_baixa_avulsa_com_plano(
        v_id, p_pago_em,
        p_conta_bancaria_id, p_plano_conta_tipo_id,
        p_plano_conta_subtipo_id
      );
    elsif v_origem = 'desembolso' then
      v_lanc := dar_baixa_desembolso_parcela(
        v_id, p_pago_em,
        p_conta_bancaria_id, p_plano_conta_tipo_id,
        p_plano_conta_subtipo_id, p_criado_por
      );
    else
      raise exception 'origem desconhecida: %', v_origem;
    end if;

    v_ids := v_ids || v_lanc;
  end loop;

  return v_ids;
end;
$$;

revoke execute on function dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid) from public;
grant execute on function dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid) to authenticated;
```

- [ ] **Step 3: Aplicar migration via MCP**

`mcp__supabase-write__apply_migration` com name = `desembolso_rpcs`.

- [ ] **Step 4: Conferir**

```sql
select proname, pronargs
from pg_proc
where proname in ('aprovar_desembolso_com_data','dar_baixa_desembolso_parcela','estornar_baixa_desembolso_parcela');
-- esperado: 3 linhas com nargs 2, 6, 3 respectivamente.

select has_function_privilege('authenticated','aprovar_desembolso_com_data(uuid, date)','EXECUTE') as p1,
       has_function_privilege('authenticated','dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid)','EXECUTE') as p2,
       has_function_privilege('authenticated','estornar_baixa_desembolso_parcela(uuid, text, uuid)','EXECUTE') as p3;
-- esperado: p1, p2, p3 = true

-- Confirma que dar_baixa_lote_cartao tem branch 'desembolso'
select prosrc from pg_proc where proname = 'dar_baixa_lote_cartao';
-- esperado: contém "elsif v_origem = 'desembolso' then"
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820000009_desembolso_rpcs.sql
git commit -m "feat(financeiro): RPCs de desembolso + patch em dar_baixa_lote_cartao"
```

---

## Task 5: Views `vw_a_pagar` e `vw_fluxo_caixa` recriadas

**Files:**
- Create: `supabase/migrations/20260820000010_views_a_pagar_e_fluxo_caixa_desembolso.sql`

**Interfaces:**
- Consumes: tabelas `desembolsos` + `desembolsos_parcelas`.
- Produces: views `vw_a_pagar` e `vw_fluxo_caixa` recriadas com 4º branch de desembolso.

- [ ] **Step 1: Ler versão atual das views via MCP**

```sql
select viewname, definition from pg_views
where viewname in ('vw_a_pagar','vw_fluxo_caixa');
```

Cole a saída no report. A nova versão preserva TODOS os branches existentes (PP, avulsa/recorrente, título, lançamento) e adiciona o branch de desembolso.

- [ ] **Step 2: Criar migration**

Arquivo: `supabase/migrations/20260820000010_views_a_pagar_e_fluxo_caixa_desembolso.sql`

```sql
-- =====================================================================
-- vw_a_pagar e vw_fluxo_caixa: adicionar 4ª origem "desembolso".
-- Recria as views preservando branches existentes.
-- Ver migration 20260817000004 (versão anterior).
-- =====================================================================

create or replace view vw_a_pagar as
  select
    'pp'::text                                      as origem_tipo,
    par.id                                          as origem_id,
    pp.tenant_id,
    pp.empresa_id,
    par.data_pagamento                              as data_prevista,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'PP ' || pp.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(pp.servico, 1, 150)     as descricao,
    pp.fornecedor_id,
    null::uuid                                      as cliente_id,
    pp.job_id,
    pp.aprovada_em,
    pp.aprovada_por
  from pedidos_compra_parcelas par
  join pedidos_compra pp on pp.id = par.pedido_compra_id
  join lateral (
    select count(*)::int as total
      from pedidos_compra_parcelas x
     where x.pedido_compra_id = par.pedido_compra_id
  ) tot on true
  where pp.status in ('aprovada', 'pago')
    and par.pago_em is null

  union all

  select
    case when a.recorrente_id is not null then 'recorrente'::text
         else 'avulsa'::text end                    as origem_tipo,
    a.id                                            as origem_id,
    a.tenant_id,
    a.empresa_id,
    coalesce(a.data_pagamento, a.data_prevista_pagamento) as data_prevista,
    a.valor,
    a.natureza,
    a.descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_id,
    a.aprovada_em,
    a.aprovada_por
  from contas_avulsas a
  where a.status = 'aprovada'

  union all

  select
    'desembolso'::text                              as origem_tipo,
    par.id                                          as origem_id,
    d.tenant_id,
    d.empresa_id,
    par.data_pagamento                              as data_prevista,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'Desembolso ' || d.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(d.descricao, 1, 150)    as descricao,
    d.fornecedor_id,
    d.cliente_id,
    d.job_id,
    d.aprovada_em,
    d.aprovada_por
  from desembolsos_parcelas par
  join desembolsos d on d.id = par.desembolso_id
  join lateral (
    select count(*)::int as total
      from desembolsos_parcelas x
     where x.desembolso_id = par.desembolso_id
  ) tot on true
  where d.status in ('aprovada', 'pago')
    and par.pago_em is null;


create or replace view vw_fluxo_caixa as
  select
    'previsto'::text                                as situacao,
    'pp'::text                                      as origem_tipo,
    par.id                                          as origem_id,
    pp.tenant_id,
    pp.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    par.data_pagamento                              as data_evento,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'PP ' || pp.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(pp.servico, 1, 150)     as descricao,
    pp.fornecedor_id,
    null::uuid                                      as cliente_id,
    pp.job_id
  from pedidos_compra_parcelas par
  join pedidos_compra pp on pp.id = par.pedido_compra_id
  join lateral (
    select count(*)::int as total
      from pedidos_compra_parcelas x
     where x.pedido_compra_id = par.pedido_compra_id
  ) tot on true
  where pp.status in ('aprovada', 'pago')
    and par.pago_em is null

  union all

  select
    'previsto'::text                                as situacao,
    case when a.recorrente_id is not null then 'recorrente'::text
         else 'avulsa'::text end                    as origem_tipo,
    a.id                                            as origem_id,
    a.tenant_id,
    a.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    coalesce(a.data_pagamento, a.data_prevista_pagamento) as data_evento,
    a.valor,
    a.natureza,
    a.descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_id
  from contas_avulsas a
  where a.status = 'aprovada'

  union all

  select
    'previsto'::text                                as situacao,
    'desembolso'::text                              as origem_tipo,
    par.id                                          as origem_id,
    d.tenant_id,
    d.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    par.data_pagamento                              as data_evento,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'Desembolso ' || d.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(d.descricao, 1, 150)    as descricao,
    d.fornecedor_id,
    d.cliente_id,
    d.job_id
  from desembolsos_parcelas par
  join desembolsos d on d.id = par.desembolso_id
  join lateral (
    select count(*)::int as total
      from desembolsos_parcelas x
     where x.desembolso_id = par.desembolso_id
  ) tot on true
  where d.status in ('aprovada', 'pago')
    and par.pago_em is null

  union all

  select
    'previsto'::text                                as situacao,
    'titulo'::text                                  as origem_tipo,
    t.id                                            as origem_id,
    t.tenant_id,
    t.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    t.data_vencimento                               as data_evento,
    t.valor,
    'entrada'::natureza_lancamento                  as natureza,
    'Título NF ' || f.numero_nf || '/' || t.numero_parcela::text as descricao,
    f.fornecedor_id,
    f.cliente_id,
    null::uuid                                      as job_id
  from titulos_receber t
  join faturamentos f on f.id = t.faturamento_id
  where t.status = 'em_aberto'

  union all

  select
    'realizado'::text                               as situacao,
    'lancamento'::text                              as origem_tipo,
    l.id                                            as origem_id,
    l.tenant_id,
    l.empresa_id,
    l.conta_bancaria_id,
    l.data_movimento                                as data_evento,
    l.valor,
    l.natureza,
    l.descricao,
    l.fornecedor_id,
    l.cliente_id,
    l.job_id
  from lancamentos_financeiros l;
```

- [ ] **Step 3: Aplicar migration via MCP**

`mcp__supabase-write__apply_migration` com name = `views_a_pagar_e_fluxo_caixa_desembolso`.

- [ ] **Step 4: Conferir**

```sql
-- Deve retornar branches distintos
select distinct origem_tipo from vw_a_pagar order by 1;
-- esperado: {avulsa, desembolso, pp, recorrente} (só aparece o que tem linhas)

select distinct origem_tipo from vw_fluxo_caixa order by 1;
-- esperado: {avulsa, desembolso, lancamento, pp, recorrente, titulo}
```

Ambas as views devem existir e o SELECT deve retornar sem erro.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820000010_views_a_pagar_e_fluxo_caixa_desembolso.sql
git commit -m "feat(financeiro): views vw_a_pagar e vw_fluxo_caixa com desembolso"
```

---

## Task 6: Zod validation + server actions

**Files:**
- Create: `lib/validations/desembolso.ts`
- Create: `app/(app)/financeiro/desembolsos/actions.ts`
- Modify: `lib/auth/audit.ts` (7 chaves novas em `AuditAction`)

**Interfaces:**
- Consumes: `FormaPagamento`, `DesembolsoStatus`, `Desembolso`, `DesembolsoParcela` (Tasks 1, 3), RPCs `aprovar_desembolso_com_data`, `dar_baixa_desembolso_parcela` (Task 4), `logAuditEvent`, `requireSession`, `createClient`.
- Produces:
  - Zod schemas: `criarDesembolsoSchema` (com `superRefine` para cartão + rateio 100%), `aprovarDesembolsoSchema`, `rejeitarDesembolsoSchema`, `cancelarDesembolsoSchema`.
  - Server actions: `criarDesembolso(input)`, `aprovarDesembolsoComData(input)`, `rejeitarDesembolso(input)`, `cancelarDesembolso(input)` — todas retornam `{ ok: true } | { ok: false; message: string }`.

- [ ] **Step 1: Criar validation Zod**

Arquivo: `lib/validations/desembolso.ts`

```typescript
import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const rateioSchema = z
  .array(
    z.object({
      regional_id: z.string().uuid("Selecione a regional."),
      percentual: z
        .number({ invalid_type_error: "Informe o percentual." })
        .min(0.01, "Percentual mínimo 0,01.")
        .max(100, "Percentual máximo 100."),
    }),
  )
  .min(1, "Adicione pelo menos uma regional.")
  .refine(
    (a) => Math.abs(a.reduce((s, r) => s + r.percentual, 0) - 100) < 0.01,
    { message: "A soma dos percentuais deve ser 100,00.", path: ["_sum"] },
  )
  .refine(
    (a) => new Set(a.map((r) => r.regional_id)).size === a.length,
    { message: "Cada regional só pode aparecer uma vez.", path: ["_dup"] },
  );

const parcelaSchema = z.object({
  numero: z.number().int().min(1),
  data_vencimento: z.string().regex(dateRegex, "Data em YYYY-MM-DD."),
  valor: z
    .string()
    .refine((v) => !Number.isNaN(Number(v)) && Number(v) > 0, "Valor deve ser positivo."),
});

const formaPagamentoEnum = z.enum([
  "pix",
  "transferencia",
  "boleto",
  "cartao_credito",
]);

export const criarDesembolsoSchema = z
  .object({
    empresa_id: z.string().uuid("Selecione a empresa."),
    descricao: z.string().trim().min(3, "Descrição muito curta.").max(500),
    valor: z
      .string()
      .refine((v) => !Number.isNaN(Number(v)) && Number(v) > 0, "Valor deve ser positivo."),
    forma_pagamento: formaPagamentoEnum,
    cartao_credito_id: z
      .string()
      .uuid()
      .nullable()
      .or(z.literal("").transform(() => null)),
    data_prevista_pagamento: z
      .string()
      .regex(dateRegex, "Data em YYYY-MM-DD.")
      .nullable()
      .or(z.literal("").transform(() => null)),
    fornecedor_id: z
      .string()
      .uuid()
      .nullable()
      .or(z.literal("").transform(() => null)),
    cliente_id: z
      .string()
      .uuid()
      .nullable()
      .or(z.literal("").transform(() => null)),
    job_id: z
      .string()
      .uuid()
      .nullable()
      .or(z.literal("").transform(() => null)),
    rateio: rateioSchema,
    parcelas: z.array(parcelaSchema).min(1, "Adicione pelo menos uma parcela.")
      .refine((ps) => new Set(ps.map((p) => p.numero)).size === ps.length,
        "Número de parcela repetido."),
    anexos: z
      .array(
        z.object({
          path: z.string().min(1),
          nome: z.string().min(1),
          tamanho: z.number().int().positive(),
          mimetype: z.string().min(1),
        }),
      )
      .default([]),
  })
  .superRefine((data, ctx) => {
    if (data.forma_pagamento === "cartao_credito") {
      if (!data.cartao_credito_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Selecione o cartão de crédito.",
          path: ["cartao_credito_id"],
        });
      }
      const hoje = new Date().toISOString().slice(0, 10);
      for (const [i, p] of data.parcelas.entries()) {
        if (p.data_vencimento < hoje) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Cartão exige data futura para cada parcela.",
            path: ["parcelas", i, "data_vencimento"],
          });
        }
      }
    } else if (data.cartao_credito_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cartão só pode ser informado quando a forma é cartão de crédito.",
        path: ["cartao_credito_id"],
      });
    }

    // Soma das parcelas bate com valor total
    const totalParcelas = data.parcelas.reduce((s, p) => s + Number(p.valor), 0);
    const totalDesembolso = Number(data.valor);
    if (Math.abs(totalParcelas - totalDesembolso) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A soma das parcelas deve bater com o valor total.",
        path: ["parcelas"],
      });
    }
  });

export type CriarDesembolsoInput = z.infer<typeof criarDesembolsoSchema>;

export const aprovarDesembolsoSchema = z.object({
  desembolso_id: z.string().uuid(),
  data_pagamento: z.string().regex(dateRegex, "Data em YYYY-MM-DD."),
});

export const rejeitarDesembolsoSchema = z.object({
  desembolso_id: z.string().uuid(),
  motivo: z.string().trim().min(10, "Motivo precisa ter pelo menos 10 caracteres.").max(500),
});

export const cancelarDesembolsoSchema = z.object({
  desembolso_id: z.string().uuid(),
  motivo: z.string().trim().min(10, "Motivo precisa ter pelo menos 10 caracteres.").max(500),
});
```

- [ ] **Step 2: Estender `lib/auth/audit.ts`**

Adicionar ao union `AuditAction` (siga o padrão exato do arquivo — não substitua nada, só acrescente):

```typescript
| "desembolso.criado"
| "desembolso.aprovada"
| "desembolso.rejeitada"
| "desembolso.cancelada"
| "desembolso.parcela_paga"
| "desembolso.parcela_baixa_estornada"
```

- [ ] **Step 3: Criar server actions**

Arquivo: `app/(app)/financeiro/desembolsos/actions.ts`

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  criarDesembolsoSchema,
  aprovarDesembolsoSchema,
  rejeitarDesembolsoSchema,
  cancelarDesembolsoSchema,
} from "@/lib/validations/desembolso";

type Result = { ok: true; id?: string } | { ok: false; message: string };

function revalidarDesembolsos() {
  revalidatePath("/financeiro/desembolsos");
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
}

async function checarGateFinanceiro(): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof requireSession>>; supabase: ReturnType<typeof createClient> }
  | { ok: false; message: string }
> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Apenas admin ou financeiro pode executar esta ação." };
  }
  return { ok: true, session, supabase: createClient() };
}

export async function criarDesembolso(input: unknown): Promise<Result> {
  const parsed = criarDesembolsoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const d = parsed.data;

  const session = await requireSession();
  const supabase = createClient();

  // Gera código sequencial
  const { data: codigo, error: errCod } = await supabase.rpc("gerar_codigo_desembolso", {
    p_tenant_id: session.activeTenant.id,
  });
  if (errCod) return { ok: false, message: `Falha ao gerar código: ${errCod.message}` };

  // INSERT em desembolsos
  const { data: desembolso, error: errIns } = await supabase
    .from("desembolsos")
    .insert({
      tenant_id: session.activeTenant.id,
      codigo,
      empresa_id: d.empresa_id,
      descricao: d.descricao,
      valor: d.valor,
      forma_pagamento: d.forma_pagamento,
      cartao_credito_id: d.cartao_credito_id,
      fornecedor_id: d.fornecedor_id,
      cliente_id: d.cliente_id,
      job_id: d.job_id,
      data_prevista_pagamento: d.data_prevista_pagamento,
      criado_por: session.profile.id,
    })
    .select("id, codigo")
    .single();
  if (errIns) return { ok: false, message: `Falha ao criar desembolso: ${errIns.message}` };

  // INSERT em desembolsos_parcelas
  const parcelasPayload = d.parcelas.map((p) => ({
    tenant_id: session.activeTenant.id,
    desembolso_id: desembolso.id,
    numero: p.numero,
    data_vencimento: p.data_vencimento,
    valor: p.valor,
  }));
  const { error: errParc } = await supabase.from("desembolsos_parcelas").insert(parcelasPayload);
  if (errParc) return { ok: false, message: `Falha ao criar parcelas: ${errParc.message}` };

  // INSERT em desembolsos_regionais
  const rateioPayload = d.rateio.map((r) => ({
    desembolso_id: desembolso.id,
    regional_id: r.regional_id,
    percentual: r.percentual,
  }));
  const { error: errRat } = await supabase.from("desembolsos_regionais").insert(rateioPayload);
  if (errRat) return { ok: false, message: `Falha ao criar rateio: ${errRat.message}` };

  // INSERT em desembolsos_anexos (se houver)
  if (d.anexos.length > 0) {
    const anexosPayload = d.anexos.map((a) => ({
      tenant_id: session.activeTenant.id,
      desembolso_id: desembolso.id,
      arquivo_path: a.path,
      arquivo_nome_original: a.nome,
      arquivo_tamanho_bytes: a.tamanho,
      criado_por: session.profile.id,
    }));
    const { error: errAnx } = await supabase.from("desembolsos_anexos").insert(anexosPayload);
    if (errAnx) return { ok: false, message: `Falha ao anexar arquivos: ${errAnx.message}` };
  }

  await logAuditEvent({
    acao: "desembolso.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: desembolso.id,
    metadata: {
      codigo: desembolso.codigo,
      valor: Number(d.valor),
      forma_pagamento: d.forma_pagamento,
      cartao_credito_id: d.cartao_credito_id,
      qtd_parcelas: d.parcelas.length,
    },
  });

  revalidarDesembolsos();
  return { ok: true, id: desembolso.id };
}

export async function aprovarDesembolsoComData(input: unknown): Promise<Result> {
  const parsed = aprovarDesembolsoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };

  const gate = await checarGateFinanceiro();
  if (!gate.ok) return gate;

  const { data: desembolso } = await gate.supabase
    .from("desembolsos")
    .select("id, codigo, valor, status")
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", gate.session.activeTenant.id)
    .maybeSingle();
  if (!desembolso) return { ok: false, message: "Desembolso não encontrado." };
  if (desembolso.status !== "em_avaliacao") {
    return { ok: false, message: "Só desembolso em avaliação pode ser aprovado." };
  }

  const { error } = await gate.supabase.rpc("aprovar_desembolso_com_data", {
    p_desembolso_id: parsed.data.desembolso_id,
    p_data_pagamento: parsed.data.data_pagamento,
  });
  if (error) return { ok: false, message: `Falha ao aprovar: ${error.message}` };

  await logAuditEvent({
    acao: "desembolso.aprovada",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: desembolso.id,
    metadata: {
      codigo: desembolso.codigo,
      valor: Number(desembolso.valor),
      data_pagamento: parsed.data.data_pagamento,
    },
  });

  revalidarDesembolsos();
  return { ok: true };
}

export async function rejeitarDesembolso(input: unknown): Promise<Result> {
  const parsed = rejeitarDesembolsoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };

  const gate = await checarGateFinanceiro();
  if (!gate.ok) return gate;

  const { data: desembolso } = await gate.supabase
    .from("desembolsos")
    .select("id, codigo, status")
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", gate.session.activeTenant.id)
    .maybeSingle();
  if (!desembolso) return { ok: false, message: "Desembolso não encontrado." };
  if (desembolso.status !== "em_avaliacao") {
    return { ok: false, message: "Só desembolso em avaliação pode ser rejeitado." };
  }

  const { error } = await gate.supabase
    .from("desembolsos")
    .update({
      status: "rejeitada",
      motivo_rejeicao: parsed.data.motivo,
      rejeitada_por: gate.session.profile.id,
      rejeitada_em: new Date().toISOString(),
    })
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", gate.session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao rejeitar: ${error.message}` };

  await logAuditEvent({
    acao: "desembolso.rejeitada",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: desembolso.id,
    metadata: { codigo: desembolso.codigo, motivo: parsed.data.motivo },
  });

  revalidarDesembolsos();
  return { ok: true };
}

export async function cancelarDesembolso(input: unknown): Promise<Result> {
  const parsed = cancelarDesembolsoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };

  const gate = await checarGateFinanceiro();
  if (!gate.ok) return gate;

  const { data: desembolso } = await gate.supabase
    .from("desembolsos")
    .select("id, codigo, status")
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", gate.session.activeTenant.id)
    .maybeSingle();
  if (!desembolso) return { ok: false, message: "Desembolso não encontrado." };
  if (!["em_avaliacao", "aprovada"].includes(desembolso.status)) {
    return { ok: false, message: "Só desembolso em avaliação ou aprovado pode ser cancelado." };
  }

  // Se aprovado, verificar que nenhuma parcela foi baixada
  if (desembolso.status === "aprovada") {
    const { count } = await gate.supabase
      .from("desembolsos_parcelas")
      .select("id", { count: "exact", head: true })
      .eq("desembolso_id", desembolso.id)
      .not("pago_em", "is", null);
    if ((count ?? 0) > 0) {
      return { ok: false, message: "Desembolso já tem parcelas pagas — não pode ser cancelado." };
    }
  }

  const { error } = await gate.supabase
    .from("desembolsos")
    .update({
      status: "cancelada",
      motivo_cancelamento: parsed.data.motivo,
      cancelada_por: gate.session.profile.id,
      cancelada_em: new Date().toISOString(),
    })
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", gate.session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao cancelar: ${error.message}` };

  await logAuditEvent({
    acao: "desembolso.cancelada",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: desembolso.id,
    metadata: { codigo: desembolso.codigo, motivo: parsed.data.motivo, status_anterior: desembolso.status },
  });

  revalidarDesembolsos();
  return { ok: true };
}
```

- [ ] **Step 4: Rodar typecheck + lint**

`npm run typecheck && npm run lint`. Passar. Se AuditAction faltar chaves, o typecheck vai apontar — resolver antes de commit.

- [ ] **Step 5: Commit**

```bash
git add lib/validations/desembolso.ts \
        app/\(app\)/financeiro/desembolsos/actions.ts \
        lib/auth/audit.ts
git commit -m "feat(financeiro): Zod + server actions de desembolso"
```

---

## Task 7: Página `/financeiro/desembolsos` — list + drawer

**Files:**
- Create: `app/(app)/financeiro/desembolsos/page.tsx`
- Create: `app/(app)/financeiro/desembolsos/desembolsos-list.tsx`
- Create: `app/(app)/financeiro/desembolsos/desembolso-drawer.tsx`

**Interfaces:**
- Consumes: `Desembolso`, `DesembolsoStatus`, `FormaPagamento`, `desembolsoStatusLabel`, `bandeiraCartaoLabel` (Tasks 1 e 1 de cartões), server actions da Task 6, componente `FormaPagamentoField` (Task 5 cartões), helper `parcelasParaFatura` + `formatarISO` (Task 4 cartões).
- Produces: página funcional em `/financeiro/desembolsos` com list + botão "Novo Desembolso" + drawer de criação.

- [ ] **Step 1: Ler padrões existentes**

Antes de escrever, ler:
- `app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx` — padrão de drawer de criação com rateio + anexos.
- `app/(app)/jobs/[jobId]/realizado/gerar-pp-drawer.tsx` — padrão de drawer com parcelas dinâmicas + cartão auto-preenche.
- `app/(app)/financeiro/contas-a-pagar/recorrentes-list.tsx` — padrão de list com filtros de chips (Ativas/Paradas/Todas).

- [ ] **Step 2: Criar `page.tsx`**

Arquivo: `app/(app)/financeiro/desembolsos/page.tsx`

```typescript
import { redirect } from "next/navigation";
import { Wallet, ChevronRight } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DesembolsosList } from "./desembolsos-list";
import type { Desembolso, BandeiraCartao } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DesembolsosPage() {
  const session = await requireSession();
  const supabase = createClient();
  const isAdminOrFinanceiro =
    session.activeRole === "administrador" || session.activeRole === "financeiro";

  // Base query
  let query = supabase
    .from("desembolsos")
    .select(`
      id, codigo, descricao, valor, status, forma_pagamento, cartao_credito_id,
      data_prevista_pagamento, criado_por, created_at,
      empresa:empresas(id, razao_social, nome_fantasia),
      fornecedor:fornecedores(id, nome, razao_social),
      criador:profiles!desembolsos_criado_por_fkey(nome)
    `)
    .eq("tenant_id", session.activeTenant.id)
    .order("created_at", { ascending: false });

  // User comum vê só os seus
  if (!isAdminOrFinanceiro) {
    query = query.eq("criado_por", session.profile.id);
  }

  const [desembolsosRes, cartoesRes, empresasRes, fornecedoresRes, clientesRes, jobsRes, regionaisRes] = await Promise.all([
    query,
    supabase
      .from("cartoes_credito")
      .select("id, nome, banco, bandeira, ultimos_4_digitos, dia_vencimento_fatura")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("razao_social"),
    supabase
      .from("fornecedores")
      .select("id, nome, razao_social")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome"),
    supabase
      .from("clientes")
      .select("id, nome_fantasia, razao_social")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    supabase
      .from("jobs")
      .select("id, codigo, nome")
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("regionais")
      .select("id, nome, ativo")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
  ]);

  if (desembolsosRes.error) console.error("[desembolsos.list]", desembolsosRes.error.message);

  const cartoes = (cartoesRes.data ?? []).map((c) => ({
    id: c.id,
    nome: c.nome,
    banco: c.banco,
    bandeira: c.bandeira as BandeiraCartao,
    ultimos_4_digitos: c.ultimos_4_digitos,
    dia_vencimento_fatura: c.dia_vencimento_fatura,
  }));

  const empresasList = (empresasRes.data ?? []).map((e) => ({
    id: e.id,
    nome: e.razao_social ?? e.nome_fantasia ?? "",
  }));
  const fornecedoresList = (fornecedoresRes.data ?? []).map((f) => ({
    id: f.id,
    nome: f.razao_social ?? f.nome,
  }));
  const clientesList = (clientesRes.data ?? []).map((c) => ({
    id: c.id,
    nome: c.razao_social ?? c.nome_fantasia ?? "",
  }));
  const jobsList = (jobsRes.data ?? []).map((j) => ({
    id: j.id,
    codigo: j.codigo,
    nome: j.nome,
  }));
  const regionaisList = (regionaisRes.data ?? []).map((r) => ({
    id: r.id,
    nome: r.nome,
    ativo: r.ativo,
  }));

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/financeiro" className="hover:text-california-red transition-colors">
            Financeiro
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">Desembolsos</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Wallet className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Desembolsos</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl text-pretty">
          Lance suas despesas e acompanhe o status. Ao ser aprovado pelo
          financeiro, o desembolso vira título a pagar.
        </p>
      </header>

      <DesembolsosList
        rows={desembolsosRes.data ?? []}
        cartoes={cartoes}
        empresas={empresasList}
        fornecedores={fornecedoresList}
        clientes={clientesList}
        jobs={jobsList}
        regionais={regionaisList}
        isAdminOrFinanceiro={isAdminOrFinanceiro}
      />
    </div>
  );
}
```

- [ ] **Step 3: Criar `desembolsos-list.tsx`**

Seguir padrão de `recorrentes-list.tsx` (chips de filtro por status + tabela). Colunas: **Código** (com descrição em cinza abaixo), **Empresa**, **Fornecedor**, **Valor**, **Forma** (com badge de cartão se aplicável), **Status** (badge colorida), **Criado por** (só se admin). Linha inteira clicável → `/financeiro/desembolsos/[id]`. Botão "Novo Desembolso" no topo direito abre `DesembolsoDrawer`.

Chips de filtro: **Todos**, **Em avaliação**, **Aprovados**, **Pagos**, **Rejeitados**, **Cancelados**.

Empty state: "Nenhum desembolso lançado ainda. Clique em 'Novo Desembolso' para começar."

- [ ] **Step 4: Criar `desembolso-drawer.tsx`**

Client component. Layout do form (seções):

1. **Empresa** (Select obrigatório).
2. **Descrição** (Textarea obrigatório).
3. **Forma de pagamento** (`FormaPagamentoField` compartilhado).
4. **Fornecedor / Cliente / Job** (3 Selects opcionais).
5. **Valor** (Input numérico).
6. **Parcelas**: input "Quantidade de parcelas" + tabela dinâmica (numero, data_vencimento, valor). Se cartão selecionado, auto-preencher datas via `parcelasParaFatura`. Cada linha editável.
7. **Rateio regional**: mesmo padrão do drawer de conta avulsa (adicionar/remover regionais, editar %, soma = 100).
8. **Data prevista de pagamento** (só editável se não-cartão; se cartão, hint "auto: fatura do cartão").
9. **Anexos**: upload múltiplo via Storage `desembolsos/<tenant_id>/<uuid_desembolso>/<arquivo>`.

Submit: chama `criarDesembolso`. Sucesso: fecha drawer + `router.refresh()` + toast/mensagem inline.

- [ ] **Step 5: Rodar typecheck + lint**

`npm run typecheck && npm run lint`. Passar.

- [ ] **Step 6: Smoke manual (opcional se ambiente permitir)**

- `npm run dev` → login → `/financeiro/desembolsos`.
- Criar desembolso simples (forma=PIX, 1 parcela, sem cartão).
- Confirmar aparição na lista com status "Em avaliação".
- Confirmar via SQL: `select codigo, status, valor from desembolsos order by created_at desc limit 1;`

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/financeiro/desembolsos/page.tsx \
        app/\(app\)/financeiro/desembolsos/desembolsos-list.tsx \
        app/\(app\)/financeiro/desembolsos/desembolso-drawer.tsx
git commit -m "feat(financeiro): pagina de desembolsos com lista + drawer de criacao"
```

---

## Task 8: Página de detalhe + sidebar

**Files:**
- Create: `app/(app)/financeiro/desembolsos/[id]/page.tsx`
- Create: `app/(app)/financeiro/desembolsos/[id]/parcelas-lista.tsx`
- Modify: `components/sidebar.tsx` (adicionar link "Desembolsos")

**Interfaces:**
- Consumes: `Desembolso`, `DesembolsoParcela` (Task 1).
- Produces: página de detalhe read-only em `/financeiro/desembolsos/[id]`, link "Desembolsos" no sidebar do Financeiro.

- [ ] **Step 1: Ler padrão de detalhe**

Ler `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/page.tsx` como referência.

- [ ] **Step 2: Criar `[id]/page.tsx`**

Server component. Fetch: `desembolsos` (com joins empresa, fornecedor, cliente, job, criador, aprovador, rejeitador, cancelador, cartão) + `desembolsos_parcelas` + `desembolsos_regionais` (com join `regionais(nome)`) + `desembolsos_anexos` + `audit_events` filtrado por `entidade_tipo = 'desembolso' and entidade_id = desembolso_id`.

Layout: 
- Header com breadcrumb, código, status badge.
- Cards de dados básicos (empresa, descrição, valor, forma, cartão, datas de aprovação/rejeição/cancelamento).
- Seção "Parcelas" — `<ParcelasLista>` (componente client).
- Seção "Rateio regional" — tabela regional/percentual.
- Seção "Anexos" — links pra download via Storage signed URL.
- Seção "Histórico" — lista de audit events em ordem cronológica.

Se status = `rejeitada`, mostrar box vermelho com `motivo_rejeicao` + quem/quando rejeitou.
Se status = `cancelada`, mesma coisa com `motivo_cancelamento`.

- [ ] **Step 3: Criar `[id]/parcelas-lista.tsx`**

Client component (só para eventual interatividade futura — hoje só exibe). Tabela: **Número**, **Vencimento**, **Data pagamento** (com "primeira" ao lado se diferente), **Valor**, **Status** (badge: A pagar / Pago em <data>).

- [ ] **Step 4: Adicionar link no sidebar**

Modificar `components/sidebar.tsx`. Localizar o grupo "Financeiro" (contém "Contas a Pagar", "Contas a Receber", "Fluxo de Caixa"). Adicionar entrada "Desembolsos" entre "Contas a Pagar" e "Fluxo de Caixa" (ou onde fizer sentido pelo padrão visual):

```tsx
{ label: "Desembolsos", href: "/financeiro/desembolsos", icon: Wallet },
```

Importar `Wallet` de `lucide-react` se ainda não estiver.

- [ ] **Step 5: Rodar typecheck + lint**

`npm run typecheck && npm run lint`. Passar.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/financeiro/desembolsos/\[id\]/ \
        components/sidebar.tsx
git commit -m "feat(financeiro): pagina de detalhe do desembolso + sidebar"
```

---

## Task 9: Aba "Pedidos de Desembolsos" em Contas a Pagar

**Files:**
- Create: `app/(app)/financeiro/contas-a-pagar/desembolsos-list.tsx`
- Create: `app/(app)/financeiro/contas-a-pagar/aprovar-desembolso-dialog.tsx`
- Create: `app/(app)/financeiro/contas-a-pagar/rejeitar-desembolso-dialog.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx` (SELECT desembolsos + prop para tabs)
- Modify: `app/(app)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx` (6ª aba)

**Interfaces:**
- Consumes: `Desembolso`, `desembolsoStatusLabel` (Task 1), server actions `aprovarDesembolsoComData`, `rejeitarDesembolso`, `cancelarDesembolso` (Task 6).
- Produces: aba "Pedidos de Desembolsos" funcional em Contas a Pagar (aprovar/rejeitar/cancelar).

- [ ] **Step 1: Modificar `page.tsx`**

Adicionar SELECT ao `Promise.all`:

```typescript
supabase
  .from("desembolsos")
  .select(`
    id, codigo, descricao, valor, status, forma_pagamento, cartao_credito_id,
    data_prevista_pagamento, motivo_rejeicao, motivo_cancelamento,
    aprovada_em, rejeitada_em, cancelada_em, pago_em, created_at,
    empresa:empresas(id, razao_social, nome_fantasia),
    fornecedor:fornecedores(id, nome, razao_social),
    criador:profiles!desembolsos_criado_por_fkey(nome)
  `)
  .eq("tenant_id", session.activeTenant.id)
  .order("created_at", { ascending: false }),
```

Nomear `desembolsosRes`. Adicionar log de erro.

Contagem de desembolsos em avaliação:
```typescript
const desembolsosPendentesCount = (desembolsosRes.data ?? [])
  .filter((d) => d.status === "em_avaliacao").length;
```

Passar prop para `<ContasPagarTabs>`:
```typescript
desembolsos={<DesembolsosContasPagarList rows={desembolsosRes.data ?? []} />}
desembolsosPendentesCount={desembolsosPendentesCount}
```

- [ ] **Step 2: Modificar `contas-pagar-tabs.tsx`**

Adicionar props:
```typescript
desembolsos: React.ReactNode;
desembolsosPendentesCount: number;
```

TabKey ganha `"desembolsos"`. Aba nova entre "PPs" e "Recorrências":
```tsx
<TabButton
  active={tab === "desembolsos"}
  onClick={() => setTab("desembolsos")}
  count={desembolsosPendentesCount}
>
  Pedidos de Desembolsos
</TabButton>
```

Painel:
```tsx
<div role="tabpanel" aria-hidden={tab !== "desembolsos"}
  className={cn(tab === "desembolsos" ? "" : "hidden")}>
  {desembolsos}
</div>
```

Atualizar comment do topo para 6 abas.

- [ ] **Step 3: Criar `desembolsos-list.tsx` (aba)**

Client component. Tabela com colunas: **Código** (descrição abaixo), **Empresa**, **Fornecedor**, **Valor**, **Criado por**, **Status**, **Ações** (contextuais):
- Se `em_avaliacao`: botões **Aprovar**, **Rejeitar**, **Cancelar**.
- Se `aprovada`: só **Cancelar** (com aviso se tem parcelas pagas).
- Se `pago`/`rejeitada`/`cancelada`: read-only, mostrar motivo se aplicável.

Ao clicar em **Aprovar**, abre `AprovarDesembolsoDialog` (modal com input de data).
Ao clicar em **Rejeitar**, abre `RejeitarDesembolsoDialog` (modal com textarea de motivo).
Ao clicar em **Cancelar**, mesmo padrão (dialog com motivo).

Chips de filtro no topo: **Em avaliação** (default), **Aprovados**, **Todos**.

- [ ] **Step 4: Criar `aprovar-desembolso-dialog.tsx` e `rejeitar-desembolso-dialog.tsx`**

Ambos client. Modal shadcn Dialog.

`AprovarDesembolsoDialog`:
- Campo `data_pagamento` (input date, default hoje).
- Resumo: "Aprovar desembolso <código> — <valor> — <fornecedor>."
- Botão "Confirmar aprovação" chama `aprovarDesembolsoComData`. Sucesso: fecha + `router.refresh()`.

`RejeitarDesembolsoDialog`:
- Campo `motivo` (textarea, min 10 chars).
- Botão "Confirmar rejeição" chama `rejeitarDesembolso`.

Cancelar pode reusar o mesmo padrão de RejeitarDesembolsoDialog com título e action diferentes, OU criar `CancelarDesembolsoDialog` separado. Escolher o mais legível.

- [ ] **Step 5: Rodar typecheck + lint**

`npm run typecheck && npm run lint`. Passar.

- [ ] **Step 6: Smoke manual (se ambiente permitir)**

- Criar desembolso via `/financeiro/desembolsos`.
- Ir para `/financeiro/contas-a-pagar` → aba "Pedidos de Desembolsos".
- Confirmar linha aparece com botões Aprovar/Rejeitar/Cancelar.
- Aprovar com data. Confirmar mudança de status via SQL:
```sql
select status, aprovada_em, aprovada_por from desembolsos where codigo = 'DES-00001';
select numero, data_pagamento, data_pagamento_primeira from desembolsos_parcelas
  where desembolso_id = (select id from desembolsos where codigo = 'DES-00001');
```

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/desembolsos-list.tsx \
        app/\(app\)/financeiro/contas-a-pagar/aprovar-desembolso-dialog.tsx \
        app/\(app\)/financeiro/contas-a-pagar/rejeitar-desembolso-dialog.tsx \
        app/\(app\)/financeiro/contas-a-pagar/page.tsx \
        app/\(app\)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx
git commit -m "feat(financeiro): aba Pedidos de Desembolsos em Contas a Pagar"
```

---

## Task 10: Integração 4ª origem em Títulos a Pagar / Cartão

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx` (4º loop construindo TituloRow a partir de desembolsos_parcelas)
- Modify: `app/(app)/financeiro/contas-a-pagar/titulos-pagar-list.tsx` (`OrigemTitulo` estendido — já feito em Task 3 se aplicado ali, senão aqui)
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-titulos.ts` (schema `origem` + branches em `darBaixaTitulo` e `estornarBaixaTitulo`)
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-cartao.ts` (schema `origem` + batch SELECT ganha 3ª query em desembolsos_parcelas)

**Interfaces:**
- Consumes: RPCs `dar_baixa_desembolso_parcela` e `estornar_baixa_desembolso_parcela` (Task 4), `dar_baixa_lote_cartao` patched (Task 4).
- Produces: parcelas de desembolso aprovado/pago aparecem em "Títulos a Pagar" (ou "Cartão") como origem `'desembolso'`; baixa individual e em lote funcionam.

- [ ] **Step 1: Ler estruturas atuais**

Ler:
- `page.tsx` (loop de PP e avulsa como referência de padrão).
- `titulos-pagar-list.tsx` (type `TituloRow` — verificar se `forma_pagamento` e `cartao_credito_id` já estão lá; foram adicionados na Task 6 de cartões).
- `actions-titulos.ts:194-340` (padrão de dispatch por origem).
- `actions-cartao.ts` (batch SELECT + audit individual).

- [ ] **Step 2: Adicionar SELECT em `page.tsx`**

No `Promise.all` (junto com o SELECT de desembolsos da Task 9, mas se essa Task 9 já for para "Pedidos de Desembolsos", precisa outra query separada com joins de parcelas):

```typescript
supabase
  .from("desembolsos")
  .select(`
    id, codigo, descricao, status, forma_pagamento, cartao_credito_id,
    empresa_id, fornecedor:fornecedores(nome, razao_social),
    job:jobs(codigo),
    parcelas:desembolsos_parcelas(
      id, numero, data_vencimento, data_pagamento, data_pagamento_primeira,
      valor, pago_em
    )
  `)
  .eq("tenant_id", session.activeTenant.id)
  .in("status", ["aprovada", "pago"])
  .order("created_at", { ascending: false }),
```

Nomear `desembolsosTitulosRes`. Reutilizar a query da Task 9 se ela já pega `status = aprovada|pago` (evitar 2 queries).

- [ ] **Step 3: Adicionar 4º loop em `page.tsx`**

Após os 3 loops existentes de PP/avulsa/recorrência:

```typescript
for (const des of (desembolsosTitulosRes.data ?? []) as unknown as Array<{
  id: string;
  codigo: string;
  descricao: string;
  status: "aprovada" | "pago";
  forma_pagamento: FormaPagamento | null;
  cartao_credito_id: string | null;
  empresa_id: string;
  fornecedor: { nome: string | null; razao_social: string | null } | null;
  job: { codigo: string } | null;
  parcelas: Array<{
    id: string;
    numero: number;
    data_vencimento: string;
    data_pagamento: string | null;
    data_pagamento_primeira: string | null;
    valor: string | number;
    pago_em: string | null;
  }>;
}>) {
  const total = des.parcelas.length;
  for (const par of des.parcelas) {
    const baixa = baixaPorDesembolsoParcela.get(par.id); // ver Step 4
    titulos.push({
      id: par.id,
      origem: "desembolso",
      origem_label: des.codigo,
      descricao: des.descricao,
      fornecedor_nome: des.fornecedor?.razao_social ?? des.fornecedor?.nome ?? "—",
      job_codigo: des.job?.codigo ?? "—",
      data_pagamento: par.data_pagamento,
      venc_original: par.data_vencimento,
      data_pagamento_primeira: par.data_pagamento_primeira,
      valor: Number(par.valor),
      parcela_numero: par.numero,
      parcela_total: total,
      status: par.pago_em ? "pago" : "a_pagar",
      empresa_id: des.empresa_id,
      plano_conta_tipo_id: null, // desembolso escolhe na baixa
      plano_conta_subtipo_id: null,
      pago_em: par.pago_em,
      conta_nome: baixa?.conta ?? null,
      centro_nome: baixa?.centro ?? null,
      forma_pagamento: des.forma_pagamento,
      cartao_credito_id: des.cartao_credito_id,
    });
  }
}
```

- [ ] **Step 4: Adicionar 3ª SELECT em `lancamentos_financeiros` (baixas de desembolso)**

Estender a query de baixas existente (que já pega `pp_baixa` e `avulsa_baixa`):

```typescript
supabase
  .from("lancamentos_financeiros")
  .select(`
    pedido_compra_parcela_id, conta_avulsa_id, desembolso_parcela_id, data_movimento,
    conta:contas_bancarias(nome, banco),
    tipo:plano_contas_tipos(codigo),
    subtipo:plano_contas_subtipos(nome)
  `)
  .eq("tenant_id", session.activeTenant.id)
  .in("origem", ["pp_baixa", "avulsa_baixa", "desembolso_baixa"]),
```

Loop de indexação ganha:
```typescript
const baixaPorDesembolsoParcela = new Map<string, BaixaInfo>();
// ...
if (l.desembolso_parcela_id) baixaPorDesembolsoParcela.set(l.desembolso_parcela_id, info);
```

- [ ] **Step 5: Modificar `actions-titulos.ts`**

Estender `origemSchema`:
```typescript
const origemSchema = z.enum(["pp", "avulso", "recorrencia", "desembolso"]);
```

Adicionar branch em `darBaixaTitulo` (após o branch `if (d.origem === "pp")`):

```typescript
if (d.origem === "desembolso") {
  const { data: parcela } = await supabase
    .from("desembolsos_parcelas")
    .select(
      "id, numero, valor, pago_em, desembolso:desembolsos!inner(id, codigo, status)",
    )
    .eq("id", d.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      numero: number;
      valor: string | number;
      pago_em: string | null;
      desembolso: { id: string; codigo: string; status: string } | null;
    }>();

  if (!parcela) return { ok: false, message: "Parcela não encontrada." };
  if (parcela.pago_em) return { ok: false, message: "Esta parcela já está paga." };
  if (parcela.desembolso?.status !== "aprovada") {
    return { ok: false, message: "O desembolso precisa estar aprovado antes da baixa." };
  }

  const { data: lancId, error } = await supabase.rpc("dar_baixa_desembolso_parcela", {
    p_parcela_id: d.id,
    p_pago_em: d.pago_em,
    p_conta_bancaria_id: d.conta_bancaria_id,
    p_plano_conta_tipo_id: d.plano_conta_tipo_id,
    p_plano_conta_subtipo_id: d.plano_conta_subtipo_id,
    p_criado_por: session.profile.id,
  });
  if (error) {
    return { ok: false, message: mensagemDeBaixa(error.message) };
  }

  await logAuditEvent({
    acao: "desembolso.parcela_paga",
    tenantId: session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: parcela.desembolso.id,
    metadata: {
      codigo: parcela.desembolso.codigo,
      parcela_id: parcela.id,
      parcela_numero: parcela.numero,
      valor: Number(parcela.valor),
      pago_em: d.pago_em,
      conta_bancaria_id: d.conta_bancaria_id,
      lancamento_id: lancId,
    },
  });

  revalidarFinanceiro();
  return { ok: true };
}
```

Adicionar branch em `estornarBaixaTitulo` para `d.origem === "desembolso"` (chamando função helper `estornarBaixaDesembolsoParcela` — criar essa função inline como as outras). Padrão: mesma estrutura de `estornarBaixaParcela` mas chamando `estornar_baixa_desembolso_parcela` RPC.

Também adicionar caso `d.origem === "desembolso"` no `mensagemDeBaixa` se houver alguma constraint específica. A unique constraint é `uniq_baixa_ativa_por_desembolso_parcela` — adicionar mapeamento:

```typescript
if (msg.includes("uniq_baixa_ativa_por_desembolso_parcela")) {
  return "Esta parcela de desembolso já tem uma baixa registrada.";
}
```

- [ ] **Step 6: Modificar `actions-cartao.ts`**

Estender enum `origem` no `tituloSchema`:
```typescript
const tituloSchema = z.object({
  origem: z.enum(["pp", "avulso", "recorrencia", "desembolso"]),
  id: z.string().uuid(),
});
```

Batch SELECT: adicionar 3ª query em `desembolsos_parcelas`:
```typescript
const desembolsosIds = d.titulos.filter((t) => t.origem === "desembolso").map((t) => t.id);
let desembolsosData: Array<{ id: string; desembolso_id: string; numero: number; valor: string }> = [];
if (desembolsosIds.length > 0) {
  const { data } = await supabase
    .from("desembolsos_parcelas")
    .select("id, desembolso_id, numero, valor")
    .in("id", desembolsosIds);
  desembolsosData = (data ?? []) as typeof desembolsosData;
}
```

Loop de audit individual: adicionar branch para `origem === "desembolso"`:
```typescript
if (titulo.origem === "desembolso") {
  const parcela = desembolsosData.find((p) => p.id === titulo.id);
  await logAuditEvent({
    acao: "desembolso.parcela_paga",
    tenantId: session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: parcela?.desembolso_id ?? null,
    metadata: {
      parcela_id: titulo.id,
      parcela_numero: parcela?.numero,
      valor: Number(parcela?.valor ?? 0),
      pago_em: d.pago_em,
      lancamento_id: ids[i],
      via: "baixa_lote_cartao",
    },
  });
}
```

Mensagem de erro do RPC: se aparecer constraint de desembolso, tratar:
```typescript
if (error.message.includes("uniq_baixa_ativa_por_desembolso_parcela")) {
  return { ok: false, message: "Uma das parcelas de desembolso já tem baixa registrada." };
}
```

- [ ] **Step 7: Rodar typecheck + lint**

`npm run typecheck && npm run lint`. Passar.

- [ ] **Step 8: Smoke MCP (parcial — auth.uid limits full RPC)**

Verificar que a query de views mostra desembolso:
```sql
-- Criar desembolso teste + aprovar via UI antes; depois:
select origem_tipo, count(*) from vw_a_pagar where origem_tipo = 'desembolso';
```

- [ ] **Step 9: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/page.tsx \
        app/\(app\)/financeiro/contas-a-pagar/actions-titulos.ts \
        app/\(app\)/financeiro/contas-a-pagar/actions-cartao.ts \
        app/\(app\)/financeiro/contas-a-pagar/titulos-pagar-list.tsx
git commit -m "feat(financeiro): desembolso como 4a origem em Titulos a Pagar e Cartao"
```

---

## Task 11: Verificação final E2E

**Files:** nenhum — só verificação.

- [ ] **Step 1: `npm run typecheck && npm run lint && npm run build`**

Todos limpos. Corrigir warnings novos se houver.

- [ ] **Step 2: E2E via UI (roteiro)**

1. Login como user comum → `/financeiro/desembolsos` → botão "Novo Desembolso".
2. Criar desembolso: forma=PIX, 2 parcelas, valores somando total, rateio 100%, upload 1 anexo.
3. Confirmar aparição na lista com status "Em avaliação".
4. Trocar para admin/financeiro → `/financeiro/contas-a-pagar` → aba "Pedidos de Desembolsos".
5. Ver o desembolso lá com botões Aprovar/Rejeitar.
6. Clicar Aprovar com data. Confirmar mudança de status.
7. Ir para aba "Títulos a Pagar" → 2 títulos novos (parcelas) com origem "DES-00001".
8. Baixar 1 parcela individualmente. Confirmar aparição em "Títulos Pagos".
9. Cadastrar cartão de crédito (se não houver). Criar outro desembolso com forma=cartão, 3 parcelas.
10. Aprovar. Ir para "Títulos a Pagar (Cartão)" → grupo do cartão mostra as 3 parcelas.
11. Selecionar todas + baixar em lote. Confirmar sucesso.
12. Voltar para `/financeiro/desembolsos` → status "Pago" nos dois desembolsos.
13. Página de detalhe `/financeiro/desembolsos/[id]` mostra parcelas pagas, histórico completo.

- [ ] **Step 3: Verificar auditoria**

```sql
select acao, count(*), max(created_at)
from audit_events
where acao like 'desembolso%'
group by acao order by 1;
```

Esperado: `desembolso.criado`, `desembolso.aprovada`, `desembolso.parcela_paga` (múltiplas).

- [ ] **Step 4: Verificar views**

```sql
select origem_tipo, count(*) from vw_a_pagar group by origem_tipo order by 1;
select origem_tipo, count(*) from vw_fluxo_caixa where situacao = 'previsto' group by origem_tipo order by 1;
```

Ambas devem incluir `desembolso` como origem quando há títulos pendentes.

- [ ] **Step 5: Commit final (só se algo precisou ajustar)**

Se algo foi corrigido durante o smoke, commit. Senão, feature completa.

---

## Self-Review

**1. Spec coverage:**

- Spec §3.1 (tabela dedicada) → Task 1.
- Spec §3.2 (ciclo de vida) → Task 1 (enum) + Task 4 (RPC aprovar) + Task 6 (actions rejeitar/cancelar).
- Spec §3.3 (rateio regional) → Task 1 (tabela) + Task 6 (Zod rateioSchema) + Task 7 (UI drawer).
- Spec §3.4 (parcelas) → Task 1 (tabela) + Task 6 (Zod parcelaSchema) + Task 7 (UI drawer).
- Spec §3.5 (anexos) → Task 1 (tabela) + Task 6 (Zod anexos) + Task 7 (UI drawer).
- Spec §3.6 (página `/financeiro/desembolsos`) → Task 7 + Task 8.
- Spec §3.7 (aba "Pedidos de Desembolsos") → Task 9.
- Spec §3.8 (4ª origem em Títulos) → Task 3 (types) + Task 10 (integração).
- Spec §3.9 (permissões + RLS) → Task 1 (RLS) + Task 6 (gates em actions).
- Spec §3.10 (auditoria) → Task 6 (audit chaves) + Task 10 (audit em baixa).
- Spec §4.1 (schema 4 tabelas) → Task 1.
- Spec §4.2 (3 RPCs) → Task 4.
- Spec §4.3 (coluna em lancamentos_financeiros + enum OrigemLancamento) → Task 3.
- Spec §4.4 (patch em dar_baixa_lote_cartao) → Task 4.
- Spec §4.5 (types atualizados) → Tasks 1, 3.
- Spec §5 (server actions) → Task 6 (5 actions), Task 10 (integração em darBaixaTitulo/estornarBaixaTitulo/darBaixaLoteCartao).
- Spec §6.1 (página desembolsos) → Task 7.
- Spec §6.2 (aba pedidos) → Task 9.
- Spec §6.3 (sidebar) → Task 8.
- Spec §7 (riscos) → riscos #1 (fluxo de caixa) endereçado em Task 5 (views recriadas); risco #2 (código) endereçado em Task 1 (`gerar_codigo_desembolso`); demais mitigados nas migrations/actions.
- Spec §9 (ordem) → 11 tasks alinhadas.

**2. Placeholder scan:** nenhum "TBD", "TODO", "implement later", "similar to Task N" sem código. Task 7 e 8 têm passos "seguir padrão de X" sempre citando o arquivo exato de referência.

**3. Type consistency:**
- `DesembolsoStatus`, `Desembolso`, `DesembolsoParcela` — Task 1 define, Tasks 6, 7, 8, 9, 10 consomem.
- `OrigemLancamento` estendido em Task 3, usado em Task 10.
- `OrigemTitulo` estendido em Task 3, usado em Task 10.
- Server actions retornam `{ ok: true } | { ok: false; message: string }` consistentemente.
- RPC signatures: `aprovar_desembolso_com_data(uuid, date) returns void`, `dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid) returns uuid`, `estornar_baixa_desembolso_parcela(uuid, text, uuid) returns uuid` — mesmas em Task 4 (definição) e Task 6/10 (chamadas).

Consistente.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-20-desembolsos.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
