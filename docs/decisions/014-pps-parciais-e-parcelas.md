# 014 — PPs parciais por item e parcelas de pagamento

**Data:** 2026-08-17
**Status:** aceita
**Contexto:** Planilha Interna do job (`/jobs/[jobId]`), painel "Destrinchar
realizado" e formulário de Pedido de Produção. Design de referência:
`Job - PPs Parciais - Opcoes.dc.html` (projeto Claude Design `69342d83`),
**opção 2a — Ficha numérica · sem gráfico**; as demais opções do arquivo
foram descartadas pelo Tiago.

## Decisão

### 1. Um item pode ter várias PPs. O que limita é o saldo.

Até aqui o item aceitava **uma** PP ativa, garantida pelo índice único
`uniq_pp_ativa_por_item_realizado`. Agora aceita **quantas forem
necessárias, de quantos fornecedores forem** — não há limite por
fornecedor, e o mesmo fornecedor pode ter mais de uma PP no mesmo item.

O que trava é a conta: **a soma das PPs não canceladas de um item nunca
passa do Realizado do item.**

### 2. Só o cancelamento devolve saldo

PP **rejeitada** pelo financeiro continua ocupando o saldo. Ela vai ser
corrigida e reenviada pelo GP, então o dinheiro segue reservado — se
liberasse o saldo, outra PP poderia consumi-lo e o reenvio ficaria
impossível de fechar.

### 3. O valor da PP é uma fatia do realizado, medida em quantidade

Não existe campo "valor" no formulário. O usuário digita a **quantidade**
que aquele fornecedor entrega, e o valor sai de
`quantidade × (total_realizado ÷ quantidade_realizada)`.

Dividir o total pela quantidade, em vez de usar `valor_unitario_realizado`,
embute o D/M sozinho: item com D/M = 2 custa o dobro por unidade entregue.

São os números do próprio design: item de 800 un / R$ 9.400,00 → R$ 11,75
por unidade → PP de 500 un = R$ 5.875,00, PP de 200 un = R$ 2.350,00,
saldo de 100 un = R$ 1.175,00.

### 4. Descrição e Quantidade abrem vazias

O formulário vinha com o nome do item e a quantidade inteira do realizado
pré-preenchidos. Com PPs parciais isso induz a pedir o item inteiro para
um fornecedor só — o oposto do que a tela existe para fazer.

### 5. Parcelas: cada uma é um vencimento

A linha "Prazo de pagamento" virou duas colunas — **Prazo de pagamento**
(vencimento da 1ª parcela) e **Parcelas** (número, padrão 1, teto 36).
Com 2 ou mais, aparecem as linhas: vencimento sugerido de mês em mês
(editável) e valor em divisão igual com a sobra na última (editável).

**A soma das parcelas tem que fechar exatamente com o valor da PP** — no
cliente e na server action.

Toda PP tem ao menos uma parcela, inclusive as antigas (backfill 1/1).
É isso que permite às listas e ao PDF tratarem parcelada e não parcelada
do mesmo jeito.

### 6. Uma linha por parcela nas listas

Na aba "Pedidos de Produção (PPs)" do job, PP parcelada aparece **uma
linha por parcela** — `PP-00008 · 2/3`, com o vencimento e o valor
daquela parcela. Editar, Ver PDF e Cancelar continuam sendo da PP
inteira, e por isso só aparecem na linha da 1ª parcela.

### 7. A baixa continua por PP até a Tela 3.2

Decisão de escopo do Tiago: a 2.2 entrega as parcelas e as leituras; a
**baixa por parcela** entra na Tela 3.2, que reestrutura Contas a Pagar
em "Títulos a Pagar" e vai refazer essa máquina de todo jeito. Mexer
agora em `dar_baixa_pp`, no estorno e nas views `vw_a_pagar` /
`vw_fluxo_caixa` seria escrever duas vezes o mesmo código financeiro.

Consequência assumida: hoje o financeiro aprova e baixa a PP inteira, e
o fluxo de caixa ainda vê um vencimento só, no `prazo_pagamento` (que é
o da 1ª parcela). As colunas `pago_em` / `pago_por` da parcela já
existem, esperando a 3.2.

## Onde a regra mora

- **Contas (fonte única, cliente e servidor):** `lib/calculos/pps-item.ts`
  — `valorDaPP`, `saldoDoItem`, `somaDasPPs`, `passaDoSaldo`,
  `dividirEmParcelas`, `parcelasFecham`, `proximoVencimento`.
- **Servidor (o portão de fato):** `finalizarPedidoCompra` e
  `reenviarPedidoCompra` em
  `app/(app)/jobs/[jobId]/realizado/actions-pp.ts`.
- **Banco (última linha de defesa):** trigger `pp_valida_saldo_do_item`
  em `pedidos_compra`, criado por
  `supabase/migrations/20260817000002_pedidos_compra_parcelas.sql`. Ele
  recusa qualquer insert/update que estoure o realizado do item —
  inclusive dois cliques simultâneos e escrita por SQL direto. Tolerância
  de meio centavo, por causa do arredondamento de quantidade × unitário.
- **Painel:** `app/(app)/jobs/[jobId]/realizado/painel-pps-item.tsx`.

## O que ficou de fora, de propósito

- **Reenvio não redefine o parcelamento.** Corrigir uma PP rejeitada
  mantém o número de parcelas e as datas (a 1ª acompanha o "Prazo de
  pagamento"); só os valores são redivididos se o total mudou. Quem
  quiser outro parcelamento cancela e emite outra PP.
- **Baixar o realizado do item para menos que a soma das PPs** continua
  possível. O design trata o realizado como mestre ("acima disso é
  preciso alterar o realizado"); travar a edição dele não foi decidido.
- **Nenhum limite de PPs por fornecedor**, por decisão explícita do
  Tiago — a primeira redação do plano previa uma por fornecedor.


---

## ⚠️ Nota de 2026-08-21 — a base do saldo virou o ORÇADO

Os itens 1, 2 e 3 desta decisão continuam de pé: várias PPs por item, só
o cancelamento devolve saldo, e o valor da PP é uma fatia medida em
**quantidade**. O que trocou foi a **base** da fatia e do teto.

| | Até 20/08 | Desde 21/08 |
|---|---|---|
| Teto do item | realizado | **orçado** (`jobs_itens_orcado.total_orcado`) |
| Unitário da fatia | total_realizado ÷ quantidade_realizada | **total_orcado ÷ quantidade_orcada** |

O motivo é circularidade: o realizado passou a SER a soma das PPs, então
"soma das PPs ≤ realizado" compararia o número consigo mesmo e nunca
barraria nada — e a primeira PP de um item nunca caberia.

Os números do exemplo do item 3 continuam ilustrando a conta; só troque
"realizado" por "orçado" ao lê-los.

O parágrafo final ("Baixar o realizado do item para menos que a soma das
PPs continua possível") passou a valer para o **orçado**, via errata.

Ver `022-bv-liquido-e-realizado-por-pp.md`.
