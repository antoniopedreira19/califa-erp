# 040 — A errata não toca linha com PP no financeiro, e trava o envio de PP até a revisão da abertura

**Data:** 2026-09-02
**Status:** aceita
**Contexto:** modo errata da Planilha Interna do job (`/jobs/[jobId]`) e
o mural de abertura do financeiro. Decisões do Tiago em 02/09/2026.
Completa a 030 e depende da 039 (PP gerada).

## A mudança em duas frases

1. **Linha que já tem PP no financeiro não entra em errata** — nem valor,
   nem QT, nem D/M, nem tipo, nem remover. O que já pesa no realizado não
   se reescreve por cima.
2. **Enquanto a errata aguarda a revisão da abertura, nenhuma PP sai para
   o financeiro.** Gerar, editar e cancelar continuam; o envio (e o
   reenvio de rejeitada) fecha, junto com o faturamento, que já fechava.

## 1. Qual PP trava a linha

Decisão do Tiago, entre três opções: **a PP que chegou ao financeiro** —
em avaliação, rejeitada, aprovada ou paga. É exatamente o recorte que
pesa no realizado do item (decisão 039 §2). A gerada, que ainda é
rascunho do job, não trava; a cancelada tampouco.

A regra substitui a de 07/08/2026 (handoff de Jobs, §20), que travava só
a troca de TIPO em linha com PP ativa e deixava valor, QT e D/M livres.

**Dos dois lados.** A tela nasce travada: no modo errata a linha aparece
com cadeado ao lado do nome, as células do orçado ficam de leitura, o
tipo não abre e o Remover vem desabilitado com o motivo — o usuário não
monta a errata inteira para só então tomar o erro (a lição do save, em
31/08/2026). O servidor recusa do mesmo jeito
(`barrarLinhaComPPNoFinanceiro`, em `actions-errata.ts`), por item, com o
código da PP na mensagem.

`barrarRemocao` continua barrando remoção por **qualquer** PP no
histórico, cancelada inclusive: a FK é `on delete restrict`, e o
documento continua existindo no financeiro.

## 2. O job não muda de status

Decisão do Tiago, entre duas opções. A sugestão era o status voltar a
`aguardando_abertura`; ficou **`aberto` com a marca
`abertura_em_revisao`**, que já existe desde a 030 e já leva o job ao
mural.

O que a troca de status custaria, e por que não valeu:

- o job sumiria de "Visualizar Jobs" e das views de fluxo de caixa do
  financeiro;
- `jobAceitaAcoesPlanilha` fecharia gerar PP, BV e nova errata (decisão
  013) — e o pedido era fechar só o ENVIO de PP;
- voltar a `aberto` passaria por `abrirJobNoFinanceiro`, que sobrescreve
  data e usuário da abertura, contrariando "a data e o usuário da
  abertura não mudam" (decisão 021).

Na barra do job, o selo diz **"Aguardando revisão da abertura desde a
última errata"** e explica que o envio de PPs e o faturamento voltam
quando a revisão for salva. No painel do item, o botão "Enviar ao
financeiro" fica desabilitado com uma faixa âmbar dizendo o mesmo.

## 3. O que a 030 dizia e deixou de valer

> O status do job não muda: ele segue aberto, e a produção segue
> emitindo PP e BV.

A produção segue **gerando** PP. **Emitir** — no sentido de enviar ao
financeiro — não. BV não mudou.

## 4. Onde a regra mora

| Regra | Servidor | Tela |
|---|---|---|
| Linha com PP no financeiro | `barrarLinhaComPPNoFinanceiro` (`actions-errata.ts`) | `travadasPorPP` em `job-item-realizado-table.tsx` |
| Envio de PP em revisão | `barrarEnvioEmRevisao` (`actions-pp.ts`), em `enviarPedidoCompraAoFinanceiro` e `reenviarPedidoCompra` | `aberturaEmRevisao` no `PainelPPsItem`; texto da `BarraAcoesJob` |
| Quem encerra a revisão | `editarRegistroDaAbertura` (`financeiro/abertura-de-job/actions.ts`), como na 030 | — |
