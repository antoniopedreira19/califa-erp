# Handoff — Jobs: as quatro abas do detalhe do job

Registro da implementação do design **"Jobs - Fluxo"** no módulo de Jobs, mais
as decisões de modelagem e de negócio tomadas junto com o time durante a
execução.

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
| **"Pago"** | Flag simples aplicada pelo financeiro, com data informada (pode ser retroativa). Contas a pagar de verdade (`lancamentos_financeiros`, estorno) continua pendente e vai partir daqui. |
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
