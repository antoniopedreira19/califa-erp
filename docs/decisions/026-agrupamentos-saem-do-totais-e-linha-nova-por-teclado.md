# 026 — O Totais perdeu a tabela de agrupamentos, e a linha nova nasce pelo teclado

**Data:** 2026-08-25
**Status:** aceita
**Contexto:** card de Totais da versão do orçamento
(`versoes/[versaoId]/totais-card.tsx`) e do job
(`jobs/[jobId]/realizado/job-totais-card.tsx`, que serve o Realizado do
job e a conferência da abertura no financeiro); planilha editável do
orçamento (`versoes/[versaoId]/itens-table.tsx`, compartilhada com o
rascunho). Decisões do Tiago em 25/08/2026.

## A mudança em três frases

1. **A tabela de agrupamentos saiu do card de Totais.** Depois da decisão
   024 ela repetia o que "Recolher todos" já mostra na própria planilha.
2. **A dica de teclado saiu de dentro do card** da planilha e virou texto
   solto logo abaixo dele.
3. **Enter e ↓ na última linha de um agrupamento abrem o "＋ Novo item"
   dele**, e a linha nova em branco some sozinha.

Nada mudou nos cálculos, no BV (decisão 022), na aprovação nem no que se
grava. Fechamento por tipo de custo, Resultado, "Composto por" e
Resultado geral continuam idênticos.

## 1. Por que a tabela de agrupamentos ficou redundante

Até a decisão 024, cada agrupamento era um card com `<tfoot>` próprio, e
ler "quanto cada grupo custa, lado a lado" exigia rolar a tela inteira
comparando rodapés distantes. A tabela do Totais existia para isso.

Com a planilha em tabela única, **o subtotal do grupo mora na própria
linha do agrupamento**, já alinhado à coluna Total de cada bloco.
"Recolher todos" deixa exatamente a lista de agrupamentos com os
subtotais, na mesma grade — a mesma leitura, no lugar onde a pessoa já
está. A tabela do Totais virou uma segunda cópia do mesmo número, com o
custo de manter duas grades em sincronia.

Vale para os **dois** cards: o da versão (ORÇADO × PLANEJADO ×
RENTABILIDADE) e o do job (ORÇADO × PLANEJADO × REALIZADO), este último
visível no Realizado do job e na conferência da abertura. As duas telas
têm "Recolher todos" desde 21/08/2026.

Consequência de escopo: o `JobTotaisCard` **não recebe mais `visao`**. A
chave Bruto ⇄ Líquido continua valendo para a planilha acima dele; dentro
do card, o que restou (fechamento por tipo de custo e Resultado) lê o
custo bruto e mostra o BV como linha própria — por isso já dava o mesmo
número nas duas vistas. O `TotaisCard` da versão continua recebendo
`visao`: a rentabilidade do "Composto por" é calculada na vista ativa.
Os dois deixaram de receber `grupos`.

## 2. A dica de teclado saiu do card

"Clique em qualquer célula para editar · Tab e as setas andam · Enter
desce · Esc desfaz" era uma faixa cinza colada no rodapé do card, logo
abaixo do TOTAL DO ORÇAMENTO. Ali dentro ela lia como se fosse mais uma
linha da planilha. Virou **texto solto embaixo do card**, mesma fonte e
mesmo tamanho (`text-[11px] text-muted-foreground`) — instrução de uso,
não conteúdo da tabela.

Efeito colateral estrutural: **o card da planilha passou a ser desenhado
dentro da `ItensTable`**, e não pelo chamador. Um componente não consegue
devolver nada fora de um card que quem o chama é que desenha.
`grupos-section.tsx` e `orcamento-card.tsx` pararam de envolver a tabela
com `rounded-2xl border bg-card shadow-soft`; a `ItensTable` fundiu essas
classes no mesmo `div` que já era o `relative` da calha. A calha continua
`absolute left-full` sobre esse `div`, e as posições continuam medidas em
relação a ele — ver decisão 024, item 6.

## 3. A linha nova pelo teclado

**Enter (ou ↓) na última linha de um agrupamento abre o "＋ Novo item"
dele**, em vez de cair no primeiro item do grupo de baixo. O cursor vai
para a **descrição**, e não para a coluna de onde se veio: é o campo sem
o qual a linha não pode ser gravada. Decisão do Tiago, 25/08/2026 —
quebra de propósito a semântica de "Enter desce na mesma coluna", porque
o gesto aqui é *acrescentar item*, não *andar*.

O Tab não mudou: ele continua atravessando os agrupamentos (decisão 024,
item 5).

**Quando a linha some.** A regra de gravação é a de sempre: sem
descrição, o banco recusa, então a linha fica local até ter texto. O que
entrou agora é o descarte automático — a linha em branco some no **Esc**
e em **qualquer clique fora dela**. "Em branco" é *nenhum campo mexido*
(decisão do Tiago): Tipo B, 0 · 1 · 1, sem categoria. Digitou qualquer
coisa — inclusive um valor sem descrição —, a linha fica na tela até a
pessoa decidir, e sai pelo X da calha.

Quatro detalhes que a implementação precisou respeitar:

- **O descarte espera um tique.** O `pointerdown` chega ANTES do `blur`,
  e o campo em edição só entrega o que foi digitado no `blur`. Descartar
  na hora apagaria a descrição recém-digitada antes de ela ser gravada —
  o teste roda num `setTimeout(…, 0)`, já com o estado que o `blur`
  escreveu.
- **O listener é de mount (`[]`), e lê o rascunho por ref.** Este foi um
  defeito de verdade, visto no navegador em 25/08/2026: com o efeito
  dependendo de `draft`, o `setDraft` do `blur` — que devolve um objeto
  NOVO — reinscrevia o efeito, e a limpeza cancelava o `setTimeout` que
  o `pointerdown` acabara de agendar. A linha em branco ficava na tela.
  Passava despercebido em teste sintético (`dispatchEvent` sem troca de
  foco não dispara `blur`, então nada se reinscrevia) e só aparecia com
  clique de gente.
- **O menu do Radix abre em portal, fora da tabela.** Escolher um Tipo é
  um `pointerdown` fora da linha; sem excluir
  `[data-radix-popper-content-wrapper]`, escolher "B" mataria a linha.
- **"＋ Novo item" de outro grupo não fica mais travado** por um rascunho
  em branco: o clique descarta o antigo e abre o novo. Rascunho já
  mexido continua bloqueando, porque tem conteúdo a perder.

## 4. Arquivos

| O quê | Onde |
|---|---|
| Totais da versão, sem a tabela de agrupamentos | `.../versoes/[versaoId]/totais-card.tsx` |
| Totais do job (Realizado + conferência), idem | `app/(app)/jobs/[jobId]/realizado/job-totais-card.tsx` |
| Card da planilha, dica fora dele, teclado da linha nova | `.../versoes/[versaoId]/itens-table.tsx` |
| Deixaram de desenhar o card da planilha | `.../versoes/[versaoId]/grupos-section.tsx`, `app/(app)/orcamentos/_rascunho/orcamento-card.tsx` |
| Pararam de passar `grupos`/`visao` ao Totais | `.../versoes/[versaoId]/planilha-versao.tsx`, `jobs/[jobId]/realizado/job-realizado-section.tsx`, `financeiro/abertura-de-job/[jobId]/planilha/planilha-conferencia.tsx` |
