# 009 — A esteira do faturamento do job

**Data:** 2026-08-14
**Status:** aceita
**Contexto:** coluna "Faturamento" e chips de Jobs Abertos, na Central
Financeira. Complementa `008-encerramento-do-job.md`.

## Decisão

Um job aberto está em **exatamente um** de cinco estados. A regra mora em
`lib/calculos/esteira-faturamento.ts`, não na tela.

| Estado | Condição | O que significa |
|---|---|---|
| `aguardando_envio` | sem linha em `jobs_envio_faturamento` | a produção ainda não liberou |
| `enviado` | envio registrado, sem nota | esperando o financeiro emitir |
| `faturado` | nota emitida, nada vencido | dinheiro no prazo |
| `inadimplente` | nota emitida e parcela vencida em aberto | atrasado |
| `liquidado` | todas as parcelas recebidas | fim da linha |

"Nota emitida" é linha em `faturamentos` com `origem_tipo = 'job'`,
`origem_id = job.id` e `status = 'emitido'`. Nota cancelada não conta — o
job volta a esperar. Título cancelado também fica de fora: não é dinheiro
a receber nem recebido.

### Três detalhes que a conta define

1. **`inadimplente` é testado ANTES de `liquidado`.** Uma parcela vencida
   em aberto basta para o job inteiro estar em atraso, mesmo que as
   outras já tenham sido recebidas.
2. **Vencer hoje não é inadimplência.** O cliente tem o dia inteiro.
3. **Nota emitida sem parcelas geradas é `faturado`**, não `liquidado`:
   já foi faturada, a cobrança ainda não foi montada. Tratar como
   liquidado diria que o dinheiro entrou.

### "Liquidado", e não "Recebido"

O sistema já usa `recebido` para BV e `pago` para PP. Um terceiro
"recebido" no nível do job criaria ambiguidade justamente na tela onde os
três aparecem. "Liquidado" é o termo de título a receber e não colide com
nada (escolha do Tiago, 14/08/2026).

### Os chips

**Todos · Aguardando faturamento · Faturado · Liquidado · Inadimplente.**

"Aguardando faturamento" cobre os dois estados anteriores à nota
(`aguardando_envio` e `enviado`) — para quem espera a nota sair, a
diferença entre "a produção não mandou" e "mandou e o financeiro não
emitiu" é detalhe da linha, não filtro.

Saiu o chip "Aguardando encerramento" do design: ele se sobrepunha a
"Faturado" e os dois devolviam o mesmo conjunto, já que a lista só tem
job aberto (decisão do Tiago, 14/08/2026).

### O resumo

`N jobs abertos · Faturado R$ X · Aguardando faturamento R$ Y · Valor
total R$ Z` — os dois primeiros particionam o dinheiro visível.
"Liquidado" e "Inadimplente" entram na linha **só quando existem**, como
recortes de dentro do faturado. Enquanto o módulo de recebimento não
roda, a linha fica idêntica à do design.

## Consequências

- A regra é função pura, conferível sem emitir nota de verdade —
  `faturamentos` e `titulos_receber` são da frente de contas a receber, e
  testar pela interface exigiria escrever no módulo do outro.
- `listarJobsAbertos` passou de três para quatro queries rasas em
  `Promise.all`, cruzadas em memória. Embed não existe: a ligação com
  `faturamentos` é polimórfica.
- `hoje` entra por parâmetro, para a inadimplência não depender do
  relógio da máquina.
