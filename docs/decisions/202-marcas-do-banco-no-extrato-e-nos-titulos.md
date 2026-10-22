# 202 — As marcas do banco no Extrato e o sinal na aba Títulos

**Data:** 2026-10-21
**Status:** aceita e implementada em 21/10/2026 (task 029, fase 3, entrega 3C).
A folha no Extrato (D2 da decisão 195) e a remessa linha a linha foram
decididas pelo Tiago no mesmo dia (seção "A folha no Extrato e a remessa
linha a linha"): o motor e a leitura da folha entraram num segundo commit, e
a faixa na tela (`conciliacao-list.tsx`) com o commit da fase 4, porque o
arquivo ficou junto do cadeado do fechamento. Revê os itens 6 e 7 da
decisão 199.
**Quem decidiu:** Tiago, no protótipo "Conciliação com o banco", versão
**Alternativa** (`docs/handoffs/2026-10-21-conciliacao-com-o-banco/`, seções
4.1, item 12, e 4.8 da especificação; protótipo, `AbaExtrato` e
`LinhaPlanilha` de `titulos.jsx`, com o sinal "faixa + ícone").
**Migration:** nenhuma.

## O problema

Com o extrato do banco importado (decisões 198 a 201), o Extrato da conta e a
aba Títulos continuavam sem saber dele: o Extrato não dizia o que já bateu
com o banco nem o que não bate, e a aba Títulos deixava dar baixa à mão num
título que o banco já mostrava pago, com outra data.

## A regra

### O Extrato: a coluna Banco

1. **Com extrato importado na conta**, a coluna **Banco** entra primeiro na
   grade do Extrato (`colunasDoExtratoNaGrade(true)`, 48 px, o mesmo
   `colgroup` com `table-fixed`), com uma marca por linha:
   - **✓** (círculo verde): "Conciliado com o extrato do banco" — o
     lançamento está ligado a uma linha do banco (`extrato_linha_id`);
   - **⚠** (círculo vermelho, com a dica): "Não bate com o banco. A baixa
     registrou R$ X; o banco debitou R$ Y." — a baixa feita à mão que diverge
     (passo 1b) —, ou "Não está no extrato do banco até dd/mm: paga em outra
     conta, com a data errada ou não paga." — a baixa num dia que o extrato
     já cobre por inteiro e que nenhuma linha usou (o "sem linha no banco" da
     Conciliação automática);
   - **○** (anel âmbar): "Ainda não apareceu no extrato do banco".
2. **Sem extrato importado, a coluna não aparece.** O protótipo a mostra
   sempre; aqui, numa conta que nunca importou, todas as linhas teriam ○, e
   "ainda não apareceu" supõe um extrato.
3. **A faixa vermelha**, em cima dos cartões: "N lançamentos não batem com o
   extrato do banco importado: estão marcados com ⚠ na coluna Banco. A
   conciliação não fecha até a correção." e **"Corrigir na Conciliação
   automática"**.
4. **"Importar extrato do banco (OFX)"**, que abre a Conciliação automática
   da conta (onde fica a zona do arquivo), e o contador "N conciliadas com o
   banco · N aguardando o extrato do banco".
5. O ⚠ sai do mesmo motor da Conciliação automática, sem os títulos: os dois
   casos vêm antes deles (`alertasDoExtrato`, `motor-da-conta.ts`). Vale para
   todos os lançamentos que a linha do Extrato junta (a baixa e os juros, as
   partes da guia).
6. O cadeado do período fechado entra com o fechamento (fase 4, decisão 205).

### A aba Títulos: o sinal "faixa + ícone"

7. O título que o motor achou numa linha do banco **ainda não conciliada**
   (a sugestão e a diferença de juros, como no protótipo) ganha:
   - a **faixa verde fina** na borda esquerda da linha;
   - o **ícone do banco** ao lado da data, com a dica "No extrato do banco de
     dd/mm/aaaa. {motivo}. “Baixar” já vem com a data e o valor do banco, e a
     baixa sai conciliada.";
   - o **"Baixar" mais escuro**, com o ícone do banco.
8. **"Baixar" abre a baixa real** de sempre, já com a data, a conta, a forma
   e o valor do banco (a parcial, a retenção, a multa e os juros, como na
   Conciliação automática, decisão 200), e **a linha do banco se liga à baixa
   depois dela** (`conciliarPelosDocumentos`). Se a ligação falhar, a baixa
   vale, e o aviso manda conciliar a linha na Conciliação automática.
9. **A faixa verde** em cima do resumo: "N títulos já aparecem no extrato do
   banco importado em dd/mm. Eles saem daqui pela aba Conciliação
   automática, com a data do banco, sem digitar nada." e **"Conciliar com o
   banco"**.

### A folha no Extrato e a remessa linha a linha (Tiago, 21/10/2026)

10. **A suposição do protótipo não vale para a remessa do Santander.** O
    protótipo mostrava a folha numa linha só do banco ("Folha de pagamento
    09/2026 · 17 títulos") e casava a remessa inteira com essa linha. O
    Santander debita **cada pagamento da remessa numa linha própria**, e um
    pagamento pode falhar e sair no dia seguinte: pela remessa, o dia não
    bateria centavo a centavo. Nem a opção A (pela remessa) nem a B (pela
    folha) como linha única.
11. **No Extrato, cada pagamento da folha é uma linha própria**, com o seu
    ✓, ⚠ ou ○, e a conciliação continua linha a linha.
12. **O agrupamento é só para ver:** uma faixa recolhível por folha **e** por
    dia, no padrão das faixas de grupo da decisão 091 (`FAIXA_GRUPO_LISTA`):
    o dia na Data, a soma no Débito (e no Crédito), o saldo depois do último
    pagamento no Saldo, e na Descrição "Folha de pagamento 10/2026 · 17
    pagamentos · 16 ✓ 1 ○" (o ⚠ em vermelho, quando há). Ela abre nas
    linhas, nasce recolhida (aberta quando o `&highlight=` é de um
    pagamento dela), não junta valores para conciliar, não muda o saldo
    corrente e segue a ordem do Extrato: uma linha de outra coisa no meio
    fecha a faixa, e a ordem pelo título de uma coluna a desfaz, como na
    planilha. `lib/financeiro/folha-no-extrato.ts`.
    - A folha é a competência e o tipo da folha do colaborador
      (`contas_avulsas.folha_id` → `folhas_pagamento`): "Folha de pagamento
      MM/AAAA" no salário, "Férias MM/AAAA" nas férias.
13. **O pagamento que falhou** sai da faixa do dia da remessa e entra na faixa
    do dia em que saiu de verdade: quando o extrato desse dia chega, a linha
    do banco se liga à baixa (passo 1, até 3 dias) e a baixa passa à data do
    banco (decisão 200). Até lá ele fica no dia da remessa, com ○ enquanto
    esse dia não está inteiro num extrato importado, e com ⚠ ("Não está no
    extrato do banco até dd/mm…") quando está, como toda baixa sem linha no
    banco (item 1) — e é o ⚠ que segura o fechamento desse dia (fase 4).
14. **O motor, linha a linha** (`lib/conciliacao/motor.ts`):
    - as baixas de uma remessa **não** se juntam mais num débito só
      (`agruparComoNoBanco`): cada uma casa a sua linha;
    - o título de uma remessa casa pelo valor dele, como qualquer título; só
      fica guardado para o passo 4 quando alguma linha do banco tem o total
      exato da remessa;
    - **fica, para o banco que debita o total:** o passo 4 (a linha igual à
      soma da remessa ainda em aberto) e um passo novo, o **1c**: as baixas
      da remessa no mesmo dia, juntas (`remessasJaBaixadas`), casam com a
      linha que tem a soma exata, e só quando nenhuma delas casou sozinha.

### A leitura

15. As três abas da conta leem o extrato importado
    (`carregarBancoDaConciliacao`, na mesma rodada das outras leituras da
    página): o Extrato para as marcas e os Títulos para o sinal. O Extrato lê
    também, junto da montagem das linhas, os lançamentos do período já
    ligados a uma linha do banco (só o id). Por isso o número de linhas
    pendentes aparece na aba Conciliação automática em qualquer aba.

## Como foi conferido

- No navegador, na Conta Teste:
  - **aba Títulos:** a PP-00079 e a PP-00102 com a faixa, o ícone e a dica
    ("No extrato do banco de 20/10/2026. Valor exato · 12 dias de diferença.
    …") e a faixa verde "2 títulos já aparecem…"; o "Baixar" da PP-00102 abriu
    a baixa com 20/10, Conta Teste, PIX e R$ 300,00, e o aviso disse "A linha
    do extrato do banco de 20/10/2026 ficou conciliada" (conferido no banco:
    `conciliada_como = baixa`);
  - **Extrato de outubro:** ✓ na PP-00102, ⚠ na baixa de R$ 100,00 da
    PP-00245 (o banco debitou R$ 100,40) e no estorno de verba de R$ 1.263,60
    de 19/10 (sem linha no banco), ○ no resto; a faixa "2 lançamentos não
    batem…" e "1 conciliada com o banco · 4 aguardando o extrato do banco";
  - no fim, o Desfazer devolveu a PP-00102 a aprovada, sem baixa.

- **A folha e a remessa linha a linha** (itens 10 a 14): testes em
  `lib/financeiro/folha-no-extrato.test.ts` (a faixa por folha e por dia, o
  pagamento do dia seguinte na faixa dele, a linha no meio que fecha a faixa)
  e em `conciliacao/motor-da-conta.test.ts` (cada pagamento casa o seu título
  e o total só com a linha do total; as baixas uma a uma, e o grupo só com a
  linha da soma). Na tela, numa rota de prévia temporária com dados
  fictícios (apagada antes do commit), porque em 21/10/2026 não há folha no
  banco e folha de teste não se gera: as duas faixas, "4 pagamentos · 3 ✓ 1
  ⚠" e o pagamento do dia seguinte "1 pagamento · 1 ○", abrindo nas linhas
  com o saldo corrente na ordem. A Conciliação automática da Conta Teste
  continuou com as mesmas seções.

## Pendências

1. **A faixa da folha não foi vista com folha de verdade** (não há no banco).
2. "Ver a baixa registrada" no ⓘ do Extrato continua pendente (decisão 195).
