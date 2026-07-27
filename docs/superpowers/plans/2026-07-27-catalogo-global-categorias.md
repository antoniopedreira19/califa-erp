# Catálogo global de categorias — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o modelo de categoria-por-versão (`versoes_orcamento_categorias`) por um catálogo global do tenant (`categorias`), com CRUD em `/categorias` acessível pelo hub `/cadastros`.

**Architecture:** Nova tabela `categorias` com escopo tenant, gerenciada em nova rota top-level `/categorias` (padrão espelhando `/clientes` e `/fornecedores`). Todos os membros do tenant criam/editam; só admin inativa/reativa (gate no server action). Import de planilha deixa de ler categoria (col B ignorada). Duplicação de versão preserva `categoria_id` como está (categoria é global). Dados existentes são wipados (Fase G recém-fechada, volume mínimo).

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + RLS + SSR), Zod, Tailwind + shadcn/ui, ExcelJS (parser).

**Spec:** [`docs/superpowers/specs/2026-07-27-catalogo-global-categorias-design.md`](../specs/2026-07-27-catalogo-global-categorias-design.md)

## Global Constraints

- **Performance é feature:** aplicar checklist de [`docs/PERFORMANCE.md`](../../PERFORMANCE.md) antes de qualquer commit que toca `app/(app)/**` ou `lib/supabase/**`. `<Link>` em lista de 5+ itens navegáveis → `prefetch={false}`. Queries só pra contar/somar → agregação, nunca embed pesado. Queries independentes num server component → `Promise.all`.
- **RLS + GRANT:** toda tabela nova precisa de RLS **e** `grant ... to authenticated`.
- **`(select auth.uid())`** em policies, nunca `auth.uid()` direto (evita re-avaliar por linha).
- **`tenant_id` obrigatório** em toda tabela operacional, com FK pra `tenants` e policies via `is_tenant_member(tenant_id)`.
- **Server actions padrão:** `requireSession()` → Zod `safeParse` → `.eq('tenant_id', session.activeTenant.id)` → `logAuditEvent` → `revalidatePath`.
- **Soft-delete only:** nunca DELETE de categoria; sempre `ativo = false`.
- **`stopPropagation` em botões de ação** dentro de linhas clicáveis (feedback registrado em `feedback_ui_linha_clicavel.md`).
- **`SUPABASE_SERVICE_ROLE_KEY` só server-side.** Nunca no cliente.
- **Nenhum teste automatizado.** Verificação = `npx tsc --noEmit` + `npx next lint` + smoke test manual no navegador (`npm run dev`).

## Arquivos afetados

**Novos:**
- `supabase/migrations/20260729000001_categorias_globais.sql`
- `app/(app)/categorias/page.tsx` — lista (server component)
- `app/(app)/categorias/actions.ts` — 4 server actions
- `app/(app)/categorias/categorias-list.tsx` — tabela (client)
- `app/(app)/categorias/categoria-drawer.tsx` — drawer criar/editar (client)

**Modificados:**
- `lib/types.ts` — remove `VersaoOrcamentoCategoria`, adiciona `Categoria`
- `lib/auth/audit.ts` — 4 novas ações no enum `AuditAction`
- `lib/validations/categorias.ts` — validado (já existe com o schema certo)
- `app/(app)/cadastros/page.tsx` — adiciona card "Categorias" + query de contagem
- `app/(app)/orcamentos/[id]/versoes/[versaoId]/page.tsx` — remove fetch de `versoes_orcamento_categorias`, remove import/uso de `NovaCategoriaDrawer`, muda fetch pra ler de `categorias` global
- `app/(app)/orcamentos/[id]/versoes/actions.ts` — remove funções `criarCategoria`/`renomearCategoria`/`removerCategoria` + helper `mapCategoriaDbError`; simplifica `duplicarVersao` (remove cópia/remap)
- `app/(app)/orcamentos/[id]/versoes/importar-actions.ts` — remove bulk-insert de categorias e map
- `lib/importacao/parser-oficial.ts` — remove leitura da col B (campo `categoria`)

**Deletados:**
- `app/(app)/orcamentos/[id]/versoes/[versaoId]/nova-categoria-drawer.tsx`

---

## Task 1: Migration + apply

**Files:**
- Create: `supabase/migrations/20260729000001_categorias_globais.sql`

**Interfaces:**
- Consumes: nada
- Produces: tabela `public.categorias` com RLS e grants; coluna `versoes_orcamento_itens.categoria_id` com FK apontando pra `categorias(id)`; tabela `versoes_orcamento_categorias` deletada

- [ ] **Step 1: Criar o arquivo de migration**

Criar `supabase/migrations/20260729000001_categorias_globais.sql`:

```sql
-- Task: Catálogo global de categorias no tenant
-- Substitui versoes_orcamento_categorias (por versão) por categorias (por tenant)
-- Spec: docs/superpowers/specs/2026-07-27-catalogo-global-categorias-design.md

-- 1) Wipe: zera classificação de todos os itens antes de trocar FK.
-- Volume atual é mínimo (Fase G recém-fechada). GP recadastra via drawer.
update public.versoes_orcamento_itens set categoria_id = null;

-- 2) Remove a FK antiga (que apontava pra versoes_orcamento_categorias).
alter table public.versoes_orcamento_itens
  drop constraint if exists versoes_orcamento_itens_categoria_id_fkey;

-- 3) Descarta a tabela antiga (cascade limpa policies/triggers/índices).
drop table if exists public.versoes_orcamento_categorias cascade;

-- 4) Cria a nova tabela categorias (escopo tenant).
create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint categorias_nome_nao_vazio check (length(trim(nome)) > 0)
);

create unique index uniq_categoria_nome_por_tenant
  on public.categorias(tenant_id, lower(nome));

create index idx_categorias_tenant on public.categorias(tenant_id);
create index idx_categorias_ativo on public.categorias(tenant_id, ativo);

create trigger trg_categorias_updated_at
  before update on public.categorias
  for each row execute function public.set_updated_at();

-- 5) Adiciona a FK nova (aponta pra categorias global) em versoes_orcamento_itens.
alter table public.versoes_orcamento_itens
  add constraint versoes_orcamento_itens_categoria_id_fkey
  foreign key (categoria_id) references public.categorias(id) on delete restrict;

-- 6) RLS: todos os membros do tenant fazem select/insert/update.
--    DELETE não tem policy (soft-delete only via ativo=false).
--    Gate "só admin inativa" fica no server action, não em RLS.
alter table public.categorias enable row level security;

create policy categorias_select on public.categorias
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy categorias_insert on public.categorias
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

create policy categorias_update on public.categorias
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- 7) GRANTs (RLS não substitui GRANT).
grant select, insert, update on public.categorias to authenticated;
```

- [ ] **Step 2: Aplicar migration via MCP**

Usar `mcp__supabase-write__apply_migration` com:
- `name`: `20260729000001_categorias_globais`
- `query`: o conteúdo do arquivo criado no Step 1

- [ ] **Step 3: Verificar que a tabela existe e a antiga sumiu**

Usar `mcp__supabase-write__list_tables` com `schemas=["public"]` e confirmar:
- `categorias` aparece na lista
- `versoes_orcamento_categorias` **não** aparece
- `versoes_orcamento_itens` continua na lista (com `categoria_id` nullable)

- [ ] **Step 4: Verificar advisors (segurança + performance)**

Usar `mcp__supabase-write__get_advisors` com `type="security"` e `type="performance"`. Nenhum novo warning deve aparecer relacionado a `categorias`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729000001_categorias_globais.sql
git commit -m "$(cat <<'EOF'
Task 004+: migration catalog global de categorias

Substitui versoes_orcamento_categorias (por versão) por categorias
(por tenant), destravando análises futuras de rentabilidade e gasto
por categoria através de múltiplos orçamentos.

- Wipe do categoria_id em todos os itens antes de trocar FK
- Drop table versoes_orcamento_categorias
- Nova tabela categorias (tenant_id, nome, ativo, created_by)
- Unique parcial por (tenant_id, lower(nome))
- FK de versoes_orcamento_itens.categoria_id aponta pra categorias
- RLS: todos os membros fazem select/insert/update
- Gate "só admin inativa/reativa" fica no server action

Spec: docs/superpowers/specs/2026-07-27-catalogo-global-categorias-design.md
EOF
)"
```

---

## Task 2: Types, audit, validation

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/auth/audit.ts`
- Modify: `lib/validations/categorias.ts`

**Interfaces:**
- Consumes: nada
- Produces: type `Categoria` (com `ativo`, `created_by`); 4 novas actions no enum `AuditAction` (`categoria.criada`, `categoria.editada`, `categoria.inativada`, `categoria.reativada`); schema Zod `categoriaSchema` (já existe, ajustado se necessário)

- [ ] **Step 1: Remover `VersaoOrcamentoCategoria` de `lib/types.ts`**

Ler `lib/types.ts` e localizar o bloco:

```typescript
export interface VersaoOrcamentoCategoria {
  id: string;
  tenant_id: string;
  versao_orcamento_id: string;
  nome: string;
  created_at: string;
  updated_at: string;
}
```

Substituir por:

```typescript
export interface Categoria {
  id: string;
  tenant_id: string;
  nome: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}
```

- [ ] **Step 2: Adicionar 4 audit actions em `lib/auth/audit.ts`**

Ler `lib/auth/audit.ts` e localizar o type `AuditAction`. Adicionar as 4 novas entradas ao final da união (antes de `"acao_negada"`):

```typescript
  | "categoria.criada"
  | "categoria.editada"
  | "categoria.inativada"
  | "categoria.reativada"
```

- [ ] **Step 3: Validar schema Zod**

Ler `lib/validations/categorias.ts`. Se já existe com este formato, deixar como está:

```typescript
import { z } from "zod";

export const categoriaSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome da categoria.")
    .max(120, "Máximo 120 caracteres."),
});

export type CategoriaInput = z.infer<typeof categoriaSchema>;
```

Se o arquivo não exportar `CategoriaInput`, adicionar a exportação. Se `categoriaSchema` já estiver correto, não modificar.

- [ ] **Step 4: Type check**

Rodar `npx tsc --noEmit`.

Esperado: **vários erros** em arquivos que importam `VersaoOrcamentoCategoria` (página da versão, actions, etc.) — isso é intencional e será resolvido nas próximas tasks. Anotar quais arquivos precisam ser tocados.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/auth/audit.ts lib/validations/categorias.ts
git commit -m "$(cat <<'EOF'
types/audit/validation: prepara catálogo global de categorias

- Substitui type VersaoOrcamentoCategoria por Categoria (com ativo)
- Adiciona 4 ações de audit: categoria.criada/editada/inativada/reativada
- Confirma categoriaSchema com nome trim + max 120

Fica com erros de compilação intencionais até as tasks seguintes
removerem/ajustarem os consumidores.
EOF
)"
```

---

## Task 3: Server actions de categoria (CRUD)

**Files:**
- Create: `app/(app)/categorias/actions.ts`

**Interfaces:**
- Consumes: `requireSession` (session.activeTenant.id, session.profile.id, session.activeRole), `createClient` de `lib/supabase/server`, `categoriaSchema` de `lib/validations/categorias`, `logAuditEvent` de `lib/auth/audit`
- Produces: 4 server actions exportadas:
  - `criarCategoria(formData: FormData): Promise<ActionResult>`
  - `editarCategoria(id: string, formData: FormData): Promise<ActionResult>`
  - `inativarCategoria(id: string): Promise<ActionResult>`
  - `reativarCategoria(id: string): Promise<ActionResult>`
- Tipo `ActionResult = { ok: true; id: string } | { ok: false; message: string; fieldErrors?: Record<string, string[]> }`

- [ ] **Step 1: Criar `app/(app)/categorias/actions.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import { categoriaSchema } from "@/lib/validations/categorias";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapCategoriaDbError(msg: string): string {
  if (msg.includes("uniq_categoria_nome_por_tenant")) {
    return "Já existe uma categoria com esse nome.";
  }
  if (msg.includes("categorias_nome_nao_vazio")) {
    return "Nome da categoria não pode ficar vazio.";
  }
  return "Não foi possível salvar a categoria.";
}

export async function criarCategoria(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = categoriaSchema.safeParse({
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
    .from("categorias")
    .insert({
      tenant_id: session.activeTenant.id,
      nome: parsed.data.nome,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[categorias.criar]", error.message);
    return { ok: false, message: mapCategoriaDbError(error.message) };
  }

  await logAuditEvent({
    acao: "categoria.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "categoria",
    entidadeId: data.id,
    metadata: { nome: parsed.data.nome },
  });

  revalidatePath("/categorias");
  revalidatePath("/cadastros");
  return { ok: true, id: data.id };
}

export async function editarCategoria(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = categoriaSchema.safeParse({
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
    .from("categorias")
    .update({ nome: parsed.data.nome })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[categorias.editar]", error.message);
    return { ok: false, message: mapCategoriaDbError(error.message) };
  }

  await logAuditEvent({
    acao: "categoria.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "categoria",
    entidadeId: id,
    metadata: { nome: parsed.data.nome },
  });

  revalidatePath("/categorias");
  return { ok: true, id };
}

export async function inativarCategoria(id: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador") {
    return {
      ok: false,
      message: "Só administradores podem inativar categorias.",
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("categorias")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[categorias.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "categoria.inativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "categoria",
    entidadeId: id,
  });

  revalidatePath("/categorias");
  revalidatePath("/cadastros");
  return { ok: true, id };
}

export async function reativarCategoria(id: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador") {
    return {
      ok: false,
      message: "Só administradores podem reativar categorias.",
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("categorias")
    .update({ ativo: true })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[categorias.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "categoria.reativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "categoria",
    entidadeId: id,
  });

  revalidatePath("/categorias");
  revalidatePath("/cadastros");
  return { ok: true, id };
}
```

- [ ] **Step 2: Type check parcial**

Rodar `npx tsc --noEmit`. Este arquivo específico deve compilar sem erro (o restante do projeto ainda pode ter erros das tasks anteriores/pendentes).

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/categorias/actions.ts"
git commit -m "$(cat <<'EOF'
categorias: 4 server actions do CRUD do catálogo global

- criarCategoria: qualquer membro do tenant
- editarCategoria: qualquer membro do tenant
- inativarCategoria: gate admin (session.activeRole)
- reativarCategoria: gate admin (session.activeRole)

Todas: requireSession, Zod, tenant guard, audit, revalidatePath.
Erros de unique/nome vazio são traduzidos por mapCategoriaDbError.
EOF
)"
```

---

## Task 4: Página /categorias + drawer + tabela

**Files:**
- Create: `app/(app)/categorias/page.tsx`
- Create: `app/(app)/categorias/categorias-list.tsx`
- Create: `app/(app)/categorias/categoria-drawer.tsx`

**Interfaces:**
- Consumes: type `Categoria` de `lib/types`, actions de `./actions.ts` (`criarCategoria`, `editarCategoria`, `inativarCategoria`, `reativarCategoria`), `requireSession`, `createClient`
- Produces: rota `/categorias` funcional (lista, busca, filtro por status, criar via drawer, editar via drawer, inativar/reativar visível só pra admin)

- [ ] **Step 1: Criar `app/(app)/categorias/page.tsx` (server component)**

```typescript
import Link from "next/link";
import { ChevronRight, Tag } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Categoria } from "@/lib/types";
import { CategoriasList } from "./categorias-list";

export const dynamic = "force-dynamic";

export default async function CategoriasPage() {
  const session = await requireSession();
  const supabase = createClient();

  const { data, error } = await supabase
    .from("categorias")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("nome", { ascending: true })
    .returns<Categoria[]>();

  if (error) {
    console.error("[categorias.page]", error.message);
  }

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
          <span>Categorias</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Tag className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Categorias</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Vocabulário compartilhado por todos os orçamentos do tenant.
          Classifique itens para permitir análises de rentabilidade e gasto por categoria.
        </p>
      </header>

      <CategoriasList categorias={rows} isAdmin={isAdmin} />
    </div>
  );
}
```

- [ ] **Step 2: Criar `app/(app)/categorias/categoria-drawer.tsx` (client component)**

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
import { criarCategoria, editarCategoria } from "./actions";
import type { Categoria } from "@/lib/types";

type Props =
  | { mode: "criar"; categoria?: undefined; trigger?: React.ReactNode }
  | { mode: "editar"; categoria: Categoria; trigger?: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void };

export function CategoriaDrawer(props: Props) {
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
          ? await criarCategoria(formData)
          : await editarCategoria(props.categoria.id, formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  }

  const initialNome = props.mode === "editar" ? props.categoria.nome : "";
  const title = props.mode === "criar" ? "Nova categoria" : "Editar categoria";
  const submitLabel =
    props.mode === "criar"
      ? pending ? "Criando..." : "Criar categoria"
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
            Nova categoria
          </button>
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {props.mode === "criar"
              ? "Categorias ficam disponíveis pra todos os orçamentos do tenant."
              : "Renomear afeta todos os itens já classificados com esta categoria."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                name="nome"
                autoFocus
                required
                maxLength={120}
                defaultValue={initialNome}
                placeholder="Ex.: Produção, Logística, Equipe"
              />
              {fieldErrors.nome?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
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

- [ ] **Step 3: Criar `app/(app)/categorias/categorias-list.tsx` (client component)**

```typescript
"use client";

import * as React from "react";
import { Search, MoreVertical, Power, PowerOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Categoria } from "@/lib/types";
import { CategoriaDrawer } from "./categoria-drawer";
import { inativarCategoria, reativarCategoria } from "./actions";
import { useRouter } from "next/navigation";

type StatusFiltro = "ativas" | "inativas" | "todas";

export function CategoriasList({
  categorias,
  isAdmin,
}: {
  categorias: Categoria[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativas");
  const [pending, startTransition] = React.useTransition();
  const [editando, setEditando] = React.useState<Categoria | null>(null);
  const [confirmando, setConfirmando] = React.useState<{
    categoria: Categoria;
    acao: "inativar" | "reativar";
  } | null>(null);

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return categorias.filter((c) => {
      if (status === "ativas" && !c.ativo) return false;
      if (status === "inativas" && c.ativo) return false;
      if (!q) return true;
      return c.nome.toLowerCase().includes(q);
    });
  }, [categorias, busca, status]);

  function handleConfirm() {
    if (!confirmando) return;
    const { categoria, acao } = confirmando;
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarCategoria(categoria.id)
          : await reativarCategoria(categoria.id);
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
        <CategoriaDrawer mode="criar" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {categorias.length === 0
              ? "Nenhuma categoria cadastrada ainda."
              : "Nenhuma categoria corresponde aos filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Nome
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setEditando(c)}
                  className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
                >
                  <td className="px-4 py-3">{c.nome}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.ativo
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          c.ativo ? "bg-emerald-500" : "bg-muted-foreground"
                        }`}
                      />
                      {c.ativo ? "Ativa" : "Inativa"}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmando({
                            categoria: c,
                            acao: c.ativo ? "inativar" : "reativar",
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title={c.ativo ? "Inativar" : "Reativar"}
                      >
                        {c.ativo ? (
                          <PowerOff className="h-3.5 w-3.5" />
                        ) : (
                          <Power className="h-3.5 w-3.5" />
                        )}
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
        <CategoriaDrawer
          mode="editar"
          categoria={editando}
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
              ? "Inativar categoria?"
              : "Reativar categoria?"
          }
          description={
            confirmando.acao === "inativar"
              ? `A categoria "${confirmando.categoria.nome}" some dos dropdowns em novos itens, mas continua aparecendo nos itens que já a usam.`
              : `A categoria "${confirmando.categoria.nome}" volta a aparecer nos dropdowns.`
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

**Nota sobre imports:** se `ConfirmDialog` estiver em outro path (ex.: `@/components/ui/confirm-dialog` vs `@/components/confirm-dialog`), ajustar. Se `Select` for do Radix diretamente vs re-exportado, confirmar. Usar mesma convenção que `app/(app)/clientes/clientes-list.tsx`.

- [ ] **Step 4: Type check**

Rodar `npx tsc --noEmit`. Erros esperados: os dos consumers ainda pendentes (versão page, etc.), **mas** os arquivos criados nesta task devem compilar. Se qualquer erro apontar pra `app/(app)/categorias/**`, corrigir antes de commit.

- [ ] **Step 5: Lint**

Rodar `npx next lint`. Corrigir warnings dos arquivos criados.

- [ ] **Step 6: Smoke test manual**

```powershell
npm run dev
```

Abrir `http://localhost:3000/categorias` (login primeiro em `/login`).

Testar:
- [ ] Página renderiza com header e estado vazio.
- [ ] Clicar "Nova categoria" abre drawer. Criar "Produção" → drawer fecha, lista atualiza.
- [ ] Tentar criar "produção" (case diferente) → erro amigável ("Já existe...").
- [ ] Clicar na linha "Produção" abre drawer de edição com nome preenchido.
- [ ] Editar nome, salvar → lista atualiza.
- [ ] Filtro "Inativas" → lista vazia (nada inativado ainda).
- [ ] Como você é admin, botão de inativar (ícone `PowerOff`) aparece → clicar, confirmar → categoria some da lista "Ativas".
- [ ] Filtro "Inativas" → aparece. Botão vira ícone `Power` (reativar).

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/categorias/page.tsx" "app/(app)/categorias/categorias-list.tsx" "app/(app)/categorias/categoria-drawer.tsx"
git commit -m "$(cat <<'EOF'
categorias: página /categorias com CRUD do catálogo global

- Server component page.tsx com fetch por tenant (force-dynamic)
- categorias-list.tsx: busca por nome + filtro por status (ativas/inativas/todas)
- Linha da tabela clicável abre drawer de edição
- Botão inativar/reativar só visível pra admin
- categoria-drawer.tsx: drawer unificado criar/editar
- Confirmação via ConfirmDialog antes de inativar/reativar

Segue padrão visual de clientes/fornecedores.
EOF
)"
```

---

## Task 5: Card no hub /cadastros

**Files:**
- Modify: `app/(app)/cadastros/page.tsx`

**Interfaces:**
- Consumes: mesma sessão + supabase client já usados no hub
- Produces: card "Categorias" no grid, com contagem de categorias ativas do tenant

- [ ] **Step 1: Ler o arquivo atual**

Ler `app/(app)/cadastros/page.tsx` e identificar:
- O bloco `Promise.all` com contagens (`clientesRes`, `fornecedoresRes`).
- O JSX que renderiza os `<CadastroCard />`.
- Como `Tag` (ícone) é importado (`lucide-react`).

- [ ] **Step 2: Adicionar contagem de categorias ativas**

Estender o `Promise.all` para incluir uma terceira query:

```typescript
const [clientesRes, fornecedoresRes, categoriasRes] = await Promise.all([
  supabase
    .from("clientes")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "ativo"),
  supabase
    .from("fornecedores")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "ativo"),
  supabase
    .from("categorias")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", session.activeTenant.id)
    .eq("ativo", true),
]);
```

- [ ] **Step 3: Adicionar `Tag` ao import de `lucide-react`**

No topo do arquivo, no import de `lucide-react`, adicionar `Tag` (se ainda não estiver importado).

- [ ] **Step 4: Adicionar o card no grid**

Após o `<CadastroCard>` de Fornecedores, adicionar:

```tsx
<CadastroCard
  href="/categorias"
  icon={Tag}
  title="Categorias"
  description="Vocabulário compartilhado para classificar itens de orçamento."
  count={categoriasRes.count ?? 0}
/>
```

Se o `CadastroCard` no arquivo atual não tiver prop `description`, usar a assinatura existente (adaptar).

- [ ] **Step 5: Type check + smoke**

```powershell
npx tsc --noEmit
npm run dev
```

Abrir `http://localhost:3000/cadastros`. Confirmar:
- [ ] Aparecem 3 cards: Clientes, Fornecedores, Categorias.
- [ ] Card de Categorias mostra o número correto (deve ser o mesmo que aparece em `/categorias`).
- [ ] Clicar no card navega pra `/categorias`.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/cadastros/page.tsx"
git commit -m "$(cat <<'EOF'
cadastros: card Categorias no hub

Adiciona contagem de categorias ativas ao Promise.all das queries
paralelas do hub e renderiza card ao lado de Clientes e Fornecedores.
EOF
)"
```

---

## Task 6: Página da versão — mudar fonte do dropdown + remover botão

**Files:**
- Modify: `app/(app)/orcamentos/[id]/versoes/[versaoId]/page.tsx`
- Delete: `app/(app)/orcamentos/[id]/versoes/[versaoId]/nova-categoria-drawer.tsx`

**Interfaces:**
- Consumes: nova tabela `categorias` (queried by tenant + ativo=true)
- Produces: fetch da versão puxa categorias globais em vez de `versoes_orcamento_categorias`; sem botão "Nova categoria" no header; sem drawer inline

- [ ] **Step 1: Ler o page atual e identificar todos os pontos a mudar**

Ler `app/(app)/orcamentos/[id]/versoes/[versaoId]/page.tsx`. Identificar:
- (a) A query dentro do `Promise.all` que busca `versoes_orcamento_categorias`.
- (b) O import de `NovaCategoriaDrawer`.
- (c) O JSX onde `<NovaCategoriaDrawer .../>` é renderizado (no header).
- (d) Como `categorias` é passado pros componentes filhos (drawer de item, tabela).
- (e) O type usado (deve ser `VersaoOrcamentoCategoria` — que foi removido).

- [ ] **Step 2: Trocar a query de categorias**

Substituir:

```typescript
supabase
  .from("versoes_orcamento_categorias")
  .select("*")
  .eq("versao_orcamento_id", params.versaoId)
  .eq("tenant_id", session.activeTenant.id)
  .returns<VersaoOrcamentoCategoria[]>(),
```

Por:

```typescript
supabase
  .from("categorias")
  .select("*")
  .eq("tenant_id", session.activeTenant.id)
  .eq("ativo", true)
  .order("nome", { ascending: true })
  .returns<Categoria[]>(),
```

- [ ] **Step 3: Atualizar import de types**

Trocar `VersaoOrcamentoCategoria` por `Categoria` no import de `@/lib/types`.

- [ ] **Step 4: Remover o botão "Nova categoria" do header**

Localizar `<NovaCategoriaDrawer ... />` no JSX e **remover a linha inteira**.

- [ ] **Step 5: Remover o import de `NovaCategoriaDrawer`**

Remover a linha `import { NovaCategoriaDrawer } from "./nova-categoria-drawer";` (ou similar).

- [ ] **Step 6: Deletar o arquivo do drawer**

```powershell
Remove-Item "app/(app)/orcamentos/[id]/versoes/[versaoId]/nova-categoria-drawer.tsx"
```

- [ ] **Step 7: Confirmar que categorias inativas com itens vinculados ainda aparecem no drawer de item**

**Contexto:** o design especifica que se um item já tinha uma categoria e ela foi inativada depois, a categoria continua aparecendo *selecionada* no dropdown daquele item específico. Mas a query da Step 2 filtra por `ativo = true`.

**Solução:** o componente que renderiza o dropdown do item precisa considerar isso. Se o `categoria_id` do item aponta pra uma categoria não na lista de ativas, precisamos incluí-la ainda. Duas opções:

**Opção A (simples, recomendada):** buscar TODAS as categorias do tenant (ativas + inativas) na page e passar duas listas pro drawer de item: `categoriasAtivas` (usada no dropdown) + `categoriasReferenciadas` (id → nome, usada só pra exibir se a categoria selecionada estiver inativa).

**Opção B:** buscar todas, filtrar no client.

Ir de **Opção A**. Trocar a query da Step 2 para não filtrar por ativo, e no componente que renderiza o dropdown, filtrar ativas para as opções, mas incluir a inativa selecionada se houver.

Query revisada (substituir a da Step 2):

```typescript
supabase
  .from("categorias")
  .select("*")
  .eq("tenant_id", session.activeTenant.id)
  .order("nome", { ascending: true })
  .returns<Categoria[]>(),
```

O filtro por ativa fica na renderização do dropdown (próximo step).

- [ ] **Step 8: Localizar o drawer de item da versão e ajustar o dropdown**

Rodar `Glob "app/(app)/orcamentos/[id]/versoes/[versaoId]/*.tsx"` para listar arquivos. Identificar o que renderiza o form de item (nome provável: `item-drawer.tsx`, `novo-item-drawer.tsx`, ou similar).

No componente do dropdown de categoria, ajustar de:

```tsx
{categorias.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
```

Para:

```tsx
{categorias
  .filter(c => c.ativo || c.id === itemAtual?.categoria_id)
  .map(c => (
    <SelectItem key={c.id} value={c.id}>
      {c.nome}
      {!c.ativo && " (inativa)"}
    </SelectItem>
  ))}
```

Se houver um botão "+ Nova categoria" **inline** dentro deste drawer, **remover**.

- [ ] **Step 9: Type check**

Rodar `npx tsc --noEmit`. Erros esperados restantes devem ser só nos consumidores da Task 7/8/9/10 (parser, importar-actions, versoes/actions.ts).

- [ ] **Step 10: Smoke test manual**

```powershell
npm run dev
```

- [ ] Ir em `/orcamentos/<id>/versoes/<versaoId>` (usar orçamento e versão existentes).
- [ ] Confirmar que o botão "Nova categoria" **não aparece** mais no header.
- [ ] Botão "Novo grupo" continua.
- [ ] Editar um item existente → dropdown de categoria mostra a lista global de `/categorias`.
- [ ] Nenhum botão "+ Nova categoria" inline dentro do drawer do item.

- [ ] **Step 11: Commit**

```bash
git add -u "app/(app)/orcamentos/[id]/versoes/[versaoId]/"
git commit -m "$(cat <<'EOF'
versão: dropdown de categoria lê do catálogo global

- page.tsx: query passa a ler public.categorias (tenant, sem filtro
  por ativo — filtro fica no dropdown pra preservar categoria inativa
  já vinculada a item)
- Remove botão "Nova categoria" do header (cadastro agora em /categorias)
- Remove NovaCategoriaDrawer e deleta arquivo
- Drawer de item filtra ativas + preserva a selecionada mesmo se inativa
EOF
)"
```

---

## Task 7: Parser cleanup — remover leitura da col B

**Files:**
- Modify: `lib/importacao/parser-oficial.ts`

**Interfaces:**
- Consumes: nada
- Produces: `ParseItem` sem campo `categoria`; parser não lê mais coluna B

- [ ] **Step 1: Ler o arquivo atual**

Ler `lib/importacao/parser-oficial.ts`. Identificar:
- O campo `categoria: string | null` na interface `ParseItem`.
- A função/loop onde a col B é lida (procurar por `row.getCell(2)` ou similar).
- Qualquer warning gerado a partir de categoria (mensagens tipo "categoria vazia", "categoria muito longa").

- [ ] **Step 2: Remover `categoria` de `ParseItem`**

Remover a linha `categoria: string | null` (e comentários associados) da interface `ParseItem`.

- [ ] **Step 3: Remover leitura da col B no parser**

No corpo do parser, remover:
- A extração do valor da col B (linha tipo `const categoria = row.getCell(2).text.trim()`).
- Qualquer atribuição `categoria: categoria || null` no objeto que constrói o `ParseItem`.
- Warnings relacionados a categoria.

- [ ] **Step 4: Confirmar que outros consumidores do parser não referenciam `.categoria`**

Rodar Grep:

```
pattern: "\.categoria\b"
type: ts
```

Se `importar-actions.ts` aparecer usando `.categoria`, será tratado na Task 8.

- [ ] **Step 5: Type check**

Rodar `npx tsc --noEmit`. Erro esperado: `importar-actions.ts` acessando `.categoria` — tratado na próxima task.

- [ ] **Step 6: Commit**

```bash
git add lib/importacao/parser-oficial.ts
git commit -m "$(cat <<'EOF'
parser: remove leitura da coluna B (categoria)

Com catálogo global, categoria vira responsabilidade puramente do
sistema. Parser não interpreta mais categoria vinda de planilha —
coluna B é ignorada silenciosamente (sem warning, pra não poluir
preview de import com aviso esperado).
EOF
)"
```

---

## Task 8: importar-actions cleanup

**Files:**
- Modify: `app/(app)/orcamentos/[id]/versoes/importar-actions.ts`

**Interfaces:**
- Consumes: `ParseItem` sem `categoria`
- Produces: `confirmarImportacao` cria itens com `categoria_id = null` sempre; sem bulk-insert de categorias

- [ ] **Step 1: Ler o arquivo e identificar blocos a remover**

Ler `app/(app)/orcamentos/[id]/versoes/importar-actions.ts`. Identificar:
- Bloco de bulk-insert em `versoes_orcamento_categorias` (linhas ~291-327 conforme mapa).
- Uso de `categoriaIdPorNomeLower` no bulk insert de itens (linhas ~342-346).
- Qualquer `Set` de nomes coletados de `it.categoria`.

- [ ] **Step 2: Remover bloco de coleta e bulk-insert de categorias**

Remover completamente:

```typescript
// 4b) Criar categorias únicas (case-insensitive) a partir dos itens do parse.
const categoriaNomes = new Set<string>();
for (const grupo of parsed.grupos) {
  for (const it of grupo.itens) {
    if (it.categoria && it.categoria.trim().length > 0) {
      categoriaNomes.add(it.categoria.trim());
    }
  }
}

const categoriaIdPorNomeLower = new Map<string, string>();

if (categoriaNomes.size > 0) {
  // ... todo o bloco de insert em versoes_orcamento_categorias ...
}
```

- [ ] **Step 3: Ajustar bulk-insert de itens**

No bloco que constrói `itensParaInserir`, trocar:

```typescript
const categoriaId = it.categoria
  ? categoriaIdPorNomeLower.get(it.categoria.trim().toLowerCase()) ?? null
  : null;

itensParaInserir.push({
  // ...
  categoria_id: categoriaId,
  // ...
});
```

Por:

```typescript
itensParaInserir.push({
  // ...
  categoria_id: null,
  // ...
});
```

- [ ] **Step 4: Type check**

Rodar `npx tsc --noEmit`. `importar-actions.ts` deve compilar limpo agora.

- [ ] **Step 5: Smoke test manual (import)**

```powershell
npm run dev
```

- [ ] Ir num orçamento, abrir drawer de importação, subir uma planilha padrão.
- [ ] Preview aparece normalmente (sem seção de categorias).
- [ ] Confirmar import → versão criada, itens todos com categoria vazia (a atribuir manualmente).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/orcamentos/[id]/versoes/importar-actions.ts"
git commit -m "$(cat <<'EOF'
importar-actions: remove bulk-insert de categorias

Import não persiste mais categorias — todos os itens importados ficam
com categoria_id = null e são classificados manualmente pelo GP no
drawer de item depois do import. Categoria vira responsabilidade
puramente do sistema.
EOF
)"
```

---

## Task 9: Duplicar versão cleanup + limpar actions antigas de categoria

**Files:**
- Modify: `app/(app)/orcamentos/[id]/versoes/actions.ts`

**Interfaces:**
- Consumes: nada
- Produces: `duplicarVersao` sem cópia/remap de categoria; actions `criarCategoria`/`renomearCategoria`/`removerCategoria` (por versão) e helper `mapCategoriaDbError` removidas

- [ ] **Step 1: Ler o arquivo atual**

Ler `app/(app)/orcamentos/[id]/versoes/actions.ts`. Identificar:
- (a) Funções `criarCategoria`, `renomearCategoria`, `removerCategoria` (linhas ~631-774 conforme mapa).
- (b) Helper `mapCategoriaDbError` (linhas ~621-629).
- (c) `duplicarVersao` — bloco de cópia de categorias com `categoriaMap` (linhas ~228-327).
- (d) Import de `categoriaSchema` (que agora só é usado pelas actions globais em `app/(app)/categorias/actions.ts`).

- [ ] **Step 2: Remover as 3 actions de categoria por versão**

Deletar as funções exportadas `criarCategoria`, `renomearCategoria`, `removerCategoria` inteiras.

- [ ] **Step 3: Remover helper `mapCategoriaDbError`**

Deletar o helper.

- [ ] **Step 4: Simplificar `duplicarVersao`**

Localizar o bloco de duplicação de categorias:

```typescript
// Duplica categorias e mapeia old_id → new_id (mesmo padrão de grupos).
const { data: categoriasOriginais } = await supabase
  .from("versoes_orcamento_categorias")
  ...

const categoriaMap = new Map<string, string>();
if (categoriasOriginais && categoriasOriginais.length > 0) {
  ...
}
```

**Remover o bloco inteiro** (queries, map, insert).

Depois, no bloco de cópia de itens, localizar:

```typescript
categoria_id: i.categoria_id ? categoriaMap.get(i.categoria_id) ?? null : null,
```

Substituir por:

```typescript
categoria_id: i.categoria_id,
```

(Preserva a FK como está — categoria é global agora, os IDs continuam válidos.)

- [ ] **Step 5: Remover imports agora não usados**

Se `categoriaSchema` era importado só pras 3 actions removidas, remover o import. Rodar type check pra confirmar.

- [ ] **Step 6: Type check**

Rodar `npx tsc --noEmit`. Deve compilar sem erros agora.

- [ ] **Step 7: Lint**

Rodar `npx next lint`. Corrigir warnings.

- [ ] **Step 8: Smoke test — duplicar versão**

```powershell
npm run dev
```

- [ ] Em `/orcamentos/<id>`, clicar em duplicar uma versão que tem itens classificados.
- [ ] Nova versão criada — verificar que os itens copiados preservam a `categoria_id` (dropdown mostra a mesma categoria selecionada).
- [ ] Editar categoria no `/categorias` — mudança reflete tanto na versão original quanto na duplicada (é a mesma categoria global).

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/orcamentos/[id]/versoes/actions.ts"
git commit -m "$(cat <<'EOF'
versoes/actions: remove CRUD de categoria por versão e simplifica duplicar

- Deleta criarCategoria, renomearCategoria, removerCategoria (moveu
  pra app/(app)/categorias/actions.ts, escopo tenant)
- Deleta helper mapCategoriaDbError
- duplicarVersao não copia/remapeia categoria — categoria_id é
  preservado como está, aponta pra mesma categoria global
EOF
)"
```

---

## Task 10: Verificação final e smoke test end-to-end

**Files:** nenhum a modificar (só se algo quebrar).

**Interfaces:**
- Consumes: sistema inteiro
- Produces: confirmação de que build e fluxos funcionam

- [ ] **Step 1: Type check limpo**

```powershell
npx tsc --noEmit
```

Esperado: **zero erros**. Se tiver erro, é regressão de alguma task — corrigir antes de prosseguir.

- [ ] **Step 2: Lint limpo**

```powershell
npx next lint
```

Corrigir warnings dos arquivos criados/modificados nesta feature.

- [ ] **Step 3: Build (opcional em dev, mas roda no Vercel)**

```powershell
npm run build
```

Bug conhecido do Next 14 em Windows pode falhar no `_document` — se falhar por isso, ignorar (Vercel builda ok). Qualquer outro erro precisa correção.

- [ ] **Step 4: Smoke test end-to-end**

```powershell
npm run dev
```

Rodar o fluxo completo em `http://localhost:3000`:

- [ ] Login como admin.
- [ ] Ir em `/cadastros` → 3 cards (Clientes, Fornecedores, Categorias) com contagens.
- [ ] Clicar Categorias → lista vazia (wipe).
- [ ] Criar 3 categorias: "Produção", "Logística", "Equipe".
- [ ] Tentar criar "produção" duplicado → erro amigável.
- [ ] Editar "Equipe" → "Equipe Interna". Salvar.
- [ ] Inativar "Logística". Filtro "Inativas" → aparece. Reativar. Volta pra "Ativas".
- [ ] Ir em `/orcamentos` → escolher um orçamento existente → versão existente.
- [ ] Header da versão: **não** tem mais botão "Nova categoria". Tem "Novo grupo".
- [ ] Editar item → dropdown de categoria mostra "Produção", "Logística", "Equipe Interna" (as 3 ativas).
- [ ] Classificar item com "Produção". Salvar.
- [ ] Voltar em `/categorias` → inativar "Produção".
- [ ] Voltar no item classificado → dropdown ainda mostra "Produção (inativa)" selecionada, mas ela some das opções pra novos itens.
- [ ] Reativar "Produção" pra restaurar estado.
- [ ] Importar uma planilha nova via drawer → preview aparece sem seção de categorias → confirmar → nova versão criada com itens todos sem categoria (categoria_id null).
- [ ] Duplicar uma versão que tem itens classificados → nova versão criada preservando as classificações.

- [ ] **Step 5: Verificar audit_events**

Via MCP (`mcp__supabase__execute_sql`):

```sql
select acao, entidade_tipo, created_at, metadata
from public.audit_events
where acao like 'categoria.%'
order by created_at desc
limit 20;
```

Esperado: aparecem `categoria.criada`, `categoria.editada`, `categoria.inativada`, `categoria.reativada` correspondentes às ações do smoke test.

- [ ] **Step 6: Atualizar HANDOFF.md**

Adicionar na seção "O que já está pronto" (Task 004) uma linha:

```
- **Fase G' — Catálogo global de categorias**: substituiu `versoes_orcamento_categorias` (por versão) por `categorias` (tenant), com CRUD em `/categorias` gerenciado pelo hub `/cadastros`. Todos os membros criam/editam; só admin inativa/reativa. Import não lê mais categoria da planilha; classificação é feita pelo GP no drawer de item. Duplicação de versão preserva categoria_id.
```

Atualizar também "Última atualização" no topo do documento com data atual.

- [ ] **Step 7: Commit da atualização do HANDOFF**

```bash
git add docs/HANDOFF.md
git commit -m "docs: HANDOFF registra migração pra catálogo global de categorias"
```

- [ ] **Step 8: Sugerir deploy**

Perguntar ao usuário se quer:
1. **Push pra `main`** e testar em prod no Vercel.
2. **Rodar mais uma rodada de smoke local antes de pushar**.
3. **Só rodar `git push`** (sem confirmação — não faça sem pedido explícito).

---

## Self-review checklist (executado antes de encerrar o plano)

- **Spec coverage:** todas as 8 decisões-chave da Seção 2 do spec estão implementadas (nova tabela, gestão em nova rota, governança admin, import agnóstico, wipe, soft-delete, gate no server action, FK restrict). ✅
- **Placeholder scan:** nenhum "TBD" ou "TODO" nas tasks. Todo código está escrito. ✅
- **Type consistency:** `Categoria` é definido na Task 2, usado nas Tasks 3, 4, 6. `ActionResult` mesmo shape em todas as actions. `session.activeRole` referenciado consistentemente. ✅
- **Ordem de tasks:** migration primeiro (senão tudo quebra); types+audit foundational; actions consumindo types; UI consumindo actions; cleanups por último; verificação final. ✅
- **Reversibilidade:** cada task ends com commit, então rollback é `git revert` do commit específico. ✅
