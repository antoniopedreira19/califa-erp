# Alocação multi-empresa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um colaborador tenha 1+ empresas no pacote vigente de alocação, cada uma com sua divisão regional, mantendo a UX simples quando é 1 empresa só.

**Architecture:** 2 tabelas novas (`colaboradores_alocacoes_itens` e `colaboradores_alocacoes_itens_regionais`) formam a hierarquia abaixo de `colaboradores_alocacoes` (pacote). Triggers garantem `SUM(%) = 100` nas 2 camadas. Toda troca de alocação roda via RPC transacional. Consumers (RPC de geração de folha, actions de CRUD, UI) migram pra ler a nova estrutura. Backfill preserva os pacotes atuais criando 1 item (100%) + 1 regional (100%).

**Tech Stack:** Supabase Postgres + RLS, Next.js App Router + Server Actions, Tailwind + shadcn/ui, Radix (Dialog), node --test + tsx (helpers puros).

**Spec:** `docs/superpowers/specs/2026-10-28-alocacao-multi-empresa-design.md`

## Global Constraints

- `tenant_id uuid NOT NULL` em toda tabela nova; RLS habilitado; policies usam `(select auth.uid())`.
- GRANT explícito das novas tabelas pra `authenticated`; nada pra `anon`.
- Todas as queries de leitura em pacote vigente filtram `data_fim IS NULL`.
- Strings visíveis ao usuário em pt-BR com acento (CLAUDE.md: "Ortografia em português").
- Nenhum PII em migrations ou fixtures (CLAUDE.md: "Dados pessoais nunca entram no repo").
- `lib/types.ts` escrito à mão — toda migration que mexe em coluna usada no frontend atualiza o tipo correspondente no mesmo commit.
- `force-dynamic` e `prefetch={false}` nos lists afetados (CLAUDE.md: "Performance é feature").

## Review Focus

Casos que o spec implica mas que nenhuma task exercita por nome; cada um ganha teste na task que possui o código:

1. **Pacote salvo com soma de empresa = 99,99 (float rounding)** — trigger deve aceitar? Hoje a resposta correta é NÃO (bloqueia); o teste pin fica em Task 1 (`enforce_alocacao_itens_soma_100_bloqueia_9999`).
2. **Trocar pacote com erro no 2º item (ex: regional de outra empresa)** — a transação toda tem que ser revertida; teste pin fica em Task 4 (`trocar_pacote_falha_atomic_sem_criar_meio_pacote`).
3. **Backfill de colaborador com alocação vigente que tem regional_id = null e usa_rateio_empresa = false** — estado inválido no modelo antigo (não deveria existir mas pode ter) — teste pin em Task 2 (`backfill_pula_alocacao_vigente_sem_regional_e_sem_rateio_com_warning`).
4. **UI do modal com 2 empresas e usuário remove uma deixando a outra em 60%** — soma deve mostrar vermelho e desabilitar salvar; teste pin em Task 6 (`modal_remove_empresa_deixa_soma_lt_100_desabilita_salvar`).
5. **RPC `gerar_folha_da_competencia` com pacote de 2 empresas, uma com rateio padrão e outra explícita** — resultado deve ter N linhas (N = regionais da 1ª via rateio + regionais da 2ª explícitas) com percentuais multiplicados; teste pin em Task 7 (`gerar_folha_pacote_misto_distribui_em_n_linhas_com_pct_multiplicado`).

---

## File Structure

**Novo:**
- `supabase/migrations/20261028100001_alocacao_itens_tabelas.sql` — schema das 2 tabelas + RLS + GRANT + indices + triggers
- `supabase/migrations/20261028100002_alocacao_backfill.sql` — backfill dos pacotes atuais
- `supabase/migrations/20261028100003_alocacao_rpc_trocar_pacote.sql` — RPC transacional `trocar_pacote_alocacao`
- `supabase/migrations/20261028100004_alocacao_rpc_gerar_folha_v2.sql` — nova versão de `gerar_folha_da_competencia` lendo pacote hierárquico
- `lib/alocacao/montar-snapshot.ts` + `.test.ts` — helper puro: lê 3 tabelas → monta snapshot do pacote
- `lib/alocacao/validar-input-pacote.ts` + `.test.ts` — helper puro: valida input do modal (soma, regionais da empresa, etc)
- `app/(app)/rh/colaboradores/[id]/modal-alterar-alocacao.tsx` — modal novo (substitui o atual)
- `app/(app)/rh/colaboradores/[id]/card-alocacao.tsx` — card renderizado em perfil e detalhe

**Modificado:**
- `lib/types.ts` — adiciona `ColaboradorAlocacaoItem`, `ColaboradorAlocacaoItemRegional`, `AlocacaoVigenteSnapshot`; mantém `ColaboradorAlocacao` sem campos removidos (empresa_id/regional_id/usa_rateio_empresa continuam opcionais pros consumers legados até Task 8)
- `app/(app)/rh/colaboradores/[id]/actions-alocacao.ts` — `alterarAlocacao` passa a chamar RPC `trocar_pacote_alocacao`; input muda de 1 empresa pra lista de itens
- `app/(app)/perfil/page.tsx` — query de alocação usa snapshot novo
- `app/(app)/rh/colaboradores/[id]/page.tsx` — idem
- `app/(app)/rh/colaboradores/page.tsx` — lista: badge resumido ("California + Hitlab")
- `app/(app)/rh/folhas/importar-actions.ts:359` — snapshot pra criar `folhas_pagamento_alocacoes` ao importar CLT
- `app/(app)/rh/decimo-terceiro/actions.ts:167, 1042` — lê snapshot
- `app/(app)/rh/contratacoes/actions.ts:488` — cria pacote inicial via nova RPC
- `app/(app)/rh/colaboradores/actions.ts:144` — idem

---

## Task 1: Schema novo + triggers + types

**Files:**
- Create: `supabase/migrations/20261028100001_alocacao_itens_tabelas.sql`
- Modify: `lib/types.ts`
- Test: queries de verificação via MCP (inline no step de verificação)

**Interfaces:**
- Consumes: nada
- Produces: tabelas `colaboradores_alocacoes_itens` e `colaboradores_alocacoes_itens_regionais`; triggers `enforce_alocacao_itens_soma_100` e `enforce_alocacao_item_regionais_soma_100`; tipos TS `ColaboradorAlocacaoItem`, `ColaboradorAlocacaoItemRegional`.

- [ ] **Step 1: Escrever migration com DDL das 2 tabelas**

Conteúdo:
- `colaboradores_alocacoes_itens`: colunas `id uuid PK default gen_random_uuid()`, `tenant_id`, `alocacao_id FK → colaboradores_alocacoes(id) ON DELETE CASCADE`, `empresa_id`, `percentual_empresa numeric(5,2) NOT NULL CHECK (percentual_empresa > 0 AND percentual_empresa <= 100)`, `usa_rateio_empresa boolean NOT NULL DEFAULT false`, `created_at timestamptz NOT NULL DEFAULT now()`.
- `colaboradores_alocacoes_itens_regionais`: `id`, `tenant_id`, `alocacao_item_id FK → colaboradores_alocacoes_itens(id) ON DELETE CASCADE`, `regional_id`, `percentual_regional numeric(5,2) NOT NULL CHECK (percentual_regional > 0 AND percentual_regional <= 100)`, `created_at`.
- UNIQUE `(alocacao_id, empresa_id)` e `(alocacao_item_id, regional_id)`.
- Índices: `(alocacao_id)`, `(empresa_id)`, `(alocacao_item_id)`, `(regional_id)`, `(tenant_id)`.
- RLS habilitada; policies por tenant usando `(select auth.uid())` baseadas em `is_tenant_member`.
- GRANT SELECT/INSERT/UPDATE/DELETE ON ambas pra `authenticated`.

- [ ] **Step 2: Escrever triggers de validação de soma**

Função `enforce_alocacao_itens_soma_100() RETURNS trigger` que roda `AFTER INSERT OR UPDATE OR DELETE` em `colaboradores_alocacoes_itens` e dispara se `SUM(percentual_empresa) WHERE alocacao_id = NEW.alocacao_id` != 100.

Função `enforce_alocacao_item_regionais_soma_100()` análoga em `colaboradores_alocacoes_itens_regionais`, considerando: ignora quando o item pai tem `usa_rateio_empresa = true` (lista vazia é válida); dispara se false e `SUM(percentual_regional) WHERE alocacao_item_id = NEW.alocacao_item_id` != 100.

Função `enforce_alocacao_item_regional_vazia_quando_rateio() RETURNS trigger` em `colaboradores_alocacoes_itens_regionais BEFORE INSERT` que bloqueia inserção se o item pai tem `usa_rateio_empresa = true`.

- [ ] **Step 3: Aplicar migration via MCP e verificar**

Rodar `mcp__supabase-write__apply_migration` com o SQL. Depois:
```sql
select tablename from pg_tables where tablename like 'colaboradores_alocacoes_itens%';
select tgname from pg_trigger where tgrelid in ('public.colaboradores_alocacoes_itens'::regclass, 'public.colaboradores_alocacoes_itens_regionais'::regclass) and not tgisinternal;
```
Expected: 2 tabelas, 3+ triggers.

- [ ] **Step 4: Verificar guard-rails via SQL de insert deliberadamente errado**

Rodar um teste real:
```sql
-- Cria pacote mock, tenta item com 99.99: deve falhar após DEFERRED check
begin;
insert into colaboradores_alocacoes_itens (tenant_id, alocacao_id, empresa_id, percentual_empresa, usa_rateio_empresa)
values ('<tenant>', '<existente>', '<empresa>', 99.99, true);
rollback;
```
Expected: ERROR `enforce_alocacao_itens_soma_100 ... != 100`. Confirma o teste de review focus #1.

- [ ] **Step 5: Atualizar `lib/types.ts`**

```ts
export type ColaboradorAlocacaoItem = {
  id: string;
  tenant_id: string;
  alocacao_id: string;
  empresa_id: string;
  percentual_empresa: number;
  usa_rateio_empresa: boolean;
  created_at: string;
};

export type ColaboradorAlocacaoItemRegional = {
  id: string;
  tenant_id: string;
  alocacao_item_id: string;
  regional_id: string;
  percentual_regional: number;
  created_at: string;
};

export type AlocacaoVigenteSnapshot = {
  pacote: ColaboradorAlocacao;
  itens: Array<ColaboradorAlocacaoItem & {
    empresa_nome: string;
    regionais: Array<ColaboradorAlocacaoItemRegional & { regional_nome: string }>;
  }>;
};
```

- [ ] **Step 6: Rodar typecheck**

`npm run typecheck` — Expected: 0 erros.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261028100001_alocacao_itens_tabelas.sql lib/types.ts
git commit -m "feat(alocacao): schema itens/regionais + triggers soma 100"
```

---

## Task 2: Backfill — pacotes atuais ganham itens e regionais

**Files:**
- Create: `supabase/migrations/20261028100002_alocacao_backfill.sql`

**Interfaces:**
- Consumes: tabelas da Task 1
- Produces: nada em código; apenas dados backfilled

- [ ] **Step 1: Escrever migration de backfill**

Pra cada linha em `colaboradores_alocacoes` que tenha `empresa_id IS NOT NULL`:
- INSERT em `colaboradores_alocacoes_itens` com `alocacao_id = linha.id`, `empresa_id = linha.empresa_id`, `percentual_empresa = 100`, `usa_rateio_empresa = linha.usa_rateio_empresa`.
- Se `linha.regional_id IS NOT NULL` E `linha.usa_rateio_empresa = false`: INSERT em `colaboradores_alocacoes_itens_regionais` com `alocacao_item_id = <id do item acima>`, `regional_id = linha.regional_id`, `percentual_regional = 100`.
- Linhas com `usa_rateio_empresa = true` ficam sem registros em `_itens_regionais` (a geração da folha vai expandir via `empresas_rateios_regionais`).

Usar `WITH itens_inseridos AS (INSERT ... RETURNING id, alocacao_id)` pra reaproveitar o id do item na inserção da regional.

- [ ] **Step 2: Count pré-aplicação pra validar depois**

Antes de aplicar: `select count(*) from colaboradores_alocacoes where empresa_id is not null;` → anota N.
`select count(*) from colaboradores_alocacoes where empresa_id is not null and regional_id is not null and usa_rateio_empresa = false;` → anota M.

- [ ] **Step 3: Aplicar migration via MCP**

- [ ] **Step 4: Verificar via SQL**

```sql
select count(*) from colaboradores_alocacoes_itens;  -- deve ser N
select count(*) from colaboradores_alocacoes_itens_regionais;  -- deve ser M
-- Verificar invariantes:
select alocacao_id, sum(percentual_empresa)
from colaboradores_alocacoes_itens
group by alocacao_id having sum(percentual_empresa) != 100;  -- deve ser vazio
```

Pin de review focus #3: `select id, colaborador_id from colaboradores_alocacoes where data_fim is null and empresa_id is not null and regional_id is null and usa_rateio_empresa = false;` — se existir, loga warning no commit message.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261028100002_alocacao_backfill.sql
git commit -m "feat(alocacao): backfill pacotes atuais em itens+regionais"
```

---

## Task 3: Lib pura — snapshot vigente + validação de input

**Files:**
- Create: `lib/alocacao/montar-snapshot.ts`
- Create: `lib/alocacao/montar-snapshot.test.ts`
- Create: `lib/alocacao/validar-input-pacote.ts`
- Create: `lib/alocacao/validar-input-pacote.test.ts`

**Interfaces:**
- Consumes: tipos da Task 1
- Produces:
  - `montarSnapshot(rows: { pacote, itens, regionais }): AlocacaoVigenteSnapshot | null`
  - `validarInputPacote(input: InputPacote): { ok: true } | { ok: false; erros: string[] }` onde `InputPacote = { itens: Array<{ empresa_id, percentual_empresa, usa_rateio_empresa, regionais: Array<{ regional_id, percentual_regional }> }> }`

- [ ] **Step 1: Escrever testes de `montarSnapshot`**

Casos:
- `pacote null → snapshot null`
- `pacote + 1 item + 1 regional → snapshot com itens[0].regionais[0]`
- `pacote + 2 itens, cada um com 2 regionais → snapshot com 2 itens, cada um 2 regionais`
- `pacote + 1 item usa_rateio_empresa=true + 0 regionais → snapshot com item.regionais = []`

- [ ] **Step 2: Rodar testes (RED)**

`npx tsx --test lib/alocacao/montar-snapshot.test.ts` — Expected: FAIL (função não existe).

- [ ] **Step 3: Implementar `montarSnapshot`**

Função pura: agrupa linhas vindas da query (pacote + itens + regionais) montando a estrutura aninhada. Sem I/O.

- [ ] **Step 4: Rodar testes (GREEN)**

Expected: PASS.

- [ ] **Step 5: Escrever testes de `validarInputPacote`**

Casos:
- `itens vazios → ok=false, erro "pelo menos uma empresa"`
- `soma % empresa = 100 com 1 item → ok=true`
- `soma % empresa = 99.99 → ok=false, erro "soma 100"`
- `item com usa_rateio_empresa=true e lista de regionais não vazia → ok=false`
- `item com usa_rateio_empresa=false, 2 regionais somando 100 → ok=true`
- `item com usa_rateio_empresa=false, 2 regionais somando 99 → ok=false`
- `mesma empresa 2x no mesmo pacote → ok=false, erro "empresa duplicada"`

- [ ] **Step 6: RED → implementar → GREEN**

- [ ] **Step 7: Commit**

```bash
git add lib/alocacao/
git commit -m "feat(alocacao): helpers puros montar-snapshot + validar-input"
```

---

## Task 4: RPC `trocar_pacote_alocacao` + action nova

**Files:**
- Create: `supabase/migrations/20261028100003_alocacao_rpc_trocar_pacote.sql`
- Modify: `app/(app)/rh/colaboradores/[id]/actions-alocacao.ts`

**Interfaces:**
- Consumes: tabelas da Task 1, helpers da Task 3
- Produces:
  - RPC `trocar_pacote_alocacao(p_tenant_id uuid, p_colaborador_id uuid, p_data_mudanca date, p_motivo text, p_itens jsonb) RETURNS uuid` (id do pacote novo)
  - Action `trocarPacoteAlocacao(colaboradorId: string, input: { data_mudanca, motivo, itens: InputItem[] }): Promise<ActionResult<{ id: string }>>`

- [ ] **Step 1: Escrever RPC transacional**

Em plpgsql:
1. Localiza vigente (`data_fim IS NULL`) → se existir, define `data_fim = p_data_mudanca - 1 day`.
2. Cria novo pacote com `data_inicio = p_data_mudanca`.
3. Pra cada item do jsonb: INSERT item + INSERT regionais filhas.
4. Validações: formato jsonb; empresa existe; regional pertence a empresa; soma 100.
5. Retorna id do pacote novo.
6. Em caso de erro, rollback automático (plpgsql).

GRANT EXECUTE pra `authenticated`.

- [ ] **Step 2: Aplicar e testar via SQL**

```sql
-- Cria pacote válido pra colaborador de teste; verifica que vigente anterior fechou.
select trocar_pacote_alocacao('<tenant>', '<colab>', '2026-11-01', 'teste', '[{"empresa_id":"...","percentual_empresa":100,"usa_rateio_empresa":true,"regionais":[]}]'::jsonb);
```
Expected: retorna uuid; `select * from colaboradores_alocacoes where colaborador_id = '<colab>' order by data_inicio desc` mostra vigente novo + anterior com data_fim = 2026-10-31.

Pin de review focus #2: tentar `trocar_pacote` com 2 itens, 2º com regional de outra empresa → RAISE EXCEPTION; `select` depois mostra que vigente anterior continua null (nada foi commitado).

- [ ] **Step 3: Refatorar `alterarAlocacao` em `actions-alocacao.ts`**

Trocar o corpo de `alterarAlocacao` por chamada à RPC. Mudar signature:
```ts
export async function alterarAlocacao(
  colaboradorId: string,
  input: {
    data_mudanca: string;
    motivo?: string | null;
    itens: Array<{
      empresa_id: string;
      percentual_empresa: number;
      usa_rateio_empresa: boolean;
      regionais: Array<{ regional_id: string; percentual_regional: number }>;
    }>;
  },
): Promise<ActionResult<{ id: string }>>
```
Chamar `validarInputPacote` antes da RPC pra dar erro de UI amigável; se passar, chama `supabase.rpc("trocar_pacote_alocacao", ...)`.

- [ ] **Step 4: Rodar typecheck + lint**

`npm run typecheck && npm run lint` — Expected: 0 erros novos.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261028100003_alocacao_rpc_trocar_pacote.sql app/\(app\)/rh/colaboradores/\[id\]/actions-alocacao.ts
git commit -m "feat(alocacao): RPC trocar_pacote + action aceita N itens"
```

---

## Task 5: UI do card — perfil + colaborador detalhe

**Files:**
- Create: `app/(app)/rh/colaboradores/[id]/card-alocacao.tsx`
- Modify: `app/(app)/perfil/page.tsx` (substitui query inline)
- Modify: `app/(app)/rh/colaboradores/[id]/page.tsx` (substitui query inline)

**Interfaces:**
- Consumes: `montarSnapshot` da Task 3
- Produces: componente `<CardAlocacao snapshot={...} onAlterar={() => ...} />` reutilizável

- [ ] **Step 1: Escrever função helper de query `buscarSnapshotVigente`**

Em `lib/alocacao/montar-snapshot.ts`, adicionar função `buscarAlocacaoVigente(supabase, colaboradorId: string): Promise<AlocacaoVigenteSnapshot | null>` que faz 3 queries em paralelo (pacote, itens com empresa_nome via join, regionais com regional_nome via join) e passa pro `montarSnapshot` puro.

- [ ] **Step 2: Criar `card-alocacao.tsx`**

Props: `snapshot: AlocacaoVigenteSnapshot | null`, `permitirAlterar: boolean`, `onAlterar?: () => void`.

Render:
- Se snapshot null: estado vazio "Sem alocação" + botão Alterar.
- Se snapshot com 1 item e `usa_rateio_empresa = true`: linha `"{empresa_nome} · rateio padrão"` (visual atual).
- Se snapshot com 1 item e 1 regional: linha `"{empresa_nome} · {regional_nome}"`.
- Se 2+ itens: lista com indentação; cada item mostra `"{empresa_nome}" + badge "{percentual_empresa}%"`; se `usa_rateio_empresa` → sublinha `"rateio padrão"`; senão → sublista `"{regional_nome} — {percentual_regional}%"`.

Reaproveita classes do card atual (border rose-100, etc).

- [ ] **Step 3: Substituir query em `perfil/page.tsx` e render**

Trocar query atual por `buscarAlocacaoVigente`. Passar snapshot pro `<CardAlocacao />`.

- [ ] **Step 4: Substituir query em `rh/colaboradores/[id]/page.tsx` e render**

Idem.

- [ ] **Step 5: Rodar dev server + verificar visualmente**

`npm run dev` → acessar perfil de colaborador com alocação simples (1 empresa, rateio padrão). Deve aparecer igual hoje. Depois, criar pacote de teste com 2 empresas via RPC e conferir visual.

- [ ] **Step 6: Commit**

```bash
git add lib/alocacao/montar-snapshot.ts app/\(app\)/rh/colaboradores/\[id\]/card-alocacao.tsx app/\(app\)/perfil/page.tsx app/\(app\)/rh/colaboradores/\[id\]/page.tsx
git commit -m "feat(alocacao): card novo consome snapshot vigente (N empresas)"
```

---

## Task 6: UI do modal de edição

**Files:**
- Create: `app/(app)/rh/colaboradores/[id]/modal-alterar-alocacao.tsx`
- Modify: `app/(app)/rh/colaboradores/[id]/page.tsx` (substitui modal antigo pelo novo)

**Interfaces:**
- Consumes: `validarInputPacote` da Task 3, `alterarAlocacao` da Task 4, snapshot atual (opcional, pra inicializar formulário)
- Produces: componente `<ModalAlterarAlocacao />`

- [ ] **Step 1: Escrever componente controlado**

Estado interno: `itens: Array<InputItem>`, `dataMudanca: string`, `motivo: string`.

UI:
- Lista de empresas, cada uma: dropdown empresa (reaproveita componente existente) + input `%` (número 0-100 com 2 decimais) + toggle "usar rateio da empresa".
- Se toggle off: sub-lista de regionais, cada uma com dropdown regional (filtrado pelas regionais da empresa escolhida) + input `%` + botão remover.
- Botão `+ regional` abaixo da sub-lista.
- Botão `+ empresa` abaixo da lista.
- Rodapé: inputs `data_mudanca`, `motivo`, contador "Soma empresas: X%" em verde se 100 ou vermelho se não; análogo pra cada sub-lista.
- Botão "Salvar" desabilitado quando `validarInputPacote(itens)` retorna erro.
- Pin de review focus #4: teste visual — remover empresa deixando outras somando 60 → botão fica desabilitado + rodapé vermelho.

- [ ] **Step 2: Integrar `alterarAlocacao` no submit**

Chamar action, mostrar erros via `fieldErrors`, fechar modal + `router.refresh()` em sucesso.

- [ ] **Step 3: Trocar modal antigo pelo novo em `[id]/page.tsx`**

- [ ] **Step 4: Testar manualmente**

- Trocar alocação do Antonio pra `California 60% rateio padrão + Hitlab 40% com Hitlab Core 100%` via modal.
- Conferir no banco:
```sql
select * from colaboradores_alocacoes where colaborador_id = '<antonio>' order by data_inicio desc;
select * from colaboradores_alocacoes_itens where alocacao_id = '<pacote vigente>';
select * from colaboradores_alocacoes_itens_regionais where alocacao_item_id in (...);
```

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/rh/colaboradores/\[id\]/modal-alterar-alocacao.tsx app/\(app\)/rh/colaboradores/\[id\]/page.tsx
git commit -m "feat(alocacao): modal multi-empresa com validacao soma 100"
```

---

## Task 7: RPC `gerar_folha_da_competencia` v2 + importar-actions

**Files:**
- Create: `supabase/migrations/20261028100004_alocacao_rpc_gerar_folha_v2.sql`
- Modify: `app/(app)/rh/folhas/importar-actions.ts:359-410`

**Interfaces:**
- Consumes: schema da Task 1, dados backfilled da Task 2
- Produces: nova versão da RPC `gerar_folha_da_competencia` que lê pacote hierárquico

- [ ] **Step 1: Reescrever RPC**

Pra cada colaborador elegível:
1. Lê pacote vigente (`WHERE a.data_fim IS NULL`).
2. Se pacote null → pulado_sem_alocacao.
3. Pra cada item (empresa) do pacote:
   - Se `usa_rateio_empresa = true` e empresa não tem rateio no ano → pulado_sem_rateio.
4. Cria folha com `salario_base = r.salario`.
5. Pra cada item, pra cada regional (expandindo via rateio ou lendo explícitas):
   - `percentual_final = item.percentual_empresa * regional_pct / 100` (arredondado 2 casas).
6. INSERT em `folhas_pagamento_alocacoes` com N linhas.
7. Trigger `enforce_folha_alocacao_soma_100` garante consistência final.

Pin de review focus #5: no step 5, se usar rateio e as somas internas da empresa não baterem 100 por rounding, aplicar correção na última linha pra fechar 100.

- [ ] **Step 2: Aplicar + testar**

Gerar folha de dezembro/2026 (vazia hoje) com Antonio em pacote multi-empresa de teste. Verificar:
```sql
select empresa_id, regional_id, percentual
from folhas_pagamento_alocacoes
where folha_id = '<id da folha gerada do antonio>'
order by empresa_id, regional_id;
-- Soma deve ser 100
select sum(percentual) from folhas_pagamento_alocacoes where folha_id = '<id>';
```

- [ ] **Step 3: Adaptar `importar-actions.ts:359-410`**

Trocar a query que lê 1 linha de `colaboradores_alocacoes` por `buscarAlocacaoVigente`. Pra cada item do snapshot, inserir em `folhas_pagamento_alocacoes` com `percentual_final` calculado igual à RPC.

- [ ] **Step 4: Typecheck + lint**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261028100004_alocacao_rpc_gerar_folha_v2.sql app/\(app\)/rh/folhas/importar-actions.ts
git commit -m "feat(alocacao): RPC gerar_folha v2 explode pacote multi-empresa"
```

---

## Task 8: Adaptar demais consumers (13°, contratações, listas)

**Files:**
- Modify: `app/(app)/rh/decimo-terceiro/actions.ts:167, 1042`
- Modify: `app/(app)/rh/contratacoes/actions.ts:488`
- Modify: `app/(app)/rh/colaboradores/actions.ts:144`
- Modify: `app/(app)/rh/colaboradores/page.tsx:105`

**Interfaces:**
- Consumes: `buscarAlocacaoVigente` da Task 5, action `trocarPacoteAlocacao` da Task 4
- Produces: nada novo; apenas migra leituras/escritas

- [ ] **Step 1: 13° — ler snapshot em vez de 1 linha**

Nos 2 pontos de `decimo-terceiro/actions.ts`, trocar a query de `colaboradores_alocacoes` por `buscarAlocacaoVigente` e usar o snapshot pra popular o rateio do 13.

- [ ] **Step 2: Contratações — criar pacote inicial via RPC**

Em `contratacoes/actions.ts:488`, quando a contratação é efetivada e precisa criar alocação inicial, chamar `trocar_pacote_alocacao` com 1 item (empresa escolhida, 100%, rateio padrão).

- [ ] **Step 3: Lista de colaboradores — badge resumido**

Em `colaboradores/page.tsx`, buscar snapshot por colaborador (via join lateral ou query separada); no card da lista, mostrar `"{empresa_1} + {empresa_2} + ..."` ou só `"{empresa_única}"`. Se tiver muitas, `"{empresa_1} + N"`.

- [ ] **Step 4: `colaboradores/actions.ts:144`**

Verificar o uso específico; adaptar se for leitura (usar snapshot) ou escrita (usar RPC).

- [ ] **Step 5: Typecheck + lint + build**

`npm run typecheck && npm run lint && npm run build` — Expected: 0 erros.

- [ ] **Step 6: Testar manualmente**

- Criar contratação nova → confere que pacote vigente nasceu com 1 item 100%.
- Lista `/rh/colaboradores` renderiza badge correto pra multi-empresa.
- Rodar fluxo de 13° (se simulável) pra conferir que ratear funciona.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/rh/decimo-terceiro/actions.ts app/\(app\)/rh/contratacoes/actions.ts app/\(app\)/rh/colaboradores/actions.ts app/\(app\)/rh/colaboradores/page.tsx
git commit -m "feat(alocacao): consumers de leitura e escrita migrados"
```

---

## Self-review notes (fora da execução)

1. **Spec coverage** — cada ponto do spec aponta pra uma task: tabelas (T1), triggers (T1), backfill (T2), card (T5), modal (T6), RPC trocar (T4), RPC gerar (T7), consumers (T8). OK.
2. **Step scan** — todos os steps têm action verificável. OK.
3. **Type consistency** — `AlocacaoVigenteSnapshot` definido em T1 e consumido em T3/T5. `InputItem` definido em T4 (actions-alocacao.ts) e consumido em T6. OK.
4. **Review focus** — 5 pins mapeados pras 5 tasks que possuem os códigos. OK.
5. **Proportion** — plano cerca de 400 linhas pra ~1.500 linhas de código estimadas. OK.
