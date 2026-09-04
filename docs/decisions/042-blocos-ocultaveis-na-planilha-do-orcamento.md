# 042 — O menu "Exibir" esconde blocos de verdade, e orçamento não tem Realizado

**Data:** 2026-09-03
**Status:** aceita
**Contexto:** o menu "Exibir colunas" da planilha da versão do orçamento
(`/orcamentos/[projetoId]/[orcId]`, aba da versão). Ele vinha do design
`Orcamento - Versao com Save.dc.html` (projeto Claude Design `69342d83`),
onde os blocos eram texto e só a pastilha **Save** era clicável.
Decisão do Tiago em 03/09/2026.

## A mudança em três frases

1. **Sai "Realizado", entra "Rentabilidade".** Realizado não existe no
   orçamento: ele nasce da PP, dentro do job já aberto. O terceiro bloco
   que a planilha do orçamento desenha é a Rentabilidade (Orçado ×
   Planejado), e era ela que faltava no menu.
2. **Nada mais é só leitura.** Orçado e Rentabilidade ligam e desligam
   de verdade — o bloco sai da faixa, do sub-cabeçalho, das linhas de
   item, da linha de grupo, da linha nova e do total.
3. **PLANEJADO fica sempre visível.** É o custo, o número pelo qual a
   planilha existe; escondê-lo deixaria a tela sem nada para ler. O item
   continua no menu, marcado, com a dica "O Planejado é sempre exibido."
   no `title` — para quem clicar saber que não é defeito.

## 1. Por que Realizado estava lá

Erro de leitura do design, não de regra. O mock listava os três momentos
da linha (Orçado · Planejado · Realizado) porque é o vocabulário do
produto; a planilha do orçamento, porém, fecha em **Orçado · Planejado ·
Rentabilidade** (`_planilha/grade-orcamento.tsx`, 13 colunas). Quem tem
Realizado é a grade do **job** (`_planilha/grade-job.tsx`, 15 colunas),
e lá o menu continua correto.

Consequência prática: o menu anunciava uma coluna que a tela nunca
mostraria (desmarcada, para sempre) e omitia a coluna grafite que estava
na tela.

## 2. O que "esconder um bloco" exige

Um bloco não é uma coluna: são quatro (R$ Unit., QT, D/M, Total) — duas
na Rentabilidade (R$ e %). Esconder um deles mexe em tudo que conta
colunas:

| Onde | O que mudou |
|---|---|
| `colgroup` | os `<col>` do bloco saem (`ColunasFixas`) |
| `colSpan` de linha inteira | `totalDeColunas()` passou a descontar os blocos escondidos |
| faixa dos blocos (`thead` linha 1) | o `<th colSpan={4}>` do bloco sai |
| sub-cabeçalho (`thead` linha 2) | as 4 (ou 2) colunas saem |
| linha do grupo | `grupoVazio` + `grupoValor` do bloco saem |
| linha de item | as 3 células de entrada + o Total saem |
| linha nova (rascunho) | idem — senão ela escorrega uma casa |
| `tfoot` | `subtotalVazio` + `subtotalValor` do bloco saem |
| **ordem do Tab** | as 3 colunas do Orçado saem da sequência de navegação |

O Tab é a parte que não se vê e mais incomodaria: sem tirar os campos da
ordem, o cursor pararia em células que não estão na tela. Provado ao
vivo com Shift+Tab a partir do "R$ Unit." do Planejado — com o Orçado
escondido ele volta para **Categoria**, e não para o D/M do Orçado.

## 3. A largura liberada volta para os blocos, não para o Item

Os três blocos somam **72%** da tabela; Item, Tipo e Categoria ficam com
o resto (Item absorve a sobra). Se um bloco simplesmente saísse, os 28%
dele cairiam no Item — que viraria ~640px de branco numa tela de 1450px,
com as colunas de moeda no mesmo lugar de antes.

Então os 72% são **redistribuídos entre os blocos que ficaram**, na
mesma proporção:

| Estado | Orçado / Planejado (unit · qt · d/m · total) | Rentab. (R$ · %) |
|---|---|---|
| completo | 10 · 3,5 · 3,5 · 11 | 11,5 · 4,5 |
| sem Rentabilidade | 13 · 4,5 · 4,5 · 14 | — |
| sem Orçado | 16,5 · 5,5 · 5,5 · 18 | 19 · 7 |
| só Planejado | 26 · 9 · 9 · 28 | — |

São classes Tailwind **literais**, uma combinação por vez: largura
montada em template string não existe no CSS, porque o Tailwind varre o
fonte. O piso (`LARGURA_MINIMA`, 1060px) não muda — com bloco escondido
as colunas de moeda ficam com uma fração maior do mesmo piso, então
nenhuma aperta.

## 4. O que NÃO mudou

- **Estado de tela, não de dado.** Nada vai para o banco nem para a URL:
  recarregar a página traz a planilha inteira de volta. É a mesma
  natureza do liga-desliga da coluna Save.
- **Os números.** Esconder o Orçado não muda a rentabilidade, o total,
  o card de Totais nem o fechamento — o que sai é a exibição.
- **As planilhas de job** (aba Realizado do job e visão agregada do
  projeto em `/jobs/projeto/[projetoId]`) seguem com os blocos em só
  leitura no menu. Lá a grade é a `grade-job`/`grade-jobs-projeto`, e o
  card de Totais divide o `colgroup` com os blocos: ligar/desligar por
  lá é entrega própria.
- **As agregadas de orçamento** (`/agregado` e `/multi`) também não
  ganharam o menu: elas já têm um "Exibir" que filtra ORÇAMENTOS, e o
  `TotaisProjetoCard` divide a grade com os cards. Os defaults de
  `ColunasFixas` são "tudo visível", então nada nelas mudou.

## Arquivos

- `app/(app)/_planilha/grade-orcamento.tsx` — `ColunasVisiveis`,
  `ColunasFixas`, `totalDeColunas`, as larguras por combinação.
- `app/(app)/_planilha/exibir-colunas.tsx` — `BlocoNoMenu.dica`, item só
  leitura com `title` e `cursor-default`.
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/grupos-section.tsx`
  — o estado dos dois blocos e a lista do menu.
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/itens-table.tsx`
  — as guardas de renderização e a ordem do Tab.
