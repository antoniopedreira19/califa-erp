# 51 — Modelo de Dados do Subsistema Benefícios

> Spec detalhada do banco para o subsistema Benefícios — Fase 1 (fundação + visualização). Precede migrations. Decisões rastreadas em [`50-beneficios.md`](50-beneficios.md) §8 (B1–B16).
>
> Convenções herdadas de [`03-modelo-de-dados.md`](03-modelo-de-dados.md), [`26-ferias-modelo-de-dados.md`](26-ferias-modelo-de-dados.md) e [`docs/FLUXO-BANCO.md`](../../FLUXO-BANCO.md). Em particular:
> - RLS obrigatória com policies usando `(select auth.uid())`.
> - GRANT explícito pra `authenticated` (RLS ≠ GRANT).
> - FKs com `on delete restrict` por padrão (exceto onde faz sentido cascade).
> - Índice em FK que aparece em filtro comum.
> - `comment on table/column` para semântica não-óbvia.
> - Helper `is_colaborador_proprio(uuid)` já existe desde Férias — reusado aqui.

## 1. Enums novos

```sql
-- Tipo do benefício. Extensível para vale_transporte, vale_refeicao, seguro_vida, outros no futuro.
create type public.beneficio_tipo as enum (
  'saude',
  'dental'
);

-- Modelo de precificação. 'faixa_etaria' lê de beneficio_faixas_preco; 'flat' lê de beneficios.valor_flat.
create type public.beneficio_modelo_preco as enum (
  'faixa_etaria',
  'flat'
);

-- Modo de custeio do titular. Dependente é sempre 100% colaborador (via catálogo).
create type public.beneficio_modo_custeio as enum (
  'rateado',                       -- empresa paga percentual_empresa_titular; colab paga o resto
  'integral_empresa',              -- empresa paga 100% do titular
  'integral_empresa_com_upgrade'   -- empresa paga valor do beneficio_base_id; colab paga a diferença
);
```

## 2. Tabela `beneficios`

Catálogo tenant-wide de benefícios oferecidos. 3 linhas no seed inicial.

### 2.1 DDL

```sql
create table public.beneficios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  nome text not null,
  operadora text not null,
  tipo public.beneficio_tipo not null,
  modelo_preco public.beneficio_modelo_preco not null,
  -- Rateio padrão aplicado quando modo_custeio = 'rateado'. Valores guardados como int 0-100.
  percentual_empresa_titular int not null default 60
    check (percentual_empresa_titular between 0 and 100),
  percentual_colaborador_dependentes int not null default 100
    check (percentual_colaborador_dependentes between 0 and 100),
  -- Preenchido apenas quando modelo_preco = 'flat'. Para 'faixa_etaria', permanece NULL.
  valor_flat numeric(10, 2),
  -- Link para benefício "base" usado no cálculo do modo_custeio 'integral_empresa_com_upgrade'.
  -- Especial aponta pra Direto; benefício base aponta pra NULL.
  beneficio_base_id uuid references public.beneficios(id) on delete restrict,
  codigo_externo text,  -- código do plano na operadora (ex: '495535238', '496505231'). Opcional.
  ativo boolean not null default true,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Coerência: flat exige valor_flat; faixa_etaria proíbe valor_flat.
  constraint chk_beneficios_modelo_flat
    check (
      (modelo_preco = 'flat' and valor_flat is not null)
      or (modelo_preco = 'faixa_etaria' and valor_flat is null)
    ),
  -- Benefício não pode ser base de si mesmo.
  constraint chk_beneficios_base_nao_cicla
    check (beneficio_base_id is null or beneficio_base_id != id)
);

create index idx_beneficios_tenant on public.beneficios (tenant_id);
create index idx_beneficios_base on public.beneficios (beneficio_base_id)
  where beneficio_base_id is not null;

comment on table public.beneficios is
  'Catalogo de beneficios oferecidos pela California. Fase 1 nasce com 3 linhas: SulAmerica Direto, SulAmerica Especial, Bradesco Dental. Extensivel para vale-transporte, GymPass etc. sem migration adicional.';
comment on column public.beneficios.beneficio_base_id is
  'Benefício "base" usado no cálculo do modo integral_empresa_com_upgrade. Especial aponta pra Direto. Benefício base aponta pra NULL.';
comment on column public.beneficios.valor_flat is
  'Preco mensal quando modelo_preco=flat. Para faixa_etaria, ler beneficio_faixas_preco.';
comment on column public.beneficios.percentual_empresa_titular is
  'Percentual que a empresa paga do titular quando modo_custeio=rateado. Saude=60, dental=0.';
```

### 2.2 Trigger de `updated_at`

Usa helper `fn_set_updated_at()` já existente no banco (padrão em todas as tabelas, confirmado em `colaboradores_ferias_periodos` e outras).

```sql
create trigger trg_beneficios_updated_at
  before update on public.beneficios
  for each row execute function fn_set_updated_at();
```

## 3. Tabela `beneficio_faixas_preco`

Tabela de preços por faixa etária. Só para benefícios com `modelo_preco = 'faixa_etaria'`.

### 3.1 DDL

```sql
create table public.beneficio_faixas_preco (
  id uuid primary key default gen_random_uuid(),
  beneficio_id uuid not null references public.beneficios(id) on delete cascade,
  idade_min int not null check (idade_min >= 0),
  idade_max int check (idade_max is null or idade_max >= idade_min),  -- NULL = infinito (ex: "59 ou mais")
  valor numeric(10, 2) not null check (valor > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uniq_faixa_por_beneficio_min
    unique (beneficio_id, idade_min)
);

create index idx_faixas_beneficio on public.beneficio_faixas_preco (beneficio_id);

comment on table public.beneficio_faixas_preco is
  'Tabela de precos por faixa etaria para beneficios de saude. Ultima faixa aberta a direita (idade_max IS NULL).';
comment on column public.beneficio_faixas_preco.idade_max is
  'NULL representa "sem limite superior" (ex: faixa 59+). Resolucao da faixa usa idade_max IS NULL OR idade <= idade_max.';
```

### 3.2 Trigger de `updated_at`

```sql
create trigger trg_beneficio_faixas_preco_updated_at
  before update on public.beneficio_faixas_preco
  for each row execute function fn_set_updated_at();
```

### 3.3 Observação sobre overlapping

Validação de faixas que se sobrepõem no mesmo benefício (ex.: `0-18` e `15-23`) **não** é feita por constraint — é responsabilidade da UI de catálogo. Motivo: constraint de intervalo em Postgres é verbosa (requer `GIST` + `btree_gist`), e a UI valida bem antes do insert. Se virar problema, adicionamos exclusion constraint depois.

## 4. Tabela `dependentes`

Cadastro de dependentes como pessoas. Separado do vínculo com benefício específico.

### 4.1 DDL

```sql
create table public.dependentes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  colaborador_id uuid not null references public.colaboradores(id) on delete restrict,
  nome text not null,
  cpf text not null,
  data_nascimento date not null check (data_nascimento <= current_date),
  parentesco text not null,  -- livre no MVP: 'conjuge', 'filho', 'filha', 'pai', 'mae', 'irmao', 'irma', 'outro'
  ativo boolean not null default true,
  data_inicio date not null default current_date,
  data_fim date,  -- null = ativo. Preenchido quando dep sai (divórcio, maioridade, falecimento).
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_dep_datas check (data_fim is null or data_fim >= data_inicio),
  constraint uniq_dep_cpf_tenant unique (tenant_id, cpf)
);

create index idx_dependentes_tenant on public.dependentes (tenant_id);
create index idx_dependentes_colaborador on public.dependentes (colaborador_id);
create index idx_dependentes_ativo on public.dependentes (colaborador_id)
  where ativo = true and data_fim is null;

comment on table public.dependentes is
  'Dependentes dos colaboradores. Entidade de pessoa (nome, CPF, data_nasc). Em quais beneficios cada um esta incluido fica em colaborador_beneficio_dependente.';
comment on column public.dependentes.data_fim is
  'Null = ativo. Preenchido quando dependente sai (divorcio, maioridade, falecimento). Nao deletar — mantem historico.';
```

### 4.2 Trigger de `updated_at`

```sql
create trigger trg_dependentes_updated_at
  before update on public.dependentes
  for each row execute function fn_set_updated_at();
```

## 5. Tabela `colaborador_beneficio`

Vínculo entre colaborador (titular) e benefício. Linha nova a cada mudança de modo de custeio.

### 5.1 DDL

```sql
create table public.colaborador_beneficio (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  colaborador_id uuid not null references public.colaboradores(id) on delete restrict,
  beneficio_id uuid not null references public.beneficios(id) on delete restrict,
  modo_custeio public.beneficio_modo_custeio not null default 'rateado',
  data_inicio date not null,
  data_fim date,  -- null = vigente
  observacao text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_vinculo_datas check (data_fim is null or data_fim >= data_inicio)
);

create index idx_vinculo_tenant on public.colaborador_beneficio (tenant_id);
create index idx_vinculo_colab on public.colaborador_beneficio (colaborador_id);
create index idx_vinculo_beneficio on public.colaborador_beneficio (beneficio_id);

-- No maximo 1 vinculo ativo por (colaborador, beneficio).
create unique index uniq_vinculo_ativo_colab_beneficio
  on public.colaborador_beneficio (colaborador_id, beneficio_id)
  where data_fim is null;

comment on table public.colaborador_beneficio is
  'Vinculo colaborador x beneficio. Linha nova a cada mudanca de modo de custeio (fecha a anterior preenchendo data_fim).';
```

### 5.2 Trigger de `updated_at`

```sql
create trigger trg_colaborador_beneficio_updated_at
  before update on public.colaborador_beneficio
  for each row execute function fn_set_updated_at();
```

### 5.3 Validação: `integral_empresa_com_upgrade` exige base

Trigger `fn_valida_upgrade_requer_base` garante que modo `integral_empresa_com_upgrade` só é aceito em vínculos cujo `beneficio_id` tem `beneficio_base_id IS NOT NULL`.

```sql
create or replace function public.fn_valida_upgrade_requer_base()
returns trigger
language plpgsql
as $$
declare
  v_base_id uuid;
begin
  if new.modo_custeio = 'integral_empresa_com_upgrade' then
    select beneficio_base_id into v_base_id
      from public.beneficios
     where id = new.beneficio_id;
    if v_base_id is null then
      raise exception 'modo_custeio integral_empresa_com_upgrade exige beneficio com beneficio_base_id definido (beneficio_id=%)',
        new.beneficio_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_vinculo_valida_upgrade
  before insert or update on public.colaborador_beneficio
  for each row execute function public.fn_valida_upgrade_requer_base();
```

## 6. Tabela `colaborador_beneficio_dependente`

Qual dependente está incluído em qual vínculo. Permite dep na SulAmérica mas não no Dental.

### 6.1 DDL

```sql
create table public.colaborador_beneficio_dependente (
  id uuid primary key default gen_random_uuid(),
  colaborador_beneficio_id uuid not null
    references public.colaborador_beneficio(id) on delete cascade,
  dependente_id uuid not null references public.dependentes(id) on delete restrict,
  data_inicio date not null,
  data_fim date,  -- null = ativo nesse vinculo
  created_at timestamptz not null default now(),

  constraint chk_dep_vinc_datas check (data_fim is null or data_fim >= data_inicio)
);

create index idx_cbd_vinculo on public.colaborador_beneficio_dependente (colaborador_beneficio_id);
create index idx_cbd_dependente on public.colaborador_beneficio_dependente (dependente_id);

-- No maximo 1 inclusao ativa de um mesmo dependente num mesmo vinculo.
create unique index uniq_cbd_ativo
  on public.colaborador_beneficio_dependente (colaborador_beneficio_id, dependente_id)
  where data_fim is null;

comment on table public.colaborador_beneficio_dependente is
  'Qual dependente esta incluido em qual vinculo colaborador-beneficio. Um dep pode estar em um beneficio sem estar em outro.';
```

## 7. Função `fn_beneficios_custo_mensal`

Cálculo derivado do custo mensal por colaborador. Fase 1 não persiste snapshot — tudo recalculado on-demand.

### 7.1 Assinatura e retorno

```sql
create or replace function public.fn_beneficios_custo_mensal(
  p_ano int,
  p_mes int,
  p_colaborador_id uuid
)
returns table (
  vinculo_id uuid,
  beneficio_id uuid,
  beneficio_nome text,
  beneficio_tipo public.beneficio_tipo,
  modo_custeio public.beneficio_modo_custeio,
  idade_titular int,
  valor_integral_titular numeric,
  valor_empresa_titular numeric,
  valor_colaborador_titular numeric,
  qtde_dependentes int,
  valor_dependentes_total numeric,
  valor_desconto_folha_total numeric
)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
declare
  v_data_competencia date;
begin
  v_data_competencia := make_date(p_ano, p_mes, 1);

  return query
  with vinculos_ativos as (
    select cb.*
      from public.colaborador_beneficio cb
     where cb.colaborador_id = p_colaborador_id
       and cb.data_inicio <= (v_data_competencia + interval '1 month' - interval '1 day')::date
       and (cb.data_fim is null or cb.data_fim >= v_data_competencia)
  ),
  calc_titular as (
    select
      va.id as vinculo_id,
      va.beneficio_id,
      va.modo_custeio,
      b.nome as beneficio_nome,
      b.tipo as beneficio_tipo,
      b.modelo_preco,
      b.valor_flat,
      b.percentual_empresa_titular,
      b.beneficio_base_id,
      extract(year from age(v_data_competencia, c.data_nascimento))::int as idade_titular,
      case
        when b.modelo_preco = 'flat' then b.valor_flat
        else (
          select bfp.valor
            from public.beneficio_faixas_preco bfp
           where bfp.beneficio_id = b.id
             and extract(year from age(v_data_competencia, c.data_nascimento))::int >= bfp.idade_min
             and (bfp.idade_max is null
                  or extract(year from age(v_data_competencia, c.data_nascimento))::int <= bfp.idade_max)
           limit 1
        )
      end as valor_integral_titular
    from vinculos_ativos va
    join public.beneficios b on b.id = va.beneficio_id
    join public.colaboradores c on c.id = p_colaborador_id
  ),
  calc_rateio_titular as (
    select
      ct.*,
      case
        when ct.modo_custeio = 'rateado' then
          round(ct.valor_integral_titular * ct.percentual_empresa_titular / 100.0, 2)
        when ct.modo_custeio = 'integral_empresa' then
          ct.valor_integral_titular
        when ct.modo_custeio = 'integral_empresa_com_upgrade' then
          -- Empresa paga valor equivalente ao beneficio base na mesma faixa.
          coalesce((
            select bfp.valor
              from public.beneficio_faixas_preco bfp
             where bfp.beneficio_id = ct.beneficio_base_id
               and ct.idade_titular >= bfp.idade_min
               and (bfp.idade_max is null or ct.idade_titular <= bfp.idade_max)
             limit 1
          ), 0)
      end as valor_empresa_titular
    from calc_titular ct
  ),
  calc_dependentes as (
    select
      va.id as vinculo_id,
      count(d.id)::int as qtde_dependentes,
      coalesce(sum(
        case
          when b.modelo_preco = 'flat' then b.valor_flat
          else (
            select bfp.valor
              from public.beneficio_faixas_preco bfp
             where bfp.beneficio_id = b.id
               and extract(year from age(v_data_competencia, d.data_nascimento))::int >= bfp.idade_min
               and (bfp.idade_max is null
                    or extract(year from age(v_data_competencia, d.data_nascimento))::int <= bfp.idade_max)
             limit 1
          )
        end
      ), 0) as valor_dependentes_total
    from vinculos_ativos va
    join public.beneficios b on b.id = va.beneficio_id
    left join public.colaborador_beneficio_dependente cbd
      on cbd.colaborador_beneficio_id = va.id
      and cbd.data_inicio <= (v_data_competencia + interval '1 month' - interval '1 day')::date
      and (cbd.data_fim is null or cbd.data_fim >= v_data_competencia)
    left join public.dependentes d on d.id = cbd.dependente_id and d.ativo
    group by va.id
  )
  select
    crt.vinculo_id,
    crt.beneficio_id,
    crt.beneficio_nome,
    crt.beneficio_tipo,
    crt.modo_custeio,
    crt.idade_titular,
    crt.valor_integral_titular,
    crt.valor_empresa_titular,
    (crt.valor_integral_titular - crt.valor_empresa_titular) as valor_colaborador_titular,
    coalesce(cd.qtde_dependentes, 0) as qtde_dependentes,
    coalesce(cd.valor_dependentes_total, 0) as valor_dependentes_total,
    ((crt.valor_integral_titular - crt.valor_empresa_titular) + coalesce(cd.valor_dependentes_total, 0))
      as valor_desconto_folha_total
  from calc_rateio_titular crt
  left join calc_dependentes cd on cd.vinculo_id = crt.vinculo_id;
end;
$$;

grant execute on function public.fn_beneficios_custo_mensal(int, int, uuid)
  to authenticated;

comment on function public.fn_beneficios_custo_mensal(int, int, uuid) is
  'Calcula o custo mensal de beneficios de um colaborador na competencia (p_ano, p_mes). Idade calculada no 1o dia do mes. Fase 1 Beneficios.';
```

### 7.2 Função agregada `fn_beneficios_custo_mensal_tenant`

Para alimentar os KPIs da página. Soma por tenant.

```sql
create or replace function public.fn_beneficios_custo_mensal_tenant(
  p_tenant_id uuid,
  p_ano int,
  p_mes int
)
returns table (
  qtde_vinculos_saude int,
  qtde_vinculos_dental int,
  custo_total_empresa numeric,
  custo_total_colaboradores numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with por_colaborador as (
    select
      c.id as colaborador_id,
      f.*
    from public.colaboradores c
    cross join lateral public.fn_beneficios_custo_mensal(p_ano, p_mes, c.id) f
    where c.tenant_id = p_tenant_id
      and c.status = 'ativo'
  )
  select
    count(*) filter (where beneficio_tipo = 'saude')::int as qtde_vinculos_saude,
    count(*) filter (where beneficio_tipo = 'dental')::int as qtde_vinculos_dental,
    coalesce(sum(valor_empresa_titular), 0) as custo_total_empresa,
    coalesce(sum(valor_desconto_folha_total), 0) as custo_total_colaboradores
  from por_colaborador;
$$;

grant execute on function public.fn_beneficios_custo_mensal_tenant(uuid, int, int)
  to authenticated;
```

## 8. RLS e GRANTs

Padrão idêntico a Férias.

```sql
-- Habilita RLS em todas
alter table public.beneficios enable row level security;
alter table public.beneficio_faixas_preco enable row level security;
alter table public.dependentes enable row level security;
alter table public.colaborador_beneficio enable row level security;
alter table public.colaborador_beneficio_dependente enable row level security;

-- GRANTs explicitos
grant select, insert, update, delete on public.beneficios to authenticated;
grant select, insert, update, delete on public.beneficio_faixas_preco to authenticated;
grant select, insert, update, delete on public.dependentes to authenticated;
grant select, insert, update, delete on public.colaborador_beneficio to authenticated;
grant select, insert, update, delete on public.colaborador_beneficio_dependente to authenticated;
-- Nada para anon.
```

### 8.1 Policies de `beneficios` (catálogo)

Admin + RH leem e escrevem. Colaborador lê (porque precisa ler nome/tipo do plano no próprio vínculo).

```sql
create policy beneficios_select on public.beneficios
  for select
  using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or exists (
      select 1 from public.colaborador_beneficio cb
       where cb.beneficio_id = beneficios.id
         and is_colaborador_proprio(cb.colaborador_id)
    )
  );

create policy beneficios_insert on public.beneficios
  for insert with check (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  );

create policy beneficios_update on public.beneficios
  for update
  using (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id))
  with check (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id));

create policy beneficios_delete on public.beneficios
  for delete
  using (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id));
```

### 8.2 Policies de `beneficio_faixas_preco`

Admin + RH escrevem. Qualquer `authenticated` do tenant lê (porque precisa pra renderizar valor no próprio vínculo).

```sql
create policy faixas_select on public.beneficio_faixas_preco
  for select using (
    exists (
      select 1 from public.beneficios b
       where b.id = beneficio_faixas_preco.beneficio_id
         and (
           is_tenant_admin(b.tenant_id)
           or is_tenant_rh(b.tenant_id)
           or exists (
             select 1 from public.colaborador_beneficio cb
              where cb.beneficio_id = b.id
                and is_colaborador_proprio(cb.colaborador_id)
           )
         )
    )
  );

create policy faixas_insert on public.beneficio_faixas_preco
  for insert with check (
    exists (
      select 1 from public.beneficios b
       where b.id = beneficio_faixas_preco.beneficio_id
         and (is_tenant_admin(b.tenant_id) or is_tenant_rh(b.tenant_id))
    )
  );

create policy faixas_update on public.beneficio_faixas_preco
  for update
  using (
    exists (
      select 1 from public.beneficios b
       where b.id = beneficio_faixas_preco.beneficio_id
         and (is_tenant_admin(b.tenant_id) or is_tenant_rh(b.tenant_id))
    )
  )
  with check (
    exists (
      select 1 from public.beneficios b
       where b.id = beneficio_faixas_preco.beneficio_id
         and (is_tenant_admin(b.tenant_id) or is_tenant_rh(b.tenant_id))
    )
  );

create policy faixas_delete on public.beneficio_faixas_preco
  for delete using (
    exists (
      select 1 from public.beneficios b
       where b.id = beneficio_faixas_preco.beneficio_id
         and (is_tenant_admin(b.tenant_id) or is_tenant_rh(b.tenant_id))
    )
  );
```

### 8.3 Policies de `dependentes`

Admin + RH tudo. Colaborador lê os próprios.

```sql
create policy dependentes_select on public.dependentes
  for select using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_colaborador_proprio(colaborador_id)
  );

create policy dependentes_insert on public.dependentes
  for insert with check (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  );

create policy dependentes_update on public.dependentes
  for update
  using (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id))
  with check (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id));

create policy dependentes_delete on public.dependentes
  for delete using (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  );
```

### 8.4 Policies de `colaborador_beneficio`

Admin + RH tudo. Colaborador lê o próprio vínculo.

```sql
create policy vinculo_select on public.colaborador_beneficio
  for select using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_colaborador_proprio(colaborador_id)
  );

create policy vinculo_insert on public.colaborador_beneficio
  for insert with check (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  );

create policy vinculo_update on public.colaborador_beneficio
  for update
  using (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id))
  with check (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id));

create policy vinculo_delete on public.colaborador_beneficio
  for delete using (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  );
```

### 8.5 Policies de `colaborador_beneficio_dependente`

Admin + RH tudo. Colaborador lê (via herança do próprio vínculo).

```sql
create policy cbd_select on public.colaborador_beneficio_dependente
  for select using (
    exists (
      select 1 from public.colaborador_beneficio cb
       where cb.id = colaborador_beneficio_dependente.colaborador_beneficio_id
         and (
           is_tenant_admin(cb.tenant_id)
           or is_tenant_rh(cb.tenant_id)
           or is_colaborador_proprio(cb.colaborador_id)
         )
    )
  );

create policy cbd_insert on public.colaborador_beneficio_dependente
  for insert with check (
    exists (
      select 1 from public.colaborador_beneficio cb
       where cb.id = colaborador_beneficio_dependente.colaborador_beneficio_id
         and (is_tenant_admin(cb.tenant_id) or is_tenant_rh(cb.tenant_id))
    )
  );

create policy cbd_update on public.colaborador_beneficio_dependente
  for update
  using (
    exists (
      select 1 from public.colaborador_beneficio cb
       where cb.id = colaborador_beneficio_dependente.colaborador_beneficio_id
         and (is_tenant_admin(cb.tenant_id) or is_tenant_rh(cb.tenant_id))
    )
  )
  with check (
    exists (
      select 1 from public.colaborador_beneficio cb
       where cb.id = colaborador_beneficio_dependente.colaborador_beneficio_id
         and (is_tenant_admin(cb.tenant_id) or is_tenant_rh(cb.tenant_id))
    )
  );

create policy cbd_delete on public.colaborador_beneficio_dependente
  for delete using (
    exists (
      select 1 from public.colaborador_beneficio cb
       where cb.id = colaborador_beneficio_dependente.colaborador_beneficio_id
         and (is_tenant_admin(cb.tenant_id) or is_tenant_rh(cb.tenant_id))
    )
  );
```

## 9. Seeds iniciais

Dentro da mesma migration. Rodam para o tenant Agência California.

### 9.1 Catálogo (3 benefícios)

```sql
-- Marcadores: usar DO block para capturar os IDs gerados e manter referência Especial → Direto.
do $$
declare
  v_tenant_id uuid;
  v_direto_id uuid;
  v_especial_id uuid;
begin
  select id into v_tenant_id
    from public.tenants
   where nome = 'Agência California'
   limit 1;
  if v_tenant_id is null then
    raise exception 'Seed de beneficios: tenant "Agência California" nao encontrado';
  end if;

  -- 1) SulAmerica Direto Nacional
  insert into public.beneficios
    (tenant_id, nome, operadora, tipo, modelo_preco, percentual_empresa_titular,
     percentual_colaborador_dependentes, codigo_externo)
    values
    (v_tenant_id, 'SulAmerica Direto Nacional', 'SulAmerica Saude', 'saude', 'faixa_etaria',
     60, 100, '496505231')
    returning id into v_direto_id;

  -- 2) SulAmerica Especial 100 (upgrade do Direto)
  insert into public.beneficios
    (tenant_id, nome, operadora, tipo, modelo_preco, percentual_empresa_titular,
     percentual_colaborador_dependentes, codigo_externo, beneficio_base_id)
    values
    (v_tenant_id, 'SulAmerica Especial 100', 'SulAmerica Saude', 'saude', 'faixa_etaria',
     60, 100, '495535238', v_direto_id)
    returning id into v_especial_id;

  -- 3) Bradesco Dental (flat)
  insert into public.beneficios
    (tenant_id, nome, operadora, tipo, modelo_preco, percentual_empresa_titular,
     percentual_colaborador_dependentes, valor_flat)
    values
    (v_tenant_id, 'Bradesco Dental', 'Bradesco Saude', 'dental', 'flat',
     0, 100, 13.00);

  -- Faixas de preço do Direto (10 linhas)
  insert into public.beneficio_faixas_preco (beneficio_id, idade_min, idade_max, valor) values
    (v_direto_id, 0, 18, 365.47),
    (v_direto_id, 19, 23, 456.84),
    (v_direto_id, 24, 28, 566.48),
    (v_direto_id, 29, 33, 628.80),
    (v_direto_id, 34, 38, 672.82),
    (v_direto_id, 39, 43, 780.46),
    (v_direto_id, 44, 48, 932.96),
    (v_direto_id, 49, 53, 1093.43),
    (v_direto_id, 54, 58, 1301.74),
    (v_direto_id, 59, null, 2192.77);

  -- Faixas de preço do Especial (9 linhas, começa em 19)
  insert into public.beneficio_faixas_preco (beneficio_id, idade_min, idade_max, valor) values
    (v_especial_id, 19, 23, 550.53),
    (v_especial_id, 24, 28, 682.65),
    (v_especial_id, 29, 33, 757.75),
    (v_especial_id, 34, 38, 810.79),
    (v_especial_id, 39, 43, 940.51),
    (v_especial_id, 44, 48, 1124.29),
    (v_especial_id, 49, 53, 1317.66),
    (v_especial_id, 54, 58, 1568.69),
    (v_especial_id, 59, null, 2642.45);
end $$;
```

Nenhum vínculo (`colaborador_beneficio`) é criado no seed — o import inicial dos vínculos reais vem numa migration posterior ou pela UI, caso-a-caso. Essa migration deixa só o catálogo em pé.

## 10. Auditoria

Eventos sensíveis registram linha em `audit_events` via helper existente `log_audit_event(p_acao text, p_tenant_id uuid, p_entidade_tipo text, p_entidade_id text, p_metadata jsonb)`. Chamadas disparadas pela server action, não por trigger (padrão Férias).

Ações (`p_acao`):
- `beneficio.vinculo.criado` — ao inserir em `colaborador_beneficio`
- `beneficio.vinculo.modo_alterado` — ao criar vínculo novo substituindo um anterior
- `beneficio.vinculo.encerrado` — ao preencher `data_fim`
- `beneficio.dependente.criado` — ao inserir em `dependentes`
- `beneficio.dependente.incluido_em_plano` — ao inserir em `colaborador_beneficio_dependente`
- `beneficio.dependente.removido_de_plano` — ao preencher `data_fim` em `colaborador_beneficio_dependente`
- `beneficio.catalogo.criado` / `beneficio.catalogo.editado` / `beneficio.faixa.editada` — para admin+rh editando o catálogo

Convenção: `p_entidade_tipo = 'colaborador_beneficio' | 'dependente' | 'colaborador_beneficio_dependente' | 'beneficio' | 'beneficio_faixas_preco'`. `p_entidade_id` recebe o UUID em `::text`. `p_metadata` carrega campos auxiliares como `colaborador_id`, `beneficio_id`, `modo_custeio_anterior`, `modo_custeio_novo`, `data_inicio`, `data_fim` — todas as strings em pt-BR seguindo a regra do CLAUDE.md para texto visível em consultas de auditoria.

## 11. Ordem da migration

Migration única: `20261006000001_beneficios_fundacao.sql`.

Ordem interna (importante por causa das FKs):

1. **Enums** (3): `beneficio_tipo`, `beneficio_modelo_preco`, `beneficio_modo_custeio`
2. **Tabela `beneficios`** + índices + comments + trigger `updated_at`
3. **Tabela `beneficio_faixas_preco`** + índices + trigger
4. **Tabela `dependentes`** + índices + trigger
5. **Tabela `colaborador_beneficio`** + índices + trigger + função + trigger de validação `integral_empresa_com_upgrade`
6. **Tabela `colaborador_beneficio_dependente`** + índices
7. **Função `fn_beneficios_custo_mensal`** + grant
8. **Função `fn_beneficios_custo_mensal_tenant`** + grant
9. **Enable RLS** nas 5 tabelas
10. **GRANTs** para `authenticated`
11. **Policies** (SELECT/INSERT/UPDATE/DELETE) para cada tabela
12. **Seed**: 3 benefícios no catálogo + 19 faixas de preço

Prefixo da migration: data da aplicação (ex.: `20261006000001`). Comentário no topo do arquivo explica o racional (Fase 1 do subsistema).

## 12. Validações pós-apply (checklist)

Após `apply_migration`, confirmar via MCP:

1. **Enums criados**: 3 novos tipos em `pg_type`.
2. **Tabelas criadas**: 5 novas em `information_schema.tables`.
3. **RLS enabled**: `rowsecurity = true` em todas em `pg_tables`.
4. **GRANTs**: `has_table_privilege('authenticated', 'public.beneficios', 'SELECT')` = true em todas.
5. **Zero GRANT para anon**: nenhuma linha com `grantee = 'anon'` em `information_schema.role_table_grants`.
6. **Policies criadas**: contagem em `pg_policy` bate (5 tabelas × 4 cmds = 20 policies).
7. **Funções criadas**: `fn_beneficios_custo_mensal` e `fn_beneficios_custo_mensal_tenant` em `pg_proc`.
8. **Seed aplicado**: `SELECT count(*) FROM beneficios` = 3 e `SELECT count(*) FROM beneficio_faixas_preco` = 19.
9. **Teste da função**: `SELECT * FROM fn_beneficios_custo_mensal(2026, 11, '<um_colaborador_id>')` retorna sem erro (deve retornar linha vazia se não houver vínculo ativo).

## 13. Compatibilidade com `lib/types.ts`

O arquivo `lib/types.ts` é escrito à mão (CLAUDE.md). A migration precisa vir acompanhada de atualização desse arquivo adicionando os tipos:

```ts
export type BeneficioTipo = 'saude' | 'dental'
export type BeneficioModeloPreco = 'faixa_etaria' | 'flat'
export type BeneficioModoCusteio = 'rateado' | 'integral_empresa' | 'integral_empresa_com_upgrade'

export type Beneficio = {
  id: string
  tenant_id: string
  nome: string
  operadora: string
  tipo: BeneficioTipo
  modelo_preco: BeneficioModeloPreco
  percentual_empresa_titular: number
  percentual_colaborador_dependentes: number
  valor_flat: number | null
  beneficio_base_id: string | null
  codigo_externo: string | null
  ativo: boolean
  observacao: string | null
  created_at: string
  updated_at: string
}

export type BeneficioFaixaPreco = {
  id: string
  beneficio_id: string
  idade_min: number
  idade_max: number | null
  valor: number
  created_at: string
  updated_at: string
}

export type Dependente = {
  id: string
  tenant_id: string
  colaborador_id: string
  nome: string
  cpf: string
  data_nascimento: string
  parentesco: string
  ativo: boolean
  data_inicio: string
  data_fim: string | null
  observacao: string | null
  created_at: string
  updated_at: string
}

export type ColaboradorBeneficio = {
  id: string
  tenant_id: string
  colaborador_id: string
  beneficio_id: string
  modo_custeio: BeneficioModoCusteio
  data_inicio: string
  data_fim: string | null
  observacao: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ColaboradorBeneficioDependente = {
  id: string
  colaborador_beneficio_id: string
  dependente_id: string
  data_inicio: string
  data_fim: string | null
  created_at: string
}

export type BeneficioCustoMensalLinha = {
  vinculo_id: string
  beneficio_id: string
  beneficio_nome: string
  beneficio_tipo: BeneficioTipo
  modo_custeio: BeneficioModoCusteio
  idade_titular: number
  valor_integral_titular: number
  valor_empresa_titular: number
  valor_colaborador_titular: number
  qtde_dependentes: number
  valor_dependentes_total: number
  valor_desconto_folha_total: number
}
```

Essa atualização entra no **mesmo commit** da migration, conforme regra do CLAUDE.md.

## 14. O que vem depois (Fase 2 preview — não implementar agora)

- Tabela `beneficio_fechamento_mensal` (snapshot) com `tenant_id, ano, mes, status: 'aberta' | 'fechada'`.
- Tabela `beneficio_fechamento_linha` congelando o resultado da `fn_beneficios_custo_mensal` por vínculo.
- Linha de ajuste manual (retroativo, descontado em rescisão, 1º boleto) via `beneficio_fechamento_ajuste`.
- Upload da fatura real da operadora + motor comparativo.
- Esforço: 2 sessões.
