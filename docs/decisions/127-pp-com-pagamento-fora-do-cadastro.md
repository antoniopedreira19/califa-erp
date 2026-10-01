# 127 — A PP pode pagar por outra chave PIX ou outra conta, sem mexer no cadastro do fornecedor

**Data:** 2026-09-29
**Decidido por:** Tiago
**Migration:** `20260929980001_pp_pagamento_fora_do_cadastro.sql`
**Protótipo aprovado:** artifact "Pagamento da PP" (variante A), em três
rodadas no mesmo dia.

> ⚠️ **Revisão de 2026-10-01 ([137](137-fora-do-cadastro-visivel-e-pago-pela-remessa.md)):**
> a remessa CNAB deixou de recusar a PP fora do cadastro — ela entra no
> arquivo, paga pela chave ou conta da PP, com o fornecedor do cadastro como
> favorecido. A linha "Remessa CNAB" do §2 e o item "Remessa" do §4 valem
> só até essa data. O cartão ganhou "Pedido por" (tela da PP) e aparece
> também na baixa.

Continua a [067](067-o-campo-de-fornecedor-busca-limpa-e-edita.md), que criou a
foto dos dados de pagamento na PP, e usa as réguas de formato da
[101](101-dados-de-pagamento-no-formato-da-remessa.md).

---

## 1. O pedido

> Quero que seja possível associar um método de pagamento a uma PP
> específica, a qual pode ser diferente da cadastrada no cadastro do
> fornecedor. [...] uma empresa pode passar uma chave Pix temporária para
> realizarmos um pagamento, e essa não deverá ficar no cadastro desse
> fornecedor [...] nesse caso dessa PP específica, a chave no cadastro do
> fornecedor não deverá ser utilizada.

## 2. As decisões do Tiago

| Pergunta | Resposta |
|---|---|
| Desenho do campo | **Variante A:** um seletor só — Cadastro do fornecedor / Outro PIX / Outra conta. |
| Quanto texto | **O mínimo.** Sem descrições, avisos ou ajudas permanentes, no formulário da produção e na tela da PP do financeiro: "cansa a visão e torna o processo desgastante". |
| O PDF | **Igual ao de sempre**, "apenas com a chave escolhida". Nada de faixa, aviso ou motivo no documento, que o fornecedor assina. |
| Aprovação | **Marcação obrigatória**, com o rótulo "Aprovar pagamento fora do cadastro". |
| Meios | **PIX e conta.** Cada um troca só o seu meio. |
| Remessa CNAB | **Não mexer agora.** A PP fora do cadastro fica fora do arquivo e é paga pelo PDF — com a trava mínima que a recusa na geração (autorizada). |
| Quem usa | **Quem gera a PP** (GP e produtor). |

## 3. A regra

**A foto da PP é o cadastro com só o meio escolhido trocado.** Outro PIX
troca tipo e chave e mantém a conta do cadastro; outra conta troca banco,
agência, conta e tipo e mantém a chave do cadastro. É a mesma foto da 067 —
não há um segundo lugar para o dado —, e é dela que saem o PDF e a leitura
das telas.

**O cadastro do fornecedor não muda.** A troca vale só para aquela PP.

**Trocar de fornecedor volta para o cadastro**: a chave ou a conta digitada
era do anterior.

**Verba de Produção não tem isto**: paga o responsável interno.

## 4. Onde a regra mora

| Camada | O quê |
|---|---|
| Banco | Quatro colunas em `pedidos_compra`: `pagamento_fora_do_cadastro_meio` (`pix`/`conta`, null = cadastro), `…_motivo` (mín. 10 caracteres), `…_aprovado_por` e `…_aprovado_em`. CHECKs: meio só fora da verba; motivo obrigatório com meio; o meio trocado no formato da remessa (as mesmas expressões de `fornecedores_pix_formato` e `fornecedores_banco_completo`); e **PP fora do cadastro só vira `aprovada`/`pago` com a marcação registrada**. |
| Servidor | `pagamentoForaDoCadastroSchema` (`lib/validations/pagamento-fora-do-cadastro.ts`) valida e normaliza; as três rotas que montam o PDF (emitir, editar a gerada, reenviar a rejeitada) gravam foto + meio + motivo e zeram a marcação. `aprovarPPComData` exige `aprovar_pagamento_fora_do_cadastro` e grava a marcação **antes** da RPC `aprovar_pp_com_data`, que não foi tocada; se a RPC falhar, a marcação sai. |
| Comum | `lib/data/foto-pagamento-da-pp.ts`: `aplicarPagamentoForaDoCadastro`, `tirarFoto(cadastro, fora)`, `lerPagamentoForaDoCadastro`, e o asterisco da 067 passa a ignorar o meio trocado (senão acenderia em toda PP fora do cadastro). |
| Remessa | `resolverOrigem` (`actions-cnab.ts`) recusa a parcela de PP fora do cadastro com "Pagamento fora do cadastro: pague pelo PDF." — ela cai na lista de recusados que a geração já mostra. O resto do módulo continua lendo o cadastro. |

## 5. As telas

- **Gerar PP e corrigir PP rejeitada** (`pagamento-da-pp-field.tsx`): abaixo
  do fornecedor, "Pagamento *" com o seletor. No cadastro, uma linha com o
  que vale ("PIX CNPJ · 34.567.890/0001-30"), lida sob demanda por
  `resumoDoPagamentoDoFornecedor` — só o resumo atravessa para o cliente.
  Outro PIX: tipo + chave. Outra conta: banco; agência, conta e tipo. Em
  seguida o motivo. Os nomes dos campos ficam dentro das caixas ("Ag.",
  "Conta", "Motivo"); o erro da chave só aparece quando a pessoa sai do
  campo.
- **Ficha da PP no job e dossiê do financeiro**: três linhas logo abaixo do
  fornecedor — "Fora do cadastro" com o meio, a chave (ou agência e conta)
  inteira, o motivo.
- **Pop-up de aprovar**: uma linha, "Aprovar pagamento fora do cadastro:
  <chave>", com a caixa de marcar. Não repete o dossiê.
- **PDF**: nenhuma mudança de desenho.

## 6. Auditoria

`pedido_compra.gerada`, `.editada` e `.reenviada` levam
`pagamento_fora_do_cadastro` com o meio, o motivo e o dado trocado inteiro
(é o rastro de para onde o dinheiro foi mandado). `pedido_compra.aprovada`
leva o meio.

## 7. O que ficou de fora

- **A remessa usar os dados da PP.** Hoje ela lê o cadastro ao vivo para
  toda PP — inclusive contra a regra "o financeiro paga pela foto" da 067.
  O Tiago preferiu não mexer no módulo agora; a trava do §4 fecha o risco
  até lá.
- **Índice em `pagamento_fora_do_cadastro_aprovado_por`**: o advisor aponta
  a FK sem índice, como as outras `*_por` da tabela. É coluna de auditoria,
  nenhuma consulta filtra por ela.
- **Marca na lista de Títulos a Pagar.** O cartão aparece no dossiê e na
  aprovação; a lista não ganhou coluna nova.

## 8. Verificação

- `npm run test:foto-pp` (novo): 8 testes — troca só do meio escolhido,
  asterisco, leitura, normalização da chave, recusas do schema, resumo.
- Simulação no banco, num bloco que termina em erro (nada gravado), na
  PP-00087 do TES-1008/26: chave válida grava; aprovar sem marcação é
  recusado; com marcação aprova; chave torta, motivo curto e conta
  incompleta são recusados.
- No navegador, logado como administrador, no TES-1006/26 com o
  "Fornecedor Teste" (cadastro com PIX de e-mail), a PP-00096 de R$ 10,00:
  gerada e enviada com "Outro PIX" (chave aleatória digitada sem hífens,
  gravada com hífens); o cadastro do fornecedor não mudou; o PDF saiu com a
  faixa e as linhas de sempre, só com a chave escolhida, sem motivo; o
  dossiê e a ficha mostraram o cartão de três linhas; aprovar sem a
  marcação foi recusado, com ela aprovou e a marcação ficou no nome de quem
  aprovou; a auditoria guardou a chave e o motivo. Reprovada, o formulário
  de correção voltou com "Outro PIX", a chave e o motivo; reenviada com
  "Cadastro do fornecedor", voltou a pagar pelo cadastro, com meio, motivo e
  marcação zerados. Cancelada no fim.
- Não testado ao vivo: a recusa na remessa CNAB (gerar arquivo com
  sequencial ≥ 11 paga de verdade). Conferida pelo código.
