# Empresas Contábeis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir a dimensão contábil (PJ real, definida por CNPJ) separada da dimensão gerencial existente, ancorada nas contas bancárias, e refletir isso nas telas afetadas.

**Architecture:** Nova tabela `empresas_contabeis` (3 PJs: California LTDA, Hitlab LTDA, GoCrazy LTDA). `contas_bancarias` ganha `empresa_contabil_id NOT NULL` referenciando essa tabela; a coluna gerencial `empresa_id` fica intocada (já é vestígio desde 09/09/2026 e é referenciada por 19 RPCs de baixa — reescrevê-los sai do escopo mínimo). Lançamentos financeiros não mudam de schema — a contábil é sempre derivada da conta bancária via join. View `vw_lancamentos_com_contabil` facilita relatórios.

**Tech Stack:** Postgres (Supabase), Next.js App Router, React, TypeScript, Tailwind, shadcn/ui, Zod, BrasilAPI (validação/preenchimento de CNPJ — já usado em fornecedores).

**Spec:** [docs/superpowers/specs/2026-09-11-empresas-contabeis-design.md](../specs/2026-09-11-empresas-contabeis-design.md)

## Global Constraints

- Toda migration nova: GRANT explícito pra `authenticated`, nada pra `anon`, RLS com `(select auth.uid())`, índice em FK importante.
- `lib/types.ts` é escrito à mão; qualquer coluna nova/removida entra no mesmo commit do frontend que a consome.
- Strings visíveis ao usuário em pt-BR com acentos completos ("Empresa Contábil", "Razão social", "Não encontrado").
- Migrations com prefixo `YYYYMMDDNNNNNN_snake_case.sql` e comentário no topo com racional. Aplicar via MCP (`apply_migration`), depois conferir via MCP.
- Estrutura de novas migrations começa em `20260911200001_...` (última existente é `20260911100001`).
- Toda mudança destrutiva pede confirmação explícita do Daniel antes de aplicar.
- Backfill que preenche coluna vazia é aditivo. Backfill que sobrescreve valor existente é destrutivo.
## ⚠️ Divergências do spec (revisar antes de executar)

**1. Drop de `contas_bancarias.empresa_id` — REMOVIDO do plano.**
O spec (e sua aprovação explícita) previa DROP COLUMN da coluna gerencial `empresa_id`, marcada como "vestígio" em 09/09/2026. A investigação encontrou dependências reais:
- **19 RPCs de baixa** (`baixa_pp`, `baixa_avulsa`, `dar_baixa_titulo`, `desembolso_rpcs`, `pp_verba_rpcs_devolucao`, `dar_baixa_fatura_cartao` e outros) que fazem `if v_conta.empresa_id <> v_<algo>.empresa_id` — hoje código morto porque a coluna é sempre NULL, mas o SELECT quebra se a coluna sumir.
- **Trigger `sincronizar_conta_do_cartao`** que copia `empresa_id` do cartão pra conta-espelho.
- **2 policies RLS** (`contas_bancarias_select`, `contas_bancarias_modify`) que checam a coluna.

Reescrever tudo isso é um esforço grande e ortogonal ao objetivo desta frente (separar contábil de gerencial). Decisão: **manter `empresa_id` como está** (vestígio já documentado, NULL em toda conta nova). Se você quiser executar o drop no futuro, vira plano próprio. Se quiser incluir agora, avisa que eu re-desenho.

**2. Coluna "Contábil" e filtro em telas de lançamento — MOVIDO pra roadmap.**
O spec previa adicionar coluna e filtro por contábil nas telas transacionais de lançamento e nos relatórios. Deixei fora do plano porque: (a) o backend já entrega o suporte (view `vw_lancamentos_com_contabil`, tipo `EmpresaContabil`); (b) as telas afetadas variam bastante — Contas a Pagar, Contas a Receber, Fluxo de Caixa, Conciliação, Desembolsos, Faturamentos — e cada uma tem peculiaridades de query e filtros. Fazer tudo aqui inflaria o plano em ~10 tasks de UI incremental. Proposta: virar plano separado ("Financeiro — segmentação por contábil"), executado quando a operação sentir falta. Se você quiser incluir pelo menos uma tela agora (ex: Fluxo de Caixa), me diz qual e eu adiciono.

---

## Mapa de arquivos

**Banco (novas migrations):**
- `supabase/migrations/20260911200001_empresas_contabeis_tabela.sql` — cria tabela, RLS, policies, grants, índices
- `supabase/migrations/20260911200002_empresas_contabeis_seed.sql` — insere as 3 PJs pra tenant California
- `supabase/migrations/20260911200003_contas_bancarias_empresa_contabil.sql` — adiciona coluna (nullable), índice
- `supabase/migrations/20260911200004_sincronizar_conta_do_cartao_com_contabil.sql` — ajusta trigger pra popular `empresa_contabil_id` da conta-espelho do cartão
- `supabase/migrations/20260911200005_contas_bancarias_empresa_contabil_not_null.sql` — depois do backfill, torna NOT NULL
- `supabase/migrations/20260911200006_vw_lancamentos_com_contabil.sql` — view helper

**Backfill:**
- Executado via MCP (`execute_sql`/`apply_migration`) em passos, entre as migrations 3 e 5. Contas ambíguas são listadas e resolvidas manualmente com o Daniel.

**Tipos:**
- `lib/types.ts` — adiciona `EmpresaContabil`, ajusta `ContaBancaria`

**Validações:**
- `lib/validations/empresas-contabeis.ts` (novo) — schema Zod pra criar/editar
- `lib/validations/contas-bancarias.ts` (existente) — adiciona `empresa_contabil_id`

**UI (empresas contábeis — aba em Admin › Empresas):**
- `app/(app)/admin/empresas/contabeis/actions.ts` (novo) — server actions criar/editar/ativar/desativar
- `app/(app)/admin/empresas/contabeis/empresa-contabil-card.tsx` (novo)
- `app/(app)/admin/empresas/contabeis/empresa-contabil-drawer.tsx` (novo)
- `app/(app)/admin/empresas/contabeis/types.ts` (novo) — `EmpresaContabilRow`
- `app/(app)/admin/empresas/tabs.tsx` (novo) — client component com as duas abas ("Gerenciais", "Contábeis")
- `app/(app)/admin/empresas/page.tsx` (modificar) — passa a renderizar `<Tabs>` no lugar da lista direta

**UI (contas bancárias — dropdown obrigatório):**
- `app/(app)/financeiro/cadastros/contas-bancarias/conta-bancaria-drawer.tsx` (modificar) — adiciona select "Empresa Contábil"
- `app/(app)/financeiro/cadastros/contas-bancarias/actions.ts` (modificar) — recebe e grava `empresa_contabil_id`
- `app/(app)/financeiro/cadastros/contas-bancarias/contas-bancarias-list.tsx` (modificar) — mostra coluna "Contábil"
- `app/(app)/financeiro/cadastros/contas-bancarias/page.tsx` (modificar) — carrega e passa `empresas_contabeis` ativas pro drawer

---

### Task 1: Criar tabela `empresas_contabeis` com RLS, policies, grants e índices

**Files:**
- Create: `supabase/migrations/20260911200001_empresas_contabeis_tabela.sql`

**Interfaces:**
- Produces: tabela `public.empresas_contabeis (id uuid pk, tenant_id uuid, razao_social text, nome_fantasia text, cnpj text, ativo bool, created_at, updated_at, created_by uuid)`, unique `(tenant_id, cnpj)`, RLS policies `empresas_contabeis_select` e `empresas_contabeis_modify` filtrando por `tenant_id in (select current_tenant_ids())`, GRANT `select, insert, update, delete` pra `authenticated`.

- [ ] **Step 1: Verificar via MCP que a tabela ainda não existe**

Executa via `mcp__supabase__execute_sql`:
```sql
select to_regclass('public.empresas_contabeis') as existe;
```
Esperado: `existe = null`. Se vier populado, PARAR e alinhar com o Daniel.

- [ ] **Step 2: Escrever a migration**

Cria `supabase/migrations/20260911200001_empresas_contabeis_tabela.sql`:

```sql
-- =====================================================================
-- Empresas contábeis: PJ real, definida por CNPJ, dona das contas
-- bancárias. Separada da tabela `empresas` (gerencial) porque a operação
-- da California tem 3 PJs contábeis (California LTDA, Hitlab LTDA,
-- GoCrazy LTDA) que não batem 1:1 com as empresas gerenciais (CCH é
-- gerencial e não tem CNPJ próprio; GoCrazy é contábil e não é
-- gerencial). Spec: docs/superpowers/specs/2026-09-11-empresas-contabeis-design.md
-- =====================================================================

create table public.empresas_contabeis (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  razao_social   text not null,
  nome_fantasia  text,
  cnpj           text not null,
  ativo          boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  constraint empresas_contabeis_cnpj_tenant_uk unique (tenant_id, cnpj),
  constraint empresas_contabeis_cnpj_digits_chk check (cnpj ~ '^[0-9]{14}$')
);

create index empresas_contabeis_tenant_ativo_idx
  on public.empresas_contabeis (tenant_id, ativo);

alter table public.empresas_contabeis enable row level security;

create policy empresas_contabeis_select
  on public.empresas_contabeis
  for select
  using (tenant_id in (select current_tenant_ids()));

create policy empresas_contabeis_modify
  on public.empresas_contabeis
  for all
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

grant select, insert, update, delete on public.empresas_contabeis to authenticated;

comment on table public.empresas_contabeis is
  'Pessoa jurídica contábil (CNPJ). Dona das contas bancárias. Distinta da tabela empresas (gerencial) — a California opera com 3 PJs contábeis que não batem 1:1 com as empresas gerenciais.';
```

- [ ] **Step 3: Aplicar via MCP**

Executar `mcp__supabase__apply_migration` com `name: "empresas_contabeis_tabela"` e o conteúdo do arquivo.

- [ ] **Step 4: Conferir via MCP que aplicou**

Executar via `mcp__supabase__execute_sql`:
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='empresas_contabeis'
order by ordinal_position;

select policyname, cmd from pg_policies
where schemaname='public' and tablename='empresas_contabeis';

select grantee, privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='empresas_contabeis';
```
Esperado: 9 colunas, 2 policies (`empresas_contabeis_select`, `empresas_contabeis_modify`), grants pra `authenticated` (SELECT/INSERT/UPDATE/DELETE) e nada pra `anon`.

- [ ] **Step 5: Commitar a migration**

```bash
git add supabase/migrations/20260911200001_empresas_contabeis_tabela.sql
git commit -m "feat(financeiro): cria tabela empresas_contabeis (PJ real por CNPJ)"
```

---

### Task 2: Seed das 3 PJs contábeis pra tenant California

**Files:**
- Create: `supabase/migrations/20260911200002_empresas_contabeis_seed.sql`

**Interfaces:**
- Consumes: tabela `empresas_contabeis` da Task 1.
- Produces: 3 linhas em `empresas_contabeis` pra tenant `d2a02c10-9c7e-4157-8dd5-84bbf5a7044c` (California) — California LTDA (19437976000154), Hitlab LTDA (04409741000181), GoCrazy LTDA (29943648000183). Todas ativas.

- [ ] **Step 1: Confirmar o tenant_id da California via MCP**

```sql
select id, nome from public.tenants;
```
Copiar o UUID que aparecer (esperado: `d2a02c10-9c7e-4157-8dd5-84bbf5a7044c` — se diferente, ajustar a migration).

- [ ] **Step 2: Escrever a migration de seed**

Cria `supabase/migrations/20260911200002_empresas_contabeis_seed.sql`:

```sql
-- =====================================================================
-- Seed inicial das 3 PJs contábeis do grupo California. Idempotente:
-- ON CONFLICT (tenant_id, cnpj) DO NOTHING. Se rodar em outro tenant no
-- futuro, ajustar o UUID.
-- =====================================================================

insert into public.empresas_contabeis
  (tenant_id, razao_social, nome_fantasia, cnpj, ativo)
values
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
   'CALIFÓRNIA FILMES E PUBLICIDADE LTDA', 'California', '19437976000154', true),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
   'HITLAB PRODUÇÃO MUSICAL LTDA',        'Hitlab',     '04409741000181', true),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
   'GO CRAZY CONSULTORIA E MARKETING LTDA','GoCrazy',   '29943648000183', true)
on conflict (tenant_id, cnpj) do nothing;
```

- [ ] **Step 3: Aplicar via MCP**

`mcp__supabase__apply_migration` com `name: "empresas_contabeis_seed"`.

- [ ] **Step 4: Conferir via MCP que as 3 linhas estão lá**

```sql
select id, razao_social, cnpj, ativo
from public.empresas_contabeis
where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
order by razao_social;
```
Esperado: 3 linhas, todas ativas, os 3 CNPJs presentes.

- [ ] **Step 5: Commitar**

```bash
git add supabase/migrations/20260911200002_empresas_contabeis_seed.sql
git commit -m "feat(financeiro): seed das 3 PJs contabeis (California, Hitlab, GoCrazy)"
```

---

### Task 3: Adicionar `empresa_contabil_id` (nullable) em `contas_bancarias` + índice

**Files:**
- Create: `supabase/migrations/20260911200003_contas_bancarias_empresa_contabil.sql`

**Interfaces:**
- Consumes: tabela `empresas_contabeis` da Task 1.
- Produces: coluna `contas_bancarias.empresa_contabil_id uuid references empresas_contabeis(id)`, nullable nesta migração (vira NOT NULL na Task 6, depois do backfill). Índice `contas_bancarias_empresa_contabil_id_idx`.

- [ ] **Step 1: Escrever a migration**

Cria `supabase/migrations/20260911200003_contas_bancarias_empresa_contabil.sql`:

```sql
-- =====================================================================
-- contas_bancarias ganha a dimensão contábil: qual PJ é dona da conta.
--
-- A coluna nasce nullable pra permitir o backfill em passos. Vira NOT
-- NULL na migration 20260911200005 depois do backfill fechar.
--
-- A coluna gerencial `empresa_id` fica INTOCADA — é vestígio desde
-- 09/09/2026 (comentário na coluna explica) e é referenciada por 19 RPCs
-- de baixa. Removê-la sai do escopo desta frente.
-- =====================================================================

alter table public.contas_bancarias
  add column empresa_contabil_id uuid references public.empresas_contabeis(id);

create index contas_bancarias_empresa_contabil_id_idx
  on public.contas_bancarias(empresa_contabil_id);

comment on column public.contas_bancarias.empresa_contabil_id is
  'PJ contábil (CNPJ) dona desta conta. Define contabilmente todo lançamento que passa pela conta. Vai virar NOT NULL depois do backfill (20260911200005).';
```

- [ ] **Step 2: Aplicar via MCP e conferir**

`mcp__supabase__apply_migration` com `name: "contas_bancarias_empresa_contabil"`. Depois:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='contas_bancarias'
  and column_name='empresa_contabil_id';

select indexname from pg_indexes
where schemaname='public' and tablename='contas_bancarias'
  and indexname='contas_bancarias_empresa_contabil_id_idx';
```
Esperado: coluna existe, nullable, tipo uuid; índice existe.

- [ ] **Step 3: Commitar**

```bash
git add supabase/migrations/20260911200003_contas_bancarias_empresa_contabil.sql
git commit -m "feat(financeiro): contas_bancarias ganha empresa_contabil_id (nullable)"
```

---

### Task 4: Backfill das contas conhecidas + listagem das ambíguas

Este é o único passo interativo: contas com nome ambíguo entram numa lista pro Daniel resolver manualmente antes de seguir.

**Files:**
- Nenhum arquivo commitado — só execução de SQL via MCP e conversa. Se sobrar backfill que valha a pena versionar (ex: script gerado), commitar em `supabase/migrations/20260911200004a_backfill_contas_bancarias.sql` com explicação.

**Interfaces:**
- Consumes: `empresa_contabil_id` (nullable) da Task 3, IDs das PJs da Task 2.
- Produces: 100% das contas ativas (não-cartão) com `empresa_contabil_id` preenchido, mapeadas conforme regra de nome + decisão manual pras ambíguas.

- [ ] **Step 1: Buscar os IDs das 3 PJs contábeis**

Via MCP:
```sql
select id, nome_fantasia, cnpj
from public.empresas_contabeis
where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
order by nome_fantasia;
```
Anotar os 3 UUIDs (California, Hitlab, GoCrazy) para uso nos steps seguintes.

- [ ] **Step 2: Rodar as 3 regras de nome em ordem (primeira que casa vence)**

Via MCP, substituindo `<ID_GOCRAZY>`, `<ID_HITLAB>`, `<ID_CALIFORNIA>` pelos UUIDs do step 1:

```sql
-- 1) GoCrazy primeiro (evita %Santander% pegar "Santander GoCrazy")
update public.contas_bancarias
   set empresa_contabil_id = '<ID_GOCRAZY>'
 where empresa_contabil_id is null
   and (nome ilike '%GoCrazy%' or nome ilike '%Go Crazy%');

-- 2) Hitlab
update public.contas_bancarias
   set empresa_contabil_id = '<ID_HITLAB>'
 where empresa_contabil_id is null
   and nome ilike '%Hitlab%';

-- 3) California (por último, restante que casa)
update public.contas_bancarias
   set empresa_contabil_id = '<ID_CALIFORNIA>'
 where empresa_contabil_id is null
   and nome ilike '%California%';
```

- [ ] **Step 3: Listar contas que sobraram sem empresa contábil**

```sql
select id, nome, banco, tipo, ativo, cartao_credito_id
from public.contas_bancarias
where empresa_contabil_id is null
order by nome;
```

Esperado: `Conta Teste`, `ZZ Teste Fatia 2` (mais qualquer conta-espelho de cartão que tenha `cartao_credito_id not null` — essas são tratadas pelo trigger na Task 5). **Se aparecer alguma conta operacional (não-teste, não-cartão) na lista, PARAR e listar pro Daniel resolver.**

- [ ] **Step 4: Resolver ambíguas com o Daniel**

Apresentar a lista do step 3 e perguntar em texto no chat qual PJ contábil atribuir a cada uma. Para as de teste, aplicar a decisão dele (por default: California, mas confirmar).

Aplicar as decisões via update pontual, e.g.:
```sql
update public.contas_bancarias
   set empresa_contabil_id = '<ID_ESCOLHIDO>'
 where id = '<ID_CONTA>';
```

- [ ] **Step 5: Confirmar que todas as contas não-cartão têm empresa contábil**

```sql
select count(*) filter (where empresa_contabil_id is null and cartao_credito_id is null) as sem_contabil_e_nao_cartao,
       count(*) filter (where cartao_credito_id is not null) as espelhos_de_cartao
from public.contas_bancarias;
```
Esperado: `sem_contabil_e_nao_cartao = 0`. As contas-espelho de cartão são tratadas na Task 5.

- [ ] **Step 6 (opcional): Versionar os UPDATEs em migration**

Se houver decisões manuais que valem histórico, commitar em `supabase/migrations/20260911200004a_backfill_contas_bancarias.sql` com os UPDATEs finais e comentário explicando cada decisão manual. Se todas foram cobertas pelas 3 regras de nome, pular.

- [ ] **Step 7 (só se houve step 6): Commitar**

```bash
git add supabase/migrations/20260911200004a_backfill_contas_bancarias.sql
git commit -m "feat(financeiro): backfill empresa_contabil_id nas contas existentes"
```

---

### Task 5: Ajustar trigger `sincronizar_conta_do_cartao` pra popular `empresa_contabil_id` da conta-espelho

O trigger cria/atualiza a conta-espelho do cartão. Como `contas_bancarias.empresa_contabil_id` vai virar NOT NULL na Task 6, o trigger precisa passar a preencher esse campo. Como `cartoes_credito` não tem `empresa_contabil_id` próprio, o trigger cai na PJ contábil marcada como "primeira ativa por razão social" — mesma lógica do fallback atual pra `empresa_id` gerencial.

**Files:**
- Create: `supabase/migrations/20260911200004_sincronizar_conta_do_cartao_com_contabil.sql`

**Interfaces:**
- Consumes: `empresas_contabeis` (Task 1), `contas_bancarias.empresa_contabil_id` (Task 3).
- Produces: função `public.sincronizar_conta_do_cartao()` atualizada, que passa a INSERT e UPDATE `empresa_contabil_id` na conta-espelho.

- [ ] **Step 1: Backfill dos espelhos de cartão existentes**

Antes de trocar o trigger, garantir que os espelhos já criados (existe 1 hoje: cartão "ZZ Teste Fatia 2") ganhem `empresa_contabil_id`. Via MCP:

```sql
select cb.id, cb.nome, cb.empresa_contabil_id, cb.cartao_credito_id
from public.contas_bancarias cb
where cb.cartao_credito_id is not null
  and cb.empresa_contabil_id is null;
```

Para cada linha, aplicar update com a PJ contábil decidida junto com o Daniel (padrão: primeira PJ ativa por razão social — California LTDA):

```sql
update public.contas_bancarias
   set empresa_contabil_id = '<ID_CALIFORNIA>'
 where id = '<ID_ESPELHO>';
```

- [ ] **Step 2: Escrever a migration**

Cria `supabase/migrations/20260911200004_sincronizar_conta_do_cartao_com_contabil.sql`:

```sql
-- =====================================================================
-- Trigger `sincronizar_conta_do_cartao` passa a preencher também o
-- `empresa_contabil_id` da conta-espelho. Como `cartoes_credito` não tem
-- essa coluna, cai na PJ contábil "primeira ativa por razão social" do
-- tenant — mesma lógica do fallback atual pra `empresa_id` gerencial.
-- Se no futuro o cartão precisar carregar a PJ contábil, adiciona lá.
-- =====================================================================

create or replace function public.sincronizar_conta_do_cartao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa_id uuid;
  v_empresa_contabil_id uuid;
begin
  -- Gerencial: mantém o comportamento anterior (vestígio).
  v_empresa_id := coalesce(
    new.empresa_id,
    (select id from empresas
      where tenant_id = new.tenant_id and ativo
      order by principal desc, razao_social
      limit 1)
  );

  -- Contábil: primeira PJ ativa do tenant, alfabética por razão social.
  select id into v_empresa_contabil_id
    from public.empresas_contabeis
   where tenant_id = new.tenant_id and ativo
   order by razao_social
   limit 1;

  if v_empresa_id is null then
    raise exception 'Nenhuma empresa (gerencial) ativa no tenant para ancorar a conta do cartão.';
  end if;

  if v_empresa_contabil_id is null then
    raise exception 'Nenhuma empresa contábil ativa no tenant para ancorar a conta do cartão.';
  end if;

  if tg_op = 'INSERT' then
    insert into public.contas_bancarias (
      tenant_id, empresa_id, empresa_contabil_id, nome, banco, tipo,
      saldo_inicial, saldo_inicial_data, ativo, cartao_credito_id, created_by
    ) values (
      new.tenant_id, v_empresa_id, v_empresa_contabil_id,
      new.nome, new.banco, 'cartao_credito',
      0, current_date, new.ativo, new.id, new.created_by
    );
    return new;
  end if;

  update public.contas_bancarias
     set nome                = new.nome,
         banco               = new.banco,
         empresa_id          = v_empresa_id,
         empresa_contabil_id = coalesce(empresa_contabil_id, v_empresa_contabil_id),
         ativo               = new.ativo,
         updated_at          = now()
   where cartao_credito_id = new.id;

  return new;
end;
$function$;
```

Detalhe: no UPDATE, o `coalesce(empresa_contabil_id, v_empresa_contabil_id)` preserva a PJ escolhida manualmente se alguém já tiver ajustado — o trigger não sobrescreve decisão explícita.

- [ ] **Step 3: Aplicar via MCP**

`mcp__supabase__apply_migration` com `name: "sincronizar_conta_do_cartao_com_contabil"`.

- [ ] **Step 4: Conferir a definição atualizada**

```sql
select pg_get_functiondef(oid)
from pg_proc
where proname = 'sincronizar_conta_do_cartao';
```
Esperado: a definição mostra `v_empresa_contabil_id` sendo calculada e usada no insert/update.

- [ ] **Step 5: Smoke test — inserir e depois deletar um cartão de teste**

Via MCP (usar tenant California e um user_id válido):

```sql
-- Cria cartão de teste
with novo as (
  insert into public.cartoes_credito (tenant_id, nome, banco, bandeira, ativo, dia_vencimento_fatura, dia_fechamento_fatura, created_by)
  values ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c','Teste Contabil','Banco Teste','visa',true, 10, 3, null)
  returning id
)
select cb.id, cb.nome, cb.empresa_contabil_id, ec.nome_fantasia
from novo n
join public.contas_bancarias cb on cb.cartao_credito_id = n.id
left join public.empresas_contabeis ec on ec.id = cb.empresa_contabil_id;
```
Esperado: 1 linha, `empresa_contabil_id` preenchido, `nome_fantasia` = "California" (ou a primeira PJ ativa alfabética).

Depois limpar:
```sql
delete from public.cartoes_credito
where nome = 'Teste Contabil'
  and tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
```
(o cascade do `cartoes_credito` cuida do espelho? Verificar. Se não cascatear, deletar `contas_bancarias where cartao_credito_id = <id>` antes.)

- [ ] **Step 6: Commitar**

```bash
git add supabase/migrations/20260911200004_sincronizar_conta_do_cartao_com_contabil.sql
git commit -m "feat(financeiro): trigger da conta-espelho do cartao preenche empresa_contabil_id"
```

---

### Task 6: Tornar `empresa_contabil_id` NOT NULL em `contas_bancarias`

Passo destrutivo leve: converte a coluna aditiva em obrigatória. Só roda depois de confirmar que todos os registros têm valor.

**Files:**
- Create: `supabase/migrations/20260911200005_contas_bancarias_empresa_contabil_not_null.sql`

**Interfaces:**
- Consumes: coluna `empresa_contabil_id` preenchida em 100% das linhas (Tasks 4 e 5).
- Produces: constraint NOT NULL na coluna.

- [ ] **Step 1: Confirmação explícita do Daniel**

Antes de aplicar, avisar em texto: "Vou aplicar `alter column empresa_contabil_id set not null` em `contas_bancarias`. Isso trava qualquer conta futura sem PJ contábil. OK aplicar?" Aguardar aprovação explícita.

- [ ] **Step 2: Verificar via MCP que não há nulls**

```sql
select count(*) as nulls
from public.contas_bancarias
where empresa_contabil_id is null;
```
Esperado: `nulls = 0`. Se houver, VOLTAR pras Tasks 4/5 e resolver antes.

- [ ] **Step 3: Escrever a migration**

Cria `supabase/migrations/20260911200005_contas_bancarias_empresa_contabil_not_null.sql`:

```sql
-- =====================================================================
-- Trava: toda conta bancária tem PJ contábil. Backfill fechado nas
-- migrations 200003 (aditiva), 200004 (trigger de cartão) e no processo
-- manual de 20260911 (Task 4 do plano).
-- =====================================================================

alter table public.contas_bancarias
  alter column empresa_contabil_id set not null;
```

- [ ] **Step 4: Aplicar via MCP e conferir**

`mcp__supabase__apply_migration` com `name: "contas_bancarias_empresa_contabil_not_null"`. Depois:

```sql
select is_nullable from information_schema.columns
where table_schema='public' and table_name='contas_bancarias'
  and column_name='empresa_contabil_id';
```
Esperado: `is_nullable = 'NO'`.

- [ ] **Step 5: Commitar**

```bash
git add supabase/migrations/20260911200005_contas_bancarias_empresa_contabil_not_null.sql
git commit -m "feat(financeiro): contas_bancarias.empresa_contabil_id vira NOT NULL"
```

---

### Task 7: Criar view `vw_lancamentos_com_contabil`

**Files:**
- Create: `supabase/migrations/20260911200006_vw_lancamentos_com_contabil.sql`

**Interfaces:**
- Consumes: `lancamentos_financeiros`, `contas_bancarias.empresa_contabil_id`, `empresas_contabeis`.
- Produces: view `public.vw_lancamentos_com_contabil` com todos os campos de `lancamentos_financeiros` + `empresa_contabil_id`, `empresa_contabil_razao_social`, `empresa_contabil_nome_fantasia`, `empresa_contabil_cnpj`.

- [ ] **Step 1: Escrever a migration**

Cria `supabase/migrations/20260911200006_vw_lancamentos_com_contabil.sql`:

```sql
-- =====================================================================
-- View helper: lançamento financeiro já com a PJ contábil resolvida por
-- join via conta bancária. Uso: relatórios que precisam segmentar por
-- contábil sem lembrar do join. Telas transacionais devem continuar
-- consultando lancamentos_financeiros direto (perf).
-- =====================================================================

create or replace view public.vw_lancamentos_com_contabil as
select
  lf.*,
  cb.empresa_contabil_id,
  ec.razao_social  as empresa_contabil_razao_social,
  ec.nome_fantasia as empresa_contabil_nome_fantasia,
  ec.cnpj          as empresa_contabil_cnpj
from public.lancamentos_financeiros lf
join public.contas_bancarias  cb on cb.id = lf.conta_bancaria_id
join public.empresas_contabeis ec on ec.id = cb.empresa_contabil_id;

grant select on public.vw_lancamentos_com_contabil to authenticated;
```

- [ ] **Step 2: Aplicar via MCP e conferir**

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='vw_lancamentos_com_contabil'
  and column_name like 'empresa_contabil%';
```
Esperado: 4 colunas (`empresa_contabil_id`, `_razao_social`, `_nome_fantasia`, `_cnpj`).

- [ ] **Step 3: Commitar**

```bash
git add supabase/migrations/20260911200006_vw_lancamentos_com_contabil.sql
git commit -m "feat(financeiro): view vw_lancamentos_com_contabil (helper de relatorios)"
```

---

### Task 8: Adicionar tipo `EmpresaContabil` e ajustar `ContaBancaria` em `lib/types.ts`

**Files:**
- Modify: `lib/types.ts` — logo antes de `// ---------- Task 011: contas_bancarias` adicionar `EmpresaContabil`; ajustar `ContaBancaria` pra incluir `empresa_contabil_id: string` (obrigatório).

**Interfaces:**
- Produces: `EmpresaContabil { id, tenant_id, razao_social, nome_fantasia, cnpj, ativo, created_at, updated_at }`; `ContaBancaria.empresa_contabil_id: string`.

- [ ] **Step 1: Adicionar `EmpresaContabil`**

No `lib/types.ts`, adicionar antes da seção `// ---------- Task 011: contas_bancarias (lançamentos_financeiros) ----------`:

```typescript
// ---------- Empresas contábeis (PJ real por CNPJ) ----------

/**
 * Pessoa jurídica contábil. Distinta de `empresas` (gerencial): a
 * California tem 3 PJs contábeis (California LTDA, Hitlab LTDA, GoCrazy
 * LTDA) que não batem 1:1 com as empresas gerenciais.
 *
 * Toda conta bancária pertence a uma PJ contábil (obrigatório).
 */
export interface EmpresaContabil {
  id: string;
  tenant_id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string; // sempre 14 dígitos, sem máscara
  ativo: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Ajustar `ContaBancaria`**

Editar o tipo `ContaBancaria` (linhas 1916-1942) pra adicionar `empresa_contabil_id: string` (obrigatório) logo após `tenant_id`:

```typescript
export interface ContaBancaria {
  id: string;
  tenant_id: string;
  /** PJ contábil (CNPJ) dona da conta. Obrigatório. */
  empresa_contabil_id: string;
  /** VESTÍGIO (09/09/2026)... [manter comentário atual] */
  empresa_id: string | null;
  // ...resto igual
}
```

- [ ] **Step 3: Rodar `tsc` pra ver o que quebra**

```bash
npx tsc --noEmit
```
Esperado: erros em qualquer lugar que instancia `ContaBancaria` sem `empresa_contabil_id`. Anotar arquivos afetados — provavelmente só server actions e alguns mocks/tests, se houver.

- [ ] **Step 4: Corrigir consumidores diretos**

Adicionar `empresa_contabil_id` em cada `select("...")` de `contas_bancarias` que retorne `ContaBancaria` (procurar por `.returns<ContaBancaria>` e `select("*"` em `contas_bancarias`). O `select("*")` já traz — só o `.select("id, nome, ...")` explícito precisa incluir.

- [ ] **Step 5: `tsc` limpo**

```bash
npx tsc --noEmit
```
Esperado: sem erros.

- [ ] **Step 6: Commitar (junto com o restante do frontend nas próximas tasks)**

Não commitar ainda — este arquivo entra no mesmo commit da task 12 (drawer de conta bancária) pra respeitar a regra "tipos e frontend no mesmo commit".

---

### Task 9: Criar schema Zod `empresas-contabeis` + ajustar schema de conta bancária

**Files:**
- Create: `lib/validations/empresas-contabeis.ts`
- Modify: `lib/validations/contas-bancarias.ts` — adicionar `empresa_contabil_id` como uuid obrigatório

**Interfaces:**
- Produces: `empresaContabilSchema` com { razao_social (min 3, max 200), nome_fantasia (max 120, opcional), cnpj (14 dígitos, checkDigit), ativo }. `cnpjSchema` reaproveita a validação de dígito de fornecedores se existir.

- [ ] **Step 1: Verificar se já existe helper de CNPJ**

```bash
grep -rn "validarCnpj\|cnpjValido\|cnpj.*length.*14" lib/validations/ lib/utils/
```
Se existir helper reutilizável (ex: `lib/utils/cnpj.ts`), usar. Se não, criar `lib/utils/cnpj.ts` com:

```typescript
export function apenasDigitosCnpj(v: string): string {
  return v.replace(/\D/g, "");
}

export function cnpjValido(cnpj: string): boolean {
  const c = apenasDigitosCnpj(cnpj);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  // Cálculo dos 2 dígitos verificadores
  const calc = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((acc, d, i) => acc + Number(d) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const d2 = calc(c.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}
```

- [ ] **Step 2: Criar `lib/validations/empresas-contabeis.ts`**

```typescript
import { z } from "zod";
import { apenasDigitosCnpj, cnpjValido } from "@/lib/utils/cnpj";

export const empresaContabilSchema = z.object({
  razao_social: z
    .string()
    .trim()
    .min(3, "Razão social é obrigatória.")
    .max(200, "Razão social muito longa."),
  nome_fantasia: z
    .string()
    .trim()
    .max(120, "Nome fantasia muito longo.")
    .optional()
    .or(z.literal("")),
  cnpj: z
    .string()
    .transform(apenasDigitosCnpj)
    .refine((v) => v.length === 14, "CNPJ deve ter 14 dígitos.")
    .refine(cnpjValido, "CNPJ inválido."),
});

export type EmpresaContabilInput = z.infer<typeof empresaContabilSchema>;
```

- [ ] **Step 3: Ajustar `lib/validations/contas-bancarias.ts`**

Adicionar `empresa_contabil_id` como uuid obrigatório no schema existente. Ler o arquivo primeiro e localizar o `z.object({...})` de conta bancária.

```typescript
empresa_contabil_id: z.string().uuid("Empresa contábil é obrigatória."),
```

- [ ] **Step 4: `tsc` limpo**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commitar (junto com actions na Task 10)**

Fica no commit do próximo passo pra amarrar validação + action.

---

### Task 10: Server actions de `empresas_contabeis` (criar, editar, ativar/desativar)

**Files:**
- Create: `app/(app)/admin/empresas/contabeis/actions.ts`

**Interfaces:**
- Consumes: `empresaContabilSchema` (Task 9), tabela `empresas_contabeis` (Task 1), `requireAdmin`, `logAuditEvent`, `createClient`.
- Produces: `criarEmpresaContabil(formData)`, `editarEmpresaContabil(id, formData)`, `inativarEmpresaContabil(id)`, `reativarEmpresaContabil(id)` — todos retornam `{ ok: true, id } | { ok: false, message, fieldErrors? }`.

- [ ] **Step 1: Criar o arquivo com as 4 actions**

Espelhar o padrão de `app/(app)/financeiro/cadastros/contas-bancarias/actions.ts`. Regra de permissão: admin (`requireAdmin`).

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import { empresaContabilSchema } from "@/lib/validations/empresas-contabeis";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function parseForm(formData: FormData) {
  return empresaContabilSchema.safeParse({
    razao_social: formData.get("razao_social")?.toString() ?? "",
    nome_fantasia: formData.get("nome_fantasia")?.toString() ?? "",
    cnpj: formData.get("cnpj")?.toString() ?? "",
  });
}

function mapDbError(msg: string): string {
  if (msg.includes("empresas_contabeis_cnpj_tenant_uk"))
    return "Já existe uma empresa contábil com esse CNPJ neste tenant.";
  if (msg.includes("empresas_contabeis_cnpj_digits_chk"))
    return "CNPJ inválido — deve ter 14 dígitos.";
  return "Não foi possível salvar a empresa contábil.";
}

export async function criarEmpresaContabil(formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos destacados.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("empresas_contabeis")
    .insert({
      tenant_id: session.activeTenant.id,
      razao_social: d.razao_social,
      nome_fantasia: d.nome_fantasia || null,
      cnpj: d.cnpj,
      created_by: session.profile.id,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[empresas_contabeis.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }
  await logAuditEvent({
    acao: "empresa_contabil.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "empresa_contabil",
    entidadeId: data.id,
    metadata: { razao_social: d.razao_social, cnpj: d.cnpj },
  });
  revalidatePath("/admin/empresas");
  return { ok: true, id: data.id };
}

export async function editarEmpresaContabil(id: string, formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos destacados.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;
  const supabase = createClient();
  const { error } = await supabase
    .from("empresas_contabeis")
    .update({
      razao_social: d.razao_social,
      nome_fantasia: d.nome_fantasia || null,
      cnpj: d.cnpj,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);
  if (error) {
    console.error("[empresas_contabeis.editar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }
  await logAuditEvent({
    acao: "empresa_contabil.atualizada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "empresa_contabil",
    entidadeId: id,
    metadata: { razao_social: d.razao_social, cnpj: d.cnpj },
  });
  revalidatePath("/admin/empresas");
  return { ok: true, id };
}

async function alterarAtivo(id: string, novoAtivo: boolean): Promise<ActionResult> {
  const session = await requireAdmin();
  const supabase = createClient();
  const { error } = await supabase
    .from("empresas_contabeis")
    .update({ ativo: novoAtivo, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);
  if (error) {
    console.error("[empresas_contabeis.ativo]", error.message);
    return { ok: false, message: "Não foi possível alterar." };
  }
  await logAuditEvent({
    acao: novoAtivo ? "empresa_contabil.reativada" : "empresa_contabil.desativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "empresa_contabil",
    entidadeId: id,
  });
  revalidatePath("/admin/empresas");
  return { ok: true, id };
}

export async function inativarEmpresaContabil(id: string) { return alterarAtivo(id, false); }
export async function reativarEmpresaContabil(id: string) { return alterarAtivo(id, true); }
```

- [ ] **Step 2: `tsc` limpo**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commitar (junto com Task 9)**

```bash
git add lib/utils/cnpj.ts lib/validations/empresas-contabeis.ts lib/validations/contas-bancarias.ts app/\(app\)/admin/empresas/contabeis/actions.ts
git commit -m "feat(financeiro): validacoes e actions de empresas_contabeis"
```

---

### Task 11: UI da aba "Contábeis" — card, drawer, tipos, tabs

**Files:**
- Create: `app/(app)/admin/empresas/contabeis/types.ts`
- Create: `app/(app)/admin/empresas/contabeis/empresa-contabil-card.tsx`
- Create: `app/(app)/admin/empresas/contabeis/empresa-contabil-drawer.tsx`
- Create: `app/(app)/admin/empresas/tabs.tsx`
- Modify: `app/(app)/admin/empresas/page.tsx` — carrega `empresas_contabeis` e renderiza dentro de `<Tabs>`

**Interfaces:**
- Consumes: server actions da Task 10, componentes shadcn/ui existentes (`Tabs`, `Dialog`, `Input`, `Label`, `Button`), padrão visual de `empresa-card.tsx` e `empresa-drawer.tsx` da tela atual.
- Produces: aba "Contábeis" com lista de PJs, botão "+ Nova empresa contábil" que abre drawer, cards com editar/ativar-desativar. Máscara de CNPJ e prefill via BrasilAPI (opcional, se `useBrasilApi` estiver disponível — reaproveitar padrão de fornecedores).

- [ ] **Step 1: Verificar se existe componente `Tabs` do shadcn/ui**

```bash
grep -rn "from \"@/components/ui/tabs\"" app/ components/ | head -5
```
Se sim, reusar. Se não, adicionar via shadcn CLI: `npx shadcn-ui@latest add tabs`.

- [ ] **Step 2: Criar `types.ts` da subpasta**

```typescript
import type { EmpresaContabil } from "@/lib/types";

export type EmpresaContabilRow = Pick<
  EmpresaContabil,
  "id" | "razao_social" | "nome_fantasia" | "cnpj" | "ativo"
>;
```

- [ ] **Step 3: Criar `empresa-contabil-drawer.tsx`**

Espelhar `empresa-drawer.tsx` existente (mesmo Dialog/DrawerContent, DialogHeader/Title), mas apenas com os 3 campos: razão social, nome fantasia, CNPJ. Máscara: `00.000.000/0000-00` (opcional; pode ser input livre + validação Zod que aceita máscara ou dígitos). Se `useBrasilApi` para CNPJ existir em fornecedores, importar e disparar preenchimento.

Referência de shape:
```typescript
type Props =
  | { mode: "criar"; trigger?: React.ReactNode }
  | { mode: "editar"; empresa: EmpresaContabilRow; trigger?: React.ReactNode };
```

Botão "Salvar" chama `criarEmpresaContabil` ou `editarEmpresaContabil` via `useTransition`, mesmo padrão do drawer de conta bancária.

- [ ] **Step 4: Criar `empresa-contabil-card.tsx`**

Card compacto: nome fantasia (fallback razão social) em destaque, CNPJ formatado (`00.000.000/0000-00`), badge de "Inativa" se aplicável, botões Editar (abre drawer editar) e Inativar/Reativar. Layout inspirado no `empresa-card.tsx`.

- [ ] **Step 5: Criar `tabs.tsx`**

Client component que recebe:
```typescript
type Props = {
  empresasGerenciais: React.ReactNode; // conteúdo já renderizado
  empresasContabeis: React.ReactNode;
};
```
E renderiza `<Tabs defaultValue="gerenciais">` com dois `<TabsContent>`.

- [ ] **Step 6: Ajustar `page.tsx`**

Adicionar Promise.all extra pra carregar `empresas_contabeis`:

```typescript
supabase
  .from("empresas_contabeis")
  .select("id, razao_social, nome_fantasia, cnpj, ativo")
  .eq("tenant_id", tenantId)
  .order("ativo", { ascending: false })
  .order("razao_social", { ascending: true }),
```

E renderizar dentro do `<TabsProvider>` com os cards `<EmpresaContabilCard>` na aba "Contábeis" e o drawer "+ Nova empresa contábil" no header dessa aba.

- [ ] **Step 7: Rodar dev e testar visualmente**

```bash
npm run dev
```
Abrir `/admin/empresas`, alternar entre as abas, criar/editar/desativar/reativar uma empresa contábil de teste (depois deletar via SQL se for lixo).

- [ ] **Step 8: `npm run build` limpo**

```bash
npm run build
```

- [ ] **Step 9: Commitar**

```bash
git add app/\(app\)/admin/empresas/
git commit -m "feat(admin): tela de empresas contabeis (aba em Admin > Empresas)"
```

---

### Task 12: Contas bancárias — dropdown "Empresa Contábil" obrigatório + coluna na listagem

**Files:**
- Modify: `lib/types.ts` — commit dos ajustes da Task 8 vem aqui, junto
- Modify: `app/(app)/financeiro/cadastros/contas-bancarias/page.tsx` — carrega `empresas_contabeis` ativas, passa pro drawer
- Modify: `app/(app)/financeiro/cadastros/contas-bancarias/conta-bancaria-drawer.tsx` — Select "Empresa Contábil" obrigatório, controlado
- Modify: `app/(app)/financeiro/cadastros/contas-bancarias/actions.ts` — recebe e grava `empresa_contabil_id`; valida com o schema atualizado
- Modify: `app/(app)/financeiro/cadastros/contas-bancarias/contas-bancarias-list.tsx` — mostra coluna "Contábil" (nome_fantasia com fallback razao_social)

**Interfaces:**
- Consumes: `EmpresaContabil` (Task 8), `contaBancariaSchema` atualizado (Task 9), tabela `empresas_contabeis` (Task 1).
- Produces: cadastro/edição de conta bancária exige `empresa_contabil_id`; listagem mostra a PJ contábil ao lado de cada conta.

- [ ] **Step 1: Ajustar `page.tsx`**

Adicionar segunda query em Promise.all:
```typescript
const [contasRes, contabeisRes] = await Promise.all([
  supabase.from("contas_bancarias").select("*")./* etc */,
  supabase
    .from("empresas_contabeis")
    .select("id, razao_social, nome_fantasia")
    .eq("tenant_id", session.activeTenant.id)
    .eq("ativo", true)
    .order("razao_social"),
]);
```
Passar `empresasContabeis={contabeisRes.data ?? []}` pro `<ContasBancariasList>`.

- [ ] **Step 2: Ajustar `contas-bancarias-list.tsx`**

Adicionar prop `empresasContabeis: Array<{id, razao_social, nome_fantasia|null}>`. Passar pro `<ContaBancariaDrawer>`. Renderizar coluna "Contábil" mostrando `empresa.nome_fantasia ?? empresa.razao_social` (lookup via id → map criado a partir do array).

- [ ] **Step 3: Ajustar `conta-bancaria-drawer.tsx`**

Adicionar prop `empresasContabeis`. Adicionar estado `const [empresaContabilId, setEmpresaContabilId] = React.useState<string>(conta?.empresa_contabil_id ?? "")`. Adicionar bloco de Select antes do campo "Tipo":

```tsx
<div className="space-y-2">
  <Label htmlFor="empresa_contabil_id">Empresa contábil *</Label>
  <Select value={empresaContabilId} onValueChange={setEmpresaContabilId} required>
    <SelectTrigger id="empresa_contabil_id">
      <SelectValue placeholder="Selecione a PJ dona da conta" />
    </SelectTrigger>
    <SelectContent>
      {empresasContabeis.map((e) => (
        <SelectItem key={e.id} value={e.id}>
          {e.nome_fantasia ?? e.razao_social}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
  {fieldErrors.empresa_contabil_id?.map((msg, i) => (
    <p key={i} className="text-xs text-california-red">{msg}</p>
  ))}
</div>
```

Reset no `useEffect` de abertura + injetar no FormData no submit:
```typescript
formData.set("empresa_contabil_id", empresaContabilId);
```

- [ ] **Step 4: Ajustar `actions.ts`**

No `parsed` de `criarContaBancaria` e `editarContaBancaria`, ler `empresa_contabil_id`:
```typescript
empresa_contabil_id: formData.get("empresa_contabil_id")?.toString() ?? "",
```
No `insert`, adicionar `empresa_contabil_id: d.empresa_contabil_id,`. No `update`, adicionar `empresa_contabil_id: d.empresa_contabil_id,`. Adicionar tratamento de erro pra caso de FK inválido (chave contábil de outro tenant).

- [ ] **Step 5: `tsc` + build limpos**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 6: Smoke test**

```bash
npm run dev
```
Em `/financeiro/cadastros/contas-bancarias`:
- Criar nova conta — o select "Empresa contábil" aparece, é obrigatório, e depois de salvar a listagem mostra a coluna.
- Editar conta existente — o dropdown vem preenchido, mudar salva.
- Tentar submeter sem escolher — validação do Zod bloqueia.

- [ ] **Step 7: Commitar**

```bash
git add lib/types.ts app/\(app\)/financeiro/cadastros/contas-bancarias/
git commit -m "feat(financeiro): conta bancaria exige e mostra empresa contabil"
```

---

### Task 13: Documentar decisões e verificar advisories

**Files:**
- Modify: `docs/HANDOFF.md` (se existir e for o fluxo do time) — adicionar 1-2 linhas sobre a nova dimensão contábil
- Modify: `docs/09-identidade-visual-ui.md` ou análogo — só se algum padrão visual novo entrou (não deve entrar; reusa Tabs padrão)

**Interfaces:** documentação atualizada + verificação MCP de advisories de segurança/performance sobre a nova tabela.

- [ ] **Step 1: Rodar advisor de segurança**

Via MCP: `mcp__supabase__get_advisors` com `type: "security"`. Ler advisories novos que mencionem `empresas_contabeis` ou `vw_lancamentos_com_contabil`.

- [ ] **Step 2: Rodar advisor de performance**

`mcp__supabase__get_advisors` com `type: "performance"`. Idem.

- [ ] **Step 3: Resolver o que for aplicável**

Se aparecer aviso de RLS na view ou de índice faltando, criar migration corretiva. Views geralmente não têm RLS (herdam da tabela base) — confirmar que o advisor não está pedindo `security_invoker=on` na view. Se pedir, ajustar em migration nova:

```sql
alter view public.vw_lancamentos_com_contabil set (security_invoker = on);
```

- [ ] **Step 4: Atualizar HANDOFF**

Ler `docs/HANDOFF.md` (se existir). Adicionar bullet: "Dimensão contábil (PJ com CNPJ) separada de gerencial. Fonte: `empresas_contabeis`. Conta bancária define a PJ contábil de todo lançamento que passa por ela."

- [ ] **Step 5: Commitar**

```bash
git add docs/HANDOFF.md supabase/migrations/  # se houve migration corretiva
git commit -m "docs(financeiro): registra dimensao contabil no handoff"
```

---

## Fora deste plano (roadmap)

- **Coluna "Contábil" nas telas de lançamento financeiro / relatórios existentes** — o backend já dá suporte (view pronta). As telas afetadas variam bastante e devem ser feitas caso a caso, em plano separado, quando a demanda surgir. Sem isso, os relatórios continuam funcionando; só não segmentam por contábil.
- **Formulário de lançamento mostrando a PJ contábil ao selecionar conta** — mesmo ponto acima.
- **Adicionar `empresa_contabil_id` em `cartoes_credito`** — hoje o trigger cai no fallback (primeira PJ ativa). Se surgir demanda de "cada cartão pertence a uma PJ contábil específica", vira plano.
- **DROP de `contas_bancarias.empresa_id`** — 19 RPCs de baixa dependem. Vira plano separado só se houver ganho real além da limpeza semântica.
- **DRE contábil / apuração por PJ** — a base está pronta (view `vw_lancamentos_com_contabil`). Fora do MVP do financeiro.
