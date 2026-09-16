# 085 — A tela principal ocupa a largura do layout

**Data:** 2026-09-16
**Decidido por:** Tiago
**Migration:** nenhuma

Revê a seção "Larguras de layout (padrão)" de
[`docs/09-identidade-visual-ui.md`](../09-identidade-visual-ui.md), que
mandava usar `max-w-7xl` (1280px) em toda tela densa.

---

## 1. O problema

Cada tela escolhia a sua largura, e numa mesma janela umas deixavam muito
vazio nas laterais e outras quase nada. Levantamento de 16/09/2026, com o
teto do layout ainda em `max-w-[1600px]`:

| Largura do conteúdo | Telas |
|---|---|
| 1536px (sem largura própria; o teto é o do layout) | 26 telas: Jobs, Orçamentos, Clientes, Fornecedores, Conciliação, Abertura de job, Relatórios, Home, planilha da versão… |
| 1560px (renderiza 1536) | Contas a Receber, Fluxo de Caixa |
| 1452px | Job (produção), Job e Projeto no financeiro |
| 1370px | Orçamento |
| 1280px | Contas a Pagar (lista, avulsa, recorrente), Desembolsos (lista e detalhe), Projeto em Orçamentos |
| 1024px | Cliente e fornecedor (novo/editar), Cartões de Crédito |
| 768px | Novo orçamento, Novo projeto |

Numa janela de ~1840px, Contas a Pagar ficava com ~256px a mais de vazio
que Jobs. A regra escrita (1280px) já não valia para a maioria das telas, e
as que a seguiam tinham ficado para trás. Mesmo nas telas de 1536px sobravam
~112px de margem de cada lado.

## 2. A regra

> **A tela principal não define largura.** O container dela não leva
> `max-w-*` nem `mx-auto`; quem limita é `app/(app)/layout.tsx`, agora
> `max-w-[1680px]` com `px-8` = **1616px de conteúdo**.

- **Tela principal** é a de trabalho: listagem, detalhe com planilha,
  painel, relatório.
- **Formulários ficam de fora** e continuam estreitos (`max-w-3xl`; os de
  cliente e fornecedor seguem em `max-w-5xl`).
- **O teto do layout é o único número.** Mudar ali alarga todas as telas
  principais de uma vez.
- Largura por tela em px (`max-w-[1452px]`…) fica proibida no container
  de tela principal: um número por tela é um teto que fica para trás
  quando o do layout muda.

### Por que 1680 (e não os 1600 de antes)

- **Os 1600px não tinham justificativa registrada.** Nasceram no primeiro
  commit do projeto (22/07/2026, Task 001), no layout herdado do
  AgCaliforniaRH; nem código nem docs explicam o número.
- **Nada no código dependia do 1600.** As barras fixas no rodapé (encerramento
  do job, faturamento, abertura, agregado) se ajustam pelo padding do layout
  (`-mx-5 md:-mx-8`), não pelo teto.
- **Só muda em janela com mais de ~1756px** (76px da sidebar + 1680). Em
  notebook de 1440px ou 1512px com zoom normal, nada muda.
- Numa janela de ~1840px, a margem lateral cai de ~112px para ~74px de cada
  lado — o "um pouco" que o Tiago pediu. São 80px (5%) a mais de conteúdo, o
  que não chega a criar linha longa demais.
- Efeito colateral aceito: com a sidebar expandida por hover (ela abre POR
  CIMA do conteúdo), ela cobre um pouco mais da tela.

## 3. O que mudou

| Tela | Antes | Depois (janela ≥ ~1756px) |
|---|---|---|
| Teto do layout (`app/(app)/layout.tsx`) | 1600px (1536 de conteúdo) | 1680px (1616 de conteúdo) |
| As 26 telas que já não tinham largura própria | 1536px | 1616px |
| Contas a Pagar (`/financeiro/contas-a-pagar`) | 1280px | 1616px |
| Projeto em Orçamentos (`/orcamentos/[projetoId]`) | 1280px | 1616px |
| Orçamento (`/orcamentos/[projetoId]/[orcId]`) | 1370px | 1616px |
| Job (`/jobs/[jobId]`) | 1452px (com `mr-6` a partir de 1600px) | 1616px, centralizado |
| Job no financeiro (`/financeiro/jobs/[jobId]`) | 1452px (idem) | 1616px, centralizado |
| Projeto no financeiro (`/financeiro/projetos/[projetoId]`) | 1452px (idem) | 1616px, centralizado |
| Contas a Receber, Fluxo de Caixa | 1560px (renderizava 1536) | 1616px |

O `min-[1600px]:mr-6` das três telas de 1452px saiu junto: ele só existia
para deslocar um conteúdo mais estreito que o layout.

## 4. Conferência (16/09/2026)

Navegador com viewport de 1840×1100, dados do `0-0001/26 · Projeto Teste`
(JOB-0029, o projeto financeiro dele e o primeiro orçamento do projeto).

**Com o teto em 1600** (primeira etapa): todas as telas alteradas com
1536px; no Projeto do financeiro, todas as bordas de coluna dos Totais
coincidiam com bordas da planilha.

**Com o teto em 1680:**
- **Contas a Pagar, Jobs, Projeto e Orçamento em Orçamentos, Job, Job e
  Projeto no financeiro, Contas a Receber, Fluxo de Caixa, agregado do
  orçamento e Conciliação:** container com 1616px (74px de margem de cada
  lado), sem rolagem horizontal da página.
- **Títulos a Pagar:** tabela com 1614px e nenhuma célula truncada
  ("PRIME COMUNICACAO E MARKETING" aparece inteiro; em 1280 cortava).
- **Job:** planilha interna com 1498px (era 1418 em 1536); a pílula mais à
  direita da calha termina em 1768px, dentro do padding do layout e da tela.
- **Orçamento:** planilha com 1490px (era 1410); a pílula "Abrir BV" termina
  em 1736px, dentro da página (que vai até 1766px).
- **Projeto no financeiro:** planilha do job (16 colunas) e Totais (15) com
  1614px cada; nenhuma borda de coluna dos Totais fica fora da grade da
  planilha.
- **Fluxo de Caixa:** a matriz (1555px) passou a caber inteira; antes rolava
  21px dentro da caixa.
- **Agregado do orçamento:** a barra fixa do rodapé ocupa os 1680px do
  layout, como deve (`md:-mx-8`).
- **Sem mudança, como esperado:** Novo cliente e Cartões de Crédito
  (1024px) e Desembolsos (1280px), centralizados.
- Sem erro no console. `tsc`, `next lint` e `next build` limpos.

**Em viewport de 1440×900** (notebook, abaixo do teto): Job com 1300px, como
antes; Contas a Pagar com 1300px (era 1280). Planilha interna do job com 1182px, sem rolar dentro
da caixa, e a pílula mais à direita em 1410px, dentro da tela. Títulos a
Pagar com 1298px, sem rolagem.

Os redirecionamentos para `/home` que apareceram no meio da conferência
vieram de `get_session_context` falhando com `fetch failed` (rede até o
Supabase, 9–13s por requisição), não da mudança: a mesma rota abriu
normalmente na tentativa seguinte.

## 5. Pendências (para o Tiago decidir)

- **Cartões de Crédito** (`/financeiro/cadastros/cartoes-credito`, 1024px)
  e **Desembolsos** (`/financeiro/desembolsos`, 1280px): ficaram de fora
  porque são telas da frente do Antonio (todos os commits de Cartões são
  dele; em Desembolsos, 10 de 12).
- **Detalhes de conta avulsa, recorrência e desembolso** (1280px): páginas
  de leitura com pares rótulo/valor; ficaram de fora por decisão, porque
  esticá-las só aumenta o vazio dentro dos cards.
- **`app/(app)/layout.tsx` é arquivo que só o Antonio havia editado**, e o
  teto novo vale também para as telas dele. Vale avisá-lo.
