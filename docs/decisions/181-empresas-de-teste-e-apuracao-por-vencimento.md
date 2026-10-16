# 181 — Empresas de teste no fiscal e a Apuração na ordem de vencimento

**Data:** 2026-10-16
**Status:** aceita e implementada (16/10/2026).
**Quem decidiu:** Tiago, de 14 a 16/10/2026, sobre o protótipo "Fiscal como
está hoje" (artifact privado `4uBNLotBpaewmSQS69D1BH`): "Validado", "Pode
executar" e "Concordo, boa ideia" (a segunda empresa de teste).
**Revê:** a [141](141-modulo-fiscal-entrega-2.md) na tela da Apuração (a
competência deixa de ser escolhida no topo) e na regra "a competência em
curso não se aprova", que passa a ter a exceção da PJ de teste. O cálculo
(motor, 144, 145, 146) não muda.
**Migrations:** `20261016600001_empresas_de_teste` (só acrescenta) e
`20261016600002_projetos_de_teste_na_empresa_teste` (muda dado existente,
com o OK do Tiago; ensaiada antes numa transação desfeita).

## O que aconteceu

Em 14/10/2026 a Apuração da California mostrava −R$ 19.335 de lucro bruto
no 4º trimestre e R$ 1.665 de crédito de PIS/COFINS em outubro. Nenhuma nota
de saída tinha sido emitida pelo Faturar desde 01/10; as únicas NFs eram as
de fornecedor registradas na aprovação das PPs — e três delas (602, 603 e
9001, R$ 21 mil) eram de teste, dos jobs TES-1001/26 e TES-1014/26.

O cadastro de impostos só conhecia os três CNPJs reais, e os quatro
projetos TES estavam na Agência California, regional NE. Todo teste caía
num CNPJ real. A "Empresa Teste" existia só como empresa gerencial. O Tiago
não quis a Apuração ignorando testes ("precisaremos fazer testes"): o teste
passa a morar em CNPJs de teste, com as mesmas regras dos reais.

Ele também pediu a Apuração em lista, na ordem de vencimento, com o mês e o
trimestre em colunas, "melhor para o controle", e um jeito de testar sem
esperar o fim da competência.

## A regra

1. **Duas PJs de teste**, com CNPJ fictício e a marca nova
   `empresas_contabeis.de_teste`:
   - **Empresa Teste** · 88.888.888/0001-91 · lucro real, como a California,
     com os mesmos CNAEs da California · Salvador;
   - **Empresa Teste Presumido** · 77.777.777/0001-91 · lucro presumido pelo
     caixa, como a Hitlab, com os mesmos CNAEs da Hitlab · Salvador.
   Ambas com matriz em Salvador-BA (ISS no dia 5).
2. **Três regionais de teste** na Empresa Teste gerencial: Teste (já
   existia), Teste 2 e Teste 3, para testar o rateio entre regionais. As
   três têm a Empresa Teste como CNPJ padrão da PP. Para testar o caminho da
   Hitlab, escolhe-se a Empresa Teste Presumido no Faturar.
3. **Os projetos TES-P001/26 a TES-P004/26 foram para a Empresa Teste,
   regional Teste** (o TES-P002/26, que tinha NE e NO, ficou com Teste e
   Teste 2), com tudo o que nasceu deles: 40 orçamentos, 32 jobs, 46 PPs,
   26 PPs a emitir, 9 notas (8 canceladas) e 11 títulos, 3 recebimentos
   antes da nota e 4 lançamentos. O CNPJ de tudo isso foi para a PJ de
   teste: emissora e tomador das PPs e anexos, tomador das 8 NFs de
   fornecedor, CNPJ e CNAE das notas de saída (as da California para a
   Empresa Teste, as da Hitlab para a Empresa Teste Presumido). As duas
   contas da Empresa Teste e o imposto avulso de teste (cancelado) também.
   Códigos, clientes, valores, status e auditoria ficaram como estavam. Cada
   PP ganhou o passo "Empresa emissora trocada" na linha do tempo.
4. **A NF 34 (PP-00128, AMB-1016/26) é real** e ficou na GoCrazy.
5. **A Apuração vira uma lista na ordem de vencimento**, com as colunas
   Vencimento ("em 16 dias", "vence hoje", "venceu há 1 dia" nas guias a
   aprovar), Guia, CNPJ, Competência (mês; "—" no IRPJ/CSLL), Trimestre e as
   de valor de antes. Os botões de cima viram filtros rápidos: **Mostrar**
   (Em aberto, o padrão, que é tudo que não foi aprovado · A aprovar · Em
   curso · Aprovadas · Todas) e **Competência** (cada mês, que filtra a
   coluna Competência, e cada trimestre, que filtra a coluna Trimestre e
   traz também as guias mensais dos três meses). O resumo mostra o total a
   aprovar, a estimativa em curso e a guia que vence primeiro, com o botão
   "Aprovar as N guias pelo valor calculado" à direita.
6. **Atalho de CNPJ**, no desenho do filtro de regional da aba PPs do
   Contas a Pagar: caixas por PJ, "Marcar todos" e "Limpar". Ele recorta a
   lista antes das contagens dos chips.
7. **A guia em curso de uma PJ de teste se aprova** antes do fechamento:
   botão "Aprovar" de contorno na linha e, ao aprovar, o pop-up "Aprovar
   antes do fim da competência?" ("Voltar" · "Aprovar mesmo assim"). O que
   entrar depois volta como Diferença a aprovar, como em qualquer guia. Nas
   PJs reais, nada muda: a guia só se aprova depois do fechamento. A regra
   está no servidor (`montarPedidoDeAprovacao`, `pjDeTeste`), não só na
   tela.

## Por que só na PJ de teste

O Tiago sugeriu aprovar em curso em qualquer PJ, com confirmação. Ficou só
na de teste porque a contabilidade manda a guia depois que o mês fecha:
aprovar antes paga um imposto incompleto, e cada nota que entrar depois vira
complementar, com outra baixa e outra linha na conciliação. A marca
`de_teste` também vai servir para tirar as PJs de teste dos demonstrativos
consolidados.

## Pendências

1. A marca `de_teste` só se liga por migration; Admin › Empresas contábeis
   ainda não mostra a caixa.
2. Os demonstrativos (DRE, BP, DFC por CNPJ e os gerenciais) precisam
   deixar de fora as PJs de teste e a Empresa Teste gerencial — esta ainda
   não tem marca de teste.
3. Em 16/10/2026, na conferência, o PIS de outubro/2026 da Empresa Teste
   foi confirmado em curso (R$ 0,00, sem título). Nota de teste em outubro
   na Empresa Teste o reabre como Diferença — é esperado.

## Arquivos

- `app/(app)/financeiro/fiscal/apuracao/aba-apuracao.tsx` — a lista por
  vencimento, os filtros rápidos e o atalho de CNPJ.
- `app/(app)/financeiro/fiscal/apuracao/multi-select-cnpjs.tsx` — o atalho.
- `app/(app)/financeiro/fiscal/apuracao/memoria-dialog.tsx` — a aprovação em
  curso e a confirmação.
- `app/(app)/financeiro/fiscal/apuracao/aprovacao.ts` (+ teste),
  `actions.ts`, `dados.ts` — a regra no servidor e a marca da PJ.
- `lib/types.ts` — `EmpresaContabil.de_teste`.
