# 272 — Recorrências: uma lista só, a conta que varia e o custo fixo reconhecido no banco

**Data:** 2026-11-23
**Status:** aceita e implementada em 23/11/2026.
**Quem decidiu:** Tiago, sobre o protótipo "Recorrências no Contas a Pagar"
(v1 de 15/11 a v7 de 23/11): https://claude.ai/artifact/S4rgRzk85K2djCCLXkspWG.
**Relaciona-se com:** [235](235-custos-fixos-como-recorrencias.md) (os custos
fixos viraram recorrências), [244](244-nada-se-concilia-sozinho.md)
(nada se concilia sozinho), [262](262-conciliacao-acertar-e-conciliar.md)
(a Conciliação dia a dia) e [064](064-a-conta-bancaria-paga-qualquer-empresa.md) (a conta
bancária não pertence a uma empresa).

## O problema

A aba Recorrências era uma lista de cadastro sem os títulos: não dizia o que
estava pago, atrasado ou sem documento. A página de detalhes era separada, o
formulário estreito, e não havia onde guardar o documento do pagamento. Na
Conciliação, o título de custo fixo só era sugerido no valor exato e no dia do
vencimento: o domingo (08/11) e o lote do dia 9 que paga as contas do dia 20
ficavam sem sugestão, e a conta que varia (luz, água, celular) nunca batia.

Números de 23/11 (produção): 133 recorrências, 127 ativas; 263 títulos gerados
desde agosto, nenhum em dobro; 92 vencidos em aberto (R$ 177,7 mil); 28
títulos com valor diferente do cadastro, 25 pagos assim (as contas que variam).

## O que foi decidido

1. **Uma lista só**, com as colunas do cadastro na ordem das outras abas do
   Contas a Pagar: Código, Valor, Descrição, Fornecedor, Empresa · Regional,
   Plano de contas, Vencimento, Próximo título, Documentos, Status, Ações.
2. **Código da recorrência** (`REC-00001`), por tenant, na 1ª coluna.
3. **Status do título** na coluna "Próximo título" (o primeiro título que ainda
   não fechou): Aguardando conta, A pagar, Atrasado, Sem extrato, A conciliar,
   Pago. Uma 2ª linha de filtros filtra por ele, como o "Status" da aba Títulos
   a Pagar. "A conciliar" é o título baixado sem ligação com o extrato, ou em
   aberto com o pagamento já reconhecido no extrato.
4. **A conciliação não se faz nesta aba.** O "A conciliar" se resolve na
   Conciliação.
5. **Detalhes e formulário num pop-up centralizado**, no lugar da página
   `/recorrente/[id]` (o endereço antigo leva à lista com o pop-up aberto).
6. **Formulário em quatro blocos** (o que se paga, quanto e quando, como se
   paga, onde entra no resultado), com o "Ao salvar" mostrando os títulos que
   vão nascer.
7. **Regional simples, sem rateio livre por enquanto:** uma regional ou
   "Todas (TD, pelo rateio)", que grava o rateio da tabela da empresa
   (`empresas_rateios_regionais`, o ano vigente).
8. **Sem conta de pagamento na recorrência.** Hoje cada empresa paga os custos
   fixos por uma conta só (39 de 39 baixas na California, 2 de 2 na CCH), e a
   conta bancária não pertence a uma empresa (064).
9. **Conta que varia:** a recorrência marca "Varia todo mês"; o título nasce
   com o valor do cadastro como estimativa e "Aguardando conta". "Lançar a
   conta" grava o valor real, o vencimento da fatura e o documento, e o título
   passa a "A pagar".
10. **Débito automático** (a forma de pagamento que já existia) guarda "Como
    aparece no extrato": o começo do histórico do banco.
11. **Documento do pagamento** em cada título (os anexos da conta avulsa). O
    título pago sem documento fica pendente; o que fecha a pendência é o
    documento da cobrança (nota, fatura, boleto, recibo, guia, contrato).
12. **Pausar e Encerrar** perguntam o que fazer com o título já gerado e em
    aberto (excluir ou manter). Encerrar pede o último vencimento a pagar.
13. **Sem aprovação (opção A),** como o lançamento avulso: quem lança é o
    financeiro ou o administrador, que é quem aprovaria. Ao editar a
    recorrência, a mudança vai também ao título já gerado e em aberto (caixa
    marcada por padrão): valor (se a conta ainda não foi lançada), descrição,
    fornecedor, plano de contas, regional e forma de pagamento.
14. **Motor da Conciliação:** o título de recorrência é sugerido numa janela de
    12 dias antes a 5 dias depois do vencimento, em qualquer conta, com até 20%
    de diferença na conta que varia e com peso a mais pelo texto do débito
    automático. A linha diz por quê ("Sugestão: custo fixo REC-00001 · valor
    exato · 1 dia depois do vencimento (08/11)"). Nada se concilia sozinho.

## Regra nova que a implementação trouxe

**Mudar o dia do vencimento não gera dois títulos no mesmo mês.** Antes, mudar
o dia de 8 para 10 com o título de 08/12 já gerado criava também o de 10/12. Agora
o novo dia vale a partir do mês seguinte ao do último título gerado (nas
quinzenais e anuais, a partir da data seguinte). O título já gerado fica com o
vencimento dele.

## O que mudou

- **Banco** (`20261123700001_recorrencia_codigo_e_conta_que_varia.sql`):
  `contas_avulsas_recorrentes.codigo` (gatilho na criação, as 133 da California
  numeradas pela ordem de criação), `valor_variavel`, `texto_no_extrato`;
  `contas_avulsas.valor_estimado` e `conta_lancada_em`; o gerador grava
  `valor_estimado`.
- **Regra do custo fixo** num lugar só, `lib/conciliacao/custo-fixo.ts`, usada
  pelo motor (`motor.ts`, passo 3) e pelo status "A conciliar" da aba.
- **Aba:** `recorrentes-list.tsx` e a pasta `contas-a-pagar/recorrencias/`
  (carga no servidor, formulário, detalhes, documento, lançar a conta,
  pausar/encerrar). Saíram `conta-recorrente-drawer.tsx` e a página de
  detalhes; a "Nova recorrência" do menu da Conciliação usa o mesmo formulário.
- **Ações:** `actions-recorrentes.ts` ganhou `encerrarContaRecorrente`,
  `anexarDocumentoAoTitulo`, `removerDocumentoDoTitulo`, `lancarContaDoTitulo`;
  criar e editar recebem a regional, a conta que varia, o texto do débito e a
  opção A.

## O que fica para depois

- **Cadastro das 127 ativas:** 96 sem forma de pagamento; marcar as que variam
  (cerca de 38) e as de débito automático com o texto do extrato.
- **Fornecedores:** 65 nomes diferentes na planilha; 8 recorrências acham o
  fornecedor pelo nome exato, 18 têm um candidato pelo nome parcial, 52
  fornecedores (109 recorrências) não estão no cadastro. Só é preciso para pagar
  pela remessa (PIX/TED) e para a NF do mês (271).
- **Os 92 títulos vencidos em aberto:** conciliar o que já foi pago, com a
  sugestão nova.
- **Rateio customizado** e a NF no cadastro único de notas pelo título (frente
  das Notas Fiscais, 271).
