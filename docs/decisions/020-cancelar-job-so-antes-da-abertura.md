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
- Continua aberta a escrita direta pela API do Supabase (`jobs_modify` é
  ALL para membro do tenant): a guarda de status em `jobs` está preparada
  na branch `feat/travas-escrita-direta`, não aplicada, e ela ainda aceita
  `aberto → cancelado` para GP e produtor — precisa ser ajustada antes de
  aplicar.
