# 094 — O selo "Em faturamento", e o Finalizado passa a valer pelo envio

**Data:** 2026-09-20
**Decidido por:** Tiago
**Migration:** `20260920190001_em_faturamento_e_finalizado_pelo_envio.sql`

Revê a [087](087-faturamento-e-encerramento-correm-separados.md) §3 ("O status
`finalizado` e quem o grava"). O resto da 087 continua valendo: as duas
trilhas, o que trava o encerramento, a fila e o fluxo de caixa.

---

## 1. O problema

A 087 separou faturamento e encerramento, mas só um dos lados aparecia no
status: o job encerrado antes de faturar virava "Encerrado"; o job faturado
antes de encerrar continuava "Aberto", igual a um job em que nada aconteceu.
O pedido do Tiago (20/09/2026) foi ter os dois status intermediários — cada um
aparece quando a sua ação foi feita e a outra ainda não; com as duas, o job
fica "Finalizado" sozinho.

E, ao definir o lado do faturamento, a regra da 087 mudou. Nas palavras dele:

> *"Faturado não deve ser o status, e sim 'em faturamento'. Se o job foi
> faturado ou não será controlado pelo financeiro; no módulo jobs, só deverá
> acompanhar que foi enviado e está em faturamento, visto que, caso uma nota
> seja cancelada, outra será emitida, e isso será controlado pelo financeiro,
> desde que o faturamento esteja alinhado com o cliente, o que deve estar no
> momento de envio para faturamento."*

## 2. A regra (respostas do Tiago, 20/09/2026)

1. **A ação de faturamento, para o módulo Jobs, é o ENVIO.** Nota emitida,
   cancelada ou reemitida é controle do financeiro e não mexe no status do job.
2. **Os quatro status do job já aberto:**

   | Envio para faturamento | Encerramento | Status |
   |---|---|---|
   | falta | não | **Aberto** |
   | completo | não | **Em faturamento** |
   | falta | sim | **Encerrado** |
   | completo | sim | **Finalizado** |

3. **Finalizado = encerrado + todo o faturamento enviado.** Deixa de esperar a
   última nota (era a 087). O job finalizado continua na fila do financeiro até
   as notas saírem — a `vw_faturamento_pendente` já aceitava `finalizado`.
4. **No mensal (Fee / Always On) só o ÚLTIMO mês enviado conta.** Enquanto
   faltar mês por enviar o job segue "Aberto" (ou "Encerrado"), e só fica
   finalizado com todos os meses enviados e o job encerrado.
5. **Job sem faturamento previsto** (pago só por save, 028 §11) **segue
   "Aberto"** — não houve ação de faturamento — e vira "Finalizado" direto no
   encerramento, como já era.
6. **"Em faturamento" é selo calculado; o status gravado continua `aberto`.**
   O job em faturamento continua aberto para a produção: PP, realizado e BV
   seguem liberados, e nenhuma trava de `aberto` (52 checagens em 18 arquivos,
   21 migrations) precisa conhecer o selo.

"Todo o faturamento enviado" é a primeira metade da conta que a 087 já fazia:
a soma dos envios cobre o faturamento previsto, com os mesmos 5 centavos de
folga (JOB-0034: meses R$ 50.105,64, job R$ 50.105,63). A segunda metade —
parcela sem nota emitida — saiu.

## 3. Banco

- **`jobs.faturamento_enviado_em`** — carimbo de quando o envio ficou completo.
  É o que as listas leem para o selo, sem embed nem soma. Nulo enquanto falta
  enviar, e sempre nulo no job sem faturamento.
- **`job_faturamento_todo_enviado(job, previsto)`** — previsto maior que zero e
  soma dos envios ≥ previsto − 0,05.
- **`trg_envio_faturamento_marca_job`** (AFTER INSERT OR UPDATE OF
  `valor_faturado` em `jobs_envio_faturamento`): carimba o job e, se ele já
  estiver `encerrado`, grava `finalizado` e a auditoria `job.finalizado`
  `{"momento": "envio_para_faturamento", "envio_id": …}`. Trava a linha do job
  com `for update` — fecha a corrida entre envio e encerramento que a revisão
  da 087 tinha apontado.
- **`trg_jobs_carimba_faturamento_enviado`** (BEFORE UPDATE OF
  `faturamento_previsto`, `faturamento_enviado_em` em `jobs`): o carimbo é do
  banco. Errata que muda o previsto recalcula; um PATCH direto na coluna é
  recalculado e não "pega".
- **`jobs_finaliza_ao_encerrar`** passou a olhar o envio (ou o previsto zero),
  não a nota.
- **Saiu** o gatilho `trg_faturamento_itens_finaliza_job` e a função
  `faturamento_item_finaliza_job()`: com o envio completo o job encerrado já
  está finalizado antes de qualquer nota. `job_esta_faturado` ficou, sem
  decidir status.
- As funções são `security definer` e nenhuma é executável por `anon` ou
  `authenticated` (conferido).
- **Backfill:** só o carimbo vazio dos cinco jobs com envio completo —
  JOB-0007 e JOB-0034 (finalizados), JOB-0010, JOB-0029 e JOB-0033 (abertos).
  Nenhum job estava `encerrado`, então nenhum mudou de status.

## 4. Tela

- `lib/types.ts`: `JobStatusExibido` (= `JobStatus` + `em_faturamento`) e
  `jobStatusExibido(status, faturamento_enviado_em)`. `jobStatusLabel` e
  `jobStatusBadgeClasses` aceitam o status exibido. **Selo laranja** — azul é
  do aberto, violeta do encerrado, verde do finalizado.
- O status exibido é calculado **no carregador**, e o campo novo em `Job` é
  obrigatório (regra do `CLAUDE.md` sobre tipo de linha estreito). Onde o
  status só vira selo, a linha já sai com o status exibido; onde ele decide
  trava (detalhe do job), `job.status` fica intacto e o selo usa uma variável à
  parte.
- Onde aparece: lista de jobs (selo **e filtro "Em faturamento"**), cabeçalho
  do job, "Jobs do projeto" da ficha, visão agregada (selo do card, da tabela
  e a "Distribuição"), cabeçalho do job e página do projeto no financeiro.
- **Não mudou:** o "Visualizar Jobs" do financeiro, que só marca o status
  diferente de `aberto` e já tem a própria esteira (Aguardando envio · Enviado ·
  Faturado · Liquidado); o funil do orçamento; os cards da home.
- **Envio para encerramento:** o aviso amarelo virou *"Falta enviar para
  faturamento — mas isso não trava o encerramento"* e só aparece quando o envio
  está incompleto (não fala mais em nota nem em saldo). Rodapé do "Ver envio":
  *"Finalizado em DD/MM/AAAA: encerrado e enviado para faturamento."* ou *"O
  job fica finalizado quando todo o faturamento for enviado para o
  financeiro."*
- O "Aguardando encerramento" do cabeçalho do job no financeiro continua pela
  nota (`faturamentoCompleto`): é a tela de quem controla a nota.

## 5. Conferência (20/09/2026)

Por simulação no banco, em transação desfeita (conferido depois: JOB-0009 e
JOB-0033 como estavam, nenhum envio restante):

| Cenário | Resultado |
|---|---|
| JOB-0033 (já enviado) encerrado | `finalizado` |
| JOB-0009 (sem envio) encerrado | `encerrado`, sem carimbo |
| …envio parcial (R$ 100,00) | segue `encerrado`, sem carimbo |
| …envio completado | `finalizado`, com carimbo e `finalizado_em` |
| JOB-0009 aberto + envio completo | segue `aberto`, com carimbo |
| Carimbo escrito à mão num job sem envio | volta a nulo |
| Previsto zero, aberto → encerrado | sem carimbo → `finalizado` |

Pelas telas, no navegador do app, Projeto Teste:

- **Lista de jobs:** JOB-0029 e JOB-0033 "Em faturamento" (laranja); JOB-0008 e
  JOB-0009 "Aberto"; filtro de status com "Em faturamento", que deixa só os
  dois.
- **JOB-0033:** cabeçalho "Em faturamento" com o "Editar" ainda disponível;
  "Jobs do projeto" com os dois selos; barra com a trilha Faturamento
  ("Faturado parcial · R$ 1,00 de R$ 113.897,60") e Encerramento inalteradas.
- **Visão agregada:** "2 finalizado · 2 aberto · 2 em faturamento · 1
  aguardando abertura".
- **Financeiro, cabeçalho do JOB-0033:** "Em faturamento" ao lado da situação
  do financeiro.

`tsc`, `next lint` (só o aviso antigo do `multi-select`) e `next build` limpos.
`test:permissoes`: as 2 falhas do RH, anteriores.

- **Diálogo de envio para encerramento**, por rota temporária já apagada e sem
  enviar nada (os jobs abertos do Projeto Teste têm pendência e o botão real
  não abre o diálogo):
  - JOB-0009, sem envio: caixa amarela *"Falta enviar para faturamento — mas
    isso não trava o encerramento. O job ainda não foi enviado para
    faturamento. O envio continua disponível depois do encerramento, e o job
    fica finalizado quando for enviado."*, abaixo da caixa vermelha das
    pendências, com o botão desabilitado;
  - JOB-0033, envio completo: sem caixa amarela;
  - JOB-0034, modo "ver": rodapé *"Finalizado em 16/09/2026: encerrado e
    enviado para faturamento."*

**Não conferido na tela:** a frase do mensal com meses por enviar — não há job
mensal aberto no Projeto Teste (o JOB-0034 está finalizado e o JOB-0037
aguarda abertura). É o mesmo ramo da frase que a 087 já conferiu, com o final
trocado.

## 6. Consequências e pendências

- **JOB-0010 (MICHELOB · IMC 2026, TET-0001/26)** é job real, enviado em
  14/08/2026 e ainda sem nota: passa a aparecer como "Em faturamento".
- **A migration vale para o app no ar antes do deploy.** O selo só aparece
  depois do deploy; o que já vale é o Finalizado pelo envio. Nenhum job está
  `encerrado` hoje.
- O "Visualizar Jobs" do financeiro não ganhou o selo (ver §4) — fica a
  pergunta se deveria.
- As pendências da 087 §7 seguem abertas (confirmação do encerramento pelo
  financeiro, card "Jobs prontos pra encerrar").
