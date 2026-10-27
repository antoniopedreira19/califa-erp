# Modal "Solicitar férias" + abono combinado end-to-end — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o drawer lateral de "Solicitar férias" por modal centralizado com 3 tipos (férias / férias+venda / só venda), implementar `abono_combinado` end-to-end (schema + cálculo + action) e reusar o form na tela de lançamento direto do RH.

**Architecture:** Nova coluna `dias_abono` em `colaboradores_ferias_lancamentos` que marca quantos dias são vendidos quando `tipo='abono_combinado'`. `calcular-valores.ts` ganha parâmetro `diasAbono` e separa `valor_ferias` (diário × dias_folga) de `valor_abono` (diário × dias_abono). UI é um componente shared `SolicitarFeriasForm` que vive em `_components/` e é renderizado dentro de um Dialog em `/perfil` ou dentro do slot existente em `/rh/ferias/lancar-direto`.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Supabase Postgres, `node --test` + `tsx`, shadcn/ui Dialog.

**Spec:** [docs/superpowers/specs/2026-10-27-solicitar-ferias-modal-abono-combinado-design.md](../specs/2026-10-27-solicitar-ferias-modal-abono-combinado-design.md)

## Global Constraints

- **Linguagem UI:** PT-BR com acentuação completa em qualquer string renderizada ou mensagem de erro (CLAUDE.md "Ortografia em português").
- **Banco pelo fluxo do MCP:** migration via `apply_migration`, conferência pelo MCP, commit junto do código que depende (`docs/FLUXO-BANCO.md`).
- **`lib/types.ts` à mão:** `dias_abono: number` em `ColaboradorFeriasLancamento` no MESMO commit da migration.
- **Nenhum PII em arquivos versionados** — testes usam placeholders ou dependency injection.
- **Framework teste:** `node --test` + `tsx`. Arquivos `*.test.ts` ao lado do código.
- **"misto" morre no código** — nunca chegou ao banco; era placeholder no schema do action. Toda referência vai pro lixo.
- **Enum do banco já tem `abono_combinado`** (confirmado via MCP) — nenhum `ALTER TYPE ... ADD VALUE` necessário.
- **Fluxo híbrido `clt_recibo + abono_combinado`** mantém comportamento atual: RH ajusta valor CLT manualmente quando recibo chega. Resolver separação CLT fica fora de escopo (caso raro).
- **`abono_avulso` continua restrito a PJ**; `abono_combinado` disponível pra todos (exceto sócio, filtrado antes do form abrir).
- **Antecedência mínima colaborador:** 5 dias (constante existente `ANTECEDENCIA_MINIMA_DIAS`); RH não tem antecedência mínima (lançamento retroativo permitido).

## Review Focus

1. **Rollout parcial do CHECK:** se a migration aplica mas as actions ainda não aceitam `abono_combinado`, o CHECK não bloqueia dados existentes (todos têm `dias_abono=0` por DEFAULT); mas se alguém chamar `lancarDiretoPeloRh` com `tipo='abono_combinado'` antes de Task 4 atualizar o schema, falha com mensagem crua do Postgres. Task 1 confirma via MCP que nenhuma linha existente viola e as Tasks 3-4 garantem server-side.
2. **Saldo quando `abono_combinado`:** `dias` persistido inclui `dias_abono`, logo `fn_valida_saldo_periodo` conta a venda contra o saldo. Teste em Task 3 valida que `data_inicio..data_fim = 20 dias + dias_abono = 10` resulta em `dias = 30` persistido e consumido do saldo.
3. **1/3 constitucional em `abono_combinado`:** cálculo em Task 2 testa que `valor_um_terco = valor_ferias / 3` (não `(valor_ferias + valor_abono) / 3`).
4. **CLT + `abono_avulso`:** continua bloqueado com mensagem explícita (regra atual preservada). Teste em Task 3.
5. **Form compartilhado em dois contextos:** colab vs RH diferem em antecedência (5 dias vs retroativo), label do botão submit ("Enviar solicitação" vs "Lançar"), e disponibilidade de modo retroativo (só RH). Tasks 5-7 cobrem via prop `modo: 'colaborador' | 'rh'`.

---

## File Structure

**Create:**
- `supabase/migrations/20261027700001_ferias_lancamentos_dias_abono.sql`
- `lib/ferias/calcular-valores.test.ts` (se não existir — testes puros com `salarioBaseOverride`)
- `app/(app)/_components/solicitar-ferias-form.tsx` — componente shared (3 cards + campos condicionais + resumo); renderiza só o `<form>`, sem container
- `app/(app)/perfil/solicitar-ferias-modal.tsx` — `Dialog` centralizado que embrulha `SolicitarFeriasForm` com `modo="colaborador"`

**Modify:**
- `lib/types.ts` — adicionar `dias_abono: number` em `ColaboradorFeriasLancamento`
- `lib/ferias/calcular-valores.ts` — assinatura ganha `diasAbono?: number`; nova lógica pra `abono_combinado`
- `app/(app)/perfil/actions.ts` — schema aceita `tipo: 'usufruto' | 'abono_avulso' | 'abono_combinado'` (mata `"misto"`); valida `dias_abono > 0` quando combinado; insert persiste tipo real + `dias = dias_folga + dias_abono` + `dias_abono`
- `app/(app)/rh/ferias/actions.ts` — `lancamentoDiretoSchema` ganha `dias_abono: z.number().int().min(0).default(0)`; `aprovarLancamento` passa `dias_abono` do lançamento pro `calcularValoresLancamento`; `lancarDiretoPeloRh` persiste `dias` total + `dias_abono`
- `app/(app)/perfil/card-minhas-ferias.tsx` — troca import `SolicitarFeriasDrawer` por `SolicitarFeriasModal`
- `app/(app)/rh/ferias/lancar-direto-form.tsx` — troca corpo pelo `SolicitarFeriasForm` com `modo="rh"` (preserva props existentes + callbacks `onFechar`/`onSucesso`)

**Delete:**
- `app/(app)/perfil/solicitar-ferias-drawer.tsx`

---

## Task 1: Migration `dias_abono` + types

**Files:**
- Create: `supabase/migrations/20261027700001_ferias_lancamentos_dias_abono.sql`
- Modify: `lib/types.ts`

**Interfaces:**
- Produces:
  - coluna `dias_abono int NOT NULL DEFAULT 0 CHECK (dias_abono >= 0)` em `colaboradores_ferias_lancamentos`
  - constraint `chk_dias_abono_so_combinado` garante `(tipo='abono_combinado' AND dias_abono>0) OR (tipo<>'abono_combinado' AND dias_abono=0)`
  - `ColaboradorFeriasLancamento.dias_abono: number` em `lib/types.ts`

- [ ] **Step 1: Ler estado atual pelo MCP**

Via `mcp__supabase__execute_sql`:
- `SELECT column_name FROM information_schema.columns WHERE table_name='colaboradores_ferias_lancamentos' AND column_name='dias_abono'` → confirmar ausência
- `SELECT tipo, count(*) FROM colaboradores_ferias_lancamentos GROUP BY tipo` → confirmar nenhum `abono_combinado` pré-existente

Documentar os counts no report (comentário na migration ok).

- [ ] **Step 2: Escrever migration**

Arquivo `supabase/migrations/20261027700001_ferias_lancamentos_dias_abono.sql`:

```sql
-- Motivo: suportar abono_combinado end-to-end (colaborador tira X dias +
-- vende Y no mesmo pedido). Hoje o campo não existe; cálculo trata
-- abono_combinado como usufruto puro (valor_abono=0), gerando bug latente
-- (2ª folha com salario_base=0). Nenhum lançamento existente é combinado.
-- Spec: docs/superpowers/specs/2026-10-27-solicitar-ferias-modal-abono-combinado-design.md

ALTER TABLE public.colaboradores_ferias_lancamentos
  ADD COLUMN IF NOT EXISTS dias_abono int NOT NULL DEFAULT 0
  CHECK (dias_abono >= 0);

COMMENT ON COLUMN public.colaboradores_ferias_lancamentos.dias_abono IS
  'Dias que o colaborador vende dentro do bloco de férias (só aplica a tipo=abono_combinado). Pra outros tipos sempre 0. O campo dias (existente) é o TOTAL consumido do saldo (dias_folga + dias_abono).';

ALTER TABLE public.colaboradores_ferias_lancamentos
  ADD CONSTRAINT chk_dias_abono_so_combinado
  CHECK (
    (tipo = 'abono_combinado' AND dias_abono > 0)
    OR (tipo <> 'abono_combinado' AND dias_abono = 0)
  );
```

- [ ] **Step 3: Aplicar via `mcp__supabase-write__apply_migration`**

Nome: `ferias_lancamentos_dias_abono`.

- [ ] **Step 4: Conferir pelo MCP**

Via `execute_sql`:
- `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='colaboradores_ferias_lancamentos' AND column_name='dias_abono'` → `int4`, default `0`
- `SELECT conname FROM pg_constraint WHERE conname='chk_dias_abono_so_combinado'` → retorna 1 linha
- `SELECT count(*) FROM colaboradores_ferias_lancamentos WHERE dias_abono IS NULL` → 0

- [ ] **Step 5: Teste SQL do constraint via MCP (BEGIN/ROLLBACK)**

```sql
BEGIN;
-- Caso válido: usufruto com dias_abono=0 (default) deve passar
INSERT INTO colaboradores_ferias_lancamentos (tenant_id, colaborador_id, tipo, data_inicio, data_fim, dias, solicitado_por)
VALUES (<tenant_id_real>, <colab_id_real>, 'usufruto', '2027-01-01', '2027-01-20', 20, <profile_id>);
-- Esperado: PASS

-- Caso inválido: usufruto com dias_abono > 0 deve falhar
INSERT INTO colaboradores_ferias_lancamentos (tenant_id, colaborador_id, tipo, data_inicio, data_fim, dias, dias_abono, solicitado_por)
VALUES (<tenant_id_real>, <colab_id_real>, 'usufruto', '2027-02-01', '2027-02-20', 20, 5, <profile_id>);
-- Esperado: ERROR chk_dias_abono_so_combinado violated

-- Caso válido: abono_combinado com dias_abono > 0
INSERT INTO colaboradores_ferias_lancamentos (tenant_id, colaborador_id, tipo, data_inicio, data_fim, dias, dias_abono, solicitado_por)
VALUES (<tenant_id_real>, <colab_id_real>, 'abono_combinado', '2027-03-01', '2027-03-20', 30, 10, <profile_id>);
-- Esperado: PASS

-- Caso inválido: abono_combinado com dias_abono = 0
INSERT INTO colaboradores_ferias_lancamentos (tenant_id, colaborador_id, tipo, data_inicio, data_fim, dias, dias_abono, solicitado_por)
VALUES (<tenant_id_real>, <colab_id_real>, 'abono_combinado', '2027-04-01', '2027-04-20', 20, 0, <profile_id>);
-- Esperado: ERROR chk_dias_abono_so_combinado violated

ROLLBACK;
```

Documentar outputs no report.

- [ ] **Step 6: Atualizar `lib/types.ts`**

Adicionar `dias_abono: number;` no interface `ColaboradorFeriasLancamento`. Mantém backward-compat (campo com default no DB).

- [ ] **Step 7: `npm run typecheck`**

Esperado: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261027700001_ferias_lancamentos_dias_abono.sql lib/types.ts
git commit -m "feat(ferias): coluna dias_abono + check constraint pra abono_combinado"
```

---

## Task 2: `calcular-valores.ts` com `diasAbono`

**Files:**
- Modify: `lib/ferias/calcular-valores.ts`
- Create: `lib/ferias/calcular-valores.test.ts`

**Interfaces:**
- Consumes: enum `FeriasLancamentoTipo` (existente), `ValoresLancamento` type (existente)
- Produces:
  - `calcularValoresLancamento(colaboradorId, dataInicio, tipo, dias, diasAbono?, salarioBaseOverride?)` com `diasAbono` default 0
  - Lógica nova pro ramo `abono_combinado`

- [ ] **Step 1: Escrever testes com `salarioBaseOverride` (sem Supabase)**

Arquivo `lib/ferias/calcular-valores.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularValoresLancamento } from "./calcular-valores";

const SALARIO = 3000;
const DIARIO = 100; // 3000 / 30

test("usufruto: 20 dias", async () => {
  const v = await calcularValoresLancamento("x", "2027-01-01", "usufruto", 20, 0, SALARIO);
  assert.equal(v?.valor_ferias, 2000);
  assert.equal(v?.valor_abono, 0);
  assert.equal(v?.valor_um_terco, round2(2000 / 3));
  assert.equal(v?.valor_total, round2(2000 + 0 + 2000/3));
});

test("abono_avulso: 10 dias", async () => {
  const v = await calcularValoresLancamento("x", "2027-01-01", "abono_avulso", 10, 0, SALARIO);
  assert.equal(v?.valor_ferias, 0);
  assert.equal(v?.valor_abono, 1000);
  assert.equal(v?.valor_um_terco, round2(1000 / 3));
});

test("abono_combinado: 20 folga + 10 abono = 30 dias", async () => {
  const v = await calcularValoresLancamento("x", "2027-01-01", "abono_combinado", 30, 10, SALARIO);
  // dias_folga = 30 - 10 = 20
  assert.equal(v?.valor_ferias, 2000);  // diario × dias_folga
  assert.equal(v?.valor_abono, 1000);   // diario × dias_abono
  assert.equal(v?.valor_um_terco, round2(2000 / 3));  // só sobre valor_ferias
  assert.equal(v?.valor_total, round2(2000 + 1000 + 2000/3));
});

test("abono_excepcional: 15 dias", async () => {
  const v = await calcularValoresLancamento("x", "2027-01-01", "abono_excepcional", 15, 0, SALARIO);
  assert.equal(v?.valor_ferias, 0);
  assert.equal(v?.valor_abono, 1500);
  assert.equal(v?.valor_um_terco, round2(1500 / 3));
});

test("retorna null quando salario inválido", async () => {
  const v = await calcularValoresLancamento("x", "2027-01-01", "usufruto", 10, 0, 0);
  assert.equal(v, null);
});

function round2(n: number): number { return Math.round(n * 100) / 100; }
```

- [ ] **Step 2: Rodar testes — devem FALHAR (função atual não aceita `diasAbono`)**

`npx tsx --test lib/ferias/calcular-valores.test.ts` — espera que o teste de `abono_combinado` falhe por `valor_abono !== 1000` (hoje volta 0).

- [ ] **Step 3: Expandir `calcularValoresLancamento`**

Assinatura:
```ts
export async function calcularValoresLancamento(
  colaboradorId: string,
  dataInicio: string,
  tipo: FeriasLancamentoTipo,
  dias: number,
  diasAbono: number = 0,
  salarioBaseOverride?: number,
): Promise<ValoresLancamento | null>
```

Lógica no body (substitui linhas 69-80 atuais):
```
diario = salario / 30
diasFolga = dias - diasAbono

switch tipo:
  usufruto:
    valor_ferias = diario * dias; valor_abono = 0; valor_um_terco = valor_ferias / 3
  abono_avulso | abono_excepcional:
    valor_ferias = 0; valor_abono = diario * dias; valor_um_terco = valor_abono / 3
  abono_combinado:
    valor_ferias = diario * diasFolga; valor_abono = diario * diasAbono
    valor_um_terco = valor_ferias / 3  // só sobre férias (CLT)
```

`valor_total = valor_ferias + valor_abono + valor_um_terco` em todos os casos. Round2 em todos.

Atualizar o alias `calcularValoresLancamentoPJ` pra também aceitar `diasAbono` opcional e passar adiante.

- [ ] **Step 4: Rodar testes — devem PASSAR**

`npx tsx --test lib/ferias/calcular-valores.test.ts` → 5/5.

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add lib/ferias/calcular-valores.ts lib/ferias/calcular-valores.test.ts
git commit -m "feat(ferias): calcular-valores suporta diasAbono em abono_combinado"
```

---

## Task 3: Action do colaborador (`solicitarFerias`)

**Files:**
- Modify: `app/(app)/perfil/actions.ts`
- Create: `app/(app)/perfil/actions.test.ts` (teste puro do schema de validação)

**Interfaces:**
- Consumes: migration + `dias_abono` da Task 1
- Produces:
  - `solicitarFerias(input)` aceita `tipo: 'usufruto' | 'abono_avulso' | 'abono_combinado'` + `dias_abono: number` no payload
  - Persiste tipo real (sem remapeamento `misto→usufruto`); `dias` total = `(data_fim - data_inicio + 1) + dias_abono`

- [ ] **Step 1: Testar `solicitarSchema` puro (sem Supabase)**

Em `app/(app)/perfil/actions.test.ts` — extrair `solicitarSchema` como export nomeado se ainda não é, pra testar isolado.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { solicitarSchema } from "./actions";

test("usufruto: dias_abono=0 obrigatório, periodo_id obrigatório", () => {
  const base = { tipo: "usufruto", periodo_id: "11111111-1111-1111-1111-111111111111",
    data_inicio: "2030-01-01", data_fim: "2030-01-20", dias_abono: 0 };
  assert.equal(solicitarSchema.safeParse(base).success, true);
  assert.equal(solicitarSchema.safeParse({ ...base, dias_abono: 5 }).success, false);
  assert.equal(solicitarSchema.safeParse({ ...base, periodo_id: null }).success, false);
});

test("abono_avulso: periodo_id null, dias_abono=0", () => {
  const base = { tipo: "abono_avulso", periodo_id: null,
    data_inicio: "2030-01-01", data_fim: "2030-01-10", dias_abono: 0 };
  assert.equal(solicitarSchema.safeParse(base).success, true);
  assert.equal(solicitarSchema.safeParse({ ...base, periodo_id: "11111111-1111-1111-1111-111111111111" }).success, false);
});

test("abono_combinado: periodo_id obrigatório, dias_abono > 0", () => {
  const base = { tipo: "abono_combinado", periodo_id: "11111111-1111-1111-1111-111111111111",
    data_inicio: "2030-01-01", data_fim: "2030-01-20", dias_abono: 10 };
  assert.equal(solicitarSchema.safeParse(base).success, true);
  assert.equal(solicitarSchema.safeParse({ ...base, dias_abono: 0 }).success, false);
  assert.equal(solicitarSchema.safeParse({ ...base, periodo_id: null }).success, false);
});

test("misto rejeitado (removido do enum)", () => {
  const r = solicitarSchema.safeParse({ tipo: "misto", periodo_id: null,
    data_inicio: "2030-01-01", data_fim: "2030-01-10", dias_abono: 0 });
  assert.equal(r.success, false);
});

test("data_inicio < hoje+5 rejeitado", () => {
  const hoje = new Date().toISOString().slice(0,10);
  const r = solicitarSchema.safeParse({ tipo: "usufruto", periodo_id: "11111111-1111-1111-1111-111111111111",
    data_inicio: hoje, data_fim: hoje, dias_abono: 0 });
  assert.equal(r.success, false);
});
```

Nota: a regra "CLT + abono_avulso = bloqueado" roda dentro da `solicitarFerias` (não do schema) e exige lookup no DB — não testar aqui. Preservada pela não-remoção das linhas 110-117 (regra atual).

- [ ] **Step 2: Rodar testes — FAIL**

`npx tsx --test app/\(app\)/perfil/actions.test.ts` — espera failures no schema atual (não exporta, aceita "misto", não valida dias_abono).

- [ ] **Step 3: Modificar `solicitarSchema` e `solicitarFerias`**

Schema:
- `tipo: z.enum(["usufruto", "abono_avulso", "abono_combinado"])` (removido "misto")
- `dias_abono: z.number().int().min(0).max(30)` com default 0
- `superRefine` novas regras (ver Interfaces acima)
- Exportar `solicitarSchema` se não exportado

`solicitarFerias`:
- Remover linha `tipo: dados.tipo === "misto" ? "usufruto" : dados.tipo` → trocar por `tipo: dados.tipo` direto
- Calcular `diasFolga = diasEntre(data_inicio, data_fim)` e `dias = diasFolga + dados.dias_abono`
- Persistir `dias_abono: dados.dias_abono` no insert
- Preservar validação `CLT + abono_avulso = bloqueado` (regra existente, linhas 110-117)
- Validação saldo: `diasOcupados + dias <= dias_direito` (dias já inclui abono — regra de saldo cobre venda)

- [ ] **Step 4: Rodar testes — PASS**

- [ ] **Step 5: `npm run typecheck && npm run lint`**

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/perfil/actions.ts app/\(app\)/perfil/actions.test.ts
git commit -m "feat(perfil): solicitarFerias aceita abono_combinado real com dias_abono"
```

---

## Task 4: Actions do RH (`lancarDiretoPeloRh` + `aprovarLancamento`)

**Files:**
- Modify: `app/(app)/rh/ferias/actions.ts`
- Create: `app/(app)/rh/ferias/actions.test.ts` (teste puro do `lancamentoDiretoSchema`)

**Interfaces:**
- Consumes: `calcularValoresLancamento` nova assinatura (Task 2), migration (Task 1)
- Produces:
  - `lancamentoDiretoSchema` aceita `tipo: 'usufruto' | 'abono_avulso' | 'abono_combinado' | 'abono_excepcional'` + `dias_abono: number`
  - `aprovarLancamento` lê `dias_abono` do lançamento e passa pro cálculo
  - `lancarDiretoPeloRh` persiste `dias_abono` + `dias = dias_folga + dias_abono`

- [ ] **Step 1: Testar `lancamentoDiretoSchema` puro**

Em `app/(app)/rh/ferias/actions.test.ts` — testes análogos ao Task 3 mas com os 4 tipos de abono (RH tem acesso ao `abono_excepcional`):

```ts
test("abono_combinado requer dias_abono > 0 + periodo_id", () => {...});
test("abono_excepcional requer dias_abono = 0 (não é combinado)", () => {...});
test("usufruto proíbe dias_abono > 0", () => {...});
```

Exportar `lancamentoDiretoSchema` se não exportado.

- [ ] **Step 2: Rodar testes — FAIL**

- [ ] **Step 3: Modificar `lancamentoDiretoSchema` e `lancarDiretoPeloRh`**

Schema: adicionar `dias_abono: z.number().int().min(0).max(30).default(0)`. Validação condicional igual Task 3.

`lancarDiretoPeloRh`:
- Calcular `dias = diasFolga + dias_abono`
- Persistir `dias_abono`
- Chamar `calcularValoresLancamento(..., dias, dias_abono, salarioOverride?)` ao preencher valores

`aprovarLancamento` (função existente linhas 42-130):
- No lookup do lançamento, incluir `dias_abono` no select (linha 32 — adicionar ao select)
- Passar `lanc.dias_abono` como novo parâmetro do `calcularValoresLancamentoPJ` (que agora também aceita diasAbono)

- [ ] **Step 4: Rodar testes — PASS**

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/rh/ferias/actions.ts app/\(app\)/rh/ferias/actions.test.ts
git commit -m "feat(rh/ferias): lancarDiretoPeloRh aceita abono_combinado + aprovar passa dias_abono"
```

---

## Task 5: Componente shared `SolicitarFeriasForm`

**Files:**
- Create: `app/(app)/_components/solicitar-ferias-form.tsx`

**Interfaces:**
- Consumes: `solicitarFerias` (Task 3) e `lancarDiretoPeloRh` (Task 4) via prop callback
- Produces:
  - Component `<SolicitarFeriasForm />` com props:
    ```ts
    type Props = {
      periodos: Array<ColaboradorFeriasPeriodo & { saldo: number }>;
      tipoContratacao: TipoContratacao;
      modo: "colaborador" | "rh";
      onSubmit: (payload: SolicitarFeriasPayload) => Promise<{ ok: true; id: string } | { ok: false; message: string; fieldErrors?: Record<string,string[]> }>;
      onSucesso: () => void;
      onCancelar: () => void;
    };
    export type SolicitarFeriasPayload = {
      tipo: "usufruto" | "abono_avulso" | "abono_combinado";
      periodo_id: string | null;
      data_inicio: string;
      data_fim: string;
      dias_abono: number;
      observacao: string | null;
    };
    ```

- [ ] **Step 1: Criar o component**

Client component. Estrutura top-down:

1. Estado local: `tipo`, `periodoId`, `dataInicio`, `dataFim`, `diasAbono`, `observacao`, `erro`, `fieldErrors`, `pending`
2. `permiteAbonoAvulso = tipoContratacao === "pj"` (idêntico ao atual)
3. `permiteCombinado = periodosComSaldo.length > 0`
4. Cards clicáveis (grid 3 colunas desktop, 1 coluna mobile):
   - **Férias** (`Palmtree`): sempre visível
   - **Férias + venda** (`Split`): só se `permiteCombinado`
   - **Só venda** (`DollarSign`): só se `permiteAbonoAvulso`
5. Trocar card zera `periodoId`, `dataInicio`, `dataFim`, `diasAbono`
6. Período aquisitivo (Select): só pra `usufruto` + `abono_combinado`
7. Data início / Data fim (DatePickers): sempre; `dateDisabled` depende de `modo`:
   - `colaborador`: >= hoje + 5 dias
   - `rh`: sem antecedência (lançamento retroativo permitido)
8. Input "Quantos dias vender?" (apenas `abono_combinado`): numeric 1-30
9. Observação (Textarea): opcional
10. Resumo em card:
    - usufruto: `N dias de folga · Saldo após: X dias`
    - abono_combinado: `N dias de folga + M vendidos = T dias · Saldo após: X dias` + warning âmbar se M > 10
    - abono_avulso: `M dias vendidos` + warning âmbar se M > 10
    - Vermelho se total excede saldo
11. Footer com Cancelar + Submit (label do submit depende de `modo`):
    - colaborador: `"Enviar solicitação"`
    - rh: `"Lançar"`
12. Submit chama `onSubmit(payload)`; se `ok=true` chama `onSucesso()`, senão popula `erro` + `fieldErrors`

Pode copiar grande parte da estrutura visual atual de `solicitar-ferias-drawer.tsx` adaptando pros 3 tipos (não dois) + cards no lugar de dropdown + campo `dias_abono`.

- [ ] **Step 2: `npm run typecheck && npm run lint`**

Esperado: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/_components/solicitar-ferias-form.tsx
git commit -m "feat(ferias): componente shared SolicitarFeriasForm com 3 cards de tipo"
```

---

## Task 6: Modal no `/perfil` + delete do drawer

**Files:**
- Create: `app/(app)/perfil/solicitar-ferias-modal.tsx`
- Modify: `app/(app)/perfil/card-minhas-ferias.tsx`
- Delete: `app/(app)/perfil/solicitar-ferias-drawer.tsx`

**Interfaces:**
- Consumes: `SolicitarFeriasForm` (Task 5), `solicitarFerias` (Task 3)
- Produces: `<SolicitarFeriasModal periodos tipoContratacao />` client component que gerencia estado `open` + trigger button + Dialog

- [ ] **Step 1: Criar `solicitar-ferias-modal.tsx`**

Client component. Estrutura:
- Trigger button (`<Palmtree /> Solicitar férias`) com guard `semSaldoNemAbono` igual ao atual
- `<Dialog>` do shadcn com `<DialogContent className="max-w-2xl">` (centralizado)
- Header: título + descrição (texto atual do drawer)
- Body: `<SolicitarFeriasForm modo="colaborador" ... onSubmit={solicitarFerias} onSucesso={() => { setOpen(false); router.refresh(); }} onCancelar={() => setOpen(false)} />`

Nenhum `DrawerContent`. Apenas `DialogContent` do shadcn padrão.

- [ ] **Step 2: Atualizar `card-minhas-ferias.tsx`**

Grep rápido por `SolicitarFeriasDrawer` — provavelmente só este arquivo importa. Trocar:
```ts
import { SolicitarFeriasDrawer } from "./solicitar-ferias-drawer";
// ...
<SolicitarFeriasDrawer periodos={...} tipoContratacao={...} />
```
Por:
```ts
import { SolicitarFeriasModal } from "./solicitar-ferias-modal";
// ...
<SolicitarFeriasModal periodos={...} tipoContratacao={...} />
```

- [ ] **Step 3: Delete do drawer**

```bash
git rm app/\(app\)/perfil/solicitar-ferias-drawer.tsx
```

Confirmar antes com `grep -r "solicitar-ferias-drawer\|SolicitarFeriasDrawer" app lib` — só `card-minhas-ferias.tsx` deve referenciar.

- [ ] **Step 4: `npm run typecheck && npm run lint`**

- [ ] **Step 5: Smoke manual (se possível) ou typecheck/lint como garantia**

Rodar `npm run dev` + abrir `/perfil` como PJ. Clicar "Solicitar férias" → modal centralizado abre com 3 cards. Testar os 3 fluxos.

Se headless: documentar "sem validação visual" nas concerns.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/perfil/solicitar-ferias-modal.tsx app/\(app\)/perfil/card-minhas-ferias.tsx
git rm app/\(app\)/perfil/solicitar-ferias-drawer.tsx
git commit -m "feat(perfil): modal centralizado substitui drawer de solicitar ferias"
```

---

## Task 7: RH form reusa `SolicitarFeriasForm`

**Files:**
- Modify: `app/(app)/rh/ferias/lancar-direto-form.tsx`

**Interfaces:**
- Consumes: `SolicitarFeriasForm` (Task 5), `lancarDiretoPeloRh` (Task 4)
- Produces: `<LancarDiretoForm />` com UI consistente ao modal do colab

- [ ] **Step 1: Refatorar `lancar-direto-form.tsx`**

Preservar props do component atual (`colaboradorId`, `tipoContratacao`, `periodosComSaldo`, `onFechar`, `onSucesso`).

Substituir o corpo do form pelo `<SolicitarFeriasForm />` com `modo="rh"` e `onSubmit={(payload) => lancarDiretoPeloRh({ ...payload, colaborador_id: colaboradorId })}`.

Se o schema do `lancarDiretoPeloRh` esperar campos diferentes (ex: `colaborador_id` que não vai no payload do form), adaptar aqui no wrapper.

**Nota sobre modo retroativo:** `lancar-direto-form.tsx` atual tem um checkbox "modo retroativo" que inclui períodos regularizados. Isso é feature do RH — pode manter como wrapper acima do `SolicitarFeriasForm`, filtrando `periodosExibidos` antes de passar como prop. OU remover se o PO achar que não é prioridade — **decidir** inline, se complicar demais, documentar como concern.

- [ ] **Step 2: `npm run typecheck && npm run lint`**

- [ ] **Step 3: Smoke manual (se possível) ou typecheck/lint como garantia**

Rodar `/rh/ferias/lancar-direto` como RH. Testar os 3 fluxos.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/rh/ferias/lancar-direto-form.tsx
git commit -m "feat(rh/ferias): lancar-direto reusa SolicitarFeriasForm com modo=rh"
```

---

## Encerramento

- [ ] **Rodar `npm run lint && npm run typecheck && npm test` numa só sequência.** Esperado: tudo verde.
- [ ] **Smoke manual nos 2 contextos:**
  1. Colab PJ em `/perfil` → modal centralizado abre; os 3 cards aparecem; abono combinado persiste com `dias_abono` correto; aprovação do RH gera 2 folhas.
  2. RH em `/rh/ferias/lancar-direto` → form do colaborador escolhido abre; os 3 cards aparecem; abono combinado lançado direto cria 2 folhas na aprovação já embutida.
- [ ] **Confirmar que "misto" não aparece em nenhum arquivo** via `grep -rn '"misto"\|: "misto"' app lib` — deve retornar 0 matches.
