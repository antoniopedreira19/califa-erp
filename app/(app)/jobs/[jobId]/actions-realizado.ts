"use server";

/**
 * ⚠️ O realizado deixou de ser digitado em 21/08/2026.
 *
 * Este arquivo tinha `upsertItemRealizado`, a action que gravava
 * `valor_unitario_realizado`, `quantidade_realizada` e
 * `dias_meses_realizado` a partir das células da Planilha Interna.
 *
 * Hoje o realizado é DERIVADO: ele é a soma das PPs não canceladas do
 * item, mantida pelo trigger `trg_pp_recalcula_realizado` no Postgres. Em
 * custo `A` e `D`, que nunca geram PP, ele é o próprio orçado — e isso é
 * substituição de leitura, feita em `realizadoBrutoDoItem`.
 *
 * A action foi REMOVIDA, e não apenas desligada na interface, porque
 * Server Action é endpoint: esconder o botão deixaria a escrita
 * alcançável pelo console do navegador, e um realizado digitado por fora
 * romperia a igualdade com as PPs sem nada avisar.
 *
 * Mexer no realizado agora é emitir, corrigir ou cancelar uma PP —
 * `app/(app)/jobs/[jobId]/realizado/actions-pp.ts`.
 *
 * O arquivo permanece como este aviso: alguém vai procurar a action aqui.
 */

export {};
