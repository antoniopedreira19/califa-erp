# 020 — Cancelar job só existe antes da abertura

**Data:** 2026-08-19
**Status:** aceita · **revisada em 2026-09-28** — a action `atualizarStatusJob` saiu; nenhum caminho cancela job aberto (ver "Revisão" no fim)
**Contexto:** aba "Informações do Job" (`/jobs/[jobId]`), handoff
`Job - Informacoes - Cabecalho Opcoes.dc.html` / `Job - Informacoes - Barra
de Acoes.dc.html`.

## O problema

O card "Status" da aba Informações oferecia **Cancelar job** em qualquer
status vivo — `aguardando_abertura`, `rejeitado_financeiro`, `aberto` e
`em_producao`. É o que `JOB_STATUS_TRANSICOES` sempre permitiu.

Só que job **aberto** já entrou no financeiro: tem competência gravada,
previsão de custo copiada, previsão de recebimento lançada e, muitas
vezes, PP emitida. Cancelar dali pelo módulo de Jobs desfaz pela borda
uma coisa que nasceu no meio do fluxo financeiro — e o módulo de Jobs não
tem como saber o que precisa ser desfeito junto.

## A decisão

**O botão "Cancelar job" só aparece enquanto o job ainda não foi aberto
pelo financeiro.** O corte é a abertura: no instante em que o status vai
de `aguardando_abertura` para `aberto`, o botão some da tela do job.

| Status | Botão na barra |
|---|---|
| `aguardando_abertura` | **aparece** |
| `rejeitado_financeiro` | **aparece** — o job foi devolvido, nunca chegou a ser aberto |
| `aberto` · `em_producao` | não aparece |
| `encerrado` · `cancelado` | não aparece (já é histórico) |

Cancelamento depois da abertura, se for necessário, é ação do
**financeiro** — não do módulo de Jobs. Essa tela ainda não existe.

## O que NÃO mudou

~~`JOB_STATUS_TRANSICOES` e a server action `atualizarStatusJob` continuam
aceitando o cancelamento em qualquer status vivo.~~ Valeu até 28/09/2026 —
ver "Revisão" abaixo. O argumento era que a fronteira era de módulo, não de
permissão, e que o cancelamento no financeiro reaproveitaria a action como
está.

## ⚠️ Revisão (2026-09-28) — a action saiu

Na prática a action era uma porta aberta: exportada como Server Action,
qualquer GP ou produtor (`jobs.editar_metadata`) conseguia chamá-la pelo
console e passar um job **aberto** para `cancelado`, sem nenhuma conferência
de PP, previsão de custo, recebimento ou faturamento — exatamente o que o
"O problema" acima diz que o módulo de Jobs não sabe desfazer. E, na
pré-abertura, cancelava o job sem devolver o orçamento a `aprovado` nem o
save à versão, o que `cancelarEnvioParaAbertura` (057) faz.

- `atualizarStatusJob` (`app/(app)/jobs/actions.ts`) e a tabela
  `JOB_STATUS_TRANSICOES` (`lib/types.ts`) **foram removidas**. Nenhuma tela
  as chamava desde 08/09 (057).
- Antes da abertura, o cancelamento continua sendo o "Cancelar envio" do
  orçamento (`cancelarEnvioParaAbertura`).
- Depois da abertura, **hoje ninguém cancela job pelo sistema**. Quando o
  financeiro ganhar essa tela, ela nasce com action própria, que desfaça o
  que a abertura gravou — não reaproveita uma troca de status solta.
- ~~Continua aberta a escrita direta pela API do Supabase (`jobs_modify` é
  ALL para membro do tenant): a guarda de status em `jobs` está preparada
  na branch `feat/travas-escrita-direta`, não aplicada, e ela ainda aceita
  `aberto → cancelado` para GP e produtor — precisa ser ajustada antes de
  aplicar.~~ Fechada no mesmo dia pela decisão 117: a guarda foi ajustada
  (sem `aberto → cancelado`) e aplicada.

## ⚠️ Caso pontual (2026-10-09) — ANI-1004/26 cancelado depois da abertura

A abertura do **ANI-1004/26 "ANI SP | AON Outubro"** (R$ 180.000, aberto
pela Priscila em 07/10) saiu errada: o orçamento cobria só outubro, e o GP
refez o trabalho como **ANI-1012/26 "ANI SP | AON 4T"** (R$ 540.000, outubro
a dezembro, aberto em 09/10). Com os dois abertos, outubro contava duas
vezes no fluxo de caixa e no fiscal (R$ 180 mil de recebimento, R$ 55,6 mil
de custo e R$ 35 mil de imposto).

Como nenhuma tela cancela job aberto, o Tiago pediu a correção **pelo MCP**,
uma vez só:

- Antes de gravar, a transação conferiu: job ainda `aberto`; a única PP
  (PP-00144, verba de R$ 500) já estava `cancelada`; sem envio de
  faturamento, nota, lançamento, recebimento antes da NF ou desembolso.
- `jobs.status` foi de `aberto` para `cancelado`. A guarda
  `jobs_guarda_escrita_direta` só vale para `authenticated` e não barra o
  MCP.
- As previsões da abertura (custo, recebimento, imposto, competência)
  **ficaram gravadas**. Elas saem das contas pelo status: `vw_fluxo_caixa`
  e `vw_job_rentabilidade` deixaram de listar o job, conferido logo depois.
- O projeto financeiro **ANI-F003/26 "Always ON SP"**, que só tinha esse
  job, ficou **inativo** (`ativo = false`). O job novo usa o ANI-F006/26.
- O orçamento **ANI-P005/26-01** continua em `job_criado`, como histórico.
- Auditoria: `job.cancelado_apos_abertura`, em nome do Tiago, com o motivo
  e o job substituto.

Isso **não** é o "Cancelar job" do financeiro: a regra de cima continua
valendo. Se acontecer de novo, a saída é construir a tela com action
própria, não repetir a correção pelo MCP.
