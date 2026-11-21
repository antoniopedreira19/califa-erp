# Férias — múltiplos líderes (Passo 1: tabela + sincronia + N líderes no fluxo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Passar o cadastro de líder direto de 1 por colaborador pra N por colaborador, sem quebrar o fluxo de férias que acabou de subir. `colaboradores.lider_id` fica como cache sincronizado do "primeiro líder" por ora (removido no Passo 2).

**Architecture:** Nova tabela `colaboradores_lideres` (N:N) com trigger que sincroniza `colaboradores.lider_id` com o primeiro líder (MIN(created_at)). Policies RLS e view `vw_equipe_do_lider` reescritas pra usar `EXISTS` na tabela nova. Guards das server actions do líder passam a aceitar "sou um dos líderes". UI de cadastro vira lista de chips removíveis + Combobox pra adicionar. Trigger garante que código legado que lê `lider_id` continua funcionando — isso dá margem pra migrar consumidores sem pressão.

**Tech Stack:** Supabase Postgres (tabela + trigger + RLS + view), TypeScript (`lib/types.ts`, actions, drawer client component), React + shadcn/ui pros chips, `node:test` + `node:assert/strict` pros helpers.

**Spec:** `docs/superpowers/specs/2026-11-21-ferias-multiplos-lideres-design.md`

## Global Constraints

- **PII:** migration só com UUID. Nome/email nunca.
- **RLS:** policies de SELECT em `colaboradores_lideres` liberam admin/rh/próprio-colaborador (ver a sua relação). Policies de SELECT em outras tabelas que dependem de "sou líder" trocam o filtro de `colaboradores.lider_id = auth.uid()` pra `EXISTS (colaboradores_lideres WHERE colaborador_id = ... AND lider_id = auth.uid())`.
- **Trigger de sincronia** é `AFTER INSERT/DELETE` em `colaboradores_lideres`: recalcula `colaboradores.lider_id = (SELECT lider_id FROM colaboradores_lideres WHERE colaborador_id = ... ORDER BY created_at LIMIT 1)`. Se a tabela ficar vazia, `lider_id` vai pra NULL.
- **pt-BR** em toda string visível.
- **Backfill:** 207 linhas iniciais (uma por `lider_id` atual não-nulo), criadas na própria migration. Zero mudança destrutiva.
- **Fluxo decidir status inicial** segue inalterado (helper puro já aceita `liderId: string | null`; a mudança é na QUERY que alimenta esse campo — passa a ser "tem pelo menos 1 líder na tabela").
- **Audit:** nenhuma mudança.

## Review Focus

Cinco inputs/falhas que os testes das tasks não cobrem sozinhos:

1. **Remoção do único líder deixa colaborador sem nenhum.** A trigger seta `colaboradores.lider_id = NULL`. Próxima solicitação cai em `pendente_aprovacao` direto. Teste de banco na Task 1.
2. **Adicionar o mesmo líder duas vezes.** PK composta `(colaborador_id, lider_id)` barra. A action precisa tratar o erro de constraint com mensagem útil. Teste adicionado na Task 3.
3. **Líder removido do cadastro ainda vê lançamentos antigos onde ele é `aprovado_pelo_lider_por`.** A policy de SELECT precisa checar a tabela atual, não o campo histórico. Teste de banco na Task 1.
4. **Líder A aprova no `/equipe` enquanto líder B aprova em paralelo (race).** O guard + UPDATE com `.select().single()` do PR 2 já cobre (segundo UPDATE encontra `status != aguardando_gestor` → erro útil). Confirmar na Task 3.
5. **Colaborador adicionado como líder dele mesmo.** O schema de insert precisa rejeitar `colaborador_id == lider_id`. Teste adicionado na Task 3.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20261122100001_colaboradores_lideres_tabela_e_sync.sql` | criar | Tabela + PK + FKs + índices + backfill + trigger de sincronia + policies RLS SELECT na tabela nova + REESCRITA das policies RLS dependentes (lanc + periodos + UPDATE lider) + REESCRITA da view `vw_equipe_do_lider`. |
| `lib/equipe/tem-liderados.ts` | editar | Query olha `colaboradores_lideres` em vez de `colaboradores.lider_id`. |
| `lib/equipe/tem-liderados.test.ts` | — | Testes continuam válidos (shape puro). Nenhuma mudança. |
| `app/(app)/equipe/actions.ts` | editar | Guard de `aprovarLancamentoComoLider` / `reprovarLancamentoComoLider` vira "EXISTS na tabela". |
| `app/(app)/rh/colaboradores/actions.ts` | editar | `editarColaborador` lê `lider_ids` (array) do FormData e replica na tabela nova (DELETE + INSERT em transação). `criarColaborador` cria o primeiro líder na tabela nova. |
| `app/(app)/rh/contratacoes/actions.ts` | editar | `efetivarContratacao` (se escreve `lider_id`) passa a inserir na tabela nova. |
| `app/(app)/rh/colaboradores/[id]/editar-dados-drawer.tsx` | editar | Campo único vira lista de chips removíveis + Combobox pra adicionar. Envia `lider_ids[]` no FormData. |
| `app/(app)/rh/colaboradores/[id]/page.tsx` | editar | Query carrega `lideres` (lista de profiles) da tabela nova; prop `colaborador.lider_id` fica como legado pra cards que ainda consomem. |
| `lib/validations/rh-colaboradores.ts` | editar | Schema aceita `lider_ids: z.array(z.string().uuid()).default([])` em vez de (ou além de) `lider_id`. |
| `lib/types.ts` | editar | Novo tipo `ColaboradorLider { colaborador_id, lider_id, created_at }`. `Colaborador` segue com `lider_id` (cache). |
| `docs/modulos/rh/25-ferias.md` | editar | §F16 trocar "líder" por "um dos líderes" nos pontos relevantes. |
| `docs/decisions/267-ferias-aprovacao-em-duas-etapas.md` | editar | Addendum "2026-11-21 noite: evolução pra N líderes" no fim do ADR. |

---

### Task 1: Migration — tabela, backfill, trigger, policies RLS, view

**Files:**
- Create: `supabase/migrations/20261122100001_colaboradores_lideres_tabela_e_sync.sql`

**Interfaces:**
- Consumes: tabela `colaboradores`, FK `profiles(id)`.
- Produces:
  - Tabela `colaboradores_lideres (colaborador_id uuid, lider_id uuid, created_at timestamptz default now())` com PK `(colaborador_id, lider_id)`, FK `colaborador_id → colaboradores(id) ON DELETE CASCADE`, FK `lider_id → profiles(id) ON DELETE CASCADE`.
  - Índice btree em `(lider_id)`.
  - Backfill de 207 linhas a partir dos `colaboradores.lider_id IS NOT NULL`.
  - Trigger `AFTER INSERT/DELETE` na tabela nova recalcula `colaboradores.lider_id` (primeiro por `created_at`).
  - Constraint check: `colaborador_id <> lider_id` (não pode ser seu próprio líder).
  - Policies RLS na tabela nova: admin/rh podem SELECT/INSERT/DELETE no tenant; colaborador vê as linhas onde ele é o `colaborador_id`; líder vê as linhas onde ele é o `lider_id`.
  - **Reescrita** das policies RLS do PR anterior pra usar `EXISTS (SELECT 1 FROM colaboradores_lideres WHERE ...)`:
    - `ferias_lancamentos_lider_select` (reescreve)
    - `ferias_periodos_lider_select` (reescreve)
    - `ferias_lancamentos_lider_update` (reescreve)
  - **Reescrita** da view `vw_equipe_do_lider` — WHERE agora é `EXISTS (colaboradores_lideres WHERE lider_id = auth.uid() AND colaborador_id = c.id)`.

- [ ] **Step 1: Escrever a migration**

Estrutura:
```sql
BEGIN;

CREATE TABLE public.colaboradores_lideres (
  colaborador_id uuid NOT NULL REFERENCES public.colaboradores(id) ON DELETE CASCADE,
  lider_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (colaborador_id, lider_id),
  CHECK (colaborador_id <> lider_id)
);

CREATE INDEX idx_colaboradores_lideres_lider_id
  ON public.colaboradores_lideres (lider_id);

ALTER TABLE public.colaboradores_lideres ENABLE ROW LEVEL SECURITY;

-- Backfill
INSERT INTO public.colaboradores_lideres (colaborador_id, lider_id)
SELECT id, lider_id FROM public.colaboradores WHERE lider_id IS NOT NULL;

-- Trigger de sincronia
CREATE OR REPLACE FUNCTION public.fn_sync_colaborador_lider_cache()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  alvo uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN alvo := NEW.colaborador_id;
  ELSE alvo := OLD.colaborador_id;
  END IF;

  UPDATE public.colaboradores
     SET lider_id = (
       SELECT lider_id
         FROM public.colaboradores_lideres
        WHERE colaborador_id = alvo
        ORDER BY created_at
        LIMIT 1
     )
   WHERE id = alvo;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_colaborador_lider_cache
AFTER INSERT OR DELETE ON public.colaboradores_lideres
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_colaborador_lider_cache();

-- Policies RLS na tabela nova (admin/rh fazem tudo; colab e líder leem o seu)
CREATE POLICY colab_lideres_admin_rh ON public.colaboradores_lideres
  FOR ALL TO authenticated
  USING (is_tenant_admin((SELECT tenant_id FROM public.colaboradores WHERE id = colaborador_id))
      OR is_tenant_rh((SELECT tenant_id FROM public.colaboradores WHERE id = colaborador_id)))
  WITH CHECK (is_tenant_admin((SELECT tenant_id FROM public.colaboradores WHERE id = colaborador_id))
           OR is_tenant_rh((SELECT tenant_id FROM public.colaboradores WHERE id = colaborador_id)));

CREATE POLICY colab_lideres_select_proprio ON public.colaboradores_lideres
  FOR SELECT TO authenticated
  USING (
    is_colaborador_proprio(colaborador_id)
    OR lider_id = (SELECT auth.uid())
  );

GRANT SELECT, INSERT, DELETE ON public.colaboradores_lideres TO authenticated;

-- Reescreve policies RLS do PR anterior pra olhar a tabela nova
DROP POLICY IF EXISTS ferias_lancamentos_lider_select ON public.colaboradores_ferias_lancamentos;
CREATE POLICY ferias_lancamentos_lider_select
  ON public.colaboradores_ferias_lancamentos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores_lideres cl
      WHERE cl.colaborador_id = colaboradores_ferias_lancamentos.colaborador_id
        AND cl.lider_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS ferias_periodos_lider_select ON public.colaboradores_ferias_periodos;
CREATE POLICY ferias_periodos_lider_select
  ON public.colaboradores_ferias_periodos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores_lideres cl
      WHERE cl.colaborador_id = colaboradores_ferias_periodos.colaborador_id
        AND cl.lider_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS ferias_lancamentos_lider_update ON public.colaboradores_ferias_lancamentos;
CREATE POLICY ferias_lancamentos_lider_update
  ON public.colaboradores_ferias_lancamentos
  FOR UPDATE TO authenticated
  USING (
    status = 'aguardando_gestor'
    AND EXISTS (
      SELECT 1 FROM public.colaboradores_lideres cl
      WHERE cl.colaborador_id = colaboradores_ferias_lancamentos.colaborador_id
        AND cl.lider_id = (SELECT auth.uid())
    )
  );

-- Reescreve view: WHERE agora olha a tabela nova
CREATE OR REPLACE VIEW public.vw_equipe_do_lider AS
WITH alocacao_resumo AS (
  SELECT
    ca.colaborador_id,
    CASE WHEN COUNT(DISTINCT e.id) = 1 THEN MAX(e.nome_fantasia) ELSE 'Múltiplas' END AS alocacao_empresa,
    CASE WHEN COUNT(DISTINCT r.id) = 1 THEN MAX(r.nome) ELSE 'Múltiplas' END AS alocacao_regional
  FROM public.colaboradores_alocacoes ca
  JOIN public.empresas e   ON e.id = ca.empresa_id
  LEFT JOIN public.regionais r ON r.id = ca.regional_id
  WHERE ca.data_fim IS NULL
  GROUP BY ca.colaborador_id
)
SELECT
  c.id AS colaborador_id, c.tenant_id, c.nome, c.tipo_contratacao,
  ar.alocacao_empresa, ar.alocacao_regional,
  CASE
    WHEN p.email ILIKE '%@agenciacalifornia.com.br' THEN p.email
    WHEN c.email ILIKE '%@agenciacalifornia.com.br' THEN c.email
    ELSE NULL
  END AS email_corporativo,
  c.lider_id
FROM public.colaboradores c
LEFT JOIN alocacao_resumo ar ON ar.colaborador_id = c.id
LEFT JOIN public.profiles p  ON p.id = c.user_id
WHERE EXISTS (
  SELECT 1 FROM public.colaboradores_lideres cl
  WHERE cl.colaborador_id = c.id
    AND cl.lider_id = (SELECT auth.uid())
);

COMMIT;
```

- [ ] **Step 2: Aplicar pelo MCP**

`mcp__supabase-write__apply_migration` com `name="colaboradores_lideres_tabela_e_sync"`.

- [ ] **Step 3: Conferir backfill**

```sql
SELECT (SELECT COUNT(*) FROM public.colaboradores_lideres) AS linhas_na_tabela,
       (SELECT COUNT(*) FROM public.colaboradores WHERE lider_id IS NOT NULL) AS colabs_com_cache;
```
Expected: dois valores iguais a **207** (ou ao número atual de colaboradores com `lider_id` definido).

- [ ] **Step 4: Teste de trigger — INSERT + DELETE**

```sql
-- Pega um colab com líder
WITH alvo AS (
  SELECT c.id AS colab_id, c.lider_id AS lider_atual
  FROM public.colaboradores c WHERE c.lider_id IS NOT NULL LIMIT 1
)
-- Insere um segundo líder fictício (admin da California)
INSERT INTO public.colaboradores_lideres (colaborador_id, lider_id, created_at)
SELECT (SELECT colab_id FROM alvo),
       (SELECT id FROM public.profiles WHERE email = 'antonio@pevetech.com.br'),
       now() + interval '1 second';

-- Confere que cache NÃO mudou (o novo líder entrou depois)
SELECT c.lider_id = (SELECT lider_atual FROM alvo) AS cache_bate
FROM public.colaboradores c
WHERE c.id = (SELECT colab_id FROM alvo);
```
Expected: `cache_bate = true`. Em seguida rode a reversão:

```sql
DELETE FROM public.colaboradores_lideres
WHERE colaborador_id = (SELECT c.id FROM public.colaboradores c WHERE c.lider_id IS NOT NULL LIMIT 1)
  AND lider_id = (SELECT id FROM public.profiles WHERE email = 'antonio@pevetech.com.br');
```

- [ ] **Step 5: Teste borda — remoção do único líder**

```sql
-- Escolhe um colab com UM líder só (99% dos casos)
WITH alvo AS (
  SELECT c.id FROM public.colaboradores c
  WHERE c.lider_id IS NOT NULL
    AND (SELECT COUNT(*) FROM public.colaboradores_lideres cl WHERE cl.colaborador_id = c.id) = 1
  LIMIT 1
)
SELECT c.lider_id IS NOT NULL AS tinha_lider
FROM public.colaboradores c WHERE c.id = (SELECT id FROM alvo);

-- Deleta a única linha
DELETE FROM public.colaboradores_lideres
WHERE colaborador_id = (
  SELECT c.id FROM public.colaboradores c
  WHERE c.lider_id IS NOT NULL
    AND (SELECT COUNT(*) FROM public.colaboradores_lideres cl2 WHERE cl2.colaborador_id = c.id) = 1
  LIMIT 1
);

-- Confere que cache virou NULL
SELECT COUNT(*) AS com_cache_quebrado
FROM public.colaboradores c
WHERE c.lider_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.colaboradores_lideres cl WHERE cl.colaborador_id = c.id);
```
Expected: `com_cache_quebrado = 0`. **Reverter** pelo backfill:

```sql
-- Restaura a linha deletada pro colab que acabou de perder o único líder
-- (ou simplesmente re-executar o backfill completo — descrito a seguir)
INSERT INTO public.colaboradores_lideres (colaborador_id, lider_id)
SELECT id, lider_id FROM public.colaboradores
WHERE lider_id IS NOT NULL
  AND id NOT IN (SELECT colaborador_id FROM public.colaboradores_lideres);
```

Na prática esta reversão é dispensável porque DELETE zerou `colaboradores.lider_id`, então o backfill não sabe quem restaurar. **Melhor:** antes do teste, salvar o UUID original num temporário e restaurar manualmente.

- [ ] **Step 6: Teste de regressão — queries existentes continuam funcionando**

```sql
SELECT COUNT(*) FROM public.vw_equipe_do_lider; -- sem sessão, deve ser 0
SELECT COUNT(*) FROM public.colaboradores WHERE lider_id IS NOT NULL;
```
Expected: 0 (view sem sessão) e número preservado (207).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261122100001_colaboradores_lideres_tabela_e_sync.sql
git commit -m "feat(rh/colaboradores): tabela colaboradores_lideres (N:N) + trigger de sync + policies/view reescritas"
```

---

### Task 2: Helper `temLiderados` passa a olhar a tabela nova

**Files:**
- Modify: `lib/equipe/tem-liderados.ts`

**Interfaces:**
- Consumes: `colaboradores_lideres`.
- Produces: `temLiderados(supabase, profileId, tenantId)` continua retornando `boolean`; só muda a query interna. Assinatura idêntica — nenhum consumidor precisa mudar.

- [ ] **Step 1: Atualizar a query**

Trocar `.from("colaboradores").select("id").eq("lider_id", profileId).eq("tenant_id", tenantId).limit(1)` por `.from("colaboradores_lideres").select("colaborador_id").eq("lider_id", profileId).limit(1)`.

Como `colaboradores_lideres` não tem `tenant_id` direto, o `tenant_id` do helper fica não-usado (deixar parâmetro pra não quebrar assinatura; adicionar comentário).

- [ ] **Step 2: Rodar os testes existentes**

Run: `npx tsx --test lib/equipe/tem-liderados.test.ts`
Expected: 3/3 passes (testes de `resolveFlagTemLiderados` continuam válidos; nenhum teste I/O).

- [ ] **Step 3: `tsc --noEmit`**

Expected: 0 erros.

- [ ] **Step 4: Commit**

```bash
git add lib/equipe/tem-liderados.ts
git commit -m "refactor(equipe): temLiderados olha colaboradores_lideres"
```

---

### Task 3: Guards das actions do líder olham a tabela nova

**Files:**
- Modify: `app/(app)/equipe/actions.ts`

**Interfaces:**
- Consumes: `colaboradores_lideres` via RLS (as policies da Task 1 já filtram) e via query explícita de autorização.
- Produces: `aprovarLancamentoComoLider` e `reprovarLancamentoComoLider` aceitam qualquer um dos líderes atuais do colaborador. Interface externa (shape do `input`, `ActionResult`) **inalterada**.

- [ ] **Step 1: Trocar o guard em `aprovarLancamentoComoLider`**

Hoje:
```ts
const { data: colab } = await supabase
  .from("colaboradores")
  .select("id, lider_id")
  .eq("id", lanc.colaborador_id)
  .maybeSingle();

if (!colab || colab.lider_id !== session.profile.id) {
  return { ok: false, message: "Você não é o líder direto deste colaborador." };
}
```

Vira:
```ts
const { data: vinculo } = await supabase
  .from("colaboradores_lideres")
  .select("lider_id")
  .eq("colaborador_id", lanc.colaborador_id)
  .eq("lider_id", session.profile.id)
  .maybeSingle();

if (!vinculo) {
  return { ok: false, message: "Você não é um dos líderes deste colaborador." };
}
```

Replicar em `reprovarLancamentoComoLider`.

- [ ] **Step 2: `tsc --noEmit`**

Expected: 0 erros.

- [ ] **Step 3: Teste manual — race condition**

Com 2 líderes cadastrados no mesmo colab, abrir `/equipe` em 2 abas distintas (como cada líder). Aprovar em uma delas; a outra, ao clicar Aprovar, recebe "Esta solicitação não está mais aguardando sua aprovação." (mensagem do guard de status no PR 2).

- [ ] **Step 4: Teste manual — auto-liderança rejeitada pelo banco**

Via MCP:
```sql
INSERT INTO public.colaboradores_lideres (colaborador_id, lider_id)
SELECT c.id, c.user_id FROM public.colaboradores c WHERE c.user_id IS NOT NULL LIMIT 1;
```
Expected: ERRO do CHECK constraint `colaborador_id <> lider_id`.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/equipe/actions.ts"
git commit -m "feat(equipe): actions do lider aceitam qualquer um dos N lideres"
```

---

### Task 4: Actions de cadastro (editar/criar colaborador, efetivar contratação) escrevem na tabela nova

**Files:**
- Modify: `app/(app)/rh/colaboradores/actions.ts`
- Modify: `app/(app)/rh/contratacoes/actions.ts`
- Modify: `lib/validations/rh-colaboradores.ts`

**Interfaces:**
- Consumes: `colaboradores_lideres` via INSERT/DELETE com RLS da Task 1.
- Produces:
  - Schema `editarColaboradorSchema` aceita `lider_ids: z.array(z.string().uuid()).default([])`. O campo antigo `lider_id` continua suportado (lido como primeiro do array se vier) pra retrocompat em formulários antigos.
  - `editarColaborador(id, formData)`: lê todos os `formData.getAll("lider_ids[]")`; faz UPSERT-equivalente (DELETE lotados que não estão na lista + INSERT dos novos). Transação não é obrigatória (operações idempotentes), mas usar RPC ou SQL em bloco se quiser atomicidade.
  - `criarColaborador(formData)`: após INSERT no `colaboradores`, se tem `lider_ids`, INSERT em `colaboradores_lideres`.
  - `efetivarContratacao(contratacaoId)`: se grava líder, grava na tabela nova (não em `colaboradores.lider_id` direto).

- [ ] **Step 1: Atualizar schema em `lib/validations/rh-colaboradores.ts`**

Adicionar:
```ts
lider_ids: z.array(z.string().uuid()).default([]),
```

Manter `lider_id` como legado (pode ser removido no Passo 2). Se vier `lider_id` sem `lider_ids`, converter: `lider_ids = lider_id ? [lider_id] : []`.

- [ ] **Step 2: `editarColaborador` grava os líderes**

Após o UPDATE do colaborador, sincronizar:
```ts
// Lê os líderes atuais do banco
const { data: atuais } = await supabase
  .from("colaboradores_lideres")
  .select("lider_id")
  .eq("colaborador_id", id);
const idsAtuais = new Set((atuais ?? []).map((r) => r.lider_id));
const idsNovos = new Set(parsed.data.lider_ids);

// Remove os que saíram
const paraRemover = [...idsAtuais].filter((x) => !idsNovos.has(x));
if (paraRemover.length) {
  await supabase
    .from("colaboradores_lideres")
    .delete()
    .eq("colaborador_id", id)
    .in("lider_id", paraRemover);
}
// Insere os que entraram
const paraInserir = [...idsNovos].filter((x) => !idsAtuais.has(x));
if (paraInserir.length) {
  await supabase
    .from("colaboradores_lideres")
    .insert(paraInserir.map((lider_id) => ({ colaborador_id: id, lider_id })));
}
```

- [ ] **Step 3: `criarColaborador` idem**

Após o INSERT no `colaboradores`, se `lider_ids.length > 0`, insere em `colaboradores_lideres`. (A trigger já sincroniza `lider_id` cache.)

- [ ] **Step 4: `efetivarContratacao` idem**

Se o action hoje escreve `lider_id` em `colaboradores`, trocar por INSERT na tabela nova. Se não escreve direto, nada a fazer.

- [ ] **Step 5: `tsc --noEmit`**

Expected: 0 erros.

- [ ] **Step 6: Teste manual — editar colab**

Via UI (depois da Task 5): adicionar/remover líder; conferir pelo MCP que a tabela reflete.

- [ ] **Step 7: Commit**

```bash
git add lib/validations/rh-colaboradores.ts "app/(app)/rh/colaboradores/actions.ts" "app/(app)/rh/contratacoes/actions.ts"
git commit -m "feat(rh/colaboradores): actions gravam N lideres em colaboradores_lideres"
```

---

### Task 5: UI do drawer de cadastro — chips removíveis + Combobox

**Files:**
- Modify: `app/(app)/rh/colaboradores/[id]/editar-dados-drawer.tsx`
- Modify: `app/(app)/rh/colaboradores/[id]/page.tsx` (carrega lista de líderes atuais e passa pro drawer)

**Interfaces:**
- Consumes: lista de `lideres` atuais (array de profile ids com nomes) + `lideresOptions` (todos os profiles disponíveis pra escolha, igual hoje).
- Produces: UI que mostra chips dos líderes atuais com botão "x" pra remover + Combobox pra adicionar; envia `lider_ids[]` no FormData.

- [ ] **Step 1: Atualizar o shape das props**

No drawer:
```ts
export function EditarDadosDrawer({
  colaborador,
  niveis,
  lideres, // todos os profiles elegíveis (como hoje)
  lideresAtuais, // NOVO: IDs dos líderes atuais do colaborador
}: {
  colaborador: Colaborador;
  niveis: ...;
  lideres: LiderOption[];
  lideresAtuais: string[];
}) {
```

- [ ] **Step 2: Estado local lista + remove + add**

```ts
const [lideresSel, setLideresSel] = React.useState<string[]>(lideresAtuais);
const lideresSelMap = new Map(lideres.map(l => [l.id, l.nome]));
function remover(id: string) { setLideresSel(prev => prev.filter(x => x !== id)); }
function adicionar(id: string) { if (!lideresSel.includes(id)) setLideresSel(prev => [...prev, id]); }
```

- [ ] **Step 3: Renderizar chips + Combobox**

Bloco de UI: lista de chips (`inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs`) com nome + botão X; abaixo, Combobox que filtra os `lideres` removendo os já selecionados.

- [ ] **Step 4: Submit envia `lider_ids[]`**

```ts
formData.delete("lider_id");
formData.delete("lider_ids[]");
for (const id of lideresSel) formData.append("lider_ids[]", id);
```

- [ ] **Step 5: `page.tsx` carrega lideresAtuais**

Adicionar à query do colaborador:
```ts
const { data: lideresAtuaisRes } = await supabase
  .from("colaboradores_lideres")
  .select("lider_id")
  .eq("colaborador_id", params.id);
const lideresAtuais = (lideresAtuaisRes ?? []).map(r => r.lider_id);
```
Passa pro drawer.

- [ ] **Step 6: `tsc --noEmit`**

Expected: 0 erros.

- [ ] **Step 7: Teste manual**

Abrir `/rh/colaboradores/[id]`, editar, adicionar 2º líder, salvar, reabrir — confirmar que persistiu. Pelo MCP checar `colaboradores_lideres`.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/rh/colaboradores/[id]/editar-dados-drawer.tsx" "app/(app)/rh/colaboradores/[id]/page.tsx"
git commit -m "feat(rh/colaboradores): UI de cadastro com N lideres (chips + combobox)"
```

---

### Task 6: Docs — `25-ferias.md §F16` + addendum no ADR 267

**Files:**
- Modify: `docs/modulos/rh/25-ferias.md`
- Modify: `docs/decisions/267-ferias-aprovacao-em-duas-etapas.md`

- [ ] **Step 1: Atualizar §F16 trocando "líder direto" por "um dos líderes"**

Mudanças:
- "Com `lider_id` definido no cadastro: nasce em `aguardando_gestor`" → "Com pelo menos 1 líder em `colaboradores_lideres`".
- "líder aprova via `/equipe`" fica, mas adicionar nota: "Qualquer um dos N líderes aprova; o primeiro destrava."
- Adicionar nota no fim: "Modelo passou de 1 líder (coluna `lider_id`) pra N líderes (tabela `colaboradores_lideres`) em 2026-11-21 noite. `lider_id` continua existindo como cache do primeiro líder — sincronizado por trigger — pra código legado."
- Linkar o novo design doc e ADR addendum.

- [ ] **Step 2: Addendum no ADR 267**

Adicionar no fim do arquivo:
```markdown
---

## Addendum 2026-11-21 (noite) — Evolução pra N líderes

Decisão simplificadora original: 1 líder por colaborador. Na mesma sessão
descobrimos que a Agência tem casos reais de 2 líderes (operacional +
funcional). Decisão: qualquer um dos N aprova/reprova.

Mudanças técnicas:
- Nova tabela `colaboradores_lideres (colaborador_id, lider_id, created_at)`.
- `colaboradores.lider_id` vira cache do primeiro líder (trigger sincroniza).
- Policies RLS e view reescritas pra olhar a tabela nova.
- Guards das actions do líder aceitam "é um dos líderes".

Spec: `docs/superpowers/specs/2026-11-21-ferias-multiplos-lideres-design.md`.
Migrations: `20261122100001_colaboradores_lideres_tabela_e_sync`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/modulos/rh/25-ferias.md docs/decisions/267-ferias-aprovacao-em-duas-etapas.md
git commit -m "docs(rh/ferias): N lideres por colaborador (addendum ADR 267)"
```

---

### Task 7: Verificação final

**Files:**
- Modify: nenhum.

**Interfaces:**
- Consumes: tudo das 6 tasks anteriores.
- Produces: confirmação do fechamento do Passo 1.

- [ ] **Step 1: `tsc --noEmit`** — 0 erros.
- [ ] **Step 2: `npx tsx --test lib/**/*.test.ts`** — 53 testes passando (nenhum teste novo nesta task; só regressão).
- [ ] **Step 3: Teste end-to-end manual:**
  1. RH abre `/rh/colaboradores/[id]` de um colab → adiciona 2º líder → salva.
  2. Via MCP, confere: `SELECT * FROM colaboradores_lideres WHERE colaborador_id = <uuid>` — 2 linhas.
  3. Via MCP, confere o cache: `colaboradores.lider_id` = primeiro líder (ordem de `created_at`).
  4. Loga como o 2º líder → `/equipe` mostra o liderado (não só do primeiro).
  5. Loga como o colaborador → solicita férias → status = `aguardando_gestor`.
  6. Loga como o 2º líder → aprova → status vira `pendente_aprovacao`.
  7. Loga como RH → aprova → concluído normalmente.
- [ ] **Step 4: Sanity do backfill final**
  ```sql
  SELECT
    (SELECT COUNT(*) FROM public.colaboradores_lideres)                      AS vinculos,
    (SELECT COUNT(DISTINCT colaborador_id) FROM public.colaboradores_lideres) AS colabs_com_pelo_menos_1_lider,
    (SELECT COUNT(*) FROM public.colaboradores WHERE lider_id IS NOT NULL)   AS cache_preenchido;
  ```
  Expected: `colabs_com_pelo_menos_1_lider = cache_preenchido` (toda relação na tabela gera cache; nenhuma sobra).

---

## Self-review (feito; achados corrigidos inline)

- **Spec coverage:** tabela + trigger + policies + view + helpers + actions + UI + docs. Todos os 13 arquivos listados na seção File Structure estão endereçados.
- **Granularidade:** 7 tasks com commit próprio; passos checáveis.
- **Type consistency:** `colaboradores_lideres` com shape consistente entre Tasks 1, 2, 3, 4, 5.
- **Review Focus:** 5 inputs/falhas mapeados nas Tasks 1 e 3.
- **Proporção:** ~550 linhas pra ~500-700 LoC estimado. OK — o volume de SQL exato justifica.

## Passo 2 (fora de escopo deste plano, placeholder)

Quando confirmar que nenhum código consome `colaboradores.lider_id` direto:

1. Migration remove a coluna + a trigger.
2. Remove campo `lider_id` de `lib/types.ts` → `Colaborador`.
3. Dashboards/relatórios que ainda usam `lider_id` são migrados.

Não vai ser feito agora.
