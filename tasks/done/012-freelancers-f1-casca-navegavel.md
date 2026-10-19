# Task 012 — Freelancers (Fase 1, Task 2): casca navegável do módulo

## Objetivo

Entregar a **casca navegável** do módulo Freelancers. Nada de dados reais, nada de forms, nada de queries. Só o esqueleto:

1. Entrada **"Freelancers"** no sidebar global (uma única entrada).
2. Permissão `sidebar.freelancers` em `lib/permissoes.ts`.
3. Layout do módulo com **sub-navegação em 3 abas**: Dashboard · Solicitações · Freelancers.
4. 3 páginas stub, cada uma com `PageHeader` próprio e placeholder "em construção".
5. Guarda de permissão no `layout.tsx` do módulo (role check antes de renderizar).

A ideia é poder clicar em "Freelancers" na sidebar, ver o módulo, navegar entre as 3 abas, e ver que cada uma renderiza o próprio placeholder — tudo sem quebrar o build.

## Fora de escopo

- Conteúdo real das abas (hero, cards, tabelas, chips de filtro) — Tasks 013+.
- Páginas internas (`/freelancers/novo`, `/freelancers/[id]`, `/freelancers/contratos/*`) — Task 013.
- Dialog de "Gerenciar cargos" dentro da aba Freelancers — Task 013.
- Formulários — Task 013+.
- Pickers (job, responsável) — Task 014+.

## Decisões travadas (alinhadas 16/10/2026)

- **Uma entrada só no sidebar global.** Nome: "Freelancers". Ícone: `UserCheck` (lucide). Não poluir sidebar com Solicitações, Responsáveis, Cargos separados.
- **Sub-nav do módulo é tabs horizontais com underline na ativa** (não as `Tabs` do shadcn com fundo cinza — ficam parecendo "control bar" pequeno demais pra sub-navegação de módulo inteiro). Componente novo em `app/(app)/freelancers/_components/sub-nav.tsx`.
- **Ordem das abas:** Dashboard (default) · Solicitações · Freelancers.
- **URL default** `/freelancers` cai no Dashboard. Não há redirect pra `/freelancers/dashboard`; a página raiz **é** o Dashboard.
- **Responsáveis não é página** (confirmado): os responsáveis dos contratos serão usuários do califa-erp (via `tenant_members`). Visão de "performance por responsável" vai dentro do Dashboard, não vira aba.
- **Cargos não é página** (confirmado): gerenciamento de cargos vira botão/dialog **dentro da aba Freelancers** (Task 013). Nesta Task 012 só reservo o espaço no spec.
- **Permissão**: `sidebar.freelancers` = `["administrador", "rh", "financeiro", "gerente_producao", "produtor"]`. Freelancer (role) não entra — ele usa link público quando for a vez dele (Fase 3). Colaborador também não entra (só tem acesso a `/perfil`).

## Contexto do ponto de partida

### Já pronto

- Tabelas `freelancers` e `freelancer_cargos` existem no banco (Task 011).
- Tipos `Freelancer`, `FreelancerCargo` em `lib/types.ts`.
- Padrões do califa-erp: `PageHeader`, `requireSession()`, matriz `permissoes`, `sidebar.tsx` colapsável com hover.

### Padrões a seguir

- Sidebar entry igual aos outros itens: `{ href, label, icon, permissao }`.
- Layout do módulo = server component, chama `requireSession()`, verifica permissão com `pode(role, "sidebar.freelancers")`, redireciona pra `/home?reason=sem_permissao` se não tiver.
- `PageHeader` em cada página (eyebrow, title, icon, description).
- `force-dynamic` em toda page autenticada (freio de prefetch — `docs/PERFORMANCE.md`).

### Design do sub-nav

Tabs horizontais que ocupam a largura do conteúdo, com:
- Fundo transparente (não é um pill no bg-muted).
- Cada aba = texto + ícone (lucide) à esquerda.
- Aba ativa = **underline vermelho `california-red` + texto `foreground`**.
- Aba inativa = **texto `muted-foreground` + hover `foreground`**.
- Divisor horizontal (`border-b`) atravessa toda a largura abaixo da sub-nav.

Esse padrão combina com o resto do califa-erp (que já usa headers com divisores) e é mais afirmativo pra navegação permanente do módulo.

## Escopo (o que a task entrega)

### 1. Arquivos novos

```
app/(app)/freelancers/
├── layout.tsx                         # Server component: valida sessão + permissão
├── page.tsx                           # Dashboard stub (default)
├── loading.tsx                        # Skeleton leve
├── solicitacoes/
│   ├── page.tsx                       # Stub
│   └── loading.tsx
├── lista/
│   ├── page.tsx                       # Stub
│   └── loading.tsx
└── _components/
    └── sub-nav.tsx                    # Client component (usa usePathname)
```

### 2. Arquivos modificados

- `components/sidebar.tsx` — nova entrada "Freelancers" entre "RH" e "Relatórios" (ou onde ficar mais confortável visualmente).
- `lib/permissoes.ts` — adicionar `"sidebar.freelancers"`.

### 3. Guarda do layout

```tsx
// app/(app)/freelancers/layout.tsx
const session = await requireSession();
if (!pode(session.activeRole, "sidebar.freelancers")) {
  redirect("/home?reason=sem_permissao_freelancers");
}
```

### 4. Página stub padrão

Cada uma das 3 páginas (Dashboard, Solicitações, Lista) renderiza:
- `PageHeader` apropriado (eyebrow "Freelancers", title da aba, ícone contextual).
- Placeholder "Em construção" com descrição do que vem na próxima task.

### 5. Sub-nav

Componente client que lê `usePathname()` e marca a aba ativa. 3 itens:

| Rótulo | Href | Ícone | Match ativo |
|---|---|---|---|
| Dashboard | `/freelancers` | `LayoutDashboard` | pathname === `/freelancers` (exato) |
| Solicitações | `/freelancers/solicitacoes` | `ClipboardList` | startsWith `/freelancers/solicitacoes` |
| Freelancers | `/freelancers/lista` | `Users` | startsWith `/freelancers/lista` (depois também as rotas de perfil/contrato) |

Observação: na Task 013, as rotas `/freelancers/novo`, `/freelancers/[id]` e `/freelancers/contratos/*` também vão acender a aba "Freelancers". Isso é feito na próxima task (adicionando mais prefixos de match). Aqui começamos simples.

## Critérios de pronto

- [ ] Pasta `app/(app)/freelancers/` criada com os 7 arquivos listados.
- [ ] `components/sidebar.tsx` com entrada nova "Freelancers".
- [ ] `lib/permissoes.ts` com `sidebar.freelancers` incluído.
- [ ] Login como `rh` (ou `administrador`) → vejo "Freelancers" na sidebar.
- [ ] Clico em "Freelancers" → caio no Dashboard (`/freelancers`).
- [ ] As 3 abas aparecem no topo, Dashboard destacada.
- [ ] Clico em "Solicitações" → URL vira `/freelancers/solicitacoes`, aba "Solicitações" destacada.
- [ ] Clico em "Freelancers" → URL vira `/freelancers/lista`, aba "Freelancers" destacada.
- [ ] Login como `freelancer` ou `colaborador` → entrada "Freelancers" **não aparece** na sidebar.
- [ ] Login como `gerente_producao` ou `produtor` → entrada aparece.
- [ ] Acesso direto por URL `/freelancers/*` com role sem permissão → redireciona pra `/home`.
- [ ] `npm run typecheck` passa.
- [ ] `npm run lint` passa (sem warnings novos).

## Próxima task (013)

Preencher a aba **Freelancers**:
- Página de lista com busca, filtros (chips), tabela densa.
- Botão "Novo freelancer" → `/freelancers/novo`.
- Botão "Gerenciar cargos" → dialog com CRUD do catálogo.
- Página `/freelancers/novo` com formulário completo (pessoa + 1º contrato — espera a Task 2.1 do banco).

A Task 013 é a primeira a tocar em dados reais do banco pela UI.
