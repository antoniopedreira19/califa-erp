# 076 — A importação da versão pergunta de onde vem o planejado

**Data:** 2026-09-14
**Status:** aceita (revisada em 2026-10-05: nada vem marcado; e em 2026-10-08, pela [158](158-planilha-de-um-mes-no-fee-e-always-on.md): o planejado da planilha vem marcado)
**Contexto:** a planilha que vai para o cliente só tem o orçado. Ele mexe,
devolve, e a agência precisa de uma versão nova com o orçado dele **e o
planejado que ela já tinha montado**. O "Importar" do projeto já fazia isso
(decisão 041), mas o "Importar planilha" da versão sempre usava o planejado
do arquivo — zerado, numa planilha só com o orçado. E lia a coluna oculta
de crédito consumido da exportação como quantidade planejada.
**Complementa a [041](041-planilha-unica-do-projeto-exportar-e-importar.md)** e vale para o
nacional e para o internacional ([072](072-orcamento-internacional.md)).

## A regra

> **O "Importar planilha" da versão — nova versão e sobrescrever — pergunta
> de onde vem o planejado:**
>
> - **"Usar o planejado da planilha"** — vale o do arquivo (zerado se ele só
>   tem o orçado), que é como a importação sempre funcionou;
> - **"Manter o planejado da vN"** — a linha casada com a versão anterior
>   herda o planejado dela, com a categoria e a marca de save; a linha sem
>   par entra zerada.
>
> **"Usar o planejado da planilha" vem marcada;** quem quer o da versão
> troca a opção (revisão de 08/10/2026, abaixo). De 05/10 a 08/10 nenhuma
> vinha marcada.

Decisões do Tiago em 14/09/2026:

| Ponto | Decisão |
|---|---|
| Portas | "Importar planilha" da versão (nova versão e sobrescrever). O "Importar" do projeto continua mantendo o planejado sempre, como já fazia. |
| Versão anterior | Na versão nova, a **vigente** (aprovada, senão a mais recente). No sobrescrever, a própria versão substituída. |
| Casamento | Pelo **id oculto** da exportação; sem id (planilha interna, ou id apagado), por **grupo + descrição**. É o mesmo `planejarSecao` da importação do projeto. |

Sem versão anterior (orçamento que ainda não tem nenhuma) a pergunta não
aparece e vale a planilha. BV não é herdado, como no sobrescrever de antes.
No internacional, a linha casada mantém o tipo gravado nas duas escolhas
— a planilha não tem coluna de tipo.

## ⚠️ Revisão de 2026-10-05 — nada vem marcado

Pedido do Tiago: forçar os produtores a ler as duas opções e escolher. Até
aqui a tela vinha marcada pelo arquivo (planilha com planejado sugeria a
dela; só com o orçado, manter o da anterior) — e quem importava confirmava
sem ler.

- **"Usar o planejado da planilha" passa a ser a primeira opção**, "Manter
  o planejado da vN" a segunda.
- **Nenhuma vem marcada.** Enquanto não há escolha, o botão de gravar fica
  desabilitado e a lista de grupos mostra o planejado, a rentabilidade e o
  % em "—", para não adiantar nenhuma das duas respostas. O quadro fica
  como era: sem destaque e sem texto pedindo a leitura (o Tiago recusou os
  dois na aprovação).
- **Trocar de aba recomeça a escolha** (outra aba é outra planilha).
- Sem a pergunta (orçamento sem versão anterior, ou Interno) nada muda:
  vale a planilha e o botão já vem liberado.
- O servidor não mudou: `origem_planejado` continua `"anterior" |
  "planilha"`, e a tela só manda depois da escolha.

## ⚠️ Revisão de 2026-10-08 — o planejado da planilha vem marcado

Pedido do Tiago, junto da [158](158-planilha-de-um-mes-no-fee-e-always-on.md)
(planilha de um mês só no Fee e no Always On): **"Usar o planejado da
planilha" vem marcada em toda importação**. O botão de gravar já nasce
liberado; quem quer manter o da versão troca a opção. Trocar de aba volta
à opção da planilha. A ordem das opções, o quadro e o servidor ficam como
estavam. Na aba sem título de mês, a pergunta do planejado só aparece
depois da pergunta dos meses.

## A visão agregada fica de fora

O Tiago pediu a pergunta também no "Importar planilha" da visão agregada.
Ela não entrou porque ali **não há planejado anterior para herdar**: o
botão só aparece em card sem planilha (`origem === null` e nenhum grupo),
isto é, orçamento sem versão ou com versão vazia. A leitura dessa porta
ganha a correção da coluna oculta (abaixo) e segue usando o planejado da
planilha.

## A coluna oculta deixou de virar planejado

Na exportação do ERP a coluna H é o id oculto e a I, o crédito consumido.
O importador lia H · I · J como o bloco PLANEJADO da planilha interna, e o
crédito entrava como quantidade planejada (o valor unitário, lido do id,
dava zero). Agora, quando a H traz `orc:`/`v:`/`grp:`/`it:`, a linha não
tem planejado no arquivo — e o id de grupo e de item é guardado para o
casamento.

## Onde mora

- `lib/importacao/planejado-anterior.ts` — `casarComAnterior` e
  `linhasParaGravar`, puros.
- `lib/importacao/parser-oficial.ts` — `item_id`, `grupo_id` e
  `tem_planejado`; a H com id não é planejado.
- `versoes/importar-actions.ts` — `versaoAnterior`; o preview devolve o
  casamento, e as duas escritas leem a escolha (`origem_planejado`) e
  casam **antes** de criar a versão (senão a "mais recente" seria a nova)
  ou de apagar o conteúdo (no sobrescrever).
- `versoes/importar-drawer.tsx` — a pergunta, e os totais do preview
  seguindo a escolha. Desde a decisão 110 (modal), a pergunta mora em
  `_importacao/resumo-da-aba.tsx` e a trava do botão em
  `_importacao/importar-planilha-dialog.tsx`.

## Conferido

- Por script: ids lidos da exportação nacional e internacional; crédito
  consumido fora do planejado; casamento por id e por descrição; as duas
  escolhas; tipo mantido no internacional.
- No navegador, no 0-0001/26-06 (nacional, planejado de R$ 40.000,00 na
  v1): o sobrescrever e a versão nova com a própria exportação sugeriram
  "Manter o planejado da v1", "3 de 3 linhas casadas", planejado de
  R$ 40.000,00 e por grupo; "Usar o da planilha" zerou os totais; a v2
  criada herdou o planejado linha a linha (11.000 × 2, 2.000, 16.000).
