# 044 — A alíquota de 19,53% já vem escolhida na versão que nasce do zero

**Data:** 2026-09-03
**Decidido por:** Tiago

Desde 13/08/2026 (ver `lib/impostos.ts`) o percentual de imposto não é
digitado: são duas alíquotas praticadas e o seletor oferece só elas. Mas o
orçamento nascia com **0**, o que na prática significava "em branco" —
nenhuma das duas casa com zero, então o seletor abria vazio e a aprovação
travava com *"Escolha a alíquota de impostos da versão antes de aprovar"*.

A **19,53%** é a alíquota da maioria dos jobs. Ela passa a vir escolhida em
toda versão que nasce do zero. **Versão que vem de importação é a exceção:
nasce zerada e obriga a escolha manual** — ver a seção 2.

Isto não revoga a **decisão 006**: escolher alíquota continua sendo
exigido para aprovar a versão. O que muda é o ponto de partida — em vez de
um zero que ninguém escreveu, o orçamento novo já nasce com a alíquota
praticada.

---

## 1. Onde a padrão vale

Toda versão que nasce **do zero**, seja o orçamento novo ou uma versão nova
de um orçamento que já existe:

| Porta de entrada | Antes | Agora |
| --- | --- | --- |
| "Criar orçamento de um job" (`/orcamentos/[projetoId]/novo`) | v1 com 0 | v1 com **19,53%** |
| "Criar orçamento do projeto" (editor multi) | 0 | **19,53%** |
| Orçamento novo dentro da visão agregada | 0 | **19,53%** |
| Drawer "Nova versão" de um orçamento existente | seletor em branco | abre em **19,53%** |

No drawer a padrão aparece **escolhida na tela**, e não só no servidor: quem
precisa da 24,269914% troca ali mesmo, antes de criar.

## 2. Onde a versão nasce ZERADA, de propósito

**"Importar planilha" na tela da versão** (`versoes/importar-actions.ts`).
Planilha avulsa, que veio de fora e não traz alíquota: a versão nasce com o
seletor em branco e **obriga a escolha manual** antes de aprovar. Já era 0
antes desta decisão; agora é 0 declarado, com o motivo escrito no código.

Zerado, o seletor abre vazio e a barra de aprovação cobra a escolha — que é
exatamente o aviso que a tela já sabia dar (decisão 006). Por isso **não há
notificação nova**: a trava da aprovação é o aviso.

### A planilha única do projeto continua HERDANDO (04/09/2026)

A importação do projeto inteiro (`_selecao/importar-actions.ts`) chegou a
zerar a alíquota junto com a de cima, e **foi revertida no dia seguinte**:
ela cria versão em **vários orçamentos de uma vez**, e zerar obrigaria a
reescolher a alíquota um a um, a cada reimportação. Ali existe uma versão
vigente com parâmetro já conferido, e é dela que a nova herda — moeda,
câmbio, honorários, save e **imposto**, como antes da 044.

A diferença entre as duas importações é essa: uma parte de uma planilha
avulsa e não tem de onde herdar contexto; a outra é a continuação de
orçamentos que já existem no sistema.

## 2.1 Duplicar continua herdando

O botão **"Duplicar"** copia a alíquota da versão de origem, inclusive a
24,269914%. Duplicata não é versão nova do zero nem planilha de fora: é a
continuação de uma versão cujo parâmetro já foi decidido e conferido.

A 24,269914% não sumiu de lugar nenhum: quem precisa dela troca no seletor,
na criação ou depois, pelo "Editar" da versão.

## 3. Onde está

- `lib/impostos.ts` — `ALIQUOTA_IMPOSTO_PADRAO`, que é
  `ALIQUOTAS_IMPOSTO[0]`. O número mora num lugar só; trocar a padrão é
  mexer nessa constante.
- `app/(app)/orcamentos/[projetoId]/actions.ts` — `criarVersaoInicial`.
- `app/(app)/orcamentos/_rascunho/tipos.ts` — `PARAMETROS_PADRAO`, que
  alimenta o editor multi e o agregado.
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/nova-versao-drawer.tsx`
  — estado inicial do seletor.
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/actions.ts` —
  `extractVersaoInput`, o default do servidor quando o campo chega vazio.
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/importar-actions.ts` e
  `app/(app)/orcamentos/_selecao/importar-actions.ts` — os dois imports,
  que gravam 0.
