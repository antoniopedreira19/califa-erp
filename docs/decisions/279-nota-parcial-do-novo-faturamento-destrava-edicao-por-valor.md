# 279 — Nota parcial do Novo faturamento destrava edição do orçado (trava passa a ser por valor)

**Data:** 2026-11-25
**Status:** aceita e implementada em 25/11/2026 (Antonio, sem passar pelo Tiago — padrão em uso em produção pelo cliente Google/YouTube, decisão operacional reversível).
**Quem decidiu:** Antonio, em 25/11/2026, a partir de caso real do job GOO-1005/26 "Q4 Responsability" do cliente Google (YouTube): errata preparada pela produtora a produtora em 13/11 e parada 12 dias porque a GP a GP via "pronta para envio" mas o botão "Revisar e enviar" vinha travado por `MENSAGEM_JA_FATURADO_PELO_FINANCEIRO`. A trava binária "qualquer nota congela tudo" não acomodava o padrão operacional desse cliente.

## O problema

O padrão do YouTube (que vale para vários clientes grandes que não são só esse): **o cliente deposita conforme precisa, o financeiro emite NF a cada depósito, e o trimestre fecha depois com a conta real**. Na prática:

- 05/11 — Google depositou R$ 100.000 e o Tiago (financeiro) emitiu a NF 6408 do mesmo valor pelo **Novo faturamento** (decisão 256), com o job valendo R$ 106 mil.
- 10 e 13/11 — produção precisou adicionar custos novos (jobs ganham vida, aparecem gastos previstos). Duas erratas da a produtora foram enviadas pela a GP no mesmo dia; o job cresceu pra R$ 110.761,28.
- 13/11 — nova errata preparada (passagens para evento Criadores de Impacto, +R$ 5.142,91, levando o job pra R$ 115.904,19).
- A partir daí: a GP via a errata pronta na tela, clicava para enviar, e o botão vinha travado com *"O financeiro já faturou este job e o valor da nota está congelado..."*. O botão "Editar planilha" do financeiro, pelo mesmo motivo, também estava travado.

O racional da trava original (decisão 265) é correto: **depois que uma NF foi emitida, o valor do job não pode cair abaixo do que está na nota, senão o sistema diverge do que foi cobrado do cliente**. O erro foi operacionalizar isso como "qualquer nota congela tudo". Para o job que a NF fecha, essa trava binária funciona. Para o job que a NF cobre em parte (padrão YouTube), ela cria um impasse: o custo real existe, a produção precisa registrar, mas nenhum caminho oficial aceita.

Esse padrão vai se repetir em todo cliente que opera com depósito progressivo + fechamento trimestral. Hoje são Google/YouTube; vai ser mais.

## A decisão

**A nota do Novo faturamento (decisão 256) deixa de ser trava DURA do orçado — passa a ser trava POR VALOR.**

Regras:

1. **O envio da produção que virou NF continua trava DURA** (porta `"envio"`). A regra do Tiago de 31/08/2026 fica: o envio é o handoff formal da produção pro financeiro, a negociação terminou, não desfaz. Se o envio virou NF, acabou.

2. **A nota do Novo faturamento (porta `"financeiro"`) passa a liberar a edição desde que** o valor do job novo não caia abaixo da soma já emitida em NF. Em pseudocódigo:
   ```
   depois da conta da errata/edição:
     soma_notas = sum(parte_do_job in notas_emitidas_e_nao_canceladas)
     se soma_notas > 0 e depois.valor_job < soma_notas - 0.005:
       RECUSA: "faria o job cair para X, abaixo do já emitido Y"
     senão:
       LIBERA
   ```

3. **Parâmetros do job (honorários, impostos, taxas) continuam travados por qualquer nota** (envio OU Novo). Eles mexem em todas as linhas de todos os meses e têm impacto fiscal maior — manter trava dura é mais seguro.

4. **No modelo mensal** nada muda: a trava já é por mês (`mesesEnviadosDoJob`), e o mês com NF do Novo faturamento (decisão 265) continua trancando aquele mês individualmente. A frouxidão desta decisão é só do **nacional** (envio único).

## Como fica na prática

**Caminho da produção (errata):**
- `actions-errata.ts` → `montarErrata`: a porta `"envio"` segue retornando `mensagemDaPorta`. A porta `"financeiro"` deixa de retornar erro ali; a conferência passa a ser depois de `totaisDoFinanceiro`: se `depois.valorJob < somaDasNotas`, recusa com `mensagemValorAbaixoDasNotas("errata", ...)`.
- `job-realizado-section.tsx`: `motivoErrataTravada` só fala em "envio" e "todos os meses enviados" — a mensagem de "financeiro" sumiu. A faixa "Errata pronta para envio" e o botão "Revisar e enviar" ficam destravados pra nota parcial do Novo faturamento. O servidor confere no clique.

**Caminho do financeiro (Editar planilha):**
- `actions-alteracao-financeiro.ts` → `montarAlteracao`: a trava `temNota` (que recusava `MENSAGEM_JOB_COM_NOTA`) só dispara se o envio da produção virou NF (`envioComNf`). Para nota só do Novo faturamento, a conferência é por valor depois de `totaisDoFinanceiro`, com `mensagemValorAbaixoDasNotas("edicao", ...)`.
- `financeiro/jobs/[jobId]/page.tsx`: `edicaoDoFinanceiro.travadoPor` só dispara pra `envioComNf` (envio sem `peloFinanceiro` e com `faturado > 0`). Pra nota do Novo faturamento (`envioUnico.peloFinanceiro !== null`), o botão "Editar planilha" volta a funcionar. Servidor confere.

**Mensagem padronizada em caso de recusa por valor:**

```
O financeiro já emitiu notas que somam R$ 100.000,00 sobre este job.
Esta errata/edição faria o valor do job cair para R$ 90.000,00, abaixo
do já emitido. Ajuste para não deixar o job valer menos do que já foi
cobrado, ou peça o cancelamento da nota antes.
```

## Implementação (todos no mesmo commit)

**Nenhuma migration.** A trava mora 100% no TypeScript — a função do banco `registrar_errata_do_job` só tem travas estruturais, não checa nota; `registrar_alteracao_do_financeiro` também não. A regra de parâmetros em `gravar_parametros_da_errata` já existe e continua dura, o que está alinhado com o item 3.

- `lib/data/envio-faturamento.ts`:
  - Nova função `somaDasNotasEmitidasDoJob(tenantId, jobId)`: soma de `parte_do_job` em todas as NFs emitidas (não canceladas) do job, lida pela esteira (`notasEmitidasDosJobs`, decisão 075).
  - Nova função `mensagemValorAbaixoDasNotas(contexto, valorNovo, somaDasNotas)`: padroniza a frase de recusa, com variação "errata" vs "edição".
  - Import de `@/lib/data/faturamento-por-job` acrescentado.
- `app/(app)/jobs/[jobId]/realizado/actions-errata.ts`:
  - `montarErrata`: a trava de porta `"envio"` segue; a `"financeiro"` vira flag `portaDoFinanceiro` conferida mais abaixo. Novo bloco depois de `totaisDoFinanceiro(depoisItens, baseDepois)` que lê `somaDasNotasEmitidasDoJob` e recusa se `depois.valorJob < soma`.
  - Imports: `mensagemValorAbaixoDasNotas`, `somaDasNotasEmitidasDoJob`.
- `app/(app)/jobs/[jobId]/realizado/actions-alteracao-financeiro.ts`:
  - `montarAlteracao`: `temNota` dividido em `envioComNf` (trava dura) e `notasDoJob` (soma usada mais abaixo). `MENSAGEM_JOB_COM_NOTA` só dispara pra `envioComNf`. `MENSAGEM_PARAMETROS_COM_NOTA` continua disparando pra qualquer nota. Novo bloco depois de `totaisDoFinanceiro(itensDepois, baseDepois)` que confere o valor contra a soma das notas e recusa com `mensagemValorAbaixoDasNotas("edicao", ...)`.
  - Imports: `formatCurrency`, `mensagemValorAbaixoDasNotas`.
- `app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx`:
  - `podeErrata` passa a usar `envioFechouOJob = jaEnviadoParaFaturamento === "envio"` em vez de `!jaEnviadoParaFaturamento`.
  - `motivoErrataTravada` perde o ramo `=== "financeiro"`: só trava por envio ou todos os meses enviados.
- `app/(app)/financeiro/jobs/[jobId]/page.tsx`:
  - `edicaoDoFinanceiro.travadoPor` passa a conferir `envioComNf` em vez de `temNotaEmitida`. `envioComNf` é `envioUnico.envio !== null && envioUnico.peloFinanceiro === null && envioUnico.faturado > 0.004` — ou seja, só o envio da produção que virou NF.
  - `temNotaEmitida` continua definida e usada na trava dos PARÂMETROS do job (linha 912), que mantém a trava binária (item 3 da decisão).

## O que fica de fora (deliberado)

- **Parâmetros do job com nota parcial** — hon./impostos/taxas continuam travados por qualquer nota, como antes. Mexem em todas as linhas e têm impacto fiscal; tratar como caso à parte se vier demanda.
- **Save com nota parcial** — a porta do consumo de save (`MENSAGEM_CONSUMO_JA_FATURADO_PELO_FINANCEIRO`) não foi tocada. Se surgir caso real, o fix é análogo: trava por valor (faturamento previsto depois ≥ soma das notas).
- **Hint na UI de "edição permitida, valor-piso R$ X"** — poderia ser útil, mas é refinamento. Hoje o usuário tenta e o servidor recusa com a frase que explica o piso. Deixar pra ver se gera reclamação.
- **Validação por mês no nacional misto** — se um dia houver nacional com múltiplas NFs em janelas distintas, a conta ainda é pela soma total. Sem demanda hoje.

## Como voltar atrás

Mudança 100% em TypeScript, sem migration. Reverter os 4 arquivos (e o helper em `envio-faturamento.ts`) restaura a trava binária original. O código novo é aditivo — não apaga mensagens antigas, só deixa de usá-las em alguns ramos.

## Caso que motivou

Job **GOO-1005/26** "Q4 Responsability", cliente Google (YouTube), produtora a produtora, a GP:

- 05/11/2026 — NF 6408 pelo Novo faturamento: R$ 100.000 de R$ 106.683,24 (saldo R$ 6,6 mil).
- 10/11 ×2 — erratas enviadas pela a GP em 3 min e ~40 min (as duas antes da NF chegar ao limite).
- 13/11 — errata "Passagens solicitadas para o evento criadores de Impacto" (+R$ 5.142,91, levaria o job pra R$ 115.904,19) ficou **12 dias parada** porque o botão "Revisar e enviar" vinha travado pelo `MENSAGEM_JA_FATURADO_PELO_FINANCEIRO`.
- Com esta decisão, essa errata passaria na nova regra: R$ 115.904 >= R$ 100.000 → libera.

## Relação com outras decisões

- **256** (Novo faturamento): cria a porta `"financeiro"` que esta decisão afrouxa.
- **265** (Novo faturamento fecha a porta como o envio): era a regra binária. Esta decisão a mantém para parâmetros e para o mensal, revoga para o orçado do nacional.
- **115** (Editar planilha do financeiro): o botão que ficava cinza na tela do financeiro passa a ficar ativo pra nota parcial do Novo faturamento.
- **159** (Errata preparada pelo produtor, enviada pelo GP): a faixa "pronta para envio" continua funcionando igual — só o `travadoPor` do botão de envio deixa de disparar pra Novo faturamento parcial.
- **031** (envio é definitivo, não desfaz): mantida, suportando a parte "`"envio"` continua trava dura".
