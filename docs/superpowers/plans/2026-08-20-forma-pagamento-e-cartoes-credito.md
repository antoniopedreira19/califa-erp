# Forma de Pagamento e Cartões de Crédito — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir forma de pagamento (PIX/transferência/boleto/cartão) nas 3 origens de "Contas a Pagar" (PP, avulsa, recorrência) e uma nova aba "Títulos a Pagar (Cartão)" que agrupa por cartão e permite baixa em lote da fatura.

**Architecture:** Enum aditivo `forma_pagamento` + FK opcional `cartao_credito_id` nas 3 tabelas com check constraint de coerência. Cadastro de cartões com `dia_vencimento_fatura`. Auto-preenchimento de `data_pagamento` via helper puro (TS + SQL espelhados). Baixa em lote via RPC transacional que reutiliza as RPCs de baixa individuais.

**Tech Stack:** Next.js 14 App Router (server components + server actions), React 18, TypeScript 5, Supabase Postgres (RLS + RPC), React Hook Form + Zod, Tailwind + shadcn/ui, MCP Supabase para aplicar migrations.

**Spec:** [docs/superpowers/specs/2026-08-20-forma-pagamento-e-cartoes-credito-design.md](../specs/2026-08-20-forma-pagamento-e-cartoes-credito-design.md)

## Global Constraints

- **Fluxo de banco (docs/FLUXO-BANCO.md)**: toda estrutura nasce de migration versionada em `supabase/migrations/`. Ler → migration → `apply_migration` via MCP → conferir → commit da migration junto do código.
- **RLS + GRANT**: toda tabela nova tem RLS ativado, policies via `is_tenant_member(tenant_id)`, e `GRANT` explícito a `authenticated` (nada a `anon`).
- **Índices em FK**: toda FK "quente" (usada em filtro/agrupamento) recebe índice — parcial `where cartao_credito_id is not null` nas 3 tabelas.
- **`lib/types.ts` no mesmo commit** da migration que mexer em coluna consumida pelo frontend.
- **Ortografia pt-BR completa** em toda string visível ao usuário (labels, placeholders, botões, erros, toasts). Identificadores de código podem ficar sem acento.
- **Componente compartilhado `FormaPagamentoField`** — 1 fonte, consumido pelos 3 formulários. Duplicar hex/lógica de forma em 3 lugares já derrubou o projeto antes.
- **Performance**: queries do server component em `Promise.all` (padrão de `contas-a-pagar/page.tsx`). Novo componente `FormaPagamentoField` recebe lista de cartões via props (fetch 1x no server, não 3x).
- **Sem framework de testes**: projeto não usa vitest/jest. Verificação = `npm run lint` + `npm run typecheck` + smoke manual no browser + `mcp__supabase__execute_sql` para inspecionar estado do banco após migration.
- **`data_pagamento` de cartão >= hoje** — validação server-side em toda action que crie título com `forma_pagamento = 'cartao_credito'`.
- **Prefixo de migration** — próximo número: `20260820000001` (última em 20260819).

---

## File Structure

**Novos arquivos:**
- `supabase/migrations/20260820000001_forma_pagamento_e_cartoes.sql` — enum + tabela.
- `supabase/migrations/20260820000002_forma_pagamento_nas_origens.sql` — colunas + constraints nas 3 tabelas.
- `supabase/migrations/20260820000003_proxima_fatura_e_materializacao_cartao.sql` — SQL helper + patch em `gerar_ocorrencias_recorrentes`.
- `supabase/migrations/20260820000004_baixa_lote_cartao.sql` — RPC de baixa em lote.
- `lib/cartoes/proxima-fatura.ts` — helper puro.
- `lib/validations/cartao-credito.ts` — Zod schemas.
- `app/(app)/cadastros/cartoes-credito/page.tsx` — server component.
- `app/(app)/cadastros/cartoes-credito/cartoes-list.tsx` — client tabela.
- `app/(app)/cadastros/cartoes-credito/cartao-drawer.tsx` — client form.
- `app/(app)/cadastros/cartoes-credito/actions.ts` — server actions.
- `components/financeiro/forma-pagamento-field.tsx` — componente compartilhado.
- `app/(app)/financeiro/contas-a-pagar/actions-cartao.ts` — action de baixa em lote.
- `app/(app)/financeiro/contas-a-pagar/titulos-cartao-list.tsx` — client, agrupado por cartão.
- `app/(app)/financeiro/contas-a-pagar/baixa-lote-cartao-dialog.tsx` — client, modal.

**Arquivos modificados:**
- `lib/types.ts` — types `FormaPagamento`, `BandeiraCartao`, `CartaoCredito`; colunas novas em `PedidoCompra`, `ContaAvulsa`, `ContaAvulsaRecorrente`; `TituloRow`.
- `app/(app)/cadastros/page.tsx` — card "Cartões de crédito" no hub.
- `lib/validations/conta-avulsa.ts` — 2 campos novos em `criarContaAvulsaSchema` (discriminated union).
- `app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx` — insere `FormaPagamentoField`.
- `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts` — repassa 2 campos + valida data.
- Form de emissão de PP (arquivo a mapear na Task 7) — insere `FormaPagamentoField`.
- `app/(app)/jobs/[jobId]/realizado/actions-pp.ts` — repassa forma_pagamento/cartao_credito_id.
- Drawer de recorrência (a mapear na Task 8) — insere `FormaPagamentoField`.
- `app/(app)/financeiro/contas-a-pagar/actions-recorrentes.ts` — repassa 2 campos.
- `app/(app)/financeiro/contas-a-pagar/page.tsx` — fetch de cartões ativos + filtro na lista comum + prop `cartoes` para a nova aba.
- `app/(app)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx` — 5ª aba "Títulos a Pagar (Cartão)".

---

## Task 1: Migration 1 + tipos — cartões de crédito

**Files:**
- Create: `supabase/migrations/20260820000001_forma_pagamento_e_cartoes.sql`
- Modify: `lib/types.ts` (adicionar tipos no fim, na região "Cadastros")

**Interfaces:**
- Consumes: nada.
- Produces: enum `forma_pagamento`, enum `bandeira_cartao`, tabela `cartoes_credito`, types TS `FormaPagamento`, `BandeiraCartao`, `CartaoCredito`, helpers `formaPagamentoLabel(f)`, `bandeiraCartaoLabel(b)`.

- [ ] **Step 1: Ler estado atual do banco pelo MCP**

Chamar `mcp__supabase__list_tables` e conferir que `cartoes_credito` não existe. Chamar `mcp__supabase__execute_sql` com:

```sql
select typname from pg_type where typname in ('forma_pagamento','bandeira_cartao');
```

Esperado: 0 linhas.

- [ ] **Step 2: Criar migration**

Arquivo: `supabase/migrations/20260820000001_forma_pagamento_e_cartoes.sql`

```sql
-- Racional: introduz forma_pagamento (enum) usada nas 3 tabelas de
-- origem de "Contas a Pagar" (PP, avulsa, recorrência) e o cadastro
-- de cartoes_credito com dia_vencimento_fatura. Migration aditiva:
-- não toca colunas existentes; as adições nas 3 tabelas ficam para
-- 20260820000002. Ver docs/superpowers/specs/2026-08-20-forma-pagamento
-- -e-cartoes-credito-design.md, seções 3.1, 3.2, 3.3 e 4.1.

create type forma_pagamento as enum
  ('pix', 'transferencia', 'boleto', 'cartao_credito');

create type bandeira_cartao as enum
  ('visa', 'master', 'elo', 'amex', 'hipercard', 'outra');

create table cartoes_credito (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nome text not null,
  banco text not null,
  bandeira bandeira_cartao not null,
  ultimos_4_digitos text not null check (ultimos_4_digitos ~ '^\d{4}$'),
  dono text not null,
  dia_vencimento_fatura smallint not null
    check (dia_vencimento_fatura between 1 and 31),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (tenant_id, nome)
);

comment on table cartoes_credito is
  'Cartões de crédito do tenant. Referenciados pelos títulos com forma_pagamento=cartao_credito. dia_vencimento_fatura define a data de pagamento auto-preenchida do título.';

create index idx_cartoes_credito_tenant_ativo
  on cartoes_credito (tenant_id, ativo);

alter table cartoes_credito enable row level security;

create policy cartoes_credito_select on cartoes_credito
  for select to authenticated
  using (is_tenant_member(tenant_id));

create policy cartoes_credito_insert on cartoes_credito
  for insert to authenticated
  with check (is_tenant_member(tenant_id));

create policy cartoes_credito_update on cartoes_credito
  for update to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

create policy cartoes_credito_delete on cartoes_credito
  for delete to authenticated
  using (is_tenant_member(tenant_id));

grant select, insert, update, delete on cartoes_credito to authenticated;

-- Trigger para manter updated_at
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

-- A função pode já existir; usar create or replace acima é seguro.
create trigger trg_cartoes_credito_updated_at
  before update on cartoes_credito
  for each row execute function set_updated_at();
```

- [ ] **Step 3: Aplicar migration via MCP**

Chamar `mcp__supabase__apply_migration` com o conteúdo do arquivo (name = `forma_pagamento_e_cartoes`).

- [ ] **Step 4: Conferir aplicação**

Executar via `mcp__supabase__execute_sql`:

```sql
-- confere enum
select unnest(enum_range(null::forma_pagamento))::text as v;
-- esperado: pix, transferencia, boleto, cartao_credito

select unnest(enum_range(null::bandeira_cartao))::text as v;
-- esperado: visa, master, elo, amex, hipercard, outra

-- confere tabela + policies + grants
select
  (select count(*) from information_schema.columns where table_name='cartoes_credito') as cols,
  (select count(*) from pg_policies where tablename='cartoes_credito') as policies,
  (select has_table_privilege('authenticated','cartoes_credito','SELECT')) as auth_select;
```

Esperado: `cols=12, policies=4, auth_select=true`.

- [ ] **Step 5: Atualizar `lib/types.ts`**

Adicionar antes da região "Task 012: contas_avulsas" (aproximadamente linha 1447):

```typescript
// ---------- Forma de pagamento e cartões (20/08/2026) ----------

export type FormaPagamento =
  | "pix"
  | "transferencia"
  | "boleto"
  | "cartao_credito";

export const formaPagamentoLabel = (f: FormaPagamento): string =>
  ({
    pix: "PIX",
    transferencia: "Transferência",
    boleto: "Boleto",
    cartao_credito: "Cartão de Crédito",
  })[f];

export type BandeiraCartao =
  | "visa"
  | "master"
  | "elo"
  | "amex"
  | "hipercard"
  | "outra";

export const bandeiraCartaoLabel = (b: BandeiraCartao): string =>
  ({
    visa: "Visa",
    master: "Mastercard",
    elo: "Elo",
    amex: "American Express",
    hipercard: "Hipercard",
    outra: "Outra",
  })[b];

export interface CartaoCredito {
  id: string;
  tenant_id: string;
  nome: string;
  banco: string;
  bandeira: BandeiraCartao;
  ultimos_4_digitos: string;
  dono: string;
  dia_vencimento_fatura: number;
  ativo: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}
```

- [ ] **Step 6: Verificar typecheck e lint**

Rodar `npm run typecheck && npm run lint`. Ambos devem passar.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260820000001_forma_pagamento_e_cartoes.sql lib/types.ts
git commit -m "feat(cadastros): enum forma_pagamento e tabela cartoes_credito"
```

---

## Task 2: Cadastro `/cadastros/cartoes-credito`

**Files:**
- Create: `lib/validations/cartao-credito.ts`
- Create: `app/(app)/cadastros/cartoes-credito/page.tsx`
- Create: `app/(app)/cadastros/cartoes-credito/cartoes-list.tsx`
- Create: `app/(app)/cadastros/cartoes-credito/cartao-drawer.tsx`
- Create: `app/(app)/cadastros/cartoes-credito/actions.ts`
- Modify: `app/(app)/cadastros/page.tsx` (adicionar card "Cartões de crédito")

**Interfaces:**
- Consumes: `CartaoCredito`, `BandeiraCartao`, `bandeiraCartaoLabel` (Task 1).
- Produces:
  - `criarCartaoSchema`, `atualizarCartaoSchema` (Zod).
  - Server actions `criarCartao(input)`, `atualizarCartao(input)`, `inativarCartao({id})`, `reativarCartao({id})` — todas retornam `{ ok: true } | { ok: false; message: string }`.

- [ ] **Step 1: Criar validation Zod**

Arquivo: `lib/validations/cartao-credito.ts`

```typescript
import { z } from "zod";

const bandeiraEnum = z.enum([
  "visa",
  "master",
  "elo",
  "amex",
  "hipercard",
  "outra",
]);

export const criarCartaoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "Nome muito curto.")
    .max(80, "Nome muito longo."),
  banco: z.string().trim().min(2, "Informe o banco.").max(80),
  bandeira: bandeiraEnum,
  ultimos_4_digitos: z
    .string()
    .regex(/^\d{4}$/, "Digite exatamente 4 números."),
  dono: z.string().trim().min(2, "Informe o dono do cartão.").max(80),
  dia_vencimento_fatura: z
    .number({ invalid_type_error: "Informe o dia do vencimento." })
    .int("Deve ser um número inteiro.")
    .min(1, "Dia entre 1 e 31.")
    .max(31, "Dia entre 1 e 31."),
});

export const atualizarCartaoSchema = criarCartaoSchema.extend({
  id: z.string().uuid(),
});

export type CriarCartaoInput = z.infer<typeof criarCartaoSchema>;
export type AtualizarCartaoInput = z.infer<typeof atualizarCartaoSchema>;
```

- [ ] **Step 2: Criar server actions**

Arquivo: `app/(app)/cadastros/cartoes-credito/actions.ts`

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  criarCartaoSchema,
  atualizarCartaoSchema,
} from "@/lib/validations/cartao-credito";

type Result = { ok: true } | { ok: false; message: string };

async function checarGate(): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof requireSession>>; supabase: ReturnType<typeof createClient> }
  | { ok: false; message: string }
> {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    return { ok: false, message: "Apenas admin ou financeiro pode gerenciar cartões." };
  }
  return { ok: true, session, supabase: createClient() };
}

export async function criarCartao(input: unknown): Promise<Result> {
  const parsed = criarCartaoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGate();
  if (!gate.ok) return gate;

  const { data, error } = await gate.supabase
    .from("cartoes_credito")
    .insert({
      tenant_id: gate.session.activeTenant.id,
      ...parsed.data,
      created_by: gate.session.profile.id,
    })
    .select("id, nome")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "Já existe um cartão com esse nome." };
    }
    return { ok: false, message: `Falha ao criar cartão: ${error.message}` };
  }

  await logAuditEvent({
    acao: "cartao_credito.criado",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "cartao_credito",
    entidadeId: data.id,
    metadata: {
      nome: parsed.data.nome,
      banco: parsed.data.banco,
      bandeira: parsed.data.bandeira,
      ultimos_4_digitos: parsed.data.ultimos_4_digitos,
    },
  });

  revalidatePath("/cadastros/cartoes-credito");
  revalidatePath("/cadastros");
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}

export async function atualizarCartao(input: unknown): Promise<Result> {
  const parsed = atualizarCartaoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGate();
  if (!gate.ok) return gate;
  const { id, ...patch } = parsed.data;

  const { error } = await gate.supabase
    .from("cartoes_credito")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", gate.session.activeTenant.id);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "Já existe um cartão com esse nome." };
    }
    return { ok: false, message: `Falha ao atualizar cartão: ${error.message}` };
  }

  await logAuditEvent({
    acao: "cartao_credito.atualizado",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "cartao_credito",
    entidadeId: id,
    metadata: { diff: patch },
  });

  revalidatePath("/cadastros/cartoes-credito");
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}

export async function inativarCartao(input: { id: string }): Promise<Result> {
  const gate = await checarGate();
  if (!gate.ok) return gate;

  const { error } = await gate.supabase
    .from("cartoes_credito")
    .update({ ativo: false })
    .eq("id", input.id)
    .eq("tenant_id", gate.session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao inativar: ${error.message}` };

  await logAuditEvent({
    acao: "cartao_credito.inativado",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "cartao_credito",
    entidadeId: input.id,
    metadata: {},
  });

  revalidatePath("/cadastros/cartoes-credito");
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}

export async function reativarCartao(input: { id: string }): Promise<Result> {
  const gate = await checarGate();
  if (!gate.ok) return gate;

  const { error } = await gate.supabase
    .from("cartoes_credito")
    .update({ ativo: true })
    .eq("id", input.id)
    .eq("tenant_id", gate.session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao reativar: ${error.message}` };

  await logAuditEvent({
    acao: "cartao_credito.reativado",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "cartao_credito",
    entidadeId: input.id,
    metadata: {},
  });

  revalidatePath("/cadastros/cartoes-credito");
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}
```

- [ ] **Step 3: Criar `cartao-drawer.tsx` (client)**

Seguir padrão de `app/(app)/cadastros/contas-bancarias/conta-bancaria-drawer.tsx` — leia esse arquivo primeiro para copiar estrutura. Layout: React Hook Form + shadcn Drawer + inputs para nome/banco/dono, Select para bandeira (6 opções), input numérico para dia (1-31, com atributos `type="number" min="1" max="31" step="1"`), input com `maxLength=4` e `inputMode="numeric"` para últimos 4 dígitos. Submit chama `criarCartao` ou `atualizarCartao`; erros em toast; sucesso fecha o drawer.

- [ ] **Step 4: Criar `cartoes-list.tsx` (client)**

Seguir padrão de `app/(app)/cadastros/contas-bancarias/contas-bancarias-list.tsx`. Colunas: **Nome** (com dono em cinza abaixo), **Banco / Bandeira**, **•••• dígitos**, **Vencimento fatura** ("Todo dia X"), **Status** (badge "Ativo"/"Inativo"), **Ações** (editar → abre drawer; inativar/reativar → confirmação). Botão "Novo cartão" no topo direito. Empty state: "Nenhum cartão cadastrado. Cadastre para poder usar como forma de pagamento em PPs, avulsas e recorrências."

- [ ] **Step 5: Criar `page.tsx` (server)**

```typescript
import { redirect } from "next/navigation";
import { CreditCard, ChevronRight } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { CartoesList } from "./cartoes-list";
import type { CartaoCredito } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CartoesCreditoPage() {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/cadastros?reason=sem_permissao");
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("cartoes_credito")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("ativo", { ascending: false })
    .order("nome")
    .returns<CartaoCredito[]>();

  if (error) console.error("[cadastros.cartoes]", error.message);

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/cadastros" className="hover:text-california-red transition-colors">
            Cadastros
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">Cartões de Crédito</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <CreditCard className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Cartões de Crédito</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl text-pretty">
          Cartões usados como forma de pagamento em PPs, contas avulsas e
          recorrências. O dia de vencimento da fatura preenche a data de
          pagamento dos títulos automaticamente.
        </p>
      </header>

      <CartoesList rows={data ?? []} />
    </div>
  );
}
```

- [ ] **Step 6: Adicionar card no hub de cadastros**

Modificar `app/(app)/cadastros/page.tsx`:
- Adicionar import: `CreditCard` do lucide-react.
- Adicionar nova entrada em `Promise.all`:

```typescript
supabase
  .from("cartoes_credito")
  .select("*", { count: "exact", head: true })
  .eq("tenant_id", session.activeTenant.id)
  .eq("ativo", true),
```

Nomear a variável `cartoesCreditoRes`, logar erro no padrão dos outros, e adicionar `<CadastroCard>`:

```tsx
<CadastroCard
  href="/cadastros/cartoes-credito"
  icon={CreditCard}
  title="Cartões de crédito"
  description="Cartões usados como forma de pagamento. O dia da fatura preenche a data de pagamento dos títulos automaticamente."
  count={cartoesCreditoRes.count ?? 0}
/>
```

- [ ] **Step 7: Verificar via typecheck + lint**

Rodar `npm run typecheck && npm run lint`. Ambos devem passar.

- [ ] **Step 8: Smoke manual no browser**

- Rodar `npm run dev`, logar como admin.
- Ir para `/cadastros` — confirmar card "Cartões de crédito" com contagem 0.
- Ir para `/cadastros/cartoes-credito` — confirmar página vazia com botão "Novo cartão".
- Criar cartão: nome "Nubank Antonio", banco "Nubank", bandeira "Master", 4 dígitos "1234", dono "Antonio Pedreira", dia 15. Confirmar aparição na lista + contagem no hub.
- Editar o cartão (mudar dia para 20). Confirmar update.
- Inativar. Confirmar mudança de badge e drop na contagem.
- Reativar. Confirmar recuperação.

- [ ] **Step 9: Commit**

```bash
git add lib/validations/cartao-credito.ts \
        app/\(app\)/cadastros/cartoes-credito/ \
        app/\(app\)/cadastros/page.tsx
git commit -m "feat(cadastros): pagina de cartoes de credito"
```

---

## Task 3: Migration 2 — colunas + constraints nas 3 tabelas

**Files:**
- Create: `supabase/migrations/20260820000002_forma_pagamento_nas_origens.sql`
- Modify: `lib/types.ts` (adicionar 2 campos em `PedidoCompra`, `ContaAvulsa`, `ContaAvulsaRecorrente`)

**Interfaces:**
- Consumes: enum `forma_pagamento`, tabela `cartoes_credito` (Task 1).
- Produces: colunas `forma_pagamento` (nullable) + `cartao_credito_id` (nullable FK) + check constraint `chk_<tabela>_cartao` em cada uma das 3 tabelas + índices parciais.

- [ ] **Step 1: Ler estado atual pelo MCP**

```sql
select column_name from information_schema.columns
where table_name in ('pedidos_compra','contas_avulsas','contas_avulsas_recorrentes')
  and column_name in ('forma_pagamento','cartao_credito_id');
```

Esperado: 0 linhas.

- [ ] **Step 2: Criar migration**

Arquivo: `supabase/migrations/20260820000002_forma_pagamento_nas_origens.sql`

```sql
-- Racional: adiciona forma_pagamento (nullable) e cartao_credito_id
-- (FK opcional) nas 3 tabelas de origem de "Contas a Pagar". Nullable
-- preserva os 10 títulos existentes anteriores a 20/08/2026 — não
-- converter em NOT NULL sem backfill explícito. Check constraint
-- garante coerência: se cartão, exige cartao_credito_id; se não-cartão,
-- exige que ele seja NULL. Índice parcial permite filtro rápido na aba
-- "Títulos a Pagar (Cartão)". Ver spec seções 3.1, 3.2 e 4.2.

alter table pedidos_compra
  add column forma_pagamento forma_pagamento null,
  add column cartao_credito_id uuid null references cartoes_credito(id);

alter table pedidos_compra
  add constraint chk_pp_cartao check (
    (forma_pagamento = 'cartao_credito' and cartao_credito_id is not null)
    or (forma_pagamento is distinct from 'cartao_credito' and cartao_credito_id is null)
  );

comment on column pedidos_compra.forma_pagamento is
  'Nullable para preservar títulos anteriores a 20/08/2026. Não converter em NOT NULL sem backfill explícito.';

alter table contas_avulsas
  add column forma_pagamento forma_pagamento null,
  add column cartao_credito_id uuid null references cartoes_credito(id);

alter table contas_avulsas
  add constraint chk_avulsa_cartao check (
    (forma_pagamento = 'cartao_credito' and cartao_credito_id is not null)
    or (forma_pagamento is distinct from 'cartao_credito' and cartao_credito_id is null)
  );

comment on column contas_avulsas.forma_pagamento is
  'Nullable para preservar títulos anteriores a 20/08/2026. Não converter em NOT NULL sem backfill explícito.';

alter table contas_avulsas_recorrentes
  add column forma_pagamento forma_pagamento null,
  add column cartao_credito_id uuid null references cartoes_credito(id);

alter table contas_avulsas_recorrentes
  add constraint chk_recorrente_cartao check (
    (forma_pagamento = 'cartao_credito' and cartao_credito_id is not null)
    or (forma_pagamento is distinct from 'cartao_credito' and cartao_credito_id is null)
  );

comment on column contas_avulsas_recorrentes.forma_pagamento is
  'Nullable para preservar templates anteriores a 20/08/2026. Não converter em NOT NULL sem backfill explícito.';

-- Índices parciais para o filtro/agrupamento da aba "Títulos a Pagar (Cartão)"
create index idx_pp_cartao
  on pedidos_compra (tenant_id, cartao_credito_id)
  where cartao_credito_id is not null;

create index idx_avulsa_cartao
  on contas_avulsas (tenant_id, cartao_credito_id)
  where cartao_credito_id is not null;

create index idx_recorrente_cartao
  on contas_avulsas_recorrentes (tenant_id, cartao_credito_id)
  where cartao_credito_id is not null;
```

- [ ] **Step 3: Aplicar via MCP**

`mcp__supabase__apply_migration` com name = `forma_pagamento_nas_origens`.

- [ ] **Step 4: Conferir**

```sql
-- Confere colunas
select table_name, column_name, is_nullable
from information_schema.columns
where table_name in ('pedidos_compra','contas_avulsas','contas_avulsas_recorrentes')
  and column_name in ('forma_pagamento','cartao_credito_id')
order by table_name, column_name;
-- esperado: 6 linhas, todas is_nullable=YES

-- Confere constraint funciona
-- Este INSERT deve falhar por causa da check constraint:
insert into contas_avulsas
  (tenant_id, empresa_id, descricao, valor, natureza,
   plano_conta_tipo_id, plano_conta_subtipo_id, criado_por,
   forma_pagamento, cartao_credito_id)
values
  ((select id from tenants limit 1),
   (select id from empresas limit 1),
   'teste', 100, 'saida',
   (select id from plano_contas_tipos limit 1),
   (select id from plano_contas_subtipos limit 1),
   (select id from profiles limit 1),
   'cartao_credito', null);
-- esperado: erro "chk_avulsa_cartao"

-- Confere índices
select indexname from pg_indexes
where tablename in ('pedidos_compra','contas_avulsas','contas_avulsas_recorrentes')
  and indexname like 'idx_%_cartao';
-- esperado: 3 linhas
```

- [ ] **Step 5: Atualizar `lib/types.ts`**

Em `PedidoCompra` (adicionar antes de `created_at`):

```typescript
forma_pagamento: FormaPagamento | null;
cartao_credito_id: string | null;
```

Em `ContaAvulsa` (adicionar após `recorrente_id`):

```typescript
forma_pagamento: FormaPagamento | null;
cartao_credito_id: string | null;
```

Em `ContaAvulsaRecorrente` (adicionar após `data_fim`):

```typescript
forma_pagamento: FormaPagamento | null;
cartao_credito_id: string | null;
```

- [ ] **Step 6: Verificar typecheck + lint**

`npm run typecheck && npm run lint`. Se algum consumidor quebrar por causa de campos novos exigidos em selects, resolver adicionando `null` como fallback nas listagens que ainda não conhecem cartão.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260820000002_forma_pagamento_nas_origens.sql lib/types.ts
git commit -m "feat(financeiro): forma_pagamento e cartao_credito_id nas 3 origens"
```

---

## Task 4: Helper puro `proxima-fatura` (TS + SQL)

**Files:**
- Create: `lib/cartoes/proxima-fatura.ts`
- Create: `supabase/migrations/20260820000003_proxima_fatura_e_materializacao_cartao.sql` — apenas a função SQL (o patch em `gerar_ocorrencias_recorrentes` fica na Task 8).

**Interfaces:**
- Consumes: nada.
- Produces:
  - TS: `proximaFatura(diaVencimento: number, hoje: Date): Date` — retorna próxima ocorrência do `dia` a partir de `hoje` (inclusive).
  - TS: `parcelasParaFatura(diaVencimento: number, hoje: Date, quantidade: number): Date[]` — usa `proximaFatura` para a 1ª e soma N meses para as demais.
  - TS: `formatarISO(d: Date): string` — helper `YYYY-MM-DD`.
  - SQL: `proxima_fatura_cartao(p_cartao_id uuid, p_referencia date default current_date) returns date`.

- [ ] **Step 1: Criar helper TS**

Arquivo: `lib/cartoes/proxima-fatura.ts`

```typescript
/**
 * Calcula a próxima data de vencimento da fatura de um cartão a partir
 * de uma data de referência.
 *
 * Regra: se hoje é dia <= vencimento, retorna dia deste mês; se
 * hoje > vencimento, retorna dia do mês seguinte. Se o dia (>28) não
 * existe no mês alvo, cai no último dia do mês (fev com 28/29, meses
 * com 30, etc), espelhando o comportamento de contas_avulsas_recorrentes.
 *
 * Casos de referência (verificação manual):
 *   proximaFatura(20, 2026-08-05)  → 2026-08-20
 *   proximaFatura(20, 2026-08-20)  → 2026-08-20 (inclusive)
 *   proximaFatura(20, 2026-08-22)  → 2026-09-20
 *   proximaFatura(31, 2026-02-10)  → 2026-02-28 (não bissexto)
 *   proximaFatura(31, 2028-02-10)  → 2028-02-29 (bissexto)
 *   proximaFatura(31, 2026-04-10)  → 2026-04-30
 *   proximaFatura(15, 2026-12-20)  → 2027-01-15 (vira ano)
 */
export function proximaFatura(diaVencimento: number, hoje: Date): Date {
  if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) {
    throw new Error(`dia_vencimento_fatura inválido: ${diaVencimento}`);
  }

  const ano = hoje.getFullYear();
  const mes = hoje.getMonth(); // 0-11
  const diaHoje = hoje.getDate();

  const proximoMes = diaHoje <= diaVencimento ? mes : mes + 1;
  const anoAlvo = proximoMes > 11 ? ano + 1 : ano;
  const mesAlvo = proximoMes > 11 ? 0 : proximoMes;

  const ultimoDiaDoMes = new Date(anoAlvo, mesAlvo + 1, 0).getDate();
  const diaAlvo = Math.min(diaVencimento, ultimoDiaDoMes);

  return new Date(anoAlvo, mesAlvo, diaAlvo);
}

/**
 * Sequência de datas de fatura para parcelas de PP no cartão.
 * 1ª parcela = próxima fatura; 2ª = fatura +1 mês; N = fatura +(N-1) meses.
 * Cada mês respeita a regra do último dia (dia 31 em fev vira 28/29).
 */
export function parcelasParaFatura(
  diaVencimento: number,
  hoje: Date,
  quantidade: number,
): Date[] {
  if (quantidade < 1) return [];
  const primeira = proximaFatura(diaVencimento, hoje);
  const datas: Date[] = [primeira];
  for (let i = 1; i < quantidade; i++) {
    const alvoMes = primeira.getMonth() + i;
    const anoAlvo = primeira.getFullYear() + Math.floor(alvoMes / 12);
    const mesAlvo = ((alvoMes % 12) + 12) % 12;
    const ultimoDia = new Date(anoAlvo, mesAlvo + 1, 0).getDate();
    datas.push(new Date(anoAlvo, mesAlvo, Math.min(diaVencimento, ultimoDia)));
  }
  return datas;
}

export function formatarISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
```

- [ ] **Step 2: Criar função SQL espelho**

Arquivo: `supabase/migrations/20260820000003_proxima_fatura_e_materializacao_cartao.sql`

```sql
-- Racional: função SQL espelho do helper TS lib/cartoes/proxima-fatura.ts.
-- Usada pela RPC gerar_ocorrencias_recorrentes (patch na próxima migration
-- desta feature) para calcular a data de vencimento da fatura na
-- materialização de uma recorrência de cartão. Regra idêntica ao helper
-- TS: se hoje <= dia, retorna dia deste mês; senão dia do mês seguinte;
-- dia > último dia do mês cai no último dia. Ver spec seção 4.3.

create or replace function proxima_fatura_cartao(
  p_cartao_id uuid,
  p_referencia date default current_date
) returns date
language plpgsql
stable
as $$
declare
  v_dia smallint;
  v_ano int;
  v_mes int;
  v_dia_referencia int;
  v_ano_alvo int;
  v_mes_alvo int;
  v_ultimo_dia_alvo int;
  v_dia_alvo int;
begin
  select dia_vencimento_fatura into v_dia
  from cartoes_credito where id = p_cartao_id;

  if v_dia is null then
    raise exception 'cartao_credito não encontrado: %', p_cartao_id;
  end if;

  v_ano := extract(year from p_referencia);
  v_mes := extract(month from p_referencia);
  v_dia_referencia := extract(day from p_referencia);

  if v_dia_referencia <= v_dia then
    v_ano_alvo := v_ano;
    v_mes_alvo := v_mes;
  else
    v_ano_alvo := case when v_mes = 12 then v_ano + 1 else v_ano end;
    v_mes_alvo := case when v_mes = 12 then 1 else v_mes + 1 end;
  end if;

  v_ultimo_dia_alvo := extract(day from
    (date_trunc('month', make_date(v_ano_alvo, v_mes_alvo, 1))
     + interval '1 month - 1 day')::date);

  v_dia_alvo := least(v_dia::int, v_ultimo_dia_alvo);
  return make_date(v_ano_alvo, v_mes_alvo, v_dia_alvo);
end;
$$;

grant execute on function proxima_fatura_cartao(uuid, date) to authenticated;
```

- [ ] **Step 3: Aplicar migration via MCP**

`mcp__supabase__apply_migration` com name = `proxima_fatura_cartao`.

- [ ] **Step 4: Conferir via MCP**

```sql
-- Cria cartão teste
insert into cartoes_credito (tenant_id, nome, banco, bandeira, ultimos_4_digitos, dono, dia_vencimento_fatura)
values ((select id from tenants limit 1), 'TESTE-DELETE-ME', 'X', 'outra', '0000', 'x', 20)
returning id;
-- Anote o UUID retornado; substitua em $CARTAO abaixo.

select
  proxima_fatura_cartao('$CARTAO', '2026-08-05'::date) as caso1,  -- esperado 2026-08-20
  proxima_fatura_cartao('$CARTAO', '2026-08-20'::date) as caso2,  -- esperado 2026-08-20
  proxima_fatura_cartao('$CARTAO', '2026-08-22'::date) as caso3;  -- esperado 2026-09-20

-- Cartão dia 31 para testar fev
update cartoes_credito set dia_vencimento_fatura = 31 where nome = 'TESTE-DELETE-ME';

select
  proxima_fatura_cartao('$CARTAO', '2026-02-10'::date) as fev_normal,     -- esperado 2026-02-28
  proxima_fatura_cartao('$CARTAO', '2028-02-10'::date) as fev_bissexto,   -- esperado 2028-02-29
  proxima_fatura_cartao('$CARTAO', '2026-04-10'::date) as abril,          -- esperado 2026-04-30
  proxima_fatura_cartao('$CARTAO', '2026-12-20'::date) as vira_ano;       -- esperado 2027-01-31

-- Limpar
delete from cartoes_credito where nome = 'TESTE-DELETE-ME';
```

Todas as datas devem bater com o esperado.

- [ ] **Step 5: Verificar helper TS (validação manual em Node)**

Executar em `node --loader tsx --eval` ou script temporário (não commitar):

```bash
npx tsx -e "
import { proximaFatura, parcelasParaFatura, formatarISO } from './lib/cartoes/proxima-fatura';
console.log('caso1:', formatarISO(proximaFatura(20, new Date(2026, 7, 5))));   // 2026-08-20
console.log('caso2:', formatarISO(proximaFatura(20, new Date(2026, 7, 20))));  // 2026-08-20
console.log('caso3:', formatarISO(proximaFatura(20, new Date(2026, 7, 22))));  // 2026-09-20
console.log('fev31:', formatarISO(proximaFatura(31, new Date(2026, 1, 10))));  // 2026-02-28
console.log('bis:',   formatarISO(proximaFatura(31, new Date(2028, 1, 10))));  // 2028-02-29
console.log('abr31:', formatarISO(proximaFatura(31, new Date(2026, 3, 10))));  // 2026-04-30
console.log('ano:',   formatarISO(proximaFatura(15, new Date(2026, 11, 20)))); // 2027-01-15
console.log('parc:',  parcelasParaFatura(20, new Date(2026, 7, 5), 3).map(formatarISO));
// 2026-08-20, 2026-09-20, 2026-10-20
"
```

Conferir manualmente que a saída bate com os comentários.

- [ ] **Step 6: Verificar typecheck + lint**

`npm run typecheck && npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add lib/cartoes/proxima-fatura.ts \
        supabase/migrations/20260820000003_proxima_fatura_e_materializacao_cartao.sql
git commit -m "feat(cartoes): helper de proxima fatura em TS e SQL"
```

---

## Task 5: Componente `FormaPagamentoField`

**Files:**
- Create: `components/financeiro/forma-pagamento-field.tsx`

**Interfaces:**
- Consumes: `FormaPagamento`, `formaPagamentoLabel`, `bandeiraCartaoLabel` (Task 1), helper `proximaFatura`, `formatarISO` (Task 4).
- Produces:
  ```typescript
  interface CartaoOption {
    id: string;
    nome: string;
    banco: string;
    bandeira: BandeiraCartao;
    ultimos_4_digitos: string;
    dia_vencimento_fatura: number;
  }
  interface FormaPagamentoValue {
    forma_pagamento: FormaPagamento | null;
    cartao_credito_id: string | null;
  }
  interface FormaPagamentoFieldProps {
    cartoes: CartaoOption[];
    value: FormaPagamentoValue;
    onChange: (v: FormaPagamentoValue, opts?: { dataPagamentoSugerida?: string }) => void;
    disabled?: boolean;
    obrigatorio?: boolean;  // padrão true; marca aria-required
  }
  export function FormaPagamentoField(props: FormaPagamentoFieldProps): JSX.Element;
  ```

- [ ] **Step 1: Ler `contas-bancarias-list.tsx` e `conta-avulsa-drawer.tsx`**

Confirmar padrão visual: espaçamento (`space-y-2`), Label + Select + fallback de erro. Componente deve compor bem quando usado em grid `md:grid-cols-2`.

- [ ] **Step 2: Criar componente**

Arquivo: `components/financeiro/forma-pagamento-field.tsx`

```typescript
"use client";

import { Fragment, useMemo } from "react";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { proximaFatura, formatarISO } from "@/lib/cartoes/proxima-fatura";
import {
  type FormaPagamento,
  type BandeiraCartao,
  formaPagamentoLabel,
  bandeiraCartaoLabel,
} from "@/lib/types";

export interface CartaoOption {
  id: string;
  nome: string;
  banco: string;
  bandeira: BandeiraCartao;
  ultimos_4_digitos: string;
  dia_vencimento_fatura: number;
}

export interface FormaPagamentoValue {
  forma_pagamento: FormaPagamento | null;
  cartao_credito_id: string | null;
}

interface Props {
  cartoes: CartaoOption[];
  value: FormaPagamentoValue;
  /**
   * onChange recebe o valor novo. Se a mudança selecionar um cartão,
   * também recebe a data ISO sugerida (`dataPagamentoSugerida`) — o
   * consumidor decide se auto-preenche o campo de data do form.
   */
  onChange: (
    v: FormaPagamentoValue,
    opts?: { dataPagamentoSugerida?: string },
  ) => void;
  disabled?: boolean;
  obrigatorio?: boolean;
  /** Erro do formulário, exibido abaixo do campo. */
  error?: string;
}

const FORMAS: FormaPagamento[] = ["pix", "transferencia", "boleto", "cartao_credito"];
const NENHUM = "__nenhum__";

export function FormaPagamentoField({
  cartoes,
  value,
  onChange,
  disabled,
  obrigatorio = true,
  error,
}: Props) {
  const cartoesAtivos = useMemo(() => cartoes, [cartoes]);

  function handleFormaChange(nova: FormaPagamento) {
    if (nova !== "cartao_credito") {
      onChange({ forma_pagamento: nova, cartao_credito_id: null });
      return;
    }
    // Ao virar cartão: se só há 1 cartão, seleciona automaticamente.
    if (cartoesAtivos.length === 1) {
      const unico = cartoesAtivos[0];
      const dia = unico.dia_vencimento_fatura;
      const data = formatarISO(proximaFatura(dia, new Date()));
      onChange(
        { forma_pagamento: "cartao_credito", cartao_credito_id: unico.id },
        { dataPagamentoSugerida: data },
      );
      return;
    }
    onChange({ forma_pagamento: "cartao_credito", cartao_credito_id: null });
  }

  function handleCartaoChange(cartaoId: string) {
    if (cartaoId === NENHUM) {
      onChange({ forma_pagamento: "cartao_credito", cartao_credito_id: null });
      return;
    }
    const c = cartoesAtivos.find((c) => c.id === cartaoId);
    if (!c) return;
    const data = formatarISO(proximaFatura(c.dia_vencimento_fatura, new Date()));
    onChange(
      { forma_pagamento: "cartao_credito", cartao_credito_id: cartaoId },
      { dataPagamentoSugerida: data },
    );
  }

  const mostraCartao = value.forma_pagamento === "cartao_credito";
  const semCartoes = mostraCartao && cartoesAtivos.length === 0;

  return (
    <div className="space-y-2">
      <Label>Forma de pagamento{obrigatorio ? " *" : ""}</Label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Select
          value={value.forma_pagamento ?? undefined}
          onValueChange={(v) => handleFormaChange(v as FormaPagamento)}
          disabled={disabled}
        >
          <SelectTrigger aria-required={obrigatorio}>
            <SelectValue placeholder="Selecione a forma" />
          </SelectTrigger>
          <SelectContent>
            {FORMAS.map((f) => (
              <SelectItem key={f} value={f}>
                {formaPagamentoLabel(f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {mostraCartao && !semCartoes && (
          <Select
            value={value.cartao_credito_id ?? NENHUM}
            onValueChange={handleCartaoChange}
            disabled={disabled}
          >
            <SelectTrigger aria-required>
              <SelectValue placeholder="Selecione o cartão" />
            </SelectTrigger>
            <SelectContent>
              {cartoesAtivos.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome} · {bandeiraCartaoLabel(c.bandeira)} · ••••{c.ultimos_4_digitos}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {semCartoes && (
        <p className="text-xs text-muted-foreground">
          Nenhum cartão cadastrado.{" "}
          <Link
            href="/cadastros/cartoes-credito"
            target="_blank"
            className="text-california-red underline hover:no-underline"
          >
            Cadastrar cartão
          </Link>
          .
        </p>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Verificar typecheck + lint**

`npm run typecheck && npm run lint`. Se `@/components/ui/select` ou `@/components/ui/label` divergirem, ajustar imports para o padrão do projeto (checar `components/ui/`).

- [ ] **Step 4: Commit**

```bash
git add components/financeiro/forma-pagamento-field.tsx
git commit -m "feat(financeiro): componente FormaPagamentoField compartilhado"
```

---

## Task 6: Integração no drawer de conta avulsa

**Files:**
- Modify: `lib/validations/conta-avulsa.ts`
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts`
- Modify: `app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx` (fetch `cartoes` ativos + passa como prop para o list, que repassa ao drawer)

**Interfaces:**
- Consumes: `FormaPagamentoField`, `CartaoOption` (Task 5); helper `proximaFatura` (Task 4).
- Produces: `criarContaAvulsaSchema` e `editarContaAvulsaSchema` estendidos com `forma_pagamento` + `cartao_credito_id` + refinement (cartão exige cartão + data futura).

- [ ] **Step 1: Estender schemas Zod**

Modificar `lib/validations/conta-avulsa.ts`:

Adicionar após o `rateioSchema`, antes do `criarContaAvulsaSchema`:

```typescript
export const formaPagamentoEnum = z.enum([
  "pix",
  "transferencia",
  "boleto",
  "cartao_credito",
]);
```

Adicionar dentro do `.object({...})` do `criarContaAvulsaSchema` (antes de `anexos`):

```typescript
  forma_pagamento: formaPagamentoEnum,
  cartao_credito_id: z
    .string()
    .uuid()
    .nullable()
    .or(z.literal("").transform(() => null)),
```

Adicionar `.superRefine` no final do `criarContaAvulsaSchema` (envelopando o `.object`):

```typescript
export const criarContaAvulsaSchema = z.object({
  /* ... campos existentes + forma_pagamento + cartao_credito_id ... */
}).superRefine((data, ctx) => {
  if (data.forma_pagamento === "cartao_credito") {
    if (!data.cartao_credito_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selecione o cartão de crédito.",
        path: ["cartao_credito_id"],
      });
    }
    if (data.data_prevista_pagamento) {
      const hoje = new Date().toISOString().slice(0, 10);
      if (data.data_prevista_pagamento < hoje) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Cartão exige data de pagamento futura (data da fatura).",
          path: ["data_prevista_pagamento"],
        });
      }
    }
  } else if (data.cartao_credito_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cartão só pode ser informado quando forma = cartão de crédito.",
      path: ["cartao_credito_id"],
    });
  }
});
```

Aplicar o mesmo refinement em `editarContaAvulsaSchema`. Como este usa `.omit`, transformar em:

```typescript
export const editarContaAvulsaSchema = criarContaAvulsaSchema.innerType()
  .omit({ empresa_id: true, anexos: true })
  .superRefine(/* mesmo refinement */);
```

Alternativa mais simples se `.innerType()` complicar: duplicar o corpo do object + o refinement no `editarContaAvulsaSchema`. Escolher o que passa no typecheck sem alarde.

- [ ] **Step 2: Atualizar action `criarContaAvulsa`**

Em `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts`, no ponto onde constrói o payload do INSERT em `contas_avulsas`, incluir os 2 campos novos:

```typescript
.insert({
  /* ... campos existentes ... */
  forma_pagamento: parsed.data.forma_pagamento,
  cartao_credito_id: parsed.data.cartao_credito_id,
})
```

Fazer o mesmo em `editarContaAvulsa` (update). Metadata do audit event pode ganhar `forma_pagamento` e `cartao_credito_id` para rastro.

- [ ] **Step 3: Modificar `page.tsx` — fetch de cartões**

Em `app/(app)/financeiro/contas-a-pagar/page.tsx`, adicionar mais uma consulta ao `Promise.all`:

```typescript
supabase
  .from("cartoes_credito")
  .select("id, nome, banco, bandeira, ultimos_4_digitos, dia_vencimento_fatura")
  .eq("tenant_id", session.activeTenant.id)
  .eq("ativo", true)
  .order("nome"),
```

Nomear `cartoesRes`. Adicionar log de erro no padrão.

Passar `cartoes={cartoesRes.data ?? []}` para `<TitulosPagarList>` (tanto o modo "a_pagar" quanto "pagos", no futuro será útil também). Passar para `<RecorrentesList>` também.

- [ ] **Step 4: Integrar `FormaPagamentoField` no drawer de avulsa**

Ler `conta-avulsa-drawer.tsx` para entender estrutura atual. Adicionar prop `cartoes: CartaoOption[]` (propagada pela `TitulosPagarList` que agora recebe cartões).

No form:
- Adicionar `forma_pagamento: null` e `cartao_credito_id: null` no `defaultValues` (edição herda do registro).
- Registrar controle via `useController` do RHF ou usando `<Controller>` para os 2 campos.
- Inserir `<FormaPagamentoField>` entre "Empresa" e "Descrição" (topo do form).
- No `onChange` do field, se `dataPagamentoSugerida` estiver presente E `forma === 'cartao_credito'`, chamar `setValue("data_prevista_pagamento", dataPagamentoSugerida)`.
- No submit, incluir os 2 campos no payload passado à action.

- [ ] **Step 5: Verificar typecheck + lint**

`npm run typecheck && npm run lint`.

- [ ] **Step 6: Smoke manual**

`npm run dev`. Ir para `/financeiro/contas-a-pagar`, aba "Títulos a Pagar":
- Clicar "+ Lançamento Avulso" (ou o botão equivalente na aba).
- Selecionar "Cartão de Crédito" na nova seção → deve aparecer combobox de cartão. Só há 1 cartão cadastrado da Task 2 → deve auto-selecionar e preencher `data_prevista_pagamento` com a próxima fatura.
- Preencher restante e salvar. Confirmar no banco:
```sql
select forma_pagamento, cartao_credito_id, data_prevista_pagamento
from contas_avulsas order by created_at desc limit 1;
```
- Criar outra avulsa com forma = "PIX", sem cartão. Verificar que `cartao_credito_id` fica NULL.
- Editar a primeira avulsa mudando forma para "Boleto" → confirma que `cartao_credito_id` volta a NULL (check constraint aceita).

- [ ] **Step 7: Commit**

```bash
git add lib/validations/conta-avulsa.ts \
        app/\(app\)/financeiro/contas-a-pagar/actions-avulsas.ts \
        app/\(app\)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx \
        app/\(app\)/financeiro/contas-a-pagar/page.tsx
git commit -m "feat(financeiro): forma de pagamento no drawer de conta avulsa"
```

---

## Task 7: Integração no form de emissão de PP

**Files:**
- Modify: form de emissão de PP (mapear em passo 1)
- Modify: `app/(app)/jobs/[jobId]/realizado/actions-pp.ts` — action `emitirPedidoCompra` (ou nome equivalente)
- Modify: Zod schema associado (provavelmente no mesmo `actions-pp.ts` ou em `lib/validations/pedidos-compra.ts` — mapear)
- Modify: se o form live em `app/(app)/jobs/[jobId]/pps/*`, aceitar `cartoes` via props do server component pai

**Interfaces:**
- Consumes: `FormaPagamentoField`, helper `parcelasParaFatura`, `formatarISO`.
- Produces: `pedidos_compra` criado com `forma_pagamento` e `cartao_credito_id` preenchidos; parcelas com `data_vencimento` (e a `data_pagamento` derivada, se aplicável) já refletindo a fatura +N meses.

- [ ] **Step 1: Mapear o form de emissão de PP**

Rodar Grep para achar onde a PP é criada pela UI:

```
Grep pattern: emitirPedidoCompra|criarPedidoCompra|pedido_compra.*insert
```

Ler o componente client responsável pelo form de emissão (provavelmente `app/(app)/jobs/[jobId]/pps/*` ou similar). Identificar onde parcelas são calculadas.

- [ ] **Step 2: Estender schema Zod da PP**

Adicionar `forma_pagamento: formaPagamentoEnum` e `cartao_credito_id: uuid nullable` no schema. Aplicar o mesmo `superRefine` da Task 6 (cartão exige cartão + data futura para cada parcela quando forma = cartão).

- [ ] **Step 3: Atualizar server action de emissão**

Em `actions-pp.ts`, no INSERT em `pedidos_compra`, incluir os 2 campos. Ao inserir as parcelas em `pedidos_compra_parcelas`, se `forma_pagamento === 'cartao_credito'`, calcular `data_vencimento` de cada parcela via `parcelasParaFatura(cartao.dia_vencimento_fatura, hoje, quantidade_parcelas)`. Isso exige buscar o `dia_vencimento_fatura` do cartão dentro da action (SELECT em `cartoes_credito`).

- [ ] **Step 4: Integrar `FormaPagamentoField` no form da PP**

- Adicionar prop `cartoes: CartaoOption[]` no componente client do form (server component pai busca).
- Inserir o field antes da seção de parcelas.
- Ao selecionar cartão, se o form já tem `quantidade_parcelas` definida, chamar `parcelasParaFatura` e preencher as datas de cada parcela via `setValue` nas linhas correspondentes.
- Ao mudar `quantidade_parcelas` estando com cartão selecionado, recalcular.
- Cada linha de parcela permite editar a data individualmente (não bloquear).

- [ ] **Step 5: Buscar cartões ativos no server component pai**

Adicionar SELECT em `cartoes_credito` no server component que renderiza o form de PP (mesmo padrão da Task 6). Passar `cartoes` como prop.

- [ ] **Step 6: Verificar typecheck + lint**

`npm run typecheck && npm run lint`.

- [ ] **Step 7: Smoke manual**

- Abrir um job, emitir PP com forma = "Cartão de Crédito", 3 parcelas, cartão do dia 20.
- Confirmar que as 3 datas de parcelas mostram a fatura de agosto/setembro/outubro (dependendo da data corrente).
- Editar uma das datas manualmente → salva a data editada.
- Emitir uma PP com forma = "PIX" → cartão continua sem opção.
- Consultar via SQL:
```sql
select forma_pagamento, cartao_credito_id, quantidade,
  array_agg(p.data_vencimento order by p.numero) as datas_parcelas
from pedidos_compra pc
join pedidos_compra_parcelas p on p.pedido_compra_id = pc.id
where pc.created_at > now() - interval '5 minutes'
group by pc.id, forma_pagamento, cartao_credito_id, quantidade;
```

- [ ] **Step 8: Commit**

```bash
git add [arquivos alterados desta task]
git commit -m "feat(financeiro): forma de pagamento na emissao de PP"
```

---

## Task 8: Integração no drawer de recorrência + patch em `gerar_ocorrencias_recorrentes`

**Files:**
- Modify: drawer de recorrência em `app/(app)/financeiro/contas-a-pagar/` (mapear em passo 1)
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-recorrentes.ts`
- Modify: `lib/validations/conta-recorrente.ts` (ou o nome equivalente — mapear)
- Modify: `supabase/migrations/20260820000003_proxima_fatura_e_materializacao_cartao.sql` — adicionar patch na função `gerar_ocorrencias_recorrentes` **APENAS SE a Task 4 ainda não foi aplicada** (senão criar nova migration `20260820000005_gerar_ocorrencias_cartao.sql`)

**Interfaces:**
- Consumes: `FormaPagamentoField`, `proximaFatura` (para preview no drawer).
- Produces: template de recorrência com `forma_pagamento` + `cartao_credito_id`; materialização copia esses 2 campos e recalcula `data_prevista_pagamento` para a próxima fatura no momento da geração.

- [ ] **Step 1: Mapear drawer de recorrência**

Grep por `conta-recorrente-drawer` ou similar em `app/(app)/financeiro/contas-a-pagar/`. Ler `conta-recorrente-drawer.tsx` (se existir) ou o arquivo referenciado por `RecorrentesList`.

- [ ] **Step 2: Ler `gerar_ocorrencias_recorrentes` atual**

Via MCP:

```sql
select prosrc from pg_proc where proname = 'gerar_ocorrencias_recorrentes';
```

Confirmar como faz o INSERT em `contas_avulsas`.

- [ ] **Step 3: Nova migration com patch**

Como a Task 4 já foi commitada e aplicada, criar migration nova. Arquivo: `supabase/migrations/20260820000005_gerar_ocorrencias_cartao.sql`

```sql
-- Racional: quando o template de recorrência tem forma_pagamento=cartao_credito,
-- a ocorrência materializada deve (1) herdar forma_pagamento e cartao_credito_id
-- do template, e (2) ter data_prevista_pagamento recalculada pela função
-- proxima_fatura_cartao no momento da geração — não usar a proxima_data do
-- template, que representa o ciclo do template e não a data da fatura.
-- Ver spec seção 3.4.

create or replace function gerar_ocorrencias_recorrentes()
returns int
language plpgsql
as $$
declare
  /* ... variáveis originais da função ... */
  v_data_pagamento date;
begin
  /* Ler prosrc atual e preservar toda a lógica de:
     - iterar templates ativos com proxima_data <= current_date
     - inserir em contas_avulsas
     - avançar proxima_data conforme frequência
     Só mudar o INSERT: copiar forma_pagamento e cartao_credito_id do template;
     se cartão, sobrescrever data_prevista_pagamento com proxima_fatura_cartao. */

  for /* ... loop original ... */ loop
    if template.forma_pagamento = 'cartao_credito' then
      v_data_pagamento := proxima_fatura_cartao(template.cartao_credito_id, current_date);
    else
      v_data_pagamento := template.proxima_data;
    end if;

    insert into contas_avulsas
      (tenant_id, empresa_id, descricao, valor, natureza,
       data_prevista_pagamento, data_pagamento,
       fornecedor_id, cliente_id, job_id,
       plano_conta_tipo_id, plano_conta_subtipo_id,
       recorrente_id, status, criado_por,
       forma_pagamento, cartao_credito_id)
    values
      (template.tenant_id, template.empresa_id, template.descricao, template.valor,
       'saida', v_data_pagamento, v_data_pagamento,
       template.fornecedor_id, template.cliente_id, template.job_id,
       template.plano_conta_tipo_id, template.plano_conta_subtipo_id,
       template.id, 'aprovada', template.criado_por,
       template.forma_pagamento, template.cartao_credito_id);

    /* ... resto original: avançar proxima_data ... */
  end loop;

  return v_inseridas;
end;
$$;
```

**IMPORTANTE**: preservar TODA a lógica original da função. Só adicionar as 2 colunas ao INSERT e o branch condicional para `v_data_pagamento`. Se o INSERT original omite `data_pagamento` (deixa NULL e um trigger preenche), respeitar isso.

- [ ] **Step 4: Aplicar migration via MCP**

`mcp__supabase__apply_migration` com name = `gerar_ocorrencias_cartao`.

- [ ] **Step 5: Estender schema Zod da recorrência**

Mesmo padrão da Task 6: adicionar `forma_pagamento`, `cartao_credito_id` e `superRefine` (cartão exige cartão; sem exigência de data futura porque `proxima_data` do template é interna).

- [ ] **Step 6: Atualizar action `criarContaRecorrente` (e edit)**

Em `actions-recorrentes.ts`, INSERT/UPDATE em `contas_avulsas_recorrentes` inclui os 2 campos novos.

- [ ] **Step 7: Integrar `FormaPagamentoField` no drawer da recorrência**

- Prop `cartoes: CartaoOption[]` (repassada pela `RecorrentesList`, alimentada em `page.tsx` na Task 6).
- Field antes de "Frequência".
- Se cartão selecionado, mostrar aviso: "Cada ocorrência será agendada para a próxima fatura do cartão na data da geração pelo cron."
- Não preencher automaticamente `dia_do_mes`/`dia_quinzena_*` — o template continua tendo sua própria cadência (que dispara o cron); a data da ocorrência é calculada pela função SQL.

- [ ] **Step 8: Verificar typecheck + lint**

`npm run typecheck && npm run lint`.

- [ ] **Step 9: Smoke manual**

- Criar recorrência mensal dia 10, forma = "Cartão de Crédito", cartão dia 20 (o cadastrado na Task 2).
- Editar `proxima_data` do template no banco para hoje-1 para forçar materialização:
```sql
update contas_avulsas_recorrentes set proxima_data = current_date - 1
where descricao = 'sua recorrência de teste';
```
- Executar `select gerar_ocorrencias_recorrentes();` via MCP.
- Verificar em `contas_avulsas` que a ocorrência tem `forma_pagamento = 'cartao_credito'`, `cartao_credito_id` = do cartão, `data_prevista_pagamento` = próxima fatura (20 do mês corrente ou próximo).
- Criar recorrência mensal SEM cartão, mesmo processo, e confirmar que `data_prevista_pagamento` = `proxima_data` do template (comportamento original preservado).

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20260820000005_gerar_ocorrencias_cartao.sql \
        [arquivos TS alterados]
git commit -m "feat(financeiro): forma de pagamento nas recorrencias com materializacao correta"
```

---

## Task 9: RPC de baixa em lote + server action

**Files:**
- Create: `supabase/migrations/20260820000004_baixa_lote_cartao.sql`
- Create: `app/(app)/financeiro/contas-a-pagar/actions-cartao.ts`

**Interfaces:**
- Consumes: RPCs existentes `dar_baixa_pp_parcela`, `dar_baixa_avulsa_com_plano`; helper `logAuditEvent`.
- Produces:
  - SQL: `dar_baixa_lote_cartao(p_titulos jsonb, p_pago_em date, p_conta_bancaria_id uuid, p_plano_conta_tipo_id uuid, p_plano_conta_subtipo_id uuid, p_criado_por uuid) returns uuid[]`.
  - TS: `darBaixaLoteCartao(input)` → `Result` (padrão do projeto).

- [ ] **Step 1: Criar migration**

Arquivo: `supabase/migrations/20260820000004_baixa_lote_cartao.sql`

```sql
-- Racional: baixa em lote da fatura do cartão. Recebe array de títulos
-- (misto de origens: pp e avulsa/recorrencia) e chama as RPCs de baixa
-- individuais dentro de uma única transação. Falha em qualquer item
-- aborta todos — a fatura é uma unidade. Reaproveita as constraints
-- uniques de baixa existentes. Ver spec seções 3.7 e 4.4.

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
    else
      raise exception 'origem desconhecida: %', v_origem;
    end if;

    v_ids := v_ids || v_lanc;
  end loop;

  return v_ids;
end;
$$;

grant execute on function
  dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid)
  to authenticated;
```

- [ ] **Step 2: Aplicar migration via MCP**

`mcp__supabase__apply_migration` com name = `baixa_lote_cartao`.

- [ ] **Step 3: Conferir**

```sql
select proname, pronargs from pg_proc
where proname = 'dar_baixa_lote_cartao';
-- esperado: 1 linha, pronargs=6

select has_function_privilege(
  'authenticated',
  'dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid)',
  'EXECUTE'
) as pode_executar;
-- esperado: true
```

- [ ] **Step 4: Criar server action**

Arquivo: `app/(app)/financeiro/contas-a-pagar/actions-cartao.ts`

```typescript
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Result = { ok: true; lancamentos: string[] } | { ok: false; message: string };

const tituloSchema = z.object({
  origem: z.enum(["pp", "avulso", "recorrencia"]),
  id: z.string().uuid(),
});

const baixaLoteSchema = z.object({
  cartao_credito_id: z.string().uuid("Selecione o cartão."),
  titulos: z.array(tituloSchema).min(1, "Selecione ao menos um título."),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data em YYYY-MM-DD."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
  plano_conta_tipo_id: z.string().uuid("Selecione o tipo do plano de contas."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo do plano de contas."),
});

export async function darBaixaLoteCartao(input: unknown): Promise<Result> {
  const parsed = baixaLoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const d = parsed.data;

  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "cartao_credito",
      entidadeId: d.cartao_credito_id,
      metadata: { acao_tentada: "contas_pagar.baixa_lote_cartao", motivo: "sem_permissao_financeira" },
    });
    return { ok: false, message: "Apenas admin ou financeiro pode dar baixa." };
  }

  const supabase = createClient();

  // Buscar dados do cartão (para audit metadata) e validar mesmo tenant.
  const { data: cartao, error: eCartao } = await supabase
    .from("cartoes_credito")
    .select("nome")
    .eq("id", d.cartao_credito_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (eCartao || !cartao) {
    return { ok: false, message: "Cartão não encontrado." };
  }

  const { data: ids, error } = await supabase.rpc("dar_baixa_lote_cartao", {
    p_titulos: d.titulos,
    p_pago_em: d.pago_em,
    p_conta_bancaria_id: d.conta_bancaria_id,
    p_plano_conta_tipo_id: d.plano_conta_tipo_id,
    p_plano_conta_subtipo_id: d.plano_conta_subtipo_id,
    p_criado_por: session.profile.id,
  });

  if (error) {
    console.error("[cartao.baixa_lote]", error.message);
    // Mapeia mensagens conhecidas (constraints unique de baixa)
    if (error.message.includes("uniq_baixa_ativa_por_parcela")) {
      return { ok: false, message: "Um dos títulos já tem baixa registrada." };
    }
    if (error.message.includes("uniq_baixa_ativa_por_avulsa")) {
      return { ok: false, message: "Um dos lançamentos já tem baixa registrada." };
    }
    return { ok: false, message: `Falha ao baixar lote: ${error.message}` };
  }

  await logAuditEvent({
    acao: "contas_pagar.baixa_lote_cartao",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cartao_credito",
    entidadeId: d.cartao_credito_id,
    metadata: {
      cartao_nome: cartao.nome,
      quantidade_titulos: d.titulos.length,
      titulos: d.titulos,
      pago_em: d.pago_em,
      conta_bancaria_id: d.conta_bancaria_id,
      lancamentos: ids,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro");

  return { ok: true, lancamentos: (ids as string[]) ?? [] };
}
```

- [ ] **Step 5: Verificar typecheck + lint**

`npm run typecheck && npm run lint`.

- [ ] **Step 6: Smoke via SQL (RPC direto)**

Criar 2 avulsas de cartão diferentes (via UI ou SQL). Depois:

```sql
select dar_baixa_lote_cartao(
  '[
     {"origem":"avulso","id":"<uuid da avulsa 1>"},
     {"origem":"avulso","id":"<uuid da avulsa 2>"}
   ]'::jsonb,
  current_date,
  '<uuid conta bancaria>',
  '<uuid plano tipo>',
  '<uuid plano subtipo>',
  '<uuid do seu profile>'
);
-- esperado: array com 2 UUIDs

select id, status, pago_em from contas_avulsas
where id in ('<uuid avulsa 1>', '<uuid avulsa 2>');
-- esperado: ambas status='baixada'

select count(*) from lancamentos_financeiros
where conta_avulsa_id in ('<uuid avulsa 1>', '<uuid avulsa 2>');
-- esperado: 2
```

Rodar 2ª vez para confirmar que aborta com erro de unique (baixa duplicada).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260820000004_baixa_lote_cartao.sql \
        app/\(app\)/financeiro/contas-a-pagar/actions-cartao.ts
git commit -m "feat(financeiro): RPC e action de baixa em lote de cartao"
```

---

## Task 10: Aba "Títulos a Pagar (Cartão)" — UI

**Files:**
- Create: `app/(app)/financeiro/contas-a-pagar/titulos-cartao-list.tsx`
- Create: `app/(app)/financeiro/contas-a-pagar/baixa-lote-cartao-dialog.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx`

**Interfaces:**
- Consumes: `CartaoCredito`, `darBaixaLoteCartao` (Task 9), `PlanoContaTipo`, `PlanoContaSubtipo`, `ContaBancaria`.
- Produces: aba "Títulos a Pagar (Cartão)" funcional.

- [ ] **Step 1: Preparar dados agregados em `page.tsx`**

Em `app/(app)/financeiro/contas-a-pagar/page.tsx`, na parte que monta `titulos: TituloRow[]`:

- Adicionar `forma_pagamento` e `cartao_credito_id` na `TituloRow` (arquivo do tipo em `titulos-pagar-list.tsx` — Task 6 já deve ter passado se PP form já usa cartão; senão, adicionar aqui).
- Nas duas passadas (rows de PP, rows de avulsa), preencher os 2 campos com os dados do registro.
- Após montar `titulos`, criar 2 estruturas:

```typescript
const titulosCartao = titulos.filter(
  (t) => t.forma_pagamento === "cartao_credito" && t.status === "a_pagar",
);
const titulosCartaoCount = titulosCartao.length;
```

- **Ajustar `titulosAPagarCount`** para excluir cartões pendentes:

```typescript
const titulosAPagarCount = titulos.filter(
  (t) => t.status === "a_pagar" && t.forma_pagamento !== "cartao_credito",
).length;
```

- **Filtrar a lista comum**: passar prop `rows` para `TitulosPagarList` no modo "a_pagar" apenas com títulos NÃO-cartão (mantém NULL na lista comum):

```typescript
<TitulosPagarList
  rows={titulos.filter(
    (t) => t.status !== "a_pagar" || t.forma_pagamento !== "cartao_credito"
  )}
  modo="a_pagar"
  /* ... */
/>
```

Motivo do `t.status !== "a_pagar"` na condição: preserva os pagos de cartão na lista comum (que já não aparecem em modo "a_pagar", mas ficam disponíveis para o modo "pagos" quando reutilizamos os mesmos `rows`).

**Verificação**: como "Títulos Pagos" recebe o mesmo `rows` filtrado, cartões pagos precisam estar lá. Manter a filtragem só nos "a_pagar" cobre isso.

- [ ] **Step 2: Criar `baixa-lote-cartao-dialog.tsx`**

Client component. Props:

```typescript
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cartaoNome: string;
  cartaoId: string;
  titulosSelecionados: Array<{
    origem: "pp" | "avulso" | "recorrencia";
    id: string;
    descricao: string;
    valor: number;
  }>;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
}
```

Layout: shadcn Dialog com campos:
- Data do pagamento (`type="date"`, default = hoje).
- Conta bancária (Select).
- Tipo do plano (Select) + Subtipo (Select encadeado — filtrado por `tipo_id`).
- Resumo: "Você vai baixar N títulos do cartão **X**, total R$ Y, na conta **Z**, em **DD/MM/YYYY**."
- Botão "Confirmar baixa" chama `darBaixaLoteCartao`.
- Trata erro: mostra `toast.error(message)`.
- Sucesso: `toast.success("Fatura baixada.")` + `onOpenChange(false)`.

- [ ] **Step 3: Criar `titulos-cartao-list.tsx`**

Client component. Props:

```typescript
interface Props {
  rows: TituloRow[];  // já filtrados a_pagar + cartao_credito
  cartoes: CartaoOption[];  // ativos, para filtro e para nome/bandeira do grupo
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  tenantId: string;
}
```

Estado interno: `filtroCartaoId | null`, `dataDe | null`, `dataAte | null`, `selecionadosPorCartao: Map<cartaoId, Set<tituloId>>`.

Layout:
1. **Barra de filtros** no topo:
   - Select "Cartão" (opção "Todos" + cartões ativos).
   - Inputs `type="date"` "De" / "Até" (filtram `data_pagamento`).
   - Atalhos "Este mês" / "Próximo mês" que preenchem os inputs.
   - Totalizador global (soma dos valores após filtro).

2. **Corpo agrupado por cartão**:
   - Para cada `cartao_credito_id` presente nas rows filtradas, uma seção.
   - Cabeçalho da seção: nome do cartão + bandeira + últimos 4 dígitos + total do grupo + contador de títulos + checkbox "selecionar todos deste cartão".
   - Tabela do grupo: colunas Origem / Descrição / Fornecedor / Job / Vencimento / Valor + checkbox por linha.
   - Grupos sem títulos após filtro: escondidos.

3. **Barra sticky no rodapé** (aparece quando há seleção):
   - "N títulos selecionados de **<cartão>** — Total **R$ X** [Baixar]".
   - Clicar "Baixar" abre `baixa-lote-cartao-dialog`.
   - Trocar seleção para outro cartão limpa a seleção anterior com `toast.info("Seleção do cartão anterior descartada.")` — regra do spec 3.6.

Estado vazio (sem títulos após filtro): "Nenhum título de cartão a pagar no período."

- [ ] **Step 4: Modificar `contas-pagar-tabs.tsx` — 5ª aba**

Adicionar props:

```typescript
titulosCartao: React.ReactNode;
titulosCartaoCount: number;
```

Adicionar entrada no `TabKey`:

```typescript
type TabKey = "pps" | "titulos" | "cartao" | "recorrentes" | "pagos";
```

Adicionar botão de aba entre "Títulos a Pagar" e "Títulos Pagos":

```tsx
<TabButton
  active={tab === "cartao"}
  onClick={() => setTab("cartao")}
  count={titulosCartaoCount}
>
  Títulos a Pagar (Cartão)
</TabButton>
```

Adicionar painel:

```tsx
<div
  role="tabpanel"
  aria-hidden={tab !== "cartao"}
  className={cn(tab === "cartao" ? "" : "hidden")}
>
  {titulosCartao}
</div>
```

Atualizar comentário do topo para refletir 5 abas.

- [ ] **Step 5: Renderizar a nova aba na `page.tsx`**

Passar `titulosCartao` e `titulosCartaoCount` para `<ContasPagarTabs>`:

```tsx
titulosCartao={
  <TitulosCartaoList
    rows={titulosCartao}
    cartoes={cartoesRes.data ?? []}
    contas={contasRes.data ?? []}
    tipos={tiposRes.data ?? []}
    subtipos={subtiposRes.data ?? []}
    tenantId={session.activeTenant.id}
  />
}
titulosCartaoCount={titulosCartaoCount}
```

- [ ] **Step 6: Verificar typecheck + lint**

`npm run typecheck && npm run lint`.

- [ ] **Step 7: Smoke manual end-to-end**

- Estado inicial: já há 1 cartão cadastrado (Task 2), pelo menos 1 avulsa no cartão (Task 6). Criar mais 2 avulsas no mesmo cartão + 1 avulsa em cartão diferente (se não houver outro cartão, criar).
- Ir para `/financeiro/contas-a-pagar` → confirmar aba "Títulos a Pagar (Cartão)" com badge 4.
- Confirmar aba "Títulos a Pagar" (comum) NÃO mostra as 4 avulsas de cartão.
- Abrir aba "Cartão": ver 2 grupos, um por cartão, com totais.
- Filtrar por 1 cartão → vê só 1 grupo.
- Aplicar filtro de data "Este mês" → filtra por `data_pagamento`.
- Selecionar todos do cartão A → aparece barra sticky. Tentar selecionar do cartão B → seleção A é descartada com aviso.
- Clicar "Baixar" → modal abre. Preencher data, conta, plano de contas. Confirmar.
- Após baixa: os 3 títulos do cartão A somem da aba "Cartão"; aparecem em "Títulos Pagos" (aba comum) com conta e centro exibidos.
- Conferir no banco:
```sql
select origem, count(*) from lancamentos_financeiros
where data_movimento = current_date group by origem;
```

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/titulos-cartao-list.tsx \
        app/\(app\)/financeiro/contas-a-pagar/baixa-lote-cartao-dialog.tsx \
        app/\(app\)/financeiro/contas-a-pagar/page.tsx \
        app/\(app\)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx
git commit -m "feat(financeiro): aba Titulos a Pagar (Cartao) com baixa em lote"
```

---

## Task 11: Verificação final end-to-end

**Files:** nenhum — só verificação.

**Interfaces:** N/A.

- [ ] **Step 1: `npm run typecheck && npm run lint && npm run build`**

Build de produção completo. Corrigir qualquer warning bloqueante que apareça.

- [ ] **Step 2: E2E — cadastro completo**

Roteiro no browser:

1. Criar um segundo cartão (dia 5, Nubank Daniel).
2. Criar PP no cartão A (dia 20), 3 parcelas → confirmar 3 datas na fatura A dos 3 próximos meses.
3. Aprovar a PP → parcelas viram títulos na aba "Cartão" agrupados no cartão A.
4. Criar avulsa no cartão B (dia 5) → aparece no grupo do cartão B com data = próxima ocorrência do dia 5.
5. Criar recorrência mensal no cartão A → simular materialização via `select gerar_ocorrencias_recorrentes();` → confirmar `data_prevista_pagamento` = próxima fatura de A (dia 20), não a `proxima_data` do template.
6. Filtrar por cartão A na aba: vê PP (3 parcelas) + recorrência = 4 títulos.
7. Selecionar as 3 parcelas da PP e baixar em lote. Confirmar que a recorrência sobrou no grupo.
8. Baixar a recorrência sobrando (lote de 1).
9. Aba "Cartão" agora só tem o cartão B com 1 título.
10. Aba "Títulos Pagos" tem os 4 títulos de cartão A com conta/centro preenchidos.

- [ ] **Step 3: Conferir fluxo de caixa**

Ir para `/financeiro/fluxo-caixa` e conferir que:
- As saídas de cartão aparecem na data da fatura (não na data de criação do título).
- Nenhum título de cartão pendente aparece com data "hoje" se a fatura é no futuro.

- [ ] **Step 4: Conferir "Títulos a Pagar" (comum) não mostra cartões**

Query rápida:

```sql
-- Nenhum título de cartão pendente deve aparecer se filtrarmos "a pagar"
select id, forma_pagamento, cartao_credito_id, status, pago_em from contas_avulsas
where forma_pagamento = 'cartao_credito' and status = 'aprovada';
```

Comparar com o que aparece na tela da aba "Títulos a Pagar" (comum) → nenhum desses IDs deve estar lá.

- [ ] **Step 5: Auditoria**

```sql
select acao, count(*), max(created_at)
from audit_events
where acao like 'cartao%' or acao = 'contas_pagar.baixa_lote_cartao'
group by acao order by 1;
```

Deve mostrar: `cartao_credito.criado`, `cartao_credito.atualizado`, `contas_pagar.baixa_lote_cartao`, `pedido_compra.parcela_paga`, `conta_avulsa.baixada`.

- [ ] **Step 6: Marcar handoff**

Atualizar `docs/HANDOFF.md` com uma nota curta descrevendo a entrega desta feature e apontando para o spec. (Se for prática do projeto — confirmar lendo o handoff atual antes de escrever.)

- [ ] **Step 7: Commit final (se houver mudança no handoff)**

```bash
git add docs/HANDOFF.md
git commit -m "docs(handoff): forma de pagamento e cartoes de credito entregues"
```

---

## Self-Review

**1. Spec coverage:**

- Seção 3.1 (enum + nullable) → Tasks 1, 3.
- Seção 3.2 (FK opcional + check constraint) → Task 3.
- Seção 3.3 (cadastro de cartão + dia da fatura) → Tasks 1, 2.
- Seção 3.4 (auto-preenchimento) → Tasks 4, 5, 6, 7, 8.
- Seção 3.5 (validação server-side data futura) → Task 6 (Zod refinement, replicado nas 7 e 8).
- Seção 3.6 (aba nova + filtro na aba comum) → Task 10.
- Seção 3.7 (RPC transacional de baixa em lote) → Task 9.
- Seção 3.8 (`FormaPagamentoField` compartilhado) → Task 5.
- Seção 3.9 (data_pagamento = data da fatura) → convenção documentada nos drawers via strings de UI (Tasks 6, 7, 8) e reforçada pela `superRefine` "cartão exige data futura".
- Seção 4.1 (schema cartões) → Task 1.
- Seção 4.2 (colunas + check + índices) → Task 3.
- Seção 4.3 (ajuste em `gerar_ocorrencias_recorrentes` + `proxima_fatura_cartao`) → Tasks 4 (SQL função) e 8 (patch na RPC).
- Seção 4.4 (RPC `dar_baixa_lote_cartao`) → Task 9.
- Seção 4.5 (atualização de `lib/types.ts`) → Tasks 1 e 3.
- Seção 5.1 (cadastro `/cadastros/cartoes-credito`) → Task 2.
- Seção 5.2 (`FormaPagamentoField`) → Task 5.
- Seção 5.3 (integração nos 3 formulários) → Tasks 6, 7, 8.
- Seção 5.4 (aba nova) → Task 10.
- Seção 5.5 (ajuste na aba comum) → Task 10.
- Seção 6 (server actions/RPCs) → Tasks 2, 9.
- Seção 7 (auditoria) → integrada em cada action.
- Seção 8 (permissões/RLS) → integrada nas migrations e actions.
- Seção 11 (ordem) → segue as 11 tasks.

Coverage completo.

**2. Placeholder scan:**

- Task 7 tem "mapear em passo 1" para o form de PP — resolvido pelo próprio Step 1 da task (grep). Justificado porque o executor precisa fazer a leitura antes de listar arquivos exatos. OK.
- Task 8 idem para o drawer de recorrência — mesmo motivo.
- Nenhum "TBD", "TODO", "similar a task N" ou instrução vazia.

**3. Type consistency:**

- `CartaoOption`, `FormaPagamentoValue`, `FormaPagamentoFieldProps` — Task 5 define; Tasks 6, 7, 8, 10 consomem com nomes consistentes.
- `darBaixaLoteCartao(input)` — Task 9 define; Task 10 (`baixa-lote-cartao-dialog.tsx`) chama com o formato do input do Zod schema.
- `TituloRow` recebe `forma_pagamento` + `cartao_credito_id` — a Task 6 adiciona à `TituloRow` pela primeira vez (via edição em `titulos-pagar-list.tsx`); Tasks 7, 8, 10 usam esses mesmos campos.
- `proximaFatura(dia: number, hoje: Date): Date` — Task 4 define, Tasks 5, 7, 8 consomem com essa assinatura.

Consistente.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-20-forma-pagamento-e-cartoes-credito.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
