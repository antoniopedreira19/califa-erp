# Contas Avulsas Recorrentes — Design

**Data:** 2026-08-07
**Autor:** Antonio + Claude
**Status:** Aguardando revisão do Antonio antes do plano de implementação.

## 1. Contexto

O módulo de contas avulsas (Task 012) permite lançar obrigações administrativas fora do fluxo de PP: aluguel, folha, IPTU, tarifa bancária. Hoje cada uma exige lançamento manual — o financeiro entra em `/financeiro/contas-a-pagar`, aba Lançamentos Avulsos, clica "Nova conta avulsa" e cadastra do zero.

A maioria dessas obrigações **se repete em cadência fixa**: aluguel todo dia 5, folha adiantamento dia 5 e fechamento dia 20, IPTU 15/03 anual. Digitar toda vez é retrabalho e fonte de esquecimento.

Esta spec introduz **contas avulsas recorrentes** — templates que geram automaticamente uma nova conta pendente na data de vencimento, sem intervenção manual. O usuário dá baixa manualmente em cada ocorrência.

## 2. Objetivo

Habilitar o financeiro a cadastrar templates de conta recorrente. Um cron diário (`pg_cron`) gera uma instância de `contas_avulsas` (status pendente) toda vez que a data de vencimento chega. Instância nasce igual a uma avulsa manual — mesma tabela, mesmo fluxo de baixa, mesma tela de detalhes — só ganha uma FK apontando pro template que a gerou.

Entrega:

1. Nova tabela `contas_avulsas_recorrentes` (template).
2. Nova coluna `contas_avulsas.recorrente_id` (FK opcional).
3. Extensão `pg_cron` habilitada + função `gerar_ocorrencias_recorrentes()` agendada diariamente 03:00 America/Sao_Paulo.
4. Nova aba "Recorrências" em `/financeiro/contas-a-pagar` (3 tabs no total).
5. Drawer separado `<ContaRecorrenteDrawer>` pra criar/editar template.
6. Dialog contextual ao cancelar/excluir instância gerada: "Só esta ocorrência ou parar a recorrência inteira?"
7. Página de detalhes `/financeiro/contas-a-pagar/recorrente/[id]` com histórico de instâncias geradas.

## 3. Decisões arquiteturais

Todas fechadas em conversa com Antonio antes de escrever esta spec.

### 3.1. Template separado (`contas_avulsas_recorrentes`), não flag em `contas_avulsas`

Separação clara: template é o padrão, instância é a realização. Não confunde queries de saldo/DRE ("é lançamento ou é intenção de lançamento?"). Cada instância gerada é uma `contas_avulsas` normal — a única diferença é a FK `recorrente_id`.

Rejeitada: coluna `recorrencia_ativa` em `contas_avulsas`. Mistura conceitos — a "próxima ocorrência" só nasceria quando a atual é baixada, o que quebra o comportamento "toda data de vencimento vira uma conta pendente" (Antonio quer 2 pendentes se atrasar 2 meses, não 1).

### 3.2. `pg_cron` do Supabase, não Edge Function / Vercel Cron

Extensão disponível no projeto (verificado — `installed_version = null`, precisa `CREATE EXTENSION`). Roda dentro do banco, sem depender de HTTP/serverless. Não trip em latência de cold start, não precisa de credenciais internas, não precisa Vercel Cron config, não conta como Edge Function invocation.

### 3.3. Cancelar ocorrência dispara dialog "só esta ou parar recorrência"

Padrão Google Calendar. Quando o usuário clica **Excluir** ou **Cancelar baixa** numa `contas_avulsas` com `recorrente_id != null`, aparece dialog com 2 opções:
- **Só cancelar esta ocorrência** — o template continua ativo, próximas gerações acontecem normal.
- **Parar toda a recorrência** — cancela esta E marca template como `ativo=false`, cron para de gerar.

Se `recorrente_id = null` (avulsa criada manualmente), dialog normal do fluxo atual (sem essas opções).

### 3.4. 3 frequências: quinzenal, mensal, anual

Cobrem >95% dos casos reais do financeiro brasileiro. Rejeitadas: `semanal`, `trimestral`, `a cada N dias arbitrário`. YAGNI — se um dia aparecer demanda, expande sem quebrar nada.

### 3.5. Data de fim opcional (contrato com prazo)

Campo `data_fim date null` no template. Útil pra financiamento de 60 parcelas, aluguel com prazo definido, licenças anuais que não renovam automaticamente. Vazio = infinita (padrão). Preenchido = cron para de gerar após atingir.

### 3.6. Primeira ocorrência = próxima data válida após criação (não retroativa)

Usuário cria template hoje (10/08). Se frequência = mensal dia 5, próxima data é 05/09 (dia 5 deste mês já passou). Se quinzenal com dias 5 e 20, próxima é 20/08 (dia 5 já passou, dia 20 ainda não).

Não gera retroativa. Se o usuário quer lançar o mês atual, cria uma avulsa manual pra ele e o template cuida dos próximos.

### 3.7. Quinzenal = 2 dias fixos configuráveis no mês

Não é "a cada 14 dias sliding window". Usuário escolhe **2 dias do mês** (ex: 5 e 20, ou 15 e 30). Cron gera toda vez que chega um desses dias. Alinha com padrão brasileiro de salário quinzenal (adiantamento + fechamento). Regra "último dia se >28" vale pros 2 dias.

### 3.8. Dia >28 cai no último dia do mês

Aluguel dia 31 gera 28 em fev não-bissexto, 29 em fev bissexto, 30 em abr/jun/set/nov, 31 em jan/mar/mai/jul/ago/out/dez. Postgres calcula com `LEAST(dia_desejado, EXTRACT(DAY FROM (date_trunc('month', proxima) + interval '1 month - 1 day')))`.

Vale pros 4 campos: `dia_do_mes`, `dia_quinzena_1`, `dia_quinzena_2`, `dia_do_ano_dia`.

### 3.9. Edição de template só afeta instâncias futuras

Editar valor de R$ 3.000 pra R$ 3.200 não muda as pendentes já geradas. Só as próximas nascem com valor novo. Padrão contábil correto — instância já criada é histórico.

Se o usuário precisa corrigir uma instância pendente, edita ela individualmente (fluxo já existente da Task 7 — `editarContaAvulsa`).

### 3.10. UI: drawer separado + aba própria

Não misturar com drawer de avulsa manual (`<ContaAvulsaDrawer>` já denso). Drawer novo `<ContaRecorrenteDrawer>` só cria template. Aba nova "Recorrências" na página, ao lado de "Pedidos de Compra" e "Lançamentos Avulsos".

### 3.11. Cron 03:00 America/Sao_Paulo diário

Horário de baixa carga. Antes do início do expediente. Se cron falhar/servidor cair por N dias, ao voltar gera todas as ocorrências atrasadas de uma vez (query usa `proxima_data <= current_date`, cobre múltiplos atrasos automaticamente).

## 4. Modelagem de dados

### 4.1. `contas_avulsas_recorrentes`

```sql
create type frequencia_recorrencia as enum ('quinzenal','mensal','anual');

create table public.contas_avulsas_recorrentes (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete restrict,
  empresa_id                  uuid not null references public.empresas(id) on delete restrict,
  descricao                   text not null,
  valor                       numeric(14,2) not null,

  -- Contra-parte opcional (mesma semântica de contas_avulsas)
  fornecedor_id               uuid references public.fornecedores(id) on delete restrict,
  cliente_id                  uuid references public.clientes(id) on delete restrict,
  job_id                      uuid references public.jobs(id) on delete restrict,

  -- Plano de contas obrigatório
  plano_conta_tipo_id         uuid not null references public.plano_contas_tipos(id) on delete restrict,
  plano_conta_subtipo_id      uuid not null references public.plano_contas_subtipos(id) on delete restrict,

  -- Recorrência
  frequencia                  frequencia_recorrencia not null,
  dia_do_mes                  smallint,  -- pra mensal (1-31)
  dia_quinzena_1              smallint,  -- pra quinzenal (1-31)
  dia_quinzena_2              smallint,  -- pra quinzenal (1-31, > dia_quinzena_1)
  dia_do_ano_dia              smallint,  -- pra anual (1-31)
  dia_do_ano_mes              smallint,  -- pra anual (1-12)

  proxima_data                date not null,   -- data da próxima instância a gerar
  data_fim                    date,            -- opcional; cron para depois disso

  ativo                       boolean not null default true,  -- false = parado (não gera mais)

  criado_por                  uuid not null references public.profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint chk_rec_valor_positivo check (valor > 0),
  constraint chk_rec_descricao_nao_vazia check (length(trim(descricao)) >= 3),

  -- Cada frequência exige seus campos e proíbe os das outras
  constraint chk_rec_frequencia_mensal check (
    frequencia <> 'mensal' or (
      dia_do_mes is not null and dia_do_mes between 1 and 31
      and dia_quinzena_1 is null and dia_quinzena_2 is null
      and dia_do_ano_dia is null and dia_do_ano_mes is null
    )
  ),
  constraint chk_rec_frequencia_quinzenal check (
    frequencia <> 'quinzenal' or (
      dia_quinzena_1 is not null and dia_quinzena_2 is not null
      and dia_quinzena_1 between 1 and 31
      and dia_quinzena_2 between 1 and 31
      and dia_quinzena_1 < dia_quinzena_2
      and dia_do_mes is null
      and dia_do_ano_dia is null and dia_do_ano_mes is null
    )
  ),
  constraint chk_rec_frequencia_anual check (
    frequencia <> 'anual' or (
      dia_do_ano_dia is not null and dia_do_ano_dia between 1 and 31
      and dia_do_ano_mes is not null and dia_do_ano_mes between 1 and 12
      and dia_do_mes is null
      and dia_quinzena_1 is null and dia_quinzena_2 is null
    )
  ),

  -- data_fim >= proxima_data quando informada
  constraint chk_rec_data_fim_ordem check (
    data_fim is null or data_fim >= proxima_data
  )
);

create index idx_rec_tenant on public.contas_avulsas_recorrentes(tenant_id);
create index idx_rec_empresa on public.contas_avulsas_recorrentes(empresa_id);
create index idx_rec_ativos_prox_data
  on public.contas_avulsas_recorrentes(tenant_id, ativo, proxima_data)
  where ativo = true;  -- índice parcial pro cron: só templates ativos
create index idx_rec_fornecedor on public.contas_avulsas_recorrentes(fornecedor_id);

drop trigger if exists trg_rec_updated_at on public.contas_avulsas_recorrentes;
create trigger trg_rec_updated_at
  before update on public.contas_avulsas_recorrentes
  for each row execute function public.set_updated_at();

alter table public.contas_avulsas_recorrentes enable row level security;

create policy rec_select on public.contas_avulsas_recorrentes
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy rec_insert on public.contas_avulsas_recorrentes
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
create policy rec_update on public.contas_avulsas_recorrentes
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
create policy rec_delete on public.contas_avulsas_recorrentes
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.contas_avulsas_recorrentes to authenticated;
```

### 4.2. FK em `contas_avulsas`

```sql
alter table public.contas_avulsas
  add column if not exists recorrente_id uuid
    references public.contas_avulsas_recorrentes(id) on delete set null;

create index if not exists idx_avulsas_recorrente
  on public.contas_avulsas(recorrente_id)
  where recorrente_id is not null;
```

**`on delete set null`** — deletar template hard deixa instâncias existentes como avulsas "órfãs" (sem referência ao template original). É comportamento aceitável — instâncias já geradas viraram fatos contábeis independentes. Na prática, quase sempre vamos usar soft delete (`ativo=false`) em vez de DELETE.

### 4.3. Empresa imutável no template

Mesma regra de `contas_avulsas`: `empresa_id` bloqueado após criação. Trocar empresa muda toda a semântica (contas bancárias possíveis mudam, plano de contas pode não fazer sentido). Se errou, cria template novo e exclui/pausa o antigo.

Enforcement: server action `editarContaRecorrente` não aceita `empresa_id`.

## 5. Fluxo do cron

### 5.1. Setup `pg_cron`

Uma migration própria (roda uma vez):

```sql
create extension if not exists pg_cron with schema extensions;
grant usage on schema cron to postgres;
```

Nota Supabase: `pg_cron` fica no schema `extensions` por padrão. Chamadas usam `cron.schedule(...)`, `cron.unschedule(...)`.

### 5.2. Função `gerar_ocorrencias_recorrentes()`

`SECURITY DEFINER`, roda como owner do schema, bypassa RLS (necessário porque não tem `auth.uid()` num job cron).

```sql
create or replace function public.gerar_ocorrencias_recorrentes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template  contas_avulsas_recorrentes%rowtype;
  v_geradas   integer := 0;
  v_nova_avulsa_id uuid;
  v_prox_data date;
begin
  for v_template in
    select *
      from public.contas_avulsas_recorrentes
     where ativo = true
       and proxima_data <= current_date
       and (data_fim is null or proxima_data <= data_fim)
     order by tenant_id, proxima_data
  loop
    -- Insere instância como avulsa pendente
    insert into public.contas_avulsas (
      tenant_id, empresa_id, descricao, valor, natureza,
      data_prevista_pagamento, status,
      fornecedor_id, cliente_id, job_id,
      plano_conta_tipo_id, plano_conta_subtipo_id,
      recorrente_id, criado_por
    ) values (
      v_template.tenant_id, v_template.empresa_id, v_template.descricao,
      v_template.valor, 'saida',
      v_template.proxima_data, 'pendente',
      v_template.fornecedor_id, v_template.cliente_id, v_template.job_id,
      v_template.plano_conta_tipo_id, v_template.plano_conta_subtipo_id,
      v_template.id, v_template.criado_por
    )
    returning id into v_nova_avulsa_id;

    v_geradas := v_geradas + 1;

    -- Calcula próxima data conforme frequência
    v_prox_data := public.calcular_proxima_data_recorrencia(v_template);

    -- Atualiza template: se próxima passa da data_fim, desativa
    if v_template.data_fim is not null and v_prox_data > v_template.data_fim then
      update public.contas_avulsas_recorrentes
         set ativo = false, proxima_data = v_prox_data
       where id = v_template.id;
    else
      update public.contas_avulsas_recorrentes
         set proxima_data = v_prox_data
       where id = v_template.id;
    end if;
  end loop;

  return v_geradas;
end;
$$;

grant execute on function public.gerar_ocorrencias_recorrentes() to authenticated;

select cron.schedule(
  'gerar-recorrentes-diario',
  '0 6 * * *',           -- 06:00 UTC = 03:00 America/Sao_Paulo
  $$select public.gerar_ocorrencias_recorrentes();$$
);
```

### 5.3. Função auxiliar `calcular_proxima_data_recorrencia(template)`

Isolada pra facilitar teste e manutenção:

```sql
create or replace function public.calcular_proxima_data_recorrencia(
  p_template contas_avulsas_recorrentes
)
returns date
language plpgsql
immutable
as $$
declare
  v_base date := p_template.proxima_data;
  v_prox date;
  v_ano int;
  v_mes int;
  v_ultimo_dia int;
  v_dia_desejado int;
begin
  case p_template.frequencia
    when 'mensal' then
      v_ano := extract(year from v_base + interval '1 month');
      v_mes := extract(month from v_base + interval '1 month');
      v_ultimo_dia := extract(day from
        (make_date(v_ano, v_mes, 1) + interval '1 month - 1 day')::date);
      v_dia_desejado := least(p_template.dia_do_mes, v_ultimo_dia);
      v_prox := make_date(v_ano, v_mes, v_dia_desejado);

    when 'quinzenal' then
      -- Estratégia mais simples: comparar v_base contra as 2 datas
      -- efetivas do mês corrente e do mês seguinte, e escolher a próxima
      -- que ainda não passou.
      --
      -- Passo 1: computar as 4 datas candidatas (2 do mês atual + 2 do
      -- mês seguinte), aplicando clamping do "último dia se >28" em cada.
      -- Passo 2: retornar a menor delas que seja > v_base.
      declare
        v_datas date[];
        v_candidata date;
      begin
        v_datas := ARRAY[
          public.data_quinzena_do_mes(extract(year from v_base)::int,
                                       extract(month from v_base)::int,
                                       p_template.dia_quinzena_1),
          public.data_quinzena_do_mes(extract(year from v_base)::int,
                                       extract(month from v_base)::int,
                                       p_template.dia_quinzena_2),
          public.data_quinzena_do_mes(extract(year from (v_base + interval '1 month'))::int,
                                       extract(month from (v_base + interval '1 month'))::int,
                                       p_template.dia_quinzena_1),
          public.data_quinzena_do_mes(extract(year from (v_base + interval '1 month'))::int,
                                       extract(month from (v_base + interval '1 month'))::int,
                                       p_template.dia_quinzena_2)
        ];

        select min(d) into v_candidata
          from unnest(v_datas) as d
         where d > v_base;

        v_prox := v_candidata;
      end;

    when 'anual' then
      v_ano := extract(year from v_base) + 1;
      v_ultimo_dia := extract(day from
        (make_date(v_ano, p_template.dia_do_ano_mes, 1) + interval '1 month - 1 day')::date);
      v_dia_desejado := least(p_template.dia_do_ano_dia, v_ultimo_dia);
      v_prox := make_date(v_ano, p_template.dia_do_ano_mes, v_dia_desejado);
  end case;

  return v_prox;
end;
$$;
```

**Helper compartilhado `data_quinzena_do_mes(ano, mes, dia_desejado)`** — encapsula a regra de clamping "último dia se >28":

```sql
create or replace function public.data_quinzena_do_mes(
  p_ano int, p_mes int, p_dia int
)
returns date
language sql
immutable
as $$
  select make_date(
    p_ano,
    p_mes,
    least(
      p_dia,
      extract(day from (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day'))::int
    )
  );
$$;
```

Usada tanto no `calcular_proxima_data_recorrencia` (quinzenal) quanto — via reaproveitamento — no cálculo mensal (para clareza; equivalente ao inline atual).

### 5.4. Cálculo da `proxima_data` inicial ao criar template

Na server action `criarContaRecorrente`, chamamos essa função:

```sql
create or replace function public.calcular_proxima_data_inicial(
  p_frequencia frequencia_recorrencia,
  p_dia_do_mes smallint,
  p_dia_quinzena_1 smallint,
  p_dia_quinzena_2 smallint,
  p_dia_do_ano_dia smallint,
  p_dia_do_ano_mes smallint
)
returns date
language plpgsql
stable  -- lê current_date, não é immutable
as $$
declare
  v_hoje date := current_date;
  v_ano int := extract(year from v_hoje)::int;
  v_mes int := extract(month from v_hoje)::int;
  v_prox date;
  v_datas date[];
begin
  case p_frequencia
    when 'mensal' then
      -- Candidata deste mês; se já passou, próxima do mês seguinte.
      v_prox := public.data_quinzena_do_mes(v_ano, v_mes, p_dia_do_mes);
      if v_prox <= v_hoje then
        v_prox := public.data_quinzena_do_mes(
          extract(year from make_date(v_ano, v_mes, 1) + interval '1 month')::int,
          extract(month from make_date(v_ano, v_mes, 1) + interval '1 month')::int,
          p_dia_do_mes
        );
      end if;

    when 'quinzenal' then
      -- 4 candidatas (mês atual + próximo). Pega a menor que > hoje.
      v_datas := ARRAY[
        public.data_quinzena_do_mes(v_ano, v_mes, p_dia_quinzena_1),
        public.data_quinzena_do_mes(v_ano, v_mes, p_dia_quinzena_2),
        public.data_quinzena_do_mes(
          extract(year from make_date(v_ano, v_mes, 1) + interval '1 month')::int,
          extract(month from make_date(v_ano, v_mes, 1) + interval '1 month')::int,
          p_dia_quinzena_1),
        public.data_quinzena_do_mes(
          extract(year from make_date(v_ano, v_mes, 1) + interval '1 month')::int,
          extract(month from make_date(v_ano, v_mes, 1) + interval '1 month')::int,
          p_dia_quinzena_2)
      ];
      select min(d) into v_prox from unnest(v_datas) as d where d > v_hoje;

    when 'anual' then
      -- Candidata este ano; se já passou, ano seguinte.
      v_prox := public.data_quinzena_do_mes(v_ano, p_dia_do_ano_mes, p_dia_do_ano_dia);
      if v_prox <= v_hoje then
        v_prox := public.data_quinzena_do_mes(v_ano + 1, p_dia_do_ano_mes, p_dia_do_ano_dia);
      end if;
  end case;

  return v_prox;
end;
$$;

grant execute on function public.calcular_proxima_data_inicial(
  frequencia_recorrencia, smallint, smallint, smallint, smallint, smallint
) to authenticated;
```

Note-se `STABLE` (não `IMMUTABLE`) — lê `current_date`, então depende do contexto. Cache seguro dentro da mesma statement, mas não entre statements.

## 6. Regras de negócio

### 6.1. Criar template (`criarContaRecorrente`)

Assinatura:

```ts
export async function criarContaRecorrente(input: {
  empresa_id: string;
  descricao: string;
  valor: number;
  fornecedor_id: string | null;
  cliente_id: string | null;
  job_id: string | null;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
  frequencia: 'quinzenal' | 'mensal' | 'anual';
  dia_do_mes: number | null;
  dia_quinzena_1: number | null;
  dia_quinzena_2: number | null;
  dia_do_ano_dia: number | null;
  dia_do_ano_mes: number | null;
  data_fim: string | null;
}): Promise<Result>
```

Validações:
- Gate `admin | financeiro`.
- Zod: frequência × campos coerentes (mesma lógica dos CHECKs).
- Subtipo pertence ao tipo.
- Empresa/tipo/subtipo ativos.
- Se `quinzenal`, `dia_quinzena_1 < dia_quinzena_2`.
- Se `data_fim`, deve ser >= `current_date`.

Executa:
1. Calcula `proxima_data` via RPC `calcular_proxima_data_inicial(...)`.
2. Se `data_fim IS NOT NULL AND proxima_data > data_fim`, retorna erro "data fim antes da primeira ocorrência".
3. INSERT no template.
4. Audit `conta_recorrente.criada`.
5. `revalidatePath("/financeiro/contas-a-pagar")`.

### 6.2. Editar template (`editarContaRecorrente`)

Só permite se `ativo=true` (não faz sentido editar template parado sem reativar primeiro).

`empresa_id` bloqueado (Zod não aceita).

Se alterou `frequencia`, `dia_*`, ou o cluster todo de dias, **recalcula `proxima_data`** via `calcular_proxima_data_inicial` — o template essencialmente recomeça daqui pra frente.

Se só alterou `valor`/`descricao`/`fornecedor_id`/`cliente_id`/`job_id`/`tipo`/`subtipo`, mantém `proxima_data`.

**Instâncias já geradas não mudam** (padrão contábil — decisão 3.9).

Audit `conta_recorrente.editada` com metadata `{ campos_alterados: string[] }`.

### 6.3. Pausar / Reativar (`pausarContaRecorrente` / `reativarContaRecorrente`)

Flip do `ativo`.

Reativar: se `proxima_data <= current_date` (template ficou parado por N meses), recalcula pra próxima data válida a partir de hoje. Não gera retroativa das que perdeu.

Audit: `conta_recorrente.pausada` / `.reativada`.

### 6.4. Excluir template (`excluirContaRecorrente`)

**Soft delete padrão**: `UPDATE ativo=false` (mesma coisa que pausar).

**Hard delete** só se `count(contas_avulsas WHERE recorrente_id = X) = 0` — se nunca gerou instância. Nesse caso, `DELETE` do row.

Audit `conta_recorrente.excluida`.

### 6.5. Cancelar ocorrência gerada (`excluirContaAvulsa` / `estornarBaixaAvulsa` — extensão)

Actions existentes ganham parâmetro opcional `parar_recorrencia: boolean` (default `false`).

Se `true` e a avulsa tem `recorrente_id`:
1. Executa a ação normal (excluir avulsa pendente OU estornar baixa).
2. `pausarContaRecorrente(recorrente_id)` — desativa o template.

Se `false` (ou sem `recorrente_id`), comportamento atual — só a avulsa é afetada.

Audit adicional `conta_recorrente.pausada` quando `parar_recorrencia=true`.

## 7. Server actions + RPCs

Arquivo novo: `app/(app)/financeiro/contas-a-pagar/actions-recorrentes.ts`.

Actions:
- `criarContaRecorrente(input)`
- `editarContaRecorrente(id, input)`
- `pausarContaRecorrente(id)`
- `reativarContaRecorrente(id)`
- `excluirContaRecorrente(id)`

Modificar `actions-avulsas.ts`:
- `excluirContaAvulsa` — adicionar parâmetro `parar_recorrencia?: boolean`.
- `estornarBaixaAvulsa` — adicionar parâmetro `parar_recorrencia?: boolean`.

RPCs Postgres novas:
- `calcular_proxima_data_recorrencia(template) returns date` — IMMUTABLE, usada pelo cron.
- `calcular_proxima_data_inicial(frequencia, dias...) returns date` — IMMUTABLE, usada por `criarContaRecorrente`.
- `gerar_ocorrencias_recorrentes() returns integer` — SECURITY DEFINER, invocada pelo cron.

Todas as actions com gate `admin | financeiro` via `checarGateFinanceiro` (helper duplicado do padrão existente).

## 8. UI

### 8.1. Tabs — vira 3 abas em `/financeiro/contas-a-pagar`

`<ContasPagarTabs>` (existente) ganha 3ª aba: **"Recorrências"**. Ordem final: Pedidos de Compra | Lançamentos Avulsos | Recorrências.

Badge de contagem: templates com `ativo=true`.

### 8.2. Aba "Recorrências" — `<RecorrentesList>`

Lista simples:

Colunas: **Descrição** | **Frequência** (chip) | **Próxima data** | **Fornecedor** | **Empresa** | **Valor** | **Status** (Ativa/Parada) | **Ações**.

Ordenação padrão: `ativo DESC, proxima_data ASC`.

Busca: descrição + fornecedor.

Chips de status: `Ativas | Paradas | Todas` (default Ativas).

Botão "Nova recorrência" no header direito (mesmo padrão do "Nova conta avulsa").

Row click → navega pra `/financeiro/contas-a-pagar/recorrente/[id]`.

### 8.3. Drawer `<ContaRecorrenteDrawer>` (novo)

Estrutura similar ao `<ContaAvulsaDrawer>` da Task 7 (dá pra copiar boa parte dos campos "de conta"), com bloco de recorrência adicional:

**Campos "de conta"** (idênticos ao drawer de avulsa):
- Empresa* (Select, disabled em editar)
- Descrição* (textarea 500 chars)
- Valor* (Input numérico currency)
- Job (Combobox opcional — se escolhido, auto-preenche cliente + trava, mesma lógica da Task 7)
- Fornecedor (Combobox opcional)
- Cliente (Combobox opcional; trava se job escolhido)
- Tipo* (Select)
- Subtipo* (Select filtrado por tipo)

**Bloco recorrência**:
- Frequência* (radio: Quinzenal / Mensal / Anual — default Mensal)
- **Se Mensal**: Dia do vencimento* (Input number 1-31)
- **Se Quinzenal**: Primeiro dia* (1-31) + Segundo dia* (1-31, > Primeiro dia). Validação client-side pra dia_1 < dia_2.
- **Se Anual**: Dia* (1-31) + Mês* (Select 1-12 com nomes de mês em pt-BR)
- Data de fim (DatePicker opcional, ≥ hoje)

**Sem anexos** — templates não têm anexos (instâncias geradas nascem sem anexo). Se precisar anexar comprovante depois, é na instância pendente (fluxo Task 7 já cobre).

Hint no fim do form (texto pequeno cinza):

> Ao salvar, o sistema calcula a próxima data válida a partir de hoje. Não gera ocorrências retroativas.

Botão "Criar recorrência" (verde emerald) ou "Salvar" (california-red em edit).

### 8.4. Dialog contextual em cancelar/excluir ocorrência

Modificar `<ExcluirAvulsaButton>` (Task 9) e `<CancelarBaixaAvulsaModal>` (Task 9):

**Se `conta.recorrente_id === null`**: comportamento atual (dialog simples confirmar).

**Se `conta.recorrente_id !== null`**: dialog especial com radio:

```
Como você quer proceder?

○ Só esta ocorrência
   O template continua ativo e vai gerar a próxima na data prevista.

○ Parar toda a recorrência
   Este template é desativado. Nenhuma nova ocorrência será gerada
   até você reativar manualmente.

[Cancelar] [Confirmar]
```

Ao confirmar, chama `excluirContaAvulsa(id, { parar_recorrencia: <valor do radio> })` ou análogo pra estorno.

### 8.5. Página de detalhes `/financeiro/contas-a-pagar/recorrente/[id]`

Layout (max-w-7xl):

- Header: breadcrumb, ícone `Repeat` do lucide, título com descrição + badge Ativa/Parada.
- Card **Detalhes**: empresa, valor, fornecedor/cliente/job, plano de contas.
- Card **Recorrência**: frequência (com dias formatados em pt-BR: "Mensal — todo dia 5", "Quinzenal — dias 5 e 20", "Anual — 15 de março"), próxima data prevista, data fim (se houver).
- Card **Histórico de ocorrências geradas**: tabela com Data | Status (Pendente/Baixada) | Valor | Ações (link "Abrir" pra `/avulsa/[id]`).
- Ações no rodapé:
  - Se `ativo=true`: [Editar] [Pausar]
  - Se `ativo=false`: [Reativar]
  - Sempre: [Excluir] (soft; ou hard se nunca gerou)

## 9. RLS + GRANTs + Auditoria

Padrão do projeto:
- Tabela `contas_avulsas_recorrentes` com RLS `is_tenant_member(tenant_id)`.
- Gate `admin | financeiro` no server action.
- COM DELETE policy (hard delete se count = 0).

Nova coluna `contas_avulsas.recorrente_id` — RLS herda da tabela mãe.

Ações novas auditadas:
- `conta_recorrente.criada`
- `conta_recorrente.editada` (metadata: `campos_alterados: string[]`)
- `conta_recorrente.pausada`
- `conta_recorrente.reativada`
- `conta_recorrente.excluida`
- `conta_recorrente.ocorrencia_gerada` (metadata: `recorrente_id`, `avulsa_id`, `data_movimento`) — logada dentro do cron (função SECURITY DEFINER precisa chamar `log_audit_event` diretamente ou uma variante que aceita `tenant_id` explícito).

## 10. Migrations

### 10.1. `20260807000001_contas_avulsas_recorrentes.sql`

- CREATE TYPE `frequencia_recorrencia`.
- CREATE TABLE `contas_avulsas_recorrentes` + índices + RLS + GRANT + trigger `set_updated_at`.
- ALTER TABLE `contas_avulsas` ADD COLUMN `recorrente_id` + índice.

### 10.2. `20260807000002_pg_cron_setup.sql`

- `create extension if not exists pg_cron with schema extensions;`
- `grant usage on schema cron to postgres;`

Isolada porque `CREATE EXTENSION` é operação de infra — vale isolar pra facilitar auditoria e eventual rollback.

### 10.3. `20260807000003_calcular_proxima_data.sql`

- CREATE FUNCTION `calcular_proxima_data_recorrencia(template)` (IMMUTABLE).
- CREATE FUNCTION `calcular_proxima_data_inicial(...)` (IMMUTABLE).

Isoladas por serem funções puras testáveis.

### 10.4. `20260807000004_gerar_recorrentes.sql`

- CREATE FUNCTION `gerar_ocorrencias_recorrentes()` (SECURITY DEFINER).
- GRANT EXECUTE.
- `cron.schedule('gerar-recorrentes-diario', '0 6 * * *', ...)`.

## 11. Fora de escopo desta entrega

- **Recorrência semanal, trimestral, "a cada N dias"**. Se aparecer demanda, expande enum.
- **Múltiplas datas por mês** além de quinzenal (ex: dia 1, 10 e 20). YAGNI.
- **Templates de PP recorrente**. Só avulsa. PPs têm ciclo produtivo diferente (nascem de item realizado do job).
- **Notificação/alerta** de próxima ocorrência prestes a gerar. Cron só executa; sem push/email.
- **Ajuste automático do valor** (correção monetária, IGPM). Editar template continua manual.
- **Anexos no template**. Cada instância gerada é oportunidade de anexar comprovante individual.
- **Aprovação de template** (fluxo admin aprova recorrência criada por financeiro). Ambos criam direto.
- **Skip de ocorrência específica** ("só quero pular julho"). Se aparecer, adiciona campo `datas_puladas date[]` ao template.
- **Interface de "próximas ocorrências previstas"** (calendário 90 dias). Fase futura, seria útil pra fluxo de caixa projetado.

## 12. Impacto no código existente

Arquivos a **modificar**:
- `app/(app)/financeiro/contas-a-pagar/contas-pagar-tabs.tsx` — 3ª aba "Recorrências".
- `app/(app)/financeiro/contas-a-pagar/page.tsx` — nova query pra recorrências + count de ativos.
- `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts` — `excluirContaAvulsa` e `estornarBaixaAvulsa` aceitam `parar_recorrencia`.
- `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/acoes-client.tsx` — `<ExcluirAvulsaButton>` e wrapper do `<CancelarBaixaAvulsaModal>` verificam `conta.recorrente_id` e trocam o dialog quando existe.
- `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/cancelar-baixa-avulsa-modal.tsx` — variante do modal quando é recorrente.
- `lib/types.ts` — tipos `ContaAvulsaRecorrente`, `FrequenciaRecorrencia`; ajuste em `ContaAvulsa` pra ganhar `recorrente_id`.
- `lib/auth/audit.ts` — novos audit actions.

Arquivos a **criar**:
- 4 migrations SQL (ver seção 10).
- `app/(app)/financeiro/contas-a-pagar/actions-recorrentes.ts` — 5 actions.
- `app/(app)/financeiro/contas-a-pagar/recorrentes-list.tsx` — lista da aba.
- `app/(app)/financeiro/contas-a-pagar/conta-recorrente-drawer.tsx` — form criar/editar.
- `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/page.tsx` — detalhes.
- `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/acoes-client.tsx` — botões pausar/reativar/editar/excluir.
- `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/historico-ocorrencias.tsx` — tabela histórico.
- `lib/validations/conta-recorrente.ts` — Zod.

## 13. Riscos e mitigação

- **Cálculo de `calcular_proxima_data_recorrencia` errado gera ocorrências no dia errado permanentemente** (cron avança e nunca corrige retroativamente). Mitigação: testes SQL manuais das 3 frequências com edge cases (dia 31 em fev, dia 30 em fev bissexto, quinzenal 15/30) antes de agendar o cron. Aplicar migration `20260807000004` só depois de validar 000003.
- **Cron falha silenciosamente**. `pg_cron` grava resultado em `cron.job_run_details`. Adicionar SELECT nessa tabela em rotina de saúde manual (dashboard futuro). Sem alerta ativo neste escopo.
- **Race condition ao editar template enquanto cron roda**. Baixíssima probabilidade (cron uma vez ao dia às 03h). Se preocupar, adicionar `select ... for update` no loop do cron. Fora de escopo agora.
- **Template com data_fim no passado ainda aparece na aba** (recém-desativado mas usuário vê). Chip "Parada" no status resolve visualmente.
- **Instâncias órfãs em `on delete set null`**: se admin deletar template, instâncias existentes ficam com `recorrente_id = null` e não são identificáveis como "geradas por recorrência" no histórico. Aceitável — soft delete via `ativo=false` é o caminho padrão, hard delete só via SQL manual.
- **Fuso horário do cron**: `pg_cron` roda em UTC. Configuração usa expressão UTC (`0 6 * * *` = 06:00 UTC = 03:00 São Paulo). Comentário no SQL explicita a conversão pra evitar drift em daylight saving (Brasil não tem mais, mas registro no comentário).

## 14. Decisões travadas em conversa

1. ✅ Cancelamento de ocorrência gera dialog "só esta / parar recorrência".
2. ✅ Frequências: quinzenal + mensal + anual.
3. ✅ Dia >28 cai no último dia do mês.
4. ✅ Data de fim opcional.
5. ✅ Primeira ocorrência: próxima data válida a partir de hoje (não retroativa).
6. ✅ Quinzenal: 2 dias fixos configuráveis do mês (não sliding window).
7. ✅ Edição de template só afeta instâncias futuras.
8. ✅ Drawer separado + aba própria "Recorrências".
9. ✅ Empresa imutável após criação.
10. ✅ Cron via `pg_cron` no Supabase (extension disponível).
11. ✅ Cron 03:00 America/Sao_Paulo diário.

---

**Próximo passo:** Antonio revisa esta spec. Se aprovada, invoco `writing-plans` pra gerar o plano de implementação passo a passo.
