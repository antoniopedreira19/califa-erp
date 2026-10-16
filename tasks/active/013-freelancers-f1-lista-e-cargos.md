# Task 013 — Freelancers (Fase 1, Task 3): lista de freelancers + gerenciamento de cargos

## Objetivo

Entregar a primeira tela do módulo que **toca em dados reais** do banco:

1. A aba **Freelancers** (`/freelancers/lista`) com tabela, busca, filtro por ação prevista e ação de exportar/criar.
2. Dialog **"Gerenciar cargos"** acessível pelo botão da aba, com CRUD do catálogo `freelancer_cargos`.
3. Server actions pra criar, renomear e ativar/inativar cargo.

A tabela da lista mostra o que a Fase 1 permite — sem informação derivada de contrato (que vem na Fase 2). Em contrapartida, já aparece o workflow de **ação prevista** (contratar/renovar/manter/substituir/encerrar) com filtro próprio.

## Fora de escopo

- `/freelancers/novo` (cadastro) — **Task 014**. O botão existe mas fica **desabilitado** com tooltip "em breve".
- `/freelancers/[id]` (perfil) — Task 014. Linha da tabela clica mas vai pra URL stub.
- `/freelancers/[id]/editar` — Task 014.
- 4 cards de análise rápida (na ativa / em dia / irregular / encerrados) — Task 015, depois dos contratos existirem.
- Export XLSX — Task 019 (Fase 4).
- Coluna "Cargo" vinda do contrato ativo — Task 015.
- Coluna "Status" derivada do contrato — Task 015.
- Buscar freelancer existente por CPF antes de cadastrar duplicado — Task 014.

## Decisões travadas

- **Busca em servidor, não cliente.** `/freelancers/lista` é server component que lê `searchParams` (`?q=`, `?acao=`) e consulta Supabase com filtros aplicados. Nada de `useState` com busca local — isso quebraria quando a base passar de algumas centenas de linhas.
- **Chips de ação prevista** com os 6 valores: `contratar`, `renovar`, `manter`, `substituir`, `encerrar`, `sem_decisao` (= IS NULL). Selecionar múltiplos é OR.
- **Linha clicável inteira** levando pra `/freelancers/[handle]` onde `handle = id-slug(nome_social)`. Isso espelha o padrão do AgCaliforniaRH e facilita URLs legíveis.
- **Dialog de cargos é client component** porque tem muito estado local (input novo, toggle ativo linha a linha, erro de duplicata). Dentro dele, as alterações vão por server action que faz `revalidatePath("/freelancers/lista")` pra devolver estado atualizado.
- **Operações de cargo**: criar, renomear, ativar/inativar. Deletar não existe nesta task — se o cargo tiver sido usado em contrato (Fase 2+), deletar quebraria histórico. Inativar basta — some do dropdown de cargo em novos contratos, continua visível em contratos antigos.
- **Permissão de gerenciar cargos**: `administrador` e `rh` (igual à policy do banco). Botão "Gerenciar cargos" só aparece pra esses dois roles. GP, produtor e financeiro veem a lista mas não o botão.
- **Permissão de criar/editar freelancer**: `administrador`, `rh`, `financeiro`. Botão "Novo freelancer" só aparece pra esses três roles.

## Contexto do ponto de partida

### Já pronto

- Tabelas `freelancers` e `freelancer_cargos` com RLS, policies, 65 cargos seed (Task 011).
- Tipos `Freelancer`, `FreelancerCargo` em `lib/types.ts` (Task 011).
- Casca navegável do módulo com `/freelancers/lista` renderizando placeholder (Task 012).
- Guarda de role no `layout.tsx` do módulo.
- Permissão `sidebar.freelancers` em `lib/permissoes.ts`.
- Padrão de server actions em `app/(app)/clientes/actions.ts` pra espelhar.
- `Dialog` + `DialogContent` + `DialogClose` em `components/ui/dialog.tsx`.
- `requireSession()`, `createClient()`, `pode()` helpers prontos.

### Padrões a seguir

- Server component page faz query + render; passa dados pra client component "list" só quando precisa de interação (checkbox, hover).
- Server actions com `"use server"`, `revalidatePath`, Zod validation, `checarPermissao` quando apropriado.
- Audit log via `logAuditEvent` em ações destrutivas (inativar cargo entra como "freelancer_cargos.inativar").
- `force-dynamic` em toda page.

## Escopo (o que a task entrega)

### 1. Arquivos novos

```
app/(app)/freelancers/lista/
├── page.tsx                       # Server component: query + layout
├── actions.ts                     # Server actions pra cargos
└── _components/
    ├── lista-client.tsx           # Tabela interativa (chips, linha hover)
    ├── gerenciar-cargos-dialog.tsx
    ├── acao-prevista-badge.tsx
    └── busca-input.tsx            # Form com q + redirect

lib/validations/freelancer-cargos.ts   # Zod schemas
```

### 2. Arquivos modificados

- `app/(app)/freelancers/lista/page.tsx` existente (stub da Task 012) é **substituída** pela versão real.

### 3. Query principal

```ts
const supabase = createClient();
let q = supabase
  .from("freelancers")
  .select("*")
  .eq("tenant_id", session.activeTenant.id)
  .order("nome_social", { ascending: true });

if (searchParams.q) {
  const term = `%${searchParams.q.trim()}%`;
  q = q.or(`nome_social.ilike.${term},nome_completo.ilike.${term},cpf.ilike.${term}`);
}

if (searchParams.acao) {
  const acoes = searchParams.acao.split(",");
  // "sem_decisao" vira "is.null"; demais são valores do enum
  // Monta OR entre eles
}

const { data: freelancers } = await q.returns<Freelancer[]>();
```

### 4. Server actions (`lista/actions.ts`)

- `criarCargo(formData)` — valida nome não vazio e não duplicado; INSERT; `revalidatePath`.
- `renomearCargo(formData)` — valida; UPDATE; `revalidatePath`.
- `toggleCargoAtivo(formData)` — flip boolean; UPDATE; `revalidatePath`.

Todas as três chamam `requireSession()` e verificam `pode(role, "sidebar.freelancers")` + role in [admin, rh] antes de executar. Retornam `ActionResult = { ok: true } | { ok: false, message, fieldErrors? }`.

### 5. UI da lista

**Topo (header)**:
- `PageHeader` já existe (eyebrow Freelancers / title Freelancers / icon Users).
- Actions à direita:
  - Botão **"Gerenciar cargos"** (variant secondary, icon `Briefcase`) — só visível pra admin/rh.
  - Botão **"Novo freelancer"** (primary, icon `Plus`) — **desabilitado nesta task**, com `title="Chega na Task 014"`. Visível pra admin/rh/financeiro.

**Filtros (barra)**:
- Input de busca à esquerda (`<form>` que faz GET pra `/freelancers/lista?q=`).
- Chips à direita: `[Contratar] [Renovar] [Manter] [Substituir] [Encerrar] [Sem decisão]` com estado "ativo" (vermelho) ou "inativo" (cinza). Clicar togglea.

**Tabela** (densa, estilo do califa-erp):
- Colunas: Nome · CPF · Cidade · Email · Celular · Ação prevista · Cadastrado em.
- Linha inteira é `<Link>` pra `/freelancers/[handle]`.
- Hover: `bg-california-red/[0.02]`.
- Empty state quando nada bate nos filtros: ícone + mensagem.

### 6. Dialog "Gerenciar cargos"

- Trigger: botão "Gerenciar cargos" (admin/rh).
- Content:
  - Título "Gerenciar cargos" + descrição curta.
  - Input "Novo cargo" + botão "Adicionar" (Enter também).
  - Lista scrollável dos cargos existentes:
    - Nome (editável inline via botão de lápis que troca pra input).
    - Toggle "ativo" (switch).
    - Contagem suave do uso ("em uso em X contratos") — **omitir** nesta task (contratos ainda não existem).
  - Botão "Fechar" no footer.
- Erros exibidos inline por linha ou no form.
- Após qualquer alteração: `revalidatePath` + lista atualiza.

### 7. Validação (`lib/validations/freelancer-cargos.ts`)

Zod:
- `nome`: `.min(2).max(80).trim()`
- Checa unicidade por tenant_id (duplicata) na action, não no schema.

## Critérios de pronto

- [ ] Pasta `app/(app)/freelancers/lista/` com os 6 arquivos listados.
- [ ] `lib/validations/freelancer-cargos.ts` criado.
- [ ] Tabela carrega os freelancers do tenant ativo com RLS funcionando.
- [ ] Busca por nome funciona (via server + query string).
- [ ] Chips de ação prevista funcionam (toggle via query string).
- [ ] Botão "Gerenciar cargos" só aparece pra admin/rh.
- [ ] Dialog permite criar, renomear, inativar e reativar cargos — tudo com `revalidatePath` devolvendo lista fresca.
- [ ] Criar cargo com nome duplicado mostra erro.
- [ ] Botão "Novo freelancer" aparece pra admin/rh/financeiro mas está desabilitado com tooltip "Em breve".
- [ ] Linha da tabela clica mas leva pra URL `/freelancers/[handle]` (que ainda não existe — 404 esperado nesta task; vira página na Task 014).
- [ ] GP e produtor conseguem ver a lista mas **não** veem "Gerenciar cargos" nem "Novo freelancer".
- [ ] `npm run typecheck` passa limpo.
- [ ] `npm run lint` passa limpo.

## Próxima task (014)

CRUD de freelancer:
- `/freelancers/novo` com formulário completo (dados pessoais + endereço + PJ + pagamento + diversidade).
- `/freelancers/[id]` perfil com `PageHeader` rico (avatar + badges + ações) e abas (Dados pessoais, Contratos — vazia ainda, Histórico).
- `/freelancers/[id]/editar` igual novo mas pré-preenchido.
- `BuscarFreelancerCpf` component pra evitar duplicata.
- Hooks: dedup por CPF, ViaCEP no CEP (opcional), picker de cargo (vindo do catálogo).
