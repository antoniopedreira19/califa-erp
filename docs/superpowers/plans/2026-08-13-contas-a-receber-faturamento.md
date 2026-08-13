# Contas a Receber (Faturamento + Títulos) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o módulo `/financeiro/contas-a-receber` com duas abas (Faturamento e A Receber), consumindo automaticamente as fontes existentes (jobs abertos com `faturamento_previsto` e BVs `confirmado`) mais entrada manual de faturamento avulso, gerando títulos por parcela e alimentando `lancamentos_financeiros` (natureza=entrada) via RPCs transacionais.

**Architecture:** Duas tabelas novas (`faturamentos` e `titulos_receber`) numa relação 1→N. O vínculo com `lancamentos_financeiros` é indireto via título (nova FK `titulo_receber_id`, análoga ao padrão de `pedido_compra_id` e `conta_avulsa_id`). Views SQL alimentam a fila de faturamento pendente (jobs+BVs+saldo derivado) e estendem `vw_fluxo_caixa` com títulos em aberto como previsto de entrada. Reusa o `BaixaAvulsaDialog` compartilhado extraído no task015. UI segue o padrão de `contas-a-pagar` (tabs + listas + drawers + baixa dialog).

**Tech Stack:** Next.js App Router + TypeScript, Supabase (Postgres + RLS + Storage), React Hook Form + Zod, Tailwind + shadcn/ui, lucide-react. Migrations em `supabase/migrations/` versionadas + aplicadas via `mcp__supabase-write__apply_migration`.

**Spec:** [docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md](../specs/2026-08-13-contas-a-receber-faturamento-design.md)

## Global Constraints

- **Ortografia pt-BR:** toda string visível ao usuário com acentos/cedilha/til. Identificadores em código sem acento por convenção. `raise exception` das RPCs também em pt-BR completo (essas mensagens viram toast).
- **Performance (docs/PERFORMANCE.md):** `<Link>` em lista com 5+ itens navegáveis → `prefetch={false}`; queries independentes em server component → `Promise.all`; toda migration nova → `grant` explícito pra `authenticated` + índice em FK importante + policies RLS usam `is_tenant_member(tenant_id)`.
- **RLS:** todas as tabelas novas com `tenant_id`, RLS habilitado, policies pra select/insert/update/delete usando `is_tenant_member(tenant_id)`, GRANT explícito pra `authenticated`.
- **Server actions:** operações sensíveis vão por `"use server"` + gate `checarGateFinanceiro` (padrão em `app/(app)/financeiro/contas-a-pagar/actions.ts`). Roles aceitas: `administrador` ou `financeiro`.
- **Auditoria:** usar `logAuditEvent` de `lib/auth/audit` para: `faturamento.emitido`, `faturamento.cancelado`, `titulo.baixado`, `titulo.baixa_estornada`. Adicionar essas 4 strings ao union `AuditAction` em `lib/auth/audit.ts`.
- **Idempotência de migration:** `do $$ ... exception when duplicate_object` pra enums; `add column if not exists`; `create ... if not exists`; `create or replace function/view`.
- **RPCs:** `language plpgsql security definer set search_path = public`, com `is_tenant_member(...)` gate quando aplicável, `grant execute on function ... to authenticated` sempre.
- **Commits:** pequenos e descritivos, um por task, mensagem em português sem acento em código (mas com acento nas strings visíveis ao usuário).
- **Testes:** o projeto não tem suite automatizada. Validação por task: (a) `npm run lint`, (b) `npm run build`, (c) queries SQL de verificação listadas em cada task via `mcp__supabase-write__execute_sql`, (d) smoke manual quando envolver UI.
- **Migration apply:** SEMPRE aplicar via `mcp__supabase-write__apply_migration` E manter o arquivo SQL em `supabase/migrations/` — os dois passos são obrigatórios (task015 teve fix loop porque implementer pulou o apply).

---

## File Structure

**Migrations SQL** (`supabase/migrations/`)

- `20260813000001_faturamentos_tabela.sql` — enum status + tabela + índices + RLS + storage bucket + policies.
- `20260813000002_titulos_receber_tabela.sql` — enum status + tabela + índices + RLS.
- `20260813000003_lancamentos_financeiros_titulo_id.sql` — novos valores do enum + coluna FK + unique parcial + constraint update.
- `20260813000004_rpc_emitir_faturamento.sql` — RPC + GRANT.
- `20260813000005_rpc_baixa_titulo.sql` — 2 RPCs (dar_baixa + estornar) + GRANT + gatilho BV→recebido dentro das próprias RPCs (não trigger de tabela).
- `20260813000006_rpc_cancelar_faturamento.sql` — RPC + GRANT.
- `20260813000007_views_faturamento.sql` — `vw_faturamento_pendente` + `create or replace view vw_fluxo_caixa` (recria com nova branch) + GRANTs.

**Types TS** (`lib/`)

- **Modificar:** `lib/types.ts` — adicionar `FaturamentoStatus`, `TituloReceberStatus`, `FaturamentoOrigemTipo`, tipos `Faturamento`, `TituloReceber` e labels.
- **Modificar:** `lib/auth/audit.ts` — adicionar 4 strings ao union `AuditAction`.

**Front-end** (`app/(app)/financeiro/contas-a-receber/`)

- **Criar:** `page.tsx` — server component com Promise.all das queries, título/breadcrumb.
- **Criar:** `actions.ts` — server actions `emitirFaturamento`, `darBaixaTitulo`, `estornarBaixaTitulo`, `cancelarFaturamento`.
- **Criar:** `tabs.tsx` — client component com tabs Faturamento | A Receber.
- **Criar:** `faturamento-list.tsx` — fila a faturar (jobs + BVs + botão avulso).
- **Criar:** `faturar-drawer.tsx` — drawer que emite NF (usado pra job/BV/avulso; recebe origem via prop).
- **Criar:** `titulos-list.tsx` — lista de títulos com chips e ações.
- **Criar:** `cancelar-faturamento-modal.tsx` — confirmação com motivo.

**Landing** (`app/(app)/financeiro/`)

- **Modificar:** `page.tsx` — adicionar 5º card "Contas a Receber" + query de contagem.

---

## Task 1: Schema `faturamentos` + storage bucket

**Files:**
- Create: `supabase/migrations/20260813000001_faturamentos_tabela.sql`

**Interfaces:**
- Consumes: enums `tenants`, `empresas`, `clientes`, `fornecedores`, `plano_contas_tipos`, `plano_contas_subtipos`, `profiles`, função `is_tenant_member`.
- Produces:
  - Enum `faturamento_origem` (`'job'|'bv'|'avulso'`).
  - Enum `faturamento_status` (`'emitido'|'cancelado'`).
  - Tabela `public.faturamentos` com constraints:
    - `chk_faturamento_contraparte`: cliente_id XOR fornecedor_id conforme origem.
    - `chk_faturamento_origem`: origem_id null só se origem='avulso'.
    - `chk_faturamento_valor_positivo`: valor_total > 0.
    - `chk_faturamento_cancelado`: fields de cancelamento populados só se status='cancelado'.
  - Bucket privado `faturamentos-nf`.
  - Policies de RLS + storage.

- [ ] **Step 1: Criar arquivo de migration**

Criar `supabase/migrations/20260813000001_faturamentos_tabela.sql`:

```sql
-- =====================================================================
-- Faturamentos (NF emitida). Uma linha por NF.
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

-- 1) Enums
do $$ begin
  create type faturamento_origem as enum ('job', 'bv', 'avulso');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type faturamento_status as enum ('emitido', 'cancelado');
exception when duplicate_object then null;
end $$;

-- 2) Tabela
create table if not exists public.faturamentos (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete restrict,
  empresa_id             uuid not null references public.empresas(id) on delete restrict,
  origem_tipo            faturamento_origem not null,
  origem_id              uuid,
  cliente_id             uuid references public.clientes(id) on delete restrict,
  fornecedor_id          uuid references public.fornecedores(id) on delete restrict,
  numero_nf              text not null,
  serie                  text not null,
  data_emissao           date not null,
  valor_total            numeric(14, 2) not null,
  descricao              text not null,
  anexo_nf_path          text not null,
  plano_conta_tipo_id    uuid not null references public.plano_contas_tipos(id) on delete restrict,
  plano_conta_subtipo_id uuid not null references public.plano_contas_subtipos(id) on delete restrict,
  status                 faturamento_status not null default 'emitido',
  cancelado_em           timestamptz,
  cancelado_por          uuid references public.profiles(id),
  motivo_cancelamento    text,
  emitido_em             timestamptz not null default now(),
  emitido_por            uuid not null references public.profiles(id),

  constraint chk_faturamento_contraparte check (
    (origem_tipo in ('job','avulso') and cliente_id is not null and fornecedor_id is null)
    or
    (origem_tipo = 'bv' and fornecedor_id is not null and cliente_id is null)
  ),
  constraint chk_faturamento_origem check (
    (origem_tipo = 'avulso' and origem_id is null)
    or
    (origem_tipo in ('job','bv') and origem_id is not null)
  ),
  constraint chk_faturamento_valor_positivo check (valor_total > 0),
  constraint chk_faturamento_descricao_nao_vazia check (length(trim(descricao)) >= 3),
  constraint chk_faturamento_cancelado check (
    (status = 'cancelado' and cancelado_em is not null and cancelado_por is not null)
    or
    (status = 'emitido' and cancelado_em is null and cancelado_por is null and motivo_cancelamento is null)
  )
);

-- 3) Índices
create index if not exists idx_faturamentos_tenant on public.faturamentos(tenant_id);
create index if not exists idx_faturamentos_origem
  on public.faturamentos(tenant_id, origem_tipo, origem_id);
create index if not exists idx_faturamentos_status
  on public.faturamentos(tenant_id, status);
create index if not exists idx_faturamentos_cliente on public.faturamentos(cliente_id);
create index if not exists idx_faturamentos_fornecedor on public.faturamentos(fornecedor_id);
create index if not exists idx_faturamentos_empresa on public.faturamentos(empresa_id);

-- 4) RLS + GRANT
alter table public.faturamentos enable row level security;

drop policy if exists faturamentos_select on public.faturamentos;
create policy faturamentos_select on public.faturamentos
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists faturamentos_insert on public.faturamentos;
create policy faturamentos_insert on public.faturamentos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists faturamentos_update on public.faturamentos;
create policy faturamentos_update on public.faturamentos
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.faturamentos to authenticated;

-- 5) Storage bucket privado
insert into storage.buckets (id, name, public)
values ('faturamentos-nf', 'faturamentos-nf', false)
on conflict (id) do nothing;

drop policy if exists faturamentos_storage_select on storage.objects;
create policy faturamentos_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'faturamentos-nf'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists faturamentos_storage_insert on storage.objects;
create policy faturamentos_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'faturamentos-nf'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists faturamentos_storage_delete on storage.objects;
create policy faturamentos_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'faturamentos-nf'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );
```

- [ ] **Step 2: Aplicar migration via MCP**

Chamar `mcp__supabase-write__apply_migration` com:
- `name`: `faturamentos_tabela`
- `query`: o conteúdo completo do arquivo acima

- [ ] **Step 3: Verificação SQL**

Via `mcp__supabase-write__execute_sql`:

```sql
-- Enums existem?
select unnest(enum_range(null::faturamento_origem))::text as origem;
-- Deve retornar: job, bv, avulso

select unnest(enum_range(null::faturamento_status))::text as status;
-- Deve retornar: emitido, cancelado

-- Tabela existe com colunas certas?
select column_name from information_schema.columns
 where table_name = 'faturamentos'
 order by ordinal_position;

-- Bucket existe?
select id, name, public from storage.buckets where id = 'faturamentos-nf';
-- public deve ser false

-- Policies existem?
select policyname from pg_policies
 where tablename = 'faturamentos'
 order by policyname;
```

- [ ] **Step 4: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

Nada muda em TS ainda — build só confirma nada quebrou.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/20260813000001_faturamentos_tabela.sql
git commit -m @'
cr(001): tabela faturamentos + storage bucket

Cria enum faturamento_origem (job/bv/avulso) e faturamento_status
(emitido/cancelado). Tabela com constraints de contraparte coerente
(cliente xor fornecedor conforme origem) e origem_id obrigatório
exceto para avulso.

Storage bucket privado faturamentos-nf com policies por tenant no
prefixo do path.
'@
```

---

## Task 2: Schema `titulos_receber`

**Files:**
- Create: `supabase/migrations/20260813000002_titulos_receber_tabela.sql`

**Interfaces:**
- Consumes: tabela `faturamentos` (Task 1), `contas_bancarias`, `profiles`.
- Produces:
  - Enum `titulo_receber_status` (`'em_aberto'|'pago'|'cancelado'`).
  - Tabela `public.titulos_receber` com constraints:
    - `chk_titulo_pago_consistente`: fields de baixa populados só se status='pago'.
    - `chk_titulo_valor_positivo`: valor > 0.
  - Índice partial `idx_titulos_vencimento_em_aberto` para query de inadimplentes.

- [ ] **Step 1: Criar migration**

`supabase/migrations/20260813000002_titulos_receber_tabela.sql`:

```sql
-- =====================================================================
-- Títulos a receber (parcelas de uma NF). 1 faturamento → N títulos.
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

-- 1) Enum
do $$ begin
  create type titulo_receber_status as enum ('em_aberto', 'pago', 'cancelado');
exception when duplicate_object then null;
end $$;

-- 2) Tabela
create table if not exists public.titulos_receber (
  id                              uuid primary key default gen_random_uuid(),
  tenant_id                       uuid not null references public.tenants(id) on delete restrict,
  empresa_id                      uuid not null references public.empresas(id) on delete restrict,
  faturamento_id                  uuid not null references public.faturamentos(id) on delete restrict,
  numero_parcela                  smallint not null,
  valor                           numeric(14, 2) not null,
  data_vencimento                 date not null,
  status                          titulo_receber_status not null default 'em_aberto',
  pago_em                         date,
  pago_por                        uuid references public.profiles(id),
  conta_bancaria_recebimento_id   uuid references public.contas_bancarias(id) on delete restrict,
  lancamento_id                   uuid, -- FK adicionada em migration posterior (dependência circular resolvida na Task 3)
  cancelado_em                    timestamptz,
  cancelado_por                   uuid references public.profiles(id),
  created_at                      timestamptz not null default now(),

  constraint chk_titulo_pago_consistente check (
    (status = 'pago'
      and pago_em is not null
      and pago_por is not null
      and conta_bancaria_recebimento_id is not null
      and lancamento_id is not null)
    or
    (status <> 'pago'
      and pago_em is null
      and pago_por is null
      and conta_bancaria_recebimento_id is null
      and lancamento_id is null)
  ),
  constraint chk_titulo_valor_positivo check (valor > 0),
  constraint chk_titulo_parcela_positiva check (numero_parcela > 0)
);

-- 3) Índices
create index if not exists idx_titulos_tenant on public.titulos_receber(tenant_id);
create index if not exists idx_titulos_faturamento on public.titulos_receber(faturamento_id);
create index if not exists idx_titulos_status on public.titulos_receber(tenant_id, status);
create index if not exists idx_titulos_vencimento_em_aberto
  on public.titulos_receber(tenant_id, data_vencimento)
  where status = 'em_aberto';
create index if not exists idx_titulos_empresa on public.titulos_receber(empresa_id);

-- 4) RLS + GRANT
alter table public.titulos_receber enable row level security;

drop policy if exists titulos_select on public.titulos_receber;
create policy titulos_select on public.titulos_receber
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists titulos_insert on public.titulos_receber;
create policy titulos_insert on public.titulos_receber
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists titulos_update on public.titulos_receber;
create policy titulos_update on public.titulos_receber
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.titulos_receber to authenticated;
```

- [ ] **Step 2: Aplicar via MCP**

Nome: `titulos_receber_tabela`. Query: conteúdo do arquivo.

- [ ] **Step 3: Verificação SQL**

```sql
select unnest(enum_range(null::titulo_receber_status))::text;
-- em_aberto, pago, cancelado

select column_name from information_schema.columns
 where table_name = 'titulos_receber'
 order by ordinal_position;

-- Índice partial existe?
select indexname from pg_indexes
 where tablename = 'titulos_receber'
   and indexname = 'idx_titulos_vencimento_em_aberto';
```

- [ ] **Step 4: Commit**

```powershell
git add supabase/migrations/20260813000002_titulos_receber_tabela.sql
git commit -m @'
cr(002): tabela titulos_receber (parcelas da NF)

1 faturamento vira N titulos. Status em_aberto/pago/cancelado
(inadimplente e calculado, nao persistido). Indice partial em
data_vencimento where status='em_aberto' pra listagem rapida
de vencidos.

Coluna lancamento_id nullable sem FK aqui — a FK vai na Task 3
depois que o enum origem_lancamento ganhar titulo_baixa.
'@
```

---

## Task 3: Extensão de `lancamentos_financeiros`

**Files:**
- Create: `supabase/migrations/20260813000003_lancamentos_financeiros_titulo_id.sql`

**Interfaces:**
- Consumes: enum `origem_lancamento`, tabela `lancamentos_financeiros`, tabela `titulos_receber` (Task 2).
- Produces:
  - Enum `origem_lancamento` ganha `titulo_baixa`, `titulo_baixa_estornada`, `titulo_estorno`.
  - Coluna `titulo_receber_id uuid` em `lancamentos_financeiros` com FK.
  - FK reversa `titulos_receber.lancamento_id → lancamentos_financeiros(id)`.
  - Unique parcial `uniq_baixa_ativa_por_titulo`.
  - Constraint atualizada garantindo que se origem é de título, `titulo_receber_id` está populado.

- [ ] **Step 1: Criar migration**

`supabase/migrations/20260813000003_lancamentos_financeiros_titulo_id.sql`:

```sql
-- =====================================================================
-- Estende lancamentos_financeiros para receber baixa de titulo.
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

-- 1) Adiciona valores no enum origem_lancamento
alter type origem_lancamento add value if not exists 'titulo_baixa' before 'manual';
alter type origem_lancamento add value if not exists 'titulo_baixa_estornada' before 'manual';
alter type origem_lancamento add value if not exists 'titulo_estorno' before 'manual';
```

Aplicar via MCP com name `lancamentos_titulo_enum_add` (transação separada — ADD VALUE precisa commit antes de ser usado).

- [ ] **Step 2: Segunda migration (colunas, FKs, unique, constraint)**

Criar `supabase/migrations/20260813000003b_lancamentos_financeiros_titulo_fk.sql`:

```sql
-- 2) Coluna FK em lancamentos_financeiros
alter table public.lancamentos_financeiros
  add column if not exists titulo_receber_id uuid
    references public.titulos_receber(id) on delete restrict;

create index if not exists idx_lanc_titulo
  on public.lancamentos_financeiros(titulo_receber_id);

-- 3) Unique parcial pra baixa ativa (evita duplicar baixa do mesmo titulo)
create unique index if not exists uniq_baixa_ativa_por_titulo
  on public.lancamentos_financeiros(titulo_receber_id)
  where origem = 'titulo_baixa';

-- 4) FK reversa em titulos_receber
alter table public.titulos_receber
  drop constraint if exists titulos_receber_lancamento_id_fkey;

alter table public.titulos_receber
  add constraint titulos_receber_lancamento_id_fkey
  foreign key (lancamento_id)
  references public.lancamentos_financeiros(id)
  on delete restrict;

-- 5) Atualiza constraint chk_origem_pp_tem_pp_id -> chk_origem_contraparte_tem_id
--    (renomeia + amplia pra cobrir titulo)
alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_pp_tem_pp_id;

alter table public.lancamentos_financeiros
  add constraint chk_origem_contraparte_tem_id check (
    (origem in ('pp_baixa','pp_baixa_estornada','pp_estorno') and pedido_compra_id is not null)
    or
    (origem in ('avulsa_baixa','avulsa_baixa_estornada','avulsa_estorno') and conta_avulsa_id is not null)
    or
    (origem in ('titulo_baixa','titulo_baixa_estornada','titulo_estorno') and titulo_receber_id is not null)
    or
    (origem = 'manual'
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null)
  );
```

Aplicar via MCP com name `lancamentos_titulo_fk_e_constraint`.

- [ ] **Step 3: Verificação SQL**

```sql
-- Enum tem os 3 novos valores?
select unnest(enum_range(null::origem_lancamento))::text as v
 where v like 'titulo%';
-- Deve retornar: titulo_baixa, titulo_baixa_estornada, titulo_estorno

-- Coluna existe?
select column_name from information_schema.columns
 where table_name = 'lancamentos_financeiros'
   and column_name = 'titulo_receber_id';

-- Unique parcial existe?
select indexname from pg_indexes
 where tablename = 'lancamentos_financeiros'
   and indexname = 'uniq_baixa_ativa_por_titulo';

-- FK reversa existe?
select conname from pg_constraint
 where conrelid = 'public.titulos_receber'::regclass
   and contype = 'f'
   and conname = 'titulos_receber_lancamento_id_fkey';
```

- [ ] **Step 4: Commit**

```powershell
git add supabase/migrations/20260813000003_lancamentos_financeiros_titulo_id.sql supabase/migrations/20260813000003b_lancamentos_financeiros_titulo_fk.sql
git commit -m @'
cr(003): lancamentos_financeiros ganha vinculo com titulo_receber

Adiciona 3 valores no enum origem_lancamento (titulo_baixa,
titulo_baixa_estornada, titulo_estorno), coluna FK titulo_receber_id,
FK reversa em titulos_receber.lancamento_id, unique parcial pra
baixa ativa (mesma semantica de PP), e amplia a constraint
chk_origem_* pra cobrir titulos.

Aplicado em duas migrations (add enum value + resto) por conta da
regra do Postgres que exige commit antes de usar novo valor de enum.
'@
```

---

## Task 4: RPC `emitir_faturamento`

**Files:**
- Create: `supabase/migrations/20260813000004_rpc_emitir_faturamento.sql`

**Interfaces:**
- Consumes: tabelas `faturamentos` (Task 1), `titulos_receber` (Task 2).
- Produces:
  - Função `public.emitir_faturamento(payload jsonb) returns uuid` com GRANT execute.
  - Aceita payload:
    ```json
    {
      "tenant_id": "...",
      "empresa_id": "...",
      "origem_tipo": "job|bv|avulso",
      "origem_id": "..." | null,
      "cliente_id": "..." | null,
      "fornecedor_id": "..." | null,
      "numero_nf": "...",
      "serie": "...",
      "data_emissao": "YYYY-MM-DD",
      "valor_total": 100.00,
      "descricao": "...",
      "anexo_nf_path": "...",
      "plano_conta_tipo_id": "...",
      "plano_conta_subtipo_id": "...",
      "emitido_por": "...",
      "parcelas": [
        { "numero": 1, "valor": 50.00, "data_vencimento": "YYYY-MM-DD" },
        { "numero": 2, "valor": 50.00, "data_vencimento": "YYYY-MM-DD" }
      ]
    }
    ```
  - Valida: soma das parcelas = valor_total; subtipo pertence ao tipo; is_tenant_member.
  - Retorna `faturamento_id`.

- [ ] **Step 1: Criar migration**

`supabase/migrations/20260813000004_rpc_emitir_faturamento.sql`:

```sql
-- =====================================================================
-- RPC transacional pra emitir NF + criar N titulos filhos.
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

create or replace function public.emitir_faturamento(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id     uuid := (payload->>'tenant_id')::uuid;
  v_empresa_id    uuid := (payload->>'empresa_id')::uuid;
  v_origem_tipo   faturamento_origem := (payload->>'origem_tipo')::faturamento_origem;
  v_origem_id     uuid := nullif(payload->>'origem_id', '')::uuid;
  v_cliente_id    uuid := nullif(payload->>'cliente_id', '')::uuid;
  v_fornecedor_id uuid := nullif(payload->>'fornecedor_id', '')::uuid;
  v_valor_total   numeric(14,2) := (payload->>'valor_total')::numeric;
  v_tipo_id       uuid := (payload->>'plano_conta_tipo_id')::uuid;
  v_subtipo_id    uuid := (payload->>'plano_conta_subtipo_id')::uuid;
  v_emitido_por   uuid := (payload->>'emitido_por')::uuid;
  v_faturamento_id uuid;
  v_parcelas      jsonb := payload->'parcelas';
  v_soma_parcelas numeric(14,2) := 0;
  v_parcela       jsonb;
  v_subtipo_tipo  uuid;
begin
  if not public.is_tenant_member(v_tenant_id) then
    raise exception 'Sem acesso a este tenant.';
  end if;

  if jsonb_array_length(v_parcelas) < 1 then
    raise exception 'Faturamento precisa de pelo menos uma parcela.';
  end if;

  -- Valida subtipo pertence ao tipo
  select tipo_id into v_subtipo_tipo
    from public.plano_contas_subtipos where id = v_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> v_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  -- Soma parcelas e valida bate com valor_total
  for v_parcela in select * from jsonb_array_elements(v_parcelas)
  loop
    v_soma_parcelas := v_soma_parcelas + (v_parcela->>'valor')::numeric;
  end loop;

  if abs(v_soma_parcelas - v_valor_total) > 0.01 then
    raise exception 'Soma das parcelas (R$ %) não bate com valor total (R$ %).',
      v_soma_parcelas, v_valor_total;
  end if;

  -- INSERT faturamento
  insert into public.faturamentos (
    tenant_id, empresa_id, origem_tipo, origem_id,
    cliente_id, fornecedor_id,
    numero_nf, serie, data_emissao, valor_total, descricao,
    anexo_nf_path, plano_conta_tipo_id, plano_conta_subtipo_id,
    emitido_por
  ) values (
    v_tenant_id, v_empresa_id, v_origem_tipo, v_origem_id,
    v_cliente_id, v_fornecedor_id,
    payload->>'numero_nf', payload->>'serie',
    (payload->>'data_emissao')::date, v_valor_total, payload->>'descricao',
    payload->>'anexo_nf_path', v_tipo_id, v_subtipo_id,
    v_emitido_por
  )
  returning id into v_faturamento_id;

  -- INSERT parcelas
  for v_parcela in select * from jsonb_array_elements(v_parcelas)
  loop
    insert into public.titulos_receber (
      tenant_id, empresa_id, faturamento_id,
      numero_parcela, valor, data_vencimento
    ) values (
      v_tenant_id, v_empresa_id, v_faturamento_id,
      (v_parcela->>'numero')::smallint,
      (v_parcela->>'valor')::numeric,
      (v_parcela->>'data_vencimento')::date
    );
  end loop;

  return v_faturamento_id;
end;
$$;

grant execute on function public.emitir_faturamento(jsonb) to authenticated;
```

Aplicar via MCP com name `rpc_emitir_faturamento`.

- [ ] **Step 2: Teste manual da RPC**

Via `mcp__supabase-write__execute_sql`, testar com um payload mínimo (só se ambiente tiver dados prontos; senão pular). Exemplo do formato:

```sql
-- Só rodar se houver tenant/empresa/cliente/tipo/subtipo disponíveis:
select public.emitir_faturamento(jsonb_build_object(
  'tenant_id', '<uuid>',
  'empresa_id', '<uuid>',
  'origem_tipo', 'avulso',
  'origem_id', null,
  'cliente_id', '<uuid>',
  'fornecedor_id', null,
  'numero_nf', 'TEST-001',
  'serie', '1',
  'data_emissao', current_date::text,
  'valor_total', 100.00,
  'descricao', 'Teste',
  'anexo_nf_path', 'dummy/path.pdf',
  'plano_conta_tipo_id', '<uuid>',
  'plano_conta_subtipo_id', '<uuid>',
  'emitido_por', '<uuid>',
  'parcelas', jsonb_build_array(
    jsonb_build_object('numero', 1, 'valor', 100.00, 'data_vencimento', (current_date + 30)::text)
  )
));
```

Se dados disponíveis: rodar, confirmar retorno UUID, `select * from faturamentos` mostra a linha, `select * from titulos_receber` mostra o título. Depois `delete from titulos_receber where faturamento_id = X; delete from faturamentos where id = X;` para limpar.

Se não houver dados, apenas confirmar via `select proname from pg_proc where proname = 'emitir_faturamento';` que a função existe.

- [ ] **Step 3: Commit**

```powershell
git add supabase/migrations/20260813000004_rpc_emitir_faturamento.sql
git commit -m @'
cr(004): RPC emitir_faturamento transacional

Recebe payload jsonb com faturamento + array de parcelas. Valida:
soma das parcelas bate com valor_total (tolerancia R$ 0,01),
subtipo pertence ao tipo, tenant do caller. Cria 1 faturamento
+ N titulos_receber numa transacao unica.
'@
```

---

## Task 5: RPCs `dar_baixa_titulo` + `estornar_baixa_titulo`

**Files:**
- Create: `supabase/migrations/20260813000005_rpc_baixa_titulo.sql`

**Interfaces:**
- Consumes: tabelas `titulos_receber`, `faturamentos`, `lancamentos_financeiros`, `itens_bv` (para atualizar situação de BV).
- Produces:
  - `public.dar_baixa_titulo(p_titulo_id uuid, p_pago_em date, p_conta_bancaria_id uuid, p_criado_por uuid) returns uuid` (retorna lancamento_id).
  - `public.estornar_baixa_titulo(p_titulo_id uuid, p_motivo text, p_criado_por uuid) returns uuid` (retorna lancamento_reverso_id).
  - Ambos gerenciam a transição de `itens_bv.situacao` quando aplicável.

- [ ] **Step 1: Criar migration**

`supabase/migrations/20260813000005_rpc_baixa_titulo.sql`:

```sql
-- =====================================================================
-- RPCs transacionais de baixa e estorno de titulo a receber.
-- Ao baixar/estornar o ultimo titulo ativo de um faturamento com
-- origem_tipo='bv', atualiza itens_bv.situacao pra fechar/reabrir o ciclo.
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

create or replace function public.dar_baixa_titulo(
  p_titulo_id            uuid,
  p_pago_em              date,
  p_conta_bancaria_id    uuid,
  p_criado_por           uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_titulo         titulos_receber%rowtype;
  v_fat            faturamentos%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_lancamento_id  uuid;
  v_descricao      text;
  v_todos_pagos    boolean;
begin
  -- 1. Carrega titulo + valida
  select * into v_titulo from public.titulos_receber where id = p_titulo_id;
  if not found then raise exception 'Título não encontrado.'; end if;
  if not public.is_tenant_member(v_titulo.tenant_id) then
    raise exception 'Sem acesso a este título.';
  end if;
  if v_titulo.status <> 'em_aberto' then
    raise exception 'Título não está em aberto (status atual: %).', v_titulo.status;
  end if;

  -- 2. Carrega faturamento pai (pra descrição, tipo/subtipo, contraparte)
  select * into v_fat from public.faturamentos where id = v_titulo.faturamento_id;
  if v_fat.status = 'cancelado' then
    raise exception 'Faturamento pai está cancelado.';
  end if;

  -- 3. Carrega conta + valida empresa/data
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_titulo.empresa_id then
    raise exception 'Conta bancária não pertence à empresa do título.';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do recebimento é anterior à data do saldo inicial da conta.';
  end if;

  -- 4. INSERT lançamento (natureza=entrada)
  v_descricao := 'Recebimento NF ' || v_fat.numero_nf || '/' ||
                 v_titulo.numero_parcela::text || ' — ' ||
                 substring(v_fat.descricao, 1, 120);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id,
    titulo_receber_id, origem, criado_por
  ) values (
    v_titulo.tenant_id, v_titulo.empresa_id, p_conta_bancaria_id, p_pago_em, v_titulo.valor,
    'entrada', v_descricao, v_fat.plano_conta_tipo_id, v_fat.plano_conta_subtipo_id,
    v_fat.fornecedor_id, v_fat.cliente_id,
    v_titulo.id, 'titulo_baixa', p_criado_por
  )
  returning id into v_lancamento_id;

  -- 5. UPDATE título → pago
  update public.titulos_receber
     set status = 'pago',
         pago_em = p_pago_em,
         pago_por = p_criado_por,
         conta_bancaria_recebimento_id = p_conta_bancaria_id,
         lancamento_id = v_lancamento_id
   where id = p_titulo_id;

  -- 6. Se origem='bv' e agora todos os títulos do faturamento estão pagos,
  --    atualiza itens_bv.situacao = 'recebido'
  if v_fat.origem_tipo = 'bv' then
    select bool_and(status = 'pago')
      into v_todos_pagos
      from public.titulos_receber
     where faturamento_id = v_fat.id
       and status <> 'cancelado';
    if v_todos_pagos then
      update public.itens_bv
         set situacao = 'recebido'
       where id = v_fat.origem_id;
    end if;
  end if;

  return v_lancamento_id;
end;
$$;

grant execute on function public.dar_baixa_titulo(uuid, date, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------

create or replace function public.estornar_baixa_titulo(
  p_titulo_id   uuid,
  p_motivo      text,
  p_criado_por  uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_titulo     titulos_receber%rowtype;
  v_fat        faturamentos%rowtype;
  v_original   lancamentos_financeiros%rowtype;
  v_reverso_id uuid;
  v_descricao  text;
begin
  if p_motivo is null or length(trim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_titulo from public.titulos_receber where id = p_titulo_id;
  if not found then raise exception 'Título não encontrado.'; end if;
  if not public.is_tenant_member(v_titulo.tenant_id) then
    raise exception 'Sem acesso a este título.';
  end if;
  if v_titulo.status <> 'pago' then
    raise exception 'Título não está pago (status atual: %).', v_titulo.status;
  end if;

  select * into v_fat from public.faturamentos where id = v_titulo.faturamento_id;

  -- Carrega lançamento original (única baixa ativa)
  select * into v_original
    from public.lancamentos_financeiros
   where titulo_receber_id = p_titulo_id and origem = 'titulo_baixa'
   limit 1;
  if not found then raise exception 'Lançamento original não encontrado.'; end if;

  v_descricao := 'Estorno da baixa NF ' || v_fat.numero_nf || '/' ||
                 v_titulo.numero_parcela::text || ' — ' ||
                 substring(p_motivo, 1, 200);

  -- INSERT lançamento reverso (natureza invertida)
  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, titulo_receber_id,
    estorno_de_lancamento_id, origem, criado_por
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    'saida'::natureza_lancamento,
    v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    v_original.fornecedor_id, v_original.cliente_id, v_original.titulo_receber_id,
    v_original.id, 'titulo_estorno', p_criado_por
  )
  returning id into v_reverso_id;

  -- UPDATE original → libera unique parcial
  update public.lancamentos_financeiros
     set origem = 'titulo_baixa_estornada'
   where id = v_original.id;

  -- UPDATE título → em_aberto (limpa fields)
  update public.titulos_receber
     set status = 'em_aberto',
         pago_em = null,
         pago_por = null,
         conta_bancaria_recebimento_id = null,
         lancamento_id = null
   where id = p_titulo_id;

  -- Se origem='bv' e BV estava 'recebido', volta pra 'confirmado'
  if v_fat.origem_tipo = 'bv' then
    update public.itens_bv
       set situacao = 'confirmado'
     where id = v_fat.origem_id
       and situacao = 'recebido';
  end if;

  return v_reverso_id;
end;
$$;

grant execute on function public.estornar_baixa_titulo(uuid, text, uuid) to authenticated;
```

Aplicar via MCP com name `rpc_baixa_titulo_e_estorno`.

- [ ] **Step 2: Verificação SQL**

```sql
-- As duas RPCs existem?
select proname from pg_proc
 where proname in ('dar_baixa_titulo', 'estornar_baixa_titulo')
 order by proname;
```

- [ ] **Step 3: Commit**

```powershell
git add supabase/migrations/20260813000005_rpc_baixa_titulo.sql
git commit -m @'
cr(005): RPCs dar_baixa_titulo e estornar_baixa_titulo

Baixa cria lancamento_financeiro natureza=entrada com origem=titulo_baixa;
title vira pago com todos os fields de baixa. Estorno cria reverso
(saida), muda origem do original pra titulo_baixa_estornada (libera
unique parcial), title volta pra em_aberto.

Quando origem do faturamento e 'bv' e todos titulos do faturamento
ficam pagos, itens_bv.situacao vira 'recebido'. Estorno reverte
recebido -> confirmado se aplicavel.
'@
```

---

## Task 6: RPC `cancelar_faturamento`

**Files:**
- Create: `supabase/migrations/20260813000006_rpc_cancelar_faturamento.sql`

**Interfaces:**
- Consumes: tabelas `faturamentos`, `titulos_receber`, `itens_bv`.
- Produces:
  - `public.cancelar_faturamento(p_faturamento_id uuid, p_motivo text, p_cancelado_por uuid) returns void`.
  - Se algum título estiver pago → RAISE.
  - Títulos `em_aberto` → viram `cancelado`.
  - Se origem='bv' → itens_bv.situacao volta pra 'confirmado'.

- [ ] **Step 1: Criar migration**

`supabase/migrations/20260813000006_rpc_cancelar_faturamento.sql`:

```sql
-- =====================================================================
-- RPC transacional pra cancelar NF emitida.
-- Bloqueia se qualquer titulo ja foi baixado (obriga estornar antes).
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

create or replace function public.cancelar_faturamento(
  p_faturamento_id uuid,
  p_motivo         text,
  p_cancelado_por  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fat           faturamentos%rowtype;
  v_qtd_pagos     integer;
begin
  if p_motivo is null or length(trim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_fat from public.faturamentos where id = p_faturamento_id;
  if not found then raise exception 'Faturamento não encontrado.'; end if;
  if not public.is_tenant_member(v_fat.tenant_id) then
    raise exception 'Sem acesso a este faturamento.';
  end if;
  if v_fat.status <> 'emitido' then
    raise exception 'Faturamento já está cancelado.';
  end if;

  -- Bloqueia se algum titulo ja foi pago
  select count(*) into v_qtd_pagos
    from public.titulos_receber
   where faturamento_id = p_faturamento_id
     and status = 'pago';

  if v_qtd_pagos > 0 then
    raise exception 'Existem % títulos já baixados. Estorne as baixas antes de cancelar a NF.', v_qtd_pagos;
  end if;

  -- Cancela titulos em aberto
  update public.titulos_receber
     set status = 'cancelado',
         cancelado_em = now(),
         cancelado_por = p_cancelado_por
   where faturamento_id = p_faturamento_id
     and status = 'em_aberto';

  -- Cancela o faturamento
  update public.faturamentos
     set status = 'cancelado',
         cancelado_em = now(),
         cancelado_por = p_cancelado_por,
         motivo_cancelamento = p_motivo
   where id = p_faturamento_id;

  -- Se origem='bv', volta BV pra 'confirmado' (fica na fila de novo)
  if v_fat.origem_tipo = 'bv' then
    update public.itens_bv
       set situacao = 'confirmado'
     where id = v_fat.origem_id
       and situacao in ('recebido', 'confirmado'); -- confirmado é no-op mas explícito
  end if;

  -- Se origem='job': nada a fazer aqui — a fila derivada recalcula sozinha
  --   (saldo = previsto - sum(faturamentos ativos))
end;
$$;

grant execute on function public.cancelar_faturamento(uuid, text, uuid) to authenticated;
```

Aplicar via MCP com name `rpc_cancelar_faturamento`.

- [ ] **Step 2: Verificação**

```sql
select proname from pg_proc where proname = 'cancelar_faturamento';
```

- [ ] **Step 3: Commit**

```powershell
git add supabase/migrations/20260813000006_rpc_cancelar_faturamento.sql
git commit -m @'
cr(006): RPC cancelar_faturamento com cascata em titulos

Bloqueia cancelamento se qualquer titulo do faturamento ja foi pago
(obriga estornar antes). Titulos em_aberto viram cancelado. Se origem
e BV, volta itens_bv.situacao pra confirmado. Origem job: nada a
fazer — fila derivada recalcula saldo sozinha.
'@
```

---

## Task 7: Views `vw_faturamento_pendente` + update `vw_fluxo_caixa`

**Files:**
- Create: `supabase/migrations/20260813000007_views_faturamento.sql`

**Interfaces:**
- Consumes: `faturamentos`, `titulos_receber`, `jobs`, `projetos`, `itens_bv`, `versoes_orcamento_itens`, `pedidos_compra`, `contas_avulsas`, `lancamentos_financeiros`.
- Produces:
  - `public.vw_faturamento_pendente` — jobs com saldo + BVs confirmados sem faturamento ativo.
  - `public.vw_fluxo_caixa` recriada com nova branch de títulos em aberto (previsto entrada).
  - GRANT select em ambas.

- [ ] **Step 1: Criar migration**

`supabase/migrations/20260813000007_views_faturamento.sql`:

```sql
-- =====================================================================
-- Views: vw_faturamento_pendente (fila a faturar) e vw_fluxo_caixa
-- estendida com titulos em aberto como previsto de entrada.
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

-- 1) vw_faturamento_pendente — jobs com saldo + BVs confirmados sem faturamento
create or replace view public.vw_faturamento_pendente as
select
  'job'::text                                                as origem_tipo,
  j.id                                                       as origem_id,
  j.tenant_id,
  j.empresa_id,
  j.codigo                                                   as codigo,
  j.nome                                                     as descricao,
  p.cliente_id                                               as cliente_id,
  null::uuid                                                 as fornecedor_id,
  j.faturamento_previsto                                     as valor_previsto,
  coalesce(sum(f.valor_total) filter (where f.status = 'emitido'), 0)::numeric(14,2)
                                                             as valor_ja_faturado,
  (j.faturamento_previsto
    - coalesce(sum(f.valor_total) filter (where f.status = 'emitido'), 0))::numeric(14,2)
                                                             as saldo,
  j.data_prevista_faturamento                                as data_prevista
from public.jobs j
join public.projetos p on p.id = j.projeto_id
left join public.faturamentos f
  on f.origem_tipo = 'job' and f.origem_id = j.id
where j.status = 'aberto'
  and j.faturamento_previsto is not null
  and j.faturamento_previsto > 0
group by j.id, p.cliente_id
having (j.faturamento_previsto
        - coalesce(sum(f.valor_total) filter (where f.status = 'emitido'), 0)) > 0

union all

-- BVs confirmados sem faturamento ativo
select
  'bv'::text                                                 as origem_tipo,
  bv.id                                                      as origem_id,
  bv.tenant_id,
  null::uuid                                                 as empresa_id,   -- BV nao tem empresa emissora natural
  null::text                                                 as codigo,
  ('BV — ' || v.item)                                        as descricao,
  null::uuid                                                 as cliente_id,
  bv.fornecedor_id,
  bv.valor                                                   as valor_previsto,
  0::numeric(14,2)                                           as valor_ja_faturado,
  bv.valor                                                   as saldo,
  bv.prazo_repasse                                           as data_prevista
from public.itens_bv bv
join public.versoes_orcamento_itens v on v.id = bv.item_versao_id
where bv.situacao = 'confirmado'
  and not exists (
    select 1 from public.faturamentos f
     where f.origem_tipo = 'bv' and f.origem_id = bv.id and f.status = 'emitido'
  );

grant select on public.vw_faturamento_pendente to authenticated;

-- 2) vw_fluxo_caixa — recria com a nova branch de titulos em aberto
create or replace view public.vw_fluxo_caixa as
-- PPs aprovadas ainda não pagas (previsto saida)
select
  'previsto'::text                          as situacao,
  'pp'::text                                as origem_tipo,
  pp.id                                     as origem_id,
  pp.tenant_id, pp.empresa_id,
  null::uuid                                as conta_bancaria_id,
  pp.prazo_pagamento_financeiro             as data_evento,
  pp.valor::numeric(14,2)                   as valor,
  'saida'::natureza_lancamento              as natureza,
  ('PP ' || pp.codigo || ' — ' || substring(pp.servico, 1, 150)) as descricao,
  pp.fornecedor_id,
  null::uuid                                as cliente_id,
  pp.job_id
from public.pedidos_compra pp
where pp.status = 'aprovada'

union all

-- Avulsas aprovadas (previsto saida ou entrada)
select
  'previsto',
  case when a.recorrente_id is not null then 'recorrente' else 'avulsa' end,
  a.id,
  a.tenant_id, a.empresa_id,
  null::uuid                                as conta_bancaria_id,
  a.data_prevista_pagamento,
  a.valor::numeric(14,2),
  a.natureza,
  a.descricao,
  a.fornecedor_id, a.cliente_id, a.job_id
from public.contas_avulsas a
where a.status = 'aprovada'

union all

-- Títulos em aberto (previsto entrada)
select
  'previsto',
  'titulo'::text                            as origem_tipo,
  t.id                                      as origem_id,
  t.tenant_id, t.empresa_id,
  null::uuid                                as conta_bancaria_id,
  t.data_vencimento                         as data_evento,
  t.valor,
  'entrada'::natureza_lancamento,
  ('Título NF ' || f.numero_nf || '/' || t.numero_parcela::text) as descricao,
  f.fornecedor_id, f.cliente_id,
  null::uuid                                as job_id
from public.titulos_receber t
join public.faturamentos f on f.id = t.faturamento_id
where t.status = 'em_aberto'

union all

-- Realizado (lancamentos financeiros)
select
  'realizado',
  'lancamento',
  l.id,
  l.tenant_id, l.empresa_id,
  l.conta_bancaria_id,
  l.data_movimento,
  l.valor,
  l.natureza,
  l.descricao,
  l.fornecedor_id, l.cliente_id, l.job_id
from public.lancamentos_financeiros l;

grant select on public.vw_fluxo_caixa to authenticated;
```

Aplicar via MCP com name `views_faturamento`.

- [ ] **Step 2: Verificação SQL**

```sql
-- Views existem?
select viewname from pg_views
 where viewname in ('vw_faturamento_pendente', 'vw_fluxo_caixa')
 order by viewname;

-- vw_faturamento_pendente query funciona? (retorna 0+ linhas OK)
select count(*) from public.vw_faturamento_pendente;

-- vw_fluxo_caixa continua funcional após recriação
select situacao, count(*) from public.vw_fluxo_caixa group by 1 order by 1;
```

- [ ] **Step 3: Commit**

```powershell
git add supabase/migrations/20260813000007_views_faturamento.sql
git commit -m @'
cr(007): views vw_faturamento_pendente + vw_fluxo_caixa estendida

vw_faturamento_pendente unifica jobs abertos com saldo (previsto -
sum(faturamentos ativos) > 0) e BVs confirmados sem faturamento
ativo, com colunas normalizadas (valor_previsto, valor_ja_faturado,
saldo, data_prevista).

vw_fluxo_caixa recriada adicionando 4a branch: titulos_receber
em_aberto como previsto de entrada.
'@
```

---

## Task 8: Types TS + AuditAction

**Files:**
- Modify: `lib/types.ts` — adicionar tipos.
- Modify: `lib/auth/audit.ts` — adicionar 4 actions.

**Interfaces:**
- Consumes: nada.
- Produces:
  - `FaturamentoOrigemTipo = "job" | "bv" | "avulso"`.
  - `FaturamentoStatus = "emitido" | "cancelado"`.
  - `TituloReceberStatus = "em_aberto" | "pago" | "cancelado"`.
  - Labels: `faturamentoStatusLabel(...)`, `tituloReceberStatusLabel(...)`.
  - Types `Faturamento` e `TituloReceber` refletindo colunas das tabelas.
  - 4 novas actions no union `AuditAction`.

- [ ] **Step 1: Adicionar tipos em `lib/types.ts`**

Achar bloco de types financeiros (próximo a `ContaAvulsaStatus`) e adicionar:

```typescript
// --- Faturamento (contas a receber) ---

export type FaturamentoOrigemTipo = "job" | "bv" | "avulso";
export type FaturamentoStatus = "emitido" | "cancelado";
export type TituloReceberStatus = "em_aberto" | "pago" | "cancelado";

export function faturamentoStatusLabel(s: FaturamentoStatus): string {
  return s === "emitido" ? "Emitido" : "Cancelado";
}

export function tituloReceberStatusLabel(s: TituloReceberStatus): string {
  switch (s) {
    case "em_aberto":
      return "Em aberto";
    case "pago":
      return "Pago";
    case "cancelado":
      return "Cancelado";
  }
}

export interface Faturamento {
  id: string;
  tenant_id: string;
  empresa_id: string;
  origem_tipo: FaturamentoOrigemTipo;
  origem_id: string | null;
  cliente_id: string | null;
  fornecedor_id: string | null;
  numero_nf: string;
  serie: string;
  data_emissao: string;
  valor_total: number;
  descricao: string;
  anexo_nf_path: string;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
  status: FaturamentoStatus;
  cancelado_em: string | null;
  cancelado_por: string | null;
  motivo_cancelamento: string | null;
  emitido_em: string;
  emitido_por: string;
}

export interface TituloReceber {
  id: string;
  tenant_id: string;
  empresa_id: string;
  faturamento_id: string;
  numero_parcela: number;
  valor: number;
  data_vencimento: string;
  status: TituloReceberStatus;
  pago_em: string | null;
  pago_por: string | null;
  conta_bancaria_recebimento_id: string | null;
  lancamento_id: string | null;
  cancelado_em: string | null;
  cancelado_por: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Adicionar audit actions em `lib/auth/audit.ts`**

Achar o union `AuditAction` (foi ampliado no task015 pra incluir `pedido_compra.aprovada` e `pedido_compra.desaprovada`). Adicionar:

```typescript
| "faturamento.emitido"
| "faturamento.cancelado"
| "titulo.baixado"
| "titulo.baixa_estornada"
```

- [ ] **Step 3: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

Nada consome esses types ainda — build tem que passar limpo.

- [ ] **Step 4: Commit**

```powershell
git add lib/types.ts lib/auth/audit.ts
git commit -m @'
cr(008): types e audit actions de contas a receber

Adiciona FaturamentoOrigemTipo/Status, TituloReceberStatus com
labels; interfaces Faturamento e TituloReceber alinhadas ao schema
das Tasks 1-2. 4 novas actions no union AuditAction pra RPCs de
emitir/cancelar/baixar/estornar.
'@
```

---

## Task 9: Server actions `contas-a-receber/actions.ts`

**Files:**
- Create: `app/(app)/financeiro/contas-a-receber/actions.ts`

**Interfaces:**
- Consumes: RPCs das Tasks 4-6, `checarGateFinanceiro` (padrão do projeto), `logAuditEvent`.
- Produces:
  - `emitirFaturamento(input: unknown): Promise<Result & { faturamento_id?: string }>` (payload validado via Zod).
  - `darBaixaTitulo(input): Promise<Result>`.
  - `estornarBaixaTitulo(input): Promise<Result>`.
  - `cancelarFaturamento(input): Promise<Result>`.
  - `uploadNfPdf(formData: FormData): Promise<Result & { path?: string }>` — server action pra upload no bucket antes de chamar `emitirFaturamento`.

- [ ] **Step 1: Criar arquivo**

`app/(app)/financeiro/contas-a-receber/actions.ts`:

```typescript
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Ok<T = Record<string, never>> = { ok: true } & T;
type Err = { ok: false; message: string };
type Result<T = Record<string, never>> = Ok<T> | Err;

async function checarGateFinanceiro(
  entidadeId: string,
  entidadeTipo: string,
  acaoTentada: string,
): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof requireSession>>; supabase: ReturnType<typeof createClient> }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo,
      entidadeId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false, message: "Apenas admin ou financeiro pode executar esta ação." };
  }
  return { ok: true, session, supabase };
}

// ---------------------------------------------------------------------------
// Upload NF PDF
// ---------------------------------------------------------------------------

export async function uploadNfPdf(formData: FormData): Promise<Result<{ path: string }>> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Apenas admin ou financeiro pode fazer upload." };
  }
  const supabase = createClient();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, message: "Arquivo inválido." };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, message: "Arquivo maior que 10 MB." };
  }
  if (file.type !== "application/pdf") {
    return { ok: false, message: "Apenas PDF é aceito." };
  }

  const tempId = crypto.randomUUID();
  const path = `${session.activeTenant.id}/${tempId}/nf.pdf`;

  const { error } = await supabase.storage
    .from("faturamentos-nf")
    .upload(path, file, { contentType: "application/pdf", upsert: false });

  if (error) return { ok: false, message: `Falha no upload: ${error.message}` };

  return { ok: true, path };
}

// ---------------------------------------------------------------------------
// Emitir Faturamento
// ---------------------------------------------------------------------------

const parcelaSchema = z.object({
  numero: z.number().int().min(1),
  valor: z.number().positive(),
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const emitirSchema = z.object({
  empresa_id: z.string().uuid("Selecione a empresa emissora."),
  origem_tipo: z.enum(["job", "bv", "avulso"]),
  origem_id: z.string().uuid().nullable(),
  cliente_id: z.string().uuid().nullable(),
  fornecedor_id: z.string().uuid().nullable(),
  numero_nf: z.string().trim().min(1, "Número da NF obrigatório."),
  serie: z.string().trim().min(1, "Série obrigatória."),
  data_emissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de emissão inválida."),
  valor_total: z.number().positive("Valor total precisa ser positivo."),
  descricao: z.string().trim().min(3, "Descrição obrigatória."),
  anexo_nf_path: z.string().min(1, "Anexe o PDF da NF."),
  plano_conta_tipo_id: z.string().uuid("Selecione o tipo."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo."),
  parcelas: z.array(parcelaSchema).min(1, "Ao menos uma parcela."),
});

export async function emitirFaturamento(
  input: unknown,
): Promise<Result<{ faturamento_id: string }>> {
  const parsed = emitirSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.origem_id ?? "avulso",
    "faturamento",
    "faturamento.emitido",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  // Valida coerência contraparte × origem (defensivo — RPC também valida)
  if (
    parsed.data.origem_tipo === "bv" &&
    (!parsed.data.fornecedor_id || parsed.data.cliente_id)
  ) {
    return { ok: false, message: "BV precisa de fornecedor (e não cliente)." };
  }
  if (
    (parsed.data.origem_tipo === "job" || parsed.data.origem_tipo === "avulso") &&
    (!parsed.data.cliente_id || parsed.data.fornecedor_id)
  ) {
    return { ok: false, message: "Job e avulso precisam de cliente (e não fornecedor)." };
  }

  const { data: fatId, error } = await supabase.rpc("emitir_faturamento", {
    payload: {
      tenant_id: session.activeTenant.id,
      empresa_id: parsed.data.empresa_id,
      origem_tipo: parsed.data.origem_tipo,
      origem_id: parsed.data.origem_id,
      cliente_id: parsed.data.cliente_id,
      fornecedor_id: parsed.data.fornecedor_id,
      numero_nf: parsed.data.numero_nf,
      serie: parsed.data.serie,
      data_emissao: parsed.data.data_emissao,
      valor_total: parsed.data.valor_total,
      descricao: parsed.data.descricao,
      anexo_nf_path: parsed.data.anexo_nf_path,
      plano_conta_tipo_id: parsed.data.plano_conta_tipo_id,
      plano_conta_subtipo_id: parsed.data.plano_conta_subtipo_id,
      emitido_por: session.profile.id,
      parcelas: parsed.data.parcelas,
    },
  });

  if (error) return { ok: false, message: `Falha ao emitir: ${error.message}` };

  await logAuditEvent({
    acao: "faturamento.emitido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "faturamento",
    entidadeId: fatId as string,
    metadata: {
      origem_tipo: parsed.data.origem_tipo,
      origem_id: parsed.data.origem_id,
      numero_nf: parsed.data.numero_nf,
      serie: parsed.data.serie,
      valor_total: parsed.data.valor_total,
      qtd_parcelas: parsed.data.parcelas.length,
    },
  });

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  return { ok: true, faturamento_id: fatId as string };
}

// ---------------------------------------------------------------------------
// Dar baixa em título
// ---------------------------------------------------------------------------

const baixaSchema = z.object({
  titulo_id: z.string().uuid(),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
});

export async function darBaixaTitulo(input: unknown): Promise<Result> {
  const parsed = baixaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.titulo_id,
    "titulo_receber",
    "titulo.baixado",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: lancId, error } = await supabase.rpc("dar_baixa_titulo", {
    p_titulo_id: parsed.data.titulo_id,
    p_pago_em: parsed.data.pago_em,
    p_conta_bancaria_id: parsed.data.conta_bancaria_id,
    p_criado_por: session.profile.id,
  });

  if (error) return { ok: false, message: `Falha ao dar baixa: ${error.message}` };

  await logAuditEvent({
    acao: "titulo.baixado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "titulo_receber",
    entidadeId: parsed.data.titulo_id,
    metadata: {
      pago_em: parsed.data.pago_em,
      conta_bancaria_id: parsed.data.conta_bancaria_id,
      lancamento_id: lancId,
    },
  });

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Estornar baixa
// ---------------------------------------------------------------------------

const estornoSchema = z.object({
  titulo_id: z.string().uuid(),
  motivo: z.string().trim().min(10, "Motivo precisa ter ao menos 10 caracteres."),
});

export async function estornarBaixaTitulo(input: unknown): Promise<Result> {
  const parsed = estornoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.titulo_id,
    "titulo_receber",
    "titulo.baixa_estornada",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: reversoId, error } = await supabase.rpc("estornar_baixa_titulo", {
    p_titulo_id: parsed.data.titulo_id,
    p_motivo: parsed.data.motivo,
    p_criado_por: session.profile.id,
  });

  if (error) return { ok: false, message: `Falha ao estornar: ${error.message}` };

  await logAuditEvent({
    acao: "titulo.baixa_estornada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "titulo_receber",
    entidadeId: parsed.data.titulo_id,
    metadata: {
      motivo: parsed.data.motivo,
      lancamento_reverso_id: reversoId,
    },
  });

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cancelar Faturamento
// ---------------------------------------------------------------------------

const cancelarSchema = z.object({
  faturamento_id: z.string().uuid(),
  motivo: z.string().trim().min(10, "Motivo precisa ter ao menos 10 caracteres."),
});

export async function cancelarFaturamento(input: unknown): Promise<Result> {
  const parsed = cancelarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.faturamento_id,
    "faturamento",
    "faturamento.cancelado",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { error } = await supabase.rpc("cancelar_faturamento", {
    p_faturamento_id: parsed.data.faturamento_id,
    p_motivo: parsed.data.motivo,
    p_cancelado_por: session.profile.id,
  });

  if (error) return { ok: false, message: `Falha ao cancelar: ${error.message}` };

  await logAuditEvent({
    acao: "faturamento.cancelado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "faturamento",
    entidadeId: parsed.data.faturamento_id,
    metadata: { motivo: parsed.data.motivo },
  });

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  return { ok: true };
}
```

- [ ] **Step 2: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

Build precisa passar — as actions são consumidas pelas próximas tasks.

- [ ] **Step 3: Commit**

```powershell
git add app/(app)/financeiro/contas-a-receber/actions.ts
git commit -m @'
cr(009): server actions de contas a receber

emitirFaturamento (chama RPC com payload jsonb), darBaixaTitulo,
estornarBaixaTitulo, cancelarFaturamento, uploadNfPdf (Storage
faturamentos-nf, PDF ate 10MB). Cada uma: gate financeiro, chamada
RPC, auditEvent, revalidatePath dos paths afetados.
'@
```

---

## Task 10: UI aba Faturamento (page + tabs + list + drawer)

**Files:**
- Create: `app/(app)/financeiro/contas-a-receber/page.tsx`
- Create: `app/(app)/financeiro/contas-a-receber/tabs.tsx`
- Create: `app/(app)/financeiro/contas-a-receber/faturamento-list.tsx`
- Create: `app/(app)/financeiro/contas-a-receber/faturar-drawer.tsx`

**Interfaces:**
- Consumes: `vw_faturamento_pendente`, `titulos_receber` + `faturamentos` (para aba A Receber que fica pronta em Task 11 — nesta task passamos placeholder), `emitirFaturamento` + `uploadNfPdf` da Task 9.
- Produces: rota `/financeiro/contas-a-receber` funcional com aba Faturamento operacional. Aba A Receber renderiza placeholder "em construção" (será substituído em Task 11).

- [ ] **Step 1: Criar `page.tsx` (server component)**

```tsx
import { redirect } from "next/navigation";
import { ChevronRight, Receipt } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ContasReceberTabs } from "./tabs";
import { FaturamentoList, type FaturamentoPendenteRow } from "./faturamento-list";
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ContasReceberPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const [
    pendentesRes,
    contasRes,
    tiposRes,
    subtiposRes,
    empresasRes,
    clientesRes,
    fornecedoresRes,
  ] = await Promise.all([
    supabase
      .from("vw_faturamento_pendente")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("data_prevista", { ascending: true, nullsFirst: false }),
    supabase
      .from("contas_bancarias")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .returns<ContaBancaria[]>(),
    supabase
      .from("plano_contas_tipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("ordem")
      .returns<PlanoContaTipo[]>(),
    supabase
      .from("plano_contas_subtipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome")
      .returns<PlanoContaSubtipo[]>(),
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("razao_social"),
    supabase
      .from("clientes")
      .select("id, nome_fantasia, razao_social")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    supabase
      .from("fornecedores")
      .select("id, nome, razao_social")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome"),
  ]);

  if (pendentesRes.error) {
    console.error("[cr.pendentes]", pendentesRes.error.message);
  }

  const pendentes: FaturamentoPendenteRow[] = (pendentesRes.data ?? []).map((r) => ({
    origem_tipo: r.origem_tipo as FaturamentoPendenteRow["origem_tipo"],
    origem_id: r.origem_id as string,
    empresa_id: (r.empresa_id as string | null) ?? "",
    codigo: (r.codigo as string | null) ?? null,
    descricao: r.descricao as string,
    cliente_id: (r.cliente_id as string | null) ?? null,
    fornecedor_id: (r.fornecedor_id as string | null) ?? null,
    valor_previsto: Number(r.valor_previsto),
    valor_ja_faturado: Number(r.valor_ja_faturado),
    saldo: Number(r.saldo),
    data_prevista: (r.data_prevista as string | null) ?? null,
  }));

  const empresasList = (empresasRes.data ?? []).map(
    (e: { id: string; razao_social: string | null; nome_fantasia: string | null }) => ({
      id: e.id,
      nome: e.razao_social ?? e.nome_fantasia ?? "",
    }),
  );
  const clientesList = (clientesRes.data ?? []).map(
    (c: { id: string; nome_fantasia: string | null; razao_social: string | null }) => ({
      id: c.id,
      nome: c.razao_social ?? c.nome_fantasia ?? "",
    }),
  );
  const fornecedoresList = (fornecedoresRes.data ?? []).map(
    (f: { id: string; nome: string; razao_social: string | null }) => ({
      id: f.id,
      nome: f.razao_social ?? f.nome,
    }),
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/financeiro" className="hover:text-california-red transition-colors">
            Financeiro
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">Contas a Receber</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Receipt className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Contas a Receber</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Emita NFs a partir de jobs abertos, BVs confirmados ou avulsos. Depois
          acompanhe os títulos até o recebimento.
        </p>
      </header>

      <ContasReceberTabs
        faturamento={
          <FaturamentoList
            pendentes={pendentes}
            contas={contasRes.data ?? []}
            tipos={tiposRes.data ?? []}
            subtipos={subtiposRes.data ?? []}
            empresas={empresasList}
            clientes={clientesList}
            fornecedores={fornecedoresList}
          />
        }
        faturamentoCount={pendentes.length}
        titulos={<div className="p-12 text-center text-muted-foreground text-sm">Em construção (Task 11).</div>}
        titulosCount={0}
      />
    </div>
  );
}
```

- [ ] **Step 2: Criar `tabs.tsx`**

```tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface Props {
  faturamento: React.ReactNode;
  faturamentoCount: number;
  titulos: React.ReactNode;
  titulosCount: number;
}

type TabKey = "faturamento" | "titulos";

export function ContasReceberTabs({
  faturamento,
  faturamentoCount,
  titulos,
  titulosCount,
}: Props) {
  const [tab, setTab] = React.useState<TabKey>("faturamento");
  return (
    <div className="space-y-6">
      <div role="tablist" className="flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "faturamento"} onClick={() => setTab("faturamento")}>
          Faturamento
          {faturamentoCount > 0 && (
            <span className="ml-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">
              {faturamentoCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "titulos"} onClick={() => setTab("titulos")}>
          A Receber
          {titulosCount > 0 && (
            <span className="ml-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">
              {titulosCount}
            </span>
          )}
        </TabButton>
      </div>

      <div role="tabpanel" className={cn(tab === "faturamento" ? "" : "hidden")}>
        {faturamento}
      </div>
      <div role="tabpanel" className={cn(tab === "titulos" ? "" : "hidden")}>
        {titulos}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors",
        active
          ? "border-california-red text-california-red"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 3: Criar `faturamento-list.tsx`**

```tsx
"use client";

import * as React from "react";
import { Plus, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import { FaturarDrawer } from "./faturar-drawer";

export type FaturamentoPendenteRow = {
  origem_tipo: "job" | "bv";
  origem_id: string;
  empresa_id: string;
  codigo: string | null;
  descricao: string;
  cliente_id: string | null;
  fornecedor_id: string | null;
  valor_previsto: number;
  valor_ja_faturado: number;
  saldo: number;
  data_prevista: string | null;
};

const CHIP_ORIGEM: Record<FaturamentoPendenteRow["origem_tipo"] | "avulso", string> = {
  job: "Job",
  bv: "BV",
  avulso: "Avulso",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

interface Props {
  pendentes: FaturamentoPendenteRow[];
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  empresas: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
}

export function FaturamentoList({
  pendentes,
  contas,
  tipos,
  subtipos,
  empresas,
  clientes,
  fornecedores,
}: Props) {
  const [drawerState, setDrawerState] = React.useState<
    | { modo: "origem"; row: FaturamentoPendenteRow }
    | { modo: "avulso" }
    | null
  >(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDrawerState({ modo: "avulso" })}>
          <Plus className="mr-1 h-4 w-4" />
          Novo Faturamento avulso
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Origem</th>
              <th className="p-3 text-left">Descrição</th>
              <th className="p-3 text-left">Contraparte</th>
              <th className="p-3 text-right">Previsto</th>
              <th className="p-3 text-right">Já faturado</th>
              <th className="p-3 text-right">Saldo</th>
              <th className="p-3 text-left">Data prevista</th>
              <th className="p-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {pendentes.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted-foreground">
                  Nada aguardando faturamento no momento.
                </td>
              </tr>
            )}
            {pendentes.map((r) => {
              const contraparte =
                r.origem_tipo === "bv"
                  ? fornecedores.find((f) => f.id === r.fornecedor_id)?.nome ?? "—"
                  : clientes.find((c) => c.id === r.cliente_id)?.nome ?? "—";
              return (
                <tr
                  key={`${r.origem_tipo}:${r.origem_id}`}
                  className="border-t border-border hover:bg-muted/40 transition-colors"
                >
                  <td className="p-3">
                    <Badge variant="neutral">{CHIP_ORIGEM[r.origem_tipo]}</Badge>
                  </td>
                  <td className="p-3 max-w-xs truncate" title={r.descricao}>
                    {r.codigo && <span className="font-mono text-xs mr-1">{r.codigo}</span>}
                    {r.descricao}
                  </td>
                  <td className="p-3">{contraparte}</td>
                  <td className="p-3 text-right font-mono">{formatCurrency(r.valor_previsto, "BRL")}</td>
                  <td className="p-3 text-right font-mono text-muted-foreground">
                    {formatCurrency(r.valor_ja_faturado, "BRL")}
                  </td>
                  <td className="p-3 text-right font-mono font-semibold">
                    {formatCurrency(r.saldo, "BRL")}
                  </td>
                  <td className="p-3">{formatDate(r.data_prevista)}</td>
                  <td className="p-3 text-right">
                    <Button
                      size="sm"
                      onClick={() => setDrawerState({ modo: "origem", row: r })}
                    >
                      <FileText className="mr-1 h-3 w-3" />
                      Faturar
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {drawerState && (
        <FaturarDrawer
          state={drawerState}
          onClose={() => setDrawerState(null)}
          contas={contas}
          tipos={tipos}
          subtipos={subtipos}
          empresas={empresas}
          clientes={clientes}
          fornecedores={fornecedores}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Criar `faturar-drawer.tsx`**

Componente longo. Estrutura:

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { format, addDays } from "date-fns";
import { FileText, Trash2, Plus, AlertTriangle, X } from "lucide-react";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import { emitirFaturamento, uploadNfPdf } from "./actions";
import type { FaturamentoPendenteRow } from "./faturamento-list";

type State =
  | { modo: "origem"; row: FaturamentoPendenteRow }
  | { modo: "avulso" };

interface Props {
  state: State;
  onClose: () => void;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  empresas: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
}

type Parcela = { numero: number; valor: string; data_vencimento: string };

export function FaturarDrawer({
  state,
  onClose,
  contas,
  tipos,
  subtipos,
  empresas,
  clientes,
  fornecedores,
}: Props) {
  const router = useRouter();
  const isAvulso = state.modo === "avulso";
  const row = state.modo === "origem" ? state.row : null;
  const saldoSugerido = row?.saldo ?? 0;
  const descricaoInicial = row?.descricao ?? "";
  const empresaInicial = row?.empresa_id ?? "";
  const clienteInicial = row?.cliente_id ?? "";
  const fornecedorInicial = row?.fornecedor_id ?? "";
  const origemTipo: "job" | "bv" | "avulso" = row
    ? row.origem_tipo
    : "avulso";

  const [pending, startTransition] = React.useTransition();
  const [uploading, setUploading] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [anexoPath, setAnexoPath] = React.useState<string | null>(null);
  const [anexoNome, setAnexoNome] = React.useState<string | null>(null);

  const [empresaId, setEmpresaId] = React.useState(empresaInicial);
  const [clienteId, setClienteId] = React.useState(clienteInicial);
  const [fornecedorId, setFornecedorId] = React.useState(fornecedorInicial);
  const [descricao, setDescricao] = React.useState(descricaoInicial);
  const [numeroNf, setNumeroNf] = React.useState("");
  const [serie, setSerie] = React.useState("1");
  const [dataEmissao, setDataEmissao] = React.useState(format(new Date(), "yyyy-MM-dd"));
  const [valorTotal, setValorTotal] = React.useState(saldoSugerido > 0 ? saldoSugerido.toFixed(2) : "");
  const [tipoId, setTipoId] = React.useState("");
  const [subtipoId, setSubtipoId] = React.useState("");
  const [parcelas, setParcelas] = React.useState<Parcela[]>([
    {
      numero: 1,
      valor: saldoSugerido > 0 ? saldoSugerido.toFixed(2) : "",
      data_vencimento: format(addDays(new Date(), 30), "yyyy-MM-dd"),
    },
  ]);

  React.useEffect(() => {
    setSubtipoId("");
  }, [tipoId]);

  const subtiposDoTipo = React.useMemo(
    () => (tipoId ? subtipos.filter((s) => s.tipo_id === tipoId && s.ativo) : []),
    [tipoId, subtipos],
  );
  const tiposAtivos = React.useMemo(() => tipos.filter((t) => t.ativo), [tipos]);

  const valorTotalNum = Number(valorTotal) || 0;
  const somaParcelas = parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const somaOk = Math.abs(somaParcelas - valorTotalNum) < 0.01;
  const divergePrevisto = row ? Math.abs(valorTotalNum - saldoSugerido) > 0.01 : false;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadNfPdf(fd);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setAnexoPath(res.path);
      setAnexoNome(file.name);
    } finally {
      setUploading(false);
    }
  }

  function aplicarParcelamentoPadrao(n: number) {
    if (!valorTotalNum) return;
    const valorPorParcela = valorTotalNum / n;
    const novas: Parcela[] = Array.from({ length: n }, (_, i) => ({
      numero: i + 1,
      valor: valorPorParcela.toFixed(2),
      data_vencimento: format(addDays(new Date(), 30 * (i + 1)), "yyyy-MM-dd"),
    }));
    // Ajusta última parcela pra bater o total exato
    const somaEfetiva = novas.reduce((s, p) => s + Number(p.valor), 0);
    const diff = valorTotalNum - somaEfetiva;
    if (Math.abs(diff) > 0.001) {
      novas[novas.length - 1].valor = (Number(novas[novas.length - 1].valor) + diff).toFixed(2);
    }
    setParcelas(novas);
  }

  function addParcela() {
    setParcelas((p) => [
      ...p,
      {
        numero: p.length + 1,
        valor: "",
        data_vencimento: format(addDays(new Date(), 30 * (p.length + 1)), "yyyy-MM-dd"),
      },
    ]);
  }

  function removerParcela(i: number) {
    setParcelas((p) => p.filter((_, idx) => idx !== i).map((pp, idx) => ({ ...pp, numero: idx + 1 })));
  }

  function updateParcela(i: number, campo: keyof Parcela, valor: string) {
    setParcelas((p) => p.map((pp, idx) => (idx === i ? { ...pp, [campo]: valor } : pp)));
  }

  function handleConfirm() {
    setErro(null);
    if (!anexoPath) {
      setErro("Anexe o PDF da NF antes de emitir.");
      return;
    }
    if (!somaOk) {
      setErro(`Soma das parcelas (${formatCurrency(somaParcelas, "BRL")}) não bate com valor total (${formatCurrency(valorTotalNum, "BRL")}).`);
      return;
    }

    startTransition(async () => {
      const payload = {
        empresa_id: empresaId,
        origem_tipo: origemTipo,
        origem_id: row?.origem_id ?? null,
        cliente_id: origemTipo === "bv" ? null : clienteId || null,
        fornecedor_id: origemTipo === "bv" ? fornecedorId || null : null,
        numero_nf: numeroNf,
        serie,
        data_emissao: dataEmissao,
        valor_total: valorTotalNum,
        descricao,
        anexo_nf_path: anexoPath,
        plano_conta_tipo_id: tipoId,
        plano_conta_subtipo_id: subtipoId,
        parcelas: parcelas.map((p) => ({
          numero: p.numero,
          valor: Number(p.valor),
          data_vencimento: p.data_vencimento,
        })),
      };
      const res = await emitirFaturamento(payload);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const tipoContraparte = origemTipo === "bv" ? "Fornecedor" : "Cliente";
  const podeEditarContraparte = isAvulso;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-california-red" />
            {isAvulso ? "Novo Faturamento avulso" : `Faturar — ${row?.codigo ?? row?.descricao}`}
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

          {divergePrevisto && (
            <div className="flex items-start gap-2 rounded border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Valor total (R$ {valorTotal}) diverge do saldo previsto (R$ {saldoSugerido.toFixed(2)}). Confirme se está correto.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Empresa emissora *</label>
              <Select value={empresaId} onValueChange={setEmpresaId} disabled={!isAvulso && origemTipo === "job"}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">{tipoContraparte} *</label>
              {origemTipo === "bv" ? (
                <Select value={fornecedorId} onValueChange={setFornecedorId} disabled={!podeEditarContraparte}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {fornecedores.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={clienteId} onValueChange={setClienteId} disabled={!podeEditarContraparte}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {clientes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Descrição *</label>
            <input
              type="text"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={200}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
            />
          </div>

          <div className="rounded-lg border border-dashed border-border p-3">
            <label className="text-xs font-medium">Anexo NF (PDF) *</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFile}
              disabled={uploading}
              className="mt-1 block w-full text-xs"
            />
            {uploading && <p className="mt-1 text-xs text-muted-foreground">Enviando...</p>}
            {anexoNome && (
              <p className="mt-1 text-xs text-emerald-700">{anexoNome} enviado.</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Nº NF *</label>
              <input
                type="text"
                value={numeroNf}
                onChange={(e) => setNumeroNf(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Série *</label>
              <input
                type="text"
                value={serie}
                onChange={(e) => setSerie(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Emissão *</label>
              <DatePicker
                name="data_emissao"
                defaultValue={dataEmissao}
                onDateChange={(d) => setDataEmissao(d ? format(d, "yyyy-MM-dd") : "")}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Valor total *</label>
              <input
                type="number"
                step="0.01"
                value={valorTotal}
                onChange={(e) => setValorTotal(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Tipo *</label>
              <Select value={tipoId} onValueChange={setTipoId}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {tiposAtivos.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.codigo} · {t.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Subtipo *</label>
              <Select value={subtipoId} onValueChange={setSubtipoId} disabled={!tipoId}>
                <SelectTrigger><SelectValue placeholder={tipoId ? "Selecione..." : "Escolha o tipo"} /></SelectTrigger>
                <SelectContent>
                  {subtiposDoTipo.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Parcelas</label>
              <div className="flex gap-1">
                <button type="button" onClick={() => aplicarParcelamentoPadrao(2)} className="rounded border border-border px-2 py-1 text-[10px]">2×</button>
                <button type="button" onClick={() => aplicarParcelamentoPadrao(3)} className="rounded border border-border px-2 py-1 text-[10px]">3×</button>
                <button type="button" onClick={() => aplicarParcelamentoPadrao(6)} className="rounded border border-border px-2 py-1 text-[10px]">6×</button>
              </div>
            </div>
            {parcelas.map((p, i) => (
              <div key={i} className="grid grid-cols-[40px_1fr_1fr_40px] items-center gap-2">
                <span className="text-xs text-muted-foreground">{p.numero}</span>
                <input
                  type="number"
                  step="0.01"
                  value={p.valor}
                  onChange={(e) => updateParcela(i, "valor", e.target.value)}
                  placeholder="Valor"
                  className="rounded border border-border px-2 py-1 text-sm font-mono"
                />
                <DatePicker
                  name={`venc-${i}`}
                  defaultValue={p.data_vencimento}
                  onDateChange={(d) => updateParcela(i, "data_vencimento", d ? format(d, "yyyy-MM-dd") : "")}
                />
                <button
                  type="button"
                  onClick={() => removerParcela(i)}
                  disabled={parcelas.length === 1}
                  className="text-muted-foreground hover:text-california-red disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addParcela}
              className="inline-flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-xs"
            >
              <Plus className="h-3 w-3" /> Nova parcela
            </button>
            <p className={`text-xs ${somaOk ? "text-emerald-700" : "text-california-red"}`}>
              Soma: {formatCurrency(somaParcelas, "BRL")} / Total: {formatCurrency(valorTotalNum, "BRL")}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending || uploading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
          >
            <FileText className="h-4 w-4" />
            {pending ? "Emitindo..." : "Emitir NF"}
          </button>
        </div>
      </DrawerContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

Verificar que rota `/financeiro/contas-a-receber` aparece na lista de routes do build.

- [ ] **Step 6: Smoke manual** (opcional se dev disponível)

```powershell
npm run dev
```

Abrir `/financeiro/contas-a-receber` — deve carregar sem erro, mostrar aba Faturamento (empty ou com itens da view) + placeholder "em construção" na aba A Receber.

- [ ] **Step 7: Commit**

```powershell
git add app/(app)/financeiro/contas-a-receber/page.tsx app/(app)/financeiro/contas-a-receber/tabs.tsx app/(app)/financeiro/contas-a-receber/faturamento-list.tsx app/(app)/financeiro/contas-a-receber/faturar-drawer.tsx
git commit -m @'
cr(010): UI rota /financeiro/contas-a-receber com aba Faturamento

Page server component lendo vw_faturamento_pendente + listas de
apoio via Promise.all. Tabs (Faturamento | A Receber) com contadores.
FaturamentoList mostra fila (Job/BV/Avulso) com previsto/faturado/
saldo + botao Faturar por linha + botao "Novo Faturamento avulso".
FaturarDrawer com upload NF, campos NF, editor de parcelas (com
presets 2x/3x/6x), aviso amarelo quando valor diverge do previsto,
valida soma das parcelas antes de submeter.

Aba A Receber vem em Task 11 — placeholder no lugar.
'@
```

---

## Task 11: UI aba A Receber (titulos-list + baixa + cancelar-faturamento-modal)

**Files:**
- Create: `app/(app)/financeiro/contas-a-receber/titulos-list.tsx`
- Create: `app/(app)/financeiro/contas-a-receber/cancelar-faturamento-modal.tsx`
- Modify: `app/(app)/financeiro/contas-a-receber/page.tsx` — adicionar query de títulos e passar pra tab.

**Interfaces:**
- Consumes: `darBaixaTitulo`, `estornarBaixaTitulo`, `cancelarFaturamento` (Task 9), `BaixaAvulsaDialog` compartilhado.
- Produces: aba A Receber operacional; chips filtro por status; ações por linha (dar baixa, estornar, cancelar NF pai).

- [ ] **Step 1: Modificar `page.tsx` — adicionar query de títulos**

Adicionar ao `Promise.all` do `page.tsx` (após as queries existentes):

```typescript
supabase
  .from("titulos_receber")
  .select(`
    id, numero_parcela, valor, data_vencimento, status,
    pago_em, empresa_id, faturamento_id,
    faturamento:faturamentos!inner(
      id, numero_nf, serie, data_emissao, descricao, status,
      origem_tipo, origem_id,
      cliente:clientes(id, nome_fantasia, razao_social),
      fornecedor:fornecedores(id, nome, razao_social)
    )
  `)
  .eq("tenant_id", session.activeTenant.id)
  .order("data_vencimento", { ascending: true }),
```

Mapear pra type `TituloRow` (definido no `titulos-list.tsx`) e passar como prop `<TitulosList rows={titulosRows} ... />` no lugar do placeholder.

- [ ] **Step 2: Criar `titulos-list.tsx`**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw, Ban } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BaixaAvulsaDialog } from "@/components/financeiro/baixa-avulsa-dialog";
import type { ContaBancaria, TituloReceberStatus } from "@/lib/types";
import { tituloReceberStatusLabel } from "@/lib/types";
import {
  darBaixaTitulo,
  estornarBaixaTitulo,
  cancelarFaturamento,
} from "./actions";
import { CancelarFaturamentoModal } from "./cancelar-faturamento-modal";

export interface TituloRow {
  id: string;
  numero_parcela: number;
  valor: number;
  data_vencimento: string;
  status: TituloReceberStatus;
  pago_em: string | null;
  empresa_id: string;
  faturamento_id: string;
  fat_numero_nf: string;
  fat_serie: string;
  fat_descricao: string;
  fat_status: "emitido" | "cancelado";
  contraparte_nome: string;
}

interface Props {
  rows: TituloRow[];
  contas: ContaBancaria[];
}

type Filtro = "em_aberto" | "pago" | "inadimplente" | "todos";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function TitulosList({ rows, contas }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [filtro, setFiltro] = React.useState<Filtro>("em_aberto");
  const [erro, setErro] = React.useState<string | null>(null);
  const [baixando, setBaixando] = React.useState<TituloRow | null>(null);
  const [estornando, setEstornando] = React.useState<TituloRow | null>(null);
  const [motivoEstorno, setMotivoEstorno] = React.useState("");
  const [cancelandoFat, setCancelandoFat] = React.useState<TituloRow | null>(null);

  const hoje = new Date().toISOString().slice(0, 10);

  function isInadimplente(r: TituloRow): boolean {
    return r.status === "em_aberto" && r.data_vencimento < hoje;
  }

  const contagens = React.useMemo(() => {
    let em_aberto = 0, pago = 0, inadimplente = 0;
    for (const r of rows) {
      if (r.status === "pago") pago++;
      else if (r.status === "em_aberto") {
        em_aberto++;
        if (isInadimplente(r)) inadimplente++;
      }
    }
    return { em_aberto, pago, inadimplente, todos: rows.length };
  }, [rows, hoje]);

  const filtrados = React.useMemo(() => {
    if (filtro === "todos") return rows;
    if (filtro === "inadimplente") return rows.filter(isInadimplente);
    return rows.filter((r) => r.status === filtro);
  }, [rows, filtro, hoje]);

  function badgeStatus(r: TituloRow) {
    if (r.status === "cancelado")
      return { label: "Cancelado", cls: "bg-slate-100 text-slate-500 border-slate-200" };
    if (r.status === "pago")
      return { label: "Pago", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    if (isInadimplente(r))
      return { label: "Inadimplente", cls: "bg-red-50 text-red-700 border-red-200" };
    return { label: "Em aberto", cls: "bg-yellow-50 text-yellow-800 border-yellow-200" };
  }

  return (
    <div className="space-y-4">
      {erro && (
        <div className="rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
          {erro}
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {(["em_aberto","pago","inadimplente","todos"] as Filtro[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filtro === f
                ? "border-california-red bg-california-red/10 text-california-red"
                : "border-border bg-white text-muted-foreground hover:bg-muted/50",
            )}
          >
            {f === "em_aberto" ? "Em aberto" : f === "pago" ? "Pagos" : f === "inadimplente" ? "Inadimplentes" : "Todos"}
            <span className="tabular-nums opacity-70">{contagens[f]}</span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Contraparte</th>
              <th className="p-3 text-left">NF</th>
              <th className="p-3 text-left">Parcela</th>
              <th className="p-3 text-left">Vencimento</th>
              <th className="p-3 text-right">Valor</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  Nenhum título nesta situação.
                </td>
              </tr>
            )}
            {filtrados.map((r) => {
              const b = badgeStatus(r);
              return (
                <tr key={r.id} className="border-t border-border hover:bg-muted/40">
                  <td className="p-3">{r.contraparte_nome}</td>
                  <td className="p-3 font-mono text-xs">
                    {r.fat_numero_nf}/{r.fat_serie}
                  </td>
                  <td className="p-3">{r.numero_parcela}</td>
                  <td className={cn("p-3", isInadimplente(r) && "text-california-red font-medium")}>
                    {formatDate(r.data_vencimento)}
                  </td>
                  <td className="p-3 text-right font-mono">{formatCurrency(r.valor, "BRL")}</td>
                  <td className="p-3">
                    <Badge className={cn("border", b.cls)}>{b.label}</Badge>
                  </td>
                  <td className="p-3 text-right">
                    {r.status === "em_aberto" && r.fat_status === "emitido" && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setBaixando(r)}
                          disabled={pending}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Baixar
                        </button>
                        <button
                          type="button"
                          onClick={() => setCancelandoFat(r)}
                          disabled={pending}
                          title="Cancelar NF"
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-california-red hover:text-california-red disabled:opacity-50"
                        >
                          <Ban className="h-3 w-3" />
                          Cancelar NF
                        </button>
                      </div>
                    )}
                    {r.status === "pago" && (
                      <button
                        type="button"
                        onClick={() => { setEstornando(r); setMotivoEstorno(""); }}
                        disabled={pending}
                        className="inline-flex items-center gap-1 rounded-md border border-california-red/30 px-2 py-1 text-[11px] text-california-red hover:bg-california-red hover:text-white disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Estornar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {baixando && (
        <BaixaAvulsaDialog
          open
          onOpenChange={(o) => { if (!o) setBaixando(null); }}
          descricao={`NF ${baixando.fat_numero_nf}/${baixando.fat_serie} — parcela ${baixando.numero_parcela}`}
          valor={baixando.valor}
          empresaId={baixando.empresa_id}
          dataPrevista={baixando.data_vencimento}
          contas={contas}
          tipoLabel="Título"
          pending={pending}
          onConfirm={(payload) => {
            const alvo = baixando;
            if (!alvo) return;
            startTransition(async () => {
              const res = await darBaixaTitulo({
                titulo_id: alvo.id,
                pago_em: payload.pago_em,
                conta_bancaria_id: payload.conta_bancaria_id,
              });
              if (!res.ok) {
                setErro(res.message);
              } else {
                setBaixando(null);
                router.refresh();
              }
            });
          }}
        />
      )}

      <ConfirmDialog
        open={estornando !== null}
        onOpenChange={(o) => { if (!o) { setEstornando(null); setMotivoEstorno(""); } }}
        title={estornando ? `Estornar baixa da parcela ${estornando.numero_parcela}?` : ""}
        description={
          <div className="space-y-2">
            <p>Vai criar um lançamento reverso e o título volta pra em aberto.</p>
            <div>
              <label className="text-xs font-medium">Motivo * (mín. 10 caracteres)</label>
              <textarea
                value={motivoEstorno}
                onChange={(e) => setMotivoEstorno(e.target.value)}
                maxLength={500}
                rows={3}
                className="mt-1 w-full rounded border border-border p-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {motivoEstorno.trim().length}/500 caracteres
              </p>
            </div>
          </div>
        }
        confirmLabel="Confirmar estorno"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={() => {
          const alvo = estornando;
          if (!alvo) return;
          startTransition(async () => {
            const res = await estornarBaixaTitulo({ titulo_id: alvo.id, motivo: motivoEstorno });
            if (!res.ok) {
              setErro(res.message);
            } else {
              setEstornando(null);
              setMotivoEstorno("");
              router.refresh();
            }
          });
        }}
      />

      {cancelandoFat && (
        <CancelarFaturamentoModal
          faturamentoId={cancelandoFat.faturamento_id}
          numeroNf={cancelandoFat.fat_numero_nf}
          onClose={() => setCancelandoFat(null)}
          onDone={() => {
            setCancelandoFat(null);
            router.refresh();
          }}
          onErr={(msg) => setErro(msg)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Criar `cancelar-faturamento-modal.tsx`**

```tsx
"use client";

import * as React from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cancelarFaturamento } from "./actions";

interface Props {
  faturamentoId: string;
  numeroNf: string;
  onClose: () => void;
  onDone: () => void;
  onErr: (msg: string) => void;
}

export function CancelarFaturamentoModal({ faturamentoId, numeroNf, onClose, onDone, onErr }: Props) {
  const [motivo, setMotivo] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`Cancelar NF ${numeroNf}?`}
      description={
        <div className="space-y-2">
          <p>
            Todos os títulos em aberto desta NF serão cancelados. Se algum
            título já foi baixado, o cancelamento é bloqueado (estorne primeiro).
          </p>
          <div>
            <label className="text-xs font-medium">Motivo * (mín. 10 caracteres)</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              rows={3}
              className="mt-1 w-full rounded border border-border p-2 text-sm"
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
      onConfirm={() => {
        startTransition(async () => {
          const res = await cancelarFaturamento({ faturamento_id: faturamentoId, motivo });
          if (!res.ok) {
            onErr(res.message);
            return;
          }
          onDone();
        });
      }}
    />
  );
}
```

- [ ] **Step 4: Ajustar `page.tsx` — mapear títulos e passar pra tabs**

Após o `Promise.all`, adicionar:

```typescript
const titulosRows: TituloRow[] = ((titulosRes.data ?? []) as unknown as Array<{
  id: string;
  numero_parcela: number;
  valor: string | number;
  data_vencimento: string;
  status: TituloReceberStatus;
  pago_em: string | null;
  empresa_id: string;
  faturamento_id: string;
  faturamento: {
    id: string;
    numero_nf: string;
    serie: string;
    descricao: string;
    status: "emitido" | "cancelado";
    origem_tipo: "job" | "bv" | "avulso";
    cliente: { nome_fantasia: string | null; razao_social: string | null } | null;
    fornecedor: { nome: string | null; razao_social: string | null } | null;
  };
}>).map((r) => ({
  id: r.id,
  numero_parcela: r.numero_parcela,
  valor: Number(r.valor),
  data_vencimento: r.data_vencimento,
  status: r.status,
  pago_em: r.pago_em,
  empresa_id: r.empresa_id,
  faturamento_id: r.faturamento_id,
  fat_numero_nf: r.faturamento.numero_nf,
  fat_serie: r.faturamento.serie,
  fat_descricao: r.faturamento.descricao,
  fat_status: r.faturamento.status,
  contraparte_nome:
    r.faturamento.fornecedor?.razao_social ??
    r.faturamento.fornecedor?.nome ??
    r.faturamento.cliente?.razao_social ??
    r.faturamento.cliente?.nome_fantasia ??
    "—",
}));
```

Substituir o placeholder da aba A Receber por:

```tsx
titulos={<TitulosList rows={titulosRows} contas={contasRes.data ?? []} />}
titulosCount={titulosRows.filter((t) => t.status === "em_aberto").length}
```

Adicionar imports:
```typescript
import { TitulosList, type TituloRow } from "./titulos-list";
import type { TituloReceberStatus } from "@/lib/types";
```

- [ ] **Step 5: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

- [ ] **Step 6: Commit**

```powershell
git add app/(app)/financeiro/contas-a-receber/titulos-list.tsx app/(app)/financeiro/contas-a-receber/cancelar-faturamento-modal.tsx app/(app)/financeiro/contas-a-receber/page.tsx
git commit -m @'
cr(011): aba A Receber com baixa, estorno e cancelar NF

TitulosList mostra parcelas de todas NFs com chips de filtro
(em aberto/pagos/inadimplentes/todos, com contagens). Inadimplente
e calculado no cliente (vencimento < hoje && em_aberto).

Baixa reusa BaixaAvulsaDialog compartilhado (task015). Estorno abre
ConfirmDialog pedindo motivo. Cancelar NF por linha abre modal
proprio (a RPC bloqueia se algum titulo ja foi pago).

page.tsx ganha query dos titulos com join no faturamento e nas
contrapartes; contador da aba mostra titulos em_aberto.
'@
```

---

## Task 12: Landing `/financeiro` — card "Contas a Receber"

**Files:**
- Modify: `app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consumes: `vw_faturamento_pendente` (contagem) + `titulos_receber` (contagem de inadimplentes).
- Produces: 5º card "Contas a Receber" na landing com contagens duplas ("a faturar | inadimplentes").

- [ ] **Step 1: Adicionar queries no Promise.all**

Ler `app/(app)/financeiro/page.tsx` (foi atualizado na consolidação para ter 4 cards). Adicionar duas queries no `Promise.all`:

```typescript
supabase
  .from("vw_faturamento_pendente")
  .select("origem_id", { count: "exact", head: true })
  .eq("tenant_id", session.activeTenant.id),
supabase
  .from("titulos_receber")
  .select("id", { count: "exact", head: true })
  .eq("tenant_id", session.activeTenant.id)
  .eq("status", "em_aberto")
  .lt("data_vencimento", new Date().toISOString().slice(0, 10)),
```

Guardar em `aFaturarRes` e `inadimplentesRes`.

- [ ] **Step 2: Adicionar 5º card**

Após os 4 cards existentes, antes do `{/* Cards futuros ... */}`:

```tsx
<FinanceiroCard
  href="/financeiro/contas-a-receber"
  icon={Receipt}
  title="Contas a Receber"
  description="Emitir NF a partir de jobs e BVs, acompanhar títulos até o recebimento."
  count={(aFaturarRes.count ?? 0) + (inadimplentesRes.count ?? 0)}
/>
```

Nota: o card `Conciliação Bancária` já usa `Receipt`. Trocar o ícone do CR pra `FileText` (importar se necessário — já está importado da task015). Ou usar `TrendingUp` (também importado). Decisão: usar `FileText` pra "Contas a Receber" e manter `Receipt` na Conciliação.

Reajustar:
```tsx
import { Landmark, Clock, ArrowRight, FileText, Receipt, TrendingUp, type LucideIcon } from "lucide-react";
```
(já é o que tem — nada muda no import.)

Trocar o `title="Contas a Pagar"` que usa `icon={FileText}` — vai colidir com o novo card. Usar `FileText` no Contas a Receber e trocar Contas a Pagar pra outro ícone (ex: `Landmark` já tá no header, então usar `Receipt` invertido). Melhor: importar `Wallet` de volta pra Contas a Pagar (era o que a spec original queria), e usar `Receipt` no Contas a Receber (semanticamente correto).

Ajustes:
- Import adiciona `Wallet` de novo.
- Card Contas a Pagar: `icon={Wallet}`.
- Card Contas a Receber (novo): `icon={Receipt}`.
- Card Conciliação: manter `icon={Receipt}` OU trocar pra outro (senão fica duplicado). Sugestão: Conciliação usa `Landmark`... mas Landmark tá no header. Usar `TrendingUp` na Conciliação não faz sentido. Melhor: **trocar Conciliação pra outro ícone** — usar `ArrowRight` não serve. Sugestão: importar `BookOpen` de `lucide-react` pra Conciliação (livro-razão), OU deixar `Receipt` em ambos aceitando a duplicidade visual (dois cards de fluxo financeiro).

Decisão: importar `BookOpen` e usar em Conciliação. Import ajustado:
```tsx
import { Landmark, Clock, ArrowRight, FileText, Receipt, TrendingUp, Wallet, BookOpen, type LucideIcon } from "lucide-react";
```

Cards final:

```tsx
<FinanceiroCard href="/financeiro/abertura-de-job" icon={Clock} title="Abertura de Job" ... />
<FinanceiroCard href="/financeiro/contas-a-pagar" icon={Wallet} title="Contas a Pagar" ... />
<FinanceiroCard href="/financeiro/contas-a-receber" icon={Receipt} title="Contas a Receber" ... />
<FinanceiroCard href="/financeiro/fluxo-caixa" icon={TrendingUp} title="Fluxo de caixa" ... />
<FinanceiroCard href="/financeiro/conciliacao" icon={BookOpen} title="Conciliação Bancária" ... />
```

- [ ] **Step 3: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

- [ ] **Step 4: Smoke**

```powershell
npm run dev
```

Abrir `/financeiro`: ver 5 cards, contador de Contas a Receber somando a faturar + inadimplentes. Clicar leva pra a rota.

- [ ] **Step 5: Commit**

```powershell
git add app/(app)/financeiro/page.tsx
git commit -m @'
cr(012): landing /financeiro com card "Contas a Receber"

Adiciona 5o card, contador = a faturar + inadimplentes. Ajusta
icones pra evitar colisao: Contas a Pagar volta pra Wallet, Contas
a Receber usa Receipt, Conciliacao passa a usar BookOpen.
'@
```

---

## Self-Review

**1. Spec coverage:**

| Requisito da spec | Task |
|---|---|
| Tabela `faturamentos` + constraints + storage bucket | Task 1 |
| Tabela `titulos_receber` + índice partial | Task 2 |
| Extensão `lancamentos_financeiros` (enum + coluna FK + unique parcial + constraint atualizada) | Task 3 |
| RPC `emitir_faturamento` (transacional, valida soma parcelas) | Task 4 |
| RPCs `dar_baixa_titulo` + `estornar_baixa_titulo` + gatilho BV→recebido/confirmado | Task 5 |
| RPC `cancelar_faturamento` (bloqueia se tem baixa; volta BV) | Task 6 |
| Views `vw_faturamento_pendente` + `vw_fluxo_caixa` estendida | Task 7 |
| Types TS e labels + AuditAction | Task 8 |
| Server actions com gate + audit + revalidate | Task 9 |
| Rota + tabs + aba Faturamento + drawer emitir | Task 10 |
| Aba A Receber + baixa + estorno + cancelar NF | Task 11 |
| Landing 5º card com contagem dupla | Task 12 |
| Ortografia pt-BR nas strings visíveis | Global constraint aplicada em cada task |
| Inadimplente calculado (sem persistir) | Task 11 (front) — spec confirma decisão |
| Storage privado com policies por tenant | Task 1 |
| Vínculo indireto `lancamentos_financeiros → titulos_receber → faturamentos` | Tasks 3 e 5 |

Todos os pontos da spec estão cobertos.

**2. Placeholder scan:**

- Nenhum TBD.
- Task 7 tem 1 possível ajuste: nome real das colunas de `jobs` e `versoes_orcamento_itens` já confirmados (`nome`, `item`, `codigo`, `faturamento_previsto`, `data_prevista_faturamento`, `projeto_id`). Sem placeholders.
- Task 10 e 11 têm 700+ linhas de código; nenhum step delega "faça similar" — cada trecho está inteiro.
- Task 11 Step 4 pede pra "ler o arquivo e adicionar" — instrução clara, não é TBD.

**3. Type consistency:**

- `Faturamento`, `TituloReceber` types em Task 8, consumidos em Tasks 10-11 com os mesmos nomes.
- `FaturamentoPendenteRow` definido em Task 10 (`faturamento-list.tsx`), usado em Task 10 (`page.tsx` já mapeia).
- `TituloRow` definido em Task 11 (`titulos-list.tsx`), consumido em Task 11 (`page.tsx` mapeia).
- RPC `emitir_faturamento(payload jsonb)` — assinatura consistente em Task 4 e Task 9 (server action monta payload). ✓
- RPC `dar_baixa_titulo(uuid, date, uuid, uuid)` — assinatura consistente Task 5 vs Task 9. ✓
- RPC `estornar_baixa_titulo(uuid, text, uuid)` — consistente. ✓
- RPC `cancelar_faturamento(uuid, text, uuid)` — consistente. ✓
- Audit actions em Task 8 usadas em Task 9 com strings exatas.
- `BaixaAvulsaDialog` (task015) consumido em Task 11 com props: `open, onOpenChange, descricao, valor, empresaId, dataPrevista, contas, tipoLabel, pending, onConfirm` — bate com assinatura do componente compartilhado.

Sem inconsistências.

**4. Escopo:** 12 tasks, cada uma com deliverable independente e testável. Tasks 10-11 são as maiores (700+ linhas cada) porque envolvem UI extensa — poderiam ser split em drawer separado, mas manter juntos preserva coesão do fluxo (page + tabs + list + drawer trabalham como unidade). Total estimado: 1-2 dias de trabalho seguindo o padrão de subagent-driven-development. Cabe num plano único.
