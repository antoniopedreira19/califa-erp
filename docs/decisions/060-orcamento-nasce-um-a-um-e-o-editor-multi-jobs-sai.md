# 060 — O orçamento nasce um a um, e o editor multi-jobs sai

**Data:** 2026-09-08
**Status:** aceita
**Migration:** nenhuma.
**Contexto:** a lista de orçamentos do projeto (`/orcamentos/[projetoId]`)
e o editor do orçamento do projeto (`/orcamentos/[projetoId]/multi`).
Pedido do Tiago em 08/09/2026. Revê a Entrega 14 do
`HANDOFF_ORCAMENTO.md` (§15.1) e apoia-se na
[041](041-planilha-unica-do-projeto-exportar-e-importar.md).

## O que estava assim

O "+ Novo orçamento" da lista do projeto era um menu com duas portas:

- **Criar orçamento de um job** — o formulário de sempre, um orçamento
  por vez.
- **Criar orçamento do projeto** — o editor multi-jobs, onde vários
  orçamentos eram montados em rascunho e gravados de uma vez.

Duas portas de entrada para o mesmo destino, e um editor inteiro só para
a segunda.

## A decisão

**O orçamento do projeto não é mais uma forma de criar orçamentos. É o
conjunto dos orçamentos que já existem.**

1. Orçamento nasce **um a um**, pelo formulário de novo orçamento
   (`/orcamentos/[projetoId]/novo`). O "+ Novo orçamento" leva direto
   para lá — sem menu.
2. O orçamento do projeto é o que a **visão agregada** mostra, o que
   **Exportar** leva numa planilha só (com as planilhas escolhidas) e o
   que **Importar** traz de volta — tudo já entregue na 041.
3. A porta "Criar orçamento do projeto" e o editor multi-jobs
   (`/multi`) **saem**. A tela sem link seria código morto.

## O que fica

- **A visão agregada continua criando orçamentos.** O botão "Novo
  orçamento de job" dentro de `/agregado` fica como está — o Tiago
  decidiu manter. A regra "um a um" vale para a porta de entrada da
  lista; dentro da agregada o orçamento novo entra junto com as
  alterações, no mesmo "Salvar alterações".
- **A action de gravação em lote fica**, porque é ela que a agregada
  usa para gravar esses orçamentos novos. Só mudou de lugar: de
  `[projetoId]/multi/actions.ts` para `_rascunho/salvar-em-lote.ts`,
  ao lado dos tipos e helpers que ela já usava. Nada dela mudou.
- O `_rascunho/` inteiro (card, linha de grupo, modais de importação e
  parâmetros, action de parse) segue vivo: era compartilhado pelos dois
  editores e agora serve só à agregada.

## O que saiu

| Arquivo | Destino |
|---|---|
| `[projetoId]/novo-orcamento-menu.tsx` | apagado — o botão virou `<Link>` em `page.tsx` |
| `[projetoId]/multi/page.tsx` | apagado |
| `[projetoId]/multi/editor-multi-jobs.tsx` | apagado |
| `[projetoId]/multi/actions.ts` | movido para `_rascunho/salvar-em-lote.ts` |

Sem migration: o banco nunca soube que existiam duas portas.

## Consequências

- Quem tinha a URL `/orcamentos/[projetoId]/multi` guardada cai em 404.
- As decisões [011](011-orcado-obrigatorio-para-salvar-e-aprovar.md) e
  [047](047-resumo-do-cabecalho-mostra-resultado-operacional.md) citam o
  editor multi-jobs. A regra delas continua valendo onde ainda há tela:
  a 011 na agregada (mesmo `salvarOrcamentosDoProjeto`), a 047 no
  cabeçalho da agregada.
