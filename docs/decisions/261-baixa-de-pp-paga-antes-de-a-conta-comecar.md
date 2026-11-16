# 261 — A baixa de PP paga antes de a conta começar no sistema, pela linha do histórico

**Data:** 2026-11-16
**Status:** aceita e implementada em 16/11/2026.
**Quem decidiu:** Tiago ("Ajuste no sistema, mas garanta que isso não interfira no saldo para que a conciliação continue sendo feita devidamente").
**Migration:** `20261116800001_baixa_pelo_historico.sql`.
**Relacionadas:** [211](211-importacao-do-historico-da-planilha-financeira.md) (o histórico da planilha e a carga "só DRE"), [254](254-conciliacao-dia-a-dia.md) (a conciliação dia a dia começa no saldo inicial), [196](196-popup-de-baixa-pix-caixas-e-juros-no-boleto.md) (juros na baixa).

## O problema

PPs do DEE-1001/26 foram aprovadas e pagas por fora do sistema, pela California Santander, de 21/07 a 08/10/2026. A produção as lançou depois no "Destrinchar realizado". O pagamento já estava no histórico da planilha (cargas "3T 2026" e "Outubro 2026 · só DRE"), na data certa.

A conta começa no sistema em 03/11 (`saldo_inicial_data`). Toda baixa passa por `_conta_da_baixa`, que recusa data anterior a ela. A PP aprovada sem baixa aparece como título a pagar vencido e pode ser paga de novo.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | Caminho | Baixa da parcela **na data e na conta da linha do histórico** que registra o pagamento. Só para data **anterior ao saldo inicial** da conta: a partir dele, o pagamento se baixa pela conciliação com o banco. |
| D2 | Valor | A baixa é do valor inteiro que falta na parcela, e as linhas do histórico precisam somar exatamente esse valor (mesma conta, mesmo dia). Sem parcial, retenção ou juros por este caminho: quando a planilha pagou outro valor, **a PP se ajusta antes** (decisão do Tiago para os casos de 16/11). |
| D3 | Ligação | A linha da planilha guarda a baixa (`historico_movimentos.lancamento_id`). Uma linha só se liga uma vez. Cancelar a baixa apaga o lançamento, e a ligação cai junto. |
| D4 | Saldo e conciliação | Não se movem. O lançamento nasce antes do saldo inicial, e o saldo da conta, o fechamento e a conciliação dia a dia contam a partir dele. A linha da planilha não muda de carga nem de valor, então o DRE do histórico segue igual. |
| D5 | Extrato | No histórico da planilha, a linha mostra o código da PP. A baixa ligada sai da parte do sistema naquele período, para o mesmo pagamento não aparecer duas vezes. |
| D6 | Cartão | Não entra: a PP paga no cartão vai para a fatura (decisão 093). |

## Como funciona

- `baixar_parcela_pp_pelo_historico(parcela, linhas, tipo, subtipo, forma)`: confere as linhas (saída de carga ativa `periodo`, `cauda` ou `so_dre`, sem ligação e sem linha do banco, mesma conta e dia, antes do saldo inicial, soma igual ao que falta), libera a data para aquela conta e aquele dia só nesta transação (`app.baixa_pelo_historico`), chama `baixar_parcela_pp` e liga as linhas.
- `_conta_da_baixa` aceita a data anterior ao saldo inicial só com essa liberação. Toda outra baixa segue barrada como antes.
- `historico_extrato_da_conta` devolve, em cada linha, a baixa ligada e o código da PP.
- Ação `baixarParcelaPeloHistorico` em `financeiro/contas-a-pagar/actions-titulos.ts` (admin ou financeiro), com a auditoria `pedido_compra.parcela_paga_pelo_historico`.
- **Ainda sem botão na tela**: nesta entrega a ação foi chamada pelo transporte real da Server Action, com o login do Tiago.

## O Realizado não muda com a baixa

O realizado do item soma o **valor das PPs** (menos devolução de verba, mais o custo do sócio). Juros e multa viram um lançamento à parte (11 · 999, decisão 196), a retenção sai depois por guia, e a baixa parcial deixa o resto a pagar: em nenhum dos três o Realizado muda. Por isso, quando a planilha pagou outro valor, o valor da PP é que se ajusta.

## Aplicado em 16/11/2026 (DEE-1001/26)

| PP | Pagamento (histórico) | Observação |
|---|---|---|
| PP-00954, PP-00955, PP-00956, PP-01102 | 21/07 | verbas |
| PP-01130 | 14/08 | valor ajustado de R$ 1.400,00 para R$ 1.540,13 (o envio foi desfeito por SQL, com o OK do Tiago: não há botão para isso) |
| PP-01100 | 08/09 e 08/10 | valor ajustado de R$ 24.941,18 para R$ 24.492,00, em 2 parcelas de R$ 12.246,00; a NF fica com R$ 24.492,00 "nesta PP"; a 2ª linha é da carga "só DRE" |
| PP-00947 | 10/09 | |
| PP-00971 | 23/09 | verba |
| PP-01101 | 25/09 | pagamento trocado de Boleto para Guia (o anexo é uma guia de taxa municipal) |

O envio pediu o vencimento numa janela aceita (25/11, pelo "Atualizar vencimento"); a aprovação pôs a data de pagamento da planilha; as quatro PPs de linhas sem planejado tiveram o "tem certeza?" confirmado. Saldo da California Santander antes e depois: R$ 628.125,79.

**Ficaram de fora:** PP-00957 a PP-00961 (compras no cartão), que a planilha guarda como "cartão de crédito" em 29/12, sem fatura identificada.

## Conferido

- Numa transação desfeita, na produção: a baixa comum segue barrada antes do saldo inicial; linha de outro valor é recusada; a mesma linha não se liga duas vezes; o saldo e as condições do fechamento não mudam; o histórico do extrato traz a PP; apagar a baixa desliga a linha.
- Pela tela, no Extrato da California Santander: 21/07 com PP-00954/955/956/01102 nas linhas do histórico e sem a parte do sistema; 08/09 com PP-01100 uma vez só.
