# 248 — O "Exibir" do Resultado de Job, o prazo de pagamento e os saldos e prazos numa faixa

**Data:** 2026-11-09
**Status:** aceita e implementada em 09/11/2026.
**Quem decidiu:** Tiago, em 09/11/2026, revisando o protótipo do módulo financeiro, e em seguida: "Pode implementar tudo que fizemos aqui".
**Complementa:** a [207](207-resultado-de-job.md) (Resultado de Job e Visualizar Jobs são a mesma lista), a [234](234-revisao-do-financeiro-pelo-prototipo.md) (Empresa e Regional) e a [075](075-a-esteira-reconhece-a-nota-pelos-itens.md) (os prazos do job).
**Migration:** `20261109950001`.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | Serviço e Status | A coluna Serviço logo depois do Nome. O status vira a coluna Status, a última; o selo sai de junto do nome. Todo job mostra o status, inclusive "Aberto" |
| D2 | Cancelamento solicitado | Não aparece na coluna Status: enquanto o cancelamento não é efetivado, o job continua Aberto |
| D3 | Recolher todos | "Recolher todos / Expandir todos" no canto esquerdo da linha do "Organizar por", só em "Por projeto". Com filtro, some (as faixas ficam abertas) |
| D4 | Exibir | Ao lado de "Organizar por", liga e desliga as colunas por grupo (Job, Pessoas, Datas, Valores, Prazos, Faturamento), com "Todas" e "Padrão". Código e Nome ficam sempre. Com muitas colunas, a tabela rola para o lado. A escolha fica guardada por tela, no navegador |
| D5 | As colunas | Serviço, Categoria, Cliente, Marca, Projeto (só "Por job"), GP responsável, Produtor responsável, Abertura, Data do evento, Período, Competência, Valor do Job, Faturamento, Desembolsos, Custo, Impostos, Alíquota, Rentabilidade, Valor recebido, Data de recebimento, Prazo de recebimento, Prazo de pagamento, Nº da NF, Data de faturamento, Empresa, Regional e Status. Nascem ligadas as de antes, mais Serviço, Categoria, Produtor responsável, Desembolsos, Impostos, Alíquota e Status |
| D6 | Planejado até o realizado | Como na previsão do fluxo de caixa, o planejado vale até o realizado ser assegurado, quando ele troca. **Custo:** linha a linha da planilha do job, a linha com as PPs concluídas vale o realizado (mesmo abaixo do planejado); a aberta, o planejado, ou o realizado se já passou dele; em A e D o realizado é o orçado. Na Mídia Off, o maior entre o planejado e o realizado do job. **Impostos:** o previsto até o job ser faturado; faturado, os das notas. A Rentabilidade continua no planejado |
| D7 | Datas | **Data de recebimento:** a próxima data prevista (título em aberto ou previsão da abertura) ou, com tudo recebido, a do último recebimento, com "previsto" ou "recebido". **Data de faturamento:** a emissão da primeira nota; vazia sem nota |
| D8 | Prazo de pagamento | Da abertura até a data média dos pagamentos do job, ponderada pelo valor: o que já saiu da conta (na data do pagamento), as PPs em aberto (no vencimento) e o cronograma de desembolsos ainda sem PP (na data prevista). Sem impostos. Entra como 4º prazo na aba Fluxo de Caixa do Job (e na visão agregada do projeto) e como coluna da lista |
| D9 | Saldos e prazos numa faixa | Na aba Fluxo de Caixa do Job, os dois saldos e os quatro prazos viram uma faixa só, seis números lado a lado |
| D10 | Títulos de duas linhas | Nas colunas de valor (alinhadas à direita), as duas linhas do título começam no mesmo ponto, como nas colunas à esquerda. Vale para todas as listas com filtro por coluna |

## Como fica no código

- A lista lê tudo somado por job, nada das linhas cruas do fluxo (`docs/PERFORMANCE.md`): `vw_fluxo_caixa_job_datas` (nova, a data média dos pagamentos e a próxima e a última data de recebimento, com o recorte da `vw_fluxo_caixa_job_totais`), `vw_job_rentabilidade` (imposto realizado) e `vw_parametros_do_job` (alíquota). O custo sai de `rentabilidadeDosJobs`, que já lia as linhas do orçado e passa a ler também o realizado (em páginas de 1.000). A data da primeira nota vem de `faturamentoPorJob`. O prazo de recebimento é o de `carregarPrazosDosJobs`, numa segunda rodada (ela precisa dos ids da lista).
- O card "Pagamento" do Fluxo de Caixa do Job faz a mesma conta da view sobre as linhas do job, que a aba já lê.

## Fora desta decisão

- O status `em_producao` não ocorre mais (nenhum job nele, nenhuma tela grava), mas continua no tipo do banco e em uns 19 arquivos. Tirar de vez é mudança destrutiva, à parte.
- Fora desta lista, o selo "Cancelamento solicitado" continua nas telas de jobs e na fila de abertura.
