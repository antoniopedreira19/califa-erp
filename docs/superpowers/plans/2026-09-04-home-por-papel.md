# Home por papel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** substituir a home estática do ERP California por um painel operacional diferenciado por papel — cards de pendência clicáveis que somem com contagem zero e uma linha de KPIs no rodapé.

**Architecture:** `app/(app)/home/page.tsx` (server component) chama `requireSession()` e delega ao componente do papel do usuário (`home-admin.tsx`, `home-gerente-producao.tsx`, `home-produtor.tsx`, `home-freelancer.tsx`, `home-financeiro.tsx`). Cada componente do papel chama uma função carregadora em `lib/home/carregar.ts` que dispara todas as contagens via `Promise.all`. O escopo "Meus" (união de `projeto_responsaveis` + criador do projeto + produtor/GP de orçamento) vive em `lib/home/escopo-meus.ts` e é memoizado dentro do request.

**Tech Stack:** Next.js 14 App Router, React Server Components, Supabase (`@supabase/ssr`), Tailwind CSS + shadcn/ui, lucide-react.

**Spec:** [docs/superpowers/specs/2026-09-04-home-por-papel-design.md](../specs/2026-09-04-home-por-papel-design.md)

## Global Constraints

- Toda página em `app/(app)/**` fica com `export const dynamic = "force-dynamic";` — freio de prefetch descontrolado. Regra G de `docs/PERFORMANCE.md`.
- Todo `<Link>` na home leva `prefetch={false}`. Regra A.
- Contagens agregadas via `.select("id", { count: "exact", head: true })` — NUNCA embed pesado. Regra C.
- Todas as consultas independentes de uma home vão em `Promise.all` — nunca em série. Regra B/E.
- Strings visíveis ao usuário em pt-BR completo (com acentos). Identificadores em código podem ficar sem acento por convenção. CLAUDE.md "Ortografia em português".
- Cor do California: `california-red` (`#E74B56`) — usar tokens do Tailwind já existentes. `docs/09-identidade-visual-ui.md`.
- Header padrão da page: kicker/breadcrumb + ícone em quadradinho `bg-california-red/10` + título `text-3xl font-bold`. Ver headers de `/orcamentos`, `/jobs`, `/admin/usuarios`.
- Nenhum card mostra dado que a role não pode ver (a matriz de permissões já resolve).

---

## File Structure

**Criar:**

- `lib/home/tipos.ts` — types compartilhados (`CardPendencia`, `CardKpi`, `DadosHome`).
- `lib/home/escopo-meus.ts` — helper `projetoIdsDoUsuario(session, supabase)` que devolve o array de UUIDs dos projetos do usuário (união expandida).
- `lib/home/carregar.ts` — funções `carregarHomeAdmin`, `carregarHomeGerenteProducao`, `carregarHomeProdutor`, `carregarHomeFreelancer`, `carregarHomeFinanceiro`. Cada uma faz `Promise.all` interno e devolve `DadosHome`.
- `app/(app)/home/_componentes/card-pendencia.tsx` — client component com `<Link prefetch={false}>` envolvendo o card.
- `app/(app)/home/_componentes/card-kpi.tsx` — server component (link também clicável mas sem estado).
- `app/(app)/home/_componentes/estado-vazio.tsx` — server component quando todas as pendências são 0.
- `app/(app)/home/_componentes/cabecalho-home.tsx` — server component com o header padrão da página.
- `app/(app)/home/home-admin.tsx`
- `app/(app)/home/home-gerente-producao.tsx`
- `app/(app)/home/home-produtor.tsx`
- `app/(app)/home/home-freelancer.tsx`
- `app/(app)/home/home-financeiro.tsx`

**Modificar:**

- `app/(app)/home/page.tsx` — reescrita: roteia por `session.activeRole`.

**Nenhum teste automatizado nesta feature.** O projeto só tem testes em `lib/permissoes.test.ts`. Testar cada card exigiria mocks pesados de Supabase que não seguem o padrão do repositório. A verificação acontece via smoke test manual (Task 5) com os 4 usuários de teste (`gp_teste`, `produtor_teste`, `freelancer_teste`, `financeiro_teste`) já criados na Task 6 do projeto de permissões — credenciais em [docs/10-permissoes-por-perfil.md](../../10-permissoes-por-perfil.md).

---

## Task 1: Types compartilhados + helpers de escopo "Meus"

**Files:**
- Create: `lib/home/tipos.ts`
- Create: `lib/home/escopo-meus.ts`

**Interfaces:**
- Produces:
  - `type CardPendencia = { titulo: string; contagem: number; subtitulo: string; href: string; icone: LucideIcon; }`
  - `type CardKpi = { titulo: string; valor: string; subtitulo: string; href: string; icone: LucideIcon; }`
  - `type DadosHome = { pendencias: CardPendencia[]; kpis: CardKpi[]; }`
  - `async function projetoIdsDoUsuario(session: SessionContext, supabase: SupabaseClient): Promise<string[]>` — devolve UUIDs distintos dos projetos onde o usuário participa por qualquer via (papel `gp` OU `equipe` em `projeto_responsaveis`, criador do projeto, GP responsável ou produtor de algum orçamento do projeto).

- [ ] **Step 1: Criar tipos compartilhados**

Criar `lib/home/tipos.ts`:

```ts
import type { LucideIcon } from "lucide-react";

/** Card de pendencia mostrado no grid principal da home. */
export interface CardPendencia {
  titulo: string;
  contagem: number;
  subtitulo: string;
  href: string;
  icone: LucideIcon;
}

/** Card de KPI mostrado na linha inferior da home. */
export interface CardKpi {
  titulo: string;
  valor: string;
  subtitulo: string;
  href: string;
  icone: LucideIcon;
}

/** Payload que cada `carregarHome<Papel>` devolve. */
export interface DadosHome {
  pendencias: CardPendencia[];
  kpis: CardKpi[];
}
```

- [ ] **Step 2: Criar `projetoIdsDoUsuario`**

Criar `lib/home/escopo-meus.ts`:

```ts
import type { SessionContext } from "@/lib/types";
import type { createClient } from "@/lib/supabase/server";

type Supabase = ReturnType<typeof createClient>;

/**
 * UUIDs dos projetos onde o usuario esta envolvido, por qualquer via:
 *
 *   1. projeto_responsaveis (papel 'gp' OU 'equipe')
 *   2. projetos.created_by = eu
 *   3. orcamentos.gp_responsavel_id = eu (algum orcamento do projeto)
 *   4. orcamentos.produtor_id = eu (algum orcamento do projeto)
 *
 * Ha uma unica ida ao banco por query (nao 4). O UNION acontece no
 * cliente porque as 4 fontes estao em tabelas diferentes e um `UNION`
 * SQL exigiria RPC — o custo de rede de 4 counts pequenos e menor.
 *
 * O array pode estar vazio (usuario sem projeto nenhum). Consumidores
 * devem tratar esse caso — passar array vazio pra `.in("projeto_id", [])`
 * do PostgREST devolve zero rows, que e exatamente o que queremos.
 */
export async function projetoIdsDoUsuario(
  session: SessionContext,
  supabase: Supabase,
): Promise<string[]> {
  const tenantId = session.activeTenant.id;
  const userId = session.profile.id;
  const ids = new Set<string>();

  const [respRes, criadosRes, orcsRes] = await Promise.all([
    supabase
      .from("projeto_responsaveis")
      .select("projeto_id")
      .eq("tenant_id", tenantId)
      .eq("profile_id", userId),
    supabase
      .from("projetos")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("created_by", userId),
    supabase
      .from("orcamentos")
      .select("projeto_id")
      .eq("tenant_id", tenantId)
      .or(`gp_responsavel_id.eq.${userId},produtor_id.eq.${userId}`),
  ]);

  for (const r of respRes.data ?? []) if (r.projeto_id) ids.add(r.projeto_id);
  for (const r of criadosRes.data ?? []) if (r.id) ids.add(r.id);
  for (const r of orcsRes.data ?? []) if (r.projeto_id) ids.add(r.projeto_id);

  return Array.from(ids);
}
```

- [ ] **Step 3: Type-check**

Rode: `npm run typecheck`
Esperado: passar limpo (nenhum erro reportado).

- [ ] **Step 4: Commit**

```bash
git add lib/home/
git commit -m "feat(home): tipos compartilhados + projetoIdsDoUsuario (escopo Meus)"
```

---

## Task 2: Componentes visuais base (CardPendencia, CardKpi, EstadoVazio, CabecalhoHome)

**Files:**
- Create: `app/(app)/home/_componentes/card-pendencia.tsx`
- Create: `app/(app)/home/_componentes/card-kpi.tsx`
- Create: `app/(app)/home/_componentes/estado-vazio.tsx`
- Create: `app/(app)/home/_componentes/cabecalho-home.tsx`

**Interfaces:**
- Consumes: `CardPendencia`, `CardKpi` de `@/lib/home/tipos` (Task 1).
- Produces:
  - `function CardPendenciaLink({ card }: { card: CardPendencia })` — render de UM card de pendência clicável.
  - `function CardKpiLink({ card }: { card: CardKpi })` — render de UM KPI clicável.
  - `function EstadoVazio({ mensagem }: { mensagem: string })` — estado quando não há pendências.
  - `function CabecalhoHome({ nome, papel, subtitulo }: { nome: string; papel: string; subtitulo: string })` — header padrão da page.

- [ ] **Step 1: `CardPendenciaLink`**

Criar `app/(app)/home/_componentes/card-pendencia.tsx`:

```tsx
import Link from "next/link";
import type { CardPendencia } from "@/lib/home/tipos";

/**
 * Card de pendencia da home: titulo, contagem grande, subtitulo, icone.
 * O card inteiro e clicavel e leva pra tela destino. `prefetch={false}`
 * porque um grid de 5-8 cards prefetching em viewport satura o pool
 * de serverless functions (regra A do docs/PERFORMANCE.md).
 */
export function CardPendenciaLink({ card }: { card: CardPendencia }) {
  const Icone = card.icone;
  return (
    <Link
      href={card.href}
      prefetch={false}
      className="group rounded-2xl border border-border bg-card p-5 shadow-soft hover:border-california-red/30 hover:shadow-brand transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-california-red/10 text-california-red">
          <Icone className="h-4 w-4" />
        </div>
        <div className="text-3xl font-bold tabular-nums text-foreground">
          {card.contagem}
        </div>
      </div>
      <div className="mt-4">
        <p className="text-sm font-semibold text-foreground group-hover:text-california-red transition-colors">
          {card.titulo}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {card.subtitulo}
        </p>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: `CardKpiLink`**

Criar `app/(app)/home/_componentes/card-kpi.tsx`:

```tsx
import Link from "next/link";
import type { CardKpi } from "@/lib/home/tipos";

/**
 * Card de KPI da home: numero de destaque + rotulo. Menor que CardPendencia
 * pra caber 4 em linha sem estourar. Zero nao some (diferente do card de
 * pendencia) — numero zero e informacao.
 */
export function CardKpiLink({ card }: { card: CardKpi }) {
  const Icone = card.icone;
  return (
    <Link
      href={card.href}
      prefetch={false}
      className="group rounded-xl border border-border bg-card p-4 shadow-soft hover:border-california-red/30 transition-colors"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icone className="h-3.5 w-3.5" />
        <span>{card.titulo}</span>
      </div>
      <div className="mt-2 text-xl font-bold tabular-nums text-foreground group-hover:text-california-red transition-colors">
        {card.valor}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {card.subtitulo}
      </p>
    </Link>
  );
}
```

- [ ] **Step 3: `EstadoVazio`**

Criar `app/(app)/home/_componentes/estado-vazio.tsx`:

```tsx
import { CheckCircle2 } from "lucide-react";

/**
 * Renderizado quando o array `pendencias` do papel esta vazio (todos os
 * cards zeraram). Estado positivo, nao passivo — o usuario ve rapido que
 * nao ha pendencia, sem precisar ler cada card cinza.
 */
export function EstadoVazio({ mensagem }: { mensagem: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
        <CheckCircle2 className="h-5 w-5" />
      </div>
      <p className="mt-4 text-sm font-semibold text-foreground">
        {mensagem}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: `CabecalhoHome`**

Criar `app/(app)/home/_componentes/cabecalho-home.tsx`:

```tsx
import { Home } from "lucide-react";

/**
 * Header padrao da home. Segue o padrao das outras pages do ERP
 * (kicker vermelho + icone + titulo + subtitulo em muted) — ver
 * docs/09-identidade-visual-ui.md secao "Header padrao da pagina".
 */
export function CabecalhoHome({
  nome,
  papel,
  subtitulo,
}: {
  nome: string;
  papel: string;
  subtitulo: string;
}) {
  const primeiroNome = nome.split(" ")[0];
  return (
    <header className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
        {papel}
      </p>
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-california-red/10 p-2">
          <Home className="h-5 w-5 text-california-red" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Bem-vindo, {primeiroNome}
        </h1>
      </div>
      <p className="text-sm text-muted-foreground max-w-2xl">{subtitulo}</p>
    </header>
  );
}
```

- [ ] **Step 5: Type-check**

Rode: `npm run typecheck`
Esperado: passar limpo.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/home/_componentes/
git commit -m "feat(home): componentes visuais base (CardPendencia, CardKpi, EstadoVazio, Cabecalho)"
```

---

## Task 3: Carregadores + páginas do ADM, Financeiro e Freelancer

Essas três são as mais simples: ADM e Financeiro veem o tenant inteiro (sem filtro "Meus"); Freelancer conta com o RLS pra filtrar tudo pra ele (também não usa `projetoIdsDoUsuario`).

**Files:**
- Create: `lib/home/carregar.ts`
- Create: `app/(app)/home/home-admin.tsx`
- Create: `app/(app)/home/home-financeiro.tsx`
- Create: `app/(app)/home/home-freelancer.tsx`

**Interfaces:**
- Consumes: `DadosHome`, `CardPendencia`, `CardKpi` (Task 1); componentes da Task 2; `SessionContext` de `@/lib/types`; `createClient` de `@/lib/supabase/server`.
- Produces (em `lib/home/carregar.ts`):
  - `async function carregarHomeAdmin(session: SessionContext): Promise<DadosHome>`
  - `async function carregarHomeFinanceiro(session: SessionContext): Promise<DadosHome>`
  - `async function carregarHomeFreelancer(session: SessionContext): Promise<DadosHome>`

- [ ] **Step 1: Descobrir status reais das tabelas via MCP**

Antes de escrever queries, confirmar valores enum de status pra evitar chute. Executar em SQL:

```sql
select
  (select array_agg(distinct status) from public.jobs) as jobs_status,
  (select array_agg(distinct status) from public.pedidos_compra) as pp_status,
  (select array_agg(distinct status) from public.desembolsos) as desembolsos_status;
```

Anote os valores retornados — a Task 3 assume: `jobs.status`: `aguardando_abertura`, `aberto`, `em_producao`, `encerrado`, `cancelado`, `rejeitado_financeiro`; `pedidos_compra.status`: `em_avaliacao`, `em_processamento`, `paga`, `rejeitada`, `cancelada`; `desembolsos.status`: `em_avaliacao`, `aprovada`, `rejeitada`, `cancelada`, `paga`. Ajuste as queries dos steps seguintes se algum enum for diferente.

- [ ] **Step 2: `carregarHomeAdmin` (esqueleto + 3 primeiros cards)**

Criar `lib/home/carregar.ts` começando pela função do Admin. Os cards seguem a ordem prescrita no spec (vencidos primeiro, aprovações depois, contexto por último).

```ts
import {
  AlertTriangle,
  ArrowUpDown,
  BadgeDollarSign,
  Banknote,
  Briefcase,
  CalendarClock,
  Clock,
  CreditCard,
  FileClock,
  FileText,
  Landmark,
  Mail,
  MessageSquare,
  Receipt,
  Wallet,
} from "lucide-react";
import type { SessionContext } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { projetoIdsDoUsuario } from "./escopo-meus";
import type { CardKpi, CardPendencia, DadosHome } from "./tipos";

const formatarBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Data ISO 'YYYY-MM-DD' do primeiro e ultimo dia do mes corrente. */
function limitesDoMes(): { primeiro: string; ultimo: string } {
  const hoje = new Date();
  const p = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const u = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { primeiro: iso(p), ultimo: iso(u) };
}

const hojeISO = () => new Date().toISOString().slice(0, 10);

function diasNoFuturo(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Home do Administrador: ve o tenant inteiro. Cards de pendencia e KPIs
 * do mes corrente. Todas as contagens em Promise.all — nenhuma query
 * bloqueia a proxima.
 */
export async function carregarHomeAdmin(
  session: SessionContext,
): Promise<DadosHome> {
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const { primeiro, ultimo } = limitesDoMes();
  const hoje = hojeISO();
  const em7dias = diasNoFuturo(7);
  const ha15dias = diasNoFuturo(-15);

  const [
    contasPagarVencidas,
    contasReceberVencidas,
    jobsAguardandoAbertura,
    ppsEmAvaliacao,
    desembolsosEmAvaliacao,
    transacoesNaoConciliadas,
    jobsFaturamentoProximo,
    orcamentosParados,
    saldoBancosRes,
    previstoPagarMes,
    previstoReceberMes,
    jobsEmAndamento,
  ] = await Promise.all([
    supabase
      .from("titulos_a_pagar")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .lt("data_prevista_pagamento", hoje)
      .is("data_pagamento", null),
    supabase
      .from("titulos_a_receber")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .lt("data_prevista_recebimento", hoje)
      .is("data_recebimento", null),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "aguardando_abertura"),
    supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "em_avaliacao"),
    supabase
      .from("desembolsos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "em_avaliacao"),
    supabase
      .from("conciliacao_transacoes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("conciliada", false),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["aberto", "em_producao"])
      .gte("data_prevista_faturamento", hoje)
      .lte("data_prevista_faturamento", em7dias),
    supabase
      .from("orcamentos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["em_revisao", "enviado_cliente"])
      .lt("updated_at", ha15dias),
    supabase
      .from("contas_bancarias")
      .select("saldo_atual")
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
    supabase
      .from("titulos_a_pagar")
      .select("valor")
      .eq("tenant_id", tenantId)
      .gte("data_prevista_pagamento", primeiro)
      .lte("data_prevista_pagamento", ultimo)
      .is("data_pagamento", null),
    supabase
      .from("titulos_a_receber")
      .select("valor")
      .eq("tenant_id", tenantId)
      .gte("data_prevista_recebimento", primeiro)
      .lte("data_prevista_recebimento", ultimo)
      .is("data_recebimento", null),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["aberto", "em_producao"]),
  ]);

  const saldoBancosTotal = (saldoBancosRes.data ?? []).reduce(
    (s, r) => s + Number(r.saldo_atual ?? 0),
    0,
  );
  const totalAPagar = (previstoPagarMes.data ?? []).reduce(
    (s, r) => s + Number(r.valor ?? 0),
    0,
  );
  const totalAReceber = (previstoReceberMes.data ?? []).reduce(
    (s, r) => s + Number(r.valor ?? 0),
    0,
  );

  const pendencias: CardPendencia[] = [
    {
      titulo: "Contas a pagar vencidas",
      contagem: contasPagarVencidas.count ?? 0,
      subtitulo: "Não pagas com vencimento anterior a hoje",
      href: "/financeiro/contas-a-pagar?filtro=vencidas",
      icone: AlertTriangle,
    },
    {
      titulo: "Contas a receber vencidas",
      contagem: contasReceberVencidas.count ?? 0,
      subtitulo: "Não recebidas com vencimento anterior a hoje",
      href: "/financeiro/contas-a-receber?filtro=vencidas",
      icone: AlertTriangle,
    },
    {
      titulo: "Jobs aguardando abertura",
      contagem: jobsAguardandoAbertura.count ?? 0,
      subtitulo: "Fila do financeiro pra abrir jobs",
      href: "/financeiro/abertura-de-job",
      icone: Briefcase,
    },
    {
      titulo: "PPs em avaliação",
      contagem: ppsEmAvaliacao.count ?? 0,
      subtitulo: "Aguardando decisão do financeiro",
      href: "/financeiro/contas-a-pagar?filtro=pps_em_avaliacao",
      icone: FileClock,
    },
    {
      titulo: "Desembolsos em avaliação",
      contagem: desembolsosEmAvaliacao.count ?? 0,
      subtitulo: "Solicitações aguardando aprovação",
      href: "/financeiro/desembolsos?filtro=avaliacao",
      icone: Wallet,
    },
    {
      titulo: "Transações não conciliadas",
      contagem: transacoesNaoConciliadas.count ?? 0,
      subtitulo: "Extrato bancário sem correspondência",
      href: "/financeiro/conciliacao",
      icone: ArrowUpDown,
    },
    {
      titulo: "Jobs com faturamento próximo",
      contagem: jobsFaturamentoProximo.count ?? 0,
      subtitulo: "Data prevista nos próximos 7 dias",
      href: "/jobs?filtro=faturamento_proximo",
      icone: CalendarClock,
    },
    {
      titulo: "Orçamentos parados há mais de 15 dias",
      contagem: orcamentosParados.count ?? 0,
      subtitulo: "Sem movimentação desde então",
      href: "/orcamentos?filtro=parados",
      icone: Clock,
    },
  ];

  const kpis: CardKpi[] = [
    {
      titulo: "Saldo em bancos",
      valor: formatarBRL(saldoBancosTotal),
      subtitulo: "Hoje",
      href: "/financeiro/fluxo-caixa",
      icone: Landmark,
    },
    {
      titulo: "Previsto a pagar",
      valor: formatarBRL(totalAPagar),
      subtitulo: "No mês corrente",
      href: "/financeiro/contas-a-pagar",
      icone: Banknote,
    },
    {
      titulo: "Previsto a receber",
      valor: formatarBRL(totalAReceber),
      subtitulo: "No mês corrente",
      href: "/financeiro/contas-a-receber",
      icone: BadgeDollarSign,
    },
    {
      titulo: "Jobs em andamento",
      valor: String(jobsEmAndamento.count ?? 0),
      subtitulo: "Aberto ou em produção",
      href: "/jobs",
      icone: Briefcase,
    },
  ];

  return { pendencias, kpis };
}
```

- [ ] **Step 3: Adicionar `carregarHomeFinanceiro`**

Adicionar ao fim de `lib/home/carregar.ts`. Reutiliza várias queries do ADM; a diferença essencial é 3 KPIs (sem "Jobs em andamento"), acrescenta faturas de cartão como pendência.

```ts
/**
 * Home do Financeiro: mesma visao de tenant do ADM, mas KPIs diferentes
 * e um card extra de faturas de cartao (nao aparece pro ADM porque nao
 * cabia na visao executiva).
 */
export async function carregarHomeFinanceiro(
  session: SessionContext,
): Promise<DadosHome> {
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const { primeiro, ultimo } = limitesDoMes();
  const hoje = hojeISO();

  const [
    contasPagarVencidas,
    contasReceberVencidas,
    jobsAguardandoAbertura,
    ppsEmAvaliacao,
    desembolsosEmAvaliacao,
    transacoesNaoConciliadas,
    faturasCartaoAbertas,
    saldoBancosRes,
    previstoPagarMes,
    previstoReceberMes,
  ] = await Promise.all([
    supabase
      .from("titulos_a_pagar")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .lt("data_prevista_pagamento", hoje)
      .is("data_pagamento", null),
    supabase
      .from("titulos_a_receber")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .lt("data_prevista_recebimento", hoje)
      .is("data_recebimento", null),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "aguardando_abertura"),
    supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "em_avaliacao"),
    supabase
      .from("desembolsos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "em_avaliacao"),
    supabase
      .from("conciliacao_transacoes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("conciliada", false),
    supabase
      .from("faturas_cartao")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "fechada")
      .is("data_pagamento", null),
    supabase
      .from("contas_bancarias")
      .select("saldo_atual")
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
    supabase
      .from("titulos_a_pagar")
      .select("valor")
      .eq("tenant_id", tenantId)
      .gte("data_prevista_pagamento", primeiro)
      .lte("data_prevista_pagamento", ultimo)
      .is("data_pagamento", null),
    supabase
      .from("titulos_a_receber")
      .select("valor")
      .eq("tenant_id", tenantId)
      .gte("data_prevista_recebimento", primeiro)
      .lte("data_prevista_recebimento", ultimo)
      .is("data_recebimento", null),
  ]);

  const saldoTotal = (saldoBancosRes.data ?? []).reduce(
    (s, r) => s + Number(r.saldo_atual ?? 0),
    0,
  );
  const totalPagar = (previstoPagarMes.data ?? []).reduce(
    (s, r) => s + Number(r.valor ?? 0),
    0,
  );
  const totalReceber = (previstoReceberMes.data ?? []).reduce(
    (s, r) => s + Number(r.valor ?? 0),
    0,
  );

  const pendencias: CardPendencia[] = [
    {
      titulo: "Contas a pagar vencidas",
      contagem: contasPagarVencidas.count ?? 0,
      subtitulo: "Não pagas com vencimento anterior a hoje",
      href: "/financeiro/contas-a-pagar?filtro=vencidas",
      icone: AlertTriangle,
    },
    {
      titulo: "Contas a receber vencidas",
      contagem: contasReceberVencidas.count ?? 0,
      subtitulo: "Não recebidas com vencimento anterior a hoje",
      href: "/financeiro/contas-a-receber?filtro=vencidas",
      icone: AlertTriangle,
    },
    {
      titulo: "Jobs aguardando abertura",
      contagem: jobsAguardandoAbertura.count ?? 0,
      subtitulo: "Sua fila principal",
      href: "/financeiro/abertura-de-job",
      icone: Briefcase,
    },
    {
      titulo: "PPs em avaliação",
      contagem: ppsEmAvaliacao.count ?? 0,
      subtitulo: "Aguardando sua decisão",
      href: "/financeiro/contas-a-pagar?filtro=pps_em_avaliacao",
      icone: FileClock,
    },
    {
      titulo: "Desembolsos em avaliação",
      contagem: desembolsosEmAvaliacao.count ?? 0,
      subtitulo: "Solicitações aguardando aprovação",
      href: "/financeiro/desembolsos?filtro=avaliacao",
      icone: Wallet,
    },
    {
      titulo: "Transações não conciliadas",
      contagem: transacoesNaoConciliadas.count ?? 0,
      subtitulo: "Extrato bancário sem correspondência",
      href: "/financeiro/conciliacao",
      icone: ArrowUpDown,
    },
    {
      titulo: "Faturas de cartão aguardando pagamento",
      contagem: faturasCartaoAbertas.count ?? 0,
      subtitulo: "Fatura fechada, sem pagamento registrado",
      href: "/financeiro/contas-a-pagar?filtro=faturas_cartao",
      icone: CreditCard,
    },
  ];

  const kpis: CardKpi[] = [
    {
      titulo: "Saldo em bancos",
      valor: formatarBRL(saldoTotal),
      subtitulo: "Hoje",
      href: "/financeiro/fluxo-caixa",
      icone: Landmark,
    },
    {
      titulo: "Previsto a pagar",
      valor: formatarBRL(totalPagar),
      subtitulo: "No mês corrente",
      href: "/financeiro/contas-a-pagar",
      icone: Banknote,
    },
    {
      titulo: "Previsto a receber",
      valor: formatarBRL(totalReceber),
      subtitulo: "No mês corrente",
      href: "/financeiro/contas-a-receber",
      icone: BadgeDollarSign,
    },
  ];

  return { pendencias, kpis };
}
```

- [ ] **Step 4: Adicionar `carregarHomeFreelancer`**

Ao fim de `lib/home/carregar.ts`. O RLS filtra tudo pra o Freelancer, então não passamos `projeto_id` explícito nas queries.

```ts
/**
 * Home do Freelancer: o RLS ja restringe tudo aos projetos onde ele
 * participa (via projeto_responsaveis), entao as queries aqui NAO
 * precisam de filtro adicional. Sem KPI de faturamento — Freelancer
 * nao faz gestao de dinheiro.
 */
export async function carregarHomeFreelancer(
  session: SessionContext,
): Promise<DadosHome> {
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const [meusJobsAtivos, realizadoPendente, mensagensNaoLidas] =
    await Promise.all([
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .in("status", ["aberto", "em_producao"]),
      supabase
        .from("jobs_itens_realizado")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .is("valor_total_realizado", null),
      supabase
        .from("jobs_mensagens")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .neq("autor_id", session.profile.id),
    ]);

  const pendencias: CardPendencia[] = [
    {
      titulo: "Realizado a preencher",
      contagem: realizadoPendente.count ?? 0,
      subtitulo: "Itens dos seus jobs sem valor registrado",
      href: "/jobs?filtro=realizado_pendente",
      icone: FileText,
    },
    {
      titulo: "Mensagens não lidas",
      contagem: mensagensNaoLidas.count ?? 0,
      subtitulo: "No chat dos seus jobs",
      href: "/jobs?filtro=chat_pendente",
      icone: MessageSquare,
    },
  ];

  const kpis: CardKpi[] = [
    {
      titulo: "Meus jobs ativos",
      valor: String(meusJobsAtivos.count ?? 0),
      subtitulo: "Aberto ou em produção",
      href: "/jobs",
      icone: Briefcase,
    },
  ];

  return { pendencias, kpis };
}
```

- [ ] **Step 5: Página `home-admin.tsx`**

Criar `app/(app)/home/home-admin.tsx`:

```tsx
import type { SessionContext } from "@/lib/types";
import { carregarHomeAdmin } from "@/lib/home/carregar";
import { CabecalhoHome } from "./_componentes/cabecalho-home";
import { CardPendenciaLink } from "./_componentes/card-pendencia";
import { CardKpiLink } from "./_componentes/card-kpi";
import { EstadoVazio } from "./_componentes/estado-vazio";

export async function HomeAdmin({ session }: { session: SessionContext }) {
  const { pendencias, kpis } = await carregarHomeAdmin(session);
  const pendenciasVisiveis = pendencias.filter((c) => c.contagem > 0);

  return (
    <div className="space-y-8">
      <CabecalhoHome
        nome={session.profile.nome}
        papel="Administração"
        subtitulo="Painel operacional do tenant: pendências primeiro, números do mês em seguida."
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Precisa da sua atenção
        </h2>
        {pendenciasVisiveis.length === 0 ? (
          <EstadoVazio mensagem="Tudo em dia por aqui." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {pendenciasVisiveis.map((c) => (
              <CardPendenciaLink key={c.href + c.titulo} card={c} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Números do mês</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <CardKpiLink key={k.href + k.titulo} card={k} />
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Página `home-financeiro.tsx`**

Criar `app/(app)/home/home-financeiro.tsx`:

```tsx
import type { SessionContext } from "@/lib/types";
import { carregarHomeFinanceiro } from "@/lib/home/carregar";
import { CabecalhoHome } from "./_componentes/cabecalho-home";
import { CardPendenciaLink } from "./_componentes/card-pendencia";
import { CardKpiLink } from "./_componentes/card-kpi";
import { EstadoVazio } from "./_componentes/estado-vazio";

export async function HomeFinanceiro({
  session,
}: {
  session: SessionContext;
}) {
  const { pendencias, kpis } = await carregarHomeFinanceiro(session);
  const pendenciasVisiveis = pendencias.filter((c) => c.contagem > 0);

  return (
    <div className="space-y-8">
      <CabecalhoHome
        nome={session.profile.nome}
        papel="Financeiro"
        subtitulo="Suas filas do dia: aprovações, conciliação e vencimentos. KPIs do mês na base."
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Aguardando você
        </h2>
        {pendenciasVisiveis.length === 0 ? (
          <EstadoVazio mensagem="Fila zerada. Bom trabalho." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {pendenciasVisiveis.map((c) => (
              <CardPendenciaLink key={c.href + c.titulo} card={c} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Números do mês</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {kpis.map((k) => (
            <CardKpiLink key={k.href + k.titulo} card={k} />
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 7: Página `home-freelancer.tsx`**

Criar `app/(app)/home/home-freelancer.tsx`. Estado vazio específico quando não tem job ativo, conforme spec:

```tsx
import type { SessionContext } from "@/lib/types";
import { carregarHomeFreelancer } from "@/lib/home/carregar";
import { CabecalhoHome } from "./_componentes/cabecalho-home";
import { CardPendenciaLink } from "./_componentes/card-pendencia";
import { CardKpiLink } from "./_componentes/card-kpi";
import { EstadoVazio } from "./_componentes/estado-vazio";

export async function HomeFreelancer({
  session,
}: {
  session: SessionContext;
}) {
  const { pendencias, kpis } = await carregarHomeFreelancer(session);
  const jobsAtivos = Number(kpis[0]?.valor ?? "0");
  const pendenciasVisiveis = pendencias.filter((c) => c.contagem > 0);

  return (
    <div className="space-y-8">
      <CabecalhoHome
        nome={session.profile.nome}
        papel="Freelancer"
        subtitulo="Seus jobs, seu realizado e seu chat — o que precisa da sua atenção."
      />

      {jobsAtivos === 0 ? (
        <EstadoVazio mensagem="Nenhum job atribuído a você ainda. Fale com o gestor do projeto." />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              Precisa da sua atenção
            </h2>
            {pendenciasVisiveis.length === 0 ? (
              <EstadoVazio mensagem="Tudo em dia por aqui." />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {pendenciasVisiveis.map((c) => (
                  <CardPendenciaLink key={c.href + c.titulo} card={c} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              Meu volume
            </h2>
            <div className="grid gap-3 md:grid-cols-3">
              {kpis.map((k) => (
                <CardKpiLink key={k.href + k.titulo} card={k} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Roteador em `page.tsx`**

Substituir todo o conteúdo de `app/(app)/home/page.tsx`:

```tsx
import { requireSession } from "@/lib/auth/session";
import { HomeAdmin } from "./home-admin";
import { HomeFinanceiro } from "./home-financeiro";
import { HomeFreelancer } from "./home-freelancer";
// HomeGerenteProducao e HomeProdutor entram na Task 4 — placeholder
// abaixo mantem a rota funcional pra esses papeis enquanto isso.

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requireSession();

  switch (session.activeRole) {
    case "administrador":
      return <HomeAdmin session={session} />;
    case "financeiro":
      return <HomeFinanceiro session={session} />;
    case "freelancer":
      return <HomeFreelancer session={session} />;
    case "gerente_producao":
    case "produtor":
      // Task 4 troca por HomeGerenteProducao / HomeProdutor.
      return (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-10 text-center">
          <p className="text-sm font-semibold text-foreground">
            Home deste papel em construção.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Volta em breve com pendências e números do time.
          </p>
        </div>
      );
  }
}
```

- [ ] **Step 9: Type-check + build**

Rode:

```bash
npm run typecheck
rm -rf .next && npm run build
```

Esperado: type-check limpo; build produz `/home` como rota dinâmica.

- [ ] **Step 10: Sanity via SQL (opcional mas recomendado)**

Antes do smoke test manual, validar que as queries batem com o esperado. Rodar via MCP (execute_sql do supabase-write) simulando o admin. Exemplo:

```sql
-- Jogo de sanidade pro Admin: espera 30 jobs em andamento
begin;
select set_config('request.jwt.claim.sub',
  (select id::text from public.profiles where email = 'antonio@pevetech.com.br' limit 1), true);
set local role authenticated;
select
  (select count(*) from public.jobs where status in ('aberto','em_producao')) as jobs_em_andamento,
  (select count(*) from public.jobs where status = 'aguardando_abertura') as aguardando_abertura,
  (select count(*) from public.pedidos_compra where status = 'em_avaliacao') as pps_em_avaliacao;
rollback;
```

Comparar com o que a home renderiza depois do smoke test.

- [ ] **Step 11: Smoke test manual**

Logar como cada um (senha `Teste2026!`, docs/10-permissoes-por-perfil.md):
- `antonio@pevetech.com.br` → home do Admin.
- `financeiro_teste@califa-erp.local` → home do Financeiro.
- `freelancer_teste@califa-erp.local` → home do Freelancer (esperado: card "Meus jobs ativos = 0" porque o projeto SEBRAE vinculado a ele não tem jobs; estado vazio grande da página).

Conferir que:
- Cards com contagem > 0 aparecem; contagem = 0 some.
- Cada card clicado vai pra URL correta (mesmo que o filtro ainda não esteja implementado no destino — Task 5 fecha isso).
- KPIs sempre aparecem, mesmo com 0.

- [ ] **Step 12: Commit**

```bash
git add app/\(app\)/home/ lib/home/carregar.ts
git commit -m "feat(home): homes de ADM, Financeiro e Freelancer + roteador em page.tsx"
```

---

## Task 4: Homes do GP e do Produtor (com escopo "Meus")

Essas duas usam o helper `projetoIdsDoUsuario` da Task 1 pra montar o escopo expandido. Cards de ação usam filtro estrito (`responsavel_id = eu`) — ver seção 3 do spec.

**Files:**
- Modify: `lib/home/carregar.ts` (adicionar 2 funções)
- Create: `app/(app)/home/home-gerente-producao.tsx`
- Create: `app/(app)/home/home-produtor.tsx`
- Modify: `app/(app)/home/page.tsx` (trocar placeholder pelas homes reais)

**Interfaces:**
- Consumes: `projetoIdsDoUsuario` (Task 1); `DadosHome`, `CardPendencia`, `CardKpi` (Task 1); componentes visuais (Task 2); `carregarHomeAdmin` (Task 3) só como referência de padrão.
- Produces:
  - `async function carregarHomeGerenteProducao(session: SessionContext): Promise<DadosHome>`
  - `async function carregarHomeProdutor(session: SessionContext): Promise<DadosHome>`

- [ ] **Step 1: Adicionar `carregarHomeGerenteProducao`**

Adicionar ao fim de `lib/home/carregar.ts`:

```ts
/**
 * Home do Gerente de Producao.
 *
 * Cards de ACAO usam filtro estrito (a acao so pode ser executada por
 * quem e responsavel direto): versoes onde `orcamento.gp_responsavel_id`
 * bate, jobs onde `responsavel_id` bate.
 *
 * Cards de CONTEXTO usam o escopo expandido via `projetoIdsDoUsuario`.
 * Ver secao 3 do spec 2026-09-04-home-por-papel-design.md.
 */
export async function carregarHomeGerenteProducao(
  session: SessionContext,
): Promise<DadosHome> {
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const userId = session.profile.id;
  const hoje = hojeISO();
  const em7dias = diasNoFuturo(7);

  // Escopo expandido: rodado uma vez, reusado nos cards de contexto.
  const projetoIds = await projetoIdsDoUsuario(session, supabase);
  const semProjetos = projetoIds.length === 0;

  const [
    versoesAguardandoMim,
    jobsProntosPraFaturar,
    jobsProntosPraEncerrar,
    jobsFaturamentoProximo,
    mensagensNaoLidas,
    meusJobsAndamento,
    meusOrcamentosAbertos,
  ] = await Promise.all([
    // ESTRITO: versoes onde eu sou o GP do orcamento
    supabase
      .from("versoes_orcamento")
      .select("id, orcamento:orcamentos!inner(gp_responsavel_id)", {
        count: "exact",
        head: true,
      })
      .eq("tenant_id", tenantId)
      .in("status", ["em_revisao", "enviada_cliente"])
      .eq("orcamento.gp_responsavel_id", userId),
    // ESTRITO: meus jobs abertos com faturamento previsto > 0 e sem
    // errata pendente. "Sem envio ativo" e conferido no click — na
    // home basta este count.
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("responsavel_id", userId)
      .eq("status", "aberto")
      .gt("faturamento_previsto", 0)
      .or("abertura_em_revisao.is.null,abertura_em_revisao.eq.false"),
    // ESTRITO: meus jobs abertos onde envio de faturamento ja foi feito
    // (marcador simples: existe registro em jobs_envio_faturamento
    // com status emitido).
    supabase
      .from("jobs")
      .select("id, envios:jobs_envio_faturamento!inner(status)", {
        count: "exact",
        head: true,
      })
      .eq("tenant_id", tenantId)
      .eq("responsavel_id", userId)
      .eq("status", "aberto")
      .eq("envios.status", "emitido"),
    // CONTEXTO: jobs proximos do vencimento nos meus projetos
    semProjetos
      ? Promise.resolve({ count: 0 })
      : supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .in("projeto_id", projetoIds)
          .in("status", ["aberto", "em_producao"])
          .gte("data_prevista_faturamento", hoje)
          .lte("data_prevista_faturamento", em7dias),
    // CONTEXTO: mensagens nao lidas nos jobs onde participo
    // Nota: contagem simplificada — mensagens onde o autor NAO sou eu.
    // Refinar com jobs_chat_leituras cai na fase 2 (spec risco #5).
    semProjetos
      ? Promise.resolve({ count: 0 })
      : supabase
          .from("jobs_mensagens")
          .select("id, job:jobs!inner(projeto_id)", {
            count: "exact",
            head: true,
          })
          .eq("tenant_id", tenantId)
          .in("job.projeto_id", projetoIds)
          .neq("autor_id", userId),
    // CONTEXTO KPI: jobs em andamento nos meus projetos
    semProjetos
      ? Promise.resolve({ count: 0 })
      : supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .in("projeto_id", projetoIds)
          .in("status", ["aberto", "em_producao"]),
    // CONTEXTO KPI: orcamentos abertos nos meus projetos
    semProjetos
      ? Promise.resolve({ count: 0 })
      : supabase
          .from("orcamentos")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .in("projeto_id", projetoIds)
          .in("status", ["rascunho", "em_revisao", "enviado_cliente"]),
  ]);

  const pendencias: CardPendencia[] = [
    {
      titulo: "Versões aguardando sua aprovação",
      contagem: versoesAguardandoMim.count ?? 0,
      subtitulo: "Orçamentos onde você é o GP responsável",
      href: "/orcamentos?filtro=aguardando_aprovacao&meus=1",
      icone: FileClock,
    },
    {
      titulo: "Jobs prontos pra enviar pra faturamento",
      contagem: jobsProntosPraFaturar.count ?? 0,
      subtitulo: "Seus jobs abertos com previsão positiva",
      href: "/jobs?filtro=faturamento_pronto&meus=1",
      icone: Mail,
    },
    {
      titulo: "Jobs prontos pra encerrar",
      contagem: jobsProntosPraEncerrar.count ?? 0,
      subtitulo: "Seus jobs com faturamento emitido",
      href: "/jobs?filtro=encerrar_pronto&meus=1",
      icone: Receipt,
    },
    {
      titulo: "Jobs com faturamento próximo",
      contagem: jobsFaturamentoProximo.count ?? 0,
      subtitulo: "Nos seus projetos, nos próximos 7 dias",
      href: "/jobs?filtro=faturamento_proximo&meus=1",
      icone: CalendarClock,
    },
    {
      titulo: "Mensagens não lidas",
      contagem: mensagensNaoLidas.count ?? 0,
      subtitulo: "Chat dos jobs do seu time",
      href: "/jobs?filtro=chat_pendente&meus=1",
      icone: MessageSquare,
    },
  ];

  const kpis: CardKpi[] = [
    {
      titulo: "Meus jobs em andamento",
      valor: String(meusJobsAndamento.count ?? 0),
      subtitulo: "Time inteiro, aberto ou em produção",
      href: "/jobs?meus=1",
      icone: Briefcase,
    },
    {
      titulo: "Meus orçamentos abertos",
      valor: String(meusOrcamentosAbertos.count ?? 0),
      subtitulo: "Rascunho, revisão ou enviado ao cliente",
      href: "/orcamentos?meus=1",
      icone: FileText,
    },
  ];

  return { pendencias, kpis };
}
```

- [ ] **Step 2: Adicionar `carregarHomeProdutor`**

Ao fim de `lib/home/carregar.ts`:

```ts
/**
 * Home do Produtor. Cards de acao sobre coisas dele (PPs que ele emitiu,
 * jobs sob sua responsabilidade); contexto no time.
 */
export async function carregarHomeProdutor(
  session: SessionContext,
): Promise<DadosHome> {
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const userId = session.profile.id;
  const { primeiro, ultimo } = limitesDoMes();

  const projetoIds = await projetoIdsDoUsuario(session, supabase);
  const semProjetos = projetoIds.length === 0;

  const [
    ppsRejeitadas,
    realizadoPendente,
    mensagensNaoLidas,
    meusJobsAndamento,
    ppsEmitidasMes,
  ] = await Promise.all([
    // ESTRITO: PPs que EU emiti e foram rejeitadas
    supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("emitida_por", userId)
      .eq("status", "rejeitada"),
    // ESTRITO: jobs onde sou responsavel OU produtor, com itens sem
    // valor realizado registrado
    supabase
      .from("jobs_itens_realizado")
      .select("id, job:jobs!inner(responsavel_id, produtor_id, status)", {
        count: "exact",
        head: true,
      })
      .eq("tenant_id", tenantId)
      .is("valor_total_realizado", null)
      .in("job.status", ["aberto", "em_producao"])
      .or(
        `job.responsavel_id.eq.${userId},job.produtor_id.eq.${userId}`,
      ),
    // CONTEXTO: mensagens nao lidas nos jobs onde participo
    semProjetos
      ? Promise.resolve({ count: 0 })
      : supabase
          .from("jobs_mensagens")
          .select("id, job:jobs!inner(projeto_id)", {
            count: "exact",
            head: true,
          })
          .eq("tenant_id", tenantId)
          .in("job.projeto_id", projetoIds)
          .neq("autor_id", userId),
    // KPI CONTEXTO: jobs em andamento no time
    semProjetos
      ? Promise.resolve({ count: 0 })
      : supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .in("projeto_id", projetoIds)
          .in("status", ["aberto", "em_producao"]),
    // KPI ESTRITO: PPs que eu emiti este mes
    supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("emitida_por", userId)
      .gte("emitida_em", primeiro)
      .lte("emitida_em", ultimo),
  ]);

  const pendencias: CardPendencia[] = [
    {
      titulo: "PPs rejeitadas",
      contagem: ppsRejeitadas.count ?? 0,
      subtitulo: "Suas PPs devolvidas pelo financeiro",
      href: "/jobs?filtro=pps_rejeitadas&meus=1",
      icone: FileClock,
    },
    {
      titulo: "Realizado a preencher",
      contagem: realizadoPendente.count ?? 0,
      subtitulo: "Itens dos seus jobs sem valor registrado",
      href: "/jobs?filtro=realizado_pendente&meus=1",
      icone: FileText,
    },
    {
      titulo: "Mensagens não lidas",
      contagem: mensagensNaoLidas.count ?? 0,
      subtitulo: "Chat dos jobs do seu time",
      href: "/jobs?filtro=chat_pendente&meus=1",
      icone: MessageSquare,
    },
  ];

  const kpis: CardKpi[] = [
    {
      titulo: "Meus jobs em andamento",
      valor: String(meusJobsAndamento.count ?? 0),
      subtitulo: "Time inteiro, aberto ou em produção",
      href: "/jobs?meus=1",
      icone: Briefcase,
    },
    {
      titulo: "PPs emitidas por mim",
      valor: String(ppsEmitidasMes.count ?? 0),
      subtitulo: "No mês corrente",
      href: "/jobs?filtro=minhas_pps&meus=1",
      icone: Receipt,
    },
  ];

  return { pendencias, kpis };
}
```

- [ ] **Step 3: Página `home-gerente-producao.tsx`**

Criar `app/(app)/home/home-gerente-producao.tsx`:

```tsx
import type { SessionContext } from "@/lib/types";
import { carregarHomeGerenteProducao } from "@/lib/home/carregar";
import { CabecalhoHome } from "./_componentes/cabecalho-home";
import { CardPendenciaLink } from "./_componentes/card-pendencia";
import { CardKpiLink } from "./_componentes/card-kpi";
import { EstadoVazio } from "./_componentes/estado-vazio";

export async function HomeGerenteProducao({
  session,
}: {
  session: SessionContext;
}) {
  const { pendencias, kpis } = await carregarHomeGerenteProducao(session);
  const pendenciasVisiveis = pendencias.filter((c) => c.contagem > 0);

  return (
    <div className="space-y-8">
      <CabecalhoHome
        nome={session.profile.nome}
        papel="Gestão de Produção"
        subtitulo="Aprovações que dependem de você e o volume do seu time."
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Aguardando você
        </h2>
        {pendenciasVisiveis.length === 0 ? (
          <EstadoVazio mensagem="Nada precisa da sua atenção agora." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pendenciasVisiveis.map((c) => (
              <CardPendenciaLink key={c.href + c.titulo} card={c} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Seu time</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {kpis.map((k) => (
            <CardKpiLink key={k.href + k.titulo} card={k} />
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Página `home-produtor.tsx`**

Criar `app/(app)/home/home-produtor.tsx`:

```tsx
import type { SessionContext } from "@/lib/types";
import { carregarHomeProdutor } from "@/lib/home/carregar";
import { CabecalhoHome } from "./_componentes/cabecalho-home";
import { CardPendenciaLink } from "./_componentes/card-pendencia";
import { CardKpiLink } from "./_componentes/card-kpi";
import { EstadoVazio } from "./_componentes/estado-vazio";

export async function HomeProdutor({
  session,
}: {
  session: SessionContext;
}) {
  const { pendencias, kpis } = await carregarHomeProdutor(session);
  const pendenciasVisiveis = pendencias.filter((c) => c.contagem > 0);

  return (
    <div className="space-y-8">
      <CabecalhoHome
        nome={session.profile.nome}
        papel="Produção"
        subtitulo="O que precisa de você nos jobs em andamento e o seu volume."
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Precisa da sua atenção
        </h2>
        {pendenciasVisiveis.length === 0 ? (
          <EstadoVazio mensagem="Tudo em dia por aqui." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pendenciasVisiveis.map((c) => (
              <CardPendenciaLink key={c.href + c.titulo} card={c} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Seu volume no mês
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {kpis.map((k) => (
            <CardKpiLink key={k.href + k.titulo} card={k} />
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Trocar placeholder no `page.tsx`**

Editar `app/(app)/home/page.tsx`:

Substituir os cases `gerente_producao` e `produtor` (que hoje devolvem o placeholder "Home deste papel em construção") por:

```tsx
    case "gerente_producao":
      return <HomeGerenteProducao session={session} />;
    case "produtor":
      return <HomeProdutor session={session} />;
```

E adicionar os imports no topo:

```tsx
import { HomeGerenteProducao } from "./home-gerente-producao";
import { HomeProdutor } from "./home-produtor";
```

- [ ] **Step 6: Type-check + build**

```bash
npm run typecheck
rm -rf .next && npm run build
```

- [ ] **Step 7: Sanity SQL pro GP e Produtor**

Rodar via MCP:

```sql
begin;
-- GP teste
select set_config('request.jwt.claim.sub',
  (select id::text from public.profiles where email = 'gp_teste@califa-erp.local' limit 1), true);
set local role authenticated;
select
  (select count(*) from public.versoes_orcamento v
    join public.orcamentos o on o.id = v.orcamento_id
    where v.status in ('em_revisao','enviada_cliente')
      and o.gp_responsavel_id = (select id from public.profiles where email = 'gp_teste@califa-erp.local' limit 1))
   as versoes_gp;
rollback;
```

Compare com o que o card renderiza.

- [ ] **Step 8: Smoke test manual**

Logar como `gp_teste@califa-erp.local` e `produtor_teste@califa-erp.local` (senha `Teste2026!`).

Verificar:
- Cards com contagem > 0 aparecem; = 0 somem.
- KPIs sempre aparecem.
- Freelancer teste continua funcionando (regressão).

- [ ] **Step 9: Commit**

```bash
git add lib/home/carregar.ts app/\(app\)/home/home-gerente-producao.tsx app/\(app\)/home/home-produtor.tsx app/\(app\)/home/page.tsx
git commit -m "feat(home): homes do GP e do Produtor com escopo Meus expandido/estrito"
```

---

## Task 5: Filtros de aterrissagem nas telas destino

Cada card da home aponta pra uma URL com `?filtro=<slug>`. Muitos desses filtros ainda não existem nas telas destino. Esta task adiciona o parse do `?filtro=` em cada page e aplica na query. Filtros que ainda não fazem sentido (porque a tela destino não existe ou não suporta) ficam registrados como TODO no docstring da própria home.

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx` — filtros `vencidas`, `pps_em_avaliacao`, `faturas_cartao`.
- Modify: `app/(app)/financeiro/contas-a-receber/page.tsx` — filtro `vencidas`.
- Modify: `app/(app)/financeiro/desembolsos/page.tsx` — filtro `avaliacao`.
- Modify: `app/(app)/jobs/page.tsx` — filtros `faturamento_proximo`, `faturamento_pronto`, `encerrar_pronto`, `chat_pendente`, `realizado_pendente`, `pps_rejeitadas`, `minhas_pps`.
- Modify: `app/(app)/orcamentos/page.tsx` — filtros `parados`, `aguardando_aprovacao`.

**Interfaces:**
- Consumes: nada novo além do `searchParams` do server component.
- Produces: nada exportado — só efeitos nas queries.

**Nota importante:** cada tela destino já lê `searchParams`? Confira o arquivo antes de mexer. Se tela usa um wrapper client component, o filtro precisa ir como prop pra ele.

- [ ] **Step 1: Enumerar filtros já existentes**

Antes de codar, rode `grep -rn "searchParams" app/\(app\)/{financeiro,jobs,orcamentos}/**/page.tsx` (via Grep tool). Identifique quais pages já usam `searchParams`. As que não usam vão precisar adicionar o parâmetro na signature.

- [ ] **Step 2: Para cada tela destino, adicionar filtro**

Padrão a seguir dentro do server component da tela:

```tsx
export default async function ContasAPagarPage({
  searchParams,
}: {
  searchParams?: { filtro?: string };
}) {
  const filtro = searchParams?.filtro;
  // ... resto do carregamento
  const podePular =
    filtro !== "vencidas" &&
    filtro !== "pps_em_avaliacao" &&
    filtro !== "faturas_cartao";

  let query = supabase
    .from("titulos_a_pagar")
    .select(...)
    .eq("tenant_id", session.activeTenant.id);

  if (filtro === "vencidas") {
    query = query
      .lt("data_prevista_pagamento", hojeISO())
      .is("data_pagamento", null);
  } else if (filtro === "pps_em_avaliacao") {
    // A relacao com PP: titulo pertence a uma parcela de PP em avaliacao.
    // Se a tabela nao tem essa relacao direta, filtre no client apos load
    // ou faca join via view (fase 2).
    query = query.eq("origem_tipo", "pp").eq("origem_status", "em_avaliacao");
  } else if (filtro === "faturas_cartao") {
    query = query.eq("origem_tipo", "fatura_cartao");
  }

  const { data } = await query.order("data_prevista_pagamento");
  // ... resto
}
```

**Aviso importante:** a decisão de qual coluna filtrar depende do schema real. **Antes de aplicar, rode via MCP:**

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'titulos_a_pagar' and table_schema = 'public'
order by ordinal_position;
```

E ajuste as cláusulas `where` de cada `filtro` conforme os nomes reais. **NÃO chute nomes de coluna.**

- [ ] **Step 3: Filtro em `contas-a-pagar/page.tsx`**

Ler o arquivo atual, identificar o ponto de inserção da query principal, adicionar os 3 filtros (`vencidas`, `pps_em_avaliacao`, `faturas_cartao`) seguindo o padrão do Step 2.

Ao terminar, rode `npm run typecheck` e clique no card da home do Admin pra confirmar que a URL destino filtra.

- [ ] **Step 4: Filtro em `contas-a-receber/page.tsx`**

Apenas `vencidas`:

```ts
if (filtro === "vencidas") {
  query = query
    .lt("data_prevista_recebimento", hojeISO())
    .is("data_recebimento", null);
}
```

- [ ] **Step 5: Filtro em `desembolsos/page.tsx`**

Apenas `avaliacao`:

```ts
if (filtro === "avaliacao") {
  query = query.eq("status", "em_avaliacao");
}
```

- [ ] **Step 6: Filtros em `jobs/page.tsx`**

7 filtros. Ordem sugerida (mais simples primeiro):

- `realizado_pendente` — jobs abertos/em_producao com pelo menos um `jobs_itens_realizado.valor_total_realizado` NULL. Sub-query com `not_exists` ou `.in(job_ids)`.
- `pps_rejeitadas` — jobs com pelo menos uma `pedidos_compra` em status `rejeitada`. Sub-query.
- `faturamento_proximo` — `data_prevista_faturamento` entre hoje e +7 dias, status `aberto`/`em_producao`.
- `faturamento_pronto` — `status='aberto' and faturamento_previsto > 0 and abertura_em_revisao != true` (e sem envio ativo — se ficar complicado, ignorar essa parte por ora e deixar TODO).
- `encerrar_pronto` — jobs com envio de faturamento emitido (join com `jobs_envio_faturamento`).
- `chat_pendente` — jobs com pelo menos uma mensagem onde `autor_id != eu`.
- `minhas_pps` — jobs onde eu emiti PPs no mês corrente.

**Combinar com `meus=1`:** se `searchParams.meus === "1"`, aplicar também filtro por `projetoIdsDoUsuario` (mesmo helper da home).

Cada filtro em um bloco `else if`. Se o filtro é desconhecido, ignora silenciosamente (nada de erro — usuário digitou mal ou link antigo).

- [ ] **Step 7: Filtros em `orcamentos/page.tsx`**

Dois filtros:

```ts
if (filtro === "parados") {
  query = query
    .in("status", ["em_revisao", "enviado_cliente"])
    .lt("updated_at", diasNoFuturo(-15));
} else if (filtro === "aguardando_aprovacao") {
  query = query.in("status", ["em_revisao", "enviada_cliente"]);
  // Se o "meus=1" tambem estiver marcado, cruzar com gp_responsavel_id
}
```

Combinar com `meus=1` do mesmo jeito que jobs.

- [ ] **Step 8: Type-check + build**

```bash
npm run typecheck
rm -rf .next && npm run build
```

- [ ] **Step 9: Smoke test end-to-end**

Logar como Admin. Da home, clicar em cada card e confirmar que a tela destino aterrissa filtrada. Repetir com GP e Produtor.

Se algum card do GP/Produtor não filtrar corretamente porque a tela destino não entende `meus=1`, documentar no card de destino como TODO (comentário no jsx do card, tipo `{/* TODO: /jobs ainda não filtra por meus=1 */}`).

- [ ] **Step 10: Commit**

```bash
git add app/\(app\)/{financeiro,jobs,orcamentos}/
git commit -m "feat(home): filtros de aterrissagem nas telas destino"
```

---

## Task 6: Testes de smoke com os 4 usuários de teste + doc

**Files:**
- Modify: `docs/10-permissoes-por-perfil.md` (adiciona seção "Homes por papel — comportamento observado").

**Interfaces:**
- Nada exportado.

Esta task existe pra **conferir**, num único passo, que as 5 homes se comportam bem com dados reais. Se algo estiver estranho, corrigir antes do commit.

- [ ] **Step 1: Ligar dev server**

```bash
npm run dev
```

Deixar rodando na porta 3000.

- [ ] **Step 2: Logar como Admin (Antonio)**

Abrir `http://localhost:3000/home` no navegador. Anotar:
- Quantidade de cards de pendência com contagem > 0.
- Cada valor de KPI (saldo, previsto pagar, previsto receber, jobs em andamento).
- Cronometrar TTFB (deve ficar < 300ms warm — regra do docs/PERFORMANCE.md).

Clicar em UM card de pendência e conferir que a URL destino traz `?filtro=...` correto.

- [ ] **Step 3: Repetir pros outros 4 usuários**

Fazer logout, logar como:
- `gp_teste@califa-erp.local` (senha `Teste2026!`)
- `produtor_teste@califa-erp.local`
- `freelancer_teste@califa-erp.local`
- `financeiro_teste@califa-erp.local`

Pra cada:
- Home carrega sem erro?
- Cards e KPIs batem com o esperado (comparar com queries SQL de sanidade).
- Freelancer teste vê o estado vazio grande porque o SEBRAE ainda não tem job? Ou vê a lista normal se agora tiver jobs.

- [ ] **Step 4: Documentar em `docs/10-permissoes-por-perfil.md`**

No final do arquivo (antes de "Limpeza dos usuários de teste"), adicionar seção nova:

```md
## Homes por papel — comportamento observado (04/09/2026)

Snapshot logo depois da implementação da Task 7 do projeto de permissões
(ver `docs/superpowers/specs/2026-09-04-home-por-papel-design.md`).

| Papel | Pendências visíveis | KPIs mostrados | Observações |
|---|---|---|---|
| Administrador | (preencher) | (preencher) | (preencher) |
| Gerente de Produção (`gp_teste`) | (preencher) | (preencher) | (preencher) |
| Produtor (`produtor_teste`) | (preencher) | (preencher) | (preencher) |
| Freelancer (`freelancer_teste`) | 0 (SEBRAE sem jobs) | Meus jobs ativos = 0 | Estado vazio grande da página. |
| Financeiro (`financeiro_teste`) | (preencher) | (preencher) | (preencher) |
```

- [ ] **Step 5: Commit final**

```bash
git add docs/10-permissoes-por-perfil.md
git commit -m "docs(home): registro de comportamento observado das 5 homes por papel"
```

---

## Self-review checklist (para o autor do plano)

Depois de escrever cada task acima, releia o spec e responda:

- [ ] **Spec coverage** — todas as 5 seções do spec (regras gerais, "Meus", cards por papel, arquitetura, performance) têm task correspondente? SIM: Task 1 cobre helper Meus e tipos; Task 2 cobre componentes visuais; Task 3+4 cobrem as 5 pages; Task 5 cobre filtros nas telas destino; Task 6 cobre smoke test.
- [ ] **Nomes de coluna** — as queries usam nomes reais das tabelas? Alguns são **suposições** (`titulos_a_pagar.data_prevista_pagamento`, `pedidos_compra.emitida_por`, `contas_bancarias.saldo_atual`, etc.). O Step 1 da Task 3 e Step 2 da Task 5 explicitamente pedem pra rodar `information_schema.columns` via MCP antes — o executor DEVE fazer isso e corrigir qualquer chute nomeado errado.
- [ ] **Type consistency** — `DadosHome`, `CardPendencia`, `CardKpi` iguais em todas as tasks? SIM.
- [ ] **Placeholders** — nenhum "TBD" ou "similar to Task N". Cada bloco tem código completo. Ok.
