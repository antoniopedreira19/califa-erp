# 245 — O prazo de envio das PPs que vencem em 20/11/2026 vai até 06/11

**Data:** 2026-11-06
**Status:** aceita e implementada em 06/11/2026. Exceção única, só para essa janela.
**Quem decidiu:** Tiago, em 06/11/2026: "Pode abrir uma decisão, só nesse caso."
**Abre exceção na:** [157](157-prazo-de-envio-da-pp.md) (a PP chega ao financeiro até 15 dias antes da janela).

## O problema

Pela 157, a PP com vencimento em 20/11/2026 podia ser enviada até 05/11 (20/11 − 15 dias, uma quinta-feira). É a linha do calendário que o financeiro divulgou. Em 06/11 a produção foi avisada de que o último dia era 06/11, mas o formulário da PP já não oferecia o 20/11, e as PPs geradas com esse vencimento estavam com o "Enviar ao financeiro" travado.

O banco mostrava, em 06/11: a última PP com vencimento 20/11 gerada em 05/11 às 23:42, e 14 PPs geradas com vencimento 20/11 ainda não enviadas (13 delas sujeitas ao prazo, porque foram geradas depois de 08/10).

## Decisão

1. **A janela de 20/11/2026 aceita envio até 06/11/2026, inclusive.** Vale para todo o fluxo que obedece à 157: o calendário do formulário, o gerar PP, o salvar a PP a emitir e o envio ao financeiro.
2. **A partir de 07/11, vale a regra de novo**: a primeira janela possível volta a ser 08/12/2026 (envio até 23/11).
3. **Só essa janela.** As outras datas-limite não mudam, e a quarta de exceções (172) também não.

## Como fica no código

- `lib/calculos/janelas-pagamento.ts`: a tabela `PRAZOS_DE_ENVIO_PRORROGADOS` (janela → nova data-limite) entra no fim do `dataLimiteDeEnvio`. Como todas as travas, na tela e no servidor, passam por essa função, a exceção vale nas duas pontas de uma vez. A tabela só estende o prazo, nunca o encurta.
- `janelas-pagamento.test.ts`: a linha do calendário de 20/11 passa a esperar 06/11, e um teste novo cobre 06/11 aberto, 07/11 fechado, a primeira janela nos dois dias e a quarta 11/11 da PP urgente ou de verba.
- Sem migration.

## O que fica para depois

A tabela no código é provisória. O próximo passo, pedido pelo Tiago no mesmo dia, é o financeiro registrar exceções e controlar a regra pela tela. Quando isso existir, esta linha vai para o banco e sai do código.
