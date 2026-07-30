# Task 008 — Tela de Jobs + Realizado

**Data**: 2026-07-30
**Status**: Aprovado, aguardando plano de implementação
**Antecessores**: Task 005 (Jobs + Central Financeira), Task 004G (Planejado)

## Objetivo

Entregar a gestão operacional do job depois que o financeiro aprova a abertura:

1. **Lista `/jobs`**: substituir o placeholder atual por uma tabela com todos os jobs do tenant, filtrável por status, com navegação pra `/jobs/[jobId]`.
2. **Extensão de `/jobs/[jobId]`**: acrescentar a "planilha do job" — cards de grupo com tabela de itens da versão aprovada mostrando 3 blocos (ORÇADO / PLANEJADO / REALIZADO) lado a lado, e permitir lançar os valores realizados por item.

O realizado é o ponto de partida da futura cadeia financeira (pedidos de compra → títulos financeiros), que virá em tasks separadas.

## Decisões chave

### Modelagem — nova tabela `jobs_itens_realizado` (1:1 job × item)

Descartada a alternativa de estender `versoes_orcamento_itens` com colunas `_realizado` porque:

1. Semanticamente, realizado pertence ao *job* (mutável em produção), não à *versão* (imutável após aprovação).
2. O realizado é ponto de origem da cadeia futura `pedidos_compra` → `titulos_financeiros`; ter um `id` estável em tabela dedicada evita gambiarra pra referência.
3. Evita 4 colunas zeradas em todas as versões substituídas/rascunhos que nunca terão realizado.

Descartada também a alternativa "múltiplos lançamentos por item" (com fornecedor/data/NF): fica pra quando pedidos de compra chegarem. MVP é 1:1 por item.

### Onde vive a UI de gestão

Extensão do `/jobs/[jobId]` já existente (não uma nova rota). Metadata / hierarquia / origem / status ficam onde estão; a planilha entra como nova seção grande depois do card de Status.

### Permissão e status editável

- Editar realizado: apenas **GP responsável do job** (`job.responsavel_id = auth.uid()`) **OU** `administrador`. Financeiro NÃO edita realizado — só consulta.
- Status onde é editável: **`aberto`** + **`em_producao`**.
- Status onde a planilha aparece **read-only**: `finalizado`, `cancelado`.
- Status onde a planilha **não aparece** (card informativo no lugar): `aguardando_abertura`, `rejeitado_financeiro`.

### Sub-jobs na lista

Linhas separadas com badge `Sub-job` + link pro pai (`stopPropagation`). Ordenação padrão por `created_at desc`.

### Card de Totais do Job

3 colunas: ORÇADO / PLANEJADO / REALIZADO + linhas de Variação (Real vs Planejado, R$ e %) e Resultado Real (`Faturamento − Impostos − Realizado`).

## Componentes da entrega

### 1. Migration `20260730000001_task008_jobs_realizado.sql`

```sql
create table public.jobs_itens_realizado (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete restrict,
  job_id                    uuid not null references public.jobs(id) on delete cascade,
  item_id                   uuid not null references public.versoes_orcamento_itens(id) on delete cascade,
  valor_unitario_realizado  numeric(14,2) not null default 0,
  quantidade_realizada      numeric(12,3) not null default 0,
  dias_meses_realizado      numeric(12,3) not null default 0,
  total_realizado           numeric(18,2) generated always as (
                              coalesce(valor_unitario_realizado, 0) *
                              coalesce(quantidade_realizada, 0) *
                              coalesce(dias_meses_realizado, 0)
                            ) stored,
  created_by                uuid references public.profiles(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint uniq_realizado_por_job_item unique (job_id, item_id),
  constraint realizado_valor_nao_negativo    check (valor_unitario_realizado >= 0),
  constraint realizado_quantidade_nao_negativa check (quantidade_realizada    >= 0),
  constraint realizado_dias_meses_nao_negativo check (dias_meses_realizado    >= 0)
);

create index idx_jobs_realizado_tenant on public.jobs_itens_realizado(tenant_id);
create index idx_jobs_realizado_job on public.jobs_itens_realizado(job_id);
create index idx_jobs_realizado_item on public.jobs_itens_realizado(item_id);

-- trigger updated_at
create trigger trg_jobs_realizado_updated_at
before update on public.jobs_itens_realizado
for each row execute function public.set_updated_at();

-- RLS: is_tenant_member em SELECT/INSERT/UPDATE/DELETE (mesmo padrão dos grupos/itens da versão)
alter table public.jobs_itens_realizado enable row level security;

create policy jobs_realizado_select on public.jobs_itens_realizado
  for select to authenticated using (public.is_tenant_member(tenant_id));

create policy jobs_realizado_insert on public.jobs_itens_realizado
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

create policy jobs_realizado_update on public.jobs_itens_realizado
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy jobs_realizado_delete on public.jobs_itens_realizado
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.jobs_itens_realizado to authenticated;
```

Regras adicionais de negócio (ownership + status) ficam **nas server actions**, não em RLS — segue o padrão já estabelecido (RLS = isolamento por tenant; regras de escrita = server action).

### 2. Type em `lib/types.ts`

```ts
export interface JobItemRealizado {
  id: string;
  tenant_id: string;
  job_id: string;
  item_id: string;
  valor_unitario_realizado: number;
  quantidade_realizada: number;
  dias_meses_realizado: number;
  total_realizado: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

### 3. Server action `app/(app)/jobs/[jobId]/actions-realizado.ts`

```ts
upsertItemRealizado(
  jobId: string,
  itemId: string,
  campo: "valor_unitario_realizado" | "quantidade_realizada" | "dias_meses_realizado",
  valor: string | null,
): Promise<{ ok: true } | { ok: false; message: string }>
```

Fluxo:

1. `requireSession()` — autenticado.
2. Load do job (`select id, tenant_id, status, responsavel_id, versao_orcamento_aprovada_id`) com `tenant_id` do session. Se não existe → erro `job_nao_encontrado`.
3. Gate de status: `job.status ∈ {aberto, em_producao}`; caso contrário → erro `status_bloqueia_edicao`.
4. Gate de ownership: `session.activeRole === "administrador"` OU `job.responsavel_id === session.profile.id`; caso contrário → erro `sem_permissao`. Registrar `audit.acao_negada` neste caso.
5. Validação do item: carregar `versoes_orcamento_itens.id, versao_orcamento_id, tenant_id` e checar `versao_orcamento_id === job.versao_orcamento_aprovada_id` + tenant match. Defense-in-depth.
6. Parse do valor com `parseNumero` (aceita "1.234,56" e "1234.56"), gate `valor >= 0`.
7. UPSERT via `.upsert(..., { onConflict: "job_id,item_id" })` (usa o unique constraint). Se linha nova, popula com defaults 0 nos outros dois campos + o mudado.
8. Audit `job.realizado_atualizado` com metadata `{ item_id, campo, valor_novo, valor_anterior }`.
9. `revalidatePath("/jobs/[jobId]")`.
10. Retorna `{ ok: true }`.

### 4. Auditoria — `lib/auth/audit.ts`

Adicionar ação: `job.realizado_atualizado`.

### 5. Cálculos — `lib/calculos/versao-totais.ts`

Adicionar dois helpers:

```ts
export function calcularTotaisRealizado(
  itens: { total_realizado: number }[],
): { totalRealizado: number } {
  const totalRealizado = itens.reduce((s, i) => s + (i.total_realizado ?? 0), 0);
  return { totalRealizado };
}

export function calcularVariacao(
  realizado: number,
  planejado: number,
): { variacaoRS: number; variacaoPct: number | null } {
  const variacaoRS = realizado - planejado;
  const variacaoPct = planejado > 0 ? (variacaoRS / planejado) * 100 : null;
  return { variacaoRS, variacaoPct };
}
```

Resultado Real (usado no card de totais do job):
```ts
const resultadoReal = totalRealizado > 0
  ? faturamento - imposto - totalRealizado
  : null;
```

### 6. UI — `/jobs` (lista)

Substitui `app/(app)/jobs/page.tsx` atual. Server component.

Query única:
```ts
supabase.from("jobs").select(`
  id, codigo, nome, status, valor_total, data_inicio_prevista, job_pai_id,
  projeto:projetos(id, codigo, nome, cliente:clientes(nome_fantasia)),
  responsavel:profiles!responsavel_id(id, nome),
  pai:jobs!job_pai_id(id, codigo, nome)
`)
.eq("tenant_id", session.activeTenant.id)
.order("created_at", { ascending: false });
```

Componente client `jobs-list.tsx`:
- Chips de filtro por status (state local, filtra client-side)
- Input de busca (nome/código, case-insensitive)
- Tabela: `Código | Nome | Projeto | Cliente | Responsável | Início | Valor Total | Status`
- Linha inteira clicável → `/jobs/[jobId]` (`role="button"`, `tabIndex={0}`, `onKeyDown` Enter/Space)
- `<Link>` interno da célula "Código" com `prefetch={false}` + `stopPropagation`
- Sub-jobs: badge `Sub-job` na célula Nome + link pro pai `→ JOB-XXXX`, com `stopPropagation`
- Vazio (sem filtros): mensagem "Nenhum job criado ainda" + subtexto "Aprove uma versão de orçamento e crie um job."
- Vazio (com filtro/busca): "Nenhum job encontrado com esses filtros."

Header da página:
```
OPERAÇÃO
Jobs
Todos os jobs criados. Aprovados pelo financeiro liberam a gestão do realizado.
```

### 7. UI — `/jobs/[jobId]` extensão

**Fetch adicional** na `page.tsx`, dentro do `Promise.all` existente:

```ts
supabase.from("versoes_orcamento_grupos").select("*")
  .eq("versao_orcamento_id", raw.versao_orcamento_aprovada_id)
  .eq("tenant_id", session.activeTenant.id)
  .order("ordem"),
supabase.from("versoes_orcamento_itens").select("*")
  .eq("versao_orcamento_id", raw.versao_orcamento_aprovada_id)
  .eq("tenant_id", session.activeTenant.id)
  .order("ordem"),
supabase.from("jobs_itens_realizado").select("*")
  .eq("job_id", raw.id)
  .eq("tenant_id", session.activeTenant.id),
```

Também carregar `versao.percentual_honorarios, percentual_imposto, moeda` (já vem no embed atual, só adicionar campos).

**Placement**: depois do card "Status" (fim atual da página), fora do grid `md:grid-cols-2`, ocupando largura total.

**Regras de renderização**:

| Status do job | O que renderiza |
|---|---|
| `aguardando_abertura`, `rejeitado_financeiro` | Card cinza compacto: "Aguarde a aprovação do financeiro para lançar valores realizados." |
| `aberto`, `em_producao` | Planilha completa **editável** no bloco REALIZADO |
| `finalizado`, `cancelado` | Planilha completa **read-only** (mostra histórico) |

**Ownership check no server component**:
```ts
const podeEditar =
  (session.activeRole === "administrador"
    || job.responsavel_id === session.profile.id)
  && (job.status === "aberto" || job.status === "em_producao");
```

Passa `editable={podeEditar}` pro componente da planilha.

**Componentes novos** (todos em `app/(app)/jobs/[jobId]/realizado/`):

- `job-realizado-section.tsx` — wrapper server-component-friendly. Recebe `grupos, itens, realizadosPorItemId (Map<string, JobItemRealizado>), versao, editable`. Renderiza header ("Planilha do job · v{N}") + link pra versão + cards de grupo + totais.
- `job-grupo-card.tsx` — visual do grupo (nome + subtotais). Sem renomear/remover (o grupo pertence à versão aprovada, imutável).
- `job-item-realizado-table.tsx` — client component. Grid com 4 blocos + Variação. Copia estrutura de `itens-table.tsx` da versão, mas:
  - **Item**, **Tipo**, **Categoria**: read-only sempre.
  - **Bloco ORÇADO** (Valor / QT / D/M / Total): read-only.
  - **Bloco PLANEJADO** (Valor / QT / D/M / Total): read-only.
  - **Bloco REALIZADO** (Valor / QT / D/M / Total): **click-to-edit** se `editable`. Total é calculado (não editável). Aceita vírgula decimal, `Enter` confirma, `Esc` cancela — mesmo padrão da versão.
  - **Bloco VARIAÇÃO** (R$ / %): cor conforme sinal — verde se realizado ≤ planejado (economia), vermelho se realizado > planejado (estouro). Traço se `planejado === 0`.
  - **Subtotal por grupo** no `<tfoot>`: 3 valores de bloco (orçado / planejado / realizado) + variação do grupo.
  - **Trilha de ações à direita**: nenhuma (não pode remover item, só edita realizado). Simplifica o layout — sem trilha, sem `pr-12` no wrapper.
- `job-totais-card.tsx` — versão adaptada do `TotaisCard`. Estrutura:
  - Camada 1: agrupamentos por grupo lado a lado — 3 colunas (ORÇADO / PLANEJADO / REALIZADO).
  - Camada 2: subtotais por Tipo A/B/C/D — 3 colunas.
  - Camada 3: Honorários, Impostos, Faturamento (baseado no orçado, mantém — não muda com realizado).
  - Camada 4 (nova): **Total Realizado**, **Variação vs Planejado** (R$ e %), **Resultado Real** (`Faturamento − Impostos − Realizado`). Se `totalRealizado === 0`, mostra `—`.

### 8. Cores dos blocos (design system)

Já existentes:
- ORÇADO: `bg-[#f1f0ec]` / borda `#282828`
- PLANEJADO: `bg-[#e8f0fd]` / borda `#2f6fdb`, texto `#1e4fa3`
- RENTABILIDADE: `bg-emerald-50` / borda `emerald-600`

Novo:
- **REALIZADO**: `bg-[#fef3c7]` / borda `#d97706` (âmbar-600), texto `#92400e` (âmbar-800)

Variação:
- Verde `text-emerald-700` quando `realizado ≤ planejado` (economia ou dentro do previsto)
- Vermelho `text-california-red` quando `realizado > planejado` (estouro)
- Cinza-traço se `planejado === 0` (sem base de comparação)

### 9. Empty states

- `/jobs`: "Nenhum job criado ainda. Aprove uma versão de orçamento e crie um job."
- `/jobs` com filtro/busca: "Nenhum job encontrado com esses filtros."
- Grupo sem itens (herda estado da versão aprovada): "Sem itens neste grupo." (mesmo texto da versão)
- Item sem realizado ainda: totais_realizado da linha = 0, mostrado como `—` (via `vazioComoTraco`). Ao editar qualquer célula, cria o registro na tabela.

## Performance (checklist obrigatório de `docs/PERFORMANCE.md`)

- ✅ `/jobs`: 1 query única com embeds `projeto.cliente, responsavel, pai`. Sem N+1.
- ✅ `/jobs`: linhas usam `router.push`; célula "Código" usa `<Link prefetch={false}>` (regra da memory: lista de 5+ itens → prefetch off).
- ✅ `/jobs/[jobId]`: adicionar 3 queries (grupos, itens, realizados) ao `Promise.all` existente. Nunca em série.
- ✅ Migration: `GRANT authenticated` explícito + índices em `job_id`, `item_id`, `tenant_id` + unique index em `(job_id, item_id)`.
- ✅ Policies RLS usam `(select auth.uid())` via `is_tenant_member` (padrão do projeto).
- ✅ `force-dynamic` mantido nas pages autenticadas.

## Auditoria

Nova ação: `job.realizado_atualizado` com metadata `{ item_id, campo, valor_novo, valor_anterior }`.

Ações negadas por permissão registram `acao_negada` com metadata da ação tentada (padrão já usado nas approvals do financeiro).

## Fora de escopo (fica pra próxima)

- Múltiplos lançamentos por item (fornecedor, data, NF) — vira `pedidos_compra` em task futura.
- Fechamento formal do job (workflow de "trancar" o realizado além do que status `finalizado` já faz).
- Export XLSX da planilha do job (Orçado × Planejado × Realizado × Variação).
- Dashboard/relatórios agregados por projeto/cliente/período.
- Filtros extras na `/jobs` (responsável, projeto, cliente, data) — MVP fica com status + busca.
- Alerta visual quando variação passa de X% (ex: badge de "estouro > 10%").

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| User edita realizado no mesmo item de dois lugares (dois abas) e um sobrescreve o outro | UPSERT usa `onConflict (job_id, item_id)` — sempre atualiza a última escrita. Sem lock otimista no MVP. Aceitável pra 1 usuário por job. |
| Item da versão aprovada é removido (impossível hoje — versão aprovada é read-only, mas defensivo) | FK `ON DELETE CASCADE` limpa realizado órfão. |
| Job cancelado — realizado deve ser mantido pra histórico | Migration não cascateia delete do job (`ON DELETE CASCADE` do realizado só dispara se o job for realmente deletado; hoje `status = cancelado` não deleta). ✅ |
| Financeiro tenta editar realizado direto no banco | Coberto por RLS (só membros do tenant) + gate de ownership na server action. Financeiro é membro, mas só tem SELECT/UPDATE via ação — e a ação bloqueia. |
| Migration antiga poderia deletar itens da versão | Não muda no escopo dessa task. Continua imutável na versão aprovada por outra regra de negócio. |

## Testes manuais (aceitação)

1. Aprovar uma versão de orçamento com 3 grupos e ~10 itens (fluxo já existente).
2. Criar um job da versão aprovada → nasce `aguardando_abertura`. Abrir `/jobs/[jobId]` → deve mostrar card "Aguarde a aprovação do financeiro" no lugar da planilha.
3. Como admin/financeiro, aprovar abertura na Central Financeira → job vai pra `aberto`. Voltar em `/jobs/[jobId]` → planilha aparece editável.
4. Clicar numa célula do bloco REALIZADO (ex: R$ Unit): input aparece, digitar `1500,00`, Enter → valor salvo, total da linha atualizado, variação recalculada.
5. Preencher os 3 campos (Valor / QT / D/M) de vários itens em grupos diferentes → subtotais por grupo e totais gerais consistentes.
6. Como GP **não responsável** pelo job → tentar editar → server action retorna erro `sem_permissao` + audit `acao_negada`.
7. Mudar status pra `em_producao` → continua editável.
8. Mudar status pra `finalizado` → planilha vira read-only, cursor não muda em hover, tentar clicar não abre input.
9. Cancelar job → planilha read-only, mostra realizado histórico.
10. Voltar pra `/jobs` → lista mostra jobs em todos os status; filtrar por "Aberto" reduz a lista; busca por nome funciona.
11. Sub-job aparece na lista como linha separada com badge `Sub-job → JOB-XXXX`.
12. Vercel Runtime Logs — nenhum warning inesperado da nova ação/migration.
