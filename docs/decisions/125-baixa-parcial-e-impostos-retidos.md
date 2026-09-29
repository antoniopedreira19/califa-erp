# 125 — Baixa parcial e impostos retidos na baixa, nas duas pontas

**Data:** 2026-09-28 (decisões) · 2026-09-29 (implementação)
**Decidido por:** Tiago
**Migrations:** `20260929800001_baixa_parcial_e_retencoes.sql` e
`20260929800002_views_projetam_o_que_falta.sql`
**Protótipo aprovado:** seções 3 e 4 de https://claude.ai/artifact/AXDeLzhBNzNWyvao8S9gZ7 (versão 4)

---

## 1. O que o Tiago pediu

> Baixa parcial. E informar os impostos retidos na baixa (ISS, PIS,
> COFINS, CSLL, IRRF) — no recebimento e depois também no pagamento.

É a entrega 3 da série de lançamentos e baixas (decisões 120 e 124). A
entrega foi dividida em duas:

- **3a — banco inteiro + Títulos a Receber** (esta data).
- **3b — Títulos a Pagar**, detalhe da avulsa e remessa CNAB (a seguir).

## 2. As regras

| Pergunta | Resposta do Tiago |
|---|---|
| Como se informa a baixa? (v4) | **Um valor só, "Valor a dar baixa"**, travado no que falta; a chave **"Baixa parcial"** libera a edição e o restante continua em aberto. Sem "valor que entrou na conta" à parte: a base dos impostos é o próprio valor a dar baixa. |
| Retenção (v4) | Chave "O cliente reteve impostos na fonte" (receber) / "Reter impostos na fonte" (pagar), com ISS, PIS, COFINS, CSLL e IRRF, cada um por alíquota ⇄ valor, terminando em **valor total − impostos retidos = valor líquido**. |
| INSS? (D6 1a) | **Não**, por enquanto. |
| Alíquotas (D6 2a) | **Em branco**, com o botão **"Repetir as alíquotas da {NF/PP/AV} ({data})"**, da última retenção do mesmo cliente ou fornecedor. |
| Pagou a mais (D13) | A baixa vai **até o que falta**; a diferença entra como **recebimento avulso** (decisão 124), e a devolução é o estorno dele. |
| Título pago pela remessa (D15) | **Pendente** (ele ainda vai definir como a retenção entra no título antes da remessa). **Interino (a):** documento que já foi para uma remessa CNAB só aceita a baixa do que falta, sem retenção — "Pago pela remessa com o valor cheio". |
| Estrutura (D17.1) | Autorizado: baixas em estrutura própria, sem a trava de uma baixa por título. **Revisto em 29/09** (abaixo, "todas como recomendado"). |
| Folha (P1) | **Só o valor inteiro, sem retenção**, como o desembolso: INSS e IR já saem no cálculo da folha. |
| Devolução de verba (P2) | **Só o valor inteiro, sem retenção**: é dinheiro voltando, não é serviço. |
| PP de verba de produção (P3) | **Só o valor inteiro, sem retenção**: a prestação de contas começa quando a verba está paga. |
| Recebimento avulso (P4) | **Parcial e retenção**, como o avulso do pagar. Rendimento e transferência ficam sempre no valor inteiro, sem retenção. |
| Título parcial que entra numa remessa (P5) | **A remessa leva só o que falta pagar** (entrega 3b). |
| Imposto retido no pagamento (P6) | **Só registrado**, imposto por imposto, para o módulo fiscal — sem título da guia. Risco aceito: até o módulo fiscal, a guia do ISS/DARF não aparece em Títulos a Pagar nem no fluxo de caixa (lança-se pelo Lançamento avulso). |
| Desembolso, fatura de cartão, item no cartão (v4) | **Só o valor inteiro, sem retenção.** "No cartão, a baixa é sempre do valor inteiro: o item entra inteiro na fatura." |

## 3. Como ficou

### A baixa continua sendo o lançamento (revisão da D17.1)

A proposta da D17 era copiar as baixas para uma tabela própria. No banco,
a baixa **já é** uma linha de `lancamentos_financeiros` por documento
(`titulo_receber_id`, `pedido_compra_parcela_id`, `conta_avulsa_id`): uma
tabela de baixas duplicaria o lançamento. O Tiago aprovou em 29/09:

- a baixa segue sendo o lançamento, com o **valor líquido** — o que entrou
  ou saiu da conta, e é o que o extrato mostra;
- tabela nova **`baixas_retencoes`** (imposto, alíquota, valor), pendurada
  no lançamento, com FK em cascata: cancelar a baixa leva os retidos junto;
- **valor a dar baixa = líquido + retidos**, e é ele que quita o documento;
- saem os índices `uniq_baixa_ativa_por_titulo`, `_por_parcela` e
  `_por_avulsa`; a concorrência passa a ser segurada pelo `for update` no
  documento. Ficam os de desembolso, PP sem parcela, fatura e
  transferência (continuam com uma baixa só);
- **nenhum dado copiado ou reescrito**.

### Quando o documento vira pago

Título a receber `pago`, parcela de PP com `pago_em`, avulsa `baixada` —
só quando a soma das baixas chega ao valor dele. `pago_em`, a conta e o
`lancamento_id` do título são os da baixa que quitou. Antes disso ele fica
em aberto, e **o que falta = valor − soma das baixas** (líquido + retidos).
Estorno não entra na conta: é transação nova, não desfaz a baixa
(decisão 120).

### Funções

| Função | O que faz |
|---|---|
| `baixar_titulo_receber(…, p_valor_baixa, p_retencoes)` | Baixa (parcial) do título a receber. Sem valor, baixa tudo o que falta. |
| `baixar_conta_avulsa(…, p_valor_baixa, p_retencoes)` | Avulso, recorrência, folha, recebimento avulso, rendimento. Recusa parcial/retenção em rendimento, folha, cartão e documento em remessa. |
| `baixar_parcela_pp(…, p_valor_baixa, p_retencoes)` | Parcela de PP. Recusa parcial/retenção em PP de verba, cartão e remessa. |
| `cancelar_baixa_lancamento(p_lancamento_id, p_motivo)` | Cancela **uma** baixa: apaga o lançamento, os estornos e os retidos dela, e reabre o documento (parcial, se sobrar baixa). |

- Todas exigem **administrador ou financeiro** no servidor (as de baixa
  antigas aceitavam qualquer membro do tenant; as actions já barravam).
- As antigas mantêm a assinatura e **delegam**: `dar_baixa_titulo_com_plano`,
  `dar_baixa_avulsa_com_plano`, `dar_baixa_avulsa` e `dar_baixa_pp_parcela`
  baixam o que falta (antes lançariam o valor cheio de novo num documento
  parcial); `cancelar_baixa_titulo_receber`, `_pp_parcela` e `_avulsa`
  cancelam a baixa mais recente.
- Travas que só olhavam "pago" passam a ver a baixa parcial: cancelar a NF
  (`cancelar_faturamento`), reprovar PP aprovada, mandar a PP para o cartão
  e excluir o recebimento avulso.
- Parcela ou avulsa com baixa parcial não vai para o cartão (a fatura
  levaria o valor cheio).

### Views

- `vw_a_pagar` e `vw_fluxo_caixa` projetam **só o que falta** do
  documento em aberto (título: parte própria e parte em save, na
  proporção; parcela de PP; avulsa e recorrência). O retido não volta ao
  previsto. `vw_fluxo_caixa_job_totais` acompanha.
- Novas, `security_invoker`: `vw_baixado_por_documento` (líquido, retido,
  baixado, quantas baixas) e `vw_retencao_mais_recente` (o "Repetir").

### Tela — Títulos a Receber (3a)

- Situação nova **Parcial** (azul), com chip próprio. Vem antes de
  Inadimplente: o cliente já começou a pagar.
- Linha parcial: data da última baixa (e "N baixas"), "recebido R$ X ·
  falta R$ Y", "R$ Z retidos", o "Dar baixa" do restante e o olho.
- Diálogo de baixa: data e conta lado a lado, o bloco **Valor a dar
  baixa** (`components/financeiro/valor-da-baixa.tsx`, o mesmo das duas
  pontas) e o centro de custo. Botão "Confirmar baixa parcial" quando
  sobra saldo. Rendimento: parcial desligada com o motivo, sem retenção.
- Popup do olho (`BaixaRegistradaDialog`): **"Baixas registradas · N"**,
  um cartão por baixa (entrou na conta, impostos retidos, centro de custo,
  estornos) com **Estornar** — até o líquido daquela baixa — e **Cancelar
  esta baixa**; situação "Parcial · falta R$ X" e **"Dar baixa no
  restante"**.
- Recebimento avulso com baixa não mostra a lixeira: cancela as baixas
  antes.
- Home: o "previsto a receber" do mês desconta as baixas parciais.

## 4. Conferência

- SQL com rollback, como administrador e como GP: parcial com ISS e IRRF,
  valor acima do que falta, retido maior que o valor, INSS recusado, NF
  que não cancela, função antiga baixando o restante, título quitado que
  recusa baixa, cancelamento reabrindo e levando os retidos; no pagar,
  parcela parcial, cartão/reprovar/rotear barrados, PP que vira paga e
  volta, remessa e PP de verba só no valor inteiro, GP barrado.
- Navegador (Chrome do Tiago, 29/09), TES-1001/26 NF 1 parcela 2/2 na Conta
  Teste: parcial de R$ 20.000 com ISS 5% e IRRF 1,5% (líquido R$ 18.700),
  "Dar baixa no restante" com "Repetir as alíquotas da NF 1", título
  quitado com 2 baixas, cancelamento de cada uma até voltar a Em aberto;
  recebimento avulso AV-00005 parcial com ISS, cancelado e excluído. Banco
  sem dado de teste no fim.

## 5. Pendências

- **D15**: como a retenção entra no título antes da remessa. Até lá, o
  interino acima.
- **Esteira de faturamento**: `valor_recebido` (`lib/calculos/esteira-faturamento.ts`)
  ainda soma só título pago pelo valor cheio. Hoje não aparece em tela.
- **Guia do imposto retido no pagar (P6)**: fica para o módulo fiscal.
