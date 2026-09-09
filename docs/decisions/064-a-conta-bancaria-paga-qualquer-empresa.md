# 064 — A conta bancária paga qualquer empresa, mas a empresa dela é quem dá acesso

**Data:** 2026-09-09
**Status:** aceita
**Contexto:** telas de baixa de Contas a Pagar e Contas a Receber, cadastro
de contas bancárias, e as policies de `contas_bancarias`. Continua a
decisão de 29/08/2026 registrada na migration `20260829100001`.

## O problema

O Tiago cadastrou uma conta bancária nova e ela não apareceu como opção
para pagar um título. Nenhuma mensagem, nenhum erro: o dropdown
simplesmente não a listava.

A conta ("Conta Teste") era da empresa **Empresa Teste**; o título
(PP-00011, JOB-0010) era da **CALIFÓRNIA FILMES E PUBLICIDADE LTDA**. O
dialog de baixa só listava contas cuja `empresa_id` batia com a do
documento.

Esse filtro era resíduo de uma regra **revogada**. Em 29/08/2026 a
migration `20260829100001` tirou a trava de empresa das oito funções de
baixa, com a regra enunciada assim:

> "Jobs sempre estarão associados a empresas, e os faturamentos e NFs
> também, visto que sempre serão emitidas por uma empresa. Porém, as
> contas em si não são específicas de uma empresa."

A FK composta `fk_lancamento_conta_empresa` já tinha caído em 28/08. O
banco aceitava a baixa; a interface é que não deixava chegar até ela — e
tinha sido atualizada pela metade: a baixa em lote de cartão já listava
todas as contas ativas, os outros quatro pontos não.

## A regra em duas frases

1. **Para PAGAR, a empresa da conta não importa.** Qualquer conta ativa
   quita documento de qualquer empresa. A empresa que vai para o
   lançamento é a do DOCUMENTO, não a da conta.
2. **Para VER e EDITAR a conta, a empresa é tudo.** Desde 09/09/2026 ela
   é a chave de acesso da RLS.

## O que mudou

Sumiu o filtro por empresa dos quatro pontos que ainda o tinham:

| Arquivo | O que era |
|---|---|
| `components/financeiro/baixa-titulo-dialog.tsx` | Títulos a Pagar — o caso que apareceu |
| `app/(app)/financeiro/contas-a-receber/baixa-recebimento-dialog.tsx` | Contas a Receber |
| `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/page.tsx` | filtrava já na query |
| `components/financeiro/baixa-avulsa-dialog.tsx` | código morto, corrigido junto para não virar armadilha |

O estado vazio também mudou de texto: dizia "Nenhuma conta ativa dessa
empresa", que descrevia a regra revogada.

## O que NÃO mudou, e por quê

O Tiago pediu para **tirar a empresa do cadastro da conta** — "não
precisa, e não faz sentido para a operação atual". Concordei, comecei, e
o teste de gravação derrubou o plano: **falhou ao salvar**.

A causa: no mesmo dia, pela outra frente
(`20260909000001..4_empresa_members`), as policies de `contas_bancarias`
passaram a chamar
`can_access_empresa_regional(auth.uid(), empresa_id, null)`. A função
compara `e.id = p_empresa_id` e `em.empresa_id = p_empresa_id` — com
`empresa_id` nulo os dois `exists` dão **false**. Conta sem empresa não
pode ser criada, e ficaria **invisível para todo mundo**, inclusive para
quem a criou.

Ou seja: entre 29/08 e 09/09 a empresa da conta deixou de ser um rótulo e
virou controle de acesso. O `alter column ... drop not null` foi
revertido no mesmo dia, antes de qualquer linha nula existir. O campo
"Empresa *" continua no cadastro.

**Para retomar isso um dia:** primeiro `can_access_empresa_regional`
precisa aprender a tratar `p_empresa_id is null` — e ela é da outra
frente.

## Pendência anotada

`uniq_conta_id_empresa` (UNIQUE em `id, empresa_id`) é órfã: só existia
para ancorar a FK composta que caiu em 28/08, e não garante mais nada
porque `id` já é a PK. Fica para uma faxina própria — derrubar constraint
é mudança destrutiva.
