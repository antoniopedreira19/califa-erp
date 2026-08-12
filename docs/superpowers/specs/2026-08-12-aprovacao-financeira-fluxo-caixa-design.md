# Aprovação financeira e Fluxo de Caixa — design

**Data:** 2026-08-12
**Status:** proposto, aguardando revisão

## Contexto

Hoje, o ciclo de vida financeiro de uma obrigação a pagar tem apenas dois estados úteis:

- **PP** (`pedidos_compra.status`): `em_avaliacao` → `pago` (baixa direta na caixa de entrada) — mais `rejeitada`/`cancelada` laterais.
- **Conta avulsa** (`contas_avulsas.status`): `pendente` → `baixada`. Contas recorrentes geram avulsas `pendente`.
- **`lancamentos_financeiros`**: só é criado no ato da baixa (origens `pp_baixa`, `avulsa_baixa`, etc.). É o que a **Conciliação** já consome — portanto Conciliação hoje só mostra o que efetivamente saiu do banco. Isso está correto e não muda.

Falta o estado intermediário **"aprovado, aguardando pagamento"**. Sem ele:

- Não é possível separar a decisão de pagar do ato de pagar.
- Não é possível projetar **fluxo de caixa** (o que já foi aprovado a pagar e vai sair do banco em X dias).
- A caixa de entrada mistura duas ações que deveriam ser distintas (avaliar/aprovar vs. baixar).

## Objetivo

Introduzir o estado **aprovado** como etapa obrigatória antes da baixa, e a partir dele:

1. Permitir que a financeira **aprove** uma PP na caixa de entrada, sem baixá-la ainda.
2. Fazer com que **lançamentos avulsos e recorrentes** nasçam já com esse mesmo estado semântico ("aprovado, aguardando pagamento").
3. Ter uma tela **"A pagar"** onde a financeira dá baixa de fato.
4. Ter uma tela **"Fluxo de caixa"** que consolida previsto (aprovados não baixados) + realizado (baixados).
5. Manter **Conciliação** como está — lê apenas `lancamentos_financeiros`.

## Não-objetivos

- Não haverá workflow de múltiplos aprovadores ou alçadas por valor.
- Não haverá aprovação em massa neste ciclo (só individual).
- Não muda o ciclo de vida da PP antes da caixa de entrada (aprovação orçamentária, cotação etc. seguem iguais).
- Não muda o schema nem o comportamento da Conciliação.
- Não haverá integração bancária automática.

## Modelagem

### 1. Enum de status da PP

`pedidos_compra.status` (enum `pp_status`, hoje: `em_avaliacao`, `pago`, `rejeitada`, `cancelada`) ganha o valor `aprovada`, posicionado logicamente entre `em_avaliacao` e `pago`.

Ciclo de vida da PP na financeira passa a ser:

```
em_avaliacao ──aprovar──► aprovada ──baixar──► pago
      │                        │
      └────rejeitar────────────┴─► rejeitada
      └────cancelar────────────┴─► cancelada
```

Colunas novas em `pedidos_compra`:

- `aprovada_em timestamptz null`
- `aprovada_por uuid null references profiles(id)`

Constraint: se `status = 'aprovada'` ou posterior (`pago`), `aprovada_em` e `aprovada_por` são obrigatórios.

### 2. Enum de status das avulsas — renomear `pendente` → `aprovada`

Semanticamente, hoje `pendente` já significa "aprovada e aguardando pagamento" (não existe etapa de avaliação de avulsa). O rename alinha vocabulário com o da PP e permite queries uniformes no Fluxo de Caixa.

Migração em **duas migrations** (safe two-step), pois `alter type ... rename value` existe em Postgres 10+ mas não permite remover valor antigo em uso:

**Migration A** (`20260812000001_avulsa_status_aprovada.sql`):

1. `alter type conta_avulsa_status add value if not exists 'aprovada' before 'baixada';`
2. `update contas_avulsas set status = 'aprovada' where status = 'pendente';`
3. Ajustar `default` da coluna: `alter table contas_avulsas alter column status set default 'aprovada';`
4. Reescrever RPCs e views que referenciam `'pendente'` para usar `'aprovada'`.

**Migration B** (`20260812000002_avulsa_status_remove_pendente.sql`), aplicada depois que todo o código de aplicação está atualizado:

1. Recria o enum sem `'pendente'` via `alter type ... rename to ..._old` + `create type ... as enum('aprovada','baixada')` + `alter table ... using status::text::conta_avulsa_status` + `drop type ..._old`.

Colunas novas em `contas_avulsas` (paralelo ao que já existe pra baixa):

- `aprovada_em timestamptz null`
- `aprovada_por uuid null references profiles(id)`

Para linhas pré-existentes migradas de `pendente` → `aprovada`, popular `aprovada_em = created_at` e `aprovada_por = criado_por` (aprovação implícita retroativa).

Constraint atualizada: quando `status in ('aprovada','baixada')`, exigir `aprovada_em` e `aprovada_por` preenchidos. `chk_avulsa_baixa_consistente` continua exigindo os campos de baixa apenas quando `status = 'baixada'`.

### 3. Recorrentes

`contas_avulsas_recorrentes` (template) não muda de schema. Só a RPC `gerar_ocorrencias_recorrentes` passa a criar instâncias com `status = 'aprovada'`, `aprovada_em = now()`, `aprovada_por = criado_por do template`.

### 4. RPCs de baixa e estorno passam a exigir/retornar `aprovada`

- `dar_baixa_pp`: passa a validar `status = 'aprovada'` (hoje valida `= 'em_avaliacao'`). Se receber PP em `em_avaliacao`, retorna erro `PP precisa estar aprovada antes da baixa`.
- `estornar_baixa_pp`: passa a devolver o status pra `aprovada` (hoje devolve pra `em_avaliacao`). Racional: PP já foi aprovada; estornar a baixa não é reprovar.
- `dar_baixa_avulsa`: passa a validar `status = 'aprovada'` (hoje valida `= 'pendente'`).
- `estornar_baixa_avulsa`: passa a devolver o status pra `aprovada` (hoje devolve pra `'pendente'` — que após a Migration A já não existirá).

### 5. Nova RPC `aprovar_pp`

```sql
create or replace function public.aprovar_pp(p_pedido_id uuid)
returns void
language plpgsql
security definer
as $$ ... $$
```

Comportamento:

- Verifica RLS/tenant.
- Verifica `status = 'em_avaliacao'`.
- Atualiza `status = 'aprovada'`, `aprovada_em = now()`, `aprovada_por = auth.uid()`.
- Insere linha em `pedidos_compra_historico` (ou tabela equivalente já existente) com ação `aprovada_financeiro`.
- Sem side-effects contábeis (não cria lançamento — lançamento só nasce na baixa, como hoje).

### 6. RPC análoga pra avulsa

Não é estritamente necessária: avulsa **nasce aprovada** por default. Só usada em cenário futuro de "criar como rascunho" (fora do escopo). Portanto não implemento agora — YAGNI.

## Telas

### 6.1 Caixa de entrada financeira (existente, `financeiro/contas-a-pagar`)

**Muda:**

- Filtro passa a mostrar apenas PPs com `status = 'em_avaliacao'`.
- Ações por linha: **Aprovar** (verde/primária) e **Rejeitar** (secundária).
- Some a ação de "dar baixa" desta tela (migra pra "A pagar").
- Modal atual `baixa-pp-modal.tsx` NÃO é chamado daqui.

**Nome da rota:** mantém `financeiro/contas-a-pagar`. Título de página passa a ser "Caixa de entrada".

### 6.2 Nova tela "A pagar" (`financeiro/a-pagar`)

**Conteúdo:**

- Lista unificada de PPs `aprovada` (não pagas) + avulsas `aprovada` (não baixadas).
- Colunas: data prevista, fornecedor, descrição, valor, origem (PP / Avulsa / Recorrente), aprovada em / por.
- Ordenação default: `data_prevista_pagamento` ascendente, com destaque de vencidos.
- Ação principal por linha: **Dar baixa** — abre o modal existente `BaixaPPModal` (ou variante avulsa).
- Filtros: por conta bancária, empresa, tipo de origem, faixa de data.

**Query:** view SQL `vw_a_pagar` que unifica os dois lados com colunas normalizadas.

### 6.3 Nova tela "Fluxo de caixa" (`financeiro/fluxo-caixa`)

**Conteúdo:**

- Consolida **previsto** (aprovado não baixado) + **realizado** (`lancamentos_financeiros`).
- Modos de visualização: agrupado por dia, semana ou mês.
- Colunas por bucket: total previsto, total realizado, saldo acumulado projetado por conta bancária.
- Drill-down: clicar no bucket abre a lista de itens daquele período.
- Filtros: conta bancária, empresa, faixa de datas, tipo de origem.

**Query:** view SQL `vw_fluxo_caixa` que faz `UNION ALL`. Usa os nomes reais de coluna do schema atual (PP: `valor`, `servico`, `prazo_pagamento_financeiro`; avulsa: `valor`, `descricao`, `data_prevista_pagamento`):

```sql
create or replace view public.vw_fluxo_caixa as
-- PPs aprovadas ainda não pagas (previsto)
select
  'previsto'::text                          as situacao,
  'pp'::text                                as origem_tipo,
  pp.id                                     as origem_id,
  pp.tenant_id, pp.empresa_id,
  null::uuid                                as conta_bancaria_id,   -- PP não tem conta prevista
  pp.prazo_pagamento_financeiro             as data_evento,
  pp.valor                                  as valor,
  'saida'::natureza_lancamento              as natureza,
  ('PP ' || pp.codigo || ' — ' || substring(pp.servico, 1, 150)) as descricao,
  pp.fornecedor_id,
  null::uuid                                as cliente_id,
  pp.job_id
from public.pedidos_compra pp
where pp.status = 'aprovada'

union all

-- Avulsas aprovadas ainda não baixadas (previsto)
select
  'previsto',
  case when a.recorrente_origem_id is not null then 'recorrente' else 'avulsa' end,
  a.id,
  a.tenant_id, a.empresa_id,
  null::uuid                                as conta_bancaria_id,   -- ainda não decidida
  a.data_prevista_pagamento                 as data_evento,
  a.valor,
  a.natureza,
  a.descricao,
  a.fornecedor_id, a.cliente_id, a.job_id
from public.contas_avulsas a
where a.status = 'aprovada'

union all

-- Lançamentos realizados
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
```

Notas:

- **PP não tem `conta_bancaria_prevista_id`** hoje, e não vou adicionar (a conta só é decidida no ato da baixa). Consequência: no Fluxo de Caixa, PPs aprovadas aparecem no bucket temporal correto mas sem alocação de conta. A UI agrega esses itens numa linha "sem conta alocada" ao consolidar por conta bancária. Idem pra avulsa aprovada. Só o "realizado" tem conta bancária certa.
- Se a coluna `recorrente_origem_id` não existir com esse nome exato em `contas_avulsas` (a spec original de recorrentes cria a instância na mesma tabela), o wiring resolve na Migration 5 usando o nome real (`origem_recorrente_id`, `recorrente_id`, etc.) — checagem trivial na hora de escrever a migration.
- View não usa `security barrier` — RLS das tabelas subjacentes já filtra por tenant, e `authenticated` só recebe `SELECT` na view (com GRANT explícito).

**GRANT:** `grant select on public.vw_fluxo_caixa to authenticated;`

### 6.4 Conciliação (existente)

**Não muda.** Continua consumindo `lancamentos_financeiros` diretamente. Nenhum ajuste de schema, RPC ou UI.

## Auditoria

- Aprovar PP: log em `pedidos_compra_historico` (ou tabela análoga já existente na Task 011/012) com ação `aprovada_financeiro`, `alterado_por = auth.uid()`.
- Aprovação implícita retroativa das avulsas migradas: **não** loga histórico linha a linha (seria ruído). A migration deixa um `comment on column contas_avulsas.aprovada_em is 'Retroativo pra linhas anteriores a 2026-08-12 = created_at';` como registro.
- Baixa: já é auditada hoje, mantém.

## Migrations previstas (ordem)

1. `20260812000001_pp_status_aprovada.sql` — adiciona valor `aprovada` no enum `pedido_compra_status`; adiciona colunas `aprovada_em`, `aprovada_por`; adiciona constraint.
2. `20260812000002_avulsa_status_aprovada.sql` — adiciona valor `aprovada` no enum; UPDATE `pendente → aprovada`; adiciona colunas `aprovada_em`/`aprovada_por`; migra retroativos; muda default; atualiza constraint.
3. `20260812000003_aprovar_pp_rpc.sql` — cria RPC `aprovar_pp`; ajusta `dar_baixa_pp` pra exigir `aprovada`; ajusta RPC de baixa avulsa idem.
4. `20260812000004_recorrentes_nascem_aprovadas.sql` — reescreve `gerar_ocorrencias_recorrentes` pra criar instâncias `aprovada`.
5. `20260812000005_vw_fluxo_caixa_e_a_pagar.sql` — cria views + GRANTs.
6. `20260812000006_avulsa_status_remove_pendente.sql` — recria enum sem `pendente` (só depois que o código de aplicação está 100% atualizado — merge em passo separado).

## Front-end (arquivos previstos)

- `app/(app)/financeiro/contas-a-pagar/page.tsx` — remove ação "baixar"; adiciona "Aprovar" e "Rejeitar".
- `app/(app)/financeiro/contas-a-pagar/actions.ts` — nova action `aprovarPP()`; `marcarPagaFinanceiro()` permanece mas fica não usada aqui (fica na nova rota).
- `app/(app)/financeiro/a-pagar/page.tsx` — **novo**.
- `app/(app)/financeiro/a-pagar/actions.ts` — **novo** (chama RPCs de baixa).
- `app/(app)/financeiro/fluxo-caixa/page.tsx` — **novo**.
- `components/sidebar.tsx` — adicionar itens de menu "A pagar" e "Fluxo de caixa" na seção Financeiro.

Todas as strings de UI em pt-BR com acentos, conforme CLAUDE.md.

## Performance

- Views SQL têm RLS via tabelas subjacentes — nenhum RPC pesado no request path.
- Índices adicionais: `create index if not exists idx_pp_status_aprovada on pedidos_compra(tenant_id, data_prevista_pagamento) where status = 'aprovada';` (partial index) e o análogo em `contas_avulsas` (já existe `idx_avulsas_data_prevista`, mas partial `where status='aprovada'` acelera Fluxo de Caixa).
- Fluxo de Caixa carrega buckets agregados no server component, com `Promise.all` das 3 queries (previsto-PP, previsto-avulsa, realizado). Lista detalhada por bucket é lazy (drill-down).
- Nenhum `<Link>` massivo — as listagens usam paginação server-side.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Código externo (planilhas exportadas, scripts) usa `status='pendente'` | Migration A mantém compatibilidade lendo os dois; Migration B só depois de confirmação. |
| PP não tem conta bancária prevista no schema atual | Confirmado: não adiciono. Fluxo de Caixa mostra bucket temporal correto mas com linha "sem conta alocada" quando agrega por conta. Sacrifício pequeno; alternativa (adicionar coluna + preencher na aprovação) fica pra depois se virar dor. |
| Usuário aprova PP por engano | Ação "Desaprovar" (volta pra `em_avaliacao`) fica disponível na tela "A pagar" enquanto `status = 'aprovada'`. RPC `desaprovar_pp`. |
| Volume de linhas na view cresce e Fluxo de Caixa fica lento | Materializar a view se p95 passar de 500ms; refresh a cada baixa/aprovação via trigger. Não antecipar. |

## Critérios de sucesso

1. PP fluxo `em_avaliacao → aprovada → pago` funciona e é auditado.
2. Toda avulsa/recorrente nasce `aprovada`.
3. Conciliação continua idêntica.
4. Fluxo de caixa mostra soma previsto + realizado por dia e conta, sem divergência com Conciliação no bucket "realizado".
5. Não há regressão de performance nas telas existentes.
