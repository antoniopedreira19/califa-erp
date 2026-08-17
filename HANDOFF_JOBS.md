# Handoff — Jobs

Registro da implementação dos designs do módulo de Jobs, mais as decisões de
modelagem e de negócio tomadas junto com o time durante a execução.

O documento tem **cinco partes**, mais as entregas avulsas que vieram
depois delas:

| Parte | Design | Telas | Seções |
|---|---|---|---|
| **I** | `Jobs - Fluxo.dc.html` + `Chat Job.dc.html` | as quatro abas do detalhe do job | 1 a 11 |
| **II** | `Jobs - Lista e Projeto.dc.html` | lista de jobs e visão agregada do projeto | 12 a 17 |
| **III** | `Orcamento - BV - Opcoes.dc.html` | BV na Planilha Interna + travas na errata | 18 a 23 |
| **IV** | `Comparativo Cores - Orcamento e Job.dc.html` | cor dos blocos e faixa do agrupamento, nas 2 telas de planilha | 24 e 25 |
| **V** | planilhas oficiais do time (sem design) | Faturamento previsto × Valor do Job, nas telas de Totais, lista e erratas | 26 a 29 |

> A Parte IV é transversal aos módulos de Orçamento e Job. A regra vive em
> `docs/09-identidade-visual-ui.md`; aqui fica só o que é do Job.

### Entregas avulsas (seções 30+)

Cada uma nasceu de um pedido pontual, não de um design fechado — por isso
não formam parte própria. Estão em ordem cronológica no fim do arquivo.

| Seção | Entrega | Data | Commit | Migration |
|---|---|---|---|---|
| 30 | `A · Repasse` na calha: BV **e** PP na mesma linha | 2026-08-13 | — | — |
| 31 | Navegação por teclado nas planilhas | 2026-08-13 | — | — |
| 32 | Planilha Interna visível antes da abertura | 2026-08-17 | `a21b910` | — |
| 33 | PPs parciais por item + parcelas de pagamento | 2026-08-17 | `f2d3ccf` | `20260817000002` |
| 34 | PDF da PP: um documento por parcela | 2026-08-17 | `93b58ea` | — |

As seções **32 a 34** são o Grupo D do plano de alterações de telas
(Telas 2.1, 2.2 e 2.3), executado numa sessão em 17/08/2026. As regras de
negócio que elas fixaram viraram `docs/decisions/013-realizado-antes-da-abertura.md`
e `docs/decisions/014-pps-parciais-e-parcelas.md`.

> ⚠️ **As três estão sem verificação no navegador.** Lint, `tsc` e build
> limpos; o trigger de saldo foi exercitado direto no banco. A conferência
> logada ficou para uma etapa final, depois de todas as telas do plano —
> decisão do Tiago em 17/08/2026. O caso mais importante a rodar lá é a
> emissão real de uma PP parcelada.

---

# Parte I — as quatro abas do detalhe do job

**Datas:** 2026-08-03 (entrega 1) · 2026-08-04 (entregas 2–5)
**Origem do design:** projeto Claude Design `69342d83-28d9-4bea-a8af-c99e233f5f13`,
arquivos `Jobs - Fluxo.dc.html` e `Chat Job.dc.html`, lidos via MCP `claude_design`.
**Branch:** `design/planilha-interna`

---

## 1. Status

| Entrega | Estado |
|---|---|
| **1 — Planilha Interna conforme o design** | ✅ `58f2c02` (2026-08-03) |
| **2 — Aba Pedidos de Produção + ciclo de avaliação** | ✅ `0920bb9` (2026-08-04) |
| **3 — Erratas do orçado + default 1 em QT/DM** | ✅ `97cb26c` (2026-08-04) |
| **4 — "Em produção" removido, "Finalizado" vira "Encerrado"** | ✅ `69831e5` (2026-08-04) |
| **5 — Aba Comunicação com chat e realtime** | ✅ `84e3e96` (2026-08-04) |

`tsc --noEmit`, `next lint` e `next build` limpos em todas. Todas verificadas
de ponta a ponta no browser contra o banco real — as seções abaixo dizem o que
foi conferido em cada uma.

O design está **completo**: as quatro abas do mock entraram.

---

## 2. Decisões de negócio tomadas nesta sessão

Registradas aqui porque nenhuma delas está no design nem no código — vieram de
perguntas ao time durante a execução.

| Tema | Decisão |
|---|---|
| **Nomenclatura** | "Pedido de Compra" passa a se chamar **"Pedido de Produção"** em toda string visível. Tabela e colunas continuam `pedidos_compra`. O PDF em `lib/pdf/pedido-compra.ts` já dizia "Pedido de Produção" — o rename corrigiu uma inconsistência que já existia. |
| **Rentabilidade %** | Divide pelo **orçado**, não pelo custo. Contraria os percentuais do mockup, mas mantém uma definição só entre a Planilha Interna e a tela de versão do orçamento. |
| **Bloco VARIAÇÃO** | Removido da planilha, seguindo o design. A comparação passa a ser a linha "Rentabilidade" no rodapé de cada grupo. |
| **Ciclo da PP** | Criado agora (`em_avaliacao` / `pago` / `rejeitada` / `cancelada`), antecipando o que a spec da Fase 2 tinha jogado pra Fase 3. |
| **"Pago"** | Flag simples aplicada pelo financeiro, com data informada (pode ser retroativa). O botão continua se chamando **"Dar Baixa"** e o status resultante é **Pago**. Contas a pagar de verdade (`lancamentos_financeiros`, estorno) continua pendente e vai partir daqui. |
| **Nome da tela do financeiro** | `/financeiro/pedidos-compra` passa a se chamar **"Contas a Pagar"** (título, breadcrumb e card do hub). A **rota não mudou**, pra não quebrar links existentes. |
| **Cancelar PP** | Existe **só na aba de PPs do job**, e só pra PP em avaliação ou rejeitada. Saiu da Planilha Interna e da caixa do financeiro. |
| **PDF no reenvio** | Regerado sobrescrevendo o anterior no mesmo path. É o documento que vai pro fornecedor e o que o financeiro confere — não pode contradizer a PP. |
| **Errata: onde grava** | O job ganha **cópia própria** dos itens orçados. A versão aprovada continua sendo o documento que o cliente aprovou e segue read-only. |
| **Errata: o que edita** | Só **R$ unitário e tipo de custo**. QT, D/M, adição e remoção de itens ficaram fora. |
| **Errata: agrupamento** | Uma errata por sessão de edição, com título obrigatório e justificativa opcional. |
| **Errata: permissão** | Liberada pra qualquer usuário nesta fase (decisão explícita do time, com intenção de travar mais tarde). Exige job em "Aberto". |
| **Status do job** | "Em produção" removido — nunca separou nada. "Finalizado" virou "Encerrado". |
| **Chat: remetente** | A área vem do **papel**, não de um toggle. No mock qualquer um escolhia, o que permitiria um GP se passar pelo financeiro. |
| **Chat: cards automáticos** | Montados na leitura, não gravados. |
| **Chat: anexos** | Ficaram pra depois; botão de clipe desabilitado com tooltip. |

---

## 3. Entrega 1 — Planilha Interna

**Commit:** `58f2c02` · aba antes chamada "Rentabilidade".

### Arquivos

| Arquivo | Mudança |
|---|---|
| [`job-tabs.tsx`](app/(app)/jobs/[jobId]/job-tabs.tsx) | aba renomeada pra "Planilha Interna" |
| [`job-item-realizado-table.tsx`](app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx) | +coluna Categoria, −bloco VARIAÇÃO, +linha Rentabilidade no rodapé |
| [`job-totais-card.tsx`](app/(app)/jobs/[jobId]/realizado/job-totais-card.tsx) | reescrito conforme o design |
| [`lib/calculos/versao-totais.ts`](lib/calculos/versao-totais.ts) | nova `calcularRentabilidade`, reusada por `calcularTotaisPlanejados` |
| [`job-realizado-section.tsx`](app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx) · [`job-grupo-card.tsx`](app/(app)/jobs/[jobId]/realizado/job-grupo-card.tsx) · [`page.tsx`](app/(app)/jobs/[jobId]/page.tsx) | propagação de `categoriasMap` |

### Card de Totais

Passa a ter, na ordem do design: tabela de agrupamentos com "Total dos custos"
e "Rentabilidade"; painel "Fechamento do orçado · por tipo de custo"; painel
"Resultado" com o box "Composto por" e o "Resultado geral"; nota de fórmulas
no rodapé.

As fórmulas foram validadas contra os números do próprio mockup e depois
conferidas na tela com dados reais (JOB-0002): honorários 12% sobre A+B+D =
R$ 13.446,00; impostos gross-up sobre B+C+honorários = R$ 11.048,87;
faturamento R$ 136.544,87; resultado operacional R$ 107.496,00 — que é
exatamente honorários + rentabilidade, a identidade que o box "Composto por"
promete.

### Ponto de atenção

A coluna **Categoria aparece vazia** até alguém cadastrar categorias em
`/categorias` e atribuí-las aos itens: no momento da entrega havia 0 categorias
no tenant e 0 dos 166 itens com `categoria_id`.

---

## 4. Entrega 2 — aba Pedidos de Produção

**Commit:** `0920bb9`
**Migration:** `20260804043443_pp_ciclo_status_avaliacao.sql`

### Banco

`emitida` foi **renomeada** pra `em_avaliacao` (rename migra as rows junto: toda
PP emitida estava, de fato, aguardando avaliação). Entraram `pago` e `rejeitada`.
Colunas novas: `pago_em`, `pago_por`, `rejeitada_por`, `rejeitada_em`,
`motivo_rejeicao`.

O unique parcial `uniq_pp_ativa_por_item_realizado` continua valendo — o
predicado é `status <> 'cancelada'`. Ou seja, PP rejeitada **continua ocupando o
item**: o GP corrige e reenvia, não duplica. Só o cancelamento libera.

### Arquivos

| Arquivo | Mudança |
|---|---|
| [`pps/job-pps-section.tsx`](app/(app)/jobs/[jobId]/pps/job-pps-section.tsx) | aba nova: cards, chips, busca, tabela e trilha de cancelar |
| [`pps/editar-pp-drawer.tsx`](app/(app)/jobs/[jobId]/pps/editar-pp-drawer.tsx) | correção da PP rejeitada, com o motivo em destaque |
| [`pps/pp-status-chip.tsx`](app/(app)/jobs/[jobId]/pps/pp-status-chip.tsx) | chip de status |
| [`realizado/actions-pp.ts`](app/(app)/jobs/[jobId]/realizado/actions-pp.ts) | `reenviarPedidoCompra`, `prefixoAnexosPedidoCompra`; cancelamento com a nova regra |
| [`financeiro/pedidos-compra/actions.ts`](app/(app)/financeiro/pedidos-compra/actions.ts) | `marcarPagaFinanceiro` e `rejeitarPedidoCompraFinanceiro` entram; `cancelarPedidoCompraFinanceiro` **sai** |
| [`financeiro/pedidos-compra/page.tsx`](app/(app)/financeiro/pedidos-compra/page.tsx) · [`financeiro/page.tsx`](app/(app)/financeiro/page.tsx) | tela renomeada pra "Contas a Pagar" (título, breadcrumb e card do hub) |

No rodapé do drawer, **"Dar Baixa"** é verde (`bg-emerald-600`) e **"Rejeitar"**
vermelho — as duas saídas da avaliação ficam visualmente opostas. O verde é o
mesmo tom que o projeto já usava no antigo botão "Finalizado" do card de Status
do job, removido na Entrega 4.
| [`realizado/pp-actions-cell.tsx`](app/(app)/jobs/[jobId]/realizado/pp-actions-cell.tsx) | pílulas "Ver PP"/"Gerar PP" com rótulo, sem cancelar |

### Detalhes que não estão no design

- A coluna **"Prazo" (`15 dias`) é derivada** de `created_at` × `prazo_pagamento` —
  não existe campo pra isso no banco.
- Os **cards de resumo ignoram canceladas**: PP cancelada não é PP gerada.

### Verificado

Rejeição pelo financeiro → status `rejeitada` com motivo e autor gravados → na
aba do job aparece "REJEITADO" com botão Editar → reenvio → volta pra
`em_avaliacao`, campos de rejeição limpos, PDF regerado no mesmo path, auditoria
com `pedido_compra.rejeitada` e `pedido_compra.reenviada`.

---

## 5. Entrega 3 — erratas e default de QT/DM

**Commit:** `97cb26c`
**Migrations:** `20260804052819_realizado_default_qt_dm_um.sql`,
`20260804054350_erratas_orcado_do_job.sql`,
`20260804054416_erratas_backfill_jobs_existentes.sql`,
`20260804061500_erratas_arredondar_faturamento_abertura.sql`

### 5.1 Default de QT e D/M

`total_realizado` é coluna gerada (`unitário × QT × D/M`). Com os defaults em 0,
preencher só o unitário deixava o total zerado. Agora nascem 1.

Nenhuma linha existente foi alterada — nenhuma tinha QT ou D/M em zero.

### 5.2 Modelagem das erratas

**O job passa a ter cópia própria do orçado** (`jobs_itens_orcado`), criada na
abertura. A errata altera a cópia; a versão aprovada nunca muda.

A ligação com `jobs_itens_realizado` e com as PPs continua sendo
`item_versao_id` — por isso **nada precisou ser remapeado**. Na UI, o tipo
`ItemPlanilhaJob` mantém `id` = id do item na versão e adiciona `orcado_id`,
que é o alvo da errata.

Tabelas: `jobs_itens_orcado`, `jobs_erratas`, `jobs_erratas_itens`. Coluna nova
`jobs.faturamento_abertura`, congelada na abertura, que é a base do card.

Erratas **não têm policy de UPDATE nem DELETE**: são registro histórico.

### 5.3 Efeito no faturamento por item

Honorários e imposto são **lineares nas somas**, então o efeito de cada item é
exato e a soma dos itens fecha com o delta da errata:

```
Δcusto       = total_para − total_de
Δbase_honor  = parcela A+B+D depois − antes
Δhonorários  = Δbase_honor × h
Δbase_imp    = parcela B+C depois − antes + Δhonorários
Δimposto     = Δbase_imp × t / (1 − t)
Δfaturamento = Δcusto + Δhonorários + Δimposto
```

Implementado em `calcularEfeitoNoFaturamento`
([`lib/calculos/versao-totais.ts`](lib/calculos/versao-totais.ts)) e validado
contra o mockup: a reclassificação B→C de R$ 6.000 dá −894,74 e o design mostra
−894,75.

### 5.4 Fluxo na tela

Botão **"Alterar orçado"** no topo da Planilha Interna, único caminho. Abre
drawer com R$ unitário e tipo de custo editáveis por item, mostrando o impacto
no rodapé. Salvar abre o pop-up "Tem certeza que deseja realizar essa
alteração?", que explica as consequências e pede título e justificativa.

O histórico fica no card **Erratas na aba Informações**, conforme o design.

### Layout da aba Informações

Segue o grid do design: **Metadata e Origem lado a lado** (uma coluna cada),
**Erratas** e **Status** em largura total, nessa ordem. O card de Origem usa
label estreito (`150px 1fr`) porque os valores ali são links longos, diferente
do Metadata, que é 50/50.

O card de Erratas **aparece mesmo sem errata nenhuma**, com um estado vazio que
diz onde fazer a alteração. Antes ele sumia quando a lista estava vazia, e isso
fez a funcionalidade parecer inexistente nos jobs que nunca tiveram errata.

### 5.5 Arredondamento

Todo valor monetário é gravado com 2 casas. Antes, `faturamento_abertura`
guardava o valor cheio e `valor_total` gravava 2 casas, o que fazia o mesmo
delta aparecer como "+R$ 1.391,99" no cabeçalho e "+R$ 1.392,00" na linha da
errata.

### Backfill

Os 5 jobs existentes ganharam a cópia dos itens (44/44 no JOB-0004, etc.) e o
`faturamento_abertura`, que bateu com o valor já exibido na tela. Como não havia
errata nenhuma, "faturamento na abertura" = faturamento atual, que é a verdade
histórica desses jobs.

### Verificado

Alteração do item "DA" do JOB-0002 de R$ 8.000 para R$ 9.000: a cópia do job foi
pra 9.000 e **a versão aprovada continuou em 8.000**. Efeito gravado
(1.391,996) bate com o delta total. Auditoria `job.errata_registrada`.

---

## 6. Entrega 4 — status do job

**Commit:** `69831e5`
**Migrations:** `20260804064500_jobs_remover_em_producao.sql`,
`20260804064600_jobs_finalizado_vira_encerrado.sql`

### Por que "Em produção" saiu

Investigação feita a pedido do time: os cinco gates de negócio checavam
`status === "aberto" || status === "em_producao"` de forma idêntica —
[`actions-realizado.ts`](app/(app)/jobs/[jobId]/actions-realizado.ts),
[`actions-pp.ts`](app/(app)/jobs/[jobId]/realizado/actions-pp.ts) (2×),
[`actions-errata.ts`](app/(app)/jobs/[jobId]/realizado/actions-errata.ts) e
`podeEditarRealizado` em [`page.tsx`](app/(app)/jobs/[jobId]/page.tsx).

A única diferença real era a máquina de transições: `em_producao` era degrau
obrigatório entre `aberto` e `finalizado`. Fora isso, só cor de badge e chip de
filtro.

### O que mudou

Job aberto pelo financeiro fica **"Aberto"** até o encerramento. "Finalizado"
virou **"Encerrado"**.

`encerrado` **não entra em `JOB_STATUS_TRANSICOES` de propósito**: essa tabela
gera os botões automaticamente, e incluí-lo criaria um botão ativo que encerraria
o job sem processo nenhum por trás. O botão "Enviar job para encerramento" é
renderizado à parte, **desabilitado**, com tooltip — mesmo padrão do "Dar Baixa"
da Fase 2 das PPs. **O fluxo de encerramento ainda não existe.**

Os valores `em_producao` e `encerrado` seguem no enum do banco: o Postgres não
remove valor de enum sem recriar o tipo, e recriar derrubaria coluna, defaults e
policies por nenhum ganho prático.

Rótulo dos botões de status passa a ser a ação ("Cancelar job") e não o status
de destino ("Cancelado").

---

## 7. Entrega 5 — aba Comunicação

**Commit:** `84e3e96`
**Migrations:** `20260804070000_jobs_chat_comunicacao.sql`,
`20260804071500_chat_realtime_mensagens.sql`
**Design:** `Chat Job.dc.html`, variante `aba`

### Banco

`jobs_mensagens` (com enum `chat_area`) e `jobs_chat_leituras`. Mensagem
**não se edita nem se apaga**: só há policy de SELECT e INSERT, e o INSERT exige
`autor_id = auth.uid()`.

### Thread

Mistura dois tipos de item:

- **balões de pessoas** — avatar, área e horário. Produção à direita, Financeiro
  à esquerda, fixo por área, para a thread ficar igual pros dois times;
- **cards automáticos expansíveis** — "Job aberto" e "Errata registrada".

Os cards automáticos são **montados na leitura** em
[`lib/data/job-chat.ts`](lib/data/job-chat.ts), a partir de `jobs` e
`jobs_erratas`. Não duplicam dado, não precisam de backfill e as erratas já
registradas apareceram retroativamente. Errata que só reclassifica tipo de custo
ganha ícone e cor próprios — o valor orçado não muda mas o faturamento sim, e
isso confunde quem lê.

### Área do remetente

Vem de `areaDoPapel` ([`lib/types.ts`](lib/types.ts)): financeiro e admin falam
como "Financeiro", os demais como "Produção". Aparece como etiqueta, não como
escolha.

> A função mora em `lib/types.ts` e não junto das actions porque arquivo
> `"use server"` exige que **todo export seja async** — o build quebra com um
> helper síncrono ali dentro, e o `tsc` não pega isso.

### Fidelidade ao design

Ajustes feitos numa revisão posterior, comparando lado a lado com o mock:

- **`p-4.5` e `px-4.5` não existem no Tailwind** (a escala pula de 4 para 5), então
  a lista e o header ficavam com padding **zero** e os cards colavam nas bordas.
  Trocados por `p-[18px]` / `px-[18px]`.
- `leading-relaxed` (1.625) substituído pelos valores do design: **1.45** nos
  resumos, linhas e textarea; **1.5** nos balões. Era o que deixava tudo mais alto.
- Gaps acertados: 9px entre avatar e balão, 7px na metadata, 9px nas linhas.
- Fundo da lista fixado em `#FAFAFA`, como no design.
- **Só a errata mais recente nasce aberta**; o card de abertura fica fechado. Num
  job sem errata ele sozinho aberto ocupava a thread inteira.
- Entrou o link **"Abrir na aba Informações →"** dentro do card expandido, que
  faltava. Como as abas são estado local e não rota, o `JobTabs` expõe um contexto
  (`useIrParaAbaInformacoes`) para o chat trocar de aba.

A **única** divergência intencional em relação ao mock é o composer: o design tem
toggle "Enviar como: Produção | Financeiro" e aqui é etiqueta fixa, pelo motivo
da seção anterior.

### Não lidas

Soma mensagens **e** erratas de outras pessoas posteriores à última leitura.
Abrir a aba marca como lido.

O painel **só monta quando a aba está ativa** — as outras abas ficam montadas
escondidas, mas o chat marca como lido ao montar, e montado escondido zeraria o
badge sem ninguém ler.

### Realtime

`jobs_mensagens` entrou na publicação `supabase_realtime`. O componente assina
INSERT filtrado por `job_id`; o payload é **ignorado de propósito** — a thread é
montada no servidor, então o `router.refresh()` traz tudo já ordenado em vez de
remontar no client e arriscar divergir. Antes do refresh a thread é marcada como
lida, senão o badge subiria na cara de quem está lendo naquele momento.

O RLS vale no canal: o Realtime aplica as policies da tabela.

### Verificado

Mensagem inserida direto no banco por outro autor apareceu na aba aberta **sem
reload**, no lado e cor certos.

---

## 8. Trilhas laterais — nota de layout

As trilhas de "Ver PP"/"Gerar PP" (Planilha Interna) e "Cancelar" (aba de PPs)
ficam **fora do frame** do card, como no design. Posicionadas por cima, elas eram
**cortadas na borda direita da página** abaixo de ~1260px de viewport.

A correção foi reservar a calha: `pr-[114px]` no container quando editável. Isso
encolhe os cards ~114px em relação ao mockup, que assume overflow visível na
página — foi o jeito de manter os botões fora do frame sem cortá-los.

Na aba de PPs, as linhas têm altura variável (o serviço quebra em 2–3 linhas),
então a trilha **mede cada `<tr>`** e posiciona o botão no mesmo offset, em vez
de assumir altura fixa.

### Largura da Planilha Interna

A tabela de 15 colunas **não cabia em resolução nenhuma**, nem em 1920px. A
causa não era o monitor: o layout já permite `max-w-[1600px]`, mas a página do
job se limitava ao padrão `max-w-7xl` (1280px). Descontada a calha da trilha,
sobravam 1164px para uma tabela que pedia 1280 — 116px cortados sempre.

Três ajustes, medidos no browser:

1. Página do job vai a **`max-w-[1440px]`** — mais que o padrão do app, porque é
   a tela com tabela de 15 colunas, mas sem ir ao máximo de 1600.
2. Calha da Planilha Interna: `pr-[114px]` → **`pr-[104px]`**. Os 10px de respiro
   da trilha podem invadir o padding do layout sem encostar na borda.
3. Coluna **Item ganha largura própria (18%)**. Antes era `<col />` sem largura,
   então absorvia toda folga liberada das outras colunas e a tabela voltava a
   estourar pelas bordas de 2px entre os blocos, que as porcentagens não preveem.
   Categoria caiu de 11% para 8,5%; o mínimo da tabela, de 1280px para 1160px.

Resultado medido: 0px de corte em 1920, 1680 e 1440 (1px sub-pixel). Abaixo de
~1400px a tabela volta a rolar horizontalmente, que é o comportamento correto.

A página ainda ganha `min-[1600px]:mr-6`: a partir de 1600px, onde passa a
sobrar folga dos dois lados, o conteúdo desloca 24px pra direita — encosta um
pouco mais na borda e afasta da sidebar (folga de 226px à esquerda contra 178px
à direita, em 1920). O breakpoint é necessário: aplicar a margem em telas
menores roubaria 24px da tabela e ela voltaria a cortar.

> A tela de **versão do orçamento** tem a mesma tabela larga e segue em
> `max-w-7xl` — provavelmente sofre do mesmo corte. Não foi tocada aqui.

---

## 9. Pendências conhecidas

| Item | Situação |
|---|---|
| **Fluxo de encerramento** | Não existe. Botão desabilitado com tooltip. |
| **Contas a pagar** (`lancamentos_financeiros`, baixa, estorno) | Pendente. "Pago" é flag simples e vai servir de ponto de partida. |
| **Anexos no chat** | Pendente. Botão de clipe desabilitado com tooltip. |
| **Adição e remoção de itens por errata** | Fora do escopo aprovado. O card já sabe renderizar as tags "Adição"/"Remoção" quando entrarem. |
| **Permissão da errata** | Liberada pra todos por decisão do time; travar mais tarde. |
| **Campo "Cliente" na aba Informações** | Mostra o nome do **projeto**, não do cliente. `projetos.cliente_id` existe e nunca é usado. Bug pré-existente, fora do escopo destas entregas. |
| **Coluna Categoria** | Vazia até categorias serem cadastradas e atribuídas. |

---

## 10. Migrations desta sessão

Aplicadas no Supabase e versionadas em `supabase/migrations/`. O nome do arquivo
bate com a versão aplicada — o descompasso que existia em migrations anteriores
foi evitado aqui de propósito.

| Versão | Nome |
|---|---|
| `20260804043443` | `pp_ciclo_status_avaliacao` |
| `20260804052819` | `realizado_default_qt_dm_um` |
| `20260804054350` | `erratas_orcado_do_job` |
| `20260804054416` | `erratas_backfill_jobs_existentes` |
| `20260804061500` | `erratas_arredondar_faturamento_abertura` |
| `20260804064500` | `jobs_remover_em_producao` |
| `20260804064600` | `jobs_finalizado_vira_encerrado` |
| `20260804070000` | `jobs_chat_comunicacao` |
| `20260804071500` | `chat_realtime_mensagens` |

> ⚠️ **Duas delas renomeiam valor de enum** (`emitida` → `em_avaliacao` e
> `finalizado` → `encerrado`). Migration e código precisam subir juntos: enquanto
> a `main` antiga estiver deployada contra este banco, as queries que filtram
> pelos nomes antigos erram.

---

## 11. Dados de teste deixados no banco

A verificação de ponta a ponta foi feita contra o banco real e deixou registros
que **não podem ser apagados pela UI**, por design:

- **Errata "Cachê do DA reajustado"** no JOB-0002 (item DA de R$ 8.000 → R$ 9.000,
  faturamento R$ 136.544,87 → R$ 137.936,86). Erratas não têm policy de DELETE.
- **Uma mensagem** de Tiago Mendonça na Comunicação do JOB-0002.

Se quiser ambiente limpo, precisa remover via SQL.

---

# Parte II — lista de jobs e visão agregada do projeto

**Datas:** 2026-08-04 (entregas 6 e 7) · 2026-08-05 (entrega 8)
**Origem do design:** mesmo projeto Claude Design `69342d83-28d9-4bea-a8af-c99e233f5f13`,
arquivo `Jobs - Lista e Projeto.dc.html`, lido via MCP `claude_design`. O arquivo
foi **atualizado pelo time no meio da execução** (seletor de ótica e média das
taxas) e relido — a entrega 8 é esse segundo estado do design.
**Branch:** `design/jobs-lista-e-projeto`

---

## 12. Status

| Entrega | Estado |
|---|---|
| **6 — lista de jobs e visão agregada conforme o design** | ✅ `fe1b5fa` (2026-08-04) |
| **7 — resumo de resultado no cabeçalho das duas telas** | ✅ `fe1b5fa` (2026-08-04) |
| **8 — seletor Planejada/Realizada e média das taxas** | ✅ `fe1b5fa` (2026-08-05) |

As três foram aprovadas uma a uma e entraram no mesmo commit: as entregas se
sobrepõem nos mesmos arquivos (`projeto/page.tsx` e `projeto-totais-card.tsx`),
e separar exigiria staging parcial.

`tsc --noEmit`, `next lint` e `next build` limpos. Verificadas no browser contra
o banco real, com o mock do design servido em paralelo pra comparação lado a
lado — as seções abaixo dizem o que foi conferido em cada uma.

**Nenhuma migration.** Esta parte é só leitura: nada de novo foi gravado no
banco.

---

## 13. Decisões desta entrega

Nenhuma delas está no design nem no código — vieram de perguntas ao time ou de
conflito entre o mock e o que o sistema já fazia.

| Tema | Decisão |
|---|---|
| **Fonte do orçado na visão agregada** | Vem de `jobs_itens_orcado` (a cópia do job), não de `versoes_orcamento_itens`. Sem isso, depois de uma errata a planilha consolidada do projeto divergiria da Planilha Interna do job — a versão aprovada fica congelada de propósito. |
| **Rótulos de tipo de custo** | Seguem `tipoCustoLabel()` do app ("A · Fat. direto", "B · Bi-trib.", …), **não** os do mock ("A · Terceiros com nota", …). O mock usava texto de exemplo; mudar quebraria a consistência com o card de Totais do job e com a tela da versão. |
| **O que saiu da visão agregada** | A tabela "Rentabilidade agregada" (consolidava por nome de grupo entre jobs) e a tabela "Jobs do projeto". O design as substitui pela árvore no cabeçalho, um card de planilha por job e o card de Totais do projeto. `agregarRentabilidadePorProjeto` segue em uso pelo card de Totais do job. |
| **Agrupamento na lista** | Todo projeto vira grupo, inclusive os de um job só, e os grupos **nascem abertos**. Antes o grupo só existia com 2+ jobs. |
| **Resultado planejado / realizado** | Exibidos em **percentual**, como o "Resultado geral" da tela da versão — não em R$. |
| **Ótica default do painel de Resultado** | Abre em **"Realizada"**, como o design. |
| **Honorários e impostos do projeto** | Percentual exibido é a **média simples** das taxas dos jobs (não ponderada pelo valor). Antes listava a taxa de cada job ("12% · 15% · 15%"). |
| **Ortografia** | O placeholder da busca ficou "Buscar por nome ou código", com acento; o mock está sem. Regra do `CLAUDE.md` vence o mock. |

---

## 14. Entrega 6 — lista de jobs e visão agregada

**Commit:** `fe1b5fa`

### Arquivos

| Arquivo | Mudança |
|---|---|
| [`jobs-list.tsx`](app/(app)/jobs/jobs-list.tsx) | reescrita conforme o design |
| [`projeto/[projetoId]/page.tsx`](app/(app)/jobs/projeto/[projetoId]/page.tsx) | reescrita: árvore de jobs, barra "Planilha consolidada", cards por job, Totais do projeto |
| [`planilha-job-card.tsx`](app/(app)/jobs/projeto/[projetoId]/planilha-job-card.tsx) | **novo** — card colapsável por job com a planilha Orçado × Planejado × Realizado |
| [`projeto-totais-card.tsx`](app/(app)/jobs/projeto/[projetoId]/projeto-totais-card.tsx) | **novo** — Totais do projeto |
| [`tipos.ts`](app/(app)/jobs/projeto/[projetoId]/tipos.ts) | **novo** — o formato que a página monta no servidor e entrega pronto aos cards; nenhum dos dois refaz conta |
| `jobs-do-projeto-table.tsx` | **removido** |

### Lista de jobs

A linha de projeto passou a ocupar a largura toda (`colspan={10}`) com um grid
de 5 colunas: chevron, código + nome + cliente, contagem, total e o link
**"Visão agregada →"**. Clicar na linha só expande — quem navega é o link. Antes
a linha inteira navegava, o que tornava impossível colapsar sem sair da tela.

Os jobs filhos ganharam a calha de árvore (linha vertical que morre no meio da
última linha + traço horizontal), no lugar do `└` com borda vermelha à esquerda.

Grupos nascem abertos, como no design. O state guarda os **fechados**, não os
abertos — assim não é preciso semear os ids dos projetos no mount.

### Visão agregada

Um bloco por job, cada um com a planilha completa de 15 colunas, agrupamentos
colapsáveis e rodapé com "Total do job" e "Rentabilidade". Abaixo, o card de
Totais com uma linha por job e os dois painéis de fechamento.

A **coluna "Valor total" da lista** e a árvore de jobs usam `jobs.valor_total`,
que **é** o faturamento previsto — gravado na abertura e ressincronizado pela
errata. Foi o que permitiu não carregar os itens de todos os jobs só pra montar
a lista.

### Layout das tabelas

As tabelas de 15 colunas aqui usam **largura automática**, sem `table-fixed` nem
`colgroup` — diferente da Planilha Interna do job. O que fecha as proporções com
o mock é `w-[210px]` na primeira coluna da planilha do job (e `w-[320px]` na
coluna "Job" dos Totais) mais `min-w-[132px]` nas colunas Total.

Com `table-fixed` e as porcentagens da Planilha Interna, os blocos numéricos
ficavam ~30% mais estreitos que o design. Medido no browser:

| | 1ª coluna | Tipo | Categoria | R$ Unit. | QT | D/M | Total |
|---|---|---|---|---|---|---|---|
| mock | 198 | 43 | 99 | 112 | 28 | 34 | **158** |
| `table-fixed` | 246 | 55 | 116 | 103 | 41 | 41 | **116** |
| entregue | 210 | 51 | 105 | 86 | 33 | 41 | **157** |

> ⚠️ O efeito colateral é o mesmo do design: um nome de item muito longo alarga
> a primeira coluna, porque `truncate` não constrange em layout automático.

### Verificado

Mock do design servido localmente e comparado lado a lado com a aplicação, nas
duas telas, colapsado e expandido. Larguras de coluna medidas com
`getBoundingClientRect` nos dois. Console limpo em carga nova.

---

## 15. Entrega 7 — resumo de resultado no cabeçalho

**Commit:** `fe1b5fa` · pedido do time, não está no design.

Faixa de cinco blocos no canto superior direito, no mesmo padrão do
`ResumoRentabilidade` da tela da versão do orçamento.

| Arquivo | Mudança |
|---|---|
| [`components/resumo-resultado.tsx`](components/resumo-resultado.tsx) | **novo** |
| [`jobs/[jobId]/page.tsx`](app/(app)/jobs/[jobId]/page.tsx) | resumo no cabeçalho da página |
| [`projeto/[projetoId]/page.tsx`](app/(app)/jobs/projeto/[projetoId]/page.tsx) | idem |

Ordem dos blocos, definida pelo time: faturamento previsto, custo planejado,
custo realizado, resultado planejado, resultado realizado. Os dois resultados
saem em **percentual**, de `calcularResultadoOperacional` — a mesma função da
tela da versão e do card de Totais, então o "resultado realizado" do cabeçalho
é sempre igual ao "resultado geral" do rodapé. Sem custo lançado o bloco mostra
travessão com "sem planejado" / "sem realizado".

No job o resumo fica no **cabeçalho da página**, acima das abas, e por isso
aparece nas quatro. Só é renderizado se o job tiver itens.

### Alinhamento vertical

O topo do card alinha com o topo das **maiúsculas** do título, não com o topo
do bloco: `mt-[27px]` na página do job (h1 `text-3xl`) e `mt-[24px]` na visão
agregada (h1 `text-2xl`). São 16px da linha do código mais ~7px de folga entre
a caixa de linha do `h1` e o topo das maiúsculas da Inter.

Medido no browser comparando o topo do card com a altura de maiúscula real da
fonte (`TextMetrics.actualBoundingBoxAscent` sobre "H"): −0,17px no job e
−0,04px no projeto. A referência é a **altura de maiúscula**, não o glifo mais
alto do título — "O" tem overshoot e "t"/"l" passam da linha de maiúscula, então
alinhar pelo título faria o resultado mudar conforme o nome.

---

## 16. Entrega 8 — seletor Planejada/Realizada e média das taxas

**Commit:** `fe1b5fa` · segunda versão do design.

| Arquivo | Mudança |
|---|---|
| [`components/painel-resultado.tsx`](components/painel-resultado.tsx) | **novo** — o painel "Resultado" dos dois cards de Totais, agora client component |
| [`job-totais-card.tsx`](app/(app)/jobs/[jobId]/realizado/job-totais-card.tsx) | usa o painel; legenda atualizada |
| [`projeto-totais-card.tsx`](app/(app)/jobs/projeto/[projetoId]/projeto-totais-card.tsx) | usa o painel; média das taxas; legenda atualizada |

### O seletor

Troca a ótica inteira de uma vez. Faturamento previsto e impostos não dependem
dela.

| | Planejada | Realizada |
|---|---|---|
| linha do custo | − Custo planejado | − Custo realizado |
| resultado | Resultado operacional **planejado** | Resultado operacional **realizado** |
| composto por | Rentabilidade (orçado × **planejado**) | Rentabilidade (orçado × **realizado**) |
| caixa final | Resultado geral **planejado** | Resultado geral **realizado** |

Conferido no JOB-0002: planejada R$ 22.016,00 / 16,0%; realizada
R$ 108.616,00 / 78,7% — os mesmos percentuais que a faixa do cabeçalho mostra.
Os estilos computados do pill batem com o mock (fundo `#f1f0ec`, `padding 3px`,
`gap 2px`, botão `5px 14px`, ativo branco com sombra `0 1px 2px rgba(0,0,0,.08)`).

### Média das taxas

No "Fechamento do orçado" do **projeto**, honorários e impostos passam a exibir
a média simples das taxas dos jobs, arredondada em 2 casas — no projeto de
teste, `(13 + 12 + 14)/3` vira "Honorários (13%)". O card do job continua com a
taxa da própria versão, inclusive o "· 12%" ao lado dos honorários em
"Composto por".

> ⚠️ **Os valores em R$ continuam sendo a soma job a job**, cada um calculado
> com a sua própria taxa. O percentual exibido é referência, não a taxa que
> gerou aqueles números: quem tentar reconferir `custos × 13%` vai achar
> diferente, de propósito. A legenda do rodapé diz isso.

---

## 17. Pendências da Parte II

| Item | Situação |
|---|---|
| **Média ponderada das taxas** | A média é simples. Um job pequeno com taxa fora da curva mexe no percentual exibido tanto quanto um job grande. |
| **"Valor total" da lista** | Usa `jobs.valor_total`. Hoje ele acompanha o faturamento (abertura + errata o ressincronizam); se algum caminho futuro gravar custo sem atualizar o campo, lista e visão agregada divergem. |
| **Nome de item longo** | Alarga a primeira coluna das tabelas da visão agregada, por causa do layout automático. Mesmo comportamento do design. |
| **Moeda do projeto** | O card de Totais assume a moeda do primeiro job. Projeto com jobs em moedas diferentes somaria valores incomparáveis — não existe hoje, mas nada impede. |

---

# Parte III — BV na planilha interna

**Data:** 2026-08-07
**Origem do design:** projeto Claude Design `69342d83-28d9-4bea-a8af-c99e233f5f13`,
arquivo `Orcamento - BV - Opcoes.dc.html`, lido via MCP `claude_design`. O design
cobre três telas; a de Orçamentos foi feita antes (Entrega 12 do
`HANDOFF_ORCAMENTO.md`) e esta é a do job.
**Branch:** `main`

A modelagem do BV, o ciclo de vida da situação e as travas por situação
estão em `HANDOFF_ORCAMENTO.md`, seções 13 e 14. Aqui fica só o que é do
módulo de Jobs.

---

## 18. O que é o BV, em uma linha

Valor que o fornecedor devolve à California como comissão, em item de
custo **tipo A ou D** — os tipos em que o cliente paga o fornecedor
diretamente. Em B e C o custo passa pela agência e o que existe é o
Pedido de Produção.

⚠️ **O BV ainda não abate custo nem entra em rentabilidade.** Isso só
vale quando ele tiver sido faturado e estiver no contas a receber —
módulos que não existem. Nada em `lib/calculos/` foi tocado.

---

## 19. Entrega 9 — BV na Planilha Interna e a troca BV↔PP

### 19.1 A calha deixou de ser só de PP

Mudança de design pedida pelo time: **BV e PP não coexistem**. A coluna
**Tipo** decide o que a linha mostra.

| Tipo | Calha |
|---|---|
| A, D | quadrado de BV |
| B, C | Ver PP / Gerar PP |

Levantamento antes de mudar: as 6 PPs existentes estão **todas em itens
tipo B**. Nenhuma ficou inacessível.

O quadrado fala a mesma língua da tela de Orçamentos — vazado com `+BV`
quando não há, preenchido com `BV` quando há. A largura da calha
(`w-[104px]` / `pr-[104px]`) **não mudou**: o quadrado de 26px cabe
folgado onde a pílula de PP já cabia.

**A trilha passou a existir em job congelado**, o que antes não
acontecia: com o job fora de edição, ela aparece só se houver BV a
consultar, e só com o quadrado. Itens sem BV viram espaçador da altura da
linha, senão a trilha desalinha das linhas de baixo.

### 19.2 O formulário, na variante do job

Mesmo componente da tela de Orçamentos (`app/(app)/_bv/bv-dialog.tsx`),
com três diferenças, todas pedidas pelo time:

1. **Realizado no lugar da rentabilidade.** O terceiro bloco da coluna
   esquerda é o Realizado — é o número que importa em execução, e a
   rentabilidade continua no rodapé do grupo.
2. **Salvar e Confirmar**, não só um botão. `Salvar` grava mantendo
   `a_negociar`, sem popup e sem exigir fornecedor — é o que permite
   ajustar o BV depois da aprovação sem bater o martelo. `Confirmar`
   exige fornecedor, abre o popup de "tem certeza" e enviaria ao
   financeiro.
3. **Fornecedor obrigatório para confirmar.** No orçamento é opcional; a
   cobrança acontece aqui, que é onde o BV é fechado.

O item da planilha do job (`ItemPlanilhaJob.id`) **já é o id do item na
versão**, que é a chave do BV — não houve mapeamento a fazer.

### 19.3 Destaque de BV sem fornecedor

BV lançado sem fornecedor aparece com o quadrado **âmbar** e um pontinho
na calha, com tooltip dizendo o que falta. Fecha o combinado da Entrega
12: "se não preenchido, deverá haver um destaque quando chegar na tela de
acompanhamento".

### 19.4 O envio ao financeiro está desativado

⚠️ O botão do popup **nasce desabilitado**, a pedido do time: não existe
módulo de faturamento para onde enviar. O popup explica o motivo — botão
morto sem explicação lê como defeito.

`confirmarBv` está implementado e foi testado de verdade (habilitando o
botão temporariamente): grava `confirmado`, registra
`item_bv.confirmado` e trava o BV nas duas telas. Para liberar, basta
tirar o `confirmDisabled` do `ConfirmDialog` em `bv-dialog.tsx`.

`ConfirmDialog` ganhou `confirmDisabled` + `confirmDisabledReason` para
isso — desabilita só o confirmar, mantendo o cancelar vivo.

---

## 20. Erratas ganharam trava de tipo de custo

Esta é a parte da entrega que **mexe em comportamento que já existia**.

### 20.1 O problema que apareceu

A planilha do job lê `jobs_itens_orcado.tipo_custo` (a cópia), mas o
trigger do banco validava `versoes_orcamento_itens.tipo_custo` (a
versão). A errata altera **só a cópia** — de propósito, para a versão
seguir sendo o que o cliente aprovou ([actions-errata.ts:288](app/(app)/jobs/[jobId]/realizado/actions-errata.ts:288)).

Reproduzido no JOB-0002: item levado de B para A pela errata passou a
mostrar `+BV`, e o banco recusou com *"BV só pode ser lançado em item de
custo tipo A ou D"* — mensagem que contradizia a tela.

⚠️ A intuição engana aqui: **a versão estar travada depois do envio ao
financeiro é o que garante a divergência, não o que a impede.** A cópia
anda com a errata; a versão fica parada.

### 20.2 As três regras (decisão do time)

1. **Depois da errata, quem manda é a cópia** — migration
   `20260807000003`. O trigger aceita quando a versão **ou** a cópia
   forem A/D. Se a planilha do job diz A, o BV grava.
2. **Errata não troca o tipo de item com PP ativa ou BV
   confirmado/recebido.** Bloqueio **por item** — os outros itens da
   errata seguem normalmente, para quem está corrigindo dez linhas não
   perder o trabalho por causa de uma. A mensagem nomeia o item e diz o
   que cancelar.
3. **Errata que tira o item de A/D cancela o BV `a_negociar`** junto, com
   auditoria (`motivo: "errata_mudou_tipo_de_custo"`). **A→D não
   cancela**: em D o cliente também paga o fornecedor direto e o BV segue
   válido.

**A trava é só na troca de TIPO.** Corrigir valor unitário de item com PP
ativa continua permitido, como sempre foi — o time optou por não mexer
nisso agora.

O bloqueio roda **antes** do insert da errata: quando barra, nada é
gravado (nem a errata, nem o tipo, nem o `valor_total` do job).

---

## 21. Verificado (2026-08-07)

`tsc --noEmit`, `next lint` (só os warnings pré-existentes de
`combobox.tsx` e `multi-select.tsx`) e `npm run build` limpos. No
navegador, contra o banco real, no JOB-0002:

| Cenário | Resultado |
|---|---|
| Troca BV↔PP | "Gerador" e "Luz" (A) mostram BV; itens B mostram PP. Nenhuma linha com os dois |
| Formulário no job | Bloco Realizado presente, rentabilidade ausente, rodapé Cancelar / Salvar / Confirmar, fornecedor com `*` |
| Confirmar sem fornecedor | Bloqueado com mensagem; popup não abre |
| Confirmar com fornecedor | Popup abre com valor e nome do fornecedor; "Confirmar envio" **desabilitado**, com o motivo escrito |
| Salvar pelo job | Gravou `a_negociar`, auditoria com `origem: "job"` |
| Destaque âmbar | BV sem fornecedor ficou âmbar, com tooltip |
| Tipo D | Item marcado D (versão + cópia) mostrou BV; trigger aceitou |
| `confirmarBv` | Habilitado temporariamente: gravou `confirmado`, auditou e travou o BV. Botão devolvido ao estado desabilitado |
| **Errata A→B com BV `a negociar`** | BV virou `cancelado`, auditoria com `motivo`, `de: A`, `para: B` |
| **Errata B→A e depois lançar BV** | Gravou com versão=B e cópia=A — o caso que quebrava |
| **Errata trocando tipo com BV confirmado** | Barrada com mensagem nomeando o item; **nada gravado** (nenhuma errata criada, tipo intacto) |

Console sem erros em aba limpa. Todos os dados de teste revertidos:
BVs apagados, tipos da cópia restaurados (Gerador=A, Locação de rádios=B),
as duas erratas de teste removidas e `jobs.valor_total` de volta a
R$ 137.936,86.

⚠️ Como toda sessão deste projeto, o `next dev` escreveu **direto em
produção**.

---

## 22. Migrations desta entrega

| Migration | O que faz |
|---|---|
| `20260807000001_itens_bv.sql` | Cria `itens_bv`, o enum `bv_situacao` e o trigger de tipo. Detalhes em `HANDOFF_ORCAMENTO.md` §13.3 |
| `20260807000002_bv_tipo_a_ou_d.sql` | BV passa a valer para A **ou** D; função renomeada para `bv_exige_item_com_bv` |
| `20260807000003_bv_tipo_segue_copia_do_job.sql` | Trigger aceita quando a versão **ou** a cópia do job forem A/D — resolve a divergência da §20 |

---

## 23. Pendências da Parte III

| Item | Situação |
|---|---|
| **Envio ao financeiro** | Botão do popup desabilitado até existir o módulo de faturamento. `confirmarBv` pronto e testado |
| **`recebido`** | Sem produtor: depende do contas a receber. Só alcançável por SQL hoje |
| **Permissão por papel** | Não implementada — decisão do time ("por enquanto todos"). Quando entrar, vale para o botão da calha **e** para as três Server Actions |
| **PP ativa + correção de valor** | Segue permitido por errata. Só a troca de tipo é barrada |
| **BV cancelado é sobrescrito** | Relançar no mesmo item reaproveita a linha. Se a parte de confirmação exigir histórico de BVs cancelados, trocar `uniq_bv_item` por índice parcial ("um BV ativo por item") |

---

# Parte IV — cores dos blocos e faixa do agrupamento

**Data:** 2026-08-11
**Origem do design:** projeto Claude Design `69342d83-28d9-4bea-a8af-c99e233f5f13`,
arquivo `Comparativo Cores - Orcamento e Job.dc.html`, lido via MCP `claude_design`.
O design cobre orçamento e job de uma vez; a parte de Orçamentos é a Entrega 15
do `HANDOFF_ORCAMENTO.md`.
**Branch:** `design/bv-botoes-adicionar-abrir`

⚠️ **A regra em si não mora aqui.** O sistema de cor por bloco, as grades
compartilhadas e a faixa do agrupamento são transversais aos dois módulos —
estão em `docs/09-identidade-visual-ui.md`, seções "Cores das planilhas",
"Grades compartilhadas" e "Faixa do agrupamento". Duplicar a spec nos dois
handoffs faria as cópias divergirem, que é o defeito que esta entrega corrigiu
no código. Aqui fica só o que é do módulo de Jobs.

---

## 24. O que mudou nas telas de job

1. **Paleta trocada.** ORÇADO era bege/grafite e virou azul; PLANEJADO era azul
   e virou verde; REALIZADO era âmbar (`#fef3c7`/`#92400e`) e virou laranja
   (`#FFEDD5`/`#C2410C`). Vale na Planilha Interna, no card de Totais do job, na
   planilha consolidada do projeto e no card de Totais do projeto. As pílulas
   Orçado/Planejado/Realizado do cabeçalho de cada job na agregada seguem as
   mesmas cores — o resumo e a grade abaixo dele leem como a mesma coisa.
2. **A barra de título do `JobGrupoCard` saiu.** O nome do agrupamento subiu
   para a faixa do `<thead>` e o contador de itens foi para a calha à direita,
   onde já moram as pílulas de BV e PP. A calha do grupo se alinha pela altura
   **medida** da faixa (`faixaRef` + `ResizeObserver`).
3. **Rentabilidade em grafite.** As duas linhas de Rentabilidade do rodapé
   (orçado × planejado e orçado × realizado) continuam onde estavam, sob as
   colunas Total de PLANEJADO e REALIZADO — o job **não** ganhou bloco
   RENTABILIDADE. Decisão do time: *"essa modificação é de design, e não deverá
   afetar as informações presentes no modelo atual"*. Só a cor do número mudou.
4. **Grades extraídas.** `job-item-realizado-table.tsx` e `job-totais-card.tsx`
   tinham colgroups de 15 colunas duplicados e idênticos — viraram
   `app/(app)/_planilha/grade-job.tsx`. A visão agregada ganhou
   `grade-jobs-projeto.tsx`, que **não existia**: era o que faltava para os
   Totais alinharem (ver o case study no doc — reverte a decisão de layout
   automático da §14).

---

## 25. Verificação

`tsc --noEmit --incremental false` e `next lint` limpos. Alinhamento conferido
medindo `getBoundingClientRect()` no navegador, não a olho:

| Tela | Fronteiras das colunas | Resultado |
|---|---|---|
| Planilha Interna (3 grupos + Totais) | 153/575/879/1183/1487 nas 4 tabelas | exato |
| Agregada do projeto (planilha + Totais) | 111/579/935/1290/1645 nas 2 tabelas | exato |

Nenhuma migration. Nada em `lib/calculos/` foi tocado.

---

# Parte V — Faturamento previsto × Valor do Job

**Data:** 2026-08-11 · **Origem:** planilhas oficiais do time, não um design.
`[INT] SJ PEPSI CG - NE - 2026.xlsx` valeu como referência final.

> Transversal aos módulos de Orçamento e Job. A regra vive em
> `docs/decisions/003-tipos-de-custo.md`, e a fonte no código é
> `REGRAS_TIPO_CUSTO` em `lib/calculos/versao-totais.ts`. O contexto completo
> da decisão está na seção 17 do `HANDOFF_ORCAMENTO.md`; aqui fica só o que é
> do Job.

---

## 26. O que mudou nas telas de job

O fechamento passou a produzir **dois** números onde havia um:

```
faturamento previsto = Σ(AR, B, C)     + honorários + imposto   (o que a California emite nota)
valor do job         = Σ(tudo menos D) + honorários + imposto   (compromisso total do cliente)
```

O **Valor do Job é o número que o sistema já calculava** — a planilha oficial
chama de `FATURAMENTO`. Quem é novo é o faturamento previsto, menor.

1. **Card de Totais do job e da agregada do projeto** ganharam a linha "Valor
   do Job" abaixo de "Faturamento previsto". O fechamento por tipo de custo
   passou a listar sete tipos (`A`, `AR`, `B`, `C`, `D`, `F`, `FI`) — **hoje são
   cinco linhas**, ver a nota de 12/08/2026 no fim da seção.
2. **`PainelResultado` mudou de base.** A prop `faturamento` virou `valorJob`,
   e `Resultado operacional`/`Resultado geral` calculam sobre ele. O custo
   descontado é o do job inteiro, então a receita comparada precisa ser a do job
   inteiro — com o faturamento previsto ali, o resultado caía pelo valor dos
   custos pagos direto ao fornecedor, que a agência nem desembolsa. **Os
   percentuais na tela não mudaram**: a base continua sendo o mesmo número de
   antes, agora com o nome certo.
3. **`ResumoResultado`** (cabeçalho do job e da agregada) mostra **só o Valor do
   Job** — o bloco que dizia "Faturamento previsto" passou a dizer "Valor do
   Job", sem ganhar bloco novo.
4. **Lista de jobs: nenhuma coluna nova.** Segue com "Valor total" sozinha. A
   coluna `jobs.faturamento_previsto` existe no banco (gravada na abertura e
   pelas erratas), mas a lista **não a lê** — ver o aviso de escopo abaixo.
5. **A legenda das fórmulas virou `components/legenda-fechamento.tsx`**, único
   para as quatro telas de Totais. Estava copiada em quatro arquivos.

⚠️ **Correção de escopo (2026-08-12).** O pedido do time foi a linha "Valor do
Job" **nos Totais**. A primeira versão desta entrega estendeu o par de números
por conta própria para o cabeçalho do job, o da agregada e a lista de jobs — na
lista, o número a mais na linha do projeto **empurrou o botão "Visão agregada"
para a linha seguinte**. Revertido no commit `408444b`. A regra que ficou:
**fora dos cards de Totais, um número só — o Valor do Job.** As exceções, todas
conversadas com o time, são o card de Erratas (seção 28) e os dois modais do
envio de job (`HANDOFF_ORCAMENTO.md`, 17.4 item 3).

⚠️ **Fechamento em cinco linhas (2026-08-12).** A pedido do time, o painel
"Fechamento do orçado · por tipo de custo" soma as subdivisões: `A` + `AR` e
`F` + `FI` viram uma linha cada. Vale para o card do job e o da agregada do
projeto (e para as duas telas do módulo de Orçamentos). Em 13/08/2026 os
rótulos viraram **`Sub-total A` … `Sub-total F`**, o mesmo nome que o XLSX
exportado já usava; os descritores ("Bi-trib.", "Sem honor.", "Interno") saíram
do painel e seguem na legenda do rodapé. **Só a leitura mudou** — a conta
continua tipo a tipo em `REGRAS_TIPO_CUSTO`, e nenhum total se moveu. A fonte das linhas é `LINHAS_FECHAMENTO_POR_TIPO`
(`lib/calculos/versao-totais.ts`), com guarda de exaustividade. A legenda do
rodapé e o XLSX exportado seguem com os tipos separados. Regra completa em
`docs/decisions/003-tipos-de-custo.md`.

---

## 27. `jobs.valor_total` não é mais editável à mão

O drawer "Editar" do job tinha um campo `Valor Total (R$)` que **gravava direto
na coluna**, por cima do valor calculado dos itens. Não era hipótese: o
**JOB-0001 ficou com R$ 1.000.000,00 gravados contra R$ 5.617,00 de itens**, e
a lista e o card de Totais passaram a contar histórias diferentes.

Fechado em três pontas: o campo saiu do drawer, `valor_total` saiu do
`jobSchema` (`lib/validations/jobs.ts`) e a gravação saiu de
`atualizarJob`. As duas colunas agora só são escritas pela abertura do job e
pelas erratas. O card de Erratas passou a **recalcular dos itens** em vez de ler
`jobs.valor_total`, para nunca divergir da planilha logo acima.

⚠️ **O dado do JOB-0001 não foi corrigido** — é dinheiro gravado e ficou para
decisão do time.

---

## 28. Erratas registram os dois efeitos

Uma errata muda valor orçado e/ou tipo de custo, e as duas coisas podem mexer
nos dois números de forma **independente**: trocar `A · Direto` por `A · Repasse`
move o faturamento previsto e deixa o Valor do Job intacto. Guardar um número só
apagava metade do efeito no histórico.

As colunas antigas sempre guardaram o Valor do Job, então foram **renomeadas**,
não duplicadas:

| Antes | Depois | Novo |
|---|---|---|
| `jobs_erratas.faturamento_antes/depois` | `valor_job_antes/depois` | `faturamento_previsto_antes/depois` |
| `jobs_erratas_itens.efeito_faturamento` | `efeito_valor_job` | `efeito_faturamento_previsto` |
| `jobs.faturamento_abertura` | `valor_job_abertura` | `faturamento_previsto_abertura` |

Na tela, cada errata mostra os dois efeitos — no cabeçalho, na linha e por item.

**As colunas novas nascem `NULL` nas erratas anteriores a 11/08/2026**: o estado
histórico daquele momento não é reconstituível, e a tela mostra travessão em vez
de número inventado. Mesma regra para `faturamento_previsto_abertura`, que só
foi preenchido nos jobs **sem** errata — onde o valor de hoje é, por construção,
o da abertura.

---

## 29. Verificação (2026-08-11)

`tsc --noEmit` e `next lint` limpos; `npm run build` compila. O cálculo do
código foi conferido **contra a planilha oficial**, não contra uma réplica: as 5
abas batem em honorários, imposto e Valor do Job (tabela na seção 17.7 do
`HANDOFF_ORCAMENTO.md`).

No navegador, com dados reais:

| Tela | Resultado |
|---|---|
| Card de Totais do JOB-0004 | bate com a planilha Corona: honorários 44.287,80 · imposto 100.320,37 · 513.673,17 |
| Cabeçalho do job | um bloco só, "Valor do Job" |
| Agregada do projeto (A=80.000) | no card de Totais: fat. previsto 89.057,22 × Valor do Job 169.057,22 — diferença de exatos R$ 80.000, o subtotal A |
| Lista de jobs | uma coluna só ("Valor total"); linha do projeto em 47px, sem quebrar o botão "Visão agregada" |
| Card de Erratas do JOB-0002 | `EFEITO NO FAT. PREVISTO —` · `EFEITO NO VALOR DO JOB +R$ 1.392,00` (o travessão é a errata antiga, correto) |

### Migrations

| Migration | O que faz |
|---|---|
| `20260811000004_tipos_custo_subdivisoes.sql` | `AR`, `F`, `FI` no enum `tipo_custo` |
| `20260811000005_jobs_faturamento_previsto.sql` | `jobs.faturamento_previsto` + backfill |
| `20260811000006_erratas_dois_numeros.sql` | renomes das erratas + colunas de faturamento previsto |

---

## 30. `A · Repasse` na calha — BV **e** PP na mesma linha (2026-08-13)

Origem: design `Job - A com Repasse - BV e PP.dc.html` (projeto Claude
Design `69342d83`), lido via MCP `claude_design`.

> ⚠️ **Isto reverte uma regra escrita.** A decisão 003 dizia, com estas
> palavras, que o `A · Repasse` **não** tinha BV — "sem pagamento direto,
> não há comissão a negociar com o fornecedor". Passou a ter. Confirmado
> com o time em 13/08/2026 antes de qualquer linha de código.

### O que mudou

`AR` virou o único tipo com **duas** ações na linha da planilha: o
principal passa pela California e é repassado ao fornecedor (segue
gerando **PP**), e há comissão a negociar com esse mesmo fornecedor
(**BV**). Os outros tipos continuam com uma ação só.

### O que **não** mudou — confirmado com o time

**Nenhum número.** `REGRAS_TIPO_CUSTO.AR.calha` continua `"PP"`, então
faturamento previsto, valor do job, honorários, imposto e **previsão de
desembolso** ficaram idênticos. O BV segue sem abater custo e sem entrar
em rentabilidade, como desde `20260807000001_itens_bv.sql`. Incluir o BV
na conta é decisão futura do time, não desta entrega.

### A pílula dividida

A calha vive **fora** do frame da tabela, em 116px que a página reserva
com `pr-`. A regra do handoff: a tabela nunca cede espaço. Nas linhas de
`AR` a pílula **se divide em duas metades** dentro da mesma moldura —
BV à esquerda, PP à direita, fio de 1px entre elas —, o rótulo encurta
para a sigla e o texto completo vai para o tooltip.

Medido no navegador: pílula dividida **100,5px** contra **111px** de
"Adicionar BV". Ou seja, ela é mais estreita que a pílula mais larga que
já existia — nenhuma reserva precisou crescer e a tabela não perdeu um
pixel.

| Estado da linha `AR` | Calha |
|---|---|
| sem realizado lançado | `+ Adicionar BV` (pílula inteira) |
| com realizado, sem documentos | `+ BV │ 📄 PP` |
| BV lançado, PP emitida | `▦ BV │ 👁 PP` (neutro) |

**A PP só entra depois do realizado**, como em qualquer outro tipo — é
dele que sai o valor da PP. Por isso a linha começa inteira e se divide.

### Arquivos

| Arquivo | Papel |
|---|---|
| [`_planilha/calha-acoes.tsx`](app/(app)/_planilha/calha-acoes.tsx) | **Novo.** Fonte única da pílula da calha: forma inteira, forma dividida e `LARGURA_CALHA` |
| [`realizado/calha-linha.tsx`](app/(app)/jobs/[jobId]/realizado/calha-linha.tsx) | **Novo.** Junta as ações de uma linha e guarda o estado do "Ver PP" |
| `realizado/pp-actions-cell.tsx` | **Removido.** Só sabia de PP; virou o `calha-linha` |
| [`_bv/bv-action-button.tsx`](app/(app)/_bv/bv-action-button.tsx) | Passou a exportar `acaoBv()` (descrição) além do botão; visual delegado à calha |
| [`versao-totais.ts`](lib/calculos/versao-totais.ts) | `TIPOS_COM_BV` ganhou `AR`; `calha` documentado como "de quem sai o dinheiro", não "que botão aparece" |

### Migration

| Migration | O que faz |
|---|---|
| `20260813000001_bv_aceita_a_repasse.sql` | `bv_exige_item_com_bv` passa a aceitar `('A','AR','D')` — aditiva, só afrouxa |

Conferido pelo MCP depois de aplicar: função com os três tipos, trigger
ativo, `authenticated` **sem** execute na função, e os 4 BVs existentes
intactos.

### Verificado

`tsc --noEmit` limpo, `next lint` sem avisos novos (só os dois de
`combobox`/`multi-select`, que já existiam), `npm run build` compila.

A pílula foi conferida no navegador numa rota de preview temporária, já
removida: **não há item `AR` no banco hoje** (`select count(*) … tipo_custo
= 'AR'` → 0) e criar um só para ver a tela significaria escrever dado de
negócio numa base compartilhada. Falta, portanto, o teste de ponta a ponta
com item `AR` real — lançar BV e gerar PP na mesma linha.

---

## 31. Navegação por teclado nas planilhas (2026-08-13)

Pedido do time: "clicar em Tab com uma célula selecionada salva o ajuste e
abre a célula à direita". Setas direcionais entraram no mesmo pedido.

Vale para as **duas** grades editáveis do sistema, que são só duas:
`itens-table.tsx` (versão do orçamento, rascunho multi-jobs e rascunho
agregado — as três usam o mesmo componente) e
`job-item-realizado-table.tsx` (planilha interna do job).

### O que passou a valer

| Tecla | Efeito |
|---|---|
| `Tab` / `Shift+Tab` | confirma e anda na horizontal; na última coluna desce para a **primeira** coluna da linha seguinte |
| `Enter` / `Shift+Enter` | confirma e desce / sobe na mesma coluna |
| `↑` `↓` | idem Enter |
| `←` `→` | andam **só na borda** do texto — ver abaixo |
| `Esc` | desfaz, como antes |

No orçamento a sequência tem 9 colunas (Item, Tipo, Categoria e os 3+3 de
Orçado/Planejado) e o Tab cai na linha "Novo item" quando ela existe. No
job são 3 — só o bloco Realizado é editável.

Decisões do time (13/08/2026), perguntadas antes de codar: fim de linha
desce para a linha seguinte; as colunas de escolha entram na sequência
com o dropdown abrindo sozinho; e o Enter, que antes só fechava a edição,
passou a descer.

### As três coisas que não eram óbvias

**1. `←` e `→` disputam com o cursor do texto.** A regra: elas só saem da
célula com o cursor na primeira/última posição e sem seleção. No meio do
texto continuam sendo do cursor — senão não haveria como corrigir uma
descrição sem redigitar. `↑` e `↓` sempre navegam, porque o campo tem uma
linha só e não há cursor vertical a perder. Efeito colateral aceito: como
o campo entra com o valor todo selecionado, a primeira `→` só desfaz a
seleção; a segunda é que anda.

**2. O `<select>` não devolve o foco de forma confiável nesta grade.** A
primeira tentativa foi manter a célula ativa depois de escolher, com o
foco no gatilho, esperando o Tab. Não para de pé: nos editores de
rascunho toda escrita reconstrói a árvore de componentes, então qualquer
estado local da célula (inclusive a abertura do dropdown) se perde no
rebuild — a lista reabria sozinha e a célula ficava **presa**, sem como
sair pelo teclado. Duas versões foram testadas no navegador e as duas
falharam do mesmo jeito.

A saída foi eliminar a dependência: **escolher avança para a próxima
célula**, e o `<select>` some da tela. Não há foco a devolver nem popover
a manter. Para não arrastar quem usa mouse, a célula ativa registra
`porTeclado` — chegou por Tab/seta, escolher avança; chegou por clique,
escolher encerra a edição, como sempre foi. Esse sinalizador mora no pai
justamente porque estado de célula não sobrevive ao rebuild.

**3. Um bug antigo apareceu junto.** O `finalizado` das células nunca era
resetado: depois do primeiro Enter ele ficava `true` para sempre, e a
partir dali sair da célula pelo clique **não gravava**. Passava
despercebido porque o Enter fechava a edição e a célula raramente era
reaberta; com a navegação por teclado ela é reaberta o tempo todo. Um
`useEffect` de reset resolveu, nas duas grades.

### Verificado no navegador

No editor agregado do TESTE-0001/26, que é **rascunho** — o adaptador
grava em estado do React e nada vai ao banco até o "Salvar alterações",
então dá para exercitar a grade inteira sem escrever em base
compartilhada. E na planilha do JOB-0010, onde navegar sem alterar valor
não dispara escrita (`n === valorRealizado` só move a célula).

| Caso | Resultado |
|---|---|
| Tab horizontal | col 3 → 4 → 5 → **7**, pulando a coluna Total sozinho |
| Tab no fim da linha | linha 0 col 9 → linha 1 col 0 |
| Shift+Tab | linha 1 col 0 → linha 0 col 9 |
| Enter / ↑ / ↓ | descem e sobem na mesma coluna |
| `←` no meio do texto | fica na célula, move o cursor |
| `←` na posição 0 | sai da célula |
| Tab com dropdown aberto | atravessa a coluna **sem** alterar o valor |
| Escolher no dropdown, tendo chegado por Tab | grava e avança (Tipo → Categoria, coluna 2) |
| Escolher no dropdown, tendo chegado por clique | grava e encerra, sem avançar |
| Planilha do job | Tab 11 → 12 → 13 → linha seguinte; ↑ e Enter idem |

`tsc --noEmit` limpo, `next lint` sem avisos novos, `npm run build`
compila.

⚠️ **Não exercitado:** o Tab que sai da última linha para a linha "Novo
item" e dispara o salvamento dela. O código religa o foco ao id que a
`adicionar` devolve (as três origens devolvem), mas o caminho não foi
percorrido no navegador — testá-lo criaria item de verdade.

---

## 32. Planilha Interna visível antes da abertura (2026-08-17)

Regra do Tiago, registrada em `docs/decisions/013-realizado-antes-da-abertura.md`.

> ⚠️ **Isto muda o comportamento descrito na entrega 1.** Até aqui, job
> em `aguardando_abertura` ou `rejeitado_financeiro` mostrava na aba
> Planilha Interna apenas o bloco "Realizado indisponível" — a planilha
> inteira sumia. Esse bloco **não existe mais**.

### O que mudou

Nos dois status de pré-abertura a planilha aparece completa e o
**realizado já pode ser lançado** por administrador ou responsável do
job. Continuam presos ao job aberto pelo financeiro: **errata**
("Alterar orçado"), **BV** e **Pedido de Produção** — as ações que mexem
no orçado conferido ou viram compromisso de pagamento num job que ainda
pode ser devolvido.

No lugar do bloco removido, um aviso discreto acima da planilha diz o que
ainda não está disponível e por quê.

### O flag único virou dois

`podeEditarRealizado` controlava planilha, realizado, errata, BV e PP ao
mesmo tempo. Agora são dois, com o **mesmo** perfil de permissão
(administrador ou responsável) e status diferentes:

| Flag | Status aceitos | Controla |
|---|---|---|
| `podeEditarRealizado` | `aberto`, `em_producao`, `aguardando_abertura`, `rejeitado_financeiro` | células do bloco REALIZADO e a barra de atalhos de teclado |
| `podeAcoesPlanilha` | `aberto`, `em_producao` | "Alterar orçado", trilha lateral de BV/PP e a aba de PPs |

As duas listas de status moram em `jobAceitaRealizado` e
`jobAceitaAcoesPlanilha` (`lib/types.ts`), ao lado do `jobEstaCongelado`.
São elas que as server actions leem — a tela e o servidor não têm mais
como discordar sobre o que cada status permite.

### Arquivos

| Arquivo | Mudança |
|---|---|
| `lib/types.ts` | as duas funções novas |
| `jobs/[jobId]/page.tsx` | flag único → `podeEditarRealizado` + `podeAcoesPlanilha`; a aba de PPs passa a receber o restrito |
| `realizado/job-realizado-section.tsx` | early-return removido; prop `podeAcoes`; aviso de pré-abertura; "Alterar orçado" sob `podeAcoes` |
| `realizado/job-grupo-card.tsx` | repassa `podeAcoes` |
| `realizado/job-item-realizado-table.tsx` | células seguem `editable`; trilha de BV/PP passa a seguir `podeAcoes` |
| `jobs/[jobId]/actions-realizado.ts` | gate passa a aceitar a pré-abertura |
| `realizado/actions-errata.ts`, `realizado/actions-pp.ts` | mesmo bloqueio de antes, agora lendo a função compartilhada |
| `app/(app)/_bv/actions.ts` | **gate novo** |

### O gate do BV não existia

Errata e PP já recusavam a pré-abertura no servidor. O BV, não: a trava
dele em `carregarContexto` só cobria job **encerrado**, e a interface
escondia o botão — o que bastava enquanto a planilha inteira ficava
escondida. Com a planilha visível, uma chamada direta à action
(`origem: "job"`) passaria. A trava entrou no mesmo lugar da de
encerrado, então vale para lançar, confirmar e cancelar de uma vez.

### A reserva da calha acompanha a trilha

O `pr-[116px]` da seção seguia o flag único e a tabela desenhava a trilha
por outra condição (`editable || tem BV lançado`). Com os dois flags, as
duas passam a ler a **mesma** condição — `podeAcoes || tem BV lançado`.
Efeito colateral bem-vindo: job **encerrado** com BV lançado desenhava a
trilha sem reserva nenhuma e ela encostava na borda direita da página;
agora reserva.

### Verificação

`tsc --noEmit`, `next lint` (só os 2 avisos pré-existentes de
`components/ui`) e `npm run build` limpos. **Sem verificação no
navegador** — consolidada na etapa final do plano de alterações de telas,
por decisão do Tiago em 17/08/2026.

---

## 33. PPs parciais por item e parcelas de pagamento (2026-08-17)

Design: `Job - PPs Parciais - Opcoes.dc.html` (projeto Claude Design
`69342d83`), **opção 2a — Ficha numérica · sem gráfico**, lido via MCP.
Regras em `docs/decisions/014-pps-parciais-e-parcelas.md`.

> ⚠️ **Isto reverte duas regras escritas.** A entrega 1 dizia que o item
> tinha **uma** PP, e o índice `uniq_pp_ativa_por_item_realizado`
> materializava isso no banco. E a seção 30 descrevia a metade "Ver PP"
> da calha abrindo o PDF direto. As duas caíram: um item pode ter várias
> PPs, e a metade virou o chip `PPs · N`, que abre o painel.

### O que mudou

**1. Um item, várias PPs.** Sem limite de quantas e **sem limite por
fornecedor** (decisão explícita do Tiago — a primeira redação do plano
previa uma por fornecedor). O que trava é o saldo: a soma das PPs não
canceladas nunca passa do Realizado do item. PP **rejeitada continua
ocupando o saldo**; só o cancelamento devolve.

**2. Painel "Destrinchar realizado".** O chip `PPs · N` (ou "Gerar PP",
quando não há nenhuma) abre um painel lateral de 430px com a ficha
numérica do design: Realizado do item, Em PPs emitidas e Saldo, a lista
das PPs do item com "Ver PP" em cada uma, e o botão "Nova PP para este
item" com a nota do máximo aceito. É de lá que o formulário se abre — a
calha não abre mais PDF nem formulário direto.

**3. O valor da PP virou fatia.** Era `total_realizado` do item inteiro;
agora é `quantidade × (total_realizado ÷ quantidade_realizada)`. Dividir
o total pela quantidade embute o D/M sozinho. Sem campo de valor no
formulário: quem dimensiona é a quantidade, como nos números do design
(800 un / R$ 9.400,00 → R$ 11,75/un).

**4. Descrição e Quantidade abrem vazias**, para não induzir a pedir o
item inteiro a um fornecedor só.

**5. Parcelas.** "Prazo de pagamento" e "Parcelas" dividem a linha; com
2+ aparecem as linhas com vencimento (+1 mês, editável) e valor (divisão
igual com sobra na última, editável). A soma tem que fechar com o valor
da PP — no cliente e na action. Na aba de PPs do job, **uma linha por
parcela** (`PP-00008 · 2/3`); Editar/Ver PDF/Cancelar só na linha da 1ª,
porque são da PP inteira.

**6. Financeiro (leitura).** Chip `3x` na lista de PPs e bloco de
parcelas no drawer. A **baixa continua por PP** até a Tela 3.2, por
decisão de escopo do Tiago: ela reestrutura Contas a Pagar em "Títulos a
Pagar" e refaria a mesma máquina (`dar_baixa_pp`, estorno, `vw_a_pagar`,
`vw_fluxo_caixa`).

### Migration `20260817000002_pedidos_compra_parcelas.sql`

Aplicada e conferida pelo MCP. Três partes:

| Parte | O quê |
|---|---|
| Aditivo | tabela `pedidos_compra_parcelas` (12 colunas, RLS + 3 policies, `authenticated=arwDxtm` sem DELETE, 5 índices, trigger de `updated_at`) |
| Aditivo | backfill: as 8 PPs existentes viraram 1 parcela 1/1, herdando prazo, valor, `pdf_path` e a baixa |
| **Destrutivo** | `drop index uniq_pp_ativa_por_item_realizado` — **autorizado pelo Tiago nesta sessão** |

No lugar do índice entrou o trigger **`pp_valida_saldo_do_item`**, que é
a regra de verdade: recusa insert/update cuja soma passe do realizado do
item, com mensagem em português. Vale para chamada direta à action e para
dois cliques simultâneos, que o índice não cobria e o código sozinho não
cobre. Testado no banco (update de +R$ 1.000 numa PP recusado, e nada
gravado). Conferido antes de aplicar: nenhuma das 8 PPs viola a regra.

**Advisors:** nenhum achado novo — a função nasceu com `search_path`
fixo e `security invoker`. Os ERROR/WARN da lista são pré-existentes
(views SECURITY DEFINER, RPCs executáveis por `authenticated`,
`search_path` de funções antigas, leaked password protection).

### Arquivos

| Arquivo | Mudança |
|---|---|
| `lib/calculos/pps-item.ts` | **novo** — as contas (valor, saldo, divisão em parcelas, próximo vencimento), usadas pela tela E pela action |
| `lib/types.ts` | `PedidoCompraParcela`; `PedidoCompraNaLista.parcelas` |
| `realizado/painel-pps-item.tsx` | **novo** — o painel 2a |
| `realizado/calha-linha.tsx` | "Ver PP"/"Gerar PP" → chip `PPs · N` que abre o painel; o estado do PDF saiu daqui |
| `realizado/job-item-realizado-table.tsx` | `Map<string, PedidoCompra[]>`; painel + formulário encadeados |
| `realizado/gerar-pp-drawer.tsx` | campos vazios, valor derivado da quantidade, grid de parcelas, máximo aceito |
| `realizado/actions-pp.ts` | valor da fatia, gate de saldo, insert das parcelas, reenvio coerente |
| `jobs/[jobId]/page.tsx` | embed das parcelas; mapa de PPs por item vira lista |
| `pps/job-pps-section.tsx` | uma linha por parcela |
| `financeiro/contas-a-pagar/*` | parcelas na query, chip `3x` na lista, bloco no drawer |

### Verificação

`tsc --noEmit`, `next lint` (só os 2 avisos pré-existentes) e
`npm run build` limpos. Trigger exercitado no banco. **Sem verificação no
navegador** — consolidada na etapa final do plano, por decisão do Tiago
em 17/08/2026.

---

## 34. PDF da PP: um documento por parcela (2026-08-17)

Depende da entrega 33. Sem migration própria: a coluna
`pedidos_compra_parcelas.pdf_path` já nasceu na migration `20260817000002`.

### O que mudou

**Um PDF por parcela, arquivado na emissão.** O gerador roda uma vez por
parcela e cada documento vai para o bucket com nome próprio
(`pp-PP-00008-parcela-2de3.pdf`); o caminho fica na linha da parcela. PP
de parcela única mantém o nome histórico (`pp-PP-00008.pdf`) — mudar
quebraria o link das PPs já emitidas sem ganhar nada.

**O que muda entre os documentos da mesma PP:** só três coisas.

| Campo | Comportamento |
|---|---|
| Prazo de Pagto | vencimento DAQUELA parcela |
| Parcela: N/T | linha nova, logo abaixo do prazo, **sempre presente** (inclusive `1/1`) |
| Valor | o valor da parcela em destaque; em PP parcelada, "Valor total do pedido" logo abaixo, em peso normal |

Todo o resto (código, emissão, fornecedor, serviço, especificações,
dados bancários) é idêntico.

**`renderPedidoCompraPDF` ganhou o parâmetro `parcela`** — obrigatório.
Não há assinatura antiga sobrevivendo: PP sem parcelamento manda `1/1`, e
o documento sai com o mesmo desenho. Padrão uniforme é o que evita o
fornecedor achar que "sem parcela" significa outra coisa.

**Cada linha baixa o seu papel.** A aba de PPs do job mostra o botão de
PDF em TODA linha de parcela (Editar e Cancelar seguem só na primeira,
porque são da PP inteira), chamando a action nova
`signedUrlPdfParcela`. Ela cai no `pdf_path` da PP quando a parcela não
tem caminho — o que cobre as 8 PPs legadas, cuja parcela 1/1 aponta para
o documento único de sempre, sem regerar nada.

**Reenvio de PP rejeitada regera os N documentos**, sobrescrevendo. Não
é quebra do snapshot: o reenvio já regerava o PDF desde a entrega 2,
porque o papel que vai ao fornecedor não pode contradizer o que o
financeiro vai aprovar. Falha de upload no meio da EMISSÃO desfaz a PP
inteira — PP com metade dos documentos seria pior que PP nenhuma.

### Arquivos

| Arquivo | Mudança |
|---|---|
| `lib/pdf/pedido-compra.ts` | parâmetro `parcela`; linha "Parcela: N/T"; bloco de valor com destaque na parcela e total como secundário |
| `realizado/actions-pp.ts` | emissão e reenvio em laço por parcela; `caminhoPdfParcela`; `signedUrlPdfParcela` |
| `pps/job-pps-section.tsx` | botão de PDF por linha de parcela |

### Verificação

`tsc --noEmit`, `next lint` (só os 2 avisos pré-existentes) e
`npm run build` limpos. **Sem verificação no navegador** — consolidada na
etapa final do plano. ⚠️ **Não exercitado:** a emissão real de uma PP
parcelada (gerar 3 PDFs e abrir cada um) — depende de criar PP de
verdade, com anexo, num job aberto. É o primeiro caso a rodar na etapa
final.

---

## 35. Enviar para faturamento agora diz em quantas notas (2026-08-17)

> ⚠️ **Ajuste na seção 25 do `HANDOFF_FINANCEIRO.md` e no envio descrito
> antes deste documento.** O drawer "Enviar job para faturamento"
> carregava um valor e uma data. Agora carrega também **o parcelamento**.

Decisão do Tiago (registrada em
`docs/decisions/017-faturamento-agrupado-parcial-e-avulso.md` §3): quem
informa em quantas notas fiscais o job será faturado é a **produção**, no
envio — não o financeiro, e não a previsão de recebimento da abertura.

O drawer ganhou o bloco **"Em quantas notas este job será faturado"**,
com atalhos `1× 2× 3× 6×`, uma linha por parcela (valor + vencimento),
"Nova parcela" e o contador `Soma X / Y`. A 1ª parcela vence na data de
faturamento do formulário — mexer nela arrasta a primeira e deixa as
outras como estão, porque o espaçamento entre elas é acordo com o
cliente.

**O valor continua vindo travado** de `jobs.faturamento_previsto` e
relido no servidor. O que a action confere a mais é a **soma das
parcelas** contra esse número relido: o navegador diz como repartir, o
banco diz quanto. Se a gravação das parcelas falhar, o envio é desfeito —
envio sem parcela não apareceria na fila do financeiro, e o job ficaria
no limbo de "enviado, mas invisível".

Cada parcela vira uma **linha da aba Faturamento** em Contas a Receber,
com o seu próprio vencimento, faturada por sua própria NF (seção 35 do
`HANDOFF_FINANCEIRO.md`).

| Arquivo | O que mudou |
|---|---|
| `lib/validations/envio-faturamento.ts` | `parcelaFaturamentoSchema` e o campo `parcelas` |
| `jobs/[jobId]/actions-faturamento.ts` | confere a soma, grava as parcelas, desfaz o envio se falhar |
| `jobs/[jobId]/enviar-faturamento-drawer.tsx` | o bloco de parcelamento |
| `supabase/migrations/20260817000005_...sql` | tabela `jobs_envio_faturamento_parcelas` |

### Verificação

`tsc --noEmit`, `next lint` (só os 2 avisos pré-existentes) e
`npm run build` limpos. **Sem verificação no navegador** — consolidada na
etapa final do plano.
