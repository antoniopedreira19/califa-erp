# 120 — Cancelar e estornar baixa são duas ações diferentes, nas duas pontas

**Data:** 2026-09-28 (decisão) · 2026-09-29 (implementação)
**Decidido por:** Tiago
**Migration:** `20260929200001_cancelar_e_estornar_baixa.sql`
**Protótipo aprovado:** seção 5 de https://claude.ai/artifact/AXDeLzhBNzNWyvao8S9gZ7 (versão 4)

---

## 1. O problema

Até aqui o popup do olho (título já baixado, em Títulos a Receber e em
Títulos a Pagar) tinha um botão só, "Estornar baixa". Ele marcava o
lançamento da baixa como `*_estornada`, inseria um reverso com a data
**de hoje** e devolvia o título para Em aberto / A pagar. Na prática era
um cancelamento que deixava duas linhas no extrato — e não existia jeito
de registrar a devolução de parte do dinheiro sem desfazer a baixa.

Nas palavras do Tiago:

> Quero que ambas as opções fiquem disponíveis (o cancelamento cancela a
> baixa, o estorno registra uma nova transação, com um valor definido no
> momento).

## 2. As regras

| Pergunta | Resposta do Tiago |
|---|---|
| O que é **cancelar**? (D12 a) | A ferramenta de corrigir erro. O lançamento da baixa **sai do extrato**, sem linha nova; o título volta para **Em aberto** (receber) ou **A pagar** (pagar); o log de auditoria guarda quem, quando e por quê. |
| O que é **estornar**? (D11 a) | Uma **transação nova**, com data, conta e valor escolhidos na hora. A baixa fica como está e o título continua pago. No receber é **receita negativa** (sai dinheiro, no centro de custo do recebimento); no pagar, **despesa negativa**. |
| Cancelar vale para quais baixas? (D17.3) | **Todas, sem exceção**: título a receber, parcela de PP, conta avulsa e recorrência, parcela de desembolso, estorno de verba e fatura de cartão. |
| E o cartão? (resposta de 28/09) | Cancelar desfaz o último passo e mantém o fluxo de hoje. Pagamento de fatura cancelado devolve a fatura para **Fechada**, como se não tivesse sido paga. Item de cartão em fatura **aberta** sai da fatura; em fatura fechada ou paga, a regra continua: reabra a fatura antes. |
| Até quando se cancela? | **Sem limite de data**, até existir o processo de conciliação que marca um período como conferido (pendência registrada). |
| Pagou a mais? (D13 a) | Dá-se baixa pelo valor do título e a diferença vira recebimento avulso (entrega 2); a devolução é o estorno dele. |

**O que o protótipo aprovado fixa, e a implementação segue:**

- As duas ações ficam **no popup do olho**, no cartão da baixa, lado a lado:
  "Estornar" e "Cancelar esta baixa". Nenhum ícone novo na linha.
- **Os estornos da baixa saem junto** quando ela é cancelada (o aviso do
  cancelamento diz isso).
- O estorno vai **até o que a baixa movimentou menos os estornos
  anteriores**. A linha da lista mostra "estornado R$ X" sob o valor.
- Motivo obrigatório nas duas ações, com pelo menos 10 caracteres.

## 3. Onde o estorno não existe

| Baixa | Por quê | O que a tela diz |
|---|---|---|
| Item pago no cartão | Não saiu dinheiro do banco; a devolução é o "Estornar compra", que abate a fatura. | "Pago no cartão: para devolver, use Estornar compra…" |
| Pagamento de fatura de cartão | São duas pernas (banco e cartão) e não há devolução do banco para a agência nesse fluxo. | "Pagamento de fatura não tem estorno. Se foi lançado errado, cancele a baixa." |
| Transferência e rendimento | Decidido na D16 (entrega 2): só cancelam. | — |

O botão "Estornar" aparece desabilitado, com o motivo. O "Cancelar esta
baixa" está sempre lá.

## 4. Como ficou no banco

- `lancamentos_financeiros.motivo_estorno` — coluna nova, só do estorno.
  O estorno antigo guardava o motivo dentro da descrição.
- `cancelar_baixa_titulo_receber`, `cancelar_baixa_pp_parcela`,
  `cancelar_baixa_avulsa`, `cancelar_baixa_desembolso_parcela`,
  `cancelar_baixa_devolucao_verba` e `cancelar_baixa_fatura_cartao` —
  uma por tipo, no mesmo par {tipo, id} que a baixa usa na ida. Cada uma
  apaga o lançamento da baixa (e os estornos pendurados nele), devolve o
  título/parcela/fatura ao estado de antes e grava `audit_events` na mesma
  transação. O título a receber também devolve o BV de "recebido" para
  "confirmado", o inverso do que a baixa faz.
- `estornar_valor_da_baixa(lançamento, data, conta, valor, motivo)` —
  insere a linha `*_estorno` ligada à baixa por `estorno_de_lancamento_id`,
  com a natureza invertida e tudo o que classifica a baixa herdado dela
  (empresa, plano de contas, contraparte, job, regional, origem). Recusa
  valor acima do saldo, data anterior à baixa, conta de cartão, conta
  inativa e data anterior ao saldo inicial da conta.
- **Permissão no banco:** as sete funções exigem administrador ou
  financeiro. As antigas só pediam membro do tenant.
- As funções `estornar_baixa_*` antigas **continuam no banco**, sem
  chamador na tela. `estornar_baixa_desembolso_parcela` está quebrada desde
  a origem (usa `cancelado_em`, coluna que não existe, e insere
  `desembolso_estorno` sem `estorno_de_lancamento_id`); não foi tocada.

**Por que reaproveitar as origens `*_estorno`.** As CHECKs do lançamento
já exigem `estorno_de_lancamento_id` nelas, os índices "uma baixa viva"
só olham `*_baixa`, e o fluxo de caixa já rotula "Estorno de recebimento",
"Estorno de PP" etc. A diferença para o estorno antigo é que o pai
continua `*_baixa` (vivo), em vez de virar `*_baixa_estornada`.

## 5. O que muda para quem já usava

- O "Estornar baixa" de antes virou **Cancelar esta baixa**, e agora
  **não deixa linha nenhuma** no extrato. Os pares antigos
  (`*_baixa_estornada` + reverso) ficam como estão: são histórico.
- A tela de detalhe da conta avulsa (`/financeiro/contas-a-pagar/avulsa/[id]`)
  tinha um "Cancelar baixa" que fazia o reverso; agora cancela de verdade,
  com a mesma opção de pausar a recorrência.
- A conciliação bancária **não mudou** (pedido do Tiago): o estorno novo
  aparece nela como qualquer lançamento, e o cancelado simplesmente some.

## 6. Pendências

- Processo de conciliação que trava um período como conferido — até ele
  existir, cancelar vale sem limite de data.
- Retenção de impostos e baixa parcial (entrega 3) vão acrescentar
  informação ao cartão da baixa; o cancelamento já apaga tudo o que
  estiver pendurado no lançamento.
