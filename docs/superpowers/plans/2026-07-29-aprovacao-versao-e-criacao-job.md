# Aprovação de versão + Criação de Job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o loop comercial `Versão do Orçamento → Aprovada → Job criado`. Introduzir aprovação/desaprovação de versão (Fase E) e criação de jobs a partir de orçamentos aprovados, com hierarquia principal/sub-job dentro do projeto.

**Architecture:** Big-bang em um único PR (dados de prod são de teste). Uma migration única cria tabela `regionais`, tabela `jobs`, enum `job_status`, e trigger `cascata_versao_aprovada`. Criação de job via drawer no orçamento aprovado (não via rota `/jobs/novo`). Página `/jobs` fica como placeholder; `/jobs/[jobId]` mostra metadata read-only com drawer de edição inline. Swap principal ↔ sub-job feito atomicamente via transação (unique index parcial garante 1 principal por projeto entre não-cancelados).

**Tech Stack:** Next.js 14 App Router, TypeScript 5, Supabase Postgres (RLS + GRANT + trigger), Supabase-js, React Hook Form + Zod, Radix UI, Tailwind CSS. Verificação via `npm run typecheck`, `npm run lint`, `npm run dev` (manual UI), SQL smoke queries via MCP Supabase.

## Global Constraints

- **Performance é feature** (CLAUDE.md): `<Link>` em lista de 5+ itens navegáveis → `prefetch={false}`; agregações em coluna → query separada, nunca embed pesado; queries independentes em server component → `Promise.all`; migration nova → GRANT explícito pra `authenticated` + índices em FKs importantes; policies RLS usam `(select auth.uid())`, não `auth.uid()`; `force-dynamic` permanece em pages autenticadas.
- **RLS ≠ GRANT** (CLAUDE.md): toda tabela nova precisa terminar com `grant select, insert, update ... to authenticated`.
- **Toda tabela operacional tem `tenant_id`** com FK pra `tenants` e RLS via `is_tenant_member(tenant_id)`.
- **Sem policy DELETE** (arquivar/cancelar = campo `ativo`/`status`).
- **Toda ação sensível grava em `audit_events`** via `logAuditEvent`.
- **Radix `<SelectItem>` NUNCA aceita `value=""`** — usar sentinel (padrão do projeto: `"__none__"`).
- **Identidade visual California**: vermelho `#E74B56` (classe `california-red`), fonte Inter, Fraunces via `font-display`, botões arredondados, cards com `shadow-soft`.
- **Migration numbering**: próximo número disponível é `20260729000002` (última: `20260729000001_categorias_globais.sql`).
- **Sem emojis em código.**
- **Terminologia UI**: "principal" e "sub-job" (não "pai/filho").
- **Windows environment**: usar `bash` tool com forward slashes; quotar paths com brackets.

---

## File Structure — mapa de mudanças

### Cria:
| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260729000002_task005_jobs.sql` | Tabela `regionais`, enum `job_status`, tabela `jobs` (com FKs, unique indexes parciais, trigger `cascata_versao_aprovada`), RLS/GRANT |
| `lib/codigos/jobs.ts` | Helper `gerarCodigoJob(supabase, tenantId)` → `JOB-NNNN` |
| `lib/validations/regionais.ts` | Schema Zod `regionalSchema` |
| `lib/validations/jobs.ts` | Schema Zod `jobSchema` + type `JobInput` |
| `app/(app)/jobs/page.tsx` | Placeholder "gestão em breve" |
| `app/(app)/jobs/actions.ts` | `criarJob`, `atualizarJob`, `atualizarHierarquiaJob`, `atualizarStatusJob` |
| `app/(app)/jobs/[jobId]/page.tsx` | Detalhe do job (metadata + hierarquia + origem + status) |
| `app/(app)/jobs/[jobId]/job-editor-drawer.tsx` | Drawer edição inline (campos operacionais) |
| `app/(app)/jobs/[jobId]/editar-hierarquia-drawer.tsx` | Drawer edição hierarquia (principal ↔ sub-job) |
| `app/(app)/orcamentos/[projetoId]/[orcId]/criar-job-drawer.tsx` | Drawer "Criar job" no orçamento aprovado |
| `app/(app)/cadastros/regionais/page.tsx` | Lista de regionais |
| `app/(app)/cadastros/regionais/regionais-list.tsx` | Componente client com busca/filtro |
| `app/(app)/cadastros/regionais/regional-drawer.tsx` | Drawer criar/editar |
| `app/(app)/cadastros/regionais/actions.ts` | CRUD regionais |

### Modifica:
| Arquivo | O que muda |
|---|---|
| `lib/types.ts` | Add `Regional`, `Job`, `JobStatus`, `jobStatusLabel`, `JOB_STATUS_TRANSICOES` |
| `lib/auth/audit.ts` | Add ações `versao_orcamento.aprovacao_cancelada`, `regional.*`, `job.atualizado`, `job.hierarquia_alterada`, `job.status_alterado` |
| `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/actions.ts` | Add `aprovarVersao`, `cancelarAprovacaoVersao` |
| `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/page.tsx` | Botões aprovar/cancelar aprovação no header |
| `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx` | Botão "Criar job" (aprovado) ou link "Ver job" (job_criado); fetches necessários pro drawer |
| `app/(app)/cadastros/page.tsx` | Card novo "Regionais" (ícone `MapPin`) |
| `components/sidebar.tsx` (ou equivalente) | Entrada "Jobs" (ícone `Briefcase`) |

---

## Tarefas

### Task 1: Migration SQL (regionais + jobs + trigger)

**Files:**
- Create: `supabase/migrations/20260729000002_task005_jobs.sql`

**Interfaces:**
- Consumes: existing tables `tenants`, `projetos`, `orcamentos`, `versoes_orcamento`, `profiles`; existing helpers `is_tenant_member`, `set_updated_at`
- Produces: table `public.regionais`, table `public.jobs`, enum `public.job_status`, function `public.cascata_versao_aprovada`, trigger `trg_cascata_versao_aprovada`

- [ ] **Step 1: Criar o arquivo de migration**

Conteúdo integral de `supabase/migrations/20260729000002_task005_jobs.sql`:

```sql
-- =====================================================================
-- Task 005 — Jobs (com regionais + trigger cascata de versao aprovada)
--
-- Nova tabela `regionais` (cadastro tenant-wide).
-- Nova tabela `jobs` com FK a projeto/orcamento/versao/responsavel/regional
-- e self-reference `job_pai_id` pra hierarquia principal/sub-job.
-- Trigger cascata_versao_aprovada: quando uma versao vira 'aprovada',
-- as outras versoes do mesmo orcamento viram 'substituida' automaticamente.
-- =====================================================================

-- 1) regionais ----------------------------------------------------------
create table if not exists public.regionais (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  nome text not null,
  ativo boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regionais_nome_nao_vazio check (length(trim(nome)) > 0)
);

create unique index if not exists uniq_regional_nome_por_tenant
  on public.regionais(tenant_id, lower(nome));

create index if not exists idx_regionais_tenant on public.regionais(tenant_id);
create index if not exists idx_regionais_ativo on public.regionais(tenant_id, ativo);

drop trigger if exists trg_regionais_updated_at on public.regionais;
create trigger trg_regionais_updated_at
  before update on public.regionais
  for each row execute function public.set_updated_at();

alter table public.regionais enable row level security;

drop policy if exists regionais_select on public.regionais;
create policy regionais_select on public.regionais
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists regionais_insert on public.regionais;
create policy regionais_insert on public.regionais
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists regionais_update on public.regionais;
create policy regionais_update on public.regionais
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.regionais to authenticated;

-- 2) job_status enum ----------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'job_status') then
    create type public.job_status as enum ('aberto', 'em_producao', 'finalizado', 'cancelado');
  end if;
end$$;

-- 3) jobs ---------------------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  codigo text not null,

  projeto_id uuid not null references public.projetos(id) on delete restrict,
  orcamento_id uuid not null references public.orcamentos(id) on delete restrict,
  versao_orcamento_aprovada_id uuid not null references public.versoes_orcamento(id) on delete restrict,

  nome text not null,
  produto text,
  regional_id uuid references public.regionais(id) on delete restrict,
  cidade text,
  data_inicio_prevista date,
  data_fim_prevista date,
  responsavel_id uuid not null references public.profiles(id) on delete restrict,
  valor_total numeric(14, 2),

  job_pai_id uuid references public.jobs(id) on delete restrict,

  status public.job_status not null default 'aberto',

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint jobs_nao_pai_de_si_mesmo check (job_pai_id is null or job_pai_id != id),
  constraint jobs_datas_ordem check (
    data_inicio_prevista is null
    or data_fim_prevista is null
    or data_fim_prevista >= data_inicio_prevista
  )
);

create unique index if not exists uniq_jobs_codigo_por_tenant
  on public.jobs(tenant_id, codigo);

create unique index if not exists uniq_jobs_por_orcamento_ativo
  on public.jobs(tenant_id, orcamento_id)
  where status != 'cancelado';

create unique index if not exists uniq_jobs_principal_por_projeto
  on public.jobs(projeto_id)
  where job_pai_id is null and status != 'cancelado';

create index if not exists idx_jobs_tenant on public.jobs(tenant_id);
create index if not exists idx_jobs_projeto on public.jobs(projeto_id);
create index if not exists idx_jobs_orcamento on public.jobs(orcamento_id);
create index if not exists idx_jobs_versao on public.jobs(versao_orcamento_aprovada_id);
create index if not exists idx_jobs_responsavel on public.jobs(responsavel_id);
create index if not exists idx_jobs_regional on public.jobs(regional_id);
create index if not exists idx_jobs_status on public.jobs(status);
create index if not exists idx_jobs_pai on public.jobs(job_pai_id);
create index if not exists idx_jobs_created_at on public.jobs(created_at desc);

drop trigger if exists trg_jobs_updated_at on public.jobs;
create trigger trg_jobs_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;

drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists jobs_insert on public.jobs;
create policy jobs_insert on public.jobs
  for insert to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and (created_by is null or created_by = (select auth.uid()))
  );

drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.jobs to authenticated;

-- 4) trigger cascata: aprovar versao propaga 'substituida' pras outras --
create or replace function public.cascata_versao_aprovada() returns trigger
language plpgsql as $$
begin
  if NEW.status = 'aprovada' and (OLD.status is distinct from 'aprovada') then
    update public.versoes_orcamento
       set status = 'substituida'
     where orcamento_id = NEW.orcamento_id
       and id != NEW.id
       and status not in ('aprovada', 'substituida', 'cancelada');
  end if;
  return NEW;
end$$;

drop trigger if exists trg_cascata_versao_aprovada on public.versoes_orcamento;
create trigger trg_cascata_versao_aprovada
  after update of status on public.versoes_orcamento
  for each row execute function public.cascata_versao_aprovada();
```

- [ ] **Step 2: Verificar o arquivo com Read**

Ler o arquivo criado por inteiro (Read tool). Confirmar seções 1-4, sem TBD/TODO/placeholder.

- [ ] **Step 3: Commit (não aplicar ainda — apply vem só na Task 15)**

```bash
git add supabase/migrations/20260729000002_task005_jobs.sql
git commit -m "task005: migration regionais + jobs + trigger cascata versao aprovada"
```

---

### Task 2: Types (`lib/types.ts`)

**Files:**
- Modify: `lib/types.ts`

**Interfaces:**
- Consumes: none
- Produces: `Regional`, `JobStatus`, `Job`, `jobStatusLabel`, `JOB_STATUS_TRANSICOES`

- [ ] **Step 1: Adicionar seções após a última existente**

Adicionar no final do arquivo:

```typescript
// ---------- Regionais ----------

export interface Regional {
  id: string;
  tenant_id: string;
  nome: string;
  ativo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- Jobs ----------

export type JobStatus = "aberto" | "em_producao" | "finalizado" | "cancelado";

export interface Job {
  id: string;
  tenant_id: string;
  codigo: string;
  projeto_id: string;
  orcamento_id: string;
  versao_orcamento_aprovada_id: string;
  nome: string;
  produto: string | null;
  regional_id: string | null;
  cidade: string | null;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  responsavel_id: string;
  valor_total: number | null;
  job_pai_id: string | null;
  status: JobStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const JOB_STATUS_TRANSICOES: Record<JobStatus, JobStatus[]> = {
  aberto: ["em_producao", "cancelado"],
  em_producao: ["finalizado", "cancelado"],
  finalizado: [],
  cancelado: [],
};

export function jobStatusLabel(s: JobStatus): string {
  switch (s) {
    case "aberto":
      return "Aberto";
    case "em_producao":
      return "Em produção";
    case "finalizado":
      return "Finalizado";
    case "cancelado":
      return "Cancelado";
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "task005: types Regional + Job + JobStatus + transicoes"
```

---

### Task 3: Validations (regionais + jobs)

**Files:**
- Create: `lib/validations/regionais.ts`
- Create: `lib/validations/jobs.ts`

**Interfaces:**
- Consumes: `Regional`, `Job` from `lib/types` (Task 2)
- Produces: `regionalSchema`, `RegionalInput`, `jobSchema`, `JobInput`

- [ ] **Step 1: Criar `lib/validations/regionais.ts`**

```typescript
import { z } from "zod";

export const regionalSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome.")
    .max(80, "Máximo 80 caracteres."),
});

export type RegionalInput = z.infer<typeof regionalSchema>;
```

- [ ] **Step 2: Criar `lib/validations/jobs.ts`**

```typescript
import { z } from "zod";

export const jobSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "Informe o nome (mín. 2 caracteres).")
      .max(200, "Máximo 200 caracteres."),
    produto: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    regional_id: z
      .string()
      .uuid()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v && v.length > 0 ? v : null)),
    cidade: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    data_inicio_prevista: z
      .string()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    data_fim_prevista: z
      .string()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    responsavel_id: z.string().uuid("Selecione um responsável válido."),
    valor_total: z.coerce.number().nonnegative().nullable().optional(),

    // Hierarquia (usado só na criação do 2º+ job)
    posicao_hierarquia: z.enum(["principal", "sub_job"]).optional(),
    job_pai_id: z
      .string()
      .uuid()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .superRefine((data, ctx) => {
    if (
      data.data_inicio_prevista &&
      data.data_fim_prevista &&
      data.data_fim_prevista < data.data_inicio_prevista
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data_fim_prevista"],
        message: "Data fim deve ser igual ou posterior à data início.",
      });
    }
  });

export type JobInput = z.infer<typeof jobSchema>;
```

- [ ] **Step 3: Commit**

```bash
git add lib/validations/regionais.ts lib/validations/jobs.ts
git commit -m "task005: validations regionais + jobs"
```

---

### Task 4: Audit actions

**Files:**
- Modify: `lib/auth/audit.ts`

**Interfaces:**
- Consumes: none
- Produces: 8 novas ações no union `AuditAction`

- [ ] **Step 1: Adicionar ao union `AuditAction`**

Localizar `export type AuditAction =` e adicionar (agrupadas por domínio; posições sugeridas mantendo agrupamento existente):

Após `"versao_orcamento.aprovada"`:
```typescript
  | "versao_orcamento.aprovacao_cancelada"
```

Após `"categoria.reativada"` (agrupamento de cadastros):
```typescript
  | "regional.criada"
  | "regional.editada"
  | "regional.inativada"
  | "regional.reativada"
```

Após `"job.criado"`:
```typescript
  | "job.atualizado"
  | "job.hierarquia_alterada"
  | "job.status_alterado"
```

- [ ] **Step 2: Commit**

```bash
git add lib/auth/audit.ts
git commit -m "task005: audit actions versao.aprovacao_cancelada + regional.* + job.*"
```

---

### Task 5: Helper de código de job

**Files:**
- Create: `lib/codigos/jobs.ts`

**Interfaces:**
- Consumes: `SupabaseClient` from `@supabase/supabase-js`
- Produces: `gerarCodigoJob(supabase, tenantId): Promise<string>` returning `"JOB-NNNN"`

- [ ] **Step 1: Criar `lib/codigos/jobs.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gera código sequencial `JOB-NNNN` (4 dígitos zero-padded)
 * baseado na contagem atual de jobs do tenant + 1.
 * Sujeito a race condition — unique index (tenant_id, codigo) captura colisões.
 */
export async function gerarCodigoJob(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string> {
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(`Falha ao contar jobs: ${error.message}`);
  }

  const seq = ((count ?? 0) + 1).toString().padStart(4, "0");
  return `JOB-${seq}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/codigos/jobs.ts
git commit -m "task005: helper gerarCodigoJob (JOB-NNNN sequencial por tenant)"
```

---

### Task 6: Server actions de Regionais

**Files:**
- Create: `app/(app)/cadastros/regionais/actions.ts`

**Interfaces:**
- Consumes: `regionalSchema`, `requireSession`, `createClient`, `logAuditEvent`
- Produces: `criarRegional(formData)`, `editarRegional(id, formData)`, `inativarRegional(id)`, `reativarRegional(id)`

- [ ] **Step 1: Criar `app/(app)/cadastros/regionais/actions.ts`**

Espelha padrão de `app/(app)/categorias/actions.ts`. Conteúdo:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import { regionalSchema } from "@/lib/validations/regionais";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapRegionalDbError(msg: string): string {
  if (msg.includes("uniq_regional_nome_por_tenant")) {
    return "Já existe uma regional com esse nome.";
  }
  if (msg.includes("regionais_nome_nao_vazio")) {
    return "Nome da regional não pode ficar vazio.";
  }
  return "Não foi possível salvar a regional.";
}

export async function criarRegional(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = regionalSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("regionais")
    .insert({
      tenant_id: session.activeTenant.id,
      nome: parsed.data.nome,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[regionais.criar]", error.message);
    return { ok: false, message: mapRegionalDbError(error.message) };
  }

  await logAuditEvent({
    acao: "regional.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "regional",
    entidadeId: data.id,
    metadata: { nome: parsed.data.nome },
  });

  revalidatePath("/cadastros/regionais");
  revalidatePath("/cadastros");
  return { ok: true, id: data.id };
}

export async function editarRegional(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = regionalSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("regionais")
    .update({ nome: parsed.data.nome })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[regionais.editar]", error.message);
    return { ok: false, message: mapRegionalDbError(error.message) };
  }

  await logAuditEvent({
    acao: "regional.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "regional",
    entidadeId: id,
    metadata: { nome: parsed.data.nome },
  });

  revalidatePath("/cadastros/regionais");
  return { ok: true, id };
}

export async function inativarRegional(id: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador") {
    return { ok: false, message: "Só administradores podem inativar regionais." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("regionais")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[regionais.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "regional.inativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "regional",
    entidadeId: id,
  });

  revalidatePath("/cadastros/regionais");
  revalidatePath("/cadastros");
  return { ok: true, id };
}

export async function reativarRegional(id: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador") {
    return { ok: false, message: "Só administradores podem reativar regionais." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("regionais")
    .update({ ativo: true })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[regionais.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "regional.reativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "regional",
    entidadeId: id,
  });

  revalidatePath("/cadastros/regionais");
  revalidatePath("/cadastros");
  return { ok: true, id };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(app)/cadastros/regionais/actions.ts
git commit -m "task005: server actions CRUD de regionais (mirror categorias)"
```

---

### Task 7: UI Regionais (page + list + drawer + card no hub)

**Files:**
- Create: `app/(app)/cadastros/regionais/page.tsx`
- Create: `app/(app)/cadastros/regionais/regionais-list.tsx`
- Create: `app/(app)/cadastros/regionais/regional-drawer.tsx`
- Modify: `app/(app)/cadastros/page.tsx`

**Interfaces:**
- Consumes: `Regional`, server actions from Task 6
- Produces: rota `/cadastros/regionais` funcional + card no hub `/cadastros`

- [ ] **Step 1: Ler `app/(app)/cadastros/categorias-dominio/page.tsx`, `categorias-dominio-list.tsx`, `categoria-dominio-drawer.tsx` como referência**

Read cada um pra confirmar o padrão exato usado (nomeclatura, imports, estrutura).

- [ ] **Step 2: Criar `app/(app)/cadastros/regionais/page.tsx`**

```typescript
import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Regional } from "@/lib/types";
import { RegionaisList } from "./regionais-list";

export const dynamic = "force-dynamic";

export default async function RegionaisPage() {
  const session = await requireSession();
  const supabase = createClient();

  const { data, error } = await supabase
    .from("regionais")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("nome", { ascending: true })
    .returns<Regional[]>();

  if (error) console.error("[regionais.page]", error.message);

  const rows = data ?? [];
  const isAdmin = session.activeRole === "administrador";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <nav className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Link href="/cadastros" className="hover:text-foreground">
            Cadastros
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>Regionais</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <MapPin className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Regionais</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Vocabulário de regionais compartilhado pelo tenant. Usado ao criar jobs.
        </p>
      </header>

      <RegionaisList regionais={rows} isAdmin={isAdmin} />
    </div>
  );
}
```

- [ ] **Step 3: Criar `app/(app)/cadastros/regionais/regionais-list.tsx`**

Espelha `app/(app)/cadastros/categorias-dominio/categorias-dominio-list.tsx` (sem coluna de escopo — regionais não têm). Estrutura:

```typescript
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Power, PowerOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Regional } from "@/lib/types";
import { RegionalDrawer } from "./regional-drawer";
import { inativarRegional, reativarRegional } from "./actions";

type StatusFiltro = "ativas" | "inativas" | "todas";

export function RegionaisList({
  regionais,
  isAdmin,
}: {
  regionais: Regional[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativas");
  const [pending, startTransition] = React.useTransition();
  const [editando, setEditando] = React.useState<Regional | null>(null);
  const [confirmando, setConfirmando] = React.useState<{
    regional: Regional;
    acao: "inativar" | "reativar";
  } | null>(null);

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return regionais.filter((r) => {
      if (status === "ativas" && !r.ativo) return false;
      if (status === "inativas" && r.ativo) return false;
      if (!q) return true;
      return r.nome.toLowerCase().includes(q);
    });
  }, [regionais, busca, status]);

  function handleConfirm() {
    if (!confirmando) return;
    const { regional, acao } = confirmando;
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarRegional(regional.id)
          : await reativarRegional(regional.id);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFiltro)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ativas">Ativas</SelectItem>
              <SelectItem value="inativas">Inativas</SelectItem>
              <SelectItem value="todas">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <RegionalDrawer mode="criar" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {regionais.length === 0
              ? "Nenhuma regional cadastrada ainda."
              : "Nenhuma regional corresponde aos filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nome</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setEditando(r)}
                  className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
                >
                  <td className="px-4 py-3">{r.nome}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.ativo
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          r.ativo ? "bg-emerald-500" : "bg-muted-foreground"
                        }`}
                      />
                      {r.ativo ? "Ativa" : "Inativa"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmando({
                            regional: r,
                            acao: r.ativo ? "inativar" : "reativar",
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title={r.ativo ? "Inativar" : "Reativar"}
                      >
                        {r.ativo ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <RegionalDrawer
          mode="editar"
          regional={editando}
          open={!!editando}
          onOpenChange={(next) => {
            if (!next) setEditando(null);
          }}
        />
      )}

      {confirmando && (
        <ConfirmDialog
          open={!!confirmando}
          onOpenChange={(next) => {
            if (!next) setConfirmando(null);
          }}
          title={
            confirmando.acao === "inativar"
              ? "Inativar regional?"
              : "Reativar regional?"
          }
          description={
            confirmando.acao === "inativar"
              ? `A regional "${confirmando.regional.nome}" some do dropdown em novos jobs, mas continua nos jobs que já a usam.`
              : `A regional "${confirmando.regional.nome}" volta a aparecer no dropdown.`
          }
          confirmLabel={confirmando.acao === "inativar" ? "Inativar" : "Reativar"}
          onConfirm={handleConfirm}
          pending={pending}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Criar `app/(app)/cadastros/regionais/regional-drawer.tsx`**

Espelha `app/(app)/cadastros/categorias-dominio/categoria-dominio-drawer.tsx` (sem seletor de escopo). Uses `DrawerContent` + `DialogHeader/DialogTitle` children pattern (Radix API constraint observada em Task 007). Estrutura:

```typescript
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarRegional, editarRegional } from "./actions";
import type { Regional } from "@/lib/types";

type Props =
  | { mode: "criar"; regional?: undefined; trigger?: React.ReactNode }
  | {
      mode: "editar";
      regional: Regional;
      trigger?: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    };

export function RegionalDrawer(props: Props) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  const isControlled = props.mode === "editar" && props.open !== undefined;
  const open = isControlled ? (props as any).open : internalOpen;
  const setOpen = isControlled ? (props as any).onOpenChange : setInternalOpen;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
      setFieldErrors({});
    }
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const res =
        props.mode === "criar"
          ? await criarRegional(formData)
          : await editarRegional(props.regional.id, formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  }

  const initialNome = props.mode === "editar" ? props.regional.nome : "";
  const title = props.mode === "criar" ? "Nova regional" : "Editar regional";
  const submitLabel =
    props.mode === "criar"
      ? pending ? "Criando..." : "Criar regional"
      : pending ? "Salvando..." : "Salvar";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {props.trigger && <DialogTrigger asChild>{props.trigger}</DialogTrigger>}
      {props.mode === "criar" && !props.trigger && (
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nova regional
          </button>
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {props.mode === "criar"
              ? "Regionais ficam disponíveis pra todos os jobs do tenant."
              : "Renomear afeta todos os jobs já associados a esta regional."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                name="nome"
                autoFocus
                required
                maxLength={80}
                defaultValue={initialNome}
                placeholder="Ex.: SP, Nordeste, Rio de Janeiro"
              />
              {fieldErrors.nome?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">{msg}</p>
              ))}
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Modificar `app/(app)/cadastros/page.tsx` — adicionar card "Regionais"**

Adicionar ao `Promise.all` a contagem de regionais ativas e adicionar um novo `<CadastroCard>` (usar ícone `MapPin` do `lucide-react`). Padrão do arquivo é evidente: chame de "Regionais", `href="/cadastros/regionais"`, description "Vocabulário usado ao criar jobs — ex.: SP, Nordeste, Rio de Janeiro.".

Import de `MapPin`:
```typescript
import { Users, Building2, Tag, Layers, MapPin, ArrowRight, type LucideIcon } from "lucide-react";
```
(Se `Layers` já não estiver lá — adicione junto se não estiver.)

Query dentro do `Promise.all`:
```typescript
supabase
  .from("regionais")
  .select("*", { count: "exact", head: true })
  .eq("tenant_id", session.activeTenant.id)
  .eq("ativo", true),
```

Card no JSX (após os existentes):
```typescript
<CadastroCard
  href="/cadastros/regionais"
  icon={MapPin}
  title="Regionais"
  description="Vocabulário usado ao criar jobs — ex.: SP, Nordeste, Rio de Janeiro."
  count={regionaisRes.count ?? 0}
/>
```

Também adicione `regionaisRes` na destructuring do `Promise.all` e o `console.error` correspondente.

- [ ] **Step 6: Verify typecheck**

```bash
npm run typecheck
```

Esperado: 0 erros (as tabelas ainda não existem no DB, mas types já foram criados na Task 2 então tudo compila).

- [ ] **Step 7: Commit**

```bash
git add app/(app)/cadastros/regionais/ app/(app)/cadastros/page.tsx
git commit -m "task005: cadastro de regionais (page + list + drawer + card no hub)"
```

---

### Task 8: Server actions de Aprovação (aprovarVersao + cancelarAprovacaoVersao)

**Files:**
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/actions.ts`

**Interfaces:**
- Consumes: `requireSession`, `createClient`, `logAuditEvent`
- Produces: `aprovarVersao(versaoId): Promise<ActionResult>`, `cancelarAprovacaoVersao(versaoId): Promise<ActionResult>`

- [ ] **Step 1: Ler o arquivo existente pra entender padrão de ActionResult**

Read `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/actions.ts` — confirmar o shape de `ActionResult` já usado no arquivo. Se ele exporta `ActionResult` usar o mesmo; senão, definir localmente igual às outras actions do arquivo.

- [ ] **Step 2: Adicionar `aprovarVersao` no final do arquivo**

```typescript
export async function aprovarVersao(versaoId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  // 1. Fetch versão + orçamento (com projeto_id pra revalidatePath)
  const { data: versao, error: errVer } = await supabase
    .from("versoes_orcamento")
    .select("id, status, orcamento_id, tenant_id")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: string; orcamento_id: string; tenant_id: string }>();

  if (errVer || !versao) {
    return { ok: false, message: "Versão não encontrada." };
  }

  if (!["rascunho", "em_revisao", "enviada_cliente"].includes(versao.status)) {
    return {
      ok: false,
      message: `Versão em status ${versao.status} não pode ser aprovada.`,
    };
  }

  // 2. Fetch orçamento pra validar status + projeto_id
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("status, projeto_id")
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: string; projeto_id: string }>();

  if (!orc) {
    return { ok: false, message: "Orçamento não encontrado." };
  }

  if (["job_criado", "aprovado", "cancelado"].includes(orc.status)) {
    return {
      ok: false,
      message: `Orçamento em status ${orc.status} não aceita nova aprovação.`,
    };
  }

  // 3. Verificar que versão tem ≥1 grupo com ≥1 item
  const { count: itensCount } = await supabase
    .from("versoes_orcamento_itens")
    .select("id", { count: "exact", head: true })
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if ((itensCount ?? 0) === 0) {
    return {
      ok: false,
      message: "Adicione ao menos 1 item antes de aprovar a versão.",
    };
  }

  const agora = new Date().toISOString();

  // 4. Update versão (dispara trigger cascata pras outras versões)
  const { error: errUpdVer } = await supabase
    .from("versoes_orcamento")
    .update({
      status: "aprovada",
      aprovado_em: agora,
      aprovado_por: session.profile.id,
    })
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdVer) {
    console.error("[versao.aprovar]", errUpdVer.message);
    return { ok: false, message: "Não foi possível aprovar a versão." };
  }

  // 5. Update orçamento
  const { error: errUpdOrc } = await supabase
    .from("orcamentos")
    .update({
      status: "aprovado",
      versao_aprovada_id: versaoId,
      aprovado_em: agora,
      aprovado_por: session.profile.id,
    })
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdOrc) {
    console.error("[orcamento.aprovar]", errUpdOrc.message);
    return {
      ok: false,
      message: "Versão aprovada mas orçamento não atualizado. Verifique manualmente.",
    };
  }

  await logAuditEvent({
    acao: "versao_orcamento.aprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: { orcamento_id: versao.orcamento_id },
  });

  revalidatePath(`/orcamentos/${orc.projeto_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${versao.orcamento_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${versao.orcamento_id}/versoes/${versaoId}`);
  return { ok: true, id: versaoId };
}
```

- [ ] **Step 3: Adicionar `cancelarAprovacaoVersao`**

```typescript
export async function cancelarAprovacaoVersao(
  versaoId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  // 1. Fetch versão
  const { data: versao } = await supabase
    .from("versoes_orcamento")
    .select("id, status, orcamento_id")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: string; orcamento_id: string }>();

  if (!versao) {
    return { ok: false, message: "Versão não encontrada." };
  }

  if (versao.status !== "aprovada") {
    return { ok: false, message: "Só versões aprovadas podem ter aprovação cancelada." };
  }

  // 2. Fetch orçamento (deve estar 'aprovado', não 'job_criado')
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("status, projeto_id")
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: string; projeto_id: string }>();

  if (!orc) {
    return { ok: false, message: "Orçamento não encontrado." };
  }

  if (orc.status !== "aprovado") {
    return {
      ok: false,
      message: `Orçamento está em status ${orc.status} — desaprovação não permitida.`,
    };
  }

  // 3. Verifica que não existe job ativo (não-cancelado) pra este orçamento
  const { count: jobsAtivos } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("orcamento_id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado");

  if ((jobsAtivos ?? 0) > 0) {
    return {
      ok: false,
      message: "Cancele o job antes de desaprovar a versão.",
    };
  }

  // 4. Update versão: volta pra 'em_revisao', limpa aprovado_em/por
  const { error: errUpdVer } = await supabase
    .from("versoes_orcamento")
    .update({
      status: "em_revisao",
      aprovado_em: null,
      aprovado_por: null,
    })
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdVer) {
    console.error("[versao.cancelarAprovacao]", errUpdVer.message);
    return { ok: false, message: "Não foi possível cancelar a aprovação." };
  }

  // 5. Reverter cascata: outras versões 'substituida' do orçamento voltam pra 'em_revisao'
  const { error: errRev } = await supabase
    .from("versoes_orcamento")
    .update({ status: "em_revisao" })
    .eq("orcamento_id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "substituida");

  if (errRev) {
    console.error("[versao.reverter_cascata]", errRev.message);
    // não bloqueia; log e segue
  }

  // 6. Update orçamento
  const { error: errUpdOrc } = await supabase
    .from("orcamentos")
    .update({
      status: "em_revisao",
      versao_aprovada_id: null,
      aprovado_em: null,
      aprovado_por: null,
    })
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdOrc) {
    console.error("[orcamento.cancelarAprovacao]", errUpdOrc.message);
    return {
      ok: false,
      message: "Versão desaprovada mas orçamento não atualizado. Verifique manualmente.",
    };
  }

  await logAuditEvent({
    acao: "versao_orcamento.aprovacao_cancelada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: { orcamento_id: versao.orcamento_id },
  });

  revalidatePath(`/orcamentos/${orc.projeto_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${versao.orcamento_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${versao.orcamento_id}/versoes/${versaoId}`);
  return { ok: true, id: versaoId };
}
```

- [ ] **Step 4: Verify typecheck**

```bash
npm run typecheck
```

Esperado: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/orcamentos/[projetoId]/[orcId]/versoes/actions.ts
git commit -m "task005: server actions aprovarVersao + cancelarAprovacaoVersao"
```

---

### Task 9: UI Aprovação — botões na tela da versão

**Files:**
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/page.tsx`

**Interfaces:**
- Consumes: `aprovarVersao`, `cancelarAprovacaoVersao` from Task 8
- Produces: página de versão mostra botões apropriados baseados no status

- [ ] **Step 1: Ler o arquivo existente pra entender o header atual**

Read `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/page.tsx` — identificar exatamente onde o status badge está renderizado.

- [ ] **Step 2: Adicionar fetch de "jobs ativos pra este orçamento" no `Promise.all` existente**

Localizar o `Promise.all` de queries e adicionar:

```typescript
supabase
  .from("jobs")
  .select("id", { count: "exact", head: true })
  .eq("orcamento_id", params.orcId)
  .eq("tenant_id", session.activeTenant.id)
  .neq("status", "cancelado"),
```

Ajustar destructuring do resultado (adicionar `jobsAtivosRes`).

Derivar constante logo abaixo:
```typescript
const temJobAtivo = (jobsAtivosRes.count ?? 0) > 0;
```

- [ ] **Step 3: Criar componente client `<AprovacaoActions>` inline no arquivo (ou em arquivo separado se preferir)**

Nova client component pequena, colocalizada no mesmo diretório da page ou dentro dela como componente client separado. Recomendo criar arquivo separado:

**File:** `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/aprovacao-actions.tsx`

```typescript
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Undo2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  aprovarVersao,
  cancelarAprovacaoVersao,
} from "../../actions";

interface Props {
  versaoId: string;
  status: string;
  temJobAtivo: boolean;
}

export function AprovacaoActions({ versaoId, status, temJobAtivo }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmando, setConfirmando] = React.useState<"aprovar" | "cancelar" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const podeAprovar = ["rascunho", "em_revisao", "enviada_cliente"].includes(status);
  const podeCancelarAprovacao = status === "aprovada" && !temJobAtivo;

  function handleAprovar() {
    setError(null);
    startTransition(async () => {
      const res = await aprovarVersao(versaoId);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  function handleCancelar() {
    setError(null);
    startTransition(async () => {
      const res = await cancelarAprovacaoVersao(versaoId);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  if (!podeAprovar && !podeCancelarAprovacao) return null;

  return (
    <>
      {podeAprovar && (
        <button
          type="button"
          onClick={() => setConfirmando("aprovar")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Aprovar versão
        </button>
      )}
      {podeCancelarAprovacao && (
        <button
          type="button"
          onClick={() => setConfirmando("cancelar")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-3 py-1.5 text-xs font-semibold text-california-red hover:bg-california-red/5 transition-colors"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Cancelar aprovação
        </button>
      )}

      <ConfirmDialog
        open={confirmando === "aprovar"}
        onOpenChange={(o) => !o && setConfirmando(null)}
        title="Aprovar esta versão?"
        description="Ao aprovar, as outras versões deste orçamento viram 'substituída' automaticamente. O orçamento entra em status 'aprovado' e o botão 'Criar job' fica disponível."
        confirmLabel="Aprovar"
        onConfirm={handleAprovar}
        pending={pending}
      />

      <ConfirmDialog
        open={confirmando === "cancelar"}
        onOpenChange={(o) => !o && setConfirmando(null)}
        title="Cancelar a aprovação desta versão?"
        description="A versão volta pra 'em revisão'. As versões 'substituída' deste orçamento também voltam pra 'em revisão'. O orçamento volta pra 'em revisão'."
        confirmLabel="Cancelar aprovação"
        onConfirm={handleCancelar}
        pending={pending}
      />

      {error && (
        <div className="text-xs text-california-red mt-1">{error}</div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Import + wire o componente na page.tsx**

Import:
```typescript
import { AprovacaoActions } from "./aprovacao-actions";
```

Renderizar logo após o status badge (dentro do header, próximo ao `<VersaoEditorDrawer>` ou similar):
```typescript
<AprovacaoActions
  versaoId={versao.id}
  status={versao.status}
  temJobAtivo={temJobAtivo}
/>
```

- [ ] **Step 5: Verify typecheck + commit**

```bash
npm run typecheck
git add app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/
git commit -m "task005: UI aprovar/cancelar aprovacao versao (botoes + confirm)"
```

---

### Task 10: Server actions de Jobs

**Files:**
- Create: `app/(app)/jobs/actions.ts`

**Interfaces:**
- Consumes: `jobSchema`, `gerarCodigoJob`, `logAuditEvent`, `requireSession`, `createClient`, `JOB_STATUS_TRANSICOES`, `JobStatus`
- Produces: `criarJob(orcamentoId, formData)`, `atualizarJob(id, formData)`, `atualizarHierarquiaJob(id, novoPapel)`, `atualizarStatusJob(id, novoStatus)`

- [ ] **Step 1: Criar `app/(app)/jobs/actions.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { jobSchema } from "@/lib/validations/jobs";
import { gerarCodigoJob } from "@/lib/codigos/jobs";
import { JOB_STATUS_TRANSICOES, type JobStatus } from "@/lib/types";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  const posicaoRaw = formData.get("posicao_hierarquia")?.toString();
  const paiRaw = formData.get("job_pai_id")?.toString();
  const valorRaw = formData.get("valor_total")?.toString();
  return {
    nome: formData.get("nome")?.toString() ?? "",
    produto: formData.get("produto")?.toString() ?? "",
    regional_id: formData.get("regional_id")?.toString() ?? "",
    cidade: formData.get("cidade")?.toString() ?? "",
    data_inicio_prevista: formData.get("data_inicio_prevista")?.toString() ?? "",
    data_fim_prevista: formData.get("data_fim_prevista")?.toString() ?? "",
    responsavel_id: formData.get("responsavel_id")?.toString() ?? "",
    valor_total: valorRaw && valorRaw.length > 0 ? Number(valorRaw) : null,
    posicao_hierarquia:
      posicaoRaw === "principal" || posicaoRaw === "sub_job" ? posicaoRaw : undefined,
    job_pai_id: paiRaw ?? "",
  };
}

function mapJobDbError(msg: string): string {
  if (msg.includes("uniq_jobs_codigo_por_tenant")) return "Já existe um job com este código.";
  if (msg.includes("uniq_jobs_por_orcamento_ativo")) return "Este orçamento já tem um job ativo.";
  if (msg.includes("uniq_jobs_principal_por_projeto")) return "Já existe um job principal neste projeto.";
  if (msg.includes("jobs_datas_ordem")) return "Data fim precisa ser igual ou posterior à data início.";
  return "Não foi possível salvar o job.";
}

export async function criarJob(
  orcamentoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = jobSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // 1. Fetch orçamento (deve estar 'aprovado' + tem versao_aprovada_id)
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("id, status, versao_aprovada_id, projeto_id")
    .eq("id", orcamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: string;
      versao_aprovada_id: string | null;
      projeto_id: string;
    }>();

  if (!orc) return { ok: false, message: "Orçamento não encontrado." };
  if (orc.status !== "aprovado" || !orc.versao_aprovada_id) {
    return { ok: false, message: "Orçamento não está aprovado." };
  }

  // 2. Verifica se já existe job ativo pra este orçamento (fail early)
  const { count: jobsDoOrcamento } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("orcamento_id", orcamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado");

  if ((jobsDoOrcamento ?? 0) > 0) {
    return { ok: false, message: "Este orçamento já tem um job ativo." };
  }

  // 3. Fetch jobs ativos do projeto pra validar hierarquia
  const { data: jobsProjeto } = await supabase
    .from("jobs")
    .select("id, job_pai_id, status")
    .eq("projeto_id", orc.projeto_id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado");

  const jobsAtivos = jobsProjeto ?? [];
  const principalAtual = jobsAtivos.find((j) => j.job_pai_id === null);

  if (jobsAtivos.length > 0 && !parsed.data.posicao_hierarquia) {
    return {
      ok: false,
      message: "Escolha se este job será principal ou sub-job.",
    };
  }

  // 4. Determina job_pai_id baseado em posicao_hierarquia
  let jobPaiId: string | null = null;
  if (jobsAtivos.length > 0) {
    if (parsed.data.posicao_hierarquia === "sub_job") {
      if (!principalAtual) {
        return { ok: false, message: "Não há principal no projeto — este job precisa ser principal." };
      }
      jobPaiId = principalAtual.id;
    }
    // Se posicao='principal', jobPaiId fica null; o principal atual será re-vinculado no swap abaixo
  }

  // 5. Gera código
  let codigo: string;
  try {
    codigo = await gerarCodigoJob(supabase, session.activeTenant.id);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  // 6. Insert do novo job. Se posicao='principal' e já existe principal, precisa swap.
  //    Estratégia: insert nasce como sub-job do principal atual (satisfaz unique),
  //    depois flipa (update principal atual pra apontar pro novo, update novo pra null).
  const nasceComoSubJob =
    parsed.data.posicao_hierarquia === "principal" && principalAtual;

  const insertPayload = {
    tenant_id: session.activeTenant.id,
    codigo,
    projeto_id: orc.projeto_id,
    orcamento_id: orcamentoId,
    versao_orcamento_aprovada_id: orc.versao_aprovada_id,
    nome: parsed.data.nome,
    produto: parsed.data.produto,
    regional_id: parsed.data.regional_id,
    cidade: parsed.data.cidade,
    data_inicio_prevista: parsed.data.data_inicio_prevista,
    data_fim_prevista: parsed.data.data_fim_prevista,
    responsavel_id: parsed.data.responsavel_id,
    valor_total: parsed.data.valor_total,
    job_pai_id: nasceComoSubJob ? principalAtual!.id : jobPaiId,
    status: "aberto" as JobStatus,
    created_by: session.profile.id,
  };

  const { data: novo, error: errIns } = await supabase
    .from("jobs")
    .insert(insertPayload)
    .select("id")
    .single();

  if (errIns) {
    console.error("[jobs.criar]", errIns.message);
    return { ok: false, message: mapJobDbError(errIns.message) };
  }

  // 7. Se nasceu como sub-job só pra virar principal, faz o swap
  if (nasceComoSubJob && principalAtual) {
    // Update principal atual: aponta pro novo
    const { error: errSwap1 } = await supabase
      .from("jobs")
      .update({ job_pai_id: novo.id })
      .eq("id", principalAtual.id)
      .eq("tenant_id", session.activeTenant.id);

    if (errSwap1) {
      console.error("[jobs.criar.swap1]", errSwap1.message);
      return {
        ok: false,
        message: "Job criado mas swap de hierarquia falhou. Verifique manualmente.",
      };
    }

    // Update novo: vira principal (job_pai_id = null)
    const { error: errSwap2 } = await supabase
      .from("jobs")
      .update({ job_pai_id: null })
      .eq("id", novo.id)
      .eq("tenant_id", session.activeTenant.id);

    if (errSwap2) {
      console.error("[jobs.criar.swap2]", errSwap2.message);
      return {
        ok: false,
        message: "Job criado mas swap de hierarquia falhou. Verifique manualmente.",
      };
    }
  }

  // 8. Update orçamento: status = 'job_criado'
  const { error: errOrc } = await supabase
    .from("orcamentos")
    .update({ status: "job_criado" })
    .eq("id", orcamentoId)
    .eq("tenant_id", session.activeTenant.id);

  if (errOrc) {
    console.error("[jobs.criar.orc_status]", errOrc.message);
    // não bloqueia — job foi criado; log e segue
  }

  await logAuditEvent({
    acao: "job.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: novo.id,
    metadata: {
      codigo,
      orcamento_id: orcamentoId,
      projeto_id: orc.projeto_id,
      posicao: parsed.data.posicao_hierarquia ?? "principal",
    },
  });

  revalidatePath(`/orcamentos/${orc.projeto_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${orcamentoId}`);
  revalidatePath("/jobs");
  return { ok: true, id: novo.id };
}

export async function atualizarJob(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = jobSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // Apenas campos operacionais são atualizáveis aqui — hierarquia e status têm actions próprias
  const { error } = await supabase
    .from("jobs")
    .update({
      nome: parsed.data.nome,
      produto: parsed.data.produto,
      regional_id: parsed.data.regional_id,
      cidade: parsed.data.cidade,
      data_inicio_prevista: parsed.data.data_inicio_prevista,
      data_fim_prevista: parsed.data.data_fim_prevista,
      responsavel_id: parsed.data.responsavel_id,
      valor_total: parsed.data.valor_total,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[jobs.atualizar]", error.message);
    return { ok: false, message: mapJobDbError(error.message) };
  }

  await logAuditEvent({
    acao: "job.atualizado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: id,
  });

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  return { ok: true, id };
}

export async function atualizarHierarquiaJob(
  id: string,
  novoPapel: "principal" | "sub_job",
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  // Fetch job atual + projeto_id + status
  const { data: job } = await supabase
    .from("jobs")
    .select("id, projeto_id, job_pai_id, status")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; projeto_id: string; job_pai_id: string | null; status: string }>();

  if (!job) return { ok: false, message: "Job não encontrado." };
  if (job.status === "cancelado") {
    return { ok: false, message: "Job cancelado não pode mudar de hierarquia." };
  }

  const jaEhPrincipal = job.job_pai_id === null;
  if (novoPapel === "principal" && jaEhPrincipal) {
    return { ok: true, id }; // no-op
  }
  if (novoPapel === "sub_job" && !jaEhPrincipal) {
    return { ok: true, id }; // já é sub-job
  }

  // Fetch outros jobs ativos do projeto
  const { data: outros } = await supabase
    .from("jobs")
    .select("id, job_pai_id")
    .eq("projeto_id", job.projeto_id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("id", id)
    .neq("status", "cancelado");

  const outrosAtivos = outros ?? [];

  if (novoPapel === "sub_job") {
    // Preciso encontrar o principal atual (que não seja este)
    const principal = outrosAtivos.find((j) => j.job_pai_id === null);
    if (!principal) {
      return {
        ok: false,
        message: "Este é o único job do projeto — não pode virar sub-job.",
      };
    }
    const { error } = await supabase
      .from("jobs")
      .update({ job_pai_id: principal.id })
      .eq("id", id)
      .eq("tenant_id", session.activeTenant.id);
    if (error) {
      console.error("[jobs.hierarquia.sub_job]", error.message);
      return { ok: false, message: mapJobDbError(error.message) };
    }
  } else {
    // novoPapel === "principal", e este job era sub-job
    const principalAtual = outrosAtivos.find((j) => j.job_pai_id === null);
    if (!principalAtual) {
      // Não existe principal atualmente — só vira principal, sem swap
      const { error } = await supabase
        .from("jobs")
        .update({ job_pai_id: null })
        .eq("id", id)
        .eq("tenant_id", session.activeTenant.id);
      if (error) {
        console.error("[jobs.hierarquia.principal.simples]", error.message);
        return { ok: false, message: mapJobDbError(error.message) };
      }
    } else {
      // Swap atômico: primeiro update principal atual pra apontar pra este;
      // depois update este pra job_pai_id = null
      const { error: err1 } = await supabase
        .from("jobs")
        .update({ job_pai_id: id })
        .eq("id", principalAtual.id)
        .eq("tenant_id", session.activeTenant.id);
      if (err1) {
        console.error("[jobs.hierarquia.swap1]", err1.message);
        return { ok: false, message: mapJobDbError(err1.message) };
      }

      const { error: err2 } = await supabase
        .from("jobs")
        .update({ job_pai_id: null })
        .eq("id", id)
        .eq("tenant_id", session.activeTenant.id);
      if (err2) {
        console.error("[jobs.hierarquia.swap2]", err2.message);
        return { ok: false, message: mapJobDbError(err2.message) };
      }
    }
  }

  await logAuditEvent({
    acao: "job.hierarquia_alterada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: id,
    metadata: { novo_papel: novoPapel },
  });

  revalidatePath(`/jobs/${id}`);
  revalidatePath(`/orcamentos/${job.projeto_id}`);
  return { ok: true, id };
}

export async function atualizarStatusJob(
  id: string,
  novoStatus: JobStatus,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, projeto_id, orcamento_id, job_pai_id")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: JobStatus;
      projeto_id: string;
      orcamento_id: string;
      job_pai_id: string | null;
    }>();

  if (!job) return { ok: false, message: "Job não encontrado." };

  const transicoesValidas = JOB_STATUS_TRANSICOES[job.status];
  if (!transicoesValidas.includes(novoStatus)) {
    return {
      ok: false,
      message: `Transição inválida: ${job.status} → ${novoStatus}.`,
    };
  }

  // Se está cancelando o principal e existem sub-jobs ativos, bloqueia
  if (novoStatus === "cancelado" && job.job_pai_id === null) {
    const { count: subJobs } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("projeto_id", job.projeto_id)
      .eq("job_pai_id", job.id)
      .neq("status", "cancelado");
    if ((subJobs ?? 0) > 0) {
      return {
        ok: false,
        message: "Cancele ou transfira os sub-jobs antes de cancelar o principal.",
      };
    }
  }

  const { error } = await supabase
    .from("jobs")
    .update({ status: novoStatus })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[jobs.status]", error.message);
    return { ok: false, message: mapJobDbError(error.message) };
  }

  await logAuditEvent({
    acao: "job.status_alterado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: id,
    metadata: { de: job.status, para: novoStatus },
  });

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath(`/orcamentos/${job.projeto_id}`);
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);
  return { ok: true, id };
}
```

- [ ] **Step 2: Verify typecheck + commit**

```bash
npm run typecheck
git add app/(app)/jobs/actions.ts
git commit -m "task005: server actions criarJob + atualizarJob + hierarquia + status"
```

---

### Task 11: Drawer "Criar job" no orçamento aprovado

**Files:**
- Create: `app/(app)/orcamentos/[projetoId]/[orcId]/criar-job-drawer.tsx`
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx`

**Interfaces:**
- Consumes: `criarJob` from Task 10, `Regional`, `Job`, `Profile` from types, `calcularTotais` from `lib/calculos/versao-totais.ts`
- Produces: drawer que abre a partir do orçamento aprovado, chama `criarJob`

- [ ] **Step 1: Criar `app/(app)/orcamentos/[projetoId]/[orcId]/criar-job-drawer.tsx`**

```typescript
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Save, Plus } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import type { Job, Profile, Regional } from "@/lib/types";
import { criarJob, type ActionResult } from "@/app/(app)/jobs/actions";

const SEM_REGIONAL = "__none__";

interface Props {
  orcamentoId: string;
  clienteNome: string; // read-only display
  jobsAtivosDoProjeto: Pick<Job, "id" | "codigo" | "nome" | "job_pai_id">[];
  regionais: Pick<Regional, "id" | "nome">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
  responsavelDefaultId: string; // default do projeto.responsavel_id
  valorFaturamento: number; // pre-preenchido, derivado da versão aprovada
  disabled?: boolean;
  disabledReason?: string;
}

export function CriarJobDrawer({
  orcamentoId,
  clienteNome,
  jobsAtivosDoProjeto,
  regionais,
  responsaveis,
  responsavelDefaultId,
  valorFaturamento,
  disabled,
  disabledReason,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  const principalAtual = jobsAtivosDoProjeto.find((j) => j.job_pai_id === null) ?? null;
  const jaExisteJobNoProjeto = jobsAtivosDoProjeto.length > 0;

  const [posicao, setPosicao] = React.useState<"principal" | "sub_job">(
    jaExisteJobNoProjeto ? "sub_job" : "principal",
  );
  const [regionalId, setRegionalId] = React.useState<string>(SEM_REGIONAL);
  const [responsavelId, setResponsavelId] = React.useState<string>(responsavelDefaultId);

  function resetForm() {
    setError(null);
    setFieldErrors({});
    setPosicao(jaExisteJobNoProjeto ? "sub_job" : "principal");
    setRegionalId(SEM_REGIONAL);
    setResponsavelId(responsavelDefaultId);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set(
      "regional_id",
      regionalId === SEM_REGIONAL ? "" : regionalId,
    );
    formData.set("responsavel_id", responsavelId);
    if (jaExisteJobNoProjeto) {
      formData.set("posicao_hierarquia", posicao);
      if (posicao === "sub_job" && principalAtual) {
        formData.set("job_pai_id", principalAtual.id);
      }
    }

    startTransition(async () => {
      const res: ActionResult = await criarJob(orcamentoId, formData);
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  }

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title={disabledReason}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground cursor-not-allowed"
      >
        <Plus className="h-3.5 w-3.5" />
        Criar job
      </button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Criar job
      </button>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Criar job</DialogTitle>
          <DialogDescription>
            O job vira a unidade operacional dessa entrega. Ele é vinculado ao orçamento aprovado e à versão aprovada.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {jaExisteJobNoProjeto && principalAtual && (
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                <h3 className="text-sm font-semibold">Hierarquia deste job</h3>
                <label className="flex items-start gap-3 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="__posicao"
                    checked={posicao === "sub_job"}
                    onChange={() => setPosicao("sub_job")}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">
                      Sub-job de{" "}
                      <span className="font-mono">{principalAtual.codigo}</span>
                      {" · "}
                      {principalAtual.nome}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Este job fica embaixo do principal existente do projeto.
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-3 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="__posicao"
                    checked={posicao === "principal"}
                    onChange={() => setPosicao("principal")}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">Novo principal do projeto</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      O job atual (
                      <span className="font-mono">{principalAtual.codigo}</span>) vira sub-job deste.
                    </div>
                  </div>
                </label>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="nome">
                  Nome do job <span className="text-california-red">*</span>
                </Label>
                <Input
                  id="nome"
                  name="nome"
                  autoFocus
                  required
                  maxLength={200}
                  placeholder="Ex.: Bebedouros SP"
                />
                {fieldErrors.nome?.map((m, i) => (
                  <p key={i} className="text-xs text-california-red">{m}</p>
                ))}
              </div>

              <div className="space-y-2">
                <Label>Cliente</Label>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  {clienteNome}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="produto">Produto</Label>
                <Input
                  id="produto"
                  name="produto"
                  maxLength={120}
                  placeholder="Ex.: Guaraná Antarctica"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="regional_id">Regional</Label>
                <Select value={regionalId} onValueChange={setRegionalId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sem regional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_REGIONAL}>Sem regional</SelectItem>
                    {regionais.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cidade">Cidade</Label>
                <Input id="cidade" name="cidade" maxLength={120} placeholder="Ex.: São Paulo" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="data_inicio_prevista">Data de início</Label>
                <DatePicker
                  name="data_inicio_prevista"
                  placeholder="Selecione a data"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="data_fim_prevista">Data de fim</Label>
                <DatePicker
                  name="data_fim_prevista"
                  placeholder="Selecione a data"
                />
                {fieldErrors.data_fim_prevista?.map((m, i) => (
                  <p key={i} className="text-xs text-california-red">{m}</p>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="responsavel_id">
                  Responsável <span className="text-california-red">*</span>
                </Label>
                <Select value={responsavelId} onValueChange={setResponsavelId} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um responsável" />
                  </SelectTrigger>
                  <SelectContent>
                    {responsaveis.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="valor_total">Valor Total (R$)</Label>
                <Input
                  id="valor_total"
                  name="valor_total"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={valorFaturamento.toFixed(2)}
                  className="no-spinner"
                  placeholder="0,00"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red-hover disabled:opacity-50 transition-colors"
            >
              {pending ? "Criando..." : (
                <>
                  <Save className="h-4 w-4" />
                  Criar job
                </>
              )}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Modificar `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx`**

Adicionar ao `Promise.all` (na page.tsx do orçamento):

```typescript
supabase
  .from("regionais")
  .select("id, nome")
  .eq("tenant_id", session.activeTenant.id)
  .eq("ativo", true)
  .order("nome"),
supabase
  .from("jobs")
  .select("id, codigo, nome, job_pai_id, orcamento_id, status")
  .eq("projeto_id", params.projetoId)
  .eq("tenant_id", session.activeTenant.id)
  .neq("status", "cancelado"),
```

Ajustar destructuring do resultado (adicionar `regionaisRes`, `jobsProjetoRes`).

Derivar constantes:
```typescript
const regionais = (regionaisRes.data ?? []) as Pick<Regional, "id" | "nome">[];
const jobsAtivosDoProjeto = (jobsProjetoRes.data ?? []) as Pick<Job, "id" | "codigo" | "nome" | "job_pai_id">[];
const jobDoOrcamento = jobsAtivosDoProjeto.find((j) => (j as any).orcamento_id === orcamento.id);
```

Calcular valor do faturamento da versão aprovada (usar helper existente):

```typescript
import { calcularTotais } from "@/lib/calculos/versao-totais";

// ...após fetch de versão aprovada + itens dela...
let valorFaturamento = 0;
if (orcamento.status === "aprovado" && orcamento.versao_aprovada_id) {
  // Fetch os itens da versão aprovada (se não já feito) pra calcular
  // Nota: se já existe agregado, use-o; senão fetch adicional
  // (O código atual já faz agregação; use total_orcado total + honor + imposto)
  const versaoAprovada = versoesBrutas.find(v => v.id === orcamento.versao_aprovada_id);
  if (versaoAprovada) {
    const agg = agregadoPorVersao.get(versaoAprovada.id) ?? { count: 0, total: 0 };
    // O helper calcularTotais precisa dos itens; se agg só tem count+total,
    // usar total como base e aplicar percentuais da versão diretamente.
    // Simplificado: valor = total × (1 + honor) × 1/(1 - imposto)
    const perc_honor = Number(versaoAprovada.percentual_honorarios ?? 0) / 100;
    const perc_imp = Number(versaoAprovada.percentual_imposto ?? 0) / 100;
    const bruto = agg.total * (1 + perc_honor);
    valorFaturamento = perc_imp > 0 && perc_imp < 1 ? bruto / (1 - perc_imp) : bruto;
  }
}
```

Renderizar no header do orçamento (perto do editor drawer, ou como bloco de ação separado):

```typescript
{orcamento.status === "aprovado" && !jobDoOrcamento && (
  <CriarJobDrawer
    orcamentoId={orcamento.id}
    clienteNome={clienteNome ?? "—"}
    jobsAtivosDoProjeto={jobsAtivosDoProjeto}
    regionais={regionais}
    responsaveis={responsaveis}
    responsavelDefaultId={projeto.responsavel?.id ?? ""}
    valorFaturamento={valorFaturamento}
  />
)}

{orcamento.status === "job_criado" && jobDoOrcamento && (
  <Link
    href={`/jobs/${jobDoOrcamento.id}`}
    prefetch={false}
    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
  >
    Ver job {jobDoOrcamento.codigo}
  </Link>
)}
```

Import necessários:
```typescript
import { CriarJobDrawer } from "./criar-job-drawer";
import type { Job, Regional } from "@/lib/types";
```

- [ ] **Step 3: Verify typecheck + commit**

```bash
npm run typecheck
git add app/(app)/orcamentos/[projetoId]/[orcId]/
git commit -m "task005: drawer Criar job no orcamento aprovado + link Ver job"
```

---

### Task 12: Rota `/jobs` (placeholder)

**Files:**
- Create: `app/(app)/jobs/page.tsx`

**Interfaces:**
- Consumes: `requireSession` (só valida sessão)
- Produces: rota `/jobs` com placeholder

- [ ] **Step 1: Criar `app/(app)/jobs/page.tsx`**

```typescript
import { Briefcase } from "lucide-react";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  await requireSession();

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Operação
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Cada orçamento aprovado vira um job. A gestão detalhada (planejado, realizado, produção) chega em breve.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-12 shadow-soft text-center max-w-2xl mx-auto">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
          <Briefcase className="h-6 w-6" />
        </div>
        <h2 className="mt-6 text-xl font-semibold">Gestão de jobs em breve</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Por enquanto, jobs são criados a partir do orçamento aprovado. A visão consolidada com filtros, planejado × realizado, produção e financeiro fica pra próxima fase.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(app)/jobs/page.tsx
git commit -m "task005: rota /jobs (placeholder)"
```

---

### Task 13: Rota `/jobs/[jobId]` (detalhe + editor drawer + hierarquia drawer)

**Files:**
- Create: `app/(app)/jobs/[jobId]/page.tsx`
- Create: `app/(app)/jobs/[jobId]/job-editor-drawer.tsx`
- Create: `app/(app)/jobs/[jobId]/editar-hierarquia-drawer.tsx`

**Interfaces:**
- Consumes: `Job`, `Regional`, `Profile`, `atualizarJob`, `atualizarHierarquiaJob`, `atualizarStatusJob`, `JOB_STATUS_TRANSICOES`, `jobStatusLabel`
- Produces: rota funcional `/jobs/[jobId]`

- [ ] **Step 1: Criar `app/(app)/jobs/[jobId]/page.tsx`**

```typescript
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, Layers, Info, Circle, CheckCircle2, XCircle, PlayCircle } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import type { Job, JobStatus, Profile, Regional } from "@/lib/types";
import { jobStatusLabel, JOB_STATUS_TRANSICOES } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { JobEditorDrawer } from "./job-editor-drawer";
import { EditarHierarquiaDrawer } from "./editar-hierarquia-drawer";
import { StatusActions } from "./status-actions";

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: JobStatus): string {
  switch (status) {
    case "aberto": return "bg-blue-50 text-blue-700 border-blue-200";
    case "em_producao": return "bg-amber-50 text-amber-700 border-amber-200";
    case "finalizado": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "cancelado": return "bg-slate-100 text-slate-500 border-slate-200";
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

export default async function JobDetailPage({
  params,
}: {
  params: { jobId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const [jobRes, regionaisRes, responsaveis] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, tenant_id, codigo, nome, produto, cidade, data_inicio_prevista, data_fim_prevista, responsavel_id, valor_total, status, projeto_id, orcamento_id, versao_orcamento_aprovada_id, regional_id, job_pai_id, created_at, updated_at, responsavel:profiles!responsavel_id(id, nome), regional:regionais(id, nome), orcamento:orcamentos(id, codigo, nome, projeto_id), versao:versoes_orcamento!versao_orcamento_aprovada_id(id, numero_versao, nome), projeto:projetos(id, codigo, nome), pai:jobs!job_pai_id(id, codigo, nome)",
      )
      .eq("id", params.jobId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    listActiveMembers(session.activeTenant.id),
  ]);

  if (jobRes.error) console.error("[job.detail]", jobRes.error.message);
  const raw = jobRes.data as any;
  if (!raw) notFound();

  // Fetch sub-jobs se este é principal
  let subJobs: { id: string; codigo: string; nome: string; status: JobStatus }[] = [];
  if (raw.job_pai_id === null) {
    const { data: subs } = await supabase
      .from("jobs")
      .select("id, codigo, nome, status")
      .eq("projeto_id", raw.projeto_id)
      .eq("job_pai_id", raw.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at");
    subJobs = (subs ?? []) as any[];
  }

  // Fetch outros jobs ativos do mesmo projeto (pra saber se hierarquia é editável)
  const { count: outrosAtivos } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("projeto_id", raw.projeto_id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("id", raw.id)
    .neq("status", "cancelado");

  const podeEditarHierarquia = (outrosAtivos ?? 0) > 0;
  const ehPrincipal = raw.job_pai_id === null;
  const transicoes = JOB_STATUS_TRANSICOES[raw.status as JobStatus];

  const regionais = (regionaisRes.data ?? []) as Pick<Regional, "id" | "nome">[];

  const job: Job = {
    id: raw.id,
    tenant_id: raw.tenant_id,
    codigo: raw.codigo,
    projeto_id: raw.projeto_id,
    orcamento_id: raw.orcamento_id,
    versao_orcamento_aprovada_id: raw.versao_orcamento_aprovada_id,
    nome: raw.nome,
    produto: raw.produto,
    regional_id: raw.regional_id,
    cidade: raw.cidade,
    data_inicio_prevista: raw.data_inicio_prevista,
    data_fim_prevista: raw.data_fim_prevista,
    responsavel_id: raw.responsavel_id,
    valor_total: raw.valor_total !== null ? Number(raw.valor_total) : null,
    job_pai_id: raw.job_pai_id,
    status: raw.status,
    created_by: null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Link
          href={`/orcamentos/${raw.projeto_id}/${raw.orcamento_id}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para orçamento {raw.orcamento?.codigo}
        </Link>
        <div className="mt-3">
          <p className="font-mono text-xs font-semibold text-muted-foreground">{job.codigo}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{job.nome}</h1>
            <Badge className={cn("border", statusBadgeClasses(job.status))}>
              {jobStatusLabel(job.status)}
            </Badge>
            {job.status !== "cancelado" && (
              <JobEditorDrawer
                job={job}
                regionais={regionais}
                responsaveis={responsaveis}
              />
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-4">
            <Info className="h-4 w-4 text-california-red" />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Metadata</h2>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Cliente</dt>
            <dd className="font-medium">{raw.projeto?.nome ?? "—"}</dd>
            <dt className="text-muted-foreground">Produto</dt>
            <dd>{job.produto ?? "—"}</dd>
            <dt className="text-muted-foreground">Regional</dt>
            <dd>{raw.regional?.nome ?? "—"}</dd>
            <dt className="text-muted-foreground">Cidade</dt>
            <dd>{job.cidade ?? "—"}</dd>
            <dt className="text-muted-foreground">Data início</dt>
            <dd>{formatDate(job.data_inicio_prevista)}</dd>
            <dt className="text-muted-foreground">Data fim</dt>
            <dd>{formatDate(job.data_fim_prevista)}</dd>
            <dt className="text-muted-foreground">Responsável</dt>
            <dd>{raw.responsavel?.nome ?? "—"}</dd>
            <dt className="text-muted-foreground">Valor total</dt>
            <dd className="font-semibold">{formatMoney(job.valor_total)}</dd>
          </dl>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="h-4 w-4 text-california-red" />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Hierarquia</h2>
          </div>
          {ehPrincipal ? (
            <div className="space-y-3 text-sm">
              <p>
                <span className="font-semibold">Este é o job principal</span> do projeto.
              </p>
              {subJobs.length > 0 && (
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wider mb-2">Sub-jobs</p>
                  <ul className="space-y-1">
                    {subJobs.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/jobs/${s.id}`}
                          prefetch={false}
                          className="text-california-red hover:underline"
                        >
                          {s.codigo} · {s.nome}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {podeEditarHierarquia && job.status !== "cancelado" && (
                <EditarHierarquiaDrawer jobId={job.id} papelAtual="principal" />
              )}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p>
                Sub-job de:{" "}
                {raw.pai && (
                  <Link
                    href={`/jobs/${raw.pai.id}`}
                    prefetch={false}
                    className="font-mono text-california-red hover:underline"
                  >
                    {raw.pai.codigo} · {raw.pai.nome}
                  </Link>
                )}
              </p>
              {podeEditarHierarquia && job.status !== "cancelado" && (
                <EditarHierarquiaDrawer jobId={job.id} papelAtual="sub_job" />
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Briefcase className="h-4 w-4 text-california-red" />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Origem</h2>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Projeto</dt>
            <dd>
              <Link
                href={`/orcamentos/${raw.projeto_id}`}
                prefetch={false}
                className="text-california-red hover:underline"
              >
                <span className="font-mono">{raw.projeto?.codigo}</span> · {raw.projeto?.nome}
              </Link>
            </dd>
            <dt className="text-muted-foreground">Orçamento</dt>
            <dd>
              <Link
                href={`/orcamentos/${raw.projeto_id}/${raw.orcamento_id}`}
                prefetch={false}
                className="text-california-red hover:underline"
              >
                <span className="font-mono">{raw.orcamento?.codigo}</span> · {raw.orcamento?.nome}
              </Link>
            </dd>
            <dt className="text-muted-foreground">Versão aprovada</dt>
            <dd>
              <Link
                href={`/orcamentos/${raw.projeto_id}/${raw.orcamento_id}/versoes/${raw.versao_orcamento_aprovada_id}`}
                prefetch={false}
                className="text-california-red hover:underline"
              >
                v{raw.versao?.numero_versao} {raw.versao?.nome ? `· ${raw.versao.nome}` : ""}
              </Link>
            </dd>
          </dl>
        </div>

        {transicoes.length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <Circle className="h-4 w-4 text-california-red" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Status</h2>
            </div>
            <StatusActions jobId={job.id} transicoes={transicoes} />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar `app/(app)/jobs/[jobId]/status-actions.tsx`**

```typescript
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlayCircle, CheckCircle2, XCircle } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { atualizarStatusJob } from "@/app/(app)/jobs/actions";
import type { JobStatus } from "@/lib/types";
import { jobStatusLabel } from "@/lib/types";

interface Props {
  jobId: string;
  transicoes: JobStatus[];
}

const STATUS_META: Record<JobStatus, { icon: React.ElementType; classes: string; verb: string }> = {
  aberto: { icon: PlayCircle, classes: "bg-blue-600 text-white hover:bg-blue-700", verb: "reabrir" },
  em_producao: { icon: PlayCircle, classes: "bg-amber-600 text-white hover:bg-amber-700", verb: "iniciar produção" },
  finalizado: { icon: CheckCircle2, classes: "bg-emerald-600 text-white hover:bg-emerald-700", verb: "finalizar" },
  cancelado: { icon: XCircle, classes: "bg-california-red text-white hover:bg-california-red-hover", verb: "cancelar" },
};

export function StatusActions({ jobId, transicoes }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmando, setConfirmando] = React.useState<JobStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function handleTransicao(status: JobStatus) {
    setError(null);
    startTransition(async () => {
      const res = await atualizarStatusJob(jobId, status);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {transicoes.map((s) => {
          const meta = STATUS_META[s];
          const Icon = meta.icon;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setConfirmando(s)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${meta.classes}`}
            >
              <Icon className="h-4 w-4" />
              {jobStatusLabel(s)}
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-california-red">{error}</p>}

      {confirmando && (
        <ConfirmDialog
          open={!!confirmando}
          onOpenChange={(o) => !o && setConfirmando(null)}
          title={`${STATUS_META[confirmando].verb.charAt(0).toUpperCase() + STATUS_META[confirmando].verb.slice(1)} este job?`}
          description={`O status muda pra "${jobStatusLabel(confirmando)}". ${confirmando === "cancelado" ? "Cancelar libera criar novo job pro mesmo orçamento." : ""}`}
          confirmLabel={jobStatusLabel(confirmando)}
          onConfirm={() => handleTransicao(confirmando)}
          pending={pending}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Criar `app/(app)/jobs/[jobId]/job-editor-drawer.tsx`**

Drawer com form dos campos operacionais (nome, produto, regional, cidade, datas, responsável, valor). Baseia no padrão de `criar-job-drawer.tsx` (Task 11) sem o bloco de hierarquia, e chama `atualizarJob`. Copie a estrutura do drawer da task 11 e adapte:

```typescript
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Save, Pencil } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import type { Job, Profile, Regional } from "@/lib/types";
import { atualizarJob } from "@/app/(app)/jobs/actions";

const SEM_REGIONAL = "__none__";

interface Props {
  job: Job;
  regionais: Pick<Regional, "id" | "nome">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
}

export function JobEditorDrawer({ job, regionais, responsaveis }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [regionalId, setRegionalId] = React.useState<string>(
    job.regional_id ?? SEM_REGIONAL,
  );
  const [responsavelId, setResponsavelId] = React.useState<string>(job.responsavel_id);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    formData.set("regional_id", regionalId === SEM_REGIONAL ? "" : regionalId);
    formData.set("responsavel_id", responsavelId);
    startTransition(async () => {
      const res = await atualizarJob(job.id, formData);
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar
      </button>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Editar job {job.codigo}</DialogTitle>
          <DialogDescription>Atualize os campos operacionais do job.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="nome">Nome <span className="text-california-red">*</span></Label>
                <Input id="nome" name="nome" required maxLength={200} defaultValue={job.nome} />
                {fieldErrors.nome?.map((m, i) => <p key={i} className="text-xs text-california-red">{m}</p>)}
              </div>
              <div className="space-y-2">
                <Label htmlFor="produto">Produto</Label>
                <Input id="produto" name="produto" maxLength={120} defaultValue={job.produto ?? ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="regional_id">Regional</Label>
                <Select value={regionalId} onValueChange={setRegionalId}>
                  <SelectTrigger><SelectValue placeholder="Sem regional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_REGIONAL}>Sem regional</SelectItem>
                    {regionais.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cidade">Cidade</Label>
                <Input id="cidade" name="cidade" maxLength={120} defaultValue={job.cidade ?? ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="data_inicio_prevista">Data início</Label>
                <DatePicker name="data_inicio_prevista" defaultValue={job.data_inicio_prevista ?? ""} placeholder="Selecione a data" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="data_fim_prevista">Data fim</Label>
                <DatePicker name="data_fim_prevista" defaultValue={job.data_fim_prevista ?? ""} placeholder="Selecione a data" />
                {fieldErrors.data_fim_prevista?.map((m, i) => <p key={i} className="text-xs text-california-red">{m}</p>)}
              </div>
              <div className="space-y-2">
                <Label htmlFor="responsavel_id">Responsável <span className="text-california-red">*</span></Label>
                <Select value={responsavelId} onValueChange={setResponsavelId} required>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {responsaveis.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="valor_total">Valor Total (R$)</Label>
                <Input
                  id="valor_total"
                  name="valor_total"
                  type="number"
                  step="0.01"
                  min="0"
                  className="no-spinner"
                  defaultValue={job.valor_total !== null ? job.valor_total.toFixed(2) : ""}
                />
              </div>
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red-hover disabled:opacity-50 transition-colors"
            >
              {pending ? "Salvando..." : (<><Save className="h-4 w-4" />Salvar</>)}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Criar `app/(app)/jobs/[jobId]/editar-hierarquia-drawer.tsx`**

```typescript
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { atualizarHierarquiaJob } from "@/app/(app)/jobs/actions";

interface Props {
  jobId: string;
  papelAtual: "principal" | "sub_job";
}

export function EditarHierarquiaDrawer({ jobId, papelAtual }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [novoPapel, setNovoPapel] = React.useState<"principal" | "sub_job">(papelAtual);
  const [error, setError] = React.useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (novoPapel === papelAtual) {
      setOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await atualizarHierarquiaJob(jobId, novoPapel);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
      >
        <Layers className="h-3.5 w-3.5" />
        Editar hierarquia
      </button>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Editar hierarquia do job</DialogTitle>
          <DialogDescription>
            Troque o papel deste job dentro do projeto. Só há um principal por projeto — trocar promove este e rebaixa o atual.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <input
                type="radio"
                checked={novoPapel === "principal"}
                onChange={() => setNovoPapel("principal")}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Principal do projeto</div>
                <div className="text-xs text-muted-foreground mt-0.5">O principal atual (se existir) vira sub-job.</div>
              </div>
            </label>
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <input
                type="radio"
                checked={novoPapel === "sub_job"}
                onChange={() => setNovoPapel("sub_job")}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Sub-job</div>
                <div className="text-xs text-muted-foreground mt-0.5">Fica abaixo do principal atual do projeto.</div>
              </div>
            </label>
            {error && <p className="text-xs text-california-red">{error}</p>}
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red-hover disabled:opacity-50 transition-colors"
            >
              {pending ? "Salvando..." : "Aplicar"}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Verify typecheck + commit**

```bash
npm run typecheck
git add app/(app)/jobs/[jobId]/
git commit -m "task005: /jobs/[jobId] com metadata + editor drawer + hierarquia drawer + status"
```

---

### Task 14: Sidebar — adicionar entrada "Jobs"

**Files:**
- Modify: sidebar component (localizar via grep)

**Interfaces:**
- Consumes: existing sidebar item pattern
- Produces: entrada "Jobs" (ícone Briefcase) na sidebar linkando pra `/jobs`

- [ ] **Step 1: Localizar arquivo de sidebar**

```bash
git ls-files "**/sidebar*" "**/nav*"
```

Read o arquivo identificado. Localizar a lista de itens (provavelmente estrutura tipo `{ label, href, icon }[]`).

- [ ] **Step 2: Adicionar entrada "Jobs"**

Adicionar entre "Orçamentos" e "Administração" (ou onde faça sentido logicamente):

```typescript
{
  label: "Jobs",
  href: "/jobs",
  icon: Briefcase,
}
```

Se o ícone `Briefcase` não estiver importado ainda:

```typescript
import { Briefcase } from "lucide-react";
```

- [ ] **Step 3: Verify typecheck + commit**

```bash
npm run typecheck
git add <arquivo-sidebar>
git commit -m "task005: sidebar ganha entrada Jobs"
```

---

### Task 15: Verificação final — typecheck, lint, aplicar migration, atualizar HANDOFF

**Files:** nenhum código (só verificação e aplicar migration via MCP)

**Interfaces:** consome `mcp__supabase-write__apply_migration`

- [ ] **Step 1: Rodar typecheck**

```bash
npm run typecheck
```

Esperado: `exit 0`, 0 erros.

- [ ] **Step 2: Rodar lint**

```bash
npm run lint
```

Esperado: `exit 0`, 0 warnings/erros.

- [ ] **Step 3: Aplicar migration em prod via MCP**

Chamar `mcp__supabase-write__apply_migration` com:
- `name`: `"task005_jobs"`
- `query`: conteúdo integral de `supabase/migrations/20260729000002_task005_jobs.sql`

Verificar que retorna `success: true`.

- [ ] **Step 4: Smoke SQL — verificar tabelas e trigger**

Chamar `mcp__supabase__execute_sql` com:

```sql
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('regionais', 'jobs');
```
Esperado: 2 linhas.

```sql
select typname from pg_type where typname = 'job_status';
```
Esperado: 1 linha.

```sql
select trigger_name from information_schema.triggers
 where trigger_name = 'trg_cascata_versao_aprovada';
```
Esperado: 1 linha.

- [ ] **Step 5: Atualizar `docs/HANDOFF.md`**

Modificar a linha "Última atualização" no topo:

```markdown
**Última atualização** (2026-07-29): Aprovação de versão (Fase E Task 004) + Criação de Job (Task 005) — botões aprovar/cancelar na versão, drawer "Criar job" no orçamento aprovado com hierarquia principal/sub-job, tabela `jobs` + `regionais`, `/jobs` placeholder + `/jobs/[id]` funcional. Trigger `cascata_versao_aprovada` no banco.
```

Adicionar à lista de migrations aplicadas na seção 1:

```
20260729000002  task005_jobs
```

Remover das Prioridades a Prioridade 2 (Aprovação — feita) e Prioridade 3 (Task 005 — feita).

- [ ] **Step 6: Commit final**

```bash
git add docs/HANDOFF.md
git commit -m "docs(handoff): registra Fase E aprovacao + Task 005 jobs aplicadas"
```

---

## Self-Review — Checklist Post-Plan

### 1. Cobertura da spec

| Seção spec | Task |
|---|---|
| §4.1 tabela regionais | Task 1 |
| §4.2 enum job_status | Task 1 |
| §4.3 tabela jobs (com FKs, unique parciais, self-ref) | Task 1 |
| §4.4 trigger cascata_versao_aprovada | Task 1 |
| §5 types Regional, Job, JobStatus, transições, labels | Task 2 |
| §6 validations regionais + jobs | Task 3 |
| §7 audit actions | Task 4 |
| §8.1 aprovarVersao + cancelarAprovacaoVersao | Task 8 |
| §8.2 criarJob + atualizarJob + atualizarHierarquiaJob + atualizarStatusJob | Task 10 |
| §8.3 server actions regionais | Task 6 |
| §8.4 gerarCodigoJob | Task 5 |
| §9.1 UI aprovar/desaprovar | Task 9 |
| §9.2 Drawer criar job + botões condicionais no orçamento | Task 11 |
| §9.3 /jobs placeholder | Task 12 |
| §9.4 /jobs/[jobId] (detail + editor + hierarquia + status) | Task 13 |
| §9.5 UI regionais | Task 7 |
| §10 regras invioláveis | server actions em Tasks 8, 10 |
| §11 performance | contemplado em cada task (prefetch=false, Promise.all, force-dynamic) |
| §12 casos borda | validações em Tasks 8, 10 |
| §13 arquivos afetados | mapa no início do plano |
| §14 rollback | Task 15 documenta smoke queries; rollback é `git revert` + migration reversa |
| §15 fora do escopo | não vira task |

**Sem lacunas.** Sidebar (Task 14) é infra não listada explicitamente na spec mas necessária pra `/jobs` ser navegável.

### 2. Placeholder scan

Percorri o plano: nenhum "TBD", "TODO", "implementar depois", "similar a Task N", "handle errors" genérico. Cada step tem código concreto ou comando exato.

### 3. Consistência de tipos

- `Job` interface (Task 2) usa `valor_total: number | null`. Server action `atualizarJob` (Task 10) faz coercion via `z.coerce.number()` no schema. Consistente.
- `criarJob(orcamentoId, formData)` (Task 10) matches drawer's invocation em Task 11.
- `atualizarStatusJob(id, novoStatus)` (Task 10) matches `<StatusActions>` em Task 13.
- `atualizarHierarquiaJob(id, 'principal' | 'sub_job')` (Task 10) matches `<EditarHierarquiaDrawer>` em Task 13.
- `Regional`, `Profile` picks são consistentes entre drawer (Task 11) e page (Task 13).

**Nenhuma inconsistência.**

---

## Verificação final (na Task 15)

```bash
npm run typecheck   # exit 0
npm run lint        # exit 0
# migration aplicada via MCP; smoke SQL confirma tabelas/trigger
```
