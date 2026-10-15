# 177 — A produção edita o cadastro do fornecedor pelo lápis, e não só o pendente

**Data:** 2026-10-15
**Status:** aceita e implementada (15/10/2026).
**Quem decidiu:** Tiago, em 15/10/2026, a partir do print de uma produtora.
**Revisa:** a regra de 18/09/2026 de que o cadastro inline "só CRIA"
(`docs/10-permissoes-por-perfil.md`) e a exceção da
[166](166-regime-e-cnae-do-fornecedor.md), que dava o lápis à produção só
com o cadastro pendente.
**Migration:** nenhuma. A policy `fornecedores_update` já aceita qualquer
membro do tenant; a trava era só da action e da tela.

## O pedido

Uma produtora, editando a PP-00107, escolheu um fornecedor de cadastro
completo e não viu botão nenhum ao lado do campo. O texto embaixo dizia
"Revisar o cadastro de um fornecedor é com o administrador". O Tiago:

> Isso deve ser possível tanto para o produtor quanto freela.

## Por que o botão não aparecia

O botão ao lado do campo Fornecedor da PP tem dois papéis (decisão 067):
"+" com o campo vazio, lápis com alguém escolhido. Até aqui eram duas
permissões:

| Botão | Permissão | Quem tinha |
|---|---|---|
| "+" (cadastrar) | `cadastros.fornecedores.inline` | administrador, GP, produtor, freelancer |
| Lápis (editar) | `cadastros.fornecedores.editar` | administrador, financeiro |

A 166 abriu uma exceção: com o cadastro pendente (sem regime ou sem CNAE),
a produção ganhava o lápis. Com o cadastro completo, como o da BANBOX no
print, o produtor e o freela ficavam sem lápis — e o "+" só volta depois do
✕ que limpa o campo.

## A regra

**Quem cadastra fornecedor pelo fluxo também o edita pelo fluxo.**
`cadastros.fornecedores.inline` passa a valer para os dois botões: o
administrador, o GP, o produtor e o freelancer abrem qualquer cadastro pelo
lápis, pendente ou não, e o salvam inteiro.

- **O GP entra junto.** Ele já tinha o mesmo `.inline` do produtor e do
  freela; deixá-lo de fora faria o produtor poder mais que o GP.
- **Continua só do administrador e do financeiro** (`.editar`): a tela de
  Fornecedores, inativar e reativar.
- **Vale onde o mesmo formulário abre:** o lápis da PP (painel do item e
  aba PPs), o lápis do BV e o lápis do veículo na planilha de Mídia Off. Os
  dois últimos já apareciam para todos, mas a action recusava o cadastro
  completo de quem não tinha `.editar`; agora aceita.

## O que protege o pagamento

Nada novo: o que já existia desde a decisão 067 §4.

- A PP que foi para o financeiro paga pela **foto** dos dados de pagamento
  tirada junto do PDF. Trocar conta ou PIX no cadastro não muda essa PP.
- Trocar conta ou PIX de um fornecedor que tem PP em avaliação, aprovada ou
  paga pede **confirmação**, citando as PPs.
- Toda edição grava `fornecedor.editado` na auditoria, com quem editou.

O risco que fica: a próxima PP de **qualquer** job sai com o que a produção
gravou no cadastro. É o mesmo risco que o administrador e o financeiro já
tinham; agora mais gente o tem.

## O que mudou no código

- `app/(app)/fornecedores/actions.ts` — `checarCriarFornecedor` e
  `checarEditarFornecedor` viraram uma só, `checarCadastroDeFornecedor`
  (`.editar` ou `.inline`). A consulta do cadastro pendente saiu da trava.
- `app/(app)/jobs/[jobId]/carregar-detalhe.ts` — `podeEditarFornecedor` é
  `.inline` ou `.editar`.
- `app/(app)/jobs/[jobId]/realizado/gerar-pp-drawer.tsx` — o lápis segue
  `podeEditarFornecedor`; o `completaPeloLapis` da 166 saiu, porque quem o
  usava agora tem o lápis sempre.
- `app/(app)/admin/usuarios/permissoes/matriz-permissoes.tsx` — a linha
  "Fornecedor rápido dentro do PP" marca também a coluna Editar.

## Conferido

Ver a nota de 15/10/2026 em `docs/handoffs/HANDOFF_JOBS.md`.
