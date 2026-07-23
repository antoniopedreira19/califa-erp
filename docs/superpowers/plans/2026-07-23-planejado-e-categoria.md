# PLANEJADO + CATEGORIA na versão do orçamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar visão PLANEJADO no item (valor unit, qtd, dias/meses, total) e campo CATEGORIA por versão, com auto-preenchimento no import da planilha padrão e cálculo de rentabilidade orçado − planejado.

**Architecture:** Nova tabela `versoes_orcamento_categorias` espelhando o padrão de `versoes_orcamento_grupos` (escopo por versão). `versoes_orcamento_itens` ganha FK `categoria_id` + 4 colunas de planejado (3 valores + 1 GENERATED). Parser lê col B (categoria) e cols I-K (planejado). UI ganha botão "Nova categoria", drawer de item com dropdown de categoria + bloco planejado, tabela de itens com colunas planejadas + coluna rentabilidade, card de totais com rentab. Duplicar versão passa a copiar categorias + planejado.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase Postgres/RLS, `@supabase/ssr`, ExcelJS, Radix + Tailwind, Zod, React Hook Form (via helpers próprios).

## Global Constraints

- Sem framework de testes automatizados no projeto — verificação via `npx tsc --noEmit` + `npx next lint` + smoke test manual em `npm run dev` + queries via MCP Supabase para validar SQL.
- **RLS ≠ GRANT** (lição da Task 001, memória do projeto): toda tabela nova precisa de `GRANT select, insert, update, delete ON ... TO authenticated`. `service_role` coberto por `ALTER DEFAULT PRIVILEGES` da migration `20260725000001`.
- Migration aplicada via `mcp__supabase-write__apply_migration` antes de escrever código que usa novas colunas.
- Nome da migration: `20260728000001_task004_categoria_e_planejado`.
- Types importados de `@/lib/types` — atualizar lá primeiro.
- `total_planejado` é GENERATED — nunca escrever direto; sempre vem do banco como number.
- Colunas numéricas do Postgres voltam como string em `@supabase/supabase-js` — sempre converter com `Number(...)`.
- Constraints de orçado permanecem `> 0`; planejado usa `>= 0` (default = "não planejado ainda").
- Regra UX (memória `feedback_ui_linha_clicavel.md`): novas listas seguem o padrão de linha clicável com `stopPropagation` nas ações.
- Regra RLS `is_tenant_member(tenant_id)` — mesmas policies do padrão de grupos.
- Todos os campos numéricos em input devem usar `className="no-spinner"` (utility já existente).
- Rentabilidade calculada só no client, nunca persistida.

## File Structure

**Criar:**
- `supabase/migrations/20260728000001_task004_categoria_e_planejado.sql` — DDL da nova tabela, colunas planejadas, RLS, GRANTs.
- `lib/validations/categorias.ts` — schema Zod da categoria (espelha `grupos.ts`).
- `app/(app)/orcamentos/[id]/versoes/[versaoId]/nova-categoria-drawer.tsx` — drawer com um único campo (nome).

**Modificar:**
- `lib/types.ts` — adicionar `VersaoOrcamentoCategoria` + campos novos em `VersaoOrcamentoItem`.
- `lib/validations/itens.ts` — estender `itemSchema` com `categoria_id` + campos planejados.
- `app/(app)/orcamentos/[id]/versoes/actions.ts` — server actions de categoria + item ampliado + duplicarVersao atualizado.
- `lib/importacao/parser-oficial.ts` — parser lê col B (categoria) e cols I-K (planejado).
- `app/(app)/orcamentos/[id]/versoes/importar-actions.ts` — cria categorias e usa planejado no confirmarImportacao.
- `app/(app)/orcamentos/[id]/versoes/[versaoId]/page.tsx` — carrega categorias e passa aos filhos.
- `app/(app)/orcamentos/[id]/versoes/[versaoId]/grupo-card.tsx` — passa categorias para tabela de itens.
- `app/(app)/orcamentos/[id]/versoes/[versaoId]/itens-table.tsx` — colunas planejadas + rentab + categoria (badge).
- `app/(app)/orcamentos/[id]/versoes/[versaoId]/item-editor-drawer.tsx` — dropdown de categoria + bloco planejado.
- `app/(app)/orcamentos/[id]/versoes/[versaoId]/totais-card.tsx` — total planejado + rentab + % rentab.
- `lib/calculos/versao-totais.ts` — helper novo `calcularTotaisPlanejados` (soma total_planejado por item, rentabilidade).

---

## Task 1: Migration — nova tabela e colunas planejadas

**Files:**
- Create: `supabase/migrations/20260728000001_task004_categoria_e_planejado.sql`

**Interfaces:**
- Consumes: nada (fundação).
- Produces: tabela `versoes_orcamento_categorias` (id, tenant_id, versao_orcamento_id, nome, timestamps), colunas em `versoes_orcamento_itens` (`categoria_id uuid`, `valor_unitario_planejado numeric(14,2)`, `quantidade_planejada numeric(12,3)`, `dias_meses_planejado numeric(12,3)`, `total_planejado numeric(18,2) GENERATED`).

- [ ] **Step 1: Criar arquivo SQL da migration**

Cria `supabase/migrations/20260728000001_task004_categoria_e_planejado.sql`:

```sql
-- =====================================================================
-- Task 004 fase G — Categoria por versão + visão PLANEJADO no item
-- Ver spec: docs/superpowers/specs/2026-07-23-planejado-e-categoria-design.md
-- =====================================================================

-- 1. Tabela versoes_orcamento_categorias (mesmo padrão de _grupos)
create table if not exists public.versoes_orcamento_categorias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  versao_orcamento_id uuid not null references public.versoes_orcamento(id) on delete cascade,
  nome text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categorias_nome_nao_vazio check (length(trim(nome)) > 0)
);

create unique index if not exists uniq_categoria_nome_por_versao
  on public.versoes_orcamento_categorias(tenant_id, versao_orcamento_id, lower(nome));

create index if not exists idx_categorias_tenant on public.versoes_orcamento_categorias(tenant_id);
create index if not exists idx_categorias_versao on public.versoes_orcamento_categorias(versao_orcamento_id);

drop trigger if exists trg_categorias_updated_at on public.versoes_orcamento_categorias;
create trigger trg_categorias_updated_at
before update on public.versoes_orcamento_categorias
for each row execute function public.set_updated_at();

-- 2. RLS categorias — mesmo padrão dos grupos
alter table public.versoes_orcamento_categorias enable row level security;

drop policy if exists categorias_select on public.versoes_orcamento_categorias;
create policy categorias_select on public.versoes_orcamento_categorias
for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists categorias_insert on public.versoes_orcamento_categorias;
create policy categorias_insert on public.versoes_orcamento_categorias
for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists categorias_update on public.versoes_orcamento_categorias;
create policy categorias_update on public.versoes_orcamento_categorias
for update to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

drop policy if exists categorias_delete on public.versoes_orcamento_categorias;
create policy categorias_delete on public.versoes_orcamento_categorias
for delete to authenticated using (public.is_tenant_member(tenant_id));

-- 3. GRANTs authenticated (service_role coberto por ALTER DEFAULT PRIVILEGES)
grant select, insert, update, delete on public.versoes_orcamento_categorias to authenticated;

-- 4. Colunas planejadas + categoria_id em versoes_orcamento_itens
alter table public.versoes_orcamento_itens
  add column if not exists categoria_id uuid
    references public.versoes_orcamento_categorias(id) on delete set null;

alter table public.versoes_orcamento_itens
  add column if not exists valor_unitario_planejado numeric(14, 2) not null default 0;

alter table public.versoes_orcamento_itens
  add column if not exists quantidade_planejada numeric(12, 3) not null default 0;

alter table public.versoes_orcamento_itens
  add column if not exists dias_meses_planejado numeric(12, 3) not null default 0;

alter table public.versoes_orcamento_itens
  add column if not exists total_planejado numeric(18, 2) generated always as (
    coalesce(valor_unitario_planejado, 0)
    * coalesce(quantidade_planejada, 0)
    * coalesce(dias_meses_planejado, 0)
  ) stored;

create index if not exists idx_itens_categoria on public.versoes_orcamento_itens(categoria_id);

-- 5. Constraints do planejado (permitem 0 — "não planejado ainda")
alter table public.versoes_orcamento_itens
  drop constraint if exists itens_planejado_valor_nao_negativo;
alter table public.versoes_orcamento_itens
  add constraint itens_planejado_valor_nao_negativo check (valor_unitario_planejado >= 0);

alter table public.versoes_orcamento_itens
  drop constraint if exists itens_planejado_qtd_nao_negativa;
alter table public.versoes_orcamento_itens
  add constraint itens_planejado_qtd_nao_negativa check (quantidade_planejada >= 0);

alter table public.versoes_orcamento_itens
  drop constraint if exists itens_planejado_dm_nao_negativo;
alter table public.versoes_orcamento_itens
  add constraint itens_planejado_dm_nao_negativo check (dias_meses_planejado >= 0);
```

- [ ] **Step 2: Aplicar migration via MCP**

Ferramenta: `mcp__supabase-write__apply_migration`
Args:
- `name`: `task004_categoria_e_planejado`
- `query`: cole o conteúdo do SQL acima **sem** o cabeçalho de comentários (só a partir do primeiro `create table`).

Esperado: `{"success":true}`.

- [ ] **Step 3: Validar estrutura via MCP**

Executar via `mcp__supabase-write__execute_sql`:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'versoes_orcamento_itens'
  and column_name in ('categoria_id', 'valor_unitario_planejado',
                      'quantidade_planejada', 'dias_meses_planejado',
                      'total_planejado')
order by ordinal_position;
```

Esperado: 5 linhas, `total_planejado` com data_type = `numeric` (GENERATED aparece em outra column_default view mas a listagem básica confirma existência).

Confirmar tabela nova:
```sql
select count(*) from public.versoes_orcamento_categorias;
```
Esperado: 0.

- [ ] **Step 4: Testar RLS + policy simulando antonio**

```sql
set local role authenticated;
set local "request.jwt.claim.sub" = 'ba2e2ba1-1ba0-4e3d-99de-5d9d89877381';
select count(*) from public.versoes_orcamento_categorias;
```
Esperado: 0 (sem erro de permissão — GRANT + RLS ok).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260728000001_task004_categoria_e_planejado.sql
git commit -m "Task 004 fase G: migration categoria por versão + planejado

Adiciona versoes_orcamento_categorias (escopo por versão, mesmo padrão de
grupos) e colunas planejadas em versoes_orcamento_itens (categoria_id +
valor/qtd/dm planejados + total_planejado GENERATED).

Constraints de planejado usam >= 0 (default = não planejado ainda).
Ver spec: docs/superpowers/specs/2026-07-23-planejado-e-categoria-design.md"
```

---

## Task 2: Types compartilhados

**Files:**
- Modify: `lib/types.ts`

**Interfaces:**
- Consumes: nomes de colunas da Task 1.
- Produces:
  - `VersaoOrcamentoCategoria` (id, tenant_id, versao_orcamento_id, nome, created_at, updated_at).
  - `VersaoOrcamentoItem` ganha `categoria_id: string | null`, `valor_unitario_planejado: number`, `quantidade_planejada: number`, `dias_meses_planejado: number`, `total_planejado: number`.

- [ ] **Step 1: Adicionar VersaoOrcamentoCategoria em lib/types.ts**

Encontrar o bloco `// ---------- Task 004: versões e itens ----------` e após `VersaoOrcamentoGrupo`, adicionar:

```ts
export interface VersaoOrcamentoCategoria {
  id: string;
  tenant_id: string;
  versao_orcamento_id: string;
  nome: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Adicionar campos na interface VersaoOrcamentoItem**

Localizar a interface `VersaoOrcamentoItem` e adicionar (após `total_orcado`, antes de `fornecedor_id`):

```ts
  /** Categoria (opcional). Vive por versão, criada via botão "Nova
   *  categoria" ou auto-preenchida pelo import da col B da planilha. */
  categoria_id: string | null;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
  total_planejado: number;
```

- [ ] **Step 3: Verificar tsc**

Run: `npx tsc --noEmit`
Expected: erros vão aparecer nos lugares que criam objetos `VersaoOrcamentoItem` — vamos consertar nas tasks seguintes. Anotar os arquivos que falharam.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "types: categoria por versão + campos planejados no item"
```

---

## Task 3: Schema Zod da categoria

**Files:**
- Create: `lib/validations/categorias.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `categoriaSchema` (nome trim min 1 max 120), tipo `CategoriaInput`.

- [ ] **Step 1: Criar lib/validations/categorias.ts**

```ts
import { z } from "zod";

/**
 * Schema de categoria de versão de orçamento. Mesmo padrão de grupos:
 * nome não vazio, trim, tamanho razoável.
 */
export const categoriaSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome da categoria.")
    .max(120, "Máximo 120 caracteres."),
});

export type CategoriaInput = z.infer<typeof categoriaSchema>;
```

- [ ] **Step 2: Verificar tsc**

Run: `npx tsc --noEmit lib/validations/categorias.ts` (ou o comando full, ignorando erros de outros arquivos).
Expected: sem erros no arquivo novo.

- [ ] **Step 3: Commit**

```bash
git add lib/validations/categorias.ts
git commit -m "validations: schema Zod de categoria"
```

---

## Task 4: Schema Zod do item — planejado + categoria_id

**Files:**
- Modify: `lib/validations/itens.ts`

**Interfaces:**
- Consumes: `TipoCusto` de `@/lib/types`.
- Produces: `itemSchema` estendido com `categoria_id` (uuid opcional, aceita null/vazio), `valor_unitario_planejado` (default 0, `>= 0`), `quantidade_planejada` (default 0, `>= 0`), `dias_meses_planejado` (default 0, `>= 0`).

- [ ] **Step 1: Ler arquivo atual**

Run: `Read lib/validations/itens.ts`
Anotar como valor_unitario_orcado etc. são tipados (referência para o padrão).

- [ ] **Step 2: Estender itemSchema**

No fim da definição de `itemSchema`, antes do `})` de fechamento, adicionar:

```ts
  categoria_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  valor_unitario_planejado: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? Number(v.replace(",", ".")) : 0))
    .refine((n) => Number.isFinite(n) && n >= 0, "Valor planejado inválido."),
  quantidade_planejada: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? Number(v.replace(",", ".")) : 0))
    .refine((n) => Number.isFinite(n) && n >= 0, "Quantidade planejada inválida."),
  dias_meses_planejado: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? Number(v.replace(",", ".")) : 0))
    .refine((n) => Number.isFinite(n) && n >= 0, "Dias/meses planejado inválido."),
```

**Nota:** se o `itemSchema` atual usa `z.coerce.number()` ou outro padrão, adaptar as 3 novas linhas para casar com esse padrão em vez do transform acima. Copiar exatamente o estilo das colunas orçadas equivalentes.

- [ ] **Step 3: Verificar tsc/lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: sem novos erros no schema.

- [ ] **Step 4: Commit**

```bash
git add lib/validations/itens.ts
git commit -m "validations: item aceita categoria_id + campos planejados"
```

---

## Task 5: Server actions de categoria (CRUD)

**Files:**
- Modify: `app/(app)/orcamentos/[id]/versoes/actions.ts`

**Interfaces:**
- Consumes: `categoriaSchema`, `requireSession`, `createClient`, `logAuditEvent`.
- Produces:
  - `criarCategoria(versaoId: string, formData: FormData): Promise<ActionResult>`
  - `renomearCategoria(categoriaId: string, formData: FormData): Promise<ActionResult>`
  - `removerCategoria(categoriaId: string): Promise<ActionResult>` — antes de deletar, faz UPDATE em `versoes_orcamento_itens` setando `categoria_id = null` para itens dessa categoria (evita quebrar FK ON DELETE SET NULL... na verdade o SET NULL já cuida, mas fazemos update explícito pra auditoria clara).

- [ ] **Step 1: Ler bloco de grupos como referência**

Run: `Read app/(app)/orcamentos/[id]/versoes/actions.ts` — localizar a seção `// ============================================================\n// GRUPOS\n// ============================================================` e ler helpers (`loadVersaoParaGrupo`, `proximaOrdemGrupo`, `mapGrupoDbError`) e ações (`criarGrupo`, `renomearGrupo`, `removerGrupo`).

- [ ] **Step 2: Adicionar import do schema**

No topo do arquivo, junto com os outros imports de `@/lib/validations/*`, adicionar:

```ts
import { categoriaSchema } from "@/lib/validations/categorias";
```

- [ ] **Step 3: Adicionar seção CATEGORIAS logo após GRUPOS**

Depois do `removerGrupo` e antes de `// ITENS`, adicionar:

```ts
// ============================================================
// CATEGORIAS (mesmo padrão de GRUPOS)
// ============================================================

function mapCategoriaDbError(msg: string): string {
  if (msg.includes("uniq_categoria_nome_por_versao")) {
    return "Já existe uma categoria com esse nome nesta versão.";
  }
  if (msg.includes("categorias_nome_nao_vazio")) {
    return "Nome da categoria não pode ficar vazio.";
  }
  return "Não foi possível salvar a categoria.";
}

export async function criarCategoria(
  versaoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = categoriaSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Nome inválido.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const versao = await loadVersaoParaGrupo(versaoId, session.activeTenant.id);
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return {
      ok: false,
      message: "Versão aprovada não aceita novas categorias.",
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("versoes_orcamento_categorias")
    .insert({
      tenant_id: session.activeTenant.id,
      versao_orcamento_id: versaoId,
      nome: parsed.data.nome,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[categorias.criar]", error.message);
    return { ok: false, message: mapCategoriaDbError(error.message) };
  }

  revalidatePath(`/orcamentos/${versao.orcamento_id}/versoes/${versaoId}`);
  return { ok: true, id: data.id };
}

export async function renomearCategoria(
  categoriaId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = categoriaSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Nome inválido.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data: categoria } = await supabase
    .from("versoes_orcamento_categorias")
    .select("versao_orcamento_id")
    .eq("id", categoriaId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ versao_orcamento_id: string }>();

  if (!categoria) return { ok: false, message: "Categoria não encontrada." };

  const versao = await loadVersaoParaGrupo(
    categoria.versao_orcamento_id,
    session.activeTenant.id,
  );
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return {
      ok: false,
      message: "Versão aprovada não permite renomear categoria.",
    };
  }

  const { error } = await supabase
    .from("versoes_orcamento_categorias")
    .update({ nome: parsed.data.nome })
    .eq("id", categoriaId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[categorias.renomear]", error.message);
    return { ok: false, message: mapCategoriaDbError(error.message) };
  }

  revalidatePath(
    `/orcamentos/${versao.orcamento_id}/versoes/${categoria.versao_orcamento_id}`,
  );
  return { ok: true, id: categoriaId };
}

export async function removerCategoria(
  categoriaId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: categoria } = await supabase
    .from("versoes_orcamento_categorias")
    .select("versao_orcamento_id")
    .eq("id", categoriaId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ versao_orcamento_id: string }>();

  if (!categoria) return { ok: false, message: "Categoria não encontrada." };

  const versao = await loadVersaoParaGrupo(
    categoria.versao_orcamento_id,
    session.activeTenant.id,
  );
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return {
      ok: false,
      message: "Versão aprovada não permite remover categoria.",
    };
  }

  // Diferente de grupo: itens NÃO exigem categoria (opcional).
  // FK ON DELETE SET NULL cuida do rebaixamento — nada a fazer antes.
  const { error } = await supabase
    .from("versoes_orcamento_categorias")
    .delete()
    .eq("id", categoriaId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[categorias.remover]", error.message);
    return { ok: false, message: "Não foi possível remover a categoria." };
  }

  revalidatePath(
    `/orcamentos/${versao.orcamento_id}/versoes/${categoria.versao_orcamento_id}`,
  );
  return { ok: true, id: categoriaId };
}
```

- [ ] **Step 4: Verificar tsc/lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: verde nas 3 novas funções.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/orcamentos/[id]/versoes/actions.ts
git commit -m "actions: CRUD de categoria por versão"
```

---

## Task 6: Server actions — item ampliado com planejado + categoria

**Files:**
- Modify: `app/(app)/orcamentos/[id]/versoes/actions.ts` (funções `extractItemInput`, `adicionarItem`, `atualizarItem`).

**Interfaces:**
- Consumes: `itemSchema` estendido (Task 4).
- Produces: `adicionarItem` e `atualizarItem` passam a persistir `categoria_id` e os 3 campos planejados.

- [ ] **Step 1: Estender extractItemInput**

Localizar `function extractItemInput(formData: FormData)`. Adicionar aos campos retornados:

```ts
    categoria_id: (formData.get("categoria_id")?.toString() || "") || null,
    valor_unitario_planejado:
      formData.get("valor_unitario_planejado")?.toString() ?? "0",
    quantidade_planejada:
      formData.get("quantidade_planejada")?.toString() ?? "0",
    dias_meses_planejado:
      formData.get("dias_meses_planejado")?.toString() ?? "0",
```

- [ ] **Step 2: Verificar que o insert/update propaga**

Como `adicionarItem` e `atualizarItem` já espalham `...parsed.data`, os campos novos (que agora fazem parte do schema Zod da Task 4) vão automaticamente pro Supabase. Confirmar via `Read` que a linha `.insert({ ...parsed.data, tenant_id, versao_orcamento_id, grupo_id, ordem })` está presente.

- [ ] **Step 3: Verificar tsc/lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: verde.

- [ ] **Step 4: Testar via MCP simulando antonio**

Precisa da versão real. Descobrir id:
```sql
select id from public.versoes_orcamento
where orcamento_id = (select id from public.orcamentos where codigo = 'ORC-0001')
order by numero_versao desc limit 1;
```

E um grupo dessa versão:
```sql
select id from public.versoes_orcamento_grupos
where versao_orcamento_id = '<id_da_versao>' limit 1;
```

Simular inserção de item com planejado:
```sql
set local role authenticated;
set local "request.jwt.claim.sub" = 'ba2e2ba1-1ba0-4e3d-99de-5d9d89877381';
insert into public.versoes_orcamento_itens(
  tenant_id, versao_orcamento_id, grupo_id, ordem, item, tipo_custo,
  valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
  valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
) values (
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
  '<id_da_versao>',
  '<id_do_grupo>',
  9999, 'ITEM DE TESTE', 'A',
  100.00, 2, 3,
  80.00, 2, 3
) returning id, total_orcado, total_planejado;
```

Esperado: total_orcado = 600.00, total_planejado = 480.00.

Deletar item de teste:
```sql
delete from public.versoes_orcamento_itens where item = 'ITEM DE TESTE';
```

- [ ] **Step 5: Commit**

```bash
git add app/(app)/orcamentos/[id]/versoes/actions.ts
git commit -m "actions: adicionarItem/atualizarItem persistem categoria e planejado"
```

---

## Task 7: duplicarVersao — copia categorias e planejado

**Files:**
- Modify: `app/(app)/orcamentos/[id]/versoes/actions.ts` (`duplicarVersao`).

**Interfaces:**
- Consumes: bagagem de sessão + tenant.
- Produces: duplicação também traz categorias (com map old→new id) e valores planejados dos itens.

- [ ] **Step 1: Ler duplicarVersao atual**

Run: `Read app/(app)/orcamentos/[id]/versoes/actions.ts` — localizar `export async function duplicarVersao`.

- [ ] **Step 2: Adicionar duplicação de categorias antes dos itens**

Após o bloco que duplica grupos (`grupoMap.set(...)` e insert dos novos grupos), e antes do bloco `const { data: itens } = await supabase.from("versoes_orcamento_itens")`, adicionar:

```ts
  // Duplica categorias e mapeia old_id → new_id (mesmo padrão de grupos).
  const { data: categoriasOriginais } = await supabase
    .from("versoes_orcamento_categorias")
    .select("id, nome")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  const categoriaMap = new Map<string, string>();
  if (categoriasOriginais && categoriasOriginais.length > 0) {
    const catRows = categoriasOriginais.map((c: any) => ({
      tenant_id: session.activeTenant.id,
      versao_orcamento_id: nova.id,
      nome: c.nome,
    }));
    const { data: novasCategorias, error: cErr } = await supabase
      .from("versoes_orcamento_categorias")
      .insert(catRows)
      .select("id, nome");
    if (cErr) {
      console.error("[versoes.duplicar.categorias]", cErr.message);
    } else if (novasCategorias) {
      for (const orig of categoriasOriginais as any[]) {
        const novo = novasCategorias.find((c: any) => c.nome === orig.nome);
        if (novo) categoriaMap.set(orig.id, novo.id);
      }
    }
  }
```

- [ ] **Step 3: Ampliar select dos itens originais e propagar campos**

Localizar:
```ts
  const { data: itens } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "ordem, grupo_id, planilha_origem, item, tipo_custo, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, fornecedor_id, observacoes",
    )
```

Substituir por:
```ts
  const { data: itens } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "ordem, grupo_id, categoria_id, planilha_origem, item, tipo_custo, " +
      "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, " +
      "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, " +
      "fornecedor_id, observacoes",
    )
```

E no `.map` que constrói os `rows` para insert, garantir que `categoria_id` seja resolvido pelo `categoriaMap`:

Substituir o `return {...i, tenant_id, ...}` por:
```ts
        return {
          ...i,
          tenant_id: session.activeTenant.id,
          versao_orcamento_id: nova.id,
          grupo_id: novoGrupoId,
          categoria_id: i.categoria_id ? (categoriaMap.get(i.categoria_id) ?? null) : null,
        };
```

- [ ] **Step 4: Verificar tsc/lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: verde.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/orcamentos/[id]/versoes/actions.ts
git commit -m "actions: duplicarVersao copia categorias e valores planejados"
```

---

## Task 8: Parser da planilha — lê categoria e planejado

**Files:**
- Modify: `lib/importacao/parser-oficial.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces:
  - `ParseItem` ganha `categoria: string | null`, `valor_unitario_planejado: number`, `quantidade_planejada: number`, `dias_meses_planejado: number`.
  - `ParseResultado` continua igual (as categorias são derivadas dos itens no consumo do parser).

- [ ] **Step 1: Ler parser atual pra localizar zonas de mudança**

Run: `Read lib/importacao/parser-oficial.ts` — anotar onde:
- `ParseItem` interface está definida.
- Loop principal lê `cells[0..7]` (col A-H).
- Bloco de item extrai colD (valor), colE (qtd), colF (dias/meses).

- [ ] **Step 2: Ampliar ParseItem**

Encontrar interface `ParseItem`. Adicionar (após `dias_meses_orcado`):

```ts
  /** Categoria vinda da col B da planilha, ou null. */
  categoria: string | null;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
```

- [ ] **Step 3: Ler cols A-L no loop principal (era A-H)**

Localizar o loop `ws.eachRow` que preenche `cells`. Ampliar de 8 para 12:

```ts
    const cells: string[] = [];
    for (let c = 1; c <= 12; c++) {
      cells.push(normalizar(row.getCell(c).value));
    }
```

- [ ] **Step 4: Extrair categoria e planejado no bloco de item**

Localizar o bloco que constrói cada ParseItem (`grupoAtual.itens.push({...})`). Substituir por:

```ts
      // Categoria (col B): opcional, pode vir vazia.
      const categoriaLida = cells[1] !== "" ? cells[1] : null;

      // Planejado (cols I=R$, J=QT, K=D/M). Cols L (TT) e M (RENTA) ignoradas.
      const rawColI = row.getCell(9).value;
      const rawColJ = row.getCell(10).value;
      const rawColK = row.getCell(11).value;

      const valorPlanejado = toNumber(rawColI);
      const qtdPlanejada = toNumber(rawColJ);
      const dmPlanejado = toNumber(rawColK);

      grupoAtual.itens.push({
        ordem: grupoAtual.itens.length + 1,
        item: nomeItem,
        tipo_custo: tipoUpper as TipoCusto,
        valor_unitario_orcado: valorD.n,
        quantidade_orcada: qtd.ok ? qtd.n : 1,
        dias_meses_orcado: dm.ok ? dm.n : 1,
        categoria: categoriaLida,
        valor_unitario_planejado: valorPlanejado.ok ? valorPlanejado.n : 0,
        quantidade_planejada: qtdPlanejada.ok ? qtdPlanejada.n : 0,
        dias_meses_planejado: dmPlanejado.ok ? dmPlanejado.n : 0,
        planilha_origem: colA !== "" ? colA : null,
        linha_xlsx: rowNumber,
      });
```

**Nota:** manter os `console.error` e warnings existentes intactos. As mudanças acima são só adição de 4 campos + leitura de mais 3 células.

- [ ] **Step 5: Verificar tsc/lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: verde.

- [ ] **Step 6: Smoke test manual (dev server)**

Run: `npm run dev` (background)
Navegar até `/orcamentos/[id]/versoes` (usar um orçamento em rascunho novo — criar um pra teste).
Importar o mesmo XLSX que foi usado antes.
No preview drawer, verificar contagem de grupos/itens continua correta.

- [ ] **Step 7: Commit**

```bash
git add lib/importacao/parser-oficial.ts
git commit -m "parser: lê col B (categoria) e cols I-K (planejado)"
```

---

## Task 9: confirmarImportacao — cria categorias e persiste planejado

**Files:**
- Modify: `app/(app)/orcamentos/[id]/versoes/importar-actions.ts`

**Interfaces:**
- Consumes: `ParseItem` ampliado (Task 8).
- Produces: `confirmarImportacao` cria categorias em bulk e resolve `categoria_id` por nome; itens gravam campos planejados.

- [ ] **Step 1: Ler confirmarImportacao atual**

Run: `Read app/(app)/orcamentos/[id]/versoes/importar-actions.ts` — localizar `export async function confirmarImportacao`.

- [ ] **Step 2: Adicionar bloco de criação de categorias em bulk**

Após o bloco que insere grupos (`.from("versoes_orcamento_grupos").insert(gruposParaInserir)`), e antes do bloco que insere itens, adicionar:

```ts
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
    const categoriasParaInserir = Array.from(categoriaNomes).map((nome) => ({
      tenant_id: tenantId,
      versao_orcamento_id: versaoId,
      nome,
    }));

    const { data: categoriasCriadas, error: catErr } = await service
      .from("versoes_orcamento_categorias")
      .insert(categoriasParaInserir)
      .select("id, nome");

    if (catErr || !categoriasCriadas) {
      console.error(
        "[importacao.confirmar.categorias]",
        catErr?.message ?? "sem retorno",
      );
      // Não faz rollback — categorias faltando são recuperáveis; itens
      // simplesmente ficarão sem categoria vinculada.
    } else {
      for (const c of categoriasCriadas as { id: string; nome: string }[]) {
        categoriaIdPorNomeLower.set(c.nome.toLowerCase(), c.id);
      }
    }
  }
```

- [ ] **Step 3: Ampliar bulk insert dos itens**

Localizar o bloco:
```ts
      itensParaInserir.push({
        tenant_id: tenantId,
        versao_orcamento_id: versaoId,
        grupo_id: grupoId,
        ordem: ordemGlobal,
        planilha_origem: `linha ${it.linha_xlsx}`,
        item: it.item,
        tipo_custo: it.tipo_custo,
        valor_unitario_orcado: it.valor_unitario_orcado,
        quantidade_orcada: it.quantidade_orcada,
        dias_meses_orcado: it.dias_meses_orcado,
      });
```

Substituir por:
```ts
      const categoriaId = it.categoria
        ? categoriaIdPorNomeLower.get(it.categoria.trim().toLowerCase()) ?? null
        : null;

      itensParaInserir.push({
        tenant_id: tenantId,
        versao_orcamento_id: versaoId,
        grupo_id: grupoId,
        categoria_id: categoriaId,
        ordem: ordemGlobal,
        planilha_origem: `linha ${it.linha_xlsx}`,
        item: it.item,
        tipo_custo: it.tipo_custo,
        valor_unitario_orcado: it.valor_unitario_orcado,
        quantidade_orcada: it.quantidade_orcada,
        dias_meses_orcado: it.dias_meses_orcado,
        valor_unitario_planejado: it.valor_unitario_planejado,
        quantidade_planejada: it.quantidade_planejada,
        dias_meses_planejado: it.dias_meses_planejado,
      });
```

- [ ] **Step 4: Verificar tsc/lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: verde.

- [ ] **Step 5: Smoke test manual**

Continuar do dev server anterior. Importar a mesma planilha e criar versão. Verificar via MCP:

```sql
set local role authenticated;
set local "request.jwt.claim.sub" = 'ba2e2ba1-1ba0-4e3d-99de-5d9d89877381';
-- Substituir <VERSAO_ID> pela versão recém-criada
select count(*) as itens, count(distinct categoria_id) as categorias_com_id,
       sum(case when valor_unitario_planejado > 0 then 1 else 0 end) as com_planejado
from public.versoes_orcamento_itens
where versao_orcamento_id = '<VERSAO_ID>';
```

Se a planilha de teste tem col B vazia, `categorias_com_id` = 0. Se col I tiver valores, `com_planejado` > 0.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/orcamentos/[id]/versoes/importar-actions.ts
git commit -m "import: cria categorias e persiste campos planejados"
```

---

## Task 10: Helper calcularTotaisPlanejados

**Files:**
- Modify: `lib/calculos/versao-totais.ts`

**Interfaces:**
- Consumes: `VersaoOrcamentoItem` ampliado.
- Produces:
  - Nova função `calcularTotaisPlanejados(itens): { totalPlanejado: number; rentabilidade: number; percentualRentabilidade: number | null }` (percentual `null` quando totalOrcado ou totalPlanejado = 0).

- [ ] **Step 1: Ler o arquivo atual**

Run: `Read lib/calculos/versao-totais.ts` — entender `calcularTotaisVersao` e o padrão do módulo.

- [ ] **Step 2: Adicionar função no fim do arquivo**

```ts
/**
 * Rentabilidade simples: soma dos totais orçados menos soma dos totais
 * planejados. Percentual em relação ao total orçado.
 *
 * Retorna `percentualRentabilidade: null` quando não há planejado (não
 * planejado = mostrar travessão em vez de "100%").
 *
 * Fórmula completa (com honor+imposto) fica pra iteração futura.
 */
export function calcularTotaisPlanejados(
  itens: Array<Pick<VersaoOrcamentoItem, "total_orcado" | "total_planejado">>,
): {
  totalOrcado: number;
  totalPlanejado: number;
  rentabilidade: number;
  percentualRentabilidade: number | null;
} {
  const totalOrcado = itens.reduce(
    (sum, it) => sum + Number(it.total_orcado ?? 0),
    0,
  );
  const totalPlanejado = itens.reduce(
    (sum, it) => sum + Number(it.total_planejado ?? 0),
    0,
  );
  const rentabilidade = totalOrcado - totalPlanejado;
  const percentualRentabilidade =
    totalPlanejado > 0 && totalOrcado > 0
      ? (rentabilidade / totalOrcado) * 100
      : null;

  return { totalOrcado, totalPlanejado, rentabilidade, percentualRentabilidade };
}
```

- [ ] **Step 3: Se necessário, importar VersaoOrcamentoItem**

Verificar se já existe import de `VersaoOrcamentoItem` no topo. Se não, adicionar:

```ts
import type { VersaoOrcamentoItem } from "@/lib/types";
```

- [ ] **Step 4: Verificar tsc/lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: verde.

- [ ] **Step 5: Commit**

```bash
git add lib/calculos/versao-totais.ts
git commit -m "calc: helper calcularTotaisPlanejados"
```

---

## Task 11: NovaCategoriaDrawer

**Files:**
- Create: `app/(app)/orcamentos/[id]/versoes/[versaoId]/nova-categoria-drawer.tsx`

**Interfaces:**
- Consumes: `criarCategoria` server action (Task 5).
- Produces: componente client-side com props `{ versaoId: string; disabled?: boolean; disabledReason?: string }`.

- [ ] **Step 1: Copiar padrão do NovoGrupoDrawer**

Run: `Read app/(app)/orcamentos/[id]/versoes/[versaoId]/novo-grupo-drawer.tsx` — usar como template exato, trocando "grupo" → "categoria" e `criarGrupo` → `criarCategoria`.

- [ ] **Step 2: Criar arquivo**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus, Save } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarCategoria } from "../actions";
import type { ActionResult } from "../actions";

interface Props {
  versaoId: string;
  disabled?: boolean;
  disabledReason?: string;
}

export function NovaCategoriaDrawer({
  versaoId,
  disabled,
  disabledReason,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const res: ActionResult = await criarCategoria(versaoId, formData);
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
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground shadow-sm hover:border-california-red/40 hover:text-california-red transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="h-3.5 w-3.5" />
          Nova categoria
        </button>
      </DialogTrigger>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Nova categoria</DialogTitle>
          <DialogDescription>
            Categorias classificam os itens desta versão. Ficam disponíveis
            apenas nesta versão do orçamento.
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
                placeholder="Ex.: Logística, Equipe, Sampling"
                required
                maxLength={120}
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
              onClick={() => setOpen(false)}
              className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pending ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Criando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Criar categoria
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

- [ ] **Step 3: Verificar tsc/lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add app/(app)/orcamentos/[id]/versoes/[versaoId]/nova-categoria-drawer.tsx
git commit -m "ui: NovaCategoriaDrawer (espelha novo-grupo-drawer)"
```

---

## Task 12: Página da versão — carrega categorias e passa aos filhos

**Files:**
- Modify: `app/(app)/orcamentos/[id]/versoes/[versaoId]/page.tsx`

**Interfaces:**
- Consumes: tabela `versoes_orcamento_categorias` no Supabase, `VersaoOrcamentoCategoria`.
- Produces: componentes filhos (`GrupoCard`, `TotaisCard`, `NovoGrupoDrawer`, novo `NovaCategoriaDrawer`) recebem lista de categorias da versão.

- [ ] **Step 1: Ler página atual**

Run: `Read app/(app)/orcamentos/[id]/versoes/[versaoId]/page.tsx`.

- [ ] **Step 2: Adicionar 5ª query no Promise.all**

Localizar o `Promise.all([versaoRes, orcRes, gruposRes, itensRes])`. Ampliar:

```ts
  const [versaoRes, orcRes, gruposRes, itensRes, categoriasRes] = await Promise.all([
    // ... 4 queries existentes ...
    supabase
      .from("versoes_orcamento_categorias")
      .select("*")
      .eq("versao_orcamento_id", params.versaoId)
      .eq("tenant_id", session.activeTenant.id)
      .order("nome", { ascending: true })
      .returns<VersaoOrcamentoCategoria[]>(),
  ]);
```

E logging:
```ts
  if (categoriasRes.error) console.error("[versao.categorias]", categoriasRes.error.message);
```

- [ ] **Step 3: Importar tipo e componente**

No topo, ajustar imports:

```ts
import {
  versaoStatusLabel,
  type VersaoOrcamento,
  type VersaoOrcamentoGrupo,
  type VersaoOrcamentoItem,
  type VersaoOrcamentoCategoria,
} from "@/lib/types";
// ...
import { NovaCategoriaDrawer } from "./nova-categoria-drawer";
```

- [ ] **Step 4: Extrair categorias e passar aos filhos**

Após o bloco `const grupos = ...`, adicionar:

```ts
  const categorias = (categoriasRes.data ?? []) as VersaoOrcamentoCategoria[];
```

Alterar a linha do render que chama `<NovoGrupoDrawer versaoId={versao.id} />` para incluir o `<NovaCategoriaDrawer>` ao lado (dentro do `flex items-center justify-between`):

```tsx
        {!readOnly && (
          <div className="flex items-center gap-2">
            <NovaCategoriaDrawer versaoId={versao.id} />
            <NovoGrupoDrawer versaoId={versao.id} />
          </div>
        )}
```

Passar categorias para GrupoCard e TotaisCard:

```tsx
            <GrupoCard
              key={g.id}
              grupo={g}
              itens={itensPorGrupo.get(g.id) ?? []}
              moeda={versao.moeda}
              readOnly={readOnly}
              categorias={categorias}
            />
```

```tsx
      <TotaisCard
        itens={itens}
        percentualHonorarios={Number(versao.percentual_honorarios)}
        percentualImposto={Number(versao.percentual_imposto)}
        moeda={versao.moeda}
      />
```
(TotaisCard não precisa das categorias — ele só usa os itens que já foram mapeados com `total_planejado`.)

- [ ] **Step 5: Verificar tsc/lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: verde no page.tsx; erros vão aparecer em `grupo-card.tsx` porque ainda não aceita `categorias` — próxima task.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/orcamentos/[id]/versoes/[versaoId]/page.tsx
git commit -m "ui: página da versão carrega categorias e passa aos filhos"
```

---

## Task 13: GrupoCard aceita categorias e repassa

**Files:**
- Modify: `app/(app)/orcamentos/[id]/versoes/[versaoId]/grupo-card.tsx`

**Interfaces:**
- Consumes: `VersaoOrcamentoCategoria[]`.
- Produces: repassa `categorias` para `ItensTable`.

- [ ] **Step 1: Ler grupo-card.tsx**

Run: `Read app/(app)/orcamentos/[id]/versoes/[versaoId]/grupo-card.tsx`.

- [ ] **Step 2: Adicionar prop categorias**

Na interface de props do componente, adicionar `categorias: VersaoOrcamentoCategoria[]`. Importar o tipo do `@/lib/types`.

- [ ] **Step 3: Repassar para ItensTable**

Onde `<ItensTable>` é renderizado, adicionar prop `categorias={categorias}`.

- [ ] **Step 4: Verificar tsc/lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: erros movidos para `itens-table.tsx`.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/orcamentos/[id]/versoes/[versaoId]/grupo-card.tsx
git commit -m "ui: GrupoCard repassa categorias pro ItensTable"
```

---

## Task 14: ItensTable — colunas planejadas + rentab + categoria

**Files:**
- Modify: `app/(app)/orcamentos/[id]/versoes/[versaoId]/itens-table.tsx`

**Interfaces:**
- Consumes: `VersaoOrcamentoItem` ampliado + `VersaoOrcamentoCategoria[]`.
- Produces: nova estrutura de tabela com colunas: Item | Tipo | Categoria | R$ Orç | QT | D/M | Total Orç | R$ Plan | QT | D/M | Total Plan | Rentab. | Ações.

- [ ] **Step 1: Ler tabela atual**

Run: `Read app/(app)/orcamentos/[id]/versoes/[versaoId]/itens-table.tsx`.

- [ ] **Step 2: Adicionar prop categorias**

Interface de props ganha `categorias: VersaoOrcamentoCategoria[]`. Importar tipo.

- [ ] **Step 3: Reestruturar cabeçalho da tabela**

Localizar `<thead>` e substituir por:

```tsx
      <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
        <tr>
          <th className="text-left font-semibold px-3 py-2">Item</th>
          <th className="text-left font-semibold px-3 py-2">Tipo</th>
          <th className="text-left font-semibold px-3 py-2">Categoria</th>
          <th className="text-right font-semibold px-3 py-2">R$ Orç.</th>
          <th className="text-right font-semibold px-3 py-2">QT</th>
          <th className="text-right font-semibold px-3 py-2">D/M</th>
          <th className="text-right font-semibold px-3 py-2">Total Orç.</th>
          <th className="text-right font-semibold px-3 py-2 bg-blue-50/60">R$ Plan.</th>
          <th className="text-right font-semibold px-3 py-2 bg-blue-50/60">QT</th>
          <th className="text-right font-semibold px-3 py-2 bg-blue-50/60">D/M</th>
          <th className="text-right font-semibold px-3 py-2 bg-blue-50/60">Total Plan.</th>
          <th className="text-right font-semibold px-3 py-2">Rentab.</th>
          {!readOnly && <th className="w-[80px]"></th>}
        </tr>
      </thead>
```

- [ ] **Step 4: Reestruturar cada linha (tbody)**

Cada `<tr>` de item vira:

```tsx
        <tr
          key={item.id}
          onClick={() => onEditar(item)}
          className="border-b border-border hover:bg-accent/40 transition-colors cursor-pointer"
        >
          <td className="px-3 py-2 text-sm text-foreground">{item.item}</td>
          <td className="px-3 py-2">
            <Badge variant="outline">{item.tipo_custo}</Badge>
          </td>
          <td className="px-3 py-2 text-xs">
            {(() => {
              const cat = categorias.find((c) => c.id === item.categoria_id);
              return cat ? (
                <Badge variant="neutral">{cat.nome}</Badge>
              ) : (
                <span className="text-muted-foreground">—</span>
              );
            })()}
          </td>
          <td className="px-3 py-2 text-right font-mono text-xs">
            {formatCurrency(item.valor_unitario_orcado, moeda)}
          </td>
          <td className="px-3 py-2 text-right text-xs">
            {Number(item.quantidade_orcada)}
          </td>
          <td className="px-3 py-2 text-right text-xs">
            {Number(item.dias_meses_orcado)}
          </td>
          <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
            {formatCurrency(item.total_orcado, moeda)}
          </td>
          <td className="px-3 py-2 text-right font-mono text-xs bg-blue-50/40">
            {item.valor_unitario_planejado > 0
              ? formatCurrency(item.valor_unitario_planejado, moeda)
              : "—"}
          </td>
          <td className="px-3 py-2 text-right text-xs bg-blue-50/40">
            {item.quantidade_planejada > 0 ? Number(item.quantidade_planejada) : "—"}
          </td>
          <td className="px-3 py-2 text-right text-xs bg-blue-50/40">
            {item.dias_meses_planejado > 0 ? Number(item.dias_meses_planejado) : "—"}
          </td>
          <td className="px-3 py-2 text-right font-mono text-xs font-semibold bg-blue-50/40">
            {item.total_planejado > 0
              ? formatCurrency(item.total_planejado, moeda)
              : "—"}
          </td>
          <td className="px-3 py-2 text-right font-mono text-xs">
            {(() => {
              if (item.total_planejado <= 0) {
                return <span className="text-muted-foreground">—</span>;
              }
              const rentab = item.total_orcado - item.total_planejado;
              const cor = rentab >= 0 ? "text-emerald-700" : "text-california-red";
              return <span className={cor}>{formatCurrency(rentab, moeda)}</span>;
            })()}
          </td>
          {!readOnly && (
            <td
              onClick={(e) => e.stopPropagation()}
              className="px-3 py-2 text-right"
            >
              {/* botões de editar/remover mantidos exatamente como estavam */}
            </td>
          )}
        </tr>
```

**Importante:** copiar o conteúdo dos botões de ação (Edit/Delete) do arquivo original — não deletar essa funcionalidade.

Importar `Badge` se ainda não estiver importado.

- [ ] **Step 5: Se a interface `Item` local existir, propagar campos novos**

Se o arquivo define uma interface local que espelha VersaoOrcamentoItem, adicionar os campos novos. Se não, apenas usar o tipo direto do `@/lib/types`.

- [ ] **Step 6: Verificar tsc/lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: verde.

- [ ] **Step 7: Smoke test manual**

Rodar `npm run dev`, navegar até a versão importada existente. Verificar que:
- Colunas novas aparecem com fundo azul suave.
- Categoria vazia mostra "—".
- Rentab. mostra "—" quando planejado = 0.

- [ ] **Step 8: Commit**

```bash
git add app/(app)/orcamentos/[id]/versoes/[versaoId]/itens-table.tsx
git commit -m "ui: ItensTable com colunas planejadas + rentabilidade + categoria"
```

---

## Task 15: Item drawer — categoria dropdown + planejado

**Files:**
- Modify: `app/(app)/orcamentos/[id]/versoes/[versaoId]/item-editor-drawer.tsx`

**Interfaces:**
- Consumes: `VersaoOrcamentoCategoria[]` (via prop).
- Produces: form estendido com dropdown de categoria (opcional) e bloco planejado com 3 inputs numéricos.

- [ ] **Step 1: Ler drawer atual**

Run: `Read app/(app)/orcamentos/[id]/versoes/[versaoId]/item-editor-drawer.tsx`.

- [ ] **Step 2: Adicionar prop categorias**

Interface de props ganha `categorias: VersaoOrcamentoCategoria[]`. Importar tipo.

- [ ] **Step 3: Adicionar bloco categoria no formulário**

Após o campo `tipo_custo` (dropdown A/B/C/D) e antes do bloco de orçado, adicionar:

```tsx
      <div className="space-y-2">
        <Label htmlFor="categoria_id">Categoria (opcional)</Label>
        <Select
          name="categoria_id"
          defaultValue={item?.categoria_id ?? ""}
        >
          <SelectTrigger>
            <SelectValue placeholder="Nenhuma" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Nenhuma</SelectItem>
            {categorias.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Crie novas categorias pelo botão &ldquo;Nova categoria&rdquo; no
          topo da versão.
        </p>
      </div>
```

**Nota:** o Radix `<Select>` do sistema (verificar `components/ui/select.tsx`) trata `value=""` como "sem seleção"; ao submeter o form, o valor vazio será convertido pelo Zod schema em `null`.

- [ ] **Step 4: Adicionar bloco planejado**

Após o bloco de orçado (valor_unitario_orcado, quantidade_orcada, dias_meses_orcado), adicionar:

```tsx
      <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-800">
            Planejado
          </span>
          <span className="text-[10px] text-blue-800/70">
            (custo real negociado com fornecedor)
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label htmlFor="valor_unitario_planejado">Valor unit.</Label>
            <Input
              id="valor_unitario_planejado"
              name="valor_unitario_planejado"
              type="number"
              step="0.01"
              min="0"
              className="no-spinner"
              defaultValue={item?.valor_unitario_planejado ?? 0}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quantidade_planejada">QT</Label>
            <Input
              id="quantidade_planejada"
              name="quantidade_planejada"
              type="number"
              step="0.001"
              min="0"
              className="no-spinner"
              defaultValue={item?.quantidade_planejada ?? 0}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dias_meses_planejado">D/M</Label>
            <Input
              id="dias_meses_planejado"
              name="dias_meses_planejado"
              type="number"
              step="0.001"
              min="0"
              className="no-spinner"
              defaultValue={item?.dias_meses_planejado ?? 0}
            />
          </div>
        </div>
      </div>
```

- [ ] **Step 5: Confirmar imports**

Garantir que `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` estão importados de `@/components/ui/select`. `Label`, `Input`, `VersaoOrcamentoCategoria` também.

- [ ] **Step 6: Verificar tsc/lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: verde.

- [ ] **Step 7: Smoke test manual**

Rodar dev, editar item em uma versão existente. Verificar:
- Dropdown categoria mostra as opções e permite deixar em "Nenhuma".
- Bloco planejado aparece com 3 inputs.
- Salvar mantém os valores.

- [ ] **Step 8: Commit**

```bash
git add app/(app)/orcamentos/[id]/versoes/[versaoId]/item-editor-drawer.tsx
git commit -m "ui: item drawer com dropdown de categoria e bloco planejado"
```

---

## Task 16: TotaisCard — linha total planejado + rentabilidade

**Files:**
- Modify: `app/(app)/orcamentos/[id]/versoes/[versaoId]/totais-card.tsx`

**Interfaces:**
- Consumes: `calcularTotaisPlanejados` (Task 10).
- Produces: card exibe 3 linhas novas (Total Planejado, Rentabilidade, % Rentabilidade) quando existe planejado > 0.

- [ ] **Step 1: Ler card atual**

Run: `Read app/(app)/orcamentos/[id]/versoes/[versaoId]/totais-card.tsx`.

- [ ] **Step 2: Importar helper novo**

Ajustar imports:

```ts
import {
  calcularTotaisVersao,
  calcularTotaisPlanejados,
} from "@/lib/calculos/versao-totais";
```

- [ ] **Step 3: Calcular totais planejados**

Dentro do componente, após `const { subtotaisPorTipo, ... } = calcularTotaisVersao(...)`, adicionar:

```ts
  const {
    totalPlanejado,
    rentabilidade,
    percentualRentabilidade,
  } = calcularTotaisPlanejados(itens);

  const temPlanejado = totalPlanejado > 0;
```

- [ ] **Step 4: Adicionar linhas ao render**

Localizar onde as linhas do resumo são renderizadas (SUB-TOTAL, TOTAL, IMPOSTO, HONORÁRIOS, FATURAMENTO). Antes de FATURAMENTO, adicionar:

```tsx
      {temPlanejado && (
        <>
          <SummaryRow
            label="TOTAL PLANEJADO"
            value={totalPlanejado}
            moeda={moeda}
          />
          <SummaryRow
            label="RENTABILIDADE"
            value={rentabilidade}
            moeda={moeda}
            valueClassName={
              rentabilidade >= 0 ? "text-emerald-700" : "text-california-red"
            }
          />
          {percentualRentabilidade !== null && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-border">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                % RENTABILIDADE
              </span>
              <span
                className={`font-mono text-sm ${
                  percentualRentabilidade >= 0
                    ? "text-emerald-700"
                    : "text-california-red"
                }`}
              >
                {percentualRentabilidade.toFixed(1).replace(".", ",")}%
              </span>
            </div>
          )}
        </>
      )}
```

**Nota:** `SummaryRow` é o helper local do arquivo (verificar nome exato ao ler); se o arquivo usa formato diferente, adaptar mantendo o mesmo estilo visual.

Se o componente atual não tem helper reutilizável, replicar o mesmo padrão de markup das outras linhas (label esquerda, valor mono à direita, borda superior).

- [ ] **Step 5: Verificar tsc/lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: verde.

- [ ] **Step 6: Smoke test manual**

Rodar dev, abrir a versão importada. Se você preencher planejado em pelo menos um item (via drawer), o TotaisCard deve mostrar as 3 novas linhas (Total Plan., Rentab., % Rentab.). Sem planejado, as linhas não aparecem.

- [ ] **Step 7: Commit**

```bash
git add app/(app)/orcamentos/[id]/versoes/[versaoId]/totais-card.tsx
git commit -m "ui: TotaisCard com linhas de total planejado e rentabilidade"
```

---

## Task 17: HANDOFF + memória

**Files:**
- Modify: `docs/HANDOFF.md` — marca fase G como implementada.
- Modify: `C:/Users/anton/.claude/projects/c--Projects-califa-erp/memory/project_planilha_padrao.md` — anotar que agora parseamos col B e cols I-K.
- Modify: `C:/Users/anton/.claude/projects/c--Projects-califa-erp/memory/project_estado_atual.md` — refletir novo estado.

**Interfaces:** documentação.

- [ ] **Step 1: Atualizar HANDOFF**

Adicionar seção "Fase G — Planejado e Categoria" na lista de fases entregues.

- [ ] **Step 2: Atualizar memória de planilha**

Anotar que parser agora lê 12 colunas (A-L) e extrai categoria (B) + planejado (I-K).

- [ ] **Step 3: Atualizar estado atual**

Marcar Task 004 fase G como pronta; próxima prioridade atualizada.

- [ ] **Step 4: Commit final**

```bash
git add docs/HANDOFF.md
git commit -m "docs: HANDOFF marca fase G (categoria + planejado) como implementada"
```

Memórias são fora do repo — só editar arquivos.

---

## Verificação final integrada

Depois da Task 17:

- [ ] Rodar `npx tsc --noEmit` — verde.
- [ ] Rodar `npx next lint` — verde.
- [ ] Smoke test manual em `npm run dev`:
  1. Abrir versão existente do ORC-0001 (não importada) — Coluna Categoria mostra "—" nos itens, linhas planejadas mostram "—", card totais NÃO mostra rentabilidade.
  2. Editar um item, colocar planejado (valor 50, qtd 1, dm 1). Salvar. Card totais passa a mostrar rentabilidade.
  3. Criar nova categoria "Teste", editar outro item e atribuir. Coluna Categoria mostra o badge "Teste".
  4. Duplicar a versão → nova versão nasce com categorias e planejado copiados corretamente.
- [ ] Importar planilha de teste — se col B tiver algum valor no arquivo real, verificar via MCP que `versoes_orcamento_categorias` foi populada e itens têm `categoria_id` setado.
- [ ] Push final: `git push origin main`.

## Se algo der errado

- **Migration falha em produção:** rollback via `drop table versoes_orcamento_categorias cascade;` + `alter table versoes_orcamento_itens drop column ...` (produzir SQL de rollback antes de aplicar em produção).
- **Import quebra por incompatibilidade de tipo:** verificar em `parser-oficial.ts` que `toNumber` está tratando célula vazia como `{ok:false, n:0}` — comportamento herdado, não deve ter regredido.
- **Rentabilidade dá NaN:** conferir que `total_planejado` está vindo como number (pode estar vindo como string do supabase-js; se sim, usar `Number(it.total_planejado)` no fetch do item na page).

---

## Self-review resumo

- **Spec coverage:** todas as seções do spec (categoria por versão, opcional, botão Nova categoria, import auto-preenche, planejado editado junto com orçado, item nasce zerado, import lê I-K, rentabilidade orçado−planejado, duplicação copia tudo, UI com dropdown + tabela + card totais) têm task correspondente.
- **Placeholder scan:** nenhum "TBD"/"TODO"/"implement later". Nas tarefas de UI, chamo atenção para copiar padrão exato do arquivo referência quando o schema Zod ou o Select têm variação.
- **Type consistency:** `VersaoOrcamentoCategoria` mesma spelling nas tasks 2, 12, 13, 14, 15. `categoria_id` como campo de item consistente em types, schema Zod, server actions, parser, import, UI. `total_planejado` GENERATED — nunca escrito, sempre lido.
