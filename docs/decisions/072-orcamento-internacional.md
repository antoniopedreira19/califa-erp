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

## O que NÃO entrou

A **abertura** do job entrou em 11/09/2026 (seção acima). Seguem nacionais,
e a cadeia não vaza para eles porque o 4º parâmetro é opcional e ninguém lá
o passa:

- **as telas do job** — detalhe, planejado, realizado e errata. ⚠️ Hoje
  `/jobs/[jobId]` mostra o fechamento nacional de um job cujo banco já tem
  o internacional: R$ 423.016,79 na tela contra R$ 515.999,99 gravados. É
  a próxima entrega;
- **visão agregada** do projeto (orçamentos e jobs);
- **exportação** e **importação** em Excel.

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
