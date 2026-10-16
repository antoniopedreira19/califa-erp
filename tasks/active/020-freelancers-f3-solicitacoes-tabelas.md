# Task 020 — Freelancers (Fase 3, Task 1): tabelas de solicitação + chat + realtime

## Objetivo

Entregar o **banco** da Fase 3:

1. Enum `freelancer_solicitacao_status`.
2. Tabela `freelancer_solicitacoes` — pedido de contratação (GP/Produtor pede, RH/Fin aprova).
3. Tabela `freelancer_solicitacao_mensagens` — chat entre solicitante e aprovador.
4. Tabela `freelancer_solicitacao_mensagens_leituras` — carimbo de leitura por usuário (badge de não lidas).
5. RPC `get_freelancer_solicitacao_mensagens_nao_lidas()` — contagem por solicitação para o user corrente.
6. Realtime habilitado em `freelancer_solicitacao_mensagens` (publication `supabase_realtime`).
7. Tipos TypeScript correspondentes em `lib/types.ts`.
8. Verificação completa via MCP + advisors.

Nenhuma UI, nenhuma action, nenhum endpoint público — tudo isso vem nas tasks 021 (UI) e 022 (fluxo público).

## Fora de escopo

- UI da aba Solicitações (`/freelancers/solicitacoes`) com lista + popover + chat realtime — **Task 021**.
- Dialog "Nova solicitação" — Task 021.
- Rota pública `/form/freelancer-solicitacao/[token]` + endpoint `submit` atômico — **Task 022**.
- Dashboard mostrando solicitações pendentes/minhas — Fase 4.

## Decisões travadas

### Enum `freelancer_solicitacao_status`

5 valores: `pendente | aprovada | rejeitada | cadastrada | cancelada`.

- **pendente**: nasceu, aguarda RH.
- **aprovada**: RH deu ok, token válido, freela ainda não preencheu.
- **rejeitada**: RH recusou, com motivo. Terminal.
- **cadastrada**: freela usou o link, sistema criou `freelancer` + `freelancer_contrato`. Terminal.
- **cancelada**: solicitante (ou admin) cancelou antes de aprovação ou do uso. Terminal.

### `freelancer_solicitacoes`

- **`id`** uuid PK.
- **`tenant_id`** NOT NULL FK tenants.
- **`token`** text UNIQUE NOT NULL default `encode(gen_random_bytes(16), 'hex')` — chave pública segura. Freela usa `/form/freelancer-solicitacao/<token>`.
- **`solicitante_id`** uuid FK profiles — quem criou. Pode ser GP, Produtor, qualquer role com permissão.
- **Dados do freela proposto** (texto livre; freela confirma depois):
  - `nome_freela text NOT NULL`
  - `cpf_freela text` (null se desconhecido)
- **Dados do contrato pré-aprovado**:
  - `job_id uuid NOT NULL FK jobs` — amarra ao job real já na solicitação. Ao criar o contrato pelo submit, usa o mesmo `job_id`.
  - `cargo text`
  - `valor numeric(14,2) NOT NULL`
  - `tipo text NOT NULL` check mensal/periodo/diarias
  - `data_inicio date`, `data_termino date`
  - `cidade text` (cidade do trabalho)
  - `observacoes text`
- **Status + metadados**:
  - `status freelancer_solicitacao_status NOT NULL default 'pendente'`
  - `aprovado_por uuid FK profiles`, `aprovado_em timestamptz`, `expira_em timestamptz`
  - `rejeitado_por uuid FK profiles`, `rejeitado_em timestamptz`, `rejeicao_motivo text`
  - `cancelado_por uuid FK profiles`, `cancelado_em timestamptz`
- **Resultado do cadastro** (preenchidos quando status=cadastrada):
  - `freelancer_id uuid FK freelancers`
  - `contrato_id uuid FK freelancer_contratos`
- **Auditoria**: `created_at`, `updated_at`.

### RLS

- **SELECT**: `is_tenant_member(tenant_id)` **AND** (`is_tenant_admin OR is_tenant_rh OR is_tenant_financeiro OR solicitante_id = auth.uid()`). Admin/RH/Fin veem tudo; demais veem só as próprias.
- **INSERT**: solicitante_id = auth.uid() AND status = 'pendente' (não pode nascer já aprovada).
- **UPDATE**: policies específicas por campo não cabem no RLS; vou simplificar e deixar UPDATE pra `is_tenant_admin OR is_tenant_rh OR is_tenant_financeiro OR solicitante_id = auth.uid()`. O que não pode ser mudado por quem (GP não aprova a própria, por exemplo) fica travado nas server actions.
- **DELETE**: nenhum — soft via status=cancelada.

### `freelancer_solicitacao_mensagens`

- **`id`** uuid PK.
- **`solicitacao_id`** uuid FK ON DELETE CASCADE.
- **`autor_id`** uuid FK profiles ON DELETE SET NULL.
- **`texto`** text NOT NULL check length 1–2000.
- **`created_at`** timestamptz.
- **RLS**:
  - SELECT: pode ler quem pode ler a solicitação (join com `freelancer_solicitacoes`).
  - INSERT: `autor_id = auth.uid()` AND user pode ler a solicitação.
- **Realtime**: `alter publication supabase_realtime add table freelancer_solicitacao_mensagens`.

### `freelancer_solicitacao_mensagens_leituras`

- **`solicitacao_id`** uuid FK + **`user_id`** uuid FK, PK composto.
- **`last_read_at`** timestamptz default now().
- **RLS**: `user_id = auth.uid()` em todas as ops.

### RPC `get_freelancer_solicitacao_mensagens_nao_lidas()`

- Retorna `(solicitacao_id uuid, nao_lidas bigint)[]`.
- SECURITY INVOKER (respeita RLS).
- Lógica: pra cada mensagem com `autor_id != auth.uid()`, se não existe linha em `leituras` ou `created_at > last_read_at`, conta.

## Contexto do ponto de partida

### Já pronto

- `freelancers`, `freelancer_contratos`, `jobs` com RLS.
- Helpers `is_tenant_member`, `is_tenant_admin`, etc.
- Função `set_updated_at` pra trigger.
- Padrão de realtime no califa-erp — verificar o chat de job (`jobs_mensagens`).

### Pontos de atenção

- `token` precisa `encode(gen_random_bytes(16), 'hex')` — exige a extensão `pgcrypto`. Verificar se já está instalada.
- Enum criado em migration própria **sozinho** (CLAUDE.md diz: "um valor novo não pode ser usado na mesma transação em que é criado"). Vou criar o enum junto com a tabela — isso funciona porque usar o enum **como tipo de coluna** no mesmo transaction é ok; o que não pode é usar `ALTER TYPE ... ADD VALUE` + referência imediata.
- Advisor flagou FKs sem covering index nas tasks anteriores — já antecipar.

## Escopo

### 1. Arquivos novos

```
supabase/migrations/
└── 20261016000004_freelancers_f3_solicitacoes_tabelas.sql
```

### 2. Arquivos modificados

- `lib/types.ts` — enum `FreelancerSolicitacaoStatus`, interfaces `FreelancerSolicitacao`, `FreelancerSolicitacaoMensagem`, `FreelancerSolicitacaoMensagemLeitura`.

### 3. Migration

1. `create extension if not exists pgcrypto;` (se não existir).
2. `create type freelancer_solicitacao_status as enum (...)`.
3. `create table freelancer_solicitacoes` + indexes + RLS + policies + trigger updated_at + grants.
4. `create table freelancer_solicitacao_mensagens` + indexes + RLS + grants.
5. `create table freelancer_solicitacao_mensagens_leituras` + indexes + RLS + grants.
6. `alter publication supabase_realtime add table freelancer_solicitacao_mensagens`.
7. `create function get_freelancer_solicitacao_mensagens_nao_lidas() returns table (...) security invoker ...`.
8. Grants pra `authenticated` em todas as 3 tabelas e na função; `anon` nada.

## Critérios de pronto

- [ ] Migration aplicada via MCP.
- [ ] Enum existe.
- [ ] 3 tabelas existem com todas as colunas, FKs, checks.
- [ ] RLS ativo + policies em todas as 3.
- [ ] Realtime habilitado em `freelancer_solicitacao_mensagens`.
- [ ] Função RPC existe e retorna o shape esperado.
- [ ] Grants pra `authenticated`, nada pra `anon`.
- [ ] Indexes nas FKs (covering onde necessário).
- [ ] `get_advisors` sem alerta novo.
- [ ] `lib/types.ts` com os 4 tipos novos.
- [ ] `npm run typecheck` passa.
- [ ] `npm run lint` passa.

## Próxima task (021)

UI das solicitações: `/freelancers/solicitacoes` com lista + popover de detalhes + chat realtime + dialog "Nova solicitação" + ações aprovar/rejeitar/cancelar.
