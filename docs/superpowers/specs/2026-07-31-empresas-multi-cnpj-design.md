# Empresas / múltiplos CNPJs por tenant — Design

Data: 2026-07-31

## Contexto

O grupo California opera hoje com mais de um CNPJ. A California Salvador é a
principal, mas existem outras pessoas jurídicas dentro do mesmo grupo — e um
projeto do ERP precisa saber por qual PJ ele é vendido/executado, porque essa
empresa é a que aparece em documentos oficiais (nota fiscal, pedido de compra
e faturamento no futuro).

Hoje o sistema:

- Tem a tabela `tenants` (id, nome, slug, status), tratada como "grupo" — só
  existe o tenant California.
- Não modela pessoas jurídicas. Toda coisa gravada é implicitamente da
  California Salvador.
- Tem `projetos` (guarda-chuva), `orcamentos` (FK NOT NULL pra `projetos`) e
  `jobs` (FK NOT NULL pra `projetos` e `orcamentos`).
- Tem `regionais` (tenant-wide), já referenciada por `projetos.regional_id` e
  `jobs.regional_id`.
- Tem `audit_events` + RPC `log_audit_event(...)` como canal de auditoria.
- Tem `/admin` só com o card "Usuários".

## Objetivo

Introduzir a entidade **empresa** (pessoa jurídica dentro do grupo) e ligá-la
a projetos, orçamentos e jobs. Cadastro completo o suficiente para servir
documento fiscal futuro (razão social, CNPJ, IE, IM, endereço, contato,
faturamento), com uma marcada como **principal** e uma tela de administração
para gerenciar.

## Não-objetivos (fora de escopo desta task)

- Cliente, fornecedor e categoria continuam sendo do **grupo** (tenant), sem
  `empresa_id`. Duplicar cadastros por PJ não traz valor — o histórico
  comercial já fica separado por causa do `empresa_id` em orçamento e job.
- Emissão real de NF, PO ou boleto.
- Cabeçalho da planilha exportada do orçamento passar a puxar razão social
  dinâmica em vez do texto atual. Vira task própria depois desta.
- Multi-tenancy real (mais de um tenant no sistema). A modelagem já suporta,
  mas a UI/onboarding não estão em escopo.

## Decisões-chave

### D1. Tenant ≠ Empresa

O tenant permanece como o "grupo California". A empresa é a pessoa jurídica
dentro do grupo. Um tenant pode ter N empresas; hoje tem uma (California
Salvador).

Motivo: transformar cada CNPJ num tenant separado obrigaria a duplicar
usuários, permissões e cadastros compartilhados (clientes, fornecedores,
categorias) — o que contradiz o comportamento real do grupo.

### D2. `empresa_id` em projetos, orçamentos e jobs, mas projeto = fonte da verdade

- `projetos.empresa_id` é definido pelo usuário no formulário do projeto.
- `orcamentos.empresa_id` e `jobs.empresa_id` são **cópias** propagadas por
  trigger BEFORE INSERT/UPDATE a partir de `projeto.empresa_id`.
- Consequência: a UI/API de orçamento e job **nunca** passa `empresa_id`;
  quem manda é sempre o projeto.

Motivo: opção "empresa_id nas 3 tabelas" foi escolhida para permitir filtro
sem JOIN nas listas. Mas ter três colunas independentes convida
inconsistência. O trigger elimina a chance de divergir sem custo perceptível
na UI.

### D3. Cliente / fornecedor / categoria continuam sem `empresa_id`

Ficam no escopo do tenant. O relacionamento comercial concreto (quem
faturou pra quem, com qual PJ) fica registrado em orçamento e job.

### D4. Visibilidade: badge e filtro sempre visíveis nas listas

Listas de projeto/orçamento/job mostram badge da empresa em cada linha e
um filtro por empresa no topo, **mesmo quando só existe uma empresa
cadastrada**. Escolha explícita do usuário para manter consistência visual.

### D5. Regional é FK para a tabela `regionais` já existente

Não criar enum. Não criar tabela nova. A empresa usa a mesma tabela
`regionais` que projetos e jobs já usam. O seed insere a regional "NE" se
ela não existir no tenant California.

## Modelo de dados

### Tabela `empresas`

```sql
create table public.empresas (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  regional_id           uuid not null references public.regionais(id) on delete restrict,
  razao_social          text not null,
  nome_fantasia         text,
  cnpj                  text not null,
  inscricao_estadual    text,
  inscricao_municipal   text,
  logradouro            text not null,
  numero                text,
  complemento           text,
  bairro                text,
  cidade                text not null,
  uf                    char(2) not null,
  cep                   text not null,
  telefone              text,
  email                 text,
  local_pagamento       text,
  instrucoes_nf         text,
  principal             boolean not null default false,
  ativo                 boolean not null default true,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index uniq_empresas_cnpj_por_tenant
  on public.empresas(tenant_id, cnpj);

-- Exatamente 1 empresa principal ativa por tenant
create unique index uniq_empresas_principal_por_tenant
  on public.empresas(tenant_id)
  where principal = true;

create index idx_empresas_tenant   on public.empresas(tenant_id);
create index idx_empresas_regional on public.empresas(regional_id);
create index idx_empresas_ativo    on public.empresas(tenant_id, ativo);
```

Campos NOT NULL: `tenant_id`, `regional_id`, `razao_social`, `cnpj`,
`logradouro`, `cidade`, `uf`, `cep`, `principal`, `ativo`. O resto é
opcional — endereços fiscais reais nem sempre têm todos os campos.

**Trigger `set_updated_at`**: aplicar o `trg_empresas_updated_at` usando a
função pública `public.set_updated_at()` já utilizada por
tenants/profiles/projetos/etc.

**Formato armazenado**:

- `cnpj` guarda **só dígitos** (14 caracteres). CHECK
  `chk_empresas_cnpj_formato check (cnpj ~ '^[0-9]{14}$')`.
- `cep` guarda **só dígitos** (8 caracteres). CHECK equivalente.
- `telefone` guarda só dígitos (10 ou 11). CHECK equivalente.
- `uf` guarda 2 letras maiúsculas. CHECK.

Máscara é responsabilidade da UI (form aplica ao digitar, remove antes de
enviar; leitura formata antes de exibir). Evita duplicatas por variação de
pontuação e simplifica a UNIQUE em CNPJ.

### FK `empresa_id` em projetos/orçamentos/jobs

Adicionada como `nullable → backfill → NOT NULL` em cada uma:

```sql
alter table public.projetos
  add column empresa_id uuid references public.empresas(id) on delete restrict;
-- backfill
alter table public.projetos alter column empresa_id set not null;
create index idx_projetos_empresa on public.projetos(empresa_id);
```

Mesmo padrão para `orcamentos` e `jobs`.

### Trigger de propagação

```sql
create or replace function public.enforce_empresa_from_projeto()
returns trigger
language plpgsql
as $$
declare
  v_empresa_id uuid;
begin
  select p.empresa_id into v_empresa_id
    from public.projetos p
   where p.id = NEW.projeto_id;

  if v_empresa_id is null then
    raise exception 'projeto % não possui empresa_id', NEW.projeto_id;
  end if;

  NEW.empresa_id := v_empresa_id;
  return NEW;
end$$;
```

Trigger BEFORE INSERT OR UPDATE em `orcamentos` e em `jobs`.

Efeito: qualquer INSERT/UPDATE em orçamento ou job tem `empresa_id`
sobrescrito para a empresa do projeto. UI não precisa passar o valor.

### Cascata quando admin muda a empresa do projeto

Admin pode editar `projetos.empresa_id` (raro, mas legítimo — ex: projeto
foi criado na PJ errada). Nesse caso, orçamentos e jobs filhos precisam
acompanhar, senão ficam com empresa antiga.

Trigger AFTER UPDATE em `projetos` (função
`public.cascade_empresa_para_filhos()`): quando `NEW.empresa_id IS DISTINCT
FROM OLD.empresa_id`, dispara

```sql
update public.orcamentos set empresa_id = NEW.empresa_id
 where projeto_id = NEW.id and empresa_id is distinct from NEW.empresa_id;

update public.jobs set empresa_id = NEW.empresa_id
 where projeto_id = NEW.id and empresa_id is distinct from NEW.empresa_id;
```

Custo: baixo (poucos orçamentos e jobs por projeto). Mantém a promessa de
"projeto = fonte da verdade" sob edição real.

## Segurança e permissões

### RLS

- `empresas`
  - SELECT: `is_tenant_member(tenant_id)` — todos precisam ver rótulo/badge.
  - INSERT/UPDATE: `is_tenant_admin(tenant_id)` — só admin.
  - Sem policy DELETE. Soft-delete via `ativo=false`.
- `projetos`, `orcamentos`, `jobs`: sem mudança. RLS continua por tenant.

### GRANT

```sql
grant select, insert, update on public.empresas to authenticated;
```

### Regras que não podem depender só do frontend

- CNPJ único por tenant → índice único.
- Exatamente 1 principal por tenant ativa → índice parcial único.
- Não pode desativar a principal → validação na Server Action (rejeita antes
  do UPDATE e explica o motivo).
- Orçamento/job com `empresa_id` diferente do projeto → trigger sobrescreve.

### Auditoria

Server Action chama `log_audit_event(...)` com:

- `empresa_criada`
- `empresa_atualizada`
- `empresa_principal_alterada` (quando muda quem é a principal)
- `empresa_desativada` / `empresa_reativada`

`metadata` inclui id anterior/novo da principal quando aplicável.

## UI

### `/admin/page.tsx`

Ganha um segundo card no grid, ao lado de "Usuários":

- Título: **Empresas**
- Ícone: `Building2` (lucide)
- Descrição: "Cadastre e mantenha as pessoas jurídicas do grupo California."
- Contador: total de empresas ativas do tenant.
- Link: `/admin/empresas`.

### `/admin/empresas/page.tsx` (server component)

- `export const dynamic = "force-dynamic"` (regra de performance do projeto).
- `requireAdmin` no topo.
- Header no padrão de `/admin/usuarios`.
- Botão **"Nova empresa"** (client) abre drawer.
- Tabela com colunas:
  - **Razão social** (+ nome fantasia como subtítulo se existir)
  - **CNPJ** formatado
  - **Regional** (badge discreto com o nome)
  - **Cidade/UF**
  - **Status**: badge "PRINCIPAL" (California-red) e/ou "Inativa" (cinza)
- Linha inteira clicável abre drawer de edição. Ações secundárias
  (dropdown "⋯") param propagação.
- Dropdown por linha:
  - Editar
  - Marcar como principal (só se não for)
  - Desativar / Reativar

### Drawer de criar/editar (`empresa-drawer.tsx`)

React Hook Form + Zod. Blocos:

1. **Identificação** — Razão social, Nome fantasia, CNPJ (máscara
   `00.000.000/0000-00`), IE, IM.
2. **Endereço** — CEP (máscara `00000-000`), Logradouro, Número,
   Complemento, Bairro, Cidade, UF (Select das 27 UFs).
3. **Contato** — Telefone, E-mail.
4. **Faturamento** — Local de pagamento (texto), Instruções NF (textarea).
5. **Classificação** — Regional (Select das ativas), Principal (Switch),
   Ativa (Switch — só no modo editar).

Detalhes técnicos do projeto:

- `DialogHeader/DialogTitle` compostos dentro do `DrawerContent` (Radix não
  aceita `title` como prop em Drawer).
- `PopoverContent` dos Selects: `side="bottom"`, `avoidCollisions=false`,
  largura fixa (mesma memória do projeto — evita flip em forms).
- Validação Zod client-side + reexecução no server dentro da Server Action.

### Server Actions (`app/(app)/admin/empresas/actions.ts`)

- `criarEmpresa(input)` — valida com Zod, INSERT, chama `log_audit_event`.
  Se `principal=true`, primeiro dá UPDATE zerando o `principal` de qualquer
  outra empresa ativa do tenant (mesmo statement/tx) — o índice único
  parcial não deixa duas coexistirem.
- `atualizarEmpresa(id, input)` — mesma coisa, mas dispara
  `empresa_principal_alterada` se o flag virou true.
- `marcarPrincipal(id)` — atalho quando o usuário clica no dropdown "Marcar
  como principal".
- `desativarEmpresa(id)` / `reativarEmpresa(id)` — set `ativo`. Rejeita
  desativar se `principal=true`.
- Todas: `requireAdmin` + `revalidatePath` das telas afetadas.

### Formulário de projeto

Ganha campo **Empresa** (Select das ativas do tenant), pré-selecionado na
principal. Obrigatório no Zod. `empresa_id` é NOT NULL no banco após o
backfill.

### Formulário de orçamento e job

**Sem seletor**. UI pode mostrar "Empresa: X" em modo leitura — puxado do
projeto — para dar visibilidade.

### Listas de projeto/orçamento/job

- Nova coluna/badge **Empresa** em cada linha (nome fantasia se existir,
  senão razão social encurtada). Badge discreto, mesmo tom dos badges
  existentes.
- Filtro por empresa no topo (Select "Todas / [empresa]").
- Ambos sempre visíveis (mesmo com 1 empresa).
- Filtro é query string `?empresa=<id>`.

### Detalhe do projeto

Header mostra empresa junto com cliente/responsável/regional.

## Migração

Migration única: `supabase/migrations/20260731000001_task009_empresas.sql`.

Ordem:

1. `create table empresas` + índices + policies + grants.
2. Garantir regional NE no tenant California (insert if not exists).
3. Insert da empresa CALIFÓRNIA FILMES E PUBLICIDADE LTDA no tenant
   California, com:
   - CNPJ `19437976000154`
   - IE `ISENTO`, IM `479604001-42`
   - Logradouro `AV. DA FRANÇA`, Número `393`, Complemento `SETOR 2`,
     Bairro `Comércio`, Cidade `Salvador`, UF `BA`, CEP `40010-000`
   - Telefone `71991742040`, E-mail nulo
   - Local pagamento e Instruções NF nulos por enquanto
   - `regional_id` = a regional NE, `principal=true`, `ativo=true`
4. `alter projetos add column empresa_id nullable`; UPDATE preenchendo com
   a empresa acima; `set not null`; índice.
5. Mesmo para `orcamentos`; mesmo para `jobs`.
6. `create function enforce_empresa_from_projeto()`; triggers em
   `orcamentos` e `jobs`. **Depois** do backfill de 4/5 — se criasse antes,
   o UPDATE de backfill dos orçamentos/jobs disparava um trigger que
   procura `projeto.empresa_id` que naquele momento pode ainda ser nulo.
7. `create function cascade_empresa_para_filhos()`; trigger AFTER UPDATE em
   `projetos`.
8. Comentário/cabeçalho documentando rollback manual.

### Guarda-corpo do backfill

Antes do `set not null`, um `do $$ ... $$` verifica se existe projeto/
orçamento/job com `empresa_id` nulo. Se sim, `raise exception` com a lista
de ids. Evita `set not null` explodir em produção sem contexto.

## Verificação (critérios de "pronto")

1. Migration limpa em banco novo (`supabase db reset`).
2. Migration aplicada em cópia do banco atual: todos os projetos,
   orçamentos e jobs existentes ficam com `empresa_id` da California
   Salvador.
3. CRUD de empresa:
   - Admin cria segunda empresa.
   - Admin edita empresa existente.
   - Admin marca segunda como principal; a anterior deixa de ser
     automaticamente.
   - Admin tenta desativar a principal: bloqueado com mensagem clara.
   - Admin desativa uma não-principal e reativa depois.
4. Propagação:
   - Novo projeto criado na 2ª empresa → orçamento criado a partir dele
     grava `empresa_id` da 2ª empresa (via trigger, sem UI passar valor).
   - Job criado do orçamento aprovado idem.
   - `UPDATE` direto no banco em `orcamentos` com `empresa_id` diferente do
     projeto → trigger sobrescreve para o do projeto.
   - Admin edita `projetos.empresa_id` de um projeto existente → trigger de
     cascata atualiza orçamentos e jobs filhos.
5. UI operacional:
   - Listas de projeto/orçamento/job mostram badge da empresa.
   - Filtro por empresa restringe a lista.
   - Formulário de novo projeto pré-seleciona a empresa principal.
6. Segurança:
   - Usuário não-admin não consegue INSERT/UPDATE em empresas (via UI e via
     SQL autenticado).
   - Admin não vê empresas de outro tenant.
7. Auditoria: `select acao from audit_events order by created_at desc` mostra
   as ações de empresa (`empresa_criada`, `empresa_atualizada`,
   `empresa_principal_alterada`, `empresa_desativada`, `empresa_reativada`).
8. Performance (`docs/PERFORMANCE.md`):
   - Listas usam índice em `empresa_id`; filtro por empresa não faz table
     scan.
   - Nenhum embed pesado (`select("...empresa:empresas(*)")`) — só o
     necessário (id, nome fantasia/razão social).
   - Links de linha em listas grandes seguem `prefetch={false}` (padrão
     atual).
9. `pnpm lint && pnpm build` verde.
