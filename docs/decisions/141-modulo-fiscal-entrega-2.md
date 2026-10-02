# 141 — Módulo fiscal, entrega 2: Apuração, Impostos a Pagar e a guia na conciliação

**Data:** 2026-10-02
**Decidido por:** Tiago
**Status:** aceita — entregue em 02/10/2026
**Migrations:** `20261002100700_fiscal_origem_imposto_baixa.sql` e
`20261002100701_fiscal_apuracao_e_impostos_a_pagar.sql` (aditivas; aplicadas
com o OK explícito do Tiago, porque recriam as travas de origem de
`lancamentos_financeiros`)

---

## 1. O pedido

A segunda parte do módulo fiscal desenhado nas cinco rodadas de protótipo
(decisão 139): a **Apuração** (as guias de cada mês e trimestre calculadas
das notas, dos custos e das retenções, aprovadas com o valor da guia da
contabilidade), os **Impostos a Pagar** (os títulos, com baixa, correção,
lançamento avulso e baixa em lote), a guia na **conciliação** (uma linha que
se abre em sublinhas), o bloco **"No fiscal"** nas baixas, e o fiscal no
**fluxo de caixa**, na **Central Financeira** e no **cronograma do job**.

## 2. Como ficou guardado

- **A guia não se grava: se calcula.** `lib/fiscal/apuracao.ts` é o motor do
  protótipo portado, conferido guia a guia (as 73 guias das três datas
  simuladas saem idênticas). Os fatos vêm do banco
  (`lib/fiscal/apuracao-fatos.ts`): notas emitidas com CNPJ emissor e CNAE,
  as baixas dos títulos a receber com o que o cliente reteve, as PPs com a
  NF registrada na aprovação e os pagamentos delas com o que a agência
  reteve.
- **A aprovação se grava** (`fiscal_aprovacoes`): o calculado, o valor da
  guia (com justificativa quando difere), a memória e o rateio congelados,
  as cotas e as compensações. A diferença que aparecer depois (nota
  registrada atrasada) se aprova como complementar.
- **Impostos a Pagar** (`impostos_a_pagar` + rateio + correções): um título
  por guia aprovada, um por cota no IRPJ/CSLL, o complementar, e os lançados
  à mão.
- **A baixa da guia** grava um lançamento por parte do rateio (empresa ·
  regional) e um de multa e juros, todos com `imposto_a_pagar_id` e a
  origem `imposto_baixa`: toda saída precisa de uma empresa e um centro de
  custo. A conciliação mostra tudo como UMA linha (o débito do banco) que se
  abre em sublinhas, como a fatura do cartão. Centros: 03 · Custo
  Tributário · <imposto> (subtipos novos 001–006); 02 · Custo Operacional
  no repasse das retenções de fornecedor; 11 · Despesa com Juros na multa e
  nos juros (na maior parte do rateio).
- Só admin e financeiro leem e mexem; anexos (guia, comprovante) no bucket
  privado `impostos`.

## 3. O que entrou

| Tela | O que muda |
|---|---|
| Fiscal › Apuração (`/financeiro/fiscal`) | As guias por competência (mês e trimestre) e por PJ, com Em curso · A aprovar · Aprovada · Diferença; a memória de cálculo; a aprovação com o valor da guia da contabilidade (justificativa quando difere), o anexo da guia, a compensação do ISS a recuperar, as cotas do IRPJ/CSLL sobre o valor da guia; a diferença complementar. A Server Action recalcula a guia no servidor. A competência em curso é estimativa e não se aprova. |
| Fiscal › Impostos a Pagar (`?aba=impostos`) | A lista (A pagar · Vencidos · Pagos · Todos, por PJ, busca), a baixa (data, conta, multa e juros, guia e comprovante, a prévia das sublinhas), a baixa registrada com cancelamento, a correção do valor com justificativa, o lançamento avulso (com "Criar e dar baixa") e a seleção para a baixa em lote. |
| Conciliação | No Extrato, a guia é UMA linha (o débito do banco) que se abre em sublinhas: empresa · regional com o percentual, multa e juros, o total da guia. Na aba Títulos, os impostos em aberto entram com o chip "Imposto" e o filtro "Impostos"; "Baixar" abre a baixa do imposto com a conta da conciliação. |
| Baixas | O bloco "No fiscal": na PP com NF, as guias de retenção que a baixa gera (DARF 5952 e 1708, mês e vencimento); no recebimento de nota com CNPJ emissor, o que o cliente reteve abate em qual imposto e mês; no lote, a mesma leitura somada. |
| Central Financeira | O cartão "Fiscal", com guias a aprovar e impostos a vencer ou vencidos. |
| Fluxo de caixa | As saídas de imposto: o cronograma de recolhimento da abertura (decisão 100), menos o que já foi faturado; as guias calculadas ainda não aprovadas; os impostos a pagar pelo vencimento; a baixa como uma linha só em "Já movimentado". A previsão vencida cai no dia seguinte — o Tiago autorizou publicar assim e conferir depois. |
| Job no financeiro | "Cronograma de impostos" na composição das células da aba Fluxo de Caixa. O formulário de abertura não muda (continua pendência). |

## 4. Verificação (02/10/2026)

- **Banco, numa transação desfeita:** lançar avulso, corrigir (R$ 100 →
  R$ 110, rateio reescalado), dar baixa com multa (3 lançamentos: duas
  partes em 03 · 001 e a multa em 11 · 999), cancelar, aprovar uma guia,
  recusar a aprovação repetida e a sem justificativa. Nada ficou gravado.
- **Leitura dos fatos + motor no banco real:** o crédito de PIS/COFINS de
  outubro da PP-00110 (R$ 132 + R$ 608 = R$ 740), a PP-00111 sem crédito,
  o IRPJ/CSLL do 4º trimestre zerado (lucro negativo, ainda sem nota).
- **Navegador, no TES e na Conta Teste:** imposto avulso de teste (PIS,
  setembro/2026, R$ 10,00, rateio Empresa Teste · Teste) criado com a guia;
  baixa pela aba Títulos com a conta já escolhida, multa de R$ 1,00 e
  comprovante; no Extrato, uma linha de R$ 11,00 que abre em R$ 10,00 +
  R$ 1,00, com os saldos certos; baixa cancelada pela aba Impostos a Pagar.
  A Apuração com a memória do PIS de outubro; o "No fiscal" da PP-00110
  (DARF 5952 R$ 372,00 e 1708 R$ 120,00, vencendo em 19/11/2026); o cartão
  da Central; o fluxo de caixa abrindo sem erro.
- **Não exercido no navegador:** a aprovação de uma guia (nenhuma
  competência encerrou; coberta pelo teste no banco e pelos testes
  automatizados), a baixa em lote de imposto, o "No fiscal" do recebimento
  (nenhuma nota tem CNPJ emissor) e o cronograma no job.

## 5. Perguntas que ficaram para o Tiago

1. **Previsão vencida do cronograma de impostos** cai no dia seguinte
   (~R$ 120 mil em 7 jobs no dia da entrega): confirmar a regra.
2. **Guia na baixa em lote:** o imposto sem guia ganha "Anexar guia" na
   linha do lote (o banco exige a guia).
3. **Motivos e justificativas com 10 caracteres** (o banco exige; o
   protótipo pedia 5).
4. **Diferença complementar:** a justificativa é escrita pelo sistema
   ("Complementar: o calculado subiu de R$ X para R$ Y").
5. **Hitlab "a apurar no recebimento"** no fluxo e na Apuração: fica para a
   próxima entrega (nenhuma nota tem CNPJ emissor ainda).
6. **As 5 dúvidas do motor** (presumido sem caixa, DARF mínimo, vencimento
   da complementar, compensação só em Salvador, guia aprovada que some).
7. **Contagens que veem N lançamentos por guia:** o detalhe "Já
   movimentado" do fluxo (agrupado nesta entrega) e o número de
   lançamentos da lista de contas da conciliação.
