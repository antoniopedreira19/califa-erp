# Chat de PPs no job

**Data:** 2026-08-10
**Contexto:** ERP California — página de detalhes do job, tab "Pedidos de Produção (PPs)".

## Problema

Hoje a tab "Comunicação" tem um chat Produção ↔ Financeiro no nível do job, misturando mensagens humanas com cards automáticos (abertura do job, erratas). A tab "Pedidos de Produção" só lista as PPs, sem canal de conversa. Financeiro e Produção precisam se coordenar sobre PPs (fornecedor entregou, prazo esticou, agendou pagamento, motivo da rejeição) e hoje isso acontece fora do sistema.

## Objetivo

Adicionar um chat escopado a PPs, dentro da tab "Pedidos de Produção", com o mesmo modelo do chat de Comunicação: mensagens humanas Produção ↔ Financeiro **misturadas com cards automáticos** de eventos de PP desse job. Acesso via botão flutuante no canto inferior direito que abre um drawer lateral.

## Escopo

- **Um chat por job**, escopado a assuntos de PPs desse job — não uma thread por PP individual.
- **Área da conversa** derivada do papel do usuário logado (mesma regra do chat de Comunicação): Produção fala como Produção, Financeiro fala como Financeiro. Ninguém escolhe.
- **Cards automáticos** cobrem quatro eventos: PP emitida, PP paga, PP rejeitada, PP cancelada. Derivados de `pedidos_compra` — nada duplicado no banco.
- **FAB + Drawer lateral** visível apenas quando a tab "Pedidos de Produção" está ativa.
- **Badge de não lidas** próprio, separado do badge do chat geral.

## Fora de escopo

- Chat por PP individual (thread aninhada).
- Menções (`@usuario`), anexos, reações, edição/exclusão de mensagem.
- Notificação por e-mail/push (só o badge visual conta).
- Cards para outros eventos do job (erratas, alterações de status do próprio job) — esses continuam na tab "Comunicação".

## Modelagem

### Reuso de schema

Aproveitar as tabelas existentes (`jobs_mensagens`, `jobs_chat_leituras`) adicionando uma coluna de escopo. Motivo: infra idêntica (RLS, realtime, policies, contador de não lidas), muda só o filtro. Tabela nova duplicaria essa infra sem benefício.

```sql
-- Enum de escopo
create type chat_escopo as enum ('geral', 'pps');

-- Adição em jobs_mensagens
alter table public.jobs_mensagens
  add column escopo chat_escopo not null default 'geral';

create index idx_jobs_msg_job_escopo
  on public.jobs_mensagens(job_id, escopo, created_at);

-- Adição em jobs_chat_leituras: cada usuário tem uma leitura por escopo.
alter table public.jobs_chat_leituras
  add column escopo chat_escopo not null default 'geral';
alter table public.jobs_chat_leituras
  drop constraint jobs_chat_leituras_pkey;
alter table public.jobs_chat_leituras
  add primary key (job_id, profile_id, escopo);
```

- Backfill implícito: mensagens e leituras existentes ficam com `escopo='geral'` pelo default. Chat de Comunicação continua funcionando sem alteração.
- Policies RLS existentes valem sem mudança (filtram por `is_tenant_member(tenant_id)`).
- Publicação `supabase_realtime` já inclui `jobs_mensagens` — o filtro por escopo entra no canal client-side.

### Cards de sistema (derivados de `pedidos_compra`)

| Evento | Ícone | Cor | Título | Corpo | Valor exibido |
|---|---|---|---|---|---|
| PP criada | `FileText` | azul | "PP emitida" | `{codigo} · {servico} · {fornecedor}` + "emitida por {autor} · prazo {N} dias" | `R$ {valor}` (neutro) |
| Status → `pago` | `CheckCircle2` | verde | "PP paga" | `{codigo} · {fornecedor}` + "marcada como paga" | `R$ {valor}` (positivo) |
| Status → `rejeitada` | `XCircle` | vermelho | "PP rejeitada" | `{codigo} · {fornecedor}` + motivo se houver | `R$ {valor}` (negativo) |
| Status → `cancelada` | `Ban` | bege | "PP cancelada" | `{codigo} · {fornecedor}` + "cancelada por {autor}" | `R$ {valor}` (neutro) |

**Fonte dos timestamps:**
- PP criada → `pedidos_compra.created_at`.
- PP paga/rejeitada/cancelada → `pedidos_compra.updated_at` **quando** o status atual é o correspondente. Se a PP passou por vários estados, mostramos só o estado terminal atual (não temos histórico de transições).

**Limitação assumida:** sem tabela de histórico de status, não conseguimos reconstruir "foi pago, depois estornado". No MVP essas transições não existem — PP cancelada não volta, PP paga não desfaz. Se for necessário no futuro, criar `pedidos_compra_transicoes` e reordenar a thread.

**Ordenação final:** mensagens humanas + cards ordenados por timestamp ascendente. Igual à `montarThreadChat` existente.

## Componentes

### Frontend

**`components/chat/balao-pessoa.tsx`** (novo, extraído)
Extrair `BalaoPessoa` de [job-chat-section.tsx](app/(app)/jobs/[jobId]/comunicacao/job-chat-section.tsx) pra `components/chat/` — usado por Comunicação e por PPs.

**`components/chat/chat-input.tsx`** (novo, extraído)
Textarea + botão de enviar + badge "Enviando como {área}" + erro. Idem — usado pelos dois chats.

**`app/(app)/jobs/[jobId]/pps/job-pps-chat-section.tsx`** (novo)
Chat de PPs client-side. Estrutura análoga a `JobChatSection`, com:
- `CardSistema` local com o mapeamento novo de ícones/cores (`FileText`, `CheckCircle2`, `XCircle`, `Ban`).
- Reusa `BalaoPessoa` e `ChatInput`.
- Realtime: canal filtrado por `job_id=eq.X AND escopo=eq.pps`.

**`app/(app)/jobs/[jobId]/pps/job-pps-chat-fab.tsx`** (novo)
Botão flutuante `fixed bottom-6 right-6 z-40` com badge de não lidas. Abre `Sheet` lateral direito (~420px) que contém `JobPPsChatSection`. Só renderiza no client.

**Visibilidade condicionada à aba ativa:** hoje o [JobTabs](app/(app)/jobs/[jobId]/job-tabs.tsx) desmonta apenas a aba "Comunicação" (`{tab === "chat" && chat}`); as outras ficam montadas com `className="hidden"`. Então **não** dá pra pôr o FAB dentro de `JobPPsSection` — ele apareceria em todas as abas. Solução: adicionar prop nova `ppsChat: React.ReactNode` em `JobTabs` e renderizar como bloco irmão dos tabpanels:

```tsx
{tab === "pps" && ppsChat}
```

O FAB e o Sheet vivem nesse subtree. Bônus: seguindo o padrão do chat de Comunicação, isso também garante que o canal realtime só é assinado quando a aba está aberta.

### Server

**`lib/data/job-chat-pps.ts`** (novo)
Função `montarThreadChatPPs(pps, mensagens, moedaCode)` análoga a `montarThreadChat`. Recebe lista de `PedidoCompraNaLista` (que já vem da query da página) e as mensagens de escopo `pps`, devolve `ItemChat[]` ordenado.

**`app/(app)/jobs/[jobId]/pps/actions-chat.ts`** (novo)
- `enviarMensagemPP(jobId, texto)` — clone de `enviarMensagem` gravando `escopo='pps'`.
- `marcarChatPPsLido(jobId)` — clone de `marcarChatLido` com `escopo='pps'`.

Motivo de duplicar em vez de parametrizar: as actions são pequenas (~30 linhas cada), e cada uma continua óbvia sem parâmetro extra. A validação, session e revalidação são idênticas.

### Página

Em [page.tsx](app/(app)/jobs/[jobId]/page.tsx), no `Promise.all` já existente:
- Nova query de `jobs_mensagens` filtrada por `escopo='pps'`.
- Nova query de `jobs_chat_leituras` filtrada por `escopo='pps'`.

Montar `threadChatPPs` via `montarThreadChatPPs(ppsDoJob, mensagensPPs, moeda)` e calcular `naoLidasPPs`. Passar tudo pro `<JobPPsSection>`, que renderiza a lista existente + o FAB do chat.

## Tipos

Reutilizar `ChatArea`, `ChatTom`, `ItemChat`, `chatAreaLabel` já existentes em [lib/types.ts](lib/types.ts). O `ItemChat` do tipo `"sistema"` já aceita ícones diferentes; adicionar novos valores ao union `icone` do sistema:

```ts
// lib/types.ts — antes:
icone: "folder-open" | "file-pen-line" | "tags";
// depois:
icone: "folder-open" | "file-pen-line" | "tags" | "file-text" | "check-circle" | "x-circle" | "ban";
```

Centralizar o mapeamento `icone → LucideIcon` num `components/chat/icone-map.ts`, importado pelo `CardSistema` das duas telas. Evita a duplicação de manter dois `ICONE_COMPONENTE` sincronizados.

## Performance

Aplicando o checklist de `docs/PERFORMANCE.md`:
- **Queries paralelas:** as duas queries novas entram no `Promise.all` já existente da página. Sem query serial adicional.
- **Sem embed pesado:** `jobs_mensagens` seleciona apenas os campos necessários (`id, texto, area, autor_id, created_at`) + join com `profiles(nome)`. Já é o padrão do chat existente.
- **`prefetch={false}`:** não aplicável — o FAB não é `<Link>`.
- **Índice:** `idx_jobs_msg_job_escopo` cobre a query por `job_id + escopo` ordenada por tempo.
- **Realtime:** filtro server-side `job_id=eq.X` continua igual; escopo é filtrado client-side ao processar o payload (`payload.new.escopo === 'pps'`). O INSERT do Realtime traz a row inteira, então tem o escopo. Isso evita depender de filtros compostos em publicações.
- **Renderização condicional:** `JobPPsChatSection` só monta quando a aba de PPs está ativa (garantido pelo `{tab === "pps" && ppsChat}` no `JobTabs`). Fecha/abre do Sheet não desmonta a Section — a Section fica montada enquanto a aba tá ativa, o Sheet só controla visibilidade do conteúdo.

## Auditoria

Envio de mensagem no chat de PPs não gera evento de auditoria — mesmo tratamento do chat de Comunicação hoje. A mensagem em si é o registro; `created_at` e `autor_id` são suficientes.

## Ortografia

Todas as strings visíveis:
- "Pedidos de Produção" (título do drawer)
- "Enviando como Produção" / "Enviando como Financeiro"
- "PP emitida", "PP paga", "PP rejeitada", "PP cancelada"
- "não lida" / "não lidas"
- "Escreva sobre uma PP…" (placeholder)
- "Em breve — anexos no chat" (tooltip herdado)
- Mensagens de erro em pt-BR completo.

## Migração e compatibilidade

- Uma migration nova: `YYYYMMDDHHMMSS_chat_escopo.sql` com o enum, colunas e índice.
- Grants: `jobs_mensagens` e `jobs_chat_leituras` já têm `grant ... to authenticated`. A coluna nova herda automaticamente.
- Sem alteração em código existente do chat de Comunicação — o default `'geral'` mantém tudo funcionando.

## Testes manuais mínimos

1. Abrir job com PPs em vários status → FAB aparece na tab de PPs, thread mostra card por PP.
2. Enviar mensagem como Produção → aparece à direita, Financeiro vê à esquerda em realtime.
3. Emitir nova PP em outra aba → card "PP emitida" aparece na thread ao recarregar.
4. Fechar/reabrir o Sheet → badge zera após leitura, não sobe de novo em refresh.
5. Chat de Comunicação da mesma aba → continua funcionando, contadores separados.
