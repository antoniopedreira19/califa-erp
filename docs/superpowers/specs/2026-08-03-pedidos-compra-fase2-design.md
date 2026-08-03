# Pedidos de Compra — Fase 2 (Caixa de Entrada do Financeiro)

**Data**: 2026-08-03
**Status**: Aprovado, aguardando plano de implementação
**Antecessores**: Task 010 Fase 1 (geração + cancelamento simples)

## Objetivo

Entregar a segunda parte do fluxo financeiro operacional: uma caixa de entrada em `/financeiro/pedidos-compra` onde o time financeiro visualiza todas as PPs emitidas pelos GPs, anota o prazo real de pagamento (diferente do vencimento original), baixa PDFs/anexos e cancela PPs com motivo obrigatório. Prepara o terreno para a Fase 3 (baixa em `lancamentos_financeiros`).

## Decisões chave

### Status da PP — introdução de soft delete

- Novo enum `pp_status` com valores `emitida` e `cancelada`. `baixada` fica pra Fase 3 (quando `lancamentos_financeiros` existir).
- Cancelar PP vira **soft delete**: row permanece na tabela com `status='cancelada'` + auditoria (`cancelada_por`, `cancelada_em`, `motivo_cancelamento`). PDF e anexos ficam no bucket (storage barato, histórico caro).
- Query da tela do job filtra `status != 'cancelada'` pra PPs canceladas sumirem da trilha do realizado. O item volta a mostrar "Gerar PP" como se nunca tivesse gerado.

### Prazo pagamento — dois campos separados

- `prazo_pagamento` (existente): vencimento original. Definido pelo GP na geração. Aparece no PDF. **Imutável**.
- `prazo_pagamento_financeiro` (novo, nullable): data em que o financeiro consegue pagar de verdade. Preenchido posteriormente na caixa. **Não aparece no PDF** (é dado interno, não vai pro documento formal).

### Quem cancela

**GP (responsável do job) OU admin** — via `/jobs/[jobId]`:
- Só permite se `status='emitida'`. Após baixada (fase 3), botão desabilitado.
- Motivo opcional (rápido, sem justificar).
- Registra `metadata.origem='gp'` no audit.

**Financeiro OU admin** — via `/financeiro/pedidos-compra`:
- Permite qualquer status ≠ `cancelada`. Na fase 3, cancelar `baixada` exigirá estornar baixa antes (fluxo próprio da fase 3).
- Motivo obrigatório, min 10 chars, max 500.
- Registra `metadata.origem='financeiro'` no audit.

Ambas as ações fazem o mesmo UPDATE (soft delete + zeração do `fornecedor_id` no realizado, pra permitir gerar nova PP). Só o gate e a UI diferem.

### Baixa — placeholder por enquanto

Botão "Dar Baixa" no drawer da caixa **fica 100% desabilitado com tooltip** `"Em breve — vira lançamento em contas a pagar (fase 3)"`. Nenhuma action implementada. Fase 3 traz a tabela `lancamentos_financeiros`, o fluxo de baixa, o de estorno, e as regras de "só financeiro cancela baixada".

### Anexos na caixa

Financeiro pode:
- Ver o PDF da PP (botão "Ver PDF", já implementado via `signedUrlPdf`).
- Baixar cada anexo individualmente (botão por linha da lista, via `signedUrlAnexo` — já implementado).

Sem preview inline. Sem thumbnails. Simples.

### Filtros e busca

Chips: `Todas` | `Emitida` | `Cancelada`. Default: `Emitida` (financeiro quer ver o que ainda precisa tratar).

Busca client-side sobre: `codigo` (PP-NNNNN), nome do fornecedor, código/nome do job.

## Componentes da entrega

### 1. Migration `20260803000001_pp_fase2_status_e_baixa.sql`

```sql
-- =====================================================================
-- Task 011 fase 2 — Caixa de Entrada de PPs
-- Ver spec: docs/superpowers/specs/2026-08-03-pedidos-compra-fase2-design.md
-- =====================================================================

-- 1. Enum de status (baixada fica pra fase 3)
do $$ begin
  create type pp_status as enum ('emitida', 'cancelada');
exception when duplicate_object then null;
end $$;

-- 2. Novas colunas em pedidos_compra
alter table public.pedidos_compra
  add column if not exists status pp_status not null default 'emitida',
  add column if not exists prazo_pagamento_financeiro date,
  add column if not exists cancelada_por uuid references public.profiles(id),
  add column if not exists cancelada_em timestamptz,
  add column if not exists motivo_cancelamento text;

-- 3. Índice para chips de filtro
create index if not exists idx_pp_status
  on public.pedidos_compra(tenant_id, status);

-- 4. Substituir unique(item_realizado_id) por unique parcial: só bloqueia
-- se existir PP NÃO cancelada. Sem isso, cancelar uma PP e gerar nova no
-- mesmo item falha por unique constraint (soft delete quebra a assumption
-- da fase 1 que era hard delete).
alter table public.pedidos_compra
  drop constraint if exists uniq_pp_por_item_realizado;

create unique index if not exists uniq_pp_ativa_por_item_realizado
  on public.pedidos_compra(item_realizado_id)
  where status != 'cancelada';
```

Sem mudança em RLS (padrão `is_tenant_member` cobre; regras de ownership continuam em server actions).

### 2. Types em `lib/types.ts`

```ts
export type PPStatus = "emitida" | "cancelada";

export interface PedidoCompra {
  // ... campos existentes ...
  status: PPStatus;                              // NOVO
  prazo_pagamento_financeiro: string | null;     // NOVO
  cancelada_por: string | null;                  // NOVO
  cancelada_em: string | null;                   // NOVO
  motivo_cancelamento: string | null;            // NOVO
}

export function ppStatusLabel(s: PPStatus): string {
  switch (s) {
    case "emitida": return "Emitida";
    case "cancelada": return "Cancelada";
  }
}
```

### 3. Auditoria — `lib/auth/audit.ts`

Adicionar action nova: `pedido_compra.prazo_financeiro_atualizado`.

Reutilizar `pedido_compra.cancelada` (já existe da fase 1) — mas agora com `metadata.origem: "gp" | "financeiro"` + `metadata.motivo` (quando origem=financeiro).

### 4. Mudança em `cancelarPedidoCompra` (existente, em `actions-pp.ts`)

Comportamento atualizado:
- **Gate**: `admin` OR responsável do job.
- **Nova regra**: só permite se `status='emitida'`. Se `cancelada`, retorna erro `"PP já cancelada."`.
- **Comportamento**: UPDATE `status='cancelada'` + `cancelada_por = session.profile.id` + `cancelada_em = now()` + `motivo_cancelamento = null` (GP não justifica).
- **Não faz mais hard delete**. Não remove PDF/anexos do bucket. Row fica na tabela.
- **Mantém**: zerar `fornecedor_id` do realizado, audit.
- Audit metadata ganha `origem: "gp"`.

### 5. Nova server action — `cancelarPedidoCompraFinanceiro` em `app/(app)/financeiro/pedidos-compra/actions.ts`

```ts
cancelarPedidoCompraFinanceiro(pp_id: string, motivo: string) → { ok } | { ok:false, message }
```

- **Gate**: `admin` OR `financeiro`.
- **Regra**: só se `status ≠ 'cancelada'`. Na fase 2, isso é equivalente a `status='emitida'`.
- **Motivo obrigatório**: min 10, max 500 chars (Zod). Trim antes de validar.
- **Comportamento**: mesmo UPDATE do cancelamento do GP, mas com `motivo_cancelamento = motivo`.
- Zera `fornecedor_id` do realizado.
- Audit `pedido_compra.cancelada` com `metadata.origem: "financeiro"` + `metadata.motivo`.
- `revalidatePath("/financeiro/pedidos-compra")` + `revalidatePath("/jobs/{jobId}")`.

### 6. Nova server action — `salvarPrazoFinanceiro`

```ts
salvarPrazoFinanceiro(pp_id: string, prazo: string | null) → { ok } | { ok:false, message }
```

- **Gate**: `admin` OR `financeiro`.
- Aceita `null` (limpar prazo) OU ISO date `YYYY-MM-DD`. Sem validação de "prazo ≥ hoje" (financeiro pode registrar data passada).
- Só permite se `status='emitida'` (não faz sentido editar prazo de PP cancelada).
- UPDATE `prazo_pagamento_financeiro`.
- Audit `pedido_compra.prazo_financeiro_atualizado` com `metadata.prazo_anterior`, `metadata.prazo_novo`.
- `revalidatePath("/financeiro/pedidos-compra")`.

### 7. Página `/financeiro/pedidos-compra/page.tsx`

Server component. Query única:

```ts
supabase.from("pedidos_compra")
  .select(`
    id, codigo, status, valor, prazo_pagamento, prazo_pagamento_financeiro,
    created_at, cancelada_em, cancelada_por, motivo_cancelamento,
    fornecedor:fornecedores(id, nome, razao_social),
    job:jobs(id, codigo, nome, projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia)))
  `)
  .eq("tenant_id", session.activeTenant.id)
  .order("created_at", { ascending: false });
```

Redirect se `activeRole ∉ {admin, financeiro}` (mesmo padrão do `/financeiro`).

Passa rows pra `<PedidosCompraList>` (client, filtra + renderiza tabela).

Header no padrão do projeto: kicker "Financeiro" + breadcrumb `Financeiro / Pedidos de Compra` + icon `FileText` + título + descrição.

`max-w-7xl` (padrão de listagens).

### 8. Client `pedidos-compra-list.tsx`

- State: `statusFilter: 'todas' | 'emitida' | 'cancelada'`, default `emitida`.
- State: `busca: string`.
- State: `drawerAberto: { pp } | null`.
- Chips de filtro no topo (padrão do `/jobs`).
- Input de busca à direita.
- Tabela com colunas: Código (mono), Fornecedor (razão_social || nome), Job (código · nome), Emissão, Valor, Prazo Original, Status (badge).
- Linha inteira clicável (`role="button"`, keyboard, `onClick` seta drawer).
- Empty state: distingue "sem PPs" de "sem PPs com esses filtros".

### 9. Client `pp-drawer-financeiro.tsx`

Recebe: `pp: PedidoCompra` (enriched com fornecedor+job+anexos), `open`, `onOpenChange`, `onUpdated` (callback pra pai revalidar).

Layout:
- **Header**: código PP (grande, mono) + badge status + botão "Ver PDF" (usa `signedUrlPdf` da fase 1).
- **Dados** (read-only): fornecedor (razão social + CNPJ), empresa emissora, projeto/job, serviço, quantidade, valor formatado, prazo original, emissão (data + nome emitida_por), especificações se preenchido.
- **Anexos**: lista com nome+tamanho+botão download (`signedUrlAnexo`).
- **Bloco de ação** (só se `status='emitida'`):
  - `<DatePicker>` "Prazo pagamento financeiro" (aceita null pra limpar)
  - Botão "Salvar prazo" (desabilitado se prazo não mudou)
  - Botão "Dar Baixa" **desabilitado**, `<Tooltip>` "Em breve — vira lançamento em contas a pagar (fase 3)"
  - Botão "Cancelar PP" (`variant="destructive"`) → abre `<ConfirmDialog>` com `<Textarea>` obrigatório (mín 10 chars).
- **Bloco de cancelada** (só se `status='cancelada'`):
  - Card destacado (fundo california-red/5, borda california-red/40)
  - Texto: `Cancelada por {nome} em {data DD/MM/AAAA HH:mm}`
  - Se `motivo_cancelamento`: linha "Motivo: {texto}". Se null: "Sem motivo registrado (cancelado pelo GP)".

Componentes reusáveis: `DrawerContent`, `DialogHeader`, `DialogTitle`, `DatePicker`, `Textarea`, `Select` (não usado aqui, só datepicker), `ConfirmDialog`, `Tooltip`.

### 10. Card novo no hub `/financeiro/page.tsx`

Novo `<FinanceiroCard>` ao lado do "Jobs Aguardando Abertura":

```
[FileText icon]
Pedidos de Compra
Visualize, ajuste prazo e cancele PPs emitidas.
{count} PPs emitidas
```

Query paralela ao existente:
```ts
const { count: ppsCount } = await supabase
  .from("pedidos_compra")
  .select("id", { count: "exact", head: true })
  .eq("tenant_id", session.activeTenant.id)
  .eq("status", "emitida");
```

### 11. Ajustes na tela do job (impacto colateral)

**`/jobs/[jobId]/page.tsx`** — query dos PPs precisa filtrar canceladas:

```ts
.from("pedidos_compra")
.select("*")
.eq("job_id", raw.id)
.eq("tenant_id", session.activeTenant.id)
.eq("status", "emitida")  // NOVO: só emitidas aparecem na trilha
```

**`PPActionsCell`**:
- Se `pp.status === 'emitida'`: mostra 👁 (ver PDF) + 🗑 (cancelar) — igual hoje.
- Se `pp.status === 'baixada'` (fase 3, ainda não existe mas deixa preparado): 🗑 desabilitado com tooltip "Cancelamento após baixa só pelo financeiro".
- Como filtramos `cancelada` no server, `PPActionsCell` nunca recebe uma PP cancelada.

**`cancelarPedidoCompra` mudou de hard→soft delete**: sem impacto visual pro GP (mesma UX de cancelar). Só muda que o registro fica no banco em vez de sumir.

## Performance

- ✅ Query única na página `/financeiro/pedidos-compra` com embeds `fornecedor`, `job.projeto.cliente`.
- ✅ Filtro/busca client-side (volume esperado baixo: dezenas de PPs por mês).
- ✅ Índice `idx_pp_status` acelera filtro por status.
- ✅ Migration com GRANT já existente (só adiciona colunas).
- ✅ `force-dynamic` mantido nas pages autenticadas.

## Auditoria

- `pedido_compra.cancelada` (já existe) — metadata ganha `origem: "gp" | "financeiro"` + `motivo` quando aplicável.
- `pedido_compra.prazo_financeiro_atualizado` (nova) — metadata `{ prazo_anterior, prazo_novo }`.

## Fora de escopo (Fase 3+)

- Botão "Dar Baixa" funcional
- Tabela `lancamentos_financeiros`
- Fluxo de estorno de baixa
- Bloqueio de cancelamento pós-baixa (só financeiro)
- Contas a pagar (agrupamento de lançamentos)
- DRE
- Dashboard de PPs vencendo
- Notificação pro GP quando financeiro cancela sua PP (por enquanto GP só descobre ao abrir a tela do job)
- Edição de outros campos da PP (fornecedor, valor, serviço, etc — snapshot imutável)

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| PPs canceladas acumulam no banco sem limpar | Aceitável — soft delete é histórico. Job de limpeza noturno futuro pode arquivar/limpar PPs canceladas > N meses. |
| Financeiro cancela PP que GP acabou de gerar sem alinhar | Motivo obrigatório força pausa. Audit registra quem. Sem notificação por enquanto (fase futura). |
| Mudança de hard→soft delete quebra assumption em outro código | Grep mostra que `cancelarPedidoCompra` só é chamada pelo `PPActionsCell` na trilha do realizado. Novo filtro `status='emitida'` na query da page cobre — cancelada some da trilha automaticamente. Fluxo do user idêntico. |
| GP cancela PP enquanto financeiro está editando prazo no drawer | UPDATE otimista (last-write-wins). Aceito. Se preciso, revisar na fase 3 com row lock. |
| Financeiro salva prazo sem PP existir mais (concorrência) | Server action verifica `status='emitida'` antes do UPDATE. Se já cancelada, retorna erro amigável. |
| Unique constraint da fase 1 (`unique(item_realizado_id)`) impede gerar nova PP após cancelar (soft delete deixa row antiga) | Migration substitui por unique **parcial** `where status != 'cancelada'`. Múltiplas canceladas + no máximo 1 ativa por item. |

## Testes manuais (aceitação)

1. Como financeiro, abrir `/financeiro` → ver card "Pedidos de Compra" com contagem de emitidas.
2. Clicar → abre `/financeiro/pedidos-compra` com tabela.
3. Chip "Emitida" ativo por padrão → só mostra PPs emitidas.
4. Chip "Todas" → mostra emitidas + canceladas.
5. Chip "Cancelada" → só canceladas (badge cinza).
6. Busca por parte do código, nome do fornecedor OU nome do job filtra corretamente.
7. Clicar em linha → drawer abre com todos os dados.
8. Clicar "Ver PDF" → abre em nova aba.
9. Baixar um anexo → download inicia.
10. Selecionar data no DatePicker "Prazo Financeiro" + clicar "Salvar prazo" → toast/confirmação, drawer atualiza.
11. Reabrir drawer → prazo salvo persistiu.
12. Limpar prazo (DatePicker vazio) + salvar → prazo vira null.
13. Botão "Dar Baixa" → hover mostra tooltip "em breve", clique não faz nada.
14. Clicar "Cancelar PP" → ConfirmDialog abre com Textarea.
15. Tentar cancelar com motivo <10 chars → erro visível.
16. Cancelar com motivo válido → drawer fecha, tabela atualiza, PP aparece com badge "Cancelada" no filtro "Todas".
17. Reabrir a PP cancelada → drawer mostra card com "Cancelada por X em Y — motivo: Z".
18. Como GP responsável, voltar em `/jobs/[jobId]` → item que teve PP cancelada volta a mostrar "Gerar PP" (trilha atualizada).
19. Como GP, gerar nova PP no mesmo item → funciona (unique constraint respeitada porque a antiga tá cancelada).
20. Como GP, cancelar uma PP emitida direto da tela do job → funciona (motivo não pedido, cancela silencioso).
21. Como user sem role admin/financeiro, tentar acessar `/financeiro/pedidos-compra` → redirect pra home com reason.
22. Audit: verificar `audit_events` tem `pedido_compra.cancelada` com metadata `origem` correto (`gp` ou `financeiro`) e `motivo` quando `financeiro`.
23. Audit: verificar `pedido_compra.prazo_financeiro_atualizado` com metadata `{prazo_anterior, prazo_novo}`.
