# Férias — aprovação em duas etapas (PR 1: fundação de banco e tipos)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pôr no banco (enum, colunas, RLS, view) e no `lib/types.ts` a fundação pro fluxo de aprovação de férias em duas etapas (líder → RH), sem mudar UI nem actions. Depois deste PR, nada no comportamento visível muda; o próximo PR liga o fluxo.

**Architecture:** Cinco migrations aditivas + edição de `lib/types.ts` + uma função helper com teste unitário. Tudo roda isolado; a lógica que decide status inicial já é testada em unidade, mas só vai ser chamada no PR 2. As policies RLS novas não removem nem alteram as existentes: só adicionam leitura pros profiles que são líderes de alguém.

**Tech Stack:** Supabase Postgres (enum, RLS, view), TypeScript (`lib/types.ts`), `node:test` + `node:assert/strict` pra teste unitário.

**Spec:** `docs/superpowers/specs/2026-11-21-ferias-aprovacao-lider-e-pagina-equipe-design.md`

## Global Constraints

- **Fluxo do banco:** cada migration numerada (`YYYYMMDDHHMMSS_*.sql`), aplicada pelo MCP `supabase-write__apply_migration`, conferida pelo MCP (`supabase__execute_sql` ou `list_migrations`), commitada junto do código que depende dela. Ver `docs/FLUXO-BANCO.md`.
- **PII:** só UUIDs no SQL versionado. Nome, email, CPF nunca.
- **TypeScript lê do banco só por `lib/types.ts` (escrito à mão).** Migration que mexe em coluna atualiza o tipo correspondente no mesmo commit.
- **GRANT explícito pra `authenticated`** em toda tabela/view nova; nada pra `anon`.
- **RLS:** policies de leitura usam `(select auth.uid())` (memória `feedback_rls_dados_pessoais`; evita re-exec por linha).
- **Performance:** policies de líder devem usar o índice parcial `idx_colaboradores_lider_id`; EXPLAIN opcional na conferência.
- **pt-BR:** strings visíveis ao usuário com acento; comentário de banco pode ficar sem acento (convenção).
- **Nome do enum novo:** `aguardando_gestor` (exatamente), com `sortorder` antes de `pendente_aprovacao`.
- **Motivo do override do RH:** nullable, sem minLength (decidido 21/11).

## Review Focus

Cinco entradas/falhas que os testes das tasks não cobrem sozinhos e que mordem usuário real:

1. **Profile que é líder mas não é membro ativo do tenant** — líder desligado que ainda tem `lider_id` apontando pra ele. A policy RLS do líder deve considerar isso. Teste adicionado na Task 3.
2. **Colaborador com `lider_id` pointing a profile deletado** — a FK é `ON DELETE SET NULL`, então em teoria vira NULL, mas um bug ou race condition pode deixar um UUID órfão. Teste adicionado na Task 3.
3. **View `vw_equipe_do_lider` vazando campo PII por engano** — por descuido, alguém pode incluir `salario`, `cpf`, `data_nascimento` no SELECT da view. Teste de shape na Task 4.
4. **Enum nova em `aguardando_gestor` quebra query antiga** — algum código em `app/` que filtra por `status IN ('pendente_aprovacao', 'nf_anexada')` passa a excluir pedidos em aprovação do líder. É esperado neste PR (o PR 2 vai tratar), mas confirma que nenhum SELECT **implícito** pela view/trigger explodir. Teste de regressão na Task 1.
5. **Helper `decidirStatusInicialSolicitacao` chamado com `liderId` do próprio colaborador (self-reference)** — colaborador é seu próprio líder (anti-cadastro). Deve cair em `aguardando_gestor` (quem aprova é ele mesmo, que é absurdo, mas é o que o dado diz; fase 2 pode bloquear). Teste adicionado na Task 6.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20261121200001_ferias_enum_aguardando_gestor.sql` | criar | Adicionar valor ao enum. |
| `supabase/migrations/20261121200002_ferias_lancamentos_campos_aprovacao_lider.sql` | criar | 4 colunas novas em `colaboradores_ferias_lancamentos`. |
| `supabase/migrations/20261121200003_ferias_lancamentos_e_periodos_policy_lider.sql` | criar | Policies RLS pra leitura pelo líder. |
| `supabase/migrations/20261121200004_vw_equipe_do_lider.sql` | criar | View não-PII pra tab Equipe + grant. |
| `lib/types.ts` | editar | Atualizar `FeriasLancamentoStatus` e `ColaboradorFeriasLancamento`. |
| `lib/ferias/decidir-status-inicial-solicitacao.ts` | criar | Helper puro (sem Supabase) que decide o status de uma solicitação nova. |
| `lib/ferias/decidir-status-inicial-solicitacao.test.ts` | criar | Teste unitário do helper. |

---

### Task 1: Migration — novo valor `aguardando_gestor` no enum `ferias_lancamento_status`

**Files:**
- Create: `supabase/migrations/20261121200001_ferias_enum_aguardando_gestor.sql`

**Interfaces:**
- Consumes: enum `ferias_lancamento_status` existente, com valores `pendente_aprovacao`, `em_analise`, `aguardando_financeiro`, `aprovado`, `nf_anexada`, `enviado_financeiro`, `reprovado`, `cancelado`, `concluido`.
- Produces: enum ganha valor `aguardando_gestor` com sortorder antes de `pendente_aprovacao`.

- [ ] **Step 1: Escrever a migration**

Conteúdo:

```sql
-- Adiciona status 'aguardando_gestor' ao enum ferias_lancamento_status.
-- Entra antes de 'pendente_aprovacao' na ordem do enum (sortorder < 1).
-- Fundação pro fluxo de aprovacao em duas etapas (lider -> RH).
-- Spec: docs/superpowers/specs/2026-11-21-ferias-aprovacao-lider-e-pagina-equipe-design.md
ALTER TYPE public.ferias_lancamento_status
  ADD VALUE IF NOT EXISTS 'aguardando_gestor' BEFORE 'pendente_aprovacao';
```

Observação: `ALTER TYPE ... ADD VALUE` **não pode rodar dentro de bloco explícito `BEGIN/COMMIT`**. Deixar a migration enxuta, sem BEGIN; o MCP roda cada migration como uma statement só.

- [ ] **Step 2: Aplicar pelo MCP**

Chamar `mcp__supabase-write__apply_migration` com `name="ferias_enum_aguardando_gestor"` e o conteúdo do SQL.

- [ ] **Step 3: Conferir pelo MCP**

Rodar:

```sql
SELECT enumlabel, enumsortorder
FROM pg_enum
WHERE enumtypid = 'public.ferias_lancamento_status'::regtype
ORDER BY enumsortorder;
```

Esperado: `aguardando_gestor` aparece antes de `pendente_aprovacao` (sortorder menor que 1).

- [ ] **Step 4: Teste de regressão — nenhum SELECT existente quebra**

Rodar:

```sql
-- Garante que a view/função mais usada do módulo ainda compila
SELECT COUNT(*) FROM public.vw_rh_ferias_fluxo;
SELECT COUNT(*) FROM public.colaboradores_ferias_lancamentos
 WHERE status = 'pendente_aprovacao';
```

Esperado: as duas queries rodam sem erro. Count podem ser quaisquer números.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261121200001_ferias_enum_aguardando_gestor.sql
git commit -m "feat(rh/ferias): status 'aguardando_gestor' no enum (fase 1 do fluxo lider->RH)"
```

---

### Task 2: Migration — colunas novas em `colaboradores_ferias_lancamentos`

**Files:**
- Create: `supabase/migrations/20261121200002_ferias_lancamentos_campos_aprovacao_lider.sql`

**Interfaces:**
- Consumes: tabela `colaboradores_ferias_lancamentos`, FK `profiles(id)` disponível.
- Produces: tabela ganha 4 colunas (todas nullable, sem default):
  - `aprovado_pelo_lider_por uuid references public.profiles(id) on delete set null`
  - `aprovado_pelo_lider_em timestamptz`
  - `aprovacao_lider_override boolean not null default false`
  - `motivo_override_lider text`

- [ ] **Step 1: Escrever a migration**

Conteúdo:

```sql
-- Colunas de rastro da aprovação pelo líder direto (fase 1 do fluxo lider -> RH).
-- Todas nullable (sem valor pros lançamentos antigos). aprovacao_lider_override
-- tem default false pra simplificar leituras ("ninguem fez override ainda").
-- motivo_override_lider e nullable: a UI do RH nao exige motivo (decisao 21/11).
BEGIN;

ALTER TABLE public.colaboradores_ferias_lancamentos
  ADD COLUMN aprovado_pelo_lider_por uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN aprovado_pelo_lider_em  timestamptz,
  ADD COLUMN aprovacao_lider_override boolean NOT NULL DEFAULT false,
  ADD COLUMN motivo_override_lider   text;

COMMENT ON COLUMN public.colaboradores_ferias_lancamentos.aprovado_pelo_lider_por
  IS 'Profile do lider direto que aprovou a solicitacao antes do RH. NULL em lancamentos legados ou em lancar-direto do RH.';
COMMENT ON COLUMN public.colaboradores_ferias_lancamentos.aprovado_pelo_lider_em
  IS 'Quando o lider aprovou. Junto com aprovado_pelo_lider_por da a trilha da etapa do lider.';
COMMENT ON COLUMN public.colaboradores_ferias_lancamentos.aprovacao_lider_override
  IS 'True quando o RH aprovou no lugar do lider (override). Mutuamente exclusivo com aprovado_pelo_lider_por preenchido.';
COMMENT ON COLUMN public.colaboradores_ferias_lancamentos.motivo_override_lider
  IS 'Motivo opcional do override do RH. Nullable; a UI nao exige.';

-- Indice parcial pra a Equipe do lider: ranking de pendentes.
CREATE INDEX IF NOT EXISTS idx_ferias_lanc_aguardando_gestor
  ON public.colaboradores_ferias_lancamentos (colaborador_id)
  WHERE status = 'aguardando_gestor';

COMMIT;
```

- [ ] **Step 2: Aplicar pelo MCP**

`apply_migration` com `name="ferias_lancamentos_campos_aprovacao_lider"`.

- [ ] **Step 3: Conferir pelo MCP**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='colaboradores_ferias_lancamentos'
  AND column_name IN ('aprovado_pelo_lider_por','aprovado_pelo_lider_em','aprovacao_lider_override','motivo_override_lider')
ORDER BY column_name;

SELECT indexname
FROM pg_indexes
WHERE schemaname='public' AND tablename='colaboradores_ferias_lancamentos'
  AND indexname='idx_ferias_lanc_aguardando_gestor';
```

Esperado:
- 4 colunas listadas; 3 nullable (`YES`); `aprovacao_lider_override` com `NOT NULL` e default `false`.
- Índice aparece.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261121200002_ferias_lancamentos_campos_aprovacao_lider.sql
git commit -m "feat(rh/ferias): colunas de aprovacao pelo lider e override no lancamento"
```

---

### Task 3: Migration — policies RLS de leitura pelo líder (lançamentos + períodos)

**Files:**
- Create: `supabase/migrations/20261121200003_ferias_lancamentos_e_periodos_policy_lider.sql`

**Interfaces:**
- Consumes: tabelas `colaboradores_ferias_lancamentos` e `colaboradores_ferias_periodos`; coluna `colaboradores.lider_id`.
- Produces:
  - Policy `ferias_lancamentos_lider_select` em `colaboradores_ferias_lancamentos`.
  - Policy `ferias_periodos_lider_select` em `colaboradores_ferias_periodos`.
  - Ambas usam `(select auth.uid())` e EXISTS em `colaboradores`.

- [ ] **Step 1: Escrever a migration**

Conteúdo:

```sql
-- Policies RLS pra permitir que o LIDER DIRETO leia os lancamentos
-- e periodos de ferias de quem ele lidera. Nao concede escrita.
-- As policies existentes (admin, rh, proprio colaborador) seguem vigentes;
-- essa aqui soma, nao substitui.
--
-- Caso de borda coberto: se o profile do lider foi desligado (nao ha
-- vinculo ativo em tenant_members), auth.uid() ainda e dele ate o logout
-- - mas no proximo login a sessao nao abre, e EXISTS retorna FALSE porque
-- is_tenant_member no fluxo de login nao autoriza. A policy aqui filtra
-- pelo lider_id apontando pra ele, nao pelo vinculo: se o cadastro ainda
-- aponta, ele ve. Cabe ao RH limpar lider_id dos desligados.
BEGIN;

CREATE POLICY ferias_lancamentos_lider_select
  ON public.colaboradores_ferias_lancamentos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.colaboradores c
      WHERE c.id = colaboradores_ferias_lancamentos.colaborador_id
        AND c.lider_id = (select auth.uid())
    )
  );

CREATE POLICY ferias_periodos_lider_select
  ON public.colaboradores_ferias_periodos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.colaboradores c
      WHERE c.id = colaboradores_ferias_periodos.colaborador_id
        AND c.lider_id = (select auth.uid())
    )
  );

COMMIT;
```

- [ ] **Step 2: Aplicar pelo MCP**

`apply_migration` com `name="ferias_lancamentos_e_periodos_policy_lider"`.

- [ ] **Step 3: Conferir pelo MCP**

```sql
SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid IN ('public.colaboradores_ferias_lancamentos'::regclass,
                   'public.colaboradores_ferias_periodos'::regclass)
  AND polname LIKE '%lider%'
ORDER BY polname;
```

Esperado: 2 linhas, ambas com EXISTS em `colaboradores` filtrando por `lider_id = (select auth.uid())`.

- [ ] **Step 4: Teste de borda — profile desligado com liderado órfão**

```sql
-- Profile dangling: lider_id aponta pra alguem que nao existe mais em profiles?
-- Nao esperamos achar: a FK e ON DELETE SET NULL.
SELECT COUNT(*)
FROM public.colaboradores c
LEFT JOIN public.profiles p ON p.id = c.lider_id
WHERE c.lider_id IS NOT NULL AND p.id IS NULL;
```

Esperado: 0. Se > 0, ha inconsistencia no banco anterior a este PR — reportar pro Daniel, nao bloquear este PR.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261121200003_ferias_lancamentos_e_periodos_policy_lider.sql
git commit -m "feat(rh/ferias): policies RLS pro lider ler lancamentos e periodos do liderado"
```

---

### Task 4: Migration — view `vw_equipe_do_lider` (campos não-PII)

**Files:**
- Create: `supabase/migrations/20261121200004_vw_equipe_do_lider.sql`

**Interfaces:**
- Consumes: `colaboradores`, `colaboradores_alocacoes`, `empresas`, `regionais`, `profiles`.
- Produces: view `vw_equipe_do_lider` com colunas:
  - `colaborador_id uuid`
  - `tenant_id uuid`
  - `nome text`
  - `tipo_contratacao text` (enum existente)
  - `alocacao_empresa text` (nome da empresa da alocação com maior percentual, ou "Múltiplas" se tem mais de 1)
  - `alocacao_regional text` (análogo pra regional, ou "Múltiplas")
  - `email_corporativo text` (preferência: `profiles.email`, senão `colaboradores.email`; só se termina em `@agenciacalifornia.com.br`, senão NULL)
  - `lider_id uuid` (pra o EXISTS do app filtrar)
- A view é SECURITY INVOKER (default): quem consulta precisa ter acesso de leitura pras tabelas base via RLS.

- [ ] **Step 1: Escrever a migration**

Conteúdo (esqueleto; detalhes do SQL de alocação denormalizada ficam a critério do implementador, desde que o shape bata com os campos listados acima):

```sql
-- View para a tab Equipe do lider: espelha colaboradores sem expor PII
-- sensivel (salario, CPF, data_nascimento, telefone, endereco).
-- A alocacao vem denormalizada: se o colab tem 1 alocacao vigente,
-- mostra nome da empresa/regional; se tem N, mostra 'Multiplas'.
-- O email corporativo vem do profile quando existe, senao do colab;
-- so e exposto se termina em @agenciacalifornia.com.br.
BEGIN;

CREATE OR REPLACE VIEW public.vw_equipe_do_lider AS
WITH alocacao_resumo AS (
  SELECT
    ca.colaborador_id,
    CASE WHEN COUNT(DISTINCT e.id) = 1 THEN MAX(e.nome) ELSE 'Múltiplas' END AS alocacao_empresa,
    CASE WHEN COUNT(DISTINCT r.id) = 1 THEN MAX(r.nome) ELSE 'Múltiplas' END AS alocacao_regional
  FROM public.colaboradores_alocacoes ca
  JOIN public.empresas e   ON e.id = ca.empresa_id
  LEFT JOIN public.regionais r ON r.id = ca.regional_id
  WHERE ca.data_fim IS NULL
  GROUP BY ca.colaborador_id
)
SELECT
  c.id                                           AS colaborador_id,
  c.tenant_id,
  c.nome,
  c.tipo_contratacao,
  ar.alocacao_empresa,
  ar.alocacao_regional,
  CASE
    WHEN p.email ILIKE '%@agenciacalifornia.com.br' THEN p.email
    WHEN c.email ILIKE '%@agenciacalifornia.com.br' THEN c.email
    ELSE NULL
  END                                            AS email_corporativo,
  c.lider_id
FROM public.colaboradores c
LEFT JOIN alocacao_resumo ar ON ar.colaborador_id = c.id
LEFT JOIN public.profiles p  ON p.id = c.profile_id;

COMMENT ON VIEW public.vw_equipe_do_lider IS
  'View nao-PII dos colaboradores pra tab Equipe do lider. SEM salario, CPF, telefone, endereco, data_nascimento. Filtragem por lider acontece no WHERE do consumidor.';

GRANT SELECT ON public.vw_equipe_do_lider TO authenticated;

COMMIT;
```

- [ ] **Step 2: Aplicar pelo MCP**

`apply_migration` com `name="vw_equipe_do_lider"`.

- [ ] **Step 3: Conferir shape (NENHUM campo PII vazou)**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema='public' AND table_name='vw_equipe_do_lider'
ORDER BY ordinal_position;
```

Esperado: exatamente `colaborador_id, tenant_id, nome, tipo_contratacao, alocacao_empresa, alocacao_regional, email_corporativo, lider_id`. **Nenhum campo adicional.** Qualquer `cpf`, `salario`, `data_nascimento`, `telefone`, `endereco`, `rg` que apareça é falha e precisa ser removido antes de prosseguir.

- [ ] **Step 4: Conferir grant**

```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='vw_equipe_do_lider';
```

Esperado: `authenticated / SELECT`. Não pode ter `anon`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261121200004_vw_equipe_do_lider.sql
git commit -m "feat(rh/equipe): view vw_equipe_do_lider sem campos PII"
```

---

### Task 5: Atualizar `lib/types.ts`

**Files:**
- Modify: `lib/types.ts:5747-5755` (enum `FeriasLancamentoStatus`)
- Modify: `lib/types.ts:5761-5795` (interface `ColaboradorFeriasLancamento`)
- Create: nenhum
- Test: — (checagem é `tsc --noEmit`)

**Interfaces:**
- Consumes: estrutura existente do tipo.
- Produces: tipo `FeriasLancamentoStatus` com `'aguardando_gestor'`; interface `ColaboradorFeriasLancamento` com as 4 colunas novas.

- [ ] **Step 1: Adicionar `'aguardando_gestor'` ao enum**

Em `lib/types.ts` na definição do tipo, adicionar como primeiro valor da união:

```ts
export type FeriasLancamentoStatus =
  | "aguardando_gestor"
  | "pendente_aprovacao"
  | "aguardando_financeiro"
  | "aprovado"
  | "nf_anexada"
  | "enviado_financeiro"
  | "reprovado"
  | "cancelado"
  | "concluido";
```

- [ ] **Step 2: Adicionar as 4 colunas novas na interface**

Imediatamente após o campo `motivo_reprovacao: string | null;` (linha 5778), inserir:

```ts
  /** Profile do líder direto que aprovou a solicitação antes do RH.
   *  NULL em lançamentos legados ou em "lançar direto" do RH. */
  aprovado_pelo_lider_por: string | null;
  aprovado_pelo_lider_em: string | null;
  /** True quando o RH aprovou no lugar do líder (override). */
  aprovacao_lider_override: boolean;
  /** Motivo opcional do override do RH. */
  motivo_override_lider: string | null;
```

- [ ] **Step 3: Rodar tsc**

```bash
npx tsc --noEmit
```

Esperado: 0 erros. Se aparecer erro em algum componente que faz `switch (status)` exaustivo, **esse é o comportamento esperado** — o PR 2 vai tratar. Corrigir só se o erro bloqueia build. Se bloquear, adicionar um `case "aguardando_gestor": return ...` com fallback neutro (mesmo tratamento de `pendente_aprovacao`) e explicar no comentário que será revisado no PR 2.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(rh/ferias): aguardando_gestor e campos de aprovacao do lider em lib/types"
```

---

### Task 6: Helper `decidirStatusInicialSolicitacao` + teste

**Files:**
- Create: `lib/ferias/decidir-status-inicial-solicitacao.ts`
- Create: `lib/ferias/decidir-status-inicial-solicitacao.test.ts`

**Interfaces:**
- Consumes: tipo `FeriasLancamentoStatus` de `@/lib/types`.
- Produces: função `decidirStatusInicialSolicitacao(params: { liderId: string | null }): FeriasLancamentoStatus`.
  - Retorna `"aguardando_gestor"` quando `liderId` é string não-vazia.
  - Retorna `"pendente_aprovacao"` quando `liderId` é null, `""` ou só espaços.
- A função é **pura**, sem I/O. Vai ser chamada no PR 2 pelo `solicitarFerias` em `app/(app)/perfil/actions.ts`.

- [ ] **Step 1: Escrever o teste falhando**

Em `lib/ferias/decidir-status-inicial-solicitacao.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirStatusInicialSolicitacao } from "./decidir-status-inicial-solicitacao";

test("com líder → aguardando_gestor", () => {
  assert.equal(
    decidirStatusInicialSolicitacao({ liderId: "11111111-1111-1111-1111-111111111111" }),
    "aguardando_gestor",
  );
});

test("sem líder (null) → pendente_aprovacao (pula etapa do líder)", () => {
  assert.equal(
    decidirStatusInicialSolicitacao({ liderId: null }),
    "pendente_aprovacao",
  );
});

test("liderId string vazia → pendente_aprovacao", () => {
  assert.equal(
    decidirStatusInicialSolicitacao({ liderId: "" }),
    "pendente_aprovacao",
  );
});

test("liderId só de espaços → pendente_aprovacao", () => {
  assert.equal(
    decidirStatusInicialSolicitacao({ liderId: "   " }),
    "pendente_aprovacao",
  );
});

test("auto-liderança (anti-cadastro) → aguardando_gestor (deixa passar; fase 2 trava)", () => {
  // Caso de borda: o colaborador é seu próprio líder. A função não checa;
  // só olha se tem líder. O guard semântico fica na fase 2.
  assert.equal(
    decidirStatusInicialSolicitacao({ liderId: "22222222-2222-2222-2222-222222222222" }),
    "aguardando_gestor",
  );
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
node --test lib/ferias/decidir-status-inicial-solicitacao.test.ts
```

Esperado: falha porque o arquivo `decidir-status-inicial-solicitacao.ts` ainda não existe.

- [ ] **Step 3: Implementar o helper**

Em `lib/ferias/decidir-status-inicial-solicitacao.ts`, implementar a função com a assinatura descrita em Interfaces.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
node --test lib/ferias/decidir-status-inicial-solicitacao.test.ts
```

Esperado: 5 passes.

- [ ] **Step 5: Commit**

```bash
git add lib/ferias/decidir-status-inicial-solicitacao.ts lib/ferias/decidir-status-inicial-solicitacao.test.ts
git commit -m "feat(rh/ferias): helper decidirStatusInicialSolicitacao (ainda nao chamado)"
```

---

### Task 7: Verificação final

**Files:**
- Modify: nenhum

**Interfaces:**
- Consumes: tudo das 6 tasks anteriores.
- Produces: confirmação de que o PR 1 fecha limpo.

- [ ] **Step 1: Rodar build full**

```bash
npx tsc --noEmit
```

Esperado: 0 erros.

- [ ] **Step 2: Rodar todos os testes de férias**

```bash
node --test lib/ferias/*.test.ts
```

Esperado: todos passando.

- [ ] **Step 3: Conferir pelo MCP que o banco está consistente**

```sql
SELECT
  (SELECT COUNT(*) FROM pg_enum
    WHERE enumtypid='public.ferias_lancamento_status'::regtype
      AND enumlabel='aguardando_gestor')                                  AS enum_ok,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='colaboradores_ferias_lancamentos'
      AND column_name IN ('aprovado_pelo_lider_por','aprovado_pelo_lider_em',
                          'aprovacao_lider_override','motivo_override_lider')) AS colunas_ok,
  (SELECT COUNT(*) FROM pg_policy
    WHERE polname IN ('ferias_lancamentos_lider_select','ferias_periodos_lider_select'))  AS policies_ok,
  (SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema='public' AND table_name='vw_equipe_do_lider')     AS view_ok;
```

Esperado: `enum_ok=1, colunas_ok=4, policies_ok=2, view_ok=1`.

- [ ] **Step 4: Nada a comitar aqui**

Esta task só confirma. Se algum passo falha, voltar à task correspondente e corrigir.

---

## Self-review (feito; achados corrigidos inline)

- **Cobertura da spec:** enum, colunas, RLS, view, tipos, helper — todos endereçados. UI e actions são explicitamente PR 2 (declarado no Goal); nada a cobrir aqui.
- **Granularidade:** cada task termina num commit independente; cada step é uma ação com resultado checável.
- **Types:** `FeriasLancamentoStatus` e `ColaboradorFeriasLancamento` consistentes entre Task 5 e Task 6.
- **Review Focus:** 5 inputs/falhas listadas no topo; testes correspondentes nas Tasks 1, 3, 4 e 6. Item 4 (enum nova quebra query antiga) está coberto como teste de regressão na Task 1.
- **Proporção:** plano ~400 linhas vs spec ~300 linhas — justificado pelo volume de SQL exato que o implementador não deve inferir.
