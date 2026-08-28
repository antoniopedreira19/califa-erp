# Relatório de Rentabilidade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a rota `/relatorios/rentabilidade` — dashboard gerencial de rentabilidade por Cliente/Marca/Job com filtros, toggle Previsto/Realizado e comparativo de 2 períodos — sem regredir performance nem divergir do cálculo já validado nas telas de job.

**Architecture:** View SQL `vw_job_rentabilidade` agrega as bases por job (faturamento previsto/realizado, imposto, custo realizado, BV realizado). A fórmula continua fonte-única em `lib/calculos/versao-totais.ts` — `calcularResultadoOperacional` roda sobre a soma das bases do grupo, nunca sobre média de percentuais. Filtros vivem em query string; agregação por dimensão acontece em memória depois da query única.

**Tech Stack:** Next.js App Router (Server Components), Supabase (Postgres + RLS `security_invoker`), TypeScript, shadcn/ui + Radix (Popover, MultiSelect), Tailwind. Sem framework de teste — testes rodam via `npx tsx scripts/<nome>.ts` no padrão de `scripts/conferir-save.ts`.

**Spec:** [docs/superpowers/specs/2026-08-28-relatorio-rentabilidade-design.md](../specs/2026-08-28-relatorio-rentabilidade-design.md)

## Global Constraints

- **Fluxo do banco:** ler o banco pelo MCP antes de codar; escrever migration em `supabase/migrations/` com racional comentado no topo; aplicar via MCP `apply_migration`; conferir via MCP; commitar migration junto com o código dependente. Nunca criar coluna direto pelo painel Supabase. (CLAUDE.md + docs/FLUXO-BANCO.md)
- **RLS + GRANT:** view herda RLS via `security_invoker`; `GRANT SELECT TO authenticated`; nada pra `anon`.
- **Performance:** `Promise.all` em queries independentes; `force-dynamic` na página; `select` só dos campos usados; nunca `select("*, embed:tabela(*)")` pra contar/somar. (docs/PERFORMANCE.md)
- **Ortografia:** toda string visível ao usuário em pt-BR com acento/cedilha (labels, placeholders, empty states, tooltips, mensagens de erro). Identificadores em código podem ficar sem acento. (CLAUDE.md · Ortografia em português)
- **Tipos manuais:** `lib/types.ts` é escrito à mão — atualizar sempre que migration mexer em coluna usada pelo frontend, no mesmo commit.
- **Fórmula fonte-única:** `calcularResultadoOperacional` de `lib/calculos/versao-totais.ts` é a única implementação da fórmula. Nunca replicar em SQL nem em outro helper.
- **Base do %:** neste relatório, `Rent%_grupo = Result.Op / Faturamento` (não `/ Valor do Job` como no cabeçalho do job — divergência intencional documentada na spec §3.2).
- **Data de referência:** `jobs.data_abertura_financeiro`.
- **Toggle Realizado esconde jobs sem NF:** filtro implícito `faturamento_realizado > 0` no modo realizado.

---

## File Structure

**Criar:**
- `supabase/migrations/20260829100001_vw_job_rentabilidade.sql` — view + índice parcial.
- `lib/relatorios/rentabilidade.ts` — tipos, agregação, thresholds das badges.
- `scripts/conferir-view-rentabilidade.ts` — conferência bloqueante da view vs cálculo do job.
- `scripts/testar-rentabilidade.ts` — asserts das funções puras de agregação.
- `app/(app)/relatorios/page.tsx` — hub com 1 card.
- `app/(app)/relatorios/rentabilidade/page.tsx` — server component principal.
- `app/(app)/relatorios/rentabilidade/parse-filtros.ts` — parseFiltros(searchParams).
- `app/(app)/relatorios/rentabilidade/carregar-linhas.ts` — data fetching da view.
- `app/(app)/relatorios/rentabilidade/filtros-cliente.tsx` — client component dos filtros no topo.
- `app/(app)/relatorios/rentabilidade/tabela-rentabilidade.tsx` — client component da tabela agrupada (single-period).
- `app/(app)/relatorios/rentabilidade/tabela-comparativo.tsx` — client component da tabela comparativa (2 períodos).

**Modificar:**
- `lib/types.ts` — adicionar `LinhaJobRentabilidade`.
- `components/sidebar.tsx` — adicionar item "Relatórios".

---

## Task 1: Migration da view `vw_job_rentabilidade`

**Files:**
- Create: `supabase/migrations/20260829100001_vw_job_rentabilidade.sql`

**Interfaces:**
- Consumes: schemas existentes `jobs`, `orcamentos`, `versoes_orcamento`, `versoes_orcamento_itens`, `job_item_realizado`, `job_envio_faturamento`, `bvs`, `produtos`.
- Produces: `public.vw_job_rentabilidade` com as colunas:
  ```
  job_id uuid, tenant_id uuid, empresa_id uuid, regional_id uuid,
  cliente_id uuid, marca_id uuid, job_codigo text, job_nome text,
  data_abertura_financeiro date,
  faturamento_previsto numeric, imposto_previsto numeric,
  faturamento_realizado numeric, imposto_realizado numeric,
  custo_realizado numeric, bv_realizado numeric
  ```

- [ ] **Step 1: Ler o banco pelo MCP antes de escrever**

Rodar via MCP `mcp__supabase__list_tables` pra confirmar as colunas exatas de `jobs`, `versoes_orcamento`, `versoes_orcamento_itens`, `job_item_realizado`, `job_envio_faturamento`, `bvs`. Especialmente conferir:
- `jobs.faturamento_previsto` existe (visto em types.ts:646).
- `versoes_orcamento.percentual_imposto` e `percentual_honorarios` existem.
- `job_item_realizado.total_realizado` existe e é `numeric`.
- `bvs` tem as colunas usadas por `blocosDoItem` — abrir `lib/calculos/bv-planilha.ts` pra confirmar.
- `produtos.cliente_id` (marca → cliente) existe.

Não seguir sem essa checagem.

- [ ] **Step 2: Ler `lib/calculos/bv-planilha.ts` e `app/(app)/jobs/[jobId]/carregar-detalhe.ts:490-526` pra transcrever a regra A/D e o BV realizado pra SQL**

O custo realizado bruto do job hoje sai de `blocosDoJob.realizado.bruto` — que aplica regra A/D (usa `total_orcado` pros tipos A e D em vez do `total_realizado`, porque esses tipos não geram PP). Precisa replicar exatamente em SQL. Referência: as constantes `TIPOS_CUSTO`, `REGRAS_TIPO_CUSTO` e a função `blocosDoItem` no `bv-planilha.ts`.

BV realizado igual — sai de `.realizado.deducaoBv`. Ler a lógica antes de traduzir.

- [ ] **Step 3: Escrever a migration**

Criar arquivo `supabase/migrations/20260829100001_vw_job_rentabilidade.sql`:

```sql
-- 2026-08-29 · Relatório de Rentabilidade
--
-- View agrega, por job, as bases usadas na fórmula gerencial de rentabilidade:
-- faturamento previsto/realizado, imposto previsto/realizado, custo realizado
-- bruto (com regra A/D) e BV realizado. A fórmula de Result.Op continua em
-- lib/calculos/versao-totais.ts — esta view só entrega inputs prontos pra
-- evitar carregar itens de 100 jobs no server component.
--
-- Regra A/D no custo: tipos A e D não geram PP; o realizado desses itens é
-- o próprio total_orcado. Espelha blocosDoItem() em lib/calculos/bv-planilha.ts.
-- Se essa lógica mudar lá, mudar aqui no mesmo commit — o script de conferência
-- (scripts/conferir-view-rentabilidade.ts) trava divergências.
--
-- Segurança: security_invoker herda RLS por tenant das tabelas subjacentes.
-- GRANT explícito pra authenticated (regra do projeto).

CREATE OR REPLACE VIEW public.vw_job_rentabilidade
WITH (security_invoker = true) AS
SELECT
  j.id                                            AS job_id,
  j.tenant_id,
  j.empresa_id,
  j.regional_id,
  o.cliente_id,
  j.produto_id                                    AS marca_id,
  j.codigo                                        AS job_codigo,
  j.nome                                          AS job_nome,
  j.data_abertura_financeiro,

  COALESCE(j.faturamento_previsto, 0)             AS faturamento_previsto,
  COALESCE(imp_prev.imposto, 0)                   AS imposto_previsto,

  COALESCE(fr.total, 0)                           AS faturamento_realizado,
  -- Imposto realizado: mesma taxa da versão aprovada, gross-up sobre fat_realizado.
  CASE
    WHEN COALESCE(fr.total, 0) = 0 THEN 0
    WHEN v.percentual_imposto >= 100 THEN 0
    ELSE COALESCE(fr.total, 0)
         * (v.percentual_imposto / 100.0)
         / (1 - v.percentual_imposto / 100.0)
  END                                              AS imposto_realizado,

  COALESCE(cr.total, 0)                           AS custo_realizado,
  COALESCE(bv.total, 0)                           AS bv_realizado

FROM public.jobs j
JOIN public.orcamentos o           ON o.id = j.orcamento_id
JOIN public.versoes_orcamento v    ON v.id = j.versao_orcamento_aprovada_id

-- Imposto previsto: replica calcularTotaisVersao().imposto sobre os itens.
-- É o gross-up sobre (baseImposto = ΣtiposComImposto + honorários).
LEFT JOIN LATERAL (
  SELECT
    CASE
      WHEN v.percentual_imposto >= 100 THEN 0
      ELSE (
        (
          -- baseImposto: soma dos tipos com flag imposto=true (B, C)
          COALESCE(SUM(voi.total_orcado) FILTER (WHERE voi.tipo_custo IN ('B','C')), 0)
          -- + honorários (sobre tipos com honorarios=true: A, AR, B, D, F)
          + COALESCE(SUM(voi.total_orcado) FILTER (WHERE voi.tipo_custo IN ('A','AR','B','D','F')), 0)
            * (v.percentual_honorarios / 100.0)
        )
        * (v.percentual_imposto / 100.0)
        / (1 - v.percentual_imposto / 100.0)
      )
    END AS imposto
  FROM public.versoes_orcamento_itens voi
  WHERE voi.versao_orcamento_id = j.versao_orcamento_aprovada_id
    AND COALESCE(voi.em_save, false) = false  -- linha em save fica de fora
) imp_prev ON true

-- Faturamento realizado: soma das NFs enviadas.
LEFT JOIN LATERAL (
  SELECT SUM(valor_faturado) AS total
  FROM public.job_envio_faturamento
  WHERE job_id = j.id
) fr ON true

-- Custo realizado bruto: regra A/D usa total_orcado; demais tipos usam
-- total_realizado da tabela job_item_realizado.
LEFT JOIN LATERAL (
  SELECT SUM(
    CASE
      WHEN voi.tipo_custo IN ('A','D') THEN voi.total_orcado
      ELSE COALESCE(jir.total_realizado, 0)
    END
  ) AS total
  FROM public.versoes_orcamento_itens voi
  LEFT JOIN public.job_item_realizado jir
    ON jir.item_id = voi.id AND jir.job_id = j.id
  WHERE voi.versao_orcamento_id = j.versao_orcamento_aprovada_id
    AND COALESCE(voi.em_save, false) = false
) cr ON true

-- BV realizado: soma dos BVs com situação 'realizado' vinculados ao job.
-- CONFIRMAR nome da coluna de situação em bvs no Step 1 antes de subir.
LEFT JOIN LATERAL (
  SELECT SUM(valor_liquido) AS total
  FROM public.bvs
  WHERE job_id = j.id
    AND situacao = 'realizado'
) bv ON true

WHERE j.data_abertura_financeiro IS NOT NULL
  AND j.status NOT IN ('cancelado', 'aguardando_abertura', 'rejeitado_financeiro');

GRANT SELECT ON public.vw_job_rentabilidade TO authenticated;

-- Índice parcial pra acelerar filtros por período. `data_abertura_financeiro`
-- é o pivô do relatório (spec §3.5).
CREATE INDEX IF NOT EXISTS idx_jobs_abertura_financeiro
  ON public.jobs (tenant_id, data_abertura_financeiro)
  WHERE data_abertura_financeiro IS NOT NULL
    AND status NOT IN ('cancelado','aguardando_abertura','rejeitado_financeiro');
```

**Ponto de atenção:** os nomes das colunas `bvs.situacao` e `bvs.valor_liquido` (última LEFT JOIN LATERAL) precisam ser conferidos no Step 1. Se o campo se chamar diferente (ex: `bvs.status`, `bvs.valor`), ajustar antes de aplicar.

- [ ] **Step 4: Aplicar via MCP**

Usar `mcp__supabase-write__apply_migration` com o nome `vw_job_rentabilidade` e o corpo do arquivo.

- [ ] **Step 5: Conferir via MCP que aplicou**

Rodar via `mcp__supabase__execute_sql`:

```sql
SELECT * FROM vw_job_rentabilidade LIMIT 3;
```

Esperado: 3 linhas, todas com `tenant_id` do tenant Agência California, colunas populadas (faturamento_previsto > 0 pra jobs abertos).

Também:

```sql
SELECT COUNT(*) FROM vw_job_rentabilidade;
```

Comparar com `SELECT COUNT(*) FROM jobs WHERE data_abertura_financeiro IS NOT NULL AND status NOT IN ('cancelado','aguardando_abertura','rejeitado_financeiro')`. Devem bater.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260829100001_vw_job_rentabilidade.sql
git commit -m "feat(relatorios): view vw_job_rentabilidade agrega bases por job"
```

---

## Task 2: Tipo `LinhaJobRentabilidade` em `lib/types.ts`

**Files:**
- Modify: `lib/types.ts` (append no final da seção "relatórios" ou perto do fim do arquivo)

**Interfaces:**
- Consumes: nenhum
- Produces: `interface LinhaJobRentabilidade` — usado por `carregar-linhas.ts`, `rentabilidade.ts`, `tabela-*.tsx`.

- [ ] **Step 1: Adicionar interface em `lib/types.ts`**

Buscar boa posição no arquivo (após os tipos de job, antes de tipos que sejam de outros domínios). Adicionar:

```typescript
/**
 * Uma linha da view `vw_job_rentabilidade`: um job, com todas as bases
 * agregadas prontas pra fórmula gerencial rodar em memória.
 *
 * A view soma os itens; a fórmula de Result.Op continua em
 * `lib/calculos/versao-totais.ts`. Ver spec 2026-08-28.
 */
export interface LinhaJobRentabilidade {
  job_id: string;
  tenant_id: string;
  empresa_id: string;
  regional_id: string | null;
  cliente_id: string;
  marca_id: string | null;
  job_codigo: string;
  job_nome: string;
  data_abertura_financeiro: string;

  faturamento_previsto: number;
  imposto_previsto: number;
  faturamento_realizado: number;
  imposto_realizado: number;
  custo_realizado: number;
  bv_realizado: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "feat(relatorios): tipo LinhaJobRentabilidade"
```

---

## Task 3: Helper de agregação `lib/relatorios/rentabilidade.ts`

**Files:**
- Create: `lib/relatorios/rentabilidade.ts`
- Test: `scripts/testar-rentabilidade.ts`

**Interfaces:**
- Consumes: `LinhaJobRentabilidade` de `lib/types.ts`; `calcularResultadoOperacional` de `lib/calculos/versao-totais.ts`.
- Produces:
  - `type ModoRentabilidade = "previsto" | "realizado"`
  - `type VisaoRentabilidade = "cliente" | "marca" | "job"`
  - `interface BasesAgregadas { faturamento, imposto, custo, bv, resultadoOperacional, resultadoGeral }`
  - `interface GrupoRentabilidade { chave, rotulo, bases, jobs, representatividadePct }`
  - `function agregarBases(linhas, modo): BasesAgregadas`
  - `function agruparEComputar(linhas, visao, modo, resolveRotulo): GrupoRentabilidade[]`
  - `function classificarRentBadge(pct): "verde" | "laranja" | "vermelho"` (threshold 20%)
  - `const THRESHOLD_RENT_VERDE = 20`

- [ ] **Step 1: Escrever o teste primeiro**

Criar `scripts/testar-rentabilidade.ts`:

```typescript
/**
 * Testa as funções puras de `lib/relatorios/rentabilidade.ts`.
 *
 * Sem framework de teste no projeto — segue o padrão de `scripts/conferir-save.ts`:
 * um `assert()` local, contagem de falhas, exit 1 em caso de erro.
 *
 * Rodar com: npx tsx scripts/testar-rentabilidade.ts
 */
import {
  agregarBases,
  agruparEComputar,
  classificarRentBadge,
  THRESHOLD_RENT_VERDE,
} from "../lib/relatorios/rentabilidade";
import type { LinhaJobRentabilidade } from "../lib/types";

let falhas = 0;
function assert(rotulo: string, cond: boolean, extra?: string) {
  if (!cond) {
    falhas += 1;
    console.log(`  FALHA  ${rotulo}${extra ? ` — ${extra}` : ""}`);
  } else {
    console.log(`  ok     ${rotulo}`);
  }
}

const linha = (over: Partial<LinhaJobRentabilidade>): LinhaJobRentabilidade => ({
  job_id: "j1", tenant_id: "t", empresa_id: "e", regional_id: null,
  cliente_id: "c1", marca_id: null, job_codigo: "J-001", job_nome: "Job 1",
  data_abertura_financeiro: "2026-01-01",
  faturamento_previsto: 0, imposto_previsto: 0,
  faturamento_realizado: 0, imposto_realizado: 0,
  custo_realizado: 0, bv_realizado: 0,
  ...over,
});

console.log("\n=== 1. agregarBases · modo previsto ===");
{
  const r = agregarBases(
    [
      linha({ faturamento_previsto: 100000, imposto_previsto: 20000, custo_realizado: 60000, bv_realizado: 5000 }),
      linha({ faturamento_previsto: 50000, imposto_previsto: 10000, custo_realizado: 30000, bv_realizado: 2000 }),
    ],
    "previsto",
  );
  assert("faturamento soma", Math.abs(r.faturamento - 150000) < 0.01);
  assert("imposto soma", Math.abs(r.imposto - 30000) < 0.01);
  assert("custo soma", Math.abs(r.custo - 90000) < 0.01);
  assert("bv soma", Math.abs(r.bv - 7000) < 0.01);
  // Result.Op = 150000 - 30000 - (90000 - 7000) = 37000
  assert("resultOp", Math.abs((r.resultadoOperacional ?? 0) - 37000) < 0.01);
  // Rent% = 37000 / 150000 = 24,666...
  assert("rentGeral", Math.abs((r.resultadoGeral ?? 0) - 24.6667) < 0.01);
}

console.log("\n=== 2. agregarBases · modo realizado usa colunas realizadas ===");
{
  const r = agregarBases(
    [linha({ faturamento_realizado: 80000, imposto_realizado: 16000, custo_realizado: 50000, bv_realizado: 3000 })],
    "realizado",
  );
  assert("faturamento realizado", Math.abs(r.faturamento - 80000) < 0.01);
  assert("imposto realizado", Math.abs(r.imposto - 16000) < 0.01);
  // Result.Op = 80000 - 16000 - (50000 - 3000) = 17000
  assert("resultOp realizado", Math.abs((r.resultadoOperacional ?? 0) - 17000) < 0.01);
}

console.log("\n=== 3. Grupo sem custo devolve resultadoGeral null ===");
{
  const r = agregarBases([linha({ faturamento_previsto: 10000 })], "previsto");
  assert("sem custo → resultOp null", r.resultadoOperacional === null);
  assert("sem custo → resultGeral null", r.resultadoGeral === null);
}

console.log("\n=== 4. Grupo faturamento zero devolve resultadoGeral null ===");
{
  const r = agregarBases(
    [linha({ custo_realizado: 5000 })], // sem faturamento
    "previsto",
  );
  assert("fat 0 → resultGeral null", r.resultadoGeral === null);
}

console.log("\n=== 5. agruparEComputar agrupa por cliente e ordena por faturamento desc ===");
{
  const linhas = [
    linha({ job_id: "a", cliente_id: "c1", faturamento_previsto: 100, custo_realizado: 50 }),
    linha({ job_id: "b", cliente_id: "c2", faturamento_previsto: 200, custo_realizado: 100 }),
    linha({ job_id: "c", cliente_id: "c1", faturamento_previsto: 50, custo_realizado: 20 }),
  ];
  const grupos = agruparEComputar(linhas, "cliente", "previsto", (id) => `Cliente ${id}`);
  assert("2 grupos", grupos.length === 2);
  assert("primeiro é c2 (maior fat)", grupos[0].chave === "c2");
  assert("c1 tem 2 jobs", grupos.find((g) => g.chave === "c1")?.jobs.length === 2);
  assert("c1 fat total 150", Math.abs((grupos.find((g) => g.chave === "c1")?.bases.faturamento ?? 0) - 150) < 0.01);
  // Rep% de c2 = 200/350 × 100 ≈ 57,14%
  assert("rep% c2", Math.abs((grupos.find((g) => g.chave === "c2")?.representatividadePct ?? 0) - 57.14) < 0.1);
}

console.log("\n=== 6. Rent% do grupo NÃO é média dos jobs (recalcula das bases) ===");
{
  // Job A: fat 100, custo 10 → Rent 90%
  // Job B: fat 100, custo 90 → Rent 10%
  // Grupo: fat 200, custo 100 → Rent 50% (NÃO 50% média coincidente; testa via imposto)
  // Vamos usar imposto pra garantir que a diferença apareça:
  // Job A: fat 100, imp 20, custo 10, bv 0 → resOp 70, rent 70%
  // Job B: fat 100, imp 20, custo 50, bv 0 → resOp 30, rent 30%
  // Grupo: fat 200, imp 40, custo 60, bv 0 → resOp 100, rent 50%
  // Média dos rents = (70 + 30)/2 = 50% (coincide neste caso; troca:
  // Job A: fat 200, imp 40, custo 20, bv 0 → resOp 140, rent 70%
  // Job B: fat 100, imp 20, custo 50, bv 0 → resOp 30, rent 30%
  // Grupo: fat 300, imp 60, custo 70, bv 0 → resOp 170, rent 56,67%
  // Média = 50%, diferença 6,67% — teste captura.
  const linhas = [
    linha({ job_id: "a", cliente_id: "c1", faturamento_previsto: 200, imposto_previsto: 40, custo_realizado: 20 }),
    linha({ job_id: "b", cliente_id: "c1", faturamento_previsto: 100, imposto_previsto: 20, custo_realizado: 50 }),
  ];
  const grupos = agruparEComputar(linhas, "cliente", "previsto", (id) => id);
  const c1 = grupos[0];
  // Recalculado: 170 / 300 = 56,67% (não a média 50%)
  assert("rent% recalculado", Math.abs((c1.bases.resultadoGeral ?? 0) - 56.6667) < 0.01);
}

console.log("\n=== 7. Badge thresholds ===");
assert("20% ou mais é verde", classificarRentBadge(THRESHOLD_RENT_VERDE) === "verde");
assert("25% é verde", classificarRentBadge(25) === "verde");
assert("15% é laranja", classificarRentBadge(15) === "laranja");
assert("0% é laranja", classificarRentBadge(0) === "laranja");
assert("-5% é vermelho", classificarRentBadge(-5) === "vermelho");

console.log(`\n${falhas === 0 ? "OK" : "FALHOU"}: ${falhas} erro(s)`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar o teste e conferir que falha**

```bash
npx tsx scripts/testar-rentabilidade.ts
```

Esperado: erro `Cannot find module '../lib/relatorios/rentabilidade'`. É esperado — implementação ainda não existe.

- [ ] **Step 3: Implementar o helper**

Criar `lib/relatorios/rentabilidade.ts`:

```typescript
import type { LinhaJobRentabilidade } from "@/lib/types";
import { calcularResultadoOperacional } from "@/lib/calculos/versao-totais";

/** Modo do toggle Previsto | Realizado (spec §3.3). */
export type ModoRentabilidade = "previsto" | "realizado";

/** Toggle de visualização Cliente | Marca | Job (spec §5.2). */
export type VisaoRentabilidade = "cliente" | "marca" | "job";

/**
 * As 4 bases somadas + o resultado da fórmula.
 *
 * `resultadoOperacional` e `resultadoGeral` são `null` quando a fórmula
 * não roda (custo <= 0 ou faturamento = 0) — a UI mostra travessão.
 */
export interface BasesAgregadas {
  faturamento: number;
  imposto: number;
  custo: number;
  bv: number;
  resultadoOperacional: number | null;
  resultadoGeral: number | null;
}

/** Um grupo da tabela (cliente, marca ou o próprio job na visão flat). */
export interface GrupoRentabilidade {
  chave: string;
  rotulo: string;
  bases: BasesAgregadas;
  /** Jobs individuais dentro do grupo. Na visão "job" tem 1 elemento (ele mesmo). */
  jobs: LinhaJobRentabilidade[];
  /** Representatividade sobre o total do universo filtrado. */
  representatividadePct: number;
}

/**
 * Threshold do badge verde da Rent%. Calibrado pelos mockups
 * (Deezer 29,6% verde, Prefeitura Ambev 7,0% laranja). Constante
 * exportada pra facilitar ajuste sem caça em várias telas.
 */
export const THRESHOLD_RENT_VERDE = 20;

/**
 * Soma as bases das linhas e roda a fórmula UMA vez sobre a soma.
 * A regra dura da spec §3.9: `Rent% do grupo` não é média dos `Rent%`
 * dos jobs — é `Result.Op / Faturamento` recalculado das somas.
 */
export function agregarBases(
  linhas: LinhaJobRentabilidade[],
  modo: ModoRentabilidade,
): BasesAgregadas {
  const faturamento = linhas.reduce(
    (s, l) => s + (modo === "previsto" ? l.faturamento_previsto : l.faturamento_realizado),
    0,
  );
  const imposto = linhas.reduce(
    (s, l) => s + (modo === "previsto" ? l.imposto_previsto : l.imposto_realizado),
    0,
  );
  const custo = linhas.reduce((s, l) => s + l.custo_realizado, 0);
  const bv = linhas.reduce((s, l) => s + l.bv_realizado, 0);

  // `custo - bv` porque BV retorna pra agência, restituindo custo
  // (decisão 022, mesma lógica de components/resumo-resultado.tsx).
  const { resultadoOperacional, resultadoGeral } = calcularResultadoOperacional(
    faturamento,
    imposto,
    custo - bv,
  );

  // `calcularResultadoOperacional` só considera custo — se faturamento zerou,
  // devolveu resultado sem sentido pra %. Força null.
  const resultadoGeralFinal = faturamento > 0 ? resultadoGeral : null;
  return { faturamento, imposto, custo, bv, resultadoOperacional, resultadoGeral: resultadoGeralFinal };
}

/**
 * Agrupa por dimensão (cliente/marca/job), roda `agregarBases` em cada
 * grupo e calcula representatividade % sobre o total.
 *
 * `resolveRotulo` faz o de/para chave → nome legível — o caller passa um
 * `Map<id, nome>` já carregado (evita N queries a partir daqui).
 */
export function agruparEComputar(
  linhas: LinhaJobRentabilidade[],
  visao: VisaoRentabilidade,
  modo: ModoRentabilidade,
  resolveRotulo: (chave: string) => string,
): GrupoRentabilidade[] {
  const chaveDe = (l: LinhaJobRentabilidade): string | null => {
    if (visao === "cliente") return l.cliente_id;
    if (visao === "marca") return l.marca_id;
    return l.job_id;
  };

  const porChave = new Map<string, LinhaJobRentabilidade[]>();
  for (const l of linhas) {
    const c = chaveDe(l);
    if (c === null) continue; // linha sem marca não entra na visão marca
    const lista = porChave.get(c) ?? [];
    lista.push(l);
    porChave.set(c, lista);
  }

  const totalFaturamento = linhas.reduce(
    (s, l) => s + (modo === "previsto" ? l.faturamento_previsto : l.faturamento_realizado),
    0,
  );

  const grupos: GrupoRentabilidade[] = [];
  for (const [chave, jobs] of porChave) {
    const bases = agregarBases(jobs, modo);
    const representatividadePct =
      totalFaturamento > 0 ? (bases.faturamento / totalFaturamento) * 100 : 0;
    grupos.push({
      chave,
      rotulo: resolveRotulo(chave),
      bases,
      jobs,
      representatividadePct,
    });
  }

  // Ordena por faturamento desc (padrão da tabela).
  grupos.sort((a, b) => b.bases.faturamento - a.bases.faturamento);
  return grupos;
}

/** Classifica o badge da coluna Rent% pelo threshold. */
export function classificarRentBadge(pct: number | null): "verde" | "laranja" | "vermelho" {
  if (pct === null) return "laranja"; // travessão herda cor neutra
  if (pct >= THRESHOLD_RENT_VERDE) return "verde";
  if (pct >= 0) return "laranja";
  return "vermelho";
}
```

- [ ] **Step 4: Rodar o teste e conferir que passa**

```bash
npx tsx scripts/testar-rentabilidade.ts
```

Esperado: `OK: 0 erro(s)` e exit 0. Se falhar em algum assert, ajustar a implementação (não o teste).

- [ ] **Step 5: Commit**

```bash
git add lib/relatorios/rentabilidade.ts scripts/testar-rentabilidade.ts
git commit -m "feat(relatorios): helper agregarBases + agruparEComputar com testes"
```

---

## Task 4: Script de conferência `scripts/conferir-view-rentabilidade.ts`

**Files:**
- Create: `scripts/conferir-view-rentabilidade.ts`

**Interfaces:**
- Consumes: `vw_job_rentabilidade` (Task 1), `carregarDetalheJob` do `app/(app)/jobs/[jobId]/carregar-detalhe.ts` (função existente que carrega o job pela via oficial).
- Produces: script executável que exit 1 em caso de divergência entre a view e o cálculo oficial.

- [ ] **Step 1: Ler `carregar-detalhe.ts` pra encontrar a função pública e como chamá-la**

Abrir `app/(app)/jobs/[jobId]/carregar-detalhe.ts` e identificar a função exportada principal (buscar `export async function` ou `export default`). Se ela usar `requireSession()` internamente, precisa de refactor mínimo: extrair uma variante `carregarDetalheJobPorId(supabase, tenantId, jobId)` que aceite tenantId como parâmetro (sem sessão), e a versão original passa a ser um wrapper que chama a nova depois de `requireSession`. O script de conferência importa a variante nova.

Confirmar antes de escrever o script no Step 2 o nome exato da função e a forma dos campos `totaisJob.faturamentoPrevisto`, `totaisJob.imposto`, `custoRealizadoJob`, `bvRealizadoJob` no retorno.

- [ ] **Step 2: Escrever o script**

Criar `scripts/conferir-view-rentabilidade.ts`:

```typescript
/**
 * Confere `vw_job_rentabilidade` (view SQL) contra o cálculo oficial que
 * a tela do job usa (via `carregar-detalhe.ts`).
 *
 * A view soma bases; a tela roda a fórmula em TS. Este script pega N jobs
 * variados (tipos A puro, B puro, com BV, com save, com errata) e verifica
 * que os 4 números que a view produz batem com o que a tela calcula.
 *
 * Divergência = migration errada. Não subir código de UI se este script
 * falhar.
 *
 * Rodar com: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/conferir-view-rentabilidade.ts
 */
import { createClient } from "@supabase/supabase-js";
import { carregarDetalheJob } from "../app/(app)/jobs/[jobId]/carregar-detalhe";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no env.");
  process.exit(1);
}

const supabase = createClient(URL, KEY);
let falhas = 0;
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function conferir(rotulo: string, obtido: number, esperado: number, tol = 0.05) {
  const ok = Math.abs(obtido - esperado) <= tol;
  if (!ok) falhas += 1;
  console.log(
    `  ${ok ? "ok  " : "FALHA"} ${rotulo.padEnd(30)} view=${brl(obtido).padStart(13)}  oficial=${brl(esperado).padStart(13)}`,
  );
}

// Amostra 20 jobs variados. Pega os mais recentes de cada perfil.
const { data: linhasView, error } = await supabase
  .from("vw_job_rentabilidade")
  .select("*")
  .order("data_abertura_financeiro", { ascending: false })
  .limit(20);

if (error || !linhasView) {
  console.error("Erro lendo vw_job_rentabilidade:", error?.message);
  process.exit(1);
}

for (const linha of linhasView) {
  console.log(`\n=== Job ${linha.job_codigo} · ${linha.job_nome} ===`);
  try {
    const detalhe = await carregarDetalheJob(supabase, linha.tenant_id, linha.job_id);
    if (!detalhe) {
      console.log("  ! job não retornou detalhe — pulando");
      continue;
    }
    conferir("faturamento_previsto", linha.faturamento_previsto, detalhe.totaisJob.faturamentoPrevisto);
    conferir("imposto_previsto", linha.imposto_previsto, detalhe.totaisJob.imposto);
    conferir("custo_realizado", linha.custo_realizado, detalhe.custoRealizadoJob);
    conferir("bv_realizado", linha.bv_realizado, detalhe.bvRealizadoJob);
  } catch (e) {
    console.log(`  ! erro carregando detalhe: ${(e as Error).message}`);
    falhas += 1;
  }
}

console.log(`\n${falhas === 0 ? "OK" : "FALHOU"}: ${falhas} divergência(s)`);
process.exit(falhas === 0 ? 0 : 1);
```

**Ponto de atenção:** se `carregarDetalheJob` precisar de tipos específicos de client Supabase (server client vs service client) ou requerer `requireSession`, adaptar. O objetivo é rodar a mesma lógica que a tela do job executa — se precisar de mock parcial, deixar comentário no script explicando.

- [ ] **Step 3: Rodar e conferir**

```bash
$env:SUPABASE_URL="<url>"
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
npx tsx scripts/conferir-view-rentabilidade.ts
```

Esperado: `OK: 0 divergência(s)`. Se aparecer divergência, é bug na view — ajustar a migration (novo timestamp) e reaplicar antes de seguir. **Não seguir com UI se este script falhar.**

- [ ] **Step 4: Commit**

```bash
git add scripts/conferir-view-rentabilidade.ts
# Se ajustou carregar-detalhe.ts pra exportar função:
git add app/(app)/jobs/[jobId]/carregar-detalhe.ts
git commit -m "chore(relatorios): script conferir vw_job_rentabilidade vs cálculo oficial"
```

---

## Task 5: Rota `/relatorios` (hub) + entrada na sidebar

**Files:**
- Create: `app/(app)/relatorios/page.tsx`
- Modify: `components/sidebar.tsx`

**Interfaces:**
- Consumes: `requireSession` de `lib/auth/session`, `createClient` de `lib/supabase/server`, `BarChart3` de `lucide-react`.
- Produces: rota `/relatorios` acessível pela sidebar.

- [ ] **Step 1: Criar a página hub**

Criar `app/(app)/relatorios/page.tsx` copiando a estrutura de `app/(app)/cadastros/page.tsx` (linhas 1-9, 71-97, 158-197):

```typescript
import Link from "next/link";
import { BarChart3, ArrowRight, TrendingUp, type LucideIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  await requireSession();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Relatórios
        </p>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <BarChart3 className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Relatórios gerenciais</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Dashboards de leitura sobre operação e financeiro. Novos relatórios aparecem
          aqui à medida que os módulos vão sendo liberados.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <RelatorioCard
          href="/relatorios/rentabilidade"
          icon={TrendingUp}
          title="Rentabilidade de Jobs"
          description="Faturamento, resultado operacional e rentabilidade por cliente, marca ou job. Comparativo entre períodos."
        />
      </div>
    </div>
  );
}

function RelatorioCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-soft transition-all hover:border-california-red/30 hover:shadow-elevated"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
        <Icon className="h-5 w-5" />
      </div>

      <h3 className="mt-4 text-lg font-semibold text-foreground group-hover:text-california-red transition-colors">
        {title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">Dashboard</span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
          Abrir
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
```

`prefetch={false}` mesmo com um card só — regra do projeto pra hubs (docs/PERFORMANCE.md).

- [ ] **Step 2: Adicionar entrada na sidebar**

Editar `components/sidebar.tsx`. Localizar o array `TOP_LEVEL_LINKS` (ou nome equivalente — vai começar próximo à linha 36 com `{ href: "/home", label: "Home", icon: Home }`). Adicionar entrada nova depois de `/financeiro/desembolsos` e antes de `/admin`:

```typescript
{ href: "/relatorios", label: "Relatórios", icon: BarChart3 },
```

Adicionar `BarChart3` ao import de `lucide-react` no topo do arquivo.

- [ ] **Step 3: Verificar no navegador**

```bash
npm run dev
```

Abrir `http://localhost:3000/relatorios`. Esperado: página com header e 1 card "Rentabilidade de Jobs". Sidebar tem "Relatórios" clicável. Clicar no card leva pra `/relatorios/rentabilidade` (que ainda dá 404 — próxima task).

- [ ] **Step 4: Commit**

```bash
git add app/(app)/relatorios/page.tsx components/sidebar.tsx
git commit -m "feat(relatorios): hub /relatorios com card de rentabilidade + sidebar"
```

---

## Task 6: `parseFiltros` — URL → objeto

**Files:**
- Create: `app/(app)/relatorios/rentabilidade/parse-filtros.ts`
- Test: adicionar bloco no `scripts/testar-rentabilidade.ts`

**Interfaces:**
- Consumes: `ModoRentabilidade`, `VisaoRentabilidade` de `lib/relatorios/rentabilidade`.
- Produces:
  - `interface FiltrosRentabilidade { ano, trimestres, empresasIds, regionaisIds, clientesIds, marcasIds, faturamentoMinimo, modo, visao, compararAno }`
  - `function parseFiltros(searchParams): FiltrosRentabilidade`
  - `function filtrosParaQueryString(filtros): string` (usado pelo componente client pra `router.push`)

- [ ] **Step 1: Escrever o teste primeiro**

Adicionar ao final de `scripts/testar-rentabilidade.ts` (antes do último `console.log`):

```typescript
console.log("\n=== 8. parseFiltros defaults ===");
{
  const { parseFiltros } = await import("../app/(app)/relatorios/rentabilidade/parse-filtros");
  const anoAtual = new Date().getFullYear();

  const f = parseFiltros({});
  assert("ano default = corrente", f.ano === anoAtual);
  assert("trimestres vazio", f.trimestres.length === 0);
  assert("visao default = cliente", f.visao === "cliente");
  assert("modo default = previsto", f.modo === "previsto");
  assert("compararAno null", f.compararAno === null);
  assert("faturamentoMinimo null", f.faturamentoMinimo === null);
}

console.log("\n=== 9. parseFiltros lê multi-select CSV e coerce ===");
{
  const { parseFiltros } = await import("../app/(app)/relatorios/rentabilidade/parse-filtros");
  const f = parseFiltros({
    ano: "2026",
    trimestre: "Q1,Q3",
    cliente: "c1,c2",
    modo: "realizado",
    visao: "marca",
    comparar: "2025",
    fatmin: "1000000",
  });
  assert("ano parsed", f.ano === 2026);
  assert("2 trimestres", f.trimestres.length === 2);
  assert("Q1 presente", f.trimestres.includes("Q1"));
  assert("2 clientes", f.clientesIds.length === 2);
  assert("modo realizado", f.modo === "realizado");
  assert("visao marca", f.visao === "marca");
  assert("compararAno 2025", f.compararAno === 2025);
  assert("faturamentoMinimo 1000000", f.faturamentoMinimo === 1000000);
}

console.log("\n=== 10. filtrosParaQueryString roundtrip ===");
{
  const { parseFiltros, filtrosParaQueryString } = await import(
    "../app/(app)/relatorios/rentabilidade/parse-filtros"
  );
  const original = parseFiltros({
    ano: "2026", trimestre: "Q1", cliente: "c1", modo: "realizado", visao: "job",
  });
  const qs = filtrosParaQueryString(original);
  const parsed = parseFiltros(Object.fromEntries(new URLSearchParams(qs)));
  assert("roundtrip ano", parsed.ano === original.ano);
  assert("roundtrip trimestres", parsed.trimestres.join(",") === original.trimestres.join(","));
  assert("roundtrip modo", parsed.modo === original.modo);
  assert("roundtrip visao", parsed.visao === original.visao);
}
```

- [ ] **Step 2: Rodar e conferir que falha por módulo inexistente**

```bash
npx tsx scripts/testar-rentabilidade.ts
```

Esperado: erro `Cannot find module '../app/(app)/relatorios/rentabilidade/parse-filtros'`.

- [ ] **Step 3: Implementar `parse-filtros.ts`**

Criar `app/(app)/relatorios/rentabilidade/parse-filtros.ts`:

```typescript
import type { ModoRentabilidade, VisaoRentabilidade } from "@/lib/relatorios/rentabilidade";

/** Um trimestre do calendário. */
export type Trimestre = "Q1" | "Q2" | "Q3" | "Q4";
const TRIMESTRES: readonly Trimestre[] = ["Q1", "Q2", "Q3", "Q4"];

/** Estado dos filtros vindos da URL. */
export interface FiltrosRentabilidade {
  ano: number;
  trimestres: Trimestre[];
  empresasIds: string[];
  regionaisIds: string[];
  clientesIds: string[];
  marcasIds: string[];
  /** null = sem filtro. Aplicado depois da agregação (filtra grupo). */
  faturamentoMinimo: number | null;
  modo: ModoRentabilidade;
  visao: VisaoRentabilidade;
  /** Ano do 2º período pra comparar. null = comparativo desligado. */
  compararAno: number | null;
}

type Params = Record<string, string | string[] | undefined>;

function pegar(params: Params, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

function csv(params: Params, key: string): string[] {
  const v = pegar(params, key);
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Lê searchParams e devolve o estado dos filtros com defaults. */
export function parseFiltros(searchParams: Params): FiltrosRentabilidade {
  const anoParam = Number(pegar(searchParams, "ano"));
  const ano = Number.isFinite(anoParam) && anoParam >= 2000 && anoParam <= 2100
    ? anoParam
    : new Date().getFullYear();

  const trimestres = csv(searchParams, "trimestre").filter(
    (t): t is Trimestre => (TRIMESTRES as readonly string[]).includes(t),
  );

  const modoParam = pegar(searchParams, "modo");
  const modo: ModoRentabilidade = modoParam === "realizado" ? "realizado" : "previsto";

  const visaoParam = pegar(searchParams, "visao");
  const visao: VisaoRentabilidade =
    visaoParam === "marca" || visaoParam === "job" ? visaoParam : "cliente";

  const compararRaw = Number(pegar(searchParams, "comparar"));
  const compararAno =
    Number.isFinite(compararRaw) && compararRaw >= 2000 && compararRaw <= 2100
      ? compararRaw
      : null;

  const fatMinRaw = Number(pegar(searchParams, "fatmin"));
  const faturamentoMinimo =
    Number.isFinite(fatMinRaw) && fatMinRaw > 0 ? fatMinRaw : null;

  return {
    ano,
    trimestres,
    empresasIds: csv(searchParams, "empresa"),
    regionaisIds: csv(searchParams, "regional"),
    clientesIds: csv(searchParams, "cliente"),
    marcasIds: csv(searchParams, "marca"),
    faturamentoMinimo,
    modo,
    visao,
    compararAno,
  };
}

/** Serializa filtros pra query string. Omite campos com valor default. */
export function filtrosParaQueryString(f: FiltrosRentabilidade): string {
  const p = new URLSearchParams();
  const anoAtual = new Date().getFullYear();

  if (f.ano !== anoAtual) p.set("ano", String(f.ano));
  if (f.trimestres.length > 0) p.set("trimestre", f.trimestres.join(","));
  if (f.empresasIds.length > 0) p.set("empresa", f.empresasIds.join(","));
  if (f.regionaisIds.length > 0) p.set("regional", f.regionaisIds.join(","));
  if (f.clientesIds.length > 0) p.set("cliente", f.clientesIds.join(","));
  if (f.marcasIds.length > 0) p.set("marca", f.marcasIds.join(","));
  if (f.faturamentoMinimo !== null) p.set("fatmin", String(f.faturamentoMinimo));
  if (f.modo !== "previsto") p.set("modo", f.modo);
  if (f.visao !== "cliente") p.set("visao", f.visao);
  if (f.compararAno !== null) p.set("comparar", String(f.compararAno));

  return p.toString();
}

/**
 * Traduz um período (ano + trimestres) em faixa de datas
 * `data_abertura_financeiro`. Sem trimestres = ano inteiro.
 */
export function periodoParaFaixaDatas(
  ano: number,
  trimestres: Trimestre[],
): { inicio: string; fim: string }[] {
  if (trimestres.length === 0) {
    return [{ inicio: `${ano}-01-01`, fim: `${ano}-12-31` }];
  }
  const map: Record<Trimestre, { m0: number; m1: number }> = {
    Q1: { m0: 1, m1: 3 },
    Q2: { m0: 4, m1: 6 },
    Q3: { m0: 7, m1: 9 },
    Q4: { m0: 10, m1: 12 },
  };
  return trimestres.map((t) => {
    const { m0, m1 } = map[t];
    const ultDia = new Date(ano, m1, 0).getDate();
    return {
      inicio: `${ano}-${String(m0).padStart(2, "0")}-01`,
      fim: `${ano}-${String(m1).padStart(2, "0")}-${ultDia}`,
    };
  });
}
```

- [ ] **Step 4: Rodar o teste e conferir que passa**

```bash
npx tsx scripts/testar-rentabilidade.ts
```

Esperado: todos os asserts `ok`.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/relatorios/rentabilidade/parse-filtros.ts scripts/testar-rentabilidade.ts
git commit -m "feat(relatorios): parseFiltros + query string roundtrip"
```

---

## Task 7: `carregar-linhas.ts` — data fetching da view

**Files:**
- Create: `app/(app)/relatorios/rentabilidade/carregar-linhas.ts`

**Interfaces:**
- Consumes: `SupabaseClient` do server, `LinhaJobRentabilidade`, `FiltrosRentabilidade`, `periodoParaFaixaDatas`.
- Produces: `async function carregarLinhas(supabase, tenantId, filtros): Promise<LinhaJobRentabilidade[]>` — devolve linhas já filtradas por período/empresa/regional/cliente/marca. **Não** aplica `faturamentoMinimo` (esse é depois da agregação).

- [ ] **Step 1: Implementar**

Criar `app/(app)/relatorios/rentabilidade/carregar-linhas.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinhaJobRentabilidade } from "@/lib/types";
import type { FiltrosRentabilidade } from "./parse-filtros";
import { periodoParaFaixaDatas } from "./parse-filtros";

/**
 * Lê `vw_job_rentabilidade` filtrada por período e dimensões.
 *
 * Trimestres somam-se via OR de faixas de data — se o usuário selecionou
 * Q1 e Q3, a query pega jobs abertos em jan-mar OU jul-set. `filter` do
 * postgrest não suporta múltiplos ranges em uma coluna, então quando há
 * mais de 1 trimestre a query é feita N vezes com Promise.all e o
 * resultado é concatenado + dedupe por job_id.
 *
 * `faturamentoMinimo` NÃO é aplicado aqui — ele filtra o grupo depois da
 * agregação (spec §3.6).
 */
export async function carregarLinhas(
  supabase: SupabaseClient,
  tenantId: string,
  ano: number,
  filtros: Omit<FiltrosRentabilidade, "ano" | "compararAno" | "faturamentoMinimo" | "modo" | "visao">,
): Promise<LinhaJobRentabilidade[]> {
  const faixas = periodoParaFaixaDatas(ano, filtros.trimestres);

  const consultarFaixa = async (faixa: { inicio: string; fim: string }) => {
    let query = supabase
      .from("vw_job_rentabilidade")
      .select(
        "job_id, tenant_id, empresa_id, regional_id, cliente_id, marca_id, job_codigo, job_nome, data_abertura_financeiro, faturamento_previsto, imposto_previsto, faturamento_realizado, imposto_realizado, custo_realizado, bv_realizado",
      )
      .eq("tenant_id", tenantId)
      .gte("data_abertura_financeiro", faixa.inicio)
      .lte("data_abertura_financeiro", faixa.fim);

    if (filtros.empresasIds.length > 0) query = query.in("empresa_id", filtros.empresasIds);
    if (filtros.regionaisIds.length > 0) query = query.in("regional_id", filtros.regionaisIds);
    if (filtros.clientesIds.length > 0) query = query.in("cliente_id", filtros.clientesIds);
    if (filtros.marcasIds.length > 0) query = query.in("marca_id", filtros.marcasIds);

    const { data, error } = await query;
    if (error) {
      console.error("[relatorios.rentabilidade.carregar-linhas]", error.message);
      return [];
    }
    return (data ?? []) as LinhaJobRentabilidade[];
  };

  // Uma faixa só (ano inteiro ou 1 trimestre) — query única.
  if (faixas.length === 1) return consultarFaixa(faixas[0]);

  // Múltiplos trimestres — Promise.all + dedupe por job_id.
  const resultados = await Promise.all(faixas.map(consultarFaixa));
  const dedupe = new Map<string, LinhaJobRentabilidade>();
  for (const linhas of resultados) {
    for (const l of linhas) dedupe.set(l.job_id, l);
  }
  return Array.from(dedupe.values());
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(app)/relatorios/rentabilidade/carregar-linhas.ts
git commit -m "feat(relatorios): carregarLinhas com filtros e trimestres"
```

---

## Task 8: Server component `page.tsx` (estrutura + query única)

**Files:**
- Create: `app/(app)/relatorios/rentabilidade/page.tsx`

**Interfaces:**
- Consumes: `parseFiltros`, `carregarLinhas`, `agruparEComputar`, `requireSession`, `createClient`. Também `FiltrosCliente` e `TabelaRentabilidade`/`TabelaComparativo` (próximos tasks).
- Produces: rota funcional `/relatorios/rentabilidade` que faz query, agrega, e passa dados pros client components.

- [ ] **Step 1: Criar page.tsx com apenas single-period (Task 11 adiciona comparativo)**

Criar `app/(app)/relatorios/rentabilidade/page.tsx`:

```typescript
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { agruparEComputar } from "@/lib/relatorios/rentabilidade";
import { parseFiltros } from "./parse-filtros";
import { carregarLinhas } from "./carregar-linhas";
import { FiltrosCliente } from "./filtros-cliente";
import { TabelaRentabilidade } from "./tabela-rentabilidade";
import { TabelaComparativo } from "./tabela-comparativo";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RentabilidadePage({ searchParams }: Props) {
  const session = await requireSession();
  const params = await searchParams;
  const filtros = parseFiltros(params);
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Dimensões pra rotular grupos e alimentar dropdowns.
  const [
    linhasPeriodoA,
    linhasPeriodoB,
    clientesRes,
    marcasRes,
    empresasRes,
    regionaisRes,
  ] = await Promise.all([
    carregarLinhas(supabase, tenantId, filtros.ano, filtros),
    filtros.compararAno !== null
      ? carregarLinhas(supabase, tenantId, filtros.compararAno, filtros)
      : Promise.resolve(null),
    supabase.from("clientes").select("id, nome").eq("tenant_id", tenantId).eq("status", "ativo"),
    supabase.from("produtos").select("id, nome, cliente_id").eq("tenant_id", tenantId),
    supabase.from("empresas").select("id, nome_fantasia, razao_social").eq("tenant_id", tenantId).eq("ativo", true),
    supabase.from("regionais").select("id, nome").eq("tenant_id", tenantId).eq("ativo", true),
  ]);

  const clientesById = new Map(
    (clientesRes.data ?? []).map((c) => [c.id, c.nome]),
  );
  const marcasById = new Map(
    (marcasRes.data ?? []).map((m) => [m.id, m.nome as string]),
  );
  const jobsById = new Map(
    linhasPeriodoA.map((l) => [l.job_id, `${l.job_codigo} · ${l.job_nome}`]),
  );

  const resolveRotulo = (chave: string): string => {
    if (filtros.visao === "cliente") return clientesById.get(chave) ?? "(sem cliente)";
    if (filtros.visao === "marca") return marcasById.get(chave) ?? "(sem marca)";
    return jobsById.get(chave) ?? chave;
  };

  // Filtra pelo modo (Realizado esconde jobs sem NF — spec §3.4).
  const filtrarPorModo = (linhas: typeof linhasPeriodoA) =>
    filtros.modo === "realizado"
      ? linhas.filter((l) => l.faturamento_realizado > 0)
      : linhas;

  const gruposA = agruparEComputar(
    filtrarPorModo(linhasPeriodoA),
    filtros.visao,
    filtros.modo,
    resolveRotulo,
  );

  // Aplica faturamentoMinimo (filtro no grupo, não no job — spec §3.6).
  const gruposFiltradosA =
    filtros.faturamentoMinimo !== null
      ? gruposA.filter((g) => g.bases.faturamento >= filtros.faturamentoMinimo!)
      : gruposA;

  const totalBases = {
    faturamento: gruposFiltradosA.reduce((s, g) => s + g.bases.faturamento, 0),
    imposto: gruposFiltradosA.reduce((s, g) => s + g.bases.imposto, 0),
    custo: gruposFiltradosA.reduce((s, g) => s + g.bases.custo, 0),
    bv: gruposFiltradosA.reduce((s, g) => s + g.bases.bv, 0),
  };

  // Grupos do 2º período pro comparativo (se houver).
  const gruposB = linhasPeriodoB
    ? agruparEComputar(filtrarPorModo(linhasPeriodoB), filtros.visao, filtros.modo, resolveRotulo)
    : null;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Relatórios · Rentabilidade
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          Rentabilidade de Jobs {filtros.ano}
          {filtros.compararAno !== null && ` vs ${filtros.compararAno}`}
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Faturamento, resultado operacional e rentabilidade por cliente, marca ou job.
          Data de referência: abertura financeira do job.
        </p>
      </header>

      <FiltrosCliente
        filtros={filtros}
        clientes={(clientesRes.data ?? []).map((c) => ({ id: c.id, nome: c.nome }))}
        marcas={(marcasRes.data ?? []).map((m) => ({ id: m.id, nome: m.nome, clienteId: m.cliente_id }))}
        empresas={(empresasRes.data ?? []).map((e) => ({
          id: e.id,
          nome: e.nome_fantasia ?? e.razao_social,
        }))}
        regionais={(regionaisRes.data ?? []).map((r) => ({ id: r.id, nome: r.nome }))}
      />

      {gruposB ? (
        <TabelaComparativo
          visao={filtros.visao}
          gruposA={gruposFiltradosA}
          gruposB={gruposB}
          anoA={filtros.ano}
          anoB={filtros.compararAno!}
        />
      ) : (
        <TabelaRentabilidade
          visao={filtros.visao}
          modo={filtros.modo}
          grupos={gruposFiltradosA}
          totalBases={totalBases}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rodar dev e conferir que não quebra (mesmo faltando client components)**

```bash
npm run dev
```

Abrir `/relatorios/rentabilidade`. Vai quebrar por falta dos client components — anotar o erro. Isso é esperado; próximos tasks resolvem.

- [ ] **Step 3: Commit parcial (opcional)**

Se preferir committar server component sozinho vs. tudo junto, aguardar Task 9-11. Sugerido: **não committar** ainda; combinar com filtros e tabela na próxima task.

---

## Task 9: `FiltrosCliente` — client component com filtros

**Files:**
- Create: `app/(app)/relatorios/rentabilidade/filtros-cliente.tsx`

**Interfaces:**
- Consumes: `FiltrosRentabilidade`, `filtrosParaQueryString` de `parse-filtros`, `MultiSelect` de `@/components/ui/multi-select`.
- Produces: componente `FiltrosCliente` que renderiza dropdowns + toggles e faz `router.push` da URL nova.

- [ ] **Step 1: Implementar**

Criar `app/(app)/relatorios/rentabilidade/filtros-cliente.tsx`:

```typescript
"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { MultiSelect } from "@/components/ui/multi-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  type FiltrosRentabilidade,
  filtrosParaQueryString,
  type Trimestre,
} from "./parse-filtros";

const TRIMESTRES: readonly { value: Trimestre; label: string }[] = [
  { value: "Q1", label: "Q1" },
  { value: "Q2", label: "Q2" },
  { value: "Q3", label: "Q3" },
  { value: "Q4", label: "Q4" },
];

interface Props {
  filtros: FiltrosRentabilidade;
  clientes: { id: string; nome: string }[];
  marcas: { id: string; nome: string; clienteId: string }[];
  empresas: { id: string; nome: string }[];
  regionais: { id: string; nome: string }[];
}

export function FiltrosCliente({ filtros, clientes, marcas, empresas, regionais }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const aplicar = (mudanca: Partial<FiltrosRentabilidade>) => {
    const novo = { ...filtros, ...mudanca };
    // Regra 3.7: se cliente saiu, remover marcas órfãs.
    if (mudanca.clientesIds !== undefined) {
      const clientesValidos = new Set(mudanca.clientesIds);
      if (clientesValidos.size > 0) {
        novo.marcasIds = novo.marcasIds.filter((mid) => {
          const marca = marcas.find((m) => m.id === mid);
          return marca && clientesValidos.has(marca.clienteId);
        });
      }
    }
    const qs = filtrosParaQueryString(novo);
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  // Marcas oferecidas ao usuário: filtradas pelos clientes selecionados (spec §3.7).
  const marcasDisponiveis =
    filtros.clientesIds.length > 0
      ? marcas.filter((m) => filtros.clientesIds.includes(m.clienteId))
      : marcas;

  const anos = anosDisponiveis();

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-soft space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo label="Ano">
          <select
            value={filtros.ano}
            onChange={(e) => aplicar({ ano: Number(e.target.value) })}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            {anos.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </Campo>

        <Campo label="Trimestres">
          <div className="flex gap-2">
            {TRIMESTRES.map((t) => {
              const marcado = filtros.trimestres.includes(t.value);
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() =>
                    aplicar({
                      trimestres: marcado
                        ? filtros.trimestres.filter((q) => q !== t.value)
                        : [...filtros.trimestres, t.value].sort() as Trimestre[],
                    })
                  }
                  className={cn(
                    "flex-1 h-9 rounded-md border text-xs font-semibold transition-colors",
                    marcado
                      ? "border-california-red bg-california-red text-white"
                      : "border-border bg-background text-foreground hover:border-california-red/40",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </Campo>

        <Campo label="Empresas">
          <MultiSelect
            items={empresas.map((e) => ({ value: e.id, label: e.nome }))}
            value={filtros.empresasIds}
            onChange={(v) => aplicar({ empresasIds: v })}
            placeholder="Todas"
          />
        </Campo>

        <Campo label="Regionais">
          <MultiSelect
            items={regionais.map((r) => ({ value: r.id, label: r.nome }))}
            value={filtros.regionaisIds}
            onChange={(v) => aplicar({ regionaisIds: v })}
            placeholder="Todas"
          />
        </Campo>

        <Campo label="Clientes">
          <MultiSelect
            items={clientes.map((c) => ({ value: c.id, label: c.nome }))}
            value={filtros.clientesIds}
            onChange={(v) => aplicar({ clientesIds: v })}
            placeholder="Todos"
          />
        </Campo>

        <Campo label="Marcas">
          <MultiSelect
            items={marcasDisponiveis.map((m) => ({ value: m.id, label: m.nome }))}
            value={filtros.marcasIds}
            onChange={(v) => aplicar({ marcasIds: v })}
            placeholder={filtros.clientesIds.length > 0 ? "Todas do cliente" : "Todas"}
          />
        </Campo>

        <Campo label="Faturamento acima de">
          <Input
            type="number"
            inputMode="decimal"
            step="1000"
            placeholder="Ex.: 1.000.000"
            value={filtros.faturamentoMinimo ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value);
              aplicar({ faturamentoMinimo: Number.isFinite(n) && n > 0 ? n : null });
            }}
          />
        </Campo>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
        <TogglePill
          label="Modo"
          opcoes={[
            { valor: "previsto", rotulo: "Previsto" },
            { valor: "realizado", rotulo: "Realizado" },
          ]}
          valor={filtros.modo}
          onChange={(v) => aplicar({ modo: v as FiltrosRentabilidade["modo"] })}
        />

        <TogglePill
          label="Visualizar por"
          opcoes={[
            { valor: "cliente", rotulo: "Cliente" },
            { valor: "marca", rotulo: "Marca" },
            { valor: "job", rotulo: "Job" },
          ]}
          valor={filtros.visao}
          onChange={(v) => aplicar({ visao: v as FiltrosRentabilidade["visao"] })}
        />

        <div className="flex items-center gap-2">
          <Checkbox
            id="comparar"
            checked={filtros.compararAno !== null}
            onCheckedChange={(c) =>
              aplicar({ compararAno: c ? filtros.ano - 1 : null })
            }
          />
          <Label htmlFor="comparar" className="text-sm">Comparar 2 períodos</Label>
          {filtros.compararAno !== null && (
            <select
              value={filtros.compararAno}
              onChange={(e) => aplicar({ compararAno: Number(e.target.value) })}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            >
              {anos
                .filter((a) => a !== filtros.ano)
                .map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
            </select>
          )}
        </div>
      </div>
    </section>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function TogglePill<T extends string>({
  label,
  opcoes,
  valor,
  onChange,
}: {
  label: string;
  opcoes: { valor: T; rotulo: string }[];
  valor: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
        {opcoes.map((o) => (
          <button
            key={o.valor}
            type="button"
            onClick={() => onChange(o.valor)}
            className={cn(
              "px-3 py-1 text-xs font-semibold rounded-md transition-colors",
              valor === o.valor
                ? "bg-california-red text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

function anosDisponiveis(): number[] {
  const atual = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => atual - i);
}
```

- [ ] **Step 2: Commit ainda não — conferir com Task 10**

Adiar commit; a página inteira ainda quebra sem `TabelaRentabilidade`.

---

## Task 10: `TabelaRentabilidade` — tabela agrupada single-period

**Files:**
- Create: `app/(app)/relatorios/rentabilidade/tabela-rentabilidade.tsx`

**Interfaces:**
- Consumes: `GrupoRentabilidade`, `VisaoRentabilidade`, `classificarRentBadge` de `lib/relatorios/rentabilidade`; `formatCurrency` de `lib/utils`.
- Produces: componente `TabelaRentabilidade` (client, com estado de expandir/colapsar).

- [ ] **Step 1: Implementar**

Criar `app/(app)/relatorios/rentabilidade/tabela-rentabilidade.tsx`:

```typescript
"use client";

import * as React from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  classificarRentBadge,
  type GrupoRentabilidade,
  type ModoRentabilidade,
  type VisaoRentabilidade,
} from "@/lib/relatorios/rentabilidade";
import type { LinhaJobRentabilidade } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  visao: VisaoRentabilidade;
  modo: ModoRentabilidade;
  grupos: GrupoRentabilidade[];
  totalBases: {
    faturamento: number;
    imposto: number;
    custo: number;
    bv: number;
  };
}

export function TabelaRentabilidade({ visao, modo, grupos, totalBases }: Props) {
  const [expandidos, setExpandidos] = React.useState<Set<string>>(new Set());

  const toggleExpandir = (chave: string) => {
    setExpandidos((s) => {
      const novo = new Set(s);
      novo.has(chave) ? novo.delete(chave) : novo.add(chave);
      return novo;
    });
  };

  // Total = base filtrada; Rent% do total recalculado.
  const resultOpTotal =
    totalBases.faturamento - totalBases.imposto - (totalBases.custo - totalBases.bv);
  const rentTotalPct =
    totalBases.faturamento > 0 ? (resultOpTotal / totalBases.faturamento) * 100 : null;

  const rotuloVisao =
    visao === "cliente" ? "Clientes" : visao === "marca" ? "Marcas" : "Jobs";

  if (grupos.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum resultado encontrado com os filtros atuais.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">{rotuloVisao}</th>
            <th className="px-4 py-3 text-right font-semibold">Faturamento</th>
            <th className="px-4 py-3 text-right font-semibold">Result. Op</th>
            <th className="px-4 py-3 text-center font-semibold">Rent %</th>
            <th className="px-4 py-3 text-center font-semibold">Rep %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {/* Linha total */}
          <tr className="bg-muted/20 font-bold">
            <td className="px-4 py-3">{rotuloVisao}</td>
            <td className="px-4 py-3 text-right font-mono">
              {formatCurrency(totalBases.faturamento, "BRL")}
            </td>
            <td className="px-4 py-3 text-right font-mono">
              {formatCurrency(resultOpTotal, "BRL")}
            </td>
            <td className="px-4 py-3 text-center">
              <BadgeRent pct={rentTotalPct} />
            </td>
            <td className="px-4 py-3 text-center">
              <BadgeRep pct={100} isTotal />
            </td>
          </tr>

          {grupos.map((g) => {
            const expandido = expandidos.has(g.chave);
            const podeExpandir = visao !== "job" && g.jobs.length > 1;
            return (
              <React.Fragment key={g.chave}>
                <tr
                  className={cn(
                    "transition-colors",
                    podeExpandir && "cursor-pointer hover:bg-muted/40",
                  )}
                  onClick={podeExpandir ? () => toggleExpandir(g.chave) : undefined}
                >
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      {podeExpandir ? (
                        expandido ? (
                          <ChevronDown className="h-4 w-4 text-california-red" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-california-red" />
                        )
                      ) : (
                        <span className="w-4" />
                      )}
                      {g.rotulo}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(g.bases.faturamento, "BRL")}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {g.bases.resultadoOperacional === null
                      ? "—"
                      : formatCurrency(g.bases.resultadoOperacional, "BRL")}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <BadgeRent pct={g.bases.resultadoGeral} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <BadgeRep pct={g.representatividadePct} />
                  </td>
                </tr>

                {expandido &&
                  g.jobs.map((j) => {
                    const fatJ = faturamentoDaLinha(j, modo);
                    return (
                      <tr key={j.job_id} className="bg-muted/10">
                        <td className="px-4 py-2 pl-12 text-muted-foreground">
                          {j.job_codigo} · {j.job_nome}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                          {formatCurrency(fatJ, "BRL")}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                          {formatCurrency(resultOpDaLinha(j, modo), "BRL")}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <BadgeRent pct={rentDaLinha(j, modo)} />
                        </td>
                        <td className="px-4 py-2 text-center text-xs text-muted-foreground">
                          {totalBases.faturamento > 0
                            ? `${((fatJ / totalBases.faturamento) * 100).toFixed(1).replace(".", ",")}%`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Helpers de linha individual — mesma fórmula, sobre o job sozinho.
// `modo` vem via prop e é o mesmo que o server usou pra agregar (spec §5.4).
function faturamentoDaLinha(l: LinhaJobRentabilidade, modo: ModoRentabilidade) {
  return modo === "previsto" ? l.faturamento_previsto : l.faturamento_realizado;
}
function impostoDaLinha(l: LinhaJobRentabilidade, modo: ModoRentabilidade) {
  return modo === "previsto" ? l.imposto_previsto : l.imposto_realizado;
}
function resultOpDaLinha(l: LinhaJobRentabilidade, modo: ModoRentabilidade) {
  const fat = faturamentoDaLinha(l, modo);
  const imp = impostoDaLinha(l, modo);
  return fat - imp - (l.custo_realizado - l.bv_realizado);
}
function rentDaLinha(l: LinhaJobRentabilidade, modo: ModoRentabilidade): number | null {
  const fat = faturamentoDaLinha(l, modo);
  if (fat <= 0) return null;
  return (resultOpDaLinha(l, modo) / fat) * 100;
}

function BadgeRent({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  const classe = classificarRentBadge(pct);
  const cor = {
    verde: "bg-emerald-100 text-emerald-800",
    laranja: "bg-orange-100 text-orange-800",
    vermelho: "bg-california-red/10 text-california-red",
  }[classe];
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold font-mono", cor)}>
      {pct.toFixed(1).replace(".", ",")}%
    </span>
  );
}

function BadgeRep({ pct, isTotal = false }: { pct: number; isTotal?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold font-mono",
        isTotal ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800",
      )}
    >
      {pct.toFixed(1).replace(".", ",")}%
    </span>
  );
}
```

- [ ] **Step 2: Passar `modo` do server component pra tabela**

No `page.tsx` (Task 8), na chamada de `<TabelaRentabilidade>`, adicionar `modo={filtros.modo}`:

```typescript
<TabelaRentabilidade
  visao={filtros.visao}
  modo={filtros.modo}
  grupos={gruposFiltradosA}
  totalBases={totalBases}
/>
```

- [ ] **Step 3: Testar no navegador**

```bash
npm run dev
```

Abrir `/relatorios/rentabilidade`. Esperado:
- Filtros no topo funcionam (mudar ano recarrega).
- Tabela mostra clientes com totais no cabeçalho.
- Expandir cliente mostra jobs por dentro.
- Trocar visão Cliente|Marca|Job funciona.
- Trocar modo Previsto|Realizado muda os valores.
- Filtro "Faturamento acima de" some clientes pequenos.
- URL reflete os filtros; F5 mantém estado.
- Empty state em pt-BR aparece quando os filtros geram lista vazia.

- [ ] **Step 4: Rodar lint e build**

```bash
npm run lint
npm run build
```

Corrigir erros de TypeScript. Espera-se zero warnings/errors.

- [ ] **Step 5: Commit tasks 8-10 juntos**

```bash
git add app/(app)/relatorios/rentabilidade/
git commit -m "feat(relatorios): pagina /relatorios/rentabilidade com filtros e tabela"
```

---

## Task 11: `TabelaComparativo` — 2 períodos lado a lado

**Files:**
- Create: `app/(app)/relatorios/rentabilidade/tabela-comparativo.tsx`

**Interfaces:**
- Consumes: `GrupoRentabilidade`, `VisaoRentabilidade`, `classificarRentBadge`.
- Produces: componente `TabelaComparativo` que renderiza 2 blocos de colunas (Ano A | Ano B) sem coluna Rep%.

- [ ] **Step 1: Implementar**

Criar `app/(app)/relatorios/rentabilidade/tabela-comparativo.tsx`:

```typescript
"use client";

import * as React from "react";
import { formatCurrency, cn } from "@/lib/utils";
import { classificarRentBadge, type GrupoRentabilidade, type VisaoRentabilidade } from "@/lib/relatorios/rentabilidade";

interface Props {
  visao: VisaoRentabilidade;
  gruposA: GrupoRentabilidade[];
  gruposB: GrupoRentabilidade[];
  anoA: number;
  anoB: number;
}

/**
 * Une grupos dos 2 períodos por chave. Grupo ausente vira "R$ 0" no bloco
 * daquele período — R$ 0 tem significado ("não faturou em 2025"), não é
 * travessão. Rent% do bloco zerado mostra "—" (divisão por zero).
 */
export function TabelaComparativo({ visao, gruposA, gruposB, anoA, anoB }: Props) {
  const rotuloVisao =
    visao === "cliente" ? "Clientes" : visao === "marca" ? "Marcas" : "Jobs";

  const grupoZero = (rotulo: string): GrupoRentabilidade => ({
    chave: "",
    rotulo,
    bases: { faturamento: 0, imposto: 0, custo: 0, bv: 0, resultadoOperacional: null, resultadoGeral: null },
    jobs: [],
    representatividadePct: 0,
  });

  const chaves = new Set<string>();
  gruposA.forEach((g) => chaves.add(g.chave));
  gruposB.forEach((g) => chaves.add(g.chave));

  const linhas = Array.from(chaves).map((chave) => {
    const a = gruposA.find((g) => g.chave === chave) ?? grupoZero("");
    const b = gruposB.find((g) => g.chave === chave) ?? grupoZero("");
    const rotulo = a.rotulo || b.rotulo || chave;
    return { chave, rotulo, a, b };
  });

  linhas.sort((x, y) => y.a.bases.faturamento - x.a.bases.faturamento);

  const totalA = somaTotal(gruposA);
  const totalB = somaTotal(gruposB);

  if (linhas.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum resultado encontrado com os filtros atuais.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
            <th rowSpan={2} className="px-4 py-3 text-left font-semibold">{rotuloVisao} — Comparativo</th>
            <th colSpan={3} className="px-4 py-2 text-center font-semibold border-l border-border">{anoA}</th>
            <th colSpan={3} className="px-4 py-2 text-center font-semibold border-l border-border">{anoB}</th>
          </tr>
          <tr className="text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 text-right font-semibold border-l border-border">Fat.</th>
            <th className="px-4 py-2 text-right font-semibold">Result. Op</th>
            <th className="px-4 py-2 text-center font-semibold">Rent %</th>
            <th className="px-4 py-2 text-right font-semibold border-l border-border">Fat.</th>
            <th className="px-4 py-2 text-right font-semibold">Result. Op</th>
            <th className="px-4 py-2 text-center font-semibold">Rent %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <tr className="bg-muted/20 font-bold">
            <td className="px-4 py-3">{rotuloVisao}</td>
            <ColunasBloco bases={totalA} />
            <ColunasBloco bases={totalB} borderLeft />
          </tr>

          {linhas.map(({ chave, rotulo, a, b }) => (
            <tr key={chave} className="hover:bg-muted/20">
              <td className="px-4 py-3">{rotulo}</td>
              <ColunasBloco bases={a.bases} />
              <ColunasBloco bases={b.bases} borderLeft />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function somaTotal(grupos: GrupoRentabilidade[]) {
  const faturamento = grupos.reduce((s, g) => s + g.bases.faturamento, 0);
  const imposto = grupos.reduce((s, g) => s + g.bases.imposto, 0);
  const custo = grupos.reduce((s, g) => s + g.bases.custo, 0);
  const bv = grupos.reduce((s, g) => s + g.bases.bv, 0);
  const resultOp = faturamento - imposto - (custo - bv);
  const resultGeral = faturamento > 0 ? (resultOp / faturamento) * 100 : null;
  return { faturamento, imposto, custo, bv, resultadoOperacional: resultOp, resultadoGeral: resultGeral };
}

function ColunasBloco({
  bases,
  borderLeft = false,
}: {
  bases: {
    faturamento: number;
    imposto: number;
    custo: number;
    bv: number;
    resultadoOperacional: number | null;
    resultadoGeral: number | null;
  };
  borderLeft?: boolean;
}) {
  const border = borderLeft ? "border-l border-border" : "";
  return (
    <>
      <td className={cn("px-4 py-3 text-right font-mono", border)}>
        {formatCurrency(bases.faturamento, "BRL")}
      </td>
      <td className="px-4 py-3 text-right font-mono">
        {bases.resultadoOperacional === null || bases.faturamento === 0
          ? "—"
          : formatCurrency(bases.resultadoOperacional, "BRL")}
      </td>
      <td className="px-4 py-3 text-center">
        <BadgeRent pct={bases.resultadoGeral} />
      </td>
    </>
  );
}

function BadgeRent({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  const classe = classificarRentBadge(pct);
  const cor = {
    verde: "bg-emerald-100 text-emerald-800",
    laranja: "bg-orange-100 text-orange-800",
    vermelho: "bg-california-red/10 text-california-red",
  }[classe];
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold font-mono", cor)}>
      {pct.toFixed(1).replace(".", ",")}%
    </span>
  );
}
```

- [ ] **Step 2: Testar comparativo no navegador**

```bash
npm run dev
```

Abrir `/relatorios/rentabilidade`, marcar "Comparar 2 períodos", escolher 2025 no dropdown. Esperado:
- Cabeçalho vira "Rentabilidade de Jobs 2026 vs 2025".
- Tabela mostra 2 blocos lado a lado.
- Cliente presente só em 2026 mostra "R$ 0" e "—" no bloco 2025.
- URL contém `?comparar=2025`.

- [ ] **Step 3: Lint + build**

```bash
npm run lint
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add app/(app)/relatorios/rentabilidade/tabela-comparativo.tsx
git commit -m "feat(relatorios): tabela comparativa 2 periodos lado a lado"
```

---

## Task 12: Verificação final + smoke tests

**Files:**
- Nenhum

**Interfaces:**
- Nenhum

- [ ] **Step 1: Rodar conferência oficial da view**

Antes de considerar concluído, rodar o script de conferência da Task 4:

```bash
$env:SUPABASE_URL="<url do projeto>"
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
npx tsx scripts/conferir-view-rentabilidade.ts
```

Esperado: `OK: 0 divergência(s)`. Se falhar, é bug na view — abrir a task de fix (nova migration).

- [ ] **Step 2: Rodar testes unitários**

```bash
npx tsx scripts/testar-rentabilidade.ts
```

Esperado: todos os asserts passam.

- [ ] **Step 3: Smoke test manual**

Abrir `/relatorios/rentabilidade` no navegador e testar:

1. **Filtro por cliente** — selecionar 1 cliente, ver que só jobs desse cliente aparecem.
2. **Marca depende de cliente** — depois de selecionar cliente, abrir dropdown Marca; só marcas desse cliente devem aparecer.
3. **Marca órfã invalida** — selecionar cliente Ambev + marca Beats; desmarcar Ambev; Beats deve sair automaticamente.
4. **Toggle Realizado esconde jobs sem NF** — comparar contagem de linhas entre Previsto e Realizado (Realizado deve ter menos ou igual).
5. **Ordenar por faturamento desc** — visual: linha total no topo, depois maior faturamento primeiro.
6. **URL compartilhável** — copiar URL com filtros aplicados, colar em janela anônima logada, ver o mesmo estado.
7. **Empty state** — filtrar por cliente que não tem jobs no ano; ver mensagem "Nenhum resultado encontrado com os filtros atuais." em pt-BR.
8. **Comparativo** — ligar comparação com ano anterior; ver 2 blocos.
9. **Rent% do total** — bater a soma manualmente pra 1 cliente:
   - Somar Fat dos jobs do cliente.
   - Somar Result. Op dos jobs.
   - Dividir; conferir com o badge.
10. **Navegar pra sidebar → Relatórios → Rentabilidade** — sem 404.

- [ ] **Step 4: Documentar decisões emergentes**

Se durante a implementação alguma decisão foi tomada que difere da spec (ex: nome da coluna do BV foi diferente e teve que ajustar), adicionar breve seção "Ajustes na implementação" no fim da spec.

- [ ] **Step 5: Commit final se algo pendente**

```bash
git status
# Se houver alterações não committadas, revisar e commitar com mensagem descritiva.
```

---

## Notas finais

- **Fase 2 fora de escopo:** Evolução Margem (gráfico), Representatividade (pizza), Trimestre, Regional (tabs separadas). Ver spec §8.
- **Se performance da view virar bottleneck:** promover pra materialized view com refresh via trigger em `jobs`, `job_item_realizado`, `job_envio_faturamento`, `bvs`. Medir antes de otimizar (spec §6.3).
- **Divergência de percentual entre relatório e cabeçalho do job** é intencional (spec §3.2). Se der ruído no time, adicionar tooltip explicativo — não é bug.
