# 223 — Comitê de Aprovações

**Data:** 2026-10-27
**Status:** implementada em 27/10/2026.
**Quem decidiu:** Tiago. Pedido em 27/10/2026: um módulo para o Comitê
aprovar o que hoje só o administrador aprova (decisão 204). Protótipo
aprovado no mesmo dia, depois de 37 versões comentadas
(https://claude.ai/artifact/3VMHDYKFYWdwiESSyYioc1): "Tudo aprovado. Pode
implementar [...] Nome: comitê de aprovações. Caixa de entrada: C."
**Revê:** a [204](204-administrador-nas-excecoes-do-orcamento-e-da-pp.md): o "só o
administrador" passa a ser "o Comitê" (o administrador continua aprovando
direto enquanto a regra dele estiver ligada).
**Migrations:** `20261027970001_comite_de_aprovacoes.sql` e
`20261027970002_comite_valor_do_job_no_retrato.sql`.

## O que vai ao Comitê

As regras ficam em **Comitê de Aprovações → Configurações** (tabela
`comite_config`, uma linha por tenant; sem linha, os padrões). Os padrões
reproduzem a 204 de antes:

| Regra | Padrão | Quando |
|---|---|---|
| Resultado geral abaixo do mínimo | ligada, 20% | aprovar a versão |
| Planejado acima do orçado | ligada | aprovar a versão |
| Realizado acima do orçado | ligada | gerar ou editar a PP |
| PPs em linhas vermelhas | **desligada** | gerar ou editar a PP |
| Tolerância para excesso pequeno | desligada | gerar ou editar a PP |
| O administrador aprova direto na tela | ligada | as duas |

A linha vermelha nasce desligada porque, desde `20261027950001`, ela já
estava fora do limite da PP (o protótipo dizia o contrário; corrigido na
implementação). O serviço Interno (decisão 105) continua fora.

## Quem decide

- **Membros** (`comite_membros`) e **administradores**. Basta um. O
  administrador vê o módulo sempre, mesmo sem ser membro — sem isso ninguém
  conseguiria cadastrar o primeiro membro.
- Membros e administradores alteram as regras e a lista de membros.
- Freelancer não entra como membro.
- O módulo fica na barra lateral entre Jobs e Desembolsos, só para quem
  decide.

## O caminho

**Versão (GP).** Na barra de baixo da versão, quando uma regra ligada pega,
"Aprovar versão" vira **Solicitar aprovação**, com o quadro do motivo (os
itens acima do orçado e/ou o resultado) e o campo **Motivo \***. Enviada, a
versão fica **aguardando aprovação** e só leitura — itens, grupos e
parâmetros travados também no banco (`comite_trava_versao_pendente`) —, e a
barra oferece **Cancelar envio**. Nenhuma versão nova enquanto ela aguarda.
Devolvida, aparece o comentário de quem decidiu e a versão volta a ser
editável. Aprovada pelo Comitê, a versão fica aprovada em nome de quem
decidiu e o GP segue com o envio para a abertura.

**PP (produção).** No formulário da PP, quando o realizado do item com a PP
passa do orçado, "Gerar PP" vira **Solicitar aprovação**: salva a PP a
emitir e a envia ao Comitê com o motivo. O cartão dela no painel do item
mostra **Aguardando aprovação** (sem lápis nem lixeira; só o ícone de
cancelar o envio), **Devolvida pelo Comitê** (com o comentário e o
"Solicitar aprovação" de novo) ou **Aprovada pelo Comitê — já pode
gerar**. O Comitê não gera a PP: aprovada, a produção gera.

**A caixa (C).** Duas abas, **Aberturas de job** e **PPs**, com Para
decidir / Aprovados / Devolvidos / Todos, busca, filtro e ordem pelos
títulos e a coluna **Motivo**. A linha abre a planilha do caso num pop-up
de tela cheia — a própria página do orçamento ou do job, só leitura, com
quem enviou e o motivo em cima e a barra de decisão embaixo. Na versão:
Devolver ao GP / Aprovar versão. Na PP: Abrir menu de PPs / Abrir PP; com a
PP aberta (consulta resumida, só leitura), Devolver / Aprovar. Devolver
pede comentário; aprovar mostra o quadro do motivo e aceita comentário
opcional.

## Volta ao Comitê só se piorar

Pedido do Tiago: se o financeiro devolver depois do Comitê e a versão ou a
PP precisar de alteração, ela só volta ao Comitê se a situação piorar.

- **Versão:** vale o último pedido aprovado do **orçamento**. Cobre a
  versão enquanto ela não tiver **mais itens** com planejado acima do
  orçado nem **Resultado geral menor**. Coberta, o GP aprova direto.
- **PP:** vale o maior valor aprovado para a PP — ou para a PP que ela
  refaz, pela cadeia de `pedidos_compra_a_emitir.refaz_pp_id` ("Editar e
  Reemitir"). Gera ou edita direto enquanto **não ficar mais cara**.
- A PP **gerada** não vai ao Comitê (o pedido nasce da PP a emitir): a
  edição que a deixaria acima do aprovado é recusada, com a orientação de
  cancelar e refazer como PP a emitir.

## Onde mora

- Banco: `comite_config`, `comite_membros`, `comite_pedidos` (com o
  retrato dos números no envio e na decisão), `comite_regras`,
  `pode_decidir_no_comite`, `versao_limites`, `comite_situacao_da_versao`,
  `comite_pp_aprovada`. Os gatilhos da 204
  (`versao_confere_limites_na_aprovacao`, `pp_confere_orcado_na_geracao`)
  passam a ler as regras e as aprovações do Comitê.
- Regras puras e testes: `lib/calculos/limites-orcamento.ts`.
- Leituras: `lib/data/comite.ts`. Ações: `app/(app)/comite/actions.ts`,
  `solicitarAprovacaoDaVersao` e `aprovarVersaoPeloComite`
  (`orcamentos/.../versoes/actions.ts`), `solicitarAprovacaoDaPP`
  (`jobs/[jobId]/realizado/actions-pp.ts`).
- Auditoria: `comite.pedido_enviado`, `comite.pedido_aprovado`,
  `comite.pedido_devolvido`, `comite.envio_cancelado`,
  `comite.regras_alteradas`, `comite.membro_adicionado`,
  `comite.membro_removido`.

## Fora, por ora

- Aviso a quem enviou quando o Comitê decide: o sistema não tem
  notificação; a decisão aparece na tela da versão e no cartão da PP.
- A coluna "Resultado do job antes → depois" da caixa de PPs do protótipo.
- O vermelho do Resultado geral nas telas segue em 20%; o mínimo
  configurável vale só para o que vai ao Comitê.
