# 015 — Previsão de recebimento nasce na abertura do job

**Data:** 2026-08-17
**Status:** aceita
**Contexto:** formulário de abertura no financeiro
(`/financeiro/abertura-de-job/[jobId]`), quadro 02a do protótipo
"Abertura de Job — Financeiro". Regra definida pelo Tiago.

## Decisão

A abertura do job passa a gravar **duas** previsões, e não uma:

| Previsão | Tabela | Fecha contra |
|---|---|---|
| Desembolso (curva de custo) — já existia | `jobs_previsao_custo` | `custo_previsto_total`, o planejado dos itens de calha PP |
| **Recebimento — novo** | `jobs_previsao_recebimento` | `jobs.faturamento_previsto` |

Cada parcela de recebimento tem data e valor, a primeira nasce na **data
prevista de faturamento** que a produção informou ao enviar o job, e as
seguintes caem 30 dias depois da anterior. Tudo editável; a soma tem que
fechar com o faturamento previsto — no cliente **e** na server action,
que relê o número do banco em vez de aceitar o que o navegador mandou.

Job com faturamento previsto **zero** (tudo pago direto pelo cliente ao
fornecedor) abre **sem** previsão de recebimento, exatamente como job sem
item de calha PP abre sem curva de desembolso.

## Por quê o faturamento previsto, e não o valor total

São dois números diferentes desde 11/08/2026, e a diferença é justamente
o que **não** passa pelo caixa da California: os itens que o cliente paga
direto ao fornecedor (tipos A e D). No JOB-0010 real, valor total
R$ 24.076,81 e faturamento previsto R$ 21.076,81 — prever a entrada dos
R$ 24 mil seria prever dinheiro que a agência nunca recebe.

Pelo mesmo motivo, a **margem prevista** do resumo é
`faturamento previsto − custo previsto`: os dois lados do caixa da
California.

## "Previsto" é previsão — o número definitivo vem depois

`faturamento_previsto` é **estimativa**. O valor que a California de fato
emite em nota nasce mais tarde, quando a produção envia o job para
faturamento (`jobs_envio_faturamento.valor_faturado`) e a NF é emitida.

E, **de maneira análoga ao contas a pagar**: quando o faturamento é
realizado ele vira **título a receber** (`titulos_receber`) e **abate**
esta previsão. O abatimento é **leitura** — quem consome é o fluxo de
caixa e o contas a receber. Nada em `jobs_previsao_recebimento` é apagado
ou reescrito pela emissão da nota: a tabela guarda a previsão original,
que é o que permite comparar previsto × realizado depois.

Esse abatimento **ainda não está implementado** — é a mesma integração
pendente da curva de desembolso, registrada na seção 14 do
`HANDOFF_FINANCEIRO.md` e em [004](004-previsao-de-desembolso.md), agora
com os dois lados para ligar.

## Onde a regra mora

| Onde | O quê |
|---|---|
| `supabase/migrations/20260817000003_jobs_previsao_recebimento.sql` | a tabela, espelho de `jobs_previsao_custo` |
| `lib/validations/abertura-financeiro.ts` | `previsaoRecebimentoSchema` e o campo `recebimento` do schema da abertura |
| `app/(app)/financeiro/abertura-de-job/curva.ts` | `sugerirRecebimento` e `proximaDataRecebimento` |
| `app/(app)/financeiro/abertura-de-job/actions.ts` | relê `faturamento_previsto` do banco, confere a soma e grava |

## O que ficou de fora, de propósito

- **Janelas de pagamento não valem aqui.** Os dias 08 e 20 são o
  calendário com que a California **paga fornecedor**
  ([004](004-previsao-de-desembolso.md)); quem manda na data de entrada é
  o cliente. O date picker do recebimento aceita qualquer data.
- **Nenhuma coluna de baixa ou conciliação** na tabela nova. Previsão não
  é título — o título nasce do faturamento, com tabela própria.
- **Editar a previsão depois da abertura** não tem tela ainda. A action
  já regrava tudo (apaga e reinsere), como faz com a curva.
