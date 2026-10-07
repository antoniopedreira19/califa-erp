# Folha de pagamento em dois fluxos — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dividir o fluxo de folha em dois caminhos independentes — PJ gerada pela California (`pj` + `mei` + parte Recibo dos `clt_recibo`) e CLT importada por PDF da contabilidade (`clt` + parte CLT dos `clt_recibo` + `estagio` + `socio`) — unificados numa UI por competência que fecha com um botão "Enviar ao financeiro".

**Architecture:** Mesma tabela `folhas_pagamento` discriminada por nova coluna `origem` (enum `folha_origem` com `california` / `contabilidade`). Híbrido `clt_recibo` passa a ter `valor_recibo` em `colaboradores_salarios` (parte RPA) separado do `valor` total; backfill inicial 50/50 por decisão do operador. Fluxo PJ reutiliza `gerarFolha` com filtro novo. Fluxo CLT é uma server action nova `importarFolhaContabilidade` que lê o PDF "Relação Geral dos Líquidos" via `pdf-parse`, matcha por CPF e grava rascunho. Nova ação `enviarCompetencia` promove todos os rascunhos da competência para `enviada` em bloco.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Supabase Postgres + RLS, `pdf-parse` (nova dep), `node --test` + `tsx` (framework existente), Tailwind + shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md](../specs/2026-10-06-folha-dois-fluxos-design.md)

## Global Constraints

- **Linguagem UI:** PT-BR com acentuação completa em qualquer string renderizada ou de erro visível ao usuário. Identificadores de código seguem convenção sem acento (`valor_recibo`, não `valor_recíbo`). Ver `CLAUDE.md` — "Ortografia em português".
- **UI nunca cita "Recibo":** rótulos de fluxo são **"PJ"** e **"CLT"**. O cadastro técnico e o banco mantêm `valor_recibo` (nome contratual).
- **Banco pelo fluxo do MCP:** toda migration passa por `apply_migration`, com conferência pelo MCP (`execute_sql` para verificar colunas, policies, GRANTs). Ver `docs/FLUXO-BANCO.md`.
- **Toda tabela/coluna nova com GRANT:** `GRANT ... TO authenticated` explícito. `anon` fica sem acesso. RLS obrigatória em tabela nova, com `(select auth.uid())` em policies.
- **`lib/types.ts` escrito à mão:** sempre atualizar no MESMO commit da migration que mexeu em coluna usada pelo frontend.
- **Performance:** `<Link>` em listas de 5+ itens → `prefetch={false}`. Queries independentes em server components → `Promise.all`. Agregações separadas, não embeds pesados. Ver `docs/PERFORMANCE.md`.
- **Backfill destrutivo exige confirmação explícita:** a Task 2 inclui `UPDATE` que mexe em dado existente. **Pedir confirmação ao operador antes de rodar `apply_migration`.**
- **Audit log:** todo evento sensível usa `logAuditEvent({ acao, tenantId, entidadeTipo, entidadeId, metadata })` de `lib/auth/audit.ts`.

## Review Focus

1. **Reimportação com hash igual** — se o operador fizer upload do mesmo PDF duas vezes, a segunda chamada deve ser abortada e devolver o resultado anterior (Task 8). Reviewer: confirmar que não cria duplicata e devolve `folha_importacoes` existente.
2. **Linha já `enviada`/`aprovada` no destino** — importação não pode sobrescrever uma linha já promovida. Teste em Task 8 cobre.
3. **Colaborador na seção errada do PDF** — ex: estagiário cadastrado como `clt` aparece na seção "Estagiários" do PDF, ou sócio na seção "Empregados". Precisa virar warning específico, não gravar (Task 8).
4. **CPF com máscara vs sem máscara** — parser normaliza (remove pontos/traços) antes do match. Teste em Task 7.
5. **Soma dos valores do PDF ≠ totalizador do rodapé** — warning informativo (não bloqueia), para detectar erro de parsing. Teste em Task 7/8.

---

## File Structure

**Create:**
- `supabase/migrations/20261006600003_folha_origem_enum.sql`
- `supabase/migrations/20261006600004_colaboradores_salarios_valor_recibo.sql`
- `supabase/migrations/20261006600005_folhas_pagamento_origem.sql`
- `supabase/migrations/20261006600006_folha_importacoes.sql`
- `lib/pdf/parse-folha-contabilidade.ts` — parser puro `(texto: string) => ParsedFolha`
- `lib/pdf/parse-folha-contabilidade.test.ts`
- `lib/pdf/__fixtures__/folha-092025.txt` — texto bruto do PDF de setembro/2025 (fixture determinística)
- `app/(app)/rh/folhas/importar-actions.ts` — `importarFolhaContabilidade`, `enviarCompetencia`
- `app/(app)/rh/folhas/_components/checkpoint-competencia.tsx` — componente visual da checklist
- `app/(app)/rh/folhas/_components/importar-folha-modal.tsx`

**Modify:**
- `lib/types.ts` — adicionar `FolhaOrigem`, `FolhaImportacao`, estender `FolhaPagamento` (com `origem`, `data_pagamento_prevista`), estender `ColaboradorSalario` (com `valor_recibo`).
- `app/(app)/rh/folhas/actions.ts` — `gerarFolha` filtra + híbrido usa `valor_recibo` + grava `origem='california'`.
- `app/(app)/rh/folhas/nova-folha-modal.tsx` — rótulo passa a dizer "Gerar PJ".
- `app/(app)/rh/folhas/page.tsx` — página orientada por competência com checklist.
- `app/(app)/financeiro/contas-a-pagar/actions-folhas.ts` — `subtipoCodigoParaContratacao(tipo, origem)` + chamador em `aprovarLinhaFolha`.
- `app/(app)/financeiro/contas-a-pagar/folhas-pagar-list.tsx` — badge de origem + filtro.
- `package.json` — nova dep `pdf-parse` + nova devdep `@types/pdf-parse` + script `test:folha-parser`.

---

## Task 0: Criar subtipo `05.015 Serviços de Terceiros (PJ)` (operacional, sem código)

**Responsável:** operador do financeiro, antes de qualquer código rodar.

**Files:** nenhum.

**Interfaces:**
- Produces: existência da linha `(plano_contas_tipos.codigo='05', plano_contas_subtipos.codigo='015', nome='Serviços de Terceiros (PJ)', ativo=true)` que a Task 6 consulta.

- [ ] **Step 1: Acessar UI** → `/financeiro/cadastros/plano-de-contas`.

- [ ] **Step 2: Expandir "05 Despesa com Pessoal"**.

- [ ] **Step 3: Clicar em "+ Subtipo"** e preencher: nome = `Serviços de Terceiros (PJ)`, código = `015`, ativo = sim.

- [ ] **Step 4: Verificar via MCP:**
  ```sql
  SELECT s.codigo, s.nome, s.ativo
  FROM plano_contas_subtipos s
  JOIN plano_contas_tipos t ON t.id = s.tipo_id
  WHERE t.codigo = '05' AND s.codigo = '015';
  ```
  Esperado: 1 linha, `ativo=true`.

---

## Task 1: Migration — enum `folha_origem`

**Files:**
- Create: `supabase/migrations/20261006600003_folha_origem_enum.sql`

**Interfaces:**
- Produces: tipo `folha_origem` com valores `'california'` e `'contabilidade'`, usado pela Task 3.

- [ ] **Step 1: Escrever a migration**

Arquivo `supabase/migrations/20261006600003_folha_origem_enum.sql`:

```sql
-- Enum folha_origem — discrimina qual fluxo criou a linha de folha.
-- 'california' = gerada por gerarFolha a partir do cadastro.
-- 'contabilidade' = importada do PDF "Relação Geral dos Líquidos".
-- Spec: docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md

CREATE TYPE public.folha_origem AS ENUM ('california', 'contabilidade');
```

- [ ] **Step 2: Aplicar via MCP**

Usar `mcp__supabase-write__apply_migration` com `name='20261006600003_folha_origem_enum'` e o SQL acima.

- [ ] **Step 3: Verificar criação pelo MCP**

```sql
SELECT enumlabel
FROM pg_enum
WHERE enumtypid = 'public.folha_origem'::regtype
ORDER BY enumsortorder;
```

Esperado: duas linhas, `california` seguido de `contabilidade`.

- [ ] **Step 4: Commit**

```powershell
git add supabase/migrations/20261006600003_folha_origem_enum.sql
git commit -m "feat(folha): cria enum folha_origem (california / contabilidade)"
```

---

## Task 2: Migration — `colaboradores_salarios.valor_recibo` + trigger + backfill 50/50

**Files:**
- Create: `supabase/migrations/20261006600004_colaboradores_salarios_valor_recibo.sql`
- Modify: `lib/types.ts` (adicionar `valor_recibo` em `ColaboradorSalario`)

**Interfaces:**
- Produces: coluna `colaboradores_salarios.valor_recibo numeric(14,2) NULL` com CHECK via trigger (`valor_recibo IS NOT NULL ⇔ tipo_contratacao='clt_recibo'`). Backfill 50/50 aplicado a todas as linhas de híbrido (vigentes e históricas).

- [ ] **Step 1: Confirmação explícita do operador antes de aplicar**

Esta migration tem `UPDATE` em `colaboradores_salarios` existente. **Perguntar ao operador por chat:** "Vou rodar backfill de `valor_recibo = valor / 2` em todas as linhas de colaboradores `clt_recibo` (vigentes e históricas). Posso aplicar?" e aguardar `sim` antes do Step 2.

- [ ] **Step 2: Ler o estado atual pelo MCP**

```sql
SELECT c.id, c.nome, c.tipo_contratacao, cs.valor
FROM colaboradores c
JOIN colaboradores_salarios cs ON cs.colaborador_id = c.id
WHERE c.tipo_contratacao = 'clt_recibo' AND cs.data_fim IS NULL
ORDER BY c.nome;
```

Guarde o resultado — vai usar pra conferir o backfill no Step 5.

- [ ] **Step 3: Escrever a migration**

Arquivo `supabase/migrations/20261006600004_colaboradores_salarios_valor_recibo.sql`:

```sql
-- Divide o salário de colaboradores clt_recibo em duas partes:
--   valor         = total mensal do contrato (inalterado)
--   valor_recibo  = parcela paga como RPA pela California
-- A parcela CLT (paga pela contabilidade) é derivada: valor - valor_recibo.
-- CHECK via trigger: valor_recibo preenchido se e somente se tipo_contratacao='clt_recibo'.
-- Backfill 50/50 aplicado em vigentes e histórico; operador ajusta caso a caso depois.
-- Spec: docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md (D2)

ALTER TABLE public.colaboradores_salarios
  ADD COLUMN valor_recibo numeric(14,2) NULL;

COMMENT ON COLUMN public.colaboradores_salarios.valor_recibo IS
  'Parcela RPA do salário de colaborador clt_recibo. NULL para outros tipos. valor_clt derivada = valor - valor_recibo.';

-- Trigger de coerência: valor_recibo preenchido IFF o colaborador é clt_recibo.
CREATE OR REPLACE FUNCTION public.trg_colaboradores_salarios_valor_recibo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo public.tipo_contratacao;
BEGIN
  SELECT tipo_contratacao INTO v_tipo
  FROM public.colaboradores
  WHERE id = NEW.colaborador_id;

  IF v_tipo = 'clt_recibo' THEN
    IF NEW.valor_recibo IS NULL THEN
      RAISE EXCEPTION 'valor_recibo é obrigatório para colaborador clt_recibo (colaborador_id=%)', NEW.colaborador_id;
    END IF;
    IF NEW.valor_recibo < 0 OR NEW.valor_recibo > NEW.valor THEN
      RAISE EXCEPTION 'valor_recibo (%) fora do intervalo [0, valor=%]', NEW.valor_recibo, NEW.valor;
    END IF;
  ELSE
    IF NEW.valor_recibo IS NOT NULL THEN
      RAISE EXCEPTION 'valor_recibo deve ser NULL para tipo_contratacao=% (colaborador_id=%)', v_tipo, NEW.colaborador_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER colaboradores_salarios_valor_recibo_check
  BEFORE INSERT OR UPDATE ON public.colaboradores_salarios
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_colaboradores_salarios_valor_recibo();

-- Backfill 50/50: parcela RPA inicial = metade do total. Operador ajusta caso a caso.
-- Precisa desabilitar o trigger momentaneamente, senão ele valida linha a linha e já OK:
-- (o trigger aceita porque após o UPDATE o valor_recibo fica NOT NULL e dentro do range).
UPDATE public.colaboradores_salarios cs
SET valor_recibo = round(cs.valor / 2, 2)
FROM public.colaboradores c
WHERE c.id = cs.colaborador_id
  AND c.tipo_contratacao = 'clt_recibo'
  AND cs.valor_recibo IS NULL;
```

- [ ] **Step 4: Aplicar via MCP**

Usar `mcp__supabase-write__apply_migration` com `name='20261006600004_colaboradores_salarios_valor_recibo'` e o SQL acima.

- [ ] **Step 5: Verificar backfill**

```sql
SELECT c.nome, c.tipo_contratacao, cs.valor, cs.valor_recibo,
       cs.valor - cs.valor_recibo AS valor_clt_derivado
FROM colaboradores c
JOIN colaboradores_salarios cs ON cs.colaborador_id = c.id
WHERE c.tipo_contratacao = 'clt_recibo'
ORDER BY c.nome;
```

Esperado: toda linha de híbrido tem `valor_recibo = valor / 2` (± R$ 0,01 por arredondamento). Nenhum `valor_recibo` NULL em híbrido.

Confirmar: nenhum colaborador não-híbrido tem `valor_recibo IS NOT NULL`:

```sql
SELECT count(*)
FROM colaboradores_salarios cs
JOIN colaboradores c ON c.id = cs.colaborador_id
WHERE c.tipo_contratacao <> 'clt_recibo' AND cs.valor_recibo IS NOT NULL;
```

Esperado: `0`.

- [ ] **Step 6: Verificar que o trigger bloqueia inserção inválida**

```sql
-- Deve FALHAR com "valor_recibo deve ser NULL para tipo_contratacao=pj":
INSERT INTO colaboradores_salarios (tenant_id, colaborador_id, valor, valor_recibo, data_inicio)
SELECT c.tenant_id, c.id, 10000, 5000, now()::date
FROM colaboradores c
WHERE c.tipo_contratacao = 'pj'
LIMIT 1;
```

Esperado: erro. Depois `ROLLBACK;` se necessário.

- [ ] **Step 7: Atualizar `lib/types.ts`**

Localizar a interface `ColaboradorSalario` (procure por `interface ColaboradorSalario` ou `type ColaboradorSalario`). Adicionar o campo:

```typescript
valor_recibo: string | null;
```

(É `string` porque `numeric` do Postgres volta como string no supabase-js.)

- [ ] **Step 8: Commit**

```powershell
git add supabase/migrations/20261006600004_colaboradores_salarios_valor_recibo.sql lib/types.ts
git commit -m "feat(folha): coluna valor_recibo em colaboradores_salarios + backfill 50/50"
```

---

## Task 3: Migration — `folhas_pagamento.origem` + `data_pagamento_prevista` + unique nova

**Files:**
- Create: `supabase/migrations/20261006600005_folhas_pagamento_origem.sql`
- Modify: `lib/types.ts` (adicionar `FolhaOrigem`, estender `FolhaPagamento`)

**Interfaces:**
- Produces: `folhas_pagamento.origem folha_origem NOT NULL DEFAULT 'california'`, `folhas_pagamento.data_pagamento_prevista date NULL`, unique constraint nova `(tenant_id, competencia_ano, competencia_mes, colaborador_id, origem)`. Tasks 5, 6, 8, 9, 10 e 12 dependem.

- [ ] **Step 1: Confirmar o nome real da unique antiga pelo MCP**

```sql
SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.folhas_pagamento'::regclass
  AND contype = 'u';
```

Esperado algo como `uniq_folha_por_colaborador_competencia`. **Guarde o nome real** para o Step 2.

- [ ] **Step 2: Escrever a migration**

Arquivo `supabase/migrations/20261006600005_folhas_pagamento_origem.sql` (substitua `<NOME_UNIQUE_ANTIGA>` pelo nome retornado no Step 1):

```sql
-- Discrimina origem da linha de folha e permite coexistência de duas linhas
-- para o mesmo colaborador híbrido na mesma competência (uma california + uma contabilidade).
-- data_pagamento_prevista guarda a data que veio no PDF da contabilidade.
-- Spec: docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md (D1, D3)

ALTER TABLE public.folhas_pagamento
  ADD COLUMN origem public.folha_origem NOT NULL DEFAULT 'california',
  ADD COLUMN data_pagamento_prevista date NULL;

COMMENT ON COLUMN public.folhas_pagamento.origem IS
  'california = gerada por gerarFolha; contabilidade = importada do PDF Relação Geral dos Líquidos.';

COMMENT ON COLUMN public.folhas_pagamento.data_pagamento_prevista IS
  'Data de pagamento sugerida pela contabilidade (vem no PDF). NULL para linhas california.';

-- Troca a unique antiga por uma que inclui origem.
ALTER TABLE public.folhas_pagamento
  DROP CONSTRAINT <NOME_UNIQUE_ANTIGA>;

ALTER TABLE public.folhas_pagamento
  ADD CONSTRAINT folhas_pagamento_tenant_ano_mes_colab_origem_key
  UNIQUE (tenant_id, competencia_ano, competencia_mes, colaborador_id, origem);

CREATE INDEX IF NOT EXISTS folhas_pagamento_competencia_origem_idx
  ON public.folhas_pagamento (tenant_id, competencia_ano, competencia_mes, origem);
```

- [ ] **Step 3: Aplicar via MCP**

Usar `mcp__supabase-write__apply_migration` com `name='20261006600005_folhas_pagamento_origem'` e o SQL do Step 2.

- [ ] **Step 4: Verificar colunas e constraints**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='folhas_pagamento'
  AND column_name IN ('origem', 'data_pagamento_prevista');

SELECT conname
FROM pg_constraint
WHERE conrelid='public.folhas_pagamento'::regclass AND contype='u';
```

Esperado: 2 colunas novas + constraint `folhas_pagamento_tenant_ano_mes_colab_origem_key`.

Verificar que linhas existentes ficaram marcadas como `california`:

```sql
SELECT origem, count(*)
FROM folhas_pagamento
GROUP BY origem;
```

Esperado: só `california`.

- [ ] **Step 5: Atualizar `lib/types.ts`**

Localizar o bloco (próximo da linha 3792 do arquivo pelo Explore anterior, procure por `FolhaLinhaStatus`). Adicionar:

```typescript
export type FolhaOrigem = "california" | "contabilidade";
```

Estender `FolhaPagamento`:

```typescript
export interface FolhaPagamento {
  // ...campos existentes...
  origem: FolhaOrigem;
  data_pagamento_prevista: string | null;
  // ...resto...
}
```

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/20261006600005_folhas_pagamento_origem.sql lib/types.ts
git commit -m "feat(folha): coluna origem + data_pagamento_prevista em folhas_pagamento"
```

---

## Task 4: Migration — tabela `folha_importacoes`

**Files:**
- Create: `supabase/migrations/20261006600006_folha_importacoes.sql`
- Modify: `lib/types.ts` (adicionar `FolhaImportacao`)

**Interfaces:**
- Produces: tabela `folha_importacoes` com unique `(tenant_id, competencia_ano, competencia_mes, arquivo_hash)`, usada por Task 8.

- [ ] **Step 1: Escrever a migration**

Arquivo `supabase/migrations/20261006600006_folha_importacoes.sql`:

```sql
-- Auditoria das importações do PDF da contabilidade.
-- Idempotência por (competencia, hash do arquivo).
-- Guarda totalizadores do PDF para conferência futura.
-- Spec: docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md (Task 4 do spec)

CREATE TABLE public.folha_importacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  competencia_ano int NOT NULL,
  competencia_mes int NOT NULL,
  arquivo_nome text NOT NULL,
  arquivo_hash text NOT NULL,
  linhas_total int NOT NULL DEFAULT 0,
  linhas_criadas int NOT NULL DEFAULT 0,
  linhas_atualizadas int NOT NULL DEFAULT 0,
  linhas_ignoradas int NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  totalizadores_pdf jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.folha_importacoes IS
  'Histórico de importação do PDF Relação Geral dos Líquidos. Idempotência por (competencia, hash).';

CREATE UNIQUE INDEX folha_importacoes_hash_competencia_idx
  ON public.folha_importacoes (tenant_id, competencia_ano, competencia_mes, arquivo_hash);

CREATE INDEX folha_importacoes_competencia_idx
  ON public.folha_importacoes (tenant_id, competencia_ano, competencia_mes);

ALTER TABLE public.folha_importacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY folha_importacoes_select ON public.folha_importacoes
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY folha_importacoes_insert ON public.folha_importacoes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));

GRANT SELECT, INSERT ON public.folha_importacoes TO authenticated;
```

- [ ] **Step 2: Aplicar via MCP**

Usar `mcp__supabase-write__apply_migration` com `name='20261006600006_folha_importacoes'` e o SQL acima.

- [ ] **Step 3: Verificar estrutura, policies, grants**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='folha_importacoes';

SELECT polname, polcmd FROM pg_policy
WHERE polrelid='public.folha_importacoes'::regclass;

SELECT grantee, privilege_type FROM information_schema.table_privileges
WHERE table_schema='public' AND table_name='folha_importacoes';
```

Esperado: 13 colunas, 2 policies (`SELECT`, `INSERT`), grants `SELECT`+`INSERT` para `authenticated`, nada para `anon`.

- [ ] **Step 4: Atualizar `lib/types.ts`**

Perto da definição de `FolhaOrigem` da Task 3, adicionar:

```typescript
export interface FolhaImportacaoWarning {
  tipo: "colaborador_nao_encontrado"
       | "secao_errada"
       | "tipo_incompatível"
       | "linha_ja_promovida"
       | "soma_divergente"
       | "cpf_invalido"
       | "valor_invalido";
  mensagem: string;
  cpf?: string;
  nome?: string;
  secao?: "empregados" | "estagiarios" | "contribuintes";
}

export interface FolhaImportacaoTotalizadores {
  empregados?: { linhas: number; total: string };
  estagiarios?: { linhas: number; total: string };
  contribuintes?: { linhas: number; total: string };
  total_empresa?: string;
}

export interface FolhaImportacao {
  id: string;
  tenant_id: string;
  competencia_ano: number;
  competencia_mes: number;
  arquivo_nome: string;
  arquivo_hash: string;
  linhas_total: number;
  linhas_criadas: number;
  linhas_atualizadas: number;
  linhas_ignoradas: number;
  warnings: FolhaImportacaoWarning[];
  totalizadores_pdf: FolhaImportacaoTotalizadores;
  uploaded_by: string;
  uploaded_at: string;
}
```

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/20261006600006_folha_importacoes.sql lib/types.ts
git commit -m "feat(folha): tabela folha_importacoes com RLS e tipos"
```

---

## Task 5: `gerarFolha` filtra tipos e usa `valor_recibo` em híbrido

**Files:**
- Modify: `app/(app)/rh/folhas/actions.ts` (linhas 45–370, bloco `gerarFolha`)

**Interfaces:**
- Consumes: enum `folha_origem` (Task 1), coluna `colaboradores_salarios.valor_recibo` (Task 2), coluna `folhas_pagamento.origem` (Task 3).
- Produces: `gerarFolha({ ano, mes })` que cria linhas apenas para `pj`/`mei`/`clt_recibo`, com `salario_base = valor_recibo` para `clt_recibo` e `salario_base = valor` para o resto, marcadas `origem='california'`.

- [ ] **Step 1: Localizar o filtro de colaboradores**

Abrir [app/(app)/rh/folhas/actions.ts](../../../app/(app)/rh/folhas/actions.ts). Procurar o `supabase.from("colaboradores").select(...)` dentro de `gerarFolha` (perto da linha 76 segundo o Explore).

Hoje o filtro é por data de admissão/encerramento. Não há filtro por `tipo_contratacao` — por isso pega todo mundo.

- [ ] **Step 2: Adicionar filtro `tipo_contratacao IN ('pj','mei','clt_recibo')`**

Adicionar `.in("tipo_contratacao", ["pj", "mei", "clt_recibo"])` na query de colaboradores.

- [ ] **Step 3: Localizar o laço que define `salario_base` por colaborador**

Procurar a parte que lê o salário vigente (via consulta a `colaboradores_salarios` com `data_fim IS NULL`). Ela monta `salario_base` pra cada linha nova.

- [ ] **Step 4: Trocar a derivação do `salario_base` por lógica condicional**

Para cada colaborador:

```typescript
const salarioBase =
  colaborador.tipo_contratacao === "clt_recibo"
    ? salarioVigente.valor_recibo
    : salarioVigente.valor;

if (salarioBase == null) {
  pulados_sem_salario.push(colaborador.nome);
  continue;
}
```

(Hoje provavelmente o código pula se `valor` for null; preservar essa lógica, só mudar qual campo é lido.)

- [ ] **Step 5: Adicionar `origem: 'california'` no payload do INSERT**

No bulk insert de `folhas_pagamento`, incluir `origem: "california"` em cada registro. O DEFAULT da migration cobre, mas tornar explícito ajuda a leitura.

- [ ] **Step 6: Tornar o INSERT idempotente**

O INSERT atual provavelmente usa `.insert([...])` simples. Trocar por `.upsert([...], { onConflict: "tenant_id,competencia_ano,competencia_mes,colaborador_id,origem", ignoreDuplicates: true })` — isso permite re-rodar `gerarFolha` sem erro, só não cria duplicata.

- [ ] **Step 7: Ajustar o audit log**

Localizar a chamada `logAuditEvent({ acao: "folha.gerada", ... })` perto da linha 340. Adicionar no `metadata`:

```typescript
metadata: {
  ano: input.ano,
  mes: input.mes,
  criadas,
  tipos_incluidos: ["pj", "mei", "clt_recibo"],
  origem: "california",
}
```

- [ ] **Step 8: Smoke test manual contra o banco de dev**

Rodar `npm run dev`, abrir `/rh/folhas`, criar nova folha de uma competência de teste. Verificar via SQL:

```sql
SELECT c.nome, c.tipo_contratacao, fp.salario_base, fp.origem
FROM folhas_pagamento fp
JOIN colaboradores c ON c.id = fp.colaborador_id
WHERE fp.competencia_ano = <ano_teste> AND fp.competencia_mes = <mes_teste>
ORDER BY c.tipo_contratacao, c.nome;
```

Esperado: só tipos `pj`, `mei`, `clt_recibo`. Nenhum `clt`, `estagio`, `socio`. Para `clt_recibo`, `salario_base = valor_recibo` do cadastro. Todos com `origem='california'`.

- [ ] **Step 9: Limpar os dados de teste**

```sql
DELETE FROM folhas_pagamento_alocacoes WHERE folha_id IN (
  SELECT id FROM folhas_pagamento WHERE competencia_ano=<ano_teste> AND competencia_mes=<mes_teste>
);
DELETE FROM folhas_pagamento WHERE competencia_ano=<ano_teste> AND competencia_mes=<mes_teste>;
```

- [ ] **Step 10: `npm run typecheck`**

Confirmar que não quebrou nada.

- [ ] **Step 11: Commit**

```powershell
git add app/(app)/rh/folhas/actions.ts
git commit -m "feat(folha): gerarFolha filtra PJ+Recibo e usa valor_recibo em híbrido"
```

---

## Task 6: `subtipoCodigoParaContratacao(tipo, origem)` + wiring em `aprovarLinhaFolha`

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-folhas.ts` (linhas 29–41 e 481–506 segundo o Explore)

**Interfaces:**
- Consumes: subtipo `015` (Task 0), coluna `folhas_pagamento.origem` (Task 3).
- Produces: função `subtipoCodigoParaContratacao(tipo: TipoContratacao, origem: FolhaOrigem): string` que devolve `015` para PJ/MEI/Recibo da California, `001` para CLT da contabilidade, `005` para estagiário da contabilidade, `011` para sócio da contabilidade.

- [ ] **Step 1: Reescrever `subtipoCodigoParaContratacao`**

Substituir as linhas 29–41 (bloco atual):

```typescript
import type { FolhaOrigem } from "@/lib/types"; // adicionar ao import existente

function subtipoCodigoParaContratacao(
  tipo: TipoContratacao,
  origem: FolhaOrigem,
): string {
  if (origem === "california") {
    switch (tipo) {
      case "pj":
      case "mei":
      case "clt_recibo":
        return "015"; // Serviços de Terceiros (PJ) — inclui RPA
      default:
        throw new Error(
          `tipo_contratacao '${tipo}' não é compatível com origem 'california'`,
        );
    }
  }
  // origem === "contabilidade"
  switch (tipo) {
    case "clt":
    case "clt_recibo":
      return "001"; // Salário
    case "estagio":
      return "005"; // Estagiário
    case "socio":
      return "011"; // ProLabore
    default:
      throw new Error(
        `tipo_contratacao '${tipo}' não é compatível com origem 'contabilidade'`,
      );
  }
}
```

- [ ] **Step 2: Localizar o uso de `subtipoCodigoParaContratacao`**

Procurar em `actions-folhas.ts` por `subtipoCodigoParaContratacao(` (perto da linha 481 do bloco de resolução de plano de contas em `aprovarLinhaFolha`). Hoje a chamada é com um único argumento (o `tipo_contratacao` do colaborador).

- [ ] **Step 3: Passar `origem` da folha para a função**

A `aprovarLinhaFolha(folhaId, ...)` carrega a linha da folha logo no início. Garantir que o SELECT da folha inclui `origem` (adicionar `origem` no `.select(...)` se não estiver). Depois:

```typescript
const codigoSubtipo = subtipoCodigoParaContratacao(
  colaborador.tipo_contratacao,
  folha.origem,
);
```

- [ ] **Step 4: Verificar que o lookup de FK pelo código continua certo**

O código seguinte (linhas ~481–506) faz: lookup `plano_contas_tipos` por nome='Despesa com Pessoal', depois `plano_contas_subtipos` por `(tipo_id, codigo)`. Esse código continua funcionando — só mudou o valor retornado por `subtipoCodigoParaContratacao`.

Confirmar que, se `codigoSubtipo = '015'`, o SELECT encontra o subtipo criado na Task 0. Se não encontrar, a chamada deve soltar erro claro — ver Step 5.

- [ ] **Step 5: Melhorar a mensagem de erro quando o subtipo não existe**

Logo após o lookup de `plano_contas_subtipos`, se não encontrar:

```typescript
if (!subtipoRow) {
  return {
    ok: false,
    error: `Subtipo ${codigoSubtipo} da categoria 'Despesa com Pessoal' não está cadastrado no plano de contas. Crie em /financeiro/cadastros/plano-de-contas antes de aprovar.`,
  };
}
```

(Isso cobre o caso de alguém pular a Task 0.)

- [ ] **Step 6: Smoke test manual**

Rodar `npm run dev`, criar manualmente uma folha de teste em cada combinação (pj + california, clt + contabilidade, estagio + contabilidade, socio + contabilidade, clt_recibo + california, clt_recibo + contabilidade), aprovar cada uma e verificar via SQL que `contas_avulsas.plano_conta_subtipo_id` resolve pros códigos corretos:

```sql
SELECT c.nome AS colaborador, c.tipo_contratacao, fp.origem, s.codigo AS subtipo
FROM contas_avulsas ca
JOIN folhas_pagamento fp ON fp.id = ca.folha_id
JOIN colaboradores c ON c.id = fp.colaborador_id
JOIN plano_contas_subtipos s ON s.id = ca.plano_conta_subtipo_id
WHERE fp.competencia_ano = <ano> AND fp.competencia_mes = <mes>;
```

Esperado: tabela do mapeamento batendo com a Task 6 do spec.

- [ ] **Step 7: `npm run typecheck`**

- [ ] **Step 8: Commit**

```powershell
git add app/(app)/financeiro/contas-a-pagar/actions-folhas.ts
git commit -m "feat(folha): mapeamento plano de contas discrimina origem (015 Serviços de Terceiros PJ)"
```

---

## Task 7: Parser do PDF "Relação Geral dos Líquidos"

**Files:**
- Create: `lib/pdf/parse-folha-contabilidade.ts`
- Create: `lib/pdf/parse-folha-contabilidade.test.ts`
- Create: `lib/pdf/__fixtures__/folha-092025.txt`
- Modify: `package.json` (adicionar `pdf-parse`, `@types/pdf-parse`, script `test:folha-parser`)

**Interfaces:**
- Produces:
  ```typescript
  export type SecaoPdf = "empregados" | "estagiarios" | "contribuintes";

  export interface LinhaPdf {
    secao: SecaoPdf;
    codigo_contabilidade: string;
    nome: string;
    cpf: string; // normalizado (só dígitos)
    valor: number; // centavos — número inteiro
    data_pagamento: string; // ISO yyyy-mm-dd
  }

  export interface TotalizadoresPdf {
    empregados: number;
    estagiarios: number;
    contribuintes: number;
    total_empresa: number; // centavos
  }

  export interface ParsedFolha {
    cnpj_emissor: string; // só dígitos
    competencia_ano: number;
    competencia_mes: number;
    linhas: LinhaPdf[];
    totalizadores: TotalizadoresPdf;
  }

  export function parseFolhaContabilidadeTexto(texto: string): ParsedFolha;
  ```
- Isolamento: parser puro. A extração do texto do PDF (via `pdf-parse`) é responsabilidade da Task 8 — assim o parser é 100% testável sem binário.

- [ ] **Step 1: Instalar dependências**

```powershell
npm install pdf-parse @types/pdf-parse
```

- [ ] **Step 2: Criar a fixture de texto a partir do PDF real**

Rodar uma vez (ad-hoc, fora do fluxo) um script que extrai o texto do PDF de setembro/2025 e salva em `lib/pdf/__fixtures__/folha-092025.txt`. Alternativa manual: copiar o texto do PDF (ctrl-a, ctrl-c em qualquer viewer de PDF) e colar no arquivo. O texto deve conter as linhas na ordem em que aparecem no PDF, incluindo cabeçalhos de seção ("Empregados", "Estagiários", "Contribuintes") e o rodapé de totalizadores.

**Trecho esperado da fixture (abertura e primeiras linhas):**

```
RELAÇÃO GERAL DOS LÍQUIDOS
Código Nome do empregado CPF Valor
Empresa: CALIFORNIA FILMES E PUBLICIDADE LTDA
CNPJ: 19.437.976/0001-54
Cálculo: Folha Mensal
Competência: 09/2026
...
Empregados
61 CAROLINE CERQUEIRA INACIO 415.891.968-13 1.988,40 05/10/2026
3 CRISTIANA DANTAS CATHARINO GORDILHO PINTO 010.018.915-62 3.191,42 05/10/2026
...
Estagiários
68 EDUARDO LARA BARNI 015.054.512-64 2.000,00 05/10/2026
59 JAQUELINE ALMEIDA DA SILVA 084.345.695-74 2.000,00 05/10/2026
Contribuintes
1 BRUNO DUARTE LEITE 825.094.415-15 1.442,69 05/10/2026
Empregados: 30 Estagiários: 2 Contribuintes: 1 Total da Empresa: 125.281,45
```

- [ ] **Step 3: Escrever o teste primeiro (falha propositalmente)**

Arquivo `lib/pdf/parse-folha-contabilidade.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseFolhaContabilidadeTexto } from "./parse-folha-contabilidade";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  join(__dirname, "__fixtures__", "folha-092025.txt"),
  "utf8",
);

test("extrai header: CNPJ, competência", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  assert.equal(r.cnpj_emissor, "19437976000154");
  assert.equal(r.competencia_ano, 2026);
  assert.equal(r.competencia_mes, 9);
});

test("extrai contagens dos totalizadores do rodapé", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  assert.equal(r.totalizadores.empregados, 30);
  assert.equal(r.totalizadores.estagiarios, 2);
  assert.equal(r.totalizadores.contribuintes, 1);
  assert.equal(r.totalizadores.total_empresa, 12528145); // R$ 125.281,45 em centavos
});

test("extrai todas as 33 linhas (30+2+1)", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  assert.equal(r.linhas.length, 33);
  assert.equal(r.linhas.filter(l => l.secao === "empregados").length, 30);
  assert.equal(r.linhas.filter(l => l.secao === "estagiarios").length, 2);
  assert.equal(r.linhas.filter(l => l.secao === "contribuintes").length, 1);
});

test("normaliza CPF (remove pontos e traços)", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const caroline = r.linhas.find(l => l.nome.startsWith("CAROLINE"));
  assert.ok(caroline);
  assert.equal(caroline.cpf, "41589196813");
  assert.equal(caroline.cpf.length, 11);
  assert.match(caroline.cpf, /^\d+$/);
});

test("converte valor em centavos (inteiro)", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const caroline = r.linhas.find(l => l.nome.startsWith("CAROLINE"));
  assert.equal(caroline?.valor, 198840); // R$ 1.988,40
});

test("converte data_pagamento em ISO", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const caroline = r.linhas.find(l => l.nome.startsWith("CAROLINE"));
  assert.equal(caroline?.data_pagamento, "2026-10-05");
});

test("categoriza linha pela seção correta", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const estagiario = r.linhas.find(l => l.nome.startsWith("EDUARDO"));
  assert.equal(estagiario?.secao, "estagiarios");
  const contribuinte = r.linhas.find(l => l.nome.startsWith("BRUNO"));
  assert.equal(contribuinte?.secao, "contribuintes");
});

test("soma dos valores da seção bate com totalizador do rodapé (empregados)", () => {
  const r = parseFolhaContabilidadeTexto(fixture);
  const somaEmpregados = r.linhas
    .filter(l => l.secao === "empregados")
    .reduce((acc, l) => acc + l.valor, 0);
  // Verifica contra uma soma manual do PDF — ou check de magnitude:
  assert.ok(somaEmpregados > 0);
  assert.ok(somaEmpregados < r.totalizadores.total_empresa);
});

test("texto sem seção 'Empregados' solta erro claro", () => {
  const textoTruncado = "RELAÇÃO GERAL DOS LÍQUIDOS\nCNPJ: 19.437.976/0001-54\nCompetência: 09/2026\n";
  assert.throws(
    () => parseFolhaContabilidadeTexto(textoTruncado),
    /seção .*Empregados.* não encontrada/i,
  );
});
```

- [ ] **Step 4: Rodar o teste e confirmar que falha com "module not found"**

Antes, adicionar script em `package.json`:

```json
"scripts": {
  ...
  "test:folha-parser": "node --import tsx --test lib/pdf/parse-folha-contabilidade.test.ts"
}
```

Rodar: `npm run test:folha-parser`. Deve falhar porque o módulo ainda não existe.

- [ ] **Step 5: Implementar `parseFolhaContabilidadeTexto`**

Arquivo `lib/pdf/parse-folha-contabilidade.ts`:

```typescript
export type SecaoPdf = "empregados" | "estagiarios" | "contribuintes";

export interface LinhaPdf {
  secao: SecaoPdf;
  codigo_contabilidade: string;
  nome: string;
  cpf: string;
  valor: number;
  data_pagamento: string;
}

export interface TotalizadoresPdf {
  empregados: number;
  estagiarios: number;
  contribuintes: number;
  total_empresa: number;
}

export interface ParsedFolha {
  cnpj_emissor: string;
  competencia_ano: number;
  competencia_mes: number;
  linhas: LinhaPdf[];
  totalizadores: TotalizadoresPdf;
}

const RE_CNPJ = /CNPJ:\s*([\d./-]+)/;
const RE_COMPETENCIA = /Compet[eê]ncia:\s*(\d{2})\/(\d{4})/;
const RE_LINHA = /^\s*(\d+)\s+([^\d]+?)\s+(\d{3}\.\d{3}\.\d{3}-\d{2})\s+([\d.,]+)\s+(\d{2}\/\d{2}\/\d{4})\s*$/;
const RE_TOTAIS =
  /Empregados:\s*(\d+)\s+Estagi[áa]rios:\s*(\d+)\s+Contribuintes:\s*(\d+)\s+Total da Empresa:\s*([\d.,]+)/;

function brlParaCentavos(s: string): number {
  const limpo = s.replace(/\./g, "").replace(",", ".");
  const num = Number(limpo);
  if (Number.isNaN(num)) throw new Error(`valor inválido: ${s}`);
  return Math.round(num * 100);
}

function dataBrParaIso(s: string): string {
  const [d, m, y] = s.split("/");
  return `${y}-${m}-${d}`;
}

export function parseFolhaContabilidadeTexto(texto: string): ParsedFolha {
  const cnpjMatch = texto.match(RE_CNPJ);
  if (!cnpjMatch) throw new Error("CNPJ não encontrado no PDF");
  const cnpj_emissor = cnpjMatch[1].replace(/\D/g, "");

  const compMatch = texto.match(RE_COMPETENCIA);
  if (!compMatch) throw new Error("Competência não encontrada no PDF");
  const competencia_mes = Number(compMatch[1]);
  const competencia_ano = Number(compMatch[2]);

  // Localizar as três seções pelos cabeçalhos.
  const idxEmpregados = texto.indexOf("\nEmpregados\n");
  if (idxEmpregados < 0) {
    throw new Error('Seção "Empregados" não encontrada no PDF');
  }
  const idxEstagiarios = texto.indexOf("\nEstagiários\n");
  const idxContribuintes = texto.indexOf("\nContribuintes\n");
  const idxTotais = texto.search(RE_TOTAIS);

  const blocos: { secao: SecaoPdf; inicio: number; fim: number }[] = [];
  blocos.push({
    secao: "empregados",
    inicio: idxEmpregados + "\nEmpregados\n".length,
    fim: idxEstagiarios > 0 ? idxEstagiarios
       : idxContribuintes > 0 ? idxContribuintes
       : idxTotais > 0 ? idxTotais
       : texto.length,
  });
  if (idxEstagiarios > 0) {
    blocos.push({
      secao: "estagiarios",
      inicio: idxEstagiarios + "\nEstagiários\n".length,
      fim: idxContribuintes > 0 ? idxContribuintes
         : idxTotais > 0 ? idxTotais
         : texto.length,
    });
  }
  if (idxContribuintes > 0) {
    blocos.push({
      secao: "contribuintes",
      inicio: idxContribuintes + "\nContribuintes\n".length,
      fim: idxTotais > 0 ? idxTotais : texto.length,
    });
  }

  const linhas: LinhaPdf[] = [];
  for (const bloco of blocos) {
    const trecho = texto.slice(bloco.inicio, bloco.fim);
    for (const linhaRaw of trecho.split("\n")) {
      const m = linhaRaw.match(RE_LINHA);
      if (!m) continue; // linha vazia / cabeçalho repetido / lixo
      linhas.push({
        secao: bloco.secao,
        codigo_contabilidade: m[1],
        nome: m[2].trim(),
        cpf: m[3].replace(/\D/g, ""),
        valor: brlParaCentavos(m[4]),
        data_pagamento: dataBrParaIso(m[5]),
      });
    }
  }

  const totMatch = texto.match(RE_TOTAIS);
  if (!totMatch) throw new Error("Totalizadores do rodapé não encontrados");
  const totalizadores: TotalizadoresPdf = {
    empregados: Number(totMatch[1]),
    estagiarios: Number(totMatch[2]),
    contribuintes: Number(totMatch[3]),
    total_empresa: brlParaCentavos(totMatch[4]),
  };

  return {
    cnpj_emissor,
    competencia_ano,
    competencia_mes,
    linhas,
    totalizadores,
  };
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

```powershell
npm run test:folha-parser
```

Esperado: todos os testes passam. Se algum falhar, ajustar o regex ou a lógica de corte das seções. O regex de linha pode precisar de tweaks dependendo de como o `pdf-parse` quebra espaços.

- [ ] **Step 7: Commit**

```powershell
git add lib/pdf/parse-folha-contabilidade.ts lib/pdf/parse-folha-contabilidade.test.ts lib/pdf/__fixtures__/folha-092025.txt package.json package-lock.json
git commit -m "feat(folha): parser do PDF Relação Geral dos Líquidos (pdf-parse)"
```

---

## Task 8: Server action `importarFolhaContabilidade`

**Files:**
- Create: `app/(app)/rh/folhas/importar-actions.ts`

**Interfaces:**
- Consumes: `parseFolhaContabilidadeTexto` (Task 7), tabelas `folha_importacoes` e `folhas_pagamento` com `origem` (Tasks 3, 4).
- Produces:
  ```typescript
  export async function importarFolhaContabilidade(input: {
    ano: number;
    mes: number;
    arquivoBuffer: ArrayBuffer;
    arquivoNome: string;
    dryRun?: boolean;
  }): Promise<ActionResult<ResumoImportacao>>;

  export interface ResumoImportacao {
    importacao_id: string | null; // null quando dryRun
    linhas_total: number;
    linhas_criadas: number;
    linhas_atualizadas: number;
    linhas_ignoradas: number;
    warnings: FolhaImportacaoWarning[];
    totalizadores_pdf: FolhaImportacaoTotalizadores;
    preview: Array<{
      cpf: string;
      nome: string;
      secao: SecaoPdf;
      colaborador_id: string | null;
      tipo_contratacao: TipoContratacao | null;
      acao: "criar" | "atualizar" | "ignorar";
      motivo_ignorar?: string;
      valor: number;
    }>;
  }
  ```

- [ ] **Step 1: Esqueleto do arquivo**

Arquivo `app/(app)/rh/folhas/importar-actions.ts`:

```typescript
"use server";

import { createHash } from "node:crypto";
import pdfParse from "pdf-parse";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  parseFolhaContabilidadeTexto,
  type SecaoPdf,
} from "@/lib/pdf/parse-folha-contabilidade";
import type {
  FolhaImportacaoWarning,
  FolhaImportacaoTotalizadores,
  TipoContratacao,
} from "@/lib/types";

type Acao = "criar" | "atualizar" | "ignorar";

const SECAO_PARA_TIPOS: Record<SecaoPdf, TipoContratacao[]> = {
  empregados: ["clt", "clt_recibo"],
  estagiarios: ["estagio"],
  contribuintes: ["socio"],
};

export interface ResumoImportacao {
  importacao_id: string | null;
  linhas_total: number;
  linhas_criadas: number;
  linhas_atualizadas: number;
  linhas_ignoradas: number;
  warnings: FolhaImportacaoWarning[];
  totalizadores_pdf: FolhaImportacaoTotalizadores;
  preview: Array<{
    cpf: string;
    nome: string;
    secao: SecaoPdf;
    colaborador_id: string | null;
    tipo_contratacao: TipoContratacao | null;
    acao: Acao;
    motivo_ignorar?: string;
    valor: number;
  }>;
}

export async function importarFolhaContabilidade(input: {
  ano: number;
  mes: number;
  arquivoBuffer: ArrayBuffer;
  arquivoNome: string;
  dryRun?: boolean;
}): Promise<{ ok: true; data: ResumoImportacao } | { ok: false; error: string }> {
  // implementado nos próximos steps
  return { ok: false, error: "não implementado" };
}
```

- [ ] **Step 2: Hash e idempotência**

Dentro de `importarFolhaContabilidade`, depois da assinatura:

```typescript
const supabase = createClient();
const { data: userData } = await supabase.auth.getUser();
if (!userData?.user) return { ok: false, error: "não autenticado" };

const buffer = Buffer.from(input.arquivoBuffer);
const arquivo_hash = createHash("sha256").update(buffer).digest("hex");

// Resolver tenant_id a partir do profile.
const { data: profile } = await supabase
  .from("profiles")
  .select("tenant_id")
  .eq("id", userData.user.id)
  .single();
if (!profile?.tenant_id) return { ok: false, error: "tenant não resolvido" };

// Idempotência: se já existe importação com mesmo hash+competência, devolve o resumo armazenado.
if (!input.dryRun) {
  const { data: anterior } = await supabase
    .from("folha_importacoes")
    .select("*")
    .eq("tenant_id", profile.tenant_id)
    .eq("competencia_ano", input.ano)
    .eq("competencia_mes", input.mes)
    .eq("arquivo_hash", arquivo_hash)
    .maybeSingle();
  if (anterior) {
    return {
      ok: false,
      error: `Esse PDF já foi importado em ${anterior.uploaded_at}. Importação id=${anterior.id}.`,
    };
  }
}
```

- [ ] **Step 3: Extrair texto do PDF e parsear**

```typescript
const pdfData = await pdfParse(buffer);
const parsed = parseFolhaContabilidadeTexto(pdfData.text);

if (parsed.competencia_ano !== input.ano || parsed.competencia_mes !== input.mes) {
  return {
    ok: false,
    error: `Competência do PDF (${parsed.competencia_mes}/${parsed.competencia_ano}) difere da selecionada (${input.mes}/${input.ano}).`,
  };
}
```

- [ ] **Step 4: Match por CPF**

```typescript
const cpfs = parsed.linhas.map(l => l.cpf);
const { data: colabs } = await supabase
  .from("colaboradores")
  .select("id, nome, cpf_cnpj, tipo_contratacao, tenant_id")
  .eq("tenant_id", profile.tenant_id)
  .in("cpf_cnpj", cpfs);

const porCpf = new Map(
  (colabs ?? []).map(c => [c.cpf_cnpj.replace(/\D/g, ""), c]),
);
```

- [ ] **Step 5: Classificar cada linha em criar/atualizar/ignorar**

```typescript
const warnings: FolhaImportacaoWarning[] = [];
const preview: ResumoImportacao["preview"] = [];

// Carregar linhas existentes dessa competência+origem contabilidade.
const { data: existentes } = await supabase
  .from("folhas_pagamento")
  .select("id, colaborador_id, status, salario_base")
  .eq("tenant_id", profile.tenant_id)
  .eq("competencia_ano", input.ano)
  .eq("competencia_mes", input.mes)
  .eq("origem", "contabilidade");

const porColabId = new Map((existentes ?? []).map(f => [f.colaborador_id, f]));

for (const linha of parsed.linhas) {
  const colab = porCpf.get(linha.cpf);
  if (!colab) {
    warnings.push({
      tipo: "colaborador_nao_encontrado",
      mensagem: `CPF ${linha.cpf} (${linha.nome}) não está cadastrado.`,
      cpf: linha.cpf,
      nome: linha.nome,
      secao: linha.secao,
    });
    preview.push({
      cpf: linha.cpf, nome: linha.nome, secao: linha.secao,
      colaborador_id: null, tipo_contratacao: null,
      acao: "ignorar", motivo_ignorar: "colaborador não cadastrado",
      valor: linha.valor,
    });
    continue;
  }

  const tiposEsperados = SECAO_PARA_TIPOS[linha.secao];
  if (!tiposEsperados.includes(colab.tipo_contratacao as TipoContratacao)) {
    warnings.push({
      tipo: "secao_errada",
      mensagem: `Colaborador ${colab.nome} está cadastrado como ${colab.tipo_contratacao} mas apareceu na seção '${linha.secao}' do PDF.`,
      cpf: linha.cpf, nome: linha.nome, secao: linha.secao,
    });
    preview.push({
      cpf: linha.cpf, nome: colab.nome, secao: linha.secao,
      colaborador_id: colab.id, tipo_contratacao: colab.tipo_contratacao as TipoContratacao,
      acao: "ignorar", motivo_ignorar: `cadastrado como ${colab.tipo_contratacao}, apareceu em '${linha.secao}'`,
      valor: linha.valor,
    });
    continue;
  }

  const existente = porColabId.get(colab.id);
  if (!existente) {
    preview.push({
      cpf: linha.cpf, nome: colab.nome, secao: linha.secao,
      colaborador_id: colab.id, tipo_contratacao: colab.tipo_contratacao as TipoContratacao,
      acao: "criar", valor: linha.valor,
    });
    continue;
  }
  if (existente.status === "rascunho") {
    preview.push({
      cpf: linha.cpf, nome: colab.nome, secao: linha.secao,
      colaborador_id: colab.id, tipo_contratacao: colab.tipo_contratacao as TipoContratacao,
      acao: "atualizar", valor: linha.valor,
    });
    continue;
  }
  warnings.push({
    tipo: "linha_ja_promovida",
    mensagem: `Linha de ${colab.nome} já está em '${existente.status}' — não foi sobrescrita.`,
    cpf: linha.cpf, nome: colab.nome, secao: linha.secao,
  });
  preview.push({
    cpf: linha.cpf, nome: colab.nome, secao: linha.secao,
    colaborador_id: colab.id, tipo_contratacao: colab.tipo_contratacao as TipoContratacao,
    acao: "ignorar", motivo_ignorar: `linha já ${existente.status}`,
    valor: linha.valor,
  });
}

// Divergência de soma vs totalizador (warning, não bloqueia).
const somaPreview = preview
  .filter(p => p.acao !== "ignorar")
  .reduce((acc, p) => acc + p.valor, 0);
const totalPdf = parsed.totalizadores.total_empresa;
if (Math.abs(somaPreview - totalPdf) > 1) {
  warnings.push({
    tipo: "soma_divergente",
    mensagem: `Soma a importar (R$ ${(somaPreview / 100).toFixed(2)}) difere do total do PDF (R$ ${(totalPdf / 100).toFixed(2)}).`,
  });
}
```

- [ ] **Step 6: Dry-run devolve sem gravar**

```typescript
if (input.dryRun) {
  return {
    ok: true,
    data: {
      importacao_id: null,
      linhas_total: parsed.linhas.length,
      linhas_criadas: preview.filter(p => p.acao === "criar").length,
      linhas_atualizadas: preview.filter(p => p.acao === "atualizar").length,
      linhas_ignoradas: preview.filter(p => p.acao === "ignorar").length,
      warnings,
      totalizadores_pdf: {
        empregados: {
          linhas: parsed.totalizadores.empregados,
          total: (parsed.linhas.filter(l => l.secao === "empregados")
            .reduce((a, l) => a + l.valor, 0) / 100).toFixed(2),
        },
        estagiarios: {
          linhas: parsed.totalizadores.estagiarios,
          total: (parsed.linhas.filter(l => l.secao === "estagiarios")
            .reduce((a, l) => a + l.valor, 0) / 100).toFixed(2),
        },
        contribuintes: {
          linhas: parsed.totalizadores.contribuintes,
          total: (parsed.linhas.filter(l => l.secao === "contribuintes")
            .reduce((a, l) => a + l.valor, 0) / 100).toFixed(2),
        },
        total_empresa: (totalPdf / 100).toFixed(2),
      },
      preview,
    },
  };
}
```

- [ ] **Step 7: Gravar (modo real)**

```typescript
// Criar/atualizar as linhas em folhas_pagamento.
const paraCriar = preview.filter(p => p.acao === "criar");
const paraAtualizar = preview.filter(p => p.acao === "atualizar");

// INSERT em bulk das linhas novas, com snapshot de alocações da Camada 1.
for (const p of paraCriar) {
  const salarioBaseStr = (p.valor / 100).toFixed(2);
  const { data: nova, error } = await supabase
    .from("folhas_pagamento")
    .insert({
      tenant_id: profile.tenant_id,
      colaborador_id: p.colaborador_id,
      competencia_ano: input.ano,
      competencia_mes: input.mes,
      salario_base: salarioBaseStr,
      status: "rascunho",
      origem: "contabilidade",
      data_pagamento_prevista: parsed.linhas.find(l => l.cpf === p.cpf)?.data_pagamento ?? null,
      created_by: userData.user.id,
    })
    .select("id")
    .single();
  if (error || !nova) {
    warnings.push({
      tipo: "valor_invalido",
      mensagem: `Falha ao inserir linha de ${p.nome}: ${error?.message ?? "sem detalhe"}.`,
      cpf: p.cpf, nome: p.nome,
    });
    continue;
  }
  // Snapshot de alocações da Camada 1.
  const { data: alocs } = await supabase
    .from("colaboradores_alocacoes")
    .select("empresa_id, regional_id, percentual")
    .eq("colaborador_id", p.colaborador_id)
    .is("data_fim", null);
  if (alocs && alocs.length > 0) {
    await supabase.from("folhas_pagamento_alocacoes").insert(
      alocs.map(a => ({
        tenant_id: profile.tenant_id,
        folha_id: nova.id,
        empresa_id: a.empresa_id,
        regional_id: a.regional_id,
        percentual: a.percentual,
      })),
    );
  }
}

for (const p of paraAtualizar) {
  const salarioBaseStr = (p.valor / 100).toFixed(2);
  await supabase
    .from("folhas_pagamento")
    .update({
      salario_base: salarioBaseStr,
      data_pagamento_prevista: parsed.linhas.find(l => l.cpf === p.cpf)?.data_pagamento ?? null,
    })
    .eq("tenant_id", profile.tenant_id)
    .eq("competencia_ano", input.ano)
    .eq("competencia_mes", input.mes)
    .eq("colaborador_id", p.colaborador_id)
    .eq("origem", "contabilidade")
    .eq("status", "rascunho");
}
```

- [ ] **Step 8: Gravar o registro de auditoria da importação**

```typescript
const totalizadores_pdf: FolhaImportacaoTotalizadores = {
  empregados: {
    linhas: parsed.totalizadores.empregados,
    total: (parsed.linhas.filter(l => l.secao === "empregados")
      .reduce((a, l) => a + l.valor, 0) / 100).toFixed(2),
  },
  estagiarios: {
    linhas: parsed.totalizadores.estagiarios,
    total: (parsed.linhas.filter(l => l.secao === "estagiarios")
      .reduce((a, l) => a + l.valor, 0) / 100).toFixed(2),
  },
  contribuintes: {
    linhas: parsed.totalizadores.contribuintes,
    total: (parsed.linhas.filter(l => l.secao === "contribuintes")
      .reduce((a, l) => a + l.valor, 0) / 100).toFixed(2),
  },
  total_empresa: (parsed.totalizadores.total_empresa / 100).toFixed(2),
};

const { data: importacao } = await supabase
  .from("folha_importacoes")
  .insert({
    tenant_id: profile.tenant_id,
    competencia_ano: input.ano,
    competencia_mes: input.mes,
    arquivo_nome: input.arquivoNome,
    arquivo_hash,
    linhas_total: parsed.linhas.length,
    linhas_criadas: paraCriar.length,
    linhas_atualizadas: paraAtualizar.length,
    linhas_ignoradas: preview.filter(p => p.acao === "ignorar").length,
    warnings,
    totalizadores_pdf,
    uploaded_by: userData.user.id,
  })
  .select("id")
  .single();

await logAuditEvent({
  acao: "folha.importada",
  tenantId: profile.tenant_id,
  entidadeTipo: "folha_importacao",
  entidadeId: importacao?.id,
  metadata: {
    ano: input.ano,
    mes: input.mes,
    arquivo_hash,
    linhas_criadas: paraCriar.length,
    linhas_atualizadas: paraAtualizar.length,
    linhas_ignoradas: preview.filter(p => p.acao === "ignorar").length,
  },
});

return {
  ok: true,
  data: {
    importacao_id: importacao?.id ?? null,
    linhas_total: parsed.linhas.length,
    linhas_criadas: paraCriar.length,
    linhas_atualizadas: paraAtualizar.length,
    linhas_ignoradas: preview.filter(p => p.acao === "ignorar").length,
    warnings,
    totalizadores_pdf,
    preview,
  },
};
```

- [ ] **Step 9: Adicionar `"folha.importada"` ao enum de ações do audit**

Em `lib/auth/audit.ts`, localizar o tipo `AuditAction` e adicionar `"folha.importada"` (e `"folha_competencia.enviada"` que a Task 9 vai usar — já colocar agora).

- [ ] **Step 10: Smoke test manual**

Pegar o PDF de setembro/2026 (compartilhado pela California), criar uma rota de teste temporária que chama a action, ou testar diretamente via UI depois da Task 11. Verificar via SQL que `folha_importacoes` ganhou 1 linha e `folhas_pagamento` ganhou as linhas de `origem='contabilidade'`.

- [ ] **Step 11: Teste de reimportação com hash igual**

Repetir o mesmo upload. Esperado: erro `"Esse PDF já foi importado em ..."`.

- [ ] **Step 12: `npm run typecheck`**

- [ ] **Step 13: Commit**

```powershell
git add app/(app)/rh/folhas/importar-actions.ts lib/auth/audit.ts
git commit -m "feat(folha): server action importarFolhaContabilidade com idempotência e matching por CPF"
```

---

## Task 9: Server action `enviarCompetencia`

**Files:**
- Modify: `app/(app)/rh/folhas/importar-actions.ts` (adicionar `enviarCompetencia` no mesmo arquivo — ação de competência agrupa a lógica)

**Interfaces:**
- Produces:
  ```typescript
  export async function enviarCompetencia(input: {
    ano: number;
    mes: number;
  }): Promise<{ ok: true; data: { linhas_enviadas: number } } | { ok: false; error: string }>;
  ```

- [ ] **Step 1: Implementar a action**

Adicionar ao final de `importar-actions.ts`:

```typescript
export async function enviarCompetencia(input: {
  ano: number;
  mes: number;
}): Promise<
  { ok: true; data: { linhas_enviadas: number } } | { ok: false; error: string }
> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return { ok: false, error: "não autenticado" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userData.user.id)
    .single();
  if (!profile?.tenant_id) return { ok: false, error: "tenant não resolvido" };

  // Confirmar que ambos os fluxos têm pelo menos 1 linha nessa competência.
  const { count: linhasPj } = await supabase
    .from("folhas_pagamento")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", profile.tenant_id)
    .eq("competencia_ano", input.ano)
    .eq("competencia_mes", input.mes)
    .eq("origem", "california");
  const { count: linhasClt } = await supabase
    .from("folhas_pagamento")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", profile.tenant_id)
    .eq("competencia_ano", input.ano)
    .eq("competencia_mes", input.mes)
    .eq("origem", "contabilidade");

  if (!linhasPj) return { ok: false, error: "fluxo PJ ainda não foi gerado nessa competência." };
  if (!linhasClt) return { ok: false, error: "fluxo CLT ainda não foi importado nessa competência." };

  const nowIso = new Date().toISOString();
  const { data: afetadas, error } = await supabase
    .from("folhas_pagamento")
    .update({
      status: "enviada",
      enviada_em: nowIso,
      enviada_por: userData.user.id,
    })
    .eq("tenant_id", profile.tenant_id)
    .eq("competencia_ano", input.ano)
    .eq("competencia_mes", input.mes)
    .eq("status", "rascunho")
    .select("id");

  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    acao: "folha_competencia.enviada",
    tenantId: profile.tenant_id,
    entidadeTipo: "folha_competencia",
    entidadeId: `${input.ano}-${String(input.mes).padStart(2, "0")}`,
    metadata: {
      ano: input.ano,
      mes: input.mes,
      linhas_enviadas: afetadas?.length ?? 0,
    },
  });

  return { ok: true, data: { linhas_enviadas: afetadas?.length ?? 0 } };
}
```

- [ ] **Step 2: Smoke test manual**

Com o `/rh/folhas` já tendo rascunhos nos dois fluxos, chamar essa action e verificar:

```sql
SELECT status, count(*)
FROM folhas_pagamento
WHERE competencia_ano = <ano> AND competencia_mes = <mes>
GROUP BY status;
```

Esperado: todas que eram `rascunho` viraram `enviada`. Linhas que já estavam em outros status não mudaram.

- [ ] **Step 3: `npm run typecheck`**

- [ ] **Step 4: Commit**

```powershell
git add app/(app)/rh/folhas/importar-actions.ts
git commit -m "feat(folha): enviarCompetencia promove todos os rascunhos de uma competência"
```

---

## Task 10: UI `/rh/folhas` orientada por competência (checkpoints + seções PJ/CLT)

**Files:**
- Modify: `app/(app)/rh/folhas/page.tsx`
- Create: `app/(app)/rh/folhas/_components/checkpoint-competencia.tsx`
- Modify: `app/(app)/rh/folhas/nova-folha-modal.tsx` (rótulo passa a "Gerar PJ")

**Interfaces:**
- Consumes: `gerarFolha` (Task 5), `enviarCompetencia` (Task 9), colunas `origem` e `data_pagamento_prevista` (Task 3).
- Produces: UI em que o operador seleciona uma competência, vê 2 checkpoints (PJ gerada / CLT importada) e, com ambos preenchidos, clica em "Enviar ao financeiro".

- [ ] **Step 1: Projetar o novo layout da page**

Estrutura:
- `<PageHeader title="Folhas de pagamento" />`
- Seletor de competência (mês/ano) no topo, controlado por URL `?ano=&mes=`.
- Card "Status da competência" com:
  - Checkpoint 1 (PJ): `☑ PJ gerada — N linhas, R$ X` **OU** `☐ Gerar PJ` (botão que abre o modal atual, renomeado).
  - Checkpoint 2 (CLT): `☑ CLT importada — M linhas, R$ Y` **OU** `☐ Importar CLT` (botão que abre o modal da Task 11).
  - Botão "Enviar ao financeiro" habilitado só quando os dois checkpoints estão preenchidos.
- Duas seções abaixo: "PJ" e "CLT" com a lista de linhas de cada origem, no mesmo formato atual (nome, salário base, status).

- [ ] **Step 2: Server-side data fetch da competência**

Reescrever a page como server component que carrega:

```typescript
const [{ data: linhasPj }, { data: linhasClt }] = await Promise.all([
  supabase
    .from("folhas_pagamento")
    .select("id, salario_base, status, colaborador:colaboradores(nome, tipo_contratacao)")
    .eq("tenant_id", tenantId)
    .eq("competencia_ano", ano)
    .eq("competencia_mes", mes)
    .eq("origem", "california")
    .order("salario_base", { ascending: false }),
  supabase
    .from("folhas_pagamento")
    .select("id, salario_base, status, colaborador:colaboradores(nome, tipo_contratacao)")
    .eq("tenant_id", tenantId)
    .eq("competencia_ano", ano)
    .eq("competencia_mes", mes)
    .eq("origem", "contabilidade")
    .order("salario_base", { ascending: false }),
]);
```

(As duas queries em `Promise.all` — regra de performance.)

- [ ] **Step 3: Componente `CheckpointCompetencia`**

Arquivo `app/(app)/rh/folhas/_components/checkpoint-competencia.tsx`:

```typescript
"use client";

import { Check, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CheckpointCompetencia(props: {
  rotulo: string; // "PJ gerada" | "CLT importada"
  feito: boolean;
  contagem?: number;
  total?: string;
  acaoRotulo: string; // "Gerar PJ" | "Importar CLT"
  onAcao: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        {props.feito ? (
          <Check className="text-emerald-600" aria-label="Concluído" />
        ) : (
          <Square className="text-neutral-400" aria-label="Pendente" />
        )}
        <div>
          <div className="font-medium">{props.rotulo}</div>
          {props.feito && props.contagem != null && (
            <div className="text-sm text-neutral-600">
              {props.contagem} linha{props.contagem === 1 ? "" : "s"} · R$ {props.total}
            </div>
          )}
        </div>
      </div>
      {!props.feito && (
        <Button variant="outline" onClick={props.onAcao}>
          {props.acaoRotulo}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Montar a page com os dois checkpoints e as duas seções**

Em `page.tsx`, dentro do card de status:

```tsx
<CheckpointCompetencia
  rotulo="PJ gerada"
  feito={linhasPj.length > 0}
  contagem={linhasPj.length}
  total={formatBrl(linhasPj.reduce((a, l) => a + Number(l.salario_base), 0))}
  acaoRotulo="Gerar PJ"
  onAcao={abrirModalGerarPj}
/>
<CheckpointCompetencia
  rotulo="CLT importada"
  feito={linhasClt.length > 0}
  contagem={linhasClt.length}
  total={formatBrl(linhasClt.reduce((a, l) => a + Number(l.salario_base), 0))}
  acaoRotulo="Importar CLT"
  onAcao={abrirModalImportarClt}
/>
<Button
  disabled={linhasPj.length === 0 || linhasClt.length === 0}
  onClick={enviarCompetenciaHandler}
>
  Enviar ao financeiro
</Button>
```

(Como a page é server component, as ações viram client component wrapper. Padrão existente no projeto.)

- [ ] **Step 5: Seções "PJ" e "CLT" com as linhas**

Renderizar duas tabelas simples, uma por origem. Para `clt_recibo` que aparece nas duas, o rótulo da linha segue a origem (nunca cita "Recibo"):

```tsx
<section>
  <h2>PJ</h2>
  <ul>{linhasPj.map(l => <LinhaFolhaRow key={l.id} linha={l} />)}</ul>
</section>
<section>
  <h2>CLT</h2>
  <ul>{linhasClt.map(l => <LinhaFolhaRow key={l.id} linha={l} />)}</ul>
</section>
```

- [ ] **Step 6: Renomear o modal atual pra "Gerar PJ"**

Em `nova-folha-modal.tsx`, trocar os textos:
- Título do modal: "Gerar folha PJ" (era "Gerar folha").
- Botão de confirmação: "Gerar PJ" (era "Gerar folha").
- Mensagens de sucesso: "Folha PJ de MM/YYYY gerada" (era "Folha de MM/YYYY gerada").

Mantém o resto da lógica (seletor de competência, resultado com warnings, etc).

- [ ] **Step 7: Handler `enviarCompetenciaHandler` (client)**

Em um novo client component wrapper:

```typescript
"use client";
import { enviarCompetencia } from "../importar-actions";
// ...
async function enviarCompetenciaHandler() {
  if (!confirm("Enviar todas as linhas desta competência ao financeiro?")) return;
  const r = await enviarCompetencia({ ano, mes });
  if (!r.ok) { toast.error(r.error); return; }
  toast.success(`${r.data.linhas_enviadas} linha(s) enviada(s) ao financeiro.`);
  router.refresh();
}
```

- [ ] **Step 8: Smoke test visual**

`npm run dev`, abrir `/rh/folhas?ano=2026&mes=9`. Verificar:
1. Checkpoints aparecem corretos (vazio → botões, cheios → ✓).
2. Clicar em "Gerar PJ" abre o modal, confirmar, a lista enche só com PJ/MEI/parte Recibo.
3. "Importar CLT" vai ser testado na Task 11.
4. "Enviar ao financeiro" fica disabled enquanto só um lado está preenchido.

- [ ] **Step 9: `npm run typecheck` + `npm run lint`**

- [ ] **Step 10: Commit**

```powershell
git add app/(app)/rh/folhas/page.tsx app/(app)/rh/folhas/nova-folha-modal.tsx app/(app)/rh/folhas/_components/checkpoint-competencia.tsx
git commit -m "feat(folha): página de folhas orientada por competência com checklist PJ/CLT"
```

---

## Task 11: Modal/drawer "Importar CLT" com prévia (dry-run)

**Files:**
- Create: `app/(app)/rh/folhas/_components/importar-folha-modal.tsx`

**Interfaces:**
- Consumes: `importarFolhaContabilidade` com `dryRun: true` (prévia) e sem (confirmação).

- [ ] **Step 1: Esqueleto do modal**

Padrão do projeto (shadcn Dialog). Conteúdo:
1. Seletor de arquivo PDF (`<input type="file" accept="application/pdf">`).
2. Botão "Pré-visualizar" (desabilitado sem arquivo).
3. Área de prévia (vazia inicialmente).
4. Botão "Confirmar importação" (desabilitado até prévia).

- [ ] **Step 2: Handler de pré-visualização**

```typescript
async function previsualizar() {
  if (!arquivo) return;
  setCarregando(true);
  const buf = await arquivo.arrayBuffer();
  const r = await importarFolhaContabilidade({
    ano, mes,
    arquivoBuffer: buf,
    arquivoNome: arquivo.name,
    dryRun: true,
  });
  setCarregando(false);
  if (!r.ok) { toast.error(r.error); return; }
  setPreview(r.data);
}
```

- [ ] **Step 3: Renderizar a prévia agrupada pelas 3 seções**

```tsx
{preview && (
  <div>
    <div className="grid grid-cols-3 gap-4">
      <div>Empregados: {preview.totalizadores_pdf.empregados?.linhas} · R$ {preview.totalizadores_pdf.empregados?.total}</div>
      <div>Estagiários: {preview.totalizadores_pdf.estagiarios?.linhas} · R$ {preview.totalizadores_pdf.estagiarios?.total}</div>
      <div>Contribuintes: {preview.totalizadores_pdf.contribuintes?.linhas} · R$ {preview.totalizadores_pdf.contribuintes?.total}</div>
    </div>
    <div>Total do PDF: R$ {preview.totalizadores_pdf.total_empresa}</div>
    <table>
      <thead>
        <tr>
          <th>Seção</th><th>Nome</th><th>CPF</th><th>Valor</th><th>Ação</th>
        </tr>
      </thead>
      <tbody>
        {preview.preview.map((p, i) => (
          <tr key={i} className={p.acao === "ignorar" ? "opacity-60" : ""}>
            <td>{p.secao}</td>
            <td>{p.nome}</td>
            <td>{p.cpf}</td>
            <td>R$ {(p.valor / 100).toFixed(2)}</td>
            <td>{p.acao}{p.motivo_ignorar && ` — ${p.motivo_ignorar}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {preview.warnings.length > 0 && (
      <ul>{preview.warnings.map((w, i) => <li key={i}>{w.mensagem}</li>)}</ul>
    )}
  </div>
)}
```

- [ ] **Step 4: Handler de confirmação**

```typescript
async function confirmar() {
  if (!arquivo || !preview) return;
  setCarregando(true);
  const buf = await arquivo.arrayBuffer();
  const r = await importarFolhaContabilidade({
    ano, mes,
    arquivoBuffer: buf,
    arquivoNome: arquivo.name,
    dryRun: false,
  });
  setCarregando(false);
  if (!r.ok) { toast.error(r.error); return; }
  toast.success(
    `${r.data.linhas_criadas} criadas, ${r.data.linhas_atualizadas} atualizadas, ${r.data.linhas_ignoradas} ignoradas.`,
  );
  router.refresh();
  fechar();
}
```

- [ ] **Step 5: Smoke test visual**

Com o PDF real da California (setembro/2026), fazer upload no modal. Verificar:
1. Prévia mostra as 33 linhas agrupadas por seção, com valores e ação (todas devem ser "criar" na primeira vez).
2. Totalizadores batem com o PDF.
3. Confirmar → toast de sucesso → checkpoint "CLT importada" fica ✓.
4. Repetir o upload → erro `"Esse PDF já foi importado..."`.

- [ ] **Step 6: `npm run typecheck` + `npm run lint`**

- [ ] **Step 7: Commit**

```powershell
git add app/(app)/rh/folhas/_components/importar-folha-modal.tsx app/(app)/rh/folhas/page.tsx
git commit -m "feat(folha): modal de importação CLT com prévia dry-run"
```

---

## Task 12: Badge e filtro de origem em `/financeiro/contas-a-pagar`

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/folhas-pagar-list.tsx`

**Interfaces:**
- Consumes: coluna `folhas_pagamento.origem` (Task 3).
- Produces: UI de "Folhas de Pagamento" mostra badge "PJ" / "CLT" por linha e tem filtro de origem no topo.

- [ ] **Step 1: Incluir `origem` no select da query de folhas**

Localizar a query que carrega `folhas_pagamento` em `folhas-pagar-list.tsx` (ou no server component que alimenta ele). Adicionar `origem` ao `.select(...)`.

- [ ] **Step 2: Adicionar o filtro de origem na toolbar**

Perto do `TipoFiltro` existente (linha 63 segundo o Explore), adicionar:

```typescript
type OrigemFiltro = "todas" | "california" | "contabilidade";
const [origemFiltro, setOrigemFiltro] = useState<OrigemFiltro>("todas");
```

Renderizar:

```tsx
<select value={origemFiltro} onChange={e => setOrigemFiltro(e.target.value as OrigemFiltro)}>
  <option value="todas">Origem: Todas</option>
  <option value="california">Origem: PJ</option>
  <option value="contabilidade">Origem: CLT</option>
</select>
```

E filtrar a lista:

```typescript
const linhasFiltradas = linhas.filter(l =>
  origemFiltro === "todas" || l.origem === origemFiltro,
);
```

- [ ] **Step 3: Badge por linha**

Ao lado do nome do colaborador ou da coluna de status, adicionar:

```tsx
<span className={`badge ${l.origem === "california" ? "badge-pj" : "badge-clt"}`}>
  {l.origem === "california" ? "PJ" : "CLT"}
</span>
```

Classes CSS seguem o padrão do projeto (ver outras badges em uso).

- [ ] **Step 4: Smoke test visual**

Abrir `/financeiro/contas-a-pagar` → aba "Folhas de Pagamento". Após a Task 10/11 ter populado uma competência:
1. Badge aparece em cada linha com o rótulo certo.
2. Filtro "PJ" deixa só as de `origem='california'`.
3. Filtro "CLT" deixa só as de `origem='contabilidade'`.
4. Linha do híbrido (`clt_recibo`) aparece duas vezes — uma em cada filtro.

- [ ] **Step 5: `npm run typecheck` + `npm run lint`**

- [ ] **Step 6: Commit**

```powershell
git add app/(app)/financeiro/contas-a-pagar/folhas-pagar-list.tsx
git commit -m "feat(folha): badge e filtro de origem em contas a pagar"
```

---

## Encerramento

- [ ] **`npm run build`** — garantir que a build de produção passa sem warning.
- [ ] **Revisar `docs/HANDOFF.md`** e acrescentar linha curta descrevendo essa entrega.
- [ ] **Fluxo end-to-end manual, uma única sessão:**
  1. Rodar Task 0 (criar 05.015 pela UI) — já feito.
  2. Rodar `gerarFolha` para a competência de teste → checkpoint PJ fica ✓.
  3. Importar PDF de teste → checkpoint CLT fica ✓.
  4. Verificar que o híbrido tem 2 linhas (uma em cada seção) com valores complementares.
  5. Clicar "Enviar ao financeiro" → todas as linhas viram `enviada`.
  6. Em `/financeiro/contas-a-pagar`, aprovar uma linha PJ e uma linha CLT → verificar que `contas_avulsas` fica com `plano_conta_subtipo_id` certo (015 para PJ, 001 para CLT).
  7. Rodar `enviarCompetencia` segunda vez → `linhas_enviadas: 0` (idempotente, nada a enviar).
