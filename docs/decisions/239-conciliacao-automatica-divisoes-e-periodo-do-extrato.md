# 239 — Conciliação automática: divisões fechadas e lembradas, o extrato novo aberto, tudo conciliado e o período do extrato

**Data:** 2026-11-05
**Status:** aceita e implementada em 05/11/2026; pontos 1 e 2 revistos em 06/11/2026 (as divisões abrem sempre fechadas, sem lembrar o que foi aberto).
**Quem decidiu:** Tiago, em 05/11/2026, revisando no protótipo do módulo financeiro os pontos 0 a 6 ("Pronto! Aprovado. Pode implementar.").
**Revê:** a [234](234-revisao-do-financeiro-pelo-prototipo.md), D6 (a fila dividida nascia com tudo aberto, menos "Baixas à mão que bateram" e "Conciliados") e a seleção de todas pelo cabeçalho.

## O problema

Com um extrato grande (no Santander, 47 linhas em "Conferir antes" e 162 em "Sem correspondência"), abrir as divisões deixava a página enorme. A barra "N de M conciliados" e a divisão Conciliados seguiam o filtro De/Até da tela, que fica no mês atual: um extrato de agosto a outubro, quase todo conciliado, aparecia como "1 de 218". Com tudo conciliado sobrava só o cabeçalho da tabela, sem dizer o que fazer depois.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| 0 | Importar | O texto da área de importar ficou numa linha: "Exportado do internet banking, só da <conta>. Linhas repetidas não entram, e o que é certo se resolve sozinho." |
| 1 | Divisões | Nascem todas fechadas. **Revisto em 06/11/2026:** abrem sempre fechadas, ao abrir a aba, ao sair e voltar e ao trocar de conta; a tela não lembra mais o que foi aberto. Antes, ela lembrava, por conta e no navegador, as que a pessoa deixou abertas |
| 2 | Extrato novo | **Revisto em 06/11/2026:** o extrato que acabou de chegar também encontra todas as divisões fechadas. Antes, ele abria uma vez as divisões com linhas pendentes dele, com a faixa "<arquivo> acabou de chegar" |
| 3 | Sair e voltar | Sem mudança: a fila vem do banco (as pendentes de todas as importações), não do arquivo |
| 4 | Tudo conciliado | Faixa verde "Tudo conciliado no extrato de … a …", se o saldo bate, e o próximo passo: fechar a conciliação e importar o extrato a partir do dia seguinte (do próprio dia, se o arquivo foi gerado nele, porque o dia ainda não estava completo). O botão de importar vai para a faixa. Com a conciliação já fechada até o fim do extrato, a faixa diz "Fechada até …". A tabela continua com Conciliados, fechada. A tela não volta à da primeira importação: ainda há fechamento, Desfazer e a data de onde começa o próximo arquivo |
| 5 | Período | Na Conciliação automática, as resolvidas (Conciliados e o "N de M") são as do período do último extrato, e não as do filtro De/Até, que continua valendo para o Extrato. Embaixo da barra: "no extrato de … a …" |
| 6 | Cabeçalho | O "marcar todas" saiu (cada divisão tem o botão de todas, e as que pedem conferência não entravam nele). No lugar, o ícone de expandir / recolher todas as divisões. As caixas de cada linha (Prontos e Baixas à mão) continuam, com "Conciliar selecionados" |

## Como fica no código

- `fila-dividida.tsx`: o estado das divisões (todas fechadas ao montar, ao trocar de conta e ao chegar extrato; sem `localStorage`, e as chaves que a 239 gravava são apagadas na primeira visita), a faixa de tudo conciliado e o botão do cabeçalho.
- `banco-dados.ts`: `periodoDoExtrato` troca o De/Até das resolvidas pelo período da importação mais recente (uma consulta pequena antes das outras, só na aba).
- `page.tsx` liga o `periodoDoExtrato` na aba Conciliação automática; `aba-banco.tsx` passa `fechadaAte` e o texto curto da área de importar.
- Sem migration: `vw_extrato_linhas` já tem `importacao_id`.

## Revisão de 06/11/2026 (ponto 2)

Tiago, revendo a fila no protótipo: "ao importar o ofx, todos os agrupamentos virem fechados. Acho que ficará melhor". O título e a contagem de cada divisão já dizem o que há para fazer; abrir as do arquivo novo deixava a página longa logo na chegada. A faixa "acabou de chegar" e `LinhaDoBanco.importacaoId`, que só serviam a isso, saíram.

Depois, no mesmo dia, sobre o ponto 1: "ao sair e voltar os agrupamentos devem ocultar suas linhas novamente". A lembrança saiu: com as divisões fechadas sempre, quem abre a aba vê a mesma tela, e uma divisão aberta sem motivo aparente (o que aconteceu no protótipo) não se repete.

## Ponto em aberto

- Com uma última importação muito curta (um dia só, como na Conta Teste), o período do ponto 5 fica curto: as conciliadas de importações anteriores somem dos Conciliados. Se incomodar, o período pode passar a ser o de todas as importações com linha pendente.
