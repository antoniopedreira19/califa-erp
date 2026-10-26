# 195 — As planilhas de títulos e o Extrato nas mesmas colunas: Conciliação › Títulos, Contas a Pagar, Contas a Receber e Impostos a Pagar

**Data:** 2026-10-21
**Status:** aceita e implementada em 21/10/2026 (task 029, fase 1).
⚠️ **Revista em 26/10/2026:** o título sem data prevista entra no dia de
hoje, e a aba Títulos ordena pela mesma data que agrupa — "Revisão de
26/10/2026", no fim deste documento.
**Quem decidiu:** Tiago, no protótipo "Conciliação com o banco", versão
**Alternativa** (`docs/handoffs/2026-10-21-conciliacao-com-o-banco/`,
seção 4.1 da especificação), e nos três pontos D1 a D3 de 21/10/2026.
**Revê:** a [091](091-a-conciliacao-comeca-pela-lista-de-contas.md) (o
Extrato da conta) e a [140](140-baixa-em-lote-e-aba-titulos.md) (a aba
Títulos da conciliação).
**Migration:** nenhuma. A fase 1 é só tela: tudo o que as colunas novas
mostram já estava no banco.

## O problema

As quatro listas de títulos tinham quatro grades diferentes, nenhuma
igual à do Extrato. Contas a Pagar e Impostos usavam `table-fixed` com as
larguras nos `<th>`; Contas a Receber e o Extrato, largura automática. Nenhuma
mostrava a regional nem o centro de custo antes da baixa, e o Extrato não
alinhava com nada. Quem conferia um título contra o extrato do banco lia
colunas em lugares diferentes em cada tela.

## A regra

1. **As mesmas colunas, na mesma ordem e largura**, em Conciliação ›
   Títulos, Contas a Pagar, Contas a Receber e Impostos a Pagar: caixa ·
   Data prevista · Crédito · Débito · (Saldo previsto, só na conciliação) ·
   Descrição · Fornecedor/Cliente/Órgão · Job · Centro de Custo · TRI ·
   Empresa · REG · (Status, nos módulos) · Ação. `table-fixed` com
   `colgroup`, larguras do protótipo em px, a Descrição com o que sobra
   (`components/financeiro/planilha-de-titulos/colunas.ts`). O Extrato usa a
   mesma grade, com o Saldo e só o ⓘ na Ação.
2. **O valor vai na coluna do sentido do dinheiro no banco** (a regra
   "banco"): o que entra no Crédito, o que sai no Débito. O estorno de verba
   e o estorno de compra no cartão entram no Crédito em Contas a Pagar. A
   transferência, nos módulos, aparece nas duas colunas, em cinza e fora dos
   totais, com a dica no próprio valor; na conta, cai na coluna da perna
   dela. Impostos a Pagar tem a coluna Crédito fina, só com "—".
3. **Centro de Custo mostra só o tipo** ("02 · Custo Operacional"); a dica
   (mouse ou clique) mostra o centro inteiro. A fatura do cartão diz "Itens
   da fatura", com os centros dos itens na dica; a transferência, "Fora do
   DRE"; o desembolso e a nota sem plano, "definir na baixa".
4. **REG**: com job, a regional do job, 100% (decisão 069); sem job, o rateio
   do documento; a nota com jobs, as regionais deles pesadas pelo valor dos
   itens; a fatura, os itens pesados pelo valor; a guia, o rateio dela. As
   siglas: NE, SP, NO, RJ e SS ficam; Doca, Agency, Hitlab, Teste, Teste 2 e
   Teste 3 viram DOC, AGE, HIT, TES, TE2 e TE3; o resto, as três primeiras
   letras (AMBEV vira AMB, Ventura vira VEN). Com mais de uma regional, "TD",
   e a regra do rateio na dica ("Rateio: NE 60% · SP 40%").
5. **As dicas** (Regional, Centro e valores) abrem no mouse e ficam presas no
   clique; clicar fora, Esc ou rolar fecham (`components/ui/dica.tsx`).
6. **Só a caixa seleciona.** Clicar no resto da linha não marca nem abre
   nada.
7. **A célula Ação**: "Baixar" (ou "Registrar", na transferência) encostado
   à esquerda, a 6 px da borda, e o ⓘ a 8 px dele. O título pago tem o olho
   das baixas registradas no lugar do "Baixar".
8. **Retenção e baixa parcial moram num ícone à esquerda do valor**: o
   ícone âmbar mostra o bruto, cada retenção da aprovação da PP e o "Sai da
   conta"; o azul, o bruto, o já baixado e o que falta. Na PP com retenção da
   aprovação, a linha mostra o líquido — o que sai da conta. O estorno da
   baixa entra no mesmo ícone.
9. **Etiquetas**: a origem (PP, AVULSO, RECORRÊNCIA, FOLHA, o código do
   desembolso e da fatura, ESTORNO DE VERBA, NOTA FISCAL, RECEB. AVULSO,
   RENDIMENTO, TRANSFERÊNCIA, IMPOSTO), BV, "Urgente" com a justificativa, e
   "N itens" na fatura, que abre os itens embaixo, nas mesmas colunas. O
   status: "No cartão" (o pago no cartão fica na lista, com a fatura em que
   entrou), "A devolver" e "Devolvido" no estorno de verba, "Parcial",
   "Inadimplente", "Vencido", "Cancelado", e a situação da prestação na verba
   paga.
10. **O ⓘ (variante A)**: o pop-up "Detalhes do título" ou "Detalhes do
    lançamento" mostra só o que a linha não tem — a trilha da origem
    (pedida, aprovada, emitida; a parcela; o vencimento quando difere da
    data prevista), o pagamento (chave PIX, linha do boleto, guia, cartão e
    fatura), o retido na fonte, de onde vem o dinheiro (a nota de mais de um
    job), a regional, os documentos e as ações da tela de origem. É lido
    quando abre (`app/(app)/financeiro/actions-detalhes-do-titulo.ts`), com o
    caminho de cada arquivo re-derivado no servidor. Os documentos abrem lado
    a lado: o interno à esquerda (a PP, a NF emitida), o de pagamento à
    direita (a NF do fornecedor, o orçamento, o boleto, a guia).
11. **Imposto: "Abrir na Apuração"** no ⓘ, no lugar do lápis "Corrigir o
    valor". O valor da guia não se corrige na tela de pagamento.
12. **"Novo lançamento"** na aba Títulos da conciliação, com as seções "A
    pagar" (pagamento avulso, recorrência, imposto avulso), "A receber"
    (recebimento avulso, recebimento antes da NF, rendimento) e "Entre
    contas" (transferência). Cada item abre o formulário que já existe; o
    "Recebimento antes da NF" leva à aba Faturamento de Contas a Receber,
    onde ele nasce de um job. Ao lado, o "Exportar remessa Santander", o
    mesmo diálogo de Contas a Pagar.
13. **Conciliação › Títulos**: o saldo previsto da conta corre linha a
    linha, com o vencido no dia de hoje; os quadros "Saldo de hoje", "Saem
    até", "Entram até" e "Saldo previsto no fim da lista"; o aviso de quando a
    conta fica negativa; "Agrupar por dia" (ligado), com a faixa do dia; o
    chip Transferências. A barra da seleção diz como a conta fica, e "Ver no
    Extrato antes" mostra os marcados no Extrato como linhas previstas, em
    lilás, sem gravar nada.
14. **O Extrato**: a mesma grade, o mesmo ⓘ, a REG, o pagamento da fatura
    aberto nos itens (cada um com o centro dele), a guia de imposto em uma
    linha que abre no rateio (decisão 141), a data com o ano e o valor com
    "R$".

## Os três pontos de 21/10/2026

- **D1 — o lápis da data prevista fica só onde ele grava**: PP, avulso,
  recorrência, folha e a nota a receber. `repactuarDataPagamento` só escreve
  na parcela da PP e na avulsa; no desembolso e na fatura o lápis aparecia e
  respondia "Lançamento não encontrado." — saiu dos dois. O imposto continua
  sem lápis. Fazer valer nos três é escrita nova no banco: pendência.
- **D2 — a folha agrupada no Extrato ("17 títulos") vai para a fase 3**,
  junto da remessa da folha (passo 4 do motor). Em 21/10/2026 nenhuma folha
  tinha baixa no sistema, e folha de teste não se gera: ela cria uma linha
  para cada colaborador.
- **D3 — "Corrigir o valor" do imposto sai da linha**, como manda a
  especificação. A Apuração hoje não corrige guia já aprovada (só existe
  `aprovarGuia`); até 21/10/2026 houve zero correções. O `CorrigirDialog` e
  a action `corrigirImposto` ficam no código, sem entrada na tela, para a
  correção na Apuração reaproveitar: pendência.

## Como ficou no código

- Regras puras e testes: `lib/financeiro/planilha-de-titulos.ts` e
  `.test.ts` (a coluna do valor, as siglas e o "TD", o trimestre, o saldo
  previsto, os totais, o agrupamento por dia).
- A linha num formato só, montada de cada título:
  `app/(app)/financeiro/conciliacao/linhas-da-aba.ts` (`linhaAPagar`,
  `linhaAReceber`, `linhaDeImposto`). Os campos são obrigatórios de propósito
  (CLAUDE.md, "tipo de linha estreito").
- O que as listas não liam: `lib/data/planilha-de-titulos.ts`
  (`carregarExtrasDaPlanilha`: regional, retenção da aprovação, centro da
  nota, itens da fatura, código da fatura), em lotes de 150 ids.
- A grade: `components/financeiro/planilha-de-titulos/`; o ⓘ e o
  visualizador: `components/financeiro/detalhes-do-titulo/`; a conferência
  das baixas, num lugar só: `components/financeiro/conferencia-das-baixas.tsx`.
- A remessa montada por uma função só, para as duas telas:
  `contas-a-pagar/titulos-da-remessa.ts`.
- O tipo `LancamentoFinanceiro` (`lib/types.ts`) ganhou `titulo_receber_id`,
  `fatura_cartao_id` e `papel_na_fatura`, e o `regional_id` passou a nulável,
  como no banco.

## Pendências

1. A data prevista no desembolso, na fatura e no imposto (D1).
2. A correção do valor da guia aprovada, na Apuração (D3).
3. A folha agrupada no Extrato (D2, fase 3).
4. As marcas do banco no Extrato (✓, ⚠, cadeado, contador) e o sinal na
   aba Títulos: fases 3 e 4.
5. "Ver a baixa registrada" no ⓘ do Extrato: a conferência mora nas listas
   dos módulos, e o Extrato não tem o título dela.

## Revisão de 26/10/2026 — o título sem data prevista entra no dia de hoje

**O que aparecia:** na Conciliação › Títulos, a faixa "Hoje" saía duas
vezes — no topo, com os vencidos, e de novo no fim da lista, depois do
último dia —, e o console do navegador acusava duas faixas com a mesma
chave (`2026-10-26`). Na Conta Teste, em 26/10/2026: Hoje com 17 títulos
(R$ 127.663,20, saldo −R$ 45.109,60) e, depois de 07/11, outra Hoje com 2
títulos (R$ 0,10).

**A causa:** o título a pagar sem data prevista. A ordem da planilha
(`ordenarLinhas`) põe o sem data por último; o agrupamento por dia (pela
`dataEfetiva`) e o resto da aba — os quadros "Saem até" e "Entram até", o
TRI — o contam como hoje. O agrupamento junta só linhas seguidas, e o dia
de hoje nascia de novo no fim. Em 26/10/2026 eram duas avulsas aprovadas
sem data, a AV-00003 e a AV-00004 (testes da remessa Santander de 24/09,
R$ 0,05 cada). Não era o vencido: ele já vinha antes de hoje, porque a
ordem é pela data prevista. A avulsa a receber sem data já nasce com a
data de hoje na montagem de Contas a Receber.

**Opções levadas ao Tiago:** (A) o sem data entra na faixa de Hoje, como o
vencido, e a lista ordena pela mesma data que agrupa; (B) uma faixa
própria "Sem data prevista" no fim da lista, fora do "Saem até"; (C) juntar
as faixas do mesmo dia sem mudar a ordem — as linhas entrariam em Hoje com
o saldo do fim da lista, e a faixa perderia o aviso "a conta fica
negativa". **Escolhida a A.**

**A regra agora:**

- Na Conciliação › Títulos, a lista e o saldo previsto seguem a data em que
  o título mexe na conta (`dataEfetiva`): o vencido e o sem data prevista
  em hoje, o resto na data prevista. No mesmo dia fica a ordem da planilha:
  o vencido pela data prevista, os títulos de hoje (o que entra antes do que
  sai) e o sem data por último. Cada dia é uma faixa só.
- O saldo previsto desconta o sem data hoje. Na Conta Teste, a faixa de
  Hoje passou a 19 títulos (R$ 127.663,30, saldo −R$ 45.109,70); cada saldo
  depois de hoje caiu R$ 0,10 (27/10: de R$ 23.765,14 para R$ 23.765,04); o
  saldo no fim da lista não mudou (R$ 90.697,27). Os quadros do topo e o
  aviso de quando a conta fica negativa ficaram iguais.
- Contas a Receber, a outra tela que usa `ordenarLinhas`, não muda: lá a
  ordem continua a da data prevista.
- Fica como estava: o filtro de vencimento conta pelo vencimento do
  documento, e o sem data, que não tem vencimento, só aparece em "Todos".

**No código:** `ordenarPorDia` em `lib/financeiro/planilha-de-titulos.ts`
(a ordem da planilha e, por cima, a `dataEfetiva`, com `sort` estável);
`comSaldoPrevisto` recebe o `hoje` e usa essa ordem (`aba-titulos.tsx`).
Testes novos: "o sem data prevista entra no dia de hoje…" e "agrupar por
dia não repete o dia…".
