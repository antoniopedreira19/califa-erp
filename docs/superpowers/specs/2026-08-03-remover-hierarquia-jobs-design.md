# Remover hierarquia job principal/subjobs e introduzir agrupamento visual por projeto

**Data:** 2026-08-03
**Status:** Aprovado (aguardando review)
**Autor:** Antonio / Daniel

## Contexto

Hoje o sistema modela jobs em hierarquia: o primeiro orçamento aprovado de um projeto vira "job principal", e orçamentos aprovados seguintes viram "sub-jobs" do principal. A relação vive na coluna `jobs.job_pai_id` (self-FK). Um índice unique parcial garante no máximo 1 principal por projeto.

Essa hierarquia agrega complexidade sem entregar valor: jobs são unidades operacionais independentes (cada um com realizado, PP, timeline própria). "Principal" e "sub" não têm semântica de negócio real — são só o primeiro e os seguintes.

Vamos eliminar essa hierarquia. Todo orçamento aprovado vira um job normal. O agrupamento por projeto passa a ser puramente visual, na lista de jobs, quando um projeto tem mais de um job. E ganhamos uma página nova de análise de rentabilidade agregada por projeto.

## Objetivos

1. Remover completamente o conceito de "job principal" e "sub-job" do schema, backend e frontend.
2. Na página `/jobs`, agrupar visualmente jobs do mesmo projeto quando o projeto tem 2+ jobs.
3. Criar uma nova página `/jobs/projeto/[projetoId]` mostrando análise de rentabilidade agregada (Orçado / Planejado / Realizado por grupo).
4. Preservar totalmente as funcionalidades de job individual (realizado, PP, status, etc.).

## Não-objetivos

- Nova modelagem de "programa" ou "portfólio" acima de projeto. Projeto continua sendo o topo.
- Análise de rentabilidade agregada por cliente ou por período. Só por projeto, e só se o projeto tem 2+ jobs.
- Emissão de PP no nível do projeto. PP continua 1:1 com job individual.
- Migração de dados históricos. Sub-jobs existentes viram jobs normais automaticamente ao droppar a coluna.

## Mudanças de schema

### Nova migration: `supabase/migrations/YYYYMMDDHHMMSS_remover_hierarquia_jobs.sql`

```sql
drop index if exists public.uniq_jobs_principal_por_projeto;
alter table public.jobs drop constraint if exists jobs_nao_pai_de_si_mesmo;
alter table public.jobs drop column if exists job_pai_id;
```

### Pré-checagem obrigatória antes de aplicar em prod

Rodar:
```sql
select projeto_id, orcamento_id, count(*)
from public.jobs
where status <> 'cancelado'
group by 1, 2
having count(*) > 1;
```

Se retornar linhas, existem dois jobs ativos pro mesmo orçamento (situação anômala que o índice `uniq_jobs_por_orcamento_ativo` deveria ter bloqueado). Cancelar o duplicado antes de rodar a migration.

### O que fica

- `uniq_jobs_por_orcamento_ativo` — a regra "um orçamento aprovado = um job ativo" permanece.
- Tabela `projetos` inalterada.
- Todas as FKs (`orcamento_id`, `versao_orcamento_aprovada_id`, `projeto_id`, `empresa_id`, etc.) inalteradas.

## Mudanças de backend

### `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/abertura-actions.ts`

Remover o bloco (linhas 229-289 aprox.) que busca o principal atual do projeto e decide se o novo job nasce como sub-job. Job sempre nasce independente. O `insert` fica:

```typescript
// era:
//   job_pai_id: principalAtual ? principalAtual.id : null,
// vira: (campo some do insert)
```

### `app/(app)/jobs/actions.ts`

- **`criarJob`**: preservar a função, remover apenas os campos e a lógica de hierarquia:
  - Remover `posicao_hierarquia`, `job_pai_id` do schema Zod importado.
  - Remover o bloco de "principal atual" e swap (linhas 100-194).
  - Remover a validação que exige escolher "principal" ou "sub-job" quando projeto já tem jobs ativos.
- **`atualizarHierarquiaJob`**: deletar a função inteira.
- **`atualizarStatusJob`**: remover o bloqueio "cancele os sub-jobs antes de cancelar o principal" (linhas 417-430 aprox.).

### `lib/validations/jobs.ts`

Remover:
- `posicao_hierarquia: z.enum(["principal", "sub_job"]).optional()`
- `job_pai_id: z.string().uuid().nullable().optional()` (ou similar)

### `lib/types.ts`

Remover `job_pai_id: string | null` de `Job` (linha ~506).

### Auditoria

Não purgar entries antigas. Só parar de gerar novas de `job.hierarquia_alterada` (some junto com a função deletada).

## Mudanças de frontend

### `app/(app)/jobs/page.tsx`

Remover da query:
- `job_pai_id`
- `filhos:jobs!job_pai_id(count)`

Manter e garantir presença:
- `projeto:projetos(id, codigo, nome, cliente:clientes(nome_fantasia))`

Remover derivações `is_sub_job` e `tem_filhos` do map de rows.

### `app/(app)/jobs/jobs-list.tsx` — reescrita da renderização

**Regra de agrupamento (após aplicar filtros):**

1. Agrupar as rows pós-filtro por `projeto_id`.
2. Para cada grupo:
   - Grupo com 1 job → renderiza a **linha do job direta**, sem cabeçalho de projeto, sem chevron.
   - Grupo com 2+ jobs → renderiza uma **linha de projeto** (chevron expand/collapse, código+nome do projeto, cliente, contagem "N jobs", soma de `valor_total`) + as linhas dos jobs indentadas quando expandido.

**Ordenação:**
- Jobs dentro de cada grupo ordenados por `codigo` (asc).
- Grupos ordenados pelo menor `codigo` de job do grupo (asc). Isso mantém ordem estável e alinhada com a lista atual (que ordena por código).

**Interação:**
- Click na linha do projeto → navega pra `/jobs/projeto/[projetoId]`.
- Click no chevron da linha do projeto → só expande/colapsa (stopPropagation).
- Click na linha do job → navega pra `/jobs/[jobId]`. Linha inteira clicável (regra do CLAUDE.md).

**Visual da linha do projeto:**
- Fundo `bg-muted/30` pra diferenciar da linha do job.
- Sem coluna de status (projeto não tem status).
- Coluna de valor mostra a soma agregada.
- Sem badges de "principal"/"sub-job" em lugar nenhum.

### `app/(app)/jobs/[jobId]/page.tsx`

- Remover toda a seção "Hierarquia" (linhas 299-380 aprox.).
- Remover as queries que buscam pai e sub-jobs (linhas 98-108 aprox.).
- Remover imports do `EditarHierarquiaDrawer`.

### `app/(app)/jobs/[jobId]/editar-hierarquia-drawer.tsx`

Deletar o arquivo.

### Nova página: `app/(app)/jobs/projeto/[projetoId]/page.tsx`

Server component.

**Header:**
- Código + nome do projeto.
- Cliente.
- Responsável do projeto.
- Contagem de jobs ativos (todos com `status <> 'cancelado'`).
- Status mix (breakdown por status entre os jobs ativos: "2 abertos, 1 em produção, 1 finalizado").
- Jobs cancelados **não entram** na tabela de rentabilidade nem no header (não desperdiça atenção com valores de trabalho abortado).

**Tabela de rentabilidade agregada (o núcleo):**

Colunas:
| Grupo | Orçado | Planejado | Realizado | Δ Real vs Orç | Δ Real vs Plan |

- Uma linha por grupo (agregado entre jobs, ver regra abaixo).
- Uma linha de **Total** ao final.
- Delta calculado como `realizado - referência` (Orçado ou Planejado).
  - Delta positivo = estourou → **vermelho**.
  - Delta zero ou negativo = no ponto ou economizou → **verde**.
- **Sem drilling** nos itens. Só grupos + totais.

**Regra de agregação de grupos entre jobs:**

- Grupos existem por versão de orçamento (tabela `versoes_orcamento_grupos`). Cada job usa a versão aprovada do próprio orçamento, então "Produção" no job A e "Produção" no job B são IDs distintos com mesmo nome.
- Agregar por **nome do grupo normalizado**: `trim` + `toLowerCase` como chave de agregação.
- **Exibir o nome mais recente** (por `created_at` do grupo) entre os grupos que caem na mesma chave, preservando capitalização original.
- Se um projeto tem "Produção" no job A e "Produção Audiovisual" no job B, viram duas linhas separadas — reflete a realidade da granularidade do usuário.

**Tabela de jobs do projeto (embaixo):**

Colunas: código, nome, status, valor total, responsável. Cada linha clicável leva pro `/jobs/[jobId]`.

**Botões:**
- Voltar pra `/jobs`.
- **Sem** botão de gerar PP.
- **Sem** ações de edição (página é só leitura).

### Nova função de cálculo: `lib/calculos/projeto-totais.ts`

Reaproveita a lógica que hoje vive em `app/(app)/jobs/[jobId]/realizado/job-totais-card.tsx` (linhas 61-83). Extrai o rollup por grupo pra função pura:

```typescript
type LinhaGrupo = {
  chaveNormalizada: string;
  nomeExibicao: string;
  orcado: number;
  planejado: number;
  realizado: number;
};

export function agregarRentabilidadePorProjeto(
  jobsComItensERealizado: JobParaAgregar[]
): { linhas: LinhaGrupo[]; total: LinhaGrupo };
```

Refactor de `job-totais-card.tsx`: passar a usar a mesma função (com um único job na entrada), garantindo que job individual e projeto agregado calculam da mesma forma.

## Testes / verificação

Como o projeto não tem suíte de testes automatizados robusta hoje, verificação manual:

1. **Pré-migration**: rodar a query de checagem em prod (via MCP Supabase).
2. **Pós-migration**: `list_tables` pra confirmar que `job_pai_id` sumiu e o índice também.
3. **Fluxo de aprovação**: aprovar 2ª versão de orçamento num projeto que já tem job. Confirmar que:
   - Novo job nasce sem erro.
   - Ambos aparecem como jobs "normais" na lista, agrupados sob o projeto.
4. **Lista `/jobs`**:
   - Projeto com 1 job: aparece linha direta.
   - Projeto com 2+ jobs: aparece linha de projeto expandível.
   - Filtro de status que reduz um projeto de 3 jobs pra 1: aparece como linha direta (sem agrupamento).
5. **Página de projeto `/jobs/projeto/[id]`**: totais batem com a soma manual dos jobs.
6. **Página de job `/jobs/[jobId]`**: seção de hierarquia sumiu, resto intacto.
7. **PP**: continua funcionando no job individual.
8. **Build e lint**: `npm run lint` e `npm run build` sem erros.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `supabase/migrations/YYYYMMDDHHMMSS_remover_hierarquia_jobs.sql` | Criar |
| `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/abertura-actions.ts` | Editar |
| `app/(app)/jobs/actions.ts` | Editar |
| `lib/validations/jobs.ts` | Editar |
| `lib/types.ts` | Editar |
| `app/(app)/jobs/page.tsx` | Editar (query) |
| `app/(app)/jobs/jobs-list.tsx` | Reescrever agrupamento |
| `app/(app)/jobs/[jobId]/page.tsx` | Remover seção hierarquia |
| `app/(app)/jobs/[jobId]/editar-hierarquia-drawer.tsx` | **Deletar** |
| `app/(app)/jobs/projeto/[projetoId]/page.tsx` | Criar |
| `lib/calculos/projeto-totais.ts` | Criar |
| `app/(app)/jobs/[jobId]/realizado/job-totais-card.tsx` | Refactor pra usar função extraída |

## Riscos

- **Dados anômalos em prod**: se a query de pré-checagem retornar duplicidades, precisa intervir manualmente. Documentado acima.
- **Grupos com nomes divergentes**: se o time cadastrou "Produção" e "Producao" (sem acento) em versões diferentes, viram grupos separados na agregação. Solução: normalização de nome já contempla `trim`+`toLowerCase`, mas não remove acentos. Se virar problema, adicionar `.normalize("NFD").replace(/\p{Diacritic}/gu, "")` na chave. Manter simples inicialmente.
- **Ordenação da lista**: agrupar client-side muda a ordem visual. Confirmar que a ordenação por código do projeto/job continua estável e previsível.

## Ordem de implementação sugerida

1. Migration + pré-checagem em prod.
2. Backend: `abertura-actions.ts`, `jobs/actions.ts`, validations, types.
3. Frontend detalhe: remover seção hierarquia + deletar drawer.
4. Frontend lista: reescrever agrupamento.
5. `lib/calculos/projeto-totais.ts` + refactor de `job-totais-card.tsx`.
6. Nova página `/jobs/projeto/[projetoId]`.
7. Verificação manual + lint + build.
