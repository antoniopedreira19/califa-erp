# 196 — O popup de baixa: PIX como padrão, caixas no lugar das chaves, e juros e multa no boleto

**Data:** 2026-10-21
**Status:** aceita e implementada em 21/10/2026 (task 029, fase 2).
**Quem decidiu:** Tiago, no protótipo "Conciliação com o banco", versão
**Alternativa** (`docs/handoffs/2026-10-21-conciliacao-com-o-banco/`, seção
4.2 da especificação), e nos pontos M2.1 de 21/10/2026 (opção A, com a
origem nova `juros_baixa`).
**Revê:** a [125](125-baixa-parcial-e-impostos-retidos.md) (as chaves da baixa
parcial e da retenção viram caixas de marcar).
**Migrations:** `20261021600001_origem_juros_baixa.sql` e
`20261021600002_juros_na_baixa_e_fatura_escolhida.sql`.

## O problema

1. A baixa abria com a forma do título ou da aprovação — quase sempre vazia
   (233 das 256 PPs não têm forma) ou errada para o dia do pagamento.
2. "Baixa parcial" e "Reter impostos na fonte" eram duas chaves liga/desliga
   lado a lado, que pareciam estranhas juntas.
3. O boleto pago depois do vencimento sai do banco com juros e multa, e o
   sistema não tinha onde pôr essa diferença: ou ela virava baixa do título
   (e quitava errado), ou ficava fora do extrato (e o saldo não batia).

## A regra

1. **A forma abre sempre em PIX**, a mais comum. Nem a forma do título nem a
   da aprovação pré-preenchem. A exceção é a baixa aberta por uma linha do
   banco (`linhaDoBanco`, fase 3), em que o histórico diz a forma: "PAGFOR
   PIX" é PIX, "PAGAMENTO DE TITULO" e concessionária são boleto, "TED" é
   transferência.
2. **As três datas com os nomes certos.** O resumo do topo traz Título,
   Origem (com a parcela), **Vencimento** (do documento, nunca muda) e **Data
   prevista** (a que o lápis repactua); a **Data do pagamento** é o campo.
3. **Caixas de marcar** no lugar das chaves: "Baixa parcial" e "Reter
   impostos na fonte" (ou "O cliente reteve impostos na fonte", no
   recebimento). Vale para pagar e para receber (`valor-da-baixa.tsx`).
4. **"+ Juros e multa" só no boleto** de PP, avulso e recorrência — o banco
   calcula os encargos no próprio pagamento. No PIX e na TED o valor é o que
   a agência manda; a fatura do cartão e a conta de consumo cobram o atraso
   na seguinte. O link fica embaixo das caixas; ao lado, discreta, a dica
   "Pago X dias depois do vencimento". Clicar abre "Valor dos juros e da
   multa", com "Remover". O imposto continua com "Multa e juros" sempre à
   vista, no popup dele.
5. **O atraso conta do primeiro dia útil**: vencimento no sábado conta a
   partir da segunda (+2), no domingo também (+1). Feriados ficam de fora
   (`lib/financeiro/atraso-do-pagamento.ts`).
6. **Os juros são um lançamento à parte**, de saída, na mesma conta, data e
   forma da baixa, em **11 · Despesa com Juros · 999** (o mesmo plano da
   multa e dos juros do imposto), com a **origem nova `juros_baixa`** e
   ligado à baixa por `lancamentos_financeiros.juros_de_lancamento_id`. Ele
   guarda as chaves do documento (a PP e a parcela, ou a avulsa), o
   fornecedor, o job e a empresa.
7. **Os juros nunca quitam o título.** Toda soma do que foi baixado filtra
   pela origem `pp_baixa`/`avulsa_baixa` e pela chave do documento; a origem
   própria deixa os juros de fora em todas. Baixa parcial de R$ 2.500 numa
   parcela de R$ 3.000, com R$ 50 de juros: falta R$ 500.
8. **Os juros saem do caixa**: o saldo da conta, o Extrato, o resumo da
   conciliação e o fluxo de caixa realizado não filtram pela origem, e caem
   principal + juros.
9. **No Extrato, uma linha só**: a baixa e os juros dela são um débito só no
   banco, e aparecem como UMA linha, com a soma e a nota "inclui R$ X de
   juros" (`lib/financeiro/juros-no-extrato.ts`), como a guia de imposto
   (decisão 141). O ⓘ separa: "Saiu da conta · Principal (quita o título) ·
   Juros e multa (11 · Despesa com Juros) · Total".
10. **A regional dos juros é a do documento**: o rateio de `vw_fluxo_caixa`
    (`lancamento_rateio`) liga o lançamento pela avulsa, e o job manda na PP.
    A avulsa sem job rateada em várias regionais leva os juros pelo mesmo
    rateio dela.
11. **Cancelar a baixa apaga os juros junto** (FK em cascata: o cancelamento
    apaga o lançamento da baixa em `_apagar_lancamento_de_baixa`). Os juros
    sozinhos não se cancelam (`cancelar_baixa_lancamento` recusa a origem
    `juros_baixa`) nem se estornam (`estornar_valor_da_baixa` recusa). O
    estorno do valor da baixa devolve só o que ela movimentou: os juros
    ficam.
12. **Os avisos da linha do banco** ficam prontos para a fase 3, desligados
    até lá: "Aberto pela conciliação com o banco…", "A data é diferente da do
    banco…" e "A baixa soma R$ X e a linha do banco é de R$ Y…", que **trava**
    a confirmação. Com a linha do banco, o rodapé diz "Ao confirmar, a baixa
    entra no Extrato já conciliada com a linha do banco, com a data dela"; e a
    linha que pagou mais que o título abre os juros com a diferença.

## Onde a origem filtra (condição do Tiago, 21/10/2026)

As somas do baixado de um documento, todas pela origem e pela chave:

- `_bruto_baixado`: `supabase/migrations/20260929800001_baixa_parcial_e_retencoes.sql:157`
  (`where l.origem = p_origem`);
- `vw_baixado_por_documento`: `supabase/migrations/20260929800002_views_projetam_o_que_falta.sql:140`;
- `vw_a_pagar` e o previsto de `vw_fluxo_caixa`: as somas `v_b_pp` e `v_b_av`
  em `supabase/migrations/20260929800002_views_projetam_o_que_falta.sql:38-39`
  (`lb.origem = 'pp_baixa'` / `'avulsa_baixa'`), mantidas na reescrita de
  `20261021300001_fluxo_e_funcoes_no_dia_de_brasilia.sql`;
- as listas de baixas: `app/(app)/financeiro/contas-a-pagar/page.tsx:216` e
  `app/(app)/financeiro/conciliacao/titulos-dados.ts:176`
  (`ORIGENS_DA_BAIXA_A_PAGAR`, `contas-a-pagar/dados-dos-titulos.ts:131`),
  `contas-a-pagar/actions-avulsas.ts:74`, `contas-a-pagar/avulsa/[id]/page.tsx:172`
  e `contas-a-pagar/actions-cnab.ts:461`;
- a apuração fiscal: `lib/fiscal/apuracao-fatos.ts:260`.

O caixa, sem filtro de origem: `conciliacao_resumo_contas`,
`fc_saldos_por_conta`, o realizado de `vw_fluxo_caixa`, a consulta do Extrato
(`conciliacao/page.tsx`) e o saldo anterior (`lib/calculos/saldo-conta.ts`).

## Como foi conferido

- No banco, numa transação desfeita no fim, como usuário financeiro: a
  parcela de R$ 3.000 com baixa parcial de R$ 2.500 e R$ 50 de juros ficou
  com falta de R$ 500 em `vw_a_pagar` e no previsto de `vw_fluxo_caixa`; o
  saldo da conta caiu R$ 2.550; o realizado do fluxo trouxe as duas linhas,
  com o job e a regional; a apuração fiscal viu um `pp_baixa` só; os juros
  sozinhos não se cancelaram nem se estornaram; o estorno da baixa não mexeu
  neles; o cancelamento os levou junto; juros no cartão foram recusados.
- No navegador, pelos fluxos da tela, na PP-00111 do `TES-P001/26`: o popup
  em PIX, sem o link; o boleto com "+ Juros e multa · Pago 13 dias depois do
  vencimento"; a baixa parcial com juros, a linha "Parcial · R$ 500,00" na
  lista, o Extrato numa linha com "inclui R$ 50,00 de juros" e o ⓘ com a
  separação. A baixa foi cancelada pela conferência em seguida.
- Testes: `lib/financeiro/fatura-do-cartao.test.ts` (o atraso) e
  `lib/financeiro/juros-no-extrato.test.ts`.

## Como ficou no código

- O popup: `components/financeiro/baixa-titulo-dialog.tsx` (a forma, o
  cartão e a fatura num formulário só; o `FormaPagamentoField` continua nos
  cadastros). O `alvo` da baixa a pagar é um só, para Contas a Pagar e a
  Conciliação: `conciliacao/alvos-da-baixa.ts` (ganhou `dataPrevista` e
  `aceitaJuros`, obrigatórios).
- A action: `contas-a-pagar/actions-titulos.ts` (`juros`, só no boleto de PP,
  avulso e recorrência).
- O tipo: `OrigemLancamento` ganhou `juros_baixa` e `LancamentoFinanceiro`,
  `juros_de_lancamento_id` (`lib/types.ts`).
- O cancelamento diz quanto saiu do extrato com os juros
  (`actions-baixa-registrada.ts`, `cancelarBaixa`).

## Pendências

1. A conferência das baixas ("Baixa registrada") mostra só o principal: os
   juros aparecem no ⓘ do Extrato e no aviso do cancelamento. Mostrá-los ali
   pede ler `juros_de_lancamento_id` junto das baixas — um embed de
   `lancamentos_financeiros` nele mesmo, que já tem duas FKs para si
   (`estorno_de_lancamento_id` e a nova), e o PostgREST pode recusar
   (memória "FK nova quebra embed").
2. A linha do banco que pagou menos que o título (a baixa abre parcial, com o
   valor do banco) e a exceção dos juros fora do boleto vêm com a fase 3.
3. Feriados no atraso: ficaram de fora, como a especificação pediu.
