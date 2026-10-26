# 207 — Resultado de Job: Valor do Job, Faturamento e Rentabilidade nas listas do financeiro

**Data:** 2026-10-23
**Status:** aceita e implementada em 23/10/2026.
**Quem decidiu:** Tiago, no protótipo "Resultado de Job" (19 a 21/10/2026,
comentários no próprio protótipo) e nas respostas de 22 e 23/10/2026.
**Migrations:** nenhuma.

## O pedido

1. Um módulo novo na Central Financeira, **Resultado de Job**, com a mesma
   lista da aba "Visualizar Jobs" da Abertura de Job. O cartão fica **logo
   ao lado de Abertura de Job** (o segundo da grade; de Contas a Pagar em
   diante, todos descem uma casa).
2. As colunas de valor passam a ser **Valor do Job**, **Faturamento** (sem o
   selo da esteira) e **Rentabilidade**. Recebimentos e Custos saem.
3. A troca vale **para as duas telas**: Resultado de Job e Visualizar Jobs.

## A regra

1. **Cartão e rota.** `/financeiro/resultado-de-job`, ícone de gráfico de
   pizza, sem contagem (não é fila). Abre para administrador e financeiro,
   como a Central. A página é a lista (`JobsAbertosList`) sem abas, com a
   carga da Abertura (`listarJobsDoFinanceiro`).
2. **Colunas das duas listas:** Código, Nome, Projeto, Cliente, GP
   responsável, Abertura, **Valor do Job**, **Faturamento**, **Rentabilidade**
   (na arrumação "Por job", sem a coluna Código, como antes).
3. **Valor do Job** é a coluna que se chamava "Valor total"
   (`jobs.valor_total`, o espelho do valor do job na conta do financeiro).
4. **Faturamento** mostra o mesmo valor de antes (nota emitida, senão o
   enviado, senão o previsto), **sem o selo** da esteira e sem o "venceu
   em". O número da NF continua embaixo. A situação segue nos chips de cima
   (Aguardando faturamento, Faturado, Liquidado, Inadimplente), e o filtro
   do título da coluna passou a ser por faixa de valor.
5. **Rentabilidade é a mesma do job.** "Não podemos ter rentabilidade se
   referindo a coisas diferentes em um mesmo sistema" (Tiago, 23/10/2026).
   É **valor do job − impostos − custo planejado**, na conta do financeiro:
   o número da "Rentabilidade" do registro da abertura e do "Resultado Op.
   (Planejado)" do cabeçalho da página do job. Em R$, em grafite (positiva
   ou negativa, como nas planilhas), e embaixo em % do valor do job, com
   duas casas, como no registro. Job sem a conta feita mostra travessão.
6. **Faixa do projeto:** quantos jobs, o valor do job somado, **Faturamento**
   e **Rentabilidade** somados, e o "Visão agregada".
7. **Linha de totais:** Faturado, Aguardando faturamento, Liquidado e
   Inadimplente como antes, **Rentabilidade** (R$ e % sobre o valor dos jobs
   que têm a conta) e **Valor do Job**.
8. **Excel:** "Valor total" vira "Valor do Job"; as seis colunas de caixa
   (Recebimentos, Recebido, Situação dos recebimentos, Custos, Custos
   realizados, Situação dos custos) dão lugar a **Rentabilidade** e
   **Rentabilidade (%)**. O nome do arquivo segue a tela ("Jobs no
   financeiro" ou "Resultado de Job"). Situação do faturamento, NF e
   vencimento continuam no arquivo.
9. Cada tela guarda os próprios filtros dos títulos
   (`filtro-de-coluna:abertura-visualizar-jobs` e
   `filtro-de-coluna:resultado-de-job`).

## Como a conta é feita, para não divergir da página do job

A página do job monta a Rentabilidade com leituras de UM job. A lista faz a
mesma conta para todos, com as **mesmas funções**, e só as leituras mudam
(`lib/data/rentabilidade-dos-jobs.ts`):

| Parte | Página do job | Lista |
|---|---|---|
| Valor do job e impostos | `resumoComoOFinanceiroVe` → `totaisDoFinanceiro` | `montarBaseDosEspelhos` → `totaisDoFinanceiro` |
| Custo planejado | `carregarDetalheDoJob`: `planejadoBrutoDoItem` por linha; na Mídia Off, `fechamentoDosItens` | o mesmo |
| Planejado zerado por pedido de gerar save que aguarda | `resumoComoOFinanceiroVe` | o mesmo (`linhasComPlanejadoDevolvido`, `planejadoAntesDoSave`) |
| R$ e % | `rentabilidadeDoJob` (registro da abertura) | `rentabilidadeDoJob` |

- `lerBaseDosEspelhos` ganhou a parte pura `montarBaseDosEspelhos`, que a
  lista chama com as linhas lidas em lote. `pedidosParaFinanceiroDoTenant`
  lê os pedidos de save de todos os jobs de uma vez.
- Leituras: os jobs da lista (o mesmo select dos espelhos), as linhas de
  `jobs_itens_orcado` do tenant e os pedidos de save que aguardam, numa
  rodada só, em paralelo. As linhas vêm em páginas de 1.000 (teto do
  PostgREST), quatro pedidas de saída; se a última vier cheia, segue até a
  que não enche. Contar as linhas antes (`count: "exact"`) custava mais que
  as páginas.
- Em 23/10/2026: 2.335 linhas no tenant, 1.718 dos 95 jobs da lista. Na
  máquina de desenvolvimento, com o banco remoto, a lista levou cerca de
  1,1 s com a conta, contra 0,4 a 1,0 s sem ela; o cálculo em si leva
  cerca de 10 ms.

## Conferência (23/10/2026)

- A Rentabilidade da lista bateu, em R$ e em %, com a do registro da
  abertura na página do job, em nove jobs: nacional (2GB-1002/26,
  BOC-1003/26), com linha em save (TES-1030/26), faturado em parte
  (TES-1001/26), com imposto efetivo fora dos 19,53% (AMB-1010/26), Mídia
  Off (TES-1026/26), mensal (ANI-1001/26, TES-1002/26) e zerado
  (TES-1024/26).
- Nas 95 linhas, o % da coluna bate com Rentabilidade ÷ Valor do Job: o
  espelho `jobs.valor_total` é o mesmo valor do job que a conta usa.
- Nenhum job internacional nem pedido de save aguardando existia no dia; os
  dois caminhos passam pelas mesmas funções da página.

## O caminho até aqui

No protótipo, a coluna Custos virou primeiro **Desembolsos** (custos do
fluxo de caixa + imposto previsto na abertura), e a Rentabilidade saiu como
Faturamento − Desembolsos. Duas perguntas mudaram isso:

- **Imposto do job.** O Tiago descreveu a regra: a previsão de impostos da
  abertura vale até o faturamento; a parte proporcional ao que foi faturado
  sai da previsão e vira título pelo valor real da nota × a alíquota do job.
  Fica **registrada para quando Desembolsos voltar a alguma tela**: a
  previsão que sobra já existe (`cronogramaQueSobra`, `lib/fiscal/fluxo-fiscal.ts`),
  e a alíquota do job é a efetiva da previsão (imposto previsto ÷
  faturamento previsto): 19,53% na maioria, 2,72% no AMB-1010/26, onde o
  imposto incide só sobre os honorários. Hoje o imposto de uma nota vira
  guia da empresa no Fiscal, sem ligação com o job.
- **Base da Rentabilidade.** Com Faturamento − Desembolsos, os 3 jobs
  faturados em parte perdiam R$ 363.847,10 ainda a faturar. A resposta foi
  usar a Rentabilidade do próprio job (regra 5), e as colunas Desembolsos e
  Recebimentos não entraram.

## Fora desta decisão

- O relatório **Rentabilidade de Jobs** (Relatórios, `vw_job_rentabilidade`)
  usa outra conta: faturamento previsto e realizado, imposto, custo
  realizado e BV. Pelo mesmo princípio da regra 5, os números dele divergem
  dos da lista e do job. Alinhar o relatório fica para uma decisão própria.
- O Calendário de Jobs continua somando os custos do fluxo de caixa
  (`custos`), que seguem na linha da lista para ele.
