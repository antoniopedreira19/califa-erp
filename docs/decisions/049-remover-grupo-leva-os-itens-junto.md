# 049 — Remover o grupo leva os itens dele junto

**Data:** 2026-09-04
**Status:** aceita
**Contexto:** a lixeira do agrupamento na planilha da versão do orçamento
(`/orcamentos/[projetoId]/[orcId]`). Pedido do Tiago em 04/09/2026.

## A regra

**A lixeira do grupo apaga o grupo E todos os itens dentro dele, numa ação
só.** A confirmação diz quantos itens vão junto, e o botão repete a conta:
*"Remover grupo e 6 itens"*.

Grupo vazio continua como era: *"O grupo está vazio e essa ação não pode ser
desfeita."*, botão *"Remover"*.

O que NÃO mudou:

- **Versão aprovada não perde grupo.** A trava continua na server action, e
  na tela aprovada a calha nem mostra a lixeira.
- **A remoção de um item continua existindo**, item a item, na lixeira da
  linha do item. Quem quer tirar uma linha não precisa desmontar o grupo.
- **Não há desfazer.** A ação apaga do banco na hora, como já apagava.

## Por que

Até aqui a lixeira do grupo recusava grupo com item dentro: *"Remova os N
itens do grupo antes de excluí-lo."* Numa planilha importada, onde um grupo
carrega dezenas de linhas, isso é dezenas de cliques de confirmação para
chegar ao que se queria desde o primeiro — trabalho manual que o sistema
sabe fazer sozinho.

A trava não protegia nada que a confirmação não proteja melhor: o risco de
apagar sem querer se resolve dizendo **quantos itens** vão embora antes de
apagar, não obrigando o usuário a apagá-los um por um.

O rascunho de orçamento (`_rascunho`, a tela de vários orçamentos antes de
salvar) **já se comportava assim** desde sempre — lá o grupo sai com os
itens e a confirmação avisa. A versão gravada era a exceção, não a regra.

## Como o banco garante que não fica pela metade

O delete vai por RPC, `deletar_grupo_orcamento(p_grupo_id)`
(migration `20260904100001`), pelo mesmo motivo da 20260821000005 do
delete de versão: **uma chamada de RPC é uma transação**. Em dois deletes
separados pelo PostgREST, se o segundo falhasse os itens sumiriam e
sobraria um grupo vazio que ninguém pediu.

A ordem é explícita, item → grupo, porque `versoes_orcamento_itens.grupo_id`
aponta para o grupo com `ON DELETE RESTRICT`: apagar o grupo primeiro é
barrado na hora. Os BVs (`itens_bv`) e os consumos de save
(`saves_consumos`) caem junto por CASCADE a partir do item.

A função é `SECURITY INVOKER` — roda com o papel de quem chamou, então o RLS
de tenant vale como em qualquer outro caminho. Não é bypass, é empacotamento.

**Sobra uma trava de banco depois dessa:** se um job já nasceu da versão,
`jobs_itens_orcado` aponta para os itens com `NO ACTION` e o delete falha.
Não deveria acontecer (versão aprovada já é barrada antes), mas se
acontecer a action devolve a frase que explica — *"há dados de job apontando
para os itens deste grupo"* — em vez do genérico.

## Auditoria

Ação nova `grupo_orcamento.removido`, com `itens_apagados` no metadata. É o
único rastro de que aquelas linhas existiram: depois do delete não há de
onde ler.

## Arquivos

| Arquivo | O que mudou |
| --- | --- |
| [`supabase/migrations/20260904100001_rpc_deletar_grupo_orcamento.sql`](supabase/migrations/20260904100001_rpc_deletar_grupo_orcamento.sql) | a RPC transacional |
| [`versoes/actions.ts`](app/(app)/orcamentos/[projetoId]/[orcId]/versoes/actions.ts) | `removerGrupo` — sai a recusa por item, entra a RPC + auditoria |
| [`grupo-linha.tsx`](app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/grupo-linha.tsx) | a confirmação diz quantos itens saem; o botão repete a conta |
| [`lib/auth/audit.ts`](lib/auth/audit.ts) | ação `grupo_orcamento.removido` |
