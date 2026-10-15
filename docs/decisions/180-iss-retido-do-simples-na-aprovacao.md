# 180 — O optante do Simples pode ter o ISS retido na aprovação da PP; o MEI continua travado

**Data:** 2026-10-15
**Status:** aceita e implementada (15/10/2026).
**Quem decidiu:** Tiago, em 15/10/2026 ("Pode seguir com a opção 1, MEI
travado"), sobre o protótipo "Retenções no Contas a Pagar".
**Revê:** a [139](139-modulo-fiscal-entrega-1.md) §3, na parte "Simples/MEI
→ sem retenção (IN SRF 459)". O resto da 139, a
[142](142-modulo-fiscal-pontos-remanescentes.md) §5 (a retenção começa
desligada) e a [152](152-nf-do-fornecedor-com-cadastro-proprio.md) (o ISS da nota já
registrada fica travado) seguem como estão.
**Migration:** nenhuma. O banco não confere regime; a trava fica no pop-up
e na Server Action.

## O que aconteceu

Na aprovação da PP, o fornecedor optante do Simples e o MEI tinham a chave
"Reter na fonte" travada desligada, citando a IN SRF 459. Mas a IN 459 só
trata dos tributos federais (PIS, COFINS, CSLL e IRRF). O ISS é municipal:
a LC 123/2006, art. 21, § 4º, deixa o município exigir a retenção do ISS do
optante do Simples, na alíquota que a nota informa.

Com a chave travada, a nota de Simples que destaca o ISS retido não tinha
como ser registrada na aprovação. A guia do ISS retido da Apuração só sai
da aprovação (`iss_retido_aliquota` da nota). Reter o ISS só na baixa
segurava o dinheiro do fornecedor sem gerar a guia.

## A regra

1. **Optante do Simples: só o ISS.** A chave liga. Na grade, PIS, COFINS,
   CSLL e IRRF ficam travados com cadeado, e só o ISS se preenche, na
   alíquota da nota. Ao lado do regime aparece o selo "Só ISS"; a dica diz a
   regra e lembra que o ISS só vale se o município exigir.
2. **MEI: sem retenção.** A chave continua travada desligada, com o selo
   "Retenção travada" e a dica "MEI: sem retenção na fonte."
3. **Lucro Presumido ou Real e regime não informado:** sem mudança. Os cinco
   impostos se preenchem.
4. **A retenção continua começando desligada** em todo regime (142 §5). A
   exceção da 152 vale também para o Simples: a NF que outra PP já registrou
   com ISS nasce com a chave ligada só com aquele ISS.
5. **"Repetir as da PP-…"** no Simples traz só o ISS da última retenção do
   fornecedor. O federal de uma retenção antiga volta ao branco.
6. **O servidor confere.** `aprovarPPComNotaFiscal` lê o regime do
   fornecedor e recusa o que a tela não deixaria mandar:
   - "Optante do Simples: só o ISS pode ser retido (LC 123, art. 21, § 4º).
     PIS, COFINS, CSLL e IRRF não (IN 459).";
   - "MEI: sem retenção na fonte."

## Onde está

- `lib/fiscal/nf-da-pp.ts`: `retencaoDoRegime` (`todas`, `so_iss` ou
  `nenhuma`), `travaDoRegime` (o motivo por imposto) e
  `retencaoForaDoRegime` (a primeira trava da lista). Testes em
  `nf-da-pp.test.ts`.
- `app/(app)/financeiro/contas-a-pagar/aprovar-pp-dialog.tsx`: a chave, o
  selo e a grade com cadeado por imposto.
- `app/(app)/financeiro/contas-a-pagar/actions-titulos.ts`: a trava do
  servidor, antes de `registrar_notas_fiscais_da_pp`.

## Números de 15/10/2026

Em avaliação: 5 PPs de Simples com NF anexada (PP-00043, PP-00133,
PP-00140, PP-00152 e PP-00153) e 6 de MEI com NF (PP-00134, PP-00137,
PP-00138, PP-00139, PP-00151 e PP-00190). Nenhuma foi tocada: a regra vale
na próxima abertura do pop-up.

## O que fica de fora

- **A baixa não confere o regime.** Ela repete a retenção da aprovação e
  deixa editar à mão, inclusive federal de Simples e qualquer imposto de
  MEI. Já era assim antes desta decisão.
- **INSS retido (11%, cessão de mão de obra)** não existe no sistema. Pode
  valer para o Simples dos anexos IV e para quem não é do Simples, e fica
  para a contabilidade dizer se a California tem esse caso.
- **Leitura da retenção pela NF** (modelo B do protótipo, aprovado pelo
  Tiago em 15/10/2026): não implementada. Quando entrar, a leitura
  pré-preenche só o que o regime deixa. No Simples, o federal destacado na
  nota vira aviso para conferir, e não valor.
- **Confirmação com a contabilidade:** se o município do tomador exige o
  ISS do Simples, e se o MEI de algum serviço contratado pela California
  sofre retenção.
