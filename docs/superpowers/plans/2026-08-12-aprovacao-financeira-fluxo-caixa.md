# Aprovação financeira e Fluxo de Caixa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar o estado `aprovada` como etapa obrigatória antes da baixa financeira (para PP e conta avulsa), criar a tela "A pagar" (onde acontece a baixa), a tela "Fluxo de caixa" (previsto + realizado) e manter a Conciliação intocada.

**Architecture:** Migração de enum em duas etapas (safe two-step) pra renomear `pendente` → `aprovada` em `contas_avulsas` sem quebrar quem já usa. Novo status `aprovada` em `pedidos_compra` entre `em_avaliacao` e `pago`. Views SQL (`vw_a_pagar`, `vw_fluxo_caixa`) unificam previsto e realizado com colunas normalizadas. As telas novas moram em `app/(app)/financeiro/a-pagar` e `app/(app)/financeiro/fluxo-caixa` e aparecem como cards em `/financeiro`. Endurecimento de RPCs (`dar_baixa_*` exigir `aprovada`) fica no fim, depois do front migrar, pra não introduzir janela quebrada.

**Tech Stack:** Next.js App Router + TypeScript, Supabase (Postgres + RLS), React Hook Form + Zod, Tailwind + shadcn/ui, lucide-react. Migrations em `supabase/migrations/` versionadas + aplicadas via `mcp__supabase-write__apply_migration`.

## Global Constraints

- **Ortografia pt-BR:** toda string visível ao usuário com acentos/cedilha. Identificadores em código sem acento por convenção.
- **Performance (docs/PERFORMANCE.md):** `<Link>` de listas com 5+ itens → `prefetch={false}`; queries independentes em server component → `Promise.all`; toda migration nova → `grant` explícito pra `authenticated` + índice em FK importante + policies RLS usam `(select auth.uid())`.
- **RLS:** toda tabela operacional tem `tenant_id`. Nenhuma nova tabela nesta task, mas nova view precisa `grant select on ... to authenticated` (a RLS herda das tabelas subjacentes).
- **Server actions:** operações sensíveis vão por `"use server"` + gate `checarGateFinanceiro` (padrão já em `app/(app)/financeiro/contas-a-pagar/actions.ts`).
- **Auditoria:** usar `logAuditEvent` (padrão em `lib/auth/audit`) pra cada aprovação/desaprovação/baixa/estorno.
- **Rebuild types:** após cada migration, rodar `mcp__supabase-write__generate_typescript_types` e atualizar `lib/database.types.ts` (se o projeto tiver esse arquivo — se não tiver, ignorar).
- **Idempotência de migration:** usar `do $$ ... exception when duplicate_object ...` pra enums; `add column if not exists`; `create ... if not exists`.
- **Commits:** pequenos e descritivos, um por task. Nunca commitar `.env.local`.
- **Testes:** o projeto não tem suite automatizada. Validação por task: (a) `npm run lint`, (b) `npm run build`, (c) queries SQL de verificação listadas em cada task, (d) smoke manual quando envolver UI.

---

## File Structure

**Migrations SQL** (`supabase/migrations/`)

- `20260812000001_pp_status_aprovada.sql` — enum + colunas + RPCs `aprovar_pp` e `desaprovar_pp`.
- `20260812000002_avulsa_status_aprovada.sql` — Migration A: adiciona `aprovada` no enum de avulsa, migra `pendente → aprovada`, adiciona colunas de auditoria, muda default, ajusta constraint.
- `20260812000003_recorrentes_nascem_aprovadas.sql` — reescreve `gerar_ocorrencias_recorrentes` pra criar instâncias `aprovada`.
- `20260812000004_vw_fluxo_caixa_e_a_pagar.sql` — views + índices partial + grants.
- `20260812000005_baixa_rpcs_exigem_aprovada.sql` — endurece `dar_baixa_pp`, `estornar_baixa_pp`, `dar_baixa_avulsa`, `estornar_baixa_avulsa`.
- `20260812000006_avulsa_status_remove_pendente.sql` — Migration B: recria enum sem `pendente`.

**Front-end** (`app/(app)/financeiro/`)

- **Modificar:** `contas-a-pagar/actions.ts` — adiciona `aprovarPP` e `desaprovarPP`. `marcarPagaFinanceiro` migra pra `a-pagar/actions.ts`.
- **Modificar:** `contas-a-pagar/page.tsx` — muda header ("Caixa de entrada"), atualiza descrições, ajusta contadores.
- **Modificar:** `contas-a-pagar/pedidos-compra-list.tsx` — remove ação "Dar baixa", adiciona "Aprovar" + "Desaprovar" (esta última em PPs `aprovada` visíveis se filtro incluir).
- **Modificar:** `contas-a-pagar/avulsas-list.tsx` — remove ação "Dar baixa" (migra pra A pagar).
- **Modificar:** `contas-a-pagar/avulsas-actions.ts` (se existir; senão em `actions-avulsas.ts`) — troca `pendente` por `aprovada` nas checagens.
- **Criar:** `a-pagar/page.tsx` — server component com lista PPs `aprovada` + avulsas `aprovada`, com baixa.
- **Criar:** `a-pagar/actions.ts` — importa `marcarPagaFinanceiro` (movida) + baixa de avulsa.
- **Criar:** `a-pagar/lista-a-pagar.tsx` — client component com tabela + ação "Dar baixa" + filtros.
- **Criar:** `fluxo-caixa/page.tsx` — server component lendo `vw_fluxo_caixa`.
- **Criar:** `fluxo-caixa/fluxo-caixa-view.tsx` — client component com toggle dia/semana/mês.
- **Modificar:** `financeiro/page.tsx` (landing) — adicionar 2 cards ("A pagar", "Fluxo de caixa"), renomear "Contas a Pagar" → "Caixa de entrada" e ajustar descrição/contagem.
- **Modificar:** `lib/types.ts` — atualizar enum `PPStatus` (adicionar `aprovada`) e `contas_avulsas` status (`aprovada` no lugar de `pendente`).

---

## Task 1: Migration PP — status `aprovada`, auditoria, RPCs `aprovar_pp` e `desaprovar_pp`

**Files:**
- Create: `supabase/migrations/20260812000001_pp_status_aprovada.sql`
- Modify: `lib/types.ts` (atualizar enum `PPStatus`)

**Interfaces:**
- Consumes: nada (base).
- Produces:
  - Enum `pp_status` ganha valor `'aprovada'`.
  - Colunas em `pedidos_compra`: `aprovada_em timestamptz null`, `aprovada_por uuid null references profiles(id)`.
  - RPC `public.aprovar_pp(p_pp_id uuid) returns void` — muda `em_avaliacao → aprovada`.
  - RPC `public.desaprovar_pp(p_pp_id uuid, p_motivo text) returns void` — muda `aprovada → em_avaliacao`; limpa `aprovada_em`/`aprovada_por`.
  - Type TS: `type PPStatus = "em_avaliacao" | "aprovada" | "pago" | "rejeitada" | "cancelada"`.

- [ ] **Step 1: Criar arquivo de migration**

Criar `supabase/migrations/20260812000001_pp_status_aprovada.sql`:

```sql
-- =====================================================================
-- Aprovação financeira PP — status 'aprovada' + colunas + RPCs
-- Ver spec: docs/superpowers/specs/2026-08-12-aprovacao-financeira-fluxo-caixa-design.md
-- =====================================================================

-- 1. Adiciona 'aprovada' ao enum pp_status (regra do Postgres: valor não pode
-- ser usado na mesma transação em que é ADDed — a Task 2+ é que usa)
alter type pp_status add value if not exists 'aprovada' before 'pago';

-- 2. Colunas de auditoria da aprovação
alter table public.pedidos_compra
  add column if not exists aprovada_em timestamptz,
  add column if not exists aprovada_por uuid references public.profiles(id);

-- 3. Índice partial pra listagem "A pagar" (PPs aprovadas por vencimento)
create index if not exists idx_pp_aprovada_prazo
  on public.pedidos_compra(tenant_id, prazo_pagamento_financeiro)
  where status = 'aprovada';
```

- [ ] **Step 2: Aplicar migration via MCP**

```
mcp__supabase-write__apply_migration
  name: pp_status_aprovada
  query: <conteúdo do arquivo acima>
```

- [ ] **Step 3: Criar migration com as RPCs (arquivo separado pra separar DDL de function)**

Ainda no mesmo passo lógico, adicionar ao final do arquivo `20260812000001_pp_status_aprovada.sql`:

```sql
-- 4. RPC aprovar_pp
create or replace function public.aprovar_pp(p_pp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp        pedidos_compra%rowtype;
  v_user_id   uuid := auth.uid();
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if not public.is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem acesso a esta PP.';
  end if;
  if v_pp.status <> 'em_avaliacao' then
    raise exception 'PP precisa estar em avaliação (status atual: %).', v_pp.status;
  end if;

  update public.pedidos_compra
     set status = 'aprovada',
         aprovada_em = now(),
         aprovada_por = v_user_id
   where id = p_pp_id;
end;
$$;

grant execute on function public.aprovar_pp(uuid) to authenticated;

-- 5. RPC desaprovar_pp — devolve pra em_avaliacao com motivo
create or replace function public.desaprovar_pp(p_pp_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp        pedidos_compra%rowtype;
begin
  if p_motivo is null or length(trim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if not public.is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem acesso a esta PP.';
  end if;
  if v_pp.status <> 'aprovada' then
    raise exception 'PP não está aprovada (status atual: %).', v_pp.status;
  end if;

  update public.pedidos_compra
     set status = 'em_avaliacao',
         aprovada_em = null,
         aprovada_por = null
   where id = p_pp_id;
end;
$$;

grant execute on function public.desaprovar_pp(uuid, text) to authenticated;
```

Aplicar via `mcp__supabase-write__apply_migration` com name `pp_rpcs_aprovar_desaprovar`.

- [ ] **Step 4: Atualizar `lib/types.ts` — enum PPStatus**

Achar a definição de `PPStatus` em `lib/types.ts` e adicionar `"aprovada"`:

```typescript
// antes:
// export type PPStatus = "em_avaliacao" | "pago" | "rejeitada" | "cancelada";

// depois:
export type PPStatus = "em_avaliacao" | "aprovada" | "pago" | "rejeitada" | "cancelada";
```

Se existir `PP_STATUS_LABEL` (map de rótulos), adicionar entry `aprovada: "Aprovada"`.

- [ ] **Step 5: Verificação SQL**

```sql
-- Enum contém aprovada?
select unnest(enum_range(null::pp_status))::text as status;
-- Deve listar: em_avaliacao, aprovada, pago, rejeitada, cancelada

-- Colunas existem?
select column_name from information_schema.columns
where table_name = 'pedidos_compra'
  and column_name in ('aprovada_em', 'aprovada_por');

-- RPCs existem?
select proname from pg_proc where proname in ('aprovar_pp', 'desaprovar_pp');
```

- [ ] **Step 6: Verificação build**

```powershell
npm run lint; if ($?) { npm run build }
```

Erros esperados: nenhum (tipos ficaram compatíveis; nada mais consome `aprovada` ainda).

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/20260812000001_pp_status_aprovada.sql lib/types.ts
git commit -m @'
task015: PP ganha status aprovada + RPCs aprovar_pp e desaprovar_pp

Adiciona valor `aprovada` no enum pp_status entre em_avaliacao e pago,
colunas aprovada_em/aprovada_por, índice partial e as RPCs de aprovação
e desaprovação. Front ainda não usa — sem quebra.
'@
```

---

## Task 2: Migration A avulsa — adiciona `aprovada`, migra `pendente → aprovada`

**Files:**
- Create: `supabase/migrations/20260812000002_avulsa_status_aprovada.sql`
- Modify: `lib/types.ts` (enum de status avulsa se existir; senão só database.types)

**Interfaces:**
- Consumes: enum `conta_avulsa_status` (`'pendente'`, `'baixada'`).
- Produces:
  - Enum `conta_avulsa_status` ganha `'aprovada'`. `'pendente'` continua existindo (removido só na Task 11).
  - Todos os `contas_avulsas` com `status='pendente'` viram `'aprovada'`.
  - Default da coluna passa a ser `'aprovada'`.
  - Colunas em `contas_avulsas`: `aprovada_em timestamptz null`, `aprovada_por uuid null references profiles(id)`.
  - Retro fill: linhas migradas ganham `aprovada_em = created_at`, `aprovada_por = criado_por`.
  - Constraint `chk_avulsa_aprovada_consistente` — quando `status in ('aprovada','baixada')`, exige `aprovada_em` e `aprovada_por`.

- [ ] **Step 1: Criar migration**

`supabase/migrations/20260812000002_avulsa_status_aprovada.sql`:

```sql
-- =====================================================================
-- Contas avulsas: renomear pendente -> aprovada (Migration A: safe add)
-- Ver spec: docs/superpowers/specs/2026-08-12-aprovacao-financeira-fluxo-caixa-design.md
-- Migration B (remoção de 'pendente') vem na task 11, depois do código migrar.
-- =====================================================================

-- 1. Adiciona valor 'aprovada' ao enum (não pode ser usado na mesma transação)
alter type conta_avulsa_status add value if not exists 'aprovada' before 'baixada';
```

Aplicar via `mcp__supabase-write__apply_migration` com name `avulsa_status_aprovada_add`.

- [ ] **Step 2: Segunda parte da migration (numa segunda apply, pra permitir uso do valor)**

Criar arquivo separado `supabase/migrations/20260812000002b_avulsa_status_aprovada_fill.sql` (o suffix `b` é convenção interna pra manter a ordem):

```sql
-- =====================================================================
-- Contas avulsas: preenche aprovada_em/aprovada_por + migra pendente -> aprovada
-- =====================================================================

-- 2. Colunas de auditoria da aprovação
alter table public.contas_avulsas
  add column if not exists aprovada_em timestamptz,
  add column if not exists aprovada_por uuid references public.profiles(id);

-- 3. Retro fill pra linhas existentes (pendente + baixada, todas foram
-- criadas como "pendente" — nossa versão nova diria "aprovada")
update public.contas_avulsas
   set aprovada_em = coalesce(aprovada_em, created_at),
       aprovada_por = coalesce(aprovada_por, criado_por)
 where aprovada_em is null;

comment on column public.contas_avulsas.aprovada_em is
  'Retroativo pra linhas anteriores a 2026-08-12 = created_at (aprovação implícita)';

-- 4. Migra status: pendente -> aprovada
update public.contas_avulsas
   set status = 'aprovada'
 where status = 'pendente';

-- 5. Novo default é 'aprovada' (nasce aprovada)
alter table public.contas_avulsas
  alter column status set default 'aprovada';

-- 6. Constraint nova: se status é aprovada ou baixada, precisa de aprovada_em/aprovada_por
alter table public.contas_avulsas
  drop constraint if exists chk_avulsa_baixa_consistente;

alter table public.contas_avulsas
  add constraint chk_avulsa_aprovada_consistente check (
    -- aprovada ou baixada exigem os campos de aprovação
    (status in ('aprovada','baixada')
      and aprovada_em is not null
      and aprovada_por is not null)
    or
    -- pendente (legacy, tolerado até Migration B) não exige
    status = 'pendente'
  );

alter table public.contas_avulsas
  add constraint chk_avulsa_baixa_consistente check (
    (status = 'baixada'
      and pago_em is not null
      and pago_por is not null
      and conta_bancaria_baixa_id is not null)
    or
    (status <> 'baixada'
      and pago_em is null
      and pago_por is null
      and conta_bancaria_baixa_id is null)
  );

-- 7. Índice partial pra "A pagar" (aprovadas por vencimento)
create index if not exists idx_avulsas_aprovada_prazo
  on public.contas_avulsas(tenant_id, data_prevista_pagamento)
  where status = 'aprovada';
```

Aplicar via `mcp__supabase-write__apply_migration` com name `avulsa_status_aprovada_fill`.

- [ ] **Step 3: Atualizar `lib/types.ts`**

Se existir type `ContaAvulsaStatus`, ajustar para `"aprovada" | "baixada" | "pendente"` (deixar `pendente` por ora, some na Task 11). Se não existir esse alias, procurar todas as literais `"pendente"` em código de avulsa e trocar por `"aprovada"` — nesta task ainda não, só na Task 8/10.

- [ ] **Step 4: Verificação SQL**

```sql
-- Nenhum pendente sobrou?
select count(*) from public.contas_avulsas where status = 'pendente';
-- Deve retornar 0.

-- Todos aprovada/baixada têm aprovada_em?
select count(*) from public.contas_avulsas
 where status in ('aprovada','baixada')
   and (aprovada_em is null or aprovada_por is null);
-- Deve retornar 0.

-- Default está aprovada?
select column_default from information_schema.columns
 where table_name = 'contas_avulsas' and column_name = 'status';
```

- [ ] **Step 5: Verificar que UI existente não quebrou (smoke)**

Abrir `/financeiro/contas-a-pagar`, aba "Avulsas". A lista deve carregar. Nenhum item novo criado, mas visualização de existentes deve mostrar status como "Aprovada" (o código ainda espera "pendente"; **é esperado que o rótulo apareça errado ou como "-" até Task 8**). Isso é tolerado nesta task — ninguém deveria estar usando avulsa produtivamente entre Task 2 e Task 8. Se preferir, executar Tasks 2→8 em sequência sem deploy intermediário.

- [ ] **Step 6: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/20260812000002_avulsa_status_aprovada.sql supabase/migrations/20260812000002b_avulsa_status_aprovada_fill.sql lib/types.ts
git commit -m @'
task015: avulsa ganha status aprovada + migra pendente

Migration A (safe two-step): adiciona valor `aprovada` no enum
conta_avulsa_status, migra registros pendente -> aprovada, adiciona
colunas aprovada_em/aprovada_por com retro fill (created_at/criado_por),
muda default pra aprovada e adiciona índice partial.

Enum ainda contém `pendente` — removido na Migration B (task 11)
depois que o código de aplicação migrar.
'@
```

---

## Task 3: Recorrentes nascem `aprovada`

**Files:**
- Create: `supabase/migrations/20260812000003_recorrentes_nascem_aprovadas.sql`

**Interfaces:**
- Consumes: enum `conta_avulsa_status` com valor `aprovada` (Task 2).
- Produces: `gerar_ocorrencias_recorrentes()` cria instâncias com `status='aprovada'`, `aprovada_em=now()`, `aprovada_por=v_template.criado_por`.

- [ ] **Step 1: Criar migration**

`supabase/migrations/20260812000003_recorrentes_nascem_aprovadas.sql`:

```sql
-- =====================================================================
-- Recorrentes geram avulsa com status 'aprovada' (não mais 'pendente')
-- Ver spec: docs/superpowers/specs/2026-08-12-aprovacao-financeira-fluxo-caixa-design.md
-- =====================================================================

create or replace function public.gerar_ocorrencias_recorrentes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template  contas_avulsas_recorrentes%rowtype;
  v_geradas   integer := 0;
  v_nova_id   uuid;
  v_prox_data date;
begin
  for v_template in
    select *
      from public.contas_avulsas_recorrentes
     where ativo = true
       and proxima_data <= current_date
       and (data_fim is null or proxima_data <= data_fim)
     order by tenant_id, proxima_data
  loop
    -- INSERT da instância (agora nasce aprovada)
    insert into public.contas_avulsas (
      tenant_id, empresa_id, descricao, valor, natureza,
      data_prevista_pagamento, status,
      aprovada_em, aprovada_por,
      fornecedor_id, cliente_id, job_id,
      plano_conta_tipo_id, plano_conta_subtipo_id,
      recorrente_id, criado_por
    ) values (
      v_template.tenant_id, v_template.empresa_id, v_template.descricao,
      v_template.valor, 'saida',
      v_template.proxima_data, 'aprovada',
      now(), v_template.criado_por,
      v_template.fornecedor_id, v_template.cliente_id, v_template.job_id,
      v_template.plano_conta_tipo_id, v_template.plano_conta_subtipo_id,
      v_template.id, v_template.criado_por
    )
    returning id into v_nova_id;

    v_geradas := v_geradas + 1;

    -- Copia rateio do template
    insert into public.contas_avulsas_regionais (
      tenant_id, conta_avulsa_id, regional_id, percentual
    )
    select
      v_template.tenant_id, v_nova_id, r.regional_id, r.percentual
      from public.contas_avulsas_recorrentes_regionais r
     where r.recorrente_id = v_template.id;

    -- Avança proxima_data
    v_prox_data := public.calcular_proxima_data_recorrencia(v_template);

    if v_template.data_fim is not null and v_prox_data > v_template.data_fim then
      update public.contas_avulsas_recorrentes
         set ativo = false, proxima_data = v_prox_data
       where id = v_template.id;
    else
      update public.contas_avulsas_recorrentes
         set proxima_data = v_prox_data
       where id = v_template.id;
    end if;

    insert into public.audit_events (
      tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
    ) values (
      v_template.tenant_id, 'conta_recorrente', v_template.id::text,
      'conta_recorrente.ocorrencia_gerada', null,
      jsonb_build_object(
        'avulsa_id', v_nova_id,
        'data_movimento', v_template.proxima_data,
        'valor', v_template.valor,
        'nasceu_aprovada', true
      )
    );
  end loop;

  return v_geradas;
end;
$$;

grant execute on function public.gerar_ocorrencias_recorrentes() to authenticated;
```

Aplicar via `mcp__supabase-write__apply_migration` com name `recorrentes_nascem_aprovadas`.

- [ ] **Step 2: Teste da RPC**

```sql
-- Executa geração (idempotente — só gera se proxima_data <= hoje)
select public.gerar_ocorrencias_recorrentes();

-- Ver últimas geradas
select id, status, aprovada_em, aprovada_por, created_at
  from public.contas_avulsas
 where recorrente_id is not null
 order by created_at desc
 limit 5;
-- Todas com status='aprovada' e aprovada_em preenchido.
```

- [ ] **Step 3: Commit**

```powershell
git add supabase/migrations/20260812000003_recorrentes_nascem_aprovadas.sql
git commit -m @'
task015: gerar_ocorrencias_recorrentes cria avulsa aprovada

Instâncias geradas por template recorrente passam a nascer com
status='aprovada', aprovada_em=now(), aprovada_por=criado_por
do template. Cai direto na fila "A pagar" sem etapa de avaliação
(recorrentes não têm avaliação por definição).
'@
```

---

## Task 4: Views `vw_a_pagar` e `vw_fluxo_caixa`

**Files:**
- Create: `supabase/migrations/20260812000004_vw_fluxo_caixa_e_a_pagar.sql`

**Interfaces:**
- Consumes: `pedidos_compra` (com status `aprovada`), `contas_avulsas` (com status `aprovada`), `lancamentos_financeiros`.
- Produces:
  - View `public.vw_a_pagar` — colunas: `origem_tipo` (`'pp'|'avulsa'|'recorrente'`), `origem_id uuid`, `tenant_id`, `empresa_id`, `data_prevista date`, `valor numeric`, `natureza natureza_lancamento`, `descricao text`, `fornecedor_id uuid?`, `cliente_id uuid?`, `job_id uuid?`, `plano_conta_tipo_id uuid`, `plano_conta_subtipo_id uuid`.
  - View `public.vw_fluxo_caixa` — colunas: `situacao` (`'previsto'|'realizado'`), `origem_tipo` (`'pp'|'avulsa'|'recorrente'|'lancamento'`), `origem_id uuid`, `tenant_id`, `empresa_id`, `conta_bancaria_id uuid?`, `data_evento date`, `valor`, `natureza`, `descricao`, `fornecedor_id?`, `cliente_id?`, `job_id?`.

- [ ] **Step 1: Criar migration**

`supabase/migrations/20260812000004_vw_fluxo_caixa_e_a_pagar.sql`:

```sql
-- =====================================================================
-- Views: vw_a_pagar (previsto) e vw_fluxo_caixa (previsto + realizado)
-- Ver spec: docs/superpowers/specs/2026-08-12-aprovacao-financeira-fluxo-caixa-design.md
-- =====================================================================

-- 1) vw_a_pagar — só PPs aprovadas + avulsas aprovadas
create or replace view public.vw_a_pagar as
select
  'pp'::text                                        as origem_tipo,
  pp.id                                             as origem_id,
  pp.tenant_id,
  pp.empresa_id,
  pp.prazo_pagamento_financeiro                     as data_prevista,
  pp.valor::numeric(14,2)                           as valor,
  'saida'::natureza_lancamento                      as natureza,
  ('PP ' || pp.codigo || ' — ' || substring(pp.servico, 1, 150)) as descricao,
  pp.fornecedor_id,
  null::uuid                                        as cliente_id,
  pp.job_id,
  pp.aprovada_em,
  pp.aprovada_por
from public.pedidos_compra pp
where pp.status = 'aprovada'

union all

select
  case when a.recorrente_id is not null then 'recorrente' else 'avulsa' end,
  a.id,
  a.tenant_id,
  a.empresa_id,
  a.data_prevista_pagamento,
  a.valor::numeric(14,2),
  a.natureza,
  a.descricao,
  a.fornecedor_id,
  a.cliente_id,
  a.job_id,
  a.aprovada_em,
  a.aprovada_por
from public.contas_avulsas a
where a.status = 'aprovada';

grant select on public.vw_a_pagar to authenticated;

-- 2) vw_fluxo_caixa — previsto + realizado
create or replace view public.vw_fluxo_caixa as
select
  'previsto'::text                                  as situacao,
  'pp'::text                                        as origem_tipo,
  pp.id                                             as origem_id,
  pp.tenant_id, pp.empresa_id,
  null::uuid                                        as conta_bancaria_id,
  pp.prazo_pagamento_financeiro                     as data_evento,
  pp.valor::numeric(14,2)                           as valor,
  'saida'::natureza_lancamento                      as natureza,
  ('PP ' || pp.codigo || ' — ' || substring(pp.servico, 1, 150)) as descricao,
  pp.fornecedor_id,
  null::uuid                                        as cliente_id,
  pp.job_id
from public.pedidos_compra pp
where pp.status = 'aprovada'

union all

select
  'previsto',
  case when a.recorrente_id is not null then 'recorrente' else 'avulsa' end,
  a.id,
  a.tenant_id, a.empresa_id,
  null::uuid                                        as conta_bancaria_id,
  a.data_prevista_pagamento,
  a.valor::numeric(14,2),
  a.natureza,
  a.descricao,
  a.fornecedor_id, a.cliente_id, a.job_id
from public.contas_avulsas a
where a.status = 'aprovada'

union all

select
  'realizado',
  'lancamento',
  l.id,
  l.tenant_id, l.empresa_id,
  l.conta_bancaria_id,
  l.data_movimento,
  l.valor,
  l.natureza,
  l.descricao,
  l.fornecedor_id, l.cliente_id, l.job_id
from public.lancamentos_financeiros l;

grant select on public.vw_fluxo_caixa to authenticated;
```

Aplicar via `mcp__supabase-write__apply_migration` com name `views_fluxo_caixa_a_pagar`.

- [ ] **Step 2: Verificação SQL**

```sql
-- Views existem?
select viewname from pg_views where viewname in ('vw_a_pagar','vw_fluxo_caixa');

-- Sanity: totais coerentes
select count(*) from public.vw_a_pagar;
-- Deve bater com:
select
  (select count(*) from public.pedidos_compra where status='aprovada')
  + (select count(*) from public.contas_avulsas where status='aprovada');

-- Ficam visíveis pelo authenticated (rodar como um user do tenant)?
select tenant_id, situacao, count(*) from public.vw_fluxo_caixa group by 1,2;
```

- [ ] **Step 3: Commit**

```powershell
git add supabase/migrations/20260812000004_vw_fluxo_caixa_e_a_pagar.sql
git commit -m @'
task015: views vw_a_pagar e vw_fluxo_caixa

vw_a_pagar unifica PPs aprovadas + avulsas aprovadas com colunas
normalizadas. vw_fluxo_caixa adiciona lançamentos_financeiros como
"realizado". RLS herdado das tabelas subjacentes.
'@
```

---

## Task 5: Server actions — `aprovarPP` e `desaprovarPP`

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/actions.ts` (adicionar duas actions)

**Interfaces:**
- Consumes: `checarGateFinanceiro`, `logAuditEvent`, RPCs `aprovar_pp(uuid)` e `desaprovar_pp(uuid, text)` da Task 1.
- Produces:
  - `aprovarPP(pp_id: string): Promise<Result>` — chama RPC `aprovar_pp`, loga audit `pedido_compra.aprovada`, revalida `/financeiro/contas-a-pagar` e `/financeiro/a-pagar`.
  - `desaprovarPP(input: { pp_id, motivo }): Promise<Result>` — chama RPC `desaprovar_pp`, loga audit `pedido_compra.desaprovada`, revalida ambas as rotas.

- [ ] **Step 1: Adicionar `aprovarPP` no fim de `actions.ts`**

```typescript
/**
 * Aprova a PP: muda em_avaliacao -> aprovada. A partir daí, a PP entra
 * na fila "A pagar" e pode ser efetivamente baixada.
 */
export async function aprovarPP(pp_id: string): Promise<Result> {
  const gate = await checarGateFinanceiro(pp_id, "pedido_compra.aprovada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("id, status, codigo, valor, job_id, prazo_pagamento_financeiro")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "em_avaliacao") {
    return {
      ok: false,
      message:
        pp.status === "aprovada"
          ? "PP já está aprovada."
          : "Só PP em avaliação pode ser aprovada.",
    };
  }

  const { error } = await supabase.rpc("aprovar_pp", { p_pp_id: pp_id });
  if (error) {
    return { ok: false, message: `Falha ao aprovar: ${error.message}` };
  }

  await logAuditEvent({
    acao: "pedido_compra.aprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      valor: Number(pp.valor),
      job_id: pp.job_id,
      prazo_pagamento_financeiro: pp.prazo_pagamento_financeiro,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/a-pagar");
  revalidatePath("/financeiro");
  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}

const desaprovarSchema = z.object({
  pp_id: z.string().uuid(),
  motivo: motivoSchema,
});

/**
 * Desaprova a PP: devolve pra em_avaliacao. Usado quando a aprovação foi
 * feita por engano ou apareceu informação nova que exige reavaliação.
 */
export async function desaprovarPP(input: unknown): Promise<Result> {
  const parsed = desaprovarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.pp_id, "pedido_compra.desaprovada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("id, status, codigo, job_id")
    .eq("id", parsed.data.pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "aprovada") {
    return { ok: false, message: "Só PP aprovada pode ser desaprovada." };
  }

  const { error } = await supabase.rpc("desaprovar_pp", {
    p_pp_id: parsed.data.pp_id,
    p_motivo: parsed.data.motivo,
  });
  if (error) {
    return { ok: false, message: `Falha ao desaprovar: ${error.message}` };
  }

  await logAuditEvent({
    acao: "pedido_compra.desaprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      job_id: pp.job_id,
      motivo: parsed.data.motivo,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/a-pagar");
  revalidatePath("/financeiro");
  return { ok: true };
}
```

- [ ] **Step 2: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

Erros esperados: nenhum.

- [ ] **Step 3: Commit**

```powershell
git add app/(app)/financeiro/contas-a-pagar/actions.ts
git commit -m @'
task015: actions aprovarPP e desaprovarPP

Server actions que chamam as RPCs correspondentes com gate de
permissão financeira e audit trail. UI ainda não usa — vem na Task 6.
'@
```

---

## Task 6: UI caixa de entrada — "Aprovar/Rejeitar" (não baixa mais)

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx` (título + descrição + contagens)
- Modify: `app/(app)/financeiro/contas-a-pagar/pedidos-compra-list.tsx` (ação principal vira "Aprovar"; some "Dar baixa")

**Interfaces:**
- Consumes: `aprovarPP`, `desaprovarPP`, `rejeitarPedidoCompraFinanceiro` (já existe).
- Produces: caixa de entrada não permite mais dar baixa direta. Só aprovar ou rejeitar. PPs `aprovada` **não aparecem** nesta tela (filtro `em_avaliacao`).

- [ ] **Step 1: Ajustar `page.tsx` — título e descrição**

Modificar o `<h1>` para "Caixa de entrada" e o `<p>` da descrição:

```tsx
<h1 className="text-3xl font-bold tracking-tight">Caixa de entrada</h1>
...
<p className="text-sm text-muted-foreground max-w-2xl">
  Avalie os Pedidos de Compra emitidos pelos GPs. Aprove pra liberar
  pagamento na tela "A pagar", ou rejeite com motivo justificado.
  Lançamentos avulsos também são revisados aqui.
</p>
```

- [ ] **Step 2: Ajustar `page.tsx` — filtro da PP na query principal**

Trocar a query principal de PPs pra filtrar apenas `em_avaliacao` (a lista atual mostra tudo, mas para a caixa de entrada só interessa em avaliação):

```tsx
supabase
  .from("pedidos_compra")
  .select(`...`)
  .eq("tenant_id", session.activeTenant.id)
  .eq("status", "em_avaliacao")
  .order("created_at", { ascending: false }),
```

- [ ] **Step 3: Ajustar `page.tsx` — contagem de avulsas usa `aprovada`**

Trocar `.eq("status", "pendente")` por `.eq("status", "aprovada")` no `avulsasPendentesCountRes` (o rótulo do card também vai virar "Aprovadas aguardando pagamento" — na verdade, esse contador vai fazer mais sentido na tela "A pagar"; aqui simplesmente sumir):

Como o contador `avulsasPendentesCountRes` fica sem propósito na caixa de entrada (avulsas nascem aprovadas, não passam por avaliação), **remover a variável e a prop `avulsasPendentesCount`** passada pra `ContasPagarTabs`. Se `ContasPagarTabs` obriga a prop, mudar assinatura pra opcional.

- [ ] **Step 4: Ajustar `pedidos-compra-list.tsx`**

Ler o arquivo, localizar o handler / botão de "Dar baixa" (`marcarPagaFinanceiro`) e substituir por dois botões: "Aprovar" (chama `aprovarPP`) e "Rejeitar" (já existe). Remover totalmente o `BaixaPPModal` e sua importação.

Padrão pro botão Aprovar (adaptar aos padrões visuais existentes no arquivo):

```tsx
<Button
  size="sm"
  variant="default"
  disabled={pp.status !== "em_avaliacao" || isPending}
  onClick={() => {
    startTransition(async () => {
      const res = await aprovarPP(pp.id);
      if (!res.ok) {
        toast.error(res.message);
      } else {
        toast.success(`PP ${pp.codigo} aprovada — vai pra "A pagar".`);
      }
    });
  }}
>
  <CheckCircle2 className="mr-1 h-4 w-4" />
  Aprovar
</Button>
```

Importar `aprovarPP` from `"./actions"` e remover import de `marcarPagaFinanceiro` (fica exportada em actions.ts, migra para a-pagar na Task 7).

- [ ] **Step 5: Smoke manual**

```powershell
npm run dev
```

Abrir http://localhost:3000/financeiro/contas-a-pagar. Login como usuário financeiro. Verificar:
- Título é "Caixa de entrada".
- PP em avaliação aparece com botão "Aprovar" e "Rejeitar", sem "Dar baixa".
- Clicar "Aprovar" → toast de sucesso, PP some da lista (agora está `aprovada`).
- Aba "Avulsas" ainda funciona (visualização; ações de baixa quebradas até Task 8 — esperado).

- [ ] **Step 6: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

- [ ] **Step 7: Commit**

```powershell
git add app/(app)/financeiro/contas-a-pagar/page.tsx app/(app)/financeiro/contas-a-pagar/pedidos-compra-list.tsx
git commit -m @'
task015: caixa de entrada — aprovar/rejeitar (não baixa mais)

Tela `contas-a-pagar` vira "Caixa de entrada": mostra só PPs
em_avaliacao, ação principal é Aprovar (leva pra fila "A pagar")
ou Rejeitar. Baixa direta some daqui — migra pra tela A pagar
na Task 7.
'@
```

---

## Task 7: Tela "A pagar" — baixa de PPs e avulsas aprovadas

**Files:**
- Create: `app/(app)/financeiro/a-pagar/page.tsx`
- Create: `app/(app)/financeiro/a-pagar/actions.ts`
- Create: `app/(app)/financeiro/a-pagar/lista-a-pagar.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/actions.ts` (mover `marcarPagaFinanceiro` e `estornarBaixaPP` para a-pagar/actions.ts; re-exportar do local original por 1 versão pra evitar breakage se algo referenciar externamente — checar antes se algum outro arquivo importa)

**Interfaces:**
- Consumes: view `vw_a_pagar` (Task 4); RPCs `dar_baixa_pp`, `dar_baixa_avulsa` (Tasks 1/existente).
- Produces:
  - Página `/financeiro/a-pagar` — lista unificada, filtros por conta bancária/empresa/tipo, ação "Dar baixa" com modal que reusa `BaixaPPModal` (ou variante avulsa) já existentes.
  - Actions: `marcarPagaFinanceiro` (movida da caixa de entrada), `darBaixaAvulsa`.

- [ ] **Step 1: Criar `a-pagar/actions.ts`**

```typescript
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Ok = { ok: true };
type Err = { ok: false; message: string };
type Result = Ok | Err;

async function checarGateFinanceiro(
  entidadeId: string,
  entidadeTipo: string,
  acaoTentada: string,
): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof requireSession>>; supabase: ReturnType<typeof createClient> }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();

  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo,
      entidadeId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false, message: "Apenas admin ou financeiro pode executar esta ação." };
  }
  return { ok: true, session, supabase };
}

const baixaPPSchema = z.object({
  pp_id: z.string().uuid(),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
  plano_conta_tipo_id: z.string().uuid("Selecione o tipo."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo."),
});

/**
 * Baixa uma PP aprovada. Se a PP ainda estiver em em_avaliacao, a RPC
 * (endurecida na Task 10) rejeita — significa que alguém pulou aprovação.
 */
export async function marcarPagaFinanceiro(input: unknown): Promise<Result> {
  const parsed = baixaPPSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.pp_id, "pedido_compra", "pedido_compra.paga");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("id, status, codigo, valor, job_id")
    .eq("id", parsed.data.pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!pp) return { ok: false, message: "PP não encontrada." };
  // Task 10 endurece a RPC pra exigir 'aprovada'; até lá aceita em_avaliacao também.
  if (pp.status !== "aprovada" && pp.status !== "em_avaliacao") {
    return {
      ok: false,
      message: pp.status === "pago" ? "PP já está paga." : "Só PP aprovada pode ser baixada.",
    };
  }

  const { data: lancId, error } = await supabase.rpc("dar_baixa_pp", {
    p_pp_id: parsed.data.pp_id,
    p_pago_em: parsed.data.pago_em,
    p_conta_bancaria_id: parsed.data.conta_bancaria_id,
    p_plano_conta_tipo_id: parsed.data.plano_conta_tipo_id,
    p_plano_conta_subtipo_id: parsed.data.plano_conta_subtipo_id,
    p_criado_por: session.profile.id,
  });

  if (error) return { ok: false, message: `Falha ao dar baixa: ${error.message}` };

  await logAuditEvent({
    acao: "pedido_compra.paga",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      valor: Number(pp.valor),
      pago_em: parsed.data.pago_em,
      job_id: pp.job_id,
      conta_bancaria_id: parsed.data.conta_bancaria_id,
      lancamento_id: lancId,
    },
  });

  revalidatePath("/financeiro/a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}

const baixaAvulsaSchema = z.object({
  avulsa_id: z.string().uuid(),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
});

export async function darBaixaAvulsa(input: unknown): Promise<Result> {
  const parsed = baixaAvulsaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.avulsa_id, "conta_avulsa", "conta_avulsa.baixada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: av } = await supabase
    .from("contas_avulsas")
    .select("id, status, descricao, valor")
    .eq("id", parsed.data.avulsa_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!av) return { ok: false, message: "Conta avulsa não encontrada." };
  if (av.status !== "aprovada") {
    return {
      ok: false,
      message: av.status === "baixada" ? "Já está baixada." : "Só avulsa aprovada pode ser baixada.",
    };
  }

  const { data: lancId, error } = await supabase.rpc("dar_baixa_avulsa", {
    p_avulsa_id: parsed.data.avulsa_id,
    p_pago_em: parsed.data.pago_em,
    p_conta_bancaria_id: parsed.data.conta_bancaria_id,
    p_criado_por: session.profile.id,
  });

  if (error) return { ok: false, message: `Falha ao dar baixa: ${error.message}` };

  await logAuditEvent({
    acao: "conta_avulsa.baixada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: parsed.data.avulsa_id,
    metadata: {
      descricao: av.descricao,
      valor: Number(av.valor),
      pago_em: parsed.data.pago_em,
      conta_bancaria_id: parsed.data.conta_bancaria_id,
      lancamento_id: lancId,
    },
  });

  revalidatePath("/financeiro/a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro/conciliacao");
  return { ok: true };
}
```

**Nota:** confirmar assinatura real de `dar_baixa_avulsa` em `supabase/migrations/20260806000004_avulsa_rpcs.sql` antes de aplicar. Se o parâmetro for `p_conta_avulsa_id`, ajustar o nome no `supabase.rpc(...)`.

- [ ] **Step 2: Criar `a-pagar/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Wallet } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ListaAPagar, type ItemAPagar } from "./lista-a-pagar";

export const dynamic = "force-dynamic";

export default async function APagarPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }
  const supabase = createClient();

  const [itensRes, contasRes, tiposRes, subtiposRes] = await Promise.all([
    supabase
      .from("vw_a_pagar")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("data_prevista", { ascending: true, nullsFirst: true }),
    supabase
      .from("contas_bancarias")
      .select("id, apelido, banco, agencia, conta, empresa_id, ativo")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("apelido"),
    supabase
      .from("plano_contas_tipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("ordem"),
    supabase
      .from("plano_contas_subtipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
  ]);

  if (itensRes.error) console.error("[a-pagar]", itensRes.error.message);

  const itens: ItemAPagar[] = (itensRes.data ?? []).map((r) => ({
    origem_tipo: r.origem_tipo as ItemAPagar["origem_tipo"],
    origem_id: r.origem_id as string,
    empresa_id: r.empresa_id as string,
    data_prevista: r.data_prevista as string | null,
    valor: Number(r.valor),
    natureza: r.natureza as "entrada" | "saida",
    descricao: r.descricao as string,
    fornecedor_id: r.fornecedor_id as string | null,
    cliente_id: r.cliente_id as string | null,
    job_id: r.job_id as string | null,
    aprovada_em: r.aprovada_em as string | null,
  }));

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/financeiro" className="hover:text-california-red transition-colors">
            Financeiro
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">A pagar</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Wallet className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">A pagar</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Pedidos de Compra aprovados e lançamentos avulsos/recorrentes
          aguardando pagamento. Dê baixa quando o dinheiro sair do banco.
        </p>
      </header>

      <ListaAPagar
        itens={itens}
        contas={contasRes.data ?? []}
        tipos={tiposRes.data ?? []}
        subtipos={subtiposRes.data ?? []}
      />
    </div>
  );
}
```

- [ ] **Step 3: Criar `a-pagar/lista-a-pagar.tsx` (client component)**

```tsx
"use client";

import * as React from "react";
import { formatBRL, formatarData } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { marcarPagaFinanceiro, darBaixaAvulsa } from "./actions";

export type ItemAPagar = {
  origem_tipo: "pp" | "avulsa" | "recorrente";
  origem_id: string;
  empresa_id: string;
  data_prevista: string | null;
  valor: number;
  natureza: "entrada" | "saida";
  descricao: string;
  fornecedor_id: string | null;
  cliente_id: string | null;
  job_id: string | null;
  aprovada_em: string | null;
};

type Conta = {
  id: string;
  apelido: string;
  banco: string;
  empresa_id: string;
};

type Tipo = { id: string; codigo: string; nome: string };
type Subtipo = { id: string; tipo_id: string; nome: string };

export function ListaAPagar({
  itens,
  contas,
  tipos,
  subtipos,
}: {
  itens: ItemAPagar[];
  contas: Conta[];
  tipos: Tipo[];
  subtipos: Subtipo[];
}) {
  const [selecionado, setSelecionado] = React.useState<ItemAPagar | null>(null);
  const [pending, startTransition] = React.useTransition();

  const hoje = new Date().toISOString().slice(0, 10);

  const chipOrigem: Record<ItemAPagar["origem_tipo"], string> = {
    pp: "PP",
    avulsa: "Avulsa",
    recorrente: "Recorrente",
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="p-3 text-left">Origem</th>
            <th className="p-3 text-left">Descrição</th>
            <th className="p-3 text-left">Vencimento</th>
            <th className="p-3 text-right">Valor</th>
            <th className="p-3 text-right">Ação</th>
          </tr>
        </thead>
        <tbody>
          {itens.length === 0 && (
            <tr>
              <td colSpan={5} className="p-6 text-center text-muted-foreground">
                Nada aprovado aguardando pagamento no momento.
              </td>
            </tr>
          )}
          {itens.map((item) => {
            const vencido = item.data_prevista && item.data_prevista < hoje;
            return (
              <tr
                key={`${item.origem_tipo}:${item.origem_id}`}
                className="border-t border-border hover:bg-muted/40 transition-colors"
              >
                <td className="p-3">
                  <Badge variant="secondary">{chipOrigem[item.origem_tipo]}</Badge>
                </td>
                <td className="p-3">{item.descricao}</td>
                <td className={`p-3 ${vencido ? "text-california-red font-medium" : ""}`}>
                  {item.data_prevista ? formatarData(item.data_prevista) : "—"}
                </td>
                <td className="p-3 text-right font-medium">{formatBRL(item.valor)}</td>
                <td className="p-3 text-right">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => setSelecionado(item)}
                  >
                    Dar baixa
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {selecionado && (
        <BaixaDialog
          item={selecionado}
          contas={contas}
          tipos={tipos}
          subtipos={subtipos}
          onClose={() => setSelecionado(null)}
          onConfirm={async (payload) => {
            startTransition(async () => {
              let res;
              if (selecionado.origem_tipo === "pp") {
                res = await marcarPagaFinanceiro({
                  pp_id: selecionado.origem_id,
                  pago_em: payload.pago_em,
                  conta_bancaria_id: payload.conta_bancaria_id,
                  plano_conta_tipo_id: payload.plano_conta_tipo_id,
                  plano_conta_subtipo_id: payload.plano_conta_subtipo_id,
                });
              } else {
                res = await darBaixaAvulsa({
                  avulsa_id: selecionado.origem_id,
                  pago_em: payload.pago_em,
                  conta_bancaria_id: payload.conta_bancaria_id,
                });
              }
              if (!res.ok) {
                toast.error(res.message);
              } else {
                toast.success("Baixa registrada.");
                setSelecionado(null);
              }
            });
          }}
        />
      )}
    </div>
  );
}

function BaixaDialog(_props: {
  item: ItemAPagar;
  contas: Conta[];
  tipos: Tipo[];
  subtipos: Subtipo[];
  onClose: () => void;
  onConfirm: (payload: {
    pago_em: string;
    conta_bancaria_id: string;
    plano_conta_tipo_id: string;
    plano_conta_subtipo_id: string;
  }) => void;
}) {
  // MVP: reusar visual do BaixaPPModal em contas-a-pagar/baixa-pp-modal.tsx.
  // Cópia enxuta com filtro por empresa. Para avulsa, tipo/subtipo já vêm
  // preenchidos no lançamento (a RPC de avulsa preserva tipo/subtipo da própria
  // avulsa), então o dialog não pergunta tipo/subtipo pra avulsa — só data + conta.
  // Implementação: adaptar o BaixaPPModal existente pra receber essas variantes.
  // Se preferir, extrair componente compartilhado em `components/financeiro/baixa-dialog.tsx`
  // como parte desta task.
  return null; // esboço — implementar de fato aqui
}
```

**Nota do implementador:** o `BaixaDialog` acima é esqueleto. Antes de continuar, ler `app/(app)/financeiro/contas-a-pagar/baixa-pp-modal.tsx` (já existe) e:

1. Copiar seu conteúdo pra `components/financeiro/baixa-dialog.tsx`.
2. Parametrizar: se `item.origem_tipo === 'avulsa' || 'recorrente'`, esconder os selects de tipo/subtipo (a avulsa já tem essa info persistida — a RPC de baixa da avulsa preserva).
3. Filtrar `contas` por `empresa_id` do item (só contas da mesma empresa do lançamento).
4. Usar o componente compartilhado nos dois lugares (aqui + qualquer outro).

- [ ] **Step 4: Mover `marcarPagaFinanceiro` de `contas-a-pagar/actions.ts`**

Remover a função `marcarPagaFinanceiro` de `contas-a-pagar/actions.ts` (já criamos em `a-pagar/actions.ts`). Manter `estornarBaixaPP` onde está (não é usado na caixa de entrada, é usado em contexto de PP paga — verificar se algum outro componente importa; se sim, deixar re-exportação temporária).

Rodar grep antes:

```powershell
Select-String -Path "app/(app)/**/*.tsx","components/**/*.tsx","lib/**/*.ts" -Pattern "marcarPagaFinanceiro"
```

Ajustar imports que apontam pro path antigo pra apontar `@/app/(app)/financeiro/a-pagar/actions`.

- [ ] **Step 5: Smoke manual**

```powershell
npm run dev
```

- Abrir `/financeiro/a-pagar`.
- Lista mostra PPs aprovadas + avulsas aprovadas.
- Clicar "Dar baixa" numa PP aprovada, escolher data/conta/tipo/subtipo. Confirmar.
- PP some da lista, aparece em `/financeiro/conciliacao` (mesmo dia).
- Repetir com uma avulsa aprovada.

- [ ] **Step 6: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

- [ ] **Step 7: Commit**

```powershell
git add app/(app)/financeiro/a-pagar/ components/financeiro/baixa-dialog.tsx app/(app)/financeiro/contas-a-pagar/actions.ts
git commit -m @'
task015: nova tela "A pagar" — baixa de PP e avulsa aprovadas

Lê vw_a_pagar e permite dar baixa em PP e avulsa. Compartilha
componente BaixaDialog. `marcarPagaFinanceiro` migra da caixa
de entrada pra cá.
'@
```

---

## Task 8: UI avulsas — passar a usar `aprovada`

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/avulsas-list.tsx` (remove ação "Dar baixa"; troca literal `"pendente"` por `"aprovada"` em rótulos/filtros)
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts` (idem: `"pendente" → "aprovada"`; qualquer server action que hoje verifica status)
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx` (contagem de avulsas ativas usa `aprovada`)

**Interfaces:**
- Consumes: enum já com `aprovada` (Task 2).
- Produces: código de aplicação não referencia mais `"pendente"` em contas avulsas. Aprovação implícita — não há UI de "aprovar avulsa", já nasce aprovada.

- [ ] **Step 1: Grep pra achar todas as ocorrências**

```powershell
Select-String -Path "app/(app)/financeiro/**/*.tsx","app/(app)/financeiro/**/*.ts","lib/**/*.ts" -Pattern '"pendente"'
```

Lista esperada: `avulsas-list.tsx`, `actions-avulsas.ts`, `page.tsx` (contas-a-pagar), talvez `lib/types.ts`.

- [ ] **Step 2: Trocar `"pendente"` por `"aprovada"` nesses lugares**

Para cada arquivo listado, substituir a literal e ajustar rótulos exibidos ao usuário:

- `"Pendente"` → `"Aprovada"` em badges/status labels.
- `.eq("status", "pendente")` → `.eq("status", "aprovada")`.
- Manter `"Baixada"` intacto.

- [ ] **Step 3: Remover ação "Dar baixa" de `avulsas-list.tsx`**

A baixa agora vive em `/financeiro/a-pagar`. Na aba de avulsas da caixa de entrada, ficam apenas:
- Visualização/edição da avulsa (drawer).
- Anexos.
- Talvez "Cancelar" (se existir).

Remover botão e imports relacionados à baixa. Se o modal `BaixaAvulsaModal` existir, apagar arquivo se não é mais usado em lugar nenhum (grep antes).

- [ ] **Step 4: Ajustar `lib/types.ts`**

Se existir `ContaAvulsaStatus`:
```typescript
export type ContaAvulsaStatus = "aprovada" | "baixada"; // pendente removido na Task 11
```

- [ ] **Step 5: Smoke**

```powershell
npm run dev
```

- Aba "Avulsas" na caixa de entrada carrega, mostra status "Aprovada" corretamente.
- Aba não tem mais botão "Dar baixa".
- Criar nova avulsa via drawer → aparece com status "Aprovada".
- Ir em `/financeiro/a-pagar` → nova avulsa aparece na lista, pode dar baixa.

- [ ] **Step 6: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

- [ ] **Step 7: Commit**

```powershell
git add app/(app)/financeiro/contas-a-pagar/ lib/types.ts
git commit -m @'
task015: avulsas — front usa 'aprovada' + baixa migra pra /a-pagar

Substitui todas as referências a status='pendente' por 'aprovada'
no código de aplicação. Remove botão "Dar baixa" da aba de avulsas
da caixa de entrada (baixa vive em /financeiro/a-pagar).
'@
```

---

## Task 9: Tela "Fluxo de caixa"

**Files:**
- Create: `app/(app)/financeiro/fluxo-caixa/page.tsx`
- Create: `app/(app)/financeiro/fluxo-caixa/fluxo-caixa-view.tsx`

**Interfaces:**
- Consumes: view `vw_fluxo_caixa` (Task 4).
- Produces: página que agrupa por dia/semana/mês, calcula saldo projetado por conta bancária.

- [ ] **Step 1: Criar `fluxo-caixa/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { FluxoCaixaView, type FluxoItem } from "./fluxo-caixa-view";

export const dynamic = "force-dynamic";

export default async function FluxoCaixaPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }
  const supabase = createClient();

  // Janela default: 60 dias atrás até 90 dias à frente (client filtra fino)
  const hoje = new Date();
  const inicio = new Date(hoje); inicio.setDate(hoje.getDate() - 60);
  const fim = new Date(hoje); fim.setDate(hoje.getDate() + 90);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const [fluxoRes, contasRes] = await Promise.all([
    supabase
      .from("vw_fluxo_caixa")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .gte("data_evento", iso(inicio))
      .lte("data_evento", iso(fim))
      .order("data_evento", { ascending: true }),
    supabase
      .from("contas_bancarias")
      .select("id, apelido, banco, empresa_id, ativo")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("apelido"),
  ]);

  if (fluxoRes.error) console.error("[fluxo-caixa]", fluxoRes.error.message);

  const itens: FluxoItem[] = (fluxoRes.data ?? []).map((r) => ({
    situacao: r.situacao as "previsto" | "realizado",
    origem_tipo: r.origem_tipo as FluxoItem["origem_tipo"],
    origem_id: r.origem_id as string,
    empresa_id: r.empresa_id as string,
    conta_bancaria_id: r.conta_bancaria_id as string | null,
    data_evento: r.data_evento as string,
    valor: Number(r.valor),
    natureza: r.natureza as "entrada" | "saida",
    descricao: r.descricao as string,
  }));

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/financeiro" className="hover:text-california-red transition-colors">
            Financeiro
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">Fluxo de caixa</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <TrendingUp className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Fluxo de caixa</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Previsto (aprovados aguardando pagamento) + realizado (já baixados).
          Serve pra decidir prioridade de pagamento e antecipar saldos por conta.
        </p>
      </header>

      <FluxoCaixaView itens={itens} contas={contasRes.data ?? []} />
    </div>
  );
}
```

- [ ] **Step 2: Criar `fluxo-caixa/fluxo-caixa-view.tsx` (client component)**

```tsx
"use client";

import * as React from "react";
import { formatBRL } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type FluxoItem = {
  situacao: "previsto" | "realizado";
  origem_tipo: "pp" | "avulsa" | "recorrente" | "lancamento";
  origem_id: string;
  empresa_id: string;
  conta_bancaria_id: string | null;
  data_evento: string;
  valor: number;
  natureza: "entrada" | "saida";
  descricao: string;
};

type Conta = { id: string; apelido: string; empresa_id: string };
type Agrupamento = "dia" | "semana" | "mes";

function chaveBucket(iso: string, agrup: Agrupamento): string {
  const d = new Date(iso);
  if (agrup === "dia") return iso;
  if (agrup === "mes") return iso.slice(0, 7);
  // semana: ISO week (YYYY-Www)
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const dias = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((dias + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function FluxoCaixaView({ itens, contas }: { itens: FluxoItem[]; contas: Conta[] }) {
  const [agrup, setAgrup] = React.useState<Agrupamento>("dia");
  const [contaFiltro, setContaFiltro] = React.useState<string | "todas" | "sem_alocacao">("todas");

  const filtrados = itens.filter((i) => {
    if (contaFiltro === "todas") return true;
    if (contaFiltro === "sem_alocacao") return i.conta_bancaria_id === null;
    return i.conta_bancaria_id === contaFiltro;
  });

  const buckets = new Map<string, { previsto: number; realizado: number; itens: FluxoItem[] }>();
  for (const item of filtrados) {
    const k = chaveBucket(item.data_evento, agrup);
    if (!buckets.has(k)) buckets.set(k, { previsto: 0, realizado: 0, itens: [] });
    const b = buckets.get(k)!;
    const sinal = item.natureza === "saida" ? -1 : 1;
    if (item.situacao === "previsto") b.previsto += item.valor * sinal;
    else b.realizado += item.valor * sinal;
    b.itens.push(item);
  }

  const bucketsOrdenados = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  let saldoAcum = 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border p-1 bg-card">
          {(["dia", "semana", "mes"] as const).map((a) => (
            <Button
              key={a}
              size="sm"
              variant={agrup === a ? "default" : "ghost"}
              onClick={() => setAgrup(a)}
            >
              {a === "dia" ? "Dia" : a === "semana" ? "Semana" : "Mês"}
            </Button>
          ))}
        </div>
        <select
          className="rounded-lg border border-border bg-card px-3 py-1 text-sm"
          value={contaFiltro}
          onChange={(e) => setContaFiltro(e.target.value as typeof contaFiltro)}
        >
          <option value="todas">Todas as contas</option>
          <option value="sem_alocacao">Sem conta alocada (previstos)</option>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>{c.apelido}</option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Período</th>
              <th className="p-3 text-right">Previsto</th>
              <th className="p-3 text-right">Realizado</th>
              <th className="p-3 text-right">Saldo acumulado</th>
              <th className="p-3 text-right">Itens</th>
            </tr>
          </thead>
          <tbody>
            {bucketsOrdenados.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  Sem movimento no período.
                </td>
              </tr>
            )}
            {bucketsOrdenados.map(([k, b]) => {
              saldoAcum += b.previsto + b.realizado;
              return (
                <tr key={k} className="border-t border-border hover:bg-muted/40">
                  <td className="p-3 font-medium">{k}</td>
                  <td className={`p-3 text-right ${b.previsto < 0 ? "text-orange-600" : "text-green-600"}`}>
                    {formatBRL(b.previsto)}
                  </td>
                  <td className={`p-3 text-right ${b.realizado < 0 ? "text-red-600" : "text-green-700"}`}>
                    {formatBRL(b.realizado)}
                  </td>
                  <td className={`p-3 text-right font-semibold ${saldoAcum < 0 ? "text-red-600" : ""}`}>
                    {formatBRL(saldoAcum)}
                  </td>
                  <td className="p-3 text-right text-muted-foreground">{b.itens.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {contaFiltro === "sem_alocacao" && (
        <p className="text-xs text-muted-foreground">
          <Badge variant="secondary">Sem conta alocada</Badge>{" "}
          previstos (PP e avulsa aprovadas) ainda não têm conta bancária escolhida;
          a conta é definida no ato da baixa.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar existência de `@/lib/format` e `Badge`/`Button` shadcn**

```powershell
Select-String -Path "lib/*.ts" -Pattern "formatBRL"
Select-String -Path "components/ui/badge.tsx" -Pattern "^"
```

Se `formatBRL` não existir, criar em `lib/format.ts`:
```typescript
export const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
export const formatarData = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
```

Se já existir, usar o que tem (grep antes).

- [ ] **Step 4: Smoke**

- Ir em `/financeiro/fluxo-caixa`.
- Ver buckets por dia. Trocar pra semana, mês.
- Filtrar por conta bancária.
- Filtrar por "Sem conta alocada" — mostra só previstos.
- Comparar total "Realizado" de um dia com o total do mesmo dia em `/financeiro/conciliacao` — deve bater.

- [ ] **Step 5: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

- [ ] **Step 6: Commit**

```powershell
git add app/(app)/financeiro/fluxo-caixa/ lib/format.ts
git commit -m @'
task015: tela Fluxo de caixa

Consolida previsto (aprovados aguardando pagamento) + realizado
(lancamentos_financeiros) da vw_fluxo_caixa. Toggle dia/semana/mês,
filtro por conta bancária, saldo acumulado por bucket. Realizado bate
com Conciliação.
'@
```

---

## Task 10: Landing `/financeiro` — cards novos + ajuste "Caixa de entrada"

**Files:**
- Modify: `app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consumes: view `vw_a_pagar` (pra contar itens).
- Produces: landing tem 5 cards: Abertura de Job, Caixa de entrada, A pagar, Fluxo de caixa, Conciliação.

- [ ] **Step 1: Ajustar imports + queries**

Substituir os `useState` de contagem: além dos já existentes, adicionar contagem de `vw_a_pagar`.

```tsx
const [aguardandoRes, ppsRes, aPagarRes] = await Promise.all([
  supabase.from("jobs").select("id", { count: "exact", head: true })
    .eq("tenant_id", session.activeTenant.id).eq("status", "aguardando_abertura"),
  supabase.from("pedidos_compra").select("id", { count: "exact", head: true })
    .eq("tenant_id", session.activeTenant.id).eq("status", "em_avaliacao"),
  supabase.from("vw_a_pagar").select("origem_id", { count: "exact", head: true })
    .eq("tenant_id", session.activeTenant.id),
]);
```

- [ ] **Step 2: Ajustar cards**

Renomear o card "Contas a Pagar" pra "Caixa de entrada" + adicionar 2 novos cards:

```tsx
<FinanceiroCard
  href="/financeiro/contas-a-pagar"
  icon={FileText}
  title="Caixa de entrada"
  description="Pedidos de Compra aguardando avaliação — aprovar ou rejeitar."
  count={ppsCount ?? 0}
/>
<FinanceiroCard
  href="/financeiro/a-pagar"
  icon={Wallet}
  title="A pagar"
  description="Aprovados aguardando pagamento — dar baixa quando o dinheiro sair."
  count={aPagarRes.count ?? 0}
/>
<FinanceiroCard
  href="/financeiro/fluxo-caixa"
  icon={TrendingUp}
  title="Fluxo de caixa"
  description="Previsto + realizado por dia, semana ou mês, com saldo projetado."
/>
```

Importar `Wallet` e `TrendingUp` de `lucide-react`.

- [ ] **Step 3: Build + smoke**

```powershell
npm run lint; if ($?) { npm run build }
```

Abrir `/financeiro`, ver os 5 cards, contadores corretos, navegação funciona.

- [ ] **Step 4: Commit**

```powershell
git add app/(app)/financeiro/page.tsx
git commit -m @'
task015: landing /financeiro — cards novos + "Caixa de entrada"

Renomeia "Contas a Pagar" -> "Caixa de entrada". Adiciona cards
"A pagar" (contagem via vw_a_pagar) e "Fluxo de caixa".
'@
```

---

## Task 11: Endurecer RPCs de baixa e estorno pra exigir/retornar `aprovada`

**Files:**
- Create: `supabase/migrations/20260812000005_baixa_rpcs_exigem_aprovada.sql`
- Modify: `app/(app)/financeiro/a-pagar/actions.ts` (remover fallback pra `em_avaliacao` em `marcarPagaFinanceiro`)

**Interfaces:**
- Consumes: status `aprovada` já em uso pelo front (Tasks 6, 7, 8).
- Produces:
  - `dar_baixa_pp` exige `status = 'aprovada'`.
  - `estornar_baixa_pp` devolve `status = 'aprovada'`.
  - `dar_baixa_avulsa` exige `status = 'aprovada'`.
  - `estornar_baixa_avulsa` devolve `status = 'aprovada'`.

- [ ] **Step 1: Criar migration**

`supabase/migrations/20260812000005_baixa_rpcs_exigem_aprovada.sql`:

```sql
-- =====================================================================
-- Endurece RPCs de baixa e estorno: exigem/retornam status='aprovada'
-- Ver spec: docs/superpowers/specs/2026-08-12-aprovacao-financeira-fluxo-caixa-design.md
-- =====================================================================

-- 1) dar_baixa_pp
create or replace function public.dar_baixa_pp(
  p_pp_id                    uuid,
  p_pago_em                  date,
  p_conta_bancaria_id        uuid,
  p_plano_conta_tipo_id      uuid,
  p_plano_conta_subtipo_id   uuid,
  p_criado_por               uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp             pedidos_compra%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if v_pp.status <> 'aprovada' then
    raise exception 'PP precisa estar aprovada antes da baixa (status atual: %).', v_pp.status;
  end if;

  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_pp.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da PP.';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo
    from public.plano_contas_subtipos where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  update public.pedidos_compra
     set status = 'pago',
         pago_em = p_pago_em,
         pago_por = p_criado_por
   where id = p_pp_id;

  v_descricao := 'PP ' || v_pp.codigo || ' — ' || substring(v_pp.servico, 1, 150);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, origem, criado_por
  ) values (
    v_pp.tenant_id, v_pp.empresa_id, p_conta_bancaria_id, p_pago_em, v_pp.valor,
    'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_pp.fornecedor_id, v_pp.job_id, v_pp.id, 'pp_baixa', p_criado_por
  )
  returning id into v_lancamento_id;

  return v_lancamento_id;
end;
$$;

-- 2) estornar_baixa_pp — devolve pra 'aprovada' (não 'em_avaliacao')
create or replace function public.estornar_baixa_pp(
  p_pp_id       uuid,
  p_motivo      text,
  p_criado_por  uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp             pedidos_compra%rowtype;
  v_original       lancamentos_financeiros%rowtype;
  v_reverso_id     uuid;
  v_descricao      text;
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if v_pp.status <> 'pago' then
    raise exception 'PP não está paga (status atual: %).', v_pp.status;
  end if;

  select * into v_original
    from public.lancamentos_financeiros
   where pedido_compra_id = p_pp_id and origem = 'pp_baixa'
   limit 1;
  if not found then raise exception 'Lançamento original não encontrado.'; end if;

  v_descricao := 'Estorno da baixa de ' || v_pp.codigo || ' — ' || substring(p_motivo, 1, 200);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id,
    estorno_de_lancamento_id, origem, criado_por
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    case when v_original.natureza = 'saida' then 'entrada'::natureza_lancamento
         else 'saida'::natureza_lancamento end,
    v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    v_original.fornecedor_id, v_original.job_id, v_original.pedido_compra_id,
    v_original.id, 'pp_estorno', p_criado_por
  )
  returning id into v_reverso_id;

  update public.lancamentos_financeiros
     set origem = 'pp_baixa_estornada'
   where id = v_original.id;

  -- Devolve pra aprovada (mantém aprovada_em/aprovada_por originais).
  update public.pedidos_compra
     set status = 'aprovada',
         pago_em = null,
         pago_por = null
   where id = p_pp_id;

  return v_reverso_id;
end;
$$;

-- 3) dar_baixa_avulsa — reescreve validação
--    (Ler assinatura real em 20260806000004_avulsa_rpcs.sql; espelhar aqui,
--    apenas trocando 'pendente' por 'aprovada' na validação de status.)
--    Placeholder de exemplo abaixo — implementador precisa copiar o corpo real
--    e ajustar apenas o `if v_avulsa.status <> 'pendente'` -> `'aprovada'`.
```

**Nota do implementador:** os corpos completos de `dar_baixa_avulsa` e `estornar_baixa_avulsa` estão em `supabase/migrations/20260806000004_avulsa_rpcs.sql`. Copiar cada `create or replace function` inteiro, trocando **apenas**:

- `dar_baixa_avulsa`: linha `if v_avulsa.status <> 'pendente'` → `if v_avulsa.status <> 'aprovada'` + mensagem de erro.
- `estornar_baixa_avulsa`: `update ... set status = 'pendente'` → `set status = 'aprovada'`.

Adicionar os dois `create or replace function` ao final da migration Task 11.

Aplicar via `mcp__supabase-write__apply_migration` com name `baixa_rpcs_exigem_aprovada`.

- [ ] **Step 2: Remover fallback em `a-pagar/actions.ts`**

No `marcarPagaFinanceiro`, o guard atual permite `em_avaliacao || aprovada`. Trocar pra exigir apenas `aprovada`:

```typescript
if (pp.status !== "aprovada") {
  return {
    ok: false,
    message: pp.status === "pago" ? "PP já está paga." : "Só PP aprovada pode ser baixada.",
  };
}
```

- [ ] **Step 3: Verificação SQL**

```sql
-- Estornar uma PP paga como teste isolado (fazer em ambiente dev)
-- Após estorno, status deve ser 'aprovada'
select id, status, aprovada_em from public.pedidos_compra
 where id = '<uuid_de_pp_estornada>';
```

- [ ] **Step 4: Smoke**

- Tentar dar baixa numa PP `em_avaliacao` via inspeção — deve dar erro amigável.
- Aprovar PP, dar baixa, estornar, verificar que volta pra `aprovada` (não `em_avaliacao`) — dá pra baixar de novo sem precisar aprovar de novo.

- [ ] **Step 5: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/20260812000005_baixa_rpcs_exigem_aprovada.sql app/(app)/financeiro/a-pagar/actions.ts
git commit -m @'
task015: RPCs de baixa exigem aprovada + estorno volta pra aprovada

dar_baixa_pp e dar_baixa_avulsa passam a rejeitar entradas que
não estejam em status='aprovada'. estornar_baixa_pp e estornar_baixa_avulsa
devolvem pra 'aprovada' (não 'em_avaliacao'/'pendente') — coerente
com o novo ciclo.
'@
```

---

## Task 12: Migration B — remover `'pendente'` do enum de avulsa

**Files:**
- Create: `supabase/migrations/20260812000006_avulsa_status_remove_pendente.sql`

**Interfaces:**
- Consumes: nenhum código de aplicação usa mais `'pendente'` (verificado nas Tasks 8 e 11).
- Produces: enum `conta_avulsa_status` reduzido a `('aprovada','baixada')`.

- [ ] **Step 1: Verificar que ninguém mais usa `'pendente'`**

```powershell
Select-String -Path "app/**/*.tsx","app/**/*.ts","lib/**/*.ts","supabase/migrations/*.sql" -Pattern "'pendente'"
```

Ignorar matches em migrations históricas (imutáveis). Todo match em código de aplicação → parar, voltar pra Task 8 e resolver.

```sql
-- Verificação em prod: nenhuma linha com pendente
select count(*) from public.contas_avulsas where status = 'pendente';
-- Deve ser 0.
```

- [ ] **Step 2: Criar migration**

`supabase/migrations/20260812000006_avulsa_status_remove_pendente.sql`:

```sql
-- =====================================================================
-- Contas avulsas — Migration B: remove valor 'pendente' do enum
-- Só rodar após confirmar via grep que nenhum código referencia 'pendente'
-- e que `select count(*) from contas_avulsas where status='pendente'` = 0.
-- Ver spec: docs/superpowers/specs/2026-08-12-aprovacao-financeira-fluxo-caixa-design.md
-- =====================================================================

-- 1. Guarda: aborta se ainda houver registros com pendente
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.contas_avulsas where status = 'pendente';
  if v_count > 0 then
    raise exception 'Ainda existem % contas avulsas com status=pendente. Migre antes de rodar esta migration.', v_count;
  end if;
end $$;

-- 2. Renomeia enum antigo, cria enum novo sem 'pendente', migra a coluna
alter type conta_avulsa_status rename to conta_avulsa_status_old;

create type conta_avulsa_status as enum ('aprovada','baixada');

alter table public.contas_avulsas
  alter column status drop default;

alter table public.contas_avulsas
  alter column status type conta_avulsa_status
  using status::text::conta_avulsa_status;

alter table public.contas_avulsas
  alter column status set default 'aprovada';

drop type conta_avulsa_status_old;
```

Aplicar via `mcp__supabase-write__apply_migration` com name `avulsa_status_remove_pendente`.

- [ ] **Step 3: Verificação SQL**

```sql
select unnest(enum_range(null::conta_avulsa_status))::text;
-- Deve retornar apenas: aprovada, baixada
```

- [ ] **Step 4: Build**

```powershell
npm run lint; if ($?) { npm run build }
```

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/20260812000006_avulsa_status_remove_pendente.sql
git commit -m @'
task015: remove valor 'pendente' do enum conta_avulsa_status

Migration B (fecha o ciclo two-step iniciado na task 015 Migration A).
Enum agora tem só ('aprovada','baixada'). Guarda inicial aborta se
sobrar qualquer linha com pendente (não deve — mas garante).
'@
```

---

## Task 13 (opcional): Atualizar HANDOFF + memória

**Files:**
- Modify: `docs/HANDOFF.md` (se relevante ao estado atual do projeto)
- Modify: `CLAUDE.md` (adicionar linha na sequência de banco por task, se seguirem essa convenção)

**Interfaces:**
- Consumes: nada.
- Produces: documentação atualizada.

- [ ] **Step 1: Adicionar nota em `docs/HANDOFF.md`**

Seção "Fluxo financeiro" (ou criar se não existir):

```markdown
## Fluxo financeiro (task 015)

Ciclo:
- PP: em_avaliacao (caixa de entrada) → aprovada (A pagar) → pago (Conciliação)
- Avulsa/Recorrente: aprovada (nasce) → baixada
- Views: vw_a_pagar (previsto) e vw_fluxo_caixa (previsto + realizado)

Telas:
- /financeiro/contas-a-pagar — Caixa de entrada (aprovar/rejeitar PPs)
- /financeiro/a-pagar — dar baixa em aprovados
- /financeiro/fluxo-caixa — projeção
- /financeiro/conciliacao — só realizado
```

- [ ] **Step 2: Adicionar linha na sequência do CLAUDE.md**

```markdown
- Task 015 introduz aprovação financeira, tela "A pagar" e "Fluxo de caixa"; renomeia contas_avulsas.status pendente→aprovada.
```

- [ ] **Step 3: Commit**

```powershell
git add docs/HANDOFF.md CLAUDE.md
git commit -m "task015: docs — HANDOFF e sequência CLAUDE.md"
```

---

## Self-Review

**1. Spec coverage:**

| Spec | Task |
|---|---|
| PP ganha status `aprovada` + auditoria | Task 1 |
| RPC `aprovar_pp` | Task 1 |
| RPC `desaprovar_pp` | Task 1 |
| Avulsa: renomear `pendente` → `aprovada` (Migration A) | Task 2 |
| Retro fill de `aprovada_em`/`aprovada_por` nas avulsas | Task 2 |
| Recorrentes geram `aprovada` | Task 3 |
| Views `vw_a_pagar` e `vw_fluxo_caixa` | Task 4 |
| Índices partial em `pedidos_compra` e `contas_avulsas` por status aprovada | Task 1 e Task 2 |
| Server actions `aprovarPP`/`desaprovarPP` | Task 5 |
| Caixa de entrada só mostra aprovar/rejeitar | Task 6 |
| Nova tela "A pagar" | Task 7 |
| UI avulsas migra pra `aprovada` + remove baixa daqui | Task 8 |
| Nova tela "Fluxo de caixa" | Task 9 |
| Landing `/financeiro` com cards novos | Task 10 |
| Endurecer `dar_baixa_pp` pra exigir `aprovada`; `estornar_*` volta pra `aprovada` | Task 11 |
| Migration B — remove `pendente` do enum | Task 12 |
| Conciliação intacta | (validado nas tasks — nenhuma migration/UI mexe nela) |

Todos os pontos da spec estão cobertos.

**2. Placeholder scan:**

- Task 7 Step 3 tem `BaixaDialog` como esqueleto com instrução clara pra copiar `baixa-pp-modal.tsx` → arquivo compartilhado. Isso é intencional (evita duplicar 200+ linhas de código no plano); o implementador tem instrução exata de onde buscar. Aceito.
- Task 11 Step 1 tem "Placeholder de exemplo" pras RPCs de avulsa com instrução exata (copiar da migration `20260806000004_avulsa_rpcs.sql`, trocar só a linha de status). Aceito — evita duplicar 100+ linhas SQL sem valor.
- Nenhum "TBD" real.

**3. Type consistency:**

- `PPStatus`: `"em_avaliacao" | "aprovada" | "pago" | "rejeitada" | "cancelada"` (Task 1). Usado em Tasks 5, 6, 7.
- `ContaAvulsaStatus`: `"aprovada" | "baixada"` (Task 8, final estado após Task 12). Task 2 mantém `"pendente"` temporário como valor de enum SQL só.
- View shapes definidas em Task 4 → consumidas em Tasks 7 e 9 com os mesmos nomes.
- RPC `aprovar_pp(uuid) → void` (Task 1) chamada em `aprovarPP` (Task 5) com `p_pp_id`. Consistente.
- RPC `desaprovar_pp(uuid, text) → void` (Task 1) chamada em `desaprovarPP` (Task 5) com `p_pp_id`, `p_motivo`. Consistente.

Sem inconsistências.

**4. Escopo:** 12 tasks (mais uma opcional de docs). Cada task tem deliverable independente e testável, com steps de 2-5 min. Total ~2-3 dias de trabalho pra 1 dev. Cabe num único plano — não precisa decompor.
