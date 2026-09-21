# 072 — O orçamento internacional tem planilha própria, e quem a escolhe é a categoria

**Data:** 2026-09-11
**Status:** aceita
**Contexto:** `versoes_orcamento`, `categorias_dominio`, a tela da versão
do orçamento e `lib/calculos/versao-totais.ts`. Pedido do Tiago em
10/09/2026, com a planilha `Modelo de planilha interna - Internacional
2026.xlsx` e o design `Orcamento Internacional - Planilha e Totais.dc.html`.

## O problema

A California fecha job internacional numa planilha à parte, fora do ERP.
O fechamento dela não é o nacional: entre os honorários e os impostos
brasileiros existe um degrau a mais — as **int. taxes**, retidas no
exterior, também em gross-up —, e o total ainda soma **int. transaction
costs**.

Quem fechava um job internacional continuava na planilha de fora, e o
orçamento no sistema ficava com um número que não é o que se cobra do
cliente.

## A cadeia

```
sub-total → fee → int. taxes (gross-up) → total recebido no exterior
          → int. transaction costs → impostos BR (gross-up) → invoice
```

Conferida **célula a célula** contra a aba `INTERNA USD` da planilha
modelo (`scripts/conferir-internacional.ts`): as 12 células de fechamento
batem em BRL e na moeda estrangeira.

| Célula | Planilha | ERP |
|---|---|---|
| G5 sub-total | 283.668,01 | ✅ |
| G6 fee (20%) | 56.733,60 | ✅ |
| G7 int taxes (18,02% gross-up s/ sub-total + fee) | 74.823,58 | ✅ |
| G8 total recebido no exterior | 415.225,19 | ✅ |
| G10 brazilian taxes (19,53% gross-up s/ G8) | 100.774,80 | ✅ |
| G11 invoicing | 515.999,99 | ✅ |
| F5…F11 (÷ compra 4,97) | — | ✅ |

## A regra

1. **Quem decide o modelo é a CATEGORIA, pelo campo — nunca pelo nome.**
   `categorias_dominio.modelo_planilha` é um enum
   (`nacional` | `internacional`). `categorias_dominio` é lista que o
   usuário edita em `/orcamentos/categorias`; casar a conta com a string
   "Internacional" quebraria em silêncio numa renomeação.

2. **A categoria com modelo próprio é travada — no banco.** O trigger
   `trg_categoria_modelo_proprio_travado` recusa renomear, mudar de escopo
   e trocar o modelo quando a sessão é `authenticated`; migration (que roda
   como `postgres`) passa. **Ativar e desativar seguem livres:** é
   reversível, não mexe em número nenhum, e é a ação legítima de "não
   fazemos job internacional este ano".

   ⚠️ O trigger **não pode** ser `security definer`: lá dentro
   `current_user` vira o dono da função e a comparação nunca daria
   `authenticated` — a trava existiria no papel e deixaria tudo passar.

3. **As alavancas por tipo de custo continuam valendo.** Fee sobre os
   tipos com `honorarios`; int. taxes e imposto BR sobre os com `imposto`,
   mais o fee. Com todos os itens em B — que é como a planilha
   internacional trabalha — a conta cai exatamente na da planilha modelo.

4. **A conta é UMA, com um degrau opcional.** `calcularTotaisVersao` ganhou
   um 4º parâmetro. Sem ele, `intTaxes` e `intTransactionCosts` são 0 e o
   resultado é **bit a bit** o de antes — é o que permitiu acrescentar a
   cadeia sem tocar em nenhum dos ~20 call sites, e o que
   `scripts/conferir-save.ts`, rodando sem alteração, comprova.

5. **Os custos de transação não compõem base de imposto.** Entram depois do
   total recebido no exterior: na planilha, `G11 = G8 + G9 + G10`, com
   `G10` calculado só sobre `G8`. Também ficam fora da fatia de receita do
   save — as demais parcelas são lineares na base e podem ser rateadas por
   linha, e uma constante da versão não.

6. **A moeda dos valores continua BRL.** Os valores da planilha são
   digitados em reais (o design rotula "R$ Unit." e "Total BRL"); só a
   coluna calculada está na moeda de fora. Por isso
   `versoes_orcamento.moeda` **não** vira "USD" — ela é o argumento de
   `formatCurrency` na planilha inteira, e trocá-la faria a tela imprimir
   US$ em cima de números que são BRL. A moeda estrangeira e a taxa que
   converte ganharam campos próprios (`moeda_estrangeira`,
   `cambio_compra`); `taxa_cambio` segue sendo a taxa de `moeda`, e segue 1.

7. **Só a compra converte.** Cotação do dia, data e taxa de venda ficam
   gravadas como registro de conferência e não entram em conta nenhuma.

## Resultado operacional: onde divergimos da planilha

A planilha escreve `L11 = L5 + G10` — rentabilidade **mais os impostos
brasileiros** — e chega a R$ 381.179,71 (73,87%).

Somar imposto ao resultado não se sustenta, e há uma explicação melhor:
**`L5 + G6`** (rentabilidade + **fee**) dá R$ 337.138,51 — exatamente o que
o design calcula, e `G6` é vizinha de `G10` na mesma coluna. A referência
da célula está trocada.

Adotamos a leitura do design (decisão do Tiago em 11/09/2026):

```
res. operacional = valor do job − impostos BR − int. taxes
                                − int. transaction costs − custo planejado
```

que, desenvolvida, sobra em `fee + rentabilidade`. É a **mesma forma** do
nacional, onde o resultado já é `principal + honorários − planejado`.

## O que fica pronto para os próximos modelos

O Tiago tem plano de outras categorias com planilha própria, e de
categorias restritas a certos tipos de serviço.

| Peça | Serve a um modelo novo? |
|---|---|
| Enum `modelo_planilha` | **Sim** — valor novo é aditivo |
| Trigger de proteção | **Sim** — vale para qualquer modelo ≠ nacional |
| `modeloPlanilha` propagado **como enum** | **Sim** — modelo 3 é um `case`, não uma renomeação na árvore de props |
| Prop `moedaEstrangeira` (nomeada por função) | **Sim**, se o modelo novo também converter moeda |
| Grade com coluna condicional | **Sim** — o padrão já é por flag, como a coluna Save |
| A cadeia de cálculo em si | **Não** — cada modelo tem a sua |

**Categorias por tipo de serviço** não conflitam: é uma relação categoria ×
serviço, ortogonal ao `modelo_planilha`. A trava recusa mudança de `nome`,
`escopo` e `modelo_planilha` — não impede vínculo novo noutra tabela.

## O job: a cadeia é a do ORÇAMENTO (11/09/2026)

Decidido pelo Tiago depois da primeira entrega, quando a abertura de job
entrou em escopo.

Na abertura, o financeiro escolhe uma categoria para o job num Select
próprio — ela vem pré-preenchida com a do orçamento, mas pode ser trocada,
e é gravada em `jobs.categoria_id`. Isso abria a pergunta: quem decide a
cadeia do job, a categoria do orçamento ou a do job?

**A do orçamento.** A categoria do job classifica para o financeiro; não
recalcula. Fosse a do job, trocá-la moveria o fechamento vivo por baixo de
um `valor_job_abertura` que é congelado no envio — e a tela do financeiro,
que compara os dois, mostraria uma errata de ~R$ 93 mil que ninguém fez.

**E a abertura trava a divergência.** `conferirCategoriaDoJob`
(`financeiro/abertura-de-job/actions.ts`) recusa categoria cujo
`modelo_planilha` seja diferente do orçamento, nos dois pontos que gravam
(abrir e editar o registro da abertura). A tela já filtra o Select pelo
modelo, mas a regra não pode depender dela.

Sem isso, `abertura-actions.ts` gravaria o job pela cadeia NACIONAL — e
`valor_total`, `faturamento_previsto` e os dois `_abertura` são escrita,
não exibição. Os `_abertura` nunca mais mudam: erro ali é permanente.

Conferido ao vivo em 11/09/2026: JOB-0008, nascido do orçamento
0-0001/26-07, gravou **R$ 515.999,99** nas quatro colunas (seria
R$ 423.016,79 pela nacional), e o Select da abertura oferece só
"Internacional" — enquanto um job nacional segue oferecendo as sete
categorias nacionais.

## As telas do job e a errata (11/09/2026)

Terceira entrega. O job passou a **ler** pela mesma cadeia com que nasce.

O resultado operacional não muda com a cadeia — ele é sempre
`principal + fee − custo` —, mas o caminho até ele sim: descontar só o
imposto brasileiro de um valor do job que já embute as int. taxes inflava
o resultado em exatamente o valor delas (R$ 411.962,09 em vez de
R$ 337.138,51 no exemplo). Por isso `PainelResultado` ganhou as duas
deduções como linhas próprias, e o prop `imposto` de `ResumoResultado`
virou **`deducoes`**: um prop chamado `imposto` recebendo três coisas é
como o número sai certo numa tela e errado na outra.

**A errata entrou junto, e não por escopo frouxo:** a barra de errata
mostra o delta calculado no cliente e o servidor recalcula para gravar.
Corrigir só um lado faria o pop-up prometer um número e o banco guardar
outro. Por isso `calcularEfeitoDaMudanca` — o efeito de UMA linha — também
ganhou o degrau. Os **custos de transação ficam de fora dele**: são
constante da versão, não parcela de linha, e somá-los faria cada item
carregar o custo inteiro. `scripts/conferir-internacional.ts` §7 testa
justamente que a soma dos efeitos fecha com o delta total.

O bloco da cadeia virou `_planilha/cadeia-internacional.tsx`, compartilhado
entre a versão do orçamento e a planilha interna do job — duas cópias
divergiriam na primeira correção, como já aconteceu neste projeto com a
legenda e com as cores de bloco.

**Correção de 14/09/2026 — cabeçalho do job no financeiro.** O teste de
ponta a ponta achou `financeiro/jobs/[jobId]/page.tsx` passando
`deducoes={totaisJob.imposto}` ao resumo do topo: o "Resultado op.
(planejado)" do JOB-0009 saía R$ 379.782,71 (38,8%) no financeiro e
R$ 237.896,34 (24,3%) na página de Jobs — a diferença exata das int.
taxes. Passou a ler `totaisJob.deducoesDoResultado`, o mesmo campo da
página de Jobs. A aba Planilha Interna dos dois lados já estava certa; só
o cabeçalho do financeiro divergia.

## A visão agregada: cada linha fecha pela sua cadeia (11/09/2026)

Quarta entrega. Um projeto pode ter orçamento nacional e internacional
lado a lado, e a pergunta era como somar dois fechamentos diferentes.

**A resposta já existia na tela.** O consolidado nunca foi "uma conta do
projeto": ele é o **somatório dos fechamentos de cada orçamento**, e o
card já avisava que "os percentuais acima são a média das taxas, porque os
orçamentos deste projeto não usam todos as mesmas". Cadeias diferentes são
a mesma família de problema que taxas diferentes — cada linha fecha pela
sua, e o projeto soma.

O que mudou na leitura: quando existe algum orçamento internacional, o
fechamento ganha as linhas **Int. taxes (retidas no exterior)** e **Int.
transaction costs**, e "Impostos" vira "Impostos BR". Sem elas, as
parcelas não somariam o faturamento previsto logo abaixo. Num projeto só
nacional as duas são 0 e nem aparecem.

O modelo de planilha mora em `OrcamentoRascunho.modeloPlanilha`, **fora**
de `parametros`: os de lá são colunas da versão, que o usuário edita no
modal; este é da categoria, e ele não mexe. Por isso o modal passou a
preservar os campos internacionais por spread — reescrever o objeto campo
a campo é como eles seriam zerados por um formulário que nem sabe que
existem.

Conferido ao vivo: a agregada do projeto de teste subiu de
R$ 1.003.965,22 para R$ 1.096.948,42 — **exatamente** os R$ 92.983,20 de
int. taxes do único orçamento internacional, e nada mais.

## A exportação: nacional e internacional não se misturam (12/09/2026)

Quinta entrega, primeira parte. O seletor de exportação monta **uma
planilha só**, com um FATURAMENTO único somando os orçamentos marcados. Com
os dois modelos no mesmo arquivo, esse FATURAMENTO não corresponderia a
nenhum documento que a California manda: o nacional fecha em reais com
imposto e honorários; o internacional tem fee, int. taxes, int. transaction
costs e a coluna na moeda estrangeira.

O Tiago chegou a considerar exportar os dois juntos pelo fechamento
internacional (que contém todas as linhas do nacional) e **decidiu
separar**: não se exporta nacional com internacional. O nacional continua
exatamente como era.

- **No seletor** (`_selecao/exportar-orcamentos-menu.tsx`), a trava segue o
  padrão da de job aberto: aviso em vermelho, Exportar desabilitado, e dois
  atalhos — "Manter só os nacionais (n)" e "Manter só os internacionais
  (n)". A linha do orçamento internacional leva "· Internacional" no rótulo.
- **A regra é pelo conjunto de modelos**, não por "tem internacional": um
  modelo novo amanhã entra nela sem mexer no seletor.
- **Na rota** (`api/orcamentos/[projetoId]/export`), a mesma regra recusa
  com 400 — quem montar a URL à mão também é barrado. A trava da tela é
  conforto; a regra é a do servidor.
- `OrcamentoExportavel.modeloPlanilha` é **obrigatório**: quem monta o
  seletor tem que dizer o modelo, e não deixar um default liberar a mistura
  em silêncio. As duas origens (lista do projeto e visão agregada) passam o
  valor lido da categoria.

Conferido ao vivo no projeto 0-0001/26: com os 7 orçamentos marcados, os
dois avisos (job aberto e mistura) aparecem e o Exportar trava; "Manter só
os internacionais" deixa 1 de 7, R$ 515.999,99, e libera. Pela rota: -04 +
-07 → 400 com a mensagem; -04 + -06 → planilha; só -07 → planilha.

## A exportação: o layout é o da planilha que a California já usa (14/09/2026)

Quinta entrega, segunda parte. Mostrei ao Tiago um layout com os rótulos
da tela do ERP; ele decidiu **manter o layout da planilha modelo**, das
colunas aos rótulos. O arquivo do orçamento internacional sai assim:

| | A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|---|
| 1 | nome (A1:G1, faixa azul) | | | | | | |
| 2 | SHEET | ITEM | TT USD | BRL | QT | D/M | TT BRL |
| grupo | nome do grupo | | US$ | | | | R$ subtotal |
| item | | descrição | US$ | R$ unit. | qt | d/m | R$ total |
| fechamento | | | rótulo (C:E) | | | US$ | R$ |

Fechamento: **TOTAL · FEE · INT TAXES · TOTAL RECEBIDO EXTERIOR · INT
TRANSACTION COSTS · BRAZILIAN TAXES · INVOICING**, a linha amarela
"USD · BRL" e o câmbio no rodapé (A/B): cotação com a data, COMPRA, VENDA.
Cores e formatos numéricos também são os do modelo.

As quatro respostas do Tiago sobre o que a exportação nacional tem e o
modelo não:

| Ponto | Decisão |
|---|---|
| Coluna TIPO e SUB-TOTAL por tipo | **Saem.** O tipo continua gravado no ERP. |
| Cabeçalho | **O do modelo:** uma faixa com o nome, sem "Cliente:" nem a linha ORÇAMENTO. Versão única: `código · nome - vN`; consolidado: `código · nome do projeto`. |
| Câmbio no rodapé | **Como no modelo:** cotação + data, COMPRA e VENDA. |
| "(−) PAGO COM CRÉDITO DE SALDO ANTERIOR" | **Só quando houver crédito**, entre TOTAL e FEE. Sem save, a planilha é a do modelo. |

**Vários internacionais no mesmo arquivo** só saem com a mesma moeda e a
mesma taxa de compra (decisão do Tiago): a planilha tem uma coluna de moeda
e um câmbio. Trava no seletor e na rota, pela mesma `chaveDoCambio`. Se
cotação, venda ou data divergirem com a compra igual, a linha divergente
some do rodapé em vez de mostrar a de um só.

**Coluna da moeda = TT BRL ÷ COMPRA**, a conta da tela da versão. As duas
abas do modelo divergem aqui (a USD divide o unitário, a GBP o total); o
rótulo "TT USD" e a tela resolvem pelo total. Sem compra gravada, a coluna
fica vazia.

**Fórmulas.** TT, subtotais, TOTAL, crédito, coluna da moeda e INVOICING
são sempre fórmula. FEE, INT TAXES, TOTAL RECEBIDO EXTERIOR e BRAZILIAN
TAXES só são fórmula quando a conta do modelo é exatamente a do ERP — todo
o líquido do TOTAL entra em fee, impostos e valor do job, e as taxas são
iguais em todas as seções. Sem a coluna TIPO a fórmula não tem como
excluir, por exemplo, um item A; nesses casos a linha sai com o valor
calculado pelo ERP.

**A importação recusava a planilha internacional** até a sexta entrega (seção seguinte), que passou a lê-la: o importador de versão aceitaria o cabeçalho e leria as colunas deslocadas.

Conferido: as 12 células do fechamento (BRL e USD) batem com a planilha
modelo nos arquivos gerados pelas duas rotas, com os dados reais do
0-0001/26-07; todas as fórmulas foram reavaliadas contra o valor em cache,
inclusive num caso com duas seções, item tipo A e crédito; a exportação
nacional do Job 4 + Job 6 saiu idêntica à de antes; os dois importadores
continuam lendo a nacional. **Não exercitado com dado real:** a trava de
câmbio — o projeto de teste tem um orçamento internacional só.

## A importação: a planilha internacional entra pelas três portas (14/09/2026)

Sexta entrega. As três portas de importação passaram a ler a planilha
internacional — a planilha modelo e a exportação do ERP:

- **Versão** — "Importar planilha" da tela do orçamento (versão nova) e da
  versão (sobrescrever), por `parser-oficial.ts`;
- **Projeto** — "Importar" da página do projeto, por `parser-projeto.ts` e
  `diff-projeto.ts`;
- **Visão agregada** — "Importar planilha" do card sem planilha, que joga
  no rascunho, também por `parser-oficial.ts`.

As regras, decididas pelo Tiago:

| Ponto | Decisão |
|---|---|
| Coluna A · SHEET | É o grupo, como a CATEGORIA/PLANILHA do nacional. |
| Tipo de custo | A planilha não tem. Linha **nova** entra como **B**; linha **casada pelo id** (reimportação da exportação) **mantém o tipo gravado**. Tipo ausente nunca conta como alteração. |
| Versão nova pelo "Importar planilha" | **Câmbio em branco.** Nasce como qualquer versão internacional nova (USD, int. taxes 18,02%, ITC 0); fee do cadastro do cliente e Impostos BR em branco, como na importação nacional. O "sobrescrever" preserva os parâmetros, e a importação do projeto herda da vigente. |
| Planilha do modelo errado | **Recusada**, nas três portas: internacional em orçamento nacional e nacional em internacional. |

Colunas lidas: D · BRL (unitário), E · QT, F · D/M. TT USD e TT BRL são
calculados e ficam de fora. O PLANEJADO (H · R$, I · QT, J · D/M) entra
como no nacional, **menos** quando a H traz o id oculto da exportação — ali
a H é id e a I, crédito consumido. A leitura para no primeiro rótulo do
fechamento (TOTAL, FEE…): embaixo só há fechamento, legenda e câmbio.
Linha com valor e sem nome na B é descartada com aviso, e um aviso único
diz quantas linhas entraram como B.

**Dois defeitos corrigidos no caminho:**

- A importação do **projeto** criava a v+1 copiando só moeda, taxa,
  honorários, imposto e save da vigente — um orçamento internacional perdia
  int. taxes, ITC, moeda estrangeira e câmbio em silêncio. Agora herda os
  sete campos.
- O "Importar planilha" com **versão nova** num internacional criava a
  versão como nacional (int. taxes 0, sem moeda estrangeira).

**Aprovar versão internacional exige o câmbio completo** (pedido do Tiago
no meio desta entrega): moeda, data da cotação, cotação, compra e venda.
A regra mora em `bloqueioAprovacaoVersao`, a mesma função do botão e do
servidor, e a mensagem diz o que falta. A **moeda** entrou na lista por
conta minha — sem ela o câmbio não tem a que se referir; é fácil tirar se
o Tiago discordar.

Conferido:
- parsers e diff por script, com a exportação real, a planilha modelo (em
  branco e preenchida), a recusa por modelo e a regressão nacional;
- no navegador, no 0-0001/26: o -08 sobrescrito pelo drawer da versão com
  a planilha do -07 (item B, parâmetros preservados, importação
  registrada); o -06, nacional, recusou o mesmo arquivo; a importação do
  projeto criou a v2 do -08 com o câmbio completo e as int. taxes
  herdados, QT 1 → 2 e a linha nova como B; o "Aprovar versão" do -08
  ficou travado com o câmbio incompleto e liberou com ele completo.
- no navegador, em 14/09/2026, a recusa no "Importar" da página do
  projeto: planilha nacional com duas seções — uma com o id do -08
  (internacional), outra com o do -11 (nacional). O preview marcou o -08
  como "não entra" ("Este orçamento é internacional, e a planilha está no
  modelo nacional — nada entra nele.") e seguiu com o -11 para a v2. A
  importação foi cancelada; nada gravou.

**A porta da visão agregada, conferida em 15/09/2026:** num card novo de
categoria Internacional, só no rascunho, a planilha nacional foi recusada
("Este orçamento é internacional, e a planilha está no modelo nacional…
Nada foi importado.") e a internacional entrou com 2 grupos (SHEET), 3
itens em B e R$ 33.000,00. O rascunho foi descartado sem salvar.

## Ajustes de leitura depois do teste de ponta a ponta (14/09/2026)

Quatro observações do teste, com as recomendações aceitas pelo Tiago:

- **Cabeçalho da versão mostra o câmbio inteiro.** A linha de leitura passou
  a trazer "Cotação 5,3000 em 14/09/2026 · Compra · Venda", com travessão no
  que falta. Desde que aprovar exige o câmbio completo, esconder cotação,
  venda e data num `title` fazia a pessoa descobrir o que falta só tentando
  aprovar.
- **As linhas internacionais do resultado seguem o MODELO, não o valor.**
  `PainelResultado` ganhou a prop obrigatória `cadeia` (`nacional`,
  `internacional` ou `mista`, de `cadeiaDoConjunto` em `modelo-planilha.ts`).
  Fora do nacional, "Int. taxes" e "Int. transaction costs" aparecem sempre,
  mesmo zeradas — como na planilha modelo e na exportação. Antes, um
  internacional com int. taxes 0% aparecia com cara de nacional e o ITC
  zerado sumia.
- **Visão agregada com nacional e internacional: "Honorários / Fee".** Os
  cards de totais das duas visões agregadas (orçamentos e jobs) seguem a
  mesma cadeia, e o rodapé ganhou "Int. taxes e custos de transação vêm só
  dos internacionais, cada um pela sua cadeia; os nacionais fecham sem
  eles". Projeto só internacional usa a legenda internacional.
- **Coluna USD na planilha do job.** A planilha interna do job (e a
  conferência do financeiro, que é a mesma tabela) ganhou a coluna na moeda
  estrangeira no ORÇADO, entre D/M e Total, com o Total rotulado "Total
  BRL" — a mesma forma da planilha da versão. Total orçado da linha ÷
  compra, também no grupo e no total; selecionável pelas setas, nunca
  editável, nem na errata. Sem câmbio (ou no nacional) a coluna não existe.
  Os cards da visão agregada ficam sem ela: somam jobs de câmbios
  diferentes.

A cor, a ordem e a conta não mudaram; é só o que se lê.

## ⚠️ A errata não gravava desde 11/09 (corrigido em 14/09/2026)

Para ler a cadeia pelo modelo, `registrarErrata` passou a embutir o
orçamento da versão (`orcamento:orcamentos!inner(...)`). Só que há **duas
FKs** entre `versoes_orcamento` e `orcamentos` — a `orcamento_id` e a
`orcamentos.versao_aprovada_id` —, e sem a dica o PostgREST responde 300
(relação ambígua). A consulta falhava, e **toda errata, nacional ou
internacional**, saía com "Versão aprovada do job não encontrada." sem
gravar nada. Apareceu no teste de gravação da errata no JOB-0009; o log
da API mostrou o 300. A dica virou `orcamentos!orcamento_id`.

## O save do internacional mostrava o faturamento pela conta nacional (14/09/2026)

O formulário de save (`_planilha/save-dialog.tsx`) calculava o
"Faturamento desta linha" sem a cadeia internacional: numa linha de
R$ 10.000,00 do JOB-0009 mostrava R$ 13.918,23 (honorários + impostos),
quando a errata de save gravou R$ 16.977,59 (fee + int. taxes + impostos
BR). Era só a tela — o servidor já usava a cadeia. `SaveDialog` ganhou a
prop obrigatória `internacional`, passada pela planilha da versão, pela do
job e pela visão agregada (pelo modelo do orçamento do card), e a nota da
conta nomeia os degraus da cadeia, com vírgula decimal.

## Pendências fechadas depois do teste (14/09/2026)

**Orçamento internacional criado pela visão agregada nasce com a cadeia.**
O "Salvar alterações" da visão agregada (`salvarOrcamentosDoProjeto`) criava
a v1 só com moeda, câmbio, honorários e imposto — um internacional nascia
com int. taxes 0% e sem moeda estrangeira, ao contrário do "Novo
orçamento" (`criarVersaoInicial`). Agora o servidor lê o modelo da categoria
gravada e aplica os mesmos padrões (USD e 18,02%, câmbio em branco), e o
rascunho já nasce com eles, para os Totais da tela baterem com o que será
salvo.

**Impostos BR e int. taxes seguem a trava do fee — só no internacional.**
Decisão do Tiago: os dois percentuais mudam o valor cobrado do cliente, e
quem não tem `orcamentos.editar_impostos` (administrador e gerente de
produção têm) não os altera. Câmbio e ITC continuam com quem edita a
versão. O imposto das versões nacionais fica como sempre foi.

| Onde | Sem a permissão |
|---|---|
| "Editar" da versão (`atualizarVersao` + `meta-versao`) | campos só de leitura; o servidor recusa a mudança |
| Modal de parâmetros da visão agregada (`aplicarEdicao` + `parametros-modal`) | Impostos BR só de leitura; a gravação recusa a mudança |
| "Nova versão" (`criarVersao` + `nova-versao-drawer`) | Impostos BR e int. taxes **vêm da versão vigente**; sem vigente, os padrões |
| "Importar planilha" com versão nova (`confirmarImportacao`) | idem — sem isso a versão nasceria com o imposto em branco e ninguém sem a permissão conseguiria aprovar |

A regra de "vir da vigente" também é do Tiago: herdar dos padrões
desfaria em silêncio um valor que um administrador tenha ajustado. O helper
é `lib/data/impostos-da-vigente.ts`.

⚠️ Os usuários do tenant estão todos com o papel de administrador, então o
caminho travado foi conferido pelo código e pelo tsc, não com um login sem
a permissão.

## ⚠️ O card de Totais do internacional segue o design (21/09/2026)

O card da versão tinha a cadeia como uma lista simples, com o Valor do job
dentro dela e uma nota de conversão logo abaixo — não era o desenho
"Orcamento Internacional - Planilha e Totais" (Claude Design `69342d83`).
Pedido do Tiago: deixar igual ao design, mantendo o "Composto por" em %
do valor do job (095), que foi aprovado depois do design.

| Parte | Como ficou |
|---|---|
| Cadeia | Caixa no azul do ORÇADO, com ícone de globo; USD em azul; o percentual e "(Invoice)" em tom apagado; fios entre os trechos; Faturamento previsto em vermelho nas duas moedas. Os parênteses de Int. taxes e Impostos BR trazem só o percentual — o "· gross-up" do design saiu a pedido do Tiago; a legenda continua explicando o gross-up |
| Valor do job | Caixa própria sob a cadeia, com USD e BRL; a linha "Save gerado" só existe com save |
| Sub-totais por tipo | Tipo sem custo apagado, tipo com custo e o total em negrito (só no internacional) |
| Texto das duas bases | O "A mesma cadeia sobre a base do valor do job…" do design virou o segundo tópico da legenda, como no nacional — só com save. A frase do design para o caso sem save não entrou: sem save, nada de save aparece |
| Nota de conversão | Saiu de sob a cadeia e fecha a legenda, onde o design a põe |

Duas diferenças de propósito em relação ao design: o "Composto por" é o da
095, e a linha "− Int. transaction costs" do Resultado continua sempre
visível (decisão de 14/09), onde o design só a mostra com valor.

A cadeia é compartilhada com a planilha interna do job
(`job-totais-card.tsx`), que recebe o mesmo desenho, a mesma nota e o
mesmo tópico de save. As cores da caixa moram em `CADEIA_INTERNACIONAL`,
em `_planilha/blocos.ts`, feitas do azul do ORÇADO.

## O que NÃO entrou

A **abertura** do job entrou em 11/09/2026 (seção acima). Seguem nacionais,
e a cadeia não vaza para eles porque o 4º parâmetro é opcional e ninguém lá
o passa:

- a exportação com **planejado** e **realizado** (pendência combinada com
  o Tiago).

## Decisões de tela

- **Os botões acima da planilha são os atuais** — "Recolher todos",
  "Orçamento de save", "Exibir", "Importar planilha". Os do design não
  entram: não estão calibrados, e o seletor de save de lá é demonstração.
- **A faixa do bloco continua "RENTABILIDADE"**, por extenso. O design
  abreviou para "RENTA" para caber a coluna extra; a folga saiu do piso de
  largura da tabela (1280px), não do rótulo.
- **O resumo do topo continua o atual** — Valor do Job · Resultado Op. ·
  Rentab. —, com os números da cadeia internacional por trás. O design
  trocava o bloco do meio por "Custo planejado"; o Tiago preferiu manter.
- **Impostos BR continua Select** das alíquotas conhecidas (19,53% padrão),
  e não número livre como no design: é o que mantém a trava de
  `bloqueioAprovacaoVersao`.
- **Int. taxes é numérico livre**, com 18,02% de partida — a retenção varia
  com o país de destino.

## Migrations

- `20260911000001_orcamento_internacional.sql` — enum, coluna na categoria,
  seed da "Internacional", trigger de trava, parâmetros na versão.
- `20260911000002_internacional_moeda_estrangeira_propria.sql` — correção
  do §6: `moeda_estrangeira` e `cambio_compra` como campos próprios.
