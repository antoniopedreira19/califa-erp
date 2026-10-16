# Task 011 — Freelancers (Fase 1, Task 1): tabelas base

## Objetivo

Criar a fundação de banco do módulo **Freelancers**: as duas tabelas que todas as demais tasks das próximas fases vão referenciar.

1. `freelancers` — cadastro mestre (pessoa + dados de pagamento + PJ opcional + preferências).
2. `freelancer_cargos` — catálogo de cargos usado como autocomplete nos contratos (não é FK rígida).

A task entrega **só o banco**. Nenhuma tela, nenhuma rota, nenhuma action: tudo isso vem nas tasks 012 em diante.

## Fora de escopo (NÃO fazer nesta task)

- Tabela `freelancer_contratos` — Fase 2, task 012.
- Tabela `freelancer_solicitacoes` + mensagens + leituras — Fase 3.
- View de status (`freelancers_com_status`) — Fase 2 (depende dos contratos existirem).
- Trigger de histórico (`freelancer_contrato_historico`) — Fase 2/4.
- Rota pública de solicitação, chat, DOCX, buckets de Storage — tasks subsequentes.
- Qualquer componente de UI, página ou action.
- Importação de dados legados do AgCaliforniaRH — Fase 5.

## Spec de referência

Decisões arquiteturais travadas nos turnos de alinhamento (16/10/2026) com o Antônio:

- **Módulo isolado**, não dentro de `rh/`. URL base: `/freelancers/*`. Sidebar única "Freelancers" com sub-abas (Dashboard · Solicitações · Freelancers). Detalhado nas tasks de UI.
- **Multi-tenant**: toda tabela nasce com `tenant_id` + RLS por tenant, mesmo com Agência California como único tenant hoje.
- **Dedup por CPF** quando preenchido. CPF é **opcional** (freelancer estrangeiro ou sem CPF ainda cadastrado é válido). Unique parcial: só quando `cpf IS NOT NULL`.
- **Dedup de CNPJ também é por tenant** quando preenchido — mesma lógica.
- **Catálogo `freelancer_cargos` é isolado** do catálogo `cargos` do AgCaliforniaRH e também não reaproveita nenhum outro catálogo do califa-erp. É um catálogo próprio do módulo. Nome unique por tenant.
- **A tabela `freelas` existente (70 linhas, decisão 164) NÃO é mexida nesta task.** Ela continua servindo a verba de alimentação/transporte das PPs. Numa task futura (pós-Fase 5), vai apontar pra `freelancers.id` via FK ou ser substituída.
- **Papel "responsável"** não vive em `freelancers` — vive em `freelancer_contratos.responsavel_id` (Fase 2). O freela pode ter responsáveis diferentes por contrato ao longo do tempo. Esta task não precisa criar esse campo.
- **Campo `acao_prevista`** (contratar / renovar / manter / substituir / encerrar) é um workflow do RH. Nasce em `freelancers` porque é característica da pessoa (não do contrato). Default `null`.

## Contexto do ponto de partida

### Já pronto no banco (reusa, não refaz)

- `tenants` + `tenant_members` + `profiles` (Task 001).
- Enum `app_role` já inclui `freelancer` (reservado pra freela com login — não é esse o uso agora, mas o valor existe).
- Helpers RLS prontos: `is_tenant_member(tenant_id)`, `is_tenant_admin(tenant_id)`, `is_tenant_rh(tenant_id)`, `is_tenant_financeiro(tenant_id)`.
- Tabela `audit_events` disponível pra registrar auditoria (ver `lib/audit.ts`).

### Padrões de banco a seguir (do `docs/FLUXO-BANCO.md` + CLAUDE.md)

- RLS ligado desde o `create table`.
- Policies `authenticated` apenas; `anon` sem acesso.
- `GRANT select, insert, update, delete ON ... TO authenticated` explícito (sem GRANT, policy não vale).
- Índice em cada FK que vai ser filtrada em query.
- `tenant_id uuid not null references tenants(id) on delete cascade`.
- Trigger de `updated_at` com função `set_updated_at_timestamp()` já existente.
- Policies RLS usam `(select auth.uid())` (sub-query) para permitir o Postgres fazer initplan e não re-executar por linha — ver `docs/PERFORMANCE.md`.

### Estrutura mínima que precisa aparecer

```
freelancers
├─ id (uuid, PK)
├─ tenant_id (FK tenants, not null)
├─ nome_social (text, not null) ← único campo obrigatório
├─ nome_completo (text, null)
├─ cpf (text, null, unique parcial por tenant)
├─ rg (text, null)
├─ data_nascimento (date, null)
├─ email, celular (text, null)
├─ cep, rua, numero, complemento, bairro, cidade (text, null)
├─ cnpj (text, null, unique parcial por tenant)
├─ razao_social (text, null)
├─ cartao_cnpj_url (text, null) ← storage path
├─ tipo_pagamento (text, null, check in ('conta_bancaria','pix'))
├─ banco, agencia, conta, pix_chave (text, null)
├─ cor_raca, identidade_genero, deficiencia (text, null)
├─ saude_obs, contato_emergencia (text, null)
├─ acao_prevista (text, null, check in ('contratar','renovar','manter','substituir','encerrar'))
├─ origem (text, not null, default 'manual', check in ('manual','form_publico','migracao'))
├─ created_at, updated_at (timestamptz, not null)
├─ created_by, updated_by (uuid, FK profiles, null)
└─ check: (cnpj is null and razao_social is null) or (cnpj is not null and razao_social is not null)
      ← par CNPJ+razao_social é obrigatório junto, ou os dois null

freelancer_cargos
├─ id (uuid, PK)
├─ tenant_id (FK tenants, not null)
├─ nome (text, not null)
├─ ativo (boolean, not null, default true)
├─ created_at (timestamptz, not null)
├─ created_by (uuid, FK profiles, null)
└─ unique (tenant_id, nome)
```

### RLS (policies)

#### `freelancers`

- **SELECT**: `is_tenant_member(tenant_id)` — todos os membros ativos do tenant veem o cadastro mestre. Visibilidade mais fina (GP só vê os freelas com contrato dele) é implementada na Fase 2 via join com `freelancer_contratos`, não aqui. Nesta fase o escopo é tenant.
- **INSERT**: `is_tenant_admin(tenant_id) OR is_tenant_rh(tenant_id) OR is_tenant_financeiro(tenant_id)` — só admin, RH e Financeiro cadastram freelancer novo. GP pede via solicitação (Fase 3) ou pede RH pra cadastrar manual.
- **UPDATE**: idem INSERT.
- **DELETE**: `is_tenant_admin(tenant_id) OR is_tenant_rh(tenant_id)` — apagar um freelancer é raro; só admin/RH. Financeiro não deleta.

#### `freelancer_cargos`

- **SELECT**: `is_tenant_member(tenant_id)` — todos leem.
- **INSERT / UPDATE / DELETE**: `is_tenant_admin(tenant_id) OR is_tenant_rh(tenant_id)` — RH e admin gerenciam catálogo.

### Índices

- `freelancers (tenant_id)` — filtro base.
- `freelancers (tenant_id, cpf)` — unique parcial `where cpf is not null`.
- `freelancers (tenant_id, cnpj)` — unique parcial `where cnpj is not null`.
- `freelancers (tenant_id, lower(nome_social))` — busca por nome.
- `freelancer_cargos (tenant_id)` — filtro base.
- `freelancer_cargos (tenant_id, nome)` — unique (não parcial).
- `freelancer_cargos (tenant_id, lower(nome))` — busca case-insensitive.

### Seed inicial de cargos

Copiar os ~65 cargos do AgCaliforniaRH (`supabase/schema.sql` linhas 181–247) e inserir com `tenant_id` da Agência California. Idempotente via `on conflict (tenant_id, nome) do nothing`.

### Atualização de `lib/types.ts`

Adicionar no arquivo:

- Tipo `TipoPagamentoFreelancer = "conta_bancaria" | "pix"`.
- Tipo `AcaoPrevistaFreelancer = "contratar" | "renovar" | "manter" | "substituir" | "encerrar"`.
- Tipo `OrigemFreelancer = "manual" | "form_publico" | "migracao"`.
- Interface `Freelancer` com todas as colunas (TypeScript espelha o SQL, mantido à mão conforme regra do projeto).
- Interface `FreelancerCargo` idem.

## Decisões travadas (importante não re-abrir)

1. **CPF opcional**: freela sem CPF pode existir no cadastro. Validação de CPF (dígitos) acontece na UI (Fase 1 task 2), não no banco. Unique só vale quando `IS NOT NULL`.
2. **CNPJ + razão social são par**: ou os dois null, ou os dois preenchidos. Garantido por check constraint no banco.
3. **Sem campo `ativo` em `freelancers`**: não existe soft-delete por flag. "Status do freelancer" é derivado dos contratos (Fase 2 define a view). Freela sem contrato ativo = "sem vínculo". Isso simplifica muito a lógica e espelha o AgCaliforniaRH.
4. **Nome dividido** (nome / sobrenome) do AgCaliforniaRH NÃO é portado como colunas separadas. `nome_social` (apelido ou social) + `nome_completo` (opcional, usado no contrato oficial). Isso espelha o modelo real deles e evita confusão.
5. **Endereço é estruturado** (CEP, rua, número, complemento, bairro, cidade). O AgCaliforniaRH tinha coluna `endereco` legada em texto livre; aqui começamos limpo com os campos estruturados. Legados migrados vão popular os campos estruturados a partir do parse do texto livre na Fase 5.
6. **`cidade` é texto livre**, não FK pra `cidades`. Em `freelancers` o `cidade` é a cidade de residência do freela (pode ser qualquer uma do Brasil, não só as cidades operacionais da California). A tabela `cidades` do califa-erp é usada em `jobs` e `projetos` com propósito diferente.
7. **Sem campo `status_real` em `freelancers`**: no AgCaliforniaRH esse campo vive em `contratos`. Aqui também vai pra `freelancer_contratos` (Fase 2). "Pessoa ativa" = tem contrato com `status_real=true`.

## Escopo de banco (migration a aplicar)

**Arquivo**: `supabase/migrations/20261016000001_freelancers_f1_tabelas_base.sql`

Conteúdo:

1. `create table freelancers (...)` com todas as colunas, checks e defaults.
2. `create table freelancer_cargos (...)`.
3. Índices (todos listados acima).
4. `alter table ... enable row level security` nas duas.
5. Policies (todas listadas acima).
6. `grant select, insert, update, delete on freelancers, freelancer_cargos to authenticated` + revogação explícita de `anon` (defensiva).
7. Trigger `set_updated_at_timestamp` em `freelancers`.
8. Seed de cargos (idempotente, apontando pro tenant Agência California via `select id from tenants where slug = 'agencia-california' limit 1`).
9. Comentário no topo do arquivo explicando o porquê de cada decisão não óbvia.

## Critérios de pronto

- [ ] Arquivo de migration criado em `supabase/migrations/` com prefixo `20261016000001_`.
- [ ] Migration aplicada via MCP (`mcp__supabase-write__apply_migration`).
- [ ] Verificação via MCP:
  - [ ] `freelancers` existe com todas as colunas listadas (consultar `information_schema.columns`).
  - [ ] `freelancer_cargos` existe com todas as colunas.
  - [ ] RLS ativo nas duas tabelas (`pg_tables.rowsecurity = true`).
  - [ ] Policies de SELECT / INSERT / UPDATE / DELETE criadas nas duas.
  - [ ] Grants pra `authenticated` existem (`information_schema.role_table_grants`).
  - [ ] `anon` **não** tem grant nenhum nas duas tabelas.
  - [ ] Índices criados (consultar `pg_indexes`).
  - [ ] Seed de cargos inseriu ~65 linhas no tenant Agência California (`select count(*) from freelancer_cargos where tenant_id = ...`).
- [ ] `get_advisors` (segurança e performance) sem alerta novo apontando pra as tabelas criadas.
- [ ] `lib/types.ts` atualizado com `Freelancer`, `FreelancerCargo` e os três type aliases.
- [ ] `npm run typecheck` passa limpo.
- [ ] `npm run lint` passa limpo.
- [ ] Migration e update de `lib/types.ts` no mesmo commit (regra do `docs/FLUXO-BANCO.md`).

## Próxima task

**Task 012 — Freelancers (Fase 1, Task 2)**: estrutura de rotas `/freelancers/*` + layout com sub-abas + página stub do Dashboard + sidebar entry. Entrega a casca navegável, sem conteúdo real nos cards ainda.
