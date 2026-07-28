# Design: Projetos como entidade guarda-chuva de orçamentos

**Data:** 2026-07-28
**Escopo:** Módulo Comercial (Orçamentos)
**Ordem de deploy:** big-bang em um único PR (Abordagem 1 do brainstorming — dados de prod são só teste; sem justificativa pra faseamento defensivo)
**Fora deste escopo:** Jobs (Task 005) — a hierarquia pai/filho entre entregáveis vive nos jobs, não nos orçamentos, e será tratada em task futura.

---

## 1. Motivação

Hoje o modelo é `cliente → orçamento → versão`. Um orçamento corresponde direto a "uma peça a ser produzida". Isso não modela a realidade da agência: uma **iniciativa de cliente** (ex.: "Carnaval Anitta" pra Ambev) tem N entregáveis (bebedouros SP, bebedouros NE, backdrop, blimp, TA-Ambev SSA...), cada um com seu próprio orçamento, mas todos pertencendo à mesma campanha.

O time da California hoje resolve isso na planilha externa nomeando o "JOB" como o conceito guarda-chuva (`Carnaval Anitta` com código `AMB-0003/26`) e a "PLANILHA" como o entregável individual. O ERP precisa espelhar essa mesma hierarquia.

## 2. Modelo atual vs proposto

**Antes:**
```
cliente → orcamento (ORC-NNNN) → versoes_orcamento → grupos → itens
```

**Depois:**
```
cliente → projeto (AMB-0003/26) → orcamento (AMB-0003/26-01, -02, ...) → versoes_orcamento → grupos → itens
```

Sem hierarquia pai/filho entre orçamentos — todos são "irmãos" dentro do projeto. Hierarquia pai/filho aparece só na Task 005 (Jobs), quando os orçamentos aprovados forem convertidos.

## 3. Decisões-chave (respostas do brainstorming)

| Decisão | Escolha | Racional |
|---|---|---|
| Cliente vive onde? | **`projetos.cliente_id`** | Todo orçamento do mesmo projeto compartilha o mesmo cliente por definição |
| Responsável vive onde? | **`projetos.responsavel_id`** | GP responde pelo projeto todo; não faz sentido GP diferente por entregável |
| Campanha vive onde? | **`projetos.campanha`** | Descreve a iniciativa (ex: "Verão 2026"), não a peça |
| Tipo vive onde? | **`orcamentos.tipo`** (fica como está) | Cada peça pode ser de tipo diferente (vídeo, foto, ativação) |
| Data início vive onde? | **`projetos.data_inicio_prevista`** (NOT NULL — deriva o ano do código) | Serve pra ancorar a janela e o código do projeto |
| Data fim vive onde? | **`orcamentos.data_fim_prevista`** (fica como está) | Cada peça termina em data diferente |
| Data início do orçamento | **`orcamentos.data_inicio_prevista`** (fica como está) | Cada peça começa em data diferente |
| Status do projeto | **`ativo` / `arquivado`** (binário) | Ciclo completo seria overkill; arquivar cobre "sumir da lista" |
| Status do orçamento | fica como está (7 valores) | Cada orçamento aprova independente e vira job próprio |
| Hierarquia pai/filho entre orçamentos | **NÃO existe** | Existe entre jobs (Task 005) |
| Código do projeto | `[PREFIXO_CLIENTE]-[SEQ_4]/[ANO_2]` (ex: `AMB-0003/26`) | Formato usado na planilha atual |
| Prefixo do cliente | novo campo `clientes.codigo_curto` (3-6 letras uppercase, único por tenant, NOT NULL) | Backfill pros existentes: primeiras letras uppercase de `nome_fantasia` |
| Sequencial do projeto | por (cliente + ano) | Reinicia a cada ano, por cliente. Ex: 3º projeto da Ambev em 2026 |
| Ano do código | derivado de `projetos.data_inicio_prevista` (ano com 2 dígitos) | Não é `created_at` — o GP define quando o projeto vai rodar |
| Código do orçamento | `[CODIGO_PROJETO]-[SEQ_2]` (ex: `AMB-0003/26-01`) | Aninhado ao projeto; sequência por projeto |
| Códigos antigos `ORC-0001`/`ORC-0002` | **mantidos como estão** | Dados de teste; migrar histórico só cria ruído |
| Backfill dos orçamentos existentes | 1 projeto "teste" único agrupa os 2 | Ambos são do mesmo cliente (Pevetech); responsável do projeto vem do ORC-0001 |
| Sidebar | continua com **"Orçamentos"** (uma entrada só) | Menu não muda; hierarquia interna muda |
| URLs | `/orcamentos` = lista de **projetos**; drill down por projeto → orçamento → versão | Estrutura aninhada, `/orcamentos` como base |

## 4. Schema — migrations

Uma única migration nova: `supabase/migrations/20260728000002_task007_projetos.sql` (Task 007 porque é depois da 006 admin). Estrutura:

### 4.1 `clientes.codigo_curto` (NEW)

```sql
alter table public.clientes add column codigo_curto text;

-- Backfill: primeiras 4 letras alfabéticas uppercase de nome_fantasia
update public.clientes
   set codigo_curto = upper(regexp_replace(substring(nome_fantasia, 1, 6), '[^A-Za-z]', '', 'g'))
 where codigo_curto is null;

-- Corrige casos onde ficou vazio (nome só com números/símbolos)
update public.clientes set codigo_curto = 'CLI' where codigo_curto is null or codigo_curto = '';

alter table public.clientes
  alter column codigo_curto set not null,
  add constraint chk_clientes_codigo_curto_formato check (codigo_curto ~ '^[A-Z]{2,6}$');

create unique index uniq_clientes_codigo_curto_por_tenant
  on public.clientes(tenant_id, codigo_curto);
```

### 4.2 `projeto_status` enum + tabela `projetos` (NEW)

```sql
do $$ begin
  if not exists (select 1 from pg_type where typname = 'projeto_status') then
    create type public.projeto_status as enum ('ativo', 'arquivado');
  end if;
end $$;

create table public.projetos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  codigo                text not null,
  nome                  text not null,
  campanha              text,
  cliente_id            uuid not null references public.clientes(id) on delete restrict,
  responsavel_id        uuid not null references public.profiles(id) on delete restrict,
  status                public.projeto_status not null default 'ativo',
  data_inicio_prevista  date not null,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index uniq_projetos_codigo_por_tenant on public.projetos(tenant_id, codigo);
create index idx_projetos_tenant       on public.projetos(tenant_id);
create index idx_projetos_cliente      on public.projetos(cliente_id);
create index idx_projetos_responsavel  on public.projetos(responsavel_id);
create index idx_projetos_status       on public.projetos(status);
create index idx_projetos_created_at   on public.projetos(created_at desc);

drop trigger if exists trg_projetos_updated_at on public.projetos;
create trigger trg_projetos_updated_at
  before update on public.projetos
  for each row execute function public.set_updated_at();

alter table public.projetos enable row level security;

create policy projetos_select on public.projetos
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy projetos_insert on public.projetos
  for insert to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and (created_by is null or created_by = (select auth.uid()))
  );

create policy projetos_update on public.projetos
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Sem DELETE (arquivar = status='arquivado')

grant select, insert, update on public.projetos to authenticated;
```

### 4.3 `orcamentos` — adiciona `projeto_id`, remove 3 colunas

```sql
-- Passo 1: adiciona projeto_id NULLABLE
alter table public.orcamentos
  add column projeto_id uuid references public.projetos(id) on delete restrict;

-- Passo 2: BACKFILL — cria 1 projeto "teste" e vincula os 2 orçamentos
--          (usa cliente_id e responsavel_id do ORC-0001; ambos são da Pevetech)
do $$
declare
  v_projeto_id uuid;
  v_tenant_id uuid;
  v_cliente_id uuid;
  v_responsavel_id uuid;
  v_codigo_cliente text;
  v_ano text;
begin
  -- Pega dados do primeiro orçamento (ORC-0001)
  select o.tenant_id, o.cliente_id, o.responsavel_id, c.codigo_curto, to_char(current_date, 'YY')
    into v_tenant_id, v_cliente_id, v_responsavel_id, v_codigo_cliente, v_ano
    from public.orcamentos o
    join public.clientes c on c.id = o.cliente_id
   where o.codigo = 'ORC-0001'
   limit 1;

  if v_tenant_id is null then
    -- Fallback: se ORC-0001 não existir (banco novo), skip backfill
    return;
  end if;

  insert into public.projetos (
    tenant_id, codigo, nome, campanha, cliente_id, responsavel_id, status, data_inicio_prevista
  ) values (
    v_tenant_id,
    v_codigo_cliente || '-0001/' || v_ano,
    'teste',
    'teste',
    v_cliente_id,
    v_responsavel_id,
    'ativo',
    current_date
  )
  returning id into v_projeto_id;

  -- Vincula todos os orçamentos existentes desse tenant a este projeto
  update public.orcamentos
     set projeto_id = v_projeto_id
   where tenant_id = v_tenant_id
     and projeto_id is null;
end $$;

-- Passo 3: SET NOT NULL + índice
alter table public.orcamentos
  alter column projeto_id set not null;

create index idx_orcamentos_projeto on public.orcamentos(projeto_id);

-- Passo 4: DROP das colunas que subiram pro projeto
alter table public.orcamentos
  drop column cliente_id,
  drop column responsavel_id,
  drop column campanha;
```

### 4.4 Regra de segurança adicional

O que era garantido pela RLS de `orcamentos.cliente_id` (`is_tenant_member`) agora passa pelo `projeto_id`. Como projeto tem `tenant_id` própria coluna com RLS, e orçamento também tem `tenant_id`, a coerência (`orcamento.tenant_id = projeto.tenant_id`) é responsabilidade das server actions — não vou adicionar trigger porque o mesmo padrão vale hoje pra outros joins e não deu problema.

## 5. Server actions

### 5.1 Novos arquivos

**`app/(app)/orcamentos/actions.ts`** — CRUD de projetos:
- `criarProjeto(input)` — gera código automaticamente
- `atualizarProjeto(id, input)` — edita nome, campanha, cliente, responsável, data
- `arquivarProjeto(id)` — status='arquivado'
- `reativarProjeto(id)` — status='ativo'

**`app/(app)/orcamentos/[projetoId]/actions.ts`** — CRUD de orçamentos (agora escopado ao projeto):
- `criarOrcamento(projetoId, input)` — gera código `<codigo_projeto>-NN`
- `atualizarOrcamento(id, input)` — edita nome, tipo, datas, status
- (arquivamento de orçamento continua via `status='cancelado'` como hoje)

### 5.2 Helper de geração de código

`lib/codigos/projetos.ts`:
```typescript
export async function gerarCodigoProjeto(
  supabase: SupabaseClient,
  tenantId: string,
  clienteId: string,
  dataInicio: string  // ISO date
): Promise<string>
```

Lógica:
1. Busca `clientes.codigo_curto`
2. Extrai ano 2 dígitos de `dataInicio`
3. Conta projetos existentes no tenant desse cliente cujo `codigo` termina em `/<ano>` (regex ou LIKE)
4. Retorna `<codigo_curto>-<seq_4_padded>/<ano>`

Racing: usa transação + `SELECT ... FOR UPDATE` no `clientes` row pra serializar (raro no MVP com 1 usuário, mas correto).

`lib/codigos/orcamentos.ts`:
```typescript
export async function gerarCodigoOrcamento(
  supabase: SupabaseClient,
  projetoId: string
): Promise<string>
```

Lógica:
1. Busca `projetos.codigo`
2. Conta orçamentos do projeto
3. Retorna `<codigo_projeto>-<seq_2_padded>`

### 5.3 Server actions afetados por remoção de colunas

Todos os pontos onde o código lê `orcamento.cliente_id`, `orcamento.responsavel_id`, `orcamento.campanha` precisam passar pelo `projeto`:

- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/importar-actions.ts` — o path do bucket usa `orcamento_id`, sem mudança direta, mas se em algum lugar pega cliente_id daí, precisa mudar
- Qualquer embed Supabase `orcamentos(cliente:clientes(...))` vira `orcamentos(projeto:projetos(cliente:clientes(...)))`

## 6. Types (`lib/types.ts`)

### Novos:
```typescript
export type ProjetoStatus = "ativo" | "arquivado";

export interface Projeto {
  id: string;
  tenant_id: string;
  codigo: string;
  nome: string;
  campanha: string | null;
  cliente_id: string;
  responsavel_id: string;
  status: ProjetoStatus;
  data_inicio_prevista: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function projetoStatusLabel(s: ProjetoStatus): string {
  switch (s) {
    case "ativo": return "Ativo";
    case "arquivado": return "Arquivado";
  }
}
```

### Modificados:

`Cliente` ganha `codigo_curto: string`.

`Orcamento` perde `cliente_id`, `responsavel_id`, `campanha`. Ganha `projeto_id: string`.

## 7. UI — reestruturação de rotas

### Estrutura atual (a mover):
```
app/(app)/orcamentos/
├── page.tsx                      # lista de orçamentos
├── orcamentos-list.tsx
├── orcamento-editor-drawer.tsx
├── orcamento-form.tsx
├── novo/page.tsx
└── [id]/
    ├── page.tsx                  # detalhe do orçamento
    └── versoes/
        ├── versoes-list.tsx
        ├── nova-versao-drawer.tsx
        ├── importar-drawer.tsx
        ├── importar-actions.ts
        └── [versaoId]/
            ├── page.tsx
            ├── grupo-card.tsx
            ├── itens-table.tsx
            ├── novo-grupo-drawer.tsx
            ├── totais-card.tsx
            └── versao-editor-drawer.tsx
```

### Estrutura nova:
```
app/(app)/orcamentos/
├── page.tsx                      # NOVA: lista de PROJETOS
├── projetos-list.tsx             # NOVO componente
├── projeto-editor-drawer.tsx     # NOVO
├── projeto-form.tsx              # NOVO
├── actions.ts                    # NOVO: CRUD de projetos
├── novo/page.tsx                 # NOVA função: criar PROJETO
└── [projetoId]/
    ├── page.tsx                  # NOVA: detalhe do projeto (header + lista de orçamentos dentro)
    ├── orcamentos-list.tsx       # MOVIDO (adaptado — sem coluna de cliente/responsável)
    ├── orcamento-editor-drawer.tsx  # MOVIDO
    ├── orcamento-form.tsx        # MOVIDO (sem cliente/responsável/campanha; ganha só nome/tipo/datas/status)
    ├── actions.ts                # NOVO: CRUD de orçamento
    ├── novo/page.tsx             # MOVIDO: criar orçamento dentro deste projeto
    └── [orcId]/
        ├── page.tsx              # MOVIDO de [id]/page.tsx: detalhe do orçamento (com card de versões)
        └── versoes/              # TODO CONTEÚDO MOVIDO SEM MUDANÇA FUNCIONAL
            ├── versoes-list.tsx
            ├── nova-versao-drawer.tsx
            ├── importar-drawer.tsx
            ├── importar-actions.ts
            └── [versaoId]/
                ├── page.tsx
                ├── grupo-card.tsx
                ├── itens-table.tsx
                ├── novo-grupo-drawer.tsx
                ├── totais-card.tsx
                └── versao-editor-drawer.tsx
```

### Breadcrumbs (padrão em todas as páginas internas)

- `/orcamentos` → "Orçamentos" (título da página)
- `/orcamentos/[projetoId]` → breadcrumb `← Orçamentos`, título "Projeto: AMB-0003/26 · Carnaval Anitta"
- `/orcamentos/[projetoId]/[orcId]` → breadcrumb `← AMB-0003/26 · Carnaval Anitta`, título "Orçamento: AMB-0003/26-01 · Bebedouros SP"
- `/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]` → breadcrumb `← AMB-0003/26-01 · Bebedouros SP`, título "Versão 2"

**Regra:** breadcrumb sempre volta 1 nível. Não vou colocar hierarquia inteira no breadcrumb pra não poluir.

### Componentes novos

- **`projetos-list.tsx`** (tabela): colunas `codigo`, `nome`, `cliente`, `responsável`, `campanha`, `data início`, `# orçamentos`, `status`. Filtros: cliente, responsável, status (ativo/arquivado). Linha inteira clicável abre `/orcamentos/[projetoId]`. Ações secundárias (editar drawer, arquivar) usam `stopPropagation` — regra da memória "linha clicável".
- **`projeto-form.tsx`** (usado em novo + editar drawer): campos `nome`, `campanha`, `cliente` (Select), `responsável` (Select de membros ativos), `data_inicio_prevista` (DatePicker). Sem código no form — código é auto-gerado no submit.
- **`projeto-editor-drawer.tsx`** (drawer lateral): mesmo form + ações de arquivar/reativar no rodapé com `ConfirmDialog`.

### Página de detalhe do projeto (`[projetoId]/page.tsx`)

Layout:
1. Header: breadcrumb, código + nome do projeto, badges de cliente e status, botão "Editar projeto" (drawer) + botão "Novo orçamento"
2. Card "Metadata": cliente, responsável, campanha, data início, criado em
3. Card "Orçamentos": lista de orçamentos do projeto (tabela leve — código, nome, tipo, data fim prevista, # versões, status). Linha clicável.

### Contagem no hub `/cadastros`

Não precisa mudar — o card de clientes/fornecedores lá continua igual. Só a lista de orçamentos ganha uma camada de projeto por cima.

### Cliente: campo `codigo_curto` na UI

- Formulário de cliente (`app/(app)/cadastros/clientes/cliente-form.tsx`): adicionar input pra `codigo_curto` (2-6 letras uppercase, validação Zod). Auto-fill sugere baseado nas primeiras letras do nome, mas usuário pode editar.
- Listagem de clientes: adicionar coluna `Código` (compacta).

## 8. Validações (Zod)

### `lib/validations/projeto.ts` (NOVO)
```typescript
export const projetoSchema = z.object({
  nome: z.string().min(1).max(200),
  campanha: z.string().max(200).optional().or(z.literal("")),
  cliente_id: z.string().uuid(),
  responsavel_id: z.string().uuid(),
  data_inicio_prevista: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
```

### `lib/validations/cliente.ts` (ADAPTAR)
Adiciona:
```typescript
codigo_curto: z.string().regex(/^[A-Z]{2,6}$/, "2-6 letras maiúsculas"),
```

### `lib/validations/orcamento.ts` (SIMPLIFICAR)
Remove: `cliente_id`, `responsavel_id`, `campanha`. Mantém: `nome`, `tipo`, `data_inicio_prevista`, `data_fim_prevista`.

## 9. Auditoria

Novas ações em `lib/auth/audit.ts`:
- `projeto.criado`
- `projeto.atualizado`
- `projeto.arquivado`
- `projeto.reativado`

Continua o padrão de chamar `logAudit` dentro das server actions após persistência.

## 10. Performance (regra transversal — CLAUDE.md)

- **`prefetch={false}` nas listas** de projetos, orçamentos (dentro do projeto) e versões (regra já aplicada em orçamentos hoje — replicar em projetos).
- **Sem embed pesado pra contar**: a coluna "# orçamentos" na tabela de projetos usa query agregada separada (`select projeto_id, count(*) group by projeto_id`), não `select("*, orcamentos(*)")`.
- **`Promise.all`** nas queries do server component da lista (projetos + clientes p/ filtro + membros p/ filtro).
- **`force-dynamic`** permanece em todas as pages autenticadas.
- Migration nova termina com `GRANT` explícito pra `authenticated` (regra CLAUDE.md).
- Policies usam `(select auth.uid())`, não `auth.uid()` direto (evita re-avaliação por linha).

## 11. Casos borda & validações de banco

| Caso | Como o sistema responde |
|---|---|
| Tentar arquivar projeto com orçamento não-cancelado | Server action bloqueia com erro amigável ("Cancele os orçamentos antes de arquivar"). Não é constraint de banco pra permitir corrigir manualmente via SQL se preciso. |
| Tentar mudar cliente do projeto | Permitido (drawer). Não afeta orçamentos — eles herdam por FK ao projeto, então o cliente novo se propaga automaticamente. |
| Tentar mudar `codigo_curto` do cliente | Permitido. **Não** recalcula códigos de projetos existentes — códigos são imutáveis após criação. Projetos novos usam o novo prefixo. |
| Tentar criar 2 projetos do mesmo cliente/ano | Sem problema — o sequencial resolve (`AMB-0001/26`, `AMB-0002/26`, ...) |
| Cliente com nome só de caracteres não-alfabéticos (ex: "123") | Backfill do `codigo_curto` cai no fallback `'CLI'` — usuário edita depois. |
| Projeto arquivado aparece na lista? | Só com filtro "arquivado" ligado. Default = só ativos. |
| Deletar cliente que tem projeto | Bloqueado pela FK `on delete restrict` (igual hoje). |

## 12. Testes / validação manual

Após implementação, o QA manual mínimo:
1. **Migration:** rodar via MCP `apply_migration`. Verificar via SQL: `select count(*) from projetos` (deve ser 1 = "teste"), `select projeto_id from orcamentos` (deve estar preenchido nos 2). Verificar `clientes.codigo_curto` da Pevetech ('PEVE').
2. **UI vazia:** dropar tudo local, criar do zero: cadastrar cliente com `codigo_curto`, criar projeto → conferir código `AAA-0001/26`, criar orçamento dentro → conferir código `AAA-0001/26-01`, criar versão → conferir link até item.
3. **Navegação:** clicar Orçamentos na sidebar → cair na lista de projetos. Clicar num projeto → ver orçamentos. Clicar num orçamento → ver versões. Voltar via breadcrumb em cada nível.
4. **Arquivar projeto:** com orçamento vivo → bloqueado. Cancelar orçamento → arquivar liberado. Filtrar "arquivados" → aparece.
5. **Editar projeto:** trocar cliente → conferir que os orçamentos herdaram novo cliente (query de embed).
6. **Códigos:** criar 2 projetos do mesmo cliente e ano → sequencial vai 0001, 0002. Criar 1 projeto de outro cliente → começa 0001 (por cliente).
7. **Backfill em prod (Supabase):** rodar migration via MCP, conferir os 2 orçamentos existentes vinculados ao projeto "teste".

## 13. Arquivos afetados (checklist para o plano)

### Cria:
- `supabase/migrations/20260728000002_task007_projetos.sql`
- `lib/codigos/projetos.ts`
- `lib/codigos/orcamentos.ts`
- `lib/validations/projeto.ts`
- `app/(app)/orcamentos/actions.ts` (CRUD projeto)
- `app/(app)/orcamentos/projetos-list.tsx`
- `app/(app)/orcamentos/projeto-editor-drawer.tsx`
- `app/(app)/orcamentos/projeto-form.tsx`
- `app/(app)/orcamentos/[projetoId]/page.tsx`
- `app/(app)/orcamentos/[projetoId]/actions.ts` (CRUD orçamento — extraído do que hoje está espalhado)

### Move (git mv — preserva histórico):
- `app/(app)/orcamentos/[id]/*` → `app/(app)/orcamentos/[projetoId]/[orcId]/*`
- `app/(app)/orcamentos/orcamento-*.tsx` → `app/(app)/orcamentos/[projetoId]/orcamento-*.tsx`
- `app/(app)/orcamentos/orcamentos-list.tsx` → `app/(app)/orcamentos/[projetoId]/orcamentos-list.tsx`
- `app/(app)/orcamentos/novo/page.tsx` → `app/(app)/orcamentos/[projetoId]/novo/page.tsx`

### Modifica:
- `app/(app)/orcamentos/page.tsx` (reescreve como lista de projetos)
- `lib/types.ts` (add `Projeto`, `ProjetoStatus`; muta `Orcamento` e `Cliente`)
- `lib/validations/cliente.ts` (add `codigo_curto`)
- `lib/validations/orcamento.ts` (remove cliente/responsavel/campanha)
- `lib/auth/audit.ts` (add ações `projeto.*`)
- `app/(app)/cadastros/clientes/cliente-form.tsx` (add input `codigo_curto`)
- `app/(app)/cadastros/clientes/clientes-list.tsx` (add coluna `Código`)
- Todas as páginas que leem `orcamento.cliente_id`, `responsavel_id`, `campanha` → passar por `projeto`
- `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx` — adicionar breadcrumb `← projeto` + reler dados via `projeto`

## 14. Sequência de commits sugerida

O big-bang é lógico, mas dá pra separar em commits atômicos dentro do PR pra facilitar review:
1. Migration + backfill (banco pronto, sem código quebrado — mas ainda referencia colunas velhas no TS)
2. `lib/types.ts` + validações + audit actions
3. Server actions novas + helpers de código
4. UI de projetos (lista, form, drawer, detalhe)
5. Reestruturação de rotas de orçamento + versão (git mv)
6. Cliente ganha `codigo_curto` (form + lista)
7. Ajustes de embeds e cleanup final; rodar `tsc --noEmit` + `next lint` no fim

## 15. Rollback

Se o PR quebrar em prod:
1. Revert do commit no Git.
2. Migration reversa manual (apply_migration reversa): `alter table orcamentos add column cliente_id... /* recuperar dos projetos via join */; drop table projetos; alter table clientes drop column codigo_curto;`
3. Como os dados são de teste, `truncate` também é aceitável.

## 16. Não faz parte deste escopo (fica pra depois)

- **Jobs (Task 005):** hierarquia pai/filho entre entregáveis vive nos jobs, não nos orçamentos. Task 005 adicionará `jobs.job_pai_id` e ligação com `orcamento_id`.
- **Aprovação de orçamento (Fase E — pendente):** já estava no backlog; não muda com esta task.
- **Dashboard de projetos:** cards, métricas, filtros temporais avançados. MVP mostra só a lista.
- **Renomear códigos antigos ORC-0001/ORC-0002:** ficam como estão.
- **Movimentação de orçamento entre projetos:** não previsto no MVP. Se o usuário criar orçamento no projeto errado, ele cancela e recria.
