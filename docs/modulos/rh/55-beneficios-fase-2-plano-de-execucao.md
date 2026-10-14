# 55 — Plano de Execução do Subsistema Benefícios (Fase 2 — Fechamento Mensal)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar o plano sessão por sessão. Steps usam checkbox (`- [ ]`).

**Goal:** Colocar no ar a Fase 2 do subsistema de Benefícios: infraestrutura para congelar competências (snapshot), vencimento de fatura no catálogo e view do DRE que ajusta o repasse do colaborador (opção B.3 do ADR 174). Zero UI nova.

**Architecture:** Uma migration aditiva única cria 2 tabelas (`beneficio_fechamento_mensal`, `beneficio_fechamento_linha`), 2 colunas em `beneficios` (dia/mês de vencimento), 1 função SQL (`fn_beneficios_calcular_fechamento`) e 1 view (`vw_dre_despesa_pessoal_ajustada_mensal`). Policies RLS idênticas às de Benefícios Fase 1. Tipos escritos à mão em `lib/types.ts`. Linha nova no `CLAUDE.md` cita a view como fonte-verdade do DRE.

**Tech Stack:** Supabase (Postgres + RLS), TypeScript, MCP (apply_migration + execute_sql). Nenhuma dependência npm nova. Nenhum arquivo React/Next tocado.

**Spec:**
- [`53-beneficios-fechamento-mensal.md`](53-beneficios-fechamento-mensal.md) — modelo + regras + verificação pós.
- [`../../decisions/174-beneficios-integracao-folha-e-dre.md`](../../decisions/174-beneficios-integracao-folha-e-dre.md) — ADR fonte-verdade das Fases 2/3/4.
- [`50-beneficios.md`](50-beneficios.md) §7 — resumo.

## Global Constraints

Herdadas de `CLAUDE.md` e das specs. Toda sessão respeita implicitamente:

- **Ortografia pt-BR em toda string visível** (acentos, cedilha, til). Identificadores em código podem ficar sem acento por convenção. Nesta fase quase nada é visível ao usuário — mas `COMMENT ON ...` do banco segue pt-BR correto.
- **`docs/FLUXO-BANCO.md`**: nada aplicado sem migration versionada; MCP só para `apply_migration` + `execute_sql`; conferência pós-aplicação pelo MCP; mudança destrutiva exige confirmação. Fase 2 é **100% aditiva** — não há mudança destrutiva.
- **`docs/PERFORMANCE.md`**: GRANT explícito para `authenticated` em toda tabela nova; policies usam `(select auth.uid())` via helpers (`is_tenant_admin`, `is_tenant_rh`, `is_colaborador_proprio`); nada para `anon`; índices em FKs quentes.
- **`lib/types.ts` é escrito à mão**: migration que mexe em coluna ou cria tabela usada pela UI atualiza o tipo correspondente no mesmo commit. Nesta fase a UI não lê os tipos novos ainda, mas eles entram no commit da migration pra ficar pronto pra Fase 3.
- **Audit de evento sensível**: nesta fase, nenhum evento humano acontece. Os INSERTs em `beneficio_fechamento_mensal` só começam na Fase 3 (via `aplicarBeneficios`). Nenhum `log_audit_event` nesta fase.
- **RLS gate**: admin+rh escrevem; colaborador lê o próprio via `is_colaborador_proprio` (só a linha dele em `beneficio_fechamento_linha`; não vê cabeçalho).
- **Snapshot é imutável**: `beneficio_fechamento_linha` **não tem policy nem grant de UPDATE**. Para corrigir, desaplica + reaplica (Fase 3).
- **Sem suite de testes automatizada**. Verificação é: `tsc` + `pnpm lint` + `pnpm build` + checklist MCP (§6 do spec) + `select` manual na view com dado simulado.

## Review Focus

Classes de input que a spec implica mas que nenhum step automatizado garante. Cada linha é pinada no step que a exercita.

1. **Reabrir fechamento quando `reaberto_em is not null`**. A view deve ignorá-lo. **Pinado em S1 §Step 1.14 (verificação MCP)** via `UPDATE ... SET reaberto_em = now()` em registro de teste + `SELECT` na view confirma linha some.
2. **Soma `empresa + colaborador` divergindo de `integral` por mais de R$ 0,01**. Check constraint deve rejeitar. **Pinado em S1 §Step 1.14** via `INSERT` que viola.
3. **Dois fechamentos pra mesma (tenant, ano, mes)**. Unique deve rejeitar. **Pinado em S1 §Step 1.14** via `INSERT` duplicado.
4. **UPDATE em `beneficio_fechamento_linha`**. Deve falhar por falta de GRANT. **Pinado em S1 §Step 1.14** via `UPDATE` executado com role `authenticated` simulada.
5. **Policy de colaborador vendo linha de outro colaborador**. Deve retornar 0 linhas. **Pinado em S1 §Step 1.14** via `SELECT` com `set local request.jwt.claims` simulando outro usuário.

---

## 1. Filosofia

- **1 sessão = 1 commit no mínimo, 1 PR no máximo.** Fase 2 cabe em **1 sessão** curta (2-3h) com 2 commits (migration + types/CLAUDE.md).
- **Nenhuma UI tocada.** Qualquer tentação de "já criar a tab Fechamentos" se segura — isso é Fase 3.
- **Checklist §6 do spec é lei.** Não dar sessão como pronta sem os 7 checks verdes.
- **Mudança destrutiva zero.** Se o executor encontrar necessidade de alterar algo pré-existente (ex: mudar tipo de coluna em `beneficios`), para e pergunta.

## 2. Visão macro: 1 sessão

```
S1 ─ Banco: migration aditiva (2 tabelas + 2 colunas em beneficios + função + view + policies + grants)
      + tipos em lib/types.ts
      + nota no CLAUDE.md
```

Estimativa: **1 sessão de 2-3h**. Zero paralelismo (tudo serial dentro da migration).

## 3. Mapa de arquivos

### Banco (S1)
- **Criar**: `supabase/migrations/20261014000001_beneficios_fase2_fechamento.sql` (nome final conforme data da sessão).

### Tipos (S1)
- **Modificar**: `lib/types.ts` — adicionar 2 tipos (`BeneficioFechamentoMensal`, `BeneficioFechamentoLinha`) + 1 tipo da view (`DreDespesaPessoalAjustadaMensal`).

### Documentação (S1)
- **Modificar**: `CLAUDE.md` — adicionar linha na seção de regras transversais apontando `vw_dre_despesa_pessoal_ajustada_mensal` como fonte-verdade do DRE de pessoal/benefícios (4ª âncora do ADR 174 §3).

### Nada tocado
- `app/**` — zero.
- `components/**` — zero.
- `lib/actions/**` — zero.
- `lib/queries/**` — zero.

---

## 4. Sessão a sessão

### S1 — Migration de fechamento + tipos + CLAUDE.md

**Objetivo**: colocar no ar as 2 tabelas, 2 colunas, função, view, policies, grants e tipos TypeScript — tudo pronto pra Fase 3 começar sem precisar mexer no banco.

**Pré-condições**:
- Fase 1 em produção (`beneficios`, `colaborador_beneficio`, `dependentes` etc. já aplicados).
- Helpers `is_tenant_admin`, `is_tenant_rh`, `is_colaborador_proprio` existem (confirmados via MCP antes de começar — ver Step 1.0).
- Pelo menos 1 tenant com vínculos ativos na competência atual (pra Step 1.14 §Review Focus 1 e 5 funcionarem com dado real).

**Entregáveis**:

- [ ] **Step 1.0 — Auditoria MCP pré-escrita**

Via MCP, confirmar:
```sql
-- Confirma que os helpers existem e assinam como esperado
select proname, prosrc from pg_proc
where proname in ('is_tenant_admin', 'is_tenant_rh', 'is_colaborador_proprio');

-- Confirma que fn_beneficios_custo_mensal existe (vai ser referenciada pela fn nova)
select proname from pg_proc where proname = 'fn_beneficios_custo_mensal';

-- Confirma colunas atuais de beneficios (pra não colidir nomes)
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'beneficios'
order by ordinal_position;

-- Confirma pelo menos 1 competência com vínculos ativos
select count(*) from colaborador_beneficio where encerrado is null;
```

Esperado: 3 helpers encontrados, `fn_beneficios_custo_mensal` existe, `beneficios` não tem colunas `dia_vencimento_fatura` nem `vencimento_mes_seguinte`, `count > 0`.

Se qualquer um falhar, parar e pedir instrução.

- [ ] **Step 1.1 — Criar arquivo de migration com cabeçalho**

Criar `supabase/migrations/20261014000001_beneficios_fase2_fechamento.sql`:

```sql
-- Migration: Benefícios — Fase 2 (Fechamento Mensal)
-- Spec: docs/modulos/rh/53-beneficios-fechamento-mensal.md
-- ADR: docs/decisions/174-beneficios-integracao-folha-e-dre.md
-- Plano: docs/modulos/rh/55-beneficios-fase-2-plano-de-execucao.md (S1)
--
-- Esta migration cria a infra de fechamento mensal:
-- 2 tabelas (beneficio_fechamento_mensal, beneficio_fechamento_linha)
-- 2 colunas em beneficios (dia_vencimento_fatura, vencimento_mes_seguinte)
-- 1 função SQL (fn_beneficios_calcular_fechamento)
-- 1 view (vw_dre_despesa_pessoal_ajustada_mensal — DRE opção B.3 do ADR 174)
-- Policies RLS iguais às de Fase 1; UPDATE em _linha propositalmente ausente (snapshot imutável).
--
-- Zero UI nesta fase. UI de fechamento entra na Fase 3 junto com "Aplicar descontos".
-- 100% aditiva — nenhuma mudança destrutiva.

begin;

-- (steps abaixo)

commit;
```

- [ ] **Step 1.2 — Colunas novas em `beneficios` + seed de vencimentos**

Dentro do `begin;...commit;`:

```sql
alter table public.beneficios
  add column dia_vencimento_fatura int check (dia_vencimento_fatura between 1 and 31),
  add column vencimento_mes_seguinte boolean not null default true;

comment on column public.beneficios.dia_vencimento_fatura is
  'Dia do mes em que vence o boleto da operadora. Fase 3 usa isso + vencimento_mes_seguinte para calcular data_vencimento da avulsa gerada.';
comment on column public.beneficios.vencimento_mes_seguinte is
  'Se true, o vencimento cai no mes seguinte a competencia (SulAmerica, Bradesco). Se false, no mes da propria competencia.';

update public.beneficios
set dia_vencimento_fatura = 5
where operadora ilike 'SulAmerica%';

update public.beneficios
set dia_vencimento_fatura = 29
where operadora ilike 'Bradesco%';
```

- [ ] **Step 1.3 — Tabela `beneficio_fechamento_mensal` + unique + index**

```sql
create table public.beneficio_fechamento_mensal (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  ano int not null check (ano between 2024 and 2100),
  mes int not null check (mes between 1 and 12),
  fechado_em timestamptz not null default now(),
  fechado_por uuid not null references public.perfis(id) on delete restrict,
  reaberto_em timestamptz,
  reaberto_por uuid references public.perfis(id) on delete restrict,
  observacao text,

  constraint uq_fechamento_tenant_competencia unique (tenant_id, ano, mes)
);

create index idx_fechamento_mensal_tenant on public.beneficio_fechamento_mensal (tenant_id, ano, mes);

comment on table public.beneficio_fechamento_mensal is
  'Snapshot da competencia de beneficios. Uma linha por (tenant, ano, mes). Enquanto reaberto_em is null, o fechamento esta vigente e aparece no DRE via vw_dre_despesa_pessoal_ajustada_mensal.';
```

- [ ] **Step 1.4 — Tabela `beneficio_fechamento_linha` + checks + índices**

```sql
create table public.beneficio_fechamento_linha (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  fechamento_id uuid not null references public.beneficio_fechamento_mensal(id) on delete cascade,

  colaborador_beneficio_id uuid not null references public.colaborador_beneficio(id) on delete restrict,
  colaborador_id uuid not null references public.colaboradores(id) on delete restrict,
  beneficio_id uuid not null references public.beneficios(id) on delete restrict,

  beneficio_nome text not null,
  beneficio_operadora text not null,
  beneficio_tipo public.beneficio_tipo not null,

  modo_custeio public.beneficio_modo_custeio not null,

  valor_titular numeric(10, 2) not null check (valor_titular >= 0),
  valor_dependentes_total numeric(10, 2) not null default 0 check (valor_dependentes_total >= 0),
  valor_integral numeric(10, 2) not null check (valor_integral >= 0),
  valor_empresa numeric(10, 2) not null check (valor_empresa >= 0),
  valor_colaborador numeric(10, 2) not null check (valor_colaborador >= 0),

  qtd_dependentes_na_competencia int not null default 0 check (qtd_dependentes_na_competencia >= 0),

  created_at timestamptz not null default now(),

  constraint chk_fechamento_linha_soma
    check (abs((valor_empresa + valor_colaborador) - valor_integral) < 0.01)
);

create index idx_fechamento_linha_fechamento on public.beneficio_fechamento_linha (fechamento_id);
create index idx_fechamento_linha_colaborador on public.beneficio_fechamento_linha (colaborador_id);
create index idx_fechamento_linha_beneficio on public.beneficio_fechamento_linha (beneficio_id);
create index idx_fechamento_linha_operadora on public.beneficio_fechamento_linha (beneficio_operadora);

comment on table public.beneficio_fechamento_linha is
  'Detalhe do fechamento: uma linha por colaborador_beneficio ativo na competencia. Imutavel apos insercao — nao aceita UPDATE (sem policy, sem grant). Para corrigir, desaplicar o fechamento (apaga via cascade) e aplicar de novo.';
```

- [ ] **Step 1.5 — Função `fn_beneficios_calcular_fechamento`**

```sql
create or replace function public.fn_beneficios_calcular_fechamento(
  p_tenant_id uuid,
  p_ano int,
  p_mes int
)
returns table (
  colaborador_beneficio_id uuid,
  colaborador_id uuid,
  beneficio_id uuid,
  beneficio_nome text,
  beneficio_operadora text,
  beneficio_tipo public.beneficio_tipo,
  modo_custeio public.beneficio_modo_custeio,
  valor_titular numeric,
  valor_dependentes_total numeric,
  valor_integral numeric,
  valor_empresa numeric,
  valor_colaborador numeric,
  qtd_dependentes_na_competencia int
)
language sql
security invoker
stable
as $$
  -- Itera por todos os vinculos ativos na competencia (p_ano, p_mes):
  -- "ativo" = iniciado <= ultimo dia do mes AND (encerrado is null OR encerrado > primeiro dia do mes)
  -- Para cada vinculo, reusa a logica de fn_beneficios_custo_mensal(colaborador_beneficio_id, ano, mes).
  with vinculos_ativos as (
    select cb.id as colaborador_beneficio_id,
           cb.colaborador_id,
           cb.beneficio_id,
           cb.modo_custeio,
           b.nome as beneficio_nome,
           b.operadora as beneficio_operadora,
           b.tipo as beneficio_tipo
    from public.colaborador_beneficio cb
    join public.beneficios b on b.id = cb.beneficio_id
    join public.colaboradores c on c.id = cb.colaborador_id
    where c.tenant_id = p_tenant_id
      and cb.iniciado <= make_date(p_ano, p_mes, 1) + interval '1 month' - interval '1 day'
      and (cb.encerrado is null or cb.encerrado > make_date(p_ano, p_mes, 1))
  ),
  calculo as (
    select v.*,
           (public.fn_beneficios_custo_mensal(v.colaborador_beneficio_id, p_ano, p_mes)).*
    from vinculos_ativos v
  )
  select colaborador_beneficio_id,
         colaborador_id,
         beneficio_id,
         beneficio_nome,
         beneficio_operadora,
         beneficio_tipo,
         modo_custeio,
         valor_titular,
         valor_dependentes_total,
         valor_integral,
         valor_empresa,
         valor_colaborador,
         qtd_dependentes_na_competencia
  from calculo;
$$;

comment on function public.fn_beneficios_calcular_fechamento is
  'Calcula o snapshot da competencia (p_ano, p_mes) para o tenant. Retorna uma linha por colaborador_beneficio ativo. Fase 3 insere o resultado em beneficio_fechamento_linha dentro de uma transacao com beneficio_fechamento_mensal. Executa com SECURITY INVOKER — RLS do chamador aplicada.';

grant execute on function public.fn_beneficios_calcular_fechamento(uuid, int, int) to authenticated;
```

**Nota de implementação**: a chamada `(public.fn_beneficios_custo_mensal(...)).*` assume que `fn_beneficios_custo_mensal` já retorna as colunas `valor_titular, valor_dependentes_total, valor_integral, valor_empresa, valor_colaborador, qtd_dependentes_na_competencia`. Antes de aplicar, conferir via Step 1.0 que a assinatura bate. Se a função atual não expor `qtd_dependentes_na_competencia`, duas opções: (a) adicionar na função original dentro desta migration (ainda aditiva — adiciona campo retornado); (b) calcular aqui com `(select count(*) from colaborador_beneficio_dependente cbd where cbd.colaborador_beneficio_id = v.colaborador_beneficio_id and cbd.vigente_desde <= make_date(p_ano, p_mes, 1) and (cbd.vigente_ate is null or cbd.vigente_ate > make_date(p_ano, p_mes, 1)))`. Decidir no momento com base no que o MCP retornar no Step 1.0.

- [ ] **Step 1.6 — View `vw_dre_despesa_pessoal_ajustada_mensal` + comment**

```sql
create view public.vw_dre_despesa_pessoal_ajustada_mensal as
select
  f.tenant_id,
  f.ano,
  f.mes,
  coalesce(sum(l.valor_integral), 0) as valor_bruto_beneficios,
  coalesce(sum(l.valor_empresa), 0) as valor_dre_beneficios,
  coalesce(sum(l.valor_colaborador), 0) as valor_dre_pessoal_ajuste
from public.beneficio_fechamento_mensal f
join public.beneficio_fechamento_linha l on l.fechamento_id = f.id
where f.reaberto_em is null
group by f.tenant_id, f.ano, f.mes;

comment on view public.vw_dre_despesa_pessoal_ajustada_mensal is
  'Ajuste do DRE para beneficios conforme ADR 174 (opcao B.3). A avulsa de operadora entra no banco com valor cheio no subtipo "Beneficios"; esta view permite ao DRE separar: valor_dre_beneficios (parte empresa, despesa real do subtipo Beneficios 05.002) e valor_dre_pessoal_ajuste (repasse do colaborador, soma em Despesa com Pessoal 05.015 ou equivalente). Fechamentos reabertos (reaberto_em not null) sao ignorados. Fonte-verdade: docs/decisions/174-beneficios-integracao-folha-e-dre.md.';
```

- [ ] **Step 1.7 — Habilitar RLS nas 2 tabelas novas**

```sql
alter table public.beneficio_fechamento_mensal enable row level security;
alter table public.beneficio_fechamento_linha enable row level security;
```

- [ ] **Step 1.8 — Policies de `beneficio_fechamento_mensal` (4)**

```sql
create policy "sel_fechamento_mensal_admin_rh"
  on public.beneficio_fechamento_mensal for select
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "ins_fechamento_mensal_admin_rh"
  on public.beneficio_fechamento_mensal for insert
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "upd_fechamento_mensal_admin_rh"
  on public.beneficio_fechamento_mensal for update
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "del_fechamento_mensal_admin_rh"
  on public.beneficio_fechamento_mensal for delete
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));
```

- [ ] **Step 1.9 — Policies de `beneficio_fechamento_linha` (4 — sem UPDATE)**

```sql
create policy "sel_fechamento_linha_admin_rh"
  on public.beneficio_fechamento_linha for select
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "sel_fechamento_linha_colaborador_proprio"
  on public.beneficio_fechamento_linha for select
  using (public.is_colaborador_proprio(colaborador_id));

create policy "ins_fechamento_linha_admin_rh"
  on public.beneficio_fechamento_linha for insert
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "del_fechamento_linha_admin_rh"
  on public.beneficio_fechamento_linha for delete
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

-- Deliberadamente nenhuma policy de UPDATE. Snapshot e imutavel.
```

- [ ] **Step 1.10 — GRANTs**

```sql
grant select, insert, update, delete on public.beneficio_fechamento_mensal to authenticated;
grant select, insert, delete on public.beneficio_fechamento_linha to authenticated;
grant select on public.vw_dre_despesa_pessoal_ajustada_mensal to authenticated;
```

**Atenção:** `beneficio_fechamento_linha` **não recebe grant de UPDATE**. Combinado com a ausência de policy de UPDATE, isso dupla-garante a imutabilidade.

- [ ] **Step 1.11 — Fechar o `begin;...commit;` no arquivo**

Confirmar que o `commit;` está na última linha do arquivo e que todos os steps acima estão dentro da transação.

- [ ] **Step 1.12 — Aplicar migration via MCP**

Rodar `apply_migration` com o conteúdo do arquivo.

Esperado: sucesso. Se erro, ler mensagem, não ficar insistindo — ajustar e aplicar de novo.

- [ ] **Step 1.13 — Verificação pós-migration básica (via MCP)**

Checklist §6 do spec, items 1-3:

```sql
-- 1. Tabelas criadas e com RLS
select table_name, row_security
from information_schema.tables t
join pg_tables pt on pt.tablename = t.table_name
where t.table_schema = 'public'
  and t.table_name in ('beneficio_fechamento_mensal', 'beneficio_fechamento_linha');
-- Esperado: 2 linhas, ambas com row_security = true

-- 2. Beneficios tem as colunas novas populadas
select nome, operadora, dia_vencimento_fatura, vencimento_mes_seguinte
from public.beneficios
order by operadora;
-- Esperado: SulAmerica Direto/Especial = 5, Bradesco Dental = 29, todas vencimento_mes_seguinte = true

-- 3. View responde sem erro (vazia por enquanto)
select * from public.vw_dre_despesa_pessoal_ajustada_mensal;
-- Esperado: 0 linhas, sem erro

-- 4. Função retorna linhas coerentes com fn_beneficios_custo_mensal
-- (comparar manual: para 1 colaborador, resultado da fn nova = resultado da fn Fase 1)
select *
from public.fn_beneficios_calcular_fechamento(
  (select id from public.tenants limit 1),
  2026, 10
)
limit 5;
-- Esperado: linhas com valores > 0, soma empresa+colaborador = integral

-- 5. GRANT de UPDATE em _linha nao existe
select has_table_privilege('authenticated', 'public.beneficio_fechamento_linha', 'UPDATE');
-- Esperado: false

-- 6. Anon nao ve
select has_table_privilege('anon', 'public.beneficio_fechamento_mensal', 'SELECT');
-- Esperado: false

-- 7. Policies esperadas
select tablename, policyname
from pg_policies
where tablename in ('beneficio_fechamento_mensal', 'beneficio_fechamento_linha')
order by tablename, policyname;
-- Esperado: 4 policies em _mensal (sel, ins, upd, del) + 4 em _linha (sel admin_rh, sel proprio, ins, del)
```

- [ ] **Step 1.14 — Verificação dos Review Focus (via MCP)**

Testa cada um dos 5 pontos do §Review Focus com SQL direto. Para rodar com role `authenticated`, usar `set local role authenticated` após `set local request.jwt.claims` com um sub conhecido.

```sql
-- Pre: criar um fechamento de teste
insert into public.beneficio_fechamento_mensal (tenant_id, ano, mes, fechado_por)
values (
  (select id from public.tenants limit 1),
  2024, 1,
  (select id from public.perfis limit 1)
) returning id as fechamento_teste_id;
-- Guarde o UUID retornado como :fechamento_teste

-- Review 1: Reabrir fechamento some da view
insert into public.beneficio_fechamento_linha (
  tenant_id, fechamento_id, colaborador_beneficio_id, colaborador_id, beneficio_id,
  beneficio_nome, beneficio_operadora, beneficio_tipo, modo_custeio,
  valor_titular, valor_dependentes_total, valor_integral, valor_empresa, valor_colaborador
)
select
  (select id from public.tenants limit 1), :fechamento_teste,
  (select id from public.colaborador_beneficio limit 1),
  (select colaborador_id from public.colaborador_beneficio limit 1),
  (select beneficio_id from public.colaborador_beneficio limit 1),
  'Teste', 'Teste', 'saude', 'rateado',
  100.00, 0.00, 100.00, 60.00, 40.00;

select count(*) from public.vw_dre_despesa_pessoal_ajustada_mensal where ano = 2024 and mes = 1;
-- Esperado: 1

update public.beneficio_fechamento_mensal set reaberto_em = now(), reaberto_por = fechado_por where id = :fechamento_teste;
select count(*) from public.vw_dre_despesa_pessoal_ajustada_mensal where ano = 2024 and mes = 1;
-- Esperado: 0

-- Review 2: Check de soma deve rejeitar
insert into public.beneficio_fechamento_linha (
  tenant_id, fechamento_id, colaborador_beneficio_id, colaborador_id, beneficio_id,
  beneficio_nome, beneficio_operadora, beneficio_tipo, modo_custeio,
  valor_titular, valor_dependentes_total, valor_integral, valor_empresa, valor_colaborador
)
values (
  (select id from public.tenants limit 1), :fechamento_teste,
  (select id from public.colaborador_beneficio limit 1),
  (select colaborador_id from public.colaborador_beneficio limit 1),
  (select beneficio_id from public.colaborador_beneficio limit 1),
  'X', 'X', 'saude', 'rateado',
  100.00, 0.00, 100.00, 99.00, 2.00  -- 99+2=101, integral=100
);
-- Esperado: ERROR chk_fechamento_linha_soma

-- Review 3: Unique de competencia
insert into public.beneficio_fechamento_mensal (tenant_id, ano, mes, fechado_por)
values (
  (select id from public.tenants limit 1), 2024, 1,
  (select id from public.perfis limit 1)
);
-- Esperado: ERROR uq_fechamento_tenant_competencia

-- Review 4: UPDATE em _linha deve falhar sem privilégio
-- (precisa simular role authenticated — ver abaixo)
set local role authenticated;
update public.beneficio_fechamento_linha set valor_titular = 999.99 where fechamento_id = :fechamento_teste;
reset role;
-- Esperado: ERROR permission denied for table beneficio_fechamento_linha

-- Review 5: Policy colaborador_proprio nao vaza linha de outros
-- (requer simular JWT de um colaborador; se nao houver dado real suficiente,
--  deixar documentado em §observacao da sessao que o teste rolou via UI em Fase 3)

-- Limpeza
delete from public.beneficio_fechamento_mensal where id = :fechamento_teste;
```

Todos os 5 pontos passam → prosseguir. Qualquer um falhar → parar, investigar e consertar antes de commitar.

- [ ] **Step 1.15 — Atualizar `lib/types.ts`**

Adicionar ao final do arquivo (ou dentro do bloco de tipos de benefícios, se existir):

```ts
export type BeneficioFechamentoMensal = {
  id: string
  tenant_id: string
  ano: number
  mes: number
  fechado_em: string
  fechado_por: string
  reaberto_em: string | null
  reaberto_por: string | null
  observacao: string | null
}

export type BeneficioFechamentoLinha = {
  id: string
  tenant_id: string
  fechamento_id: string
  colaborador_beneficio_id: string
  colaborador_id: string
  beneficio_id: string
  beneficio_nome: string
  beneficio_operadora: string
  beneficio_tipo: 'saude' | 'dental'
  modo_custeio: 'rateado' | 'integral_empresa' | 'integral_empresa_com_upgrade'
  valor_titular: number
  valor_dependentes_total: number
  valor_integral: number
  valor_empresa: number
  valor_colaborador: number
  qtd_dependentes_na_competencia: number
  created_at: string
}

export type DreDespesaPessoalAjustadaMensal = {
  tenant_id: string
  ano: number
  mes: number
  valor_bruto_beneficios: number
  valor_dre_beneficios: number
  valor_dre_pessoal_ajuste: number
}
```

- [ ] **Step 1.16 — Atualizar `CLAUDE.md`**

Adicionar logo abaixo da seção "Planilhas: cor e grade" (ou outra transversal apropriada):

```markdown
## DRE de pessoal e benefícios (regra transversal)

**Toda query de DRE que toca Despesa com Pessoal ou Benefícios DEVE consumir `vw_dre_despesa_pessoal_ajustada_mensal`**, nunca `contas_avulsas` direto.

A view faz o ajuste de repasse do colaborador conforme ADR 174 (opção B.3): a avulsa da operadora é lançada com valor cheio em "Benefícios"; a view separa a parte empresa (fica em Benefícios 05.002) da parte colaborador (soma em Despesa com Pessoal 05.015).

Ignorar a view = DRE infla a conta de Benefícios em ~R$ 54 mil/mês e subavalia a conta de Pessoal no mesmo valor. Ver `docs/decisions/174-beneficios-integracao-folha-e-dre.md`.
```

- [ ] **Step 1.17 — tsc + lint + build**

```bash
pnpm tsc --noEmit
pnpm lint
pnpm build
```

Esperado: tudo verde. Build deve rodar porque `lib/types.ts` muda mas nenhuma UI referencia os tipos novos ainda.

- [ ] **Step 1.18 — Commit único (migration + types + CLAUDE.md)**

```bash
git add supabase/migrations/20261014000001_beneficios_fase2_fechamento.sql lib/types.ts CLAUDE.md
git commit -m "feat(rh/beneficios): Fase 2 — infra de fechamento mensal

- 2 tabelas novas (beneficio_fechamento_mensal, beneficio_fechamento_linha)
- 2 colunas em beneficios (dia_vencimento_fatura, vencimento_mes_seguinte) + seed
- Funcao fn_beneficios_calcular_fechamento (cálculo puro, sem gravar)
- View vw_dre_despesa_pessoal_ajustada_mensal (ADR 174 opção B.3)
- Policies RLS iguais às de Fase 1; UPDATE em _linha propositalmente ausente
- Zero UI — tab Fechamentos entra na Fase 3

Spec: docs/modulos/rh/53-beneficios-fechamento-mensal.md
ADR: docs/decisions/174-beneficios-integracao-folha-e-dre.md
Plano: docs/modulos/rh/55-beneficios-fase-2-plano-de-execucao.md"
```

**Importante:** push é manual. Não executar `git push`. Avisar o usuário que o commit está pronto local pra push manual.

---

## 5. Critérios de conclusão da Fase 2

Fase 2 está pronta quando **todos** os seguintes forem verdadeiros:

- [ ] Migration aplicada em produção via MCP (Step 1.12).
- [ ] Checklist §6 do spec todo verde (Steps 1.13 e 1.14).
- [ ] `lib/types.ts` com os 3 tipos novos (Step 1.15).
- [ ] `CLAUDE.md` com a linha nova sobre a view (Step 1.16).
- [ ] `tsc`, `lint` e `build` limpos (Step 1.17).
- [ ] Commit único em `main` (Step 1.18).
- [ ] Nenhuma UI tocada em `app/**` ou `components/**`.
- [ ] Push **não** executado (manual).

## 6. O que vem depois (fora deste plano)

- **Precondição manual**: cadastrar SulAmerica + Bradesco Dental como fornecedores em `/financeiro/fornecedores` (pela Kika ou via migration de seed, decidir no início da Fase 3).
- **Fase 3**: botão "Aplicar descontos" na página da competência da folha + tab "Fechamentos" read-only em `/rh/beneficios` + coluna `contas_avulsas.beneficio_fechamento_id` + coluna `folhas_pagamento.desconto_beneficios` + server actions `aplicarBeneficios` / `desaplicarBeneficios`. Spec detalhado será escrito em `docs/modulos/rh/54-beneficios-integracao-folha.md`.
- **Fase 4**: tela de DRE lendo `vw_dre_despesa_pessoal_ajustada_mensal` via `vw_dre_mensal` mestra (UNION ALL de agregadoras por natureza). Fora de qualquer prazo pactuado.
