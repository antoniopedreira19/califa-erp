# 047 — O resumo do cabeçalho mostra o resultado operacional, não o custo

**Data:** 2026-09-04
**Status:** aceita
**Contexto:** os resumos ancorados à direita do título — o do detalhe do
job (`/jobs/[jobId]`), o da visão agregada do projeto
(`/jobs/projeto/[projetoId]`), os dois espelhos no financeiro
(`/financeiro/jobs/[jobId]` e `/financeiro/projetos/[projetoId]`) e o do
orçamento (`/orcamentos/[projetoId]/[orcId]`, a agregada e o rascunho
multi-jobs). Decisão do Tiago em 04/09/2026.

## A mudança em três frases

1. **O número do meio deixa de ser o custo.** Onde se lia
   `PLANEJADO · R$ 8.000,00` agora se lê
   `RESULTADO OP. (PLANEJADO) · R$ 3.300,00`. O mesmo no realizado e, no
   orçamento, no bloco único.
2. **A rentabilidade fica.** A linha continua fechando com
   `rentab. 23,5%` — resultado operacional e rentabilidade são o mesmo
   fato em R$ e em %, o par que a planilha já usa desde a decisão 045.
3. **O R$ ganha cor semântica.** Verde no positivo, vermelho no negativo,
   como o "Resultado operacional" do card de Totais. O custo era neutro
   porque custo não tem sinal; resultado tem.

## Por que

O custo é o que sai. Sozinho ele não responde a pergunta que se faz ao
abrir um job — *isto fecha?* — e obrigava quem lia a fazer a subtração de
cabeça contra o Valor do Job, sem os impostos, que não estavam na tela.
A rentabilidade em % já respondia, mas em percentual: `23,5%` de um job
de R$ 14 mil e de um de R$ 1,4 milhão são conversas diferentes. O
resultado operacional em R$ é a resposta na unidade em que se decide.

O custo não desaparece do sistema: ele continua no card de Totais, na
planilha e na linha `− Custo planejado` do painel de Resultado, que é
onde se audita a conta. O cabeçalho passa a mostrar o resultado dela.

## A conta é a mesma

`calcularResultadoOperacional(valorJob, imposto, custo − bvLíquido)` de
[`lib/calculos/versao-totais.ts`](lib/calculos/versao-totais.ts) segue
sendo a única implementação. Ela já devolvia `resultadoOperacional` e
`resultadoGeral` juntos — os cabeçalhos só descartavam o primeiro. Não há
cálculo novo, nem migration, nem mudança de dado.

Retorno `null` quando o custo é `<= 0` continua valendo: travessão e a
legenda "sem planejado" / "sem realizado", nunca um resultado inflado
pelo faturamento inteiro.

**Conferência no JOB-0029 ("Job 2"), com os números do banco:** valor do
job R$ 14.042,50, imposto R$ 2.742,50, planejado R$ 8.000,00, realizado
R$ 10.000,00 → resultado op. planejado **R$ 3.300,00 · 23,5%** e
realizado **R$ 1.300,00 · 9,3%**. Os dois percentuais são exatamente os
que o cabeçalho já mostrava antes da mudança.

## No orçamento é um bloco só

Em orçamento não existe realizado, então o resumo mantém os três blocos —
**Valor do Job · Resultado Op. (Planejado) · Rentab. (%)** — e só o do
meio muda de conteúdo. O rótulo diz **(Planejado)**, e não
"(Orçado)", porque o número sai do custo do bloco PLANEJADO da planilha:
com custo **orçado** a conta daria exatamente os honorários, que é a
razão registrada no handoff do orçamento para o resumo nunca ter usado o
orçado.

## Layout

O rótulo cresceu de `PLANEJADO` (74px reservados) para
`RESULTADO OP. (PLANEJADO)`, que mede **176px** em Inter Bold 10.5px com
`tracking-[0.07em]` — medido no navegador, não estimado. A coluna foi
reservada nesse valor exato para o `gap-5` de 20px sobreviver: com 162px
o rótulo encostava no número.

O card do job passa de ~578px para **694px** (729px com valor de sete
dígitos e resultado negativo). Cabe: o cabeçalho é `flex-wrap` com a
coluna do título em `flex-1 min-w-0`, então quem cede espaço é o título,
e no pior caso o resumo desce para a própria linha.

## Arquivos

| Arquivo | O que mudou |
| --- | --- |
| [`components/resumo-resultado.tsx`](components/resumo-resultado.tsx) | job, agregada e os dois espelhos do financeiro — as duas linhas |
| [`resumo-rentabilidade.tsx`](app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/resumo-rentabilidade.tsx) | orçamento — bloco do meio; prop `custoPlanejado` virou `resultadoOperacional` |
| [`orcamentos/[projetoId]/[orcId]/page.tsx`](app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx) · [`agregado/editor-agregado.tsx`](app/(app)/orcamentos/[projetoId]/agregado/editor-agregado.tsx) | passam `resultadoOperacional` |
| [`multi/editor-multi-jobs.tsx`](app/(app)/orcamentos/[projetoId]/multi/editor-multi-jobs.tsx) | o KPI "Custo planejado" do rascunho; `Kpi` ganhou `tomVermelho` |

## Addendum 2026-09-04 — o terceiro bloco chama-se "Rentab."

O bloco do percentual no resumo do orçamento vinha rotulado **"Resultado
geral"** desde que o resumo nasceu (commit `75cbb22`), enquanto o resumo
do job fecha a linha com **"rentab."**. Mesmo número, dois nomes: quem
passa de uma tela para a outra tinha de reconhecer que 30,4% ali e 23,5%
lá eram a mesma conta. Instrução do Tiago em 04/09/2026: **unificar em
"Rentab."**, que é o termo que a produção já lê nas planilhas.

Mudou em duas telas, as duas do orçamento:

| Arquivo | Antes | Agora |
| --- | --- | --- |
| [`resumo-rentabilidade.tsx`](app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/resumo-rentabilidade.tsx) | `Resultado geral` | `Rentab.` |
| [`multi/editor-multi-jobs.tsx`](app/(app)/orcamentos/[projetoId]/multi/editor-multi-jobs.tsx) (KPI do rascunho) | `Resultado geral` | `Rentab.` |

Só o rótulo. A prop `resultadoGeral` e a conta seguem com o nome de
sempre — identificador de código não é string de tela.

⚠️ **"Resultado geral" continua existindo, de propósito, em três
lugares:** a linha do card de Totais
([`totais-card.tsx`](app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/totais-card.tsx)),
o [`painel-resultado.tsx`](components/painel-resultado.tsx) e a
[`legenda-fechamento.tsx`](components/legenda-fechamento.tsx), que
**define** o termo. Ali ele não é um resumo de canto: é a última linha de
uma conta que se audita de cima para baixo, e o nome está fixado na
decisão 003. Renomear nesses três é mudar vocabulário de fechamento, não
alinhar rótulo de cabeçalho — fica para uma decisão própria, se o time
quiser.
