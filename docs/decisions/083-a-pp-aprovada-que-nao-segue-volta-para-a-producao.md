# 083 — A PP aprovada que não segue volta para a produção

**Data:** 2026-09-15
**Decidido por:** Tiago
**Migration:** `20260915230001_pp_aprovada_volta_para_a_producao.sql`

Fecha a última pendência da conversa de 14/09/2026 sobre PP e verba, ao lado
da [081](081-a-producao-presta-contas-da-verba-e-o-financeiro-aprova.md).

---

## 1. O problema

A PP aprovada **é título a pagar** ([027](027-pp-aprovada-e-a-composicao-do-fluxo-do-job.md)):
as parcelas entram em Títulos a Pagar e no fluxo de caixa. Por isso a
produção não a cancela — a trava existe desde 14/09/2026 e a mensagem manda
falar com o financeiro. Só que o financeiro não tinha para onde mandá-la de
volta: a rejeição só alcança PP **em avaliação**.

Existia no banco a `desaprovar_pp` (18/08/2026), sem tela nenhuma, usada uma
única vez. Ela devolvia a PP para *em avaliação* e deixava três pontas
soltas: aceitava PP com parcela já paga, mantinha a parcela dentro da fatura
do cartão e não apagava as escolhas da aprovação. Como toda função liberada
para `authenticated`, era chamável direto do navegador.

## 2. A regra

> **O financeiro apenas reprova.** A PP aprovada que não deve seguir volta
> para `rejeitada`, com motivo — a mesma caixa da rejeição de quem estava em
> avaliação. Quem decide o que fazer depois é a produção: corrige e reenvia,
> ou cancela.

- **Destino:** `rejeitada` (1a). O financeiro não cancela a PP da produção, e
  a produção continua sem cancelar PP aprovada.
- **Parcela paga trava (2a).** A PP com qualquer parcela baixada não é
  reprovada: o dinheiro saiu, e desfazer isso é estorno de baixa. A aprovação
  é uma só e joga **todas** as parcelas em Títulos a Pagar; desfazê-la pela
  metade seria outra coisa.
- **Cartão (3a).** Reprovar tira as parcelas da fatura **aberta**. Se a
  fatura estiver fechada, paga ou cancelada, a reprovação é recusada com o
  código da fatura — o financeiro reabre antes, porque tirar parcela de
  fatura fechada muda um valor já cobrado.
- **As datas voltam (4a).** As datas que o financeiro escolheu na aprovação
  são apagadas; o **vencimento negociado com o fornecedor** fica, e a
  produção pode mudá-lo na correção, dentro das janelas
  ([077](077-o-prazo-da-pp-cai-em-janela-e-a-pp-pode-ser-urgente.md)). Saem
  junto a forma de pagamento, o cartão, o plano de contas e os documentos
  congelados na aprovação ([070](070-a-pp-congela-os-documentos-da-aprovacao.md)),
  porque a PP volta a aceitar anexo.
- **Motivo obrigatório (5a):** mínimo de 10 caracteres, como na rejeição.
- **Quem (6a):** financeiro e administrador — a mesma porta da aprovação. O
  papel é conferido também dentro da função do banco, e não só na tela.
- **A PP rejeitada passa a travar o encerramento do job (8b).** Ela voltou a
  ser pendência da produção; enquanto ninguém reenviar ou cancelar, o job não
  fecha. Só a **cancelada** fica fora da conta.

## 3. Onde fica

- Tela cheia da PP no financeiro (aba Pedidos de Produção → filtro
  "Aprovadas"): rodapé com **"Reprovar PP"** e o pop-up de motivo, ao lado da
  frase que lembra que a PP já é título.
- A PP reprovada volta à aba de PPs do job como rejeitada, com o botão de
  corrigir e reenviar que já existia — o mesmo caminho da rejeição comum.

## 4. Banco

`20260915230001_pp_aprovada_volta_para_a_producao.sql`:

- **remove** `desaprovar_pp`;
- cria `reprovar_pp_aprovada(p_pp_id, p_motivo)`, que checa papel, status,
  parcela paga e fatura não aberta, desfaz as datas e as escolhas da
  aprovação, solta a parcela da fatura aberta e grava
  `rejeitada_por`/`rejeitada_em`/`motivo_rejeicao`;
- GRANT para `authenticated`, nada para `anon`.

A `vw_a_pagar` e a `vw_fluxo_caixa` não mudam: elas já leem só `aprovada` e
`pago`, então a PP sai dos títulos e do fluxo sozinha.

## 5. Conferido em 15/09/2026

**Servidor, em transação desfeita** (PP-00011, 12 parcelas, com cartão):

- GP Teste foi recusado pelo papel; motivo de 5 caracteres, recusado.
- Com 10 parcelas pagas: "A PP já tem 10 parcela(s) paga(s). Estorne as
  baixas antes de reprovar."
- Sem baixas, mas com a parcela na fatura FC-00002 fechada: "Uma parcela está
  na fatura FC-00002 do cartão, que não está aberta. Reabra a fatura antes de
  reprovar."
- Com a fatura aberta e sem baixas, passou: status `rejeitada`, motivo
  gravado, aprovação desfeita (datas, forma, cartão, plano, documentos
  congelados), os 12 vencimentos negociados preservados e as 12 datas de
  pagamento zeradas — a primeira data só passou a sair depois da migration
  `230002`, porque a trigger a devolvia em silêncio.

**Pela tela** (Projeto Teste · JOB-0029 · PP-00065, R$ 250,00, fornecedor
Airbnb Brasil, com anexo):

- Aprovada para 21/09: virou título em Títulos a Pagar. No rodapé da PP
  aprovada apareceu "Reprovar PP", com a frase de que ela já é título.
- Reprovada com motivo: saiu de Títulos a Pagar (nenhuma linha em
  `vw_a_pagar`), voltou à aba de PPs do job como **Rejeitado**, e o banco
  mostrou a aprovação desfeita e a auditoria `pedido_compra.reprovada`.
- O resumo de fechamento passou a listar "4 PPs em aberto: PP-00065,
  PP-00059, PP-00057, PP-00056", com a orientação nova.
- A produção abriu a correção, viu o motivo, **trocou o prazo** de 21/09 para
  a janela de 08/10 e reenviou: a PP voltou para "em avaliação", com o
  vencimento 08/10 e sem nenhuma data do financeiro.
- **Ajuste que o teste pediu:** o dossiê da PP aprovada dizia "sem ação do
  financeiro nesta tela" — agora explica o caminho de volta.

**Não conferido pela tela:** a recusa por fatura de cartão (só pelo banco,
com rollback), porque não há fatura fechada com PP no projeto de teste.

## 6. O que ficou de fora

- **Reenviar PP de verba de produção** (7b): o formulário de correção
  pressupõe fornecedor, e a verba rejeitada hoje manda cancelar e emitir
  outra. O Tiago pediu que a verba seja reenviada de maneira análoga às PPs
  normais — entra como trabalho próprio, logo em seguida.
- A revisão maior do encerramento e do faturamento, que segue pendente.
