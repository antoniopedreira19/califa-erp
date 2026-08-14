# 008 — Encerramento do job

**Data:** 2026-08-13
**Status:** aceita
**Contexto:** Parte IV da frente de faturamento (ver `HANDOFF_FINANCEIRO.md`).

## Decisão

Encerrar o job é o fim da linha: depois disso ele é histórico, e nada mais
nele muda.

### 1. Só encerra o que já foi faturado

O botão "Enviar job para encerramento" só existe depois que a produção
enviou o job para faturamento (`jobs_envio_faturamento`). Antes disso não
há o que encerrar — o número final ainda não saiu da agência.

### 2. Trava por documento em aberto

O job **não encerra** enquanto existir:

- **PP em `em_avaliacao` ou `aprovada`** — dinheiro comprometido que ainda
  não saiu do caixa;
- **BV em `a_negociar` ou `confirmado`** — comissão que ainda não foi
  recebida.

`rejeitada`, `cancelada` e `cancelado` não contam: não são compromisso.
`pago` e `recebido` não contam: já tiveram baixa.

O motivo é a margem. O custo realizado ainda pode mudar enquanto houver
documento em aberto, e a margem gravada no fechamento seria mentira.

Quando a trava pega, a tela **explica quais documentos** faltam — pelo
código da PP e pelo item do BV — em vez de só desabilitar o botão.

### 3. O resumo de fechamento

O encerramento passa por um resumo, no mesmo espírito da conferência da
abertura:

| Linha | De onde vem |
|---|---|
| Faturamento previsto na abertura | `jobs.faturamento_previsto_abertura` |
| Faturamento | faturamento previsto **de agora**, recalculado dos itens |
| Total dos custos orçados · Honorários · Encargos e impostos | `calcularTotaisVersao` |
| Valor do Job | `calcularTotaisVersao` |
| Custo realizado | soma dos realizados dos itens |
| Margem | `calcularResultadoOperacional` — em **valor e percentual** |

"Faturamento realizado" chama-se só **Faturamento** no fechamento, por
decisão do time: no encerramento não existe mais previsão.

Quando o envio para faturamento congelou um valor **diferente** do
faturamento de agora — uma errata entre o envio e o encerramento — o
resumo mostra os dois e pede confirmação com o financeiro. Não escolhe
sozinho qual foi para a nota.

### 4. Job encerrado é congelado

`jobEstaCongelado(status)` (`encerrado` ou `cancelado`) bloqueia, no
servidor e na interface:

| O quê | Onde |
|---|---|
| Editar campos do job | `atualizarJob` |
| Gerar, aprovar, pagar PP | `checarGatesRealizado` |
| Lançar, confirmar, cancelar BV | `carregarContexto` em `_bv/actions.ts` |
| Lançar realizado | `podeEditarRealizado` |
| Registrar errata | gate de status em `actions-errata.ts` |

`encerrado` continua **fora** de `JOB_STATUS_TRANSICOES`: encerrar não é
troca de status solta, é a action `encerrarJob`, que refaz a trava antes
de gravar. Não existe caminho de volta pela interface — reabrir um job
encerrado é operação de banco, deliberadamente.

As três travas foram exercitadas contra um job já encerrado, chamando as
actions direto — não só conferindo que a interface esconde o botão. Ver
`HANDOFF_FINANCEIRO.md`, seção 31.

## Consequências

- A ordem do fluxo passa a ser rígida: abrir → produzir → enviar para
  faturamento → dar baixa em tudo → encerrar.
- Um job com PP esquecida em `em_avaliacao` fica visível como pendência,
  em vez de ser encerrado com margem errada.
- `atualizarJob` ganhou gate de status, que **não tinha nenhum** — job
  cancelado também era editável até aqui.

## Alternativas descartadas

- **Encerrar e deixar a margem se ajustando depois.** O fechamento
  perderia o sentido: o número que a diretoria lê mudaria sozinho.
- **Cancelar as PPs em aberto automaticamente no encerramento.** Apagaria
  compromisso real com fornecedor por conveniência de tela.
