# 269 — A NF da prestação de contas da verba entra no cadastro de notas no envio

**Data:** 2026-11-23
**Status:** aceita e implementada em 23/11/2026.
**Quem decidiu:** Tiago, nos pontos do controle único de NFs (protótipo
"Notas Fiscais" da Central Financeira, ponto 3 · prestação), com a resposta
"Ligar no envio".
**Revê:** a [189](189-prestacao-de-contas-da-verba-documento-a-documento.md)
no momento em que a NF da loja entra no cadastro de notas (antes, só na
aprovação da prestação). O resto da 189 continua.
**Relaciona-se com:** [152](152-nf-do-fornecedor-com-cadastro-proprio.md)
(cadastro único de notas) e [264](264-desembolso-com-comprovante-e-nf.md)
(a NF do desembolso, que já entra no envio).
**Migrations:** `20261123300001_prestacao_liga_a_nf_no_envio.sql` e `20261123300002_prestacao_rotulo_no_uso_da_nota.sql` (o rótulo "· prestação"), aplicadas
pelo MCP em 23/11/2026.

## O problema

A NF da PP e a do desembolso entram no cadastro de notas quando o documento
vai ao financeiro, e o saldo da nota é conferido ali. A da prestação da verba
só entrava na aprovação: enquanto a prestação esperava o financeiro, a mesma
nota podia ser usada inteira numa PP ou num desembolso sem aviso, e o
controle de NFs não mostrava as notas das prestações em avaliação.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | Quando entra | No **envio** da prestação ao financeiro (e no reenvio depois de reprovada), cada NF dos documentos é ligada à nota do cadastro, como na PP e no desembolso. |
| D2 | Como acha o fornecedor e a nota | O mesmo casamento da aprovação: o fornecedor pelo CNPJ do emitente; sem cadastro, nasce o fornecedor "sem dados de pagamento". A nota pelo fornecedor + número. A NF sem número ou sem CNPJ do emitente fica sem ligação (como hoje). |
| D3 | O saldo da nota | Soma também as NFs das prestações **enviadas e aprovadas**; a parte é o valor do documento. Passou da nota, o envio não vai e a mensagem diz onde a nota já está. A prestação em rascunho ou reprovada não conta: o envio confere de novo. |
| D4 | A correção do financeiro | Corrigir número, data, valor, tomador ou emitente de uma NF religa a nota corrigida e confere o saldo. |
| D5 | Onde a nota já está | A lista de usos da nota (o aviso do anexo da PP e o controle de NFs) mostra a prestação, como "PP-xxxxx · prestação". |
| D6 | A aprovação | Continua igual: acha a nota já ligada e a registra no controle de notas. |
| D7 | As que já estavam em avaliação | Ligadas na migration: 9 NFs na produção em 23/11 (8 numa PP e 1 em outra), nenhuma estava no cadastro. A do rascunho fica para o envio dela. |

## Como ficou no banco

- `_ligar_notas_da_prestacao(p_prestacao_id)` (security definer: quem envia,
  a produção, não grava em fornecedores nem no cadastro de notas).
- Gatilhos `trg_prestacao_liga_notas_no_envio` (status vai a
  `em_avaliacao`) e `trg_prestacao_religa_nota_corrigida` (correção de uma
  NF da prestação em avaliação).
- `_conferir_partes_da_nota` e `notas_fiscais_do_fornecedor` contam as
  prestações (`tipo` = `prestacao`).
- O tipo `tipo` de `actions-notas-da-pp.ts` ganhou `"prestacao"`; a correção
  pelo anexo da PP continua só para as PPs.

## Conferido

- Na produção, depois da migration: as 9 NFs em avaliação ligadas, a do
  rascunho sem ligação, e todas as 520 notas passam na conferência de saldo.
- No Sandbox, numa transação desfeita no fim: o reenvio de uma prestação
  reprovada liga a NF; a correção do número religa; uma segunda parte que
  passa do valor da nota é recusada com a mensagem de onde ela está.
- No navegador, no Sandbox: o produtor corrigiu e reenviou a prestação da
  PP-00951 com uma NF (fictícia) e ela entrou no cadastro; o GP, num pedido
  de desembolso para o mesmo fornecedor, digitou o número e viu "Esta NF já
  está em PP-00951 · prestação (R$ 30,00)", com os dados vindos do cadastro,
  o aviso de nota inteira em outros documentos e sem a opção de corrigir a
  prestação. A PP-00951 ficou em avaliação.

## Fica como está

- Corrigir o número de uma NF deixa no cadastro a nota do número antigo, sem
  documento. É o mesmo que acontece na PP e no desembolso hoje.
- Risco visto: numa das prestações em avaliação, as 8 NFs têm números de 01
  a 11 em CNPJs diferentes e na mesma data — parecem sequência, não o número
  da nota. Ligadas como foram informadas (a aprovação faria o mesmo); vale o
  financeiro conferir na avaliação.
