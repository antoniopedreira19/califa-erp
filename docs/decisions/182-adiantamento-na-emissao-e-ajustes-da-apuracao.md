# 182 — O adiantamento conta na emissão da nota; ajustes da lista da Apuração

**Data:** 2026-10-16
**Status:** aceita e implementada (16/10/2026).
**Quem decidiu:** Tiago, em 16/10/2026: "Deve se tratar do mês de emissão da
NF, com os impostos sendo calculados no mês ou trimestre seguinte dependendo
do seu tipo"; "Retire o ícone do olho nos casos em que aprovar já está
disponível"; e, sobre o texto vermelho da diferença, "que fique apenas o
valor a mais (ou a menos se possível)".
**Revê:** a [141](141-modulo-fiscal-entrega-2.md) e a
[142](142-modulo-fiscal-pontos-remanescentes.md) no momento do recebimento
(o adiantamento contava no dia do dinheiro) e a
[181](181-empresas-de-teste-e-apuracao-por-vencimento.md) em dois detalhes da
lista.
**Migration:** nenhuma.

## 1. O adiantamento conta na emissão da nota

**Antes.** O recebimento antes da nota (decisão 125, "recebimento antes da
NF") vira a baixa da parcela quando a nota é emitida, com a data em que o
dinheiro entrou. A Apuração contava esse recebimento naquele dia — em
setembro, por exemplo, para uma nota de outubro. No lucro presumido pelo
caixa (a Hitlab), PIS, COFINS, IRPJ e CSLL nasciam no mês do dinheiro.

**A regra.** O adiantamento não é tributado no recebimento: entra na
receita do mês do faturamento (IN RFB 1.700/2017, art. 223, §2º; IN RFB
2.121/2022, art. 54, §2º). No sistema, todo recebimento com data anterior à
emissão da nota passa a contar **na data da emissão**. Os impostos vencem
como os demais: PIS e COFINS no mês seguinte; IRPJ e CSLL pelo trimestre da
emissão. A retenção feita pelo cliente no adiantamento vai junto (abate no
mesmo período em que a receita entra na base — IN 1.700, arts. 221, §1º, e
222). O recebimento depois da nota segue no dia dele.

**Onde.** `lib/fiscal/apuracao-fatos.ts` (`montarFatos`): o recebimento
ganha `adiantado_em` (o dia do dinheiro) e `data` (o dia que conta). A
leitura passou a trazer as baixas de todas as notas com CNPJ emissor, de
qualquer data — o adiantamento pode ser anterior a outubro/2026 —, filtrando
pelo CNPJ emissor da nota no próprio banco. A memória de cálculo diz
"recebida em 20/09/2026, antes da nota · conta na emissão, 05/10/2026".

Vale para todas as PJs. No lucro real, o recebimento só leva as retenções
do cliente, que passam a abater no período da nota.

A pesquisa de 01/10 marcou o ponto como "incerto" (não há Solução de
Consulta dizendo que a nota do adiantamento, que Salvador exige, é o
"faturamento" do caixa federal). Fica a conferir com a contabilidade.

## 2. A lista da Apuração

- **Sem o olho quando há botão de ação.** "Aprovar", "Confirmar" e
  "Diferença" (e o "Aprovar" de contorno da PJ de teste) abrem a mesma
  memória de cálculo; o olho só aparece quando não há ação.
- **A diferença mostra só o valor:** "+R$ 160,00" (vermelho) ou "−R$ 50,00"
  (verde), com "A mais desde a aprovação" na dica. A frase inteira passava
  da coluna.
- **"saldo credor R$ …" e "calculado R$ …"** quebram linha dentro da coluna
  em vez de passar dela.

## 3. Pendências (registradas a pedido do Tiago)

1. **LC 224 · receita de jan–set/2026 da Hitlab:** o Tiago vai pedir à
   contabilidade os três números (e as guias de IRPJ/CSLL do 1º ao 3º
   trimestre) e lançar em Cadastros › Impostos › Parâmetros.
2. **Rendimento de aplicação no lucro presumido:** entra inteiro na base do
   IRPJ e da CSLL (não pelos 32%) e conta no adicional. A Hitlab não tem
   aplicação hoje; fazer quando uma conta de aplicação for criada.
3. **A Hitlab retém quando paga fornecedor?** Pela lei, sim, como a
   California (PIS/COFINS/CSLL, IRRF e o ISS que Salvador exigir), e o
   sistema já trata assim. O Tiago vai confirmar como é feito hoje.
4. **Onde mostrar o "a apurar no recebimento":** protótipo com duas formas
   (na lista, como linhas "A apurar" na data de vencimento; ou no resumo,
   com o detalhe num pop-up), aguardando a escolha.

## Arquivos

- `lib/fiscal/apuracao.ts` — `RecebimentoFiscal.adiantado_em` e
  `quandoRecebida` (o texto da memória).
- `lib/fiscal/apuracao-fatos.ts` (+ teste) — a leitura e a data que conta.
- `app/(app)/financeiro/fiscal/apuracao/aba-apuracao.tsx` — o olho e os
  valores pequenos das colunas.
