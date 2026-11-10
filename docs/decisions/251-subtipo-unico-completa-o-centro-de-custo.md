# 251 — O tipo com um único subtipo ativo completa o centro de custo

**Data:** 2026-11-10
**Status:** aceita e implementada em 10/11/2026.
**Quem decidiu:** Tiago, em 10/11/2026, olhando a Conciliação automática da California Santander: "Porque está sem centro de custo? Todos os lançamentos já deveriam vir com centros de custo". Escolheu a opção B ("subtipo único") entre as duas trazidas.
**Revê:** a [068](068-a-pp-nasce-em-custo-operacional.md), item 3 ("o subtipo continua vazio").

## O problema

Pela 068, a PP nasce com o tipo 02 · Custo Operacional e sem subtipo: quem escolhia o subtipo era o financeiro, na baixa. A conciliação só baixa num clique, ou em lote, o título com o centro de custo completo, tipo e subtipo. Por isso toda PP caía em Conferir com a situação "Sem centro de custo" e o botão Revisar.

Mas a escolha tinha uma opção só. Em 10/11/2026, no banco:

- o tipo 02 tem **um** subtipo ativo, "Geral (provisório)", o mesmo desde 18/08;
- **1.051 PPs** estão sem subtipo (só as 5 do cartão têm);
- as **135 baixas de PP** gravaram "Geral (provisório)", e as **34.208 linhas de CO** da planilha do financeiro também.

Na California Santander, de 01/11 a 06/11, eram 78 linhas "Sem centro de custo" e nenhuma em Prontos para conciliar.

## A regra

| # | Tema | Decisão |
|---|---|---|
| D1 | Quando vale | O título tem o tipo e não tem o subtipo, e o tipo tem **exatamente um** subtipo ativo no tenant |
| D2 | O que faz | O centro de custo do título está completo com esse subtipo: a conciliação o trata como certo, a baixa em lote o aceita e a baixa de um por um já abre com ele escolhido |
| D3 | Só na leitura | Nada se grava na PP: `pedidos_compra.plano_conta_subtipo_id` continua vazio. O subtipo vai para o lançamento na baixa, como sempre foi |
| D4 | O subtipo do título manda | O título que já tem subtipo nunca é trocado. O cartão, que escolhe tipo e subtipo na aprovação, segue igual |
| D5 | Quando deixa de valer | No dia em que o tipo ganhar um segundo subtipo ativo, a regra se desliga sozinha, e a baixa volta a pedir a escolha. Subtipo inativo não conta |
| D6 | Onde | Na montagem dos títulos a pagar (`montarTitulosAPagar`), que serve a Títulos a Pagar e a aba Títulos e a Conciliação automática da conciliação. A regra mora em `lib/financeiro/subtipo-unico.ts`, com teste |

## Por que não gravar o subtipo na PP

A outra saída era a PP nascer com tipo e subtipo, mais um backfill das 1.051 PPs (opção A). Ela grava o provisório em mais uma tabela. Quando o Custo Operacional ganhar subtipos de verdade com o plano de contas novo, seria preciso reclassificar também as PPs, não só os lançamentos. A B resolve o mesmo problema sem mexer em dado, e volta a pedir a escolha sozinha quando ela passar a existir.

## O que mudou na tela

Na California Santander, de 01/11 a 06/11, conferido em 10/11/2026 contra a produção:

| | Antes | Depois |
|---|---|---|
| Prontos para conciliar | 0 | 45 (39 título exato, 6 soma do fornecedor) |
| Conferir | 255 | 210 |
| "Sem centro de custo" | 78 | 0 |
| "Confirmar o título" | 7 | 47 |
| "Vários títulos" | 7 | 1 |

As linhas que eram "Sem centro de custo" foram para Prontos para conciliar, quando a confiança é alta, ou para "Confirmar o título", com a sugestão aceitável em lote. Nada se concilia sozinho (decisão 244): Prontos para conciliar continua pedindo o clique.
