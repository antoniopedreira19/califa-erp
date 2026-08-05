# Lançamentos Financeiros — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir a tabela central `lancamentos_financeiros` alimentada pela baixa da PP, com auxiliares (`contas_bancarias`, `plano_contas_tipos`, `plano_contas_subtipos`), estorno reverso, e tela `/financeiro/conciliacao` com saldo derivado.

**Architecture:** 4 migrations Postgres (auxiliares + tabela central + RPCs transacionais); refactor de `marcarPagaFinanceiro` pra usar RPC + persistir lançamento; nova `estornarBaixaPP`; CRUDs padrão de `contas_bancarias` e plano de contas em `/cadastros`; tela de conciliação em `/financeiro`. RLS uniforme (`is_tenant_member`); gate de role (`admin | financeiro`) no server action, seguindo padrão da Central Financeira.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase (Postgres + Auth + RLS + Storage), Tailwind, shadcn/ui, Radix, lucide-react, React Hook Form + Zod.

## Global Constraints

Aplicam a **todas** as tasks. Copiados verbatim de `CLAUDE.md`, `docs/PERFORMANCE.md` e da spec (`docs/superpowers/specs/2026-08-05-lancamentos-financeiros-design.md`).

- **Performance é feature.** Leia `docs/PERFORMANCE.md` antes de tocar `app/(app)/**` ou `lib/supabase/**`.
- **Ortografia pt-BR em toda string visível ao usuário.** Labels, placeholders, botões, títulos, mensagens de erro/toast — sempre com acento, cedilha e til. Identificadores de código podem ficar sem acento por convenção.
- **RLS ≠ GRANT.** Toda migration que cria tabela termina com `grant select, insert, update on ... to authenticated`.
- **Toda tabela operacional tem `tenant_id`** com FK pra `tenants` e RLS via `is_tenant_member(tenant_id)`. Policies usam `(select auth.uid())`, não `auth.uid()` direto.
- **Sem policy `DELETE`.** Soft-delete via `ativo=false` ou status. Estorno é lançamento reverso.
- **Server action pattern:** `requireSession()` → parse Zod → verificar `tenant_id` → executar → `logAuditEvent` → `revalidatePath`.
- **`prefetch={false}` em `<Link>` de listas** (5+ itens navegáveis).
- **`force-dynamic` continua** nas pages autenticadas.
- **Radix `<SelectItem>` NUNCA aceita `value=""`** — usar sentinel `"__none__"` e traduzir pra `null` no submit.
- **`<DrawerContent>` não aceita prop `title`** — usar composition com `<DialogHeader><DialogTitle>...`.
- **DatePicker em drawer:** `side="bottom"` + `sideOffset={6}` + `collisionPadding={16}` + largura fixa + `<Calendar fixedWeeks>`.
- **Antes de commitar:** rodar `npx tsc --noEmit && npx next lint`. Se tocar em lib Node-only server-side (PDF, XLSX etc), rodar `rm -rf .next && npm run build` local.
- **Colunas numéricas do Postgres voltam como string do Supabase-js.** Sempre `Number(...)`.
- **Datas sem timezone (`date`) vão e voltam como `YYYY-MM-DD`.** Nunca `new Date(dbDate)` sem parse — desloca fuso.
- **Gate de role da fase financeira: `admin | financeiro`** (não só admin) em CRUD de contas_bancarias e plano_contas.
- **Trava do `codigo` do tipo:** editável enquanto não houver lançamento; após primeiro lançamento, imutável (enforcement em 3 camadas: server action, UI, trigger de banco).

---

## Estrutura de arquivos

### Migrations

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260805000001_contas_bancarias.sql` | CREATE TABLE + RLS + GRANT + trigger `set_updated_at` |
| `supabase/migrations/20260805000002_plano_contas.sql` | 2 tabelas + enum `natureza_padrao_tipo` + seed dos 15 tipos + RLS/GRANT |
| `supabase/migrations/20260805000003_lancamentos_financeiros.sql` | Tabela + enums + FK composta + unique parcial + RLS/GRANT + trigger `enforce_tipo_codigo_imutavel` |
| `supabase/migrations/20260805000004_baixa_pp_rpc.sql` | RPCs `dar_baixa_pp` e `estornar_baixa_pp` (transacionais) |

### Types e utilitários

| Arquivo | Ação |
|---|---|
| `lib/types.ts` | Adicionar tipos: `ContaBancaria`, `PlanoContaTipo`, `PlanoContaSubtipo`, `LancamentoFinanceiro`, `NaturezaLancamento`, `OrigemLancamento`, `NaturezaPadraoTipo` |
| `lib/auth/audit.ts` | Adicionar acções ao union `AuditAction` |
| `lib/validations/contas-bancarias.ts` | **Criar** — Zod schema |
| `lib/validations/plano-contas.ts` | **Criar** — Zod schema tipo + subtipo |
| `lib/calculos/saldo-conta.ts` | **Criar** — helper de saldo por período com âncora inicial |

### Cadastros

| Arquivo | Ação |
|---|---|
| `app/(app)/cadastros/contas-bancarias/{page,actions,contas-bancarias-list,conta-bancaria-drawer}.tsx` | **Criar** CRUD |
| `app/(app)/cadastros/plano-de-contas/{page,actions,tipos-list,tipo-drawer,subtipos-list,subtipo-drawer}.tsx` | **Criar** CRUD com 2 seções (tabs) |
| `app/(app)/cadastros/page.tsx` | Adicionar 2 cards (contas bancárias, plano de contas) |

### Fluxo de baixa da PP

| Arquivo | Ação |
|---|---|
| `app/(app)/financeiro/pedidos-compra/actions.ts` | Refactor `marcarPagaFinanceiro` (nova assinatura + RPC), adicionar `estornarBaixaPP` |
| `app/(app)/financeiro/pedidos-compra/baixa-pp-modal.tsx` | **Criar** (substitui `ConfirmDialog` da baixa) |
| `app/(app)/financeiro/pedidos-compra/cancelar-baixa-modal.tsx` | **Criar** |
| `app/(app)/financeiro/pedidos-compra/pp-drawer-financeiro.tsx` | Trocar `ConfirmDialog` da baixa por `<BaixaPPModal>`; adicionar botão "Cancelar baixa" quando `status='pago'` |
| `app/(app)/financeiro/pedidos-compra/pedidos-compra-list.tsx` | Consumir novas colunas se necessário |

### Tela de conciliação

| Arquivo | Ação |
|---|---|
| `app/(app)/financeiro/conciliacao/{page,conciliacao-list,filtros-conta}.tsx` | **Criar** |

### Navegação

| Arquivo | Ação |
|---|---|
| `components/sidebar.tsx` | Adicionar entrada "Conciliação" em `/financeiro`, com `roles: ['administrador','financeiro']` |
| `app/(app)/financeiro/page.tsx` | Adicionar card "Conciliação" |

---

## Task 1: Migration + types + audit — `contas_bancarias`

**Files:**
- Create: `supabase/migrations/20260805000001_contas_bancarias.sql`
- Modify: `lib/types.ts` (adicionar bloco)
- Modify: `lib/auth/audit.ts` (adicionar linhas ao union)

**Interfaces:**
- Consumes: `public.tenants(id)`, `public.empresas(id)`, `public.profiles(id)`, `public.is_tenant_member(uuid)`.
- Produces:
  - Tabela `public.contas_bancarias` com constraint `uniq_conta_id_empresa unique (id, empresa_id)` (esta unique é o que permite a FK composta da tabela `lancamentos_financeiros` mais tarde).
  - Enum implícito via CHECK: `tipo in ('corrente','poupanca','investimento','caixa')`.
  - Type `ContaBancaria` em `lib/types.ts`.
  - `AuditAction`: `conta_bancaria.criada` | `.atualizada` | `.inativada` | `.reativada`.

---

- [ ] **Step 1: Criar migration**

Arquivo `supabase/migrations/20260805000001_contas_bancarias.sql`:

```sql
-- =====================================================================
-- Task 011 — contas_bancarias (auxiliar de lancamentos_financeiros)
-- Ver spec: docs/superpowers/specs/2026-08-05-lancamentos-financeiros-design.md
-- =====================================================================

create table if not exists public.contas_bancarias (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete restrict,
  empresa_id          uuid not null references public.empresas(id) on delete restrict,
  nome                text not null,
  banco               text not null,
  agencia             text,
  numero_conta        text,
  tipo                text not null,
  saldo_inicial       numeric(14,2) not null default 0,
  saldo_inicial_data  date not null,
  ativo               boolean not null default true,
  ordem               integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chk_conta_nome_nao_vazio check (length(trim(nome)) > 0),
  constraint chk_conta_banco_nao_vazio check (length(trim(banco)) > 0),
  constraint chk_conta_tipo_valido
    check (tipo in ('corrente','poupanca','investimento','caixa')),
  constraint uniq_conta_id_empresa unique (id, empresa_id)
);

create index if not exists idx_contas_bancarias_tenant on public.contas_bancarias(tenant_id);
create index if not exists idx_contas_bancarias_empresa on public.contas_bancarias(empresa_id);
create index if not exists idx_contas_bancarias_ativo on public.contas_bancarias(tenant_id, ativo);

drop trigger if exists trg_contas_bancarias_updated_at on public.contas_bancarias;
create trigger trg_contas_bancarias_updated_at
  before update on public.contas_bancarias
  for each row execute function public.set_updated_at();

alter table public.contas_bancarias enable row level security;

drop policy if exists contas_bancarias_select on public.contas_bancarias;
create policy contas_bancarias_select on public.contas_bancarias
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists contas_bancarias_insert on public.contas_bancarias;
create policy contas_bancarias_insert on public.contas_bancarias
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists contas_bancarias_update on public.contas_bancarias;
create policy contas_bancarias_update on public.contas_bancarias
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.contas_bancarias to authenticated;
```

- [ ] **Step 2: Aplicar via MCP**

Chamar `mcp__supabase-write__apply_migration` com `name = "task011_contas_bancarias"` e `query` = conteúdo do arquivo.

Depois validar com `mcp__supabase__list_tables` filtrando por schema `public` e conferir que `contas_bancarias` aparece com todas as colunas listadas.

- [ ] **Step 3: Adicionar types em `lib/types.ts`**

Adicionar antes do último `export`:

```ts
export type TipoContaBancaria =
  | "corrente"
  | "poupanca"
  | "investimento"
  | "caixa";

export const tipoContaBancariaLabel = (t: TipoContaBancaria): string =>
  ({
    corrente: "Conta corrente",
    poupanca: "Poupança",
    investimento: "Investimento",
    caixa: "Caixa",
  })[t];

export interface ContaBancaria {
  id: string;
  tenant_id: string;
  empresa_id: string;
  nome: string;
  banco: string;
  agencia: string | null;
  numero_conta: string | null;
  tipo: TipoContaBancaria;
  saldo_inicial: string; // numeric vem como string do Supabase — parse com Number(...)
  saldo_inicial_data: string; // YYYY-MM-DD
  ativo: boolean;
  ordem: number;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Adicionar audit actions em `lib/auth/audit.ts`**

No union `AuditAction`, adicionar antes de `| "acao_negada"`:

```ts
  | "conta_bancaria.criada"
  | "conta_bancaria.atualizada"
  | "conta_bancaria.inativada"
  | "conta_bancaria.reativada"
```

- [ ] **Step 5: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: exit code 0, sem erros.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260805000001_contas_bancarias.sql lib/types.ts lib/auth/audit.ts
git commit -m "task011: schema contas_bancarias + types + audit"
```

---

## Task 2: CRUD `contas_bancarias`

**Files:**
- Create: `lib/validations/contas-bancarias.ts`
- Create: `app/(app)/cadastros/contas-bancarias/actions.ts`
- Create: `app/(app)/cadastros/contas-bancarias/page.tsx`
- Create: `app/(app)/cadastros/contas-bancarias/contas-bancarias-list.tsx`
- Create: `app/(app)/cadastros/contas-bancarias/conta-bancaria-drawer.tsx`
- Modify: `app/(app)/cadastros/page.tsx` (adicionar card + import icon)

**Interfaces:**
- Consumes: type `ContaBancaria`, table `public.contas_bancarias`, table `public.empresas`, session da Task 1.
- Produces: rotas `/cadastros/contas-bancarias` (lista + drawer). Server actions: `criarContaBancaria(fd)`, `editarContaBancaria(id, fd)`, `inativarContaBancaria(id)`, `reativarContaBancaria(id)`. Todas retornam `{ ok: true; id: string } | { ok: false; message: string; fieldErrors?: Record<string,string[]> }`.

---

- [ ] **Step 1: Criar Zod schema em `lib/validations/contas-bancarias.ts`**

```ts
import { z } from "zod";

export const contaBancariaSchema = z.object({
  empresa_id: z.string().uuid("Selecione a empresa."),
  nome: z.string().trim().min(2, "Nome muito curto.").max(120),
  banco: z.string().trim().min(2, "Banco muito curto.").max(80),
  agencia: z.string().trim().max(20).optional().or(z.literal("")),
  numero_conta: z.string().trim().max(30).optional().or(z.literal("")),
  tipo: z.enum(["corrente", "poupanca", "investimento", "caixa"]),
  saldo_inicial: z
    .string()
    .refine((v) => !Number.isNaN(Number(v)), "Saldo inicial inválido."),
  saldo_inicial_data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data em YYYY-MM-DD."),
  ordem: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? Number(v) : 0)),
});

export type ContaBancariaInput = z.infer<typeof contaBancariaSchema>;
```

- [ ] **Step 2: Criar `app/(app)/cadastros/contas-bancarias/actions.ts`**

Copiar padrão de `app/(app)/cadastros/regionais/actions.ts`, adaptando:

- **Gate de role em todas as 4 actions**: `admin | financeiro`. Se não for nenhum, retornar `{ ok: false, message: "Sem permissão." }` e logar `acao_negada` com `acao_tentada`.
- `criarContaBancaria(fd)`: Zod parse → INSERT com `tenant_id`, `empresa_id`, campos, `saldo_inicial: Number(parsed.saldo_inicial)`.
- `editarContaBancaria(id, fd)`: Zod parse → SELECT contagem `lancamentos_financeiros` com essa `conta_bancaria_id` (Task 5 ainda não criou a tabela, então protege com `try/catch` no primeiro deploy — se tabela não existe, `count = 0`). Se `count > 0`, **bloquear alteração** de `saldo_inicial` e `saldo_inicial_data` (retornar erro no fieldErrors se veio diferente do atual). Depois UPDATE.
- `inativarContaBancaria(id)`: UPDATE `ativo=false`. Antes, checar se há lançamento **nos últimos 90 dias** — se sim, retornar `{ ok: false, message: "Conta com movimento recente não pode ser inativada. Verifique com o financeiro." }`.
- `reativarContaBancaria(id)`: UPDATE `ativo=true`.
- Audit: `conta_bancaria.criada|.atualizada|.inativada|.reativada` com metadata `{ nome, banco, empresa_id }`.
- `revalidatePath("/cadastros/contas-bancarias")` e `revalidatePath("/cadastros")` em cada operação.

- [ ] **Step 3: Criar `page.tsx`**

Copiar padrão de `app/(app)/cadastros/regionais/page.tsx`, adaptando:

- Header: icon `Wallet` de `lucide-react`, título "Contas bancárias".
- Query: `select("*, empresas!inner(razao_social, nome_fantasia)").eq("tenant_id", session.activeTenant.id).order("ordem").order("nome")`.
- `canEdit = ['administrador','financeiro'].includes(session.activeRole)`.
- Query paralela pra listar empresas ativas do tenant (`select("id, razao_social, nome_fantasia").eq("tenant_id", session.activeTenant.id).eq("ativo", true)`), passar pra `<ContasBancariasList>` — o drawer usa como dropdown.

- [ ] **Step 4: Criar `contas-bancarias-list.tsx`**

Espelhar `regionais-list.tsx`. Colunas: `Nome`, `Banco`, `Ag/Conta`, `Empresa`, `Saldo inicial` (formatado com `formatCurrency`), `Data start` (formatado com helper local), `Status`, `Ações`. Busca por `nome`+`banco`. Filtro status. Ação inativar/reativar via `<ConfirmDialog>`.

- [ ] **Step 5: Criar `conta-bancaria-drawer.tsx`**

Espelhar `regional-drawer.tsx`, mas com form maior. Campos e ordem:

- Empresa* (`Select` de empresas ativas)
- Nome* (Input)
- Banco* (Input)
- Agência / Número da conta (2 inputs lado a lado)
- Tipo* (Select com `Corrente | Poupança | Investimento | Caixa`, valores `corrente|poupanca|investimento|caixa`)
- Saldo inicial* (Input `no-spinner`, type=number, step=0.01) — **desabilitar** se `mode === "editar"` e `hasLancamentos === true` (prop nova)
- Data do saldo inicial* (`<DatePicker>` — respeitando as regras do popover em drawer) — mesma desabilitação
- Ordem (Input numérico)

Import icon `Plus` no botão "Nova conta bancária".

- [ ] **Step 6: Adicionar card no hub `/cadastros`**

Em `app/(app)/cadastros/page.tsx`:

1. Import `Wallet` no `lucide-react`.
2. Adicionar `contasBancariasRes` no `Promise.all`:

```ts
supabase
  .from("contas_bancarias")
  .select("*", { count: "exact", head: true })
  .eq("tenant_id", session.activeTenant.id)
  .eq("ativo", true),
```

3. Adicionar `<CadastroCard>` na grid (após "Cidades"):

```tsx
<CadastroCard
  href="/cadastros/contas-bancarias"
  icon={Wallet}
  title="Contas bancárias"
  description="Contas onde os pagamentos entram e saem, com saldo inicial e empresa associada."
  count={contasBancariasRes.count ?? 0}
/>
```

- [ ] **Step 7: Rodar typecheck e lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 8: Teste manual mínimo**

1. `npm run dev`.
2. Ir em `/cadastros/contas-bancarias`.
3. Criar 1 conta bancária: nome "Santander CC 12345", banco "Santander", tipo corrente, empresa California, saldo inicial 10000, data start 2026-08-01.
4. Verificar que aparece na lista.
5. Editar o nome pra "Santander Corrente 12345" e salvar.
6. Inativar. Reativar.

- [ ] **Step 9: Commit**

```bash
git add lib/validations/contas-bancarias.ts app/\(app\)/cadastros/contas-bancarias app/\(app\)/cadastros/page.tsx
git commit -m "task011: CRUD de contas bancarias em /cadastros"
```

---

## Task 3: Migration + types + audit — plano de contas

**Files:**
- Create: `supabase/migrations/20260805000002_plano_contas.sql`
- Modify: `lib/types.ts`
- Modify: `lib/auth/audit.ts`

**Interfaces:**
- Consumes: `public.tenants(id)`, `public.is_tenant_member(uuid)`.
- Produces:
  - Enum `natureza_padrao_tipo` = `entrada | saida | ambos`.
  - Tabela `public.plano_contas_tipos` (com `codigo` unique per tenant, `natureza_padrao`, `ordem`, `ativo`).
  - Tabela `public.plano_contas_subtipos` (com `tipo_id` FK, `nome` unique per (tenant, tipo)).
  - Seed automático dos 15 tipos no tenant California.
  - Types `PlanoContaTipo`, `PlanoContaSubtipo`, `NaturezaPadraoTipo`.
  - Audit actions: `plano_conta_tipo.criado|.atualizado|.inativado|.reativado` + os 4 análogos pra `plano_conta_subtipo`.

---

- [ ] **Step 1: Criar migration**

Arquivo `supabase/migrations/20260805000002_plano_contas.sql`:

```sql
-- =====================================================================
-- Task 011 — plano de contas (tipos + subtipos)
-- Ver spec: docs/superpowers/specs/2026-08-05-lancamentos-financeiros-design.md
-- =====================================================================

-- 1) Enum
do $$ begin
  create type natureza_padrao_tipo as enum ('entrada', 'saida', 'ambos');
exception when duplicate_object then null;
end $$;

-- 2) Tipos
create table if not exists public.plano_contas_tipos (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  codigo            varchar(6) not null,
  nome              varchar(120) not null,
  natureza_padrao   natureza_padrao_tipo not null,
  ordem             integer not null default 0,
  ativo             boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_tipo_codigo_formato check (codigo ~ '^[A-Z]{2,6}$'),
  constraint chk_tipo_nome_nao_vazio check (length(trim(nome)) > 0),
  constraint uniq_tipo_codigo_por_tenant unique (tenant_id, codigo)
);

create index if not exists idx_tipos_tenant on public.plano_contas_tipos(tenant_id);
create index if not exists idx_tipos_ativo on public.plano_contas_tipos(tenant_id, ativo);

drop trigger if exists trg_tipos_updated_at on public.plano_contas_tipos;
create trigger trg_tipos_updated_at
  before update on public.plano_contas_tipos
  for each row execute function public.set_updated_at();

alter table public.plano_contas_tipos enable row level security;

drop policy if exists tipos_select on public.plano_contas_tipos;
create policy tipos_select on public.plano_contas_tipos
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists tipos_insert on public.plano_contas_tipos;
create policy tipos_insert on public.plano_contas_tipos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists tipos_update on public.plano_contas_tipos;
create policy tipos_update on public.plano_contas_tipos
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.plano_contas_tipos to authenticated;

-- 3) Subtipos
create table if not exists public.plano_contas_subtipos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  tipo_id       uuid not null references public.plano_contas_tipos(id) on delete restrict,
  nome          varchar(160) not null,
  ordem         integer not null default 0,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint chk_subtipo_nome_nao_vazio check (length(trim(nome)) > 0),
  constraint uniq_subtipo_nome_por_tipo unique (tenant_id, tipo_id, nome)
);

create index if not exists idx_subtipos_tenant on public.plano_contas_subtipos(tenant_id);
create index if not exists idx_subtipos_tipo on public.plano_contas_subtipos(tipo_id);
create index if not exists idx_subtipos_ativo on public.plano_contas_subtipos(tenant_id, ativo);

drop trigger if exists trg_subtipos_updated_at on public.plano_contas_subtipos;
create trigger trg_subtipos_updated_at
  before update on public.plano_contas_subtipos
  for each row execute function public.set_updated_at();

alter table public.plano_contas_subtipos enable row level security;

drop policy if exists subtipos_select on public.plano_contas_subtipos;
create policy subtipos_select on public.plano_contas_subtipos
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists subtipos_insert on public.plano_contas_subtipos;
create policy subtipos_insert on public.plano_contas_subtipos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists subtipos_update on public.plano_contas_subtipos;
create policy subtipos_update on public.plano_contas_subtipos
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.plano_contas_subtipos to authenticated;

-- 4) Seed dos 15 tipos no tenant California (idempotente)
do $$
declare
  v_tenant_id uuid;
begin
  select id into v_tenant_id
    from public.tenants
   order by created_at asc
   limit 1;

  if v_tenant_id is null then return; end if;

  insert into public.plano_contas_tipos (tenant_id, codigo, nome, natureza_padrao, ordem)
  values
    (v_tenant_id, 'REC',  'Receita',                'entrada', 10),
    (v_tenant_id, 'CO',   'Custo Operacional',      'saida',   20),
    (v_tenant_id, 'CT',   'Custo Tributário',       'saida',   30),
    (v_tenant_id, 'CF',   'Custo Fixo',             'saida',   40),
    (v_tenant_id, 'DP',   'Despesa com Pessoal',    'saida',   50),
    (v_tenant_id, 'DM',   'Despesa de Marketing',   'saida',   60),
    (v_tenant_id, 'DA',   'Despesa Administrativa', 'saida',   70),
    (v_tenant_id, 'DC',   'Despesa Comercial',      'saida',   80),
    (v_tenant_id, 'DT',   'Despesa Trabalhista',    'saida',   90),
    (v_tenant_id, 'RF',   'Receita Financeira',     'entrada', 100),
    (v_tenant_id, 'DJ',   'Despesa com Juros',      'saida',   110),
    (v_tenant_id, 'EMP',  'Empréstimos',            'ambos',   120),
    (v_tenant_id, 'IMOB', 'Imobilizado',            'saida',   130),
    (v_tenant_id, 'PL',   'Bonificação',            'saida',   140),
    (v_tenant_id, 'DL',   'Distribuição de Lucro',  'saida',   150)
  on conflict (tenant_id, codigo) do nothing;
end$$;
```

- [ ] **Step 2: Aplicar via MCP**

`mcp__supabase-write__apply_migration` com `name = "task011_plano_contas"`.

Validar com `mcp__supabase__execute_sql`:

```sql
select codigo, nome, natureza_padrao, ordem
from public.plano_contas_tipos
where tenant_id = (select id from public.tenants order by created_at limit 1)
order by ordem;
```

Expected: 15 rows exatamente na ordem da spec.

- [ ] **Step 3: Adicionar types em `lib/types.ts`**

```ts
export type NaturezaPadraoTipo = "entrada" | "saida" | "ambos";

export interface PlanoContaTipo {
  id: string;
  tenant_id: string;
  codigo: string;
  nome: string;
  natureza_padrao: NaturezaPadraoTipo;
  ordem: number;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanoContaSubtipo {
  id: string;
  tenant_id: string;
  tipo_id: string;
  nome: string;
  ordem: number;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Adicionar audit actions em `lib/auth/audit.ts`**

Antes de `| "acao_negada"`:

```ts
  | "plano_conta_tipo.criado"
  | "plano_conta_tipo.atualizado"
  | "plano_conta_tipo.inativado"
  | "plano_conta_tipo.reativado"
  | "plano_conta_subtipo.criado"
  | "plano_conta_subtipo.atualizado"
  | "plano_conta_subtipo.inativado"
  | "plano_conta_subtipo.reativado"
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260805000002_plano_contas.sql lib/types.ts lib/auth/audit.ts
git commit -m "task011: schema plano de contas + seed dos 15 tipos"
```

---

## Task 4: CRUD `plano_contas` (tipos + subtipos)

**Files:**
- Create: `lib/validations/plano-contas.ts`
- Create: `app/(app)/cadastros/plano-de-contas/actions.ts`
- Create: `app/(app)/cadastros/plano-de-contas/page.tsx`
- Create: `app/(app)/cadastros/plano-de-contas/tipos-list.tsx`
- Create: `app/(app)/cadastros/plano-de-contas/tipo-drawer.tsx`
- Create: `app/(app)/cadastros/plano-de-contas/subtipos-list.tsx`
- Create: `app/(app)/cadastros/plano-de-contas/subtipo-drawer.tsx`
- Modify: `app/(app)/cadastros/page.tsx`

**Interfaces:**
- Consumes: types `PlanoContaTipo`, `PlanoContaSubtipo`, `NaturezaPadraoTipo`.
- Produces: rota `/cadastros/plano-de-contas` com 2 seções (Tipos e Subtipos). Server actions:
  - Tipo: `criarTipo(fd)`, `atualizarTipo(id, fd)`, `inativarTipo(id)`, `reativarTipo(id)`.
  - Subtipo: `criarSubtipo(fd)`, `atualizarSubtipo(id, fd)`, `inativarSubtipo(id)`, `reativarSubtipo(id)`.
- **Regra especial de `atualizarTipo`:** se input tenta trocar `codigo` E existe pelo menos 1 lançamento com esse `tipo_id`, retornar fieldError em `codigo`: `"Código já foi usado em lançamento e não pode ser alterado. Crie um tipo novo e inative este."`. Nesta task a validação é preventiva; a trigger de banco entra na Task 5.

---

- [ ] **Step 1: Zod schemas em `lib/validations/plano-contas.ts`**

```ts
import { z } from "zod";

export const tipoSchema = z.object({
  codigo: z
    .string()
    .trim()
    .regex(/^[A-Z]{2,6}$/, "Código: 2 a 6 letras maiúsculas."),
  nome: z.string().trim().min(2, "Nome muito curto.").max(120),
  natureza_padrao: z.enum(["entrada", "saida", "ambos"]),
  ordem: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? Number(v) : 0)),
});

export const subtipoSchema = z.object({
  tipo_id: z.string().uuid("Selecione o tipo."),
  nome: z.string().trim().min(2, "Nome muito curto.").max(160),
  ordem: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? Number(v) : 0)),
});

export type TipoInput = z.infer<typeof tipoSchema>;
export type SubtipoInput = z.infer<typeof subtipoSchema>;
```

- [ ] **Step 2: Server actions em `plano-de-contas/actions.ts`**

Padrão idêntico a `regionais/actions.ts`. Gates: `admin | financeiro`. Actions completas: `criarTipo, atualizarTipo, inativarTipo, reativarTipo, criarSubtipo, atualizarSubtipo, inativarSubtipo, reativarSubtipo`.

**Bloqueio de `codigo` em `atualizarTipo`:**

```ts
// Antes do UPDATE:
const parsed = tipoSchema.safeParse({ ... });
if (!parsed.success) { ... }

// Buscar tipo atual pra comparar codigo
const { data: atual } = await supabase
  .from("plano_contas_tipos")
  .select("codigo")
  .eq("id", id)
  .eq("tenant_id", session.activeTenant.id)
  .single();

if (!atual) return { ok: false, message: "Tipo não encontrado." };

if (atual.codigo !== parsed.data.codigo) {
  // Só permite mudar se ninguém usou ainda.
  const { count } = await supabase
    .from("lancamentos_financeiros")
    .select("*", { count: "exact", head: true })
    .eq("plano_conta_tipo_id", id);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: "Não é possível alterar o código.",
      fieldErrors: {
        codigo: [
          "Código já foi usado em lançamento e não pode ser alterado. Crie um tipo novo e inative este.",
        ],
      },
    };
  }
}
// UPDATE prossegue...
```

**Bloqueios de `inativarTipo`:**
- Se existe subtipo `ativo=true` com esse `tipo_id`, bloquear: `"Existem subtipos ativos ligados a este tipo. Inative-os primeiro."`.
- Se existe lançamento nos últimos 90 dias com esse `tipo_id`, bloquear: `"Este tipo tem lançamento nos últimos 90 dias. Não pode ser inativado."`.

**Bloqueios de `inativarSubtipo`:** análogo — lançamento nos últimos 90 dias com esse `subtipo_id`.

Todas as actions logam audit com metadata `{ codigo, nome }`.

Nota: `lancamentos_financeiros` só existe após Task 5. Aqui usar SELECT com `.select(...)` puro; se a tabela ainda não existir (não deve, mas por defensividade), Supabase retorna erro e a action falha graciosamente. Aceitar isso — as tasks são executadas em ordem.

- [ ] **Step 3: `page.tsx`**

Estrutura:

```tsx
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import { TiposList } from "./tipos-list";
import { SubtiposList } from "./subtipos-list";
import Link from "next/link";
import { ChevronRight, ListTree } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await requireSession();
  const supabase = createClient();

  const [tiposRes, subtiposRes, lancamentosPorTipoRes] = await Promise.all([
    supabase.from("plano_contas_tipos").select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem").order("nome")
      .returns<PlanoContaTipo[]>(),
    supabase.from("plano_contas_subtipos").select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem").order("nome")
      .returns<PlanoContaSubtipo[]>(),
    // Agregação: quais tipos já têm lançamento (para desabilitar edição de codigo).
    supabase.from("lancamentos_financeiros")
      .select("plano_conta_tipo_id")
      .eq("tenant_id", session.activeTenant.id),
  ]);

  const tipos = tiposRes.data ?? [];
  const subtipos = subtiposRes.data ?? [];
  const tiposComLancamento = new Set(
    (lancamentosPorTipoRes.data ?? []).map((r: any) => r.plano_conta_tipo_id)
  );

  const canEdit =
    session.activeRole === "administrador" ||
    session.activeRole === "financeiro";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <nav className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Link href="/cadastros" className="hover:text-foreground">Cadastros</Link>
          <ChevronRight className="h-3 w-3" />
          <span>Plano de contas</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <ListTree className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Plano de contas</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Tipos e subtipos usados pra classificar cada lançamento. Base do DRE.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Tipos</h2>
        <TiposList
          tipos={tipos}
          tiposComLancamento={Array.from(tiposComLancamento)}
          canEdit={canEdit}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Subtipos</h2>
        <SubtiposList
          subtipos={subtipos}
          tipos={tipos}
          canEdit={canEdit}
        />
      </section>
    </div>
  );
}
```

Nota: se `lancamentos_financeiros` ainda não existir (deploy antes da Task 5 chegar em prod, por ex.), `lancamentosPorTipoRes.data` fica vazio, `Set` vazio, tudo permanece editável. Comportamento aceitável.

- [ ] **Step 4: `tipos-list.tsx`**

Espelhar `regionais-list.tsx`. Colunas: `Código` (fonte mono), `Nome`, `Natureza padrão` (chip: verde `Entrada`, vermelho `Saída`, cinza `Ambos`), `Ordem`, `Status`, `Ações`.

Prop: `tiposComLancamento: string[]` (ids). Ao clicar numa linha, passa `codigoBloqueado = tiposComLancamento.includes(tipo.id)` pro drawer.

- [ ] **Step 5: `tipo-drawer.tsx`**

Campos: `Código` (Input maxLength=6, uppercase, **disabled se `codigoBloqueado`** com hint text: "Código travado — já existe lançamento com este tipo."), `Nome`, `Natureza padrão` (Select), `Ordem`.

- [ ] **Step 6: `subtipos-list.tsx`**

Colunas: `Tipo` (chip mono com `codigo`), `Nome`, `Ordem`, `Status`, `Ações`. Filtro por tipo no topo (Select).

- [ ] **Step 7: `subtipo-drawer.tsx`**

Campos: `Tipo` (Select de tipos ativos), `Nome`, `Ordem`. Dropdown mostra `{codigo} · {nome}`.

- [ ] **Step 8: Card no hub `/cadastros`**

Em `app/(app)/cadastros/page.tsx`:

1. Import `ListTree` do `lucide-react`.
2. Adicionar `tiposRes` no `Promise.all`:

```ts
supabase
  .from("plano_contas_tipos")
  .select("*", { count: "exact", head: true })
  .eq("tenant_id", session.activeTenant.id)
  .eq("ativo", true),
```

3. Adicionar `<CadastroCard>`:

```tsx
<CadastroCard
  href="/cadastros/plano-de-contas"
  icon={ListTree}
  title="Plano de contas"
  description="Tipos e subtipos usados pra classificar cada lançamento financeiro. Base do DRE."
  count={tiposRes.count ?? 0}
/>
```

- [ ] **Step 9: Typecheck + lint + teste manual**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

Teste manual (`npm run dev`):
1. `/cadastros/plano-de-contas` — vejo os 15 tipos do seed.
2. Adicionar 1 subtipo em DP (ex: "Salário").
3. Editar tipo `DP` mudando só o `nome` — deve funcionar.
4. Tentar trocar `codigo` de `DP` pra `DPES` — como não há lançamento ainda (Task 5 não rodou), deve funcionar. Reverter.

- [ ] **Step 10: Commit**

```bash
git add lib/validations/plano-contas.ts app/\(app\)/cadastros/plano-de-contas app/\(app\)/cadastros/page.tsx
git commit -m "task011: CRUD plano de contas (tipos + subtipos)"
```

---

## Task 5: Migration `lancamentos_financeiros` + trigger de imutabilidade

**Files:**
- Create: `supabase/migrations/20260805000003_lancamentos_financeiros.sql`
- Modify: `lib/types.ts`
- Modify: `lib/auth/audit.ts`

**Interfaces:**
- Consumes: `public.contas_bancarias(id, empresa_id)` (Task 1), `public.plano_contas_tipos(id)` e `public.plano_contas_subtipos(id)` (Task 3), `public.fornecedores`, `public.clientes`, `public.jobs`, `public.pedidos_compra`, `public.profiles`, `public.empresas`.
- Produces:
  - Enums `natureza_lancamento` (`entrada|saida`), `origem_lancamento` (`pp_baixa|pp_baixa_estornada|pp_estorno|manual`).
  - Tabela `public.lancamentos_financeiros` com todos os campos da spec seção 4.4.
  - FK composta `(conta_bancaria_id, empresa_id) references contas_bancarias(id, empresa_id)`.
  - Unique parcial `uniq_baixa_ativa_por_pp` where `origem='pp_baixa'`.
  - Trigger `enforce_tipo_codigo_imutavel` em `plano_contas_tipos` (função + trigger).
  - Types: `LancamentoFinanceiro`, `NaturezaLancamento`, `OrigemLancamento`.
  - Audit actions: `lancamento_financeiro.criado|.estornado`, `pedido_compra.baixa_estornada`.

---

- [ ] **Step 1: Criar migration**

Arquivo `supabase/migrations/20260805000003_lancamentos_financeiros.sql`:

```sql
-- =====================================================================
-- Task 011 — lancamentos_financeiros (hub central)
-- Ver spec: docs/superpowers/specs/2026-08-05-lancamentos-financeiros-design.md
-- =====================================================================

-- 1) Enums
do $$ begin
  create type natureza_lancamento as enum ('entrada', 'saida');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type origem_lancamento as enum
    ('pp_baixa', 'pp_baixa_estornada', 'pp_estorno', 'manual');
exception when duplicate_object then null;
end $$;

-- 2) Tabela
create table if not exists public.lancamentos_financeiros (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete restrict,
  empresa_id                uuid not null references public.empresas(id) on delete restrict,
  conta_bancaria_id         uuid not null,
  data_movimento            date not null,
  valor                     numeric(14,2) not null,
  natureza                  natureza_lancamento not null,
  descricao                 text not null,
  plano_conta_tipo_id       uuid not null references public.plano_contas_tipos(id) on delete restrict,
  plano_conta_subtipo_id    uuid not null references public.plano_contas_subtipos(id) on delete restrict,
  fornecedor_id             uuid references public.fornecedores(id) on delete restrict,
  cliente_id                uuid references public.clientes(id) on delete restrict,
  job_id                    uuid references public.jobs(id) on delete restrict,
  pedido_compra_id          uuid references public.pedidos_compra(id) on delete restrict,
  estorno_de_lancamento_id  uuid references public.lancamentos_financeiros(id) on delete restrict,
  origem                    origem_lancamento not null default 'manual',
  criado_por                uuid not null references public.profiles(id),
  created_at                timestamptz not null default now(),
  constraint chk_valor_positivo check (valor > 0),
  constraint chk_descricao_nao_vazia check (length(trim(descricao)) >= 3),
  constraint fk_lancamento_conta_empresa
    foreign key (conta_bancaria_id, empresa_id)
    references public.contas_bancarias (id, empresa_id) on delete restrict,
  constraint chk_estorno_consistente check (
    (origem = 'pp_estorno' and estorno_de_lancamento_id is not null)
    or
    (origem <> 'pp_estorno' and estorno_de_lancamento_id is null)
  ),
  constraint chk_origem_pp_tem_pp_id check (
    (origem in ('pp_baixa','pp_baixa_estornada','pp_estorno') and pedido_compra_id is not null)
    or
    (origem = 'manual' and pedido_compra_id is null)
  )
);

-- 3) Unique parcial
create unique index if not exists uniq_baixa_ativa_por_pp
  on public.lancamentos_financeiros(pedido_compra_id)
  where origem = 'pp_baixa';

-- 4) Índices operacionais
create index if not exists idx_lanc_tenant on public.lancamentos_financeiros(tenant_id);
create index if not exists idx_lanc_conta_data
  on public.lancamentos_financeiros(tenant_id, conta_bancaria_id, data_movimento);
create index if not exists idx_lanc_data
  on public.lancamentos_financeiros(tenant_id, data_movimento);
create index if not exists idx_lanc_fornecedor on public.lancamentos_financeiros(fornecedor_id);
create index if not exists idx_lanc_job on public.lancamentos_financeiros(job_id);
create index if not exists idx_lanc_pp on public.lancamentos_financeiros(pedido_compra_id);
create index if not exists idx_lanc_tipo on public.lancamentos_financeiros(plano_conta_tipo_id);

-- 5) RLS + GRANT
alter table public.lancamentos_financeiros enable row level security;

drop policy if exists lancamentos_select on public.lancamentos_financeiros;
create policy lancamentos_select on public.lancamentos_financeiros
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists lancamentos_insert on public.lancamentos_financeiros;
create policy lancamentos_insert on public.lancamentos_financeiros
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists lancamentos_update on public.lancamentos_financeiros;
create policy lancamentos_update on public.lancamentos_financeiros
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.lancamentos_financeiros to authenticated;

-- 6) Trigger de imutabilidade do codigo do tipo
create or replace function public.enforce_tipo_codigo_imutavel()
returns trigger language plpgsql as $$
begin
  if NEW.codigo is distinct from OLD.codigo
     and exists (select 1 from public.lancamentos_financeiros
                  where plano_conta_tipo_id = OLD.id) then
    raise exception
      'Código do tipo % não pode ser alterado após o primeiro lançamento.', OLD.codigo
      using errcode = 'P0001';
  end if;
  return NEW;
end$$;

drop trigger if exists trg_tipo_codigo_imutavel on public.plano_contas_tipos;
create trigger trg_tipo_codigo_imutavel
  before update on public.plano_contas_tipos
  for each row execute function public.enforce_tipo_codigo_imutavel();
```

- [ ] **Step 2: Aplicar via MCP**

`mcp__supabase-write__apply_migration` com `name = "task011_lancamentos_financeiros"`.

Validar com:

```sql
select table_name, column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'lancamentos_financeiros'
 order by ordinal_position;
```

Expected: todas as colunas listadas na seção 4.4 da spec.

- [ ] **Step 3: Adicionar types em `lib/types.ts`**

```ts
export type NaturezaLancamento = "entrada" | "saida";

export type OrigemLancamento =
  | "pp_baixa"
  | "pp_baixa_estornada"
  | "pp_estorno"
  | "manual";

export interface LancamentoFinanceiro {
  id: string;
  tenant_id: string;
  empresa_id: string;
  conta_bancaria_id: string;
  data_movimento: string; // YYYY-MM-DD
  valor: string; // numeric — Number(...)
  natureza: NaturezaLancamento;
  descricao: string;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
  fornecedor_id: string | null;
  cliente_id: string | null;
  job_id: string | null;
  pedido_compra_id: string | null;
  estorno_de_lancamento_id: string | null;
  origem: OrigemLancamento;
  criado_por: string;
  created_at: string;
}
```

- [ ] **Step 4: Adicionar audit actions em `lib/auth/audit.ts`**

Antes de `| "acao_negada"`:

```ts
  | "lancamento_financeiro.criado"
  | "lancamento_financeiro.estornado"
  | "pedido_compra.baixa_estornada"
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Teste manual do trigger de imutabilidade**

Via MCP `execute_sql`:

```sql
-- Pega um tipo qualquer e força um lançamento fake pra travá-lo.
-- (Vamos usar DP como cobaia — depois reverter com delete.)
insert into public.lancamentos_financeiros (
  tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
  natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
  pedido_compra_id, origem, criado_por
) values (
  (select id from public.tenants order by created_at limit 1),
  (select id from public.empresas order by created_at limit 1),
  -- Vai falhar com FK se não houver conta bancária criada. Nesse caso,
  -- criar uma conta primeiro via UI e usar o id dela aqui.
  '{{ID_DE_UMA_CONTA_BANCARIA_QUALQUER}}',
  current_date, 100.00, 'saida', 'teste imutabilidade',
  (select id from public.plano_contas_tipos where codigo='DP' limit 1),
  -- Preciso de um subtipo. Pra este teste, criar um subtipo DP-Teste antes.
  '{{ID_DE_UM_SUBTIPO_DP}}',
  null, 'manual', (select id from public.profiles limit 1)
);

-- Agora tentar editar o codigo:
update public.plano_contas_tipos set codigo = 'DPES' where codigo = 'DP';
-- Expected: ERROR — "Código do tipo DP não pode ser alterado após o primeiro lançamento."

-- Reverter teste:
delete from public.lancamentos_financeiros where descricao = 'teste imutabilidade';
```

Se rodar como esperado, o trigger funciona. Se a inserção manual não for viável (FK exige conta bancária existente), aceitar validação apenas via typecheck agora e testar de fato depois da Task 7.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260805000003_lancamentos_financeiros.sql lib/types.ts lib/auth/audit.ts
git commit -m "task011: schema lancamentos_financeiros + trigger imutabilidade codigo"
```

---

## Task 6: RPCs `dar_baixa_pp` e `estornar_baixa_pp`

**Files:**
- Create: `supabase/migrations/20260805000004_baixa_pp_rpc.sql`

**Interfaces:**
- Consumes: `public.pedidos_compra`, `public.lancamentos_financeiros`.
- Produces:
  - Function `public.dar_baixa_pp(p_pp_id uuid, p_pago_em date, p_conta_bancaria_id uuid, p_plano_conta_tipo_id uuid, p_plano_conta_subtipo_id uuid, p_criado_por uuid)` retorna `uuid` (id do lançamento criado). SECURITY DEFINER.
  - Function `public.estornar_baixa_pp(p_pp_id uuid, p_motivo text, p_criado_por uuid)` retorna `uuid` (id do lançamento reverso). SECURITY DEFINER.
  - GRANT EXECUTE pra `authenticated`.

---

- [ ] **Step 1: Criar migration**

Arquivo `supabase/migrations/20260805000004_baixa_pp_rpc.sql`:

```sql
-- =====================================================================
-- Task 011 — RPCs transacionais de baixa e estorno de PP
-- =====================================================================

create or replace function public.dar_baixa_pp(
  p_pp_id                    uuid,
  p_pago_em                  date,
  p_conta_bancaria_id        uuid,
  p_plano_conta_tipo_id      uuid,
  p_plano_conta_subtipo_id   uuid,
  p_criado_por               uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp             pedidos_compra%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  -- 1. Carrega PP + valida
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if v_pp.status <> 'em_avaliacao' then
    raise exception 'PP não está em avaliação (status atual: %).', v_pp.status;
  end if;

  -- 2. Carrega conta + valida empresa bate
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_pp.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da PP.';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  -- 3. Valida subtipo pertence ao tipo
  select tipo_id into v_subtipo_tipo
    from public.plano_contas_subtipos
   where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  -- 4. UPDATE PP → pago
  update public.pedidos_compra
     set status = 'pago',
         pago_em = p_pago_em,
         pago_por = p_criado_por
   where id = p_pp_id;

  -- 5. INSERT lançamento
  v_descricao := 'PP ' || v_pp.codigo || ' — ' || substring(v_pp.servico, 1, 150);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, origem, criado_por
  ) values (
    v_pp.tenant_id, v_pp.empresa_id, p_conta_bancaria_id, p_pago_em, v_pp.valor,
    'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_pp.fornecedor_id, v_pp.job_id, v_pp.id, 'pp_baixa', p_criado_por
  )
  returning id into v_lancamento_id;

  return v_lancamento_id;
end;
$$;

grant execute on function public.dar_baixa_pp(uuid, date, uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------

create or replace function public.estornar_baixa_pp(
  p_pp_id       uuid,
  p_motivo      text,
  p_criado_por  uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp             pedidos_compra%rowtype;
  v_original       lancamentos_financeiros%rowtype;
  v_reverso_id     uuid;
  v_descricao      text;
begin
  -- 1. Carrega PP + valida
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if v_pp.status <> 'pago' then
    raise exception 'PP não está paga (status atual: %).', v_pp.status;
  end if;

  -- 2. Carrega lançamento original (única baixa ativa)
  select * into v_original
    from public.lancamentos_financeiros
   where pedido_compra_id = p_pp_id and origem = 'pp_baixa'
   limit 1;
  if not found then raise exception 'Lançamento original não encontrado.'; end if;

  -- 3. INSERT lançamento reverso (natureza invertida)
  v_descricao := 'Estorno da baixa de ' || v_pp.codigo || ' — ' || substring(p_motivo, 1, 200);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id,
    estorno_de_lancamento_id, origem, criado_por
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    -- Inverte natureza
    case when v_original.natureza = 'saida' then 'entrada'::natureza_lancamento
         else 'saida'::natureza_lancamento end,
    v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    v_original.fornecedor_id, v_original.job_id, v_original.pedido_compra_id,
    v_original.id, 'pp_estorno', p_criado_por
  )
  returning id into v_reverso_id;

  -- 4. UPDATE origem do lançamento original → libera unique parcial
  update public.lancamentos_financeiros
     set origem = 'pp_baixa_estornada'
   where id = v_original.id;

  -- 5. UPDATE PP → em_avaliacao
  update public.pedidos_compra
     set status = 'em_avaliacao',
         pago_em = null,
         pago_por = null
   where id = p_pp_id;

  return v_reverso_id;
end;
$$;

grant execute on function public.estornar_baixa_pp(uuid, text, uuid) to authenticated;
```

- [ ] **Step 2: Aplicar via MCP**

`mcp__supabase-write__apply_migration` com `name = "task011_baixa_pp_rpc"`.

Validar:

```sql
select proname, prosecdef
from pg_proc
where proname in ('dar_baixa_pp', 'estornar_baixa_pp');
```

Expected: 2 rows, `prosecdef=true`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260805000004_baixa_pp_rpc.sql
git commit -m "task011: RPCs dar_baixa_pp e estornar_baixa_pp"
```

---

## Task 7: Refactor da baixa da PP

**Files:**
- Modify: `app/(app)/financeiro/pedidos-compra/actions.ts`
- Create: `app/(app)/financeiro/pedidos-compra/baixa-pp-modal.tsx`
- Create: `app/(app)/financeiro/pedidos-compra/cancelar-baixa-modal.tsx`
- Modify: `app/(app)/financeiro/pedidos-compra/pp-drawer-financeiro.tsx`

**Interfaces:**
- Consumes: RPCs `dar_baixa_pp`, `estornar_baixa_pp` da Task 6. Types `ContaBancaria`, `PlanoContaTipo`, `PlanoContaSubtipo`, `LancamentoFinanceiro`.
- Produces:
  - `marcarPagaFinanceiro(input: { pp_id, pago_em, conta_bancaria_id, plano_conta_tipo_id, plano_conta_subtipo_id })` — assinatura nova.
  - `estornarBaixaPP(input: { pp_id, motivo })` — action nova.
  - Component `<BaixaPPModal pp={...} contas={...} tipos={...} subtipos={...} open onOpenChange />`.
  - Component `<CancelarBaixaModal pp={...} open onOpenChange />`.
  - Drawer da PP paga ganha botão "Cancelar baixa" que abre `<CancelarBaixaModal>`.

---

- [ ] **Step 1: Refactor `marcarPagaFinanceiro` em `actions.ts`**

Assinatura muda. Zod schema pra 5 campos. Chama RPC.

```ts
const baixaSchema = z.object({
  pp_id: z.string().uuid(),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
  plano_conta_tipo_id: z.string().uuid("Selecione o tipo."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo."),
});

export async function marcarPagaFinanceiro(input: unknown): Promise<Result> {
  const parsed = baixaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.pp_id, "pedido_compra.paga");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  // Carrega PP pra ter empresa/valor/job pro audit
  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("id, status, codigo, valor, job_id, empresa_id")
    .eq("id", parsed.data.pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "em_avaliacao") {
    return {
      ok: false,
      message:
        pp.status === "pago" ? "PP já está paga."
          : "Só PP em avaliação pode ser marcada como paga.",
    };
  }

  const { data: lancId, error } = await supabase.rpc("dar_baixa_pp", {
    p_pp_id: parsed.data.pp_id,
    p_pago_em: parsed.data.pago_em,
    p_conta_bancaria_id: parsed.data.conta_bancaria_id,
    p_plano_conta_tipo_id: parsed.data.plano_conta_tipo_id,
    p_plano_conta_subtipo_id: parsed.data.plano_conta_subtipo_id,
    p_criado_por: session.profile.id,
  });

  if (error) {
    return { ok: false, message: `Falha ao dar baixa: ${error.message}` };
  }

  await logAuditEvent({
    acao: "pedido_compra.paga",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      valor: Number(pp.valor),
      pago_em: parsed.data.pago_em,
      job_id: pp.job_id,
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
      origem: "pp_baixa",
      pp_codigo: pp.codigo,
      valor: Number(pp.valor),
      natureza: "saida",
    },
  });

  revalidatePath("/financeiro/pedidos-compra");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}
```

- [ ] **Step 2: Nova action `estornarBaixaPP`**

No mesmo arquivo:

```ts
const estornoSchema = z.object({
  pp_id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(10, "Motivo precisa ter pelo menos 10 caracteres.")
    .max(500, "Motivo passa de 500 caracteres."),
});

export async function estornarBaixaPP(input: unknown): Promise<Result> {
  const parsed = estornoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.pp_id, "pedido_compra.baixa_estornada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("id, status, codigo, job_id")
    .eq("id", parsed.data.pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "pago") {
    return { ok: false, message: "Só PP paga pode ter a baixa estornada." };
  }

  const { data: reversoId, error } = await supabase.rpc("estornar_baixa_pp", {
    p_pp_id: parsed.data.pp_id,
    p_motivo: parsed.data.motivo,
    p_criado_por: session.profile.id,
  });

  if (error) {
    return { ok: false, message: `Falha ao estornar: ${error.message}` };
  }

  await logAuditEvent({
    acao: "pedido_compra.baixa_estornada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: {
      pp_codigo: pp.codigo,
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
      origem: "pp_estorno",
      pp_codigo: pp.codigo,
      motivo: parsed.data.motivo,
    },
  });

  revalidatePath("/financeiro/pedidos-compra");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}
```

- [ ] **Step 3: Criar `baixa-pp-modal.tsx`**

Componente client. Props: `pp: PPRow` (do `pedidos-compra-list`), `contas: ContaBancaria[]`, `tipos: PlanoContaTipo[]`, `subtipos: PlanoContaSubtipo[]`, `open`, `onOpenChange`. Usa `<Dialog>` centrado (não `<DrawerContent>`).

Estrutura:

```tsx
"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { X, CreditCard, AlertCircle } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DialogContent } from "@radix-ui/react-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import type { PPRow } from "./pedidos-compra-list";
import { marcarPagaFinanceiro } from "./actions";

interface Props {
  pp: PPRow;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BaixaPPModal({ pp, contas, tipos, subtipos, open, onOpenChange }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [pagoEm, setPagoEm] = React.useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [contaId, setContaId] = React.useState<string>("");
  const [tipoId, setTipoId] = React.useState<string>("");
  const [subtipoId, setSubtipoId] = React.useState<string>("");

  React.useEffect(() => {
    if (!open) return;
    setErro(null);
    setPagoEm(format(new Date(), "yyyy-MM-dd"));
    setContaId("");
    setTipoId("");
    setSubtipoId("");
  }, [open, pp]);

  // Filtra contas pela empresa da PP
  const contasDaEmpresa = contas.filter(
    (c) => c.empresa_id === pp.empresa_id && c.ativo,
  );

  const tiposAtivos = tipos.filter((t) => t.ativo);
  const subtiposDoTipo = tipoId
    ? subtipos.filter((s) => s.tipo_id === tipoId && s.ativo)
    : [];

  // Reset subtipo quando tipo troca
  React.useEffect(() => {
    setSubtipoId("");
  }, [tipoId]);

  function handleSubmit() {
    setErro(null);
    if (!contaId || !tipoId || !subtipoId || !pagoEm) {
      setErro("Preencha todos os campos obrigatórios.");
      return;
    }
    startTransition(async () => {
      const res = await marcarPagaFinanceiro({
        pp_id: pp.id,
        pago_em: pagoEm,
        conta_bancaria_id: contaId,
        plano_conta_tipo_id: tipoId,
        plano_conta_subtipo_id: subtipoId,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-background p-6 shadow-elevated">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            Dar baixa em {pp.codigo}
          </DialogTitle>
        </DialogHeader>

        {erro && (
          <div className="flex items-start gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-md bg-muted/40 p-3 text-sm">
          <span className="text-muted-foreground">Fornecedor</span>
          <span className="font-medium">{pp.fornecedor_nome}</span>
          <span className="text-muted-foreground">Job</span>
          <span>{pp.job_codigo}</span>
          <span className="text-muted-foreground">Empresa</span>
          <span>{pp.empresa_nome}</span>
          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-semibold">
            {formatCurrency(pp.valor, "BRL")}
          </span>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Data do pagamento *</label>
            <DatePicker
              name="pago_em"
              defaultValue={pagoEm}
              onDateChange={(d) => setPagoEm(d ? format(d, "yyyy-MM-dd") : "")}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Conta bancária *</label>
            <Select value={contaId} onValueChange={setContaId}>
              <SelectTrigger><SelectValue placeholder="Selecione a conta..." /></SelectTrigger>
              <SelectContent>
                {contasDaEmpresa.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhuma conta ativa dessa empresa. Cadastre em /cadastros/contas-bancarias.
                  </div>
                ) : contasDaEmpresa.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome} · {c.banco}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Tipo *</label>
              <Select value={tipoId} onValueChange={setTipoId}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {tiposAtivos.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.codigo} · {t.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Subtipo *</label>
              <Select value={subtipoId} onValueChange={setSubtipoId} disabled={!tipoId}>
                <SelectTrigger><SelectValue placeholder={tipoId ? "Selecione..." : "Escolha o tipo primeiro"} /></SelectTrigger>
                <SelectContent>
                  {subtiposDoTipo.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum subtipo cadastrado.
                    </div>
                  ) : subtiposDoTipo.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <CreditCard className="h-4 w-4" />
            {pending ? "Confirmando..." : "Confirmar baixa"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Criar `cancelar-baixa-modal.tsx`**

Espelhar padrão do modal acima, mas mais simples. Um textarea de motivo (10-500) e botão vermelho "Confirmar estorno".

```tsx
"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, AlertCircle } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DialogContent } from "@radix-ui/react-dialog";
import type { PPRow } from "./pedidos-compra-list";
import { estornarBaixaPP } from "./actions";

interface Props {
  pp: PPRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CancelarBaixaModal({ pp, open, onOpenChange }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [motivo, setMotivo] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setErro(null);
    setMotivo("");
  }, [open, pp]);

  function handleSubmit() {
    setErro(null);
    startTransition(async () => {
      const res = await estornarBaixaPP({ pp_id: pp.id, motivo });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-background p-6 shadow-elevated">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-california-red" />
            Cancelar baixa de {pp.codigo}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          A PP volta para <span className="font-medium text-foreground">Em avaliação</span>. Um
          lançamento reverso é gerado na mesma conta bancária, mantendo o histórico contábil.
          O motivo fica no log de auditoria.
        </p>

        {erro && (
          <div className="flex items-start gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium">Motivo * (mín. 10 caracteres)</label>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full rounded border border-border p-2 text-sm"
            placeholder="Ex: valor lançado divergia do valor real pago. Conta bancária errada."
          />
          <p className="text-[11px] text-muted-foreground">
            {motivo.trim().length}/500 caracteres
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending || motivo.trim().length < 10}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
          >
            {pending ? "Confirmando..." : "Confirmar estorno"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Modificar `pp-drawer-financeiro.tsx`**

Duas mudanças:

**(a)** Trocar o `<ConfirmDialog>` da baixa por `<BaixaPPModal>`. Substituir todo o bloco `{/* Confirm baixa */} ...` (linhas ~466-500 do arquivo atual) por um trigger controlado que abre `<BaixaPPModal>`.

**(b)** Quando `pp.status === "pago"`, o `podeEditar` era `false` e o rodapé não mostrava ações. Adicionar botão "Cancelar baixa" (border california-red) que abre `<CancelarBaixaModal>`.

Precisa carregar `contas`, `tipos`, `subtipos` na `page.tsx` do `/financeiro/pedidos-compra` e passar como props pra list → drawer → modal.

Alterações concretas em `pp-drawer-financeiro.tsx`:

1. **Adicionar props** no interface `Props`:
```ts
interface Props {
  pp: PPRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contas: ContaBancaria[];   // nova
  tipos: PlanoContaTipo[];   // nova
  subtipos: PlanoContaSubtipo[]; // nova
}
```

2. **Remover** `const [askPagar, setAskPagar] = React.useState(false);` e `const [pagoEm, setPagoEm] = React.useState<string | null>(null);` e a função `handleConfirmarPagar`.

3. **Adicionar**:
```ts
const [baixaOpen, setBaixaOpen] = React.useState(false);
const [cancelarBaixaOpen, setCancelarBaixaOpen] = React.useState(false);
```

4. **Trocar o botão "Dar Baixa"** (linha ~412-420) pra abrir `setBaixaOpen(true)` em vez de `setAskPagar(true)`.

5. **Adicionar rodapé quando `pp.status === "pago"`**:
```tsx
{pp.status === "pago" && (
  <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
    <button
      type="button"
      onClick={() => setCancelarBaixaOpen(true)}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-white px-3 py-2 text-xs font-semibold text-california-red hover:bg-california-red hover:text-white disabled:opacity-50"
    >
      <Ban className="h-3.5 w-3.5" />
      Cancelar baixa
    </button>
  </div>
)}
```

6. **Remover** o `<ConfirmDialog open={askPagar} ... />` inteiro (linhas ~466-500).

7. **Adicionar** no final do JSX (fora do `<Dialog>`, dentro do fragmento):
```tsx
{pp && (
  <>
    <BaixaPPModal
      pp={pp}
      contas={contas}
      tipos={tipos}
      subtipos={subtipos}
      open={baixaOpen}
      onOpenChange={setBaixaOpen}
    />
    <CancelarBaixaModal
      pp={pp}
      open={cancelarBaixaOpen}
      onOpenChange={setCancelarBaixaOpen}
    />
  </>
)}
```

8. **Imports**:
```ts
import { BaixaPPModal } from "./baixa-pp-modal";
import { CancelarBaixaModal } from "./cancelar-baixa-modal";
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
```

- [ ] **Step 6: Modificar `page.tsx` do `/financeiro/pedidos-compra`**

Adicionar queries paralelas pra contas, tipos, subtipos:

```ts
const [ppsRes, contasRes, tiposRes, subtiposRes] = await Promise.all([
  // query existente das PPs
  supabase.from("contas_bancarias").select("*")
    .eq("tenant_id", session.activeTenant.id).eq("ativo", true)
    .returns<ContaBancaria[]>(),
  supabase.from("plano_contas_tipos").select("*")
    .eq("tenant_id", session.activeTenant.id).eq("ativo", true)
    .order("ordem").returns<PlanoContaTipo[]>(),
  supabase.from("plano_contas_subtipos").select("*")
    .eq("tenant_id", session.activeTenant.id).eq("ativo", true)
    .order("nome").returns<PlanoContaSubtipo[]>(),
]);
```

Passar `contas={contasRes.data ?? []}`, `tipos={tiposRes.data ?? []}`, `subtipos={subtiposRes.data ?? []}` pra `<PedidosCompraList>`. Essa lista repassa pra `<PPDrawerFinanceiro>`.

- [ ] **Step 7: Modificar `pedidos-compra-list.tsx` para repassar props + expor empresa_id no PPRow**

**(a)** Adicionar props `contas`, `tipos`, `subtipos` no interface do componente e repassar pro `<PPDrawerFinanceiro>`.

**(b)** O tipo `PPRow` exportado por este arquivo precisa incluir `empresa_id: string` (o `<BaixaPPModal>` filtra contas por empresa da PP). Se ainda não expõe:

1. Na query da `page.tsx` do `/financeiro/pedidos-compra`, adicionar `empresa_id` no `select`.
2. No interface `PPRow`, adicionar linha `empresa_id: string;`.

Sem isso, o filtro `contas.filter((c) => c.empresa_id === pp.empresa_id)` no modal retorna vazio.

- [ ] **Step 8: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 9: Teste manual end-to-end**

`npm run dev`.

1. Cadastrar 1 conta bancária em `/cadastros/contas-bancarias` (se não fez ainda na Task 2).
2. Cadastrar 1 subtipo em `CO` (Custo Operacional): "Serviço externo".
3. Ir em uma PP em `em_avaliacao` no `/financeiro/pedidos-compra`.
4. Abrir drawer, clicar "Dar Baixa" → modal novo aparece.
5. Preencher: data hoje, conta Santander, tipo CO, subtipo "Serviço externo". Confirmar.
6. Ver que PP virou `pago`. Fechar drawer, reabrir a mesma PP.
7. Ver botão "Cancelar baixa". Clicar. Digitar motivo "teste de estorno pra ver se volta". Confirmar.
8. PP voltou pra `em_avaliacao`. Fim.

Depois, via MCP `execute_sql`, ver que existem 2 lançamentos: 1 `pp_baixa_estornada` + 1 `pp_estorno` (natureza invertida).

- [ ] **Step 10: Commit**

```bash
git add app/\(app\)/financeiro/pedidos-compra
git commit -m "task011: refactor baixa da PP + estorno reverso via RPC"
```

---

## Task 8: Helper de saldo + tela `/financeiro/conciliacao`

**Files:**
- Create: `lib/calculos/saldo-conta.ts`
- Create: `app/(app)/financeiro/conciliacao/page.tsx`
- Create: `app/(app)/financeiro/conciliacao/conciliacao-list.tsx`
- Create: `app/(app)/financeiro/conciliacao/filtros-conta.tsx`

**Interfaces:**
- Consumes: `contas_bancarias`, `lancamentos_financeiros` com FKs relacionadas (fornecedor, job, tipo, subtipo).
- Produces:
  - Helper `calcularSaldoAnterior(supabase, { contaId, dataDe })` → `Promise<number>`.
  - Rota `/financeiro/conciliacao?conta=<id>&de=<YYYY-MM-DD>&ate=<YYYY-MM-DD>&highlight=<lancId>` server-side.
  - Card "Saldo anterior · Créditos · Débitos · Saldo final" no topo.
  - Tabela com colunas: Data | Descrição | Fornecedor | Job | Tipo/Subtipo | Crédito | Débito | Saldo (derivado com window function no client, ou já vindo do server).

---

- [ ] **Step 1: `lib/calculos/saldo-conta.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type LancamentoLinha = {
  id: string;
  data_movimento: string;
  descricao: string;
  natureza: "entrada" | "saida";
  valor: number;
  fornecedor_nome: string | null;
  job_codigo: string | null;
  tipo_codigo: string;
  tipo_nome: string;
  subtipo_nome: string;
  origem: string;
  credito: number;
  debito: number;
  saldo: number;
};

/**
 * Retorna o saldo da conta ANTES de `dataDe` (inclusive saldo_inicial da conta).
 * Se dataDe <= saldo_inicial_data, retorna saldo_inicial.
 */
export async function calcularSaldoAnterior(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    contaId: string;
    dataDe: string; // YYYY-MM-DD
  },
): Promise<{ saldoAnterior: number; saldoInicialData: string }> {
  const { data: conta } = await supabase
    .from("contas_bancarias")
    .select("saldo_inicial, saldo_inicial_data")
    .eq("id", args.contaId)
    .eq("tenant_id", args.tenantId)
    .single();

  if (!conta) return { saldoAnterior: 0, saldoInicialData: args.dataDe };

  const saldoInicial = Number(conta.saldo_inicial);
  const saldoInicialData = conta.saldo_inicial_data;

  if (args.dataDe <= saldoInicialData) {
    return { saldoAnterior: saldoInicial, saldoInicialData };
  }

  const { data: lancsAnteriores } = await supabase
    .from("lancamentos_financeiros")
    .select("valor, natureza")
    .eq("tenant_id", args.tenantId)
    .eq("conta_bancaria_id", args.contaId)
    .gte("data_movimento", saldoInicialData)
    .lt("data_movimento", args.dataDe);

  const delta = (lancsAnteriores ?? []).reduce((acc, l) => {
    const v = Number(l.valor);
    return acc + (l.natureza === "entrada" ? v : -v);
  }, 0);

  return { saldoAnterior: saldoInicial + delta, saldoInicialData };
}

/**
 * Enriquece as linhas do período com credito/debito/saldo derivado.
 * Recebe raw rows já ordenadas por data_movimento ASC, created_at ASC.
 */
export function derivarSaldo(
  rows: Omit<LancamentoLinha, "credito" | "debito" | "saldo">[],
  saldoAnterior: number,
): LancamentoLinha[] {
  let saldo = saldoAnterior;
  return rows.map((r) => {
    const credito = r.natureza === "entrada" ? r.valor : 0;
    const debito = r.natureza === "saida" ? r.valor : 0;
    saldo = saldo + credito - debito;
    return { ...r, credito, debito, saldo };
  });
}
```

- [ ] **Step 2: `page.tsx`**

```tsx
import Link from "next/link";
import { Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { ContaBancaria } from "@/lib/types";
import { calcularSaldoAnterior, derivarSaldo } from "@/lib/calculos/saldo-conta";
import { FiltrosConta } from "./filtros-conta";
import { ConciliacaoList } from "./conciliacao-list";

export const dynamic = "force-dynamic";

export default async function ConciliacaoPage({
  searchParams,
}: {
  searchParams: { conta?: string; de?: string; ate?: string; highlight?: string };
}) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const { data: contas } = await supabase
    .from("contas_bancarias")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .eq("ativo", true)
    .order("ordem")
    .order("nome")
    .returns<ContaBancaria[]>();

  const listaContas = contas ?? [];
  const contaId = searchParams.conta ?? listaContas[0]?.id ?? null;

  // Default: mês corrente
  const hoje = new Date();
  const dataDe =
    searchParams.de ??
    new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
  const dataAte =
    searchParams.ate ??
    new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);

  let saldoAnterior = 0;
  let linhas: any[] = [];
  let creditos = 0;
  let debitos = 0;

  if (contaId) {
    const s = await calcularSaldoAnterior(supabase, {
      tenantId: session.activeTenant.id,
      contaId,
      dataDe,
    });
    saldoAnterior = s.saldoAnterior;

    const { data } = await supabase
      .from("lancamentos_financeiros")
      .select(
        `id, data_movimento, descricao, natureza, valor, origem, created_at,
         fornecedores(nome_fantasia, razao_social),
         jobs(codigo),
         plano_contas_tipos!inner(codigo, nome),
         plano_contas_subtipos!inner(nome)`
      )
      .eq("tenant_id", session.activeTenant.id)
      .eq("conta_bancaria_id", contaId)
      .gte("data_movimento", dataDe)
      .lte("data_movimento", dataAte)
      .order("data_movimento", { ascending: true })
      .order("created_at", { ascending: true });

    const raw = (data ?? []).map((r: any) => ({
      id: r.id,
      data_movimento: r.data_movimento,
      descricao: r.descricao,
      natureza: r.natureza,
      valor: Number(r.valor),
      fornecedor_nome:
        r.fornecedores?.nome_fantasia ?? r.fornecedores?.razao_social ?? null,
      job_codigo: r.jobs?.codigo ?? null,
      tipo_codigo: r.plano_contas_tipos.codigo,
      tipo_nome: r.plano_contas_tipos.nome,
      subtipo_nome: r.plano_contas_subtipos.nome,
      origem: r.origem,
    }));

    linhas = derivarSaldo(raw, saldoAnterior);
    creditos = linhas.reduce((s, l) => s + l.credito, 0);
    debitos = linhas.reduce((s, l) => s + l.debito, 0);
  }

  const saldoFinal = saldoAnterior + creditos - debitos;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Financeiro
        </p>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Receipt className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Conciliação</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Extrato por conta bancária — base pra bater com o extrato do banco e alimentar o DRE.
        </p>
      </header>

      <FiltrosConta
        contas={listaContas}
        contaAtual={contaId ?? undefined}
        dataDe={dataDe}
        dataAte={dataAte}
      />

      {contaId && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <SaldoCard label="Saldo anterior" valor={saldoAnterior} muted />
            <SaldoCard label="Créditos no período" valor={creditos} tone="entrada" />
            <SaldoCard label="Débitos no período" valor={debitos} tone="saida" />
            <SaldoCard label="Saldo final" valor={saldoFinal} destaque />
          </div>

          <ConciliacaoList linhas={linhas} highlight={searchParams.highlight} />
        </>
      )}

      {!contaId && (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma conta bancária cadastrada. Vá em{" "}
            <Link href="/cadastros/contas-bancarias" className="text-california-red hover:underline">
              cadastros
            </Link>{" "}
            pra criar a primeira.
          </p>
        </div>
      )}
    </div>
  );
}

function SaldoCard({
  label,
  valor,
  muted,
  destaque,
  tone,
}: {
  label: string;
  valor: number;
  muted?: boolean;
  destaque?: boolean;
  tone?: "entrada" | "saida";
}) {
  const cor = destaque
    ? valor >= 0 ? "text-emerald-700" : "text-california-red"
    : tone === "entrada" ? "text-emerald-700"
    : tone === "saida" ? "text-california-red"
    : muted ? "text-muted-foreground"
    : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold ${cor}`}>
        {valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: `filtros-conta.tsx`**

```tsx
"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { format } from "date-fns";
import type { ContaBancaria } from "@/lib/types";

export function FiltrosConta({
  contas,
  contaAtual,
  dataDe,
  dataAte,
}: {
  contas: ContaBancaria[];
  contaAtual?: string;
  dataDe: string;
  dataAte: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([k, v]) => {
      if (v === null) params.delete(k);
      else params.set(k, v);
    });
    router.push(`/financeiro/conciliacao?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
      <div className="min-w-[280px] flex-1 space-y-1">
        <label className="text-[11px] uppercase text-muted-foreground">Conta bancária</label>
        <Select value={contaAtual ?? ""} onValueChange={(v) => update({ conta: v })}>
          <SelectTrigger><SelectValue placeholder="Selecione a conta..." /></SelectTrigger>
          <SelectContent>
            {contas.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nome} · {c.banco}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label className="text-[11px] uppercase text-muted-foreground">De</label>
        <DatePicker
          name="de"
          defaultValue={dataDe}
          onDateChange={(d) => update({ de: d ? format(d, "yyyy-MM-dd") : null })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] uppercase text-muted-foreground">Até</label>
        <DatePicker
          name="ate"
          defaultValue={dataAte}
          onDateChange={(d) => update({ ate: d ? format(d, "yyyy-MM-dd") : null })}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `conciliacao-list.tsx`**

```tsx
"use client";
import * as React from "react";
import type { LancamentoLinha } from "@/lib/calculos/saldo-conta";

export function ConciliacaoList({
  linhas,
  highlight,
}: {
  linhas: LancamentoLinha[];
  highlight?: string;
}) {
  const rowRefs = React.useRef<Record<string, HTMLTableRowElement | null>>({});

  React.useEffect(() => {
    if (!highlight) return;
    const el = rowRefs.current[highlight];
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("animate-pulse", "bg-yellow-50");
      setTimeout(() => el.classList.remove("animate-pulse", "bg-yellow-50"), 2000);
    }
  }, [highlight, linhas]);

  if (linhas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum lançamento nesse período pra essa conta.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Data</th>
            <th className="px-3 py-2 text-left">Descrição</th>
            <th className="px-3 py-2 text-left">Fornecedor</th>
            <th className="px-3 py-2 text-left">Job</th>
            <th className="px-3 py-2 text-left">Tipo</th>
            <th className="px-3 py-2 text-right">Crédito</th>
            <th className="px-3 py-2 text-right">Débito</th>
            <th className="px-3 py-2 text-right">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr
              key={l.id}
              ref={(el) => { rowRefs.current[l.id] = el; }}
              className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
            >
              <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">
                {formatDate(l.data_movimento)}
              </td>
              <td className={`px-3 py-2 ${l.origem === "pp_baixa_estornada" ? "line-through text-muted-foreground" : ""}`}>
                {l.descricao}
              </td>
              <td className="px-3 py-2 text-xs">{l.fornecedor_nome ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-xs">{l.job_codigo ?? "—"}</td>
              <td className="px-3 py-2 text-xs">
                <span className="font-mono">{l.tipo_codigo}</span> · {l.subtipo_nome}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs text-emerald-700">
                {l.credito > 0 ? formatMoney(l.credito) : ""}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs text-california-red">
                {l.debito > 0 ? formatMoney(l.debito) : ""}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                {formatMoney(l.saldo)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 6: Teste manual**

`npm run dev`.

1. Ir em `/financeiro/conciliacao`.
2. Sem conta selecionada, deve mostrar dropdown com a Santander criada.
3. Selecionar. Ver saldos (deve mostrar `saldo_inicial` como saldo anterior se não houver movimento no mês corrente).
4. Se tem PP paga do teste anterior, ver linha aparecendo com descrição "PP PP-... — Serviço externo", coluna Débito preenchida.
5. Após estornar (também do teste anterior), ver a linha original com strikethrough + linha de "Estorno da baixa de PP-..." com Crédito preenchido.
6. Saldo derivado deve fechar em zero pra essas duas linhas.

- [ ] **Step 7: Commit**

```bash
git add lib/calculos/saldo-conta.ts app/\(app\)/financeiro/conciliacao
git commit -m "task011: tela /financeiro/conciliacao com saldo derivado"
```

---

## Task 9: Sidebar + hub `/financeiro`

**Files:**
- Modify: `components/sidebar.tsx`
- Modify: `app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consumes: rotas de Tasks 2, 4 e 8.
- Produces: navegação persistente pra as 3 telas novas.

---

- [ ] **Step 1: Adicionar entrada "Conciliação" na sidebar**

Em `components/sidebar.tsx`, na seção de `/financeiro`:

```tsx
{
  label: "Conciliação",
  href: "/financeiro/conciliacao",
  icon: Receipt,
  roles: ["administrador", "financeiro"] as AppRole[],
},
```

Import `Receipt` de `lucide-react` se não estiver.

- [ ] **Step 2: Adicionar card "Conciliação" no hub `/financeiro`**

Em `app/(app)/financeiro/page.tsx`, adicionar card ao lado dos existentes (jobs-aguardando-abertura, pedidos-compra):

```tsx
<HubCard
  href="/financeiro/conciliacao"
  icon={Receipt}
  title="Conciliação bancária"
  description="Extrato por conta bancária. Base pra bater com o extrato do banco e pra o DRE."
/>
```

(Se o hub tiver contador, contar `lancamentos_financeiros` do mês corrente. Se não tiver, sem contador.)

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 4: Teste manual**

1. Logar como admin: ver entrada "Conciliação" na sidebar e card no hub `/financeiro`.
2. Logar como financeiro: mesmo comportamento.
3. Logar como GP (papel `producao` ou similar sem `financeiro`): entrada NÃO aparece, card NÃO aparece.

- [ ] **Step 5: Commit**

```bash
git add components/sidebar.tsx app/\(app\)/financeiro/page.tsx
git commit -m "task011: sidebar + hub financeiro apontam pra Conciliacao"
```

---

## Self-Review

**1. Spec coverage:**

- Seção 3 (decisões) → coberta pelas migrations (Tasks 1, 3, 5, 6) e pelo drawer refactor (Task 7). ✅
- Seção 4 (modelagem) → Tasks 1, 3, 5. ✅
- Seção 5 (regras) → RPCs Task 6 + refactor actions Task 7. ✅
- Seção 6 (server actions) → Tasks 2, 4, 7. ✅
- Seção 7 (UI) → Tasks 2, 4, 7, 8, 9. ✅
- Seção 8 (RLS/audit) → embutido em cada migration + audit em cada action. ✅
- Seção 9 (migrations) → Tasks 1, 3, 5, 6. ✅
- Seção 10 (seeds) → Task 3 (seed dos 15 tipos). ✅
- Seção 11 (fora de escopo) → não implementado, correto. ✅
- Seção 12 (impacto no código) → coberto. ✅
- Seção 13 (riscos) → mitigações no design das actions e RPCs. ✅
- Seção 14 (decisões rodada 2) → aplicadas em Task 2, 4, 7. ✅
- Seção 15 (imutabilidade codigo) → 3 camadas: server action (Task 4), UI (Task 4 drawer), trigger banco (Task 5). ✅

**2. Placeholder scan:** revisei buscando "TBD", "TODO", "implement later", "similar to". Não encontrei. Alguns lugares dizem "espelhar padrão de X" — aceitável porque X está no repo e é lido antes.

**3. Type consistency:**

- `ContaBancaria`, `PlanoContaTipo`, `PlanoContaSubtipo`, `LancamentoFinanceiro`, `NaturezaLancamento`, `OrigemLancamento`, `NaturezaPadraoTipo` — todos usados de forma consistente entre tasks.
- `marcarPagaFinanceiro(input: { pp_id, pago_em, conta_bancaria_id, plano_conta_tipo_id, plano_conta_subtipo_id })` — assinatura definida na Task 7 e chamada com esses nomes no `<BaixaPPModal>`.
- `estornarBaixaPP(input: { pp_id, motivo })` — idem.
- RPCs recebem os mesmos nomes de parâmetros (`p_pp_id`, `p_pago_em`, etc.) tanto na migration quanto no `supabase.rpc(...)`.
- `PPRow` — tipo existente em `pedidos-compra-list.tsx`. Precisa incluir `empresa_id` já? Verificar na Task 7 — se não incluir, adicionar como parte da modificação.

**Ajuste inline:** vou explicitar em Task 7 Step 7 que o `PPRow` precisa expor `empresa_id` pra o filtro de contas funcionar. Se não expor hoje, a query da page precisa `select("..., empresa_id")` e o interface precisa aceitar.

Vou fazer esse ajuste agora.
