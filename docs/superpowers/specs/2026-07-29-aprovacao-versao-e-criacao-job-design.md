# Design: Aprovação de versão + Criação de Job

**Data:** 2026-07-29
**Escopo:** Módulo Comercial → Operação (fecha o loop Orçamento → Job)
**Combina duas tarefas em um único ciclo:** Task 004 Fase E (aprovação) + Task 005 (criação de job)
**Ordem de deploy:** big-bang, uma migration única + PR único.
**Fora deste escopo:** planejado/realizado do job, gestão detalhada de produção, contas a pagar/receber, DRE.

---

## 1. Motivação

Hoje o fluxo comercial pára em "versão criada com itens". Falta o fechamento: o cliente aprova uma versão, aquela versão vira a versão oficial do orçamento, e o orçamento aprovado destrava a criação do job operacional (a "boca de campo" da agência).

Task 004 Fase E foi documentada há semanas mas nunca implementada. Task 005 (Jobs) foi documentada em `tasks/005-criacao-job-orcamento-aprovado.md` com campos genéricos (`tipo`, `campanha`, `codigo`, `data_abertura`). O que o time da California realmente precisa nos campos do job são: **Nome, Cliente, Produto, Regional, Cidade, Datas, Responsável, Valor Total**. Além disso, um projeto pode ter múltiplos orçamentos aprovados → múltiplos jobs — nesse caso é obrigatório definir 1 job principal + N sub-jobs.

Este spec substitui a versão inicial de `tasks/005` no que tange aos campos e regras de negócio (o arquivo original fica como referência histórica).

## 2. Fluxo end-to-end

```
Versão v1 do Orçamento A tem grupos + itens
  ↓ (GP clica "Aprovar versão")
Versão v1 = 'aprovada'
Outras versões do Orçamento A viram 'substituida' (trigger no banco)
Orçamento A = 'aprovado' com versao_aprovada_id preenchido
  ↓ (aparece botão "Criar job" no header do orçamento)
GP clica → abre drawer "Criar job"
Se já existe ≥1 job no mesmo projeto → drawer mostra bloco "Hierarquia"
GP preenche campos → salva
Job JOB-NNNN criado
Orçamento A vira status = 'job_criado'
  ↓ (botão vira "Ver job JOB-NNNN")
```

## 3. Decisões-chave (respostas do brainstorming)

| Decisão | Escolha | Racional |
|---|---|---|
| Aprovar e Criar Job | **Passos separados** (Opção A) | Aprovar cria o "aprovado" state; criar job é ação subsequente |
| Timing pai/sub-job | **Definido na criação do 2º job**, mutável depois | Intuitivo: 1º é principal automático |
| Terminologia | **"principal" e "sub-job"** (não "pai/filho") | Preferência do usuário |
| Nome do job | Texto livre, sem pre-preenchimento | Job pode ter nome diferente do orçamento |
| Cliente | Read-only, derivado do projeto via join | Não denormalizado |
| Produto | Texto livre | Sem tabela nova por ora |
| Regional | **Nova tabela `regionais`** (cadastro tenant-wide) | Vocabulário reutilizado; UI de admin em `/cadastros/regionais` |
| Cidade | Texto livre | Sem cadastro |
| Data Início/Fim | Pre-preenchido de `orcamento.data_*_prevista`, editável | Job pode ter cronograma próprio |
| Responsável | Pre-preenchido de `projeto.responsavel_id`, editável | Sub-job pode ter GP diferente |
| Valor Total | Pre-preenchido do faturamento da versão aprovada, editável | Renegociação rara mas possível |
| Código do job | **`JOB-NNNN`** sequencial por tenant | Simples, independente de projeto |
| Após criar job | Redireciona pra página do orçamento (link "Ver job") | Contexto mantido |
| Desaprovar versão | **Sim, se orçamento não tem job ativo** | Correção de engano |
| Rota `/jobs` | Placeholder "gestão em breve" | Sem listagem por ora |
| Rota `/jobs/[jobId]` | Metadata + edição inline via drawer + hierarquia + status | Detalhe funcional |
| Status do job | **Ciclo completo**: `aberto → em_producao → finalizado` (linear) + `cancelado` (terminal) | Preparado pra evolução |

## 4. Schema — migration `20260728000004_task005_jobs.sql`

### 4.1 Tabela `regionais` (novo cadastro)

```sql
create table public.regionais (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  nome text not null,
  ativo boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regionais_nome_nao_vazio check (length(trim(nome)) > 0)
);

create unique index uniq_regional_nome_por_tenant on public.regionais(tenant_id, lower(nome));
create index idx_regionais_tenant on public.regionais(tenant_id);
create index idx_regionais_ativo on public.regionais(tenant_id, ativo);

drop trigger if exists trg_regionais_updated_at on public.regionais;
create trigger trg_regionais_updated_at
  before update on public.regionais
  for each row execute function public.set_updated_at();

alter table public.regionais enable row level security;

create policy regionais_select on public.regionais for select to authenticated using (public.is_tenant_member(tenant_id));
create policy regionais_insert on public.regionais for insert to authenticated with check (public.is_tenant_member(tenant_id));
create policy regionais_update on public.regionais for update to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.regionais to authenticated;
```

### 4.2 Enum `job_status`

```sql
do $$
begin
  if not exists (select 1 from pg_type where typname = 'job_status') then
    create type public.job_status as enum ('aberto', 'em_producao', 'finalizado', 'cancelado');
  end if;
end$$;
```

### 4.3 Tabela `jobs`

```sql
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  codigo text not null,

  -- Origem
  projeto_id uuid not null references public.projetos(id) on delete restrict,
  orcamento_id uuid not null references public.orcamentos(id) on delete restrict,
  versao_orcamento_aprovada_id uuid not null references public.versoes_orcamento(id) on delete restrict,

  -- Campos operacionais
  nome text not null,
  produto text,
  regional_id uuid references public.regionais(id) on delete restrict,
  cidade text,
  data_inicio_prevista date,
  data_fim_prevista date,
  responsavel_id uuid not null references public.profiles(id) on delete restrict,
  valor_total numeric(14, 2),

  -- Hierarquia (self-reference)
  job_pai_id uuid references public.jobs(id) on delete restrict,

  -- Estado
  status public.job_status not null default 'aberto',

  -- Auditoria
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Regras
  constraint jobs_nao_pai_de_si_mesmo check (job_pai_id is null or job_pai_id != id),
  constraint jobs_datas_ordem check (
    data_inicio_prevista is null
    or data_fim_prevista is null
    or data_fim_prevista >= data_inicio_prevista
  )
);

-- Códigos únicos por tenant
create unique index uniq_jobs_codigo_por_tenant on public.jobs(tenant_id, codigo);

-- 1 job ativo por orçamento (cancelar libera recriar)
create unique index uniq_jobs_por_orcamento_ativo
  on public.jobs(tenant_id, orcamento_id)
  where status != 'cancelado';

-- 1 principal por projeto (entre não-cancelados)
create unique index uniq_jobs_principal_por_projeto
  on public.jobs(projeto_id)
  where job_pai_id is null and status != 'cancelado';

create index idx_jobs_tenant on public.jobs(tenant_id);
create index idx_jobs_projeto on public.jobs(projeto_id);
create index idx_jobs_orcamento on public.jobs(orcamento_id);
create index idx_jobs_versao on public.jobs(versao_orcamento_aprovada_id);
create index idx_jobs_responsavel on public.jobs(responsavel_id);
create index idx_jobs_regional on public.jobs(regional_id);
create index idx_jobs_status on public.jobs(status);
create index idx_jobs_pai on public.jobs(job_pai_id);
create index idx_jobs_created_at on public.jobs(created_at desc);

drop trigger if exists trg_jobs_updated_at on public.jobs;
create trigger trg_jobs_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;

create policy jobs_select on public.jobs for select to authenticated using (public.is_tenant_member(tenant_id));
create policy jobs_insert on public.jobs for insert to authenticated with check (
  public.is_tenant_member(tenant_id)
  and (created_by is null or created_by = (select auth.uid()))
);
create policy jobs_update on public.jobs for update to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.jobs to authenticated;
```

### 4.4 Trigger de cascata de aprovação de versão

Quando uma versão passa pra `aprovada`, as outras versões do mesmo orçamento devem virar `substituida` automaticamente.

```sql
create or replace function public.cascata_versao_aprovada() returns trigger
language plpgsql as $$
begin
  if NEW.status = 'aprovada' and (OLD.status is distinct from 'aprovada') then
    update public.versoes_orcamento
       set status = 'substituida'
     where orcamento_id = NEW.orcamento_id
       and id != NEW.id
       and status not in ('aprovada', 'substituida', 'cancelada');
  end if;
  return NEW;
end$$;

drop trigger if exists trg_cascata_versao_aprovada on public.versoes_orcamento;
create trigger trg_cascata_versao_aprovada
  after update of status on public.versoes_orcamento
  for each row execute function public.cascata_versao_aprovada();
```

### 4.5 Sem alterações estruturais em `orcamentos`

As colunas `versao_aprovada_id`, `aprovado_em`, `aprovado_por` já existem (adicionadas na Task 004). Só passamos a popular via server action.

## 5. Types (`lib/types.ts`)

```typescript
// ---------- Regionais ----------
export interface Regional {
  id: string;
  tenant_id: string;
  nome: string;
  ativo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- Jobs ----------
export type JobStatus = "aberto" | "em_producao" | "finalizado" | "cancelado";

export interface Job {
  id: string;
  tenant_id: string;
  codigo: string;
  projeto_id: string;
  orcamento_id: string;
  versao_orcamento_aprovada_id: string;
  nome: string;
  produto: string | null;
  regional_id: string | null;
  cidade: string | null;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  responsavel_id: string;
  valor_total: number | null;
  job_pai_id: string | null;
  status: JobStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const JOB_STATUS_TRANSICOES: Record<JobStatus, JobStatus[]> = {
  aberto: ["em_producao", "cancelado"],
  em_producao: ["finalizado", "cancelado"],
  finalizado: [],
  cancelado: [],
};

export function jobStatusLabel(s: JobStatus): string {
  switch (s) {
    case "aberto": return "Aberto";
    case "em_producao": return "Em produção";
    case "finalizado": return "Finalizado";
    case "cancelado": return "Cancelado";
  }
}
```

## 6. Validações Zod

### `lib/validations/regionais.ts` (novo)
```typescript
import { z } from "zod";
export const regionalSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome.").max(80, "Máximo 80 caracteres."),
});
export type RegionalInput = z.infer<typeof regionalSchema>;
```

### `lib/validations/jobs.ts` (novo)
```typescript
import { z } from "zod";

export const jobSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome (mín. 2 caracteres).").max(200),
  produto: z.string().trim().max(120).optional().transform((v) => v && v.length > 0 ? v : null),
  regional_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v && v.length > 0 ? v : null),
  cidade: z.string().trim().max(120).optional().transform((v) => v && v.length > 0 ? v : null),
  data_inicio_prevista: z.string().optional().transform((v) => v && v.length > 0 ? v : null),
  data_fim_prevista: z.string().optional().transform((v) => v && v.length > 0 ? v : null),
  responsavel_id: z.string().uuid("Selecione um responsável válido."),
  valor_total: z.coerce.number().nonnegative().nullable().optional(),

  // Hierarquia (só usado na criação do 2º+ job — na edição vem de outra action)
  posicao_hierarquia: z.enum(["principal", "sub_job"]).optional(),
  job_pai_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v && v.length > 0 ? v : null),
}).superRefine((data, ctx) => {
  if (data.data_inicio_prevista && data.data_fim_prevista && data.data_fim_prevista < data.data_inicio_prevista) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data_fim_prevista"], message: "Data fim deve ser igual ou posterior à data início." });
  }
});

export type JobInput = z.infer<typeof jobSchema>;
```

## 7. Audit actions (`lib/auth/audit.ts`)

Adicionar na union `AuditAction`:
- `"versao_orcamento.aprovada"` (já reservado, agora usado)
- `"versao_orcamento.aprovacao_cancelada"` (novo)
- `"regional.criada"`, `"regional.editada"`, `"regional.inativada"`, `"regional.reativada"`
- `"job.criado"` (já reservado, agora usado)
- `"job.atualizado"`, `"job.hierarquia_alterada"`, `"job.status_alterado"`

## 8. Server actions

### 8.1 Aprovação de versão

Adicionar em `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/actions.ts`:

- **`aprovarVersao(versaoId: string)`** — pré-validações:
  1. Sessão ativa
  2. Resolve `projeto_id` e `orcamento_id` do versão
  3. Verifica que versão está em `rascunho | em_revisao | enviada_cliente`
  4. Verifica que orçamento não está em `job_criado | aprovado | cancelado`
  5. Verifica que versão tem ≥1 grupo com ≥1 item (não deixa aprovar orçamento vazio) — count query
  6. Update versão: `status='aprovada'`, `aprovado_em=now()`, `aprovado_por=session.profile.id`
  7. Trigger no banco cascata as outras versões pra `substituida`
  8. Update orçamento: `status='aprovado'`, `versao_aprovada_id=versaoId`, `aprovado_em=now()`, `aprovado_por=session.profile.id`
  9. Audit `versao_orcamento.aprovada`
  10. Revalidate paths

- **`cancelarAprovacaoVersao(versaoId: string)`** — pré-validações:
  1. Sessão ativa
  2. Verifica versão está `aprovada`
  3. Verifica orçamento está `aprovado` (não `job_criado`)
  4. Verifica não existe job ativo (status != cancelado) pra esse orçamento
  5. Update versão: `status='em_revisao'`, limpa `aprovado_em`, `aprovado_por`
  6. Reverte cascata: outras versões do orçamento que estão `substituida` voltam pra `em_revisao` (só as com essa versão como referência — na prática, todas as substituida do orçamento)
  7. Update orçamento: `status='em_revisao'`, limpa `versao_aprovada_id`, `aprovado_em`, `aprovado_por`
  8. Audit `versao_orcamento.aprovacao_cancelada`

### 8.2 Jobs

Novo arquivo: `app/(app)/jobs/actions.ts`

- **`criarJob(input)`** — input inclui `orcamentoId`, campos do form, e opcionalmente `posicao_hierarquia` + `job_pai_id`. Pré-validações:
  1. Sessão ativa
  2. Zod parse
  3. Fetch orçamento → verifica `status='aprovado'` e `versao_aprovada_id != null`
  4. Verifica que não existe job ativo pra esse orçamento (unique index já garante, mas fail early com mensagem clara)
  5. Se existe ≥1 job ativo no mesmo projeto, `posicao_hierarquia` é obrigatório
  6. Se `posicao_hierarquia = 'sub_job'`, valida que `job_pai_id` é do mesmo projeto E é o principal atual
  7. Se `posicao_hierarquia = 'principal'`, faz swap atômico com o principal atual (transação com ordering seguro pro unique index `uniq_jobs_principal_por_projeto`):
     - Insert do novo job com `job_pai_id = <id_principal_atual>` (nasce como sub-job — constraint ok)
     - Update do principal atual: `job_pai_id = <novo_id>` (vira sub-job do novo; momentaneamente zero principais, constraint aceita)
     - Update do novo job: `job_pai_id = null` (vira principal)
  8. Gera código `JOB-NNNN` (helper `lib/codigos/jobs.ts` com count + 1, padStart 4)
  9. Insert do job
  10. Update orçamento: `status='job_criado'`
  11. Audit `job.criado`
  12. Revalidate paths, retorna `{ok: true, id}`

- **`atualizarJob(id, input)`** — Zod parse do subset editável (campos operacionais, não hierarquia nem status). Server action valida tenant + orcamento. Audit `job.atualizado`.

- **`atualizarHierarquiaJob(id, {novoPapel: 'principal' | 'sub_job'})`**:
  - Se `novoPapel='principal'`: se este job já é principal, no-op. Senão: swap atômico em transação — 1) update do principal atual `job_pai_id = <id>` (vira sub-job deste; momentaneamente zero principais); 2) update deste job `job_pai_id = null` (vira principal).
  - Se `novoPapel='sub_job'`: fetch principal atual do projeto. Se este job é o único do projeto, erro ("Este é o único job — não pode virar sub-job"). Update `id` pra `job_pai_id = principal.id`.
  - Audit `job.hierarquia_alterada`.

- **`atualizarStatusJob(id, novoStatus)`** — valida transição via `JOB_STATUS_TRANSICOES`. Update. Audit `job.status_alterado`.

### 8.3 Regionais

Novo arquivo: `app/(app)/cadastros/regionais/actions.ts` — espelha `app/(app)/categorias/actions.ts`:
- `criarRegional`, `editarRegional`, `inativarRegional` (admin-only), `reativarRegional` (admin-only).

### 8.4 Helper de código

`lib/codigos/jobs.ts`:
```typescript
export async function gerarCodigoJob(supabase, tenantId: string): Promise<string> {
  const { count } = await supabase.from("jobs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  return `JOB-${((count ?? 0) + 1).toString().padStart(4, "0")}`;
}
```

## 9. UI

### 9.1 Aprovação — botão na tela da versão

`app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/page.tsx`:

Adicionar no header (logo após o status badge):

- Se `status` está em `['rascunho', 'em_revisao', 'enviada_cliente']`:
  - Botão verde "**Aprovar versão**" com `ConfirmDialog`.
- Se `status = 'aprovada'`:
  - Fetch: existe job ativo pra este orçamento? Se **não**, botão sutil "Cancelar aprovação" (borda vermelha, ícone `Undo2`).
- Se `status = 'substituida'`:
  - Badge cinza "Substituída". Link "Ver versão aprovada" pro `versao_aprovada_id` do orçamento (se disponível).

### 9.2 Criação de job — drawer na tela do orçamento

`app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx`:

- Se `orcamento.status = 'aprovado'` → botão azul "**Criar job**" no header (ao lado das ações existentes).
- Ao clicar → **`<CriarJobDrawer>`** (novo componente `app/(app)/orcamentos/[projetoId]/[orcId]/criar-job-drawer.tsx`):
  - Fetch server-side prévio (na page.tsx): jobs ativos do projeto (pra bloco hierarquia), regionais ativas (pra Select), membros ativos (pra Responsável Select), faturamento da versão aprovada (pra pré-preencher Valor Total via helper `calcularTotais` de `lib/calculos/versao-totais.ts`).
  - Drawer conteúdo:
    - **Se ≥1 job ativo no projeto**: bloco topo "Hierarquia deste job":
      - Radio "Sub-job de `[codigo] · [nome]`" (default; mostra o principal atual)
      - Radio "Novo principal do projeto (o job atual vira sub-job)"
    - Campos: Nome (Input), Cliente (texto read-only mostrando `projeto.cliente.nome_fantasia`), Produto (Input), Regional (Select), Cidade (Input), Data Início (DatePicker), Data Fim (DatePicker), Responsável (Select membros), Valor Total (Input numérico pre-preenchido).
  - Submit → chama `criarJob` server action → drawer fecha → `router.refresh()` na page do orçamento.
- Se `orcamento.status = 'job_criado'` → botão vira link "**Ver job `JOB-NNNN`**" → `/jobs/[jobId]`.

### 9.3 Rota `/jobs` — placeholder

`app/(app)/jobs/page.tsx`:
- Header "Jobs" + descrição curta.
- Card grande centralizado com ícone `Briefcase`, título "Gestão de jobs em breve", texto explicativo (planejado, realizado, produção, etc.).
- `dynamic = "force-dynamic"`.
- Sidebar ganha entrada "Jobs" (ícone `Briefcase`).

### 9.4 Rota `/jobs/[jobId]` — detalhe

`app/(app)/jobs/[jobId]/page.tsx`:

- Breadcrumb: "← Voltar para `[codigo_orcamento]`" (link pro orçamento origem).
- Header: código do job + nome + badge de status + botão "Editar" (abre `<JobEditorDrawer>`).
- Card **Metadata** (grid 2 colunas):
  - Cliente, Produto, Regional (nome), Cidade, Data Início, Data Fim, Responsável, Valor Total (formatado BRL).
- Card **Hierarquia**:
  - Se principal: "Este é o **job principal** do projeto. Sub-jobs: [lista com links]" + botão "Editar hierarquia".
  - Se sub-job: "Sub-job de: **[link pro principal]**" + botão "Editar hierarquia".
  - Botão "Editar hierarquia" abre `<EditarHierarquiaDrawer>` — só o bloco de hierarquia radios + valida no submit via `atualizarHierarquiaJob`.
- Card **Origem**:
  - "Orçamento origem: `[codigo]` · [nome]" (link)
  - "Versão aprovada: v`[numero]` · [nome versão]" (link)
  - "Projeto: `[codigo]` · [nome]" (link)
- Card **Status**:
  - Status atual + botões pra transições permitidas (calculado por `JOB_STATUS_TRANSICOES[status]`).
  - Cada botão com `ConfirmDialog`.

Componentes novos:
- `app/(app)/jobs/[jobId]/job-editor-drawer.tsx`
- `app/(app)/jobs/[jobId]/editar-hierarquia-drawer.tsx`

### 9.5 Rota `/cadastros/regionais`

Mesma estrutura de `/cadastros/categorias-dominio`:
- `app/(app)/cadastros/regionais/page.tsx` — lista
- `app/(app)/cadastros/regionais/regionais-list.tsx`
- `app/(app)/cadastros/regionais/regional-drawer.tsx`
- `app/(app)/cadastros/regionais/actions.ts`

Card novo em `/cadastros` (hub) com ícone `MapPin` + contagem de regionais ativas.

## 10. Regras invioláveis (validadas server-side)

- **Aprovar versão** só se: versão em `rascunho|em_revisao|enviada_cliente` + orçamento não em `job_criado|aprovado|cancelado` + versão tem ≥1 grupo com ≥1 item.
- **Cancelar aprovação** só se: versão `aprovada` + orçamento `aprovado` (não `job_criado`) + sem job ativo pra esse orçamento.
- **Criar job** só se: orçamento `aprovado` + tem `versao_aprovada_id` + sem job ativo.
- **Se ≥1 job ativo no projeto** ao criar novo: `posicao_hierarquia` obrigatório no input.
- **Trocar principal**: sempre transacional (swap). Nunca deixa projeto sem principal enquanto tem sub-jobs.
- **Cancelar único job**: permitido; libera criar novo.
- **Cancelar principal com sub-jobs ativos**: bloqueado com mensagem clara ("Cancele/transfira os sub-jobs primeiro").
- **Sub-job só pode apontar pra job do mesmo projeto** — server action valida (não é constraint DB porque exigiria trigger complexo).
- **Status do job**: transições linear (`aberto → em_producao → finalizado`); qualquer não-terminal pode ir pra `cancelado`.

## 11. Performance (regra CLAUDE.md)

- **`prefetch={false}`** em todos os Links das listas novas (regionais, futura lista de jobs).
- **Contagens agregadas** (jobs por projeto na page.tsx do orçamento) via query separada, sem embed pesado.
- **`Promise.all`** em todas as queries independentes.
- **Migration** termina com `GRANT` explícito para `authenticated` (regra CLAUDE.md).
- **Policies** usam `(select auth.uid())`, nunca `auth.uid()`.

## 12. Casos borda

| Caso | Comportamento |
|---|---|
| Aprovar versão sem itens | Bloqueado com mensagem "Adicione ao menos 1 item antes de aprovar" |
| Cancelar aprovação com job ativo | Bloqueado; mensagem "Cancele o job antes de desaprovar a versão" |
| Criar 2º job sem escolher hierarquia | Server retorna erro; UI força a escolha |
| Criar sub-job apontando pra job de OUTRO projeto | Server retorna erro |
| Editar hierarquia de único job | "Editar hierarquia" fica desabilitado (não tem irmão pra flipar) |
| Cancelar principal com sub-jobs ativos | Bloqueado; mensagem clara pra tratar sub-jobs primeiro |
| Deletar regional com jobs referenciando | Bloqueado pela FK `on delete restrict` |
| Cliente do projeto muda depois do job criado | Job continua mostrando cliente atual (via embed) — sem freeze |
| Faturamento da versão muda após job criado | Valor Total do job **não** recalcula (foi copiado no momento da criação) |
| Aprovar versão em orçamento já `job_criado` | Bloqueado |

## 13. Arquivos afetados (checklist)

### Cria:
- `supabase/migrations/20260728000004_task005_jobs.sql`
- `lib/codigos/jobs.ts`
- `lib/validations/jobs.ts`
- `lib/validations/regionais.ts`
- `app/(app)/jobs/page.tsx` (placeholder)
- `app/(app)/jobs/actions.ts`
- `app/(app)/jobs/[jobId]/page.tsx`
- `app/(app)/jobs/[jobId]/job-editor-drawer.tsx`
- `app/(app)/jobs/[jobId]/editar-hierarquia-drawer.tsx`
- `app/(app)/orcamentos/[projetoId]/[orcId]/criar-job-drawer.tsx`
- `app/(app)/cadastros/regionais/page.tsx`
- `app/(app)/cadastros/regionais/regionais-list.tsx`
- `app/(app)/cadastros/regionais/regional-drawer.tsx`
- `app/(app)/cadastros/regionais/actions.ts`

### Modifica:
- `lib/types.ts` — add `JobStatus`, `Job`, `Regional`, `jobStatusLabel`, `JOB_STATUS_TRANSICOES`
- `lib/auth/audit.ts` — add novas actions
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/actions.ts` — add `aprovarVersao`, `cancelarAprovacaoVersao`
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/page.tsx` — add botões aprovar/cancelar aprovação
- `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx` — add "Criar job" button + drawer wiring + "Ver job" link condicional
- `app/(app)/cadastros/page.tsx` — add card "Regionais"
- Componentes de sidebar — add entrada "Jobs"

## 14. Rollback

- `git revert` do commit + migration reversa: `drop table jobs; drop type job_status; drop table regionais; drop trigger cascata_versao_aprovada + function`.
- Dados hoje são de teste (3 orçamentos, 6 versões, 1 projeto "teste"). Zero risco de perda de dado de negócio.

## 15. Fora do escopo (dividas conhecidas)

- **Gestão real de jobs**: planejado × realizado, produção, RH, contas.
- **Copiar dados detalhados**: por ora job só referencia a versão aprovada; não replica itens/grupos.
- **Fluxo de "revisão de aprovação"**: não existe estado "aguardando aprovação de gerente" — GP aprova diretamente.
- **Notificação**: sem e-mail/notificação quando job criado.
- **Numeração customizada de jobs por cliente/projeto**: código é global sequencial (`JOB-NNNN`).
- **Import de jobs de planilha**: fora.
