# 03 — Modelo de Dados (MVP)

Especificação das tabelas, enums, constraints, índices, RLS e GRANTs do MVP do RH. Este documento **não é a migration** — é o desenho que a migration vai executar. Toda decisão aqui é rastreável a `00-descoberta.md` §6 e `01-visao-geral.md`.

Regras invioláveis herdadas do projeto (ver `docs/FLUXO-BANCO.md` e `CLAUDE.md`):

- Toda tabela nova tem `tenant_id` com FK para `tenants`.
- RLS obrigatória. **No módulo RH, o gate é role-específico:** `is_tenant_admin(tenant_id) OR is_tenant_rh(tenant_id)` para SELECT/INSERT/UPDATE/DELETE. Não usar `is_tenant_member` aqui — dado do RH é sensível.
- Policies usam `(select auth.uid())`, nunca `auth.uid()` direto.
- GRANT explícito para `authenticated` no fim de cada migration (RLS ≠ GRANT).
- FKs com `on delete restrict` por padrão (ou `cascade` só onde documentado — histórico do colaborador cascateia com o colaborador).
- Índice em FK que aparece em filtro comum.
- `comment on table` e `comment on column` para semântica não-óbvia (padrão dos migrations recentes).

## Convenções de migration (padrão do sistema)

- Header comment explicando **motivo** (`-- Motivo: ...`) e referência ao spec.
- Idempotência: `drop trigger if exists ...` antes de `create trigger`; `drop policy if exists ...` antes de `create policy`.
- Nome de trigger: `trg_<tabela>_<acao>` (padrão majoritário — `empresas`, `contas_avulsas`, `orcamentos`).
- Nome de constraint CHECK: `chk_<tabela>_<regra>` ou `<tabela>_<regra>`.
- Nome de índice: `idx_<tabela>_<colunas>` para índices comuns; `uniq_<tabela>_<colunas>` para uniques.
- `created_by uuid references public.profiles(id)` (padrão do domínio HR/comercial; `empresas` usa `auth.users` mas é exceção).

## Role `rh` e helper de banco

### Adição ao enum `app_role`

Aditivo, sem risco: adicionar `rh` ao enum existente.

```sql
alter type public.app_role add value if not exists 'rh';
```

Enum passa a ter: `administrador`, `gerente_producao`, `financeiro`, `produtor`, `freelancer`, `rh`.

### Helper `is_tenant_rh(uuid)`

Espelho fiel do `is_tenant_admin(uuid)`, só troca o filtro de role. Serve como base das policies RLS de todas as tabelas do RH.

```sql
create or replace function public.is_tenant_rh(p_tenant_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
    where tm.user_id = (select auth.uid())
      and tm.tenant_id = p_tenant_id
      and tm.status = 'ativo'
      and tm.role = 'rh'
      and p.ativo = true
  );
$$;

revoke all on function public.is_tenant_rh(uuid) from public, anon;
grant execute on function public.is_tenant_rh(uuid) to authenticated;

comment on function public.is_tenant_rh(uuid) is
  'True se o usuario autenticado for membro ativo com role rh no tenant. Padrao espelhado de is_tenant_admin.';
```

## Enums novos

### `tipo_contratacao`

```sql
create type public.tipo_contratacao as enum (
  'pj',           -- Pessoa Jurídica (emite NF)
  'mei',          -- Microempreendedor Individual (emite NF simplificada)
  'clt_recibo',   -- Contratação híbrida — CLT com contrato separado por recibo
  'clt',          -- Consolidação das Leis do Trabalho
  'estagio'       -- Estagiário via TCE
);
```

Regra derivada: `pj`, `mei`, `clt_recibo` têm CNPJ (14 dígitos); `clt` e `estagio` têm CPF (11 dígitos). Ver CHECK em `colaboradores.cpf_cnpj`.

### `cadastro_status` (**já existe**)

Reusar o enum `cadastro_status` (`ativo`, `inativo`) que `clientes` e `fornecedores` já usam. **Aplicável apenas a `colaboradores`** — cadastro comercial. Catálogos estruturais como `niveis` usam `ativo boolean` (padrão de `empresas`, `regionais`, `categorias`).

## Tabela — `niveis`

Catálogo tenant-wide de níveis de cargo. Hierarquia de senioridade, **não faixa salarial**.

```sql
create table public.niveis (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  codigo      text not null,                 -- 'N3', 'N4', 'N5', 'N1', 'N2', 'N6'…
  descricao   text,                          -- opcional; livre pra glossário
  ordem       smallint,                      -- pra ordenar N1<N2<N3 na UI; nullable
  ativo       boolean not null default true, -- soft-delete
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint chk_niveis_codigo_nao_vazio check (length(trim(codigo)) >= 1),
  constraint chk_niveis_ordem_positiva   check (ordem is null or ordem > 0)
);

create unique index uniq_niveis_codigo_por_tenant
  on public.niveis (tenant_id, upper(codigo));

create index idx_niveis_tenant on public.niveis (tenant_id);
create index idx_niveis_ativo  on public.niveis (tenant_id) where ativo = true;

comment on table  public.niveis is
  'Catalogo tenant-wide de niveis de cargo (hierarquia de senioridade). NAO representa faixa salarial.';
comment on column public.niveis.ordem is
  'Opcional. Usado pra ordenar niveis na UI (N3 < N4 < N5). NULL = sem ordem definida.';
```

**Seed do tenant Agência California:** `N3`, `N4`, `N5` (ordens 3, 4, 5) — os únicos que aparecem na planilha atual. Novos níveis são criados pela UI.

**RLS + GRANT:**

```sql
alter table public.niveis enable row level security;

drop policy if exists niveis_select on public.niveis;
create policy niveis_select on public.niveis
  for select to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists niveis_insert on public.niveis;
create policy niveis_insert on public.niveis
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists niveis_update on public.niveis;
create policy niveis_update on public.niveis
  for update to authenticated
  using  (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

-- Sem policy DELETE — soft-delete via ativo=false.

grant select, insert, update on public.niveis to authenticated;
```

## Tabela — `colaboradores`

Cadastro mestre. Dados que **não mudam com alocação nem com folha**.

```sql
create table public.colaboradores (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,

  nome               text not null,
  email              text,                                    -- opcional; futuro convite
  tipo_contratacao   public.tipo_contratacao not null,
  cpf_cnpj           text,                                    -- 11 ou 14 dig; opcional no cadastro rápido
  funcao             text not null,                           -- 'Gerente de Projetos', 'Filmmaker'…
  nivel_id           uuid references public.niveis(id) on delete restrict,

  fornecedor_id      uuid references public.fornecedores(id) on delete restrict,
    -- link opcional para reuso de dados bancários/PIX na baixa da folha

  data_admissao      date not null,
  data_encerramento  date,                                    -- soft-delete via status; esta coluna registra a data efetiva

  status             public.cadastro_status not null default 'ativo',

  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Formato de documento pelo tipo de contratação
  constraint colaboradores_cpf_cnpj_formato check (
    cpf_cnpj is null
    or (tipo_contratacao in ('clt','estagio')                   and cpf_cnpj ~ '^[0-9]{11}$')
    or (tipo_contratacao in ('pj','mei','clt_recibo')           and cpf_cnpj ~ '^[0-9]{14}$')
  ),

  -- Encerramento coerente com status
  constraint colaboradores_encerramento_coerente check (
    (status = 'ativo' and data_encerramento is null)
    or (status = 'inativo')
  ),

  -- Nome não vazio
  constraint colaboradores_nome_nao_vazio check (length(trim(nome)) >= 2)
);

-- Duplicidade evidente por documento dentro do tenant.
create unique index uniq_colaboradores_documento_por_tenant
  on public.colaboradores (tenant_id, cpf_cnpj)
  where cpf_cnpj is not null;

create index idx_colaboradores_tenant       on public.colaboradores (tenant_id);
create index idx_colaboradores_status       on public.colaboradores (tenant_id, status);
create index idx_colaboradores_nivel        on public.colaboradores (nivel_id);
create index idx_colaboradores_fornecedor   on public.colaboradores (fornecedor_id);

comment on table  public.colaboradores is
  'Cadastro mestre de colaboradores. Dados que nao mudam com alocacao (Camada 1) nem com folha (Camada 2).';
comment on column public.colaboradores.fornecedor_id is
  'Link opcional para fornecedor existente com mesmo CPF/CNPJ. Reusa dados bancarios/PIX na baixa da folha. Nulo quando colaborador nao emite NF (CLT/estagio) ou quando o cadastro de fornecedor ainda nao existe.';
comment on column public.colaboradores.data_encerramento is
  'Data efetiva do encerramento do vinculo. So faz sentido quando status=inativo (constraint colaboradores_encerramento_coerente).';
```

**Notas:**

- `cpf_cnpj` é opcional no cadastro por design (permite "cadastro rápido"). Antes de gerar folha, será exigido — validação em fase de folha.
- `fornecedor_id` é FK **opcional**. Não há unique cruzada `(colaboradores.cpf_cnpj, fornecedores.cpf_cnpj)` — o link é explícito, não por documento. Ver `00-descoberta.md` §6.7.
- Sem `DELETE` — `status='inativo'` + `data_encerramento` cobrem soft-delete.
- Auditoria: `colaborador.criado`, `colaborador.editado`, `colaborador.inativado`, `colaborador.reativado`.

**RLS + GRANT (padrão do módulo — admin OR rh):**

```sql
alter table public.colaboradores enable row level security;

drop policy if exists colaboradores_select on public.colaboradores;
create policy colaboradores_select on public.colaboradores
  for select to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists colaboradores_insert on public.colaboradores;
create policy colaboradores_insert on public.colaboradores
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists colaboradores_update on public.colaboradores;
create policy colaboradores_update on public.colaboradores
  for update to authenticated
  using  (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

-- Sem policy DELETE — soft-delete via status=inativo.

grant select, insert, update on public.colaboradores to authenticated;
```

## Tabela — `colaboradores_alocacoes` (Camada 1 — vigente)

Timeline de alocações do colaborador. **N linhas podem coexistir com `data_fim IS NULL`** — alocação múltipla simultânea, rateada por percentual.

```sql
create table public.colaboradores_alocacoes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  colaborador_id  uuid not null references public.colaboradores(id) on delete cascade,
  empresa_id      uuid not null references public.empresas(id) on delete restrict,
  regional_id     uuid not null references public.regionais(id) on delete restrict,

  percentual      numeric(5,2) not null,                    -- 0.01 a 100.00
  data_inicio     date not null,
  data_fim        date,                                     -- NULL = vigente
  motivo          text,                                     -- opcional (reorganização, mudança de squad…)

  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),

  constraint alocacoes_percentual_valido check (percentual > 0 and percentual <= 100),
  constraint alocacoes_periodo_valido    check (data_fim is null or data_fim >= data_inicio)
);

create index idx_alocacoes_colaborador on public.colaboradores_alocacoes (colaborador_id);
create index idx_alocacoes_empresa     on public.colaboradores_alocacoes (empresa_id);
create index idx_alocacoes_regional    on public.colaboradores_alocacoes (regional_id);
create index idx_alocacoes_vigentes    on public.colaboradores_alocacoes (colaborador_id)
  where data_fim is null;

comment on table  public.colaboradores_alocacoes is
  'Camada 1 — alocacao vigente do colaborador em par (empresa, regional). N linhas simultaneas por colaborador, somando percentual=100 quando data_fim IS NULL. Base para o rateio da folha.';
comment on column public.colaboradores_alocacoes.percentual is
  'Rateio da alocacao. Soma das linhas vigentes de um mesmo colaborador = 100 (trigger de integridade).';
comment on column public.colaboradores_alocacoes.data_fim is
  'NULL = vigente. Fechar linha antiga antes de abrir nova e responsabilidade da server action, em transacao.';
```

**Constraint de soma = 100%:**

Regra: em qualquer instante, a soma dos `percentual` das linhas vigentes de um mesmo colaborador é `= 100`. Modelagem em duas camadas:

1. **Trigger `AFTER INSERT/UPDATE/DELETE`** em `colaboradores_alocacoes` que recalcula a soma das linhas vigentes do colaborador afetado e falha se `<> 100`. Trigger é `DEFERRABLE INITIALLY IMMEDIATE`, mas pode ser explicitamente `SET CONSTRAINTS DEFERRED` numa transação para permitir swap atômico (fechar antiga + abrir nova sem estado intermediário inválido).
2. **Server actions dedicadas** — `abrirAlocacao`, `fecharAlocacao`, `substituirAlocacao(colaborador_id, novas_linhas[])` — encapsulam a manipulação em transação, evitando que a UI precise se preocupar com estados intermediários.

Não sobreposição temporal por `(colaborador_id, empresa_id, regional_id)` fica coberta implicitamente: fechar a linha antiga antes de abrir nova é responsabilidade das server actions. Uma sobreposição acidental viola a soma = 100 e o trigger derruba.

**RLS + GRANT:**

```sql
alter table public.colaboradores_alocacoes enable row level security;

drop policy if exists alocacoes_select on public.colaboradores_alocacoes;
create policy alocacoes_select on public.colaboradores_alocacoes
  for select to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists alocacoes_insert on public.colaboradores_alocacoes;
create policy alocacoes_insert on public.colaboradores_alocacoes
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists alocacoes_update on public.colaboradores_alocacoes;
create policy alocacoes_update on public.colaboradores_alocacoes
  for update to authenticated
  using  (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

-- DELETE liberado para admin/rh: RH pode digitar linha errada e precisar limpar.
-- Padrão análogo ao de empresa_members e contas_avulsas_regionais.
drop policy if exists alocacoes_delete on public.colaboradores_alocacoes;
create policy alocacoes_delete on public.colaboradores_alocacoes
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

grant select, insert, update, delete on public.colaboradores_alocacoes to authenticated;
```

Cascade em `colaborador_id` porque alocação sem colaborador não faz sentido.

## Tabela — `colaboradores_salarios` (histórico = movimentação salarial)

Cada linha é uma **mudança salarial**. Salário vigente = linha com `data_fim IS NULL`.

```sql
create table public.colaboradores_salarios (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  colaborador_id  uuid not null references public.colaboradores(id) on delete cascade,

  valor           numeric(14,2) not null,                   -- salário/pró-labore mensal em BRL
  data_inicio     date not null,
  data_fim        date,                                     -- NULL = vigente

  motivo          text,                                     -- 'dissídio', 'promoção', 'reclassificação'…
  aprovado_por    uuid references public.profiles(id),      -- opcional; workflow de aprovação é fase futura

  created_by      uuid references public.profiles(id) not null,
  created_at      timestamptz not null default now(),

  constraint salarios_valor_positivo   check (valor > 0),
  constraint salarios_periodo_valido   check (data_fim is null or data_fim >= data_inicio)
);

-- Um único salário vigente por colaborador
create unique index uniq_salario_vigente_por_colaborador
  on public.colaboradores_salarios (colaborador_id)
  where data_fim is null;

create index idx_salarios_colaborador on public.colaboradores_salarios (colaborador_id);
create index idx_salarios_tenant      on public.colaboradores_salarios (tenant_id);

comment on table  public.colaboradores_salarios is
  'Historico salarial. Cada linha e uma MUDANCA de salario. Salario vigente = linha com data_fim IS NULL (unique parcial garante uma so).';
comment on column public.colaboradores_salarios.valor is
  'Salario ou pro-labore mensal em BRL. Congelado no snapshot da folha quando o motor da folha existir.';
comment on column public.colaboradores_salarios.motivo is
  'Livre. Padrao esperado: dissidio, promocao, reclassificacao, correcao contratual.';
```

**Server actions previstas:**
- `registrarMudancaSalarial(colaborador_id, novo_valor, motivo?, aprovado_por?)` — fecha a linha atual com `data_fim = today`, abre nova com `data_inicio = today` e o novo valor. Atômico.
- `corrigirSalarioAtual(colaborador_id, valor)` — atualiza o `valor` da linha vigente sem gerar nova linha (para correção de digitação; auditado com metadata do valor antigo). Restringir para `administrador` apenas (não `rh`).

**RLS + GRANT:**

```sql
alter table public.colaboradores_salarios enable row level security;

drop policy if exists salarios_select on public.colaboradores_salarios;
create policy salarios_select on public.colaboradores_salarios
  for select to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists salarios_insert on public.colaboradores_salarios;
create policy salarios_insert on public.colaboradores_salarios
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists salarios_update on public.colaboradores_salarios;
create policy salarios_update on public.colaboradores_salarios
  for update to authenticated
  using  (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

-- DELETE liberado para admin/rh: erro de digitação precisa de limpeza.
-- corrigirSalarioAtual (UPDATE) é o caminho padrão; DELETE é escape hatch.
drop policy if exists salarios_delete on public.colaboradores_salarios;
create policy salarios_delete on public.colaboradores_salarios
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

grant select, insert, update, delete on public.colaboradores_salarios to authenticated;
```

Cascade em `colaborador_id`.

## Tabela — `folhas_pagamento` (esqueleto — Camada 2 mínima)

**Não é usada pelo MVP**. Nasce previsível para que a folha (fase futura) encaixe sem migration destrutiva. Um único registro por (colaborador, competência).

```sql
create table public.folhas_pagamento (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  colaborador_id     uuid not null references public.colaboradores(id) on delete restrict,

  competencia_ano    smallint not null,                     -- 2026
  competencia_mes    smallint not null,                     -- 1..12

  -- Snapshot do salário no momento da geração da folha
  salario_base       numeric(14,2) not null,

  status             text not null default 'rascunho',      -- rascunho | enviada | aprovada | paga
    -- vira enum próprio quando a folha real for implementada; text aqui é
    -- só pra estrutura mínima. Ninguém escreve nesta tabela no MVP.

  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint folhas_competencia_mes_valido check (competencia_mes between 1 and 12),
  constraint folhas_competencia_ano_valido check (competencia_ano between 2020 and 2099)
);

create unique index uniq_folha_por_colaborador_competencia
  on public.folhas_pagamento (colaborador_id, competencia_ano, competencia_mes);

create index idx_folhas_tenant on public.folhas_pagamento (tenant_id);
```

## Tabela — `folhas_pagamento_alocacoes` (snapshot da alocação usada na folha)

Também esqueleto. Nasce copiando `colaboradores_alocacoes` vigentes no momento da geração da folha; editável pelo financeiro até a folha ser aprovada.

```sql
create table public.folhas_pagamento_alocacoes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  folha_id           uuid not null references public.folhas_pagamento(id) on delete cascade,

  empresa_id         uuid not null references public.empresas(id) on delete restrict,
  regional_id        uuid not null references public.regionais(id) on delete restrict,
  percentual         numeric(5,2) not null,

  created_at         timestamptz not null default now(),

  constraint folha_aloc_percentual_valido check (percentual > 0 and percentual <= 100)
);

create index idx_folha_aloc_folha    on public.folhas_pagamento_alocacoes (folha_id);
create index idx_folha_aloc_empresa  on public.folhas_pagamento_alocacoes (empresa_id);
create index idx_folha_aloc_regional on public.folhas_pagamento_alocacoes (regional_id);

comment on table  public.folhas_pagamento is
  'Camada 2 — snapshot da folha por competencia. ESQUELETO no MVP; motor da folha e fase futura. Nao ha UI escrevendo aqui ainda.';
comment on table  public.folhas_pagamento_alocacoes is
  'Snapshot da alocacao (Camada 1) usada na folha. Nasce copiando colaboradores_alocacoes vigentes; editavel pelo financeiro antes de aprovar. ESQUELETO no MVP.';
```

**Nota crítica:** nenhuma UI escreve nas tabelas `folhas_pagamento*` no MVP. Elas nascem só com RLS + GRANT. A regra de "soma dos percentuais do snapshot = 100" fica para a fase da folha implementar — no MVP não há linhas, então não há o que validar.

**RLS + GRANT (mesmo gate — admin OR rh):**

Aplicar o mesmo padrão de `select/insert/update` `admin OR rh` sem DELETE nas duas tabelas. Na fase da folha, uma migration aditiva alarga o SELECT para incluir `is_tenant_financeiro(uuid)` (a criar quando fizer sentido) sem quebrar nada existente.

## Regionais "GERAL {empresa}" (seed obrigatório)

A migration precisa criar uma regional dedicada em cada empresa **real** do tenant (não em "Empresa Teste") para abrigar colaboradores transversais (backoffice, TI, financeiro) que não têm regional específica.

**Nomes reais criados** (fotografia 2026-09-16):

| Empresa | Regional |
|---|---|
| Agência California | GERAL Agência California |
| CCH | GERAL CCH |
| Hitlab | GERAL Hitlab |

**Por que o sufixo com o nome da empresa** — a tabela `regionais` tem **dois** uniques:
- `idx_regionais_empresa_nome` — UNIQUE `(empresa_id, nome)`
- `uniq_regional_nome_por_tenant` — UNIQUE `(tenant_id, lower(nome))`

O segundo impõe **nome único por tenant** (todas as regionais existentes hoje seguem: NE, SP, NO, RJ, SS, Doca, Agency, Hitlab — cada nome existe uma vez só no tenant). Uma tentativa inicial de criar "GERAL" nas três empresas violou essa constraint na segunda linha inserida. Solução: sufixar com o `nome_fantasia` da empresa. Na UI aparecem como "GERAL Agência California", "GERAL CCH", "GERAL Hitlab" — auto-explicativas.

```sql
insert into public.regionais (tenant_id, nome, empresa_id, ativo)
select
  e.tenant_id,
  'GERAL ' || e.nome_fantasia,
  e.id,
  true
from public.empresas e
where e.tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and e.nome_fantasia in ('Agência California', 'CCH', 'Hitlab')
on conflict (empresa_id, nome) do nothing;
```

## RLS resumo do módulo

O gate padrão do módulo RH é **`is_tenant_admin(tenant_id) OR is_tenant_rh(tenant_id)`** — nunca `is_tenant_member`. As policies concretas por tabela estão nas seções acima. Resumo:

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `niveis` | admin OR rh | admin OR rh | admin OR rh | — (ativo=false) |
| `colaboradores` | admin OR rh | admin OR rh | admin OR rh | — (status=inativo) |
| `colaboradores_alocacoes` | admin OR rh | admin OR rh | admin OR rh | admin OR rh |
| `colaboradores_salarios` | admin OR rh | admin OR rh | admin OR rh | admin OR rh |
| `folhas_pagamento` | admin OR rh | admin OR rh | admin OR rh | — |
| `folhas_pagamento_alocacoes` | admin OR rh | admin OR rh | admin OR rh | — |

**Máscara de salário na aplicação:** não existe no MVP porque nenhum role fora de admin/rh acessa RH. Se algum dia `financeiro` for incluído no SELECT (fase da folha), aí sim pode ter máscara server-side seletiva. Por ora, quem lê pode ver tudo.

**Guard de rota:** todas as pages sob `/rh/**` e `/cadastros/niveis` chamam `requireSession()` e derrubam com `redirect('/home?reason=sem_permissao_rh')` se `activeRole ∉ {administrador, rh}`. Padrão espelhado da Central Financeira (que usa `sem_permissao_financeira`).

## Ordem de migration proposta

Para manter cada migration coesa e reversível:

1. **`20260916000001_rh_role.sql`** ✅ **aplicada em 2026-09-16** — `alter type app_role add value 'rh'` (isolada).
2. **`20260916000002_rh_helper.sql`** ✅ **aplicada em 2026-09-16** — função `is_tenant_rh(uuid)` + grants + comment.
3. **`YYYYMMDDHHMMSS_rh_enums_e_niveis.sql`** — enum `tipo_contratacao`, tabela `niveis`, RLS+GRANT+seed dos 3 níveis iniciais.
4. **`YYYYMMDDHHMMSS_rh_regional_geral.sql`** — insert das regionais "GERAL" nas 3 empresas (California, CCH, Hitlab).
5. **`YYYYMMDDHHMMSS_rh_colaboradores.sql`** — tabela `colaboradores` com FKs, CHECKs, RLS+GRANT.
6. **`YYYYMMDDHHMMSS_rh_alocacoes.sql`** — tabela `colaboradores_alocacoes`, trigger de soma=100, RLS+GRANT (com DELETE).
7. **`YYYYMMDDHHMMSS_rh_salarios.sql`** — tabela `colaboradores_salarios` com unique parcial, RLS+GRANT (com DELETE).
8. **`YYYYMMDDHHMMSS_rh_folhas_esqueleto.sql`** — `folhas_pagamento` + `folhas_pagamento_alocacoes` (esqueleto), RLS+GRANT.

Cada migration é aditiva e passa pelo ciclo do `docs/FLUXO-BANCO.md` (ler → escrever → aplicar via MCP → conferir → commitar com o código).

**Sobre a divisão 1a + 1b:** a primeira tentativa unia `alter type` e `create function is_tenant_rh` no mesmo arquivo. O Postgres rejeitou (`55P04: unsafe use of new value "rh" of enum type app_role — New enum values must be committed before they can be used`). O planejador do `CREATE FUNCTION` **avalia** o literal `'rh'` no ato do parse, mesmo que a comparação só rode em runtime — e isso viola a regra de que o novo valor precisa estar committed antes de ser usado. Regra registrada: **em migrations que adicionam valor a enum e criam objeto que usa esse valor, sempre separar em dois arquivos aplicados sequencialmente**. Válido para toda enum futura, não só `app_role`.

## Auditoria — ações previstas

| Ação | Evento | Metadata mínima |
|---|---|---|
| Criar colaborador | `colaborador.criado` | `{ colaborador_id, nome, tipo_contratacao }` |
| Editar colaborador | `colaborador.editado` | `{ colaborador_id, campo, valor_anterior, valor_novo }` |
| Inativar colaborador | `colaborador.inativado` | `{ colaborador_id, data_encerramento }` |
| Reativar colaborador | `colaborador.reativado` | `{ colaborador_id }` |
| Abrir alocação | `colaborador.alocacao_aberta` | `{ colaborador_id, alocacao_id, empresa_id, regional_id, percentual, data_inicio }` |
| Fechar alocação | `colaborador.alocacao_fechada` | `{ colaborador_id, alocacao_id, data_fim, motivo }` |
| Registrar mudança salarial | `colaborador.salario_mudou` | `{ colaborador_id, valor_anterior, valor_novo, motivo }` |
| Corrigir salário atual | `colaborador.salario_corrigido` | `{ colaborador_id, valor_anterior, valor_novo }` |
| Criar/editar/inativar nível | `nivel.criado` / `nivel.editado` / `nivel.inativado` | `{ nivel_id, codigo }` |
| Denials de acesso (role sem permissão) | `acao_negada` | `{ acao_tentada, rota, activeRole }` — padrão do sistema em Central Financeira/Jobs |

## O que este documento **não** cobre

- Server actions (fica em spec de implementação da task)
- UI (`/rh`, `/rh/colaboradores`, drawer, `/cadastros/niveis`) — fica no plan da task
- Motor da folha e integração com contas a pagar — fica em fase futura, com sua própria descoberta e modelo
- Import da planilha atual — script de seed em fase própria se necessário

## Referências cruzadas

- [`00-descoberta.md`](00-descoberta.md) §6 — origem de cada decisão desta modelagem
- [`01-visao-geral.md`](01-visao-geral.md) — escopo e critérios de aceite do MVP
- [`docs/FLUXO-BANCO.md`](../../FLUXO-BANCO.md) — ciclo obrigatório de migração via MCP
- [`supabase/migrations/20260722000001_task002_clientes_fornecedores.sql`](../../../supabase/migrations/20260722000001_task002_clientes_fornecedores.sql) — precedente de `cpf_cnpj` unified + CHECK por `tipo_pessoa`
- [`supabase/migrations/20260908000001_hierarquia_empresa_regional.sql`](../../../supabase/migrations/20260908000001_hierarquia_empresa_regional.sql) — hierarquia empresa/regional que este módulo reusa
- [`supabase/migrations/20260909000001_empresa_members.sql`](../../../supabase/migrations/20260909000001_empresa_members.sql) — precedente arquitetural para "aloca N vezes em (empresa, regional)"
- [`supabase/migrations/20260817000004_titulos_a_pagar.sql`](../../../supabase/migrations/20260817000004_titulos_a_pagar.sql) — motor de contas a pagar que a folha futura vai reusar via `contas_avulsas`
