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

## 7. O REALIZADO só mostra a decomposição quando há UMA PP

Decidido pelo Tiago em 01/09/2026, em duas etapas no mesmo dia.

`recalcular_realizado_do_item` derivava a decomposição por rateio:
`quantidade` era a soma das PPs, mas `dias_meses` era forçado a 1 e o
unitário saía de `total ÷ quantidade`. Escrita assim na
[022](022-bv-liquido-e-realizado-por-pp.md), quando a PP não **tinha**
decomposição para oferecer — e por isso a planilha passou a contradizer o
formulário: a PP digitada como `R$ 1.234,00 × 3 × 2` aparecia no
REALIZADO como `R$ 2.468,00 × 3 × 1`.

**A regra final:**

- **Uma PP no item** — as três colunas trazem o trio daquela PP, e a linha
  do REALIZADO fica idêntica ao que o GP digitou.
- **Mais de uma PP** — as três ficam **zeradas**, e a planilha mostra
  `— · — · —`. Quem quiser a quebra abre a tela de PPs do item, que é
  onde ela existe de verdade: o chip `PPs · N` da calha já leva para lá.
- **`total_realizado` não muda nos dois casos.** Continua sendo a soma dos
  `valor` das PPs menos as devoluções de verba, e continua correto.

A primeira tentativa foi **somar** as três colunas sempre. Funciona com
uma PP, mas com várias a soma não descreve compra nenhuma: o item
"Locação de som e luz", com 2 PPs somando R$ 18.000, exibia
`R$ 48.000,00 × 0,75 × 2`, cujo produto seria R$ 72.000. Um unitário de
R$ 48.000 para um custo de R$ 18.000 não é só inútil — é enganoso, porque
parece um preço contratado e não é.

Zerar bastou, sem nenhuma mudança de UI: as duas telas que leem essas
colunas já tratam zero como travessão — `CelulaLeitura` na Planilha
Interna e os formatadores do card da visão agregada.

Migrations: `20260901160002_realizado_soma_o_trio_das_pps.sql` e
`20260901180001_decomposicao_do_realizado_so_com_uma_pp.sql`, ambas com
reprocessamento das linhas existentes.

## 8. Fora desta mudança

O **PDF da PP** continua imprimindo `quantidade` e `valor`, sem a
decomposição. O documento que vai ao fornecedor não mudou de forma, e o
design desta rodada não o cobre.

## ⚠️ Nota de 2026-09-02 — o teto saiu (decisão 039)

O §3 ("O teto é o saldo em R$, nunca a quantidade") deixou de valer: não
há mais teto por PP. O trigger `pp_valida_saldo_do_item` foi removido e o
"máximo aceito nesta PP" sumiu do formulário. A referência do item passou
do orçado para o **planejado**, e passar dele não impede gerar — muda
quem pode enviar ao financeiro. Ver
[039](039-pp-nasce-gerada-e-o-envio-ao-financeiro-e-uma-acao.md) §3.

O §2 (o valor é R$ Unit. × QT × D/M) e o §7 (decomposição do realizado só
com uma PP) continuam. No §7, o realizado passou a contar só as PPs que
chegaram ao financeiro — a PP gerada fica de fora.
