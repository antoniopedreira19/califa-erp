# 26 — Modelo de Dados do Subsistema Férias

> Spec detalhada do banco pro subsistema Férias. Precede migrations. Decisões rastreadas em [`25-ferias.md`](25-ferias.md) §14 (F1–F15).
>
> Convenções herdadas de [`03-modelo-de-dados.md`](03-modelo-de-dados.md) e [`docs/FLUXO-BANCO.md`](../../FLUXO-BANCO.md). Em particular:
> - RLS obrigatória com policies usando `(select auth.uid())`.
> - GRANT explícito pra `authenticated` (RLS ≠ GRANT).
> - FKs com `on delete restrict` por padrão.
> - Índice em FK que aparece em filtro comum.
> - `comment on table/column` para semântica não-óbvia.

## 1. Role nova: `colaborador`

### 1.1 Adição ao enum `app_role`

```sql
alter type public.app_role add value if not exists 'colaborador';
```

Enum passa a ter: `administrador`, `gerente_producao`, `financeiro`, `produtor`, `freelancer`, `rh`, `colaborador`.

### 1.2 Helper `is_colaborador_proprio(uuid)`

RLS do subsistema férias precisa distinguir "o colaborador vendo as próprias férias" de "RH vendo tudo". Helper específico pra isolar isso:

```sql
create or replace function public.is_colaborador_proprio(p_colaborador_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.colaboradores c
    where c.id = p_colaborador_id
      and c.user_id = (select auth.uid())
  );
$$;
```

**Precondição**: `colaboradores.user_id` deve existir e estar populado.

> **Descoberta 2026-10-01**: a coluna `colaboradores.user_id` **não existia** no banco. É adicionada nesta mesma migration de fundação (nullable, FK pra `auth.users(id)`). Fica nullable porque colaborador pode estar cadastrado antes de ter acesso ao sistema, e vice-versa (admin pode não ser colaborador).

A geração de role `colaborador` acontece ao convidar o usuário (ver [`25-ferias.md`](25-ferias.md) §9.3).

## 2. Enums novos

```sql
-- Status do período aquisitivo (derivado, mas armazenado pra performance)
create type public.ferias_periodo_status as enum (
  'incompleto',      -- aquisitivo ainda em andamento
  'apto',            -- aquisitivo fechado, pode gozar
  'em_alerta',       -- concessivo próximo do fim (60 dias)
  'vencido',         -- passou do concessivo sem gozar tudo
  'regularizado',    -- antigos vencidos quitados
  'nao_habilitado',  -- desligado antes de completar
  'pago_rescisao'    -- saldo quitado na saída
);

-- Tipo de lançamento
create type public.ferias_lancamento_tipo as enum (
  'usufruto',            -- dias de folga tirados
  'abono_combinado',     -- abono dentro do bloco de férias (CLT clássico, até 10)
  'abono_avulso',        -- venda de dias sem tirar folga (modelo PJ California, até 10)
  'abono_excepcional'    -- venda de mais de 10 dias por acordo (requer flag admin)
);

-- Status da solicitação/lançamento
create type public.ferias_lancamento_status as enum (
  'pendente_aprovacao',
  'em_analise',
  'aprovado',
  'reprovado',
  'cancelado',
  'concluido'
);

-- Tipo de notificação
create type public.ferias_notificacao_tipo as enum (
  'concessivo_liberado',   -- aquisitivo completou 12m, pode agendar
  'concessivo_em_alerta',  -- 60 dias antes do fim do concessivo
  'ferias_vencidas',       -- concessivo acabou sem uso
  'solicitacao',           -- colaborador solicitou
  'em_analise',            -- RH pediu ajuste
  'aprovada',              -- RH aprovou
  'reprovada',             -- RH reprovou
  'alteracao',             -- lançamento foi alterado
  'cancelamento',          -- lançamento foi cancelado
  'lembrete',              -- genérico pra lembretes customizados
  'inicio',                -- lançamento começou (dia atual)
  'retorno',               -- lançamento termina amanhã
  'emitir_nf'              -- PJ precisa emitir NF (5 dias antes)
);
```

## 3. Tabela `colaboradores_ferias_periodos`

Período aquisitivo de cada colaborador. Gerada automaticamente a partir de `data_admissao`.

### 3.1 DDL

```sql
create table public.colaboradores_ferias_periodos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  numero int not null,                          -- 1, 2, 3... ordem cronológica
  aquisitivo_inicio date not null,
  aquisitivo_fim date not null,
  concessivo_inicio date not null,
  concessivo_fim date not null,
  dias_direito int not null default 30 check (dias_direito between 0 and 30),
  status public.ferias_periodo_status not null default 'incompleto',
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_ferias_periodo_colab_numero
    unique (colaborador_id, numero),
  constraint chk_ferias_periodo_datas
    check (
      aquisitivo_fim > aquisitivo_inicio
      and concessivo_inicio > aquisitivo_fim
      and concessivo_fim > concessivo_inicio
    )
);

comment on table public.colaboradores_ferias_periodos is
  'Períodos aquisitivos + concessivos de cada colaborador. Gerados automaticamente a partir de data_admissao via trigger. Status é derivado mas armazenado pra performance de leitura.';

comment on column public.colaboradores_ferias_periodos.numero is
  'Ordem cronológica: 1 = primeiro período (admissão + 1 ano), 2 = segundo etc.';

comment on column public.colaboradores_ferias_periodos.dias_direito is
  'Padrão 30. Campo existe pra permitir casos excepcionais (ex: proporcional ao sair, redução por falta — não usado no MVP).';
```

### 3.2 Índices

```sql
create index idx_ferias_periodos_colaborador on public.colaboradores_ferias_periodos (colaborador_id);
create index idx_ferias_periodos_tenant_status on public.colaboradores_ferias_periodos (tenant_id, status);
create index idx_ferias_periodos_concessivo_fim on public.colaboradores_ferias_periodos (concessivo_fim) where status in ('apto', 'em_alerta');
```

Último índice parcial é pra query de "quem vence em 60 dias" ser rápida.

### 3.3 RLS

```sql
alter table public.colaboradores_ferias_periodos enable row level security;

-- RH e admin: tudo
create policy ferias_periodos_rh_admin_all on public.colaboradores_ferias_periodos
  for all to authenticated
  using (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id))
  with check (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id));

-- Colaborador: só vê o próprio
create policy ferias_periodos_colab_read_own on public.colaboradores_ferias_periodos
  for select to authenticated
  using (is_colaborador_proprio(colaborador_id));
```

### 3.4 GRANT

```sql
grant select, insert, update, delete
  on public.colaboradores_ferias_periodos to authenticated;
```

### 3.5 Trigger de geração automática

Toda vez que `colaboradores.data_admissao` for setada/alterada (e colaborador ativo), gera/atualiza todos os períodos aquisitivos **da admissão até hoje + 2 anos**.

> **Decisão 2026-10-01**: a spec original dizia "5 períodos fixos", mas o banco tem colaborador admitido em 2003-12-19 (23 períodos de histórico). Fixar 5 perderia histórico necessário pro cálculo de rescisão e visualização de passado. Range dinâmico: `data_admissao → current_date + 2 years`. Pro Deco (2003) gera ~25 períodos; pra Amanda Kapazi (2026) gera 2.

```sql
create or replace function public.fn_gerar_ferias_periodos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inicio date;
  v_fim date;
  v_numero int;
begin
  if new.data_admissao is null then
    return new;
  end if;

  -- Limpa períodos ainda não-utilizados (sem lançamento vinculado) e regenera
  delete from public.colaboradores_ferias_periodos p
   where p.colaborador_id = new.id
     and not exists (
       select 1 from public.colaboradores_ferias_lancamentos g
        where g.periodo_id = p.id
     );

  v_numero := 1;
  v_inicio := new.data_admissao;

  -- Gera períodos até current_date + 2 anos (cobre histórico + planejamento futuro)
  while v_inicio <= current_date + interval '2 years' loop
    v_fim := v_inicio + interval '1 year' - interval '1 day';
    insert into public.colaboradores_ferias_periodos (
      tenant_id, colaborador_id, numero,
      aquisitivo_inicio, aquisitivo_fim,
      concessivo_inicio, concessivo_fim,
      dias_direito, status
    ) values (
      new.tenant_id, new.id, v_numero,
      v_inicio, v_fim,
      v_fim + 1, v_fim + interval '1 year',
      30,
      case when v_fim < current_date then 'apto'::ferias_periodo_status
           else 'incompleto'::ferias_periodo_status end
    )
    on conflict (colaborador_id, numero) do nothing;

    v_inicio := v_fim + 1;
    v_numero := v_numero + 1;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_colaboradores_gerar_periodos on public.colaboradores;
create trigger trg_colaboradores_gerar_periodos
  after insert or update of data_admissao on public.colaboradores
  for each row execute function fn_gerar_ferias_periodos();
```

## 4. Tabela `colaboradores_ferias_lancamentos`

Lançamento de uso das férias (usufruto real ou abono pecuniário).

### 4.1 DDL

```sql
create table public.colaboradores_ferias_lancamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  periodo_id uuid references public.colaboradores_ferias_periodos(id) on delete restrict,
  tipo public.ferias_lancamento_tipo not null,
  data_inicio date not null,
  data_fim date not null,
  dias int not null check (dias > 0 and dias <= 30),
  status public.ferias_lancamento_status not null default 'pendente_aprovacao',
  solicitado_por uuid not null references public.profiles(id),
  aprovado_por uuid references public.profiles(id),
  aprovado_em timestamptz,
  motivo_reprovacao text,
  observacao text,
  lancado_direto_por_rh boolean not null default false,
  -- Valores calculados (só PJ)
  valor_base_remuneracao numeric(14,2),
  valor_ferias numeric(14,2),
  valor_um_terco numeric(14,2),
  valor_abono numeric(14,2),
  valor_total numeric(14,2),
  recibo_url text,                              -- caminho no Storage
  recibo_gerado_em timestamptz,
  conta_avulsa_id uuid references public.contas_avulsas(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_ferias_lancamento_datas
    check (data_fim >= data_inicio and dias = (data_fim - data_inicio + 1)),
  constraint chk_ferias_lancamento_abono_avulso_sem_periodo
    check (
      (tipo = 'abono_avulso' and periodo_id is null)
      or (tipo <> 'abono_avulso' and periodo_id is not null)
    ),
  constraint chk_ferias_lancamento_valores_coerentes
    check (
      valor_total is null
      or valor_total = coalesce(valor_ferias,0) + coalesce(valor_um_terco,0) + coalesce(valor_abono,0)
    )
);

comment on table public.colaboradores_ferias_lancamentos is
  'Lançamento de usufruto de férias ou abono. Status pendente → aprovado → concluído. Valores só são calculados para PJ (CLT recebe recibo da contabilidade).';

comment on column public.colaboradores_ferias_lancamentos.periodo_id is
  'FK pro período aquisitivo. Null apenas quando tipo = abono_avulso (venda de dias fora do bloco de férias — modelo PJ California).';

comment on column public.colaboradores_ferias_lancamentos.lancado_direto_por_rh is
  'True quando RH lança sem passar pelo fluxo de solicitação do colaborador (ex: histórico, excepcionalidade). Rastro de auditoria.';
```

### 4.2 Índices

```sql
create index idx_ferias_lancamentos_colaborador on public.colaboradores_ferias_lancamentos (colaborador_id);
create index idx_ferias_lancamentos_periodo on public.colaboradores_ferias_lancamentos (periodo_id);
create index idx_ferias_lancamentos_tenant_status on public.colaboradores_ferias_lancamentos (tenant_id, status);
create index idx_ferias_lancamentos_data_inicio on public.colaboradores_ferias_lancamentos (data_inicio) where status = 'aprovado';
```

Último parcial pra query de "quem está em férias hoje" e "retornos próximos".

### 4.3 RLS

```sql
alter table public.colaboradores_ferias_lancamentos enable row level security;

-- RH e admin: tudo
create policy ferias_lancamentos_rh_admin_all on public.colaboradores_ferias_lancamentos
  for all to authenticated
  using (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id))
  with check (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id));

-- Colaborador: lê o próprio
create policy ferias_lancamentos_colab_read_own on public.colaboradores_ferias_lancamentos
  for select to authenticated
  using (is_colaborador_proprio(colaborador_id));

-- Colaborador: insere o próprio (sempre entra como pendente_aprovacao)
create policy ferias_lancamentos_colab_insert_own on public.colaboradores_ferias_lancamentos
  for insert to authenticated
  with check (
    is_colaborador_proprio(colaborador_id)
    and status = 'pendente_aprovacao'
    and lancado_direto_por_rh = false
    and solicitado_por = (select auth.uid())
  );

-- Colaborador: cancela o próprio (só se ainda pendente_aprovacao ou aprovado antes do início)
create policy ferias_lancamentos_colab_cancel_own on public.colaboradores_ferias_lancamentos
  for update to authenticated
  using (
    is_colaborador_proprio(colaborador_id)
    and (
      status = 'pendente_aprovacao'
      or (status = 'aprovado' and data_inicio > current_date)
    )
  )
  with check (
    is_colaborador_proprio(colaborador_id)
    and status = 'cancelado'
  );
```

### 4.4 GRANT

```sql
grant select, insert, update, delete
  on public.colaboradores_ferias_lancamentos to authenticated;
```

### 4.5 Trigger de updated_at

Padrão do sistema — usa `moddatetime` ou função dedicada. Reusa a função já existente no projeto se houver, senão:

```sql
create or replace function public.fn_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

create trigger trg_ferias_lancamentos_updated_at
  before update on public.colaboradores_ferias_lancamentos
  for each row execute function fn_set_updated_at();

create trigger trg_ferias_periodos_updated_at
  before update on public.colaboradores_ferias_periodos
  for each row execute function fn_set_updated_at();
```

### 4.6 Trigger de validação de saldo

Garante que a soma de dias de lançamentos aprovados não ultrapassa `dias_direito` do período.

```sql
create or replace function public.fn_valida_saldo_periodo()
returns trigger language plpgsql as $$
declare
  v_dias_direito int;
  v_dias_usados int;
begin
  -- Só valida pra lançamentos vinculados a período (não abono_avulso)
  if new.periodo_id is null then
    return new;
  end if;

  -- Só valida quando status transita pra aprovado
  if new.status <> 'aprovado' then
    return new;
  end if;

  select dias_direito into v_dias_direito
    from public.colaboradores_ferias_periodos
   where id = new.periodo_id;

  select coalesce(sum(dias), 0) into v_dias_usados
    from public.colaboradores_ferias_lancamentos
   where periodo_id = new.periodo_id
     and status in ('aprovado', 'concluido')
     and id <> new.id;

  if v_dias_usados + new.dias > v_dias_direito then
    raise exception
      'Saldo insuficiente no período aquisitivo: % + % > % dias',
      v_dias_usados, new.dias, v_dias_direito;
  end if;

  return new;
end;
$$;

create trigger trg_ferias_lancamentos_valida_saldo
  before insert or update of status, dias on public.colaboradores_ferias_lancamentos
  for each row execute function fn_valida_saldo_periodo();
```

## 5. Tabela `colaboradores_ferias_notificacoes`

Fila de notificações in-app. Geradas por triggers (saldo liberado, concessivo em alerta) ou por eventos de fluxo (solicitação, aprovação).

### 5.1 DDL

```sql
create table public.colaboradores_ferias_notificacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  tipo public.ferias_notificacao_tipo not null,
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  lancamento_id uuid references public.colaboradores_ferias_lancamentos(id) on delete cascade,
  periodo_id uuid references public.colaboradores_ferias_periodos(id) on delete cascade,
  destinatario_user_id uuid not null references public.profiles(id) on delete cascade,
  titulo text not null,
  mensagem text not null,
  payload jsonb not null default '{}'::jsonb,
  lida_em timestamptz,
  criada_em timestamptz not null default now()
);

comment on table public.colaboradores_ferias_notificacoes is
  'Fila de notificações in-app do subsistema de férias. Uma linha por destinatário (ex: concessivo liberado gera 3 linhas: colaborador, líder, RH).';
```

### 5.2 Índices

```sql
create index idx_ferias_notif_destinatario on public.colaboradores_ferias_notificacoes (destinatario_user_id, lida_em) where lida_em is null;
create index idx_ferias_notif_tenant_tipo on public.colaboradores_ferias_notificacoes (tenant_id, tipo);
create index idx_ferias_notif_colaborador on public.colaboradores_ferias_notificacoes (colaborador_id);
```

Primeiro índice (parcial) acelera a query "minhas notificações não lidas", que é o acesso dominante.

### 5.3 RLS

```sql
alter table public.colaboradores_ferias_notificacoes enable row level security;

-- Destinatário: lê e marca como lida
create policy ferias_notif_destinatario_read on public.colaboradores_ferias_notificacoes
  for select to authenticated
  using (destinatario_user_id = (select auth.uid()));

create policy ferias_notif_destinatario_mark_read on public.colaboradores_ferias_notificacoes
  for update to authenticated
  using (destinatario_user_id = (select auth.uid()))
  with check (destinatario_user_id = (select auth.uid()));

-- RH e admin: tudo (pra ver histórico, gerar manualmente etc.)
create policy ferias_notif_rh_admin_all on public.colaboradores_ferias_notificacoes
  for all to authenticated
  using (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id))
  with check (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id));
```

### 5.4 GRANT

```sql
grant select, insert, update, delete
  on public.colaboradores_ferias_notificacoes to authenticated;
```

## 6. Funções de domínio

### 6.1 `fn_recalcular_status_periodo(periodo_id)`

Chamada após qualquer mudança em lançamentos. Reavalia o status do período.

```sql
create or replace function public.fn_recalcular_status_periodo(p_periodo_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_periodo public.colaboradores_ferias_periodos%rowtype;
  v_dias_usados int;
  v_hoje date := current_date;
begin
  select * into v_periodo
    from public.colaboradores_ferias_periodos
   where id = p_periodo_id;

  if not found then return; end if;

  select coalesce(sum(dias), 0) into v_dias_usados
    from public.colaboradores_ferias_lancamentos
   where periodo_id = p_periodo_id
     and status in ('aprovado', 'concluido');

  update public.colaboradores_ferias_periodos
     set status = case
       when v_hoje < v_periodo.aquisitivo_fim then 'incompleto'::ferias_periodo_status
       when v_dias_usados >= v_periodo.dias_direito then 'regularizado'::ferias_periodo_status
       when v_hoje > v_periodo.concessivo_fim then 'vencido'::ferias_periodo_status
       when (v_periodo.concessivo_fim - v_hoje) <= 60 then 'em_alerta'::ferias_periodo_status
       else 'apto'::ferias_periodo_status
     end
   where id = p_periodo_id;
end;
$$;
```

### 6.2 `fn_calcular_meses_rescisao(colaborador_id, data_demissao)`

Calcula "avós" (meses de direito) na rescisão conforme §4.7 da spec. Regra: ≥15 dias no mês → conta 1 avô.

```sql
create or replace function public.fn_calcular_meses_rescisao(
  p_colaborador_id uuid,
  p_data_demissao date
)
returns int language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_total_meses int := 0;
  v_colab public.colaboradores%rowtype;
  v_periodo public.colaboradores_ferias_periodos%rowtype;
  v_dias_usados int;
  v_dias_pendentes int;
  v_dia_demissao int;
  v_inicio_mes_demissao date;
  v_meses_curso int;
begin
  select * into v_colab from public.colaboradores where id = p_colaborador_id;

  -- 1) Períodos vencidos não gozados (cada um até 12 avós)
  for v_periodo in
    select * from public.colaboradores_ferias_periodos
     where colaborador_id = p_colaborador_id
       and aquisitivo_fim < p_data_demissao
  loop
    select coalesce(sum(dias), 0) into v_dias_usados
      from public.colaboradores_ferias_lancamentos
     where periodo_id = v_periodo.id
       and status in ('aprovado', 'concluido');
    v_dias_pendentes := v_periodo.dias_direito - v_dias_usados;
    -- Converte dias pendentes em avós (30 dias = 12 avós)
    v_total_meses := v_total_meses + round(v_dias_pendentes::numeric / 30 * 12)::int;
  end loop;

  -- 2) Período em curso: meses do início do aquisitivo até demissão
  select * into v_periodo
    from public.colaboradores_ferias_periodos
   where colaborador_id = p_colaborador_id
     and p_data_demissao between aquisitivo_inicio and aquisitivo_fim
   limit 1;

  if found then
    -- Conta meses inteiros entre aquisitivo_inicio e primeiro dia do mês de demissão
    v_inicio_mes_demissao := date_trunc('month', p_data_demissao)::date;
    v_meses_curso :=
      extract(year from age(v_inicio_mes_demissao, v_periodo.aquisitivo_inicio))::int * 12
      + extract(month from age(v_inicio_mes_demissao, v_periodo.aquisitivo_inicio))::int;

    -- Regra dos 15 dias: se trabalhou >= 15 dias no mês da demissão, conta o mês
    v_dia_demissao := extract(day from p_data_demissao)::int;
    if v_dia_demissao >= 15 then
      v_meses_curso := v_meses_curso + 1;
    end if;

    v_total_meses := v_total_meses + v_meses_curso;
  end if;

  return v_total_meses;
end;
$$;
```

### 6.3 `fn_criar_notificacao(tenant_id, tipo, colaborador_id, destinatarios[], titulo, mensagem, payload)`

Helper pra reduzir boilerplate. Dispara 1 insert por destinatário.

```sql
create or replace function public.fn_criar_notificacao_ferias(
  p_tenant_id uuid,
  p_tipo public.ferias_notificacao_tipo,
  p_colaborador_id uuid,
  p_destinatarios uuid[],
  p_titulo text,
  p_mensagem text,
  p_payload jsonb default '{}'::jsonb,
  p_lancamento_id uuid default null,
  p_periodo_id uuid default null
)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.colaboradores_ferias_notificacoes
    (tenant_id, tipo, colaborador_id, lancamento_id, periodo_id,
     destinatario_user_id, titulo, mensagem, payload)
  select p_tenant_id, p_tipo, p_colaborador_id, p_lancamento_id, p_periodo_id,
         unnest(p_destinatarios), p_titulo, p_mensagem, p_payload;
end;
$$;
```

## 7. Jobs/cron (fase posterior)

Alertas automáticos **não** são triggers do banco — rodam via `pg_cron` 1x por dia:

- **Diário 06:00**: varre `colaboradores_ferias_periodos` com `status in ('apto','em_alerta')` e `concessivo_fim - current_date = 60` → cria notificação `concessivo_em_alerta`.
- **Diário 06:00**: varre períodos com `aquisitivo_fim = current_date - 1` e colaborador ativo → cria `concessivo_liberado`.
- **Diário 06:00**: varre lançamentos aprovados com `data_inicio - 5 = current_date` e colaborador PJ → cria `emitir_nf`.
- **Diário 06:00**: varre lançamentos aprovados com `data_fim - 1 = current_date` → cria `retorno`.
- **Diário 06:00**: varre períodos com `concessivo_fim < current_date` e status `apto` com saldo > 0 → vira `vencido` + cria notificação `ferias_vencidas`.
- **Diário 06:00**: varre lançamentos aprovados com `data_inicio = current_date` → status muda pra `concluido` quando `data_fim < current_date`.

Setup do cron fica numa migration separada depois que a estrutura básica estiver estável.

## 8. Ordem sugerida de migration

Fatiar em 4 migrations, nessa ordem:

1. **`YYYYMMDDHHMMSS_ferias_fundacao.sql`**:
   - Enum `app_role` += `colaborador`
   - Helper `is_colaborador_proprio`
   - 4 enums novos (`ferias_periodo_status`, `ferias_lancamento_tipo`, `ferias_lancamento_status`, `ferias_notificacao_tipo`)
   - Tabela `colaboradores_ferias_periodos` + policies + GRANTs + índices
   - Função `fn_gerar_ferias_periodos` + trigger em `colaboradores`

2. **`YYYYMMDDHHMMSS_ferias_lancamentos.sql`**:
   - Tabela `colaboradores_ferias_lancamentos` + policies + GRANTs + índices
   - Funções `fn_set_updated_at`, `fn_valida_saldo_periodo`
   - Triggers de updated_at e validação de saldo
   - Função `fn_recalcular_status_periodo`

3. **`YYYYMMDDHHMMSS_ferias_notificacoes.sql`**:
   - Tabela `colaboradores_ferias_notificacoes` + policies + GRANTs + índices
   - Função helper `fn_criar_notificacao_ferias`
   - Função `fn_calcular_meses_rescisao`

4. **`YYYYMMDDHHMMSS_ferias_backfill_periodos.sql`** (dado):
   - Para cada colaborador ativo com `data_admissao`, dispara o trigger (via UPDATE no-op) pra gerar os 5 períodos.
   - Pode ser `UPDATE colaboradores SET data_admissao = data_admissao WHERE data_admissao IS NOT NULL;`
   - Após o backfill, rodar `fn_recalcular_status_periodo` em todos os períodos criados.

5. **`YYYYMMDDHHMMSS_ferias_import_historico.sql`** (dado — opcional):
   - Insere lançamentos históricos da planilha em `colaboradores_ferias_lancamentos` com `status = 'concluido'` e `lancado_direto_por_rh = true`.
   - Mesmo padrão dos imports anteriores: script Node em `tmp/` gera SQL, migration só documenta.

6. **`YYYYMMDDHHMMSS_ferias_cron.sql`** (depois da UI pronta):
   - `pg_cron` jobs listados em §7.

## 9. Verificações obrigatórias pós-migration (via MCP)

Cada migration termina com uma verificação:

- Tabelas criadas: `select count(*) from pg_tables where tablename like 'colaboradores_ferias_%'` → 3.
- Enums criados: `select typname from pg_type where typname like 'ferias_%'` → 4.
- Policies ativas: `select * from pg_policies where tablename like 'colaboradores_ferias_%'`.
- GRANTs: `select grantee, privilege_type from information_schema.role_table_grants where table_name like 'colaboradores_ferias_%' and grantee='authenticated'`.
- Dado backfill: `select colaborador_id, count(*) from colaboradores_ferias_periodos group by 1 having count(*) < 5` → vazio.

## 10. Dívidas conhecidas / a decidir no futuro

- **Fuso horário**: cálculos de "concessivo em alerta" e "retorno amanhã" usam `current_date`. Hoje o Supabase roda em UTC — então o cron do 06:00 pode cair em dias diferentes do que esperado em `America/Sao_Paulo`. Resolver com `now() AT TIME ZONE 'America/Sao_Paulo'`.
- **Feriados**: a planilha ignora feriados. Mantemos a mesma convenção no MVP. Se virar necessidade, adicionamos tabela `feriados` depois.
- **Fracionamento com regras CLT**: a lei exige que pelo menos 1 fração tenha ≥14 dias. Não validamos no MVP — RH humano aprova.
- **Multi-tenant**: todas as tabelas têm `tenant_id`, mas a geração automática do período herda do colaborador. Ok por ora.
- **Reset de períodos**: se alterar `data_admissao` de um colaborador que já tem lançamentos vinculados, o trigger não apaga o período antigo (tem lançamento). Precisa de manual intervention. OK como invariante.

## 11. Dependências

- `colaboradores` (existente) — fonte da data_admissao e do tenant_id.
- `tenants` (existente).
- `profiles` (existente) — pra solicitado_por, aprovado_por, destinatario.
- `contas_avulsas` (existente) — pra onde a rescisão/valor PJ vira título.
- Helpers `is_tenant_admin`, `is_tenant_rh` (existentes).
- Role `rh` no enum (existente).
