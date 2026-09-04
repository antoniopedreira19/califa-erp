# Permissões por Perfil

**Fonte-verdade:** [`lib/permissoes.ts`](../lib/permissoes.ts).
**Spec original:** [`docs/superpowers/specs/2026-09-03-permissoes-e-papeis-design.md`](superpowers/specs/2026-09-03-permissoes-e-papeis-design.md).

Este documento é derivado da matriz TypeScript. Se algo aqui divergir do que o código faz, o código está certo — atualize aqui. Nunca o contrário.

Se você é humano lendo pra entender quem pode o quê, essa é a página. Se você é IA implementando um gate, leia direto o `lib/permissoes.ts` — evita divergência.

## Papéis

O enum `app_role` no banco define 5 papéis operacionais:

| Chave | Rótulo | Descrição |
|---|---|---|
| `administrador` | Administrador | Sócio/diretor. Faz tudo, gerencia usuários, empresas, auditoria. Superset de todas as roles. |
| `gerente_producao` | Gerente de Produção | Dono comercial/operacional do trabalho. Fala com cliente, aprova orçamento, aprova envio a faturamento e encerramento. |
| `produtor` | Produtor | Braço direito do GP. Faz tudo em orçamento e job **menos aprovar**. |
| `freelancer` | Freelancer | Escopo restrito: só vê projetos onde é participante (via `projeto_responsaveis`). Vê orçamento em modo espectador do bruto (sem BV/totais/save). Edita apenas o realizado dos jobs dele. |
| `financeiro` | Financeiro | Controla o caixa: contas a pagar/receber, conciliação, fluxo, desembolsos, abertura de job. Cadastra bancos, plano de contas, cartões. **Read-only em orçamento e job.** |

**Fora deste enum (fase futura):** `rh`, `midia`. Também pode surgir split `financeiro_operacional` / `financeiro_aprovador`.

**Onde os papéis moram:**

- `profiles.role` — papel padrão do usuário na aplicação (default para novos vínculos).
- `tenant_members.role` — papel do usuário **dentro daquele tenant específico**. É este que a RLS considera.

## Sidebar por papel

Legenda: ✓ = item visível · — = item oculto · RO = read-only (vê mas não age)

| Item | ADM | GP | PROD | FREE | FIN |
|---|:---:|:---:|:---:|:---:|:---:|
| Home | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cadastros | ✓ | — | — | — | ✓ |
| Orçamentos | ✓ | ✓ | ✓ | ✓† | ✓ RO |
| Jobs | ✓ | ✓ | ✓ | ✓† | ✓ RO |
| Financeiro | ✓ | — | — | — | ✓ |
| Desembolsos | ✓ | ✓ | ✓ | — | ✓ |
| Relatórios | ✓ | — | — | — | ✓ |
| Administração | ✓ | — | — | — | — |

† Freelancer vê filtrado a projetos onde consta em `projeto_responsaveis` (papel `gp` OU `equipe`, ou por derivação como criador/produtor).

## Chave "Meus/Todos" nas listas de Projetos, Orçamentos e Jobs

| Papel | Vê o toggle? | Estado inicial | "Todos" mostra |
|---|:---:|:---:|:---|
| ADM | ✓ | Meus | Todos os projetos do tenant |
| GP | ✓ | Meus | Todos os projetos do tenant |
| Produtor | ✓ | Meus | Todos os projetos do tenant |
| Financeiro | ✓ | Meus | Todos os projetos do tenant |
| Freelancer | — | Forçado "Meus" | (irrelevante — não vê toggle) |

**Definição de "Meus":** qualquer entrada em `projeto_responsaveis` (papel `gp` OU `equipe`) OU derivados (criador do projeto, produtor de algum orçamento do projeto).

## Ações por papel

Legenda: **V** = ver · **E** = editar/criar · **A** = aprovar ou ação crítica · **—** = nada

### Cadastros globais

| Ação | ADM | GP | PROD | FREE | FIN |
|---|:---:|:---:|:---:|:---:|:---:|
| Clientes (via tela `/clientes`) | E | — | — | — | — |
| Fornecedores (via tela `/fornecedores`) | E | — | — | — | — |
| **Fornecedor via "cadastro inline"** (dentro de PP) | E | E | E | — | — |
| Empresas do tenant | E | — | — | — | — |
| Contas bancárias | E | — | — | — | E |
| Plano de contas, cartões de crédito | E | — | — | — | E |
| Categorias de orçamento, regionais, cidades | E | — | — | — | — |
| Usuários e permissões | E | — | — | — | — |
| Auditoria (feed de eventos) | V | — | — | — | — |

### Orçamento

| Ação | ADM | GP | PROD | FREE | FIN |
|---|:---:|:---:|:---:|:---:|:---:|
| Ver orçamento (bruto completo) | V | V | V | — | V |
| Ver orçamento (bruto restrito — sem BV/totais/save) | — | — | — | V† | — |
| Criar projeto/orçamento novo | E | E | E | — | — |
| Duplicar/exportar orçamento | E | E | E | — | — |
| Editar impostos/honorários | E | E | — | — | — |
| Aprovar versão | A | A | — | — | — |
| Marcar linha `em_save` | E | E | — | — | — |

### Job

| Ação | ADM | GP | PROD | FREE | FIN |
|---|:---:|:---:|:---:|:---:|:---:|
| Ver job (metadata, planejado, realizado, rentabilidade) | V | V | V | — | V |
| Ver job restrito (só planejado + realizado, sem orçado/rentabilidade) | — | — | — | V† | — |
| Editar metadata do job | E | E | E | — | — |
| Editar realizado | E | E | E | E† | — |
| Consumir Save | E | E | E | — | — |
| Criar errata | E | E | E | — | — |
| Emitir/cancelar PP | E | E | E | — | — |
| Enviar pra faturamento / encerrar | A | A | — | — | — |
| **Abertura financeira do job** (via `/financeiro/abertura-de-job`) | A | — | — | — | A |
| Ver chat do job | V | V | V | V† | V |
| Enviar mensagem no chat | E | E | E | — | — |

### Financeiro

| Ação | ADM | GP | PROD | FREE | FIN |
|---|:---:|:---:|:---:|:---:|:---:|
| Contas a pagar | E | — | — | — | E |
| Contas a receber | E | — | — | — | E |
| Conciliação bancária | E | — | — | — | E |
| Fluxo de caixa | V | — | — | — | V |
| Desembolsos — solicitar | E | E | E | — | E |
| Desembolsos — aprovar/pagar | A | — | — | — | A |
| Relatórios (rentabilidade, faturamento) | V | — | — | — | V |

† Freelancer só nos projetos onde é participante.

## Padrões de aplicação

A matriz nunca é aplicada "solta" — três camadas cobrem tudo:

1. **UI** (server components e client components) — deriva `podeEditar` a partir de `pode(role, "recurso.acao")` e passa como prop pros filhos, geralmente via `React.Context` de página. Esconde/desabilita botões que a role não pode acionar.
2. **Server actions** — chamam `await requirePermissao(session, "recurso.acao")` no início. Lança `PermissaoNegadaError` e grava `audit_events` com `acao_negada` se não autorizado.
3. **RLS** — políticas no banco fazem última barreira. Freelancer é filtrado por `is_freelancer_do_projeto(projeto_id)`. Roles operacionais são checadas por helpers SQL espelho da matriz TS.

Camadas 1 e 2 usam `lib/permissoes.ts` diretamente. Camada 3 tem funções SQL correspondentes — se a matriz mudar aqui, tem que mudar lá também (ver spec).

## Papel default do trigger

O trigger `handle_new_user` grava `gerente_producao` como default ao criar `profiles` no signup. O drawer de convite em `/admin/usuarios` sobrescreve com o papel real logo depois. Se o convite falhar antes do UPDATE, o usuário fica como `gerente_producao` — inconveniente mas não perigoso.

## Fora do escopo (fase futura)

- **RH e Mídia** como módulos e como papéis.
- **Financeiro parcial vs completo** — split do papel.
- **Save — aprovação do consumo pelo Financeiro** (fluxo similar a errata; hoje é auto-aprovado).
- **PP — trava por estouro** (planejado → GP aprova; orçado → diretor).
- **Errata — gate específico do botão "revisar/liberar"** pra Financeiro.
- **Chat por área** (`producao` vs `financeiro`) refinado além do gate básico.
- **Tela `/admin/usuarios/permissoes`** — renderiza esta matriz visualmente lendo `lib/permissoes.ts`.
- **Home diferenciada por papel**.

## Usuários de teste (Task 6)

Criados via SQL direto em 03/09/2026 — todos vivem no tenant `agencia-california` e podem logar no ambiente de produção com a senha `Teste2026!`. Não são convites do Auth: entram já com email confirmado.

| Email | Papel (`app_role`) | Vínculo especial |
|---|---|---|
| `gp_teste@califa-erp.local` | `gerente_producao` | — |
| `produtor_teste@califa-erp.local` | `produtor` | — |
| `freelancer_teste@califa-erp.local` | `freelancer` | Equipe do projeto `NOV-0004/26` (SEBRAE NOSSO CANTO 2026) |
| `financeiro_teste@califa-erp.local` | `financeiro` | — |

**Validação de RLS via SQL** (rodado em 03/09/2026, resultado esperado):

| Papel | jobs visíveis | orçamentos visíveis | projetos visíveis |
|---|:---:|:---:|:---:|
| administrador | 30 | 48 | 18 |
| gerente_producao | 30 | 48 | 18 |
| produtor | 30 | 48 | 18 |
| financeiro | 30 | 48 | 18 |
| freelancer | 0 | 3 | 1 |

Freelancer conta 0 jobs porque o SEBRAE ainda não tem job criado; enxerga só os 3 orçamentos e 1 projeto onde é participante.

## Checklist manual — smoke test por papel

Para validar a Task 4 (UI) e Task 5 (RLS) end-to-end. Cada linha é um "logar como X e checar Y". Marca ✓ na direita se comportamento bate.

### Administrador (Antonio real)

- [ ] Sidebar: 8 itens (Home, Cadastros, Orçamentos, Jobs, Financeiro, Desembolsos, Relatórios, Administração).
- [ ] `/orcamentos`: chave "Meus/Todos" aparece; consegue clicar em "Novo projeto", entrar em qualquer projeto, aprovar versão, editar impostos.
- [ ] `/jobs/[jobId]`: consegue editar metadata, gerar PP, criar errata, enviar mensagem no chat, enviar pra faturamento, encerrar.
- [ ] Tempo de navegação normal (~300ms warm).

### GP (`gp_teste@califa-erp.local`)

- [ ] Sidebar: 4 itens (Home, Orçamentos, Jobs, Desembolsos).
- [ ] `/orcamentos`: chave "Meus/Todos" aparece.
- [ ] Consegue criar/duplicar/exportar/aprovar orçamento e editar impostos.
- [ ] `/jobs`: vê a lista, edita metadata, gera PP, cria errata, envia mensagem no chat.
- [ ] "Enviar pra faturamento" e "Encerrar job" aparecem quando cabíveis.

### Produtor (`produtor_teste@califa-erp.local`)

- [ ] Sidebar: 4 itens (Home, Orçamentos, Jobs, Desembolsos).
- [ ] `/orcamentos`: chave "Meus/Todos" aparece.
- [ ] Consegue criar/duplicar/exportar orçamento. **NÃO** vê botão "Aprovar" nem "Editar impostos".
- [ ] `/jobs`: edita metadata, gera PP, cria errata, envia mensagem no chat.
- [ ] **NÃO** vê "Enviar pra faturamento" nem "Encerrar job".

### Freelancer (`freelancer_teste@califa-erp.local`)

- [ ] Sidebar: 3 itens (Home, Orçamentos, Jobs). Nada de Desembolsos.
- [ ] `/orcamentos`: chave "Meus/Todos" **não aparece**. Lista mostra só o projeto `NOV-0004/26`.
- [ ] Consegue abrir o projeto SEBRAE e ver os 3 orçamentos dele.
- [ ] **NÃO** consegue abrir nenhum outro projeto (URL direta deve dar 404/vazio via RLS).
- [ ] Dentro do orçamento: vê valores brutos, mas **NÃO** vê BV/totais/save; sem botão de aprovar/duplicar/editar.
- [ ] Em Job (quando SEBRAE tiver): vê só planejado + realizado (sem orçado, sem rentabilidade), edita realizado, vê chat mas **não envia**.

### Financeiro (`financeiro_teste@califa-erp.local`)

- [ ] Sidebar: 7 itens (Home, Cadastros, Orçamentos, Jobs, Financeiro, Desembolsos, Relatórios). **Nada de Administração**.
- [ ] `/orcamentos`: chave "Meus/Todos" aparece.
- [ ] Consegue abrir orçamento, mas em **modo espectador**: nenhum botão de aprovar, duplicar, editar impostos, novo item, importar planilha.
- [ ] `/jobs`: idem, modo espectador. Sem PP, sem errata, sem enviar mensagem.
- [ ] Vê `/relatorios/rentabilidade` e `/relatorios/faturamento`.
- [ ] Vê `/financeiro/*` (contas a pagar/receber, conciliação, fluxo de caixa, abertura de job).
- [ ] Consegue cadastrar/editar contas bancárias, plano de contas, cartões (em `/cadastros/*`).

## Limpeza dos usuários de teste

Quando não precisar mais:

```sql
delete from auth.users where email like '%@califa-erp.local';
-- profiles e tenant_members caem em cascade (FK ON DELETE CASCADE).
delete from public.projeto_responsaveis
  where profile_id = '4a9bec5c-3e70-490c-8984-0846b6a0701d'; -- freelancer
```
