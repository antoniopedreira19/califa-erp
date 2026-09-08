# 056 — A PP nasce na pré-abertura; o envio ao financeiro é que espera

**Data:** 2026-09-08
**Status:** aceita
**Contexto:** Planilha Interna e aba de Pedidos de Produção do job
(`/jobs/[jobId]`). Pedido do Tiago em 08/09/2026. Continua a 013 (a
planilha na pré-abertura) e a 040 (o envio de PP na revisão da abertura).

## A mudança em duas frases

1. **Gerar PP passou a valer nos dois status de pré-abertura** —
   `aguardando_abertura` e `rejeitado_financeiro`. Editar, cancelar e
   marcar "todas as PPs geradas" vão junto.
2. **Enviar ao financeiro continua esperando a abertura.** A PP fica
   `gerada`, no job, exatamente como já acontecia enquanto a abertura
   está em revisão por errata (decisão 040).

## 1. Por que a linha se moveu

A decisão 013 traçou a linha entre "registrar o que aconteceu" e "gerar
documento", e pôs a PP inteira do lado de lá. Naquele momento isso era
uma frase só, porque a PP também era uma coisa só: emitir era gerar.

A decisão 039 partiu a PP em duas em 02/09/2026 — ela **nasce gerada**, e
enviar ao financeiro virou uma ação separada. Com isso a frase da 013
passou a barrar coisa demais: a PP gerada não sai do job, não vira
título, não conta no realizado e o financeiro não a vê. O que ela é, de
fato, é o registro de uma contratação que a produção já fechou — e é
justamente o que a 013 queria liberar.

A linha nova é a da 039, não a da 013: **gerar** de um lado, **enviar**
do outro.

## 2. Que a PP gerada não vaza, já estava garantido

Nada precisou mudar para o número não escapar. Os quatro lugares que
somam PP já ignoram a `gerada`:

| Onde | Como |
|---|---|
| Realizado do item (banco) | `recalcular_realizado_do_item`: `status not in ('cancelada','gerada')` |
| Contas a Pagar | `.neq("status","gerada")` — nem no chip "Todas" (decisão 039) |
| Consumo das previsões da abertura | filtra `cancelada`, `rejeitada` e `gerada` |
| Home do financeiro | conta só `em_avaliacao` |

E o job de pré-abertura não está nas views de fluxo de caixa do
financeiro — ele ainda não foi aberto.

Consequência visível: na pré-abertura a coluna REALIZADO da planilha
continua em travessão mesmo com PP gerada no item. Está certo, e é a
mesma regra de sempre — o realizado conta PP enviada.

## 3. Os dois gates, e quem lê cada um

`jobAceitaAcoesPlanilha` deixou de falar por PP. Nasceram dois vizinhos
em `lib/types.ts`:

| Função | Status | Quem lê |
|---|---|---|
| `jobAceitaAcoesPlanilha` | `aberto`, `em_producao` | errata (`actions-errata.ts`), BV (`_bv/actions.ts`) |
| `jobAceitaGerarPP` | os dois acima **+** `aguardando_abertura`, `rejeitado_financeiro` | `checarGatesRealizado` (gerar/editar), `cancelarPedidoCompra`, `actions-conclusao.ts` |
| `jobAceitaEnvioDePP` | `aberto`, `em_producao` | `barrarEnvioDePP` |

**`barrarEnvioDePP` é a porta única do envio** (`realizado/actions-pp.ts`).
Era `barrarEnvioEmRevisao`, com uma trava só; agora carrega as duas, na
ordem em que o usuário precisa lê-las:

1. o job ainda não foi aberto (esta decisão);
2. a errata devolveu a abertura à revisão (decisão 040).

Chamam-na `enviarPedidoCompraAoFinanceiro` e `reenviarPedidoCompra` —
reenviar é enviar.

## 4. Cancelar e "todas as PPs geradas" foram junto

**Cancelar**, porque quem pôde gerar precisa poder desfazer: presa até a
abertura, a PP gerada por engano não teria caminho de volta.

**"Todas as PPs deste item já foram geradas"** (decisão 052), porque é
uma afirmação sobre a geração — e porque o formulário de PP faz a mesma
pergunta ("esta é a última PP deste item?") a cada PP gerada. Deixar só a
marcação presa ao job aberto criaria um beco: o item seria marcado na
pré-abertura, sem como desmarcar antes da abertura.

**BV e errata não se mexeram.** BV é comissão a negociar e errata mexe no
orçado que o financeiro vai conferir; os dois continuam esperando a
abertura, como na 013.

## 5. `rejeitado_financeiro` entra junto

Os dois status de pré-abertura andam juntos desde a 013 — "o job voltou
para a produção corrigir, e é justamente aí que ela precisa da planilha".
O mesmo argumento vale aqui, e com mais força: o job devolvido é o que
mais tem contratação em curso. A mensagem do servidor distingue os dois
("O financeiro devolveu este job…" × "O financeiro ainda não abriu…").

## O que a tela diz agora

- **Faixa da Planilha Interna:** "erratas e BVs ficam disponíveis após a
  abertura. Pedidos de produção já podem ser **gerados**; o envio ao
  financeiro é que espera a abertura, e o realizado só conta PP enviada."
- **Barra do job:** "Gerar PP já está liberado; o envio de PPs ao
  financeiro é que volta com a abertura."
- **Painel do item:** faixa âmbar com o motivo e "Enviar ao financeiro"
  desabilitado, com o mesmo texto no `title`. O painel deixou de receber
  `aberturaEmRevisao: boolean` e passou a receber
  `envioBloqueadoPor: string | null` — ele não precisa saber qual das
  duas portas fechou, só qual frase mostrar.

Nenhuma migration: a regra é de status, não de estrutura.
