# 145 — Módulo fiscal: correções pela lei (remessa pelo líquido, complementar, DARF mínimo, guia sem notas, LC 224)

**Data:** 2026-10-04
**Decidido por:** Tiago ("Resolva 1, 2, 3", 04/10/2026), depois da revisão das
pendências do fiscal; a regra de trabalho dele: "apenas seja adicionado o
modelo mais correto que se aproxime da lei e a partir disso vamos ajustando a
nossa realidade".
**Status:** aceita — itens 1 a 3, 6 e 7 entregues em 04/10/2026
**Migrations** (todas aditivas):
- `20261004100001_remessa_paga_o_liquido_da_pp.sql`: duas colunas com default
  em `cnab_remessas_itens`, a função `_item_da_remessa` e o bloco da remessa
  em `baixar_parcela_pp`;
- `20261004100002_cancelar_imposto_a_pagar.sql`: o status `cancelado` em
  `impostos_a_pagar`, três colunas, um índice e `cancelar_imposto_a_pagar`;
- `20261004100003_fiscal_receitas_anteriores.sql` e
  `20261004100004_fiscal_receitas_anteriores_so_financeiro.sql`: a tabela da
  receita anterior da LC 224, só para administrador e financeiro.

---

## 1. A remessa CNAB paga o líquido da PP com retenção

**O erro.** A remessa levava o que faltava pagar da parcela, sem descontar a
retenção que o financeiro decidiu na aprovação da PP, e a baixa de um
documento que foi para uma remessa só aceitava o valor cheio, sem retenção
(interino da D15, decisão 125). Ninguém retinha o imposto do fornecedor. Quem
paga e não retém responde pelo imposto, com multa de 75% sobre o que deixou
de reter (Lei 10.426/2002, art. 9º; CSRF, Lei 10.833/2003, art. 30; IRRF,
RIR/2018, art. 714). Até 04/10 nenhuma PP real tinha sido paga por remessa.

**Como ficou.**

| Ponto | Regra |
|---|---|
| Geração do arquivo | A parcela de PP sai pelo líquido: o que falta menos a retenção da aprovação, pela mesma conta da baixa (`retencoesPelaAprovacao`: cada imposto arredondado em centavos sobre o que falta). PP de verba e PP sem retenção na aprovação saem pelo valor cheio, como antes. Avulso, folha, recorrência e desembolso não mudam. |
| O que a remessa guarda | `cnab_remessas_itens.valor` é o que o banco paga (o líquido); `retido` é a soma descontada (0 = valor cheio); `retencoes` é [{imposto, aliquota, valor}]. As 171 remessas antigas ficaram com `retido = 0`. |
| Diálogo da remessa | Cada PP com retenção mostra o líquido e, embaixo, "R$ 8.000,00 − R$ 492,00 retidos"; o total é o do arquivo. Depois de gerar, o resumo diz quanto foi retido das PPs (a agência recolhe pelas guias da Apuração). |
| Baixa da parcela em remessa | Sempre do que falta (o banco pagou o documento inteiro). Na remessa que pagou o valor cheio, sem retenção, como antes. Na que pagou o líquido, a baixa abre com a retenção da remessa ("Retenção da aprovação, descontada na remessa: o banco pagou R$ X · a baixa repete esse líquido"), e o banco de dados recusa a baixa cujo líquido não é o que o banco pagou. Vale na baixa individual (Contas a Pagar e Conciliação) e na baixa em lote. |

**Teste no banco** (transação desfeita, nada gravado), com a PP-00110 de teste
(R$ 8.000,00, retenção da aprovação de R$ 492,00) numa remessa simulada:
remessa cheia + baixa com retenção → recusa; remessa líquida + baixa sem
retenção → recusa ("A remessa pagou R$ 7.508,00…"); baixa parcial → recusa;
retenção diferente → recusa; retenção da remessa → baixa de R$ 7.508,00 com
R$ 492,00 retidos e a parcela paga.

## 2. A guia complementar vence na data legal da guia original

**O erro.** A complementar (a diferença que aparece depois da aprovação)
vencia 5 dias depois da aprovação, como no protótipo. Não existe esse prazo:
o imposto vence na data do período, e pagar depois é atraso, com multa de
0,33% ao dia (até 20%) e juros Selic (Lei 9.430/1996, art. 61). Com os 5
dias, o sistema mostrava em dia um imposto já atrasado.

**Como ficou.** O título da complementar vence no vencimento da guia original
(`vencimentoDaComplementar`; no IRPJ/CSLL, o da 1ª cota ou da cota única). Se
a data já passou, o título nasce vencido, e a baixa já tem o campo de multa e
juros. O pop-up de aprovação da diferença diz a data e, quando ela já passou,
avisa que a guia sai com multa e juros. Se cabe denúncia espontânea (retificar
a declaração e pagar com juros, sem multa), quem decide é a contabilidade.

## 3. DARF mínimo de R$ 10,00

**O erro.** O parâmetro `darf_minimo` estava no cadastro, mas o motor não o
aplicava: uma guia federal de R$ 7,00 virava título, e DARF abaixo de
R$ 10,00 não se paga.

**Como ficou** (Lei 9.430/1996, art. 68). A guia de PIS, COFINS (normal e
cumulativa), CSRF, IRRF, IRPJ ou CSLL que dá menos que o mínimo fica com
apurado zero (não gera título), com a linha "Abaixo do DARF mínimo" e o aviso
de para onde o valor foi. O valor soma à guia seguinte do mesmo código e da
mesma PJ ("Vindo de &lt;período&gt; (abaixo do DARF mínimo)"), até chegar ao
mínimo, e se paga no vencimento desse período. O que veio não se abate de
crédito (é imposto de período fechado). Sem guia no período seguinte, o valor
segue esperando a próxima guia do código. O ISS fica de fora: é guia
municipal, com regra de cada prefeitura.

## 4. Guia aprovada cujas notas foram canceladas (item 6)

**O erro.** Se todas as notas (ou os pagamentos) de uma guia já aprovada
fossem canceladas, a guia sumia da Apuração sem aviso, e o título continuava
em Impostos a Pagar, podendo ser pago. Não havia como tirar um imposto em
aberto (`corrigir_imposto` não aceita zero).

**Como ficou** — à mão, como o Tiago pediu ("deve ser registrado manualmente,
e não por trás dos panos apenas como uma regra"):

| Ponto | Regra |
|---|---|
| Apuração | A guia aprovada não some: sem fatos, sai zerada, como diferença para menos, com o aviso "Hoje esta guia não tem nenhum fato… O imposto que ainda não foi pago se cancela em Impostos a Pagar, com motivo; o que já foi pago fica a recuperar, com a contabilidade." Vale para ISS, PIS/COFINS, retenções e IRPJ/CSLL. Aprovar a diferença para menos registra, sem título. |
| Pop-up da diferença para menos | Diz o que fazer: título em aberto se corrige ou se cancela em Impostos a Pagar; o já pago fica a recuperar. |
| Impostos a Pagar | Botão "Cancelar imposto" (ícone ✕) no título em aberto: motivo obrigatório (10 caracteres), auditoria `fiscal.imposto_cancelado` pelo banco. O cancelado sai de "A pagar", das contagens, do lote, da Central e do fluxo de caixa; aparece em "Todos" com a pílula "Cancelado" e o motivo. Pago não se cancela. |

**Quando importa:** o caso só existe depois de uma guia aprovada; as
primeiras aprovações reais são no começo de novembro, e o risco é pagar, no
vencimento, o título de uma guia cujas notas caíram.

## 5. LC 224/2025 na Hitlab (item 7)

**O erro.** O cálculo aplicava 35,2% sobre o que passava de R$ 1,25 milhão no
próprio trimestre, sem a sobra dos trimestres anteriores e sem o ajuste do
ano: no 4º trimestre/2026 (R$ 2,41 milhões previstos), cerca de R$ 12,7 mil a
mais de IRPJ e CSLL se a Hitlab fechar 2026 abaixo de R$ 5 milhões.

**A regra** (texto do DOU da IN RFB 2.305/2025, art. 15, na redação da IN
2.306/2026; a pesquisa está em `scratchpad/lc224/` da sessão):

- limite de R$ 1,25 milhão por trimestre, comparado com a receita do próprio
  trimestre; a sobra de um trimestre abaixo do limite passa para os seguintes
  do mesmo ano (§§2º a 4º); o excedente nunca passa;
- no 4º trimestre confere-se o ano (§5º): até o limite anual, nenhum
  acréscimo, e o pago a mais antes volta como dedução do IRPJ e da CSLL do
  4º trimestre; acima, o 4º trimestre leva o que falta para o excedente do
  ano, ou nada, refazendo os anteriores na proporção; o que passar do imposto
  do 4º trimestre se restitui ou compensa, a pedido, com Selic (§§7º e 8º);
- IRPJ desde janeiro/2026; CSLL desde abril/2026 (noventena; LC 224, art. 14),
  com limite de R$ 3,75 milhões em 2026 (Perguntas e Respostas da Receita,
  itens 12 e 13) — os dois controles são separados;
- no regime de caixa, a receita é a recebida (a norma não diz; é a mesma
  receita da base).

**Como ficou.** O motor segue essa regra (`lc224DoTrimestre`), com as linhas
"Limite da LC 224 no trimestre" ou "Ajuste do ano da LC 224" na memória e
"(−) Acréscimo da LC 224 pago a mais no ano" no 4º trimestre. A receita de
janeiro a setembro/2026 não está no sistema: o financeiro a informa à mão em
Cadastros › Impostos › Parâmetros ("LC 224/2025 · receita recebida antes da
Apuração", por PJ do presumido e trimestre; auditoria
`fiscal_receita_anterior.registrada`). Sem ela, vale o limite do próprio
trimestre, como antes (erra para mais), e a guia avisa o que falta.

**Conferido nos testes** com os números da pesquisa: 1,0 + 1,6 + 1,5 + 0,6
milhão no ano devolvem R$ 2.800,00 de IRPJ e R$ 1.728,00 de CSLL no 4º
trimestre; os casos II e III do §5º e a sobra de limite entre trimestres.

## 6. O que ficou como está (Tiago, 04/10/2026)

- **Retenção pela natureza do serviço:** fica como hoje; o financeiro registra
  caso a caso, na aprovação e na baixa.
- **Grupo da NF em toda PP de pessoa jurídica:** o Tiago vai rever.

## 7. Arquivos

- Item 1: a migration; `app/(app)/financeiro/contas-a-pagar/actions-cnab.ts`,
  `page.tsx`, `remessa-cnab-dialog.tsx`, `dados-dos-titulos.ts`,
  `titulos-pagar-list.tsx`, `actions-retencao-da-aprovacao.ts`;
  `app/(app)/financeiro/conciliacao/alvos-da-baixa.ts`;
  `app/(app)/financeiro/actions-baixa-em-lote.ts`;
  `lib/financeiro/baixa-em-lote.ts` (`aliquotasDaParcela` com a remessa,
  `aliquotasDaRemessa`); `lib/fiscal/retencao-da-aprovacao.ts`.
- Itens 2 e 3: `lib/fiscal/apuracao.ts` (`vencimentoDaComplementar`,
  `aplicarDarfMinimo`), `app/(app)/financeiro/fiscal/apuracao/memoria-dialog.tsx`
  e `aba-apuracao.tsx`.
- Item 6: as migrations; `lib/fiscal/apuracao.ts` (`aprovada` no contexto,
  `AVISO_SEM_FATOS`); `app/(app)/financeiro/fiscal/impostos/` (`actions.ts`
  `cancelarImposto`, `dialogos.tsx` `CancelarImpostoDialog`,
  `aba-impostos.tsx`, `dados.ts`); `lib/types.ts`.
- Item 7: as migrations; `lib/fiscal/apuracao.ts` (`lc224DoTrimestre`,
  IRPJ e CSLL presumidos com bases separadas); `lib/fiscal/cadastro.ts`
  (`receitasAnteriores`); `app/(app)/financeiro/cadastros/impostos/`
  (`registrarReceitaAnterior`, `ReceitaAnteriorDialog`, a aba Parâmetros);
  `lib/validations/fiscal-cadastro.ts`; `lib/auth/audit.ts`; `lib/types.ts`.

## 8. Verificação

- 218 testes (fiscal, financeiro, CNAB e dados), `tsc`, lint e `next build`
  limpos; testes novos da retenção da remessa, da complementar e do DARF
  mínimo (IRRF de R$ 9,00 em novembro que passa para dezembro e janeiro).
- Build de produção local: o diálogo da remessa mostra a PP-00110 por
  R$ 7.508,00 ("R$ 8.000,00 − R$ 492,00 retidos") e a PP-00111 por
  R$ 2.860,50. Nenhum arquivo gerado.
- A complementar e o DARF mínimo só aparecem com guia aprovada ou valor
  pequeno, que ainda não existem no banco: conferidos pelos testes.
- Itens 6 e 7: 237 testes (os novos: guia aprovada sem fatos e os casos da
  LC 224); o cancelamento testado no banco em transação desfeita (motivo
  curto recusado, cancelamento com auditoria, segundo cancelamento recusado,
  baixa de imposto cancelado recusada).
