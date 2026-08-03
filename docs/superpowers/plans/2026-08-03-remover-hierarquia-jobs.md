# Remover hierarquia jobs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover hierarquia job principal/subjobs e introduzir agrupamento visual por projeto na lista, mais nova página de análise de rentabilidade agregada por projeto.

**Architecture:** Drop da coluna `jobs.job_pai_id` e do índice `uniq_jobs_principal_por_projeto`. Backend e frontend param de referenciar o campo. Lista `/jobs` agrupa client-side por `projeto_id` mostrando header expansível quando o projeto tem 2+ jobs. Nova rota `/jobs/projeto/[projetoId]` agrega Orçado / Planejado / Realizado por grupo, sem drilling em itens, sem PP.

**Tech Stack:** Next.js App Router server components, Supabase Postgres + RLS, TypeScript, Tailwind + shadcn/ui, Zod.

**Spec:** [docs/superpowers/specs/2026-08-03-remover-hierarquia-jobs-design.md](../specs/2026-08-03-remover-hierarquia-jobs-design.md)

## Global Constraints

- Ortografia pt-BR completa em toda string visível ao usuário (com acentos, cedilha, til). Identificadores em código podem ficar sem acento por convenção.
- Toda mudança de UI/backend contra `docs/PERFORMANCE.md`: `<Link>` em lista com 5+ itens navegáveis usa `prefetch={false}`; queries independentes num server component em `Promise.all`; nunca embed pesado só pra contar.
- `force-dynamic` continua em `/jobs` e nas páginas novas.
- Nenhuma tabela nova. Nenhuma FK nova. Nenhuma policy nova.
- Ordem de execução importa: **código para de referenciar `job_pai_id` antes** da migration que dropa a coluna. Assim cada commit intermediário está funcional.
- Não commitar arquivos com erro de lint/tipo.

---

### Task 1: Backend — remover hierarquia do `abertura-actions.ts`

**Files:**
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/abertura-actions.ts:229-289`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: função `enviarJobParaAbertura` continua com mesma assinatura, insert sem `job_pai_id`.

- [ ] **Step 1: Remover o bloco de busca de principal atual**

Abrir o arquivo. Localizar o bloco "5. Hierarquia automática" (linhas ~229-237):

```typescript
  // 5. Hierarquia automática: sub-job do principal quando ele já existe.
  const { data: jobsProjeto } = await supabase
    .from("jobs")
    .select("id, job_pai_id")
    .eq("projeto_id", orc.projeto_id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado");

  const principalAtual = (jobsProjeto ?? []).find((j) => j.job_pai_id === null);
```

**Deletar as 8 linhas inteiras** e o comentário do bloco 5.

- [ ] **Step 2: Remover `job_pai_id` do insert do job**

No insert (bloco "7. Cria o job"), localizar a linha:

```typescript
      job_pai_id: principalAtual ? principalAtual.id : null,
```

**Deletar a linha.**

- [ ] **Step 3: Remover `job_pai_id` do metadata do audit**

No `logAuditEvent` (bloco `acao: "job.enviado_para_abertura"`), localizar:

```typescript
      job_pai_id: principalAtual ? principalAtual.id : null,
```

**Deletar a linha do metadata.**

- [ ] **Step 4: Renumerar comentários de blocos (opcional mas útil)**

Se os comentários do arquivo estão numerados como `// 5. ...`, `// 6. ...`, `// 7. ...`, `// 8. ...`, ajustar depois da remoção pra continuar sequencial (o bloco 5 sumiu, então 6→5, 7→6, 8→7). Manter só se der pra fazer sem introduzir bugs de indentação.

- [ ] **Step 5: Rodar type-check**

```bash
npx tsc --noEmit
```

Expected: sem erros novos. Se sobrou uso de `principalAtual` em outro lugar do arquivo, o compilador aponta.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/abertura-actions.ts"
git commit -m "$(cat <<'EOF'
refactor(jobs): abertura nao vincula mais como sub-job

Cada orcamento aprovado vira job normal, sem hierarquia. Remove busca do
principal atual do projeto, remove job_pai_id do insert e do audit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Backend — enxugar `jobs/actions.ts`

**Files:**
- Modify: `app/(app)/jobs/actions.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `atualizarJob`, `atualizarStatusJob`, `aprovarAberturaJob`, `rejeitarAberturaJob`, `reenviarJobParaAprovacao` (assinaturas inalteradas). `criarJob` e `atualizarHierarquiaJob` deixam de existir.

- [ ] **Step 1: Remover `posicao_hierarquia` e `job_pai_id` de `extractInput`**

Em `extractInput` (linhas ~15-32), remover as leituras:

```typescript
  const posicaoRaw = formData.get("posicao_hierarquia")?.toString();
  const paiRaw = formData.get("job_pai_id")?.toString();
```

E do objeto retornado, remover:

```typescript
    posicao_hierarquia:
      posicaoRaw === "principal" || posicaoRaw === "sub_job" ? posicaoRaw : undefined,
    job_pai_id: paiRaw ?? "",
```

- [ ] **Step 2: Deletar `criarJob` inteira**

Localizar `export async function criarJob(...)` (linhas ~42-225). Confirmado que nenhum arquivo do frontend chama `criarJob` (só está exportada). **Deletar as ~184 linhas da função inteira.**

- [ ] **Step 3: Deletar `atualizarHierarquiaJob` inteira**

Localizar `export async function atualizarHierarquiaJob(...)` (linhas ~277-384). **Deletar as ~108 linhas.**

- [ ] **Step 4: Remover o bloqueio de cancelar principal em `atualizarStatusJob`**

Localizar o bloco (linhas ~417-430):

```typescript
  // Se está cancelando o principal e existem sub-jobs ativos, bloqueia
  if (novoStatus === "cancelado" && job.job_pai_id === null) {
    const { count: subJobs } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("projeto_id", job.projeto_id)
      .eq("job_pai_id", job.id)
      .neq("status", "cancelado");
    if ((subJobs ?? 0) > 0) {
      return {
        ok: false,
        message: "Cancele ou transfira os sub-jobs antes de cancelar o principal.",
      };
    }
  }
```

**Deletar o bloco inteiro (14 linhas + comentário).**

- [ ] **Step 5: Remover `job_pai_id` do SELECT em `atualizarStatusJob`**

Localizar (linhas ~393-404):

```typescript
  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, projeto_id, orcamento_id, job_pai_id")
```

Trocar por:

```typescript
  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, projeto_id, orcamento_id")
```

E no type assertion do `.maybeSingle<{...}>()`, remover `job_pai_id: string | null;`.

- [ ] **Step 6: Remover linha de erro do índice principal em `mapJobDbError`**

Localizar:

```typescript
  if (msg.includes("uniq_jobs_principal_por_projeto")) return "Já existe um job principal neste projeto.";
```

**Deletar a linha.**

- [ ] **Step 7: Remover imports órfãos**

Depois das remoções, alguns imports podem ficar sem uso. Casos prováveis:
- `jobSchema` — ainda usado se `atualizarJob` continuar. Confirmar. **Manter se usado.**
- `gerarCodigoJob` — só era usado em `criarJob`. **Remover import.**
- `rejeicaoAberturaSchema` — usado em `rejeitarAberturaJob`. **Manter.**

- [ ] **Step 8: Rodar type-check**

```bash
npx tsc --noEmit
```

Expected: erros só em arquivos que ainda importam `criarJob` ou `atualizarHierarquiaJob`. Anotar para próximas tasks.

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/jobs/actions.ts"
git commit -m "$(cat <<'EOF'
refactor(jobs): deleta criarJob e atualizarHierarquiaJob, remove bloqueio principal-com-subs

Job so nasce pelo fluxo de abertura (versoes_orcamento). Remove tambem
o bloqueio de cancelar principal quando ha sub-jobs, ja que hierarquia
sera dropada.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Tipos e validações — remover `job_pai_id`

**Files:**
- Modify: `lib/types.ts:506`
- Modify: `lib/validations/jobs.ts:39-46`

**Interfaces:**
- Consumes: nada.
- Produces: `Job` sem `job_pai_id`; `jobSchema` sem `posicao_hierarquia` nem `job_pai_id`.

- [ ] **Step 1: Remover `job_pai_id` da interface `Job`**

Em `lib/types.ts`, linha 506 aprox.:

```typescript
  job_pai_id: string | null;
```

**Deletar a linha.**

- [ ] **Step 2: Remover campos de hierarquia do `jobSchema`**

Em `lib/validations/jobs.ts`, linhas 39-46 aprox.:

```typescript
    // Hierarquia (usado só na criação do 2º+ job)
    posicao_hierarquia: z.enum(["principal", "sub_job"]).optional(),
    job_pai_id: z
      .string()
      .uuid()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v && v.length > 0 ? v : null)),
```

**Deletar as 9 linhas (comentário + 2 campos).**

- [ ] **Step 3: Rodar type-check**

```bash
npx tsc --noEmit
```

Expected: erros em arquivos que ainda referenciam `job.job_pai_id` (Task 4 vai limpar).

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts lib/validations/jobs.ts
git commit -m "$(cat <<'EOF'
refactor(types): remove job_pai_id de Job e posicao_hierarquia/job_pai_id de jobSchema

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Frontend detalhe — remover seção Hierarquia e drawer

**Files:**
- Modify: `app/(app)/jobs/[jobId]/page.tsx`
- Delete: `app/(app)/jobs/[jobId]/editar-hierarquia-drawer.tsx`

**Interfaces:**
- Consumes: `Job` sem `job_pai_id` (Task 3).
- Produces: página de detalhe sem seção "Hierarquia".

- [ ] **Step 1: Remover import de `EditarHierarquiaDrawer`**

Linha 12:

```typescript
import { EditarHierarquiaDrawer } from "./editar-hierarquia-drawer";
```

**Deletar.**

- [ ] **Step 2: Enxugar o SELECT do job**

Linhas ~71-79. Localizar o `.select("...")` gigante. Remover as substrings `job_pai_id, ` e `, pai:job_pai_id(id, codigo, nome)`. Resultado esperado:

```typescript
      .select(
        "id, tenant_id, empresa_id, codigo, nome, produto, cidade, data_inicio_prevista, data_fim_prevista, responsavel_id, valor_total, status, motivo_rejeicao, projeto_id, orcamento_id, versao_orcamento_aprovada_id, regional_id, created_at, updated_at, responsavel:profiles!responsavel_id(id, nome), regional:regionais(id, nome), orcamento:orcamentos(id, codigo, nome, projeto_id), versao:versoes_orcamento!versao_orcamento_aprovada_id(id, numero_versao, nome, moeda, percentual_honorarios, percentual_imposto), projeto:projetos(id, codigo, nome)",
      )
```

- [ ] **Step 3: Remover derivações de pai/sub-jobs**

Linhas ~93-119. Deletar:

```typescript
  const paiEmbed = (raw.pai ?? null) as
    | { id: string; codigo: string; nome: string }
    | null;

  // Fetch sub-jobs se este é principal
  let subJobs: { id: string; codigo: string; nome: string; status: JobStatus }[] = [];
  if (raw.job_pai_id === null) {
    const { data: subs } = await supabase
      .from("jobs")
      .select("id, codigo, nome, status")
      .eq("projeto_id", raw.projeto_id)
      .eq("job_pai_id", raw.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at");
    subJobs = (subs ?? []) as any[];
  }

  // Fetch outros jobs ativos do mesmo projeto (pra saber se hierarquia é editável)
  const { count: outrosAtivos } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("projeto_id", raw.projeto_id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("id", raw.id)
    .neq("status", "cancelado");

  const podeEditarHierarquia = (outrosAtivos ?? 0) > 0;
  const ehPrincipal = raw.job_pai_id === null;
```

**Deletar todo o bloco (~28 linhas).**

- [ ] **Step 4: Remover `job_pai_id` do mapping `Job`**

Linhas ~213-235. Localizar:

```typescript
    job_pai_id: raw.job_pai_id,
```

**Deletar a linha.**

- [ ] **Step 5: Remover a seção "Hierarquia" do JSX**

Linhas ~327-380. Localizar o bloco:

```tsx
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="h-4 w-4 text-california-red" />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Hierarquia</h2>
          </div>
          {ehPrincipal ? (
            ...
          ) : (
            ...
          )}
        </div>
```

**Deletar o `<div>` inteiro** (do `<div className="rounded-2xl ..."` até o `</div>` correspondente, ~53 linhas). O grid `md:grid-cols-2` do container pai continua funcionando com o card de Origem ocupando `md:col-span-2`.

- [ ] **Step 6: Remover import `Layers` se ficou órfão**

Linha 3:

```typescript
import { ArrowLeft, Briefcase, Layers, Info, Circle } from "lucide-react";
```

Verificar se `Layers` ainda é usado no arquivo. Se não, remover da lista. Se ainda for usado em outra parte, manter.

- [ ] **Step 7: Deletar `editar-hierarquia-drawer.tsx`**

```bash
rm "app/(app)/jobs/[jobId]/editar-hierarquia-drawer.tsx"
```

Ou via git:

```bash
git rm "app/(app)/jobs/[jobId]/editar-hierarquia-drawer.tsx"
```

- [ ] **Step 8: Rodar type-check**

```bash
npx tsc --noEmit
```

Expected: sem erros no `[jobId]/page.tsx` nem em arquivos que importavam o drawer.

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/jobs/[jobId]/page.tsx" "app/(app)/jobs/[jobId]/editar-hierarquia-drawer.tsx"
git commit -m "$(cat <<'EOF'
refactor(jobs/detalhe): remove secao Hierarquia e drawer de edicao

Job nao tem mais papel de principal/sub. Detalhe fica com metadata,
origem, status e rentabilidade — sem card de hierarquia. Drawer deletado.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Frontend lista — enxugar a query em `page.tsx`

**Files:**
- Modify: `app/(app)/jobs/page.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: `rows: JobRow[]` sem `job_pai_id`, `is_sub_job`, `tem_filhos`. Ainda carrega `projeto` embed (código, nome, cliente) — usado no agrupamento da Task 6.

- [ ] **Step 1: Enxugar o SELECT**

Linhas 15-22. Localizar:

```typescript
      .select(
        "id, codigo, nome, status, valor_total, data_inicio_prevista, job_pai_id, empresa_id, " +
          "projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia)), " +
          "responsavel:profiles!responsavel_id(nome), " +
          "filhos:jobs!job_pai_id(count), " +
          "empresa:empresas(id, razao_social, nome_fantasia)",
      )
```

Trocar por:

```typescript
      .select(
        "id, codigo, nome, status, valor_total, data_inicio_prevista, empresa_id, projeto_id, " +
          "projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia)), " +
          "responsavel:profiles!responsavel_id(nome), " +
          "empresa:empresas(id, razao_social, nome_fantasia)",
      )
```

Removi: `job_pai_id`, `filhos:jobs!job_pai_id(count)`. Adicionei explicitamente `projeto_id` (será usado no agrupamento client-side; hoje já vem via `.projeto` mas queremos o UUID cru direto).

- [ ] **Step 2: Enxugar o `.map((r: any) => ({...}))`**

Linhas 30-46. Trocar por:

```typescript
  const rows: JobRow[] = (jobsRes.data ?? []).map((r: any) => ({
    id: r.id,
    codigo: r.codigo,
    nome: r.nome,
    status: r.status,
    valor_total: r.valor_total !== null ? Number(r.valor_total) : null,
    data_inicio_prevista: r.data_inicio_prevista,
    projeto_id: r.projeto_id,
    projeto_codigo: r.projeto?.codigo ?? null,
    projeto_nome: r.projeto?.nome ?? null,
    cliente_nome: r.projeto?.cliente?.nome_fantasia ?? null,
    responsavel_nome: r.responsavel?.nome ?? null,
    empresa_id: r.empresa_id ?? null,
    empresa_nome: r.empresa?.nome_fantasia ?? r.empresa?.razao_social ?? null,
  }));
```

Removi: `job_pai_id`, `is_sub_job`, `tem_filhos`. Adicionei: `projeto_id`.

- [ ] **Step 3: Ordenar por `codigo` no server (opcional, mas ajuda o agrupamento)**

Linha 24, trocar:

```typescript
      .order("created_at", { ascending: false }),
```

Por:

```typescript
      .order("codigo", { ascending: true }),
```

Justificativa: agrupamento client-side vai iterar em ordem estável; ordenar por código no server evita reordenar depois.

- [ ] **Step 4: NÃO commitar ainda**

O type `JobRow` está definido em `jobs-list.tsx` e ainda tem `job_pai_id`, `is_sub_job`, `tem_filhos`. O type-check vai falhar. **Não commitar** — passar direto pra Task 6, que ajusta o type e a lista.

---

### Task 6: Frontend lista — reescrever agrupamento por projeto

**Files:**
- Modify: `app/(app)/jobs/jobs-list.tsx`

**Interfaces:**
- Consumes: `JobRow` com `projeto_id`, `projeto_codigo`, `projeto_nome`, `cliente_nome` (Task 5).
- Produces: componente `JobsList` que agrupa por `projeto_id` com header expansível quando o projeto tem 2+ jobs. Header do projeto navega pra `/jobs/projeto/[projetoId]`.

- [ ] **Step 1: Atualizar interface `JobRow`**

Linhas 18-34. Trocar por:

```typescript
export interface JobRow {
  id: string;
  codigo: string;
  nome: string;
  status: JobStatus;
  valor_total: number | null;
  data_inicio_prevista: string | null;
  projeto_id: string;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  responsavel_nome: string | null;
  empresa_id: string | null;
  empresa_nome: string | null;
}
```

Removi: `job_pai_id`, `is_sub_job`, `tem_filhos`.

- [ ] **Step 2: Substituir o `useMemo` `childrenByParent` por `gruposPorProjeto`**

Linhas 95-105. Trocar por:

```typescript
  const gruposPorProjeto = React.useMemo(() => {
    const map = new Map<string, JobRow[]>();
    for (const r of rows) {
      const arr = map.get(r.projeto_id) ?? [];
      arr.push(r);
      map.set(r.projeto_id, arr);
    }
    return map;
  }, [rows]);
```

Nomear a variável assim deixa claro que agora agrupamos por projeto, não por pai.

- [ ] **Step 3: Redefinir `DisplayRow` e reescrever `displayRows`**

Linhas 73-78 (tipo) e 107-161 (memo). Trocar por:

```typescript
type DisplayRow =
  | {
      kind: "projeto";
      projeto_id: string;
      projeto_codigo: string | null;
      projeto_nome: string | null;
      cliente_nome: string | null;
      quantidadeJobs: number;
      valorTotalGrupo: number;
      expanded: boolean;
    }
  | {
      kind: "job";
      row: JobRow;
      indentado: boolean;
    };

// ...

  const displayRows = React.useMemo<DisplayRow[]>(() => {
    const q = busca.trim().toLowerCase();
    const filterActive =
      statusAtivos.size > 0 || q !== "" || empresaFiltro !== "todas";

    function matches(r: JobRow): boolean {
      if (statusAtivos.size > 0 && !statusAtivos.has(r.status)) return false;
      if (empresaFiltro !== "todas" && r.empresa_id !== empresaFiltro)
        return false;
      if (q === "") return true;
      return (
        r.codigo.toLowerCase().includes(q) ||
        r.nome.toLowerCase().includes(q)
      );
    }

    // Ordena projetos pelo menor codigo de job dentro do grupo
    const projetosOrdenados = Array.from(gruposPorProjeto.entries())
      .map(([projetoId, jobsDoGrupo]) => {
        const ordenados = [...jobsDoGrupo].sort((a, b) =>
          a.codigo.localeCompare(b.codigo),
        );
        return { projetoId, jobs: ordenados };
      })
      .sort((a, b) => a.jobs[0].codigo.localeCompare(b.jobs[0].codigo));

    const out: DisplayRow[] = [];

    for (const { projetoId, jobs } of projetosOrdenados) {
      const jobsFiltrados = jobs.filter(matches);
      if (jobsFiltrados.length === 0) continue;

      // Caso 1: projeto original tem 1 job -> linha direta, sem header
      if (jobs.length === 1) {
        out.push({ kind: "job", row: jobsFiltrados[0], indentado: false });
        continue;
      }

      // Caso 2: projeto tem 2+ jobs -> header de projeto + jobs indentados
      const primeiro = jobs[0];
      const expanded = filterActive ? true : expandedIds.has(projetoId);

      out.push({
        kind: "projeto",
        projeto_id: projetoId,
        projeto_codigo: primeiro.projeto_codigo,
        projeto_nome: primeiro.projeto_nome,
        cliente_nome: primeiro.cliente_nome,
        quantidadeJobs: jobs.length,
        valorTotalGrupo: jobs.reduce(
          (s, j) => s + (j.valor_total ?? 0),
          0,
        ),
        expanded,
      });

      if (expanded) {
        for (const j of jobsFiltrados) {
          out.push({ kind: "job", row: j, indentado: true });
        }
      }
    }

    return out;
  }, [gruposPorProjeto, statusAtivos, busca, empresaFiltro, expandedIds]);
```

Notas:
- `expandedIds` continua funcionando, mas agora armazena `projeto_id` em vez de `job.id`.
- Quando há filtro ativo (busca/status/empresa), forço `expanded = true` pra revelar os jobs que casam.
- Se o projeto original tem 2+ jobs mas o filtro reduz a 1 job visível, o header ainda aparece (mantém a estabilidade do agrupamento). Se o filtro reduz a zero, o grupo some.

- [ ] **Step 4: Reescrever o `<tbody>` — cabeçalho de projeto e linhas de job**

Linhas 268-375. Trocar o `.map(...)` inteiro por:

```tsx
            {displayRows.map((dr) => {
              if (dr.kind === "projeto") {
                return (
                  <tr
                    key={`p-${dr.projeto_id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/jobs/projeto/${dr.projeto_id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/jobs/projeto/${dr.projeto_id}`);
                      }
                    }}
                    className="border-b border-border bg-muted/30 hover:bg-accent/50 cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-accent/50"
                  >
                    <td className="w-8 px-2 py-3 align-middle">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(dr.projeto_id);
                        }}
                        aria-label={dr.expanded ? "Colapsar jobs do projeto" : "Expandir jobs do projeto"}
                        aria-expanded={dr.expanded}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {dr.expanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {dr.projeto_codigo ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold">{dr.projeto_nome ?? "Projeto"}</span>
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        {dr.quantidadeJobs} jobs
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {dr.cliente_nome ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      {formatMoney(dr.valorTotalGrupo)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                  </tr>
                );
              }

              const r = dr.row;
              const isChild = dr.indentado;
              return (
                <tr
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/jobs/${r.id}?from=jobs`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/jobs/${r.id}?from=jobs`);
                    }
                  }}
                  className={cn(
                    "border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40",
                    isChild && "bg-muted/10",
                  )}
                >
                  <td className="w-8 px-2 py-3 align-middle" />
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      href={`/jobs/${r.id}?from=jobs`}
                      prefetch={false}
                      className="hover:text-california-red"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.codigo}
                    </Link>
                  </td>
                  <td className={cn("px-4 py-3", isChild && "pl-8")}>
                    <div className="flex flex-wrap items-center gap-2">
                      {isChild && (
                        <span
                          aria-hidden="true"
                          className="text-muted-foreground/60"
                        >
                          └
                        </span>
                      )}
                      <span className="font-medium">{r.nome}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {r.empresa_nome ? (
                      <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
                        {r.empresa_nome}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <span className="font-mono text-xs">{r.projeto_codigo}</span>{" "}
                    <span>{r.projeto_nome ?? ""}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.cliente_nome ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.responsavel_nome ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(r.data_inicio_prevista)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">
                    {formatMoney(r.valor_total)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={cn("border", statusBadgeClasses(r.status))}>
                      {jobStatusLabel(r.status)}
                    </Badge>
                  </td>
                </tr>
              );
            })}
```

Removi:
- Badges "Job principal" e "Sub-job".
- Chevron nas linhas de job (chevron agora só na linha de projeto).
- Import `Badge` continua sendo usado no status.

- [ ] **Step 5: Rodar type-check + lint**

```bash
npx tsc --noEmit
npx next lint
```

Expected: sem erros.

- [ ] **Step 6: Verificar visualmente**

Rodar dev server, abrir `/jobs`:

```bash
npm run dev
```

Verificar:
- Projeto com 1 job aparece como linha única, sem chevron, sem cabeçalho de projeto.
- Projeto com 2+ jobs aparece com header expansível (chevron), jobs indentados quando expandido.
- Click no chevron só expande/colapsa (não navega).
- Click no header do projeto navega pra `/jobs/projeto/[id]` (rota ainda não existe — 404 esperado até Task 9).
- Click num job navega pra `/jobs/[jobId]?from=jobs` normalmente.
- Filtro de status: se reduz jobs de um projeto de 3 para 1, header do projeto some (mantém agrupamento estável).

- [ ] **Step 7: Commit (Tasks 5 + 6 juntas)**

```bash
git add "app/(app)/jobs/page.tsx" "app/(app)/jobs/jobs-list.tsx"
git commit -m "$(cat <<'EOF'
feat(jobs/lista): agrupa por projeto quando ha 2+ jobs no mesmo projeto

Lista para de mostrar hierarquia principal/sub-job. Cada projeto vira um
header expansivel quando tem 2+ jobs; projetos com 1 job renderizam a
linha do job direta. Header do projeto navega para /jobs/projeto/[id]
(pagina de rentabilidade agregada, criada nas proximas tasks).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Função de agregação por projeto

**Files:**
- Create: `lib/calculos/projeto-totais.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  ```typescript
  export type LinhaGrupoProjeto = {
    chaveNormalizada: string;
    nomeExibicao: string;
    orcado: number;
    planejado: number;
    realizado: number;
  };

  export type JobParaAgregar = {
    grupos: { id: string; nome: string; created_at: string }[];
    itens: { id: string; grupo_id: string; total_orcado: number | string | null; total_planejado: number | string | null }[];
    realizadosPorItemId: Map<string, { total_realizado: number | string | null }>;
  };

  export function agregarRentabilidadePorProjeto(
    jobs: JobParaAgregar[],
  ): { linhas: LinhaGrupoProjeto[]; total: Omit<LinhaGrupoProjeto, "chaveNormalizada" | "nomeExibicao"> };
  ```

- [ ] **Step 1: Criar o arquivo com a função pura**

```typescript
// lib/calculos/projeto-totais.ts

/**
 * Agregacao de rentabilidade entre multiplos jobs do mesmo projeto.
 *
 * Grupos existem por versao de orcamento (cada job tem sua versao), entao
 * "Producao" no job A e "Producao" no job B sao registros distintos com o
 * mesmo nome. Agregamos por nome normalizado (trim + toLowerCase) e
 * exibimos o nome mais recente encontrado (por created_at do grupo).
 */

export type LinhaGrupoProjeto = {
  chaveNormalizada: string;
  nomeExibicao: string;
  orcado: number;
  planejado: number;
  realizado: number;
};

export type JobParaAgregar = {
  grupos: { id: string; nome: string; created_at: string }[];
  itens: {
    id: string;
    grupo_id: string;
    total_orcado: number | string | null;
    total_planejado: number | string | null;
  }[];
  realizadosPorItemId: Map<string, { total_realizado: number | string | null }>;
};

function normalizar(nome: string): string {
  return nome.trim().toLowerCase();
}

function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function agregarRentabilidadePorProjeto(
  jobs: JobParaAgregar[],
): {
  linhas: LinhaGrupoProjeto[];
  total: Omit<LinhaGrupoProjeto, "chaveNormalizada" | "nomeExibicao">;
} {
  type Acumulador = {
    chaveNormalizada: string;
    nomeMaisRecente: string;
    createdAtMaisRecente: string;
    orcado: number;
    planejado: number;
    realizado: number;
  };
  const mapa = new Map<string, Acumulador>();

  for (const job of jobs) {
    for (const grupo of job.grupos) {
      const chave = normalizar(grupo.nome);
      const itensDoGrupo = job.itens.filter((i) => i.grupo_id === grupo.id);

      const orcadoGrp = itensDoGrupo.reduce(
        (s, i) => s + toNumber(i.total_orcado),
        0,
      );
      const planejadoGrp = itensDoGrupo.reduce(
        (s, i) => s + toNumber(i.total_planejado),
        0,
      );
      const realizadoGrp = itensDoGrupo.reduce((s, i) => {
        const r = job.realizadosPorItemId.get(i.id);
        return s + toNumber(r?.total_realizado);
      }, 0);

      const atual = mapa.get(chave);
      if (!atual) {
        mapa.set(chave, {
          chaveNormalizada: chave,
          nomeMaisRecente: grupo.nome,
          createdAtMaisRecente: grupo.created_at,
          orcado: orcadoGrp,
          planejado: planejadoGrp,
          realizado: realizadoGrp,
        });
      } else {
        atual.orcado += orcadoGrp;
        atual.planejado += planejadoGrp;
        atual.realizado += realizadoGrp;
        if (grupo.created_at > atual.createdAtMaisRecente) {
          atual.nomeMaisRecente = grupo.nome;
          atual.createdAtMaisRecente = grupo.created_at;
        }
      }
    }
  }

  const linhas: LinhaGrupoProjeto[] = Array.from(mapa.values())
    .map((a) => ({
      chaveNormalizada: a.chaveNormalizada,
      nomeExibicao: a.nomeMaisRecente,
      orcado: a.orcado,
      planejado: a.planejado,
      realizado: a.realizado,
    }))
    .sort((a, b) => a.nomeExibicao.localeCompare(b.nomeExibicao));

  const total = linhas.reduce(
    (acc, l) => ({
      orcado: acc.orcado + l.orcado,
      planejado: acc.planejado + l.planejado,
      realizado: acc.realizado + l.realizado,
    }),
    { orcado: 0, planejado: 0, realizado: 0 },
  );

  return { linhas, total };
}
```

- [ ] **Step 2: Rodar type-check**

```bash
npx tsc --noEmit
```

Expected: sem erros. Como o arquivo é puro e não importa nada do projeto (só tipos inline), não deve dar problema.

- [ ] **Step 3: Commit**

```bash
git add lib/calculos/projeto-totais.ts
git commit -m "$(cat <<'EOF'
feat(calculos): funcao agregarRentabilidadePorProjeto por grupo entre jobs

Agrega Orcado/Planejado/Realizado por nome de grupo normalizado
(trim+lowercase), preservando o nome mais recente para exibicao. Sem
drilling em itens.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Nova página `/jobs/projeto/[projetoId]`

**Files:**
- Create: `app/(app)/jobs/projeto/[projetoId]/page.tsx`

**Interfaces:**
- Consumes: `agregarRentabilidadePorProjeto` (Task 7).
- Produces: server component acessível em `/jobs/projeto/[projetoId]` renderizando header do projeto, tabela de rentabilidade agregada por grupo e tabela dos jobs.

- [ ] **Step 1: Criar o arquivo com estrutura básica**

```typescript
// app/(app)/jobs/projeto/[projetoId]/page.tsx

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FolderKanban, Calculator } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { agregarRentabilidadePorProjeto, type JobParaAgregar } from "@/lib/calculos/projeto-totais";
import { jobStatusLabel, type JobStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: JobStatus): string {
  switch (status) {
    case "aberto":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "em_producao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "finalizado":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "cancelado":
      return "bg-slate-100 text-slate-500 border-slate-200";
    case "aguardando_abertura":
      return "bg-yellow-50 text-yellow-700 border-yellow-200";
    case "rejeitado_financeiro":
      return "bg-red-50 text-red-700 border-red-200";
  }
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function ProjetoAgregadoPage({
  params,
}: {
  params: { projetoId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  // 1. Buscar projeto + cliente + responsavel
  const { data: projeto } = await supabase
    .from("projetos")
    .select(
      "id, codigo, nome, cliente:clientes(nome_fantasia), responsavel:profiles!responsavel_id(nome)",
    )
    .eq("id", params.projetoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!projeto) notFound();

  // 2. Buscar jobs ativos (nao cancelados) do projeto
  const { data: jobsRaw } = await supabase
    .from("jobs")
    .select(
      "id, codigo, nome, status, valor_total, versao_orcamento_aprovada_id, responsavel:profiles!responsavel_id(nome)",
    )
    .eq("tenant_id", session.activeTenant.id)
    .eq("projeto_id", params.projetoId)
    .neq("status", "cancelado")
    .order("codigo", { ascending: true });

  const jobs = (jobsRaw ?? []) as Array<{
    id: string;
    codigo: string;
    nome: string;
    status: JobStatus;
    valor_total: number | string | null;
    versao_orcamento_aprovada_id: string;
    responsavel: { nome: string } | null;
  }>;

  if (jobs.length === 0) notFound();

  const versaoIds = jobs.map((j) => j.versao_orcamento_aprovada_id);

  // 3. Buscar grupos, itens e realizados em paralelo (todos os jobs de uma vez)
  const [gruposRes, itensRes, realizadosRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, nome, versao_orcamento_id, created_at")
      .eq("tenant_id", session.activeTenant.id)
      .in("versao_orcamento_id", versaoIds),
    supabase
      .from("versoes_orcamento_itens")
      .select("id, grupo_id, versao_orcamento_id, total_orcado, total_planejado")
      .eq("tenant_id", session.activeTenant.id)
      .in("versao_orcamento_id", versaoIds),
    supabase
      .from("jobs_itens_realizado")
      .select("item_id, total_realizado, job_id")
      .eq("tenant_id", session.activeTenant.id)
      .in(
        "job_id",
        jobs.map((j) => j.id),
      ),
  ]);

  const gruposByVersao = new Map<string, { id: string; nome: string; created_at: string }[]>();
  for (const g of (gruposRes.data ?? []) as any[]) {
    const arr = gruposByVersao.get(g.versao_orcamento_id) ?? [];
    arr.push({ id: g.id, nome: g.nome, created_at: g.created_at });
    gruposByVersao.set(g.versao_orcamento_id, arr);
  }

  const itensByVersao = new Map<
    string,
    { id: string; grupo_id: string; total_orcado: number | string | null; total_planejado: number | string | null }[]
  >();
  for (const it of (itensRes.data ?? []) as any[]) {
    const arr = itensByVersao.get(it.versao_orcamento_id) ?? [];
    arr.push({
      id: it.id,
      grupo_id: it.grupo_id,
      total_orcado: it.total_orcado,
      total_planejado: it.total_planejado,
    });
    itensByVersao.set(it.versao_orcamento_id, arr);
  }

  const realizadosByJob = new Map<string, Map<string, { total_realizado: number | string | null }>>();
  for (const r of (realizadosRes.data ?? []) as any[]) {
    const m = realizadosByJob.get(r.job_id) ?? new Map();
    m.set(r.item_id, { total_realizado: r.total_realizado });
    realizadosByJob.set(r.job_id, m);
  }

  const jobsParaAgregar: JobParaAgregar[] = jobs.map((j) => ({
    grupos: gruposByVersao.get(j.versao_orcamento_aprovada_id) ?? [],
    itens: itensByVersao.get(j.versao_orcamento_aprovada_id) ?? [],
    realizadosPorItemId: realizadosByJob.get(j.id) ?? new Map(),
  }));

  const { linhas, total } = agregarRentabilidadePorProjeto(jobsParaAgregar);

  // Status mix (breakdown por status)
  const statusMix = jobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.status] = (acc[j.status] ?? 0) + 1;
    return acc;
  }, {});

  const projetoTyped = projeto as any;
  const clienteNome = projetoTyped.cliente?.nome_fantasia ?? "—";
  const responsavelNome = projetoTyped.responsavel?.nome ?? "—";

  const deltaOrc = total.realizado - total.orcado;
  const deltaPlan = total.realizado - total.planejado;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para jobs
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <FolderKanban className="h-5 w-5 text-california-red" />
          </div>
          <div>
            <p className="font-mono text-xs font-semibold text-muted-foreground">
              {projetoTyped.codigo}
            </p>
            <h1 className="text-2xl font-bold tracking-tight">{projetoTyped.nome}</h1>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cliente</p>
          <p className="mt-1 text-sm font-semibold">{clienteNome}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Responsável</p>
          <p className="mt-1 text-sm font-semibold">{responsavelNome}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Jobs ativos</p>
          <p className="mt-1 text-sm font-semibold">{jobs.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Distribuição</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {Object.entries(statusMix)
              .map(([s, n]) => `${n} ${jobStatusLabel(s as JobStatus).toLowerCase()}`)
              .join(" · ")}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex items-center gap-2 border-b border-border p-6">
          <Calculator className="h-5 w-5 text-california-red" />
          <div>
            <h2 className="text-lg font-semibold leading-none tracking-tight">
              Rentabilidade agregada
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Orçado × Planejado × Realizado somados por grupo entre todos os jobs.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Grupo</th>
                <th className="px-4 py-3 font-semibold text-right">Orçado</th>
                <th className="px-4 py-3 font-semibold text-right">Planejado</th>
                <th className="px-4 py-3 font-semibold text-right">Realizado</th>
                <th className="px-4 py-3 font-semibold text-right">Δ Real vs Orç</th>
                <th className="px-4 py-3 font-semibold text-right">Δ Real vs Plan</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Sem itens orçados nos jobs deste projeto.
                  </td>
                </tr>
              )}
              {linhas.map((l) => {
                const dOrc = l.realizado - l.orcado;
                const dPlan = l.realizado - l.planejado;
                return (
                  <tr key={l.chaveNormalizada} className="border-b border-border">
                    <td className="px-4 py-3 font-medium">{l.nomeExibicao}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatMoney(l.orcado)}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {l.planejado > 0 ? formatMoney(l.planejado) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {l.realizado > 0 ? formatMoney(l.realizado) : "—"}
                    </td>
                    <td className={cn("px-4 py-3 text-right font-mono", dOrc > 0 ? "text-california-red" : "text-emerald-700")}>
                      {formatMoney(dOrc)}
                    </td>
                    <td className={cn("px-4 py-3 text-right font-mono", dPlan > 0 ? "text-california-red" : "text-emerald-700")}>
                      {formatMoney(dPlan)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-t-border bg-muted/20">
                <td className="px-4 py-3 font-semibold uppercase tracking-wider text-xs">Total</td>
                <td className="px-4 py-3 text-right font-mono font-bold">
                  {formatMoney(total.orcado)}
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold">
                  {total.planejado > 0 ? formatMoney(total.planejado) : "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold">
                  {total.realizado > 0 ? formatMoney(total.realizado) : "—"}
                </td>
                <td className={cn("px-4 py-3 text-right font-mono font-bold", deltaOrc > 0 ? "text-california-red" : "text-emerald-700")}>
                  {formatMoney(deltaOrc)}
                </td>
                <td className={cn("px-4 py-3 text-right font-mono font-bold", deltaPlan > 0 ? "text-california-red" : "text-emerald-700")}>
                  {formatMoney(deltaPlan)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
        <div className="border-b border-border p-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Jobs do projeto
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {jobs.length} jobs ativos. Clique em um para abrir os detalhes.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Nome</th>
              <th className="px-4 py-3 font-semibold">Responsável</th>
              <th className="px-4 py-3 font-semibold text-right">Valor</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors">
                <td className="px-4 py-3 font-mono text-xs">
                  <Link
                    href={`/jobs/${j.id}?from=jobs`}
                    prefetch={false}
                    className="text-california-red hover:underline"
                  >
                    {j.codigo}
                  </Link>
                </td>
                <td className="px-4 py-3 font-medium">{j.nome}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {j.responsavel?.nome ?? "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {j.valor_total !== null && j.valor_total !== undefined
                    ? formatMoney(Number(j.valor_total))
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge className={cn("border", statusBadgeClasses(j.status))}>
                    {jobStatusLabel(j.status)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rodar type-check**

```bash
npx tsc --noEmit
```

Expected: sem erros.

- [ ] **Step 3: Verificar visualmente**

Rodar dev server. Navegar `/jobs` → clicar num header de projeto com 2+ jobs → deve abrir a página nova.

Checagem:
- Header do projeto correto.
- Cards de resumo (cliente, responsável, jobs ativos, distribuição de status).
- Tabela de rentabilidade agregada: 1 linha por grupo, coluna de Total ao final, deltas coloridos.
- Tabela de jobs: links pra `/jobs/[jobId]` funcionando.
- Botão voltar leva pra `/jobs`.
- **Não há botão de PP** em lugar nenhum.

Testar borda: projeto com jobs sem realizado ainda — colunas Planejado/Realizado mostram `—`.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/jobs/projeto/[projetoId]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(jobs/projeto): pagina de rentabilidade agregada por projeto

Nova rota /jobs/projeto/[projetoId] que soma Orcado/Planejado/Realizado
por grupo entre todos os jobs ativos do projeto. Sem drilling em itens,
sem PP, apenas leitura. Acessada pelo agrupamento visual da lista /jobs
quando o projeto tem 2+ jobs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Refactor `job-totais-card.tsx` para usar `agregarRentabilidadePorProjeto`

**Files:**
- Modify: `app/(app)/jobs/[jobId]/realizado/job-totais-card.tsx:61-83`

**Interfaces:**
- Consumes: `agregarRentabilidadePorProjeto` e `JobParaAgregar` de `@/lib/calculos/projeto-totais` (Task 7).
- Produces: mesma UI, mesmo output visual, mas o rollup por grupo passa pela função compartilhada com a página do projeto (garante consistência entre visão individual e agregada).

- [ ] **Step 1: Adicionar import**

No topo do arquivo, junto aos imports existentes de `@/lib/calculos/versao-totais`:

```typescript
import {
  agregarRentabilidadePorProjeto,
  type JobParaAgregar,
} from "@/lib/calculos/projeto-totais";
```

- [ ] **Step 2: Substituir o bloco de rollup por grupo (linhas ~61-83)**

Trocar:

```typescript
  // Agrupamentos por grupo
  const linhas = grupos.map((g) => {
    const itensDoGrupo = itens.filter((i) => i.grupo_id === g.id);
    const orcadoGrp = itensDoGrupo.reduce(
      (s, i) => s + Number(i.total_orcado ?? 0),
      0,
    );
    const planejadoGrp = itensDoGrupo.reduce(
      (s, i) => s + Number(i.total_planejado ?? 0),
      0,
    );
    const realizadoGrp = itensDoGrupo.reduce((s, i) => {
      const r = realizadosMap.get(i.id);
      return s + (r ? Number(r.total_realizado ?? 0) : 0);
    }, 0);
    return {
      id: g.id,
      nome: g.nome,
      orcado: orcadoGrp,
      planejado: planejadoGrp,
      realizado: realizadoGrp,
    };
  });
```

Por:

```typescript
  // Agrupamentos por grupo — reusa a mesma funcao usada na pagina de projeto,
  // garantindo que visao individual e visao agregada calculam da mesma forma.
  const jobParaAgregar: JobParaAgregar = {
    grupos: grupos.map((g) => ({
      id: g.id,
      nome: g.nome,
      created_at: g.created_at,
    })),
    itens: itens.map((i) => ({
      id: i.id,
      grupo_id: i.grupo_id,
      total_orcado: i.total_orcado,
      total_planejado: i.total_planejado,
    })),
    realizadosPorItemId: realizadosMap as unknown as Map<
      string,
      { total_realizado: number | string | null }
    >,
  };
  const { linhas: linhasAgregadas } = agregarRentabilidadePorProjeto([
    jobParaAgregar,
  ]);
  const linhas = linhasAgregadas.map((l) => ({
    id: l.chaveNormalizada,
    nome: l.nomeExibicao,
    orcado: l.orcado,
    planejado: l.planejado,
    realizado: l.realizado,
  }));
```

Observação: dentro de 1 job só há 1 grupo por nome (é o design da tabela `versoes_orcamento_grupos`), então `chaveNormalizada` acaba sendo o único identificador estável — funciona bem como `key` React. `nomeExibicao` = nome original (só há 1 pra escolher).

- [ ] **Step 3: Rodar type-check e verificar o card visualmente**

```bash
npx tsc --noEmit
npm run dev
```

Abrir um job com itens em `/jobs/[jobId]` → aba Rentabilidade. Confirmar que:
- A tabela "Totais do job" continua mostrando as mesmas linhas por grupo.
- Valores Orçado/Planejado/Realizado batem com o que aparecia antes.
- Subtotais por tipo (A/B/C/D), honorários, imposto, faturamento, resultado real — nada disso mudou.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/jobs/[jobId]/realizado/job-totais-card.tsx"
git commit -m "$(cat <<'EOF'
refactor(jobs/realizado): usa agregarRentabilidadePorProjeto no card de totais

Rollup por grupo agora passa pela funcao compartilhada com a pagina de
projeto agregado, evitando divergencia entre visao individual e agregada.
Mesma UI, mesmos valores.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Migration — drop de `job_pai_id`

**Files:**
- Create: `supabase/migrations/20260803000001_remover_hierarquia_jobs.sql`

**Interfaces:**
- Consumes: nenhum código do repo referencia mais `job_pai_id` (tasks 1-4 removeram).
- Produces: schema sem `job_pai_id`, sem `uniq_jobs_principal_por_projeto`, sem `jobs_nao_pai_de_si_mesmo`.

- [ ] **Step 1: Pré-checagem em prod (via MCP Supabase)**

Rodar contra o projeto Supabase do califa-erp (memory `project_supabase_setup.md` — projeto `avlwxyknvhlzvnysbzrg`):

```sql
select projeto_id, orcamento_id, count(*)
from public.jobs
where status <> 'cancelado'
group by 1, 2
having count(*) > 1;
```

Usar `mcp__supabase__execute_sql` (read).

Expected: 0 linhas. Se retornar algo, **PARAR** — há dois jobs ativos pro mesmo orçamento (situação anômala). Reportar ao usuário antes de continuar; cancelar o duplicado à mão e re-rodar.

- [ ] **Step 2: Criar o arquivo de migration**

```sql
-- =====================================================================
-- Remover hierarquia job principal/sub-job.
--
-- Origem: spec "2026-08-03-remover-hierarquia-jobs-design.md". A partir
-- desta migration, todo orcamento aprovado vira um job normal, sem
-- distincao de principal/sub. O agrupamento por projeto passa a ser
-- puramente visual na lista /jobs quando ha 2+ jobs.
--
-- Nao migramos dados: sub-jobs existentes viram jobs normais ao dropar
-- a coluna. A regra "1 job ativo por orcamento" continua garantida pelo
-- indice uniq_jobs_por_orcamento_ativo, que permanece.
--
-- Pre-checagem obrigatoria (rodada antes desta migration):
--   select projeto_id, orcamento_id, count(*)
--   from public.jobs
--   where status <> 'cancelado'
--   group by 1, 2
--   having count(*) > 1;
-- Se retornar linhas, cancelar duplicidades antes de aplicar.
-- =====================================================================

drop index if exists public.uniq_jobs_principal_por_projeto;

alter table public.jobs
  drop constraint if exists jobs_nao_pai_de_si_mesmo;

alter table public.jobs
  drop column if exists job_pai_id;
```

- [ ] **Step 3: Aplicar a migration via MCP Supabase**

Usar `mcp__supabase-write__apply_migration` com:
- `name`: `remover_hierarquia_jobs`
- `query`: o conteúdo SQL acima

- [ ] **Step 4: Verificar que dropou**

Via `mcp__supabase__list_tables` (schema `public`, table `jobs`), confirmar que:
- Coluna `job_pai_id` sumiu.
- Não há mais índice `uniq_jobs_principal_por_projeto`.
- Índice `uniq_jobs_por_orcamento_ativo` continua presente.

Ou via `mcp__supabase__execute_sql`:

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'jobs'
order by ordinal_position;
```

Expected: `job_pai_id` **não aparece**.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803000001_remover_hierarquia_jobs.sql
git commit -m "$(cat <<'EOF'
feat(db): drop coluna jobs.job_pai_id e indice uniq_jobs_principal_por_projeto

Hierarquia principal/sub-job foi removida do modelo. Cada orcamento
aprovado vira um job normal. Indice uniq_jobs_por_orcamento_ativo
permanece garantindo 1 job ativo por orcamento.

Pre-checagem executada em prod: 0 duplicidades ativas.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Verificação final

**Files:**
- Nenhum. Só checagens.

**Interfaces:**
- Consumes: todo o sistema atualizado.
- Produces: confirmação de que lint, build e fluxos manuais estão OK.

- [ ] **Step 1: Rodar lint**

```bash
npx next lint
```

Expected: sem erros novos. Se aparecer warning de `unused import` em algum arquivo tocado, limpar e re-commitar.

- [ ] **Step 2: Rodar build**

```bash
npm run build
```

Expected: build passa. Se falhar, ler mensagem — provavelmente é referência residual a `job_pai_id` que passou batido.

- [ ] **Step 3: Verificação manual — fluxo de aprovação**

Rodar dev server:

```bash
npm run dev
```

- Ir num projeto que já tem 1 job.
- Aprovar 2ª versão de outro orçamento do mesmo projeto.
- Confirmar que:
  - Novo job nasce sem erro.
  - Sem mensagem de "principal / sub-job".
  - Ambos aparecem na lista `/jobs` agrupados sob o projeto.

- [ ] **Step 4: Verificação manual — lista `/jobs`**

- Projeto com 1 job: aparece linha direta.
- Projeto com 2+ jobs: aparece linha de projeto com chevron, expande/colapsa, clique no header leva pra página de projeto.
- Filtros funcionam (status, empresa, busca).

- [ ] **Step 5: Verificação manual — página `/jobs/projeto/[id]`**

- Header do projeto correto.
- Tabela de rentabilidade agregada com totais coerentes (comparar mentalmente com a soma dos jobs individuais).
- Tabela de jobs com links funcionando.
- Nenhum botão de PP.
- Voltar leva pra `/jobs`.

- [ ] **Step 6: Verificação manual — detalhe do job `/jobs/[jobId]`**

- Sem seção "Hierarquia".
- Metadata, Origem, Status intactos.
- Aba Rentabilidade (`JobRealizadoSection`) funciona normal, PP intacto.

- [ ] **Step 7: (Opcional) Ajustes finais**

Se algo estiver visualmente esquisito (espaçamento, cores, alinhamento) na lista agrupada ou na página de projeto, ajustar e commitar como `fix(ui)`.

- [ ] **Step 8: Reportar conclusão**

Não precisa commit se nada mudou. Reportar ao usuário: spec + plano executados, todos os fluxos verificados. Pronto pra deploy.
