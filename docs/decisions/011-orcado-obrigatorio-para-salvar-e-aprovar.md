# 011 — Orçado zerado não salva lote nem aprova versão

**Data:** 2026-08-17
**Status:** aceita · **revisada em 2026-09-28** — o salvar do lote deixou de barrar; só a aprovação barra (ver "Revisão" no fim)
**Contexto:** editor de orçamento do projeto (`/orcamentos/[projetoId]/multi`)
e tela da versão (`/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]`).
Regra definida pelo Tiago e corrigida em 16/08/2026: a primeira redação
falava em "valor zerado" genérico; a corrigida separa orçado de planejado.

## Decisão

**Nenhum item pode ter `valor_unitario_orcado` = 0 nos dois portões do
fluxo:**

1. **"Salvar orçamentos"** do editor multi-jobs — nenhum item, de nenhum
   orçamento do rascunho, pode estar com o R$ unitário orçado zerado (ou
   não numérico). O erro nomeia orçamento · grupo · item.
2. **"Aprovar versão"** — a aprovação trava os valores e alimenta o job;
   versão com item de orçado zerado não aprova. A mensagem entra em
   `bloqueioAprovacaoVersao`, a mesma função que desabilita o botão (com
   o motivo no `title`) e que a server action usa para recusar.

**O `valor_unitario_planejado` PODE ficar em 0** nos dois portões — o
planejado se preenche depois, quando o job entra em operação.

## Por quê

O orçado é o compromisso comercial: é dele que saem o Valor do Job, os
honorários e o que se apresenta ao cliente. Linha com orçado zerado ou é
esquecimento ou é item que não deveria existir — e aprovar assim abriria
job com valor errado, que ninguém corrige depois sem errata.

## Onde a regra mora

- Cliente (aviso antes do round-trip): `itensComOrcadoZerado` em
  `app/(app)/orcamentos/[projetoId]/multi/editor-multi-jobs.tsx`.
- Servidor (o portão de fato): loop de validação de
  `salvarOrcamentosDoProjeto` em
  `app/(app)/orcamentos/[projetoId]/multi/actions.ts`.
- Aprovação (tela e servidor com a mesma mensagem):
  `bloqueioAprovacaoVersao` em `lib/validations/versoes.ts`, alimentada
  por `aprovarVersao` e pelo `FluxoAbertura`.

## O que ficou de fora, de propósito

- O **editor agregado** (`/agregado`) e a edição item a item na tela da
  versão continuam aceitando orçado 0 durante a digitação — o portão é o
  salvamento do lote e a aprovação, não cada tecla. Estender ao "Salvar
  alterações" do agregado é decisão futura.
- Nenhuma constraint de banco: itens em rascunho podem legitimamente
  estar com 0 no meio da edição.

## Revisão de 2026-09-28 — o salvar não barra mais

Pedido do Tiago, depois da importação da planilha da Budweiser: *"Da mesma
maneira que isso é possível dentro de um orçamento, deverá ser possível na
visão agregada."*

- **"Salvar orçamentos" / "Salvar alterações" da agregada aceitam item com
  R$ unitário orçado zerado**, como a tela da versão sempre aceitou.
- **A aprovação continua barrando** (`bloqueioAprovacaoVersao`, mesma
  mensagem na tela e no servidor). É ela o portão do orçado.
- Motivo: a planilha da agência traz item "Resp. Cliente" e bonificado com
  R$ 0 (5 dos 50 itens na Página9 da Budweiser). Pela porta da versão a
  planilha importava; pela agregada, o salvar parava no primeiro deles.
- O aviso de cliente (`itensComOrcadoZerado`) e o editor multi-jobs citados
  acima não existem mais; a checagem do servidor saiu de
  `app/(app)/orcamentos/_rascunho/salvar-em-lote.ts`.
