# Forma de Pagamento na Baixa (PP e Desembolso) — Design

**Data:** 2026-08-25
**Autor:** Antonio + Claude
**Status:** Aguardando revisão do Antonio antes do plano de implementação.

## 1. Contexto

A feature de cartões de crédito (20/08/2026) introduziu `forma_pagamento` como coluna nas 4 tabelas-origem de "Contas a Pagar" (`pedidos_compra`, `contas_avulsas`, `contas_avulsas_recorrentes`, `desembolsos`). A decisão foi consistente pra 2 delas mas errada pra outras 2:

- **Conta avulsa e recorrência**: quem cria É o pagador (financeiro). Faz sentido escolher forma na criação — ele sabe.
- **PP e Desembolso**: são **solicitações**. Quem cria (produção, funcionário) não é quem paga. Só o pagador (financeiro) sabe a forma, e só descobre no momento da baixa.

O design atual força quem cria PP/Desembolso a marcar uma forma que **não sabe** — resultado: campo preenchido por convenção arbitrária, sem valor semântico, e o realizado (a forma efetivamente usada na baixa) fica invisível no sistema.

Segundo problema descoberto durante essa análise: `lancamentos_financeiros` **nunca** teve `forma_pagamento` — nasceu antes do conceito de cartão existir e ficou pra trás. Mesmo pra avulsa/recorrência (onde o design "funciona"), a informação da forma **some** quando cai no lançamento. Consequências:

- **Conciliação bancária** vira quebra-cabeça: fatura do cartão no extrato não casa com nenhum lançamento diretamente.
- **DRE por cartão** (relatório "quanto rolou no Nubank em setembro") é impossível de responder com o modelo atual.
- **Auditoria** tem a info mas não consultável por SQL analítico.

Esta spec corrige as duas coisas ao mesmo tempo: move `forma_pagamento` pra onde deveria estar em cada origem, e adiciona a coluna em `lancamentos_financeiros` (fato consumado).

## 2. Objetivo

Entregar em 3 frentes:

1. **Modelagem correta por origem**:
   - Remove `forma_pagamento` e `cartao_credito_id` de `pedidos_compra` e `desembolsos` (destrutivo — user autorizou).
   - Mantém em `contas_avulsas` e `contas_avulsas_recorrentes` (semântica "planejado").
   - Adiciona em `lancamentos_financeiros` (semântica "realizado", nullable pra preservar histórico).

2. **Fluxo de baixa capturando forma**:
   - Modal de baixa único (`baixa-titulo-dialog.tsx`) ganha `FormaPagamentoField`.
   - Avulsa/recorrência: pré-preenchido pela origem, editável.
   - PP/Desembolso: começa vazio, obrigatório.
   - RPCs de baixa (`dar_baixa_pp_parcela`, `dar_baixa_desembolso_parcela`, `dar_baixa_avulsa_com_plano`) ganham 2 parâmetros; gravam em `lancamentos_financeiros`.

3. **UI coerente com o novo timing**:
   - Forms de criação de PP e Desembolso perdem `FormaPagamentoField` e cálculo automático de datas via `parcelasParaFatura`.
   - Aba "Cartão" muda a base do filtro: pendentes olham origem, pagos olham lançamento.
   - `TitulosCartaoList` só aceita avulsa/recorrência pendentes na baixa em lote (PP/Desembolso pendentes nunca aparecem lá).
   - `dar_baixa_lote_cartao` perde branches `pp` e `desembolso` (só avulso/recorrência).

## 3. Decisões arquiteturais

Todas fechadas em conversa com Antonio antes desta spec.

### 3.1. Remover colunas de PP e Desembolso, não deprecar

`DROP COLUMN` em `pedidos_compra` e `desembolsos`. Aceito o custo destrutivo:
- Regra do FLUXO-BANCO exige confirmação explícita — user confirmou.
- Poucas PPs em produção têm forma preenchida (feature nova); desembolsos tem 0 linhas relevantes.
- Alternativa "deixar nullable sem uso" cria vestígio arqueológico confuso para devs futuros.

Constraints `chk_pp_cartao` e `chk_desembolso_cartao` caem junto. Índices parciais `idx_pp_cartao` e `idx_desembolsos_cartao` também.

### 3.2. Adicionar `forma_pagamento` + `cartao_credito_id` em `lancamentos_financeiros`

Aditivo puro. Nullable pra preservar lançamentos históricos (que nasceram antes desta migration). Toda baixa nova preenche.

Comment na coluna: "Forma efetivamente usada na baixa. Nulo em lançamentos anteriores a 25/08/2026 e em lançamentos de origem 'manual' sem forma definida."

Sem `chk_lancamento_cartao` — coerência (cartão exige cartão_id) fica validada nas RPCs, não em constraint de tabela. Motivo: `lancamentos_financeiros` já tem constraints complexas (`chk_origem_tem_referencia`, `chk_origem_contraparte_tem_id`) e adicionar outra check aumenta a matriz de casos. Validação em código é suficiente.

### 3.3. Manter colunas em avulsa e recorrência com semântica "planejado"

`contas_avulsas.forma_pagamento` e `contas_avulsas_recorrentes.forma_pagamento` continuam. Comment atualizado:

> "Forma PLANEJADA na criação. A forma REALIZADA (que pode divergir) é gravada em `lancamentos_financeiros` na baixa. Podem divergir — o realizado é a verdade."

### 3.4. Modal de baixa único ganha `FormaPagamentoField`

Um único modal (`baixa-titulo-dialog.tsx` — já existe hoje) atende todas as origens. Ganha o componente já compartilhado. Comportamento por origem:

- **PP/Desembolso**: campo vazio, obrigatório escolher. Zod valida.
- **Avulsa/Recorrência**: pré-preenchido com valor da origem, editável.

`pago_em` não recebe auto-preenchimento pra fatura (diferente da criação de avulsa hoje) — na baixa, `pago_em` é o dia efetivo do movimento. Se financeiro está fechando fatura de cartão, ele coloca a data que a fatura saiu da conta.

### 3.5. Filtro da aba "Cartão" fica "melhor esforço"

`TituloRow.forma_pagamento` passa a ser coalescido no `page.tsx`:

- Se `status === 'a_pagar'` → usa `forma_pagamento` da origem (só avulsa/recorrência têm; PP/Desembolso ficam `null`).
- Se `status === 'pago'` → usa `forma_pagamento` do `lancamentos_financeiros` (todas as origens agora têm).

Filtros das abas não mudam de fórmula:
- Aba "Títulos a Pagar": `forma_pagamento !== 'cartao_credito'` (inclui NULL).
- Aba "Cartão": `forma_pagamento === 'cartao_credito'`.

Comportamentos resultantes (o que aparece na UI):

| Situação | Aba |
|---|---|
| PP/Desembolso pendente | "Títulos a Pagar", filtro "A pagar" (sem tag de forma) |
| PP/Desembolso pago em PIX/boleto/transferência | "Títulos a Pagar", filtro "Pagos" |
| PP/Desembolso pago no cartão | "Cartão", filtro "Pagos" (aparece o cartão real usado) |
| Avulsa/Recorrência pendente com forma cartão | "Cartão", filtro "A pagar" |
| Avulsa/Recorrência pendente outras formas | "Títulos a Pagar", filtro "A pagar" |
| Avulsa/Recorrência baixada | Aba conforme forma **realizada** (pode divergir do planejado se financeiro trocou) |

### 3.6. RPCs de baixa ganham 2 parâmetros

`dar_baixa_pp_parcela`, `dar_baixa_desembolso_parcela`, `dar_baixa_avulsa_com_plano` — todas ganham:
- `p_forma_pagamento forma_pagamento not null`
- `p_cartao_credito_id uuid null`

Validação interna: se forma = cartão, cartão obrigatório; senão, cartão deve ser null. Grava no INSERT de `lancamentos_financeiros`.

`estornar_baixa_*` — nenhuma mudança de assinatura. O lançamento reverso herda `forma_pagamento` e `cartao_credito_id` do original (que agora estão gravados).

### 3.7. RPC `dar_baixa_lote_cartao` perde branches PP/Desembolso

A baixa em lote de cartão só faz sentido pra origens que **já se sabe serem cartão pré-baixa** — avulsa e recorrência. PP/Desembolso pendentes não têm forma definida, então não podem entrar em lote de cartão.

Remove branches `if v_origem = 'pp'` e `elsif v_origem = 'desembolso'`. Mantém `avulso` e `recorrencia`.

Consequência UX: `TitulosCartaoList` filtra a base pra `origem in ('avulso','recorrencia')` — coerente com o backend.

### 3.8. Forms de criação de PP e Desembolso perdem forma de pagamento

Reversão da mudança feita em Tasks 7 e 8 de cartões (PP) e Task 6 de desembolsos:

- Drawer/form: `<FormaPagamentoField>` removido.
- Prop `cartoes` na cadeia de propagação: removida (`page.tsx` → `<JobRealizadoSection>` → ... → `<GerarPPDrawer>`; e `page.tsx` → `<DesembolsosList>` → `<DesembolsoDrawer>`).
- Zod schema: `forma_pagamento` e `cartao_credito_id` removidos + refinement de cartão removido.
- Auto-preenchimento de datas das parcelas via `parcelasParaFatura`: removido. Usuário digita cada data manualmente.
- Server actions (`actions-pp.ts` → `finalizarPedidoCompra`; `desembolsos/actions.ts` → `criarDesembolso`): payload do INSERT sem os 2 campos.

Forms de avulsa e recorrência: **mantidos como estão** (continuam pedindo forma na criação).

### 3.9. Auditoria: enriquecer metadata, sem chaves novas

Chaves existentes de baixa (`pedido_compra.parcela_paga`, `conta_avulsa.baixada`, `desembolso.parcela_paga`) ganham no metadata:
- `forma_pagamento: 'pix' | 'transferencia' | 'boleto' | 'cartao_credito'`
- `cartao_credito_id?: string`

Sem chaves novas — o evento é o mesmo, só ganha detalhe.

## 4. Modelo de dados

> **Nota sobre ordem**: as migrations abaixo são numeradas por ordem de execução na §9 (aditivas primeiro, destrutiva por último). §4.1 é a primeira migration aplicada; a destrutiva §4.4 é a última.

### 4.1. Migration 1 — adiciona colunas em `lancamentos_financeiros` (aditivo)

```sql
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
```

### 4.2. Migration 2 — comments em avulsa/recorrência

```sql
comment on column contas_avulsas.forma_pagamento is
  'Forma PLANEJADA na criação. A forma REALIZADA fica em lancamentos_financeiros; podem divergir.';

comment on column contas_avulsas_recorrentes.forma_pagamento is
  'Forma PLANEJADA no template. A forma REALIZADA da ocorrência fica em lancamentos_financeiros; podem divergir.';
```

### 4.3. Migration 3 — RPCs alteradas

`create or replace` em 4 funções: `dar_baixa_pp_parcela`, `dar_baixa_desembolso_parcela`, `dar_baixa_avulsa_com_plano`, `dar_baixa_lote_cartao`.

**Novas assinaturas** (2 novos parâmetros nas 3 primeiras):

```sql
create or replace function dar_baixa_pp_parcela(
  p_parcela_id             uuid,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por             uuid,
  p_forma_pagamento        forma_pagamento,        -- NOVO
  p_cartao_credito_id      uuid default null       -- NOVO
) returns uuid
-- ...
begin
  -- Validação coerência
  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só quando forma = cartão de crédito.';
  end if;

  -- ... resto do corpo, INSERT ganha forma_pagamento + cartao_credito_id
```

**`dar_baixa_lote_cartao`** — remove branches PP e Desembolso; passa forma+cartão implícitos pra cada baixa interna:

```sql
-- Cada baixa interna sabe que é cartão (a RPC só aceita avulso/recorrencia).
elsif v_origem in ('avulso','recorrencia') then
  v_lanc := dar_baixa_avulsa_com_plano(
    v_id, p_pago_em,
    p_conta_bancaria_id, p_plano_conta_tipo_id,
    p_plano_conta_subtipo_id,
    'cartao_credito',                        -- p_forma_pagamento
    p_cartao_credito_id                      -- vem do parâmetro global da RPC
  );
```

Assinatura de `dar_baixa_lote_cartao` ganha 1 parâmetro (`p_cartao_credito_id`), obrigatório — já que todo lote é de 1 cartão.

### 4.4. Migration 4 — remove colunas de PP e Desembolso (destrutivo)

Aplicada **por último** na sequência, depois que todo código consumidor já foi refatorado (passos 5-7 da §9). Se algo dá errado antes, dá pra reverter sem quebrar dados.

```sql
-- Racional: forma_pagamento não faz sentido em pedidos_compra e desembolsos.
-- Ambas são solicitações; quem cria não é quem paga. A forma é decidida
-- na baixa e gravada em lancamentos_financeiros. Ver spec seção 3.1.

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

### 4.5. Atualização de `lib/types.ts`

- `PedidoCompra` perde `forma_pagamento` e `cartao_credito_id`.
- `Desembolso` idem.
- `LancamentoFinanceiro` ganha os 2 campos (nullable).
- `TituloRow` mantém o shape atual (a coalescência acontece no map de `page.tsx`).

## 5. UI

### 5.1. Modal `baixa-titulo-dialog.tsx`

Ganha `<FormaPagamentoField>` como campo obrigatório. Estado inicial:
- Se `titulo.origem in ('avulso','recorrencia')` e origem tem forma definida: pré-preenche com esses valores. Editável.
- Senão: vazio, obrigatório.

Submit: envia `forma_pagamento` + `cartao_credito_id` no payload da `darBaixaTitulo`. Server action valida via Zod (mesmo `superRefine` que já existe pra criar avulsa) e passa pra RPC apropriada.

### 5.2. Forms de PP e Desembolso perdem o campo

- **`gerar-pp-drawer.tsx`**: remove seção "Pagamento" com `<FormaPagamentoField>`. Remove estado `formaPagamento`. Remove `handleFormaPagamentoChange`. Remove auto-preenchimento de datas de parcelas via `parcelasParaFatura` no `handleParcelasQuantidade`.
- **`desembolso-drawer.tsx`**: mesma coisa.
- **Chain de propagação de `cartoes` prop**: removida. Isso implica retirar prop de `<JobRealizadoSection>`, `<JobGrupoCard>`, `<JobItemRealizadoTable>` (para PP) e de `<DesembolsosList>` (para desembolso). `page.tsx` de `/jobs/[jobId]` e `/financeiro/desembolsos` param de fetchar cartões.
- **Zod schemas**: `finalizarPedidoCompraSchema` e `criarDesembolsoSchema` perdem `forma_pagamento` + `cartao_credito_id` + refinement.

### 5.3. `TitulosCartaoList` filtra origem no client

Aba "Cartão" continua funcionando, mas passa a filtrar pra baixa em lote apenas títulos avulsa/recorrência (checkbox de PP/desembolso desabilitado ou não renderizado — a decidir na implementação; sugestão: linha PP/desembolso aparece na lista pra visibilidade histórica mas sem checkbox).

**Refinamento**: como PP/Desembolso pendente nunca cai na aba Cartão (`forma_pagamento === null`), a única razão de aparecer lá é histórico (status = pago). Nesse caso, título já está pago — não precisa checkbox. Simples.

### 5.4. Aba "Títulos Pagos" (via filtro interno)

Título pago mostra tag da forma real: "Pago via PIX", "Pago com Nubank Antonio", etc. Info vem do `lancamento_financeiro` join. Nada de UI condicional nova — só uma coluna/badge nova exibindo `forma_pagamento` do lançamento.

## 6. Auditoria

Metadata enriquecida nos eventos existentes:
- `pedido_compra.parcela_paga`: `forma_pagamento`, `cartao_credito_id?`.
- `conta_avulsa.baixada`: idem.
- `desembolso.parcela_paga`: idem.
- `contas_pagar.baixa_lote_cartao`: já grava `cartao_credito_id`; adicionar `forma_pagamento: 'cartao_credito'` fixo (redundante mas explícito).

Sem chaves novas.

## 7. Riscos e mitigações

**Risco 1 — DROP COLUMN em `pedidos_compra` requer que nenhum consumidor esteja lendo essas colunas.**
Consumidores mapeados: `page.tsx` (select), `pedidos-compra-list.tsx` (type PPRow), `gerar-pp-drawer.tsx` (form), `actions-pp.ts` (INSERT + Zod), map de `TituloRow` em `page.tsx` de contas-a-pagar. Todos removidos na mesma feature. Mitigação: TypeScript detecta consumidores esquecidos na compilação.

**Risco 2 — Constraints check em `lancamentos_financeiros`.**
`chk_origem_tem_referencia` e `chk_origem_contraparte_tem_id` já são complexas. Adicionar novas constraints envolvendo `forma_pagamento` aumenta matriz. Mitigação: coerência (cartão exige cartão_id) valida em RPC, não em constraint.

**Risco 3 — Assinatura de RPCs mudando quebra qualquer chamador externo.**
Só as server actions chamam essas RPCs. Todas refatoradas na mesma feature. Mitigação: `create or replace function` com nova assinatura falha em compile-time do TypeScript se algum call site esquece de passar os novos parâmetros.

**Risco 4 — Migration destrutiva em produção requer confirmação explícita.**
User confirmou. Ainda assim, task da migration deve incluir SELECT prévio pra logar quantas linhas tinham valor preenchido — se o número for > 0 e não trivial, revisitar decisão antes de aplicar.

**Risco 5 — Backfill nas linhas existentes de `lancamentos_financeiros`.**
Não faz backfill — coluna nasce nullable, lançamentos antigos ficam NULL. Documentado no comment. Se algum dia precisar backfill retroativo (ex: pra DRE histórico), fica pra migration futura opcional.

**Risco 6 — Aba "Cartão" com PP/Desembolso pago pode confundir user.**
Depois da mudança, uma PP paga no cartão aparece em "Cartão" filtro "Pagos". Documentar visualmente ("Pago com Nubank Antonio" na coluna) resolve. Sem regressão de comportamento — apenas ganho de visibilidade.

## 8. Não-objetivos

1. **Backfill retroativo** de `lancamentos_financeiros.forma_pagamento` para lançamentos anteriores a 25/08/2026. Deixados NULL. Se aparecer necessidade contábil, migration futura.
2. **Constraint `chk_lanc_cartao`** em `lancamentos_financeiros`. Validação em RPC é suficiente.
3. **Aprovação de PP/Desembolso ganhando pré-seleção de forma**. Aprovação continua como está (data de pagamento apenas). Forma decidida na baixa.
4. **Reintroduzir `forma_pagamento` em PP/Desembolso como "sugerido"**. Rejeitado — mistura conceitos de planejamento sem modelo de suporte.
5. **Filtro/report por cartão específico com sumarização retroativa**. Habilitável agora que o dado existe, mas fora do escopo desta entrega.
6. **Reforma do modal de baixa em lote** (que já filtra por cartão). Continua funcional com a mesma UI.

## 9. Ordem de implementação

Sequência que minimiza risco:

1. **Migration 1** (aditiva): adiciona `forma_pagamento` + `cartao_credito_id` + índices em `lancamentos_financeiros`. Atualiza `lib/types.ts` (`LancamentoFinanceiro` ganha campos).
2. **Migration 2** (aditiva): comments em `contas_avulsas.forma_pagamento` e `contas_avulsas_recorrentes.forma_pagamento`.
3. **Migration 3** (RPCs alteradas): 4 funções — `dar_baixa_pp_parcela`, `dar_baixa_desembolso_parcela`, `dar_baixa_avulsa_com_plano`, `dar_baixa_lote_cartao`. Todas via `create or replace`.
4. **Modal de baixa** ganha `FormaPagamentoField` + Zod da server action. Chamada da RPC passa os 2 novos parâmetros.
5. **`page.tsx` de contas-a-pagar**: query `baixasRes` ganha 2 colunas; coalescência do `TituloRow.forma_pagamento` implementada.
6. **Remoção de `FormaPagamentoField` do form de PP** + Zod + auto-preenchimento de datas + chain de props `cartoes` (jobs).
7. **Remoção de `FormaPagamentoField` do form de Desembolso** + Zod + chain de props `cartoes`.
8. **Migration 4** (destrutiva): DROP COLUMN em `pedidos_compra` e `desembolsos`. Requer que todos os consumidores das colunas já tenham sido removidos (passos 5, 6, 7). Types atualizados.
9. **Verificação final E2E** — build + typecheck + lint + smoke via UI (criar PP sem forma; aprovar; baixar via modal; verificar aparição em "Cartão" filtro "Pagos" se baixado no cartão).

Estimativa: 9 tasks no plano, cada uma pequena. Migration destrutiva (passo 8) fica **por último** de propósito — se algo dá errado nos passos 5-7, dá pra reverter sem quebrar dados.
