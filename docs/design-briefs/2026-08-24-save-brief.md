# Brief de design — Save

**Data:** 2026-08-24
**Para:** Claude Design — projeto `69342d83-28d9-4bea-a8af-c99e233f5f13`
**Entregar como:** `Save - Opcoes.dc.html`
**Regras de negócio:** definidas pelo Tiago em 24/08/2026

---

## O pedido, antes de tudo

Desenhe **cada tela afetada no estado "com save"**, em artboards separados.
Onde a mudança não for óbvia, ponha o **antes** ao lado do **depois**. O
objetivo é que o Tiago consiga ver como o sistema fica **antes de aprovar**.

Não desenhe componentes soltos fora de contexto. O Save não cria um módulo
novo — ele acrescenta coisas a telas densas que já existem, e o risco todo
está em como ele convive com o que já está lá.

Além das telas, produza as **variantes numeradas** da seção 4, para o Tiago
comparar e escolher.

---

## 1. O que é o Save

O cliente fecha um orçamento com a agência e, na prática, não usa todas as
linhas dele naquele projeto. Essas linhas são **faturadas assim mesmo** — o
cliente paga — e o valor fica guardado como **crédito para um projeto
seguinte**. A operação chama isso de "dar um save".

Quando esse crédito é usado num job posterior, ele **não é faturado de
novo** (já foi), mas **passa a compor o valor daquele job**, porque é lá
que o serviço de fato acontece.

Há também o caso do **orçamento de save inteiro**: um orçamento criado só
para faturar e guardar, cujo saldo será gasto depois, em vários jobs.

---

## 2. Os dois números que deixam de ser iguais

Esta é a razão de o Save mexer no design, e não só no código.

Hoje o card de Totais mostra **Faturamento previsto** e **Valor do Job** um
embaixo do outro. Na esmagadora maioria dos orçamentos eles são iguais ou
quase. Com o Save eles **divergem de propósito**, e em direções opostas nas
duas pontas:

| | Faturamento | Valor do job |
|---|---|---|
| Linha em **save** (job de origem) | entra | **não entra** |
| Linha que **consome save** (job destino) | **não entra** | entra |

### O exemplo, com números reais

Honorários 10%, imposto 19,53%.

**Job A (origem).** Duas linhas tipo B: R$ 50.000 que serão usadas e
R$ 30.000 que o cliente dispensou e viram save.

| | |
|---|---:|
| Principal que fatura | 80.000,00 |
| Honorários | 8.000,00 |
| Imposto | 21.357,52 |
| **Faturamento previsto** | **109.357,52** |
| Principal no valor do job | 50.000,00 |
| Honorários | 5.000,00 |
| Imposto | 13.348,45 |
| **Valor do Job** | **68.348,45** |
| **Saldo em save** | **30.000,00** (1 item) |

**Job B (consome).** R$ 15.000 de Criação normal + R$ 30.000 de Mídia
consumindo o save do Job A.

| | |
|---|---:|
| **Faturamento previsto** | **20.504,54** |
| **Valor do Job** | **61.513,61** |
| **Consumido de save** | **30.000,00** (do JOB-A) |

Somando os dois jobs, faturamento e valor do job dão **exatamente
R$ 129.862,06** nos dois lados. O cliente compromete o mesmo total que a
agência fatura — só que em jobs diferentes.

**O que isso pede do design:** quando os dois números divergem, a tela
precisa explicar por quê **sem legenda e sem tooltip obrigatório**. Hoje
eles são só dois valores empilhados; com save, um deles passa a ter uma
história.

---

## 3. Tela por tela — como é hoje e o que o save acrescenta

### a) Planilha da versão do orçamento

Rota: `/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]`

**Como é hoje:**

- Um **card por agrupamento**, e a tabela **abre o card** — o nome do
  agrupamento vive dentro da primeira linha do cabeçalho da tabela, em
  `colSpan={3}` sobre fundo branco, não numa barra de título própria.
- Tabela `table-fixed`, largura mínima `min-w-[1060px]`, **13 colunas**,
  altura de linha **28px** (`h-7`). Larguras em porcentagem: Item (sobra),
  4,5%, 8,5% · 10%, 3,5%, 3,5%, 11% · 10%, 3,5%, 3,5%, 11% · 9,5%, 5,5%.
- **Cabeçalho em duas linhas.** A primeira é a faixa dos blocos: nome do
  agrupamento (branco, 3 colunas) · **ORÇADO** (azul, 4) · **PLANEJADO**
  (verde, 4) · **RENTABILIDADE** (grafite, 2). A segunda traz
  `Item · Tipo · Categoria · R$ Unit. · QT · D/M · Total · R$ Unit. · QT ·
  D/M · Total · R$ · %`.
- **Toda célula de dado é editável por clique**, inline. Tab anda, Enter
  desce.
- **Rodapé** com o subtotal do grupo e, abaixo, a linha "Novo item".
- **A calha de ações fica à DIREITA, fora do frame da tabela** — posicionada
  em `absolute left-full ml-2`, com **116px** de largura, e a página reserva
  esse espaço com `pr-[116px]`. Por linha: a vaga do BV (que fica vazia nos
  tipos sem BV, para as lixeiras não desalinharem) e o botão de lixeira.
  Uma segunda calha, na altura da faixa do grupo, traz o contador de itens,
  renomear e remover.
- No topo da seção: a chave **Bruto ⇄ Líquido** e o botão **Recolher
  todos**.

**O que o save acrescenta:**

1. O **marcador de save** por linha (as três variantes da seção 4).
2. Uma **chave "Orçamento de save"** no cabeçalho da versão — liga o modo em
   que toda linha nova nasce marcada.
3. O **tratamento visual da linha marcada** (ver "a linha marcada", abaixo).
4. A linha **"Saldo em save"** no card de Totais.

### b) Card de Totais da versão

Mesma rota, abaixo dos cards de agrupamento.

**Como é hoje:** três camadas.

1. Uma tabela por **Agrupamento**, terminando em **"Total dos custos"**. Ela
   usa o **mesmo `colgroup`** da planilha, para que as colunas de Total
   caiam no mesmo eixo horizontal dos cards acima. Isso é obrigatório e não
   pode ser quebrado.
2. Painel **"FECHAMENTO DO ORÇADO · POR TIPO DE CUSTO"**: Sub-total A,
   Sub-total B, Sub-total C, Sub-total D, Sub-total F, depois **Total dos
   custos** em destaque, **Honorários (10%)**, **Impostos (19,53%)**, e —
   separados por um filete — **Faturamento previsto** (em vermelho
   California, fonte mono, 18px, negrito) e **Valor do Job** (mesmo peso, em
   grafite).
3. Painel **"RESULTADO"**, ao lado: `Valor do Job − Impostos − Custo
   planejado (− BV)`.

**O que o save acrescenta:** a linha **"Saldo em save"** com a quantidade de
itens, e o tratamento da divergência entre os dois números de fechamento.
Considere que num orçamento de save inteiro o **Valor do Job é zero** — a
tela precisa não parecer quebrada nesse extremo.

### c) Planilha Interna do job

Rota: `/jobs/[jobId]`, segunda aba.

**Como é hoje:**

- Quatro abas: **Informações do Job · Planilha Interna · Pedidos de Produção
  (PPs) · Comunicação**. Página em `max-w-[1452px]`.
- **15 colunas**, `min-w-[1160px]`, altura de linha **34px**. Larguras: 18%,
  4%, 8,5% · 7,5%, 3%, 3%, 8,5% · 7,5%, 3%, 3%, 8,5% · 7,5%, 3%, 3%, 8,5%.
- Três blocos: **ORÇADO** (azul) · **PLANEJADO** (verde) · **REALIZADO**
  (laranja), cada um com `R$ Unit. · QT · D/M · Total`.
- **Nenhuma célula é editável** desde 21/08/2026 — o realizado vem dos
  Pedidos de Produção, e o orçado só muda por errata.
- Na calha de 116px, **BV e PP dividem a mesma moldura**. No tipo `AR`, que
  tem os dois, a pílula se divide ao meio por um fio de 1px e os rótulos
  encurtam para siglas — o texto completo fica no tooltip. Foi a solução
  encontrada justamente para **não alargar a calha**.

**O que o save acrescenta:**

1. O mesmo **marcador** da planilha do orçamento.
2. Ao marcar um item como **"consome save"**, abre o **seletor** (item d).
3. **Pílulas de rastro** por linha: na origem, `Save · disponível` ou
   `Save → JOB-0042`; no consumidor, `Save ← JOB-0031`. É o pedido explícito
   do Tiago: dá para ver de onde veio e para onde foi, sem sair da planilha.
4. Os números de save no card de Totais do job.

### d) Seletor de saves do cliente — tela nova

Aberto ao marcar um item como consumidor. Lista os saves **disponíveis
daquele cliente** (o crédito é do cliente, e vale mesmo em outro projeto).
Cada linha da lista traz:

- job de origem (código e nome);
- descrição da linha em save e o tipo de custo;
- **saldo disponível**;
- estado: **faturado** ou **a faturar**;
- **aviso quando os percentuais de honorários/imposto do save diferem** dos
  do job atual — nesse caso a conta não fecha exatamente, e quem escolhe
  precisa saber.

Escolher **já aloca**. O usuário informa quanto daquele saldo este item
consome — pode ser menos que o saldo, e pode ser menos que o valor do item
(nesse caso o resto do item é faturado normalmente).

Drawer lateral ou dialog: escolha o que o sistema já usa em situações
equivalentes e mostre a sua escolha.

### e) Fila de faturamento

Rota: `/financeiro/contas-a-receber`, aba **Faturamento**.

**Como é hoje:** uma linha por parcela pendente, com as notas já emitidas em
verde; um drawer de emissão com quatro modos (origem única, agrupado,
avulso, leitura).

**O que o save acrescenta:** a linha do job de origem mostra a **quebra**
entre o faturamento próprio do job e o saldo em save — no exemplo,
R$ 109.357,52 se abrindo em R$ 68.348,45 + R$ 41.009,07. No drawer, os itens
da nota separam os dois.

> Note o número: o saldo **consumível** é R$ 30.000 (só o principal), mas o
> que a nota cobre por causa daquela linha é R$ 41.009,07 (com honorários e
> imposto). São dois números para a mesma linha, e os dois são verdadeiros.
> A tela do financeiro trabalha com o segundo.

### f) Encerramento do job consumidor

Se o job consumidor não gastar todo o saldo alocado, a sobra volta a ficar
disponível para o cliente. O resumo de fechamento ganha a linha **"Saldo em
save devolvido ao cliente: R$ X"**. Devolução silenciosa é como o dinheiro
some da vista de todo mundo.

### A linha marcada — vale para (a) e (c)

Uma linha em save **não tem custo no job de origem**: o serviço não
aconteceu ali. Na prática:

- o trio do **PLANEJADO** fica zerado e travado;
- a calha de **BV/PP fica vazia** — não há fornecedor a pagar nem comissão a
  negociar;
- a linha **sai da rentabilidade** do job de origem;
- mas o **ORÇADO continua cheio**, porque é ele que está sendo faturado.

O visual precisa comunicar "esta linha foi vendida mas não vai acontecer
aqui" sem depender de legenda.

---

## 4. As variantes para o Tiago comparar

### Marcador — telas 1a / 1b / 1c

Contexto indispensável: **não existe calha à esquerda hoje.** Toda ação de
linha vive na trilha de 116px à direita, e há uma regra escrita no projeto
de que **a calha de ações não alarga** (`docs/09-identidade-visual-ui.md`).

- **1a — botão à esquerda da tabela.** É a ideia original do Tiago: o
  marcador no lado oposto ao de PP e BV. Desenhe, mas registre o custo: uma
  coluna nova à esquerda obriga a refazer os `colSpan` escritos à mão em 7
  arquivos (grades de 13 e de 15 colunas), as larguras em porcentagem das
  duas grades, os dois `min-w` e o `max-w-[1452px]` da página do job — e
  contraria a regra da calha.
- **1b — modo de seleção na calha da direita.** Um botão "Marcar save" no
  cabeçalho da seção liga um modo em que a trilha de 116px vira caixas de
  seleção; marca-se várias linhas de uma vez e confirma. Custo zero de
  layout, e atende ao caso real, que é plural: o cliente dispensa cinco
  linhas de uma vez, não uma.
- **1c — pastilha por linha na calha da direita**, ao lado de BV e PP. No
  tipo `AR` a pílula passaria de duas para três divisões dentro dos mesmos
  116px — mostre se isso ainda é legível.

Em todas as três, mostre também **como fica a linha depois de marcada**.

### Saldo e rastro — telas 2a / 2b / 2c

Preferência declarada do Tiago: **2a**. Ele quer ver as outras para decidir
com base em algo.

- **2a — Totais + pílula na linha.** "Saldo em save" entra no painel de
  fechamento, com a contagem de itens; as pílulas de rastro ficam na calha.
  Sem tela nova.
- **2b — 2a + aba "Save" no detalhe do job.** Uma quinta aba, com as linhas
  em save, o saldo de cada uma, a quem foi alocada e quanto já foi
  consumido.
- **2c — 2a + tela de saldos por cliente**, fora do job. A visão do
  comercial e do financeiro: quanto está disponível, quanto está alocado, e
  a quem.

---

## 5. Regras visuais herdadas — não negociáveis

- **Cores de bloco** vêm de `app/(app)/_planilha/blocos.ts` e são fixas:
  ORÇADO azul (`#1e4fa3` no texto, `#e8f0fd` na faixa), PLANEJADO verde
  (`#047857` / `#ecfdf5`), REALIZADO laranja (`#c2410c` / `#ffedd5`),
  RENTABILIDADE grafite (`#282828` / `#eceae5`). **Nunca escreva uma cor de
  bloco nova.** Se o Save precisar de cor própria, ela não pode ser uma
  dessas quatro nem uma vizinha delas.
- **Rentabilidade é sempre grafite**, positiva ou negativa. Verde é do
  PLANEJADO.
- **Planilha e card de Totais compartilham o `colgroup`**, com
  `table-fixed`. Largura automática é proibida: as duas tabelas nunca
  alinhariam.
- **A calha de ações não alarga.** 116px, e a reserva da página tem que
  bater.
- Identidade: vermelho California `#E74B56`, fundo `#FAFAFA`, texto
  `#282828`, tipografia Inter, shadcn/ui customizado, tabelas densas,
  interface de sistema interno.
- **Toda string em português correto**, com acento, cedilha e til.
  "Descrição", "Alocação", "Disponível", "Não utilizado", "Você".

---

## 6. O que não desenhar

- Nada de banco, migration, tabela ou estrutura de dados.
- Nada de tela de administração ou configuração.
- Nenhum fluxo de aprovação novo — o Save não muda quem aprova o quê.
- Nenhum módulo novo na navegação (a não ser a tela opcional da variante
  2c).

---

## 7. Aviso sobre o código dentro deste projeto

A pasta `uploads/Califa-ERP/` deste projeto do Claude Design é uma foto de
**fim de julho de 2026**: as migrations param em
`20260729000002_task005_jobs.sql` e as decisões param na `003`. Ela **não
reflete o sistema atual** — não tem os tipos de custo AR, F e FI, não tem
BV, não tem a Planilha Interna do job, não tem a calha de PP e não tem os
cards de Totais de hoje.

**Use este brief como fonte**, não aquele snapshot. Se precisar de detalhe
que não está aqui, pergunte em vez de ler o código antigo.
