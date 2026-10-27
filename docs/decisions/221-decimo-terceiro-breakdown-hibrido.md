# 220 — 13º Salário: breakdown do híbrido CLT_recibo persistido no banco

**Data:** 2026-10-21
**Status:** aceita; implementado na migration `20261021000004`.
**Quem decidiu:** Daniel + Antonio em sessão de implementação.
**Contexto:** continua [`docs/modulos/rh/60-decimo-terceiro.md`](../modulos/rh/60-decimo-terceiro.md), §5.5.

Esta decisão congela como o 13º dos 9 colaboradores híbridos (`tipo_contratacao=clt_recibo`) é calculado, armazenado e apresentado — divisão em parte CLT (com descontos) e parte PJ (sem desconto), persistida como snapshot imutável.

---

## O problema

Dos 206 elegíveis a 13º da California, 9 são híbridos: recebem parte do salário como CLT (vai pra folha mensal da contabilidade com encargos) e parte como PJ (emitem NF por fora, sem desconto). O cadastro guarda isso em `colaboradores_salarios`:

- `valor` = salário total mensal (ex.: R$ 10.000)
- `valor_recibo` = parte PJ (ex.: R$ 4.000)
- CLT puro = `valor − valor_recibo` (ex.: R$ 6.000)

No 13º, o cálculo precisa refletir essa divisão: parte CLT paga INSS/IRRF sobre 6k × avos/12, parte PJ paga só o valor cheio sem desconto. O user pediu também que a UI mostre expansível com as duas partes separadas.

### Opções consideradas

| Opção | O que seria |
|---|---|
| **A — Calcular só o total, sem breakdown** | A lib `calc.ts` trata híbrido como CLT puro (desconto sobre o total). RH ajusta na mão se precisar. |
| **B — Calcular breakdown na UI, não persistir** | A lib retorna só os totais; na página, pra híbridos, consulta `colaboradores_salarios.valor_recibo` e recalcula as duas partes na hora. |
| **C — Persistir breakdown + snapshot do `valor_recibo`** (decidida) | A lib calcula as duas partes; o resultado + o `valor_recibo` usado ficam gravados em colunas específicas (`snapshot_valor_recibo`, `parte_clt_*`, `parte_pj_*`). |

---

## O que fica decidido

### 1. Breakdown automático quando houver `valor_recibo > 0`

A lib `calcularLinhaDecimoTerceiro` (em `lib/decimo-terceiro/calc.ts`) agora recebe parâmetro opcional `valorRecibo`. A condição pra híbrido é:

```ts
const ehHibrido =
  input.tipoContratacao === "clt_recibo"
    && valorRecibo > 0
    && valorRecibo < salario;
```

Quando é híbrido, a função chama internamente `calcularParte` duas vezes (uma com `comDescontos=true` pra parte CLT, outra `false` pra PJ) e devolve `parteClt` e `partePj` preenchidos no retorno. Os totais no retorno (`primeiraParcela`, `segundaParcela`, `totalBruto`, `totalLiquido`) são a soma das duas partes.

### 2. Adiantamento rateado proporcional ao salário

Se o colaborador recebeu adiantamento (ex.: R$ 1.000) e é híbrido com 60% CLT + 40% PJ:

- Parte CLT: adiantamento = R$ 600 → abate da 1ª parc CLT
- Parte PJ: adiantamento = R$ 400 → abate da 1ª parc PJ

Isso mantém a proporção CLT/PJ também no fluxo de caixa do colaborador.

### 3. Persistência do breakdown + snapshot do `valor_recibo`

Em `decimo_terceiro_linhas`, colunas novas (nullable, só preenchidas pra híbrido):

- `snapshot_valor_recibo` — cópia do `valor_recibo` do colaborador no momento da criação/recálculo.
- `parte_clt_primeira_parcela`, `parte_clt_segunda_parcela`
- `parte_clt_desconto_inss`, `parte_clt_desconto_irrf`, `parte_clt_total_liquido`
- `parte_pj_primeira_parcela`, `parte_pj_segunda_parcela`, `parte_pj_total_liquido`

Pros não híbridos (CLT puro, PJ puro, MEI), ficam todas NULL — a UI detecta `parte_clt != null && parte_pj != null` pra mostrar o chevron de expand.

### 4. Snapshot imutável

Mesma regra do `snapshot_salario`: `snapshot_valor_recibo` só é rebuscado em "Recalcular folha" (função `recalcularFolhaDecimoTerceiro`). Editar `colaboradores_salarios.valor_recibo` depois de a folha estar criada não altera as linhas automaticamente.

### 5. Edição manual desliga o breakdown

Se o RH clicar em "Ajustar salário" e lançar um valor manual via `salario_editado`, o cálculo passa a tratar como CLT puro (parte_clt e parte_pj ficam NULL). Lógica em `editarLinhaDecimoTerceiro`:

```ts
const valorReciboEfetivo =
  parsed.data.salario_editado != null
    ? null                              // edit manual desliga breakdown
    : linha.snapshot_valor_recibo;      // mantém snapshot pra híbrido
```

Isso é consistente com a semântica: "o RH assumiu o controle manual, então a divisão proporcional CLT/PJ deixa de valer — vira um valor único".

### 6. UI: linha expansível na tabela

Em `tabela-linhas.tsx`, cada linha híbrida ganha:

- Chevron (`›`) à esquerda. Click abre duas linhas filhas:
  - **Parte CLT** — mostra salário CLT (= snapshot_salario − snapshot_valor_recibo), 1ª parc, INSS, IRRF, 2ª parc líq, líquido.
  - **Parte PJ (recibo)** — mostra `snapshot_valor_recibo`, 1ª parc, INSS/IRRF = "—", 2ª parc, líquido.
- Dialog de edição: alerta reajuste + info "este colaborador é híbrido" via o breakdown.

---

## Por que não A (sem breakdown)

- Pra híbrido, aplicar INSS/IRRF sobre o 13º total (12k) em vez de só a parte CLT (6k) **cobra encargos sobre a parte PJ**, que legalmente não paga. É cálculo errado.
- Caroline (sem híbrido, R$ 3k): INSS R$ 178; se fosse híbrido R$ 3k = 1,5k CLT + 1,5k PJ, INSS correto seria sobre 1,5k × 12/12 = R$ 112,50 na parte CLT, não R$ 178.
- O impacto financeiro pro colaborador é relevante — pode significar centenas de reais a menos no bolso.

## Por que não B (calcular na UI, não persistir)

- Snapshot deixa de ser imutável: se `valor_recibo` do colaborador mudar entre a criação da folha e a visualização, o breakdown mostrado hoje muda retroativamente — a UI não bate com o `salario_base` que foi criado em `folhas_pagamento` no fechamento da parcela.
- Toda renderização da tabela precisaria rebuscar `valor_recibo` dos 9 híbridos. Isso é 1 query extra por page load.
- Exportação XLSX teria que fazer a mesma coisa, com código paralelo. Divergência garantida.

## O custo da decisão

- **9 colunas nullable a mais em `decimo_terceiro_linhas`**. Como é tabela pequena (206 linhas/ano × N anos), o custo em disco é desprezível. O custo em cognição é um pouco maior — o schema fica mais complexo.
- **Backfill necessário quando o código é atualizado**: a folha de 2026 foi criada antes da Fase A existir, então as 9 linhas de híbridos ficaram com `parte_clt_* = NULL` até o "Recalcular folha" rodar. Isso NÃO é bug, é consequência do snapshot imutável — qualquer mudança na lógica de cálculo exige um Recalcular pra propagar.
- **Edição manual mata o breakdown**: se o RH ajustar `salario_editado`, o chevron de expand some. Isso é a consequência correta mas pode confundir — a UI poderia mostrar um aviso "edit desliga o breakdown".

## Fatos pra conferir se mudar depois

- Hoje são **9 colaboradores híbridos** no cadastro (confirmado via SQL em 2026-10-21).
- O cálculo depende de `valor_recibo < salario` — se `valor_recibo` for maior ou igual, cai no caminho CLT puro.
- A regra de rateio proporcional do adiantamento é `(totalAdiantado × salarioClt / salario)` → arredondado 2 casas. Pra adiantamentos muito pequenos pode gerar diferença de centavos entre as partes; os totais na linha sempre batem.
- Backfill de folhas antigas quando a lógica de cálculo evoluir: rodar "Recalcular folha" na UI é suficiente, não precisa migration de dados.
