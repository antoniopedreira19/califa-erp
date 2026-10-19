-- Envio em lote para faturamento (decisão 188, entrega 1) — 19/10/2026.
--
-- A produção passa a enviar VÁRIOS jobs de um mesmo cliente e de uma mesma
-- empresa (gerencial) de uma vez, a partir da lista de Jobs, montando as
-- notas que o cliente pediu: uma nota pode juntar jobs, e um job pode ser
-- dividido entre notas (o caso do Fee Ânima: 4 jobs mensais, 18 notas, uma
-- por instituição, sem que nenhum grupo de notas inteiras feche um job).
--
-- O modelo de cada job NÃO muda: cada job do lote continua com o SEU envio
-- (`jobs_envio_faturamento`), as suas notas e as suas parcelas — o mesmo
-- registro do envio de um job só, com as mesmas travas (status, autor GP
-- ou administrador, revisão da abertura, cancelamento pendente, um envio
-- por job ou por job + mês). O que o lote acrescenta é o RASTRO entre as
-- notas do cliente e os jobs:
--
--   * `envios_faturamento_lote`: o envio em lote (cliente, empresa, mês dos
--     jobs mensais, portal, observação para o financeiro, autor);
--   * `envios_faturamento_lote_notas`: as notas que o cliente pediu —
--     tomador, CNPJ (ou exterior), valor, CNAE sugerido, descritivo e como a
--     nota foi rateada (proporcional, de um job só ou à mão);
--   * `jobs_envio_faturamento.lote_id` e `jobs_envio_faturamento_notas.
--     lote_nota_id`: a parte de cada job em cada nota do lote é uma nota do
--     envio daquele job, apontando para a nota do lote.
--
-- Regras do Tiago (19/10/2026) que o banco garante:
--   * o lote é de UM cliente e de UMA empresa gerencial: a função recusa o
--     job de outro cliente ou de outra empresa — então a nota do lote nunca
--     junta empresas, e a regra da 184 (a nota sai na empresa do job) vale;
--   * cada nota do lote fecha com a soma das partes dos jobs, e o envio de
--     cada job fecha com o valor dele (o valor é relido pela action, como no
--     envio de um job só).
--
-- Fica para as próximas entregas: a fila do financeiro e o Faturar lendo a
-- nota do lote de uma vez (entrega 2) e o "Copiar de um envio anterior"
-- (entrega 3). Mídia Off fica fora do lote (o envio dela tem as travas da
-- veiculação e o encerramento do último mês, decisão 167).
--
-- Tudo aditivo: duas tabelas novas, duas colunas novas (nulas), índices,
-- policies e a função `enviar_job_para_faturamento` aceitando dois campos
-- opcionais do lote. O envio de um job só segue igual.

-- ---------------------------------------------------------------------------
-- 1. O lote
-- ---------------------------------------------------------------------------

create table if not exists public.envios_faturamento_lote (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  cliente_id  uuid not null references public.clientes(id) on delete restrict,
  empresa_id  uuid not null references public.empresas(id) on delete restrict,
  -- O mês dos jobs mensais do lote (Fee e Always On); nulo sem mensal.
  mes         date,
  observacao  text check (observacao is null or char_length(observacao) <= 1000),
  portal_id   uuid references public.cliente_portais(id) on delete restrict,
  portal_url  text,
  enviado_por uuid references public.profiles(id),
  enviado_em  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

comment on table public.envios_faturamento_lote is
  'Envio de vários jobs de um mesmo cliente e de uma mesma empresa para faturamento de uma vez (decisão 188). Cada job continua com o seu envio em jobs_envio_faturamento, apontando para cá.';

-- "Copiar de um envio anterior" (entrega 3) lista os lotes do cliente, do
-- mais recente ao mais antigo.
create index if not exists idx_envios_lote_cliente
  on public.envios_faturamento_lote (tenant_id, cliente_id, enviado_em desc);
create index if not exists idx_envios_lote_empresa on public.envios_faturamento_lote (empresa_id);
create index if not exists idx_envios_lote_portal
  on public.envios_faturamento_lote (portal_id) where portal_id is not null;

-- ---------------------------------------------------------------------------
-- 2. As notas do lote
-- ---------------------------------------------------------------------------

create table if not exists public.envios_faturamento_lote_notas (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete restrict,
  lote_id          uuid not null references public.envios_faturamento_lote(id) on delete restrict,
  ordem            smallint not null check (ordem > 0),
  tomador_nome     text check (tomador_nome is null or char_length(tomador_nome) <= 200),
  cnpj             text,
  tomador_exterior boolean not null default false,
  valor            numeric(14,2) not null check (valor > 0),
  cnae_sugerido    text,
  descritivo       text check (descritivo is null or char_length(descritivo) <= 2000),
  rateio           text not null check (rateio in ('proporcional', 'job', 'manual')),
  created_at       timestamptz not null default now(),
  constraint uniq_lote_nota_ordem unique (lote_id, ordem),
  -- O mesmo cuidado da 700003: CHECK que dá NULL passa, então os dois lados
  -- são escritos por inteiro.
  constraint chk_lote_nota_cnpj check (
    (tomador_exterior and cnpj is null)
    or (not tomador_exterior and cnpj is not null and cnpj ~ '^[0-9]{14}$')
  )
);

comment on table public.envios_faturamento_lote_notas is
  'As notas que o cliente pediu num envio em lote (decisão 188). A parte de cada job é uma nota do envio do job com lote_nota_id apontando para cá.';

-- ---------------------------------------------------------------------------
-- 3. Os envios e as notas de cada job apontam para o lote
-- ---------------------------------------------------------------------------

alter table public.jobs_envio_faturamento
  add column if not exists lote_id uuid references public.envios_faturamento_lote(id) on delete restrict;
create index if not exists idx_envio_faturamento_lote
  on public.jobs_envio_faturamento (lote_id) where lote_id is not null;

alter table public.jobs_envio_faturamento_notas
  add column if not exists lote_nota_id uuid references public.envios_faturamento_lote_notas(id) on delete restrict;
create index if not exists idx_envio_nota_lote_nota
  on public.jobs_envio_faturamento_notas (lote_nota_id) where lote_nota_id is not null;

-- ---------------------------------------------------------------------------
-- 4. RLS, GRANT e as travas de escrita
-- ---------------------------------------------------------------------------

alter table public.envios_faturamento_lote enable row level security;
alter table public.envios_faturamento_lote_notas enable row level security;

drop policy if exists envios_lote_select on public.envios_faturamento_lote;
create policy envios_lote_select on public.envios_faturamento_lote
  for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists envios_lote_insert on public.envios_faturamento_lote;
create policy envios_lote_insert on public.envios_faturamento_lote
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists envios_lote_notas_select on public.envios_faturamento_lote_notas;
create policy envios_lote_notas_select on public.envios_faturamento_lote_notas
  for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists envios_lote_notas_insert on public.envios_faturamento_lote_notas;
create policy envios_lote_notas_insert on public.envios_faturamento_lote_notas
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

-- Envio é evento, não rascunho: sem UPDATE e sem DELETE para quem usa o app.
revoke all on public.envios_faturamento_lote from anon, authenticated;
revoke all on public.envios_faturamento_lote_notas from anon, authenticated;
grant select, insert on public.envios_faturamento_lote to authenticated;
grant select, insert on public.envios_faturamento_lote_notas to authenticated;

-- O autor do lote é quem está logado, e só o administrador ou um GP envia
-- para faturamento — a mesma régua de `envio_faturamento_autor`.
create or replace function public.envio_lote_autor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return new;
  end if;

  if not exists (
    select 1
      from public.tenant_members tm
      join public.profiles p on p.id = tm.user_id and p.ativo = true
     where tm.tenant_id = new.tenant_id
       and tm.user_id = v_uid
       and tm.status = 'ativo'
       and tm.role in ('administrador', 'gerente_producao')
  ) then
    raise exception 'Apenas o administrador ou um GP envia jobs para faturamento.'
      using errcode = '42501';
  end if;

  new.enviado_por := v_uid;
  return new;
end;
$$;

drop trigger if exists trg_envio_lote_autor on public.envios_faturamento_lote;
create trigger trg_envio_lote_autor
  before insert on public.envios_faturamento_lote
  for each row execute function public.envio_lote_autor();

-- A nota do lote só nasce junto do lote, na mesma transação (o mesmo teste
-- das notas e parcelas do envio: `now()` é o início da transação e o
-- default do lote).
create or replace function public.envio_lote_nota_guarda()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if not exists (
    select 1
      from public.envios_faturamento_lote l
     where l.id = new.lote_id
       and l.tenant_id = new.tenant_id
       and l.created_at = now()
  ) then
    raise exception 'A nota do envio em lote só nasce junto do lote.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_envio_lote_nota_guarda on public.envios_faturamento_lote_notas;
create trigger trg_envio_lote_nota_guarda
  before insert on public.envios_faturamento_lote_notas
  for each row execute function public.envio_lote_nota_guarda();

revoke all on function public.envio_lote_autor() from public, anon;
revoke all on function public.envio_lote_nota_guarda() from public, anon;

-- ---------------------------------------------------------------------------
-- 5. O envio de um job aceita o lote (dois campos opcionais)
-- ---------------------------------------------------------------------------
--
-- `lote_id` no envio e `lote_nota_id` em cada nota. Só valem para um lote
-- criado na MESMA transação e para notas daquele lote — o envio de um job
-- não se pendura num lote antigo. Sem os dois campos, o envio segue
-- exatamente como era.

create or replace function public.enviar_job_para_faturamento(payload jsonb)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_tenant_id  uuid := (payload->>'tenant_id')::uuid;
  v_job_id     uuid := (payload->>'job_id')::uuid;
  v_lote_id    uuid := nullif(payload->>'lote_id', '')::uuid;
  v_lote_nota  uuid;
  v_envio_id   uuid;
  v_nota_id    uuid;
  v_nota       jsonb;
  v_par        jsonb;
  v_ordem_nota smallint := 0;
  v_ordem_par  smallint := 0;
  v_cnpj_cad   text;
  v_primeira   date;
  v_exterior   boolean;
  v_uid        uuid := (select auth.uid());
begin
  -- 188: o lote precisa ter nascido nesta mesma transação.
  if v_lote_id is not null and not exists (
    select 1
      from public.envios_faturamento_lote l
     where l.id = v_lote_id
       and l.tenant_id = v_tenant_id
       and l.created_at = now()
  ) then
    raise exception 'O envio do job só entra num lote criado na mesma operação.'
      using errcode = '42501';
  end if;

  if payload ? 'notas' then
    if jsonb_typeof(payload->'notas') is distinct from 'array'
       or jsonb_array_length(payload->'notas') = 0 then
      raise exception 'Informe ao menos uma nota fiscal.' using errcode = 'check_violation';
    end if;
    select min((p->>'data_vencimento')::date) into v_primeira
      from jsonb_array_elements(payload->'notas') n,
           jsonb_array_elements(n->'parcelas') p;
  else
    if jsonb_typeof(payload->'parcelas') is distinct from 'array'
       or jsonb_array_length(payload->'parcelas') = 0 then
      raise exception 'Informe ao menos uma parcela de faturamento.'
        using errcode = 'check_violation';
    end if;
    v_primeira := (payload->>'data_faturamento')::date;
  end if;

  if v_primeira is null then
    raise exception 'Informe o vencimento de cada parcela.' using errcode = 'check_violation';
  end if;

  insert into jobs_envio_faturamento (
    tenant_id, job_id, valor_faturado, numero_po, data_faturamento,
    descricao_nf, portal_id, portal_url, enviado_por, mes, valor_save, lote_id
  ) values (
    v_tenant_id,
    v_job_id,
    (payload->>'valor_faturado')::numeric,
    nullif(payload->>'numero_po', ''),
    v_primeira,
    nullif(payload->>'descricao_nf', ''),
    nullif(payload->>'portal_id', '')::uuid,
    nullif(payload->>'portal_url', ''),
    nullif(payload->>'enviado_por', '')::uuid,
    nullif(payload->>'mes', '')::date,
    nullif(payload->>'valor_save', '')::numeric,
    v_lote_id
  )
  returning id into v_envio_id;

  if payload ? 'notas' then
    for v_nota in select * from jsonb_array_elements(payload->'notas')
    loop
      if jsonb_typeof(v_nota->'parcelas') is distinct from 'array'
         or jsonb_array_length(v_nota->'parcelas') = 0 then
        raise exception 'Cada nota fiscal precisa de ao menos um vencimento.'
          using errcode = 'check_violation';
      end if;

      -- 184: "Tomador no exterior, sem CNPJ" — a nota vai sem CNPJ.
      v_exterior := coalesce((v_nota->>'tomador_exterior')::boolean, false);

      -- 188: a parte do job numa nota do lote aponta para a nota do lote.
      v_lote_nota := nullif(v_nota->>'lote_nota_id', '')::uuid;
      if v_lote_nota is not null and (
        v_lote_id is null or not exists (
          select 1
            from public.envios_faturamento_lote_notas ln
           where ln.id = v_lote_nota
             and ln.lote_id = v_lote_id
        )
      ) then
        raise exception 'A nota do job só aponta para uma nota do próprio lote.'
          using errcode = '42501';
      end if;

      v_ordem_nota := v_ordem_nota + 1;
      insert into jobs_envio_faturamento_notas
        (tenant_id, envio_id, job_id, ordem, cnpj, tomador_exterior, cnae_sugerido, descritivo, lote_nota_id)
      values (
        v_tenant_id, v_envio_id, v_job_id, v_ordem_nota,
        case when v_exterior then null
             else regexp_replace(coalesce(v_nota->>'cnpj', ''), '[^0-9]', '', 'g') end,
        v_exterior,
        nullif(trim(v_nota->>'cnae_sugerido'), ''),
        nullif(trim(v_nota->>'descritivo'), ''),
        v_lote_nota
      )
      returning id into v_nota_id;

      for v_par in select * from jsonb_array_elements(v_nota->'parcelas')
      loop
        v_ordem_par := v_ordem_par + 1;
        insert into jobs_envio_faturamento_parcelas
          (tenant_id, envio_id, job_id, nota_id, ordem, valor, data_vencimento)
        values (
          v_tenant_id, v_envio_id, v_job_id, v_nota_id, v_ordem_par,
          (v_par->>'valor')::numeric, (v_par->>'data_vencimento')::date
        );
      end loop;
    end loop;
  else
    select regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g') into v_cnpj_cad
      from public.jobs j
      join public.projetos p on p.id = j.projeto_id
      join public.clientes c on c.id = p.cliente_id
     where j.id = v_job_id;

    for v_par in select * from jsonb_array_elements(payload->'parcelas')
    loop
      v_ordem_par := v_ordem_par + 1;
      insert into jobs_envio_faturamento_notas
        (tenant_id, envio_id, job_id, ordem, cnpj, descritivo)
      values (
        v_tenant_id, v_envio_id, v_job_id, v_ordem_par, v_cnpj_cad,
        nullif(trim(payload->>'descricao_nf'), '')
      )
      returning id into v_nota_id;

      insert into jobs_envio_faturamento_parcelas
        (tenant_id, envio_id, job_id, nota_id, ordem, valor, data_vencimento)
      values (
        v_tenant_id, v_envio_id, v_job_id, v_nota_id,
        coalesce((v_par->>'ordem')::smallint, v_ordem_par),
        (v_par->>'valor')::numeric, (v_par->>'data_vencimento')::date
      );
    end loop;
  end if;

  if v_ordem_par = 0 then
    raise exception 'O envio para faturamento precisa de ao menos uma parcela.'
      using errcode = 'check_violation';
  end if;

  if jsonb_typeof(payload->'anexos') = 'array' then
    insert into jobs_envio_faturamento_anexos
      (tenant_id, envio_id, job_id, path, nome_arquivo, mime_type, tamanho_bytes)
    select v_tenant_id, v_envio_id, v_job_id,
           a->>'path', a->>'nome_arquivo', a->>'mime_type', (a->>'tamanho_bytes')::bigint
      from jsonb_array_elements(payload->'anexos') a;
  end if;

  if jsonb_typeof(payload->'contatos') = 'array' then
    if jsonb_array_length(payload->'contatos') = 0 then
      raise exception 'Informe ao menos um contato de cobrança.' using errcode = 'check_violation';
    end if;

    delete from jobs_contatos
     where job_id = v_job_id
       and tenant_id = v_tenant_id
       and tipo = 'cobranca';

    insert into jobs_contatos (tenant_id, job_id, tipo, nome, numero, email, ordem, created_by)
    select v_tenant_id, v_job_id, 'cobranca',
           trim(t.c->>'nome'), nullif(trim(t.c->>'numero'), ''), trim(t.c->>'email'),
           t.n::integer, v_uid
      from jsonb_array_elements(payload->'contatos') with ordinality as t(c, n);
  end if;

  return v_envio_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. O envio em lote, numa transação só
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER, como o envio de um job: RLS, GRANT e as travas de cada
-- tabela continuam valendo. A action relê o valor de cada job e confere as
-- regras do envio (status, save, errata, mês); aqui ficam as regras que não
-- podem depender do navegador: mesmo cliente, mesma empresa, e as somas.

create or replace function public.enviar_lote_para_faturamento(payload jsonb)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_tenant_id  uuid := (payload->>'tenant_id')::uuid;
  v_cliente_id uuid := (payload->>'cliente_id')::uuid;
  v_empresa_id uuid := (payload->>'empresa_id')::uuid;
  v_lote_id    uuid;
  v_nota       jsonb;
  v_ordem      bigint;
  v_nota_id    uuid;
  v_ids        uuid[] := '{}';
  v_job        jsonb;
  v_job_id     uuid;
  v_codigo     text;
  v_notas      jsonb;
  v_envio_id   uuid;
  v_exterior   boolean;
begin
  if jsonb_typeof(payload->'jobs') is distinct from 'array'
     or jsonb_array_length(payload->'jobs') = 0 then
    raise exception 'Escolha os jobs do envio.' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(payload->'notas') is distinct from 'array'
     or jsonb_array_length(payload->'notas') = 0 then
    raise exception 'Informe ao menos uma nota fiscal.' using errcode = 'check_violation';
  end if;

  insert into envios_faturamento_lote
    (tenant_id, cliente_id, empresa_id, mes, observacao, portal_id, portal_url, enviado_por)
  values (
    v_tenant_id, v_cliente_id, v_empresa_id,
    nullif(payload->>'mes', '')::date,
    nullif(trim(payload->>'observacao'), ''),
    nullif(payload->>'portal_id', '')::uuid,
    nullif(payload->>'portal_url', ''),
    nullif(payload->>'enviado_por', '')::uuid
  )
  returning id into v_lote_id;

  for v_nota, v_ordem in
    select t.n, t.o from jsonb_array_elements(payload->'notas') with ordinality as t(n, o)
  loop
    v_exterior := coalesce((v_nota->>'tomador_exterior')::boolean, false);
    insert into envios_faturamento_lote_notas
      (tenant_id, lote_id, ordem, tomador_nome, cnpj, tomador_exterior, valor,
       cnae_sugerido, descritivo, rateio)
    values (
      v_tenant_id, v_lote_id, v_ordem::smallint,
      nullif(trim(v_nota->>'tomador_nome'), ''),
      case when v_exterior then null
           else regexp_replace(coalesce(v_nota->>'cnpj', ''), '[^0-9]', '', 'g') end,
      v_exterior,
      (v_nota->>'valor')::numeric,
      nullif(trim(v_nota->>'cnae_sugerido'), ''),
      nullif(trim(v_nota->>'descritivo'), ''),
      coalesce(nullif(v_nota->>'rateio', ''), 'proporcional')
    )
    returning id into v_nota_id;
    v_ids := v_ids || v_nota_id;
  end loop;

  for v_job in select * from jsonb_array_elements(payload->'jobs')
  loop
    v_job_id := (v_job->>'job_id')::uuid;

    -- O lote é de um cliente e de uma empresa (Tiago, 19/10/2026).
    select j.codigo into v_codigo
      from public.jobs j
      join public.projetos p on p.id = j.projeto_id
     where j.id = v_job_id
       and j.tenant_id = v_tenant_id
       and j.empresa_id = v_empresa_id
       and p.cliente_id = v_cliente_id;
    if not found then
      raise exception 'Todos os jobs do lote são do mesmo cliente e da mesma empresa.'
        using errcode = 'check_violation';
    end if;

    -- Cada parte aponta para a nota do lote pela ordem dela.
    select jsonb_agg(
             (n - 'lote_nota_ordem')
             || jsonb_build_object('lote_nota_id', v_ids[(n->>'lote_nota_ordem')::int])
           )
      into v_notas
      from jsonb_array_elements(v_job->'notas') n;
    if v_notas is null then
      raise exception 'O % não está em nenhuma nota do lote.', v_codigo
        using errcode = 'check_violation';
    end if;

    v_envio_id := public.enviar_job_para_faturamento(
      v_job || jsonb_build_object('tenant_id', v_tenant_id, 'lote_id', v_lote_id, 'notas', v_notas)
    );

    -- O envio do job fecha com o valor dele.
    if (select coalesce(sum(par.valor), 0) from jobs_envio_faturamento_parcelas par where par.envio_id = v_envio_id)
       <> (v_job->>'valor_faturado')::numeric then
      raise exception 'As partes do % nas notas não fecham com o valor dele.', v_codigo
        using errcode = 'check_violation';
    end if;
  end loop;

  -- Cada nota do lote fecha com as partes dos jobs.
  if exists (
    select 1
      from envios_faturamento_lote_notas ln
     where ln.lote_id = v_lote_id
       and ln.valor <> coalesce((
             select sum(par.valor)
               from jobs_envio_faturamento_parcelas par
               join jobs_envio_faturamento_notas n on n.id = par.nota_id
              where n.lote_nota_id = ln.id
           ), 0)
  ) then
    raise exception 'A soma das partes dos jobs não fecha com o valor de uma das notas.'
      using errcode = 'check_violation';
  end if;

  return v_lote_id;
end;
$function$;

revoke all on function public.enviar_lote_para_faturamento(jsonb) from public, anon;
grant execute on function public.enviar_lote_para_faturamento(jsonb) to authenticated;
