# Relatório de Rentabilidade — Design

**Data:** 2026-08-28
**Autor:** Antonio + Claude
**Status:** Aguardando revisão do Antonio antes do plano de implementação.

## 1. Contexto

O ERP hoje mostra rentabilidade **por job**, no cabeçalho da tela do próprio job ([components/resumo-resultado.tsx](../../components/resumo-resultado.tsx)) e no card de Totais da planilha interna. É a leitura correta pro operacional do dia a dia — quem monta o job vê se o número tá saudável.

O que falta é a **leitura gerencial**: "quanto a agência ganhou em 2026 com cada cliente", "qual cliente representa X% do faturamento", "quais marcas dão mais margem". Hoje essa análise é feita fora do sistema (planilha manual). Este é o primeiro relatório da futura seção `/relatorios`.

## 2. Objetivo

Entregar em 3 frentes:

1. **Rota `/relatorios`** — hub simples, no padrão de [/cadastros](../../app/(app)/cadastros/page.tsx) e [/financeiro](../../app/(app)/financeiro/page.tsx), com 1 card apontando pra Rentabilidade. Estrutura fica pronta pra novos dashboards aparecerem como cards adicionais (fase 2: Evolução Margem, Representatividade, Trimestre, Regional).

2. **View SQL `vw_job_rentabilidade`** — 1 linha por job com todas as bases agregadas (faturamento previsto, faturamento realizado, imposto, custo realizado, BV realizado, dimensões pra agrupamento). O agregado pesado dos itens acontece em SQL uma vez; a fórmula continua fonte-única em TS.

3. **Página `/relatorios/rentabilidade`** — dashboard com filtros, toggle Previsto/Realizado, toggle Cliente/Marca/Job, toggle "Comparar 2 períodos", tabela agrupada com Faturamento · Result. Op · Rent % · Rep. %.

Entrada da sidebar em [components/sidebar.tsx](../../components/sidebar.tsx): novo item "Relatórios" apontando pra `/relatorios`.

## 3. Decisões arquiteturais

Todas fechadas em conversa antes desta spec.

### 3.1. View SQL cachada, fórmula em TS

Rejeitado calcular tudo em SQL (view materializada com Result.Op pronto) e rejeitado carregar itens de todos os jobs em memória.

- Calcular Result.Op em SQL forçaria replicar a fórmula de [lib/calculos/versao-totais.ts](../../lib/calculos/versao-totais.ts) em PL/pgSQL. A fórmula evolui (BV mudou em 022, save em 028, tipos A/D têm regra especial em [carregar-detalhe.ts:517](../../app/(app)/jobs/[jobId]/carregar-detalhe.ts#L517)). Manter em dois lugares diverge.
- Carregar itens de todos os jobs em memória seria ~50k linhas por request pra 100 jobs. Insustentável.

**Meio-termo:** SQL agrega **as bases** por job (soma dos totais realizados, soma dos faturados, etc.); TS aplica a fórmula sobre cada linha da view.

Ver 4.1 pro detalhamento da view.

### 3.2. Base do % de rentabilidade: Faturamento (não Valor do Job)

Divergência intencional com o cabeçalho do job.

Hoje o `ResumoResultado` do job usa `valorJob` como base do `resultadoGeral %` — decisão do Tiago 11/08/2026 em [versao-totais.ts:610-618](../../lib/calculos/versao-totais.ts#L610-L618). O racional é "custo é do job inteiro, receita também tem que ser".

Pro relatório gerencial, a base é **Faturamento** — o que a California emite nota. Motivos:

- É o número que bate com o DRE; representa a receita real da empresa.
- O principal dos tipos A · Direto e D · Interno **não passa pelo caixa da California** (cliente paga direto ao fornecedor). Incluir esse principal no denominador do % dilui a rentabilidade da agência num número que não é dela.
- `Result. Op (R$)` dá **igual** nas duas fórmulas (o principal externo se cancela entre receita e custo). O que muda é só o denominador do %.

**Consequência aceita:** o mesmo job vai ter dois percentuais diferentes — o do cabeçalho do job (base `valorJob`) e o do relatório (base `faturamento`). O R$ do Result. Op é sempre o mesmo. Rótulos precisam deixar claro qual base cada tela usa.

### 3.3. Toggle Previsto | Realizado (Leitura A)

Toggle atua **só no faturamento e no imposto**. Custo e BV são **sempre realizado**.

| Modo | Faturamento | Imposto | Custo | BV |
|---|---|---|---|---|
| **Previsto** (default) | `jobs.faturamento_previsto` | do fechamento do orçamento (`calcularTotaisVersao().imposto`) | realizado | realizado |
| **Realizado** | `SUM(job_envio_faturamento.valor_faturado)` | `%_imposto × faturamento_realizado` | realizado | realizado |

Rejeitado toggle "no lado inteiro" (Previsto = tudo previsto/planejado, Realizado = tudo realizado). Motivos:
- Antonio já descartou o custo planejado pro MVP em rodada anterior.
- Toggle na receita responde perguntas mais informativas: "quanto contratei que fatura" vs "quanto já faturei", com o mesmo custo real.
- Se depois virar Leitura B, é aditivo (só adicionar `custo_planejado` e `bv_planejado` na view).

### 3.4. Modo Realizado esconde jobs sem NF

Filtro implícito `WHERE faturamento_realizado > 0` no modo Realizado.

Sem isso, jobs abertos em 2026 mas ainda não faturados apareceriam com Faturamento R$ 0 e Custo Realizado > 0, mostrando "prejuízo" enorme (Rent% grotesca). Matematicamente correto, visualmente ruim e confunde a leitura.

A leitura contábil natural do modo Realizado é "jobs faturados no período". Job em andamento continua visível no modo Previsto (default), que é onde ele faz sentido aparecer.

### 3.5. Data de referência do período: `data_abertura_financeiro`

Filtro por ano/trimestre usa `jobs.data_abertura_financeiro` como pivô — o momento em que o job entrou no financeiro.

Alternativas rejeitadas:
- `jobs.created_at` — cria pré-histórico (job criado em dezembro/2025 e aberto em janeiro/2026 apareceria em 2025).
- `jobs.data_inicio_prevista` / `data_fim_prevista` — reflete plano, não realidade.
- `versoes_orcamento.aprovado_em` — muitas vezes distante da abertura.

Job sem `data_abertura_financeiro` (status `aguardando_abertura` ou `rejeitado_financeiro`) **não entra** na view — não faz sentido reportar rentabilidade de job que nem começou.

### 3.6. Filtros com semântica multi-select (exceto Ano)

- **Ano** — single, default = ano corrente. Multi só faria sentido se fosse pra comparar, e isso já tem o toggle "Comparar 2 períodos".
- **Trimestre** — multi (checkboxes Q1/Q2/Q3/Q4). Filtro dentro do ano selecionado.
- **Empresa, Regional, Cliente, Marca** — multi-select via `Popover` + `Command` (padrão shadcn/ui), com busca.
- **"Faturamento acima de R$ X"** — filtro no agrupamento (só clientes/marcas/jobs cujo faturamento total no período > X), aplicado depois da agregação.

### 3.7. Marca é dependente de Cliente

Quando **um ou mais** clientes estão selecionados, o dropdown de Marca só oferece as marcas (produtos) daqueles clientes. Sem cliente selecionado, oferece todas as marcas do tenant.

Efeito no filtro: se o usuário seleciona Cliente = [Ambev, Deezer] e Marca = [Beats], só entram jobs cuja marca é Beats (que por transitividade é da Ambev). Multi-select em Marca combina com multi-select em Cliente por interseção lógica (`cliente IN (...) AND marca IN (...)`).

Motivo: Marca é uma FK indireta via `jobs.produto_id → produtos.cliente_id`. Filtrar Marca sem contexto de Cliente daria uma lista com marcas duplicadas de clientes diferentes (o mesmo nome "Beats" pode existir em N clientes). O UX correto é "escolho os clientes, depois refino pelas marcas deles".

**Regra de invalidação:** se o usuário desmarca um cliente cuja marca estava selecionada, essa marca sai do filtro automaticamente.

### 3.8. URL com query string

Toda escolha de filtro/toggle vai pra query string:
```
/relatorios/rentabilidade?ano=2026&trimestre=Q1,Q2&modo=previsto&visao=cliente&comparar=2025
```

Motivos:
- URL compartilhável ("olha esse comparativo de Ambev 2026 x 2025").
- Botão voltar do navegador funciona.
- Cabe em Server Component com `searchParams` — dispensa estado de cliente pra os filtros principais.

Filtros de multi-select viram lista separada por vírgula. Client component controla os toggles e faz `router.push()` com a query nova.

### 3.9. Agregação soma bases, não percentuais

Regra dura da fórmula em [lib/calculos/versao-totais.ts](../../lib/calculos/versao-totais.ts): **`Rent %` de um grupo não é a média dos `Rent %` dos jobs.** É:

```
Rent%_grupo = (ΣFaturamento_jobs − ΣImposto_jobs − ΣCusto_jobs + ΣBV_jobs) / ΣFaturamento_jobs × 100
```

Somar percentuais dá média ponderada errada. Agregação em TS soma sempre as **4 bases** (Faturamento, Imposto, Custo, BV) e recalcula o percentual no total.

### 3.10. Rota `/relatorios` é hub simples com 1 card no MVP

A página `/relatorios` já entra com o layout de hub (padrão de `/cadastros` e `/financeiro`), mas com apenas 1 card apontando pra `/relatorios/rentabilidade`. Novos dashboards (Evolução Margem, Trimestre, Regional, Representatividade) aparecem como cards adicionais em fase 2, sem reestrutura.

Alternativa rejeitada: criar `/relatorios` já com os 6 tabs mostrados no mockup. Muito escopo pra um MVP; a maioria vira gráfico que precisa de biblioteca (Recharts) e mais dados agregados.

## 4. Modelo de dados

### 4.1. View `vw_job_rentabilidade`

Uma linha por job elegível. Todos os agregados brutos que a fórmula precisa.

```sql
CREATE OR REPLACE VIEW vw_job_rentabilidade AS
SELECT
  j.id                         AS job_id,
  j.tenant_id,
  j.empresa_id,
  j.regional_id,
  j.data_abertura_financeiro,

  -- Dimensões pra agrupamento
  o.cliente_id,
  j.produto_id                 AS marca_id,

  -- Metadados úteis pra tabela
  j.codigo                     AS job_codigo,
  j.nome                       AS job_nome,

  -- Faturamento previsto (já cacheado no job pela abertura)
  COALESCE(j.faturamento_previsto, 0) AS faturamento_previsto,

  -- Imposto do previsto (calculado a partir do fechamento do orçamento)
  -- Sai da view `vw_versao_totais_previsto` ou de subquery equivalente.
  COALESCE(vt.imposto, 0)      AS imposto_previsto,

  -- Faturamento realizado (soma das NFs emitidas)
  COALESCE(fr.total, 0)        AS faturamento_realizado,

  -- Imposto do realizado — proporcional à taxa da versão aprovada
  COALESCE(fr.total * (v.percentual_imposto / 100.0) / (1 - v.percentual_imposto / 100.0), 0)
                               AS imposto_realizado,

  -- Custo realizado bruto (soma das PPs não canceladas, com regra A/D)
  COALESCE(cr.total, 0)        AS custo_realizado,

  -- BV realizado (dedução dos BVs efetivamente concretizados)
  COALESCE(bv.total, 0)        AS bv_realizado

FROM jobs j
JOIN orcamentos o ON o.id = j.orcamento_id
JOIN versoes_orcamento v ON v.id = j.versao_orcamento_aprovada_id

-- Subquery: imposto previsto agregado dos itens
LEFT JOIN LATERAL (
  SELECT ... -- calcula imposto pela fórmula do fechamento
  FROM versoes_orcamento_itens
  WHERE versao_orcamento_id = j.versao_orcamento_aprovada_id
) vt ON true

-- Subquery: faturamento realizado (soma das NFs)
LEFT JOIN LATERAL (
  SELECT SUM(valor_faturado) AS total
  FROM job_envio_faturamento
  WHERE job_id = j.id
) fr ON true

-- Subquery: custo realizado bruto (regra A/D já aplicada)
LEFT JOIN LATERAL (
  SELECT SUM(...) AS total
  FROM job_item_realizado jir
  JOIN versoes_orcamento_itens voi ON voi.id = jir.item_id
  WHERE jir.job_id = j.id
  -- Regra especial: tipos A e D usam total_orcado
) cr ON true

-- Subquery: BV realizado
LEFT JOIN LATERAL (
  SELECT SUM(...) AS total
  FROM bvs
  WHERE job_id = j.id AND situacao = 'realizado'
) bv ON true

WHERE j.data_abertura_financeiro IS NOT NULL
  AND j.status != 'cancelado';
```

O detalhamento exato das subqueries (especialmente imposto previsto e regra A/D no custo) sai na migration — precisam replicar exatamente o que [carregar-detalhe.ts](../../app/(app)/jobs/[jobId]/carregar-detalhe.ts) faz hoje pra tela do job. Se a fórmula da view divergir do que a tela do job mostra, o mesmo Result. Op R$ do job apareceria diferente entre as telas — inaceitável.

**Regra dura:** um teste E2E que compara `Result.Op` calculado pela view com `Result.Op` calculado pelo `carregar-detalhe.ts` pra 5-10 jobs de amostragem, cobrindo os 7 tipos de custo e casos com BV/save. Divergência = migration não sobe.

### 4.2. RLS e GRANT

Views herdam RLS das tabelas subjacentes por default no Postgres (via `security_invoker`). Como `jobs`, `orcamentos`, `versoes_orcamento_itens`, `job_envio_faturamento`, `job_item_realizado` e `bvs` já têm RLS por `tenant_id`, a view respeita automaticamente.

`GRANT SELECT ON vw_job_rentabilidade TO authenticated;` (nada pra `anon`, regra do projeto).

### 4.3. Índices

Nada novo. Todos os joins e filtros usam FKs que já têm índice. O filtro por `data_abertura_financeiro` pode se beneficiar de um índice parcial:

```sql
CREATE INDEX IF NOT EXISTS idx_jobs_abertura_financeiro
  ON jobs (tenant_id, data_abertura_financeiro)
  WHERE data_abertura_financeiro IS NOT NULL AND status != 'cancelado';
```

Confirmar via `EXPLAIN` na base real antes de aplicar.

## 5. UI

### 5.1. Rota `/relatorios` (hub)

Server Component seguindo padrão de [/cadastros](../../app/(app)/cadastros/page.tsx):

- Header com breadcrumb "Relatórios" + ícone + descrição.
- Grid de cards, no MVP com **1 card**: "Rentabilidade de Jobs".
- Card mostra: ícone `BarChart3`, título, descrição ("Faturamento, resultado operacional e rentabilidade por cliente, marca ou job."), CTA "Abrir".
- `force-dynamic` (padrão do projeto pra hub com contagens).

### 5.2. Rota `/relatorios/rentabilidade`

Server Component com Suspense, faz `.select("*").from("vw_job_rentabilidade")` filtrado pelas queryparams.

**Layout:**

```
┌────────────────────────────────────────────────────────────────┐
│ Rentabilidade de Jobs                                          │
│                                                                │
│ [Ano ▾] [Trim ▾] [Empresa ▾] [Regional ▾] [Cliente ▾] [Marca▾] │
│ [Faturamento acima de: R$ ______]                              │
│ [Modo: Previsto|Realizado]  [☐ Comparar 2 períodos]            │
│                                                                │
│ Visualizar por: [Cliente|Marca|Job]                            │
├────────────────────────────────────────────────────────────────┤
│ Tabela agrupada:                                               │
│   Cabeçalho: Cliente  |  Faturamento  |  Result.Op  |  Rent%  |Rep%│
│   Linha total (fundo cinza claro)                              │
│   > Ambev (expandível)                                         │
│     ↳ jobs quando expande                                      │
│   > Deezer                                                     │
│   ...                                                          │
└────────────────────────────────────────────────────────────────┘
```

**Filtros no topo:** `Popover` + `Command` do shadcn/ui pra multi-select (padrão já usado em outras telas de filtro do projeto — buscar exemplo antes de codar). Ver [feedback: Radix gotchas](../../memory/feedback_radix_gotchas.md) — usar `avoidCollisions=false` + `side=bottom` + largura fixa, senão o Popover flippa em cima do form.

**Toggle de visão** (Cliente | Marca | Job): botões segmentados no padrão do projeto (`Tabs` do Radix ou custom com estilo California). Muda o agrupamento em memória.

**Toggle Previsto | Realizado:** duas pílulas. Muda quais colunas da view são somadas.

**Toggle Comparar:** checkbox. Quando ligado, aparecem 2 seletores extras ("Comparar por: Ano" (fixo no MVP), "Ano comparação: [dropdown]"). Colunas da tabela duplicam side by side; **coluna Rep% some** (ela não faz sentido em comparação, seria ambígua com qual período serve de denominador).

**Filtro "Faturamento acima de R$":** input de moeda. Aplica **depois** da agregação por grupo. Só clientes/marcas/jobs cujo faturamento total > X aparecem.

### 5.3. Tabela agrupada

Formato inspirado nos mockups. Padrão visual:

- Linha total "Clientes" (ou "Marcas" / "Jobs" conforme visão) em **fundo cinza claro**, valores em **bold**, badges de Rent% e Rep% em verde emerald forte.
- Linhas de cliente com **chevron** (`>` colapsado, `⌵` expandido, no vermelho California).
- Linhas de job dentro do cliente sem chevron, com padding-left, ordenadas por faturamento desc.
- **Badges arredondados** pra Rent% e Rep%:
  - **Rent%** — verde `bg-emerald-100 text-emerald-800` se >= **20%**; laranja `bg-orange-100 text-orange-800` entre 0 e 20%; vermelho California se < 0. Thresholds calibrados pelos mockups (Deezer 29,6% verde, Prefeitura Ambev 7,0% laranja). Antonio pode ajustar; deixar como constante em `lib/relatorios/rentabilidade.ts` pra troca fácil.
  - **Rep%** — verde emerald sempre quando é linha de total ("100%"); laranja pra linhas individuais (é sempre uma fatia).
- Ordenação: colunas com setas `↑↓` clicáveis (padrão do projeto — buscar componente `SortableHeader` se existir, senão criar simples).
- Valores em `font-mono` pra alinhar (padrão de todas as tabelas de números do projeto).

**pt-BR obrigatório** em toda string visível: "Cliente", "Marca", "Job", "Faturamento", "Result. Op", "Rentabilidade", "Representatividade", "Comparar 2 períodos", "Faturamento acima de", "Nenhum resultado encontrado", etc. Ver [regra transversal de ortografia](../../CLAUDE.md#ortografia-em-português-regra-transversal).

### 5.4. Comparativo (2 períodos)

Quando ligado, a tabela mostra 2 blocos de colunas (Ano corrente | Ano comparação):

```
                        │       2026        │       2025
Cliente                 │ Fat | Res | Rent% │ Fat | Res | Rent%
────────────────────────┼───────────────────┼──────────────────
Clientes (total)        │  X  │  Y  │  Z%   │  A  │  B  │  C%
Ambev                   │ ... │ ... │ ...   │ ... │ ... │ ...
```

**Regra:** um cliente aparece na tabela se tem dado em pelo menos **um** dos períodos. Cliente ausente num período mostra "R$ 0" no bloco daquele período (não travessão — R$ 0 tem significado: "esse cliente não faturou em 2025").

Rent% do bloco onde faturamento = 0 mostra "—" (travessão), porque a fórmula divide por zero.

**Visão aplica-se aos dois períodos igualmente.** Se o toggle Cliente/Marca/Job está em "Cliente", os dois blocos agrupam por cliente. Não faz sentido comparar Ambev-cliente com Ambev-marca; regras diferentes de agregação dariam números incomparáveis.

**Toggle Previsto/Realizado idem** — mesmo modo nos dois períodos.

## 6. Fluxo técnico da página

### 6.1. Server Component principal

```typescript
export const dynamic = "force-dynamic";

export default async function RentabilidadePage({ searchParams }) {
  const session = await requireSession();
  const filtros = parseFiltros(searchParams);

  // Query única na view. Todos os agregados brutos por job.
  const supabase = createClient();

  const [linhasPeriodoA, linhasPeriodoB] = await Promise.all([
    carregarLinhas(supabase, session.activeTenant.id, filtros.periodoA),
    filtros.comparar
      ? carregarLinhas(supabase, session.activeTenant.id, filtros.periodoB)
      : Promise.resolve(null),
  ]);

  // Agregação e cálculo da fórmula em memória
  const grupos = agruparEComputar(linhasPeriodoA, filtros.visao, filtros.modo);
  const gruposComparar = linhasPeriodoB
    ? agruparEComputar(linhasPeriodoB, filtros.visao, filtros.modo)
    : null;

  // Filtro "acima de R$ X" aplicado depois da agregação
  const gruposFiltrados = filtrarPorFaturamento(grupos, filtros.faturamentoMin);

  return <TabelaRentabilidade grupos={gruposFiltrados} comparar={gruposComparar} .../>;
}
```

### 6.2. Fonte-única da fórmula

`agruparEComputar` importa `calcularResultadoOperacional` de [lib/calculos/versao-totais.ts](../../lib/calculos/versao-totais.ts) e roda sobre a soma das bases do grupo. **Não replica a fórmula.**

Novo helper em `lib/relatorios/rentabilidade.ts`:

```typescript
export function agregarBases(linhas: LinhaJobRentabilidade[], modo: "previsto" | "realizado") {
  const faturamento = linhas.reduce((s, l) =>
    s + (modo === "previsto" ? l.faturamento_previsto : l.faturamento_realizado), 0);
  const imposto = linhas.reduce((s, l) =>
    s + (modo === "previsto" ? l.imposto_previsto : l.imposto_realizado), 0);
  const custo = linhas.reduce((s, l) => s + l.custo_realizado, 0);
  const bv = linhas.reduce((s, l) => s + l.bv_realizado, 0);

  const { resultadoOperacional, resultadoGeral } =
    calcularResultadoOperacional(faturamento, imposto, custo - bv);

  return { faturamento, imposto, custo, bv, resultadoOperacional, resultadoGeral };
}
```

### 6.3. Performance

Regras não negociáveis do projeto ([docs/PERFORMANCE.md](../PERFORMANCE.md)):

- `Promise.all` nas queries independentes (períodos A e B do comparativo).
- `force-dynamic` na página (freio de prefetch).
- Sem `<Link prefetch>` na tabela agrupada — expandir grupos é interno, não navega.
- Nas duas queries da view, `select` apenas dos campos usados; nunca `select("*, embed:tabela(*)")`.
- Se a view virar bottleneck (medir depois), promover pra **materialized view** com refresh via trigger em `jobs`, `job_item_realizado`, `job_envio_faturamento`, `bvs`. Antes de otimizar, medir.

### 6.4. Sidebar

Novo item em [components/sidebar.tsx](../../components/sidebar.tsx):

```typescript
{ href: "/relatorios", label: "Relatórios", icon: BarChart3 }
```

Posição: depois de `/financeiro/desembolsos` e antes de `/admin` (relatórios são leitura, admin é config).

### 6.5. Permissões

RLS na view já cobre isolamento por tenant. Regra de negócio: **quem pode ver relatório de rentabilidade?**

MVP: qualquer usuário do tenant com sessão ativa. Sem restrição por role.

Se depois quiserem restringir a Diretoria/Financeiro, aditivo — checar role em `session.role` e retornar 403.

## 7. Migrations

Numeração: seguir a sequência atual em `supabase/migrations/`.

**Migration 1** (aditiva) — cria `vw_job_rentabilidade` + índice parcial:

```sql
-- 2026-08-28 · Relatório de Rentabilidade
--
-- View agrega, por job, as bases usadas na fórmula de rentabilidade
-- (faturamento previsto/realizado, imposto previsto/realizado, custo
-- realizado bruto com regra A/D, BV realizado). A fórmula continua em
-- lib/calculos/versao-totais.ts — esta view só entrega os inputs prontos
-- pra evitar carregar itens de 100 jobs no server component.
--
-- Segurança: security_invoker herda RLS das tabelas subjacentes.
-- GRANT explícito pra authenticated (regra do projeto).

CREATE OR REPLACE VIEW public.vw_job_rentabilidade
WITH (security_invoker = true) AS
SELECT ...;

GRANT SELECT ON public.vw_job_rentabilidade TO authenticated;

CREATE INDEX IF NOT EXISTS idx_jobs_abertura_financeiro
  ON public.jobs (tenant_id, data_abertura_financeiro)
  WHERE data_abertura_financeiro IS NOT NULL AND status != 'cancelado';
```

Aplicar via MCP (`apply_migration`), conferir com `list_tables` que a view aparece e `execute_sql` com `SELECT * FROM vw_job_rentabilidade LIMIT 5` pra ver colunas populando.

**Não há mudança em tabela existente. Sem risco destrutivo.**

## 8. Fora de escopo (fase 2)

Documentado explicitamente pra não crescer o MVP:

- **Aba "Evolução Margem"** — gráfico de linhas (Rent% por mês/trimestre). Precisa de Recharts + agregação temporal.
- **Aba "Representatividade"** — pizza/donut chart de participação. Precisa de Recharts.
- **Aba "Trimestre"** — quebra por Q1/Q2/Q3/Q4 lado a lado. É reuso da view com agregação por trimestre.
- **Aba "Regional"** — agrupamento por regional. Reuso da view com nova dimensão.
- **Custo Planejado / Comprometido** — voltar Leitura B (custo planejado e realizado como universos). Aditivo na view.
- **Comparativo entre trimestres** (não só entre anos) — mais opções no dropdown "Comparar por".
- **Export CSV/Excel** da tabela agrupada.
- **Restrição de acesso por role** (Diretoria/Financeiro).
- **Rentabilidade de orçamentos não aprovados** — só entra job real no MVP.

## 9. Testes

### 9.1. Testes de unidade — `lib/relatorios/rentabilidade.ts`

- `agregarBases` soma faturamento correto por modo (previsto/realizado).
- Rent% do grupo NÃO é média dos Rent% dos jobs; é recalculado das bases.
- Grupo com todos os jobs sem custo (`custo <= 0`) devolve `resultadoGeral = null` → tabela mostra travessão.
- Grupo com faturamento zero devolve `resultadoGeral = null`.

### 9.2. Teste de conferência — view vs cálculo do job

Script `scripts/conferir-view-rentabilidade.ts` que:

1. Puxa `vw_job_rentabilidade` da base real (limit 20 jobs variados: A puro, B puro, com BV, com save, com errata).
2. Pra cada job, chama `carregar-detalhe.ts` pra ler os mesmos números pela via oficial.
3. Compara linha a linha: `Math.abs(view.custo_realizado - detalhe.custoRealizadoJob) < 0.01` etc.
4. Se divergir, printa a diferença e falha com exit 1.

Rodar antes de dar por concluído. Divergência = view errada.

### 9.3. Testes manuais na UI

- Filtro por cliente + marca vazio (nenhum resultado) mostra empty state em pt-BR.
- Toggle Realizado esconde jobs sem NF (verificar contando linhas).
- Toggle Comparar mostra 2 blocos; cliente presente em só um período aparece com "R$ 0" no outro.
- Filtro "Faturamento acima de R$ 1.000.000" some clientes pequenos.
- Ordenação por Rent% funciona em ordem crescente/decrescente.
- URL compartilhável: copiar URL, abrir em janela anônima com login, chega no mesmo estado.

## 10. Riscos e mitigações

**R1. View divergir do cálculo do job.**
Se `custo_realizado` na view não bater com o do cabeçalho do job, o mesmo Result. Op R$ aparece diferente entre telas. Confusão total.
**Mitigação:** script de conferência 9.2 é bloqueante. Migration não sobe sem passar.

**R2. Performance da view em produção.**
100 jobs × 50 itens × subqueries de 4 tabelas = query lenta.
**Mitigação:** medir na base real depois de povoar. Se lenta, promover pra materialized view com refresh trigger. Índice parcial já vai.

**R3. Regra A/D quebrar em algum tipo novo.**
Se um dia entrar tipo de custo novo com regra especial de realizado, a subquery da view pode não refletir. Ver `TIPOS_CUSTO` em [versao-totais.ts:59](../../lib/calculos/versao-totais.ts#L59) — hoje 7 tipos, o TS tem guard de exaustividade.
**Mitigação:** documentar na migration que a lógica de realizado bruto tem que ser mantida em sync com `blocosDoItem` de [carregar-detalhe.ts](../../app/(app)/jobs/[jobId]/carregar-detalhe.ts). Adicionar comentário no topo da migration apontando pro arquivo. Script 9.2 pega a divergência.

**R4. Divergência de percentual entre cabeçalho do job (base `valorJob`) e relatório (base `faturamento`).**
Usuário olha o mesmo Ambev e vê 24,9% no relatório e 22,1% no cabeçalho do job. Reclama.
**Mitigação:** rótulos explícitos. No relatório, mostrar "Rent %" com tooltip: "Result. Op / Faturamento". No cabeçalho do job manter "Resultado geral". Podemos escrever esse tooltip como parte da UI.

**R5. Faturamento Realizado com imposto aproximado por %.**
`imposto_realizado = fat_realizado × %_imposto / (1 − %_imposto)` assume que a taxa da versão aprovada é a taxa efetiva das NFs. Se a NF tiver taxa diferente (mudança fiscal, retenção especial), o número diverge.
**Mitigação:** aceito no MVP. Se depois virar problema, guardar `imposto` como coluna própria de `job_envio_faturamento` (aditivo).

## 11. Estimativa de esforço

Alto nível, pra planejamento:

- Migration (view + índice) + conferência com o cálculo do job: **1 sessão**.
- Rota `/relatorios` hub: **0.5 sessão** (copiar padrão de `/cadastros`).
- Rota `/relatorios/rentabilidade` — layout, filtros, tabela agrupada, ordenação, empty state: **2 sessões**.
- Comparativo (2 períodos side by side): **1 sessão**.
- Toggle Previsto/Realizado + toggle visão + toggle comparar + filtros na URL: **1 sessão**.
- Testes de unidade + conferência: **0.5 sessão**.
- Adicionar entrada na sidebar + smoke test: **0.25 sessão**.

Total estimado: **~6 sessões de trabalho.** Escrever plano de execução quebra em tasks navegáveis.
