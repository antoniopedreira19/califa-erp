# 212 — O tipo da chave PIX e o tipo de conta no cadastro do freela

**Data:** 2026-10-26
**Status:** aceita e implementada em 26/10/2026.
**Quem decidiu:** Tiago, em 26/10/2026 — versão "Com o tipo do PIX e o tipo
de conta" do protótipo de 22/10
(https://claude.ai/artifact/Fc2gkWV3Mt127eDDHiUqGS). O cadastro de freelas é
do módulo do Antonio; o acerto com ele ficou com o Tiago.
**Completa:** a [193](193-conta-ou-pix-do-titular-da-verba.md) — o freela
cuja chave PIX não dizia o tipo.
**Migration:** `20261026500001_tipo_do_pix_e_da_conta_do_freela.sql`.

## O problema

Desde a 193, a PP de verba ou de reembolso de um freela leva o PIX do
cadastro de freelas sozinha, sem campo na tela, quando o tipo da chave se
deduz com segurança: e-mail, chave aleatória, CNPJ, ou o CPF da própria
pessoa. O cadastro não guardava o tipo. Em 26/10, 13 dos 64 freelas ativos
tinham uma chave de 11 números que não era o CPF deles (telefone? CPF de
outra pessoa?), e quem gerava a PP digitava o PIX de novo.

O editar do freela também escondia o PIX: um seletor "Tipo de pagamento"
mostrava a conta OU o PIX, e os 59 freelas ativos com PIX estavam todos
marcados "Conta bancária" (vieram assim da migração). O tipo de conta não
existia.

## A regra

1. **A chave PIX vai com o tipo.** CPF, CNPJ, e-mail, telefone ou chave
   aleatória, como no fornecedor e no colaborador. A chave é conferida e
   gravada no formato do banco pela mesma régua (`lib/pix`): telefone com
   +55, CPF e CNPJ só com os dígitos, e-mail em minúsculas. Chave sem tipo
   ou tipo sem chave não salva.
2. **A conta ganha o tipo de conta** (corrente, poupança, de pagamento),
   opcional. Só informa: a conta do cadastro de freelas continua sem ir
   automática para a PP, porque o banco é texto livre.
3. **PIX e conta sempre à vista**, um bloco para cada, com o selo
   "preenchido" — o desenho do fornecedor (decisão 161). O seletor "Tipo de
   pagamento" saiu da tela; a coluna `tipo_pagamento` continua, preenchida a
   partir do que foi digitado (conta, se algum campo dela veio; senão PIX).
4. **O tipo gravado vence a dedução.** `pix_do_cadastro_do_freelancer` usa
   o tipo do cadastro quando há; sem ele, deduz como na 193. Com o tipo,
   o telefone também passa a ir automático.
5. **O cadastro antigo avisa.** No editar, a chave que veio sem tipo aparece
   com o aviso "O cadastro não diz o tipo desta chave. Escolha o tipo." Ao
   escolher o tipo a chave fica, já na máscara; trocar de um tipo para
   outro começa a chave de novo.

## Onde vale

- Editar e novo do RH (`freelancer-form.tsx`), o diálogo "Novo freelancer"
  em 5 passos (passo 3, Pagamento) e o formulário que o freela preenche
  pelo link (`form-client.tsx` e a RPC `cadastrar_freelancer_via_solicitacao`).
- O perfil do freela mostra "Tipo de conta" e "Tipo da chave".
- A seção nova mora em `app/(app)/freelancers/_components/pagamento-do-freelancer.tsx`.

## No banco

- `freelancers.pix_tipo` (`pix_tipo_chave`) e `freelancers.tipo_conta`
  (`tipo_conta_bancaria`), opcionais, com o CHECK
  `freelancers_pix_tipo_com_chave` (tipo só com chave).
- Os 136 freelas cujo tipo já se deduzia ganharam o tipo pela regra da 193
  (só coluna vazia; nenhuma chave reescrita; o "atualizado em" não mudou).
  Os 46 freelas ativos que já iam automáticos continuam indo.
- **Fica com o RH:** escolher o tipo da chave dos 13 freelas ativos que não
  se deduzem. Enquanto não escolher, a PP deles pede o PIX na tela, como
  antes.

## Conferência

- No banco, num bloco desfeito no fim: o tipo gravado pelo link; a chave de
  telefone indo automática com o tipo; um dos 13 indo automático depois de
  receber o tipo CPF; tipo sem chave recusado pelo CHECK. O retrato da 193
  (quem vai automático) não mudou com a migration.
- Na tela, sem gravar: o editar de um dos 13 com o aviso e a máscara ao
  escolher o tipo; o passo 3 do diálogo bloqueando "Informe a chave PIX" e o
  telefone fixo ("A chave de telefone é um celular…"). Testes do schema para
  chave sem tipo, tipo sem chave, telefone com +55 e CPF inválido.

## Fica de fora

- A exportação de freelas (`/api/freelancers/export`) continua com a coluna
  "Pagamento" de antes, sem os tipos.
- As 10 PPs de freela que estavam em avaliação em 19/10, sem conta, não
  mudam: foram geradas antes da 193.
