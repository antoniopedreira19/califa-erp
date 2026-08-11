# Rateio de Regional em Contas Avulsas — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar rateio de regional obrigatório em conta avulsa e template recorrente (1+ linhas de `regional_id + percentual` somando 100%), com validação em trigger de banco, componente reutilizável no drawer, card de detalhes, badge "Rateado" na conciliação, e cron copiando rateio do template pra cada instância gerada.

**Architecture:** 2 tabelas filhas novas (`contas_avulsas_regionais` e `contas_avulsas_recorrentes_regionais`) com FK cascade da conta pai. Trigger `DEFERRABLE INITIALLY DEFERRED` valida `SUM(percentual) = 100.00` no commit da transação (permite delete-all + insert-all na edição). Job selecionado trava rateio em 100% da regional do job. Cron amplia `gerar_ocorrencias_recorrentes()` pra copiar rateio do template pra cada instância nova.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase (Postgres + Auth + RLS), Tailwind, shadcn/ui, Radix, lucide-react, React Hook Form + Zod.

## Global Constraints

Aplicam a **todas** as tasks. Copiados verbatim de `CLAUDE.md`, `docs/PERFORMANCE.md` e da spec (`docs/superpowers/specs/2026-08-08-rateio-regional-avulsa-design.md`).

- **Performance é feature.** Leia `docs/PERFORMANCE.md` antes de tocar `app/(app)/**` ou `lib/supabase/**`.
- **Ortografia pt-BR em toda string visível ao usuário.** Sem `Voce`, `Nao`, `Descricao`, `Acao`.
- **RLS ≠ GRANT.** Toda migration que cria tabela termina com `grant select, insert, update, delete on ... to authenticated`.
- **Toda tabela operacional tem `tenant_id`** com FK pra `tenants` e RLS via `is_tenant_member(tenant_id)`.
- **Server action pattern:** `requireSession()` → parse Zod → verificar `tenant_id` → executar → `logAuditEvent` → `revalidatePath`.
- **Gate `admin | financeiro`** em toda ação financeira (rateio é modificado pelas actions de criar/editar avulsa e recorrente — herdam o gate).
- **Radix `<SelectItem>` NUNCA aceita `value=""`** — usar sentinel se precisar.
- **`<DrawerContent>` não aceita prop `title`** — composition.
- **Colunas numéricas do Postgres:** `Number(...)` ao ler; `percentual` é `numeric(5,2)`, vem como string do Supabase — sempre converter.
- **Datas** — não se aplica aqui (só percentual e FKs).
- **`force-dynamic` em pages autenticadas.**
- **Trigger `SUM(percentual) = 100.00`** — tolerância `abs(sum - 100) < 0.01`.
- **Job com regional trava rateio em 100%.** Sem job, usuário rateia manualmente (1+ regionais).
- **Regional obrigatória sempre** — mínimo 1 linha. Zod refine `min(1)`.
- **Última linha do rateio "pega a sobra"** na renderização em R$ (evita divergência de 1 centavo).
- **Edição de template só afeta instâncias futuras** — instâncias já geradas mantêm o rateio herdado no momento da geração.
- **Antes de commit:** rodar `npx tsc --noEmit && npx next lint` — exit code 0 obrigatório.

---

## Estrutura de arquivos

### Migrations

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260808000001_contas_avulsas_regionais.sql` | 2 tabelas filhas + 2 constraint triggers `DEFERRABLE INITIALLY DEFERRED` + RLS + GRANT |
| `supabase/migrations/20260808000002_gerar_recorrentes_v2.sql` | `CREATE OR REPLACE FUNCTION gerar_ocorrencias_recorrentes()` incluindo INSERT bulk copiando rateio do template pra instância |

### Types e utilitários

| Arquivo | Ação |
|---|---|
| `lib/types.ts` | Adicionar tipos `ContaAvulsaRateio`, `ContaAvulsaRecorrenteRateio` |
| `lib/auth/audit.ts` | Adicionar 2 audit actions (`conta_avulsa.rateio_alterado`, `conta_recorrente.rateio_alterado`) |
| `lib/validations/conta-avulsa.ts` | `rateio` no schema de criar + editar |
| `lib/validations/conta-recorrente.ts` | `rateio` no schema de criar + editar |

### Componentes reutilizáveis

| Arquivo | Ação |
|---|---|
| `app/(app)/financeiro/contas-a-pagar/rateio-regional-editor.tsx` | **Criar** — componente cliente com N linhas dinâmicas + input de percentual + botão adicionar/remover + total footer |
| `app/(app)/financeiro/contas-a-pagar/rateio-card.tsx` | **Criar** — card read-only usado nas 2 páginas de detalhes |

### Server actions

| Arquivo | Ação |
|---|---|
| `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts` | **Modify** — `criarContaAvulsa` e `editarContaAvulsa` aceitam rateio + INSERT/UPDATE bulk |
| `app/(app)/financeiro/contas-a-pagar/actions-recorrentes.ts` | **Modify** — `criarContaRecorrente` e `editarContaRecorrente` aceitam rateio |

### UI

| Arquivo | Ação |
|---|---|
| `app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx` | **Modify** — usa `<RateioRegionalEditor>`; passa `regionais`, `jobSelecionado?.regional_id` |
| `app/(app)/financeiro/contas-a-pagar/conta-recorrente-drawer.tsx` | **Modify** — mesma coisa |
| `app/(app)/financeiro/contas-a-pagar/page.tsx` | **Modify** — carrega `regionais ativas` na query paralela + passa pros drawers |
| `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/page.tsx` | **Modify** — carrega rateio + passa pro `<RateioCard>` + pro drawer editar |
| `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/page.tsx` | **Modify** — carrega rateio + passa pro `<RateioCard>` |
| `app/(app)/financeiro/conciliacao/page.tsx` | **Modify** — embed do rateio no select |
| `app/(app)/financeiro/conciliacao/conciliacao-list.tsx` | **Modify** — badge "Rateado" na descrição + popover com breakdown |

---

## Task 1: Migration schema + triggers + types + audit

**Files:**
- Create: `supabase/migrations/20260808000001_contas_avulsas_regionais.sql`
- Modify: `lib/types.ts`
- Modify: `lib/auth/audit.ts`

**Interfaces:**
- Consumes: `public.tenants(id)`, `public.contas_avulsas(id)`, `public.contas_avulsas_recorrentes(id)`, `public.regionais(id)`, `public.is_tenant_member(uuid)`.
- Produces:
  - Tables `public.contas_avulsas_regionais` (id, tenant_id, conta_avulsa_id, regional_id, percentual, created_at).
  - Table `public.contas_avulsas_recorrentes_regionais` (id, tenant_id, recorrente_id, regional_id, percentual, created_at).
  - Functions `enforce_rateio_soma_100_avulsa()` + `enforce_rateio_soma_100_recorrente()` — SECURITY DEFINER, raise exception se `SUM(percentual) != 100.00` com tolerância `< 0.01`.
  - 2 constraint triggers DEFERRABLE INITIALLY DEFERRED.
  - Types TS: `ContaAvulsaRateio`, `ContaAvulsaRecorrenteRateio`.
  - Audit actions: `conta_avulsa.rateio_alterado`, `conta_recorrente.rateio_alterado`.

---

- [ ] **Step 1: Criar migration**

Arquivo `supabase/migrations/20260808000001_contas_avulsas_regionais.sql`:

```sql
-- =====================================================================
-- Task 014 — Rateio de regional em contas avulsas e templates recorrentes
-- Ver spec: docs/superpowers/specs/2026-08-08-rateio-regional-avulsa-design.md
-- =====================================================================

-- 1) Tabela de rateio da conta avulsa
create table if not exists public.contas_avulsas_regionais (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  conta_avulsa_id   uuid not null references public.contas_avulsas(id) on delete cascade,
  regional_id       uuid not null references public.regionais(id) on delete restrict,
  percentual        numeric(5,2) not null,
  created_at        timestamptz not null default now(),

  constraint chk_avulsa_rateio_percentual_range
    check (percentual > 0 and percentual <= 100),
  constraint uniq_avulsa_regional
    unique (conta_avulsa_id, regional_id)
);

create index if not exists idx_avulsa_rateio_conta on public.contas_avulsas_regionais(conta_avulsa_id);
create index if not exists idx_avulsa_rateio_tenant on public.contas_avulsas_regionais(tenant_id);
create index if not exists idx_avulsa_rateio_regional on public.contas_avulsas_regionais(regional_id);

alter table public.contas_avulsas_regionais enable row level security;

drop policy if exists avulsa_rateio_select on public.contas_avulsas_regionais;
create policy avulsa_rateio_select on public.contas_avulsas_regionais
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists avulsa_rateio_insert on public.contas_avulsas_regionais;
create policy avulsa_rateio_insert on public.contas_avulsas_regionais
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists avulsa_rateio_update on public.contas_avulsas_regionais;
create policy avulsa_rateio_update on public.contas_avulsas_regionais
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists avulsa_rateio_delete on public.contas_avulsas_regionais;
create policy avulsa_rateio_delete on public.contas_avulsas_regionais
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.contas_avulsas_regionais to authenticated;

-- 2) Tabela de rateio do template recorrente
create table if not exists public.contas_avulsas_recorrentes_regionais (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  recorrente_id     uuid not null references public.contas_avulsas_recorrentes(id) on delete cascade,
  regional_id       uuid not null references public.regionais(id) on delete restrict,
  percentual        numeric(5,2) not null,
  created_at        timestamptz not null default now(),

  constraint chk_rec_rateio_percentual_range
    check (percentual > 0 and percentual <= 100),
  constraint uniq_rec_regional
    unique (recorrente_id, regional_id)
);

create index if not exists idx_rec_rateio_recorrente on public.contas_avulsas_recorrentes_regionais(recorrente_id);
create index if not exists idx_rec_rateio_tenant on public.contas_avulsas_recorrentes_regionais(tenant_id);
create index if not exists idx_rec_rateio_regional on public.contas_avulsas_recorrentes_regionais(regional_id);

alter table public.contas_avulsas_recorrentes_regionais enable row level security;

drop policy if exists rec_rateio_select on public.contas_avulsas_recorrentes_regionais;
create policy rec_rateio_select on public.contas_avulsas_recorrentes_regionais
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists rec_rateio_insert on public.contas_avulsas_recorrentes_regionais;
create policy rec_rateio_insert on public.contas_avulsas_recorrentes_regionais
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists rec_rateio_update on public.contas_avulsas_recorrentes_regionais;
create policy rec_rateio_update on public.contas_avulsas_recorrentes_regionais
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists rec_rateio_delete on public.contas_avulsas_recorrentes_regionais;
create policy rec_rateio_delete on public.contas_avulsas_recorrentes_regionais
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.contas_avulsas_recorrentes_regionais to authenticated;

-- 3) Função + trigger DEFERRABLE de validação de soma pra avulsa
create or replace function public.enforce_rateio_soma_100_avulsa()
returns trigger
language plpgsql
as $$
declare
  v_conta_id uuid;
  v_soma numeric(7,2);
begin
  if tg_op = 'DELETE' then
    v_conta_id := old.conta_avulsa_id;
  else
    v_conta_id := new.conta_avulsa_id;
  end if;

  select coalesce(sum(percentual), 0)
    into v_soma
    from public.contas_avulsas_regionais
   where conta_avulsa_id = v_conta_id;

  -- Aceita soma = 0 (delete-all antes de insert-all).
  if v_soma > 0 and abs(v_soma - 100.00) >= 0.01 then
    raise exception 'Rateio de regional da conta % soma %, deve ser 100.00.',
      v_conta_id, v_soma
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

drop trigger if exists trg_avulsa_rateio_soma on public.contas_avulsas_regionais;
create constraint trigger trg_avulsa_rateio_soma
  after insert or update or delete on public.contas_avulsas_regionais
  deferrable initially deferred
  for each row execute function public.enforce_rateio_soma_100_avulsa();

-- 4) Função + trigger análogos pro template recorrente
create or replace function public.enforce_rateio_soma_100_recorrente()
returns trigger
language plpgsql
as $$
declare
  v_recorrente_id uuid;
  v_soma numeric(7,2);
begin
  if tg_op = 'DELETE' then
    v_recorrente_id := old.recorrente_id;
  else
    v_recorrente_id := new.recorrente_id;
  end if;

  select coalesce(sum(percentual), 0)
    into v_soma
    from public.contas_avulsas_recorrentes_regionais
   where recorrente_id = v_recorrente_id;

  if v_soma > 0 and abs(v_soma - 100.00) >= 0.01 then
    raise exception 'Rateio de regional do template % soma %, deve ser 100.00.',
      v_recorrente_id, v_soma
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

drop trigger if exists trg_rec_rateio_soma on public.contas_avulsas_recorrentes_regionais;
create constraint trigger trg_rec_rateio_soma
  after insert or update or delete on public.contas_avulsas_recorrentes_regionais
  deferrable initially deferred
  for each row execute function public.enforce_rateio_soma_100_recorrente();
```

- [ ] **Step 2: Aplicar via MCP**

`mcp__supabase-write__apply_migration` com `name = "task014_contas_avulsas_regionais"`.

Validar via `mcp__supabase__execute_sql`:

```sql
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='contas_avulsas_regionais') as t1,
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='contas_avulsas_recorrentes_regionais') as t2,
  (select count(*) from pg_trigger where tgname='trg_avulsa_rateio_soma') as tr1,
  (select count(*) from pg_trigger where tgname='trg_rec_rateio_soma') as tr2;
```

Expected: `t1=1, t2=1, tr1=1, tr2=1`.

- [ ] **Step 3: Testar trigger com uma transação real**

Este teste é opcional mas ajuda a validar o comportamento `DEFERRABLE`. Precisa de conta avulsa existente pra referenciar; se o banco de testes não tiver nenhuma, pular:

```sql
-- Cenário 1: INSERT com sum != 100 deve falhar
begin;
insert into public.contas_avulsas_regionais (tenant_id, conta_avulsa_id, regional_id, percentual)
values (
  (select id from tenants limit 1),
  (select id from contas_avulsas limit 1),
  (select id from regionais where ativo=true limit 1),
  50.00
);
-- Ao fazer COMMIT, trigger dispara e falha porque sum=50 != 100
commit;
-- Expected: ERROR: Rateio de regional da conta ... soma 50.00, deve ser 100.00.
```

- [ ] **Step 4: Adicionar types em `lib/types.ts`**

Adicionar em local coerente com outros types financeiros:

```ts
export interface ContaAvulsaRateio {
  id: string;
  tenant_id: string;
  conta_avulsa_id: string;
  regional_id: string;
  percentual: string;  // numeric → string do supabase-js
  created_at: string;
}

export interface ContaAvulsaRecorrenteRateio {
  id: string;
  tenant_id: string;
  recorrente_id: string;
  regional_id: string;
  percentual: string;
  created_at: string;
}

/** Linha de rateio no cliente (com percentual como número — o form). */
export interface RateioLinhaInput {
  regional_id: string;
  percentual: number;
}
```

- [ ] **Step 5: Adicionar audit actions em `lib/auth/audit.ts`**

Antes de `| "acao_negada"`:

```ts
  | "conta_avulsa.rateio_alterado"
  | "conta_recorrente.rateio_alterado"
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260808000001_contas_avulsas_regionais.sql lib/types.ts lib/auth/audit.ts
git commit -m "task014: schema tabelas de rateio + triggers deferrable + types + audit"
```

---

## Task 2: `<RateioRegionalEditor>` (componente reutilizável)

**Files:**
- Create: `app/(app)/financeiro/contas-a-pagar/rateio-regional-editor.tsx`

**Interfaces:**
- Consumes: type `Regional` de `@/lib/types` (interface existente) + `RateioLinhaInput` de Task 1.
- Produces: Component `<RateioRegionalEditor linhas onChange regionais jobRegionalId? disabled? />` — client component com estado interno derivado das props.

---

- [ ] **Step 1: Criar `rateio-regional-editor.tsx`**

Arquivo `app/(app)/financeiro/contas-a-pagar/rateio-regional-editor.tsx`:

```tsx
"use client";

import * as React from "react";
import { Plus, X, MapPin } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import type { RateioLinhaInput } from "@/lib/types";

interface RegionalOption {
  id: string;
  nome: string;
  ativo: boolean;
}

interface Props {
  linhas: RateioLinhaInput[];
  onChange: (linhas: RateioLinhaInput[]) => void;
  regionais: RegionalOption[];
  /** Se informado, força 1 linha travada em 100% na regional do job. */
  jobRegionalId?: string | null;
  disabled?: boolean;
}

const TOLERANCIA = 0.01;

function somaPercentual(linhas: RateioLinhaInput[]): number {
  return linhas.reduce((s, l) => s + l.percentual, 0);
}

function formatPct(n: number): string {
  return n.toFixed(2);
}

export function RateioRegionalEditor({
  linhas,
  onChange,
  regionais,
  jobRegionalId,
  disabled = false,
}: Props) {
  // Se job selecionado, força 1 linha 100% na regional do job.
  React.useEffect(() => {
    if (jobRegionalId) {
      if (
        linhas.length !== 1 ||
        linhas[0]?.regional_id !== jobRegionalId ||
        linhas[0]?.percentual !== 100
      ) {
        onChange([{ regional_id: jobRegionalId, percentual: 100 }]);
      }
    }
  }, [jobRegionalId, linhas, onChange]);

  const regionaisAtivas = regionais.filter((r) => r.ativo);
  const regionalPorId = new Map(regionais.map((r) => [r.id, r]));

  const usadas = new Set(linhas.map((l) => l.regional_id));
  const soma = somaPercentual(linhas);
  const somaOk = Math.abs(soma - 100) < TOLERANCIA;

  function handleRegionalChange(idx: number, regional_id: string | null) {
    if (!regional_id) return;
    const novas = [...linhas];
    novas[idx] = { ...novas[idx], regional_id };
    onChange(novas);
  }

  function handlePercentualChange(idx: number, valor: string) {
    const num = Number(valor);
    if (Number.isNaN(num)) return;
    const novas = [...linhas];
    novas[idx] = { ...novas[idx], percentual: num };
    onChange(novas);
  }

  function handleRemove(idx: number) {
    const novas = linhas.filter((_, i) => i !== idx);
    onChange(novas);
  }

  function handleAdicionar() {
    const restante = Math.max(0, 100 - soma);
    onChange([
      ...linhas,
      { regional_id: "", percentual: Number(restante.toFixed(2)) },
    ]);
  }

  // Caso especial: job selecionado, renderiza 1 linha read-only.
  if (jobRegionalId) {
    const jobReg = regionalPorId.get(jobRegionalId);
    return (
      <div className="space-y-2">
        <label className="text-sm font-semibold text-foreground">
          Rateio de regional *
        </label>
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">
              {jobReg?.nome ?? "Regional do job"}
            </span>
            <span className="ml-auto font-mono text-xs">100.00%</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Regional herdada do job. Para ratear, remova o job.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold text-foreground">
        Rateio de regional *
      </label>

      <div className="space-y-2">
        {linhas.map((linha, idx) => {
          const outrasUsadas = new Set(
            linhas.filter((_, i) => i !== idx).map((l) => l.regional_id),
          );
          const itensCombobox = regionaisAtivas
            .filter((r) => !outrasUsadas.has(r.id) || r.id === linha.regional_id)
            .map((r) => ({ value: r.id, label: r.nome }));

          // Se a regional atual é inativa, inclui na lista rotulada.
          const regAtual = regionalPorId.get(linha.regional_id);
          if (regAtual && !regAtual.ativo) {
            itensCombobox.push({
              value: regAtual.id,
              label: `${regAtual.nome} (inativa)`,
            });
          }

          return (
            <div
              key={idx}
              className="flex items-center gap-2 rounded-lg border border-border bg-white p-2"
            >
              <div className="flex-1">
                <Combobox
                  items={itensCombobox}
                  value={linha.regional_id || null}
                  onChange={(v) => handleRegionalChange(idx, v)}
                  placeholder="Selecione a regional"
                  disabled={disabled}
                />
              </div>
              <div className="w-24">
                <input
                  type="number"
                  min={0.01}
                  max={100}
                  step={0.01}
                  value={linha.percentual}
                  onChange={(e) => handlePercentualChange(idx, e.target.value)}
                  disabled={disabled}
                  className="no-spinner w-full rounded-md border border-border bg-white px-2 py-1.5 text-right text-sm"
                />
              </div>
              <span className="text-xs text-muted-foreground">%</span>
              <button
                type="button"
                onClick={() => handleRemove(idx)}
                disabled={disabled || linhas.length <= 1}
                className="rounded p-1 text-muted-foreground hover:bg-california-red/10 hover:text-california-red disabled:opacity-30"
                aria-label="Remover linha"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={handleAdicionar}
          disabled={disabled || usadas.size >= regionaisAtivas.length}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-white px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-california-red hover:text-california-red disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar regional
        </button>
        <div
          className={`text-sm font-semibold ${
            somaOk ? "text-emerald-700" : "text-california-red"
          }`}
        >
          Total: {formatPct(soma)}% {somaOk ? "✓" : ""}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/rateio-regional-editor.tsx
git commit -m "task014: componente <RateioRegionalEditor> reutilizavel"
```

---

## Task 3: Server actions da avulsa (`criarContaAvulsa` + `editarContaAvulsa`)

**Files:**
- Modify: `lib/validations/conta-avulsa.ts`
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts`

**Interfaces:**
- Consumes: type `RateioLinhaInput` (Task 1), tabelas `contas_avulsas_regionais` (Task 1), audit action `conta_avulsa.rateio_alterado` (Task 1).
- Produces:
  - `criarContaAvulsa(input)` — aceita `rateio: RateioLinhaInput[]` no input, faz INSERT bulk após INSERT da conta.
  - `editarContaAvulsa(id, input)` — aceita `rateio`, faz delete-all + insert-all + registra `contas_avulsas_historico.campo_alterado='rateio'`.

---

- [ ] **Step 1: Estender Zod em `lib/validations/conta-avulsa.ts`**

Adicionar helper compartilhado e incluir em `criarContaAvulsaSchema` + `editarContaAvulsaSchema`. Ler o arquivo atual pra localizar posição.

Adicionar antes de `criarContaAvulsaSchema`:

```ts
export const rateioSchema = z
  .array(
    z.object({
      regional_id: z.string().uuid("Selecione a regional."),
      percentual: z
        .number({ invalid_type_error: "Informe o percentual." })
        .min(0.01, "Percentual mínimo 0,01.")
        .max(100, "Percentual máximo 100."),
    }),
  )
  .min(1, "Adicione pelo menos uma regional.")
  .refine(
    (a) => Math.abs(a.reduce((s, r) => s + r.percentual, 0) - 100) < 0.01,
    { message: "A soma dos percentuais deve ser 100,00.", path: ["_sum"] },
  )
  .refine(
    (a) => new Set(a.map((r) => r.regional_id)).size === a.length,
    { message: "Cada regional só pode aparecer uma vez.", path: ["_dup"] },
  );
```

Depois, no `criarContaAvulsaSchema`, adicionar campo `rateio: rateioSchema` ao lado dos outros. Como `editarContaAvulsaSchema` é derivado (`.omit`), ele automaticamente ganha o campo.

- [ ] **Step 2: Modificar `criarContaAvulsa` em `actions-avulsas.ts`**

Após o INSERT bem-sucedido em `contas_avulsas` (que retorna `conta.id`), adicionar antes do audit:

```ts
// Se tem job, força rateio único 100% na regional do job.
let rateioFinal = d.rateio;
if (d.job_id) {
  const { data: jobRow } = await supabase
    .from("jobs")
    .select("regional_id")
    .eq("id", d.job_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!jobRow?.regional_id) {
    return { ok: false, message: "Job selecionado não tem regional associada." };
  }
  rateioFinal = [{ regional_id: jobRow.regional_id, percentual: 100 }];
}

// INSERT bulk na tabela filha
const rateioRows = rateioFinal.map((r) => ({
  tenant_id: session.activeTenant.id,
  conta_avulsa_id: conta.id,
  regional_id: r.regional_id,
  percentual: r.percentual,
}));
const { error: rateioErr } = await supabase
  .from("contas_avulsas_regionais")
  .insert(rateioRows);

if (rateioErr) {
  // Compensação: apaga a conta que foi criada (o cascade cuida do resto).
  await supabase.from("contas_avulsas").delete().eq("id", conta.id);
  return { ok: false, message: `Falha ao salvar rateio: ${rateioErr.message}` };
}
```

- [ ] **Step 3: Modificar `editarContaAvulsa`**

Após o UPDATE bem-sucedido de `contas_avulsas` (e antes do audit), adicionar tratamento do rateio.

Estratégia: comparar linhas atuais com input; se diferentes, delete-all + insert-all + registrar row em `contas_avulsas_historico`.

```ts
// Carrega rateio atual pra comparar
const { data: rateioAtual } = await supabase
  .from("contas_avulsas_regionais")
  .select("regional_id, percentual")
  .eq("conta_avulsa_id", id)
  .eq("tenant_id", session.activeTenant.id);

// Se tem job, força rateio único 100% na regional do job.
let rateioNovo = d.rateio;
if (d.job_id) {
  const { data: jobRow } = await supabase
    .from("jobs")
    .select("regional_id")
    .eq("id", d.job_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!jobRow?.regional_id) {
    return { ok: false, message: "Job selecionado não tem regional associada." };
  }
  rateioNovo = [{ regional_id: jobRow.regional_id, percentual: 100 }];
}

// Normaliza pra comparar
function normalizar(rows: Array<{ regional_id: string; percentual: number | string }>) {
  return rows
    .map((r) => `${r.regional_id}:${Number(r.percentual).toFixed(2)}`)
    .sort()
    .join("|");
}
const antesStr = normalizar(rateioAtual ?? []);
const depoisStr = normalizar(rateioNovo);

if (antesStr !== depoisStr) {
  // delete-all + insert-all
  const { error: delErr } = await supabase
    .from("contas_avulsas_regionais")
    .delete()
    .eq("conta_avulsa_id", id);
  if (delErr) return { ok: false, message: `Falha ao apagar rateio antigo: ${delErr.message}` };

  const novasRows = rateioNovo.map((r) => ({
    tenant_id: session.activeTenant.id,
    conta_avulsa_id: id,
    regional_id: r.regional_id,
    percentual: r.percentual,
  }));
  const { error: insErr } = await supabase
    .from("contas_avulsas_regionais")
    .insert(novasRows);
  if (insErr) return { ok: false, message: `Falha ao salvar rateio: ${insErr.message}` };

  // Histórico: 1 row consolidada
  await supabase.from("contas_avulsas_historico").insert({
    tenant_id: session.activeTenant.id,
    conta_avulsa_id: id,
    campo_alterado: "rateio",
    valor_anterior: JSON.stringify(rateioAtual ?? []),
    valor_novo: JSON.stringify(rateioNovo),
    alterado_por: session.profile.id,
  });

  await logAuditEvent({
    acao: "conta_avulsa.rateio_alterado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: id,
    metadata: {
      linhas_anteriores: (rateioAtual ?? []).length,
      linhas_novas: rateioNovo.length,
    },
  });
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/validations/conta-avulsa.ts app/\(app\)/financeiro/contas-a-pagar/actions-avulsas.ts
git commit -m "task014: server actions da avulsa aceitam rateio (criar + editar)"
```

---

## Task 4: Server actions da recorrente (`criarContaRecorrente` + `editarContaRecorrente`)

**Files:**
- Modify: `lib/validations/conta-recorrente.ts`
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-recorrentes.ts`

**Interfaces:**
- Consumes: type `RateioLinhaInput` (Task 1), tabela `contas_avulsas_recorrentes_regionais` (Task 1), audit `conta_recorrente.rateio_alterado`.
- Produces: assinaturas estendidas de `criarContaRecorrente` e `editarContaRecorrente` aceitando `rateio`.

---

- [ ] **Step 1: Estender Zod em `lib/validations/conta-recorrente.ts`**

Reusar o `rateioSchema` de `conta-avulsa.ts` (via `import { rateioSchema } from "./conta-avulsa"`) e adicionar `rateio: rateioSchema` em `criarContaRecorrenteSchema`. Como `editarContaRecorrenteSchema` é derivado (`.omit({ empresa_id })`), ele automaticamente inclui.

- [ ] **Step 2: Modificar `criarContaRecorrente` em `actions-recorrentes.ts`**

Após o INSERT em `contas_avulsas_recorrentes` retornar `rec.id`, adicionar (mesmo padrão de avulsa, mas na tabela `_recorrentes_regionais`):

```ts
let rateioFinal = d.rateio;
if (d.job_id) {
  const { data: jobRow } = await supabase
    .from("jobs")
    .select("regional_id")
    .eq("id", d.job_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!jobRow?.regional_id) {
    return { ok: false, message: "Job selecionado não tem regional associada." };
  }
  rateioFinal = [{ regional_id: jobRow.regional_id, percentual: 100 }];
}

const rateioRows = rateioFinal.map((r) => ({
  tenant_id: session.activeTenant.id,
  recorrente_id: rec.id,
  regional_id: r.regional_id,
  percentual: r.percentual,
}));
const { error: rateioErr } = await supabase
  .from("contas_avulsas_recorrentes_regionais")
  .insert(rateioRows);

if (rateioErr) {
  await supabase.from("contas_avulsas_recorrentes").delete().eq("id", rec.id);
  return { ok: false, message: `Falha ao salvar rateio: ${rateioErr.message}` };
}
```

- [ ] **Step 3: Modificar `editarContaRecorrente`**

Mesmo padrão da avulsa: carrega atual, compara, delete-all + insert-all se mudou, audit `conta_recorrente.rateio_alterado`. Templates recorrentes **não têm tabela de histórico** análoga a `contas_avulsas_historico` — usa só o `logAuditEvent`.

```ts
const { data: rateioAtual } = await supabase
  .from("contas_avulsas_recorrentes_regionais")
  .select("regional_id, percentual")
  .eq("recorrente_id", id)
  .eq("tenant_id", session.activeTenant.id);

let rateioNovo = d.rateio;
if (d.job_id) {
  const { data: jobRow } = await supabase
    .from("jobs")
    .select("regional_id")
    .eq("id", d.job_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!jobRow?.regional_id) {
    return { ok: false, message: "Job selecionado não tem regional associada." };
  }
  rateioNovo = [{ regional_id: jobRow.regional_id, percentual: 100 }];
}

function normalizar(rows: Array<{ regional_id: string; percentual: number | string }>) {
  return rows
    .map((r) => `${r.regional_id}:${Number(r.percentual).toFixed(2)}`)
    .sort()
    .join("|");
}
const antesStr = normalizar(rateioAtual ?? []);
const depoisStr = normalizar(rateioNovo);

if (antesStr !== depoisStr) {
  const { error: delErr } = await supabase
    .from("contas_avulsas_recorrentes_regionais")
    .delete()
    .eq("recorrente_id", id);
  if (delErr) return { ok: false, message: `Falha ao apagar rateio: ${delErr.message}` };

  const novasRows = rateioNovo.map((r) => ({
    tenant_id: session.activeTenant.id,
    recorrente_id: id,
    regional_id: r.regional_id,
    percentual: r.percentual,
  }));
  const { error: insErr } = await supabase
    .from("contas_avulsas_recorrentes_regionais")
    .insert(novasRows);
  if (insErr) return { ok: false, message: `Falha ao salvar rateio: ${insErr.message}` };

  await logAuditEvent({
    acao: "conta_recorrente.rateio_alterado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
    metadata: {
      linhas_anteriores: (rateioAtual ?? []).length,
      linhas_novas: rateioNovo.length,
    },
  });
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/validations/conta-recorrente.ts app/\(app\)/financeiro/contas-a-pagar/actions-recorrentes.ts
git commit -m "task014: server actions da recorrente aceitam rateio (criar + editar)"
```

---

## Task 5: Cron copia rateio do template pra cada instância gerada

**Files:**
- Create: `supabase/migrations/20260808000002_gerar_recorrentes_v2.sql`

**Interfaces:**
- Consumes: função `calcular_proxima_data_recorrencia` (Task 013 já em produção), tabelas `contas_avulsas_recorrentes_regionais` (Task 1 desta feature), `contas_avulsas`, `contas_avulsas_regionais`.
- Produces: função `gerar_ocorrencias_recorrentes()` `CREATE OR REPLACE` com bloco adicional de INSERT bulk copiando o rateio.

---

- [ ] **Step 1: Criar migration**

Arquivo `supabase/migrations/20260808000002_gerar_recorrentes_v2.sql`:

```sql
-- =====================================================================
-- Task 014 — gerar_ocorrencias_recorrentes v2: copia rateio do template
-- Ver spec: docs/superpowers/specs/2026-08-08-rateio-regional-avulsa-design.md
--
-- Delta em relação à v1 (task 013): após INSERT em contas_avulsas, faz
-- INSERT bulk em contas_avulsas_regionais copiando as linhas do template.
-- =====================================================================

create or replace function public.gerar_ocorrencias_recorrentes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template  contas_avulsas_recorrentes%rowtype;
  v_geradas   integer := 0;
  v_nova_id   uuid;
  v_prox_data date;
begin
  for v_template in
    select *
      from public.contas_avulsas_recorrentes
     where ativo = true
       and proxima_data <= current_date
       and (data_fim is null or proxima_data <= data_fim)
     order by tenant_id, proxima_data
  loop
    -- INSERT da instância
    insert into public.contas_avulsas (
      tenant_id, empresa_id, descricao, valor, natureza,
      data_prevista_pagamento, status,
      fornecedor_id, cliente_id, job_id,
      plano_conta_tipo_id, plano_conta_subtipo_id,
      recorrente_id, criado_por
    ) values (
      v_template.tenant_id, v_template.empresa_id, v_template.descricao,
      v_template.valor, 'saida',
      v_template.proxima_data, 'pendente',
      v_template.fornecedor_id, v_template.cliente_id, v_template.job_id,
      v_template.plano_conta_tipo_id, v_template.plano_conta_subtipo_id,
      v_template.id, v_template.criado_por
    )
    returning id into v_nova_id;

    v_geradas := v_geradas + 1;

    -- Copia rateio do template (novo em v2)
    insert into public.contas_avulsas_regionais (
      tenant_id, conta_avulsa_id, regional_id, percentual
    )
    select
      v_template.tenant_id, v_nova_id, r.regional_id, r.percentual
      from public.contas_avulsas_recorrentes_regionais r
     where r.recorrente_id = v_template.id;

    -- Avança proxima_data
    v_prox_data := public.calcular_proxima_data_recorrencia(v_template);

    if v_template.data_fim is not null and v_prox_data > v_template.data_fim then
      update public.contas_avulsas_recorrentes
         set ativo = false, proxima_data = v_prox_data
       where id = v_template.id;
    else
      update public.contas_avulsas_recorrentes
         set proxima_data = v_prox_data
       where id = v_template.id;
    end if;

    -- Audit (mantém INSERT direto pra bypass do auth.uid())
    insert into public.audit_events (
      tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
    ) values (
      v_template.tenant_id, 'conta_recorrente', v_template.id::text,
      'conta_recorrente.ocorrencia_gerada', null,
      jsonb_build_object(
        'avulsa_id', v_nova_id,
        'data_movimento', v_template.proxima_data,
        'valor', v_template.valor
      )
    );
  end loop;

  return v_geradas;
end;
$$;

grant execute on function public.gerar_ocorrencias_recorrentes() to authenticated;
```

- [ ] **Step 2: Aplicar via MCP**

`mcp__supabase-write__apply_migration` com `name = "task014_gerar_recorrentes_v2"`.

Validar:

```sql
-- Confirma que a função existe (CREATE OR REPLACE não substitui a cron.schedule já ativa)
select proname, prosecdef
from pg_proc where proname='gerar_ocorrencias_recorrentes';

-- Confirma que o job cron continua ativo
select jobname, schedule, active
from cron.job where jobname='gerar-recorrentes-diario';
```

Expected: função presente com `prosecdef=true`, cron job continua com `active=true`.

- [ ] **Step 3: Chamada de teste**

```sql
select public.gerar_ocorrencias_recorrentes();
-- Expected: 0 (nenhum template pendente hoje, cenário normal)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260808000002_gerar_recorrentes_v2.sql
git commit -m "task014: cron v2 copia rateio do template pra cada instancia gerada"
```

---

## Task 6: Integração no drawer da avulsa

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx` (carrega `regionais ativas`)

**Interfaces:**
- Consumes: `<RateioRegionalEditor>` (Task 2), actions `criarContaAvulsa`/`editarContaAvulsa` estendidas (Task 3), type `Regional`.
- Produces: drawer que passa a exigir e mostrar rateio, respeita `jobRegionalId`.

---

- [ ] **Step 1: Modificar `page.tsx` — carregar `regionais ativas`**

Adicionar ao `Promise.all` da page:

```ts
supabase
  .from("regionais")
  .select("id, nome, ativo")
  .eq("tenant_id", session.activeTenant.id)
  .order("nome"),
```

Mapear pra `regionaisList`. Passar `regionais={regionaisList}` pra `<ContasAvulsasList>` que já repassa pro drawer.

- [ ] **Step 2: Modificar `ContasAvulsasList` pra aceitar props**

Adicionar prop `regionais: Array<{ id: string; nome: string; ativo: boolean }>` no interface. Repassar pro `<ContaAvulsaDrawer>`.

- [ ] **Step 3: Modificar `conta-avulsa-drawer.tsx`**

Adicionar prop `regionais` no discriminated union (ambos modes).

Importar `<RateioRegionalEditor>` e adicionar estado local `rateio`:

```ts
const [rateio, setRateio] = React.useState<RateioLinhaInput[]>(
  isEditar
    ? []  // preencido via effect abaixo quando conta chega
    : []  // vazio no criar até usuário adicionar
);
```

Em modo `editar`, quando `conta` chega, disparar useEffect que carrega o rateio existente. Como o drawer é aberto pela page detail (`/avulsa/[id]`), a page passa o rateio como prop nova `rateioInicial?: RateioLinhaInput[]`.

Adicionar bloco JSX entre Cliente e Plano de contas:

```tsx
<RateioRegionalEditor
  linhas={rateio}
  onChange={setRateio}
  regionais={props.regionais}
  jobRegionalId={jobSelecionado?.regional_id ?? null}
  disabled={pending}
/>
```

Passa `rateio` no submit chamando a action. Se soma != 100, desabilita botão de submit.

- [ ] **Step 4: Modificar `JobResumido` no drawer pra incluir `regional_id`**

O tipo `JobResumido` já tem `cliente_id` (Task 013). Adicionar `regional_id: string | null`:

```ts
type JobResumido = { id: string; codigo: string; nome: string; cliente_id: string | null; regional_id: string | null };
```

E atualizar `page.tsx` (query dos jobs) pra incluir `regional_id` no select. Adaptar mapping.

- [ ] **Step 5: Propagar props em `avulsas-list.tsx` + `page.tsx` do detail**

`app/(app)/financeiro/contas-a-pagar/avulsas-list.tsx` — o interface Props já tem jobs; adicionar `regionais`. Repassar pra drawer.

`app/(app)/financeiro/contas-a-pagar/avulsa/[id]/page.tsx` (detail) — passar `regionais` e `rateioInicial` pro `<ContaAvulsaDrawer mode="editar">`.

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx app/\(app\)/financeiro/contas-a-pagar/avulsas-list.tsx app/\(app\)/financeiro/contas-a-pagar/page.tsx app/\(app\)/financeiro/contas-a-pagar/avulsa/\[id\]/page.tsx
git commit -m "task014: drawer da avulsa usa RateioRegionalEditor"
```

---

## Task 7: Integração no drawer da recorrente

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/conta-recorrente-drawer.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/recorrentes-list.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/page.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/acoes-client.tsx`

**Interfaces:**
- Consumes: análogo à Task 6 mas pra recorrente.
- Produces: drawer da recorrente com bloco de rateio funcional.

---

- [ ] **Step 1: Modificar `conta-recorrente-drawer.tsx`**

Mesmo padrão da Task 6:
- Adicionar prop `regionais` na discriminated union.
- Adicionar prop `rateioInicial?: RateioLinhaInput[]` em modo editar.
- Adicionar estado `rateio` + bloco JSX com `<RateioRegionalEditor>` entre Cliente e Plano de contas.
- Estender `JobResumido` com `regional_id: string | null`.
- Submit passa `rateio` pra action.

- [ ] **Step 2: Modificar `recorrentes-list.tsx`**

Adicionar prop `regionais` no interface. Repassar pro drawer (modo criar).

Adicionar `regional_id` no `RecorrenteRow` type e no mapping do `page.tsx` que popula (Task 8 do plano 013 fez algo similar). Ver `page.tsx` da tab pra ajustar.

- [ ] **Step 3: Modificar `recorrente/[id]/page.tsx` (detail)**

Adicionar 1 query nova ao `Promise.all`:

```ts
supabase
  .from("contas_avulsas_recorrentes_regionais")
  .select("regional_id, percentual")
  .eq("recorrente_id", params.id)
  .eq("tenant_id", session.activeTenant.id),
```

Mapear resultado pra `rateioInicial: RateioLinhaInput[]` (convertendo `percentual: string → number`). Passar pro `<EditarRecorrenteButton>` que fica em `acoes-client.tsx`.

Também carregar `regionais ativas` na mesma page (ou reusar list global).

- [ ] **Step 4: Modificar `acoes-client.tsx`**

`EditarRecorrenteButton` ganha prop `regionais` + `rateioInicial`. Repassa pro `<ContaRecorrenteDrawer mode="editar">`.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/conta-recorrente-drawer.tsx app/\(app\)/financeiro/contas-a-pagar/recorrentes-list.tsx app/\(app\)/financeiro/contas-a-pagar/recorrente/\[id\]
git commit -m "task014: drawer da recorrente usa RateioRegionalEditor + carrega rateio no editar"
```

---

## Task 8: Card `<RateioCard>` nas páginas de detalhes

**Files:**
- Create: `app/(app)/financeiro/contas-a-pagar/rateio-card.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/page.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/page.tsx`

**Interfaces:**
- Consumes: type `RateioLinhaInput` + type `Regional` de `@/lib/types` (nome apenas).
- Produces: Component `<RateioCard rateio valorTotal regionaisPorId />`.

---

- [ ] **Step 1: Criar `rateio-card.tsx`**

```tsx
import { MapPin } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface RateioItem {
  regional_id: string;
  percentual: number;
}

interface Props {
  rateio: RateioItem[];
  valorTotal: number;
  regionaisPorId: Map<string, { nome: string; ativo: boolean }>;
}

function formatPct(n: number): string {
  return n.toFixed(2);
}

export function RateioCard({ rateio, valorTotal, regionaisPorId }: Props) {
  if (rateio.length === 0) return null;

  // Última linha "pega a sobra" pra render em R$
  const valores: number[] = rateio.map((r, idx) => {
    if (idx < rateio.length - 1) {
      return Number(((valorTotal * r.percentual) / 100).toFixed(2));
    }
    // Última linha: pega a sobra
    const somaAnteriores = rateio
      .slice(0, -1)
      .reduce((s, x) => s + Number(((valorTotal * x.percentual) / 100).toFixed(2)), 0);
    return Number((valorTotal - somaAnteriores).toFixed(2));
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
        <MapPin className="mr-1.5 inline-block h-4 w-4" />
        Rateio de regional
      </h2>
      <div className="space-y-1.5">
        {rateio.map((r, idx) => {
          const reg = regionaisPorId.get(r.regional_id);
          return (
            <div
              key={r.regional_id}
              className="flex items-center justify-between text-sm"
            >
              <span className={reg?.ativo === false ? "text-muted-foreground" : ""}>
                {reg?.nome ?? "—"}
                {reg?.ativo === false ? " (inativa)" : ""}
              </span>
              <span className="flex items-center gap-4">
                <span className="w-16 text-right font-mono text-xs">
                  {formatPct(r.percentual)}%
                </span>
                <span className="w-32 text-right font-mono text-xs font-semibold">
                  {formatCurrency(valores[idx], "BRL")}
                </span>
              </span>
            </div>
          );
        })}
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
          <span>Total</span>
          <span className="flex items-center gap-4">
            <span className="w-16 text-right font-mono text-xs">100.00%</span>
            <span className="w-32 text-right font-mono text-xs">
              {formatCurrency(valorTotal, "BRL")}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Modificar `avulsa/[id]/page.tsx`**

Adicionar query do rateio ao `Promise.all`:

```ts
supabase
  .from("contas_avulsas_regionais")
  .select("regional_id, percentual")
  .eq("conta_avulsa_id", params.id)
  .eq("tenant_id", session.activeTenant.id),
```

E carregar `regionais` (id, nome, ativo) do tenant.

Mapear:

```ts
const rateio = (rateioRes.data ?? []).map((r) => ({
  regional_id: r.regional_id,
  percentual: Number(r.percentual),
}));
const regionaisPorId = new Map(
  (regionaisRes.data ?? []).map((r: { id: string; nome: string; ativo: boolean }) => [
    r.id,
    { nome: r.nome, ativo: r.ativo },
  ]),
);
```

Renderizar `<RateioCard rateio={rateio} valorTotal={Number(c.valor)} regionaisPorId={regionaisPorId} />` após o card Detalhes.

- [ ] **Step 3: Modificar `recorrente/[id]/page.tsx`**

Análogo: carrega `contas_avulsas_recorrentes_regionais` + `regionais`, renderiza `<RateioCard>` (valorTotal = valor do template).

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/rateio-card.tsx app/\(app\)/financeiro/contas-a-pagar/avulsa/\[id\]/page.tsx app/\(app\)/financeiro/contas-a-pagar/recorrente/\[id\]/page.tsx
git commit -m "task014: card <RateioCard> nas paginas de detalhes"
```

---

## Task 9: Badge "Rateado" na conciliação

**Files:**
- Modify: `app/(app)/financeiro/conciliacao/page.tsx`
- Modify: `app/(app)/financeiro/conciliacao/conciliacao-list.tsx`

**Interfaces:**
- Consumes: tabela `contas_avulsas_regionais` (Task 1), embed via PostgREST.
- Produces: badge visual + popover ao hover/click no lançamento com >1 linha de rateio.

---

- [ ] **Step 1: Modificar `page.tsx` da conciliação — embed no select**

Localizar a query principal de `lancamentos_financeiros`. No `.select(...)`, adicionar embed:

```ts
.select(`
  ...campos existentes...,
  conta_avulsa:contas_avulsas!conta_avulsa_id(
    rateio:contas_avulsas_regionais(
      percentual,
      regional:regionais(nome)
    )
  )
`)
```

Ao mapear as linhas do result pra shape que o `<ConciliacaoList>` consome, adicionar `rateio: Array<{ percentual: number; regional_nome: string }>` no type `LancamentoLinha`.

Extrair:

```ts
const rateio = (r.conta_avulsa?.rateio ?? []).map((rr: any) => ({
  percentual: Number(rr.percentual),
  regional_nome: rr.regional?.nome ?? "—",
}));
```

- [ ] **Step 2: Modificar `conciliacao-list.tsx` — badge + popover**

Adicionar campo `rateio` no interface `LancamentoLinha` (import de `saldo-conta.ts` se aplicável).

Na coluna Descrição, quando `l.rateio.length > 1`, renderizar badge:

```tsx
{l.rateio && l.rateio.length > 1 && (
  <span
    className="ml-2 inline-flex items-center rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-700"
    title={l.rateio
      .map((r) => `${r.regional_nome}: ${r.percentual.toFixed(2)}%`)
      .join("\n")}
  >
    Rateado
  </span>
)}
```

Usar `title` HTML (tooltip nativo) como fallback simples. Se quiser popover full (Radix Popover), envolver o `<span>` num `<Popover>` com trigger e content — mas o title HTML resolve o essencial sem dependência extra.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/financeiro/conciliacao/page.tsx app/\(app\)/financeiro/conciliacao/conciliacao-list.tsx
git commit -m "task014: badge Rateado na conciliacao + tooltip com breakdown"
```

---

## Self-Review

**1. Spec coverage:**

- Seção 3 (decisões): 3.1 percentual — Task 1 (schema); 3.2 tabelas filhas — Task 1; 3.3 trigger DEFERRABLE — Task 1; 3.4 job trava 100% — Tasks 3/4 (server actions) + Task 2 (editor); 3.5 obrigatória — Task 1 (schema check) + Task 3/4 (Zod min 1); 3.6 template guarda rateio + cron copia — Task 4 (server action) + Task 5 (cron); 3.7 conciliação não muda + badge — Task 9; 3.8 PP fora de escopo — nenhuma task, correto. ✅
- Seção 4 (modelagem) — Task 1. ✅
- Seção 5 (regras): 5.1 criar avulsa — Task 3; 5.2 editar — Task 3; 5.3 job trava — Task 3/4; 5.4 criar template — Task 4; 5.5 editar template — Task 4; 5.6 cron copia — Task 5; 5.7 baixa não muda — sem task (nada muda); 5.8 estorno — sem task; 5.9 regional inativa — Task 2 (renderiza com "(inativa)"). ✅
- Seção 6 (server actions + Zod) — Tasks 3, 4. ✅
- Seção 7 (UI): 7.1 bloco no drawer — Tasks 2, 6, 7; 7.2 card detalhes — Task 8; 7.3 badge conciliação — Task 9. ✅
- Seção 8 (RLS/audit) — Task 1 (RLS + GRANT) + Tasks 3, 4 (audit em edição). ✅
- Seção 10 (migrations) — Tasks 1, 5. ✅

**2. Placeholder scan:** revisei procurando "TBD", "TODO", "implement later" — nenhum. Passagens que dizem "análogo a X" incluem o código concreto ou apontam pra arquivo real que o implementador lê.

**3. Type consistency:**
- `RateioLinhaInput` — Task 1 define, Tasks 2, 3, 4, 6, 7, 8 consomem com mesmo nome.
- `ContaAvulsaRateio` / `ContaAvulsaRecorrenteRateio` — Task 1, consumidos em queries.
- Actions `criarContaAvulsa`, `editarContaAvulsa`, `criarContaRecorrente`, `editarContaRecorrente` — assinaturas expandidas nas Tasks 3, 4; consumidas nas Tasks 6, 7.
- Component `<RateioRegionalEditor>` — Task 2, props usadas em Tasks 6, 7.
- Component `<RateioCard>` — Task 8, usado em detail pages.
- Tabela `contas_avulsas_regionais` — nome consistente em toda spec e plan.
- Tabela `contas_avulsas_recorrentes_regionais` — idem.
- Funções `enforce_rateio_soma_100_avulsa` e `enforce_rateio_soma_100_recorrente` — Task 1, referenciadas por triggers no mesmo arquivo.

Sem inconsistências detectadas.
