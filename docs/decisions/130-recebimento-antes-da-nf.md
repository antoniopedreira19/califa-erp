# 130 — Recebimento antes da NF

**Data:** 2026-09-28 (protótipo) · 2026-09-29 (decisões e implementação)
**Decidido por:** Tiago
**Migrations:** `20260929990001_origem_recebimento_antes_da_nf.sql`,
`20260929990002_recebimento_antes_da_nf.sql` e
`20260929990003_recebimento_antes_da_nf_bv_empresa_do_job.sql`
**Protótipo aprovado:** seção 3 de https://claude.ai/artifact/AXDeLzhBNzNWyvao8S9gZ7 (versão 4)

---

## 1. O que o Tiago pediu

> O cliente pagou e a nota ainda não saiu. O botão fica na linha do job,
> na aba Faturamento. BV não tem — vamos incluir essa possibilidade no
> caso do BV também.

É a entrega 4 da série de lançamentos e baixas (decisões 120, 124 e 125).

## 2. As regras

| Pergunta | Resposta do Tiago |
|---|---|
| Onde nasce | **Na linha da aba Faturamento** (Contas a Receber): a linha da nota do envio (decisão 123) e a do BV. |
| De quem é o dinheiro (E1) | **Do cliente**, não do CNPJ: os CNPJs da nota são subsidiários do cliente. Cada nota do envio (um CNPJ) é uma linha própria, com NF própria; as parcelas da nota são vencimentos daquela NF. O recebimento fica **preso à nota** e vira a parcela 1 dela. No BV, é do fornecedor. |
| Quando (E2 a) | **Só depois do envio para faturamento**: sem envio não há linha. |
| A parcela 1 (E3 a) | **Parcela 1 = o recebido**, já quitada, com a data dele. O resto sai dos vencimentos do envio, com o recebido abatido em ordem, e continua editável. |
| Vários recebimentos (E4 a) | **Viram baixas da parcela 1**, uma para cada. |
| Retenção (E5 a) | **Sem retenção** no recebimento antes da NF. |
| Cancelar a NF (E6 a) | O recebimento **volta para "antes da NF"**, sem sair do extrato. |

## 3. Como ficou

### Banco

- Valor novo no enum `origem_lancamento`: **`recebimento_antes_nf`** (em
  migration própria, como manda o `FLUXO-BANCO.md`). Os CHECKs de origem de
  `lancamentos_financeiros` ganham o ramo dele: exige `job_id`.
- Tabela **`recebimentos_antes_nf`**: um registro por recebimento, preso à
  nota do envio **ou** ao item de BV (CHECK de alvo único), com o lançamento
  dele. Situação `aguardando` → `aplicado` (na emissão) ou `cancelado`. FKs
  para a nota e o BV com `RESTRICT`. RLS: leitura para admin e financeiro;
  escrita só pelas funções.
- **`registrar_recebimento_antes_nf`** (admin ou financeiro): valor até o
  saldo a faturar da linha menos o que já foi recebido antes; conta pela
  `_conta_da_baixa`; centro de custo obrigatório. Lança uma **entrada** com
  origem `recebimento_antes_nf`, o job, a regional do job, o cliente (no BV,
  o fornecedor) e a empresa da nota do envio. O BV não tem empresa na fila
  (quem escolhe é a NF): vale a do job (migration `…990003`). Auditoria
  `recebimento_antes_nf.registrado`.
- **`cancelar_recebimento_antes_nf`**: só o que ainda espera a nota; o
  lançamento sai do extrato, sem linha nova; motivo de 10 caracteres ou
  mais; auditoria `recebimento_antes_nf.cancelado`.
- **`emitir_faturamento`**: soma o que espera nas notas (ou no BV) que a NF
  cobre; recusa se passar do valor da NF ("O recebido antes da NF (R$ X)
  passa do valor desta nota") ou se a parcela 1 não for igual ao recebido.
  Os lançamentos viram `titulo_baixa` da parcela 1, na empresa da NF; a
  parcela nasce paga; o BV vira recebido se não sobrar parcela em aberto.
- **`cancelar_faturamento`** (E6): antes das travas de sempre, devolve os
  lançamentos a `recebimento_antes_nf` (na empresa de origem) e os
  recebimentos a `aguardando`. Recusa se uma dessas baixas tiver estorno.
- **`cancelar_baixa_lancamento`** (decisão 125): a baixa que veio de um
  recebimento antes da NF desfaz o recebimento junto (`cancelado`).
- **`vw_fluxo_caixa`**: a previsão da nota do envio desconta o recebido
  antes, abatido nos vencimentos em ordem (`_antes_nf_abatido_da_parcela`)
  — o dinheiro já está no realizado. O BV pendente não é projetado no fluxo,
  então não precisa de desconto.

### Tela (Contas a Receber)

- **Aba Faturamento:** botão com a mão e a moeda na coluna Ação, antes do
  Faturar, na linha da nota do envio e na do BV, enquanto sobra saldo. O
  diálogo pede data, conta, valor (até o que falta) e centro de custo.
  O recebido aparece como **selo "Recebido antes da NF · R$ X"** abaixo do
  código, que abre a lista, cada recebimento com o seu cancelamento. A
  faixa de resumo ganha "Recebido antes da NF".
- **Faturar:** a parcela 1 vem **travada** (verde, cadeado), com o recebido
  e a data do primeiro recebimento; as outras saem dos vencimentos da nota
  com o recebido abatido em ordem. "2×/3×/6×" repartem só o que falta.
  Faturamento parcial abaixo do recebido é recusado antes de ir ao banco.
- **Títulos a Receber:** as baixas da parcela 1 levam a marca **"Antes da
  NF"** no popup do olho; cancelar uma delas explica que o recebimento é
  desfeito junto (`antesDaNf`, obrigatório em `BaixaDoTitulo`).
- **Extrato e fluxo:** o lançamento sai como "Recebimento antes da NF ·
  código · descrição", com job e centro de custo; na composição do fluxo,
  com o rótulo próprio.

### Desvios do protótipo, de propósito

- **Texto do cancelamento da baixa:** o protótipo dizia "registre de novo
  pela aba Faturamento". Depois da NF emitida, a linha não está mais lá; o
  texto diz "dê a baixa de novo nesta parcela".
- **Centro de custo começa vazio**, como na baixa do título; o protótipo
  sugeria "01 · Receita". Não há regra para a sugestão.

## 4. O que fica em aberto

- **Não existe cancelamento de NF na tela.** A action `cancelarFaturamento`
  existe e funciona, mas o botão saiu com o protótipo da Tela 3.3. O E6 está
  no banco e foi conferido, e só roda quando o cancelamento voltar à tela.
- **Apagar o item de BV (ou o job) com recebimento esperando a nota** é
  barrado pela FK, com a mensagem crua do banco. Cancele o recebimento antes.
- **Recebimento esperando a nota não aparece em Títulos a Receber**: só na
  aba Faturamento, no extrato e no fluxo.

## 5. Conferido

- **SQL com rollback (29/09):** GP barrado; valor acima do saldo recusado;
  fluxo da nota abatido (R$ 391,82 → R$ 41,82); NF recusada com parcela 1
  errada; emissão com a parcela 1 paga (duas baixas) e a 2 em aberto;
  cancelar a NF devolve os dois recebimentos; cancelar a baixa desfaz o
  recebimento; o mesmo ciclo no BV.
- **Navegador (Chrome do Tiago, 29/09):** no TES-1013/26 (nota 2/2) dois
  recebimentos (R$ 300 e R$ 50), recusa de R$ 100 acima do saldo, selo e
  faixa, Faturar com a parcela 1 travada (R$ 350) e a 2 em R$ 41,82 para
  29/11, "2×", recusa do parcial abaixo do recebido, emissão da **NF
  TESTE-130**, marca "Antes da NF" no popup, cancelamento da baixa de R$ 50,
  cancelamento da NF pela action (E6: os R$ 300 voltaram para o selo) e
  cancelamento do recebimento. No BV do TES-1001/26, R$ 100 registrados
  (empresa do job, fornecedor no lançamento), extrato da Conta Teste e
  Faturar do BV, e o cancelamento. **Nada ficou esperando a nota.** A NF
  TESTE-130 ficou como cancelada, e o PDF de teste ficou no Storage.
- **Achado de passagem, corrigido:** no Faturar, "2×/3×/6×" trocava a data
  da parcela que já estava na tela, e o calendário continuava mostrando a
  antiga (a nota sairia com a nova). O calendário agora recomeça com a data.
