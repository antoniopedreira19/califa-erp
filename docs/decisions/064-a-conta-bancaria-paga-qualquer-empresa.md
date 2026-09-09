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

1. **A conta bancária não tem empresa.** Ela paga documento de qualquer
   uma; a empresa que vai para o lançamento é a do DOCUMENTO. O cadastro
   nem pergunta mais.
2. **A coluna sobrevive como vestígio**, nullable, para o caso de a
   agência voltar a dividir contas por empresa. Conta que ainda tem
   empresa continua sujeita à RLS por empresa; conta sem empresa é de
   todo mundo do tenant.

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

## A empresa também saiu do cadastro

O Tiago pediu, na mesma conversa, para tirar a empresa do cadastro da
conta — "não precisa, e não faz sentido para a operação atual". A
primeira tentativa **falhou no teste de gravação**, e vale registrar por
quê: no mesmo dia, pela outra frente
(`20260909000001..4_empresa_members`), as policies de `contas_bancarias`
passaram a chamar
`can_access_empresa_regional(auth.uid(), empresa_id, null)`. A função
compara `e.id = p_empresa_id` — com `empresa_id` nulo os dois `exists`
dão **false**, então a conta não nascia e ficaria invisível para todo
mundo.

Com o Antonio alinhado, a segunda passada resolveu isso **pelas policies
desta tabela, não pela função**: `contas_bancarias_select` e
`_modify` passaram a aceitar `empresa_id is null` como "conta de todo
mundo do tenant". `can_access_empresa_regional` NÃO foi tocada — ela
serve 13 tabelas (jobs, orcamentos, projetos, faturamentos,
cartoes_credito…), quase todas da outra frente, e mudá-la mexeria em
todas de uma vez. A checagem de tenant continua igual: conta sem empresa
não vaza entre tenants.

O campo "Empresa \*" saiu do formulário, a coluna saiu da listagem, e o
schema parou de exigi-la. **A coluna FICA no banco**, nullable, a pedido
do Tiago: vestígio para o dia em que a agência quiser dividir contas por
empresa de novo. Quem já tinha empresa mantém, e a conta-espelho do
cartão continua herdando a do cartão pelo trigger.

Um detalhe que quase passou: a listagem do cadastro usava
`empresas!inner`. Mantido, ele faria toda conta nova — sem empresa —
**sumir da lista em silêncio**. O embed saiu junto.

## Pendência anotada

`uniq_conta_id_empresa` (UNIQUE em `id, empresa_id`) é órfã: só existia
para ancorar a FK composta que caiu em 28/08, e não garante mais nada
porque `id` já é a PK. Fica para uma faxina própria — derrubar constraint
é mudança destrutiva.

## Verificação (2026-09-09, navegador logado)

- Dropdown de baixa em Títulos a Pagar listando as **três** contas ativas,
  incluindo a que não tem empresa (antes listava uma só).
- Cadastro sem o campo "Empresa \*", conta criada e **gravada com
  `empresa_id = null`** — o teste que derrubou a primeira tentativa.
- Listagem do cadastro com as três contas (o `!inner` teria escondido a
  nova), e `/financeiro/cadastros` contando 4 ativas.
- `/financeiro/abertura-de-job/[jobId]`, que lê contas por
  `listarContasBancarias`, renderiza sem erro.
- Console sem erro de aplicação — só o aviso da extensão Trancy do Chrome.

Ficaram **sem exercício por falta de dado**: o dialog de Contas a Receber
(zero títulos a receber) e a página `avulsa/[id]` (zero contas avulsas). O
seletor de conta dentro da abertura de job também não foi aberto — ele só
aparece adiante no formulário.

⚠️ **Resíduo:** a conta **"ZZ Conta Sem Empresa (teste)"** ficou no banco;
foi ela que provou a gravação. Ela aparece no dropdown de qualquer baixa —
inative pelo cadastro quando não precisar mais.
