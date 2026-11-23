# 268 — "Parcial" na situação do faturamento do job, e "Liquidado" vira "Recebido"

**Data:** 2026-11-22
**Status:** aceita e implementada em 22/11/2026.
**Quem decidiu:** Tiago, numa sessão paralela (pedido repassado a esta sessão com a autorização dele).
**Revê:** a [075](075-a-esteira-reconhece-a-nota-pelos-itens.md) (a esteira do faturamento pelos itens da nota) e completa a [265](265-mais-faturamento-um-formulario-so.md) (o Novo faturamento abaixo do previsto).

## O problema

A situação do faturamento do job (`lib/calculos/esteira-faturamento.ts`) só comparava o faturado com o previsto no job mensal. No envio único, o job faturado em parte — o envio com parcela ainda sem nota, ou o Novo faturamento abaixo do previsto — saía "Faturado" e virava "Liquidado" quando os títulos eram pagos, mesmo com saldo por faturar. Exemplo no Sandbox: TES-1006/26, R$ 80.000,00 faturados de R$ 134.269,91, com R$ 54.269,91 na fila; o selo do cabeçalho do financeiro dizia "FATURADO".

## Decisão

1. **"Parcial"** quando as notas somam menos que o previsto do job (tolerância de R$ 0,05):
   - envio único com parcela sem nota (a régua é o valor do envio);
   - Novo faturamento abaixo do previsto (a régua é o faturamento previsto do job);
   - no mensal, mês enviado ou faturado pelo financeiro com saldo (a régua é o que já foi enviado; mês ainda não enviado não é saldo).
2. **Prioridade:** Inadimplente (título vencido) > Parcial (mesmo com os títulos pagos) > Faturado > Recebido. Faturado e Recebido só com o job todo coberto. Sem nota, continua Enviado ou Aguardando envio.
3. **Nome:** "Parcial", sem abreviação, no selo e no filtro. Dica do selo: "Faturado parcialmente: R$ X de R$ Y · falta R$ Z".
4. **"Liquidado" passa a se chamar "Recebido"** em todo lugar desta situação (valor interno `recebido`).
5. **Onde:** o selo do cabeçalho do job no financeiro (`/financeiro/jobs/[id]`, com a dica) e os filtros e o resumo da Abertura › Abertos, com o filtro "Parcial" entre "Faturado" e "Recebido". Por ser a mesma situação, também a coluna "Faturamento do job" da lista de PPs do Contas a Pagar (decisão 257) e a coluna "Situação" da exportação da Abertura. Ficam de fora a barra de faturamento da produção e o Contas a Receber, que já tratam o saldo.

## Implementação

- `lib/calculos/esteira-faturamento.ts`: estado `parcial` e `liquidado` → `recebido`; `classificarFaturamento` e `consolidarNotasDoJob` recebem a marca `parcial`.
- `lib/data/faturamento-por-job.ts`: a régua do "Parcial" por job e o campo `valor_previsto` (para a dica). O faturamento previsto dos jobs é lido inteiro (`todasAsLinhas`), em paralelo com as outras leituras.
- `app/(app)/financeiro/abertura-de-job/situacao-faturamento.ts`: rótulos "Parcial" e "Recebido" e `dicaDaSituacao`.
- Cabeçalho do job no financeiro, Abertura › Abertos (filtros, resumo, impostos das notas), lista de PPs do Contas a Pagar.
- Testes: `lib/calculos/esteira-faturamento.test.ts` (5 casos novos).
- Sem migration: a situação é calculada, não gravada.

## Conferido no Sandbox

O TES-1006/26 aparece "Parcial", com a dica "Faturado parcialmente: R$ 80.000,00 de R$ 134.269,91 · falta R$ 54.269,91". Depois da baixa do título da NF 248 (R$ 80.000,00, pela tela de Títulos a Receber), continua "Parcial" — antes viraria "Liquidado". No filtro "Parcial" da Abertura › Abertos ficam os TES-1006, 1008, 1026, 1030 e 1035/26 (todos com Novo faturamento abaixo do previsto); no "Faturado", os cobertos (TES-1007 e 1038/26).
