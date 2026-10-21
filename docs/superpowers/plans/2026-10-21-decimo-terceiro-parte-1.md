# 13º Salário — Parte 1 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a fundação do módulo de 13º salário: tabelas no banco, lógica pura de cálculo testada, listagem de folhas por ano, criação da folha com snapshot automático, página de detalhe com edição linha a linha e exportação em XLSX.

**Architecture:** Duas tabelas novas (`decimo_terceiro_folhas` + `decimo_terceiro_linhas`) seguem o padrão de Férias (fundação → lançamentos). Cálculo mora em `lib/decimo-terceiro/calc.ts` (puro, testável). UI em `app/(app)/rh/decimo-terceiro/` com listagem, detalhe `[ano]` e server actions. Exportação XLSX via ExcelJS replicando o layout da planilha atual.

**Tech Stack:** Next.js App Router · Supabase Postgres + RLS · TypeScript · ExcelJS · node:test + tsx.

**Spec:** `docs/superpowers/specs/2026-10-21-decimo-terceiro-parte-1-design.md`

## Global Constraints

- Tabelas novas nascem com: `tenant_id` NOT NULL, RLS ligada, policies para `authenticated` filtradas por tenant (role `administrador` OR `rh`), GRANT para `authenticated`, nada para `anon`, índices em todas as FKs.
- Policies RLS usam `(select auth.uid())` ou os helpers `is_tenant_admin(tenant_id)` / `is_tenant_rh(tenant_id)`.
- Migration prefixada `20261021NNNNNN_decimo_terceiro_*.sql`, com racional no topo, aplicada via `mcp__supabase-write__apply_migration` e conferida via MCP antes do commit.
- `lib/types.ts` escrito à mão: toda migration que mexe em coluna usada pelo frontend atualiza o tipo correspondente **no mesmo commit** (CLAUDE.md).
- Nenhum arquivo versionado contém PII real (nome, CPF, email, telefone, salário real). Testes usam `COLABORADOR 001 EXEMPLO`, `190.000.NNN-00`, etc.
- Toda string de UI em pt-BR correto com acentos (CLAUDE.md "Ortografia").
- Queries independentes num server component usam `Promise.all` (regra `docs/PERFORMANCE.md`).
- Tabelas: INSS 2026 (7,5%/9%/12%/14%) e IRRF 2026 (0%/7,5%/15%/22,5%/27,5%) com faixas e deduções fixas conforme spec.
- Base de cálculo INSS/IRRF = **13º bruto integral** (`salario/12 × avos`), não a 2ª parcela.
- Elegibilidade: `tipo_contratacao` IN (`clt`, `clt_recibo`, `pj`, `mei`); estágio e sócio ficam de fora.
- Audit via `logAuditEvent` em cada action.

## Review Focus

Pontos que o spec implica mas que nenhuma tarefa específica martela — rodar o olho aqui antes de aprovar o PR final:

1. **Colaborador desligado no ano** (`data_encerramento >= '{ano}-01-01'` mas `< '{ano}-12-31'`) deve entrar na folha com os avos até o mês de desligamento. Spec cobre em "Elegibilidade" mas o cálculo de avos atual olha só `data_admissao` — na Parte 1 o desligamento vira override manual.
2. **Admissão em `{ano+1}` ou anterior a `{ano-1}` encerrada antes de `{ano}`** não deve entrar na folha (filtro de elegibilidade).
3. **Avos = 0** (admitido após 15/dez) aparece na linha com zeros e `obs` automática, não some.
4. **Snapshot vs cadastro vivo:** editar o salário em `colaboradores_salarios` depois da folha criada NÃO muda o `snapshot_salario`. Só o botão "Recalcular folha" rebusca o salário.
5. **Duas folhas pro mesmo ano:** o unique `(tenant_id, ano)` bloqueia a segunda tentativa de criar; a action retorna erro amigável.

Cada item vira teste na task que o cobre (Task 2 pros itens 2/3; Task 3 pros itens 1/5; Task 4 pro item 4).

---

### Task 1: Migration (banco) + tipos TypeScript

**Files:**
- Create: `supabase/migrations/20261021000001_decimo_terceiro_fundacao.sql`
- Modify: `lib/types.ts` (adicionar os tipos ao final da seção RH)

**Interfaces:**
- Produces: enum SQL `decimo_terceiro_folha_status`; tabelas `decimo_terceiro_folhas` e `decimo_terceiro_linhas`; TypeScript `DecimoTerceiroFolhaStatus`, `DecimoTerceiroFolha`, `DecimoTerceiroLinha`.

- [ ] **Step 1: Escrever a migration**

Arquivo `supabase/migrations/20261021000001_decimo_terceiro_fundacao.sql` com, nesta ordem:

Cabeçalho com racional (motivo, referência ao spec, decisões incorporadas, caráter aditivo).

Enum:

```sql
create type public.decimo_terceiro_folha_status as enum ('rascunho');
```

Tabela `decimo_terceiro_folhas` com colunas: `id uuid pk default gen_random_uuid()`, `tenant_id uuid not null references tenants(id) on delete restrict`, `ano smallint not null check (ano between 2020 and 2100)`, `status decimo_terceiro_folha_status not null default 'rascunho'`, `criada_em timestamptz not null default now()`, `criada_por uuid references auth.users(id)`, `recalculada_em timestamptz`, `recalculada_por uuid references auth.users(id)`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`. Constraint `uniq_decimo_terceiro_folha_ano unique (tenant_id, ano)`.

Tabela `decimo_terceiro_linhas` com colunas:
- Identificação: `id`, `tenant_id`, `folha_id uuid not null references decimo_terceiro_folhas(id) on delete cascade`, `colaborador_id uuid not null references colaboradores(id) on delete restrict`
- Snapshot: `snapshot_nome text not null`, `snapshot_cpf text`, `snapshot_tipo_contratacao tipo_contratacao not null`, `snapshot_funcao text not null`, `snapshot_data_admissao date not null`, `snapshot_salario numeric(14,2) not null check (snapshot_salario >= 0)`, `snapshot_empresa_id uuid references empresas(id)`
- Calculados: `avos smallint not null check (avos between 0 and 12)`, `total_adiantado numeric(14,2) not null default 0`, `primeira_parcela numeric(14,2) not null`, `segunda_parcela numeric(14,2) not null`, `desconto_inss numeric(14,2) not null default 0`, `desconto_irrf numeric(14,2) not null default 0`, `total_bruto numeric(14,2) not null`, `total_liquido numeric(14,2) not null`
- Override: `editado_manualmente boolean not null default false`, `salario_editado numeric(14,2) check (salario_editado is null or salario_editado >= 0)`, `avos_editado smallint check (avos_editado is null or avos_editado between 0 and 12)`, `obs text`
- Audit: `created_at`, `updated_at`, `created_by uuid references auth.users(id)`, `updated_by uuid references auth.users(id)`
- Constraint `uniq_decimo_terceiro_linha_colab unique (folha_id, colaborador_id)`

Trigger `trg_decimo_terceiro_folhas_updated_at` e `trg_decimo_terceiro_linhas_updated_at` chamando `fn_set_updated_at()` (função já existe no banco).

Índices: `idx_decimo_terceiro_folhas_tenant_ano (tenant_id, ano)`, `idx_decimo_terceiro_linhas_folha (folha_id)`, `idx_decimo_terceiro_linhas_colaborador (colaborador_id)`.

RLS: `enable row level security` nas duas. Policies `all to authenticated` com `using/with check` = `is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)` (helpers existentes).

GRANT: `grant select, insert, update, delete on public.decimo_terceiro_folhas, public.decimo_terceiro_linhas to authenticated;`. Nada pra `anon`.

Comments: comentários nas duas tabelas e nas colunas de snapshot/override explicando por que existem.

- [ ] **Step 2: Aplicar via MCP**

Chamar `mcp__supabase-write__apply_migration` com nome `decimo_terceiro_fundacao` e o conteúdo do SQL. Verificar `success: true`.

- [ ] **Step 3: Conferir a aplicação**

Rodar via `mcp__supabase__execute_sql`:

```sql
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema='public' and table_name like 'decimo_terceiro_%'
 order by table_name, ordinal_position;

select tablename, policyname from pg_policies where tablename like 'decimo_terceiro_%';

select grantee, privilege_type from information_schema.role_table_grants
 where table_schema='public' and table_name like 'decimo_terceiro_%'
 order by grantee, privilege_type;
```

Esperado: todas as colunas da spec presentes, 2 policies por tabela (rh/admin), GRANT `authenticated` com `SELECT/INSERT/UPDATE/DELETE`, nenhum GRANT pra `anon`.

- [ ] **Step 4: Adicionar tipos em `lib/types.ts`**

Ao final da seção de RH (depois de `ColaboradorFeriasLancamento`):

```ts
export type DecimoTerceiroFolhaStatus = "rascunho";

export interface DecimoTerceiroFolha {
  id: string;
  tenant_id: string;
  ano: number;
  status: DecimoTerceiroFolhaStatus;
  criada_em: string;
  criada_por: string | null;
  recalculada_em: string | null;
  recalculada_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface DecimoTerceiroLinha {
  id: string;
  tenant_id: string;
  folha_id: string;
  colaborador_id: string;
  snapshot_nome: string;
  snapshot_cpf: string | null;
  snapshot_tipo_contratacao: TipoContratacao;
  snapshot_funcao: string;
  snapshot_data_admissao: string;
  snapshot_salario: number;
  snapshot_empresa_id: string | null;
  avos: number;
  total_adiantado: number;
  primeira_parcela: number;
  segunda_parcela: number;
  desconto_inss: number;
  desconto_irrf: number;
  total_bruto: number;
  total_liquido: number;
  editado_manualmente: boolean;
  salario_editado: number | null;
  avos_editado: number | null;
  obs: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}
```

- [ ] **Step 5: Rodar `npm run typecheck`**

Expected: nenhum erro novo.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261021000001_decimo_terceiro_fundacao.sql lib/types.ts
git commit -m "feat(13º): fundação do banco e tipos TypeScript"
```

---

### Task 2: Lógica pura de cálculo (TDD)

**Files:**
- Create: `lib/decimo-terceiro/calc.ts`
- Test: `lib/decimo-terceiro/calc.test.ts`
- Modify: `package.json` (adicionar script `test:decimo-terceiro`)

**Interfaces:**
- Produces:
  - `calcularAvos(dataAdmissao: Date, ano: number): number` — 0 a 12, regra do dia 15.
  - `calcularInss2026(base: number): number` — desconto do INSS sobre o 13º bruto integral.
  - `calcularIrrf2026(base: number, inssDescontado: number): number` — desconto do IRRF sobre (base − INSS).
  - `calcularLinhaDecimoTerceiro(input: CalcInput): CalcOutput` — orquestra avos + parcelas + descontos.
  - Tipo `CalcInput = { salario: number; dataAdmissao: Date; ano: number; tipoContratacao: TipoContratacao; totalAdiantado: number; salarioEditado?: number | null; avosEditado?: number | null }`.
  - Tipo `CalcOutput = { avos, primeiraParcela, segundaParcela, descontoInss, descontoIrrf, totalBruto, totalLiquido }` todos `number`.

- [ ] **Step 1: Escrever testes de `calcularAvos` (falhando)**

Em `lib/decimo-terceiro/calc.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularAvos } from "./calc";

test("avos: admitido antes do ano = 12", () => {
  assert.equal(calcularAvos(new Date("2020-05-10"), 2026), 12);
});

test("avos: admitido em jan/2026 dia 10 = 12 (regra do dia 15)", () => {
  assert.equal(calcularAvos(new Date("2026-01-10"), 2026), 12);
});

test("avos: admitido em jan/2026 dia 20 = 11", () => {
  assert.equal(calcularAvos(new Date("2026-01-20"), 2026), 11);
});

test("avos: admitido em out/2026 dia 1 = 3", () => {
  assert.equal(calcularAvos(new Date("2026-10-01"), 2026), 3);
});

test("avos: admitido em dez/2026 dia 20 = 0", () => {
  assert.equal(calcularAvos(new Date("2026-12-20"), 2026), 0);
});

test("avos: admitido depois do ano = 0", () => {
  assert.equal(calcularAvos(new Date("2027-01-10"), 2026), 0);
});
```

- [ ] **Step 2: Rodar o teste e verificar que falha**

```
node --import tsx --test lib/decimo-terceiro/calc.test.ts
```

Expected: FAIL com "Cannot find module './calc'".

- [ ] **Step 3: Implementar `calcularAvos` em `lib/decimo-terceiro/calc.ts`**

Função pura. Lógica da spec (equivalente à da planilha):

```
if dataAdmissao > ano-12-31: 0
elif dataAdmissao <= ano-01-01: 12
elif dia(dataAdmissao) <= 15: 13 - mes(dataAdmissao)
else: 12 - mes(dataAdmissao)
```

Rodar o teste. Expected: PASS nos 6 casos.

- [ ] **Step 4: Escrever testes de `calcularInss2026`**

Mesmo arquivo, novos testes exercitando cada faixa:

```ts
test("inss: faixa 1 (até 1.518) = base * 7,5%", () => {
  assert.equal(calcularInss2026(1000), 75);
});
test("inss: faixa 2 (1.518–2.793,88) = base * 9% - 22,77", () => {
  assert.equal(round2(calcularInss2026(2000)), round2(2000 * 0.09 - 22.77));
});
test("inss: faixa 3 (2.793,88–4.190,83) = base * 12% - 106,59", () => {
  assert.equal(round2(calcularInss2026(3500)), round2(3500 * 0.12 - 106.59));
});
test("inss: faixa 4 (4.190,83–8.157,41) = base * 14% - 190,40", () => {
  assert.equal(round2(calcularInss2026(5000)), round2(5000 * 0.14 - 190.4));
});
test("inss: teto (acima de 8.157,41) = 8.157,41 * 14% - 190,40", () => {
  assert.equal(round2(calcularInss2026(20000)), round2(8157.41 * 0.14 - 190.4));
});
```

Helper `round2` definido no topo do arquivo de teste: `const round2 = (n: number) => Math.round(n * 100) / 100`.

Rodar: FAIL (função não existe).

- [ ] **Step 5: Implementar `calcularInss2026`**

Tabela como constante local ao módulo, aplicando faixa progressiva da spec. Função pura, sem dependências. Rodar: PASS nos 5 casos.

- [ ] **Step 6: Escrever testes de `calcularIrrf2026`**

```ts
test("irrf: faixa isenta (base ajustada <= 1.518) = 0", () => {
  assert.equal(calcularIrrf2026(1000, 75), 0);
});
test("irrf: faixa 7,5%", () => {
  const base = 2500, inss = calcularInss2026(base);
  const esperado = (base - inss) * 0.075 - 169.44;
  assert.equal(round2(calcularIrrf2026(base, inss)), round2(Math.max(0, esperado)));
});
// 3 testes semelhantes para faixas 15%, 22,5%, 27,5%
```

Rodar: FAIL.

- [ ] **Step 7: Implementar `calcularIrrf2026`**

A base do IRRF é `base − inssDescontado`. Faixas da spec. Retorna `Math.max(0, calculado)` pra não ter negativo. Rodar: PASS.

- [ ] **Step 8: Escrever testes de `calcularLinhaDecimoTerceiro`**

```ts
test("linha CLT ano cheio: integral desconta INSS e IRRF", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 5000, dataAdmissao: new Date("2020-01-01"), ano: 2026,
    tipoContratacao: "clt", totalAdiantado: 0,
  });
  assert.equal(r.avos, 12);
  assert.equal(r.primeiraParcela, 2500);
  assert.equal(r.segundaParcela, 2500);
  assert.ok(r.descontoInss > 0);
  assert.ok(r.descontoIrrf > 0);
  assert.equal(r.totalBruto, 5000);
  assert.equal(round2(r.totalLiquido), round2(5000 - r.descontoInss - r.descontoIrrf));
});

test("linha PJ ano cheio: sem descontos", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 5000, dataAdmissao: new Date("2020-01-01"), ano: 2026,
    tipoContratacao: "pj", totalAdiantado: 0,
  });
  assert.equal(r.descontoInss, 0);
  assert.equal(r.descontoIrrf, 0);
  assert.equal(r.totalLiquido, 5000);
});

test("linha com adiantamento abate da 1ª parcela", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 5000, dataAdmissao: new Date("2020-01-01"), ano: 2026,
    tipoContratacao: "pj", totalAdiantado: 1000,
  });
  assert.equal(r.primeiraParcela, 1500);
  assert.equal(r.segundaParcela, 2500);
});

test("linha com avos=0 (admitido após 15/dez): tudo zero", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 5000, dataAdmissao: new Date("2026-12-20"), ano: 2026,
    tipoContratacao: "clt", totalAdiantado: 0,
  });
  assert.equal(r.avos, 0);
  assert.equal(r.primeiraParcela, 0);
  assert.equal(r.segundaParcela, 0);
  assert.equal(r.totalBruto, 0);
  assert.equal(r.totalLiquido, 0);
});

test("linha com salarioEditado sobrescreve snapshot", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 5000, dataAdmissao: new Date("2020-01-01"), ano: 2026,
    tipoContratacao: "pj", totalAdiantado: 0, salarioEditado: 10000,
  });
  assert.equal(r.totalBruto, 10000);
});

test("linha com avosEditado sobrescreve calculado", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 6000, dataAdmissao: new Date("2026-10-01"), ano: 2026,
    tipoContratacao: "pj", totalAdiantado: 0, avosEditado: 12,
  });
  assert.equal(r.avos, 12);
  assert.equal(r.totalBruto, 6000);
});
```

Rodar: FAIL.

- [ ] **Step 9: Implementar `calcularLinhaDecimoTerceiro`**

Orquestração:
1. `avos = avosEditado ?? calcularAvos(dataAdmissao, ano)`
2. `salario = salarioEditado ?? snapshot_salario`
3. `baseIntegral = salario / 12 * avos`
4. `primeiraParcela = baseIntegral / 2 - totalAdiantado` (não deixar negativo)
5. `segundaParcela = baseIntegral / 2`
6. Se CLT (`clt` ou `clt_recibo`) e `avos > 0`: `descontoInss = calcularInss2026(baseIntegral)`, `descontoIrrf = calcularIrrf2026(baseIntegral, descontoInss)`. Senão 0.
7. `totalBruto = primeiraParcela + segundaParcela` (sem subtrair adiantamento — ele já saiu da 1ª parc)
8. `totalLiquido = totalBruto - descontoInss - descontoIrrf`
9. Todos os valores arredondados pra 2 casas.

Rodar: PASS nos 6 casos.

- [ ] **Step 10: Adicionar script no `package.json`**

```json
"test:decimo-terceiro": "node --import tsx --test lib/decimo-terceiro/calc.test.ts"
```

- [ ] **Step 11: Rodar `npm run test:decimo-terceiro` e `npm run typecheck`**

Expected: todos passando, sem erros de tipo.

- [ ] **Step 12: Commit**

```bash
git add lib/decimo-terceiro/calc.ts lib/decimo-terceiro/calc.test.ts package.json
git commit -m "feat(13º): lógica pura de cálculo (avos, INSS, IRRF, linha)"
```

---

### Task 3: Listagem + criação da folha

**Files:**
- Create: `app/(app)/rh/decimo-terceiro/page.tsx`
- Create: `app/(app)/rh/decimo-terceiro/actions.ts`
- Create: `app/(app)/rh/decimo-terceiro/_components/criar-folha-button.tsx`
- Modify: nenhum sidebar (o item já existe se `/rh` for o layout atual; caso contrário, adicionar entrada em `components/sidebar.tsx`).

**Interfaces:**
- Consumes: `calcularLinhaDecimoTerceiro` (Task 2); tipos `DecimoTerceiroFolha`, `DecimoTerceiroLinha` (Task 1).
- Produces:
  - Server action `criarFolhaDecimoTerceiro(ano: number): Promise<{ok:true,id:string}|{ok:false,message:string}>`.
  - Rota `/rh/decimo-terceiro` listando folhas por ano com totais agregados.

- [ ] **Step 1: Implementar `criarFolhaDecimoTerceiro` em `actions.ts`**

`"use server"` no topo. Imports do padrão de `rh/ferias/actions.ts` (requireSession, logAuditEvent, createClient, revalidatePath, zod).

Fluxo:
1. `requireSession()`; `assertRh(session.activeRole)`.
2. Validar `ano` (zod: `z.number().int().min(2020).max(2100)`).
3. Verificar que não existe folha pro ano (unique constraint cobre no banco; validar antes pra retornar erro amigável).
4. Buscar colaboradores elegíveis (SQL único):
   ```sql
   select c.id, c.nome, c.cpf, c.tipo_contratacao, c.funcao, c.data_admissao,
          cs.valor as salario,
          (select empresa_id from colaboradores_alocacoes a
             where a.colaborador_id = c.id and a.data_fim is null
             order by a.created_at limit 1) as empresa_id
     from colaboradores c
     join colaboradores_salarios cs
       on cs.colaborador_id = c.id and cs.data_fim is null
    where c.tenant_id = $1
      and c.tipo_contratacao in ('clt','clt_recibo','pj','mei')
      and c.data_admissao <= $2
      and (c.data_encerramento is null or c.data_encerramento >= $3);
   ```
   Parâmetros: tenant, `{ano}-12-31`, `{ano}-01-01`.
5. Em transação (RPC ou `.rpc` com function SQL ou duas inserts dentro de uma única request — usar service client não é necessário, basta createClient autenticado; a RLS deixa passar RH/admin):
   - Insert em `decimo_terceiro_folhas` → captura `id`.
   - Pra cada colaborador: `calcularLinhaDecimoTerceiro(...)` → insert em `decimo_terceiro_linhas` com snapshot + calculados + `obs` automática quando `avos=0` ("Admitido após 15/12 — sem direito a avos").
6. `logAuditEvent({ acao_tentada: "decimo_terceiro.folha.criada", recurso_id: folhaId, meta: { ano, total_linhas } })`.
7. `revalidatePath("/rh/decimo-terceiro")`.
8. Retornar `{ ok: true, id: folhaId }`.

Erro: se `ano` já existir, retornar `{ ok: false, message: "Já existe folha de 13º para {ano}." }`.

- [ ] **Step 2: Implementar `page.tsx` (listagem)**

Server component. Fluxo:

1. `requireSession()`; `assertRh`.
2. Em paralelo (`Promise.all`):
   - Query `decimo_terceiro_folhas` do tenant ordenado por `ano desc`.
   - Query agregada por folha: `select folha_id, count(*) as total_linhas, sum(total_liquido) as total_liquido, sum(primeira_parcela) as total_1a, sum(segunda_parcela) as total_2a from decimo_terceiro_linhas where tenant_id=$1 group by folha_id`.
3. Renderizar:
   - `PageHeader` com título "13º Salário" e, no `actions` slot, `<CriarFolhaButton anoProximo={maiorAno + 1 || anoCorrente} />`.
   - Lista (grid de cards ou tabela) com: ano, status (badge), nº de colaboradores, total 1ª parc, total 2ª parc, total líquido, criada em / por. Linha inteira clicável (memory `feedback_ui_linha_clicavel`) linkando pra `/rh/decimo-terceiro/{ano}` com `prefetch={false}` (regra PERFORMANCE).
   - Empty state: "Nenhuma folha de 13º criada ainda. Comece criando a folha de {ano}."

- [ ] **Step 3: Implementar `_components/criar-folha-button.tsx`**

Client component. Dialog shadcn pedindo o ano (default `anoProximo`). Chama `criarFolhaDecimoTerceiro(ano)`. Em sucesso, roteia pra `/rh/decimo-terceiro/{ano}`. Em erro, exibe toast com `message` (sonner, padrão do projeto).

- [ ] **Step 4: Verificação manual contra o Review Focus**

Via SQL direto (sem precisar levantar a página):

```sql
-- (1) elegibilidade: colaborador em `estagio` ou `socio` NÃO entra
select count(*) from colaboradores where tenant_id = '...' and tipo_contratacao in ('estagio','socio');
-- após criar folha de teste, conferir que linhas NÃO contêm esses colaboradores:
select count(*) from decimo_terceiro_linhas l
  join colaboradores c on c.id = l.colaborador_id
 where l.folha_id = '...' and c.tipo_contratacao in ('estagio','socio');
-- esperado: 0
```

```sql
-- (5) tentar criar folha duplicada: deve bloquear
-- Chamar criarFolhaDecimoTerceiro(2026) duas vezes; a 2ª retorna ok:false
```

- [ ] **Step 5: Rodar `npm run typecheck` e `npm run lint`**

Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/rh/decimo-terceiro/
git commit -m "feat(13º): listagem de folhas e criação por ano com snapshot"
```

---

### Task 4: Detalhe da folha + edição linha a linha + recálculo

**Files:**
- Create: `app/(app)/rh/decimo-terceiro/[ano]/page.tsx`
- Create: `app/(app)/rh/decimo-terceiro/[ano]/tabela-linhas.tsx` (client component)
- Create: `app/(app)/rh/decimo-terceiro/[ano]/dialog-editar-linha.tsx` (client component)
- Modify: `app/(app)/rh/decimo-terceiro/actions.ts` (adicionar `editarLinhaDecimoTerceiro` e `recalcularFolhaDecimoTerceiro`)

**Interfaces:**
- Consumes: `calcularLinhaDecimoTerceiro` (Task 2), action `criarFolhaDecimoTerceiro` (Task 3).
- Produces:
  - `editarLinhaDecimoTerceiro(linhaId: string, input: { salarioEditado: number|null; avosEditado: number|null; obs: string|null }): Promise<ActionResult>`.
  - `recalcularFolhaDecimoTerceiro(folhaId: string): Promise<ActionResult & { total_recalculadas?: number }>`.

- [ ] **Step 1: Implementar `editarLinhaDecimoTerceiro`**

Em `actions.ts`:
1. Validar zod (salarioEditado nullable number >=0, avosEditado nullable int 0..12, obs nullable string).
2. Carregar a linha (filtrar por tenant); erro se não achar.
3. Rodar `calcularLinhaDecimoTerceiro` com os overrides (passando `tipo_contratacao`, `salario = snapshot_salario`, `salarioEditado`, `avosEditado`, `data_admissao = snapshot_data_admissao`, `ano = folha.ano`, `totalAdiantado = linha.total_adiantado`).
4. Update na linha: todos os campos calculados + `editado_manualmente = (salarioEditado !== null || avosEditado !== null)`, `salario_editado`, `avos_editado`, `obs`, `updated_by`.
5. Audit `decimo_terceiro.linha.editada`.
6. `revalidatePath` da página de detalhe.

- [ ] **Step 2: Implementar `recalcularFolhaDecimoTerceiro`**

1. Carregar folha + todas as linhas da folha (tenant check).
2. Pra cada linha onde `editado_manualmente = false`:
   - Rebuscar `colaboradores_salarios.valor` vigente do colaborador. Se mudou, atualizar `snapshot_salario`.
   - Rebuscar `data_admissao` do cadastro. Atualizar `snapshot_data_admissao`.
   - Rodar `calcularLinhaDecimoTerceiro` sem overrides.
   - Update dos campos calculados + snapshot atualizado.
3. Atualizar `decimo_terceiro_folhas.recalculada_em`/`recalculada_por`.
4. Audit `decimo_terceiro.folha.recalculada` com `total_recalculadas`.
5. Revalidate.

Teste manual pro Review Focus #4: alterar `colaboradores_salarios.valor`, chamar recalcular, confirmar que a linha com `editado_manualmente=true` NÃO muda e a `editado_manualmente=false` muda.

- [ ] **Step 3: Implementar `page.tsx` da rota `[ano]`**

Server component. `params: { ano: string }`. Fluxo:
1. `requireSession`; `assertRh`.
2. `Promise.all`:
   - Folha por `(tenant_id, ano)`. Se não existir, `notFound()`.
   - Linhas da folha com embed do colaborador: `.select("*, colaborador:colaboradores!colaborador_id(nome, funcao, tipo_contratacao), empresa:empresas!snapshot_empresa_id(nome_curto)")`. Embed hint `!fk` obrigatório (regra do FLUXO-BANCO §FK dupla).
   - KPIs agregados: count, sum(primeira_parcela), sum(segunda_parcela), sum(total_liquido).
3. Renderizar:
   - `PageHeader` com título "13º {ano}", badge de status, botão "Recalcular folha" (form com action server), botão "Exportar planilha" (Task 5).
   - 4 KPI cards no padrão `/financeiro` (memory `feedback_kpi_cards_ricos`): "Colaboradores", "Total 1ª parcela", "Total 2ª parcela", "Total líquido".
   - `<TabelaLinhas linhas={linhas} />`.

- [ ] **Step 4: Implementar `tabela-linhas.tsx`**

Client. Tabela com colunas: nome, empresa, tipo contratação, admissão (dd/mm/aaaa), salário, avos, 1ª parc, 2ª parc, INSS, IRRF, total líquido, obs, flag "editado" (ícone discreto quando `editado_manualmente`). Linha clicável abre o dialog de edição com os dados da linha. Formatação monetária pt-BR (`toLocaleString("pt-BR", { style:"currency", currency:"BRL" })`).

- [ ] **Step 5: Implementar `dialog-editar-linha.tsx`**

Client. shadcn Dialog (não Drawer — a edição é curta). Form com react-hook-form + zod:
- `salario_editado` numeric (opcional)
- `avos_editado` select 0..12 (opcional)
- `obs` textarea (opcional)

Botão "Restaurar snapshot" limpa `salario_editado` e `avos_editado` (manda null → `editado_manualmente` fica false no recálculo).

Submit chama `editarLinhaDecimoTerceiro(linhaId, { ... })`. Em sucesso, fecha dialog e `router.refresh()`.

- [ ] **Step 6: Rodar typecheck + lint**

```bash
npm run typecheck && npm run lint
```

Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/rh/decimo-terceiro/
git commit -m "feat(13º): detalhe da folha, edição linha a linha e recálculo"
```

---

### Task 5: Exportação XLSX

**Files:**
- Create: `lib/decimo-terceiro/export-xlsx.ts`
- Modify: `app/(app)/rh/decimo-terceiro/actions.ts` (adicionar `exportarFolhaDecimoTerceiroXlsx`)
- Modify: `app/(app)/rh/decimo-terceiro/[ano]/page.tsx` (ligar o botão "Exportar planilha")

**Interfaces:**
- Produces:
  - `gerarXlsxFolhaDecimoTerceiro(folha: DecimoTerceiroFolha, linhas: (DecimoTerceiroLinha & { snapshot_empresa_nome: string | null })[]): Promise<Buffer>`.
  - Server action `exportarFolhaDecimoTerceiroXlsx(folhaId: string): Promise<{ok:true, filename:string, base64:string} | {ok:false, message:string}>`.

- [ ] **Step 1: Implementar `gerarXlsxFolhaDecimoTerceiro`**

Em `lib/decimo-terceiro/export-xlsx.ts`. ExcelJS. Duas abas:

**Aba "CLT"** — só linhas com `snapshot_tipo_contratacao in ('clt','clt_recibo')`. Colunas na mesma ordem da planilha original: `#`, `Nome Completo`, `Empresa`, `Tipo de Contratação`, `Data de Início`, `Salário`, `Meses`, `Total Adiantado`, `1ª parc 30/11`, `2ª parc 20/12`, `Desconto INSS`, `Desconto IRRF`, `Total à pagar`, `Obs.`.

**Aba "PJ"** — só linhas com `snapshot_tipo_contratacao in ('pj','mei')`. Mesmas colunas, sem INSS/IRRF.

Linha de totais no fim (soma de valor por coluna numérica). Freeze da primeira linha (header). Formato BRL `"R$ "#,##0.00` nas colunas monetárias. Formato data `dd/mm/yyyy`.

- [ ] **Step 2: Implementar a action `exportarFolhaDecimoTerceiroXlsx`**

1. Session + role check.
2. Carregar folha + linhas com nome da empresa (embed).
3. `const buffer = await gerarXlsxFolhaDecimoTerceiro(folha, linhas)`.
4. Audit `decimo_terceiro.folha.exportada`.
5. Retornar `{ ok:true, filename: '13-salario-{ano}.xlsx', base64: buffer.toString('base64') }`.

- [ ] **Step 3: Ligar o botão "Exportar planilha" na página de detalhe**

Client component chamando a action; faz download via blob da base64 retornada:

```ts
const res = await exportarFolhaDecimoTerceiroXlsx(folhaId);
if (res.ok) {
  const blob = new Blob([Uint8Array.from(atob(res.base64), c=>c.charCodeAt(0))], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = res.filename; a.click();
}
```

- [ ] **Step 4: Teste manual**

Criar folha de teste, exportar, abrir no Excel/LibreOffice. Conferir: 2 abas (CLT, PJ), colunas na ordem certa, totais no fim, formato BRL e data.

- [ ] **Step 5: Rodar typecheck + lint**

Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/decimo-terceiro/export-xlsx.ts app/\(app\)/rh/decimo-terceiro/
git commit -m "feat(13º): exportação da folha em XLSX replicando o layout original"
```

---

## Pós-tasks

- Nenhum migration script fora deste plano. A sequência deixa o banco pronto pras Partes 2–6 (adiantamentos, fechamento de parcelas, retroativo, histórico, casos especiais).
- Nenhum push automático: commits ficam locais (memory `feedback_push`).
- Nada em `main` sem passar por review manual conforme o fluxo da California.
