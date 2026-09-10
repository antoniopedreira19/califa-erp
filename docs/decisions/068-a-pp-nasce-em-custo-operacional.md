# 068 — A PP nasce carimbada em Custo Operacional

**Data:** 2026-09-10
**Status:** aceita
**Contexto:** `pedidos_compra`, aba "Títulos a Pagar" de Contas a Pagar,
e a previsão de fluxo de caixa que ainda vai ser destrinchada por centro
de custo. Pedido do Tiago em 10/09/2026.

## O problema

O centro de custo da PP só existia quando ela ia para o cartão de crédito.
Fora disso, `plano_conta_tipo_id` ficava nulo e a tela de Títulos a Pagar
exibia "Custo Operacional" por um `??` no servidor, recalculado a cada
carregamento.

Bom para exibir, inútil para somar: **nenhuma consulta ao banco enxerga um
default que só existe no TypeScript.** Uma previsão de fluxo de caixa
quebrada por centro de custo veria 26 das 27 PPs sem centro nenhum.

## A regra

1. **Toda PP é custo de job.** `pedidos_compra.job_id` é `NOT NULL` — não
   existe PP fora de job —, então toda PP entra em **Custo Operacional**
   (tipo de código `02`).
2. **O carimbo é do banco, não da tela.** Um trigger `before insert`
   preenche o tipo quando ele chega nulo. Já existe mais de um caminho de
   criação (gerar e reenviar), e a regra tem que valer para os que ainda
   vão existir.
3. **O subtipo continua vazio.** Quem escolhe é o financeiro na baixa, em
   Títulos a Pagar — onde o campo já vem pré-selecionado com o tipo e
   aberto para revisão.
4. **O cartão de crédito manda mais.** Lá o financeiro escolhe tipo e
   subtipo na aprovação, e `rotear_pp_para_cartao` sobrescreve. O trigger
   só age quando o campo chega nulo.

## Por que o subtipo fica de fora

O tipo `02` tem hoje um único subtipo, "Geral (provisório)". Carimbar o
histórico inteiro com um provisório economizaria um clique na baixa e
custaria uma revisão de todo o passado quando os subtipos de verdade
existirem. O Tiago escolheu o clique.

## O que foi aplicado

`supabase/migrations/20260910200001_pp_nasce_em_custo_operacional.sql`:
função + trigger + backfill das 26 PPs que estavam com o campo nulo — um
backfill aditivo, que só torna explícito o que a tela já exibia.

**Verificação (10/09/2026).** Depois de aplicar: 26 PPs em Custo
Operacional e 1 em Despesa Administrativa (a do cartão, preservada);
nenhuma com tipo nulo; nenhuma com subtipo preenchido. O trigger foi
exercitado com um `insert` real dentro de uma transação revertida — a
linha nasceu com o tipo `02` e subtipo nulo, e o `rollback` não deixou
resíduo (27 PPs antes, 27 depois).
