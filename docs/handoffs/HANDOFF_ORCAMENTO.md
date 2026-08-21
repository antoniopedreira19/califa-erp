# Handoff — Orçamentos: versão, grade de itens e formulário de projeto

Registro da implementação dos design handoffs aprovados para o módulo de Orçamentos.

**Datas:** 2026-07-27 (entregas 1–3) · 2026-07-30 (entregas 4–8) · 2026-07-31 (entrega 9) · 2026-08-03 (entrega 10) · 2026-08-06 (entrega 11) · 2026-08-07 (entregas 12 e 13) · 2026-08-11 (entrega 15) · 2026-08-12 (entrega 17) · 2026-08-17 (entrega 18)
**Origem do design:**
- Entregas 1–3: pacote `design_handoff_califa/` (`Versoes - Destaque v4.dc.html` opção 2a, `Orcamento - Edicao Inline.dc.html` opção 3b, `README.md`, `IMPLEMENTACAO.md`). A pasta fica **só na máquina local** — está no `.gitignore` por ser referência de design, não código.
- Entregas 4–5, 8 e 9: projeto Claude Design `69342d83-28d9-4bea-a8af-c99e233f5f13` (`Orcamento - Versao -final-.dc.html`, `Novo projeto.dc.html` e `Abertura de Job.dc.html`), lido via MCP `claude_design`. A Entrega 9 é a revisão do mesmo `Abertura de Job.dc.html`, relido depois de atualizado.
- Entregas 6–7: pedidos diretos do time, sem handoff de design.
- Entrega 10: slide "Título do Orçamento" enviado pelo time (2 pedidos anotados sobre print da tela da versão).
- Entrega 11: pedido direto do time sobre prints das quatro telas (lista de projetos, formulário de projeto, orçamentos do projeto, formulário de orçamento). Sem handoff de design — as decisões saíram de perguntas respondidas durante a sessão, registradas na seção 12.
- Entrega 15: projeto Claude Design `69342d83` (`Comparativo Cores - Orcamento e Job.dc.html`). Cobre orçamento e job; a parte de Jobs está na Parte IV do `HANDOFF_JOBS.md`. A regra transversal ficou em `docs/09-identidade-visual-ui.md`.
- Entregas 12 e 13: projeto Claude Design `69342d83` (`Orcamento - BV - Opcoes.dc.html`), lido via MCP `claude_design`. O design cobre três telas: a Entrega 12 fez a de Orçamentos e a 13 fechou a do job. A Entrega 13 traz quatro mudanças do time sobre o design (Confirmar com popup, fornecedor obrigatório, Realizado no lugar da rentabilidade, e BV↔PP alternando por tipo). Modelagem, ciclo de vida da situação e regras de trava saíram de perguntas respondidas durante as sessões, registradas nas seções 13 e 14.

---

## 1. Status

| Entrega | Estado |
|---|---|
| **1 — Destaque da versão mais recente** | ✅ `6738422` |
| **2 — Edição tipo planilha nos itens** | ✅ `cdb2853` |
| **3 — Alinhamento da grade, rentabilidade e card de "Totais"** | ✅ `b2003f7` + `497b8e7` |
| **4 — Recolher grupos, alinhar Totais e densificar a grade** | ✅ `8e0b674` (2026-07-30) |
| **5 — Cadastro de cidades e novos campos do projeto** | ✅ `962be97` (2026-07-30) |
| **6 — Ocultar versões não aprovadas** | ✅ `f2b882a` (2026-07-30) |
| **7 — Responsável de volta ao formulário de projeto** | ✅ `2d34b8b` (2026-07-30) |
| **8 — Abertura de job a partir da versão aprovada** | ✅ `c0dac5e` (2026-07-30) |
| **9 — Revisão do layout de abertura de job** | ✅ `ab66165` (2026-07-31) |
| **10 — Título editável inline + resumo de rentabilidade** | ✅ `75cbb22` (2026-08-03) |
| **11 — Revisão de campos de projeto e orçamento + produto padrão** | ✅ `6e6bd77` + `4a227d7` + `f664e1f` (2026-08-06) |
| **12 — BV por item · parte 1: tela de Orçamentos** | ✅ (2026-08-07) |
| **13 — BV na planilha do job + BV↔PP por tipo** | ✅ (2026-08-07) |
| **14 — Orçamento do projeto e visão agregada editável** | ✅ `2950666` (2026-08-10) |
| **15 — Cores dos blocos e faixa do agrupamento** | ✅ (2026-08-11) |
| **17 — Cidade e Regional editáveis na abertura + modal inteiro visível** | ✅ `40881a7` (2026-08-12) |
| **18 — Funil comercial nas listas, Valor do Job e GPs Responsáveis** | ✅ `d078f8a` + `63c258f` + `9018e3a` (2026-08-17) |
| **19 — Editor multi-jobs: novo no topo, orçado zerado bloqueia, categoria obrigatória** | ✅ (2026-08-17) |
| **20 — Tela da versão: grupo automático na v1, Status fora do drawer, aprovação exige orçado** | ✅ (2026-08-17) |
| **21 — Contato de cobrança na abertura do job + "Descritivo do Job"** | ✅ (2026-08-17) |

`tsc --noEmit` e `next lint` limpos em todas. Entregas 4, 5, 8 a 13
também com `next build` completo. As Entregas 8 e 10 a 13 são as únicas
com verificação de ponta a ponta contra o banco real — ver seções 9, 11,
12, 13 e 14. A Entrega 15 foi verificada no navegador, medindo as
fronteiras das colunas — ver seção 16.3.

---

## 2. Entrega 1 — destaque da versão mais recente

**Arquivo:** [`app/(app)/orcamentos/[id]/versoes/versoes-list.tsx`](app/(app)/orcamentos/[id]/versoes/versoes-list.tsx)
**Commit:** `6738422` — só visual, 1 arquivo, sem imports novos, sem mudança de dados.

A linha de maior `numero_versao` recebe:

- quadrado do número: `bg-california-red text-white shadow-brand` (as outras seguem `bg-california-red/10 text-california-red`)
- nome em `font-semibold` (as outras em `font-medium`)
- `<Badge>Mais recente</Badge>` (variant default = `bg-california-red text-white`)
- ícones Duplicar/Cancelar em `p-2.5` com `h-[18px] w-[18px]`; Abrir em `p-2.5` com `text-foreground` e seta `h-4 w-4`
- container dos ícones continua `flex items-center gap-1` — é o `gap` que iguala a distância entre os três

Verificado no DOM: v5 com os estilos de destaque, v1–v4 idênticas à produção.

---

## 3. Entrega 2 — edição tipo planilha

### Arquivos

| Arquivo | Mudança |
|---|---|
| [`itens-table.tsx`](app/(app)/orcamentos/[id]/versoes/[versaoId]/itens-table.tsx) | reescrita: célula editável, subtotais no `tfoot`, linha nova, trilha de ações |
| [`grupo-card.tsx`](app/(app)/orcamentos/[id]/versoes/[versaoId]/grupo-card.tsx) | subtotal do header removido; card sem `overflow-hidden`; header ganhou `rounded-t-2xl` |
| [`versoes/actions.ts`](app/(app)/orcamentos/[id]/versoes/actions.ts) | nova server action `atualizarCampoItem` |
| [`lib/validations/itens.ts`](lib/validations/itens.ts) | `camposItemEditaveis` + `isCampoItemEditavel` (allowlist) |
| [`[versaoId]/page.tsx`](app/(app)/orcamentos/[id]/versoes/[versaoId]/page.tsx) | `pr-12` na lista de grupos, calha para a trilha |
| `item-editor-drawer.tsx` | **apagado** (422 linhas) — nada mais o importava |

Os cinco primeiros são **um commit só**: a tabela não compila sem a action nem sem o allowlist, e o drawer só sai depois que nada o importa.

### Comportamento

- **Uma célula ativa por vez** (`{rowId, campo}` no estado). Clique transforma a célula em campo `h-7 rounded-lg border-california-red ring-2 ring-california-red/15`, preservando `text-right` e `font-mono` nas numéricas.
- `Enter` confirma · `Esc` desfaz · clicar fora grava. Sem navegação por teclado entre células (fora de escopo, fase 2).
- **Editáveis:** Item (texto), Tipo (select), Categoria (select), e os 6 numéricos — `valor_unitario_orcado`, `quantidade_orcada`, `dias_meses_orcado`, `valor_unitario_planejado`, `quantidade_planejada`, `dias_meses_planejado`.
- **Calculadas (read-only):** Total orçado, Total planejado, Rentab. Recalculam otimisticamente ao digitar, sempre na cor normal (ver decisão 7).
- **Números aceitam vírgula decimal:** `1.234,56` e `1234.56` funcionam (vírgula presente ⇒ ponto é separador de milhar).
- **Selects:** Tipo usa a lista fixa de `tipoCustoLabel`; Categoria lista as da versão com "Nenhuma" no topo, sem atalho de criar categoria. Radix não aceita `value=""`, então "Nenhuma" usa a sentinela `__nenhuma__` mapeada para `null`.
- **Subtotais no `<tfoot>`:** rótulo em `colSpan={3}`, total de Orçado sob a coluna Total (`#f1f0ec`, `border-t-2 border-t-[#282828]`), total de Planejado (`#e8f0fd`, `text-[#1e4fa3]`, `border-t-2 border-t-[#2f6fdb]`), Resultado = orçado − planejado (`emerald-50`, verde/vermelho conforme sinal). Tudo `whitespace-nowrap`.
- **"Novo item":** última linha do `<tfoot>`, **depois** do subtotal (ver decisão 6). Cria uma linha em branco na grade já em edição no campo Item.
- **Rodapé:** faixa `border-t bg-muted/40 px-6 py-3` com "Clique em qualquer célula para editar · Enter confirma · Esc desfaz".

### Decisões do time que divergem do handoff original

O `IMPLEMENTACAO.md` deixava pontos abertos ou conflitava com o mock. Resolvido assim:

1. **Coluna de ações** — o mock tinha 12 colunas, sem ações, o que eliminaria a forma de excluir item. Decisão: manter **só Remover**, posicionado **fora do frame do card**, à direita, alinhado com cada linha. Sem botão Editar.
2. **Altura de linha fixa (36px, `h-9`)** — necessária para a trilha externa alinhar sempre. Nome longo corta com `truncate` + `title` no hover.
3. **"Novo item" sem drawer** — o handoff dizia "usar o trigger do ItemEditorDrawer" *e* "a linha entra em edição". Decisão: **linha em branco na própria grade**, sem drawer. Ela vive no cliente (`draft`) e só vira registro quando a descrição é preenchida, porque o schema exige `item` não vazio. Por isso o drawer inteiro foi apagado.
4. **Subtotal do header do grupo removido** — ficava duplicado com o `tfoot`.
5. **Indicador de célula ativa ("B2 · R$ Unit.") do mock não implementado** — não estava descrito em texto e a numeração de coluna não era definida em lugar nenhum.
6. **"Novo item" fica DEPOIS do subtotal**, como última linha do `<tfoot>`. O `IMPLEMENTACAO.md` §2.2 e o mock pediam "imediatamente acima do subtotal" — o time reviu na tela e preferiu abaixo, para que o subtotal encoste nas linhas que ele soma. Implementado primeiro acima (em `cdb2853`) e movido depois. **Não reverter para cima sem novo aval.** A linha do "Novo item" leva `border-t border-border`: é ela que fecha a base da grade, deixando claro que o subtotal é a última linha da planilha e o botão está fora dela. Resultado: duas hairlines de 1px `#ebebeb` — uma sob o subtotal, outra acima da faixa de legenda.
7. **Totais não piscam mais em vermelho ao gravar.** O handoff pedia `text-california-red` nas colunas calculadas "enquanto não gravadas". Removido: a gravação é rápida, então nunca se lia como aviso — virava um piscar; e vermelho California é a cor de **erro** do sistema, então o efeito comunicava o oposto do que acontecia. O cenário que o vermelho cobria já está protegido: falha reverte o valor e mostra a faixa de erro. Vermelho na tabela hoje só significa rentabilidade/resultado negativo.

### Detalhes técnicos que importam

- **Totais são colunas `GENERATED`** no Postgres (`total_orcado`, `total_planejado`, migrations `20260724000001` e `20260728000001`). A action grava só o campo base; o banco recalcula. Nunca tentar escrever nos totais.
- **`atualizarCampoItem(itemId, campo, valor)`** — o nome do campo chega do cliente, então passa pela allowlist `camposItemEditaveis` antes do UPDATE. Sem isso seria escrita em coluna arbitrária.
- **Otimismo com auto-descarte:** `overrides` guarda o valor otimista por item/campo e um `useEffect` sobre `itens` remove cada override quando o servidor já devolveu o mesmo valor. Evita piscar valor velho e não precisa de flag de "salvando".
- **Trilha de ações:** `absolute left-full ml-2` dentro de um wrapper `relative`, irmão do container de scroll (`overflow-x-auto`) — se ficasse dentro dele, o scroll horizontal cortaria os botões. O `top` vem de medição do `tbody` via `useLayoutEffect` + `ResizeObserver`. Card perdeu `overflow-hidden`, então os cantos são arredondados por filho (`rounded-t-2xl` no header, `rounded-b-2xl` no rodapé).

---

## 3.1 Verificação feita

**Fluxo de categoria (botão "Nova categoria" → dropdown da grade): funciona.** Cadeia provada ponta a ponta:

1. `criarCategoria` insere e faz `revalidatePath`; o drawer faz `router.refresh()` no sucesso.
2. Categoria inserida no banco (201).
3. `ItensTable` recebeu `categorias: ["Logistica (teste)"]` nas props — é o array que monta as opções (`"Nenhuma"` + categorias da versão).
4. A célula renderizou o badge `variant="neutral"` com o nome, e continua clicável.

Dados de teste removidos depois.

**Edição de célula:** valor unitário gravado com vírgula decimal (`1500,50`), total e subtotal recalculados, persistido após reload. Select de Tipo abriu com as 4 opções, gravou "D · Interno" e o card de Totais migrou o valor de B para D. Total confirmado em `rgb(41,41,41)` sem classe vermelha após gravar.

**Linha nova:** um `Enter` insere exatamente 1 linha (estável após reload) — regressão do loop coberta.

**Embed novo da action:** query testada direto no PostgREST, 200 OK com o objeto aninhado.

**Checklist do `docs/PERFORMANCE.md`:** nenhum `<Link>` novo; embed é to-one de 2 campos (não é o anti-padrão de embed pesado); action começa com `requireSession()` e termina com `revalidatePath`; sem migration nova.

### Fragilidades conhecidas (aceitas)

1. **Modo `readOnly` sem teste de execução** — nenhuma versão está `aprovada`/`cancelada` no banco. Revisado estaticamente: trilha, rodapé e "Novo item" escondidos, células sem `onClick`, `tfoot` preserva os subtotais. **Testar quando existir versão aprovada.**
2. **Células não acessíveis por teclado** — `<td onClick>` sem `role`/`tabIndex`. Navegação por teclado está fora de escopo no handoff, mas na prática não há como editar sem mouse. Time decidiu não tratar agora.
3. **`router.refresh()` por célula** — cada `Enter` re-renderiza a página no servidor (necessário: os totais são `GENERATED` e o card de Totais recalcula honorários/impostos). Em digitação rápida, multiplica requests. Mitigação futura se incomodar: debounce ou atualizar só os totais.
4. **`<p>` dentro de `SelectContent`** — a mensagem "Nenhuma categoria criada nesta versão" é um nó não-`SelectItem` dentro do Viewport do Radix. Renderiza bem, mas não é o uso canônico.

### Comportamento revisado e aprovado (não alterar sem novo aval)

- **`Esc` na linha nova com Item vazio** fecha a célula e mantém a linha em branco na grade; descartar é pelo `X` da trilha. Levantado como possível inconsistência com "Esc desfaz" e **validado pelo time como correto** — `Esc` desfaz a edição da célula, não a criação da linha.

---

## 3.2 Entrega 3 — alinhamento da grade, rentabilidade e card de "Totais"

Tudo que foi feito neste ciclo, entre o último pull e o push. Duas frentes que se encaixam: a **grade de itens** ganhou alinhamento entre grupos e a coluna de rentabilidade; o **card de Totais** foi reescrito para espelhar orçado × planejado com a mesma linguagem visual. São o mesmo trabalho — a grade e o card não podem divergir.

**Arquivos:** [`itens-table.tsx`](app/(app)/orcamentos/[id]/versoes/[versaoId]/itens-table.tsx) · [`totais-card.tsx`](app/(app)/orcamentos/[id]/versoes/[versaoId]/totais-card.tsx) · [`[versaoId]/page.tsx`](app/(app)/orcamentos/[id]/versoes/[versaoId]/page.tsx)
**Commits:** `b2003f7` (grade) e `497b8e7` (card de Totais) — sem migration, sem mudança de dados, **sem query nova**.
**Origem do design do card:** `Totais da Versao.dc.html`, opção `5a`, projeto Claude Design `d509845b-dfa3-486b-ab22-c4918e449aee`.

---

### Parte A — grade de itens

#### Problema

Cada grupo renderiza sua própria `<table>`. Em layout automático, as colunas eram medidas pelo conteúdo de cada card — um grupo com item de nome curto (`teste`) gerava coluna ITEM estreita, outro com nome longo (`INFLUENCIADOR INFLIUENCIADO...`) gerava coluna larga, e os blocos ORÇADO / PLANEJADO começavam em posições diferentes entre os cards da mesma versão.

#### Solução

`table-fixed` + `<ColunasFixas />` (um `<colgroup>`) com larguras **em porcentagem**, não em px. Como todos os cards têm a mesma largura, a mesma proporção alinha todos os grupos — em qualquer versão — e a grade acompanha o container em vez de estourar.

- `LARGURA_MINIMA` (`min-w-[1060px]`) é o piso: abaixo disso o card rola na horizontal em vez de espremer as colunas de moeda.
- **Larguras em px foram tentadas primeiro e estouraram a largura do card**, empurrando o bloco de rentabilidade para fora da área visível. Não voltar para px.
- O teto de `max-w-[240px]` na coluna Item saiu — com a coluna já dimensionada pelo `colgroup`, ele só desperdiçava espaço.

Verificado por medição no DOM: nos 9 grupos da versão importada, as bordas dos três blocos ficam todas na mesma posição (`263 | 583 | 891 | 1200` a 1600px de viewport), sem scroll horizontal. A 1024px o piso entra e os 9 grupos rolam juntos, mantendo o alinhamento relativo.

#### Rentabilidade

O bloco `RESULTADO` (1 coluna) virou `RENTABILIDADE` (2 sub-colunas): `R$` e `%`. O percentual é sobre o **orçado** (`rentabilidade / orçado`).

- O cálculo **reusa `calcularTotaisPlanejados`** de [`versao-totais.ts`](lib/calculos/versao-totais.ts), via o helper local `rentabilidadeDe(orcado, planejado)` — mesma fórmula e mesma semântica de travessão do card de Totais. Uma primeira versão duplicou a regra localmente; foi trocada de propósito. **Não reintroduzir o cálculo inline** — a grade e o card de Totais não podem divergir.
- `CelulasRentabilidade` é compartilhado entre a linha existente e a linha nova (draft), que por isso não saem de sincronia.
- `colSpan` do estado vazio e do rodapé "Novo item" passaram de 12 para 13.

#### Decisão de layout (não alterar sem novo aval)

O pedido foi *"uma nova linha dentro dela com a % da rentabilidade"*. Implementado como **sub-coluna**, não como segunda linha de texto dentro da célula.

Motivo técnico, além do visual: a altura fixa de linha (`ALTURA_LINHA = h-9`, decisão 2 da Entrega 2) é o que mantém a trilha de lixeiras — que vive **fora** do frame do card — alinhada com cada linha. Empilhar duas linhas dentro da célula quebraria esse alinhamento em toda a grade.

---

### Parte B — card "Totais"

#### O que mudou

O card tinha duas colunas: subtotais por tipo de custo e composição da fatura. Passou a ter **três camadas de leitura**:

| Camada | Conteúdo |
|---|---|
| 1 — Tabela de agrupamentos | Uma linha por grupo com Orçado, Planejado, Rentab. R$ e %, fechando em "Total dos custos" |
| 2 — Fechamento do orçado | A/B/C/D → total dos custos → honorários → impostos → faturamento previsto |
| 3 — Resultado | Faturamento − impostos − custo planejado = resultado operacional; bloco "Composto por" (honorários + rentabilidade); resultado geral = operacional ÷ faturamento, em destaque |

As fórmulas de honorários, imposto (gross-up) e faturamento não mudaram — continuam vindo de `calcularTotaisVersao`. O que a Entrega 4 acrescenta é a leitura por agrupamento e o fechamento em resultado.

#### Decisões que divergem do mock (não alterar sem novo aval)

1. **Sem planejado lançado, resultado operacional e resultado geral mostram travessão.** O mock assume planejado preenchido. Seguir o mock ao pé da letra daria `faturamento − impostos − 0`, que numa versão recém-criada lê como lucro de ~84% — número inflado que não existe. O `%` por grupo segue a convenção que a grade já usava: `—` quando o grupo não tem planejado.
2. **No bloco "Composto por", os dois valores ficam em preto** (pedido do time, 28/07): as duas parcelas do resultado operacional se leem juntas. Prejuízo (`rentabilidade < 0`) continua em `text-california-red` — preto sempre esconderia perda.
3. **A linha de honorários exibe a taxa configurada da versão** (`percentual_honorarios`), no mesmo formato da rentabilidade: `R$ 520,00 · 13,0%`. É a mesma taxa que aparece em "Honorários (13%)" na coluna da esquerda — **não** é honorários ÷ faturamento.

#### Detalhes técnicos que importam

- **As bandas de cor são as mesmas da grade de itens** (`#f1f0ec`/`#282828` no orçado, `#e8f0fd`/`#2f6fdb` no planejado, emerald na rentabilidade). É o ponto do design: a vista de Totais tem que "rimar" com a tela de edição. Mexeu na cor de um, mexa no outro.
- **`agruparPorGrupo` monta um `Map` numa passada só** pelos itens, em vez de um `filter` por grupo — a lista pode ter centenas de linhas (ver seção 4: uma versão chegou a 5.887).
- O cálculo de rentabilidade por grupo **reusa `calcularTotaisPlanejados`** de [`versao-totais.ts`](lib/calculos/versao-totais.ts), o mesmo helper da grade. Card, grade e export não podem divergir.

#### Verificação feita

Medido no DOM com dados reais do ORC-0001 (3 grupos, honorários 12%, imposto 19,54%):

- honorários `112.050 × 12% = R$ 13.446,00` (C e D zerados) · imposto gross-up `R$ 11.048,87` · faturamento `R$ 136.544,87`
- resultado operacional `136.544,87 − 11.048,87 − 104.600 = R$ 20.896,00`, que fecha com honorários + rentabilidade (`13.446 + 7.450`)
- resultado geral `20.896 ÷ 136.544,87 = 15,3%`

Cores computadas conferidas contra o spec do design: `#f1f0ec`, `#e8f0fd`/`#1e4fa3`, `#ecfdf5`/`#047857`/`#a7f3d0`. Após o pedido de preto no "Composto por", as duas linhas voltaram medidas em `rgb(41,41,41)`.

`tsc --noEmit` e `next lint` limpos — inclusive depois de integrar a Fase G' do Antonio (catálogo global de categorias), que mexeu no mesmo `page.tsx`.

**Sem screenshot:** a aba do preview ficou com `visibilityState: hidden` na sessão e as capturas saíam em branco. A verificação foi por DOM e computed styles.

---

## 4. Incidente: 5.887 itens de lixo em produção

**O que aconteceu.** Durante a verificação da linha "Novo item", `persistirDraft` era chamada **dentro do updater do `setDraft`** — setState durante render. O React reexecuta o updater, e cada reexecução disparava outro `adicionarItem`. O loop inseriu **5.887** itens `Diretor de arte` no grupo Equipe da v5 do ORC-0001, no Supabase de produção.

**Por que passou desapercebido no começo.** A tela mostrava "1000 itens" porque o PostgREST limita a listagem a 1000 linhas. O volume real só apareceu contando com `Prefer: count=exact` e lendo o header `content-range`.

**Correção.** Chamada movida para fora do updater + trava de reentrância (`persistindoRef`). Validado: um `Enter` insere exatamente 1 linha, estável após reload.

**Limpeza.** Feita via API REST com a `SUPABASE_SERVICE_ROLE_KEY`, com dry-run, filtro exato (`versao_orcamento_id` + descrição) e teto de segurança. Resultado conferido: 0 ocorrências das descrições no banco inteiro, contagem por versão de volta ao original (v1: 0 · v2: 2 · v3: 44 · v4: 44 · v5: 2), e o item `teste` revertido para `B` / R$ 1.221,00.

**Lição que vale para o projeto.** `.env.local` aponta para o Supabase **de produção** (`avlwxyknvhlzvnysbzrg`); não existe stack local. Rodar `next dev` já é mexer no banco real. Qualquer teste de **escrita** — criar, editar, remover — grava em produção. Vale abrir um projeto Supabase separado para desenvolvimento; as migrations em `supabase/migrations/` recriam o schema inteiro.

---

## 5. Entrega 4 — recolher grupos, alinhar Totais, densificar a grade

**2026-07-30** · commit `8e0b674` · design `Orcamento - Versao -final-.dc.html`.

- Recolher/expandir por grupo: chevron no header + badge "N itens ocultos". Recolhido esconde linhas, "Novo item" e trilha de ações; **subtotal e cabeçalho de colunas continuam visíveis**.
- Botão global "Recolher todos"/"Expandir todos" à esquerda, abaixo da contagem de grupos (o design o punha ao lado de "Novo grupo" — posição mudada a pedido do time).
- Rótulo segue "tem algum aberto?" — o design tem um grupo só e não resolvia estado misto. Sem persistência: recarregar volta tudo a aberto.
- Estado guarda quem está **fechado**, não quem está aberto — grupo novo nasce aberto sem precisar de sincronização quando a lista muda.
- `ColunasFixas` + `LARGURA_MINIMA` extraídos para `grade-colunas.tsx`, **sem `"use client"`**: a tabela de itens é client e o card de Totais é server.
- Card de Totais passa de 5 para as mesmas 13 colunas da grade e entra na calha `pr-12` junto com os grupos — sem isso fica 48px mais largo e as colunas não alinham, mesmo com `colgroup` igual.
- Altura da linha 36px → 28px (`h-7`). O design pedia 25px; 28 é o menor valor que comporta o botão da trilha (26px) e mantém o alvo de clique acima do mínimo de 24px da WCAG 2.5.8. Campo inline 28 → 26px.
- Subtotal do grupo `py-3` → `py-1.5` (46px → 34px).
- Badge de Tipo não é mais cortado: célula 12 → 8px, badge 10 → 6px. `CelulaSelect` aplica `px-3` **antes** de `tdClassName` — com `tailwind-merge` a última classe vence.
- Planejado espelha o Orçado: linha nova nasce `0,00 · 1 · 1` e zero exibe `R$ 0,00` em vez de travessão em todas as linhas, senão o campo mudaria de cara ao ser salvo. `vazioComoTraco` removida (ficou sem chamador). Efeito colateral aceito: itens antigos sem planejamento perdem o sinal de "ainda não planejado".
- Divergência do design: a dica "Clique em qualquer célula" some com o grupo recolhido — ali apontaria para uma grade ausente.

---

## 6. Entrega 5 — cadastro de cidades e novos campos do projeto

**2026-07-30** · commit `962be97` · design `Novo projeto.dc.html` · migration `20260730000003_cidades_e_campos_projeto.sql`.

- Nova tabela `cidades` no mesmo padrão de `regionais`: RLS por `is_tenant_member`, grants para `authenticated`, único `(tenant_id, lower(nome))`, trigger de `updated_at`, sem DELETE (soft-delete via `ativo`). CRUD em `/cadastros/cidades`.
- Seed só com Salvador e São Paulo — carga completa fica para task futura.
- `projetos` ganha `regional_id`, `cidade_id`, `data_fim_prevista`, `descricao`, mais índices nas FKs e CHECKs de `data_fim >= data_inicio` e `descricao <= 600`.
- **Colunas nullable de propósito:** já existem projetos gravados e um NOT NULL exigiria backfill. A obrigatoriedade (Regional, Cidade, Final previsto, Categoria) vive só no Zod.
- Em `jobs` cidade é texto livre; no projeto virou FK — padronizar o dado antes de a base crescer. `regional_id` e `data_fim_prevista` já existiam em `jobs` e agora sobem para o projeto.
- Formulário: Nome em linha inteira; Cliente/Regional, Cidade/Categoria e Início/Final em duas colunas; Descrição opcional com contador que só aparece ao digitar. Categoria perde a opção "Sem categoria".
- **Campanha** sai da tela; coluna e dados preservados (a busca da lista ainda casa por campanha).
- **Responsável** sai da tela e passa a ser o usuário logado; rótulo vira "Criado por" na lista, no detalhe e no filtro. A coluna continua `responsavel_id` — renomear colidiria com o `created_by` existente. `profiles.id` **é** o id do `auth.users`, então o mesmo valor serve às duas.
- ⚠️ **`campanha` seria zerada em toda edição.** Campo opcional no Zod não basta: o `transform` devolve `null` para entrada ausente, então a chave entra no `UPDATE`. `atualizarProjeto` remove a chave quando o form não a envia. Vale para qualquer campo que saia de um form compartilhado entre criar e editar.
- ⚠️ **Select do Radix monta um `<select required>` nativo escondido** — o navegador barra o envio com "Please select an item in the list." antes das mensagens do Zod chegarem. Sem `required` nos Selects, a validação do servidor chega à tela em português; Zod e CHECKs continuam garantindo a regra.
- Migration aplicada via Supabase Management API com o PAT do `mcp.json`.

---

## 7. Entrega 6 — ocultar versões não aprovadas

**2026-07-30** · commit `f2b882a` · pedido direto do time, sem handoff de design.

**Arquivo:** [`versoes-list.tsx`](app/(app)/orcamentos/[projetoId]/[orcId]/versoes/versoes-list.tsx) — só visual, 1 arquivo, sem mudança de dados.

- Com uma versão aprovada, as demais viram histórico: a lista mostra só a aprovada e um botão discreto no rodapé revela as outras sob demanda.
- **O gatilho é existir versão com status `aprovada` na lista**, não o status do orçamento — decisão do time. Assim que qualquer versão é aprovada, as demais somem.
- Botão só aparece quando há aprovada **e** há o que esconder. Colapsado lê "Mostrar as outras N versões"; expandido, "Ocultar as outras versões".
- **Sem persistência:** o estado é só da sessão do componente. Recarregar volta a ocultar — decisão do time, para toda visita começar limpa.
- O badge "Mais recente" segue calculado sobre **todas** as versões, não só as visíveis. Se alguém criar uma v6 depois de aprovar a v5, o estado colapsado mostra a v5 **sem** o badge, sinalizando que existe algo mais novo escondido.
- Sem versão aprovada nada muda: a lista se comporta como antes e o botão não aparece.

---

## 8. Entrega 7 — Responsável de volta ao formulário de projeto

**2026-07-30** · commit `2d34b8b` · **reverte parcialmente a Entrega 5**.

- A Entrega 5 tirou o campo da tela e passou a preenchê-lo com o usuário logado, exibindo-o como "Criado por". Revertido: quem responde pelo projeto nem sempre é quem o cadastrou, e `created_by` já registra o criador.
- Select "Responsável" volta **ao lado de "Nome do projeto"**, que deixa de ocupar a linha inteira e passa a meia largura.
- `responsavel_id` volta ao `projetoSchema` como uuid obrigatório e ao `extractInput`. `criarProjeto` para de sobrescrever com `session.profile.id`. `atualizarProjeto` **agora grava alterações do campo** — antes ele nem chegava ao payload.
- Rótulos revertidos nos três lugares: coluna "Criado por" → "Responsável", filtro "Todos os criadores" → "Todos responsáveis", detalhe do projeto "Criado por:" → "Responsável:".
- ⚠️ **Não houve renomeação no banco em nenhum momento.** A coluna sempre foi `projetos.responsavel_id` — a Entrega 5 mudou apenas rótulos de UI. A premissa inicial de que o Supabase teria renomeado o campo para "Criado por" estava incorreta.

---

## 9. Entrega 8 — abertura de job a partir da versão aprovada

**2026-07-30** · commit `c0dac5e` · design `Abertura de Job.dc.html` · migration `20260730000004_produtos_cliente_e_faturamento_job.sql`.

Aprovar versão e abrir job passam a viver na tela da **versão**, num fluxo de três pop-ups: confirmar aprovação → formulário do job → confirmar envio.

### Banco

- **`cliente_produtos`** no padrão de `regionais`/`cidades` (RLS por `is_tenant_member`, grants para `authenticated`, soft-delete via `ativo`, sem DELETE), com uma diferença: **o escopo é o CLIENTE, não o tenant**. Cada cliente tem sua lista, gerenciada dentro da tela dele. Únicos por `(cliente_id, lower(nome))` e `(cliente_id, codigo)`.
- Código `PRD-NN` é sequencial **por cliente** e gerado na action, não no banco: a numeração é cosmética e um trigger de sequência por cliente custaria mais do que entrega. O unique index captura corrida.
- **`jobs.data_prevista_faturamento`** nullable de propósito — já existem jobs gravados e um NOT NULL exigiria backfill. A obrigatoriedade vive no Zod.

### Interface

- `<FluxoAbertura>` orquestra a barra `sticky bottom-0` com 3 estados (rascunho / aprovada / enviada) e os três pop-ups.
- `<BannersEstado>` fica **fora** dele: os banners vão entre o cabeçalho e os totais, e o `sticky bottom-0` exige ser o último filho da página. Foi corrigido na verificação — a primeira versão renderizava os banners abaixo do card de Totais.
- Barra afinada a pedido do time depois da entrega: `py-4` → `py-2`, botões de `px-5 py-3`/14px-bold para `px-4 py-2`/13px-semibold. Altura 67px → **53px**, botão 48px → 36px. As duas linhas de texto somam 34px, então 53px é praticamente o piso sem cortar informação do design.
- **Cidade usa busca server-side** (`ilike` + limit 30), não filtro no cliente: o cadastro foi desenhado para receber a lista completa do IBGE. Formato combinado com o time: **`Salvador-BA` num campo só**, sem coluna `uf` — assim o índice único `(tenant_id, lower(nome))` continua valendo mesmo com nomes repetidos entre estados, e a carga futura é só um INSERT.
- Card "Produtos" em `/clientes/[id]`, abaixo do formulário, no padrão de Cadastros › Regionais.
- "Aprovar versão" saiu do cabeçalho e vive na barra; `<AprovacaoActions>` ficou só com "Cancelar aprovação".

### Regras que não dependem do frontend

- **`valor_total` é recalculado** dos itens da versão via `calcularTotaisVersao`, nunca vem do formulário.
- **Produto e cidade são revalidados** contra o cliente e o tenant — não basta serem uuid válido.
- **Hierarquia decidida no servidor, sem seletor na tela:** primeiro job do projeto vira principal, os seguintes viram sub-job dele. Decisão do time — o projeto é o guarda-chuva e cada orçamento aprovado abre um job debaixo dele. Trocar o principal continua na tela do job.
- Nome e datas informados no modal são gravados **também no orçamento**, como o modal avisa.

### Remoções

- `<CriarJobDrawer>` da tela do orçamento foi removido — caminho único agora é pela versão. A tela perdeu 2 queries (`regionais` e `listActiveMembers`) que só ele usava.
- ⚠️ **`criarJob` ficou órfã** em `app/(app)/jobs/actions.ts`. Server action exportada continua sendo endpoint chamável mesmo sem UI, e ela permite criar job pulando produto e data de faturamento. Não é buraco de segurança (valida sessão, tenant e orçamento aprovado), mas é de qualidade de dado. Remoção em task própria, depois do fluxo validado.
- `ConfirmDialog` ganha `pr-6` no título: sem isso, título longo passa por baixo do botão de fechar, que é absoluto no canto. Afeta todos os diálogos do sistema.

### Verificação de ponta a ponta (2026-07-30)

Única entrega com prova contra o banco real, não só build limpo:

| Etapa | Resultado |
|---|---|
| Migration | `cliente_produtos` com 9 colunas, 3 policies, 6 índices; INSERT liberado para `authenticated` |
| Advisors de segurança | 10 avisos, **todos pré-existentes** — nenhum da tabela nova |
| Cadastro de produto | `PRD-01 · Ativação de marca` |
| Aprovar versão | v1 → `aprovada`, barra troca de estado |
| Busca de cidade | "salv" → Salvador, vindo do servidor |
| Envio | **JOB-0003**, orçamento → `job_criado` |
| `valor_total` | R$ 25.503,36, igual ao faturamento previsto |
| `job_pai_id` | preenchido — nasceu como sub-job do JOB-0001 |
| Auditoria | `job.enviado_para_abertura` com `valor_total`, `versao_id` e `job_pai_id` |
| Fila do financeiro | JOB-0003 listado com Aprovar/Rejeitar |

⚠️ O job gravou `Salvador`, não `Salvador-BA` — é o que está no cadastro hoje. Reconciliar quando a lista do IBGE for carregada.

### Nota de infraestrutura

O MCP do Supabase não carregava porque o arquivo na raiz se chamava `mcp.json`; o Claude Code lê `.mcp.json`, **com ponto**. Renomeado nesta sessão. O `.gitignore` já cobria os dois nomes, então o token nunca esteve versionado por esse caminho.

---

## 10. Entrega 9 — revisão do layout de abertura de job

**2026-07-31** · commit `ab66165` · design `Abertura de Job.dc.html` (relido após atualização) · migration `20260731000001_job_observacoes.sql`.

Revisão do fluxo entregue na Entrega 8. Três frentes: layout do formulário, campo novo de Observações e preservação do preenchimento.

### Formulário em 3 colunas

- Linha de identificação nova, toda travada: **Projeto**, **Código do projeto**, **Código do job**.
- Nome do Job ocupa 2 colunas ao lado de Cliente; depois Produto/Cidade/Regional, as três datas, e Responsável ao lado do box de Valor total.
- Textos de apoio encurtados. O aviso sob as datas (*"Alteração é replicada no orçamento"*) saiu — a informação já vive no subtítulo do cabeçalho, e o design a removeu.
- Diálogo em `sm:max-w-5xl`. ⚠️ A regra de larguras de `docs/09-identidade-visual-ui.md` **proíbe** `max-w-5xl`, mas ela vale para container de **página**; um modal não é página. Registrado aqui para não virar discussão depois.
- Helper `<Campo>` interno (rótulo + campo + linha de apoio que vira mensagem de erro) — evita repetir a mesma estrutura 12 vezes.

### Campo Observações (novo)

- Coluna `jobs.observacoes` com CHECK de **500**, alinhado ao contador `contadorObsFixo` do handoff e ao `OBSERVACOES_MAX` do Zod. Nasceu com 1000 e foi corrigido para 500 na mesma sessão (migration `job_observacoes_limite_500` no remoto; o arquivo versionado já nasce com 500).
- ⚠️ **Grava mas ainda NÃO é exibido em lugar nenhum.** Decisão do time em 31/07/2026: a leitura entra quando a tela de abertura do financeiro for refinada. Há comentário na action registrando isso — não é bug.
- Não é editável depois da abertura, também por decisão do time.

### Confirmação de envio vira componente próprio

- `<ConfirmarEnvioModal>` substitui o `ConfirmDialog` genérico: o handoff pede ícone de envio em círculo vermelho, botão de confirmar vermelho com check e card de resumo. O componente compartilhado não faz essa combinação sem virar canivete de props.
- Linha **Projeto** nova no resumo (`nome · código`).
- Observações aparecem **para conferência, travadas** — o pop-up não edita nada. Verificado no DOM: zero `input`/`textarea` dentro do diálogo. Vazio mostra travessão, contador em `0/500`.
- ⚠️ Divergência deliberada do design: o texto de apoio *"Ainda dá para completar — o texto é salvo junto com o envio."* virou *"Para alterar, use 'Voltar e revisar'."*. A frase original ficou falsa quando o campo travou. Aprovado pelo time.

### "Voltar e revisar" preserva o formulário

- O estado do formulário subiu para `<FluxoAbertura>`; `<EnviarJobModal>` virou controlado.
- **A causa do bug:** o `useEffect` do modal resetava tudo a cada `open`, e voltar da confirmação disparava `open` de novo. Reabrir agora só limpa o realce de "faltou preencher".
- Fechar de vez (Cancelar / X / Esc) continua limpando — desistir tem que ser previsível.
- Verificado nos dois sentidos: texto escrito no formulário aparece na confirmação, e o preenchimento sobrevive ao "Voltar e revisar".

### Nota de integração

O commit remoto `0c8c474` (TruncateTooltip) tocou `enviar-job-modal.tsx` em paralelo à reescrita. O rebase juntou os dois: o `TruncateTooltip` sobreviveu dentro do componente `Travado` novo. `tsc`, lint e build revalidados **depois** do rebase, não antes.

---

## 11. Entrega 10 — título editável inline e resumo de rentabilidade

**2026-08-03** · commit `75cbb22` · slide "Título do Orçamento" (dois pedidos anotados sobre print da tela da versão) · sem migration.

Tela alvo: `/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]`.

### Pedido 1 — clicar no nome e editar ali mesmo

**Arquivo novo:** [`versao-titulo-inline.tsx`](app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/versao-titulo-inline.tsx)

- O `<h1>` virou botão: clique abre o campo no lugar. Lápis aparece no hover, ✓ salva, ✕ e `Esc` cancelam. O `<h1>` continua envolvendo o botão — a heading não sai da árvore de acessibilidade.
- **Não criou server action nova.** Reaproveita `atualizarVersao` com um `FormData` que leva só `nome`: o `extractVersaoPartial` já preserva os campos ausentes. Auditoria (`versao_orcamento.editada`) e os dois `revalidatePath` continuam idênticos ao caminho do drawer.
- Nome vazio grava `null` e o título cai no fallback `Versão N` — comportamento que já existia no drawer, não é regressão.
- **O botão "Editar" fica.** O pedido dizia "ao invés de editar", mas o drawer é o único caminho para moeda, câmbio, honorários, impostos e status. Decisão confirmada com o time antes de codar.
- Versão **aprovada** não abre o campo: renderiza texto puro com o mesmo `title` de motivo do botão "Editar". A action já barrava no servidor — a UI só deixou de oferecer.
- ⚠️ **O campo se dimensiona pelo texto** (span medidor invisível dividindo a célula do grid + `size={1}` + `min-w-0` no input). Não troque por largura fixa: com `w-[30rem]` o input empurrava o resumo de rentabilidade para a linha de baixo só por entrar em modo de edição. O `size={1}` é o que impede o input de ditar a largura da coluna do grid — sem ele o medidor não tem efeito.

### Pedido 2 — resumo de receita × custos ao lado do título

**Arquivo novo:** [`resumo-rentabilidade.tsx`](app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/resumo-rentabilidade.tsx) (server component, sem estado)

Três números ancorados à direita do título: **Faturamento previsto · Custo planejado · Resultado geral (%)**.

- "Custos" = **planejado**, escolha do time. Vale registrar o porquê: com custo **orçado**, `faturamento − impostos − custos` dá exatamente os honorários, então a rentabilidade não seria informação nova. É a mesma razão pela qual o card de Totais já calculava o resultado sobre o planejado.
- Sem planejado lançado: travessão + legenda "sem planejado". Mesma regra do card de Totais, que se recusa a transformar faturamento inteiro em lucro.
- Faturamento em preto (`text-foreground`) e não em vermelho — ajuste pedido pelo time depois da primeira versão. Só o resultado geral tem cor semântica (verde/vermelho pelo sinal).
- **Não é sticky**, por decisão do time: rola junto com o cabeçalho.

### Fonte única do cálculo

`calcularResultadoOperacional(faturamento, imposto, custoPlanejado)` entrou em [`lib/calculos/versao-totais.ts`](lib/calculos/versao-totais.ts) e o card de Totais passou a consumi-la no lugar do cálculo inline. Duas telas mostrando o mesmo resultado por fórmulas duplicadas é divergência esperando para acontecer. Retorna `null` nos dois campos quando `custoPlanejado <= 0`.

### Layout do cabeçalho

O grupo do título virou `flex-1 min-w-0` e o resumo ficou ancorado à direita. Quem cede espaço para nome longo é o grupo do título, que quebra dentro da própria coluna — sem isso, um nome comprido derrubava o resumo para a linha de baixo.

### Verificação (2026-08-03)

`tsc --noEmit`, `next lint` e `rm -rf .next && npm run build` limpos (o único warning de lint é o pré-existente de `combobox.tsx`). No navegador, contra o banco real:

- **Números batem com o card de Totais** na mesma tela: R$ 18.514,73 / R$ 12.000,00 / 19,9%.
- **Rascunho:** título renomeado de ponta a ponta (persistiu no banco, `router.refresh()` propagou) e restaurado ao nome original.
- **Aprovada:** título é texto puro, sem botão.
- **Sem planejado:** versão v3 "TESTE IMPORTAÇÃO PLANILHA" (44 itens, planejado zerado) mostra travessão e "sem planejado".
- Sem erros de console. Conferido também a 768px de largura: resumo se mantém à direita, título e botões quebram embaixo.

⚠️ Como toda sessão deste projeto, o `next dev` escreveu **direto em produção** (ver item 5 dos próximos passos). O rename de teste foi feito na versão v1 do projeto TESTE-0001/26-01 e desfeito na sequência.

---

## 12. Entrega 11 — revisão de campos de projeto e orçamento + produto padrão

**2026-08-06** · commits `6e6bd77` (campos), `4a227d7` (produto na criação do cliente) e `f664e1f` (produto padrão protegido) · pedido direto do time sobre prints das telas · 7 migrations.

Duas frentes na mesma sessão. A primeira reorganiza o que cada nível
guarda: o **projeto** virou o guarda-chuva da iniciativa (produto, várias
regionais, vários responsáveis) e o **orçamento** passou a carregar a
praça e os responsáveis da peça (regional, cidade, GP, produtor). A
segunda garante que todo cliente tenha um produto — sem isso a primeira
frente trancaria a criação de projeto.

### 12.1 Migrations

| Arquivo | O que faz |
|---|---|
| `20260806000001_projeto_multi_regional_responsavel_produto.sql` | `projeto_regionais` e `projeto_responsaveis` (N:N, RLS, backfill) + `projetos.produto_id` |
| `20260806000002_orcamento_regional_cidade_responsaveis.sql` | `orcamentos.regional_id/cidade_id/gp_responsavel_id/produtor_id` + `jobs.produtor_id` |
| `20260806000003_categorias_dominio_servico_e_orcamento.sql` | remapeia e **apaga** as categorias que saíram |
| `20260806000004_produto_padrao_por_cliente.sql` | produto homônimo para cliente sem nenhum produto |
| `20260806000005_produto_padrao_protegido.sql` | `cliente_produtos.padrao` + backfill universal + trigger de proteção |
| `20260806000006_backfill_produto_nos_projetos.sql` | projetos antigos recebem o produto padrão do seu cliente |

**As colunas `projetos.regional_id` e `projetos.responsavel_id` continuam
existindo e são gravadas com o primeiro item de cada lista.**
`responsavel_id` é `NOT NULL` e tem leitores fora deste fluxo — derrubar
a coluna era mudança maior do que a entrega pedia. A fonte-verdade da UI
são as tabelas de vínculo; as colunas são compatibilidade, e os
`comment on column` no banco dizem isso.

`projetos.cidade_id` virou legado: saiu do formulário (Cidade desceu para
o orçamento) mas a coluna e os dados gravados continuam.

### 12.2 Lista de Projetos & Orçamentos

**Arquivos:** [`page.tsx`](app/(app)/orcamentos/page.tsx) · [`projetos-list.tsx`](app/(app)/orcamentos/projetos-list.tsx)

- Filtros passaram a ser **Clientes · Produto · Regional · Ano · Status**. Saíram Responsáveis e Empresas — e com eles as chamadas `listActiveMembers`/`listEmpresasAtivas` da página.
- Colunas: saíram **Empresa** e **Responsável**, entraram **Produto** e **Regional**. "Categoria" virou **Serviço**.
- **As opções de Produto, Regional e Ano saem dos próprios projetos carregados**, num `useMemo`, não de query nova. O dropdown só oferece o que de fato filtra alguma linha e a página não paga ida extra ao banco.
- **Ano = ano de `data_inicio_prevista`** — o mesmo que numera o código do projeto.
- Regionais do projeto vêm em **query própria** (`projeto_regionais` com embed de `regionais`), dentro do mesmo `Promise.all` da contagem de orçamentos. Embed na listagem devolveria a linha do projeto repetida por regional.
- Na coluna Regional, a primeira aparece inteira e as demais viram `+N` com `title` completo — coluna com 3 regionais estourava a linha.

### 12.3 Formulário de projeto

**Arquivos:** [`projeto-form.tsx`](app/(app)/orcamentos/projeto-form.tsx) · [`actions.ts`](app/(app)/orcamentos/actions.ts) · [`multi-select.tsx`](components/ui/multi-select.tsx) (novo)

- **Cidade saiu**, **Produto entrou** (obrigatório), **Regional e Responsável viraram múltiplos**, **Categoria virou Serviço**.
- Serviço agora oferece **Ativação · Always On · Fee · Interno**.
- O `MultiSelect` novo segue o visual do `Combobox` que já existia: chips removíveis dentro do gatilho, busca só quando passa de 8 opções. **A ordem de seleção importa** — o primeiro item alimenta as colunas de compatibilidade.
- O formulário posta `responsavel_ids`/`regional_ids` como chave repetida e a action lê com `getAll`, que preserva a ordem.
- **A lista de produtos chega inteira e é filtrada no cliente** conforme o cliente escolhido. `cliente_produtos` é cadastro pequeno; um round-trip a cada troca de cliente não se pagaria. Trocar de cliente zera o produto selecionado.
- A action confere **no servidor** que o produto pertence ao cliente e que as regionais existem e estão ativas — a FK só garante que o id existe em `cliente_produtos`/`regionais`, não a que cliente pertence.
- `sincronizarVinculos` apaga e reinsere os vínculos. O conjunto é pequeno; um diff não pagaria a complexidade.

### 12.4 Orçamentos do projeto

**Arquivos:** [`orcamentos-list.tsx`](app/(app)/orcamentos/[projetoId]/orcamentos-list.tsx) · [`orcamento-form.tsx`](app/(app)/orcamentos/[projetoId]/orcamento-form.tsx) · [`actions.ts`](app/(app)/orcamentos/[projetoId]/actions.ts)

- Tabela ganhou **Início previsto**, antes de Fim previsto.
- Formulário ganhou **Regional · Cidade · GP Responsável · Produtor Responsável**, os quatro obrigatórios (no Zod; nullable no banco por causa dos 9 orçamentos que já existiam).
- **Regional oferece só as regionais do projeto. GP oferece só os responsáveis do projeto.** Produtor oferece todos os membros ativos — decisão do time: enquanto o papel de produção não estiver modelado, não dá para restringir.
- `assertRegionalEGpDoProjeto` refaz essa checagem **no servidor**. O formulário já mostra só o permitido, mas quem posta o form pode mandar outra coisa, e a FK não cobre o vínculo com o projeto.
- Categoria do orçamento agora oferece **Ativação · Extra · Influencer · Conteúdo**.

### 12.5 Categorias: por que apagar e não inativar

O time pediu **exclusão**, não soft-delete. As FKs são `on delete restrict`,
então a migration remapeia antes de apagar, no de-para que o time definiu:

| Escopo | Saiu | Virou |
|---|---|---|
| projeto | Evento (1 projeto) | Ativação |
| orçamento | Always On (2 orçamentos) | Ativação |
| orçamento | Evento (2 orçamentos) | Ativação |

Campanha, Projeto proprietário e Mídia saíram sem uso. Se sobrar alguma
referência não prevista, o `restrict` faz o DELETE falhar e a migration
para — melhor do que apagar às cegas.

⚠️ **"Always On" saiu do escopo orçamento e entrou no escopo projeto.**
São linhas diferentes (a unicidade é por tenant + escopo + nome), não há
movimentação de registro entre escopos.

### 12.6 Abertura de job: os campos herdados

**Arquivos:** [`enviar-job-modal.tsx`](app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/enviar-job-modal.tsx) · [`abertura-actions.ts`](app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/abertura-actions.ts) · [`fluxo-abertura.tsx`](app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/fluxo-abertura.tsx)

Produto, Cidade, Regional, GP e Produtor **deixaram de ser campos do modal**
e viraram `<Travado>`. Restam editáveis: nome, as três datas e observações.

⚠️ **O servidor relê esses cinco valores do projeto e do orçamento — não
os aceita do formulário.** Eles saíram do `aberturaJobSchema` e do
`FormData`. Campo travado no HTML não é garantia; a fonte é o banco.

- `jobs.responsavel_id` passou a vir do **GP do orçamento**. Antes vinha de `projetos.responsavel_id`, que agora é só compatibilidade.
- `jobs.produtor_id` nasceu nesta entrega.
- Se algum dos cinco estiver faltando (orçamento anterior a esta entrega), o modal mostra aviso âmbar listando o que falta e trava o botão; a action devolve a mesma lista. **Não inventamos valor padrão** — abrir job com dado faltando é o tipo de furo que aparece meses depois no financeiro.
- `dados.cidade`/`produtoId`/`regionalId` saíram de `DadosJob` e viraram `HerdadosJob`, que o modal só exibe. Com job já aberto valem os valores congelados nele; antes disso, o que está cadastrado hoje.
- Efeito colateral: `cidade-combobox.tsx` e a action `buscarCidades` ficaram sem uso. **Não foram apagados** — quando a carga do IBGE entrar (próximos passos, item 1), o `Select` simples de Cidade do formulário de orçamento precisa virar esse combobox com busca no servidor.

⚠️ **12/08/2026 — desta lista de cinco, dois voltaram a ser editáveis.**
Cidade e Regional saíram de `HerdadosJob` e viraram campos do formulário
de novo; `cidade-combobox.tsx` e `buscarCidades` deixaram de ser órfãos.
Herdados travados hoje são **três**: produto, GP e produtor. Ver a
Entrega 17 (seção 18) e
[`docs/decisions/005-cidade-e-regional-na-abertura.md`](docs/decisions/005-cidade-e-regional-na-abertura.md).

### 12.7 Produto padrão — a marca do cliente

**Arquivos:** [`clientes/actions.ts`](app/(app)/clientes/actions.ts) · [`produtos-actions.ts`](app/(app)/clientes/[id]/produtos-actions.ts) · [`produtos-card.tsx`](app/(app)/clientes/[id]/produtos-card.tsx)

Com Produto obrigatório no projeto, cliente sem produto virou beco sem
saída — e só 1 dos 4 clientes tinha produto. A saída foi transformar isso
em regra de negócio: **todo cliente tem um produto que representa a sua
marca** — a matriz, quando não há outras marcas no guarda-chuva.

- `cliente_produtos.padrao` (boolean) + índice parcial único por cliente. **A identificação é a coluna, não a convenção "nome igual ao do cliente"** — convenção não é garantia.
- `criarCliente` grava o padrão junto, com código `PRD-01`. Se esse insert falhar, a action **avisa em vez de redirecionar em silêncio**: o cliente já está gravado e PostgREST não dá transação para desfazer. Mesmo padrão da mensagem "Job criado, mas a planilha interna não foi montada".
- O backfill cobre **todos os clientes, inclusive os que já tinham outros produtos** — promove o homônimo quando existe, senão cria com o próximo `PRD-NN` livre.
- **Imutável:** não pode ser apagado, inativado, despromovido, trocar de cliente nem mudar de código. A única alteração de nome permitida é a que acompanha o nome fantasia.

⚠️ **A proteção mora num trigger (`trg_cliente_produtos_padrao`), não só
na server action.** `CLAUDE.md` pede que regra crítica não dependa do
frontend; aqui não depende nem da API. A action tem um gate próprio só
para devolver a mensagem certa antes do round-trip e registrar a
tentativa como `acao_negada` na auditoria.

- A função é `SECURITY DEFINER` de propósito (lê `clientes` para comparar o nome fantasia; com `INVOKER`, uma RLS restritiva devolveria `NULL` e barraria um rename legítimo). Por isso o **`revoke execute`**: sem ele a função de trigger fica chamável em `/rest/v1/rpc/protege_produto_padrao` — o advisor de segurança do Supabase apontou exatamente isso na conferência desta sessão. O trigger continua disparando; quem o executa é o dono da tabela.
- `atualizarCliente` renomeia o padrão **depois** de gravar o cliente. A ordem é o que faz o trigger aceitar: nesse momento os dois nomes batem.
- **Isto reverteu uma decisão da mesma sessão.** Antes, o rename usava `.eq("nome", nome_antigo)` para não sobrescrever produto ajustado à mão. Com o padrão imutável, "ajustado à mão" deixou de existir: o filtro virou `.eq("padrao", true)` e o padrão espelha o cliente sempre. Produtos comuns seguem intactos.
- Na tela do cliente o padrão encabeça a lista, ganha tarja **MARCA** com cadeado, não abre o editor e não tem botão de inativar.

### 12.8 Verificação (2026-08-06)

`tsc --noEmit`, `next lint` (só o warning pré-existente de `combobox.tsx`,
que o `multi-select.tsx` novo herda por usar o mesmo `role="combobox"`) e
`npm run build` limpos. No navegador, contra o banco real:

- **Projeto criado de ponta a ponta** com 2 regionais (NE, SP) e 5 responsáveis: gravou nas duas tabelas de vínculo, com produto e serviço. Resolve o item 6 dos próximos passos anteriores.
- **Orçamento criado nesse projeto:** Regional ofereceu **só NE e SP**, GP ofereceu **só os 5 responsáveis do projeto**. Gravou regional, cidade, GP e produtor.
- **Serviço do projeto** ofereceu exatamente Ativação, Always On, Fee, Interno; **categoria do orçamento**, exatamente Ativação, Conteúdo, Extra, Influencer.
- **Trigger do produto padrão:** rename, inativação, despromoção e delete testados em SQL direto — os quatro barrados, e ainda barrados **depois** do `revoke execute`.
- **Rename do cliente** com dois produtos: o padrão acompanhou, o comum ficou intacto. Produto comum segue clicável e com botão de inativar; o padrão, não.
- Console do navegador e log do servidor sem erros. Advisor de performance só acusa `unused_index` (INFO) nos índices novos — esperado num banco sem tráfego.
- Todos os registros de teste foram apagados ao final: os 4 clientes reais estão com o produto padrão e nada mais.

⚠️ Como toda sessão deste projeto, o `next dev` escreveu **direto em
produção** (próximos passos, item 5).

### 12.9 O que ficou aberto

1. **`cliente_produtos` tem 1 produto real** (Pevetech). Os outros 3 vieram do backfill com o nome do cliente. Se o time quiser marcas de verdade no guarda-chuva, é cadastro manual na tela do cliente.
2. **Quatro projetos anteriores a esta entrega continuam sem regional** — PEVETE-0001/26 a 0004/26. Criar orçamento neles esbarra no Regional desabilitado até alguém editar o projeto.

   O produto **foi** preenchido (migration `...000006`) porque é determinístico: cada cliente tem exatamente um produto padrão, então para um projeto sem produto informado só existe uma escolha possível.

   ⚠️ **Regional foi deixada em branco de propósito, não por esquecimento.** Escolher "uma qualquer" seria inventar dado de negócio, e o valor errado não se denuncia depois: desce para o orçamento, o job e o financeiro sem sinal nenhum. O campo vazio bloqueia a criação de orçamento e obriga alguém a decidir — que aqui é o comportamento correto. Se um dia o volume tornar a edição manual inviável, o caminho é pedir o de-para ao time, não sortear.
3. **Cidade do orçamento usa `Select` simples** com a lista toda. Correto para as 2 cidades de hoje; troque pelo `CidadeCombobox` quando a carga do IBGE entrar.

---

## 13. Entrega 12 — BV por item na tela de Orçamentos

Origem: design `Orcamento - BV - Opcoes.dc.html` (projeto Claude Design
`69342d83`). O design cobre **três** telas; esta entrega é a **parte 1**,
só a de Orçamentos. A parte 2 (acompanhamento do job) é a próxima.

### 13.1 O que é o BV

Valor negociado com o **fornecedor** para que ele devolva parte do custo
à California, como comissão. Só existe em item de **custo tipo A** — o
tipo em que o cliente paga o fornecedor diretamente, e por isso sobra
comissão a negociar. Em B, C e D o botão não aparece.

⚠️ **Hoje o BV não abate custo e não entra em rentabilidade.** O
abatimento só passa a valer quando o valor tiver sido faturado no módulo
de faturamento e estiver no contas a receber aguardando recebimento —
nenhum dos dois existe. Nada em `lib/calculos/versao-totais.ts` foi
tocado nesta entrega, de propósito.

O design trazia um agregado "BV lançado R$ 3.000,00" na barra de resumo
da versão. **Foi removido a pedido do time:** por ora não há visão
agregada, o BV é lido item a item.

### 13.2 Por que tabela própria e não colunas no item

`jobs_itens_orcado` é **cópia** do item da versão, criada na abertura do
job e alterável por errata. Com `bv_valor`/`bv_situacao` como colunas, o
BV do orçamento e o do job seriam registros distintos e divergiriam a
cada errata — o oposto do que o design pede ("o mesmo formulário nas duas
telas, já no item certo").

`itens_bv` tem FK única para `versoes_orcamento_itens`. Como
`jobs_itens_orcado.item_versao_id` aponta para a mesma linha, a parte 2
vai ler e gravar **o mesmo registro**, sem sincronização. O BV também tem
ciclo de vida próprio e vai receber vínculo de faturamento depois, o que
não caberia numa coluna solta.

### 13.3 Migration `20260807000001_itens_bv.sql`

- Enum `bv_situacao`: `a_negociar` · `confirmado` · `recebido` · `cancelado`.
- Tabela `itens_bv`: `item_versao_id` (FK, **unique** — um BV por item),
  `fornecedor_id` (nullable), `valor`, `prazo_repasse`, `situacao`,
  `created_by`, timestamps.
- Trigger `bv_exige_item_tipo_a` (SECURITY DEFINER, `revoke execute`):
  barra BV em item não-A e BV apontando para item de outro tenant. A
  regra é financeira — não podia viver só na Server Action.
- RLS nas 4 operações via `is_tenant_member`, GRANT para `authenticated`,
  índices em tenant/fornecedor/situação, trigger de `updated_at`.

### 13.4 A situação é derivada, nunca escolhida

Decisão do time, e é o ponto mais importante desta entrega. O campo
existe no formulário mas **não é editável por ninguém**:

| Situação | Quem escreve |
| --- | --- |
| `a_negociar` | nasce assim, na tela de Orçamentos |
| `confirmado` | envio ao financeiro, no acompanhamento do job (parte 2) |
| `recebido` | baixa no contas a receber (módulo futuro) |
| `cancelado` | remoção do BV, ou troca do tipo de custo para fora de A |

`situacao` **não entra** em `lib/validations/bv.ts`: o formulário não
manda o campo e a Server Action é quem decide. Ela só escreve
`a_negociar`, e apenas em dois momentos — BV novo, ou BV voltando de
`cancelado`.

### 13.5 "Remover BV" é cancelamento, não exclusão

`cancelarBv` faz `update situacao = 'cancelado'`; a linha permanece. A
página carrega só os BVs ativos (`.neq("situacao", "cancelado")`), então
o cancelado **some da planilha** e o quadrado volta a `+BV`.

Lançar de novo no mesmo item **reaproveita a linha** (decisão do time) e
devolve a situação para `a_negociar`. Os valores antigos são
sobrescritos; quem guarda o que havia antes é a auditoria —
`item_bv.cancelado` grava o valor, e o relançamento marca
`substituiu_cancelado: true`.

> Para a parte 2 o time sinalizou que BVs confirmados provavelmente
> **precisarão ser registrados** em vez de sobrescritos. Se isso se
> confirmar, o caminho é trocar `uniq_bv_item` por um índice parcial
> ("um BV ativo por item", ignorando cancelados) — a modelagem atual não
> impede essa evolução.

### 13.6 Confirmado e recebido travam o BV

A partir de `confirmado` o BV saiu das mãos do orçamento. **Nem editar
nem cancelar**, mesmo em versão aberta: o formulário abre em consulta
(campos desabilitados, sem Salvar e sem Remover, botão vira "Fechar") e
tanto `salvarBv` quanto `cancelarBv` rejeitam no servidor.

### 13.7 Troca de tipo de custo resolve o BV

Sair de A deixaria o BV órfão — invisível na tela, vivo no banco. Por
isso `atualizarCampoItem` passou a tratar o caso:

- BV em `a_negociar` → **cancela junto**, com auditoria
  (`motivo: "tipo_custo_deixou_de_ser_a"`).
- BV `confirmado`/`recebido` → **bloqueia a troca de tipo**, com mensagem
  explícita. Cancelar dinheiro que já foi ao financeiro como efeito
  colateral de outra célula seria perda silenciosa.

A consulta extra só roda quando `campo === "tipo_custo"` e o valor novo
não é `A`. O caminho quente da edição inline (cada Enter numa célula
numérica) continua com um round-trip só — ver `docs/PERFORMANCE.md`.

### 13.8 Interface

**Calha da linha** (`itens-table.tsx`): o quadrado de 26px fica à
**esquerda** da lixeira, na mesma posição que ocupará na planilha do job.
Vazado com `+BV` quando não há BV; preenchido com `BV` (sem o `+`) quando
há. Nenhuma coluna nova entrou na grade.

A trilha passou a existir **também em versão congelada**, coisa que antes
não acontecia: aprovada ou cancelada, ela aparece só se houver BV a
consultar, e só com o quadrado (sem lixeira). A calha reservada na página
foi de `pr-12` para `pr-16` (quadrado + lixeira); em versão congelada com
BV, `pr-10`. O alinhamento entre os cards de grupo e o card de Totais
continua batendo porque os dois compartilham o mesmo `pr`.

**Formulário** (`bv-dialog.tsx`): dialog de duas colunas. À esquerda,
Orçado, Planejado e a rentabilidade do item, em leitura — editar número
de planilha continua sendo na planilha. À direita, **Fornecedor** (acima
do valor, opcional aqui), **Valor do BV** com o percentual sobre o total
orçado calculado ao vivo, **Prazo de repasse** e a situação em leitura.

### 13.9 Verificação (2026-08-07)

`tsc --noEmit`, `next lint` (só os warnings pré-existentes de
`combobox.tsx` e `multi-select.tsx`) e `npm run build` limpos. No
navegador, contra o banco real:

- **Tipo B** mostra só a lixeira; **tipo A sem BV**, o `+BV` vazado.
- **Salvar sem fornecedor** grava — e revelou um bug real: o `.uuid()` do
  Zod roda **antes** do `.transform()`, então a string vazia era
  reprovada com "Fornecedor inválido". Corrigido com `preprocess`.
- **Percentual ao vivo:** 750,50 sobre 5.000 → 15,0%.
- **Ciclo completo:** lançar → quadrado preenchido → reabrir com valores
  → editar (UPDATE, sem duplicar) → remover → linha vira `cancelado` →
  quadrado volta a `+BV` → formulário reabre em branco → lançar de novo
  reaproveita a mesma linha e volta a `a_negociar`.
- **Auditoria:** `lancado 500` → `cancelado 500` → `lancado 900` com
  `substituiu_cancelado: true`.
- **Versão aprovada:** sem BV, nenhuma trilha; com BV, só o quadrado
  preenchido, "Ver BV", campos travados, sem Salvar/Remover.
- **BV confirmado em versão rascunho:** abre travado, com o aviso "Já foi
  enviado ao financeiro".
- **Troca de tipo:** A → B com BV `a_negociar` cancelou o BV e registrou
  o motivo na auditoria. A → C com BV `confirmado` foi **bloqueada**, com
  mensagem, e o tipo reverteu para A na tela.
- **Banco:** trigger rejeita insert em item não-A; `uniq_bv_item` rejeita
  o segundo BV. Advisors de segurança não acusam nada em `itens_bv` nem
  na função nova; performance só acusa `unused_index` (INFO), esperado em
  tabela sem tráfego.
- Console sem erros. Registros de teste apagados ao final.

⚠️ Como toda sessão deste projeto, o `next dev` escreveu **direto em
produção** (próximos passos, item 5).

### 13.10 O que ficou aberto

1. **A parte 2 (acompanhamento do job) não existe ainda.** Enquanto ela
   não entra, nenhum BV chega a `confirmado` pelo caminho normal — os
   testes desse estado foram feitos com `update` em SQL.
2. **`recebido` não tem produtor.** Depende do contas a receber. Até lá o
   estado só é alcançável por SQL.
3. **Permissão por papel não foi implementada** — decisão do time: "por
   enquanto todos". Orçamento e Jobs são preenchidos pelo produto e pelo
   GP, que precisam ver. Quando entrarem papéis sem acesso, o filtro vale
   para o botão da calha **e** para as duas Server Actions.
4. **`BV_SITUACOES` em `lib/types.ts` está sem uso** desde que o select
   saiu do formulário. Foi mantido porque a parte 2 deve precisar dele
   para exibir os quatro estados.

---

## 14. Entrega 13 — BV na planilha do job (parte 2) + BV↔PP por tipo

Fecha o design `Orcamento - BV - Opcoes.dc.html`, com quatro mudanças
pedidas pelo time em cima dele.

### 14.1 Tipo A **ou D**, nas duas telas

Migration `20260807000002_bv_tipo_a_ou_d.sql`. O critério do BV nunca foi
a letra, é *"o cliente paga o fornecedor diretamente"* — verdade em A e em
D. B (bi-tributação) e C passam pela California e seguem sem BV.

Vale nas duas telas porque **o BV é um registro só**: um BV criado num
item D pelo job seria rejeitado pelo trigger antigo. A função trocou de
nome junto com a regra (`bv_exige_item_tipo_a` → `bv_exige_item_com_bv`),
porque o nome passaria a mentir.

### 14.2 BV e PP não coexistem na calha

Mudança de design pedida pelo time: a coluna **Tipo** decide qual botão a
linha mostra.

| Tipo | Calha |
| --- | --- |
| A, D | quadrado de BV |
| B, C | Ver PP / Gerar PP |

Levantamento antes de mudar: as 6 PPs existentes estão **todas em itens
tipo B**. Nenhuma PP ficou inacessível.

### 14.3 Módulo compartilhado `app/(app)/_bv/`

O formulário e as actions passaram a ser usados por duas rotas, então
saíram de dentro de `orcamentos/` para uma pasta privada (`_` = fora do
roteamento do App Router):

- `_bv/actions.ts` — `salvarBv`, `confirmarBv`, `cancelarBv`.
- `_bv/bv-dialog.tsx` — o formulário, com variante por `origem`.

Toda escrita revalida **as duas rotas** (versão e job): é o mesmo BV nas
duas telas, e trocar de tela não pode mostrar valor velho de cache.

**A guarda de "versão congelada" virou dependente da origem.** Era um
`if` simples e não podia continuar sendo: a planilha do job trabalha
sobre a versão **aprovada**, que é justamente o estado que o orçamento
bloqueia.

| Origem | Regra |
| --- | --- |
| `orcamento` | versão não pode estar aprovada nem cancelada |
| `job` | versão aprovada é o caso normal; só `cancelada` barra |

### 14.4 Salvar e Confirmar

Na planilha do job o rodapé tem **dois** botões, não um:

- **Salvar** — grava mantendo `a_negociar`. Sem popup, sem exigir
  fornecedor. É o que permite ajustar o BV depois da aprovação sem bater
  o martelo (decisão do time; o pedido original era só "Confirmar").
- **Confirmar** — exige fornecedor, abre o popup de "tem certeza" e
  enviaria ao financeiro.

Confirmar grava antes de confirmar: sem isso, o financeiro receberia um
valor diferente do que está na tela.

⚠️ **O botão do popup nasce desabilitado**, a pedido do time: não existe
módulo de faturamento para onde enviar. O popup explica o motivo — botão
morto sem explicação lê como defeito. `confirmarBv` está implementado e
foi testado (ver 14.7); é só liberar o `confirmDisabled` quando o módulo
existir.

`ConfirmDialog` ganhou `confirmDisabled` + `confirmDisabledReason` para
isso — desabilita só o confirmar, mantendo o cancelar vivo.

### 14.5 Fornecedor obrigatório e o destaque de quem não tem

No orçamento o fornecedor segue opcional; **no job é obrigatório para
confirmar** — quem vai devolver a comissão precisa ter nome antes de
virar cobrança. A trava vale na tela e em `confirmarBv`.

O BV lançado sem fornecedor ganha **destaque âmbar** na calha do job
(quadrado âmbar + pontinho), com tooltip dizendo o que falta. É o
"destaque quando chegar na tela de acompanhamento" combinado na Entrega
12.

### 14.6 Realizado no lugar da rentabilidade

Na variante job o terceiro bloco do formulário é o **Realizado**, não a
caixa de rentabilidade do item — é o número que importa em execução, e a
rentabilidade continua no rodapé do grupo. No orçamento nada muda: lá não
existe realizado.

### 14.7 Verificação (2026-08-07)

`tsc --noEmit`, `next lint` (só os warnings pré-existentes) e
`npm run build` limpos. No navegador, contra o banco real, no JOB-0002:

- **Troca BV↔PP:** "Gerador" e "Luz" (A) mostram BV; os itens B mostram
  PP. Nenhuma linha com os dois.
- **Formulário no job:** bloco Realizado presente, caixa de rentabilidade
  ausente, rodapé com Cancelar / Salvar / Confirmar, fornecedor marcado
  com `*`.
- **Confirmar sem fornecedor:** bloqueado com mensagem, popup não abre.
- **Confirmar com fornecedor:** popup abre com valor e nome do fornecedor
  no texto, e o botão "Confirmar envio" vem **desabilitado**, com o
  motivo escrito.
- **Salvar pelo job:** gravou `a_negociar`, auditoria com `origem: "job"`.
- **Destaque âmbar:** BV salvo sem fornecedor ficou âmbar, com o tooltip
  "sem fornecedor — defina antes de confirmar".
- **Tipo D:** item marcado como D (versão + cópia do job) mostrou BV, e o
  trigger aceitou o UPDATE. Restaurado para A depois.
- **`confirmarBv`:** verificado habilitando o botão do popup
  temporariamente — gravou `confirmado`, registrou `item_bv.confirmado` e
  travou o BV (campos desabilitados, só "Fechar"). O botão foi devolvido
  ao estado desabilitado em seguida.
- Console sem erros em aba limpa. Registros de teste apagados ao final.

⚠️ Como toda sessão deste projeto, o `next dev` escreveu **direto em
produção** (próximos passos, item 5).

### 14.8 Divergência de tipo entre a versão e a cópia do job

Achado durante esta entrega e **resolvido nela** (as regras vieram do
time depois de reproduzido o problema).

**O problema.** A planilha do job lê `jobs_itens_orcado.tipo_custo` (a
cópia), mas o trigger validava `versoes_orcamento_itens.tipo_custo` (a
versão). A errata altera **só a cópia** — de propósito, para a versão
seguir sendo o que o cliente aprovou ([actions-errata.ts:288](app/(app)/jobs/[jobId]/realizado/actions-errata.ts:288)).
Reproduzido no JOB-0002: item levado de B para A passou a mostrar `+BV`
e o banco recusou com *"BV só pode ser lançado em item de custo tipo A ou
D"* — mensagem que contradizia a tela.

⚠️ Vale registrar porque a intuição engana: **a versão estar travada é o
que garante a divergência, não o que a impede.** A cópia anda com a
errata; a versão fica parada.

**As três regras que resolveram** (decisão do time):

1. **Depois da errata, quem manda é a cópia** — migration
   `20260807000003`. O trigger aceita quando a versão **ou** a cópia
   forem A/D; `carregarContexto` aplica a mesma regra. Se a planilha do
   job diz A, o BV grava.
2. **Errata não troca tipo de item com PP ativa ou BV confirmado/recebido**
   — bloqueio **por item** (os outros da errata seguem) e **só na troca
   de tipo** (corrigir valor unitário com PP ativa continua permitido,
   como sempre foi). A mensagem nomeia o item e o que cancelar.
3. **Errata que tira o item de A/D cancela o BV `a_negociar`** junto,
   com auditoria (`motivo: "errata_mudou_tipo_de_custo"`). **A→D não
   cancela**: em D o cliente também paga o fornecedor direto e o BV
   segue válido.

Verificado com erratas reais no JOB-0002: o cancelamento automático
(A→B), a gravação do BV com versão B + cópia A, e o bloqueio por BV
confirmado — que recusou **antes** de gravar qualquer coisa (nenhuma
errata criada, tipo intacto). Dados de teste revertidos ao final,
inclusive `jobs.valor_total`.

### 14.9 O que ficou aberto

1. **`recebido` continua sem produtor** — depende do contas a receber.
2. **Permissão por papel** segue não implementada (decisão do time: "por
   enquanto todos").
3. **A trava por PP ativa vale só na troca de tipo.** Um item com PP
   emitida ainda aceita correção de valor unitário por errata — é o
   comportamento que já existia, e o time optou por não mexer nele
   agora.

---

## 15. Entrega 14 — orçamento do projeto e visão agregada editável

Fecha o design `Orcamento do Projeto - Multi Jobs.dc.html` e o estende com
a visão agregada, pedida em cima dele. São duas telas novas que dividem o
mesmo motor: montar vários orçamentos de job num lugar só e gravar todos
de uma vez.

### 15.1 O seletor de "+ Novo orçamento"

Na lista de orçamentos do projeto o botão virou menu com duas portas:

- **Criar orçamento de um job** — o fluxo de sempre, intacto.
- **Criar orçamento do projeto** — abre `/orcamentos/[projetoId]/multi`.

O menu é feito à mão em `novo-orcamento-menu.tsx`, sem Radix: o botão
precisa continuar sendo a âncora vermelha do cabeçalho, e um
`DropdownMenu` traria trigger próprio para desfazer peça por peça.

⚠️ **Enxugado para o design (2026-08-13).** O pop-up usava `shadow-brand`, e o
halo vermelho do token (`rgba(231,75,86,0.35)`) aparecia atrás do card. Passou
para `shadow-elevated`, a sombra neutra — **o token não mudou**, e segue valendo
para os botões e drawers que o usam. Junto: cada opção virou uma linha só
(rótulo + `ChevronRight`), as duas descrições saíram, e entrou uma divisória
entre elas, recuada até o texto para não cortar a coluna dos ícones. O que cada
porta faz continua registrado aqui e no comentário do componente — a tela deixou
de explicar.

### 15.2 Rascunho no cliente, gravação em lote

**Decisão central da entrega.** No editor do orçamento do projeto nada
toca o banco enquanto o usuário não clicar em "Salvar orçamentos": criar
o orçamento, importar a planilha, digitar item, lançar BV — tudo vive no
estado do React.

A consequência que justifica o desenho: **abandonar a tela não deixa
meio-orçamento gravado no projeto**. O preço é uma action de parse que só
lê o XLSX sem persistir (`_rascunho/actions.ts`), e o arquivo original
fica com o cliente até o salvamento, quando sobe para o bucket junto com
o registro em `orcamento_importacoes`.

### 15.3 A planilha é a mesma, muda só o destino da escrita

`ItensTable` e `BvDialog` ganharam um **adaptador de persistência
opcional**. Sem ele, gravam nas Server Actions de sempre; com ele, mexem
no rascunho em memória.

```ts
export interface AdaptadorItens {
  atualizarCampo: (itemId, campo, valor) => Promise<ActionResult>;
  adicionar: (grupoId, formData) => Promise<ActionResult>;
  remover: (itemId) => Promise<ActionResult>;
  aposEscrita: () => void; // router.refresh() no servidor, no-op no rascunho
}
```

Por que isso e não uma grade nova: são ~1400 linhas de planilha com
edição inline, trilha de ações, BV e regra de tipo de custo. Duplicar
significaria duas grades divergindo a cada ajuste. A validação continua
sendo a mesma porque os schemas Zod (`itens.ts`, `bv.ts`, `grupos.ts`)
são importáveis dos dois lados.

`OrcamentoForm` ganhou o mesmo tratamento: `onRascunho` valida com o
`orcamentoSchema` de sempre e devolve os campos em vez de gravar.

### 15.4 Parâmetros: um conjunto no editor, um por orçamento na agregada

No editor do orçamento do projeto moeda, honorários e imposto são um
conjunto só, no cabeçalho, aplicado a todas as v1 criadas. **Exceção:**
planilha importada traz o % de honorários negociado nela, e ele vence o
do cabeçalho *naquele* orçamento.

Na visão agregada cada orçamento tem os seus, editáveis pelo botão de
porcentagem do card — ali cada versão já nasceu com as suas.

### 15.5 Card de Totais consolidado

`_totais/totais-projeto-card.tsx`, no mesmo molde da visão agregada do
módulo de Jobs: uma linha por orçamento, fechamento por tipo de custo e
painel de resultado. Sem o bloco REALIZADO — na fase de orçamento ele não
existe.

Por isso `PainelResultado` ganhou `somentePlanejada`, que esconde o
seletor Planejada/Realizada e tira o sufixo dos rótulos ("Resultado
geral", não "Resultado geral planejado"). Sem essa flag o painel abriria
em "Realizada" e mostraria uma coluna de travessões como se fosse
resultado.

**Taxas divergentes:** os valores em R$ são a soma orçamento a orçamento;
o percentual exibido é a média das taxas em uso, com nota explicando
quando elas divergem. Mesma convenção do card de Jobs.

### 15.6 Visão agregada: qual versão vale

`/orcamentos/[projetoId]/agregado`, alcançável pelo botão "Visão
agregada" no cabeçalho da lista.

Para cada orçamento vale a **versão aprovada**; sem ela, a mais recente
não cancelada. A regra evita o caso de aprovar a v2, abrir uma v3 de
rascunho e o total do projeto mudar sem ninguém ter decidido isso.

Entram todos os orçamentos do projeto, inclusive os sem nenhuma versão
(aparecem zerados, com o motivo). Cancelados e recusados ficam de fora.

### 15.7 O que pode ser editado — e o que o domínio proíbe

A visão agregada é **editável**, e é a continuação natural do orçamento do
projeto: os orçamentos podem ter nascido ali ou um a um, e todos são
ajustados no mesmo lugar, com o impacto visível no consolidado.

Duas travas não são negociáveis na tela:

| Situação | Comportamento |
|---|---|
| Versão aprovada | Somente leitura, com o motivo à vista |
| Orçamento `job_criado` (job aberto pelo financeiro) | Somente leitura |
| Demais (`rascunho`, `em_revisao`, `enviado_cliente`) | Editável |

**Esta tela nunca cria versão nova de um orçamento existente.** As edições
caem na versão aberta. Versão nova continua sendo ato da tela do
orçamento — decisão do time, para a agregada não virar uma fábrica de
versões a cada ajuste de digitação.

Criar orçamento *novo* é permitido: entra como rascunho e vira registro no
mesmo "Salvar alterações".

O servidor reconfere as duas travas. Esconder botão não é trava.

### 15.8 "Salvar alterações" reconcilia por id

O cliente manda o **estado desejado inteiro**, não um diff. O servidor
carrega o que está gravado e resolve:

- grupo/item **com id** → UPDATE, e só quando algum campo mudou;
- **sem id** → INSERT;
- presente no banco e **ausente do payload** → DELETE.

Itens são apagados **antes** dos grupos: a FK entre os dois é
`on delete restrict`. O BV entra no mesmo diff — cria, atualiza ou
cancela (nunca apaga: cancelar é o mesmo caminho do botão "Remover BV").

Deixar a conta no servidor evita que o cliente rastreie remoções, e é lá
que tenant e travas são conferidos de qualquer forma.

Os orçamentos novos reaproveitam `salvarOrcamentosDoProjeto`, uma chamada
por orçamento — cada um tem parâmetros próprios, e a action já cuida de
código sequencial, importação e rollback.

### 15.9 O mapa de ids que evita linha duplicada

Achado no teste. Depois de um salvamento bem-sucedido as linhas criadas
continuavam com id local no estado do cliente; um segundo "Salvar
alterações" antes de a página recarregar as inseriria de novo — e
recarregar pode falhar (o `router.refresh()` de dev chegou a devolver
503 durante a verificação).

A action passou a devolver `ids: Record<localId, idReal>` e o editor
troca os ids na hora, sem depender do recarregamento.

Junto veio outro ajuste: o retrato usado para responder "houve mudança?"
saiu de uma `ref` (que não redesenha) para estado, e o campo `aberto` foi
excluído da comparação — expandir um card não é alteração de conteúdo.

### 15.10 Organização

| Pasta | Papel |
|---|---|
| `orcamentos/_rascunho/` | tipos, helpers, card de orçamento, card de grupo, modais de importação e parâmetros, action de parse |
| `orcamentos/_totais/` | card de Totais consolidado, usado pelas duas telas |
| `[projetoId]/multi/` | editor do orçamento do projeto + action de gravação em lote |
| `[projetoId]/agregado/` | visão agregada editável + action de "Salvar alterações" |

Mesma convenção do `_bv/`: pasta com prefixo `_` não vira rota.

**Nenhuma migration.** Toda a entrega roda sobre o schema existente.

### 15.11 Verificação (2026-08-10)

Exercitado no projeto TESTE-0001/26, contra a base real:

1. **Editor do orçamento do projeto** — job montado à mão, item digitado
   inline, BV de R$ 1.500 lançado, salvo como `TESTE-0001/26-03`.
   Conferido no banco: orçamento + v1 + grupo + item + `itens_bv` em
   `a_negociar`.
2. **Importação** — planilha gerada no formato oficial (2 grupos, 4
   itens) importada num segundo job, salva como `TESTE-0001/26-04`.
   Versão nomeada "Importada de…", **honorários 12% lidos da planilha
   sobrescrevendo os 0% do cabeçalho só nesse orçamento**, arquivo no
   bucket e registro em `orcamento_importacoes` com as contagens do
   reparse no servidor.
3. **Visão agregada** — edição de valor, inserção e remoção de item, cada
   uma confirmada no banco. Em todas, o orçamento permaneceu em **v1**:
   nenhuma versão nova criada.
4. **Duplo salvamento sem recarregar** — segunda gravação atualizou a
   linha criada na primeira em vez de inseri-la de novo.
5. **Travas** — no projeto PEVETE-0001/26, os três orçamentos com job
   aberto aparecem em consulta, com faixa explicando o motivo e sem
   nenhum controle de edição.
6. **Guardas de saída** — o aviso do navegador bloqueou a navegação com
   rascunho montado; o "Cancelar" pediu confirmação antes de descartar.
7. **Sem regressão** na visão agregada de Jobs: o seletor
   Planejada/Realizada continua lá, abrindo em "Realizada".

Lint, typecheck e build limpos.

### 15.12 O que ficou aberto

1. **Sem transação cobrindo o lote.** Se um orçamento novo falhar no meio
   do "Salvar alterações", as edições que já entraram permanecem — a
   mensagem diz isso explicitamente. Fechar exigiria uma função no
   Postgres, fora do que foi pedido.
2. **Dados de teste na base.** No TESTE-0001/26: o `-01` teve o item
   **GP** alterado de R$ 10.000 para R$ 12.500 e ganhou **Estagiario** a
   R$ 700; os `-03` e `-04` foram criados nos testes. Reverter é decisão
   do time.
3. **Ordem dos itens é global na versão.** A reconciliação renumera
   `ordem` a cada salvamento seguindo a ordem da tela. Não há
   reordenação manual (arrastar) em nenhuma das duas telas.

---

## 16. Entrega 15 — cores dos blocos e faixa do agrupamento

**Data:** 2026-08-11 · **Branch:** `design/bv-botoes-adicionar-abrir`
**Origem do design:** projeto Claude Design `69342d83-28d9-4bea-a8af-c99e233f5f13`,
arquivo `Comparativo Cores - Orcamento e Job.dc.html`, lido via MCP `claude_design`.
O design cobre orçamento e job de uma vez; a parte de Jobs está na Parte IV do
`HANDOFF_JOBS.md`.

⚠️ **A regra em si não mora aqui.** O sistema de cor por bloco, as grades
compartilhadas e a faixa do agrupamento são transversais aos dois módulos —
estão em `docs/09-identidade-visual-ui.md`, seções "Cores das planilhas",
"Grades compartilhadas" e "Faixa do agrupamento". Duplicar a spec nos dois
handoffs faria as cópias divergirem, que é o defeito que esta entrega corrigiu
no código. Aqui fica só o que é do módulo de Orçamentos.

### 16.1 O que mudou nas telas de orçamento

1. **Paleta trocada.** ORÇADO era bege/grafite e virou azul; PLANEJADO era azul
   e virou verde; RENTABILIDADE era verde e virou grafite. Vale na versão
   individual, nos cards de grupo do rascunho/agregada e nos dois cards de
   Totais.
2. **A barra de título do card de grupo saiu.** O nome subiu para a faixa do
   `<thead>`; contador e lixeira foram para a calha. Vale em `GrupoCard`
   (versão) e `GrupoRascunhoCard` (agregada). O input de renomear inline da
   agregada continua funcionando dentro da faixa.
3. **Totais da agregada ganhou o bloco RENTABILIDADE**, que os cards de grupo
   acima já tinham e ele não. Cada linha de orçamento agora mostra a própria
   rentabilidade em R$ e %, e o rodapé fecha a coluna — a linha "Rentabilidade"
   solta que existia embaixo virou redundante e saiu (mesmo número, melhor
   posicionado, via `calcularRentabilidade`).
4. **Alinhamento.** `grade-colunas.tsx` saiu de dentro de `versoes/[versaoId]/`
   e virou `app/(app)/_planilha/grade-orcamento.tsx`, agora compartilhado pelas
   **três** tabelas (itens, Totais da versão, Totais da agregada). Na agregada
   também foi preciso mexer no aninhamento — ver "Grades compartilhadas" no doc.

### 16.2 Decisões do time nesta entrega

Três perguntas feitas antes de codar:

- **Controles do grupo:** vão todos para a faixa + calha, não sobra barra fina.
- **Escopo:** *"Essa modificação é de design, e não deverá afetar as informações
  presentes no modelo atual."* Nenhum bloco novo, nenhuma coluna a mais — a
  exceção é a rentabilidade que faltava no Totais da agregada, pedida
  explicitamente no mesmo enunciado.
- **Cor da rentabilidade:** *"Sempre grafite"* — inclusive negativa.

### 16.3 Verificação

`tsc --noEmit --incremental false` e `next lint` limpos. Alinhamento conferido
medindo `getBoundingClientRect()` no navegador, não a olho:

| Tela | Fronteiras das colunas | Resultado |
|---|---|---|
| Versão individual | idênticas nas 2 tabelas | exato |
| Agregada de orçamento | 111/511/898/1284/1491 vs 112/512/897/1283/1490 | 1px (borda a mais do card do orçamento) |

---

## 17. Entrega 16 — Faturamento previsto × Valor do Job, e as subdivisões de custo

**Data:** 2026-08-11 · **Origem:** planilhas oficiais do time, não um design.
`OrçadoPlanejadoRealizado (1).xlsx` (Corona) e
`[INT] SJ PEPSI CG - NE - 2026.xlsx` (a que valeu como referência final).

⚠️ **A regra em si não mora aqui.** A matriz dos sete tipos de custo e as duas
fórmulas de fechamento estão em `docs/decisions/003-tipos-de-custo.md`, e a
fonte no código é `REGRAS_TIPO_CUSTO` em `lib/calculos/versao-totais.ts`. Aqui
fica só o que é do módulo de Orçamentos. A parte de Jobs está na Parte V do
`HANDOFF_JOBS.md`.

### 17.1 O problema: um número fazia o papel de dois

O card de Totais mostrava só "Faturamento previsto", e ele somava **todo** o
custo. Isso confundia duas coisas que o time trata separado:

- o que a California **emite nota**;
- o que o cliente **se compromete a gastar**, incluindo o que ele paga direto
  ao fornecedor.

Nos tipos de pagamento direto (A · Direto, D, F) o principal nunca passa pela
agência — só o honorário. Somá-lo ao faturamento inflava a receita da
California pelo valor do fornecedor.

### 17.2 As duas linhas

```
faturamento previsto = Σ(AR, B, C)     + honorários + imposto
valor do job         = Σ(tudo menos D) + honorários + imposto
```

Os dois compartilham honorários e imposto; mudam só em quais principais
entram. **O Valor do Job é o número que a planilha oficial chama de
`FATURAMENTO`** — o que o sistema calculava antes.

`Resultado operacional` e `Resultado geral` passaram a usar o **Valor do Job**
como base. O custo descontado é o do job inteiro, então a receita comparada
precisa ser a do job inteiro; com o faturamento previsto ali, o resultado caía
pelo valor dos custos que a agência nem desembolsa.

### 17.3 Sete tipos onde havia quatro

`A` virou A · Direto e ganhou o irmão `AR` (A · Repasse, com o principal
passando pela California). Entraram `F` (F · Externo, hoje espelho do A ·
Direto) e `FI` (F · Interno, sem honorários). As letras "cruas" ficaram com o
comportamento que já era delas — **nenhum backfill foi preciso**.

A regra virou **dado, não `if`**: `REGRAS_TIPO_CUSTO` é uma matriz de quatro
booleanos por tipo (`fatura`, `valorJob`, `honorarios`, `imposto`). Tipo novo é
uma linha a mais. Há guarda de exaustividade: tipo que entre em `TipoCusto` e
não seja listado em `TIPOS_CUSTO` **para de compilar**.

### 17.4 O que mudou nas telas de orçamento

1. **Card de Totais da versão e da agregada** ganharam a linha "Valor do Job"
   logo abaixo de "Faturamento previsto" — vermelho California em cima, preto
   embaixo. O fechamento por tipo de custo passou a listar os sete — **hoje são
   cinco linhas**, ver a nota de 12/08/2026 no fim da seção.
2. **Cabeçalhos** (`ResumoRentabilidade`, no editor da agregada e do multi)
   mostram **só o Valor do Job** — o bloco que dizia "Faturamento previsto"
   passou a dizer "Valor do Job", sem ganhar bloco novo.
3. **Fluxo de abertura**: a barra fixa do rodapé e o pop-up de aprovação
   mostram **só o Valor do Job**. Os dois modais do envio (`EnviarJobModal`,
   `ConfirmarEnvioModal`) mostram **os dois**, no quadro "Fechamento da versão"
   — é a última conferência antes de criar o job, e o time decidiu manter.
   `jobs.valor_total` recebe o **Valor do Job**; `jobs.faturamento_previsto`
   é novo.
4. **A legenda das fórmulas virou componente único**,
   `components/legenda-fechamento.tsx`. Estava copiada em quatro arquivos — o
   mesmo defeito que a Entrega 15 corrigiu nas cores.
5. **`TIPOS_COM_BV` centralizou** em `versao-totais.ts` como o predicado
   `aceitaBV()`. Estava duplicado em nove arquivos. A regra continua `('A','D')`
   e espelha o trigger `bv_exige_item_com_bv` — A · Repasse e os F não têm BV.

⚠️ **Correção de escopo (2026-08-12).** O pedido do time foi a linha "Valor do
Job" **nos Totais**. A primeira versão desta entrega estendeu o par de números
por conta própria para cabeçalhos, barra fixa, KPIs do multi e lista de jobs —
não foi pedido, e na lista o número a mais **empurrou o botão "Visão agregada"
para a linha seguinte**. Revertido nos commits `408444b`, `5654c87` e `5a2e24f`.
A regra que ficou: **fora dos cards de Totais, um número só — o Valor do Job.**

⚠️ **Fechamento em cinco linhas (2026-08-12).** A pedido do time, o painel
"Fechamento do orçado · por tipo de custo" soma as subdivisões: `A` + `AR` e
`F` + `FI` viram uma linha cada. Sete linhas viraram cinco, nas quatro telas de
Totais. Em 13/08/2026 os rótulos viraram **`Sub-total A` … `Sub-total F`**, o
mesmo nome que o XLSX exportado já usava; os descritores ("Bi-trib.", "Sem
honor.", "Interno") saíram do painel e seguem na legenda do rodapé. **Só a
leitura mudou** — a conta continua tipo a tipo em `REGRAS_TIPO_CUSTO`, e nenhum
total se moveu. A fonte das linhas é
`LINHAS_FECHAMENTO_POR_TIPO` (`lib/calculos/versao-totais.ts`), com guarda de
exaustividade. A legenda do rodapé e o XLSX exportado seguem com os tipos
separados. Regra completa em `docs/decisions/003-tipos-de-custo.md`.
As exceções, todas conversadas com o time, estão em 17.4 item 3 (os dois modais
do envio) e no card de Erratas (`HANDOFF_JOBS.md`, seção 28).

### 17.5 O Excel exportado ao cliente não mudou

Continua mostrando **só o Valor do Job**, no rótulo `FATURAMENTO` que sempre
teve. Decisão do time: a quebra entre o que a California fatura e o que o
cliente paga direto é leitura interna.

### 17.6 Decisões do time nesta entrega

Quatro rodadas de pergunta antes de codar — a primeira planilha e o enunciado
inicial se contradiziam:

- **"apenas não podemos faturar o custo A"** foi o enunciado inicial. A
  planilha Corona, porém, somava A e D na mesma célula (`SUB-TOTAL A e D`) e
  os dois davam faturamento **idêntico** — verificado replicando a fórmula e
  batendo com a célula `G64`. A referência não separava o que o enunciado
  separava.
- A segunda planilha separou os subtotais e tirava o **D** do `TOTAL`, não o A.
  Decisão final do time: **A, D e F ficam fora**, e o AR entra.
- **Base do resultado:** Valor do Job, "para o resultado não despencar".
- **Modal e listagens:** mostram os dois.

### 17.7 Verificação

`tsc --noEmit` e `next lint` limpos; `npm run build` compila. O cálculo do
código foi conferido **contra a planilha oficial, não contra uma réplica**:

| Aba de `[INT] SJ PEPSI CG - NE - 2026` | Honorários | Imposto | Valor do Job × célula `FATURAMENTO` |
|---|---|---|---|
| SJ PEPSI 26 | 57.877,20 | 59.749,42 | 599.936,62 ✅ |
| SJ PEPSI 26 (MS) | 57.877,20 | 59.749,42 | 599.936,62 ✅ |
| SJ PEPSI 26 (Tudo custo B) | 57.877,20 | 105.619,56 | 645.806,76 ✅ |
| SJ PEPSI 26 (MS c margem) | 60.064,80 | 64.704,76 | 625.309,56 ✅ |
| PAINEL EXTRA | 8.400,00 | 2.038,67 | 80.438,67 ✅ |

Nas quatro telas, no navegador, com dados reais: versão do orçamento (A=4.000)
deu `14.514,73 / 18.514,73`; agregada de orçamentos, diferença de exatos
R$ 84.000 — o subtotal A.

⚠️ **Armadilha de leitura de Excel:** `getCell` do ExcelJS devolve o valor da
célula mestre para todas as células de uma mesclagem, o que infla somas
recalculadas linha a linha. Duas abas "divergiram" por isso antes de o erro ser
achado. Ao conferir planilha, ler os **subtotais que ela mesma calculou**.

### 17.8 Migrations desta entrega

| Migration | O que faz |
|---|---|
| `20260811000004_tipos_custo_subdivisoes.sql` | `AR`, `F`, `FI` no enum `tipo_custo`. Isolada: valor novo de enum não pode ser usado na mesma transação em que é criado |
| `20260811000005_jobs_faturamento_previsto.sql` | `jobs.faturamento_previsto` + backfill pela mesma fórmula |

### 17.9 O que ficou aberto

1. **F ainda não tem regra própria** — F · Externo é clone de A · Direto. Quando
   o time definir o que o diferencia, é uma linha na matriz.
2. **Subdivisões do custo A no nível do item** (a aba `CUSTO A` da planilha, com
   `FORNECEDOR`, `MÚTUO`, `IMPOSTO NF`, `VALOR CALIFORNIA`) é modelo de dados
   novo e ficou para uma entrega própria.

---

## 18. Entrega 17 — Cidade e Regional editáveis na abertura, e o modal inteiro na tela

**Data:** 2026-08-12 · **Origem:** pedido direto do time sobre print do
modal "Enviar job para abertura". Sem handoff de design.

Dois pedidos, um modal: os campos Cidade e Regional deviam continuar
pré-preenchidos mas voltar a aceitar edição, e o formulário devia caber
inteiro ao abrir.

⚠️ **A regra não mora aqui.** Está em
[`docs/decisions/005-cidade-e-regional-na-abertura.md`](docs/decisions/005-cidade-e-regional-na-abertura.md).
Esta seção registra o que mudou no código e como foi medido.

### 18.1 O que reverteu da Entrega 11

A seção 12.6 tinha travado **cinco** campos e tirado os cinco do
`aberturaJobSchema` e do `FormData`. Agora são **três**: produto (do
projeto), GP e produtor (do orçamento) — esses o servidor continua
relendo do banco e o modal continua só exibindo em `<Travado>`.

Cidade e Regional voltaram a ser campos de formulário: saíram de
`HerdadosJob` (que os mantém só para o modo somente leitura, onde valem
os valores congelados no job) e entraram em `DadosJob` como `cidadeId`,
`cidadeNome` e `regionalId`.

### 18.2 Três decisões que o time respondeu antes de codar

| Pergunta | Resposta |
|---|---|
| Editar cidade/regional afeta o orçamento? | **Grava também no orçamento**, junto com nome e datas. Orçamento e job nunca divergem. |
| Quais regionais aparecem? | **Só as do projeto** (`projeto_regionais`), igual ao formulário de orçamento. |
| Como escolher a cidade? | **Combobox com busca no servidor** — o `cidade-combobox.tsx` que estava órfão. |

### 18.3 O que o servidor confere

Campo editável no HTML não é garantia — quem posta o form não é obrigado
a respeitar a lista que a tela mostrou. `enviarJobParaAbertura` valida
`cidade_id`/`regional_id` como uuid no Zod e, em paralelo com a busca do
produto, confere que a cidade existe no tenant e que a regional está em
`projeto_regionais` do projeto do orçamento. As duas falhas devolvem
`fieldErrors` no campo certo, e nada é gravado.

É a mesma checagem que `assertRegionalEGpDoProjeto` faz no formulário de
orçamento (seção 12.4) — só que aqui feita direto na action, porque o
payload é outro.

O aviso âmbar de "complete o cadastro antes de abrir o job" perdeu Cidade
e Regional: não faz sentido travar o botão por algo que o usuário resolve
na própria tela. Produto, GP e produtor continuam lá.

### 18.4 A altura: o `62vh` era o vilão, mas não sozinho

O diálogo já era `max-h-[92vh]`, mas o miolo tinha `max-h-[62vh]` **fixo**
— ele cortava o formulário mesmo com tela sobrando. A correção estrutural
foi transformar o diálogo em `flex flex-col` (`max-h-[97vh]`) com o miolo
em `grid min-h-0 flex-1 overflow-y-auto`, e `shrink-0` no cabeçalho e no
rodapé. Assim o formulário ocupa toda a altura disponível e, onde não
couber, só o miolo rola.

⚠️ **Só isso não resolveu.** Medido num viewport de 970 px (≈ o do print
do time), o conteúdo pedia 815 px e o miolo oferecia 722. Faltavam ~93 px
que nenhum `vh` a mais entregaria sem colar o diálogo nas bordas. Foram
recuperados apertando medidas, sem tirar campo nem texto:

| Onde | De | Para |
|---|---|---|
| `gap-y` do miolo | `4` | `3` |
| padding do miolo | `p-6` | `px-6 py-4` |
| padding do cabeçalho | `p-6` | `px-6 py-5` |
| padding do rodapé | `py-4` | `py-3` |
| `space-y` do `<Campo>` | `2` | `1.5` |
| card de fechamento | `py-3` / `mt-2` | `py-2.5` / `mt-1.5` |
| Observações | `rows=3`, `min-h-[84px]` | `rows=2`, `min-h-[68px]` (segue `resize-y`) |

### 18.5 Verificação

Feita no navegador contra a versão aprovada do **PEVETE-0001/26-04**
(projeto com 2 regionais, sem job ativo), medindo o DOM em vez de
confiar em screenshot:

- campos abrem preenchidos com o orçamento (Salvador / SP) e editáveis;
- o select lista exatamente as 2 regionais do projeto (NE, SP), e trocar
  reflete no estado do `<FluxoAbertura>`;
- o combobox de cidade abre com as cidades do servidor e a troca sobe
  para o pai;
- "Confirmar dados" marca só as três datas vazias — Cidade e Regional
  contam como preenchidas;
- **rolagem 0 px** num viewport de 970 px, inclusive com as três
  mensagens de erro na tela, que é o estado mais alto do formulário. Em
  820 px o miolo rola 146 px e o rodapé continua visível;
- modo somente leitura (JOB-0009): Cidade e Regional voltam a `<Travado>`
  com o que ficou congelado no job.

`tsc --noEmit` e `next lint` limpos.

⚠️ **O caminho de gravação não foi executado.** Confirmar o envio criaria
um job de verdade — o `next dev` desta máquina escreve em produção (seção
4, e item 5 dos próximos passos). O `UPDATE` no orçamento e o `INSERT` do
job com os valores do formulário estão implementados e conferidos por
leitura, não por execução.

## 19. Próximos passos

1. **Carga completa de cidades do IBGE** — hoje só Salvador e São Paulo. Formato acordado: `Salvador-BA` num campo só, sem coluna `uf`. É só uma migration de INSERT: o schema e a busca já estão prontos (Entrega 8). Fonte: `https://servicosdados.ibge.gov.br/api/v1/localidades/municipios`. Ao carregar, reconciliar as 2 linhas atuais, que estão sem o sufixo de UF, e os jobs que já gravaram `Salvador`/`São Paulo`.
2. **Exibir as observações do job** — `jobs.observacoes` grava desde a Entrega 9 mas nenhuma tela lê. Entra junto com o refino da tela de abertura do financeiro, onde ela faz sentido: é contexto para quem abre. Enquanto isso, o dado é write-only.
3. **Remover a server action `criarJob`**, órfã desde a Entrega 8. Avaliar junto os campos `posicao_hierarquia` e `job_pai_id` do `jobSchema`, que provavelmente ficam sem uso.
4. **Rotacionar o PAT do Supabase.** O `.mcp.json` esteve versionado no commit `69c521d` e foi removido em `65da0b2`; remover do tracking não apaga do histórico. O repositório inteiro, incluindo o arquivo, também foi enviado ao projeto do Claude Design. O token segue legível nos dois lugares.
5. **Ambiente de desenvolvimento separado no Supabase** — hoje `next dev` escreve em produção (ver seção 4). Ficou evidente na Entrega 8: o teste de ponta a ponta criou o JOB-0003 direto na base real. As migrations em `supabase/migrations/` recriam o schema inteiro.
6. **Caminhos não exercitados do fluxo de abertura** — a verificação da Entrega 8 cobriu só o caminho feliz. Faltam: rejeição pelo financeiro, cancelamento de aprovação com job existente, e abertura para cliente sem produto cadastrado (a mensagem existe mas nunca rodou).
7. **Fase 2 da edição inline** (fora de escopo agora): alça de arrastar/preencher, seleção de intervalo, copiar/colar de planilha, navegação por teclado entre células, `⌘Z` global.

**Resolvido desde a última revisão:** o modo `readOnly` da Entrega 2 ganhou prova de execução (v1 do ORC-0003 aprovada, grade travada); os `console.log` de timing temporários saíram no commit `3021cff`; e a criação de projeto de ponta a ponta (item 6 da lista anterior) foi exercitada na Entrega 11 — ver seção 12.8.

**Aberto pela Entrega 11:** ver os três pontos da seção 12.9.

**Aberto pela Entrega 13:** ver os três pontos da seção 14.9 — todos
menores. A divergência de tipo entre a versão e a cópia do job, achada
durante a entrega, foi resolvida nela mesma (seção 14.8).

**Resolvido pela Entrega 13:** a parte 2 do BV que a Entrega 12 deixou em
aberto — botão na planilha do job, destaque de BV sem fornecedor e o
fluxo de confirmação (com o envio ainda desabilitado, à espera do módulo
de faturamento).

**Aberto pela Entrega 14:** ver os três pontos da seção 15.12. O item 2
(dados de teste no TESTE-0001/26) é o único que pede ação imediata do
time; os outros dois são limitações conhecidas e documentadas.

---

## 16. `A · Repasse` passou a aceitar BV (2026-08-13)

> ⚠️ **Reverte a regra da Entrega 12/13.** Naquelas entregas o BV existia
> só em `A` e `D`, e a decisão 003 dizia explicitamente que o
> `A · Repasse` não tinha BV. Passou a ter, confirmado com o time em
> 13/08/2026.

### Efeito nesta tela

Um só: **a linha de tipo `AR` agora mostra a pílula de BV**, exatamente
como `A` e `D` — "Adicionar BV" / "Abrir BV", mesmo formulário, mesmo
ciclo de vida de situação, mesma trava de edição depois de enviado ao
financeiro.

**A pílula não se divide aqui.** A calha dividida (BV │ PP) do design
`Job - A com Repasse - BV e PP.dc.html` é da planilha do **job**: a PP
nasce do realizado (`pedidos_compra` referencia `job_itens_realizado`) e
no orçamento nada disso existe ainda. Decisão do time, 13/08/2026.

Nada mais mudou na tela: nem colgroup, nem larguras, nem a reserva de
`pr-[154px]`, nem o card de Totais, nem qualquer número do fechamento.

### Consequências automáticas que valem conferir

Tudo o que já lia `aceitaBV()` passou a incluir `AR` sozinho, e isso é o
comportamento desejado:

- mudar o tipo de um item de `A` para `AR` **não cancela mais** o BV
  lançado (antes cancelava, porque `AR` saía da lista);
- os editores multi-jobs e agregado aceitam BV em `AR`;
- as mensagens de erro passaram de "tipo A ou D" para "tipo A,
  A · Repasse ou D".

### Onde está a regra

`TIPOS_COM_BV` em `lib/calculos/versao-totais.ts` e o trigger
`bv_exige_item_com_bv` no Postgres (`20260813000001_bv_aceita_a_repasse.sql`).
Os dois precisam andar juntos — mudar um sem o outro deixa a tela
oferecendo um BV que o banco recusa.

O resto da história — por que `AR` tem as duas coisas, e por que "tem BV"
e "sai do caixa da California" viraram duas perguntas separadas — está na
decisão 003 e na seção 30 do `HANDOFF_JOBS.md`.

---

## 17. Nome da versão calculado e V1 automática (2026-08-13)

> ⚠️ **Duas coisas que a tela fazia deixaram de existir**: o nome da
> versão não é mais digitável, e criar orçamento não leva mais para a
> lista de versões vazia. A regra está na
> [decisão 007](docs/decisions/007-nome-da-versao-e-v1-automatica.md).

### Nome da versão

Passou a ser `{orcamentos.nome} - V{numero_versao}` — "Bebedouros SP -
V2" —, calculado na leitura por `nomeVersao()` em `lib/nome-versao.ts`.

Saíram da tela: o **título inline editável** da versão (o arquivo
`versao-titulo-inline.tsx` foi removido) e o campo **"Nome da versão"**
dos drawers de edição e de nova versão. Saiu também do servidor: `nome`
não está mais no `versaoSchema` nem nos extratores de
`versoes/actions.ts`, então um form que mande o campo é ignorado.

A coluna `versoes_orcamento.nome` **continua no banco** com o conteúdo
antigo. As 20 versões que tinham nome próprio — 11 delas aprovadas —
passaram a exibir o nome calculado, por decisão do time: regra única, sem
exceção para versão aprovada.

Telas atualizadas: lista de versões, título da versão, "Versão aprovada"
na tela do job, cabeçalho da planilha do realizado e o XLSX exportado. O
rótulo curto `v1`/`v2` **não** mudou — é referência de número, não nome.

### V1 automática

`criarOrcamento` passou a criar a v1 em rascunho e redirecionar para a
planilha dela, em vez de `/orcamentos/[projetoId]/[orcId]`. A v1 nasce
com honorários do cadastro do cliente, BRL, câmbio 1 e **sem alíquota**
(decisão 006 — quem cobra é a aprovação).

Falhando a leitura dos honorários, a v1 não é criada e o destino volta a
ser a tela do orçamento, com log no servidor: versão com base de
honorários errada produz fechamento errado em silêncio, e voltar para o
formulário criaria orçamento duplicado.

A função vive em `orcamentos/[projetoId]/actions.ts` e **não** reusa
`criarVersao`: aquela é a porta do formulário, com validação de status e
`redirect` próprio, e chamá-la de dentro significaria capturar o redirect
dela para descartar.

### Verificado no fluxo real

Criado o orçamento **TESTE-0002/26-02 · "TESTE Claude - fluxo V1"** no
projeto TESTE-0002/26 (Paraquedas), com autorização do time:

| Verificação | Resultado |
|---|---|
| Destino após criar | `/orcamentos/…/…/versoes/4206ebfa…` — a planilha da v1 |
| Título da versão | `TESTE Claude - fluxo V1 - V1` |
| Versões criadas | exatamente 1, `numero_versao = 1`, status `rascunho` |
| Alíquota | `0.000000` — não escolhida |
| Honorários | `12.000`, vindos do cadastro do cliente |
| Coluna `nome` | `null` — nada foi gravado |
| Barra de aprovação | "Aprovar versão" **desabilitado**, com "Escolha a alíquota de impostos da versão antes de aprovar" |
| Lista de versões do Bebedouros | `Bebedouros SP - V2` e `Bebedouros SP - V1` (a v2 se chamava "V Teste") |
| Export XLSX | HTTP 200, content-type de xlsx |

`tsc --noEmit`, `next lint` e `npm run build` limpos.

⚠️ **Dado de teste deixado no banco**: o orçamento `TESTE-0002/26-02` e a
v1 dele. Criados com autorização para exercitar o fluxo; remover quando
não forem mais úteis.

### 17.1 Importar planilha na tela da versão (2026-08-13)

> ⚠️ **Ação destrutiva nova.** O "Importar planilha" da tela da VERSÃO
> apaga grupos, itens e os BVs deles. O da tela do ORÇAMENTO não mudou —
> continua criando v+1. Regra completa no adendo da
> [decisão 007](docs/decisions/007-nome-da-versao-e-v1-automatica.md).

Botão ao lado do "Exportar", escondido em versão congelada e desabilitado
quando a versão já gerou job. Reusa `ImportarPlanilhaDrawer` com
`modo="sobrescrever"`: mesmo upload, mesmo preview, mais um passo de
confirmação que mostra em número o que será apagado.

**Testado de ponta a ponta** com uma planilha real (`orcamento-teste.xlsx`,
baixada do bucket de importações) na v1 do TESTE-0002/26-02:

| Passo | Resultado |
|---|---|
| 1ª importação (versão vazia) | aviso diz "Esta versão está vazia — nada será apagado"; grava 2 grupos / 4 itens |
| Cenário montado | alíquota posta em 19,53% e 1 BV lançado no item tipo A |
| 2ª importação | aviso conta **− 2 grupos, − 4 itens, − 1 BV** |
| Depois de confirmar | 2 grupos / 4 itens (**substituiu**, não somou) |
| BV | **0 restantes** — foi em cascata, como decidido |
| Alíquota | **19,53% preservada** |
| Registro | 2 linhas em `orcamento_importacoes`, 2 eventos `versao_orcamento.sobrescrita_por_importacao` |

⚠️ **Não exercitado**: a trava de versão com job aberto. O caminho existe
nas duas camadas (botão desabilitado + recusa na action), mas exercitá-lo
exigiria abrir um job sobre uma versão de teste e depois cancelá-lo.

## 20. Entrega 18 — Funil comercial nas listas, Valor do Job e GPs Responsáveis (2026-08-17)

**Origem:** plano local de alterações de telas (Grupo A), com as decisões
do Tiago de 16-17/08. O plano fica em `planos-locais/` (gitignorado, como
as referências de design). Regra de negócio na
[decisão 010](docs/decisions/010-funil-comercial-do-orcamento.md).
**Commits:** `d078f8a` (lista de projetos) · `63c258f` (formulário de
projeto) · `9018e3a` (detalhe do projeto).

Três telas, um módulo novo:

1. **`lib/calculos/funil.ts` (novo)** — fonte única do funil comercial:
   `estagioFunil`, `estagioFunilLabel`, `estagioFunilBadgeClasses`,
   `escolherJobDoFunil`. Semântica completa na decisão 010.
2. **Lista de projetos** (`page.tsx` + `projetos-list.tsx`): célula Nome
   perde os selos "N aprovado(s)"/"N job(s)"; três colunas novas depois
   de Orçamentos — **Aprovados · Enviados · Abertos** — mutuamente
   exclusivas, zero renderizado como travessão discreto. A query de
   `jobs` (`orcamento_id, status, created_at` por `projeto_id`) entrou no
   `Promise.all` existente; sem embed.
3. **Formulário de projeto** (`projeto-form.tsx`): rótulo "Responsáveis"
   → **"GPs Responsáveis"**, placeholder → "Selecione um ou mais GPs".
   Só strings — identificadores (`responsavel_ids` etc.) e a lista de
   membros oferecida ficaram como estavam (decisão explícita).
4. **Detalhe do projeto** (`[projetoId]/page.tsx` + `orcamentos-list.tsx`):
   coluna **"Valor do Job"** entre Fim previsto e Versões (versão
   aprovada > mais recente > travessão; `calcularTotaisVersao().valorJob`,
   a mesma conta do fechamento) e coluna Status trocada pelo **badge de
   estágio do funil**. Itens buscados só das versões-alvo, em 3 colunas
   (`versao_orcamento_id, tipo_custo, total_orcado`).

**Verificação no navegador** (dev server, sessão real): contagens do
funil cruzadas com SQL em NOV-0002/26 e TESTE-0001/26 — job `encerrado`
contando em Abertos, rascunho/recusado fora do funil; "Valor do Job" da
lista batendo com o fechamento da versão (R$ 11.200,00 nos dois lugares
em TESTE-0001/26-03); formulário de projeto usado de ponta a ponta.
`next lint` e `npm run build` limpos nos três commits.

⚠️ **Dado de teste deixado no banco** (autorização permanente do Tiago,
17/08): projeto **TESTE-0003/26 · "Teste Alterações"** com os orçamentos
`-01` (rascunho), `-02` e `-03` (aprovados, alíquota 19,53%). Substituem
o caso a caso do TESTE-0002: são a base dos testes das próximas entregas
do plano local e só devem ser removidos quando o plano terminar. O
registro vivo (ids, estágio de cada um, o que cada um reserva) fica na
seção "Registro de testes" do plano local.

## 21. Entrega 19 — Editor multi-jobs: novo no topo, orçado zerado bloqueia, categoria obrigatória (2026-08-17)

**Origem:** plano local de alterações de telas (Grupo B, Tela 1.4), com
as decisões do Tiago de 16/08. Regra do orçado zerado na
[decisão 011](docs/decisions/011-orcado-obrigatorio-para-salvar-e-aprovar.md).

Três alterações independentes:

1. **Orçamento novo aparece no TOPO da lista** (`multi/editor-multi-jobs.tsx`).
   O array `jobs` continua em ordem de criação — é ela que gera os
   códigos (`-01` é sempre o mais antigo) e o payload do salvamento; só a
   renderização inverte, via `jobsExibicao` (par `{ job, indice }` com o
   índice original para `codigoPrevisto`). O card de Totais segue a mesma
   ordem invertida, com o código original por linha. `indiceImportando` e
   o texto do dialog (`codigoPrevisto(jobs.length)`) não mudaram porque
   já usavam o índice/tamanho do array original.
2. **"Salvar orçamentos" bloqueia com R$ unitário ORÇADO zerado** —
   decisão 011. Cliente: `itensComOrcadoZerado` varre jobs → grupos →
   itens e o erro nomeia `orçamento · grupo · item`. Servidor: mesma
   checagem no loop de validação de `salvarOrcamentosDoProjeto`
   (`multi/actions.ts`), no padrão `${rotulo} · ${grupo.nome}: ...`.
   **Planejado zerado salva normalmente.** Escopo: só o editor multi e
   sua action — o agregado ficou de fora de propósito (ver decisão).
3. **Categoria do orçamento de job passou a obrigatória** — vale para
   `/orcamentos/[projetoId]/novo` e para o dialog do editor multi (mesmo
   `orcamento-form.tsx`). `orcamentoSchema.categoria_id` virou
   `z.string().uuid("Selecione a categoria.")` (banco continua nullable
   pelo legado, como os obrigatórios de 06/08); o Select perdeu a opção
   "Sem categoria" e ganhou placeholder "Selecione a categoria" +
   asterisco; `DadosOrcamento.categoria_id` passou de `string | null`
   para `string`. **Consequência assumida:** orçamento antigo sem
   categoria passa a exigir a escolha ao ser editado no drawer.

**Verificação no navegador** (dev server, sessão real, projeto
TESTE-0003/26): ver seção "Registro de testes" do plano local. `next
lint` e `npm run build` limpos.

## 22. Entrega 20 — Tela da versão: grupo automático na v1, Status fora do drawer, aprovação exige orçado (2026-08-17)

**Origem:** plano local de alterações de telas (Grupo B, Tela 1.5).
Regra do orçado na
[decisão 011](docs/decisions/011-orcado-obrigatorio-para-salvar-e-aprovar.md);
o grupo automático é adendo datado na
[decisão 007](docs/decisions/007-nome-da-versao-e-v1-automatica.md).

Três alterações:

1. **A v1 criada junto do orçamento já nasce com o grupo "Novo grupo"**
   (`criarVersaoInicial` em `[projetoId]/actions.ts`): insert em
   `versoes_orcamento_grupos` com ordem 1, mesmo nome default do "Criar
   planilha" do multi. A tela da versão abre com a linha "Novo item"
   pronta. Falha no insert loga e segue (usuário cria o grupo na mão);
   item vazio não é criado. "Nova versão" e "Duplicar versão" intactos.
2. **O drawer "Editar dados da versão" perdeu o campo Status** — o status
   da versão passou a ser 100% do sistema (aprovada → aprovação;
   substituída → cascata; cancelada → `cancelarVersao`). No servidor,
   `extractVersaoPartial` **ignora** `status` vindo do FormData (mesmo
   padrão do `nome`), então bypass do form não altera nada. `criarVersao`
   continua nascendo "rascunho". `VERSAO_STATUS_EDITAVEIS` segue exportado
   em `lib/types.ts` (o `versaoSchema` de `criarVersao` ainda o usa), mas
   nenhuma tela oferece mais o campo.
3. **Aprovar versão bloqueia com R$ unitário orçado zerado** — decisão
   011. `bloqueioAprovacaoVersao` ganhou `qtdItensOrcadoZerado` (mensagem
   única para botão e servidor); `aprovarVersao` conta os zerados numa
   terceira query do mesmo `Promise.all` (`.eq("valor_unitario_orcado",
   0)`); a page passa a contagem ao `FluxoAbertura`, que desabilita o
   botão com o motivo no `title`. **Planejado zerado não bloqueia.** As
   checagens anteriores (alíquota, ≥1 item, ≥1 item com valor)
   permanecem.

**Nota (falso alarme investigado em 16/08):** os honorários do cliente
SÃO gravados corretamente na v1; o que bloqueava aprovação era a alíquota
nascendo em 0% — comportamento correto por decisão 006, mantido como
está. Nenhuma mudança em `lib/impostos.ts` ou na exigência da alíquota.

**Verificação no navegador** (dev server, sessão real, projeto
TESTE-0003/26): alterações 1 e 2 conferidas de ponta a ponta; da
alteração 3, a cadeia de bloqueios foi vista ativa, mas a mensagem
específica do orçado zerado (caso misto: item com valor + item zerado)
ficou para a **etapa final de testes** — decisão do Tiago de 17/08:
a partir do Grupo B, a conferência completa no navegador é consolidada
numa rodada única ao fim do plano de alterações. Detalhes na seção
"Registro de testes" do plano local. `next lint` e `npm run build`
limpos.

## 23. Entrega 21 — Contato de cobrança na abertura do job e "Descritivo do Job" (2026-08-17)

**Origem:** plano local de alterações de telas (Grupo C, Tela 1.6), com as
decisões do Tiago de 17/08. Regra na
[decisão 012](docs/decisions/012-contato-de-cobranca-do-job.md).
**Primeira migration do plano:** `20260817000001_jobs_contatos.sql`.

Três alterações nos dois modais do envio de job
(`enviar-job-modal.tsx` e `confirmar-envio-modal.tsx`):

1. **"Observações" virou "Descritivo"** no formulário e na conferência, e
   **"Descritivo do Job"** nas duas telas do financeiro que leem o mesmo
   dado — `abertura-de-job/conferencia-dialog.tsx` (diálogo de conferência
   da fila) e `financeiro/jobs/[jobId]/page.tsx` (detalhe do job). O
   rótulo unificado nas duas pontas foi decisão do Tiago nesta sessão: era
   o mesmo campo com dois nomes. **A coluna segue `jobs.observacoes`**, e
   com ela o campo do form, o schema Zod e `OBSERVACOES_MAX` — mudou o
   rótulo, não o dado. O comentário defasado na action (que dizia que o
   financeiro ainda não lia o campo) foi corrigido.
2. **Seção "Contato de cobrança"** entre a linha GP/Produtor e o card de
   Fechamento da versão: grid de 3 colunas (Nome · Número · E-mail) +
   lixeira por linha, botão "+ Adicionar contato" abaixo. Nome e e-mail
   obrigatórios, número opcional, ao menos uma linha para enviar. Usa o
   `Campo` e o `Input` já existentes do modal, com o asterisco vermelho
   padrão — nenhum componente ou badge novo. A lixeira desabilita quando
   sobra uma só linha. No modo somente leitura ("Ver dados do job") os
   contatos gravados aparecem travados; job anterior a esta entrega mostra
   "— nenhum contato registrado".
3. **Contatos na conferência**, entre "Valor total" e o Descritivo: nome
   na linha, e-mail (e número, quando houver, separado por " · ") logo
   abaixo em fonte menor e `text-muted-foreground`. Sem chip e sem
   tooltip.

**Banco (mudança aditiva, ciclo do `docs/FLUXO-BANCO.md` completo):** tabela
nova `jobs_contatos` — `tenant_id`, `job_id` (`on delete cascade`), `tipo`
(CHECK `'cobranca' | 'pagamento'`; a aplicação grava só `'cobranca'`),
`nome`, `numero` (nullable), `email`, `ordem`, timestamps com trigger
`set_updated_at`, `created_by`. RLS ligada com as três policies via
`public.is_tenant_member(tenant_id)`, GRANT `select, insert, update` para
`authenticated` e **nada para `anon`**; índices `(job_id, ordem)` e
`(tenant_id)`. Sem GRANT de `delete` de propósito — ver decisão 012.
`JobContato` e `JobContatoTipo` escritos à mão em `lib/types.ts`, no mesmo
commit.

**Onde a obrigatoriedade mora:** `faltamCampos` no modal (destaca a linha
torta e desabilita "Confirmar dados") e `contatos_cobranca` em
`aberturaJobSchema` — regra crítica não vive só no front. Os contatos
viajam como JSON num campo do FormData; `parseContatos` na action faz o
parse e payload ilegível cai na mensagem "Informe ao menos um contato de
cobrança.". O insert é em bulk, depois da cópia da planilha e antes do
`status = 'job_criado'` do orçamento; falha segue o padrão das falhas
parciais ("Job criado, mas os contatos não foram gravados. Avise o
suporte."). O audit de `job.enviado_para_abertura` ganhou
`qtd_contatos_cobranca` — a quantidade, sem nome nem e-mail: dado pessoal
do cliente não precisa ser duplicado no log.

**Leitura sem custo novo:** os contatos do job já enviado entram na
**segunda onda** de queries da página da versão (a que já dependia de
`orcamento.projeto_id`), e só quando existe job — nenhum round-trip a mais
no caminho comum.

**Verificação:** `tsc --noEmit` e `next lint` limpos; migration aplicada e
conferida pelo MCP (colunas, FKs, CHECKs, RLS, policies, GRANT, índices,
trigger, advisors). A conferência no navegador segue consolidada na etapa
final de testes do plano.

---

## 24. Entrega 22 — Categoria do job nos modais de envio (2026-08-19)

**Origem:** pedido do Tiago de 19/08. Regra na
[decisão 019](docs/decisions/019-categoria-do-job.md).

Os **dois** modais do envio ganharam a **Categoria**, sempre entre o
Produto e o par Cidade/Regional. O valor é a categoria do orçamento de
origem — `categorias_dominio`, escopo `orcamento` —, a mesma que o
financeiro recebe pré-selecionada na abertura.

1. **`confirmar-envio-modal.tsx`** ("Tem certeza que quer enviar esse job
   para a abertura?") — linha nova no card de resumo, entre "Produto" e
   "Cidade · Regional".
2. **`enviar-job-modal.tsx`** ("Enviar job para abertura") — campo
   travado, com o apoio "Cadastrada no orçamento.", irmão do Produto.

**A grade do formulário mudou de forma por causa disso.** Produto, Cidade
e Regional dividiam uma linha de 3 colunas; a Categoria tinha de entrar
**entre** o Produto e as outras duas (decisão do Tiago), e Cidade e
Regional não podem se separar — as regionais oferecidas dependem da
cidade. Então Produto e Categoria passaram a ocupar **uma linha cada**,
com dois espaçadores `hidden md:block` fechando cada linha, e Cidade +
Regional descem juntas para a linha seguinte. No mobile a grade já era de
uma coluna e os espaçadores somem.

O dado entra por `HerdadosJob.categoriaNome`, ao lado de produto, GP e
produtor: campo herdado, exibido, não editável nestes modais. Quem o
preenche é a página da versão, que passou a embedar
`categoria:categorias_dominio(nome)` na query do orçamento que **já
existia** — sem round-trip novo.

**Herdado, e sempre do orçamento.** Mesmo com job já enviado (modo "Ver
dados do job"), a linha mostra a categoria do orçamento, não a de
`jobs.categoria_id`: esta tela é a visão da produção, e a do job só passa
a existir depois que o financeiro abre — podendo inclusive ser outra, se
ele trocar.

**Não entrou em `herdadosIncompletos()`:** orçamento antigo sem categoria
não bloqueia o envio, só mostra "— não informada". Categoria é
obrigatória no orçamento desde 17/08, então o caso é residual.

**Verificação:** `tsc --noEmit` e `next lint` limpos. Exercitado no
navegador em TESTE-0003/26-06 · Teste B3 (categoria **Extra**, diferente
das demais do projeto de propósito, para provar que o valor é lido do
orçamento): a linha saiu "Categoria · Extra". Parado antes de "Sim,
enviar job" — conferido pelo MCP que o orçamento segue com 0 jobs.


---

## ⚠️ 21/08/2026 — o BV desconta do planejado, e `A`/`D` perderam o planejado próprio

Handoff de design: `Job - A com Repasse - BV e PP.dc.html`, telas **4a** e
**3b**. Regra completa em `docs/decisions/022-bv-liquido-e-realizado-por-pp.md`.

### `A` e `D` não digitam mais o planejado

Nesses dois tipos o cliente paga o fornecedor diretamente, então a agência
não tem custo próprio a planejar: o custo É o orçado. As três células do
PLANEJADO deixaram de abrir e passaram a espelhar as do ORÇADO — e o Tab
**pula** por cima delas, senão a navegação morreria numa célula que não
abre.

`AR` ficou de fora de propósito: lá o principal passa pela California e há
custo a planejar de verdade.

Quem garante o espelho é o trigger `planejado_espelha_orcado`, no
Postgres, e **não** a Server Action: são seis caminhos de escrita
chegando em `versoes_orcamento_itens` (célula, linha nova, drawer, os dois
pontos da importação, "Salvar orçamentos" do multi e o agregado).
`atualizarCampoItem` ficou só com a recusa, que é o que devolve uma
mensagem em português em vez de um erro de banco.

### A chave Bruto ⇄ Líquido

Uma por página, na barra ao lado de "Recolher todos". Em Líquido o Total
do PLANEJADO mostra o custo sem o BV, com a dedução em sub-linha na célula
e no subtotal do grupo. O ORÇADO não muda.

`GruposSection` e `TotaisCard` passaram a sair de um componente client só
(`PlanilhaVersao`): eles eram irmãos renderizados direto pela página, e o
estado da chave não tinha onde morar. Os editores de rascunho (multi e
agregado) ganharam a mesma chave, uma por página.

### O BV congela na aprovação

`aprovarVersao` grava `bv_liquido_planejado` em cada item. Depois da
aprovação o BV continua editável — mas na planilha do JOB —, e o
planejado **não** pode acompanhar: ele é o compromisso que o financeiro
confere e abre. O valor novo só reaparece no realizado, e só quando
confirmado.

Falhar ao congelar não aborta a aprovação: sem o snapshot a conta cai no
cálculo ao vivo, que dá o mesmo número enquanto ninguém mexer no BV.
Derrubar uma aprovação por isso seria pior que o defeito.

### O formulário do BV

Situação saiu do corpo e virou pílula no canto direito do cabeçalho. O
corpo termina em **Impostos** (alíquota da versão, leitura) e **BV
líquido** — o número que a planilha desconta. O botão **Confirmar** foi
liberado: ele nascia desabilitado por "o módulo de faturamento ainda não
existe", e não é verdade há tempo. Confirmar coloca o BV em
`vw_faturamento_pendente`, e ele aparece na aba Faturamento do contas a
receber com chip de origem **BV**; a baixa do último título o move para
`recebido`. Confirmar É o envio para faturamento — ver decisão 022, §8.

Os mini-blocos passaram a ler `_planilha/blocos.ts`. Eles tinham paleta
própria, com o **PLANEJADO em azul** — herança de antes de 11/08, quando o
azul era dele. O formulário contava outra história que a planilha atrás.

### Verificação

`tsc --noEmit`, `next lint` e `npm run build` limpos.

**Conferência logada no navegador, 21/08/2026** — versão em rascunho
TESTE-0003/26 · Teste B2, com um item `A`:

- as três células do PLANEJADO **não abrem** para edição (`cursor-pointer`
  ausente), enquanto as do ORÇADO abrem normalmente;
- mudar o orçado de R$ 200,00 para R$ 250,00 arrastou o planejado junto —
  na tela e no banco. Revertido para R$ 200,00;
- a chave alterna os rótulos: o ORÇADO segue "Total" e o PLANEJADO vira
  "Total líquido", com o subtotal em "Subtotal do grupo · líquido (− BV)";
- o **editor agregado** do mesmo projeto mostra a chave na barra de cima.
  O editor **multi** nasce sem orçamento nenhum, e aí não há planilha para
  alternar — a chave só aparece com ao menos um card.

O formulário do BV foi conferido pela planilha do JOB-0010, no item
"Sinalização" (BV de R$ 15,00, alíquota 19,54%): pílula **A negociar** no
canto direito do cabeçalho, **Impostos 19,54% · − R$ 2,93**, **BV líquido
R$ 12,07**, e o **Confirmar habilitado**. Os três mini-blocos leem
`blocos.ts` — PLANEJADO em verde `#3f8a70`, o azul que estava lá era do
ORÇADO. Fechado sem salvar.

Zero erros de console e zero rolagem horizontal em todas as telas.


---

## ⚠️ 21/08/2026 — o recolher de grupo virou componente compartilhado

O `GruposSection` mantinha a própria máquina de estado do recolher (um
`Set` de fechados, o `alternarTodos` e o botão). Quando o recurso foi
levado para a planilha do job, a conferência do financeiro e a visão
agregada, ela virou fonte única em
`app/(app)/_planilha/recolher-grupos.tsx` (`useGruposRecolhiveis` +
`BotaoRecolherTodos`), e o orçamento passou a consumi-la.

**Nada mudou no comportamento desta tela** — mesmo botão, mesmo rótulo
alternando, mesmo chevron, mesmo subtotal visível ao recolher. O que
mudou é onde a lógica mora: quatro cópias divergiriam na primeira
correção, como as cores dos blocos já divergiram uma vez.

**Verificação:** conferido logado que a tela da versão não regrediu — 7
linhas de item → 2 ao recolher, rótulo alternando, "ocultos" no contador
e subtotal preservado.


---

## ⚠️ 21/08/2026 — os editores de rascunho ganharam o "Recolher todos"

Ficaram de fora da primeira passada e a conferência pegou: os editores
multi e agregado tinham o **chevron** por grupo, mas não o botão. O
`GrupoRascunhoCard` guardava o `aberto` em estado LOCAL, então nenhum
botão pai conseguia comandá-lo.

O estado subiu para o `JobRascunhoCard`, que é quem conhece todos os
grupos daquele orçamento — e é lá que o botão mora, ao lado de "Novo
grupo". Cada card de orçamento é uma planilha própria (grupos e subtotal
seus), a mesma escolha feita na visão agregada.

**Verificação:** conferido logado no editor multi de TESTE-0003/26,
criando um card de rascunho "Teste Multi" com uma planilha: a chave Bruto
⇄ Líquido aparece assim que existe um card, o "Recolher todos" aparece
assim que existe um grupo, e recolher esconde as linhas mantendo o
subtotal. Descartado com "Cancelar" — conferido pelo MCP que nenhum
orçamento foi gravado.
