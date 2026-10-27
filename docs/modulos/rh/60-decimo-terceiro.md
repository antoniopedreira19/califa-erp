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
| `conta_avulsa_id` | uuid | FK `contas_avulsas` (SET NULL) — lançamento gerado automático via service client |

### Integração com `folhas_pagamento`

Enum `folha_tipo` ganhou `decimo_terceiro_1a_parcela` e `decimo_terceiro_2a_parcela`. Quando o RH clica "Fechar 1ª parcela", **uma linha em `folhas_pagamento` por colaborador** é criada com:
- `tipo` = `decimo_terceiro_1a_parcela` (ou `_2a_parcela`)
- `status` = `enviada` (já vai pro financeiro aprovar)
- `competencia_ano` = ano da folha, `competencia_mes` = 11 (1ª) ou 12 (2ª)
- `salario_base` = valor efetivo pago na parcela (líquido na 2ª)
- `decimo_terceiro_linha_id` = FK pra linha de origem
- `data_pagamento_prevista` = `{ano}-11-30` ou `{ano}-12-20`

A tab `/financeiro/contas-a-pagar?tab=folhas` passa a mostrar essas linhas junto com as mensais. Financeiro aprova via o mesmo fluxo existente — a aprovação chama `criar_conta_avulsa` com plano `Despesa com Pessoal → 13° Salário` (código 004), não "Serviços de Terceiros". A trava de NF (PJ/MEI/CLT_recibo precisa anexar NF da competência) já cobre o 13º sem código novo.

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
│     Adiantamentos (ex.: R$ 500 em março)                │
│     ↓ cria conta_avulsa aprovada automática             │
│     ↓ atualiza total_adiantado da linha                 │
│     ↓ recalcula 1ª parcela da linha                     │
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

Sub-rota com listagem dos adiantamentos do ano + KPIs (total adiantado, nº lançamentos). Dialog "Novo adiantamento" pede colaborador, data, valor, obs. Salvar cria `decimo_terceiro_adiantamentos` + `contas_avulsas` via service client (RH não aprova avulsa diretamente, mas 13º é responsabilidade do RH).

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
| Híbrido CLT_recibo | Breakdown automático quando `valor_recibo` está preenchido. Chevron de expand mostra parte CLT + parte PJ. |
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
```

## 14. Fora de escopo (próximas iterações)

- Cálculo automático de retroativo igual às abas "Retroativo - Reajuste" da planilha original (hoje é override manual).
- Campo `dependentes_ir` no cadastro de colaboradores (hoje assume 0).
- Tabela de afastamentos (hoje override manual).
- Suporte a `dependentes_ir` por colaborador no cálculo IRRF.
- Automação do status `concluida` baseado no estado das `folhas_pagamento` originadas (hoje a folha fica em `fechada_parcial_2` até intervenção manual).
