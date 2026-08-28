# 031 — A fatura do cartão, e a conta bancária que paga várias empresas

**Data:** 2026-08-28
**Decidido por:** Tiago

Duas decisões que nasceram juntas porque a segunda só apareceu quando a
primeira foi testada.

---

## 1. O cartão é uma conta, a fatura é a janela

O cartão de crédito virou uma **conta** no sistema, com uma conta espelho
em `contas_bancarias`. Cada compra no cartão gera um lançamento próprio
nessa conta, com o plano de contas da compra — o DRE continua vendo
despesa por despesa. O extrato bancário, por sua vez, vê **um** débito: o
pagamento da fatura.

A **fatura** não é uma conta com saldo próprio: é uma janela sobre um
razão contínuo. Uma compra feita depois do fechamento sobrevive ao
pagamento da fatura anterior — ela pertence à próxima. Isso ficou
explícito porque o Tiago levantou a dúvida certa ("o cartão não apresenta
fechamento e um início de saldo novo a cada mês?") e a resposta, com as
datas na mesa, foi não: o saldo é contínuo, a fatura é o recorte.

### O ciclo

```text
compra  →  fatura ABERTA        (aba Cartão; nenhuma baixa individual)
   ↓ fechar
um lançamento por item na conta do cartão, com o plano de contas dele
+ a diferença para o valor cobrado, classificada
+ um título único em Títulos a Pagar
   ↓ baixar
saída no banco + entrada no cartão  →  saldo do cartão volta a zero
```

### As três regras que sustentam isso

**Uma baixa por fatura, não uma por item.** *"Se cada item de cartão
aparecer em título a pagar, a tela ficará poluída com um grande número de
lançamentos enquanto a baixa só será dada em um, que é a fatura do cartão
(o agregado)."* A seleção múltipla e o "Baixar" em lote que existiam na
aba Cartão faziam o contrário e foram removidos.

**Os lançamentos nascem no fechamento, não na compra.** Enquanto a fatura
está aberta o time ainda corrige e remaneja; escrever lançamento a cada
compra obrigaria a contra-lançamento a cada correção.

**A diferença no fechamento é aceita e classificada.** IOF, anuidade e
juros aparecem em toda fatura e ninguém os lança. Sem um lugar para eles,
a fatura nunca bateria com o extrato. O fechamento **recusa** fechar com
diferença sem plano de contas do ajuste.

**Fatura de cartão não se paga com outro cartão.** Trava no banco e na
tela.

---

## 2. A conta bancária paga despesa de mais de uma empresa

O banco tinha uma FK composta `(conta_bancaria_id, empresa_id) →
contas_bancarias(id, empresa_id)`, mais a mesma regra escrita em texto
dentro de `dar_baixa_pp` e `dar_baixa_avulsa_com_plano`. O efeito: uma
conta bancária pertencia a **uma** empresa e só pagava despesa dela.

Não é assim na California. *"As contas bancárias realizam pagamentos de
mais do que uma empresa, e não funcionam de modo uma conta por empresa;
seguindo a mesma lógica o cartão também não deve ser travado a uma
empresa."*

**Quem diz a empresa da despesa é o documento** — a PP, a avulsa, o item
do cartão —, não a conta de onde o dinheiro saiu. A FK foi derrubada e as
duas travas de texto saíram.

Ninguém tinha esbarrado nisso porque só existe uma conta bancária real e
todas as 12 PPs são da mesma empresa. O primeiro documento de outra
empresa a chegar num lançamento foi uma avulsa da HITLAB no cartão, no
teste de 28/08/2026, e ela estourou a FK.

✅ **Completada em 29/08/2026.** A mesma trava existia em mais seis
funções de baixa (`dar_baixa_avulsa`, `dar_baixa_pp_parcela`,
`dar_baixa_titulo`, `dar_baixa_titulo_com_plano`,
`dar_baixa_desembolso_parcela`, `dar_baixa_devolucao_verba`) e saiu de
todas — migration `20260829100001`. O Tiago fechou a regra assim:

> "Jobs sempre estarão associados a empresas, e os faturamentos e NFs
> também, visto que sempre serão emitidas por uma empresa. Porém, as
> contas em si não são específicas de uma empresa."

O patch é cirúrgico de propósito: pega a definição exata que está no
banco, recorta só o `if` da empresa e recompila o resto idêntico. Assim
a migration não congela o código da outra frente, e aborta com mensagem
se alguma das seis não estiver no formato esperado.

---

## O que ficou em aberto

- **PP paga no cartão** ainda não existe: falta `forma_pagamento` e
  `cartao_credito_id` no pedido de compra, escolhidos **na aprovação, pelo
  financeiro** (decidido, não implementado).
- **Parcelamento** da compra no cartão: um título com N parcelas
  (decidido, não implementado). Ver a [032](032-data-da-compra-e-estorno-no-cartao.md)
  para o que o estorno já espera dele.
- **Exportação contábil** a partir da conta do cartão.

A "data da compra" e as seis funções de baixa saíram desta lista em
29/08/2026 — ver a [032](032-data-da-compra-e-estorno-no-cartao.md).

## Onde está escrito

`docs/handoffs/HANDOFF_FINANCEIRO.md`, nas notas de 28/08/2026.
