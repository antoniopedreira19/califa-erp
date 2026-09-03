# 044 — A alíquota de 19,53% já vem escolhida no orçamento novo

**Data:** 2026-09-03
**Decidido por:** Tiago

Desde 13/08/2026 (ver `lib/impostos.ts`) o percentual de imposto não é
digitado: são duas alíquotas praticadas e o seletor oferece só elas. Mas o
orçamento nascia com **0**, o que na prática significava "em branco" —
nenhuma das duas casa com zero, então o seletor abria vazio e a aprovação
travava com *"Escolha a alíquota de impostos da versão antes de aprovar"*.

A **19,53%** é a alíquota da maioria dos jobs. Ela passa a vir escolhida.

Isto não revoga a **decisão 006**: escolher alíquota continua sendo
exigido para aprovar a versão. O que muda é o ponto de partida — em vez de
um zero que ninguém escreveu, o orçamento novo já nasce com a alíquota
praticada.

---

## 1. Onde vale

| Porta de entrada | Antes | Agora |
| --- | --- | --- |
| "Criar orçamento de um job" (`/orcamentos/[projetoId]/novo`) | v1 com 0 | v1 com **19,53%** |
| "Criar orçamento do projeto" (editor multi) | 0 | **19,53%** |
| Orçamento novo dentro da visão agregada | 0 | **19,53%** |

## 2. Onde NÃO vale, e por quê

- **Versão nova de orçamento existente** (drawer "Nova versão"): o seletor
  continua abrindo em branco. Ali a alíquota é decisão daquela versão, e
  quem cria já está com o orçamento na frente — o palpite atrapalharia
  mais do que ajuda.
- **Versão importada de planilha** (`versoes/importar-actions.ts`):
  continua em 0, mesma razão.
- **Duplicar versão** e **importar a planilha única do projeto**: seguem
  copiando a alíquota da origem, que é o comportamento certo — não é
  orçamento novo, é continuação de um que já tem parâmetro escolhido.

A 24,269914% não sumiu: quem precisa dela troca no seletor, na criação ou
depois, pelo "Editar" da versão.

## 3. Onde está

- `lib/impostos.ts` — `ALIQUOTA_IMPOSTO_PADRAO`, que é
  `ALIQUOTAS_IMPOSTO[0]`. O número mora num lugar só; trocar a padrão é
  mexer nessa constante.
- `app/(app)/orcamentos/[projetoId]/actions.ts` — `criarVersaoInicial`.
- `app/(app)/orcamentos/_rascunho/tipos.ts` — `PARAMETROS_PADRAO`, que
  alimenta o editor multi e o agregado.
