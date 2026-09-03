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
| **Valor da PP** | ⚠️ **Mudou em 01/09/2026** (decisão 035). Era um campo só, `Quantidade`, e o valor saía de `quantidade × (total do item ÷ QT orçada)` — conta que embutia o D/M dentro do "unitário" e fazia a tela chamar de unitário um número que era o total. Agora o formulário abre com **R$ Unit., QT e D/M**, as mesmas colunas do item na planilha, e o valor é o **produto dos três**, ao vivo. Os três são do GP: o unitário da PP **pode diferir** do orçado (é o desconto do fornecedor). `pedidos_compra` ganhou `valor_unitario` e `dias_meses`; as funções `valorDaPP`/`unitarioEfetivo` foram **removidas** de `lib/calculos/pps-item.ts`. O **PDF da PP não mudou** — continua imprimindo quantidade e valor, sem a decomposição. |
| **Teto da PP** | ⚠️ **Reafirmado em 01/09/2026** (decisão 035). Continua sendo **só o saldo em R$** do item, no cliente e no trigger `pp_valida_saldo_do_item`. **Quantidade não limita:** um item orçado como `R$ 5.000 × 1 × 2` aceita uma PP de `R$ 2.500 × 1 × 4` — 4 diárias num item de 2, pelos mesmos R$ 10.000. O aviso de estouro passou a aparecer **ao vivo** dentro do bloco de valor, e não só no erro do topo ao clicar em Gerar PP. |
| **Campos da PP nascem vazios** | ⚠️ **Estendido em 01/09/2026** (decisão 035). Valia para `Descrição` e `Quantidade` desde 17/08; agora vale para **R$ Unit., QT e D/M**: preenchê-los com o orçado induziria a pedir o item inteiro a um fornecedor só. A decomposição do orçado (`5.000,00 × 1 × 2`) fica no cartão de cima, como referência. **Exceção:** a correção de PP rejeitada abre **com** os valores gravados — ali o GP conserta um documento que já existe. |
| **Decomposição do REALIZADO** | ⚠️ **Mudou em 01/09/2026** (decisão 035 §7). Antes derivava por rateio (`dias_meses` fixo em 1, unitário = total ÷ QT), o que contradizia o formulário. Agora: **com UMA PP no item**, as colunas R$ Unit., QT e D/M trazem o trio daquela PP e a linha fica idêntica ao que o GP digitou; **com mais de uma**, ficam **zeradas** e a planilha mostra `— · — · —`, porque a soma de compras diferentes produziria um unitário que nunca foi contratado. A quebra vive na tela de PPs do item, e o chip `PPs · N` da calha leva até ela. **`total_realizado` está correto nos dois casos** — é a soma dos `valor`, e nenhum cálculo do sistema deriva dinheiro das outras três colunas. Zerar bastou: `CelulaLeitura` e o card da visão agregada já tratam zero como travessão. |
| **Verba de Produção: emissão** | ⚠️ **Corrigido em 01/09/2026.** Nunca tinha emitido: a validação do responsável filtrava `profiles.tenant_id`, coluna que **não existe**, então toda PP de verba morria em "Responsável inválido ou não encontrado". Passou a checar por `listActiveMembers`, a MESMA fonte que monta a lista da tela — o formulário não oferece mais nome que o servidor recusa. |
| **Reenvio de PP: PDF** | ⚠️ **Corrigido em 01/09/2026.** Nunca tinha salvado: o reenvio regera o PDF sobre o mesmo path, e `upsert` sobre objeto existente é UPDATE no Storage — o bucket `pedidos-compra` tinha policy de INSERT, SELECT e DELETE e **nenhuma de UPDATE**. Falhava em "new row violates row-level security policy" **antes** de gravar a correção (a PP não era corrompida, só não avançava). Migration `20260901160001` acrescenta `pp_storage_update` com o mesmo predicado das irmãs. |
| **Lista de Jobs: filtros** | ⚠️ **Mudou em 01/09/2026** (decisão 036). A barra abre com a chave **Meus / Todos** (`components/ui/chave-meus-todos.tsx`), e **Meus é o padrão** — "meu" é `jobs.responsavel_id = usuário` (12 de 29 hoje). As cinco pílulas de status viraram um **Select de seleção única**, ao lado de dois Selects novos, **Produto** e **Regional**. Perda aceita: não dá mais para combinar dois status. Trigger ganha borda vermelha quando o filtro está aplicado. |
| **Lista de Jobs: colunas** | ⚠️ **Novas em 01/09/2026** (decisão 036). **Produto** e **Regional**, entre Projeto e Cliente. Saem do **próprio job** (`jobs.produto`, `jobs.regional_id`), não do projeto: os dois divergem na base — o JOB-0003 é "Ativação de marca" num projeto "Pevetech". A coluna **Projeto ficou** (o design a removia; instrução do Tiago foi manter o resto como está). |
| **"Marca" (era "Produto")** | ⚠️ **Renomeado em 02/09/2026** (decisão 037). O rótulo mudou na coluna e no filtro da lista de Jobs, na ficha e no editor do job, nas telas de abertura do Financeiro e no PDF da PP. Os nomes técnicos **não** mudaram: segue `jobs.produto`, alimentado por `projetos.produto_id` → `cliente_produtos` na abertura. |
| **Descritivo do job** | ⚠️ **Ganhou origem em 02/09/2026** (decisão 037). `jobs.observacoes` continua nascendo no modal de envio para abertura, mas agora chega **pré-preenchido** com o Descritivo escrito no orçamento (`orcamentos.descritivo`). Segue editável no modal, e job já enviado manda no que aparece — sobrescrever apagaria a edição feita ali. |
| **Cancelar PP** | Existe **só na aba de PPs do job**, e só pra PP em avaliação ou rejeitada. Saiu da Planilha Interna e da caixa do financeiro. |
| **PDF no reenvio** | Regerado sobrescrevendo o anterior no mesmo path. É o documento que vai pro fornecedor e o que o financeiro confere — não pode contradizer a PP. |
| **Anexo na emissão da PP** | Obrigatório (mín. 1): a nota do fornecedor já existe quando o pedido é feito, e é ela que o justifica. ⚠️ **Exceção desde 27/08/2026:** PP de **Verba de Produção** sai SEM anexo — ela é adiantamento, o dinheiro vai para o responsável interno *antes* de existir nota. As notas dela entram na **prestação de contas**, que exige no mínimo uma (`fecharPrestacaoVerba`). A trava é no cliente e na server action; a devolução do saldo (`pp_verba_devolucoes`) não tem anexo e nunca teve. |
| **Errata: onde grava** | O job ganha **cópia própria** dos itens orçados. A versão aprovada continua sendo o documento que o cliente aprovou e segue read-only. |
| **Errata: o que edita** | ⚠️ **Mudou em 27/08/2026** (decisão 030). Era "só R$ unitário e tipo de custo; QT, D/M, adição e remoção ficaram fora". Agora a errata corrige **R$ unitário, QT, D/M e tipo**, **cria** linha (normal ou vermelha) e **remove** linha. |
| **Errata: onde acontece** | ⚠️ **Mudou em 27/08/2026** (decisão 030). "Alterar orçado" abria um drawer com uma segunda tabela; agora ele liga o **modo errata** na própria Planilha Interna, e o rodapé vira a barra da errata. |
| **Errata: agrupamento** | ⚠️ **Mudou em 27/08/2026** (decisão 030). Era "título obrigatório e justificativa opcional". Agora é **um campo só, "Descrição da errata", obrigatório** — ele grava em `titulo`, e a coluna `justificativa` **foi removida do banco** no mesmo dia. |
| **Errata: permissão** | Liberada pra qualquer usuário nesta fase (decisão explícita do time, com intenção de travar mais tarde). Exige job em "Aberto". ⚠️ **27/08/2026:** criar linha normal e remover linha passaram a ter gate próprio (`podeEditarLinhas`), hoje aberto para todos; criar **linha vermelha** nunca terá gate. |
| **Errata: depois de gravar** | ⚠️ **Novo em 27/08/2026** (decisão 030). Toda errata sobre job já aberto marca `jobs.abertura_em_revisao`: o job volta ao mural de abertura do financeiro e o **envio para faturamento fica fechado** até a abertura ser salva de novo. O status do job não muda. |
| **Linha vermelha** | ⚠️ **Nova em 27/08/2026** (decisão 030). Orçado e planejado zerados (o banco cobra), só recebe realizado por PP, e é **isenta do teto do orçado** no `pp_valida_saldo_do_item`. |
| **Chave da planilha** | ⚠️ **Mudou em 27/08/2026** (decisão 030). `ItemPlanilhaJob.id` era o id do item da VERSÃO; agora é o da **cópia do job** (`jobs_itens_orcado.id`). `jobs_itens_realizado` e `itens_bv` ganharam `job_item_orcado_id`. A linha criada por errata não existe na versão, e por isso a chave antiga não servia mais. |
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

## 36. Verificação no navegador: a trilha de BV antes da abertura (2026-08-18)

**⚠️ Corrige a entrega 32.** A verificação final do plano de telas achou
uma sobra: num job **pré-abertura** (`aguardando_abertura` ou
`rejeitado_financeiro`) que já tinha um BV lançado lá atrás, a pílula
**"Abrir BV" continuava na calha** — e o popup abria **editável**, com
Fornecedor, Valor, Prazo e os botões Salvar · Confirmar · Remover BV
todos ativos. O critério da entrega 32 pede a trilha de BV ausente antes
da abertura.

**Por que aconteceu.** A calha aparece quando
`podeAcoes || itens.some(i => bvsPorItem[i.id])`. A exceção foi escrita
para o job **ENCERRADO** — "os BVs já lançados seguem consultáveis", que
é histórico e faz sentido — e a pré-abertura entrou depois no mesmo
`podeAcoes = false`, herdando uma regra que não era dela. Pior: o
`BvDialog` recebia `readOnly={!editable}`, e `editable` é o flag do
**REALIZADO**, que na pré-abertura é `true`. A calha até passava
`somenteLeitura: true`, mas isso só muda o *tooltip*.

**Nunca houve risco de dado**: a action recusava (gate de
`carregarContexto`, entrega 32), e o BV ficava intacto. Era beco sem
saída de UI — o usuário preenchia e tomava erro.

**O conserto.** Um `preAbertura` explícito, calculado em
`job-realizado-section.tsx` e descido até
`job-item-realizado-table.tsx`, separa os dois casos que `podeAcoes`
juntava:

- **encerrado** — `podeAcoes` falso, `preAbertura` falso: a pílula fica,
  para consulta, como sempre foi;
- **pré-abertura** — `podeAcoes` falso, `preAbertura` verdadeiro: a
  trilha some por inteiro, e a reserva de 116px (`pr-[116px]`) some
  junto, devolvendo a largura à planilha.

E o `BvDialog` passou a receber **`readOnly={!podeAcoes}`** em vez de
`!editable` — que é o certo nos três casos: aberto edita, encerrado
consulta, pré-abertura nem abre.

De quebra, a mensagem do gate em `_bv/actions.ts` passou a distinguir os
dois status: job devolvido lê "Job devolvido pelo financeiro — o BV fica
disponível depois da abertura", em vez de dizer "aguardando abertura"
para um job que foi devolvido.

**Conferido depois da correção:** JOB-0011 (`rejeitado_financeiro`) sem
nenhuma pílula na calha e com o realizado ainda editável; JOB-0010
(`aberto`) com "Abrir BV", "Gerar PP" e "Alterar orçado" no lugar, e o
popup do BV abrindo editável.

### A regra de PP por fornecedor, para quem for ler o plano antigo

O critério 3 da Tela 2.2 do plano local diz que "segunda PP do mesmo
fornecedor no mesmo item é recusada". **Esse critério está velho** — a
decisão do Tiago na própria entrega 33 (`docs/decisions/014`) removeu o
limite: não há teto de PPs por item nem por fornecedor, o que trava é o
saldo do realizado. A verificação confirmou o comportamento novo criando
a PP-00010 no mesmo item e mesmo fornecedor da PP-00009.

---

## 37. Aba Informações do Job: cabeçalho, ficha e barra de ações (2026-08-19)

Design: `Job - Informacoes - Cabecalho Opcoes.dc.html` (turno 6), com o
resumo do turno 1b de `Job - Resumo de Indicadores - Opcoes.dc.html` e a
barra de `Job - Informacoes - Barra de Acoes.dc.html`.

A aba tinha dois cards lado a lado — **Metadata** e **Origem** —, o card de
**Erratas** e um card de **Status** com os botões do fluxo. Virou: resumo de
duas linhas no topo, descritivo em faixa larga, ficha Job × Projeto,
três cards laterais, Erratas (inalterado) e uma barra fixa no rodapé.

### O resumo do topo virou duas linhas

`components/resumo-resultado.tsx`. A régua tinha cinco blocos irmãos —
Valor do Job, Custo planejado, Custo realizado, Resultado planejado,
Resultado realizado — e planejado e realizado só se pareavam na cabeça de
quem lia. Agora o Valor do Job fica isolado à esquerda, porque é o único
número sem par, e cada linha da direita é um cenário fechado: o custo e a
rentabilidade que ele produz.

⚠️ **O componente é compartilhado** com a visão agregada do projeto
(`/jobs/projeto/[projetoId]`). Decisão do Tiago em 19/08: **muda nas duas
telas**, não numa variante só do job. A conta (`calcularResultadoOperacional`)
não mudou; o travessão com "sem planejado"/"sem realizado" também não.

### O descritivo saiu do pé da ficha

`jobs.observacoes` — rotulado "Descritivo do Job" desde 17/08/2026 — passou
a ser a **primeira coisa depois das abas**, numa faixa da largura da tela e
em 16px. Era o texto mais lido da abertura e não aparecia nesta tela; só no
financeiro. O corpo trava em `104ch`.

### "Metadata" e "Origem" viraram ficha Job × Projeto

O card "Metadata" misturava campo do job com campo do projeto — e rotulava
**"Cliente"** um valor que era o **nome do projeto**. A ficha agora tem duas
colunas da mesma tabela:

| Coluna **Job** | Coluna **Projeto** |
|---|---|
| Nome do job | Nome do projeto |
| Categoria do job (`categorias_dominio`, escopo `orcamento`) | Cliente — `clientes.nome_fantasia`, o de verdade |
| Produto | Tipo do projeto |
| Regional · Cidade | Período do projeto |
| Competência | *Jobs do projeto* (lista, com badge de status) |
| Período | |
| Abertura (data · quem abriu) | |
| Prev. faturamento | |

**"Tipo do projeto" é a categoria do projeto** — `projetos.categoria_id`,
`categorias_dominio` escopo `projeto` (Always On, Ativação, Fee, Interno).
Decisão do Tiago em 19/08. Não confundir com a categoria do **job**, que sai
do mesmo catálogo mas do escopo `orcamento` — os dois vocabulários têm
"Ativação" e é fácil trocar um pelo outro lendo a tela.

Cinco campos **nunca tinham aparecido no módulo de Jobs**, embora já
existissem no banco e na Central Financeira: categoria do job, competência,
data e autor da abertura, produtor responsável e os contatos de cobrança.
Nenhuma migration foi necessária — o `select` da página é que não os trazia.

⚠️ **Competência aparece em dois formatos.** Aqui é `competenciaLabelLongo`
("3º tri · 2026"), como o design pede; a Central Financeira segue com
`competenciaLabel` ("3T/2026"), onde o campo divide linha com outros seis.
As duas funções moram juntas em `lib/types.ts` de propósito.

### Cards laterais: Responsáveis, Origem e Contatos

- **Responsáveis** — GP responsável e Produtor (`jobs.produtor_id`, que a
  tela nunca mostrou).
- **Origem** — Código do job, Projeto e **"Orçamento aprovado"**. Decisão do
  Tiago: seguir o design ao pé da letra. Isso **funde orçamento e versão num
  link só** e **remove "Valor de faturamento"** da aba (ele continua no card
  de Erratas e no resumo do topo). O link aponta para a **versão**, não para
  o orçamento — o rótulo diz "aprovado", e o que foi aprovado é a versão; a
  tela da versão tem o caminho de volta.
- **Contatos de cobrança** — `jobs_contatos` via `contatosDeCobrancaDoJob`,
  o mesmo carregador das quatro telas do financeiro. O design fechava com
  "Ver todos os 4 contatos"; **não existe tela de contatos do job**, e são 1
  a 4 por job na prática, então o card lista todos. O primeiro leva a pílula
  "Principal", que é a ordem do formulário de abertura.

### O card "Status" virou barra fixa no rodapé

`app/(app)/jobs/[jobId]/barra-acoes-job.tsx`, no mesmo padrão da barra de
aprovação do orçamento (`fluxo-abertura.tsx` · `sticky bottom-0`). As frases
que moravam no card viraram o texto à esquerda — a barra **sempre** diz em
que ponto do fluxo o job está, inclusive quando não há botão nenhum.

| Estado | Texto | Botão |
|---|---|---|
| `aguardando_abertura` | aguardando o financeiro, com link para a Central | Cancelar job |
| `rejeitado_financeiro` | devolvido, corrija e reenvie | Cancelar job |
| `aberto` sem envio | faturamento previsto | Enviar job para faturamento |
| `aberto` com envio | registro do envio | Enviar job para encerramento |
| `encerrado` · `cancelado` | é histórico + registro do faturamento | — |

**Cancelar job só existe antes da abertura** — regra nova, em
`docs/decisions/020-cancelar-job-so-antes-da-abertura.md`. A server action
continua aceitando o cancelamento; o que mudou é a superfície que o oferece.

O rótulo do encerramento continua **"Enviar job para encerramento"** e
vermelho California, não o "Encerrar job" verde que o desenho da barra
mostra — decisão do Tiago, para não renomear uma ação que passa por resumo
de fechamento. O `ENCERRAMENTO_INDISPONIVEL` foi ajustado: dizia "no bloco
de Status", que deixou de existir.

⚠️ **A barra fica FORA das abas**, como no protótipo — as ações são do job,
não da aba de Informações. Na aba **PPs** o FAB do chat (`fixed bottom-6
right-6`, `z-40`) encosta na barra (`z-20`). Levantado antes de implementar e
**aceito pelo Tiago em 19/08**; medido depois, com a página rolada e a barra
grudada: a sobreposição é de **5px × 20px**, só o canto superior direito do
botão. O rótulo e a maior parte da área de clique ficam livres. Com a página
sem rolagem não há sobreposição nenhuma — a barra fica acima do FAB.

### O card de Erratas não mudou

O turno 6 desenha o card simplificado, sem o bloco de valores do cabeçalho.
É esboço: o recorte do turno era cabeçalho e ficha. Decisão do Tiago:
manter o `ErratasCard` como está.

### Arquivos

| Arquivo | O quê |
|---|---|
| `components/resumo-resultado.tsx` | régua de 5 blocos → 2 linhas (afeta o job **e** a visão do projeto) |
| `app/(app)/jobs/[jobId]/ficha-job.tsx` | **novo** — descritivo, ficha Job × Projeto e os 3 cards laterais |
| `app/(app)/jobs/[jobId]/barra-acoes-job.tsx` | **novo** — barra fixa, textos por estado |
| `app/(app)/jobs/[jobId]/page.tsx` | `select` com os campos que faltavam, 2 queries novas, render da aba |
| `app/(app)/jobs/[jobId]/status-actions.tsx` | layout de linha para caber na barra; "Cancelar job" virou secundário |
| `app/(app)/jobs/[jobId]/enviar-faturamento-drawer.tsx` | botão na altura da barra (h-9) |
| `lib/types.ts` | `competenciaLabelLongo`; texto do `ENCERRAMENTO_INDISPONIVEL` |

As duas queries novas são os **jobs irmãos do projeto** (coberta por
`idx_jobs_projeto`) e o **nome de quem abriu** — esta não pode ser embed
porque `jobs.aberto_por` aponta para `auth.users` e o nome mora em
`profiles`. As duas entraram no `Promise.all` que já existia; os contatos de
cobrança entraram no primeiro. Nenhuma query em série foi adicionada.

### Verificação

`tsc --noEmit`, `next lint` e `next build` limpos. O build rodou numa cópia
do repo fora da pasta, porque o `next dev` estava de pé — build com o dev
server ligado corrompe o `.next` e derruba o CSS do preview.

Os embeds novos do `select` (`profiles!produtor_id`,
`categorias_dominio!categoria_id` e o aninhado `projetos → clientes` /
`projetos → categorias_dominio`) foram exercitados contra a API: voltaram
**401 de GRANT**, não 400 de relacionamento — ou seja, o PostgREST resolveu
a árvore inteira antes de esbarrar no RLS. De quebra confirma que `anon` não
tem SELECT em `jobs`.

**Conferência logada no navegador, 19/08/2026** — os cinco estados do job,
sem nenhum erro de console em nenhum deles:

| Job | Estado | O que confirmou |
|---|---|---|
| JOB-0015 | `aberto`, já enviado, 2 contatos, descritivo preenchido | ficha completa; barra com o registro do envio e "Enviar job para encerramento" |
| JOB-0013 | `aberto`, sem envio, sem contato, sem descritivo | "Sem descritivo do job.", "Nenhum contato de cobrança informado na abertura."; barra com "Enviar job para faturamento" e **sem** Cancelar |
| JOB-0014 | `aguardando_abertura`, sem categoria nem competência | travessões nos três campos da abertura, "— sem realizado" no resumo; barra com **Cancelar job** e o link para a Central |
| JOB-0011 | `rejeitado_financeiro` | banner de rejeição e "Reenviar pra aprovação" preservados; barra com Cancelar |
| JOB-0009 | `encerrado` | sem botão Editar; barra sem botão nenhum, só o texto e o registro do faturamento |

A regra nova está de pé: **Cancelar job aparece em JOB-0014 e JOB-0011 e não
aparece em JOB-0013 nem em JOB-0015**, os dois abertos.

Também conferidos: os quatro links da ficha (projeto no cabeçalho da coluna,
job irmão com o `?from=` preservado, e os dois do card de Origem, sendo o de
"Orçamento aprovado" apontando para a versão); a **visão agregada do
projeto** com o resumo novo de duas linhas (`PEVETE-0001/26`); a barra
presente nas abas Planilha Interna e PPs; e `scrollWidth == clientWidth` em
todas — **zero rolagem horizontal**, inclusive na Planilha Interna, onde a
tabela mede 1334px.


---

## ⚠️ 21/08/2026 — o BV entrou na conta, e o realizado saiu do teclado

Handoff de design: `Job - A com Repasse - BV e PP.dc.html`, telas **4a** e
**3b**. Regra completa em `docs/decisions/022-bv-liquido-e-realizado-por-pp.md`
— aqui fica só o que mudou nesta tela.

### A Planilha Interna não tem mais célula editável

O bloco REALIZADO era o único digitável. Ele passou a ser **derivado**:

| Tipo | Realizado |
|---|---|
| `A`, `D` | o **orçado**, desde a abertura (não geram PP) |
| `AR`, `B`, `C`, `F`, `FI` | **soma das PPs** não canceladas |

Saíram junto: a navegação por Tab do bloco, os overrides otimistas e a
Server Action `upsertItemRealizado` — **removida**, não escondida, porque
Server Action é endpoint e um realizado digitado por fora romperia a
igualdade com as PPs em silêncio. O rodapé de ajuda ("clique em qualquer
célula...") virou a explicação de onde o número vem.

`jobs_itens_realizado` continua existindo como **âncora** da PP
(`item_realizado_id`), agora criada no envio para abertura, zerada, e
mantida pelo trigger `trg_pp_recalcula_realizado`.

### O saldo da PP vem do orçado

Não dá mais para o realizado ser o teto: ele é a própria soma das PPs. O
painel "Destrinchar realizado" trocou a primeira ficha de "Realizado do
item" para **"Orçado do item"**, e o formulário de PP passou a medir a
fatia sobre a quantidade orçada. Ver a nota de 21/08 na decisão 014.

Efeito na calha: a metade **PP** da linha `AR` **nasce visível**. Antes
ela só aparecia com realizado lançado — o que nunca mais aconteceria.

### A chave Bruto ⇄ Líquido

Uma por página, no topo da seção, ao lado de "Alterar orçado". Em Líquido
o Total de PLANEJADO e REALIZADO mostra o custo **sem o BV**, com a
dedução em sub-linha (na célula e no subtotal do grupo, ali somando os
BVs de todos os itens). O ORÇADO é idêntico nos dois modos.

`JobRealizadoSection` virou **client component** por causa dela: a chave
vale para os grupos e para o card de Totais juntos, e o estado precisa
morar no ancestral comum. A mesma seção serve `/jobs/[jobId]` e
`/financeiro/jobs/[jobId]` — mexer nela muda as duas, que é o que se quer.

### O painel Resultado ganhou "+ BVs"

`Valor do Job − Impostos − Custo bruto + BVs`. É a mesma conta que
`− Custo líquido`, escrita do outro lado do sinal — então **o Resultado dá
o mesmo número nas duas vistas**. A chave não mexe nele.

### Visão agregada do projeto

`/jobs/projeto/[projetoId]` e `/financeiro/projetos/[projetoId]` passaram
a montar os totais por `blocosDoItem`, a mesma função da planilha do job.
Sem isso a visão agregada teria zerado o realizado de **todo item `A`**,
que na tabela fica em zero de propósito. As duas telas dividem o
componente `PlanilhasDoProjeto`.

### O REALIZADO fica zerado na pré-abertura

Achado na conferência: a regra é "realizado = orçado **desde a abertura**",
e o `A` estava mostrando o orçado já na fila do financeiro. Corrigido com
o flag `jobAberto` em `realizadoBrutoDoItem` / `blocosDoItem`: em
`aguardando_abertura` e `rejeitado_financeiro` o bloco inteiro zera —
total E quebra (R$ Unit. / QT / D/M).

Job **encerrado** continua mostrando o realizado: ele é histórico. Por
isso o flag é "já foi aberto", e não `jobAceitaAcoesPlanilha`.

### Verificação

`tsc --noEmit`, `next lint` e `npm run build` limpos. Os três gatilhos
novos exercitados no banco com dado real, dentro de uma transação
abortada (nada gravado):

| Gatilho | Resultado |
|---|---|
| `planejado_espelha_orcado` | tentativa de gravar planejado 1×1×1 num item `A` virou R$ 77.000,00, igual ao orçado |
| `trg_pp_recalcula_realizado` | âncora zerada + PP de R$ 100,00 (qtd 2) → realizado 100,00 / qtd 2,000 |
| `pp_valida_saldo_do_item` | PP acima do teto recusada: "passaria do orçado. Orçado: 4500,00, já em PPs: 100,00" |

**Conferência logada no navegador, 21/08/2026** — JOB-0010 (aberto, com
"Sinalização" tipo `A` + BV de R$ 15,00 a 19,54%, e itens `B` com PP):

| O que | Confirmado |
|---|---|
| Realizado de `A` | R$ 3.000,00 = o orçado |
| Realizado de `B` com PP | R$ 4.000,00 = Σ PPs (era 3.000 digitado) |
| Realizado de `B` sem PP | travessão |
| Chave em Líquido | planejado da Sinalização R$ 2.987,93 com sub-linha `BV −R$ 12,07` |
| Realizado com BV `a_negociar` | R$ 3.000,00 + **"BV não emitido"** |
| Subtotal e Totais em Líquido | R$ 5.747,93 e R$ 14.747,93, com a sub-linha somando o grupo |
| Rótulos | ORÇADO segue "Total"; PLANEJADO e REALIZADO viram "Total líquido" |
| Painel Resultado | `− Custo planejado 14.760,00 + BVs 12,07 = 5.210,47`, **idêntico nas duas vistas** |
| BV confirmado (simulado no banco e revertido) | realizado virou R$ 2.987,93 com `BV −R$ 12,07`; Resultado ganhou `+ BVs (confirmados, líquidos)`; rentab. do cabeçalho 53,8% → 53,9% |
| Painel "Destrinchar realizado" | "Orçado do item" R$ 7.000,00 · em PPs R$ 4.000,00 · **saldo R$ 3.000,00** |
| Formulário de PP | "Orçado do item" e "R$ 7.000,00 por unidade do orçado" |
| Calha | `PPs · 1` e `Gerar PP` visíveis sem realizado lançado |
| Visão agregada do projeto | realizado R$ 7.000,00 (batendo com a planilha) e R$ 14.747,93 em Líquido |
| `/financeiro/jobs/[jobId]` | mesma planilha, mesma chave, realizado R$ 7.000,00 no resumo |
| Conferência da abertura (JOB-0012) | REALIZADO inteiro em travessão; chave presente; "Somente leitura" preservado |
| Rolagem horizontal | `scrollWidth == clientWidth` em todas |
| Console | zero erros em aba limpa |

O espelho de `A`/`D` foi exercitado ao vivo na versão em rascunho
TESTE-0003/26 · Teste B2: as três células do PLANEJADO não abrem, e mudar
o orçado de R$ 200,00 para R$ 250,00 arrastou o planejado junto, no banco
e na tela. Revertido para R$ 200,00.


---

## ⚠️ 21/08/2026 — a Planilha Interna passou a recolher agrupamento

Pedido do Tiago: o "Recolher todos" e o chevron por grupo, que só o
orçamento tinha, valem para **todas** as planilhas do sistema.

Na Planilha Interna (que serve `/jobs/[jobId]` e
`/financeiro/jobs/[jobId]`) e na conferência da abertura não havia nada
disso — nem botão, nem chevron. Agora têm os dois, no mesmo desenho do
orçamento.

Recolhido, o grupo mantém **subtotal e rentabilidade** à vista e esconde
as linhas de item, **a calha de BV/PP** e o rodapé de ajuda. A calha some
junto de propósito: ela é posicionada em `absolute` contra as linhas, e
sobreviver a elas deixaria as pílulas flutuando sobre o subtotal.

Na **visão agregada** os grupos já recolhiam, mas não havia o botão. Ele
entrou **dentro de cada card de job**, e não no topo da página: lá cada
bloco de job é uma planilha (grupos e subtotais próprios), e os cards
nascem fechados — um botão no topo mexeria em grupos invisíveis.

A máquina de estado virou fonte única em
`app/(app)/_planilha/recolher-grupos.tsx`, e o `GruposSection` do
orçamento passou a consumi-la em vez de manter a cópia dele. Ver a seção
"Recolher agrupamento" de `docs/09-identidade-visual-ui.md`.

**Verificação:** `tsc --noEmit`, `next lint` e `npm run build` limpos.
Conferido logado em 21/08/2026:

| Tela | Confirmado |
|---|---|
| Planilha Interna (JOB-0010) | "Recolher todos" → linhas e calha somem, SUBTOTAL e RENTABILIDADE ficam, contador vira "2 itens ocultos", botão vira "Expandir todos" |
| Chevron individual | abre só aquele grupo; com estado misto o botão do topo volta a "Recolher todos" |
| Conferência da abertura (JOB-0012) | mesmo comportamento, com "Somente leitura" preservado |
| Visão agregada | botão aparece ao abrir o card do job; "Expandir todos" abriu os dois grupos e virou "Recolher todos" |
| `/financeiro/jobs/[jobId]` | botão e chevrons presentes |
| Orçamento (sem regressão no refactor) | 7 linhas → 2, rótulo alterna, subtotal fica |

Zero erros de console em aba limpa e zero rolagem horizontal.

---

## ⚠️ 2026-08-24 — A Planilha Interna virou uma tabela só (design "Grupos Unificados")

**Origem:** projeto Claude Design `69342d83`, arquivo
`Planilha Interna - Grupos Unificados.dc.html`, tela `1b Job`. Regra
transversal em `docs/decisions/024-planilha-em-tabela-unica.md` e
`docs/09-identidade-visual-ui.md` ("Linha do agrupamento").

**O que mudou nesta tela.** Os cards de grupo acabaram: a Planilha
Interna é **um card e uma tabela**, com um `<thead>` só. Cada agrupamento
é uma linha de 40px, e a tabela fecha com **TOTAL DA PLANILHA** no
`<tfoot>`. Vale igual em `/jobs/[jobId]` e em `/financeiro/jobs/[jobId]`,
que sempre mostraram a mesma planilha.

**A sublinha "Rentabilidade" acabou.** Ela abria uma linha inteira embaixo
do subtotal, em cada grupo — duas por card, quatro numa tela de dois
agrupamentos. Agora a rentabilidade ocupa o **vão vazio** de PLANEJADO e
REALIZADO, à esquerda do total, na mesma linha do subtotal. No ORÇADO ela
não existe: ele é a base da comparação. Mesma mudança no card de Totais,
nas linhas de agrupamento e no rodapé.

**A calha deixou de contar linhas e passou a medi-las.** Com linhas de
alturas diferentes na mesma tabela (grupo 40px, item 34px, sub-linha do BV
crescendo na vista Líquido), `railTop` + altura fixa acumulava erro a cada
agrupamento. Cada `<tr>` agora se marca com `data-calha` e
`_planilha/calha.tsx` lê a posição real. O BV e a PP continuam na mesma
calha de 116px, e o `pr-[116px]` da página não mudou.

**Visão agregada do projeto:** a mesma correção. As linhas de agrupamento
de cada bloco de job ganharam a rentabilidade no vão e o fundo forte da
linha de grupo; as duas linhas de rodapé ("Total do job" + "Rentabilidade")
viraram uma. Idem no card de Totais do projeto, nas linhas por job.

**Cores:** nada mudou. ORÇADO azul, PLANEJADO verde, REALIZADO laranja,
rentabilidade em grafite (decisão 015). O handoff só repinta a tela de
orçamento, e essa parte foi recusada — ver a decisão 024.

**Arquivos:** `job-item-realizado-table.tsx` passou a receber `grupos`
(todos) e `job-grupo-card.tsx` deixou de existir — ele só dava moldura a
um agrupamento.

**Verificação:** `tsc --noEmit`, `next lint` e `npm run build` limpos.
Conferido logado em 24/08/2026: JOB-0006 (3 agrupamentos, calha de PP e BV
alinhada linha a linha — medido no DOM, zero célula transbordando),
conferência da abertura (JOB-0012) e visão agregada do projeto
`89f4c6b7` com os três jobs abertos.

---

## ⚠️ 2026-08-25 — O card de Totais perdeu a tabela de agrupamentos

Regra transversal em
`docs/decisions/026-agrupamentos-saem-do-totais-e-linha-nova-por-teclado.md`.
A mudança nasceu na tela da versão do orçamento e veio para cá porque o
motivo é o mesmo.

**O que saiu.** A tabela do topo do `JobTotaisCard` — "Agrupamento /
Grupo 1 / Grupo 2 / … / TOTAL DOS CUSTOS", com ORÇADO, PLANEJADO e
REALIZADO lado a lado. Vale em `/jobs/[jobId]` (Planilha Interna) e na
conferência da abertura, em
`/financeiro/abertura-de-job/[jobId]/planilha`, que sempre usaram o mesmo
card.

**Por quê.** Desde a decisão 024 o subtotal do agrupamento mora na
própria linha do grupo, já no eixo das colunas de cada bloco, e a
Planilha Interna tem "Recolher todos" desde 21/08/2026: recolher deixa
exatamente a lista de agrupamentos com os subtotais. A tabela do Totais
virou uma segunda cópia do mesmo número.

**O que NÃO mudou:** fechamento do orçado por tipo de custo, faturamento
previsto, Valor do Job e o `PainelResultado` inteiro — mesmos números,
mesmas contas. A visão agregada do projeto (`ProjetoTotaisCard`) e o
Totais do `/agregado` e do `/multi` (`TotaisProjetoCard`) **não foram
tocados**: as linhas deles são por job/planilha, não por agrupamento, e
não há "Recolher todos" que mostre aquilo.

⚠️ **O `JobTotaisCard` não recebe mais `visao` nem `grupos`.** A chave
Bruto ⇄ Líquido continua valendo para a planilha acima dele; o que restou
dentro do card lê o custo **bruto** e mostra o BV como linha própria
(decisão 022), então já dava o mesmo número nas duas vistas. Quem chamar
o card passando `visao` agora quebra o build — é de propósito.

**Verificação:** `tsc --noEmit`, `next lint` e `npm run build` limpos.
Conferido logado em 25/08/2026 na Planilha Interna do job `ceedcfb5` —
Totais com zero `<table>`, sem "Agrupamento", sem overlay de erro,
fechamento e `PainelResultado` (abas Planejada/Realizada) intactos — e na
conferência da abertura do JOB-0012
(`/financeiro/abertura-de-job/…/planilha`), idem.

## ⚠️ 24–27/08/2026 — o SAVE no job

**Regra:** `docs/decisions/028-save-entre-jobs.md`.
**Contexto no orçamento:** ver o handoff de Orçamentos, mesma data.

O save é crédito entre jobs: a linha marcada é faturada no job de origem,
não entra no valor dele, e vira saldo que **outro job do mesmo cliente**
consome. O saldo é do **job**, não da linha (nota de 26/08/2026 na decisão
023): qualquer job do cliente consome, uma linha pode beber de vários, e
nada fica reservado.

### O que apareceu na Planilha Interna

- Coluna **SAVE** à esquerda (15 → 16 colunas), com as pastilhas de
  origem (`JOB-0020`, `JOB-0020 +1`) e de destino (`o saldo deste job já
  foi consumido por JOB-0022`).
- Marcar save e definir consumo **depois da abertura passam pela
  ERRATA** (`save-errata-actions.ts`): os dois mudam o faturamento
  previsto e o valor do job, que é exatamente o que a errata registra.
- Linha em save não oferece **BV nem PP** na calha — os dois já eram
  recusados no banco; agora a calha nem os mostra.
- O card de Totais do job ganhou a mesma quebra em três colunas da tela
  da versão (save usado · save gerado · custos do job) — ⚠️ desde
  01/09/2026 **fechadas por padrão**, atrás do botão "Save", e a linha
  "Saldo em save" passou a se chamar **"Save gerado"**. O "Saldo em save"
  e o parágrafo que explica a divergência entre os dois totais.

### Achados do teste ponta a ponta (27/08/2026)

1. **A abertura não copiava a marca de save.** `enviarJobParaAbertura`
   montava `jobs_itens_orcado` sem `em_save`/`save_consumido`. O job
   nascia com os totais certos (calculados da versão) e a planilha
   "normal": o crédito não existia, e o planejado do tipo `A` voltava a
   espelhar o orçado pelo trigger. **Este era o pior achado do teste** —
   o save simplesmente não atravessava para o job.
2. **O consumo não mudava de ponta.** `saves_consumos` nasce apontando
   para a linha da versão; na abertura ele tem de passar a apontar para a
   cópia do job (`chk_save_consumo_uma_ponta` só admite uma ponta). Sem
   isso o dinheiro em save nunca migrava para o job consumidor no fluxo
   de caixa, e a errata do job — que apaga e recria por
   `job_item_orcado_id` — teria contado o consumo duas vezes.
   Migration acompanhante: `20260827010012`, que **congela o
   `save_consumido` da versão aprovada** para que a migração da ponta não
   zere o registro do que o cliente aprovou.
3. **O job pago 100% por save ficava preso.** Faturamento previsto zero:
   `enviarJobParaFaturamento` recusa valor zero e o encerramento só
   aparecia depois do envio. A regra do Tiago (27/08) é que ele **pula a
   etapa e se comporta como já faturado** — o portão do servidor
   (`encerrarJob`) já tinha a exceção, faltava a tela. `carregar-detalhe`
   passou a calcular `pagoSoPorSave` (faturamento zero **e** consumo de
   save) e a barra de ações mostra o encerramento, com a frase que explica
   por quê. O resumo de fechamento ganhou a linha "Pago com saldo em save
   de outro job".
4. **O envio para faturamento não dizia quanto era save.** O drawer ganhou
   a leitura "Deste total, R$ X é saldo em save: o cliente paga agora e
   gasta em outro job".
5. **Job recusado pelo financeiro continuava oferecendo crédito.**
   `vw_saves_por_job` não olhava o status. Migration `20260827010011`
   exclui `rejeitado_financeiro` e `cancelado`. `aguardando_abertura` e
   `encerrado` continuam valendo — o crédito é do cliente e sobrevive ao
   encerramento da origem.

### Depois do envio para faturamento, o save congela

Marcar save e mexer em consumo passam pelo mesmo portão da errata
(`jobJaEnviadoParaFaturamento` + `MENSAGEM_JA_ENVIADO`): *"Este job já foi
enviado para faturamento. O valor da nota está congelado… Para corrigir,
peça ao financeiro para desfazer o envio."*

**Verificação:** conferido logado, no projeto TESTE-0005/26 · Revisão
Save. JOB-0020 gerou R$ 60.000 de crédito, JOB-0021 nasceu de um orçamento
de save inteiro (valor do job R$ 0,00), JOB-0022 consumiu R$ 45.000 de
duas origens e JOB-0023 foi pago 100% por save, pulou o faturamento e
**encerrou**. `tsc`, `lint` e `build` limpos.

---

## ⚠️ 31/08/2026 — o envio para faturamento troca o CNAE pela descrição da NF

**Regra:** `docs/decisions/033-a-descricao-da-nf-vem-do-gp-e-o-cnae-do-financeiro.md`.

O formulário "Enviar job para faturamento" **perdeu o campo CNAE** e
**ganhou "Descrição a constar na nota fiscal"**, obrigatório, num
`Textarea` de 3 linhas.

O CNAE estava na mão errada: é classificação fiscal da nota, e quem emite
a nota é o financeiro. O GP não tinha como saber, e digitava qualquer
coisa porque o campo era obrigatório. Ele agora é pedido ao financeiro, no
drawer "Faturar" de Contas a Receber.

No lugar entrou o que só o GP sabe: como o cliente exige que a nota seja
descrita. O financeiro recebe esse texto pronto e o copia para a NF.

| Onde | O que mudou |
| --- | --- |
| `enviar-faturamento-drawer.tsx` | campo `cnae` → `descricao_nf` (`Textarea`, 2000 caracteres) |
| `lib/validations/envio-faturamento.ts` | `cnae` sai do schema; `descricao_nf` entra, obrigatória |
| `actions-faturamento.ts` | grava `descricao_nf`; o audit registra `tem_descricao_nf` |
| `carregar-detalhe.ts` | o `select` do envio troca `cnae` por `descricao_nf` |
| Banco | `jobs_envio_faturamento.descricao_nf` nasce; `cnae` perde `not null` e o CHECK |

O CNAE já gravado nos envios antigos **não foi apagado** — é o registro do
que a produção declarou e serve de rastro. Envios anteriores a 31/08/2026
ficam sem `descricao_nf`, e isso é estado legítimo: o financeiro vê o vazio
nomeado no botão de informações e escreve a descrição na mão.

**Verificação:** `tsc`, `lint` e `build` limpos. Conferência logada
combinada para o fim das três entregas de Contas a Receber.

---

## ⚠️ Nota de 2026-09-01 — save no módulo de Jobs

O que mudou nas telas daqui. O detalhe completo está na nota de
2026-09-01 do `HANDOFF_ORCAMENTO.md`; aqui fica só o que é de Jobs.

- **Visão agregada do projeto ganhou a coluna Save**, em leitura. O
  liga-desliga fica no menu "Exibir" da barra do topo, e não colado na
  tabela como nas planilhas internas: o card de cada job é
  `overflow-hidden` e uma alça em `right-full` seria cortada. O estado é
  um só para a tela — o card de Totais divide o `colgroup` com os blocos e
  não teria qual alça seguir.
- **A divisão do fechamento por função do save** agora existe na planilha
  interna E na agregada, com botão nas duas, **fechada por padrão**.
- **"Saldo em save" virou "Save gerado"** e a explicação das duas bases
  virou o segundo tópico da legenda, igual à tela da versão.
- **O save só é oferecido depois do envio para faturamento** (regra nova).
  Ponto que importa na operação: **o saldo não expira** — segue oferecido
  depois da nota emitida, do recebimento e do **encerramento do job**.
  Detalhe e prova na nota de 2026-09-01 da decisão 028.

---

## ⚠️ Nota de 2026-09-02 — a PP nasce gerada; a errata não toca linha com PP

Regras em `docs/decisions/039-pp-nasce-gerada-e-o-envio-ao-financeiro-e-uma-acao.md`
e `040-errata-nao-toca-linha-com-pp-e-trava-o-envio-de-pp.md`. Design:
`PPs - Gerar e Enviar ao Financeiro.dc.html` (projeto Claude Design
`69342d83`). Migrations `20260902160001` e `20260902160002`.

**Isto muda as seções 4, 20, 33 e a nota de 21/08 ("O saldo da PP vem do
orçado").**

### O que mudou para quem gera PP

- **"Gerar PP" não envia mais.** A PP nasce com status `gerada`, com
  código e PDF, e fica no job. O painel "Destrinchar realizado" ganhou
  dois blocos: **Aguardando envio** (com Enviar ao financeiro, editar,
  ver e cancelar por PP) e **Já no financeiro** (status + ver).
- **Planejado no lugar do orçado**, no painel e no formulário. "Em PPs
  emitidas" soma só o que já chegou ao financeiro e acende em vermelho
  acima do planejado. O Saldo e o "máximo aceito" saíram.
- **Sem teto por PP.** O trigger `pp_valida_saldo_do_item` foi removido.
  Passar do planejado não impede gerar; no envio, pede o responsável do
  job ou administrador, com o pop-up "Enviar PP acima do planejado?".
  Linha vermelha (planejado zero) sempre cai nele — e finalmente aparece
  na calha, que escondia a metade PP em item de valor zero.
- **Anexo opcional para gerar, obrigatório para enviar** (fora da verba
  de produção). A PP sem anexo mostra o pedido de NF em vermelho na
  própria linha, com o botão de enviar desabilitado.
- **Editar PP gerada** reabre o mesmo formulário (`GerarPPDrawer`, com
  `ppEditando`), permite mudar tudo — parcelamento e verba inclusive — e
  regera os PDFs. Server action `editarPedidoCompraGerada`.
- **Cancelar PP gerada** é o cancelamento de sempre (status `cancelada`).
- **O chip `PPs · N` da calha carrega um círculo vermelho** com as PPs
  geradas e não enviadas (`AcaoCalha.badge`, desenhado por `CalhaAcoes`
  fora da moldura para a pílula dividida não cortá-lo).
- **Aba "Pedidos de Produção":** chip "Gerada", cancelar da gerada e o
  número de PPs aguardando envio no card de resumo. Enviar e editar a
  gerada ficam no painel do item, onde o design os desenhou.
- **Fio de Comunicação de PPs:** a PP gerada fica fora; o card "PP
  emitida" é o envio (`enviada_financeiro_em` / `_por`).

### O que mudou para quem faz errata

- **Linha com PP no financeiro não entra em errata** — nem valor, QT,
  D/M, tipo, nem remover. Cadeado ao lado do nome, células de leitura,
  Remover desabilitado com o motivo. Servidor:
  `barrarLinhaComPPNoFinanceiro`. A regra de §20 (trava só na troca de
  tipo) caiu; `barrarTrocaDeTipo` ficou só com o BV.
- **Com a abertura em revisão, nenhuma PP é enviada** (nem reenviada).
  Servidor: `barrarEnvioEmRevisao`. Barra do job: "Aguardando revisão da
  abertura desde a última errata". O status do job continua `aberto`.

### Arquivos

| Arquivo | Mudança |
|---|---|
| `realizado/actions-pp.ts` | `gerada` no insert; sem saldo; `enviarPedidoCompraAoFinanceiro`, `editarPedidoCompraGerada`; PDFs por `renderizarDocumentosDaPP` (um helper para geração, edição e reenvio) |
| `realizado/painel-pps-item.tsx` | reescrito no layout do design |
| `realizado/gerar-pp-drawer.tsx` | planejado, prévia de "Em PPs emitidas", modo edição, anexo opcional |
| `realizado/calha-linha.tsx` · `_planilha/calha-acoes.tsx` | contador de pendências; sem filtro por valor |
| `realizado/job-item-realizado-table.tsx` | fiação nova; `travadasPorPP` no modo errata |
| `realizado/actions-errata.ts` | `barrarLinhaComPPNoFinanceiro` |
| `pps/editar-pp-drawer.tsx` | confirmação acima do planejado no reenvio |
| `lib/calculos/pps-item.ts` | `somaDasPPsEmitidas`, `contarPendentes`, `passaDoPlanejado`; `saldoDoItem`/`passaDoSaldo` removidos |
| `lib/types.ts` | `PPStatus` com `gerada`; `ppChegouAoFinanceiro`; `PP_STATUS_EM_ABERTO` inclui gerada |

### Verificado ao vivo (02–03/09/2026)

`tsc --noEmit`, `next lint` e `npm run build` limpos (build numa cópia
isolada, para não corromper o `.next` do dev server). No navegador,
logado, no JOB-0016 (projeto Teste Alterações), JOB-0013 e JOB-0002:

| Cenário | Resultado |
|---|---|
| Gerar PP sem anexo, R$ 12.000 > planejado 10.000 (PP-00018) | nasceu `gerada`; realizado do item seguiu 0; chip com círculo "1"; aviso âmbar no formulário |
| Painel do item | "Enviar ao financeiro" travado, pedido de NF em vermelho na linha |
| Editar a gerada para R$ 9.000 | gravou; parcela e PDF regerados; auditoria `gerada` + `editada`. **Achado:** `pedidos_compra_parcelas` não tinha DELETE — migration `20260902160003` |
| PP de verba R$ 21.000 > planejado 20.000 (PP-00019) → Enviar | pop-up "Enviar PP acima do planejado?" com os números → `em_avaliacao`, `enviada_financeiro_por` = Tiago, realizado 21.000, chip sem círculo |
| Gerar PP com NF anexada pelo formulário (PP-00020, R$ 5.000) → Enviar | anexo liberou o botão; dentro do planejado foi direto, sem pop-up |
| Cancelar gerada (painel) e em avaliação (aba de PPs) | canceladas; realizado voltou; aba com chip "Gerada" e "aguardando envio" no card |
| JOB-0013, modo errata | Item 1 (PP-00008 em avaliação): cadeado, células de leitura, tipo sem seletor, Remover desabilitado com o motivo; Item 2 editável. Descartado sem gravar |
| JOB-0002, corrigir PP-00006 rejeitada (R$ 18.000 > planejado 16.000) | "Salvar e reenviar" abriu "Reenviar PP acima do planejado?" com os números; "Voltar" — nada gravado |
| JOB-0016 com `abertura_em_revisao` ligada por SQL (revertida depois) | painel com a faixa âmbar e "Enviar" travado; `enviarPedidoCompraAoFinanceiro(id, true)` chamada direto pelo console recusou com a mensagem da revisão; JOB-0030 (em revisão de verdade) mostrou o selo novo na barra |

PPs de teste (PP-00018 a PP-00021) ficaram `cancelada`, que é o fim normal.
