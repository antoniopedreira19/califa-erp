# Contas Avulsas — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir contas avulsas (obrigações pendentes fora do fluxo de PP) com fluxo pendente → baixa (gera lançamento) → estorno reverso, histórico de mudanças exposto ao usuário, anexos opcionais, dentro da página renomeada `/financeiro/contas-a-pagar` com 2 tabs (PPs + Avulsas).

**Architecture:** Espelha o padrão `pedidos_compra ↔ lancamentos_financeiros`. Nova tabela `contas_avulsas` armazena a obrigação; ao baixar via RPC transacional (SECURITY DEFINER com `auth.uid()` interno), insere `lancamentos_financeiros` com `origem='avulsa_baixa'`. Estorno reverso via segunda RPC. Anexos em bucket privado próprio. Histórico de mudanças em tabela dedicada exposta na tela de detalhes.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase (Postgres + Auth + RLS + Storage), Tailwind, shadcn/ui, Radix, lucide-react, React Hook Form + Zod.

## Global Constraints

Aplicam a **todas** as tasks. Copiados verbatim de `CLAUDE.md`, `docs/PERFORMANCE.md` e da spec (`docs/superpowers/specs/2026-08-06-contas-avulsas-design.md`).

- **Performance é feature.** Leia `docs/PERFORMANCE.md` antes de tocar `app/(app)/**` ou `lib/supabase/**`.
- **Ortografia pt-BR em toda string visível ao usuário.** Labels, placeholders, botões, títulos, mensagens de erro/toast. Sem `Voce`, `Nao`, `Descricao`, `Acao`, `E obrigatorio`.
- **RLS ≠ GRANT.** Toda migration que cria tabela termina com `grant select, insert, update on ... to authenticated`.
- **Toda tabela operacional tem `tenant_id`** com FK pra `tenants` e RLS via `is_tenant_member(tenant_id)`.
- **Server action pattern:** `requireSession()` → parse Zod → verificar `tenant_id` → executar → `logAuditEvent` → `revalidatePath`.
- **Gate de role em toda ação financeira:** `admin | financeiro` via `checarGateFinanceiro` (helper existente em `financeiro/pedidos-compra/actions.ts` — sim, este arquivo também é renomeado na Task 5, então o helper migra junto).
- **RPCs `SECURITY DEFINER`** derivam `criado_por` de `auth.uid()` internamente. NUNCA aceitar `p_criado_por` como parâmetro cliente-provided (mesmo hardening que fizemos nos RPCs da PP).
- **Radix `<SelectItem>` NUNCA aceita `value=""`.** Usar sentinel (ex: `"__none__"`) e traduzir pra `null` no submit.
- **`<DrawerContent>` não aceita prop `title`** — composition com `<DialogHeader><DialogTitle>`.
- **DatePicker em drawer:** `side="bottom"` + `sideOffset={6}` + `collisionPadding={16}` + largura fixa + `<Calendar fixedWeeks>`.
- **Colunas numéricas do Postgres:** sempre `Number(...)` ao ler no TypeScript.
- **Datas sem timezone (`date`) vão e voltam como `YYYY-MM-DD`.** Nunca `new Date(dbDate)` sem parse manual.
- **`prefetch={false}` em `<Link>` de listas.**
- **`force-dynamic` em pages autenticadas.**
- **`empresa_id` da conta avulsa é imutável após criação** (Zod de `editarContaAvulsa` não aceita o campo).
- **Enum `origem_lancamento` split**: `ADD VALUE` não pode ser usado no mesmo statement que consome o valor. **Task 2 e Task 3 devem ser rodadas como migrations separadas** (Task 2 só ADD VALUE, Task 3 wiring).
- **`git mv` pra rename da pasta** (preserva histórico).
- **Antes de commit:** `npx tsc --noEmit && npx next lint` — exit 0 obrigatório.

---

## Estrutura de arquivos

### Migrations (ordem sequencial obrigatória)

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260806000001_contas_avulsas.sql` | 3 tabelas (`contas_avulsas`, `_anexos`, `_historico`) + enum `conta_avulsa_status` + bucket privado `contas-avulsas` + storage policies |
| `supabase/migrations/20260806000002_lancamentos_avulsa_enum.sql` | Só `ALTER TYPE origem_lancamento ADD VALUE` (3 valores). SEM outros statements. |
| `supabase/migrations/20260806000003_lancamentos_avulsa_wiring.sql` | Coluna `conta_avulsa_id` em `lancamentos_financeiros`, CHECKs reescritos, unique parcial, índice |
| `supabase/migrations/20260806000004_avulsa_rpcs.sql` | RPCs `dar_baixa_avulsa` e `estornar_baixa_avulsa` (SECURITY DEFINER com tenant enforcement) |

### Types e utilitários

| Arquivo | Ação |
|---|---|
| `lib/types.ts` | Adicionar tipos: `ContaAvulsa`, `ContaAvulsaStatus`, `ContaAvulsaAnexo`, `ContaAvulsaHistorico` |
| `lib/auth/audit.ts` | Adicionar audit actions ao union `AuditAction` |
| `lib/validations/conta-avulsa.ts` | **Criar** — Zod schemas de criar + editar |

### Rename da rota

| De | Para |
|---|---|
| `app/(app)/financeiro/pedidos-compra/**` | `app/(app)/financeiro/contas-a-pagar/**` |

Todos os arquivos preservam nome (só a pasta muda). Refs em `revalidatePath`, hub `/financeiro/page.tsx`, imports internos ajustam.

### Componentes novos

| Arquivo | Ação |
|---|---|
| `app/(app)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx` | **Criar** — 2 tabs (PPs, Avulsas) copiando pattern de `<JobTabs>` |
| `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts` | **Criar** — 5 server actions |
| `app/(app)/financeiro/contas-a-pagar/avulsas-list.tsx` | **Criar** — lista da aba com chips + busca |
| `app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx` | **Criar** — form criar/editar com upload de anexos |
| `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/page.tsx` | **Criar** — tela de detalhes |
| `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/baixar-avulsa-modal.tsx` | **Criar** |
| `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/cancelar-baixa-avulsa-modal.tsx` | **Criar** |
| `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/historico-mudancas.tsx` | **Criar** — tabela de histórico |
| `app/(app)/financeiro/contas-a-pagar/page.tsx` | **Modificar** — envolver conteúdo em `<ContasPagarTabs>` |

### Outros ajustes

| Arquivo | Ação |
|---|---|
| `app/(app)/financeiro/page.tsx` | Ajustar href do card "Contas a Pagar" |
| `app/(app)/financeiro/conciliacao/conciliacao-list.tsx` | Badge "Avulsa" para `origem` iniciada em `avulsa_` |
| `app/(app)/financeiro/conciliacao/page.tsx` | Query select embed pra `contas_avulsas(descricao)` quando `conta_avulsa_id != null` |

---

## Task 1: Migration `contas_avulsas` + tabelas auxiliares + bucket + types + audit

**Files:**
- Create: `supabase/migrations/20260806000001_contas_avulsas.sql`
- Modify: `lib/types.ts`
- Modify: `lib/auth/audit.ts`

**Interfaces:**
- Consumes: `public.tenants(id)`, `public.empresas(id)`, `public.profiles(id)`, `public.fornecedores(id)`, `public.clientes(id)`, `public.jobs(id)`, `public.plano_contas_tipos(id)`, `public.plano_contas_subtipos(id)`, `public.contas_bancarias(id)`, `public.is_tenant_member(uuid)`, `natureza_lancamento` enum (existente).
- Produces:
  - Enum `public.conta_avulsa_status` = `pendente | baixada`.
  - Table `public.contas_avulsas`.
  - Table `public.contas_avulsas_anexos`.
  - Table `public.contas_avulsas_historico`.
  - Bucket `contas-avulsas` privado + policies em `storage.objects`.
  - Types TS: `ContaAvulsa`, `ContaAvulsaStatus`, `ContaAvulsaAnexo`, `ContaAvulsaHistorico`.
  - Audit actions: `conta_avulsa.criada|.editada|.excluida|.baixada|.baixa_estornada`.

---

- [ ] **Step 1: Criar arquivo de migration**

Arquivo `supabase/migrations/20260806000001_contas_avulsas.sql`:

```sql
-- =====================================================================
-- Task 012 — contas_avulsas (obrigações pendentes fora de PP)
-- Ver spec: docs/superpowers/specs/2026-08-06-contas-avulsas-design.md
-- =====================================================================

-- 1) Enum de status
do $$ begin
  create type conta_avulsa_status as enum ('pendente', 'baixada');
exception when duplicate_object then null;
end $$;

-- 2) Tabela principal
create table if not exists public.contas_avulsas (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete restrict,
  empresa_id                  uuid not null references public.empresas(id) on delete restrict,
  descricao                   text not null,
  valor                       numeric(14,2) not null,
  natureza                    natureza_lancamento not null,
  data_prevista_pagamento     date,
  status                      conta_avulsa_status not null default 'pendente',
  fornecedor_id               uuid references public.fornecedores(id) on delete restrict,
  cliente_id                  uuid references public.clientes(id) on delete restrict,
  job_id                      uuid references public.jobs(id) on delete restrict,
  plano_conta_tipo_id         uuid not null references public.plano_contas_tipos(id) on delete restrict,
  plano_conta_subtipo_id      uuid not null references public.plano_contas_subtipos(id) on delete restrict,
  pago_em                     date,
  pago_por                    uuid references public.profiles(id),
  conta_bancaria_baixa_id     uuid references public.contas_bancarias(id) on delete restrict,
  criado_por                  uuid not null references public.profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint chk_avulsa_valor_positivo check (valor > 0),
  constraint chk_avulsa_descricao_nao_vazia check (length(trim(descricao)) >= 3),
  constraint chk_avulsa_baixa_consistente check (
    (status = 'baixada'
      and pago_em is not null
      and pago_por is not null
      and conta_bancaria_baixa_id is not null)
    or
    (status = 'pendente'
      and pago_em is null
      and pago_por is null
      and conta_bancaria_baixa_id is null)
  ),
  constraint chk_avulsa_contraparte_unica check (
    not (fornecedor_id is not null and cliente_id is not null)
  )
);

create index if not exists idx_avulsas_tenant on public.contas_avulsas(tenant_id);
create index if not exists idx_avulsas_empresa on public.contas_avulsas(empresa_id);
create index if not exists idx_avulsas_status on public.contas_avulsas(tenant_id, status);
create index if not exists idx_avulsas_data_prevista on public.contas_avulsas(tenant_id, data_prevista_pagamento);
create index if not exists idx_avulsas_fornecedor on public.contas_avulsas(fornecedor_id);
create index if not exists idx_avulsas_cliente on public.contas_avulsas(cliente_id);
create index if not exists idx_avulsas_job on public.contas_avulsas(job_id);

drop trigger if exists trg_avulsas_updated_at on public.contas_avulsas;
create trigger trg_avulsas_updated_at
  before update on public.contas_avulsas
  for each row execute function public.set_updated_at();

alter table public.contas_avulsas enable row level security;

drop policy if exists avulsas_select on public.contas_avulsas;
create policy avulsas_select on public.contas_avulsas
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists avulsas_insert on public.contas_avulsas;
create policy avulsas_insert on public.contas_avulsas
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists avulsas_update on public.contas_avulsas;
create policy avulsas_update on public.contas_avulsas
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists avulsas_delete on public.contas_avulsas;
create policy avulsas_delete on public.contas_avulsas
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.contas_avulsas to authenticated;

-- 3) Tabela de anexos
create table if not exists public.contas_avulsas_anexos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  conta_avulsa_id       uuid not null references public.contas_avulsas(id) on delete cascade,
  arquivo_path          text not null,
  arquivo_nome_original text not null,
  arquivo_tamanho_bytes bigint not null,
  arquivo_mimetype      text not null,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  constraint chk_anexo_avulsa_tamanho_positivo check (arquivo_tamanho_bytes > 0)
);

create index if not exists idx_avulsa_anexos_conta on public.contas_avulsas_anexos(conta_avulsa_id);
create index if not exists idx_avulsa_anexos_tenant on public.contas_avulsas_anexos(tenant_id);

alter table public.contas_avulsas_anexos enable row level security;

drop policy if exists avulsa_anexos_select on public.contas_avulsas_anexos;
create policy avulsa_anexos_select on public.contas_avulsas_anexos
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists avulsa_anexos_insert on public.contas_avulsas_anexos;
create policy avulsa_anexos_insert on public.contas_avulsas_anexos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists avulsa_anexos_delete on public.contas_avulsas_anexos;
create policy avulsa_anexos_delete on public.contas_avulsas_anexos
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, delete on public.contas_avulsas_anexos to authenticated;

-- 4) Tabela de histórico (imutável)
create table if not exists public.contas_avulsas_historico (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  conta_avulsa_id   uuid not null references public.contas_avulsas(id) on delete cascade,
  campo_alterado    varchar(60) not null,
  valor_anterior    text,
  valor_novo        text,
  alterado_por      uuid not null references public.profiles(id),
  alterado_em       timestamptz not null default now()
);

create index if not exists idx_avulsa_hist_conta on public.contas_avulsas_historico(conta_avulsa_id, alterado_em desc);
create index if not exists idx_avulsa_hist_tenant on public.contas_avulsas_historico(tenant_id);

alter table public.contas_avulsas_historico enable row level security;

drop policy if exists avulsa_hist_select on public.contas_avulsas_historico;
create policy avulsa_hist_select on public.contas_avulsas_historico
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists avulsa_hist_insert on public.contas_avulsas_historico;
create policy avulsa_hist_insert on public.contas_avulsas_historico
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

grant select, insert on public.contas_avulsas_historico to authenticated;

-- 5) Bucket privado + storage policies
insert into storage.buckets (id, name, public)
values ('contas-avulsas', 'contas-avulsas', false)
on conflict (id) do nothing;

drop policy if exists avulsas_storage_select on storage.objects;
create policy avulsas_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contas-avulsas'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists avulsas_storage_insert on storage.objects;
create policy avulsas_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contas-avulsas'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists avulsas_storage_delete on storage.objects;
create policy avulsas_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'contas-avulsas'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );
```

- [ ] **Step 2: Adicionar types em `lib/types.ts`**

Adicionar antes do último `export`, ao lado dos types financeiros existentes:

```ts
export type ContaAvulsaStatus = "pendente" | "baixada";

export const contaAvulsaStatusLabel = (s: ContaAvulsaStatus): string =>
  ({
    pendente: "Pendente",
    baixada: "Baixada",
  })[s];

export interface ContaAvulsa {
  id: string;
  tenant_id: string;
  empresa_id: string;
  descricao: string;
  valor: string; // numeric → string do supabase-js
  natureza: NaturezaLancamento;
  data_prevista_pagamento: string | null; // YYYY-MM-DD
  status: ContaAvulsaStatus;
  fornecedor_id: string | null;
  cliente_id: string | null;
  job_id: string | null;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
  pago_em: string | null;
  pago_por: string | null;
  conta_bancaria_baixa_id: string | null;
  criado_por: string;
  created_at: string;
  updated_at: string;
}

export interface ContaAvulsaAnexo {
  id: string;
  tenant_id: string;
  conta_avulsa_id: string;
  arquivo_path: string;
  arquivo_nome_original: string;
  arquivo_tamanho_bytes: number;
  arquivo_mimetype: string;
  created_by: string | null;
  created_at: string;
}

export interface ContaAvulsaHistorico {
  id: string;
  tenant_id: string;
  conta_avulsa_id: string;
  campo_alterado: string;
  valor_anterior: string | null;
  valor_novo: string | null;
  alterado_por: string;
  alterado_em: string;
}
```

- [ ] **Step 3: Adicionar audit actions em `lib/auth/audit.ts`**

No union `AuditAction`, antes de `| "acao_negada"`, adicionar:

```ts
  | "conta_avulsa.criada"
  | "conta_avulsa.editada"
  | "conta_avulsa.excluida"
  | "conta_avulsa.baixada"
  | "conta_avulsa.baixa_estornada"
```

- [ ] **Step 4: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

Não aplicar migration ainda — controller aplica via MCP após review.

```bash
git add supabase/migrations/20260806000001_contas_avulsas.sql lib/types.ts lib/auth/audit.ts
git commit -m "task012: schema contas_avulsas + anexos + historico + bucket"
```

---

## Task 2: Migration ADD VALUE enum `origem_lancamento`

**Files:**
- Create: `supabase/migrations/20260806000002_lancamentos_avulsa_enum.sql`

**Interfaces:**
- Consumes: enum `origem_lancamento` existente.
- Produces: 3 novos valores no enum: `avulsa_baixa`, `avulsa_baixa_estornada`, `avulsa_estorno`.

**Nota crítica:** essa migration existe **sozinha** por causa de restrição do Postgres. `ALTER TYPE ... ADD VALUE` não pode ser usado no mesmo statement que consome o valor recém-adicionado. Task 3 usa esses valores (nos CHECKs), então precisa rodar em migration separada, DEPOIS que esta commit.

---

- [ ] **Step 1: Criar arquivo de migration**

Arquivo `supabase/migrations/20260806000002_lancamentos_avulsa_enum.sql`:

```sql
-- =====================================================================
-- Task 012 — Novos valores no enum origem_lancamento
-- OBS: migration isolada por restrição do Postgres (ADD VALUE não pode
-- ser usado no mesmo statement que consome o valor).
-- =====================================================================

alter type origem_lancamento add value if not exists 'avulsa_baixa';
alter type origem_lancamento add value if not exists 'avulsa_baixa_estornada';
alter type origem_lancamento add value if not exists 'avulsa_estorno';
```

- [ ] **Step 2: Commit**

Controller aplica via MCP após review. Necessário aplicar ANTES da Task 3 rodar.

```bash
git add supabase/migrations/20260806000002_lancamentos_avulsa_enum.sql
git commit -m "task012: adiciona valores avulsa_* ao enum origem_lancamento"
```

---

## Task 3: Wiring em `lancamentos_financeiros` + tipo TS

**Files:**
- Create: `supabase/migrations/20260806000003_lancamentos_avulsa_wiring.sql`
- Modify: `lib/types.ts` (interface `LancamentoFinanceiro`)

**Interfaces:**
- Consumes: enum `origem_lancamento` COM os 3 valores novos (Task 2 já aplicada).
- Produces:
  - Coluna `lancamentos_financeiros.conta_avulsa_id`.
  - CHECK `chk_origem_tem_referencia` (substituindo `chk_origem_pp_tem_pp_id`).
  - CHECK `chk_estorno_consistente` (reescrito).
  - Unique parcial `uniq_baixa_ativa_por_avulsa`.
  - Índice `idx_lanc_avulsa`.
  - Interface `LancamentoFinanceiro` ganha campo `conta_avulsa_id: string | null`.

---

- [ ] **Step 1: Criar arquivo de migration**

Arquivo `supabase/migrations/20260806000003_lancamentos_avulsa_wiring.sql`:

```sql
-- =====================================================================
-- Task 012 — Wiring de contas_avulsas em lancamentos_financeiros
-- Roda APÓS 20260806000002 (que adiciona os valores no enum).
-- =====================================================================

-- 1) Nova coluna FK
alter table public.lancamentos_financeiros
  add column if not exists conta_avulsa_id uuid references public.contas_avulsas(id) on delete restrict;

create index if not exists idx_lanc_avulsa on public.lancamentos_financeiros(conta_avulsa_id);

-- 2) Substituir CHECK chk_origem_pp_tem_pp_id pelo novo
alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_pp_tem_pp_id;

alter table public.lancamentos_financeiros
  add constraint chk_origem_tem_referencia check (
    (origem in ('pp_baixa','pp_baixa_estornada','pp_estorno')
      and pedido_compra_id is not null and conta_avulsa_id is null)
    or
    (origem in ('avulsa_baixa','avulsa_baixa_estornada','avulsa_estorno')
      and conta_avulsa_id is not null and pedido_compra_id is null)
    or
    (origem = 'manual' and pedido_compra_id is null and conta_avulsa_id is null)
  );

-- 3) Substituir CHECK chk_estorno_consistente
alter table public.lancamentos_financeiros
  drop constraint if exists chk_estorno_consistente;

alter table public.lancamentos_financeiros
  add constraint chk_estorno_consistente check (
    (origem in ('pp_estorno','avulsa_estorno') and estorno_de_lancamento_id is not null)
    or
    (origem not in ('pp_estorno','avulsa_estorno') and estorno_de_lancamento_id is null)
  );

-- 4) Unique parcial pra baixa ativa por avulsa
create unique index if not exists uniq_baixa_ativa_por_avulsa
  on public.lancamentos_financeiros(conta_avulsa_id)
  where origem = 'avulsa_baixa';
```

- [ ] **Step 2: Modificar `lib/types.ts` — interface `LancamentoFinanceiro`**

Localizar o `interface LancamentoFinanceiro`. Adicionar campo `conta_avulsa_id: string | null;` logo depois de `pedido_compra_id`:

```ts
export interface LancamentoFinanceiro {
  // ... campos existentes ...
  pedido_compra_id: string | null;
  conta_avulsa_id: string | null;  // ADICIONAR
  estorno_de_lancamento_id: string | null;
  // ... resto ...
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260806000003_lancamentos_avulsa_wiring.sql lib/types.ts
git commit -m "task012: wiring conta_avulsa_id + CHECKs reescritos em lancamentos_financeiros"
```

---

## Task 4: RPCs `dar_baixa_avulsa` e `estornar_baixa_avulsa`

**Files:**
- Create: `supabase/migrations/20260806000004_avulsa_rpcs.sql`

**Interfaces:**
- Consumes: table `contas_avulsas` (Task 1), `lancamentos_financeiros` com coluna `conta_avulsa_id` e enum novos (Tasks 2 e 3).
- Produces:
  - `public.dar_baixa_avulsa(p_conta_avulsa_id uuid, p_pago_em date, p_conta_bancaria_id uuid) returns uuid` (id do lançamento criado). SECURITY DEFINER, `criado_por = auth.uid()` interno.
  - `public.estornar_baixa_avulsa(p_conta_avulsa_id uuid, p_motivo text) returns uuid` (id do lançamento reverso).
  - GRANT EXECUTE de ambas pra `authenticated`.

---

- [ ] **Step 1: Criar arquivo de migration**

Arquivo `supabase/migrations/20260806000004_avulsa_rpcs.sql`:

```sql
-- =====================================================================
-- Task 012 — RPCs transacionais de baixa e estorno de conta avulsa
-- Hardening: criado_por derivado de auth.uid() (não é parâmetro cliente).
-- =====================================================================

create or replace function public.dar_baixa_avulsa(
  p_conta_avulsa_id     uuid,
  p_pago_em             date,
  p_conta_bancaria_id   uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid     uuid;
  v_avulsa         contas_avulsas%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_descricao      text;
  v_lancamento_id  uuid;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then
    raise exception 'Sessão inválida.';
  end if;

  select * into v_avulsa from public.contas_avulsas where id = p_conta_avulsa_id;
  if not found then raise exception 'Conta avulsa não encontrada.'; end if;

  if not public.is_tenant_member(v_avulsa.tenant_id) then
    raise exception 'Sem permissão nesta conta avulsa.';
  end if;

  if v_avulsa.status <> 'pendente' then
    raise exception 'Conta avulsa não está pendente (status atual: %).', v_avulsa.status;
  end if;

  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;

  if v_conta.empresa_id <> v_avulsa.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da conta avulsa.';
  end if;

  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;

  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  update public.contas_avulsas
     set status = 'baixada',
         pago_em = p_pago_em,
         pago_por = v_caller_uid,
         conta_bancaria_baixa_id = p_conta_bancaria_id
   where id = p_conta_avulsa_id;

  v_descricao := 'Avulsa · ' || substring(v_avulsa.descricao, 1, 180);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, conta_avulsa_id,
    origem, criado_por
  ) values (
    v_avulsa.tenant_id, v_avulsa.empresa_id, p_conta_bancaria_id, p_pago_em, v_avulsa.valor,
    v_avulsa.natureza, v_descricao, v_avulsa.plano_conta_tipo_id, v_avulsa.plano_conta_subtipo_id,
    v_avulsa.fornecedor_id, v_avulsa.cliente_id, v_avulsa.job_id, v_avulsa.id,
    'avulsa_baixa', v_caller_uid
  )
  returning id into v_lancamento_id;

  return v_lancamento_id;
end;
$$;

grant execute on function public.dar_baixa_avulsa(uuid, date, uuid) to authenticated;

-- ---------------------------------------------------------------------

create or replace function public.estornar_baixa_avulsa(
  p_conta_avulsa_id  uuid,
  p_motivo           text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid     uuid;
  v_avulsa         contas_avulsas%rowtype;
  v_original       lancamentos_financeiros%rowtype;
  v_reverso_id     uuid;
  v_descricao      text;
  v_natureza_rev   natureza_lancamento;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  select * into v_avulsa from public.contas_avulsas where id = p_conta_avulsa_id;
  if not found then raise exception 'Conta avulsa não encontrada.'; end if;

  if not public.is_tenant_member(v_avulsa.tenant_id) then
    raise exception 'Sem permissão nesta conta avulsa.';
  end if;

  if v_avulsa.status <> 'baixada' then
    raise exception 'Conta avulsa não está baixada (status atual: %).', v_avulsa.status;
  end if;

  select * into v_original
    from public.lancamentos_financeiros
   where conta_avulsa_id = p_conta_avulsa_id and origem = 'avulsa_baixa'
   limit 1;
  if not found then raise exception 'Lançamento original não encontrado.'; end if;

  v_natureza_rev := case when v_original.natureza = 'saida' then 'entrada'::natureza_lancamento
                        else 'saida'::natureza_lancamento end;

  v_descricao := 'Estorno da baixa · ' || substring(v_avulsa.descricao, 1, 100)
                 || ' — ' || substring(p_motivo, 1, 200);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, conta_avulsa_id,
    estorno_de_lancamento_id, origem, criado_por
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    v_natureza_rev, v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    v_original.fornecedor_id, v_original.cliente_id, v_original.job_id, v_original.conta_avulsa_id,
    v_original.id, 'avulsa_estorno', v_caller_uid
  )
  returning id into v_reverso_id;

  update public.lancamentos_financeiros
     set origem = 'avulsa_baixa_estornada'
   where id = v_original.id;

  update public.contas_avulsas
     set status = 'pendente',
         pago_em = null,
         pago_por = null,
         conta_bancaria_baixa_id = null
   where id = p_conta_avulsa_id;

  return v_reverso_id;
end;
$$;

grant execute on function public.estornar_baixa_avulsa(uuid, text) to authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260806000004_avulsa_rpcs.sql
git commit -m "task012: RPCs dar_baixa_avulsa e estornar_baixa_avulsa"
```

---

## Task 5: Rename da rota `/pedidos-compra` → `/contas-a-pagar`

**Files:**
- Rename: `app/(app)/financeiro/pedidos-compra/**` → `app/(app)/financeiro/contas-a-pagar/**` (git mv)
- Modify: `app/(app)/financeiro/page.tsx` (href do card)
- Modify: Todos os arquivos internos com `revalidatePath("/financeiro/pedidos-compra")` (buscar via grep)
- Modify: Todos os imports/paths internos que referenciam a pasta antiga

**Interfaces:**
- Consumes: nada.
- Produces:
  - Nova rota `/financeiro/contas-a-pagar/...` funcional.
  - Rota antiga `/financeiro/pedidos-compra/...` deixa de existir (404 se acessada).

---

- [ ] **Step 1: Verificar refs à rota antiga**

Run: `grep -rn "pedidos-compra\|/pedidos-compra" app/ components/ lib/ --include="*.ts" --include="*.tsx"`

Anote todos os arquivos e linhas. Devem incluir:
- `app/(app)/financeiro/page.tsx` — card do hub.
- `app/(app)/financeiro/pedidos-compra/actions.ts` — `revalidatePath` (múltiplos lugares).
- `app/(app)/financeiro/pedidos-compra/pp-drawer-financeiro.tsx` — provavelmente links internos.
- Outros arquivos internos da pasta (auto-referências não precisam mudar após rename).

- [ ] **Step 2: `git mv` da pasta**

```bash
git mv app/\(app\)/financeiro/pedidos-compra app/\(app\)/financeiro/contas-a-pagar
```

- [ ] **Step 3: Atualizar `revalidatePath` em `actions.ts`**

Abrir `app/(app)/financeiro/contas-a-pagar/actions.ts` (novo caminho). Substituir todas as ocorrências de:
- `/financeiro/pedidos-compra` → `/financeiro/contas-a-pagar`

Cuidado: manter `/financeiro/conciliacao` e outras rotas intactas.

- [ ] **Step 4: Atualizar href do card no hub `app/(app)/financeiro/page.tsx`**

Buscar o `<CadastroCard>` ou similar que aponta pra `/financeiro/pedidos-compra`. Alterar `href="/financeiro/pedidos-compra"` → `href="/financeiro/contas-a-pagar"`. Se a descrição ou título mencionar "Pedidos de Compra", ajustar pra refletir que agora inclui avulsas também — sugestão: "Contas a Pagar" (título) e "Pedidos de Compra e lançamentos avulsos aguardando baixa." (descrição).

- [ ] **Step 5: Verificar demais refs**

Run: `grep -rn "pedidos-compra\|/pedidos-compra" app/ components/ lib/ --include="*.ts" --include="*.tsx"`

Deve retornar apenas ocorrências dentro da pasta renomeada `app/(app)/financeiro/contas-a-pagar/` (auto-refs por nome de arquivo, como `pp-drawer-financeiro.tsx`, que continuam válidos pois só a pasta pai mudou). Se aparecer qualquer referência a rota `/financeiro/pedidos-compra` fora da pasta renomeada, corrigir.

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "task012: rename /financeiro/pedidos-compra → /financeiro/contas-a-pagar"
```

---

## Task 6: Componente `<ContasPagarTabs>` + refactor da `page.tsx`

**Files:**
- Create: `app/(app)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx`

**Interfaces:**
- Consumes: nada externo (client component com state local).
- Produces:
  - Component `<ContasPagarTabs pps={...} avulsas={...} ppsPendentesCount={...} avulsasPendentesCount={...} />`.
  - Wrapper de 2 tabs (PPs, Avulsas), badge de contagem em cada uma.
  - **Aba Avulsas por enquanto renderiza placeholder** — Task 8 implementa o `<ContasAvulsasList>` real. Isso mantém a task independente e testável.

---

- [ ] **Step 1: Criar `contas-pagar-tabs.tsx`**

Arquivo `app/(app)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx`:

```tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface Props {
  /** Conteúdo da aba de PPs (já pronto, vindo da page.tsx). */
  pps: React.ReactNode;
  /** Contagem de PPs em avaliação — vira badge. */
  ppsPendentesCount: number;
  /** Conteúdo da aba de avulsas (placeholder até Task 8). */
  avulsas: React.ReactNode;
  /** Contagem de avulsas pendentes — vira badge. */
  avulsasPendentesCount: number;
}

type TabKey = "pps" | "avulsas";

export function ContasPagarTabs({
  pps,
  ppsPendentesCount,
  avulsas,
  avulsasPendentesCount,
}: Props) {
  const [tab, setTab] = React.useState<TabKey>("pps");

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Seções de contas a pagar"
        className="flex items-center gap-1 border-b border-border"
      >
        <TabButton active={tab === "pps"} onClick={() => setTab("pps")}>
          Pedidos de Compra
          {ppsPendentesCount > 0 && (
            <span className="ml-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">
              {ppsPendentesCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "avulsas"} onClick={() => setTab("avulsas")}>
          Lançamentos Avulsos
          {avulsasPendentesCount > 0 && (
            <span className="ml-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">
              {avulsasPendentesCount}
            </span>
          )}
        </TabButton>
      </div>

      <div
        role="tabpanel"
        aria-hidden={tab !== "pps"}
        className={cn(tab === "pps" ? "" : "hidden")}
      >
        {pps}
      </div>
      <div
        role="tabpanel"
        aria-hidden={tab !== "avulsas"}
        className={cn(tab === "avulsas" ? "" : "hidden")}
      >
        {avulsas}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:text-california-red",
        active
          ? "border-california-red text-california-red"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Refactorar `page.tsx` pra envolver conteúdo em tabs**

Abrir `app/(app)/financeiro/contas-a-pagar/page.tsx`.

Adicionar query paralela de avulsas pendentes (contagem — dado real completo entra na Task 8):

```ts
// Dentro do Promise.all já existente, adicionar:
supabase
  .from("contas_avulsas")
  .select("id", { count: "exact", head: true })
  .eq("tenant_id", session.activeTenant.id)
  .eq("status", "pendente"),
```

E adicionar contagem de PPs em avaliação:

```ts
supabase
  .from("pedidos_compra")
  .select("id", { count: "exact", head: true })
  .eq("tenant_id", session.activeTenant.id)
  .eq("status", "em_avaliacao"),
```

No JSX, envolver `<PedidosCompraList>` em `<ContasPagarTabs>`, com placeholder pra aba avulsas:

```tsx
import { ContasPagarTabs } from "./contas-pagar-tabs";

// ... dentro do return, substituir o <PedidosCompraList> por:
<ContasPagarTabs
  pps={
    <PedidosCompraList
      rows={rows}
      contas={contasRes.data ?? []}
      tipos={tiposRes.data ?? []}
      subtipos={subtiposRes.data ?? []}
    />
  }
  ppsPendentesCount={ppsPendentesCountRes.count ?? 0}
  avulsas={
    <div className="rounded-xl border border-dashed border-border py-16 text-center">
      <p className="text-sm text-muted-foreground">
        Aba disponível em breve.
      </p>
    </div>
  }
  avulsasPendentesCount={avulsasPendentesCountRes.count ?? 0}
/>
```

Também atualizar o **subtítulo** da página pra refletir as 2 naturezas:

```tsx
<p className="text-sm text-muted-foreground max-w-2xl">
  Avalie os Pedidos de Compra emitidos pelos GPs e os lançamentos avulsos (aluguel, folha, impostos): ajuste o prazo, dê baixa ou rejeite com motivo justificado.
</p>
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 4: Teste manual mínimo (descritivo)**

Descrever no report:
1. Abrir `/financeiro/contas-a-pagar` — deve mostrar 2 tabs "Pedidos de Compra" (default) e "Lançamentos Avulsos".
2. Aba PPs mostra a mesma lista de antes, com filtros e busca funcionando.
3. Aba Avulsas mostra placeholder "Aba disponível em breve".
4. Badges de contagem aparecem quando > 0.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx app/\(app\)/financeiro/contas-a-pagar/page.tsx
git commit -m "task012: tabs em Contas a Pagar (PPs + placeholder Avulsas)"
```

---

## Task 7: Server actions + Zod + drawer criar/editar

**Files:**
- Create: `lib/validations/conta-avulsa.ts`
- Create: `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts`
- Create: `app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx`

**Interfaces:**
- Consumes: types `ContaAvulsa`, `ContaAvulsaAnexo`, `ContaAvulsaStatus`, `NaturezaLancamento`, `ContaBancaria`, `PlanoContaTipo`, `PlanoContaSubtipo` (do `lib/types`).
- Consumes: table `contas_avulsas`, `contas_avulsas_anexos`, `contas_avulsas_historico`, `lancamentos_financeiros`, bucket `contas-avulsas`.
- Produces:
  - Zod schemas: `criarContaAvulsaSchema`, `editarContaAvulsaSchema`.
  - Server actions:
    - `criarContaAvulsa(input): Result<{ id: string }>`
    - `editarContaAvulsa(id: string, input): Result`
    - `excluirContaAvulsa(id: string): Result`
    - `darBaixaAvulsa(input: { conta_avulsa_id, pago_em, conta_bancaria_id }): Result`
    - `estornarBaixaAvulsa(input: { conta_avulsa_id, motivo }): Result`
    - `signedUrlAnexoAvulsa(anexo_id): Result<{ url: string }>`
  - Component `<ContaAvulsaDrawer mode="criar"|"editar" ... />`.

---

- [ ] **Step 1: Criar Zod schemas em `lib/validations/conta-avulsa.ts`**

```ts
import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const criarContaAvulsaSchema = z.object({
  empresa_id: z.string().uuid("Selecione a empresa."),
  descricao: z.string().trim().min(3, "Descrição muito curta.").max(500),
  valor: z
    .string()
    .refine((v) => !Number.isNaN(Number(v)) && Number(v) > 0, "Valor deve ser positivo."),
  natureza: z.enum(["entrada", "saida"]),
  data_prevista_pagamento: z
    .string()
    .regex(dateRegex, "Data em YYYY-MM-DD.")
    .nullable()
    .or(z.literal("").transform(() => null)),
  fornecedor_id: z.string().uuid().nullable().or(z.literal("").transform(() => null)),
  cliente_id: z.string().uuid().nullable().or(z.literal("").transform(() => null)),
  job_id: z.string().uuid().nullable().or(z.literal("").transform(() => null)),
  plano_conta_tipo_id: z.string().uuid("Selecione o tipo."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo."),
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
}).refine(
  (data) => !(data.fornecedor_id && data.cliente_id),
  { message: "Escolha fornecedor OU cliente, não ambos.", path: ["cliente_id"] },
);

/**
 * Editar não aceita empresa_id (imutável) nem anexos (fluxo separado — anexar
 * numa conta existente é outro caminho, TBD em fase futura; nesta task o
 * editar não altera anexos).
 */
export const editarContaAvulsaSchema = criarContaAvulsaSchema.innerType().omit({
  empresa_id: true,
  anexos: true,
});

export type CriarContaAvulsaInput = z.infer<typeof criarContaAvulsaSchema>;
export type EditarContaAvulsaInput = z.infer<typeof editarContaAvulsaSchema>;

export const baixaAvulsaSchema = z.object({
  conta_avulsa_id: z.string().uuid(),
  pago_em: z.string().regex(dateRegex, "Data em YYYY-MM-DD."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
});

export const estornoAvulsaSchema = z.object({
  conta_avulsa_id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(10, "Motivo precisa ter pelo menos 10 caracteres.")
    .max(500, "Motivo passa de 500 caracteres."),
});
```

- [ ] **Step 2: Criar `actions-avulsas.ts`**

Arquivo `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts`:

Base do arquivo (copiar helper `checarGateFinanceiro` do `actions.ts` irmão — não reimportar do arquivo, DUPLICAR o helper aqui pra evitar acoplamento entre módulos):

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  criarContaAvulsaSchema,
  editarContaAvulsaSchema,
  baixaAvulsaSchema,
  estornoAvulsaSchema,
} from "@/lib/validations/conta-avulsa";

type Ok<T = { id: string }> = { ok: true } & Partial<T>;
type Err = { ok: false; message: string; fieldErrors?: Record<string, string[]> };
type Result<T = { id: string }> = Ok<T> | Err;

async function checarGateFinanceiro(
  contaAvulsaId: string | null,
  acaoTentada: string,
) {
  const session = await requireSession();
  const supabase = createClient();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "conta_avulsa",
      entidadeId: contaAvulsaId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false as const, message: "Apenas admin ou financeiro pode executar esta ação." };
  }
  return { ok: true as const, session, supabase };
}

export async function criarContaAvulsa(input: unknown): Promise<Result> {
  const parsed = criarContaAvulsaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const gate = await checarGateFinanceiro(null, "conta_avulsa.criada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const d = parsed.data;

  // Valida subtipo pertence ao tipo
  const { data: subtipo } = await supabase
    .from("plano_contas_subtipos")
    .select("tipo_id, ativo")
    .eq("id", d.plano_conta_subtipo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!subtipo || subtipo.tipo_id !== d.plano_conta_tipo_id || !subtipo.ativo) {
    return { ok: false, message: "Subtipo inválido ou não pertence ao tipo escolhido." };
  }

  // INSERT
  const { data: conta, error } = await supabase
    .from("contas_avulsas")
    .insert({
      tenant_id: session.activeTenant.id,
      empresa_id: d.empresa_id,
      descricao: d.descricao,
      valor: d.valor,
      natureza: d.natureza,
      data_prevista_pagamento: d.data_prevista_pagamento,
      fornecedor_id: d.fornecedor_id,
      cliente_id: d.cliente_id,
      job_id: d.job_id,
      plano_conta_tipo_id: d.plano_conta_tipo_id,
      plano_conta_subtipo_id: d.plano_conta_subtipo_id,
      criado_por: session.profile.id,
    })
    .select("id")
    .single();

  if (error || !conta) {
    console.error("[avulsa.criar]", error?.message);
    return { ok: false, message: error?.message ?? "Falha ao criar conta avulsa." };
  }

  // Anexos em bulk
  if (d.anexos.length > 0) {
    const rows = d.anexos.map((a) => ({
      tenant_id: session.activeTenant.id,
      conta_avulsa_id: conta.id,
      arquivo_path: a.path,
      arquivo_nome_original: a.nome,
      arquivo_tamanho_bytes: a.tamanho,
      arquivo_mimetype: a.mimetype,
      created_by: session.profile.id,
    }));
    const { error: anexErr } = await supabase.from("contas_avulsas_anexos").insert(rows);
    if (anexErr) {
      console.error("[avulsa.criar.anexos]", anexErr.message);
      // Não aborta — conta criada, só perdeu anexos. Log e segue.
    }
  }

  await logAuditEvent({
    acao: "conta_avulsa.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: conta.id,
    metadata: {
      descricao: d.descricao,
      valor: Number(d.valor),
      natureza: d.natureza,
      empresa_id: d.empresa_id,
      anexos_count: d.anexos.length,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: conta.id };
}

export async function editarContaAvulsa(id: string, input: unknown): Promise<Result> {
  const parsed = editarContaAvulsaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const gate = await checarGateFinanceiro(id, "conta_avulsa.editada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  // Carrega atual
  const { data: atual } = await supabase
    .from("contas_avulsas")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!atual) return { ok: false, message: "Conta avulsa não encontrada." };
  if (atual.status !== "pendente") {
    return { ok: false, message: "Só conta pendente pode ser editada. Para alterar uma baixada, cancele a baixa antes." };
  }

  const d = parsed.data;

  // Valida subtipo
  const { data: subtipo } = await supabase
    .from("plano_contas_subtipos")
    .select("tipo_id, ativo")
    .eq("id", d.plano_conta_subtipo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!subtipo || subtipo.tipo_id !== d.plano_conta_tipo_id || !subtipo.ativo) {
    return { ok: false, message: "Subtipo inválido ou não pertence ao tipo escolhido." };
  }

  // Compara campo a campo pra montar histórico
  const camposComparaveis = [
    "descricao", "valor", "natureza", "data_prevista_pagamento",
    "fornecedor_id", "cliente_id", "job_id",
    "plano_conta_tipo_id", "plano_conta_subtipo_id",
  ] as const;

  const historicoRows: Array<{
    tenant_id: string;
    conta_avulsa_id: string;
    campo_alterado: string;
    valor_anterior: string | null;
    valor_novo: string | null;
    alterado_por: string;
  }> = [];

  const camposAlterados: string[] = [];

  for (const campo of camposComparaveis) {
    const antes = atual[campo as keyof typeof atual] as unknown;
    const depois = d[campo as keyof typeof d] as unknown;
    // Normaliza null vs undefined vs "" pra comparação estável
    const antesStr = antes == null ? null : String(antes);
    const depoisStr = depois == null ? null : String(depois);
    if (antesStr !== depoisStr) {
      camposAlterados.push(campo);
      historicoRows.push({
        tenant_id: session.activeTenant.id,
        conta_avulsa_id: id,
        campo_alterado: campo,
        valor_anterior: antesStr,
        valor_novo: depoisStr,
        alterado_por: session.profile.id,
      });
    }
  }

  if (camposAlterados.length === 0) {
    return { ok: true, id }; // Nada mudou, retorna OK sem tocar em nada.
  }

  // UPDATE + INSERT bulk historico (não é transacional entre chamadas do supabase-js
  // — em caso de falha do histórico, o UPDATE persiste. Aceitável: histórico é audit,
  // não afeta lógica. Log de erro se falhar.)
  const { error: updErr } = await supabase
    .from("contas_avulsas")
    .update({
      descricao: d.descricao,
      valor: d.valor,
      natureza: d.natureza,
      data_prevista_pagamento: d.data_prevista_pagamento,
      fornecedor_id: d.fornecedor_id,
      cliente_id: d.cliente_id,
      job_id: d.job_id,
      plano_conta_tipo_id: d.plano_conta_tipo_id,
      plano_conta_subtipo_id: d.plano_conta_subtipo_id,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (updErr) {
    return { ok: false, message: `Falha ao atualizar: ${updErr.message}` };
  }

  if (historicoRows.length > 0) {
    const { error: histErr } = await supabase
      .from("contas_avulsas_historico")
      .insert(historicoRows);
    if (histErr) console.error("[avulsa.editar.historico]", histErr.message);
  }

  await logAuditEvent({
    acao: "conta_avulsa.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: id,
    metadata: { campos_alterados: camposAlterados },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath(`/financeiro/contas-a-pagar/avulsa/${id}`);
  return { ok: true, id };
}

export async function excluirContaAvulsa(id: string): Promise<Result> {
  const gate = await checarGateFinanceiro(id, "conta_avulsa.excluida");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: atual } = await supabase
    .from("contas_avulsas")
    .select("id, status, descricao, valor, natureza")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!atual) return { ok: false, message: "Conta avulsa não encontrada." };
  if (atual.status !== "pendente") {
    return { ok: false, message: "Baixa registrada. Para excluir, cancele a baixa antes." };
  }

  // Carrega anexos pra deletar do storage antes do row cascade
  const { data: anexos } = await supabase
    .from("contas_avulsas_anexos")
    .select("arquivo_path")
    .eq("conta_avulsa_id", id);

  if (anexos && anexos.length > 0) {
    const paths = anexos.map((a) => a.arquivo_path);
    const { error: rmErr } = await supabase.storage
      .from("contas-avulsas")
      .remove(paths);
    if (rmErr) console.error("[avulsa.excluir.storage]", rmErr.message);
  }

  const { error } = await supabase
    .from("contas_avulsas")
    .delete()
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao excluir: ${error.message}` };

  await logAuditEvent({
    acao: "conta_avulsa.excluida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: id,
    metadata: {
      descricao: atual.descricao,
      valor: Number(atual.valor),
      natureza: atual.natureza,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id };
}

export async function darBaixaAvulsa(input: unknown): Promise<Result> {
  const parsed = baixaAvulsaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.conta_avulsa_id, "conta_avulsa.baixada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: atual } = await supabase
    .from("contas_avulsas")
    .select("id, status, descricao, valor, natureza")
    .eq("id", parsed.data.conta_avulsa_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!atual) return { ok: false, message: "Conta avulsa não encontrada." };
  if (atual.status !== "pendente") {
    return { ok: false, message: "Conta avulsa não está pendente." };
  }

  const { data: lancId, error } = await supabase.rpc("dar_baixa_avulsa", {
    p_conta_avulsa_id: parsed.data.conta_avulsa_id,
    p_pago_em: parsed.data.pago_em,
    p_conta_bancaria_id: parsed.data.conta_bancaria_id,
  });

  if (error) return { ok: false, message: `Falha ao dar baixa: ${error.message}` };

  await logAuditEvent({
    acao: "conta_avulsa.baixada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: parsed.data.conta_avulsa_id,
    metadata: {
      descricao: atual.descricao,
      valor: Number(atual.valor),
      pago_em: parsed.data.pago_em,
      conta_bancaria_id: parsed.data.conta_bancaria_id,
      lancamento_id: lancId,
    },
  });
  await logAuditEvent({
    acao: "lancamento_financeiro.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "lancamento_financeiro",
    entidadeId: lancId as string,
    metadata: {
      origem: "avulsa_baixa",
      conta_avulsa_id: parsed.data.conta_avulsa_id,
      valor: Number(atual.valor),
      natureza: atual.natureza,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath(`/financeiro/contas-a-pagar/avulsa/${parsed.data.conta_avulsa_id}`);
  return { ok: true, id: parsed.data.conta_avulsa_id };
}

export async function estornarBaixaAvulsa(input: unknown): Promise<Result> {
  const parsed = estornoAvulsaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.conta_avulsa_id, "conta_avulsa.baixa_estornada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: atual } = await supabase
    .from("contas_avulsas")
    .select("id, status, descricao")
    .eq("id", parsed.data.conta_avulsa_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!atual) return { ok: false, message: "Conta avulsa não encontrada." };
  if (atual.status !== "baixada") {
    return { ok: false, message: "Só conta baixada pode ter a baixa estornada." };
  }

  const { data: reversoId, error } = await supabase.rpc("estornar_baixa_avulsa", {
    p_conta_avulsa_id: parsed.data.conta_avulsa_id,
    p_motivo: parsed.data.motivo,
  });

  if (error) return { ok: false, message: `Falha ao estornar: ${error.message}` };

  await logAuditEvent({
    acao: "conta_avulsa.baixa_estornada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: parsed.data.conta_avulsa_id,
    metadata: {
      descricao: atual.descricao,
      motivo: parsed.data.motivo,
      lancamento_reverso_id: reversoId,
    },
  });
  await logAuditEvent({
    acao: "lancamento_financeiro.estornado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "lancamento_financeiro",
    entidadeId: reversoId as string,
    metadata: {
      origem: "avulsa_estorno",
      conta_avulsa_id: parsed.data.conta_avulsa_id,
      motivo: parsed.data.motivo,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath(`/financeiro/contas-a-pagar/avulsa/${parsed.data.conta_avulsa_id}`);
  return { ok: true, id: parsed.data.conta_avulsa_id };
}

export async function signedUrlAnexoAvulsa(anexoId: string): Promise<
  { ok: true; url: string } | Err
> {
  const session = await requireSession();
  const supabase = createClient();
  const { data: anexo } = await supabase
    .from("contas_avulsas_anexos")
    .select("arquivo_path, tenant_id")
    .eq("id", anexoId)
    .maybeSingle();
  if (!anexo || anexo.tenant_id !== session.activeTenant.id) {
    return { ok: false, message: "Anexo não encontrado." };
  }
  const { data, error } = await supabase.storage
    .from("contas-avulsas")
    .createSignedUrl(anexo.arquivo_path, 60);
  if (error || !data) return { ok: false, message: "Falha ao gerar URL." };
  return { ok: true, url: data.signedUrl };
}
```

- [ ] **Step 3: Criar drawer `conta-avulsa-drawer.tsx`**

Arquivo `app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx`.

Componente client complexo. Estrutura resumida (as regras UI abaixo devem ser todas seguidas):

- Import `<DrawerContent>` e `<Dialog>` de `@/components/ui/dialog`, `DialogHeader`, `DialogTitle`.
- Import `<Select>`, `<Input>`, `<DatePicker>` de `@/components/ui/*`.
- Import `createClient` de `@/lib/supabase/client` pro upload direto (`supabase.storage.upload`).
- Props:
  ```ts
  type Props =
    | { mode: "criar"; empresas: Array<{id:string; nome:string}>; tipos: PlanoContaTipo[]; subtipos: PlanoContaSubtipo[]; fornecedores: Array<{id:string;nome:string}>; clientes: Array<{id:string;nome:string}>; jobs: Array<{id:string;codigo:string;nome:string}>; trigger?: React.ReactNode }
    | { mode: "editar"; conta: ContaAvulsa; empresas: ...; tipos: ...; subtipos: ...; fornecedores: ...; clientes: ...; jobs: ...; open: boolean; onOpenChange: (b:boolean)=>void };
  ```
- Estado local com todos os campos + array de anexos (`{path,nome,tamanho,mimetype}[]`).
- Ao abrir em `criar`, reset pra defaults (natureza=`saida`).
- Ao abrir em `editar`, preencher com `props.conta`.
- Empresa: `<Select>` — em modo `editar`, `disabled` com hint "Empresa não pode ser alterada".
- Natureza: 2 botões radio (Saída padrão selecionada).
- Descrição: `<textarea rows={3} maxLength={500}>`.
- Valor: `<Input type="number" step="0.01" className="no-spinner">`.
- Data prevista: `<DatePicker>` opcional.
- Fornecedor / Cliente: `<Combobox>` de busca (se não existir componente, usar `<Select>` simples com sentinel "__none__" — os dois são mutuamente exclusivos, ao escolher um, resetar o outro).
- Job: `<Combobox>` opcional.
- Tipo: `<Select>` de `tipos.filter(t=>t.ativo)`.
- Subtipo: `<Select>` filtrado por `s.tipo_id === tipoId`.
- Upload de anexos (só modo `criar`): input `<input type="file" multiple>`. Ao selecionar arquivo:
  - Gerar path: `${session.activeTenant.id}/${crypto.randomUUID()}-${filename}` (usar `Math.random` fallback se `crypto` não disponível no browser antigo).
  - Chamar `supabase.storage.from("contas-avulsas").upload(path, file, { upsert: false })`.
  - Ao suceder, empurrar `{path, nome: file.name, tamanho: file.size, mimetype: file.type}` no array local.
  - Mostrar lista de anexos com botão remover (deleta do storage + tira do array).
  - Max 8 MB por arquivo, 25 MB total. Validar antes de upload.
- Submit: chama `criarContaAvulsa(input)` ou `editarContaAvulsa(id, input)`. Se error, mostra em bloco vermelho.
- Botão "Criar" ou "Salvar" (verde emerald pra criar, california-red pra editar).

Adaptar do padrão de `<ContaBancariaDrawer>` (Task 2 do plano anterior) — mesma abordagem de props discriminated union.

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/validations/conta-avulsa.ts app/\(app\)/financeiro/contas-a-pagar/actions-avulsas.ts app/\(app\)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx
git commit -m "task012: server actions + Zod + drawer criar/editar de conta avulsa"
```

---

## Task 8: `<ContasAvulsasList>` + integração real na aba Avulsas

**Files:**
- Create: `app/(app)/financeiro/contas-a-pagar/avulsas-list.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx` (substituir placeholder pela lista real)

**Interfaces:**
- Consumes: types `ContaAvulsa`, `ContaAvulsaStatus`, `ContaBancaria`, `PlanoContaTipo`, `PlanoContaSubtipo`, actions `criarContaAvulsa` (via `<ContaAvulsaDrawer>`).
- Produces:
  - Component `<ContasAvulsasList rows={...} empresas={...} tipos={...} subtipos={...} fornecedores={...} clientes={...} jobs={...} />`.
  - Substitui placeholder da Task 6 na `page.tsx`.

---

- [ ] **Step 1: Criar `avulsas-list.tsx`**

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ContaAvulsa,
  ContaAvulsaStatus,
  ContaBancaria,
  PlanoContaTipo,
  PlanoContaSubtipo,
  NaturezaLancamento,
} from "@/lib/types";
import { contaAvulsaStatusLabel } from "@/lib/types";
import { ContaAvulsaDrawer } from "./conta-avulsa-drawer";

export interface AvulsaRow {
  id: string;
  descricao: string;
  valor: number;
  natureza: NaturezaLancamento;
  data_prevista_pagamento: string | null;
  status: ContaAvulsaStatus;
  fornecedor_nome: string | null;
  cliente_nome: string | null;
  job_codigo: string | null;
  empresa_nome: string;
  tipo_codigo: string;
  subtipo_nome: string;
  anexos_count: number;
  pago_em: string | null;
  created_at: string;
}

const STATUS_FILTROS: Array<{ key: "todas" | ContaAvulsaStatus; label: string }> = [
  { key: "pendente", label: "Pendentes" },
  { key: "baixada", label: "Baixadas" },
  { key: "todas", label: "Todas" },
];

const NATUREZA_FILTROS: Array<{ key: "todas" | NaturezaLancamento; label: string }> = [
  { key: "todas", label: "Todas" },
  { key: "saida", label: "Saída" },
  { key: "entrada", label: "Entrada" },
];

function statusBadge(status: ContaAvulsaStatus): string {
  return status === "pendente"
    ? "bg-[#fffbeb] text-[#92400e] border-[#fde68a]"
    : "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface Props {
  rows: AvulsaRow[];
  empresas: Array<{ id: string; nome: string }>;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  fornecedores: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  jobs: Array<{ id: string; codigo: string; nome: string }>;
}

export function ContasAvulsasList({
  rows,
  empresas,
  tipos,
  subtipos,
  fornecedores,
  clientes,
  jobs,
}: Props) {
  const [busca, setBusca] = React.useState("");
  const [statusFiltro, setStatusFiltro] = React.useState<"todas" | ContaAvulsaStatus>("pendente");
  const [naturezaFiltro, setNaturezaFiltro] = React.useState<"todas" | NaturezaLancamento>("todas");

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFiltro !== "todas" && r.status !== statusFiltro) return false;
      if (naturezaFiltro !== "todas" && r.natureza !== naturezaFiltro) return false;
      if (!q) return true;
      return (
        r.descricao.toLowerCase().includes(q) ||
        (r.fornecedor_nome ?? "").toLowerCase().includes(q) ||
        (r.cliente_nome ?? "").toLowerCase().includes(q) ||
        (r.job_codigo ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, busca, statusFiltro, naturezaFiltro]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {STATUS_FILTROS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFiltro(f.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                statusFiltro === f.key
                  ? "border-california-red bg-california-red text-white"
                  : "border-border bg-white text-muted-foreground hover:border-california-red/50",
              )}
            >
              {f.label}
            </button>
          ))}
          <span className="mx-2 h-6 w-px bg-border" aria-hidden />
          {NATUREZA_FILTROS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setNaturezaFiltro(f.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                naturezaFiltro === f.key
                  ? "border-slate-700 bg-slate-700 text-white"
                  : "border-border bg-white text-muted-foreground hover:border-slate-500/50",
              )}
            >
              {f.label}
            </button>
          ))}
          <div className="relative ml-auto flex-1 min-w-[240px] max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por descrição, fornecedor, cliente ou job..."
              className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
            />
          </div>
        </div>
        <ContaAvulsaDrawer
          mode="criar"
          empresas={empresas}
          tipos={tipos}
          subtipos={subtipos}
          fornecedores={fornecedores}
          clientes={clientes}
          jobs={jobs}
          trigger={
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover"
            >
              <Plus className="h-4 w-4" />
              Nova conta avulsa
            </button>
          }
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "Nenhuma conta avulsa cadastrada ainda."
              : "Nenhuma conta corresponde aos filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Data Prevista</th>
                <th className="px-3 py-2 text-left">Descrição</th>
                <th className="px-3 py-2 text-left">Fornecedor/Cliente</th>
                <th className="px-3 py-2 text-left">Job</th>
                <th className="px-3 py-2 text-left">Empresa</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-center">Anexos</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 text-xs font-mono">{formatDate(r.data_prevista_pagamento)}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/financeiro/contas-a-pagar/avulsa/${r.id}`}
                      prefetch={false}
                      className="text-california-red hover:underline"
                    >
                      {r.descricao}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.fornecedor_nome ?? r.cliente_nome ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono">{r.job_codigo ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.empresa_nome}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="font-mono">{r.tipo_codigo}</span> · {r.subtipo_nome}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-mono text-xs font-semibold",
                      r.natureza === "entrada" ? "text-emerald-700" : "text-california-red",
                    )}
                  >
                    {formatMoney(r.valor)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                        statusBadge(r.status),
                      )}
                    >
                      {contaAvulsaStatusLabel(r.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {r.anexos_count > 0 ? r.anexos_count : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Modificar `page.tsx` — adicionar queries + substituir placeholder**

Abrir `app/(app)/financeiro/contas-a-pagar/page.tsx`.

Adicionar ao `Promise.all`:

```ts
// Contas avulsas (todos os status)
supabase
  .from("contas_avulsas")
  .select(`
    id, descricao, valor, natureza, data_prevista_pagamento, status,
    pago_em, created_at,
    fornecedor:fornecedores(nome, razao_social),
    cliente:clientes(nome_fantasia, razao_social),
    job:jobs(codigo),
    empresa:empresas(razao_social, nome_fantasia),
    tipo:plano_contas_tipos!inner(codigo),
    subtipo:plano_contas_subtipos!inner(nome),
    anexos:contas_avulsas_anexos(id)
  `)
  .eq("tenant_id", session.activeTenant.id)
  .order("data_prevista_pagamento", { ascending: true, nullsFirst: false })
  .order("created_at", { ascending: false }),

// Empresas ativas (pra dropdown do drawer)
supabase
  .from("empresas")
  .select("id, razao_social, nome_fantasia")
  .eq("tenant_id", session.activeTenant.id)
  .eq("ativo", true)
  .order("razao_social"),

// Fornecedores ativos (pra dropdown)
supabase
  .from("fornecedores")
  .select("id, nome, razao_social")
  .eq("tenant_id", session.activeTenant.id)
  .eq("status", "ativo")
  .order("nome"),

// Clientes ativos
supabase
  .from("clientes")
  .select("id, nome_fantasia, razao_social")
  .eq("tenant_id", session.activeTenant.id)
  .eq("status", "ativo")
  .order("nome_fantasia"),

// Jobs (não cancelados) — busca simples pelo primeiro N; se lista ficar grande, no futuro trocar por combobox server-side
supabase
  .from("jobs")
  .select("id, codigo, nome")
  .eq("tenant_id", session.activeTenant.id)
  .neq("status", "cancelado")
  .order("created_at", { ascending: false })
  .limit(500),
```

Mapear as rows de avulsas pra `AvulsaRow[]`:

```ts
const avulsasRows: AvulsaRow[] = (avulsasRes.data ?? []).map((r: any) => ({
  id: r.id,
  descricao: r.descricao,
  valor: Number(r.valor),
  natureza: r.natureza,
  data_prevista_pagamento: r.data_prevista_pagamento,
  status: r.status,
  fornecedor_nome: r.fornecedor?.razao_social ?? r.fornecedor?.nome ?? null,
  cliente_nome: r.cliente?.razao_social ?? r.cliente?.nome_fantasia ?? null,
  job_codigo: r.job?.codigo ?? null,
  empresa_nome: r.empresa?.razao_social ?? r.empresa?.nome_fantasia ?? "",
  tipo_codigo: r.tipo?.codigo ?? "",
  subtipo_nome: r.subtipo?.nome ?? "",
  anexos_count: r.anexos?.length ?? 0,
  pago_em: r.pago_em,
  created_at: r.created_at,
}));

const empresasList = (empresasRes.data ?? []).map((e: any) => ({
  id: e.id,
  nome: e.razao_social ?? e.nome_fantasia,
}));
const fornecedoresList = (fornecedoresRes.data ?? []).map((f: any) => ({
  id: f.id,
  nome: f.razao_social ?? f.nome,
}));
const clientesList = (clientesRes.data ?? []).map((c: any) => ({
  id: c.id,
  nome: c.razao_social ?? c.nome_fantasia,
}));
const jobsList = (jobsRes.data ?? []).map((j: any) => ({
  id: j.id,
  codigo: j.codigo,
  nome: j.nome,
}));
```

Substituir o placeholder por:

```tsx
avulsas={
  <ContasAvulsasList
    rows={avulsasRows}
    empresas={empresasList}
    tipos={tiposRes.data ?? []}
    subtipos={subtiposRes.data ?? []}
    fornecedores={fornecedoresList}
    clientes={clientesList}
    jobs={jobsList}
  />
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 4: Teste manual descritivo**

Descrever no report:
1. Ir em `/financeiro/contas-a-pagar` → aba "Lançamentos Avulsos" clicável.
2. Botão "Nova conta avulsa" abre drawer.
3. Preencher: empresa California, descrição "Aluguel outubro", valor 3000, natureza Saída, tipo CF, subtipo (cadastrar antes se necessário).
4. Confirmar. Conta aparece na tabela com status "Pendente".
5. Filtros de status e natureza funcionam.
6. Busca funciona.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/avulsas-list.tsx app/\(app\)/financeiro/contas-a-pagar/page.tsx
git commit -m "task012: lista de contas avulsas na aba + integracao com page"
```

---

## Task 9: Página de detalhes `/avulsa/[id]` + modais de baixa/estorno + histórico

**Files:**
- Create: `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/page.tsx`
- Create: `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/baixar-avulsa-modal.tsx`
- Create: `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/cancelar-baixa-avulsa-modal.tsx`
- Create: `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/historico-mudancas.tsx`

**Interfaces:**
- Consumes: types + actions da Task 7.
- Produces:
  - Rota `/financeiro/contas-a-pagar/avulsa/[id]` funcional.
  - Modais reusando padrão dos existentes em `<BaixaPPModal>` e `<CancelarBaixaModal>` (adaptados).
  - Componente `<HistoricoMudancas>` renderizando `contas_avulsas_historico`.

---

- [ ] **Step 1: Criar `avulsa/[id]/page.tsx`**

Server component. Estrutura resumida (~200 linhas):

```tsx
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight, FileText, Paperclip, Download, Edit, Trash2, CreditCard, Ban } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import type { ContaAvulsa, ContaAvulsaAnexo, ContaAvulsaHistorico, ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import { contaAvulsaStatusLabel } from "@/lib/types";
import { ContaAvulsaDrawer } from "../../conta-avulsa-drawer";
import { BaixarAvulsaModal } from "./baixar-avulsa-modal";
import { CancelarBaixaAvulsaModal } from "./cancelar-baixa-avulsa-modal";
import { HistoricoMudancas } from "./historico-mudancas";

export const dynamic = "force-dynamic";

export default async function AvulsaDetalhesPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }
  const supabase = createClient();

  // Carrega conta com todos os embeds
  const { data: conta, error } = await supabase
    .from("contas_avulsas")
    .select(`
      *,
      empresa:empresas(razao_social, nome_fantasia),
      fornecedor:fornecedores(nome, razao_social),
      cliente:clientes(nome_fantasia, razao_social),
      job:jobs(codigo, nome),
      tipo:plano_contas_tipos(codigo, nome),
      subtipo:plano_contas_subtipos(nome),
      conta_bancaria:contas_bancarias!conta_bancaria_baixa_id(nome, banco),
      pago_por_profile:profiles!pago_por(nome)
    `)
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (error || !conta) notFound();

  // Anexos + histórico + listas auxiliares (pra modais/drawer)
  const [anexosRes, historicoRes, contasRes, empresasRes, tiposRes, subtiposRes, fornecedoresRes, clientesRes, jobsRes] =
    await Promise.all([
      supabase.from("contas_avulsas_anexos").select("*").eq("conta_avulsa_id", params.id),
      supabase.from("contas_avulsas_historico")
        .select("*, alterado_por_profile:profiles!alterado_por(nome)")
        .eq("conta_avulsa_id", params.id).order("alterado_em", { ascending: false }),
      supabase.from("contas_bancarias").select("*")
        .eq("tenant_id", session.activeTenant.id).eq("empresa_id", (conta as any).empresa_id).eq("ativo", true),
      supabase.from("empresas").select("id, razao_social, nome_fantasia")
        .eq("tenant_id", session.activeTenant.id).eq("ativo", true),
      supabase.from("plano_contas_tipos").select("*")
        .eq("tenant_id", session.activeTenant.id).eq("ativo", true).order("ordem"),
      supabase.from("plano_contas_subtipos").select("*")
        .eq("tenant_id", session.activeTenant.id).eq("ativo", true).order("nome"),
      supabase.from("fornecedores").select("id, nome, razao_social")
        .eq("tenant_id", session.activeTenant.id).eq("status", "ativo").order("nome"),
      supabase.from("clientes").select("id, nome_fantasia, razao_social")
        .eq("tenant_id", session.activeTenant.id).eq("status", "ativo").order("nome_fantasia"),
      supabase.from("jobs").select("id, codigo, nome")
        .eq("tenant_id", session.activeTenant.id).neq("status", "cancelado")
        .order("created_at", { ascending: false }).limit(500),
    ]);

  const c = conta as any;
  const empresas = (empresasRes.data ?? []).map((e: any) => ({ id: e.id, nome: e.razao_social ?? e.nome_fantasia }));
  const fornecedores = (fornecedoresRes.data ?? []).map((f: any) => ({ id: f.id, nome: f.razao_social ?? f.nome }));
  const clientes = (clientesRes.data ?? []).map((cl: any) => ({ id: cl.id, nome: cl.razao_social ?? cl.nome_fantasia }));
  const jobs = jobsRes.data ?? [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/financeiro" className="hover:text-california-red">Financeiro</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href="/financeiro/contas-a-pagar" className="hover:text-california-red">Contas a Pagar</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">{c.descricao.slice(0, 60)}{c.descricao.length > 60 ? "..." : ""}</span>
        </nav>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <FileText className="h-5 w-5 text-california-red" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{c.descricao}</h1>
              <span
                className={
                  c.status === "pendente"
                    ? "inline-flex items-center rounded-full border border-[#fde68a] bg-[#fffbeb] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#92400e]"
                    : "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700"
                }
              >
                {contaAvulsaStatusLabel(c.status)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {c.status === "pendente" && (
              <>
                <ContaAvulsaDrawer
                  mode="editar"
                  conta={c as ContaAvulsa}
                  empresas={empresas}
                  tipos={tiposRes.data ?? []}
                  subtipos={subtiposRes.data ?? []}
                  fornecedores={fornecedores}
                  clientes={clientes}
                  jobs={jobs}
                />
                {/* Botões [Excluir] e [Dar baixa] renderizam client-side dentro do modal wrapper */}
                <BaixarAvulsaModalTrigger contaId={c.id} contas={contasRes.data ?? []} descricao={c.descricao} valor={Number(c.valor)} />
                <ExcluirAvulsaButton contaId={c.id} descricao={c.descricao} />
              </>
            )}
            {c.status === "baixada" && (
              <CancelarBaixaAvulsaModalTrigger contaId={c.id} descricao={c.descricao} />
            )}
          </div>
        </div>
      </header>

      {/* Card Metadata */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Detalhes</h2>
        <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-semibold">{formatCurrency(Number(c.valor), "BRL")} · {c.natureza === "entrada" ? "Entrada" : "Saída"}</span>
          <span className="text-muted-foreground">Empresa</span>
          <span>{c.empresa?.razao_social ?? c.empresa?.nome_fantasia}</span>
          <span className="text-muted-foreground">Data prevista de pagamento</span>
          <span>{c.data_prevista_pagamento ? formatDate(c.data_prevista_pagamento) : "—"}</span>
          <span className="text-muted-foreground">Fornecedor</span>
          <span>{c.fornecedor?.razao_social ?? c.fornecedor?.nome ?? "—"}</span>
          <span className="text-muted-foreground">Cliente</span>
          <span>{c.cliente?.razao_social ?? c.cliente?.nome_fantasia ?? "—"}</span>
          <span className="text-muted-foreground">Job</span>
          <span>{c.job ? `${c.job.codigo} · ${c.job.nome}` : "—"}</span>
          <span className="text-muted-foreground">Plano de contas</span>
          <span><span className="font-mono">{c.tipo?.codigo}</span> · {c.subtipo?.nome}</span>
        </div>
      </div>

      {/* Card Baixa (só se baixada) */}
      {c.status === "baixada" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase text-emerald-700">Baixa registrada</h2>
          <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <span className="text-muted-foreground">Pago em</span>
            <span>{formatDate(c.pago_em)}</span>
            <span className="text-muted-foreground">Por</span>
            <span>{c.pago_por_profile?.nome ?? "—"}</span>
            <span className="text-muted-foreground">Conta bancária</span>
            <span>{c.conta_bancaria?.nome ?? "—"} ({c.conta_bancaria?.banco ?? "—"})</span>
          </div>
        </div>
      )}

      {/* Card Anexos */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
          <Paperclip className="mr-1.5 inline-block h-4 w-4" />
          Anexos ({(anexosRes.data ?? []).length})
        </h2>
        {anexosRes.data && anexosRes.data.length > 0 ? (
          <ul className="space-y-1">
            {(anexosRes.data as ContaAvulsaAnexo[]).map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded border border-border bg-white p-2 text-xs">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{a.arquivo_nome_original}</span>
                <span className="text-muted-foreground">{(a.arquivo_tamanho_bytes / 1024).toFixed(0)} KB</span>
                <BaixarAnexoButton anexoId={a.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Sem anexos.</p>
        )}
      </div>

      {/* Card Histórico */}
      <HistoricoMudancas historico={(historicoRes.data ?? []) as any} />
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// --- Wrappers client-only pros botões que abrem modais ---
// (Podem ficar inline ou em file separado se preferir organização)

function BaixarAvulsaModalTrigger(props: { contaId: string; contas: ContaBancaria[]; descricao: string; valor: number }) {
  // Este wrapper precisa ser client — extrair pra ficheiro próprio ou marcar "use client" no topo do file.
  // Pra simplicidade, criar mini-wrapper inline com "use client" no arquivo dele.
  return <BaixarAvulsaModalClient {...props} />;
}
// Idem para CancelarBaixaAvulsaModalTrigger, ExcluirAvulsaButton, BaixarAnexoButton.
```

**Nota:** o server component acima chama wrappers client — na prática, extrair cada wrapper pra seu próprio file `use client` (ou consolidar em um `client-actions.tsx` da mesma pasta). O implementador escolhe organização — princípio: server component monta layout + carrega dados, client wrappers cuidam de interatividade dos modais.

- [ ] **Step 2: Criar `baixar-avulsa-modal.tsx`**

Client component com Dialog centrado. Copiar padrão de `<BaixaPPModal>` (em `contas-a-pagar/baixa-pp-modal.tsx`) adaptando:

- Sem seleção de tipo/subtipo (já vem da própria conta avulsa).
- Só 2 campos: **Data do pagamento** (DatePicker, default hoje) + **Conta bancária** (Select filtrado pelo backend, `contas: ContaBancaria[]` já filtradas por empresa).
- Chama `darBaixaAvulsa({ conta_avulsa_id, pago_em, conta_bancaria_id })` da Task 7.
- Botão "Confirmar baixa" verde emerald.

- [ ] **Step 3: Criar `cancelar-baixa-avulsa-modal.tsx`**

Copiar padrão de `<CancelarBaixaModal>`. Textarea de motivo (10-500 chars), botão vermelho "Confirmar estorno". Chama `estornarBaixaAvulsa({ conta_avulsa_id, motivo })`.

- [ ] **Step 4: Criar `historico-mudancas.tsx`**

```tsx
"use client";

import type { ContaAvulsaHistorico } from "@/lib/types";

interface Row extends ContaAvulsaHistorico {
  alterado_por_profile: { nome: string } | null;
}

// Rótulos em pt-BR pra os campos armazenados como snake_case.
const LABEL_CAMPO: Record<string, string> = {
  descricao: "Descrição",
  valor: "Valor",
  natureza: "Natureza",
  data_prevista_pagamento: "Data prevista de pagamento",
  fornecedor_id: "Fornecedor",
  cliente_id: "Cliente",
  job_id: "Job",
  plano_conta_tipo_id: "Tipo de plano de contas",
  plano_conta_subtipo_id: "Subtipo de plano de contas",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function renderValor(campo: string, v: string | null): string {
  if (v == null || v === "") return "—";
  if (campo === "valor") return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (campo === "natureza") return v === "entrada" ? "Entrada" : "Saída";
  // FKs mostram só o id truncado. Pra melhorar UX, resolver o nome exigiria mais joins;
  // fora de escopo neste ciclo — mostra o id pra rastreabilidade.
  if (campo.endsWith("_id")) return v.slice(0, 8) + "...";
  return v;
}

export function HistoricoMudancas({ historico }: { historico: Row[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
        Histórico de mudanças
      </h2>
      {historico.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem alterações registradas.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Data/Hora</th>
                <th className="px-3 py-2 text-left">Usuário</th>
                <th className="px-3 py-2 text-left">Campo</th>
                <th className="px-3 py-2 text-left">Valor anterior</th>
                <th className="px-3 py-2 text-left">Valor novo</th>
              </tr>
            </thead>
            <tbody>
              {historico.map((h) => (
                <tr key={h.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{formatDateTime(h.alterado_em)}</td>
                  <td className="px-3 py-2">{h.alterado_por_profile?.nome ?? "—"}</td>
                  <td className="px-3 py-2 font-semibold">{LABEL_CAMPO[h.campo_alterado] ?? h.campo_alterado}</td>
                  <td className="px-3 py-2 text-muted-foreground">{renderValor(h.campo_alterado, h.valor_anterior)}</td>
                  <td className="px-3 py-2">{renderValor(h.campo_alterado, h.valor_novo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Extrair wrappers client dos modais + botões**

Criar `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/acoes-client.tsx` com todos os componentes client que a `page.tsx` (server) importa: `BaixarAvulsaModalClient`, `CancelarBaixaAvulsaModalClient`, `ExcluirAvulsaButton`, `BaixarAnexoButton`. Cada um usa `useRouter` + chama a action correspondente.

Exemplo `ExcluirAvulsaButton`:

```tsx
"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { excluirContaAvulsa } from "../../actions-avulsas";

export function ExcluirAvulsaButton({ contaId, descricao }: { contaId: string; descricao: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await excluirContaAvulsa(contaId);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setOpen(false);
      router.push("/financeiro/contas-a-pagar");
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-white px-3 py-2 text-xs font-semibold text-california-red hover:bg-california-red hover:text-white"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Excluir
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Excluir conta avulsa?"
        description={`"${descricao}" será removida definitivamente junto com seus anexos e histórico.`}
        confirmLabel="Excluir"
        variant="destructive"
        onConfirm={handleConfirm}
        pending={pending}
      />
    </>
  );
}
```

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 7: Teste manual descritivo**

Descrever no report:
1. Da lista, clicar em uma conta pendente → abre `/avulsa/[id]`.
2. Card de detalhes mostra tudo. Sem card de baixa (é pendente).
3. Editar via drawer → alterar valor de 3000 pra 3100 → salvar.
4. Ver que histórico ganhou row "Valor: R$ 3.000,00 → R$ 3.100,00".
5. Dar baixa → escolher conta bancária + data → confirmar.
6. Página atualiza. Botões mudam. Card "Baixa registrada" aparece.
7. Cancelar baixa com motivo → volta pra pendente.

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/avulsa
git commit -m "task012: pagina de detalhes + baixa/estorno + historico exposto"
```

---

## Task 10: Ajuste em `conciliacao-list.tsx` — badge "Avulsa"

**Files:**
- Modify: `app/(app)/financeiro/conciliacao/conciliacao-list.tsx`

**Interfaces:**
- Consumes: `LancamentoLinha` (já tem campo `origem`).
- Produces: badge visual "Avulsa" pra `origem` iniciada em `avulsa_*` na tabela de extrato.

---

- [ ] **Step 1: Modificar `conciliacao-list.tsx`**

Localizar a coluna de descrição. Adicionar badge condicional:

```tsx
// Ao renderizar cada linha, na coluna Descrição:
<td className={cn("px-3 py-2", l.origem === "pp_baixa_estornada" || l.origem === "avulsa_baixa_estornada" ? "line-through text-muted-foreground" : "")}>
  {l.origem.startsWith("pp_") && (
    <span className="mr-2 inline-flex items-center rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-blue-700">PP</span>
  )}
  {l.origem.startsWith("avulsa_") && (
    <span className="mr-2 inline-flex items-center rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-700">Avulsa</span>
  )}
  {l.descricao}
</td>
```

Adaptar exatamente pra estrutura atual do component — o snippet acima é referência.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 3: Teste manual descritivo**

1. Baixar uma conta avulsa (Task 9 funcional).
2. Ir na conciliação, filtrar pela conta bancária escolhida.
3. Ver linha com badge "Avulsa" antes da descrição.
4. Baixar uma PP → badge "PP".
5. Estornar avulsa → linha original com strikethrough (via `line-through` no `avulsa_baixa_estornada`) + nova linha reversa com badge "Avulsa" e valor de sinal contrário.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/financeiro/conciliacao/conciliacao-list.tsx
git commit -m "task012: badge Avulsa + strikethrough em avulsa_baixa_estornada na conciliacao"
```

---

## Self-Review

**1. Spec coverage:**

- Seção 3 (decisões) — cobertas por Tasks 1-4 (modelagem), Task 7 (edição bloqueia empresa), Task 9 (histórico exposto), Task 7+9 (rules de estorno/exclusão). ✅
- Seção 4 (modelagem) — Tasks 1, 3, 4. ✅
- Seção 5 (regras) — Task 7 (server actions), Task 4 (RPCs). ✅
- Seção 6 (actions + RPCs) — Tasks 4, 7. ✅
- Seção 7 (UI) — Task 5 (rename), Task 6 (tabs), Task 7 (drawer), Task 8 (list), Task 9 (detalhes + modais + histórico), Task 10 (badge conciliação). ✅
- Seção 8 (RLS + audit) — Tasks 1, 7. ✅
- Seção 9 (storage) — Task 1 (bucket). Fluxo upload em 2 fases mencionado no Task 7 Step 3. ✅
- Seção 10 (migrations) — Tasks 1-4. Split obrigatório entre 2 e 3 documentado no header. ✅

**2. Placeholder scan:** revisei — nenhum "TBD", "TODO", "implement later" no plano. Descrições de componentes visuais complexos (drawer, page) apontam pro padrão a espelhar (`<ContaBancariaDrawer>`, `<BaixaPPModal>`) em vez de repetir código.

**3. Type consistency:**
- `ContaAvulsa`, `ContaAvulsaAnexo`, `ContaAvulsaHistorico`, `ContaAvulsaStatus` — definidos na Task 1, usados nas 7, 8, 9. Sinônimos batem.
- `criarContaAvulsa`, `editarContaAvulsa`, `excluirContaAvulsa`, `darBaixaAvulsa`, `estornarBaixaAvulsa`, `signedUrlAnexoAvulsa` — assinaturas definidas na Task 7, chamadas em 8 e 9 com mesmos nomes/tipos.
- RPCs `dar_baixa_avulsa(uuid, date, uuid)` e `estornar_baixa_avulsa(uuid, text)` — assinaturas na Task 4, chamadas na Task 7 com mesmos nomes de parâmetro `p_...`.
- `AvulsaRow` (Task 8) e mapeamento na page (Task 8 Step 2) usam mesmos campos.
- Enum `origem_lancamento` values `avulsa_baixa`, `avulsa_baixa_estornada`, `avulsa_estorno` — definidos na Task 2, usados nas Tasks 3 (CHECKs), 4 (RPCs), 10 (badge).

Nenhuma inconsistência detectada.
