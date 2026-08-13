# Chat de PPs no Job — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar chat escopado a PPs dentro da tab "Pedidos de Produção" do job, com FAB flutuante que abre drawer lateral, mensagens Produção ↔ Financeiro misturadas com cards automáticos de eventos de PP (emitida / paga / rejeitada / cancelada).

**Architecture:** Reusar `jobs_mensagens` e `jobs_chat_leituras` adicionando coluna `escopo chat_escopo`. Server monta thread combinando mensagens humanas (escopo='pps') com cards derivados de `pedidos_compra`. FAB é client component com badge de não-lidas que assina realtime; drawer só monta a section quando aberto. Extrair `BalaoPessoa`, `ChatInput` e mapa de ícones pra `components/chat/` — dois chats compartilham as mesmas primitivas.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase (Postgres + RLS + Realtime), Tailwind, shadcn/ui (Dialog+DrawerContent existentes), Radix, lucide-react.

## Global Constraints

Aplicam a **todas** as tasks. Copiados verbatim de [CLAUDE.md](CLAUDE.md), [docs/PERFORMANCE.md](docs/PERFORMANCE.md) e da spec [docs/superpowers/specs/2026-08-10-chat-pps-no-job-design.md](docs/superpowers/specs/2026-08-10-chat-pps-no-job-design.md).

- **Performance é feature.** Leia [docs/PERFORMANCE.md](docs/PERFORMANCE.md) antes de tocar `app/(app)/**` ou `lib/supabase/**`. Queries paralelas via `Promise.all`. Sem embed pesado (`select("...embed:tabela(*)")`) só pra contar/somar.
- **Ortografia pt-BR em toda string visível ao usuário** — com acentos, cedilha e til. Sem `Voce`, `Nao`, `Descricao`, `Acao`, `E obrigatorio`. Vale pra labels, placeholders, botões, títulos, mensagens de erro/toast, tooltips.
- **RLS ≠ GRANT.** Coluna nova em tabela existente herda GRANT automático; sem alteração necessária.
- **Toda tabela operacional tem `tenant_id`** com RLS via `is_tenant_member(tenant_id)`. Policies existentes cobrem as colunas novas.
- **Server action pattern:** `requireSession()` → parse Zod → verificar `tenant_id` → executar → `revalidatePath`. (Auditoria dispensada pra mensagens de chat — mesma decisão do chat de Comunicação.)
- **Radix `<SelectItem>` NUNCA aceita `value=""`.** Não aplicável aqui (sem Select).
- **`<DrawerContent>` não aceita prop `title`** — composition com `<DialogHeader><DialogTitle>` obrigatoriamente. Um `<DialogTitle>` é obrigatório por acessibilidade Radix (pode ser `sr-only` se não quiser mostrar).
- **Cores da identidade California:** vermelho `#E74B56` via `text-california-red` / `bg-california-red`, fundo thread `#FAFAFA`, texto principal `#282828`.
- **Antes de commit:** `npx tsc --noEmit && npx next lint` — exit 0 obrigatório.
- **Convenção de commit:** `feat(chat-pps): ...`, `refactor(chat): ...`, `fix(chat-pps): ...`.

---

## Estrutura de arquivos

### Migration

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260810000001_chat_escopo.sql` | Enum `chat_escopo` + coluna `escopo` em `jobs_mensagens` e `jobs_chat_leituras` + reescrever PK de `jobs_chat_leituras` + índice composto |

### Types

| Arquivo | Ação |
|---|---|
| [lib/types.ts](lib/types.ts) | Modificar — estender union `icone` do `ItemChat` sistema com 4 novos valores; adicionar tipo `ChatEscopo` e atualizar `JobMensagem` com `escopo` |

### Server (data + actions)

| Arquivo | Ação |
|---|---|
| `lib/data/job-chat-pps.ts` | **Criar** — função `montarThreadChatPPs(pps, mensagens, moedaCode)` |
| `app/(app)/jobs/[jobId]/pps/actions-chat.ts` | **Criar** — `enviarMensagemPP`, `marcarChatPPsLido` |

### Componentes compartilhados

| Arquivo | Ação |
|---|---|
| `components/chat/icone-map.ts` | **Criar** — mapa `icone → LucideIcon` centralizado |
| `components/chat/balao-pessoa.tsx` | **Criar** — extraído de `job-chat-section.tsx` |
| `components/chat/chat-input.tsx` | **Criar** — extraído de `job-chat-section.tsx` (textarea + botão + badge "Enviando como…") |
| [app/(app)/jobs/[jobId]/comunicacao/job-chat-section.tsx](app/(app)/jobs/[jobId]/comunicacao/job-chat-section.tsx) | Modificar — usar as primitivas extraídas (sem mudança de comportamento) |

### Cliente novo

| Arquivo | Ação |
|---|---|
| `app/(app)/jobs/[jobId]/pps/job-pps-chat-section.tsx` | **Criar** — thread + input dentro do drawer |
| `app/(app)/jobs/[jobId]/pps/job-pps-chat-fab.tsx` | **Criar** — botão flutuante + Dialog/DrawerContent + assinatura realtime pro badge |

### Wire-up

| Arquivo | Ação |
|---|---|
| [app/(app)/jobs/[jobId]/job-tabs.tsx](app/(app)/jobs/[jobId]/job-tabs.tsx) | Modificar — adicionar prop `ppsChat` renderizada como `{tab === "pps" && ppsChat}` |
| [app/(app)/jobs/[jobId]/page.tsx](app/(app)/jobs/[jobId]/page.tsx) | Modificar — adicionar 2 queries ao `Promise.all` (mensagens escopo='pps', leitura escopo='pps'), montar thread, calcular não-lidas, passar novo `ppsChat` |

---

## Task 1 — Migration `chat_escopo` + tipos

**Files:**
- Create: `supabase/migrations/20260810000001_chat_escopo.sql`
- Modify: `lib/types.ts`

**Interfaces:**
- Consumes: tabelas `public.jobs_mensagens` e `public.jobs_chat_leituras` (existentes), tipo `chat_area` (existente).
- Produces:
  - Enum SQL `public.chat_escopo` = `geral | pps`.
  - Coluna `escopo chat_escopo not null default 'geral'` em `jobs_mensagens`.
  - Coluna `escopo chat_escopo not null default 'geral'` em `jobs_chat_leituras`, com PK reescrita `(job_id, profile_id, escopo)`.
  - Índice `idx_jobs_msg_job_escopo` em `(job_id, escopo, created_at)`.
  - TS: `type ChatEscopo = "geral" | "pps"`.
  - TS: `JobMensagem` ganha campo `escopo: ChatEscopo`.
  - TS: union `icone` do `ItemChat` sistema estendida com `"file-text" | "check-circle" | "x-circle" | "ban"`.

---

- [ ] **Step 1: Criar arquivo de migration**

Arquivo `supabase/migrations/20260810000001_chat_escopo.sql`:

```sql
-- =====================================================================
-- Chat de PPs no job: adiciona escopo pra separar a thread de PPs da
-- thread geral (Comunicação). Reusa jobs_mensagens e jobs_chat_leituras
-- em vez de tabelas paralelas — infra idêntica (RLS, realtime, policies).
--
-- Ver spec: docs/superpowers/specs/2026-08-10-chat-pps-no-job-design.md
-- =====================================================================

do $$ begin
  create type chat_escopo as enum ('geral', 'pps');
exception when duplicate_object then null;
end $$;

-- jobs_mensagens: cada mensagem pertence a um escopo. Default 'geral'
-- mantém o chat de Comunicação existente funcionando sem backfill.
alter table public.jobs_mensagens
  add column if not exists escopo chat_escopo not null default 'geral';

-- Índice composto: as duas queries de leitura são "todas as mensagens
-- desse job nesse escopo, em ordem". Pega os dois filtros e a ordenação.
create index if not exists idx_jobs_msg_job_escopo
  on public.jobs_mensagens(job_id, escopo, created_at);

-- jobs_chat_leituras: cada pessoa tem uma leitura por escopo por job.
-- PK muda pra (job_id, profile_id, escopo). Registros existentes viram
-- 'geral' pelo default, o que preserva a semântica atual do chat de
-- Comunicação (que ficou como 'geral').
alter table public.jobs_chat_leituras
  add column if not exists escopo chat_escopo not null default 'geral';

do $$ begin
  alter table public.jobs_chat_leituras
    drop constraint jobs_chat_leituras_pkey;
exception when undefined_object then null;
end $$;

do $$ begin
  alter table public.jobs_chat_leituras
    add constraint jobs_chat_leituras_pkey
    primary key (job_id, profile_id, escopo);
exception when duplicate_table then null;
end $$;
```

- [ ] **Step 2: Aplicar migration ao Supabase**

Rodar via MCP `mcp__supabase-write__apply_migration` com o conteúdo acima. Verificar com `mcp__supabase-write__list_migrations` que a migração aparece.

- [ ] **Step 3: Verificar schema pós-migration**

Rodar via `mcp__supabase-write__execute_sql`:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('jobs_mensagens', 'jobs_chat_leituras')
  and column_name = 'escopo';
```

Esperado: 2 linhas, ambas com default `'geral'::chat_escopo` e `is_nullable = 'NO'`.

Também:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.jobs_chat_leituras'::regclass
  and contype = 'p';
```

Esperado: PK inclui `(job_id, profile_id, escopo)`.

- [ ] **Step 4: Atualizar `lib/types.ts`**

Adicionar tipo `ChatEscopo` logo depois do `ChatArea` (por volta da linha 806), atualizar `JobMensagem` e estender a união `icone`:

```typescript
// Depois de: export type ChatArea = "producao" | "financeiro";
export type ChatEscopo = "geral" | "pps";

// Atualizar JobMensagem existente (por volta da linha 826):
export interface JobMensagem {
  id: string;
  tenant_id: string;
  job_id: string;
  autor_id: string;
  area: ChatArea;
  escopo: ChatEscopo;
  texto: string;
  created_at: string;
}

// Atualizar a união ItemChat sistema (por volta da linha 853):
export type ItemChat =
  | {
      tipo: "sistema";
      id: string;
      icone:
        | "folder-open"
        | "file-pen-line"
        | "tags"
        | "file-text"
        | "check-circle"
        | "x-circle"
        | "ban";
      cor: "azul" | "verde" | "bege" | "vermelho";
      titulo: string;
      quando: string;
      resumo: string;
      valor: string | null;
      valorTom: Exclude<ChatTom, "texto">;
      linhas: ChatLinha[];
      em: string;
    }
  | {
      tipo: "pessoa";
      id: string;
      autor: string;
      area: ChatArea;
      quando: string;
      texto: string;
      em: string;
    };
```

- [ ] **Step 5: Verificar tsc**

```bash
npx tsc --noEmit
```

Esperado: exit 0. A ampliação da união `icone` é aditiva — nenhum consumidor existente quebra.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260810000001_chat_escopo.sql lib/types.ts
git commit -m "feat(chat-pps): migration chat_escopo + tipos"
```

---

## Task 2 — Server: `montarThreadChatPPs`

**Files:**
- Create: `lib/data/job-chat-pps.ts`

**Interfaces:**
- Consumes:
  - `PedidoCompraNaLista` (existente em [lib/types.ts](lib/types.ts:875)) — tem `codigo`, `servico`, `fornecedor_id`, `status`, `valor`, `created_at`, `updated_at`, `prazo_pagamento`, `emitida_por_nome`.
  - `JobMensagem & { autor_nome: string | null }` (mesmo shape usado pela `montarThreadChat`).
  - `ItemChat` (agora com ícones novos, Task 1).
- Produces:
  - Função exportada `montarThreadChatPPs(pps, mensagens, moedaCode, fornecedoresPorId) → ItemChat[]`.
  - Assinatura exata:
    ```ts
    export function montarThreadChatPPs(
      pps: PedidoCompraNaLista[],
      mensagens: Array<JobMensagem & { autor_nome: string | null }>,
      moedaCode: string,
      fornecedoresPorId: Record<string, string>,
    ): ItemChat[];
    ```

---

- [ ] **Step 1: Criar `lib/data/job-chat-pps.ts`**

```typescript
import type {
  ItemChat,
  JobMensagem,
  PedidoCompraNaLista,
} from "@/lib/types";

/**
 * Monta a thread do chat de PPs de um job.
 *
 * Só as mensagens humanas vêm de `jobs_mensagens` (escopo='pps'). Os cards
 * automáticos ("PP emitida", "PP paga", "PP rejeitada", "PP cancelada")
 * são derivados de `pedidos_compra` — nada duplicado, nunca divergem da
 * fonte, aparecem retroativamente sem backfill.
 *
 * Limitação: sem histórico de transições, uma PP no estado terminal
 * ("pago"/"rejeitada"/"cancelada") só rende UM card do estado atual, no
 * timestamp `updated_at`. No MVP essas transições não voltam atrás.
 */

function dataHora(iso: string): string {
  const d = new Date(iso);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const hora = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes}/${d.getFullYear()} ${hora}:${min}`;
}

function dataHoraCurta(iso: string): string {
  const d = new Date(iso);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const hora = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes} ${hora}:${min}`;
}

function moeda(v: number, moedaCode: string): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: moedaCode });
}

function prazoEmDias(createdAt: string, prazoPagamento: string): string {
  const emissao = new Date(createdAt.slice(0, 10));
  const vencimento = new Date(prazoPagamento.slice(0, 10));
  const dias = Math.round(
    (vencimento.getTime() - emissao.getTime()) / 86_400_000,
  );
  if (!Number.isFinite(dias)) return "—";
  return `${dias} ${dias === 1 ? "dia" : "dias"}`;
}

export function montarThreadChatPPs(
  pps: PedidoCompraNaLista[],
  mensagens: Array<JobMensagem & { autor_nome: string | null }>,
  moedaCode: string,
  fornecedoresPorId: Record<string, string>,
): ItemChat[] {
  const itens: ItemChat[] = [];

  // ---- Um card por PP: "emitida" sempre; se estado terminal, o card
  // corresponde ao ESTADO ATUAL (pago/rejeitada/cancelada) e sobe pra
  // updated_at. Uma PP que ainda está "em_avaliacao" só gera o card de
  // emissão.
  for (const pp of pps) {
    const fornecedorNome =
      fornecedoresPorId[pp.fornecedor_id] ?? "Fornecedor";
    const valorFmt = moeda(Number(pp.valor ?? 0), moedaCode);

    // Card de emissão (sempre existe)
    itens.push({
      tipo: "sistema",
      id: `pp-emitida-${pp.id}`,
      icone: "file-text",
      cor: "azul",
      titulo: "PP emitida",
      quando: dataHora(pp.created_at),
      resumo: `${pp.codigo} · ${pp.servico} · ${fornecedorNome}`,
      valor: valorFmt,
      valorTom: "neutro",
      linhas: [
        {
          texto: "Prazo de pagamento",
          valor: prazoEmDias(pp.created_at, pp.prazo_pagamento),
          tom: "texto",
        },
        ...(pp.emitida_por_nome
          ? ([
              {
                texto: "Emitida por",
                valor: pp.emitida_por_nome,
                tom: "texto",
              },
            ] as const)
          : []),
      ],
      em: pp.created_at,
    });

    // Card de estado terminal (se houver)
    if (pp.status === "pago") {
      itens.push({
        tipo: "sistema",
        id: `pp-paga-${pp.id}`,
        icone: "check-circle",
        cor: "verde",
        titulo: "PP paga",
        quando: dataHora(pp.updated_at),
        resumo: `${pp.codigo} · ${fornecedorNome}`,
        valor: valorFmt,
        valorTom: "positivo",
        linhas: [],
        em: pp.updated_at,
      });
    } else if (pp.status === "rejeitada") {
      itens.push({
        tipo: "sistema",
        id: `pp-rejeitada-${pp.id}`,
        icone: "x-circle",
        cor: "vermelho",
        titulo: "PP rejeitada",
        quando: dataHora(pp.updated_at),
        resumo: `${pp.codigo} · ${fornecedorNome}`,
        valor: valorFmt,
        valorTom: "negativo",
        linhas: [],
        em: pp.updated_at,
      });
    } else if (pp.status === "cancelada") {
      itens.push({
        tipo: "sistema",
        id: `pp-cancelada-${pp.id}`,
        icone: "ban",
        cor: "bege",
        titulo: "PP cancelada",
        quando: dataHora(pp.updated_at),
        resumo: `${pp.codigo} · ${fornecedorNome}`,
        valor: valorFmt,
        valorTom: "neutro",
        linhas: [],
        em: pp.updated_at,
      });
    }
  }

  // ---- Mensagens humanas
  for (const m of mensagens) {
    itens.push({
      tipo: "pessoa",
      id: m.id,
      autor: m.autor_nome ?? "—",
      area: m.area,
      quando: dataHoraCurta(m.created_at),
      texto: m.texto,
      em: m.created_at,
    });
  }

  return itens.sort((a, b) => a.em.localeCompare(b.em));
}
```

- [ ] **Step 2: Verificar tsc**

```bash
npx tsc --noEmit
```

Esperado: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/data/job-chat-pps.ts
git commit -m "feat(chat-pps): montarThreadChatPPs mistura eventos de PP com mensagens"
```

---

## Task 3 — Server actions do chat de PPs

**Files:**
- Create: `app/(app)/jobs/[jobId]/pps/actions-chat.ts`

**Interfaces:**
- Consumes:
  - `requireSession` de `@/lib/auth/session`.
  - `createClient` de `@/lib/supabase/server`.
  - `areaDoPapel` de `@/lib/types` — deriva área do papel logado.
- Produces:
  - `enviarMensagemPP(jobId: string, texto: string) → Promise<{ok: true} | {ok: false; message: string}>`.
  - `marcarChatPPsLido(jobId: string) → Promise<{ok: true} | {ok: false; message: string}>`.

---

- [ ] **Step 1: Criar `app/(app)/jobs/[jobId]/pps/actions-chat.ts`**

```typescript
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { areaDoPapel } from "@/lib/types";

type Ok = { ok: true };
type Err = { ok: false; message: string };
type Result = Ok | Err;

const textoSchema = z
  .string()
  .trim()
  .min(1, "Escreva alguma coisa antes de enviar.")
  .max(2000, "Mensagem passa de 2000 caracteres.");

/**
 * Envia mensagem no chat de PPs do job. Escopo fixo em 'pps' — o chat de
 * Comunicação tem sua própria action, não parametrizei pra manter cada
 * uma óbvia sem argumento extra.
 */
export async function enviarMensagemPP(
  jobId: string,
  texto: string,
): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();

  const parsed = textoSchema.safeParse(texto);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Mensagem inválida.",
    };
  }

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (jobErr || !job) return { ok: false, message: "Job não encontrado." };

  const { error } = await supabase.from("jobs_mensagens").insert({
    tenant_id: session.activeTenant.id,
    job_id: jobId,
    autor_id: session.profile.id,
    area: areaDoPapel(session.activeRole),
    escopo: "pps",
    texto: parsed.data,
  });

  if (error) {
    console.error("[chat-pps.enviar]", error.message);
    return { ok: false, message: "Falha ao enviar a mensagem." };
  }

  // Quem escreveu obviamente leu tudo até aqui.
  await marcarChatPPsLido(jobId);

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Zera o contador de não lidas de PPs deste usuário neste job. */
export async function marcarChatPPsLido(jobId: string): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase.from("jobs_chat_leituras").upsert(
    {
      tenant_id: session.activeTenant.id,
      job_id: jobId,
      profile_id: session.profile.id,
      escopo: "pps",
      lida_ate: new Date().toISOString(),
    },
    { onConflict: "job_id,profile_id,escopo" },
  );

  if (error) {
    console.error("[chat-pps.marcar_lido]", error.message);
    return { ok: false, message: "Falha ao marcar como lido." };
  }

  return { ok: true };
}
```

- [ ] **Step 2: Verificar tsc**

```bash
npx tsc --noEmit
```

Esperado: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/jobs/\[jobId\]/pps/actions-chat.ts
git commit -m "feat(chat-pps): server actions enviarMensagemPP + marcarChatPPsLido"
```

---

## Task 4 — Extrair primitivas de chat + criar `JobPPsChatSection`

Extrai `BalaoPessoa`, o input area, e o mapa de ícones do [job-chat-section.tsx](app/(app)/jobs/[jobId]/comunicacao/job-chat-section.tsx) pra `components/chat/`, e cria a section nova pro chat de PPs consumindo essas primitivas. O componente antigo passa a importar as primitivas (refactor sem mudança de comportamento).

**Files:**
- Create: `components/chat/icone-map.ts`
- Create: `components/chat/balao-pessoa.tsx`
- Create: `components/chat/chat-input.tsx`
- Modify: `app/(app)/jobs/[jobId]/comunicacao/job-chat-section.tsx`
- Create: `app/(app)/jobs/[jobId]/pps/job-pps-chat-section.tsx`

**Interfaces:**
- Consumes:
  - `ItemChat`, `ChatArea`, `chatAreaLabel` de `@/lib/types`.
  - `enviarMensagemPP` e `marcarChatPPsLido` de `./actions-chat` (Task 3).
  - `createClient` de `@/lib/supabase/client`.
- Produces:
  - `ICONE_COMPONENTE` (mapa `Record<icone, LucideIcon>`) em `components/chat/icone-map.ts`.
  - `<BalaoPessoa item={...} />` em `components/chat/balao-pessoa.tsx`.
  - `<ChatInput minhaArea, onEnviar, pending, erro, onLimparErro, placeholder />` em `components/chat/chat-input.tsx`.
  - `<JobPPsChatSection jobId, jobCodigo, itens, minhaArea, onLidoInicial />` em `app/(app)/jobs/[jobId]/pps/job-pps-chat-section.tsx`. Sem badge interno — o badge fica no FAB. Callback `onLidoInicial()` roda quando a section marca como lido na primeira vez.

---

- [ ] **Step 1: Criar `components/chat/icone-map.ts`**

```typescript
import {
  Ban,
  CheckCircle2,
  FilePenLine,
  FileText,
  FolderOpen,
  Tags,
  XCircle,
  type LucideIcon,
} from "lucide-react";

/**
 * Mapa único de nomes de ícone → componente Lucide, compartilhado pelo
 * chat de Comunicação e pelo chat de PPs. Centralizar aqui evita ter
 * duas versões desse mapa sincronizadas na mão.
 *
 * Nomes ficam em kebab-case pra bater com a união do tipo ItemChat.
 */
export const ICONE_COMPONENTE: Record<string, LucideIcon> = {
  "folder-open": FolderOpen,
  "file-pen-line": FilePenLine,
  tags: Tags,
  "file-text": FileText,
  "check-circle": CheckCircle2,
  "x-circle": XCircle,
  ban: Ban,
};

export const ICONE_CORES = {
  azul: "bg-blue-50 text-blue-700",
  verde: "bg-emerald-50 text-emerald-700",
  bege: "bg-[#f1f0ec] text-foreground",
  vermelho: "bg-red-50 text-red-700",
} as const;

export const PILL_CORES = {
  positivo: "border-emerald-200 bg-emerald-50 text-emerald-700",
  negativo: "border-red-200 bg-red-50 text-red-700",
  neutro: "border-border bg-muted text-foreground",
} as const;
```

- [ ] **Step 2: Criar `components/chat/balao-pessoa.tsx`**

```typescript
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { chatAreaLabel, type ItemChat } from "@/lib/types";

function iniciais(nome: string): string {
  return nome
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Balão de mensagem humana. Produção fica à direita, Financeiro à
 * esquerda — fixo por área pra thread ficar igual pros dois times.
 */
export function BalaoPessoa({
  item,
}: {
  item: Extract<ItemChat, { tipo: "pessoa" }>;
}) {
  const direita = item.area === "producao";
  return (
    <div
      className={cn(
        "flex flex-none items-start gap-[9px]",
        direita && "flex-row-reverse",
      )}
    >
      <div
        className={cn(
          "inline-flex h-7 w-7 flex-none items-center justify-center rounded-full text-[10.5px] font-bold text-white",
          direita ? "bg-california-red" : "bg-[#1e4fa3]",
        )}
      >
        {iniciais(item.autor)}
      </div>
      <div className="min-w-0 max-w-[80%]">
        <div
          className={cn(
            "mb-1 flex items-baseline gap-[7px]",
            direita && "flex-row-reverse",
          )}
        >
          <span className="text-[11.5px] font-semibold">{item.autor}</span>
          <span className="text-[10.5px] text-muted-foreground">
            {chatAreaLabel(item.area)} · {item.quando}
          </span>
        </div>
        <div
          className={cn(
            "rounded-xl border px-3 py-2.5 text-[12.5px] leading-[1.5]",
            direita
              ? "border-[#f3ced1] bg-[#fef5f5]"
              : "border-border bg-white",
          )}
        >
          {item.texto}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Criar `components/chat/chat-input.tsx`**

```typescript
"use client";

import * as React from "react";
import { ArrowUp, Paperclip, X } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { chatAreaLabel, type ChatArea } from "@/lib/types";

interface Props {
  minhaArea: ChatArea;
  pending: boolean;
  erro: string | null;
  onLimparErro: () => void;
  onEnviar: (texto: string) => void;
  placeholder?: string;
}

/**
 * Input padrão dos chats do job: textarea + badge "Enviando como…" +
 * botão de anexo (disabled) + botão de enviar. Cmd/Ctrl+Enter envia.
 * Compartilhado entre chat de Comunicação e chat de PPs.
 */
export function ChatInput({
  minhaArea,
  pending,
  erro,
  onLimparErro,
  onEnviar,
  placeholder = "Escreva para o outro time…",
}: Props) {
  const [texto, setTexto] = React.useState("");

  function handleEnviar() {
    const t = texto.trim();
    if (!t) return;
    onEnviar(t);
    setTexto("");
  }

  return (
    <div className="flex flex-none flex-col gap-2.5 border-t border-border bg-white px-3.5 py-3">
      {erro && (
        <div className="flex items-center justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 px-2.5 py-1.5 text-xs text-california-red">
          <span>{erro}</span>
          <button type="button" onClick={onLimparErro}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10.5px] text-muted-foreground">
          Enviando como
        </span>
        <span className="inline-flex items-center rounded-full border border-foreground bg-foreground px-2.5 py-1 text-[10.5px] font-semibold text-white">
          {chatAreaLabel(minhaArea)}
        </span>
      </div>

      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleEnviar();
            }
          }}
          maxLength={2000}
          placeholder={placeholder}
          className="flex-1 resize-none rounded-[10px] border border-border bg-white px-[11px] py-[9px] text-[12.5px] leading-[1.45] outline-none focus:border-california-red/40"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <button
                type="button"
                disabled
                className="inline-flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-[10px] border border-border bg-white text-muted-foreground opacity-50"
              >
                <Paperclip className="h-[15px] w-[15px]" />
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Em breve — anexos no chat</TooltipContent>
        </Tooltip>
        <button
          type="button"
          onClick={handleEnviar}
          disabled={pending || texto.trim().length === 0}
          className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-california-red text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          title="Enviar (Cmd+Enter)"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Refatorar `app/(app)/jobs/[jobId]/comunicacao/job-chat-section.tsx`**

Substituir os blocos internos (mapa de ícones, `BalaoPessoa`, input) por imports. Preservar todo o resto: cabeçalho, badge de não lidas, thread com CardSistema, efeitos de mark-as-read, realtime.

Arquivo final:

```typescript
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useIrParaAbaInformacoes } from "../job-tabs";
import type { ChatTom, ItemChat, ChatArea } from "@/lib/types";
import { enviarMensagem, marcarChatLido } from "./actions";
import {
  ICONE_COMPONENTE,
  ICONE_CORES,
  PILL_CORES,
} from "@/components/chat/icone-map";
import { BalaoPessoa } from "@/components/chat/balao-pessoa";
import { ChatInput } from "@/components/chat/chat-input";

interface Props {
  jobId: string;
  jobCodigo: string;
  itens: ItemChat[];
  naoLidas: number;
  /** Área de quem está logado — vem do papel, não é escolhida. */
  minhaArea: ChatArea;
}

function classeValor(tom: ChatTom): string {
  switch (tom) {
    case "positivo":
      return "font-mono text-[11.5px] font-bold text-emerald-700";
    case "negativo":
      return "font-mono text-[11.5px] font-bold text-red-700";
    case "neutro":
      return "font-mono text-[11.5px] font-semibold text-foreground";
    case "texto":
      return "text-[11.5px] font-semibold text-foreground";
  }
}

export function JobChatSection({
  jobId,
  jobCodigo,
  itens,
  naoLidas,
  minhaArea,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [abertas, setAbertas] = React.useState<Record<string, boolean>>({});
  const [badge, setBadge] = React.useState(naoLidas);
  const fimRef = React.useRef<HTMLDivElement>(null);
  const marcouRef = React.useRef(false);

  React.useEffect(() => {
    const ultimaErrata = [...itens]
      .reverse()
      .find((i) => i.tipo === "sistema" && i.id !== "abertura");
    setAbertas(ultimaErrata ? { [ultimaErrata.id]: true } : {});
  }, [itens]);

  React.useEffect(() => {
    if (marcouRef.current || naoLidas === 0) return;
    marcouRef.current = true;
    marcarChatLido(jobId).then(() => setBadge(0));
  }, [jobId, naoLidas]);

  React.useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [itens.length]);

  React.useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel(`chat-job-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "jobs_mensagens",
          filter: `job_id=eq.${jobId}`,
        },
        async (payload: any) => {
          // Só o chat geral: escopo 'pps' é outro canal semântico.
          if (payload?.new?.escopo && payload.new.escopo !== "geral") return;
          await marcarChatLido(jobId);
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [jobId, router]);

  function handleEnviar(texto: string) {
    setErro(null);
    startTransition(async () => {
      const res = await enviarMensagem(jobId, texto);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex h-[620px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex flex-none items-center gap-2.5 border-b border-border bg-white px-[18px] py-4">
        <MessagesSquare className="h-[17px] w-[17px] text-california-red" />
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em]">
            Comunicação
          </h2>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Produção ↔ Financeiro · {jobCodigo}
          </p>
        </div>
        {badge > 0 && (
          <span className="ml-auto inline-flex items-center whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[10.5px] font-semibold text-red-700">
            {badge} {badge === 1 ? "não lida" : "não lidas"}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-[#FAFAFA] p-[18px]">
        {itens.map((item) =>
          item.tipo === "sistema" ? (
            <CardSistema
              key={item.id}
              item={item}
              aberto={!!abertas[item.id]}
              onAlternar={() =>
                setAbertas((p) => ({ ...p, [item.id]: !p[item.id] }))
              }
            />
          ) : (
            <BalaoPessoa key={item.id} item={item} />
          ),
        )}
        <div ref={fimRef} />
      </div>

      <ChatInput
        minhaArea={minhaArea}
        pending={pending}
        erro={erro}
        onLimparErro={() => setErro(null)}
        onEnviar={handleEnviar}
      />
    </div>
  );
}

function CardSistema({
  item,
  aberto,
  onAlternar,
}: {
  item: Extract<ItemChat, { tipo: "sistema" }>;
  aberto: boolean;
  onAlternar: () => void;
}) {
  const Icone = ICONE_COMPONENTE[item.icone];
  const irParaInformacoes = useIrParaAbaInformacoes();
  return (
    <div className="flex-none overflow-hidden rounded-xl border border-[#e4e2dd] bg-white">
      <button
        type="button"
        onClick={onAlternar}
        className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-california-red/[0.02]"
      >
        <span
          className={cn(
            "inline-flex h-6 w-6 flex-none items-center justify-center rounded-[7px]",
            ICONE_CORES[item.cor],
          )}
        >
          <Icone className="h-[13px] w-[13px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[12.5px] font-semibold">{item.titulo}</span>
            <span className="text-[10.5px] text-muted-foreground">
              Automático · {item.quando}
            </span>
          </div>
          <p className="mt-1 text-xs leading-[1.45] text-muted-foreground">
            {item.resumo}
          </p>
        </div>
        {item.valor && (
          <span
            className={cn(
              "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold",
              PILL_CORES[item.valorTom],
            )}
          >
            {item.valor}
          </span>
        )}
        <ChevronRight
          className={cn(
            "h-[15px] w-[15px] flex-none text-[#c9c9c9] transition-transform",
            aberto && "rotate-90",
          )}
        />
      </button>

      {aberto && item.linhas.length > 0 && (
        <div className="flex flex-col gap-[9px] border-t border-border bg-[#f5f5f5]/50 px-3.5 py-3">
          {item.linhas.map((l, i) => (
            <div
              key={i}
              className="flex items-baseline gap-2 text-[11.5px] leading-[1.45]"
            >
              <span className="text-[#c9c9c9]">•</span>
              <span className="flex-1">{l.texto}</span>
              <span className={cn("whitespace-nowrap", classeValor(l.tom))}>
                {l.valor}
              </span>
            </div>
          ))}
          {irParaInformacoes && (
            <button
              type="button"
              onClick={irParaInformacoes}
              className="self-start text-[11.5px] text-california-red hover:underline"
            >
              Abrir na aba Informações →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Criar `app/(app)/jobs/[jobId]/pps/job-pps-chat-section.tsx`**

A section renderiza dentro do drawer. **Não tem cabeçalho próprio** — o header do drawer já mostra título. **Não tem badge próprio** — o badge fica no FAB. Reaproveita `CardSistema` da forma mais simples: cópia local dele, já que ele é curto e a section do chat geral também tem uma cópia (extrair pra terceiro arquivo compartilhado é overkill enquanto os dois usarem cores/tons idênticos).

```typescript
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ChatArea, ChatTom, ItemChat } from "@/lib/types";
import { enviarMensagemPP, marcarChatPPsLido } from "./actions-chat";
import {
  ICONE_COMPONENTE,
  ICONE_CORES,
  PILL_CORES,
} from "@/components/chat/icone-map";
import { BalaoPessoa } from "@/components/chat/balao-pessoa";
import { ChatInput } from "@/components/chat/chat-input";

interface Props {
  jobId: string;
  itens: ItemChat[];
  minhaArea: ChatArea;
  /** Chamado uma vez, quando a section marca a thread como lida pela
   * primeira vez após aberta. O FAB usa isso pra zerar o badge local. */
  onLidoInicial: () => void;
}

function classeValor(tom: ChatTom): string {
  switch (tom) {
    case "positivo":
      return "font-mono text-[11.5px] font-bold text-emerald-700";
    case "negativo":
      return "font-mono text-[11.5px] font-bold text-red-700";
    case "neutro":
      return "font-mono text-[11.5px] font-semibold text-foreground";
    case "texto":
      return "text-[11.5px] font-semibold text-foreground";
  }
}

export function JobPPsChatSection({
  jobId,
  itens,
  minhaArea,
  onLidoInicial,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [abertas, setAbertas] = React.useState<Record<string, boolean>>({});
  const fimRef = React.useRef<HTMLDivElement>(null);
  const marcouRef = React.useRef(false);

  // Cards ficam fechados por default. Se o usuário quiser ver detalhes,
  // clica. Diferente do chat de Comunicação (que abre a última errata) —
  // aqui podem existir muitos cards de PP e abrir todos ocupa a thread.

  React.useEffect(() => {
    if (marcouRef.current) return;
    marcouRef.current = true;
    marcarChatPPsLido(jobId).then(() => onLidoInicial());
  }, [jobId, onLidoInicial]);

  React.useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [itens.length]);

  // Realtime pra thread aberta: chega mensagem nova de PP, refaz a
  // thread e marca como lida (o usuário está com o drawer aberto).
  React.useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel(`chat-pps-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "jobs_mensagens",
          filter: `job_id=eq.${jobId}`,
        },
        async (payload: any) => {
          if (payload?.new?.escopo !== "pps") return;
          await marcarChatPPsLido(jobId);
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [jobId, router]);

  function handleEnviar(texto: string) {
    setErro(null);
    startTransition(async () => {
      const res = await enviarMensagemPP(jobId, texto);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-[#FAFAFA] p-[18px]">
        {itens.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="max-w-[240px] text-center text-xs text-muted-foreground">
              Nenhuma PP nem mensagem por aqui ainda. Assim que uma PP for
              emitida ou alguém escrever, aparece na thread.
            </p>
          </div>
        )}
        {itens.map((item) =>
          item.tipo === "sistema" ? (
            <CardSistema
              key={item.id}
              item={item}
              aberto={!!abertas[item.id]}
              onAlternar={() =>
                setAbertas((p) => ({ ...p, [item.id]: !p[item.id] }))
              }
            />
          ) : (
            <BalaoPessoa key={item.id} item={item} />
          ),
        )}
        <div ref={fimRef} />
      </div>

      <ChatInput
        minhaArea={minhaArea}
        pending={pending}
        erro={erro}
        onLimparErro={() => setErro(null)}
        onEnviar={handleEnviar}
        placeholder="Escreva sobre uma PP…"
      />
    </div>
  );
}

function CardSistema({
  item,
  aberto,
  onAlternar,
}: {
  item: Extract<ItemChat, { tipo: "sistema" }>;
  aberto: boolean;
  onAlternar: () => void;
}) {
  const Icone = ICONE_COMPONENTE[item.icone];
  return (
    <div className="flex-none overflow-hidden rounded-xl border border-[#e4e2dd] bg-white">
      <button
        type="button"
        onClick={onAlternar}
        className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-california-red/[0.02]"
      >
        <span
          className={cn(
            "inline-flex h-6 w-6 flex-none items-center justify-center rounded-[7px]",
            ICONE_CORES[item.cor],
          )}
        >
          <Icone className="h-[13px] w-[13px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[12.5px] font-semibold">{item.titulo}</span>
            <span className="text-[10.5px] text-muted-foreground">
              Automático · {item.quando}
            </span>
          </div>
          <p className="mt-1 text-xs leading-[1.45] text-muted-foreground">
            {item.resumo}
          </p>
        </div>
        {item.valor && (
          <span
            className={cn(
              "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold",
              PILL_CORES[item.valorTom],
            )}
          >
            {item.valor}
          </span>
        )}
        <ChevronRight
          className={cn(
            "h-[15px] w-[15px] flex-none text-[#c9c9c9] transition-transform",
            aberto && "rotate-90",
          )}
        />
      </button>

      {aberto && item.linhas.length > 0 && (
        <div className="flex flex-col gap-[9px] border-t border-border bg-[#f5f5f5]/50 px-3.5 py-3">
          {item.linhas.map((l, i) => (
            <div
              key={i}
              className="flex items-baseline gap-2 text-[11.5px] leading-[1.45]"
            >
              <span className="text-[#c9c9c9]">•</span>
              <span className="flex-1">{l.texto}</span>
              <span className={cn("whitespace-nowrap", classeValor(l.tom))}>
                {l.valor}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verificar tsc + lint**

```bash
npx tsc --noEmit && npx next lint
```

Esperado: exit 0.

- [ ] **Step 7: Verificar manualmente que o chat de Comunicação continua funcionando**

Abrir job existente, tab "Comunicação". Enviar mensagem, verificar realtime, verificar badge, verificar cards de errata. Tudo deve estar idêntico a antes — mudou só a organização de arquivos.

- [ ] **Step 8: Commit**

```bash
git add components/chat/ app/\(app\)/jobs/\[jobId\]/comunicacao/job-chat-section.tsx app/\(app\)/jobs/\[jobId\]/pps/job-pps-chat-section.tsx
git commit -m "refactor(chat): extrai BalaoPessoa/ChatInput/icone-map; cria JobPPsChatSection"
```

---

## Task 5 — FAB flutuante + Drawer

**Files:**
- Create: `app/(app)/jobs/[jobId]/pps/job-pps-chat-fab.tsx`

**Interfaces:**
- Consumes:
  - `Dialog`, `DrawerContent`, `DialogHeader`, `DialogTitle` de `@/components/ui/dialog`.
  - `<JobPPsChatSection>` de `./job-pps-chat-section` (Task 4).
  - `createClient` de `@/lib/supabase/client`.
- Produces:
  - `<JobPPsChatFab jobId, jobCodigo, itens, minhaArea, naoLidasIniciais />` — botão flutuante `fixed bottom-6 right-6`, drawer lateral direito com a section dentro. Realtime pra incrementar badge quando drawer fechado.

---

- [ ] **Step 1: Criar `app/(app)/jobs/[jobId]/pps/job-pps-chat-fab.tsx`**

```typescript
"use client";

import * as React from "react";
import { MessagesSquare } from "lucide-react";
import {
  Dialog,
  DrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import type { ChatArea, ItemChat } from "@/lib/types";
import { JobPPsChatSection } from "./job-pps-chat-section";

interface Props {
  jobId: string;
  jobCodigo: string;
  itens: ItemChat[];
  minhaArea: ChatArea;
  naoLidasIniciais: number;
}

/**
 * Botão flutuante que fica no canto inferior direito enquanto a aba
 * "Pedidos de Produção" está ativa. Abre o chat de PPs num drawer
 * lateral. O badge de não lidas mora aqui — a section não sabe do
 * badge, só marca como lido ao montar.
 *
 * Realtime é assinado enquanto o FAB está montado (i.e. enquanto a
 * aba PPs está ativa): mensagem nova de outro autor incrementa o
 * badge se o drawer estiver fechado; se estiver aberto, a section
 * cuida do refresh + mark-as-read.
 */
export function JobPPsChatFab({
  jobId,
  jobCodigo,
  itens,
  minhaArea,
  naoLidasIniciais,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [badge, setBadge] = React.useState(naoLidasIniciais);
  const abertoRef = React.useRef(false);

  // Mantém a ref sincronizada com o estado — o callback do realtime é
  // criado dentro do useEffect e não vê o `open` atualizado sem isso.
  React.useEffect(() => {
    abertoRef.current = open;
  }, [open]);

  React.useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel(`chat-pps-fab-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "jobs_mensagens",
          filter: `job_id=eq.${jobId}`,
        },
        (payload: any) => {
          if (payload?.new?.escopo !== "pps") return;
          // Se o drawer está aberto, a section já vai marcar como lido.
          // Aqui a gente só incrementa quando ele está fechado.
          if (!abertoRef.current) {
            setBadge((n) => n + 1);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [jobId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir chat de Pedidos de Produção"
        className="fixed bottom-6 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-california-red text-white shadow-elevated transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-california-red/50"
      >
        <MessagesSquare className="h-6 w-6" />
        {badge > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-white bg-foreground px-1 text-[10px] font-bold text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>

      <DrawerContent className="sm:max-w-[420px]">
        {/* DialogTitle é obrigatório pela acessibilidade Radix; fica
            visível como cabeçalho do drawer. */}
        <DialogHeader className="flex-none border-b border-border px-[18px] py-4">
          <div className="flex items-center gap-2.5">
            <MessagesSquare className="h-[17px] w-[17px] text-california-red" />
            <div className="min-w-0">
              <DialogTitle className="text-xs font-semibold uppercase tracking-[0.08em]">
                Chat de PPs
              </DialogTitle>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Produção ↔ Financeiro · {jobCodigo}
              </p>
            </div>
          </div>
        </DialogHeader>

        {open && (
          <JobPPsChatSection
            jobId={jobId}
            itens={itens}
            minhaArea={minhaArea}
            onLidoInicial={() => setBadge(0)}
          />
        )}
      </DrawerContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificar tsc + lint**

```bash
npx tsc --noEmit && npx next lint
```

Esperado: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/jobs/\[jobId\]/pps/job-pps-chat-fab.tsx
git commit -m "feat(chat-pps): FAB flutuante com drawer lateral e badge realtime"
```

---

## Task 6 — Wire-up em JobTabs e page.tsx

**Files:**
- Modify: `app/(app)/jobs/[jobId]/job-tabs.tsx`
- Modify: `app/(app)/jobs/[jobId]/page.tsx`

**Interfaces:**
- Consumes:
  - `<JobPPsChatFab>` (Task 5).
  - `montarThreadChatPPs` (Task 2).
- Produces: página final com FAB do chat de PPs aparecendo apenas quando a aba "Pedidos de Produção" está ativa.

---

- [ ] **Step 1: Adicionar prop `ppsChat` em `JobTabs`**

Editar [app/(app)/jobs/[jobId]/job-tabs.tsx](app/(app)/jobs/[jobId]/job-tabs.tsx):

Interface `Props` — adicionar novo campo:

```typescript
interface Props {
  info: React.ReactNode;
  planilha: React.ReactNode;
  pps: React.ReactNode;
  ppsCount: number;
  /** Renderizado apenas quando a aba PPs está ativa. Usado pelo FAB
   * do chat de PPs — sem isso o botão apareceria em todas as abas
   * (as outras não desmontam, ficam com `hidden`). */
  ppsChat: React.ReactNode;
  chat: React.ReactNode;
  chatCount: number;
}
```

Destructure — adicionar `ppsChat`:

```typescript
export function JobTabs({
  info,
  planilha,
  pps,
  ppsCount,
  ppsChat,
  chat,
  chatCount,
}: Props) {
```

Renderização — adicionar bloco irmão dos tabpanels (logo depois do fechamento do `<div>` da aba `chat`, antes do fechamento do `<div className="space-y-6">`):

```tsx
{/* FAB do chat de PPs — só renderiza enquanto a aba PPs está ativa,
    do contrário o botão flutuante apareceria em todas as abas. */}
{tab === "pps" && ppsChat}
```

- [ ] **Step 2: Adicionar queries em `page.tsx`**

Editar [app/(app)/jobs/[jobId]/page.tsx](app/(app)/jobs/[jobId]/page.tsx).

**2a.** Adicionar import da nova função de thread + do FAB, logo depois dos imports existentes:

```typescript
import { montarThreadChatPPs } from "@/lib/data/job-chat-pps";
import { JobPPsChatFab } from "./pps/job-pps-chat-fab";
```

**2b.** Estender o `Promise.all` das queries paralelas. Localizar o array que hoje contém `mensagensRes` e `leituraRes` (por volta da linha 122). Adicionar **duas** novas queries:

```typescript
    // Mensagens do chat de PPs (escopo='pps'), separadas do chat geral.
    supabase
      .from("jobs_mensagens")
      .select("*, autor:profiles!autor_id(nome)")
      .eq("job_id", params.jobId)
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "pps")
      .order("created_at", { ascending: true }),
    // Leitura do usuário no chat de PPs.
    supabase
      .from("jobs_chat_leituras")
      .select("lida_ate")
      .eq("job_id", params.jobId)
      .eq("profile_id", session.profile.id)
      .eq("escopo", "pps")
      .maybeSingle(),
```

Ajustar a destructure do `Promise.all` incluindo `mensagensPPsRes` e `leituraPPsRes` na ordem correta:

```typescript
  const [
    gruposRes,
    itensRes,
    realizadosRes,
    ppsRes,
    fornecedoresRes,
    empresasRes,
    categoriasRes,
    erratasRes,
    mensagensRes,
    leituraRes,
    bvsRes,
    mensagensPPsRes,
    leituraPPsRes,
  ] = await Promise.all([
```

**Importante:** as duas queries novas ficam no FINAL do array (índice 11 e 12). O `mensagensRes`/`leituraRes` da comunicação continuam onde estão. Ajustar o filtro do `mensagensRes` existente pra `.eq("escopo", "geral")` **também** — sem isso, ele passa a ler PPs junto que agora existem na mesma tabela.

Localizar (por volta da linha 182):

```typescript
    supabase
      .from("jobs_mensagens")
      .select("*, autor:profiles!autor_id(nome)")
      .eq("job_id", params.jobId)
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: true }),
```

Adicionar `.eq("escopo", "geral")` antes do `.order`:

```typescript
    supabase
      .from("jobs_mensagens")
      .select("*, autor:profiles!autor_id(nome)")
      .eq("job_id", params.jobId)
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "geral")
      .order("created_at", { ascending: true }),
```

E no `leituraRes` da linha 187, adicionar `.eq("escopo", "geral")`:

```typescript
    supabase
      .from("jobs_chat_leituras")
      .select("lida_ate")
      .eq("job_id", params.jobId)
      .eq("profile_id", session.profile.id)
      .eq("escopo", "geral")
      .maybeSingle(),
```

**2c.** Depois do bloco existente que calcula `threadChat` e `naoLidas` (por volta da linha 374-407), adicionar cálculos análogos pra PPs:

```typescript
  // ---- Chat de PPs: thread e contador de não lidas ----
  if (mensagensPPsRes.error)
    console.error("[job.mensagens_pps]", mensagensPPsRes.error.message);

  const mensagensPPs = (mensagensPPsRes.data ?? []).map((m: any) => ({
    ...m,
    autor_nome: m.autor?.nome ?? null,
  }));

  const fornecedoresPorId: Record<string, string> = Object.fromEntries(
    fornecedores.map((f) => [f.id, f.razao_social ?? f.nome]),
  );

  const threadChatPPs = montarThreadChatPPs(
    ppsDoJob,
    mensagensPPs,
    versaoAprovada.moeda,
    fornecedoresPorId,
  );

  const lidaAtePPs =
    (leituraPPsRes.data as { lida_ate: string } | null)?.lida_ate ?? null;
  const naoLidasPPs = mensagensPPs.filter(
    (m: any) =>
      m.autor_id !== session.profile.id &&
      (!lidaAtePPs || m.created_at > lidaAtePPs),
  ).length;
```

**2d.** Passar `ppsChat` pra `<JobTabs>`. Localizar o JSX existente:

```jsx
        chatCount={naoLidas}
        chat={
          <JobChatSection
            jobId={job.id}
            jobCodigo={job.codigo}
            itens={threadChat}
            naoLidas={naoLidas}
            minhaArea={areaDoPapel(session.activeRole)}
          />
        }
      />
```

Adicionar prop `ppsChat` antes do `chat`:

```jsx
        ppsChat={
          <JobPPsChatFab
            jobId={job.id}
            jobCodigo={job.codigo}
            itens={threadChatPPs}
            minhaArea={areaDoPapel(session.activeRole)}
            naoLidasIniciais={naoLidasPPs}
          />
        }
        chatCount={naoLidas}
        chat={...}
```

**2e.** Reusar `fornecedoresPorId` que agora existe também no `<JobPPsSection>` para não repetir o `Object.fromEntries`. Localizar:

```jsx
            fornecedoresPorId={Object.fromEntries(
              fornecedores.map((f) => [f.id, f.razao_social ?? f.nome]),
            )}
```

Substituir por:

```jsx
            fornecedoresPorId={fornecedoresPorId}
```

- [ ] **Step 3: Verificar tsc + lint**

```bash
npx tsc --noEmit && npx next lint
```

Esperado: exit 0.

- [ ] **Step 4: Teste manual — fluxo completo**

Rodar o dev server:

```bash
npm run dev
```

Abrir `/jobs/<algum_id>` com PPs em vários status. Verificar:

1. Tab "Informações do Job" ativa → **FAB não aparece**.
2. Tab "Planilha Interna" ativa → **FAB não aparece**.
3. Tab "Pedidos de Produção" ativa → **FAB aparece no canto inferior direito**, cor California.
4. Tab "Comunicação" ativa → **FAB não aparece**.
5. Voltar pra tab "Pedidos de Produção", clicar no FAB → drawer abre da direita, altura total, largura ~420px.
6. Thread mostra um card "PP emitida" por PP; PPs em status terminal mostram card adicional ("PP paga"/"PP rejeitada"/"PP cancelada").
7. Enviar mensagem via Cmd+Enter → aparece na thread em realtime.
8. Fechar drawer → FAB continua com badge zerado.
9. Chat de Comunicação em outra aba → **contadores independentes**, mensagens de PP não aparecem lá e vice-versa.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/jobs/\[jobId\]/job-tabs.tsx app/\(app\)/jobs/\[jobId\]/page.tsx
git commit -m "feat(chat-pps): wire FAB + queries + thread separada por escopo"
```

---

## Self-Review (feito antes de entregar o plano)

**1. Spec coverage.** Passei pelas seções da spec:
- Reuso de schema (enum + colunas + PK reescrita) → Task 1 ✔
- Cards automáticos de 4 eventos → Task 2 ✔
- Componentes extraídos (`BalaoPessoa`, `ChatInput`, `icone-map`) → Task 4 ✔
- Server actions (`enviarMensagemPP`, `marcarChatPPsLido`) → Task 3 ✔
- FAB + drawer com badge realtime → Task 5 ✔
- `JobTabs` com `ppsChat` prop renderizado condicionalmente → Task 6 (Step 1) ✔
- Queries paralelas via `Promise.all` → Task 6 (Step 2b) ✔
- Filtro `escopo='geral'` no chat existente → Task 6 (Step 2b) ✔ (crítico — sem isso o chat geral passa a mostrar mensagens de PP)
- Renderização condicional do drawer → Task 5 (`{open && <JobPPsChatSection...>}`) ✔
- Realtime client-side filtrando escopo → Task 4 (Section) + Task 5 (FAB) ✔

**2. Placeholder scan.** Nenhum "TBD"/"TODO"/"handle edge cases" no plano. Todos os steps contêm código executável ou comando concreto.

**3. Type consistency.**
- `montarThreadChatPPs(pps, mensagens, moedaCode, fornecedoresPorId)` — Task 2 declara, Task 6 chama com os 4 args na ordem.
- `<JobPPsChatSection jobId, itens, minhaArea, onLidoInicial>` — Task 4 declara, Task 5 chama com esses props.
- `<JobPPsChatFab jobId, jobCodigo, itens, minhaArea, naoLidasIniciais>` — Task 5 declara, Task 6 chama com esses props.
- `JobTabs` props `ppsChat` — Task 6 (Step 1) adiciona, Task 6 (Step 2d) usa.
- `enviarMensagemPP(jobId, texto)` e `marcarChatPPsLido(jobId)` — Task 3 declara, Task 4 usa.
- Novos ícones da união `ItemChat` (`"file-text" | "check-circle" | "x-circle" | "ban"`) — Task 1 adiciona; Task 2 (`montarThreadChatPPs`) emite; Task 4 (`icone-map.ts`) mapeia.

**Um gotcha que descobri durante o review e coloquei no plano:** o `mensagensRes` do chat geral em `page.tsx` **precisa** ganhar `.eq("escopo", "geral")` — sem isso passa a ler as mensagens novas de escopo `'pps'` também, o que quebra o chat de Comunicação. Ficou explícito no Step 2b da Task 6.

---

## Handoff de execução

Plano salvo em [docs/superpowers/plans/2026-08-10-chat-pps-no-job.md](docs/superpowers/plans/2026-08-10-chat-pps-no-job.md).

Duas opções de execução:

**1. Subagent-Driven (recomendado)** — Um subagent novo por task, revisão entre tasks, iteração rápida.

**2. Inline Execution** — Executar direto nesta sessão via `executing-plans`, com checkpoints pra revisão.

Qual você prefere?
