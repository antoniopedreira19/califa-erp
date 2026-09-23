# 095 — "Composto por" em % do valor do job, e Moeda/Câmbio fora do nacional

**Data:** 2026-09-21
**Decidido por:** Tiago
**Migration:** nenhuma — só tela e cálculo de exibição.

---

## 1. O problema

Duas leituras confusas na tela da versão do orçamento (relato do Tiago,
21/09/2026, sobre o `TES-0001/26-01` v3).

**a) As porcentagens de "Composto por" não somavam no Resultado geral.** O
bloco mostrava, à direita de cada valor:

| Linha | Valor | % mostrada | Base da % |
|---|---|---|---|
| Honorários | R$ 15.600,00 | 12,0% | a taxa do contrato |
| Rentabilidade (orçado × planejado) | R$ 28.000,00 | 21,5% | o orçado |
| **Resultado geral** | | **25,5%** | o valor do job |

Três bases diferentes numa coluna só. Quem lê soma 12,0 + 21,5 = 33,5 e não
entende por que embaixo está 25,5.

**b) "Moeda: BRL · Câmbio: 1,0000" em toda versão nacional.** Planilha
nacional é sempre em reais; os dois campos nunca mudam e só ocupavam a linha
de parâmetros. (No banco, em 21/09/2026: 15 versões, todas `BRL` / `1,0000`.)

## 2. A regra

1. **A coluna da direita de "Composto por" é a parcela em % do VALOR DO JOB**
   — a mesma base do Resultado geral. As duas parcelas somam nele:
   9,1% + 16,4% = 25,5%. A coluna ganha a legenda "% do valor do job".
2. **As porcentagens antigas não somem: vão para junto do rótulo.**
   "Honorários 12,0%" (a taxa) e "Rentabilidade (orçado × planejado) 21,5%"
   (sobre o orçado). Os dois números seguem à vista, em lugares que não se
   confundem.
3. **Moeda e Câmbio saem da linha de parâmetros do NACIONAL** — da leitura e
   do modo "Editar". O internacional não muda: lá moeda de fora, cotação,
   compra e venda continuam, porque é onde elas variam.

## 3. O arredondamento

Os três percentuais saem com uma casa. Arredondar três números separadamente
pode deixar a soma 0,1 fora do total (3,04% + 3,04% = 6,08%: separados dariam
3,0 + 3,0 contra 6,1). Como o objetivo da regra é a soma bater com o que está
escrito embaixo:

- quando `honorários + rentabilidade = resultado operacional` — o caso de
  sempre, ver [072](072-orcamento-internacional.md) —, a rentabilidade em %
  do job é **o Resultado geral já arredondado menos os honorários já
  arredondados**. O desvio máximo em relação ao valor exato é de 0,05 ponto;
- se as parcelas não fecharem o resultado, cada uma sai pelo próprio valor,
  sem ajuste.

Quem faz a conta é `composicaoDoResultadoGeral` (`lib/calculos/versao-totais.ts`),
com testes em `lib/calculos/composicao-resultado.test.ts`.

## 4. Onde vale

O bloco "Composto por" existe em dois componentes, e a regra entrou nos dois
para o mesmo número não ter duas leituras entre a tela do orçamento e a do job:

- `totais-card.tsx` — card de Totais da versão do orçamento;
- `components/painel-resultado.tsx` — Totais do job, da visão agregada de jobs
  e da visão agregada de orçamentos do projeto. Ali a coluna segue a ótica do
  seletor (planejada ⇄ realizada), como o resto do painel.

Conferido no JOB-0025: 8,6% + 71,1% = 79,7% (Resultado geral realizado).

## 5. O que ficou de fora

- As colunas `moeda` e `taxa_cambio` de `versoes_orcamento` **continuam no
  banco** e a server action continua aceitando-as: nada foi removido, só não
  há mais campo de tela para o nacional. Tirar as colunas é mudança
  destrutiva e não foi pedida.
- A exportação em planilha não mudou.

## 6. Complemento (21/09/2026, à tarde) — os outros lugares onde Moeda e Câmbio ainda apareciam

A §2.3 tirou os dois campos da linha de parâmetros da versão. Eles continuavam
em dois formulários, que o Tiago apontou no mesmo dia:

- **"Nova versão do orçamento"** (drawer do "+" → "Criar do zero");
- **"Parâmetros das versões"** (modal do ícone de % na visão agregada).

Saíram dos dois, **em todos os modelos** — não só no nacional. Nesses
formulários `moeda` e `taxa_cambio` descrevem os VALORES da planilha, que são
em reais também no internacional; o que varia lá é a moeda de fora e o câmbio
de compra, editados na linha de parâmetros da versão (decisão 072). Sem os
campos, a gravação segue no padrão de sempre — BRL e câmbio 1 —, e no modal os
dois valores atravessam o salvar pelo spread, sem que ninguém os edite.

A frase de confirmação do "Importar planilha nesta versão" também deixou de
citar "moeda e câmbio" no nacional (no internacional continua citando, porque
lá eles existem como parâmetro).

`versao-editor-drawer.tsx` ainda tem os dois campos, mas não é renderizado por
nenhuma tela desde que as versões viraram abas (decisão 023): é código morto e
ficou como estava.

