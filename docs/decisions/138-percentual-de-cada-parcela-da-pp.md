# 138 — O percentual de cada parcela da PP, com a última fechando os 100%

**Data:** 2026-10-01
**Decidido por:** Tiago
**Status:** aceita — entregue em 01/10/2026
**Migration:** nenhuma (a PP continua gravando só o R$ de cada parcela;
o % é do formulário)

---

## 1. O pedido

*"Quero implementar uma maneira de selecionarmos o percentual do valor
total de cada parcela ao gerar uma PP com múltiplos pagamentos (sempre
deverá fechar em 100%)."*

O desenho foi aprovado por protótipo clicável (o formulário real "Gerar
Pedido de Produção" com o bloco novo), com duas regras para fechar 100%
lado a lado. Respostas do Tiago:

| Pergunta | Resposta |
|---|---|
| Como garantir os 100% | **A** — a última parcela fecha sozinha (a outra opção deixava todas livres e travava o "Gerar" até fechar) |
| O R$ da parcela continua digitável | Sim, ligado ao % |
| Valor da PP mudou: manter o % de cada parcela | Sim |
| Prazo mudou: manter a divisão | Sim |
| O % vai ao PDF ou à tela do financeiro | Não — o PDF fica como está |
| Corrigir o reenvio da PP rejeitada, que redividia igual | Sim, junto |

## 2. O formulário (gerar e editar PP gerada)

Com 2 ou mais parcelas, cada linha mostra **Vencimento · % do total ·
Valor (R$)**, com os rótulos em cima.

- **Digitar o % refaz o R$** da parcela (valor da PP × %), e **digitar o
  R$ refaz o %**. O % aceita até duas casas ("33,5" vira "33,50" ao sair
  do campo).
- **A última parcela é travada** (cadeado, mesmo desenho da data) e é
  sempre o que falta das anteriores: em % (100 − soma das outras) e em R$
  (valor da PP − soma das outras), então a sobra de centavo cai nela, como
  já caía na divisão igual. A soma não sai de 100%.
- **O único erro possível** é as anteriores passarem de 100% (ou alguma
  ficar em 0%): a linha fica vermelha e o "Gerar" é barrado com *"As
  parcelas anteriores já somam 120,00%. Deixe espaço para a última
  parcela."* ou *"Toda parcela precisa de um percentual acima de 0%."*
- **Rodapé:** "Mesma janela, mês a mês · a última parcela fecha os 100%"
  à esquerda e "100,00% · R$ 1.000,00 / R$ 1.000,00" à direita. Quando a
  divisão deixa de ser igual aparece o link **"Dividir igualmente"**, que
  volta à divisão padrão.
- **Escolher o número de parcelas** continua refazendo tudo em divisão
  igual (R$ pela regra de sempre, % pela mesma regra: 33,33 + 33,33 +
  33,34).

### 2.1 Duas mudanças de comportamento

| Quando | Antes | Agora |
|---|---|---|
| R$ Unit., QT ou D/M mudam | Tudo voltava a ser dividido igual | Cada parcela mantém o seu %; divisão que era igual continua igual |
| O prazo de pagamento muda | As datas andavam e a divisão voltava a ser igual | As datas andam e a divisão fica |

### 2.2 Edição da PP gerada

A PP gravada não guarda o %: ao reabrir, o % de cada parcela se refaz do
R$ gravado (R$ ÷ valor da PP), e a última recebe o complemento para a
coluna fechar em 100,00%. Conferido com a PP-00091 (R$ 6.000 + R$ 4.000):
reabre com 60,00% / 40,00%.

## 3. O reenvio da PP rejeitada (`reenviarPedidoCompra`)

O número de parcelas e as datas continuam os combinados na emissão. O
que muda é o valor: se a correção altera o total, **cada parcela mantém a
sua proporção** (`redividirPelaProporcao` em `lib/calculos/pps-item.ts`):
um 30/70 de R$ 1.000 corrigido para R$ 1.200 grava R$ 360 + R$ 840. Até
esta decisão a action redividia em partes iguais, e o 30/70 voltava
600/600 — mesmo sem mudança de valor nenhum.

- Total igual ao anterior: os valores ficam como estão.
- Divisão que já era igual continua igual (sem isso, R$ 1.666,66 +
  1.666,66 + 1.666,68 levado a R$ 6.000 daria 1.999,99 + 1.999,99 +
  2.000,02).
- A sobra de centavo cai na última.
- O formulário de correção ganhou a frase "Mudar o valor mantém o % de
  cada uma." abaixo do prazo.

## 4. O que não muda

- O servidor recebe e grava só o R$ de cada parcela, e continua
  validando que a soma fecha com o valor da PP (`parcelasFecham`) e que
  toda parcela é positiva.
- PDF, tela do financeiro, aba de PPs e "Ver PP" não mostram o %.
- Os outros parcelamentos do sistema (desembolsos, notas do faturamento,
  previsão da abertura) ficam como estão.

## 5. Onde está

- `app/(app)/jobs/[jobId]/realizado/parcelas-da-pp.tsx` — o bloco
  (`ParcelasDaPPField`) e as regras do formulário (`montarParcelas`,
  `parcelasDaPPGravada`, `redividirParcelas`, `trocarDatas`,
  `problemaDasParcelas`).
- `app/(app)/jobs/[jobId]/realizado/gerar-pp-drawer.tsx` — usa o bloco;
  a trava entra no `validar()` antes do `parcelasFecham`.
- `app/(app)/jobs/[jobId]/realizado/actions-pp.ts` — `reenviarPedidoCompra`
  lê o `valor` das parcelas e redivide pela proporção.
- `app/(app)/jobs/[jobId]/pps/editar-pp-drawer.tsx` — a frase nova.

## 6. Conferência (01/10/2026)

No TES-1006/26 · Item 2, com o administrador: PP-00108 de verba de
produção, R$ 1.000 em 2 parcelas, 30% na primeira (R$ 300 + R$ 700); a
trava com 120% barrou o "Gerar"; gerada e enviada, rejeitada pelo
financeiro, corrigida para R$ 1.200 e reenviada — o banco gravou R$ 360 +
R$ 840. Cancelada no fim. No TES-1008/26, a PP-00091 aberta em edição sem
salvar: 60/40, R$ Unit. 12.000 manteve 60/40 (7.200 + 4.800), 25% na
primeira deixou 75% na última.
