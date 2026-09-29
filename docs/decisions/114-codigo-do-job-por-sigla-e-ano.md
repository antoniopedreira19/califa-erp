# 114 — O código do job é [SIGLA]-[SEQ]/[AA], com 1 na frente em 2026; o projeto leva P, e o do financeiro F

**Data:** 2026-09-28
**Decidido por:** Tiago
**Migrations:** ⚠️ as duas destrutivas, aplicadas juntas em 28/09/2026, na
hora combinada com a frente do Antonio, com o código publicado logo depois
(`3305751`):
- `20260928200001_codigo_do_job_por_sigla.sql` — sobrescreve `jobs.codigo`;
- `20260928200002_codigo_do_projeto_p_e_f.sql` — sobrescreve
  `projetos.codigo`, `orcamentos.codigo` e `projetos_financeiro.codigo`.

---

## 1. O problema

O job era `JOB-NNNN`, um sequencial único da agência. O Tiago apontou que o
formato que o ERP usava para os **projetos** (`AMB-0006/26`: sigla do
cliente, sequencial, ano) é o que a agência usa para os **jobs**. E o outro
sistema da agência também abre jobs nesse formato — ainda abaixo do
milhar —, então os códigos do ERP não podem repetir os dele.

Plano com o de-para completo e as opções:
https://claude.ai/artifact/LCRzQt1wbr3jL2YnUdbjS9

## 2. A regra

1. **Formato:** `[SIGLA]-[SEQ_4]/[AA]`. Ex.: `AMB-1006/26`.
2. **SIGLA:** o código curto **atual** do cliente do projeto do job. Não a
   sigla gravada no código do projeto, que envelhece quando o projeto
   troca de cliente (o `HIT-0001/26` é da Universal: os jobs dele são
   `UER-…`).
3. **AA:** o ano em que o job é **criado** (quando ele ganha código), no
   fuso de São Paulo. Não a data de início, que se edita depois.
4. **SEQ:** por sigla e ano — o maior número já usado + 1. Número não volta
   a ser usado: cancelado, devolvido ou apagado queima o dele.
5. **O 1 de 2026:** em 2026 o sequencial começa em **1001** ("um 1 no lugar
   do primeiro 0"), para nunca repetir um código do outro sistema. De 2027
   em diante começa em **0001** — vale enquanto o outro sistema não abrir
   jobs depois de 2026.
6. **Código anterior:** os jobs que existiam guardam o `JOB-NNNN` em
   `jobs.codigo_anterior`. A ficha do job mostra "Código anterior", e a
   busca da fila, do Visualizar Jobs e da lista de Jobs acha pelos dois.

### 2.1 Projeto, orçamento e projeto do financeiro

Com o formato do projeto passando para o job, o projeto precisava de outro
(D5 e D6 do plano, aprovadas pelo Tiago em 28/09/2026):

1. **Projeto da produção:** `P` no lugar do primeiro zero, **o número fica
   o mesmo**. `AMB-0006/26` → `AMB-P006/26`. Sequencial e ano seguem a
   regra de sempre (`lib/codigos/projetos.ts`).
2. **Orçamento:** acompanha o projeto. `AMB-0006/26-01` → `AMB-P006/26-01`.
3. **Projeto do financeiro:** `F` no lugar do primeiro zero, em sequência
   própria como antes. `AMB-0004/26` → `AMB-F004/26`.
4. **Os dois cadastros continuam separados.** O projeto da produção e o do
   financeiro são arrumações diferentes — o financeiro pode agrupar os jobs
   do jeito dele —, cada um com a sua numeração. Até aqui os dois usavam o
   mesmo formato, e 8 códigos existiam nos dois lados apontando para
   projetos diferentes (o `TES-0002/26` era "Teste Demo" na produção e
   "Teste Always On" no financeiro); a letra desfaz a coincidência.
5. **Por que a letra no primeiro zero:** ninguém tem mil projetos de um
   cliente num ano, então esse zero não carregava informação. Com 1, P ou F
   no lugar dele, job, projeto e projeto do financeiro têm o mesmo
   comprimento e a mesma leitura (cliente, número, ano), e nunca são
   iguais, em 2026 ou depois.
6. **Código anterior:** as três tabelas ganham `codigo_anterior`. O
   cabeçalho da página do projeto (produção e financeiro) mostra "Código
   anterior"; a busca da lista de projetos e a do campo Projeto da abertura
   acham pelos dois.
   ⚠️ **29/09/2026:** o "Código anterior" saiu dos dois cabeçalhos de
   projeto, porque o Tiago não viu utilidade (decisão 122, §6). A coluna e a
   busca ficam; a ficha do job continua mostrando o dela.

## 3. A troca dos jobs existentes

Os 23 jobs de 28/09/2026, em ordem de criação dentro da sigla (ensaio de
28/09 conferido contra o plano, 23 códigos distintos):

- **AMB:** JOB-0024 → AMB-1001/26 · 0025 → 1002 · 0031 → 1003 · 0033 → 1004
  · 0035 → 1005 · 0036 → 1006 · 0037 → 1007 · 0038 → 1008 · 0045 → 1009.
- **TES:** JOB-0032 → TES-1001/26 · 0034 → 1002 · 0039 → 1003 · 0040 → 1004
  · 0041 → 1005 · 0042 → 1006 · 0043 → 1007 · 0044 → 1008 · 0047 → 1009 ·
  0048 → 1010 · 0050 → 1011 · 0051 → 1012.
- **UER:** JOB-0046 → UER-1001/26 · 0049 → UER-1002/26.

A migration guarda o código anterior, troca o código e grava um evento
`job.codigo_trocado` por job. Nada fora de `jobs.codigo` guarda o código do
job como texto; o histórico de auditoria e os arquivos já emitidos (PDFs de
PP, planilhas) ficam com o código antigo.

### 3.1 A troca dos projetos existentes

Ensaio de 28/09 conferido contra o plano: 16 projetos, 39 orçamentos e 17
projetos do financeiro, todos no formato `[SIGLA]-0NNN/AA`, e todo orçamento
começando pelo código do próprio projeto. Cada código troca só o primeiro
zero: `AMB-0003/26` → `AMB-P003/26` … `TES-0003/26` → `TES-P003/26`;
`AMB-0004/26-03` → `AMB-P004/26-03`; no financeiro `AMB-0004/26` →
`AMB-F004/26` … `UER-0001/26` → `UER-F001/26`. Um evento
`projeto.codigo_trocado`, `orcamento.codigo_trocado` ou
`projeto_financeiro.codigo_trocado` por linha.

Nenhuma função ou view do banco monta ou lê o formato, e o resto do banco
aponta para projeto e orçamento pela chave. As planilhas exportadas antes da
troca voltam pelo Importar: ele acha os orçamentos pelos ids escondidos, não
pelo código.

## 4. O que muda no sistema

- `lib/codigos/jobs.ts`: gerador novo (`gerarCodigoJob` recebe o projeto),
  `proximoCodigoDeJob`, `anoDoCodigoDeJob` e `compararCodigosDeJob` (ano e
  número). Testes em `lib/codigos/jobs.test.ts`.
- **Ordem:** oito consultas que ordenavam jobs por `codigo` passam a
  ordenar por `created_at` — com `JOB-NNNN` o texto era a ordem de criação;
  com a sigla na frente, não é. A lista de Jobs da produção ordena grupos e
  jobs pela criação; a faixa do projeto e o desempate do Visualizar Jobs
  usam `compararCodigosDeJob`.
- **Prévia do próximo código** na tela do orçamento: sigla do cliente e ano
  de hoje; cliente sem código curto mostra travessão (o envio recusa).
- `lib/types.ts` (`Job`), `JobNaFila`, `JobAberto`, `JobRow` e a ficha
  ganharam `codigo_anterior`, obrigatório.
- **Projetos:** `proximoCodigoDeProjeto` recebe a letra (`P` ou `F`); o
  código de antes da troca (zero no lugar da letra) conta para o maior
  número, para um projeto criado no intervalo não repetir número. Testes em
  `lib/codigos/projetos.test.ts`. `Projeto`, `ProjetoRow` e
  `ProjetoFinanceiroOpcao` ganharam `codigo_anterior`, obrigatório.

## 5. Como publicar

O código lê as colunas `codigo_anterior`, que só existem depois das
migrations, e os geradores antigos deixam de achar código depois da troca.
Então, num horário sem uso e combinado com o Antonio:

1. aplicar as duas migrations pelo MCP, na ordem, e conferir no banco;
2. publicar o código no main logo em seguida;
3. conferir se algum job (`JOB-NNNN`), projeto, orçamento ou projeto do
   financeiro (`[SIGLA]-0NNN/AA`) foi criado no intervalo e, se houver,
   trocá-lo pela mesma regra;
4. conferir fila, Visualizar Jobs, lista de Jobs, ficha, faixa, prévia,
   lista de projetos, página do projeto (produção e financeiro) e busca do
   campo Projeto na abertura.

**Feito em 28/09/2026.** As duas migrations aplicadas e o código publicado
em seguida. No banco: 23 jobs, 16 projetos, 39 orçamentos e 17 projetos do
financeiro no formato novo, todos com `codigo_anterior` e um evento de
auditoria cada; nada criado no intervalo. Nas telas: a busca por `JOB-0036`
acha o `AMB-1006/26` na lista de Jobs e na fila, `JOB-0045` acha o
`AMB-1009/26` no Visualizar Jobs, `AMB-0006` acha o `AMB-P006/26` na lista
de projetos e o `AMB-F006/26` no campo Projeto da abertura; a ficha e o
cabeçalho das páginas de projeto mostram o código anterior; a prévia do
próximo job no projeto de teste é `TES-1013/26`. A primeira tentativa da
`20260928200002` falhou sem gravar nada — o `null` do autor, dentro de um
`union all`, virou `text` — e passou com `null::uuid`.

## 6. Fica de fora

- **Contas a Pagar** busca pelo código atual do job; o anterior não entra
  lá.
- **`vw_saves_por_job`** segue ordenada pelo código do job: a lista de
  saves fica agrupada por cliente.
- **Orçamento:** o código anterior fica só guardado; nenhuma tela o mostra.
- **Nomes repetidos no financeiro** ("Universal 4T 2026" três vezes, cinco
  projetos de teste da Pevetech): não mudam com os códigos; limpeza à parte.
