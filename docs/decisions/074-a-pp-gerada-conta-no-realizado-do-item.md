# 074 — A PP gerada conta no realizado do item; o financeiro continua vendo só o que foi enviado

**Data:** 2026-09-11
**Status:** aceita
**Contexto:** Planilha Interna do job (`/jobs/[jobId]`), painel
"Destrinchar realizado", formulário de PP e a função
`recalcular_realizado_do_item` no banco. **Revê o §4 da
[039](039-pp-nasce-gerada-e-o-envio-ao-financeiro-e-uma-acao.md)**, de
02/09/2026, e mantém o resto dela de pé.

## A regra

> **Realizado do item = soma das PPs do item menos as canceladas.** A PP
> `gerada` — a que ainda não foi enviada ao financeiro — **conta**. Só o
> cancelamento tira dinheiro de um item.
>
> **Isso vale para dentro do job, não para o financeiro.** O consumo que
> congela a previsão de custo da abertura e a trava da errata seguem
> olhando só a PP que CHEGOU ao financeiro.

## O que estava acontecendo

O JOB-0025 tinha 7 PPs somando R$ 15.230,94, todas geradas e nenhuma
enviada. A planilha mostrava **realizado zerado em toda linha**, o painel
do item dizia "Em PPs emitidas: R$ 0,00" com duas PPs de R$ 3.500
listadas logo abaixo, e o cabeçalho do job dizia "sem realizado".

A leitura da 039 era defensável: a PP gerada ainda pode ser editada ou
cancelada dentro do job, sem passar por ninguém, e somá-la faria o item
parecer mais gasto do que está. O que a prática mostrou é o outro lado:
**o GP que acabou de comprometer R$ 15 mil com fornecedores lia a própria
planilha como se nada tivesse sido feito** — e o painel que lista as PPs
exibia, no mesmo cartão, a lista das PPs e um total que as ignorava.

Entre "o número pode mudar" e "o número mente", o Tiago escolheu o
primeiro em 11/09/2026: gerar PP **é** comprometer o item.

## O que muda

| | 039 (02/09) | 074 (11/09) |
|---|---|---|
| Realizado do item | PP enviada ao financeiro | **toda PP não cancelada** |
| "Em PPs emitidas" (painel e formulário) | PP enviada | **toda PP não cancelada** |
| Base do "Enviar PP acima do planejado?" | enviadas + esta | **toda PP não cancelada do item** |
| Consumo da previsão da abertura | PP enviada | PP enviada (**não muda**) |
| Trava da errata (040) | PP no financeiro | PP no financeiro (**não muda**) |
| O que o financeiro lista | PP enviada | PP enviada (**não muda**) |

Consequências diretas, todas queridas: o cabeçalho do job passa a mostrar
Resultado Op. (Realizado), a rentabilidade realizada passa a contar o
item que só tem PP gerada, e a visão agregada do projeto acompanha.

**O envio deixou de mexer no número.** Como a PP já entrou na conta ao ser
gerada, enviá-la ao financeiro não muda o realizado nem o "Em PPs
emitidas" — muda quem responde por ele. Por isso o pop-up diz "Este item
está com X em PPs", e não mais "com esta PP o item passa a ter X".

## Duas contas viraram uma

`somaDasPPsEmitidas` e `somaDasPPsNaoCanceladas` conviviam em
`lib/calculos/pps-item.ts` com a mesma forma e recortes diferentes. A
primeira saiu: ficou **`somaDasPPsNaoCanceladas`**, e é ela que a tela
mostra, que o banco replica em `recalcular_realizado_do_item` e que a
server action usa para decidir o envio. Tela e servidor discordarem sobre
o mesmo número é o defeito que este arquivo existe para não repetir.

`ppChegouAoFinanceiro`, em `lib/types.ts`, **continua existindo** — agora
como recorte exclusivo do financeiro (errata e previsão da abertura).
Antes de reaproveitá-la, confira de qual dos dois lados sua pergunta está.

## A pegadinha: a PP que conta duas vezes

Com a `gerada` dentro da soma, todo lugar que fazia `total + valorDestaPP`
passou a somá-la duas vezes — ela já está no total. Os quatro pontos:

| Onde | Correção |
|---|---|
| `enviarPedidoCompraAoFinanceiro` | `somaDasPPsDoItem(..., excetoPPId: pp_id)` |
| auditoria de `editarPedidoCompraGerada` | idem |
| prévia do formulário em modo edição | desconta `ppEditando.valor` antes de somar o novo |
| `pedirEnvio` no painel | não soma mais: `emPPsDepois = emPPs` |

`reenviarPedidoCompra` já usava `excetoPPId` e ficou como estava. A
geração é o único caso que soma por cima com razão: a PP ainda não foi
gravada.

## Verificado (11/09/2026, logado, projeto 0-0001/26)

| Cenário | Resultado |
|---|---|
| JOB-0029, item com 1 PP gerada de R$ 4.000 | realizado R$ 4.000 na linha; painel "Em PPs emitidas R$ 4.000,00" |
| Editar essa PP sem mexer em nada | prévia R$ 4.000,00 (com o bug: R$ 8.000,00) |
| Editar trocando para R$ 9.000 | prévia R$ 9.000,00, em vermelho (com o bug: R$ 13.000,00) |
| Gerar 2ª PP de R$ 5.000 (planejado R$ 8.000) | painel R$ 9.000,00 em vermelho; aviso âmbar no formulário |
| Enviar essa PP | pop-up "Este item está com R$ 9.000,00 em PPs, R$ 1.000,00 acima do planejado de R$ 8.000,00" — voltou sem enviar |
| JOB-0033, PP de verba R$ 8.000 em item planejado de R$ 15.000 | **enviou sem pedir confirmação** — o servidor não dobrou (com o bug: R$ 16.000 e pop-up indevido) |
| Banco, após o backfill | zero itens com `total_realizado` diferente da soma das PPs não canceladas |

## Migration

`supabase/migrations/20260911210001_pp_gerada_conta_no_realizado.sql` —
reescreve `recalcular_realizado_do_item` e recalcula os itens que têm PP
gerada (2 jobs, 8 PPs, R$ 19.230,94 na data). O trigger
`trg_pp_recalcula_realizado` não muda: ele já disparava em toda troca de
status.
