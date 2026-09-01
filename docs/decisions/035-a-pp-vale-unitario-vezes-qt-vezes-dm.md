# 035 — A PP vale R$ Unit. × QT × D/M

**Data:** 2026-09-01
**Decidido por:** Tiago

Substitui a conta de valor das PPs parciais definida em
[022](022-bv-liquido-e-realizado-por-pp.md) §Valor. O teto por saldo, o
que devolve saldo e a linha vermelha seguem como estavam.

---

## 1. O formulário chamava de unitário um número que era o total

Até aqui a PP tinha um campo só de dinheiro — `Quantidade` — e o valor
saía de `quantidade × (total do item ÷ quantidade orçada)`. A divisão
era proposital: o total do item é `unitário × QT × D/M`, então dividir
pela QT reembutia o D/M e a conta fechava.

O preço disso aparecia na tela. O item **Gerente de Projetos** do job
Summit Califa 2026 é `R$ 5.000 × 1 × 2 = R$ 10.000`, e o formulário
dizia:

> "O valor sai da quantidade: **R$ 10.000,00 por unidade do orçado**"

R$ 10.000 não é o unitário de lugar nenhum — é o total. Quem abria a
tela para contratar uma diária via o número errado.

## 2. A PP passa a ser montada como a linha da planilha

Os três primeiros campos do formulário são agora **R$ Unit., QT e D/M**,
as mesmas colunas do item, e o valor é o produto dos três, ao vivo.

Os três são do GP: **nenhum é derivado do orçado**. O unitário da PP
pode ser diferente do unitário orçado, e é assim que o desconto do
fornecedor entra no sistema em vez de sumir dentro de uma quantidade
fracionada. O que se perdia antes era a negociação: `quantidade = 0,25`
não diz se o fornecedor cobrou menos por diária ou entregou menos
diárias. Agora a decomposição fica gravada.

## 3. O teto é o saldo em R$, nunca a quantidade

A soma das PPs não canceladas do item continua não podendo passar do
**orçado em R$** — mesma regra da [022](022-bv-liquido-e-realizado-por-pp.md),
mesmo trigger `pp_valida_saldo_do_item`, mesma tolerância de meio
centavo.

Quantidade **não** limita. Um item orçado como `R$ 5.000 × 1 × 2` aceita
uma PP de `R$ 2.500 × 1 × 4`: são 4 diárias num item de 2, mas custam os
mesmos R$ 10.000. Quem manda é o dinheiro, porque é o dinheiro que o job
tem para gastar.

O aviso de estouro passou a viver dentro do bloco de valor, ao vivo,
em vez de aparecer só no erro do topo ao clicar em Gerar PP.

## 4. Os campos nascem vazios

Preenchê-los com o orçado do item induziria a pedir o item inteiro a um
fornecedor só, que é o oposto do que a tela de PPs parciais faz — a
mesma razão que já mantinha `Descrição` e `Quantidade` vazias desde
17/08/2026.

A decomposição do orçado (`5.000,00 × 1 × 2`) fica no cartão de cima,
como referência do que digitar. É de lá que o "Valor desta PP" saiu:
mostrar a mesma conta em dois lugares da mesma tela é como os dois
começam a divergir.

**Exceção:** a correção de PP rejeitada (`editar-pp-drawer`) abre **com**
os valores gravados. Ali o GP conserta um documento que já existe, não
monta uma fatia nova.

## 5. A correção precisa usar a MESMA conta

`reenviarPedidoCompra` também recalcula o valor no servidor. Enquanto a
emissão multiplicasse o trio e a correção rateasse o orçado, reenviar
uma PP de `R$ 2.500 × 1 × 2` **sem mexer em número nenhum** a
reescreveria como R$ 10.000 sozinha, silenciosamente.

Por isso as funções antigas `valorDaPP` e `unitarioEfetivo` foram
**removidas** de `lib/calculos/pps-item.ts` junto com a mudança, e não
apenas deixadas sem uso: enquanto existissem, um caminho novo poderia
reintroduzir o rateio e voltar a divergir do servidor.

## 6. Banco

`pedidos_compra` ganhou `valor_unitario numeric(14,2)` e
`dias_meses numeric(12,3)`, ambas `NOT NULL`, com `check (dias_meses > 0)`.

As 14 PPs existentes foram backfilladas com `D/M = 1` e
`unitario = valor / quantidade` — a decomposição equivalente ao que já
valia. **`valor` não foi tocado e nenhuma PP mudou de preço** (conferido:
diferença de `0,00` nas 14). Em quantidade que não divide redondo o
produto da decomposição pode ficar um centavo do valor gravado; quem
manda continua sendo a coluna `valor`.

Migration: `20260901130001_pp_guarda_unitario_e_dias_meses.sql`.

## 7. Em aberto: a decomposição do REALIZADO na planilha

Verificado em 01/09/2026 com a PP-00015 (`R$ 1.234,00 × 3 × 2 = R$ 7.404,00`,
item Logistica Ceno do Summit Califa 2026). A PP gravou o trio correto,
mas as colunas do REALIZADO na planilha mostram **`R$ 2.468,00 × 3 × 1`**.

A causa é `recalcular_realizado_do_item`, que soma `valor` e `quantidade`
das PPs do item e deriva `dias_meses_realizado = 1` e
`valor_unitario_realizado = total ÷ quantidade` — o mesmo rateio que esta
decisão acabou de tirar do formulário. Ele foi escrito assim na
[022](022-bv-liquido-e-realizado-por-pp.md), quando a PP **não tinha**
decomposição para oferecer.

O total continua certo em todo lugar; o que diverge é a decomposição.
**Não foi alterado nesta rodada porque a regra não é óbvia:** com mais de
uma PP no mesmo item, e unitários diferentes entre elas, não existe um
unitário único do realizado. Decidir se ele passa a ser a média
ponderada, o da última PP, ou se some quando as PPs divergem, é escolha
do Tiago — e vale para toda a planilha, não só para este formulário.

## 8. Fora desta mudança

O **PDF da PP** continua imprimindo `quantidade` e `valor`, sem a
decomposição. O documento que vai ao fornecedor não mudou de forma, e o
design desta rodada não o cobre.
