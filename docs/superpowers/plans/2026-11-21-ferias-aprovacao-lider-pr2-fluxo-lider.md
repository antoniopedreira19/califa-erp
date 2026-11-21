# Férias — aprovação em duas etapas (PR 2: fluxo do líder)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ligar o fluxo de aprovação em duas etapas no banco e na UI do líder: solicitações de quem tem líder nascem em `aguardando_gestor`, líder vê em `/equipe` (nova página na sidebar) e aprova ou reprova. RH continua operando igual; override e UI dedicada do RH entram no PR 3.

**Architecture:** O helper `decidirStatusInicialSolicitacao` (já em `lib/ferias/`, criado no PR 1 e ainda não chamado) é plugado em `solicitarFerias`. Duas server actions novas no namespace `/equipe` (`aprovarLancamentoComoLider`, `reprovarLancamentoComoLider`) com guard "sou líder desse colaborador". A página `/equipe/page.tsx` é server component e usa `vw_equipe_do_lider` (RLS embutido) + policy de leitura do líder em `colaboradores_ferias_lancamentos`/`_periodos` (criadas no PR 1). Sidebar recebe item condicional "Equipe" baseado num count server-side.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase (consulta via SSR client + RLS), React Hook Form + Zod pros forms, `node:test` + `node:assert` pros testes unitários, Tailwind + shadcn/ui pra UI.

**Spec:** `docs/superpowers/specs/2026-11-21-ferias-aprovacao-lider-e-pagina-equipe-design.md`

## Global Constraints

- **PII:** líder NÃO vê salário, CPF, data de nascimento, telefone, endereço. Só nome, tipo de contratação, alocação denormalizada e email corporativo `@agenciacalifornia.com.br` (fonte-verdade: `vw_equipe_do_lider`).
- **pt-BR** em toda string visível: acentos, cedilha, til (ver CLAUDE.md §"Ortografia em português").
- **Performance:** server components usam `Promise.all` pra queries independentes; `<Link>` em lista com 5+ itens sempre `prefetch={false}`; força-dinâmico onde já estiver aplicado fica.
- **Fluxo do banco:** nenhuma migration nova neste PR (fundação já foi no PR 1). Qualquer coisa que precise de DDL pausa o PR 2 e volta pra brainstorm.
- **Audit:** cada aprovação / reprovação pelo líder gera `audit_events` via `logAuditEvent`.
- **Não quebrar RH:** `aprovarLancamento` (existing) já tem guard `status === 'pendente_aprovacao'`, então rejeita `aguardando_gestor` naturalmente. Nenhuma mudança nessa action.
- **"Lançar direto" do RH segue pulando as duas aprovações** — já grava direto `aprovado`, mantido.
- **Sidebar:** item "Equipe" só aparece pra profile com pelo menos 1 liderado (`EXISTS` server-side). Gated no server, não baixa pro cliente.
- **Motivo de reprovação pelo líder:** obrigatório (mínimo 3 caracteres após trim). Decidido em 21/11 que motivo é parte útil do feedback ao colaborador. (Nota: motivo do *override do RH* é opcional — PR 3.)

## Review Focus

Cinco entradas/falhas que os testes das tasks não cobrem sozinhos:

1. **Líder tenta aprovar lançamento que já virou `pendente_aprovacao` entre o render e o clique (race)** — a action precisa rejeitar estados ≠ `aguardando_gestor` com mensagem útil. Teste adicionado na Task 3.
2. **Profile que NÃO é líder de ninguém chama `aprovarLancamentoComoLider` com UUID de qualquer lançamento** — guard de propriedade deve impedir. Teste adicionado na Task 3.
3. **Líder reprova sem motivo ou com motivo vazio (só espaços)** — o schema Zod deve rejeitar. Teste adicionado na Task 3.
4. **Profile vira "ex-líder" entre renders (liderado foi removido) e `/equipe` vai ficar vazia** — a página não pode crashar; mostra empty state polido. Teste de render manual na Task 4.
5. **Colaborador sem líder cria solicitação e o status precisa cair direto em `pendente_aprovacao`** — garante que o fallback (opção B, da spec) funciona. Teste adicionado na Task 2.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `lib/equipe/tem-liderados.ts` | criar | Helper puro + query: profile tem pelo menos 1 liderado? |
| `lib/equipe/tem-liderados.test.ts` | criar | Teste unitário do normalizador do helper. |
| `app/(app)/perfil/actions.ts` | editar | Chamar `decidirStatusInicialSolicitacao` ao inserir a solicitação. |
| `lib/ferias/aprovar-como-lider-schema.ts` | criar | Zod schemas pras actions do líder. |
| `lib/ferias/aprovar-como-lider-schema.test.ts` | criar | Testes dos schemas. |
| `app/(app)/equipe/actions.ts` | criar | `aprovarLancamentoComoLider`, `reprovarLancamentoComoLider`. |
| `app/(app)/equipe/page.tsx` | criar | Página server component; PageHeader + Tabs. |
| `app/(app)/equipe/aba-equipe.tsx` | criar | Tab 1: lista do time pela view. |
| `app/(app)/equipe/aba-ferias.tsx` | criar | Tab 2: card de pendentes + lista do time. |
| `app/(app)/equipe/kpi-cards-equipe.tsx` | criar | Faixa de KPIs no topo. |
| `components/sidebar.tsx` | editar | Adicionar item condicional "Equipe". |
| `app/(app)/layout.tsx` | editar | Computar `temEquipe` server-side e passar pro Sidebar. |
| `app/(app)/perfil/linha-historico-lancamento.tsx` | editar | Label de `aguardando_gestor` fica "Aguardando líder". |
| `app/(app)/rh/ferias/solicitacoes-tabela-cliente.tsx` | editar | Mesma etiqueta "Aguardando líder". |
| `app/(app)/rh/ferias/[id]/page.tsx` | editar | Mesma etiqueta + hint. |
| `app/(app)/rh/ferias/[id]/historico-colapsavel.tsx` | editar | Mesma etiqueta. |

---

### Task 1: Helper `temLiderados` + teste

**Files:**
- Create: `lib/equipe/tem-liderados.ts`
- Create: `lib/equipe/tem-liderados.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` do `@/lib/supabase/server`.
- Produces: `temLiderados(supabase: SupabaseClient, profileId: string, tenantId: string): Promise<boolean>` — true se existe pelo menos 1 `colaboradores` com `lider_id = profileId AND tenant_id = tenantId`. Implementação: `select("id").eq("lider_id", profileId).eq("tenant_id", tenantId).limit(1)`.
- Produces também a função pura `resolveFlagTemLiderados(data: { id: string }[] | null): boolean` — true sse array existe e tem comprimento ≥ 1. É essa função pura que a Task 1 testa.

- [ ] **Step 1: Escrever o teste falhando em `lib/equipe/tem-liderados.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFlagTemLiderados } from "./tem-liderados";

test("array com pelo menos 1 row → true", () => {
  assert.equal(resolveFlagTemLiderados([{ id: "a" }]), true);
});

test("array vazio → false", () => {
  assert.equal(resolveFlagTemLiderados([]), false);
});

test("null (sem acesso ou RLS bloqueou) → false", () => {
  assert.equal(resolveFlagTemLiderados(null), false);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx tsx --test lib/equipe/tem-liderados.test.ts`
Expected: FAIL — `resolveFlagTemLiderados` não existe.

- [ ] **Step 3: Implementar em `lib/equipe/tem-liderados.ts`**

Expor `resolveFlagTemLiderados` e `temLiderados`. `temLiderados` chama a query descrita em Interfaces e retorna `resolveFlagTemLiderados(data)`.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Expected: 3 passes.

- [ ] **Step 5: Commit**

```bash
git add lib/equipe/tem-liderados.ts lib/equipe/tem-liderados.test.ts
git commit -m "feat(equipe): helper temLiderados (profile tem pelo menos 1 liderado)"
```

---

### Task 2: `solicitarFerias` decide status inicial pelo líder

**Files:**
- Modify: `app/(app)/perfil/actions.ts:141-157` (bloco do INSERT)

**Interfaces:**
- Consumes: `decidirStatusInicialSolicitacao` de `@/lib/ferias/decidir-status-inicial-solicitacao` (PR 1).
- Produces: `solicitarFerias` agora insere com status `"aguardando_gestor"` se o colaborador tem `lider_id`, senão `"pendente_aprovacao"`.
- Não muda assinatura; não muda retorno.

- [ ] **Step 1: Importar o helper**

Adicionar no topo do arquivo:
```ts
import { decidirStatusInicialSolicitacao } from "@/lib/ferias/decidir-status-inicial-solicitacao";
```

- [ ] **Step 2: Trocar o literal `"pendente_aprovacao"` por chamada ao helper**

No bloco do INSERT (`app/(app)/perfil/actions.ts:153`), trocar
```ts
status: "pendente_aprovacao",
```
por
```ts
status: decidirStatusInicialSolicitacao({ liderId: colab.lider_id }),
```
`colab.lider_id` já é selecionado no `.select()` da linha 44.

- [ ] **Step 3: Teste de integração (manual, via MCP) — colab com líder**

```sql
-- Pega um colab do California com líder definido e checa o insert que viria
SELECT c.id, c.nome, c.lider_id,
       CASE WHEN c.lider_id IS NOT NULL THEN 'aguardando_gestor' ELSE 'pendente_aprovacao' END AS status_esperado
FROM public.colaboradores c
WHERE c.tenant_id = (SELECT id FROM public.tenants WHERE nome = 'Agência California')
  AND c.lider_id IS NOT NULL
LIMIT 1;
```
Expected: 1 linha, `status_esperado = 'aguardando_gestor'`. A asserção visual é só pra confirmar o shape da decisão; o comportamento real é testado pelo unit test do helper (já verde no PR 1).

- [ ] **Step 4: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/perfil/actions.ts
git commit -m "feat(perfil/ferias): status inicial da solicitacao decide por lider (fluxo duas etapas)"
```

---

### Task 3: Server actions do líder + schemas Zod

**Files:**
- Create: `lib/ferias/aprovar-como-lider-schema.ts`
- Create: `lib/ferias/aprovar-como-lider-schema.test.ts`
- Create: `app/(app)/equipe/actions.ts`

**Interfaces:**
- Produces:
  - `aprovarComoLiderSchema` (Zod): `{ lancamentoId: string.uuid }`.
  - `reprovarComoLiderSchema` (Zod): `{ lancamentoId: string.uuid, motivo: string.trim().min(3).max(500) }`.
  - `aprovarLancamentoComoLider(input: unknown): Promise<ActionResult>` em `app/(app)/equipe/actions.ts`.
  - `reprovarLancamentoComoLider(input: unknown): Promise<ActionResult>` idem.
  - `ActionResult = { ok: true; id: string } | { ok: false; message: string; fieldErrors?: Record<string,string[]> }`.

- [ ] **Step 1: Escrever os testes dos schemas**

Em `lib/ferias/aprovar-como-lider-schema.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { aprovarComoLiderSchema, reprovarComoLiderSchema } from "./aprovar-como-lider-schema";

test("aprovar: uuid válido → sucesso", () => {
  const r = aprovarComoLiderSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
  });
  assert.equal(r.success, true);
});

test("aprovar: uuid inválido → fail", () => {
  const r = aprovarComoLiderSchema.safeParse({ lancamentoId: "nao-uuid" });
  assert.equal(r.success, false);
});

test("reprovar: motivo com 3 chars após trim → sucesso", () => {
  const r = reprovarComoLiderSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
    motivo: "  ok ",
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.motivo, "ok");
});

test("reprovar: motivo só com espaços → fail", () => {
  const r = reprovarComoLiderSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
    motivo: "   ",
  });
  assert.equal(r.success, false);
});

test("reprovar: motivo com 2 chars após trim → fail (min 3)", () => {
  const r = reprovarComoLiderSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
    motivo: "ok",
  });
  assert.equal(r.success, false);
});
```

- [ ] **Step 2: Rodar — RED**

Run: `npx tsx --test lib/ferias/aprovar-como-lider-schema.test.ts`
Expected: FAIL (schema não existe).

- [ ] **Step 3: Implementar os schemas em `lib/ferias/aprovar-como-lider-schema.ts`**

Usar `z.object({ ... })`. Pro `motivo`, usar `z.string().transform(s => s.trim()).pipe(z.string().min(3).max(500))` — ou equivalente que garanta trim antes do min.

- [ ] **Step 4: Rodar — GREEN**

Expected: 5 passes.

- [ ] **Step 5: Implementar as actions em `app/(app)/equipe/actions.ts`**

O arquivo começa com `"use server";`. Importa:
- `requireSession` de `@/lib/auth/session`;
- `createClient` de `@/lib/supabase/server`;
- `logAuditEvent` de `@/lib/auth/audit`;
- `aprovarComoLiderSchema`, `reprovarComoLiderSchema`;
- `revalidatePath` do `next/cache`.

Cada action segue este contorno (o implementador escreve os detalhes idiomáticos):

```ts
export async function aprovarLancamentoComoLider(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = aprovarComoLiderSchema.safeParse(input);
  if (!parsed.success) { /* fieldErrors */ }
  const { lancamentoId } = parsed.data;

  const supabase = createClient();

  // Guard: o lançamento existe, está no tenant ativo, e o colaborador tem este
  // profile como líder. Status atual precisa ser 'aguardando_gestor'.
  const { data: lanc } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select("id, tenant_id, colaborador_id, status")
    .eq("id", lancamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (lanc.status !== "aguardando_gestor") {
    return { ok: false, message: "Esta solicitação não está mais aguardando sua aprovação." };
  }

  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, lider_id")
    .eq("id", lanc.colaborador_id)
    .maybeSingle();

  if (!colab || colab.lider_id !== session.profile.id) {
    return { ok: false, message: "Você não é o líder direto deste colaborador." };
  }

  const { error } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .update({
      status: "pendente_aprovacao",
      aprovado_pelo_lider_por: session.profile.id,
      aprovado_pelo_lider_em: new Date().toISOString(),
    })
    .eq("id", lancamentoId);

  if (error) return { ok: false, message: "Falha ao aprovar: " + error.message };

  await logAuditEvent({
    acao: "ferias.aprovado_lider",
    tenantId: session.activeTenant.id,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lancamentoId,
    metadata: { colaborador_id: colab.id },
  });

  revalidatePath("/equipe");
  return { ok: true, id: lancamentoId };
}
```

A `reprovarLancamentoComoLider` segue o mesmo padrão; diferenças: parse com `reprovarComoLiderSchema`, UPDATE grava `status: "reprovado"`, `aprovado_pelo_lider_por`, `aprovado_pelo_lider_em`, `motivo_reprovacao: parsed.data.motivo`; audit com `acao: "ferias.reprovado_lider"` e `metadata.motivo = parsed.data.motivo`.

- [ ] **Step 6: Rodar `tsc --noEmit`**

Expected: 0 erros.

- [ ] **Step 7: Commit**

```bash
git add lib/ferias/aprovar-como-lider-schema.ts lib/ferias/aprovar-como-lider-schema.test.ts app/(app)/equipe/actions.ts
git commit -m "feat(equipe): server actions aprovarLancamentoComoLider e reprovarLancamentoComoLider"
```

---

### Task 4: Página `/equipe` — shell + KPIs

**Files:**
- Create: `app/(app)/equipe/page.tsx`
- Create: `app/(app)/equipe/kpi-cards-equipe.tsx`

**Interfaces:**
- Consumes: `vw_equipe_do_lider`, `colaboradores_ferias_lancamentos`, `colaboradores_ferias_periodos`, helper `temLiderados` (Task 1).
- Produces: rota `/equipe` renderizando:
  - PageHeader com título "Equipe" e subtítulo curto.
  - Faixa de 4 KPIs (componente `<KpiCardsEquipe>`): `N liderados`, `X aguardando sua aprovação`, `Y de férias hoje`, `Z férias vencendo em 60 dias`.
  - Tabs shadcn/ui com valores `equipe` e `ferias`. O conteúdo das tabs entra nas Tasks 5 e 6; aqui a shell renderiza placeholder só pro layout fechar.

- [ ] **Step 1: Criar `app/(app)/equipe/page.tsx` como server component**

A página:
1. Chama `requireSession()`.
2. Checa `temLiderados(supabase, session.profile.id, session.activeTenant.id)`; se false, `redirect("/home")`.
3. Dispara em `Promise.all`:
   - count de liderados (`from("vw_equipe_do_lider").select("colaborador_id", { count: "exact", head: true })`)
   - count de `aguardando_gestor` (`from("colaboradores_ferias_lancamentos").select("id", { count: "exact", head: true }).eq("status", "aguardando_gestor")` — a policy do PR 1 filtra pros liderados)
   - count de "férias hoje" (`eq("status", "aprovado").lte("data_inicio", hoje).gte("data_fim", hoje)`)
   - count de períodos vencendo em 60 dias pros liderados (`from("colaboradores_ferias_periodos").select("id", { count: "exact", head: true }).lte("vencimento", hoje+60d).gte("vencimento", hoje)`)
4. Renderiza `<KpiCardsEquipe>` + `<Tabs>` com placeholders.

- [ ] **Step 2: Criar `<KpiCardsEquipe>` em `app/(app)/equipe/kpi-cards-equipe.tsx`**

Client component simples (`"use client"` opcional; pode ser server). Recebe `{ liderados, aguardandoVoce, feriasHoje, vencendo60d }` e renderiza 4 cards no padrão rico do `/financeiro`:
- ícone (Lucide: `Users`, `Clock`, `PalmTree`, `AlertTriangle`)
- número grande + label
- subtítulo quando aplicável
- `shadow-soft`

Seguir o padrão visual existente do `/rh/page.tsx` (grid de 3 colunas, responsive).

- [ ] **Step 3: Teste manual (checklist)**

Rodar `npm run dev`, logar como um líder com liderados (profile que tem pelo menos 1 `colaboradores.lider_id` apontando pra ele), navegar pra `/equipe`:
- [ ] página carrega sem erro
- [ ] KPIs batem com a contagem esperada (21 liderados pro Rafael)
- [ ] Tabs aparecem (vazias por enquanto)

Logar como um profile sem liderados (ex: um colaborador qualquer), navegar pra `/equipe`:
- [ ] redireciona pra `/home`

- [ ] **Step 4: `tsc --noEmit`**

Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/equipe/page.tsx app/(app)/equipe/kpi-cards-equipe.tsx
git commit -m "feat(equipe): pagina shell com PageHeader, KPIs e Tabs (sem conteudo)"
```

---

### Task 5: Tab Equipe — lista do time

**Files:**
- Create: `app/(app)/equipe/aba-equipe.tsx`
- Modify: `app/(app)/equipe/page.tsx` (plugar a aba)

**Interfaces:**
- Consumes: `vw_equipe_do_lider`.
- Produces: `<AbaEquipe>` server component que faz 1 query na view, renderiza tabela com `table-fixed + colgroup`.

Colunas:
| # | Coluna | Largura (px) | Fonte |
|---|---|---|---|
| 1 | Nome | 320 | `nome` |
| 2 | Tipo | 140 | `tipo_contratacao` (label humano: "PJ" / "CLT" / "Híbrido"; derivado do enum) |
| 3 | Alocação | 320 | `alocacao_empresa` + " · " + `alocacao_regional` (ou só empresa se regional é null) |
| 4 | Email | — (flex) | `email_corporativo` |

- Larguras são hints; implementador mede pela maior string real na largura padrão (1616 px de conteúdo; memória `feedback_ui_linha_clicavel` + "Listas: grade fixa"). Teto de 2 linhas pra texto livre (`TruncateTooltip linhas={2}`).
- Linha NÃO é clicável neste PR (a edição do colaborador segue sendo do RH/admin). Hover `bg-slate-50`.
- Empty state: "Sua equipe aparecerá aqui quando o RH vincular colaboradores com você como líder direto." com ícone `Users`.

- [ ] **Step 1: Criar `app/(app)/equipe/aba-equipe.tsx`**

Server component. Query:
```ts
const { data } = await supabase
  .from("vw_equipe_do_lider")
  .select("colaborador_id, nome, tipo_contratacao, alocacao_empresa, alocacao_regional, email_corporativo")
  .order("nome");
```

Renderiza `<table className="w-full table-fixed">` com `<colgroup>` definindo as larguras. Helper para label do `tipo_contratacao`: `pj → "PJ"`, `clt → "CLT"`, `clt_recibo → "Híbrido"`.

- [ ] **Step 2: Plugar no `page.tsx`**

No bloco de `TabsContent value="equipe"`, renderizar `<AbaEquipe />`.

- [ ] **Step 3: Teste manual**

Logado como Rafael (21 liderados): a aba Equipe mostra 21 linhas, ordenadas por nome, com as 4 colunas, nenhuma coluna vazia por bug (alocação pode vir "Múltiplas" ou "—" quando não há vigente).

- [ ] **Step 4: `tsc --noEmit`**

Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/equipe/aba-equipe.tsx app/(app)/equipe/page.tsx
git commit -m "feat(equipe): tab Equipe com lista do time (table-fixed, sem PII)"
```

---

### Task 6: Tab Férias — card de pendentes + lista

**Files:**
- Create: `app/(app)/equipe/aba-ferias.tsx`
- Create: `app/(app)/equipe/card-pendente-aprovacao.tsx`
- Modify: `app/(app)/equipe/page.tsx` (plugar a aba)

**Interfaces:**
- Consumes: `colaboradores_ferias_lancamentos` (RLS do líder já ativa no PR 1), server actions da Task 3.
- Produces:
  - `<AbaFerias>` server component: faz duas queries (pendentes do líder + histórico filtrado pelos liderados) em `Promise.all`.
  - `<CardPendenteAprovacao>` client component que recebe um lançamento e renderiza:
    - Cabeçalho: nome do colab, período (data_inicio - data_fim em pt-BR), dias, tipo (label).
    - Expansível: motivo (observacao), histórico de períodos do colab (opcional nesta entrega — pode ficar só o topo).
    - Botões `<Button variant="default">Aprovar</Button>` e `<Button variant="outline" tone="red">Reprovar</Button>`. Reprovar abre um `<Dialog>` com `<Textarea>` pro motivo.
    - `onClick` chama a server action e `router.refresh()` após ok.

- [ ] **Step 1: Criar `card-pendente-aprovacao.tsx` (client)**

`"use client"`. Imports: `useState`, `useTransition`, `useRouter`, actions de `./actions`, componentes shadcn (Button, Dialog, Textarea, Label).

Props: `{ lancamento: { id, colaboradorNome, dataInicio, dataFim, dias, tipo, observacao, periodoAquisitivoLabel? } }`.

Dois estados locais: `confirmandoReprovar: boolean`, `motivo: string`, `isPending` do `useTransition`.

Botão Aprovar chama `aprovarLancamentoComoLider({ lancamentoId })`; toast via `sonner` (já usado no projeto). Botão Reprovar abre Dialog; submit chama `reprovarLancamentoComoLider({ lancamentoId, motivo })`.

- [ ] **Step 2: Criar `aba-ferias.tsx` (server)**

Query 1 (pendentes com join pros nomes do colab, tipo etc.):
```ts
const { data: pendentes } = await supabase
  .from("colaboradores_ferias_lancamentos")
  .select("id, data_inicio, data_fim, dias, tipo, observacao, colaborador_id, colaboradores!inner(nome)")
  .eq("status", "aguardando_gestor")
  .order("created_at", { ascending: true });
```
A RLS da policy `ferias_lancamentos_lider_select` (PR 1) filtra pros liderados do caller.

Query 2 (histórico recente: últimos N lançamentos aprovados/concluídos dos liderados). Reusa shape da aba Quadro do `/rh/ferias/aba-quadro.tsx` — o implementador pode importar funções utilitárias se fizer sentido, ou renderizar uma tabela mais enxuta.

Renderização:
- Se `pendentes.length > 0`: seção "Aguardando sua aprovação" no topo, com N cards.
- Se `pendentes.length === 0`: "Nenhuma solicitação aguardando você." (uma linha, sem card gigante).
- Embaixo: seção "Histórico recente" com lista simples.

- [ ] **Step 3: Plugar no `page.tsx`**

`<TabsContent value="ferias">` renderiza `<AbaFerias />`.

- [ ] **Step 4: Teste manual**

Logado como Rafael:
- Deve ver 1 ou mais solicitações (se houver em `aguardando_gestor` após o backfill + Task 2 começar a produzir; caso contrário, criar uma manualmente pelo `/perfil` como um liderado dele).
- Clicar Aprovar: toast de sucesso, card some, badge do KPI diminui.
- Clicar Reprovar: dialog abre, salvar sem motivo → erro; salvar com motivo → toast de sucesso, card some.

Pelo MCP, confirmar que `aprovado_pelo_lider_por` e `aprovado_pelo_lider_em` foram gravados.

- [ ] **Step 5: `tsc --noEmit` + testes**

```bash
npx tsc --noEmit
npx tsx --test lib/ferias/*.test.ts lib/equipe/*.test.ts
```
Expected: tsc 0 erros, todos os testes passando.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/equipe/aba-ferias.tsx app/(app)/equipe/card-pendente-aprovacao.tsx app/(app)/equipe/page.tsx
git commit -m "feat(equipe): tab Ferias com card de pendentes (aprovar/reprovar) e historico"
```

---

### Task 7: Sidebar com item "Equipe" + labels de `aguardando_gestor`

**Files:**
- Modify: `app/(app)/layout.tsx` (computar `temEquipe`)
- Modify: `components/sidebar.tsx` (novo NavLink)
- Modify: `app/(app)/perfil/linha-historico-lancamento.tsx` (label)
- Modify: `app/(app)/rh/ferias/solicitacoes-tabela-cliente.tsx` (label)
- Modify: `app/(app)/rh/ferias/[id]/page.tsx` (label + hint)
- Modify: `app/(app)/rh/ferias/[id]/historico-colapsavel.tsx` (label)

**Interfaces:**
- Consumes: `temLiderados` (Task 1).
- Produces:
  - Sidebar com item "Equipe" (ícone `Users2` ou `UserCog`, href `/equipe`) visível apenas quando `temEquipe === true`.
  - Labels do `aguardando_gestor` nos 4 tsx deixam de ser "neutros" e passam a ser:
    - Perfil (colaborador): "Aguardando aprovação do líder"
    - RH (3 arquivos): "Aguardando líder"

- [ ] **Step 1: Computar `temEquipe` no layout**

Em `app/(app)/layout.tsx`, após o cálculo de `doComite`, adicionar:
```ts
const temEquipe = await temLiderados(
  createClient(),
  session.profile.id,
  session.activeTenant.id,
);
```
(roda em `Promise.all` com `doComite` se for simples; senão sequencial é OK — é 1 query indexada).

Passa `temEquipe` como prop pro `<Sidebar>`.

- [ ] **Step 2: Sidebar aceita `temEquipe`**

Em `components/sidebar.tsx`:
- Assinatura ganha `temEquipe: boolean`.
- Novo entry no array `links` (perto do /rh ou /freelancers):
  ```ts
  { href: "/equipe", label: "Equipe", icon: Users2, permissao: undefined, soDoComite: false }
  ```
- Filtro `visibleLinks` ganha uma condição: links com `href === "/equipe"` só entram se `temEquipe`.

Alternativa idiomática: adicionar campo `soLider?: boolean` no tipo `NavLink`, e o filtro vira `l.soLider ? temEquipe : (l.soDoComite ? doComite : ...)`. Fica mais extensível.

- [ ] **Step 3: Atualizar os 4 tsx com labels específicos**

- `linha-historico-lancamento.tsx` — `aguardando_gestor.label = "Aguardando aprovação do líder"`
- `solicitacoes-tabela-cliente.tsx` — `aguardando_gestor.label = "Aguardando líder"`
- `[id]/page.tsx` — `aguardando_gestor.label = "Aguardando líder"`, `hint = "Líder precisa aprovar antes do RH."`
- `[id]/historico-colapsavel.tsx` — `aguardando_gestor.label = "Aguardando líder"`

- [ ] **Step 4: Teste manual**

- Logar como líder: sidebar mostra "Equipe".
- Logar como profile sem liderados: sidebar NÃO mostra "Equipe".
- Em `/rh/ferias`, os pendentes `aguardando_gestor` aparecem com badge "Aguardando líder" (em vez de "Pendente").

- [ ] **Step 5: `tsc --noEmit` + full tests**

Expected: 0 erros; todos os testes passando.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/layout.tsx components/sidebar.tsx app/(app)/perfil/linha-historico-lancamento.tsx app/(app)/rh/ferias/solicitacoes-tabela-cliente.tsx "app/(app)/rh/ferias/[id]/page.tsx" "app/(app)/rh/ferias/[id]/historico-colapsavel.tsx"
git commit -m "feat(sidebar): item Equipe condicional + labels 'aguardando lider' no RH"
```

---

### Task 8: Verificação final

**Files:**
- Modify: nenhum

**Interfaces:**
- Consumes: tudo das 7 tasks anteriores.
- Produces: confirmação de que o PR 2 fecha.

- [ ] **Step 1: `tsc --noEmit`** → 0 erros.
- [ ] **Step 2: `npx tsx --test lib/**/*.test.ts`** → tudo verde.
- [ ] **Step 3: Smoke manual no navegador:**
  1. Como colaborador sem líder: solicitar férias → status cai em `pendente_aprovacao` (checar via MCP).
  2. Como colaborador com líder: solicitar férias → status cai em `aguardando_gestor` (MCP).
  3. Como líder: ver pendente em `/equipe`, aprovar → status vai pra `pendente_aprovacao`, `aprovado_pelo_lider_*` gravado.
  4. Como RH: pendente `pendente_aprovacao` aparece em `/rh/ferias`, aprovar funciona.
  5. Como RH: pendente `aguardando_gestor` em `/rh/ferias` tem badge "Aguardando líder" e o botão Aprovar diz "Aguarde líder" (ou similar; a UI dedicada do RH chega no PR 3).
- [ ] **Step 4: Conferir audit trail** — pelo MCP:
  ```sql
  SELECT acao, metadata, created_at
  FROM public.audit_events
  WHERE acao LIKE 'ferias.%_lider%'
  ORDER BY created_at DESC
  LIMIT 5;
  ```
  Expected: linhas com `ferias.aprovado_lider` e/ou `ferias.reprovado_lider` a partir dos testes manuais.

---

## Self-review (feito; achados corrigidos inline)

- **Cobertura da spec:** solicitação com decisão de status (Task 2), página `/equipe` (Tasks 4-6), sidebar gated (Task 7), actions do líder com guard (Task 3), labels diferenciados (Task 7). Override e UI dedicada do RH ficam explicitamente pro PR 3.
- **Granularidade:** 8 tasks com commit próprio; cada step tem resultado checável.
- **Type consistency:** `aprovarComoLiderSchema` / `reprovarComoLiderSchema` usados em Task 3, `temLiderados`/`resolveFlagTemLiderados` consistentes entre Tasks 1 e 7.
- **Review Focus:** 5 inputs/falhas listados no topo; cada um mapeado pra tasks 2, 3 e 4.
- **Proporção:** ~550 linhas de plano pra ~1000 linhas estimadas de código (shell + actions + tabs + sidebar). Faixa razoável; o custo maior são os componentes de UI que o plano não transcreve.
