# 242 — As PPs a emitir no Comitê na aba PPs, os filtros com número e o fim dos cartões

**Data:** 2026-11-06
**Status:** aceita e implementada em 06/11/2026.
**Quem decidiu:** Tiago, em 06/11/2026, no protótipo "PPs no Comitê" ("Aprovado. Proposta A. Filtros 1 Etapas em sequência. Pode implementar"), depois de sete rodadas de comentário.
**Origem:** pedido da produção: "Teria como criar uma aba ou algum local em que a gente pudesse visualizar as emissões de PPs que estão pendentes aprovação do comitê? … Só entrando no item pra saber se já foi solicitado algo ou não."

## O problema

- A PP a emitir que vai ao Comitê (decisão 223) ainda não é PP: não tem código e não aparecia na aba "Pedidos de Produção (PPs)". Para saber o que estava em avaliação, devolvido ou aprovado, era preciso abrir o painel de cada item na Planilha Interna.
- Os quatro cartões do topo da aba (PPs geradas, Em avaliação, Pagas, Total em PPs) repetiam os filtros sem dizer o que pedia ação.
- Só dois filtros mostravam quantas PPs tinham ("Pronta para envio" e "Aguardando prestação").

## Decisões

| # | Tema | Decisão |
|---|---|---|
| 1 | Cartões do topo | Saem. O "Total em PPs" vira o pé da tabela: "Total · N PPs" e o valor, que acompanha o filtro e os filtros dos títulos. Canceladas não somam. Com o filtro Comitê, soma as PPs a emitir dele ("N PPs a emitir") |
| 2 | Barra de filtros | Um controle só, na ordem do caminho da PP: Todas │ Comitê › Gerada › Em avaliação › Pago │ Prestar contas · Rejeitado · Cancelada. Todo filtro mostra o número de PPs, inclusive o zero (apagado). O número do Comitê fica em âmbar enquanto houver PP em avaliação. As setas ← → (e Home/End) trocam o filtro |
| 3 | Filtro Comitê | As PPs a emitir com pedido ao Comitê, no último pedido (o cancelado não conta): em avaliação, devolvida e aprovada ainda não gerada. A aprovada sai do filtro quando vira PP. "Todas" inclui essas linhas |
| 4 | "Pronta para envio" | Deixa de ser filtro: é uma Gerada. Fica só a marca embaixo do selo GERADA, agora no vermelho do botão de enviar (o âmbar ficou com o Comitê) |
| 5 | "Aguardando prestação" | O filtro passa a se chamar "Prestar contas". O que ele mostra não muda (decisões 081 e 216) |
| 6 | A linha da PP a emitir no Comitê | Na tabela de sempre, em cima. Código: o selo "PP a emitir". Status: "Em avaliação no Comitê" (âmbar, com "desde dd/mm/aaaa"), "Devolvida pelo Comitê" (vermelho, "corrigir e reenviar") ou "Aprovada pelo Comitê" (verde, "pronta para gerar"; "acima do aprovado" quando foi editada para mais que o valor aprovado). A dica do selo diz quem enviou, quando, o motivo e a resposta do Comitê. Sem documento ainda, a coluna do olho e do baixar fica vazia |
| 7 | Ações da linha | As do cartão da PP a emitir no painel do item, na trilha da direita: em avaliação, só "Cancelar envio"; devolvida, editar, "Solicitar aprovação de novo" (o mesmo pop-up do motivo, já preenchido) e excluir; aprovada, editar, "Gerar PP" (a mesma revisão) e excluir. A aprovada que ficou acima do aprovado pede a aprovação de novo. Gerar e solicitar ficam fechados antes da abertura do job, com o motivo na dica. Quem não gera PP vê as linhas sem as ações |
| 8 | Nome do estado | "Em avaliação no Comitê" no lugar de "Aguardando aprovação", também no cartão do painel do item |

## O que não muda

- Decidir (aprovar ou devolver) continua só no módulo Comitê, por membro do Comitê ou administrador. O protótipo mostrou "Devolver e aprovar" na linha como opção; ficou de fora.
- O número ao lado do nome da aba ("Pedidos de Produção (PPs)") segue contando as PPs geradas não canceladas.
- A PP a emitir que não passou pelo Comitê continua só no painel do item.

## Como fica no código

- `jobs/[jobId]/page.tsx`: monta `ppsNoComite` com as PPs a emitir abertas (`aEmitirPorItemId`) que têm pedido em `comiteDaPP.pedidos`, o nome do item e do bloco e `acimaDoAprovado` (`ppCobertaPeloComite`). Prop obrigatória `noComite` da `JobPPsSection`.
- `pps/job-pps-section.tsx`: as linhas do Comitê entram na mesma lista (`linhaDaPPNoComite`) e passam pelos mesmos filtros de coluna e busca; `passaNoFiltro` faz a conta da lista e do número de cada filtro; `BarraDeFiltros` (tablist); `SeloDoComite`; `AcoesDoComite`; o pé da tabela; os pop-ups `SolicitarAprovacaoDialog` e "Excluir a PP a emitir?". Saem `CardResumo` e os filtros "Pronta para envio".
- `realizado/painel-pps-item.tsx`: o selo "Em avaliação no Comitê".
- Sem migration. As ações usam as Server Actions que o painel do item já usa (`cancelarEnvioAoComite`, `solicitarAprovacaoDaPP`, `excluirPPAEmitir`, `gerarPPDaPPAEmitir`), com as mesmas travas no servidor.
