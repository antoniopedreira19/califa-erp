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
