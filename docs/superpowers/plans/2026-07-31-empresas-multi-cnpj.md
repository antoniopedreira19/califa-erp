# Empresas / múltiplos CNPJs por tenant — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir a entidade `empresas` (pessoas jurídicas do grupo California), ligá-la a `projetos`/`orcamentos`/`jobs`, e entregar CRUD em `/admin/empresas` + badge/filtro nas listas operacionais.

**Architecture:** Uma nova tabela `public.empresas` (tenant-wide, FK para `regionais`), com uma marcada como `principal` (índice único parcial). FK `empresa_id` adicionada em `projetos`, `orcamentos` e `jobs` como nullable → backfill para a empresa "California Salvador" → NOT NULL. Trigger `enforce_empresa_from_projeto` propaga a empresa do projeto para orçamentos e jobs em INSERT/UPDATE; trigger `cascade_empresa_para_filhos` reage a UPDATE em `projetos.empresa_id`. CRUD em `/admin/empresas` segue o padrão de `/admin/usuarios` (page server + list client + drawer client + `actions.ts`). Form de projeto ganha campo Empresa. Listas ganham badge + filtro client-side (consistente com filtros existentes).

**Tech Stack:** Next.js App Router 14, React 18, TypeScript 5, Supabase (Postgres + RLS), Tailwind, shadcn/ui + Radix, React Hook Form + Zod.

## Global Constraints

- Toda tabela operacional tem `tenant_id`; `empresas` também.
- RLS: SELECT via `public.is_tenant_member`, INSERT/UPDATE via `public.is_tenant_admin`. Sem policy DELETE (soft-delete via `ativo=false`).
- GRANT explícito para `authenticated` em toda tabela nova + colunas novas.
- Todas as policies usam `(select auth.uid())` em vez de `auth.uid()` (regra de performance).
- `docs/PERFORMANCE.md` — checklist antes de commit em `app/(app)/**` e `lib/supabase/**`; não introduzir embed pesado (`select("...empresa:empresas(*)")`), preferir SELECT direto + mapeamento em memória; usar índice em `empresa_id` para filtros; queries independentes num mesmo server component com `Promise.all`.
- `<Link>` em lista de 5+ itens → `prefetch={false}`.
- Migrations versionadas, nunca amend em migration já aplicada.
- Nomes de coluna, tabela, trigger e ações de auditoria exatamente como no spec (`docs/superpowers/specs/2026-07-31-empresas-multi-cnpj-design.md`).
- CNPJ, CEP e telefone armazenam **só dígitos**. UF armazena 2 letras maiúsculas. Máscara é responsabilidade da UI.
- `PopoverContent` dos Selects: `side="bottom" avoidCollisions={false}` + largura fixa (memory `feedback_radix_gotchas.md`).
- `DrawerContent` sem prop `title` — compor com `DialogHeader/DialogTitle` (memory `feedback_radix_gotchas.md`).
- `SelectItem value=""` crasha — usar sentinel string (memory `feedback_radix_gotchas.md`).
- Em listas de itens navegáveis a **linha inteira** clica; ações secundárias fazem `stopPropagation` (memory `feedback_ui_linha_clicavel.md`).
- Server Actions críticas chamam `logAuditEvent` de `@/lib/auth/audit`.
- Projeto **não** tem suite de testes automatizados. "Verificação" = `pnpm lint && pnpm typecheck && pnpm build` + smoke test manual no browser + queries SQL para confirmar comportamento de banco.

---

## Task 1: Migration — tabela `empresas`, FK em projetos/orcamentos/jobs, triggers e seed

**Files:**
- Create: `supabase/migrations/20260731000002_task009_empresas.sql`

**Interfaces:**
- Consumes: `public.tenants`, `public.regionais`, `public.projetos`, `public.orcamentos`, `public.jobs`, `public.is_tenant_member`, `public.is_tenant_admin`, `public.set_updated_at`.
- Produces:
  - Tabela `public.empresas` (id, tenant_id, regional_id, razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, logradouro, numero, complemento, bairro, cidade, uf, cep, telefone, email, local_pagamento, instrucoes_nf, principal, ativo, created_by, created_at, updated_at).
  - Índices: `uniq_empresas_cnpj_por_tenant`, `uniq_empresas_principal_por_tenant` (parcial `where principal = true`), `idx_empresas_tenant`, `idx_empresas_regional`, `idx_empresas_ativo`.
  - Policies: `empresas_select`, `empresas_insert`, `empresas_update`.
  - Trigger `trg_empresas_updated_at`.
  - Colunas `empresa_id` (NOT NULL, FK) em `public.projetos`, `public.orcamentos`, `public.jobs`.
  - Índices `idx_projetos_empresa`, `idx_orcamentos_empresa`, `idx_jobs_empresa`.
  - Funções: `public.enforce_empresa_from_projeto()`, `public.cascade_empresa_para_filhos()`.
  - Triggers: `trg_orcamentos_empresa_do_projeto` (BEFORE INSERT/UPDATE em `orcamentos`), `trg_jobs_empresa_do_projeto` (BEFORE INSERT/UPDATE em `jobs`), `trg_projetos_cascade_empresa` (AFTER UPDATE em `projetos`).
  - Seed: 1 regional `NE` (se não existir no tenant California) e 1 empresa `CALIFÓRNIA FILMES E PUBLICIDADE LTDA` (principal=true, ativo=true).

- [ ] **Step 1: Criar o arquivo da migration com o cabeçalho, enum guarda-corpo e a tabela `empresas` com CHECKs de formato**

Create: `supabase/migrations/20260731000002_task009_empresas.sql`

```sql
-- =====================================================================
-- Task 009 — Empresas (pessoas jurídicas do grupo California)
--
-- Introduz `empresas` (tenant-wide, FK para `regionais`) e liga a
-- `projetos`, `orcamentos` e `jobs` via nova coluna `empresa_id`.
--
-- Decisões (spec 2026-07-31-empresas-multi-cnpj-design.md):
--   - Tenant permanece como "grupo California"; empresa = PJ dentro do
--     grupo. Um tenant pode ter N empresas.
--   - Projeto é a fonte da verdade: orçamento e job herdam `empresa_id`
--     via trigger BEFORE INSERT/UPDATE. UI/API nunca passa o valor
--     nessas duas tabelas. Cascata em UPDATE de projeto reescreve
--     filhos.
--   - `principal boolean` com índice único parcial garante exatamente
--     1 empresa principal por tenant.
--   - Cliente/fornecedor/categoria continuam do tenant, sem `empresa_id`.
--   - Formatos armazenados: CNPJ 14 dígitos, CEP 8 dígitos, telefone
--     10-11 dígitos, UF 2 letras maiúsculas.
--   - RLS: SELECT para todo membro do tenant; INSERT/UPDATE só admin.
--     Sem DELETE (soft-delete via ativo=false).
-- =====================================================================

-- 1) Tabela empresas ----------------------------------------------------
create table if not exists public.empresas (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete restrict,
  regional_id          uuid not null references public.regionais(id) on delete restrict,
  razao_social         text not null,
  nome_fantasia        text,
  cnpj                 text not null,
  inscricao_estadual   text,
  inscricao_municipal  text,
  logradouro           text not null,
  numero               text,
  complemento          text,
  bairro               text,
  cidade               text not null,
  uf                   char(2) not null,
  cep                  text not null,
  telefone             text,
  email                text,
  local_pagamento      text,
  instrucoes_nf        text,
  principal            boolean not null default false,
  ativo                boolean not null default true,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint chk_empresas_razao_social_nao_vazio check (length(trim(razao_social)) > 0),
  constraint chk_empresas_cnpj_formato check (cnpj ~ '^[0-9]{14}$'),
  constraint chk_empresas_cep_formato check (cep ~ '^[0-9]{8}$'),
  constraint chk_empresas_telefone_formato check (telefone is null or telefone ~ '^[0-9]{10,11}$'),
  constraint chk_empresas_uf_formato check (uf ~ '^[A-Z]{2}$')
);
```

- [ ] **Step 2: Adicionar índices, trigger updated_at, RLS, policies e GRANT**

Append ao mesmo arquivo:

```sql
-- 2) Índices ------------------------------------------------------------
create unique index if not exists uniq_empresas_cnpj_por_tenant
  on public.empresas(tenant_id, cnpj);

create unique index if not exists uniq_empresas_principal_por_tenant
  on public.empresas(tenant_id)
  where principal = true;

create index if not exists idx_empresas_tenant   on public.empresas(tenant_id);
create index if not exists idx_empresas_regional on public.empresas(regional_id);
create index if not exists idx_empresas_ativo    on public.empresas(tenant_id, ativo);

-- 3) Trigger updated_at -------------------------------------------------
drop trigger if exists trg_empresas_updated_at on public.empresas;
create trigger trg_empresas_updated_at
  before update on public.empresas
  for each row execute function public.set_updated_at();

-- 4) RLS + policies -----------------------------------------------------
alter table public.empresas enable row level security;

drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists empresas_insert on public.empresas;
create policy empresas_insert on public.empresas
  for insert to authenticated
  with check (
    public.is_tenant_admin(tenant_id)
    and (created_by is null or created_by = (select auth.uid()))
  );

drop policy if exists empresas_update on public.empresas;
create policy empresas_update on public.empresas
  for update to authenticated
  using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- Sem policy DELETE — soft-delete via ativo=false.

grant select, insert, update on public.empresas to authenticated;
```

- [ ] **Step 3: Seed da regional NE e da empresa California Salvador**

Append:

```sql
-- 5) Seed: regional NE + California Salvador ---------------------------
-- Executa apenas se houver tenant California; MVP tem exatamente um.
do $$
declare
  v_tenant_id  uuid;
  v_regional_id uuid;
begin
  select id into v_tenant_id
    from public.tenants
   order by created_at asc
   limit 1;

  if v_tenant_id is null then
    -- Banco novo sem tenant: nada a fazer.
    return;
  end if;

  -- Regional NE (se ainda não existir para este tenant)
  select id into v_regional_id
    from public.regionais
   where tenant_id = v_tenant_id
     and lower(nome) = 'ne'
   limit 1;

  if v_regional_id is null then
    insert into public.regionais (tenant_id, nome, ativo)
    values (v_tenant_id, 'NE', true)
    returning id into v_regional_id;
  end if;

  -- Empresa California Salvador (se ainda não houver empresa neste tenant)
  if not exists (select 1 from public.empresas where tenant_id = v_tenant_id) then
    insert into public.empresas (
      tenant_id, regional_id,
      razao_social, nome_fantasia,
      cnpj, inscricao_estadual, inscricao_municipal,
      logradouro, numero, complemento, bairro, cidade, uf, cep,
      telefone, email,
      local_pagamento, instrucoes_nf,
      principal, ativo
    ) values (
      v_tenant_id, v_regional_id,
      'CALIFÓRNIA FILMES E PUBLICIDADE LTDA', 'California',
      '19437976000154', 'ISENTO', '479604001-42',
      'AV. DA FRANÇA', '393', 'SETOR 2', 'Comércio', 'Salvador', 'BA', '40010000',
      '71991742040', null,
      null, null,
      true, true
    );
  end if;
end$$;
```

- [ ] **Step 4: Adicionar `empresa_id` nullable, backfill e SET NOT NULL em `projetos`, `orcamentos`, `jobs`**

Append:

```sql
-- 6) empresa_id em projetos / orcamentos / jobs ------------------------

-- 6a) projetos
alter table public.projetos
  add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;

update public.projetos p
   set empresa_id = e.id
  from public.empresas e
 where p.empresa_id is null
   and e.tenant_id = p.tenant_id
   and e.principal = true;

-- Guarda-corpo: qualquer projeto sem empresa_id significa que não achamos
-- empresa principal para o tenant dele. Aborta com lista dos ids.
do $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.projetos where empresa_id is null;
  if v_ids is not null then
    raise exception
      'Backfill de projetos.empresa_id incompleto: %',
      v_ids;
  end if;
end$$;

alter table public.projetos alter column empresa_id set not null;
create index if not exists idx_projetos_empresa on public.projetos(empresa_id);

-- 6b) orcamentos
alter table public.orcamentos
  add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;

update public.orcamentos o
   set empresa_id = p.empresa_id
  from public.projetos p
 where o.empresa_id is null
   and p.id = o.projeto_id;

do $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.orcamentos where empresa_id is null;
  if v_ids is not null then
    raise exception
      'Backfill de orcamentos.empresa_id incompleto: %',
      v_ids;
  end if;
end$$;

alter table public.orcamentos alter column empresa_id set not null;
create index if not exists idx_orcamentos_empresa on public.orcamentos(empresa_id);

-- 6c) jobs
alter table public.jobs
  add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;

update public.jobs j
   set empresa_id = p.empresa_id
  from public.projetos p
 where j.empresa_id is null
   and p.id = j.projeto_id;

do $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.jobs where empresa_id is null;
  if v_ids is not null then
    raise exception
      'Backfill de jobs.empresa_id incompleto: %',
      v_ids;
  end if;
end$$;

alter table public.jobs alter column empresa_id set not null;
create index if not exists idx_jobs_empresa on public.jobs(empresa_id);
```

- [ ] **Step 5: Criar triggers de propagação (orcamentos/jobs) e cascata (projetos)**

Append:

```sql
-- 7) Trigger de propagação: orcamento/job herdam empresa do projeto ---
create or replace function public.enforce_empresa_from_projeto()
returns trigger
language plpgsql
as $$
declare
  v_empresa_id uuid;
begin
  select p.empresa_id into v_empresa_id
    from public.projetos p
   where p.id = NEW.projeto_id;

  if v_empresa_id is null then
    raise exception 'projeto % não possui empresa_id', NEW.projeto_id;
  end if;

  NEW.empresa_id := v_empresa_id;
  return NEW;
end$$;

drop trigger if exists trg_orcamentos_empresa_do_projeto on public.orcamentos;
create trigger trg_orcamentos_empresa_do_projeto
  before insert or update on public.orcamentos
  for each row execute function public.enforce_empresa_from_projeto();

drop trigger if exists trg_jobs_empresa_do_projeto on public.jobs;
create trigger trg_jobs_empresa_do_projeto
  before insert or update on public.jobs
  for each row execute function public.enforce_empresa_from_projeto();

-- 8) Trigger de cascata: mudar empresa do projeto propaga p/ filhos ---
create or replace function public.cascade_empresa_para_filhos()
returns trigger
language plpgsql
as $$
begin
  if NEW.empresa_id is distinct from OLD.empresa_id then
    update public.orcamentos
       set empresa_id = NEW.empresa_id
     where projeto_id = NEW.id
       and empresa_id is distinct from NEW.empresa_id;

    update public.jobs
       set empresa_id = NEW.empresa_id
     where projeto_id = NEW.id
       and empresa_id is distinct from NEW.empresa_id;
  end if;
  return NEW;
end$$;

drop trigger if exists trg_projetos_cascade_empresa on public.projetos;
create trigger trg_projetos_cascade_empresa
  after update on public.projetos
  for each row execute function public.cascade_empresa_para_filhos();
```

- [ ] **Step 6: Aplicar a migration no ambiente de dev e verificar o resultado**

Run: `pnpm supabase db reset` (banco de desenvolvimento local; a orientação vem do fluxo Supabase do projeto).

Se estiver aplicando em banco com dados reais, use `pnpm supabase db push` ou aplique via SQL Editor no dashboard.

Expected: migration sobe sem erros. Se algum `raise exception` do guarda-corpo disparar, é bug — investigar por que o backfill deixou linha órfã antes de prosseguir.

Verificação via SQL (rodar no SQL Editor ou `psql`):

```sql
-- 1. Empresa criada com dados certos
select razao_social, cnpj, uf, cep, principal, ativo
  from public.empresas
 where tenant_id = (select id from public.tenants order by created_at limit 1);
-- Esperado: 1 linha, CALIFÓRNIA FILMES E PUBLICIDADE LTDA, cnpj 14 dígitos, principal=true.

-- 2. Todo projeto tem empresa_id
select count(*) as sem_empresa from public.projetos where empresa_id is null;
-- Esperado: 0.

-- 3. Todo orçamento e job tem empresa_id igual à do projeto
select count(*)
  from public.orcamentos o
  join public.projetos p on p.id = o.projeto_id
 where o.empresa_id is distinct from p.empresa_id;
-- Esperado: 0.

select count(*)
  from public.jobs j
  join public.projetos p on p.id = j.projeto_id
 where j.empresa_id is distinct from p.empresa_id;
-- Esperado: 0.

-- 4. Índice único parcial impede duas principais
select count(*)
  from public.empresas
 where principal = true
 group by tenant_id
having count(*) > 1;
-- Esperado: 0 linhas.
```

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/20260731000002_task009_empresas.sql
git commit -m "feat(db): tabela empresas + FK empresa_id em projetos/orcamentos/jobs (task 009)"
```

---

## Task 2: Tipos, validações e formatadores no frontend

**Files:**
- Modify: `lib/types.ts` (adicionar `Empresa` + `empresa_id` em `Projeto`/`Orcamento`/`Job`)
- Modify: `lib/auth/audit.ts` (adicionar ações de auditoria de empresa)
- Create: `lib/validations/empresas.ts`
- Create: `lib/utils/formato-fiscal.ts` (helpers de máscara CNPJ/CEP/telefone/UF)

**Interfaces:**
- Consumes: nada (base para os próximos passos).
- Produces:
  - Tipo `Empresa` em `lib/types.ts` (todos os campos do schema).
  - Campos `empresa_id: string` (NOT NULL) em `Projeto`, `Orcamento`, `Job`.
  - `AuditAction` novos: `empresa.criada`, `empresa.atualizada`, `empresa.principal_alterada`, `empresa.desativada`, `empresa.reativada`.
  - `empresaSchema` (Zod) e `EmpresaInput = z.infer<typeof empresaSchema>` em `lib/validations/empresas.ts`.
  - Helpers em `lib/utils/formato-fiscal.ts`: `formatarCNPJ(digits)`, `apenasDigitos(str)`, `formatarCEP(digits)`, `formatarTelefone(digits)`, `UFS` (const de 27 UFs).

- [ ] **Step 1: Adicionar tipo `Empresa` e propagar `empresa_id` em Projeto/Orcamento/Job**

Modify: `lib/types.ts`

Adicionar no bloco de UF (já existe `type UF`), após `export type UF = ...`:

```typescript
// ---------- Task 009: empresas (múltiplos CNPJs por tenant) ----------

export interface Empresa {
  id: string;
  tenant_id: string;
  regional_id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;                  // 14 dígitos
  inscricao_estadual: string | null;
  inscricao_municipal: string | null;
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string;
  uf: UF;
  cep: string;                   // 8 dígitos
  telefone: string | null;       // 10 ou 11 dígitos
  email: string | null;
  local_pagamento: string | null;
  instrucoes_nf: string | null;
  principal: boolean;
  ativo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

E acrescentar `empresa_id: string;` em cada uma das interfaces `Projeto`, `Orcamento`, `Job` — posicionar imediatamente após `tenant_id` para manter agrupamento por responsabilidade.

- [ ] **Step 2: Adicionar ações de auditoria de empresa**

Modify: `lib/auth/audit.ts`

Adicionar à union `AuditAction`, ao lado das outras ações reservadas (após `regional.reativada`):

```typescript
  | "empresa.criada"
  | "empresa.atualizada"
  | "empresa.principal_alterada"
  | "empresa.desativada"
  | "empresa.reativada"
```

- [ ] **Step 3: Criar `lib/utils/formato-fiscal.ts` com helpers de máscara**

Create: `lib/utils/formato-fiscal.ts`

```typescript
import type { UF } from "@/lib/types";

/** Todas as 27 UFs em ordem alfabética — usado no Select do form. */
export const UFS: UF[] = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export function apenasDigitos(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\D+/g, "");
}

/** 14 dígitos → 00.000.000/0000-00. Retorna vazio se input não tiver 14 dígitos. */
export function formatarCNPJ(digits: string | null | undefined): string {
  const d = apenasDigitos(digits);
  if (d.length !== 14) return digits ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** 8 dígitos → 00000-000. */
export function formatarCEP(digits: string | null | undefined): string {
  const d = apenasDigitos(digits);
  if (d.length !== 8) return digits ?? "";
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** 10 ou 11 dígitos → (DD) 0000-0000 ou (DD) 00000-0000. */
export function formatarTelefone(digits: string | null | undefined): string {
  const d = apenasDigitos(digits);
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return digits ?? "";
}
```

- [ ] **Step 4: Criar `lib/validations/empresas.ts` com o schema Zod**

Create: `lib/validations/empresas.ts`

```typescript
import { z } from "zod";
import { UFS } from "@/lib/utils/formato-fiscal";

/**
 * Schema do formulário de empresa (admin).
 *
 * CNPJ/CEP/telefone entram como texto livre (com ou sem máscara). O schema
 * remove tudo que não é dígito e valida a quantidade. O que vai para o
 * banco é o valor limpo — a coluna tem CHECK de formato.
 *
 * `principal` e `ativo` não estão neste schema: têm ações próprias
 * (`marcarPrincipal`, `desativarEmpresa`) para deixar a intenção explícita
 * na trilha de auditoria.
 */
export const empresaSchema = z.object({
  regional_id: z.string().uuid("Selecione a regional."),
  razao_social: z
    .string()
    .trim()
    .min(2, "Informe a razão social.")
    .max(200, "Máximo 200 caracteres."),
  nome_fantasia: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  cnpj: z
    .string()
    .transform((v) => v.replace(/\D+/g, ""))
    .refine((v) => v.length === 14, "CNPJ deve ter 14 dígitos."),
  inscricao_estadual: z
    .string()
    .trim()
    .max(30, "Máximo 30 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  inscricao_municipal: z
    .string()
    .trim()
    .max(30, "Máximo 30 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  logradouro: z
    .string()
    .trim()
    .min(2, "Informe o logradouro.")
    .max(200, "Máximo 200 caracteres."),
  numero: z
    .string()
    .trim()
    .max(20, "Máximo 20 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  complemento: z
    .string()
    .trim()
    .max(100, "Máximo 100 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  bairro: z
    .string()
    .trim()
    .max(100, "Máximo 100 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  cidade: z
    .string()
    .trim()
    .min(2, "Informe a cidade.")
    .max(100, "Máximo 100 caracteres."),
  uf: z.enum(UFS as [typeof UFS[number], ...typeof UFS[number][]], {
    errorMap: () => ({ message: "Selecione a UF." }),
  }),
  cep: z
    .string()
    .transform((v) => v.replace(/\D+/g, ""))
    .refine((v) => v.length === 8, "CEP deve ter 8 dígitos."),
  telefone: z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/\D+/g, "") : ""))
    .refine(
      (v) => v.length === 0 || v.length === 10 || v.length === 11,
      "Telefone deve ter 10 ou 11 dígitos.",
    )
    .transform((v) => (v.length === 0 ? null : v)),
  email: z
    .string()
    .trim()
    .email("E-mail inválido.")
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v : null)),
  local_pagamento: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  instrucoes_nf: z
    .string()
    .trim()
    .max(500, "Máximo 500 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type EmpresaInput = z.infer<typeof empresaSchema>;
```

- [ ] **Step 5: Verificar tipos e commit**

Run: `pnpm typecheck`
Expected: sem erros. Se `Projeto`/`Orcamento`/`Job` ficarem com `empresa_id: string` obrigatório e algum consumidor construir esses objetos "à mão" com literal, o erro aponta o local — resolver adicionando o campo naquele call site (esperado; é sinal de que o mapeamento está sendo feito).

Run: `pnpm lint`
Expected: sem erros novos.

```powershell
git add lib/types.ts lib/auth/audit.ts lib/validations/empresas.ts lib/utils/formato-fiscal.ts
git commit -m "feat(types): Empresa, validações e formatadores fiscais"
```

---

## Task 3: Data helpers e Server Actions de empresas

**Files:**
- Create: `lib/data/empresas.ts`
- Create: `app/(app)/admin/empresas/actions.ts`

**Interfaces:**
- Consumes: `empresaSchema` e `EmpresaInput` (Task 2); `requireAdmin`, `logAuditEvent`, `createClient`/`createServiceClient`; tabela `public.empresas` (Task 1).
- Produces:
  - `listEmpresasAtivas(tenantId)` → `Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "principal">[]`.
  - `getEmpresaPrincipal(tenantId)` → `Pick<Empresa, "id" | "razao_social" | "nome_fantasia"> | null`.
  - Server Actions (`app/(app)/admin/empresas/actions.ts`):
    - `criarEmpresa(formData: FormData): Promise<ActionResult>`
    - `atualizarEmpresa(id: string, formData: FormData): Promise<ActionResult>`
    - `marcarPrincipal(id: string): Promise<ActionResult>`
    - `desativarEmpresa(id: string): Promise<ActionResult>`
    - `reativarEmpresa(id: string): Promise<ActionResult>`
    - Onde `ActionResult = { ok: true; id?: string; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string[]> }`.

- [ ] **Step 1: Criar `lib/data/empresas.ts` com helpers de leitura**

Create: `lib/data/empresas.ts`

```typescript
import { createClient } from "@/lib/supabase/server";
import type { Empresa } from "@/lib/types";

/**
 * Lista empresas ativas do tenant, com a principal primeiro.
 * Usada em selects (novo projeto), badges (listas) e filtros.
 * SELECT direto — nada de embed pesado; a página compõe com um `Map<id, empresa>`.
 */
export async function listEmpresasAtivas(
  tenantId: string,
): Promise<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "principal">[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("empresas")
    .select("id, razao_social, nome_fantasia, principal")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("principal", { ascending: false })
    .order("razao_social", { ascending: true });

  if (error) {
    console.error("[empresas.listAtivas]", error.message);
    return [];
  }
  return (data ?? []) as Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "principal">[];
}

/**
 * Retorna a empresa marcada como principal do tenant, ou null se não houver.
 * Usado como default do form de projeto.
 */
export async function getEmpresaPrincipal(
  tenantId: string,
): Promise<Pick<Empresa, "id" | "razao_social" | "nome_fantasia"> | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("empresas")
    .select("id, razao_social, nome_fantasia")
    .eq("tenant_id", tenantId)
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (error) {
    console.error("[empresas.getPrincipal]", error.message);
    return null;
  }
  return data;
}
```

- [ ] **Step 2: Criar `app/(app)/admin/empresas/actions.ts` — bloco de imports, tipo `ActionResult`, `extractInput` e mapeamento de erros de banco**

Create: `app/(app)/admin/empresas/actions.ts`

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { empresaSchema } from "@/lib/validations/empresas";

export type ActionResult =
  | { ok: true; id?: string; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    regional_id: formData.get("regional_id")?.toString() ?? "",
    razao_social: formData.get("razao_social")?.toString() ?? "",
    nome_fantasia: formData.get("nome_fantasia")?.toString() ?? "",
    cnpj: formData.get("cnpj")?.toString() ?? "",
    inscricao_estadual: formData.get("inscricao_estadual")?.toString() ?? "",
    inscricao_municipal: formData.get("inscricao_municipal")?.toString() ?? "",
    logradouro: formData.get("logradouro")?.toString() ?? "",
    numero: formData.get("numero")?.toString() ?? "",
    complemento: formData.get("complemento")?.toString() ?? "",
    bairro: formData.get("bairro")?.toString() ?? "",
    cidade: formData.get("cidade")?.toString() ?? "",
    uf: formData.get("uf")?.toString() ?? "",
    cep: formData.get("cep")?.toString() ?? "",
    telefone: formData.get("telefone")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    local_pagamento: formData.get("local_pagamento")?.toString() ?? "",
    instrucoes_nf: formData.get("instrucoes_nf")?.toString() ?? "",
  };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_empresas_cnpj_por_tenant")) {
    return "Já existe uma empresa com este CNPJ no tenant.";
  }
  if (msg.includes("uniq_empresas_principal_por_tenant")) {
    return "Já existe outra empresa marcada como principal — recarregue a lista.";
  }
  if (msg.includes("empresas_regional_id_fkey")) {
    return "Regional inválida.";
  }
  if (msg.includes("chk_empresas_cnpj_formato")) {
    return "CNPJ inválido: deve ter 14 dígitos.";
  }
  if (msg.includes("chk_empresas_cep_formato")) {
    return "CEP inválido: deve ter 8 dígitos.";
  }
  if (msg.includes("chk_empresas_telefone_formato")) {
    return "Telefone inválido: deve ter 10 ou 11 dígitos.";
  }
  return "Não foi possível salvar. Tente novamente.";
}
```

- [ ] **Step 3: Server Action `criarEmpresa`**

Append ao mesmo arquivo:

```typescript
/**
 * Cria uma empresa. Se `principal=true` foi solicitado (via campo hidden
 * no form), desmarca a principal atual do tenant no mesmo statement, para
 * o índice único parcial aceitar o INSERT.
 */
export async function criarEmpresa(formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = empresaSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const marcarPrincipalFlag = formData.get("principal")?.toString() === "true";
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Se vai criar como principal, desmarca a atual primeiro.
  if (marcarPrincipalFlag) {
    const { error: updErr } = await supabase
      .from("empresas")
      .update({ principal: false })
      .eq("tenant_id", tenantId)
      .eq("principal", true);
    if (updErr) {
      console.error("[empresas.criar.zerar-principal]", updErr.message);
      return { ok: false, message: "Falha ao trocar a empresa principal." };
    }
  }

  const { data, error } = await supabase
    .from("empresas")
    .insert({
      ...parsed.data,
      tenant_id: tenantId,
      created_by: session.profile.id,
      principal: marcarPrincipalFlag,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[empresas.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "empresa.criada",
    tenantId,
    entidadeTipo: "empresa",
    entidadeId: data.id,
    metadata: {
      razao_social: parsed.data.razao_social,
      cnpj: parsed.data.cnpj,
      principal: marcarPrincipalFlag,
    },
  });

  if (marcarPrincipalFlag) {
    await logAuditEvent({
      acao: "empresa.principal_alterada",
      tenantId,
      entidadeTipo: "empresa",
      entidadeId: data.id,
      metadata: { nova_principal_id: data.id },
    });
  }

  revalidatePath("/admin/empresas");
  revalidatePath("/admin");
  return { ok: true, id: data.id, message: "Empresa cadastrada." };
}
```

- [ ] **Step 4: Server Actions `atualizarEmpresa`, `marcarPrincipal`, `desativarEmpresa`, `reativarEmpresa`**

Append:

```typescript
/**
 * Atualiza uma empresa. `principal` NÃO entra por aqui — é ação própria
 * (marcarPrincipal). Ativo/inativo também são ações próprias.
 */
export async function atualizarEmpresa(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = empresaSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { error } = await supabase
    .from("empresas")
    .update(parsed.data)
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[empresas.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "empresa.atualizada",
    tenantId,
    entidadeTipo: "empresa",
    entidadeId: id,
  });

  revalidatePath("/admin/empresas");
  return { ok: true, id, message: "Empresa atualizada." };
}

/** Marca uma empresa como principal (desmarca a atual). */
export async function marcarPrincipal(id: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Confirma que a empresa existe e está ativa antes de mexer no flag.
  const { data: alvo, error: getErr } = await supabase
    .from("empresas")
    .select("id, ativo, principal")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (getErr || !alvo) {
    return { ok: false, message: "Empresa não encontrada." };
  }
  if (!alvo.ativo) {
    return { ok: false, message: "Não é possível marcar uma empresa inativa como principal." };
  }
  if (alvo.principal) {
    return { ok: true, id, message: "Empresa já é a principal." };
  }

  // Desmarca a principal atual (se houver).
  const { error: unsetErr } = await supabase
    .from("empresas")
    .update({ principal: false })
    .eq("tenant_id", tenantId)
    .eq("principal", true);
  if (unsetErr) {
    console.error("[empresas.marcarPrincipal.unset]", unsetErr.message);
    return { ok: false, message: "Falha ao trocar a empresa principal." };
  }

  const { error: setErr } = await supabase
    .from("empresas")
    .update({ principal: true })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (setErr) {
    console.error("[empresas.marcarPrincipal.set]", setErr.message);
    return { ok: false, message: "Falha ao marcar como principal." };
  }

  await logAuditEvent({
    acao: "empresa.principal_alterada",
    tenantId,
    entidadeTipo: "empresa",
    entidadeId: id,
    metadata: { nova_principal_id: id },
  });

  revalidatePath("/admin/empresas");
  revalidatePath("/admin");
  return { ok: true, id, message: "Empresa marcada como principal." };
}

/** Soft-delete. Bloqueia se for a principal. */
export async function desativarEmpresa(id: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: alvo, error: getErr } = await supabase
    .from("empresas")
    .select("id, principal, ativo")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (getErr || !alvo) {
    return { ok: false, message: "Empresa não encontrada." };
  }
  if (alvo.principal) {
    return {
      ok: false,
      message: "Marque outra empresa como principal antes de desativar esta.",
    };
  }
  if (!alvo.ativo) {
    return { ok: true, id, message: "Empresa já estava inativa." };
  }

  const { error } = await supabase
    .from("empresas")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[empresas.desativar]", error.message);
    return { ok: false, message: "Não foi possível desativar." };
  }

  await logAuditEvent({
    acao: "empresa.desativada",
    tenantId,
    entidadeTipo: "empresa",
    entidadeId: id,
  });

  revalidatePath("/admin/empresas");
  revalidatePath("/admin");
  return { ok: true, id, message: "Empresa desativada." };
}

/** Reativa uma empresa soft-deletada. */
export async function reativarEmpresa(id: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { error } = await supabase
    .from("empresas")
    .update({ ativo: true })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[empresas.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "empresa.reativada",
    tenantId,
    entidadeTipo: "empresa",
    entidadeId: id,
  });

  revalidatePath("/admin/empresas");
  revalidatePath("/admin");
  return { ok: true, id, message: "Empresa reativada." };
}
```

- [ ] **Step 5: Verificar tipos e commit**

Run: `pnpm typecheck`
Expected: sem erros.

Run: `pnpm lint`
Expected: sem erros novos.

```powershell
git add lib/data/empresas.ts app/(app)/admin/empresas/actions.ts
git commit -m "feat(admin): data helpers e server actions de empresas"
```

---

## Task 4: UI `/admin/empresas` — página, lista e drawer

**Files:**
- Create: `app/(app)/admin/empresas/page.tsx`
- Create: `app/(app)/admin/empresas/empresas-list.tsx`
- Create: `app/(app)/admin/empresas/empresa-drawer.tsx`

**Interfaces:**
- Consumes: Server Actions da Task 3; `Empresa`, `UF`, `Regional` de `lib/types.ts`; helpers `formatarCNPJ`, `formatarCEP`, `formatarTelefone`, `UFS`, `apenasDigitos`; `requireAdmin`.
- Produces: URL `/admin/empresas` funcional (CRUD completo).

- [ ] **Step 1: Criar `page.tsx` (server component)**

Create: `app/(app)/admin/empresas/page.tsx`

```typescript
import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Empresa, Regional } from "@/lib/types";
import { EmpresasList, type EmpresaRow } from "./empresas-list";
import { EmpresaDrawer } from "./empresa-drawer";

export const dynamic = "force-dynamic";

export default async function AdminEmpresasPage() {
  const session = await requireAdmin();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const [empRes, regRes] = await Promise.all([
    supabase
      .from("empresas")
      .select(
        "id, razao_social, nome_fantasia, cnpj, cidade, uf, principal, ativo, regional_id, " +
          "regional:regionais(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .order("principal", { ascending: false })
      .order("razao_social", { ascending: true }),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("nome"),
  ]);

  if (empRes.error) console.error("[admin.empresas.list]", empRes.error.message);
  if (regRes.error) console.error("[admin.empresas.regionais]", regRes.error.message);

  const rows: EmpresaRow[] = ((empRes.data ?? []) as any[]).map((e) => ({
    id: e.id,
    razao_social: e.razao_social,
    nome_fantasia: e.nome_fantasia,
    cnpj: e.cnpj,
    cidade: e.cidade,
    uf: e.uf,
    principal: e.principal,
    ativo: e.ativo,
    regional_id: e.regional_id,
    regional_nome: e.regional?.nome ?? null,
  }));

  const regionais = (regRes.data ?? []) as Pick<Regional, "id" | "nome">[];

  return (
    <div className="space-y-8">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-california-red transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para Administração
      </Link>

      <header className="flex items-start justify-between gap-6">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
            Administração
          </p>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <Building2 className="h-5 w-5 text-california-red" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Empresas</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Cadastre as pessoas jurídicas do grupo California. A empresa marcada
            como <b>principal</b> é usada por padrão em novos projetos.
          </p>
        </div>
        <EmpresaDrawer mode="create" regionais={regionais} />
      </header>

      <EmpresasList rows={rows} regionais={regionais} />
    </div>
  );
}
```

- [ ] **Step 2: Criar `empresas-list.tsx` (client) — cabeçalho, colunas e linha clicável abrindo o drawer**

Create: `app/(app)/admin/empresas/empresas-list.tsx`

```typescript
"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatarCNPJ } from "@/lib/utils/formato-fiscal";
import type { Regional, UF } from "@/lib/types";
import { EmpresaDrawer } from "./empresa-drawer";
import {
  desativarEmpresa,
  marcarPrincipal,
  reativarEmpresa,
} from "./actions";

export interface EmpresaRow {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;
  cidade: string;
  uf: UF;
  principal: boolean;
  ativo: boolean;
  regional_id: string;
  regional_nome: string | null;
}

interface Props {
  rows: EmpresaRow[];
  regionais: Pick<Regional, "id" | "nome">[];
}

export function EmpresasList({ rows, regionais }: Props) {
  const [editar, setEditar] = React.useState<EmpresaRow | null>(null);
  const [menu, setMenu] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  async function acao(fn: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.message) alert(res.message);
      setMenu(null);
    });
  }

  return (
    <>
      <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma empresa cadastrada ainda.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-semibold px-6 py-3">Razão social</th>
                <th className="text-left font-semibold px-6 py-3">CNPJ</th>
                <th className="text-left font-semibold px-6 py-3">Regional</th>
                <th className="text-left font-semibold px-6 py-3">Cidade/UF</th>
                <th className="text-left font-semibold px-6 py-3">Status</th>
                <th className="w-10 px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className="hover:bg-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40"
                  onClick={() => setEditar(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setEditar(row);
                    }
                  }}
                >
                  <td className="px-6 py-3.5">
                    <div className="font-medium text-foreground">{row.razao_social}</div>
                    {row.nome_fantasia && (
                      <div className="text-xs text-muted-foreground">
                        {row.nome_fantasia}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3.5 font-mono text-xs text-muted-foreground">
                    {formatarCNPJ(row.cnpj)}
                  </td>
                  <td className="px-6 py-3.5">
                    {row.regional_nome ? (
                      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100 border-slate-200">
                        {row.regional_nome}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-muted-foreground">
                    {row.cidade}/{row.uf}
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-1.5">
                      {row.principal && (
                        <Badge className="bg-california-red/10 text-california-red hover:bg-california-red/10 border-california-red/20">
                          Principal
                        </Badge>
                      )}
                      {!row.ativo && (
                        <Badge className="bg-muted text-muted-foreground hover:bg-muted border-border">
                          Inativa
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td
                    className="px-6 py-3.5 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="relative inline-block">
                      <button
                        type="button"
                        aria-label="Ações"
                        onClick={() => setMenu(menu === row.id ? null : row.id)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {menu === row.id && (
                        <div
                          className="absolute right-0 top-full mt-1 z-10 min-w-[180px] rounded-lg border border-border bg-white p-1 shadow-lg"
                          onMouseLeave={() => setMenu(null)}
                        >
                          <MenuItem
                            onClick={() => {
                              setMenu(null);
                              setEditar(row);
                            }}
                          >
                            Editar
                          </MenuItem>
                          {!row.principal && row.ativo && (
                            <MenuItem
                              disabled={pending}
                              onClick={() => acao(() => marcarPrincipal(row.id))}
                            >
                              Marcar como principal
                            </MenuItem>
                          )}
                          {row.ativo && !row.principal && (
                            <MenuItem
                              disabled={pending}
                              onClick={() => acao(() => desativarEmpresa(row.id))}
                            >
                              Desativar
                            </MenuItem>
                          )}
                          {!row.ativo && (
                            <MenuItem
                              disabled={pending}
                              onClick={() => acao(() => reativarEmpresa(row.id))}
                            >
                              Reativar
                            </MenuItem>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editar && (
        <EmpresaDrawer
          mode="edit"
          empresa={editar}
          regionais={regionais}
          openInitially
          onClose={() => setEditar(null)}
        />
      )}
    </>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full rounded px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-foreground",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 3: Criar `empresa-drawer.tsx` (client) — imports, tipo Props e estado do form**

Create: `app/(app)/admin/empresas/empresa-drawer.tsx`

```typescript
"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Plus, Save } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Regional, UF } from "@/lib/types";
import { UFS, apenasDigitos, formatarCNPJ, formatarCEP, formatarTelefone } from "@/lib/utils/formato-fiscal";
import { criarEmpresa, atualizarEmpresa, type ActionResult } from "./actions";
import type { EmpresaRow } from "./empresas-list";

type Props =
  | {
      mode: "create";
      regionais: Pick<Regional, "id" | "nome">[];
    }
  | {
      mode: "edit";
      empresa: EmpresaRow;
      regionais: Pick<Regional, "id" | "nome">[];
      openInitially?: boolean;
      onClose?: () => void;
    };

export function EmpresaDrawer(props: Props) {
  const [open, setOpen] = React.useState(
    props.mode === "edit" ? !!props.openInitially : false,
  );
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [sucesso, setSucesso] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  // Estado dos Selects controlados (regional, UF).
  const empresa = props.mode === "edit" ? props.empresa : undefined;
  const [regionalId, setRegionalId] = React.useState(empresa?.regional_id ?? "");
  const [uf, setUf] = React.useState<UF | "">((empresa?.uf as UF | undefined) ?? "");
  const [principal, setPrincipal] = React.useState(empresa?.principal ?? false);

  function reset() {
    setError(null);
    setSucesso(null);
    setFieldErrors({});
  }

  function handleOpenChange(o: boolean) {
    setOpen(o);
    if (!o) {
      reset();
      if (props.mode === "edit") props.onClose?.();
    }
  }
```

- [ ] **Step 4: Continuação de `empresa-drawer.tsx` — handleSubmit e render**

Append ao mesmo arquivo:

```typescript
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    reset();

    const formData = new FormData(e.currentTarget);
    formData.set("regional_id", regionalId);
    formData.set("uf", uf);
    formData.set("principal", principal ? "true" : "false");

    startTransition(async () => {
      const res: ActionResult =
        props.mode === "edit"
          ? await atualizarEmpresa(props.empresa.id, formData)
          : await criarEmpresa(formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      setSucesso(res.message ?? "Empresa salva.");
      setTimeout(() => handleOpenChange(false), 1000);
    });
  }

  const erroClasses = (name: string) =>
    fieldErrors[name]?.length
      ? "border-california-red ring-2 ring-california-red/15"
      : "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {props.mode === "create" && (
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
          >
            <Plus className="h-4 w-4" />
            Nova empresa
          </button>
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>
            {props.mode === "edit" ? "Editar empresa" : "Nova empresa"}
          </DialogTitle>
          <DialogDescription>
            Dados fiscais e de contato usados por documentos emitidos por esta PJ.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <Section title="Identificação">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Razão social" name="razao_social" required errors={fieldErrors}>
                  <Input
                    name="razao_social"
                    defaultValue={empresa?.razao_social ?? ""}
                    className={erroClasses("razao_social")}
                    autoFocus
                    maxLength={200}
                  />
                </Field>
                <Field label="Nome fantasia" name="nome_fantasia" errors={fieldErrors}>
                  <Input
                    name="nome_fantasia"
                    defaultValue={empresa?.nome_fantasia ?? ""}
                    maxLength={200}
                  />
                </Field>
                <Field label="CNPJ" name="cnpj" required errors={fieldErrors}>
                  <Input
                    name="cnpj"
                    defaultValue={formatarCNPJ(empresa?.cnpj)}
                    className={erroClasses("cnpj")}
                    placeholder="00.000.000/0000-00"
                    onBlur={(e) => {
                      e.target.value = formatarCNPJ(apenasDigitos(e.target.value));
                    }}
                  />
                </Field>
                <Field label="Inscrição estadual" name="inscricao_estadual" errors={fieldErrors}>
                  <Input name="inscricao_estadual" placeholder="ISENTO ou número" maxLength={30} />
                </Field>
                <Field label="Inscrição municipal" name="inscricao_municipal" errors={fieldErrors}>
                  <Input name="inscricao_municipal" maxLength={30} />
                </Field>
              </div>
            </Section>

            <Section title="Endereço">
              <div className="grid gap-4 md:grid-cols-6">
                <div className="md:col-span-2">
                  <Field label="CEP" name="cep" required errors={fieldErrors}>
                    <Input
                      name="cep"
                      className={erroClasses("cep")}
                      placeholder="00000-000"
                      onBlur={(e) => {
                        e.target.value = formatarCEP(apenasDigitos(e.target.value));
                      }}
                    />
                  </Field>
                </div>
                <div className="md:col-span-4">
                  <Field label="Logradouro" name="logradouro" required errors={fieldErrors}>
                    <Input name="logradouro" className={erroClasses("logradouro")} maxLength={200} />
                  </Field>
                </div>
                <div className="md:col-span-1">
                  <Field label="Número" name="numero" errors={fieldErrors}>
                    <Input name="numero" maxLength={20} />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="Complemento" name="complemento" errors={fieldErrors}>
                    <Input name="complemento" maxLength={100} />
                  </Field>
                </div>
                <div className="md:col-span-3">
                  <Field label="Bairro" name="bairro" errors={fieldErrors}>
                    <Input name="bairro" maxLength={100} />
                  </Field>
                </div>
                <div className="md:col-span-4">
                  <Field label="Cidade" name="cidade" required errors={fieldErrors}>
                    <Input name="cidade" className={erroClasses("cidade")} maxLength={100} />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="UF" name="uf" required errors={fieldErrors}>
                    <Select value={uf} onValueChange={(v) => setUf(v as UF)}>
                      <SelectTrigger className={erroClasses("uf")}>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent
                        side="bottom"
                        avoidCollisions={false}
                        className="w-[--radix-select-trigger-width]"
                      >
                        {UFS.map((u) => (
                          <SelectItem key={u} value={u}>{u}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>
            </Section>

            <Section title="Contato">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Telefone" name="telefone" errors={fieldErrors}>
                  <Input
                    name="telefone"
                    placeholder="(00) 00000-0000"
                    onBlur={(e) => {
                      e.target.value = formatarTelefone(apenasDigitos(e.target.value));
                    }}
                  />
                </Field>
                <Field label="E-mail" name="email" errors={fieldErrors}>
                  <Input name="email" type="email" maxLength={200} />
                </Field>
              </div>
            </Section>

            <Section title="Faturamento">
              <Field label="Local de pagamento" name="local_pagamento" errors={fieldErrors}>
                <Input name="local_pagamento" placeholder="Ex.: Salvador - BA" maxLength={200} />
              </Field>
              <Field label="Instruções para nota fiscal" name="instrucoes_nf" errors={fieldErrors}>
                <Textarea name="instrucoes_nf" rows={3} maxLength={500} />
              </Field>
            </Section>

            <Section title="Classificação">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Regional" name="regional_id" required errors={fieldErrors}>
                  <Select value={regionalId} onValueChange={setRegionalId}>
                    <SelectTrigger className={erroClasses("regional_id")}>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent
                      side="bottom"
                      avoidCollisions={false}
                      className="w-[--radix-select-trigger-width]"
                    >
                      {props.regionais.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={principal}
                      onChange={(e) => setPrincipal(e.target.checked)}
                      className="h-4 w-4 rounded border-border text-california-red focus:ring-california-red"
                    />
                    <span>Marcar como <b>principal</b> do tenant</span>
                  </label>
                </div>
              </div>
            </Section>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {sucesso && (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{sucesso}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || !!sucesso}
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
                  {props.mode === "edit" ? "Salvar alterações" : "Cadastrar"}
                </>
              )}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
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

- [ ] **Step 5: Verificar tipos, build e smoke test no browser**

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

Run: `pnpm dev`
Como admin logado, navegar em `/admin/empresas`. Verificar:
- Lista mostra CALIFÓRNIA FILMES E PUBLICIDADE LTDA com badge "Principal", CNPJ formatado, regional "NE", cidade "Salvador/BA".
- Clicar em "Nova empresa": drawer abre com todos os blocos.
- Tentar criar sem preencher: erros aparecem nos campos vermelhos.
- Criar uma segunda empresa (regional NE, dados fictícios, sem marcar principal): salva e aparece na lista.
- Clicar na linha da segunda: drawer de edição abre com os valores.
- Menu "⋯" → "Marcar como principal": a segunda vira principal, a primeira perde o badge.
- Menu "⋯" → "Desativar" na não-principal: fica com badge "Inativa".
- Menu "⋯" → "Reativar": volta ao normal.
- Tentar desativar a principal: alerta "Marque outra empresa como principal antes de desativar esta."

- [ ] **Step 6: Commit**

```powershell
git add app/(app)/admin/empresas/
git commit -m "feat(admin): CRUD de empresas em /admin/empresas"
```

---

## Task 5: Card "Empresas" em `/admin`

**Files:**
- Modify: `app/(app)/admin/page.tsx`

**Interfaces:**
- Consumes: contagem de empresas ativas (via `service.from("empresas").select(..., { count: "exact", head: true })`).
- Produces: segundo card `AdminCard` no grid, apontando para `/admin/empresas`.

- [ ] **Step 1: Adicionar contagem de empresas e o card**

Modify: `app/(app)/admin/page.tsx`

Substituir o bloco de contagem por `Promise.all` e adicionar o segundo card:

```typescript
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireAdmin();
  const service = createServiceClient();
  const tenantId = session.activeTenant.id;

  const [membersRes, empresasRes] = await Promise.all([
    service
      .from("tenant_members")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "ativo"),
    service
      .from("empresas")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
  ]);

  const ativosCount = membersRes.count ?? 0;
  const empresasCount = empresasRes.count ?? 0;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Administração
        </p>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <ShieldCheck className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Configurações do sistema
          </h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Gestão de acesso, papéis e regras internas do California ERP.
          Disponível apenas para administradores.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <AdminCard
          href="/admin/usuarios"
          icon={Users}
          title="Usuários"
          description="Convide novos membros e defina o papel de cada um dentro do tenant."
          count={ativosCount}
          countLabel={ativosCount === 1 ? "ativo" : "ativos"}
        />
        <AdminCard
          href="/admin/empresas"
          icon={Building2}
          title="Empresas"
          description="Cadastre as pessoas jurídicas do grupo California."
          count={empresasCount}
          countLabel={empresasCount === 1 ? "ativa" : "ativas"}
        />
      </div>
    </div>
  );
}
```

O componente `AdminCard` no rodapé do arquivo permanece igual.

- [ ] **Step 2: Verificar e commit**

Run: `pnpm typecheck && pnpm lint`

Smoke test: navegar em `/admin` como admin. Ver os dois cards.

```powershell
git add app/(app)/admin/page.tsx
git commit -m "feat(admin): card Empresas na tela de administração"
```

---

## Task 6: Campo `empresa_id` no formulário de projeto

**Files:**
- Modify: `lib/validations/projetos.ts`
- Modify: `app/(app)/orcamentos/projeto-form.tsx`
- Modify: `app/(app)/orcamentos/actions.ts`
- Modify: `app/(app)/orcamentos/novo/page.tsx`
- Modify: `app/(app)/orcamentos/[projetoId]/page.tsx` (form de edição, se abre pelo mesmo drawer)

**Interfaces:**
- Consumes: `listEmpresasAtivas`, `getEmpresaPrincipal` (Task 3); campo `empresa_id` obrigatório em `Projeto` (Task 2).
- Produces: form de projeto pede empresa; Server Actions gravam `empresa_id`.

- [ ] **Step 1: Adicionar `empresa_id` no schema Zod de projeto**

Modify: `lib/validations/projetos.ts`

Dentro do objeto Zod (perto de `regional_id`), adicionar:

```typescript
    empresa_id: z.string().uuid("Selecione a empresa."),
```

- [ ] **Step 2: Adicionar prop `empresas` e state `empresaId` no `ProjetoForm`, além do campo no grid**

Modify: `app/(app)/orcamentos/projeto-form.tsx`

Na interface `Props`, adicionar:

```typescript
  empresas: { id: string; razao_social: string; nome_fantasia: string | null; principal: boolean }[];
  empresaPrincipalId?: string;
```

Na desestruturação do componente, adicionar `empresas` e `empresaPrincipalId`.

Adicionar state:

```typescript
  const [empresaId, setEmpresaId] = React.useState(
    projeto?.empresa_id ?? empresaPrincipalId ?? "",
  );
```

Em `handleSubmit`, antes de `startTransition`, adicionar:

```typescript
    formData.set("empresa_id", empresaId);
```

No grid do form, adicionar um campo Empresa como primeiro item da linha superior (antes do Nome), para dar visibilidade:

```typescript
        <Field label="Empresa" name="empresa_id" required errors={fieldErrors}>
          <Select value={empresaId} onValueChange={setEmpresaId}>
            <SelectTrigger className={erroClasses("empresa_id")}>
              <SelectValue placeholder="Selecione a empresa" />
            </SelectTrigger>
            <SelectContent
              side="bottom"
              avoidCollisions={false}
              className="w-[--radix-select-trigger-width]"
            >
              {empresas.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.nome_fantasia ?? e.razao_social}
                  {e.principal && (
                    <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                      principal
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
```

- [ ] **Step 3: `extractInput` e `criarProjeto`/`atualizarProjeto` passam `empresa_id`**

Modify: `app/(app)/orcamentos/actions.ts`

Em `extractInput`, adicionar (dentro do objeto `base`):

```typescript
    empresa_id: formData.get("empresa_id")?.toString() ?? "",
```

Em `mapDbError`, adicionar:

```typescript
  if (msg.includes("projetos_empresa_id_fkey")) {
    return "Empresa inválida.";
  }
```

Nenhuma outra mudança nas actions: o `...parsed.data` já inclui `empresa_id` no INSERT/UPDATE.

- [ ] **Step 4: Buscar empresas nas páginas que renderizam o form**

Modify: `app/(app)/orcamentos/novo/page.tsx`

Adicionar a busca de empresas (usar `listEmpresasAtivas`) e a principal, e passar para o `<ProjetoForm />`.

Como o arquivo original não foi lido nesta task, o padrão a seguir é:

```typescript
import { listEmpresasAtivas, getEmpresaPrincipal } from "@/lib/data/empresas";

// dentro do server component, juntar às queries paralelas existentes:
const [ /* ...outras... */, empresas, principal] = await Promise.all([
  /* ...outras queries... */,
  listEmpresasAtivas(session.activeTenant.id),
  getEmpresaPrincipal(session.activeTenant.id),
]);

// no JSX:
<ProjetoForm
  /* ...props existentes... */
  empresas={empresas}
  empresaPrincipalId={principal?.id}
/>
```

Se o form de edição vive num drawer chamado pela página `[projetoId]`, aplicar mesma mudança lá.

- [ ] **Step 5: Verificar e commit**

Run: `pnpm typecheck && pnpm lint && pnpm build`

Smoke test:
- Navegar em `/orcamentos/novo`: form mostra Empresa com "California" pré-selecionada.
- Criar projeto sem trocar: vai para `/orcamentos/<id>`. No banco, `projetos.empresa_id` = California Salvador.
- Cadastrar segunda empresa em `/admin/empresas` (regional NE, dados fictícios).
- Criar novo projeto escolhendo a 2ª empresa. No banco confirmar: projeto tem `empresa_id` da 2ª empresa. Criar um orçamento nesse projeto; verificar via SQL que `orcamentos.empresa_id` bateu com o projeto (trigger).
- Editar o projeto e trocar a empresa. Verificar que os orçamentos filhos foram atualizados (cascata).

```powershell
git add lib/validations/projetos.ts app/(app)/orcamentos/projeto-form.tsx app/(app)/orcamentos/actions.ts app/(app)/orcamentos/novo/page.tsx app/(app)/orcamentos/[projetoId]/page.tsx
git commit -m "feat(projetos): campo empresa no form (obrigatório, default = principal)"
```

---

## Task 7: Badge e filtro por empresa na lista de projetos

**Files:**
- Modify: `app/(app)/orcamentos/page.tsx`
- Modify: `app/(app)/orcamentos/projetos-list.tsx`

**Interfaces:**
- Consumes: coluna `empresas` retornada em `projetos.page.tsx`; `listEmpresasAtivas`.
- Produces: `ProjetoRow` ganha `empresa_id` e `empresa_nome`; `ProjetosList` mostra badge de empresa em cada linha e Select de filtro no topo (sempre visível, mesmo com 1 empresa — decisão do spec).

- [ ] **Step 1: Puxar empresa junto com projeto e passar para a lista**

Modify: `app/(app)/orcamentos/page.tsx`

Na query de projetos, incluir `empresa:empresas(id, razao_social, nome_fantasia)`. Adicionar `listEmpresasAtivas` na `Promise.all`.

Trecho da query:

```typescript
      .select(
        "id, codigo, nome, campanha, status, cliente_id, responsavel_id, " +
          "data_inicio_prevista, created_at, empresa_id, " +
          "cliente:clientes(id, nome_fantasia), " +
          "responsavel:profiles!responsavel_id(id, nome), " +
          "categoria:categorias_dominio(nome), " +
          "empresa:empresas(id, razao_social, nome_fantasia)",
      )
```

No mapeamento para `ProjetoRow`:

```typescript
    empresa_id: p.empresa_id,
    empresa_nome: p.empresa?.nome_fantasia ?? p.empresa?.razao_social ?? null,
```

E adicionar `empresas={empresas}` no `<ProjetosList />`.

- [ ] **Step 2: Estender `ProjetoRow` e adicionar coluna + filtro no `ProjetosList`**

Modify: `app/(app)/orcamentos/projetos-list.tsx`

Na interface `ProjetoRow`, adicionar:

```typescript
  empresa_id: string;
  empresa_nome: string | null;
```

Na `interface Props`, adicionar:

```typescript
  empresas: { id: string; razao_social: string; nome_fantasia: string | null }[];
```

Adicionar state:

```typescript
  const [empresaFiltro, setEmpresaFiltro] = React.useState<string>("todas");
```

Adicionar ao `filtrados`:

```typescript
      if (empresaFiltro !== "todas" && p.empresa_id !== empresaFiltro) return false;
```

Adicionar o Select ao lado dos outros filtros no topo:

```typescript
        <Select value={empresaFiltro} onValueChange={setEmpresaFiltro}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            avoidCollisions={false}
            className="w-[--radix-select-trigger-width]"
          >
            <SelectItem value="todas">Todas as empresas</SelectItem>
            {empresas.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nome_fantasia ?? e.razao_social}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
```

Adicionar nova coluna "Empresa" no `<thead>` (entre "Cliente" e "Responsável", por exemplo) e no `<tbody>`:

```typescript
                <td className="px-4 py-3">
                  {p.empresa_nome ? (
                    <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
                      {p.empresa_nome}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
```

Ajustar o `colSpan={8}` do estado vazio para `9` (uma coluna a mais).

- [ ] **Step 3: Verificar e commit**

Run: `pnpm typecheck && pnpm lint`

Smoke test: `/orcamentos` mostra a coluna Empresa e o filtro. Filtrar pela 2ª empresa deve reduzir a lista.

```powershell
git add app/(app)/orcamentos/page.tsx app/(app)/orcamentos/projetos-list.tsx
git commit -m "feat(projetos): badge e filtro por empresa na lista"
```

---

## Task 8: Badge e filtro por empresa na lista de jobs

**Files:**
- Modify: `app/(app)/jobs/page.tsx`
- Modify: `app/(app)/jobs/jobs-list.tsx`

**Interfaces:**
- Consumes: `listEmpresasAtivas`; `empresa_id` em `Job` (Task 2).
- Produces: `JobRow` ganha `empresa_id` e `empresa_nome`; `JobsList` ganha badge + filtro no topo.

- [ ] **Step 1: Puxar empresa junto com job e passar para a lista**

Modify: `app/(app)/jobs/page.tsx`

Na query, incluir `empresa_id` diretamente e `empresa:empresas(id, razao_social, nome_fantasia)`. Adicionar `listEmpresasAtivas` na `Promise.all` (converter o `await` atual em `Promise.all`).

```typescript
import { listEmpresasAtivas } from "@/lib/data/empresas";

// ...
const [jobsRes, empresas] = await Promise.all([
  supabase
    .from("jobs")
    .select(
      "id, codigo, nome, status, valor_total, data_inicio_prevista, job_pai_id, empresa_id, " +
        "projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia)), " +
        "responsavel:profiles!responsavel_id(nome), " +
        "filhos:jobs!job_pai_id(count), " +
        "empresa:empresas(id, razao_social, nome_fantasia)",
    )
    .eq("tenant_id", session.activeTenant.id)
    .order("created_at", { ascending: false }),
  listEmpresasAtivas(session.activeTenant.id),
]);
```

No mapeamento para `JobRow`, adicionar:

```typescript
    empresa_id: r.empresa_id,
    empresa_nome: r.empresa?.nome_fantasia ?? r.empresa?.razao_social ?? null,
```

E passar `empresas` como prop: `<JobsList rows={rows} empresas={empresas} />`.

- [ ] **Step 2: Estender `JobRow` e adicionar filtro/badge em `JobsList`**

Modify: `app/(app)/jobs/jobs-list.tsx`

Na interface `JobRow`, adicionar:

```typescript
  empresa_id: string;
  empresa_nome: string | null;
```

Adicionar prop:

```typescript
export function JobsList({ rows, empresas }: {
  rows: JobRow[];
  empresas: { id: string; razao_social: string; nome_fantasia: string | null }[];
}) {
```

Adicionar state e filtro:

```typescript
  const [empresaFiltro, setEmpresaFiltro] = React.useState<string>("todas");

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusAtivos.size > 0 && !statusAtivos.has(r.status)) return false;
      if (empresaFiltro !== "todas" && r.empresa_id !== empresaFiltro) return false;
      if (q === "") return true;
      return r.codigo.toLowerCase().includes(q) || r.nome.toLowerCase().includes(q);
    });
  }, [rows, statusAtivos, busca, empresaFiltro]);
```

No JSX dos filtros existentes, adicionar (imports `Select*` do shadcn/ui podem ser necessários — copiar de `projetos-list.tsx`):

```typescript
        <Select value={empresaFiltro} onValueChange={setEmpresaFiltro}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            avoidCollisions={false}
            className="w-[--radix-select-trigger-width]"
          >
            <SelectItem value="todas">Todas as empresas</SelectItem>
            {empresas.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nome_fantasia ?? e.razao_social}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
```

Na tabela, adicionar `<th>` "Empresa" no `<thead>` (por exemplo entre "Nome" e "Status") e a célula correspondente no `<tbody>`:

```typescript
                <td className="px-4 py-3">
                  {r.empresa_nome ? (
                    <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
                      {r.empresa_nome}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
```

Se houver `colSpan` no estado vazio, incrementar em 1.

- [ ] **Step 3: Verificar e commit**

Run: `pnpm typecheck && pnpm lint`

Smoke test: `/jobs` mostra coluna e filtro; filtrar pela 2ª empresa reduz a lista.

```powershell
git add app/(app)/jobs/page.tsx app/(app)/jobs/jobs-list.tsx
git commit -m "feat(jobs): badge e filtro por empresa na lista"
```

---

## Task 9: Exibir empresa no header do projeto e em modo leitura no detalhe do orçamento

**Files:**
- Modify: `app/(app)/orcamentos/[projetoId]/page.tsx` (header do projeto)
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx` (detalhe do orçamento)

**Nota sobre a lista de orçamentos dentro do projeto:** todos os orçamentos de um projeto compartilham a mesma empresa (garantido pelo trigger `enforce_empresa_from_projeto`). Portanto **não** faz sentido colocar badge ou filtro por empresa nessa lista — a informação já está no header do projeto (Step 1). Só o modo leitura no detalhe individual de um orçamento (Step 2) é útil, para deixar claro qual empresa emite o documento.

**Interfaces:**
- Consumes: `empresa` embed nas queries dessas páginas.
- Produces: badge "Empresa: X" visível junto aos outros metadados (cliente, responsável, regional).

- [ ] **Step 1: Header do projeto mostra empresa**

Modify: `app/(app)/orcamentos/[projetoId]/page.tsx`

Na query do projeto (que já traz `cliente`, `responsavel`, etc), incluir `empresa:empresas(id, razao_social, nome_fantasia)`.

No JSX do header, ao lado dos outros metadados (Cliente, Responsável, Regional), adicionar bloco Empresa:

```typescript
<div>
  <p className="text-xs uppercase tracking-wider text-muted-foreground">Empresa</p>
  <p className="text-sm font-medium">
    {projeto.empresa?.nome_fantasia ?? projeto.empresa?.razao_social ?? "—"}
  </p>
</div>
```

O layout exato varia com o header atual — manter consistente com como Cliente/Responsável são exibidos.

- [ ] **Step 2: Detalhe do orçamento mostra empresa (modo leitura)**

Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx`

Na query, incluir `empresa:empresas(nome_fantasia, razao_social)`. Renderizar como texto informativo no cabeçalho ("Empresa: California"), sem controle editável — trocar exige editar o projeto.

- [ ] **Step 3: Verificar e commit**

Run: `pnpm typecheck && pnpm lint`

Smoke test: entrar em um projeto pela lista, ver "Empresa" no header. Entrar em um orçamento desse projeto, ver "Empresa: X" em modo leitura.

```powershell
git add app/(app)/orcamentos/[projetoId]/page.tsx app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx
git commit -m "feat(projetos): exibe empresa no header do projeto e do orçamento"
```

---

## Task 10: Verificação final

**Files:** nenhum modificado. Task de gate para garantir que nada regrediu.

**Interfaces:** valida tudo produzido pelas tasks 1–9 conjuntamente.

- [ ] **Step 1: `pnpm typecheck && pnpm lint && pnpm build`**

Expected: tudo verde. Se `build` reclamar de rota nova, é sinal de import quebrado — corrigir e re-rodar.

- [ ] **Step 2: Migration limpa em banco novo**

Run (num ambiente descartável, ou copia local): `pnpm supabase db reset`

Expected: todas as migrations aplicam sem erro, e as verificações SQL da Task 1 Step 6 continuam válidas.

- [ ] **Step 3: Trilha de auditoria**

Rodar no SQL Editor após executar CRUD manual em `/admin/empresas`:

```sql
select acao, entidade_id, metadata, created_at
  from public.audit_events
 where entidade_tipo = 'empresa'
 order by created_at desc
 limit 20;
```

Expected: eventos `empresa.criada`, `empresa.atualizada`, `empresa.principal_alterada`, `empresa.desativada`, `empresa.reativada` conforme as ações feitas na UI.

- [ ] **Step 4: RLS — usuário não-admin não escreve**

Como usuário com role `gestao_projetos` (não admin), tentar chamar `criarEmpresa` via curl/console. Expected: retorna `ok:false` porque `requireAdmin` redireciona.

Direto no banco (como o usuário não-admin, via SQL Editor "impersonate"): tentar `insert into public.empresas ...`. Expected: erro de RLS (`row-level security`).

- [ ] **Step 5: Performance sanity check**

Abrir `/orcamentos` com DevTools > Network. Confirmar:
- Página carrega em < 1s (queries em `Promise.all`).
- Não há N+1 nas listas (uma query pra projetos, uma pra orçamentos-count, uma pra empresas).

Aplicar checklist de `docs/PERFORMANCE.md`:
- ✅ Nenhum embed pesado (`select("...")` seleciona só o necessário).
- ✅ Índice em `empresa_id` presente (Task 1).
- ✅ Policies novas usam `(select auth.uid())`.
- ✅ `<Link>` da lista continua com `prefetch={false}`.

- [ ] **Step 6: Atualizar `HANDOFF.md` (se existir)**

Se o projeto mantém `docs/HANDOFF.md`, incluir uma linha:

> Task 009: empresas (múltiplos CNPJs por tenant) — em `/admin/empresas`. Projeto/orçamento/job agora exigem empresa; California Salvador é a principal.

- [ ] **Step 7: Commit final (se houve mudança em HANDOFF)**

```powershell
git add docs/HANDOFF.md
git commit -m "docs: registra task 009 (empresas) no handoff"
```
