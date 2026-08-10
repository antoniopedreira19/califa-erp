# Contas Avulsas — Design

**Data:** 2026-08-06
**Autor:** Antonio + Claude
**Status:** Aguardando revisão do Antonio antes do plano de implementação.

## 1. Contexto

Hoje a página `/financeiro/pedidos-compra` (label "Contas a Pagar") mostra apenas PPs — os pedidos de compra emitidos pelos GPs. Faltam as **contas avulsas administrativas** que a California paga fora do fluxo produtivo: aluguel, salário, tarifa bancária, imposto, folha, distribuição de lucro, etc.

A tabela `lancamentos_financeiros` já suporta `origem='manual'` (avulso) em modelagem, mas ninguém pode criar avulso pela UI. Foi projetada como "verdade do movimento realizado", não como "obrigação pendente".

Esta spec introduz o par **`contas_avulsas` (obrigação pendente) ↔ `lancamentos_financeiros` (movimento realizado)** — espelho do que hoje existe pra PPs (`pedidos_compra` ↔ `lancamentos_financeiros` via `origem='pp_baixa'`).

## 2. Objetivo

Habilitar o financeiro a lançar, dar baixa e estornar contas avulsas, com histórico auditável e anexos opcionais. A página `/financeiro/pedidos-compra` é renomeada pra `/financeiro/contas-a-pagar` e recebe 2 tabs: **"Pedidos de Compra"** (o que já existe, sem mudanças) e **"Lançamentos Avulsos"** (nova).

Entrega:

1. Modelagem: 3 tabelas novas + ajustes em `lancamentos_financeiros` + 1 bucket novo.
2. 2 RPCs transacionais: `dar_baixa_avulsa`, `estornar_baixa_avulsa`.
3. Rename da rota `/financeiro/pedidos-compra/**` → `/financeiro/contas-a-pagar/**`.
4. Tabs na página, aba "Lançamentos Avulsos" com CRUD completo.
5. Página de detalhes `/financeiro/contas-a-pagar/avulsa/[id]` com histórico de mudanças exposto.
6. Botão "Nova Conta Avulsa" abre drawer com form completo + upload de anexos.

## 3. Decisões arquiteturais

Todas fechadas em conversa com Antonio antes de escrever esta spec.

### 3.1. Nova tabela `contas_avulsas`, não status na `lancamentos_financeiros`

Espelha o par `pedidos_compra ↔ lancamentos_financeiros`. `lancamentos_financeiros` continua sendo "verdade do movimento realizado que afeta saldo". Query de saldo/conciliação não muda.

Alternativa rejeitada: adicionar `status pendente|pago` na `lancamentos_financeiros`. Poluiria a semântica — toda query de saldo passaria a precisar `WHERE status='pago'`, e "não pago" viveria no mesmo lugar de "pago", confundindo o modelo.

### 3.2. Empresa imutável após criação

Trocar empresa depois muda toda a semântica: contas bancárias possíveis mudam, o registro contábil muda, o histórico fica ambíguo. Se o financeiro errou empresa, **exclui a conta** (hard delete se pendente, estorno se baixada) e cria uma nova.

### 3.3. Histórico exposto ao usuário via tabela dedicada

Nova tabela `contas_avulsas_historico` com colunas explícitas (`campo_alterado`, `valor_anterior`, `valor_novo`, `alterado_por`, `alterado_em`). Renderização direta na tela de detalhes.

Alternativa rejeitada: view sobre `audit_events` (jsonb metadata). Reusa infraestrutura, mas complica renderização e query.

### 3.4. Fluxo de vida

| Estado | Descrição | Editável? |
|---|---|---|
| `pendente` | Nasce assim. Não afeta saldo. Aparece na Contas a Pagar (aba Avulsas, chip "Pendentes"). | Sim (todos campos exceto `empresa_id`). Cada mudança vira row em `contas_avulsas_historico`. |
| `baixada` | Recebeu baixa. Gerou lançamento em `lancamentos_financeiros` com `origem='avulsa_baixa'`. Afeta saldo. Aparece na Contas a Pagar (chip "Baixadas") e na Conciliação. | Não. Pra corrigir, precisa estornar. |

**Exclusão pendente**: hard delete. Nunca gerou lançamento, então não afeta saldo. Audit em `audit_events`.

**Estorno da baixa**: RPC `estornar_baixa_avulsa` insere lançamento reverso em `lancamentos_financeiros` (`origem='avulsa_estorno'`), atualiza lançamento original pra `origem='avulsa_baixa_estornada'` (libera unique parcial pra rebaixa), e **volta o status da conta pra `pendente`**. Pode ser editada e rebaixada.

### 3.5. Chips de filtro em ambas as abas

Aba PPs mantém chips atuais (`Em avaliação | Pago | Rejeitado | Cancelada | Todas`). Aba Avulsas ganha chips análogos (`Pendentes | Baixadas | Todas`). Pagas/baixadas ficam visíveis tanto na Contas a Pagar (filtro) quanto na Conciliação (extrato por conta).

### 3.6. Ajuste em `lancamentos_financeiros`

Adicionar coluna `conta_avulsa_id uuid null references contas_avulsas(id)` + 3 novos values no enum `origem_lancamento`: `avulsa_baixa`, `avulsa_baixa_estornada`, `avulsa_estorno`. Enum `manual` deixa de ser criável (fica reservado pra futuro se aparecer necessidade — hoje toda origem tem raiz em PP ou avulsa).

CHECK atualizado:
- `avulsa_*` obriga `conta_avulsa_id NOT NULL` + `pedido_compra_id NULL`.
- `pp_*` obriga `pedido_compra_id NOT NULL` + `conta_avulsa_id NULL`.
- `manual` (legacy, sem uso): ambos NULL.

### 3.7. Nomenclatura

- **Aba** = "Lançamentos Avulsos" (nome do menu do usuário).
- **Tabela** = `contas_avulsas` (nome técnico).
- **Página de detalhes** = `/financeiro/contas-a-pagar/avulsa/[id]`.

Diferença intencional: "conta avulsa" é a obrigação; "lançamento avulso" é o rótulo UX simplificado ("é você lançando algo manualmente"). Consistente com o padrão que o Antonio já tinha em mente.

### 3.8. Data prevista de pagamento

Coluna `data_prevista_pagamento date NULL` na `contas_avulsas`. Opcional (o financeiro pode registrar uma conta sem data prevista). Serve pra:
- Ordenação padrão na lista (pendentes ordenam por data prevista ASC — próximos vencimentos no topo).
- Futura tela de "fluxo de caixa projetado" (fora de escopo agora).

### 3.9. Anexos opcionais

Bucket novo `contas-avulsas` (privado, path prefix = tenant_id). Tabela `contas_avulsas_anexos` (mesmo padrão de `pedidos_compra_anexos`). Nenhum anexo é obrigatório — tarifa bancária de R$ 5 pode ir sem comprovante. UI mostra hint "Anexe comprovantes se houver".

## 4. Modelagem de dados

### 4.1. `contas_avulsas`

```sql
create type conta_avulsa_status as enum ('pendente', 'baixada');

create table public.contas_avulsas (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete restrict,
  empresa_id                  uuid not null references public.empresas(id) on delete restrict,
  descricao                   text not null,
  valor                       numeric(14,2) not null,
  natureza                    natureza_lancamento not null,  -- entrada|saida (reusa enum existente)
  data_prevista_pagamento     date,
  status                      conta_avulsa_status not null default 'pendente',

  -- Contra-parte opcional
  fornecedor_id               uuid references public.fornecedores(id) on delete restrict,
  cliente_id                  uuid references public.clientes(id) on delete restrict,
  job_id                      uuid references public.jobs(id) on delete restrict,

  -- Plano de contas obrigatório
  plano_conta_tipo_id         uuid not null references public.plano_contas_tipos(id) on delete restrict,
  plano_conta_subtipo_id      uuid not null references public.plano_contas_subtipos(id) on delete restrict,

  -- Dados de baixa (preenchem no momento da baixa)
  pago_em                     date,
  pago_por                    uuid references public.profiles(id),
  conta_bancaria_baixa_id     uuid references public.contas_bancarias(id) on delete restrict,

  criado_por                  uuid not null references public.profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint chk_avulsa_valor_positivo check (valor > 0),
  constraint chk_avulsa_descricao_nao_vazia check (length(trim(descricao)) >= 3),

  -- Se baixada, os 3 campos de baixa devem estar preenchidos; se pendente, todos nulos.
  constraint chk_avulsa_baixa_consistente check (
    (status = 'baixada'
      and pago_em is not null
      and pago_por is not null
      and conta_bancaria_baixa_id is not null)
    or
    (status = 'pendente'
      and pago_em is null
      and pago_por is null
      and conta_bancaria_baixa_id is null)
  ),

  -- Só uma contra-parte por conta (fornecedor OU cliente, não os dois)
  constraint chk_avulsa_contraparte_unica check (
    not (fornecedor_id is not null and cliente_id is not null)
  )
);

create index idx_avulsas_tenant on public.contas_avulsas(tenant_id);
create index idx_avulsas_empresa on public.contas_avulsas(empresa_id);
create index idx_avulsas_status on public.contas_avulsas(tenant_id, status);
create index idx_avulsas_data_prevista on public.contas_avulsas(tenant_id, data_prevista_pagamento);
create index idx_avulsas_fornecedor on public.contas_avulsas(fornecedor_id);
create index idx_avulsas_cliente on public.contas_avulsas(cliente_id);
create index idx_avulsas_job on public.contas_avulsas(job_id);

create trigger trg_avulsas_updated_at
  before update on public.contas_avulsas
  for each row execute function public.set_updated_at();

alter table public.contas_avulsas enable row level security;

create policy avulsas_select on public.contas_avulsas
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy avulsas_insert on public.contas_avulsas
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
create policy avulsas_update on public.contas_avulsas
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
create policy avulsas_delete on public.contas_avulsas
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.contas_avulsas to authenticated;
```

**Notas:**
- `natureza` reusa o enum `natureza_lancamento` já existente. Faz sentido em avulsa? Sim — recebimento avulso (natureza `entrada`) tipo estorno de fornecedor ou reembolso; pagamento avulso (natureza `saida`) tipo aluguel, salário. O default UX é `saida` (é o caso comum, "contas a pagar" implica saída).
- `data_prevista_pagamento` NULL — opcional. Ordenação da lista pendentes: `NULLS LAST`.
- `chk_avulsa_baixa_consistente` garante que os 3 campos de baixa sempre andam juntos.
- `chk_avulsa_contraparte_unica` impede fornecedor + cliente na mesma conta (sem sentido; um dos dois, ou nenhum se for lançamento interno tipo folha).
- `DELETE` policy existe (contrário do padrão do projeto) porque exclusão de pendente é hard delete real. Server action tem gate próprio de status.

### 4.2. `contas_avulsas_anexos`

```sql
create table public.contas_avulsas_anexos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  conta_avulsa_id       uuid not null references public.contas_avulsas(id) on delete cascade,
  arquivo_path          text not null,
  arquivo_nome_original text not null,
  arquivo_tamanho_bytes bigint not null,
  arquivo_mimetype      text not null,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  constraint chk_anexo_avulsa_tamanho_positivo check (arquivo_tamanho_bytes > 0)
);

create index idx_avulsa_anexos_conta on public.contas_avulsas_anexos(conta_avulsa_id);
create index idx_avulsa_anexos_tenant on public.contas_avulsas_anexos(tenant_id);

alter table public.contas_avulsas_anexos enable row level security;

create policy avulsa_anexos_select on public.contas_avulsas_anexos
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy avulsa_anexos_insert on public.contas_avulsas_anexos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
create policy avulsa_anexos_delete on public.contas_avulsas_anexos
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, delete on public.contas_avulsas_anexos to authenticated;
```

**Nota:** `on delete cascade` faz sentido aqui — se apagar conta avulsa (só pendente), os anexos vão junto. Contas baixadas não se apaga.

### 4.3. `contas_avulsas_historico`

```sql
create table public.contas_avulsas_historico (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  conta_avulsa_id   uuid not null references public.contas_avulsas(id) on delete cascade,
  campo_alterado    varchar(60) not null,   -- 'descricao' | 'valor' | 'natureza' | ...
  valor_anterior    text,                    -- textual pra qualquer tipo (numeric vira string)
  valor_novo        text,
  alterado_por      uuid not null references public.profiles(id),
  alterado_em       timestamptz not null default now()
);

create index idx_avulsa_hist_conta on public.contas_avulsas_historico(conta_avulsa_id, alterado_em desc);
create index idx_avulsa_hist_tenant on public.contas_avulsas_historico(tenant_id);

alter table public.contas_avulsas_historico enable row level security;

create policy avulsa_hist_select on public.contas_avulsas_historico
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy avulsa_hist_insert on public.contas_avulsas_historico
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
-- Sem UPDATE, sem DELETE — histórico é imutável.

grant select, insert on public.contas_avulsas_historico to authenticated;
```

**Notas:**
- Colunas `valor_anterior` e `valor_novo` são `text` pra suportar qualquer tipo de campo (numeric, date, uuid, enum). Renderização adapta.
- Índice descendente por `alterado_em` — tela de detalhes lista do mais recente ao mais antigo.
- Só INSERT e SELECT nas policies — histórico não muda, não some.

### 4.4. Ajustes em `lancamentos_financeiros`

```sql
-- 1) Nova coluna
alter table public.lancamentos_financeiros
  add column conta_avulsa_id uuid references public.contas_avulsas(id) on delete restrict;

create index idx_lanc_avulsa on public.lancamentos_financeiros(conta_avulsa_id);

-- 2) Adicionar valores ao enum origem_lancamento
alter type origem_lancamento add value if not exists 'avulsa_baixa';
alter type origem_lancamento add value if not exists 'avulsa_baixa_estornada';
alter type origem_lancamento add value if not exists 'avulsa_estorno';

-- 3) Substituir chk_origem_pp_tem_pp_id por chk_origem_tem_referencia
alter table public.lancamentos_financeiros
  drop constraint chk_origem_pp_tem_pp_id;

alter table public.lancamentos_financeiros
  add constraint chk_origem_tem_referencia check (
    (origem in ('pp_baixa','pp_baixa_estornada','pp_estorno')
      and pedido_compra_id is not null and conta_avulsa_id is null)
    or
    (origem in ('avulsa_baixa','avulsa_baixa_estornada','avulsa_estorno')
      and conta_avulsa_id is not null and pedido_compra_id is null)
    or
    (origem = 'manual' and pedido_compra_id is null and conta_avulsa_id is null)
  );

-- 4) Substituir chk_estorno_consistente pra cobrir avulsa_estorno também
alter table public.lancamentos_financeiros
  drop constraint chk_estorno_consistente;

alter table public.lancamentos_financeiros
  add constraint chk_estorno_consistente check (
    (origem in ('pp_estorno','avulsa_estorno') and estorno_de_lancamento_id is not null)
    or
    (origem not in ('pp_estorno','avulsa_estorno') and estorno_de_lancamento_id is null)
  );

-- 5) Unique parcial pra baixa ativa por conta avulsa (espelho do da PP)
create unique index uniq_baixa_ativa_por_avulsa
  on public.lancamentos_financeiros(conta_avulsa_id)
  where origem = 'avulsa_baixa';
```

**Nota crítica sobre enum:** `alter type ... add value` em Postgres não pode ser usado no mesmo statement que insere valores desse enum. As migrations rodam em transações — separá-las em 2 migrations (uma pra `alter type`, outra pra tudo mais) é o padrão seguro. Detalhe na seção 10.

## 5. Regras de negócio

### 5.1. Criar conta avulsa (`criarContaAvulsa`)

Assinatura:

```ts
export async function criarContaAvulsa(input: {
  empresa_id: string;
  descricao: string;
  valor: number;
  natureza: 'entrada' | 'saida';
  data_prevista_pagamento: string | null;  // YYYY-MM-DD
  fornecedor_id: string | null;
  cliente_id: string | null;
  job_id: string | null;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
  anexos: Array<{ path: string; nome: string; tamanho: number; mimetype: string }>;
}): Promise<Result>
```

Validações:
- Gate `admin | financeiro`.
- Zod parse.
- `subtipo.tipo_id === tipo_id` (subtipo pertence ao tipo).
- Todos ativos: empresa, tipo, subtipo.
- Fornecedor OU cliente OU nenhum — nunca os dois (o CHECK do banco também garante).
- Anexos: paths devem existir no bucket `contas-avulsas` (verificar via `supabase.storage.list`).

Transação:
1. INSERT `contas_avulsas` com `status='pendente'`, `criado_por=session.profile.id`.
2. INSERT bulk `contas_avulsas_anexos`.
3. Audit `conta_avulsa.criada` com metadata.

Revalida: `/financeiro/contas-a-pagar` + `/financeiro/contas-a-pagar/avulsa/{id}`.

### 5.2. Editar conta avulsa pendente (`editarContaAvulsa`)

Só permite se `status='pendente'`. `empresa_id` bloqueado (nem chega no schema Zod).

Comparação campo a campo entre `atual` e `input`. Pra cada campo diferente:
- INSERT `contas_avulsas_historico` com `campo_alterado, valor_anterior, valor_novo, alterado_por=session.profile.id`.

Depois UPDATE `contas_avulsas` com todos os novos valores.

Audit consolidado `conta_avulsa.editada` com `campos_alterados: string[]` no metadata.

### 5.3. Excluir conta avulsa pendente (`excluirContaAvulsa`)

Só permite se `status='pendente'`. Hard delete:
1. `DELETE FROM contas_avulsas WHERE id = ?` — cascade apaga anexos e histórico.
2. Delete dos arquivos no bucket via `supabase.storage.remove`.
3. Audit `conta_avulsa.excluida` com metadata (`descricao`, `valor`, `natureza`).

Não pode excluir baixada — mensagem "Baixa registrada. Para reverter, estorne a baixa primeiro."

### 5.4. Dar baixa em conta avulsa (`darBaixaAvulsa`)

Assinatura:

```ts
export async function darBaixaAvulsa(input: {
  conta_avulsa_id: string;
  pago_em: string;  // YYYY-MM-DD
  conta_bancaria_id: string;
}): Promise<Result>
```

Via RPC `dar_baixa_avulsa(p_conta_avulsa_id, p_pago_em, p_conta_bancaria_id)` transacional (SECURITY DEFINER, `criado_por` derivado internamente de `auth.uid()` — mesmo padrão do hardening das RPCs de PP; parâmetro `p_criado_por` não existe pra evitar spoofing):

Validações no RPC (ordem):
1. `v_caller_uid := auth.uid()`; se null, `raise exception 'Sessão inválida.'`
2. Load `v_avulsa from contas_avulsas where id = p_conta_avulsa_id`; se not found, exception.
3. `if not is_tenant_member(v_avulsa.tenant_id) then raise exception 'Sem permissão.'`
4. `if v_avulsa.status <> 'pendente' then raise exception 'Conta avulsa não está pendente.'`
5. Load `v_conta_bancaria from contas_bancarias where id = p_conta_bancaria_id`; se not found, exception.
6. `if v_conta_bancaria.empresa_id <> v_avulsa.empresa_id then raise exception 'Conta bancária não pertence à empresa da conta avulsa.'`
7. `if not v_conta_bancaria.ativo then raise exception 'Conta bancária está inativa.'`
8. `if p_pago_em < v_conta_bancaria.saldo_inicial_data then raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.'`

Mutações (mesma transação):
1. UPDATE `contas_avulsas` SET `status='baixada'`, `pago_em = p_pago_em`, `pago_por = v_caller_uid`, `conta_bancaria_baixa_id = p_conta_bancaria_id`.
2. INSERT `lancamentos_financeiros`:
   - `origem='avulsa_baixa'`
   - `conta_avulsa_id` = da avulsa
   - `natureza` = da avulsa (preservada; avulsa de entrada gera lançamento de entrada)
   - `valor` = da avulsa
   - `descricao = 'Avulsa ' || v_avulsa.descricao` (truncado 200)
   - `data_movimento = pago_em`
   - `empresa_id`, `fornecedor_id`, `cliente_id`, `job_id` copiados
   - `plano_conta_tipo_id`, `plano_conta_subtipo_id` copiados
   - `conta_bancaria_id = p_conta_bancaria_id`

Audit: `conta_avulsa.baixada` + `lancamento_financeiro.criado`.

### 5.5. Estornar baixa (`estornarBaixaAvulsa`)

Via RPC `estornar_baixa_avulsa(p_conta_avulsa_id, p_motivo)`. Espelho de `estornar_baixa_pp` — `criado_por` derivado de `auth.uid()`:

Validações no RPC:
1. `v_caller_uid := auth.uid()`; se null, exception.
2. Load `v_avulsa`; se not found ou tenant mismatch, exception.
3. `v_avulsa.status = 'baixada'` obrigatório.
4. Load lançamento original (`origem='avulsa_baixa'` where `conta_avulsa_id = p_conta_avulsa_id`); se not found, exception.

Mutações (mesma transação):
1. INSERT lançamento reverso com natureza invertida, `origem='avulsa_estorno'`, `estorno_de_lancamento_id = original.id`, `data_movimento = current_date`, `criado_por = v_caller_uid`, `descricao = 'Estorno da baixa de ' || v_avulsa.descricao || ' — ' || substring(p_motivo, 1, 200)`.
2. UPDATE lançamento original: `origem = 'avulsa_baixa_estornada'` (libera unique parcial).
3. UPDATE `contas_avulsas`: `status = 'pendente'`, `pago_em = null`, `pago_por = null`, `conta_bancaria_baixa_id = null`.

Audit: `conta_avulsa.baixa_estornada` + `lancamento_financeiro.estornado`.

Motivo obrigatório (min 10, max 500 chars) — validado no server action antes de chamar o RPC.

### 5.6. Empresa imutável

Enforcement em 2 camadas:
- Zod schema de `editarContaAvulsa` não aceita `empresa_id`.
- Se algum caller tentar passar, ignora (não usa no UPDATE).

Não precisa trigger de banco — o único caminho de write é o server action.

## 6. Server actions + RPCs

Arquivo novo: `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts` (adotando o rename da rota).

Actions:
- `criarContaAvulsa(input)` — 5.1
- `editarContaAvulsa(id, input)` — 5.2
- `excluirContaAvulsa(id)` — 5.3
- `darBaixaAvulsa(input)` — 5.4 (chama RPC)
- `estornarBaixaAvulsa(input)` — 5.5 (chama RPC)
- `signedUrlAnexoAvulsa(anexo_id)` — reusável, gera signed URL do bucket

Todas com gate `admin | financeiro` via helper `checarGateFinanceiro` (adaptado do existente pra aceitar `entidade_tipo = 'conta_avulsa'`).

RPCs Postgres:
- `dar_baixa_avulsa(uuid, date, uuid)` — SECURITY DEFINER, derive `criado_por` de `auth.uid()` (mesmo padrão do fix hardening das RPCs de PP).
- `estornar_baixa_avulsa(uuid, text)` — mesmo padrão.

Migração das RPCs numa migration separada da definição do enum novo (ver seção 10).

## 7. UI

### 7.1. Rename da rota

`app/(app)/financeiro/pedidos-compra/**` → `app/(app)/financeiro/contas-a-pagar/**`.

Refs a atualizar:
- `app/(app)/financeiro/page.tsx` (card do hub) — href muda.
- `revalidatePath` em todas as actions financeiras que revalidavam a rota antiga.
- Nenhum `<Link>` externo aponta pra rota antiga (verificado via grep — só a página em si, o hub, e o `revalidatePath` das actions).

Nenhum redirect legacy — o Antonio confirmou que o rename limpo é OK (sistema interno, sem links externos publicados).

### 7.2. Tabs

Novo componente `<ContasPagarTabs>` copiando o padrão de `<JobTabs>` (`app/(app)/jobs/[jobId]/job-tabs.tsx`) — CSS puro, sem Radix, state local.

Duas abas:
- **"Pedidos de Compra"** — renderiza `<PedidosCompraList>` (existente).
- **"Lançamentos Avulsos"** — renderiza `<ContasAvulsasList>` (novo).

Badge de contagem em cada aba com o número de itens pendentes (PPs em avaliação | avulsas pendentes).

### 7.3. Aba "Pedidos de Compra"

Sem mudanças no componente `<PedidosCompraList>`. Chips atuais mantidos (`Em avaliação | Pago | Rejeitado | Cancelada | Todas`). É só extrair pra dentro da tab.

### 7.4. Aba "Lançamentos Avulsos"

Nova lista `<ContasAvulsasList>`:

- Botão "Nova Conta Avulsa" (`Plus` icon) no canto direito da barra de filtros.
- Busca por descrição + fornecedor + job.
- Chips de status: `Pendentes | Baixadas | Todas`.
- Chips de natureza: `Saída | Entrada | Todas` (default "Todas" — a maioria será saída).
- Colunas: Data Prevista | Descrição | Fornecedor/Cliente | Job | Empresa | Tipo/Subtipo | Valor | Status | Anexos (contagem) | Ações.
- Ordenação padrão: pendentes por `data_prevista_pagamento ASC NULLS LAST`, baixadas por `pago_em DESC`.
- Row click → navega pra `/financeiro/contas-a-pagar/avulsa/{id}`.

### 7.5. Drawer "Nova Conta Avulsa" / "Editar Conta Avulsa"

Componente `<ContaAvulsaDrawer>`:

- Modo `criar` → todos campos abertos.
- Modo `editar` → só se `status='pendente'`. Todos os campos editáveis EXCETO `empresa_id` (input desabilitado com hint "Empresa não pode ser alterada. Se estiver errada, exclua esta conta e crie outra.").

Campos:
- Empresa* (Select de empresas ativas) — disabled em edit
- Natureza* (radio: Saída / Entrada — default Saída)
- Descrição* (textarea 3 rows, max 500)
- Valor* (input currency)
- Data prevista de pagamento (DatePicker opcional)
- Fornecedor (Combobox com busca, opcional)
- Cliente (Combobox com busca, opcional — mutuamente exclusivo com fornecedor via UI)
- Job (Combobox com busca, opcional)
- Tipo* (Select de tipos ativos)
- Subtipo* (Select filtrado por tipo)
- Anexos (upload multi-arquivo, drag-and-drop, opcional — cliente faz upload direto pro bucket, action valida path)

Botão "Criar" (verde emerald) ou "Salvar" (california-red em edit).

### 7.6. Página de detalhes `/financeiro/contas-a-pagar/avulsa/[id]`

Layout (max-w-7xl):

- Header com breadcrumb `Financeiro > Contas a Pagar > {descricao truncada}`.
- Badge de status (Pendente cinza-âmbar / Baixada verde).
- Card **Metadata**: fornecedor/cliente/job/empresa/data prevista/plano de contas/valor/natureza (todos read-only formatados).
- Card **Baixa** (só se `status='baixada'`): pago em / pago por / conta bancária.
- Card **Anexos**: lista dos arquivos com download (signed URL).
- Card **Histórico de mudanças**: tabela com Data/Hora | Usuário | Campo | Valor anterior | Valor novo. Ordenado desc.
- Rodapé com ações contextuais:
  - Status `pendente`: [Editar] [Excluir] [Dar baixa]
  - Status `baixada`: [Cancelar baixa]

Modais reusam padrão dos existentes de PP:
- `<BaixaAvulsaModal>` (form com data pago + conta bancária) — copiado de `<BaixaPPModal>` adaptado.
- `<CancelarBaixaAvulsaModal>` (textarea de motivo) — copiado de `<CancelarBaixaModal>` adaptado.
- `<ConfirmDialog>` pra excluir.

### 7.7. Sidebar + hub

Sem mudanças na sidebar (`Financeiro` já aponta pro hub).

Hub `/financeiro/page.tsx`: card "Contas a Pagar" muda href de `/financeiro/pedidos-compra` pra `/financeiro/contas-a-pagar`. Descrição atualiza pra mencionar as 2 naturezas de conta.

### 7.8. Conciliação — nada muda

A tela `/financeiro/conciliacao` já lê `lancamentos_financeiros` filtrado por `data_movimento`. Ao dar baixa numa avulsa, um novo lançamento aparece na conta bancária escolhida — automático, sem alteração de código na conciliação. Descrição vem como "Avulsa {descricao_da_conta_avulsa}", e o `origem='avulsa_baixa'` já é considerado no map de badge (adicionar chip "Avulsa" ao lado do "PP" existente).

Ajuste mínimo em `conciliacao-list.tsx`: se `origem in ('avulsa_baixa','avulsa_baixa_estornada','avulsa_estorno')`, mostrar badge "Avulsa" (mesmo padrão visual do "PP"). Se `origem='avulsa_baixa_estornada'`, aplicar strikethrough (mesmo padrão).

## 8. RLS + GRANTs + Auditoria

Padrão do projeto:
- Todas as 3 tabelas novas com RLS `is_tenant_member(tenant_id)`.
- Gate `admin | financeiro` nas server actions.
- **Sem DELETE policy em `contas_avulsas_historico`** (histórico imutável).
- **COM DELETE policy em `contas_avulsas` e `contas_avulsas_anexos`** — server action controla o gate (só permite se pendente).

Novas ações auditadas via `log_audit_event`:
- `conta_avulsa.criada`
- `conta_avulsa.editada` (metadata: `campos_alterados: string[]`)
- `conta_avulsa.excluida`
- `conta_avulsa.baixada`
- `conta_avulsa.baixa_estornada`
- Denials via `acao_negada` (padrão).

Reusa `lancamento_financeiro.criado` e `lancamento_financeiro.estornado` (já existem — só ganham `origem='avulsa_*'` no metadata).

## 9. Storage

Bucket privado novo `contas-avulsas`, path prefix = `tenant_id/conta_avulsa_id/{uuid}-{filename}`.

Policies em `storage.objects` (idênticas ao padrão de `pedidos-compra`):
- `avulsas_storage_select` — `is_tenant_member((split_part(name, '/', 1))::uuid)`
- `avulsas_storage_insert` — mesmo
- `avulsas_storage_delete` — mesmo

Upload em 2 fases (cliente sobe direto, server action valida path). Formatos aceitos: PDF, imagens (jpg, png, webp), Excel/CSV, txt. Max 8 MB por arquivo, 25 MB total (mesmo padrão da PP).

## 10. Migrations

### Ordem obrigatória (3 migrations, split por causa do ADD VALUE no enum)

**`20260806000001_contas_avulsas.sql`:**
- CREATE TYPE `conta_avulsa_status`.
- CREATE TABLE `contas_avulsas` + trigger `set_updated_at` + RLS + GRANT.
- CREATE TABLE `contas_avulsas_anexos` + RLS + GRANT.
- CREATE TABLE `contas_avulsas_historico` + RLS + GRANT.
- Bucket `contas-avulsas` + storage policies.

**`20260806000002_lancamentos_avulsa_enum.sql`:**
- `ALTER TYPE origem_lancamento ADD VALUE 'avulsa_baixa'`.
- `ALTER TYPE origem_lancamento ADD VALUE 'avulsa_baixa_estornada'`.
- `ALTER TYPE origem_lancamento ADD VALUE 'avulsa_estorno'`.

**Nota Postgres:** `ADD VALUE` não pode ser usado em transação com statements que **usam** o valor recém-adicionado. Split em migration separada resolve — cada migration é 1 transação, e a próxima migration pode livremente usar os valores.

**`20260806000003_lancamentos_avulsa_wiring.sql`:**
- `ALTER TABLE lancamentos_financeiros ADD COLUMN conta_avulsa_id ...`.
- Substituir CHECK `chk_origem_pp_tem_pp_id` por `chk_origem_tem_referencia`.
- Substituir CHECK `chk_estorno_consistente`.
- Novo unique parcial `uniq_baixa_ativa_por_avulsa`.
- Índice `idx_lanc_avulsa`.

**`20260806000004_avulsa_rpcs.sql`:**
- CREATE FUNCTION `dar_baixa_avulsa` (SECURITY DEFINER, tenant enforcement + auth.uid() derivation).
- CREATE FUNCTION `estornar_baixa_avulsa` (idem).
- GRANT EXECUTE pra `authenticated`.

## 11. Fora de escopo desta entrega

- **Parcelamento de avulsa** — 1 baixa = 1 lançamento total. Sem N parcelas.
- **Recorrência** (aluguel toda mês, salário toda folha) — sem cron / job automático. Financeiro copia/cola.
- **Fluxo de caixa projetado** (usar `data_prevista_pagamento` pra prever saldo futuro) — visualização fica pra fase futura.
- **Aprovação de avulsa** (financeiro aprova antes de admin bater) — hoje financeiro é single-role, sem fluxo.
- **Anexos em `lancamentos_financeiros`** — anexos vivem só em `contas_avulsas_anexos` / `pedidos_compra_anexos`. Se precisar ver na tela de conciliação, drill-down pelo `conta_avulsa_id` / `pedido_compra_id` da row.
- **Import em massa** (Excel de dívidas) — futuro se aparecer demanda.
- **Recebimentos avulsos como fluxo próprio** — modelagem já suporta (`natureza='entrada'` na avulsa), mas UX é o mesmo drawer. Não vira uma aba "Contas a Receber" separada agora.
- **Fechamento de mês** — nada trava por período.

## 12. Impacto no código existente

Arquivos a **modificar**:
- `app/(app)/financeiro/page.tsx` — card do hub aponta pra nova rota.
- `app/(app)/financeiro/conciliacao/conciliacao-list.tsx` — badge "Avulsa" pra origem correspondente.
- `lib/types.ts` — novos tipos `ContaAvulsa`, `ContaAvulsaStatus`, `ContaAvulsaAnexo`, `ContaAvulsaHistorico`.
- `lib/auth/audit.ts` — 5 novos audit actions.
- `components/sidebar.tsx` — nada (financeiro já está lá).

Arquivos a **renomear**:
- Toda pasta `app/(app)/financeiro/pedidos-compra/**` → `app/(app)/financeiro/contas-a-pagar/**` (git mv preserva histórico).

Arquivos a **criar**:
- 4 migrations SQL (ver seção 10).
- `app/(app)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx` (novo componente de tabs).
- `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts`.
- `app/(app)/financeiro/contas-a-pagar/avulsas-list.tsx`.
- `app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx`.
- `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/page.tsx`.
- `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/baixar-avulsa-modal.tsx`.
- `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/cancelar-baixa-avulsa-modal.tsx`.
- `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/historico-mudancas.tsx`.
- `lib/validations/conta-avulsa.ts` (Zod).

## 13. Riscos e mitigação

- **Migration split em 3** — se rodar fora de ordem, o wiring quebra (constraint referencia enum ainda inexistente). Mitigação: naming sequencial estrito (`00001`, `00002`, `00003`, `00004`) e verificação de ordem via `list_migrations` antes de cada apply.
- **Rename da pasta quebra imports** — grep exaustivo por `pedidos-compra` no `app/(app)` + `lib` + `components` antes de commit. Rodar `tsc --noEmit` valida.
- **`empresa_id` imutável não enforceado no banco** — só server action garante. Aceitável porque única entrada é via server action; se aparecer necessidade, adicionar trigger BEFORE UPDATE bloqueando `empresa_id`.
- **Estorno concorrente** (mesma race que PP) — mitigação futura via `SELECT ... FOR UPDATE` na row original. Registrar como débito técnico (mesmo já registrado pra PP).
- **Histórico enche demais** — cada edit gera N rows (uma por campo alterado). Volume alto? Uma conta muito editada gera dezenas de rows, mas hoje o volume total é baixo. Índice em `(conta_avulsa_id, alterado_em DESC)` mantém query rápida.

## 14. Perguntas resolvidas na conversa

1. ✅ Renomear rota — `/financeiro/pedidos-compra` → `/financeiro/contas-a-pagar`.
2. ✅ Duas tabs — "Pedidos de Compra" + "Lançamentos Avulsos".
3. ✅ Cada aba tem sua natureza — separação total, não visão unificada.
4. ✅ Chips mantidos em ambas as abas.
5. ✅ Nome da aba nova — "Lançamentos Avulsos".
6. ✅ Nome da tabela — `contas_avulsas`.
7. ✅ Nome da tabela de histórico — `contas_avulsas_historico`.
8. ✅ Edição só de pendente. Baixada precisa estornar pra editar.
9. ✅ Cada edição gera row no histórico exposto ao usuário.
10. ✅ Anexos opcionais.
11. ✅ Excluir pendente = hard delete; excluir baixada = estorno reverso.
12. ✅ `empresa_id` imutável após criação.

---

**Próximo passo:** Antonio revisa esta spec. Se aprovada, invoco `writing-plans` pra gerar o plano de implementação passo a passo.
