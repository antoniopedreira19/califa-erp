# Quadro de NFs do colaborador + aba People no financeiro — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o card "NF do Mês" num quadro multi-evento (folha mensal, férias/usufruto, abono avulso, abono combinado, 13° P1, 13° P2); mover a aprovação de férias/abono do RH pro financeiro; travar aprovação dos pagamentos de colaborador PJ enquanto não houver NF anexada; e reunir tudo isso numa nova aba "People" em `/financeiro/contas-a-pagar`.

**Architecture:** Generalização aditiva de `colaboradores_nf_anexos` com `escopo_tipo` (enum) + `escopo_id` (FK polimórfica validada por trigger). Uma view por consumidor (`vw_nf_pendentes_colaborador` pro perfil; `vw_people_aprovar_financeiro` pro financeiro) une folhas mensais + lançamentos de férias + parcelas de 13° usando LEFT JOIN com `contas_avulsas` como fonte de "pago". Novo status `aguardando_financeiro` em `ferias_lancamento_status` quebra o fluxo atual (RH aprovava direto; agora o financeiro aprova com NF). Backlog com cutoff fixo em 2026-10. Abono combinado gera **2 contas_avulsas** separadas (uma de férias, uma de abono) na aprovação do financeiro, uma por linha do quadro.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Supabase Postgres + RLS + Storage, `node --test` + `tsx`, Tailwind + shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-10-26-quadro-nf-colaborador-design.md](../specs/2026-10-26-quadro-nf-colaborador-design.md)

## Global Constraints

- **Linguagem UI:** PT-BR com acentuação completa em qualquer string renderizada ou de erro visível (CLAUDE.md "Ortografia em português").
- **Banco pelo fluxo do MCP:** migration via `apply_migration`, conferência pelo MCP, commit junto do código que depende (`docs/FLUXO-BANCO.md`).
- **GRANT para `authenticated`** explícito em toda tabela/view nova; `anon` sem acesso. RLS usa `(select auth.uid())` em subselect (performance).
- **`lib/types.ts` à mão:** atualizar no MESMO commit da migration que mexe em tipos usados pela UI.
- **Nenhuma PII em arquivos versionados:** teste/fixture usa placeholders de `CLAUDE.md`.
- **Cutoff do backlog = 2026-10** (fixo nas duas views: `competencia_ano * 100 + competencia_mes >= 202610`).
- **Fluxo da folha mensal em produção não pode quebrar.** Backfill setando `escopo_tipo='folha_mensal'` nas linhas existentes. Mudanças de UI mantêm a semântica atual de "só PJ/MEI/CLT-recibo vê o quadro".
- **Rescisão fora do quadro.** Enum `nf_anexo_escopo` **não** inclui `rescisao`. RH anexa na página de rescisão (não existe ainda).
- **Audit log** em todo evento sensível via `logAuditEvent({ acao, tenantId, entidadeTipo, entidadeId, metadata })`.
- **Testes:** `node --test` + `tsx` (framework existente). Arquivos `*.test.ts` ao lado do código.

## Review Focus

1. **Upload de NF por não-dono.** Colaborador A tenta anexar NF em `escopo_id` do colaborador B. Server action valida ownership via `is_colaborador_proprio(colaborador_id_do_escopo_id)` antes de qualquer I/O. (Task 3 tem o teste.)
2. **Trigger de validação polimórfica.** `escopo_tipo='folha_mensal'` com `escopo_id` apontando pra lançamento de férias deve falhar. (Task 1 tem o teste.)
3. **Backfill de folha mensal com múltiplas folhas na mesma competência.** Se uma folha foi regenerada, a NF original pode ficar sem FK confiável. Backfill escolhe a folha mais recente da competência; órfãs ficam com `escopo_id=null` e aparecem em log. (Task 1 tem o teste.)
4. **View respeitando cutoff.** NF/folha de setembro/2026 não aparece no quadro nem na People. Setembro/2026 é borda (não entra); outubro/2026 entra. (Task 2 tem o teste.)
5. **Botão "Aprovar" habilitado concorrente com delete de NF.** NF anexada → botão habilita → RH ou colaborador deleta a NF antes do financeiro clicar → clique chega sem NF. Server action re-valida antes de criar `conta_avulsa`. (Task 6 e Task 5 têm teste de "aprovar sem NF retorna erro".)

---

## File Structure

**Create:**
- `supabase/migrations/20261026100001_nf_anexos_generalizacao_escopo.sql`
- `supabase/migrations/20261026100002_vw_nf_quadro_e_people.sql`
- `supabase/migrations/20261026100003_ferias_aguardando_financeiro_e_reset.sql`
- `lib/nf/anexos-escopo.ts` — helper puro de mapeamento `(escopo_tipo, escopo_id) → tabela/colunas`
- `lib/nf/anexos-escopo.test.ts`
- `lib/financeiro/aprovar-ferias.ts` — pura: dado lançamento, retorna lista de contas a criar
- `lib/financeiro/aprovar-ferias.test.ts`
- `app/(app)/perfil/_components/quadro-nf.tsx` — substitui `card-nf-mes.tsx`
- `app/(app)/perfil/_components/quadro-nf-linha.tsx` — uma linha do quadro
- `app/(app)/financeiro/contas-a-pagar/people-list.tsx` — substitui `folhas-pagar-list.tsx`
- `app/(app)/financeiro/contas-a-pagar/actions-people.ts` — `aprovarFeriasFinanceiro`, stub `aprovarDecimoTerceiroFinanceiro`
- `app/(app)/financeiro/contas-a-pagar/actions-people.test.ts`

**Modify:**
- `lib/types.ts` — adicionar enum `NfAnexoEscopo`, `NfPendenteQuadro`, `PeopleAprovarItem`; atualizar `FeriasLancamentoStatus` com `aguardando_financeiro`
- `lib/nf/anexos-actions.ts` — generalizar `anexarNf()` pra receber `(escopo_tipo, escopo_id)` em vez de `(ano, mes)`
- `lib/nf/anexos-actions.test.ts` — cobrir novos escopos
- `app/(app)/perfil/page.tsx` — trocar `<CardNfMes />` por `<QuadroNf />` consumindo a view
- `app/(app)/perfil/_components/card-nf-mes.tsx` — deletar
- `app/(app)/financeiro/contas-a-pagar/page.tsx` — renomear tab "Folhas de Pagamento" → "People"; consumir `vw_people_aprovar_financeiro`
- `app/(app)/financeiro/contas-a-pagar/folhas-pagar-list.tsx` — deletar
- `app/(app)/financeiro/contas-a-pagar/revisar-folha-drawer.tsx` — aceitar `tipo` + editar `valor_aprovado` + audit `valor_original`×`valor_aprovado`
- `app/(app)/financeiro/contas-a-pagar/actions-folhas.ts` — `aprovarLinhaFolha()` recusa com erro quando `nf_anexada=false` e `exige_nf=true`; audit do valor editado

---

## Task 1: Generalização de `colaboradores_nf_anexos` + backfill

**Files:**
- Create: `supabase/migrations/20261026100001_nf_anexos_generalizacao_escopo.sql`
- Create: `lib/nf/anexos-escopo.ts`
- Create: `lib/nf/anexos-escopo.test.ts`
- Modify: `lib/types.ts`

**Interfaces:**
- Produces:
  - enum `nf_anexo_escopo`: `'folha_mensal' | 'ferias_usufruto' | 'ferias_abono' | 'decimo_terceiro_p1' | 'decimo_terceiro_p2'`
  - colunas `escopo_tipo nf_anexo_escopo`, `escopo_id uuid` em `colaboradores_nf_anexos`
  - unique parcial `UNIQUE (tenant_id, colaborador_id, escopo_tipo, escopo_id) WHERE escopo_id IS NOT NULL`
  - trigger de validação polimórfica `fn_valida_nf_anexo_escopo()`
  - novo valor `'aguardando_financeiro'` em `ferias_lancamento_status`
  - helper puro `escopoParaFkTabela(escopo: NfAnexoEscopo): { tabela: string; coluna: string }`
  - tipos: `NfAnexoEscopo` enum, `ColaboradorNfAnexo` com novas colunas

- [ ] **Step 1: Ler o estado atual pelo MCP**

Rodar via MCP:
- `list_tables` em `colaboradores_nf_anexos` pra confirmar schema atual
- `execute_sql` select nas linhas existentes pra dimensionar backfill (`select count(*) from colaboradores_nf_anexos`)
- `execute_sql` select em `folhas_pagamento` pra entender duplicatas de competência (regeração)
- `execute_sql` select em `ferias_lancamento_status` enum values atuais

- [ ] **Step 2: Escrever a migration**

Arquivo `supabase/migrations/20261026100001_nf_anexos_generalizacao_escopo.sql`:

```sql
-- Generaliza colaboradores_nf_anexos pra suportar NFs de folha mensal,
-- férias, abono e 13° (parcelas 1 e 2). Chave antiga (colab, ano, mês) vira
-- índice secundário pra folha mensal; chave nova é (colab, escopo_tipo,
-- escopo_id). Adiciona valor 'aguardando_financeiro' em
-- ferias_lancamento_status pro novo fluxo de aprovação pelo financeiro.
-- Spec: docs/superpowers/specs/2026-10-26-quadro-nf-colaborador-design.md
```

Conteúdo:
1. `CREATE TYPE nf_anexo_escopo AS ENUM (...)` (5 valores)
2. `ALTER TABLE colaboradores_nf_anexos ADD COLUMN escopo_tipo nf_anexo_escopo` (nullable inicialmente)
3. `ALTER TABLE colaboradores_nf_anexos ADD COLUMN escopo_id uuid` (nullable)
4. Backfill: para cada linha existente, setar `escopo_tipo='folha_mensal'` e `escopo_id = (select max(f.id) from folhas_pagamento f where f.tenant_id=anexo.tenant_id and f.colaborador_id=anexo.colaborador_id and f.competencia_ano=anexo.competencia_ano and f.competencia_mes=anexo.competencia_mes)`. Linhas sem match ficam com `escopo_id=null` + log (`RAISE NOTICE`).
5. `ALTER TABLE ... ALTER COLUMN escopo_tipo SET NOT NULL`
6. `CREATE UNIQUE INDEX uniq_nf_anexos_escopo ON colaboradores_nf_anexos (tenant_id, colaborador_id, escopo_tipo, escopo_id) WHERE escopo_id IS NOT NULL`
7. **Drop** da unique antiga `(tenant_id, colaborador_id, competencia_ano, competencia_mes)` **e cria** índice (não-unique) com os mesmos campos pra consulta por competência.
8. Função `fn_valida_nf_anexo_escopo()`:
   - Se `escopo_tipo='folha_mensal'`: valida `escopo_id in (select id from folhas_pagamento)`
   - Se `escopo_tipo in ('ferias_usufruto','ferias_abono')`: valida `escopo_id in (select id from colaboradores_ferias_lancamentos)`
   - Se `escopo_tipo in ('decimo_terceiro_p1','decimo_terceiro_p2')`: valida `escopo_id in (select id from decimo_terceiro_linhas)`
   - Trigger `BEFORE INSERT OR UPDATE OF escopo_tipo, escopo_id` em `colaboradores_nf_anexos`
9. Trigger `fn_barra_nf_anexo_sem_escopo_id`: `BEFORE INSERT`, bloqueia `escopo_id IS NULL` (só o backfill pode criar; depois ninguém).
10. `ALTER TYPE ferias_lancamento_status ADD VALUE 'aguardando_financeiro' BEFORE 'aprovado'`
11. `GRANT SELECT, INSERT, UPDATE, DELETE ON colaboradores_nf_anexos TO authenticated` (reaplicar — não quebra)

- [ ] **Step 3: Aplicar a migration pelo MCP**

`apply_migration` com o conteúdo. Reportar sucesso.

- [ ] **Step 4: Conferir pelo MCP**

- `list_tables` em `colaboradores_nf_anexos` → confirmar colunas novas, enum, trigger
- `execute_sql`: `select escopo_tipo, count(*), count(escopo_id) from colaboradores_nf_anexos group by 1` → zero linhas com `escopo_tipo IS NULL`
- `execute_sql`: `select count(*) from colaboradores_nf_anexos where escopo_id is null` → listar quantas órfãs (idealmente 0)
- `execute_sql` enum values de `ferias_lancamento_status` → confirmar `aguardando_financeiro` presente

- [ ] **Step 5: Escrever `lib/nf/anexos-escopo.ts`**

Helper puro mapeando `escopo` → `{ tabela, coluna }`:

```ts
export type NfAnexoEscopo =
  | "folha_mensal"
  | "ferias_usufruto"
  | "ferias_abono"
  | "decimo_terceiro_p1"
  | "decimo_terceiro_p2";

export function escopoParaFkTabela(escopo: NfAnexoEscopo): {
  tabela: string;
  coluna: string;
};
```

Corpo determinado por switch: `folha_mensal → ('folhas_pagamento','id')`, `ferias_* → ('colaboradores_ferias_lancamentos','id')`, `decimo_terceiro_* → ('decimo_terceiro_linhas','id')`.

- [ ] **Step 6: Teste do helper**

Arquivo `lib/nf/anexos-escopo.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { escopoParaFkTabela } from "./anexos-escopo";

test("folha_mensal mapeia pra folhas_pagamento.id", () => {
  assert.deepEqual(escopoParaFkTabela("folha_mensal"), {
    tabela: "folhas_pagamento",
    coluna: "id",
  });
});

test("ferias_usufruto e ferias_abono mapeiam pra colaboradores_ferias_lancamentos.id", () => {
  for (const e of ["ferias_usufruto", "ferias_abono"] as const) {
    assert.equal(escopoParaFkTabela(e).tabela, "colaboradores_ferias_lancamentos");
  }
});

test("decimo_terceiro_p1 e _p2 mapeiam pra decimo_terceiro_linhas.id", () => {
  for (const e of ["decimo_terceiro_p1", "decimo_terceiro_p2"] as const) {
    assert.equal(escopoParaFkTabela(e).tabela, "decimo_terceiro_linhas");
  }
});
```

Rodar: `npm test -- lib/nf/anexos-escopo.test.ts`. Esperado: FAIL (arquivo helper ainda não existe) → implementar → PASS.

- [ ] **Step 7: Teste SQL do trigger de validação (via MCP)**

`execute_sql`:
1. Pegar um `folha_id` real e um `ferias_lancamento_id` real.
2. Tentar `INSERT INTO colaboradores_nf_anexos (... escopo_tipo='folha_mensal', escopo_id=<ferias_id> ...)` → esperar `ERROR`.
3. Tentar `INSERT` com `escopo_id=<folha_id>` + `escopo_tipo='ferias_usufruto'` → esperar `ERROR`.
4. Tentar `INSERT` com `escopo_id IS NULL` → esperar `ERROR` (trigger `fn_barra_nf_anexo_sem_escopo_id`).

Documentar os 3 testes como DO blocks no final da migration, com `RAISE EXCEPTION` interceptado por `BEGIN; ... EXCEPTION WHEN OTHERS THEN RAISE NOTICE ...;` — ou rodar fora, manualmente, e colar o resultado no PR.

- [ ] **Step 8: Atualizar `lib/types.ts`**

Adicionar:
```ts
export type NfAnexoEscopo =
  | "folha_mensal"
  | "ferias_usufruto"
  | "ferias_abono"
  | "decimo_terceiro_p1"
  | "decimo_terceiro_p2";
```

Atualizar `ColaboradorNfAnexo` com `escopo_tipo: NfAnexoEscopo; escopo_id: string | null`.

Atualizar `FeriasLancamentoStatus`:
```ts
export type FeriasLancamentoStatus =
  | "pendente_aprovacao"
  | "em_analise"
  | "aguardando_financeiro"  // novo
  | "aprovado"
  | "reprovado"
  | "cancelado"
  | "concluido";
```

- [ ] **Step 9: `npm run typecheck`**

Esperado: PASS. Se quebrar em consumidores do enum (match statements em UI/actions de férias), consertar com `case "aguardando_financeiro": ...` nos lugares que listam status.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20261026100001_nf_anexos_generalizacao_escopo.sql lib/nf/anexos-escopo.ts lib/nf/anexos-escopo.test.ts lib/types.ts
git commit -m "feat(nf): generaliza colaboradores_nf_anexos com escopo_tipo + escopo_id"
```

---

## Task 2: Views `vw_nf_pendentes_colaborador` + `vw_people_aprovar_financeiro`

**Files:**
- Create: `supabase/migrations/20261026100002_vw_nf_quadro_e_people.sql`
- Modify: `lib/types.ts`

**Interfaces:**
- Produces:
  - view `vw_nf_pendentes_colaborador` — colunas: `tenant_id, colaborador_id, escopo_tipo, escopo_id, label, competencia_ano, competencia_mes, valor, prazo_anexo, nf_anexada, nf_anexo_id, nf_arquivo_nome, nf_uploaded_at`
  - view `vw_people_aprovar_financeiro` — mesmas colunas + `linha_id` (do item original) + `tipo_contratacao` + `funcao` + `origem` + `alocacao_resumo`
  - RLS por `security_invoker=on`
  - types `NfPendenteQuadro`, `PeopleAprovarItem`

- [ ] **Step 1: Ler estado pelo MCP**

`list_tables` em `folhas_pagamento`, `colaboradores_ferias_lancamentos`, `decimo_terceiro_linhas`, `contas_avulsas` pra confirmar colunas usadas no join.

- [ ] **Step 2: Escrever a migration**

Arquivo `supabase/migrations/20261026100002_vw_nf_quadro_e_people.sql`:

```sql
-- Views que unificam folhas mensais + lançamentos de férias + parcelas de 13°
-- numa lista de "NFs esperadas". vw_nf_pendentes_colaborador alimenta o quadro
-- no perfil; vw_people_aprovar_financeiro alimenta a aba People do financeiro.
-- Ambas respeitam cutoff 2026-10 (competência >= 202610) e filtram linhas já
-- pagas via contas_avulsas.status='paga'.
```

Estrutura:

```sql
CREATE OR REPLACE VIEW public.vw_nf_pendentes_colaborador
WITH (security_invoker = on) AS
WITH folhas AS (
  SELECT
    f.tenant_id,
    f.colaborador_id,
    'folha_mensal'::nf_anexo_escopo AS escopo_tipo,
    f.id AS escopo_id,
    'Folha mensal · ' || to_char(make_date(f.competencia_ano, f.competencia_mes, 1), 'TMMonth/YYYY') AS label,
    f.competencia_ano,
    f.competencia_mes,
    f.salario_base AS valor,
    make_date(f.competencia_ano, f.competencia_mes, 3) AS prazo_anexo,
    f.conta_avulsa_id
  FROM folhas_pagamento f
  WHERE f.status NOT IN ('paga')
    AND (f.competencia_ano * 100 + f.competencia_mes) >= 202610
),
ferias AS (
  SELECT
    l.tenant_id,
    l.colaborador_id,
    CASE WHEN l.tipo = 'abono_avulso' OR l.tipo = 'abono_combinado'
         THEN 'ferias_abono'::nf_anexo_escopo
         ELSE 'ferias_usufruto'::nf_anexo_escopo
    END AS escopo_tipo,
    l.id AS escopo_id,
    ... -- label por tipo, valor correspondente (férias ou abono), prazo = data_inicio - 2
    l.conta_avulsa_id
  FROM colaboradores_ferias_lancamentos l
  WHERE l.status IN ('aguardando_financeiro', 'aprovado')
    AND (extract(year from l.data_inicio)::int * 100 + extract(month from l.data_inicio)::int) >= 202610
  -- abono_combinado precisa de UNION ALL com duas linhas: uma férias + uma abono
),
decimo AS (
  -- stub por enquanto: SELECT WHERE false (view já contempla a estrutura)
  SELECT ... WHERE false
)
SELECT
  u.tenant_id,
  u.colaborador_id,
  u.escopo_tipo,
  u.escopo_id,
  u.label,
  u.competencia_ano,
  u.competencia_mes,
  u.valor,
  u.prazo_anexo,
  (n.id IS NOT NULL) AS nf_anexada,
  n.id AS nf_anexo_id,
  n.arquivo_nome AS nf_arquivo_nome,
  n.uploaded_at AS nf_uploaded_at
FROM (
  SELECT * FROM folhas
  UNION ALL SELECT * FROM ferias
  UNION ALL SELECT * FROM decimo
) u
LEFT JOIN contas_avulsas ca ON ca.id = u.conta_avulsa_id
LEFT JOIN colaboradores_nf_anexos n
  ON n.tenant_id = u.tenant_id
 AND n.colaborador_id = u.colaborador_id
 AND n.escopo_tipo = u.escopo_tipo
 AND n.escopo_id = u.escopo_id
WHERE ca.status IS DISTINCT FROM 'paga';

GRANT SELECT ON public.vw_nf_pendentes_colaborador TO authenticated;
```

Abono combinado: na CTE `ferias`, usar `UNION ALL` interno quando `tipo='abono_combinado'` — uma linha com `escopo_tipo='ferias_usufruto'` e valor=`valor_ferias+valor_um_terco`, outra com `escopo_tipo='ferias_abono'` e valor=`valor_abono`.

`vw_people_aprovar_financeiro`: estrutura análoga, mas filtra `folhas.status='enviada'` e `ferias.status='aguardando_financeiro'`; adiciona colunas `tipo_contratacao`, `funcao`, `origem`, `alocacao_resumo` via join com `colaboradores` e `folhas_pagamento_alocacoes` quando aplicável.

- [ ] **Step 3: Aplicar + conferir pelo MCP**

`apply_migration`. Depois `execute_sql`:
- `select escopo_tipo, count(*) from vw_nf_pendentes_colaborador group by 1`
- `select * from vw_nf_pendentes_colaborador where colaborador_id = '<um colab PJ real>' limit 5`
- Verificar que linha de competência 202609 **não** aparece.
- Verificar que linha com `conta_avulsa.status='paga'` **não** aparece.

- [ ] **Step 4: Teste SQL de cutoff e filtro de pago (via MCP)**

`execute_sql` script numa transação com `ROLLBACK`:
1. Inserir folha fake 202609 → confirmar que **não** aparece na view.
2. Inserir folha fake 202610 sem NF → confirmar que aparece com `nf_anexada=false`.
3. Marcar `contas_avulsas` dessa folha como `status='paga'` → confirmar que some.
4. `ROLLBACK`.

- [ ] **Step 5: Atualizar `lib/types.ts`**

```ts
export type NfPendenteQuadro = {
  tenant_id: string;
  colaborador_id: string;
  escopo_tipo: NfAnexoEscopo;
  escopo_id: string;
  label: string;
  competencia_ano: number | null;
  competencia_mes: number | null;
  valor: string | null;
  prazo_anexo: string | null; // ISO date
  nf_anexada: boolean;
  nf_anexo_id: string | null;
  nf_arquivo_nome: string | null;
  nf_uploaded_at: string | null;
};

export type PeopleAprovarItem = NfPendenteQuadro & {
  linha_id: string;
  tipo_contratacao: TipoContratacao;
  funcao: string | null;
  origem: FolhaOrigem | null;
  alocacao_resumo: string | null;
};
```

- [ ] **Step 6: `npm run typecheck && npm run lint`**

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261026100002_vw_nf_quadro_e_people.sql lib/types.ts
git commit -m "feat(nf): views do quadro e da aba People"
```

---

## Task 3: Server action generalizada de upload de NF

**Files:**
- Modify: `lib/nf/anexos-actions.ts`
- Modify: `lib/nf/anexos-actions.test.ts`

**Interfaces:**
- Consumes: `escopoParaFkTabela` (Task 1), tipos `NfAnexoEscopo` (Task 1)
- Produces:
  - `anexarNfPorEscopo({ escopoTipo: NfAnexoEscopo; escopoId: string; file: File }): Promise<ActionResult<{ nfId: string }>>`
  - `removerNfPorEscopo({ escopoTipo: NfAnexoEscopo; escopoId: string }): Promise<ActionResult>`
  - Mantém função antiga `anexarNfDoMes` como wrapper em cima da nova (compat), ou deleta se nenhum consumidor sobrou (checar com grep)

- [ ] **Step 1: Grep de consumidores do action antigo**

Rodar `grep -rn "anexarNfDoMes\|anexarNf\(" app lib` pra listar lugares que precisam atualizar.

- [ ] **Step 2: Teste — anexar em escopo de outro colaborador**

Em `lib/nf/anexos-actions.test.ts` adicionar:

```ts
test("anexarNfPorEscopo recusa escopo_id de outro colaborador", async () => {
  // setup: colab A e colab B existem; sessão como A; escopoId é folha do B
  // ação: anexarNfPorEscopo({ escopoTipo: "folha_mensal", escopoId: folhaDoB, file })
  // esperado: { ok: false, message: /não é dono/i }
});
```

Mais 1 teste pra cada escopo (férias e 13°) do mesmo caso.

- [ ] **Step 3: Rodar testes — devem FALHAR**

`npm test -- lib/nf/anexos-actions.test.ts`. Esperado: FAIL (função ainda não existe).

- [ ] **Step 4: Implementar `anexarNfPorEscopo`**

Assinatura em `lib/nf/anexos-actions.ts`:
```ts
export async function anexarNfPorEscopo(
  input: { escopoTipo: NfAnexoEscopo; escopoId: string; file: File }
): Promise<ActionResult<{ nfId: string }>>
```

Passos no corpo (não precisa listar linha a linha):
1. `requireSession()`.
2. Lookup do `colaborador_id` dono do `escopo_id` via `escopoParaFkTabela` + select.
3. Validar `is_colaborador_proprio` server-side: `colaborador_id` do escopo deve bater com `colaboradores.user_id = session.userId`.
4. Determinar `competencia_ano/mes` quando aplicável (`folha_mensal` → do próprio registro; `ferias_*` → do `data_inicio`; `decimo_*` → do `ano`).
5. Reaproveitar lógica existente de upload no bucket (`colaboradores_nf_anexos`) + sanitização de nome + size limit.
6. `INSERT ... ON CONFLICT (tenant_id, colaborador_id, escopo_tipo, escopo_id) DO UPDATE` pra sobrescrever (remove arquivo antigo primeiro).
7. `logAuditEvent` com `acao='nf_anexada'`, metadata `{ escopo_tipo, escopo_id }`.

`removerNfPorEscopo` idem com valores inversos; audit `acao='nf_removida'`.

- [ ] **Step 5: Rodar testes — devem PASSAR**

- [ ] **Step 6: Atualizar consumidores identificados no Step 1**

Trocar chamadas de `anexarNfDoMes(...)` por `anexarNfPorEscopo({ escopoTipo: "folha_mensal", escopoId: folhaId, file })` nos arquivos listados. Se o call-site não tem `folhaId` (ex: card atual não sabe), passar via prop desde o server component que já tem.

- [ ] **Step 7: `npm run typecheck`**

- [ ] **Step 8: Commit**

```bash
git add lib/nf/anexos-actions.ts lib/nf/anexos-actions.test.ts
git commit -m "feat(nf): server action generalizada de upload por escopo"
```

---

## Task 4: Novo trigger de aprovação de férias + reset de teste

**Files:**
- Create: `supabase/migrations/20261026100003_ferias_aguardando_financeiro_e_reset.sql`

**Interfaces:**
- Produces:
  - trigger de aprovação de férias no RH não cria mais `conta_avulsa`; move linha pra `aguardando_financeiro`
  - cálculo dos campos `valor_ferias/valor_um_terco/valor_abono/valor_total` continua acontecendo (só muda o alvo do status)
  - função nova `fn_aprovar_ferias_rh(lancamento_id uuid)` chamada pela server action do RH (substituir o fluxo atual)
  - reset dos lançamentos de teste existentes (status volta pra `pendente_aprovacao`; `conta_avulsa_id` zerado; `contas_avulsas` órfãs apagadas)

- [ ] **Step 1: Ler estado pelo MCP**

`execute_sql`:
- `select id, status, conta_avulsa_id, aprovado_em from colaboradores_ferias_lancamentos where conta_avulsa_id is not null`
- `select ca.id, ca.status, ca.descricao from contas_avulsas ca join colaboradores_ferias_lancamentos l on l.conta_avulsa_id = ca.id`

Listar quantas linhas serão afetadas pelo reset. Confirmar que são de fato só testes (checando contra o aviso do dono).

- [ ] **Step 2: Escrever a migration**

Arquivo `20261026100003_ferias_aguardando_financeiro_e_reset.sql`:

```sql
-- Mudança de fluxo: aprovação de férias/abono pelo RH deixa de criar
-- conta_avulsa direto. Agora para em 'aguardando_financeiro' e o financeiro
-- aprova com NF anexada (ver docs/superpowers/specs/2026-10-26-...).
-- Também reseta lançamentos de teste existentes (confirmado com o dono que
-- nenhum é dado real).
```

Blocos:

1. Função `fn_aprovar_ferias_rh(p_lancamento_id uuid, p_aprovador uuid)`:
   - Carrega lançamento.
   - Chama `fn_calcular_valores_ferias(lançamento)` — se função não existir, replica inline (hoje em S7 do plano de férias; se não implementada, implementar aqui).
   - Atualiza status pra `aguardando_financeiro`, preenche valores calculados, `aprovado_em=null`, `aprovado_por=null`.
   - NÃO cria `conta_avulsa` (removido do fluxo).
   - Retorna `void`.
2. Função `fn_aprovar_ferias_financeiro(p_lancamento_id uuid, p_linha_tipo nf_anexo_escopo, p_valor_aprovado numeric, p_aprovador uuid)`:
   - Valida que `p_linha_tipo` é `ferias_usufruto` ou `ferias_abono`.
   - Valida NF anexada pro `(p_lancamento_id, p_linha_tipo)`.
   - Cria `conta_avulsa` com valor = `p_valor_aprovado`, categoria/subcategoria correspondente a férias/abono.
   - Em `abono_combinado`: aprova só a linha correspondente (não finaliza as duas de uma vez). Status do lançamento vai pra `aprovado` quando as duas linhas tiverem conta criada; enquanto só uma, segue `aguardando_financeiro`.
3. Reset:
```sql
-- Apaga contas_avulsas órfãs de férias
DELETE FROM contas_avulsas
 WHERE id IN (
   SELECT conta_avulsa_id FROM colaboradores_ferias_lancamentos
    WHERE conta_avulsa_id IS NOT NULL
 );
UPDATE colaboradores_ferias_lancamentos
   SET conta_avulsa_id = NULL,
       aprovado_em = NULL,
       aprovado_por = NULL,
       status = 'pendente_aprovacao'
 WHERE status IN ('aprovado', 'em_analise', 'aguardando_financeiro')
   AND status <> 'concluido';
```

4. `GRANT EXECUTE ON FUNCTION ... TO authenticated` nas duas funções.

- [ ] **Step 3: Aplicar + conferir pelo MCP**

Após `apply_migration`:
- `execute_sql select count(*) from contas_avulsas ca join colaboradores_ferias_lancamentos l on ca.id = l.conta_avulsa_id` → 0
- `execute_sql select status, count(*) from colaboradores_ferias_lancamentos group by 1` → nenhum em `aprovado`/`aguardando_financeiro`
- `execute_sql \df fn_aprovar_ferias_rh` → confirma função existente
- `execute_sql \df fn_aprovar_ferias_financeiro` → idem

- [ ] **Step 4: Teste SQL — aprovação do RH não cria conta**

Via MCP numa transação com ROLLBACK:
1. Criar lançamento fake em `pendente_aprovacao`.
2. Chamar `select fn_aprovar_ferias_rh(<id>, <user_id>)`.
3. Verificar status = `aguardando_financeiro`, valores preenchidos, `conta_avulsa_id IS NULL`.
4. ROLLBACK.

Documentar no PR.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261026100003_ferias_aguardando_financeiro_e_reset.sql
git commit -m "feat(ferias): rh aprova parando em aguardando_financeiro + reset dos testes"
```

---

## Task 5: Server action `aprovarFeriasFinanceiro` + abono combinado com 2 contas

**Files:**
- Create: `lib/financeiro/aprovar-ferias.ts`
- Create: `lib/financeiro/aprovar-ferias.test.ts`
- Create: `app/(app)/financeiro/contas-a-pagar/actions-people.ts`
- Create: `app/(app)/financeiro/contas-a-pagar/actions-people.test.ts`

**Interfaces:**
- Consumes: `fn_aprovar_ferias_financeiro` (Task 4), `anexarNfPorEscopo` (Task 3), tipos de Task 2
- Produces:
  - `calcularContasDoLancamento(lancamento): Array<{ linha_tipo: 'ferias_usufruto' | 'ferias_abono'; valor: number }>` — puro, 1 ou 2 elementos
  - `aprovarFeriasFinanceiro({ lancamentoId, linhaTipo, valorAprovado }): Promise<ActionResult<{ contaAvulsaId: string }>>`
  - stub `aprovarDecimoTerceiroFinanceiro({ linhaId, parcela, valorAprovado }): Promise<ActionResult>` — retorna `ok: false, message: "13° ainda não disponível"`; teste `.skip`

- [ ] **Step 1: Teste puro de `calcularContasDoLancamento`**

```ts
test("usufruto: 1 conta com valor_ferias + valor_um_terco", () => {
  const res = calcularContasDoLancamento({
    tipo: "usufruto",
    valor_ferias: 3000, valor_um_terco: 1000, valor_abono: 0,
  });
  assert.deepEqual(res, [{ linha_tipo: "ferias_usufruto", valor: 4000 }]);
});

test("abono_avulso: 1 conta com valor_abono", () => { ... });
test("abono_combinado: 2 contas separadas", () => {
  const res = calcularContasDoLancamento({
    tipo: "abono_combinado",
    valor_ferias: 2000, valor_um_terco: 666.67, valor_abono: 1000,
  });
  assert.deepEqual(res, [
    { linha_tipo: "ferias_usufruto", valor: 2666.67 },
    { linha_tipo: "ferias_abono", valor: 1000 },
  ]);
});
```

- [ ] **Step 2: Implementar `calcularContasDoLancamento`**

Switch por `tipo`. Puro.

- [ ] **Step 3: Teste de `aprovarFeriasFinanceiro`**

Em `actions-people.test.ts`:
```ts
test("recusa sem NF anexada", async () => {
  // setup: lançamento em aguardando_financeiro sem NF; sessão financeiro
  // esperado: ok:false, message /nf/i
});

test("aprova usufruto, cria 1 conta_avulsa, muda status pra aprovado", async () => { ... });

test("aprova 1 linha de abono_combinado, cria 1 conta; status segue aguardando_financeiro", async () => { ... });

test("aprova a 2a linha de abono_combinado, cria 2a conta, status vai pra aprovado", async () => { ... });

test("recusa quando chamada por não-financeiro", async () => { ... });
```

- [ ] **Step 4: Rodar teste → FAIL**

- [ ] **Step 5: Implementar `aprovarFeriasFinanceiro` em `actions-people.ts`**

Assinatura:
```ts
export async function aprovarFeriasFinanceiro(input: {
  lancamentoId: string;
  linhaTipo: "ferias_usufruto" | "ferias_abono";
  valorAprovado: number;
}): Promise<ActionResult<{ contaAvulsaId: string }>>
```

Passos no corpo:
1. `requireSession()` + `checarPermissao(session, "financeiro.aprovar")`.
2. Query `vw_people_aprovar_financeiro` por `(escopo_tipo=linhaTipo, escopo_id=lancamentoId)` pra garantir `nf_anexada=true` e extrair `valor_original`.
3. Chamar RPC `fn_aprovar_ferias_financeiro(lancamentoId, linhaTipo, valorAprovado, session.userId)`.
4. `logAuditEvent` com `metadata: { valor_original, valor_aprovado, nf_anexo_id }`.
5. `revalidatePath('/financeiro/contas-a-pagar')` + `revalidatePath('/perfil')`.

Stub `aprovarDecimoTerceiroFinanceiro`: só retorna `{ ok: false, message: "Aprovação de 13° ainda não implementada" }`. Teste `.skip` documentando.

- [ ] **Step 6: Rodar teste → PASS**

- [ ] **Step 7: Commit**

```bash
git add lib/financeiro/aprovar-ferias.ts lib/financeiro/aprovar-ferias.test.ts app/\(app\)/financeiro/contas-a-pagar/actions-people.ts app/\(app\)/financeiro/contas-a-pagar/actions-people.test.ts
git commit -m "feat(financeiro): aprovarFeriasFinanceiro com NF obrigatoria + abono combinado = 2 contas"
```

---

## Task 6: Trava NF em `aprovarLinhaFolha` + edição de valor

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-folhas.ts`

**Interfaces:**
- Consumes: trigger de validação + unique parcial (Task 1); `vw_people_aprovar_financeiro` (Task 2)
- Produces: `aprovarLinhaFolha` passa a validar NF anexada antes do RPC `criar_conta_avulsa`; aceita `valorAprovado` opcional que sobrescreve `salario_base`

- [ ] **Step 1: Teste — aprovar sem NF retorna erro**

Em um `actions-folhas.test.ts` novo (ou arquivo existente — grep antes):
```ts
test("aprovarLinhaFolha com linha PJ sem NF retorna erro", async () => {
  // setup: folha pj enviada sem anexo
  // esperado: ok:false, message /nf/i
});

test("aprovarLinhaFolha com linha CLT contabilidade sem NF segue", async () => {
  // setup: folha clt origem=contabilidade sem anexo
  // esperado: ok:true (CLT não exige NF)
});

test("aprovarLinhaFolha aceita valor editado; audit registra original e aprovado", async () => {
  // setup: folha pj com NF; chamar com valorAprovado = salario_base + 1
  // esperado: ok:true; conta_avulsa criada com valorAprovado; audit tem valor_original + valor_aprovado
});
```

- [ ] **Step 2: Rodar → FAIL**

- [ ] **Step 3: Modificar `aprovarLinhaFolha`**

Antes do `criar_conta_avulsa`:
1. Determinar se exige NF: `origem='california'` **e** `tipo_contratacao in ('pj','mei','clt_recibo')`.
2. Se exige: query `colaboradores_nf_anexos where escopo_tipo='folha_mensal' and escopo_id=folhaId` → se zero rows, retornar `{ ok: false, message: "Anexe a NF antes de aprovar." }`.
3. Aceitar `valorAprovado` opcional no input. Se vier, usar nele; senão, usar `salario_base`.
4. Audit: `metadata: { valor_original: salario_base, valor_aprovado: valorFinal, nf_anexo_id }`.

- [ ] **Step 4: Rodar → PASS**

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/actions-folhas.ts app/\(app\)/financeiro/contas-a-pagar/actions-folhas.test.ts
git commit -m "feat(financeiro): aprovarLinhaFolha exige NF em PJ e aceita valor editado"
```

---

## Task 7: Quadro de NF no perfil

**Files:**
- Create: `app/(app)/perfil/_components/quadro-nf.tsx`
- Create: `app/(app)/perfil/_components/quadro-nf-linha.tsx`
- Modify: `app/(app)/perfil/page.tsx`
- Delete: `app/(app)/perfil/_components/card-nf-mes.tsx`

**Interfaces:**
- Consumes: `vw_nf_pendentes_colaborador` (Task 2), `anexarNfPorEscopo` + `removerNfPorEscopo` (Task 3)
- Produces: componente `<QuadroNf colaboradorId tipoContratacao linhas={NfPendenteQuadro[]} />` que renderiza uma linha por item

- [ ] **Step 1: Component `quadro-nf-linha.tsx`**

Server component que recebe `linha: NfPendenteQuadro` e renderiza:
- Ícone + badge do tipo (reutilizar paleta: folha=azul, férias=verde, abono=amarelo, 13°=roxo)
- Label (direto do campo `label`)
- Valor formatado (quando não null)
- Status: `nf_anexada` → badge "NF anexada" verde + nome do arquivo + "Substituir"; senão → botão "Anexar NF" + badge "No prazo"/"Em atraso" (comparar `prazo_anexo` com hoje)

- [ ] **Step 2: Component `quadro-nf.tsx`**

Server component que recebe:
- `colaboradorId: string`
- `tipoContratacao: TipoContratacao`
- `linhas: NfPendenteQuadro[]`

Guard: se `tipoContratacao` não em `('pj','mei','clt_recibo')`, retorna `null`.
Senão: título "Quadro de NFs" + lista de `<QuadroNfLinha />` + empty state `"Nenhuma NF pendente no momento."` + link "Histórico" (reutiliza o modal já existente).

- [ ] **Step 3: Modificar `perfil/page.tsx`**

- Trocar query da `colaboradores_nf_anexos` por `vw_nf_pendentes_colaborador` filtrada por `colaborador_id`.
- Trocar `<CardNfMes />` por `<QuadroNf linhas={linhasData} ... />`.
- Deletar imports obsoletos.

- [ ] **Step 4: Deletar `card-nf-mes.tsx`**

`git rm`. Confirmar que nenhum outro consumidor usa (grep rápido).

- [ ] **Step 5: Validação manual na UI**

Rodar `npm run dev`, abrir `/perfil` como colaborador PJ:
- Mês vigente tem linha de folha.
- Se existe lançamento de férias em `aguardando_financeiro`, aparece linha de férias.
- Clicar "Anexar NF" + upload: linha vira "NF anexada".
- Clicar "Substituir": sobrescreve.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/perfil/_components/quadro-nf.tsx app/\(app\)/perfil/_components/quadro-nf-linha.tsx app/\(app\)/perfil/page.tsx
git rm app/\(app\)/perfil/_components/card-nf-mes.tsx
git commit -m "feat(perfil): card de NF do mes vira quadro multi-evento"
```

---

## Task 8: Aba "People" no financeiro + drawer com edição de valor

**Files:**
- Create: `app/(app)/financeiro/contas-a-pagar/people-list.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/revisar-folha-drawer.tsx`
- Delete: `app/(app)/financeiro/contas-a-pagar/folhas-pagar-list.tsx`

**Interfaces:**
- Consumes: `vw_people_aprovar_financeiro` (Task 2), `aprovarLinhaFolha` + `aprovarFeriasFinanceiro` + stub `aprovarDecimoTerceiroFinanceiro`
- Produces: aba "People" na página de contas a pagar, substitui "Folhas de Pagamento"; drawer unificado por tipo

- [ ] **Step 1: Component `people-list.tsx`**

Server component. Recebe `tenantId: string | null` (null = todas as empresas). Carrega da view. Colunas da tabela:
- Badge do tipo (reutilizar paleta de Task 7)
- Competência (ou período)
- Colaborador
- Função
- Tipo contratação (badge pequeno)
- Origem (só pra folha)
- Alocação (quando aplicável)
- Badge NF: "Anexada"/"Pendente"
- Valor
- Botão "Revisar" (abre o drawer)

Botão desabilitado quando `nf_anexada=false` + tooltip "Aguardando o colaborador anexar a NF.".

- [ ] **Step 2: Modificar `page.tsx`**

- Renomear tab de `"Folhas de Pagamento"` pra `"People"`.
- Trocar `<FolhasPagarList />` por `<PeopleList />`.
- Contador do tab vem do `count(*)` da view (não só folhas_pagamento).

- [ ] **Step 3: Modificar `revisar-folha-drawer.tsx`**

Aceitar prop nova `tipo: NfAnexoEscopo` + `valorOriginal: number`.
- Campo de valor passa a ser editável (input mascarado). Default = `valorOriginal`.
- Submit chama ação correta por tipo:
  - `folha_mensal` → `aprovarLinhaFolha({ ..., valorAprovado })`
  - `ferias_usufruto` ou `ferias_abono` → `aprovarFeriasFinanceiro({ lancamentoId, linhaTipo, valorAprovado })`
  - `decimo_terceiro_p*` → `aprovarDecimoTerceiroFinanceiro({...})` (stub mostra toast "ainda não disponível")

Preserva seção de PIX/TED e seção de alocação como estão hoje; só mostra pra `folha_mensal` (férias/abono não têm alocação por regional).

- [ ] **Step 4: Deletar `folhas-pagar-list.tsx`**

`git rm`. Confirmar nenhum outro consumidor.

- [ ] **Step 5: Validação manual na UI**

- Aba People lista folha mensal + lançamentos de férias em `aguardando_financeiro`.
- Linha sem NF: botão desabilitado + tooltip.
- Linha com NF: botão habilita → drawer abre com tipo correto.
- Editar valor + aprovar → cria `conta_avulsa` com valor editado; audit grava os dois.
- Abono combinado: aparece como 2 linhas; aprovar uma não afeta a outra.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/people-list.tsx app/\(app\)/financeiro/contas-a-pagar/page.tsx app/\(app\)/financeiro/contas-a-pagar/revisar-folha-drawer.tsx
git rm app/\(app\)/financeiro/contas-a-pagar/folhas-pagar-list.tsx
git commit -m "feat(financeiro): aba People substitui Folhas de Pagamento com trava de NF"
```

---

## Encerramento

- [ ] **Rodar `npm run lint && npm run typecheck && npm test` numa só sequência.** Esperado: tudo verde.
- [ ] **Smoke manual nos dois cenários críticos:**
  1. Colaborador PJ anexa NF da folha mensal + do abono avulso → aba People habilita os dois botões.
  2. Financeiro aprova folha mensal com valor editado → `conta_avulsa` tem valor novo; audit registra original + aprovado + nf_anexo_id.
- [ ] **Atualizar `docs/HANDOFF.md`** apontando pro commit final + próximos passos (13° real + rescisão).
