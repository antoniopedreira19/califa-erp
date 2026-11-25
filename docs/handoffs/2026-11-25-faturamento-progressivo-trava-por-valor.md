# Nota parcial do Novo faturamento destrava edição (trava vira por valor) — padrão YouTube (2026-11-25)

> Antes desta sessão: qualquer NF emitida sobre um job (envio ou Novo faturamento) congelava TUDO — nem errata da produção, nem "Editar planilha" do financeiro funcionavam. Depois desta sessão: a NF do **Novo faturamento parcial** deixa de ser trava dura e vira trava por valor (a edição grava desde que o valor novo do job não caia abaixo da soma já emitida em NF). O padrão operacional do cliente Google/YouTube (depósito progressivo + fechamento trimestral) passa a funcionar sem forçar cancelamento de NF ou gestão fora do sistema.

## O que muda pro negócio

- **Errata da produção** num job com NF parcial do Novo faturamento: a produtora prepara, a GP vê "PRONTA PARA ENVIO" na faixa de cima da Planilha Interna, clica em "Revisar e enviar" e **grava**. A trava só dispara se o valor novo do job cairia abaixo da soma emitida — nesse caso, a mensagem diz exatamente o piso e sugere ou ajustar ou cancelar a NF primeiro.
- **"Editar planilha" do financeiro** no mesmo cenário: o botão volta a ficar ativo (não vem mais cinza com "O job já tem nota emitida...") e a conferência no servidor é a mesma (valor novo >= soma emitida).
- **Padrão YouTube/Google** passa a ser suportado nativamente: cliente deposita conforme precisa, financeiro emite NF a cada depósito pelo Novo faturamento, produção continua ajustando a planilha enquanto o trimestre não fecha, e no fechamento o financeiro emite a NF final/complementar.
- **Caso do GOO-1005/26** (Q4 Responsability, Google/YouTube) que motivou tudo: a errata "Passagens solicitadas…" (+R$ 5.142,91) que estava parada há 12 dias agora passa — valor novo R$ 115.904,19 >= R$ 100.000 emitidos.

## Estado atual

- **Trava DURA preservada** pra cenários onde faz sentido:
  - Envio da produção que virou NF (`porta === "envio"`) — a regra do Tiago de 31/08/2026 de "o envio é definitivo" continua.
  - Parâmetros do job (honorários, impostos, taxas) — qualquer NF trava porque esses parâmetros mexem em todas as linhas de todos os meses e têm impacto fiscal maior.
  - Modelo mensal — a trava por mês (`mesesEnviadosDoJob`) não mudou; mês com NF do Novo faturamento continua travando aquele mês individualmente.
- **Trava POR VALOR nova** só vale no nacional com NF do Novo faturamento (`porta === "financeiro"`).
- **Nenhuma migration**: a regra mora 100% no TypeScript. Funções do banco (`registrar_errata_do_job`, `registrar_alteracao_do_financeiro`) não têm trava de "job com nota emitida" nos orçados — só nos parâmetros (`gravar_parametros_da_errata`), que continua dura.
- **Helper novo**: `somaDasNotasEmitidasDoJob(tenantId, jobId)` em `lib/data/envio-faturamento.ts`, reutilizando `notasEmitidasDosJobs` (decisão 075) — soma `parte_do_job` das NFs emitidas e não canceladas.
- **Mensagem padronizada**: `mensagemValorAbaixoDasNotas(contexto, valorNovo, soma)` com variação "errata" vs "edicao".

## Decisões que vão importar amanhã

- **Qualquer cliente novo nesse padrão** (depósito progressivo + fechamento trimestral) usa o fluxo **sem** envio da produção. Combina com o financeiro que ele vai usar **Novo faturamento** direto a cada depósito. Se alguém enviar pra faturamento pela produção, fecha a porta e cai no cenário antigo (trava dura). Doc operacional: `docs/FATURAMENTO-PROGRESSIVO.md`.
- **Save com nota parcial** NÃO foi tocado nesta sessão (`MENSAGEM_CONSUMO_JA_FATURADO_PELO_FINANCEIRO` continua trava dura). Se surgir caso real de consumo de save em job com NF parcial, o fix é análogo: trava por valor (faturamento previsto depois >= soma das notas). Hoje não há demanda.
- **Parâmetros do job com NF parcial** também continuam travados. Mexer em honorários/impostos depois da primeira NF é decisão separada — abrir ADR se surgir demanda.
- **Antes de brigar com qualquer trava de "job tem nota"** em novos trechos, leia a 279 e a 265. A regra binária que existia antes sobrevive em alguns lugares por bons motivos (envio, parâmetros) — não misture.
- **Antonio decidiu sem Tiago** porque é mudança operacional reversível (sem migration, 4 arquivos TS). Se der ruim, basta reverter o commit — a nota continua lá, só volta a travar tudo.

## O que fica pra próxima sessão

- **Validar em produção**: assim que subir, pedir pra GP responsável reabrir o GOO-1005/26 e enviar a errata parada. Confirmar que (a) o botão "Revisar e enviar" fica ativo, (b) o envio grava e a errata vira "enviada" com `errata_id` populado, (c) os números do job sobem pra R$ 115.904,19 sem erro.
- **Aviso pra produtora e GP do job**: mensagem pronta no handoff do chat desta sessão (resposta anterior). Resumo: "era limitação do sistema, agora funciona, pode enviar a errata parada".
- **Doc de processo** `docs/FATURAMENTO-PROGRESSIVO.md` pra consulta quando aparecer outro cliente nesse padrão. Vale compartilhar com o time financeiro.
- **Opcional**: adicionar hint na UI quando o botão vier ativo mas com piso ("você pode editar; o valor do job não pode cair abaixo de R$ 100.000 já emitidos"). Hoje a mensagem só aparece quando o usuário tenta e o servidor recusa. Esperar feedback antes de adicionar.

## Rastros técnicos

Sem migration. Arquivos modificados:

```
lib/data/envio-faturamento.ts
  + somaDasNotasEmitidasDoJob
  + mensagemValorAbaixoDasNotas
  + import de @/lib/data/faturamento-por-job

app/(app)/jobs/[jobId]/realizado/actions-errata.ts
  * trava de porta "financeiro" vira flag, conferida por valor depois de totaisDoFinanceiro

app/(app)/jobs/[jobId]/realizado/actions-alteracao-financeiro.ts
  * temNota dividido em envioComNf (trava dura) e notasDoJob (soma pra conferência por valor)
  * Parâmetros continuam travados por qualquer nota

app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx
  * motivoErrataTravada perde ramo "financeiro"; podeErrata usa envioFechouOJob

app/(app)/financeiro/jobs/[jobId]/page.tsx
  * edicaoDoFinanceiro.travadoPor confere envioComNf; temNotaEmitida continua pra parâmetros

docs/decisions/279-nota-parcial-do-novo-faturamento-destrava-edicao-por-valor.md (novo)
docs/decisions/README.md (linha da 279 no índice, próximo número livre 280)
docs/FATURAMENTO-PROGRESSIVO.md (novo, doc operacional pra apoio ao fluxo)
```

Commits: criados após este handoff ser aprovado — serão citados abaixo depois.
