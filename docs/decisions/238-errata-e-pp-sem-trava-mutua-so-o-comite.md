# 238 — A errata não trava mais a PP, e a PP não trava mais a errata: só o Comitê

**Data:** 2026-11-05
**Status:** aceita e implementada em 05/11/2026.
**Quem decidiu:** Tiago, em 05/11/2026: "Quero retirar a trava que envolve
criar uma PP em uma linha em que uma errata foi criada e aguarda aprovação.
[...] Agora que temos o comitê de aprovação, não precisamos de mais alguma
trava adicional, bastam as travas do comitê."
**Revê:** [040](040-errata-nao-toca-linha-com-pp-e-trava-o-envio-de-pp.md)
§1 e §4, [185](185-errata-trava-o-envio-de-pp-so-na-linha-alterada.md) e
[237](237-errata-pronta-trava-o-envio-de-pp-da-linha.md).
**Migration:** `20261105700001_realizado_em_pps_das_linhas_do_job.sql`
(aditiva: uma função de leitura).

## O que saiu

1. **Envio de PP em linha alterada por errata em revisão** (040 §4, 185):
   a PP da linha que a errata mudou esperava a revisão da abertura ser
   salva. Agora vai ao financeiro normalmente.
2. **Envio de PP em linha da errata pronta** (237): a PP da linha que a
   errata pronta altera esperava a errata ser enviada ou descartada. Agora
   vai normalmente.
3. **Errata em linha com PP no financeiro** (040 §1): a errata recusava
   qualquer correção — valor, QT, D/M ou tipo — na linha com PP em
   avaliação, aprovada, rejeitada ou paga. Agora a errata corrige a linha,
   com a regra do Comitê abaixo.

Fica a trava do job ainda não aberto (decisão 056): o envio de PP espera a
abertura.

## A regra que ficou: o Comitê

Respostas do Tiago em 05/11/2026, nas perguntas do levantamento:

- Tirar as duas travas do envio (185 e 237) — opção recomendada.
- Tirar também a 040 §1, "mas devem respeitar as travas do comitê. Se uma
  errata for feita em uma linha com PP [...] e transforme o orçado desse
  item a um valor menor do que o da PP (trava ativa no comite), não deverá
  ser possível fazer a errata. E o financeiro será o único capaz de editar
  o valor (pela tela do job no financeiro, o que já é possível, correto?)".
  Sim: o "Editar planilha" do financeiro já edita linha com PP desde a
  decisão 115 (P2), sem essa trava.

Então, na errata (registrar e salvar pronta, que passam pela mesma
`montarErrata`):

- **Orçado:** com a regra **"Realizado acima do orçado"** do Comitê ligada,
  a errata não baixa o orçado da linha para menos do que ela já tem em PPs.
  "Em PPs" é a conta do gatilho `pp_confere_orcado_na_geracao`: PPs fora de
  cancelada (a gerada conta), menos a devolução aprovada da prestação de
  contas da verba. Vale a mesma tolerância e a mesma exceção da linha
  vermelha da regra da PP.
- **Só pega a errata que baixa o orçado.** A linha que já está acima do
  orçado (PP aprovada pelo Comitê) pode subir o orçado; não pode descer
  mais. Escolha da implementação, no espírito do "volta só se piorar" da
  223 — a errata que sobe o orçado não piora nada.
- **Regra desligada nas Configurações do Comitê:** a errata é livre.
- **Sem exceção para o administrador.** O "aprova direto" da 223 vale para
  a PP; na errata, quem baixa o orçado abaixo das PPs é o financeiro, pela
  tela dele, como o Tiago pediu.
- **Tipo de custo:** a linha com PP ou PP a emitir só troca entre os tipos
  que geram PP (AR, B, C, F, FI) — a régua do "Editar planilha" do
  financeiro (revisão da 115, 28/10/2026). Antes a 040 §1 fechava o tipo
  junto com a linha inteira; sem ela, a régua do financeiro é a que faz
  sentido (a PP não existe em A nem em D). O BV segue com a trava própria.
- **Cancelar a linha** com PP de qualquer situação fora de cancelada segue
  recusado (`barrarCancelamento`, 28/10/2026) — não foi pedido mudar.

A mensagem da recusa, por item:
"*"Transporte" já tem R$ 100,00 em Pedidos de Produção, e a errata deixaria
o orçado em R$ 50,00. Pela regra do Comitê de Aprovações, o orçado não fica
abaixo das PPs: só o financeiro altera esse valor, na tela do job no
Financeiro.*"

## Fora

O "Aprovar versão" e a regra do Comitê da versão ficam como estão: o Tiago
pediu, no mesmo dia, para levar a trava da versão ao envio do job ao
financeiro e desistiu antes de começar ("faça apenas a modificação que
envolve as PPs e erratas").

## Onde mora

- Servidor do envio: `barrarEnvioDePP` (`realizado/actions-pp.ts`), só com
  a trava do job não aberto.
- Servidor da errata: `barrarErrataEmLinhaComPP`
  (`realizado/actions-errata.ts`), no lugar de
  `barrarLinhaComPPNoFinanceiro`. Lê `realizado_em_pps_das_linhas_do_job` e
  `travas_do_tipo_nas_linhas_do_job` (definer: a RLS de `pedidos_compra`
  filtra por empresa).
- Regra pura e testes: `orcadoDaErrataAbaixoDasPPs`
  (`lib/calculos/limites-orcamento.ts`).
- Tela: saíram `linhasComEnvioTravado` e `linhasNaErrataPronta` (página do
  job, painel do item, aba de PPs) e o `travadasPorPP` da planilha; o tipo
  na errata usa `travaDoTipoPorLinha`, como o financeiro.
- `linhasAlteradasNaRevisao` fica: é o destaque da revisão na tela do job
  no financeiro.

## Testado (05/11/2026, como GP Teste, no TES-1003/26 do P-0006/26)

- Errata na linha Transporte (PP-00245 de R$ 100, paga) baixando o orçado
  de R$ 5.000 para R$ 50: recusada com a mensagem acima, nada gravado.
- A mesma errata para R$ 4.500: registrada; o job voltou à revisão.
- Com a revisão aberta e a linha alterada, a PP-00830 (verba de R$ 50)
  foi gerada e **enviada** ao financeiro (em avaliação) — antes, recusada.
  Cancelada em seguida.
- Na errata, o tipo da linha com PP abre só AR, B, C, F e FI; o "Cancelar"
  da linha segue desligado.
- A errata pronta (237) não foi testada na tela: o código que a lia saiu
  inteiro, e não havia pronta parada no projeto de teste.
