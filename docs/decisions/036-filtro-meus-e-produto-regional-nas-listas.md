# 036 — Filtro "Meus" nas listas, e Produto/Regional em Jobs

**Data:** 2026-09-01
**Decidido por:** Tiago

Design: `Listas - Filtro Meus e Colunas Produto Regional.dc.html`.

---

## 1. "Meus / Todos" abre as duas listas, com Meus como padrão

Segmentado, e não checkbox: o par explícito deixa sempre visível em qual
recorte a lista está, sem obrigar a caçar um checkbox marcado. Mesmo
componente (`components/ui/chave-meus-todos.tsx`) e mesma posição —
primeiro item da barra — em `/orcamentos` e `/jobs`.

**Meus é o estado inicial.** Quem abre a lista quer o próprio trabalho, e
"Todos" fica a um clique.

## 2. Quem é "meu"

| Tela | Regra | Hoje |
|---|---|---|
| Jobs | o usuário é o GP (`jobs.responsavel_id`) **ou o produtor** (`jobs.produtor_id`) do job — ver nota de 03/10/2026 | 12 de 29 |
| Projetos | o usuário está **associado ao projeto ou a um orçamento dentro dele** | 12 de 18 ativos |

### A regra dos projetos

⚠️ **Ampliada pelo Tiago em 02/09/2026.** Nasceu em 01/09 como "sou
responsável ou produtor de algum job do projeto" (7 de 18) e passou a ser
**qualquer associação, como designado ou como criador**. São sete
vínculos, e basta um:

| Nível | Vínculos |
|---|---|
| Projeto | `responsavel_id`, `created_by`, `projeto_responsaveis` |
| Orçamento | `gp_responsavel_id`, `produtor_id`, `created_by` |
| Versão | `created_by` |

Só as designações dariam 10 de 18; incluir quem criou leva a 12. O Tiago
escolheu incluir: quem abriu o trabalho continua enxergando o projeto
mesmo depois de passar o GP para outra pessoa.

O vínculo por **job** (responsável/produtor) continua valendo por cima
disso. Hoje ele é redundante — medido na base, todo projeto que ele
alcança já chega por outro vínculo (a diferença deu **zero**) —, mas foi
mantido porque tirá-lo estreitaria o recorte de quem só está no job, e a
mudança era para ampliar.

**O que caiu junto:** a ressalva de que "projeto sem job nunca é meu".
Com os vínculos de projeto e orçamento valendo, um projeto recém-criado
já aparece para quem o criou, sem precisar de "Todos".

A nota do design dizia que "meu" projeto seria *"GP ou Produtor
responsável em qualquer versão de orçamento"*. Isso **não existe no
banco**: `versoes_orcamento` só tem `created_by`, sem GP nem Produtor —
esses dois moram em `orcamentos`, e é de lá que a regra os lê.

### Custo

`meusProjetoIds` sai das queries que a página **já fazia** (projetos,
orçamentos e jobs), mais duas consultas leves — `projeto_responsaveis` e
`versoes_orcamento` —, ambas **filtradas pelo próprio usuário**, então
voltam poucas linhas em vez de varrer para descartar no cliente.
`projeto_responsaveis(profile_id)` já tinha índice;
`versoes_orcamento(tenant_id, created_by)` ganhou o seu na migration
`20260902100001`.

## 3. Produto e Regional em Jobs vêm do PRÓPRIO job

Colunas novas na lista, e dois `Select` novos na barra. A fonte é
`jobs.produto` e `jobs.regional_id` — **não** o produto/regionais do
projeto, que era o que o protótipo mostrava.

Os dois divergem na base, e não por acidente: o **JOB-0003** tem produto
"Ativação de marca" dentro de um projeto cujo produto é "Pevetech". Os 29
jobs têm os dois campos preenchidos, então o do job sempre descreve
melhor aquela linha do que o herdado do projeto.

## 4. As pílulas de status viraram um Select de seleção única

Eram cinco pílulas combináveis e ocupavam a barra inteira, sem deixar
espaço para Produto e Regional. Agora são três `Select` iguais aos que já
existiam ("Todas as empresas"), com a primeira opção limpando o filtro e
**borda vermelha no trigger** quando há filtro aplicado.

⚠️ **Perda aceita e confirmada pelo Tiago:** não dá mais para ver dois
status ao mesmo tempo (ex.: Aberto + Encerrado). A alternativa seria um
componente de múltipla seleção, descartada para manter a barra com uma
gramática só.

## 5. O que NÃO mudou

Instrução explícita do Tiago: "utilize apenas os filtros do design e as
colunas adicionais; desconsidere o resto".

- A coluna **Projeto** continuou na lista de Jobs. O design a removia por
  repetir o cabeçalho do grupo; ficou até 05/10/2026, quando o Tiago a
  tirou (nota no fim).
- A barra de `/orcamentos` seguiu igual fora da chave nova — o mock do
  design mostra um filtro de "empresas" ali que **não** foi adicionado, e
  mantém o de **Ano**, que o mock não mostra.
- O recorte "Meus" de **Jobs** não mudou na ampliação de 02/09: continuou
  sendo `jobs.responsavel_id`. A ampliação foi pedida para a lista de
  projetos, onde a associação tem mais de uma porta de entrada. O produtor
  entrou depois, em 03/10/2026 (nota abaixo).
- Nenhuma mudança de layout, cor ou tipografia das duas tabelas.

## ⚠️ O produtor também é dono do job no "Meus" de Jobs (2026-10-03)

Notificação recebida pelo Tiago: no acesso de produtor, o "Meus" da lista
de jobs não funcionava. A regra era só `jobs.responsavel_id` — o GP —, e o
produtor quase nunca é o GP do job: medido em 03/10/2026, 8 produtores
(7 pessoas e o "Produtor Teste") eram `produtor_id` de 1 a 3 jobs e
responsáveis por nenhum, então abriam a lista em "Meus" (o padrão) e viam
"Nenhum job com esse recorte".

**Regra agora:** o job é "meu" se sou o GP **ou** o produtor dele. É a
mesma régua que a lista de projetos já usava para o vínculo por job (§2) e
que o card "Realizado a preencher" da home do produtor já contava — o card
abria a lista com `meus=1` e a lista mostrava zero.

- GP e administrador: nada muda hoje. Nenhum deles é produtor de um job em
  que não seja também o GP (medido em 03/10/2026, 32 jobs).
- "Quem criou" o job (`jobs.created_by`) continua fora do recorte de Jobs,
  como em 02/09. Hoje só 1 job tem criador fora de GP e produtor.
- "Todos" não mudou e foi conferido logado: administrador, GP e produtor
  veem os mesmos 32 jobs. A RLS de `jobs` só recorta por empresa/regional
  (e Equipe do projeto para o freelancer), e todo produtor ativo tem acesso
  às empresas dos 32.
- Os cards de AÇÃO da home do GP ("pendentes de envio para faturamento",
  "prontos pra encerrar") continuam contando só `responsavel_id`. Enquanto
  nenhum GP for produtor de job de outro GP, o número do card e o da lista
  em "Meus" coincidem.

Código: `app/(app)/jobs/page.tsx` (lê `produtor_id`) e
`app/(app)/jobs/jobs-list.tsx` (`JobRow.produtor_id`, filtro e texto do
estado vazio).

## ⚠️ Freelancer: o "Meus" é a Equipe do projeto (2026-10-03)

Regra do Tiago: para o freelancer, o "Meus" não sai de GP nem de
produtor — sai da **Equipe do projeto**, e todos os orçamentos (e jobs)
do projeto aparecem para todos que estão na Equipe.

O freelancer não tem a chave "Meus/Todos": as duas listas abrem sem
filtro na tela e mostram o que a RLS entrega. Então a regra mora no
banco, em `is_freelancer_do_projeto`, e foi lá que ela foi ajustada:

- **A Equipe agora é a mesma da tela** (decisão 037): linha em
  `projeto_responsaveis` (GP ou equipe), **criador do projeto** ou
  **produtor de algum orçamento** do projeto. Antes, só a primeira —
  um freelancer escolhido como produtor aparecia na Equipe como chip
  travado e não via o projeto. Migration `20261003200001`.
- **O recorte não estava valendo.** Desde a `20260909000003`
  (empresa_members), as policies `projetos_modify`, `orcamentos_modify` e
  `jobs_modify` eram FOR ALL sem a cláusula do freelancer — e FOR ALL vale
  também para leitura. A `pp_select` tinha perdido a cláusula. Simulando
  a RLS como um freelancer sem equipe nenhuma: 31 projetos, 61
  orçamentos, 32 jobs e 71 PPs visíveis (versões e itens vinham
  zerados). As cinco policies ganharam a cláusula — migrations
  `20261003200002` e `20261003200003` (a segunda só troca `auth.uid()`
  por `(select auth.uid())`). Autorizado pelo Tiago em 03/10/2026.
- Conferido depois: administrador, GP, produtor e financeiro seguem com
  31/61/45/71 (projetos/orçamentos/jobs/PPs); o freelancer sem equipe
  ficou em 0; logado como o freelancer de teste na Equipe do TES-P001/26,
  `/orcamentos` mostra só esse projeto com os 18 orçamentos, a versão abre
  com os itens, e `/jobs` mostra os 8 jobs dele.
- **Os 4 freelancers reais ativos não estão na Equipe de nenhum
  projeto** — passaram a ver as listas vazias, com o
  texto "Nenhum projeto na sua equipe" / "Nenhum job nos projetos da sua
  equipe". Entram na Equipe pelo "Editar projeto".

## ⚠️ A lista de Jobs sem a coluna Projeto, em grade fixa e com teto de duas linhas (2026-10-05)

Pergunta do Tiago: por que a lista perde a formatação quando sai do
"Meus"? Em "Todos" entram jobs com textos longos. A marca e o cliente
vinham com a razão social inteira (até 38 caracteres) e o responsável com
o nome completo (até 53). Marca, Cliente e Responsável estavam em
`whitespace-nowrap`, numa tabela de largura automática. Cada coluna
crescia até o texto mais longo, a tabela ia a ~2200 px em 1614 px de
conteúdo, e Início, Valor total e Status saíam da tela, junto com o total
do projeto na faixa. Para compensar, o Nome era espremido a ~150 px, e o
código do job quebrava no hífen.

Medido num protótipo com o componente real: com as 12 colunas não havia
largura para tudo. Mesmo cortando Marca, Cliente e Responsável, o Nome
ficava com 150 a 230 px.

**O que o Tiago escolheu:**

- **A coluna Projeto sai.** O projeto já aparece na faixa de cada grupo,
  e repeti-lo em toda linha tirava largura do Nome.
- **O Cliente fica**, mesmo repetindo a faixa.
- **Texto inteiro, com teto.** Nome, Marca, Cliente e Responsável quebram
  a linha até **duas linhas**. O que passar disso termina em "…" e aparece
  inteiro ao passar o mouse. A linha de um job nunca passa de duas linhas
  de texto.
- **O código** não quebra mais (`whitespace-nowrap`).

**Grade fixa.** A tabela passou a `table-fixed` com `colgroup`, e as
larguras não dependem mais do texto. As colunas medem 32 · 112 · Nome ·
150 · 156 · 100 · 156 · 172 · 112 · 136 · 216 px, e o Nome fica com o
resto (~272 px). A largura mínima é 1500 px: abaixo disso a tabela rola
na horizontal em vez de espremer o Nome. Status tem 216 px porque o selo
mais largo, "Rejeitado pelo financeiro", mede 182 px.

As larguras foram calibradas com os textos reais dos 52 jobs. Com elas,
nenhum nome de job passa de duas linhas. Ganham "…" só:

- as duas marcas e os dois clientes que são razão social inteira;
- os dois responsáveis com nome mais longo.

**Conferido logado, em 05/10/2026, numa janela de 1838 px** (a do Tiago,
com zoom de 80%):

- "Meus" (11 jobs): a tabela ocupa exatamente os 1614 px, sem rolagem, e
  todas as linhas têm uma linha só.
- "Todos" (35 jobs): a mesma largura, sem rolagem. 18 linhas têm uma
  linha e 17 têm duas. Nove células ganharam "…", três em cada uma de
  Marca, Cliente e Responsável. O cartão mostra o texto inteiro.
- Clicar no nome continua abrindo o job.

Código:

- `components/ui/truncate-tooltip.tsx` ganhou a prop `linhas`
  (`line-clamp` + `break-words`). O cartão abre quando
  `scrollHeight > clientHeight`. Sem a prop, o componente continua como
  antes, numa linha só.
- `app/(app)/jobs/jobs-list.tsx`: `ColunasDaLista`, `TOTAL_DE_COLUNAS`
  para o `colSpan` da faixa, e as quatro células com `linhas={2}`.

`JobRow` não mudou: `projeto_codigo` e `projeto_nome` continuam
alimentando a faixa do grupo.

## ⚠️ A lista de Projetos & Orçamentos também em grade fixa, com teto de duas linhas (2026-10-07)

O Tiago mostrou o mesmo defeito em `/orcamentos`, no "Todos", e pediu a
mesma saída da lista de Jobs. A tabela tinha largura automática e
`overflow-hidden`. O GP Responsável em `whitespace-nowrap` se esticava até
o nome mais longo ("Barbara Sophia Tank Moya Teixeira Siciliano"), e
Abertos e Status sumiam pela borda da caixa, sem rolagem. Cliente e Marca,
com a razão social inteira, quebravam em até quatro linhas. O código
partia no hífen ("AMB-" em cima, "P019/26" embaixo).

**O que mudou, igual à lista de Jobs:**

- **Grade fixa**: `table-fixed` + `colgroup` (`ColunasDaLista`). As
  colunas medem 112 · Nome · 156 · 156 · 104 · 172 · 112 · 112 · 104 · 88
  · 88 · 120 px, e o Nome fica com o resto (~290 px). Cliente, Marca e GP
  têm as larguras da lista de Jobs. A largura mínima é 1500 px: abaixo
  disso a tabela rola na horizontal (a caixa passou de `overflow-hidden`
  para `overflow-x-auto`).
- **Teto de duas linhas** em Nome, Cliente, Marca e GP Responsável. O
  resto vira "…", com o texto inteiro ao passar o mouse (`TruncateTooltip`
  com `linhas={2}`). Na Marca e no GP, o contador "+N" fica ao lado e não
  encolhe.
- **Código e Início** não quebram mais.
- **Nenhuma coluna saiu.** Na lista de Jobs a coluna Projeto saiu por
  repetir a faixa do grupo; aqui não há coluna repetida.

**Duas medidas que a lista de Jobs não tinha:**

- **Status com 120 px**: o selo mais largo, "Arquivado", mede 87 px. Hoje
  não há projeto arquivado na base (40 de 40 ativos), e o selo foi medido
  à parte.
- **As quatro colunas do funil com `px-2`** (`FUNIL_PX`). Com o `px-4` das
  outras, os títulos ("ORÇAMENTOS" mede 92 px) só cabiam tirando ~16 px do
  Nome, e com eles "AMBEV_CORONA_RECOLHIMENTO MATERIAIS AMBUS_MARESIAS"
  passava de duas linhas.

**Conferido logado, em 07/10/2026, numa janela de 1838 px:**

- "Meus" (4 projetos): a tabela ocupa exatamente os 1614 px, sem rolagem.
- "Todos" (40 projetos): a mesma largura, sem rolagem, com as 12 colunas
  na tela. 11 linhas têm uma linha e 29 têm duas. Nenhum nome de projeto
  passa de duas linhas. Onze células ganharam "…": quatro clientes e
  quatro marcas que são razão social inteira, e três GPs com nome longo.
  Nenhum título nem texto invade o respiro da célula vizinha.
- O cartão mostra o texto inteiro; o ícone do descritivo abre o cartão sem
  navegar; clicar no nome abre o projeto.
- Em 1440 px, a tabela fica nos 1500 px e rola dentro da caixa; a página
  não rola na horizontal.

Código: só `app/(app)/orcamentos/projetos-list.tsx` (`ColunasDaLista`,
`TOTAL_DE_COLUNAS`, `FUNIL_PX` e o `Contador` "+N", que antes se repetia
nas três colunas). `ProjetoRow` não mudou.
