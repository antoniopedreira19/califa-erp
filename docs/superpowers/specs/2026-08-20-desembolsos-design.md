# Desembolsos — Design

**Data:** 2026-08-20
**Autor:** Antonio + Claude
**Status:** Aguardando revisão do Antonio antes do plano de implementação.

## 1. Contexto

"Contas a Pagar" hoje tem 3 origens de dinheiro a sair:

- **PP (Pedido de Produção)** — compra de serviço/insumo no contexto de um job. Workflow em 2 estágios (em avaliação → aprovada), qualquer usuário emite, admin/financeiro aprova.
- **Conta avulsa** — despesa administrativa (aluguel, IPTU, tarifa). Só admin/financeiro cria; nasce aprovada, sem workflow.
- **Recorrência** — template que materializa contas avulsas periódicas via cron.

Falta uma quarta origem: **desembolso**. Um funcionário fora do financeiro precisa registrar uma despesa que envolve dinheiro a sair da empresa mas que **não é PP** (não é compra de serviço num job) **e não é avulsa** (o funcionário não tem permissão de criar direto no financeiro — precisa passar pela aprovação).

Casos que hoje não têm caminho limpo:

- Passagem de Uber pra evento do cliente (funcionário anexa comprovante, aprova depois).
- Almoço de negócios (cartão corporativo, sem número de nota).
- Reembolso adiantado (funcionário paga do bolso, empresa reembolsa).
- Materiais de escritório comprados pelo gerente da regional.

Esses ficam hoje ou (a) empurrados como PP mesmo sem job (contaminando a base de PPs), (b) esquecidos até virarem dor de conciliação, ou (c) o funcionário pede pro financeiro criar avulsa manual (não-escalável).

Esta spec introduz a entidade **`desembolso`** — quarta origem de "Contas a Pagar" com workflow tipo PP mas escopo administrativo, com rateio regional, parcelas próprias e anexos.

## 2. Objetivo

Entregar em 3 frentes:

1. **Nova entidade `desembolsos`** — 4 tabelas espelhando o padrão de PP (`desembolsos`, `desembolsos_parcelas`, `desembolsos_regionais`, `desembolsos_anexos`) + 3 RPCs (`aprovar_desembolso_com_data`, `dar_baixa_desembolso_parcela`, `estornar_baixa_desembolso_parcela`).
2. **Nova página `/financeiro/desembolsos`** — qualquer usuário do tenant lança + acompanha status (dos seus se user comum, de todos se admin/financeiro). Drawer de criação com todos os campos do form. Página de detalhe com histórico.
3. **Integração com "Contas a Pagar"** — nova aba "Pedidos de Desembolsos" (análoga a PPs) para admin/financeiro aprovar/rejeitar. Ao aprovar, parcelas viram títulos e aparecem em "Títulos a Pagar" ou "Títulos a Pagar (Cartão)" conforme forma de pagamento.

Não-objetivo secundário mas importante: reutilizar o máximo do que já foi construído para PP e cartões — a 4ª origem entra como extensão do padrão dispatch-por-origem que já existe em `TitulosPagarList`, `TitulosCartaoList`, `dar_baixa_lote_cartao`, `darBaixaTitulo`, `estornarBaixaTitulo`.

## 3. Decisões arquiteturais

Todas fechadas em conversa com Antonio antes desta spec.

### 3.1. Tabela dedicada, não reaproveitar PP nem avulsa

Rejeitado extender `pedidos_compra` com `tipo enum ('pp'|'desembolso')` porque:
- Migration destrutiva: `quantidade` e `pdf_path` teriam que virar nullable em tabela com 10+ PPs em produção.
- Aba "PPs" em Contas a Pagar mostra colunas específicas de compra (`codigo`, `quantidade`, `servico`, `fornecedor`) — filtrar por tipo em todas as consultas espalharia `where tipo = 'pp'` por 15+ lugares.
- Semântica de "pedido de compra" se dilui.

Rejeitado reaproveitar `contas_avulsas` porque:
- Avulsa tem 1 valor único (sem parcelas); desembolso precisa de parcelas.
- Enum `ContaAvulsaStatus` é `aprovada|baixada` — adicionar `em_avaliacao|rejeitada|cancelada` muda semântica de dados em produção.

Custo real de A: 4 tabelas novas + 3 RPCs + N extensões pequenas — todas mecânicas, sem risco de regressão em domínios existentes.

### 3.2. Ciclo de vida idêntico a PP

`status desembolso_status` enum: `em_avaliacao | aprovada | pago | rejeitada | cancelada`. Mesma máquina de estados que PP. Aprovar aceita `data_pagamento` inicial que desloca todas parcelas pelo delta em relação à 1ª (regra existente em `aprovar_pp_com_data`).

Rejeição exige `motivo_rejeicao` (padrão PP). Cancelamento aceita `motivo_cancelamento`. Não pode cancelar depois que a 1ª parcela foi baixada.

### 3.3. Rateio regional como avulsa

Tabela `desembolsos_regionais` com `desembolso_id`, `regional_id`, `percentual` — mesma constraint que `contas_avulsas_regionais` (soma = 100, cada regional 1x). Zod schema idêntico ao `rateioSchema` já existente em `lib/validations/conta-avulsa.ts`.

### 3.4. Parcelas próprias, mesma semântica de PP-parcelas

Tabela `desembolsos_parcelas` espelha `pedidos_compra_parcelas`: `numero`, `data_vencimento`, `data_pagamento`, `data_pagamento_primeira` (congelada por trigger), `valor`, `pago_em`. Baixa é da PARCELA, não do desembolso — mesma decisão do plano 016.

Se forma = cartão, cálculo de datas via `parcelasParaFatura(dia_vencimento_fatura, hoje, N)` (helper já existente da Task 4 de cartões). Se não-cartão, usuário informa manualmente cada data.

### 3.5. Anexos como PP e avulsa

Tabela `desembolsos_anexos` com `arquivo_path`, `arquivo_nome_original`, `arquivo_tamanho_bytes`. Storage do Supabase, mesma bucket que anexos existentes usam.

Sem PDF gerado pelo sistema (diferente de PP). Desembolso não tem "documento formal" — o comprovante é anexo enviado pelo usuário.

### 3.6. Página `/financeiro/desembolsos` = lançar + acompanhar

Página em Financeiro (não em Cadastros). Diferente de contas-a-pagar que é a operação diária do financeiro, `/desembolsos` é o **ponto de entrada** do funcionário comum — ele lança e vê status dos seus.

- **User comum**: vê seus desembolsos (`created_by = auth.uid()`). Botão "Novo Desembolso" abre drawer.
- **Admin/financeiro**: vê todos. Mesmo drawer disponível (pode lançar em nome de alguém se necessário).

Aprovação **não acontece nesta página** — para separar concerns. Página `/desembolsos` é "criar + rastrear"; aprovação vive em Contas a Pagar (junto com PP), onde admin/financeiro trabalha o dia todo.

### 3.7. Aba "Pedidos de Desembolsos" em Contas a Pagar

Nova 6ª aba. Ordem final: **PPs → Pedidos de Desembolsos → Recorrências → Títulos a Pagar → Títulos a Pagar (Cartão) → Títulos Pagos**.

Layout análogo à aba "PPs":
- Tabela: código, descrição, empresa, fornecedor, valor, status, criado por.
- Botões contextuais: "Aprovar" (com data), "Rejeitar" (com motivo), "Cancelar" (com motivo).
- Badge de contagem = desembolsos `em_avaliacao`.

Posicionamento entre PPs e Recorrências agrupa "workflows de aprovação" (PP e Desembolso) antes das "origens diretas" (Recorrência que materializa avulsas).

### 3.8. Integração com "Títulos a Pagar" e "Cartão" via 4ª origem

`OrigemTitulo` passa de 3 para 4 valores: `pp | avulso | recorrencia | desembolso`.

Extensões (todas aditivas — nenhum caso existente muda):

- **`page.tsx` de contas-a-pagar**: 4º loop constrói `TituloRow` a partir de parcelas de `desembolsos` aprovados/pagos.
- **`darBaixaTitulo` e `estornarBaixaTitulo`** ([actions-titulos.ts](app/(app)/financeiro/contas-a-pagar/actions-titulos.ts)): `origem` no schema Zod ganha `'desembolso'`; branch novo chama `dar_baixa_desembolso_parcela` / `estornar_baixa_desembolso_parcela`.
- **RPC `dar_baixa_lote_cartao`** ([migration 20260820000005](supabase/migrations/20260820000005_baixa_lote_cartao.sql)): branch novo `elsif v_origem = 'desembolso' then v_lanc := dar_baixa_desembolso_parcela(...)`.
- **`actions-cartao.ts`** (`darBaixaLoteCartao`): Zod aceita `'desembolso'` no origem; batch SELECT ganha 3ª query em `desembolsos_parcelas` para audit individual.
- **`TituloRow`**: nenhuma mudança de shape — `forma_pagamento`, `cartao_credito_id`, `origem_label` já existem.

### 3.9. Permissões e RLS

Tabela `desembolsos` (e filhas):
- **SELECT** por `is_tenant_member(tenant_id)`. Filtro adicional na página: user comum vê `created_by = auth.uid()`; admin/financeiro vê todos.
- **INSERT** por `is_tenant_member(tenant_id)` (qualquer membro pode criar).
- **UPDATE** por `is_tenant_member(tenant_id)` — mas server actions validam por rota:
  - Editar rascunho em `em_avaliacao`: criador OU admin/financeiro.
  - Aprovar/rejeitar/cancelar: admin/financeiro.

### 3.10. Auditoria

Novas chaves em `AuditAction`:
- `desembolso.criado`
- `desembolso.editado`
- `desembolso.aprovada`
- `desembolso.rejeitada`
- `desembolso.cancelada`
- `desembolso.parcela_paga`
- `desembolso.parcela_baixa_estornada`

Baixa em lote de cartão continua emitindo o evento agregado `contas_pagar.baixa_lote_cartao` + os eventos individuais (`desembolso.parcela_paga` para desembolsos, mantendo o padrão de PPs/avulsas).

## 4. Modelo de dados

### 4.1. Enum + 4 tabelas novas (Migration 1)

```sql
create type desembolso_status as enum
  ('em_avaliacao', 'aprovada', 'pago', 'rejeitada', 'cancelada');

create table desembolsos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  codigo text not null,
  empresa_id uuid not null references empresas(id),
  descricao text not null,
  valor numeric(14, 2) not null check (valor > 0),
  forma_pagamento forma_pagamento null,
  cartao_credito_id uuid null references cartoes_credito(id),
  status desembolso_status not null default 'em_avaliacao',
  fornecedor_id uuid null references fornecedores(id),
  cliente_id uuid null references clientes(id),
  job_id uuid null references jobs(id),
  data_prevista_pagamento date null,
  motivo_rejeicao text null,
  motivo_cancelamento text null,
  criado_por uuid not null references profiles(id),
  aprovada_por uuid null references profiles(id),
  aprovada_em timestamptz null,
  rejeitada_por uuid null references profiles(id),
  rejeitada_em timestamptz null,
  cancelada_por uuid null references profiles(id),
  cancelada_em timestamptz null,
  pago_em timestamptz null,
  pago_por uuid null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, codigo),
  constraint chk_desembolso_cartao check (
    (forma_pagamento = 'cartao_credito' and cartao_credito_id is not null)
    or (forma_pagamento is distinct from 'cartao_credito' and cartao_credito_id is null)
  )
);

create index idx_desembolsos_tenant_status on desembolsos (tenant_id, status);
create index idx_desembolsos_criado_por on desembolsos (tenant_id, criado_por);
create index idx_desembolsos_cartao
  on desembolsos (tenant_id, cartao_credito_id)
  where cartao_credito_id is not null;
create index idx_desembolsos_job on desembolsos (tenant_id, job_id) where job_id is not null;

create table desembolsos_parcelas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  desembolso_id uuid not null references desembolsos(id) on delete cascade,
  numero smallint not null check (numero >= 1),
  data_vencimento date not null,
  data_pagamento date null,
  data_pagamento_primeira date null,
  valor numeric(14, 2) not null check (valor > 0),
  pago_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (desembolso_id, numero)
);

create index idx_desembolsos_parcelas_desembolso on desembolsos_parcelas (desembolso_id);
create index idx_desembolsos_parcelas_tenant_venc on desembolsos_parcelas (tenant_id, data_vencimento);

create table desembolsos_regionais (
  desembolso_id uuid not null references desembolsos(id) on delete cascade,
  regional_id uuid not null references regionais(id),
  percentual numeric(5, 2) not null check (percentual > 0 and percentual <= 100),
  primary key (desembolso_id, regional_id)
);

create table desembolsos_anexos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  desembolso_id uuid not null references desembolsos(id) on delete cascade,
  arquivo_path text not null,
  arquivo_nome_original text not null,
  arquivo_tamanho_bytes bigint not null check (arquivo_tamanho_bytes >= 0),
  criado_por uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_desembolsos_anexos_desembolso on desembolsos_anexos (desembolso_id);

-- RLS + GRANT nas 4 tabelas
alter table desembolsos enable row level security;
alter table desembolsos_parcelas enable row level security;
alter table desembolsos_regionais enable row level security;
alter table desembolsos_anexos enable row level security;

-- SELECT: qualquer membro do tenant vê tudo; filtro por criador acontece na action.
create policy desembolsos_select on desembolsos
  for select to authenticated using (is_tenant_member(tenant_id));
create policy desembolsos_insert on desembolsos
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy desembolsos_update on desembolsos
  for update to authenticated
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy desembolsos_delete on desembolsos
  for delete to authenticated using (is_tenant_member(tenant_id));

-- Mesmas 4 policies nas 3 tabelas filhas, com is_tenant_member(tenant_id).

grant select, insert, update, delete on desembolsos to authenticated;
grant select, insert, update, delete on desembolsos_parcelas to authenticated;
grant select, insert, update, delete on desembolsos_regionais to authenticated;
grant select, insert, update, delete on desembolsos_anexos to authenticated;

-- Triggers de updated_at nas 2 tabelas que têm essa coluna
create trigger trg_desembolsos_updated_at
  before update on desembolsos for each row execute function set_updated_at();
create trigger trg_desembolsos_parcelas_updated_at
  before update on desembolsos_parcelas for each row execute function set_updated_at();

-- Trigger para congelar data_pagamento_primeira no primeiro set
-- (mesma lógica do trigger em pedidos_compra_parcelas)
```

### 4.2. RPCs (Migration 2)

**`aprovar_desembolso_com_data(p_desembolso_id, p_data_pagamento)`** — espelho de `aprovar_pp_com_data`:
- Verifica status = `em_avaliacao`.
- Muda status para `aprovada`.
- Se cartão, ignora `p_data_pagamento` e usa `proxima_fatura_cartao(cartao_id, current_date)` para a 1ª parcela; demais parcelas ganham +1 mês por parcela.
- Se não-cartão, desloca todas parcelas pelo delta em relação ao vencimento da 1ª.
- Grava `aprovada_por = auth.uid()`, `aprovada_em = now()`.

**`dar_baixa_desembolso_parcela(p_parcela_id, p_pago_em, p_conta_bancaria_id, p_plano_conta_tipo_id, p_plano_conta_subtipo_id, p_criado_por)`** — espelho de `dar_baixa_pp_parcela`:
- Constraint unique `uniq_baixa_ativa_por_desembolso_parcela` garante idempotência.
- Grava `lancamentos_financeiros` com `desembolso_parcela_id` (nova coluna FK — ver seção 4.3).
- Se todas as parcelas do desembolso estão pagas, marca desembolso como `pago`.

**`estornar_baixa_desembolso_parcela(p_parcela_id, p_motivo, p_criado_por)`** — espelho.

### 4.3. Coluna nova em `lancamentos_financeiros`

Para permitir vínculo do lançamento à parcela de desembolso:

```sql
alter table lancamentos_financeiros
  add column desembolso_parcela_id uuid null references desembolsos_parcelas(id);

alter table lancamentos_financeiros
  add constraint uniq_baixa_ativa_por_desembolso_parcela
  unique (desembolso_parcela_id)
  where desembolso_parcela_id is not null and cancelado_em is null;
```

`origem` enum de `lancamentos_financeiros` (`OrigemLancamento`) ganha valor `'desembolso_baixa'` e `'desembolso_estorno'` (aditivo).

### 4.4. Ajuste na RPC `dar_baixa_lote_cartao` (Migration 3)

Adiciona branch para origem `'desembolso'`:

```sql
elsif v_origem = 'desembolso' then
  v_lanc := dar_baixa_desembolso_parcela(
    v_id, p_pago_em,
    p_conta_bancaria_id, p_plano_conta_tipo_id,
    p_plano_conta_subtipo_id, p_criado_por
  );
```

Também aceita `desembolso` no `raise exception` de origem desconhecida (removê-lo da lista).

### 4.5. Atualização de `lib/types.ts`

- `DesembolsoStatus`, `Desembolso`, `DesembolsoParcela` (interfaces).
- `OrigemTitulo` estendido: `"pp" | "avulso" | "recorrencia" | "desembolso"`.
- `TituloRow.origem` type union atualizado.
- `OrigemLancamento` estendido: `... | "desembolso_baixa" | "desembolso_estorno"`.

## 5. Server actions

Em `app/(app)/financeiro/desembolsos/actions.ts`:

- `criarDesembolso(input)` — qualquer membro. Zod valida campos + rateio (soma 100) + refinement de cartão. INSERT em `desembolsos` + `desembolsos_parcelas` + `desembolsos_regionais` + `desembolsos_anexos` na mesma transação (via RPC helper ou 4 statements sequenciais em uma função). Audit `desembolso.criado`.
- `aprovarDesembolsoComData(input)` — gate admin/financeiro. Chama RPC `aprovar_desembolso_com_data`. Audit `desembolso.aprovada`.
- `rejeitarDesembolso({id, motivo})` — gate admin/financeiro. UPDATE status + motivo. Audit `desembolso.rejeitada`.
- `cancelarDesembolso({id, motivo})` — gate admin/financeiro. Verifica que nenhuma parcela foi baixada. UPDATE status. Audit `desembolso.cancelada`.

Em `app/(app)/financeiro/contas-a-pagar/actions-titulos.ts`:
- `darBaixaTitulo` e `estornarBaixaTitulo` — `origem` no schema ganha `'desembolso'`. Novo branch chama RPCs correspondentes.

Em `app/(app)/financeiro/contas-a-pagar/actions-cartao.ts`:
- `darBaixaLoteCartao` — `origem` no schema ganha `'desembolso'`. Batch SELECT ganha query em `desembolsos_parcelas`.

## 6. UI

### 6.1. Página `/financeiro/desembolsos`

Arquivos:
- `page.tsx` (server) — fetch de desembolsos (todos se admin, próprios se comum), cartões ativos, empresas, fornecedores, clientes, jobs, regionais.
- `desembolsos-list.tsx` (client) — tabela com filtros de status (chips: Todos, Em avaliação, Aprovados, Pagos, Rejeitados, Cancelados) + busca. Linha inteira clicável → `/financeiro/desembolsos/[id]`.
- `desembolso-drawer.tsx` (client) — form completo com `FormaPagamentoField`, rateio regional (mesmo padrão de conta avulsa), anexos (upload múltiplo), parcelas (mesmo padrão de emissão de PP — auto-preenchimento se cartão).
- `actions.ts` (server) — 5 actions listadas em §5.

Página de detalhe:
- `[id]/page.tsx` — read-only. Mostra dados completos + parcelas + anexos + histórico (audit_events filtrados).
- Não tem botão "Editar" (V1 não permite edição — ver não-objetivo #1). Cancelamento fica na aba de Contas a Pagar.

### 6.2. Aba "Pedidos de Desembolsos" em Contas a Pagar

Arquivo novo: `app/(app)/financeiro/contas-a-pagar/desembolsos-list.tsx` (client), análogo a `PedidosCompraList` mas para desembolsos.

Modificações:
- `app/(app)/financeiro/contas-a-pagar/page.tsx` — adiciona SELECT de desembolsos ao `Promise.all`, passa como prop para tabs.
- `app/(app)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx` — 6ª aba entre "PPs" e "Recorrências".

Botões contextuais na row:
- Se `em_avaliacao`: **Aprovar** (abre dialog com data), **Rejeitar** (abre dialog com motivo), **Cancelar**.
- Se `aprovada`: só **Cancelar** (com aviso "só se nenhuma parcela foi baixada").

### 6.3. Sidebar

Adicionar link "Desembolsos" no menu Financeiro, entre "Contas a Pagar" e "Fluxo de Caixa" (posição a confirmar durante implementação lendo `components/sidebar.tsx`).

### 6.4. Nada muda visualmente em "Títulos a Pagar" e "Títulos a Pagar (Cartão)"

Desembolsos aprovados/pagos aparecem naturalmente como títulos com origem `'desembolso'`. Origem label = código do desembolso. Nenhuma UI condicional nova.

## 7. Riscos e mitigações

**Risco 1 — Fluxo de caixa (`jobs_previsao_custo` ou queries agregadas) pode não considerar desembolsos.**
Verificar se essa tabela lê PPs por linha ou se agrega. Se agrega por origem, precisa incluir desembolsos aprovados. Mitigação: task da implementação inclui investigar consultas do fluxo de caixa e propor ajuste se necessário.

**Risco 2 — Geração de `codigo` do desembolso.**
PP tem uma função `proximo_codigo_pp()` (a verificar). Desembolso precisa de esquema similar (`DES-000001`, `DES-000002`, ...). Mitigação: replicar a função como `proximo_codigo_desembolso()` na mesma migration. Se PP não tem função e o código vem da action, replicar padrão.

**Risco 3 — Constraint unique de baixa por parcela pode entrar em conflito com estorno.**
PP usa constraint parcial `where cancelado_em is null`. Desembolso deve fazer o mesmo. Mitigação: replicar padrão exato de PP.

**Risco 4 — Anexos: bucket e política de upload.**
Anexos hoje usam Storage do Supabase com path `<tenant_id>/<entidade>/<id>/<arquivo>`. Desembolso segue o mesmo padrão. Storage policies existentes já cobrem `split_part(name, '/', 1)::uuid = tenant_id` genericamente — verificar se aceita a nova entidade sem policy nova.

**Risco 5 — Migration criando 4 tabelas em uma só é grande.**
Aceitável — migrations dos módulos anteriores (PP, avulsa, contas-a-receber) também criam múltiplas tabelas relacionadas juntas. Aditiva, sem risco de rollback complicado.

**Risco 6 — Cartão inativado com desembolso pendente.**
Mesma situação já resolvida na aba "Cartão" para outros origens: mostra "Cartão não identificado" como fallback. Herda o comportamento.

## 8. Não-objetivos

Fora do escopo desta primeira entrega:

1. **Edição de desembolso após criação** — V1 não permite editar. Se o user comum errou algo, cancela e cria de novo. Se admin/financeiro precisa corrigir, também. Simplifica auditoria e evita corrida de estado com aprovação. Se a demanda aparecer, `editarDesembolso` entra em fase 2 (é aditivo).
2. **Aprovação em múltiplos níveis** (ex: valor > R$ 5k precisa aprovação da diretoria). Um-nível-só como PP.
3. **Notificações** (email/push quando desembolso é aprovado/rejeitado). User comum abre a página pra ver status.
4. **Reembolso automático** (integração com folha ou cash-out). Fora de escopo.
5. **Budget check por regional** — validar que o desembolso cabe no orçamento da regional. Fora de escopo.
6. **Import CSV de desembolsos**. YAGNI.

## 9. Ordem de implementação

Sequência que minimiza risco (cada passo commit isolado com migration + código + tipos):

1. **Migration 1** — enum + 4 tabelas + RLS/GRANT/índices + trigger `data_pagamento_primeira` + função `proximo_codigo_desembolso`. Types em `lib/types.ts` (Desembolso, DesembolsoStatus, DesembolsoParcela).
2. **Migration 2** — 3 RPCs (`aprovar_desembolso_com_data`, `dar_baixa_desembolso_parcela`, `estornar_baixa_desembolso_parcela`).
3. **Migration 3** — coluna `desembolso_parcela_id` em `lancamentos_financeiros` + constraint unique + enum `OrigemLancamento` estendido.
4. **Migration 4** — patch em `dar_baixa_lote_cartao` para aceitar origem `'desembolso'`.
5. **Validation Zod + server actions** (`desembolsos/actions.ts` com 5 actions + `lib/validations/desembolso.ts`).
6. **Página `/financeiro/desembolsos`** — server component + list + drawer + detalhe.
7. **Sidebar link.**
8. **Aba "Pedidos de Desembolsos" em Contas a Pagar** — `desembolsos-list.tsx`, integração em `page.tsx` e `contas-pagar-tabs.tsx`.
9. **Integração com Títulos** — estender `OrigemTitulo`, 4º loop em `page.tsx` de contas-a-pagar, dispatch em `darBaixaTitulo`/`estornarBaixaTitulo`/`darBaixaLoteCartao`, chaves de audit novas em `lib/auth/audit.ts`.
10. **Verificação final E2E** — build + typecheck + lint + smoke via UI.

Estimativa: 10-11 tasks no plano, cada uma pequena, com padrão similar ao que executamos para cartões.
