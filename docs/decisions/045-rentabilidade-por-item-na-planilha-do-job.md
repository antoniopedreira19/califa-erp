# 045 — Rentabilidade por item na planilha do job, e o "Exibir" que liga de verdade

**Data:** 2026-09-03
**Status:** aceita
**Contexto:** a planilha interna do job (`/jobs/[jobId]`, aba "Planilha
Interna", e a mesma seção em `/financeiro/jobs/[jobId]`). Design
`Planilha Interna do Job - Rentabilidade por Item.dc.html`, turno 1b
(projeto Claude Design `69342d83`, lido pelo `DesignSync`). Continua a
decisão 042, que fez o mesmo pelo orçamento. Decisões do Tiago em
03/09/2026.

## A mudança em quatro frases

1. **Rentabilidade vira coluna.** Cada bloco de custo ganha duas colunas
   no fim — **Rentab. R$** e **Rentab. %** — dentro da própria faixa
   (PLANEJADO e REALIZADO passam a cobrir 6 colunas). Valores em grafite
   (`RENTAB_VALOR`); a cor do bloco fica no cabeçalho, na faixa e no
   Total.
2. **Nascem fechadas.** Com as duas desligadas a planilha é a de sempre:
   o "rentab." continua no vão da linha de grupo e do total. Ligada uma
   delas, o "rentab." daquele bloco sai do vão — a informação passa a ter
   um lugar só a cada momento.
3. **O menu "Exibir" liga de verdade.** Save (como está) · **Orçado**
   liga/desliga · **Planejado** sempre visível · **Realizado** sempre
   visível · seção "Rentabilidade" com *planejada* e *realizada*.
4. **A realizada de grupo e total conta só os itens com PP.** Item com
   orçado e sem realizado fica fora da base e marca a conta com `*`.

## 1. Por que Realizado não sai (e Planejado também não)

O realizado é por onde se acompanham as PPs do job — é o bloco que a
produção olha o dia inteiro. O planejado é o custo com que ele se
compara. Sem um dos dois a planilha do job perde a razão de existir; o
único bloco dispensável na leitura do dia a dia é o Orçado, que está
congelado desde a aprovação.

Uma exceção: **a errata edita o Orçado.** Ligar "Alterar orçado" traz o
bloco de volta à tela, esteja escondido ou não, e enquanto a errata está
ligada o item do menu vira só leitura, com a dica "Na errata o Orçado
fica sempre aberto."

## 2. A realizada parcial — a decisão que o design deixou pendente

Item sem PP emitida tem realizado em branco, então a rentabilidade
realizada dele é "–". A dúvida era o grupo e o total. Com os números do
próprio design (Novo Grupo 2: Item 1 A 34.000/34.000, Item 2 AR
22.000/15.000, Item 3 B 25.000/sem PP):

| Conta | Base | Custo | Rentab. |
|---|---|---|---|
| somando tudo | 81.000 | 49.000 | R$ 32.000 · 39,5% |
| **só itens com PP (escolhida)** | 56.000 | 49.000 | R$ 7.000 · 12,5% |

Somar tudo infla a margem como se o custo do Item 3 não fosse acontecer.
A conta escolhida usa só quem já tem realizado, e marca o resultado com
`*` (e um `title` explicando) sempre que deixou item de fora. A regra
exata, em `rentabilidadeRealizadaDe`:

- entra na base e no custo: item com `realizado.bruto > 0`;
- marca parcial: item com `orcadoRentabilidade > 0` e sem realizado
  (está esperando PP);
- **linha vermelha** (sem orçado, só realizado) entra pelo custo — é o
  imprevisto que ela é;
- **linha em save** (sem base e sem custo) não conta para nada;
- nenhum item com realizado ⇒ "–" em vez de "R$ 0,00 · 0%".

A **planejada** de grupo e total não muda de conta: é a mesma de sempre
(`orcadoRentabilidade` × planejado na vista), só que agora em coluna.

## 3. A grade cresce, e o piso cresce junto

A grade do job (`_planilha/grade-job.tsx`) passou a ter 15 a 20 colunas.
As larguras continuam sendo os mesmos percentuais de sempre, agora como
**pesos**: quando uma coluna entra ou sai, os pesos dos que ficaram são
renormalizados para a mesma soma (96,5%), e o default continua bit a bit
o de antes. São 16 combinações — por isso as larguras vão em `style`, e
não em classe: o Tailwind varre o fonte, e classe montada em template
string não existiria no CSS.

O piso de largura (`larguraMinimaJob`) acompanha: 1160px de sempre, +40
com Save, +170 por par de rentabilidade, −256 com o Orçado escondido.
Com tudo ligado a tabela passa de 1500px e rola na horizontal dentro do
card — é o que o design faz (`min-width: max-content`). Com o Orçado
escondido e as duas rentabilidades ligadas ela volta a caber.

## 4. O que NÃO mudou

- **Estado de tela.** Nada vai para o banco nem para a URL.
- **Nenhum número.** Ligar coluna não muda Totais, fechamento nem os
  "rentab." das linhas — é a mesma conta em outro lugar.
- **A conferência do financeiro** (`/financeiro/abertura-de-job/[id]/planilha`)
  usa a mesma tabela com os defaults: segue idêntica.
- **A visão agregada de jobs do projeto** (`/jobs/projeto/[id]`) ficou
  para depois, por decisão do Tiago: lá o card de Totais divide o
  `colgroup` com os blocos, e cada coluna tem que atravessar as duas
  tabelas.

## Arquivos

- `app/(app)/_planilha/grade-job.tsx` — `ColunasJobVisiveis`, pesos,
  `larguraMinimaJob`, `totalDeColunasJob`.
- `app/(app)/_planilha/exibir-colunas.tsx` — `titulo`, `dica` e `secoes`
  no menu.
- `app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx` —
  guardas do Orçado, `CabecalhosRentabilidade`, `CelulasRentabilidade`,
  `rentabilidadeRealizadaDe`, legenda.
- `app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx` — estado
  dos três liga/desliga e o menu com a seção "Rentabilidade".
