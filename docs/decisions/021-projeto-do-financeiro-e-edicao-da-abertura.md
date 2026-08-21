# 021 — Projeto do financeiro, contas do job e edição do registro da abertura

**Data:** 2026-08-20
**Design:** `Abertura de Job - Financeiro.dc.html`
**Migration:** `20260820000011_projetos_financeiro_e_contas_do_job.sql`

---

## 1. O projeto do financeiro é outro projeto

O formulário de abertura ganhou um campo **Projeto**, editável, com
"Criar projeto para este job". A arrumação que o financeiro faz ali vale
**só no financeiro** — exatamente como `jobs.nome_financeiro` pode
divergir de `jobs.nome`.

`jobs.projeto_id` continua intocado: é o projeto da produção, nasce do
orçamento e segue mandando em Orçamentos e na página de Jobs. O projeto
do financeiro mora em `jobs.projeto_financeiro_id`, apontando para a
tabela nova `projetos_financeiro`.

### Por que tabela nova, e não uma FK para `projetos`

Reusar `projetos` entregaria isolamento **por filtro**: o projeto criado
pelo financeiro cairia na mesma tabela que alimenta a lista de
Orçamentos, e só ficaria escondido enquanto toda tela que lista projeto
lembrasse de excluí-lo. Com duas frentes empurrando no mesmo `main`, a
primeira tela nova escrita sem o filtro reabre o vazamento sem quebrar
nada — ou seja, ninguém percebe.

Segundo motivo: `projetos` tem quatro colunas `NOT NULL` que o financeiro
não tem por que preencher (`responsavel_id`, `data_inicio_prevista`,
`empresa_id`, `cliente_id`). Herdar valor do job para satisfazer
constraint é dado inventado, e dado inventado depois é lido como verdade.

### O backfill

A migration espelhou os 12 projetos existentes em `projetos_financeiro` e
apontou os 16 jobs para o espelho do seu projeto de produção. Sem isso o
combo "Projetos abertos" nasceria vazio para todo job. É backfill que
preenche coluna recém-criada — lado aditivo do `docs/FLUXO-BANCO.md`.

### Onde a arrumação aparece

Na aba "Visualizar Jobs" (nome novo de "Jobs abertos") da Abertura de
Job, no campo Projeto do formulário, na ficha da aba Informações do job
aberto, e na **visão agregada do projeto no financeiro**
(`/financeiro/projetos/[projetoId]`) — ver seção 5.

### Sequencial próprio

`lib/codigos/projetos-financeiro.ts` gera o código no mesmo formato do da
produção (`CLIENTE-0007/26`), mas contando dentro de
`projetos_financeiro`. Os dois espaços são independentes de propósito: as
arrumações divergem, e amarrar o sequencial do financeiro ao da produção
faria o número pular sem motivo visível.

---

## 2. Uma conta bancária de entrada e uma de saída, por job

O seletor do protótipo mora no **cabeçalho da seção** de previsão, não na
linha da tabela — então a conta é do job inteiro, e as colunas ficam em
`jobs`: `conta_recebimento_id` e `conta_pagamento_id`.

Ambas **opcionais**: o protótipo não marca nenhuma das duas com
asterisco, e job sem faturamento previsto (cliente paga direto ao
fornecedor) não tem por que ter conta de recebimento.

O saldo mostrado em cada opção vem de `fc_saldos_por_conta` (migration
`20260817000006`), a mesma função do Fluxo de Caixa — nunca de uma conta
feita à parte, que divergiria.

---

## 3. Editar o registro da abertura: congela o consumido, libera o saldo

Job já aberto tem "Editar registro" na aba **Abertura do Job**. Reescreve
nome no financeiro, projeto, contas, categoria, competência e as duas
previsões.

**Nunca muda:** `data_abertura_financeiro`, `aberto_por` e `status`. A
abertura aconteceu uma vez; reescrever quem conferiu apagaria a única
prova de quem conferiu.

### A regra da trava

> "Sempre consumir o saldo da parcela mais próxima, e a lógica permanece a
> mesma. Só será congelado o que for consumido, e só será consumido o
> saldo da parcela mais próxima." — Tiago, 20/08/2026

O consumo anda **em ordem de data**, da parcela mais próxima para a mais
distante, e para exatamente onde o total consumido acaba. A parcela que
fica no meio do caminho **parte em duas**: a fatia consumida (congelada,
com cadeado na tela) e o resto (livre). Congelar a parcela inteira
travaria dinheiro que ninguém gastou.

Vale igual para as duas previsões:

| Previsão | O que consome |
|---|---|
| Curva de custo | PPs que não foram canceladas nem rejeitadas |
| Recebimento | Notas emitidas do job |

O total continua fechando com o custo previsto e com o faturamento
previsto, como na abertura: o que a edição libera é a **distribuição**,
não o dinheiro.

**Exemplo real (JOB-0015, 20/08/2026).** Custo previsto R$ 24.000, curva
`12.000 (20/08)` + `12.000 (08/09)`, PPs emitidas R$ 18.000. A tela passa
a mostrar três linhas: `12.000 (20/08)` 🔒, `6.000 (08/09)` 🔒 e
`6.000 (08/09)` livre.

**Exemplo real (JOB-0013).** Custo R$ 65.000, curva `40.000 (20/08)` +
`25.000 (08/09)`, PPs R$ 37.500 → `37.500 (20/08)` 🔒, `2.500 (20/08)`
livre e `25.000 (08/09)` livre.

### Uma implementação só

A regra mora em `lib/calculos/previsao-congelada.ts` e é usada pelos dois
lados: a tela desenha as linhas travadas com ela, e a Server Action
recusa a edição com ela. Duas implementações divergiriam no primeiro
centavo. `pedidos_compra` não tem coluna apontando para a linha da curva
— o vínculo é sempre por total consumido, e a distribuição é derivada.

### Registro da alteração

**Só na auditoria** (`audit_events`, ação `job.registro_abertura_editado`),
com o de/para de cada campo e das duas previsões, e o usuário que salvou.
Sem bloco de histórico na tela — decisão explícita do Tiago em
20/08/2026.

---

## 4. A tela do job aberto virou casca de cinco abas

`/financeiro/jobs/[jobId]` deixou de ser um resumo em cards: agora tem
**Abertura do Job · Informações do Job · Planilha Interna · Fluxo de
Caixa do Job · Comunicação**.

A decisão anterior desta página — *"planilha interna, erratas e chat
continuam morando na página de Jobs; daqui se navega para lá, sem
duplicar tela cara de manter"* — **continua valendo**. O que mudou é como
ela é atendida: por **reuso**, e não por link para outra rota.

Para isso, o carregamento de `/jobs/[jobId]` saiu da página e virou
`app/(app)/jobs/[jobId]/carregar-detalhe.ts`. As duas telas chamam a
mesma função e montam só o cabeçalho e as abas que são delas. O
financeiro renderiza a Planilha Interna sempre com `editable={false}` e
`podeAcoes={false}`: quem edita realizado, BV e PP é a produção.

A aba **Fluxo de Caixa do Job** lê `vw_fluxo_caixa` filtrada por
`job_id`. A view já resolve as três classes que o protótipo desenha como
sub-linhas (`movimento`, `titulo`, `previsao`) e já resolve o abatimento
da previsão por PP e por nota. Refazer essa conta na tela era o caminho
garantido para ela divergir do Fluxo de Caixa geral.


---

## 5. O financeiro não encaminha para telas de outros módulos

> "O módulo financeiro não deve encaminhar a telas de outros módulos."
> — Tiago, 20/08/2026

A "Visão agregada" da faixa de grupo apontava para `/jobs/projeto/[id]`,
tela da PRODUÇÃO. Além de sair do módulo, ela não serviria: lá o
agrupamento é por `jobs.projeto_id`, e o grupo do financeiro pode juntar
jobs que na produção estão em projetos diferentes.

Entrou `/financeiro/projetos/[projetoId]`: cabeçalho com código e nome,
quatro cards (Cliente, Jobs no financeiro, Valor total, Faturados N de M)
e a tabela "Jobs do projeto".

### Quais jobs entram

`aguardando_abertura`, `aberto`, `em_producao` e `encerrado`. Ficam de
fora `rejeitado_financeiro` e `cancelado` — job que o financeiro devolveu
ou que morreu não soma no total do projeto.

`em_producao` é status legado (nenhum job novo cai nele), mas quem
estiver lá passou pela abertura: tirá-lo faria o job sumir do agregado no
meio da vida.

### A margem é sobre o faturável

`faturamento previsto − custo previsto`, e **não** `valor total − custo`,
que era o que o protótipo desenhava. O valor total inclui o que o cliente
paga direto ao fornecedor (tipos A/D) e esse dinheiro nunca passa pelo
caixa da California (decisão 004). Em PEVETE-0001/26, com três jobs, as
duas contas davam **R$ 129.014,39** (protótipo) contra **R$ 41.014,39**
(esta regra) — R$ 88.000 de diferença.

É a mesma conta da "Margem prevista" do formulário de abertura, e é o que
o próprio subtítulo do protótipo diz: *"valor faturável × custo previsto
no financeiro"*.

Por causa disso a tabela tem **sete colunas**, e não as seis do
protótipo: "Faturável" entrou entre "Valor total" e "Custo previsto",
senão a subtração não fecharia aos olhos de quem lê. "Valor total" fica
como referência, a pedido do Tiago.

Job que ainda não passou pela abertura mostra **travessão** em Custo
previsto, e não R$ 0,00 — zero leria como "não vai custar nada".

### O que mais deixou de sair do módulo

| Onde | Ia para | Vai para |
|---|---|---|
| Faixa de grupo, "Visão agregada" | `/jobs/projeto/[id]` | `/financeiro/projetos/[id]` |
| Ficha do job, card Projeto | `/orcamentos/[projetoId]` | `/financeiro/projetos/[id]` |
| Ficha do job, "Jobs do projeto" | `/jobs/[id]` | `/financeiro/jobs/[id]` |
| Conferência da fila, "Visualizar planilha interna" | `/jobs/[id]?aba=planilha` | `/financeiro/abertura-de-job/[id]/planilha` |

A lista "Jobs do projeto" da ficha também passou a trazer os irmãos do
projeto **do financeiro**, e não os do projeto da produção — é o
agrupamento desta tela.

### A exceção: o orçamento de origem

"Orçamento aprovado" continua levando a `/orcamentos/.../versoes/...`. É
o único caso sem equivalente no financeiro: orçamento só existe naquele
módulo, e sem esse caminho o financeiro perde de vista de qual orçamento
o job nasceu.

A saída é **explícita**: o clique abre uma confirmação dizendo para onde
a pessoa vai ("Sair para o módulo de Orçamentos?"), com *Ficar no
financeiro* como alternativa. O componente é
`components/financeiro/link-saida-de-modulo.tsx`, e ele é um `button`, e
não um `<a>` — link de verdade abriria em nova aba no ctrl-clique,
pulando a confirmação.

### Pendência conhecida

`app/(app)/financeiro/contas-a-pagar/pp-drawer-financeiro.tsx` ainda
aponta para `/jobs/[id]`. Não foi corrigido nesta rodada porque o arquivo
tem commits do Antonio, e o Tiago preferiu não colidir com a frente dele.
