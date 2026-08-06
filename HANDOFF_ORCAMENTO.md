# Handoff — Orçamentos: versão, grade de itens e formulário de projeto

Registro da implementação dos design handoffs aprovados para o módulo de Orçamentos.

**Datas:** 2026-07-27 (entregas 1–3) · 2026-07-30 (entregas 4–8) · 2026-07-31 (entrega 9) · 2026-08-03 (entrega 10) · 2026-08-06 (entrega 11)
**Origem do design:**
- Entregas 1–3: pacote `design_handoff_califa/` (`Versoes - Destaque v4.dc.html` opção 2a, `Orcamento - Edicao Inline.dc.html` opção 3b, `README.md`, `IMPLEMENTACAO.md`). A pasta fica **só na máquina local** — está no `.gitignore` por ser referência de design, não código.
- Entregas 4–5, 8 e 9: projeto Claude Design `69342d83-28d9-4bea-a8af-c99e233f5f13` (`Orcamento - Versao -final-.dc.html`, `Novo projeto.dc.html` e `Abertura de Job.dc.html`), lido via MCP `claude_design`. A Entrega 9 é a revisão do mesmo `Abertura de Job.dc.html`, relido depois de atualizado.
- Entregas 6–7: pedidos diretos do time, sem handoff de design.
- Entrega 10: slide "Título do Orçamento" enviado pelo time (2 pedidos anotados sobre print da tela da versão).
- Entrega 11: pedido direto do time sobre prints das quatro telas (lista de projetos, formulário de projeto, orçamentos do projeto, formulário de orçamento). Sem handoff de design — as decisões saíram de perguntas respondidas durante a sessão, registradas na seção 12.

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

`tsc --noEmit` e `next lint` limpos em todas. Entregas 4, 5, 8, 9, 10 e 11
também com `next build` completo. As Entregas 8, 10 e 11 são as únicas com
verificação de ponta a ponta contra o banco real — ver seções 9, 11 e 12.

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

**2026-08-06** · commits `6e6bd77` (campos), `4a227d7` (produto na criação do cliente) e `f664e1f` (produto padrão protegido) · pedido direto do time sobre prints das telas · 6 migrations.

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
2. **Projetos anteriores a esta entrega estão sem produto** e 4 deles sem regional. Aparecem com "—" na lista, e criar orçamento neles esbarra no Regional desabilitado até alguém editar o projeto. Backfill não foi feito por falta de critério de negócio.
3. **Cidade do orçamento usa `Select` simples** com a lista toda. Correto para as 2 cidades de hoje; troque pelo `CidadeCombobox` quando a carga do IBGE entrar.

---

## 13. Próximos passos

1. **Carga completa de cidades do IBGE** — hoje só Salvador e São Paulo. Formato acordado: `Salvador-BA` num campo só, sem coluna `uf`. É só uma migration de INSERT: o schema e a busca já estão prontos (Entrega 8). Fonte: `https://servicosdados.ibge.gov.br/api/v1/localidades/municipios`. Ao carregar, reconciliar as 2 linhas atuais, que estão sem o sufixo de UF, e os jobs que já gravaram `Salvador`/`São Paulo`.
2. **Exibir as observações do job** — `jobs.observacoes` grava desde a Entrega 9 mas nenhuma tela lê. Entra junto com o refino da tela de abertura do financeiro, onde ela faz sentido: é contexto para quem abre. Enquanto isso, o dado é write-only.
3. **Remover a server action `criarJob`**, órfã desde a Entrega 8. Avaliar junto os campos `posicao_hierarquia` e `job_pai_id` do `jobSchema`, que provavelmente ficam sem uso.
4. **Rotacionar o PAT do Supabase.** O `.mcp.json` esteve versionado no commit `69c521d` e foi removido em `65da0b2`; remover do tracking não apaga do histórico. O repositório inteiro, incluindo o arquivo, também foi enviado ao projeto do Claude Design. O token segue legível nos dois lugares.
5. **Ambiente de desenvolvimento separado no Supabase** — hoje `next dev` escreve em produção (ver seção 4). Ficou evidente na Entrega 8: o teste de ponta a ponta criou o JOB-0003 direto na base real. As migrations em `supabase/migrations/` recriam o schema inteiro.
6. **Caminhos não exercitados do fluxo de abertura** — a verificação da Entrega 8 cobriu só o caminho feliz. Faltam: rejeição pelo financeiro, cancelamento de aprovação com job existente, e abertura para cliente sem produto cadastrado (a mensagem existe mas nunca rodou).
7. **Fase 2 da edição inline** (fora de escopo agora): alça de arrastar/preencher, seleção de intervalo, copiar/colar de planilha, navegação por teclado entre células, `⌘Z` global.

**Resolvido desde a última revisão:** o modo `readOnly` da Entrega 2 ganhou prova de execução (v1 do ORC-0003 aprovada, grade travada); os `console.log` de timing temporários saíram no commit `3021cff`; e a criação de projeto de ponta a ponta (item 6 da lista anterior) foi exercitada na Entrega 11 — ver seção 12.8.

**Aberto pela Entrega 11:** ver os três pontos da seção 12.9.
