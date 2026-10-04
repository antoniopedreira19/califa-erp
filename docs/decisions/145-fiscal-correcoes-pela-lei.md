# 145 — Módulo fiscal: correções pela lei (remessa pelo líquido, complementar, DARF mínimo)

**Data:** 2026-10-04
**Decidido por:** Tiago ("Resolva 1, 2, 3", 04/10/2026), depois da revisão das
pendências do fiscal; a regra de trabalho dele: "apenas seja adicionado o
modelo mais correto que se aproxime da lei e a partir disso vamos ajustando a
nossa realidade".
**Status:** aceita — itens 1 a 3 entregues em 04/10/2026
**Migration:** `20261004100001_remessa_paga_o_liquido_da_pp.sql` (aditiva:
duas colunas com default em `cnab_remessas_itens`, a função
`_item_da_remessa` e o bloco da remessa em `baixar_parcela_pp`)

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

## 4. O que ficou como está (Tiago, 04/10/2026)

- **Retenção pela natureza do serviço:** fica como hoje; o financeiro registra
  caso a caso, na aprovação e na baixa.
- **Grupo da NF em toda PP de pessoa jurídica:** o Tiago vai rever.

## 5. Arquivos

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

## 6. Verificação

- 218 testes (fiscal, financeiro, CNAB e dados), `tsc`, lint e `next build`
  limpos; testes novos da retenção da remessa, da complementar e do DARF
  mínimo (IRRF de R$ 9,00 em novembro que passa para dezembro e janeiro).
- Build de produção local: o diálogo da remessa mostra a PP-00110 por
  R$ 7.508,00 ("R$ 8.000,00 − R$ 492,00 retidos") e a PP-00111 por
  R$ 2.860,50. Nenhum arquivo gerado.
- A complementar e o DARF mínimo só aparecem com guia aprovada ou valor
  pequeno, que ainda não existem no banco: conferidos pelos testes.
