# 099 — O save passa pela aprovação do financeiro, linha a linha

**Data:** 2026-09-22
**Decidido por:** Tiago (regras fechadas entre 21 e 22/09/2026, sobre o
protótipo clicável aprovado)
**Migrations:** `20260922140001_aprovacao_de_save.sql`,
`20260922140002_financeiro_ve_save_na_aprovacao.sql`,
`20260922140003_aprovacao_de_save_em_vigor.sql` (aplicada junto do deploy),
`20260922140004_saldo_de_save_em_reais.sql`,
`20260922140005_rentabilidade_volta_ao_original.sql`,
`20260922140006_retirar_save_nao_enviado.sql`,
`20260922140007_recusa_de_save_com_errata.sql`.

Revê a [028](028-save-entre-jobs.md) na nota de 01/09/2026 (o saldo de save
só era oferecido depois do envio do job ao faturamento). O resto da 028 —
o que o save é, a conta, o saldo do job — continua valendo.

---

## 1. O problema

Qualquer GP marcava uma linha como save e, no envio para faturamento, o
crédito passava a existir para os outros jobs do cliente. Ninguém do
financeiro conferia se aquilo era mesmo save, e o consumo desse crédito por
outro job também não passava por ninguém. O save move dinheiro entre jobs:
precisa de dono.

## 2. A regra

1. **Cada linha que gera save e cada linha que consome save é um pedido**
   de aprovação (`saves_aprovacoes`). Só administrador ou financeiro decide.
2. **De onde vem o pedido:**
   - save ou consumo definido no **orçamento** segue com o envio para
     abertura e entra na fila quando o financeiro registra a abertura
     (momento `abertura`; `reenvio` no job devolvido e reenviado);
   - no **job aberto**, a errata de save vira pedido na hora e põe o job
     na revisão da abertura (momento `job_aberto`);
   - job aberto antes deste fluxo: botão **"Enviar N saves para
     aprovação"** acima da planilha (`legado_botao`);
   - job encerrado/finalizado ou já enviado ao faturamento: aprovado na
     migration (`legado_migracao`). Em 22/09/2026: JOB-0032 · Item 6.
3. **Números:** a produção vê o pedido **na hora** (planilha, cabeçalho e
   Totais calculam pelos itens); o financeiro vê **só na aprovação** — os
   espelhos `jobs.valor_total`, `faturamento_previsto` e
   `faturamento_save_previsto`, e o fluxo de caixa, não mudam por um pedido
   `job_aberto` que aguarda. A conta "como o financeiro vê" é uma só:
   `lib/calculos/save-financeiro.ts` (TypeScript) e
   `vw_itens_orcado_financeiro` / `vw_saves_consumos_financeiro` (banco).
4. **Recusa** desfaz só o efeito daquele pedido: a linha volta ao estado de
   logo antes dele. Pedido que o financeiro já contava (abertura, reenvio,
   legado) é errata de save ao ser recusado: os números mudam na hora e o
   job volta para a revisão. A linha recusada continua com o ícone de save
   (sem a hachura) e travada para errata — e, a que gerava save, também
   para PP e BV — até o GP arquivar a recusa ("Retirar").
5. **Saldo** para outros jobs: só save **aprovado**. Consumo que aguarda
   reserva a origem; edição de consumo aprovado reserva o maior entre antes
   e depois até a decisão. Um job nunca consome o próprio saldo.
6. **Aprovar é registrar a revisão da abertura:** "Aprovar save" leva à
   revisão do job no financeiro (`?aba=abertura&aprovarSave=<id>`), e só o
   registro dela aprova.
7. **Retirar:** sempre com aviso. Save gerado até o envio para
   encerramento; consumo até o envio para faturamento (mensal: por mês).
   Save aprovado cujo saldo já começou a ser usado não sai. Retirar um
   aprovado é errata de save, com os números do financeiro na hora.
8. **Depois do envio ao faturamento** gerar save continua possível;
   consumir não.
9. **Travas:** errata travada nas linhas com save; gerar save exige a linha
   sem PP e sem BV não cancelados; PP e BV travados na linha que gera save;
   encerramento travado com save pendente ou não enviado e com revisão
   pendente; envio para faturamento travado com consumo aguardando ou
   nunca enviado para aprovação.
10. **Links entre módulos:** saem os da produção para o financeiro e os
    redirects do financeiro para `/jobs`. Os do orçamento ficam.

Textos aprovados, estados do pop-up e o contrato completo:
`docs/handoffs/HANDOFF_JOBS.md` e `HANDOFF_FINANCEIRO.md` (notas de
22/09/2026).

## 3. Onde a regra mora no banco

- `saves_aprovacoes` é **só leitura** para o cliente. Tudo muda por RPC
  SECURITY DEFINER, numa transação só com a linha, a errata e os números:
  `save_pedir`, `save_enviar_pendentes`, `decidir_pedido_save`,
  `cancelar_pedido_save`, `save_retirar`, `save_retirar_nao_enviado`.
  O fluxo antigo gravava a errata antes da linha e, quando a linha
  falhava, deixava errata fantasma.
- Em job aberto, a marca de save e o consumo da linha só mudam pelas RPCs
  (a partir da `20260922140003`); em pré-abertura e job devolvido a cópia
  segue editável direto.
- `save_uso_linhas` é a conta do saldo usada pela tela e pelo trigger, fora
  da RLS do pedido — senão um GP de outra regional via mais saldo do que o
  banco aceita.
- `save_marcado_por`, `save_marcado_em` e `planejado_antes_save` nas linhas:
  quem marcou e o planejado que o save zerou, devolvido quando o save sai.

## 4. Decisões tomadas na implementação (confirmadas pelo Tiago em 22/09/2026)

- **Consumo de rascunho** não conta como uso para a trava de retirada
  (segue a 028: rascunho reserva e avisa, não impede). A aprovação da
  versão revalida o saldo e recusa se o crédito tiver saído.
- **PP e BV** travam só na linha que **gera** save; a linha que consome é
  serviço que acontece no job e continua aceitando PP e BV.
- **Permissão de aprovar:** a mesma de registrar a abertura
  (`jobs.abrir_financeiro`), porque aprovar é registrar a revisão.

## 5. Fora desta entrega

- **Regra 21 — nota já emitida:** a aprovação ou retirada de save depois da
  nota deveria redividir job × save nos títulos EM ABERTO dela. Não
  implementado: pede desenho próprio (a divisão hoje é derivada de
  `faturamento_itens` em `vw_titulo_partes`, e mudar ali mudaria também os
  títulos recebidos).
- `vw_job_rentabilidade` (relatórios, frente do Antonio) segue lendo a
  linha crua: durante um pedido aguardando, o relatório já tira a linha do
  imposto previsto e do custo, com o faturamento previsto antigo. A troca
  foi feita e desfeita no mesmo dia (`20260922140005`); a decisão é do
  Tiago com o Antonio.
