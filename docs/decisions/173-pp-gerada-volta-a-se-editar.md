# 173 — A PP gerada volta a se editar, no lugar

**Data:** 2026-10-13
**Status:** aceita e implementada (13/10/2026).
**Quem decidiu:** Tiago, em 13/10/2026, depois do relato de uma produtora
que não conseguia anexar a NF de uma PP já gerada nem mudar o parcelamento
de outra.
**Revê:** a [153](153-pp-a-emitir.md), na parte "a PP gerada não se edita
mais". A PP a emitir, a revisão antes de gerar e o "Cancelar e refazer" da
rejeitada continuam como estão.
**Completa:** a [160](160-pp-pronta-para-envio-e-envio-pela-aba.md) (a
marca "Pronta para envio").
**Migration:** `20261013950001_pp_gerada_volta_a_se_editar.sql`.

## O que aconteceu

Em 09/10 e em 13/10/2026, duas produtoras travaram no mesmo ponto: a PP
estava gerada, faltava a NF (ou o parcelamento mudou) e não havia como mexer.
A ficha da aba Pedidos de Produção dizia "a PP gerada não se edita mais", e o
painel do item nem abria o formulário da PP aguardando envio. O Tiago
perguntou por que, e pediu o ajuste.

## A regra

Respostas do Tiago às três perguntas de 13/10/2026 (todas na opção
recomendada):

1. **A PP gerada se edita no lugar, com o mesmo código.** O lápis abre o
   mesmo formulário da PP a emitir, com os dados e os anexos da PP. Salvar
   passa pela revisão antes de gravar ("Salvar as alterações da PP-…?"), o
   PDF é refeito por cima do anterior (com a data de emissão de antes) e a
   linha do tempo ganha "Editada".
2. **Tudo se edita:** fornecedor, empresa emissora, valor, parcelas,
   vencimentos, serviço, especificações, urgência e anexos (com os dados da
   NF). Os dados de pagamento do fornecedor são congelados de novo, como na
   geração (decisão 067).
3. **A marca "Pronta para envio" cai** ao salvar: quem preparou confere os
   documentos de novo antes do GP enviar.

Valem as mesmas regras da geração: janelas e prazo de envio (decisões 077 e
157 — a data que já estava gravada passa como está; a que muda segue a
regra), urgência, parcelas, cadastro do fornecedor (166), CNPJ da PP (156),
titular da verba (164), linha com save (099) e job de mídia. A pergunta "Esta
é a última PP deste item?" volta, já marcada com o que o item diz hoje.

**Quem edita:** quem gera PP (GP, produtor, freelancer e administrador). Com o
job devolvido à pré-abertura, o lápis fica apagado com o motivo.

**Enviada ao financeiro, a PP não muda mais** — nada mudou aí. A rejeitada
segue com "Cancelar e refazer".

## Na tela

- **Painel do item**, na PP em "Aguardando envio": o lápis "Editar PP",
  antes do olho e do cancelar. **Antes do envio, só editar; depois do envio,
  só o "Ver formulário"** — nunca os dois (Tiago, 14/10/2026, ao ver os dois
  ícones lado a lado na demonstração). Quem só lê o job, sem o lápis, fica
  com a ficha em leitura.
- **Aba Pedidos de Produção** (14/10/2026, pedido do Tiago): a mesma regra.
  Na PP gerada, o lápis "Editar PP-…" no lugar do "Ver formulário", e ele
  abre o MESMO formulário, ali na aba. Na PP já enviada, a ficha, como antes.
- **Formulário:** título "Editar PP-…", aviso âmbar quando a PP está pronta
  para envio, e um botão só no rodapé, "Salvar alterações", que abre a
  revisão. A prévia de "Em PPs emitidas" tira o valor de antes e soma o novo.
- **Revisão:** "Salvar as alterações da PP-…?", com a linha "Esta PP"
  mostrando o valor de antes quando ele muda.
- **Ficha em leitura da PP gerada** (só para quem não edita, desde que o
  lápis ocupa o lugar dela): "Somente leitura. A PP ainda não foi enviada ao
  financeiro."
- A revisão do "Gerar PP" deixou de dizer que a PP não se edita depois: "A
  PP pode ser editada até o envio ao financeiro."

## No banco

- `pedidos_compra.editada_em` e `editada_por` (FK para `profiles`), nulas,
  sem backfill. Gatilho `trg_pp_carimba_edicao`: só na PP gerada, quem e
  quando pela sessão; a marca não se apaga.
- O evento `editada` em `pedidos_compra_eventos` (o check ganhou o valor) e
  o ramo em `pp_registra_evento`, disparado por `editada_em`.
- Action `editarPPGerada` (`actions-pp.ts`): confere tudo antes de gravar
  (inclusive os anexos novos no bucket, `conferirAnexosDaPP`), refaz o PDF
  antes de mexer na PP, grava a PP só se ainda gerada, ajusta as parcelas no
  lugar (a PP nunca fica sem parcela) e grava os anexos como no envio.
  Auditoria `pedido_compra.editada`, com o antes e o depois.

## Fora daqui, de propósito

- O "Atualizar vencimento" da decisão 157 continua, para quem só precisa da
  data nova.

## Testes

Ver a nota de 2026-10-13 no [HANDOFF_JOBS](../handoffs/HANDOFF_JOBS.md).
