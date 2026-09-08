# 063 — O import lê o agrupamento pela coluna A, e item sem valor entra zerado

**Data:** 2026-09-08
**Status:** aceita
**Contexto:** `lib/importacao/parser-oficial.ts` e as três telas que o
chamam — criação de orçamento (`_rascunho/actions.ts`), criação em lote
(`_rascunho/salvar-em-lote.ts`) e importação dentro de uma versão
(`versoes/importar-actions.ts`). Pedido do Tiago em 08/09/2026, com o
arquivo `Modelo Planilha interna.xlsx` como **modelo do formato** — ele
não é conteúdo para importar, é o desenho das planilhas que virão.

## O problema

O parser lia um layout que a agência não usa e que o **próprio sistema
não escreve**. `lib/exportacao/planilha-orcamento.ts` já exportava
A · grupo, B · item, C · R$, D · QT, E · D/M, F · TT, G · tipo desde
sempre; o import esperava o item na coluna C e o tipo na H. Resultado:
planilha exportada pelo sistema voltava com o valor unitário sendo lido
como nome do item. Quem estava fora de sincronia era o import.

## O layout, conferido célula a célula

Aba **"Padrão"**. Linha 2 = faixas dos blocos (C:F ORÇAMENTO ·
H:L PLANEJADO · M:Q REALIZADO). Linha 3 = header.

| Col | Header | Linha de item | Linha de grupo |
|---|---|---|---|
| A | CATEGORIA | o agrupamento, repetido em cada item | vazia |
| B | ITEM | nome do item | nome do grupo |
| C | R$ | valor unitário orçado | vazia |
| D | QT | quantidade | vazia |
| E | D/M | dias/meses | vazia |
| F | TT | `=C*D*E` | `=SUM(...)` |
| G | *(sem header)* | tipo de custo | vazia |
| H · I · J | R$ · QT · D/M | bloco PLANEJADO | vazia |
| K..Q | TT · RENTA · REALIZADO | ignorados | vazia |

## O que foi decidido

| # | Pergunta | Decisão |
|---|---|---|
| 1 | O grupo sai da coluna A ou da linha de grupo? | **Coluna A.** "Diferentes planilhas com diferentes tamanhos de agrupamento poderão ser importadas" — cada item dizendo seu grupo é o que aguenta isso. As linhas de grupo do modelo têm subtotal com intervalo **errado** (ESTRUTURA soma `F5:F14`, mas os itens vão até a 18; SERVIÇOS soma `F25:F32`, mas são 23 a 29), então nada é lido delas além do nome. E o nome sai certo: **CONTEÚDO** com acento, da coluna A, contra o "CONTEUDO" sem acento da linha de grupo. |
| 2 | Item com nome e tipo mas sem R$ na coluna C? | **Entra, com R$ 0,00.** São 22 dos 26 itens do modelo — um gabarito em branco. O nome do item é o que interessa preservar; o valor se preenche na tela. |
| 3 | A coluna A também preenche a CATEGORIA do item? | **Não. Ela só agrupa.** `categoria_id` continua nascendo vazia, preenchida à mão pelo botão "Nova categoria". |
| 4 | De onde vem o % de honorários? | **Da coluna E da linha HONORÁRIOS** (0,12 → 12). Número acima de 1 é lido como já percentual, e o texto com "%" segue como fallback das planilhas antigas. |

## Os dois formatos, num parser só

A exportação põe o nome do grupo na **coluna A de uma linha de grupo** e
deixa a coluna A dos itens vazia. O modelo põe o nome na **coluna B** da
linha de grupo e repete o grupo na coluna A de cada item. O parser aceita
os dois sem ambiguidade:

- **Linha de grupo** = sem valor em C e sem tipo em G, com nome em
  exatamente UMA das duas primeiras colunas. Cria o grupo.
- **Item** = o resto. O grupo vem da **coluna A quando ela tem texto**
  (a regra acima); vazia, herda o último grupo visto.

Grupo que aparece numa linha de grupo mas em nenhum item é descartado no
fim — é o que faz o "CONTEUDO" sem acento sumir sozinho.

## QT e D/M zerados viram 1, com aviso

Achado ao conferir o banco: `versoes_orcamento_itens` tem
`itens_quantidade_positiva` e `itens_dias_meses_positivo`, os dois
`> 0`. O modelo traz **D/M = 0 nas linhas 6, 7 e 8** — o insert inteiro
morreria. O parser coage para 1 e registra aviso de severidade `ajuste`,
em vez de derrubar a importação.

⚠️ **Isso muda o total dessas linhas.** Na planilha, `F = C×D×E` dá R$ 0,00
com D/M zero; importadas, elas valem R$ 100,00 cada, e o subtotal de
ESTRUTURA sai R$ 400,00 em vez de R$ 100,00. O aviso na tela é o que
avisa. Se um dia a preferência virar descartar a linha, é uma condição.

## Orçado zerado não impede importar, mas impede aprovar

As duas coisas convivem, e é de propósito:

| Tela | O que faz com item de R$ 0,00 |
|---|---|
| Importar dentro de uma versão | **Grava.** A versão fica em rascunho com o item zerado. |
| Criação de orçamento em lote | Mostra na tela; o **Salvar recusa** (`salvar-em-lote.ts`). |
| **Aprovar versão** | **Recusa**, na tela e no servidor — `bloqueioAprovacaoVersao` (decisão 011), com a contagem no botão. |

O import é o rascunho; a aprovação é a trava.

## Verificado

Parse do modelo, por linha de comando e no navegador (dev server, sessão
real, projeto **TESTE-0003/26 · "Teste Alterações"**, v2 do
TESTE-0003/26-08): aba "Padrão", **4 grupos** — ESTRUTURA (14), A&B (2),
SERVIÇOS (7), CONTEÚDO (3) — **26 itens**, honorários **12%**, tipos
A/B/C/D vindos da coluna G, planejado da linha 5 chegando 90 × 1 × 1,
categoria vazia em todos, e **3 avisos**, os do D/M zerado. Conferido no
banco: 22 itens com orçado zerado, nenhum com QT ou D/M abaixo de 1.

Com os 26 itens gravados, o botão **"Aprovar versão" ficou desabilitado**
com *"22 itens com R$ unitário orçado zerado. Preencha o orçado de todos
os itens antes de aprovar a versão."* — a regra do Tiago, valendo.

Round-trip: planilha gerada por `adicionarAbaOrcamento` e reimportada
devolve os mesmos grupos, itens, tipos e valores, com **zero avisos**.
