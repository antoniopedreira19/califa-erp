# 249 — A conta corrente com aplicação automática numa linha só, e só o extrato completo

**Data:** 2026-11-09
**Status:** aceita e implementada em 09/11/2026.
**Quem decidiu:** Tiago, em 09/11/2026, revisando o protótipo "Contas com aplicação": a recomendação A ("acho que A funcionará melhor"), o expandir com o ícone dos jobs e "Sim, implementar". A trava do extrato completo veio do pedido "Seria bom restringirmos, para que só venhamos a aceitar a versão completa do extrato".
**Complementa:** a [091](091-a-conciliacao-comeca-pela-lista-de-contas.md) (a lista de contas da Conciliação) e a [211](211-importacao-do-historico-da-planilha-financeira.md) (o recomeço das contas em 03/11 e as contas de aplicação de 27/10).
**Migration:** `20261109960001`.

## O problema

O banco aplica sozinho, no fim de cada dia, o que sobra na conta corrente (ContaMax no Santander, Rende Fácil no BB) e resgata quando falta. A corrente fecha o dia em R$ 0,00 no extrato, e o dinheiro fica na aplicação. No sistema, as duas são contas separadas.

Quando o financeiro dá baixa numa PP antes de conciliar o resgate automático daquele dia, a corrente fica negativa e a aplicação fica alta. Em 09/11, a lista mostrava a California Santander com −R$ 114.026,90 e a ContaMax dela com R$ 414.229,23. Somadas, R$ 300.202,33, o único número que faz sentido conferir.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | O par | A conta de investimento que é a aplicação automática de uma corrente aponta para ela (`contas_bancarias.conta_corrente_id`). Uma aplicação por corrente; a aplicação é de investimento e a corrente é corrente, do mesmo tenant. As XP ficam sem par: são investimento à parte |
| D2 | Os pares de hoje | California Santander + ContaMax, BB California + Rende Fácil, Santander GoCrazy + ContaMax e Santander Hitlab + ContaMax, tirados das regras de transferência do extrato que já existiam |
| D3 | A lista da Conciliação | O par vira uma linha só: "California Santander · corrente + ContaMax", com o saldo, as entradas, as saídas e os lançamentos somados. Ao abrir, aparecem a corrente e a aplicação, recuadas, cada uma abrindo o seu extrato. Os pares chegam fechados |
| D4 | Abrir e recolher | Coluna própria à esquerda, de 32 px, como na lista de Jobs, com o ícone do "Recolher todos" das planilhas numa caixinha: setas para fora com o par fechado, para dentro com ele aberto. A linha inteira abre e recolhe. O "›" da direita é só para abrir a conta, e a linha do par não tem |
| D5 | O cadastro | A conta de investimento tem o campo "Aplicação automática da conta", com as correntes que ainda não têm aplicação |
| D6 | Só o extrato completo | Numa conta com aplicação, a importação recusa o arquivo que tem movimento num dia já fechado e nenhuma linha de aplicação ou resgate. As linhas se reconhecem pelas regras de transferência da conta para a aplicação. O dia em que o arquivo foi gerado fica de fora, porque a aplicação só acontece no fim do dia |

## Por que bate com o banco, e onde não bate

O extrato completo traz cada aplicação e cada resgate como uma linha. Conciliada pela regra, ela vira a transferência entre a corrente e a aplicação. Assim a corrente acompanha o extrato, e o total do par só muda com movimento de fora (pagamento, recebimento, tarifa).

O rendimento da aplicação não vem no extrato da corrente. Sem ele, a aplicação fica um pouco abaixo da real, a cada mês. Fica para depois: o saldo do extrato mensal da aplicação, informado à mão ou lido do PDF, com o rendimento proposto pela diferença e lançado só depois de confirmado, com a corrente toda conciliada.

## Conferido em 09/11/2026

- **Banco:**
  - os 4 pares preenchidos;
  - o índice único;
  - o gatilho;
  - a tabela com RLS e o mesmo GRANT (`authenticated`: SELECT, INSERT, UPDATE; `anon`: nada).
- **Na tela, na largura de 1838 px:**
  - BB California + Rende Fácil: R$ 595.978,67;
  - California Santander + ContaMax: R$ 300.202,33;
  - Santander GoCrazy + ContaMax: R$ 99.661,12;
  - Santander Hitlab + ContaMax: R$ 5.621,50.
  - O total geral ficou igual (−R$ 2.664.182,05).
  - O par abre e recolhe pelo clique na linha.
- **Largura mínima da tabela:** a largura mínima passou de 1.000 px para 1.320 px. As colunas fixas já somavam mais que 1.000 px, e em tela estreita a coluna Conta sumia.
- **Cadastro:** a ContaMax da California abre com a California Santander escolhida, e a lista oferece só as correntes livres. Conferido sem salvar.
- **Importação:** o extrato de 31/10 da California Santander, no formato novo, foi recusado com o aviso, sem gravar a importação. Há 5 testes da regra, com o dia da geração e o acento do Rende Fácil.

## O que fica para depois

- O rendimento mensal das aplicações, pelo extrato da aplicação.
- As entradas e as saídas da linha do par incluem as transferências entre as duas contas, como o total da empresa já faz.
- O quadro "Saldo por tipo de conta" continua separando Conta corrente e Investimento.
