# 52 — Plano de Execução do Subsistema Benefícios (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` para implementar o plano sessão por sessão. Checkpoints usam checkbox (`- [ ]`).

**Goal:** Colocar a Fase 1 do subsistema de Benefícios no ar: catálogo + dependentes + vínculos colaborador↔benefício + visualização do custo mensal calculado por colaborador, sem fechamento mensal e sem integração com folha.

**Architecture:** Migration única cria 5 tabelas + 3 enums + função de cálculo em `public`. Server actions em `lib/actions/beneficios/` encapsulam escrita + audit. UI em `app/(app)/rh/beneficios/` com tabs "Colaboradores" (default) e "Catálogo". Visão interna RH; vista do colaborador fica para Fase 1.5.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Supabase (Postgres + Auth + RLS), Tailwind, shadcn/ui + Radix, lucide-react, React Hook Form + Zod.

**Spec:**
- [`50-beneficios.md`](50-beneficios.md) — visão + regras de negócio (B1–B16).
- [`51-beneficios-modelo-de-dados.md`](51-beneficios-modelo-de-dados.md) — modelo de dados.

## Global Constraints

Herdadas de `CLAUDE.md` e das specs. Toda sessão respeita implicitamente:

- **Ortografia pt-BR em toda string visível** (acentos, cedilha, til). Identificadores em código podem ficar sem acento por convenção.
- **`docs/FLUXO-BANCO.md`**: nada aplicado sem migration versionada; MCP só para `apply_migration`; conferência pós pelo MCP. Mudança destrutiva exige confirmação explícita; aditiva segue direto.
- **`docs/PERFORMANCE.md`**: `<Link>` em lista de 5+ itens → `prefetch={false}`; queries independentes → `Promise.all`; agregação separada do embed; GRANT explícito para `authenticated` em toda tabela nova; policies usam `(select auth.uid())`.
- **`docs/09-identidade-visual-ui.md`**: cores do bloco não hardcoded; planilha e Totais usam o mesmo `colgroup` com `table-fixed`.
- **`lib/types.ts` é escrito à mão**: toda migration que mexe em coluna usada pela UI atualiza o tipo correspondente no mesmo commit.
- **Audit em evento sensível**: criar vínculo, mudar modo de custeio, encerrar vínculo, criar dependente, incluir/remover dep em plano, editar catálogo → `log_audit_event(...)` com ação no padrão `beneficio.<entidade>.<verbo>`.
- **RLS gate**: admin+rh escrevem; colaborador lê o próprio via `is_colaborador_proprio`. Padrão de Férias.
- **Role `colaborador` já existe** (vem de Férias). Nenhum enum de role nova a criar.
- **Nenhuma dependência npm nova** nesta fase. shadcn/ui + Radix + lucide + RHF + Zod já estão no projeto.
- **Sem suite de testes automatizada** no projeto. Verificação é: `tsc` + `pnpm lint` + `pnpm build` + conferência MCP + teste manual no browser com `antonio@pevetech.com.br` + 1 colaborador real.

## Review Focus

Classes de input e falhas que a spec implica, mas que nenhuma sessão garante por padrão. Cada linha tem o teste que a pinamos na sessão dona:

1. **Colaborador sem `data_nascimento`** tentando ganhar vínculo. A spec exige que seja bloqueado pela UI (não trigger). **Pinado em S2 §verificação manual** com um colaborador sintético sem `data_nascimento`.
2. **Dependente com CPF duplicado no tenant** (ex: mesma pessoa cadastrada por dois colaboradores diferentes). Constraint unique no banco. **Pinado em S1 §verificação pós** via `INSERT` que viola.
3. **Vínculo `integral_empresa_com_upgrade` em benefício sem `beneficio_base_id`** (ex.: aplicar upgrade ao Direto). Trigger de validação deve rejeitar. **Pinado em S1 §verificação pós**.
4. **Mudança de competência atravessando aniversário** do titular ou dependente, mudando a faixa etária entre meses. **Pinado em S4 §verificação manual** com um colaborador cuja data de nascimento está a ≤ 60 dias e simulação de competência futura.
5. **Dois vínculos ativos simultâneos** no mesmo (colaborador, benefício) — unique parcial deve rejeitar. **Pinado em S1 §verificação pós**.

---

## 1. Filosofia

- **1 sessão = 1 commit no mínimo, 1 PR no máximo.** Cada sessão termina no `main` ao final do dia.
- **Backend antes de UI.** O banco com policies e função de cálculo dá o chão pra UI confiar. Nenhuma UI é construída sem a camada de dados pronta e verificada via MCP.
- **UI em camadas de valor crescente.** Primeiro o RH vê a lista com KPIs (visibilidade imediata do custo total), depois clica num colaborador e vê o breakdown, depois cadastra dependentes e vincula benefícios, depois gerencia catálogo. Cada camada entrega valor sozinha.
- **Testes manuais com `antonio@pevetech.com.br` + 1 colaborador real** antes de cada merge. Build + typecheck limpos não garantem que o campo chega à tela (CLAUDE.md).
- **Nenhuma sessão termina com dívida de spec.** Mudança de regra descoberta durante a implementação volta pra [`50-beneficios.md`](50-beneficios.md) no mesmo commit.
- **Nenhuma faixa de preço, nenhum vínculo real** é importado nesta fase. O seed carrega só o catálogo (3 benefícios + 19 faixas). Vínculos reais entram manualmente pela UI em S3/S4 (teste exploratório) ou numa migration de import posterior, fora deste plano.

## 2. Visão macro: 5 sessões

```
S1 ─ Banco: migration de fundação (enums + 5 tabelas + função + policies + seed)
      ↓
S2 ─ UI: hub card + rota /rh/beneficios + KPIs (visão agregada)
      ↓
S3 ─ UI: Tab Colaboradores (tabela + filtros + linha clicável)
      ↓
S4 ─ UI: Drawer do colaborador (vínculos + dependentes + breakdown da função)
      ↓
S5 ─ UI: Tab Catálogo (CRUD dos benefícios + faixas de preço)
```

Estimativa total: **5 sessões** de 3-5h cada. Dependências lineares de S1→S4; S5 pode rodar em paralelo com S3/S4 (tab independente) se o dia render.

## 3. Mapa de arquivos

Antes das tasks, trava o mapa. Mudanças aqui exigem revisão do plano.

### Banco (S1)
- **Criar**: `supabase/migrations/20261006000001_beneficios_fundacao.sql`

### Tipos (S1)
- **Modificar**: `lib/types.ts` — adicionar os 7 tipos descritos em [`51-beneficios-modelo-de-dados.md`](51-beneficios-modelo-de-dados.md) §13.

### Server actions e queries (S2–S5)
- **Criar**: `lib/actions/beneficios/index.ts` — barrel.
- **Criar**: `lib/actions/beneficios/catalogo.ts` — `criarBeneficio`, `editarBeneficio`, `desativarBeneficio`, `criarFaixa`, `editarFaixa`, `removerFaixa`.
- **Criar**: `lib/actions/beneficios/vinculos.ts` — `criarVinculo`, `encerrarVinculo`, `mudarModoCusteio`.
- **Criar**: `lib/actions/beneficios/dependentes.ts` — `criarDependente`, `editarDependente`, `desativarDependente`, `incluirDepEmPlano`, `removerDepDePlano`.
- **Criar**: `lib/queries/beneficios.ts` — leituras tipadas: `listarBeneficios`, `listarVinculosDoColaborador`, `listarDependentesDoColaborador`, `custoMensalDoColaborador(ano, mes, id)`, `kpisTenant(ano, mes)`, `listarColaboradoresComBeneficios(filtros)`.

### UI (S2–S5)
- **Modificar**: `app/(app)/rh/page.tsx` — adicionar card "Benefícios" após o card "Férias".
- **Criar**: `app/(app)/rh/beneficios/page.tsx` — Server Component com PageHeader + KPIs + Tabs.
- **Criar**: `app/(app)/rh/beneficios/_components/kpis-benefcios.tsx` — 4 KPI cards.
- **Criar**: `app/(app)/rh/beneficios/_components/tabela-colaboradores.tsx` — Client Component com busca + filtro + linha clicável.
- **Criar**: `app/(app)/rh/beneficios/_components/drawer-colaborador.tsx` — drawer com tabs internas (Vínculos / Dependentes / Breakdown).
- **Criar**: `app/(app)/rh/beneficios/_components/form-vinculo.tsx` — RHF + Zod para criar/editar vínculo.
- **Criar**: `app/(app)/rh/beneficios/_components/form-dependente.tsx` — RHF + Zod para dependente.
- **Criar**: `app/(app)/rh/beneficios/_components/tab-catalogo.tsx` — lista dos 3 benefícios + edição.
- **Criar**: `app/(app)/rh/beneficios/_components/form-faixa.tsx` — editar faixa de preço (dentro da gaveta do benefício).
- **Criar**: `app/(app)/rh/beneficios/_components/seletor-competencia.tsx` — select de ano/mês no header.

### Permissões (S2)
- **Modificar**: `middleware.ts` ou helper equivalente — se houver gate centralizado de rota, adicionar `/rh/beneficios` ao conjunto de rotas de admin+rh. Em Férias isso já foi feito; conferir o pattern vigente antes.

---

## 4. Sessão a sessão

### S1 — Migration de fundação (banco)

**Objetivo**: colocar enums + 5 tabelas + policies + função de cálculo + seed do catálogo no ar. Depois dessa sessão, qualquer UI pode ler/escrever.

**Entregáveis**:

- [ ] **Step 1.1 — Criar arquivo de migration vazio com cabeçalho**

Criar `supabase/migrations/20261006000001_beneficios_fundacao.sql` com cabeçalho explicando racional:

```sql
-- Migration: Benefícios — Fundação (Fase 1)
-- Spec: docs/modulos/rh/50-beneficios.md
-- Modelo: docs/modulos/rh/51-beneficios-modelo-de-dados.md
--
-- Esta migration cria o subsistema de Benefícios na Fase 1:
-- 3 enums + 5 tabelas + 2 funções + policies RLS + seed do catálogo.
-- Fase 1 cobre: catálogo, dependentes, vínculos, visualização.
-- Fora: fechamento mensal (Fase 2), integração com folha (Fase 3).

begin;
-- ... (passos abaixo)
commit;
```

- [ ] **Step 1.2 — Enums**

Copiar o bloco da §1 de [`51-beneficios-modelo-de-dados.md`](51-beneficios-modelo-de-dados.md) para dentro do `begin;...commit;` da migration:

```sql
create type public.beneficio_tipo as enum ('saude', 'dental');
create type public.beneficio_modelo_preco as enum ('faixa_etaria', 'flat');
create type public.beneficio_modo_custeio as enum (
  'rateado',
  'integral_empresa',
  'integral_empresa_com_upgrade'
);
```

- [ ] **Step 1.3 — Tabela `beneficios` + índices + comments + trigger `updated_at`**

Copiar DDL completa de §2.1 e §2.2 de [`51-beneficios-modelo-de-dados.md`](51-beneficios-modelo-de-dados.md) para a migration.

- [ ] **Step 1.4 — Tabela `beneficio_faixas_preco` + índice + trigger**

Copiar DDL completa de §3.1 e §3.2.

- [ ] **Step 1.5 — Tabela `dependentes` + índices + trigger**

Copiar DDL completa de §4.1 e §4.2.

- [ ] **Step 1.6 — Tabela `colaborador_beneficio` + índices + trigger + função+trigger de validação upgrade**

Copiar DDL completa de §5.1, §5.2 e §5.3. A função `fn_valida_upgrade_requer_base` fica inline antes do trigger.

- [ ] **Step 1.7 — Tabela `colaborador_beneficio_dependente` + índices**

Copiar DDL completa de §6.1.

- [ ] **Step 1.8 — Função `fn_beneficios_custo_mensal` + grant**

Copiar bloco completo de §7.1, incluindo `grant execute ... to authenticated` e `comment on function`.

- [ ] **Step 1.9 — Função `fn_beneficios_custo_mensal_tenant` + grant**

Copiar bloco completo de §7.2.

- [ ] **Step 1.10 — Habilitar RLS + GRANTs**

Copiar o preâmbulo de §8 (`alter table ... enable row level security` para as 5 tabelas, e `grant select,insert,update,delete on ... to authenticated` para cada; nada para `anon`).

- [ ] **Step 1.11 — Policies de `beneficios` (4)**

Copiar bloco completo de §8.1.

- [ ] **Step 1.12 — Policies de `beneficio_faixas_preco` (4)**

Copiar bloco completo de §8.2.

- [ ] **Step 1.13 — Policies de `dependentes` (4)**

Copiar bloco completo de §8.3.

- [ ] **Step 1.14 — Policies de `colaborador_beneficio` (4)**

Copiar bloco completo de §8.4.

- [ ] **Step 1.15 — Policies de `colaborador_beneficio_dependente` (4)**

Copiar bloco completo de §8.5.

- [ ] **Step 1.16 — Seed do catálogo (3 benefícios + 19 faixas)**

Copiar bloco completo de §9.1 (DO block com `v_direto_id`, `v_especial_id` e os INSERTs do catálogo + faixas).

- [ ] **Step 1.17 — Aplicar migration via MCP**

Executar `mcp__supabase__apply_migration` com o nome `beneficios_fundacao` e o conteúdo do arquivo.

Expected: sem erro. Se der erro de sintaxe em algum CTE da função, revisar.

- [ ] **Step 1.18 — Verificação pós #1: contagem**

Executar via `mcp__supabase__execute_sql`:

```sql
select 'enums' as item, count(*) as qtd from pg_type
  where typname in ('beneficio_tipo','beneficio_modelo_preco','beneficio_modo_custeio')
union all
select 'tabelas', count(*) from information_schema.tables
  where table_schema='public'
    and table_name in ('beneficios','beneficio_faixas_preco','dependentes',
                       'colaborador_beneficio','colaborador_beneficio_dependente')
union all
select 'beneficios seed', count(*) from public.beneficios
union all
select 'faixas seed', count(*) from public.beneficio_faixas_preco
union all
select 'policies', count(*) from pg_policy
  where polrelid in (
    'public.beneficios'::regclass, 'public.beneficio_faixas_preco'::regclass,
    'public.dependentes'::regclass, 'public.colaborador_beneficio'::regclass,
    'public.colaborador_beneficio_dependente'::regclass
  );
```

Expected:
- `enums` = 3
- `tabelas` = 5
- `beneficios seed` = 3
- `faixas seed` = 19
- `policies` = 20 (5 tabelas × 4 cmds)

- [ ] **Step 1.19 — Verificação pós #2: RLS + GRANTs**

```sql
select tablename, rowsecurity from pg_tables
  where schemaname='public'
    and tablename in ('beneficios','beneficio_faixas_preco','dependentes',
                      'colaborador_beneficio','colaborador_beneficio_dependente');

-- Nenhum GRANT para anon:
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema='public'
   and table_name in ('beneficios','beneficio_faixas_preco','dependentes',
                      'colaborador_beneficio','colaborador_beneficio_dependente')
   and grantee='anon';
```

Expected: `rowsecurity = true` em todas; segunda query retorna 0 linhas.

- [ ] **Step 1.20 — Verificação pós #3: funções**

```sql
select proname, pronargs from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('fn_beneficios_custo_mensal','fn_beneficios_custo_mensal_tenant',
                   'fn_valida_upgrade_requer_base');

-- Teste da função custo mensal com colaborador qualquer, sem vínculo:
select * from public.fn_beneficios_custo_mensal(2026, 11, (select id from public.colaboradores limit 1));
```

Expected: 3 funções listadas; chamada retorna 0 linhas (sem vínculo, sem erro).

- [ ] **Step 1.21 — Verificação pós #4: Review Focus pinados**

```sql
-- Teste #2 (Review Focus): CPF duplicado de dependente deve falhar
-- (preparar um tenant_id e um colaborador_id válidos antes de rodar)
do $$
declare
  v_tenant uuid;
  v_colab uuid;
begin
  select id into v_tenant from public.tenants where nome='Agência California';
  select id into v_colab from public.colaboradores where tenant_id = v_tenant limit 1;
  insert into public.dependentes(tenant_id, colaborador_id, nome, cpf, data_nascimento, parentesco)
    values (v_tenant, v_colab, 'Teste 1', '12345678900', '1990-01-01', 'filho');
  begin
    insert into public.dependentes(tenant_id, colaborador_id, nome, cpf, data_nascimento, parentesco)
      values (v_tenant, v_colab, 'Teste 2', '12345678900', '1990-01-01', 'filho');
    raise exception 'Review Focus #2 FALHOU: aceitou CPF duplicado';
  exception when unique_violation then
    raise notice 'Review Focus #2 OK: CPF duplicado foi rejeitado';
  end;
  -- limpa
  delete from public.dependentes where cpf='12345678900';
end $$;

-- Teste #3 (Review Focus): modo integral_empresa_com_upgrade em benefício sem base
do $$
declare
  v_tenant uuid;
  v_colab uuid;
  v_direto uuid;
begin
  select id into v_tenant from public.tenants where nome='Agência California';
  select id into v_colab from public.colaboradores where tenant_id = v_tenant limit 1;
  select id into v_direto from public.beneficios where nome='SulAmerica Direto Nacional';
  begin
    insert into public.colaborador_beneficio(tenant_id, colaborador_id, beneficio_id, modo_custeio, data_inicio)
      values (v_tenant, v_colab, v_direto, 'integral_empresa_com_upgrade', current_date);
    raise exception 'Review Focus #3 FALHOU: aceitou upgrade em benefício sem base';
  exception when others then
    if sqlerrm like '%beneficio_base_id%' then
      raise notice 'Review Focus #3 OK: upgrade sem base foi rejeitado';
    else
      raise exception 'Review Focus #3 ERRO INESPERADO: %', sqlerrm;
    end if;
  end;
end $$;

-- Teste #5 (Review Focus): dois vínculos ativos no mesmo (colab, beneficio)
do $$
declare
  v_tenant uuid;
  v_colab uuid;
  v_dental uuid;
begin
  select id into v_tenant from public.tenants where nome='Agência California';
  select id into v_colab from public.colaboradores where tenant_id = v_tenant limit 1;
  select id into v_dental from public.beneficios where nome='Bradesco Dental';
  insert into public.colaborador_beneficio(tenant_id, colaborador_id, beneficio_id, modo_custeio, data_inicio)
    values (v_tenant, v_colab, v_dental, 'rateado', current_date);
  begin
    insert into public.colaborador_beneficio(tenant_id, colaborador_id, beneficio_id, modo_custeio, data_inicio)
      values (v_tenant, v_colab, v_dental, 'rateado', current_date);
    raise exception 'Review Focus #5 FALHOU: aceitou vínculo ativo duplicado';
  exception when unique_violation then
    raise notice 'Review Focus #5 OK: vínculo ativo duplicado foi rejeitado';
  end;
  -- limpa
  delete from public.colaborador_beneficio
    where colaborador_id = v_colab and beneficio_id = v_dental;
end $$;
```

Expected: três `raise notice` com "OK" nos logs.

- [ ] **Step 1.22 — Atualizar `lib/types.ts`**

Adicionar os 7 tipos listados em [`51-beneficios-modelo-de-dados.md`](51-beneficios-modelo-de-dados.md) §13 ao final do arquivo (bloco "Benefícios — Fase 1" com comentário de origem). Preservar formatação existente.

- [ ] **Step 1.23 — Build + typecheck**

```bash
pnpm tsc --noEmit
pnpm lint
```

Expected: zero erros. Warning pré-existente em `components/ui/multi-select.tsx` permanece (não é desta sessão).

- [ ] **Step 1.24 — Commit**

```bash
git add supabase/migrations/20261006000001_beneficios_fundacao.sql lib/types.ts
git commit -m "feat(rh/beneficios): migration de fundação da Fase 1 (catálogo + vínculos + dependentes + função de cálculo)"
```

**Pronto quando**:
- MCP confirma 3 enums + 5 tabelas + 20 policies + 2 funções.
- Seed do catálogo tem 3 linhas (SulAmerica Direto, SulAmerica Especial, Bradesco Dental) e 19 faixas de preço.
- Review Focus #2, #3, #5 pinados com `raise notice` OK no log.
- `tsc` e `lint` limpos.
- Advisors do Supabase sem alertas vermelhos.

**Riscos**:
- A função `fn_beneficios_custo_mensal` tem CTEs encadeadas; se der erro de tipo no `extract(year from age(...))`, inspecionar e colocar cast explícito.
- Seed depende do nome exato `'Agência California'` em `tenants.nome` — já confirmado por MCP em 2026-10-05, mas se mudou, atualizar o filtro.

**Fora do escopo**: UI, server actions, página de catálogo.

---

### S2 — Hub card + rota `/rh/beneficios` + KPIs

**Objetivo**: colocar o card "Benefícios" no hub `/rh`, criar a rota `/rh/beneficios` acessível a admin+rh, com PageHeader completo + seletor de competência + 4 KPIs. Nenhuma tabela ainda — só a casca.

**Entregáveis**:

- [ ] **Step 2.1 — Criar `lib/queries/beneficios.ts` com `kpisTenant`**

```ts
import { createServerClient } from '@/lib/supabase/server'

export type KpisTenant = {
  qtde_vinculos_saude: number
  qtde_vinculos_dental: number
  custo_total_empresa: number
  custo_total_colaboradores: number
}

export async function kpisTenant(ano: number, mes: number): Promise<KpisTenant> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('fn_beneficios_custo_mensal_tenant', {
    p_tenant_id: null,  // o helper RLS resolve pelo profile do usuário
    p_ano: ano,
    p_mes: mes,
  }).single()
  if (error) throw error
  return (data as KpisTenant) ?? {
    qtde_vinculos_saude: 0,
    qtde_vinculos_dental: 0,
    custo_total_empresa: 0,
    custo_total_colaboradores: 0,
  }
}
```

> **Nota de ajuste**: `p_tenant_id` precisa chegar na RPC. Como `authenticated` pode pertencer a vários tenants em teoria (não hoje, mas o modelo permite), o padrão do projeto é passar o `tenant_id` ativo via helper existente. Inspecionar como `/rh/ferias` resolve isso antes de implementar (procurar `getActiveTenantId` ou similar em `lib/supabase/server.ts`). Se o helper existir, usar; se não, resolver via query `tenant_members` do próprio Supabase client com `limit 1`.

- [ ] **Step 2.2 — Modificar `app/(app)/rh/page.tsx` para adicionar card "Benefícios"**

Localizar o card "Férias" (padrão identificado em [docs/modulos/rh/README.md](README.md)). Clonar e adaptar: ícone `HeartHandshake` ou `ShieldPlus` do lucide-react, título "Benefícios", descrição curta "Planos de saúde, dental e dependentes dos colaboradores", href `/rh/beneficios`, badge com contagem de vínculos ativos.

Para o badge: `SELECT count(*) FROM colaborador_beneficio WHERE data_fim IS NULL`. Fazer essa query junto com as outras do hub via `Promise.all` (constraint do CLAUDE.md).

- [ ] **Step 2.3 — Criar `app/(app)/rh/beneficios/page.tsx` (Server Component)**

```tsx
import { PageHeader } from '@/components/page-header'
import { kpisTenant } from '@/lib/queries/beneficios'
import { KpisBeneficios } from './_components/kpis-beneficios'
import { SeletorCompetencia } from './_components/seletor-competencia'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<{ ano?: string; mes?: string; tab?: string }>
}

export default async function BeneficiosPage({ searchParams }: Props) {
  const sp = await searchParams
  const hoje = new Date()
  const ano = parseInt(sp.ano ?? String(hoje.getFullYear()), 10)
  const mes = parseInt(sp.mes ?? String(hoje.getMonth() + 1), 10)
  const tab = sp.tab ?? 'colaboradores'

  const kpis = await kpisTenant(ano, mes)

  return (
    <>
      <PageHeader
        title="Benefícios"
        description="Planos de saúde, dental e dependentes dos colaboradores."
        actions={<SeletorCompetencia ano={ano} mes={mes} />}
      />
      <KpisBeneficios kpis={kpis} />
      <Tabs defaultValue={tab} className="mt-6">
        <TabsList>
          <TabsTrigger value="colaboradores">Colaboradores</TabsTrigger>
          <TabsTrigger value="catalogo">Catálogo</TabsTrigger>
        </TabsList>
        <TabsContent value="colaboradores">
          {/* S3 preenche */}
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Em breve (S3): tabela de colaboradores com planos ativos.
          </div>
        </TabsContent>
        <TabsContent value="catalogo">
          {/* S5 preenche */}
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Em breve (S5): catálogo editável de benefícios e faixas de preço.
          </div>
        </TabsContent>
      </Tabs>
    </>
  )
}
```

- [ ] **Step 2.4 — Criar `kpis-beneficios.tsx`**

Padrão de 4 KPI cards ricos (ícone + label + valor + delta se aplicável + shadow-soft), seguindo a feedback memory [KPI cards ricos](~/.claude/projects/c--Projects-califa-erp/memory/feedback_kpi_cards_ricos.md). Ícones sugeridos: `HeartPulse` (saúde), `Smile` (dental), `Building2` (custo empresa), `UserRound` (custo colaboradores). Valores formatados em pt-BR (R$ + `toLocaleString('pt-BR', { minimumFractionDigits: 2 })`).

- [ ] **Step 2.5 — Criar `seletor-competencia.tsx` (Client Component)**

Select de ano (atual, atual-1, atual-2) + select de mês (jan a dez em pt-BR, abreviados). Mudança atualiza searchParams via `router.push({ query: { ano, mes } })`.

- [ ] **Step 2.6 — Confirmar permissão da rota**

Procurar o helper de permissão de rota do projeto (ex.: `requireRole`, `requireRh`, ou middleware em `middleware.ts`). Em `/rh/ferias/page.tsx` já há exemplo — replicar. Se não houver gate central, a página verifica role no server component.

```tsx
import { requireActiveRole } from '@/lib/auth' // nome real a conferir
await requireActiveRole(['administrador', 'rh'])
```

- [ ] **Step 2.7 — Testar manual no browser com `antonio@pevetech.com.br`**

Navegar para `/rh` → card "Benefícios" aparece após "Férias". Clicar → chega em `/rh/beneficios`. KPIs mostram 0 em todos (nenhum vínculo cadastrado ainda). Seletor de competência muda ano/mês nos searchParams. Troca de tab funciona (abas vazias com placeholder).

**Review Focus #1 pinado**: tentar acessar `/rh/beneficios` como colaborador comum → redireciona (ou 404). Testar.

- [ ] **Step 2.8 — Build + lint + commit**

```bash
pnpm lint
pnpm tsc --noEmit
pnpm build  # importante — Server Component pega erros que tsc não vê
```

Expected: zero erros.

```bash
git add app/\(app\)/rh/page.tsx app/\(app\)/rh/beneficios/ lib/queries/beneficios.ts
git commit -m "feat(rh/beneficios): hub card + rota /rh/beneficios + KPIs agregados"
```

**Pronto quando**:
- `/rh` mostra o card "Benefícios" imediatamente após "Férias", com badge de vínculos ativos (0 no MVP).
- `/rh/beneficios` renderiza PageHeader + seletor de competência + 4 KPIs + 2 tabs (vazias).
- Rota bloqueada para quem não é admin+rh.
- Build limpo.

**Riscos**:
- Nome do helper de permissão pode variar — se não existir pattern claro, consultar `app/(app)/rh/ferias/page.tsx` como referência. **Não inventar** novo gate.
- Função `fn_beneficios_custo_mensal_tenant` precisa receber `p_tenant_id` — a resolução via RLS no RPC exige confirmação de como o projeto faz isso em outros RPCs. Se der erro de "null violates not null", passar `p_tenant_id` explicitamente lendo via helper.

**Fora do escopo**: Tabela de colaboradores (S3), drawer (S4), catálogo (S5).

---

### S3 — Tab Colaboradores (tabela + filtros + linha clicável)

**Objetivo**: dentro da tab "Colaboradores", listar todos os colaboradores ativos do tenant com seus planos ativos e custo mensal da competência. Busca por nome, filtro por benefício, filtro por modo de custeio. Linha clicável abre drawer (vazio nesta sessão; preenchido em S4).

**Entregáveis**:

- [ ] **Step 3.1 — Adicionar `listarColaboradoresComBeneficios` em `lib/queries/beneficios.ts`**

```ts
export type LinhaColaboradorBeneficios = {
  colaborador_id: string
  nome: string
  tipo_contratacao: string
  planos_ativos: Array<{ beneficio_id: string; nome: string; tipo: 'saude' | 'dental' }>
  custo_empresa: number
  custo_colaborador: number
}

export async function listarColaboradoresComBeneficios(args: {
  ano: number
  mes: number
  busca?: string
  beneficioId?: string
  modoCusteio?: 'rateado' | 'integral_empresa' | 'integral_empresa_com_upgrade'
}): Promise<LinhaColaboradorBeneficios[]> {
  // ...
}
```

Implementação: SELECT em `colaboradores` (status='ativo') com LATERAL JOIN em `fn_beneficios_custo_mensal(ano, mes, colaborador_id)` agregando as linhas. Filtros aplicados em WHERE. Query via `supabase.rpc` em função custom OU via SQL puro embutido no server component.

**Opção recomendada**: criar função SQL `fn_beneficios_listar_colaboradores(p_ano, p_mes, p_busca text, p_beneficio_id uuid, p_modo text)` numa segunda migration menor desta sessão (`20261006000002_beneficios_listar_colaboradores.sql`). Mantém a lógica no banco (RLS aplica), evita montar JSON agregado no client.

Alternativamente, usar a `fn_beneficios_custo_mensal_tenant` modificada para retornar linhas por colaborador. Decidir no início da sessão.

- [ ] **Step 3.2 — Criar função `fn_beneficios_listar_colaboradores` (migration 20261006000002)**

```sql
create or replace function public.fn_beneficios_listar_colaboradores(
  p_ano int,
  p_mes int,
  p_busca text default null,
  p_beneficio_id uuid default null,
  p_modo public.beneficio_modo_custeio default null
)
returns table (
  colaborador_id uuid,
  nome text,
  tipo_contratacao text,
  planos_ativos jsonb,
  custo_empresa numeric,
  custo_colaborador numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with linhas as (
    select c.id as colab_id,
           c.nome,
           c.tipo_contratacao::text as tc,
           f.*
      from public.colaboradores c
      cross join lateral public.fn_beneficios_custo_mensal(p_ano, p_mes, c.id) f
     where c.status = 'ativo'
       and (p_busca is null or c.nome ilike '%'||p_busca||'%')
       and (p_beneficio_id is null or f.beneficio_id = p_beneficio_id)
       and (p_modo is null or f.modo_custeio = p_modo)
  )
  select colab_id,
         max(nome),
         max(tc),
         coalesce(jsonb_agg(jsonb_build_object(
           'beneficio_id', beneficio_id,
           'nome', beneficio_nome,
           'tipo', beneficio_tipo
         )) filter (where beneficio_id is not null), '[]'::jsonb),
         coalesce(sum(valor_empresa_titular), 0),
         coalesce(sum(valor_desconto_folha_total), 0)
    from linhas
   group by colab_id
   order by max(nome);
$$;

grant execute on function public.fn_beneficios_listar_colaboradores(int, int, text, uuid, public.beneficio_modo_custeio)
  to authenticated;
```

Aplicar via `apply_migration`. Verificar via MCP: `SELECT * FROM fn_beneficios_listar_colaboradores(2026, 11, null, null, null) LIMIT 5` retorna 5 colaboradores com `planos_ativos = '[]'::jsonb` (nenhum vínculo ainda).

- [ ] **Step 3.3 — Implementar `listarColaboradoresComBeneficios` chamando a RPC**

Via `supabase.rpc('fn_beneficios_listar_colaboradores', { ... })`.

- [ ] **Step 3.4 — Criar `tabela-colaboradores.tsx` (Client Component)**

Props: `linhas: LinhaColaboradorBeneficios[]`, `ano: number`, `mes: number`.

Componente:
- Barra de filtros no topo: `<Input placeholder="Buscar por nome">`, `<Select>` com os 3 benefícios do catálogo, `<Select>` com os 3 modos de custeio.
- Mudança de filtro atualiza searchParams via router.
- Tabela: colunas Nome, Tipo contratação, Planos ativos (chips), Custo empresa, Custo colaborador.
- Linha inteira clicável (memory [Linha clicável em listas](~/.claude/projects/c--Projects-califa-erp/memory/feedback_ui_linha_clicavel.md)): `onClick` abre drawer; ações secundárias (se houver) com `stopPropagation`.
- Estado vazio: "Nenhum colaborador com benefícios na competência atual." + link para o Catálogo.

- [ ] **Step 3.5 — Receber filtros em `page.tsx` e passar pra tabela**

Expandir `searchParams` em `page.tsx` para aceitar `busca`, `beneficioId`, `modoCusteio`. Chamar `listarColaboradoresComBeneficios` com os filtros antes de renderizar a tabela.

Preservar `force-dynamic` (CLAUDE.md).

- [ ] **Step 3.6 — Drawer esqueleto (`drawer-colaborador.tsx`)**

Nesta sessão, só o shell: `<Drawer>` com título "Colaborador: {nome}", `<DrawerClose>`, e `<div>` com placeholder "Em breve (S4): vínculos, dependentes, breakdown."

Estado controlado via `useState` em `tabela-colaboradores.tsx` (`colaboradorSelecionado: string | null`).

- [ ] **Step 3.7 — Teste manual**

Com `antonio@pevetech.com.br`:
1. Navegar para `/rh/beneficios`.
2. Lista mostra todos os 210 colaboradores ativos, sem planos (planos_ativos vazio), custo zero.
3. Busca por "Mariana" → filtra para colaboradores com Mariana no nome.
4. Troca de competência atualiza (sem efeito visível ainda, pois ninguém tem vínculo — mas sem erro).
5. Clicar numa linha abre o drawer.
6. Performance: carregamento da página < 3s com 210 colaboradores. Se demorar mais, inspecionar — provável N+1 na função SQL.

**Review Focus #4 ainda não é pinado aqui** — depende de vínculo existir. Fica pra S4.

- [ ] **Step 3.8 — Build + lint + commit**

```bash
pnpm lint && pnpm tsc --noEmit && pnpm build
git add supabase/migrations/20261006000002_beneficios_listar_colaboradores.sql \
         lib/queries/beneficios.ts \
         app/\(app\)/rh/beneficios/
git commit -m "feat(rh/beneficios): tab Colaboradores com busca, filtros e drawer esqueleto"
```

**Pronto quando**:
- Tab "Colaboradores" lista todos os ativos com busca + 2 filtros funcionais.
- Linha clicável abre drawer esqueleto.
- Função `fn_beneficios_listar_colaboradores` cadastrada e grant explícito pra `authenticated`.
- Página carrega em < 3s com 210 colaboradores.

**Riscos**:
- `cross join lateral` com função SQL pode ficar lento se a `fn_beneficios_custo_mensal` tiver N+1 interno. Se > 3s, adicionar índice na busca por faixa (`beneficio_faixas_preco (beneficio_id, idade_min)` já criado em S1) e profile via `EXPLAIN ANALYZE`.
- Precisa cuidar da serialização JSONB → TypeScript array. Zod validator na borda ajuda.

**Fora do escopo**: criar vínculo, cadastrar dependente, editar catálogo.

---

### S4 — Drawer do colaborador (vínculos + dependentes + breakdown)

**Objetivo**: completar o drawer. Dentro dele: 3 tabs internas — **Vínculos** (CRUD), **Dependentes** (CRUD), **Breakdown** (resultado da `fn_beneficios_custo_mensal` para a competência). Inclusão de dependente num plano específico ocorre dentro da aba Vínculos.

**Entregáveis**:

- [ ] **Step 4.1 — Server actions em `lib/actions/beneficios/vinculos.ts`**

Implementar: `criarVinculo`, `encerrarVinculo`, `mudarModoCusteio`. Cada uma:
1. Valida input com Zod.
2. Verifica permissão (admin+rh via helper existente — padrão de Férias).
3. Chama Supabase cliente (sem bypass; RLS aplica).
4. Chama `log_audit_event` com ação `beneficio.vinculo.criado | encerrado | modo_alterado` e metadata relevante.
5. `revalidatePath('/rh/beneficios')`.

Para `mudarModoCusteio`: na realidade, "mudar modo" fecha o vínculo atual (preenche `data_fim = today - 1`) e cria um novo começando `today`. Transação única via `supabase.rpc` de nova função SQL `fn_mudar_modo_custeio`, OU duas operações em sequência com rollback manual se a 2ª falhar. **Recomendação**: função SQL — garante atomicidade. Adicionar à migration 20261006000002 ou criar `20261006000003` dedicada.

- [ ] **Step 4.2 — Função SQL `fn_mudar_modo_custeio_beneficio`**

```sql
create or replace function public.fn_mudar_modo_custeio_beneficio(
  p_vinculo_id uuid,
  p_novo_modo public.beneficio_modo_custeio,
  p_data_mudanca date default current_date
)
returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_colab uuid;
  v_benef uuid;
  v_tenant uuid;
  v_novo_id uuid;
begin
  select colaborador_id, beneficio_id, tenant_id
    into v_colab, v_benef, v_tenant
    from public.colaborador_beneficio
   where id = p_vinculo_id and data_fim is null;

  if v_colab is null then
    raise exception 'Vínculo não encontrado ou já encerrado (id=%)', p_vinculo_id;
  end if;

  update public.colaborador_beneficio
     set data_fim = p_data_mudanca - 1,
         updated_at = now()
   where id = p_vinculo_id;

  insert into public.colaborador_beneficio(tenant_id, colaborador_id, beneficio_id, modo_custeio, data_inicio)
    values (v_tenant, v_colab, v_benef, p_novo_modo, p_data_mudanca)
    returning id into v_novo_id;

  return v_novo_id;
end;
$$;

grant execute on function public.fn_mudar_modo_custeio_beneficio(uuid, public.beneficio_modo_custeio, date)
  to authenticated;
```

- [ ] **Step 4.3 — Server actions em `lib/actions/beneficios/dependentes.ts`**

Implementar: `criarDependente`, `editarDependente`, `desativarDependente`, `incluirDepEmPlano`, `removerDepDePlano`. Mesma estrutura das vinculos.ts. Audit em todos.

- [ ] **Step 4.4 — Query `listarVinculosDoColaborador`**

```ts
export async function listarVinculosDoColaborador(colaboradorId: string) {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('colaborador_beneficio')
    .select(`
      id, modo_custeio, data_inicio, data_fim, observacao,
      beneficio:beneficios ( id, nome, tipo, modelo_preco )
    `)
    .eq('colaborador_id', colaboradorId)
    .order('data_inicio', { ascending: false })
  if (error) throw error
  return data ?? []
}
```

- [ ] **Step 4.5 — Query `listarDependentesDoColaborador`**

Idem para `dependentes` filtrando `colaborador_id`.

- [ ] **Step 4.6 — Query `custoMensalDoColaborador`**

Chamada direta à `fn_beneficios_custo_mensal(ano, mes, colaborador_id)` via `supabase.rpc`.

- [ ] **Step 4.7 — Construir drawer com 3 tabs internas**

Substituir o placeholder criado em S3.6. Dentro do drawer:
- Header: nome, tipo contratação, data admissão.
- `<Tabs defaultValue="vinculos">` com triggers "Vínculos", "Dependentes", "Breakdown".
- **Aba Vínculos**: lista dos vínculos (ativos e encerrados). Cada ativo tem botões "Mudar modo" e "Encerrar". Botão "+ Novo vínculo" no topo abre formulário em modal/drawer.
- **Aba Dependentes**: lista de dependentes do colaborador. Cada um mostra nome, CPF, data nasc, parentesco, chips com em quais planos está incluído. Botões "+ Novo dependente" e "Incluir em plano".
- **Aba Breakdown**: tabela com uma linha por vínculo ativo, mostrando as colunas que a função retorna (idade titular, valor integral, valor empresa, valor colaborador titular, qtde deps, valor deps total, desconto folha total).

As queries de aba são chamadas via Server Component que recebe `colaboradorId` como prop. Para o drawer, usar o padrão de Server Component dentro de Dialog/Drawer (ou Suspense + loading).

- [ ] **Step 4.8 — `form-vinculo.tsx` (Client Component + RHF + Zod)**

Campos:
- Benefício: select com os 3 do catálogo.
- Modo de custeio: 3 radio/select, com descrição curta de cada.
- Data de início: date picker (default: hoje).
- Observação: textarea opcional.

Zod schema inclui regra: `modo_custeio === 'integral_empresa_com_upgrade'` só é selecionável quando o `beneficio_id` escolhido tem `beneficio_base_id IS NOT NULL`. Validação na UI (lê do catálogo); banco também valida via trigger (defesa em profundidade).

- [ ] **Step 4.9 — `form-dependente.tsx`**

Campos obrigatórios: nome, CPF (mask), data_nascimento, parentesco (select com sugestões + "outro" → input livre). Zod valida CPF (formato) e data_nascimento <= hoje.

**Review Focus #1 pinado aqui**: formulário rejeita salvar se o colaborador titular não tem CPF nem data_nascimento. Mostra aviso específico com link para a tela de edição do colaborador. Testar manual com um colaborador sem data_nascimento (nenhum hoje; criar temporariamente ou pular — como todos os 210 têm, pular com nota no comentário).

- [ ] **Step 4.10 — "Incluir dependente em plano"**

Dentro da aba Dependentes de um colaborador que tem vínculo ativo, cada dependente mostra chips do tipo "SulAmerica Especial" / "+ Incluir". Click no "+" abre um popover simples com select de qual plano incluir (dentre os vínculos ativos do colaborador). Submete → `incluirDepEmPlano({ vinculoId, dependenteId, dataInicio })`.

Para remover, click no "×" do chip → confirm → `removerDepDePlano` → preenche `data_fim`.

- [ ] **Step 4.11 — Teste manual: Review Focus #4 (atravessar faixa etária)**

1. Criar um colaborador de teste com `data_nascimento = '1998-12-15'` (28 anos hoje; faz 29 em 2026-12-15, mudando de faixa).
2. Vincular a SulAmerica Especial, modo rateado, data_inicio = hoje.
3. Seletor de competência: trocar para dezembro/2026 → breakdown mostra idade 28, valor R$ 682,65.
4. Trocar para janeiro/2027 → breakdown mostra idade 29, valor R$ 757,75. Rateio refeito automaticamente.

Expected: valores batem com a tabela SulAmérica da foto.

- [ ] **Step 4.12 — Teste manual: fluxo real completo**

1. Com `antonio@pevetech.com.br`:
   - Abrir drawer do Antonio (ou outro colaborador real).
   - Criar vínculo com Bradesco Dental, modo rateado.
   - Cadastrar 1 dependente (nome, CPF teste, data nasc).
   - Incluir dep no Dental.
   - Verificar breakdown: titular R$ 13 (100% colab, dental), dep R$ 13 (100% colab), total desconto R$ 26.
2. Mudar modo de custeio para `integral_empresa` → vínculo encerrado + novo criado. Breakdown: titular R$ 0 (empresa cobre 100%), dep continua R$ 13. Total desconto R$ 13.
3. Encerrar o vínculo (`data_fim = hoje`). Breakdown vazio na competência atual.

Verificar no banco via MCP: `audit_events` tem as linhas registradas para cada ação.

- [ ] **Step 4.13 — Build + lint + commit**

```bash
pnpm lint && pnpm tsc --noEmit && pnpm build
git add .
git commit -m "feat(rh/beneficios): drawer do colaborador com vínculos, dependentes e breakdown da competência"
```

**Pronto quando**:
- Drawer abre com 3 abas funcionais.
- Criar vínculo, mudar modo, encerrar vínculo, criar dependente, incluir/remover dep em plano — todas funcionam e logam em `audit_events`.
- Breakdown bate com cálculo manual contra a tabela SulAmérica.
- Review Focus #4 pinado (manual).

**Riscos**:
- Formulário com validação de "upgrade exige base" pode ficar confuso na UX. Alternativa: desabilitar opção "integral_empresa_com_upgrade" no select quando o benefício escolhido não é upgrade. Decidir no início da sessão.
- Server actions precisam seguir o padrão do projeto (como Férias faz). Inspecionar `app/(app)/rh/ferias/_actions/` antes.
- Audit metadata deve ter chaves em pt-BR consistentes com Férias (ex.: `{ acao_tentada: "vinculo.criado", colaborador_id: "...", beneficio_id: "..." }`). Conferir padrão.

**Fora do escopo**: catálogo (S5).

---

### S5 — Tab Catálogo (CRUD de benefícios + faixas)

**Objetivo**: dentro da tab "Catálogo", permitir admin+rh editar os 3 benefícios cadastrados (nome, operadora, percentuais, valor flat quando aplicável) e as faixas de preço (adicionar, editar, remover).

**Entregáveis**:

- [ ] **Step 5.1 — Server actions em `lib/actions/beneficios/catalogo.ts`**

Implementar:
- `criarBeneficio(input)` — Zod + RLS + audit `beneficio.catalogo.criado`.
- `editarBeneficio(id, input)` — audit `beneficio.catalogo.editado`.
- `desativarBeneficio(id)` — soft delete via `UPDATE ativo=false`.
- `criarFaixa(beneficioId, input)` — Zod + audit `beneficio.faixa.editada`.
- `editarFaixa(id, input)` — audit idem.
- `removerFaixa(id)` — audit idem.

Validações críticas no Zod:
- Benefício com `modelo_preco = 'flat'` exige `valor_flat > 0`.
- Benefício com `modelo_preco = 'faixa_etaria'` **não** aceita `valor_flat`.
- Faixa: `idade_min >= 0`, `idade_max > idade_min OR idade_max IS NULL`.

- [ ] **Step 5.2 — Query `listarBeneficios`**

```ts
export async function listarBeneficios() {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('beneficios')
    .select(`
      id, nome, operadora, tipo, modelo_preco,
      percentual_empresa_titular, percentual_colaborador_dependentes,
      valor_flat, beneficio_base_id, codigo_externo, ativo, observacao,
      faixas:beneficio_faixas_preco ( id, idade_min, idade_max, valor )
    `)
    .order('nome')
  if (error) throw error
  return data ?? []
}
```

- [ ] **Step 5.3 — `tab-catalogo.tsx`**

Dentro da tab Catálogo:
- Lista dos 3 benefícios como cards (um por benefício). Cada card mostra: nome, operadora, tipo, modelo de preço, percentuais, qtde de faixas (ou valor flat), ativo/inativo.
- Click no card abre drawer de edição.
- Botão "+ Novo benefício" no topo.

- [ ] **Step 5.4 — Drawer de edição do benefício**

Form principal (`<form>` RHF + Zod):
- Nome, operadora (inputs), tipo (select 2 opções), modelo_preco (select 2 opções, desabilita após criado).
- Percentual empresa titular + percentual colaborador dependentes (sliders ou inputs).
- Valor flat (visível só se `modelo_preco='flat'`).
- Beneficio base (select — só benefícios do mesmo tipo e com `modelo_preco='faixa_etaria'`; opcional).
- Código externo (input opcional).
- Observação (textarea opcional).

Abaixo do form: tabela de faixas de preço (visível só se `modelo_preco='faixa_etaria'`):
- Colunas: Idade mín, Idade máx, Valor. Última linha pode ter idade_max NULL (mostrar "sem limite").
- Botões por linha: editar (inline), remover.
- Botão "+ Nova faixa" no final.

- [ ] **Step 5.5 — `form-faixa.tsx`**

Modal/popover simples com idade_min, idade_max (checkbox "sem limite superior"), valor.

- [ ] **Step 5.6 — Teste manual: editar valor do Dental**

1. Entrar na tab Catálogo.
2. Abrir "Bradesco Dental".
3. Mudar valor_flat de 13 para 15.
4. Salvar.
5. Voltar pra aba Colaboradores. Se há vínculos ativos de Dental, breakdown recalcula para R$ 15.
6. Audit tem a entrada `beneficio.catalogo.editado`.

- [ ] **Step 5.7 — Teste manual: adicionar nova faixa ao Direto**

1. Abrir "SulAmerica Direto Nacional" no catálogo.
2. Adicionar faixa fictícia 0-18 (já existe na seed, deve dar erro de unique) → UI mostra erro clareza.
3. Remover a faixa 59+, adicionar 59-99 R$ 2200,00. Salvar.
4. Verificar que vínculos de colaboradores 59+ param de ter faixa (null) → UI do breakdown precisa lidar com faixa não encontrada.

**Ajuste necessário na UI**: se a função retornar NULL em `valor_integral_titular`, mostrar aviso "Faixa de preço não cadastrada para idade X". Já que descobrimos esse caso aqui, voltar e corrigir — não deixar como débito.

- [ ] **Step 5.8 — Build + lint + commit**

```bash
pnpm lint && pnpm tsc --noEmit && pnpm build
git add .
git commit -m "feat(rh/beneficios): tab Catálogo com CRUD de benefícios e faixas de preço"
```

- [ ] **Step 5.9 — PR final da Fase 1**

Abrir PR consolidando as 5 sessões (ou merge direto se tudo foi em `main` dia a dia, com commit final atualizando o docs/HANDOFF.md).

Atualizar [`docs/modulos/rh/README.md`](README.md) marcando Benefícios Fase 1 como "implementada" e removendo o aviso "em modelagem".

**Pronto quando**:
- Admin+rh editam os 3 benefícios + faixas pela UI.
- Reajuste de valor refaz cálculo em tempo real (recarga da página).
- Nenhuma faixa editada pela UI escapa do audit.
- Build limpo.

**Riscos**:
- UX de "mudar o `modelo_preco` depois de criado" é confusa e perigosa (pode deixar valor_flat e faixas inconsistentes). Decisão: desabilitar o select no form de edição. Só criável no form "Novo benefício".
- Edição de faixa de preço vigente afeta cálculo de competência atual **e** de competências futuras — não há histórico de reajuste na Fase 1. Documentar na UI com texto curto: "O valor passa a valer para o cálculo da competência atual em diante." Histórico de reajustes entra na Fase 2.

**Fora do escopo**: histórico de reajuste de faixas, upload de nova tabela SulAmerica em CSV, benefícios adicionais (vale-transporte etc.).

---

## 5. Checkpoints de validação humana (CP)

Nenhuma sessão vai pra produção sem o checkpoint da sessão passar.

| CP | Após qual sessão | O que validar | Com quem |
|---|---|---|---|
| **CP1** | S1 | MCP confirma schema + seed + policies + Review Focus pinados | Antonio |
| **CP2** | S2 | Hub card aparece; `/rh/beneficios` renderiza KPIs zerados; permissão trava não-admin | Antonio |
| **CP3** | S3 | Lista mostra 210 colaboradores, filtros funcionam, performance < 3s | Antonio |
| **CP4** | S4 | Fluxo completo: criar vínculo + dep + incluir dep em plano + breakdown bate com cálculo manual contra tabela SulAmérica | Antonio + Daniel (sanity) |
| **CP5** | S5 | Editar Dental R$ 13 → R$ 15 reflete em breakdown; editar faixa SulAmerica reflete; audit grava | Antonio + Kika (se disponível) |

## 6. Métricas de sucesso da Fase 1

- 100% dos 210 colaboradores ativos aparecem na tab Colaboradores.
- 0 erros em produção nos 7 dias após deploy.
- Antonio consegue cadastrar 10 vínculos reais em < 15 minutos (SulAmerica Direto + Especial + Dental para 3-5 colaboradores de teste).
- Breakdown mostra valores que batem **centavo a centavo** com a planilha mestra da Kika para esses 3-5 colaboradores.
- Advisors Supabase: 0 alertas vermelhos nas 5 tabelas novas.

## 7. Riscos globais da Fase 1

1. **Dados de colaboradores sem CPF**: hoje 210 ativos têm `data_nascimento`, mas quantos têm CPF? Verificar antes de S4. Query: `SELECT count(*) FROM colaboradores WHERE status='ativo' AND cpf IS NULL`. Se > 0, criar backlog pra RH preencher antes de usar Benefícios em produção.
2. **Nome do helper de permissão de rota**: assumido como `requireActiveRole(['administrador', 'rh'])` seguindo Férias. Se o nome real for diferente, ajustar em S2.
3. **Padrão de audit metadata em pt-BR vs identificadores**: usar strings de ação em identificador snake_case (`beneficio.vinculo.criado`), metadata com chaves em identificador snake_case (`colaborador_id`), textos auxiliares em pt-BR com acentos. Confirmar que `audit_events` já aceita jsonb com acentos (deveria, UTF-8).
4. **Performance da `fn_beneficios_custo_mensal` × 210 colaboradores**: se > 3s no load inicial, cachear resultado por competência via `revalidateTag` ou usar materialized view no futuro. Fase 1 pode viver com 3-5s se necessário; Fase 2 precisa resolver.

## 8. O que vem depois (não implementar aqui)

- **Fase 1.5**: vista do colaborador em `/perfil` → aba "Meus benefícios". 1 sessão.
- **Fase 2**: fechamento mensal com snapshot auditável, linha de ajuste manual, upload da fatura real e comparativo. 2 sessões.
- **Fase 3**: integração com folha mensal (quando o motor da folha estiver pronto). Gera linha de desconto na folha e/ou avulsa pra pagar a operadora. 2 sessões.
- **Novos benefícios no catálogo**: vale-transporte, GymPass, seguro de vida. Sem código novo — só UI do catálogo. Já suportado pelo modelo.
- **Import inicial de vínculos reais**: migration adicional ou importador CSV que lê `SulAmerica.csv` + `BradescoDental.csv` da competência atual e popula `colaborador_beneficio` + `dependentes` + `colaborador_beneficio_dependente`. Decidir após S5 se vira sessão própria ou vai pra P1 do backlog.
