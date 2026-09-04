# 051 — O descritivo se lê na lista, num cartão ancorado

**Data:** 2026-09-04
**Status:** aceita
**Contexto:** listas `/orcamentos` (Projetos & Orçamentos) e `/jobs`.
Design `Descritivos nas Listas.dc.html` (projeto Claude Design
`69342d83`). Continuação da [043](043-descricao-do-projeto-e-descritivo-do-job-obrigatorios.md),
que tornou os dois campos obrigatórios mas não deu onde lê-los.

## A mudança em quatro frases

1. **Um ícone discreto ao lado do nome abre o descritivo num cartão**
   que flutua sobre a tabela. A lista não muda de tamanho e nada mais se
   move — era o requisito que descartou expandir a linha.
2. **Em `/orcamentos` há um cartão só**, o do projeto. Em `/jobs` há
   dois: o do **projeto na faixa do grupo** e o do **job na linha**.
3. **Um cartão por vez.** Fecha com clique fora, no X ou com `Esc`; o
   clique DENTRO não fecha, para dar para selecionar e copiar o texto.
   Do cartão do job dá para saltar para o do projeto ("Ver descritivo do
   projeto") sem passar pelo fechar-e-abrir.
4. **Registro anterior à regra fica com o ícone apagado** e não clicável,
   com o `title` explicando por quê.

## 1. Por que cartão, e não uma coluna

Descritivo é texto de parágrafo — média de 80 caracteres no projeto e 44
no job, tetos de 600 e 500. Numa coluna ele ou vira reticências (e não
serve para nada) ou empurra as doze colunas da lista para fora da tela.
O cartão resolve os dois: a tabela fica como está, e quem precisa do
texto o lê inteiro, com as quebras de linha que a produção escreveu.

## 2. O que NÃO mudou, e foi decidido explicitamente

Duas pendências que o próprio handoff levantou foram fechadas pelo Tiago
em 04/09/2026, ambas por **manter como está**:

| Pendência | Decisão |
|---|---|
| A busca deve procurar dentro do descritivo? | **Não.** `/orcamentos` continua buscando em código, nome, campanha e cliente; `/jobs`, em código e nome. O descritivo se lê no cartão, não se filtra por ele. |
| Exigir um tamanho mínimo (o Zod pede 1 caractere)? | **Não.** Segue `min(1)` nos dois campos. A regra existe para o campo ser preenchido, não para medir redação. |

O terceiro ponto do handoff — o que fazer com os registros antigos — já
estava respondido pela 043: **não há backfill**. A regra vale daqui pra
frente, e projeto antigo sem descrição só salva depois de ganhar uma. Na
data desta decisão são **12 dos 19 projetos** e **27 dos 30 jobs** sem
texto; é por isso que o ícone apagado precisa existir e não é um estado
de erro.

## 3. Uma máquina de estado por lista

Qual cartão está aberto é estado da LISTA, não do componente. Em
`/orcamentos` a chave é o id do projeto; em `/jobs` ela carrega o tipo
(`g:<projetoId>` na faixa, `j:<jobId>` na linha), porque a mesma tela tem
os dois. É esse state único que garante o "um por vez" e é o que deixa o
salto do cartão do job para o do projeto ser uma troca, e não um
fecha-e-abre.

## 4. A armadilha do clique e da tecla na linha clicável

As três chamadas vivem dentro de `<tr role="button">` que navega. O
Portal do Radix é um portal do **React**: o evento continua subindo pela
árvore de componentes e chegaria no `onClick` da linha. Por isso o
gatilho e o cartão param a propagação do clique.

⚠️ **No teclado, parar tudo é o erro.** A primeira versão fazia
`onKeyDown={(e) => e.stopPropagation()}` e o `Esc` deixou de fechar o
cartão: o Radix escuta a tecla no `document`, acima da árvore, e o
`stopPropagation` a engolia antes. O certo é parar **só Enter e Espaço**,
que são as teclas com que a linha navega.

## 5. Onde está

- `components/ui/descritivo-popover.tsx` — o cartão e o ícone, com o
  estado aberto/fechado recebido de fora.
- `app/(app)/orcamentos/projetos-list.tsx` e `page.tsx` — `descricao`
  entra na `ProjetoRow` e na query da lista.
- `app/(app)/jobs/jobs-list.tsx` e `page.tsx` — `observacoes` do job e
  `descricao` do projeto entram na `JobRow`; a faixa do grupo carrega a
  do projeto.

## 6. Correção que veio junto

A faixa de projeto da lista de Jobs usava `colSpan={10}` numa tabela de
**12 colunas**: a faixa morria antes de "Valor total" e "Status" e o fim
de cada linha de projeto ficava em branco. Defeito visual antigo, sem
relação com o cartão, corrigido no mesmo commit por estar no mesmo
arquivo e à vista no mesmo design.

## 7. Conferido no navegador (04/09/2026)

Nas duas listas, logado: o cartão abre pelo ícone; o clique no ícone
**não** navega a linha nem colapsa o grupo; o clique DENTRO do cartão não
fecha; clique fora, X e `Esc` fecham; abrir um cartão fecha o outro; e o
salto do cartão do job para o do projeto troca sem passar pelo fechado. A
faixa do grupo bate 12/12/12 — colunas do cabeçalho, `colSpan` da faixa e
`td`s da linha de job.

⚠️ **O que NÃO deu para conferir, e por quê.** A aba que eu dirijo fica
`document.visibilityState === "hidden"`, e o Chrome congela animação CSS
ali. Efeito colateral: o `Presence` do Radix espera um `animationend` que
não chega, e o nó do cartão fica pendurado no DOM depois de fechado.
**Não é deste componente** — reproduz igual no `DatePicker` de
`/orcamentos/novo`, que é anterior a esta decisão, e some quando se
desliga a animação (3 ciclos abrir/fechar, nenhum nó pendurado). Fica
para o Tiago o olho na animação de fade em aba em primeiro plano; o
comportamento funcional está conferido.
