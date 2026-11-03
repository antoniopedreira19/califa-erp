# 235 — Os custos fixos como recorrências no Contas a Pagar

**Data:** 2026-11-03
**Status:** aceita e implementada em 03/11/2026. As 133 recorrências estão gravadas.
**Quem decidiu:** Tiago, em 03/11/2026. Ele aceitou os três pontos de partida ("Estou de acordo com os 3 pontos citados"), escolheu as quatro recomendações da proposta e respondeu "Sim, implementar".
**Complementa:** a [232](232-previsoes-da-planilha-no-sistema.md), na regra D8: quando um módulo assume a sua parte, a previsão daquele tipo sai do fluxo.
**Migration:** `20261103800001` (aditiva).

## O problema

A relação de custos fixos chegou em 27/10/2026 (`custo-fixo-2026-10-27.xlsx`, fora do repositório). Ela foi analisada naquele dia, mas nada foi gravado. Em 03/11 a aba Recorrências do Contas a Pagar estava vazia. Os custos fixos só existiam como previsões da planilha no fluxo de caixa, e nenhum deles virava título a pagar.

A planilha tem 4 abas, DP e CF da California e da Go Crazy. A aba DP é a folha, que já vem do RH. A aba CF tem 147 linhas com data em novembro: CF da California, da CCH (CMH) e da Hitlab (HIT), e também DA, DM, DP, CO e restos do 3T.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | O que vira recorrência | As 133 linhas de CF, DA e DM do 4T, R$ 454.963,59 por mês. Ficam de fora: CO (4 linhas, custo de job), DP (7 linhas do 4T, que ficam com o RH, como decidido em 27/10) e os restos do 3T (4 linhas) |
| D2 | Empresa | Pelo Tipo da planilha: CMH vai para a CCH, HIT vai para a Hitlab, e o resto fica na Agência California. A aba Go Crazy entra como Agência California, regional SS, porque a Go Crazy não é empresa gerencial |
| D3 | Regional | A coluna Reg, pelo de-para da importação (na CCH, NE é a Doca e SP é a Agency; a Hitlab tem uma regional só). "TD" usa o rateio de 2026 da tabela `empresas_rateios_regionais`, o mesmo da folha: California SP 30, NE 25, RJ 25, NO 20; CCH Agency 50, Doca 50 |
| D4 | Plano de contas | Pelo de-para aprovado na importação (`grupo` + `cod`). Três códigos sem par: dois só mudam a maiúscula, e um "FGT" classificado como CF vai para 04.010 (Outros) |
| D5 | Dia | Mensal, nas janelas do sistema (08 e 20). A planilha pôs dia 9 em novembro porque 08/11/2026 é domingo. Uma linha fica no dia 4 e outra no dia 10, como estão na planilha |
| D6 | Fornecedor | Nasce sem fornecedor. Só 3 dos 73 estão no cadastro, e a planilha não traz CPF/CNPJ nem banco. A descrição leva "descrição · fornecedor" da planilha. Quem cadastrar o fornecedor liga depois na recorrência. Sem fornecedor, não sai por remessa |
| D7 | Forma de pagamento | Boleto nas 33 linhas com Doc. "Boleto". Nas outras, vazia |
| D8 | Previsão da planilha | Sai do fluxo "pelo item". A recorrência guarda `previsao_chave` (md5 de fornecedor e descrição normalizados). A previsão sai quando há recorrência ativa da mesma empresa e do mesmo Tipo com a mesma chave, e a competência da previsão é do trimestre em que a recorrência nasceu ou depois. As contas de outubro (3T) com data em novembro continuam. Pausar a recorrência ou passar da `data_fim` devolve a previsão |
| D9 | Títulos de novembro | Nascem na hora: a recorrência vira título 30 dias antes (decisão de 15/09/2026) |
| D10 | Como gravar | Pela ação da tela (`criarContaRecorrente`), com validação e auditoria, a partir de um pacote local. Nunca por migration, porque o repositório é público e as descrições têm nomes. A chave entra depois, por `update` do id |

## Conferido em 03/11/2026

- **Recorrências:** 133, todas ativas e criadas pelo usuário do Tiago, somando R$ 454.963,59. Por empresa: Agência California 109 (R$ 319.746,17), CCH 21 (R$ 129.217,42) e Hitlab 3 (R$ 6.000,00). Todas têm rateio somando 100, e as 133 têm chave.
- **Títulos de novembro:** 133, aprovados, com rateio. Dia 04/11: 1 (R$ 199,90). Dia 08/11: 86 (R$ 332.926,80). Dia 10/11: 1 (R$ 8.888,14). Dia 20/11: 45 (R$ 112.948,75). A próxima data ficou em dezembro.
- **Auditoria:** 133 `conta_recorrente.criada` e 133 `conta_recorrente.ocorrencia_gerada`.
- **Fluxo de caixa:** as previsões da planilha passaram de 2.433 (R$ 96.335.662,64) para 2.062 (R$ 95.214.581,24). Saíram, de CF, DA e DM do 4T: novembro 123 (R$ 422.467,41), dezembro 127 (R$ 429.502,32) e janeiro 121 (R$ 269.111,67). Ficaram as contas de outubro (3T) com data em novembro, 25 previsões (R$ 31.371,23), e as de CF, DA e DM que não estão na relação. Pela recorrência entram R$ 454.963,62 por mês: o título em novembro e a previsão calculada depois, com uma linha por regional do rateio.
- **Tela:** a aba Recorrências mostra 133 e os Títulos a Pagar passaram de 94 para 227.
- **Desempenho:** `count(*)` da `vw_fluxo_caixa` em 256 ms. A busca da recorrência custa cerca de 0,004 ms por previsão.

## O que fica para depois

- **Data de fim:** duas linhas de R$ 75.000,00 (uma na California, outra na CCH) aparecem na planilha em novembro e dezembro, mas não em janeiro. A recorrência prevê para frente sem fim até alguém pôr a `data_fim`.
- **Fornecedores:** cadastrar os 70 que faltam e ligá-los às recorrências, para pagar por remessa.
- **Valor variável:** contas de consumo (energia, água) mudam todo mês. A recorrência repete o valor de novembro, e o título de cada mês é corrigido na tela quando a conta chega.
