# 200 — As ações da Conciliação automática

**Data:** 2026-10-21
**Status:** aceita e implementada em 21/10/2026 (task 029, fase 3, entrega 3B).
**Quem decidiu:** Tiago, no protótipo "Conciliação com o banco", versão
**Alternativa** (`docs/handoffs/2026-10-21-conciliacao-com-o-banco/`, seção
4.6 da especificação); M3.6 (opção A) e M3.8 (opção A) em 21/10/2026; e as
três perguntas da entrega 3B, no mesmo dia: a data do banco em tudo, o título
com a diferença em aberto na correção fora do boleto, e o ramo da devolução
bancária na policy de leitura.
**Migrations:** `20261021700003_origem_devolucao_bancaria.sql`,
`20261021700004_acoes_da_conciliacao.sql` e
`20261021700005_lancar_pela_regra_natureza.sql`.

## O problema

A entrega 3A (decisão 199) mostrava o que o sistema tem para cada linha do
banco, mas nada se fazia por lá: a baixa continuava pela aba Títulos e a
linha do banco nunca ficava conciliada.

## A regra

### Cada ação, na célula Ação da linha

A célula tem as três vagas fixas do protótipo (a ação, a lupa, o ignorar).

1. **Conciliar** (a baixa feita à mão que bateu): só liga a linha aos
   lançamentos — a baixa, os juros dela, as partes da guia —, com a soma
   batendo centavo a centavo. Nenhuma baixa nova.
2. **Baixar e conciliar** (título certo: confiança alta e centro de custo
   completo): a baixa vai pela **baixa em lote de sempre** (`darBaixaEmLote`,
   com as travas e a retenção da aprovação relida lá), com os dados do
   banco — a data e a conta da linha, a forma pelo histórico ("PIX" é PIX,
   "PAGAMENTO DE TITULO" e concessionária são boleto, "TED" é transferência)
   —, e a linha se liga a ela. Vale para um título, para a soma de títulos da
   mesma contraparte e para a remessa. O título que não vai pelo lote
   (desembolso, fatura, estorno de verba, transferência, o imposto sem guia,
   o título sem subtipo) abre a baixa de um por um.
3. **Conferir**: abre a **baixa real** do lado do título (a mesma da aba
   Títulos e das listas) já com a data, a conta, a forma e o valor do banco:
   - a baixa a pagar e a de recebimento abrem **parciais** com o valor do
     banco quando ele pagou menos e nenhuma retenção explica, ou **com a
     retenção** que o motor achou (passo 3b), editável;
   - a baixa a pagar abre os juros quando o banco pagou mais (fase 2), e o
     imposto abre a multa e os juros com a diferença;
   - a baixa só confirma quando o que sai da conta bate com a linha.
   Depois da baixa, a linha se liga a ela pelo documento
   (`conciliar_linha_pelos_documentos`): as actions de baixa não precisaram
   mudar. Se a ligação falhar, a baixa vale e aparece como "baixa feita à
   mão" na próxima leitura.
4. **Linhas iguais** ("Baixar e conciliar as N", "Trocar…"): uma baixa por
   linha, com o título escolhido para ela; as linhas do grupo se desfazem
   juntas.
5. **A lupa** ("Escolher o título desta linha"): os títulos em aberto no
   sentido da linha, pela proximidade do valor, com a diferença e o que ela
   vira. Um título abre a baixa real; vários, quando a soma bate, baixam e
   conciliam juntos.
6. **Corrigir a baixa** (a baixa feita à mão que não bate): a tabela "Baixa
   registrada | Fica (como no banco)", para onde vai a diferença, o motivo
   (pelo menos 10 caracteres, com sugestões) e "Corrigir e conciliar".
   - A diferença vira **juros só no boleto**; no resto muda o valor pago, e
     o título **volta a ter a diferença em aberto** (baixa parcial) (Tiago,
     21/10/2026). O banco maior que a baixa fora do boleto é recusado: "se era
     outro pagamento, procure o título pela lupa".
   - A correção **cancela a baixa e a refaz** pelas RPCs de sempre
     (`cancelar_baixa_lancamento` e `baixar_parcela_pp` / `baixar_conta_avulsa`
     / `baixar_titulo_receber`), com os mesmos centro, forma e retenções: o
     documento fica no estado que essas funções sabem produzir. O lançamento
     muda de id; por isso o histórico é pelo documento.
   - Vale para a baixa de PP, de avulsa e de nota a receber de um lançamento
     só. A guia de imposto, a remessa, o desembolso e a fatura não se corrigem
     por aqui: cancela-se e baixa-se de novo pela linha.
   - **Histórico da baixa**: de → para, motivo, quem e quando, em
     `baixa_correcoes`, no ⓘ do título e do Extrato, e na auditoria. O
     desfazer marca a correção como desfeita.
7. **Lançar pela regra** ("Lançar" e "Lançar as N"): um lançamento `manual`
   com o centro de custo e a empresa da regra, já conciliado; a regra conta
   mais um uso.
8. **Registrar as duas** (saiu e voltou, M3.6 A): as duas pernas, origem
   nova `devolucao_bancaria`, sem empresa e sem plano, fora do DRE como a
   transferência; o título continua a pagar.
9. **Lançar avulso** (sem correspondência): o formulário de criação de
   sempre — o pagamento avulso ou o recebimento avulso — já com a descrição,
   o valor e a data da linha. "Criar e dar baixa" abre a baixa real com os
   dados do banco, e a linha se concilia. Depois, o aviso oferece **Lembrar
   como regra**: o começo do histórico, o centro, o subtipo e a empresa (os
   do avulso), para esta conta ou para todas.
10. **Ignorar** a linha que não entra no extrato do sistema.
11. **Desfazer** (em Conciliados, e na baixa feita à mão que bateu):
    - a ligação volta as datas de antes;
    - a baixa nascida na conciliação é **cancelada** pelas actions de sempre
      (`cancelarBaixa`, `cancelarBaixaImposto`), e o título volta a aberto;
    - a correção cancela a baixa corrigida e refaz a de antes;
    - a regra e o "saiu e voltou" apagam os lançamentos que criaram;
    - o grupo de linhas iguais e o par do "saiu e voltou" se desfazem juntos;
    - a linha desfeita não se resolve mais sozinha (`sem_auto`).
12. **Baixa no sistema, sem linha no banco**: "Cancelar a baixa", com o
    motivo, e a lupa, que abre o Extrato com a baixa em destaque para trocar
    a conta ou a data.
13. Os botões das seções: "Conciliar as N", "Baixar e conciliar os N",
    "Aceitar as N sugestões como estão" e "Lançar as N", uma linha depois da
    outra; a que não vai pelo lote fica para conferir uma a uma.

### A data do banco em tudo (Tiago, 21/10/2026)

14. Ao conciliar, as baixas passam à **data do banco** em tudo: o lançamento,
    os juros dele, a perna da conta-espelho no pagamento da fatura e o dia em
    que o documento foi pago — o da última baixa viva da parcela da PP, da
    PP, da avulsa, da nota, do imposto, do desembolso e do estorno de verba
    (`_mudar_data_do_lancamento`). A data de antes fica guardada e o desfazer
    a devolve. Efeito aceito: a apuração fiscal usa a data da baixa, e uma
    baixa de 31/10 que o banco mostra em 03/11 leva a retenção para novembro.
15. A transferência troca só a perna desta conta (`transferida_em` fica):
    cada perna se concilia no extrato da conta dela.

### Cancelar a baixa conciliada (M3.8 A)

16. O cancelar continua o mesmo; o formulário avisa: "Esta baixa está
    conciliada com a linha do extrato do banco de dd/mm (R$ X). Cancelar
    desfaz a conciliação: a linha volta para a Conciliação automática da
    conta e não se resolve mais sozinha." O gatilho da decisão 199 desliga a
    linha.

## Mudanças em tabela compartilhada (confirmadas pelo Tiago)

- **As três travas de `lancamentos_financeiros`** ganharam o ramo de
  `devolucao_bancaria` (sem empresa, sem plano, sem documento), sem mudar as
  regras existentes (M3.6 A).
- **A policy de leitura** `lancamentos_select` ganhou o ramo "devolução
  bancária sem empresa, para admin e financeiro", igual ao da perna de
  transferência; sem ele as duas pernas ficariam invisíveis para todo mundo
  (o saldo não muda: elas se anulam). Os dois ramos de antes ficaram iguais,
  com `(select auth.uid())`.
- O valor novo do enum foi numa migration só dele.

## Como ficou no banco

- `extrato_linhas` ganhou `conciliada_como` (ligacao, baixa, avulso, regra,
  par, correcao), `conciliada_em`, `conciliada_por`, `desfazer` (as datas de
  antes, a correção, a regra) e `grupo`; o gatilho que desliga a linha limpa
  também essas colunas.
- `baixa_correcoes`: o histórico das correções, pelo documento; leitura de
  admin e financeiro, sem escrita para `authenticated`.
- RPCs, todas `SECURITY DEFINER`, conferindo o papel, a conta, a linha
  pendente e a soma: `conciliar_linha`, `conciliar_linha_pelos_documentos`,
  `corrigir_baixa_pela_conciliacao`, `lancar_pela_regra`,
  `criar_regra_do_extrato`, `registrar_saiu_e_voltou`, `ignorar_linha` e
  `desfazer_conciliacao`. Cada uma grava na auditoria (`extrato.conciliado`,
  `extrato.baixa_corrigida`, `extrato.lancado_pela_regra`,
  `extrato.regra_criada`, `extrato.saiu_e_voltou`, `extrato.linha_ignorada`,
  `extrato.conciliacao_desfeita`).
- A 20261021700005 corrige `lancar_pela_regra`: a natureza ia como texto e o
  insert recusava (achado no teste, antes de qualquer uso).

## Como foi conferido

- No banco, numa transação desfeita no fim, como financeiro: ligar e
  desfazer; a baixa de 18/10 conciliada com a linha de 20/10 (o lançamento, a
  parcela e a PP passaram a 20/10, e o desfazer voltou a 18/10); o desfazer
  da baixa nascida na conciliação devolvendo o cancelamento; a correção no
  boleto (R$ 4.005,00 com R$ 5,00 de juros → R$ 4.000,00, juros apagados,
  parcela paga em 20/10, histórico gravado) e o desfazer dela; a correção no
  PIX (R$ 100,00 → R$ 99,50, o título com R$ 200,50 em aberto); a recusa do
  banco maior no PIX e do motivo curto; a soma que não bate; a regra (o
  lançamento, os usos, o desfazer); o "saiu e voltou" visível pela policy
  nova; ignorar e desfazer; o GP recusado e sem ver as correções.
- No navegador, na Conta Teste, com o OFX de teste: Conciliar (a baixa à mão
  da PP-00261); "Lançar as 2" (tarifa e IOF); "Registrar as duas"; ignorar;
  o "Corrigir a baixa" recusando o PIX a mais; o "Conferir" da PP-00102
  abrindo a baixa real com 20/10, Conta Teste, PIX e R$ 300,00, e a linha
  conciliada depois; a baixa à mão da PP-00079 (boleto, R$ 4.000,00 + R$ 5,00
  de juros, em 21/10) caindo em "A baixa não bate", corrigida pela tela, com o
  "Histórico da baixa" no ⓘ do Extrato e o aviso de conciliada no cancelar;
  o desfazer de cada uma. No fim, a PP-00079 e a PP-00102 voltaram a
  aprovadas, sem baixa, e nenhuma linha ficou resolvida.
- Testes: `conciliacao/motor-da-conta.test.ts` (os textos da linha
  resolvida por como ela se conciliou, a correção, a regra).

## Pendências

1. **"Lembrar como regra" só depois do avulso.** Não há tela para listar,
   editar ou desativar regras.
2. **A correção da guia de imposto, da remessa e da fatura** não existe:
   cancela-se e baixa-se de novo pela linha.
3. **A transferência** conciliada com data diferente troca só a perna desta
   conta.
