# Task 008 — Tela de Jobs + Realizado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o placeholder de `/jobs` por uma lista real de todos os jobs do tenant e adicionar, dentro de `/jobs/[jobId]`, a planilha do job com blocos ORÇADO / PLANEJADO / REALIZADO editáveis, permitindo lançar valores realizados por item.

**Architecture:** Big-bang em uma sequência de commits. Uma migration única cria `jobs_itens_realizado` (1:1 job × item, unique parcial, GENERATED total). UI vive dentro da rota `/jobs/[jobId]` já existente (não cria rota nova); componentes ficam em `app/(app)/jobs/[jobId]/realizado/`. Edição usa click-to-edit igual ao padrão de `versoes/[versaoId]/itens-table.tsx`, mas com apenas o bloco REALIZADO editável. Server action única (`upsertItemRealizado`) com gates de status, ownership e tenant.

**Tech Stack:** Next.js 14 App Router, TypeScript 5, Supabase Postgres (RLS + GRANT + GENERATED), Supabase-js, React (Server + Client Components), Tailwind CSS, Radix UI. Sem test framework — verificação via `npm run typecheck`, `npm run lint`, `npm run dev` (QA manual no browser), SQL smoke via MCP Supabase.

## Global Constraints

- **Performance é feature** (`CLAUDE.md`, `docs/PERFORMANCE.md`): `<Link>` em lista 5+ itens → `prefetch={false}`; queries independentes em server component → `Promise.all`; sem embed pesado só pra agregar; migration nova → GRANT explícito pra `authenticated` + índices em FKs; policies RLS usam `(select auth.uid())`; `force-dynamic` mantido em pages autenticadas.
- **RLS ≠ GRANT** (`CLAUDE.md`): toda tabela nova termina com `grant select, insert, update, delete on ... to authenticated;`.
- **Toda tabela operacional tem `tenant_id`** com FK pra `tenants` e RLS via `is_tenant_member(tenant_id)`.
- **Sem policy DELETE em tabelas com histórico** — `jobs_itens_realizado` PODE ter DELETE porque cascade da FK `on delete cascade` (job/item deletado limpa o realizado órfão) e não há regra de histórico (o realizado é sempre "quanto foi gasto até agora").
- **Toda ação sensível grava em `audit_events`** via `logAuditEvent` (helper de `lib/auth/audit.ts`).
- **Radix `<SelectItem>` NUNCA aceita `value=""`** — usar sentinel `"__none__"` (padrão do projeto).
- **Identidade visual California**: vermelho `california-red` (`#E74B56`), fonte Inter, Fraunces via `font-display`, botões arredondados, cards com `shadow-soft`.
- **Cores novas de bloco REALIZADO**: âmbar — fundo `#fef3c7`, borda `#d97706`, texto `#92400e`. Coordenar com blocos existentes (ORÇADO cinza `#f1f0ec`, PLANEJADO azul `#e8f0fd`).
- **Migration numbering**: próximo número disponível é `20260730000001` (última: `20260729000002_task005_jobs.sql`).
- **Sem emojis em código.**
- **Terminologia UI**: "Realizado" (nunca "gasto", "custo real", "realizados"). "Variação vs Planejado" no card de totais.
- **Windows environment**: `bash` tool com forward slashes; quotar paths com brackets.
- **Row height fixa** na tabela do realizado (mesmo padrão de `itens-table.tsx`: `h-9`) — mantém alinhamento visual entre grupos.

---

## File Structure — mapa de mudanças

### Cria:
| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260730000001_task008_jobs_realizado.sql` | Tabela `jobs_itens_realizado` (uuid, FKs cascade, GENERATED, unique parcial, RLS+GRANT+trigger) |
| `app/(app)/jobs/jobs-list.tsx` | Client component: tabela de jobs com chips de filtro por status + input de busca + linha clicável |
| `app/(app)/jobs/[jobId]/actions-realizado.ts` | Server action `upsertItemRealizado` com gates status/ownership/tenant |
| `app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx` | Wrapper server-compatible: header, info-card se aguardando/rejeitado, iteração de grupos, monta JobTotaisCard |
| `app/(app)/jobs/[jobId]/realizado/job-grupo-card.tsx` | Card de grupo (só header + tabela de itens dentro); sem renomear/remover |
| `app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx` | Client component: grid com blocos ORÇADO/PLANEJADO (RO) + REALIZADO (edit) + VARIAÇÃO; click-to-edit; subtotal grupo no tfoot |
| `app/(app)/jobs/[jobId]/realizado/job-totais-card.tsx` | Card de totais: 3 colunas (ORÇADO/PLANEJADO/REALIZADO) + linha Variação vs Planejado + Resultado Real |

### Modifica:
| Arquivo | O que muda |
|---|---|
| `lib/types.ts` | Adiciona interface `JobItemRealizado` |
| `lib/auth/audit.ts` | Adiciona action `"job.realizado_atualizado"` ao union `AuditAction` |
| `lib/calculos/versao-totais.ts` | Adiciona `calcularTotaisRealizado(itens)` e `calcularVariacao(realizado, planejado)` |
| `app/(app)/jobs/page.tsx` | Substitui placeholder pelo server component que busca lista e renderiza `<JobsList>` |
| `app/(app)/jobs/[jobId]/page.tsx` | Adiciona 3 queries ao `Promise.all` (grupos, itens, realizados da versão aprovada) + `versao_orcamento` completa + renderiza `<JobRealizadoSection>` após o card Status |

### Deleta:
Nenhum arquivo.

---

## Task 1: Migration + types + audit

**Files:**
- Create: `supabase/migrations/20260730000001_task008_jobs_realizado.sql`
- Modify: `lib/types.ts` (adicionar `JobItemRealizado` no fim, após `Job`)
- Modify: `lib/auth/audit.ts` (adicionar `"job.realizado_atualizado"` ao union)

**Interfaces:**
- Consumes: nada (funda dependências).
- Produces:
  - Tabela `public.jobs_itens_realizado` com colunas `id, tenant_id, job_id, item_id, valor_unitario_realizado, quantidade_realizada, dias_meses_realizado, total_realizado (GENERATED), created_by, created_at, updated_at` + unique `(job_id, item_id)`.
  - Type `JobItemRealizado` em `lib/types.ts`.
  - Union `AuditAction` inclui `"job.realizado_atualizado"`.

- [ ] **Step 1: Criar arquivo de migration**

Criar `supabase/migrations/20260730000001_task008_jobs_realizado.sql` com o conteúdo:

```sql
-- =====================================================================
-- Task 008 — Realizado por item de job
-- Ver spec: docs/superpowers/specs/2026-07-30-jobs-realizado-design.md
-- =====================================================================

-- 1. Tabela jobs_itens_realizado (1:1 job x item da versao aprovada)
create table if not exists public.jobs_itens_realizado (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete restrict,
  job_id                    uuid not null references public.jobs(id) on delete cascade,
  item_id                   uuid not null references public.versoes_orcamento_itens(id) on delete cascade,
  valor_unitario_realizado  numeric(14,2) not null default 0,
  quantidade_realizada      numeric(12,3) not null default 0,
  dias_meses_realizado      numeric(12,3) not null default 0,
  total_realizado           numeric(18,2) generated always as (
                              coalesce(valor_unitario_realizado, 0)
                              * coalesce(quantidade_realizada, 0)
                              * coalesce(dias_meses_realizado, 0)
                            ) stored,
  created_by                uuid references public.profiles(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint uniq_realizado_por_job_item unique (job_id, item_id),
  constraint realizado_valor_nao_negativo      check (valor_unitario_realizado >= 0),
  constraint realizado_quantidade_nao_negativa check (quantidade_realizada    >= 0),
  constraint realizado_dias_meses_nao_negativo check (dias_meses_realizado    >= 0)
);

create index if not exists idx_jobs_realizado_tenant on public.jobs_itens_realizado(tenant_id);
create index if not exists idx_jobs_realizado_job on public.jobs_itens_realizado(job_id);
create index if not exists idx_jobs_realizado_item on public.jobs_itens_realizado(item_id);

-- 2. Trigger updated_at
drop trigger if exists trg_jobs_realizado_updated_at on public.jobs_itens_realizado;
create trigger trg_jobs_realizado_updated_at
before update on public.jobs_itens_realizado
for each row execute function public.set_updated_at();

-- 3. RLS — is_tenant_member em todas as operacoes
alter table public.jobs_itens_realizado enable row level security;

drop policy if exists jobs_realizado_select on public.jobs_itens_realizado;
create policy jobs_realizado_select on public.jobs_itens_realizado
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists jobs_realizado_insert on public.jobs_itens_realizado;
create policy jobs_realizado_insert on public.jobs_itens_realizado
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists jobs_realizado_update on public.jobs_itens_realizado;
create policy jobs_realizado_update on public.jobs_itens_realizado
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists jobs_realizado_delete on public.jobs_itens_realizado;
create policy jobs_realizado_delete on public.jobs_itens_realizado
  for delete to authenticated using (public.is_tenant_member(tenant_id));

-- 4. GRANTs authenticated (service_role coberto por ALTER DEFAULT PRIVILEGES)
grant select, insert, update, delete on public.jobs_itens_realizado to authenticated;
```

- [ ] **Step 2: Aplicar migration via MCP Supabase (write)**

Usar `mcp__supabase-write__apply_migration` com:
- name: `task008_jobs_realizado`
- query: conteúdo do arquivo SQL acima (versão idempotente com `if not exists` / `drop policy if exists` já suporta reaplicação)

- [ ] **Step 3: Validar migration aplicada**

Usar `mcp__supabase__list_tables` (schemas: `["public"]`) e confirmar que `jobs_itens_realizado` aparece com as colunas esperadas e as policies estão em `rls_enabled: true`.

Também rodar via `mcp__supabase__execute_sql`:
```sql
select column_name, data_type, is_generated
from information_schema.columns
where table_schema = 'public' and table_name = 'jobs_itens_realizado'
order by ordinal_position;
```
Confirmar que `total_realizado` tem `is_generated = 'ALWAYS'`.

- [ ] **Step 4: Adicionar tipo `JobItemRealizado` em `lib/types.ts`**

Depois do bloco `// ---------- Jobs ----------` (após a função `jobStatusLabel`), adicionar:

```ts
export interface JobItemRealizado {
  id: string;
  tenant_id: string;
  job_id: string;
  item_id: string;
  valor_unitario_realizado: number;
  quantidade_realizada: number;
  dias_meses_realizado: number;
  total_realizado: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 5: Adicionar action de auditoria em `lib/auth/audit.ts`**

Localizar o union `AuditAction` (linha ~3) e adicionar `| "job.realizado_atualizado"` logo após `| "job.reenviado_para_aprovacao"`.

- [ ] **Step 6: Typecheck**

Rodar: `npm run typecheck`
Esperado: passa sem erros novos.

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/20260730000001_task008_jobs_realizado.sql lib/types.ts lib/auth/audit.ts
git commit -m "task008: migration jobs_itens_realizado + type + audit action"
```

---

## Task 2: Helpers de cálculo

**Files:**
- Modify: `lib/calculos/versao-totais.ts` (adicionar 2 exports no fim do arquivo)

**Interfaces:**
- Consumes: nada externo.
- Produces:
  - `calcularTotaisRealizado(itens: { total_realizado: number }[]): { totalRealizado: number }`
  - `calcularVariacao(realizado: number, planejado: number): { variacaoRS: number; variacaoPct: number | null }` — `variacaoPct` é `null` quando `planejado === 0`.

- [ ] **Step 1: Adicionar helpers no fim de `lib/calculos/versao-totais.ts`**

Anexar (sem tocar no que já existe):

```ts
/**
 * Soma dos totais realizados por item.
 * Usado pelo card de Totais do job e por subtotal do grupo.
 */
export function calcularTotaisRealizado(
  itens: { total_realizado: number }[],
): { totalRealizado: number } {
  const totalRealizado = itens.reduce(
    (s, i) => s + Number(i.total_realizado ?? 0),
    0,
  );
  return { totalRealizado };
}

/**
 * Variacao Realizado vs Planejado.
 * - variacaoRS: realizado - planejado (positivo = estouro; negativo = economia)
 * - variacaoPct: relativo ao planejado. null quando planejado eh 0 (sem base).
 */
export function calcularVariacao(
  realizado: number,
  planejado: number,
): { variacaoRS: number; variacaoPct: number | null } {
  const variacaoRS = realizado - planejado;
  const variacaoPct = planejado > 0 ? (variacaoRS / planejado) * 100 : null;
  return { variacaoRS, variacaoPct };
}
```

- [ ] **Step 2: Typecheck**

Rodar: `npm run typecheck`
Esperado: passa.

- [ ] **Step 3: Commit**

```powershell
git add lib/calculos/versao-totais.ts
git commit -m "task008: helpers calcularTotaisRealizado + calcularVariacao"
```

---

## Task 3: Server action `upsertItemRealizado`

**Files:**
- Create: `app/(app)/jobs/[jobId]/actions-realizado.ts`

**Interfaces:**
- Consumes:
  - `requireSession()` de `@/lib/auth/session`.
  - `createClient()` de `@/lib/supabase/server`.
  - `logAuditEvent(payload)` de `@/lib/auth/audit`.
  - `revalidatePath(path)` de `next/cache`.
  - Tabela `public.jobs` (campos: `id, tenant_id, status, responsavel_id, versao_orcamento_aprovada_id`).
  - Tabela `public.versoes_orcamento_itens` (campos: `id, tenant_id, versao_orcamento_id`).
  - Tabela `public.jobs_itens_realizado` (criada na Task 1).
- Produces:
  - `upsertItemRealizado(jobId: string, itemId: string, campo: CampoRealizado, valor: string | null): Promise<Resultado>`
  - Tipo local `CampoRealizado = "valor_unitario_realizado" | "quantidade_realizada" | "dias_meses_realizado"`
  - Tipo local `Resultado = { ok: true } | { ok: false; message: string }`

- [ ] **Step 1: Criar arquivo com estrutura completa**

Criar `app/(app)/jobs/[jobId]/actions-realizado.ts` com:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import type { JobItemRealizado } from "@/lib/types";

export type CampoRealizado =
  | "valor_unitario_realizado"
  | "quantidade_realizada"
  | "dias_meses_realizado";

type Resultado = { ok: true } | { ok: false; message: string };

const CAMPOS_VALIDOS: readonly CampoRealizado[] = [
  "valor_unitario_realizado",
  "quantidade_realizada",
  "dias_meses_realizado",
] as const;

/** Aceita "1.234,56" e "1234.56" (mesmo parser da grade de itens da versao). */
function parseNumero(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Cria ou atualiza uma linha de realizado (job, item).
 * Gates:
 * - Job existe no tenant.
 * - Job em status "aberto" ou "em_producao".
 * - User e admin OU responsavel do job.
 * - Item pertence a versao aprovada do job (defense-in-depth).
 * - Valor >= 0.
 * Audit: job.realizado_atualizado (metadata com item_id, campo, valor_novo/anterior).
 */
export async function upsertItemRealizado(
  jobId: string,
  itemId: string,
  campo: CampoRealizado,
  valor: string | null,
): Promise<Resultado> {
  const session = await requireSession();
  const supabase = createClient();

  if (!CAMPOS_VALIDOS.includes(campo)) {
    return { ok: false, message: "Campo invalido." };
  }

  // 1. Carrega job (com tenant lock)
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, tenant_id, status, responsavel_id, versao_orcamento_aprovada_id")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (jobErr || !job) {
    return { ok: false, message: "Job nao encontrado." };
  }

  // 2. Gate de status
  if (job.status !== "aberto" && job.status !== "em_producao") {
    return {
      ok: false,
      message:
        "Realizado so pode ser lancado com o job em 'Aberto' ou 'Em producao'.",
    };
  }

  // 3. Gate de ownership
  const podeEditar =
    session.activeRole === "administrador" ||
    job.responsavel_id === session.profile.id;

  if (!podeEditar) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        acao_tentada: "upsertItemRealizado",
        motivo: "usuario_nao_e_responsavel_nem_admin",
      },
    });
    return {
      ok: false,
      message: "Apenas o responsavel do job ou um administrador pode editar o realizado.",
    };
  }

  // 4. Valida que o item pertence a versao aprovada do job
  const { data: item, error: itemErr } = await supabase
    .from("versoes_orcamento_itens")
    .select("id, tenant_id, versao_orcamento_id")
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (itemErr || !item) {
    return { ok: false, message: "Item nao encontrado." };
  }

  if (item.versao_orcamento_id !== job.versao_orcamento_aprovada_id) {
    return {
      ok: false,
      message: "Item nao pertence a versao aprovada deste job.",
    };
  }

  // 5. Parse e valida valor
  const numero = valor === null || valor === "" ? 0 : parseNumero(valor);
  if (numero === null) {
    return { ok: false, message: "Valor invalido." };
  }
  if (numero < 0) {
    return { ok: false, message: "Valor nao pode ser negativo." };
  }

  // 6. Busca linha existente (pra saber valor anterior + decidir insert/update)
  const { data: existente } = await supabase
    .from("jobs_itens_realizado")
    .select("*")
    .eq("job_id", jobId)
    .eq("item_id", itemId)
    .maybeSingle<JobItemRealizado>();

  const valorAnterior = existente ? Number(existente[campo] ?? 0) : 0;

  // 7. Upsert
  const payload: Record<string, unknown> = {
    tenant_id: session.activeTenant.id,
    job_id: jobId,
    item_id: itemId,
    [campo]: numero,
  };
  if (!existente) {
    payload.created_by = session.profile.id;
  }

  const { error: upsertErr } = await supabase
    .from("jobs_itens_realizado")
    .upsert(payload, { onConflict: "job_id,item_id" });

  if (upsertErr) {
    return { ok: false, message: `Falha ao salvar: ${upsertErr.message}` };
  }

  // 8. Audit
  await logAuditEvent({
    acao: "job.realizado_atualizado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      item_id: itemId,
      campo,
      valor_anterior: valorAnterior,
      valor_novo: numero,
    },
  });

  // 9. Revalida
  revalidatePath(`/jobs/${jobId}`);

  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

Rodar: `npm run typecheck`
Esperado: passa sem erros.

- [ ] **Step 3: Lint**

Rodar: `npm run lint`
Esperado: passa sem novos warnings/errors em `app/(app)/jobs/[jobId]/actions-realizado.ts`.

- [ ] **Step 4: Commit**

```powershell
git add "app/(app)/jobs/[jobId]/actions-realizado.ts"
git commit -m "task008: server action upsertItemRealizado com gates status/ownership"
```

---

## Task 4: Lista `/jobs`

**Files:**
- Modify: `app/(app)/jobs/page.tsx` (substituir placeholder por server component real)
- Create: `app/(app)/jobs/jobs-list.tsx` (client component)

**Interfaces:**
- Consumes:
  - `requireSession()` de `@/lib/auth/session`.
  - `createClient()` de `@/lib/supabase/server`.
  - Tipos `Job`, `JobStatus`, `jobStatusLabel` de `@/lib/types`.
- Produces:
  - `<JobsList rows={rows} />` — client component com tabela + chips de filtro + busca.
  - Tipo local `JobRow` (subset de `Job` + embeds resolvidos).

- [ ] **Step 1: Criar `app/(app)/jobs/jobs-list.tsx`**

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { jobStatusLabel, type JobStatus } from "@/lib/types";

export interface JobRow {
  id: string;
  codigo: string;
  nome: string;
  status: JobStatus;
  valor_total: number | null;
  data_inicio_prevista: string | null;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  responsavel_nome: string | null;
  pai_codigo: string | null;
  pai_id: string | null;
}

const STATUS_FILTROS: JobStatus[] = [
  "aguardando_abertura",
  "rejeitado_financeiro",
  "aberto",
  "em_producao",
  "finalizado",
  "cancelado",
];

function statusBadgeClasses(status: JobStatus): string {
  switch (status) {
    case "aberto":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "em_producao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "finalizado":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "cancelado":
      return "bg-slate-100 text-slate-500 border-slate-200";
    case "aguardando_abertura":
      return "bg-yellow-50 text-yellow-700 border-yellow-200";
    case "rejeitado_financeiro":
      return "bg-red-50 text-red-700 border-red-200";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function JobsList({ rows }: { rows: JobRow[] }) {
  const router = useRouter();
  const [statusAtivos, setStatusAtivos] = React.useState<Set<JobStatus>>(
    new Set(),
  );
  const [busca, setBusca] = React.useState("");

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusAtivos.size > 0 && !statusAtivos.has(r.status)) return false;
      if (q === "") return true;
      return (
        r.codigo.toLowerCase().includes(q) ||
        r.nome.toLowerCase().includes(q)
      );
    });
  }, [rows, statusAtivos, busca]);

  function toggleStatus(s: JobStatus) {
    setStatusAtivos((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Chips de filtro + busca */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTROS.map((s) => {
            const ativo = statusAtivos.has(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  ativo
                    ? "bg-california-red text-white border-california-red"
                    : "bg-white text-muted-foreground border-border hover:border-california-red/40 hover:text-california-red",
                )}
              >
                {jobStatusLabel(s)}
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
            placeholder="Buscar por nome ou codigo"
            className="rounded-lg border border-border bg-white pl-8 pr-3 py-1.5 text-xs w-64 focus:outline-none focus:border-california-red/40"
          />
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Codigo</th>
              <th className="px-4 py-3 font-semibold">Nome</th>
              <th className="px-4 py-3 font-semibold">Projeto</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Responsavel</th>
              <th className="px-4 py-3 font-semibold">Inicio</th>
              <th className="px-4 py-3 font-semibold text-right">Valor total</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  {rows.length === 0
                    ? "Nenhum job criado ainda. Aprove uma versao de orcamento e crie um job."
                    : "Nenhum job encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {filtrados.map((r) => (
              <tr
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/jobs/${r.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/jobs/${r.id}`);
                  }
                }}
                className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40"
              >
                <td className="px-4 py-3 font-mono text-xs">
                  <Link
                    href={`/jobs/${r.id}`}
                    prefetch={false}
                    className="hover:text-california-red"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.codigo}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.nome}</span>
                    {r.pai_id && (
                      <span className="inline-flex items-center gap-1">
                        <Badge variant="neutral" className="text-[10px]">
                          Sub-job
                        </Badge>
                        <Link
                          href={`/jobs/${r.pai_id}`}
                          prefetch={false}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-[10px] text-muted-foreground hover:text-california-red"
                        >
                          {r.pai_codigo}
                        </Link>
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <span className="font-mono text-xs">{r.projeto_codigo}</span>{" "}
                  <span>{r.projeto_nome ?? ""}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.cliente_nome ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.responsavel_nome ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDate(r.data_inicio_prevista)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">
                  {formatMoney(r.valor_total)}
                </td>
                <td className="px-4 py-3">
                  <Badge className={cn("border", statusBadgeClasses(r.status))}>
                    {jobStatusLabel(r.status)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Substituir `app/(app)/jobs/page.tsx` pelo server component real**

Sobrescrever o conteúdo do arquivo (mantendo `export const dynamic = "force-dynamic"`):

```tsx
import { Briefcase } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { JobsList, type JobRow } from "./jobs-list";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const session = await requireSession();
  const supabase = createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, codigo, nome, status, valor_total, data_inicio_prevista, job_pai_id, " +
        "projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia)), " +
        "responsavel:profiles!responsavel_id(nome), " +
        "pai:jobs!job_pai_id(id, codigo)",
    )
    .eq("tenant_id", session.activeTenant.id)
    .order("created_at", { ascending: false });

  if (error) console.error("[jobs.list]", error.message);

  const rows: JobRow[] = (data ?? []).map((r: any) => ({
    id: r.id,
    codigo: r.codigo,
    nome: r.nome,
    status: r.status,
    valor_total: r.valor_total !== null ? Number(r.valor_total) : null,
    data_inicio_prevista: r.data_inicio_prevista,
    projeto_codigo: r.projeto?.codigo ?? null,
    projeto_nome: r.projeto?.nome ?? null,
    cliente_nome: r.projeto?.cliente?.nome_fantasia ?? null,
    responsavel_nome: r.responsavel?.nome ?? null,
    pai_id: r.pai?.id ?? null,
    pai_codigo: r.pai?.codigo ?? null,
  }));

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Operacao
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Todos os jobs criados. Aprovados pelo financeiro liberam a gestao do
          realizado.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 shadow-soft text-center max-w-2xl mx-auto">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
            <Briefcase className="h-6 w-6" />
          </div>
          <h2 className="mt-6 text-xl font-semibold">Nenhum job criado ainda</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Aprove uma versao de orcamento e crie um job pelo drawer no
            orcamento aprovado.
          </p>
        </div>
      ) : (
        <JobsList rows={rows} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + Lint**

```powershell
npm run typecheck; if ($?) { npm run lint }
```
Esperado: ambos passam.

- [ ] **Step 4: QA manual — /jobs**

Rodar `npm run dev` (se não estiver rodando). Abrir `http://localhost:3000/jobs` autenticado como `antonio@pevetech.com.br`.

Checar:
1. Lista aparece com jobs existentes.
2. Chips de status filtram (clicar 1, filtra; clicar de novo, remove).
3. Busca por nome/código funciona (case-insensitive).
4. Sub-job (se houver) mostra badge `Sub-job` e link pro pai — clicar no badge NÃO navega pra tela do sub-job (`stopPropagation`).
5. Clicar na linha vai pra `/jobs/[jobId]`.
6. Ordenação: mais recente no topo.
7. Vazio filtrado: "Nenhum job encontrado com esses filtros."

- [ ] **Step 5: Commit**

```powershell
git add "app/(app)/jobs/page.tsx" "app/(app)/jobs/jobs-list.tsx"
git commit -m "task008: substitui placeholder de /jobs por lista real com filtro e busca"
```

---

## Task 5: Extensão de `/jobs/[jobId]` + wrapper `<JobRealizadoSection>` + `<JobGrupoCard>` (read-only placeholder)

**Files:**
- Modify: `app/(app)/jobs/[jobId]/page.tsx` (adicionar queries + render da section)
- Create: `app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx`
- Create: `app/(app)/jobs/[jobId]/realizado/job-grupo-card.tsx`

**Interfaces:**
- Consumes:
  - Types `VersaoOrcamentoGrupo`, `VersaoOrcamentoItem`, `JobItemRealizado`, `JobStatus`, `VersaoOrcamento`, `Categoria` de `@/lib/types`.
  - Helpers `calcularTotaisRealizado` (usado só nesta task pra subtotal do grupo, Totais Card completo vem em Task 7) — mas o subtotal do grupo aqui é feito inline.
- Produces:
  - `<JobRealizadoSection>` com props `{ job, versao, grupos, itens, realizadosMap, editable }`.
  - `<JobGrupoCard>` com props `{ grupo, itens, realizadosMap, moeda, editable, jobId }` — renderiza header do grupo + tabela stub (placeholder texto "Tabela em desenvolvimento — Task 6") por enquanto.

- [ ] **Step 1: Criar `app/(app)/jobs/[jobId]/realizado/job-grupo-card.tsx`**

Componente simples, server-friendly (não precisa de "use client"):

```tsx
import type {
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  JobItemRealizado,
} from "@/lib/types";

interface Props {
  grupo: VersaoOrcamentoGrupo;
  itens: VersaoOrcamentoItem[];
  realizadosMap: Map<string, JobItemRealizado>;
  moeda: string;
  editable: boolean;
  jobId: string;
}

export function JobGrupoCard({
  grupo,
  itens,
}: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-border bg-muted/40 px-6 py-4">
        <h3 className="text-base font-semibold text-foreground truncate">
          {grupo.nome}
        </h3>
        <span className="text-xs text-muted-foreground">
          {itens.length} {itens.length === 1 ? "item" : "itens"}
        </span>
      </div>
      <div className="p-6 text-sm text-muted-foreground">
        Tabela de itens (Orcado / Planejado / Realizado / Variacao) sera renderizada aqui — Task 6.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar `app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx`**

```tsx
import Link from "next/link";
import { AlertCircle, ClipboardList } from "lucide-react";
import type {
  Job,
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  JobItemRealizado,
} from "@/lib/types";
import { JobGrupoCard } from "./job-grupo-card";

interface Props {
  job: Pick<
    Job,
    | "id"
    | "status"
    | "projeto_id"
    | "orcamento_id"
    | "versao_orcamento_aprovada_id"
  >;
  versao: Pick<VersaoOrcamento, "id" | "numero_versao" | "nome" | "moeda" | "percentual_honorarios" | "percentual_imposto">;
  grupos: VersaoOrcamentoGrupo[];
  itens: VersaoOrcamentoItem[];
  realizadosMap: Map<string, JobItemRealizado>;
  editable: boolean;
}

export function JobRealizadoSection({
  job,
  versao,
  grupos,
  itens,
  realizadosMap,
  editable,
}: Props) {
  // Status onde nem mostramos a planilha
  if (
    job.status === "aguardando_abertura" ||
    job.status === "rejeitado_financeiro"
  ) {
    return (
      <div className="rounded-2xl border border-border bg-muted/20 p-6 shadow-soft">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Realizado indisponivel
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Aguarde a aprovacao do financeiro para lancar valores realizados.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const itensPorGrupo = new Map<string, VersaoOrcamentoItem[]>();
  for (const g of grupos) itensPorGrupo.set(g.id, []);
  for (const it of itens) {
    const list = itensPorGrupo.get(it.grupo_id);
    if (list) list.push(it);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ClipboardList className="h-4 w-4 text-california-red" />
          <span>
            Planilha do job · v{versao.numero_versao}
            {versao.nome ? ` · ${versao.nome}` : ""}
          </span>
        </div>
        <Link
          href={`/orcamentos/${job.projeto_id}/${job.orcamento_id}/versoes/${versao.id}`}
          prefetch={false}
          className="text-xs text-california-red hover:underline"
        >
          Ver versao aprovada →
        </Link>
      </div>

      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            A versao aprovada nao tem grupos.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.map((g) => (
            <JobGrupoCard
              key={g.id}
              grupo={g}
              itens={itensPorGrupo.get(g.id) ?? []}
              realizadosMap={realizadosMap}
              moeda={versao.moeda}
              editable={editable}
              jobId={job.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Modificar `app/(app)/jobs/[jobId]/page.tsx` — adicionar queries e render**

Localizar o `Promise.all` existente (que hoje busca `jobRes, regionaisRes, responsaveis`). Adicionar 3 queries a mais (grupos, itens, realizados), condicionais na versão aprovada existir. Depois do card "Status" (final do JSX), renderizar `<JobRealizadoSection>`.

Mudanças específicas:

a) No topo do arquivo, adicionar imports:
```tsx
import { JobRealizadoSection } from "./realizado/job-realizado-section";
import type {
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  JobItemRealizado,
} from "@/lib/types";
```

b) O `select` do `jobRes` já traz `versao:versoes_orcamento!versao_orcamento_aprovada_id(id, numero_versao, nome)`. Estender pra também trazer `moeda, percentual_honorarios, percentual_imposto`:
```tsx
"versao:versoes_orcamento!versao_orcamento_aprovada_id(id, numero_versao, nome, moeda, percentual_honorarios, percentual_imposto)"
```

c) Depois do `Promise.all` original, adicionar novo bloco (sequencial só porque depende do jobId/tenantId que já vieram, mas as 3 queries em si são paralelas):

```tsx
  const versaoAprovadaId = raw.versao_orcamento_aprovada_id as string;

  const [gruposRes, itensRes, realizadosRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("*")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoGrupo[]>(),
    supabase
      .from("versoes_orcamento_itens")
      .select("*")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoItem[]>(),
    supabase
      .from("jobs_itens_realizado")
      .select("*")
      .eq("job_id", raw.id)
      .eq("tenant_id", session.activeTenant.id)
      .returns<JobItemRealizado[]>(),
  ]);

  const grupos = (gruposRes.data ?? []) as VersaoOrcamentoGrupo[];
  const itens: VersaoOrcamentoItem[] = (itensRes.data ?? []).map((it: any) => ({
    ...it,
    valor_unitario_orcado: Number(it.valor_unitario_orcado ?? 0),
    quantidade_orcada: Number(it.quantidade_orcada ?? 1),
    dias_meses_orcado: Number(it.dias_meses_orcado ?? 1),
    total_orcado: Number(it.total_orcado ?? 0),
    valor_unitario_planejado: Number(it.valor_unitario_planejado ?? 0),
    quantidade_planejada: Number(it.quantidade_planejada ?? 0),
    dias_meses_planejado: Number(it.dias_meses_planejado ?? 0),
    total_planejado: Number(it.total_planejado ?? 0),
  }));
  const realizados = (realizadosRes.data ?? []).map((r: any) => ({
    ...r,
    valor_unitario_realizado: Number(r.valor_unitario_realizado ?? 0),
    quantidade_realizada: Number(r.quantidade_realizada ?? 0),
    dias_meses_realizado: Number(r.dias_meses_realizado ?? 0),
    total_realizado: Number(r.total_realizado ?? 0),
  })) as JobItemRealizado[];

  const realizadosMap = new Map<string, JobItemRealizado>();
  for (const r of realizados) realizadosMap.set(r.item_id, r);

  const versaoAprovada = raw.versao as {
    id: string;
    numero_versao: number;
    nome: string | null;
    moeda: string;
    percentual_honorarios: number;
    percentual_imposto: number;
  };

  const podeEditarRealizado =
    (session.activeRole === "administrador" ||
      job.responsavel_id === session.profile.id) &&
    (job.status === "aberto" || job.status === "em_producao");
```

d) No JSX, DEPOIS do card "Status" (último bloco condicional que renderiza `<StatusActions>`), adicionar (fora do `<div className="grid gap-4 md:grid-cols-2">`, dentro do `<div className="space-y-6 max-w-5xl mx-auto">` externo):

```tsx
      <JobRealizadoSection
        job={{
          id: job.id,
          status: job.status,
          projeto_id: job.projeto_id,
          orcamento_id: job.orcamento_id,
          versao_orcamento_aprovada_id: job.versao_orcamento_aprovada_id,
        }}
        versao={{
          id: versaoAprovada.id,
          numero_versao: versaoAprovada.numero_versao,
          nome: versaoAprovada.nome,
          moeda: versaoAprovada.moeda,
          percentual_honorarios: Number(versaoAprovada.percentual_honorarios),
          percentual_imposto: Number(versaoAprovada.percentual_imposto),
        }}
        grupos={grupos}
        itens={itens}
        realizadosMap={realizadosMap}
        editable={podeEditarRealizado}
      />
```

Cuidado: o wrapper de largura da página atual é `max-w-5xl mx-auto`. A planilha da versão usa `max-w-6xl`. Se a planilha do job ficar apertada em `max-w-5xl`, considerar trocar pra `max-w-6xl` — mas isso pode mexer no layout dos cards de metadata acima. **Decisão pra esta task: manter `max-w-5xl`.** Se apertar, resolver na Task 6 quando a tabela existir.

- [ ] **Step 4: Typecheck + Lint**

```powershell
npm run typecheck; if ($?) { npm run lint }
```
Esperado: ambos passam.

- [ ] **Step 5: QA manual — /jobs/[jobId]**

Abrir um job em `aberto` → deve aparecer, depois de "Status", a seção com:
- Header "Planilha do job · v{N}" + link "Ver versao aprovada →"
- Cards de grupo com stub "Tabela de itens ... sera renderizada aqui — Task 6"

Abrir um job em `aguardando_abertura` (rejeita a aprovação financeira pra testar) → card cinza "Realizado indisponivel · Aguarde a aprovacao do financeiro para lancar valores realizados."

Abrir um job em `finalizado` (mudar status via `<StatusActions>`) → mesma seção aparece, mas ainda com stub. Editable deve ser `false` (verificar via React DevTools ou console — vai importar na Task 6).

- [ ] **Step 6: Commit**

```powershell
git add "app/(app)/jobs/[jobId]/page.tsx" "app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx" "app/(app)/jobs/[jobId]/realizado/job-grupo-card.tsx"
git commit -m "task008: seccao Realizado no /jobs/[jobId] com card por grupo (stub de tabela)"
```

---

## Task 6: Tabela editável `<JobItemRealizadoTable>` + wire-up no `<JobGrupoCard>`

**Files:**
- Create: `app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx`
- Modify: `app/(app)/jobs/[jobId]/realizado/job-grupo-card.tsx` (substituir stub pela tabela real)

**Interfaces:**
- Consumes:
  - `upsertItemRealizado`, `CampoRealizado` de `../actions-realizado`.
  - `calcularVariacao` de `@/lib/calculos/versao-totais`.
  - Types `VersaoOrcamentoItem`, `JobItemRealizado` de `@/lib/types`.
  - Helper `formatCurrency` de `@/lib/utils`.
- Produces:
  - `<JobItemRealizadoTable jobId={...} itens={...} realizadosMap={...} moeda={...} editable={...} />` — tabela client com click-to-edit no bloco REALIZADO.

- [ ] **Step 1: Criar `job-item-realizado-table.tsx`**

Componente client. Estrutura simplificada (menos flexível que `itens-table.tsx` da versão, mas com o mesmo padrão visual: `h-9` de altura fixa, blocos coloridos, células que viram input em edição). Sem categoria/tipo editáveis (read-only sempre). Sem trilha de ações à direita.

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { calcularVariacao } from "@/lib/calculos/versao-totais";
import type { VersaoOrcamentoItem, JobItemRealizado } from "@/lib/types";
import { upsertItemRealizado, type CampoRealizado } from "../actions-realizado";

interface Props {
  jobId: string;
  itens: VersaoOrcamentoItem[];
  realizadosMap: Map<string, JobItemRealizado>;
  moeda: string;
  editable: boolean;
}

type CelulaAtiva = { itemId: string; campo: CampoRealizado } | null;
type Overrides = Record<string, Partial<Record<CampoRealizado, number>>>;

const ALTURA_LINHA = "h-9";
const LARGURA_MINIMA = "min-w-[1100px]";

const GRADE_NEUTRA = "border-r border-r-[#f1f1f1]";
const GRADE_ORCADO = "border-r border-r-[#eceae5]";
const GRADE_PLANEJADO = "border-r border-r-[#e6eff9]";
const GRADE_REALIZADO = "border-r border-r-[#fde8b8]";
const GRADE_VARIACAO = "border-r border-r-[#d9efe3]";

const CAMPO_CLASSES =
  "h-7 w-full rounded-lg border border-california-red bg-white px-2 text-xs text-foreground outline-none ring-2 ring-california-red/15";

function parseNumero(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function paraEdicao(valor: number): string {
  return String(valor).replace(".", ",");
}

function formatarPercentual(p: number): string {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

function ColunasFixas() {
  return (
    <colgroup>
      <col />
      <col className="w-[5%]" />
      {/* Orcado */}
      <col className="w-[9%]" />
      <col className="w-[4%]" />
      <col className="w-[4%]" />
      <col className="w-[10%]" />
      {/* Planejado */}
      <col className="w-[9%]" />
      <col className="w-[4%]" />
      <col className="w-[4%]" />
      <col className="w-[10%]" />
      {/* Realizado */}
      <col className="w-[9%]" />
      <col className="w-[4%]" />
      <col className="w-[4%]" />
      <col className="w-[10%]" />
      {/* Variacao */}
      <col className="w-[7%]" />
      <col className="w-[6%]" />
    </colgroup>
  );
}

export function JobItemRealizadoTable({
  jobId,
  itens,
  realizadosMap,
  moeda,
  editable,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [ativa, setAtiva] = React.useState<CelulaAtiva>(null);
  const [overrides, setOverrides] = React.useState<Overrides>({});
  const [erro, setErro] = React.useState<string | null>(null);

  // Descarta overrides quando o servidor devolve o mesmo valor.
  React.useEffect(() => {
    setOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next: Overrides = {};
      for (const item of itens) {
        const campos = prev[item.id];
        if (!campos) continue;
        const realizado = realizadosMap.get(item.id);
        const restante: Partial<Record<CampoRealizado, number>> = {};
        for (const [campo, valor] of Object.entries(campos)) {
          const doServidor = realizado
            ? Number(realizado[campo as CampoRealizado] ?? 0)
            : 0;
          if (doServidor !== valor) {
            restante[campo as CampoRealizado] = valor as number;
          }
        }
        if (Object.keys(restante).length > 0) next[item.id] = restante;
      }
      return next;
    });
  }, [itens, realizadosMap]);

  function valorRealizado(itemId: string, campo: CampoRealizado): number {
    const override = overrides[itemId]?.[campo];
    if (override !== undefined) return override;
    const r = realizadosMap.get(itemId);
    return r ? Number(r[campo] ?? 0) : 0;
  }

  function totalRealizadoDe(itemId: string): number {
    const override = overrides[itemId];
    if (override) {
      const v = valorRealizado(itemId, "valor_unitario_realizado");
      const q = valorRealizado(itemId, "quantidade_realizada");
      const d = valorRealizado(itemId, "dias_meses_realizado");
      return v * q * d;
    }
    const r = realizadosMap.get(itemId);
    return r ? Number(r.total_realizado ?? 0) : 0;
  }

  function confirmarNumero(itemId: string, campo: CampoRealizado, raw: string) {
    const n = parseNumero(raw);
    if (n === null) {
      setAtiva(null);
      setErro("Valor invalido — a celula foi mantida como estava.");
      return;
    }
    if (n < 0) {
      setAtiva(null);
      setErro("Valor nao pode ser negativo.");
      return;
    }
    if (n === valorRealizado(itemId, campo)) {
      setAtiva(null);
      return;
    }
    gravar(itemId, campo, n);
  }

  function gravar(itemId: string, campo: CampoRealizado, valor: number) {
    const anterior = overrides[itemId];
    setErro(null);
    setAtiva(null);
    setOverrides((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [campo]: valor },
    }));

    const reverter = () =>
      setOverrides((prev) => {
        const next = { ...prev };
        if (anterior) next[itemId] = anterior;
        else delete next[itemId];
        return next;
      });

    startTransition(async () => {
      try {
        const res = await upsertItemRealizado(jobId, itemId, campo, String(valor));
        if (!res.ok) {
          reverter();
          setErro(res.message);
          return;
        }
        router.refresh();
      } catch (e) {
        reverter();
        throw e;
      }
    });
  }

  const subtotais = React.useMemo(() => {
    let orcado = 0;
    let planejado = 0;
    let realizado = 0;
    for (const it of itens) {
      orcado += Number(it.total_orcado ?? 0);
      planejado += Number(it.total_planejado ?? 0);
      realizado += totalRealizadoDe(it.id);
    }
    return { orcado, planejado, realizado };
  }, [itens, overrides, realizadosMap]);

  const { variacaoRS: varSubRS, variacaoPct: varSubPct } = calcularVariacao(
    subtotais.realizado,
    subtotais.planejado,
  );

  return (
    <>
      {erro && (
        <div className="flex items-center justify-between gap-3 border-b border-california-red/20 bg-california-red/5 px-6 py-2 text-xs text-california-red">
          <span>{erro}</span>
          <button
            type="button"
            onClick={() => setErro(null)}
            className="rounded-md p-1 hover:bg-california-red/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-b-2xl">
        <table
          className={cn("w-full table-fixed text-sm border-collapse", LARGURA_MINIMA)}
        >
          <ColunasFixas />
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th colSpan={2} className="bg-muted/40 border-b border-border" />
              <th
                colSpan={4}
                className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] normal-case text-foreground bg-[#f1f0ec] border-b-[3px] border-b-[#282828] border-l-2 border-l-[#d7d7d7]"
              >
                ORCADO
              </th>
              <th
                colSpan={4}
                className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] normal-case text-[#1e4fa3] bg-[#e8f0fd] border-b-[3px] border-b-[#2f6fdb] border-l-2 border-l-[#b9d1f4]"
              >
                PLANEJADO
              </th>
              <th
                colSpan={4}
                className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] normal-case text-[#92400e] bg-[#fef3c7] border-b-[3px] border-b-[#d97706] border-l-2 border-l-[#f0c874]"
              >
                REALIZADO
              </th>
              <th
                colSpan={2}
                className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.08em] normal-case text-emerald-700 bg-emerald-50 border-b-[3px] border-b-emerald-600 border-l-2 border-l-[#d7d7d7]"
              >
                VARIACAO
              </th>
            </tr>
            <tr className="bg-muted/40">
              <th className="text-left font-semibold px-3 py-2 border-r border-r-border">Item</th>
              <th className="text-left font-semibold px-3 py-2 border-r border-r-border">Tipo</th>
              {/* Orcado */}
              <th className="text-right font-semibold px-3 py-2 border-l-2 border-l-[#e4e2dd] border-r border-r-border">R$ Unit.</th>
              <th className="text-right font-semibold px-3 py-2 border-r border-r-border">QT</th>
              <th className="text-right font-semibold px-3 py-2 border-r border-r-border">D/M</th>
              <th className="text-right font-semibold px-3 py-2">Total</th>
              {/* Planejado */}
              <th className="text-right font-semibold px-3 py-2 bg-blue-50/60 text-[#5a76a8] border-l-2 border-l-[#cfe0f7] border-r border-r-[#dfeafb]">R$ Unit.</th>
              <th className="text-right font-semibold px-3 py-2 bg-blue-50/60 text-[#5a76a8] border-r border-r-[#dfeafb]">QT</th>
              <th className="text-right font-semibold px-3 py-2 bg-blue-50/60 text-[#5a76a8] border-r border-r-[#dfeafb]">D/M</th>
              <th className="text-right font-semibold px-3 py-2 bg-blue-50/60 text-[#5a76a8]">Total</th>
              {/* Realizado */}
              <th className="text-right font-semibold px-3 py-2 bg-[#fef3c7]/70 text-[#92400e] border-l-2 border-l-[#f0c874] border-r border-r-[#fde8b8]">R$ Unit.</th>
              <th className="text-right font-semibold px-3 py-2 bg-[#fef3c7]/70 text-[#92400e] border-r border-r-[#fde8b8]">QT</th>
              <th className="text-right font-semibold px-3 py-2 bg-[#fef3c7]/70 text-[#92400e] border-r border-r-[#fde8b8]">D/M</th>
              <th className="text-right font-semibold px-3 py-2 bg-[#fef3c7]/70 text-[#92400e]">Total</th>
              {/* Variacao */}
              <th className="text-right font-semibold px-3 py-2 bg-emerald-50/50 text-emerald-800/70 border-l border-l-border border-r border-r-[#d9efe3]">R$</th>
              <th className="text-right font-semibold px-3 py-2 bg-emerald-50/50 text-emerald-800/70">%</th>
            </tr>
          </thead>

          <tbody>
            {itens.length === 0 && (
              <tr>
                <td colSpan={16} className="py-8 text-center text-sm text-muted-foreground">
                  Sem itens neste grupo.
                </td>
              </tr>
            )}
            {itens.map((item) => {
              const totalReal = totalRealizadoDe(item.id);
              const { variacaoRS, variacaoPct } = calcularVariacao(
                totalReal,
                Number(item.total_planejado ?? 0),
              );
              const semPlanejado = Number(item.total_planejado ?? 0) <= 0;
              const cor = variacaoRS > 0 ? "text-california-red" : "text-emerald-700";
              const ativaAqui = (campo: CampoRealizado) =>
                ativa?.itemId === item.id && ativa.campo === campo;

              return (
                <tr key={item.id} className={cn(ALTURA_LINHA, "border-b border-border")}>
                  <td className={cn("px-3 text-xs align-middle", GRADE_NEUTRA)}>
                    <div className="truncate" title={item.item}>{item.item}</div>
                  </td>
                  <td className={cn("px-3 text-xs align-middle", GRADE_NEUTRA)}>
                    <Badge variant="outline">{item.tipo_custo}</Badge>
                  </td>
                  {/* Orcado (RO) */}
                  <td className={cn("px-3 text-right text-xs font-mono align-middle bg-black/[0.015] border-l-2 border-l-[#e4e2dd]", GRADE_ORCADO)}>
                    {formatCurrency(Number(item.valor_unitario_orcado ?? 0), moeda)}
                  </td>
                  <td className={cn("px-3 text-right text-xs align-middle bg-black/[0.015]", GRADE_ORCADO)}>
                    {Number(item.quantidade_orcada ?? 0)}
                  </td>
                  <td className={cn("px-3 text-right text-xs align-middle bg-black/[0.015]", GRADE_ORCADO)}>
                    {Number(item.dias_meses_orcado ?? 0)}
                  </td>
                  <td className="px-3 text-right text-xs font-mono font-semibold align-middle bg-black/[0.015] whitespace-nowrap">
                    {formatCurrency(Number(item.total_orcado ?? 0), moeda)}
                  </td>
                  {/* Planejado (RO) */}
                  <td className={cn("px-3 text-right text-xs font-mono align-middle bg-blue-50/40 border-l-2 border-l-[#cfe0f7]", GRADE_PLANEJADO)}>
                    {Number(item.valor_unitario_planejado ?? 0) > 0
                      ? formatCurrency(Number(item.valor_unitario_planejado), moeda)
                      : "—"}
                  </td>
                  <td className={cn("px-3 text-right text-xs align-middle bg-blue-50/40", GRADE_PLANEJADO)}>
                    {Number(item.quantidade_planejada ?? 0) > 0
                      ? Number(item.quantidade_planejada)
                      : "—"}
                  </td>
                  <td className={cn("px-3 text-right text-xs align-middle bg-blue-50/40", GRADE_PLANEJADO)}>
                    {Number(item.dias_meses_planejado ?? 0) > 0
                      ? Number(item.dias_meses_planejado)
                      : "—"}
                  </td>
                  <td className="px-3 text-right text-xs font-mono font-semibold align-middle bg-blue-50/40 whitespace-nowrap">
                    {Number(item.total_planejado ?? 0) > 0
                      ? formatCurrency(Number(item.total_planejado), moeda)
                      : "—"}
                  </td>
                  {/* Realizado (editavel) */}
                  <CelulaRealNum
                    valor={valorRealizado(item.id, "valor_unitario_realizado")}
                    formato="moeda"
                    moeda={moeda}
                    editando={ativaAqui("valor_unitario_realizado")}
                    editavel={editable}
                    onAtivar={() => setAtiva({ itemId: item.id, campo: "valor_unitario_realizado" })}
                    onConfirmar={(raw) => confirmarNumero(item.id, "valor_unitario_realizado", raw)}
                    onCancelar={() => setAtiva(null)}
                    tdClassName={cn("bg-[#fef3c7]/40 border-l-2 border-l-[#f0c874] font-mono", GRADE_REALIZADO)}
                  />
                  <CelulaRealNum
                    valor={valorRealizado(item.id, "quantidade_realizada")}
                    editando={ativaAqui("quantidade_realizada")}
                    editavel={editable}
                    onAtivar={() => setAtiva({ itemId: item.id, campo: "quantidade_realizada" })}
                    onConfirmar={(raw) => confirmarNumero(item.id, "quantidade_realizada", raw)}
                    onCancelar={() => setAtiva(null)}
                    tdClassName={cn("bg-[#fef3c7]/40", GRADE_REALIZADO)}
                  />
                  <CelulaRealNum
                    valor={valorRealizado(item.id, "dias_meses_realizado")}
                    editando={ativaAqui("dias_meses_realizado")}
                    editavel={editable}
                    onAtivar={() => setAtiva({ itemId: item.id, campo: "dias_meses_realizado" })}
                    onConfirmar={(raw) => confirmarNumero(item.id, "dias_meses_realizado", raw)}
                    onCancelar={() => setAtiva(null)}
                    tdClassName={cn("bg-[#fef3c7]/40", GRADE_REALIZADO)}
                  />
                  <td className="px-3 text-right text-xs font-mono font-semibold align-middle bg-[#fef3c7]/40 whitespace-nowrap">
                    {totalReal > 0 ? formatCurrency(totalReal, moeda) : "—"}
                  </td>
                  {/* Variacao */}
                  <td className={cn("px-3 text-right text-xs font-mono align-middle whitespace-nowrap border-l-2 border-l-[#e4e2dd]", GRADE_VARIACAO)}>
                    {semPlanejado ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={cor}>{formatCurrency(variacaoRS, moeda)}</span>
                    )}
                  </td>
                  <td className="px-3 text-right text-xs font-mono align-middle whitespace-nowrap">
                    {variacaoPct === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={cor}>{formatarPercentual(variacaoPct)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr>
              <td colSpan={2} className="px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Subtotal do grupo
              </td>
              <td colSpan={3} className="bg-[#f1f0ec] border-l-2 border-l-[#d7d7d7] border-t-2 border-t-[#282828]" />
              <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold text-foreground bg-[#f1f0ec] border-t-2 border-t-[#282828]">
                {formatCurrency(subtotais.orcado, moeda)}
              </td>
              <td colSpan={3} className="bg-[#e8f0fd] border-l-2 border-l-[#b9d1f4] border-t-2 border-t-[#2f6fdb]" />
              <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold text-[#1e4fa3] bg-[#e8f0fd] border-t-2 border-t-[#2f6fdb]">
                {formatCurrency(subtotais.planejado, moeda)}
              </td>
              <td colSpan={3} className="bg-[#fef3c7] border-l-2 border-l-[#f0c874] border-t-2 border-t-[#d97706]" />
              <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold text-[#92400e] bg-[#fef3c7] border-t-2 border-t-[#d97706]">
                {subtotais.realizado > 0 ? formatCurrency(subtotais.realizado, moeda) : "—"}
              </td>
              <td className={cn("px-3 py-3 text-right whitespace-nowrap font-mono text-xs font-semibold bg-emerald-50 border-l-2 border-l-[#d7d7d7] border-t-2 border-t-emerald-600", varSubRS > 0 ? "text-california-red" : "text-emerald-700")}>
                {subtotais.planejado <= 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatCurrency(varSubRS, moeda)
                )}
              </td>
              <td className={cn("px-3 py-3 text-right whitespace-nowrap font-mono text-xs font-semibold bg-emerald-50 border-t-2 border-t-emerald-600", varSubRS > 0 ? "text-california-red" : "text-emerald-700")}>
                {varSubPct === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatarPercentual(varSubPct)
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editable && (
        <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/40 px-6 py-3 rounded-b-2xl">
          <span className="text-[11px] text-muted-foreground">
            Clique em qualquer celula do bloco Realizado para editar ·{" "}
            <kbd className="font-mono">Enter</kbd> confirma ·{" "}
            <kbd className="font-mono">Esc</kbd> desfaz
          </span>
        </div>
      )}
    </>
  );
}

function CelulaRealNum({
  valor,
  formato,
  moeda,
  editando,
  editavel,
  onAtivar,
  onConfirmar,
  onCancelar,
  tdClassName,
}: {
  valor: number;
  formato?: "moeda";
  moeda?: string;
  editando: boolean;
  editavel: boolean;
  onAtivar: () => void;
  onConfirmar: (raw: string) => void;
  onCancelar: () => void;
  tdClassName?: string;
}) {
  const finalizado = React.useRef(false);

  if (editando) {
    return (
      <td className={cn("text-xs align-middle px-1.5", tdClassName)}>
        <input
          autoFocus
          inputMode="decimal"
          defaultValue={paraEdicao(valor)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finalizado.current = true;
              onConfirmar(e.currentTarget.value);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              finalizado.current = true;
              onCancelar();
            }
          }}
          onBlur={(e) => {
            if (!finalizado.current) onConfirmar(e.currentTarget.value);
          }}
          className={cn(CAMPO_CLASSES, "text-right font-mono")}
        />
      </td>
    );
  }

  const mostrarTraco = valor <= 0;

  return (
    <td
      className={cn(
        "text-xs align-middle px-3 text-right whitespace-nowrap",
        tdClassName,
        editavel && "cursor-pointer",
        mostrarTraco && "text-muted-foreground",
      )}
      onClick={editavel ? onAtivar : undefined}
    >
      {mostrarTraco
        ? "—"
        : formato === "moeda"
          ? formatCurrency(valor, moeda)
          : valor}
    </td>
  );
}
```

- [ ] **Step 2: Substituir stub em `job-grupo-card.tsx` pela tabela real**

Sobrescrever o conteúdo de `app/(app)/jobs/[jobId]/realizado/job-grupo-card.tsx`:

```tsx
import type {
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  JobItemRealizado,
} from "@/lib/types";
import { JobItemRealizadoTable } from "./job-item-realizado-table";

interface Props {
  grupo: VersaoOrcamentoGrupo;
  itens: VersaoOrcamentoItem[];
  realizadosMap: Map<string, JobItemRealizado>;
  moeda: string;
  editable: boolean;
  jobId: string;
}

export function JobGrupoCard({
  grupo,
  itens,
  realizadosMap,
  moeda,
  editable,
  jobId,
}: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-border bg-muted/40 px-6 py-4">
        <h3 className="text-base font-semibold text-foreground truncate">
          {grupo.nome}
        </h3>
        <span className="text-xs text-muted-foreground">
          {itens.length} {itens.length === 1 ? "item" : "itens"}
        </span>
      </div>
      <JobItemRealizadoTable
        jobId={jobId}
        itens={itens}
        realizadosMap={realizadosMap}
        moeda={moeda}
        editable={editable}
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + Lint**

```powershell
npm run typecheck; if ($?) { npm run lint }
```
Esperado: ambos passam.

- [ ] **Step 4: QA manual — editar realizado**

Com um job em `aberto` (responsável = user logado OU admin):

1. Abrir `/jobs/[jobId]` → planilha renderiza com 4 blocos + variação.
2. Clicar numa célula do bloco REALIZADO (ex: R$ Unit do primeiro item). Input aparece.
3. Digitar `1500,00`, `Enter`. Valor salvo, célula fecha, total da linha recalcula, subtotal do grupo recalcula, variação atualiza (vermelho se estourou, verde se dentro).
4. Digitar `Esc` → cancela sem salvar.
5. Preencher os 3 campos (Valor / QT / D/M) de um item → total da linha = v×q×d.
6. Preencher realizado > planejado → variação em VERMELHO (R$ e %).
7. Preencher realizado < planejado → variação em VERDE.
8. Item sem planejado (0) → variação mostra `—`.
9. Mudar status pra `finalizado` → recarregar → células não são mais clicáveis (cursor default, sem borda de foco no hover).
10. Como GP **não responsável**: mudar responsavel_id via SQL rápido, recarregar → não consegue editar; erro "Apenas o responsavel..." se tentar (mas botão nem aparece se `editable=false`).
11. Voltar responsavel_id.

**Verificação do audit_events:**
```sql
select acao, entidade_id, metadata, created_at
from audit_events
where acao = 'job.realizado_atualizado'
order by created_at desc limit 5;
```
Deve mostrar linhas com metadata `{ item_id, campo, valor_novo, valor_anterior }`.

- [ ] **Step 5: Commit**

```powershell
git add "app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx" "app/(app)/jobs/[jobId]/realizado/job-grupo-card.tsx"
git commit -m "task008: tabela do realizado com click-to-edit + upsert via server action"
```

---

## Task 7: `<JobTotaisCard>` (totais com 3 colunas + variação + resultado real)

**Files:**
- Create: `app/(app)/jobs/[jobId]/realizado/job-totais-card.tsx`
- Modify: `app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx` (renderizar `<JobTotaisCard>` no fim da seção)

**Interfaces:**
- Consumes:
  - `calcularTotaisVersao`, `calcularTotaisPlanejados`, `calcularTotaisRealizado`, `calcularVariacao` de `@/lib/calculos/versao-totais`.
  - Types `VersaoOrcamentoGrupo`, `VersaoOrcamentoItem`, `JobItemRealizado`, `TipoCusto`, `tipoCustoLabel` de `@/lib/types`.
  - Helper `formatCurrency`.
- Produces:
  - `<JobTotaisCard grupos itens realizadosMap percentualHonorarios percentualImposto moeda />` — card com 3 colunas ORÇADO/PLANEJADO/REALIZADO + linha "Total Realizado" + "Variação vs Planejado" + "Resultado Real".

- [ ] **Step 1: Criar `job-totais-card.tsx`**

```tsx
import { Calculator } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  calcularTotaisVersao,
  calcularTotaisPlanejados,
  calcularTotaisRealizado,
  calcularVariacao,
} from "@/lib/calculos/versao-totais";
import {
  tipoCustoLabel,
  type TipoCusto,
  type VersaoOrcamentoGrupo,
  type VersaoOrcamentoItem,
  type JobItemRealizado,
} from "@/lib/types";

interface Props {
  grupos: VersaoOrcamentoGrupo[];
  itens: VersaoOrcamentoItem[];
  realizadosMap: Map<string, JobItemRealizado>;
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
}

const TIPOS: TipoCusto[] = ["A", "B", "C", "D"];

const CELULA_ORCADO = "border-l-2 border-l-[#e4e2dd] bg-black/[0.015]";
const CELULA_PLANEJADO = "border-l-2 border-l-[#cfe0f7] bg-[#f7fbff]";
const CELULA_REALIZADO = "border-l-2 border-l-[#f0c874] bg-[#fefbf0]";

function formatarPercentual(p: number): string {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

export function JobTotaisCard({
  grupos,
  itens,
  realizadosMap,
  percentualHonorarios,
  percentualImposto,
  moeda,
}: Props) {
  const {
    subtotaisPorTipo,
    subtotalGeral,
    honorarios,
    imposto,
    faturamento,
  } = calcularTotaisVersao(itens, percentualHonorarios, percentualImposto);

  const { totalPlanejado } = calcularTotaisPlanejados(itens);

  // Enriquece itens com total_realizado do map (0 se sem lancamento)
  const itensComRealizado = itens.map((it) => {
    const r = realizadosMap.get(it.id);
    return { total_realizado: r ? Number(r.total_realizado ?? 0) : 0 };
  });
  const { totalRealizado } = calcularTotaisRealizado(itensComRealizado);

  // Agrupamentos por grupo
  const linhas = grupos.map((g) => {
    const itensDoGrupo = itens.filter((i) => i.grupo_id === g.id);
    const orcadoGrp = itensDoGrupo.reduce(
      (s, i) => s + Number(i.total_orcado ?? 0),
      0,
    );
    const planejadoGrp = itensDoGrupo.reduce(
      (s, i) => s + Number(i.total_planejado ?? 0),
      0,
    );
    const realizadoGrp = itensDoGrupo.reduce((s, i) => {
      const r = realizadosMap.get(i.id);
      return s + (r ? Number(r.total_realizado ?? 0) : 0);
    }, 0);
    return {
      id: g.id,
      nome: g.nome,
      orcado: orcadoGrp,
      planejado: planejadoGrp,
      realizado: realizadoGrp,
    };
  });

  const realizadoPorTipo: Record<TipoCusto, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const it of itens) {
    const r = realizadosMap.get(it.id);
    if (r) {
      realizadoPorTipo[it.tipo_custo] += Number(r.total_realizado ?? 0);
    }
  }

  const planejadoPorTipo: Record<TipoCusto, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const it of itens) {
    planejadoPorTipo[it.tipo_custo] += Number(it.total_planejado ?? 0);
  }

  const { variacaoRS, variacaoPct } = calcularVariacao(
    totalRealizado,
    totalPlanejado,
  );

  const resultadoReal =
    totalRealizado > 0 ? faturamento - imposto - totalRealizado : null;
  const resultadoPct =
    resultadoReal !== null && faturamento > 0
      ? (resultadoReal / faturamento) * 100
      : null;

  const corVariacao = variacaoRS > 0 ? "text-california-red" : "text-emerald-700";

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center gap-2 border-b border-border p-6">
        <Calculator className="h-5 w-5 text-california-red" />
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Totais do job
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Orcado x Planejado x Realizado — comparacao lado a lado.
          </p>
        </div>
      </div>

      {/* Camada 1: por grupo */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="bg-muted/40 border-b border-border" />
              <th className="text-center px-4 py-2 text-[11px] font-extrabold tracking-[0.1em] text-foreground bg-[#f1f0ec] border-b-[3px] border-b-[#282828] border-l-2 border-l-[#d7d7d7]">
                ORCADO
              </th>
              <th className="text-center px-4 py-2 text-[11px] font-extrabold tracking-[0.1em] text-[#1e4fa3] bg-[#e8f0fd] border-b-[3px] border-b-[#2f6fdb] border-l-2 border-l-[#b9d1f4]">
                PLANEJADO
              </th>
              <th className="text-center px-4 py-2 text-[11px] font-extrabold tracking-[0.1em] text-[#92400e] bg-[#fef3c7] border-b-[3px] border-b-[#d97706] border-l-2 border-l-[#f0c874]">
                REALIZADO
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border">
                <td className="px-4 py-2 text-sm text-muted-foreground">{l.nome}</td>
                <td className={cn("px-4 py-2 text-right font-mono text-sm", CELULA_ORCADO)}>
                  {formatCurrency(l.orcado, moeda)}
                </td>
                <td className={cn("px-4 py-2 text-right font-mono text-sm", CELULA_PLANEJADO)}>
                  {l.planejado > 0 ? formatCurrency(l.planejado, moeda) : "—"}
                </td>
                <td className={cn("px-4 py-2 text-right font-mono text-sm", CELULA_REALIZADO)}>
                  {l.realizado > 0 ? formatCurrency(l.realizado, moeda) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-t-border">
              <td className="px-4 py-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Subtotal geral
              </td>
              <td className={cn("px-4 py-3 text-right font-mono text-sm font-bold", CELULA_ORCADO)}>
                {formatCurrency(subtotalGeral, moeda)}
              </td>
              <td className={cn("px-4 py-3 text-right font-mono text-sm font-bold text-[#1e4fa3]", CELULA_PLANEJADO)}>
                {totalPlanejado > 0 ? formatCurrency(totalPlanejado, moeda) : "—"}
              </td>
              <td className={cn("px-4 py-3 text-right font-mono text-sm font-bold text-[#92400e]", CELULA_REALIZADO)}>
                {totalRealizado > 0 ? formatCurrency(totalRealizado, moeda) : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Camada 2: por tipo de custo */}
      <div className="border-t border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="bg-muted/20 border-b border-border" />
              <th className="text-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 border-b border-border">
                ORCADO
              </th>
              <th className="text-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 border-b border-border">
                PLANEJADO
              </th>
              <th className="text-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 border-b border-border">
                REALIZADO
              </th>
            </tr>
          </thead>
          <tbody>
            {TIPOS.map((t) => (
              <tr key={t} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {tipoCustoLabel(t)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {formatCurrency(subtotaisPorTipo[t], moeda)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {planejadoPorTipo[t] > 0
                    ? formatCurrency(planejadoPorTipo[t], moeda)
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {realizadoPorTipo[t] > 0
                    ? formatCurrency(realizadoPorTipo[t], moeda)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Camada 3: honorarios, impostos, faturamento */}
      <div className="border-t border-border grid grid-cols-3 gap-4 p-6 bg-muted/10">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Honorarios</p>
          <p className="mt-1 font-mono text-sm font-semibold">
            {formatCurrency(honorarios, moeda)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Impostos (gross-up)</p>
          <p className="mt-1 font-mono text-sm font-semibold">
            {formatCurrency(imposto, moeda)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Faturamento</p>
          <p className="mt-1 font-mono text-sm font-semibold text-california-red">
            {formatCurrency(faturamento, moeda)}
          </p>
        </div>
      </div>

      {/* Camada 4: resumo do realizado */}
      <div className="border-t border-border p-6 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total Realizado</span>
          <span className="font-mono text-base font-bold text-[#92400e]">
            {totalRealizado > 0 ? formatCurrency(totalRealizado, moeda) : "—"}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Variacao vs Planejado</span>
          <span className={cn("font-mono text-base font-bold", corVariacao)}>
            {totalPlanejado <= 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <>
                {formatCurrency(variacaoRS, moeda)}{" "}
                {variacaoPct !== null && (
                  <span className="text-sm">({formatarPercentual(variacaoPct)})</span>
                )}
              </>
            )}
          </span>
        </div>
        <div className="flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm font-semibold">
            Resultado Real
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              (Faturamento − Impostos − Realizado)
            </span>
          </span>
          <span className={cn(
            "font-mono text-lg font-extrabold",
            resultadoReal === null
              ? "text-muted-foreground"
              : resultadoReal >= 0
                ? "text-emerald-700"
                : "text-california-red",
          )}>
            {resultadoReal === null
              ? "—"
              : (
                <>
                  {formatCurrency(resultadoReal, moeda)}{" "}
                  {resultadoPct !== null && (
                    <span className="text-sm">({formatarPercentual(resultadoPct)})</span>
                  )}
                </>
              )}
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Renderizar `<JobTotaisCard>` no fim de `<JobRealizadoSection>`**

Em `app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx`:

a) Adicionar import no topo:
```tsx
import { JobTotaisCard } from "./job-totais-card";
```

b) Depois do `</div>` que fecha o loop de `grupos.map(...)`, mas ANTES do `</div>` externo do wrapper `space-y-4`, adicionar (dentro do bloco `grupos.length === 0 ? ... : (...)` — no ramo `else`, depois do último `</div>`):

```tsx
      {grupos.length > 0 && (
        <JobTotaisCard
          grupos={grupos}
          itens={itens}
          realizadosMap={realizadosMap}
          percentualHonorarios={versao.percentual_honorarios}
          percentualImposto={versao.percentual_imposto}
          moeda={versao.moeda}
        />
      )}
```

Ajuste concreto: mover o `<JobTotaisCard>` pra fora do bloco condicional atual e renderizar sempre que `grupos.length > 0` no fim do return principal — reestruturar assim:

```tsx
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {/* header ... (igual antes) */}
      </div>

      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed ...">
          <p className="text-sm text-muted-foreground">
            A versao aprovada nao tem grupos.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {grupos.map((g) => (
              <JobGrupoCard
                key={g.id}
                grupo={g}
                itens={itensPorGrupo.get(g.id) ?? []}
                realizadosMap={realizadosMap}
                moeda={versao.moeda}
                editable={editable}
                jobId={job.id}
              />
            ))}
          </div>
          <JobTotaisCard
            grupos={grupos}
            itens={itens}
            realizadosMap={realizadosMap}
            percentualHonorarios={versao.percentual_honorarios}
            percentualImposto={versao.percentual_imposto}
            moeda={versao.moeda}
          />
        </>
      )}
    </div>
  );
```

- [ ] **Step 3: Typecheck + Lint**

```powershell
npm run typecheck; if ($?) { npm run lint }
```
Esperado: ambos passam.

- [ ] **Step 4: QA manual — Totais**

Voltar pro job em `aberto`:
1. Card "Totais do job" aparece embaixo de todos os grupos.
2. Camada 1 (por grupo): 3 colunas, valores batem com subtotais das tabelas de cada grupo.
3. Camada 2 (por Tipo A/B/C/D): coluna Orçado bate com o card da versão original; Planejado e Realizado somam corretamente por tipo.
4. Camada 3: Honorários, Impostos e Faturamento iguais aos da versão aprovada.
5. Camada 4:
   - "Total Realizado" = soma dos realizados de todos os grupos.
   - "Variação vs Planejado" — se Realizado > Planejado, vermelho; senão verde. Se Planejado = 0, mostra "—".
   - "Resultado Real" = Faturamento − Impostos − Realizado. Se Realizado = 0, mostra "—".
   - Cores: verde se ≥ 0, vermelho se < 0.
6. Sem realizado ainda: "Total Realizado", "Resultado Real" = "—". "Variação vs Planejado" fica com valor negativo (economia = todo o planejado) — visualmente confuso; **decisão**: mostrar "—" também quando `totalRealizado === 0` (economia total não é interessante ainda). Ajustar se necessário.

Ajuste do step 6 se necessário: em `JobTotaisCard`, no bloco `Variacao vs Planejado`, mudar condição pra:
```tsx
{(totalPlanejado <= 0 || totalRealizado === 0) ? (
  <span className="text-muted-foreground">—</span>
) : (
  ...
)}
```
Aplicar essa mudança se for a decisão. Commitar junto.

- [ ] **Step 5: Commit**

```powershell
git add "app/(app)/jobs/[jobId]/realizado/job-totais-card.tsx" "app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx"
git commit -m "task008: card de totais do job (Orcado x Planejado x Realizado + resultado real)"
```

---

## Task 8: QA end-to-end + atualizar HANDOFF + memory

**Files:**
- Modify: `docs/HANDOFF.md` (bloco "última atualização" no topo + seção da Task 008)
- Nenhum código.

**Interfaces:**
- Consumes: tudo entregue nas Tasks 1-7.
- Produces: HANDOFF atualizado + validação de aceitação.

- [ ] **Step 1: Rodar os 12 testes de aceitação do spec**

Do arquivo `docs/superpowers/specs/2026-07-30-jobs-realizado-design.md`, seção "Testes manuais (aceitação)":

1. Aprovar uma versão com 3 grupos e ~10 itens.
2. Criar job → nasce `aguardando_abertura`. `/jobs/[jobId]` mostra card "Aguarde a aprovacao..."
3. Aprovar abertura (admin/financeiro). Job → `aberto`. Planilha editável aparece.
4. Editar célula do bloco REALIZADO. Valor persiste, linha e subtotal recalculam.
5. Preencher realizado em vários itens/grupos → subtotais e totais gerais consistentes.
6. GP não responsável → tenta editar → erro `sem_permissao` + `audit.acao_negada`.
7. Mudar pra `em_producao` → continua editável.
8. Mudar pra `finalizado` → planilha read-only.
9. Cancelar → planilha read-only, mostra histórico.
10. `/jobs` → filtros e busca funcionam.
11. Sub-job na lista → badge `Sub-job → JOB-XXXX`.
12. Vercel logs sem warnings novos (rodar localmente e ver console).

Anotar qualquer falha.

- [ ] **Step 2: Verificar performance**

- `npm run dev` + abrir `/jobs` — checar Network tab: 1 query pra Supabase (não N+1).
- Abrir um job em `aberto` com ~30 itens — timing de `[job.detail]` (adicionar `console.log` temporário se quiser, mas sem commitar). Deve ficar sub-200ms na parte do banco.
- Confirmar que `<Link>` das linhas usa `prefetch={false}` (procurar no código).

- [ ] **Step 3: Atualizar `docs/HANDOFF.md`**

a) Substituir o bloco "Última atualização" no topo por:

```markdown
**Última atualização** (2026-07-30): Task 008 Jobs + Realizado — /jobs vira lista real com filtros/busca (substitui placeholder); /jobs/[jobId] ganha secao "Planilha do job" com blocos ORCADO/PLANEJADO/REALIZADO editaveis + card de totais com Variacao vs Planejado e Resultado Real. Nova tabela `jobs_itens_realizado` (1:1 job x item da versao aprovada, GENERATED total). Server action `upsertItemRealizado` com gates status/ownership/tenant + audit `job.realizado_atualizado`.
```

b) Adicionar seção nova depois da seção "Task 007+ — Categorias de Domínio":

```markdown
### Task 008 — Jobs + Realizado
- **Lista `/jobs`**: substitui placeholder. Colunas Codigo/Nome/Projeto/Cliente/Responsavel/Inicio/Valor/Status. Chips de filtro por status + busca por nome/codigo (client-side). Linha inteira clicavel (regra da memory). Sub-jobs aparecem como linhas separadas com badge `Sub-job → JOB-XXXX`.
- **Extensao `/jobs/[jobId]`**: depois do card Status, nova secao "Planilha do job · v{N}" com link pra versao aprovada. Se status `aguardando_abertura` ou `rejeitado_financeiro`, card cinza informativo no lugar da planilha.
- **Tabela do realizado**: cards de grupo (herda da versao aprovada). Grade com 4 blocos:
  - ORCADO (RO): R$ Unit / QT / D-M / Total (cinza-escuro)
  - PLANEJADO (RO): R$ Unit / QT / D-M / Total (azul)
  - REALIZADO (edit): R$ Unit / QT / D-M / Total (ambar novo — `#fef3c7`/`#d97706`)
  - VARIACAO: R$ / % (verde se economia, vermelho se estouro)
  Click-to-edit apenas no bloco REALIZADO. `Enter` confirma, `Esc` cancela, `Blur` autosalva. Subtotal por grupo no tfoot.
- **Regras de edicao**:
  - Editar: `job.status ∈ {aberto, em_producao}`. Bloqueado em finalizado/cancelado/aguardando/rejeitado.
  - Ownership: `session.activeRole === 'administrador'` OU `job.responsavel_id === session.profile.id`. Financeiro nao edita realizado (so consulta).
  - Falha por ownership registra `audit.acao_negada` com metadata da acao tentada.
- **Card de totais do job**: 3 camadas (por grupo, por Tipo A/B/C/D, resumo Honorarios/Impostos/Faturamento) + camada 4 nova com Total Realizado / Variacao vs Planejado / Resultado Real (Faturamento − Impostos − Realizado). Verde se ≥ 0, vermelho se < 0.
- **Modelagem**: tabela `jobs_itens_realizado` (1:1 job x item da versao aprovada). Unique parcial `(job_id, item_id)`. `total_realizado` GENERATED. FKs `on delete cascade` (job cancelado nao deleta linha; realizado historico preservado enquanto job existir). Preparada pra virar origem de `pedidos_compra` e `titulos_financeiros` em tasks futuras.
- **Audit**: `job.realizado_atualizado` com metadata `{ item_id, campo, valor_novo, valor_anterior }`.
- Migration `20260730000001_task008_jobs_realizado.sql`.
```

c) Atualizar a lista de migrations aplicadas (linha 63 ou similar):
```
20260730000001  task008_jobs_realizado
```

- [ ] **Step 4: Commit final**

```powershell
git add docs/HANDOFF.md
git commit -m "task008 final review: QA end-to-end + HANDOFF"
```

- [ ] **Step 5: (Opcional) Push**

Se o user pedir. Não pushar sem confirmação explícita.

```powershell
git push origin main
```

---

## Auto-verificação do plano

**Cobertura do spec:**
- [x] Modelagem `jobs_itens_realizado` (1:1) — Task 1.
- [x] Type `JobItemRealizado` — Task 1.
- [x] Audit action `job.realizado_atualizado` — Task 1.
- [x] Helpers `calcularTotaisRealizado` + `calcularVariacao` — Task 2.
- [x] Server action `upsertItemRealizado` com gates status/ownership/tenant/item — Task 3.
- [x] Lista `/jobs` com filtros/busca/sub-jobs — Task 4.
- [x] Extensão `/jobs/[jobId]` com Promise.all + section — Task 5.
- [x] Cores novas do bloco REALIZADO (âmbar) — Task 6.
- [x] `<JobItemRealizadoTable>` click-to-edit — Task 6.
- [x] `<JobTotaisCard>` com 3 colunas + variação + resultado real — Task 7.
- [x] Card "Aguarde aprovação financeira" — Task 5 (JobRealizadoSection).
- [x] Read-only em `finalizado`/`cancelado` — Task 5 (`podeEditarRealizado`) + Task 6 (`editable` prop).
- [x] Performance: 1 query única em `/jobs`, `Promise.all` em `/jobs/[jobId]`, `prefetch={false}` em Links, GRANT explícito, índices — Tasks 1, 4, 5.
- [x] Auditoria de denials — Task 3.
- [x] HANDOFF atualizado — Task 8.

**Tipos consistentes:**
- `CampoRealizado` definido em Task 3, importado em Task 6.
- `JobItemRealizado` definido em Task 1, importado em Tasks 5, 6, 7.
- `JobRow` definido e exportado em Task 4 (`jobs-list.tsx`), importado em `page.tsx` Task 4.
- Nomes de campos DB batem com nomes TS: `valor_unitario_realizado`, `quantidade_realizada`, `dias_meses_realizado`, `total_realizado`.

**Placeholders:** nenhum "TBD", "TODO", "similar to Task N", ou passo sem código concreto.
