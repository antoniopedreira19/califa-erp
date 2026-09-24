# 102 — O rateio job × save da nota emitida acompanha o save

**Data:** 2026-09-24
**Decidido por:** Tiago
**Migration:** `20260924100003_rateio_da_nota_acompanha_o_save.sql`

Fecha a regra 21 da [099](099-aprovacao-de-save.md), que ficou fora da
entrega do save. Segue a regra "job primeiro, save por último" da
[028](028-save-entre-jobs.md) (26/08/2026).

---

## 1. O problema

A nota de um job com save sai com dois itens: a parte do job e a parte
de save (`faturamento_itens.origem_tipo` `job` e `save`). Os títulos da
nota, as baixas e o fluxo de caixa não guardam divisão nenhuma: tudo
deriva desses itens (`vw_titulo_partes`, `vw_lancamento_origens`,
`vw_fluxo_caixa`).

O save pode mudar depois de a nota ser emitida: gerar save continua
possível depois do envio ao faturamento, e retirar um save gerado vale
até o envio para encerramento. O total da nota não muda — a linha em
save continua na nota —, mas muda quanto dela é receita do job e quanto
é crédito do cliente. Até aqui os itens ficavam como na emissão.

## 2. A regra

**O rateio se refaz no momento em que o save muda.** Se o save novo for
maior do que falta receber, ele se apropria de parte do que já foi
recebido: esse dinheiro passa a ser do save, na data em que entrou.

É a mesma lógica que o fluxo de caixa já usa no consumo de save: "o valor
passa a ser do job que consome, na data em que o dinheiro entrou".

A conta é a da fila de faturamento (`vw_faturamento_pendente`):

1. a parte própria de cada envio é `faturamento previsto − parte de save`
   do job (no mensal, `valor_faturado − valor_save` do mês);
2. ela cobre as parcelas do envio na ordem;
3. dentro de cada parcela, as notas na ordem de emissão recebem primeiro
   a parte do job, até a parte própria da parcela; o resto é save.

Só os itens `job` e `save` do próprio job mudam. O total de cada nota
fica igual, e o BV e os outros jobs de uma nota agrupada ficam como
estão. Nota cancelada não entra.

## 3. Onde acontece

`save_rateio_das_notas(job)` refaz os itens e registra na auditoria
(`faturamento.rateio_save_refeito`, com o antes e o depois de cada nota).
`save_gravar_totais` chama a função depois de regravar os números do
job. Por essa função passam aprovar, recusar pedido que o financeiro já
contava, cancelar e retirar save. Pedido que ainda aguarda não muda os
números do financeiro, então não mexe em nota.

## 4. Consequência que o Tiago aceitou

Um recebimento já lançado como receita do job pode passar a aparecer como
save, na data em que entrou, quando um save é aprovado depois. Relatórios
de meses anteriores mudam junto. Não há DRE nem fechamento de mês no
sistema hoje.

## 5. Como foi conferido (24/09/2026)

Simulação com rollback no JOB-0039 (faturamento R$ 49.409,72; save
R$ 27.836,46). Uma nota de R$ 30.000 na primeira de duas parcelas:

| Passo | Nota emitida (job · save) | Parcela 2 pendente (job · save) |
|---|---|---|
| Emissão | 21.573,26 · 8.426,74 | — |
| Rateio sem mudança | nenhuma nota alterada | — |
| Save novo de R$ 13.918,23 (maior que o que falta receber) | 7.655,03 · 22.344,97 | 0,00 · 19.409,72 |
| Retirada (save cai a R$ 13.918,23) | 30.000,00 · 0,00 (item de save sai) | 5.491,49 · 13.918,23 |

O save total bate em cada passo (22.344,97 + 19.409,72 = 41.754,69).
Não havia nota emitida no banco em 24/09, então nenhum dado real mudou.
