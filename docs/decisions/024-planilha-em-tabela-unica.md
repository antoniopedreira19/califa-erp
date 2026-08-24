# 024 — A planilha virou uma tabela só, e o agrupamento virou uma linha

**Data:** 2026-08-24
**Status:** aceita
**Contexto:** todas as planilhas do produto — orçamento (versão,
rascunho, agregada do projeto), planilha interna do job, conferência do
financeiro e visão agregada de jobs do projeto. Design de referência:
`Planilha Interna - Grupos Unificados.dc.html` (projeto Claude Design
`69342d83`), telas `2a Orçamento` e `1b Job`. Decisões do Tiago em
24/08/2026.

## A mudança em quatro frases

1. **Um card e uma tabela por planilha**, e não um card por agrupamento.
   Um cabeçalho de colunas, uma calha de números.
2. **O agrupamento virou uma linha de 40px** — nome à esquerda, subtotal
   já alinhado à coluna Total de cada bloco. Era o `<tfoot>` de um card
   inteiro.
3. **A rentabilidade do PLANEJADO e do REALIZADO ocupa o vão vazio do
   próprio bloco**, à esquerda do total, em vez de abrir uma sublinha
   "Rentabilidade" embaixo.
4. **A tabela fecha com o total da planilha**, no `<tfoot>`.

Nada mudou nos cálculos, nas regras de aprovação, no BV (decisão 022) nem
no que cada tela informa. É entrega de tratamento visual.

## 1. O que o handoff pedia e não foi seguido

Duas coisas, ambas decididas pelo Tiago antes de codar:

**Cores.** O handoff repinta os blocos na tela de orçamento — ORÇADO
grafite, PLANEJADO azul, RENTABILIDADE verde — mantendo azul/verde/laranja
na do job. O mesmo bloco ficaria com duas cores conforme a tela, contra a
regra "uma cor por bloco, a mesma em todo o produto" da decisão 015.
**Mantida a paleta atual**: ORÇADO azul, PLANEJADO verde, REALIZADO
laranja, RENTABILIDADE grafite, em toda tela. Do handoff veio só a
estrutura.

**Grade do card de Totais.** O handoff dá ao Totais um `colgroup` próprio
(7 colunas no orçamento, 8 no job) em que as colunas Total **não** caem
sob as da planilha acima. É exatamente o defeito que custou uma semana à
visão agregada de jobs em agosto. **Mantido o colgroup compartilhado**
(`_planilha/grade-*.tsx`). A consequência é que, no Totais, a
rentabilidade também mora no vão do bloco em vez de ganhar colunas
próprias — mesma leitura da planilha, e o eixo vertical se sustenta.

## 2. Por que uma tabela só

Cada card de grupo repetia o `<thead>` inteiro: a faixa ORÇADO /
PLANEJADO / REALIZADO e a linha de R$ Unit. · QT · D/M · Total, três ou
quatro vezes na mesma tela. Numa planilha de 9 agrupamentos isso é 9
cabeçalhos idênticos empilhados, e o olho perde qual coluna está lendo
justamente onde mais precisa dela.

A visão agregada de jobs (`planilha-job-card.tsx`) já era assim desde
agosto — um bloco por job, agrupamento em linha. Esta entrega é as outras
planilhas alcançando o formato que aquela tela já tinha.

## 3. Onde ficaram as ações do grupo

- **Renomear** — lápis ao lado do nome, dentro da linha do grupo.
- **Remover** — lixeira na calha à direita, na altura da linha do grupo,
  no mesmo eixo vertical das lixeiras de item (uma vaga vazia da largura
  do BV é reservada para isso).
- **Contador de itens** — dentro da linha, ao lado do nome. Saiu da
  calha.

O handoff desenha a linha do grupo só com chevron + nome + contador, sem
dizer onde renomear e remover iriam parar. A divisão acima é decisão do
Tiago (24/08/2026): o lápis na linha, a lixeira na calha.

## 4. "Novo grupo" desceu para dentro da tabela

Era um botão sólido na barra de ações da página. Virou uma **linha
tracejada no pé do corpo da tabela**, depois do último grupo e antes do
total — mostra onde o grupo vai nascer e fecha a simetria com o
"＋ Novo item" que encerra cada agrupamento.

O gesto não mudou: a linha continua abrindo o mesmo `NovoGrupoDrawer` (ou
chamando o `onNovoGrupo` local, no rascunho). Só a forma do gatilho mudou,
via a variante `"tracejada"`. Sem nenhum grupo ainda não há linha
tracejada onde encaixá-lo: ali ele volta a ser o botão sólido, dentro do
estado vazio.

## 5. A navegação passou a atravessar os grupos

Com cada grupo numa tabela própria, o Tab morria na última célula do
grupo. Agora a planilha é **uma sequência só**: o Tab que sai do último
item de um agrupamento cai no primeiro do seguinte, e o Enter desce
igual. **Grupo recolhido é pulado** — ele não tem linha na tela, então
fica fora da lista de linhas navegáveis.

Foi decisão explícita do Tiago (24/08/2026), e é o comportamento de
planilha de verdade.

## 6. A calha deixou de contar linhas e passou a medi-las

Enquanto todas as linhas tinham a mesma altura (`h-7`), alinhar a calha
era aritmética: sabia-se onde o `<tbody>` começava e empilhavam-se caixas
dessa altura (`railTop`). Isso não sobrevive à tabela única — a linha do
grupo tem 40px, a de item 28, a do "Novo item" 30, e o PLANEJADO na vista
Líquido cresce mais um degrau por causa da sub-linha do BV. Altura chutada
erra alguns pixels em cada troca de trecho, e o erro **se acumula**: no
terceiro agrupamento a lixeira já aponta para a linha errada.

A saída é medir. Cada `<tr>` que quer companhia se marca com
`data-calha="<chave>"` e `app/(app)/_planilha/calha.tsx` lê a posição real
dela. Funciona com qualquer altura, inclusive as que mudam depois de
renderizadas (recolher um grupo do meio move tudo que está abaixo).

A regra de sempre continua: **a calha nunca alarga a tabela**. Ela é
`absolute left-full`, e quem reserva o espaço é a página, com o `pr-` do
tamanho exato — `pr-[116px]` no job, `pr-[154px]` no orçamento.

## 7. Ajuste de tipografia contra o handoff

O handoff usa 14px no total do rodapé. As nossas colunas de moeda são
mais estreitas que as dele (8,5% de 1160px contra 8,5% de 1560px) e a
14px `R$ 526.500,00` transborda numa tabela `table-fixed`. Ficou em
**13px**, que é o tamanho que o subtotal já usava e que a tela já provava
caber.

Pelo mesmo motivo, a rentabilidade no vão é **empilhada** (rótulo em
cima, número embaixo) em vez de numa linha só como no handoff: em linha
ela mede ~155px num vão de ~157px e transborda por cima do total ao lado.
Empilhada, o número mais largo mede ~120px.

## 8. Uma coluna que já estava estreita demais

A coluna **Rentab. R$** do orçamento era a única da planilha que carrega
sinal negativo, e a 9,5% ela não comportava `-R$ 117.500,00`: no piso de
1060px isso é 101px de célula para 122px de número, e numa tabela
`table-fixed` o excedente **transborda por cima da coluna vizinha**. O
card de Totais, que usava 14px, transbordava ainda mais.

Já era assim antes desta entrega — o total no pé da tabela só tornou o
defeito visível em mais um lugar. Corrigido na grade compartilhada
(`grade-orcamento.tsx`): Rentab. R$ foi de **9,5% para 11,5%**, e o
espaço saiu do `%`, que nunca passa de `-99,9%` (5,5% → 4,5%). O rodapé
do card de Totais desceu de 14px para 13px, igualando o da planilha.

## 9. Arquivos

| O quê | Onde |
|---|---|
| Calha medida por linha | `app/(app)/_planilha/calha.tsx` |
| Rentabilidade no vão do bloco | `app/(app)/_planilha/rentabilidade-inline.tsx` |
| Linha do grupo, linha do total, botão do "Novo grupo" | `app/(app)/_planilha/blocos.ts` |
| Planilha do orçamento (todos os grupos) | `.../versoes/[versaoId]/itens-table.tsx` |
| Nome e lixeira do grupo (versão) | `.../versoes/[versaoId]/grupo-linha.tsx` |
| Nome e lixeira do grupo (rascunho) | `app/(app)/orcamentos/_rascunho/grupo-rascunho-linha.tsx` |
| Planilha do job (todos os grupos) | `app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx` |

Saíram: `grupo-card.tsx`, `grupo-rascunho-card.tsx` e `job-grupo-card.tsx`
— os três só existiam para dar moldura a um agrupamento.
