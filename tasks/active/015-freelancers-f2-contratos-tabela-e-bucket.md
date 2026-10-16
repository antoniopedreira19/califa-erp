# Task 015 — Freelancers (Fase 2, Task 1): tabela de contratos + bucket Storage

## Objetivo

Entregar o **banco** da Fase 2:

1. Tabela `freelancer_contratos` com todas as colunas, FKs, RLS, grants, índices.
2. Bucket Supabase Storage `freelancer-arquivos` com RLS por tenant + por contrato.
3. Tipos TypeScript correspondentes em `lib/types.ts`.
4. Verificação completa via MCP + rodada de advisors.

Nenhuma UI, nenhuma action, nenhuma geração de DOCX — tudo isso vem nas tasks subsequentes da Fase 2.

## Fora de escopo

- View `freelancers_com_status` com cálculo de `status_contrato`/`status_calculado` — **Task 016**.
- Trigger de histórico (`freelancer_contrato_historico`) — Fase 4.
- UI de novo contrato / editar contrato — **Task 017**.
- Geração do DOCX (`lib/freelancer-contrato-docx.ts`) — **Task 018**.
- Upload do PDF assinado — **Task 017** (consome o bucket desta task).
- Distrato — Fase 4.
- Migração dos legados — Fase 5.

## Decisões travadas (alinhadas 16/10/2026)

### `freelancer_contratos` — colunas-chave

- **`freelancer_id uuid NOT NULL FK freelancers ON DELETE CASCADE`** — contrato só existe se o freela existe.
- **`job_id uuid NULL FK jobs`** — nullable pra permitir legados sem job real. Novos contratos exigem via check constraint (`origem_sistema='califa_erp' → job_id NOT NULL`).
- **`responsavel_id uuid NULL FK profiles`** — quem toma conta do contrato (GP, Produtor, RH, Financeiro, Admin). Validação de role fica na UI nesta task (dropdown filtrado) e numa task posterior endurecemos no banco via trigger.
- **`nome_job text NOT NULL`** — snapshot do nome do job no momento da assinatura. Preservado mesmo se o job no califa-erp for renomeado depois. Em legados vem do texto livre que estava no AgCaliforniaRH.
- **`cargo text`** — texto livre, com autocomplete via `freelancer_cargos`. Não é FK rígida.
- **`tipo text NOT NULL`** check in (`mensal`, `periodo`, `diarias`) — controla a redação do DOCX (duração em meses+dias ou dias; "mensalmente" ou "conforme acordado"). Não controla cálculo nem fluxo.
- **`valor numeric(14,2) NOT NULL`** — valor mensal, do período inteiro ou por diária (depende do `tipo`). UI/DOCX interpretam.
- **`data_inicio`, `data_termino` (date)** — opcional em stubs, mas no fluxo normal vêm preenchidos no cadastro.
- **`cidade text`** — cidade onde o job acontece (≠ cidade de residência do freela).
- **`observacoes text`** — texto livre.
- **`status_real boolean NOT NULL default true`** — "pessoa ainda trabalha neste contrato?". Flipa pra false quando o contrato é encerrado ou distrato é aplicado.
- **`arquivo_url`, `minuta_url` (text)** — paths do PDF assinado e do DOCX gerado, respectivamente, dentro do bucket.
- **Distrato (snapshot)**:
  - `data_termino_original date` — guarda a data antes da 1ª antecipação.
  - `distrato_minuta_url text` — DOCX de distrato (rascunho).
  - `distrato_arquivo_url text` — PDF assinado (aplicar o distrato depende dele estar preenchido).
  - `distrato_data_proposta date` — data sugerida pela antecipação.
  - `distrato_motivo text`.
  - `distrato_solicitado_em timestamptz`, `distrato_solicitado_por uuid FK profiles`.
- **`origem_sistema text NOT NULL default 'califa_erp'`** check in (`califa_erp`, `ag_california_rh`) — distingue contrato novo de contrato legado migrado.
- **Auditoria**: `created_at`, `updated_at`, `created_by`, `updated_by`.

### Constraints

- **Check `freelancer_contratos_job_obrigatorio_em_novos`**: `origem_sistema = 'ag_california_rh' OR job_id IS NOT NULL`. Garante que contrato criado no califa-erp tem job real; legados aceitam `job_id = null`.
- **Check `freelancer_contratos_tipo`**: `tipo IN ('mensal','periodo','diarias')`.
- **Check `freelancer_contratos_origem_sistema`**: `origem_sistema IN ('califa_erp','ag_california_rh')`.
- **Check `freelancer_contratos_termino_apos_inicio`**: `data_termino IS NULL OR data_inicio IS NULL OR data_termino >= data_inicio`. Evita contrato invertido.

### RLS

- **SELECT**: `is_tenant_member(tenant_id)` — todos leem (restrição mais fina via empresa/regional pode vir depois, mas por ora amplo pra todos os perfis que veem o módulo).
- **INSERT / UPDATE**: `is_tenant_admin OR is_tenant_rh OR is_tenant_financeiro`.
- **DELETE**: `is_tenant_admin OR is_tenant_rh`.

### Índices

- `freelancer_contratos (tenant_id)`.
- `freelancer_contratos (freelancer_id)` — buscar contratos do freela.
- `freelancer_contratos (job_id) WHERE job_id IS NOT NULL` — buscar contratos de um job.
- `freelancer_contratos (responsavel_id) WHERE responsavel_id IS NOT NULL` — buscar contratos sob responsabilidade de alguém.
- `freelancer_contratos (tenant_id, data_termino)` — busca por vencimento, usado pra alertar vencendo/vencido.
- `freelancer_contratos (tenant_id, status_real)` — filtrar ativos/inativos.
- Covering indexes nas FKs opcionais `created_by`, `updated_by`, `distrato_solicitado_por` — advisor vai flagar senão (lição da Task 011).

### Bucket Storage `freelancer-arquivos`

- **Privado** (sem acesso público, URLs assinados temporários no uso).
- **Path convention**:
  - `{tenant_id}/contratos/{contrato_id}/minuta.docx` — DOCX gerado.
  - `{tenant_id}/contratos/{contrato_id}/assinado.pdf` — PDF assinado.
  - `{tenant_id}/contratos/{contrato_id}/distrato-minuta.docx` — rascunho de distrato.
  - `{tenant_id}/contratos/{contrato_id}/distrato-assinado.pdf` — distrato assinado.
  - `{tenant_id}/freelancers/{freelancer_id}/cartao-cnpj.{ext}` — cartão CNPJ (volta a ser possível agora na Fase 2).

- **Policies RLS no bucket** (via `storage.objects`):
  - SELECT: `is_tenant_member(tenant_id)` extraído do primeiro segmento do `name`.
  - INSERT / UPDATE / DELETE: `is_tenant_admin OR is_tenant_rh OR is_tenant_financeiro` do mesmo tenant.
  - Idêntico ao padrão `desembolsos-anexos` ou outro bucket já existente no califa-erp — vou verificar o padrão real antes de aplicar.

## Contexto do ponto de partida

### Já pronto

- Tabela `freelancers` (Task 011).
- Tabela `jobs` do califa-erp (não é módulo nosso — já existe com código, cliente, orçamento, etc).
- RLS helpers: `is_tenant_member`, `is_tenant_admin`, `is_tenant_rh`, `is_tenant_financeiro`.
- Função `set_updated_at` pra trigger.
- Padrão de bucket Storage com RLS em algum módulo (vou olhar `pedidos_compra_anexos` ou `desembolsos_anexos` como referência).

### Pontos de atenção

- `jobs.id` é a FK alvo — não `projetos.id`, não `orcamentos.id`. Checar que a FK aponta certo.
- Status `jobs` tem valores (`aberto`, `cancelado`, `aguardando_abertura`, `rejeitado_financeiro`, `finalizado`) — contrato não deve impedir seleção por status (talvez a UI filtre mas o banco aceita qualquer job do tenant).
- `jobs.tenant_id` já existe — contrato valida que `job.tenant_id = contrato.tenant_id` via check? Fica difícil (cross-table). Deixo pra RLS/UI garantir. Em caso de bug no futuro, teste integração pega.
- Advisor vai flagar FKs sem covering index — já antecipei na lista de índices.

## Escopo (o que a task entrega)

### 1. Arquivos novos

```
supabase/migrations/
└── 20261016000002_freelancers_f2_contratos_tabela_e_bucket.sql
```

### 2. Arquivos modificados

- `lib/types.ts` — adicionar `FreelancerContrato`, `TipoFreelancerContrato`, `OrigemFreelancerContratoSistema`.

### 3. Migration

Conteúdo em três blocos:
1. `create table freelancer_contratos` com todas as colunas, defaults, checks.
2. Índices (incluindo covering das FKs opcionais).
3. RLS: `enable row level security`, 4 policies (SELECT/INSERT/UPDATE/DELETE), trigger `updated_at`, grants pra `authenticated`, revoke de `anon`.
4. Bucket: `insert into storage.buckets` com nome `freelancer-arquivos`, privado.
5. Policies de storage: SELECT / INSERT / UPDATE / DELETE em `storage.objects`, filtrando por `bucket_id` + primeiro segmento do `name` (tenant_id).

### 4. Tipos TypeScript

```ts
// lib/types.ts
export type TipoFreelancerContrato = "mensal" | "periodo" | "diarias";
export type OrigemFreelancerContratoSistema = "califa_erp" | "ag_california_rh";

export interface FreelancerContrato {
  id: string;
  tenant_id: string;
  freelancer_id: string;
  job_id: string | null;
  responsavel_id: string | null;

  nome_job: string;
  cargo: string | null;
  tipo: TipoFreelancerContrato;
  valor: number;
  data_inicio: string | null;
  data_termino: string | null;
  cidade: string | null;
  observacoes: string | null;

  status_real: boolean;
  arquivo_url: string | null;
  minuta_url: string | null;

  // Distrato
  data_termino_original: string | null;
  distrato_minuta_url: string | null;
  distrato_arquivo_url: string | null;
  distrato_data_proposta: string | null;
  distrato_motivo: string | null;
  distrato_solicitado_em: string | null;
  distrato_solicitado_por: string | null;

  origem_sistema: OrigemFreelancerContratoSistema;

  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}
```

## Critérios de pronto

- [ ] Migration aplicada via MCP (`apply_migration`).
- [ ] Tabela `freelancer_contratos` existe com todas as colunas e constraints.
- [ ] RLS ativo + 4 policies no lugar.
- [ ] Grants pra `authenticated`, nada pra `anon`.
- [ ] Trigger `updated_at` funcionando.
- [ ] Índices criados, incluindo os covering das FKs opcionais.
- [ ] Bucket `freelancer-arquivos` existe e é privado.
- [ ] Policies de storage ativas (SELECT/INSERT/UPDATE/DELETE).
- [ ] `get_advisors` sem alerta novo apontando pra tabela ou bucket.
- [ ] `lib/types.ts` com `FreelancerContrato` + os 2 type aliases.
- [ ] `npm run typecheck` passa.
- [ ] `npm run lint` passa (sem warnings novos).

## Próxima task (016)

**View `freelancers_com_status`** que calcula `status_contrato` + `status_calculado` cruzando freelancer + último contrato. Também inclui `cargo` e `nome_job` do contrato ativo nas respostas. Depois dela, a lista de freelancers pode mostrar cargo e status (coluna que hoje está vazia), e os 4 cards de análise rápida ficam prontos pra chegar na Task 018 do Dashboard.
