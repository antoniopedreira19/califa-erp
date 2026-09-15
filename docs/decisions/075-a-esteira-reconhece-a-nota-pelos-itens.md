# 075 — A esteira reconhece a nota pelos itens, e o envio para faturamento grava numa transação só

**Data:** 2026-09-14
**Status:** aceita · revisada em 2026-09-15 (as três leituras pendentes e
os prazos por média ponderada — nota no fim)
**Contexto:** fluxo de envio para faturamento, do botão do job à esteira do
financeiro. Três falhas apareceram na **leitura** do código durante uma
pesquisa do fluxo; nenhuma tinha sido vista em execução. Cada uma foi
confirmada (código, banco pelo MCP e navegador) antes de ser corrigida.
**Complementa a [017](017-faturamento-agrupado-parcial-e-avulso.md) §2**,
que já mandava ler `faturamento_itens` e não era seguida pela esteira.

## A regra

> **A nota de um job se reconhece pelos itens** (`faturamento_itens`), não
> pelo `origem_id` do cabeçalho. Numa nota que cobre vários jobs, cada job
> mostra **a parte dele**; a **nota inteira decide a situação** de todos; e
> o **recebido é rateado** pela parte de cada um. Um job em várias notas
> soma as partes e lista os números.
>
> **O envio para faturamento é atômico:** envio e parcelas nascem juntos,
> ou nenhum dos dois nasce.

---

## 1. Envio que ficava sem parcela

### O defeito

`enviarJobParaFaturamento` fazia dois INSERTs pelo PostgREST — duas
transações. Se as parcelas falhassem, a action tentava desfazer o envio com
um DELETE, sem conferir o erro. Mas `authenticated` **não tem DELETE** em
`jobs_envio_faturamento` (a 20260813000018 decidiu que envio é evento, não
rascunho). O DELETE voltava `42501` em silêncio, o envio ficava sem
parcela — fora da `vw_faturamento_pendente`, que lê as parcelas — e o
`unique (job_id)` impedia o GP de reenviar.

### Confirmado

| Onde | O quê |
|---|---|
| Banco | `has_table_privilege('authenticated', 'jobs_envio_faturamento', 'DELETE')` = **false**; sem policy de DELETE |
| Simulação como `authenticated`, com rollback, JOB-0033 | envio gravado → parcelas recusadas (`2026-02-30`, que passa no regex do Zod) → DELETE `42501` → 1 envio e 0 parcelas → reenvio `23505` |
| Dado real | 0 envios sem parcela no banco em 14/09/2026 — nada a limpar |

Não foi reproduzido no navegador de propósito: deixaria o JOB-0033 travado,
e a única saída seria um DELETE destrutivo.

### A correção

RPC `enviar_job_para_faturamento(payload jsonb)` —
`supabase/migrations/20260914000001_envio_faturamento_numa_transacao.sql`.
**SECURITY INVOKER**: RLS e GRANT valem como nos INSERTs de antes; ela só
empacota, a mesma mecânica de `deletar_grupo_orcamento`. Recusa envio sem
parcela. `execute` só para `authenticated`. As regras de negócio continuam
na action. **Nenhum DELETE foi aberto**, e a unicidade do envio por job
fica como está (a frente Fee/Always On, de vários envios por job, não foi
antecipada).

---

## 2. NF agrupada invisível na esteira

### O defeito

`lib/data/faturamento-por-job.ts` casava a nota com o job por
`faturamentos.origem_id`. A action `emitirFaturamento` grava esse campo
**nulo sempre que a nota tem mais de um item**. Isso pega mais do que a NF
agrupada:

- NF agrupada (vários jobs);
- nota de **um** job com item de saldo em save;
- nota de **um** job cobrindo duas parcelas dele.

E a esteira guardava **uma nota por job** num `Map`: o job faturado em duas
notas — o caso normal do envio em parcelas (017 §3) — perdia uma delas,
conforme a ordem de leitura.

### Confirmado

| Onde | O quê |
|---|---|
| Simulação com rollback, pela RPC real `emitir_faturamento` | NF de JOB-0029 + JOB-0010: a leitura da esteira devolveu `origem_id: null`; os itens apontaram os dois jobs, por `origem_id` do item e por `envio_parcela_id → parcela.job_id` |
| Navegador, com nota real | NF `TESTE-ESTEIRA` emitida (ver "Dado de teste" abaixo); a lista `/financeiro/abertura-de-job` › Visualizar Jobs mostrava JOB-0029 e JOB-0033 como **ENVIADO**, sem número de NF |

### As regras escolhidas (Tiago, 14/09/2026)

Com o exemplo do Projeto Teste — NF agrupada de R$ 145.817,32 (JOB-0029
R$ 31.919,72 + JOB-0033 R$ 113.897,60) em 2 títulos de R$ 72.908,66:

| Pergunta | Resposta |
|---|---|
| Valor na coluna Faturamento | **a parte do job** (R$ 31.919,72 e R$ 113.897,60), nunca o total — 017 §2 |
| Situação com o 1º título vencido e o 2º pago | **a nota decide**: os dois jobs ficam **Inadimplente**; só liquidam quando todos os títulos da nota estiverem pagos |
| Recebido | **rateado** pela parte do job: JOB-0029 R$ 15.959,86, JOB-0033 R$ 56.948,80 (o campo não aparece em tela hoje) |
| Job em duas notas (NF 101 e NF 102 de R$ 56.948,80) | **soma e lista**: R$ 113.897,60, "NF 101 · 102"; título vencido em qualquer uma deixa o job inadimplente |

*(Descartadas: "nota decide, recebido da nota inteira em cada job", que
soma mais dinheiro do que entrou; "agrupada para em Faturado", que nunca
mostraria inadimplência; e "mostra só a NF mais recente".)*

### A correção

- `lib/calculos/esteira-faturamento.ts` — `consolidarNotasDoJob`, função
  pura com as quatro regras. Testes em
  `lib/calculos/esteira-faturamento.test.ts` (9 casos, com os números
  acima): `node --import tsx --test lib/calculos/esteira-faturamento.test.ts`.
- `lib/data/faturamento-por-job.ts` — lê `faturamento_itens` de tipo `job`
  e `save` das notas emitidas (o `origem_id` do item é o job; o CHECK
  `chk_fat_item_origem` o exige preenchido — é a mesma chave que a aba
  Faturamento já usa para listar os jobs cobertos), agrupa por job e por
  nota e entrega à função.

Por que o `origem_id` do **item** e não `envio_parcela_id → parcela.job_id`:
os dois apontaram o mesmo job na simulação, mas o item de job aceita
`envio_parcela_id` nulo (o CHECK permite) e o `origem_id` não.

---

## 3. Card da home do GP contando job já enviado

### O defeito e o conferido

"Jobs prontos pra enviar pra faturamento" (`lib/home/carregar.ts`,
`carregarHomeGerenteProducao`) não excluía jobs com envio. No Projeto
Teste: **2** no card, sendo o JOB-0029 já enviado.

### A correção

Anti-join do PostgREST — embed `envio:jobs_envio_faturamento(id)` e
`.is("envio", null)`. Subtítulo passa a dizer "ainda não enviados".

---

## Conferido no navegador (14/09/2026)

Tudo no `0-0001/26 · Projeto Teste`, pelos fluxos reais.

| Passo | Resultado |
|---|---|
| Home do GP (rota temporária, porque nenhum perfil tem a role `gerente_producao`) | card **2** antes → **1** depois (só JOB-0033) |
| Action real, do navegador, com parcela `2026-02-30` no JOB-0033 | "Não foi possível enviar o job para faturamento. Nada foi gravado — confira as parcelas e tente de novo."; banco: **0 envios, 0 parcelas** |
| Envio real do JOB-0033 pelo drawer | 1 envio R$ 113.897,60, 1 parcela em 30/09/2026, auditoria gravada; card da home **some** |
| Emissão da NF agrupada simbólica (abaixo) | nota com `origem_id` nulo, 2 itens de R$ 1,00, 1 título de R$ 2,00 |
| Esteira antes da troca do código | JOB-0029 e JOB-0033 **ENVIADO**, sem NF |
| Esteira depois | os dois **FATURADO**, **R$ 1,00** cada, "NF TESTE-ESTEIRA"; console sem erro |

### Dado de teste que ficou no banco

Autorizado pelo Tiago nesta sessão. **Não há cancelamento de NF na tela**
(017 §9), então a nota fica:

- **NF `TESTE-ESTEIRA`**, R$ 2,00, emitida em 14/09/2026 pela Empresa
  Teste, cliente Pevetech — R$ 1,00 do JOB-0029 e R$ 1,00 do JOB-0033,
  faturamento parcial; 1 título a receber de R$ 2,00 vencendo em
  30/09/2026. Número sem dígito de propósito: a sugestão de "próximo Nº NF"
  soma 1 aos dígitos da maior nota, e uma nota "1" de teste empurraria a
  numeração da primeira nota real.
- **Envio do JOB-0033** (R$ 113.897,60, 1 parcela). O saldo dos dois jobs
  (R$ 31.918,72 e R$ 113.896,60) continua na aba Faturamento.

## O que ficou de fora, de propósito

- **Três outras leituras ainda casam nota e job por `origem_id`**, com a
  mesma cegueira. Decisão do Tiago: só a esteira nesta entrega.
  - `app/(app)/financeiro/jobs/[jobId]/page.tsx` — badge de faturamento e
    prazo; usa `.maybeSingle()`, que **erra com duas notas**.
  - `app/(app)/financeiro/jobs/[jobId]/fluxo-do-job.ts` — prazos de
    recebimento dos jobs.
  - `app/(app)/financeiro/abertura-de-job/consumo.ts` — abatimento da
    previsão de recebimento da abertura pela nota emitida.

  ⚠️ **Fechadas em 15/09/2026** — ver a nota no fim. O `consumo.ts` não
  abatia previsão nenhuma desde a 061: só grava um número na auditoria.
- **017 §7 só vale na tela.** Nem `emitirFaturamento` nem
  `emitir_faturamento` recusam itens de clientes diferentes numa nota — a
  simulação da falha 2 emitiu uma com JOB-0029 e JOB-0010, de clientes
  distintos. ⚠️ **Fechada em 14/09/2026 pela
  [079](079-a-nota-fiscal-so-cobre-jobs-de-um-cliente.md):** a RPC recusa, e
  a tela passou a comparar `cliente_id`.
- **Situação "faturado" com nota parcial.** Job com qualquer nota emitida
  vira Faturado, mesmo com saldo a faturar (é o caso dos dois jobs de
  teste, com R$ 1,00). Regra anterior, não alterada.
- **O Zod aceita data impossível** (`2026-02-30`) nas parcelas do envio. Com
  a RPC isso deixou de ser perigoso — vira erro legível e nada é gravado —,
  mas a validação continua no banco, não no formulário.
- **O link do card** (`/jobs?filtro=faturamento_pronto`) segue sem filtro
  (TODO antigo em `app/(app)/jobs/page.tsx`), e o card "Jobs prontos pra
  encerrar" diz "com faturamento emitido" mas conta job enviado.

---

## ⚠️ Nota de 2026-09-15 — as três leituras pendentes, e os prazos por média ponderada

Antes de corrigir, o Tiago pediu para conferir se a troca era mesmo
necessária ou se seria redundante.

### O que se confirmou

| Leitura | Achado |
|---|---|
| Selo da página do job (`financeiro/jobs/[jobId]/page.tsx`) | No navegador, com o código de 14/09: JOB-0029 **ENVIADO** na página e **FATURADO** na lista. A 078 (`cdc3219`, 14/09) já tinha passado a ler as notas pelos itens; sobrou a **cópia** da classificação, com o mensal lido por outro caminho (meses da planilha na página, meses da previsão de recebimento na lista) |
| Prazos (`fluxo-do-job.ts`) | Projeto Teste mostrava **25 / 0 / 25** dias — as datas previstas, com a nota já emitida. A 078 trocou a leitura para os itens e usou a **primeira emissão**, regra que só estava no código |
| `abertura-de-job/consumo.ts` | Desde a [061](061-as-previsoes-se-redistribuem-inteiras.md) não trava nada: só grava `consumido_na_edicao` na auditoria de "Editar registro", e nada no código lê o campo. Somava `valor_total` pelo cabeçalho: **R$ 0,00** no JOB-0029, com a `TESTE-ESTEIRA` emitida |
| `vw_fluxo_caixa` | Já lia `faturamento_itens` (`fat_composicao`). Nada a corrigir |
| Banco | 1 nota emitida no tenant inteiro, a de teste. Nenhum dado real afetado |

### As regras escolhidas (Tiago, 15/09/2026)

**Selo:** a página usa `faturamentoPorJob` com filtro pelo job. Não há mais
cópia da classificação.

**Consumo:** o recebimento é a **parte do job** nas notas emitidas — a mesma
da coluna Faturamento.

**Prazos** (`lib/calculos/prazos-do-job.ts`):

| Pergunta | Resposta |
|---|---|
| Job em várias notas: qual data de faturamento? | **média ponderada das emissões**, peso = parte do job em cada nota |
| O peso é sobre o quê? | sobre o que **já foi faturado** do job — não sobre o faturamento previsto. Com o job todo faturado, os dois dão o mesmo número |
| E o recebimento? | **média ponderada dos vencimentos**, pagos ou não; peso = valor do título × parte do job ÷ total da nota. Os subtítulos dos cards viraram "abertura → faturamento", "faturamento → recebimento" e "abertura → recebimento" |
| Job sem nota | como antes: data prevista de faturamento → **última** parcela prevista |
| Job mensal (078) | a mesma regra: os meses ainda sem nota não entram nos prazos |

As datas médias são arredondadas para o dia antes de medir, então
faturamento + recebimento é sempre o total.

Exemplos (os dos testes):

| Caso | Prazos (faturamento / recebimento / total) |
|---|---|
| JOB-0033 (aberto em 10/09): NF 101 com 75% em 14/09 (vence 30/09), NF 102 com 25% em 15/10 (vence 30/10) | **12 / 16 / 28** |
| NFs agrupadas meio a meio, A em 14/09 e B em 15/10 — só a A emitida | JOB-0029 **13** · JOB-0033 **4** de faturamento |
| As duas emitidas (títulos em 30/09 e 30/10) | JOB-0029 **29 / 15 / 44** · JOB-0033 **20 / 15 / 35** |
| JOB-0034 (Fee, sem nota) | **108 / 20 / 128** |

*(Descartadas: primeira emissão, 4 / 46 / 50 no primeiro exemplo; última
emissão, 35 / 15 / 50; peso sobre o faturamento previsto, que deixaria o
JOB-0029 em 29 / 0 / 29 com a nota de R$ 1,00; emissão média até o último
vencimento, 12 / 38 / 50; média das parcelas previstas no job sem nota,
que dá **−11** dias de recebimento no JOB-0034, porque as parcelas começam
antes da data prevista de faturamento; travessão no job sem nota, que
apagaria os cards de quase todos os jobs; e o mensal completando o
recebimento com a previsão dos meses sem nota, 47 / 50 / 97 contra
47 / 20 / 67 com a nota de outubro emitida.)*

### A correção

| Arquivo | O quê |
|---|---|
| `lib/data/faturamento-por-job.ts` | `notasEmitidasDosJobs(tenantId, jobIds?)` — a leitura das notas pelos itens, com os títulos, dividida pelas quatro telas; `faturamentoPorJob` ganha o filtro `jobIds`, aplicado também a envios, save e meses da previsão |
| `lib/calculos/prazos-do-job.ts` + `.test.ts` | a regra dos prazos, com a média em centavos e dias inteiros (em ponto flutuante, 27,5 dias virava 27,4999 e caía no dia anterior); 8 casos |
| `financeiro/jobs/[jobId]/page.tsx` | o selo vem de `faturamentoPorJob`; o "aguardando encerramento" do mensal continua pelos meses da planilha |
| `financeiro/jobs/[jobId]/fluxo-do-job.ts` | `carregarPrazosDosJobs` lê `notasEmitidasDosJobs` e chama a regra |
| `components/financeiro/fluxo-caixa-jobs.tsx` | subtítulos neutros dos cards de prazo |
| `abertura-de-job/consumo.ts` | recebimento pela parte do job; comentário do cadeado, obsoleto desde a 061, reescrito |

Duas diferenças que o selo da página ganha, sem caso no banco hoje: o job
pago só por save passa a aparecer **Faturado**, como já aparecia na lista; e
o mensal segue a regra de meses da lista.

### Conferido (15/09/2026)

Dev server do worktree, com a `TESTE-ESTEIRA` já emitida. Nada gravado.

| Tela | Antes | Depois |
|---|---|---|
| JOB-0029 · selo e prazos | ENVIADO · 29 / 0 / 29 | **FATURADO · 13 / 16 / 29** |
| JOB-0033 · selo e prazos | ENVIADO · 20 / 0 / 20 | **FATURADO · 4 / 16 / 20** |
| JOB-0034 (mensal, sem nota) | ENVIADO · 108 / 20 / 128 | igual |
| Projeto Teste › Fluxo de Caixa do Projeto (média) | 25 / 0 / 25 | **9 / 16 / 25** |
| Visualizar Jobs | FATURADO nos dois | igual |
| Auditoria de "Editar registro", pelo banco | recebimento R$ 0,00 | **R$ 1,00** (JOB-0029 e JOB-0033) |

Console sem erro. Testes da esteira e dos prazos (18), `tsc`, `next lint`
e `npm run build` limpos.
