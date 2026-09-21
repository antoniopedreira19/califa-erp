# 096 — Só a alíquota de 19,53% fica disponível

**Data:** 2026-09-21
**Decidido por:** Tiago
**Migration:** nenhuma.

Revê a lista da [006](006-aliquota-fixa-e-gate-de-aprovacao.md). A
[044](044-aliquota-padrao-no-orcamento-novo.md) (19,53 como padrão do
orçamento novo) continua valendo — e passa a ser redundante enquanto a lista
tiver uma opção só.

---

## 1. A regra

A única alíquota de imposto que se pode escolher no orçamento é **19,53%**. A
de **24,269914%** saiu da lista. Nas palavras do Tiago (21/09/2026): *"por ora
quero que apenas o 19,53 seja mantido. Talvez no futuro a outra faça um
retorno."*

## 2. O que muda

`ALIQUOTAS_IMPOSTO` em `lib/impostos.ts` passou de `[19.53, 24.269914]` para
`[19.53]`. É a fonte única, então a mudança vale de uma vez para:

- os quatro seletores — parâmetros do rascunho, "Nova versão", edição da
  versão (drawer) e a linha de parâmetros da tela do orçamento;
- a trava da aprovação (`bloqueioAprovacaoVersao` → `isAliquotaConhecida`):
  versão com outro percentual não aprova.

## 3. O dado

Nenhuma versão usava 24,269914 (no banco, em 21/09/2026: 14 versões em 19,53 e
1 zerada, rascunho nascido do "Importar planilha"). Nada ficou órfão e nenhum
dado foi alterado.

Se um dia aparecer uma versão gravada com 24,269914, ela se comporta como as
legadas de 0 / 19,54 / 20: o seletor abre vazio, editar preserva o valor, e a
aprovação exige escolher uma alíquota da lista.

## 4. Para trazer de volta

Recolocar `24.269914` no array de `lib/impostos.ts`. Não precisa de migration:
a coluna `percentual_imposto` já é `numeric(10,6)` desde
`20260813000002_imposto_seis_casas.sql`.
