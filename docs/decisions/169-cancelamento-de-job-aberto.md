# 169 — Cancelamento de job aberto: a produção pede, o financeiro decide

**Data:** 2026-10-13
**Status:** aceita e implementada (13/10/2026).
**Quem decidiu:** Tiago, em 13/10/2026, sobre o protótipo
("Cancelamento de job", artifact v8) e as quatro recomendações dele.
**Revisa:** a [020](020-cancelar-job-so-antes-da-abertura.md), que não tinha
caminho nenhum para cancelar job aberto.
**Completa:** a [163](163-job-cancelado-sai-do-modulo-de-jobs.md) (o job
cancelado sai do módulo de Jobs e o orçamento fica como histórico).
**Migration:** `20261013700001_cancelamento_de_job_aberto.sql`.

## O pedido

Até aqui job aberto pelo financeiro não se cancelava pelo sistema (020). O
único caso, o ANI-1004/26 em 09/10, foi corrigido pelo MCP, e a nota da 020
já dizia que, se acontecesse de novo, a saída era construir a tela.

Nas palavras do Tiago:

> Isso deverá ser feito pela produção, com algum botão de cancelar o job, o
> qual enviará o mesmo para a tela de abertura de job, onde o financeiro
> poderá aprovar o cancelamento. Ao ser feito, esse job sai do modulo de
> jobs, e apenas o seu orçamento fica registrado como Job Cancelado. Além
> disso, deve ficar um rastro do ocorrido para auditoria.

## As quatro respostas

| # | Pergunta | Resposta (a recomendação, aceita) |
|---|---|---|
| 1 | Onde mora o botão | No menu **"⋯"** do cabeçalho do job, ao lado de "Editar": "Solicitar cancelamento · O financeiro aprova ou recusa". |
| 2 | E as PPs do job | **Gerada, em avaliação ou rejeitada**: a produção cancela no próprio pop-up do pedido (mesmo padrão da 143). **Aprovada ou paga**: trava o pedido. |
| 3 | O job enquanto o financeiro não decide | **Parado**: nada novo nasce nele. |
| 4 | Quem pede e quem decide | Pede o **GP** ou o **administrador** (`jobs.solicitar_cancelamento`). Decide o **financeiro** ou o **administrador** (`jobs.decidir_cancelamento`). |

## O fluxo

1. **Pedido.** No menu "⋯" do job aberto, "Solicitar cancelamento" abre o
   pop-up com o motivo (10 a 500 caracteres) e "Enviar ao financeiro". Se o
   job tiver PP viva, o pop-up lista as PPs e oferece "Cancelar as N PPs"
   antes (confirmação em dois passos). PP aprovada ou paga aparece em
   vermelho e o envio fica desligado.
2. **Pendente.** O job ganha o selo **"Cancelamento solicitado"** (na
   página, na lista de Jobs e em Visualizar Jobs do financeiro) e a faixa
   âmbar com o motivo e "Retirar pedido". A barra de faturamento e
   encerramento vira uma linha: "Cancelamento aguardando o financeiro, na
   Abertura de Job". O status gravado continua `aberto`, como o "Em
   faturamento" da 094: o selo é calculado.
3. **Fila do financeiro.** Na Abertura de Job, a faixa **"Cancelamentos"**
   vem antes de erratas e aberturas novas, com o botão "Revisar" (era
   "Revisar cancelamento" até 14/10/2026 — nota de 14/10 na decisão 036). O
   pop-up mostra quem pediu e o motivo, os dados do job (com a regional),
   **o que o cancelamento desfaz** (recebimento, custo e impostos previstos,
   e o projeto financeiro que fica inativo quando só tinha esse job) e
   **"Visualizar job"**, que abre a página do job no financeiro já na
   Planilha Interna. O Voltar de lá devolve ao mesmo pop-up (a URL da fila
   guarda `?revisar=<job>`, decisão 108).
4. **Decisão.**
   - **Recusar** pede justificativa (10 a 500). O job volta ao normal e a
     página dele mostra a faixa vermelha "Cancelamento recusado pelo
     Financeiro", com a justificativa e "Dispensar aviso".
   - **Aprovar** abre a confirmação, com a observação opcional (0 a 500) só
     ali. "Sim, cancelar o job" grava.
   - A produção pode **retirar** o pedido enquanto ele está pendente.

## O que a aprovação faz

- `jobs.status` vai a `cancelado` (e uma revisão de abertura pendente é
  fechada). Pela 163, o job some do módulo de Jobs e das listas do
  financeiro.
- **Nada é apagado.** As previsões da abertura ficam gravadas, como no
  ANI-1004. Elas saem das contas pelo status: `vw_fluxo_caixa` só lista job
  aberto, em produção, encerrado ou finalizado. O pedido guarda a foto do
  que saiu (recebimento, custo e impostos).
- O **projeto financeiro** que fica sem job vivo vai a `ativo = false`.
- O **orçamento** continua `job_criado` (163). A página dele diz **"Job
  cancelado"** no selo e nos avisos de estado, e mostra, na versão que gerou
  o job, a faixa com o motivo da produção, a observação do financeiro, o
  histórico do pedido e o que saiu do fluxo de caixa. Na lista de orçamentos
  do projeto, a linha diz **"Job Cancelado"** e mostra o código do job
  riscado.

## Onde o pedido trava

Além das PPs aprovadas ou pagas, o pedido não sai (e a aprovação confere de
novo) quando o job tem algo que o sistema não sabe desfazer. É a mesma
conferência feita à mão no ANI-1004:

- envio para faturamento;
- lançamento financeiro;
- recebimento antes da NF (não cancelado);
- desembolso (não cancelado);
- save gerado, consumido ou pedido.

Nesses casos o pop-up diz o motivo e manda falar com o financeiro.

## Job parado, no servidor

Com o pedido pendente, a trigger `guarda_job_com_cancelamento_pendente`
recusa: PP nova, envio de PP ao financeiro (`em_avaliacao`), errata, errata
pronta para envio, pedido de save, envio para faturamento e encerramento ou
finalização do job. A tela esconde os mesmos botões. O "Editar" das
informações do job continua liberado.

## O rastro

- Tabela `jobs_cancelamentos`: um registro por pedido, com situação
  (`pendente`, `retirado`, `recusado`, `aprovado`), motivo, quem pediu,
  quem retirou, quem decidiu, justificativa ou observação e a foto das
  previsões. Sem DELETE; escrita só pelas funções.
- `audit_events`: `job.cancelamento_solicitado`, `job.cancelamento_retirado`,
  `job.pps_canceladas_no_pedido_de_cancelamento`, `job.cancelamento_recusado`
  e `job.cancelado_apos_abertura` (com a foto).
- Na faixa do orçamento, as decisões do financeiro saem sem o nome de quem
  decidiu, como a devolução da abertura (136). O nome fica no banco e na
  auditoria.

## Fora desta decisão

- O número do card da Central Financeira (`app/(app)/financeiro/page.tsx`)
  não conta os pedidos de cancelamento. O arquivo é da outra frente.
- Cancelamento de job **antes** da abertura continua como na 020 e na 057.

## Junto: o banner do orçamento de job já aberto

Na conferência apareceu um defeito antigo (desde 31/07): na página do
orçamento, um job já aberto pelo financeiro aparecia como "Aguardando
abertura pelo financeiro", e a barra oferecia "Cancelar envio à abertura".
Agora o banner e a barra dizem "Job aberto pelo financeiro" (ou encerrado,
ou finalizado) e "Acompanhe pelo módulo de Jobs", e o "Cancelar envio" só
aparece antes da abertura (`fluxo-abertura.tsx`).

## Conferido no navegador (13/10/2026)

No projeto de teste, com o job **TES-1028/26** criado para isso pelo fluxo
real (orçamento TES-P001/26-08, enviado e aberto no financeiro, projeto
financeiro TES-F004/26):

- pedido 1 enviado e **retirado**; pedido 2 **recusado** com justificativa
  (faixa vermelha e "Dispensar aviso"); pedido 3 **aprovado** com
  observação;
- com o pedido pendente, um `UPDATE` direto para `encerrado` foi barrado
  pela trigger (teste num bloco desfeito no fim);
- "Visualizar job" abriu a Planilha Interna com a faixa do pedido, e o
  Voltar reabriu o mesmo pop-up;
- depois da aprovação: TES-1028/26 fora de Jobs e de Visualizar Jobs
  (62 → 61), TES-F004/26 inativo, orçamento como "Job cancelado" com o
  histórico dos três pedidos, lista do projeto com "Job Cancelado";
- TES-1023/26 (consome save do TES-1007/26) travado por save, e
  TES-1014/26 com a PP-00129 aprovada e 5 PPs em avaliação no pop-up, sem
  enviar nada;
- o banner do orçamento TES-P001/26-26 (TES-1023/26 aberto) já diz "Job
  aberto pelo financeiro".
