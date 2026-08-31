# 034 — O job não encerra com saldo a faturar

**Data:** 2026-08-31
**Decidido por:** Tiago

Fecha uma ponta da [008](008-encerramento-do-job.md), que travava o
encerramento por PP e BV mas não olhava o faturamento.

---

## 1. O portão parava no envio, não na nota

A [008](008-encerramento-do-job.md) §1 diz que só encerra job que foi
enviado para faturamento. O código cumpria isso à risca: bastava existir
a linha de envio. Quantas notas já tinham saído, ele não perguntava.

Como o envio pode dividir o job em **várias parcelas** — cada uma vira
uma nota, com o seu vencimento —, um job de duas parcelas com uma nota
emitida passava pelo portão com metade do dinheiro ainda por faturar.

## 2. E a fila não guarda quem encerrou

`vw_faturamento_pendente` filtra `j.status = 'aberto'`. O job encerrado
**sai da fila de faturamento**, e não existe tela que o traga de volta:
o envio é único por job (`unique` em `job_id`), não há caminho para
cancelá-lo ou refazê-lo, e a errata fica bloqueada depois do envio.

Somando as duas coisas: encerrar um job parcialmente faturado apagava o
saldo da fila em silêncio, sem aviso e sem volta.

**Medido em 31/08/2026**, antes da trava: `JOB-0027` encerrado com
R$ 30.073,32 em duas parcelas nunca emitidas, e `JOB-0009` com R$ 149,12.

## 3. A regra

> Job não encerra enquanto houver parcela do envio sem nota emitida.

O saldo entra na **mesma lista** de impedimentos da PP sem baixa e do BV
não recebido — quem tenta encerrar vê de uma vez tudo o que falta, em vez
de resolver a PP, tentar de novo e esbarrar na nota.

A conta é a mesma da fila (`valor da parcela − já faturado`, nunca
negativa, com piso de um centavo para o ruído da divisão em partes
iguais) e mora em `lib/data/saldo-a-faturar.ts`, escrita uma vez só: quem
mostra a trava é a tela do job, quem a aplica é o servidor.

Nota **cancelada** devolve a parcela para a fila e volta a travar o
encerramento — é o mesmo critério que a fila já usa.

## 4. O que NÃO mudou

A exceção do save (decisão [028](028-save-entre-jobs.md) §11) continua de
pé. Job com faturamento previsto zero e consumo de save registrado pula o
faturamento e encerra direto: a nota dele saiu no job que gerou o
crédito, e ele não tem parcela nenhuma para conferir.

## 5. Não existe escape, e é assim de propósito

Levantei a hipótese de o job legitimamente não ser faturado por inteiro —
cliente que cancela parte do escopo, valor renegociado para menos depois
do envio — e de a trava deixar esse job preso aberto.

**Não acontece** (Tiago, 31/08/2026):

> "A negociação já terá terminado no momento de envio para faturamento, e
> novas erratas realmente não deverão poder ser feitas."

O envio para faturamento é o ponto em que o valor deixa de ser negociável.
Por isso:

- **Não se cancela nem se reduz o envio.** `jobs_envio_faturamento` é
  única por job e nenhuma tela a apaga.
- **Não há errata nem save depois do envio** — a porta da
  [030](030-errata-na-planilha-e-a-linha-vermelha.md), agora fechada
  também na planilha do job.
- **Não há escape para o encerramento.** O saldo a faturar vira nota, ou o
  job não encerra.

As três travas são a mesma regra vista de três lugares. A trava do
encerramento é bloqueio simples porque não deve mesmo haver saída.

⚠️ A mensagem das portas de errata e save mandava "peça ao financeiro para
desfazer o envio" — atrás de algo que ninguém pode fazer. Corrigida na
mesma data.

---

## ⚠️ O que ficou em aberto

**Os dois jobs que já encerraram com saldo.** `JOB-0027` (R$ 30.073,32) e
`JOB-0009` (R$ 149,12) estão fora da fila hoje. A trava impede novos
casos; não conserta os antigos. Trazê-los de volta é reabrir o job — o que
a decisão 008 não prevê — ou faturar por fora. Precisa de decisão.

## Onde está escrito

`docs/handoffs/2026-08-31-teste-ponta-a-ponta-save-errata-cartao.md`.
