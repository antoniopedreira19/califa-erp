# Subsistema 13º Salário — Spec viva

> **Status:** **IMPLEMENTADO** e em produção desde 2026-10-21.
>
> Entregue em uma sessão. Partes 1–6 + Fase A (integração com Folha de Pagamento) concluídas no mesmo dia. Ver [handoff](../../handoffs/2026-10-21-decimo-terceiro.md) pra retrato operacional.
>
> Este documento é a fonte-verdade do subsistema — toda decisão nova entra aqui, não em commit ou chat.

## 1. Contexto

Antes do ERP, a California controlava 13º numa planilha Excel (`Décimo terceiro 2026.xlsx`, 5 abas) regenerada todo ano. Era 100% manual: a Kika digitava o salário atual de cada colaborador, as fórmulas calculavam avos pela data de admissão, descontos de INSS/IRRF saíam de uma versão quebrada (`#REF!` no INSS, IRRF aplicado sobre a 2ª parcela em vez do 13º integral) e no fim do ano o cálculo saía da planilha pra uma folha enviada à mão ao financeiro, que criava avulsas uma por uma.

Problemas estruturais:

- **Zero histórico auditável.** A planilha do ano novo sobrescrevia o anterior.
- **Dados defasados.** Salário, admissão, regime — tudo redigitado, divergia do cadastro.
- **Cálculo errado.** INSS quebrado, IRRF sobre a 2ª parcela isolada em vez do 13º integral, nada de redução Lei 15.270 ou dedução simplificada.
- **O financeiro não via.** Lançamentos entravam à mão, sem rastreabilidade.

## 2. Objetivo

Controlar o ciclo completo do 13º no ERP, do cálculo inicial em janeiro (com os dados do cadastro) até o pagamento das duas parcelas pelo financeiro, com:

- Cálculo automático baseado no snapshot do cadastro (data admissão, salário vigente, alocação de empresa, tipo de contratação).
- Adiantamentos registrados durante o ano, com lançamento automático no financeiro e abate automático da 1ª parcela.
- Fechamento das duas parcelas (30/nov e 20/dez) com envio ao mesmo fluxo da folha mensal — financeiro aprova e vira título em Contas a Pagar.
- Breakdown pro híbrido CLT_recibo (parte CLT com descontos + parte PJ sem desconto).
- Histórico por ano e por colaborador.
- Edição manual linha a linha pra casos excepcionais (afastamento > 15 dias, retroativo de reajuste).

## 3. Vocabulário

| Termo | Significado |
|---|---|
| **Folha de 13º** | Uma por ano (ex.: 13º 2026). Contém o cabeçalho + N linhas (uma por colaborador elegível). |
| **Linha** | Snapshot do colaborador + cálculo. Uma por colaborador por folha. |
| **Avos** | Meses trabalhados no ano com direito a 13º. Regra do dia 15. |
| **1ª parcela** | 50% do 13º bruto, paga em 30/nov, sem descontos. |
| **2ª parcela** | 50% do 13º bruto, paga em 20/dez. **Todos os descontos saem desta parcela**. |
| **Snapshot** | Cópia dos dados do colaborador no momento da criação da folha. Imutável até rodar "Recalcular folha". |
| **Híbrido** | Colaborador `tipo_contratacao=clt_recibo` com `valor_recibo > 0`. Cálculo divide em parte CLT + parte PJ. |
| **Adiantamento** | Valor pago ao colaborador durante o ano por conta do 13º. Abate automaticamente da 1ª parcela. |
| **Adiantamento integral** | Variante do adiantamento que quita o 13º inteiro de uma vez. Marcado com `integral = true`. O colaborador **não participa** da folha do ano (sai da lista de linhas). Útil pra quem acerta o 13º cheio antes do fechamento. |
| **Adiantamento legado** | Lançamento pré-ERP, sem folha de pagamento vinculada (`folha_pagamento_id IS NULL` + 0 folhas via FK reversa). Aparece como "Pago" na lista, invisível pro financeiro, não cobra NF. Resultado de migrations de backfill que removem as folhas pra pagamentos feitos antes do sistema entrar em vigor. |

## 4. Elegibilidade

Entra na folha quem atende aos **três** critérios:

1. `tipo_contratacao` ∈ {`clt`, `clt_recibo`, `pj`, `mei`}. Estágio e sócio ficam de fora (não têm 13º por lei / recebem pró-labore).
2. `data_admissao <= {ano}-12-31` (contratado até o fim do ano).
3. **Não desligado dentro do ano**: `data_encerramento IS NULL` OR `data_encerramento > {ano}-12-31`. Desligados no ano têm 13º proporcional calculado pelo módulo de [Rescisões](/rh/rescisoes); duplicar aqui gera distorção no DRE.

Dataset atual (10/2026): **206 elegíveis** de 211 colaboradores (5 fora = 2 estagiários + 3 sócios).

## 5. Cálculo

### 5.1 Avos (regra do dia 15)

```
se dataAdmissao > ano-12-31: avos = 0
senao se dataAdmissao <= ano-01-01: avos = 12
senao se dia(dataAdmissao) <= 15: avos = 13 − mes(dataAdmissao)
senao: avos = 12 − mes(dataAdmissao)
```

Admitido depois de 15/dez entra na folha com avos=0, 1ª e 2ª zeradas, com obs automática "Admitido após 15/12 — sem direito a avos".

### 5.2 Base + parcelas

```
13º bruto integral = salário / 12 × avos
1ª parcela         = 13º bruto / 2 − total adiantado
2ª parcela bruta   = 13º bruto / 2
```

A 1ª parcela nunca fica negativa (`Math.max(0, ...)`); se o adiantamento for maior que metade do bruto, a 1ª vira 0 e sobra abate pra segunda (não implementado — raro).

### 5.3 INSS e IRRF (10/2026)

Só CLT (`clt`, `clt_recibo` sem híbrido, parte CLT do híbrido). PJ, MEI e parte PJ do híbrido não sofrem desconto. Aplicados sobre o **13º bruto integral**, retidos na 2ª parcela.

**INSS** (Portaria MPS/MF nº 13/2026):

| Até R$ | Alíquota | Dedução (R$) |
|---|---|---|
| 1.621,00 | 7,5% | 0 |
| 2.902,84 | 9% | 24,32 |
| 4.354,27 | 12% | 111,40 |
| 8.475,55 | 14% | 198,49 |

Teto da contribuição: R$ 988,09 (= 8475,55 × 14% − 198,49).

**IRRF** (Lei 15.191/2025 + Lei 15.270/2025):

1. **Dedução IR** = MAX(`INSS + dependentes × 189,59`, `desconto simplificado 607,20`). Dependentes = 0 por default (não há campo no cadastro ainda).
2. **Base de cálculo IR** = MAX(0, 13º bruto − dedução IR).
3. **IR pela tabela**:

| Base até R$ | Alíquota | Dedução (R$) |
|---|---|---|
| 2.428,80 | 0% | 0 |
| 2.826,65 | 7,5% | 182,16 |
| 3.751,05 | 15% | 394,16 |
| 4.664,68 | 22,5% | 675,49 |
| ∞ | 27,5% | 908,73 |

4. **Redução Lei 15.270/2025**:
   - Se 13º bruto ≤ R$ 5.000: redução = R$ 312,89 (isenção efetiva).
   - Se R$ 5.000 < 13º bruto ≤ R$ 7.350: redução = `MAX(0, 978,62 − 0,133145 × bruto)`.
   - Se 13º bruto > R$ 7.350: sem redução.

5. **IRRF final** = MAX(0, IR tabela − redução).

### 5.4 Total líquido

```
2ª parcela líquida = 2ª parcela bruta − INSS − IRRF
Total líquido      = 1ª parcela + 2ª parcela líquida
```

### 5.5 Híbrido CLT_recibo

Colaborador `tipo_contratacao=clt_recibo` com `valor_recibo > 0 E < salário` tem o 13º dividido:

- **Parte CLT**: base = `salário − valor_recibo`, com INSS/IRRF (parte CLT paga desconto).
- **Parte PJ**: base = `valor_recibo`, sem desconto.
- **Adiantamento**: rateado proporcional ao salário de cada parte.
- **Snapshot**: `snapshot_valor_recibo` guarda o `valor_recibo` do momento da criação — breakdown não muda sozinho depois.

## 6. Modelo de dados

### `decimo_terceiro_folhas`

Uma linha por `(tenant, ano)`. Unique.

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | FK tenants |
| `ano` | smallint | 2020–2100 |
| `status` | enum | `rascunho` → `fechada_parcial_1` → `fechada_parcial_2` → `concluida` |
| `criada_em`, `criada_por` | timestamptz, uuid | Audit |
| `recalculada_em`, `recalculada_por` | timestamptz, uuid | NULL até o 1º recálculo |

### `decimo_terceiro_linhas`

Uma linha por `(folha, colaborador)`. Unique.

**Identificação:**
- `folha_id`, `colaborador_id`, `tenant_id`

**Snapshot (gravado na criação, imutável até Recalcular):**
- `snapshot_nome`, `snapshot_cpf`, `snapshot_tipo_contratacao`, `snapshot_funcao`
- `snapshot_data_admissao`, `snapshot_salario`
- `snapshot_valor_recibo` — NULL quando não híbrido
- `snapshot_empresa_id` — alocação vigente de maior %

**Calculados (totais):**
- `avos` (0–12), `total_adiantado`
- `primeira_parcela`, `segunda_parcela`
- `desconto_inss`, `desconto_irrf`
- `total_bruto`, `total_liquido`

**Breakdown do híbrido (NULL quando não híbrido):**
- `parte_clt_primeira_parcela`, `parte_clt_segunda_parcela`
- `parte_clt_desconto_inss`, `parte_clt_desconto_irrf`, `parte_clt_total_liquido`
- `parte_pj_primeira_parcela`, `parte_pj_segunda_parcela`, `parte_pj_total_liquido`

**Override manual:**
- `editado_manualmente` boolean
- `salario_editado`, `avos_editado` — sobrescrevem o snapshot/calculado
- `obs` text

**Sinalização:**
- `teve_reajuste_no_ano` boolean — TRUE quando colaborador tem **mudança** salarial (linha no ano + linha anterior). Não dispara em admitidos no ano ou ajustes administrativos.

### `decimo_terceiro_adiantamentos`

Uma linha por adiantamento. Vínculo pelo **ano** (não pela folha — adiantamento pode acontecer antes da folha existir).

| Coluna | Tipo | Observação |
|---|---|---|
| `id`, `tenant_id` | uuid | — |
| `ano` | smallint | — |
| `colaborador_id` | uuid | FK |
| `data` | date | Data do pagamento |
| `valor` | numeric | > 0 |
| `obs` | text | NULL |
| `integral` | boolean | **default false**. `true` = adiantamento quita o 13º inteiro; colaborador sai da folha do ano. Ou colaborador tem **um** integral OU tem N parciais — nunca mistura. |
| `folha_pagamento_id` | uuid | FK `folhas_pagamento` (SET NULL). Aponta pra **primeira** folha gerada (parte CLT no híbrido, folha única nos demais). Pros legados fica NULL. |
| `conta_avulsa_id` | uuid | FK `contas_avulsas` (SET NULL) — campo legado, não é mais preenchido pelos novos lançamentos (foi substituído pelo fluxo via `folhas_pagamento`). |

### Integração com `folhas_pagamento`

Enum `folha_tipo` cobre três variantes do 13º: `decimo_terceiro_1a_parcela`, `decimo_terceiro_2a_parcela` e `decimo_terceiro_adiantamento`.

**Parcelas 1ª/2ª** (fechamento pelo RH):

Quando o RH clica "Fechar 1ª parcela", **uma linha em `folhas_pagamento` por colaborador** é criada com:
- `tipo` = `decimo_terceiro_1a_parcela` (ou `_2a_parcela`)
- `status` = `enviada` (já vai pro financeiro aprovar)
- `competencia_ano` = ano da folha, `competencia_mes` = 11 (1ª) ou 12 (2ª)
- `salario_base` = valor efetivo pago na parcela (líquido na 2ª)
- `decimo_terceiro_linha_id` = FK pra linha de origem
- `data_pagamento_prevista` = `{ano}-11-30` ou `{ano}-12-20`

Pro **híbrido** (`clt_recibo`), cada parcela gera **duas folhas** separadas via `montarFolhasParcela`:
- Parte CLT → origem `contabilidade`, sem desconto na UI do financeiro (desconto sai no líquido da 2ª).
- Parte PJ → origem `california`, exige NF do colaborador antes da aprovação.

**Adiantamentos** (lançamento ao longo do ano):

Quando o RH lança um adiantamento (`lancarAdiantamentoDecimoTerceiro`), `montarFolhasAdiantamento` monta:
- PJ/MEI → 1 folha origem `california`, valor cheio.
- CLT puro → 1 folha origem `contabilidade`, valor cheio.
- **Híbrido (`clt_recibo`) → 2 folhas** proporcionais ao salário:
  - `parte_clt = round2(valor × (salario − valor_recibo) / salario)` → origem `contabilidade`.
  - `parte_pj  = valor − parte_clt` (PJ absorve o resíduo de centavo) → origem `california`.
  - Se `valor_recibo = 0`, cai pra 1 folha CLT só.

Todas as folhas são inseridas com `status = enviada`, `tipo = decimo_terceiro_adiantamento`, `competencia_ano = ano`, `competencia_mes = 12`, `decimo_terceiro_adiantamento_id = <id>` (FK reversa). O `folha_pagamento_id` do adiantamento aponta pra **primeira** (CLT quando existe). A UI combina as 2 folhas via FK reversa (`folhas_pagamento.decimo_terceiro_adiantamento_id`) quando precisa mostrar as partes individualmente.

**NF por parte do híbrido**: `actions-folhas.ts:exigeNf` já separa — só folha `origem = california` de `pj/mei/clt_recibo` exige NF antes de aprovar. Resultado prático pro adiantamento híbrido:
- Parte CLT (contabilidade) → **financeiro aprova direto**, sem NF.
- Parte PJ (california) → **aguarda NF** do colaborador no `/perfil`; só aprova depois.

A view `vw_nf_pendentes_colaborador` já filtra `origem = california`, então o colaborador vê **uma única NF pendente** com o valor da parte PJ (não o total do adiantamento).

A tab `/financeiro/contas-a-pagar?tab=folhas` mostra todas essas linhas junto com as mensais. Pro híbrido com split, aparecem **2 linhas** (parte CLT + parte PJ, rotulada "(parte PJ)"). A aprovação chama `criar_conta_avulsa` com plano `Despesa com Pessoal → 13° Salário` (código 004).

**Exclusão de adiantamento** (`excluirAdiantamentoDecimoTerceiro`):
- Busca TODAS as folhas vinculadas via FK reversa.
- Bloqueia se qualquer folha está `aprovada` ou `paga`.
- Bloqueia se tem NF anexada.
- Senão deleta todas as folhas (em `IN (ids)`) e depois o adiantamento.

**Recalc do abatimento** (`recalcularLinhaDeAdiantamento`):
- Se colaborador tem **qualquer** adiantamento `integral = true` no ano → deleta a linha do 13º dele (sai da folha).
- Senão soma o `total_adiantado` e recalcula primeira_parcela/segundas.

**Backfill de legados**: pagamentos de 13º feitos antes do ERP são marcados como "Pago" via migrations que deletam as folhas vinculadas (`folha_pagamento_id` vira NULL por `ON DELETE SET NULL`). O adiantamento fica no banco (histórico preservado) mas some do contas-a-pagar e do fluxo de NF.

## 7. Fluxo end-to-end

```
┌─────────────────────────────────────────────────────────┐
│ RH em /rh/decimo-terceiro                               │
│                                                         │
│   Criar folha de 2026  →  rascunho                      │
│   (puxa 206 elegíveis do cadastro, grava snapshot,      │
│    calcula avos/parcelas/descontos)                     │
│                                                         │
│   Durante o ano:                                        │
│     Adiantamentos (1ª parcela OU integral)              │
│     ↓ cria N folhas_pagamento (1 ou 2 pro híbrido)      │
│     ↓ status=enviada, tipo=decimo_terceiro_adiantamento │
│     ↓ se integral: deleta linha do colaborador na folha │
│     ↓ se parcial: soma total_adiantado e recalcula 1ª   │
│                                                         │
│   Nov/dez:                                              │
│     Recalcular folha  →  rebusca salário + valor_recibo │
│                           popula híbrido                │
│                           remove desligados             │
│     Fechar 1ª parcela →  cria 206 linhas em             │
│                           folhas_pagamento              │
│                           status=enviada tipo=13º_1a    │
│                           folha → fechada_parcial_1     │
│                                                         │
└──────────┬──────────────────────────────────────────────┘
           │
           ↓
┌─────────────────────────────────────────────────────────┐
│ Financeiro em /financeiro/contas-a-pagar?tab=folhas    │
│                                                         │
│   206 linhas tipo=decimo_terceiro_1a_parcela aparecem   │
│   Aprovar cada linha → cria conta_avulsa                │
│                        (Despesa com Pessoal · 13° Sal)  │
│                        PJ exige NF anexada              │
│                        status folha_pagamento → aprovada│
│                                                         │
│   As avulsas viram título em Títulos a Pagar            │
└──────────┬──────────────────────────────────────────────┘
           │
           ↓ (volta pra RH)
┌─────────────────────────────────────────────────────────┐
│ RH volta em /rh/decimo-terceiro/{ano}                   │
│                                                         │
│   Fechar 2ª parcela → mesma coisa, tipo=13º_2a          │
│                        salario_base = líquido           │
│                        folha → fechada_parcial_2        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 8. UI

### `/rh/decimo-terceiro`

Listagem de folhas por ano em cards. Cada card: ano, status (badge), nº de colaboradores, totais (1ª parc, 2ª parc, líquido), criada em/por. Botão "Criar folha de 13º" no PageHeader abre dialog pedindo o ano.

### `/rh/decimo-terceiro/[ano]`

Página de detalhe. Elementos:

- **PageHeader** com título "13º {ano}", descrição dependente do status, botões:
  - **Adiantamentos** (link pra sub-rota)
  - **Exportar planilha** (XLSX replicando a planilha original — abas CLT e PJ)
  - **Recalcular folha** (só em rascunho; client component com spinner)
  - **Fechar 1ª parcela** (só em rascunho) → **Fechar 2ª parcela** (só em fechada_parcial_1)
- **4 KPI cards**: nº colaboradores, total 1ª, total 2ª, total líquido.
- **Filtros**: searchbar por nome (ignora acento), filtro por empresa, filtro por tipo. Botão "Limpar filtros" quando ativo.
- **Tabela** com ordenação clicável em Colaborador, Admissão e Salário.
  - **Nome encurtado** (primeiro + último) pra legibilidade; `snapshot_nome` no banco segue com nome cheio.
  - **Linha expansível** pros híbridos: chevron abre duas filhas (Parte CLT, Parte PJ).
  - **Badge "reajuste"** amarelo em quem teve mudança salarial real no ano (não dispara em admitidos / ajustes administrativos).
  - **Edição linha a linha** — click na linha abre dialog com salário editado + avos editado + obs. Desabilita quando a folha não está mais em `rascunho`.
  - **Colunas**: Colaborador | Empresa | Tipo | Admissão | Salário | Avos | 1ª parc | INSS | IRRF | **2ª parc líq** | Total líquido. A ordem reflete a planilha-referência: INSS/IRRF saem da 2ª parcela, por isso a coluna "2ª parc líq" (bruta − descontos) fica ao lado.

### `/rh/decimo-terceiro/[ano]/adiantamentos`

Sub-rota com listagem dos adiantamentos do ano + KPIs (total adiantado, nº lançamentos).

**Lista**
- **Searchbar** (nome, função ou observação) + **filtro por status** (Todos, Pago, Pago — integral, Aguardando NF, Aguardando aprovação, Aprovado — a pagar).
- **Ordenação clicável** no cabeçalho de Data e Valor (ArrowUpDown/Up/Down).
- **Colunas**: Data | Colaborador | Tipo (CLT/Híbrido/PJ/MEI, badge colorido) | Valor | Observação | Status | ações.
- **Linha expansível** pra híbrido com split (chevron no início). Expandir mostra 2 linhas filhas:
  - **Parte CLT (sem desconto)** → origem Contabilidade, valor proporcional, status próprio (não pede NF).
  - **Parte PJ (recibo)** → origem California, valor proporcional, status próprio (pede NF).
- Pros híbridos **legados** (sem folhas vinculadas), o split é calculado em runtime pelo salário vigente — chevron aparece mesmo sem folhas.

**Status derivado** (`derivarStatusAdiantamento`):

| Condição | Label | Variante |
|---|---|---|
| sem folha vinculada + `integral=false` | "Pago" | cinza |
| sem folha vinculada + `integral=true` | "Pago — integral" | cinza com ring |
| folha `paga` | "Pago" | cinza |
| folha `aprovada` | "Aprovado — a pagar" | verde |
| folha `enviada` + sem NF + tipo PJ/MEI/clt_recibo | "Aguardando NF" | amber |
| folha `enviada` + NF anexada (ou CLT puro) | "Aguardando aprovação" | azul |

Pro híbrido com 2 folhas, a label principal usa o status **pior** (enviada < pendente_correcao < aprovada < paga) — reflete o estado que ainda precisa de ação. Na linha expandida cada parte mostra seu status próprio (CLT puro nunca aparece como "Aguardando NF").

**Dialog "Novo adiantamento"**

Fluxo: escolhe o colaborador → sistema busca o 13º bruto esperado (`calcularTreizeBrutoEsperado`) → mostra dois **radios** lado a lado com os valores calculados:

- **Primeira parcela do 13º** = `round2(bruto / 2)`. Vira adiantamento parcial (`integral = false`). Abate da 1ª parcela na folha quando for calculada.
- **Valor integral do 13º** = `bruto` cheio. Vira adiantamento integral (`integral = true`). Colaborador sai da folha do ano.

Campos: colaborador (select), data (date), observação (textarea opcional). **Não** tem campo de valor livre — o cálculo é sempre automático pelos radios.

Validações cruzadas no `lancarAdiantamentoDecimoTerceiro`:
- Bloqueia novo lançamento se já existe integral no ano pro colaborador.
- Bloqueia lançar integral se já existem parciais.

Ao salvar: cria `decimo_terceiro_adiantamentos` + 1 ou 2 folhas de pagamento em bulk (ver "Integração com `folhas_pagamento`"). Não cria `contas_avulsas` diretamente — a avulsa é gerada pelo financeiro quando aprova a folha.

### `/rh/colaboradores/[id]` — card 13º

Card "13º Salário" lista os anos em que o colaborador recebeu. Cada linha: ano, status da folha, avos, total adiantado, total líquido. Clicável — navega pra folha do ano.

## 9. Casos especiais

| Caso | Tratamento |
|---|---|
| Admitido após 15/12 | Entra na folha com avos=0, zeros, obs automática. |
| Admitido no ano | Entra normal, avos pela regra do dia 15. Badge "reajuste" **não** dispara. |
| Reajuste salarial no ano | Badge "reajuste" amarelo. Retroativo é override manual (RH ajusta `salario_editado` pro salário médio ponderado e escreve na obs). Cálculo automático de retroativo (igual às abas "Retroativo - Reajuste" da planilha original) fica pra pass futura. |
| Desligamento no ano | Sai da folha (filtro). 13º proporcional pago na Rescisão. Se o desligamento aconteceu depois da folha criada, "Recalcular folha" deleta a linha. |
| Afastamento > 15 dias | Sem tabela de afastamentos no sistema; RH edita `avos_editado` manualmente + escreve obs. |
| Híbrido CLT_recibo | Breakdown automático quando `valor_recibo` está preenchido. Chevron de expand mostra parte CLT + parte PJ. Adiantamentos novos geram 2 folhas separadas (CLT em contabilidade, PJ em california); parte CLT aprovável direto, parte PJ aguarda NF. |
| Adiantamento integral | Checkbox "Valor integral" no dialog. Lança 1 adiantamento com `integral = true`, valor = 13º bruto cheio. Colaborador é **removido da folha** do ano automaticamente (ou na criação, via filtro em `criarFolhaDecimoTerceiro`, ou depois via `recalcularLinhaDeAdiantamento`). Uma vez integral, não aceita mais lançamentos no ano (nem parcial nem integral). |
| Adiantamento legado | Lançamento pré-ERP. Representado por `folha_pagamento_id IS NULL` + 0 folhas via FK reversa. Aparece "Pago" na lista, invisível pro financeiro, não cobra NF. Resultado da migration de backfill que deleta a folha vinculada — o adiantamento fica no banco por histórico mas some do fluxo ativo. |
| Folha de ano com N dependentes IR | Dependentes assumidos como 0 (não há campo no cadastro). RH ajusta via `salario_editado` se precisar — próxima pass pode adicionar coluna `dependentes_ir` no colaborador. |

## 10. Permissões

| Recurso | Roles |
|---|---|
| `rh.decimo_terceiro.ver` | administrador, rh |
| `rh.decimo_terceiro.editar` | administrador, rh |

Financeiro NÃO vê a página de 13º diretamente — vê apenas as linhas em `/financeiro/contas-a-pagar?tab=folhas` após o fechamento das parcelas (fluxo igual à folha mensal).

## 11. Audit

Toda ação do módulo registra em `audit_events`:

- `decimo_terceiro.folha.criada`
- `decimo_terceiro.folha.recalculada`
- `decimo_terceiro.folha.exportada`
- `decimo_terceiro.linha.editada`
- `decimo_terceiro.parcela_1a.fechada`
- `decimo_terceiro.parcela_2a.fechada`
- `decimo_terceiro.adiantamento.lancado`
- `decimo_terceiro.adiantamento.excluido`

## 12. Decisões arquiteturais

Ver ADRs:

- [220 — Integração do 13º com Folha de Pagamento](../../decisions/220-decimo-terceiro-integracao-folha-pagamento.md): por que criar tabelas separadas (`decimo_terceiro_*`) e integrar via FK em `folhas_pagamento` em vez de reusar a tabela existente ou criar `contas_avulsas` direto.
- [221 — Breakdown do híbrido CLT_recibo](../../decisions/221-decimo-terceiro-breakdown-hibrido.md): por que persistir `parte_clt_*` e `parte_pj_*` no banco em vez de calcular na UI.
- [222 — Tabelas INSS/IRRF 10/2026 e Lei 15.270](../../decisions/222-decimo-terceiro-tabelas-10-2026.md): hard-coded na lib `calc.ts`, substituição anual.

## 13. Migrations

```
20261021000001_decimo_terceiro_fundacao.sql
20261021000002_folha_tipo_decimo_terceiro.sql
20261021000003_decimo_terceiro_folha_status_fechamento.sql
20261021000004_decimo_terceiro_hibrido_e_folha_fk.sql
20261021000005_decimo_terceiro_adiantamentos.sql
20261021000006_decimo_terceiro_flag_reajuste.sql
20261028110001_13_nf_fundacao_schema.sql
20261028110002_13_nf_atualizar_views.sql
20261116900003_adiantamentos_13_2026_legado.sql          -- backfill legado lote 1 (17 rows)
20261117400001_adiantamento_13_2026_restante_legado.sql  -- backfill legado lote 2 (1 row)
20261117500001_adiantamento_13_integral.sql              -- coluna `integral` em adiantamentos
20261117500002_backfill_adiantamentos_13_integrais_e_correcoes.sql
                                                          -- 4 integrais + 2 correcoes de valor
20261117500003_re_delete_linhas_integrais_recriadas_pelo_recalc.sql
                                                          -- fix: recalcularFolha respeita integral
20261117500004_adiantamentos_13_2026_legado_lote_3.sql   -- 3 adiantamentos novos virados legado
20261117500005_adiantamentos_13_2026_legado_lote_4.sql   -- 2 adiantamentos novos virados legado
20261117500006_adiantamento_13_2026_legado_lote_5.sql    -- 1 adiantamento híbrido virado legado
```

## 14. Fora de escopo (próximas iterações)

- Cálculo automático de retroativo igual às abas "Retroativo - Reajuste" da planilha original (hoje é override manual).
- Campo `dependentes_ir` no cadastro de colaboradores (hoje assume 0).
- Tabela de afastamentos (hoje override manual).
- Suporte a `dependentes_ir` por colaborador no cálculo IRRF.
- Automação do status `concluida` baseado no estado das `folhas_pagamento` originadas (hoje a folha fica em `fechada_parcial_2` até intervenção manual).
- Edição retroativa do split híbrido: hoje o `salario_base` das 2 folhas é fixado no momento do lançamento. Se o `valor_recibo` do colaborador muda depois, o split não acompanha — teria que excluir e recriar o adiantamento.

## 15. Histórico recente (2026-11-17)

Sessão longa cobrindo refinamento do fluxo de adiantamento. Commits em `main` nessa ordem:

| Commit | O que entregou |
|---|---|
| `1224e227` | Coluna `integral` em `decimo_terceiro_adiantamentos` + tipo TS |
| `dabb5895` | `criarFolhaDecimoTerceiro` exclui integrais; `recalcularLinhaDeAdiantamento` deleta linha quando integral chega depois |
| `6c56a284` | Action `calcularTreizeBrutoEsperado` pro autofill do dialog |
| `dc9a08ff` | Checkbox "Pagamento integral" + autofill readonly + validações cruzadas (depois substituído pelos radios) |
| `3d441884` | Lista sem coluna "Lançado", "Antigo" → "Pago", novo badge "Pago — integral" |
| `324201e2` | Backfill 2026: 4 integrais marcados + correção de valores |
| `6bac8e7a` | `recalcularFolhaDecimoTerceiro` respeita adiantamento integral em 2 frentes (update e inclusão de faltantes) |
| `228dff88` | Lista ganha searchbar + filtro de status + ordenação por data/valor |
| `bb28cb9b` | Parser de valor BR robusto (aceita ponto como milhar) |
| `f7b46e0c` | Coluna "Tipo" na lista de adiantamentos com badge por contratação |
| `4cc867d4` | Dialog de novo adiantamento usa radio "1ª parcela" ou "Integral" (substitui o checkbox) |
| `bd6cc792` | Entrega 1 do split híbrido: 2 folhas separadas + linha expansível + status combinado |
| `369451c8` | Expande híbrido legado também, calculando split do salário vigente em runtime |
| `dc4cd31a` | Entrega 2: NF da parte PJ exigida no people-list, CLT aprovável direto, status individual por parte |

Mais 5 migrations de backfill de legado (`20261117500004–6` + duas anteriores de outubro/novembro).
