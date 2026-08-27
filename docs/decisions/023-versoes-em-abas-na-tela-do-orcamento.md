# 023 — As versões viraram abas dentro da tela do orçamento

**Data:** 2026-08-21
**Status:** aceita
**Contexto:** módulo de Orçamentos — a tela do orçamento
(`/orcamentos/[projetoId]/[orcId]`) e a antiga tela da versão
(`/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]`). Design de
referência: `Orcamento - Versoes em Abas.dc.html` (projeto Claude Design
`69342d83`). Decisões do Tiago em 21/08/2026.

## A mudança em três frases

1. **A tela da versão deixou de existir como página.** Orçamento e versão
   passaram a ser uma tela só: o cabeçalho do orçamento, as versões em
   abas, e a planilha da aba selecionada logo abaixo.
2. **A aba ativa vive na URL**, em `?v=<versaoId>` — não em estado de
   cliente.
3. **A rota antiga virou redirect permanente** para `?v=`, porque job,
   financeiro e o realizado apontam para a versão aprovada.

Nada mudou na planilha, nos cálculos, nas cores dos blocos (decisão 015),
no BV (decisão 022) ou nas regras de aprovação (decisão 011).

## 1. Por que fundir

O card "Versões do orçamento" era uma lista onde cada linha abria outra
página. Comparar v4 com v5 custava duas navegações e a volta pelo
cabeçalho, e o orçamento que contém as versões ficava invisível enquanto
se lia a planilha. Em abas, comparar custa um clique.

## 2. Qual rota sobreviveu

A do **orçamento**. `/orcamentos/[projetoId]/[orcId]?v=<versaoId>`.

A alternativa era manter a rota da versão e transformar a do orçamento em
redirect. Perdeu porque a identidade da tela é a do orçamento — é o
código `ORC-NNNN`, o nome do job, o cliente e o período que ficam no
cabeçalho, e é para o projeto que o "Voltar" aponta. A versão é o que se
troca dentro dela.

**Sem `?v=`, qual aba abre:** a versão **aprovada**; sem aprovada, a mais
recente que ainda está no jogo. Versão **cancelada** só abre por `?v=`
explícito — quem cancela a aba aberta é mandado de volta sem o parâmetro,
e cair na versão que acabou de sair do fluxo seria um beco.

**`?v=` que não bate** (link velho, versão de outro orçamento) **não dá
404**: cai na aba padrão.

## 3. O que cada ação faz, e sobre o que ela incide

O cabeçalho passou a misturar ações do orçamento com ações da versão. A
distinção não cabe no rótulo de um botão, então **exportar e duplicar
confirmam num popover que diz o nome da versão** em que vão mexer.

| Ação | Incide sobre | Onde fica |
| --- | --- | --- |
| Editar | o **orçamento** | cabeçalho, junto do status |
| Exportar | a **aba selecionada** | cabeçalho, com confirmação |
| Duplicar | a **aba selecionada** | cabeçalho, com confirmação |
| Deletar versão | a **aba selecionada** | cabeçalho, à direita de Duplicar |
| `+` (nova versão) | o **orçamento** | à esquerda das abas |
| Editar parâmetros | a **aba selecionada** | linha de Moeda/Câmbio/Honorários/Impostos |

O `+` concentra as três portas de criação que antes eram dois botões no
cabeçalho do card mais o ícone de duplicar de cada linha: **criar do
zero**, **copiar uma versão existente** (submenu com o resumo de cada
uma) e **importar planilha (.xlsx)**.

**Deletar versão** ficou disponível para todos os papéis por enquanto,
por decisão do Tiago — o gate por perfil entra na etapa de permissões.

**A versão mais recente é sempre a aba mais à esquerda**, e é ela que leva
o selo "MAIS RECENTE". As abas saem ordenadas do maior número para o menor
e não há exceção a abrir: como versão fora do jogo é apagada, o maior
número é sempre o da primeira aba.

## 4. Os parâmetros da versão editam no lugar

Moeda, Câmbio, Honorários e Impostos deixaram o `VersaoEditorDrawer` e
viraram uma linha com um botão **Editar** à direita de Impostos, que
transforma os quatro campos em formulário sem tirar o usuário da planilha
que ele está lendo.

**As regras não mudaram**, porque a server action é a mesma
(`atualizarVersao`):

- Campo em branco **preserva** o valor atual.
- Impostos sai da lista fechada de `lib/impostos.ts` — `19,53` e
  `24,269914`, e só. O handoff mostrava uma lista fictícia (0 / 16,33 /
  19,53 / 19,54 / 20) que contradizia a decisão de 13/08/2026; valeu a do
  código.
- **Moeda** continua sendo código ISO de 3 letras digitado à mão, e não
  uma lista de três moedas como no handoff (decisão do Tiago).
- **Honorários** continua sendo o único campo com trava de papel: só
  administrador diverge do padrão do cliente. Para os demais o valor
  aparece travado, e a action recusa mesmo que alguém contorne a tela.
- Versão **aprovada** não abre o modo de edição.

## 5. O que veio do handoff e o que não veio

**Veio:** as abas com o `+` à esquerda, os selos MAIS RECENTE e APROVADA,
o menu de criação em dois níveis, os popovers de confirmação, a linha de
parâmetros com edição no lugar, o card de indicadores à direita.

**Não veio — a planilha do handoff é ilustrativa.** Ela desenha ORÇADO
grafite, PLANEJADO azul e RENTABILIDADE verde, que é a paleta **invertida**
em relação à decisão 015 (`_planilha/blocos.ts`: ORÇADO azul, PLANEJADO
verde, RENTABILIDADE grafite), e não mostra a calha de BV, a chave Bruto
⇄ Líquido nem o "Recolher todos". A planilha real foi reaproveitada
inteira; só o entorno mudou (decisão do Tiago).

**Não veio o texto do banner de protegido.** O handoff escreve "Novas
versões e edições ficaram bloqueadas", o que não é verdade: versão
substituída continua editável mesmo com job criado. O banner diz o que o
sistema faz de fato — "Os dados do orçamento e a criação de novas versões
ficaram bloqueados".

## 6. Deletar, e não cancelar

**Primeira versão desta decisão dizia "Cancelar versão". Estava errado.**
Cancelar marcava `versoes_orcamento.status = 'cancelada'` e deixava a
versão no banco, ainda visível e selecionável na fita de abas. O Tiago
apontou o óbvio: se a versão continua existindo e navegável, o estado
extra não resolve nada que simplesmente **não aprová-la** já não
resolvesse. O botão apaga de verdade.

**O que é apagado:** a versão, seus grupos, seus itens e os BVs dos itens.
Sem lixeira, sem desfazer. A confirmação diz o que vai embora, contado
("junto com 2 grupos, 7 itens e 1 BV").

**O que trava, e por quê:**

| Trava | Motivo |
| --- | --- |
| Versão **aprovada** | `orcamentos.versao_aprovada_id` é ON DELETE SET NULL: apagar desfaria a aprovação em silêncio. O caminho é "Cancelar aprovação" e só então deletar. **O botão nem aparece** nessa aba (decisão do Tiago) — não é ação desabilitada, é ação que não existe ali. |
| Versão que **virou job** | `jobs.versao_orcamento_aprovada_id` é ON DELETE RESTRICT. Inalcançável pela tela (job exige versão aprovada), mas a action checa assim mesmo, para responder com frase em vez de erro de FK. |
| **Última** versão do orçamento | O orçamento nasce com a v1 e nenhum jamais ficou sem versão. Aqui o botão fica **visível e desabilitado**, com o motivo no tooltip: sumir seria pior, porque ele apareceria e desapareceria conforme se cria versão, sem ensinar a regra. |

As três valem no **servidor** (`deletarVersao`), não só na tela — conferido
chamando a action pelo console, por fora do cliente.

**As versões que já estavam canceladas foram apagadas** pela migration
`20260821000003`: duas, uma de 29/07 e a criada na própria conferência
desta entrega. O valor `cancelada` continua no enum de status como rede de
segurança; nenhum caminho da UI o produz mais.

## 7. Duplicar também é criar versão

`criarVersao` sempre recusou orçamento `job_criado` ou `cancelado`.
`duplicarVersao` **não recusava** — e o botão "Duplicar" da lista antiga
não tinha gate nenhum, então um orçamento fechado aceitava ganhar uma v+1
pelo caminho da cópia. A trava passou a valer nas duas, no servidor.

## 8. Server action que redireciona devolve `undefined`

Achado durante a conferência, vale para todo o projeto: uma Server Action
que chama `redirect()` **não devolve valor ao cliente** — o `await`
resolve `undefined` e a navegação já aconteceu. Ler `res.ok` direto
quebra a tela com `Cannot read properties of undefined`.

`criarVersao`, `duplicarVersao` e `criarOrcamento` passaram a declarar
`Promise<ActionResult | void>`, e os call sites testam `res && !res.ok`.
Antes o tipo mentia e o defeito só não aparecia porque o redirect trocava
de página e desmontava o componente antes da leitura.

**Consequência da fusão:** como o redirect agora cai na **mesma** rota, só
trocando o `?v=`, drawer e popover não são mais desmontados pela
navegação e precisam se fechar sozinhos no sucesso.

## 9. Deletar em três statements não é deletar

A primeira versão de `deletarVersao` apagava itens, grupos e versão em
três chamadas ao PostgREST. São três transações: a terceira falhou na
conferência (faltava o GRANT), e a versão ficou no banco **sem os itens e
sem os grupos**, em silêncio. Nesse caso o estrago foi zero porque a
versão de teste estava vazia; com conteúdo, teria sido perda de dado sem
aviso.

Virou uma RPC, `deletar_versao_orcamento` — uma chamada, uma transação, ou
apaga tudo ou não apaga nada. `SECURITY INVOKER`: não é bypass de RLS, é
empacotamento transacional; as policies de tenant continuam valendo.

A **ordem** dentro dela (item → grupo → versão) também não é decoração.
`versoes_orcamento` tem CASCADE para grupos e para itens, mas
`versoes_orcamento_itens.grupo_id` referencia o grupo com **RESTRICT**, que
é checado na hora — diferente de NO ACTION, que espera o fim do statement.
Um `delete from versoes_orcamento` seco pode, dependendo da ordem que o
Postgres escolher para as cascatas, bater no RESTRICT e falhar inteiro.

## Arquivos

| Arquivo | O quê |
| --- | --- |
| `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx` | reescrita: cabeçalho do orçamento + abas + conteúdo da versão ativa, em duas ondas de query |
| `app/(app)/orcamentos/[projetoId]/[orcId]/abas-versoes.tsx` | **novo** — abas e o menu `+` |
| `app/(app)/orcamentos/[projetoId]/[orcId]/acoes-versao.tsx` | **novo** — Exportar / Duplicar / Cancelar versão |
| `app/(app)/orcamentos/[projetoId]/[orcId]/meta-versao.tsx` | **novo** — parâmetros da versão com edição no lugar |
| `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/page.tsx` | virou `permanentRedirect` para `?v=` |
| `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/versoes-list.tsx` | **removido** |
| `versoes/nova-versao-drawer.tsx` · `versoes/importar-drawer.tsx` | controle externo (`aberto`, `onAbertoChange`, `semGatilho`) para o menu `+` abrir |
| `versoes/actions.ts` · `[projetoId]/actions.ts` | redirects para `?v=`, `revalidatePath` na rota nova, retorno `ActionResult \| void`, trava de status em `duplicarVersao`, `cancelarVersao` → `deletarVersao` |
| `lib/auth/audit.ts` | ação nova `versao_orcamento.deletada` |
| `supabase/migrations/20260821000003_remover_versoes_canceladas.sql` | **destrutiva, autorizada** — apaga as 2 versões que estavam `cancelada` |
| `supabase/migrations/20260821000004_delete_de_versao_orcamento.sql` | GRANT de DELETE + policy `versoes_delete` (a tabela não tinha nenhum dos dois) |
| `supabase/migrations/20260821000005_rpc_deletar_versao_orcamento.sql` | RPC que apaga item → grupo → versão numa transação só |
| `[projetoId]/orcamento-form.tsx` | guarda o retorno de `criarOrcamento` |
| `agregado/actions.ts` · `_bv/actions.ts` | `revalidatePath` aponta para a tela do orçamento |
