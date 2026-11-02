# 232 — As previsões da planilha no sistema

**Data:** 2026-11-02
**Status:** aceita e implementada em 02/11/2026. A carga das previsões da planilha de 01/11 está ativa.
**Quem decidiu:** Tiago, em 02/11/2026: "Carga agora, títulos depois", e "Sim, seguir" para o desenho abaixo.
**Complementa:** a [211](211-importacao-do-historico-da-planilha-financeira.md), que deixava as previsões fora do sistema ("Só o realizado").
**Migration:** `20261102700001`.

## O problema

A planilha soma lançamentos com data futura: recebimentos de notas, custos de job, pessoal, contas fixas e impostos que ainda vão acontecer. O 3T fechado na planilha conta R$ 11,86 milhões de previsões só no lucro líquido da Agência California. O sistema mostrava só o realizado, e a transição para o sistema acontece antes de esses valores serem recebidos ou pagos.

Nas palavras do Tiago: "precisaremos transicionar para o sistema, antes de todos os valores serem recebidos, e precisaremos ter elas registradas para que possam ser reconhecidas ao estarmos fazendo a conciliação, no futuro".

Cerca de dois terços das previsões já têm um módulo próprio no sistema: o faturamento, as PPs, a folha, as contas fixas recorrentes e o Fiscal. Lançar cada uma como título avulso duplicaria o que esses módulos vão gerar.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | Onde moram | Uma carga do histórico de tipo `previsao`, com conta, data prevista, valor, Tipo e job de cada linha de `previsoes.csv`. Cada versão nova da planilha troca a carga |
| D2 | Antes de acontecer | Não soma no saldo nem na DRE do realizado. A DRE ganha o seletor "Só realizado / Com previsões" |
| D3 | Na conciliação | Depois da cauda e dos títulos do sistema, a linha do banco procura a previsão de mesmo valor na mesma conta, de 10 dias antes da data prevista em diante, sem limite de atraso. Só se resolve sozinha a previsão única desse valor nesse alcance; com outra igual em aberto, pede conferência. Revisto no mesmo dia (abaixo) |
| D4 | Linha antes da planilha | A linha do banco até o dia da planilha não casa com previsão: a planilha já a teria como realizada |
| D5 | Ligada ao banco | A previsão vira realizada: passa a ter a data do banco (a prevista fica em `data_prevista`), entra no saldo, no Extrato, no fluxo de caixa e na DRE do realizado, no trimestre que a planilha deu a ela. Desfazer a conciliação devolve a data prevista |
| D6 | Título do sistema de mesmo valor | A conciliação dá preferência ao título (PP, título a receber). A previsão continua prevista até a próxima versão da planilha, sem contar duas vezes: o saldo vem da baixa, e a DRE vem da planilha |
| D7 | Versão nova da planilha | A mesma previsão (digital, conta e valor) herda a ligação. A previsão já ligada que a versão nova não traz continua, porque o dinheiro aconteceu. A cauda nova que traz como realizada uma previsão ligada (mesma conta, valor e dia) herda a ligação, e a previsão sai |
| D8 | Transição | Quando um módulo assumir a sua parte (faturamento dos jobs, PPs, folha, Fiscal), as previsões daquele tipo saem da carga e viram os títulos do sistema |
| D9 | Entradas antigas | As 160 previsões de entrada com competência de 2014 a 2025 (R$ 5,66 mi) entram, para a conciliação as reconhecer se forem pagas |
| D10 | Jobs do sistema | As 497 previsões de jobs do sistema entram todas, com a regra D6 |

## A carga de 01/11/2026

- 3.044 linhas, de 03/11/2026 a 21/12/2027, com saldo previsto de R$ 16.000.315,37 (R$ 70,4 mi de entradas e R$ 54,4 mi de saídas).
- Por conta: BB California 1.830, California Santander 1.025, Santander GoCrazy 161, Santander Hitlab 26, Fundo Fixo e BB GoCrazy 1 cada.
- Levam os 565 jobs citados, sem notas, rateio nem saldos.
- Pacote: `npx tsx scripts/historico-financeiro/empacotar.ts <pasta-da-versão> --previsoes`.

## Conferido em 02/11/2026

- **Nada mudou no realizado:** antes e depois da migration e da carga, a DRE só do realizado, o regional, a rentabilidade, os saldos de cada conta (também projetados para 31/12/2027), o resumo das contas e o fluxo de caixa devolvem exatamente o mesmo.
- **A DRE com previsões bate com a planilha:** em 2026, por empresa e trimestre, ela é a célula da planilha menos a diferença de regra registrada e menos o que falta carregar. A receita do 3T dá R$ 24.608.137,25 na California, R$ 9.010.335,39 na CCH e R$ 5.367.503,97 na Hitlab; o lucro líquido do 3T da California, R$ 2.695.667,89.
- **Na tela:** o seletor da DRE troca as duas visões e diz quantas previsões do ano ainda não aconteceram (2.731 com competência em 2026). A conciliação da California Santander abre com as previsões e sugere a da linha de 03/11, sem ligar nada sozinha.
- **Acesso:** a função da DRE nova tem GRANT para `authenticated` e nada para `anon`; o gatilho e a soma da cauda não têm GRANT.
- **Testes:** 135 passam, com o caso das previsões no motor da conciliação. Lint e tsc limpos.

### Revisão de 02/11/2026: a previsão vencida continua valendo

O Tiago perguntou se a janela seguia a regra de rolagem das previsões que já estão no sistema: "Se não for o caso, acho bom implementar para que possamos nos prevenir a casos de atraso e inadimplencia". Não seguia: a primeira versão aceitava só até 10 dias da data prevista. O título a receber vencido rola de semana em semana até ser pago (migration `20260831110001`), e a previsão do fluxo de caixa rola para a próxima data (decisão 018). Agora a previsão da planilha também continua valendo depois da data prevista: a linha do banco a reconhece com qualquer atraso, e o motivo da sugestão diz quantos dias ela atrasou. Antes da data prevista, o limite segue em 10 dias.

## O que fica para depois

- O registro de quem atrasou (como o `inadimplente_desde` do título a receber) e a lista das previsões vencidas e não pagas: entram com a fase da interface, quando o faturamento assumir os recebimentos.

- O fluxo de caixa ainda não mostra as previsões que não aconteceram como previsto.
- Na troca da cauda, a previsão realizada só passa a ligação para a linha da cauda de mesmo dia; com data diferente, a conferência é à mão.
- As previsões de cada tipo saem da carga conforme o módulo assumir (D8). A regra de quando cada tipo sai se decide na fase da interface.
