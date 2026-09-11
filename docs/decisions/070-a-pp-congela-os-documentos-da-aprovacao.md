# 070 — A PP congela quais documentos estavam anexados quando foi aprovada

**Data:** 2026-09-11
**Status:** aceita
**Contexto:** `pedidos_compra`, tela da PP em Contas a Pagar, e
`aprovarPPComData`. Pedido do Tiago em 10/09/2026, junto da reforma da
aprovação.

## O que já existia

`aprovada_por` e `aprovada_em` na própria PP, e um evento
`pedido_compra.aprovada` em `audit_events` com valor, job, data de
pagamento e forma. **Quem** liberou e **quando** nunca foi o problema.

## O que faltava

**Com qual documento.** Sem isso não há como responder *"que nota o
financeiro estava vendo quando liberou esses R$ 9.000?"*.

## O tamanho honesto deste registro

O Tiago observou que a PP **trava** ao ser aprovada, e o código confirma:
`editarPP` e `reenviarPP` só aceitam status `gerada` ou `rejeitada`. A
produção não troca anexo de PP aprovada. Isso **reduz** o valor do
registro, e essa redução está escrita aqui de propósito — a proposta
original o vendeu como proteção maior do que é.

Ele continua valendo por dois casos:

1. **Provar que uma PP foi aprovada sem documento nenhum.** É o registro
   mais valioso dos dois, e o único que nenhuma outra tabela guarda.
2. **O ciclo desaprovar → reenviar com outro documento → aprovar de
   novo.** `desaprovarPP` existe e devolve a PP para `em_avaliacao`; dali
   em diante o anexo pode mudar, e sem o congelamento a troca não deixa
   rastro.

## A regra

1. Na aprovação, a lista de anexos vigentes é lida **antes** do RPC e
   gravada em `pedidos_compra.anexos_na_aprovacao` (`jsonb`), além de ir
   para o `metadata` do evento de auditoria.
2. **Três estados, e a tela distingue os três:** `null` = aprovada antes
   de 11/09/2026, sem registro; `[]` = aprovada **sem** documento; lista =
   o que foi conferido.
3. **Sem backfill.** Para as PPs aprovadas antes desta data não existe
   registro do que estava anexado naquele momento, e preencher com a lista
   atual seria fabricar uma prova.
4. Falha ao gravar não derruba a aprovação: a coluna fica nula, que a tela
   lê como "não registrado".

## Por que na PP, e não só no `audit_events`

A RLS de `audit_events` libera `SELECT` apenas para admin do tenant
(`is_tenant_admin`) ou para o próprio ator. Hoje os 10 profiles são
administradores e ninguém sentiria; no dia em que existir um papel
`financeiro` puro, a seção "Histórico" ficaria **vazia sem explicar por
quê**. Lido da PP, quem enxerga a PP enxerga o histórico dela. O evento de
auditoria continua sendo gravado — ele é o registro canônico e imutável; a
coluna é a cópia que a tela lê.

É o mesmo padrão da decisão 067, que congelou os dados bancários do
fornecedor: guardar no registro operacional o que valia no momento da
decisão, para que o passado não mude quando o cadastro mudar.

## Verificação (11/09/2026)

Coluna e comentário conferidos pelo MCP depois de aplicar. Na tela, na
PP-00011 (aprovada em 28/08): a seção "Histórico" lista *Emitida ·
Enviada ao financeiro · Aprovada*, com data e pessoa, e "Documentos na
aprovação" mostra **"Não registrado"** — o texto do caso `null`.

⚠️ **Os outros dois estados (`[]` e lista preenchida) só nascem numa
aprovação nova**, e a única PP em avaliação é de job real. Ficam para o
teste completo combinado com o Tiago, numa PP de teste. Não foram
simulados com `UPDATE` de propósito: escrever uma lista inventada numa PP
real, ainda que por um minuto, é exatamente a prova fabricada que o item 3
proíbe.
