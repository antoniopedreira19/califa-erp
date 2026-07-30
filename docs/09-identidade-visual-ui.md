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
