# 191 — O PDF da PP mostra o item da planilha a que ela pertence

**Data:** 2026-10-19
**Status:** aceita e implementada em 19/10/2026. Vale para o PDF gerado ou
refeito daqui em diante; os já emitidos ficam como estão.
**Quem decidiu:** Tiago — pedido em 17/10/2026 e aprovado em 19/10/2026 na
versão A do protótipo "Item no PDF da PP"
(https://claude.ai/artifact/6iho6wNwqbgzHrc6CaYMAn), que comparava o
documento de hoje com três posições: A no bloco do serviço, B no cabeçalho
embaixo do "Job:", C como a A com o bloco da planilha junto do nome.
**Revê:** nenhuma regra de processo; muda só o documento.
**Migration:** nenhuma.

## O problema

O PDF da PP dizia o "Serviço" — o texto livre que quem gera a PP digita —
mas não de qual linha da planilha do job a PP sai. Quem lê só o documento
(o financeiro que confere pelo PDF, o fornecedor que assina) não tinha como
ligar a PP ao item.

## A regra

1. **A linha "Item: <nome>" vai embaixo do "Serviço"**, na célula da
   esquerda que ficava vazia ao lado do "Prazo de Pagto" (ou das
   "Parcelas", na PP parcelada). O documento não cresce; nome longo quebra
   dentro da própria célula.
2. **O nome é o da linha na planilha do job** (`jobs_itens_orcado.item`),
   lido quando o PDF é feito — o mesmo que o formulário e a ficha da PP
   mostram em "Item". Só o nome, sem o bloco: a versão C ficou de fora.
3. **Vale para todos os formatos do documento:** fornecedor (PIX, boleto,
   parcelada, com ou sem especificações), as verbas (titular colaborador,
   freelancer, terceiro e a anterior à 171), o reembolso (187), a prévia da
   conferência (178) e os selos de não enviada e cancelada (190).
4. **Entra na geração e em todo PDF refeito:** edição da PP gerada (173),
   "Atualizar vencimento" (157), prévia (178), troca de selo no envio e no
   cancelamento (190) e troca da empresa emissora (156). Os PDFs emitidos
   antes de 19/10 não foram refeitos.
5. **O nome não acompanha a planilha depois de impresso.** Se uma errata
   renomear a linha, o PDF já emitido continua com o nome antigo; o próximo
   PDF refeito daquela PP sai com o novo.

## O que ficou de fora

- **Nome repetido entre blocos.** Em 19/10/2026, 51 dos 132 jobs têm itens
  com o mesmo nome em blocos diferentes (306 nomes; 19 se repetem dentro do
  mesmo bloco). A versão C resolveria a maior parte; fica para depois, se a
  ambiguidade aparecer na conferência.
- **Retroativo.** As PPs emitidas até 19/10 seguem sem a linha. Se for
  preciso, dá para refazer como no retroativo da 190.

## Implementação

- `lib/pdf/pedido-compra.ts`: `itemNome: string | null`, obrigatório em
  `Dados`. Null só nos dois scripts que refazem documentos antigos
  (`scripts/refazer-pdf-verba-colaborador-171.ts` e
  `scripts/rastros-codigo-anterior/2-refazer-pdfs.ts`), que saem sem a
  linha, como eram.
- `app/(app)/jobs/[jobId]/realizado/actions-pp.ts`:
  `renderizarDocumentoDaPP` exige `itemNome`. Geração, prévia e edição
  usam o `item.item_nome` do `checarGatesRealizado`; `refazerPdfDaPP` e
  `atualizarVencimentoDaPP` leem o nome junto da PP pelo embed `ITEM_DA_PP`
  (`realizado:jobs_itens_realizado(copia:jobs_itens_orcado(item))` — uma FK
  em cada salto, sem ambiguidade).
- No banco, em 19/10/2026: 238 PPs, todas com a linha da planilha ligada e
  o nome preenchido.

## Conferência

Em 19/10/2026, no TES-1001/26 (servidor do worktree), na linha "Item 7"
do bloco "Agrupamento 3":

- **Geração:** a PP-00286 (FORNECEDOR TESTE LTDA, R$ 500,00), gerada pelo
  formulário, saiu com "Item: Item 7" embaixo do Serviço e o selo de não
  enviada (190).
- **Edição (173):** com o serviço trocado, o PDF refeito trouxe o texto
  novo e manteve o item.
- **Cancelamento:** cancelada pela tela, o PDF foi refeito pelo
  `refazerPdfDaPP`, que lê o item pelo embed, com o selo de cancelada e o
  item.
- **Os outros formatos** (parcelada, verba de colaborador, reembolso de
  veículo próprio, nome de 200 caracteres e a chamada sem item dos scripts)
  foram conferidos pelo gerador, com dados fictícios: o item fica no mesmo
  lugar, o nome longo quebra dentro da célula e, sem item, o documento sai
  igual ao de antes.
- **Não exercitados na tela:** a prévia (178) e o "Atualizar vencimento"
  (157). A prévia usa o mesmo `item.item_nome` da geração; o vencimento usa
  o mesmo embed do refazer.
