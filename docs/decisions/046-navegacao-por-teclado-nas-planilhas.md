# 046 — A célula selecionada: as planilhas se navegam pelo teclado, e a linha nova não trava

**Data:** 2026-09-03
**Status:** aceita
**Contexto:** todas as planilhas de itens — a da versão do orçamento (e
os editores de rascunho do projeto, que usam a mesma tabela) e a do job
(GP, financeiro e errata). Design `Planilha Interna do Job -
Rentabilidade por Item.dc.html`, turno 2a (projeto Claude Design
`69342d83`). Decisões do Tiago em 03/09/2026 (B1–B5, C1).

## A mudança em cinco frases

1. **Existe uma célula SELECIONADA**, distinta da célula aberta. Ela
   ganha a mesma moldura arredondada do campo em edição (6px de raio,
   borda vermelha California, anel suave). Nada mais é destacado.
2. **As setas andam por toda célula de item**, editável ou calculada
   (Total, rentabilidade, e no job as células só de leitura). Na borda,
   ← e → viram a linha; Home/End vão aos extremos. É assim que se
   destaca um número numa chamada.
3. **Enter e F2 abrem a célula; digitar já substitui.** Célula calculada
   não abre — nela o Enter só desce. Dentro do campo, Enter confirma e
   **desce**; Tab, ↑ e ↓ confirmam e andam; Esc cancela. Na lista (Tipo,
   Categoria), Enter abre, ↑↓ escolhem, escolher confirma e a seleção
   **fica na célula** — como no Excel.
4. **O rodapé do card** mostra o endereço da célula (Item · Bloco ·
   Coluna), o valor dela, o modo (Editando · Lista aberta · Enter abre ·
   Calculada · Só leitura) e as teclas.
5. **A linha nova não trava mais nada.** Confirmada a descrição, ela vira
   item provisório na hora, o cursor segue, dá para abrir outra enquanto
   a primeira grava, e o id real entra por baixo.

## 1. Seleção e edição são estados diferentes

Antes, "célula ativa" era "campo aberto": clicar abria, Tab abria a
próxima, e as calculadas ficavam fora do caminho. Isso servia à
digitação e a nada mais. O modelo novo separa as duas coisas:

| Estado | O que é | Quem manda |
|---|---|---|
| selecionada | a moldura; as teclas andam | `useSelecaoPlanilha` (`_planilha/selecao.tsx`) |
| aberta | o campo de texto/número ou a lista | a tabela |

A máquina de seleção é **uma só** para as planilhas do orçamento e do
job — quatro cópias divergiriam na primeira correção, que foi o que
aconteceu com o Tab. A tabela entrega a ela as linhas navegáveis, as
colunas visíveis, o que cada célula abre (`editorDe`) e como abrir
(`onAbrir`, com a semente do caractere digitado); a máquina devolve a
célula, os handlers da célula e a moldura.

**Clique** seleciona; clique na célula já selecionada, ou duplo clique,
abre. Clique fora do card limpa a seleção; Esc também.

## 2. O que fica de fora

- **Linhas de grupo e de total** — não têm as colunas de um item, e
  "descer" de QT para dentro delas não teria onde cair (B2).
- **A coluna Save** — é um botão que abre um pop-up (B3).
- **No job, fora da errata, nada abre**: toda célula é só leitura, e o
  rodapé diz isso. Na errata, o Orçado, o Tipo e a descrição da linha
  nova abrem pelo mesmo caminho da planilha do orçamento (B5) — os
  inputs sempre abertos de antes saíram.

## 3. Por que Enter desce (e não fica)

O design escrevia "Enter confirma e fica". O Tiago preferiu o Excel:
Enter num campo aberto confirma **e desce**; a exceção é a lista, onde
escolher fica na célula (B1). ↓ e Enter na última linha do grupo
continuam abrindo o "Novo item" dele; ↓ num rascunho em branco o
descarta e segue para o grupo de baixo — por isso não dá para criar
linha sem fim (C1).

## 4. A linha nova provisória

Antes, confirmada a descrição, a linha ficava como rascunho até o
servidor responder e a página recarregar: o "Novo item" e as lixeiras
ficavam desligados, e o cursor só religava ao id novo quando a resposta
chegava. Agora:

1. a linha vira **item provisório** (`tmp:N`) no mesmo instante, com a
   aparência de item e mais clara; entra nos subtotais e na navegação;
2. a seleção sai do rascunho para ela e anda como pediram (Enter desce,
   Tab avança) — dá para abrir a linha seguinte enquanto a anterior
   grava;
3. o servidor responde com o id real: a provisória troca de id e passa
   a aceitar edição **antes** do refresh, porque o id já é o do banco;
4. o refresh traz o item de verdade e a provisória some, sem duplicar;
5. se o servidor **recusar** (validação ou rede), a linha não some com
   o que foi digitado: volta a ser rascunho no mesmo lugar, com o aviso
   no card; se já houver outro rascunho ocupado, fica marcada na grade
   até ser clicada.

Enquanto é provisória (sem id real) a linha seleciona mas não abre —
qualquer escrita iria para um id que o banco não conhece.

## Arquivos

- `app/(app)/_planilha/selecao.tsx` — `useSelecaoPlanilha`, `Miolo`,
  `RodapeSelecao`.
- `app/(app)/_planilha/blocos.ts` — `SELECAO` (moldura, rodapé, chips).
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/itens-table.tsx`
  — seleção, provisórios, células com moldura, rodapé.
- `app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx` —
  seleção em leitura e na errata; `CelulaJob`, `CampoDaErrata`.
- `app/(app)/jobs/[jobId]/realizado/errata-rascunho.ts` — `adicionar`
  devolve a chave da linha nova.
