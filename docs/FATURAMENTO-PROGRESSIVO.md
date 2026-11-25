# Faturamento progressivo — cliente deposita conforme precisa, trimestre fecha depois

> **Leia antes de mexer** nas travas de errata ou de "Editar planilha" do financeiro, em qualquer caminho que confere "job tem nota emitida".

Documento operacional que descreve o padrão de faturamento progressivo (Google/YouTube e similares), como o sistema o trata hoje e o que fazer quando ele aparecer num novo cliente.

## 1. O padrão

Alguns clientes grandes não fecham o preço do job antes do trabalho. Eles **depositam conforme precisam**, e o fechamento acontece ao final de uma janela (normalmente trimestre). Cada depósito gera uma nota fiscal parcial; a nota final sai no fechamento, com o valor real da conta.

Hoje, o caso principal é o **Google/YouTube**. O padrão vai se repetir em outros: qualquer cliente estratégico que opere com adiantamento + conta aberta.

**Diferença pra um job normal:**

| Job normal | Job com faturamento progressivo |
|---|---|
| Preço acordado antes do trabalho | Valor inicial é uma estimativa; cresce conforme o trabalho pede |
| Nota fiscal sai quando o job está pronto | Notas fiscais saem a cada depósito (parcial) |
| Uma errata por imprevisto, enviada ao financeiro | Erratas constantes enquanto o trimestre está aberto |
| Encerra quando bate o custo do fornecedor | Encerra na data de fechamento da conta com o cliente |

## 2. Como o sistema trata hoje

Não existe um "tipo de job" especial pra faturamento progressivo. Ele é um **job normal (nacional)** em que o financeiro usa o **Novo faturamento** (decisão 256) a cada depósito, emitindo NF parcial.

A diferença operacional vs. qualquer outro job normal está em duas travas:

### 2.1 Errata da produção

Quem prepara: produtor, pela planilha. Quem envia ao financeiro: GP.

- Até a primeira NF, nada muda: a errata fluí como sempre (decisão 159).
- Depois da primeira NF **parcial** do Novo faturamento (decisão 265 revista pela 279):
  - A errata pronta continua aparecendo na tela da GP ("PRONTA PARA ENVIO · Aguardando o envio por um GP").
  - O botão "Revisar e enviar" **fica ativo**.
  - No clique, o servidor confere: se o novo valor do job cairia abaixo da soma das NFs já emitidas, recusa com `mensagemValorAbaixoDasNotas("errata", ...)`. Caso contrário, grava normalmente.

### 2.2 "Editar planilha" do financeiro

Quem usa: administrador ou financeiro, pela tela do job no financeiro.

- Até a primeira NF, o botão funciona normalmente (decisão 115).
- Depois da primeira NF **parcial** do Novo faturamento:
  - O botão **fica ativo** (não vem cinza com "O job já tem nota emitida...").
  - No clique, o servidor confere por valor. Mesma regra: valor do job depois >= soma das NFs já emitidas.

### 2.3 O que ainda trava DURO (não mudou)

- **Envio da produção que virou NF.** Se o GP enviou ao financeiro e o financeiro emitiu a NF em cima do envio, acabou: errata e "Editar planilha" ficam travados com "Job já enviado para faturamento..." Isso é a regra do Tiago de 31/08/2026 — o envio é definitivo.
- **Parâmetros do job** (honorários, impostos, taxas, câmbio). Qualquer NF trava os parâmetros, porque mexem em todas as linhas e têm impacto fiscal. O câmbio segue editável, como sempre.
- **Modelo mensal** (Fee, Always On). A trava já é por mês; o mês com NF do Novo faturamento trava individualmente aquele mês.

## 3. O fluxo operacional pra GP, produtor e financeiro

**Quando esse padrão se aplica:** cliente que deposita conforme precisa e fecha trimestralmente. Hoje, Google/YouTube. Pergunte antes de abrir o job: "esse cliente está fechado com valor definido ou vai depositando?".

**Enquanto o trimestre está aberto:**

1. Financeiro cria o job com um valor inicial estimado.
2. A cada depósito do cliente, **financeiro emite NF parcial pelo Novo faturamento** (botão na tela do job no financeiro).
3. Produção usa o job normalmente: gera PPs, registra realizações.
4. Quando surge custo novo não previsto: **produtor prepara errata**, GP revisa e envia. Enquanto a soma do valor do job estiver >= soma das NFs já emitidas, passa.
5. Se uma errata faria o job cair abaixo da soma emitida (ex.: cancelar linha que sozinha baixaria muito), o sistema recusa com a soma como referência. O caminho é: cancelar a NF correspondente (contabilidade) OU reequilibrar a errata.

**Fechamento do trimestre:**

1. Alinhamento entre GP, financeiro e cliente sobre o valor final.
2. Financeiro emite a NF final complementar, cobrindo o saldo entre as NFs parciais e o valor do job no fechamento.
3. Job segue o fluxo normal de encerramento.

## 4. Como o sistema sabe que é "Novo faturamento"

A pista é o campo `faturamentos.faturado_pelo_financeiro = true`. Essa flag diferencia:

- NF emitida a partir do envio da produção (`faturado_pelo_financeiro = false`) → **trava DURA** (envio é definitivo).
- NF emitida direto pelo financeiro sem envio (`faturado_pelo_financeiro = true`) → **trava POR VALOR** (padrão progressivo).

A função de banco `novo_faturamento_do_job(p_job_id)` devolve as NFs do Novo faturamento (com `mes` quando é do mensal, `null` quando é do job inteiro). A função TypeScript `jobJaEnviadoParaFaturamento` consolida isso em `false | "envio" | "financeiro"`.

A soma emitida por job (pra conferir a regra por valor) vem de `somaDasNotasEmitidasDoJob(tenantId, jobId)` — soma de `parte_do_job` nas NFs emitidas e não canceladas, lida pela mesma esteira que o dashboard já usa.

## 5. O que fazer ao encontrar um cliente novo nesse padrão

1. **Combinar com o financeiro** se ele vai usar Novo faturamento (botão no card de faturamento do job, no financeiro). É o único caminho que preserva a flexibilidade de errata/"Editar planilha" depois da primeira NF.
2. **Não** usar "Enviar para faturamento" (envio da produção) nesses jobs se o trimestre ainda não fechou — isso fecha a porta.
3. Documentar em algum lugar do job (descritivo, chat) que o cliente opera com depósito progressivo, pra GP novo não ficar perdido.

Se surgirem casos em que a regra "por valor" não cobre a realidade (ex.: cliente que às vezes PEDE pra devolver parte do depósito, o que faria o valor cair abaixo da nota), abrir ADR nova. Não gambiarrar a trava.

## 6. Referências

- **Decisão 256** — Novo faturamento (a porta `"financeiro"`).
- **Decisão 265** — Novo faturamento fecha a porta como o envio (revista pela 279).
- **Decisão 279** — Nota parcial do Novo faturamento destrava edição do orçado (passa a ser trava por valor). **Esta é a decisão operacional atual.**
- **Decisão 159** — Errata preparada pelo produtor, enviada pelo GP.
- **Decisão 115** — "Editar planilha" do financeiro.
- **Decisão 031** (de 31/08/2026) — O envio da produção é definitivo, não desfaz.
- **Código:**
  - `lib/data/envio-faturamento.ts` (helpers `jobJaEnviadoParaFaturamento`, `somaDasNotasEmitidasDoJob`, `mensagemValorAbaixoDasNotas`).
  - `app/(app)/jobs/[jobId]/realizado/actions-errata.ts` (`montarErrata`).
  - `app/(app)/jobs/[jobId]/realizado/actions-alteracao-financeiro.ts` (`montarAlteracao`).
  - `app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx` (`motivoErrataTravada`, `podeErrata`).
  - `app/(app)/financeiro/jobs/[jobId]/page.tsx` (`edicaoDoFinanceiro.travadoPor`).
