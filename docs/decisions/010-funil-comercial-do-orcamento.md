# 010 — O funil comercial do orçamento

**Data:** 2026-08-17
**Status:** aceita
**Contexto:** lista de Projetos & Orçamentos (`/orcamentos`) e lista de
orçamentos do projeto (`/orcamentos/[projetoId]`). Decisões do Tiago em
16-17/08/2026, registradas no plano local de alterações de telas.

## Decisão

Cada orçamento está em **exatamente um** de cinco estágios do funil
comercial, segundo sua situação ATUAL. A regra mora em
`lib/calculos/funil.ts` (`estagioFunil`), não nas telas — a lista de
projetos usa a função para CONTAR (colunas Aprovados / Enviados /
Abertos) e o detalhe do projeto usa a mesma função para ROTULAR o badge
de cada linha. As duas leituras nunca divergem porque são a mesma conta.

| Estágio | Condição | Rótulo |
|---|---|---|
| `orcamento` | `orcamentos.status` em rascunho, em revisão, enviado ao cliente ou **recusado** | Orçamento |
| `aprovado` | `status = 'aprovado'`, OU `job_criado` com job `rejeitado_financeiro` | Orçamento Aprovado |
| `enviado` | `job_criado` com job `aguardando_abertura` | Enviado para abertura |
| `aberto` | `job_criado` com job `aberto`, `em_producao` ou `encerrado` | Job Aberto |
| `cancelado` | `orcamentos.status = 'cancelado'` ou job `cancelado` | Cancelado |

### Quatro detalhes que a conta define

1. **Recusado não tem coluna própria.** Recusa do cliente devolve o
   orçamento ao estágio "em aberto" — conta só no total, como os demais
   pré-aprovação.
2. **Rejeição do financeiro volta uma casa.** Job `rejeitado_financeiro`
   devolve o orçamento a "Orçamento Aprovado" até novo envio — não fica
   em "Enviados".
3. **O funil só registra que o job FOI aberto.** Produção e encerramento
   são assunto do módulo Jobs: job `encerrado` continua contando em
   "Abertos".
4. **Mais de um job por orçamento** (não deveria ocorrer no fluxo atual):
   vale o job **não-cancelado mais recente**; só com todos cancelados
   vale o cancelado mais recente (`escolherJobDoFunil`).

### Caso de borda decidido na implementação

Orçamento `job_criado` **sem job encontrado** é anomalia de dado; o
último fato conhecido do funil é a aprovação, então cai em "Orçamento
Aprovado". Comentado na própria função.

## Consequências

- A coluna **Orçamentos** da lista de projetos segue sendo o total bruto
  (qualquer status, cancelados e recusados inclusos); as três colunas do
  funil são subconjuntos mutuamente exclusivos desse total.
- O detalhe do projeto **deixou de exibir** o status bruto do orçamento
  (Rascunho, Em revisão, Enviado ao cliente…) — quem precisa do status
  fino abre o orçamento. Telas novas que queiram mostrar estágio
  comercial devem importar de `lib/calculos/funil.ts`, nunca reimplementar
  o mapeamento.

## Valor do Job nas listas (mesma entrega)

A coluna "Valor do Job" do detalhe do projeto usa a versão **aprovada**
(`orcamentos.versao_aprovada_id`) quando existe; senão a versão mais
recente (número em negociação); sem versão, travessão. O cálculo é o
`calcularTotaisVersao(...).valorJob` — a MESMA definição do fechamento da
versão. Fórmula nova para "valor do orçamento" está proibida: se outra
tela precisar do número, importa a mesma função.
