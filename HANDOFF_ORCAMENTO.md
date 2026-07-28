# Handoff — Versão do orçamento: destaque de versão + edição na planilha

Registro da implementação do design handoff aprovado para o módulo de Orçamentos.

**Data:** 2026-07-27
**Origem do design:** pacote `design_handoff_califa/` (`Versoes - Destaque v4.dc.html` opção 2a, `Orcamento - Edicao Inline.dc.html` opção 3b, `README.md`, `IMPLEMENTACAO.md`). A pasta fica **só na máquina local** — está no `.gitignore` por ser referência de design, não código.

---

## 1. Status

| Entrega | Estado |
|---|---|
| **1 — Destaque da versão mais recente** | ✅ `6738422` |
| **2 — Edição tipo planilha nos itens** | ✅ `cdb2853` |
| **3 — Alinhamento da grade, rentabilidade e card de "Totais"** | ✅ `b2003f7` + `497b8e7` |

`tsc --noEmit` e `next lint` limpos nas três.

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

## 3. Entrega 2 — edição tipo planilha (pendente de commit)

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

## 5. Próximos passos

1. **Testar o modo `readOnly`** quando existir versão `aprovada` — é o único caminho da Entrega 2 sem prova de execução.
2. **Remover os `console.log` de timing** temporários — mantidos a pedido, ver `docs/HANDOFF.md` seção 0 item 2. Estão em `[versaoId]/page.tsx`, `[id]/page.tsx` e `importar-actions.ts`.
3. **Ambiente de desenvolvimento separado no Supabase** — hoje `next dev` escreve em produção (ver seção 4). As migrations em `supabase/migrations/` recriam o schema inteiro.
4. **Fase 2 da edição inline** (fora de escopo agora): alça de arrastar/preencher, seleção de intervalo, copiar/colar de planilha, navegação por teclado entre células, `⌘Z` global.
