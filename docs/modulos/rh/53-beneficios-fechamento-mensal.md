# 53 — Benefícios: Fechamento Mensal (Fase 2)

> Spec detalhado da Fase 2 do subsistema de Benefícios. Continua [`50-beneficios.md`](50-beneficios.md) e implementa a arquitetura decidida em [ADR 174](../../decisions/174-beneficios-integracao-folha-e-dre.md).

**Status:** aprovado em 2026-10-14. Aguarda implementação.
**Decisões origem:** ADR 174 (§1.1, §1.7, §2) + brainstorm 14/10 (P1, P2, P3 abaixo).
**Entrada:** Fase 1 em produção (catálogo, dependentes, vínculos, visualização ao vivo).
**Saída:** infraestrutura para que a Fase 3 ("Aplicar descontos" na folha) possa congelar competências e alimentar o DRE.

---

## 1. O que a Fase 2 entrega

**Fase 2 é 100% infra.** Zero UI nova. Depois dela:

- Existem tabelas para armazenar o **snapshot** de uma competência fechada (quem contribuiu com quanto, por benefício, por operadora).
- Existem colunas em `beneficios` guardando o **dia de vencimento** da fatura de cada operadora.
- Existe a **view do DRE** que lê do snapshot para ajustar o repasse do colaborador (opção B.3 do ADR).
- Nenhuma competência está fechada ainda — o preenchimento das tabelas acontece **na Fase 3**, pela ação "Aplicar descontos" na página da competência da folha.

Fase 2 não desenha tela de "Fechamentos" nem botão de "Fechar competência". A tab "Fechamentos" em `/rh/beneficios` (read-only) entra junto com a Fase 3, quando houver fechamento para listar.

**Motivo:** o ADR 174 §1.1 define "Aplicar descontos" como ação única que já inclui fechar competência. Ter botão separado em `/rh/beneficios` criaria dois pontos de verdade e permitiria estado inconsistente (fechar aqui, depois incluir dependente, depois Aplicar na folha — qual snapshot vale?).

---

## 2. Decisões adicionais travadas no brainstorm (14/10)

- **P1 — Reabrir fechamento:** permitido só se **nenhuma avulsa foi gerada** a partir daquele fechamento. Como Fase 2 não gera avulsa (isso é Fase 3), em Fase 2 reabrir é sempre livre; a trava real nasce com a Fase 3 via FK `contas_avulsas.beneficio_fechamento_id`.
- **P2 — Ajustes manuais no snapshot:** proibidos. O snapshot é **cálculo puro** no momento do fechamento. Divergência com fatura real da operadora é resolvida na Fase 3 editando a avulsa (não o snapshot).
- **P3 — UI do fechamento:** só na Fase 3, atrelada ao botão "Aplicar descontos" na folha. Tab "Fechamentos" em `/rh/beneficios` entra junto, read-only.

---

## 3. Modelo de dados

### 3.1 Tabela `beneficio_fechamento_mensal` (cabeçalho)

Uma linha por competência fechada (independente de quantas operadoras existam).

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
```

**Regras:**
- Unique `(tenant_id, ano, mes)` garante um snapshot por competência.
- `reaberto_em` / `reaberto_por` ficam preenchidos quando a competência é desaplicada (Fase 3). Enquanto `reaberto_em is null`, o fechamento está vigente.
- Nenhum campo armazena valor total; totais são agregações do detalhe (view ou query).

### 3.2 Tabela `beneficio_fechamento_linha` (detalhe)

Uma linha por `colaborador_beneficio` ativo na competência fechada. Congela **todos** os campos usados no cálculo, para que mudanças futuras no catálogo ou nos vínculos não afetem a competência fechada.

```sql
create table public.beneficio_fechamento_linha (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  fechamento_id uuid not null references public.beneficio_fechamento_mensal(id) on delete cascade,

  colaborador_beneficio_id uuid not null references public.colaborador_beneficio(id) on delete restrict,
  colaborador_id uuid not null references public.colaboradores(id) on delete restrict,
  beneficio_id uuid not null references public.beneficios(id) on delete restrict,

  -- Snapshot do catálogo no momento do fechamento
  beneficio_nome text not null,
  beneficio_operadora text not null,
  beneficio_tipo public.beneficio_tipo not null,

  -- Snapshot do vínculo
  modo_custeio public.beneficio_modo_custeio not null,

  -- Valores calculados
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
```

**Regras:**
- `on delete cascade` do fechamento_id: desaplicar fechamento (Fase 3) apaga todas as linhas.
- Campos de snapshot (`beneficio_nome`, `beneficio_operadora`, `modo_custeio`) são copiados do catálogo/vínculo no momento do fechamento. Depois disso, mudar o catálogo não afeta o snapshot.
- Check de soma garante consistência: `empresa + colaborador = integral`, tolerância R$ 0,01 para arredondamento.
- `qtd_dependentes_na_competencia` é informacional (facilita conferência da fatura).

### 3.3 Colunas novas em `beneficios`

```sql
alter table public.beneficios
  add column dia_vencimento_fatura int check (dia_vencimento_fatura between 1 and 31),
  add column vencimento_mes_seguinte boolean not null default true;
```

**Seed inicial** (via UPDATE no fim da migration):
- `SulAmerica Direto` / `SulAmerica Especial` → `dia_vencimento_fatura = 5`, `vencimento_mes_seguinte = true`
- `Bradesco Dental` → `dia_vencimento_fatura = 29`, `vencimento_mes_seguinte = true`

Lógica: se competência=outubro/2026 e `dia=5, mes_seguinte=true`, a avulsa gerada na Fase 3 tem vencimento `2026-11-05`. Configurável por benefício (não hardcoded em código).

### 3.4 View `vw_dre_despesa_pessoal_ajustada_mensal`

Core do DRE opção B.3 do ADR 174. **Criada já na Fase 2**, mesmo antes de qualquer DRE existir, para servir de âncora documental.

```sql
create view public.vw_dre_despesa_pessoal_ajustada_mensal as
with repasse_por_competencia as (
  select
    f.tenant_id,
    f.ano,
    f.mes,
    sum(l.valor_colaborador) as repasse_total
  from public.beneficio_fechamento_mensal f
  join public.beneficio_fechamento_linha l on l.fechamento_id = f.id
  where f.reaberto_em is null
  group by f.tenant_id, f.ano, f.mes
)
select
  f.tenant_id,
  f.ano,
  f.mes,
  -- Valor bruto que iria pra conta "Benefícios" (05.002) somando avulsas cheias
  coalesce(sum(l.valor_integral), 0) as valor_bruto_beneficios,
  -- Valor ajustado: parte empresa só (05.002 real do DRE)
  coalesce(sum(l.valor_empresa), 0) as valor_dre_beneficios,
  -- Repasse: parte colaborador que soma de volta em "Despesa com Pessoal" (05.015 ou equivalente)
  coalesce(sum(l.valor_colaborador), 0) as valor_dre_pessoal_ajuste
from public.beneficio_fechamento_mensal f
join public.beneficio_fechamento_linha l on l.fechamento_id = f.id
where f.reaberto_em is null
group by f.tenant_id, f.ano, f.mes;

comment on view public.vw_dre_despesa_pessoal_ajustada_mensal is
  'Ajuste do DRE para benefícios conforme ADR 174 (opção B.3). A avulsa de operadora entra no banco com valor cheio no subtipo "Benefícios"; esta view permite ao DRE separar: valor_dre_beneficios (parte empresa, despesa real do subtipo Benefícios) e valor_dre_pessoal_ajuste (repasse do colaborador, soma em Despesa com Pessoal). Fonte-verdade: docs/decisions/174-beneficios-integracao-folha-e-dre.md.';
```

**Nota:** a view ignora fechamentos reabertos (`reaberto_em is not null`). Isso garante que uma competência desaplicada some do DRE até ser reaplicada.

### 3.5 RLS e GRANTs

Padrão idêntico ao resto de Benefícios Fase 1:

```sql
alter table public.beneficio_fechamento_mensal enable row level security;
alter table public.beneficio_fechamento_linha enable row level security;

-- SELECT: admin, RH e colaborador (vê o próprio em linha; não vê cabeçalho)
create policy "sel_fechamento_mensal_admin_rh"
  on public.beneficio_fechamento_mensal for select
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "sel_fechamento_linha_admin_rh"
  on public.beneficio_fechamento_linha for select
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "sel_fechamento_linha_colaborador_proprio"
  on public.beneficio_fechamento_linha for select
  using (public.is_colaborador_proprio(colaborador_id));

-- INSERT/UPDATE/DELETE: só admin e RH (vai nascer da Fase 3 via server action)
create policy "ins_fechamento_mensal_admin_rh"
  on public.beneficio_fechamento_mensal for insert
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "upd_fechamento_mensal_admin_rh"
  on public.beneficio_fechamento_mensal for update
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "del_fechamento_mensal_admin_rh"
  on public.beneficio_fechamento_mensal for delete
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "ins_fechamento_linha_admin_rh"
  on public.beneficio_fechamento_linha for insert
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

create policy "del_fechamento_linha_admin_rh"
  on public.beneficio_fechamento_linha for delete
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

-- Linha nunca é atualizada: snapshot é imutável. Policy de UPDATE propositalmente ausente.

grant select, insert, update, delete on public.beneficio_fechamento_mensal to authenticated;
grant select, insert, delete on public.beneficio_fechamento_linha to authenticated;
grant select on public.vw_dre_despesa_pessoal_ajustada_mensal to authenticated;
```

**Decisão deliberada:** `beneficio_fechamento_linha` **não aceita UPDATE** (nem via policy, nem via grant). Linha de snapshot é imutável — para corrigir, desaplicar a competência e aplicar de novo.

---

## 4. Função SQL de cálculo (Fase 2 cria, Fase 3 usa)

A Fase 3 vai chamar `fn_beneficios_calcular_fechamento(tenant_id, ano, mes)` para gerar as linhas do snapshot. Essa função é **cálculo puro**: dado um tenant e uma competência, retorna uma `setof` com todos os campos que vão virar `beneficio_fechamento_linha`, sem gravar nada.

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
  -- Reusa a lógica de fn_beneficios_custo_mensal mas iterando por todos
  -- os colaborador_beneficio ativos na competência (iniciado <= último dia da competência
  -- E (encerrado is null OR encerrado > primeiro dia da competência))
  -- ... (corpo completo escrito na migration; omitido aqui por brevidade)
$$;

comment on function public.fn_beneficios_calcular_fechamento is
  'Calcula o snapshot da competência (ano, mes) para o tenant. Retorna uma linha por colaborador_beneficio ativo. Fase 3 insere o resultado em beneficio_fechamento_linha dentro de uma transação com beneficio_fechamento_mensal.';
```

**Nota de implementação:** a função reaproveita a lógica de `fn_beneficios_custo_mensal` (idade na competência, modos de custeio, dependentes vigentes). A sessão de implementação da Fase 2 precisa extrair a lógica de cálculo numa CTE compartilhada ou duplicar com cuidado — a decisão fica para o momento da escrita da migration, com conferência MCP antes.

---

## 5. Ordem de migration (uma única, aditiva)

Arquivo: `supabase/migrations/2026MMDD000001_beneficios_fase2_fechamento.sql` (data real no momento da aplicação).

Dentro de `BEGIN; ... COMMIT;`:

1. `ALTER TABLE beneficios ADD COLUMN dia_vencimento_fatura` + `vencimento_mes_seguinte`.
2. `UPDATE beneficios SET dia_vencimento_fatura = ... WHERE operadora = ...` (SulAmerica=5, Bradesco=29).
3. `CREATE TABLE beneficio_fechamento_mensal` + unique + index.
4. `CREATE TABLE beneficio_fechamento_linha` + checks + índices.
5. `CREATE FUNCTION fn_beneficios_calcular_fechamento`.
6. `CREATE VIEW vw_dre_despesa_pessoal_ajustada_mensal` + `COMMENT ON VIEW`.
7. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` nas duas novas.
8. `CREATE POLICY ...` (6 policies).
9. `GRANT ...` (select/insert/update/delete conforme §3.5).
10. `COMMENT ON ...` em tabelas e colunas-chave.

Migration 100% aditiva. Zero mudança destrutiva. Zero backfill.

---

## 6. Verificação pós-migration (via MCP)

- [ ] `list_tables` mostra `beneficio_fechamento_mensal` e `beneficio_fechamento_linha` com RLS enabled.
- [ ] `execute_sql` em `select * from beneficios where dia_vencimento_fatura is null` → 0 linhas.
- [ ] `execute_sql` em `select * from vw_dre_despesa_pessoal_ajustada_mensal` → vazio (nenhum fechamento ainda), sem erro.
- [ ] `execute_sql` em `select public.fn_beneficios_calcular_fechamento('<tenant_uuid>', 2026, 10)` → retorna linhas condizentes com `fn_beneficios_custo_mensal` da Fase 1 (comparação ponto a ponto).
- [ ] `select has_table_privilege('authenticated', 'beneficio_fechamento_linha', 'UPDATE')` → `false`.
- [ ] `select has_table_privilege('anon', 'beneficio_fechamento_mensal', 'SELECT')` → `false`.
- [ ] Policies listadas via `pg_policies` conferem com §3.5.

---

## 7. TypeScript / tipos (`lib/types.ts`)

Adicionar à mão depois da migration aplicada:

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
```

Nenhum uso dessas tipagens em UI na Fase 2 (zero UI). Elas ficam esperando a Fase 3.

---

## 8. Nota no CLAUDE.md (ao final da Fase 2)

Adicionar na seção de regras transversais:

> **DRE de Despesa com Pessoal / Benefícios:** sempre consumir `vw_dre_despesa_pessoal_ajustada_mensal`. O repasse do colaborador foi ajustado nessa view (sai de "Benefícios", soma em "Despesa com Pessoal"). Ver ADR 174.

Essa linha é a 4ª âncora citada no ADR 174 §3.

---

## 9. O que fica fora da Fase 2

- **Qualquer UI** — tab Fechamentos entra na Fase 3.
- **Botão "Aplicar descontos"** — Fase 3.
- **Server actions** (`aplicarBeneficios`, `desaplicarBeneficios`) — Fase 3.
- **Coluna `contas_avulsas.beneficio_fechamento_id`** — Fase 3 (FK só faz sentido quando a avulsa é criada).
- **Coluna `folhas_pagamento.desconto_beneficios`** — Fase 3.
- **Cadastro de SulAmerica/Bradesco como fornecedores** — precondição manual antes da Fase 3.
- **Reconciliação automática com fatura real** — fora de escopo (ADR 174 §5).

---

## 10. Critério de pronto

Fase 2 está pronta quando:

- [ ] Migration aplicada em produção via MCP.
- [ ] Checklist §6 todo verde.
- [ ] `lib/types.ts` atualizado no mesmo commit.
- [ ] Linha no `CLAUDE.md` adicionada.
- [ ] Commit único em `main`, mensagem referenciando ADR 174 e este spec.
- [ ] Nenhuma UI tocada.
