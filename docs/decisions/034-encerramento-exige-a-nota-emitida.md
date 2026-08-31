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

---

## ⚠️ O que ficou em aberto

**1. Job que legitimamente não será faturado por inteiro.** Cliente que
cancela parte do escopo, valor renegociado para menos depois do envio. Com
esta trava, esse job fica aberto para sempre: não há como cancelar o
envio, corrigir as parcelas nem fazer errata depois do envio. A saída
provável é permitir ao financeiro **cancelar ou reduzir o envio**, mas isso
é decisão de outra sessão — a trava foi escrita como bloqueio simples de
propósito, para não inventar um caminho de escape que ninguém combinou.

**2. Os dois jobs que já encerraram com saldo.** `JOB-0027` e `JOB-0009`
estão fora da fila hoje. A trava impede novos casos; não conserta os
antigos. Trazê-los de volta é reabrir o job — o que a decisão 008 não
prevê — ou faturar por fora. Precisa de decisão.

## Onde está escrito

`docs/handoffs/2026-08-31-teste-ponta-a-ponta-save-errata-cartao.md`.
