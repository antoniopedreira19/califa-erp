# Identidade Visual e UI/UX

## Referência principal

O ERP California deve seguir a mesma identidade visual do projeto:

```text
C:\Projects\AgCaliforniaRH
```

Esse projeto já representa uma linguagem visual aprovada para sistemas internos da Agência California. O ERP deve herdar essa base e adaptá-la ao contexto de gestão de projetos, orçamento e financeiro.

## Arquivos de referência

Antes de implementar frontend, consultar:

- `C:\Projects\AgCaliforniaRH\app\globals.css`
- `C:\Projects\AgCaliforniaRH\tailwind.config.ts`
- `C:\Projects\AgCaliforniaRH\components\sidebar.tsx`
- `C:\Projects\AgCaliforniaRH\app\(auth)\login\page.tsx`
- componentes em `C:\Projects\AgCaliforniaRH\components\ui`

## Tokens visuais

Usar como base:

- vermelho California: `#E74B56`;
- vermelho hover: `#d83e49`;
- vermelho suave: `#fef0f1`;
- fundo claro: `#FAFAFA`;
- texto principal: `#282828`;
- superfície escura/sidebar: `#282828`;
- cards: branco;
- bordas: cinza claro;
- fonte: Inter;
- radius base: `0.75rem`.

## Direção de produto

O ERP é uma ferramenta interna de gestão, não uma landing page.

A interface deve ser:

- profissional;
- clara;
- rápida de escanear;
- densa quando necessário;
- confortável para uso diário;
- consistente com o sistema RH;
- adequada para gestores, financeiro e operação.

## Layout base

Na Task 001, criar:

- tela de login com a mesma linguagem visual do RH;
- layout autenticado;
- sidebar escura;
- menu lateral com ícones lucide-react;
- destaque vermelho no item ativo;
- área principal clara;
- cabeçalho simples para contexto da página;
- estados de loading, vazio e erro.

## Larguras de layout (padrão)

Todo container principal de página usa `mx-auto` + `max-w-*` do Tailwind. Só três larguras são permitidas — mais opções viram inconsistência silenciosa:

| Tipo de página | Classe | Largura | Quando usar |
|----------------|--------|---------|-------------|
| Formulário single-column | `max-w-3xl` | ~768px | Formulários verticais de 1 coluna (novo/editar cliente, fornecedor, projeto, orçamento). Inputs longos demais perdem ergonomia. |
| Detalhe / listagem / planilha | `max-w-7xl` | ~1280px | Detalhe de projeto/orçamento/versão/job, listagens com tabela, planilhas editáveis, layout com grid de 2 cards. Padrão pra qualquer coisa densa. |
| Texto descritivo (dentro de header/empty state) | `max-w-2xl` | ~672px | Parágrafos de subtítulo, descrição de página, empty states — restringe linha longa pra legibilidade. Não é wrapper de página. |

**Regra prática:** se a página tem tabela com 8+ colunas, grid de cards em 2 colunas, ou planilha editável, `max-w-7xl`. Formulário puro (só campos empilhados), `max-w-3xl`.

**Proibido:** `max-w-4xl`, `max-w-5xl`, `max-w-6xl`. Já custaram retrabalho — cada página escolhia a sua, quebrando consistência entre telas.

**Justificativa das 3 opções:**
- `max-w-3xl` (form): duas colunas de campo caberiam mas prejudicam scan vertical; single-column é mais rápido de preencher.
- `max-w-7xl` (denso): cobre a maior planilha atual (`versoes_orcamento_itens` com 13 colunas + `jobs_itens_realizado` com 16) sem scroll horizontal em telas médias (1440px+).
- `max-w-2xl` (texto): manter linha ≤ ~85 caracteres pra legibilidade.

Case study: em 2026-07-30 (Task 008), a tela de job foi de `max-w-5xl` (1024px) pra `max-w-7xl` (1280px) porque a planilha 16-col forçava scroll horizontal desnecessário; simultaneamente as páginas de projeto/orçamento/versão foram alinhadas ao mesmo padrão pra evitar salto de largura ao navegar entre elas.

## Cores das planilhas (blocos de dado)

As planilhas de orçamento e de job são lidas em blocos verticais, não coluna a coluna. **Uma cor por bloco, a mesma em todo o produto** — o leitor aprende a cor uma vez e ela vale da grade de itens ao card de Totais, do orçamento individual à visão agregada.

| Bloco | Cor | Papel |
|---|---|---|
| **ORÇADO** | azul `#1E4FA3` | o que foi vendido ao cliente |
| **PLANEJADO** | verde `#047857` | o que a agência planeja desembolsar |
| **REALIZADO** | laranja `#C2410C` | o que de fato saiu |
| **RENTABILIDADE** | grafite `#282828` | resultado da conta, não um quarto status |

A rentabilidade fica em neutro de propósito: ela não é um bloco de entrada, é o que sobra entre dois outros. O grafite diz isso sem competir com os três. **O valor é sempre grafite, positivo ou negativo** — o sinal já está no número, e verde ali brigaria com o PLANEJADO. Isso vale só dentro de planilha e Totais; os painéis "Resultado operacional" e "Resultado geral" seguem verde/vermelho, porque não são coluna de planilha.

**Fonte única:** `app/(app)/_planilha/blocos.ts`. Cada bloco exporta o conjunto pronto de classes (`faixa`, `cabecalhoAbre/Meio/Fim`, `celulaAbre/Meio/Total/Vazia`, `subtotalVazio/Valor`, `texto`, `textoSuave`, `bordaAbre`).

**Proibido:** escrever hex de bloco direto no JSX. Antes de 2026-08-11 as mesmas cores estavam repetidas em 8 arquivos e **já haviam divergido** entre si — a tela da versão e a agregada usavam tons diferentes para o mesmo bloco.

> ⚠️ **21/08/2026 — o nono arquivo apareceu.** O formulário do BV
> (`app/(app)/_bv/bv-dialog.tsx`) tinha uma paleta própria, com os três
> mini-blocos em hex solto — e com o **PLANEJADO em azul**, herança de
> antes de 11/08, quando o azul era dele. Um usuário via o planejado verde
> na planilha e azul no formulário aberto por cima dela. Passou a ler
> `blocos.ts` como todo o resto. É o caso de teste da regra acima: divergir
> não exige má-fé, só um arquivo que ninguém revisitou.

## A chave Bruto ⇄ Líquido (− BV)

Desde 21/08/2026 as planilhas têm **duas leituras** dos mesmos números: em
**Bruto** (padrão) o custo aparece cheio; em **Líquido** o BV do item é
descontado do PLANEJADO e do REALIZADO. Regra de negócio em
`docs/decisions/022-bv-liquido-e-realizado-por-pp.md`; aqui ficam as
regras visuais.

- **Uma chave por PÁGINA**, nunca por grupo ou por card. Dois grupos em
  modos diferentes na mesma tela dariam um Totais que não bate com
  nenhum deles. Componente: `app/(app)/_planilha/chave-bruto-liquido.tsx`.
- **Mesma pastilha** do seletor Planejada/Realizada do painel Resultado —
  duas chaves com formas diferentes na mesma tela seriam duas gramáticas
  para a mesma ideia.
- **O ORÇADO nunca muda** entre os modos: ele não recebe BV.
- Na vista Líquido, o Total ganha uma **sub-linha** `BV −1.050,00`, na
  cor do bloco a que pertence (verde no PLANEJADO, laranja no REALIZADO).
  Ela aparece na célula do item **e no subtotal do grupo**, ali somando os
  BVs de todos os itens. É ela que torna a dedução auditável sem abrir o
  formulário — e é o motivo de o design 3b ter descartado tooltip: tooltip
  não sobrevive a tablet, impressão nem export.
- O **painel Resultado não segue a chave**: lá o BV virou linha própria
  ("+ BVs"), então o número é o mesmo nos dois modos.

## Grades compartilhadas (planilha × Totais)

**Regra:** a planilha e o card de Totais da mesma tela usam o MESMO `colgroup`, com `table-fixed`. As colunas Total / Rentab. / % do rodapé têm que cair exatamente sob as mesmas colunas dos cards de grupo acima — senão o leitor perde a coluna ao descer a página.

São três grades, uma por formato de tela:

| Módulo | Colunas | Arquivo |
|---|---|---|
| Orçamento (versão, grupo e agregada) | 13 | `app/(app)/_planilha/grade-orcamento.tsx` |
| Job — planilha interna | 15 | `app/(app)/_planilha/grade-job.tsx` |
| Job — visão agregada do projeto | 15 | `app/(app)/_planilha/grade-jobs-projeto.tsx` |

**⚠️ Blocos ocultáveis (03/09/2026, decisão 042).** Na planilha da
**versão do orçamento**, o menu "Exibir" esconde os blocos **Orçado** e
**Rentabilidade** — PLANEJADO nunca sai. Quem esconde um bloco passa as
MESMAS flags (`ColunasVisiveis`) para tudo que divide a grade na mesma
tela; `totalDeColunas()` e `colunasDoRotulo()` são a fonte única dos
`colSpan`, e nunca literais. Um bloco escondido sai de **todas** as
linhas: faixa, sub-cabeçalho, linha de grupo, linha de item, linha nova
e `tfoot` — e as colunas de entrada dele saem também da ordem do Tab.

**A largura liberada volta para os blocos, não para o Item.** Os três
blocos somam 72% da tabela; ao esconder um, os 72% são redistribuídos
entre os que ficaram, na mesma proporção (sem Orçado: Planejado
16,5 · 5,5 · 5,5 · 18 e Rentab. 19 · 7). Sem isso os 28% do bloco
escondido cairiam no Item, que absorve a sobra, e a planilha ficaria com
um paredão de branco à esquerda e as colunas de moeda no mesmo lugar. As
larguras são classes **literais**, uma combinação por vez — o Tailwind
varre o fonte, e `w-[${x}%]` não existiria no CSS.

**⚠️ Na planilha do job (03/09/2026, decisão 045)** o menu esconde o
**Orçado** e liga duas colunas de rentabilidade **dentro** do PLANEJADO
e do REALIZADO (Rentab. R$ · Rentab. %, as últimas do bloco — a faixa
passa a cobrir 6). Planejado e Realizado nunca saem. A grade
(`grade-job.tsx`) vai de 15 a 20 colunas: as larguras são os percentuais
de sempre como **pesos** renormalizados para a mesma soma, em `style`
(16 combinações não cabem em classes literais), e o piso de largura
cresce por par de rentabilidade. Com as colunas desligadas a planilha é
bit a bit a de antes, "rentab." no vão incluído; ligada uma delas, o
"rentab." daquele bloco sai do vão. A **visão agregada de jobs** ficou
de fora: lá o card de Totais divide o `colgroup` com os blocos.

**A coluna Rentab. R$ do orçamento tem 11,5%**, e não a mesma largura das outras colunas de moeda: ela é a única da planilha que carrega sinal negativo, e `-R$ 117.500,00` a 13px pede ~122px. O espaço saiu do `%` ao lado, que nunca passa de `-99,9%` (24/08/2026). Em `table-fixed` o número que não cabe **transborda por cima da coluna vizinha** — não encolhe, não quebra.

**Proibido:** layout automático (tabela sem `table-fixed`/`colgroup`) em planilha ou Totais. Com larguras automáticas cada tabela se dimensiona pelo próprio conteúdo — duas tabelas com conteúdos diferentes nunca alinham, e o alinhamento não tem como se sustentar.

**Cuidado com aninhamento:** não basta a grade ser igual, os contêineres precisam ter a mesma largura. Na agregada de orçamento os cards de grupo vivem dentro do card do orçamento; foi preciso zerar o padding lateral desse painel (`py-5` + `mx-5` no resto) e subir a calha `pr-[154px]` para um wrapper que envolve orçamentos **e** Totais. É o mesmo arranjo que a tela da versão individual já usava.

**Case study** (2026-08-24): o handoff "Planilha Interna - Grupos Unificados" dava ao card de Totais um `colgroup` PRÓPRIO — 7 colunas no orçamento, 8 no job — em que as colunas Total não caíam sob as da planilha acima. Recusado: mantida a grade compartilhada. A consequência é que, no Totais, a rentabilidade também mora no vão do bloco em vez de ganhar colunas próprias — mesma leitura da planilha, e o eixo vertical se sustenta.

**Case study** (2026-08-11): a visão agregada de jobs tinha sido deliberadamente posta em layout automático (04/08) para casar proporções com um mock. Era justamente o que deixava as colunas dos Totais desalinhadas das da planilha. Trocada por `table-fixed` + colgroup compartilhado; medido no navegador, os blocos numéricos ficaram com ~356px cada em viewport de 1660px — não encolheram. No mesmo dia, a agregada de orçamento ganhou o bloco RENTABILIDADE, que existia nos cards de grupo mas faltava no Totais.

## Célula selecionada e rodapé de navegação

**Regra (03/09/2026, decisão 046):** toda planilha de itens tem uma
**célula selecionada**, distinta da célula aberta. Ela ganha a mesma
moldura arredondada do campo em edição — 6px de raio, borda vermelha
California, anel suave de 3px (`SELECAO.moldura` em
`app/(app)/_planilha/blocos.ts`). Nada mais é destacado: nem a linha,
nem o cabeçalho.

A moldura vai no **conteúdo** da célula (`<Miolo>`), não no `<td>`: em
tabela `border-collapse` o raio da célula é ignorado, e é o raio que
faz a moldura ser a mesma do campo. As margens negativas da moldura
comem parte do padding da célula para ela ficar colada no número.

A **linha de dicas de tecla** (`DicasDeTeclado`, em
`_planilha/selecao.tsx`) fica **fora do card**, logo abaixo dele
(pedido do Tiago em 25/08 e 03/09/2026: dentro do frame ela lia como
mais uma linha da planilha). O rodapé do design com endereço, valor e
modo da célula não entrou — a moldura já diz qual célula está
selecionada. Fonte única das classes: `SELECAO`. **Nunca escrever
direto no JSX.**

## Linha do agrupamento (tabela única)

**Regra (24/08/2026, decisão 024):** a planilha inteira é **uma tabela só** — um card, um `<thead>`, uma calha de números. Não existe mais card por agrupamento.

O agrupamento é **uma linha de 40px** do `<tbody>`:

| Onde | O quê |
|---|---|
| `colSpan={3}` à esquerda (`LINHA_GRUPO_NOME`) | chevron · nome · lápis de renomear · contador de itens |
| vão de cada bloco (`grupoVazio`) | vazio no ORÇADO; **rentabilidade** no PLANEJADO e no REALIZADO |
| coluna Total de cada bloco (`grupoValor`) | o subtotal do agrupamento |

A tabela fecha com o **total da planilha** no `<tfoot>` (`LINHA_TOTAL_ROTULO` + `subtotalVazio`/`subtotalValor`), e o corpo termina numa **linha tracejada de "Novo grupo"** — depois do último grupo, antes do total, que é onde o grupo novo vai nascer.

**A rentabilidade não abre sublinha.** Ela mora no vão vazio do próprio bloco, à esquerda do total, por `app/(app)/_planilha/rentabilidade-inline.tsx`. Empilhada (rótulo em cima, número embaixo): em linha ela mede ~155px num vão de ~157px e transborda por cima do total ao lado, porque `table-fixed` não deixa a célula crescer. No ORÇADO ela não existe — ele é a base da comparação.

**Fonte única das classes:** `app/(app)/_planilha/blocos.ts` (`LINHA_GRUPO_NOME`, `LINHA_TOTAL_ROTULO`, `LINHA_NOVO_GRUPO`, `BOTAO_NOVO_GRUPO`, e `grupoVazio`/`grupoValor` em cada bloco). Mesma regra das cores: **nunca escrever direto no JSX**.

**Ações do grupo:** lápis de renomear **na linha**, ao lado do nome; lixeira **na calha**, na altura da linha do grupo, com uma vaga vazia da largura do BV antes dela para cair no mesmo eixo das lixeiras de item.

## Navegação por teclado nas planilhas

A grade editável do orçamento se comporta como planilha: **Tab anda na horizontal, Enter desce, as setas andam nas duas direções, Esc desfaz.** Tab na última coluna editável desce para a **primeira coluna da linha seguinte**, e cai na linha "Novo item" quando ela existe — dá para preencher um grupo inteiro sem tocar no mouse.

**A sequência atravessa os agrupamentos** (24/08/2026, decisão 024): com a planilha numa tabela só, o Tab que sai do último item de um grupo cai no primeiro do grupo seguinte. **Grupo recolhido é pulado** — ele não tem linha na tela, então fica fora da lista de linhas navegáveis. Antes disso cada grupo era uma tabela própria e a navegação morria no fim dele.

A sequência é declarada em `CAMPOS_NAVEGAVEIS` em cada grade, e a regra de "qual é a próxima" é compartilhada em `app/(app)/_planilha/navegacao.ts`. **Coluna calculada não entra na lista** — Total e Rentabilidade não são navegáveis, e o Tab passa por cima delas sem precisar saber que existem.

Três regras que não são óbvias e já custaram retrabalho:

1. **← e → só saem da célula na borda do texto** (cursor na primeira ou na última posição, sem seleção). No meio do texto elas continuam movendo o cursor, senão seria impossível corrigir uma descrição sem redigitá-la. ↑ e ↓ sempre navegam: o campo tem uma linha só.
2. **Coluna de escolha (`<select>`) navega só por Tab** — as setas são do dropdown, que precisa delas para percorrer as opções. Escolher um valor **avança** para a próxima célula quando se chegou ali pelo teclado, e **encerra** a edição quando se chegou pelo clique. É o que o `porTeclado` da célula ativa registra.
3. **Estado de célula mora no pai, nunca dentro da célula.** Nos editores de rascunho (multi-jobs e agregado) toda escrita reconstrói a árvore de componentes: `useState` dentro da célula não sobrevive ao rebuild. Uma tentativa de guardar ali a abertura do dropdown deixou a lista presa aberta depois de escolher.

Valor recusado (texto não numérico, número negativo) **interrompe a navegação** de propósito: seguir em frente esconderia o aviso atrás da próxima célula.

## Calha de ações (fora da tabela)

As ações de linha das planilhas — BV, Pedido de Produção, remover — vivem numa calha **fora** do frame da tabela, posicionada em `absolute left-full`.

**Cada pílula é presa à posição MEDIDA da linha que acompanha** (24/08/2026): a `<tr>` se marca com `data-calha="<chave>"` e `app/(app)/_planilha/calha.tsx` lê `getBoundingClientRect` dela. Antes bastava saber onde o `<tbody>` começava e empilhar caixas de altura fixa (`railTop`), porque toda linha media o mesmo. Com a tabela única não medem: linha de grupo tem 40px, de item 28, de "Novo item" 30, e o PLANEJADO na vista Líquido cresce mais um degrau por causa da sub-linha do BV. **Altura chutada acumula erro** — no terceiro agrupamento a lixeira já aponta para a linha errada.

**A tabela nunca cede espaço para a calha.** Quem abre espaço é a página, com um `pr-` do tamanho exato da calha — `pr-[116px]` no job, `pr-[154px]` no orçamento (calha + lixeira + respiro). Toda a largura da tabela continua sendo dado.

A consequência prática: **ação nova numa linha não pode alargar a calha**. Se não couber, a saída é reorganizar dentro da largura que já existe, não empurrar a tabela. Foi o que aconteceu em 13/08/2026, quando o `A · Repasse` passou a ter BV **e** PP na mesma linha: em vez de coluna nova ou calha mais larga, a pílula **se divide em duas metades** dentro da mesma moldura, separadas por um fio de 1px, com o rótulo encurtado para a sigla e o texto completo no tooltip. A dividida mede ~100px contra os 111px de "Adicionar BV" — mais estreita que a pílula mais larga que já existia.

Fonte única da pílula (as duas formas, e a largura da calha): `app/(app)/_planilha/calha-acoes.tsx`. **Nunca escrever a pílula direto no JSX de uma tela** — é o mesmo erro que as cores de bloco cometeram em 8 arquivos.

## Header padrão da página

Toda página do app (`app/(app)/**`) começa com um `<header>` que tem sempre 3 elementos: **kicker** (ou breadcrumb) → **ícone + título** → **descrição**. O ícone fica num quadrado arredondado com fundo `bg-california-red/10` — dá reconhecimento visual imediato à seção, matching a sidebar.

**Padrão canônico** (usado em `/financeiro`, `/home`, `/cadastros`, `/orcamentos`, `/jobs`, `/admin`):

```tsx
<header className="space-y-2">
  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
    {KICKER}
  </p>
  <div className="flex items-center gap-3">
    <div className="rounded-lg bg-california-red/10 p-2">
      <ICON className="h-5 w-5 text-california-red" />
    </div>
    <h1 className="text-3xl font-bold tracking-tight">{TITULO}</h1>
  </div>
  <p className="text-sm text-muted-foreground max-w-2xl">
    {DESCRICAO}
  </p>
</header>
```

**Regras por tipo de página:**

| Tipo | Padrão | Kicker/breadcrumb | Icon+title | Descrição |
|------|--------|-------------------|------------|-----------|
| Top-level (rota direta da sidebar) | Kicker + icon + title | Kicker (ex: "Comercial", "Operacao", "Financeiro") | ✅ | ✅ curta |
| Sub-page (rota abaixo de hub) | Breadcrumb + icon + title | Breadcrumb com `Cadastros › X` | ✅ | ✅ curta |
| Detalhe (entidade específica) | Breadcrumb `← Voltar` + código + nome + badge | `← Voltar para {contexto}` | ❌ | opcional |
| Formulário `novo`/`editar` | Breadcrumb `← Voltar` + título simples | `← Voltar para {lista}` | ❌ | opcional |

**Escolha do ícone:** usar o MESMO ícone que aparece na sidebar (top-level) ou no card do hub (sub-pages). Consistência sidebar↔header é o que dá o "sentido de lugar" ao usuário.

Mapa atual:
- `/home` → `Home`
- `/cadastros` → `FolderKanban` · `/clientes` → `Users` · `/fornecedores` → `Building2` · `/categorias` → `Tag` · `/cadastros/regionais` → `MapPin` · `/cadastros/categorias-dominio` → `Layers`
- `/orcamentos` → `FileText`
- `/jobs` → `Briefcase`
- `/financeiro` → `Landmark` · `/financeiro/jobs-aguardando-abertura` → `Clock`
- `/admin` → `ShieldCheck` · `/admin/usuarios` → `Users`

**Case study** (2026-07-30): 8 páginas top-level e sub-hub estavam com kicker/breadcrumb + título sem ícone, quebrando o reconhecimento visual. Padronizado em massa; `/financeiro` que já tinha o padrão virou referência.

## Componentes

Usar shadcn/ui como base e adaptar ao padrão visual do RH:

- botões arredondados;
- inputs com foco vermelho suave;
- badges de status;
- tabelas limpas;
- cards simples;
- dialogs/modals consistentes;
- tooltips quando necessário;
- ícones lucide-react em ações.

## Restrições

- Não criar uma identidade visual nova.
- Não usar paleta diferente da California sem validação.
- Não criar hero/landing page para telas internas.
- Não exagerar em gradientes ou elementos decorativos.
- Não priorizar aparência de marketing em telas operacionais.
- Não quebrar a consistência com `AgCaliforniaRH`.

## Aplicação por task

- Task 001 define tema, login, layout interno e componentes base.
- Task 002 aplica o padrão em cadastros e tabelas.
- Task 003 aplica o padrão em orçamentos e listagens.
- Task 004 aplica o padrão no editor/importador/exportador de versões.
- Task 005 aplica o padrão na criação do job.


## Recolher agrupamento (todas as planilhas)

Toda planilha com agrupamentos recolhe, e recolhe **do mesmo jeito** —
gesto aprendido uma vez, válido em qualquer tela:

- **chevron** de 24px no cabeçalho do grupo, girando −90° quando fechado;
- **"Recolher todos" / "Expandir todos"** no topo da planilha, com o
  rótulo seguindo o estado (basta um grupo aberto para o botão oferecer
  fechar tudo);
- o contador da calha vira **"N itens ocultos"**.

**O que fica visível ao recolher:** a **linha do agrupamento** inteira —
nome, subtotal e rentabilidade. São o dado que justifica recolher —
esconder tudo transformaria o gesto em "sumir com o grupo". O que some são
as linhas de item, o "Novo item" e as ações de item na calha.

**Fonte única:** `app/(app)/_planilha/recolher-grupos.tsx` —
`useGruposRecolhiveis` (a máquina de estado) e `BotaoRecolherTodos`. Ela
guarda quem está **fechado**, não quem está aberto: grupo novo nasce
aberto sem precisar de sincronização quando a lista muda. Sem
persistência — recarregar volta ao padrão.

O padrão é `"aberto"` em toda planilha, com **uma exceção**: os grupos
dentro dos blocos de job da visão agregada nascem `"fechado"`, porque lá
a página é uma lista de N jobs e abrir tudo enterraria o consolidado.

**Proibido:** recriar o `Set` de fechados na tela. Até 21/08/2026 só o
orçamento tinha o recurso; ao levá-lo para as outras três planilhas, a
alternativa era quatro cópias da mesma máquina de estado — que divergem
na primeira correção, exatamente como as cores dos blocos divergiram.
