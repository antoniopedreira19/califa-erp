# 093 — O item entra na fatura na confirmação do pagamento, não na aprovação

**Data:** 2026-09-18
**Decidido por:** Tiago
**Status:** decidida e **fechada no desenho** (canvas "Cartões — estado
atual e proposta") — **ainda não implementada**.
**Migrations:** nenhuma ainda.

---

## 1. Como é hoje

O cartão é escolhido **antes** de qualquer pagamento, e a escolha já
amarra o item a uma fatura:

- **PP:** no diálogo de aprovar, em "Como vai ser pago". Escolhendo Cartão
  de Crédito, a aprovação chama `rotear_pp_para_cartao`, que grava
  `forma_pagamento`, `cartao_credito_id` e o plano de contas na PP e
  carimba **cada parcela ainda não paga** com `fatura_cartao_id` — a fatura
  aberta correspondente à data daquela parcela. Uma PP 30/60/90 vira três
  itens em três faturas.
- **Conta avulsa e recorrência:** na criação ou edição. O gatilho
  `avulsa_entra_na_fatura` põe a avulsa na fatura aberta do cartão e troca
  a data de pagamento dela pelo **vencimento da fatura**.

A partir daí a decisão é difícil de desfazer: `dar_baixa_pp_parcela`
recusa a parcela já roteada ("Parcela paga no cartão não se baixa sozinha:
ela espera na aba Cartão e sai na baixa da fatura inteira"), e voltar atrás
passa por reabrir fatura ou reprovar a PP.

Depois, quem marca os itens como pagos é o **fechamento** da fatura, não a
baixa: `fechar_fatura_cartao` preenche o `pago_em` das parcelas, muda o
status das avulsas, vira cada item num lançamento na conta-espelho do
cartão e faz a fatura descer como **um título único** para Títulos a Pagar,
onde a baixa tira o dinheiro do banco.

## 2. A regra nova

> **O cartão escolhido na aprovação (ou no cadastro da avulsa) é INTENÇÃO,
> não vínculo.** Ele alimenta a previsão de fluxo de caixa. O item só entra
> na fatura quando o pagamento é CONFIRMADO — e nesse momento ainda é
> possível trocar a forma de pagamento.

O porquê: em todo o resto do sistema a forma de pagamento se confirma na
hora de pagar; o cartão era a exceção. A produção diz "vai no cartão" na
aprovação, mas quem paga é o financeiro, e ele pode acabar pagando por PIX.
Hoje essa troca custa desfazer roteamento; com a regra nova, custa um
clique.

## 3. O modelo completo (fechado em 18/09/2026)

**Não há "Previsão Cartão".** Entre a aprovação e a confirmação, o item
com intenção de cartão é um título a pagar como qualquer outro, e mora em
Títulos a Pagar — que é onde a baixa acontece. Chegou-se a desenhar uma
seção "Previsão Cartão" na aba Cartão e ela foi **descartada em
19/09/2026**: seria um recorte de Títulos a Pagar por um campo que é
intenção (mudável na baixa), criando uma segunda lista para a mesma fila;
o argumento forte para prever por cartão seria limite comprometido, e
`cartoes_credito` não guarda limite; e a pergunta "quanto sai e quando" já
é do Fluxo de caixa. **A aba Cartão mostra só o que já teve baixa.**

**A aba Cartão é o extrato do cartão.** Sem cartão escolhido, uma capa —
grade de cards até cinco cartões, lista com busca de seis em diante, a
tela decide sozinha. Escolhido o cartão, a fatura **atual** por padrão,
com um cabeçalho de uma linha: seletor de cartão (com o valor da fatura em
curso de cada um), setas de competência e um calendário de faturas com o
ano dentro, para saltar direto. As anteriores — inclusive as pagas, que
hoje somem da aba — ficam acessíveis por ali. A tabela tem **as mesmas
colunas da conciliação** (Data · Crédito · Débito · Acumulado · Descrição
· Fornecedor · Job · Centro de Custo · Trimestre · Empresa), porque a
fatura É o extrato da conta-espelho: cada item é um lançamento com todos
esses campos. Botões Exportar e Fechar fatura; o fechamento segue como é
hoje, com os ajustes de IOF, anuidade e juros.

**A baixa escolhe o cartão.** No diálogo de baixa, a forma de pagamento é
confirmada; sendo cartão, escolhe-se qual. O item entra na fatura daquele
cartão pela **data do pagamento informada**: antes do dia de fechamento,
entra na fatura em curso; depois, na seguinte; se a competência daquela
data já fechou, rola para a próxima aberta (é o que
`fatura_aberta_do_cartao(cartao, data)` já faz). O botão continua se
chamando **"Dar baixa"** — a baixa é do pagamento, que de fato aconteceu —
mas nessa forma **nada sai da conta bancária**: o item vira lançamento na
conta-espelho do cartão, e o dinheiro sai depois, na baixa da fatura.

**O item fica pago na confirmação.** Quem marca o item como pago passa a
ser a baixa, não mais o fechamento da fatura (`fechar_fatura_cartao` deixa
de preencher `pago_em` das parcelas e de mexer no status das avulsas). É
mais fiel: quem recebeu foi o fornecedor, no dia em que o cartão passou.

**A conciliação abre em dois níveis.** No extrato da conta que pagou a
fatura, a linha do pagamento expande primeiro por **centro de custo** e,
dentro de cada um, nos **itens**. O total fecha com o débito da linha.

**A previsão de caixa projeta pela fatura, não pela data do título.** A
aprovação continua registrando qual cartão — é por ele que a projeção sabe
o dia de fechamento e, daí, a data em que o dinheiro sai. Uma compra de
09/11 num cartão que fecha dia 25 não sai do caixa em novembro, sai em
05/12; prever pela data do título antecipa a saída em quase um mês e
esconde justamente o efeito do cartão (empurrar e concentrar). A
`vw_fluxo_caixa` já faz isso para recorrências
(`proxima_fatura_cartao(cartao, data)`); passa a fazer para PP e avulsa.
Sem cartão marcado, o item cai na data dele — o comportamento conservador.
Nada é gravado: a data do título continua sendo a dele, e a projeção é
feita na leitura; se o financeiro trocar o cartão na baixa, a previsão
muda junto.

Cada real aparece em **um estado só** da previsão:

| estado do item | onde aparece | em que data |
|---|---|---|
| aprovado, intenção de cartão, não confirmado | título a pagar | vencimento da fatura projetada pelo cartão da intenção |
| confirmado na baixa, fatura ainda aberta | **uma linha por fatura** | vencimento daquela fatura |
| fatura fechada | título da fatura (já é assim) | vencimento |
| fatura paga | realizado | data da baixa |

O segundo estado **não existe hoje** e precisa nascer: entre a confirmação
e o fechamento o item já saiu de "a pagar" e a fatura ainda não virou
título — o valor sumiria. Um branch novo na `vw_fluxo_caixa`, "fatura de
cartão não paga", resolve, e aparece como o caixa sente: um débito só,
"Fatura Nubank · dez/26".

**Migração:** o que já está roteado fica como está (hoje, a parcela 3 da
PP-00011, na FC-00002). A regra nova vale dali para frente.

## 4. O que a implementação precisa resolver

Duas coisas que o roteamento na aprovação resolvia de graça:

**a) A data da previsão.** Hoje é o roteamento que faz a previsão cair no
vencimento da fatura (a avulsa tem a data trocada pelo gatilho; a parcela
entra na competência certa). Sem vínculo, a previsão passaria a mostrar a
data original da parcela — 09/11 em vez de 05/12, por exemplo — e ficaria
errada justamente onde o Tiago quer usá-la. A projeção tem de continuar
sendo a da fatura, calculada pelo cartão escolhido
(`proxima_fatura_cartao`, `lib/cartoes/proxima-fatura`) **sem gravar**
`fatura_cartao_id`.

**b) O gesto não se chama "baixa".** Confirmar que o item foi no cartão não
tira dinheiro do banco: ele apenas entra na fatura, e o dinheiro sai depois,
na baixa da fatura inteira. Se o mesmo botão "Dar baixa" fizer as duas
coisas, a palavra passa a significar duas coisas diferentes. A confirmação
no cartão precisa de nome próprio ("Confirmar no cartão", "Enviar para a
fatura") e **não pode** gerar lançamento na conta bancária.

O terceiro problema que eu havia levantado — o fechamento acusar diferença
enorme por causa de item não confirmado — **deixa de existir** com a
Previsão Cartão: a fatura no sistema passa a conter só o que foi
confirmado, e o fechamento é justamente onde ela é acertada contra o
extrato do banco, com os ajustes que já existem.

## 5. O que não muda

Fechamento da fatura, o título único em Títulos a Pagar, a baixa da fatura,
o estorno de compra e a conciliação seguem como estão. A mudança é só
**quando** o item passa a pertencer a uma fatura.

## 6. Fica para depois

- Um filtro por **forma prevista** ("cartão") em Títulos a Pagar, ao lado
  dos filtros de origem — o fio que resta da Previsão Cartão, sem tela
  nova. Não entra na primeira entrega.

## 7. Ponto solto encontrado no levantamento

A parcela que ficou como "decidir na baixa" **aceita hoje** cartão como
forma no diálogo de baixa, e nesse caminho gera saída direta na conta
bancária, sem passar por fatura nenhuma — o oposto do que a regra do cartão
manda. Com a decisão 093 os dois caminhos passam pelo mesmo lugar; até lá,
fica registrado que ele existe.
