# Anexo de NF por colaborador PJ — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que colaboradores PJ anexem a NF mensal em `/perfil` (com countdown de dias até o prazo), bloquear a aprovação de linhas PJ no financeiro sem NF, e deixar RH acompanhar quem já entregou. Decide a janela de pagamento (salários dia 03 vs fornecedores dia 08) pela data do upload vs dia 25 do mês da competência.

**Architecture:** Nova tabela `colaboradores_nf_anexos` indexada por `(colaborador_id, competencia_ano, competencia_mes)` — desacoplada de `folhas_pagamento` (colab anexa antes do RH gerar; folha regenerada preserva NF). Bucket Storage novo `colaboradores-nf` com path `{tenant_id}/{colaborador_id}/{ano}-{mes}.pdf`. Trava na aprovação individual (`aprovarLinhaFolha`), não no envio da competência. UI do `/perfil` é um card único focado no mês vigente + modal de histórico; UI do RH anexa pelo cadastro do colaborador; UI do financeiro integra bloco "NF" no drawer de aprovação.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Supabase Postgres + RLS + Storage, `node --test` + `tsx` (framework existente), Tailwind + shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-10-07-folha-anexo-nf.md](../specs/2026-10-07-folha-anexo-nf.md)

## Global Constraints

- **Linguagem UI:** PT-BR com acentuação completa em qualquer string renderizada ou de erro visível (CLAUDE.md "Ortografia em português").
- **Trava só pra linhas que exigem NF:** `origem = 'california'` E `tipo_contratacao in ('pj','mei','clt_recibo')`. Outras linhas (CLT/estagio/socio, parte CLT do híbrido) **não** exigem NF.
- **Banco pelo fluxo do MCP:** migration via `apply_migration`, conferência pelo MCP, commit junto do código que depende (`docs/FLUXO-BANCO.md`).
- **GRANT para `authenticated`:** sempre explícito; `anon` fica sem acesso. RLS obrigatória em tabela nova com `(select auth.uid())` (não `auth.uid()`).
- **`lib/types.ts` à mão:** atualizar no MESMO commit da migration (CLAUDE.md).
- **Audit log:** todo evento sensível via `logAuditEvent({ acao, tenantId, entidadeTipo, entidadeId, metadata })`.
- **Nunca anexa NF solta:** server action valida que `(ano, mes)` é razoável (`ano >= 2024`, `(ano, mes) <= atual + 2 meses`) mas NÃO exige folha existir — colab pode anexar antes do RH gerar (D1 do spec).
- **Reenvio sobrescreve:** sem histórico de versões no MVP; remove arquivo antigo do Storage antes de subir o novo.
- **Formato:** PDF obrigatório, máx 10 MB.

## Review Focus

1. **Upload por não-dono:** colaborador A tenta anexar NF do colaborador B. Server action precisa bloquear antes de qualquer I/O (Task 6 tem o teste; RLS do bucket é defesa segunda).
2. **Timezone no dia 25:** upload às 23:30 BRT do dia 25 vira dia 26 UTC — a decisão de janela usa America/Sao_Paulo, não UTC (Task 4).
3. **Reenvio deixa lixo no Storage:** se o UPSERT grava a nova linha mas falha ao remover o arquivo antigo, fica órfão. Task 6 remove antes de subir, numa ordem segura.
4. **Trava dispara em tipo errado:** aprovar linha CLT puro sem NF segue; híbrido origem contabilidade sem NF segue; só linhas `origem=california` + `pj/mei/clt_recibo` travam (Task 9).
5. **Signed URL vaza:** URL de download tem validade curta (10 min) e requer permissão de leitura. Task 8 testa autorização via `rh.nf.ver` ou dono.

---

## File Structure

**Create:**
- `supabase/migrations/20261008000001_colaboradores_nf_anexos.sql`
- `supabase/migrations/20261008000002_colaboradores_nf_bucket.sql`
- `lib/folha/janela-pagamento.ts` — helper puro
- `lib/folha/janela-pagamento.test.ts`
- `lib/folha/countdown-nf.ts` — helper puro
- `lib/folha/countdown-nf.test.ts`
- `lib/nf/anexos-actions.ts` — server actions (anexar / remover / baixar)
- `app/(app)/perfil/_components/card-nf-mes.tsx` — card principal do /perfil
- `app/(app)/perfil/_components/historico-nf-modal.tsx` — modal de histórico
- `app/(app)/rh/colaboradores/[id]/_components/card-nf-colaborador.tsx` — card no cadastro RH
- `app/(app)/financeiro/contas-a-pagar/_components/bloco-nf-drawer.tsx` — bloco NF no drawer financeiro

**Modify:**
- `lib/types.ts` — adicionar `ColaboradorNfAnexo`, `JanelaPagamento`, `NfJanela`
- `lib/auth/audit.ts` — 3 novos `AuditAction`
- `lib/permissoes.ts` — 2 permissões (`rh.nf.anexar_qualquer`, `rh.nf.ver`)
- `app/(app)/perfil/page.tsx` — trocar `<CardNotaFiscal />` por `<CardNfMes colaboradorId={} ano={} mes={} />`
- `app/(app)/perfil/card-nota-fiscal.tsx` — deletar (vira obsoleto)
- `app/(app)/rh/colaboradores/[id]/page.tsx` — adicionar `<CardNfColaborador />`
- `app/(app)/financeiro/contas-a-pagar/actions-folhas.ts` — trava NF antes do bloco de plano de contas em `aprovarLinhaFolha`
- `app/(app)/financeiro/contas-a-pagar/revisar-folha-drawer.tsx` — bloco NF visível
- `app/(app)/rh/folhas/[competencia]/page.tsx` — carregar NFs anexadas da competência, passar pra view
- `app/(app)/rh/folhas/[competencia]/folha-competencia-view.tsx` — campo `tem_nf: boolean` em `FolhaLinha` + `<SeloNfAnexada />` ao lado dos selos existentes

---

## Task 1: Migration — tabela `colaboradores_nf_anexos`

**Files:**
- Create: `supabase/migrations/20261008000001_colaboradores_nf_anexos.sql`

**Interfaces:**
- Produces: tabela `colaboradores_nf_anexos` com unique `(tenant_id, colaborador_id, competencia_ano, competencia_mes)`. Consumida pelas Tasks 6–13.

- [ ] **Step 1: Escrever a migration**

Arquivo `supabase/migrations/20261008000001_colaboradores_nf_anexos.sql`:

```sql
-- Anexo de NF por (colaborador, competência). Desacoplado de folhas_pagamento
-- de propósito: colaborador pode anexar antes do RH gerar a folha PJ, e a NF
-- persiste se a folha for regenerada.
-- Spec: docs/superpowers/specs/2026-10-07-folha-anexo-nf.md (D1)

CREATE TABLE public.colaboradores_nf_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  colaborador_id uuid NOT NULL REFERENCES public.colaboradores(id) ON DELETE CASCADE,
  competencia_ano int NOT NULL,
  competencia_mes int NOT NULL CHECK (competencia_mes BETWEEN 1 AND 12),
  arquivo_path text NOT NULL,
  arquivo_nome text NOT NULL,
  arquivo_tamanho_bytes int NOT NULL,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX colaboradores_nf_anexos_competencia_idx
  ON public.colaboradores_nf_anexos (tenant_id, colaborador_id, competencia_ano, competencia_mes);

CREATE INDEX colaboradores_nf_anexos_colab_idx
  ON public.colaboradores_nf_anexos (colaborador_id);

ALTER TABLE public.colaboradores_nf_anexos ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro do tenant (RH, financeiro, próprio colab). Diferenciação
-- dono vs não-dono fica na server action (permissoes.ts).
CREATE POLICY nf_anexos_select ON public.colaboradores_nf_anexos
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY nf_anexos_insert ON public.colaboradores_nf_anexos
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY nf_anexos_update ON public.colaboradores_nf_anexos
  FOR UPDATE TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY nf_anexos_delete ON public.colaboradores_nf_anexos
  FOR DELETE TO authenticated
  USING (public.is_tenant_member(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.colaboradores_nf_anexos TO authenticated;
```

- [ ] **Step 2: Aplicar via MCP**

Usar `mcp__supabase-write__apply_migration` com `name='20261008000001_colaboradores_nf_anexos'` e o SQL do Step 1.

- [ ] **Step 3: Verificar estrutura e policies**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='colaboradores_nf_anexos'
ORDER BY ordinal_position;

SELECT polname, polcmd FROM pg_policy
WHERE polrelid='public.colaboradores_nf_anexos'::regclass;

SELECT grantee, privilege_type FROM information_schema.table_privileges
WHERE table_schema='public' AND table_name='colaboradores_nf_anexos' AND grantee IN ('authenticated', 'anon');
```

Esperado: 11 colunas; 4 policies (select, insert, update, delete); grants completos para `authenticated`, nada para `anon`.

- [ ] **Step 4: Commit**

```powershell
git add supabase/migrations/20261008000001_colaboradores_nf_anexos.sql
git commit -m "feat(nf): tabela colaboradores_nf_anexos com RLS por tenant"
```

---

## Task 2: Migration — bucket Storage `colaboradores-nf`

**Files:**
- Create: `supabase/migrations/20261008000002_colaboradores_nf_bucket.sql`

**Interfaces:**
- Produces: bucket `colaboradores-nf` com RLS para `authenticated` do tenant. Path: `{tenant_id}/{colaborador_id}/{ano}-{mes}.pdf`.

- [ ] **Step 1: Escrever a migration**

Arquivo `supabase/migrations/20261008000002_colaboradores_nf_bucket.sql`:

```sql
-- Bucket privado para NFs de colaboradores PJ.
-- Path: {tenant_id}/{colaborador_id}/{ano}-{mes}.pdf
-- Padrão idêntico ao bucket 'pedidos-compra' (split_part no primeiro nível
-- da path dá o tenant_id para a policy).
-- Spec: docs/superpowers/specs/2026-10-07-folha-anexo-nf.md (D5 + "Storage")

INSERT INTO storage.buckets (id, name, public)
VALUES ('colaboradores-nf', 'colaboradores-nf', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY nf_bucket_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'colaboradores-nf'
    AND public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

CREATE POLICY nf_bucket_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'colaboradores-nf'
    AND public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

CREATE POLICY nf_bucket_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'colaboradores-nf'
    AND public.is_tenant_member((split_part(name, '/', 1))::uuid)
  )
  WITH CHECK (
    bucket_id = 'colaboradores-nf'
    AND public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

CREATE POLICY nf_bucket_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'colaboradores-nf'
    AND public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );
```

- [ ] **Step 2: Aplicar via MCP**

Usar `mcp__supabase-write__apply_migration` com `name='20261008000002_colaboradores_nf_bucket'`.

- [ ] **Step 3: Verificar bucket + policies**

```sql
SELECT id, name, public FROM storage.buckets WHERE id = 'colaboradores-nf';

SELECT polname, polcmd FROM pg_policy
WHERE polrelid='storage.objects'::regclass
  AND polname LIKE 'nf_bucket_%';
```

Esperado: 1 bucket privado, 4 policies.

- [ ] **Step 4: Commit**

```powershell
git add supabase/migrations/20261008000002_colaboradores_nf_bucket.sql
git commit -m "feat(nf): bucket Storage colaboradores-nf com RLS por tenant"
```

---

## Task 3: Tipos + audit + permissões

**Files:**
- Modify: `lib/types.ts` (adicionar `ColaboradorNfAnexo`, `JanelaPagamento`, `NfJanela`)
- Modify: `lib/auth/audit.ts` (3 novos `AuditAction`)
- Modify: `lib/permissoes.ts` (2 novas chaves)

**Interfaces:**
- Produces:
  - `ColaboradorNfAnexo` interface (consumida por Tasks 5, 6, 7, 10–13)
  - `JanelaPagamento = "salarios" | "fornecedores"` (consumida por Tasks 4, 10, 12)
  - `NfJanela = { janela: JanelaPagamento; data_prevista: string }`
  - Audit actions `colaborador.nf_anexada`, `colaborador.nf_removida`, `colaborador.nf_baixada`
  - Permissões `rh.nf.anexar_qualquer`, `rh.nf.ver`

- [ ] **Step 1: Adicionar tipos em `lib/types.ts`**

Localizar o bloco de interfaces de colaborador (próximo de `ColaboradorSalario`). Adicionar:

```typescript
/** Metadado do anexo de NF por (colaborador, competência).
 *  Arquivo em Storage no bucket 'colaboradores-nf', path
 *  {tenant_id}/{colaborador_id}/{ano}-{mes}.pdf. Reenvio sobrescreve. */
export interface ColaboradorNfAnexo {
  id: string;
  tenant_id: string;
  colaborador_id: string;
  competencia_ano: number;
  competencia_mes: number;
  arquivo_path: string;
  arquivo_nome: string;
  arquivo_tamanho_bytes: number;
  uploaded_by: string;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
}

/** Janela de pagamento: salários (dia 03 do mês seguinte) ou
 *  fornecedores (dia 08). Derivada de uploaded_at vs dia 25 do mês
 *  da competência em America/Sao_Paulo. */
export type JanelaPagamento = "salarios" | "fornecedores";

export interface NfJanela {
  janela: JanelaPagamento;
  /** ISO yyyy-mm-dd (dia 03 ou dia 08 do mês seguinte à competência). */
  data_prevista: string;
}
```

- [ ] **Step 2: Adicionar `AuditAction` em `lib/auth/audit.ts`**

Após o bloco de folha (linhas 318–332, após `folha_competencia.enviada`), adicionar:

```typescript
  // NF por colaborador PJ (2026-10-07)
  | "colaborador.nf_anexada"
  | "colaborador.nf_removida"
  | "colaborador.nf_baixada"
```

- [ ] **Step 3: Adicionar permissões em `lib/permissoes.ts`**

No objeto `permissoes` (próximo de outras entradas `rh.*`), adicionar:

```typescript
  // NF por colaborador PJ (2026-10-07)
  "rh.nf.anexar_qualquer":   ["administrador", "rh"],
  "rh.nf.ver":               ["administrador", "rh", "financeiro"],
```

**Nota**: a permissão "anexar a própria NF" **não** fica aqui — é dono-do-recurso, não role. Validação é feita no server action via helper `podeMexerNaNf(session, colaboradorId)` (ver Task 6).

- [ ] **Step 4: `npm run typecheck`**

Esperado: exit 0.

- [ ] **Step 5: Commit**

```powershell
git add lib/types.ts lib/auth/audit.ts lib/permissoes.ts
git commit -m "feat(nf): tipos ColaboradorNfAnexo + audit actions + permissoes rh.nf.*"
```

---

## Task 4: Helper puro `janelaDaNf` + testes

**Files:**
- Create: `lib/folha/janela-pagamento.ts`
- Create: `lib/folha/janela-pagamento.test.ts`
- Modify: `package.json` (adicionar script `test:nf-janela`)

**Interfaces:**
- Consumes: `JanelaPagamento`, `NfJanela` (Task 3).
- Produces:
  ```typescript
  export function janelaDaNf(input: {
    uploadedAt: string;           // ISO UTC
    competenciaAno: number;
    competenciaMes: number;
  }): NfJanela;
  ```

- [ ] **Step 1: Escrever o teste primeiro**

Arquivo `lib/folha/janela-pagamento.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { janelaDaNf } from "./janela-pagamento";

// Comentário importante: o prazo é dia 25 do mês da competência às 23:59:59.999
// no fuso America/Sao_Paulo (UTC-3). Em UTC isso é dia 26 às 02:59:59.999.

test("upload no dia 10 da competência -> janela salários (dia 03 seguinte)", () => {
  const r = janelaDaNf({
    uploadedAt: "2026-10-10T13:00:00.000Z",
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.equal(r.janela, "salarios");
  assert.equal(r.data_prevista, "2026-11-03");
});

test("upload exatamente no dia 25 às 23:59 BRT -> ainda salários", () => {
  // 25/10 23:59:00 BRT == 26/10 02:59:00 UTC
  const r = janelaDaNf({
    uploadedAt: "2026-10-26T02:59:00.000Z",
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.equal(r.janela, "salarios");
  assert.equal(r.data_prevista, "2026-11-03");
});

test("upload no dia 26 00:00 BRT -> fornecedores (dia 08 seguinte)", () => {
  // 26/10 00:00:00 BRT == 26/10 03:00:00 UTC
  const r = janelaDaNf({
    uploadedAt: "2026-10-26T03:00:00.000Z",
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.equal(r.janela, "fornecedores");
  assert.equal(r.data_prevista, "2026-11-08");
});

test("upload atrasado em um ano -> janela fornecedores do mês seguinte à competência", () => {
  const r = janelaDaNf({
    uploadedAt: "2026-10-15T13:00:00.000Z",
    competenciaAno: 2025,
    competenciaMes: 10,
  });
  assert.equal(r.janela, "fornecedores");
  assert.equal(r.data_prevista, "2025-11-08");
});

test("competência de dezembro: salários -> 03/01 do ano seguinte", () => {
  const r = janelaDaNf({
    uploadedAt: "2026-12-10T13:00:00.000Z",
    competenciaAno: 2026,
    competenciaMes: 12,
  });
  assert.equal(r.janela, "salarios");
  assert.equal(r.data_prevista, "2027-01-03");
});

test("competência de dezembro, fora do prazo -> fornecedores 08/01", () => {
  const r = janelaDaNf({
    uploadedAt: "2026-12-28T13:00:00.000Z",
    competenciaAno: 2026,
    competenciaMes: 12,
  });
  assert.equal(r.janela, "fornecedores");
  assert.equal(r.data_prevista, "2027-01-08");
});
```

- [ ] **Step 2: Adicionar script no `package.json`**

Após `"test:folha-parser"`:

```json
"test:nf-janela": "node --import tsx --test lib/folha/janela-pagamento.test.ts",
```

- [ ] **Step 3: Rodar teste e verificar FAIL**

```powershell
npm run test:nf-janela
```

Esperado: falha com "module not found".

- [ ] **Step 4: Implementar `janelaDaNf`**

Arquivo `lib/folha/janela-pagamento.ts`:

```typescript
import type { NfJanela } from "@/lib/types";

/**
 * Decide a janela de pagamento de uma NF pela data de upload.
 *
 * Regra: upload com uploadedAt <= dia 25 do mês da competência às 23:59:59.999
 * em America/Sao_Paulo (UTC-3) → janela de salários (dia 03 do mês seguinte).
 * Depois disso → janela de fornecedores (dia 08 do mês seguinte).
 *
 * Spec: docs/superpowers/specs/2026-10-07-folha-anexo-nf.md (D4)
 */
export function janelaDaNf(input: {
  uploadedAt: string;
  competenciaAno: number;
  competenciaMes: number;
}): NfJanela {
  const upload = new Date(input.uploadedAt);
  // Deadline: 25/MM/AAAA 23:59:59.999 BRT == 26/MM/AAAA 02:59:59.999 UTC
  const deadline = new Date(
    Date.UTC(input.competenciaAno, input.competenciaMes - 1, 26, 2, 59, 59, 999),
  );

  const noPrazo = upload.getTime() <= deadline.getTime();

  const proximoMes = input.competenciaMes === 12 ? 1 : input.competenciaMes + 1;
  const anoDoPagamento =
    input.competenciaMes === 12 ? input.competenciaAno + 1 : input.competenciaAno;
  const dia = noPrazo ? 3 : 8;

  const data_prevista = `${anoDoPagamento}-${String(proximoMes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

  return {
    janela: noPrazo ? "salarios" : "fornecedores",
    data_prevista,
  };
}
```

- [ ] **Step 5: Rodar teste e verificar PASS**

```powershell
npm run test:nf-janela
```

Esperado: 6/6 pass.

- [ ] **Step 6: Commit**

```powershell
git add lib/folha/janela-pagamento.ts lib/folha/janela-pagamento.test.ts package.json
git commit -m "feat(nf): helper puro janelaDaNf + 6 testes (timezone BRT, borda do dia 25)"
```

---

## Task 5: Helper puro `diasAtePrazoNf` + testes

**Files:**
- Create: `lib/folha/countdown-nf.ts`
- Create: `lib/folha/countdown-nf.test.ts`
- Modify: `package.json` (script `test:nf-countdown`)

**Interfaces:**
- Produces:
  ```typescript
  export interface CountdownNf {
    diasRestantes: number;   // negativo se vencido
    vencido: boolean;
    mensagem: string;
  }
  export function diasAtePrazoNf(input: {
    hoje: Date;              // qualquer timezone — vai ser convertido pra BRT
    competenciaAno: number;
    competenciaMes: number;
  }): CountdownNf;
  ```

- [ ] **Step 1: Escrever o teste primeiro**

Arquivo `lib/folha/countdown-nf.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { diasAtePrazoNf } from "./countdown-nf";

test("hoje é dia 7, competência outubro -> faltam 18 dias", () => {
  const r = diasAtePrazoNf({
    hoje: new Date("2026-10-07T15:00:00.000Z"),
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.equal(r.diasRestantes, 18);
  assert.equal(r.vencido, false);
  assert.match(r.mensagem, /faltam 18 dias/i);
});

test("hoje é dia 25 -> último dia do prazo", () => {
  const r = diasAtePrazoNf({
    hoje: new Date("2026-10-25T15:00:00.000Z"),
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.equal(r.diasRestantes, 0);
  assert.equal(r.vencido, false);
  assert.match(r.mensagem, /último dia/i);
});

test("hoje é dia 26 -> prazo vencido (fornecedores)", () => {
  const r = diasAtePrazoNf({
    hoje: new Date("2026-10-26T15:00:00.000Z"),
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.ok(r.diasRestantes < 0);
  assert.equal(r.vencido, true);
  assert.match(r.mensagem, /prazo vencido/i);
  assert.match(r.mensagem, /fornecedores/i);
});

test("hoje é dia 24 -> faltam 1 dia (singular)", () => {
  const r = diasAtePrazoNf({
    hoje: new Date("2026-10-24T15:00:00.000Z"),
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.equal(r.diasRestantes, 1);
  assert.match(r.mensagem, /falta 1 dia/i);
});

test("competência futura (novembro, hoje é outubro) -> contagem continua", () => {
  const r = diasAtePrazoNf({
    hoje: new Date("2026-10-07T15:00:00.000Z"),
    competenciaAno: 2026,
    competenciaMes: 11,
  });
  assert.ok(r.diasRestantes > 18);
  assert.equal(r.vencido, false);
});
```

- [ ] **Step 2: Adicionar script no `package.json`**

```json
"test:nf-countdown": "node --import tsx --test lib/folha/countdown-nf.test.ts",
```

- [ ] **Step 3: Rodar teste e verificar FAIL**

```powershell
npm run test:nf-countdown
```

Esperado: falha com "module not found".

- [ ] **Step 4: Implementar `diasAtePrazoNf`**

Arquivo `lib/folha/countdown-nf.ts`:

```typescript
export interface CountdownNf {
  /** Dias calendáricos até o dia 25 do mês da competência. Negativo se vencido. */
  diasRestantes: number;
  vencido: boolean;
  mensagem: string;
}

/**
 * Conta dias até o prazo de envio da NF (dia 25 do mês da competência,
 * em America/Sao_Paulo). Spec: docs/superpowers/specs/2026-10-07-folha-anexo-nf.md
 */
export function diasAtePrazoNf(input: {
  hoje: Date;
  competenciaAno: number;
  competenciaMes: number;
}): CountdownNf {
  // Normaliza "hoje" para meia-noite BRT (ignora horário) para contagem calendárica.
  const hoje = input.hoje;
  const hojeBrtMidnight = Date.UTC(
    hoje.getUTCFullYear(),
    hoje.getUTCMonth(),
    hoje.getUTCDate(),
  );
  // Dia 25 00:00 BRT == 25 03:00 UTC do mesmo dia
  const prazo = Date.UTC(input.competenciaAno, input.competenciaMes - 1, 25);
  const diffMs = prazo - hojeBrtMidnight;
  const diasRestantes = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const vencido = diasRestantes < 0;

  const mmSeguinte = String(
    input.competenciaMes === 12 ? 1 : input.competenciaMes + 1,
  ).padStart(2, "0");

  let mensagem: string;
  if (vencido) {
    mensagem = `Prazo vencido — pagamento vai pra janela de fornecedores (08/${mmSeguinte}).`;
  } else if (diasRestantes === 0) {
    mensagem = `Último dia pra entrar na janela de salários (03/${mmSeguinte}).`;
  } else if (diasRestantes === 1) {
    mensagem = "Falta 1 dia para o prazo.";
  } else {
    mensagem = `Faltam ${diasRestantes} dias para o prazo (até 25/${String(
      input.competenciaMes,
    ).padStart(2, "0")}).`;
  }

  return { diasRestantes, vencido, mensagem };
}
```

- [ ] **Step 5: Rodar teste e verificar PASS**

```powershell
npm run test:nf-countdown
```

Esperado: 5/5 pass.

- [ ] **Step 6: Commit**

```powershell
git add lib/folha/countdown-nf.ts lib/folha/countdown-nf.test.ts package.json
git commit -m "feat(nf): helper puro diasAtePrazoNf + 5 testes de borda"
```

---

## Task 6: Server actions `anexarNfColaborador`, `removerNfColaborador`

**Files:**
- Create: `lib/nf/anexos-actions.ts`

**Interfaces:**
- Consumes: `janelaDaNf` (Task 4), `ColaboradorNfAnexo` + audit (Task 3).
- Produces:
  ```typescript
  export async function anexarNfColaborador(input: {
    colaboradorId: string;
    ano: number;
    mes: number;
    arquivoBuffer: ArrayBuffer;
    arquivoNome: string;
    arquivoTamanhoBytes: number;
  }): Promise<ActionResult<{ anexo_id: string; janela: JanelaPagamento }>>;

  export async function removerNfColaborador(
    anexoId: string,
  ): Promise<ActionResult<Record<string, never>>>;
  ```

- [ ] **Step 1: Esqueleto + helper `podeMexerNaNf`**

Arquivo `lib/nf/anexos-actions.ts`:

```typescript
"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { pode } from "@/lib/permissoes";
import { createClient } from "@/lib/supabase/server";
import { janelaDaNf } from "@/lib/folha/janela-pagamento";
import type { JanelaPagamento } from "@/lib/types";

type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

const BUCKET = "colaboradores-nf";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Dono do recurso OU papel com alçada (rh.nf.anexar_qualquer).
 * Faz 1 query extra para resolver o user_id vinculado ao colaborador.
 */
async function podeMexerNaNf(
  session: Awaited<ReturnType<typeof requireSession>>,
  colaboradorId: string,
): Promise<boolean> {
  if (pode(session.activeRole, "rh.nf.anexar_qualquer")) return true;

  const supabase = createClient();
  const { data } = await supabase
    .from("colaboradores")
    .select("user_id")
    .eq("id", colaboradorId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  return !!data?.user_id && data.user_id === session.profile.id;
}

function pathNoBucket(
  tenantId: string,
  colaboradorId: string,
  ano: number,
  mes: number,
): string {
  return `${tenantId}/${colaboradorId}/${ano}-${String(mes).padStart(2, "0")}.pdf`;
}
```

- [ ] **Step 2: Implementar `anexarNfColaborador`**

Adicionar no final do arquivo:

```typescript
/**
 * Anexa (ou substitui) a NF de um colaborador para uma competência.
 * Idempotência por (colab, ano, mes): reenvio sobrescreve o arquivo
 * no Storage e o row no banco (UPSERT).
 */
export async function anexarNfColaborador(input: {
  colaboradorId: string;
  ano: number;
  mes: number;
  arquivoBuffer: ArrayBuffer;
  arquivoNome: string;
  arquivoTamanhoBytes: number;
}): Promise<ActionResult<{ anexo_id: string; janela: JanelaPagamento }>> {
  const session = await requireSession();

  if (!(await podeMexerNaNf(session, input.colaboradorId))) {
    return {
      ok: false,
      message: "Sem permissão para anexar NF desse colaborador.",
    };
  }

  // Sanidade da competência: evita NF pra competência maluca.
  const anoAtual = new Date().getFullYear();
  if (input.ano < 2024 || input.ano > anoAtual + 1) {
    return { ok: false, message: "Ano da competência fora da faixa aceita." };
  }
  if (input.mes < 1 || input.mes > 12) {
    return { ok: false, message: "Mês da competência inválido." };
  }

  // Validação de arquivo.
  if (!input.arquivoNome.toLowerCase().endsWith(".pdf")) {
    return { ok: false, message: "Só aceita arquivo PDF." };
  }
  if (input.arquivoTamanhoBytes <= 0 || input.arquivoTamanhoBytes > MAX_BYTES) {
    return {
      ok: false,
      message: `Arquivo precisa ter entre 1 byte e ${MAX_BYTES / 1024 / 1024} MB.`,
    };
  }

  // Confirma colaborador do tenant e tipo compatível.
  const supabase = createClient();
  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, tipo_contratacao, tenant_id")
    .eq("id", input.colaboradorId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!colab) {
    return { ok: false, message: "Colaborador não encontrado." };
  }
  if (!["pj", "mei", "clt_recibo"].includes(colab.tipo_contratacao)) {
    return {
      ok: false,
      message: `Colaborador do tipo ${colab.tipo_contratacao} não exige NF.`,
    };
  }

  const buffer = Buffer.from(input.arquivoBuffer);
  const arquivoHash = createHash("sha256").update(buffer).digest("hex");
  const path = pathNoBucket(
    session.activeTenant.id,
    input.colaboradorId,
    input.ano,
    input.mes,
  );

  // Se já existe anexo pra essa competência: remove arquivo antigo antes de subir
  // o novo (evita lixo no Storage se o path mudar; no caso atual o path é
  // determinístico pelo (ano,mes), então upload com upsert sobrescreve, mas
  // mantemos a remoção explícita como defesa contra mudança futura de esquema).
  const { data: existente } = await supabase
    .from("colaboradores_nf_anexos")
    .select("id, arquivo_path")
    .eq("tenant_id", session.activeTenant.id)
    .eq("colaborador_id", input.colaboradorId)
    .eq("competencia_ano", input.ano)
    .eq("competencia_mes", input.mes)
    .maybeSingle();
  if (existente && existente.arquivo_path !== path) {
    await supabase.storage.from(BUCKET).remove([existente.arquivo_path]);
  }

  // Upload (upsert sobrescreve se existe no mesmo path).
  const upload = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: "application/pdf", upsert: true });
  if (upload.error) {
    return {
      ok: false,
      message: `Falha ao subir arquivo: ${upload.error.message}`,
    };
  }

  const nowIso = new Date().toISOString();

  const { data: anexo, error: upsertError } = await supabase
    .from("colaboradores_nf_anexos")
    .upsert(
      {
        tenant_id: session.activeTenant.id,
        colaborador_id: input.colaboradorId,
        competencia_ano: input.ano,
        competencia_mes: input.mes,
        arquivo_path: path,
        arquivo_nome: input.arquivoNome,
        arquivo_tamanho_bytes: input.arquivoTamanhoBytes,
        uploaded_by: session.profile.id,
        uploaded_at: nowIso,
        updated_at: nowIso,
      },
      {
        onConflict: "tenant_id,colaborador_id,competencia_ano,competencia_mes",
      },
    )
    .select("id")
    .single();

  if (upsertError || !anexo) {
    // Rollback do upload pra não deixar arquivo órfão.
    await supabase.storage.from(BUCKET).remove([path]);
    return {
      ok: false,
      message: `Falha ao gravar metadado: ${upsertError?.message ?? "sem detalhe"}.`,
    };
  }

  const janela = janelaDaNf({
    uploadedAt: nowIso,
    competenciaAno: input.ano,
    competenciaMes: input.mes,
  });

  await logAuditEvent({
    acao: "colaborador.nf_anexada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: input.colaboradorId,
    metadata: {
      competencia_ano: input.ano,
      competencia_mes: input.mes,
      arquivo_hash: arquivoHash,
      arquivo_nome: input.arquivoNome,
      substituiu_anexo_anterior: !!existente,
      janela: janela.janela,
      data_prevista: janela.data_prevista,
    },
  });

  revalidatePath("/perfil");
  revalidatePath(`/rh/colaboradores/${input.colaboradorId}`);
  revalidatePath(
    `/rh/folhas/${input.ano}-${String(input.mes).padStart(2, "0")}`,
  );
  revalidatePath("/financeiro/contas-a-pagar");

  return { ok: true, anexo_id: anexo.id, janela: janela.janela };
}
```

- [ ] **Step 3: Implementar `removerNfColaborador`**

```typescript
export async function removerNfColaborador(
  anexoId: string,
): Promise<ActionResult<Record<string, never>>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo } = await supabase
    .from("colaboradores_nf_anexos")
    .select("id, colaborador_id, arquivo_path, competencia_ano, competencia_mes")
    .eq("id", anexoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!anexo) {
    return { ok: false, message: "Anexo não encontrado." };
  }

  if (!(await podeMexerNaNf(session, anexo.colaborador_id))) {
    return { ok: false, message: "Sem permissão para remover NF." };
  }

  await supabase.storage.from(BUCKET).remove([anexo.arquivo_path]);
  const { error: delError } = await supabase
    .from("colaboradores_nf_anexos")
    .delete()
    .eq("id", anexoId);
  if (delError) {
    return { ok: false, message: delError.message };
  }

  await logAuditEvent({
    acao: "colaborador.nf_removida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: anexo.colaborador_id,
    metadata: {
      competencia_ano: anexo.competencia_ano,
      competencia_mes: anexo.competencia_mes,
    },
  });

  revalidatePath("/perfil");
  revalidatePath(`/rh/colaboradores/${anexo.colaborador_id}`);
  revalidatePath(
    `/rh/folhas/${anexo.competencia_ano}-${String(anexo.competencia_mes).padStart(2, "0")}`,
  );
  revalidatePath("/financeiro/contas-a-pagar");

  return { ok: true } as { ok: true } & Record<string, never>;
}
```

- [ ] **Step 4: `npm run typecheck`**

- [ ] **Step 5: Smoke test manual (cobre Review Focus #1 e #3)**

```powershell
npm run dev
```

**Cenário A — dono anexa** (feliz):
- Logar como colaborador PJ. Chamar `anexarNfColaborador` com PDF de teste.
- Esperado: `{ ok: true, anexo_id, janela }`.
- Verificar via SQL que linha foi criada; via Storage dashboard que arquivo está em `colaboradores-nf/{tenant}/{colab}/{ano}-{mes}.pdf`.

**Cenário B — Review Focus #1: não-dono bloqueado**:
- Logar como colaborador PJ **diferente**. Tentar `anexarNfColaborador({ colaboradorId: id_de_outro, ... })`.
- Esperado: `{ ok: false, message: "Sem permissão para anexar NF desse colaborador." }`.
- Confirmar que **nenhum upload** foi feito (Storage dashboard não ganha arquivo novo).

**Cenário C — Review Focus #3: reenvio não deixa lixo**:
- Mesmo colaborador do cenário A reenvia (segundo upload do mesmo mês).
- Esperado: `{ ok: true }` (unique constraint não falha pelo UPSERT).
- Via SQL: `SELECT count(*) FROM colaboradores_nf_anexos WHERE colaborador_id=? AND competencia_ano=? AND competencia_mes=?` → `1` (não `2`).
- Via Storage dashboard: só 1 arquivo no path esperado, nenhum arquivo órfão com nome diferente.

**Cenário D — Admin/RH anexa pra outro colaborador**:
- Logar como RH. Chamar `anexarNfColaborador({ colaboradorId: id_de_um_pj, ... })`.
- Esperado: `{ ok: true }` (alçada `rh.nf.anexar_qualquer`).

- [ ] **Step 6: Commit**

```powershell
git add lib/nf/anexos-actions.ts
git commit -m "feat(nf): server actions anexar/remover NF com validacao de dono + Storage"
```

---

## Task 7: Server action `baixarNfColaborador` (Signed URL)

**Files:**
- Modify: `lib/nf/anexos-actions.ts` (adicionar `baixarNfColaborador`)

**Interfaces:**
- Produces:
  ```typescript
  export async function baixarNfColaborador(
    anexoId: string,
  ): Promise<ActionResult<{ url: string; arquivo_nome: string }>>;
  ```

- [ ] **Step 1: Implementar**

Adicionar no final de `lib/nf/anexos-actions.ts`:

```typescript
/**
 * Devolve uma Signed URL com validade de 10 minutos pra baixar a NF.
 * Permissão: dono OU rh.nf.ver (RH, admin, financeiro).
 */
export async function baixarNfColaborador(
  anexoId: string,
): Promise<ActionResult<{ url: string; arquivo_nome: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo } = await supabase
    .from("colaboradores_nf_anexos")
    .select(
      "id, colaborador_id, arquivo_path, arquivo_nome, competencia_ano, competencia_mes",
    )
    .eq("id", anexoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!anexo) {
    return { ok: false, message: "Anexo não encontrado." };
  }

  const temAlcada = pode(session.activeRole, "rh.nf.ver");
  const ehDono = !temAlcada && (await podeMexerNaNf(session, anexo.colaborador_id));
  if (!temAlcada && !ehDono) {
    return { ok: false, message: "Sem permissão para baixar NF." };
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(anexo.arquivo_path, 60 * 10);
  if (error || !data) {
    return { ok: false, message: `Falha ao gerar link: ${error?.message}` };
  }

  // Só audita quando quem baixa não é o dono (visualização por RH/financeiro).
  if (temAlcada) {
    await logAuditEvent({
      acao: "colaborador.nf_baixada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "colaborador",
      entidadeId: anexo.colaborador_id,
      metadata: {
        competencia_ano: anexo.competencia_ano,
        competencia_mes: anexo.competencia_mes,
      },
    });
  }

  return { ok: true, url: data.signedUrl, arquivo_nome: anexo.arquivo_nome };
}
```

- [ ] **Step 2: `npm run typecheck`**

- [ ] **Step 3: Smoke test manual (cobre Review Focus #5)**

**Cenário A — URL funciona pro dono**:
- Dono chama `baixarNfColaborador(anexoId)` da sua própria NF. Abrir URL retornada em nova aba → PDF baixa.

**Cenário B — URL funciona pra financeiro** (`rh.nf.ver`):
- Logar como financeiro. Chamar `baixarNfColaborador(anexoId)` de NF de outro. URL funciona.
- Verificar via SQL que audit `colaborador.nf_baixada` foi registrado (quando não-dono baixa).

**Cenário C — Não-dono sem alçada é bloqueado**:
- Logar como outro colaborador PJ (não tem `rh.nf.ver` nem é dono do anexo).
- Chamar `baixarNfColaborador(anexoId)` de NF alheia → `{ ok: false, message: "Sem permissão..." }`.
- Confirmar que nenhuma URL foi gerada.

**Cenário D — URL expira em 10 min**:
- Gerar URL. Esperar 11 min. Tentar abrir → 400/403 (URL expirada pelo Supabase).

- [ ] **Step 4: Commit**

```powershell
git add lib/nf/anexos-actions.ts
git commit -m "feat(nf): baixarNfColaborador com Signed URL (10min) + audit em download por nao-dono"
```

---

## Task 8: Trava em `aprovarLinhaFolha`

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-folhas.ts`

**Interfaces:**
- Consumes: tabela `colaboradores_nf_anexos` (Task 1), SELECT com `origem` já presente no fetch de `folha`.
- Produces: `aprovarLinhaFolha` rejeita com mensagem clara quando falta NF em linha PJ/MEI/Recibo origem california.

- [ ] **Step 1: Localizar o bloco certo**

Em `actions-folhas.ts`, achar o bloco `// 6) Plano de contas` (perto da linha 510). A trava entra **imediatamente antes** dele.

- [ ] **Step 2: Adicionar a trava**

Antes de `// 6) Plano de contas`:

```typescript
  // 5.5) Trava de NF para linhas PJ geradas pela California.
  // Spec: docs/superpowers/specs/2026-10-07-folha-anexo-nf.md (D3)
  const exigeNf =
    folha.origem === "california" &&
    (colab.tipo_contratacao === "pj" ||
      colab.tipo_contratacao === "mei" ||
      colab.tipo_contratacao === "clt_recibo");
  if (exigeNf) {
    const { data: nf } = await supabase
      .from("colaboradores_nf_anexos")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("colaborador_id", folha.colaborador_id)
      .eq("competencia_ano", folha.competencia_ano)
      .eq("competencia_mes", folha.competencia_mes)
      .maybeSingle();
    if (!nf) {
      return {
        ok: false,
        message:
          "Essa linha não pode ser aprovada sem NF anexada. Peça pro colaborador anexar em /perfil, ou use o cadastro dele em /rh/colaboradores.",
      };
    }
  }
```

- [ ] **Step 3: `npm run typecheck`**

- [ ] **Step 4: Smoke test manual (cobre Review Focus #4)**

1. Gere uma folha PJ de outubro com: 1 PJ puro, 1 MEI, 1 CLT puro, 1 estagiário, 1 sócio, e 1 híbrido (clt_recibo).
2. Importe o PDF da contabilidade pra criar as linhas CLT (do CLT puro, do híbrido parte CLT, do estagiário e do sócio).
3. Envie a competência ao financeiro.
4. Em `/financeiro/contas-a-pagar` aba Folhas, teste cada combinação:
   - **PJ sem NF** (origem california) → aprovar deve retornar erro claro.
   - **MEI sem NF** (origem california) → aprovar deve retornar erro.
   - **Híbrido parte Recibo sem NF** (origem california) → aprovar deve retornar erro.
   - **CLT puro sem NF** (origem contabilidade) → aprovar deve **seguir normalmente** (não exige NF).
   - **Híbrido parte CLT sem NF** (origem contabilidade) → aprovar deve **seguir** (não exige NF).
   - **Estagiário sem NF** (origem contabilidade) → aprovar deve **seguir**.
   - **Sócio sem NF** (origem contabilidade) → aprovar deve **seguir**.
5. Anexe NF pelo cadastro RH do PJ, tente aprovar de novo → deve seguir e criar `contas_avulsas`.

- [ ] **Step 5: Commit**

```powershell
git add app/\(app\)/financeiro/contas-a-pagar/actions-folhas.ts
git commit -m "feat(nf): trava em aprovarLinhaFolha para linhas PJ/MEI/Recibo sem NF"
```

---

## Task 9: UI `/perfil` — card `CardNfMes` + modal de histórico

**Files:**
- Create: `app/(app)/perfil/_components/card-nf-mes.tsx`
- Create: `app/(app)/perfil/_components/historico-nf-modal.tsx`
- Modify: `app/(app)/perfil/page.tsx` (trocar `<CardNotaFiscal>` por `<CardNfMes>`)
- Delete: `app/(app)/perfil/card-nota-fiscal.tsx` (placeholder antigo)

**Interfaces:**
- Consumes: `anexarNfColaborador`, `removerNfColaborador`, `baixarNfColaborador` (Tasks 6+7), `janelaDaNf`, `diasAtePrazoNf` (Tasks 4+5), `ColaboradorNfAnexo` (Task 3).
- Produces: componente client `<CardNfMes colaboradorId tipoContratacao />` (visível só pra pj/mei/clt_recibo).

- [ ] **Step 1: Criar `CardNfMes`**

Arquivo `app/(app)/perfil/_components/card-nf-mes.tsx`:

```typescript
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  History,
  Loader2,
  Upload,
} from "lucide-react";
import { anexarNfColaborador } from "@/lib/nf/anexos-actions";
import { diasAtePrazoNf } from "@/lib/folha/countdown-nf";
import { janelaDaNf } from "@/lib/folha/janela-pagamento";
import type { JanelaPagamento, TipoContratacao } from "@/lib/types";
import { HistoricoNfModal } from "./historico-nf-modal";

const NOMES_MES = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

export interface NfVigente {
  id: string;
  arquivo_nome: string;
  uploaded_at: string;
}

export interface BacklogPendente {
  ano: number;
  mes: number;
}

export function CardNfMes(props: {
  colaboradorId: string;
  tipoContratacao: TipoContratacao;
  /** NF do mês vigente, se já anexada. */
  nfVigente: NfVigente | null;
  /** Competências anteriores com folha PJ aberta sem NF. */
  backlog: BacklogPendente[];
  anoVigente: number;
  mesVigente: number;
}) {
  // Só renderiza para tipos que exigem NF.
  if (!["pj", "mei", "clt_recibo"].includes(props.tipoContratacao)) {
    return null;
  }

  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [histOpen, setHistOpen] = React.useState(false);

  const countdown = diasAtePrazoNf({
    hoje: new Date(),
    competenciaAno: props.anoVigente,
    competenciaMes: props.mesVigente,
  });

  const janela: JanelaPagamento | null = props.nfVigente
    ? janelaDaNf({
        uploadedAt: props.nfVigente.uploaded_at,
        competenciaAno: props.anoVigente,
        competenciaMes: props.mesVigente,
      }).janela
    : null;

  function handleSelecionarArquivo() {
    inputRef.current?.click();
  }

  function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErro(null);
    startTransition(async () => {
      const buf = await file.arrayBuffer();
      const r = await anexarNfColaborador({
        colaboradorId: props.colaboradorId,
        ano: props.anoVigente,
        mes: props.mesVigente,
        arquivoBuffer: buf,
        arquivoNome: file.name,
        arquivoTamanhoBytes: file.size,
      });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
    });
  }

  const nomeCompetencia = `${NOMES_MES[props.mesVigente - 1]}/${props.anoVigente}`;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft space-y-4">
      {props.backlog.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Você tem NF pendente de{" "}
            {props.backlog
              .map((b) => `${NOMES_MES[b.mes - 1].toLowerCase()}/${b.ano}`)
              .join(", ")}
            .{" "}
            <button
              type="button"
              onClick={() => setHistOpen(true)}
              className="underline font-medium"
            >
              Ver histórico
            </button>
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <FileText className="h-4 w-4 text-california-red" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Nota Fiscal</h2>
            <p className="text-xs text-muted-foreground">
              Anexe a NF do mês para receber na janela de pagamento.
            </p>
          </div>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold">{nomeCompetencia}</p>

        {props.nfVigente ? (
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              <span>
                Enviada em{" "}
                {new Date(props.nfVigente.uploaded_at).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · {props.nfVigente.arquivo_nome}
              </span>
            </div>
            <p
              className={
                janela === "salarios"
                  ? "text-xs text-muted-foreground"
                  : "text-xs text-amber-700"
              }
            >
              {janela === "salarios"
                ? `Pagamento previsto: 03/${String(props.mesVigente === 12 ? 1 : props.mesVigente + 1).padStart(2, "0")} (janela de salários).`
                : `⚠ Fora do prazo — pagamento vai pra janela de fornecedores (08/${String(props.mesVigente === 12 ? 1 : props.mesVigente + 1).padStart(2, "0")}).`}
            </p>
          </div>
        ) : (
          <p
            className={
              countdown.vencido
                ? "mt-2 text-sm text-amber-700"
                : "mt-2 text-sm text-muted-foreground"
            }
          >
            ⏱ {countdown.mensagem}
          </p>
        )}
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          onChange={handleArquivo}
          className="hidden"
        />
        <button
          type="button"
          onClick={handleSelecionarArquivo}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-all"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {props.nfVigente ? "Substituir" : "Anexar NF"}
        </button>
        <button
          type="button"
          onClick={() => setHistOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
        >
          <History className="h-4 w-4" />
          Ver histórico
        </button>
      </div>

      {histOpen && (
        <HistoricoNfModal
          colaboradorId={props.colaboradorId}
          open={histOpen}
          onOpenChange={setHistOpen}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Criar `HistoricoNfModal`**

Arquivo `app/(app)/perfil/_components/historico-nf-modal.tsx`:

```typescript
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  anexarNfColaborador,
  baixarNfColaborador,
} from "@/lib/nf/anexos-actions";
import { janelaDaNf } from "@/lib/folha/janela-pagamento";

const NOMES_MES = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

interface LinhaHistorico {
  competencia_ano: number;
  competencia_mes: number;
  nf: { id: string; arquivo_nome: string; uploaded_at: string } | null;
  folha_status: string | null;
}

export function HistoricoNfModal(props: {
  colaboradorId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [linhas, setLinhas] = React.useState<LinhaHistorico[] | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Carrega sob demanda via fetch para evitar passar lista grande do server.
  React.useEffect(() => {
    if (!props.open) return;
    (async () => {
      const res = await fetch(
        `/api/nf-historico?colaborador=${props.colaboradorId}`,
      );
      if (!res.ok) {
        setErro("Falha ao carregar histórico.");
        return;
      }
      setLinhas(await res.json());
    })();
  }, [props.open, props.colaboradorId]);

  async function baixar(anexoId: string) {
    const r = await baixarNfColaborador(anexoId);
    if (!r.ok) {
      alert(r.message);
      return;
    }
    window.open(r.url, "_blank");
  }

  function anexarPara(ano: number, mes: number) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      startTransition(async () => {
        const buf = await file.arrayBuffer();
        const r = await anexarNfColaborador({
          colaboradorId: props.colaboradorId,
          ano,
          mes,
          arquivoBuffer: buf,
          arquivoNome: file.name,
          arquivoTamanhoBytes: file.size,
        });
        if (!r.ok) {
          setErro(r.message);
          return;
        }
        router.refresh();
        props.onOpenChange(false);
      });
    };
    input.click();
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico de Notas Fiscais</DialogTitle>
          <DialogDescription>
            Suas NFs por competência. Pode anexar as pendentes direto daqui.
          </DialogDescription>
        </DialogHeader>

        {erro && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {erro}
          </div>
        )}

        {!linhas ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : linhas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Sem histórico ainda.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className="text-left py-2 font-medium">Competência</th>
                <th className="text-left py-2 font-medium">NF enviada</th>
                <th className="text-left py-2 font-medium">Janela</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-right py-2 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const janela = l.nf
                  ? janelaDaNf({
                      uploadedAt: l.nf.uploaded_at,
                      competenciaAno: l.competencia_ano,
                      competenciaMes: l.competencia_mes,
                    })
                  : null;
                return (
                  <tr key={`${l.competencia_ano}-${l.competencia_mes}`} className="border-b border-border">
                    <td className="py-2">
                      {NOMES_MES[l.competencia_mes - 1]}/{l.competencia_ano}
                    </td>
                    <td className="py-2">
                      {l.nf
                        ? new Date(l.nf.uploaded_at).toLocaleDateString("pt-BR")
                        : "—"}
                    </td>
                    <td className="py-2">
                      {janela
                        ? `${janela.janela === "salarios" ? "Salários" : "Fornecedores"} (${janela.data_prevista})`
                        : "—"}
                    </td>
                    <td className="py-2">{labelStatus(l.folha_status, !!l.nf)}</td>
                    <td className="py-2 text-right">
                      {l.nf ? (
                        <button
                          type="button"
                          onClick={() => baixar(l.nf!.id)}
                          className="inline-flex items-center gap-1 text-xs text-california-red hover:underline"
                        >
                          <Download className="h-3 w-3" />
                          Baixar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            anexarPara(l.competencia_ano, l.competencia_mes)
                          }
                          disabled={pending}
                          className="inline-flex items-center gap-1 text-xs text-california-red hover:underline"
                        >
                          <Upload className="h-3 w-3" />
                          Anexar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function labelStatus(folhaStatus: string | null, temNf: boolean): string {
  if (!folhaStatus && temNf) return "Aguardando folha";
  if (!folhaStatus) return "Aguardando RH";
  switch (folhaStatus) {
    case "rascunho":
    case "enviada":
      return "Aguardando aprovação";
    case "pendente_correcao":
      return "Em correção";
    case "aprovada":
      return "Aprovada";
    case "paga":
      return "Paga";
    default:
      return folhaStatus;
  }
}
```

- [ ] **Step 3: Criar API route de histórico**

Arquivo `app/api/nf-historico/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const colaboradorId = req.nextUrl.searchParams.get("colaborador");
  if (!colaboradorId) {
    return NextResponse.json({ error: "colaborador requerido" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, user_id")
    .eq("id", colaboradorId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!colab) {
    return NextResponse.json({ error: "colaborador não encontrado" }, { status: 404 });
  }
  const ehDono = colab.user_id === session.profile.id;
  if (!ehDono && !pode(session.activeRole, "rh.nf.ver")) {
    return NextResponse.json({ error: "sem permissão" }, { status: 403 });
  }

  // Combina folhas PJ abertas + NFs anexadas em uma única lista por competência.
  const [folhasRes, nfsRes] = await Promise.all([
    supabase
      .from("folhas_pagamento")
      .select("competencia_ano, competencia_mes, status")
      .eq("tenant_id", session.activeTenant.id)
      .eq("colaborador_id", colaboradorId)
      .eq("origem", "california"),
    supabase
      .from("colaboradores_nf_anexos")
      .select("id, competencia_ano, competencia_mes, arquivo_nome, uploaded_at")
      .eq("tenant_id", session.activeTenant.id)
      .eq("colaborador_id", colaboradorId),
  ]);

  type Row = {
    competencia_ano: number;
    competencia_mes: number;
    folha_status: string | null;
    nf: { id: string; arquivo_nome: string; uploaded_at: string } | null;
  };
  const porChave = new Map<string, Row>();
  for (const f of folhasRes.data ?? []) {
    const chave = `${f.competencia_ano}-${f.competencia_mes}`;
    porChave.set(chave, {
      competencia_ano: f.competencia_ano,
      competencia_mes: f.competencia_mes,
      folha_status: f.status,
      nf: null,
    });
  }
  for (const n of nfsRes.data ?? []) {
    const chave = `${n.competencia_ano}-${n.competencia_mes}`;
    const atual = porChave.get(chave) ?? {
      competencia_ano: n.competencia_ano,
      competencia_mes: n.competencia_mes,
      folha_status: null,
      nf: null,
    };
    atual.nf = {
      id: n.id,
      arquivo_nome: n.arquivo_nome,
      uploaded_at: n.uploaded_at,
    };
    porChave.set(chave, atual);
  }

  const linhas = Array.from(porChave.values()).sort((a, b) => {
    const chaveA = a.competencia_ano * 100 + a.competencia_mes;
    const chaveB = b.competencia_ano * 100 + b.competencia_mes;
    return chaveB - chaveA;
  });

  return NextResponse.json(linhas);
}
```

- [ ] **Step 4: Atualizar `app/(app)/perfil/page.tsx`**

Trocar o import e o uso:

```typescript
// Remover:
// import { CardNotaFiscal } from "./card-nota-fiscal";

// Adicionar:
import { CardNfMes } from "./_components/card-nf-mes";
```

E o render (substituir `<CardNotaFiscal tipoContratacao={colab.tipo_contratacao} />`):

```typescript
<CardNfMes
  colaboradorId={colab.id}
  tipoContratacao={colab.tipo_contratacao}
  nfVigente={nfVigenteDoMes}
  backlog={backlogPendente}
  anoVigente={anoVigente}
  mesVigente={mesVigente}
/>
```

Carregar os dados antes do return no page server component:

```typescript
const hoje = new Date();
const anoVigente = hoje.getFullYear();
const mesVigente = hoje.getMonth() + 1;

const [{ data: nfVigenteData }, { data: folhasAbertasData }, { data: nfsExistentesData }] = await Promise.all([
  supabase
    .from("colaboradores_nf_anexos")
    .select("id, arquivo_nome, uploaded_at")
    .eq("tenant_id", session.activeTenant.id)
    .eq("colaborador_id", colab.id)
    .eq("competencia_ano", anoVigente)
    .eq("competencia_mes", mesVigente)
    .maybeSingle(),
  supabase
    .from("folhas_pagamento")
    .select("competencia_ano, competencia_mes")
    .eq("tenant_id", session.activeTenant.id)
    .eq("colaborador_id", colab.id)
    .eq("origem", "california")
    .in("status", ["rascunho", "enviada", "aprovada", "pendente_correcao"]),
  supabase
    .from("colaboradores_nf_anexos")
    .select("competencia_ano, competencia_mes")
    .eq("tenant_id", session.activeTenant.id)
    .eq("colaborador_id", colab.id),
]);

const nfsExistentes = new Set(
  (nfsExistentesData ?? []).map((n) => `${n.competencia_ano}-${n.competencia_mes}`),
);
const backlogPendente = (folhasAbertasData ?? [])
  .filter((f) => {
    // Só anteriores ao mês vigente E sem NF
    const chave = `${f.competencia_ano}-${f.competencia_mes}`;
    const anteriorAoVigente =
      f.competencia_ano < anoVigente ||
      (f.competencia_ano === anoVigente && f.competencia_mes < mesVigente);
    return anteriorAoVigente && !nfsExistentes.has(chave);
  })
  .map((f) => ({ ano: f.competencia_ano, mes: f.competencia_mes }));

const nfVigenteDoMes = nfVigenteData ?? null;
```

- [ ] **Step 5: Deletar o placeholder**

```powershell
git rm app/\(app\)/perfil/card-nota-fiscal.tsx
```

- [ ] **Step 6: Build + smoke test visual**

```powershell
npm run build
npm run dev
```

Login como colaborador PJ. Em `/perfil`, verificar:
1. Card "Nota Fiscal" entre Dados Bancários e Minhas Férias.
2. Countdown correto para o mês vigente.
3. Botão "Anexar NF" → seleciona PDF → sobe → card muda pra "Enviada em DD/MM" com janela.
4. Botão "Ver histórico" → modal lista competências (vigente + folha PJ abertas + NFs anteriores).
5. Login como admin/RH e abrir `/perfil` → tipo não-PJ → card não aparece.

- [ ] **Step 7: Commit**

```powershell
git add app/\(app\)/perfil/ app/api/nf-historico/
git commit -m "feat(nf): /perfil card NF do mes + modal de historico + API de listagem"
```

---

## Task 10: UI RH — card no cadastro `/rh/colaboradores/[id]`

**Files:**
- Create: `app/(app)/rh/colaboradores/[id]/_components/card-nf-colaborador.tsx`
- Modify: `app/(app)/rh/colaboradores/[id]/page.tsx` (adicionar o card)

**Interfaces:**
- Consumes: `CardNfMes` (Task 9) — reutiliza o mesmo componente, só muda a origem do `colaboradorId`.

- [ ] **Step 1: Criar wrapper específico do RH**

Como o `CardNfMes` já aceita `colaboradorId` genérico, o "wrapper" do RH é só uma importação direta. Vou criar o arquivo-wrapper só pra documentar a intenção e manter paralelo com os outros `Card*` da pasta:

Arquivo `app/(app)/rh/colaboradores/[id]/_components/card-nf-colaborador.tsx`:

```typescript
import { CardNfMes } from "@/app/(app)/perfil/_components/card-nf-mes";

/** Alias semântico: na página do colaborador, o RH vê o mesmo card que o
 *  colaborador vê em /perfil (reaproveita UI; permissão `rh.nf.anexar_qualquer`
 *  é validada pela server action). */
export const CardNfColaborador = CardNfMes;
```

- [ ] **Step 2: Modificar `page.tsx`**

Em `app/(app)/rh/colaboradores/[id]/page.tsx`:

Adicionar import:

```typescript
import { CardNfColaborador } from "./_components/card-nf-colaborador";
```

Carregar dados equivalentes aos do /perfil (reaproveitando o padrão):

```typescript
const hojeNf = new Date();
const anoNfVigente = hojeNf.getFullYear();
const mesNfVigente = hojeNf.getMonth() + 1;

const [{ data: nfVigenteData }, { data: folhasAbertasData }, { data: nfsExistentesData }] = await Promise.all([
  supabase
    .from("colaboradores_nf_anexos")
    .select("id, arquivo_nome, uploaded_at")
    .eq("tenant_id", session.activeTenant.id)
    .eq("colaborador_id", colab.id)
    .eq("competencia_ano", anoNfVigente)
    .eq("competencia_mes", mesNfVigente)
    .maybeSingle(),
  supabase
    .from("folhas_pagamento")
    .select("competencia_ano, competencia_mes")
    .eq("tenant_id", session.activeTenant.id)
    .eq("colaborador_id", colab.id)
    .eq("origem", "california")
    .in("status", ["rascunho", "enviada", "aprovada", "pendente_correcao"]),
  supabase
    .from("colaboradores_nf_anexos")
    .select("competencia_ano, competencia_mes")
    .eq("tenant_id", session.activeTenant.id)
    .eq("colaborador_id", colab.id),
]);

const nfsExistentes = new Set(
  (nfsExistentesData ?? []).map((n) => `${n.competencia_ano}-${n.competencia_mes}`),
);
const backlogPendente = (folhasAbertasData ?? [])
  .filter((f) => {
    const chave = `${f.competencia_ano}-${f.competencia_mes}`;
    const anteriorAoVigente =
      f.competencia_ano < anoNfVigente ||
      (f.competencia_ano === anoNfVigente && f.competencia_mes < mesNfVigente);
    return anteriorAoVigente && !nfsExistentes.has(chave);
  })
  .map((f) => ({ ano: f.competencia_ano, mes: f.competencia_mes }));
```

Renderizar o card (visível só pra pj/mei/clt_recibo — o componente já guarda isso):

```typescript
<CardNfColaborador
  colaboradorId={colab.id}
  tipoContratacao={colab.tipo_contratacao}
  nfVigente={nfVigenteData ?? null}
  backlog={backlogPendente}
  anoVigente={anoNfVigente}
  mesVigente={mesNfVigente}
/>
```

Posicionar na coluna direita (perto de outros cards tipo CardDadosBancarios).

- [ ] **Step 3: Build + smoke test visual**

Login como RH, abrir `/rh/colaboradores/[id]` de um PJ:
- Card aparece com countdown.
- Anexar funciona (RH tem `rh.nf.anexar_qualquer` → `podeMexerNaNf` libera).

Abrir cadastro de um CLT puro → card **não** aparece.

- [ ] **Step 4: Commit**

```powershell
git add app/\(app\)/rh/colaboradores/\[id\]/
git commit -m "feat(nf): card de NF no cadastro RH do colaborador (reusa CardNfMes)"
```

---

## Task 11: UI financeiro — bloco NF no drawer de aprovação

**Files:**
- Create: `app/(app)/financeiro/contas-a-pagar/_components/bloco-nf-drawer.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/revisar-folha-drawer.tsx` (incluir o bloco)
- Modify: `app/(app)/financeiro/contas-a-pagar/folhas-pagar-list.tsx` (precisa carregar `tem_nf` por linha e passar pro drawer)
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx` (SELECT das NFs)

**Interfaces:**
- Consumes: `baixarNfColaborador` (Task 7), `janelaDaNf` (Task 4).
- Produces: componente client `<BlocoNfDrawer linhaId tipoContratacao origem colaboradorId ano mes nfAnexada />`.

- [ ] **Step 1: Criar o componente**

Arquivo `app/(app)/financeiro/contas-a-pagar/_components/bloco-nf-drawer.tsx`:

```typescript
"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Download, FileText, Loader2 } from "lucide-react";
import { baixarNfColaborador } from "@/lib/nf/anexos-actions";
import { janelaDaNf } from "@/lib/folha/janela-pagamento";
import type { FolhaOrigem, TipoContratacao } from "@/lib/types";

export interface NfResumo {
  id: string;
  arquivo_nome: string;
  uploaded_at: string;
}

export function BlocoNfDrawer(props: {
  origem: FolhaOrigem;
  tipoContratacao: TipoContratacao;
  competenciaAno: number;
  competenciaMes: number;
  nf: NfResumo | null;
}) {
  const exigeNf =
    props.origem === "california" &&
    ["pj", "mei", "clt_recibo"].includes(props.tipoContratacao);
  if (!exigeNf) return null;

  const [baixando, setBaixando] = React.useState(false);

  async function baixar() {
    if (!props.nf) return;
    setBaixando(true);
    const r = await baixarNfColaborador(props.nf.id);
    setBaixando(false);
    if (!r.ok) {
      alert(r.message);
      return;
    }
    window.open(r.url, "_blank");
  }

  if (!props.nf) {
    return (
      <div className="rounded-lg border border-california-red/20 bg-california-red/5 px-4 py-3">
        <div className="flex items-start gap-2 text-sm text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">NF não anexada</p>
            <p className="text-xs opacity-80">
              Peça pro colaborador anexar em /perfil, ou use o cadastro em
              /rh/colaboradores. A aprovação fica bloqueada até isso ser feito.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const janela = janelaDaNf({
    uploadedAt: props.nf.uploaded_at,
    competenciaAno: props.competenciaAno,
    competenciaMes: props.competenciaMes,
  });

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 text-sm text-emerald-900 min-w-0">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              <span className="truncate">{props.nf.arquivo_nome}</span>
            </p>
            <p className="text-xs opacity-80">
              Enviada em{" "}
              {new Date(props.nf.uploaded_at).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              ·{" "}
              {janela.janela === "salarios"
                ? `Janela de salários (${janela.data_prevista})`
                : `Janela de fornecedores (${janela.data_prevista}) — fora do prazo`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={baixar}
          disabled={baixando}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50 transition-colors"
        >
          {baixando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Baixar
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Passar `nf` pro drawer**

Em `app/(app)/financeiro/contas-a-pagar/page.tsx`, no SELECT das folhas, não dá pra fazer embed condicional em tabela sem FK direta. Fazer query separada e merge:

Após o fetch de `folhasRes`:

```typescript
// Carrega NFs das competências presentes no fetch de folhas (1 query extra).
const chavesNf = Array.from(
  new Set(
    (folhasRes.data ?? []).map(
      (f: any) =>
        `${f.colaborador_id}|${f.competencia_ano}|${f.competencia_mes}`,
    ),
  ),
);
let nfsPorChave = new Map<string, { id: string; arquivo_nome: string; uploaded_at: string }>();
if (chavesNf.length > 0) {
  const competencias = (folhasRes.data ?? []).map((f: any) => ({
    colaborador_id: f.colaborador_id,
    ano: f.competencia_ano,
    mes: f.competencia_mes,
  }));
  // Query simples por tenant; filtro em JS pela chave composta.
  const { data: nfData } = await supabase
    .from("colaboradores_nf_anexos")
    .select("id, colaborador_id, competencia_ano, competencia_mes, arquivo_nome, uploaded_at")
    .eq("tenant_id", session.activeTenant.id)
    .in(
      "colaborador_id",
      Array.from(new Set((folhasRes.data ?? []).map((f: any) => f.colaborador_id))),
    );
  for (const n of nfData ?? []) {
    nfsPorChave.set(`${n.colaborador_id}|${n.competencia_ano}|${n.competencia_mes}`, {
      id: n.id,
      arquivo_nome: n.arquivo_nome,
      uploaded_at: n.uploaded_at,
    });
  }
}
```

No `folhasParaTab.map`:

```typescript
nf: nfsPorChave.get(
  `${l.colaborador_id}|${l.competencia_ano}|${l.competencia_mes}`,
) ?? null,
```

- [ ] **Step 3: Estender tipo `FolhaLinhaFinanceiro`**

Em `folhas-pagar-list.tsx`, adicionar ao tipo:

```typescript
nf: {
  id: string;
  arquivo_nome: string;
  uploaded_at: string;
} | null;
```

- [ ] **Step 4: Incluir `<BlocoNfDrawer>` no drawer**

Em `revisar-folha-drawer.tsx`, importar e renderizar logo no topo do corpo (antes do bloco de edição):

```typescript
import { BlocoNfDrawer } from "./_components/bloco-nf-drawer";

// Dentro do JSX, após o DialogHeader:
<BlocoNfDrawer
  origem={props.linha.origem}
  tipoContratacao={props.linha.colaborador.tipo_contratacao}
  competenciaAno={props.linha.competencia_ano}
  competenciaMes={props.linha.competencia_mes}
  nf={props.linha.nf}
/>
```

- [ ] **Step 5: Desabilitar botão "Aprovar" quando falta NF**

No `revisar-folha-drawer.tsx`, localizar o botão de aprovar. Trocar `disabled={...}` para incluir:

```typescript
const exigeNfSemAnexo =
  props.linha.origem === "california" &&
  ["pj", "mei", "clt_recibo"].includes(
    props.linha.colaborador.tipo_contratacao,
  ) &&
  !props.linha.nf;

// No botão:
disabled={pending || exigeNfSemAnexo}
title={exigeNfSemAnexo ? "NF não anexada" : undefined}
```

- [ ] **Step 6: Build + smoke test visual**

Login como financeiro. Abrir drawer de linha PJ sem NF:
- Bloco "NF não anexada" vermelho.
- Botão "Aprovar" disabled com tooltip.

Anexar NF (via /perfil ou cadastro RH). Refresh. Reabrir drawer:
- Bloco verde "NF Nome.pdf · Janela de salários (03/11)".
- Botão "Baixar" funciona (abre PDF em nova aba).
- Botão "Aprovar" habilitado.

Abrir drawer de linha CLT puro: nenhum bloco de NF aparece; aprovar segue.

- [ ] **Step 7: Commit**

```powershell
git add app/\(app\)/financeiro/contas-a-pagar/
git commit -m "feat(nf): bloco NF no drawer financeiro + trava do botao Aprovar quando falta NF"
```

---

## Task 12: UI RH — badge "NF anexada" na página da competência

**Files:**
- Modify: `app/(app)/rh/folhas/[competencia]/page.tsx` (carregar NFs)
- Modify: `app/(app)/rh/folhas/[competencia]/folha-competencia-view.tsx` (campo `tem_nf` + selo)

**Interfaces:**
- Consumes: tabela `colaboradores_nf_anexos`.
- Produces: `FolhaLinha` ganha campo `tem_nf: boolean`; `<SeloNfAnexada />` renderizado ao lado de `<SeloFluxo />` e `<SeloHibrido />`.

- [ ] **Step 1: Carregar NFs da competência no server component**

Em `app/(app)/rh/folhas/[competencia]/page.tsx`, após o fetch de `linhasRes`:

```typescript
// NFs anexadas pra essa competência (uma query extra; evita embed sem FK direta).
const { data: nfsData } = await supabase
  .from("colaboradores_nf_anexos")
  .select("colaborador_id")
  .eq("tenant_id", session.activeTenant.id)
  .eq("competencia_ano", ano)
  .eq("competencia_mes", mes);
const colabsComNf = new Set((nfsData ?? []).map((n) => n.colaborador_id));
```

E no `.map(l => ...)` do `FolhaLinha`:

```typescript
tem_nf: colabsComNf.has(l.colaborador_id),
```

- [ ] **Step 2: Adicionar `tem_nf` ao tipo `FolhaLinha`**

Em `folha-competencia-view.tsx`:

```typescript
export type FolhaLinha = {
  // ...existentes...
  tem_nf: boolean;
};
```

- [ ] **Step 3: Adicionar `<SeloNfAnexada />` no render**

Após `<SeloFluxo>` + `<SeloHibrido>`:

```typescript
<SeloNfAnexada
  exigeNf={
    l.origem === "california" &&
    ["pj", "mei", "clt_recibo"].includes(l.colaborador.tipo_contratacao)
  }
  temNf={l.tem_nf}
/>
```

E no fim do arquivo:

```typescript
function SeloNfAnexada({
  exigeNf,
  temNf,
}: {
  exigeNf: boolean;
  temNf: boolean;
}) {
  if (!exigeNf) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-semibold ${
        temNf
          ? "bg-emerald-100 text-emerald-800"
          : "bg-muted text-muted-foreground"
      }`}
      title={temNf ? "NF anexada" : "NF ainda não anexada"}
    >
      NF {temNf ? "✓" : "—"}
    </span>
  );
}
```

- [ ] **Step 4: Build + smoke test visual**

Abrir `/rh/folhas/[competencia]` com linhas PJ. Linhas sem NF: badge "NF —" muted. Linhas com NF: badge "NF ✓" verde. Linhas CLT puro: sem badge.

- [ ] **Step 5: Commit**

```powershell
git add app/\(app\)/rh/folhas/\[competencia\]/
git commit -m "feat(nf): badge NF anexada na pagina da competencia (RH)"
```

---

## Encerramento

- [ ] **`npm run build`** — garantir build limpo.
- [ ] **Rodar os dois testes**:
  ```powershell
  npm run test:nf-janela
  npm run test:nf-countdown
  ```
- [ ] **E2E manual completo (6 passos):**
  1. RH gera folha PJ outubro em `/rh/folhas`.
  2. Colaborador PJ loga, vai em `/perfil` → vê card de outubro com countdown.
  3. Anexa PDF → card atualiza → badge "No prazo" na página da competência (RH).
  4. Financeiro abre drawer da linha dele → vê NF verde, aprova. `contas_avulsas` criada.
  5. Outro PJ: anexar dia 26 → janela de fornecedores. Financeiro aprova OK.
  6. Terceiro PJ: não anexa. Financeiro tenta aprovar → erro.
- [ ] **Atualizar `docs/HANDOFF.md`** com uma linha curta sobre a entrega.
