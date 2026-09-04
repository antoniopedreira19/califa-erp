# 039 — A PP nasce gerada, e enviar ao financeiro é outra ação

**Data:** 2026-09-02
**Status:** aceita
**Migrations:** `20260902160001_pp_status_gerada.sql`,
`20260902160002_pp_gerada_envio_ao_financeiro_e_fim_do_teto.sql`
**Design:** `PPs - Gerar e Enviar ao Financeiro.dc.html` (projeto Claude
Design `69342d83`).
**Contexto:** o painel "Destrinchar realizado" e o formulário de PP da
Planilha Interna do job (`/jobs/[jobId]`), com efeito no financeiro. Oito
decisões do Tiago em 02/09/2026, listadas no §6.

## A mudança em seis frases

1. **"Gerar PP" cria a PP com status `gerada` e para aí.** Ela fica no
   job, editável e cancelável, até alguém enviá-la ao financeiro — só
   então entra em `em_avaliacao`, como antes. Até aqui gerar e enviar
   eram o mesmo clique.
2. **Enviar, editar, ver e cancelar são ações por PP**, no painel do item.
   O painel se parte em "Aguardando envio" e "Já no financeiro".
3. **A referência do item virou o PLANEJADO** (era o orçado). "Em PPs
   emitidas" soma só o que já chegou ao financeiro e acende em vermelho
   quando passa do planejado.
4. **Não há mais teto por PP.** O trigger `pp_valida_saldo_do_item`, que
   barrava a soma acima do orçado, saiu. Passar do planejado não impede
   gerar — no envio, pede o responsável do job ou administrador, com
   um "tem certeza?" que diz o quanto o item fica acima.
5. **O anexo deixou de travar a geração e passou a travar o envio**, fora
   da verba de produção. Qualquer tipo de documento libera.
6. **O chip `PPs · N` da calha ganhou um contador** com as PPs geradas e
   ainda não enviadas. Zerado, o círculo não aparece.

## 1. Por que gerar deixou de enviar

A PP é um documento que vai ao fornecedor e um compromisso que vai ao
financeiro. Quando os dois nasciam no mesmo clique, não havia como
conferir o PDF antes de o financeiro vê-lo, nem como deixar uma PP pronta
esperando a nota chegar. O GP gerava, descobria um erro, cancelava e
gerava de novo — e a cancelada ficava no histórico do financeiro.

Agora a PP gerada é rascunho do job. O PDF já existe (é como se confere o
que vai ao financeiro), o código já existe, e nada disso sai do job até o
envio.

## 2. Onde a PP gerada conta — e onde não

Decisão do Tiago, entre três opções: **só nas pendências.**

| | PP gerada |
|---|---|
| Painel do item, bloco "Aguardando envio" | conta |
| Contador do chip da calha | conta |
| "Em PPs emitidas" (painel e formulário) | **não** |
| Realizado da planilha (`recalcular_realizado_do_item`) | **não** |
| Consumo que congela a previsão da abertura (`consumoDasPrevisoes`) | **não** |
| Contas a Pagar, fluxo de caixa, card de PPs do financeiro | **não** — invisível |
| Fio de Comunicação de PPs do job | **não** — o card "PP emitida" é o envio |
| Encerramento do job (`PP_STATUS_EM_ABERTO`) | conta como pendência: envie ou cancele antes |

A rejeitada continua contando em tudo, como antes: ela vai ser corrigida
e reenviada, então o dinheiro segue comprometido. Quem tira uma PP do
item é só o cancelamento.

O teste do planejado no envio soma **as que já chegaram ao financeiro +
esta**. Outras geradas do mesmo item não entram — elas podem nunca ser
enviadas.

## 3. Quem envia acima do planejado

Decisão do Tiago: **responsável do job ou administrador** — o mesmo gate
de gerar PP. Enquanto todos os perfis forem `administrador`, o gate não
barra ninguém; o que aparece é a confirmação, com os números:

> Com PP-00023 o item passa a ter R$ 27.000,00 em PPs, R$ 7.000,00 acima
> do planejado de R$ 20.000,00. O envio ao financeiro é registrado no seu
> nome.

O servidor exige o flag `confirmarAcimaDoPlanejado`: sem ele, devolve os
números e a tela abre o pop-up. Tela desatualizada não envia por engano.

**Linha vermelha entra na regra** (decisão do Tiago). Ela nasce com
planejado zero, então toda PP dela passa do planejado e todo envio dela
pede a confirmação. Custo que o orçamento não previu passa pelo GP. É a
regra literal — e, de quebra, a linha vermelha finalmente ganhou caminho
para PP: até aqui a calha escondia a metade PP em item com valor zero
(handoff de Jobs, §30 e nota de 21/08), e `reservarPedidoCompra` recusava
item sem orçado. Os dois filtros saíram junto com o teto.

## 4. O que a edição da PP gerada pode mudar

Tudo — inclusive o parcelamento e o modo verba de produção. Diferente da
correção da rejeitada (`reenviarPedidoCompra`), que não refaz o
parcelamento porque os vencimentos já foram combinados com o fornecedor,
aqui ninguém viu nada ainda. Os PDFs são regerados e sobrescrevem os
anteriores; parcela que deixou de existir tem o documento removido do
bucket. A PP continua gerada.

A correção da rejeitada não mudou de caminho: editar e reenviar, pela aba
de Pedidos de Produção. Ela ganhou só o que o envio ganhou — a porta da
revisão de abertura (decisão 040) e a confirmação acima do planejado.

## 5. Banco

- `pp_status` ganhou `gerada`, antes de `em_avaliacao`.
- `pedidos_compra.enviada_financeiro_em` e `enviada_financeiro_por`, com
  backfill: toda PP anterior foi enviada na própria geração, então
  recebem `created_at` e `emitida_por`. **`emitida_por` continua sendo quem
  gerou.**
- `trg_pp_valida_saldo_do_item` e `pp_valida_saldo_do_item()` removidos —
  autorização explícita do Tiago.
- `recalcular_realizado_do_item` passa a excluir `gerada` além de
  `cancelada`.
- Índice parcial `idx_pp_geradas_por_job`.
- `pedidos_compra_parcelas` ganhou DELETE para `authenticated`, com policy
  restrita a parcela de PP **ainda gerada** (`20260902160003`): editar o
  rascunho refaz o parcelamento, e a tabela nunca tinha precisado apagar
  parcela. Achado na verificação em navegador.
- O `default` da coluna `status` NÃO mudou (`em_avaliacao`): o insert
  grava `gerada` explicitamente. Mudar o default surpreenderia a outra
  frente.

## 6. As oito decisões, como foram feitas

Perguntadas antes de codar, em 02/09/2026:

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Status do job durante a revisão de abertura | manter `aberto` + marca `abertura_em_revisao` (ver 040) |
| 2 | "Em PPs emitidas" acende em vermelho acima de quê | do **planejado** do item |
| 3 | Onde a PP gerada conta | só nas pendências |
| 4 | Qual PP trava a linha na errata | a que chegou ao financeiro (ver 040) |
| 5 | Quem envia acima do planejado | responsável do job **ou administrador** |
| 6 | O trigger do teto | derrubar |
| 7 | O que libera o envio fora da verba | qualquer anexo, como hoje |
| 8 | Linha vermelha e o gate do GP | entra na regra |

## 7. O que ficou de fora, de propósito

- **O botão de enviar na aba "Pedidos de Produção"** do job. Enviar,
  editar e cancelar a PP gerada moram no painel do item, na Planilha
  Interna, que é onde o design os desenhou. A aba ganhou o chip "Gerada",
  o cancelar da gerada e o número de PPs aguardando envio no card de
  resumo.
- **PP de verba de produção rejeitada** continua sem reenvio, como antes.
- **Job de limpeza de anexos órfãos** no bucket — mesma pendência de
  17/08/2026.

## ⚠️ Nota de 2026-09-04 — o formulário volta ao painel; fornecedor de dentro da PP

Gerar PP, Salvar alterações e Cancelar passaram a devolver para o painel
"Destrinchar realizado" em vez de fechar tudo, e o combo de fornecedor
ganhou um "+" que cadastra o fornecedor ali mesmo, com trava de documento
repetido. Ver [048](048-fornecedor-nasce-de-dentro-da-pp.md).

## ⚠️ Nota de 2026-09-04 — a PP passou a sair com uma resposta

O formulário ganhou uma pergunta obrigatória — *"Esta é a última PP deste
item?"* — e o chip da calha ganhou um ✓ verde que convive com o círculo
vermelho das pendências de envio. A resposta é sobre o item, e é ela que
troca a base da previsão de custo dele. Ver
[052](052-todas-as-pps-do-item-foram-geradas.md).
