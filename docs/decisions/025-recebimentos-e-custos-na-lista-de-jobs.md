# 025 — Recebimentos e custos do job: os três pontos do fluxo de caixa

**Data:** 2026-08-24
**Design:** `Abertura de Job - Financeiro.dc.html` (projeto Claude Design `69342d83`)
**Migration:** `20260824000001_vw_fluxo_caixa_job_totais.sql`

---

## 1. O que a regra diz

Sempre que uma tela mostrar **quanto um job recebe** ou **quanto um job
custa** como um número só, esse número é a soma dos **três pontos do
fluxo de caixa**:

```text
movimentado  +  título  +  previsão em aberto
```

Nessa ordem de prioridade, e nunca um sem os outros. Palavras do Tiago
(24/08/2026):

> Sempre será a soma dos 3 pontos do fluxo de caixa: movimentado,
> previsão e títulos. (…) Independente do tempo, sempre com os números
> mais atualizados, sempre priorizando o que foi realizado, o que se
> tornou título.

**Recebimentos** é o lado `entrada`. **Custos** é o lado `saida`.

## 2. Por que sai da `vw_fluxo_caixa`, e não de uma conta nova

A `vw_fluxo_caixa` (decisão 018) já classifica cada linha em
`movimento`, `titulo` ou `previsao` — e, principalmente, **já resolve o
abatimento**: previsão coberta por PP ou por nota sai da classe
`previsao` e reaparece em `titulo`/`movimento`, consumida da data mais
próxima para a mais distante. Ela nunca aparece nas duas.

Isso torna `sum(valor)` por natureza a resposta exata da regra da seção
1, sem nenhuma subtração manual. Somar as tabelas de origem
(`jobs_previsao_recebimento` + `titulos_receber` + `lancamentos`, ou
`jobs_previsao_custo` + `pedidos_compra_parcelas` + …) contaria em dobro
exatamente nos jobs que já andaram — que são os que interessam.

Consequência prática, e é ela que fecha a regra: **o número da lista bate
com a aba Fluxo de Caixa do mesmo job**, porque é a mesma leitura. Duas
contas para a mesma pergunta divergiriam na primeira PP emitida.

### O agregado é uma view

`vw_fluxo_caixa_job_totais` agrega por `(tenant_id, job_id)` e devolve
quatro colunas: total e realizado de cada lado. Uma linha por job.

A lista mostra o tenant inteiro; descer as linhas cruas para somar no
TypeScript é o embed pesado que `docs/PERFORMANCE.md` proíbe. O
`realizado` (classe `movimento`) vem separado porque a célula traz uma
segunda linha com quanto do total já aconteceu — é o mesmo total
recortado, não uma segunda conta.

## 3. Job encerrado não é caso especial

A `vw_fluxo_caixa` só projeta previsão de job `aberto`/`em_producao`.
Job encerrado, portanto, fica só com o que virou dinheiro ou documento —
e é isso mesmo que se quer: previsão de job encerrado não vale mais
nada, e o que sobra **é** o número mais atualizado dele.

Não existe recorte por competência, por mês nem por status. A coluna é o
total da vida do job.

## 4. O fallback, e onde ele mora

Job sem **nenhuma** linha de entrada no fluxo de caixa mostra
`jobs.faturamento_previsto`. Job sem nenhuma linha de saída mostra
`jobs.custo_previsto_total`. A célula marca esses casos com
"previsto na abertura", para o número não se passar por caixa.

O fallback dispara só na **ausência total** daquele lado. Havendo
qualquer linha — mesmo só previsão —, quem manda é ela.

Sem isso a coluna Recebimentos nasceria zerada em 9 dos 13 jobs de hoje:
eles são anteriores à `jobs_previsao_recebimento` (17/08/2026, decisão
015) e nunca foram enviados para faturamento, então não têm nada do lado
`entrada`. JOB-0004, por exemplo, sairia com R$ 0,00 tendo R$ 513.673,17
de faturamento previsto.

**O fallback NÃO está na view**, de propósito. Ele é regra de
apresentação da lista e mora em
`app/(app)/financeiro/abertura-de-job/dados-abertos.ts`. Dentro da view,
contaminaria qualquer outra leitura de fluxo de caixa que venha a usá-la
— e aí a lista deixaria de bater com a aba Fluxo de Caixa, que é
justamente o que a seção 2 comprou.

## 5. Onde isso já vale

- Aba **Visualizar Jobs** (`/financeiro/abertura-de-job`), colunas
  Recebimentos e Custos, nas duas visões, na faixa do projeto e nos
  totais do topo.

Qualquer tela nova que mostre "quanto este job recebe/custa" usa
`lib/data/caixa-por-job.ts`. Não reimplemente a soma.
