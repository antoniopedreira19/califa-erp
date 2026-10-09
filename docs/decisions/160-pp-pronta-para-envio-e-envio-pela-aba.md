# 160 — A PP fica "Pronta para envio", e o GP a envia pela aba Pedidos de Produção

**Data:** 2026-10-09
**Status:** aceita e implementada (09/10/2026).
**Quem decidiu:** Tiago, de 08 a 09/10/2026, sobre o protótipo "Envio pela aba PPs" (5 versões), depois do relato de um GP que "não conseguia enviar uma PP gerada por um produtor".
**Completa:** a [136](136-qualquer-gp-age-e-o-autor-fica-registrado.md) (o produtor gera, só o GP e o administrador enviam), a [152](152-nf-do-fornecedor-com-cadastro-proprio.md) (os documentos do fornecedor entram no envio) e a [153](153-pp-a-emitir.md) (a PP gerada não se edita). A [159](159-errata-pronta-para-envio.md) fez o mesmo desenho para a errata, com o mesmo nome.
**Migration:** `20261009100001_pp_pronta_para_envio.sql`.

## O que aconteceu

O relato veio com a foto do painel do item mostrando "Só o GP envia PP ao
financeiro" e o botão apagado. Não era defeito: a foto era da tela da
produtora, e nada no servidor barrou a GP do job. Mas o banco mostrou o
problema de verdade: em 08/10/2026 havia 14 PPs geradas paradas no job, 7
delas do produtor, algumas desde 01/10. O envio só existia no painel do item,
na Planilha Interna, e nada avisava o GP de que havia PP esperando por ele.

## A regra

1. **O produtor e o freelancer deixam a PP pronta para envio**, no painel do
   item (Planilha Interna), no lugar do "Enviar ao financeiro" apagado. O
   botão "Deixar pronta para envio" abre o MESMO pop-up do envio, com as
   mesmas regras (o tipo de cada arquivo e os dados de cada NF obrigatórios,
   decisão 152), e em vez de mandar ao financeiro grava os documentos e a
   marca. A PP continua "gerada".
2. **Quem preparou pode mexer até o GP enviar**: o botão vira "Editar
   conferência" e reabre o pop-up com o que foi gravado. Cancelar segue como
   era (o produtor cancela a PP gerada).
3. **O GP envia pela aba Pedidos de Produção** (e pelo painel do item, como
   antes). O pop-up abre já preenchido com o que o produtor conferiu; o GP vê
   a NF ao lado da PP ("Verificar"), corrige se precisar e envia. O GP também
   envia PP que ninguém preparou, preenchendo ele mesmo.
4. **O botão de envio da aba só aparece para quem envia** (GP e
   administrador) e **só na PP gerada com algum arquivo anexado** — com ou
   sem tipo; quando o arquivo vem marcado como NF, os dados chegam
   preenchidos e se corrigem no pop-up. A verba de produção sai sem nota.
   Com o job na pré-abertura, a abertura em revisão (decisão 040) ou o prazo
   de envio perdido (decisão 157), o botão aparece apagado e o motivo vem no
   tooltip, nas mesmas frases do painel.
5. **Ficam para o envio**, que é quando o GP decide: o "tem certeza?" acima
   do planejado, o da nota em outro CNPJ (decisão 156), o prazo de envio, a
   abertura em revisão e a ligação das NFs ao cadastro de notas
   (`ligar_notas_fiscais_da_pp`). Deixar pronta não manda nada ao financeiro.

## Na tela

### Aba Pedidos de Produção

- **Trilha só de ícones**, fora da tabela: enviar (avião), ver o formulário
  e cancelar (o mesmo círculo com X do painel — lá a lixeira é de excluir a
  PP a emitir). Cada linha mostra só os que valem, colados, sem lugar vazio
  (o Tiago preferiu isso a uma ordem fixa com o envio no fim). "Prestar
  contas" segue com texto.
- **Ver formulário**: a ficha em leitura do "Ver formulário" do painel
  (`VerPPDrawer`), com o "Visualizar" no rodapé. Para a PP gerada, o
  subtítulo diz "a PP gerada não se edita mais; os documentos do fornecedor
  entram no envio".
- **O olho** abre a PP ao lado dos documentos, na tela do Contas a Pagar em
  leitura (a mesma do "Visualizar"). Antes abria o PDF da parcela numa aba
  nova.
- **"Pronta para envio"** embaixo do status, em âmbar (o mesmo selo da
  errata, decisão 159), um chip de filtro com esse nome e a contagem no
  cartão do topo ("3 aguardando envio · 2 prontas").
- **Filtro e ordem pelo título de cada coluna, como no Excel**
  (`components/ui/filtro-de-coluna.tsx`): as duas ordens da coluna, a busca
  dentro dela (sem acento) e a lista de valores com quantas linhas tem cada
  um. Uma coluna ordena por vez. Na **Origem no job**, a lista é uma árvore
  de blocos com os itens dentro — o mesmo nome de item em dois blocos fica
  separado —, e a etiqueta do bloco na linha filtra por ele. O **Valor**
  filtra por faixa ("de / até"). A busca geral ficou, e uma barra "Mostrando
  X de Y linhas · Limpar filtros e ordem" aparece com algum filtro ou ordem.
  Com filtro ou ordem, os ícones de uma PP vão para a primeira linha dela que
  está na tela. Os chips de status continuam e se somam aos filtros; os
  cartões do topo seguem com o total do job.

### Painel do item e pop-up de envio

- No painel, o aviso do produtor passou a dizer o caminho: "Confira os
  documentos e deixe a PP pronta para envio: o GP a envia pela aba Pedidos
  de Produção". A PP pronta mostra "Pronta para envio · quem · quando".
- No pop-up (o mesmo na aba e no painel): "Voltar" no canto inferior
  esquerdo e **"Verificar"** — a PP, os documentos e os dados lado a lado —
  ao lado do envio, no lugar do antigo "Ver PP e documentos lado a lado".

## No banco

- `pedidos_compra.pronta_para_envio_em` e `pronta_para_envio_por` (FK para
  `profiles`), nulas, sem backfill. Sem status novo: ele mexeria nos filtros
  do financeiro, na conta do realizado e no código da outra frente.
- Gatilho `trg_pp_carimba_pronta_para_envio`: só aceita a marca na PP gerada
  e grava quem e quando pelo usuário da sessão, não pelo que a tela mandar.
- Action `deixarPPProntaParaEnvio` (gates de `checarGatesRealizado`, regras
  de anexo do envio, auditoria `pedido_compra.pronta_para_envio`).

## Fora daqui, de propósito

- Um passo "Pronta para envio" na linha do tempo do "Ver PP" (sugerido, não
  confirmado).
- Aviso ao GP fora da página do job (lista na home, notificação).
- O "Cancelar e refazer" da PP rejeitada é mais largo que a coluna de ações e
  cobre o selo "Rejeitado" — defeito anterior, anotado, não corrigido aqui.
- Alternativas que o Tiago viu e recusou: coluna "Bloco" própria (apertava
  o Serviço e fundia itens de mesmo nome) e trilha com ordem fixa.

## Testes

Ver a nota de 2026-10-09 no [HANDOFF_JOBS](../handoffs/HANDOFF_JOBS.md).
