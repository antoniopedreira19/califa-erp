# 020 — Cancelar job só existe antes da abertura

**Data:** 2026-08-19
**Status:** aceita
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

`JOB_STATUS_TRANSICOES` e a server action `atualizarStatusJob` continuam
aceitando o cancelamento em qualquer status vivo. **É de propósito**: a
fronteira aqui é de módulo, não de permissão. Fechar no servidor agora
obrigaria a reabrir a regra quando a tela do financeiro chegar, e o
cancelamento pós-abertura vai precisar dela.

Quem for implementar o cancelamento no financeiro reaproveita a action
como está.
