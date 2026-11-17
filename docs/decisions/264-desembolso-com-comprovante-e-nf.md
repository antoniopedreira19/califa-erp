# 264 — O pedido de desembolso com comprovante, a NF no cadastro de notas e a conferência no formato da PP

**Data:** 2026-11-17
**Status:** aceita e implementada em 17/11/2026.
**Quem decidiu:** Tiago, sobre o protótipo interativo dos desembolsos (16 e
17/11/2026, rodadas comentadas no próprio protótipo), com a versão C ("sem
documento") recomendada e "Pode implementar. Em seguida definimos os pontos
para acertar o controle de NFs".
**Relacionadas:** [077](077-o-prazo-da-pp-cai-em-janela-e-a-pp-pode-ser-urgente.md)
e [157](157-prazo-de-envio-da-pp.md) (janelas e prazo de envio),
[172](172-quarta-de-excecoes-na-pp-urgente.md) (quarta de exceções),
[152](152-nf-do-fornecedor-com-cadastro-proprio.md) (cadastro único de notas),
[187](187-pp-de-reembolso.md) (comprovantes do reembolso),
[192](192-ia-le-o-anexo-da-pp-ao-anexar.md) (leitura por IA),
[093](093-o-item-entra-na-fatura-na-confirmacao-do-pagamento.md) (intenção de
pagamento na aprovação), [085](085-a-tela-principal-ocupa-a-largura-do-layout.md)
(largura das telas).
**Migrations:** `20261117300001_desembolso_com_comprovante_e_nf.sql`,
`20261117300002_minha_alocacao_vigente.sql`,
`20261117300003_notas_do_fornecedor_com_tipo.sql`.

## O problema

O desembolso ia ao financeiro sem comprovante: o anexo era opcional e o
bucket para onde a tela mandava os arquivos nunca existiu (o único pedido da
produção, DES-00001, ficou sem anexo). A regra "cada um vê só os seus" estava
só na tela, qualquer pessoa com acesso à empresa podia mudar o status pela
API, e a NF do desembolso não entrava no controle de notas: a mesma nota
podia pagar uma PP e um desembolso sem ninguém perceber.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | Sem documento | O pedido não gera PDF próprio (versão C). O financeiro confere o **comprovante ao lado dos dados**, numa tela cheia como a da PP. |
| D2 | Só os seus | O módulo **Desembolsos** mostra a cada pessoa só os pedidos dela, em qualquer papel. Administrador e financeiro conferem os de todos em **Contas a Pagar › Desembolsos**. A policy de leitura do banco passou a exigir isso, e a dos anexos também. |
| D3 | O formulário | Pop-up vertical em quatro partes: **O que é** (descrição; empresa e regional da alocação no RH, com "Trocar"), **Quem recebe** (fornecedor ou "Eu (reembolso)"), **Quanto e quando** (valor, data de pagamento, parcelas, urgência), **Comprovante**. |
| D4 | Data de pagamento | A regra da PP: janelas 08 e 20 com o envio até 15 dias antes; com **pagamento urgente**, também a quarta de exceções até a sexta anterior. A urgência pede **justificativa** (mín. 10 caracteres). O servidor confere de novo. |
| D5 | Comprovante obrigatório | Sem comprovante o pedido não vai, e o financeiro não aprova (gatilho no banco). As peças são as do anexo da PP: tipo obrigatório, vários arquivos, "Visualizar anexos" num pop-up com a navegação 1, 2, 3 da PP. No reembolso, cada comprovante com número, data e valor, e a soma fecha o pedido (como a 187). |
| D6 | A NF no cadastro único | A NF do fornecedor é **reconhecida pelo número** no mesmo cadastro das PPs (152) e entra nele no envio. O **saldo da nota** soma PPs e desembolsos: a nota inteira em outro documento não se usa de novo, e a parte deste pedido vai até o que sobra. Na aprovação, a nota é **registrada** no controle de notas. |
| D7 | Rejeitar e corrigir | O financeiro rejeita com motivo. Quem pediu vê "Rejeitado <data>", clica em **Corrigir** (botão fora da tabela, ao lado da linha) e reenvia com o mesmo código. O histórico guarda a rejeição. |
| D8 | Cancelar | Quem pediu cancela o próprio pedido enquanto o financeiro não decidiu (em avaliação ou rejeitado). |
| D9 | A lista do financeiro | Grade fixa: Código, Valor, Parcela ("1/N"), Descrição, Quem recebe, Enviado por, Regional, Pagamento, Status. Sem botões na linha; os urgentes que esperam o financeiro sobem para a seção **Urgentes**, como na lista de PPs. Filtro por coluna. |
| D10 | A aprovação | Pop-up no formato do "Aprovar PP": a data de pagamento e **como vai ser pago** (forma e cartão, a intenção da 093). Reverter a aprovação segue o caminho de hoje. |
| D11 | Quem decide | Um gatilho no status deixa aprovar, rejeitar, pagar e reverter só com o financeiro e o administrador; quem pediu só reenvia o rejeitado ou cancela o próprio. Vale para todo caminho, inclusive a API. |

## Fica para a etapa do controle de NFs

Combinado com o Tiago: o controle único de NFs de todas as origens (folha,
lançamentos avulsos, recorrências, prestação da verba) é a próxima conversa.
Por isso, nesta entrega:

- As **retenções** e o **crédito de PIS/COFINS** na aprovação do desembolso
  ficam para lá (o protótipo os mostrava). O **centro de custo** continua na
  baixa.
- A NF do **reembolso** (nota emitida para a California, paga por quem pediu)
  não entra no cadastro de notas: falta decidir quem é o emitente.
- A correção da NF pelo financeiro na tela de conferência também fica para
  lá: com a NF errada, ele rejeita para quem pediu corrigir.

## Perguntas em aberto (com o Tiago)

Adiantamento; a conta do reembolso (a do cadastro no RH); orçamento e contrato
valem como comprovante; o nome de quem pede no título do reembolso; trocar a
empresa da alocação (hoje permitido); quem não tem regional na alocação ou usa
o rateio da empresa (hoje escolhe a regional no pedido); o prazo de 15 dias
para o reembolso.

## Como ficou no banco

- `desembolsos`: `favorecido_tipo`, `enviado_em`, `reenviado_em`, `urgente`,
  `urgente_justificativa` (com check da justificativa).
- `desembolsos_anexos`: o tipo do arquivo, os dados da NF (`nf_data_emissao`,
  `nf_valor`, `nf_tomador_estabelecimento_id`), a parte no pedido
  (`nf_valor_no_pedido`) e a nota (`nota_fiscal_id`).
- `notas_fiscais_fornecedor.registrada_no_desembolso_id`.
- `salvar_pedido_de_desembolso` (envia e reenvia numa transação: pedido,
  parcelas, rateio, anexos, nota e saldo); `aprovar_pedido_de_desembolso`;
  `_conferir_partes_da_nota` e `notas_fiscais_do_fornecedor` passam a contar
  os desembolsos (a lista diz o `tipo` de cada uso); `minha_alocacao_vigente`
  (a alocação de quem pede, sem abrir a tabela do RH); o gatilho
  `trg_desembolso_status_pelo_papel`.
- Os arquivos vão para o bucket `pedidos-compra`, em `<tenant>/desembolsos/…`.
- Na produção há um pedido (DES-00001, em avaliação, sem anexo nem
  fornecedor, que virou reembolso). Ele não se aprova sem comprovante: o
  financeiro rejeita para quem pediu anexar.
