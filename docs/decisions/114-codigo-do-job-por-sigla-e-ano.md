# 114 — O código do job é [SIGLA]-[SEQ]/[AA], com 1 na frente em 2026

**Data:** 2026-09-28
**Decidido por:** Tiago
**Migration:** `20260928200001_codigo_do_job_por_sigla.sql` — ⚠️ destrutiva
(sobrescreve `jobs.codigo`), aplicada só na hora combinada com a frente do
Antonio.

---

## 1. O problema

O job era `JOB-NNNN`, um sequencial único da agência. O Tiago apontou que o
formato que o ERP usava para os **projetos** (`AMB-0006/26`: sigla do
cliente, sequencial, ano) é o que a agência usa para os **jobs**. E o outro
sistema da agência também abre jobs nesse formato — ainda abaixo do
milhar —, então os códigos do ERP não podem repetir os dele.

Plano com o de-para completo e as opções:
https://claude.ai/artifact/LCRzQt1wbr3jL2YnUdbjS9

## 2. A regra

1. **Formato:** `[SIGLA]-[SEQ_4]/[AA]`. Ex.: `AMB-1006/26`.
2. **SIGLA:** o código curto **atual** do cliente do projeto do job. Não a
   sigla gravada no código do projeto, que envelhece quando o projeto
   troca de cliente (o `HIT-0001/26` é da Universal: os jobs dele são
   `UER-…`).
3. **AA:** o ano em que o job é **criado** (quando ele ganha código), no
   fuso de São Paulo. Não a data de início, que se edita depois.
4. **SEQ:** por sigla e ano — o maior número já usado + 1. Número não volta
   a ser usado: cancelado, devolvido ou apagado queima o dele.
5. **O 1 de 2026:** em 2026 o sequencial começa em **1001** ("um 1 no lugar
   do primeiro 0"), para nunca repetir um código do outro sistema. De 2027
   em diante começa em **0001** — vale enquanto o outro sistema não abrir
   jobs depois de 2026.
6. **Código anterior:** os jobs que existiam guardam o `JOB-NNNN` em
   `jobs.codigo_anterior`. A ficha do job mostra "Código anterior", e a
   busca da fila, do Visualizar Jobs e da lista de Jobs acha pelos dois.

## 3. A troca dos jobs existentes

Os 23 jobs de 28/09/2026, em ordem de criação dentro da sigla (ensaio de
28/09 conferido contra o plano, 23 códigos distintos):

- **AMB:** JOB-0024 → AMB-1001/26 · 0025 → 1002 · 0031 → 1003 · 0033 → 1004
  · 0035 → 1005 · 0036 → 1006 · 0037 → 1007 · 0038 → 1008 · 0045 → 1009.
- **TES:** JOB-0032 → TES-1001/26 · 0034 → 1002 · 0039 → 1003 · 0040 → 1004
  · 0041 → 1005 · 0042 → 1006 · 0043 → 1007 · 0044 → 1008 · 0047 → 1009 ·
  0048 → 1010 · 0050 → 1011 · 0051 → 1012.
- **UER:** JOB-0046 → UER-1001/26 · 0049 → UER-1002/26.

A migration guarda o código anterior, troca o código e grava um evento
`job.codigo_trocado` por job. Nada fora de `jobs.codigo` guarda o código do
job como texto; o histórico de auditoria e os arquivos já emitidos (PDFs de
PP, planilhas) ficam com o código antigo.

## 4. O que muda no sistema

- `lib/codigos/jobs.ts`: gerador novo (`gerarCodigoJob` recebe o projeto),
  `proximoCodigoDeJob`, `anoDoCodigoDeJob` e `compararCodigosDeJob` (ano e
  número). Testes em `lib/codigos/jobs.test.ts`.
- **Ordem:** oito consultas que ordenavam jobs por `codigo` passam a
  ordenar por `created_at` — com `JOB-NNNN` o texto era a ordem de criação;
  com a sigla na frente, não é. A lista de Jobs da produção ordena grupos e
  jobs pela criação; a faixa do projeto e o desempate do Visualizar Jobs
  usam `compararCodigosDeJob`.
- **Prévia do próximo código** na tela do orçamento: sigla do cliente e ano
  de hoje; cliente sem código curto mostra travessão (o envio recusa).
- `lib/types.ts` (`Job`), `JobNaFila`, `JobAberto`, `JobRow` e a ficha
  ganharam `codigo_anterior`, obrigatório.

## 5. Como publicar

O código lê `jobs.codigo_anterior`, que só existe depois da migration, e o
gerador antigo (`JOB-%`) deixa de achar código depois da troca. Então, num
horário sem uso e combinado com o Antonio:

1. aplicar a migration pelo MCP e conferir no banco;
2. publicar o código no main logo em seguida;
3. conferir se algum job foi criado no intervalo com `JOB-NNNN` e, se
   houver, trocá-lo pela mesma regra;
4. conferir fila, Visualizar Jobs, lista de Jobs, ficha, faixa e prévia.

## 6. Fica de fora

- **Códigos de projeto e de orçamento:** em decisão (D5 e D6 do plano). Em
  2026 não há conflito — job começa em 1, projeto em 0 —, mas em 2027 um
  job `AMB-0001/27` e um projeto `AMB-0001/27` teriam o mesmo texto. Precisa
  estar resolvido antes da virada do ano.
- **Contas a Pagar** busca pelo código atual do job; o anterior não entra
  lá.
- **`vw_saves_por_job`** segue ordenada pelo código do job: a lista de
  saves fica agrupada por cliente.
