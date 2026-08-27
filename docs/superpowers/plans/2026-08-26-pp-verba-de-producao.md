# PP de Verba de Produção — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar o subtipo "Verba de Produção" ao Pedido de Produção — PP paga ao responsável (não a fornecedor), com prestação de contas imutável após pagamento e devolução do saldo não gasto como "título negativo" na aba Contas a Pagar.

**Architecture:** Extensão de `pedidos_compra` com flag `verba_producao` + `responsavel_verba_id` (fornecedor vira opcional via constraint condicional). Nova tabela `pp_verba_prestacoes` (+ anexos) registra a prestação. Nova tabela `pp_verba_devolucoes` gera o "título negativo" que entra na view `vw_a_pagar` como origem própria, com RPCs de baixa/estorno espelhando `dar_baixa_pp_parcela` / `estornar_baixa_pp_parcela`.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase Postgres + RLS, TypeScript, Tailwind + shadcn/ui, Zod. Sem framework de testes automatizados — verificação é via MCP (`list_tables`, `execute_sql`) + smoke test manual + `npm run build`.

**Spec:** [docs/superpowers/specs/2026-08-26-pp-verba-de-producao-design.md](../specs/2026-08-26-pp-verba-de-producao-design.md)

## Global Constraints

- **Fluxo do banco (CLAUDE.md + docs/FLUXO-BANCO.md):** toda migration nasce em `supabase/migrations/`, aplica pelo MCP (`apply_migration`), confere pelo MCP (`list_tables`, `execute_sql`), commit da migration junto do código que depende dela.
- **RLS + GRANT (regra transversal):** toda tabela nova tem RLS habilitada, policies usando `public.is_tenant_member(tenant_id)`, GRANT explícito para `authenticated`, nada para `anon`. Toda RPC nova nasce com `revoke execute ... from public` + `grant execute ... to authenticated`.
- **Performance (docs/PERFORMANCE.md):** índice em FK importante; policies RLS usam `(select auth.uid())`; queries do server component em `Promise.all`.
- **pt-BR (regra transversal):** toda string visível ao usuário com acentos e cedilha corretos ("Prestação de contas", "Devolução", "Responsável", "Não é possível").
- **Tipos manuais:** `lib/types.ts` é escrito à mão. Migration que mexe em coluna usada pelo frontend termina atualizando o tipo correspondente, no mesmo commit.
- **Enum `ADD VALUE`:** precisa migration separada e commit antes de ser usado em constraints/RPCs (padrão documentado em `20260820000007_desembolso_enum_lancamentos.sql`).
- **Escopo MVP fechado:** sem reabertura de prestação, sem NFs estruturadas, sem prestação parcial, sem bloqueio de "estouro" (bloqueia mesmo).

## File Structure

**Migrations (criar):**
- `supabase/migrations/20260826000001_pp_verba_producao_pp.sql` — extensão de `pedidos_compra`
- `supabase/migrations/20260826000002_pp_verba_prestacoes.sql` — `pp_verba_prestacoes` + anexos
- `supabase/migrations/20260826000003_pp_verba_rpc_prestacao.sql` — RPC `fechar_prestacao_verba_pp`
- `supabase/migrations/20260826000004_pp_verba_enum_lancamentos.sql` — `ADD VALUE` no enum `origem_lancamento`
- `supabase/migrations/20260826000005_pp_verba_devolucoes.sql` — `pp_verba_devolucoes` + FK em `lancamentos_financeiros`
- `supabase/migrations/20260826000006_pp_verba_rpcs_devolucao.sql` — RPCs de baixa e estorno da devolução
- `supabase/migrations/20260826000007_pp_verba_views.sql` — extensões de `vw_a_pagar` e `vw_fluxo_caixa`

**Tipos (modificar):**
- `lib/types.ts` — adicionar `verba_producao`, `responsavel_verba_id` no tipo da PP; adicionar `"pp_devolucao_verba"` a `OrigemTitulo`; adicionar labels; adicionar tipos das novas tabelas.

**UI de emissão (modificar):**
- `app/(app)/jobs/[jobId]/realizado/gerar-pp-drawer.tsx` — switch "Verba de Produção" + troca condicional Fornecedor ↔ Responsável.
- `app/(app)/jobs/[jobId]/realizado/actions-pp.ts` — validação e persistência dos novos campos; `dadosBaseSchema` ganha ramos condicionais.
- `app/(app)/jobs/[jobId]/realizado/painel-pps-item.tsx` (ou o server component ancestral que passa `fornecedores`) — passar também a lista de `profiles` do tenant como `responsaveis`.

**UI de prestação (criar):**
- `app/(app)/financeiro/contas-a-pagar/prestar-contas-dialog.tsx` — dialog client component
- `app/(app)/financeiro/contas-a-pagar/prestacao-verba-actions.ts` — server actions: `fecharPrestacaoVerba`, `signedUrlAnexoPrestacao`

**UI do detalhe da PP (modificar):**
- `app/(app)/financeiro/contas-a-pagar/pp-drawer-financeiro.tsx` — nova aba/seção "Prestação de contas" quando `verba_producao=true`, botão que abre o dialog, exibição readonly quando já prestada.

**Integração com Contas a Pagar (modificar):**
- `app/(app)/financeiro/contas-a-pagar/page.tsx` — fetch das devoluções em aberto, passar como `TituloRow` extra para `TitulosPagarList`.
- `app/(app)/financeiro/contas-a-pagar/titulos-pagar-list.tsx` — tratar `origem === "pp_devolucao_verba"` (badge, valor em verde, ação de baixa).
- `app/(app)/financeiro/contas-a-pagar/actions-titulos.ts` — `origemSchema` aceita `"pp_devolucao_verba"`, `darBaixaTitulo` dispatch pro novo RPC, `estornarBaixaTitulo` idem.

**Exibição em listas de PP (modificar):**
- `app/(app)/financeiro/contas-a-pagar/pedidos-compra-list.tsx` — badge "Verba" nas linhas onde `verba_producao=true`, mostrar responsável no lugar do fornecedor.
- Outras listas que exibem PP e mostram nome do fornecedor: verificar `pp-drawer-financeiro.tsx` e componentes correlatos.

---

### Task 1: Migration — extensão de `pedidos_compra` + tipos TS

Adiciona `verba_producao` e `responsavel_verba_id` a `pedidos_compra`, com constraint condicional que exige exatamente um par (fornecedor + sem responsável) OU (sem fornecedor + responsável). Aditiva: nenhuma PP existente viola porque `verba_producao` nasce `false` pelo default.

**Files:**
- Create: `supabase/migrations/20260826000001_pp_verba_producao_pp.sql`
- Modify: `lib/types.ts` (procurar tipo `PedidoCompra` ou similar; adicionar os dois campos)

**Interfaces:**
- Produces:
  - Coluna `pedidos_compra.verba_producao boolean not null default false`
  - Coluna `pedidos_compra.responsavel_verba_id uuid references profiles(id) on delete restrict` (nullable)
  - Coluna `pedidos_compra.fornecedor_id` agora nullable
  - Constraint `chk_pp_verba_producao_coerencia`
  - Índice parcial `idx_pp_responsavel_verba`
  - Campos correspondentes no tipo TS `PedidoCompra`

- [ ] **Step 1: Ler o estado atual da coluna via MCP**

Rodar `mcp__supabase__list_tables` (schema `public`, table `pedidos_compra`) e confirmar:
- `fornecedor_id` está `not null` hoje.
- Não existe coluna `verba_producao` nem `responsavel_verba_id`.

- [ ] **Step 2: Criar a migration**

Arquivo: `supabase/migrations/20260826000001_pp_verba_producao_pp.sql`

```sql
-- =====================================================================
-- PP de Verba de Produção — extensão de pedidos_compra
--
-- Verba de Produção é um subtipo de PP: em vez de pagar a um fornecedor,
-- a PP é paga a um responsável (profile do tenant) que fica com o dinheiro
-- e presta contas ao final. A regra de coerência ("verba ↔ tem responsável
-- e não tem fornecedor; não-verba ↔ tem fornecedor e não tem responsável")
-- vive numa CHECK — sem ela, o front esqueceria de trocar um campo pelo
-- outro em algum edge case e o banco aceitaria PP com os dois preenchidos.
--
-- Aditiva: verba_producao nasce false por default; PPs existentes já têm
-- fornecedor_id preenchido, então a constraint fecha para todas elas sem
-- backfill.
-- =====================================================================

alter table public.pedidos_compra
  add column if not exists verba_producao boolean not null default false,
  add column if not exists responsavel_verba_id uuid
    references public.profiles(id) on delete restrict;

-- fornecedor_id passa a ser opcional: nulo quando é verba. A CHECK abaixo
-- garante que sempre um dos dois lados esteja preenchido.
alter table public.pedidos_compra
  alter column fornecedor_id drop not null;

alter table public.pedidos_compra
  drop constraint if exists chk_pp_verba_producao_coerencia;

alter table public.pedidos_compra
  add constraint chk_pp_verba_producao_coerencia check (
    (verba_producao = true  and fornecedor_id is null     and responsavel_verba_id is not null)
    or
    (verba_producao = false and fornecedor_id is not null and responsavel_verba_id is null)
  );

create index if not exists idx_pp_responsavel_verba
  on public.pedidos_compra(responsavel_verba_id)
  where verba_producao = true;

comment on column public.pedidos_compra.verba_producao is
  'true quando esta PP é Verba de Produção: paga ao responsável em vez do fornecedor, com prestação de contas obrigatória depois de paga.';

comment on column public.pedidos_compra.responsavel_verba_id is
  'Profile do tenant que assume o dinheiro da verba. Obrigatório quando verba_producao=true; nulo caso contrário. Garantido pela chk_pp_verba_producao_coerencia.';
```

- [ ] **Step 3: Aplicar via MCP**

Rodar `mcp__supabase__apply_migration` com o conteúdo acima.

- [ ] **Step 4: Conferir via MCP**

Rodar `mcp__supabase__execute_sql`:
```sql
select column_name, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='pedidos_compra'
  and column_name in ('verba_producao','responsavel_verba_id','fornecedor_id')
order by column_name;

select conname from pg_constraint
where conrelid='public.pedidos_compra'::regclass
  and conname='chk_pp_verba_producao_coerencia';

select indexname from pg_indexes
where schemaname='public' and tablename='pedidos_compra'
  and indexname='idx_pp_responsavel_verba';

-- Sanity check: toda PP existente satisfaz a constraint
select count(*) from pedidos_compra
where not (
  (verba_producao = true  and fornecedor_id is null     and responsavel_verba_id is not null)
  or
  (verba_producao = false and fornecedor_id is not null and responsavel_verba_id is null)
);
```

Esperado: 3 colunas listadas (verba_producao NOT NULL, responsavel_verba_id YES, fornecedor_id YES), constraint presente, índice presente, `count = 0`.

- [ ] **Step 5: Atualizar `lib/types.ts`**

Procurar o tipo que representa a PP (grep por `PedidoCompra` ou pela lista de campos como `codigo` + `pdf_path`). Adicionar dois campos:

```ts
verba_producao: boolean;
responsavel_verba_id: string | null;
```

- [ ] **Step 6: Rodar `npm run build`**

Esperado: build passa. Se algum lugar consome o tipo e não trata os novos campos, é OK — eles são aditivos, TypeScript não obriga tratar campos novos.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260826000001_pp_verba_producao_pp.sql lib/types.ts
git commit -m "feat(financeiro): pedidos_compra ganha subtipo Verba de Produção

Adiciona verba_producao (bool) e responsavel_verba_id (profile) com
constraint condicional: verba ↔ tem responsável, sem fornecedor;
não-verba ↔ tem fornecedor, sem responsável. Aditiva — PPs existentes
já satisfazem a constraint pelo default false."
```

---

### Task 2: UI de emissão — switch "Verba de Produção" no drawer

Adiciona um switch no topo do formulário. Quando ligado, esconde o combo de Fornecedor e mostra combo de Responsável (profiles do tenant). Persiste os dois campos novos.

**Files:**
- Modify: `app/(app)/jobs/[jobId]/realizado/gerar-pp-drawer.tsx`
- Modify: `app/(app)/jobs/[jobId]/realizado/actions-pp.ts`
- Modify: `app/(app)/jobs/[jobId]/realizado/painel-pps-item.tsx` (server component pai — passar `responsaveis`)

**Interfaces:**
- Consumes:
  - Tipo `PedidoCompra` com `verba_producao` e `responsavel_verba_id` (Task 1)
- Produces:
  - `GerarPPDrawer` aceita prop nova `responsaveis: Array<{ id: string; nome: string }>`
  - `finalizarPedidoCompra` aceita `dados.verba_producao: boolean` e `dados.responsavel_verba_id: string | null` no payload

- [ ] **Step 1: Ampliar `dadosBaseSchema` em `actions-pp.ts`**

Localizar `dadosBaseSchema` (linha ~73). Trocar `fornecedor_id` obrigatório por uma união discriminada:

```ts
const dadosBaseSchema = z.object({
  empresa_id: z.string().uuid(),
  prazo_pagamento: dataSchema,
  servico: z.string().trim().min(1).max(500),
  quantidade: z.number().positive(),
  especificacoes: z.string().max(2000).nullable().optional(),
  parcelas: z
    .array(z.object({ data_vencimento: dataSchema, valor: z.number().positive() }))
    .min(1, "Informe ao menos uma parcela.")
    .max(MAX_PARCELAS, `No máximo ${MAX_PARCELAS} parcelas.`),
}).and(
  z.discriminatedUnion("verba_producao", [
    z.object({
      verba_producao: z.literal(false),
      fornecedor_id: z.string().uuid(),
      responsavel_verba_id: z.null().optional(),
    }),
    z.object({
      verba_producao: z.literal(true),
      fornecedor_id: z.null().optional(),
      responsavel_verba_id: z.string().uuid(),
    }),
  ])
);
```

- [ ] **Step 2: Ajustar `finalizarPedidoCompra` para persistir os novos campos**

No insert/update de `pedidos_compra`, incluir `verba_producao` e `responsavel_verba_id`. O CHECK do banco defende — mas o server action já valida antes.

- [ ] **Step 3: Buscar responsáveis no server component pai**

Em `painel-pps-item.tsx` (ou onde `GerarPPDrawer` é montado), adicionar ao `Promise.all` a query:

```ts
supabase
  .from("profiles")
  .select("id, nome")
  .eq("tenant_id", session.activeTenant.id)
  .order("nome"),
```

E passar `responsaveis={responsaveisRes.data ?? []}` ao componente.

- [ ] **Step 4: Adicionar switch e combo condicional no drawer**

Em `gerar-pp-drawer.tsx`:

- Aceitar prop `responsaveis: Array<{ id: string; nome: string }>`.
- Adicionar estado `const [verbaProducao, setVerbaProducao] = React.useState(false);`
- Adicionar estado `const [responsavelId, setResponsavelId] = React.useState<string>("");`
- No JSX, acima do combo de Fornecedor, adicionar um checkbox/switch com label "Verba de Produção".
- Trocar a renderização condicional: se `verbaProducao`, mostrar `<Select>` de responsáveis; senão, mostrar o `<Select>` de fornecedores atual.
- Ao mudar o switch, limpar o campo oposto (setFornecedorId("") ou setResponsavelId("")).

- [ ] **Step 5: Ajustar o payload de submit**

Ao chamar `finalizarPedidoCompra`, montar o payload conforme o modo:

```ts
const dadosBase = {
  empresa_id: empresaId,
  prazo_pagamento: prazoPagamento,
  servico,
  quantidade: qtdNum,
  especificacoes: especificacoes || null,
  parcelas: parcelasNumericas,
};
const dados = verbaProducao
  ? { ...dadosBase, verba_producao: true as const, responsavel_verba_id: responsavelId, fornecedor_id: null }
  : { ...dadosBase, verba_producao: false as const, fornecedor_id: fornecedorId, responsavel_verba_id: null };
```

- [ ] **Step 6: Ajustar validação client (o botão "Emitir" desabilita quando falta campo)**

Adicionar à lista de "campos obrigatórios preenchidos":
- Se `!verbaProducao`: `fornecedorId !== ""`.
- Se `verbaProducao`: `responsavelId !== ""`.

- [ ] **Step 7: Rodar `npm run build`**

Esperado: build passa sem erros de tipo.

- [ ] **Step 8: Smoke test manual**

- Abrir a página do job, clicar em emitir PP num item realizado.
- Deixar o switch OFF, emitir PP normal — funciona igual a antes.
- Ligar o switch, confirmar que o combo troca; escolher um responsável; emitir.
- Verificar via MCP: `select codigo, verba_producao, fornecedor_id, responsavel_verba_id from pedidos_compra order by created_at desc limit 2;` — última linha é a verba (fornecedor null, responsavel preenchido).

- [ ] **Step 9: Commit**

```bash
git add app/\(app\)/jobs/\[jobId\]/realizado/gerar-pp-drawer.tsx \
        app/\(app\)/jobs/\[jobId\]/realizado/actions-pp.ts \
        app/\(app\)/jobs/\[jobId\]/realizado/painel-pps-item.tsx
git commit -m "feat(financeiro): emissão de PP aceita Verba de Produção

Switch no topo do drawer: OFF (default) segue com fornecedor obrigatório;
ON esconde fornecedor e exige responsável (profile do tenant). Schema
Zod discriminado por verba_producao — server action recusa payload
incoerente antes do CHECK do banco."
```

---

### Task 3: Migration — `pp_verba_prestacoes` + anexos

Cria as duas tabelas da prestação. Prestação é imutável (nasce fechada); anexos são cascade da prestação.

**Files:**
- Create: `supabase/migrations/20260826000002_pp_verba_prestacoes.sql`
- Modify: `lib/types.ts` — adicionar tipos `PPVerbaPrestacao` e `PPVerbaPrestacaoAnexo`.

**Interfaces:**
- Produces:
  - Tabelas `public.pp_verba_prestacoes` e `public.pp_verba_prestacoes_anexos`
  - Índices, RLS, policies e GRANTs correspondentes

- [ ] **Step 1: Criar a migration**

Arquivo: `supabase/migrations/20260826000002_pp_verba_prestacoes.sql`

```sql
-- =====================================================================
-- PP de Verba de Produção — prestação de contas + anexos
--
-- Prestação é IMUTÁVEL (decisão do Antonio, 2026-08-26): não reabre.
-- Se apurou errado, o caminho é estornar o lançamento da devolução
-- (RPC própria da devolução), e não editar a prestação. Por isso a tabela
-- não tem status — nasce fechada, com fechada_em/fechada_por.
--
-- valor_gasto é o número que o usuário digitou; valor_devolvido é
-- calculado (pp.valor − valor_gasto) e persistido para tornar a leitura
-- direta (sem join com pedidos_compra pra saber quanto voltou).
--
-- Uma prestação por PP: uniq_prestacao_por_pp. Anexo cascade porque
-- prestação sem sua prova não tem função.
-- =====================================================================

create table if not exists public.pp_verba_prestacoes (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  pedido_compra_id  uuid not null references public.pedidos_compra(id) on delete restrict,
  valor_gasto       numeric(14,2) not null,
  valor_devolvido   numeric(14,2) not null,
  fechada_em        timestamptz not null default now(),
  fechada_por       uuid not null references public.profiles(id),

  constraint uniq_prestacao_por_pp unique (pedido_compra_id),
  constraint chk_prestacao_valor_gasto_positivo check (valor_gasto > 0),
  constraint chk_prestacao_valor_devolvido_nao_negativo check (valor_devolvido >= 0)
);

create index if not exists idx_pp_verba_prestacoes_tenant
  on public.pp_verba_prestacoes(tenant_id);

create table if not exists public.pp_verba_prestacoes_anexos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  prestacao_id          uuid not null references public.pp_verba_prestacoes(id) on delete cascade,
  arquivo_path          text not null,
  arquivo_nome_original text not null,
  arquivo_tamanho_bytes bigint not null,
  arquivo_mimetype      text not null,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),

  constraint chk_prestacao_anexo_tamanho_positivo check (arquivo_tamanho_bytes > 0)
);

create index if not exists idx_pp_verba_prestacoes_anexos_prestacao
  on public.pp_verba_prestacoes_anexos(prestacao_id);

-- RLS + GRANT
alter table public.pp_verba_prestacoes enable row level security;
alter table public.pp_verba_prestacoes_anexos enable row level security;

drop policy if exists pp_verba_prestacoes_select on public.pp_verba_prestacoes;
create policy pp_verba_prestacoes_select on public.pp_verba_prestacoes
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists pp_verba_prestacoes_insert on public.pp_verba_prestacoes;
create policy pp_verba_prestacoes_insert on public.pp_verba_prestacoes
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists pp_verba_prestacoes_anexos_select on public.pp_verba_prestacoes_anexos;
create policy pp_verba_prestacoes_anexos_select on public.pp_verba_prestacoes_anexos
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists pp_verba_prestacoes_anexos_insert on public.pp_verba_prestacoes_anexos;
create policy pp_verba_prestacoes_anexos_insert on public.pp_verba_prestacoes_anexos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

-- Sem UPDATE/DELETE em prestação: é imutável. Anexo cascade apaga
-- automaticamente se a prestação for removida em manutenção manual do
-- DBA (cascade não checa GRANT).
grant select, insert on public.pp_verba_prestacoes to authenticated;
grant select, insert on public.pp_verba_prestacoes_anexos to authenticated;

comment on table public.pp_verba_prestacoes is
  'Prestação de contas de PP de Verba de Produção. Uma por PP. Imutável: valor_gasto e anexos não editam depois de gravados.';
```

- [ ] **Step 2: Aplicar via MCP**

`mcp__supabase__apply_migration` com o conteúdo acima.

- [ ] **Step 3: Conferir via MCP**

```sql
select tablename from pg_tables where schemaname='public'
  and tablename in ('pp_verba_prestacoes','pp_verba_prestacoes_anexos');

select tablename, policyname from pg_policies
where schemaname='public' and tablename like 'pp_verba_prestacoes%'
order by tablename, policyname;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name like 'pp_verba_prestacoes%'
order by table_name, grantee;
```

Esperado: 2 tabelas, 4 policies (2 select + 2 insert), grants só para `authenticated` (SELECT + INSERT — sem UPDATE nem DELETE).

- [ ] **Step 4: Adicionar tipos em `lib/types.ts`**

```ts
export interface PPVerbaPrestacao {
  id: string;
  tenant_id: string;
  pedido_compra_id: string;
  valor_gasto: number;
  valor_devolvido: number;
  fechada_em: string;
  fechada_por: string;
}

export interface PPVerbaPrestacaoAnexo {
  id: string;
  tenant_id: string;
  prestacao_id: string;
  arquivo_path: string;
  arquivo_nome_original: string;
  arquivo_tamanho_bytes: number;
  arquivo_mimetype: string;
  created_by: string | null;
  created_at: string;
}
```

- [ ] **Step 5: `npm run build`**

Esperado: passa.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260826000002_pp_verba_prestacoes.sql lib/types.ts
git commit -m "feat(financeiro): tabelas pp_verba_prestacoes e anexos

Prestação de contas imutável (uma por PP). Anexos cascade. Sem UPDATE
nem DELETE no GRANT — a única forma de 'corrigir' é estornar o
lançamento de devolução (Task futura), que reabre a devolução mas não
a prestação."
```

---

### Task 4: RPC `fechar_prestacao_verba_pp`

RPC atômica que fecha a prestação. Como devolução ainda não existe (Task 5–7), este RPC apenas insere a prestação; a criação da devolução é adicionada depois na Task 9 via `create or replace` do mesmo RPC.

**Nota:** dividimos assim pra manter task pequena. Alternativa seria escrever o RPC completo agora com uma flag "gerar devolução", mas isso adia uso real da tabela de devolução. Preferimos duas versões do RPC.

**Files:**
- Create: `supabase/migrations/20260826000003_pp_verba_rpc_prestacao.sql`

**Interfaces:**
- Produces:
  - Função `public.fechar_prestacao_verba_pp(p_pp_id uuid, p_valor_gasto numeric, p_fechada_por uuid) returns uuid`

- [ ] **Step 1: Criar a migration**

Arquivo: `supabase/migrations/20260826000003_pp_verba_rpc_prestacao.sql`

```sql
-- =====================================================================
-- RPC fechar_prestacao_verba_pp — versão 1 (sem devolução ainda)
--
-- Fecha a prestação de contas de uma PP de Verba de Produção. Nesta
-- migration, só insere pp_verba_prestacoes; a criação do "título negativo"
-- (pp_verba_devolucoes) entra na migration 20260826000006 quando a tabela
-- já existir e o enum origem_lancamento já tiver o valor novo.
--
-- Validações:
--   • PP existe, tenant, verba_producao=true, status='pago'.
--   • Ainda não tem prestação (unique defende, mas o erro é mais claro
--     se checarmos antes).
--   • 0 < valor_gasto <= pp.valor.
--
-- Anexos entram fora deste RPC — o server action sobe arquivos ao
-- Storage e insere em pp_verba_prestacoes_anexos com o prestacao_id que
-- este RPC retorna.
-- =====================================================================

create or replace function public.fechar_prestacao_verba_pp(
  p_pp_id       uuid,
  p_valor_gasto numeric,
  p_fechada_por uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp             pedidos_compra%rowtype;
  v_prestacao_id   uuid;
  v_valor_devolvido numeric(14,2);
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;

  if not public.is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem acesso a esta PP.';
  end if;

  if v_pp.verba_producao is not true then
    raise exception 'Esta PP não é de Verba de Produção.';
  end if;

  if v_pp.status <> 'pago' then
    raise exception 'A prestação de contas só pode ser feita depois que a PP for totalmente paga (status atual: %).', v_pp.status;
  end if;

  if exists (select 1 from public.pp_verba_prestacoes where pedido_compra_id = p_pp_id) then
    raise exception 'Esta PP já tem prestação de contas registrada.';
  end if;

  if p_valor_gasto is null or p_valor_gasto <= 0 then
    raise exception 'Informe um valor gasto maior que zero.';
  end if;

  if p_valor_gasto > v_pp.valor then
    raise exception 'O valor gasto (%) não pode ser maior que o valor da PP (%).',
      to_char(p_valor_gasto, 'FM999999999990.00'),
      to_char(v_pp.valor,    'FM999999999990.00');
  end if;

  v_valor_devolvido := v_pp.valor - p_valor_gasto;

  insert into public.pp_verba_prestacoes (
    tenant_id, pedido_compra_id, valor_gasto, valor_devolvido, fechada_por
  ) values (
    v_pp.tenant_id, v_pp.id, p_valor_gasto, v_valor_devolvido, p_fechada_por
  )
  returning id into v_prestacao_id;

  -- A criação do pp_verba_devolucoes (quando valor_devolvido > 0) entra
  -- na versão 2 deste RPC, na migration 20260826000006.

  return v_prestacao_id;
end;
$$;

comment on function public.fechar_prestacao_verba_pp(uuid, numeric, uuid) is
  'Fecha a prestação de contas de uma PP de Verba de Produção paga. Versão 1: só grava a prestação. Versão 2 (migration 20260826000006) passa a gerar também a devolução quando valor_devolvido > 0.';

revoke execute on function public.fechar_prestacao_verba_pp(uuid, numeric, uuid) from public;
grant  execute on function public.fechar_prestacao_verba_pp(uuid, numeric, uuid) to authenticated;
```

- [ ] **Step 2: Aplicar via MCP**

- [ ] **Step 3: Conferir via MCP**

```sql
select proname from pg_proc
where pronamespace='public'::regnamespace
  and proname='fechar_prestacao_verba_pp';

select r.grantee, r.privilege_type
from information_schema.routine_privileges r
where r.specific_schema='public'
  and r.routine_name='fechar_prestacao_verba_pp'
order by r.grantee;
```

Esperado: função presente, EXECUTE só para `authenticated` (não para `public`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260826000003_pp_verba_rpc_prestacao.sql
git commit -m "feat(financeiro): RPC fechar_prestacao_verba_pp (v1)

Versão 1 só grava a prestação. Gerar a devolução (título negativo em
contas a pagar) fica pra v2, na migration que cria pp_verba_devolucoes,
porque enum origem_lancamento precisa commitar antes de ser usado."
```

---

### Task 5: Server action + Dialog "Prestar contas"

UI de prestação. Server action orquestra: upload de anexos ao Storage → insert em `pp_verba_prestacoes_anexos` → chamada ao RPC `fechar_prestacao_verba_pp` (que retorna `prestacao_id`).

**Files:**
- Create: `app/(app)/financeiro/contas-a-pagar/prestacao-verba-actions.ts`
- Create: `app/(app)/financeiro/contas-a-pagar/prestar-contas-dialog.tsx`

**Interfaces:**
- Consumes: RPC `fechar_prestacao_verba_pp` (Task 4)
- Produces:
  - Server action `fecharPrestacaoVerba(payload: { pp_id: string; valor_gasto: number; anexos: Array<{ path: string; nome_original: string; tamanho_bytes: number; mimetype: string }> }): Promise<{ ok: true; prestacao_id: string } | { ok: false; message: string }>`
  - Server action `signedUrlAnexoPrestacao(anexo_id: string): Promise<{ ok: true; url: string } | { ok: false; message: string }>`
  - Componente `<PrestarContasDialog open onOpenChange pp onSuccess />` onde `pp = { id, codigo, valor, servico }`.

**Nota sobre ordem:** insert em `pp_verba_prestacoes_anexos` requer `prestacao_id`, então o RPC roda primeiro e depois inserimos anexos. Se o insert de anexos falhar, deixamos o arquivo órfão no Storage (mesma decisão de `gerar-pp-drawer.tsx`, aceitável no MVP).

- [ ] **Step 1: Criar bucket para anexos (verificar se já existe)**

Reusar o bucket `pedidos-compra` (mesmo dos anexos de PP). Prefixo dos anexos: `<tenant_id>/verba-prestacoes/<prestacao_id>/`.

Verificar via MCP: `select id from storage.buckets where id='pedidos-compra';` — se existir, ok. Caso contrário, criar via SQL:

```sql
insert into storage.buckets (id, name, public) values ('pedidos-compra', 'pedidos-compra', false)
on conflict (id) do nothing;
```

(Provavelmente já existe — só verificar.)

- [ ] **Step 2: Criar `prestacao-verba-actions.ts`**

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

const BUCKET = "pedidos-compra";
const ANEXO_TTL_SEGUNDOS = 3600;

type Ok<T = object> = { ok: true } & T;
type Err = { ok: false; message: string };
type Result<T = object> = Ok<T> | Err;

const anexoSchema = z.object({
  path: z.string().min(1),
  nome_original: z.string().min(1).max(500),
  tamanho_bytes: z.number().int().positive(),
  mimetype: z.string().min(1).max(200),
});

const payloadSchema = z.object({
  pp_id: z.string().uuid(),
  valor_gasto: z.number().positive(),
  anexos: z.array(anexoSchema).min(1, "Anexe ao menos uma nota fiscal."),
});

export async function fecharPrestacaoVerba(
  payload: z.infer<typeof payloadSchema>,
): Promise<Result<{ prestacao_id: string }>> {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.errors[0]?.message ?? "Dados inválidos." };
  }

  const session = await requireSession();
  const supabase = createClient();

  // Chama o RPC. Ele valida tudo (tenant, verba, status, valor).
  const { data: prestacaoId, error: rpcErr } = await supabase.rpc(
    "fechar_prestacao_verba_pp",
    {
      p_pp_id: parsed.data.pp_id,
      p_valor_gasto: parsed.data.valor_gasto,
      p_fechada_por: session.user.id,
    },
  );

  if (rpcErr || !prestacaoId) {
    return { ok: false, message: rpcErr?.message ?? "Não foi possível fechar a prestação." };
  }

  // Insere anexos vinculados à prestação. Se falhar aqui, arquivos ficam
  // no Storage órfãos — aceitável no MVP (mesma decisão do gerar-pp).
  const rowsAnexos = parsed.data.anexos.map((a) => ({
    tenant_id: session.activeTenant.id,
    prestacao_id: prestacaoId,
    arquivo_path: a.path,
    arquivo_nome_original: a.nome_original,
    arquivo_tamanho_bytes: a.tamanho_bytes,
    arquivo_mimetype: a.mimetype,
    created_by: session.user.id,
  }));

  const { error: anexosErr } = await supabase
    .from("pp_verba_prestacoes_anexos")
    .insert(rowsAnexos);

  if (anexosErr) {
    return { ok: false, message: `Prestação gravada, mas anexos falharam: ${anexosErr.message}` };
  }

  await logAuditEvent({
    acao: "verba_producao.prestacao_fechada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: {
      prestacao_id: prestacaoId,
      valor_gasto: parsed.data.valor_gasto,
      qtd_anexos: parsed.data.anexos.length,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, prestacao_id: prestacaoId as string };
}

export async function signedUrlAnexoPrestacao(
  anexo_id: string,
): Promise<Result<{ url: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo, error } = await supabase
    .from("pp_verba_prestacoes_anexos")
    .select("arquivo_path")
    .eq("id", anexo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (error || !anexo) return { ok: false, message: "Anexo não encontrado." };

  const { data: signed, error: signedErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(anexo.arquivo_path, ANEXO_TTL_SEGUNDOS);

  if (signedErr || !signed) return { ok: false, message: "Não foi possível gerar o link." };
  return { ok: true, url: signed.signedUrl };
}
```

- [ ] **Step 3: Criar `prestar-contas-dialog.tsx`**

Client component. Usa `Dialog + DialogContent` do shadcn/ui (padrão do repo). Estrutura:

- Input `valor_gasto` (número em pt-BR — reusar `parseNumeroLocal` do `gerar-pp-drawer.tsx`, copiar helper local ou extrair pra `lib/utils/numero.ts` se preferir).
- Uploader multi-arquivo (padrão idêntico ao de `gerar-pp-drawer.tsx`: subir imediatamente pro Storage, mostrar status por arquivo).
- Card de resumo em tempo real:
  - "Valor da PP: R$ X" (readonly)
  - "Gasto: R$ Y" (do input)
  - "Devolução: R$ Z" (calculado, destacado)
- Warning: "Prestação não pode ser reaberta depois de fechada."
- Botão principal muda label conforme `Z`:
  - `Z === 0` → "Fechar prestação (sem devolução)"
  - `Z > 0`   → "Fechar prestação e gerar devolução de R$ Z"
- Botão secundário "Cancelar".

Reusa o padrão de upload de `gerar-pp-drawer.tsx` (linhas ~188-284): estado `AnexoLocal[]`, upload imediato ao selecionar, `removerAnexo` remove do Storage se `status === "ok"`.

Ao confirmar, monta o payload `{ pp_id, valor_gasto, anexos: [{ path, nome_original, tamanho_bytes, mimetype }, ...] }` e chama `fecharPrestacaoVerba`.

Validações client (habilitar botão):
- `valor_gasto > 0` e `valor_gasto <= pp.valor`
- ao menos 1 anexo com `status === "ok"`
- não pending

- [ ] **Step 4: `npm run build`**

Esperado: passa.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/prestacao-verba-actions.ts \
        app/\(app\)/financeiro/contas-a-pagar/prestar-contas-dialog.tsx
git commit -m "feat(financeiro): server action + dialog 'Prestar contas'

fecharPrestacaoVerba orquestra RPC + upload de NFs no Storage +
insert em pp_verba_prestacoes_anexos. Dialog client: input do
valor gasto, uploader multi-arquivo, resumo em tempo real,
warning de imutabilidade."
```

---

### Task 6: Aba "Prestação de contas" no drawer da PP

Adiciona seção condicional no `pp-drawer-financeiro.tsx`. Comportamento em 3 estados: PP não paga, PP paga sem prestação, prestação já feita.

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/pp-drawer-financeiro.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx` — passar `prestacao` + `anexos` da PP se existirem.

**Interfaces:**
- Consumes:
  - `<PrestarContasDialog>` (Task 5)
  - `signedUrlAnexoPrestacao` (Task 5)
- Produces:
  - `PPDrawerFinanceiro` aceita props novas: `prestacao?: PPVerbaPrestacao & { anexos: PPVerbaPrestacaoAnexo[]; fechada_por_profile?: { nome: string } | null }`.

- [ ] **Step 1: Buscar prestação no server component**

Em `page.tsx`, dentro do `Promise.all`, adicionar query que busca prestações + anexos das PPs verba:

```ts
supabase
  .from("pp_verba_prestacoes")
  .select(`
    id, pedido_compra_id, valor_gasto, valor_devolvido, fechada_em,
    fechada_por_profile:profiles!fechada_por(nome),
    anexos:pp_verba_prestacoes_anexos(id, arquivo_nome_original, arquivo_tamanho_bytes, arquivo_mimetype)
  `)
  .eq("tenant_id", session.activeTenant.id),
```

Depois, ao montar as PPRows, atachar a `prestacao` correspondente (Map por `pedido_compra_id`).

- [ ] **Step 2: Ajustar tipo `PPRow`**

Se `PPRow` está exportado, adicionar campo opcional:
```ts
prestacao?: (PPVerbaPrestacao & {
  fechada_por_profile: { nome: string } | null;
  anexos: Array<Pick<PPVerbaPrestacaoAnexo, "id" | "arquivo_nome_original" | "arquivo_tamanho_bytes" | "arquivo_mimetype">>;
}) | null;
```

- [ ] **Step 3: Renderizar a seção no drawer**

Em `pp-drawer-financeiro.tsx`, adicionar seção nova (sob a lista de parcelas, ou como aba se o drawer usa tabs):

```tsx
{pp.verba_producao && (
  <section className="mt-6 rounded-md border p-4">
    <h3 className="text-sm font-semibold">Prestação de contas</h3>

    {pp.status !== "pago" && (
      <p className="mt-2 text-sm text-neutral-600">
        A prestação de contas só pode ser feita depois que a PP for totalmente paga.
      </p>
    )}

    {pp.status === "pago" && !pp.prestacao && (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setPrestarOpen(true)}
          className="rounded-md bg-[#E74B56] px-3 py-2 text-sm text-white"
        >
          Prestar contas
        </button>
      </div>
    )}

    {pp.prestacao && (
      <div className="mt-3 space-y-2 text-sm">
        <div>
          Fechada em {formatDate(pp.prestacao.fechada_em)}
          {pp.prestacao.fechada_por_profile?.nome ? ` por ${pp.prestacao.fechada_por_profile.nome}` : ""}.
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div><div className="text-neutral-500">Valor da PP</div><div>{formatMoney(pp.valor)}</div></div>
          <div><div className="text-neutral-500">Gasto declarado</div><div>{formatMoney(pp.prestacao.valor_gasto)}</div></div>
          <div><div className="text-neutral-500">Devolvido</div><div className="text-emerald-700">{formatMoney(pp.prestacao.valor_devolvido)}</div></div>
        </div>
        <div>
          <div className="text-neutral-500 mb-1">Notas fiscais anexadas</div>
          <ul className="space-y-1">
            {pp.prestacao.anexos.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => abrirAnexo(a.id)}
                  className="text-left underline"
                >
                  {a.arquivo_nome_original}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    )}
  </section>
)}

{prestarOpen && pp.verba_producao && (
  <PrestarContasDialog
    open={prestarOpen}
    onOpenChange={setPrestarOpen}
    pp={{ id: pp.id, codigo: pp.codigo, valor: pp.valor, servico: pp.servico }}
    onSuccess={() => { setPrestarOpen(false); router.refresh(); }}
  />
)}
```

E o helper:
```tsx
async function abrirAnexo(anexo_id: string) {
  const res = await signedUrlAnexoPrestacao(anexo_id);
  if (res.ok) window.open(res.url, "_blank");
  else alert(res.message);
}
```

- [ ] **Step 4: `npm run build`**

Esperado: passa.

- [ ] **Step 5: Smoke test manual**

- Emitir uma PP de verba (Task 2), aprovar, baixar todas as parcelas.
- Abrir a PP no drawer de Contas a Pagar — deve mostrar botão "Prestar contas".
- Clicar, digitar valor gasto < valor da PP, anexar 1 arquivo, confirmar.
- Deve fechar o dialog, refresh, aparecer o card readonly com "Fechada em X — Gasto R$ Y — Devolvido R$ Z" e o anexo clicável.
- Clicar no anexo abre o PDF/imagem em nova aba.

Neste momento, a devolução ainda não vai aparecer na aba Títulos a Pagar (isso entra na Task 11). O que precisa funcionar aqui é só a prestação.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/pp-drawer-financeiro.tsx \
        app/\(app\)/financeiro/contas-a-pagar/page.tsx
git commit -m "feat(financeiro): aba 'Prestação de contas' no drawer de PP verba

3 estados: PP não paga (aviso), PP paga sem prestação (botão), prestação
já feita (card readonly com anexos clicáveis via signed URL)."
```

---

### Task 7: Migration — enum `origem_lancamento` ganha valores novos

**Migration separada** porque `ADD VALUE` precisa commit antes de ser usado em constraints e RPCs (padrão do projeto: `20260820000007_desembolso_enum_lancamentos.sql`).

**Files:**
- Create: `supabase/migrations/20260826000004_pp_verba_enum_lancamentos.sql`

**Interfaces:**
- Produces: valores `'pp_devolucao_verba'` e `'pp_devolucao_verba_estornada'` no enum `origem_lancamento`.

- [ ] **Step 1: Criar migration**

```sql
-- =====================================================================
-- Enum origem_lancamento ganha os valores da devolução de verba.
-- Migration separada porque ADD VALUE precisa commit antes de ser usado
-- em constraints (padrão de 20260820000007_desembolso_enum_lancamentos).
-- =====================================================================

alter type origem_lancamento add value if not exists 'pp_devolucao_verba';
alter type origem_lancamento add value if not exists 'pp_devolucao_verba_estornada';
```

- [ ] **Step 2: Aplicar via MCP**

- [ ] **Step 3: Conferir via MCP**

```sql
select unnest(enum_range(null::origem_lancamento))::text as valor
order by 1;
```

Esperado: lista inclui `pp_devolucao_verba` e `pp_devolucao_verba_estornada`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260826000004_pp_verba_enum_lancamentos.sql
git commit -m "feat(financeiro): enum origem_lancamento aceita pp_devolucao_verba

Migration separada porque ADD VALUE precisa commit antes de ser usado
em constraints/RPCs — padrão de 20260820000007."
```

---

### Task 8: Migration — `pp_verba_devolucoes` + FK em lançamentos

Cria a tabela do "título negativo" e a FK opcional em `lancamentos_financeiros`. Reusa a trigger `congela_data_pagamento_primeira` (já existe, é genérica).

**Files:**
- Create: `supabase/migrations/20260826000005_pp_verba_devolucoes.sql`
- Modify: `lib/types.ts` — adicionar tipo `PPVerbaDevolucao`.

**Interfaces:**
- Produces:
  - Tabela `public.pp_verba_devolucoes`
  - Coluna `lancamentos_financeiros.pp_verba_devolucao_id`
  - Índices, RLS, policies e GRANTs

- [ ] **Step 1: Verificar constraints existentes de `lancamentos_financeiros`**

MCP: buscar constraints atuais que dependem da origem:
```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid='public.lancamentos_financeiros'::regclass
  and contype='c'
order by conname;
```

Anotar quais CHECKs mencionam `pedido_compra_id`, `pp_verba_devolucao_id`, ou o enum. Se alguma CHECK precisa ser ampliada para incluir a nova origem, incluir o ajuste na migration.

- [ ] **Step 2: Criar a migration**

```sql
-- =====================================================================
-- pp_verba_devolucoes — o "título negativo" gerado quando a prestação de
-- contas apura sobra. Aparece na aba Títulos a Pagar (via vw_a_pagar) e
-- precisa ser baixada quando o TED do responsável cai na conta.
--
-- POR QUE TABELA PRÓPRIA (e não reuso de contas_avulsas): rastreabilidade
-- limpa (FK direto pra prestação e PP), fluxo próprio (sem aprovação —
-- devolução é entrada), origem própria no lançamento
-- (pp_devolucao_verba). Precedente: desembolsos (2026-08-20).
--
-- data_pagamento_primeira é congelada pela trigger genérica
-- congela_data_pagamento_primeira, mesma que serve pedidos_compra_parcelas
-- e contas_avulsas — os nomes de coluna batem.
-- =====================================================================

create table if not exists public.pp_verba_devolucoes (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  empresa_id            uuid not null references public.empresas(id) on delete restrict,
  prestacao_id          uuid not null references public.pp_verba_prestacoes(id) on delete restrict,
  pedido_compra_id      uuid not null references public.pedidos_compra(id) on delete restrict,
  valor                 numeric(14,2) not null,
  data_pagamento        date not null,
  data_pagamento_primeira date not null,
  pago_em               date,
  pago_por              uuid references public.profiles(id),
  lancamento_id         uuid references public.lancamentos_financeiros(id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint uniq_devolucao_por_prestacao unique (prestacao_id),
  constraint chk_devolucao_valor_positivo check (valor > 0)
);

create index if not exists idx_pp_verba_devolucoes_tenant
  on public.pp_verba_devolucoes(tenant_id);

-- Fila do financeiro: devoluções aguardando baixa. Parcial porque
-- devolução paga sai da fila.
create index if not exists idx_pp_verba_devolucoes_a_baixar
  on public.pp_verba_devolucoes(tenant_id, data_pagamento)
  where pago_em is null;

drop trigger if exists trg_pp_verba_devolucoes_updated_at on public.pp_verba_devolucoes;
create trigger trg_pp_verba_devolucoes_updated_at
before update on public.pp_verba_devolucoes
for each row execute function public.set_updated_at();

-- Reusa a trigger genérica de congelar data_pagamento_primeira.
drop trigger if exists trg_congela_primeira_data on public.pp_verba_devolucoes;
create trigger trg_congela_primeira_data
before update on public.pp_verba_devolucoes
for each row execute function public.congela_data_pagamento_primeira();

alter table public.pp_verba_devolucoes enable row level security;

drop policy if exists pp_verba_devolucoes_select on public.pp_verba_devolucoes;
create policy pp_verba_devolucoes_select on public.pp_verba_devolucoes
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists pp_verba_devolucoes_insert on public.pp_verba_devolucoes;
create policy pp_verba_devolucoes_insert on public.pp_verba_devolucoes
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists pp_verba_devolucoes_update on public.pp_verba_devolucoes;
create policy pp_verba_devolucoes_update on public.pp_verba_devolucoes
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.pp_verba_devolucoes to authenticated;

-- FK opcional em lancamentos_financeiros: aponta pra devolução quando
-- origem = 'pp_devolucao_verba' (ou sua versão estornada).
alter table public.lancamentos_financeiros
  add column if not exists pp_verba_devolucao_id uuid
    references public.pp_verba_devolucoes(id) on delete restrict;

create index if not exists idx_lancamentos_pp_verba_devolucao
  on public.lancamentos_financeiros(pp_verba_devolucao_id);

comment on table public.pp_verba_devolucoes is
  'Devolução do saldo não gasto de uma PP de Verba de Produção. Uma por prestação. Aparece em Contas a Pagar via vw_a_pagar como origem pp_devolucao_verba (entrada — "título negativo").';
```

- [ ] **Step 3: Aplicar via MCP**

- [ ] **Step 4: Conferir via MCP**

```sql
select tablename from pg_tables where schemaname='public' and tablename='pp_verba_devolucoes';

select column_name from information_schema.columns
where table_schema='public' and table_name='lancamentos_financeiros'
  and column_name='pp_verba_devolucao_id';

select tgname from pg_trigger
where tgrelid='public.pp_verba_devolucoes'::regclass
  and tgname in ('trg_pp_verba_devolucoes_updated_at','trg_congela_primeira_data');

select policyname from pg_policies
where schemaname='public' and tablename='pp_verba_devolucoes';
```

Esperado: tabela presente, FK adicionada, 2 triggers, 3 policies.

- [ ] **Step 5: Adicionar tipo em `lib/types.ts`**

```ts
export interface PPVerbaDevolucao {
  id: string;
  tenant_id: string;
  empresa_id: string;
  prestacao_id: string;
  pedido_compra_id: string;
  valor: number;
  data_pagamento: string;
  data_pagamento_primeira: string;
  pago_em: string | null;
  pago_por: string | null;
  lancamento_id: string | null;
  created_at: string;
  updated_at: string;
}
```

Adicionar `"pp_devolucao_verba"` ao union `OrigemTitulo`:

```ts
export type OrigemTitulo = "pp" | "avulso" | "recorrencia" | "desembolso" | "pp_devolucao_verba";

export const origemTituloLabel = (o: OrigemTitulo, ppCodigo?: string | null): string =>
  o === "pp" ? (ppCodigo ?? "PP")
    : o === "avulso" ? "AVULSO"
    : o === "recorrencia" ? "RECORRÊNCIA"
    : o === "desembolso" ? "DESEMBOLSO"
    : "DEVOLUÇÃO VERBA";
```

- [ ] **Step 6: `npm run build`**

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260826000005_pp_verba_devolucoes.sql lib/types.ts
git commit -m "feat(financeiro): tabela pp_verba_devolucoes + FK em lancamentos

Título negativo gerado pela prestação de contas. Reusa trigger genérica
congela_data_pagamento_primeira. FK em lancamentos_financeiros permite
rastrear qual devolução um lançamento pp_devolucao_verba quitou."
```

---

### Task 9: RPCs — baixa e estorno da devolução + v2 do `fechar_prestacao_verba_pp`

Três funções: (a) v2 do RPC de fechar prestação, que agora também cria `pp_verba_devolucoes` quando `valor_devolvido > 0`; (b) `dar_baixa_devolucao_verba`; (c) `estornar_baixa_devolucao_verba`.

**Files:**
- Create: `supabase/migrations/20260826000006_pp_verba_rpcs_devolucao.sql`

**Interfaces:**
- Consumes:
  - Tabela `pp_verba_devolucoes` (Task 8)
  - Enum `origem_lancamento` com `pp_devolucao_verba` (Task 7)
- Produces:
  - `public.fechar_prestacao_verba_pp(uuid, numeric, uuid) returns uuid` — versão 2, cria devolução se `valor_devolvido > 0`.
  - `public.dar_baixa_devolucao_verba(p_devolucao_id uuid, p_pago_em date, p_conta_bancaria_id uuid, p_plano_conta_tipo_id uuid, p_plano_conta_subtipo_id uuid, p_criado_por uuid) returns uuid` — retorna `lancamento_id`.
  - `public.estornar_baixa_devolucao_verba(p_devolucao_id uuid, p_motivo text, p_criado_por uuid) returns uuid` — retorna `id` do lançamento reverso.

- [ ] **Step 1: Criar migration**

```sql
-- =====================================================================
-- v2 do fechar_prestacao_verba_pp + RPCs de baixa/estorno da devolução.
-- Enum origem_lancamento com pp_devolucao_verba já commitado em
-- 20260826000004; tabela pp_verba_devolucoes já criada em 20260826000005.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. fechar_prestacao_verba_pp v2 — passa a criar a devolução também
-- ---------------------------------------------------------------------

create or replace function public.fechar_prestacao_verba_pp(
  p_pp_id       uuid,
  p_valor_gasto numeric,
  p_fechada_por uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp                pedidos_compra%rowtype;
  v_prestacao_id      uuid;
  v_valor_devolvido   numeric(14,2);
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;

  if not public.is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem acesso a esta PP.';
  end if;

  if v_pp.verba_producao is not true then
    raise exception 'Esta PP não é de Verba de Produção.';
  end if;

  if v_pp.status <> 'pago' then
    raise exception 'A prestação de contas só pode ser feita depois que a PP for totalmente paga (status atual: %).', v_pp.status;
  end if;

  if exists (select 1 from public.pp_verba_prestacoes where pedido_compra_id = p_pp_id) then
    raise exception 'Esta PP já tem prestação de contas registrada.';
  end if;

  if p_valor_gasto is null or p_valor_gasto <= 0 then
    raise exception 'Informe um valor gasto maior que zero.';
  end if;

  if p_valor_gasto > v_pp.valor then
    raise exception 'O valor gasto (%) não pode ser maior que o valor da PP (%).',
      to_char(p_valor_gasto, 'FM999999999990.00'),
      to_char(v_pp.valor,    'FM999999999990.00');
  end if;

  v_valor_devolvido := v_pp.valor - p_valor_gasto;

  insert into public.pp_verba_prestacoes (
    tenant_id, pedido_compra_id, valor_gasto, valor_devolvido, fechada_por
  ) values (
    v_pp.tenant_id, v_pp.id, p_valor_gasto, v_valor_devolvido, p_fechada_por
  )
  returning id into v_prestacao_id;

  -- v2: cria devolução se sobrou dinheiro. data_pagamento nasce hoje —
  -- o financeiro repactua depois pelo lápis da aba Títulos a Pagar.
  if v_valor_devolvido > 0 then
    insert into public.pp_verba_devolucoes (
      tenant_id, empresa_id, prestacao_id, pedido_compra_id, valor,
      data_pagamento, data_pagamento_primeira
    ) values (
      v_pp.tenant_id, v_pp.empresa_id, v_prestacao_id, v_pp.id, v_valor_devolvido,
      current_date, current_date
    );
  end if;

  return v_prestacao_id;
end;
$$;

comment on function public.fechar_prestacao_verba_pp(uuid, numeric, uuid) is
  'v2 (2026-08-26): fecha a prestação de contas e, se valor_devolvido > 0, cria pp_verba_devolucoes com data_pagamento = current_date.';

-- ---------------------------------------------------------------------
-- 2. dar_baixa_devolucao_verba — baixa da entrada
-- ---------------------------------------------------------------------

create or replace function public.dar_baixa_devolucao_verba(
  p_devolucao_id           uuid,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por             uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dev            pp_verba_devolucoes%rowtype;
  v_pp             pedidos_compra%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  select * into v_dev from public.pp_verba_devolucoes where id = p_devolucao_id;
  if not found then raise exception 'Devolução não encontrada.'; end if;

  if not public.is_tenant_member(v_dev.tenant_id) then
    raise exception 'Sem acesso a esta devolução.';
  end if;

  if v_dev.pago_em is not null then
    raise exception 'Esta devolução já foi baixada.';
  end if;

  select * into v_pp from public.pedidos_compra where id = v_dev.pedido_compra_id;
  if not found then raise exception 'PP da devolução não encontrada.'; end if;

  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_dev.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da devolução.';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do recebimento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo
    from public.plano_contas_subtipos
   where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  v_descricao := 'Devolução verba ' || v_pp.codigo
                 || ' — ' || substring(v_pp.servico, 1, 140);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, pp_verba_devolucao_id,
    origem, criado_por
  ) values (
    v_dev.tenant_id, v_dev.empresa_id, p_conta_bancaria_id, p_pago_em, v_dev.valor,
    'entrada', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    null, v_pp.job_id, v_pp.id, v_dev.id,
    'pp_devolucao_verba', p_criado_por
  )
  returning id into v_lancamento_id;

  update public.pp_verba_devolucoes
     set pago_em       = p_pago_em,
         pago_por      = p_criado_por,
         lancamento_id = v_lancamento_id
   where id = p_devolucao_id;

  return v_lancamento_id;
end;
$$;

comment on function public.dar_baixa_devolucao_verba(uuid, date, uuid, uuid, uuid, uuid) is
  'Baixa da devolução de verba: gera lançamento de entrada com origem pp_devolucao_verba e marca a devolução como paga.';

revoke execute on function public.dar_baixa_devolucao_verba(uuid, date, uuid, uuid, uuid, uuid) from public;
grant  execute on function public.dar_baixa_devolucao_verba(uuid, date, uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. estornar_baixa_devolucao_verba — devolve a devolução ao "aguardando"
-- ---------------------------------------------------------------------

create or replace function public.estornar_baixa_devolucao_verba(
  p_devolucao_id uuid,
  p_motivo       text,
  p_criado_por   uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dev        pp_verba_devolucoes%rowtype;
  v_pp         pedidos_compra%rowtype;
  v_original   lancamentos_financeiros%rowtype;
  v_reverso_id uuid;
  v_descricao  text;
begin
  select * into v_dev from public.pp_verba_devolucoes where id = p_devolucao_id;
  if not found then raise exception 'Devolução não encontrada.'; end if;

  if not public.is_tenant_member(v_dev.tenant_id) then
    raise exception 'Sem acesso a esta devolução.';
  end if;

  if v_dev.pago_em is null then
    raise exception 'Esta devolução não está baixada.';
  end if;

  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo do estorno.';
  end if;

  select * into v_pp from public.pedidos_compra where id = v_dev.pedido_compra_id;
  if not found then raise exception 'PP da devolução não encontrada.'; end if;

  select * into v_original
    from public.lancamentos_financeiros
   where id = v_dev.lancamento_id;
  if not found then
    raise exception 'Lançamento da baixa da devolução não encontrado.';
  end if;

  v_descricao := 'Estorno devolução verba ' || v_pp.codigo
                 || ' — ' || substring(p_motivo, 1, 180);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, pp_verba_devolucao_id,
    estorno_de_lancamento_id, origem, criado_por
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    'saida', v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    null, v_original.job_id, v_original.pedido_compra_id, v_original.pp_verba_devolucao_id,
    v_original.id, 'pp_devolucao_verba_estornada', p_criado_por
  )
  returning id into v_reverso_id;

  update public.lancamentos_financeiros
     set origem = 'pp_devolucao_verba_estornada'
   where id = v_original.id;

  update public.pp_verba_devolucoes
     set pago_em       = null,
         pago_por      = null,
         lancamento_id = null
   where id = p_devolucao_id;

  return v_reverso_id;
end;
$$;

comment on function public.estornar_baixa_devolucao_verba(uuid, text, uuid) is
  'Estorna a baixa da devolução de verba: gera lançamento reverso, marca o original como estornado, devolve a devolução ao estado aguardando baixa.';

revoke execute on function public.estornar_baixa_devolucao_verba(uuid, text, uuid) from public;
grant  execute on function public.estornar_baixa_devolucao_verba(uuid, text, uuid) to authenticated;
```

- [ ] **Step 2: Aplicar via MCP**

- [ ] **Step 3: Conferir via MCP**

```sql
select proname from pg_proc where pronamespace='public'::regnamespace
  and proname in (
    'fechar_prestacao_verba_pp',
    'dar_baixa_devolucao_verba',
    'estornar_baixa_devolucao_verba'
  )
order by proname;

-- EXECUTE só pra authenticated
select r.routine_name, r.grantee, r.privilege_type
from information_schema.routine_privileges r
where r.specific_schema='public'
  and r.routine_name in (
    'fechar_prestacao_verba_pp',
    'dar_baixa_devolucao_verba',
    'estornar_baixa_devolucao_verba'
  )
order by r.routine_name, r.grantee;
```

Esperado: 3 funções presentes; para cada, apenas `authenticated` tem EXECUTE.

- [ ] **Step 4: Rodar `mcp__supabase__get_advisors`**

Confirmar que `anon_security_definer_function_executable` não acusa nenhuma das 3 funções novas.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260826000006_pp_verba_rpcs_devolucao.sql
git commit -m "feat(financeiro): RPCs de devolução da verba + v2 do fechar prestação

v2 do fechar_prestacao_verba_pp agora cria pp_verba_devolucoes quando
valor_devolvido > 0 (data_pagamento = current_date, financeiro repactua).
dar_baixa_devolucao_verba espelha dar_baixa_pp_parcela mas com natureza
entrada e origem pp_devolucao_verba. Estorno espelha estornar_baixa_pp_parcela."
```

---

### Task 10: Views — `vw_a_pagar` e `vw_fluxo_caixa` incluem devoluções

Amplia as views pra que devoluções em aberto apareçam. Nada muda no fluxo realizado (lançamentos já entram pelo ramo existente).

**Files:**
- Create: `supabase/migrations/20260826000007_pp_verba_views.sql`

**Interfaces:**
- Consumes: tabela `pp_verba_devolucoes` (Task 8)
- Produces:
  - `vw_a_pagar` inclui `origem_tipo = 'pp_devolucao_verba'` para devoluções onde `pago_em is null`.
  - `vw_fluxo_caixa` inclui idem no ramo `previsto`.

- [ ] **Step 1: Verificar as colunas atuais das views**

MCP:
```sql
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='vw_a_pagar'
order by ordinal_position;
```

Confirmar que os nomes de coluna que vou usar no novo UNION batem exatamente com os das UNIONs existentes (`create or replace view` recusa mudar tipo/ordem de coluna existente — precisamos manter forma idêntica).

- [ ] **Step 2: Criar a migration**

```sql
-- =====================================================================
-- vw_a_pagar e vw_fluxo_caixa ganham devoluções de verba em aberto.
--
-- Ordem e tipos das colunas idênticos aos existentes — sem isso, o
-- create or replace view recusa a mudança. Devolução aparece com
-- natureza='entrada' (é dinheiro voltando) e sem fornecedor/cliente.
-- =====================================================================

create or replace view public.vw_a_pagar as
  select
    'pp'::text                                      as origem_tipo,
    par.id                                          as origem_id,
    pp.tenant_id,
    pp.empresa_id,
    par.data_pagamento                              as data_prevista,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'PP ' || pp.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(pp.servico, 1, 150)     as descricao,
    pp.fornecedor_id,
    null::uuid                                      as cliente_id,
    pp.job_id,
    pp.aprovada_em,
    pp.aprovada_por
  from public.pedidos_compra_parcelas par
  join public.pedidos_compra pp on pp.id = par.pedido_compra_id
  join lateral (
    select count(*)::int as total
      from public.pedidos_compra_parcelas x
     where x.pedido_compra_id = par.pedido_compra_id
  ) tot on true
  where pp.status in ('aprovada', 'pago')
    and par.pago_em is null

  union all

  select
    case when a.recorrente_id is not null then 'recorrente'::text
         else 'avulsa'::text end                    as origem_tipo,
    a.id                                            as origem_id,
    a.tenant_id,
    a.empresa_id,
    coalesce(a.data_pagamento, a.data_prevista_pagamento) as data_prevista,
    a.valor,
    a.natureza,
    a.descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_id,
    a.aprovada_em,
    a.aprovada_por
  from public.contas_avulsas a
  where a.status = 'aprovada'

  union all

  select
    'pp_devolucao_verba'::text                      as origem_tipo,
    d.id                                            as origem_id,
    d.tenant_id,
    d.empresa_id,
    d.data_pagamento                                as data_prevista,
    d.valor                                         as valor,
    'entrada'::natureza_lancamento                  as natureza,
    'Devolução verba ' || pp.codigo || ' — '
      || substring(pp.servico, 1, 140)              as descricao,
    null::uuid                                      as fornecedor_id,
    null::uuid                                      as cliente_id,
    pp.job_id,
    null::timestamptz                               as aprovada_em,
    null::uuid                                      as aprovada_por
  from public.pp_verba_devolucoes d
  join public.pedidos_compra pp on pp.id = d.pedido_compra_id
  where d.pago_em is null;

-- vw_fluxo_caixa: acrescentar devolução em aberto no ramo `previsto`.
-- (Se a view hoje tem 4 UNIONs, mantemos as 4 e adicionamos a 5ª.)
create or replace view public.vw_fluxo_caixa as
  select
    'previsto'::text                                as situacao,
    'pp'::text                                      as origem_tipo,
    par.id                                          as origem_id,
    pp.tenant_id,
    pp.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    par.data_pagamento                              as data_evento,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'PP ' || pp.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(pp.servico, 1, 150)     as descricao,
    pp.fornecedor_id,
    null::uuid                                      as cliente_id,
    pp.job_id
  from public.pedidos_compra_parcelas par
  join public.pedidos_compra pp on pp.id = par.pedido_compra_id
  join lateral (
    select count(*)::int as total
      from public.pedidos_compra_parcelas x
     where x.pedido_compra_id = par.pedido_compra_id
  ) tot on true
  where pp.status in ('aprovada', 'pago')
    and par.pago_em is null

  union all

  select
    'previsto'::text                                as situacao,
    case when a.recorrente_id is not null then 'recorrente'::text
         else 'avulsa'::text end                    as origem_tipo,
    a.id                                            as origem_id,
    a.tenant_id,
    a.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    coalesce(a.data_pagamento, a.data_prevista_pagamento) as data_evento,
    a.valor,
    a.natureza,
    a.descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_id
  from public.contas_avulsas a
  where a.status = 'aprovada'

  union all

  select
    'previsto'::text                                as situacao,
    'titulo'::text                                  as origem_tipo,
    t.id                                            as origem_id,
    t.tenant_id,
    t.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    t.data_vencimento                               as data_evento,
    t.valor,
    'entrada'::natureza_lancamento                  as natureza,
    'Título NF ' || f.numero_nf || '/' || t.numero_parcela::text as descricao,
    f.fornecedor_id,
    f.cliente_id,
    null::uuid                                      as job_id
  from public.titulos_receber t
  join public.faturamentos f on f.id = t.faturamento_id
  where t.status = 'em_aberto'

  union all

  select
    'previsto'::text                                as situacao,
    'pp_devolucao_verba'::text                      as origem_tipo,
    d.id                                            as origem_id,
    d.tenant_id,
    d.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    d.data_pagamento                                as data_evento,
    d.valor                                         as valor,
    'entrada'::natureza_lancamento                  as natureza,
    'Devolução verba ' || pp.codigo || ' — '
      || substring(pp.servico, 1, 140)              as descricao,
    null::uuid                                      as fornecedor_id,
    null::uuid                                      as cliente_id,
    pp.job_id
  from public.pp_verba_devolucoes d
  join public.pedidos_compra pp on pp.id = d.pedido_compra_id
  where d.pago_em is null

  union all

  select
    'realizado'::text                               as situacao,
    'lancamento'::text                              as origem_tipo,
    l.id                                            as origem_id,
    l.tenant_id,
    l.empresa_id,
    l.conta_bancaria_id,
    l.data_movimento                                as data_evento,
    l.valor,
    l.natureza,
    l.descricao,
    l.fornecedor_id,
    l.cliente_id,
    l.job_id
  from public.lancamentos_financeiros l;
```

**Cuidado:** o SQL acima assume que `vw_fluxo_caixa` hoje tem exatamente esses 4 UNIONs. Se a estrutura atual for diferente (a Task 1 leu a versão de 2026-08-17), o Step 1 vai revelar a divergência e o SQL precisa ser ajustado. Reler a view atual antes de aplicar.

- [ ] **Step 3: Aplicar via MCP**

- [ ] **Step 4: Conferir via MCP**

```sql
-- Confirma que a nova origem aparece
select distinct origem_tipo from vw_a_pagar order by 1;
select distinct situacao, origem_tipo from vw_fluxo_caixa order by 1, 2;
```

Esperado: `vw_a_pagar` lista `pp`, `avulsa`/`recorrente`, `pp_devolucao_verba`. `vw_fluxo_caixa` lista os previstos + realizado, incluindo `pp_devolucao_verba` como previsto.

Se não tiver dado ainda pra popular, tudo bem — a estrutura da view é o que importa.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260826000007_pp_verba_views.sql
git commit -m "feat(financeiro): vw_a_pagar e vw_fluxo_caixa incluem devoluções

Devolução em aberto aparece com origem_tipo='pp_devolucao_verba' e
natureza='entrada'. Realizado já entra pelo ramo de lancamentos
existente — nada a acrescentar."
```

---

### Task 11: Integração na aba Títulos a Pagar

Devolução aparece como linha na aba Títulos a Pagar. Componente lista já itera sobre `origem_tipo` — precisa fetch novo no server component, aceitar novo `origem` no `TituloRow`, e as actions de baixa/estorno fazem dispatch pro RPC certo.

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/titulos-pagar-list.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-titulos.ts`
- Modify: `components/financeiro/baixa-registrada-dialog.tsx` (se necessário — dispatch de estorno)

**Interfaces:**
- Consumes:
  - View `vw_a_pagar` com origem nova (Task 10) — mas o fetch fica direto na tabela `pp_verba_devolucoes` (mais simples, alinhado com o padrão do resto do page.tsx)
  - RPCs `dar_baixa_devolucao_verba` e `estornar_baixa_devolucao_verba` (Task 9)
- Produces:
  - `TituloRow` aceita `origem === "pp_devolucao_verba"`; nesses casos `parcela_numero/parcela_total = 1/1`, `fornecedor_nome = ""`, `origem_label = "DEVOLUÇÃO VERBA"`.
  - `darBaixaTitulo` e `estornarBaixaTitulo` dispatcham pra os novos RPCs quando `origem === "pp_devolucao_verba"`.

- [ ] **Step 1: Fetch das devoluções em aberto no `page.tsx`**

Adicionar ao `Promise.all`:

```ts
supabase
  .from("pp_verba_devolucoes")
  .select(`
    id, tenant_id, empresa_id, valor, data_pagamento, data_pagamento_primeira,
    pago_em, pago_por,
    lancamento:lancamentos_financeiros!lancamento_id(
      id, data_movimento, conta_bancaria_id, plano_conta_tipo_id, plano_conta_subtipo_id
    ),
    prestacao:pp_verba_prestacoes!prestacao_id(id, fechada_em),
    pp:pedidos_compra!pedido_compra_id(id, codigo, servico, job_id,
      job:jobs(id, codigo, nome)
    )
  `)
  .eq("tenant_id", session.activeTenant.id),
```

- [ ] **Step 2: Montar TituloRows de devolução**

Depois do Promise.all, mapear cada devolução para um `TituloRow`:

```ts
const devolucoesRows: TituloRow[] = (devolucoesRes.data ?? []).map((d) => ({
  id: d.id,
  origem: "pp_devolucao_verba" as OrigemTitulo,
  origem_label: `DEVOLUÇÃO ${d.pp?.codigo ?? ""}`,
  descricao: `Devolução verba ${d.pp?.codigo ?? ""} — ${d.pp?.servico ?? ""}`,
  fornecedor_nome: "",
  job_codigo: d.pp?.job?.codigo ?? "",
  data_pagamento: d.data_pagamento,
  venc_original: d.data_pagamento_primeira,
  data_pagamento_primeira: d.data_pagamento_primeira,
  valor: Number(d.valor),
  parcela_numero: 1,
  parcela_total: 1,
  status: (d.pago_em ? "pago" : "a_pagar") as TituloPagarStatus,
  empresa_id: d.empresa_id,
  plano_conta_tipo_id: d.lancamento?.plano_conta_tipo_id ?? null,
  plano_conta_subtipo_id: d.lancamento?.plano_conta_subtipo_id ?? null,
  pago_em: d.pago_em,
  conta_nome: null,  // resolvido no client se precisar
  centro_nome: null,
  forma_pagamento: null,
  cartao_credito_id: null,
}));
```

Concatenar `devolucoesRows` no array que vai pra `<TitulosPagarList titulos={...} />`.

- [ ] **Step 3: `titulos-pagar-list.tsx` — tratar origem nova**

Onde o componente renderiza a linha:
- Badge: se `origem === "pp_devolucao_verba"`, mostrar chip "Devolução verba" com classe `bg-emerald-100 text-emerald-800` (verde) em vez do padrão.
- Valor: se `origem === "pp_devolucao_verba"`, exibir com prefixo `+` e cor emerald (é entrada).
- Fornecedor: se vazio, mostrar "—".

Aonde há filtros/checkbox de "baixa em lote", **excluir devoluções** — baixa em lote hoje é só pra saídas. Devolução baixa uma a uma (menos comum).

- [ ] **Step 4: `actions-titulos.ts` — dispatch por origem**

Ampliar o `origemSchema`:
```ts
const origemSchema = z.enum(["pp", "avulso", "recorrencia", "desembolso", "pp_devolucao_verba"]);
```

Em `darBaixaTitulo`, adicionar branch:
```ts
if (parsed.data.origem === "pp_devolucao_verba") {
  const { data, error } = await supabase.rpc("dar_baixa_devolucao_verba", {
    p_devolucao_id: parsed.data.id,
    p_pago_em: parsed.data.pago_em,
    p_conta_bancaria_id: parsed.data.conta_bancaria_id,
    p_plano_conta_tipo_id: parsed.data.plano_conta_tipo_id,
    p_plano_conta_subtipo_id: parsed.data.plano_conta_subtipo_id,
    p_criado_por: session.user.id,
  });
  if (error) return { ok: false, message: mensagemDeBaixa(error.message) };
  await logAuditEvent({ ... });
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}
```

Em `estornarBaixaTitulo`, análogo com `estornar_baixa_devolucao_verba`.

Ampliar `mensagemDeBaixa` se houver alguma constraint específica que possa surgir do RPC de devolução (ex.: "Esta devolução já foi baixada." — o RPC já retorna essa string pronta, sem prefixo do Postgres, então cai no fallback `limpa`).

- [ ] **Step 5: `BaixaRegistradaDialog` (dispatch de estorno)**

Verificar se o dialog de "baixa registrada" (visualizar + estornar) aceita a nova origem. Se ele já chama `estornarBaixaTitulo(origem, id, motivo)`, funciona sem mudança porque a action já dispatcha corretamente após o Step 4.

Se ele tem alguma renderização/label específica por origem, adicionar caso `pp_devolucao_verba` com label adequado ("Estornar baixa da devolução").

- [ ] **Step 6: Labels do modal de baixa**

O `BaixaTituloDialog` unifica todas as origens. Verificar se ele exibe algum texto tipo "Data do pagamento" — se a UX pedir "Data em que o dinheiro caiu na conta" pra devoluções, ajustar via prop condicional. Se o texto atual for suficientemente neutro ("Data da baixa"), deixar como está.

- [ ] **Step 7: `npm run build`**

- [ ] **Step 8: Smoke test manual**

- Fechar prestação de contas de uma PP verba paga onde `valor_gasto < valor_pp`.
- Confirmar que na aba Contas a Pagar > Títulos a Pagar aparece a linha nova com badge "Devolução verba" e valor em verde.
- Clicar em baixar, escolher conta + data + plano de contas, confirmar.
- Confirmar via MCP: `select id, pago_em, lancamento_id from pp_verba_devolucoes;` — devolução ficou com `pago_em` preenchido; lançamento apareceu em `lancamentos_financeiros` com `origem='pp_devolucao_verba'` e `natureza='entrada'`.
- Testar estorno: `BaixaRegistradaDialog` → estornar com motivo. Confirmar: devolução volta a `pago_em is null`, lançamento original tem `origem='pp_devolucao_verba_estornada'`, existe lançamento reverso com `natureza='saida'`.

- [ ] **Step 9: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/page.tsx \
        app/\(app\)/financeiro/contas-a-pagar/titulos-pagar-list.tsx \
        app/\(app\)/financeiro/contas-a-pagar/actions-titulos.ts \
        components/financeiro/baixa-registrada-dialog.tsx
git commit -m "feat(financeiro): devolução de verba na aba Títulos a Pagar

Fetch de pp_verba_devolucoes no server component, tratamento de
origem 'pp_devolucao_verba' na lista (badge e valor verdes), actions
dispatcham para dar_baixa_devolucao_verba / estornar_baixa_devolucao_verba.
Devolução fica de fora da baixa em lote (baixa individual só)."
```

---

### Task 12: Exibição "Verba de Produção" nas listas de PP

PPs verba precisam se distinguir visualmente das PPs normais em qualquer lista que hoje mostra "Fornecedor: X". Onde antes aparecia o nome do fornecedor, aparece "Verba de Produção — {Nome do responsável}".

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/pedidos-compra-list.tsx` — badge + swap de nome
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx` — trazer `responsavel:profiles!responsavel_verba_id(nome)` no select da PP
- Verificar: `app/(app)/jobs/[jobId]/realizado/painel-pps-item.tsx` (lista de PPs do item) — mesmo tratamento
- Verificar: `app/(app)/financeiro/contas-a-pagar/pp-drawer-financeiro.tsx` — mesmo tratamento no header

**Interfaces:**
- Consumes: campos `verba_producao` e `responsavel_verba_id` do tipo `PedidoCompra` (Task 1)
- Produces: exibição consistente "Verba de Produção — {responsavel}" onde antes aparecia fornecedor.

- [ ] **Step 1: Trazer responsável nas queries**

Em `page.tsx`, no select da PP:
```ts
`
...
fornecedor:fornecedores(id, nome, razao_social),
responsavel:profiles!responsavel_verba_id(id, nome),
...
`
```

Fazer o mesmo em toda outra query que traz PP e precisa do rótulo (grep por `fornecedor:fornecedores` em queries de PP).

- [ ] **Step 2: Helper de rótulo**

Adicionar em `lib/types.ts`:
```ts
export function nomeContraparteBRPP(
  pp: {
    verba_producao?: boolean | null;
    fornecedor?: { nome?: string | null; razao_social?: string | null } | null;
    responsavel?: { nome?: string | null } | null;
  },
): string {
  if (pp.verba_producao) {
    return `Verba de Produção — ${pp.responsavel?.nome ?? "sem responsável"}`;
  }
  return pp.fornecedor?.nome ?? pp.fornecedor?.razao_social ?? "";
}
```

- [ ] **Step 3: Aplicar o helper em `pedidos-compra-list.tsx`**

Onde renderiza `pp.fornecedor?.nome`, trocar por `nomeContraparteBRPP(pp)`. Adicionar badge visual pequeno "Verba" ao lado do código quando `pp.verba_producao`:

```tsx
<span className="text-sm">{pp.codigo}</span>
{pp.verba_producao && (
  <span className="ml-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
    Verba
  </span>
)}
```

- [ ] **Step 4: Aplicar o helper em `pp-drawer-financeiro.tsx`**

Onde o header do drawer mostra "Fornecedor: X", usar `nomeContraparteBRPP(pp)`. Label da linha muda condicional:
```tsx
<div className="text-xs text-neutral-500">
  {pp.verba_producao ? "Responsável" : "Fornecedor"}
</div>
<div>{nomeContraparteBRPP(pp)}</div>
```

- [ ] **Step 5: `painel-pps-item.tsx` (lista de PPs do item, na tela do job)**

Se a lista mostra o nome do fornecedor por PP, aplicar o mesmo helper. Se só mostra código + valor, nada muda.

- [ ] **Step 6: `npm run build`**

- [ ] **Step 7: Smoke test manual**

- Emitir uma PP verba, uma PP normal — as duas aparecem na mesma lista (contas-a-pagar).
- A verba mostra badge "Verba" e nome do responsável; a normal mostra nome do fornecedor.
- Abrir o drawer da verba — header mostra "Responsável: X" no lugar de "Fornecedor: X".

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/pedidos-compra-list.tsx \
        app/\(app\)/financeiro/contas-a-pagar/page.tsx \
        app/\(app\)/financeiro/contas-a-pagar/pp-drawer-financeiro.tsx \
        app/\(app\)/jobs/\[jobId\]/realizado/painel-pps-item.tsx \
        lib/types.ts
git commit -m "feat(financeiro): PPs de verba mostram responsável no lugar do fornecedor

Helper nomeContraparteBRPP centraliza a decisão. Badge 'Verba' na lista.
Header do drawer troca 'Fornecedor' por 'Responsável' quando aplicável."
```

---

### Task 13: Smoke test E2E manual + fechamento

Verificação de ponta a ponta antes de considerar o feature entregue.

**Files:** nenhum (só verificação manual e commit final se algo tiver escapado).

- [ ] **Step 1: Fluxo feliz completo**

1. Emitir PP de verba com valor R$ 50.000, responsável X, uma parcela.
2. Aprovar (aba Pedidos de Produção → aprovar com data).
3. Baixar a parcela (aba Títulos a Pagar → baixar).
4. Confirmar via MCP: `pedidos_compra.status = 'pago'` para essa PP; existe lançamento de saída com `pedido_compra_id` = essa PP.
5. Abrir drawer da PP → seção "Prestação de contas" mostra botão.
6. Clicar em "Prestar contas" → digitar R$ 40.000, anexar 2 arquivos (1 PDF + 1 JPG).
7. Confirmar. Card readonly aparece: "Devolvido R$ 10.000,00".
8. Ir pra aba Títulos a Pagar → linha nova "Devolução verba PP-XXXX" com +R$ 10.000 em verde.
9. Clicar em baixar → escolher conta, data (hoje), plano de contas → confirmar.
10. Confirmar via MCP: `pp_verba_devolucoes.pago_em` preenchido; existe lançamento de entrada com `origem='pp_devolucao_verba'` e valor R$ 10.000.
11. No agregado do job / planilha REALIZADO, custo dessa PP passa a ser R$ 40.000 (não R$ 50.000).

- [ ] **Step 2: Fluxos de bloqueio**

Cada um destes deve mostrar mensagem clara ao usuário:

- Tentar prestar contas de PP não paga → botão desabilitado com aviso.
- Digitar valor gasto = 0 → botão desabilitado.
- Digitar valor gasto > valor da PP → toast "O valor gasto não pode ser maior que o valor da PP".
- Tentar prestar contas 2x na mesma PP → toast "Esta PP já tem prestação de contas registrada."
- Zerar valor gasto (digitar 0 depois de válido) → botão volta a ficar desabilitado.

- [ ] **Step 3: Estorno da devolução**

1. A partir do estado "devolução baixada" (Step 1 item 9), abrir `BaixaRegistradaDialog` (clicar na linha da devolução paga).
2. Estornar com motivo "conferência errada".
3. Confirmar via MCP:
   - `pp_verba_devolucoes` volta a `pago_em is null`.
   - Lançamento original tem `origem='pp_devolucao_verba_estornada'`.
   - Existe lançamento reverso com `natureza='saida'`, `origem='pp_devolucao_verba_estornada'`, `estorno_de_lancamento_id` apontando pro original.
4. A linha da devolução reaparece na aba Títulos a Pagar como "a pagar".

- [ ] **Step 4: Coerência de PP normal (regressão)**

- Emitir uma PP normal (verba OFF).
- Aprovar, baixar todas as parcelas, cancelar (se cancelável), estornar baixa de parcela.
- Nada deve estar quebrado — o feature novo só adicionou coisas.

- [ ] **Step 5: Advisor Supabase**

```
mcp__supabase__get_advisors (type: security)
```

Nenhum novo alerta relacionado às funções/tabelas criadas.

- [ ] **Step 6: `npm run build` final**

Passar limpo.

- [ ] **Step 7: Se nada faltou, mensagem de fim**

Nenhum commit adicional. Se algo apareceu no Step 3 (bug ou regressão), abrir novo commit `fix(...)` na convenção do projeto e listar o que foi corrigido.

---

## Self-review

Passei a spec e o plano em revista:

**1. Cobertura da spec (§2 do design):**
- Frente 1 (extensão de `pedidos_compra`) → Task 1
- Frente 2 (`pp_verba_prestacoes` + anexos) → Task 3
- Frente 3 (`pp_verba_devolucoes`) → Tasks 7 + 8
- Frente 4 (integração de UI) → Tasks 2, 5, 6, 11, 12

Detalhes:
- RPCs `fechar_prestacao_verba_pp`, `dar_baixa_devolucao_verba`, `estornar_baixa_devolucao_verba` → Tasks 4 e 9.
- Extensão de `vw_a_pagar` + `vw_fluxo_caixa` → Task 10.
- Enum `origem_lancamento` ampliado → Task 7 (migration separada, como manda o padrão).
- Aba "Prestação de contas" no drawer → Task 6.
- Dialog "Prestar contas" → Task 5.
- Badge + swap fornecedor/responsável em listas → Task 12.
- Verificação E2E → Task 13.

**2. Placeholder scan:** Sem "TBD"/"TODO" nas tasks. Notas de "verificar" são ações concretas (rodar query MCP, checar constraint atual) com o comando exato.

**3. Consistência de tipos:**
- `OrigemTitulo` ampliado na Task 8 e usado nas Tasks 11 e 12 — consistente.
- Nome da coluna `pp_verba_devolucao_id` em `lancamentos_financeiros` (Task 8) usado nos RPCs (Task 9) — consistente.
- `PPRow` estendido na Task 6 é o que consumimos na Task 11 e 12 (via page.tsx) — consistente.
- Nome do helper `nomeContraparteBRPP` definido na Task 12 e usado só ali — consistente.
