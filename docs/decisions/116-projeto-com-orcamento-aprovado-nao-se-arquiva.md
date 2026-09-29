# 116 — Projeto com orçamento aprovado ou com job não se arquiva

**Data:** 2026-09-28
**Decidido por:** Tiago
**Migration:** nenhuma.

> O número 115 está em uso no worktree `editar-orcado-financeiro`
> ("O financeiro edita o orçado do job"), ainda fora do main.

---

## 1. A regra

Nas palavras do Tiago, em 28/09/2026:

> Não deveria ser possível arquivar projetos com algum orçamento aprovado,
> ou com job já aberto. […] Qualquer estado após a aprovação do orçamento
> deve ser barrado: envio para abertura, rejeitado pelo financeiro,
> aberto, faturado, encerrado…

O "Arquivar" do drawer "Editar projeto" recusa o projeto que tenha:

| Barra | Status |
|---|---|
| Orçamento aprovado | `aprovado` |
| Orçamento com job, em qualquer status do job | `job_criado` — enviado para abertura, devolvido pelo financeiro, aberto, encerrado, finalizado |

Orçamento **em andamento** não barra: rascunho, em revisão, enviado ao
cliente, recusado e cancelado. Ele sai da lista junto com o projeto e
volta com ele no "Reativar".

## 2. O que mudou

Até aqui a regra era mais rígida: o projeto só arquivava com **todos** os
orçamentos cancelados. Isso já barrava orçamento aprovado e com job (o
orçamento com job fica `job_criado` e não se cancela), mas barrava também
o projeto que só tinha rascunho.

Com os dados de 28/09/2026 (18 projetos, todos ativos):

| | Antes | Agora |
|---|---|---|
| Podem ser arquivados | 5 (os sem orçamento) | 8 — os 5 + AMB-P010/26, HIT-P002/26 e TES-P003/26, que só têm orçamento em andamento |
| Barrados | 13 | 10 |

## 3. Como o servidor confere

`arquivarProjeto` (`app/(app)/orcamentos/actions.ts`) faz duas contagens,
que se cobrem:

1. orçamentos do projeto em `aprovado` ou `job_criado`;
2. jobs do projeto, menos o cancelado antes da abertura (113) — o
   orçamento dele voltou a `aprovado` e barra pela primeira.

A segunda segura o orçamento cujo status se desencontrou do job (o
"Cancelar envio" avisa quando o orçamento não volta a `aprovado`).

A recusa aparece dentro do diálogo de confirmação: "Este projeto tem
orçamento aprovado ou job e não pode ser arquivado." Antes, o erro ia para
o corpo do drawer, atrás do diálogo.

## 4. O que NÃO mudou

- Arquivar só muda `projetos.status` para `arquivado` e grava
  `projeto.arquivado` na auditoria. Nada é apagado.
- ~~**O projeto arquivado não fica travado.** Quem chega nele pelo filtro
  "arquivados" ainda cria orçamento, aprova versão e envia para abertura.
  Com esta regra isso pesa mais: dá para aprovar um rascunho de projeto já
  arquivado. Levado ao Tiago em 28/09/2026, sem decisão ainda.~~ ⚠️ Revisto
  no mesmo dia pela decisão 118: projeto arquivado é só leitura, na tela e
  no banco. O banco também confere a regra desta decisão ao arquivar.
- Quem arquiva: `orcamentos.editar` (administrador, GP, produtor).
