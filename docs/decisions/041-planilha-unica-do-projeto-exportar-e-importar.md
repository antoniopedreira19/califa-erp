# 041 — A planilha única do projeto: exportar vários orçamentos e trazê-la de volta como versão nova

**Data:** 2026-09-03
**Status:** aceita
**Contexto:** página do projeto (`/orcamentos/[projetoId]`) e visão
agregada (`/orcamentos/[projetoId]/agregado`). Design de referência:
`Exportar e Exibir - Projeto e Visao Agregada.dc.html` (projeto Claude
Design `69342d83`). Regras definidas pelo Tiago em 03/09/2026.

## O problema

O cliente recebe **um** orçamento. Para a agência, esse orçamento são
vários — um por entregável, cada um virando um job próprio quando
aprovado. Até aqui só se exportava a versão de um orçamento por vez, e
o gerente montava a consolidação à mão. E, quando o cliente devolvia a
planilha mexida, cada mudança tinha que ser redigitada versão a versão.

## A mudança em quatro frases

1. **Exportar** a partir do projeto gera **uma planilha só**: os
   orçamentos marcados entram em sequência, cada um numa seção, e o
   fechamento no fim é único. Para o cliente é um orçamento.
2. A planilha sai com **fórmulas do Excel** e com o **id de cada linha**
   numa coluna escondida.
3. **Importar** a mesma planilha, depois de editada, cria **uma versão
   nova só nos orçamentos que mudaram**, com o orçado da planilha e o
   **planejado da versão anterior**.
4. **Exibir**, na visão agregada, é filtro de tela: cards e Totais
   seguem a seleção; nada é salvo.

## 1. A exportação

### Uma planilha, seções por orçamento, um fechamento

O arquivo tem uma aba. O cabeçalho é o do **projeto** (código, nome,
cliente, data). Cada orçamento marcado é uma **seção** com linha de
título em azul escuro (`código · nome - V{n}`) e subtotal próprio;
dentro dela, os grupos e itens no layout de sempre. No fim, um bloco
único de SUB-TOTAL por tipo, TOTAL, IMPOSTO, HONORÁRIOS e FATURAMENTO.

A alternativa era **uma aba por orçamento** — foi o que o design
sugeriu e o que a primeira entrega fez. Perdeu porque o cliente veria N
abas, ou seja, N orçamentos; o pedido era que ele visse um.

### Qual versão sai

A **aprovada** e, sem aprovada, a **mais recente** que não foi
cancelada — a mesma regra do "Valor do Job" da página do projeto, da
versão vigente da visão agregada e da aba padrão da tela do orçamento
(decisão 023). Vive em `lib/calculos/versao-vigente.ts`.

### O que sai no fechamento

O lado **bruto** de cada orçamento (decisão 028), somado: a planilha do
cliente mostra o orçamento como foi fechado, com as linhas em save
incluídas. É o número que o seletor mostra ao lado de cada orçamento.

Cada seção fecha com **os seus** percentuais de honorários e imposto.
Quando todos coincidem, HONORÁRIOS e IMPOSTO são fórmulas diretas sobre
os SUB-TOTAIS e o rótulo traz o percentual ("HONORÁRIOS 13%"). Quando
diferem, cada linha é a **soma de uma parcela por seção**, cada parcela
com a sua taxa, e o rótulo fica sem percentual — não há um só a mostrar.

### Fórmulas

TT de item (`C×D×E`), subtotal de grupo e de seção (`SUM`), SUB-TOTAL
por tipo (`SUMIF` sobre a coluna do tipo), TOTAL, HONORÁRIOS, IMPOSTO em
gross-up (`base × taxa ÷ (1 − taxa)`) e FATURAMENTO. Os tipos que entram
em cada fórmula são **derivados de `REGRAS_TIPO_CUSTO`** — tipo novo na
matriz entra sozinho. Toda fórmula sai com o resultado em cache, para
quem lê sem recalcular. A exportação de **versão única** passou a ter as
mesmas fórmulas (decisão do Tiago, 03/09/2026).

### Ids ocultos

A coluna **H**, escondida, carrega `orc:<id>|v:<id>` no título da
seção, `grp:<id>` na linha do grupo e `it:<id>` na linha do item. Na
exportação de versão única, sem linha de seção, o `orc:|v:` vai na
coluna H da linha 1. É com isso que a importação casa cada linha de
volta, mesmo depois de o cliente reescrever descrições ou reordenar.

### O que não sai

- **Job aberto.** A linha fica em alerta no seletor, o rodapé trava e o
  aviso oferece desmarcar. A rota recusa também: a regra não mora só na
  tela.
- **Orçamento sem versão** — não há o que exportar.
- **Cancelado** não aparece no seletor.

**Aprovado sai, com confirmação**: "Exportar orçamento aprovado?" — a
planilha sai da versão aprovada vigente. Enviado para abertura conta
como aprovado para esse fim.

## 2. A importação

### Só os orçamentos alterados

A planilha volta pela mesma tela (página do projeto ou visão agregada).
O preview compara cada seção com a **versão vigente de hoje** do
orçamento e diz, um a um, o que vai acontecer. Só quem tem alteração de
conteúdo ganha **versão nova em rascunho** (v+1). Quem não mudou não
ganha nada. Reordenar linhas sem mudar valor não é alteração.

Alteração de conteúdo é: descrição, tipo de custo, R$, QT, D/M, grupo
(mover, renomear, criar, apagar), linha nova e linha apagada.

### Como uma linha é casada

1. Pelo **id** da coluna oculta.
2. Sem id, pela **descrição** dentro do mesmo grupo, entre as linhas
   ainda não casadas — a reserva para quando a coluna oculta foi
   apagada. O preview conta quantas linhas entraram por aí.
3. Sem par, a linha é **nova**.

Linha da versão sem par na planilha foi **apagada**.

### O que cada linha leva para a versão nova

| Linha | Orçado | Planejado |
|---|---|---|
| Casada, alterada | o da planilha | **o da versão anterior** |
| Casada, igual | igual | igual |
| Nova | o da planilha | **zerado** |
| Apagada | — | vai embora com ela |

Linha casada leva também categoria, rastro (`planilha_origem`) e a
marca de save. Linha nova nasce com a marca de save que a versão dá a
linha nova (`save_por_padrao`). **BVs e consumos de save não são
copiados** — como no "Duplicar versão".

Em `A` e `D` o planejado **espelha o orçado** por trigger
(`trg_planejado_espelha_orcado`, decisão 022): a linha casada desses
tipos chega com o orçado novo e o banco põe o planejado igual a ele.
"Preservar o planejado" vale para os tipos que têm planejado próprio —
`AR`, `B`, `C`, `F` e `FI`.

Honorários, imposto, moeda e câmbio vêm da **versão**, nunca da
planilha: a planilha do cliente nem os tem por orçamento.

### Aprovado tem a aprovação desfeita

Orçamento **aprovado** com alteração recebe a versão nova e, em seguida,
tem a aprovação desfeita pelo mesmo caminho do "Cancelar aprovação" da
tela (`cancelarAprovacaoVersao`): a versão aprovada volta a `em_revisao`,
o orçamento também, e a versão nova passa a ser a vigente. A ordem é de
propósito — a versão primeiro, a desaprovação depois: se a segunda
falhar, sobra um rascunho a mais num orçamento ainda aprovado, que é
inofensivo; o contrário deixaria um orçamento desaprovado sem a versão
que justificava. O preview avisa antes, em destaque.

### Quem não recebe versão

- **Job aberto** — nem exporta, nem importa.
- Qualquer orçamento que **já virou job** (`job_criado`), inclusive o
  que o financeiro rejeitou: é a mesma trava do "Nova versão" e do
  "Duplicar". ⚠️ Esse caso é exportável (o funil o mostra como
  aprovado) mas não importável — apontado ao Tiago em 03/09/2026.
- **Cancelado.**
- Seção **sem identificação** (a coluna oculta foi apagada, ou a planilha
  não é a exportação deste projeto) e orçamento **de outro projeto**.
- Orçamento **sem versão** para comparar.

### Cada orçamento é uma unidade

Não há transação entre orçamentos. Se um falhar no meio, a versão dele é
apagada e a importação para ali, dizendo o que já entrou. O que ficou
gravado é versão íntegra. O arquivo sobe **uma vez** para o bucket e
cada versão criada aponta para ele em `orcamento_importacoes`.

## 3. Exibir

Só na visão agregada. Cards e linhas de Totais seguem a seleção; os três
indicadores do topo (Valor do job, Custo planejado, Resultado geral) são
do projeto inteiro e não seguem. Uma faixa avisa "Exibindo N de M" com
"Exibir todos". O que está escondido continua entrando no "Salvar
alterações" como estava, e orçamento criado na sessão sempre aparece.

## O que NÃO mudou

- A importação da planilha **oficial** da agência (`parser-oficial.ts`),
  pela tela do orçamento e pela tela da versão, continua como estava
  (decisão 007). O parser da planilha do projeto é outro
  (`parser-projeto.ts`), porque o layout é outro.
- `REGRAS_TIPO_CUSTO`, o fechamento (decisão 003) e o save (028).
- O "Valor do Job" da tabela do projeto.

## Onde a regra mora

| Arquivo | O quê |
|---|---|
| `lib/exportacao/planilha-orcamento.ts` | A planilha: seções, fechamento, fórmulas, ids ocultos |
| `lib/calculos/versao-vigente.ts` | Qual versão sai e qual é comparada |
| `app/api/orcamentos/[projetoId]/export/route.ts` | Exportação consolidada, com as travas |
| `app/api/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/export/route.ts` | Exportação de versão única, sobre o mesmo gerador |
| `lib/importacao/parser-projeto.ts` | Leitura da planilha exportada |
| `lib/importacao/diff-projeto.ts` | O plano: casamento, alterações, planejado preservado |
| `app/(app)/orcamentos/_selecao/importar-actions.ts` | Preview e gravação, com as travas e a desaprovação |
| `app/(app)/orcamentos/_selecao/` | Os seletores Exibir e Exportar e o drawer de importação |

## O que ficou de fora, de propósito

- **Importar uma planilha que traga orçamento novo.** Seção sem id é
  recusada; orçamento novo nasce pelo "Novo orçamento".
- **Alterar honorários, imposto ou tipo de custo pela planilha** — tipo
  é lido, mas honorários e imposto não.
- **Trazer o planejado da planilha.** A planilha do cliente não tem
  planejado; a versão nova o herda da anterior.
