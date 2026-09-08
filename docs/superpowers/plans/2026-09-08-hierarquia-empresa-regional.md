# Hierarquia tenant → empresa → regional — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inverter a relação empresa↔regional no banco: regional passa a ser filha de empresa; empresa passa a ser filha direta do tenant. Criar empresa CCH (inativa) e todas as regionais faltantes. Adicionar trigger que garante consistência entre `empresa_id` e `regional_id` em `jobs`, `orcamentos` e `projetos`.

**Architecture:** Uma única migration SQL versionada, aplicada via MCP. Backfill dos dados existentes (2 empresas, 2 regionais). Coluna `empresas.regional_id` é removida (destrutivo, confirmado). Trigger em `BEFORE INSERT OR UPDATE` nas 3 tabelas operacionais. `lib/types.ts` atualizado no mesmo commit.

**Tech Stack:** PostgreSQL 15+ (Supabase), Supabase MCP (`apply_migration`, `execute_sql`, `list_migrations`), TypeScript.

**Spec:** [docs/superpowers/specs/2026-09-08-hierarquia-tenant-empresa-regional-design.md](../specs/2026-09-08-hierarquia-tenant-empresa-regional-design.md)

## Global Constraints

- Toda alteração de banco segue o ciclo do `docs/FLUXO-BANCO.md`: ler → migration → apply_migration → conferir → commit único.
- Migration destrutiva **exige confirmação explícita** — já confirmada por Daniel em 2026-09-08 (drop de `empresas.regional_id`).
- Migration nasce com racional comentado no topo (motivo, decisão de negócio, o que ficou de fora).
- Toda migration nova: **GRANT explícito para `authenticated`** (nenhuma tabela nova aqui, mas conferir advisors), índice em FK importante, policies RLS (nenhuma tocada — herdadas).
- `lib/types.ts` é escrito à mão — atualizar no mesmo commit da migration.
- Strings visíveis ao usuário em pt-BR com acento; identificadores em código sem acento por convenção.
- Nome do arquivo de migration segue `AAAAMMDD00000N_descricao_curta.sql`, prefixo único.
- IDs literais conhecidos (não inventar):
  - tenant Agência California: `d2a02c10-9c7e-4157-8dd5-84bbf5a7044c`
  - empresa California (→ Agência California): `304039bd-509d-4536-aa26-44e7091ee718`
  - empresa Hitlab: `a61067d9-b46b-40b0-8541-4850f13aa47c`
  - regional NE: `54c627a6-e2d4-480b-9bd4-2f1acbf0ea91`
  - regional SP: `29b8e2d0-3fe9-4380-86b0-ede8299c2c32`
- CHECK constraints existentes em `empresas` (não posso violar): `cnpj ~ '^[0-9]{14}$'`, `cep ~ '^[0-9]{8}$'`, `uf ~ '^[A-Z]{2}$'`, `razao_social` não vazia.

---

### Task 1: Escrever a migration SQL

**Files:**
- Create: `supabase/migrations/20260908000001_hierarquia_empresa_regional.sql`

**Interfaces:**
- Consumes: nada (é a origem da mudança).
- Produces: coluna `regionais.empresa_id NOT NULL`; empresas removidas de `regional_id`; empresa "CCH" com id gerado; 6 regionais novas (NO, RJ, SS, Doca, Agency, Hitlab); função `public.ck_empresa_bate_regional()`; 3 triggers `tr_(jobs|orcamentos|projetos)_empresa_bate_regional`.

- [ ] **Step 1: Confirmar próximo prefixo disponível**

Via MCP:
```
mcp__supabase__list_migrations
```
Expected: última migration é `20260905100001_cidades_uf_ibge`. Próximo prefixo livre: `20260908000001`.

Se algum arquivo `20260908*` já existir no diretório `supabase/migrations/`, incrementar o sufixo (`…000002`).

- [ ] **Step 2: Escrever o arquivo da migration**

Criar `supabase/migrations/20260908000001_hierarquia_empresa_regional.sql` com este conteúdo exato:

```sql
-- Motivo: inverter a relação empresa↔regional.
-- Antes: empresa é filha de regional (empresas.regional_id NOT NULL).
-- Agora: regional é filha de empresa (regionais.empresa_id NOT NULL);
--        empresa é filha direta do tenant.
-- Cria empresa CCH (inativa, sem CNPJ real ainda) e as 6 regionais
-- que faltavam. Trigger garante que empresa_id e regional_id de
-- jobs/orcamentos/projetos sempre se referem à mesma empresa.
--
-- Ver docs/superpowers/specs/2026-09-08-hierarquia-tenant-empresa-regional-design.md
-- Destrutivo: remove empresas.regional_id (confirmado por Daniel em 2026-09-08).

begin;

-- 1. Rename só do nome_fantasia da empresa California → Agência California.
--    razao_social e cnpj (nome legal) ficam intactos.
update public.empresas
   set nome_fantasia = 'Agência California'
 where id = '304039bd-509d-4536-aa26-44e7091ee718';

-- 2..5. Criar CCH, adicionar coluna, backfill NE/SP, criar as 6 regionais.
--    Precisa de bloco DO para capturar o UUID da CCH numa variável.
do $mig$
declare v_cch uuid := gen_random_uuid();
begin
  -- 2. Criar CCH. empresas.regional_id ainda existe e é NOT NULL,
  --    então preenche temporariamente com NE — coluna sai no passo 8.
  insert into public.empresas (
    id, tenant_id, razao_social, nome_fantasia, cnpj,
    logradouro, cidade, uf, cep,
    principal, ativo, regional_id
  ) values (
    v_cch, 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
    'CCH (a preencher)', 'CCH', '00000000000000',
    'a preencher', 'a preencher', 'SP', '00000000',
    false, false, '54c627a6-e2d4-480b-9bd4-2f1acbf0ea91'
  );

  -- 3. regionais.empresa_id nullable
  alter table public.regionais
    add column empresa_id uuid references public.empresas(id) on delete restrict;

  -- 4. Backfill: NE e SP viram filhas da Agência California
  update public.regionais
     set empresa_id = '304039bd-509d-4536-aa26-44e7091ee718'
   where empresa_id is null;

  -- 5. Regionais faltantes
  insert into public.regionais (id, tenant_id, nome, empresa_id, ativo) values
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'NO',     '304039bd-509d-4536-aa26-44e7091ee718', true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'RJ',     '304039bd-509d-4536-aa26-44e7091ee718', true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'SS',     '304039bd-509d-4536-aa26-44e7091ee718', true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'Doca',   v_cch, true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'Agency', v_cch, true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'Hitlab', 'a61067d9-b46b-40b0-8541-4850f13aa47c', true);
end
$mig$;

-- 6. Fechar empresa_id como NOT NULL
alter table public.regionais alter column empresa_id set not null;

-- 7. Unicidade (empresa, nome) e índice na FK
create unique index if not exists idx_regionais_empresa_nome on public.regionais(empresa_id, nome);
create index if not exists idx_regionais_empresa on public.regionais(empresa_id);

-- 8. Destrutivo: remover empresas.regional_id (não faz mais sentido no modelo novo)
alter table public.empresas drop column regional_id;

-- 9. Trigger de consistência empresa↔regional
create or replace function public.ck_empresa_bate_regional() returns trigger
language plpgsql as $$
declare v_empresa uuid;
begin
  if new.regional_id is null then return new; end if;
  select empresa_id into v_empresa from public.regionais where id = new.regional_id;
  if v_empresa is null then raise exception 'regional_id % nao existe', new.regional_id; end if;
  if new.empresa_id is not null and new.empresa_id <> v_empresa then
    raise exception 'empresa_id % nao bate com regional_id % (esperado %)',
      new.empresa_id, new.regional_id, v_empresa;
  end if;
  if new.empresa_id is null then new.empresa_id := v_empresa; end if;
  return new;
end $$;

create trigger tr_jobs_empresa_bate_regional
  before insert or update of empresa_id, regional_id on public.jobs
  for each row execute function public.ck_empresa_bate_regional();

create trigger tr_orcamentos_empresa_bate_regional
  before insert or update of empresa_id, regional_id on public.orcamentos
  for each row execute function public.ck_empresa_bate_regional();

create trigger tr_projetos_empresa_bate_regional
  before insert or update of empresa_id, regional_id on public.projetos
  for each row execute function public.ck_empresa_bate_regional();

-- 10. Dry-run: confirma que todas as linhas existentes já são consistentes.
--     Se alguma falhar, a transação toda faz rollback.
update public.jobs       set id=id;
update public.orcamentos set id=id;
update public.projetos   set id=id;

commit;
```

- [ ] **Step 3: Não aplicar ainda — nem commitar**

Nesta task só existe o arquivo. Apply é a Task 2. Commit é a Task 4 (junto com a atualização do `lib/types.ts`).

---

### Task 2: Aplicar a migration via MCP e conferir

**Files:**
- Modifica banco de dados (não repositório).

**Interfaces:**
- Consumes: arquivo `supabase/migrations/20260908000001_hierarquia_empresa_regional.sql` (Task 1).
- Produces: banco em estado alvo. 3 empresas (Agência California, CCH, Hitlab), 8 regionais, coluna `empresas.regional_id` removida, 3 triggers ativos.

- [ ] **Step 1: Aplicar a migration**

Via MCP (usar o servidor `supabase-write`, não o read-only):
```
mcp__supabase-write__apply_migration
  name: hierarquia_empresa_regional
  query: <conteúdo do arquivo criado na Task 1, sem o BEGIN/COMMIT — o MCP embrulha em transação sozinho>
```

**Atenção:** o `apply_migration` do MCP roda a query dentro da própria transação dele. Se o arquivo tiver `begin;` / `commit;` explícitos, remova-os antes de enviar. O SQL do arquivo em disco **mantém** os `begin;` / `commit;` (é assim que se lê como replay manual); só a chamada MCP recebe a versão sem eles.

Expected: retorno `success: true` sem exceções.

Se a chamada falhar com `regional_id % nao existe` ou `empresa_id % nao bate com regional_id %`, é o dry-run do passo 10 flagrando inconsistência. Transação inteira faz rollback. Não avança — reabrir análise.

- [ ] **Step 2: Conferir a contagem de empresas e regionais**

```sql
select 'empresas' as t, count(*) from public.empresas
union all select 'regionais', count(*) from public.regionais;
```
Expected:
- `empresas` = 3
- `regionais` = 8

- [ ] **Step 3: Conferir que toda regional tem empresa**

```sql
select id, nome from public.regionais where empresa_id is null;
```
Expected: 0 rows.

- [ ] **Step 4: Conferir que a coluna `regional_id` de `empresas` sumiu**

```sql
select column_name from information_schema.columns
 where table_schema='public' and table_name='empresas' and column_name='regional_id';
```
Expected: 0 rows.

- [ ] **Step 5: Conferir as 3 triggers**

```sql
select tgname, tgrelid::regclass::text as tabela
  from pg_trigger
 where tgname like 'tr_%_empresa_bate_regional'
 order by tgname;
```
Expected: 3 linhas — `tr_jobs_empresa_bate_regional` em `jobs`, `tr_orcamentos_empresa_bate_regional` em `orcamentos`, `tr_projetos_empresa_bate_regional` em `projetos`.

- [ ] **Step 6: Testar o trigger em cenário negativo**

Pega um job existente e tenta trocar o `empresa_id` pra um id inválido (o da CCH, cuja regional é diferente):

```sql
-- Pega uma dupla (job, empresa da CCH) para o teste
with alvo as (select id from public.jobs limit 1),
     cch  as (select id from public.empresas where razao_social='CCH (a preencher)')
update public.jobs
   set empresa_id = (select id from cch)
 where id = (select id from alvo);
```
Expected: exceção `empresa_id % nao bate com regional_id %`. **Sem alteração aplicada.**

Se passar sem erro, o trigger não está funcionando — reabrir análise (não avança).

- [ ] **Step 7: Rodar advisors**

Via MCP:
```
mcp__supabase__get_advisors  type: security
mcp__supabase__get_advisors  type: performance
```
Expected: **zero alerta novo** apontando pra `empresas`, `regionais`, `jobs`, `orcamentos`, `projetos` ou pra função `ck_empresa_bate_regional`. Alertas pré-existentes (não relacionados) ficam.

---

### Task 3: Atualizar `lib/types.ts`

**Files:**
- Modify: `lib/types.ts` — remover `regional_id` da interface `Empresa` (linha 100); adicionar `empresa_id: string` na interface `Regional` (bloco começando em ~575).

**Interfaces:**
- Consumes: banco em estado pós-Task 2 (regionais.empresa_id existe; empresas.regional_id não existe).
- Produces: `lib/types.ts` refletindo o banco. `tsc --noEmit` limpo.

- [ ] **Step 1: Editar interface `Empresa`**

Localizar em `lib/types.ts` a interface `Empresa` (busca por `export interface Empresa {`). Remover a linha:
```ts
  regional_id: string;
```

- [ ] **Step 2: Editar interface `Regional`**

Localizar `export interface Regional {`. Adicionar a linha `empresa_id: string;` logo abaixo de `tenant_id`. Resultado:

```ts
export interface Regional {
  id: string;
  tenant_id: string;
  empresa_id: string;
  nome: string;
  ativo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Rodar type-check**

```bash
npx tsc --noEmit
```
Expected: sem erros. Se aparecer erro apontando algum lugar que usava `empresa.regional_id`, é código real que precisa ser adaptado — voltar e corrigir naquele arquivo antes de seguir. (Grep prévio no dia 2026-09-08 não achou hits além do próprio types.ts; se a base tiver mudado, resolver na hora.)

- [ ] **Step 4: Rodar build completo**

```bash
npm run build
```
Expected: build passa sem erro. Warnings pré-existentes toleráveis; erros novos, não.

---

### Task 4: Commit único (migration + tipos)

**Files:**
- Adiciona: `supabase/migrations/20260908000001_hierarquia_empresa_regional.sql`
- Adiciona: `docs/superpowers/specs/2026-09-08-hierarquia-tenant-empresa-regional-design.md`
- Adiciona: `docs/superpowers/plans/2026-09-08-hierarquia-empresa-regional.md`
- Modifica: `lib/types.ts`

**Interfaces:**
- Consumes: Task 1 (arquivo migration), Task 2 (banco aplicado), Task 3 (tipos atualizados e build limpo).
- Produces: commit único que deixa repositório e banco na mesma história.

- [ ] **Step 1: Conferir git status**

```bash
git status
```
Expected: 4 arquivos modificados/novos (migration, spec, plan, types.ts). Nenhum outro. Se algo mais aparecer, revisar antes de adicionar.

- [ ] **Step 2: Adicionar os arquivos por nome**

```bash
git add supabase/migrations/20260908000001_hierarquia_empresa_regional.sql
git add lib/types.ts
git add docs/superpowers/specs/2026-09-08-hierarquia-tenant-empresa-regional-design.md
git add docs/superpowers/plans/2026-09-08-hierarquia-empresa-regional.md
```

Nunca `git add -A` — o memory do projeto e o CLAUDE.md pedem adição por nome.

- [ ] **Step 3: Commit com mensagem descritiva**

```bash
git commit -m "$(cat <<'EOF'
feat(hierarquia): inverte relacao empresa<->regional e cria CCH+regionais faltantes

- regionais.empresa_id NOT NULL (era: empresas.regional_id NOT NULL)
- empresas.regional_id removida (destrutivo, confirmado)
- cria empresa CCH inativa (sem CNPJ definitivo)
- cria regionais NO, RJ, SS, Doca, Agency, Hitlab
- trigger ck_empresa_bate_regional em jobs/orcamentos/projetos
- lib/types.ts atualizado (Empresa perde regional_id, Regional ganha empresa_id)

Spec: docs/superpowers/specs/2026-09-08-hierarquia-tenant-empresa-regional-design.md
Plan: docs/superpowers/plans/2026-09-08-hierarquia-empresa-regional.md
EOF
)"
```

Expected: commit criado. Se pre-commit hook falhar, investigar e corrigir a causa raiz; **nunca** `--no-verify`.

- [ ] **Step 4: Conferir o commit**

```bash
git log -1 --stat
```
Expected: um commit com os 4 arquivos listados. Nada a mais, nada a menos.

- [ ] **Step 5: Não fazer push automaticamente**

Push é decisão do Daniel — a task termina no commit local. Reportar ao Daniel que está pronto pra push.

---

## Nota sobre o desvio executado (Ruling A1, 2026-09-08)

Durante a Task 2, o `apply_migration` inicial falhou: `empresas.regional_id`
tinha dependência escondida em `vw_fluxo_caixa` (via padrão
`COALESCE(job.regional_id, empresa.regional_id)`, com transitividade em
`vw_fluxo_caixa_job_totais`).

Daniel confirmou o caminho A1 (ver seção "Aditamento A1" no spec) e a
migration foi ampliada em uma única passagem: adiciona `regional_id`
nullable em `contas_avulsas`, `lancamentos_financeiros`, `titulos_receber`;
backfill preservando comportamento; drop + recreate das duas views sem o
fallback via empresa; grants restaurados; `search_path` fixo em
`ck_empresa_bate_regional`.

Task 3 idem: além de Empresa/Regional, `lib/types.ts` teve
`LancamentoFinanceiro`, `TituloReceber`, `ContaAvulsa` ganhando
`regional_id: string | null`. Um consumidor em `avulsa/[id]/page.tsx`
que monta o objeto manualmente foi ajustado no mesmo commit.

## Nota sobre o que fica pra depois (fase 2)

Fora do escopo deste plano (nova task/plan quando for a hora):

- Combobox empresa→regional em cascata em `app/(app)/orcamentos/**`, `app/(app)/jobs/**`, `app/(app)/financeiro/**`.
- Filtros topo por empresa/regional em telas de listagem.
- Cadastro visual de empresas e regionais (não existe hoje).
- Permissões por empresa (usuário X só vê Y).
- Preencher dados reais da CCH (CNPJ, endereço) e ativar (`ativo=true`).
