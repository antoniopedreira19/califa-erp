# 055 — O serviço entra no job, e a competência vira rateio entre trimestres

**Data:** 2026-09-07
**Status:** aceita
**Migration:** `20260907230001_servico_no_job_e_rateio_de_competencia.sql`
**Design:** `Abertura de Job - Servico e Rateio de Competencia.dc.html`,
projeto Claude Design `69342d83`
**Contexto:** formulário "Registro no financeiro" da abertura do job
(`/financeiro/abertura-de-job/[jobId]`) e a mesma tela em leitura/edição
na aba "Abertura do Job" de `/financeiro/jobs/[jobId]`. Completa a 021
(edição do registro) e a 037 (serviço no orçamento).

## A mudança em duas frases

1. **O job ganha o campo Serviço**, obrigatório, pré-preenchido pelo
   orçamento de origem e trocável pelo financeiro sem alterar o
   orçamento — o mesmo contrato que a Categoria já tinha.
2. **A competência deixa de ser um valor único**: o job passa a ter de 1
   a N linhas (trimestre, ano, percentual) que somam 100%. É o rateio do
   reconhecimento contábil do job entre trimestres.

## 1. Serviço: `jobs.servico_id`

Até aqui o serviço do job era lido do orçamento (`orcamentos.servico_id`,
decisão 037). O design coloca o campo no formulário de abertura com a
mesma nota da categoria — "vem do orçamento, pode ser trocado aqui sem
alterar o orçamento" — e isso só é possível com coluna própria no job.

| | Categoria | Serviço |
|---|---|---|
| lista | `categorias_dominio`, escopo `orcamento` | `categorias_dominio`, escopo `projeto` |
| na fila | lê do orçamento (`jobs.categoria_id` vazio) | lê do orçamento (`jobs.servico_id` vazio) |
| na abertura | grava `jobs.categoria_id` | grava `jobs.servico_id` |
| depois | `jobs.categoria_id` | `jobs.servico_id`, com o do orçamento como fallback |

O fallback existe por um job só: **JOB-0004**, aberto antes disto e cujo
orçamento não tem serviço. Editar o registro dele vai exigir escolher um,
porque o campo é obrigatório como no design.

**Quem passou a ler o serviço do job:** a ficha "Informações do Job" nos
dois módulos, a lista "Visualizar Jobs" e o Calendário de Jobs (que
colore por serviço, decisão 053).

### ⚠️ Segunda FK de `jobs` para `categorias_dominio`

Todo embed `categoria:categorias_dominio(...)` a partir de `jobs` precisa
da dica `!categoria_id` a partir de agora. Sem ela o PostgREST não devolve
a coluna vazia — derruba a query inteira, em silêncio. Dois selects foram
corrigidos nesta entrega (`financeiro/jobs/[jobId]/dados.ts` e
`abertura-de-job/dados-abertos.ts`); o resto já tinha a dica.

## 2. Competência: `jobs_competencias`

Tabela nova, uma linha por trimestre do rateio:

| coluna | |
|---|---|
| `trimestre`, `ano` | a competência (único por job) |
| `percentual` | `numeric(5,2)`, entre 0 e 100; as linhas do job somam 100 |

O caso simples é uma linha de 100%. A soma é conferida pela Server
Action, com tolerância de um centésimo (33,33 + 33,33 + 33,33).

### As quatro decisões do Tiago (07/09/2026)

**As colunas antigas ficam, com a primeira competência do rateio.**
`jobs.competencia_trimestre` / `competencia_ano` continuam gravadas com o
trimestre **mais antigo** do rateio. É o que o filtro "Ano", a ficha e o
aviso "Fora da competência" liam — nada que existe quebra, e o rateio
completo mora na tabela nova.

**Só o percentual, sem valor.** Receita e custo têm bases diferentes
(faturamento previsto e planejado da planilha), e as Previsões da mesma
tela já destrincham as duas em datas que não seguem a proporção do
rateio. Uma coluna de valor criaria um segundo total conflitante. Quem
consumir o rateio (relatório por trimestre, DRE) aplica o percentual
sobre a base que lhe interessa. **Nesta entrega nenhuma tela calcula
valor por competência** — hoje nenhuma calculava.

**Até duas casas decimais** no percentual.

**Job rateado em dois anos aparece nos dois** no filtro "Ano" de
"Visualizar Jobs": `JobAberto.competencia_anos` traz todos os anos do
rateio, e o filtro casa com qualquer um.

### As datas das previsões são independentes do rateio

A competência divide o **reconhecimento contábil** do job; as parcelas de
recebimento e a curva de desembolso dizem **quando o dinheiro entra e
sai**. O aviso "Fora da competência" numa data passou a significar "fora
de TODAS as competências do rateio" (`foraDoRateio`).

## 3. Como a tela funciona

- As pílulas de trimestre são **multi-seleção** dentro do ano ativo; o
  ano é contexto de edição — escolher 2027 e clicar em 1T inclui
  `1T/2027`. A última competência não sai.
- Incluir ou tirar um trimestre **iguala** os percentuais (o centésimo de
  sobra vai para as primeiras linhas); "Dividir em mais de uma
  competência" entra com o trimestre seguinte ao último.
- O bloco "Rateio entre competências" só aparece com mais de uma linha:
  percentual editável, barra de proporção, remover, presets 50/50, 60/40
  e 70/30 (só com duas linhas) e Igualar.
- Salvar exige serviço preenchido e rateio fechando 100% — a mensagem do
  rodapé diz qual dos dois falta.
- Nada muda no que é fixo: data e usuário da abertura continuam
  intocados pela edição (021).

## 4. Backfill (aditivo)

- `jobs.servico_id` recebeu o serviço do orçamento nos jobs que já
  passaram pela abertura: **24 de 25** (JOB-0004 ficou vazio).
- `jobs_competencias` ganhou **uma linha de 100%** para cada um dos 25
  jobs com competência (24 em 3T/2026, 1 em 4T/2026).

## 5. O que NÃO mudou

- `orcamentos.servico_id` continua sendo a origem: trocar o serviço no
  job não escreve no orçamento.
- O job criado pelo envio para abertura continua sem `servico_id` e sem
  `categoria_id` — os dois nascem na abertura, como antes.
- A auditoria segue gravando `competencia` como texto legível
  (`"3T/2026 50% · 4T/2026 50%"`) e ganhou `competencias` com as linhas.
