# Lançamentos Financeiros — Design

**Data:** 2026-08-05
**Autor:** Antonio + Claude
**Status:** Aguardando revisão do Antonio antes do plano de implementação.

## 1. Contexto

Hoje o ERP consegue:

- Criar Pedidos de Compra (PP) a partir do realizado do job.
- Marcar PP como paga via `marcarPagaFinanceiro` — só seta `status='pago'`, `pago_em`, `pago_por` na própria row de `pedidos_compra`.

O que **não** existe: uma tabela central de lançamentos financeiros. "PP paga" hoje é um flag isolado. Não alimenta DRE, não alimenta conciliação bancária, e não deixa histórico contábil.

A California hoje registra os movimentos em Google Sheets — uma aba por conta bancária, onde o financeiro compara manualmente com o extrato do banco pra fechar. O sistema precisa absorver esse fluxo.

Esta spec define o **coração do módulo financeiro**: a tabela `lancamentos_financeiros`, as auxiliares que ela precisa (`contas_bancarias`, `plano_contas_tipos`, `plano_contas_subtipos`), e o novo fluxo de baixa da PP que passa a persistir lançamento.

## 2. Objetivo

Introduzir a tabela central `lancamentos_financeiros`, alimentada nesta fase **exclusivamente pela baixa de PP**, com estrutura preparada pra receber:

- Lançamentos avulsos (salários, aluguel, custos administrativos, transferências entre contas) — fase futura.
- Recebimentos de cliente — fase futura.
- Conciliação bancária semi-automática — fase futura.
- DRE — fase futura, com hierarquia baseada em `plano_contas_tipos` + `plano_contas_subtipos`.

Nesta fase entrega:

1. Modelagem das 4 tabelas novas com RLS/GRANT/audit.
2. CRUD administrativo de contas bancárias e plano de contas.
3. Refactor da baixa da PP pra criar lançamento na conta bancária correta.
4. Estorno reverso da baixa (cria lançamento oposto + volta PP pra `em_avaliacao`).
5. Tela `/financeiro/conciliacao` com filtro por conta bancária e saldo derivado.

## 3. Decisões arquiteturais

Todas fechadas em conversa com Antonio antes de escrever esta spec.

### 3.1. `valor` + `natureza` em vez de `credito` + `debito`

Contas bancárias em Sheets usam duas colunas (crédito e débito) por convenção visual. Em SQL isso vira:

- Constraint fraca (`credito=0 AND debito=0` ou ambos preenchidos são estados inválidos que só o app trava).
- Query poluída (`SUM(credito) - SUM(debito)` toda hora).
- Dificuldade em cross-tabular por natureza.

Adotamos **1 coluna `valor NUMERIC(14,2) CHECK (valor > 0)`** + **1 enum `natureza_lancamento` = 'entrada' | 'saida'**. A UI renderiza o mesmo layout Sheets (valor em azul na coluna crédito quando `natureza='entrada'`; em vermelho na coluna débito quando `natureza='saida'`) — o visual é 100% preservado.

### 3.2. Saldo derivado, nunca persistido

Persistir saldo em linha corrompe em pelo menos 3 cenários: lançamento retroativo, estorno, race condition. A tela derivar saldo com `SUM ... OVER (PARTITION BY conta ORDER BY data)` é O(N) da conta, aceitável pra tela típica de extrato (< 500 linhas por mês por conta) e cabe em index no `(tenant_id, conta_bancaria_id, data_movimento)`.

O saldo inicial da conta (quando o sistema entra em produção no meio de um período) mora em `contas_bancarias.saldo_inicial` + `saldo_inicial_data`. A query de extrato só considera lançamentos com `data_movimento >= saldo_inicial_data` e adiciona `saldo_inicial` como âncora.

### 3.3. Plano de contas em 2 tabelas separadas

`plano_contas_tipos` (nível 1: REC, CO, DP…) e `plano_contas_subtipos` (nível 2: Salário, Alimentação…) com `tipo_id` FK. A California já usa exatamente essa estrutura de 2 níveis no Sheets, e o DRE futuro vai agrupar por tipo.

Não usar tabela única hierárquica com `parent_id` porque adiciona complexidade sem ganho — nem existe demanda por 3+ níveis.

Tipos e subtipos **não** carregam sinal na string do nome (`(+)`, `(-)`, `(+/-)`). Sinal é semântica, mora em `natureza_padrao` (coluna enum). UI usa cor pra sinalizar.

### 3.4. Estorno reverso, não destrutivo

Padrão contábil. Estornar = inserir novo lançamento com natureza invertida, mesmo valor, `descricao='Estorno PP XXXX'`, `estorno_de_lancamento_id` apontando pro original + `origem='pp_estorno'`. Nenhuma row é deletada. PP volta pra `em_avaliacao` e libera pra ser baixada de novo (com dados corrigidos).

O ciclo completo pra corrigir baixa errada é: **cancelar baixa (estorno) → editar campos da PP se necessário → dar baixa de novo**. Cada operação vira 1 lançamento na conta bancária. Histórico auditável de ponta a ponta.

### 3.5. Consistência empresa × conta bancária via FK composta

Cada conta bancária pertence a uma empresa. Cada lançamento pertence a uma empresa. As duas empresas obrigatoriamente batem — não pode haver lançamento "da Empresa A" saindo de conta bancária "da Empresa B".

Enforcement via FK composta:

```sql
-- em contas_bancarias
constraint uniq_conta_bancaria_id_empresa unique (id, empresa_id)

-- em lancamentos_financeiros
constraint fk_lancamento_conta_empresa
  foreign key (conta_bancaria_id, empresa_id)
  references contas_bancarias (id, empresa_id) on delete restrict
```

O banco não deixa divergir. UI derivar `empresa_id` do lançamento a partir da conta bancária escolhida (o form de baixa pergunta empresa como filtro pra listar contas, mas o `empresa_id` gravado é o da conta selecionada — sempre coerente).

### 3.6. 1 pagamento = 1 lançamento no valor total

Sem parcelamento nesta fase. Se PP de R$ 60k é paga em 3× R$ 20k, no MVP entra 1 lançamento único de R$ 60k na data do pagamento consolidado. Parcelamento entra em fase futura, com PP ganhando status intermediário `parcialmente_paga` e N lançamentos por PP.

### 3.7. Sem import histórico

Nada dos Sheets migra pro banco. California zera o start no sistema com `saldo_inicial` em cada conta na `saldo_inicial_data`. Movimento anterior à data de saldo inicial é **bloqueado** no submit.

## 4. Modelagem de dados

### 4.1. `contas_bancarias`

```sql
create table public.contas_bancarias (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete restrict,
  empresa_id          uuid not null references public.empresas(id) on delete restrict,
  nome                text not null,                -- 'Santander CC 12345-6'
  banco               text not null,                -- 'Santander'
  agencia             text,
  numero_conta        text,
  tipo                text not null,                -- enum via CHECK: corrente|poupanca|investimento|caixa
  saldo_inicial       numeric(14,2) not null default 0,
  saldo_inicial_data  date not null,
  ativo               boolean not null default true,
  ordem               integer not null default 0,   -- pra ordenar dropdown
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chk_conta_nome_nao_vazio check (length(trim(nome)) > 0),
  constraint chk_conta_banco_nao_vazio check (length(trim(banco)) > 0),
  constraint chk_conta_tipo_valido
    check (tipo in ('corrente','poupanca','investimento','caixa')),
  constraint uniq_conta_id_empresa unique (id, empresa_id)  -- pra FK composta do lançamento
);

create index idx_contas_bancarias_tenant on public.contas_bancarias(tenant_id);
create index idx_contas_bancarias_empresa on public.contas_bancarias(empresa_id);
create index idx_contas_bancarias_ativo on public.contas_bancarias(tenant_id, ativo);
```

**Notas:**

- `nome` é o label do dropdown (livre pro admin escrever como quiser).
- `banco` separado de `nome` pra facilitar futuros filtros/agrupamentos (todas as contas Santander).
- `agencia` e `numero_conta` texto livre — aceitam dígito verificador, hífen, etc.
- `tipo='caixa'` cobre caixa em espécie (banco fictício "Interno").
- `saldo_inicial_data` **obrigatória** — sem ela não dá pra calcular saldo derivado corretamente.
- `updated_at` mantido via trigger `set_updated_at()` já existente.

### 4.2. `plano_contas_tipos`

```sql
create type natureza_padrao_tipo as enum ('entrada', 'saida', 'ambos');

create table public.plano_contas_tipos (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  codigo            varchar(6) not null,               -- 'REC', 'CO', 'DP'…
  nome              varchar(120) not null,             -- 'Despesa com Pessoal'
  natureza_padrao   natureza_padrao_tipo not null,
  ordem             integer not null default 0,        -- ordem na UI + DRE
  ativo             boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_tipo_codigo_formato check (codigo ~ '^[A-Z]{2,6}$'),
  constraint chk_tipo_nome_nao_vazio check (length(trim(nome)) > 0),
  constraint uniq_tipo_codigo_por_tenant unique (tenant_id, codigo)
);

create index idx_tipos_tenant on public.plano_contas_tipos(tenant_id);
create index idx_tipos_ativo on public.plano_contas_tipos(tenant_id, ativo);
```

### 4.3. `plano_contas_subtipos`

```sql
create table public.plano_contas_subtipos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  tipo_id       uuid not null references public.plano_contas_tipos(id) on delete restrict,
  nome          varchar(160) not null,     -- 'Benefícios (plano de saúde e Total Pass)'
  ordem         integer not null default 0,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint chk_subtipo_nome_nao_vazio check (length(trim(nome)) > 0),
  constraint uniq_subtipo_nome_por_tipo unique (tenant_id, tipo_id, nome)
);

create index idx_subtipos_tenant on public.plano_contas_subtipos(tenant_id);
create index idx_subtipos_tipo on public.plano_contas_subtipos(tipo_id);
create index idx_subtipos_ativo on public.plano_contas_subtipos(tenant_id, ativo);
```

**Nota sobre integridade:** o app garante no server action que `subtipo.tipo_id = lancamento.plano_conta_tipo_id`. Poderíamos forçar via FK composta como fizemos com empresa/conta, mas aqui o custo (unique adicional) supera o benefício (validação simples no server action + zod). Se aparecer inconsistência em produção, migramos pra FK composta.

### 4.4. `lancamentos_financeiros`

Enums:

```sql
create type natureza_lancamento as enum ('entrada', 'saida');
create type origem_lancamento as enum
  ('pp_baixa', 'pp_baixa_estornada', 'pp_estorno', 'manual');
```

Sobre `origem_lancamento`: o valor `pp_baixa_estornada` existe **apenas** pra suportar o unique parcial de "1 baixa ativa por PP". Quando o financeiro estorna uma baixa, o lançamento original tem `origem` migrado de `pp_baixa` pra `pp_baixa_estornada`, liberando espaço pro unique aceitar uma nova baixa dessa PP no futuro. O lançamento reverso entra como `pp_estorno`.

Tabela:

```sql
create table public.lancamentos_financeiros (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete restrict,
  empresa_id                uuid not null references public.empresas(id) on delete restrict,
  conta_bancaria_id         uuid not null,   -- FK composta abaixo
  data_movimento            date not null,
  valor                     numeric(14,2) not null,
  natureza                  natureza_lancamento not null,
  descricao                 text not null,
  plano_conta_tipo_id       uuid not null references public.plano_contas_tipos(id) on delete restrict,
  plano_conta_subtipo_id    uuid not null references public.plano_contas_subtipos(id) on delete restrict,
  fornecedor_id             uuid references public.fornecedores(id) on delete restrict,
  cliente_id                uuid references public.clientes(id) on delete restrict,
  job_id                    uuid references public.jobs(id) on delete restrict,
  pedido_compra_id          uuid references public.pedidos_compra(id) on delete restrict,
  estorno_de_lancamento_id  uuid references public.lancamentos_financeiros(id) on delete restrict,
  origem                    origem_lancamento not null default 'manual',
  criado_por                uuid not null references public.profiles(id),
  created_at                timestamptz not null default now(),

  constraint chk_valor_positivo check (valor > 0),
  constraint chk_descricao_nao_vazia check (length(trim(descricao)) >= 3),

  -- Consistência empresa × conta bancária
  constraint fk_lancamento_conta_empresa
    foreign key (conta_bancaria_id, empresa_id)
    references public.contas_bancarias (id, empresa_id) on delete restrict,

  -- Estorno referencia lançamento original
  constraint chk_estorno_consistente
    check (
      (origem = 'pp_estorno' and estorno_de_lancamento_id is not null)
      or
      (origem <> 'pp_estorno' and estorno_de_lancamento_id is null)
    ),

  -- Toda origem ligada a PP obriga pedido_compra_id; manual proíbe
  constraint chk_origem_pp_tem_pp_id
    check (
      (origem in ('pp_baixa','pp_baixa_estornada','pp_estorno') and pedido_compra_id is not null)
      or
      (origem = 'manual' and pedido_compra_id is null)
    )
);

-- Unique parcial: 1 baixa ativa por PP. Ao estornar, o lançamento original
-- vira 'pp_baixa_estornada' e libera espaço pra nova baixa.
create unique index uniq_baixa_ativa_por_pp
  on public.lancamentos_financeiros(pedido_compra_id)
  where origem = 'pp_baixa';

-- Índices operacionais
create index idx_lanc_tenant on public.lancamentos_financeiros(tenant_id);
create index idx_lanc_conta_data
  on public.lancamentos_financeiros(tenant_id, conta_bancaria_id, data_movimento);
create index idx_lanc_data
  on public.lancamentos_financeiros(tenant_id, data_movimento);
create index idx_lanc_fornecedor on public.lancamentos_financeiros(fornecedor_id);
create index idx_lanc_job on public.lancamentos_financeiros(job_id);
create index idx_lanc_pp on public.lancamentos_financeiros(pedido_compra_id);
create index idx_lanc_tipo on public.lancamentos_financeiros(plano_conta_tipo_id);
```

**Sem `updated_at`.** Lançamento é imutável exceto pelo `UPDATE origem` no ato do estorno (`pp_baixa` → `pp_baixa_estornada`). Rastro dessa transição fica em `audit_events` (ver 8).

## 5. Regras de negócio

### 5.1. Baixa de PP → cria lançamento

`marcarPagaFinanceiro` passa a receber e persistir:

- `pago_em: date` (existente)
- `conta_bancaria_id: uuid` (novo)
- `plano_conta_tipo_id: uuid` (novo)
- `plano_conta_subtipo_id: uuid` (novo)

Numa **transação** (via RPC Postgres ou 2 statements com rollback manual):

1. `UPDATE pedidos_compra SET status='pago', pago_em=?, pago_por=? WHERE id=?`
2. `INSERT INTO lancamentos_financeiros ({snapshot da PP})` com:
   - `natureza = 'saida'` (PP é sempre saída de dinheiro)
   - `valor = pp.valor`
   - `data_movimento = pago_em`
   - `descricao = 'PP ' || pp.codigo || ' — ' || pp.servico` (truncado se > 200 chars)
   - `empresa_id = pp.empresa_id`
   - `fornecedor_id = pp.fornecedor_id`
   - `job_id = pp.job_id`
   - `pedido_compra_id = pp.id`
   - `plano_conta_tipo_id`, `plano_conta_subtipo_id` do form
   - `conta_bancaria_id` do form
   - `origem = 'pp_baixa'`
   - `criado_por = session.profile.id`

Validações no server action:

- `subtipo.tipo_id === tipo_id` (subtipo pertence ao tipo escolhido).
- `conta_bancaria.empresa_id === pp.empresa_id` (conta pertence à empresa da PP).
- `pago_em >= conta_bancaria.saldo_inicial_data` (não pode lançar antes do start).
- Todos ativos: conta, tipo, subtipo — bloquear se algum estiver `ativo=false`.

Audit: `pedido_compra.paga` (existente) + novo `lancamento_financeiro.criado` com metadata `{ pp_codigo, conta, tipo, subtipo, valor, natureza, origem }`.

### 5.2. Estorno da baixa (cancelar baixa da PP)

Nova server action `estornarBaixaPP(pp_id, motivo)`:

- Gate: admin | financeiro (`checarGateFinanceiro` existente).
- Valida `pp.status === 'pago'`.
- Localiza o lançamento original (`WHERE pedido_compra_id = ? AND origem = 'pp_baixa'`).
- Numa transação:
  1. `INSERT lancamento_financeiro` com natureza **invertida** (entrada em vez de saída, valor igual), `origem='pp_estorno'`, `estorno_de_lancamento_id = original.id`, `descricao='Estorno da baixa de ' || pp.codigo || ' — ' || motivo`, mesma `conta_bancaria_id`, mesmo `plano_conta_tipo_id`+`subtipo_id`, `data_movimento = hoje`.
  2. `UPDATE` original: `origem='pp_baixa_estornada'` (libera unique parcial pra nova baixa).
  3. `UPDATE pedidos_compra SET status='em_avaliacao', pago_em=NULL, pago_por=NULL WHERE id=?`.
- Audit: `pedido_compra.baixa_estornada` + `lancamento_financeiro.estornado` com metadata `{ pp_codigo, lancamento_original_id, lancamento_estorno_id, motivo }`.

`motivo` obrigatório (mín 10, máx 500 chars).

### 5.3. Rebaixa (após estorno)

PP volta pra `em_avaliacao`. O drawer do financeiro na `/financeiro/pedidos-compra` mostra normalmente e o financeiro pode dar baixa de novo — mesmo fluxo do 5.1. O unique parcial permite (porque a baixa anterior virou `pp_baixa_estornada`).

### 5.4. Cancelamento da PP (existente) e estorno

A PP tem 2 caminhos de saída pra fora do fluxo produtivo:

- **Cancelamento** pelo GP (`origem: aba de PPs do job`) — quando a PP nasce errada ou vira desnecessária. Status vira `cancelada`.
- **Estorno da baixa** pelo financeiro (novo) — quando a baixa foi feita, mas com dados errados. Status volta pra `em_avaliacao`.

Regra crítica: **PP paga NÃO pode ser cancelada diretamente**. Se financeiro/GP quer cancelar uma PP paga, primeiro estorna a baixa (volta pra `em_avaliacao`), depois o GP cancela pela aba do job. Duas ações separadas, com audit separado. Impede que um cancelamento apague implicitamente um lançamento financeiro.

Implementação: `cancelarPedidoCompra` (existente) já bloqueia se `status='pago'`. Manter.

### 5.5. Saldo derivado da conta bancária

Query padrão pra tela do extrato:

```sql
select
  l.id,
  l.data_movimento,
  l.descricao,
  l.natureza,
  l.valor,
  case when l.natureza = 'entrada' then l.valor else 0 end as credito,
  case when l.natureza = 'saida'   then l.valor else 0 end as debito,
  (
    c.saldo_inicial +
    sum(case when l.natureza = 'entrada' then l.valor else -l.valor end)
      over (order by l.data_movimento, l.created_at
            rows between unbounded preceding and current row)
  ) as saldo,
  f.nome_fantasia as fornecedor_nome,
  j.codigo as job_codigo,
  t.codigo as tipo_codigo,
  t.nome as tipo_nome,
  s.nome as subtipo_nome,
  l.origem
from public.lancamentos_financeiros l
join public.contas_bancarias c on c.id = l.conta_bancaria_id
left join public.fornecedores f on f.id = l.fornecedor_id
left join public.jobs j on j.id = l.job_id
join public.plano_contas_tipos t on t.id = l.plano_conta_tipo_id
join public.plano_contas_subtipos s on s.id = l.plano_conta_subtipo_id
where l.tenant_id = ?
  and l.conta_bancaria_id = ?
  and l.data_movimento between ? and ?
order by l.data_movimento asc, l.created_at asc;
```

Se filtro por período começa **depois** da `saldo_inicial_data`, o saldo do começo do período precisa ser calculado à parte (soma dos anteriores) e mostrado como "Saldo anterior: R$ X" antes da primeira linha. Detalhe UI.

## 6. Server actions

Arquivo: `app/(app)/financeiro/pedidos-compra/actions.ts` (existente, expandir).

### 6.1. `marcarPagaFinanceiro` (refactor)

Assinatura muda:

```ts
export async function marcarPagaFinanceiro(input: {
  pp_id: string;
  pago_em: string;              // YYYY-MM-DD
  conta_bancaria_id: string;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
}): Promise<Result>
```

Zod schema, `checarGateFinanceiro`, todas as validações do 5.1, UPDATE PP + INSERT lançamento numa RPC nova `dar_baixa_pp(...)` que envolve os 2 statements em transação real.

Motivo pra RPC em vez de 2 statements do supabase-js: sem transação distribuída, se o UPDATE PP suceder e o INSERT lançamento falhar por qualquer motivo (constraint, RLS), a PP fica `pago` sem lançamento — pior estado possível.

### 6.2. `estornarBaixaPP` (nova)

```ts
export async function estornarBaixaPP(input: {
  pp_id: string;
  motivo: string;  // min 10, max 500
}): Promise<Result>
```

Regras do 5.2, via RPC `estornar_baixa_pp(...)` (também transacional).

### 6.3. CRUD `contas_bancarias`

Arquivo novo: `app/(app)/cadastros/contas-bancarias/actions.ts`.

- `criarContaBancaria`, `atualizarContaBancaria`, `inativarContaBancaria`, `reativarContaBancaria`.
- Gate: `administrador` **ou** `financeiro`. Ambos criam, editam e inativam.
- Saldo inicial pode ser editado somente **enquanto não houver lançamento** naquela conta. Depois trava.
- `saldo_inicial_data` mesma regra que `saldo_inicial`.
- Inativar: só permite se não houver lançamento nos últimos 90 dias (política simples pra evitar sumir conta com movimento recente). Se tiver, mensagem de erro clara.

### 6.4. CRUD `plano_contas_tipos` e `plano_contas_subtipos`

Arquivo novo: `app/(app)/cadastros/plano-de-contas/actions.ts`.

- `criarTipo`, `atualizarTipo`, `inativarTipo`, `reativarTipo`.
- `criarSubtipo`, `atualizarSubtipo`, `inativarSubtipo`, `reativarSubtipo`.
- Gate: `administrador` **ou** `financeiro`. Ambos criam, editam, inativam.
- Inativar tipo: bloqueia se existir subtipo ativo (força inativar em cadeia manualmente) OU se existir lançamento nos últimos 90 dias com esse tipo.
- Inativar subtipo: bloqueia se existir lançamento nos últimos 90 dias com esse subtipo.
- `codigo` do tipo é **editável enquanto não houver lançamento com esse tipo**. Assim que aparecer o primeiro lançamento, o campo trava (só `nome` continua editável). Preserva rastreio histórico do DRE.

## 7. UI

### 7.1. Sidebar

Adicionar 2 entradas em `/cadastros` (hub existente):

- **Contas bancárias** (`Landmark` ou `Wallet` icon)
- **Plano de contas** (`ListTree` icon)

Adicionar 1 entrada nova em `/financeiro`:

- **Conciliação** (`Receipt` icon) — rota `/financeiro/conciliacao`.

Todas as 3 entradas com `roles: ['administrador','financeiro']`. Ambos os papéis criam, editam e inativam.

### 7.2. CRUD `/cadastros/contas-bancarias`

Padrão do resto do `/cadastros` (lista com busca + filtro `Ativos/Inativos/Todos`, drawer de editar, botão "Nova conta bancária").

Colunas da lista: `Nome`, `Banco`, `Ag/Conta`, `Empresa`, `Saldo inicial`, `Data start`, `Status`.

Drawer form:

- Nome*, Banco*, Agência, Número da conta
- Tipo (dropdown enum)
- Empresa* (dropdown de empresas ativas do tenant)
- Saldo inicial* (currency), Data do saldo inicial* (date picker)
- Ordem (numérico)

Trava campos `saldo_inicial` e `saldo_inicial_data` se `count(lancamentos) > 0` (mensagem: "Esta conta já tem lançamentos. Saldo inicial não pode mais ser alterado.").

### 7.3. CRUD `/cadastros/plano-de-contas`

Tela com 2 seções (ou 2 tabs): **Tipos** e **Subtipos**.

Lista de tipos: `Código`, `Nome`, `Natureza padrão` (chip colorido), `Ordem`, `Status`.

Drawer form tipo:

- Código* (6 chars, uppercase, unique per tenant)
- Nome*
- Natureza padrão* (radio: Entrada / Saída / Ambos)
- Ordem

Lista de subtipos: `Tipo` (chip com código+nome), `Nome`, `Ordem`, `Status`. Filtrável por tipo.

Drawer form subtipo:

- Tipo* (dropdown de tipos ativos)
- Nome*
- Ordem

### 7.4. Drawer de baixa (refactor)

Arquivo existente: `app/(app)/financeiro/pedidos-compra/pp-drawer-financeiro.tsx`.

O `ConfirmDialog` atual da baixa (só pede `pago_em`) vira um formulário maior. Duas opções:

- **(a)** Trocar o `ConfirmDialog` por um `Dialog` próprio com form completo.
- **(b)** Manter o `ConfirmDialog` mas com children mais rico.

Ambas funcionam. Adotamos **(a)** — o form é grande o suficiente pra merecer identidade visual própria.

Novo componente: `<BaixaPPModal>` com:

- Header: "Dar baixa em {pp.codigo}"
- Resumo (readonly): Fornecedor, Job, Valor, Empresa
- Form:
  - Data do pagamento* (DatePicker, default hoje)
  - Conta bancária* (dropdown; filtrado por `empresa_id = pp.empresa_id`, só ativas, agrupado por banco)
  - Tipo* (dropdown; só ativos, ordenado por `ordem`; sem restrição — financeiro escolhe livre entre os 15 tipos)
  - Subtipo* (dropdown; filtrado por `tipo_id`; se tipo vazio, dropdown desabilitado)
- Botão "Confirmar baixa" (verde) + "Cancelar"
- Bloco de erro no topo se algo falhar

O drawer da PP também ganha, quando `status='pago'`:

- Botão **"Cancelar baixa"** (borda vermelha) — abre `<CancelarBaixaModal>` com input de motivo (10-500 chars) e botão de confirmar.
- Link "Ver lançamento na conta {conta.nome}" que abre `/financeiro/conciliacao?conta={conta_id}&highlight={lancamento_id}`. Query params `conta` e `highlight` são consumidos pela tela do 7.5.

### 7.5. `/financeiro/conciliacao`

Nova rota. Layout:

- Header padrão (`Receipt` icon + kicker "Financeiro" + título "Conciliação").
- Barra de filtros:
  - **Conta bancária*** (dropdown, obrigatório — nada aparece sem conta selecionada)
  - Período (2 date pickers, default: mês corrente)
  - Fornecedor (dropdown busca)
  - Tipo de plano de conta (dropdown)
- Card no topo com:
  - **Saldo anterior** (calculado até o dia anterior ao filtro): `R$ X`
  - **Créditos no período**: `R$ Y`
  - **Débitos no período**: `R$ Z`
  - **Saldo final**: `R$ W` (grande, verde se positivo, vermelho se negativo)
- Tabela com colunas (padrão Sheets):
  - Data | Descrição | Fornecedor | Job | Tipo/Subtipo | Crédito | Débito | Saldo
- Origem = badge: `PP`, `Estorno PP`, `Manual` (não existe ainda).
- Linha de estorno aparece com strikethrough leve na descrição pra sinalizar que é reversão.

Sem CRUD manual nesta tela nesta fase (avulsos não entram agora).

Quando a URL vem com `?highlight=<lancamento_id>`, a linha desse id ganha um pulse leve por 2s e a tabela faz `scrollIntoView` nela. Facilita o deep-link do drawer da PP.

## 8. RLS + GRANTs + Auditoria

Todas as 4 tabelas novas seguem o padrão do projeto:

- `alter table ... enable row level security;`
- Policy `SELECT`: `is_tenant_member(tenant_id)` (todo membro lê — GP também precisa consultar plano de contas quando estamos vendo relatórios futuros).
- Policy `INSERT`, `UPDATE`: `is_tenant_member(tenant_id)` **em todas as 4 tabelas**. O gate de role (`admin | financeiro`) mora no server action, seguindo o mesmo padrão da Central Financeira (Task 005) e da fase 2 de PPs. Motivo pra não subir isso pro RLS: o projeto não tem helper `is_tenant_financeiro` e criar um só pra esta task adiciona superfície sem ganho — o gate de role no server action já é enforceable e auditado (denials viram `acao_negada`).
- **Sem policy `DELETE`** em nenhuma. Estorno é lançamento reverso, não delete. Inativar é `UPDATE ativo=false`.
- `GRANT SELECT, INSERT, UPDATE ON <tabela> TO authenticated` no fim de cada bloco.

Policies usam `(select auth.uid())` conforme regra do projeto (evita re-avaliação por linha).

Ações auditadas via `log_audit_event`:

- `conta_bancaria.criada`, `.atualizada`, `.inativada`, `.reativada`
- `plano_conta_tipo.criado`, `.atualizado`, `.inativado`, `.reativado`
- `plano_conta_subtipo.criado`, `.atualizado`, `.inativado`, `.reativado`
- `lancamento_financeiro.criado` (metadata: pp_codigo, conta, tipo/subtipo, valor, natureza, origem)
- `lancamento_financeiro.estornado` (metadata: original_id, estorno_id, motivo)
- `pedido_compra.baixa_estornada` (metadata: pp_codigo, motivo)
- Denials → `acao_negada` com `acao_tentada` completo (padrão do projeto).

## 9. Migrations

### 9.1. `20260805000001_contas_bancarias.sql`

- CREATE TABLE `contas_bancarias`.
- Índices, RLS, GRANT.
- Trigger `set_updated_at`.

### 9.2. `20260805000002_plano_contas.sql`

- CREATE TYPE `natureza_padrao_tipo`.
- CREATE TABLE `plano_contas_tipos`, `plano_contas_subtipos`.
- Índices, RLS, GRANT, triggers `set_updated_at`.
- **Seed inicial dos 15 tipos** (dentro de `do $$ ... $$`), sem subtipos — vide seção 10.
- **Trigger `enforce_tipo_codigo_imutavel`** aplicado após a criação de `lancamentos_financeiros` (ordem importa: a função referencia essa tabela). Portanto o trigger real vai na migration `20260805000003_lancamentos_financeiros.sql`, no fim do arquivo — vide seção 15.

### 9.3. `20260805000003_lancamentos_financeiros.sql`

- CREATE TYPE `natureza_lancamento`, `origem_lancamento`.
- CREATE TABLE `lancamentos_financeiros`.
- Constraints CHECK e FK composta.
- Unique parcial `uniq_baixa_ativa_por_pp` (where `origem='pp_baixa'`).
- Índices, RLS (INSERT/UPDATE = `is_tenant_member`), GRANT.
- Sem coluna `updated_at` e sem trigger de update no próprio lançamento — imutabilidade é a regra (só o `UPDATE origem` do estorno é permitido, e ele fica rastreado em audit).
- No fim do arquivo: função + trigger `enforce_tipo_codigo_imutavel` em `plano_contas_tipos` (definido nesta migration porque referencia `lancamentos_financeiros`).

### 9.4. `20260805000004_baixa_pp_rpc.sql`

- CREATE FUNCTION `dar_baixa_pp(...)` — transacional, faz UPDATE PP + INSERT lançamento.
- CREATE FUNCTION `estornar_baixa_pp(...)` — transacional, faz INSERT lançamento reverso + UPDATE original + UPDATE PP.
- `GRANT EXECUTE ... TO authenticated`.
- Ambas com `SECURITY DEFINER`, checando role e tenant explicitamente.

## 10. Seeds

Aplicados na migration `20260805000002_plano_contas.sql`, dentro de bloco condicional que checa se o tenant California existe e se ainda não há tipos cadastrados nele.

### 10.1. Tipos (15 rows)

Baseado exatamente na imagem fornecida por Antonio.

| codigo | nome | natureza_padrao | ordem |
|---|---|---|---|
| REC | Receita | entrada | 10 |
| CO | Custo Operacional | saida | 20 |
| CT | Custo Tributário | saida | 30 |
| CF | Custo Fixo | saida | 40 |
| DP | Despesa com Pessoal | saida | 50 |
| DM | Despesa de Marketing | saida | 60 |
| DA | Despesa Administrativa | saida | 70 |
| DC | Despesa Comercial | saida | 80 |
| DT | Despesa Trabalhista | saida | 90 |
| RF | Receita Financeira | entrada | 100 |
| DJ | Despesa com Juros | saida | 110 |
| EMP | Empréstimos | ambos | 120 |
| IMOB | Imobilizado | saida | 130 |
| PL | Bonificação | saida | 140 |
| DL | Distribuição de Lucro | saida | 150 |

### 10.2. Subtipos

**Sem seed.** Antonio decidiu na rodada 3 que só os tipos entram no seed automático. Todos os subtipos (incluindo DP e DA que ele já tinha me mostrado) são cadastrados via CRUD `/cadastros/plano-de-contas` depois da entrega. Motivo prático: o financeiro pode preferir revisar/renomear antes de virar dado do banco, e cadastro por UI dá controle.

### 10.3. Conta bancária

**Sem seed.** Antonio cadastra as contas reais via UI após a entrega (com saldos iniciais e datas corretos).

## 11. Fora de escopo desta entrega

Registrado explícito pra não voltarem como pergunta durante a implementação:

- **Lançamentos avulsos** (não vindos de PP) — modelagem já suporta (`origem='manual'`), mas UI de criação não entra agora.
- **Recebimentos de cliente** (receita) — mesma coisa, modelagem suporta (`natureza='entrada'`, `cliente_id`), UI não entra.
- **Transferência entre contas** — precisa de 2 lançamentos ligados (débito na origem, crédito no destino). Modelagem pura das transferências (com FK `transferencia_id` ou tabela `transferencias`) fica pra fase futura.
- **PP com pagamento parcelado** — 1 baixa = 1 lançamento no valor total. Sem parcial.
- **Conciliação bancária** (bater lançamento com extrato) — precisa importação de extrato (OFX/CSV) e engine de match. Fase futura.
- **DRE** — precisa `GROUP BY tipo` + regime de competência. Modelagem já casa, tela fica pra fase futura.
- **Fluxo de caixa projetado** — precisa lançamento previsto (data futura, status "pendente"). Nesta entrega só realizado.
- **Contas a receber** — mesma modelagem, mas fluxo de entrada. Fase futura.
- **Edição in-place de lançamento vindo de PP** — proibida. Ciclo é sempre estornar → corrigir PP → baixar de novo.
- **Cancelamento direto de PP paga** — bloqueado. Precisa estornar baixa antes.
- **Import histórico do Google Sheets** — não faremos.

## 12. Impacto no código existente

Arquivos que **serão modificados** (não substituídos):

- `app/(app)/financeiro/pedidos-compra/actions.ts` — assinatura de `marcarPagaFinanceiro` muda; nova action `estornarBaixaPP`.
- `app/(app)/financeiro/pedidos-compra/pp-drawer-financeiro.tsx` — troca `ConfirmDialog` da baixa por `<BaixaPPModal>`; adiciona botão "Cancelar baixa" no drawer de PP paga.
- `lib/types.ts` — novos tipos: `ContaBancaria`, `PlanoContaTipo`, `PlanoContaSubtipo`, `LancamentoFinanceiro`, `NaturezaLancamento`, `OrigemLancamento`.
- `lib/auth/audit.ts` — novos valores de `AuditAcao` enum.
- `components/sidebar.tsx` — 3 entradas novas.

Arquivos que **serão criados**:

- `supabase/migrations/20260805000001_contas_bancarias.sql`
- `supabase/migrations/20260805000002_plano_contas.sql`
- `supabase/migrations/20260805000003_lancamentos_financeiros.sql`
- `supabase/migrations/20260805000004_baixa_pp_rpc.sql`
- `app/(app)/cadastros/contas-bancarias/page.tsx` + `actions.ts` + `conta-editor-drawer.tsx` + `contas-bancarias-list.tsx`
- `app/(app)/cadastros/plano-de-contas/page.tsx` + `actions.ts` + `tipo-editor-drawer.tsx` + `subtipo-editor-drawer.tsx` + `tipos-list.tsx` + `subtipos-list.tsx`
- `app/(app)/financeiro/conciliacao/page.tsx` + `conciliacao-list.tsx` + `filtros-conta.tsx`
- `app/(app)/financeiro/pedidos-compra/baixa-pp-modal.tsx`
- `app/(app)/financeiro/pedidos-compra/cancelar-baixa-modal.tsx`
- `lib/calculos/saldo-conta.ts` — helper de saldo derivado + saldo anterior por período.

## 13. Riscos e mitigação

- **PP paga sem lançamento (estado inválido)** — mitigado com RPC transacional em vez de 2 statements do supabase-js.
- **Estorno gera divergência de saldo** — mitigado porque estorno usa mesma conta+tipo+subtipo do original, natureza invertida. Soma fica zero na conta.
- **Financeiro escolhe subtipo de tipo diferente** — validado no server action + zod.
- **Financeiro escolhe conta de empresa diferente da PP** — bloqueado por FK composta no banco.
- **Financeiro tenta lançar antes de `saldo_inicial_data`** — validado no server action; erro claro na tela.
- **Race condition em unique parcial ao estornar+rebaixar rápido** — proteção via ordem correta na RPC (`UPDATE origem` antes de deixar destravar; `INSERT` nova baixa acontece só depois).
- **Cadastro inativado com lançamento no meio** — bloqueado (janela 90 dias).
- **Perda de rastreio se `codigo` do tipo mudar** — bloquear edição de `codigo` após primeiro lançamento (trata como imutável). Ou aceitar edição com audit obrigatório. **Decisão pendente durante implementação** — vou de bloqueio duro.

## 14. Perguntas resolvidas na rodada 2

Ficam registradas as decisões finais pra referência histórica.

1. ✅ **Rota da tela de saldo** — `/financeiro/conciliacao` (Antonio pensa nela como a tela de conciliação bancária).
2. ✅ **`caixa` no enum** — fica. Cobre caixa em espécie se aparecer.
3. ✅ **`codigo` do tipo imutável após primeiro lançamento** — sim. Preserva rastreio histórico do DRE.
4. ✅ **Financeiro edita cadastros** — `admin | financeiro` criam, editam e inativam contas bancárias e plano de contas. Gate no server action (não no RLS — ver seção 8).
5. ✅ **Sem warning REC/RF na baixa** — financeiro escolhe livre. Sem babá.
6. ✅ **DL como `natureza_padrao='saida'`** — provisório. Ajustável no CRUD depois se contabilidade decidir diferente.

## 15. Decisões da rodada 4

1. ✅ **Imutabilidade do `codigo` do tipo** — opção **(A)** confirmada. Trava dura após o 1º uso. Enquanto não houver lançamento com aquele tipo, `codigo` é editável livremente. Assim que o primeiro lançamento é gravado, `codigo` fica bloqueado permanentemente. `nome` continua editável. Para trocar código depois disso: criar tipo novo, inativar o antigo.

**Implementação da trava (A):**

- Server action `atualizarTipoPlanoContas` faz `SELECT count(*) FROM lancamentos_financeiros WHERE plano_conta_tipo_id = ?`. Se > 0 e o input contiver `codigo` diferente do atual, retorna erro claro: "Este tipo já tem lançamento. Só o nome pode ser alterado. Para trocar o código, cadastre um tipo novo e inative este."
- UI desabilita o campo `codigo` no drawer de edição quando `tipo.total_lancamentos > 0` (carregado no server component).
- Defense-in-depth via trigger BEFORE UPDATE no banco que aborta se `NEW.codigo IS DISTINCT FROM OLD.codigo` e existe lançamento. Migração inclui:

```sql
create or replace function public.enforce_tipo_codigo_imutavel()
returns trigger language plpgsql as $$
begin
  if NEW.codigo is distinct from OLD.codigo
     and exists (select 1 from public.lancamentos_financeiros
                  where plano_conta_tipo_id = OLD.id) then
    raise exception
      'Código do tipo não pode ser alterado após o primeiro lançamento (tipo %).', OLD.codigo;
  end if;
  return NEW;
end$$;

create trigger trg_tipo_codigo_imutavel
  before update on public.plano_contas_tipos
  for each row execute function public.enforce_tipo_codigo_imutavel();
```

---

**Todas as decisões estão fechadas. Próximo passo:** invocar `writing-plans` pra gerar o plano de implementação passo a passo.
