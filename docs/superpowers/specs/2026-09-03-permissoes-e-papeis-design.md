# Permissões e Papéis do ERP California — Design

**Data:** 2026-09-03
**Motivação:** reunião com a California definiu os 5 papéis operacionais e a matriz do que cada um vê/faz. Precisamos materializar essa matriz no sistema como fonte-verdade única, aplicar os gates faltantes (código, RLS) e preparar terreno pra uma home diferenciada por papel.

---

## 1. Contexto

O ERP nasceu com 3 papéis (`administrador`, `gestao_projetos`, `financeiro`), mas apenas o Administrador estava efetivamente cadastrado (19/19 profiles). A role `gestao_projetos` era fantasma — sem menu próprio, sem restrição própria — e os gates de permissão estavam espalhados: sidebar tinha `roles: AppRole[]` hardcoded, algumas server actions checavam role ad-hoc via helper próprio (`checarGateFinanceiro`), muitas outras só chamavam `requireSession()` e ficavam abertas. A tela `/admin/usuarios` já convidava usuários, mas não havia forma consistente de dizer "esse papel pode isso".

Este projeto materializa a matriz de permissões da California numa **fonte-verdade única** que passa a alimentar simultaneamente: sidebar, gates de server action, políticas RLS e (no futuro) uma tela de administração que renderiza a matriz.

**Fora de escopo (fase 2):**

- Fluxo novo de aprovação do consumo de Save pelo Financeiro (reunião pediu, mas hoje é auto-aprovado — mudança de fluxo, spec própria).
- Trava de aprovação de PP por estouro de planejado (GP) ou de orçado (diretor).
- Refinamento do gate de errata (revisão do Financeiro).
- Chat com envio filtrado por área (`producao` vs `financeiro`).
- RH e Mídia como módulos e como papéis (`rh`, `midia`).
- Financeiro parcial vs completo.
- Nova home por papel (sessão separada).

---

## 2. Papéis definidos

| Chave no enum | Rótulo (pt-BR) | Descrição curta |
|---|---|---|
| `administrador` | Administrador | Sócio/diretor. Faz tudo, gerencia usuários, empresas, auditoria. Superset de todas as outras roles. |
| `gerente_producao` | Gerente de Produção | Dono comercial/operacional do trabalho. Fala com cliente, aprova orçamento, aprova envio a faturamento e encerramento. Antigo `gestao_projetos`, renomeado. |
| `produtor` | Produtor | Braço direito do GP. Faz tudo em orçamento e job **menos aprovar**. |
| `freelancer` | Freelancer | Escopo restrito: só vê projetos onde é participante. Vê orçamento em modo espectador do bruto (sem BV, sem totais, sem save). Edita apenas o realizado dos jobs dele. |
| `financeiro` | Financeiro | Controla o caixa: contas a pagar/receber, conciliação, fluxo, desembolsos, abertura de job (transformar orçamento aprovado em previsto financeiro). Cadastra bancos, plano de contas, cartões. **Read-only em orçamento e job.** |

**Fora deste enum (fase 2):** `rh`, `midia`, e possível split `financeiro_operacional` / `financeiro_aprovador`.

---

## 3. Matriz de permissões

Legenda: **V** = ver · **E** = editar/criar · **A** = aprovar ou ação crítica · **—** = nada · **RO** = read-only na UI (vê mas nenhuma ação disponível)

### 3.1 Sidebar

| Item | ADM | GP | PROD | FREE | FIN |
|---|:---:|:---:|:---:|:---:|:---:|
| Home | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cadastros (clientes, fornecedores, empresas, config) | ✓ | — | — | — | ✓ |
| Orçamentos | ✓ | ✓ | ✓ | ✓† | ✓ RO |
| Jobs | ✓ | ✓ | ✓ | ✓† | ✓ RO |
| Financeiro (contas, conciliação, abertura de job) | ✓ | — | — | — | ✓ |
| Desembolsos | ✓ | ✓ | ✓ | — | ✓ |
| Relatórios | ✓ | — | — | — | ✓ |
| Administração | ✓ | — | — | — | — |

† Freelancer vê filtrado a projetos onde é participante (via `projeto_responsaveis`).

### 3.2 Chave "Meus/Todos" nas listas de Projetos, Orçamentos e Jobs

| Papel | Vê o toggle? | Default | Alcance quando marca "Todos" |
|---|:---:|:---:|:---|
| ADM | ✓ | Meus | Todos os projetos do tenant |
| GP | ✓ | Meus | Todos os projetos do tenant |
| Produtor | ✓ | Meus | Todos os projetos do tenant |
| Financeiro | ✓ | Meus | Todos os projetos do tenant |
| Freelancer | — | Forçado "Meus" | (irrelevante — não vê toggle) |

**Definição atual de "Meus" (jobs):** `jobs.responsavel_id = usuario`.
**Definição atual de "Meus" (projetos):** usuário é `gp` em `projeto_responsaveis` OU produtor de algum orçamento do projeto.

**Definição expandida** (necessária pro Freelancer funcionar, ganho colateral pros outros): **qualquer entrada em `projeto_responsaveis` (papel `gp` OU `equipe`) OU derivados (criador do projeto, produtor de algum orçamento).** Um Produtor adicionado como equipe manual de um projeto onde ele não conduz nenhum orçamento passa a ver esse projeto no "Meus" dele — comportamento correto.

### 3.3 Ações

| Ação | ADM | GP | PROD | FREE | FIN |
|---|:---:|:---:|:---:|:---:|:---:|
| **Cadastros globais** | | | | | |
| Clientes, fornecedores (via tela `/fornecedores`), empresas | E | — | — | — | — |
| Fornecedor via "cadastro inline" (dentro de PP) | E | E | E | — | — |
| Portal do cliente via "cadastro inline" (dentro do envio para faturamento — decisão 050) | E | E | — | — | — |
| Contas bancárias, plano de contas, cartões | E | — | — | — | E |
| Categorias de orçamento, regionais, cidades | E | — | — | — | — |
| Usuários e permissões | E | — | — | — | — |
| Auditoria | V | — | — | — | — |
| **Orçamento** | | | | | |
| Ver orçamento (bruto completo) | V | V | V | — | V |
| Ver orçamento (bruto restrito — sem BV/totais/save) | — | — | — | V† | — |
| Criar projeto/orçamento | E | E | E | — | — |
| Duplicar/exportar orçamento | E | E | E | — | — |
| Editar impostos/honorários | E | E | — | — | — |
| Aprovar versão | A | A | — | — | — |
| Marcar linha `em_save` | E | E | — | — | — |
| **Job** | | | | | |
| Ver job (metadata, planejado, realizado, rentabilidade) | V | V | V | — | V |
| Ver job restrito (só planejado + realizado, sem orçado nem rentabilidade) | — | — | — | V† | — |
| Editar metadata do job | E | E | E | — | — |
| Editar realizado | E | E | E | E† | — |
| Consumir Save no job | E | E | E | — | — |
| Criar errata | E | E | E | — | — |
| Emitir/cancelar PP | E | E | E | — | — |
| Enviar pra faturamento / encerrar | A | A | — | — | — |
| Abertura financeira do job (via `/financeiro/abertura-de-job`) | A | — | — | — | A |
| Ver chat do job | V | V | V | V† | V |
| Enviar mensagem no chat | E | E | E | — | — |
| **Financeiro** | | | | | |
| Contas a pagar | E | — | — | — | E |
| Contas a receber | E | — | — | — | E |
| Conciliação bancária | E | — | — | — | E |
| Fluxo de caixa | V | — | — | — | V |
| Desembolsos — solicitar | E | E | E | — | E |
| Desembolsos — aprovar/pagar | A | — | — | — | A |
| Relatórios (rentabilidade, faturamento) | V | — | — | — | V |

† Freelancer só nos projetos onde é participante em `projeto_responsaveis`.

---

## 4. Arquitetura da solução

### 4.1 Fonte-verdade: `lib/permissoes.ts`

Objeto TypeScript com pares `"recurso.acao" → AppRole[]`:

```ts
export const permissoes = {
  "sidebar.cadastros":     ["administrador", "financeiro"],
  "sidebar.orcamentos":    ["administrador", "gerente_producao", "produtor", "freelancer", "financeiro"],
  "orcamentos.aprovar":    ["administrador", "gerente_producao"],
  "orcamentos.editar_impostos": ["administrador", "gerente_producao"],
  "jobs.editar_realizado": ["administrador", "gerente_producao", "produtor", "freelancer"],
  "listas.chave_meus_todos": ["administrador", "gerente_producao", "produtor", "financeiro"],
  // ... uma linha por (recurso.acao)
} satisfies Record<string, readonly AppRole[]>;
```

Helper: `pode(session, "orcamentos.aprovar", contexto?)`. O `contexto` opcional é usado quando a decisão depende de row-level (Freelancer + job específico). Padrão de uso:

- No server component: `const podeEditar = pode(session, "orcamentos.editar");` → passa como prop.
- No server action: `requirePermissao(session, "orcamentos.aprovar");` → lança erro + registra `audit_events` como `acao_negada`.
- No RLS: helper equivalente em SQL (função SECURITY DEFINER STABLE).

### 4.2 Consumidores

- **Sidebar** (`components/sidebar.tsx`): cada `NavLink` declara `permissao: "sidebar.orcamentos"`. A sidebar chama `pode()` — some o `roles: AppRole[]` hardcoded.
- **Server actions**: `requirePermissao(session, "x.y")` no início.
- **Server components**: derivam `podeEditar` boolean pra alimentar UI condicional.
- **RLS**: funções helper (`is_admin`, `is_gerente_producao`, `is_freelancer_do_projeto(projeto_id)`) que policies chamam.
- **Doc humano** (`docs/PERMISSOES.md`): matriz renderizada. Fonte-verdade continua o TS.
- **Futura tela `/admin/usuarios/permissoes`**: lê o mesmo objeto e renderiza tabela pivotada. Fora do escopo deste projeto.

### 4.3 Escopo do Freelancer no banco

Função SQL:

```sql
create or replace function public.is_freelancer_do_projeto(projeto uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from projeto_responsaveis pr
    where pr.projeto_id = projeto
      and pr.user_id = (select auth.uid())
  );
$$;
```

Policies passam a usar padrão:

```sql
using (
  is_tenant_member(tenant_id) and (
    is_admin_of_tenant(tenant_id)
    or is_gerente_producao_of_tenant(tenant_id)
    or is_produtor_of_tenant(tenant_id)
    or is_financeiro_of_tenant(tenant_id)
    or is_freelancer_do_projeto(projeto_id)
  )
)
```

**Nota:** como 19/19 profiles são `administrador`, o `OR` curto-circuita na primeira condição para todos os usuários atuais — custo zero no operacional. Aos poucos, à medida que usuários de outros papéis entrarem, cada policy paga no máximo uma checagem indexada.

**Índice obrigatório:** `projeto_responsaveis(user_id, projeto_id)` — sem ele o EXISTS vira scan. Vou conferir se já existe e criar se não.

### 4.4 UI read-only para Financeiro

Padrão de `React.Context` por página:

```ts
// Server component
const podeEditar = pode(session, "orcamentos.editar");
return <PageOrcamentoProvider value={{ podeEditar }}>...</PageOrcamentoProvider>;

// Client components consomem via hook
const { podeEditar } = usePageOrcamento();
```

Componentes afetados: `orcamento-form`, `versoes-lista`, `versoes-cards`, `versao-detalhe`, `itens-table`, `job-realizado-section`, `errata-barra`, `gerar-pp-drawer`, `chat-section`. Todos ganham consulta ao context; botões condicionais; campos com `readOnly`.

**Regra visual:** botão que não pode aparecer some (não fica cinza gratuito). Ação que muda estado (aprovar) vira badge ("Aprovado em DD/MM") quando cabe. Preserva a coerência visual.

---

## 5. Considerações de performance

Análise segundo `docs/PERFORMANCE.md`.

| Mudança | I/O extra | Queries novas | TTFB | Risco |
|---|:---:|:---:|:---:|---|
| `lib/permissoes.ts` + `pode()` | — | — | zero | Nenhum. Lookup em objeto TS compilado. |
| Sidebar consumindo `pode()` | — | — | zero | Nenhum. Mesma operação sob o capô do `.includes()` atual. |
| Gates em server actions | — | — | zero | Nenhum. Session já é RPC consolidada com cache. |
| UI read-only por context | — | — | zero | Nenhum. Boolean prop. |
| RLS com escopo Freelancer | RLS | **Potencial** | +µs indexado | **Aqui vive o risco.** Ver mitigações. |

**Mitigações obrigatórias na Task 5 (RLS):**

1. `(select auth.uid())` em vez de `auth.uid()` — regra H de PERFORMANCE.md.
2. Função `is_freelancer_do_projeto` marcada `STABLE` — Postgres cacheia por statement.
3. `OR` com admin/GP/Produtor/Financeiro primeiro — curto-circuito no papel operacional evita avaliar EXISTS.
4. Índice `projeto_responsaveis(user_id, projeto_id)`.
5. Rodar `mcp__supabase-write__get_advisors performance` depois de aplicar; se `auth_rls_initplan` aparecer, corrigir antes de commitar.

---

## 6. Fatiamento em Tasks

### ✅ Task 1 — Papéis: enum + labels (concluída)

**Escopo:**

- Migration `20260903100001_papeis_de_usuario.sql`: rename `gestao_projetos` → `gerente_producao`; add `produtor` e `freelancer` no enum `app_role`.
- Migration `20260903100002_handle_new_user_grava_gerente_producao.sql`: trigger `handle_new_user` deixa de gravar valor removido do enum.
- `lib/types.ts`: `AppRole` expandido; `roleLabel` com labels pt-BR.
- `lib/validations/convite.ts`: `ROLES` array atualizado.
- `app/(app)/admin/usuarios/convidar-drawer.tsx`: dropdown lista 5 papéis; default `gerente_producao`.
- `app/(app)/admin/usuarios/actions.ts`: comentário atualizado.

**Verificação:**

- Enum no banco tem 5 valores; nenhum profile ficou órfão (0 linhas com valor antigo).
- Convite abre sem erro; drop-down mostra 5 opções.

**Estado:** implementada, aguardando commit conjunto com as demais.

---

### Task 2 — Matriz materializada + Sidebar refatorada

**O que faz:** cria o "livro de regras" (`lib/permissoes.ts`) espelhando 1:1 a matriz da seção 3. Refatora a sidebar pra consumir esse livro. Nenhum gate novo é aplicado ainda — o passo é preparatório.

**Entregáveis:**

- `lib/permissoes.ts` — objeto `permissoes` + tipo `Recurso` + helper `pode(session, recurso, contexto?)`.
- `components/sidebar.tsx` — cada `NavLink` declara `permissao`; remove `roles: AppRole[]` hardcoded.
- `docs/PERMISSOES.md` — matriz renderizada, nota no topo "fonte-verdade é `lib/permissoes.ts`".

**Verificação:**

- Como Admin, sidebar mantém exatamente os 8 itens hoje visíveis.
- Sem gates novos em código — Admin continua conseguindo tudo.
- Type-check limpo (`tsc --noEmit`).

**Risco:** baixo. Muda um componente (sidebar) sem alterar comportamento pra usuário atual.

---

### Task 3 — Gates nas server actions

**O que faz:** aplica `requirePermissao(session, "x.y")` nas ~15 server actions e page-level guards hoje abertas (só `requireSession()`).

**Ações afetadas (varredura já feita):**

- **Orçamentos:** `criarOrcamento`, `duplicarVersao`, `aprovarVersao`, `editarImpostos`, `importarPlanilha`, `exportarPlanilha`.
- **Jobs:** `editarMetadata`, `enviarFaturamento`, `encerrarJob`, `abrirJobFinanceiro` (esta última é a de `/financeiro/abertura-de-job` — permanece com FIN+ADM).
- **Realizado / PP / Errata / Save:** `upsertItemRealizado`, `finalizarPedidoCompra`, `cancelarPedidoCompra`, `criarErrata`, `marcarEmSave`.
- **Chat:** `enviarMensagem` (só ADM/GP/PROD; FIN e FREE só leem).
- **Cadastros globais:** `criarCliente`, `criarFornecedor` (com exceção do inline), `criarEmpresa`, `criarConta`, `criarPlanoConta`, `criarCartao`, `criarCategoria`.
- **Financeiro:** `checarGateFinanceiro` passa a delegar a `pode()`.
- **Relatórios:** page-level guard em `/relatorios/*`.

**Padrão de erro:** ação negada devolve `{ ok: false, message: "Você não tem permissão para essa ação." }` e chama `logAuditEvent` com `acao: "acao_negada"` + metadata (tentativa, recurso, papel do usuário).

**Verificação:**

- Como Admin, todas as ações continuam funcionando.
- Um Produtor de teste tentando `aprovarVersao` recebe erro amigável.
- `audit_events` registra a tentativa.

**Risco:** médio. Muitos arquivos com mudança pequena. Provável descobrir 1-2 buracos não-mapeados. Cada gate tem teste manual.

---

### Task 4 — UI read-only + chave "Meus/Todos" ajustada

**O que faz:** aplica o padrão de context `podeEditar` nos componentes de orçamento e job, ajusta a chave "Meus/Todos" pra sumir pro Freelancer e expande a definição de "Meus" pra incluir `equipe`.

**Entregáveis (subdividida):**

**4a. Context `podeEditar` em orçamentos**

- Novo provider `PageOrcamentoProvider` + hook `usePageOrcamento`.
- Server components de `/orcamentos/*` e `/orcamentos/[projetoId]/[orcId]/*` derivam `podeEditar` e envolvem os client components.
- Consumidores: `orcamento-form`, `versoes-lista`, `versoes-cards`, `versao-detalhe`, `itens-table`, botões de ação flutuantes (aprovar, duplicar, editar impostos).

**4b. Context `podeEditar` em jobs**

- Análogo, provider `PageJobProvider`.
- Consumidores: `job-realizado-section`, `errata-barra`, `gerar-pp-drawer`, `enviar-faturamento-drawer`, `encerrar-dialog`, `job-chat-section`.

**4c. Chave "Meus/Todos" — visibilidade**

- Componente `ChaveMeusTodos` recebe prop `visivel` (default true).
- Lugares que instanciam (`projetos-list.tsx`, `jobs-list.tsx`, quaisquer outros) passam `visivel={pode(session, "listas.chave_meus_todos")}`.
- Quando `visivel=false`, componente não renderiza e o estado local do filtro é forçado `meus=true`.

**4d. Definição de "Meus" expandida**

- Nas queries que filtram por "Meus" (em `projetos-list`, `jobs-list`, e helpers relacionados), a cláusula muda de "só GP + produtor de orçamento" para "qualquer entrada em `projeto_responsaveis` (papel `gp` OU `equipe`) OU criador OU produtor de orçamento".
- Nada muda no schema — só a query.

**Verificação:**

- Como Admin, tudo idêntico. Botões continuam aparecendo.
- Como Financeiro (usuário de teste), `/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]` mostra os dados mas sem botão de aprovar/duplicar/etc.
- Como Freelancer (usuário de teste, adicionado à equipe de UM projeto), abre `/orcamentos` e vê só esse projeto; a chave "Meus/Todos" não aparece.

**Risco:** médio-alto. Toca em muitos componentes. Um botão esquecido = usuário fica confuso. Mitigação: checklist manual por tela.

---

### Task 5 — RLS com escopo do Freelancer

**O que faz:** cria as políticas RLS que garantem que o Freelancer só vê o que participa, e que os gates de código são também refletidos no banco (defesa em profundidade).

**Entregáveis:**

- Migration `20260903XXXXX_permissoes_rls.sql`:
  - Função `is_freelancer_do_projeto(projeto uuid)`.
  - Funções helper de role: `is_gerente_producao_of_tenant(tenant uuid)`, `is_produtor_of_tenant(tenant uuid)`, `is_financeiro_of_tenant(tenant uuid)`.
  - Índice `create index if not exists idx_projeto_responsaveis_user_projeto on projeto_responsaveis(user_id, projeto_id);` (verificar se já existe primeiro).
  - Policies novas ou refeitas em: `jobs`, `orcamentos`, `versoes_orcamento`, `versoes_orcamento_itens`, `jobs_itens_orcado`, `jobs_itens_realizado`, `jobs_erratas`, `jobs_erratas_itens`, `saves_consumos`, `pedidos_compra`, `pedidos_compra_parcelas`, `pedidos_compra_anexos`, `jobs_mensagens`, `jobs_chat_leituras`.
  - Todas usando `(select auth.uid())`.

**Verificação:**

- `mcp__supabase-write__get_advisors performance` sem warnings de `auth_rls_initplan`.
- `set local role authenticated; set local "request.jwt.claim.sub" = '<uuid_freelancer>';` + `select * from jobs;` retorna só os jobs onde ele participa.
- Mesma simulação como Admin retorna tudo, sem regressão.

**Risco:** alto (é a única task com risco real de performance). **Checkpoint obrigatório** — pauso ao terminar e não sigo pra Task 6 sem sua validação.

---

### Task 6 — Testes end-to-end com usuários de cada papel

**O que faz:** cria 4 usuários de teste (um por papel novo), valida o comportamento de ponta a ponta, encontra e corrige edge cases.

**Entregáveis:**

- 4 usuários convidados no tenant Agência California:
  - `gp_teste@califa-erp.local` como `gerente_producao`.
  - `produtor_teste@califa-erp.local` como `produtor`.
  - `freelancer_teste@califa-erp.local` como `freelancer`, adicionado à equipe de UM projeto específico.
  - `financeiro_teste@califa-erp.local` como `financeiro`.
- Checklist manual por papel (sidebar, permissões críticas, mensagens de erro, escopo de dados). Documentado no fim de `docs/PERMISSOES.md`.
- Ajustes pontuais pra qualquer coisa que apareça.

**Verificação:** documentada no próprio checklist. Cada linha marcada.

**Risco:** baixo. Task de arredondar pontas.

---

### Task 7 — Home diferenciada por papel *(sessão futura)*

Fora do escopo deste projeto. Vira nova sessão quando as roles estiverem validadas em uso real.

---

## 7. Dependências entre tasks

```
Task 1 (✅) ── Task 2 ── Task 3 ── Task 4 ── Task 5 ── Task 6
                                                            │
                                                            └── Task 7 (fase futura)
```

- Task 2 depende de Task 1 (usa `AppRole` novo).
- Task 3 depende de Task 2 (usa `pode()`).
- Task 4 depende de Task 2 (usa `pode()`).
- Task 5 depende conceitualmente da matriz mas não de código TS. Pode ser feita em paralelo a 3/4, mas por segurança sequencial.
- Task 6 depende de todas.

**Cada task = 1 commit isolado.** Se algo regride, revert pontual.

---

## 8. Critérios de "pronto" do projeto todo

1. ✅ Enum `app_role` tem 5 valores; `roleLabel` cobre todos; convite exibe todos.
2. `lib/permissoes.ts` existe, é a fonte-verdade, sidebar consome, doc humano existe.
3. Todas as server actions da varredura têm `requirePermissao()` no início.
4. Financeiro em `/orcamentos/*` e `/jobs/*` vê tudo, edita nada.
5. Freelancer só vê projetos onde é participante (verificado por navegação **e** por SQL simulado).
6. Nenhum warning de `auth_rls_initplan` no advisor.
7. Admin (usuário real) não sente diferença nenhuma na performance ou no fluxo.
8. Checklist da Task 6 marcado por completo.

---

## 9. Riscos e o que fazer

| Risco | Probabilidade | Impacto | Mitigação |
|---|:---:|:---:|---|
| Botão esquecido em `podeEditar` — Financeiro vê botão que não devia | Média | Baixo (UI feia, sem risco de escrita porque Task 3 já barra no server) | Checklist visual manual na Task 6. |
| RLS lenta em prod | Baixa | Alto | `get_advisors` + índice + short-circuit + `(select auth.uid())`. Checkpoint obrigatório após Task 5. |
| Gate esquecido em uma server action | Média | Médio (uma role consegue ação não-permitida) | Varredura já feita; RLS na Task 5 funciona como segunda barreira. |
| Definição expandida de "Meus" surpreende usuário atual | Baixa | Baixo | Mudança é aditiva — projetos que apareciam continuam aparecendo, e alguns novos podem aparecer. Antonio é o único usuário afetado hoje e usa "Todos" majoritariamente. |
| Rename do enum causa quebra runtime | **Já mitigado** | Alto | Trigger `handle_new_user` foi atualizada na migration `20260903100002`. Zero linhas afetadas. |

---

## 10. Fora do escopo (para quando surgir)

- **Save — aprovação do Financeiro:** consumo hoje é auto-aprovado. Reunião pediu fluxo similar a errata. Vira spec própria.
- **PP — trava por estouro:** hoje é gate "admin OR responsável". Reunião pediu trava quando estoura planejado (GP aprova) ou orçado (diretor aprova). Fluxo novo, spec própria.
- **Errata — revisão do FIN refinada:** `jobs.abertura_em_revisao` já marca, falta gate específico no botão de liberar. Rápido, mas fica pra depois.
- **Chat por área (`producao` vs `financeiro`):** o gate "só Produção envia" está coberto pela Task 3 via role. Refinar comportamento por área (ex.: FIN ler só mensagens de sua área, ADM ver as duas) fica pra depois.
- **RH e Mídia:** módulos + roles. Fase 2.
- **Financeiro parcial vs completo:** divisão do papel. Fase 2.
- **Home diferenciada por papel:** Task 7.
- **Tela `/admin/usuarios/permissoes`:** renderiza a matriz. Task futura, ~50 linhas de React lendo `lib/permissoes.ts`.
