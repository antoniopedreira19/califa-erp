# 197 — O cartão: a fatura escolhida na baixa, o lote no cartão e o extrato da fatura na grade das planilhas

**Data:** 2026-10-21
**Status:** aceita e implementada em 21/10/2026 (task 029, fase 2).
**Quem decidiu:** Tiago, no protótipo "Conciliação com o banco", versão
**Alternativa** (`docs/handoffs/2026-10-21-conciliacao-com-o-banco/`, seção
4.3 da especificação), e nos pontos M2.2 e M2.4 de 21/10/2026 (opção A nos
dois).
**Revê:** a [093](093-o-item-entra-na-fatura-na-confirmacao-do-pagamento.md) (a fatura da data
deixa de ser a única) e a [140](140-baixa-em-lote-e-aba-titulos.md) (o
cartão entra no lote).
**Migrations:** `20261021600002_juros_na_baixa_e_fatura_escolhida.sql` e
`20261021600003_baixa_e_fatura_so_pelo_financeiro.sql`.

## O problema

1. A baixa no cartão punha o item na fatura da data do pagamento, sem
   escolha. A compra que o banco lançou em outra fatura ficava no lugar
   errado, e o fechamento não batia com a fatura do banco.
2. O lote não aceitava cartão: dez compras do mesmo dia no mesmo cartão eram
   dez baixas, uma a uma.
3. O extrato da fatura tinha largura automática, uma coluna "Trimestre" larga,
   sem REG, e o pagamento da fatura não aparecia nela.
4. Seis funções que mexem em dinheiro só checavam se quem chama é do tenant.
   As telas barravam no servidor, mas 90 membros ativos (GPs, produtores,
   freelancers e RH) podiam chamá-las direto.

## A regra

1. **O campo Fatura** na baixa no cartão (PP, avulso, recorrência e
   desembolso): vem a da data do pagamento ("· pela data do pagamento"), e dá
   para trocar por outra aberta do cartão, pela da data quando ela ainda não
   existe ("Nova fatura"), ou pela competência seguinte à última. Fechada,
   paga ou cancelada não recebe item: reabra-a na aba Cartão. Quando a
   escolhida não é a da data, o aviso: "Pela data do pagamento (…), o item
   cairia na fatura de … Confira na fatura do banco em qual ele veio"
   (`lib/financeiro/fatura-do-cartao.ts`, `faturaDestino` e
   `opcoesDeFatura`, as do protótipo).
2. **A baixa manda a competência, não o id** (`p_fatura_competencia`, o dia 1
   do mês): o banco usa a fatura aberta dela, cria a que ainda não existe (da
   competência da data do pagamento até 12 meses depois) e recusa a fechada
   (`_fatura_da_competencia`). Uma transação só: a "Nova fatura" não tem id
   antes da baixa, e criá-la à parte deixaria uma fatura vazia se a baixa
   falhasse.
3. **O lote no cartão**: um cartão e uma fatura para todos, cada título vira
   um item dela, pelo valor inteiro e sem retenção. Ficam de fora a folha (não
   se paga com cartão) e o título com baixa parcial (o restante segue pela
   conta), com o motivo embaixo da forma. A conta some; "Entram na fatura"
   no lugar de "Saem da conta". O "Previsto no cartão: dê baixa nele
   sozinho" saiu da lista de exclusões.
4. **O extrato da fatura na grade das planilhas** (decisão 195): Data ·
   Crédito · Débito · Acumulado · Descrição · Fornecedor · Job · Centro de
   Custo · TRI · Empresa · REG · Ação, `table-fixed` com `colgroup`, as
   larguras do Extrato, **sem a coluna Situação**. O tipo do item (PP,
   avulso, recorrência, desembolso, estorno, ajuste) é a etiqueta embaixo da
   descrição, com o código; o centro mostra só o tipo; a Ação tem o ⓘ do
   Extrato, "Estornar compra" e "Ver a baixa registrada".
5. **A fatura paga fecha com a linha do pagamento**: o crédito que zera o
   acumulado, "Pagamento da fatura FC-… · saiu da …", fora do DRE.
6. **Só admin e financeiro, também no banco** (M2.4): `dar_baixa_desembolso_parcela`,
   `dar_baixa_devolucao_verba`, `dar_baixa_fatura_cartao`,
   `fechar_fatura_cartao`, `reabrir_fatura_cartao` e `rotear_pp_para_cartao`
   passam a usar `_exige_financeiro_para_baixar`. O desembolso grava como
   autor quem está logado. `garantir_fatura_aberta_do_cartao`, que cria
   fatura e não checava nada, perdeu o EXECUTE de `authenticated`: nenhuma
   tela a chama, e quem a chama (`cartao_lancar_item`,
   `rotear_pp_para_cartao`, `_fatura_da_competencia`) é SECURITY DEFINER.

## Como foi conferido

- No banco, numa transação desfeita no fim, como usuário financeiro: a fatura
  nova de 10/2026 do ZZ Teste Empresa Teste foi criada (vence 05/11), duas
  baixas na mesma competência caíram na mesma fatura, a fechada FC-00004 foi
  recusada com "reabra-a na aba Cartão", a competência 12 meses à frente foi
  recusada, a fatura fora do cartão foi recusada, `garantir_fatura_aberta_do_cartao`
  direto deu "permission denied", e um GP foi barrado ao reabrir, ao fechar e
  ao dar baixa num desembolso.
- No navegador, pelos fluxos da tela, depois da revogação: a PP-00102 do
  `TES-P001/26` no cartão, com a troca para a "Nova fatura" de nov/26 (o aviso
  da data apareceu), criou a FC-00005; o lote da PP-00079 e da PP-00110 entrou
  inteiro na FC-00005, sem retenção. A aba Cartão mostrou os três itens na
  grade nova. As três baixas foram canceladas pela conferência em seguida (a
  FC-00005 ficou aberta e vazia no cartão de teste).
- A fatura paga FC-00003 do ZZ Teste Fatia 2 fecha com a linha do pagamento.
- Testes: `lib/financeiro/fatura-do-cartao.test.ts` (a fatura da data, as
  opções, a fechada) e `lib/financeiro/baixa-em-lote.test.ts` (o lote no
  cartão: todos na mesma fatura, sem conta e sem retenção; a folha fora).

## Como ficou no código

- A fatura no popup e no lote: `components/financeiro/baixa-titulo-dialog.tsx`,
  `components/financeiro/baixa-em-lote.tsx`; as faturas recentes dos cartões
  lidas com a página: `lib/data/faturas-na-baixa.ts`.
- O lote: `lib/financeiro/baixa-em-lote.ts` (`forma_pagamento` com o cartão,
  `cartao_credito_id`, `fatura_competencia`; `ORIGENS_NO_CARTAO`); o título do
  lote ganhou `semCartao`, obrigatório. Contas a Pagar usa as funções do lote
  de `conciliacao/alvos-da-baixa.ts` (a cópia saiu).
- O extrato da fatura: `contas-a-pagar/fatura-extrato.tsx`
  (`colunasDaFaturaNaGrade`); o pagamento: `lib/data/fatura-cartao-extrato.ts`
  (`pagamento.valor`).

## Pendências

1. A FC-00005 (nov/26) do ZZ Teste Empresa Teste ficou aberta e vazia, do
   teste: não há na tela como apagar fatura.
2. A competência criada pela baixa nasce com o vencimento de
   `proxima_fatura_cartao`; quem quiser outro dia de vencimento numa fatura
   nova ajusta no fechamento, como hoje.
