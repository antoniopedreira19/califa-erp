# Kanban de fluxo das férias no RH — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar as abas Solicitações + Pagamentos de `/rh/ferias` num kanban de 5 colunas organizado por lançamento (não por folha), com modal de documentos que trava o envio ao financeiro até todos os docs estarem anexados.

**Architecture:** Nova view SQL `vw_rh_ferias_fluxo` agrega lançamentos + folhas + status de NF do colab. Helpers puros em `lib/ferias/` classificam coluna do kanban e enviabilidade por folha. `enviarFolhasFerias` ganha validação server-side de NF pra PJ (defesa em profundidade). UI nova: aba `?tab=fluxo` com kanban cliente, card por coluna + modal detalhado "Em andamento" que mostra os slots de doc por folha e dispara envio em lote. Abas antigas (`?tab=solicitacoes` e `?tab=pagamentos`) viram redirects server-side.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Supabase Postgres, `node --test` + `tsx`, Tailwind + shadcn/ui Dialog.

**Spec:** [docs/superpowers/specs/2026-10-27-rh-ferias-kanban-fluxo-design.md](../specs/2026-10-27-rh-ferias-kanban-fluxo-design.md)

## Global Constraints

- **Linguagem UI:** PT-BR com acentuação completa em qualquer string renderizada ou mensagem de erro (CLAUDE.md "Ortografia em português").
- **Banco pelo fluxo do MCP:** migration via `apply_migration`, conferência pelo MCP, commit junto do código que depende (`docs/FLUXO-BANCO.md`).
- **GRANT explícito pra `authenticated`** em qualquer view/função nova.
- **`lib/types.ts` à mão:** novos tipos no MESMO commit da migration que afeta UI.
- **Nenhum PII em arquivos versionados** — testes usam placeholders ou IDs fakes.
- **Framework teste:** `node --test` + `tsx`, arquivos `*.test.ts` ao lado do código.
- **Reusar o Dialog do shadcn**, padrão `max-w-2xl` pros modais detalhados.
- **Reusar actions existentes** em `actions-pagamentos.ts`: `enviarFolhasFerias`, `anexarReciboContabilFolhaFerias`, `gerarUrlUploadReciboContabil`, `cancelarFolhaFerias`. Só a validação PJ é adicionada.
- **5 colunas no kanban**: Pendentes / Em andamento / Enviadas / Parcialmente paga / Finalizadas.
- **Card = lançamento, não folha** (mesmo quando híbrido+abono_combinado gera 4 folhas).
- **Envio em lote por lançamento inteiro** — nunca por folha individual.
- **PJ só enviável quando NF está em `colaboradores_nf_anexos`** com `(colaborador_id, escopo_tipo, escopo_id=lancamento_id)`.

## Review Focus

1. **Lançamento aprovado sem folhas geradas** (bug anterior já visto com Antonio): o kanban mostra em "Em andamento" com `folhas_total=0`. Teste em Task 2 do helper `classificarColunaFluxo`.
2. **PJ sem NF tenta enviar via API direta** (burlando a UI): `enviarFolhasFerias` consulta `colaboradores_nf_anexos` e bloqueia com mensagem explícita. Teste em Task 3.
3. **Híbrido com 4 folhas em status misto** (algumas pagas, outras enviadas): classificador retorna `parcial`. Teste em Task 2.
4. **Lançamento com `status=aprovado` mas folha única em `rascunho`** (sem anexo nenhum): classificador retorna `em_andamento`. Teste em Task 2.
5. **Troca de aba via query string** (`?tab=solicitacoes` ou `?tab=pagamentos` antigos): server-side redirect pro `?tab=fluxo` SEM perder o `?status=` se tinha. Teste manual.

---

## File Structure

**Create:**
- `supabase/migrations/20261027950002_vw_rh_ferias_fluxo.sql`
- `lib/ferias/classificar-coluna-fluxo.ts` + `.test.ts`
- `lib/ferias/folha-enviavel.ts` + `.test.ts`
- `app/(app)/rh/ferias/aba-fluxo.tsx` — server component que carrega view + passa pros clientes
- `app/(app)/rh/ferias/aba-fluxo-kanban.tsx` — client component kanban (5 colunas)
- `app/(app)/rh/ferias/card-fluxo.tsx` — client component card (5 variantes via prop `coluna`)
- `app/(app)/rh/ferias/modal-documentos.tsx` — client component modal "Em andamento"

**Modify:**
- `lib/types.ts` — adicionar `RhFeriasFluxoRow`, `ColunaFluxoFerias`
- `app/(app)/rh/ferias/actions-pagamentos.ts` — `enviarFolhasFerias` ganha validação de NF pra folhas PJ
- `app/(app)/rh/ferias/actions-pagamentos.test.ts` — novo arquivo com teste da validação PJ
- `app/(app)/rh/ferias/modal-anexar-recibo.tsx` — diferencia título/placeholder/mensagem por `tipo_folha_ferias` (usufruto vs abono)
- `app/(app)/rh/ferias/page.tsx` — adiciona tab `fluxo` + redirect server-side de `?tab=solicitacoes` e `?tab=pagamentos`

**Delete:**
- `app/(app)/rh/ferias/aba-solicitacoes.tsx`
- `app/(app)/rh/ferias/aba-pagamentos.tsx`
- `app/(app)/rh/ferias/pagamentos-lista-cliente.tsx`

---

## Task 1: Migration `vw_rh_ferias_fluxo` + types

**Files:**
- Create: `supabase/migrations/20261027950002_vw_rh_ferias_fluxo.sql`
- Modify: `lib/types.ts`

**Interfaces:**
- Produces:
  - view `vw_rh_ferias_fluxo` com colunas: `lancamento_id, tenant_id, colaborador_id, colaborador_nome, tipo_contratacao, tipo_lancamento, data_inicio, data_fim, dias, dias_abono, status_lancamento, created_at, aprovado_em, motivo_reprovacao, observacao, folhas_total, folhas_com_anexo_rh, folhas_pj_com_nf, folhas_pj_total, folhas_clt_total, folhas_clt_com_recibo, folha_status_min, folha_status_max, folhas_pagas, folha_statuses_jsonb, todas_pagas, todas_enviadas, vencimento_mais_proximo`
  - type `RhFeriasFluxoRow` em `lib/types.ts` modelando a view
  - type `ColunaFluxoFerias = 'pendente' | 'em_andamento' | 'enviada' | 'parcial' | 'finalizada'`

- [ ] **Step 1: Ler estado pelo MCP**

Via `mcp__supabase__execute_sql`:
- `list_tables` em `colaboradores_ferias_lancamentos`, `folhas_pagamento`, `colaboradores_nf_anexos` pra confirmar colunas usadas
- `SELECT polname FROM pg_policy WHERE … relname='colaboradores_ferias_lancamentos'` pra confirmar policies compatíveis com `security_invoker=on`

- [ ] **Step 2: Escrever migration**

Arquivo `supabase/migrations/20261027950002_vw_rh_ferias_fluxo.sql`:

```sql
-- View agregada do kanban de fluxo em /rh/ferias. Linha = lançamento (não folha).
-- Agrega folhas de pagamento associadas + status de NF do colab (via
-- colaboradores_nf_anexos) pra permitir visualizar progresso de documentos.
-- Spec: docs/superpowers/specs/2026-10-27-rh-ferias-kanban-fluxo-design.md

CREATE OR REPLACE VIEW public.vw_rh_ferias_fluxo
WITH (security_invoker = on) AS
SELECT
  l.id AS lancamento_id,
  l.tenant_id,
  l.colaborador_id,
  c.nome AS colaborador_nome,
  c.tipo_contratacao,
  l.tipo AS tipo_lancamento,
  l.data_inicio,
  l.data_fim,
  l.dias,
  l.dias_abono,
  l.status AS status_lancamento,
  l.created_at,
  l.aprovado_em,
  l.motivo_reprovacao,
  l.observacao,
  count(f.id) FILTER (WHERE f.id IS NOT NULL) AS folhas_total,
  count(f.id) FILTER (
    WHERE f.origem = 'contabilidade' AND f.anexo_url IS NOT NULL
  ) AS folhas_clt_com_recibo,
  count(f.id) FILTER (WHERE f.origem = 'contabilidade') AS folhas_clt_total,
  count(f.id) FILTER (WHERE f.origem = 'california') AS folhas_pj_total,
  count(f.id) FILTER (
    WHERE f.origem = 'california'
      AND EXISTS (
        SELECT 1 FROM public.colaboradores_nf_anexos n
        WHERE n.colaborador_id = l.colaborador_id
          AND n.escopo_id = l.id
          AND n.escopo_tipo = CASE
            WHEN f.tipo_folha_ferias = 'usufruto' THEN 'ferias_usufruto'::public.nf_anexo_escopo
            WHEN f.tipo_folha_ferias = 'abono'    THEN 'ferias_abono'::public.nf_anexo_escopo
          END
      )
  ) AS folhas_pj_com_nf,
  count(f.id) FILTER (WHERE f.status = 'paga') AS folhas_pagas,
  min(f.data_pagamento_prevista) AS vencimento_mais_proximo,
  bool_and(f.status = 'paga') FILTER (WHERE f.id IS NOT NULL) AS todas_pagas,
  bool_and(f.status IN ('enviada','aprovada','paga','pendente_correcao'))
    FILTER (WHERE f.id IS NOT NULL) AS todas_enviadas
FROM public.colaboradores_ferias_lancamentos l
JOIN public.colaboradores c ON c.id = l.colaborador_id
LEFT JOIN public.folhas_pagamento f
  ON f.lancamento_ferias_id = l.id AND f.tipo = 'ferias'
GROUP BY l.id, c.id;

GRANT SELECT ON public.vw_rh_ferias_fluxo TO authenticated;
```

- [ ] **Step 3: Aplicar via `mcp__supabase-write__apply_migration`**

Nome: `vw_rh_ferias_fluxo`.

- [ ] **Step 4: Conferir pelo MCP**

Via `execute_sql`:
- `SELECT count(*) FROM vw_rh_ferias_fluxo` — retorna número total de lançamentos
- `SELECT status_lancamento, folhas_total, folhas_pj_com_nf, folhas_pj_total, folhas_clt_com_recibo FROM vw_rh_ferias_fluxo WHERE lancamento_id = '<id do Antonio TESTE>'` — valores consistentes

- [ ] **Step 5: Atualizar `lib/types.ts`**

Adicionar:

```ts
export type ColunaFluxoFerias =
  | "pendente"
  | "em_andamento"
  | "enviada"
  | "parcial"
  | "finalizada";

export type RhFeriasFluxoRow = {
  lancamento_id: string;
  tenant_id: string;
  colaborador_id: string;
  colaborador_nome: string;
  tipo_contratacao: TipoContratacao;
  tipo_lancamento: FeriasLancamentoTipo;
  data_inicio: string;
  data_fim: string;
  dias: number;
  dias_abono: number;
  status_lancamento: FeriasLancamentoStatus;
  created_at: string;
  aprovado_em: string | null;
  motivo_reprovacao: string | null;
  observacao: string | null;
  folhas_total: number;
  folhas_clt_com_recibo: number;
  folhas_clt_total: number;
  folhas_pj_total: number;
  folhas_pj_com_nf: number;
  folhas_pagas: number;
  vencimento_mais_proximo: string | null;
  todas_pagas: boolean | null;
  todas_enviadas: boolean | null;
};
```

- [ ] **Step 6: `npm run typecheck`**

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261027950002_vw_rh_ferias_fluxo.sql lib/types.ts
git commit -m "feat(rh/ferias): view vw_rh_ferias_fluxo + tipos pro kanban"
```

---

## Task 2: Helper `classificarColunaFluxo` (puro)

**Files:**
- Create: `lib/ferias/classificar-coluna-fluxo.ts` + `.test.ts`

**Interfaces:**
- Consumes: `RhFeriasFluxoRow`, `ColunaFluxoFerias` (Task 1)
- Produces:
  - `classificarColunaFluxo(row: RhFeriasFluxoRow): ColunaFluxoFerias`

- [ ] **Step 1: Escrever testes**

Arquivo `lib/ferias/classificar-coluna-fluxo.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classificarColunaFluxo } from "./classificar-coluna-fluxo";
import type { RhFeriasFluxoRow } from "@/lib/types";

function row(partial: Partial<RhFeriasFluxoRow>): RhFeriasFluxoRow {
  return {
    lancamento_id: "x",
    tenant_id: "t",
    colaborador_id: "c",
    colaborador_nome: "COLABORADOR TESTE",
    tipo_contratacao: "pj",
    tipo_lancamento: "usufruto",
    data_inicio: "2027-01-01",
    data_fim: "2027-01-20",
    dias: 20,
    dias_abono: 0,
    status_lancamento: "pendente_aprovacao",
    created_at: "2026-10-01T00:00:00Z",
    aprovado_em: null,
    motivo_reprovacao: null,
    observacao: null,
    folhas_total: 0,
    folhas_clt_com_recibo: 0,
    folhas_clt_total: 0,
    folhas_pj_total: 0,
    folhas_pj_com_nf: 0,
    folhas_pagas: 0,
    vencimento_mais_proximo: null,
    todas_pagas: null,
    todas_enviadas: null,
    ...partial,
  };
}

test("pendente_aprovacao → pendente", () => {
  assert.equal(classificarColunaFluxo(row({ status_lancamento: "pendente_aprovacao" })), "pendente");
});

test("reprovado → finalizada", () => {
  assert.equal(classificarColunaFluxo(row({ status_lancamento: "reprovado" })), "finalizada");
});

test("cancelado → finalizada", () => {
  assert.equal(classificarColunaFluxo(row({ status_lancamento: "cancelado" })), "finalizada");
});

test("concluido → finalizada", () => {
  assert.equal(classificarColunaFluxo(row({ status_lancamento: "concluido" })), "finalizada");
});

test("aprovado sem folhas → em_andamento (edge case bug anterior)", () => {
  assert.equal(classificarColunaFluxo(row({ status_lancamento: "aprovado", folhas_total: 0 })), "em_andamento");
});

test("aprovado, todas pagas → finalizada", () => {
  assert.equal(classificarColunaFluxo(row({
    status_lancamento: "aprovado",
    folhas_total: 4, folhas_pagas: 4,
    todas_pagas: true, todas_enviadas: true,
  })), "finalizada");
});

test("aprovado, parcial (algumas pagas) → parcial", () => {
  assert.equal(classificarColunaFluxo(row({
    status_lancamento: "aprovado",
    folhas_total: 4, folhas_pagas: 2,
    todas_pagas: false, todas_enviadas: true,
  })), "parcial");
});

test("aprovado, todas enviadas (nenhuma paga) → enviada", () => {
  assert.equal(classificarColunaFluxo(row({
    status_lancamento: "aprovado",
    folhas_total: 2, folhas_pagas: 0,
    todas_pagas: false, todas_enviadas: true,
  })), "enviada");
});

test("aprovado, alguma folha ainda em rascunho → em_andamento", () => {
  assert.equal(classificarColunaFluxo(row({
    status_lancamento: "aprovado",
    folhas_total: 2, folhas_pagas: 0,
    todas_pagas: false, todas_enviadas: false,
  })), "em_andamento");
});
```

- [ ] **Step 2: Rodar testes — FAIL**

Run: `npx tsx --test lib/ferias/classificar-coluna-fluxo.test.ts`
Expected: FAIL (função não existe).

- [ ] **Step 3: Implementar `classificarColunaFluxo(row): ColunaFluxoFerias` em `lib/ferias/classificar-coluna-fluxo.ts`**

Switch no `status_lancamento` seguindo a regra do spec §Classificação:
- `pendente_aprovacao` → `pendente`
- `reprovado | cancelado | concluido` → `finalizada`
- `aprovado`:
  - `folhas_total === 0` → `em_andamento`
  - `todas_pagas` → `finalizada`
  - `folhas_pagas > 0 && folhas_pagas < folhas_total` → `parcial`
  - `todas_enviadas` → `enviada`
  - senão → `em_andamento`

- [ ] **Step 4: Rodar testes — PASS**

Run: `npx tsx --test lib/ferias/classificar-coluna-fluxo.test.ts`
Expected: 9/9 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ferias/classificar-coluna-fluxo.ts lib/ferias/classificar-coluna-fluxo.test.ts
git commit -m "feat(ferias): helper classificarColunaFluxo + 9 testes"
```

---

## Task 3: `enviarFolhasFerias` valida NF pra folhas PJ

**Files:**
- Modify: `app/(app)/rh/ferias/actions-pagamentos.ts:33-133`
- Create: `app/(app)/rh/ferias/actions-pagamentos.test.ts`

**Interfaces:**
- Consumes: `colaboradores_nf_anexos` (schema existente)
- Produces:
  - `enviarFolhasFerias({ ids })` passa a bloquear com mensagem `"<id>: PJ sem NF anexada pelo colaborador"` quando a NF correspondente não existir

- [ ] **Step 1: Teste puro de validação NF**

Extrair a lógica de validação pra função pura exportada:

```ts
// Em actions-pagamentos.ts, adicionar export:
export function montarInvalidasFolhas(
  folhas: Array<{
    id: string;
    tipo: string;
    status: string;
    origem: string;
    anexo_url: string | null;
    lancamento_ferias_id: string | null;
    tipo_folha_ferias: "usufruto" | "abono" | null;
  }>,
  nfsAnexadas: Set<string>,  // chave: "<lancamento_id>|<escopo_tipo>"
): string[]
```

Testes em `actions-pagamentos.test.ts`:

```ts
test("CLT sem recibo → inválida", () => { ... });
test("CLT com recibo → ok", () => { ... });
test("PJ usufruto sem NF → inválida", () => { ... });
test("PJ usufruto com NF → ok", () => { ... });
test("PJ abono sem NF → inválida", () => { ... });
test("tipo != ferias → inválida", () => { ... });
test("status != rascunho → inválida", () => { ... });
```

- [ ] **Step 2: Rodar testes — FAIL** (função pura não existe ainda)

Run: `npx tsx --test "app/(app)/rh/ferias/actions-pagamentos.test.ts"`

- [ ] **Step 3: Implementar `montarInvalidasFolhas`** em `actions-pagamentos.ts`

Function pura. Pra cada folha, aplica regras:
- `tipo !== 'ferias'` → `"<id>: não é folha de férias"`
- `status !== 'rascunho'` → `"<id>: status <X>, só rascunho pode ser enviada"`
- `origem === 'contabilidade'` E `anexo_url` null → `"<id>: CLT sem recibo contábil anexado"`
- `origem === 'california'` E chave `"<lancamento_ferias_id>|ferias_usufruto"` (ou `ferias_abono`, depende de `tipo_folha_ferias`) não em `nfsAnexadas` → `"<id>: PJ sem NF anexada pelo colaborador"`

- [ ] **Step 4: Rodar testes — PASS (7/7)**

- [ ] **Step 5: Integrar na `enviarFolhasFerias`**

Antes do loop de validação:
1. Após o SELECT das folhas (que agora precisa incluir `tipo_folha_ferias`, `lancamento_ferias_id`), fazer `SELECT escopo_tipo, escopo_id FROM colaboradores_nf_anexos WHERE escopo_id IN (<lancamento_ids>) AND escopo_tipo IN ('ferias_usufruto','ferias_abono')`.
2. Montar `nfsAnexadas: Set<string>` com chave `"<escopo_id>|<escopo_tipo>"`.
3. Chamar `montarInvalidasFolhas(folhas, nfsAnexadas)` em vez do loop inline.
4. Resto do fluxo permanece igual.

- [ ] **Step 6: `npm run typecheck`**

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/rh/ferias/actions-pagamentos.ts" "app/(app)/rh/ferias/actions-pagamentos.test.ts"
git commit -m "feat(rh/ferias): enviarFolhasFerias valida NF do PJ server-side"
```

---

## Task 4: Página + componente server + kanban cliente (shell vazio)

**Files:**
- Modify: `app/(app)/rh/ferias/page.tsx` — adiciona tab `fluxo` + redirect
- Create: `app/(app)/rh/ferias/aba-fluxo.tsx` — server component
- Create: `app/(app)/rh/ferias/aba-fluxo-kanban.tsx` — client, 5 colunas com placeholder "Nada aqui"

**Interfaces:**
- Consumes: `vw_rh_ferias_fluxo` (Task 1), `classificarColunaFluxo` (Task 2), `RhFeriasFluxoRow`, `ColunaFluxoFerias` (Task 1)
- Produces:
  - rota `/rh/ferias?tab=fluxo` renderiza kanban com 5 colunas populadas
  - rotas `?tab=solicitacoes` e `?tab=pagamentos` → redirect server-side pra `?tab=fluxo`
  - componente `<FluxoKanban rows={RhFeriasFluxoRow[]} />` client com 5 colunas, cada uma renderizando os rows da sua categoria com placeholder "card em breve" (cards reais vêm na Task 5)

- [ ] **Step 1: Modificar `page.tsx`**

- Adicionar `"fluxo"` em `type Tab` + array `TABS` (como primeiro depois de "painel"? ou substituir solicitações/pagamentos — ver Spec: desaparece)
- `TABS` passa a ser: `[painel, quadro, fluxo]`
- Antes de `normalizarTab`, redirect: se `searchParams.tab === 'solicitacoes' || searchParams.tab === 'pagamentos'`, `redirect('/rh/ferias?tab=fluxo')`
- Renderizar `<AbaFluxo tenantId={tenantId} />` quando `tab === 'fluxo'`
- Default do `normalizarTab`: `"painel"` (mantém)

- [ ] **Step 2: Criar `aba-fluxo.tsx`**

Server component. Carrega da view + agrupa por coluna + passa pro client:

```ts
export async function AbaFluxo({ tenantId }: { tenantId: string }) {
  const supabase = createClient();
  const { data } = await supabase
    .from("vw_rh_ferias_fluxo")
    .select("*")
    .eq("tenant_id", tenantId);
  const rows = (data ?? []) as RhFeriasFluxoRow[];
  return <FluxoKanban rows={rows} />;
}
```

- [ ] **Step 3: Criar `aba-fluxo-kanban.tsx`**

Client component. Agrupa `rows` por coluna usando `classificarColunaFluxo`. Grid 5 colunas em desktop (`xl:grid-cols-5`), 2 em tablet, 1 em mobile. Cada coluna:
- Header com cor sutil (amber/sky/violet/fuchsia/slate) + badge contagem
- Lista scrollable interna (`max-h-[calc(100vh-16rem)] overflow-y-auto`)
- Placeholder: `<div className="rounded border bg-white p-3 text-xs">Lançamento {row.lancamento_id.slice(0,8)}</div>` por row — cards reais na Task 5
- Empty state: "Nada aqui." se coluna vazia

**Ordenação** por coluna (ver spec):
- pendente: `created_at` asc
- em_andamento: `vencimento_mais_proximo` asc (nulls last)
- enviada / parcial: `aprovado_em` desc
- finalizada: `aprovado_em` desc (ou `data_pagamento` quando houver — por ora `aprovado_em` serve)

- [ ] **Step 4: Verificação manual**

Rodar `npm run dev`, abrir `/rh/ferias?tab=fluxo` → vê 5 colunas populadas com lançamentos. `?tab=solicitacoes` e `?tab=pagamentos` redirecionam.

- [ ] **Step 5: `npm run typecheck && npm run lint`**

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/rh/ferias/page.tsx app/\(app\)/rh/ferias/aba-fluxo.tsx app/\(app\)/rh/ferias/aba-fluxo-kanban.tsx
git commit -m "feat(rh/ferias): aba Fluxo com kanban 5 colunas (placeholder cards) + redirect"
```

---

## Task 5: Cards reais (5 variantes por coluna)

**Files:**
- Create: `app/(app)/rh/ferias/card-fluxo.tsx`
- Modify: `app/(app)/rh/ferias/aba-fluxo-kanban.tsx` — troca placeholder por `<CardFluxo />`

**Interfaces:**
- Consumes: `RhFeriasFluxoRow`, `ColunaFluxoFerias`, `formatarTipoContratacao`
- Produces:
  - `<CardFluxo row coluna onClick />` client component

Visual por coluna:

**pendente:**
- Nome + badge Tipo lançamento (Férias, Abono combinado, Só venda, Abono excepcional)
- `N dias · DD/MM a DD/MM`
- Badge `formatarTipoContratacao`
- Rodapé: botão `✗ Reprovar` (outline vermelho) + `✓ Aprovar` (preenchido verde)
- Botão **Aprovar** reusa o fluxo de `AcoesLancamento` existente (modal preview valores) — pode-se renderizar o próprio `<AcoesLancamento ... />` oculto estruturalmente, com triggers via ref, OU extrair a lógica dos dialogs em componente separado reusável. **Construtor decide** (minha preferência: duplicar visualmente só os 2 botões; delega aos dialogs via portal re-exposto).

**em_andamento:**
- Nome + tipo lançamento + tipo contratação
- Barra de progresso (CSS width proporcional) + badge `N/M documentos`
  - N = `folhas_clt_com_recibo + folhas_pj_com_nf`
  - M = `folhas_total`
- Clica no card → chama `onClick(row)` (modal detalhado na Task 6)
- Vencimento abaixo: `Vence DD/MM`

**enviada:**
- Nome + tipo
- Badge "Enviado em DD/MM" (do `aprovado_em` por ora, pode ter `enviada_em` em iteração)
- Readonly — clica abre modal readonly (reusa modal da Task 6 em modo readonly, cards não precisam de ação)

**parcial:**
- Nome + tipo
- Badge `N/M pagas` + barra de progresso
- Readonly

**finalizada:**
- Nome + tipo
- Ícone pelo motivo final:
  - Reprovado: ✗ vermelho + motivo truncado
  - Cancelado: traço cinza
  - Pago (todas): ✓ verde + "Pago em DD/MM" (se disponível) ou "Finalizado"
- Readonly

- [ ] **Step 1: Criar `card-fluxo.tsx`**

Client component com switch na prop `coluna` renderizando a variante. Reusa `formatarTipoContratacao`. Clique vira callback `onClick?: (row) => void` (usado nas colunas em_andamento/enviada/parcial/finalizada; pendente não dispara onClick).

- [ ] **Step 2: Integrar no kanban**

Em `aba-fluxo-kanban.tsx`, trocar o placeholder por `<CardFluxo row={row} coluna={coluna} onClick={abrirModalDocs} />`. Por ora `abrirModalDocs` é no-op (próxima task adiciona o modal).

- [ ] **Step 3: `npm run typecheck && npm run lint`**

- [ ] **Step 4: Verificação manual**

Rodar dev. Abrir `/rh/ferias?tab=fluxo`:
- Cards aparecem bem formatados nas 5 colunas
- Botões ✓/✗ na coluna Pendentes abrem os dialogs corretos (aprovação com preview; reprovação com motivo)

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/rh/ferias/card-fluxo.tsx" "app/(app)/rh/ferias/aba-fluxo-kanban.tsx"
git commit -m "feat(rh/ferias): cards variantes por coluna no kanban Fluxo"
```

---

## Task 6: Modal "Em andamento" com slots de doc + envio em lote

**Files:**
- Create: `app/(app)/rh/ferias/modal-documentos.tsx`
- Modify: `app/(app)/rh/ferias/aba-fluxo-kanban.tsx` — abre modal ao clicar card em_andamento/enviada/parcial/finalizada

**Interfaces:**
- Consumes: `enviarFolhasFerias` (Task 3), `anexarReciboContabilFolhaFerias` (existente), `gerarUrlUploadReciboContabil` (existente), `ModalAnexarRecibo` (ajustado Task 7)
- Produces:
  - `<ModalDocumentos row open onClose onSucesso />`
  - Server component helper em `aba-fluxo.tsx` **passa junto** uma lista de folhas por lançamento (`folhasPorLancamento: Record<string, FolhaDoc[]>`) — nova query no server component (não dá pra fazer no client por causa de RLS/signed URLs)

**Tipo `FolhaDoc`:**
```ts
type FolhaDoc = {
  id: string;
  origem: "california" | "contabilidade";
  tipo_folha_ferias: "usufruto" | "abono" | null;
  salario_base: number;
  status: "rascunho" | "enviada" | "aprovada" | "pendente_correcao" | "paga";
  anexo_url: string | null;
  nf_anexada: boolean;  // só pra PJ; pra CLT ignora
};
```

- [ ] **Step 1: Server component carrega folhas das linhas visíveis**

Em `aba-fluxo.tsx`, após o SELECT da view, fazer 2ª query:

```ts
const { data: folhasData } = await supabase
  .from("folhas_pagamento")
  .select("id, lancamento_ferias_id, origem, tipo_folha_ferias, salario_base, status, anexo_url")
  .eq("tenant_id", tenantId)
  .eq("tipo", "ferias")
  .in("lancamento_ferias_id", rows.map((r) => r.lancamento_id).filter(Boolean));
```

E 3ª query pras NFs anexadas:

```ts
const { data: nfsData } = await supabase
  .from("colaboradores_nf_anexos")
  .select("escopo_id, escopo_tipo")
  .in("escopo_id", folhasPorPJ.map(…))
  .in("escopo_tipo", ["ferias_usufruto", "ferias_abono"]);
```

Agrega: `folhasPorLancamento[lancamento_id] = FolhaDoc[]` com `nf_anexada` populado pros PJ.

- [ ] **Step 2: Criar `modal-documentos.tsx`**

Client component. Props: `row`, `folhas: FolhaDoc[]`, `open`, `onClose`, `onSucesso`.

Estrutura:
- `Dialog` do shadcn, `max-w-2xl`
- Header: nome colaborador + tipo contratação (badge) + tipo lançamento + período
- Progresso visual: `N/M documentos anexados` + barra
- Lista dos slots (1 por folha):
  - Ícone + label do tipo: "Férias / PJ · NF", "Férias / CLT · Recibo contabilidade", "Abono / PJ · NF", "Abono / CLT · Recibo abono California"
  - Status:
    - PJ anexado (`nf_anexada`): ✓ verde "NF anexada"
    - PJ pendente: "Aguardando colab anexar no quadro NF do perfil" (sem botão)
    - CLT anexado (`anexo_url`): ✓ verde "Recibo anexado" + link "Ver"
    - CLT pendente: botão "Anexar" (abre `ModalAnexarRecibo`)
  - Valor: `R$ X.XXX,XX`
- Footer:
  - "Fechar" (esquerda)
  - "Enviar ao financeiro" (direita, primário):
    - Habilitado só se todas as folhas enviáveis (CLT com anexo_url, PJ com nf_anexada)
    - Clicar: chama `enviarFolhasFerias({ ids: folhas.map((f) => f.id) })`
    - Se ok: `onSucesso()` → fecha modal + revalida página

Readonly mode (quando coluna != em_andamento): esconde botões, só mostra status + links pra ver docs.

- [ ] **Step 3: Integrar com `aba-fluxo-kanban.tsx`**

Estado `rowSelecionado: RhFeriasFluxoRow | null`. Ao clicar card: `setRowSelecionado(row)`. Modal renderizado condicionalmente:
```tsx
{rowSelecionado && (
  <ModalDocumentos
    row={rowSelecionado}
    folhas={folhasPorLancamento[rowSelecionado.lancamento_id] ?? []}
    open
    onClose={() => setRowSelecionado(null)}
    onSucesso={() => { setRowSelecionado(null); router.refresh(); }}
  />
)}
```

- [ ] **Step 4: `npm run typecheck && npm run lint`**

- [ ] **Step 5: Verificação manual**

- Clica num card em_andamento do Antonio (depois de regerar as 4 folhas) → vê os 4 slots
- Anexa recibo CLT: valor atualiza, slot vira ✓
- Anexa NF via perfil do Antonio (noutra janela): revalida, slot PJ vira ✓
- Com 4/4 ok, botão "Enviar ao financeiro" habilita → clica → folhas vão pra `status=enviada`, card migra pra coluna "Enviadas"

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/rh/ferias/modal-documentos.tsx" "app/(app)/rh/ferias/aba-fluxo-kanban.tsx" "app/(app)/rh/ferias/aba-fluxo.tsx"
git commit -m "feat(rh/ferias): ModalDocumentos com slots + envio em lote por lancamento"
```

---

## Task 7: `ModalAnexarRecibo` diferencia usufruto/abono CLT

**Files:**
- Modify: `app/(app)/rh/ferias/modal-anexar-recibo.tsx`

**Interfaces:**
- Consumes: `tipo_folha_ferias` da folha (prop nova)
- Produces: modal com UI diferenciada por tipo

- [ ] **Step 1: Adicionar prop `tipo_folha_ferias`**

Hoje o modal recebe `folha: PagamentoFerias`. Mudar prop pra receber também `tipo_folha_ferias: "usufruto" | "abono" | null` (ou já estar em `folha`). Padronizar com uma nova interface `FolhaCLT` que inclui esse campo.

- [ ] **Step 2: UI condicional**

Dentro do componente, antes do form:
```ts
const isAbono = tipo_folha_ferias === "abono";
const titulo = isAbono
  ? "Anexar recibo de abono California"
  : "Anexar recibo da contabilidade";
const labelPdf = isAbono
  ? "Recibo assinado pelo colaborador"
  : "PDF do recibo (opcional pra atualizar valor)";
const labelValor = isAbono ? "Valor do abono (R$)" : "Valor líquido do recibo (R$)";
const ajudaValor = isAbono
  ? `Deve bater com o abono calculado R$ ${formatarMoeda(folha.salario_base)}`
  : "Valor que o financeiro vai pagar efetivamente (já com descontos aplicados).";
```

Nota explicativa adicional pra abono: "Esse é o modelo California do abono, preenchido e assinado pelo colaborador."

- [ ] **Step 3: `npm run typecheck`**

- [ ] **Step 4: Verificação manual**

Abre modal via slot "Férias/CLT" → vê UI do recibo contabilidade. Via slot "Abono/CLT" → vê UI do recibo California.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/rh/ferias/modal-anexar-recibo.tsx"
git commit -m "feat(rh/ferias): ModalAnexarRecibo diferencia usufruto vs abono CLT"
```

---

## Task 8: Delete abas antigas + limpeza

**Files:**
- Delete: `app/(app)/rh/ferias/aba-solicitacoes.tsx`
- Delete: `app/(app)/rh/ferias/aba-pagamentos.tsx`
- Delete: `app/(app)/rh/ferias/pagamentos-lista-cliente.tsx`

**Interfaces:** Nenhuma (só limpeza).

- [ ] **Step 1: Confirmar que nada mais importa esses arquivos**

Rodar grep: `grep -rn "aba-solicitacoes\|AbaSolicitacoes\|aba-pagamentos\|AbaPagamentos\|pagamentos-lista-cliente\|PagamentosListaCliente" app lib`.
Esperado: zero matches (page.tsx já foi atualizado na Task 4).

- [ ] **Step 2: Delete via git**

```bash
git rm "app/(app)/rh/ferias/aba-solicitacoes.tsx"
git rm "app/(app)/rh/ferias/aba-pagamentos.tsx"
git rm "app/(app)/rh/ferias/pagamentos-lista-cliente.tsx"
```

- [ ] **Step 3: `npm run typecheck && npm run lint`**

Esperado: zero erros novos (pré-existentes do multi-select continuam).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(rh/ferias): remove abas Solicitacoes e Pagamentos antigas (substituidas por Fluxo)"
```

---

## Encerramento

- [ ] **Rodar `npm run lint && npm run typecheck && npm test` numa só sequência.** Esperado: tudo verde.
- [ ] **Smoke manual com o Antonio TESTE (híbrido abono combinado):**
  1. Reaprova a solicitação dele pelo kanban → 4 folhas criadas → card vai pra "Em andamento" com `0/4`
  2. Anexa recibo contabilidade (Férias/CLT) → `1/4`
  3. Anexa recibo abono California (Abono/CLT) → `2/4`
  4. Como Antonio no `/perfil`, anexa NF férias e NF abono → `4/4`
  5. Volta pro kanban RH, abre modal, clica "Enviar ao financeiro" → card migra pra "Enviadas"
- [ ] **Verificar redirect:** acessar `/rh/ferias?tab=solicitacoes` e `/rh/ferias?tab=pagamentos` → ambos redirecionam pra `/rh/ferias?tab=fluxo`
