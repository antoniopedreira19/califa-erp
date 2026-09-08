# PageHeader unificado + Multi-select de empresas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extrair componente `<PageHeader>` compartilhado que padroniza título/descrição/dropdown de empresa/actions em todas as telas raiz; ampliar single-select (Fase 2A) para multi-select "quais empresas quero ver hoje"; remover o dropdown de empresa da sidebar (que hoje quebra por hover+portal); adicionar 3 índices em `empresa_id` que faltavam.

**Architecture:** SessionContext migra de `activeEmpresa: Empresa | null` para `activeEmpresas: Empresa[]` (cookie `active_empresa_ids` CSV; migração automática do cookie antigo). Novo `<PageHeader>` recebe título+descrição+eyebrow+icon+actions+filters e opcionalmente renderiza o multi-select. `<MultiSelectEmpresas>` usa `<Popover>` + `<Checkbox>` (shadcn) — Checkbox precisa ser adicionado, pois não existe hoje. 7 telas com dropdown migram para PageHeader com `showEmpresaFilter=true`; ~N telas sem dropdown migram só para padronizar cabeçalho. Sidebar reverte ao estado pré-Fase-2A. Migration de índices é aditiva e aplicada primeiro.

**Tech Stack:** Next.js App Router, React, TypeScript, shadcn/ui (`Popover`, `Checkbox` novo, `Button`), Radix UI, Supabase JS, cookies do Next.

**Spec:** [docs/superpowers/specs/2026-09-08-page-header-multi-empresa-design.md](../specs/2026-09-08-page-header-multi-empresa-design.md)

## Global Constraints

- Strings visíveis ao usuário em pt-BR com acento (labels, botões, placeholders). Identificadores em código sem acento.
- Cookie: `active_empresa_ids` (CSV de UUIDs, vazio = todas). HttpOnly, SameSite=Lax, sem expiração explícita. Secure em prod.
- Cookie antigo (`active_empresa_id`) migrado automaticamente na primeira request de cada user; apagado após migração.
- Multi-select regra do trigger: `0` → "Todas selecionadas"; `1` → nome da empresa (`nome_fantasia ?? razao_social`); `N` (< total) → "N selecionadas"; `N === total` → "Todas selecionadas".
- `Desmarcar tudo` = "mostrar tudo" (comportamento equivalente a "todas marcadas"). Sem estado inconsistente.
- CCH está ativa desde 2026-09-08 (id `1703fd52-a36c-4701-816c-a0bcc868351d`, razão "CCH LTDA", CNPJ fake 14 zeros). Aparece no dropdown.
- 3 índices aditivos aplicados **antes** de qualquer código do multi-select subir: `cartoes_credito`, `desembolsos`, `lancamentos_financeiros`.
- Actions vão na **linha DE BAIXO** do PageHeader (junto de filters). Padroniza `/desembolsos` e desce os botões de `/orcamentos`.
- Sub-páginas (drawers, editores, `[projetoId]/*`, versões, aberturas) **NÃO migram** — mantêm header próprio com breadcrumb.
- Padrão existente do repo: `lib/auth/session.ts` usa RPC `get_session_context` + `React.cache`. Server actions em `app/actions/`.

---

### Task 1: Migration dos 3 índices em `empresa_id`

**Files:**
- Create: `supabase/migrations/20260908180000_indices_empresa_id_faltantes.sql`

**Interfaces:**
- Consumes: nada.
- Produces: 3 índices `idx_<tabela>_empresa` — usados em `.in("empresa_id", [...])` das tarefas 8-10.

- [ ] **Step 1: Confirmar próximo prefixo disponível**

Via MCP:
```
mcp__supabase__list_migrations
```
Última migration atual é `20260908170000_regional_id_not_null`. Próximo prefixo livre: `20260908180000`.

- [ ] **Step 2: Escrever o arquivo da migration**

Criar `supabase/migrations/20260908180000_indices_empresa_id_faltantes.sql`:

```sql
-- Motivo: as 3 tabelas abaixo têm coluna empresa_id (FK ou não), mas
-- nunca ganharam índice nela. A partir desta iteração, todos os
-- filtros de listagem passam a fazer .in("empresa_id", [...]) —
-- sem índice, isso vira sequential scan em produção conforme o
-- volume cresce. Aditivo puro; nenhum efeito colateral.
--
-- Ver docs/superpowers/specs/2026-09-08-page-header-multi-empresa-design.md

create index if not exists idx_cartoes_credito_empresa
  on public.cartoes_credito(empresa_id);

create index if not exists idx_desembolsos_empresa
  on public.desembolsos(empresa_id);

create index if not exists idx_lancamentos_financeiros_empresa
  on public.lancamentos_financeiros(empresa_id);
```

- [ ] **Step 3: Aplicar via MCP**

```
mcp__supabase-write__apply_migration
  name: indices_empresa_id_faltantes
  query: <SQL sem os comentários iniciais, ou com — o apply_migration aceita ambos>
```

- [ ] **Step 4: Conferir**

Via MCP `execute_sql`:

```sql
select indexname, tablename
from pg_indexes
where schemaname='public'
  and indexname in (
    'idx_cartoes_credito_empresa',
    'idx_desembolsos_empresa',
    'idx_lancamentos_financeiros_empresa'
  );
```

Expected: 3 linhas.

- [ ] **Step 5: NÃO commitar ainda**

Migration fica em disco untracked; commit vai no fim, junto do resto da task.

Deferrable: como o arquivo fica untracked até a task de commit final, pode adicionar imediatamente em `git add` e comitar sozinho se preferir 1 commit por task. Preferência: 1 commit único no fim; migration + código junto (padrão do repo).

**Nota:** por ser aditivo e servir a todas as tarefas seguintes, este arquivo pode ficar sem commit até a Task 12 (Final).

---

### Task 2: Adicionar componente Checkbox do shadcn

**Files:**
- Create: `components/ui/checkbox.tsx` (via shadcn CLI)
- Modify: `package.json` (dependência `@radix-ui/react-checkbox` adicionada automaticamente)

**Interfaces:**
- Consumes: nada.
- Produces: componente `<Checkbox checked onCheckedChange ... />` — usado pela Task 5.

- [ ] **Step 1: Adicionar o componente via CLI do shadcn**

```bash
npx shadcn@latest add checkbox
```

Se o CLI perguntar sobrescrita/pastas: aceitar defaults do projeto (já configurados). Se falhar por versão do Next, verificar `components.json`.

- [ ] **Step 2: Verificar que o arquivo foi criado**

```bash
ls components/ui/checkbox.tsx
```

Expected: arquivo existe.

- [ ] **Step 3: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add components/ui/checkbox.tsx package.json package-lock.json
git commit -m "chore(ui): adiciona shadcn Checkbox (necessario pro multi-select)"
```

---

### Task 3: SessionContext ganha multi-empresa + migração automática do cookie

**Files:**
- Modify: `lib/types.ts` — interface `SessionContext`: `activeEmpresa` → `activeEmpresas`
- Modify: `lib/auth/session.ts` — `loadSession()` lê cookie novo, faz migração do antigo se preciso
- Modify: `lib/permissoes.test.ts` — mocks precisam ganhar `activeEmpresas` no lugar de `activeEmpresa`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `SessionContext.activeEmpresas: Empresa[]`
  - `SessionContext.empresas: Empresa[]` (idem hoje)
  - Cookie `active_empresa_ids` (CSV)

- [ ] **Step 1: Editar `SessionContext` em `lib/types.ts`**

Localize:
```ts
activeEmpresa: Empresa | null;
empresas: Empresa[];
```

Substitua por:
```ts
/**
 * Empresas "ativas" — subconjunto de `empresas` derivado do cookie
 * `active_empresa_ids`. Array vazio = "todas selecionadas" (sem
 * filtro efetivo em queries).
 */
activeEmpresas: Empresa[];
/** Todas as empresas ativas do tenant. Alimenta o multi-select. */
empresas: Empresa[];
```

- [ ] **Step 2: Editar `loadSession()` em `lib/auth/session.ts`**

Localize o bloco atual que lê `cookies().get("active_empresa_id")`:

```ts
const { cookies } = await import("next/headers");
const cookieEmpresaId = cookies().get("active_empresa_id")?.value;
const activeEmpresa =
  cookieEmpresaId && cookieEmpresaId.length > 0
    ? (empresas.find((e) => e.id === cookieEmpresaId) ?? null)
    : null;
```

Substitua por:

```ts
const { cookies } = await import("next/headers");
const cookieStore = cookies();

// Migração automática do cookie da Fase 2A (active_empresa_id → active_empresa_ids).
// Primeira request de cada user com cookie antigo: converte pra novo formato e apaga o velho.
const cookieAntigo = cookieStore.get("active_empresa_id")?.value;
let cookieNovo = cookieStore.get("active_empresa_ids")?.value;

if (cookieAntigo && cookieAntigo.length > 0 && !cookieNovo) {
  cookieNovo = cookieAntigo;
  cookieStore.set("active_empresa_ids", cookieNovo, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  cookieStore.delete("active_empresa_id");
} else if (cookieAntigo) {
  // cookie novo já existe; só apaga o velho
  cookieStore.delete("active_empresa_id");
}

const idsSelecionados: string[] =
  cookieNovo && cookieNovo.length > 0
    ? cookieNovo.split(",").filter((id) => id.length > 0)
    : [];

// activeEmpresas = as empresas do tenant que ainda existem e estão no cookie.
// Ids que sumiram (empresa desativada, deletada) são ignorados silenciosamente.
const activeEmpresas: Empresa[] = idsSelecionados
  .map((id) => empresas.find((e) => e.id === id))
  .filter((e): e is Empresa => e !== undefined);
```

E no `return`:

```ts
return {
  kind: "ok",
  session: {
    profile,
    memberships,
    activeTenant: active.tenant,
    activeRole: active.role,
    activeEmpresas,
    empresas,
  },
};
```

- [ ] **Step 3: Atualizar mocks em `lib/permissoes.test.ts`**

Localize os 2 objetos `sessionFake` (por volta das linhas 350-370). Ambos têm `activeEmpresa: null, empresas: []`. Trocar por:

```ts
    activeEmpresas: [],
    empresas: [],
```

(Remover a linha `activeEmpresa: null,` e trocar por `activeEmpresas: [],`.)

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: erros nos consumidores da Fase 2A (fluxo-caixa, contas-a-pagar, etc). Isso é esperado — serão corrigidos nas Tasks 8-10. **Se tsc reclamar de arquivos fora dos listados no spec Camada 6, PARE e reporte NEEDS_CONTEXT.**

Consumidores esperados a reclamar (aceitável — próximas tasks resolvem):
- `app/(app)/financeiro/fluxo-caixa/page.tsx`
- `app/(app)/financeiro/contas-a-pagar/page.tsx`
- `app/(app)/financeiro/desembolsos/page.tsx`
- `app/(app)/orcamentos/page.tsx`
- `app/(app)/relatorios/rentabilidade/page.tsx`
- `components/sidebar.tsx` (a Task 7 reverte)

- [ ] **Step 5: NÃO commitar ainda**

O código com tsc-error precisa das próximas tasks. Commit único agrupado no fim (padrão SDD). Se preferir 1 commit por task, o SDD skill orienta.

**Alternativa mais segura:** commitar depois da Task 4 (server action nova) — aí SessionContext + action chegam juntas, e as próximas tasks já corrigem consumers.

---

### Task 4: Server action `setActiveEmpresas`

**Files:**
- Create: `app/actions/set-active-empresas.ts`
- Delete: `app/actions/set-active-empresa.ts`

**Interfaces:**
- Consumes: `SessionContext.empresas` (Task 3).
- Produces:
  - `setActiveEmpresas(ids: string[]): Promise<void>` — grava/limpa cookie `active_empresa_ids`.

- [ ] **Step 1: Criar `app/actions/set-active-empresas.ts`**

```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";

/**
 * Grava/limpa o cookie `active_empresa_ids`. Recebe:
 *   - [] → apaga o cookie (equivale a "todas selecionadas")
 *   - [id1, id2, ...] → grava CSV; todos os ids precisam ser de empresas
 *     do tenant do usuário.
 *
 * Depois de gravar, revalida `/` para forçar rerun de server components.
 */
export async function setActiveEmpresas(ids: string[]): Promise<void> {
  const session = await requireSession();

  if (ids.length > 0) {
    const validos = new Set(session.empresas.map((e) => e.id));
    for (const id of ids) {
      if (!validos.has(id)) {
        throw new Error(`Empresa ${id} fora do escopo do tenant.`);
      }
    }
  }

  const store = cookies();
  if (ids.length === 0) {
    store.delete("active_empresa_ids");
  } else {
    store.set("active_empresa_ids", ids.join(","), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  revalidatePath("/");
}
```

- [ ] **Step 2: Deletar `app/actions/set-active-empresa.ts`**

```bash
rm app/actions/set-active-empresa.ts
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: erro em `components/sidebar.tsx` porque ainda importa `setActiveEmpresa`. Aceitável — Task 7 corrige.

- [ ] **Step 4: Commit (Tasks 3+4 juntas)**

```bash
git add lib/types.ts lib/auth/session.ts lib/permissoes.test.ts app/actions/set-active-empresas.ts
git rm app/actions/set-active-empresa.ts
git commit -m "feat(sessao): SessionContext ganha activeEmpresas (multi) + server action setActiveEmpresas

- activeEmpresa: Empresa | null → activeEmpresas: Empresa[]
- Cookie active_empresa_id → active_empresa_ids (CSV), com migracao automatica
- setActiveEmpresa (single) removida; setActiveEmpresas (array) substitui

Consumers das telas Fase 2A quebrados temporariamente ate as proximas tasks migrarem."
```

---

### Task 5: Componente `<MultiSelectEmpresas>`

**Files:**
- Create: `components/ui/multi-select-empresas.tsx`

**Interfaces:**
- Consumes: `Checkbox` (Task 2), `Popover` + `Button` (existentes), `Empresa` (`lib/types.ts`).
- Produces:
  ```ts
  type MultiSelectEmpresasProps = {
    empresas: Empresa[];
    selecionadas: string[];
    onSelectionChange: (ids: string[]) => void;
  };
  ```
  Componente `<MultiSelectEmpresas />` — usado pela Task 6 (`<PageHeader>`).

- [ ] **Step 1: Criar `components/ui/multi-select-empresas.tsx`**

```tsx
"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { Empresa } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type MultiSelectEmpresasProps = {
  empresas: Empresa[];
  selecionadas: string[];
  onSelectionChange: (ids: string[]) => void;
};

/**
 * Multi-select de empresas. Popover com checkbox por linha.
 * Regra do trigger:
 *   - 0 selecionadas OU todas selecionadas → "Todas selecionadas"
 *   - 1 selecionada → nome_fantasia ?? razao_social
 *   - N (< total) selecionadas → "N selecionadas"
 *
 * Marcar todas / Limpar: atalhos no topo do dropdown.
 */
export function MultiSelectEmpresas(props: MultiSelectEmpresasProps) {
  const { empresas, selecionadas, onSelectionChange } = props;

  const total = empresas.length;
  const selCount = selecionadas.length;
  const todasMarcadas = selCount === 0 || selCount === total;

  const labelTrigger = React.useMemo(() => {
    if (todasMarcadas) return "Todas as empresas";
    if (selCount === 1) {
      const e = empresas.find((x) => x.id === selecionadas[0]);
      return e ? (e.nome_fantasia ?? e.razao_social) : "1 selecionada";
    }
    return `${selCount} selecionadas`;
  }, [empresas, selecionadas, selCount, todasMarcadas]);

  const marcarTodas = () => onSelectionChange([]);
  const limpar = () => onSelectionChange([]);
  // marcar todas e limpar tem o mesmo efeito prático (0 = todas).
  // Deixamos os dois botões visualmente, mas ambos chamam a mesma limpeza.
  // Se o produto quiser diferenciar semanticamente no futuro (ex: 0 marcadas
  // = mostra nada), basta trocar o comportamento aqui.

  const toggleEmpresa = (id: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selecionadas, id]);
    } else {
      onSelectionChange(selecionadas.filter((s) => s !== id));
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="justify-between min-w-[180px] font-normal"
        >
          <span className="truncate">{labelTrigger}</span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <Button variant="ghost" size="sm" onClick={marcarTodas} className="flex-1 text-xs">
            Marcar todas
          </Button>
          <Button variant="ghost" size="sm" onClick={limpar} className="flex-1 text-xs">
            Limpar
          </Button>
        </div>
        <div className="pt-2 space-y-1 max-h-72 overflow-y-auto">
          {empresas.map((e) => {
            const checked = selecionadas.includes(e.id);
            return (
              <label
                key={e.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(state) => toggleEmpresa(e.id, state === true)}
                />
                <span className="text-sm truncate">
                  {e.nome_fantasia ?? e.razao_social}
                </span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Ambos precisam passar limpo (o componente é isolado).

- [ ] **Step 3: Commit**

```bash
git add components/ui/multi-select-empresas.tsx
git commit -m "feat(ui): MultiSelectEmpresas com Popover + Checkbox"
```

---

### Task 6: Componente `<PageHeader>`

**Files:**
- Create: `components/ui/page-header.tsx`

**Interfaces:**
- Consumes: `MultiSelectEmpresas` (Task 5), `SessionContext.empresas`/`activeEmpresas` (Task 3), `setActiveEmpresas` (Task 4).
- Produces:
  ```ts
  type PageHeaderProps = {
    title: string;
    description?: string;
    icon?: LucideIcon;
    eyebrow?: string;
    showEmpresaFilter?: boolean;
    empresas?: Empresa[];
    activeEmpresas?: Empresa[];
    actions?: React.ReactNode;
    filters?: React.ReactNode;
  };
  ```
  Componente `<PageHeader />` — usado pelas Tasks 8-10.

- [ ] **Step 1: Criar `components/ui/page-header.tsx`**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import type { Empresa } from "@/lib/types";
import { MultiSelectEmpresas } from "@/components/ui/multi-select-empresas";
import { setActiveEmpresas } from "@/app/actions/set-active-empresas";

export type PageHeaderProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  eyebrow?: string;
  showEmpresaFilter?: boolean;
  /** Obrigatório se showEmpresaFilter=true. */
  empresas?: Empresa[];
  /** Obrigatório se showEmpresaFilter=true. */
  activeEmpresas?: Empresa[];
  actions?: React.ReactNode;
  filters?: React.ReactNode;
};

export function PageHeader(props: PageHeaderProps) {
  const {
    title,
    description,
    icon: Icon,
    eyebrow,
    showEmpresaFilter = false,
    empresas,
    activeEmpresas,
    actions,
    filters,
  } = props;

  const router = useRouter();

  const temLinhaDeBaixo = filters || actions;

  return (
    <div className="space-y-4 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-wider text-california-red mb-1">
              {eyebrow}
            </p>
          )}
          <div className="flex items-center gap-3">
            {Icon && (
              <div className="rounded-lg bg-california-red/10 p-2 shrink-0">
                <Icon className="h-5 w-5 text-california-red" />
              </div>
            )}
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          </div>
          {description && (
            <p className="text-sm text-muted-foreground max-w-2xl text-pretty mt-2">
              {description}
            </p>
          )}
        </div>

        {showEmpresaFilter && empresas && activeEmpresas && (
          <div className="shrink-0 pt-1">
            <MultiSelectEmpresas
              empresas={empresas}
              selecionadas={activeEmpresas.map((e) => e.id)}
              onSelectionChange={async (ids) => {
                await setActiveEmpresas(ids);
                router.refresh();
              }}
            />
          </div>
        )}
      </div>

      {temLinhaDeBaixo && (
        <>
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
              {filters}
            </div>
            {actions && (
              <div className="flex items-center gap-2 shrink-0">
                {actions}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: sem erros. Componente é isolado.

- [ ] **Step 3: Commit**

```bash
git add components/ui/page-header.tsx
git commit -m "feat(ui): PageHeader unificado (titulo/desc/eyebrow/icon/empresa/actions/filters)"
```

---

### Task 7: Reverter sidebar ao estado pré-Fase-2A

**Files:**
- Modify: `components/sidebar.tsx` — remover imports (Select, useRouter, setActiveEmpresa, Empresa), props extras, blocos de renderização de empresa
- Modify: `app/(app)/layout.tsx` — voltar a passar só `role` e `nome`

**Interfaces:**
- Consumes: nada novo. Volta ao estado antes da Fase 2A.
- Produces: sidebar sem dropdown de empresa.

- [ ] **Step 1: Editar `components/sidebar.tsx`**

Remover, no topo:

```tsx
import { useRouter } from "next/navigation";
import type { Empresa } from "@/lib/types";
import { setActiveEmpresa } from "@/app/actions/set-active-empresa";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

Ajustar assinatura:

De:
```tsx
export function Sidebar({
  role,
  nome,
  activeEmpresa,
  empresas,
}: {
  role: AppRole;
  nome: string;
  activeEmpresa: Empresa | null;
  empresas: Empresa[];
}) {
```

Para:
```tsx
export function Sidebar({
  role,
  nome,
}: {
  role: AppRole;
  nome: string;
}) {
```

Remover, dentro do corpo, a linha `const router = useRouter();`.

Remover **os dois blocos** de "Empresa ativa" (o de 1 empresa e o de 2+). Está entre o comentário `{/* Empresa ativa */}` e `{/* User footer */}`.

Depois de remover, o comentário `{/* User footer */}` fica colado no `</nav>`.

- [ ] **Step 2: Editar `app/(app)/layout.tsx`**

Localize:
```tsx
<Sidebar
  role={session.activeRole}
  nome={session.profile.nome}
  activeEmpresa={session.activeEmpresa}
  empresas={session.empresas}
/>
```

Substitua por:
```tsx
<Sidebar
  role={session.activeRole}
  nome={session.profile.nome}
/>
```

- [ ] **Step 3: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: erros seguem apenas nos consumidores da Fase 2A (fluxo-caixa, contas-a-pagar, etc) que ainda leem `session.activeEmpresa`. Serão corrigidos nas Tasks 8-10.

- [ ] **Step 4: Commit**

```bash
git add components/sidebar.tsx "app/(app)/layout.tsx"
git commit -m "revert(sidebar): remove dropdown de empresa (movido pro PageHeader)"
```

---

### Task 8: Migrar `/orcamentos` + `/jobs` para PageHeader

**Files:**
- Modify: `app/(app)/orcamentos/page.tsx`
- Modify: `app/(app)/jobs/page.tsx`

**Interfaces:**
- Consumes: `PageHeader` (Task 6), `SessionContext.activeEmpresas`/`empresas` (Task 3).
- Produces: nada.

- [ ] **Step 1: Ler `orcamentos/page.tsx` e `jobs/page.tsx` inteiros**

Antes de mexer, entender:
- Como o header hoje é construído.
- Onde os filtros e botões (Novo projeto, Categorias, etc) vivem.
- Se são server components; onde a filtragem por empresa acontece.
- Como consomem `session.activeEmpresa` (que agora precisa virar `activeEmpresas`).

- [ ] **Step 2: `/orcamentos/page.tsx` — substituir header manual pelo `<PageHeader>`**

Trocar o `<div><h1>Projetos & Orçamentos</h1>...</div>` (ou como estiver hoje) por:

```tsx
<PageHeader
  eyebrow="COMERCIAL"
  title="Projetos & Orçamentos"
  description="Cada projeto agrupa os orçamentos de uma iniciativa do cliente. Clique num projeto para ver seus orçamentos e versões."
  icon={FileText}
  showEmpresaFilter
  empresas={session.empresas}
  activeEmpresas={session.activeEmpresas}
  filters={<>
    {/* Tabs Meus/Todos, busca, filtros existentes */}
  </>}
  actions={<>
    {/* Botão Novo projeto + botão Categorias */}
  </>}
/>
```

Imports adicionados no topo do arquivo:
```tsx
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
```

- [ ] **Step 3: Substituir filtro por empresa**

Onde antes:
```ts
const empresaFiltroId: string | null =
  typeof searchParams.empresa === "string" && searchParams.empresa.length > 0
    ? searchParams.empresa
    : (session.activeEmpresa?.id ?? null);
```

Trocar por:
```ts
const empresaFiltroIds: string[] =
  typeof searchParams.empresa === "string" && searchParams.empresa.length > 0
    ? searchParams.empresa.split(",").filter((id) => id.length > 0)
    : session.activeEmpresas.map((e) => e.id);
```

E nas queries:
```ts
// antes:
if (empresaFiltroId) q = q.eq("empresa_id", empresaFiltroId);
// depois:
if (empresaFiltroIds.length > 0) q = q.in("empresa_id", empresaFiltroIds);
```

Remover o chip visual antigo ("Empresa: X · voltar para ativa") se ele existia — o PageHeader já mostra as empresas ativas no dropdown. Se você quiser preservar o chip de "override URL diferente da ativa", deixe-o abaixo do PageHeader; caso contrário, remova.

**Ruling:** remover o chip. O dropdown do PageHeader é a fonte-verdade visual. Se URL tiver `?empresa=` diferente do cookie, o dropdown mostra a URL (não o cookie) — porque foi passado `activeEmpresas` calculado a partir do filtro efetivo. Simplifica.

**Para isso funcionar**, ajustar o `activeEmpresas` que passa pro PageHeader:

```tsx
// Empresas efetivamente aplicadas na query da tela (respeitando URL override)
const activeEmpresasEfetivas =
  empresaFiltroIds.length > 0
    ? session.empresas.filter((e) => empresaFiltroIds.includes(e.id))
    : [];

<PageHeader
  ...
  activeEmpresas={activeEmpresasEfetivas}
  ...
/>
```

- [ ] **Step 4: `/jobs/page.tsx` — mesma abordagem**

Ler primeiro. Aplicar `PageHeader` com `showEmpresaFilter`, filtrar `.in("empresa_id", empresaFiltroIds)`, remover chip antigo.

Nota: `/jobs` **não filtrava por empresa na Fase 2A**. Verificar se hoje já tem `empresa_id` na query da view/tabela consumida. Se não, adicionar. Se a tela consome uma view (tipo `vw_jobs_lista` ou similar), garantir que a view carrega `empresa_id`.

Se a query base for `.from("jobs")`, `jobs.empresa_id NOT NULL` já existe (Fase 1), só falta adicionar o filtro.

- [ ] **Step 5: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Se ainda há erros de `session.activeEmpresa` em outros arquivos, **aceitável**: as Tasks 9-10 corrigem.

- [ ] **Step 6: Testar visualmente**

```bash
npm run dev
```

Abrir `/orcamentos` e `/jobs`:
- PageHeader aparece com eyebrow + título + descrição + dropdown à direita.
- Actions (Novo/Categorias) na linha de baixo.
- Marcar "Agência" apenas — lista filtra.
- Marcar "Todas" (Limpar) — lista mostra tudo.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/orcamentos/page.tsx" "app/(app)/jobs/page.tsx"
git commit -m "feat(orcamentos, jobs): migra pro PageHeader com multi-empresa"
```

---

### Task 9: Migrar as 3 telas financeiras + 2 de relatórios para PageHeader

**Files:**
- Modify: `app/(app)/financeiro/fluxo-caixa/page.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx`
- Modify: `app/(app)/financeiro/desembolsos/page.tsx`
- Modify: `app/(app)/relatorios/rentabilidade/page.tsx`
- Modify: `app/(app)/relatorios/faturamento/page.tsx`

**Interfaces:**
- Consumes: `PageHeader` (Task 6), `SessionContext.activeEmpresas`/`empresas` (Task 3).
- Produces: nada.

**Reviewer note:** essas 5 telas seguem o mesmo padrão da Task 8. Small same-shape work — 1 dispatch de subagent com brief consolidado.

- [ ] **Step 1: Para cada tela, aplicar o padrão da Task 8**

Padrão único:
1. Import `PageHeader` + ícone Lucide adequado (`Wallet`, `Landmark`, `TrendingUp`, `BarChart3`, etc).
2. Substituir header manual pelo `<PageHeader>` com `showEmpresaFilter=true`.
3. Trocar `empresaFiltroId: string | null` por `empresaFiltroIds: string[]`.
4. Trocar `.eq("empresa_id", ...)` por `.in("empresa_id", empresaFiltroIds)` **condicional** (só filtra se `length > 0`).
5. Remover chip visual antigo. Calcular `activeEmpresasEfetivas` como na Task 8.
6. `filters` do PageHeader recebe os filtros de status/data/busca existentes (tabs/pills que hoje ficam abaixo do título).
7. `actions` recebe os botões primários (Novo Desembolso, etc).

**Sugestão de eyebrow/ícone por tela:**

| Tela | eyebrow | ícone |
|---|---|---|
| fluxo-caixa | "FINANCEIRO" | `TrendingUp` |
| contas-a-pagar | "FINANCEIRO" | `Wallet` |
| desembolsos | "FINANCEIRO" | `Wallet` |
| rentabilidade | "RELATÓRIOS" | `BarChart3` |
| faturamento | "RELATÓRIOS" | `Receipt` |

- [ ] **Step 2: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Ambos precisam passar limpo. Se ainda existe erro de `activeEmpresa`, é a Task 10 (telas sem dropdown) ou uma tela não listada que ainda usa. Reportar via NEEDS_CONTEXT se aparecer.

- [ ] **Step 3: Testar visualmente as 5 telas**

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/financeiro/fluxo-caixa/page.tsx" "app/(app)/financeiro/contas-a-pagar/page.tsx" "app/(app)/financeiro/desembolsos/page.tsx" "app/(app)/relatorios/rentabilidade/page.tsx" "app/(app)/relatorios/faturamento/page.tsx"
git commit -m "feat(financeiro, relatorios): migra 5 telas pro PageHeader com multi-empresa"
```

---

### Task 10: Migrar telas SEM dropdown + fix bug `null` em `/desembolsos`

**Files:**
- Modify: `app/(app)/home/page.tsx`
- Modify: `app/(app)/financeiro/page.tsx` (hub)
- Modify: `app/(app)/relatorios/page.tsx` (hub)
- Modify: `app/(app)/cadastros/page.tsx` e sub-raízes (se existirem)
- Modify: `app/(app)/admin/page.tsx` e sub-raízes (se existirem)
- Modify: `app/(app)/configuracoes/page.tsx`
- Modify: `app/(app)/clientes/page.tsx` e `app/(app)/fornecedores/page.tsx` (raízes)
- Modify: `app/(app)/financeiro/desembolsos/desembolsos-list.tsx` (fix bug `null`)

**Interfaces:**
- Consumes: `PageHeader` (Task 6).
- Produces: nada.

- [ ] **Step 1: Descobrir a lista real de telas SEM dropdown**

```bash
find "app/(app)" -name page.tsx -not -path "*/\[*" | sort
```

Para cada resultado que NÃO está na lista das Tasks 8-9, verificar se hoje tem título/descrição customizado. Se tem, migrar pra PageHeader **sem** `showEmpresaFilter`.

- [ ] **Step 2: Para cada tela sem dropdown, aplicar PageHeader**

Padrão simples (sem dropdown):

```tsx
<PageHeader
  eyebrow="X"                // opcional
  title="Título da Página"
  description="..."         // opcional
  icon={IconeLucide}         // opcional
  filters={<>...</>}         // opcional
  actions={<>...</>}         // opcional
/>
```

- [ ] **Step 3: Fix bug `null` em `/desembolsos`**

O bug reportado é que o placeholder do input de busca aparece como "null". Grep e leitura do código atual (`app/(app)/financeiro/desembolsos/desembolsos-list.tsx:145-153`) mostram `placeholder="Buscar por código, descrição ou fornecedor..."` hardcoded — não deveria virar "null".

Hipóteses:
- **A) `value={busca}` recebe `null` em algum momento**. React renderiza `value={null}` como string `"null"` no atributo. Fallback:
  ```tsx
  value={busca ?? ""}
  ```
- **B) O input está sendo renderizado por outro caminho** (server component com valor de searchParams que é `null`).

Aplicar o fallback `value={busca ?? ""}` no input. Se o problema persistir após deploy, investigar com o operador.

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Ambos precisam passar limpo. Se ainda houver erros de `activeEmpresa`, reportar como concern — deve ser tela não listada.

- [ ] **Step 5: Testar visualmente algumas telas**

- Home
- `/financeiro` (hub)
- `/desembolsos` → busca não mostra mais "null"

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/home/page.tsx" "app/(app)/financeiro/page.tsx" "app/(app)/relatorios/page.tsx" "app/(app)/cadastros" "app/(app)/admin" "app/(app)/configuracoes/page.tsx" "app/(app)/clientes/page.tsx" "app/(app)/fornecedores/page.tsx" "app/(app)/financeiro/desembolsos/desembolsos-list.tsx"
git commit -m "feat: telas restantes migram pro PageHeader (sem dropdown) + fix null no busca /desembolsos"
```

---

### Task 11: Commit da migration de índices (Task 1) + verificação final

**Files:**
- Adiciona: `supabase/migrations/20260908180000_indices_empresa_id_faltantes.sql` (criado na Task 1, ainda untracked)

**Interfaces:**
- Consumes: Task 1 (arquivo em disco).
- Produces: história completa do banco (migration commitada).

- [ ] **Step 1: Confirmar via MCP que os 3 índices ainda existem**

```sql
select indexname from pg_indexes
where schemaname='public'
  and indexname in (
    'idx_cartoes_credito_empresa',
    'idx_desembolsos_empresa',
    'idx_lancamentos_financeiros_empresa'
  );
```

Expected: 3 linhas.

- [ ] **Step 2: Commit da migration + spec + plan**

```bash
git add supabase/migrations/20260908180000_indices_empresa_id_faltantes.sql docs/superpowers/specs/2026-09-08-page-header-multi-empresa-design.md docs/superpowers/plans/2026-09-08-page-header-multi-empresa.md
git commit -m "chore(db): commita migration de indices em empresa_id + spec/plan da fase page-header"
```

- [ ] **Step 3: Rodar `git log --oneline main..HEAD`**

Confirmar que os commits fazem sentido em ordem:

Esperado (~7-9 commits):
1. `chore(ui): adiciona shadcn Checkbox`
2. `feat(sessao): SessionContext ganha activeEmpresas + server action`
3. `feat(ui): MultiSelectEmpresas`
4. `feat(ui): PageHeader`
5. `revert(sidebar): remove dropdown de empresa`
6. `feat(orcamentos, jobs): migra pro PageHeader`
7. `feat(financeiro, relatorios): migra 5 telas pro PageHeader`
8. `feat: telas restantes migram pro PageHeader + fix null`
9. `chore(db): commita migration de indices + docs`

---

## Nota sobre execução

- Tasks 1-2 são setup independente (DB + shadcn).
- Tasks 3-4 são fundação lógica (session + action).
- Tasks 5-6 são componentes UI.
- Task 7 destrói o dropdown antigo da sidebar.
- Tasks 8-10 aplicam nas telas.
- Task 11 fecha commit da migration + docs.

Fase 2B (`empresa_members` + RLS) fica pra plan separado depois deste ficar estável.
