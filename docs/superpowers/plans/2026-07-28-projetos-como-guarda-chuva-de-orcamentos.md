# Projetos como guarda-chuva de orçamentos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir a entidade `projetos` entre `clientes` e `orcamentos`. Um projeto agrupa múltiplos orçamentos da mesma iniciativa/campanha do cliente, com seu próprio código (ex.: `AMB-0003/26`). Cliente, responsável e campanha sobem pro projeto. Sidebar continua com "Orçamentos" como única entrada; drill down passa a ser Projeto → Orçamento → Versão.

**Architecture:** Big-bang em um único PR (Abordagem 1 do brainstorming — dados em prod são só teste). Nova tabela `projetos` com RLS/GRANT; `clientes` ganha `codigo_curto` (2-6 letras uppercase, único por tenant); `orcamentos` ganha `projeto_id` NOT NULL e perde `cliente_id`, `responsavel_id`, `campanha` (herdados via FK ao projeto). Backfill cria 1 projeto "teste" agrupando os 2 orçamentos existentes. Rotas reestruturam-se pra `/orcamentos/[projetoId]/[orcId]/[versaoId]`.

**Tech Stack:** Next.js 14 App Router, TypeScript 5, Supabase Postgres (RLS + GRANT), Supabase-js, React Hook Form + Zod, Radix UI, Tailwind CSS. Sem test framework — verificação via `npm run typecheck`, `npm run lint`, `npm run dev` (manual UI), e SQL smoke queries via MCP Supabase.

## Global Constraints

- **Performance é feature** (CLAUDE.md § "Performance é feature"): `<Link>` em lista de 5+ itens navegáveis → `prefetch={false}`; agregações em coluna → query separada, nunca embed pesado; queries independentes em server component → `Promise.all`; migration nova → GRANT explícito pra `authenticated` + índices em FK importantes; policies RLS usam `(select auth.uid())`, não `auth.uid()`; `force-dynamic` permanece em pages autenticadas.
- **RLS ≠ GRANT** (CLAUDE.md): toda tabela nova precisa terminar com `grant select, insert, update ... to authenticated`.
- **Toda tabela operacional tem `tenant_id`** com FK pra `tenants` e RLS via `is_tenant_member(tenant_id)`.
- **Sem policy DELETE** (arquivar = `status='arquivado'`).
- **`SUPABASE_SERVICE_ROLE_KEY` só em server actions/route handlers.**
- **Toda ação sensível grava em `audit_events`** via `logAuditEvent`.
- **Identidade visual California**: vermelho `#E74B56` (classe `california-red`), fonte Inter (body), Fraunces (display via `font-display`), botões arredondados, cards com `shadow-soft`.
- **Migration numbering**: próximo número disponível é `20260728000002` (última aplicada: `20260728000001_task004_categoria_e_planejado`).
- **Nada de emojis em código.**
- **Nomes de validation files**: plurais (`orcamentos.ts`, `clientes.ts`) — o arquivo novo é `projetos.ts` (plural, seguindo padrão).
- **Nomes de arquivos de action**: `actions.ts` colocalizado na rota.

---

## File Structure — mapa de mudanças

### Cria:
| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260728000002_task007_projetos.sql` | Enum `projeto_status`, tabela `projetos`, coluna `clientes.codigo_curto`, coluna `orcamentos.projeto_id`, RLS/GRANT, backfill do projeto "teste" |
| `lib/codigos/projetos.ts` | Helper `gerarCodigoProjeto(supabase, tenantId, clienteId, dataInicio)` → string |
| `lib/codigos/orcamentos.ts` | Helper `gerarCodigoOrcamento(supabase, projetoId)` → string |
| `lib/validations/projetos.ts` | Schema Zod `projetoSchema` |
| `app/(app)/orcamentos/projeto-form.tsx` | Componente client `<ProjetoForm>` (criar/editar) |
| `app/(app)/orcamentos/projeto-editor-drawer.tsx` | Drawer lateral pra edição |
| `app/(app)/orcamentos/projetos-list.tsx` | Tabela client-side com filtros (cliente/responsável/status) |
| `app/(app)/orcamentos/[projetoId]/page.tsx` | Detalhe do projeto (metadata + card de orçamentos) |
| `app/(app)/orcamentos/[projetoId]/orcamento-form.tsx` | Form de orçamento sem cliente/responsavel/campanha |
| `app/(app)/orcamentos/[projetoId]/orcamento-editor-drawer.tsx` | Drawer de edição de orçamento |
| `app/(app)/orcamentos/[projetoId]/orcamentos-list.tsx` | Tabela de orçamentos dentro do projeto |
| `app/(app)/orcamentos/[projetoId]/actions.ts` | Server actions CRUD de orçamento (escopadas ao projeto) |
| `app/(app)/orcamentos/[projetoId]/novo/page.tsx` | Página "Criar orçamento" dentro do projeto |

### Move (via `git mv`):
| De | Para |
|---|---|
| `app/(app)/orcamentos/[id]/page.tsx` | `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx` |
| `app/(app)/orcamentos/[id]/versoes/**` | `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/**` (mantém tudo dentro) |

### Modifica:
| Arquivo | O que muda |
|---|---|
| `lib/types.ts` | Add `ProjetoStatus`, `Projeto`, `projetoStatusLabel`; add `codigo_curto: string` em `Cliente`; add `projeto_id: string` e remove `cliente_id`, `responsavel_id`, `campanha` em `Orcamento` |
| `lib/validations/clientes.ts` | Add campo `codigo_curto` |
| `lib/validations/orcamentos.ts` | Remove `cliente_id`, `responsavel_id`, `campanha` |
| `lib/auth/audit.ts` | Add `projeto.criado`, `projeto.atualizado`, `projeto.arquivado`, `projeto.reativado` |
| `app/(app)/orcamentos/actions.ts` | Substitui conteúdo — deixa de ser CRUD de orçamento, vira CRUD de projeto (`criarProjeto`, `atualizarProjeto`, `arquivarProjeto`, `reativarProjeto`) |
| `app/(app)/orcamentos/page.tsx` | Reescreve pra listar projetos em vez de orçamentos |
| `app/(app)/orcamentos/novo/page.tsx` | Reescreve pra criar projeto em vez de orçamento |
| `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx` (movido) | Ajusta breadcrumb (`← Projeto`), lê cliente/responsavel/campanha via embed do projeto, muda params.id → params.orcId |
| `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/**` (movidos) | Ajusta paths de import e revalidatePath pra incluir projetoId |
| `app/(app)/cadastros/clientes/cliente-form.tsx` | Add input `codigo_curto` com auto-sugestão baseada em `nome_fantasia` |
| `app/(app)/cadastros/clientes/clientes-list.tsx` | Add coluna "Código" |

### Deleta (git rm):
- `app/(app)/orcamentos/orcamento-form.tsx` (substituído pela versão dentro de `[projetoId]/`)
- `app/(app)/orcamentos/orcamento-editor-drawer.tsx` (idem)
- `app/(app)/orcamentos/orcamentos-list.tsx` (idem)

---

## Tarefas

### Task 1: Criar arquivo de migration

**Files:**
- Create: `supabase/migrations/20260728000002_task007_projetos.sql`

**Interfaces:**
- Consumes: helpers já existentes no banco (`is_tenant_member`, `set_updated_at`), tabelas `tenants`, `clientes`, `profiles`, `orcamentos`
- Produces: tabela `public.projetos`, enum `public.projeto_status`, coluna `public.clientes.codigo_curto`, coluna `public.orcamentos.projeto_id`

- [ ] **Step 1: Criar o arquivo de migration com o SQL completo**

Conteúdo do arquivo `supabase/migrations/20260728000002_task007_projetos.sql`:

```sql
-- =====================================================================
-- Task 007 — Projetos (guarda-chuva de orçamentos)
--
-- Introduz a entidade `projetos` entre `clientes` e `orcamentos`.
-- Cliente, responsável e campanha sobem do orçamento pro projeto.
-- Orçamento ganha FK NOT NULL pra projeto.
-- Cliente ganha `codigo_curto` (2-6 letras uppercase, único por tenant),
-- usado como prefixo do código do projeto.
--
-- Regras invioláveis respeitadas:
--   - `tenant_id` obrigatório com RLS via is_tenant_member.
--   - Sem policy DELETE (arquivar = status='arquivado').
--   - GRANT explícito no fim.
--   - Policies usam (select auth.uid()) pra evitar re-avaliação por linha.
--
-- Backfill: cria 1 projeto "teste" agrupando todos os orçamentos existentes
-- do tenant. Se não houver orçamentos (banco novo), skip.
-- =====================================================================

-- 1) clientes.codigo_curto ----------------------------------------------
alter table public.clientes add column if not exists codigo_curto text;

-- Backfill: derivar de nome_fantasia (primeiras 6 letras alfabéticas UPPER)
update public.clientes
   set codigo_curto = upper(regexp_replace(substring(nome_fantasia, 1, 6), '[^A-Za-z]', '', 'g'))
 where codigo_curto is null;

-- Fallback pra registros que ficaram vazios
update public.clientes set codigo_curto = 'CLI' where codigo_curto is null or codigo_curto = '';

alter table public.clientes
  alter column codigo_curto set not null;

alter table public.clientes
  drop constraint if exists chk_clientes_codigo_curto_formato;

alter table public.clientes
  add constraint chk_clientes_codigo_curto_formato check (codigo_curto ~ '^[A-Z]{2,6}$');

create unique index if not exists uniq_clientes_codigo_curto_por_tenant
  on public.clientes(tenant_id, codigo_curto);

-- 2) projeto_status enum ------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'projeto_status') then
    create type public.projeto_status as enum ('ativo', 'arquivado');
  end if;
end$$;

-- 3) Tabela projetos ----------------------------------------------------
create table if not exists public.projetos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  codigo                text not null,
  nome                  text not null,
  campanha              text,
  cliente_id            uuid not null references public.clientes(id) on delete restrict,
  responsavel_id        uuid not null references public.profiles(id) on delete restrict,
  status                public.projeto_status not null default 'ativo',
  data_inicio_prevista  date not null,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists uniq_projetos_codigo_por_tenant on public.projetos(tenant_id, codigo);
create index if not exists idx_projetos_tenant       on public.projetos(tenant_id);
create index if not exists idx_projetos_cliente      on public.projetos(cliente_id);
create index if not exists idx_projetos_responsavel  on public.projetos(responsavel_id);
create index if not exists idx_projetos_status       on public.projetos(status);
create index if not exists idx_projetos_created_at   on public.projetos(created_at desc);

drop trigger if exists trg_projetos_updated_at on public.projetos;
create trigger trg_projetos_updated_at
  before update on public.projetos
  for each row execute function public.set_updated_at();

alter table public.projetos enable row level security;

drop policy if exists projetos_select on public.projetos;
create policy projetos_select on public.projetos
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists projetos_insert on public.projetos;
create policy projetos_insert on public.projetos
  for insert to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and (created_by is null or created_by = (select auth.uid()))
  );

drop policy if exists projetos_update on public.projetos;
create policy projetos_update on public.projetos
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Sem DELETE (arquivar = status='arquivado')

grant select, insert, update on public.projetos to authenticated;

-- 4) orcamentos.projeto_id (nullable → backfill → NOT NULL) -------------
alter table public.orcamentos
  add column if not exists projeto_id uuid references public.projetos(id) on delete restrict;

-- 5) BACKFILL: cria projeto "teste" e vincula orçamentos existentes -----
do $$
declare
  v_projeto_id uuid;
  v_tenant_id uuid;
  v_cliente_id uuid;
  v_responsavel_id uuid;
  v_codigo_cliente text;
  v_ano text;
begin
  -- Pega dados de um orçamento existente (o mais antigo do tenant)
  -- Se não houver nenhum, sai do bloco (banco novo — nada a fazer)
  select o.tenant_id, o.cliente_id, o.responsavel_id, c.codigo_curto, to_char(current_date, 'YY')
    into v_tenant_id, v_cliente_id, v_responsavel_id, v_codigo_cliente, v_ano
    from public.orcamentos o
    join public.clientes c on c.id = o.cliente_id
   where o.projeto_id is null
   order by o.created_at asc
   limit 1;

  if v_tenant_id is null then
    return;
  end if;

  insert into public.projetos (
    tenant_id, codigo, nome, campanha, cliente_id, responsavel_id, status, data_inicio_prevista
  ) values (
    v_tenant_id,
    v_codigo_cliente || '-0001/' || v_ano,
    'teste',
    'teste',
    v_cliente_id,
    v_responsavel_id,
    'ativo',
    current_date
  )
  returning id into v_projeto_id;

  update public.orcamentos
     set projeto_id = v_projeto_id
   where tenant_id = v_tenant_id
     and projeto_id is null;
end$$;

-- 6) SET NOT NULL + índice + DROPs de colunas velhas --------------------
alter table public.orcamentos
  alter column projeto_id set not null;

create index if not exists idx_orcamentos_projeto on public.orcamentos(projeto_id);

alter table public.orcamentos
  drop column if exists cliente_id,
  drop column if exists responsavel_id,
  drop column if exists campanha;
```

- [ ] **Step 2: Verificar o arquivo com uma leitura completa**

Ler o arquivo criado por inteiro (Read tool). Confirmar que:
- Tem 6 seções numeradas (comentários)
- Não tem `TBD`/`TODO`/placeholder
- Termina com o `alter table public.orcamentos drop column if exists`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260728000002_task007_projetos.sql
git commit -m "task007: migration projetos + codigo_curto em clientes + projeto_id em orcamentos

- Nova tabela projetos (RLS, GRANT authenticated, sem DELETE)
- clientes ganha codigo_curto (2-6 letras uppercase, único por tenant, backfill das 6 primeiras letras)
- orcamentos ganha projeto_id NOT NULL, perde cliente_id/responsavel_id/campanha
- Backfill cria 1 projeto 'teste' agrupando orçamentos existentes

Não aplica ainda — aplicação via MCP fica pra Task 14."
```

**NÃO aplicar a migration ainda.** Aplicação vem só na Task 14 depois que o código estiver todo pronto.

---

### Task 2: Types — Projeto, mutação de Orcamento e Cliente

**Files:**
- Modify: `lib/types.ts`

**Interfaces:**
- Consumes: nenhum tipo novo externo
- Produces: `ProjetoStatus`, `Projeto`, `projetoStatusLabel`; `Cliente.codigo_curto: string`; `Orcamento.projeto_id: string`, sem `cliente_id`, sem `responsavel_id`, sem `campanha`

- [ ] **Step 1: Modificar `lib/types.ts` — adicionar Projeto**

Add na seção de types (depois de `Fornecedor`, antes da seção `Task 003: orçamentos`):

```typescript
// ---------- Task 007: projetos ----------

export type ProjetoStatus = "ativo" | "arquivado";

export interface Projeto {
  id: string;
  tenant_id: string;
  codigo: string;
  nome: string;
  campanha: string | null;
  cliente_id: string;
  responsavel_id: string;
  status: ProjetoStatus;
  data_inicio_prevista: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function projetoStatusLabel(s: ProjetoStatus): string {
  switch (s) {
    case "ativo":
      return "Ativo";
    case "arquivado":
      return "Arquivado";
  }
}
```

- [ ] **Step 2: Mutar `Cliente` — adicionar `codigo_curto`**

Localizar `export interface Cliente {` e adicionar `codigo_curto: string;` logo após `nome_fantasia`:

```typescript
export interface Cliente {
  id: string;
  tenant_id: string;
  nome_fantasia: string;
  codigo_curto: string;  // <-- NOVO
  razao_social: string | null;
  // ...resto igual
}
```

- [ ] **Step 3: Mutar `Orcamento` — remover cliente_id, responsavel_id, campanha; adicionar projeto_id**

Substituir a interface `Orcamento` inteira por:

```typescript
export interface Orcamento {
  id: string;
  tenant_id: string;
  projeto_id: string;
  codigo: string;
  nome: string;
  status: OrcamentoStatus;
  tipo: string | null;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "task007: types de Projeto + mutação de Cliente/Orcamento

- Cliente ganha codigo_curto: string (NOT NULL após backfill).
- Orcamento perde cliente_id, responsavel_id, campanha (sobem pra projeto).
- Orcamento ganha projeto_id: string.

TypeScript vai quebrar nos consumidores até tasks 3–13. Sem tsc aqui."
```

---

### Task 3: Validations — projetos + clientes + orcamentos

**Files:**
- Create: `lib/validations/projetos.ts`
- Modify: `lib/validations/clientes.ts`
- Modify: `lib/validations/orcamentos.ts`

**Interfaces:**
- Consumes: `Cliente`, `Orcamento` já ajustados na Task 2
- Produces: `projetoSchema`, `ProjetoInput`; `clienteSchema` atualizado com `codigo_curto`; `orcamentoSchema` atualizado sem cliente/responsavel/campanha

- [ ] **Step 1: Criar `lib/validations/projetos.ts`**

```typescript
import { z } from "zod";

/**
 * Schema de projeto. Código é gerado no server (não vem do form).
 * data_inicio_prevista é NOT NULL — determina o ano do código.
 */
export const projetoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "Informe o nome do projeto (mín. 2 caracteres).")
    .max(200, "Máximo 200 caracteres."),
  campanha: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  cliente_id: z.string().uuid("Selecione um cliente válido."),
  responsavel_id: z.string().uuid("Selecione um responsável válido."),
  data_inicio_prevista: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de início é obrigatória."),
});

export type ProjetoInput = z.infer<typeof projetoSchema>;
```

- [ ] **Step 2: Modificar `lib/validations/clientes.ts` — add `codigo_curto`**

Adicionar campo dentro do object schema (posição sugerida: logo após `nome_fantasia`):

```typescript
  codigo_curto: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,6}$/, "2 a 6 letras (sem números/espaços)."),
```

- [ ] **Step 3: Modificar `lib/validations/orcamentos.ts` — remover 3 campos**

Remover do object schema os campos `cliente_id`, `responsavel_id`, `campanha`. O resultado final do arquivo:

```typescript
import { z } from "zod";
import { ORCAMENTO_STATUS_EDITAVEIS } from "@/lib/types";

export const orcamentoSchema = z
  .object({
    codigo: z
      .string()
      .trim()
      .max(50, "Máximo 50 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    nome: z
      .string()
      .trim()
      .min(2, "Informe o nome do orçamento (mín. 2 caracteres).")
      .max(200, "Máximo 200 caracteres."),
    status: z
      .enum([
        "rascunho",
        "em_revisao",
        "enviado_cliente",
        "recusado",
        "cancelado",
      ])
      .default("rascunho")
      .refine((v) => ORCAMENTO_STATUS_EDITAVEIS.includes(v), {
        message: "Status inválido para edição manual.",
      }),
    tipo: z
      .string()
      .trim()
      .max(80)
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
  })
  .superRefine((data, ctx) => {
    if (data.data_inicio_prevista && data.data_fim_prevista) {
      if (data.data_fim_prevista < data.data_inicio_prevista) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["data_fim_prevista"],
          message: "Data fim deve ser igual ou posterior à data início.",
        });
      }
    }
  });

export type OrcamentoInput = z.infer<typeof orcamentoSchema>;
```

- [ ] **Step 4: Commit**

```bash
git add lib/validations/projetos.ts lib/validations/clientes.ts lib/validations/orcamentos.ts
git commit -m "task007: validations projeto + codigo_curto em cliente + orcamento sem cliente/responsavel/campanha"
```

---

### Task 4: Audit actions — projeto.*

**Files:**
- Modify: `lib/auth/audit.ts`

**Interfaces:**
- Consumes: nenhum novo
- Produces: `AuditAction` inclui `projeto.criado`, `projeto.atualizado`, `projeto.arquivado`, `projeto.reativado`

- [ ] **Step 1: Adicionar 4 valores ao union `AuditAction`**

Localizar o `export type AuditAction =` em `lib/auth/audit.ts` e adicionar (logo após `"orcamento.editado"`):

```typescript
  | "projeto.criado"
  | "projeto.atualizado"
  | "projeto.arquivado"
  | "projeto.reativado"
```

- [ ] **Step 2: Commit**

```bash
git add lib/auth/audit.ts
git commit -m "task007: audit actions projeto.criado/atualizado/arquivado/reativado"
```

---

### Task 5: Helpers de geração de código

**Files:**
- Create: `lib/codigos/projetos.ts`
- Create: `lib/codigos/orcamentos.ts`

**Interfaces:**
- Consumes: cliente Supabase (`SupabaseClient` do `@supabase/supabase-js`)
- Produces:
  - `gerarCodigoProjeto(supabase, tenantId, clienteId, dataInicio)` → `Promise<string>` (ex.: `"AMB-0003/26"`)
  - `gerarCodigoOrcamento(supabase, projetoId)` → `Promise<string>` (ex.: `"AMB-0003/26-01"`)

- [ ] **Step 1: Criar `lib/codigos/projetos.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gera código do projeto no formato "[CODIGO_CURTO_CLIENTE]-[SEQ_4]/[ANO_2]".
 * Sequencial reinicia a cada ano por cliente. Ex.: "AMB-0003/26".
 *
 * Sujeito a race condition em cenários de concorrência alta — o índice
 * único (tenant_id, codigo) captura colisões. Para o MVP é aceitável.
 */
export async function gerarCodigoProjeto(
  supabase: SupabaseClient,
  tenantId: string,
  clienteId: string,
  dataInicio: string, // ISO "YYYY-MM-DD"
): Promise<string> {
  // 1) codigo_curto do cliente
  const { data: cliente, error: errCli } = await supabase
    .from("clientes")
    .select("codigo_curto")
    .eq("id", clienteId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ codigo_curto: string }>();

  if (errCli || !cliente?.codigo_curto) {
    throw new Error("Cliente sem codigo_curto — preencha no cadastro do cliente.");
  }

  const codigoCurto = cliente.codigo_curto;
  const ano = dataInicio.slice(2, 4); // "2026-07-28" → "26"

  // 2) Conta projetos existentes desse cliente cujo código termine em "/<ano>"
  //    Usa LIKE porque não temos coluna separada de ano.
  const sufixo = `/${ano}`;
  const { count, error: errCount } = await supabase
    .from("projetos")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("cliente_id", clienteId)
    .like("codigo", `%${sufixo}`);

  if (errCount) {
    throw new Error(`Falha ao contar projetos: ${errCount.message}`);
  }

  const seq = ((count ?? 0) + 1).toString().padStart(4, "0");
  return `${codigoCurto}-${seq}/${ano}`;
}
```

- [ ] **Step 2: Criar `lib/codigos/orcamentos.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gera código do orçamento no formato "[CODIGO_PROJETO]-[SEQ_2]".
 * Sequencial por projeto. Ex.: "AMB-0003/26-01".
 */
export async function gerarCodigoOrcamento(
  supabase: SupabaseClient,
  projetoId: string,
): Promise<string> {
  // 1) codigo do projeto
  const { data: projeto, error: errProj } = await supabase
    .from("projetos")
    .select("codigo")
    .eq("id", projetoId)
    .maybeSingle<{ codigo: string }>();

  if (errProj || !projeto?.codigo) {
    throw new Error("Projeto não encontrado.");
  }

  // 2) Conta orçamentos do projeto
  const { count, error: errCount } = await supabase
    .from("orcamentos")
    .select("id", { count: "exact", head: true })
    .eq("projeto_id", projetoId);

  if (errCount) {
    throw new Error(`Falha ao contar orçamentos: ${errCount.message}`);
  }

  const seq = ((count ?? 0) + 1).toString().padStart(2, "0");
  return `${projeto.codigo}-${seq}`;
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/codigos/projetos.ts lib/codigos/orcamentos.ts
git commit -m "task007: helpers gerarCodigoProjeto e gerarCodigoOrcamento

Formatos:
- Projeto: '[CODIGO_CURTO]-[SEQ_4]/[ANO_2]' (ex.: AMB-0003/26)
- Orçamento: '[CODIGO_PROJETO]-[SEQ_2]' (ex.: AMB-0003/26-01)

Sequencial de projeto: por cliente+ano.
Sequencial de orçamento: por projeto."
```

---

### Task 6: Server actions de PROJETOS — reescrever `app/(app)/orcamentos/actions.ts`

**Files:**
- Modify (rewrite): `app/(app)/orcamentos/actions.ts`

**Interfaces:**
- Consumes: `projetoSchema`, `gerarCodigoProjeto`, `logAuditEvent`, `requireSession`, `createClient`
- Produces: `criarProjeto(formData)`, `atualizarProjeto(id, formData)`, `arquivarProjeto(id)`, `reativarProjeto(id)`, todos retornando `ActionResult`

- [ ] **Step 1: Substituir o conteúdo inteiro de `app/(app)/orcamentos/actions.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { projetoSchema } from "@/lib/validations/projetos";
import { gerarCodigoProjeto } from "@/lib/codigos/projetos";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    nome: formData.get("nome")?.toString() ?? "",
    campanha: formData.get("campanha")?.toString() ?? "",
    cliente_id: formData.get("cliente_id")?.toString() ?? "",
    responsavel_id: formData.get("responsavel_id")?.toString() ?? "",
    data_inicio_prevista: formData.get("data_inicio_prevista")?.toString() ?? "",
  };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_projetos_codigo_por_tenant")) {
    return "Já existe um projeto com este código — tente novamente.";
  }
  if (msg.includes("projetos_cliente_id_fkey")) {
    return "Cliente inválido.";
  }
  if (msg.includes("projetos_responsavel_id_fkey")) {
    return "Responsável inválido.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

export async function criarProjeto(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = projetoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  let codigo: string;
  try {
    codigo = await gerarCodigoProjeto(
      supabase,
      session.activeTenant.id,
      parsed.data.cliente_id,
      parsed.data.data_inicio_prevista,
    );
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const { data, error } = await supabase
    .from("projetos")
    .insert({
      ...parsed.data,
      codigo,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[projetos.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "projeto.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "projeto",
    entidadeId: data.id,
    metadata: { codigo, nome: parsed.data.nome, cliente_id: parsed.data.cliente_id },
  });

  revalidatePath("/orcamentos");
  redirect(`/orcamentos/${data.id}`);
}

export async function atualizarProjeto(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = projetoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // Confirma que o projeto pertence ao tenant do usuário (RLS já filtra,
  // mas explicitamos no where pra clareza).
  const { error } = await supabase
    .from("projetos")
    .update(parsed.data)
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[projetos.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "projeto.atualizado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "projeto",
    entidadeId: id,
  });

  revalidatePath("/orcamentos");
  revalidatePath(`/orcamentos/${id}`);
  return { ok: true, id };
}

export async function arquivarProjeto(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  // Bloqueia se houver orçamento não-cancelado no projeto.
  const { count, error: errCount } = await supabase
    .from("orcamentos")
    .select("id", { count: "exact", head: true })
    .eq("projeto_id", id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado");

  if (errCount) {
    console.error("[projetos.arquivar.count]", errCount.message);
    return { ok: false, message: "Falha ao verificar orçamentos do projeto." };
  }

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: "Cancele todos os orçamentos do projeto antes de arquivar.",
    };
  }

  const { error } = await supabase
    .from("projetos")
    .update({ status: "arquivado" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[projetos.arquivar]", error.message);
    return { ok: false, message: "Não foi possível arquivar." };
  }

  await logAuditEvent({
    acao: "projeto.arquivado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "projeto",
    entidadeId: id,
  });

  revalidatePath("/orcamentos");
  revalidatePath(`/orcamentos/${id}`);
  return { ok: true, id };
}

export async function reativarProjeto(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase
    .from("projetos")
    .update({ status: "ativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[projetos.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "projeto.reativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "projeto",
    entidadeId: id,
  });

  revalidatePath("/orcamentos");
  revalidatePath(`/orcamentos/${id}`);
  return { ok: true, id };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(app)/orcamentos/actions.ts
git commit -m "task007: server actions de PROJETO substituem CRUD antigo de orçamento

criarProjeto, atualizarProjeto, arquivarProjeto, reativarProjeto.
Arquivamento bloqueia se houver orçamento não-cancelado no projeto.
CRUD de orçamento migra pra app/(app)/orcamentos/[projetoId]/actions.ts na task 9."
```

---

### Task 7: Componentes de UI — projeto-form, projetos-list, projeto-editor-drawer

**Files:**
- Create: `app/(app)/orcamentos/projeto-form.tsx`
- Create: `app/(app)/orcamentos/projetos-list.tsx`
- Create: `app/(app)/orcamentos/projeto-editor-drawer.tsx`

**Interfaces:**
- Consumes: `Projeto`, `Cliente`, `Profile` de `@/lib/types`; `criarProjeto`, `atualizarProjeto`, `arquivarProjeto`, `reativarProjeto` de `./actions`
- Produces: componentes `<ProjetoForm>`, `<ProjetosList>`, `<ProjetoEditorDrawer>` para uso na page principal e no detalhe do projeto

- [ ] **Step 1: Criar `app/(app)/orcamentos/projeto-form.tsx`**

```typescript
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Save } from "lucide-react";
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
import type { Cliente, Profile, Projeto } from "@/lib/types";
import {
  atualizarProjeto,
  criarProjeto,
  type ActionResult,
} from "./actions";

interface Props {
  projeto?: Projeto;
  clientes: Pick<Cliente, "id" | "nome_fantasia" | "codigo_curto">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ProjetoForm({
  projeto,
  clientes,
  responsaveis,
  onSuccess,
  onCancel,
}: Props) {
  const router = useRouter();
  const isEdit = Boolean(projeto);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [clienteId, setClienteId] = React.useState(projeto?.cliente_id ?? "");
  const [responsavelId, setResponsavelId] = React.useState(
    projeto?.responsavel_id ?? "",
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set("cliente_id", clienteId);
    formData.set("responsavel_id", responsavelId);

    startTransition(async () => {
      const res: ActionResult = isEdit
        ? await atualizarProjeto(projeto!.id, formData)
        : await criarProjeto(formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      if (isEdit) {
        router.refresh();
        onSuccess?.();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nome do projeto" name="nome" required errors={fieldErrors}>
          <Input
            name="nome"
            defaultValue={projeto?.nome ?? ""}
            required
            autoFocus
            placeholder="Ex.: Carnaval Anitta"
          />
        </Field>

        <Field label="Campanha" name="campanha" errors={fieldErrors}>
          <Input
            name="campanha"
            defaultValue={projeto?.campanha ?? ""}
            placeholder="Ex.: Verão 2026"
          />
        </Field>

        <Field label="Cliente" name="cliente_id" required errors={fieldErrors}>
          <Select value={clienteId} onValueChange={setClienteId} required>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um cliente ativo" />
            </SelectTrigger>
            <SelectContent>
              {clientes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome_fantasia}{" "}
                  <span className="text-muted-foreground">({c.codigo_curto})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Responsável" name="responsavel_id" required errors={fieldErrors}>
          <Select value={responsavelId} onValueChange={setResponsavelId} required>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um membro do tenant" />
            </SelectTrigger>
            <SelectContent>
              {responsaveis.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Início previsto" name="data_inicio_prevista" required errors={fieldErrors}>
          <DatePicker
            name="data_inicio_prevista"
            defaultValue={projeto?.data_inicio_prevista ?? ""}
            placeholder="Selecione a data"
          />
        </Field>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
        ) : (
          <Link
            href={isEdit ? `/orcamentos/${projeto!.id}` : "/orcamentos"}
            className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </Link>
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending ? (
            <>
              <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {isEdit ? "Salvar alterações" : "Criar projeto"}
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  errors,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  errors: Record<string, string[]>;
  children: React.ReactNode;
}) {
  const fieldErrors = errors[name];
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-california-red ml-1">*</span>}
      </Label>
      {children}
      {fieldErrors?.map((msg, i) => (
        <p key={i} className="text-xs text-california-red">
          {msg}
        </p>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Criar `app/(app)/orcamentos/projeto-editor-drawer.tsx`**

```typescript
"use client";

import * as React from "react";
import { Pencil, Archive, RefreshCw } from "lucide-react";
import { Dialog, DrawerContent } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Cliente, Profile, Projeto } from "@/lib/types";
import { ProjetoForm } from "./projeto-form";
import { arquivarProjeto, reativarProjeto } from "./actions";

interface Props {
  projeto: Projeto;
  clientes: Pick<Cliente, "id" | "nome_fantasia" | "codigo_curto">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
}

export function ProjetoEditorDrawer({ projeto, clientes, responsaveis }: Props) {
  const [open, setOpen] = React.useState(false);
  const [confirmArquivar, setConfirmArquivar] = React.useState(false);
  const [confirmReativar, setConfirmReativar] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function handleArquivar() {
    setError(null);
    startTransition(async () => {
      const res = await arquivarProjeto(projeto.id);
      if (!res.ok) setError(res.message);
      else {
        setConfirmArquivar(false);
        setOpen(false);
      }
    });
  }

  function handleReativar() {
    setError(null);
    startTransition(async () => {
      const res = await reativarProjeto(projeto.id);
      if (!res.ok) setError(res.message);
      else {
        setConfirmReativar(false);
        setOpen(false);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar projeto
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DrawerContent title={`Editar projeto ${projeto.codigo}`}>
          <ProjetoForm
            projeto={projeto}
            clientes={clientes}
            responsaveis={responsaveis}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />

          {error && (
            <p className="mt-4 text-sm text-california-red">{error}</p>
          )}

          <div className="mt-6 border-t border-border pt-4 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Status: <strong className="text-foreground">{projeto.status}</strong>
            </p>
            {projeto.status === "ativo" ? (
              <button
                type="button"
                onClick={() => setConfirmArquivar(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Archive className="h-3.5 w-3.5" />
                Arquivar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReativar(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reativar
              </button>
            )}
          </div>
        </DrawerContent>
      </Dialog>

      <ConfirmDialog
        open={confirmArquivar}
        onOpenChange={setConfirmArquivar}
        title="Arquivar projeto?"
        description="O projeto sai da lista principal e passa a aparecer só quando o filtro 'arquivados' estiver ligado. Só é possível arquivar se todos os orçamentos estiverem cancelados."
        confirmLabel="Arquivar"
        onConfirm={handleArquivar}
        pending={pending}
      />

      <ConfirmDialog
        open={confirmReativar}
        onOpenChange={setConfirmReativar}
        title="Reativar projeto?"
        description="O projeto volta pra lista de ativos."
        confirmLabel="Reativar"
        onConfirm={handleReativar}
        pending={pending}
      />
    </>
  );
}
```

- [ ] **Step 3: Criar `app/(app)/orcamentos/projetos-list.tsx`**

```typescript
"use client";

import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Cliente, Profile, ProjetoStatus } from "@/lib/types";
import { projetoStatusLabel } from "@/lib/types";

export interface ProjetoRow {
  id: string;
  codigo: string;
  nome: string;
  campanha: string | null;
  status: ProjetoStatus;
  cliente_id: string;
  cliente_nome: string | null;
  responsavel_id: string;
  responsavel_nome: string | null;
  data_inicio_prevista: string;
  orcamentos_count: number;
  created_at: string;
}

interface Props {
  projetos: ProjetoRow[];
  clientes: Pick<Cliente, "id" | "nome_fantasia">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
}

function statusBadgeClasses(status: ProjetoStatus): string {
  return status === "ativo"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-100 text-slate-500 border-slate-200";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function ProjetosList({ projetos, clientes, responsaveis }: Props) {
  const [busca, setBusca] = React.useState("");
  const [clienteFiltro, setClienteFiltro] = React.useState<string>("todos");
  const [respFiltro, setRespFiltro] = React.useState<string>("todos");
  const [statusFiltro, setStatusFiltro] = React.useState<string>("ativos");

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return projetos.filter((p) => {
      if (clienteFiltro !== "todos" && p.cliente_id !== clienteFiltro) return false;
      if (respFiltro !== "todos" && p.responsavel_id !== respFiltro) return false;
      if (statusFiltro === "ativos" && p.status !== "ativo") return false;
      if (statusFiltro === "arquivados" && p.status !== "arquivado") return false;
      if (q) {
        const hay = `${p.codigo} ${p.nome} ${p.campanha ?? ""} ${p.cliente_nome ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projetos, busca, clienteFiltro, respFiltro, statusFiltro]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código, nome, campanha ou cliente..."
            className="pl-9"
          />
        </div>
        <Select value={clienteFiltro} onValueChange={setClienteFiltro}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os clientes</SelectItem>
            {clientes.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.nome_fantasia}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={respFiltro} onValueChange={setRespFiltro}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos responsáveis</SelectItem>
            {responsaveis.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFiltro} onValueChange={setStatusFiltro}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ativos">Ativos</SelectItem>
            <SelectItem value="arquivados">Arquivados</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Nome</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Responsável</th>
              <th className="px-4 py-3 font-semibold">Início</th>
              <th className="px-4 py-3 font-semibold text-center">Orçamentos</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => (
              <tr
                key={p.id}
                className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer"
                onClick={() => window.location.assign(`/orcamentos/${p.id}`)}
              >
                <td className="px-4 py-3 font-mono text-xs">
                  <Link
                    href={`/orcamentos/${p.id}`}
                    prefetch={false}
                    className="hover:text-california-red"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.codigo}
                  </Link>
                </td>
                <td className="px-4 py-3 font-medium">{p.nome}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.cliente_nome ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.responsavel_nome ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(p.data_inicio_prevista)}</td>
                <td className="px-4 py-3 text-center tabular-nums">{p.orcamentos_count}</td>
                <td className="px-4 py-3">
                  <Badge className={cn("border", statusBadgeClasses(p.status))}>
                    {projetoStatusLabel(p.status)}
                  </Badge>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nenhum projeto encontrado com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/(app)/orcamentos/projeto-form.tsx app/(app)/orcamentos/projeto-editor-drawer.tsx app/(app)/orcamentos/projetos-list.tsx
git commit -m "task007: UI de projetos (form + drawer + list)

ProjetoForm: nome, campanha, cliente, responsável, data início.
ProjetoEditorDrawer: edição + arquivar/reativar com ConfirmDialog.
ProjetosList: tabela com filtros (cliente/responsável/status), busca, linha clicável (regra memória)."
```

---

### Task 8: Reescrever `app/(app)/orcamentos/page.tsx` e `novo/page.tsx`

**Files:**
- Modify (rewrite): `app/(app)/orcamentos/page.tsx`
- Modify (rewrite): `app/(app)/orcamentos/novo/page.tsx`

**Interfaces:**
- Consumes: `<ProjetosList>` (Task 7), `<ProjetoForm>` (Task 7), `listActiveMembers`, `requireSession`, `createClient`
- Produces: rota `/orcamentos` renderiza lista de projetos; rota `/orcamentos/novo` renderiza form de criar projeto

- [ ] **Step 1: Reescrever `app/(app)/orcamentos/page.tsx`**

```typescript
import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import type { Cliente, Projeto } from "@/lib/types";
import { EmptyState } from "@/components/empty-state";
import { ProjetosList, type ProjetoRow } from "./projetos-list";

export const dynamic = "force-dynamic";

export default async function ProjetosPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [projRes, clientesRes, responsaveis] = await Promise.all([
    supabase
      .from("projetos")
      .select(
        "id, codigo, nome, campanha, status, cliente_id, responsavel_id, data_inicio_prevista, created_at, cliente:clientes(id, nome_fantasia), responsavel:profiles!responsavel_id(id, nome)",
      )
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("clientes")
      .select("id, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    listActiveMembers(session.activeTenant.id),
  ]);

  if (projRes.error) console.error("[projetos.page]", projRes.error.message);
  if (clientesRes.error) console.error("[projetos.clientes]", clientesRes.error.message);

  const projetosBrutos = ((projRes.data ?? []) as any[]);
  const projetoIds = projetosBrutos.map((p) => p.id);

  // Contagem agregada de orçamentos por projeto (SEM embed pesado).
  const orcamentosCountMap = new Map<string, number>();
  if (projetoIds.length > 0) {
    const { data: orcs } = await supabase
      .from("orcamentos")
      .select("projeto_id")
      .in("projeto_id", projetoIds)
      .eq("tenant_id", session.activeTenant.id);
    for (const o of ((orcs ?? []) as any[])) {
      orcamentosCountMap.set(o.projeto_id, (orcamentosCountMap.get(o.projeto_id) ?? 0) + 1);
    }
  }

  const projetos: ProjetoRow[] = projetosBrutos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nome: p.nome,
    campanha: p.campanha,
    status: p.status as Projeto["status"],
    cliente_id: p.cliente_id,
    cliente_nome: p.cliente?.nome_fantasia ?? null,
    responsavel_id: p.responsavel_id,
    responsavel_nome: p.responsavel?.nome ?? null,
    data_inicio_prevista: p.data_inicio_prevista,
    orcamentos_count: orcamentosCountMap.get(p.id) ?? 0,
    created_at: p.created_at,
  }));

  const clientes = (clientesRes.data ?? []) as Pick<Cliente, "id" | "nome_fantasia">[];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
            Comercial
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Orçamentos</h1>
          <p className="text-sm text-muted-foreground">
            Cada projeto agrupa os orçamentos de uma iniciativa do cliente.
            Clique num projeto para ver seus orçamentos e versões.
          </p>
        </div>
        <Link
          href="/orcamentos/novo"
          prefetch={false}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
        >
          <Plus className="h-4 w-4" />
          Novo projeto
        </Link>
      </header>

      {projetos.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="Nenhum projeto ainda"
          description="Crie um projeto para começar a organizar seus orçamentos por iniciativa."
          action={
            <Link
              href="/orcamentos/novo"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Criar projeto
            </Link>
          }
        />
      ) : (
        <ProjetosList
          projetos={projetos}
          clientes={clientes}
          responsaveis={responsaveis}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Reescrever `app/(app)/orcamentos/novo/page.tsx`**

```typescript
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import type { Cliente } from "@/lib/types";
import { ProjetoForm } from "../projeto-form";

export const dynamic = "force-dynamic";

export default async function NovoProjetoPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [clientesRes, responsaveis] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, nome_fantasia, codigo_curto")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    listActiveMembers(session.activeTenant.id),
  ]);

  const clientes = (clientesRes.data ?? []) as Pick<
    Cliente,
    "id" | "nome_fantasia" | "codigo_curto"
  >[];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link
          href="/orcamentos"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para projetos
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Novo projeto</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O código do projeto é gerado automaticamente no formato{" "}
          <span className="font-mono">CLI-NNNN/AA</span>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <ProjetoForm clientes={clientes} responsaveis={responsaveis} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/(app)/orcamentos/page.tsx app/(app)/orcamentos/novo/page.tsx
git commit -m "task007: /orcamentos vira lista de projetos + /orcamentos/novo cria projeto

- Lista usa query agregada separada pra contar orçamentos por projeto (regra performance).
- prefetch={false} nos Links.
- Promise.all nas queries do server component."
```

---

### Task 9: Reorg de rotas — mover `[id]` para `[projetoId]/[orcId]`

**Files:**
- Move (git mv): `app/(app)/orcamentos/[id]/page.tsx` → `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx`
- Move (git mv): `app/(app)/orcamentos/[id]/versoes/` → `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/` (todo o subtree)

**Interfaces:**
- Consumes: nada externo
- Produces: nova hierarquia de rotas; arquivos movidos AINDA usam `params.id` — serão ajustados nas próximas tasks

- [ ] **Step 1: Mover o diretório `[id]` inteiro pra `[projetoId]/[orcId]`**

Executar em sequência (PowerShell):

```powershell
git mv "app/(app)/orcamentos/[id]" "app/(app)/orcamentos/__TMP_orc__"
mkdir "app/(app)/orcamentos/[projetoId]"
git mv "app/(app)/orcamentos/__TMP_orc__" "app/(app)/orcamentos/[projetoId]/[orcId]"
```

O motivo do rename intermediário: PowerShell/git no Windows não faz `mv X/[id] X/[projetoId]/[orcId]` num shot só sem que `[projetoId]` exista antes; e algumas variações trocam apenas o nome do folder-alvo. Fazer via `__TMP_orc__` garante que `git mv` renomeia o subtree inteiro preservando histórico.

- [ ] **Step 2: Verificar a estrutura resultante**

```bash
git ls-files "app/(app)/orcamentos/[projetoId]/**"
```

Esperado:
```
app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx
app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/grupo-card.tsx
app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/itens-table.tsx
app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/novo-grupo-drawer.tsx
app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/page.tsx
app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/totais-card.tsx
app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/versao-editor-drawer.tsx
app/(app)/orcamentos/[projetoId]/[orcId]/versoes/actions.ts
app/(app)/orcamentos/[projetoId]/[orcId]/versoes/importar-actions.ts
app/(app)/orcamentos/[projetoId]/[orcId]/versoes/importar-drawer.tsx
app/(app)/orcamentos/[projetoId]/[orcId]/versoes/nova-versao-drawer.tsx
app/(app)/orcamentos/[projetoId]/[orcId]/versoes/versoes-list.tsx
```

- [ ] **Step 3: Commit**

```bash
git commit -m "task007: reorg — [id] -> [projetoId]/[orcId]

Move o subtree inteiro do detalhe do orçamento pra dentro do novo escopo
por projeto. Arquivos ainda usam params.id — ajustes de código vêm nas
próximas tasks (o compilador ainda quebra até task 13)."
```

---

### Task 10: Adaptar `[orcId]/page.tsx` — breadcrumb + embeds via projeto + rename de params

**Files:**
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx`

**Interfaces:**
- Consumes: `session`, `createClient`, `listActiveMembers`, componentes movidos (`NovaVersaoDrawer`, `VersoesList`, `ImportarPlanilhaDrawer`, `OrcamentoEditorDrawer` que ainda não existe no novo local — vai ser criado na Task 11)
- Produces: página `/orcamentos/[projetoId]/[orcId]` renderiza detalhe do orçamento lendo cliente/responsável/campanha do projeto pai

- [ ] **Step 1: Reescrever `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx`**

Substituir o conteúdo inteiro pelo novo:

```typescript
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileStack, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import {
  orcamentoStatusLabel,
  type Orcamento,
  type VersaoOrcamentoStatus,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { OrcamentoEditorDrawer } from "../orcamento-editor-drawer";
import { NovaVersaoDrawer } from "./versoes/nova-versao-drawer";
import { VersoesList, type VersaoRow } from "./versoes/versoes-list";
import { ImportarPlanilhaDrawer } from "./versoes/importar-drawer";

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: Orcamento["status"]): string {
  switch (status) {
    case "rascunho":
      return "bg-muted text-muted-foreground border-border";
    case "em_revisao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "enviado_cliente":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "aprovado":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "job_criado":
      return "bg-california-red/10 text-california-red border-california-red/20";
    case "recusado":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "cancelado":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export default async function OrcamentoDetailPage({
  params,
}: {
  params: { projetoId: string; orcId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const [orcRes, projRes, responsaveis, versoesRes] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("id, tenant_id, projeto_id, codigo, nome, status, tipo, data_inicio_prevista, data_fim_prevista, created_by, created_at, updated_at")
      .eq("id", params.orcId)
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("projetos")
      .select("id, codigo, nome, campanha, cliente:clientes(id, nome_fantasia), responsavel:profiles!responsavel_id(id, nome)")
      .eq("id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    listActiveMembers(session.activeTenant.id),
    supabase
      .from("versoes_orcamento")
      .select("id, numero_versao, nome, status, percentual_honorarios, percentual_imposto, moeda, created_at")
      .eq("orcamento_id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .order("numero_versao", { ascending: false }),
  ]);

  if (orcRes.error) console.error("[orcamentos.detail]", orcRes.error.message);
  if (projRes.error) console.error("[projetos.detail]", projRes.error.message);

  const orcamento = orcRes.data as Orcamento | null;
  const projeto = projRes.data as any;
  if (!orcamento || !projeto) notFound();

  const clienteNome: string | null = projeto.cliente?.nome_fantasia ?? null;
  const responsavelNome: string | null = projeto.responsavel?.nome ?? null;

  if (versoesRes.error) console.error("[versoes.list]", versoesRes.error.message);
  const versoesBrutas = (versoesRes.data ?? []) as any[];
  const versaoIds = versoesBrutas.map((v) => v.id);

  const agregadoPorVersao = new Map<string, { count: number; total: number }>();
  if (versaoIds.length > 0) {
    const { data: itensBrutos, error: itensAggErr } = await supabase
      .from("versoes_orcamento_itens")
      .select("versao_orcamento_id, total_orcado")
      .in("versao_orcamento_id", versaoIds)
      .eq("tenant_id", session.activeTenant.id);

    if (itensAggErr) console.error("[versoes.agg]", itensAggErr.message);
    for (const it of (itensBrutos ?? []) as any[]) {
      const cur = agregadoPorVersao.get(it.versao_orcamento_id) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(it.total_orcado ?? 0);
      agregadoPorVersao.set(it.versao_orcamento_id, cur);
    }
  }

  const versoes: VersaoRow[] = versoesBrutas.map((v) => {
    const agg = agregadoPorVersao.get(v.id) ?? { count: 0, total: 0 };
    return {
      id: v.id,
      numero_versao: v.numero_versao,
      nome: v.nome,
      status: v.status as VersaoOrcamentoStatus,
      percentual_honorarios: Number(v.percentual_honorarios ?? 0),
      percentual_imposto: Number(v.percentual_imposto ?? 0),
      moeda: v.moeda ?? "BRL",
      itens_count: agg.count,
      itens_total: agg.total,
      created_at: v.created_at,
    };
  });

  const protegido = orcamento.status === "aprovado" || orcamento.status === "job_criado";
  const podeCriarVersao = orcamento.status !== "job_criado" && orcamento.status !== "cancelado";

  const periodo =
    orcamento.data_inicio_prevista || orcamento.data_fim_prevista
      ? `${formatDate(orcamento.data_inicio_prevista)} → ${formatDate(orcamento.data_fim_prevista)}`
      : null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Link
          href={`/orcamentos/${params.projetoId}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para {projeto.codigo} · {projeto.nome}
        </Link>

        <div className="mt-3">
          <p className="font-mono text-xs font-semibold text-muted-foreground">
            {orcamento.codigo}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{orcamento.nome}</h1>
            <Badge className={cn("border", statusBadgeClasses(orcamento.status))}>
              {orcamentoStatusLabel(orcamento.status)}
            </Badge>
            <OrcamentoEditorDrawer
              projetoId={params.projetoId}
              orcamento={orcamento}
              disabled={protegido}
              disabledReason={
                protegido
                  ? `Bloqueado em ${orcamentoStatusLabel(orcamento.status).toLowerCase()} — alterações via fluxo de aprovação/job.`
                  : undefined
              }
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              <span className="text-foreground/60">Cliente:</span>{" "}
              <span className="text-foreground font-medium">{clienteNome ?? "—"}</span>
            </span>
            <span aria-hidden className="text-border">·</span>
            <span>
              <span className="text-foreground/60">Responsável:</span>{" "}
              <span className="text-foreground font-medium">{responsavelNome ?? "—"}</span>
            </span>
            {periodo && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>
                  <span className="text-foreground/60">Período:</span>{" "}
                  <span className="text-foreground font-medium">{periodo}</span>
                </span>
              </>
            )}
            {projeto.campanha && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>
                  <span className="text-foreground/60">Campanha:</span>{" "}
                  <span className="text-foreground font-medium">{projeto.campanha}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {protegido && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 flex items-start gap-3">
          <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Este orçamento está em estado protegido (
            <strong className="text-foreground">{orcamentoStatusLabel(orcamento.status)}</strong>
            ). A edição dos dados ficou bloqueada.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div className="flex items-center gap-2">
            <FileStack className="h-5 w-5 text-california-red" />
            <div>
              <h2 className="text-lg font-semibold leading-none tracking-tight">
                Versões do orçamento
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                v1, v2, v3… clique para abrir e gerenciar os itens.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ImportarPlanilhaDrawer
              projetoId={params.projetoId}
              orcamentoId={orcamento.id}
              disabled={!podeCriarVersao}
              disabledReason={
                podeCriarVersao
                  ? undefined
                  : `Orçamento ${orcamentoStatusLabel(orcamento.status).toLowerCase()} não aceita novas versões.`
              }
            />
            <NovaVersaoDrawer
              projetoId={params.projetoId}
              orcamentoId={orcamento.id}
              disabled={!podeCriarVersao}
              disabledReason={
                podeCriarVersao
                  ? undefined
                  : `Orçamento ${orcamentoStatusLabel(orcamento.status).toLowerCase()} não aceita novas versões.`
              }
            />
          </div>
        </div>

        {versoes.length === 0 ? (
          <div className="p-6">
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
              <FileStack className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nenhuma versão ainda.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Clique em <span className="font-semibold text-foreground">Nova versão</span> para começar.
              </p>
            </div>
          </div>
        ) : (
          <VersoesList
            projetoId={params.projetoId}
            orcamentoId={orcamento.id}
            versoes={versoes}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx
git commit -m "task007: adapta detalhe do orçamento

- params.id -> params.orcId + params.projetoId (agora no path aninhado)
- cliente/responsavel/campanha vêm do embed do projeto (não mais do próprio orçamento)
- Breadcrumb 'voltar' aponta pro projeto pai
- Drawer, NovaVersao e Importar recebem projetoId adicional (props ajustadas nas próximas tasks)
- Timings temporários REMOVIDOS (o cleanup pendente do HANDOFF)"
```

---

### Task 11: Criar `[projetoId]/actions.ts` (CRUD orçamento dentro do projeto)

**Files:**
- Create: `app/(app)/orcamentos/[projetoId]/actions.ts`

**Interfaces:**
- Consumes: `orcamentoSchema`, `gerarCodigoOrcamento`, `logAuditEvent`, `requireSession`, `createClient`
- Produces: `criarOrcamento(projetoId, formData)`, `atualizarOrcamento(projetoId, orcId, formData)`, ambos retornando `ActionResult`

- [ ] **Step 1: Criar `app/(app)/orcamentos/[projetoId]/actions.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { orcamentoSchema } from "@/lib/validations/orcamentos";
import { gerarCodigoOrcamento } from "@/lib/codigos/orcamentos";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    codigo: formData.get("codigo")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    status: (formData.get("status")?.toString() ?? "rascunho") as any,
    tipo: formData.get("tipo")?.toString() ?? "",
    data_inicio_prevista: formData.get("data_inicio_prevista")?.toString() ?? "",
    data_fim_prevista: formData.get("data_fim_prevista")?.toString() ?? "",
  };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_orcamentos_codigo_por_tenant")) {
    return "Já existe um orçamento com este código neste tenant.";
  }
  if (msg.includes("orcamentos_datas_ordem")) {
    return "Data fim precisa ser igual ou posterior à data início.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

async function assertProjetoDoTenant(
  supabase: ReturnType<typeof createClient>,
  projetoId: string,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("projetos")
    .select("id")
    .eq("id", projetoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, message: "Projeto não encontrado." };
  }
  return { ok: true };
}

export async function criarOrcamento(
  projetoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = orcamentoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const chk = await assertProjetoDoTenant(supabase, projetoId, session.activeTenant.id);
  if (!chk.ok) return chk;

  let codigo: string;
  try {
    codigo = parsed.data.codigo ?? (await gerarCodigoOrcamento(supabase, projetoId));
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const { codigo: _unused, ...rest } = parsed.data;

  const { data, error } = await supabase
    .from("orcamentos")
    .insert({
      ...rest,
      codigo,
      projeto_id: projetoId,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[orcamentos.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "orcamento.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "orcamento",
    entidadeId: data.id,
    metadata: { codigo, nome: parsed.data.nome, projeto_id: projetoId },
  });

  revalidatePath(`/orcamentos/${projetoId}`);
  redirect(`/orcamentos/${projetoId}/${data.id}`);
}

export async function atualizarOrcamento(
  projetoId: string,
  orcId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = orcamentoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const { data: atual } = await supabase
    .from("orcamentos")
    .select("status")
    .eq("id", orcId)
    .eq("projeto_id", projetoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: string }>();

  if (!atual) {
    return { ok: false, message: "Orçamento não encontrado." };
  }
  if (atual.status === "aprovado" || atual.status === "job_criado") {
    return {
      ok: false,
      message:
        "Orçamento em estado protegido (aprovado ou com job criado). Alterações precisam ser feitas pela Task 004/005.",
    };
  }

  const { codigo, ...rest } = parsed.data;
  const payload = codigo ? { ...rest, codigo } : rest;

  const { error } = await supabase
    .from("orcamentos")
    .update(payload)
    .eq("id", orcId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[orcamentos.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "orcamento.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "orcamento",
    entidadeId: orcId,
  });

  revalidatePath(`/orcamentos/${projetoId}`);
  revalidatePath(`/orcamentos/${projetoId}/${orcId}`);
  return { ok: true, id: orcId };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(app)/orcamentos/[projetoId]/actions.ts
git commit -m "task007: server actions de orçamento escopadas ao projeto

criarOrcamento(projetoId, form) e atualizarOrcamento(projetoId, orcId, form).
Valida que o projeto pertence ao tenant. Usa gerarCodigoOrcamento (task 5)."
```

---

### Task 12: Componentes de orçamento (form + drawer + list) dentro de `[projetoId]/`

**Files:**
- Create: `app/(app)/orcamentos/[projetoId]/orcamento-form.tsx`
- Create: `app/(app)/orcamentos/[projetoId]/orcamento-editor-drawer.tsx`
- Create: `app/(app)/orcamentos/[projetoId]/orcamentos-list.tsx`
- Create: `app/(app)/orcamentos/[projetoId]/novo/page.tsx`
- Delete: `app/(app)/orcamentos/orcamento-form.tsx`
- Delete: `app/(app)/orcamentos/orcamento-editor-drawer.tsx`
- Delete: `app/(app)/orcamentos/orcamentos-list.tsx`

**Interfaces:**
- Consumes: `Orcamento`, `OrcamentoStatus`, `ORCAMENTO_STATUS_EDITAVEIS`; actions da Task 11
- Produces: componentes usados pela página de detalhe do projeto (Task 13) e pela page `/orcamentos/[projetoId]/[orcId]` (Task 10) via re-export com nome idêntico

- [ ] **Step 1: Criar `app/(app)/orcamentos/[projetoId]/orcamento-form.tsx`**

```typescript
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Save } from "lucide-react";
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
import {
  ORCAMENTO_STATUS_EDITAVEIS,
  orcamentoStatusLabel,
  type Orcamento,
  type OrcamentoStatus,
} from "@/lib/types";
import {
  atualizarOrcamento,
  criarOrcamento,
  type ActionResult,
} from "./actions";

interface Props {
  projetoId: string;
  orcamento?: Orcamento;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function OrcamentoForm({ projetoId, orcamento, onSuccess, onCancel }: Props) {
  const router = useRouter();
  const isEdit = Boolean(orcamento);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [status, setStatus] = React.useState<OrcamentoStatus>(
    orcamento?.status && ORCAMENTO_STATUS_EDITAVEIS.includes(orcamento.status)
      ? orcamento.status
      : "rascunho",
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    if (isEdit) formData.set("status", status);

    startTransition(async () => {
      const res: ActionResult = isEdit
        ? await atualizarOrcamento(projetoId, orcamento!.id, formData)
        : await criarOrcamento(projetoId, formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      if (isEdit) {
        router.refresh();
        onSuccess?.();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nome do orçamento" name="nome" required errors={fieldErrors}>
          <Input
            name="nome"
            defaultValue={orcamento?.nome ?? ""}
            required
            autoFocus
            placeholder="Ex.: Bebedouros SP"
          />
        </Field>

        {isEdit && (
          <Field label="Código" name="codigo" errors={fieldErrors}>
            <Input
              name="codigo"
              defaultValue={orcamento?.codigo ?? ""}
              placeholder="Auto-gerado"
            />
          </Field>
        )}

        {isEdit && (
          <Field label="Tipo" name="tipo" errors={fieldErrors}>
            <Input
              name="tipo"
              defaultValue={orcamento?.tipo ?? ""}
              placeholder="Ex.: vídeo, foto, ativação"
            />
          </Field>
        )}

        <Field label="Início previsto" name="data_inicio_prevista" errors={fieldErrors}>
          <DatePicker
            name="data_inicio_prevista"
            defaultValue={orcamento?.data_inicio_prevista ?? ""}
            placeholder="Selecione a data"
          />
        </Field>

        <Field label="Fim previsto" name="data_fim_prevista" errors={fieldErrors}>
          <DatePicker
            name="data_fim_prevista"
            defaultValue={orcamento?.data_fim_prevista ?? ""}
            placeholder="Selecione a data"
          />
        </Field>

        {isEdit && (
          <Field label="Status" name="status" errors={fieldErrors}>
            <Select value={status} onValueChange={(v) => setStatus(v as OrcamentoStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORCAMENTO_STATUS_EDITAVEIS.map((s) => (
                  <SelectItem key={s} value={s}>{orcamentoStatusLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
        ) : (
          <Link
            href={isEdit ? `/orcamentos/${projetoId}/${orcamento!.id}` : `/orcamentos/${projetoId}`}
            className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </Link>
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending ? (
            <>
              <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {isEdit ? "Salvar alterações" : "Criar orçamento"}
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  errors,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  errors: Record<string, string[]>;
  children: React.ReactNode;
}) {
  const fieldErrors = errors[name];
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-california-red ml-1">*</span>}
      </Label>
      {children}
      {fieldErrors?.map((msg, i) => (
        <p key={i} className="text-xs text-california-red">{msg}</p>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Criar `app/(app)/orcamentos/[projetoId]/orcamento-editor-drawer.tsx`**

```typescript
"use client";

import * as React from "react";
import { Pencil, Lock } from "lucide-react";
import { Dialog, DrawerContent } from "@/components/ui/dialog";
import type { Orcamento } from "@/lib/types";
import { OrcamentoForm } from "./orcamento-form";

interface Props {
  projetoId: string;
  orcamento: Orcamento;
  disabled?: boolean;
  disabledReason?: string;
}

export function OrcamentoEditorDrawer({
  projetoId,
  orcamento,
  disabled,
  disabledReason,
}: Props) {
  const [open, setOpen] = React.useState(false);

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title={disabledReason}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground cursor-not-allowed"
      >
        <Lock className="h-3.5 w-3.5" />
        Editar
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DrawerContent title={`Editar orçamento ${orcamento.codigo}`}>
          <OrcamentoForm
            projetoId={projetoId}
            orcamento={orcamento}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </DrawerContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Criar `app/(app)/orcamentos/[projetoId]/orcamentos-list.tsx`**

```typescript
"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { orcamentoStatusLabel, type Orcamento } from "@/lib/types";

export interface OrcamentoRow {
  id: string;
  codigo: string;
  nome: string;
  tipo: string | null;
  status: Orcamento["status"];
  data_fim_prevista: string | null;
  versoes_count: number;
  created_at: string;
}

interface Props {
  projetoId: string;
  orcamentos: OrcamentoRow[];
}

function statusBadgeClasses(status: Orcamento["status"]): string {
  switch (status) {
    case "rascunho": return "bg-muted text-muted-foreground border-border";
    case "em_revisao": return "bg-amber-50 text-amber-700 border-amber-200";
    case "enviado_cliente": return "bg-blue-50 text-blue-700 border-blue-200";
    case "aprovado": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "job_criado": return "bg-california-red/10 text-california-red border-california-red/20";
    case "recusado": return "bg-rose-50 text-rose-700 border-rose-200";
    case "cancelado": return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function OrcamentosList({ projetoId, orcamentos }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 font-semibold">Código</th>
            <th className="px-4 py-3 font-semibold">Nome</th>
            <th className="px-4 py-3 font-semibold">Tipo</th>
            <th className="px-4 py-3 font-semibold">Fim previsto</th>
            <th className="px-4 py-3 font-semibold text-center">Versões</th>
            <th className="px-4 py-3 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {orcamentos.map((o) => (
            <tr
              key={o.id}
              className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer"
              onClick={() => window.location.assign(`/orcamentos/${projetoId}/${o.id}`)}
            >
              <td className="px-4 py-3 font-mono text-xs">
                <Link
                  href={`/orcamentos/${projetoId}/${o.id}`}
                  prefetch={false}
                  className="hover:text-california-red"
                  onClick={(e) => e.stopPropagation()}
                >
                  {o.codigo}
                </Link>
              </td>
              <td className="px-4 py-3 font-medium">{o.nome}</td>
              <td className="px-4 py-3 text-muted-foreground">{o.tipo ?? "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(o.data_fim_prevista)}</td>
              <td className="px-4 py-3 text-center tabular-nums">{o.versoes_count}</td>
              <td className="px-4 py-3">
                <Badge className={cn("border", statusBadgeClasses(o.status))}>
                  {orcamentoStatusLabel(o.status)}
                </Badge>
              </td>
            </tr>
          ))}
          {orcamentos.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                Nenhum orçamento neste projeto ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Criar `app/(app)/orcamentos/[projetoId]/novo/page.tsx`**

```typescript
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { OrcamentoForm } from "../orcamento-form";

export const dynamic = "force-dynamic";

export default async function NovoOrcamentoPage({
  params,
}: {
  params: { projetoId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const { data: projeto } = await supabase
    .from("projetos")
    .select("id, codigo, nome")
    .eq("id", params.projetoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!projeto) notFound();

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link
          href={`/orcamentos/${params.projetoId}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para {projeto.codigo} · {projeto.nome}
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Novo orçamento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O código será gerado no formato{" "}
          <span className="font-mono">{projeto.codigo}-NN</span>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <OrcamentoForm projetoId={params.projetoId} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Deletar arquivos obsoletos**

```bash
git rm "app/(app)/orcamentos/orcamento-form.tsx"
git rm "app/(app)/orcamentos/orcamento-editor-drawer.tsx"
git rm "app/(app)/orcamentos/orcamentos-list.tsx"
```

- [ ] **Step 6: Commit**

```bash
git add app/(app)/orcamentos/[projetoId]/orcamento-form.tsx app/(app)/orcamentos/[projetoId]/orcamento-editor-drawer.tsx app/(app)/orcamentos/[projetoId]/orcamentos-list.tsx app/(app)/orcamentos/[projetoId]/novo/page.tsx
git commit -m "task007: form/drawer/list de orçamento dentro do projeto

- Form sem campos cliente/responsavel/campanha (sobem pro projeto)
- Novo/page.tsx scoped ao projeto (valida existência via notFound)
- Componentes antigos na raiz de /orcamentos foram removidos"
```

---

### Task 13: Página de detalhe do projeto `[projetoId]/page.tsx`

**Files:**
- Create: `app/(app)/orcamentos/[projetoId]/page.tsx`

**Interfaces:**
- Consumes: `Projeto`, `ProjetoEditorDrawer` (Task 7), `OrcamentosList` + `OrcamentoRow` (Task 12), `listActiveMembers`
- Produces: renderiza rota `/orcamentos/[projetoId]` com header + metadata + card de orçamentos

- [ ] **Step 1: Criar `app/(app)/orcamentos/[projetoId]/page.tsx`**

```typescript
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import type { Cliente, Orcamento, Projeto } from "@/lib/types";
import { projetoStatusLabel } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ProjetoEditorDrawer } from "../projeto-editor-drawer";
import { OrcamentosList, type OrcamentoRow } from "./orcamentos-list";

export const dynamic = "force-dynamic";

function projetoBadgeClasses(status: Projeto["status"]): string {
  return status === "ativo"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-100 text-slate-500 border-slate-200";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export default async function ProjetoDetailPage({
  params,
}: {
  params: { projetoId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const [projRes, orcsRes, clientesRes, responsaveis] = await Promise.all([
    supabase
      .from("projetos")
      .select(
        "id, tenant_id, codigo, nome, campanha, status, cliente_id, responsavel_id, data_inicio_prevista, created_by, created_at, updated_at, cliente:clientes(id, nome_fantasia), responsavel:profiles!responsavel_id(id, nome)",
      )
      .eq("id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("orcamentos")
      .select("id, codigo, nome, tipo, status, data_fim_prevista, created_at")
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("clientes")
      .select("id, nome_fantasia, codigo_curto")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    listActiveMembers(session.activeTenant.id),
  ]);

  if (projRes.error) console.error("[projeto.detail]", projRes.error.message);
  const raw = projRes.data as any;
  if (!raw) notFound();

  const projeto: Projeto = {
    id: raw.id,
    tenant_id: raw.tenant_id,
    codigo: raw.codigo,
    nome: raw.nome,
    campanha: raw.campanha,
    status: raw.status,
    cliente_id: raw.cliente_id,
    responsavel_id: raw.responsavel_id,
    data_inicio_prevista: raw.data_inicio_prevista,
    created_by: raw.created_by,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
  const clienteNome: string | null = raw.cliente?.nome_fantasia ?? null;
  const responsavelNome: string | null = raw.responsavel?.nome ?? null;

  const orcamentosBrutos = (orcsRes.data ?? []) as any[];
  const orcamentoIds = orcamentosBrutos.map((o) => o.id);

  // Contagem agregada de versões por orçamento
  const versoesCountMap = new Map<string, number>();
  if (orcamentoIds.length > 0) {
    const { data: versoes } = await supabase
      .from("versoes_orcamento")
      .select("orcamento_id")
      .in("orcamento_id", orcamentoIds)
      .eq("tenant_id", session.activeTenant.id);
    for (const v of ((versoes ?? []) as any[])) {
      versoesCountMap.set(v.orcamento_id, (versoesCountMap.get(v.orcamento_id) ?? 0) + 1);
    }
  }

  const orcamentos: OrcamentoRow[] = orcamentosBrutos.map((o) => ({
    id: o.id,
    codigo: o.codigo,
    nome: o.nome,
    tipo: o.tipo,
    status: o.status as Orcamento["status"],
    data_fim_prevista: o.data_fim_prevista,
    versoes_count: versoesCountMap.get(o.id) ?? 0,
    created_at: o.created_at,
  }));

  const clientes = (clientesRes.data ?? []) as Pick<
    Cliente,
    "id" | "nome_fantasia" | "codigo_curto"
  >[];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Link
          href="/orcamentos"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para projetos
        </Link>

        <div className="mt-3">
          <p className="font-mono text-xs font-semibold text-muted-foreground">
            {projeto.codigo}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{projeto.nome}</h1>
            <Badge className={cn("border", projetoBadgeClasses(projeto.status))}>
              {projetoStatusLabel(projeto.status)}
            </Badge>
            <ProjetoEditorDrawer
              projeto={projeto}
              clientes={clientes}
              responsaveis={responsaveis}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              <span className="text-foreground/60">Cliente:</span>{" "}
              <span className="text-foreground font-medium">{clienteNome ?? "—"}</span>
            </span>
            <span aria-hidden className="text-border">·</span>
            <span>
              <span className="text-foreground/60">Responsável:</span>{" "}
              <span className="text-foreground font-medium">{responsavelNome ?? "—"}</span>
            </span>
            <span aria-hidden className="text-border">·</span>
            <span>
              <span className="text-foreground/60">Início previsto:</span>{" "}
              <span className="text-foreground font-medium">{formatDate(projeto.data_inicio_prevista)}</span>
            </span>
            {projeto.campanha && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>
                  <span className="text-foreground/60">Campanha:</span>{" "}
                  <span className="text-foreground font-medium">{projeto.campanha}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-california-red" />
            <div>
              <h2 className="text-lg font-semibold leading-none tracking-tight">
                Orçamentos do projeto
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Cada orçamento corresponde a um entregável (peça) e gera um job próprio quando aprovado.
              </p>
            </div>
          </div>
          <Link
            href={`/orcamentos/${projeto.id}/novo`}
            prefetch={false}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover transition-all"
          >
            <Plus className="h-4 w-4" />
            Novo orçamento
          </Link>
        </div>
        <div className="p-6">
          <OrcamentosList projetoId={projeto.id} orcamentos={orcamentos} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(app)/orcamentos/[projetoId]/page.tsx
git commit -m "task007: página de detalhe do projeto

- Header com código, nome, badge de status, drawer de edição
- Metadata (cliente, responsável, início, campanha)
- Card 'Orçamentos do projeto' com lista + botão 'Novo orçamento'
- Contagem de versões agregada em query separada (regra performance)"
```

---

### Task 14: Ajustar `versoes/**` (importar/nova/list) pra receber `projetoId`

**Files:**
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/versoes-list.tsx`
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/nova-versao-drawer.tsx`
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/importar-drawer.tsx`
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/importar-actions.ts` (só se ele lê cliente_id de orcamento — verificar; se não, sem mudança)
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/actions.ts` (paths de revalidatePath)
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/page.tsx` (breadcrumb + params)
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/versao-editor-drawer.tsx` (paths se usa router.push)
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/novo-grupo-drawer.tsx` (idem)
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/grupo-card.tsx` (idem)
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/itens-table.tsx` (idem)
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/totais-card.tsx` (só se lê params)

**Interfaces:**
- Consumes: `params.projetoId`, `params.orcId`, `params.versaoId` (Next.js dynamic route)
- Produces: componentes movidos funcionam no novo path e recebem `projetoId` quando precisam navegar/revalidate

- [ ] **Step 1: Ler cada arquivo e listar as ocorrências de `params.id` ou `/orcamentos/${...}/`**

Executar:

```bash
git grep -n "params\.id\|/orcamentos/\${" "app/(app)/orcamentos/[projetoId]/[orcId]/"
```

Rebrand cada ocorrência:
- `params.id` (no versaoId page) → `params.orcId`
- `` `/orcamentos/${orcamentoId}` `` → `` `/orcamentos/${projetoId}/${orcamentoId}` ``
- `revalidatePath("/orcamentos/${orcamentoId}")` → `revalidatePath("/orcamentos/${projetoId}/${orcamentoId}")`
- Se o drawer/list aceita `orcamentoId` como prop, adicionar `projetoId` como prop obrigatória

- [ ] **Step 2: `versoes-list.tsx` — add `projetoId` prop, ajusta Links**

Alterar `interface Props`:
```typescript
interface Props {
  projetoId: string;  // NOVO
  orcamentoId: string;
  versoes: VersaoRow[];
}
```

Trocar todos os `<Link href={\`/orcamentos/${orcamentoId}/versoes/...\`}>` por `<Link href={\`/orcamentos/${projetoId}/${orcamentoId}/versoes/...\`} prefetch={false}>`.

O `onClick` do row (linha clicável) também: `window.location.assign(\`/orcamentos/${projetoId}/${orcamentoId}/versoes/${v.id}\`)`.

- [ ] **Step 3: `nova-versao-drawer.tsx` — add `projetoId` prop**

```typescript
interface Props {
  projetoId: string;  // NOVO
  orcamentoId: string;
  disabled?: boolean;
  disabledReason?: string;
}
```

Onde tiver navigation (`router.push(\`/orcamentos/${orcamentoId}/versoes/${id}\`)`), trocar por incluir projetoId.

- [ ] **Step 4: `importar-drawer.tsx` — mesma coisa**

Add `projetoId` prop e passa adiante.

- [ ] **Step 5: `versoes/actions.ts` e `versoes/importar-actions.ts` — ajustar revalidatePath**

Cada `revalidatePath(\`/orcamentos/${orcamentoId}\`)` vira algo que precisa do projetoId. Como a action ainda recebe só `orcamentoId`, buscar o `projeto_id` da tabela orçamentos:

```typescript
// No começo da action, depois de requireSession e antes de qualquer update:
const { data: orc } = await supabase
  .from("orcamentos")
  .select("projeto_id")
  .eq("id", orcamentoId)
  .eq("tenant_id", session.activeTenant.id)
  .maybeSingle<{ projeto_id: string }>();
const projetoId = orc?.projeto_id;

// Depois do update:
revalidatePath(`/orcamentos/${projetoId}`);
revalidatePath(`/orcamentos/${projetoId}/${orcamentoId}`);
```

Isso vale pra TODAS as actions em `versoes/actions.ts` e `versoes/importar-actions.ts` que usam `revalidatePath`.

- [ ] **Step 6: `versoes/[versaoId]/page.tsx` — trocar params.id e breadcrumb**

O signature vira:
```typescript
export default async function VersaoDetailPage({
  params,
}: {
  params: { projetoId: string; orcId: string; versaoId: string };
}) {
```

Toda referência a `params.id` → `params.orcId`.
Breadcrumb "Voltar para orçamento" → `href={\`/orcamentos/${params.projetoId}/${params.orcId}\`}`.

- [ ] **Step 7: Componentes internos da versão (grupo-card, novo-grupo-drawer, itens-table, versao-editor-drawer, totais-card)**

Grep por `params.id`, `router.push` e revalidatePath — em cada arquivo:
- Adicionar `projetoId?: string` ou passar via props do parent
- Ajustar router paths pra incluir projetoId

Se algum componente recebe params via prop, adicionar `projetoId`. Se acessa via `useParams()`, mudar pra `useParams<{ projetoId: string; orcId: string; versaoId: string }>()`.

- [ ] **Step 8: Verificar com tsc**

```bash
npm run typecheck
```

Corrigir todos os erros de type que apareçam. Alguns esperados:
- Referências a `Orcamento.cliente_id` que sobraram — remover
- Props não passadas em componentes que ganharam `projetoId`

- [ ] **Step 9: Commit**

```bash
git add app/(app)/orcamentos/[projetoId]/[orcId]/versoes/
git commit -m "task007: adapta versões — props ganham projetoId + paths aninhados

- versoes-list, nova-versao-drawer, importar-drawer recebem projetoId
- actions (versoes/actions.ts + importar-actions.ts) resolvem projetoId a partir do orçamento
- versaoId/page.tsx usa params.orcId + params.projetoId + breadcrumb ajustado
- Todos os revalidatePath incluem projetoId no path"
```

---

### Task 15: Cliente ganha `codigo_curto` na UI (form + list)

**Files:**
- Modify: `app/(app)/cadastros/clientes/cliente-form.tsx`
- Modify: `app/(app)/cadastros/clientes/clientes-list.tsx`

**Interfaces:**
- Consumes: `Cliente.codigo_curto` (Task 2), `clienteSchema` com codigo_curto (Task 3)
- Produces: campo `codigo_curto` no formulário, coluna "Código" na listagem

- [ ] **Step 1: Adicionar input `codigo_curto` em `cliente-form.tsx`**

Localizar o `Field label="Nome fantasia"` e adicionar logo depois:

```typescript
<Field label="Código curto" name="codigo_curto" required errors={fieldErrors}>
  <Input
    name="codigo_curto"
    defaultValue={cliente?.codigo_curto ?? ""}
    required
    placeholder="Ex.: AMB, COCA"
    maxLength={6}
    style={{ textTransform: "uppercase" }}
    className="uppercase"
  />
  <p className="mt-1 text-xs text-muted-foreground">
    2 a 6 letras. Usado como prefixo do código dos projetos deste cliente.
  </p>
</Field>
```

- [ ] **Step 2: Adicionar coluna "Código" em `clientes-list.tsx`**

Localizar a linha `<th ... >Nome fantasia</th>` no `thead` e adicionar depois:

```typescript
<th className="px-4 py-3 font-semibold">Código</th>
```

No `tbody`, adicionar a célula correspondente logo depois da célula de nome fantasia:

```typescript
<td className="px-4 py-3 font-mono text-xs text-muted-foreground">
  {c.codigo_curto}
</td>
```

- [ ] **Step 3: Commit**

```bash
git add app/(app)/cadastros/clientes/cliente-form.tsx app/(app)/cadastros/clientes/clientes-list.tsx
git commit -m "task007: cliente ganha codigo_curto (form + coluna na lista)"
```

---

### Task 16: Verificação final — typecheck, lint, aplicar migration em prod

**Files:** nenhum modificado

**Interfaces:** consuma `mcp__supabase-write__apply_migration` (MCP)

- [ ] **Step 1: Rodar typecheck**

```bash
npm run typecheck
```

Esperado: `exit 0`, sem erros. Se aparecerem erros, corrigir e re-commitar antes de seguir.

- [ ] **Step 2: Rodar lint**

```bash
npm run lint
```

Esperado: `exit 0`. Warnings de ESLint são OK; erros não.

- [ ] **Step 3: Aplicar migration em prod via MCP**

Chamar `mcp__supabase-write__apply_migration` com:
- `name`: `"task007_projetos"`
- `query`: conteúdo integral de `supabase/migrations/20260728000002_task007_projetos.sql`

Verificar que retorna sucesso.

- [ ] **Step 4: Smoke SQL — verificar backfill**

Chamar `mcp__supabase__execute_sql` com:

```sql
select p.codigo, p.nome, c.nome_fantasia, c.codigo_curto,
       (select count(*) from public.orcamentos o where o.projeto_id = p.id) as orcamentos_count
  from public.projetos p
  join public.clientes c on c.id = p.cliente_id
 order by p.created_at;
```

Esperado: 1 linha, projeto "teste", cliente "Pevetech", `codigo_curto = 'PEVETE'` (6 primeiras letras) ou similar, `orcamentos_count = 2`.

- [ ] **Step 5: Smoke SQL — verificar orçamentos**

```sql
select codigo, nome, projeto_id from public.orcamentos order by created_at;
```

Esperado: 2 orçamentos, ambos com `projeto_id` preenchido apontando pro projeto "teste".

- [ ] **Step 6: Smoke SQL — verificar que colunas antigas sumiram**

```sql
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'orcamentos'
   and column_name in ('cliente_id', 'responsavel_id', 'campanha');
```

Esperado: **zero linhas** (colunas foram removidas com sucesso).

- [ ] **Step 7: Rodar `npm run dev` e validar manualmente**

```bash
npm run dev
```

Testar em navegador (http://localhost:3000):

1. Login com antonio@pevetech.com.br
2. Clicar em "Orçamentos" na sidebar → deve cair na **lista de projetos** (1 linha: "teste")
3. Clicar no projeto → detalhe do projeto (2 orçamentos listados)
4. Clicar num orçamento → detalhe do orçamento (versões listadas)
5. Clicar numa versão → detalhe da versão (grupos/itens)
6. Voltar até projetos via breadcrumbs
7. Criar novo projeto: clicar "Novo projeto" → escolher cliente (Pevetech), responsável, data → salvar → conferir código `PEVETE-0002/26` (ou similar, dependendo do codigo_curto real)
8. Criar novo orçamento dentro do projeto novo: "Novo orçamento" → nome+datas+tipo → salvar → conferir código `PEVETE-0002/26-01`
9. Ir em Cadastros → Clientes → editar Pevetech: mudar `codigo_curto` pra `AMB` → salvar
10. Voltar em Orçamentos: projetos existentes mantêm código antigo, mas novos vão usar `AMB-...`
11. Arquivar o projeto "teste" (drawer → Arquivar) → tentativa deve ser **bloqueada** com mensagem "Cancele os orçamentos antes de arquivar"

- [ ] **Step 8: Se tudo passar, commit final de cleanup (se houver ajustes)**

Se algum ajuste for necessário durante QA:

```bash
git add -A
git commit -m "task007: fixes pós-QA manual"
```

Se nada precisou de ajuste, pular este step.

- [ ] **Step 9: Atualizar HANDOFF.md**

Adicionar seção no topo (após a Última atualização) mencionando Task 007 aplicada. Modificar `docs/HANDOFF.md` linha ~5:

```markdown
**Última atualização** (2026-07-28): Task 007 — Projetos como guarda-chuva de orçamentos. Nova tabela `projetos` entre cliente e orçamento. Cliente ganha `codigo_curto`. Rotas reestruturadas pra `/orcamentos/[projetoId]/[orcId]/[versaoId]`. Backfill criou 1 projeto "teste" agrupando os 2 orçamentos existentes.
```

E adicionar a migration na lista da seção 1:

```
20260728000002  task007_projetos
```

- [ ] **Step 10: Commit final do HANDOFF**

```bash
git add docs/HANDOFF.md
git commit -m "docs(handoff): registra Task 007 (projetos) aplicada"
```

---

## Self-Review — Checklist Post-Plan

### 1. Cobertura da spec

Percorrer cada seção da spec e apontar a task correspondente:

| Seção spec | Task |
|---|---|
| §4.1 clientes.codigo_curto | Task 1 (migration), Task 2 (types), Task 3 (validation), Task 15 (UI) |
| §4.2 projeto_status enum + tabela projetos | Task 1 |
| §4.3 orcamentos.projeto_id + DROPs | Task 1 |
| §4.4 coerência tenant_id via server actions | Task 6, Task 11 |
| §5.1 CRUD projetos | Task 6 |
| §5.1 CRUD orçamentos escopado | Task 11 |
| §5.2 gerarCodigoProjeto | Task 5 |
| §5.2 gerarCodigoOrcamento | Task 5 |
| §5.3 embeds via projeto | Task 10, Task 13 |
| §6 Types Projeto + mutações | Task 2 |
| §7 Reestruturação de rotas | Task 9, Task 10, Task 13, Task 12 |
| §7 Breadcrumbs | Task 10, Task 12 (novo/page), Task 13 |
| §7 projetos-list, projeto-form, projeto-editor-drawer | Task 7 |
| §7 Cliente ganha codigo_curto na UI | Task 15 |
| §8 Zod schemas | Task 3 |
| §9 Auditoria projeto.* | Task 4 (definição) + Task 6 (uso) |
| §10 Performance (prefetch/agregação/Promise.all) | Task 7 (list), Task 8 (page.tsx), Task 13 |
| §11 Casos borda (arquivar bloqueado, cliente imutável) | Task 6 (arquivarProjeto), Task 15 (form permite editar codigo_curto) |
| §12 Testes/validação | Task 16 |
| §13 Arquivos afetados | Tasks 1-15 (cada arquivo em ao menos 1 task) |
| §14 Sequência de commits | Cada task tem 1 commit |
| §15 Rollback | Documentado na spec — não vira task |
| §16 Fora de escopo | Não vira task |

**Sem lacunas.**

### 2. Placeholder scan

Percorri o plano: nenhum "TBD", "TODO", "implementar depois", "handle errors" genérico. Cada step tem código concreto ou comando exato.

### 3. Consistência de tipos

- `ProjetoRow` (Task 7) usa `orcamentos_count` — mesma prop consumida em Task 8 ao popular a lista ✅
- `OrcamentoRow` (Task 12) usa `versoes_count` — mesma prop consumida em Task 13 ✅
- `ProjetoForm` (Task 7) recebe `clientes: Pick<Cliente, "id" | "nome_fantasia" | "codigo_curto">[]` — Task 8 e Task 13 buscam esses 3 campos ✅
- `OrcamentoEditorDrawer` (Task 12) recebe `projetoId` — Task 10 passa `projetoId={params.projetoId}` ✅
- `NovaVersaoDrawer`, `ImportarPlanilhaDrawer`, `VersoesList` — Task 10 já passa `projetoId`; Task 14 adapta os componentes pra receber ✅
- `criarOrcamento` em Task 11 recebe `(projetoId, formData)` — Task 12 chama com essa assinatura ✅
- `atualizarOrcamento` em Task 11 recebe `(projetoId, orcId, formData)` — Task 12 chama com essa assinatura ✅
- Types `Projeto` (Task 2) usados em Task 6, 7, 8, 10, 13 — todos concordam com a shape declarada ✅

**Nenhuma inconsistência.**

---

## Verificação final (executada só na Task 16)

```bash
npm run typecheck   # exit 0
npm run lint        # exit 0
npm run dev         # smoke manual conforme Task 16 Step 7
```

Migration remota aplicada via MCP `mcp__supabase-write__apply_migration`.
