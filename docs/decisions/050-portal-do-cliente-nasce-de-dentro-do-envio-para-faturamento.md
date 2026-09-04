# 050 — O portal do cliente nasce de dentro do envio para faturamento

**Data:** 2026-09-04
**Status:** aceita
**Contexto:** formulário "Enviar job para faturamento" (`/jobs/[jobId]`)
e os portais de fornecedor do cliente (`cliente_portais`, criados em
13/08/2026 junto do envio). Decisão do Tiago em 04/09/2026. Segue o
padrão da 048 (fornecedor de dentro da PP).

## A mudança em duas frases

1. **O campo "Portal de fornecedor do cliente" cadastra o portal ali
   mesmo.** Sem portal, o aviso ganha o botão **Cadastrar portal**; com
   portal, há um **"+"** ao lado do combo. Os dois abrem um bloco com
   Nome e Link dentro do próprio drawer.
2. **Ao salvar, o portal já sai selecionado** e o envio segue. Ninguém
   sai do formulário para Cadastros › Clientes e volta — o que se digitou
   (PO, vencimento, parcelas, descrição da NF) fica onde estava.

## 1. Por que dentro do formulário, e não num dialog

O cadastro de portal tem dois campos. Um dialog por cima do drawer (o
que a 048 fez para o fornecedor, que tem uma tela inteira) seria peso
demais para isso. O bloco abre no lugar do campo, com fundo levemente
avermelhado para dizer "isto é um cadastro, não parte do envio", e some
ao salvar ou cancelar.

Enquanto o bloco está aberto, **Enviar fica desabilitado**: ou a pessoa
salva o portal e ele entra selecionado, ou cancela — o job não vai com um
portal pela metade na tela.

## 2. O cliente é o do job — o servidor decide

A action `cadastrarPortalDoClienteDoJob(jobId, { nome, url })` recebe o
**job**, não o cliente. O cliente é relido de `jobs → projetos.cliente_id`
no servidor, dentro do tenant da sessão. Quem envia não escolhe para qual
cliente o portal vai, porque só há uma resposta certa.

Devolve `{ id, nome, url }` para o drawer selecionar na hora. O nome é
único por cliente (`uniq_cliente_portal_nome`); como o drawer só lista os
ativos, a colisão que a pessoa não vê é com um portal **inativo** — e a
mensagem diz isso e aponta para reativar em Cadastros › Clientes, em vez
de criar um segundo.

## 3. Permissão: quem envia, cadastra

Nasceu `cadastros.clientes.portal_inline` = **Administrador e Gerente de
Produção**, o espelho exato de `jobs.enviar_faturamento`. O raciocínio é
o mesmo da 048: quem pode fazer o envio precisa poder preencher o que o
envio pede. O cadastro do cliente inteiro (`cadastros.clientes.editar`)
continua só do administrador. Teste de contrato em
`lib/permissoes.test.ts` garante que os dois conjuntos são iguais.

⚠️ **Ponta solta, para decisão:** as actions do card de portais na página
do cliente (`criarPortal`, `editarPortal`, `alternarPortal` em
`app/(app)/clientes/[id]/portais-actions.ts`) **não têm gate de papel** —
só `requireSession`, com RLS de membro do tenant. Hoje é indiferente
(todos os usuários são administradores), mas quando os outros papéis
entrarem elas precisam de `cadastros.clientes.editar` ou do novo
`portal_inline`. Não foi mexido aqui: é o módulo de clientes, e a
pergunta é de negócio.

## 4. Selecionar sem esperar o refresh

Mesmo mecanismo da 048: o portal novo entra em `portaisNovos`, mesclado à
lista do server component e deduplicado por `id` (`portaisVisiveis`); a
seleção acontece em dois tempos (`portalPendenteId` → `portalId` num
efeito, só quando o id já está na lista), porque o `Select` do Radix
devolve `""` se valor e `<option>` chegam na mesma renderização. **Sem
`router.refresh()` e sem `revalidatePath` da página do job** nesse
momento — o refresh no meio do preenchimento zerava formulário. A action
revalida só `/clientes/[id]`, que lista os portais.

## 5. Onde a regra mora

| | Arquivo |
|---|---|
| Action | `app/(app)/jobs/[jobId]/actions-faturamento.ts` — `cadastrarPortalDoClienteDoJob` |
| Schema (reaproveitado) | `lib/validations/envio-faturamento.ts` — `clientePortalSchema` |
| O bloco inline e a mescla | `app/(app)/jobs/[jobId]/enviar-faturamento-drawer.tsx` |
| Permissão | `lib/permissoes.ts` — `cadastros.clientes.portal_inline`; teste em `lib/permissoes.test.ts` |
| Auditoria | `cliente_portal.criado` com `metadata.origem = "envio_faturamento"` e `job_id` |

Sem migration: a tabela, a unique e as policies já existiam.

## 6. Fora desta decisão

- Editar ou inativar portal de dentro do envio — só cadastro.
- O gate das actions do card de portais na página do cliente (§3).
- O mesmo "+" nos combos de portal do financeiro, se um dia existirem.
