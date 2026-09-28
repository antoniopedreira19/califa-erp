# 106 — Faixa do projeto: a agregada e cada orçamento ou job em abas, no topo da tela

**Data:** 2026-09-25
**Decidido por:** Tiago
**Migration:** nenhuma.

---

## 1. O problema

Para ir de um job ao outro do mesmo projeto, ou do job para a visão
agregada, o caminho era voltar para a lista e entrar de novo. A árvore de
jobs sob o título da agregada e o card "Jobs do projeto" da ficha ajudavam,
mas só de um lado: da página do job não havia caminho para a agregada, e em
Orçamentos não havia nada entre um orçamento e outro.

## 2. O que foi escolhido

Três desenhos foram prototipados (artifact "Abas do projeto", 25/09/2026),
sobre as telas reais do TES-0002/26 e do AMB-0004/26: **A** faixa do
projeto no topo, **B** abas sublinhadas acima do título, **C** abas-cartão
com valor e status. O Tiago escolheu a **A**.

- **Uma barra branca na primeira linha da tela**, antes do cabeçalho: o
  voltar, o projeto (código e nome) e as abas em pílula. A primeira aba é
  sempre a **Visão agregada**; depois, cada orçamento ou job, com código e
  nome.
- **Forma própria para o nível do projeto.** A aba aberta é uma pílula
  grafite, a cor da barra lateral; as abas de versão e de seção seguem com
  o sublinhado vermelho. São três níveis na tela do orçamento (projeto,
  versão, seção da planilha), e cada um tem uma forma.
- **O voltar entra na faixa**, com o mesmo destino de antes e o texto
  encurtado ("Jobs", "Visualizar Jobs", "Orçamento TES-0001/26-11"); o
  texto completo fica no `title`. Em Orçamentos, seta e projeto são um link
  só, porque o voltar já ia para o projeto. Com isso o título desce só
  +29 px em relação a antes (a B custava +58 px e a C +106 px).
- **Orçamento travado** (aprovado ou com job) leva o cadeado que a
  agregada mostra como "Somente leitura"; **em revisão**, um ponto âmbar.
- **Quando as abas não cabem**, os nomes vêm cortados com reticências (o
  nome inteiro no `title`), a aba aberta rola para ficar à vista e aparece
  o botão **Todos**, com a lista inteira. O menu fecha com Esc, clique
  fora, o próprio botão ou a escolha de um item.

Vale para as seis telas: orçamento e agregada de Orçamentos, job e
agregada de Jobs, job e agregada do Financeiro. O Financeiro não sai do
módulo: as abas dele levam a `/financeiro/jobs/…` e
`/financeiro/projetos/…`.

## 3. As regras (respostas do Tiago, 25/09/2026)

| Pergunta | Resposta |
|---|---|
| A árvore de jobs sob o título da agregada sai? | **Fica.** Ela mostra o status de cada job. O clique leva ao job como a aba dele na faixa levaria. |
| O card "Jobs do projeto" da ficha fica? | **Fica.** |
| Vindo da agregada, o job abre em qual aba? | **Planilha Interna**, nos dois módulos — pela faixa, pela árvore, pelo "Abrir job" do bloco e pelo código no card de Totais. Em Jobs isso muda: antes abria em Informações. |
| Quais itens viram aba? | **Os mesmos da agregada de cada módulo.** Orçamentos: todos, menos cancelados e recusados. Jobs: todos, menos cancelados. Financeiro: os da lista "Visualizar Jobs" (`STATUS_NA_LISTA`), no projeto do financeiro. O JOB-0033 (rejeitado pelo financeiro) aparece em Jobs e não no Financeiro. O item aberto na tela entra sempre, para a faixa nunca ficar sem aba marcada. |
| Nome que repete o do projeto encurta? | **Não por enquanto.** Nome inteiro, cortado com reticências. Encurtar depois é regra só de tela (trecho antes de " \| " que é começo do nome do projeto); hoje afetaria 4 dos 16 jobs ativos. |

**Entre jobs, a aba de seção se mantém**: quem está na Planilha Interna do
JOB-0042 cai na Planilha Interna do JOB-0044, e o mesmo com PPs, Fluxo de
Caixa ou Comunicação. **Exceção do Financeiro**, proposta no protótipo e
mantida: com a agregada no **Fluxo de Caixa do Projeto**, o job abre no
**Fluxo de Caixa do Job**, e a volta de um job no fluxo cai na agregada no
fluxo. Para tirar a exceção, basta trocar o ramo `fluxo` em
`destinoDaAba`.

## 4. Como funciona

- **A regra mora num lugar só:** `lib/faixa-do-projeto.ts` —
  `destinoDaAba` (para onde leva cada aba, dado onde a pessoa está) e os
  montadores `itensDeOrcamentos` e `itensDeJobs`. Testes em
  `lib/faixa-do-projeto.test.ts` (`node --import tsx --test`).
- **O desenho:** `components/faixa-do-projeto.tsx` (`FaixaDoProjeto` e o
  `LinkDoJobNaAgregada` da árvore do Financeiro). É client só para ler o
  `?aba=` e medir se as abas cabem; os itens chegam prontos do servidor.
- **A aba de seção vive no `?aba=`.** As abas do job no Financeiro já
  gravavam; as do job em Jobs (`job-tabs.tsx`) e as da agregada do
  Financeiro (`projeto-tabs.tsx`) passaram a gravar, com `replaceState` —
  sem router, porque as páginas são `force-dynamic`. O Next reflete o
  `replaceState` no `useSearchParams`, e a faixa lê a aba a cada render.
- **Em Jobs, o `?from=jobs` acompanha** a navegação pela faixa: é ele que
  faz o voltar do job levar à lista de jobs, e não ao orçamento.
- **Consultas:** nas páginas de job e nas agregadas, os irmãos já eram
  carregados (a ficha e os blocos usam a mesma lista). Na tela do
  orçamento, a faixa busca os orçamentos do projeto sozinha
  (`faixa-orcamentos.tsx`, quatro colunas, `idx_orcamentos_projeto`)
  dentro de um `<Suspense>` cujo fallback é a mesma faixa sem os itens —
  a altura não muda quando eles chegam. Todos os links com
  `prefetch={false}`.
- **Job sem projeto do financeiro** (anterior à migration
  20260820000011) não tem agregada no Financeiro: nele fica o voltar de
  antes, sem faixa.
