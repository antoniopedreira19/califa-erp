# Conciliação com o banco: do Extrato do sistema ao fechamento do caixa (2026-10-21)

> Antes desta task, a Conciliação mostrava só o Extrato do sistema e a aba
> Títulos: não existia extrato do banco, vínculo "conciliado" nem trava de
> período, e conferir uma conta com o banco era trabalho de planilha fora do
> ERP. Depois dela, o financeiro importa o OFX do Santander, o sistema cruza
> cada linha do banco com o que já existe (e resolve sozinho o que é certo),
> o Extrato mostra o que bateu e o que não bate, e a conta se fecha até o
> último dia completo: o caixa até ali só muda reabrindo, com motivo.

## O que muda pro negócio

O financeiro passa a conferir a conta com o banco dentro do ERP, do arquivo
OFX ao fechamento, e o mês conferido fica protegido contra baixa, cancelamento
ou troca de data feitos depois.

## Estado atual (o que existe agora)

A task 029 levou para o sistema o protótipo "Conciliação com o banco", versão
**Alternativa** (`docs/handoffs/2026-10-21-conciliacao-com-o-banco/`), em quatro
fases, todas no `main` em 21/10/2026:

- **Fase 1, as planilhas (decisão 195):** Conciliação › Títulos, Contas a
  Pagar, Contas a Receber, Impostos a Pagar e o Extrato na mesma grade
  (`table-fixed` e o mesmo `colgroup`), com TRI e REG abreviada, o ⓘ variante A
  e o "Novo lançamento" em "A pagar", "A receber" e "Entre contas".
- **Fase 2, o popup de baixa e o cartão (decisões 196 e 197):** PIX como
  padrão, caixas no lugar das chaves, juros e multa no boleto num lançamento à
  parte (11 · Despesa com Juros); a fatura escolhida na baixa no cartão, o lote
  no cartão, e baixa e fatura só por admin e financeiro no banco.
- **Fase 3, o extrato do banco (decisões 198 a 202):**
  - importar o OFX (a conta pelo arquivo, a impressão digital que não repete);
  - o motor de correspondência e as seções da Conciliação automática;
  - as ações de cada linha (conciliar, baixar pelo lote com os dados do banco,
    conferir pela baixa real, corrigir a baixa com motivo, regras, saiu e
    voltou, ignorar, desfazer), com a data do banco em tudo;
  - o que se resolve sozinho na importação;
  - as marcas do banco no Extrato (✓, ⚠, ○, a faixa e o contador), o sinal
    "faixa + ícone" na aba Títulos, e a folha e a remessa linha a linha.
- **Fase 4, o fechamento (decisão 205):** "Fechar a conciliação até dd/mm/aaaa"
  com as três condições do banco, a faixa nas três abas, o reabrir com motivo e
  o histórico, o cadeado no Extrato, o aviso e a recusa nos popups de baixa, e
  a trava no banco por gatilho em `lancamentos_financeiros` (M4.2, opção B).
  A decisão 120 foi revista: cancelar e estornar a baixa param no fechamento.
  A decisão nasceu como 203 (reservada no índice), mas a 203 foi publicada em
  paralelo por outra frente, e o fechamento virou a 205.
- **No banco hoje:** só a Conta Teste tem extrato importado (3 arquivos, 14
  linhas). Nenhuma conta está fechada.

## Decisões que vão importar amanhã

- **"Conciliado" é `lancamentos_financeiros.extrato_linha_id`** (M3.3, opção
  A). Só as funções da conciliação gravam a coluna; um gatilho recusa o resto.
- **O fechamento trava o caixa, não o DRE.** Ficam livres job, regional,
  empresa, descrição, contraparte, origem, título e fatura, para a NF de um
  recebimento antes da nota continuar saindo num período fechado. O
  fechamento do DRE por competência é outro.
- **A trava é um gatilho, de propósito:** 32 funções gravam em
  `lancamentos_financeiros`, e a policy `lancamentos_modify` (FOR ALL) deixa o
  usuário gravar direto. Função nova que grava lançamento já nasce travada; a
  mensagem é "Período fechado até dd/mm: reabra a conciliação para mudar esse
  lançamento.".
- **Uma linha do banco ignorada até o dia impede o fechamento pelo saldo**, a
  não ser que se anule com outra no mesmo dia: o banco a tem e o sistema não.
- **O botão de fechar e a recusa vêm da mesma função do banco**
  (`condicoes_do_fechamento`); não refaça as condições no TypeScript.
- **A Conta Teste não fecha pela tela** sem cancelar a baixa da PP-00245 (R$
  100,00 em 16/10 contra R$ 100,40 no banco em 17/10, PIX), que não é dos
  títulos de teste do TES-P001/26. O caminho de sucesso do fechamento foi
  conferido no banco, em transação desfeita; a tela fechada, com o
  fechamento simulado em memória.

## O que fica pra próxima sessão

**Pendências que ficam com o Tiago:**

1. **O pagamento avulso de teste AV-00005**, aberto na Conta Teste (R$ 321,45,
   21/10): só se exclui com o OK dele.
2. **A faixa da folha no Extrato** não foi vista com folha de verdade: não há
   folha no banco, e folha de teste não se gera.

**Pendências registradas nas decisões:**

- 195: a data prevista no desembolso, na fatura e no imposto (D1); a correção
  do valor da guia aprovada na Apuração (D3); "Ver a baixa registrada" no ⓘ do
  Extrato.
- 196: feriados no atraso ficaram de fora, como a especificação pediu.
- 197: a competência criada pela baixa nasce com o vencimento de
  `proxima_fatura_cartao`.
- 198: linha importada não se apaga (resolve-se com "Ignorar"); só a California
  Santander tem agência e número no cadastro entre as contas reais.
- 200: não há tela para listar, editar ou desativar regras do histórico; a
  correção da guia, da remessa e da fatura não existe (cancela-se e baixa-se de
  novo).
- 201: a automação roda quando alguém abre a aba Conciliação automática, não
  num processo do servidor; a remessa grande não foi testada com folha de
  verdade.
- 205: o fechamento do DRE por competência; os popups de desembolso, fatura,
  devolução de verba e transferência não avisam antes (o banco recusa).
- Especificação, seção 11: as regras do DRE, os achados do sistema atual
  (parcelamento no cartão, a data da compra da avulsa no cartão, o crédito de
  fatura credora, a forma da baixa da fatura, a conta de consumo sem valor no
  enum), o centro de custo do desembolso na aprovação e o arquivo de retorno
  do CNAB.

**Riscos encontrados (fora do módulo, para decidir):**

1. **`authenticated` grava direto em `lancamentos_financeiros`** pela policy
   `lancamentos_modify` FOR ALL: um membro pode alterar valor, data ou conta
   de um lançamento pelo PostgREST sem passar pelas RPCs da baixa. O gatilho do
   fechamento só protege o período fechado; fechar o resto é mexer na tabela
   de outro módulo.
2. **A fatura FC-00005 (nov/26) do cartão ZZ Teste Empresa Teste** ficou
   aberta e vazia, do teste da fase 2: não há na tela como apagar fatura.
3. **A conferência das baixas ("Baixa registrada") não mostra os juros**: eles
   aparecem no ⓘ do Extrato e no aviso do cancelamento (decisão 196). Ler os
   juros ali pede um embed de `lancamentos_financeiros` nele mesmo, que já tem
   duas FKs para si.
4. **Aviso no console da aba Títulos:** "two children with the same key"
   (`2026-10-21`) em `PlanilhaDeTitulos`. Visto na conferência da fase 4; não
   foi investigado.

## Rastros técnicos

Migrations da task (aplicadas pelo MCP):

```
20261021600001_origem_juros_baixa.sql
20261021600002_juros_na_baixa_e_fatura_escolhida.sql
20261021600003_baixa_e_fatura_so_pelo_financeiro.sql
20261021700001_extrato_importado.sql
20261021700002_vw_extrato_linhas.sql
20261021700003_origem_devolucao_bancaria.sql
20261021700004_acoes_da_conciliacao.sql
20261021700005_lancar_pela_regra_natureza.sql
20261021700006_linhas_avaliadas_na_importacao.sql
20261021800001_fechamento_da_conciliacao.sql
20261021800002_lancamento_respeita_o_fechamento.sql
20261021800003_fechamento_vira_decisao_205.sql
```

Commits: `1085b9af` pacote de implementação; `2f1b7215` reserva das decisões;
`d2b40eb5` e `0c457b36` (195); `36d9c356` (196 e 197); `0754ec47` (198 e
199); `7b629d00` (200); `4ee20596` (201 e 202); `9dec8aff` (202, a folha e a
remessa linha a linha); e o commit da fase 4 (205).

Testes: `lib/conciliacao/ofx.test.ts`, `lib/conciliacao/motor.test.ts`,
`lib/conciliacao/fechamento.test.ts`,
`app/(app)/financeiro/conciliacao/motor-da-conta.test.ts` e
`lib/financeiro/folha-no-extrato.test.ts`.
