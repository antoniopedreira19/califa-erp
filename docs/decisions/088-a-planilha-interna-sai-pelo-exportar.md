# 088 — A planilha interna sai pelo Exportar

**Data:** 2026-09-17
**Status:** aceita — implementada em 17/09/2026
**Contexto:** `lib/exportacao/*`, `lib/importacao/*`, as duas rotas de
exportação de orçamento, a rota nova `/api/jobs/[jobId]/export`, o popover
"Exportar esta versão?", o menu "Exportar orçamentos" e a barra da Planilha
Interna do job. Pedido do Tiago em 15/09/2026; design aprovado em
17/09/2026 (artifact "Planilha Interna no Exportar", P1–P20 e A1–A6).

## O problema

O Exportar do ERP só sabia fazer uma planilha: a do cliente, com o orçado e
o fechamento que termina no FATURAMENTO. Tudo que a agência olha por dentro
— o planejado, o realizado das PPs, a rentabilidade, o resultado
operacional — só existia na tela. Quem precisava levar esses números para
uma reunião, para o fechamento do mês ou para o financeiro, refazia a
planilha à mão.

## As decisões (Tiago, 16–17/09/2026)

1. **Um modo, não um botão novo.** No orçamento a escolha fica dentro do
   Exportar que já existe — "Para o cliente" (sempre marcado) ou "Interna".
   O job, que não tinha Exportar, ganha um, na barra da Planilha Interna,
   logo depois do "Exibir" (P1). A planilha do cliente **não mudou de
   comportamento**: sem `?modo=interna`, tudo sai como antes.
2. **A interna do ORÇAMENTO leva orçado + planejado; a do JOB leva também o
   realizado** (P1, P2). Orçamento com job aberto **exporta** a interna, da
   versão aprovada, sem realizado — o realizado sai pelo Exportar do job
   (P2, A3). Por isso a trava "job aberto não sai" vale só para a planilha
   do cliente.
3. **O fechamento termina no VALOR DO JOB** (P4) — nada de faturamento
   previsto, como nas planilhas que a agência importa. Havendo save, vem
   depois o **VALOR AJUSTADO (SAVE)**: `valor do job + save gerado −
   save consumido` (P17, A1). As linhas de save só existem quando o caso
   existe, uma a uma: "(−) LINHAS EM SAVE", "(+) SAVE GERADO",
   "(−) SAVE CONSUMIDO" e o ajustado.
4. **Seis sub-totais por tipo de custo: A (com AR), B, C, D, F e FI**
   (P16). F e FI ficam **separados** porque FI não gera honorários e, com
   isso, muda o valor do job — juntá-los faria a planilha mentir. Valem
   também na planilha do cliente.
5. **O realizado sai líquido de BV** (P5, A2), com uma **sublinha por PP
   não cancelada**, uma por devolução de verba e uma por BV que já conta
   (`confirmado` e `recebido`), em itálico cinza e agrupadas pelo recurso
   de tópicos do Excel — o botão de recolher fica na linha do item, e o
   arquivo abre com tudo aberto (P7, A2).
6. **Rentabilidade como na tela** (P6): por item e por total, sobre todo o
   orçado, com os itens sem PP aparecendo com realizado R$ 0,00 e
   rentabilidade cheia. Em `A` e `D` o realizado espelha o orçado, como na
   planilha interna da tela.
7. **A interna do ORÇAMENTO volta pelo Importar; a do JOB, não** (P11). O
   realizado nasce das PPs, e um arquivo não pode reescrevê-lo.
8. **Um tom por parte, em todas as planilhas** (17/09): colunas PLANILHA e
   ITEM `#3C78D8`, ORÇADO `#6D9EEB`, PLANEJADO `#6AA84F`, REALIZADO
   `#E69138`, mês `#434343`, texto branco. Na linha de grupo, A e B ficam
   no tom do orçado.
9. **No mensal, o mês vem acima de tudo** (078 + 17/09): a faixa do mês,
   e embaixo dela as faixas ORÇAMENTO/PLANEJADO/REALIZADO e o cabeçalho,
   repetidos a cada mês — o desenho da aba SUL. O resumo do trimestre fecha
   só por tipo de custo, sem repetir os meses (P20, A5).
10. **Nome do arquivo `interna-…xlsx`, aba "Interna"** (P12). Quem vê a
    tela exporta: `orcamentos.exportar` no orçamento e `jobs.ver` no job —
    o freelancer, que só tem a visão restrita, fica de fora (P13).
11. **Arquivo com mais de um orçamento: fechamentos próprios E o total**
    (Tiago, 17/09/2026), no molde do mensal — cada orçamento fecha no seu
    valor do job e, no fim, uma faixa "RESUMO" com os sub-totais somados e
    o **VALOR DO JOB TOTAL**. Com um orçamento só, o resumo não aparece.
    Cada um fecha com os SEUS percentuais e o total soma os fechamentos;
    percentual que não é o mesmo em todos sai da linha. A planilha **para o
    cliente** continua com um fechamento único agregado no fim, como
    sempre.

## Como a importação encontra os ids

Na planilha do cliente a coluna oculta dos ids é a **H**. Na interna, H..L
são o PLANEJADO e M..Q o REALIZADO, então a coluna das marcas vai para
depois do último bloco visível — a **M** no modo orçamento, a **R** no do
job. Quem diz onde ela está é a linha 1: `interna:orcamento` ou
`interna:job`.

- `lib/importacao/coluna-marcas.ts` acha a coluna (`interna:…`, senão a
  primeira com `orc:`, senão a H). Planilha antiga continua entrando.
- `interna:job` é **recusada** pelos dois parsers, com a mensagem que
  explica por quê.
- O `parser-projeto` passou a **ignorar faixa e cabeçalho repetidos**, a
  aceitar o título do mês e o da seção **antes** do primeiro cabeçalho, e o
  fechamento — inclusive o do resumo — passou a encerrar a **seção**, não o
  arquivo. É o que faz a interna do projeto, com um fechamento por
  orçamento e o resumo no fim, voltar inteira; vale também para a planilha
  mensal do cliente, que tem um RESUMO DO TRIMESTRE por orçamento.
- O `parser-oficial` lê o planejado de H..J quando a coluna do R$ planejado
  não é uma marca de id — na planilha do cliente ela é, e ali não há
  planejado.

`lib/importacao/interna.test.ts` cobre o ciclo inteiro sem banco: nacional,
internacional, mensal, projeto com dois orçamentos, a recusa do job e a
planilha do cliente de sempre.

## O que ficou de fora

- **Faturamento previsto** em qualquer interna (P4).
- **Save consumido** como linha visível: continua na coluna oculta, e a
  conta aparece no valor ajustado.
- A planilha **para o cliente** segue terminando no FATURAMENTO: é o
  documento dele.

## Onde mexe

| Arquivo | O quê |
| --- | --- |
| `lib/exportacao/planilha-interna.ts` | a aba inteira — faixas, cabeçalho, grupos, itens, sublinhas e fechamento |
| `lib/exportacao/montar-interna.ts` | o fechamento, com `calcularTotaisVersao` |
| `lib/exportacao/interna-da-versao.ts` | a versão do orçamento vira seção |
| `lib/exportacao/interna-do-job.ts` | o job vira seção, com as sublinhas do realizado |
| `lib/importacao/coluna-marcas.ts` | onde estão as marcas, e a recusa do job |
| `app/api/orcamentos/**/export` | `?modo=interna` nas duas rotas |
| `app/api/jobs/[jobId]/export` | a rota nova |
| `acoes-versao.tsx`, `exportar-orcamentos-menu.tsx`, `exportar-interna-button.tsx` | onde o modo aparece |

## Conferido em 17/09/2026

Projeto `0-0001/26 · Projeto Teste`, dev server do worktree:

- **Versão nacional (`0-0001/26-06` v2):** valor do job R$ 80.725,74,
  resultado op. planejado R$ 20.960,00 (25,96%), rentabilidade R$ 14.000,00
  (24,1%) — os mesmos números do cabeçalho da tela.
- **JOB-0029:** planejado R$ 30.000,00 → R$ 8.420,00 (20,1%); realizado
  R$ 26.950,00 → R$ 11.470,00 (27,4%), com 5 PPs, 3 devoluções de verba e
  1 BV confirmado em sublinhas, e o TT de cada item somando as sublinhas.
- **JOB-0009 (internacional):** valor do job R$ 967.830,95, save gerado
  R$ 16.977,59, ajustado R$ 984.808,54.
- **JOB-0034 (mensal):** um bloco por mês, com o realizado zerado.
- **Projeto com dois jobs abertos:** sai na interna (Job 1 R$ 147.897,60 +
  Job 2 R$ 14.042,50 = **VALOR DO JOB TOTAL R$ 161.940,10** no resumo) e é
  recusado na do cliente, como desenhado. No mensal com dois orçamentos,
  cada um leva os seus meses e o seu RESUMO DO TRIMESTRE, e o resumo do
  arquivo vem depois.
- **Volta pelo Importar:** os arquivos reais foram relidos pelos dois
  parsers — ids, grupos, tipos, meses e planejado no lugar; a do job,
  recusada.
