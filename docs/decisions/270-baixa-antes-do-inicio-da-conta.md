# 270 — A baixa com data antes do início da conta no sistema

**Data:** 2026-11-23
**Status:** aceita e implementada em 23/11/2026.
**Quem decidiu:** Tiago (16/11/2026: "Ele não poderia ser o mesmo, porém nesses casos reconhecer que é pelo histórico? Ele ainda poderia ficar de standby para que possamos ajeitar por aqui com a planilha interna do financeiro"; "Ajeitar = conciliar o histórico"; "Todas as baixas"; 23/11: "pode implementar").
**Migration:** `20261123600001_baixa_antes_do_inicio_da_conta.sql`.
**Revê:** a [261](261-baixa-de-pp-paga-antes-de-a-conta-comecar.md) (a baixa antiga deixa de depender da linha da planilha) e a trava do fechamento da [205](205-fechamento-da-conciliacao.md)/[262](262-conciliacao-acertar-e-conciliar.md).
**Relacionadas:** [211](211-importacao-do-historico-da-planilha-financeira.md) (o histórico da planilha, o só DRE e o Extrato contínuo com o ajuste de abertura), [254](254-conciliacao-dia-a-dia.md) (a conciliação conta do início da conta).

## O problema

Toda baixa recusava data anterior ao início da conta no sistema (`saldo_inicial_data`): "Data do pagamento é anterior à data do saldo inicial da conta." O caso que o financeiro trouxe em 16/11 foi a PP-00340 (verba de R$ 2.000,00, paga em 02/10; a California Santander começa em 03/11). Havia 40 parcelas de PP aprovadas na mesma situação.

Para escapar do erro, o financeiro deu baixa com data de novembro em pagamentos de outubro: PP-00298 (16/11, refeita pela decisão 261 em 17/11), PP-00153 e a 2ª parcela da PP-00301 (19/11, com data 09/11). Sem linha do banco para casar, o saldo do sistema ficou abaixo do banco desde 09/11 e o dia não fechava.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | Botão | Nenhum botão novo. O mesmo "Confirmar baixa" aceita a data antes do início da conta. |
| D2 | Alcance | Todas as baixas: parcela de PP, conta avulsa e recorrência, título a receber, desembolso, estorno de verba, fatura do cartão, imposto, recebimento antes da NF, a baixa em lote e o estorno de uma baixa. Transferência e mútuo não são baixa e ficam como estão. |
| D3 | Saldo e conciliação | Não mudam. O lançamento nasce antes do início, e o saldo, a conciliação dia a dia e o fechamento contam do início. No Extrato contínuo (decisão 211) ele aparece antes do início, e o "Ajuste de abertura" se recalcula sozinho. |
| D4 | Aviso | Faixa âmbar no topo do pop-up (a opção recomendada do protótipo de 16/11; o Tiago autorizou a implementação sem escolher outra): "Pagamento (ou Recebimento) antes do início da conta no sistema (dd/mm/aaaa): a baixa vai para o período antes do início e não muda o saldo nem a conciliação." O rodapé troca "enviado para a Conciliação" por "fica a conciliar com o histórico da planilha". |
| D5 | Fechamento | A trava do fechamento (`_exige_periodo_aberto`) vale do início da conta até a data do fechamento. Data antes do início passa mesmo com o mês fechado; sem isso, depois de fechar novembro, nenhuma baixa de outubro entraria (nem a da decisão 261). |
| D6 | Conciliação do histórico | A baixa antes do início fica "a conciliar com o histórico" até ser ligada à linha da planilha que registra o pagamento. A ligação é feita pela equipe, com a planilha do financeiro (sem botão por enquanto), pela ação `ligarBaixaAoHistorico` → `ligar_baixa_ao_historico`. |

## O que a ligação muda

- Linha da carga do **período** ou da **cauda**: a baixa sem ligação conta duas vezes no Extrato antes do início (a linha e a baixa), e o ajuste de abertura compensa. Ligada, a baixa deixa de se repetir.
- Linha do **só DRE** (a maior parte de outubro): o só DRE não entra no saldo nem aparece no Extrato, então a baixa sozinha já deixa o Extrato certo. Ligada, a ligação fica registrada (a planilha diz que pagou aquela PP), sem mudar a tela.
- Regras de `ligar_baixa_ao_historico`: baixa com data antes do início, sem ligação, que não seja estorno; linhas de carga ativa `periodo`, `cauda` ou `so_dre`, sem ligação e sem linha do banco, da mesma conta e do mesmo dia; soma igual ao valor da baixa, com o sinal dela. Cancelar a baixa solta as linhas.
- Uma linha que paga duas PPs (um PIX só para duas verbas da mesma pessoa) se liga às duas baixas: ver "Várias baixas numa linha" abaixo.

## Como funciona

- Banco (`20261123600001`): `_conta_da_baixa` sem a trava da data; as cinco funções com trava própria (`dar_baixa_desembolso_parcela`, `dar_baixa_devolucao_verba`, `dar_baixa_fatura_cartao`, `dar_baixa_pp`, `estornar_valor_da_baixa`) perdem só esse `if` (o resto do corpo é o de produção, trocado por expressão regular com conferência); `_exige_periodo_aberto` ignora data antes do início; `ligar_baixa_ao_historico` nova, só para `authenticated`.
- Tela: `components/financeiro/periodo-fechado.tsx` ganha `inicioDaConta`, `antesDoInicioDaConta`, `AvisoAntesDoInicio` e o `inicio` em `usePeriodoFechado`. Usam: `baixa-titulo-dialog.tsx` (Títulos a Pagar e Conciliação), `baixa-recebimento-dialog.tsx` (Títulos a Receber e Conciliação), `baixa-em-lote.tsx` e `fiscal/impostos/dialogos.tsx`. A conta da baixa de imposto e a do lote passam a trazer `saldo_inicial_data`.
- Ação: `ligarBaixaAoHistorico` em `financeiro/actions-baixa-registrada.ts`, auditoria `lancamento_financeiro.ligado_ao_historico`.
- A baixa pelo histórico da decisão 261 (`baixarParcelaPeloHistorico`) continua valendo: dá a baixa e liga numa chamada só. A liberação `app.baixa_pelo_historico` ficou sem efeito.

## Conferido

- Banco: as sete funções sem a trava, a ligação nova só para `authenticated` (nada para `anon`).
- Sandbox, pela tela (Admin Sandbox): PP-00102 com data 15/09 na "Conta Teste 253" (início em 01/10) mostrou a faixa e o rodapé novos e gravou a baixa em 15/09.

## Aplicado na produção em 23/11/2026

PP-00153 (R$ 600,00) e 2ª parcela da PP-00301 (R$ 17.300,00) tinham sido baixadas em 19/11 com data 09/11, sem linha do banco: a planilha registra os pagamentos em 20/10 e 02/10 (carga "Outubro 2026 · só DRE"), e as linhas do banco de 09/11 são de outras baixas (PP-00329 e a 1ª parcela da PP-00301). Com o login do Tiago, pelas ações da tela:

| PP | Antes | Depois |
|---|---|---|
| PP-00153 | baixa em 09/11, sem linha | cancelada (motivo registrado); baixa em 20/10 pela baixa comum; ligada à linha da planilha de 20/10 (`ligarBaixaAoHistorico`) |
| PP-00301, 2ª parcela | baixa em 09/11, sem linha | cancelada (motivo registrado); baixa em 02/10 pela baixa comum; ligada à linha da planilha de 02/10 |

A 1ª parcela da PP-00301 continua em 09/11, ligada à linha do banco. Na California Santander, as baixas de 09/11 sem linha do banco caíram de 18 (−R$ 59.187,45) para 16 (−R$ 41.287,45): o saldo do sistema a partir de 09/11 deixa de ficar R$ 17.900,00 abaixo do banco, e o ajuste de abertura absorve os dois pagamentos. A segunda ligação da mesma baixa foi recusada ("Esta baixa já está ligada a uma linha da planilha."), como devia.

## Várias baixas numa linha (revisão de 23/11/2026)

⚠️ **Pedido do Tiago, depois da entrega:** "Faço a ligação com a planilha aceitar várias baixas numa linha só?" — "Sim, faça".

- **O caso:** o financeiro paga duas verbas da mesma pessoa num PIX só, e a planilha registra o PIX numa linha que cita as duas PPs. Em outubro, no ANI-1012: 14/10 R$ 1.800,00 (PP-00178 + PP-00185), 14/10 R$ 1.500,00 (PP-00184 + PP-00188), 20/10 R$ 1.200,00 (PP-00182 + PP-00186) e 20/10 R$ 700,00 (PP-00183 + PP-00187), todas do só DRE; e em 28/09, na Santander GoCrazy (carga do período), R$ 1.200,00 para PP-00191 + PP-00192, que somam R$ 1.187,56 (os R$ 12,44 de diferença esperam o comprovante). No sistema, cada PP tem a sua baixa.
- **Por que não cabia:** a ligação da decisão 261 morava na linha (`historico_movimentos.lancamento_id`), e uma linha só apontava para uma baixa. Com o banco é o contrário (a baixa aponta para a linha do banco), por isso um PIX do banco já conciliava várias PPs.
- **Agora:** a ligação mora em `historico_movimento_baixas`, um par linha × baixa. Valem uma linha com várias baixas, uma baixa com várias linhas (a parcela paga em duas transferências no mesmo dia) e várias com várias, desde que sejam da mesma conta e do mesmo dia e as somas batam. `ligar_baixa_ao_historico(baixas[], linhas[])` e `ligarBaixaAoHistorico({ lancamento_ids, movimento_ids })`. A baixa pelo histórico da 261 grava na mesma tabela.
- **Extrato:** a baixa ligada a uma linha do período ou da cauda não se repete na parte do sistema, e a linha mostra os códigos de todas as PPs ("PP-00178, PP-00185"). A linha do só DRE não aparece no Extrato.
- **Dados:** as 14 ligações que existiam (12 da 261 e as 2 de 23/11) foram para a tabela. A coluna `historico_movimentos.lancamento_id` ficou sem uso, marcada como obsoleta; removê-la é destrutivo e espera o OK do Tiago.
- **Recarga do histórico:** apagar a linha (a troca de uma carga) solta o par, como antes; a ligação precisa ser refeita na carga nova.
- **Migration:** `20261123600003_varias_baixas_numa_linha_da_planilha.sql`.
- **Conferido (produção, transação desfeita):** as baixas da PP-00178 e da PP-00185 em 14/10, ligadas juntas à linha de R$ 1.800,00; uma baixa só foi recusada ("As linhas da planilha somam R$ 1.800,00 e as baixas, R$ 900,00"); ligar de novo foi recusado; o ajuste de abertura foi de R$ 2.427.507,84 para R$ 2.429.307,84 (as duas verbas antes do início, fora do saldo). Em 21/07, as quatro baixas da 261 seguem sem se repetir, com os códigos nas linhas. Nada ficou gravado.
