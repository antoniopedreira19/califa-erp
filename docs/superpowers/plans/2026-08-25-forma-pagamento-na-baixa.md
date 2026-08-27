# Forma de Pagamento na Baixa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover `forma_pagamento` de origens de "solicitação" (PP e Desembolso) para `lancamentos_financeiros` (fato consumado na baixa); manter em avulsa/recorrência como "planejado"; refatorar modal de baixa único pra capturar forma no momento certo.

**Architecture:** 3 migrations aditivas primeiro (colunas em `lancamentos_financeiros`, comments em avulsa/recorrência, RPCs alteradas), depois refactor de UI e server actions, e por último 1 migration destrutiva removendo colunas de PP/Desembolso. Ordem inversa da "óbvia" pra permitir reverter sem perder dados se algo quebrar no meio do caminho.

**Tech Stack:** Next.js 14 App Router (server components + server actions), React 18, TypeScript 5, Supabase Postgres (RLS + RPC), React Hook Form + Zod, Tailwind + shadcn/ui, MCP Supabase para aplicar migrations.

**Spec:** [docs/superpowers/specs/2026-08-25-forma-pagamento-na-baixa-design.md](../specs/2026-08-25-forma-pagamento-na-baixa-design.md)

## Global Constraints

- **Fluxo de banco (docs/FLUXO-BANCO.md)**: toda estrutura via migration versionada. Ler → migration → `apply_migration` via MCP → conferir → commit da migration junto do código. **Migration 4 é destrutiva** (DROP COLUMN) — user já confirmou explicitamente no spec.
- **RLS + GRANT já existente** em `lancamentos_financeiros` cobre as novas colunas (colunas herdam policies da tabela).
- **`lib/types.ts` no mesmo commit** de cada migration que mexe em coluna consumida pelo frontend.
- **Ortografia pt-BR completa** em toda string visível (labels, placeholders, mensagens).
- **Componente compartilhado `FormaPagamentoField`** (já existe em `components/financeiro/forma-pagamento-field.tsx`) reusado no modal de baixa. Ao remover do drawer de PP e Desembolso, o componente permanece — continua em uso em avulsa, recorrência e modal de baixa.
- **`SUPABASE_SERVICE_ROLE_KEY` nunca no navegador**.
- **Regras críticas não frontend-only**: Zod roda no server action, RPCs validam coerência (cartão exige cartão_id).
- **Auditoria**: metadata de eventos existentes de baixa ganha `forma_pagamento` + `cartao_credito_id`. Sem chaves novas.
- **Sem framework de testes**: verificação = `npm run typecheck` + `npm run lint` + `npm run build` + MCP queries + smoke manual no browser.
- **Prefixo migration**: próximo número = `20260825000001`. Sequência: `_1_lancamentos_forma`, `_2_rpcs_forma_na_baixa`, `_3_drop_forma_pp_desembolso`.

---

## File Structure

**Novos arquivos:**
- `supabase/migrations/20260825000001_lancamentos_forma.sql` — colunas + índices em `lancamentos_financeiros` + comments em avulsa/recorrência.
- `supabase/migrations/20260825000002_rpcs_forma_na_baixa.sql` — 4 RPCs alteradas (baixa de PP/desembolso/avulsa + lote cartão).
- `supabase/migrations/20260825000003_drop_forma_pp_desembolso.sql` — DROP COLUMN destrutivo.

**Arquivos modificados:**
- `lib/types.ts` — `LancamentoFinanceiro` ganha campos (Task 1); `PedidoCompra` e `Desembolso` perdem campos (Task 7).
- `lib/validations/baixa-titulo.ts` (novo arquivo se ainda não existir) OU o schema Zod atual do baixa dentro de `actions-titulos.ts` — ganha `forma_pagamento` + `cartao_credito_id` + refinement.
- `components/financeiro/baixa-titulo-dialog.tsx` — insere `<FormaPagamentoField>`, gerencia estado, pré-preenche por origem, envia no payload.
- `app/(app)/financeiro/contas-a-pagar/actions-titulos.ts` — `darBaixaTitulo` estendida; RPC calls passam os 2 novos parâmetros.
- `app/(app)/financeiro/contas-a-pagar/actions-cartao.ts` — `darBaixaLoteCartao` remove `desembolso` do enum (só aceita `avulso`/`recorrencia`); passa `cartao_credito_id` explicitamente.
- `app/(app)/financeiro/contas-a-pagar/page.tsx` — query `baixasRes` ganha colunas; loops de PP/Desembolso passam `forma_pagamento: null`; loops de avulsa/recorrência mantêm; coalescência final "planejada vs realizada" no map.
- `app/(app)/financeiro/contas-a-pagar/titulos-cartao-list.tsx` — se necessário, adaptar filtro pra suportar histórico de PP/Desembolso pagos no cartão (aparecem via `forma_pagamento` do lançamento).
- `app/(app)/financeiro/contas-a-pagar/titulos-pagar-list.tsx` — coluna/badge exibindo forma real quando pago.
- `app/(app)/jobs/[jobId]/realizado/gerar-pp-drawer.tsx` — remove `<FormaPagamentoField>`, estado `formaPagamento`, `handleFormaPagamentoChange`, auto-preenchimento de datas via `parcelasParaFatura`.
- `app/(app)/jobs/[jobId]/realizado/actions-pp.ts` — Zod perde 2 campos + refinement de cartão; INSERT sem 2 campos.
- `app/(app)/jobs/[jobId]/page.tsx` — remove SELECT de `cartoes_credito` do `Promise.all`; deixa de passar prop `cartoes` na chain.
- `app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx` / `job-grupo-card.tsx` / `job-item-realizado-table.tsx` — chain de propagação de `cartoes` prop removida.
- `app/(app)/financeiro/desembolsos/desembolso-drawer.tsx` — mesma reversão que PP.
- `app/(app)/financeiro/desembolsos/actions.ts` — Zod perde 2 campos + refinement; INSERT sem 2 campos.
- `app/(app)/financeiro/desembolsos/page.tsx` — remove SELECT cartões + prop.
- `app/(app)/financeiro/desembolsos/desembolsos-list.tsx` — remove prop `cartoes`.
- `app/(app)/financeiro/desembolsos/[id]/page.tsx` — se exibe forma_pagamento, mudar pra ler de `lancamentos_financeiros` da(s) baixa(s) OU exibir apenas "Definido na baixa" pra pendentes.

---

## Task 1: Migração aditiva — colunas em `lancamentos_financeiros` + comments

**Files:**
- Create: `supabase/migrations/20260825000001_lancamentos_forma.sql`
- Modify: `lib/types.ts` (adiciona 2 campos em `LancamentoFinanceiro`)

**Interfaces:**
- Consumes: enum `forma_pagamento` (já existe), tabela `cartoes_credito` (já existe).
- Produces:
  - Colunas `forma_pagamento` (nullable) e `cartao_credito_id` (nullable FK) em `lancamentos_financeiros`.
  - 2 índices parciais.
  - Comments atualizados em `contas_avulsas.forma_pagamento` e `contas_avulsas_recorrentes.forma_pagamento` (semântica "planejado").
  - Types TS: `LancamentoFinanceiro` ganha `forma_pagamento: FormaPagamento | null` e `cartao_credito_id: string | null`.

- [ ] **Step 1: Ler estado atual via MCP**

```sql
select
  (select count(*) from information_schema.columns
    where table_name='lancamentos_financeiros'
      and column_name in ('forma_pagamento','cartao_credito_id')) as cols_existentes,
  (select count(*) from lancamentos_financeiros) as total_lancamentos;
```

Esperado: `cols_existentes=0`, `total_lancamentos > 0` (histórico).

- [ ] **Step 2: Criar migration**

Arquivo: `supabase/migrations/20260825000001_lancamentos_forma.sql`

```sql
-- =====================================================================
-- forma_pagamento em lancamentos_financeiros + comments em avulsa/recorrencia.
-- Ver docs/superpowers/specs/2026-08-25-forma-pagamento-na-baixa-design.md.
--
-- Aditiva pura. Lancamentos anteriores a 25/08/2026 ficam com forma NULL —
-- documentado no comment da coluna, sem backfill.
-- =====================================================================

alter table lancamentos_financeiros
  add column if not exists forma_pagamento forma_pagamento null,
  add column if not exists cartao_credito_id uuid null
    references cartoes_credito(id) on delete restrict;

comment on column lancamentos_financeiros.forma_pagamento is
  'Forma efetivamente usada na baixa. Nulo em lançamentos anteriores a 25/08/2026 e em lançamentos de origem "manual" sem forma definida.';

comment on column lancamentos_financeiros.cartao_credito_id is
  'Cartão de crédito usado quando forma_pagamento = cartao_credito. Nulo caso contrário.';

create index if not exists idx_lancamentos_forma
  on lancamentos_financeiros (tenant_id, forma_pagamento)
  where forma_pagamento is not null;

create index if not exists idx_lancamentos_cartao
  on lancamentos_financeiros (tenant_id, cartao_credito_id)
  where cartao_credito_id is not null;

-- Comments em avulsa/recorrencia refletem semantica "planejado".
comment on column contas_avulsas.forma_pagamento is
  'Forma PLANEJADA na criação. A forma REALIZADA fica em lancamentos_financeiros; podem divergir.';

comment on column contas_avulsas_recorrentes.forma_pagamento is
  'Forma PLANEJADA no template. A forma REALIZADA da ocorrência fica em lancamentos_financeiros; podem divergir.';
```

- [ ] **Step 3: Aplicar via MCP**

Chamar `mcp__supabase-write__apply_migration` com name = `lancamentos_forma`.

- [ ] **Step 4: Conferir via MCP**

```sql
select
  (select count(*) from information_schema.columns
    where table_name='lancamentos_financeiros'
      and column_name in ('forma_pagamento','cartao_credito_id')) as cols_novas,
  (select count(*) from pg_indexes
    where indexname in ('idx_lancamentos_forma','idx_lancamentos_cartao')) as indices,
  (select count(*) from lancamentos_financeiros where forma_pagamento is not null) as com_forma;
```

Esperado: `cols_novas=2`, `indices=2`, `com_forma=0` (nenhum backfill).

- [ ] **Step 5: Atualizar `lib/types.ts`**

Localizar `interface LancamentoFinanceiro` (aproximadamente linha 1360). Adicionar antes de `estorno_de_lancamento_id`:

```typescript
  /**
   * Forma de pagamento efetivamente usada na baixa. Nulo em lançamentos
   * anteriores a 25/08/2026 e em origem 'manual' sem forma definida.
   */
  forma_pagamento: FormaPagamento | null;
  /** Cartão usado quando forma = cartao_credito. */
  cartao_credito_id: string | null;
```

- [ ] **Step 6: Verificar typecheck + lint**

`npm run typecheck && npm run lint`. Ambos passam (lint pode ter warnings pré-existentes em `combobox.tsx` e `multi-select.tsx`).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260825000001_lancamentos_forma.sql lib/types.ts
git commit -m "feat(financeiro): forma_pagamento em lancamentos_financeiros"
```

---

## Task 2: Migração — RPCs de baixa alteradas

**Files:**
- Create: `supabase/migrations/20260825000002_rpcs_forma_na_baixa.sql`

**Interfaces:**
- Consumes: colunas novas em `lancamentos_financeiros` (Task 1), enum `forma_pagamento`, tabelas de origem (`pedidos_compra_parcelas`, `contas_avulsas`, `desembolsos_parcelas`).
- Produces:
  - `dar_baixa_pp_parcela` — nova assinatura com `p_forma_pagamento forma_pagamento` (NOT NULL) + `p_cartao_credito_id uuid default null`.
  - `dar_baixa_desembolso_parcela` — idem.
  - `dar_baixa_avulsa_com_plano` — idem.
  - `dar_baixa_lote_cartao` — remove branches `pp` e `desembolso`; ganha parâmetro `p_cartao_credito_id uuid` (obrigatório, todo lote é 1 cartão); passa forma/cartão pra cada baixa interna.

- [ ] **Step 1: Ler estado atual das RPCs via MCP**

```sql
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where proname in ('dar_baixa_pp_parcela','dar_baixa_desembolso_parcela','dar_baixa_avulsa_com_plano','dar_baixa_lote_cartao');
```

Cole a saída no report — a nova migration preserva o corpo existente e adiciona 2 parâmetros na assinatura.

- [ ] **Step 2: Criar migration**

Arquivo: `supabase/migrations/20260825000002_rpcs_forma_na_baixa.sql`

```sql
-- =====================================================================
-- RPCs de baixa passam a receber e gravar forma_pagamento + cartao_credito_id.
-- dar_baixa_lote_cartao perde branches PP e Desembolso (agora aceita
-- só avulso/recorrencia; PP/Desembolso pendentes nao sabem forma).
-- Ver spec seção 3.6 e 3.7.
--
-- Depende de: 20260825000001 (colunas em lancamentos_financeiros).
-- =====================================================================

-- 1. dar_baixa_pp_parcela — nova assinatura com 2 parametros.
create or replace function dar_baixa_pp_parcela(
  p_parcela_id             uuid,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por             uuid,
  p_forma_pagamento        forma_pagamento,
  p_cartao_credito_id      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela        pedidos_compra_parcelas%rowtype;
  v_pp             pedidos_compra%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_total          integer;
  v_em_aberto      integer;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  -- Validacao coerencia forma <-> cartao
  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;

  select * into v_parcela from pedidos_compra_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  if not is_tenant_member(v_parcela.tenant_id) then
    raise exception 'Sem acesso a esta parcela.';
  end if;

  if v_parcela.pago_em is not null then
    raise exception 'Esta parcela já está paga.';
  end if;

  select * into v_pp from pedidos_compra where id = v_parcela.pedido_compra_id;
  if v_pp.status <> 'aprovada' then
    raise exception 'A PP precisa estar aprovada antes da baixa (status atual: %).', v_pp.status;
  end if;

  select * into v_conta from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_pp.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da PP.';
  end if;
  if not v_conta.ativo then raise exception 'Conta bancária está inativa.'; end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo from plano_contas_subtipos where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  select count(*)::int into v_total from pedidos_compra_parcelas where pedido_compra_id = v_pp.id;

  update pedidos_compra_parcelas
     set pago_em = p_pago_em, pago_por = p_criado_por
   where id = p_parcela_id;

  v_descricao := 'PP ' || v_pp.codigo || ' ' || v_parcela.numero || '/' || v_total
                 || ' — ' || substring(v_pp.servico, 1, 140);

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, pedido_compra_parcela_id,
    forma_pagamento, cartao_credito_id,
    origem, criado_por
  ) values (
    v_pp.tenant_id, v_pp.empresa_id, p_conta_bancaria_id, p_pago_em, v_parcela.valor,
    'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_pp.fornecedor_id, v_pp.job_id, v_pp.id, v_parcela.id,
    p_forma_pagamento, p_cartao_credito_id,
    'pp_baixa', p_criado_por
  )
  returning id into v_lancamento_id;

  select count(*)::int into v_em_aberto
    from pedidos_compra_parcelas
   where pedido_compra_id = v_pp.id and pago_em is null;

  if v_em_aberto = 0 then
    update pedidos_compra
       set status = 'pago', pago_em = p_pago_em, pago_por = p_criado_por
     where id = v_pp.id;
  end if;

  return v_lancamento_id;
end;
$$;

revoke execute on function dar_baixa_pp_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) from public;
grant execute on function dar_baixa_pp_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) to authenticated;


-- 2. dar_baixa_desembolso_parcela — mesma estrutura, 2 parametros novos.
create or replace function dar_baixa_desembolso_parcela(
  p_parcela_id             uuid,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por             uuid,
  p_forma_pagamento        forma_pagamento,
  p_cartao_credito_id      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela        desembolsos_parcelas%rowtype;
  v_desembolso     desembolsos%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_total          integer;
  v_em_aberto      integer;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;

  select * into v_parcela from desembolsos_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  if not is_tenant_member(v_parcela.tenant_id) then
    raise exception 'Sem acesso a esta parcela.';
  end if;

  if v_parcela.pago_em is not null then
    raise exception 'Esta parcela já está paga.';
  end if;

  select * into v_desembolso from desembolsos where id = v_parcela.desembolso_id;
  if v_desembolso.status <> 'aprovada' then
    raise exception 'O desembolso precisa estar aprovado antes da baixa (status atual: %).', v_desembolso.status;
  end if;

  select * into v_conta from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_desembolso.empresa_id then
    raise exception 'Conta bancária não pertence à empresa do desembolso.';
  end if;
  if not v_conta.ativo then raise exception 'Conta bancária está inativa.'; end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo from plano_contas_subtipos where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  select count(*)::int into v_total from desembolsos_parcelas where desembolso_id = v_desembolso.id;

  update desembolsos_parcelas
     set pago_em = p_pago_em, pago_por = p_criado_por
   where id = p_parcela_id;

  v_descricao := 'Desembolso ' || v_desembolso.codigo || ' ' || v_parcela.numero || '/' || v_total
                 || ' — ' || substring(v_desembolso.descricao, 1, 140);

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id,
    desembolso_id, desembolso_parcela_id,
    forma_pagamento, cartao_credito_id,
    origem, criado_por
  ) values (
    v_desembolso.tenant_id, v_desembolso.empresa_id, p_conta_bancaria_id, p_pago_em, v_parcela.valor,
    'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_desembolso.fornecedor_id, v_desembolso.cliente_id, v_desembolso.job_id,
    v_desembolso.id, v_parcela.id,
    p_forma_pagamento, p_cartao_credito_id,
    'desembolso_baixa', p_criado_por
  )
  returning id into v_lancamento_id;

  select count(*)::int into v_em_aberto
    from desembolsos_parcelas
   where desembolso_id = v_desembolso.id and pago_em is null;

  if v_em_aberto = 0 then
    update desembolsos
       set status = 'pago', pago_em = now(), pago_por = p_criado_por
     where id = v_desembolso.id;
  end if;

  return v_lancamento_id;
end;
$$;

revoke execute on function dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) from public;
grant execute on function dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) to authenticated;


-- 3. dar_baixa_avulsa_com_plano — mesma extensao.
create or replace function dar_baixa_avulsa_com_plano(
  p_conta_avulsa_id        uuid,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_forma_pagamento        forma_pagamento,
  p_cartao_credito_id      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid     uuid;
  v_avulsa         contas_avulsas%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_subtipo_tipo   uuid;
  v_descricao      text;
  v_lancamento_id  uuid;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;

  select * into v_avulsa from contas_avulsas where id = p_conta_avulsa_id;
  if not found then raise exception 'Conta avulsa não encontrada.'; end if;

  if not is_tenant_member(v_avulsa.tenant_id) then
    raise exception 'Sem permissão nesta conta avulsa.';
  end if;

  if v_avulsa.status <> 'aprovada' then
    raise exception 'Só avulsa aprovada pode ser baixada (status atual: %).', v_avulsa.status;
  end if;

  select * into v_conta from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_avulsa.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da conta avulsa.';
  end if;
  if not v_conta.ativo then raise exception 'Conta bancária está inativa.'; end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo from plano_contas_subtipos where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  update contas_avulsas
     set status = 'baixada', pago_em = p_pago_em, pago_por = v_caller_uid,
         conta_bancaria_baixa_id = p_conta_bancaria_id
   where id = p_conta_avulsa_id;

  v_descricao := 'Avulsa · ' || substring(v_avulsa.descricao, 1, 180);

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, conta_avulsa_id,
    forma_pagamento, cartao_credito_id,
    origem, criado_por
  ) values (
    v_avulsa.tenant_id, v_avulsa.empresa_id, p_conta_bancaria_id, p_pago_em, v_avulsa.valor,
    v_avulsa.natureza, v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_avulsa.fornecedor_id, v_avulsa.cliente_id, v_avulsa.job_id, v_avulsa.id,
    p_forma_pagamento, p_cartao_credito_id,
    'avulsa_baixa', v_caller_uid
  )
  returning id into v_lancamento_id;

  return v_lancamento_id;
end;
$$;

revoke execute on function dar_baixa_avulsa_com_plano(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid) from public;
grant execute on function dar_baixa_avulsa_com_plano(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid) to authenticated;


-- 4. dar_baixa_lote_cartao — remove branches PP/Desembolso, ganha p_cartao_credito_id.
create or replace function dar_baixa_lote_cartao(
  p_titulos                jsonb,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por             uuid,
  p_cartao_credito_id      uuid
) returns uuid[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_titulo jsonb;
  v_origem text;
  v_id uuid;
  v_lanc uuid;
  v_ids uuid[] := '{}';
begin
  if jsonb_typeof(p_titulos) <> 'array' then
    raise exception 'p_titulos deve ser array jsonb';
  end if;
  if jsonb_array_length(p_titulos) = 0 then
    raise exception 'Nenhum título selecionado';
  end if;
  if p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório na baixa em lote.';
  end if;

  for v_titulo in select * from jsonb_array_elements(p_titulos) loop
    v_origem := v_titulo->>'origem';
    v_id := (v_titulo->>'id')::uuid;

    if v_origem in ('avulso','recorrencia') then
      v_lanc := dar_baixa_avulsa_com_plano(
        v_id, p_pago_em,
        p_conta_bancaria_id, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
        'cartao_credito', p_cartao_credito_id
      );
    else
      raise exception 'Baixa em lote só aceita avulso e recorrencia (recebido: %).', v_origem;
    end if;

    v_ids := v_ids || v_lanc;
  end loop;

  return v_ids;
end;
$$;

revoke execute on function dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid, uuid) from public;
grant execute on function dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid, uuid) to authenticated;
```

- [ ] **Step 3: Aplicar via MCP**

`mcp__supabase-write__apply_migration` com name = `rpcs_forma_na_baixa`.

- [ ] **Step 4: Conferir via MCP**

```sql
-- Todas as 4 RPCs foram redefinidas com nova assinatura
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where proname in ('dar_baixa_pp_parcela','dar_baixa_desembolso_parcela','dar_baixa_avulsa_com_plano','dar_baixa_lote_cartao')
order by 1;
```

Esperado: `dar_baixa_avulsa_com_plano(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid default null)`, `dar_baixa_desembolso_parcela(...forma_pagamento, uuid default null)`, `dar_baixa_pp_parcela(...forma_pagamento, uuid default null)`, `dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid, uuid)`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260825000002_rpcs_forma_na_baixa.sql
git commit -m "feat(financeiro): RPCs de baixa gravam forma_pagamento e cartao"
```

---

## Task 3: Modal de baixa ganha `FormaPagamentoField` + server action estendida

**Files:**
- Modify: `components/financeiro/baixa-titulo-dialog.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-titulos.ts`
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-cartao.ts` (schema `origem` restringe pra `avulso`/`recorrencia`; passa `cartao_credito_id`)

**Interfaces:**
- Consumes: RPCs alteradas (Task 2), types `FormaPagamento` (já existe), `CartaoOption` (do `FormaPagamentoField`).
- Produces:
  - `BaixaTituloDialog` recebe prop `cartoes: CartaoOption[]` e origem-defaults (`forma_pagamento_planejada`, `cartao_credito_id_planejado`) pra pré-preencher em avulsa/recorrência.
  - `darBaixaTitulo` action Zod schema estendido com `forma_pagamento` (obrigatório, enum) + `cartao_credito_id` (uuid null); refinement de coerência.
  - `darBaixaLoteCartao` action rejeita PP e Desembolso na entrada; passa `cartao_credito_id` explicitamente.

- [ ] **Step 1: Ler estado atual dos arquivos afetados**

Ler:
- `components/financeiro/baixa-titulo-dialog.tsx` inteiro (entender estrutura, campos atuais).
- `components/financeiro/forma-pagamento-field.tsx` (interface pública).
- `app/(app)/financeiro/contas-a-pagar/actions-titulos.ts` (`baixaSchema` + `darBaixaTitulo`).
- `app/(app)/financeiro/contas-a-pagar/actions-cartao.ts` (`darBaixaLoteCartao` schema).
- `app/(app)/financeiro/contas-a-pagar/titulos-pagar-list.tsx` (como abre o dialog, o que passa).
- `app/(app)/financeiro/contas-a-pagar/page.tsx` (onde propaga props pra list).

- [ ] **Step 2: Estender `baixaSchema` em `actions-titulos.ts`**

Adicionar após `plano_conta_subtipo_id`:

```typescript
  forma_pagamento: z.enum(["pix","transferencia","boleto","cartao_credito"], {
    required_error: "Selecione a forma de pagamento.",
  }),
  cartao_credito_id: z.string().uuid().nullable().or(z.literal("").transform(() => null)),
```

Adicionar `.superRefine` no final do schema:

```typescript
}).superRefine((data, ctx) => {
  if (data.forma_pagamento === "cartao_credito" && !data.cartao_credito_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Selecione o cartão de crédito.",
      path: ["cartao_credito_id"],
    });
  } else if (data.forma_pagamento !== "cartao_credito" && data.cartao_credito_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cartão só pode ser informado quando a forma é cartão de crédito.",
      path: ["cartao_credito_id"],
    });
  }
});
```

- [ ] **Step 3: Atualizar chamada da RPC em `darBaixaTitulo`**

Cada branch (`pp`, `avulso`/`recorrencia`, `desembolso`) passa os 2 novos parâmetros pra RPC correspondente:

```typescript
// branch pp
const { data: lancId, error } = await supabase.rpc("dar_baixa_pp_parcela", {
  p_parcela_id: d.id,
  p_pago_em: d.pago_em,
  p_conta_bancaria_id: d.conta_bancaria_id,
  p_plano_conta_tipo_id: d.plano_conta_tipo_id,
  p_plano_conta_subtipo_id: d.plano_conta_subtipo_id,
  p_criado_por: session.profile.id,
  p_forma_pagamento: d.forma_pagamento,
  p_cartao_credito_id: d.cartao_credito_id,
});

// branch avulso/recorrencia
const { data: lancId, error } = await supabase.rpc("dar_baixa_avulsa_com_plano", {
  p_conta_avulsa_id: d.id,
  p_pago_em: d.pago_em,
  p_conta_bancaria_id: d.conta_bancaria_id,
  p_plano_conta_tipo_id: d.plano_conta_tipo_id,
  p_plano_conta_subtipo_id: d.plano_conta_subtipo_id,
  p_forma_pagamento: d.forma_pagamento,
  p_cartao_credito_id: d.cartao_credito_id,
});

// branch desembolso
const { data: lancId, error } = await supabase.rpc("dar_baixa_desembolso_parcela", {
  p_parcela_id: d.id,
  p_pago_em: d.pago_em,
  p_conta_bancaria_id: d.conta_bancaria_id,
  p_plano_conta_tipo_id: d.plano_conta_tipo_id,
  p_plano_conta_subtipo_id: d.plano_conta_subtipo_id,
  p_criado_por: session.profile.id,
  p_forma_pagamento: d.forma_pagamento,
  p_cartao_credito_id: d.cartao_credito_id,
});
```

Enriquecer metadata do audit com `forma_pagamento` e `cartao_credito_id` em cada `logAuditEvent`.

- [ ] **Step 4: Atualizar `actions-cartao.ts`**

Restringir `origem` no `tituloSchema`:

```typescript
const tituloSchema = z.object({
  origem: z.enum(["avulso","recorrencia"], {
    invalid_type_error: "Baixa em lote só aceita avulso e recorrência.",
  }),
  id: z.string().uuid(),
});
```

Chamada da RPC passa `p_cartao_credito_id`:

```typescript
const { data: ids, error } = await supabase.rpc("dar_baixa_lote_cartao", {
  p_titulos: d.titulos,
  p_pago_em: d.pago_em,
  p_conta_bancaria_id: d.conta_bancaria_id,
  p_plano_conta_tipo_id: d.plano_conta_tipo_id,
  p_plano_conta_subtipo_id: d.plano_conta_subtipo_id,
  p_criado_por: session.profile.id,
  p_cartao_credito_id: d.cartao_credito_id,
});
```

- [ ] **Step 5: Estender `BaixaTituloDialog`**

Adicionar props:

```typescript
interface Props {
  // ... existentes
  cartoes: CartaoOption[];
  formaPlanejada?: FormaPagamento | null;
  cartaoPlanejadoId?: string | null;
}
```

Adicionar `FormaPagamentoField` no form entre `conta_bancaria_id` e plano de contas. Estado inicial pré-preenchido com `formaPlanejada`/`cartaoPlanejadoId`. No submit, incluir os 2 novos campos no payload.

Ao mudar `onOpenChange`, resetar estado pra os planejados de novo (caso reabra outro título).

- [ ] **Step 6: Propagar `cartoes` prop até o dialog**

Em `page.tsx` de contas-a-pagar, a query `cartoesRes` já existe (feature de cartão). Passar para `<TitulosPagarList cartoes={...}>` e `<TitulosCartaoList cartoes={...}>` — verificar que já não passa; se sim, pular. Se não, adicionar.

`TitulosPagarList` passa `cartoes` para `<BaixaTituloDialog>` e também `formaPlanejada`/`cartaoPlanejadoId` do título selecionado (`baixando.forma_pagamento`/`baixando.cartao_credito_id` da row).

- [ ] **Step 7: Rodar typecheck + lint**

`npm run typecheck && npm run lint`. Passar.

- [ ] **Step 8: Commit**

```bash
git add components/financeiro/baixa-titulo-dialog.tsx \
        app/\(app\)/financeiro/contas-a-pagar/actions-titulos.ts \
        app/\(app\)/financeiro/contas-a-pagar/actions-cartao.ts \
        app/\(app\)/financeiro/contas-a-pagar/titulos-pagar-list.tsx \
        app/\(app\)/financeiro/contas-a-pagar/page.tsx
git commit -m "feat(financeiro): forma_pagamento no modal de baixa"
```

---

## Task 4: Coalescência do `TituloRow.forma_pagamento` em `page.tsx`

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx`

**Interfaces:**
- Consumes: colunas `forma_pagamento`/`cartao_credito_id` de `lancamentos_financeiros` (Task 1).
- Produces: `TituloRow.forma_pagamento` passa a ser "melhor esforço" (planejado pré-baixa, realizado pós-baixa).

- [ ] **Step 1: Localizar `baixasRes` no `Promise.all`**

Ler `page.tsx` — encontrar o SELECT em `lancamentos_financeiros` (busca por "lancamentos_financeiros" na linha ~110-130). Ele já lê `conta` e `tipo`/`subtipo` pra baixa mapada em `baixaPorParcela`/`baixaPorAvulsa`.

- [ ] **Step 2: Adicionar 2 colunas ao SELECT de baixas**

```typescript
supabase
  .from("lancamentos_financeiros")
  .select(`
    pedido_compra_parcela_id, conta_avulsa_id, desembolso_parcela_id, data_movimento,
    forma_pagamento, cartao_credito_id,
    conta:contas_bancarias(nome, banco),
    tipo:plano_contas_tipos(codigo),
    subtipo:plano_contas_subtipos(nome)
  `)
  .eq("tenant_id", session.activeTenant.id)
  .in("origem", ["pp_baixa", "avulsa_baixa", "desembolso_baixa"]),
```

- [ ] **Step 3: Estender o tipo `BaixaInfo` inline no map**

Onde `baixaPorParcela` etc são construídas, adicionar aos objetos:

```typescript
const info: BaixaInfo = {
  pago_em: l.data_movimento,
  conta: /* ... */,
  centro: /* ... */,
  forma_pagamento: l.forma_pagamento as FormaPagamento | null,
  cartao_credito_id: l.cartao_credito_id as string | null,
};
```

Estender `type BaixaInfo` no topo da função:

```typescript
type BaixaInfo = {
  pago_em: string;
  conta: string;
  centro: string;
  forma_pagamento: FormaPagamento | null;
  cartao_credito_id: string | null;
};
```

- [ ] **Step 4: Coalescer em cada loop que constrói `TituloRow`**

Para os loops de **PP** e **Desembolso**, a coalescência é: se pago, usa do lançamento; senão, `null`.

```typescript
// dentro do loop de PP-parcela:
titulos.push({
  // ... campos existentes
  forma_pagamento: par.pago_em
    ? baixaPorParcela.get(par.id)?.forma_pagamento ?? null
    : null,
  cartao_credito_id: par.pago_em
    ? baixaPorParcela.get(par.id)?.cartao_credito_id ?? null
    : null,
});

// dentro do loop de Desembolso-parcela:
titulos.push({
  // ... campos existentes
  forma_pagamento: par.pago_em
    ? baixaPorDesembolsoParcela.get(par.id)?.forma_pagamento ?? null
    : null,
  cartao_credito_id: par.pago_em
    ? baixaPorDesembolsoParcela.get(par.id)?.cartao_credito_id ?? null
    : null,
});
```

Para os loops de **avulsa** e **recorrência**, coalescer com "planejada vs realizada":

```typescript
// dentro do loop de avulsa (e recorrência via mesmo objeto):
const baixa = baixaPorAvulsa.get(a.id);
titulos.push({
  // ... campos existentes
  forma_pagamento: a.pago_em
    ? baixa?.forma_pagamento ?? a.forma_pagamento
    : a.forma_pagamento,
  cartao_credito_id: a.pago_em
    ? baixa?.cartao_credito_id ?? a.cartao_credito_id
    : a.cartao_credito_id,
});
```

- [ ] **Step 5: Rodar typecheck + lint**

`npm run typecheck && npm run lint`. Passar.

- [ ] **Step 6: Smoke via MCP (opcional)**

```sql
-- Confirma que baixas antigas (se houver) têm forma_pagamento NULL
select origem, count(*), count(forma_pagamento) as com_forma
from lancamentos_financeiros
where origem in ('pp_baixa','avulsa_baixa','desembolso_baixa')
group by origem;
```

Esperado: `com_forma < count(*)` — histórico ficou NULL, novos preenchidos.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/page.tsx
git commit -m "feat(financeiro): TituloRow coalesce forma planejada vs realizada"
```

---

## Task 5: Remove `FormaPagamentoField` do form de PP + chain de props

**Files:**
- Modify: `app/(app)/jobs/[jobId]/realizado/gerar-pp-drawer.tsx`
- Modify: `app/(app)/jobs/[jobId]/realizado/actions-pp.ts`
- Modify: `app/(app)/jobs/[jobId]/page.tsx`
- Modify: `app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx`
- Modify: `app/(app)/jobs/[jobId]/realizado/job-grupo-card.tsx`
- Modify: `app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx`
- Modify: `app/(app)/financeiro/abertura-de-job/[jobId]/planilha/page.tsx` (call site read-only que passa `cartoes={[]}`)

**Interfaces:**
- Consumes: nada novo.
- Produces: PP volta ao comportamento pré-cartão. Não guarda mais forma. Datas de parcelas totalmente manuais.

- [ ] **Step 1: Ler estrutura atual**

Ler `gerar-pp-drawer.tsx` inteiro. Identificar:
- Import de `FormaPagamentoField` + `CartaoOption`.
- Estado `formaPagamento`, `cartaoCreditoId`.
- Prop `cartoes`.
- Função `handleFormaPagamentoChange`.
- Chamada de `parcelasParaFatura` (auto-preenchimento em `mudarNumeroDeParcelas`).
- Payload de submit com `forma_pagamento`/`cartao_credito_id`.

- [ ] **Step 2: Remover do drawer**

Deletar:
- Import de `FormaPagamentoField` e `CartaoOption`.
- Import de `parcelasParaFatura`, `formatarISO` (se só usados em auto-preenchimento).
- Prop `cartoes: CartaoOption[]` da interface `Props`.
- Estado `formaPagamento` e `cartaoCreditoId`.
- Função `handleFormaPagamentoChange`.
- Bloco JSX que renderiza `<FormaPagamentoField>`.
- Ramo de auto-preenchimento em `mudarNumeroDeParcelas` que chama `parcelasParaFatura` — mantém só a divisão de valor (parcelas ganham data única default = data prazo negociado com fornecedor, editável).
- Campos `forma_pagamento`/`cartao_credito_id` do payload submit.

- [ ] **Step 3: Remover Zod + INSERT em `actions-pp.ts`**

Localizar `dadosBaseSchema` (ou nome do schema base). Deletar:
- Campos `forma_pagamento` e `cartao_credito_id`.
- Bloco `superRefine` de coerência cartão.
- Import de `parcelasParaFatura`/`formatarISO` se ficarem órfãos.

Localizar INSERT em `pedidos_compra` (`finalizarPedidoCompra` ou nome similar). Remover:
- Colunas `forma_pagamento` e `cartao_credito_id` do payload.

- [ ] **Step 4: Remover chain de `cartoes` prop**

Em `jobs/[jobId]/page.tsx`: remover SELECT `cartoes_credito` do `Promise.all`. Remover linhas que constroem `cartoes` array. Remover `cartoes` da prop passada para `<JobRealizadoSection>`.

Em `job-realizado-section.tsx`, `job-grupo-card.tsx`, `job-item-realizado-table.tsx`: remover `cartoes` da interface `Props` e da chamada aos filhos.

Em `abertura-de-job/[jobId]/planilha/page.tsx` (leitura de PPs — read-only): remover `cartoes={[]}` do call site do `<JobGrupoCard>`.

- [ ] **Step 5: Rodar typecheck + lint**

`npm run typecheck && npm run lint`. Passar. Se algum call site esquecido de `cartoes` quebrar, corrigir.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/jobs/\[jobId\]/ \
        app/\(app\)/financeiro/abertura-de-job/\[jobId\]/planilha/page.tsx
git commit -m "feat(financeiro): remove forma_pagamento do form de emissao de PP"
```

---

## Task 6: Remove `FormaPagamentoField` do form de Desembolso + chain de props

**Files:**
- Modify: `app/(app)/financeiro/desembolsos/desembolso-drawer.tsx`
- Modify: `app/(app)/financeiro/desembolsos/actions.ts`
- Modify: `app/(app)/financeiro/desembolsos/page.tsx`
- Modify: `app/(app)/financeiro/desembolsos/desembolsos-list.tsx`
- Modify: `app/(app)/financeiro/desembolsos/[id]/page.tsx` (se exibe forma_pagamento — mudar pra ler do lançamento OU exibir "definido na baixa")
- Modify: `app/(app)/financeiro/contas-a-pagar/desembolsos-list.tsx` (se exibe forma — idem)

**Interfaces:**
- Consumes: nada novo.
- Produces: Desembolso volta a nascer sem forma.

- [ ] **Step 1: Ler estrutura atual**

Ler `desembolso-drawer.tsx` inteiro (mesmo padrão da Task 5 pra PP).

- [ ] **Step 2: Remover do drawer**

Mesmas remoções da Task 5 no drawer de PP:
- Imports.
- Prop `cartoes`.
- Estado `formaPagamento`/`cartaoCreditoId`.
- `handleFormaPagamentoChange`.
- JSX do `<FormaPagamentoField>`.
- Auto-preenchimento de datas em `handleParcelasQuantidade` (se houver).
- Campos do payload.

- [ ] **Step 3: Remover Zod + INSERT em `desembolsos/actions.ts`**

Em `criarDesembolsoSchema`:
- Remover `forma_pagamento` e `cartao_credito_id`.
- Remover superRefine de coerência cartão (mantém o de rateio 100 + coerência de parcelas).

Em `criarDesembolso`:
- Payload do INSERT sem os 2 campos.

- [ ] **Step 4: Remover fetch e chain de `cartoes`**

Em `desembolsos/page.tsx`: remover SELECT `cartoes_credito` do `Promise.all`; remover mapeamento pra `cartoes`; remover prop `cartoes` passada pra `<DesembolsosList>`.

Em `desembolsos-list.tsx`: remover prop `cartoes` da interface e da chamada ao `<DesembolsoDrawer>`.

- [ ] **Step 5: Ajustar página de detalhe**

Em `desembolsos/[id]/page.tsx`: se hoje exibe `forma_pagamento` do desembolso, adaptar. Duas opções:

**A) Ler do lançamento**: buscar baixas do desembolso via `lancamentos_financeiros` (join por `desembolso_id`), exibir a forma real (que agora está lá). Se ainda não pago, exibe "Definido na baixa".

**B) Simplesmente remover a exibição**: valor da forma some da tela; user vê forma apenas em Contas a Pagar / Títulos Pagos.

Recomendação: **A**. Página de detalhe mostra por parcela: se paga, forma da baixa; se pendente, "—" ou "Definido na baixa".

- [ ] **Step 6: Ajustar list em contas-a-pagar (se aplicável)**

Em `contas-a-pagar/desembolsos-list.tsx` (aba "Pedidos de Desembolsos"): se hoje mostra forma como coluna, remover — pendentes não têm forma.

- [ ] **Step 7: Rodar typecheck + lint**

`npm run typecheck && npm run lint`. Passar.

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/financeiro/desembolsos/ \
        app/\(app\)/financeiro/contas-a-pagar/desembolsos-list.tsx
git commit -m "feat(financeiro): remove forma_pagamento do form de desembolso"
```

---

## Task 7: Migração destrutiva — DROP COLUMN em PP e Desembolso

**Files:**
- Create: `supabase/migrations/20260825000003_drop_forma_pp_desembolso.sql`
- Modify: `lib/types.ts` (remove 2 campos de `PedidoCompra` e `Desembolso`)

**Interfaces:**
- Consumes: nada — depende de nenhum consumer ler as colunas mais (Tasks 5 e 6 já removeram).
- Produces: schema limpo — colunas somem.

**⚠️ Destrutiva — user já confirmou no spec. Antes de aplicar, RODAR SELECT de contagem de linhas com valor não-null pra logar no report.**

- [ ] **Step 1: Ler quantas linhas têm valor preenchido (auditoria pré-drop)**

```sql
select
  (select count(*) from pedidos_compra where forma_pagamento is not null) as pps_com_forma,
  (select count(*) from pedidos_compra where cartao_credito_id is not null) as pps_com_cartao,
  (select count(*) from desembolsos where forma_pagamento is not null) as desembolsos_com_forma,
  (select count(*) from desembolsos where cartao_credito_id is not null) as desembolsos_com_cartao;
```

Cole a saída no report. Se algum número for muito alto (dezenas), **pausar e conferir com o user** antes de aplicar — pode ser que a decisão precise revisitar. Se for 0 ou poucos (teste), prosseguir.

- [ ] **Step 2: Criar migration**

Arquivo: `supabase/migrations/20260825000003_drop_forma_pp_desembolso.sql`

```sql
-- =====================================================================
-- DROP forma_pagamento e cartao_credito_id de pedidos_compra e desembolsos.
-- Ver docs/superpowers/specs/2026-08-25-forma-pagamento-na-baixa-design.md.
--
-- DESTRUTIVA. User confirmou explicitamente no spec (seção 3.1). Aplicada
-- por último na sequência: se algo desse errado nos passos anteriores,
-- dava pra reverter sem perder dados. Nesse ponto, todo consumidor das
-- colunas já foi removido (Tasks 5 e 6).
-- =====================================================================

alter table pedidos_compra
  drop constraint if exists chk_pp_cartao,
  drop column if exists cartao_credito_id,
  drop column if exists forma_pagamento;

drop index if exists idx_pp_cartao;

alter table desembolsos
  drop constraint if exists chk_desembolso_cartao,
  drop column if exists cartao_credito_id,
  drop column if exists forma_pagamento;

drop index if exists idx_desembolsos_cartao;
```

- [ ] **Step 3: Aplicar via MCP**

`mcp__supabase-write__apply_migration` com name = `drop_forma_pp_desembolso`.

- [ ] **Step 4: Conferir**

```sql
select
  (select count(*) from information_schema.columns
    where table_name='pedidos_compra'
      and column_name in ('forma_pagamento','cartao_credito_id')) as pp_cols_restantes,
  (select count(*) from information_schema.columns
    where table_name='desembolsos'
      and column_name in ('forma_pagamento','cartao_credito_id')) as des_cols_restantes,
  (select count(*) from pg_indexes
    where indexname in ('idx_pp_cartao','idx_desembolsos_cartao')) as indices_restantes,
  (select count(*) from pg_constraint
    where conname in ('chk_pp_cartao','chk_desembolso_cartao')) as constraints_restantes;
```

Esperado: todas as 4 contagens = 0.

- [ ] **Step 5: Atualizar `lib/types.ts`**

Em `PedidoCompra`: remover as 2 linhas:
```typescript
  forma_pagamento: FormaPagamento | null;
  cartao_credito_id: string | null;
```

Em `Desembolso`: idem.

- [ ] **Step 6: Rodar typecheck + lint**

`npm run typecheck && npm run lint`. Se algum consumer esquecido ler essas colunas, o TypeScript vai reclamar. Corrigir.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260825000003_drop_forma_pp_desembolso.sql lib/types.ts
git commit -m "feat(financeiro): drop forma_pagamento de PP e desembolso"
```

---

## Task 8: Verificação final E2E

**Files:** nenhum — só verificação.

- [ ] **Step 1: `npm run typecheck && npm run lint && npm run build`**

Todos limpos. Corrigir eventuais warnings novos.

- [ ] **Step 2: MCP — confirmar estado final do banco**

```sql
-- Colunas removidas
select table_name, column_name
from information_schema.columns
where table_name in ('pedidos_compra','desembolsos')
  and column_name in ('forma_pagamento','cartao_credito_id');
-- esperado: 0 linhas

-- Colunas adicionadas
select column_name from information_schema.columns
where table_name='lancamentos_financeiros'
  and column_name in ('forma_pagamento','cartao_credito_id');
-- esperado: 2 linhas

-- RPCs com nova assinatura
select proname, pg_get_function_identity_arguments(oid)
from pg_proc
where proname in ('dar_baixa_pp_parcela','dar_baixa_desembolso_parcela','dar_baixa_avulsa_com_plano','dar_baixa_lote_cartao');
-- esperado: 4 linhas, cada uma com nova assinatura
```

- [ ] **Step 3: E2E via UI (roteiro)**

Login como admin/financeiro. Executar:

1. **PP nova** — criar PP em qualquer job. Verificar que **não aparece** campo "Forma de pagamento" no drawer.
2. **Aprovar PP** — abrir aba PPs em contas-a-pagar, aprovar com data.
3. **Baixar PP no cartão** — abrir aba "Títulos a Pagar", clicar em baixar de uma parcela. Modal aparece com campo "Forma de pagamento" **vazio, obrigatório**. Selecionar Cartão de Crédito → aparece combobox de cartão. Selecionar cartão, conta, plano de contas, confirmar.
4. Voltar em "Títulos a Pagar" filtro "Pagos" — parcela **não aparece** (foi pra Cartão).
5. Ir na aba "Cartão" filtro "Pagos" — parcela **aparece** com tag do cartão selecionado.
6. **Desembolso novo** — criar desembolso via `/financeiro/desembolsos`. Verificar que **não aparece** campo "Forma de pagamento" no drawer.
7. **Aprovar + baixar em PIX** — mesmo fluxo, mas escolher PIX no modal. Verificar aparição em "Títulos a Pagar" filtro "Pagos".
8. **Avulsa cartão** — criar avulsa marcando cartão. Aparece em "Cartão" filtro "A pagar".
9. **Baixar avulsa mudando forma** — abrir modal de baixa. Campo vem pré-preenchido "Cartão". **Trocar** pra PIX. Confirmar. Verificar que avulsa aparece em "Títulos a Pagar" filtro "Pagos" (não em Cartão — porque a REALIZADA venceu a PLANEJADA).
10. **Lote de cartão** — criar 2 avulsas no mesmo cartão. Ir na aba "Cartão", selecionar as 2, baixar em lote. Confirmar sucesso.

- [ ] **Step 4: Consultar `lancamentos_financeiros` para verificar rastreabilidade**

```sql
-- Ver as baixas dos últimos 10 minutos com forma preenchida
select id, origem, forma_pagamento, cartao_credito_id, valor, data_movimento
from lancamentos_financeiros
where data_movimento >= current_date - 1
  and forma_pagamento is not null
order by created_at desc
limit 20;
```

Cada baixa nova deve ter `forma_pagamento` preenchida; cartões têm `cartao_credito_id`.

- [ ] **Step 5: Consultar auditoria**

```sql
select acao, metadata->>'forma_pagamento' as forma, count(*)
from audit_events
where acao in ('pedido_compra.parcela_paga','conta_avulsa.baixada','desembolso.parcela_paga')
  and created_at >= current_date - 1
group by acao, metadata->>'forma_pagamento'
order by 1, 2;
```

Metadata deve mostrar `forma_pagamento` nos eventos novos.

- [ ] **Step 6: Commit final (só se algo precisou ajustar durante E2E)**

Se o smoke gerou correções, commitar. Senão, feature completa.

---

## Self-Review

**1. Spec coverage:**

- Spec §3.1 (remove colunas de PP/Desembolso) → Task 7.
- Spec §3.2 (add colunas em `lancamentos_financeiros`) → Task 1.
- Spec §3.3 (mantém em avulsa/recorrência + comments) → Task 1 (comments incluídos).
- Spec §3.4 (modal de baixa único ganha `FormaPagamentoField`) → Task 3.
- Spec §3.5 (coalescência TituloRow) → Task 4.
- Spec §3.6 (RPCs de baixa ganham 2 parâmetros) → Task 2.
- Spec §3.7 (RPC lote cartão perde branches PP/Desembolso) → Task 2 (incluído).
- Spec §3.8 (remove FormaPagamentoField dos forms de PP/Desembolso) → Tasks 5 e 6.
- Spec §3.9 (auditoria metadata enriquecida) → Task 3 (audit dentro de `darBaixaTitulo`).
- Spec §4.1-4.4 (migrations) → Tasks 1, 2, 7.
- Spec §4.5 (types) → Task 1 (LancamentoFinanceiro), Task 7 (PP/Desembolso).
- Spec §5.1 (modal) → Task 3.
- Spec §5.2 (forms PP/Desembolso perdem campo) → Tasks 5 e 6.
- Spec §5.3 (TitulosCartaoList) → coberto pela restrição no schema Zod da action (Task 3) — nenhuma mudança lógica no componente é necessária além do que já funciona.
- Spec §5.4 (Títulos Pagos exibe forma real) → naturalmente resolvido pelo Task 4 (o `TituloRow.forma_pagamento` passa a vir do lançamento quando pago); UI de exibição fica se algum badge tiver que ser adicionado — a decidir durante Task 4 ou Task 8 se aparecer necessidade visual.

**2. Placeholder scan:** nenhum "TBD"/"TODO"/"implement later". Todos os blocos de código têm conteúdo real. As Tasks 5 e 6 têm passos "Ler estrutura atual" mas fazem sentido porque cada drawer tem sua estrutura própria e a remoção precisa ser cirúrgica.

**3. Type consistency:**
- `FormaPagamento` union (já existe em `lib/types.ts`) — reutilizado em toda tarefa.
- Assinaturas RPC — Tasks 2 (definição) e 3 (chamada) usam os mesmos nomes de parâmetro (`p_forma_pagamento`, `p_cartao_credito_id`).
- `BaixaInfo` (Task 4) estendido consistentemente onde consumido.
- `TituloRow.forma_pagamento` continua com o mesmo shape — só a origem do valor muda (Task 4).

Consistente.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-25-forma-pagamento-na-baixa.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
