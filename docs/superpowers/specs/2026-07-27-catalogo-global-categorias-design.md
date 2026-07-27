# Catálogo global de categorias no tenant

**Data:** 2026-07-27
**Status:** Aprovado — pronto para writing-plans
**Supersede parcialmente:** [`2026-07-23-planejado-e-categoria-design.md`](2026-07-23-planejado-e-categoria-design.md) (Fase G) na parte de categoria por versão.

## 1. Contexto e motivação

Na Fase G da Task 004 introduzimos categorias com escopo **por versão de orçamento** (`versoes_orcamento_categorias`). Cada versão tinha seu próprio conjunto isolado — se você criava "Produção" em duas versões, viravam duas entidades distintas.

**Problema:** o objetivo declarado do sistema é permitir análises futuras — rentabilidade por categoria, gasto por categoria através de vários orçamentos, comparação entre propostas. Categoria por versão inviabiliza isso: cada versão tem seu próprio vocabulário, e um relatório "quanto a Agência gastou em Produção este ano" precisaria fazer matching por string, com todos os problemas óbvios ("Produção" vs "PRODUCAO" vs "Prod").

**Solução:** transformar categoria em um **catálogo global do tenant**. Todas as versões escolhem de uma lista única, gerenciada em `/cadastros/categorias`.

## 2. Decisões (com rationale)

| # | Decisão | Rationale |
|---|---------|-----------|
| 1 | Catálogo global no tenant, não por versão | Analytics padronizada exige vocabulário único. |
| 2 | Gestão em `/cadastros/categorias` (nova página no hub de cadastros) | Segue o padrão de clientes/fornecedores; separa cadastro de operação. |
| 3 | Todos os usuários do tenant podem criar e editar; só admin pode inativar/reativar | Baixo atrito no dia-a-dia, curadoria concentrada no admin. |
| 4 | Import de planilha **não** lê mais categoria (coluna B ignorada) | Simplifica parser; classificação vira responsabilidade puramente do sistema, evita categorias-lixo criadas por erro de digitação. |
| 5 | Wipe total dos dados existentes (`categoria_id` de todos os itens → NULL) | Volume atual é mínimo (Fase G recém-fechada); recadastro manual é mais simples que migration deduplicando. |
| 6 | Soft-delete (`ativo = false`), nunca hard-delete | Consistência com clientes/fornecedores; preserva histórico pra analytics. |
| 7 | Gate "só admin inativa" fica no server action, não em RLS | Padrão já estabelecido no projeto (`inativarCliente`, `inativarFornecedor`); mais legível e testável. RLS libera UPDATE pra todos os membros. |
| 8 | `categoria_id` no item continua nullable; FK vira `on delete restrict` | Não precisamos hard-delete, então restrict é suficiente e evita perda acidental de classificação histórica. |

## 3. Escopo

### Dentro
- Nova tabela `categorias` (global no tenant).
- Migration: dropar `versoes_orcamento_categorias`, alterar FK de `versoes_orcamento_itens.categoria_id`, wipe.
- Página `/cadastros/categorias` + card no hub.
- Server actions: criar, editar, inativar, reativar.
- Ajustes no drawer de item (dropdown lê do catálogo global).
- Remoção do botão "Nova categoria" no header da versão.
- Remoção da leitura de categoria no parser de import.
- Remoção da lógica de cópia/remap de categoria na duplicação de versão.
- 4 novas ações de auditoria.

### Fora
- Merge/mesclar duas categorias em uma.
- Cor, ícone, descrição, ou ordem manual em categoria.
- Bulk-assign (selecionar N itens → aplicar categoria X).
- A tela de analytics em si (rentabilidade por categoria, gasto por categoria). O objetivo desta task é **destravar** essa tela futura, não construí-la.

## 4. Design técnico

### 4.1 Schema

**Nova tabela:**

```sql
create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint categorias_nome_nao_vazio check (length(trim(nome)) > 0)
);

create unique index uniq_categoria_nome_por_tenant
  on public.categorias(tenant_id, lower(nome));

create index idx_categorias_tenant on public.categorias(tenant_id);

create trigger trg_categorias_updated_at
  before update on public.categorias
  for each row execute function public.set_updated_at();
```

**Alteração em `versoes_orcamento_itens`:**

```sql
-- 1) wipe: zera classificação antes de trocar FK
update public.versoes_orcamento_itens set categoria_id = null;

-- 2) troca FK: aponta pra categorias global
alter table public.versoes_orcamento_itens
  drop constraint versoes_orcamento_itens_categoria_id_fkey;

alter table public.versoes_orcamento_itens
  add constraint versoes_orcamento_itens_categoria_id_fkey
  foreign key (categoria_id) references public.categorias(id) on delete restrict;

-- 3) descarta a tabela antiga
drop table public.versoes_orcamento_categorias;
```

### 4.2 RLS

```sql
alter table public.categorias enable row level security;

create policy categorias_select on public.categorias
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy categorias_insert on public.categorias
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

create policy categorias_update on public.categorias
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Sem policy de DELETE (soft-delete only)

grant select, insert, update on public.categorias to authenticated;
```

### 4.3 Server actions

Novo arquivo: `app/(app)/cadastros/categorias/actions.ts`.

Assinatura das 4 actions:

- `criarCategoria(input: { nome: string })` — todos os membros. Valida sessão + Zod, `insert` com `tenant_id` do session + `created_by`, audit `categoria.criada`, `revalidatePath('/cadastros/categorias')`.
- `editarCategoria(input: { id: string, nome: string })` — todos os membros. Valida sessão + Zod + pertencimento ao tenant, `update` só do `nome`, audit `categoria.editada`, revalidate.
- `inativarCategoria(id: string)` — **gate admin**: se `session.activeTenant.role !== 'administrador'` → retorna erro. Update `ativo = false`, audit `categoria.inativada`, revalidate.
- `reativarCategoria(id: string)` — mesmo gate. Update `ativo = true`, audit `categoria.reativada`, revalidate.

Todas seguem o padrão do projeto: `requireSession()`, Zod parse, `.eq('tenant_id', session.activeTenant.id)`, `log_audit_event` via RPC, `revalidatePath` no fim.

### 4.4 Validações (Zod)

Novo arquivo: `lib/validations/categoria.ts`.

```ts
import { z } from "zod";

export const categoriaSchema = z.object({
  nome: z.string().trim().min(1, "Nome obrigatório").max(80, "Máximo 80 caracteres"),
});
```

### 4.5 UI

**Hub `/cadastros` (`app/(app)/cadastros/page.tsx`):**
- Adicionar card "Categorias" com contagem de ativas, seguindo o padrão dos cards de Clientes/Fornecedores.

**Página `/cadastros/categorias` (nova, `app/(app)/cadastros/categorias/page.tsx`):**
- Server component.
- Header: título "Categorias" + botão "Nova categoria" (abre drawer).
- Filtros no topo: input de busca (por nome, case-insensitive) + `<Select>` de status (Ativas | Inativas | Todas), default Ativas.
- Tabela compacta:
  | Nome | Status | Criada em | Criada por | Ações |
  - Linha inteira clicável abre drawer de edição (feedback registrado na memória: `feedback_ui_linha_clicavel.md`).
  - Ações com `stopPropagation`: Editar sempre visível; Inativar/Reativar só se `session.activeTenant.role === 'administrador'`.

**Drawer criar/editar (`app/(app)/cadastros/categorias/categoria-drawer.tsx`):**
- Client component controlado.
- Um único input: Nome.
- Submit chama `criarCategoria` ou `editarCategoria`.
- Erro amigável se colisão de nome (constraint unique).

**Drawer de item da versão (`app/(app)/orcamentos/[id]/versoes/[versaoId]/item-drawer.tsx` ou nome equivalente):**
- Dropdown de categoria agora recebe lista vinda de `categorias WHERE tenant_id AND ativo = true ORDER BY nome`.
- Se o item já tinha uma categoria que foi inativada depois, ela aparece **selecionada** no dropdown daquele item (não some), mas não aparece pra novos itens.
- Remover o botão "+ Nova categoria" inline.

**Header da versão (`app/(app)/orcamentos/[id]/versoes/[versaoId]/page.tsx`):**
- Remover o botão "Nova categoria". Header fica só com "Novo grupo".

**Sidebar:** nada muda. `/cadastros/categorias` fica embaixo do hub, não é item top-level.

### 4.6 Impacto no código existente

| Arquivo | Mudança |
|---------|---------|
| [`lib/importacao/parser-oficial.ts`](../../../lib/importacao/parser-oficial.ts) | Remover leitura da coluna B (categoria) e warnings associados. Coluna B passa a ser ignorada silenciosamente. |
| [`app/(app)/orcamentos/[id]/versoes/importar-actions.ts`](../../../app/(app)/orcamentos/[id]/versoes/importar-actions.ts) | Remover bulk-insert de categorias e o map `old→new`. Todos os itens importados nascem com `categoria_id = NULL`. |
| Server action de duplicar versão | Remover cópia de categorias e remap. Itens copiados preservam `categoria_id` como está (aponta pra mesma categoria global). |
| [`lib/auth/audit.ts`](../../../lib/auth/audit.ts) | Adicionar 4 ações: `categoria.criada`, `categoria.editada`, `categoria.inativada`, `categoria.reativada`. |
| [`lib/types.ts`](../../../lib/types.ts) | Remover `VersaoOrcamentoCategoria`. Adicionar `Categoria` (com `ativo`, `created_by`). |
| [`lib/calculos/versao-totais.ts`](../../../lib/calculos/versao-totais.ts) | Nada muda — cálculos financeiros não conhecem categoria. |

### 4.7 O que explicitamente **não** muda

- Cálculos de orçado, planejado, honorários, impostos, rentabilidade.
- Export XLSX (categoria não é exportada hoje e não passa a ser).
- Fluxo de aprovação de versão (Fase E pendente).
- Task 005 (criação de job).
- Coluna `categoria_id` em `versoes_orcamento_itens` (continua nullable, muda só a FK).

## 5. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Wipe apaga classificação que o usuário já tinha feito | Confirmado com o usuário: volume atual é mínimo (Fase G recém-fechada). Se aparecer surpresa após aplicar migration, é reversível manualmente reclassificando via drawer. |
| Usuário tenta criar categoria com nome que colide | Unique constraint `(tenant_id, lower(nome))` protege. Server action captura o erro e devolve mensagem amigável. |
| Item aponta pra categoria inativa e some do dropdown | Design garante que categoria inativa **aparece selecionada** no item que já a tinha, só não aparece pra novos itens. |
| Alguém tenta inativar categoria via SQL direto sem passar pela action | Aceito. Único acesso não-app é do próprio admin (MCP, SQL Editor). RLS permite update pra todos os membros porque o gate real está na action; se admin faz update manual, é ele mesmo assumindo a responsabilidade. |
| Regressão de performance na página `/cadastros/categorias` | Página segue padrão existente de clientes/fornecedores. Aplicar checklist de `docs/PERFORMANCE.md` antes de commitar (prefetch, agregações, `Promise.all`). |

## 6. Fora de escopo (backlog futuro)

- **Merge de categorias** — tela do admin pra selecionar duas categorias e mesclar (todos os itens da B são realocados pra A, B é apagada).
- **Cor/ícone/descrição** em categoria — se a UI de analytics precisar.
- **Bulk-assign** no drawer da versão — selecionar N itens → aplicar categoria X.
- **Reordenação manual** no dropdown (hoje é alfabético).
- **A tela de analytics em si** — rentabilidade por categoria, comparativo entre orçamentos. É o motivo desta task, mas é outra task.

## 7. Ordem de implementação sugerida

1. Migration `20260729000001_categorias_globais.sql`: cria `categorias`, wipe do `categoria_id`, troca FK, drop `versoes_orcamento_categorias`, RLS, grants.
2. `lib/types.ts`, `lib/validations/categoria.ts`, novas ações de audit.
3. Server actions em `app/(app)/cadastros/categorias/actions.ts`.
4. Página + drawer em `/cadastros/categorias`.
5. Card no hub `/cadastros`.
6. Ajuste no drawer de item (dropdown lê do catálogo global).
7. Remoção do botão "Nova categoria" no header da versão.
8. Ajuste no parser + `confirmarImportacao`.
9. Ajuste na duplicação de versão.
10. `npx tsc --noEmit` + `npx next lint` + teste manual do fluxo completo.
