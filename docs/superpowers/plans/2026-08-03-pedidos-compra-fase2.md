# Pedidos de Compra Fase 2 — Caixa de Entrada do Financeiro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar caixa de entrada em `/financeiro/pedidos-compra` onde o financeiro vê todas as PPs, ajusta `prazo_pagamento_financeiro` (dado interno) e cancela com motivo obrigatório. Introduzir soft delete (status enum) — cancelar não apaga mais, marca como `cancelada`.

**Architecture:** Big-bang em 6 tasks. Uma migration única adiciona enum `pp_status`, colunas de auditoria de cancelamento, prazo financeiro e substitui unique constraint por parcial (permite gerar nova PP após cancelar antiga). Server actions dividem responsabilidade: `cancelarPedidoCompra` (existente, GP no `/jobs/[jobId]`) migra de hard→soft delete; `cancelarPedidoCompraFinanceiro` + `salvarPrazoFinanceiro` (novas, financeiro) vivem em arquivo próprio. UI segue padrão `/financeiro/jobs-aguardando-abertura`: page server + lista client + drawer client.

**Tech Stack:** Next.js 14 App Router, TypeScript 5, Supabase Postgres (enum + partial unique index + soft delete pattern), Supabase-js, Zod, Radix UI (Dialog/DrawerContent, Tooltip, DatePicker), Tailwind. Sem test framework — verificação `npm run typecheck`, `npm run lint`, `npm run build`, QA manual no browser.

## Global Constraints

- **Performance é feature** (`docs/PERFORMANCE.md`): query única na página com embeds; `<Link>` `prefetch={false}` em listas; queries independentes → `Promise.all`; GRANT explícito nas migrations; RLS `is_tenant_member((select auth.uid()))`; `force-dynamic` mantido.
- **RLS ≠ GRANT** (`CLAUDE.md`): esta migration só adiciona colunas — sem novas tabelas, sem GRANT novo.
- **Larguras de layout** (`docs/09-identidade-visual-ui.md`): página nova usa `max-w-7xl` (listagem/detalhe).
- **Header padrão da página** (`docs/09-identidade-visual-ui.md`): kicker "FINANCEIRO" + icon `FileText` + título + descrição. Segue padrão do `/financeiro/jobs-aguardando-abertura`.
- **Radix `<SelectItem>` NUNCA aceita `value=""`** — não usado aqui, campos são texto/data.
- **Radix `<PopoverContent>` de DatePicker**: `side="bottom"`, `avoidCollisions={false}`, `w-[300px]`, `<Calendar fixedWeeks>`.
- **Cores California**: vermelho `california-red` (`#E74B56`), destaques green `emerald-600`, cinza escuro `#333`.
- **Migration numbering**: usar `20260803000002_pp_fase2_status_baixa.sql` (a 000001 dessa data já foi usada por `remover_hierarquia_jobs.sql`; confirmar antes com `ls supabase/migrations/`).
- **Ortografia pt-BR completa em strings visíveis ao usuário** (`CLAUDE.md`): "Cancelar Pedido de Compra", "Prazo pagamento financeiro", "Motivo do cancelamento", "Emitida", "Cancelada" — TUDO com acento e cedilha.
- **Sem emojis em código.**
- **Terminologia UI**: "Pedido de Compra" visível ao usuário; "PP" só no código (`PP-NNNNN`).
- **Snapshot imutável**: fornecedor, valor, quantidade, serviço, empresa, prazo_pagamento (original) **NÃO** são editáveis pelo financeiro. Só `prazo_pagamento_financeiro` é.
- **Motivo do cancelamento pelo financeiro**: obrigatório, min 10, max 500 chars (trim antes de validar).
- **Windows environment**: `bash` tool com forward slashes; quotar paths com brackets.

---

## File Structure — mapa de mudanças

### Cria:
| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260803000002_pp_fase2_status_baixa.sql` | Enum `pp_status`, 5 colunas novas em `pedidos_compra`, índice de status, substituição da unique constraint por parcial |
| `app/(app)/financeiro/pedidos-compra/actions.ts` | Server actions: `cancelarPedidoCompraFinanceiro`, `salvarPrazoFinanceiro` |
| `app/(app)/financeiro/pedidos-compra/page.tsx` | Server component: fetch de PPs + fornecedor + job, guard admin/financeiro, renderiza `<PedidosCompraList>` |
| `app/(app)/financeiro/pedidos-compra/pedidos-compra-list.tsx` | Client: chips de filtro + busca + tabela com row click → drawer |
| `app/(app)/financeiro/pedidos-compra/pp-drawer-financeiro.tsx` | Client: drawer com dados PP + anexos + ação prazo/cancelar/baixa (placeholder) |

### Modifica:
| Arquivo | O que muda |
|---|---|
| `lib/types.ts` | Adiciona `PPStatus`, campos novos em `PedidoCompra`, função `ppStatusLabel` |
| `lib/auth/audit.ts` | Adiciona action `pedido_compra.prazo_financeiro_atualizado` ao union |
| `app/(app)/jobs/[jobId]/realizado/actions-pp.ts` | `cancelarPedidoCompra` muda de hard→soft delete + regra `status='emitida'` + audit ganha `metadata.origem: "gp"` |
| `app/(app)/jobs/[jobId]/page.tsx` | Query de PPs adiciona `.eq("status", "emitida")` — canceladas somem da trilha |
| `app/(app)/financeiro/page.tsx` | Novo card "Pedidos de Compra" com contagem de emitidas |

### Deleta:
Nenhum arquivo.

---

## Task 1: Migration + types + audit

**Files:**
- Create: `supabase/migrations/20260803000002_pp_fase2_status_baixa.sql`
- Modify: `lib/types.ts` (add PPStatus, columns, label)
- Modify: `lib/auth/audit.ts` (add action)

**Interfaces:**
- Consumes: nada.
- Produces:
  - Enum SQL `pp_status`.
  - Colunas `pedidos_compra.status`, `.prazo_pagamento_financeiro`, `.cancelada_por`, `.cancelada_em`, `.motivo_cancelamento`.
  - Índice `idx_pp_status`.
  - Unique parcial `uniq_pp_ativa_por_item_realizado` (substitui `uniq_pp_por_item_realizado`).
  - Type `PPStatus = "emitida" | "cancelada"`.
  - `PedidoCompra` interface com campos novos.
  - `ppStatusLabel(s: PPStatus): string`.
  - `AuditAction` inclui `"pedido_compra.prazo_financeiro_atualizado"`.

- [ ] **Step 1: Confirmar número de migration disponível**

Rodar `ls supabase/migrations/ | tail -5`. Confirmar que `20260803000002_*` não existe. Se existir (por commit paralelo), usar próximo disponível e ajustar steps subsequentes.

- [ ] **Step 2: Criar arquivo de migration**

Criar `supabase/migrations/20260803000002_pp_fase2_status_baixa.sql`:

```sql
-- =====================================================================
-- PP fase 2 — status enum + soft delete + prazo financeiro + unique parcial
-- Ver spec: docs/superpowers/specs/2026-08-03-pedidos-compra-fase2-design.md
-- =====================================================================

-- 1. Enum de status (baixada fica pra fase 3)
do $$ begin
  create type pp_status as enum ('emitida', 'cancelada');
exception when duplicate_object then null;
end $$;

-- 2. Novas colunas em pedidos_compra
alter table public.pedidos_compra
  add column if not exists status pp_status not null default 'emitida',
  add column if not exists prazo_pagamento_financeiro date,
  add column if not exists cancelada_por uuid references public.profiles(id),
  add column if not exists cancelada_em timestamptz,
  add column if not exists motivo_cancelamento text;

-- 3. Índice para chips de filtro
create index if not exists idx_pp_status
  on public.pedidos_compra(tenant_id, status);

-- 4. Substituir unique(item_realizado_id) por unique parcial: só bloqueia
-- se existir PP não cancelada. Sem isso, cancelar uma PP e gerar nova no
-- mesmo item falha por unique constraint (soft delete quebra a assumption
-- da fase 1 que era hard delete).
alter table public.pedidos_compra
  drop constraint if exists uniq_pp_por_item_realizado;

create unique index if not exists uniq_pp_ativa_por_item_realizado
  on public.pedidos_compra(item_realizado_id)
  where status != 'cancelada';
```

- [ ] **Step 3: Aplicar migration via MCP Supabase**

Usar `mcp__supabase-write__apply_migration` com:
- name: `pp_fase2_status_baixa`
- query: conteúdo do arquivo SQL acima.

- [ ] **Step 4: Validar migration aplicada**

Via `mcp__supabase__execute_sql`:

```sql
-- confirma enum + colunas + indexes
select
  (select array_agg(enumlabel::text order by enumsortorder)
     from pg_enum where enumtypid = 'pp_status'::regtype) as enum_values,
  (select array_agg(column_name::text order by column_name)
     from information_schema.columns
     where table_schema = 'public' and table_name = 'pedidos_compra'
       and column_name in ('status','prazo_pagamento_financeiro','cancelada_por','cancelada_em','motivo_cancelamento')) as new_columns,
  (select exists(select 1 from pg_indexes where schemaname='public' and indexname='uniq_pp_ativa_por_item_realizado')) as partial_unique_exists,
  (select not exists(select 1 from pg_constraint where conname='uniq_pp_por_item_realizado')) as old_unique_dropped;
```

Esperado: enum tem `emitida` + `cancelada`, 5 colunas presentes, partial unique existe, old unique não existe.

- [ ] **Step 5: Adicionar types em `lib/types.ts`**

Localizar a interface `PedidoCompra` (buscar `export interface PedidoCompra`). Adicionar 5 campos novos ANTES de `created_at`:

```ts
  // Fase 2
  status: PPStatus;
  prazo_pagamento_financeiro: string | null;
  cancelada_por: string | null;
  cancelada_em: string | null;
  motivo_cancelamento: string | null;
```

Adicionar (antes ou depois da interface `PedidoCompra`, mantendo agrupado):

```ts
export type PPStatus = "emitida" | "cancelada";

export function ppStatusLabel(s: PPStatus): string {
  switch (s) {
    case "emitida":
      return "Emitida";
    case "cancelada":
      return "Cancelada";
  }
}
```

- [ ] **Step 6: Adicionar audit action em `lib/auth/audit.ts`**

Localizar o union `AuditAction`. Adicionar `| "pedido_compra.prazo_financeiro_atualizado"` logo após `| "pedido_compra.cancelada"` (que já existe da fase 1).

- [ ] **Step 7: Typecheck**

Rodar: `npm run typecheck`
Esperado: passa. Podem aparecer erros em código que consome `PedidoCompra` sem os campos novos — se sim, deixar pra tasks seguintes tratarem.

- [ ] **Step 8: Commit**

```powershell
git add supabase/migrations/20260803000002_pp_fase2_status_baixa.sql lib/types.ts lib/auth/audit.ts
git commit -m "pp-fase2: migration status/soft-delete + types + audit action"
```

---

## Task 2: `cancelarPedidoCompra` — hard delete → soft delete + regra status

**Files:**
- Modify: `app/(app)/jobs/[jobId]/realizado/actions-pp.ts` (função `cancelarPedidoCompra`)

**Interfaces:**
- Consumes:
  - `PPStatus` de `@/lib/types` (Task 1).
  - Audit action `"pedido_compra.cancelada"` (já existe da fase 1) — agora com metadata `origem`.
- Produces:
  - Mesma assinatura `cancelarPedidoCompra(pp_id: string): Promise<Result>` — só muda comportamento interno.

- [ ] **Step 1: Localizar a função `cancelarPedidoCompra`**

Abrir `app/(app)/jobs/[jobId]/realizado/actions-pp.ts`. Localizar `export async function cancelarPedidoCompra`. Ler o corpo atual inteiro pra entender a lógica de hard delete que vamos substituir.

- [ ] **Step 2: Substituir corpo por soft delete**

Sobrescrever a função inteira:

```ts
export async function cancelarPedidoCompra(pp_id: string): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: pp, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select(
      "id, tenant_id, codigo, job_id, item_realizado_id, status, jobs!inner(id, status, responsavel_id)",
    )
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppErr || !pp) return { ok: false, message: "PP não encontrada." };

  // Regra fase 2: só permite cancelar PP emitida.
  if (pp.status !== "emitida") {
    return {
      ok: false,
      message: `PP já está ${pp.status === "cancelada" ? "cancelada" : "em outro status"}.`,
    };
  }

  const job = (pp as unknown as { jobs: { status: string; responsavel_id: string | null } }).jobs;
  if (job.status !== "aberto" && job.status !== "em_producao") {
    return { ok: false, message: "Job não está em estado editável." };
  }

  const podeCancelar =
    session.activeRole === "administrador" ||
    job.responsavel_id === session.profile.id;
  if (!podeCancelar) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: pp_id,
      metadata: {
        acao_tentada: "pedido_compra.cancelada",
        motivo: "sem_permissao",
      },
    });
    return { ok: false, message: "Sem permissão pra cancelar esta PP." };
  }

  // Soft delete: marca como cancelada. PDF e anexos ficam no bucket.
  const agora = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("pedidos_compra")
    .update({
      status: "cancelada",
      cancelada_por: session.profile.id,
      cancelada_em: agora,
      motivo_cancelamento: null, // GP não justifica
    })
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id);

  if (updErr) {
    return { ok: false, message: `Falha ao cancelar PP: ${updErr.message}` };
  }

  // Zera fornecedor_id do realizado (permite gerar nova PP)
  await supabase
    .from("jobs_itens_realizado")
    .update({ fornecedor_id: null })
    .eq("id", pp.item_realizado_id)
    .eq("tenant_id", session.activeTenant.id);

  await logAuditEvent({
    acao: "pedido_compra.cancelada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      item_realizado_id: pp.item_realizado_id,
      job_id: pp.job_id,
      origem: "gp",
    },
  });

  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}
```

**Não** remove PDF nem anexos do bucket — soft delete deixa tudo em disco pra histórico.

- [ ] **Step 3: Verificar imports ainda válidos**

O import de `PPStatus` não é usado (só o valor string `"cancelada"` inline). Se o linter reclamar de imports não usados na `actions-pp.ts`, remover. Provavelmente nada muda porque a função já usava `logAuditEvent`, `revalidatePath`, `requireSession`, `createClient`.

- [ ] **Step 4: Typecheck + Lint**

```powershell
npm run typecheck; if ($?) { npm run lint }
```
Esperado: ambos passam.

- [ ] **Step 5: Commit**

```powershell
git add "app/(app)/jobs/[jobId]/realizado/actions-pp.ts"
git commit -m "pp-fase2: cancelarPedidoCompra vira soft delete + regra status='emitida' + origem=gp no audit"
```

---

## Task 3: Server actions do financeiro

**Files:**
- Create: `app/(app)/financeiro/pedidos-compra/actions.ts`

**Interfaces:**
- Consumes:
  - `requireSession()` de `@/lib/auth/session`.
  - `createClient()` de `@/lib/supabase/server`.
  - `logAuditEvent()` de `@/lib/auth/audit`.
  - Audit actions `"pedido_compra.cancelada"`, `"pedido_compra.prazo_financeiro_atualizado"`, `"acao_negada"`.
- Produces:
  - `salvarPrazoFinanceiro(pp_id: string, prazo: string | null): Promise<Result>`
  - `cancelarPedidoCompraFinanceiro(pp_id: string, motivo: string): Promise<Result>`

- [ ] **Step 1: Criar arquivo com estrutura completa**

Criar `app/(app)/financeiro/pedidos-compra/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Ok = { ok: true };
type Err = { ok: false; message: string };
type Result = Ok | Err;

const motivoSchema = z
  .string()
  .trim()
  .min(10, "Motivo precisa ter pelo menos 10 caracteres.")
  .max(500, "Motivo passa de 500 caracteres.");

const prazoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD.");

/**
 * Gate: apenas admin ou financeiro. Loga acao_negada caso contrário e retorna erro.
 */
async function checarGateFinanceiro(
  ppId: string,
  acaoTentada: string,
): Promise<
  | {
      ok: true;
      session: Awaited<ReturnType<typeof requireSession>>;
      supabase: ReturnType<typeof createClient>;
    }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();

  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: ppId,
      metadata: {
        acao_tentada: acaoTentada,
        motivo: "sem_permissao_financeira",
      },
    });
    return {
      ok: false,
      message: "Apenas admin ou financeiro pode executar esta ação.",
    };
  }

  return { ok: true, session, supabase };
}

/**
 * Salva o prazo_pagamento_financeiro (data em que o financeiro vai pagar).
 * Aceita null pra limpar. Só permite se PP está 'emitida'.
 */
export async function salvarPrazoFinanceiro(
  pp_id: string,
  prazo: string | null,
): Promise<Result> {
  const gate = await checarGateFinanceiro(
    pp_id,
    "pedido_compra.prazo_financeiro_atualizado",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  // Valida formato do prazo (aceita null)
  if (prazo !== null) {
    const parsed = prazoSchema.safeParse(prazo);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Prazo inválido." };
    }
  }

  // Load PP + valida tenant + status
  const { data: pp, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select("id, status, job_id, codigo, prazo_pagamento_financeiro")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppErr || !pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "emitida") {
    return {
      ok: false,
      message: "Prazo só pode ser ajustado em PP emitida.",
    };
  }

  const prazoAnterior = pp.prazo_pagamento_financeiro;

  const { error: updErr } = await supabase
    .from("pedidos_compra")
    .update({ prazo_pagamento_financeiro: prazo })
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id);

  if (updErr) {
    return { ok: false, message: `Falha ao salvar prazo: ${updErr.message}` };
  }

  await logAuditEvent({
    acao: "pedido_compra.prazo_financeiro_atualizado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      prazo_anterior: prazoAnterior,
      prazo_novo: prazo,
    },
  });

  revalidatePath("/financeiro/pedidos-compra");
  return { ok: true };
}

/**
 * Cancela PP pelo financeiro. Motivo obrigatório (min 10 chars).
 * Soft delete: marca como cancelada, mantém PDF e anexos.
 * Zera fornecedor_id do realizado pra permitir nova PP.
 */
export async function cancelarPedidoCompraFinanceiro(
  pp_id: string,
  motivo: string,
): Promise<Result> {
  const gate = await checarGateFinanceiro(pp_id, "pedido_compra.cancelada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const motivoParsed = motivoSchema.safeParse(motivo);
  if (!motivoParsed.success) {
    return {
      ok: false,
      message: motivoParsed.error.issues[0]?.message ?? "Motivo inválido.",
    };
  }

  const { data: pp, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select("id, status, job_id, codigo, item_realizado_id")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppErr || !pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status === "cancelada") {
    return { ok: false, message: "PP já está cancelada." };
  }

  const agora = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("pedidos_compra")
    .update({
      status: "cancelada",
      cancelada_por: session.profile.id,
      cancelada_em: agora,
      motivo_cancelamento: motivoParsed.data,
    })
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id);

  if (updErr) {
    return { ok: false, message: `Falha ao cancelar PP: ${updErr.message}` };
  }

  // Zera fornecedor_id do realizado
  await supabase
    .from("jobs_itens_realizado")
    .update({ fornecedor_id: null })
    .eq("id", pp.item_realizado_id)
    .eq("tenant_id", session.activeTenant.id);

  await logAuditEvent({
    acao: "pedido_compra.cancelada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      item_realizado_id: pp.item_realizado_id,
      job_id: pp.job_id,
      origem: "financeiro",
      motivo: motivoParsed.data,
    },
  });

  revalidatePath("/financeiro/pedidos-compra");
  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck + Lint**

```powershell
npm run typecheck; if ($?) { npm run lint }
```
Esperado: passa.

- [ ] **Step 3: Commit**

```powershell
git add "app/(app)/financeiro/pedidos-compra/actions.ts"
git commit -m "pp-fase2: server actions cancelarPedidoCompraFinanceiro + salvarPrazoFinanceiro"
```

---

## Task 4: Página lista + client de tabela

**Files:**
- Create: `app/(app)/financeiro/pedidos-compra/page.tsx`
- Create: `app/(app)/financeiro/pedidos-compra/pedidos-compra-list.tsx`

**Interfaces:**
- Consumes:
  - `requireSession` de `@/lib/auth/session`.
  - `createClient` de `@/lib/supabase/server`.
  - Types `PedidoCompra`, `PPStatus`, `ppStatusLabel` de `@/lib/types` (Task 1).
- Produces:
  - Rota `/financeiro/pedidos-compra` funcional.
  - Componente `<PedidosCompraList rows={rows} />` com chips + busca + tabela + row click state.
  - Tipo `PPRow` (exportado) — shape simplificado passado do server pro client.

- [ ] **Step 1: Criar `pedidos-compra-list.tsx` (client)**

```tsx
"use client";

import * as React from "react";
import { Search, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PedidoCompra, PPStatus } from "@/lib/types";
import { ppStatusLabel } from "@/lib/types";
import { PPDrawerFinanceiro } from "./pp-drawer-financeiro";

export interface PPRow {
  id: string;
  codigo: string;
  status: PPStatus;
  valor: number;
  prazo_pagamento: string;
  prazo_pagamento_financeiro: string | null;
  created_at: string;
  cancelada_em: string | null;
  motivo_cancelamento: string | null;
  fornecedor_id: string;
  fornecedor_nome: string;
  empresa_id: string;
  empresa_nome: string;
  job_id: string;
  job_codigo: string;
  job_nome: string;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  servico: string;
  quantidade: number;
  especificacoes: string | null;
  pdf_path: string;
  cancelada_por_nome: string | null;
  emitida_por_nome: string | null;
  anexos: Array<{
    id: string;
    arquivo_nome_original: string;
    arquivo_tamanho_bytes: number;
  }>;
}

const STATUS_FILTROS: Array<{ key: "todas" | PPStatus; label: string }> = [
  { key: "emitida", label: "Emitida" },
  { key: "cancelada", label: "Cancelada" },
  { key: "todas", label: "Todas" },
];

function statusBadgeClasses(status: PPStatus): string {
  switch (status) {
    case "emitida":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "cancelada":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function PedidosCompraList({ rows }: { rows: PPRow[] }) {
  const [filtro, setFiltro] = React.useState<"todas" | PPStatus>("emitida");
  const [busca, setBusca] = React.useState("");
  const [ppSelecionada, setPpSelecionada] = React.useState<PPRow | null>(null);

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro !== "todas" && r.status !== filtro) return false;
      if (q === "") return true;
      return (
        r.codigo.toLowerCase().includes(q) ||
        r.fornecedor_nome.toLowerCase().includes(q) ||
        r.job_codigo.toLowerCase().includes(q) ||
        r.job_nome.toLowerCase().includes(q)
      );
    });
  }, [rows, filtro, busca]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTROS.map((s) => {
            const ativo = filtro === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setFiltro(s.key)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  ativo
                    ? "bg-california-red text-white border-california-red"
                    : "bg-white text-muted-foreground border-border hover:border-california-red/40 hover:text-california-red",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código, fornecedor ou job"
            className="rounded-lg border border-border bg-white pl-8 pr-3 py-1.5 text-xs w-72 focus:outline-none focus:border-california-red/40"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Fornecedor</th>
              <th className="px-4 py-3 font-semibold">Job</th>
              <th className="px-4 py-3 font-semibold">Emissão</th>
              <th className="px-4 py-3 font-semibold text-right">Valor</th>
              <th className="px-4 py-3 font-semibold">Prazo Original</th>
              <th className="px-4 py-3 font-semibold">Prazo Financeiro</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "Nenhum Pedido de Compra emitido ainda."
                    : "Nenhum Pedido de Compra encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {filtrados.map((r) => (
              <tr
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => setPpSelecionada(r)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPpSelecionada(r);
                  }
                }}
                className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40"
              >
                <td className="px-4 py-3 font-mono text-xs">{r.codigo}</td>
                <td className="px-4 py-3">{r.fornecedor_nome}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  <span className="font-mono text-xs">{r.job_codigo}</span>{" "}
                  <span>{r.job_nome}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(r.created_at)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">
                  {formatMoney(r.valor)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(r.prazo_pagamento)}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.prazo_pagamento_financeiro ? formatDate(r.prazo_pagamento_financeiro) : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge className={cn("border", statusBadgeClasses(r.status))}>
                    {ppStatusLabel(r.status)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PPDrawerFinanceiro
        pp={ppSelecionada}
        open={ppSelecionada !== null}
        onOpenChange={(open) => {
          if (!open) setPpSelecionada(null);
        }}
      />
    </div>
  );
}
```

Note que `<PPDrawerFinanceiro>` é referenciado mas será criado na Task 5. Deixar STUB temporário nessa task pra typecheck passar — criar arquivo `pp-drawer-financeiro.tsx` com componente vazio:

- [ ] **Step 2: Criar STUB de `pp-drawer-financeiro.tsx`**

```tsx
"use client";
import type { PPRow } from "./pedidos-compra-list";

interface Props {
  pp: PPRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// STUB — implementação real na Task 5
export function PPDrawerFinanceiro(_props: Props) {
  return null;
}
```

- [ ] **Step 3: Criar `page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { FileText, ChevronRight } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PedidosCompraList, type PPRow } from "./pedidos-compra-list";
import type { PPStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PedidosCompraFinanceiroPage() {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from("pedidos_compra")
    .select(
      `
      id, codigo, status, valor, quantidade, servico, especificacoes,
      prazo_pagamento, prazo_pagamento_financeiro, pdf_path, created_at,
      cancelada_em, motivo_cancelamento,
      fornecedor:fornecedores(id, nome, razao_social),
      empresa:empresas(id, razao_social, nome_fantasia),
      cancelada_por_profile:profiles!cancelada_por(nome),
      emitida_por_profile:profiles!emitida_por(nome),
      job:jobs(
        id, codigo, nome,
        projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia))
      ),
      anexos:pedidos_compra_anexos(id, arquivo_nome_original, arquivo_tamanho_bytes)
    `,
    )
    .eq("tenant_id", session.activeTenant.id)
    .order("created_at", { ascending: false });

  if (error) console.error("[financeiro.pp.list]", error.message);

  const rows: PPRow[] = ((data ?? []) as unknown as Array<{
    id: string;
    codigo: string;
    status: PPStatus;
    valor: string | number;
    quantidade: string | number;
    servico: string;
    especificacoes: string | null;
    prazo_pagamento: string;
    prazo_pagamento_financeiro: string | null;
    pdf_path: string;
    created_at: string;
    cancelada_em: string | null;
    motivo_cancelamento: string | null;
    fornecedor: { id: string; nome: string; razao_social: string | null } | null;
    empresa: { id: string; razao_social: string; nome_fantasia: string | null } | null;
    cancelada_por_profile: { nome: string } | null;
    emitida_por_profile: { nome: string } | null;
    job: {
      id: string;
      codigo: string;
      nome: string;
      projeto: {
        codigo: string;
        nome: string;
        cliente: { nome_fantasia: string } | null;
      } | null;
    } | null;
    anexos: Array<{
      id: string;
      arquivo_nome_original: string;
      arquivo_tamanho_bytes: number;
    }>;
  }>).map((r) => ({
    id: r.id,
    codigo: r.codigo,
    status: r.status,
    valor: Number(r.valor),
    quantidade: Number(r.quantidade),
    servico: r.servico,
    especificacoes: r.especificacoes,
    prazo_pagamento: r.prazo_pagamento,
    prazo_pagamento_financeiro: r.prazo_pagamento_financeiro,
    pdf_path: r.pdf_path,
    created_at: r.created_at,
    cancelada_em: r.cancelada_em,
    motivo_cancelamento: r.motivo_cancelamento,
    fornecedor_id: r.fornecedor?.id ?? "",
    fornecedor_nome: r.fornecedor?.razao_social ?? r.fornecedor?.nome ?? "",
    empresa_id: r.empresa?.id ?? "",
    empresa_nome: r.empresa?.razao_social ?? r.empresa?.nome_fantasia ?? "",
    job_id: r.job?.id ?? "",
    job_codigo: r.job?.codigo ?? "",
    job_nome: r.job?.nome ?? "",
    projeto_codigo: r.job?.projeto?.codigo ?? null,
    projeto_nome: r.job?.projeto?.nome ?? null,
    cliente_nome: r.job?.projeto?.cliente?.nome_fantasia ?? null,
    cancelada_por_nome: r.cancelada_por_profile?.nome ?? null,
    emitida_por_nome: r.emitida_por_profile?.nome ?? null,
    anexos: r.anexos ?? [],
  }));

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/financeiro" className="hover:text-california-red transition-colors">
            Financeiro
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">Pedidos de Compra</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <FileText className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Pedidos de Compra</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Visualize as PPs emitidas pelos GPs, ajuste o prazo de pagamento financeiro e cancele com motivo justificado.
        </p>
      </header>

      <PedidosCompraList rows={rows} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + Lint**

```powershell
npm run typecheck; if ($?) { npm run lint }
```

- [ ] **Step 5: QA parcial (opcional, útil pra confirmar filtros)**

Como o drawer é stub, testar:
- Como admin, abrir `/financeiro/pedidos-compra` — tabela aparece com PPs existentes.
- Chip "Emitida" default; alternar entre chips.
- Busca por código/fornecedor/job filtra.
- Clicar em linha não faz nada (drawer stub retorna null).
- Como user sem role financeiro — redirect pra home.

- [ ] **Step 6: Commit**

```powershell
git add "app/(app)/financeiro/pedidos-compra/page.tsx" "app/(app)/financeiro/pedidos-compra/pedidos-compra-list.tsx" "app/(app)/financeiro/pedidos-compra/pp-drawer-financeiro.tsx"
git commit -m "pp-fase2: pagina /financeiro/pedidos-compra com tabela + filtros + drawer stub"
```

---

## Task 5: Drawer do financeiro

**Files:**
- Modify: `app/(app)/financeiro/pedidos-compra/pp-drawer-financeiro.tsx` (substitui stub pela implementação real)

**Interfaces:**
- Consumes:
  - `PPRow` de `./pedidos-compra-list` (Task 4).
  - `salvarPrazoFinanceiro`, `cancelarPedidoCompraFinanceiro` de `./actions` (Task 3).
  - `signedUrlPdf`, `signedUrlAnexo` de `@/app/(app)/jobs/[jobId]/realizado/actions-pp` (existentes da fase 1).
  - Componentes UI: `Dialog`, `DrawerContent`, `DialogHeader`, `DialogTitle`, `DatePicker`, `Tooltip*`, `ConfirmDialog`.
- Produces: nenhum export novo (só substitui componente stub).

- [ ] **Step 1: Substituir stub pela implementação completa**

Sobrescrever `pp-drawer-financeiro.tsx`:

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  X,
  FileText,
  Image as ImageIcon,
  Download,
  Eye,
  Ban,
  CreditCard,
  ExternalLink,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { ppStatusLabel } from "@/lib/types";
import type { PPRow } from "./pedidos-compra-list";
import {
  salvarPrazoFinanceiro,
  cancelarPedidoCompraFinanceiro,
} from "./actions";
import {
  signedUrlPdf,
  signedUrlAnexo,
} from "@/app/(app)/jobs/[jobId]/realizado/actions-pp";

interface Props {
  pp: PPRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return format(parseISO(iso), "dd/MM/yyyy HH:mm");
}

function isoDateFromDate(date: Date | null): string | null {
  return date ? format(date, "yyyy-MM-dd") : null;
}

function iconePorMime(nome: string): typeof FileText {
  const lower = nome.toLowerCase();
  if (/\.(png|jpe?g|webp)$/.test(lower)) return ImageIcon;
  return FileText;
}

export function PPDrawerFinanceiro({ pp, open, onOpenChange }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [prazoLocal, setPrazoLocal] = React.useState<string | null>(null);
  const [askCancelar, setAskCancelar] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");

  // Sincroniza prazo local com o valor da PP ao abrir/trocar
  React.useEffect(() => {
    if (!pp) return;
    setPrazoLocal(pp.prazo_pagamento_financeiro);
    setErro(null);
    setMotivo("");
  }, [pp]);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!pp) return null;

  const podeEditar = pp.status === "emitida";
  const prazoMudou = prazoLocal !== pp.prazo_pagamento_financeiro;

  function handleVerPDF() {
    if (!pp) return;
    startTransition(async () => {
      const res = await signedUrlPdf(pp.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  function handleBaixarAnexo(anexoId: string) {
    startTransition(async () => {
      const res = await signedUrlAnexo(anexoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  function handleSalvarPrazo() {
    if (!pp) return;
    startTransition(async () => {
      const res = await salvarPrazoFinanceiro(pp.id, prazoLocal);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setToast("Prazo financeiro salvo!");
      router.refresh();
    });
  }

  function handleConfirmarCancelar() {
    if (!pp) return;
    startTransition(async () => {
      const res = await cancelarPedidoCompraFinanceiro(pp.id, motivo);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setAskCancelar(false);
      onOpenChange(false);
      setToast(`${pp.codigo} cancelada.`);
      router.refresh();
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="sm:max-w-2xl">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
            <DialogTitle className="flex items-center gap-3">
              <span className="font-mono text-lg">{pp.codigo}</span>
              <Badge
                className={cn(
                  "border",
                  pp.status === "emitida"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-slate-100 text-slate-500 border-slate-200",
                )}
              >
                {ppStatusLabel(pp.status)}
              </Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleVerPDF}
                    disabled={pending}
                    className="ml-auto rounded-md p-1.5 text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Ver PDF</TooltipContent>
              </Tooltip>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 p-6">
            {erro && (
              <div className="flex items-start justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
                <span>{erro}</span>
                <button type="button" onClick={() => setErro(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {pp.status === "cancelada" && (
              <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-california-red mb-1">
                  Cancelada
                </p>
                <p className="text-sm">
                  Por{" "}
                  <span className="font-medium">
                    {pp.cancelada_por_nome ?? "—"}
                  </span>{" "}
                  em {formatDateTime(pp.cancelada_em)}
                </p>
                <p className="mt-2 text-sm">
                  <span className="font-medium">Motivo: </span>
                  {pp.motivo_cancelamento ?? "Sem motivo registrado (cancelado pelo GP)."}
                </p>
              </div>
            )}

            {/* Dados */}
            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2 text-sm">
              <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                <span className="text-muted-foreground">Fornecedor</span>
                <span className="font-medium">{pp.fornecedor_nome}</span>
                <span className="text-muted-foreground">Empresa emissora</span>
                <span>{pp.empresa_nome}</span>
                <span className="text-muted-foreground">Cliente</span>
                <span>{pp.cliente_nome ?? "—"}</span>
                <span className="text-muted-foreground">Projeto</span>
                <span>
                  <span className="font-mono text-xs">{pp.projeto_codigo}</span>{" "}
                  {pp.projeto_nome}
                </span>
                <span className="text-muted-foreground">Job</span>
                <span>
                  <Link
                    href={`/jobs/${pp.job_id}`}
                    prefetch={false}
                    onClick={(e) => e.stopPropagation()}
                    className="text-california-red hover:underline inline-flex items-center gap-1"
                  >
                    <span className="font-mono text-xs">{pp.job_codigo}</span>{" "}
                    {pp.job_nome}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </span>
                <span className="text-muted-foreground">Serviço</span>
                <span>{pp.servico}</span>
                <span className="text-muted-foreground">Quantidade</span>
                <span>{pp.quantidade}</span>
                <span className="text-muted-foreground">Valor</span>
                <span className="font-mono font-semibold">
                  {formatCurrency(pp.valor, "BRL")}
                </span>
                <span className="text-muted-foreground">Prazo Original</span>
                <span>{formatDate(pp.prazo_pagamento)}</span>
                <span className="text-muted-foreground">Emitida em</span>
                <span>
                  {formatDate(pp.created_at)}
                  {pp.emitida_por_nome ? ` por ${pp.emitida_por_nome}` : ""}
                </span>
                {pp.especificacoes && (
                  <>
                    <span className="text-muted-foreground">Especificações</span>
                    <span className="whitespace-pre-wrap">{pp.especificacoes}</span>
                  </>
                )}
              </div>
            </div>

            {/* Anexos */}
            {pp.anexos.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Anexos ({pp.anexos.length})
                </h3>
                <ul className="space-y-1">
                  {pp.anexos.map((a) => {
                    const Icon = iconePorMime(a.arquivo_nome_original);
                    return (
                      <li
                        key={a.id}
                        className="flex items-center gap-2 rounded border border-border bg-white p-2 text-xs"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 truncate">
                          {a.arquivo_nome_original}
                        </span>
                        <span className="text-muted-foreground">
                          {(a.arquivo_tamanho_bytes / 1024).toFixed(0)} KB
                        </span>
                        <button
                          type="button"
                          onClick={() => handleBaixarAnexo(a.id)}
                          disabled={pending}
                          className="text-california-red hover:opacity-70 disabled:opacity-50"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Ações financeiras (só se emitida) */}
            {podeEditar && (
              <div className="space-y-3 rounded-lg border border-border p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Ações do financeiro
                </h3>
                <div>
                  <label className="text-xs font-medium">
                    Prazo pagamento financeiro
                  </label>
                  <p className="text-[11px] text-muted-foreground mb-1">
                    Data em que o financeiro vai efetuar o pagamento (interno; não vai pro PDF).
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <DatePicker
                        name="prazo_financeiro"
                        defaultValue={prazoLocal ?? undefined}
                        onDateChange={(date) => setPrazoLocal(isoDateFromDate(date))}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSalvarPrazo}
                      disabled={pending || !prazoMudou}
                      className="rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
                    >
                      Salvar prazo
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer com Baixa (desabilitada) + Cancelar */}
          {podeEditar && (
            <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground cursor-not-allowed opacity-60"
                    >
                      <CreditCard className="h-3.5 w-3.5" />
                      Dar Baixa
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Em breve — vira lançamento em contas a pagar (fase 3)
                </TooltipContent>
              </Tooltip>

              <button
                type="button"
                onClick={() => setAskCancelar(true)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-white px-3 py-2 text-xs font-semibold text-california-red hover:bg-california-red hover:text-white transition-colors disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" />
                Cancelar PP
              </button>
            </div>
          )}
        </DrawerContent>
      </Dialog>

      {/* Confirm cancelar */}
      <ConfirmDialog
        open={askCancelar}
        onOpenChange={(o) => {
          setAskCancelar(o);
          if (!o) setMotivo("");
        }}
        title={`Cancelar ${pp.codigo}?`}
        description={
          <div className="space-y-2">
            <p>
              Esta ação marca a PP como cancelada e libera o item pra gerar uma nova.
              O PDF e anexos permanecem arquivados.
            </p>
            <div>
              <label className="text-xs font-medium">Motivo * (mín 10 caracteres)</label>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
                rows={3}
                className="mt-1 w-full rounded border border-border p-2 text-sm"
                placeholder="Ex: valor divergente do combinado com o fornecedor..."
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {motivo.trim().length}/500 caracteres
              </p>
            </div>
          </div>
        }
        confirmLabel="Confirmar cancelamento"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={handleConfirmarCancelar}
      />

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated animate-in fade-in slide-in-from-bottom-2"
        >
          <span className="text-sm font-medium text-emerald-800">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck + Lint**

```powershell
npm run typecheck; if ($?) { npm run lint }
```
Esperado: passam. `DatePicker` do projeto aceita `defaultValue: string` (ISO) e `onDateChange: (date: Date | null) => void` — verificar match com outras usages (buscar `<DatePicker` em `app/**`). Se assinatura diferente, ajustar.

- [ ] **Step 3: Commit**

```powershell
git add "app/(app)/financeiro/pedidos-compra/pp-drawer-financeiro.tsx"
git commit -m "pp-fase2: drawer do financeiro (visualizar + prazo + cancelar + baixa placeholder)"
```

---

## Task 6: Card no hub + filtro na query do job

**Files:**
- Modify: `app/(app)/financeiro/page.tsx` (adicionar card novo)
- Modify: `app/(app)/jobs/[jobId]/page.tsx` (filtrar status='emitida' na query de PPs)

**Interfaces:**
- Consumes: nada novo — só usa APIs existentes.
- Produces: nada exportado — só ajustes.

- [ ] **Step 1: Adicionar contagem de PPs emitidas no hub**

Abrir `app/(app)/financeiro/page.tsx`. Localizar o bloco `const { count: aguardandoCount } = ...`. Adicionar QUERY paralela via `Promise.all`:

```ts
const [aguardandoRes, ppsRes] = await Promise.all([
  supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "aguardando_abertura"),
  supabase
    .from("pedidos_compra")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "emitida"),
]);
const aguardandoCount = aguardandoRes.count;
const ppsCount = ppsRes.count;
```

- [ ] **Step 2: Adicionar novo `<FinanceiroCard>` no grid**

No JSX, depois do card `Jobs Aguardando Abertura`, adicionar (removendo o comentário `{/* Cards futuros ... */}`):

```tsx
<FinanceiroCard
  href="/financeiro/pedidos-compra"
  icon={FileText}
  title="Pedidos de Compra"
  description="Visualize, ajuste prazo de pagamento e cancele PPs emitidas."
  count={ppsCount ?? 0}
/>
```

Adicionar import de `FileText` no topo do arquivo (se ainda não estiver):

```ts
import { Landmark, Clock, ArrowRight, FileText, type LucideIcon } from "lucide-react";
```

- [ ] **Step 3: Filtrar PPs canceladas na query do `/jobs/[jobId]/page.tsx`**

Abrir `app/(app)/jobs/[jobId]/page.tsx`. Localizar a query de `pedidos_compra` (buscar `.from("pedidos_compra")`). Adicionar `.eq("status", "emitida")`:

```ts
supabase
  .from("pedidos_compra")
  .select("*")
  .eq("job_id", raw.id)
  .eq("tenant_id", session.activeTenant.id)
  .eq("status", "emitida"),   // NOVO — canceladas somem da trilha
```

- [ ] **Step 4: Typecheck + Lint + Build**

```powershell
rm -rf .next; npm run typecheck; if ($?) { npm run lint }; if ($?) { npm run build }
```
Esperado: passa tudo. Build pra confirmar que import de `FileText` está OK e queries paralelas compilaram.

- [ ] **Step 5: QA manual end-to-end**

1. Como financeiro/admin, abrir `/financeiro` → card "Pedidos de Compra" aparece com contagem correta.
2. Clicar → `/financeiro/pedidos-compra`. Tabela carregada, chip "Emitida" default, PPs listadas.
3. Chip "Cancelada" → só canceladas. "Todas" → tudo. Busca por código/fornecedor/job funciona.
4. Clicar linha → drawer abre com dados corretos.
5. Ver PDF → nova aba com PDF gerado (fase 1 já funciona).
6. Baixar anexo → download inicia.
7. DatePicker: escolher data → botão "Salvar prazo" habilita → clicar → toast "Prazo financeiro salvo!" + tabela atualiza (coluna "Prazo Financeiro" mostra data).
8. Reabrir PP → prazo persistiu.
9. Botão "Dar Baixa" → hover mostra tooltip "Em breve..." → clique não faz nada.
10. Botão "Cancelar PP" → ConfirmDialog abre.
11. Textarea vazio → botão confirmar desabilitado OU erro se clicar? — Server retorna erro "mín 10 chars", aparece no drawer.
12. Motivo com >=10 chars → confirmar → drawer fecha, toast "PP-XXXXX cancelada.", tabela atualiza, PP some do filtro "Emitida" mas aparece em "Cancelada".
13. Reabrir a PP cancelada → drawer mostra card vermelho "Cancelada por X em Y — Motivo: Z". Sem botões de ação.
14. Voltar em `/jobs/[jobId]` do item cuja PP foi cancelada → trilha lateral do item mostra "Gerar PP" novamente (canceladas filtradas).
15. Gerar nova PP no mesmo item → funciona (unique parcial permite).
16. Como GP responsável do job, cancelar PP direto da tela do job (sem motivo) → PP some da trilha, mas aparece em `/financeiro/pedidos-compra` filtro "Cancelada" com "Sem motivo registrado".
17. User sem role admin/financeiro → tenta `/financeiro/pedidos-compra` → redirect pra home.
18. Verificar `audit_events`:
    ```sql
    select acao, metadata from audit_events
    where acao in ('pedido_compra.cancelada','pedido_compra.prazo_financeiro_atualizado','acao_negada')
    order by created_at desc limit 10;
    ```
    `pedido_compra.cancelada` deve ter `metadata.origem: "gp"` ou `"financeiro"` (+ `motivo` quando `financeiro`).

- [ ] **Step 6: Commit final**

```powershell
git add "app/(app)/financeiro/page.tsx" "app/(app)/jobs/[jobId]/page.tsx"
git commit -m "pp-fase2: card no hub + filtro status='emitida' na trilha do job"
```

---

## Auto-verificação do plano

**Cobertura do spec:**
- [x] Migration com enum + colunas + índice + unique parcial → Task 1.
- [x] Types + audit action → Task 1.
- [x] `cancelarPedidoCompra` vira soft delete + regra status → Task 2.
- [x] `salvarPrazoFinanceiro` + `cancelarPedidoCompraFinanceiro` → Task 3.
- [x] Página `/financeiro/pedidos-compra` + lista client → Task 4.
- [x] Drawer com dados + anexos + prazo + cancelar + baixa placeholder → Task 5.
- [x] Card no hub → Task 6.
- [x] Query do job filtra PPs canceladas → Task 6.
- [x] Performance (Promise.all, GRANT herdado, prefetch=false quando aplicável) — cobertos ao longo das tasks.
- [x] Auditoria de sucesso e denials → Task 2, Task 3.
- [x] Rollback em falhas — sem impacto (só soft delete, nada de bucket).

**Tipos consistentes:**
- `PPStatus` definido em Task 1, usado em Tasks 2, 3, 4, 5.
- `PedidoCompra` novos campos definidos em Task 1, consumidos em Tasks 3, 4, 5.
- `PPRow` definido/exportado em Task 4 (`pedidos-compra-list.tsx`), consumido em Task 5 (`pp-drawer-financeiro.tsx`).
- Server action signatures: `salvarPrazoFinanceiro(pp_id, prazo)`, `cancelarPedidoCompraFinanceiro(pp_id, motivo)` — definidas Task 3, chamadas Task 5.
- `cancelarPedidoCompra` (existente) mantém assinatura `(pp_id) → Result` — só corpo muda em Task 2.

**Placeholders:** nenhum "TBD", "TODO", "implementar depois", "similar to Task N".
