# Contas Avulsas Recorrentes — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Templates de conta avulsa recorrente que geram automaticamente novas contas pendentes na data de vencimento via `pg_cron` diário, com dialog contextual pra "só cancelar esta ocorrência ou parar toda a recorrência" ao excluir/estornar instância gerada.

**Architecture:** Nova tabela `contas_avulsas_recorrentes` (template) + FK opcional `contas_avulsas.recorrente_id`. Funções Postgres puras pra cálculo de próxima data (`data_quinzena_do_mes`, `calcular_proxima_data_recorrencia`, `calcular_proxima_data_inicial`). Cron `pg_cron` roda `gerar_ocorrencias_recorrentes()` 03h SP diariamente, inserindo instâncias como `contas_avulsas` pendentes e avançando `proxima_data`. UI: 3ª aba "Recorrências" em `/financeiro/contas-a-pagar`, drawer separado, página de detalhes com histórico.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase (Postgres + Auth + RLS + `pg_cron`), Tailwind, shadcn/ui, Radix, lucide-react, React Hook Form + Zod.

## Global Constraints

Aplicam a **todas** as tasks. Copiados verbatim de `CLAUDE.md`, `docs/PERFORMANCE.md` e da spec (`docs/superpowers/specs/2026-08-07-contas-avulsas-recorrentes-design.md`).

- **Performance é feature.** Leia `docs/PERFORMANCE.md` antes de tocar `app/(app)/**` ou `lib/supabase/**`.
- **Ortografia pt-BR completa em toda string visível ao usuário.** Sem `Voce`, `Nao`, `Descricao`, `Acao`, `E obrigatorio`.
- **RLS ≠ GRANT.** Toda migration que cria tabela termina com `grant select, insert, update, delete on ... to authenticated`.
- **Toda tabela operacional tem `tenant_id`** com FK pra `tenants` e RLS via `is_tenant_member(tenant_id)`.
- **Server action pattern:** `requireSession()` → parse Zod → verificar `tenant_id` → executar → `logAuditEvent` → `revalidatePath`.
- **Gate `admin | financeiro`** em toda action do módulo via `checarGateFinanceiro` (helper duplicado do padrão existente).
- **RPCs `SECURITY DEFINER`** derivam `criado_por` de `auth.uid()` internamente quando cabível. Cron não tem `auth.uid()` — usa `criado_por` do template.
- **Radix `<SelectItem>` NUNCA aceita `value=""`** — usar sentinel `"__none__"` e traduzir pra `null` no submit.
- **`<DrawerContent>` não aceita prop `title`** — composition com `<DialogHeader><DialogTitle>`.
- **DatePicker em drawer:** `side="bottom"` + `sideOffset={6}` + `collisionPadding={16}` + largura fixa + `<Calendar fixedWeeks>`.
- **Colunas numéricas do Postgres:** sempre `Number(...)` ao ler no TypeScript.
- **Datas sem timezone (`date`) vão e voltam como `YYYY-MM-DD`.** Nunca `new Date(dbDate)` sem parse manual.
- **`prefetch={false}` em `<Link>` de listas.**
- **`force-dynamic` em pages autenticadas.**
- **`empresa_id` do template é imutável** após criação (Zod de `editarContaRecorrente` não aceita o campo).
- **`natureza` é sempre `'saida'`** (contas a pagar). Não exposto no form.
- **Enum split rule:** `ALTER TYPE ADD VALUE` não pode ser usado no mesmo statement que consome o valor. Nesta feature só criamos 1 enum novo (`frequencia_recorrencia`) — não há split necessário.
- **`pg_cron` roda em UTC.** Configuração usa expressão UTC (`0 6 * * *` = 06:00 UTC = 03:00 America/Sao_Paulo). Comentário no SQL explicita.
- **Antes de commit:** rodar `npx tsc --noEmit && npx next lint` — exit code 0 obrigatório.

---

## Estrutura de arquivos

### Migrations (ordem sequencial obrigatória)

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260807000001_contas_avulsas_recorrentes.sql` | Enum `frequencia_recorrencia`, table `contas_avulsas_recorrentes`, coluna `contas_avulsas.recorrente_id`, índices, RLS, GRANT |
| `supabase/migrations/20260807000002_pg_cron_setup.sql` | `CREATE EXTENSION pg_cron` + grant |
| `supabase/migrations/20260807000003_calcular_proxima_data.sql` | Funções `data_quinzena_do_mes`, `calcular_proxima_data_recorrencia`, `calcular_proxima_data_inicial` |
| `supabase/migrations/20260807000004_gerar_recorrentes.sql` | Função `gerar_ocorrencias_recorrentes` + `cron.schedule` |

### Types e utilitários

| Arquivo | Ação |
|---|---|
| `lib/types.ts` | Adicionar tipos: `FrequenciaRecorrencia`, `ContaAvulsaRecorrente`; ajustar `ContaAvulsa` pra ter `recorrente_id` |
| `lib/auth/audit.ts` | Adicionar audit actions |
| `lib/validations/conta-recorrente.ts` | **Criar** — Zod schemas de criar + editar |

### Server actions

| Arquivo | Ação |
|---|---|
| `app/(app)/financeiro/contas-a-pagar/actions-recorrentes.ts` | **Criar** — 5 actions (criar, editar, pausar, reativar, excluir) |
| `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts` | **Modify** — `excluirContaAvulsa` e `estornarBaixaAvulsa` aceitam `parar_recorrencia?: boolean` |

### UI

| Arquivo | Ação |
|---|---|
| `app/(app)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx` | **Modify** — 3ª aba "Recorrências" + badge de contagem |
| `app/(app)/financeiro/contas-a-pagar/page.tsx` | **Modify** — nova query pra recorrentes + count de ativos + repassar props |
| `app/(app)/financeiro/contas-a-pagar/recorrentes-list.tsx` | **Criar** — lista da aba com filtros/busca |
| `app/(app)/financeiro/contas-a-pagar/conta-recorrente-drawer.tsx` | **Criar** — drawer criar/editar template |
| `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/page.tsx` | **Criar** — página de detalhes com histórico de instâncias |
| `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/acoes-client.tsx` | **Criar** — wrappers client dos botões (pausar/reativar/editar/excluir) |
| `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/historico-ocorrencias.tsx` | **Criar** — tabela de instâncias geradas |
| `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/acoes-client.tsx` | **Modify** — dialog contextual quando `recorrente_id != null` |
| `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/cancelar-baixa-avulsa-modal.tsx` | **Modify** — variante do modal quando recorrente |

---

## Task 1: Migration schema + FK + types + audit

**Files:**
- Create: `supabase/migrations/20260807000001_contas_avulsas_recorrentes.sql`
- Modify: `lib/types.ts` (adicionar bloco)
- Modify: `lib/auth/audit.ts` (adicionar linhas ao union)

**Interfaces:**
- Consumes: `public.tenants(id)`, `public.empresas(id)`, `public.profiles(id)`, `public.fornecedores(id)`, `public.clientes(id)`, `public.jobs(id)`, `public.plano_contas_tipos(id)`, `public.plano_contas_subtipos(id)`, `public.contas_avulsas(id)`, `public.is_tenant_member(uuid)`, `public.set_updated_at()`.
- Produces:
  - Enum `public.frequencia_recorrencia` = `quinzenal | mensal | anual`.
  - Table `public.contas_avulsas_recorrentes` com CHECKs por frequência.
  - Coluna `contas_avulsas.recorrente_id uuid null references contas_avulsas_recorrentes(id) on delete set null` + índice parcial.
  - Types TS: `FrequenciaRecorrencia`, `ContaAvulsaRecorrente`, ajuste em `ContaAvulsa`.
  - Audit actions: `conta_recorrente.criada|.editada|.pausada|.reativada|.excluida|.ocorrencia_gerada`.

---

- [ ] **Step 1: Criar migration**

Arquivo `supabase/migrations/20260807000001_contas_avulsas_recorrentes.sql`:

```sql
-- =====================================================================
-- Task 013 — contas_avulsas_recorrentes (template + FK em avulsa)
-- Ver spec: docs/superpowers/specs/2026-08-07-contas-avulsas-recorrentes-design.md
-- =====================================================================

-- 1) Enum de frequência
do $$ begin
  create type frequencia_recorrencia as enum ('quinzenal', 'mensal', 'anual');
exception when duplicate_object then null;
end $$;

-- 2) Tabela principal (template)
create table if not exists public.contas_avulsas_recorrentes (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete restrict,
  empresa_id                  uuid not null references public.empresas(id) on delete restrict,
  descricao                   text not null,
  valor                       numeric(14,2) not null,
  fornecedor_id               uuid references public.fornecedores(id) on delete restrict,
  cliente_id                  uuid references public.clientes(id) on delete restrict,
  job_id                      uuid references public.jobs(id) on delete restrict,
  plano_conta_tipo_id         uuid not null references public.plano_contas_tipos(id) on delete restrict,
  plano_conta_subtipo_id      uuid not null references public.plano_contas_subtipos(id) on delete restrict,

  frequencia                  frequencia_recorrencia not null,
  dia_do_mes                  smallint,
  dia_quinzena_1              smallint,
  dia_quinzena_2              smallint,
  dia_do_ano_dia              smallint,
  dia_do_ano_mes              smallint,

  proxima_data                date not null,
  data_fim                    date,

  ativo                       boolean not null default true,
  criado_por                  uuid not null references public.profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint chk_rec_valor_positivo check (valor > 0),
  constraint chk_rec_descricao_nao_vazia check (length(trim(descricao)) >= 3),

  constraint chk_rec_frequencia_mensal check (
    frequencia <> 'mensal' or (
      dia_do_mes is not null and dia_do_mes between 1 and 31
      and dia_quinzena_1 is null and dia_quinzena_2 is null
      and dia_do_ano_dia is null and dia_do_ano_mes is null
    )
  ),
  constraint chk_rec_frequencia_quinzenal check (
    frequencia <> 'quinzenal' or (
      dia_quinzena_1 is not null and dia_quinzena_2 is not null
      and dia_quinzena_1 between 1 and 31
      and dia_quinzena_2 between 1 and 31
      and dia_quinzena_1 < dia_quinzena_2
      and dia_do_mes is null
      and dia_do_ano_dia is null and dia_do_ano_mes is null
    )
  ),
  constraint chk_rec_frequencia_anual check (
    frequencia <> 'anual' or (
      dia_do_ano_dia is not null and dia_do_ano_dia between 1 and 31
      and dia_do_ano_mes is not null and dia_do_ano_mes between 1 and 12
      and dia_do_mes is null
      and dia_quinzena_1 is null and dia_quinzena_2 is null
    )
  ),

  constraint chk_rec_data_fim_ordem check (
    data_fim is null or data_fim >= proxima_data
  )
);

create index if not exists idx_rec_tenant on public.contas_avulsas_recorrentes(tenant_id);
create index if not exists idx_rec_empresa on public.contas_avulsas_recorrentes(empresa_id);
create index if not exists idx_rec_ativos_prox_data
  on public.contas_avulsas_recorrentes(tenant_id, ativo, proxima_data)
  where ativo = true;
create index if not exists idx_rec_fornecedor on public.contas_avulsas_recorrentes(fornecedor_id);

drop trigger if exists trg_rec_updated_at on public.contas_avulsas_recorrentes;
create trigger trg_rec_updated_at
  before update on public.contas_avulsas_recorrentes
  for each row execute function public.set_updated_at();

alter table public.contas_avulsas_recorrentes enable row level security;

drop policy if exists rec_select on public.contas_avulsas_recorrentes;
create policy rec_select on public.contas_avulsas_recorrentes
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists rec_insert on public.contas_avulsas_recorrentes;
create policy rec_insert on public.contas_avulsas_recorrentes
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists rec_update on public.contas_avulsas_recorrentes;
create policy rec_update on public.contas_avulsas_recorrentes
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists rec_delete on public.contas_avulsas_recorrentes;
create policy rec_delete on public.contas_avulsas_recorrentes
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.contas_avulsas_recorrentes to authenticated;

-- 3) FK opcional em contas_avulsas
alter table public.contas_avulsas
  add column if not exists recorrente_id uuid
    references public.contas_avulsas_recorrentes(id) on delete set null;

create index if not exists idx_avulsas_recorrente
  on public.contas_avulsas(recorrente_id)
  where recorrente_id is not null;
```

- [ ] **Step 2: Aplicar via MCP**

Chamar `mcp__supabase-write__apply_migration` com `name = "task013_contas_avulsas_recorrentes"` e `query` = conteúdo do arquivo.

Validar com `mcp__supabase__execute_sql`:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'contas_avulsas_recorrentes'
order by ordinal_position;
```

Expected: 20 colunas conforme spec.

E validar FK:

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='contas_avulsas' and column_name = 'recorrente_id';
```

Expected: 1 row.

- [ ] **Step 3: Adicionar types em `lib/types.ts`**

Adicionar em local coerente com os outros types financeiros:

```ts
export type FrequenciaRecorrencia = "quinzenal" | "mensal" | "anual";

export const frequenciaRecorrenciaLabel = (f: FrequenciaRecorrencia): string =>
  ({
    quinzenal: "Quinzenal",
    mensal: "Mensal",
    anual: "Anual",
  })[f];

export interface ContaAvulsaRecorrente {
  id: string;
  tenant_id: string;
  empresa_id: string;
  descricao: string;
  valor: string; // numeric → string do supabase-js
  fornecedor_id: string | null;
  cliente_id: string | null;
  job_id: string | null;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
  frequencia: FrequenciaRecorrencia;
  dia_do_mes: number | null;
  dia_quinzena_1: number | null;
  dia_quinzena_2: number | null;
  dia_do_ano_dia: number | null;
  dia_do_ano_mes: number | null;
  proxima_data: string; // YYYY-MM-DD
  data_fim: string | null; // YYYY-MM-DD
  ativo: boolean;
  criado_por: string;
  created_at: string;
  updated_at: string;
}
```

E ajustar `ContaAvulsa` — adicionar `recorrente_id: string | null` logo depois de `conta_bancaria_baixa_id`. Ler o interface atual pra localizar posição correta.

- [ ] **Step 4: Adicionar audit actions em `lib/auth/audit.ts`**

Antes de `| "acao_negada"`, adicionar:

```ts
  | "conta_recorrente.criada"
  | "conta_recorrente.editada"
  | "conta_recorrente.pausada"
  | "conta_recorrente.reativada"
  | "conta_recorrente.excluida"
  | "conta_recorrente.ocorrencia_gerada"
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260807000001_contas_avulsas_recorrentes.sql lib/types.ts lib/auth/audit.ts
git commit -m "task013: schema contas_avulsas_recorrentes + FK em avulsa"
```

---

## Task 2: Migration `pg_cron` setup

**Files:**
- Create: `supabase/migrations/20260807000002_pg_cron_setup.sql`

**Interfaces:**
- Consumes: nada (só habilita extensão).
- Produces: extensão `pg_cron` habilitada no schema `extensions`; schema `cron` acessível.

**Nota crítica:** `pg_cron` está disponível no projeto Supabase mas não instalado (verificado — `installed_version = null`). Uma vez habilitado, expõe schema `cron` com `cron.schedule(...)`, `cron.unschedule(...)`, `cron.job`, `cron.job_run_details`.

---

- [ ] **Step 1: Criar migration**

Arquivo `supabase/migrations/20260807000002_pg_cron_setup.sql`:

```sql
-- =====================================================================
-- Task 013 — Habilita pg_cron (para geração automática de ocorrências
-- de contas avulsas recorrentes).
--
-- Extensão fica no schema `extensions` (padrão Supabase). Chamadas usam
-- `cron.schedule('nome', 'expressão cron UTC', $$sql$$)`.
--
-- IMPORTANTE: cron.schedule usa UTC. A conversão de fuso é feita na
-- expressão: '0 6 * * *' = 06:00 UTC = 03:00 America/Sao_Paulo.
-- =====================================================================

create extension if not exists pg_cron with schema extensions;

grant usage on schema cron to postgres;
```

- [ ] **Step 2: Aplicar via MCP**

`mcp__supabase-write__apply_migration` com `name = "task013_pg_cron_setup"`.

Validar:

```sql
select extname, extnamespace::regnamespace as schema
from pg_extension where extname = 'pg_cron';
```

Expected: 1 row com `schema = extensions`.

E validar acesso ao schema cron:

```sql
select schema_name from information_schema.schemata where schema_name = 'cron';
```

Expected: 1 row.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260807000002_pg_cron_setup.sql
git commit -m "task013: habilita extensao pg_cron"
```

---

## Task 3: Funções auxiliares de cálculo de próxima data

**Files:**
- Create: `supabase/migrations/20260807000003_calcular_proxima_data.sql`

**Interfaces:**
- Consumes: tabela `contas_avulsas_recorrentes` (Task 1), enum `frequencia_recorrencia`.
- Produces:
  - Function `public.data_quinzena_do_mes(p_ano int, p_mes int, p_dia int) returns date` — IMMUTABLE. Retorna `make_date(ano, mes, LEAST(dia, último_dia_do_mes))`.
  - Function `public.calcular_proxima_data_recorrencia(p_template contas_avulsas_recorrentes) returns date` — IMMUTABLE. Recebe row completa, retorna próxima data conforme frequência (assume que `p_template.proxima_data` é a última data gerada).
  - Function `public.calcular_proxima_data_inicial(p_frequencia frequencia_recorrencia, p_dia_do_mes smallint, p_dia_quinzena_1 smallint, p_dia_quinzena_2 smallint, p_dia_do_ano_dia smallint, p_dia_do_ano_mes smallint) returns date` — STABLE. Calcula a primeira data válida a partir de `current_date`.

---

- [ ] **Step 1: Criar migration**

Arquivo `supabase/migrations/20260807000003_calcular_proxima_data.sql`:

```sql
-- =====================================================================
-- Task 013 — Funções auxiliares de cálculo de próxima data recorrência
-- Encapsulam a regra "último dia se >28" (clamping do dia_desejado ao
-- último dia do mês quando o mês não tem o dia pedido).
-- =====================================================================

-- 1) Helper: retorna make_date(ano, mes, LEAST(dia, último_dia_do_mes)).
create or replace function public.data_quinzena_do_mes(
  p_ano int, p_mes int, p_dia int
)
returns date
language sql
immutable
as $$
  select make_date(
    p_ano,
    p_mes,
    least(
      p_dia,
      extract(day from (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day'))::int
    )
  );
$$;

grant execute on function public.data_quinzena_do_mes(int, int, int) to authenticated;

-- 2) Próxima data para o cron: recebe template inteiro (linha da tabela)
--    e retorna a data seguinte, avançando conforme frequência.
create or replace function public.calcular_proxima_data_recorrencia(
  p_template contas_avulsas_recorrentes
)
returns date
language plpgsql
immutable
as $$
declare
  v_base date := p_template.proxima_data;
  v_prox date;
  v_ano int;
  v_mes int;
  v_datas date[];
begin
  case p_template.frequencia
    when 'mensal' then
      v_ano := extract(year from (v_base + interval '1 month'))::int;
      v_mes := extract(month from (v_base + interval '1 month'))::int;
      v_prox := public.data_quinzena_do_mes(v_ano, v_mes, p_template.dia_do_mes);

    when 'quinzenal' then
      -- Gera 4 candidatas (mês atual + próximo). Retorna a menor > v_base.
      v_datas := ARRAY[
        public.data_quinzena_do_mes(
          extract(year from v_base)::int,
          extract(month from v_base)::int,
          p_template.dia_quinzena_1),
        public.data_quinzena_do_mes(
          extract(year from v_base)::int,
          extract(month from v_base)::int,
          p_template.dia_quinzena_2),
        public.data_quinzena_do_mes(
          extract(year from (v_base + interval '1 month'))::int,
          extract(month from (v_base + interval '1 month'))::int,
          p_template.dia_quinzena_1),
        public.data_quinzena_do_mes(
          extract(year from (v_base + interval '1 month'))::int,
          extract(month from (v_base + interval '1 month'))::int,
          p_template.dia_quinzena_2)
      ];
      select min(d) into v_prox
        from unnest(v_datas) as d
       where d > v_base;

    when 'anual' then
      v_ano := (extract(year from v_base)::int) + 1;
      v_prox := public.data_quinzena_do_mes(v_ano, p_template.dia_do_ano_mes, p_template.dia_do_ano_dia);
  end case;

  return v_prox;
end;
$$;

grant execute on function public.calcular_proxima_data_recorrencia(contas_avulsas_recorrentes) to authenticated;

-- 3) Primeira data inicial ao criar template (ancorada em current_date).
create or replace function public.calcular_proxima_data_inicial(
  p_frequencia frequencia_recorrencia,
  p_dia_do_mes smallint,
  p_dia_quinzena_1 smallint,
  p_dia_quinzena_2 smallint,
  p_dia_do_ano_dia smallint,
  p_dia_do_ano_mes smallint
)
returns date
language plpgsql
stable
as $$
declare
  v_hoje date := current_date;
  v_ano int := extract(year from v_hoje)::int;
  v_mes int := extract(month from v_hoje)::int;
  v_prox date;
  v_datas date[];
begin
  case p_frequencia
    when 'mensal' then
      v_prox := public.data_quinzena_do_mes(v_ano, v_mes, p_dia_do_mes);
      if v_prox <= v_hoje then
        v_prox := public.data_quinzena_do_mes(
          extract(year from (make_date(v_ano, v_mes, 1) + interval '1 month'))::int,
          extract(month from (make_date(v_ano, v_mes, 1) + interval '1 month'))::int,
          p_dia_do_mes
        );
      end if;

    when 'quinzenal' then
      v_datas := ARRAY[
        public.data_quinzena_do_mes(v_ano, v_mes, p_dia_quinzena_1),
        public.data_quinzena_do_mes(v_ano, v_mes, p_dia_quinzena_2),
        public.data_quinzena_do_mes(
          extract(year from (make_date(v_ano, v_mes, 1) + interval '1 month'))::int,
          extract(month from (make_date(v_ano, v_mes, 1) + interval '1 month'))::int,
          p_dia_quinzena_1),
        public.data_quinzena_do_mes(
          extract(year from (make_date(v_ano, v_mes, 1) + interval '1 month'))::int,
          extract(month from (make_date(v_ano, v_mes, 1) + interval '1 month'))::int,
          p_dia_quinzena_2)
      ];
      select min(d) into v_prox from unnest(v_datas) as d where d > v_hoje;

    when 'anual' then
      v_prox := public.data_quinzena_do_mes(v_ano, p_dia_do_ano_mes, p_dia_do_ano_dia);
      if v_prox <= v_hoje then
        v_prox := public.data_quinzena_do_mes(v_ano + 1, p_dia_do_ano_mes, p_dia_do_ano_dia);
      end if;
  end case;

  return v_prox;
end;
$$;

grant execute on function public.calcular_proxima_data_inicial(
  frequencia_recorrencia, smallint, smallint, smallint, smallint, smallint
) to authenticated;
```

- [ ] **Step 2: Aplicar via MCP**

`mcp__supabase-write__apply_migration` com `name = "task013_calcular_proxima_data"`.

- [ ] **Step 3: Testes manuais das 3 frequências**

Executar via `mcp__supabase__execute_sql`:

```sql
-- Mensal dia 5, base 05/08/2026 → esperado 05/09/2026
select public.calcular_proxima_data_recorrencia(
  row(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Aluguel', 3000,
      null, null, null, gen_random_uuid(), gen_random_uuid(),
      'mensal', 5, null, null, null, null,
      '2026-08-05'::date, null, true, gen_random_uuid(),
      now(), now())::contas_avulsas_recorrentes
);
-- Expected: 2026-09-05

-- Mensal dia 31, base 31/01/2026 → esperado 28/02/2026 (fev não bissexto)
select public.calcular_proxima_data_recorrencia(
  row(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Aluguel', 3000,
      null, null, null, gen_random_uuid(), gen_random_uuid(),
      'mensal', 31, null, null, null, null,
      '2026-01-31'::date, null, true, gen_random_uuid(),
      now(), now())::contas_avulsas_recorrentes
);
-- Expected: 2026-02-28

-- Quinzenal dias 5 e 20, base 05/08/2026 → esperado 20/08/2026
select public.calcular_proxima_data_recorrencia(
  row(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Salário', 5000,
      null, null, null, gen_random_uuid(), gen_random_uuid(),
      'quinzenal', null, 5, 20, null, null,
      '2026-08-05'::date, null, true, gen_random_uuid(),
      now(), now())::contas_avulsas_recorrentes
);
-- Expected: 2026-08-20

-- Quinzenal dias 5 e 20, base 20/08/2026 → esperado 05/09/2026
select public.calcular_proxima_data_recorrencia(
  row(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Salário', 5000,
      null, null, null, gen_random_uuid(), gen_random_uuid(),
      'quinzenal', null, 5, 20, null, null,
      '2026-08-20'::date, null, true, gen_random_uuid(),
      now(), now())::contas_avulsas_recorrentes
);
-- Expected: 2026-09-05

-- Anual 15/03, base 15/03/2026 → esperado 15/03/2027
select public.calcular_proxima_data_recorrencia(
  row(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'IPTU', 800,
      null, null, null, gen_random_uuid(), gen_random_uuid(),
      'anual', null, null, null, 15, 3,
      '2026-03-15'::date, null, true, gen_random_uuid(),
      now(), now())::contas_avulsas_recorrentes
);
-- Expected: 2027-03-15
```

Todos os 5 resultados devem bater. Se algum falhar, abrir issue de correção antes de seguir pra Task 4 (o cron depende dessa função).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260807000003_calcular_proxima_data.sql
git commit -m "task013: funcoes de calculo de proxima data (helper + recorrencia + inicial)"
```

---

## Task 4: RPC `gerar_ocorrencias_recorrentes` + `cron.schedule`

**Files:**
- Create: `supabase/migrations/20260807000004_gerar_recorrentes.sql`

**Interfaces:**
- Consumes: tabelas `contas_avulsas_recorrentes` e `contas_avulsas` (Task 1), função `calcular_proxima_data_recorrencia` (Task 3), extensão `pg_cron` (Task 2).
- Produces:
  - Function `public.gerar_ocorrencias_recorrentes() returns integer` — SECURITY DEFINER, retorna número de instâncias geradas.
  - Job cron `gerar-recorrentes-diario` agendado pra `0 6 * * *` (06:00 UTC = 03:00 America/Sao_Paulo).

---

- [ ] **Step 1: Criar migration**

Arquivo `supabase/migrations/20260807000004_gerar_recorrentes.sql`:

```sql
-- =====================================================================
-- Task 013 — RPC gerar_ocorrencias_recorrentes + cron.schedule diário
--
-- IMPORTANTE: cron.schedule usa UTC. '0 6 * * *' = 06:00 UTC =
-- 03:00 America/Sao_Paulo. Se o Brasil voltar a ter horário de verão,
-- revisar a expressão.
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
    -- Insere instância como avulsa pendente
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

    -- Calcula próxima data conforme frequência
    v_prox_data := public.calcular_proxima_data_recorrencia(v_template);

    -- Atualiza template: se próxima passa da data_fim, desativa
    if v_template.data_fim is not null and v_prox_data > v_template.data_fim then
      update public.contas_avulsas_recorrentes
         set ativo = false, proxima_data = v_prox_data
       where id = v_template.id;
    else
      update public.contas_avulsas_recorrentes
         set proxima_data = v_prox_data
       where id = v_template.id;
    end if;

    -- Audit (função SECURITY DEFINER precisa chamar log_audit_event
    -- passando tenant_id explícito pra pular auth.uid())
    insert into public.audit_events (
      tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
    ) values (
      v_template.tenant_id, 'conta_recorrente', v_template.id,
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

-- Agenda diária 03:00 America/Sao_Paulo (= 06:00 UTC).
-- unschedule antes por idempotência (re-rodar migration).
do $$ begin
  perform cron.unschedule('gerar-recorrentes-diario');
exception when others then null;
end $$;

select cron.schedule(
  'gerar-recorrentes-diario',
  '0 6 * * *',
  $$select public.gerar_ocorrencias_recorrentes();$$
);
```

**Nota sobre `audit_events`:** o `INSERT` direto na tabela é usado porque o helper `log_audit_event` provavelmente exige `auth.uid()`, que dentro do cron é NULL. Verificar assinatura real do `log_audit_event` no repo — se aceitar `actor_user_id = null` explicitamente, preferir o helper.

- [ ] **Step 2: Aplicar via MCP**

`mcp__supabase-write__apply_migration` com `name = "task013_gerar_recorrentes"`.

Validar:

```sql
-- Função existe
select proname, prosecdef, provolatile
from pg_proc where proname = 'gerar_ocorrencias_recorrentes';
-- Expected: 1 row, prosecdef=true, provolatile='v' (volatile, correto pra função que faz INSERT)

-- Job agendado
select jobname, schedule, command, active
from cron.job where jobname = 'gerar-recorrentes-diario';
-- Expected: 1 row com schedule='0 6 * * *', active=true
```

- [ ] **Step 3: Teste manual do RPC (sem esperar cron)**

Executar diretamente com um template dummy pra confirmar que o loop insere + atualiza `proxima_data`:

```sql
-- Chama a função — sem templates atrasados, retorna 0
select public.gerar_ocorrencias_recorrentes();
-- Expected: 0 (nenhum template ativo com proxima_data <= hoje)
```

O teste com dados reais é feito nas Tasks 5-7 quando existir template criado pela UI.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260807000004_gerar_recorrentes.sql
git commit -m "task013: RPC gerar_ocorrencias_recorrentes + cron diario 03h SP"
```

---

## Task 5: Server actions + Zod (CRUD do template)

**Files:**
- Create: `lib/validations/conta-recorrente.ts`
- Create: `app/(app)/financeiro/contas-a-pagar/actions-recorrentes.ts`
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts` (adicionar `parar_recorrencia?: boolean`)

**Interfaces:**
- Consumes: types `ContaAvulsaRecorrente`, `FrequenciaRecorrencia` (Task 1), function `calcular_proxima_data_inicial` (Task 3), audit actions (Task 1).
- Produces:
  - Zod schemas: `criarContaRecorrenteSchema`, `editarContaRecorrenteSchema`.
  - Server actions:
    - `criarContaRecorrente(input): Promise<Result>`
    - `editarContaRecorrente(id, input): Promise<Result>`
    - `pausarContaRecorrente(id): Promise<Result>`
    - `reativarContaRecorrente(id): Promise<Result>`
    - `excluirContaRecorrente(id): Promise<Result>`
  - `excluirContaAvulsa(id, opts?: { parar_recorrencia?: boolean })` — assinatura estendida.
  - `estornarBaixaAvulsa(input: { conta_avulsa_id, motivo, parar_recorrencia? })` — assinatura estendida.

---

- [ ] **Step 1: Criar Zod em `lib/validations/conta-recorrente.ts`**

```ts
import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const dia1a31 = z.number().int().min(1).max(31);
const mes1a12 = z.number().int().min(1).max(12);

export const criarContaRecorrenteSchema = z
  .object({
    empresa_id: z.string().uuid("Selecione a empresa."),
    descricao: z.string().trim().min(3, "Descrição muito curta.").max(500),
    valor: z
      .string()
      .refine(
        (v) => !Number.isNaN(Number(v)) && Number(v) > 0,
        "Valor deve ser positivo.",
      ),
    fornecedor_id: z.string().uuid().nullable().or(z.literal("").transform(() => null)),
    cliente_id: z.string().uuid().nullable().or(z.literal("").transform(() => null)),
    job_id: z.string().uuid().nullable().or(z.literal("").transform(() => null)),
    plano_conta_tipo_id: z.string().uuid("Selecione o tipo."),
    plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo."),
    frequencia: z.enum(["quinzenal", "mensal", "anual"]),
    dia_do_mes: dia1a31.nullable(),
    dia_quinzena_1: dia1a31.nullable(),
    dia_quinzena_2: dia1a31.nullable(),
    dia_do_ano_dia: dia1a31.nullable(),
    dia_do_ano_mes: mes1a12.nullable(),
    data_fim: z
      .string()
      .regex(dateRegex, "Data em YYYY-MM-DD.")
      .nullable()
      .or(z.literal("").transform(() => null)),
  })
  .superRefine((data, ctx) => {
    if (data.frequencia === "mensal" && data.dia_do_mes == null) {
      ctx.addIssue({
        code: "custom",
        path: ["dia_do_mes"],
        message: "Informe o dia do vencimento.",
      });
    }
    if (data.frequencia === "quinzenal") {
      if (data.dia_quinzena_1 == null) {
        ctx.addIssue({
          code: "custom",
          path: ["dia_quinzena_1"],
          message: "Informe o primeiro dia.",
        });
      }
      if (data.dia_quinzena_2 == null) {
        ctx.addIssue({
          code: "custom",
          path: ["dia_quinzena_2"],
          message: "Informe o segundo dia.",
        });
      }
      if (
        data.dia_quinzena_1 != null &&
        data.dia_quinzena_2 != null &&
        data.dia_quinzena_1 >= data.dia_quinzena_2
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["dia_quinzena_2"],
          message: "Segundo dia deve ser maior que o primeiro.",
        });
      }
    }
    if (data.frequencia === "anual") {
      if (data.dia_do_ano_dia == null) {
        ctx.addIssue({
          code: "custom",
          path: ["dia_do_ano_dia"],
          message: "Informe o dia.",
        });
      }
      if (data.dia_do_ano_mes == null) {
        ctx.addIssue({
          code: "custom",
          path: ["dia_do_ano_mes"],
          message: "Informe o mês.",
        });
      }
    }
  });

export const editarContaRecorrenteSchema = criarContaRecorrenteSchema.innerType().omit({
  empresa_id: true,
});

export type CriarContaRecorrenteInput = z.infer<typeof criarContaRecorrenteSchema>;
export type EditarContaRecorrenteInput = z.infer<typeof editarContaRecorrenteSchema>;
```

- [ ] **Step 2: Criar `actions-recorrentes.ts`**

Arquivo `app/(app)/financeiro/contas-a-pagar/actions-recorrentes.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  criarContaRecorrenteSchema,
  editarContaRecorrenteSchema,
} from "@/lib/validations/conta-recorrente";

type Ok<T = { id: string }> = { ok: true } & Partial<T>;
type Err = { ok: false; message: string; fieldErrors?: Record<string, string[]> };
type Result<T = { id: string }> = Ok<T> | Err;

async function checarGateFinanceiro(
  entidadeId: string | null,
  acaoTentada: string,
) {
  const session = await requireSession();
  const supabase = createClient();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "conta_recorrente",
      entidadeId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false as const, message: "Apenas admin ou financeiro pode executar esta ação." };
  }
  return { ok: true as const, session, supabase };
}

export async function criarContaRecorrente(input: unknown): Promise<Result> {
  const parsed = criarContaRecorrenteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const gate = await checarGateFinanceiro(null, "conta_recorrente.criada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const d = parsed.data;

  // Valida subtipo pertence ao tipo
  const { data: subtipo } = await supabase
    .from("plano_contas_subtipos")
    .select("tipo_id, ativo")
    .eq("id", d.plano_conta_subtipo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!subtipo || subtipo.tipo_id !== d.plano_conta_tipo_id || !subtipo.ativo) {
    return { ok: false, message: "Subtipo inválido ou não pertence ao tipo escolhido." };
  }

  // Calcula proxima_data inicial via RPC
  const { data: proxDataResult, error: rpcErr } = await supabase.rpc(
    "calcular_proxima_data_inicial",
    {
      p_frequencia: d.frequencia,
      p_dia_do_mes: d.dia_do_mes,
      p_dia_quinzena_1: d.dia_quinzena_1,
      p_dia_quinzena_2: d.dia_quinzena_2,
      p_dia_do_ano_dia: d.dia_do_ano_dia,
      p_dia_do_ano_mes: d.dia_do_ano_mes,
    },
  );
  if (rpcErr || !proxDataResult) {
    return { ok: false, message: `Falha ao calcular próxima data: ${rpcErr?.message ?? "erro desconhecido"}` };
  }
  const proximaData = proxDataResult as string;

  // Se data_fim informada, valida ordem
  if (d.data_fim != null && proximaData > d.data_fim) {
    return {
      ok: false,
      message: "Data de fim é anterior à primeira ocorrência calculada.",
      fieldErrors: { data_fim: ["Data de fim deve ser posterior à primeira ocorrência."] },
    };
  }

  const { data: rec, error } = await supabase
    .from("contas_avulsas_recorrentes")
    .insert({
      tenant_id: session.activeTenant.id,
      empresa_id: d.empresa_id,
      descricao: d.descricao,
      valor: d.valor,
      fornecedor_id: d.fornecedor_id,
      cliente_id: d.cliente_id,
      job_id: d.job_id,
      plano_conta_tipo_id: d.plano_conta_tipo_id,
      plano_conta_subtipo_id: d.plano_conta_subtipo_id,
      frequencia: d.frequencia,
      dia_do_mes: d.dia_do_mes,
      dia_quinzena_1: d.dia_quinzena_1,
      dia_quinzena_2: d.dia_quinzena_2,
      dia_do_ano_dia: d.dia_do_ano_dia,
      dia_do_ano_mes: d.dia_do_ano_mes,
      proxima_data: proximaData,
      data_fim: d.data_fim,
      criado_por: session.profile.id,
    })
    .select("id")
    .single();

  if (error || !rec) {
    return { ok: false, message: `Falha ao criar recorrência: ${error?.message ?? "erro"}` };
  }

  await logAuditEvent({
    acao: "conta_recorrente.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: rec.id,
    metadata: {
      descricao: d.descricao,
      valor: Number(d.valor),
      frequencia: d.frequencia,
      proxima_data: proximaData,
      data_fim: d.data_fim,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: rec.id };
}

export async function editarContaRecorrente(id: string, input: unknown): Promise<Result> {
  const parsed = editarContaRecorrenteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const gate = await checarGateFinanceiro(id, "conta_recorrente.editada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const d = parsed.data;

  const { data: atual } = await supabase
    .from("contas_avulsas_recorrentes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!atual) return { ok: false, message: "Recorrência não encontrada." };
  if (!atual.ativo) {
    return { ok: false, message: "Só recorrências ativas podem ser editadas. Reative primeiro." };
  }

  // Detecta mudança em cluster de frequência
  const mudouFrequencia =
    atual.frequencia !== d.frequencia ||
    atual.dia_do_mes !== d.dia_do_mes ||
    atual.dia_quinzena_1 !== d.dia_quinzena_1 ||
    atual.dia_quinzena_2 !== d.dia_quinzena_2 ||
    atual.dia_do_ano_dia !== d.dia_do_ano_dia ||
    atual.dia_do_ano_mes !== d.dia_do_ano_mes;

  let novaProxData: string | null = null;
  if (mudouFrequencia) {
    const { data: prox, error: rpcErr } = await supabase.rpc(
      "calcular_proxima_data_inicial",
      {
        p_frequencia: d.frequencia,
        p_dia_do_mes: d.dia_do_mes,
        p_dia_quinzena_1: d.dia_quinzena_1,
        p_dia_quinzena_2: d.dia_quinzena_2,
        p_dia_do_ano_dia: d.dia_do_ano_dia,
        p_dia_do_ano_mes: d.dia_do_ano_mes,
      },
    );
    if (rpcErr || !prox) {
      return { ok: false, message: `Falha ao recalcular próxima data: ${rpcErr?.message ?? "erro"}` };
    }
    novaProxData = prox as string;
  }

  const patch: Record<string, unknown> = {
    descricao: d.descricao,
    valor: d.valor,
    fornecedor_id: d.fornecedor_id,
    cliente_id: d.cliente_id,
    job_id: d.job_id,
    plano_conta_tipo_id: d.plano_conta_tipo_id,
    plano_conta_subtipo_id: d.plano_conta_subtipo_id,
    frequencia: d.frequencia,
    dia_do_mes: d.dia_do_mes,
    dia_quinzena_1: d.dia_quinzena_1,
    dia_quinzena_2: d.dia_quinzena_2,
    dia_do_ano_dia: d.dia_do_ano_dia,
    dia_do_ano_mes: d.dia_do_ano_mes,
    data_fim: d.data_fim,
  };
  if (novaProxData !== null) patch.proxima_data = novaProxData;

  const { error } = await supabase
    .from("contas_avulsas_recorrentes")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao atualizar: ${error.message}` };

  await logAuditEvent({
    acao: "conta_recorrente.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
    metadata: { mudou_frequencia: mudouFrequencia, nova_proxima_data: novaProxData },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath(`/financeiro/contas-a-pagar/recorrente/${id}`);
  return { ok: true, id };
}

export async function pausarContaRecorrente(id: string): Promise<Result> {
  const gate = await checarGateFinanceiro(id, "conta_recorrente.pausada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { error } = await supabase
    .from("contas_avulsas_recorrentes")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao pausar: ${error.message}` };

  await logAuditEvent({
    acao: "conta_recorrente.pausada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath(`/financeiro/contas-a-pagar/recorrente/${id}`);
  return { ok: true, id };
}

export async function reativarContaRecorrente(id: string): Promise<Result> {
  const gate = await checarGateFinanceiro(id, "conta_recorrente.reativada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: atual } = await supabase
    .from("contas_avulsas_recorrentes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!atual) return { ok: false, message: "Recorrência não encontrada." };

  // Se proxima_data já passou, recalcula.
  const hoje = new Date().toISOString().slice(0, 10);
  let novaProxData: string | null = null;
  if (atual.proxima_data <= hoje) {
    const { data: prox } = await supabase.rpc("calcular_proxima_data_inicial", {
      p_frequencia: atual.frequencia,
      p_dia_do_mes: atual.dia_do_mes,
      p_dia_quinzena_1: atual.dia_quinzena_1,
      p_dia_quinzena_2: atual.dia_quinzena_2,
      p_dia_do_ano_dia: atual.dia_do_ano_dia,
      p_dia_do_ano_mes: atual.dia_do_ano_mes,
    });
    novaProxData = prox as string;
  }

  const patch: Record<string, unknown> = { ativo: true };
  if (novaProxData !== null) patch.proxima_data = novaProxData;

  const { error } = await supabase
    .from("contas_avulsas_recorrentes")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao reativar: ${error.message}` };

  await logAuditEvent({
    acao: "conta_recorrente.reativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
    metadata: { recalculou_proxima_data: novaProxData !== null, proxima_data: novaProxData },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath(`/financeiro/contas-a-pagar/recorrente/${id}`);
  return { ok: true, id };
}

export async function excluirContaRecorrente(id: string): Promise<Result> {
  const gate = await checarGateFinanceiro(id, "conta_recorrente.excluida");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  // Conta instâncias já geradas
  const { count } = await supabase
    .from("contas_avulsas")
    .select("id", { count: "exact", head: true })
    .eq("recorrente_id", id);

  const geradas = count ?? 0;

  if (geradas === 0) {
    // Hard delete — nunca gerou nada.
    const { error } = await supabase
      .from("contas_avulsas_recorrentes")
      .delete()
      .eq("id", id)
      .eq("tenant_id", session.activeTenant.id);
    if (error) return { ok: false, message: `Falha ao excluir: ${error.message}` };
  } else {
    // Soft delete — mantém histórico das instâncias.
    const { error } = await supabase
      .from("contas_avulsas_recorrentes")
      .update({ ativo: false })
      .eq("id", id)
      .eq("tenant_id", session.activeTenant.id);
    if (error) return { ok: false, message: `Falha ao pausar: ${error.message}` };
  }

  await logAuditEvent({
    acao: "conta_recorrente.excluida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
    metadata: { hard_delete: geradas === 0, instancias_geradas: geradas },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id };
}
```

- [ ] **Step 3: Modificar `actions-avulsas.ts` — estender `excluirContaAvulsa`**

Localizar `export async function excluirContaAvulsa(id: string)` no arquivo. Trocar assinatura:

```ts
export async function excluirContaAvulsa(
  id: string,
  opts?: { parar_recorrencia?: boolean },
): Promise<Result> {
  // ... corpo existente ...
  // Após o DELETE bem-sucedido e antes do `revalidatePath`:

  if (opts?.parar_recorrencia && atual && (atual as any).recorrente_id) {
    // Chama pausar via UPDATE direto (evita import circular com actions-recorrentes)
    const { error: pauseErr } = await supabase
      .from("contas_avulsas_recorrentes")
      .update({ ativo: false })
      .eq("id", (atual as any).recorrente_id)
      .eq("tenant_id", session.activeTenant.id);
    if (!pauseErr) {
      await logAuditEvent({
        acao: "conta_recorrente.pausada",
        tenantId: session.activeTenant.id,
        entidadeTipo: "conta_recorrente",
        entidadeId: (atual as any).recorrente_id,
        metadata: { origem: "excluir_ocorrencia_avulsa", avulsa_id: id },
      });
      revalidatePath(`/financeiro/contas-a-pagar/recorrente/${(atual as any).recorrente_id}`);
    }
  }
}
```

Antes do handler, o SELECT `atual` já pega os campos da conta. Se ele não pega `recorrente_id`, adicionar `recorrente_id` ao select.

- [ ] **Step 4: Modificar `actions-avulsas.ts` — estender `estornarBaixaAvulsa`**

Localizar `estornarBaixaAvulsa`. Estender schema Zod pra aceitar `parar_recorrencia?: boolean` opcional. Após o RPC de estorno rodar com sucesso e antes do revalidate, aplicar a mesma lógica de pausar template (com SELECT da avulsa pra pegar `recorrente_id`).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/validations/conta-recorrente.ts app/\(app\)/financeiro/contas-a-pagar/actions-recorrentes.ts app/\(app\)/financeiro/contas-a-pagar/actions-avulsas.ts
git commit -m "task013: server actions criar/editar/pausar/reativar/excluir recorrente + parar_recorrencia em avulsa"
```

---

## Task 6: Drawer `<ContaRecorrenteDrawer>` (criar/editar)

**Files:**
- Create: `app/(app)/financeiro/contas-a-pagar/conta-recorrente-drawer.tsx`

**Interfaces:**
- Consumes: types `ContaAvulsaRecorrente`, `FrequenciaRecorrencia`, `PlanoContaTipo`, `PlanoContaSubtipo`; actions `criarContaRecorrente`, `editarContaRecorrente` de `./actions-recorrentes`.
- Produces:
  - Component `<ContaRecorrenteDrawer mode="criar"|"editar" ... />` com props discriminated union (mesmo padrão do `<ContaAvulsaDrawer>` da Task 7 do plano anterior).

---

- [ ] **Step 1: Criar `conta-recorrente-drawer.tsx`**

Copiar estrutura base de `app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx` (drawer da Task 7 do plano de avulsas), removendo:
- Bloco de Natureza (não existe — recorrente é sempre saída).
- Bloco de Anexos (templates não têm).
- Bloco de "Data prevista de pagamento" (usa `proxima_data` derivada da frequência).

Adicionando bloco novo **"Recorrência"** logo depois do bloco Subtipo:

```tsx
{/* Recorrência */}
<div className="space-y-3">
  <Label>Frequência *</Label>
  <div className="flex gap-3">
    {(["mensal", "quinzenal", "anual"] as const).map((f) => (
      <button
        key={f}
        type="button"
        onClick={() => setFrequencia(f)}
        className={[
          "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
          frequencia === f
            ? "border-california-red bg-california-red/10 text-california-red"
            : "border-border bg-white text-muted-foreground hover:bg-muted",
        ].join(" ")}
      >
        {f === "mensal" ? "Mensal" : f === "quinzenal" ? "Quinzenal" : "Anual"}
      </button>
    ))}
  </div>
</div>

{frequencia === "mensal" && (
  <div className="space-y-2">
    <Label htmlFor="dia_do_mes">Dia do vencimento *</Label>
    <Input
      id="dia_do_mes"
      type="number"
      min={1}
      max={31}
      value={diaDoMes ?? ""}
      onChange={(e) => setDiaDoMes(e.target.value ? Number(e.target.value) : null)}
      className="no-spinner"
    />
    <p className="text-xs text-muted-foreground">
      Se o mês não tiver esse dia (ex: 31 em fevereiro), cai no último dia do mês.
    </p>
  </div>
)}

{frequencia === "quinzenal" && (
  <div className="grid grid-cols-2 gap-3">
    <div className="space-y-2">
      <Label htmlFor="dia_quinzena_1">Primeiro dia *</Label>
      <Input
        id="dia_quinzena_1"
        type="number"
        min={1}
        max={31}
        value={diaQuinzena1 ?? ""}
        onChange={(e) => setDiaQuinzena1(e.target.value ? Number(e.target.value) : null)}
        className="no-spinner"
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="dia_quinzena_2">Segundo dia *</Label>
      <Input
        id="dia_quinzena_2"
        type="number"
        min={1}
        max={31}
        value={diaQuinzena2 ?? ""}
        onChange={(e) => setDiaQuinzena2(e.target.value ? Number(e.target.value) : null)}
        className="no-spinner"
      />
    </div>
    <p className="col-span-2 text-xs text-muted-foreground">
      Segundo dia deve ser maior que o primeiro. Se o mês não tiver o dia, cai no último dia do mês.
    </p>
  </div>
)}

{frequencia === "anual" && (
  <div className="grid grid-cols-2 gap-3">
    <div className="space-y-2">
      <Label htmlFor="dia_do_ano_dia">Dia *</Label>
      <Input
        id="dia_do_ano_dia"
        type="number"
        min={1}
        max={31}
        value={diaDoAnoDia ?? ""}
        onChange={(e) => setDiaDoAnoDia(e.target.value ? Number(e.target.value) : null)}
        className="no-spinner"
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="dia_do_ano_mes">Mês *</Label>
      <Select
        value={diaDoAnoMes ? String(diaDoAnoMes) : ""}
        onValueChange={(v) => setDiaDoAnoMes(v ? Number(v) : null)}
      >
        <SelectTrigger id="dia_do_ano_mes">
          <SelectValue placeholder="Selecione o mês" />
        </SelectTrigger>
        <SelectContent>
          {[
            "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
            "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
          ].map((nome, i) => (
            <SelectItem key={i + 1} value={String(i + 1)}>{nome}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  </div>
)}

<div className="space-y-2">
  <Label htmlFor="data_fim">Data de fim (opcional)</Label>
  <DatePicker
    key={isEditar ? `edit-${recorrente?.id ?? "criar"}` : "criar"}
    name="data_fim"
    defaultValue={dataFim ?? undefined}
    onDateChange={(d) => setDataFim(d ? formatDateISO(d) : null)}
  />
  <p className="text-xs text-muted-foreground">
    Se preenchida, a recorrência para automaticamente após essa data.
  </p>
</div>

<p className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-md p-3">
  <strong>Como funciona:</strong> ao salvar, o sistema calcula a próxima data válida a partir de hoje.
  Não gera ocorrências retroativas. Cron diário às 03h gera cada instância pendente no dia do vencimento.
</p>
```

Adaptar estado local, `useEffect` de reset, submit e comparação de campos conforme padrão do `<ContaAvulsaDrawer>`. `frequencia` default `"mensal"`. Job/Fornecedor/Cliente usam `<Combobox>` (mesma UX que a Task 8 do plano anterior adicionou), com auto-preenchimento de cliente ao selecionar job.

**Empresa** disabled em modo editar (mesma regra da Task 7 do plano anterior — hint em pt-BR "Empresa não pode ser alterada. Se estiver errada, exclua e crie outra.").

Botão submit: **"Criar recorrência"** (verde emerald) em criar, **"Salvar"** (california-red) em editar.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/conta-recorrente-drawer.tsx
git commit -m "task013: drawer criar/editar de conta recorrente"
```

---

## Task 7: Lista `<RecorrentesList>` + 3ª tab

**Files:**
- Create: `app/(app)/financeiro/contas-a-pagar/recorrentes-list.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx`

**Interfaces:**
- Consumes: types `ContaAvulsaRecorrente`, `FrequenciaRecorrencia`, `PlanoContaTipo`, `PlanoContaSubtipo`; component `<ContaRecorrenteDrawer>` (Task 6).
- Produces:
  - Component `<RecorrentesList rows={...} empresas={...} tipos={...} subtipos={...} fornecedores={...} clientes={...} jobs={...} tenantId={...} />`.
  - Terceira aba "Recorrências" em `<ContasPagarTabs>`.

---

- [ ] **Step 1: Criar `recorrentes-list.tsx`**

Copiar estrutura de `avulsas-list.tsx`. Diferenças principais:

- Colunas: `Descrição | Frequência | Próxima data | Fornecedor | Empresa | Valor | Status | Ações`.
- Chips de status: `Ativas | Paradas | Todas` (default "Ativas").
- Busca por descrição + fornecedor.
- Botão "Nova recorrência" (verde emerald) abre `<ContaRecorrenteDrawer mode="criar" ...>`.
- Row click navega pra `/financeiro/contas-a-pagar/recorrente/${r.id}`.
- Coluna "Frequência" com chip formatado: "Mensal · dia 5", "Quinzenal · 5 e 20", "Anual · 15/mar" (usar helper `formatFrequenciaResumo(row)`).
- Coluna "Próxima data" formatada `DD/MM/YYYY` via split manual.
- Coluna "Valor" mono, sem cor especial (contas recorrentes sempre saída).
- Status badge: `Ativa` (verde) / `Parada` (cinza).

Type `RecorrenteRow`:

```ts
export interface RecorrenteRow {
  id: string;
  descricao: string;
  valor: number;
  frequencia: FrequenciaRecorrencia;
  dia_do_mes: number | null;
  dia_quinzena_1: number | null;
  dia_quinzena_2: number | null;
  dia_do_ano_dia: number | null;
  dia_do_ano_mes: number | null;
  proxima_data: string;
  data_fim: string | null;
  ativo: boolean;
  fornecedor_nome: string | null;
  empresa_nome: string;
  tipo_codigo: string;
  subtipo_nome: string;
}
```

Helper `formatFrequenciaResumo`:

```ts
function formatFrequenciaResumo(r: RecorrenteRow): string {
  if (r.frequencia === "mensal") return `Mensal · dia ${r.dia_do_mes}`;
  if (r.frequencia === "quinzenal") return `Quinzenal · ${r.dia_quinzena_1} e ${r.dia_quinzena_2}`;
  const meses = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  return `Anual · ${r.dia_do_ano_dia}/${meses[(r.dia_do_ano_mes ?? 1) - 1]}`;
}
```

- [ ] **Step 2: Modificar `contas-pagar-tabs.tsx` — 3ª aba**

Localizar o interface de props. Adicionar:

```ts
interface Props {
  pps: React.ReactNode;
  ppsPendentesCount: number;
  avulsas: React.ReactNode;
  avulsasPendentesCount: number;
  recorrentes: React.ReactNode;         // NOVO
  recorrentesAtivasCount: number;       // NOVO
}
```

`TabKey` vira `"pps" | "avulsas" | "recorrentes"`. Adicionar 3º `<TabButton>` na ordem: PPs → Avulsas → Recorrências, cada um com badge de contagem análogo.

Adicionar 3º `<div role="tabpanel">` com o `recorrentes` prop.

- [ ] **Step 3: Modificar `page.tsx` — query + props**

Adicionar 2 novas queries ao `Promise.all` existente:

```ts
// Recorrências (todos os status)
supabase
  .from("contas_avulsas_recorrentes")
  .select(`
    id, descricao, valor, frequencia,
    dia_do_mes, dia_quinzena_1, dia_quinzena_2, dia_do_ano_dia, dia_do_ano_mes,
    proxima_data, data_fim, ativo,
    fornecedor:fornecedores(nome, razao_social),
    empresa:empresas(razao_social, nome_fantasia),
    tipo:plano_contas_tipos!inner(codigo),
    subtipo:plano_contas_subtipos!inner(nome)
  `)
  .eq("tenant_id", session.activeTenant.id)
  .order("ativo", { ascending: false })
  .order("proxima_data", { ascending: true }),

// Contagem de recorrências ativas
supabase
  .from("contas_avulsas_recorrentes")
  .select("id", { count: "exact", head: true })
  .eq("tenant_id", session.activeTenant.id)
  .eq("ativo", true),
```

Mapear `recorrentesRes.data` pra `RecorrenteRow[]` (similar ao `avulsasRows`).

Passar props novos pra `<ContasPagarTabs>`:

```tsx
<ContasPagarTabs
  pps={<PedidosCompraList .../>}
  ppsPendentesCount={ppsPendentesCountRes.count ?? 0}
  avulsas={<ContasAvulsasList .../>}
  avulsasPendentesCount={avulsasPendentesCountRes.count ?? 0}
  recorrentes={
    <RecorrentesList
      rows={recorrentesRows}
      empresas={empresasList}
      tipos={tiposRes.data ?? []}
      subtipos={subtiposRes.data ?? []}
      fornecedores={fornecedoresList}
      clientes={clientesList}
      jobs={jobsList}
      tenantId={session.activeTenant.id}
    />
  }
  recorrentesAtivasCount={recorrentesAtivasCountRes.count ?? 0}
/>
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/recorrentes-list.tsx app/\(app\)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx app/\(app\)/financeiro/contas-a-pagar/page.tsx
git commit -m "task013: 3a tab Recorrencias + lista"
```

---

## Task 8: Página de detalhes `/recorrente/[id]` + botões + histórico

**Files:**
- Create: `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/page.tsx`
- Create: `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/acoes-client.tsx`
- Create: `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/historico-ocorrencias.tsx`

**Interfaces:**
- Consumes: types + actions da Task 5 + drawer da Task 6.
- Produces: rota `/financeiro/contas-a-pagar/recorrente/[id]` funcional.

---

- [ ] **Step 1: Criar `page.tsx`**

Server component com layout análogo ao `avulsa/[id]/page.tsx` (Task 9 do plano anterior). Estrutura:

- Header: breadcrumb `Financeiro > Contas a Pagar > {descricao truncada}`, ícone `Repeat`, título, badge status (Ativa / Parada).
- Card **Detalhes**: empresa, valor, fornecedor, cliente, job, plano de contas.
- Card **Recorrência**: frequência formatada (usar helper `formatFrequenciaResumo` importado da Task 7), próxima data, data fim (se houver).
- Card **Histórico de ocorrências**: usa `<HistoricoOcorrencias>`.
- Rodapé com ações contextuais:
  - Se `ativo`: `[Editar] [Pausar]`
  - Se `!ativo`: `[Reativar]`
  - Sempre: `[Excluir]`

Gate `admin | financeiro` via `redirect("/home?reason=sem_permissao_financeira")`.

Query com `Promise.all` de 8 queries (recorrente com embeds, contas_avulsas com `recorrente_id = id` pro histórico, empresas, tipos, subtipos, fornecedores, clientes, jobs pra drawer editar).

Mapear jobs incluindo `cliente_id` do projeto (mesmo padrão que a Task 8 do plano anterior fez):

```ts
supabase
  .from("jobs")
  .select("id, codigo, nome, projeto:projetos!inner(cliente_id)")
  .eq("tenant_id", session.activeTenant.id)
  .neq("status", "cancelado")
  .order("created_at", { ascending: false })
  .limit(500),
```

E:

```ts
const jobs = ((jobsRes.data ?? []) as Array<{
  id: string; codigo: string; nome: string;
  projeto: { cliente_id: string } | { cliente_id: string }[] | null;
}>).map((j) => {
  const proj = Array.isArray(j.projeto) ? j.projeto[0] : j.projeto;
  return {
    id: j.id, codigo: j.codigo, nome: j.nome,
    cliente_id: proj?.cliente_id ?? null,
  };
});
```

- [ ] **Step 2: Criar `acoes-client.tsx`**

Client component único com 4 wrappers:

- `EditarRecorrenteButton` — wraps `<ContaRecorrenteDrawer mode="editar">`, botão "Editar".
- `PausarRecorrenteButton` — `<ConfirmDialog>` "Pausar recorrência?" + chama `pausarContaRecorrente`.
- `ReativarRecorrenteButton` — `<ConfirmDialog>` "Reativar recorrência?" + chama `reativarContaRecorrente`.
- `ExcluirRecorrenteButton` — `<ConfirmDialog>` "Excluir recorrência?" com descrição sensível a `geradas_count` (se >0: "As instâncias já geradas serão preservadas. A recorrência será marcada como parada."; se 0: "A recorrência será excluída definitivamente."), chama `excluirContaRecorrente`. Após sucesso, `router.push("/financeiro/contas-a-pagar")`.

Copiar padrão dos botões em `avulsa/[id]/acoes-client.tsx`.

- [ ] **Step 3: Criar `historico-ocorrencias.tsx`**

Client component com tabela das instâncias geradas pelo template:

```tsx
"use client";

import Link from "next/link";
import type { ContaAvulsaStatus } from "@/lib/types";
import { contaAvulsaStatusLabel } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Ocorrencia {
  id: string;
  data_prevista_pagamento: string | null;
  status: ContaAvulsaStatus;
  valor: number;
  pago_em: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function statusBadge(status: ContaAvulsaStatus): string {
  return status === "pendente"
    ? "bg-[#fffbeb] text-[#92400e] border-[#fde68a]"
    : "bg-emerald-50 text-emerald-700 border-emerald-200";
}

export function HistoricoOcorrencias({ ocorrencias }: { ocorrencias: Ocorrencia[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
        Ocorrências geradas
      </h2>
      {ocorrencias.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma ocorrência gerada até agora. A próxima entra na data prevista.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Data prevista</th>
                <th className="px-3 py-2 text-left">Data pagamento</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {ocorrencias.map((o) => (
                <tr key={o.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{formatDate(o.data_prevista_pagamento)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatDate(o.pago_em)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                        statusBadge(o.status),
                      )}
                    >
                      {contaAvulsaStatusLabel(o.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{formatMoney(o.valor)}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/financeiro/contas-a-pagar/avulsa/${o.id}`}
                      prefetch={false}
                      className="text-california-red hover:underline text-xs"
                    >
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/recorrente
git commit -m "task013: pagina de detalhes /recorrente/[id] + acoes + historico"
```

---

## Task 9: Dialog contextual "só esta ou parar recorrência"

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/acoes-client.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/cancelar-baixa-avulsa-modal.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/page.tsx` (passa `recorrente_id` da conta pros wrappers)

**Interfaces:**
- Consumes: actions estendidas de `actions-avulsas.ts` (Task 5, `parar_recorrencia?`).
- Produces: dialog especial quando `conta.recorrente_id != null` — usuário escolhe entre "só esta ocorrência" ou "parar toda a recorrência".

---

- [ ] **Step 1: Modificar `page.tsx` — passar `recorrente_id`**

Localizar onde `<ExcluirAvulsaButton>` e `<CancelarBaixaAvulsaModalClient>` são renderizados. Adicionar prop `recorrenteId={c.recorrente_id}`.

O SELECT da conta (`page.tsx`) precisa incluir `recorrente_id` — verificar que já pega (se não, adicionar `recorrente_id` no select).

- [ ] **Step 2: Modificar `ExcluirAvulsaButton` em `acoes-client.tsx`**

Adicionar prop `recorrenteId: string | null`. Se `recorrenteId != null`, trocar o `<ConfirmDialog>` normal por um `<Dialog>` custom com radio group:

```tsx
"use client";
import * as React from "react";
// ... imports ...

export function ExcluirAvulsaButton({
  contaId,
  descricao,
  recorrenteId,
}: {
  contaId: string;
  descricao: string;
  recorrenteId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [pararRecorrencia, setPararRecorrencia] = React.useState<"nao" | "sim">("nao");

  function handleConfirm() {
    startTransition(async () => {
      const res = await excluirContaAvulsa(contaId, {
        parar_recorrencia: recorrenteId != null && pararRecorrencia === "sim",
      });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setOpen(false);
      router.push("/financeiro/contas-a-pagar");
    });
  }

  // Dialog especial pra recorrentes
  if (recorrenteId) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-white px-3 py-2 text-xs font-semibold text-california-red hover:bg-california-red hover:text-white"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Excluir
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-background p-6 shadow-elevated">
            <DialogHeader>
              <DialogTitle>Excluir esta ocorrência?</DialogTitle>
              <DialogDescription>
                Esta conta faz parte de uma recorrência. Escolha como proceder:
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/50">
                <input
                  type="radio"
                  name="parar_recorrencia"
                  value="nao"
                  checked={pararRecorrencia === "nao"}
                  onChange={() => setPararRecorrencia("nao")}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-semibold">Só esta ocorrência</p>
                  <p className="text-xs text-muted-foreground">
                    O template continua ativo e vai gerar a próxima na data prevista.
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/50">
                <input
                  type="radio"
                  name="parar_recorrencia"
                  value="sim"
                  checked={pararRecorrencia === "sim"}
                  onChange={() => setPararRecorrencia("sim")}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-semibold">Parar toda a recorrência</p>
                  <p className="text-xs text-muted-foreground">
                    Este template é desativado. Nenhuma nova ocorrência será gerada até você reativar manualmente.
                  </p>
                </div>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
              >
                {pending ? "Confirmando..." : "Confirmar"}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Fluxo original (não recorrente): ConfirmDialog simples
  return (
    <>
      {/* ... comportamento atual mantido ... */}
    </>
  );
}
```

- [ ] **Step 3: Modificar `cancelar-baixa-avulsa-modal.tsx`**

Adicionar prop `recorrenteId: string | null`. Se != null, incluir o mesmo radio group ("Só esta ocorrência" / "Parar toda a recorrência") acima do textarea de motivo. Ao submeter, chama `estornarBaixaAvulsa({ conta_avulsa_id, motivo, parar_recorrencia })`.

- [ ] **Step 4: Modificar wrapper `CancelarBaixaAvulsaModalClient` no `acoes-client.tsx`**

Passar prop `recorrenteId` recebido da page.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/avulsa/\[id\]
git commit -m "task013: dialog contextual 'so esta ou parar recorrencia' em cancelar/excluir"
```

---

## Self-Review

**1. Spec coverage:**

- Seção 3 (decisões) — Tasks 1 (schema), 2 (pg_cron), 3 (funções), 4 (RPC+cron), 5 (actions), 6 (drawer), 7 (list+tabs), 8 (detalhes), 9 (dialog). ✅
- Seção 4 (modelagem) — Task 1. ✅
- Seção 5 (fluxo cron) — Tasks 2, 3, 4. ✅
- Seção 6 (regras) — Task 5 (actions) e Task 9 (dialog contextual). ✅
- Seção 7 (server actions + RPCs) — Tasks 3, 4, 5. ✅
- Seção 8 (UI) — Tasks 6, 7, 8, 9. ✅
- Seção 9 (RLS/audit) — Task 1 (RLS + audit actions) + Task 4 (audit dentro do cron). ✅
- Seção 10 (migrations) — Tasks 1, 2, 3, 4. ✅

**2. Placeholder scan:** revisei — nenhum "TBD" ou "implement later". Referências a padrões existentes (`<ContaAvulsaDrawer>`, `avulsas-list.tsx`, `avulsa/[id]/acoes-client.tsx`) apontam pro arquivo real que o implementador pode ler.

**3. Type consistency:**

- `FrequenciaRecorrencia`, `ContaAvulsaRecorrente` — definidos Task 1, usados 5, 6, 7, 8.
- `RecorrenteRow` — definido Task 7, usado Task 7 e Task 8 (via import do arquivo).
- `criarContaRecorrente(input)`, `editarContaRecorrente(id, input)`, `pausarContaRecorrente(id)`, `reativarContaRecorrente(id)`, `excluirContaRecorrente(id)` — assinaturas na Task 5, chamadas em 6, 8.
- `excluirContaAvulsa(id, opts?)`, `estornarBaixaAvulsa({..., parar_recorrencia?})` — estendidas na Task 5, usadas na Task 9.
- RPC `calcular_proxima_data_inicial(frequencia, dia_do_mes, dia_quinzena_1, dia_quinzena_2, dia_do_ano_dia, dia_do_ano_mes)` — Task 3, chamada nas Tasks 5 (criar) e 5 (reativar).
- RPC `gerar_ocorrencias_recorrentes()` — Task 4, agendada no cron.

Sem inconsistências.
