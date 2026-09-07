# 053 — Calendário de Jobs, e o serviço como eixo de cor

**Data:** 2026-09-07
**Status:** aceita
**Migrations:** `20260907100001_backfill_data_evento_dos_jobs.sql`
**Design:** `Calendario de Jobs.dc.html`, projeto Claude Design `69342d83`
**Contexto:** terceira aba de Abertura de Job
(`/financeiro/abertura-de-job?aba=calendario`). Lê o mesmo conjunto da
aba "Visualizar Jobs".

## O que a tela responde

Duas perguntas diferentes sobre a mesma lista, e o alternador no topo
separa as duas:

| Visão | Pergunta | Eixo |
|---|---|---|
| **Eventos no mês** | que eventos caem em cada dia? | `jobs.data_evento` |
| **Jobs ativos numa data** | o que está rodando nessa data? | `data_inicio_prevista` ≤ data ≤ `data_fim_prevista` |

A segunda é muito mais populosa que a primeira — um evento em setembro
costuma ter dois meses de job em volta —, e é por isso que cada célula do
mês traz, no canto, **quantos jobs estão ativos naquele dia**: é a ponte
entre as duas leituras. Clicar no dia abre os eventos daquela data, com
um caminho para a lista completa dos ativos.

## As três decisões do Tiago (07/09/2026)

### 1. Job sem data de evento recebe a data de fim

`jobs.data_evento` só virou obrigatória no envio do job em **27/08/2026**.
Os jobs anteriores nasceram sem ela: **24 dos 31** do tenant, sendo 18 dos
25 que o financeiro já abriu. Com isso, a visão "Eventos no mês" — que é
a visão de entrada — mostraria 2 marcas em agosto e 5 em setembro: a tela
nasceria vazia e passaria a impressão de que o dado sumiu.

A escolha foi **gravar**, não deduzir na tela: *"essa build atual é de
teste, quando for colocado em produção todo job terá uma data evento,
então vamos simular isso enquanto testamos"*.

⚠️ **A data preenchida pelo backfill não se distingue de uma informada
pela produção** — é a mesma coluna, sem marca de procedência. Foi
consciente: uma coluna a mais só para carimbar dado de teste não se
pagaria. Job novo continua chegando com a data de evento de verdade, e
ela substitui esta na primeira edição.

### 2. O calendário cobre o mesmo conjunto da aba ao lado

`aberto` + `em_producao` + `encerrado` — os 25 jobs de hoje, encerrados
inclusive. Duas leituras do mesmo conjunto divergiriam no primeiro job
que mudasse de status entre uma e outra, e a pessoa veria contagens
diferentes em duas abas da mesma tela. Job encerrado some da agenda
futura sozinho, pelas próprias datas.

Na prática isso quer dizer que o calendário **não tem query própria**: ele
recebe a mesma lista que "Visualizar Jobs" já desce do server component.

### 3. A cor vem do SERVIÇO, não da categoria

O design colore por categoria. No banco real a categoria é "Evento" em
**20 dos 25** jobs, "Conteúdo" em 1, e 4 não têm nenhuma — o calendário
sairia praticamente monocromático, e a legenda listaria 5 categorias com
zero jobs. O **serviço** (`orcamentos.servico_id`: Always On, Ativação,
Fee, Interno) está preenchido em 24 dos 25 e tem 3 valores em uso.

A coluna **Categoria** continua na tabela, ao lado de Serviço — o que
mudou foi só o que a cor separa.

A cor não é gravada em lugar nenhum: sai da **ordem alfabética dos
serviços presentes na lista**, sobre a paleta do design
(`#B3323C`, `#1D4ED8`, `#7C3AED`, `#047857`, `#A16207`), com cinza fixo
para "Sem serviço". Serviço novo entrando no cadastro pode deslocar as
cores dos que vêm depois dele no alfabeto — é o preço de não ter coluna
de cor no banco, e é aceitável porque a legenda está sempre na tela, ao
lado da grade.

## Serviço mora no orçamento, e não desce por embed

`jobs` não tem `servico_id`: o campo é do **orçamento** de origem
(desceu do projeto para o orçamento em 02/09/2026, decisão 037). O
caminho natural seria um embed aninhado no SELECT dos jobs — e é
exatamente o que **não** foi feito.

`orcamentos` tem **duas** FKs para `categorias_dominio`
(`categoria_id` e `servico_id`). Embed ambíguo no PostgREST não devolve a
coluna vazia: **derruba a query inteira**. A lista de jobs do financeiro
voltaria vazia, em silêncio, e junto com ela a aba "Visualizar Jobs", que
não tem nada a ver com esta coluna.

Em vez disso, `servicoPorOrcamento` (`lib/data/servicos.ts`) faz duas
leituras rasas — 49 orçamentos e 4 serviços hoje — e cruza em memória,
dentro do mesmo `Promise.all` que já busca os jobs. Falhando, o mapa vem
vazio e degrada **só** a coluna Serviço.

## Custo previsto é o do fluxo de caixa

A coluna "Custo previsto" é o mesmo número da coluna Custos de
"Visualizar Jobs": `vw_fluxo_caixa` somada por job (movimento + título +
previsão em aberto), com fallback no `custo_previsto_total` da abertura
quando o job não tem nada lançado. É o que o rodapé da tela diz —
*"planejado da planilha interna; item com todas as PPs geradas passa a
entrar pelo realizado"* — e é a regra da [052](052-todas-as-pps-do-item-foram-geradas.md).

## Datas são string, nunca `Date`

`calendario-datas.ts` trabalha com `YYYY-MM-DD` de ponta a ponta.
`new Date("2026-09-07")` é meia-noite **em UTC**, o que em São Paulo é
06/09 às 21h — o job apareceria no dia anterior ao que a produção
informou. E comparação de string em `YYYY-MM-DD` já é cronológica, então
"job ativo nessa data" não precisa de `Date` nenhum.

O "hoje" desce **do servidor**, formatado em `America/Sao_Paulo`
(`page.tsx`): calculado dentro do client component, servidor e navegador
renderizariam datas diferentes e o React acusaria divergência de
hidratação — o mesmo cuidado que `formatEnviadoEm` já toma na fila.
