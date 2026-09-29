-- =====================================================================
-- Decisão 123 — o envio para faturamento vira notas fiscais
-- =====================================================================
--
-- Até aqui o envio de um job ao financeiro era: um valor, uma descrição
-- da nota, uma PO e N parcelas — e CADA PARCELA virava uma nota própria.
-- Em 29/09/2026 o Tiago aprovou o formulário novo (protótipo
-- V7ki1mCF23ok99yDD8imJV):
--
--   * o envio se divide em NOTAS FISCAIS, cada uma com o próprio CNPJ do
--     cliente (tomador; campo livre, nasce com o do cadastro), CNAE
--     sugerido e descritivo (os dois opcionais);
--   * as PARCELAS passam a ser vencimentos DA MESMA NOTA ("uma nota,
--     vários vencimentos"), não notas separadas;
--   * a PO ganha anexos (opcionais, vários arquivos);
--   * os contatos de cobrança da abertura se revisam no envio, e o que
--     mudar vale para o job (D1).
--
-- O que esta migration faz:
--
-- 1. `jobs_envio_faturamento_notas` — uma linha por nota do envio. NÃO tem
--    coluna de valor: o valor da nota é a soma das parcelas dela. Assim a
--    edição do orçado pelo financeiro (decisão 115), que reescreve o valor
--    das PARCELAS, não precisa saber que a nota existe, e nota e parcelas
--    nunca divergem.
-- 2. `jobs_envio_faturamento_parcelas.nota_id` — a parcela aponta para a
--    nota. A parcela continua sendo a unidade de saldo do financeiro
--    (`faturamento_itens.envio_parcela_id`, `emitir_faturamento`,
--    `job_esta_faturado`, `save_rateio_das_notas`): nada disso muda.
--    Backfill: o único envio gravado até hoje (TES-1001/26, de teste)
--    tinha o significado antigo, então cada parcela dele vira uma nota —
--    com o CNPJ do cadastro do cliente e a descrição do envio.
-- 3. `jobs_envio_faturamento_anexos` + bucket `envios-faturamento` — os
--    arquivos da PO. O navegador sobe direto ao Storage (Server Action tem
--    teto de 1 MB, decisão 110) no caminho `{tenant}/{job}/{uuid}-{nome}`;
--    o envio grava as linhas.
-- 4. `enviar_job_para_faturamento` — aceita o payload novo (`notas`,
--    `anexos`, `contatos`) e CONTINUA aceitando o antigo (`parcelas` +
--    `descricao_nf`): a migration vale na hora para o app que está no ar,
--    que só conhece o payload antigo. No antigo, cada parcela vira uma
--    nota, que é o que ela significava.
-- 5. As guardas da decisão 117 estendidas às tabelas novas: nota e anexo
--    só nascem junto do envio, na mesma transação; alterar é do financeiro;
--    ninguém apaga pela API.
--
-- De fora, de propósito:
--   * `jobs_envio_faturamento.descricao_nf` e `data_faturamento` ficam. O
--     envio novo grava `descricao_nf` nulo (o descritivo é por nota) e
--     `data_faturamento` = o vencimento mais cedo, que é o que a coluna
--     sempre foi (o vencimento da 1ª parcela).
--   * O CNPJ na nota emitida e a conferência da nota agrupada por CNPJ
--     (D4) estão na migration seguinte, `...500002`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Notas do envio
-- ---------------------------------------------------------------------

create table if not exists public.jobs_envio_faturamento_notas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  envio_id      uuid not null references public.jobs_envio_faturamento(id) on delete cascade,
  job_id        uuid not null references public.jobs(id) on delete cascade,
  ordem         smallint not null,
  cnpj          text not null,
  cnae_sugerido text,
  descritivo    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint chk_envio_nota_ordem_positiva check (ordem >= 1),
  constraint chk_envio_nota_cnpj check (cnpj ~ '^[0-9]{14}$'),
  constraint chk_envio_nota_cnae check (cnae_sugerido is null or length(cnae_sugerido) between 1 and 60),
  constraint chk_envio_nota_descritivo check (descritivo is null or length(descritivo) between 1 and 2000),
  constraint uniq_envio_nota_ordem unique (envio_id, ordem)
);

comment on table public.jobs_envio_faturamento_notas is
  'Decisão 123: as notas fiscais de um envio para faturamento. O valor da nota é a soma das parcelas dela (jobs_envio_faturamento_parcelas.nota_id).';
comment on column public.jobs_envio_faturamento_notas.cnpj is
  'CNPJ do cliente tomador, só dígitos. Campo livre no envio: nasce com o do cadastro do cliente e pode ser outro.';
comment on column public.jobs_envio_faturamento_notas.cnae_sugerido is
  'Sugestão da produção. No Faturar aparece como texto de fundo do CNAE, sem preencher (D3).';

create index if not exists idx_envio_nota_envio on public.jobs_envio_faturamento_notas (envio_id);
create index if not exists idx_envio_nota_job on public.jobs_envio_faturamento_notas (job_id);
create index if not exists idx_envio_nota_tenant on public.jobs_envio_faturamento_notas (tenant_id);

alter table public.jobs_envio_faturamento_notas enable row level security;

drop policy if exists envio_notas_select on public.jobs_envio_faturamento_notas;
create policy envio_notas_select on public.jobs_envio_faturamento_notas
  for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists envio_notas_insert on public.jobs_envio_faturamento_notas;
create policy envio_notas_insert on public.jobs_envio_faturamento_notas
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
drop policy if exists envio_notas_update on public.jobs_envio_faturamento_notas;
create policy envio_notas_update on public.jobs_envio_faturamento_notas
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Sem DELETE: envio é evento, não rascunho (o mesmo das parcelas).
grant select, insert, update on public.jobs_envio_faturamento_notas to authenticated;
revoke all on public.jobs_envio_faturamento_notas from anon;

-- ---------------------------------------------------------------------
-- 2. A parcela aponta para a nota
-- ---------------------------------------------------------------------

alter table public.jobs_envio_faturamento_parcelas
  add column if not exists nota_id uuid references public.jobs_envio_faturamento_notas(id) on delete cascade;

create index if not exists idx_envio_parcela_nota on public.jobs_envio_faturamento_parcelas (nota_id);

comment on column public.jobs_envio_faturamento_parcelas.nota_id is
  'Decisão 123: a nota do envio a que esta parcela (vencimento) pertence.';

-- Backfill: cada parcela antiga vira uma nota (era o que ela significava),
-- com o CNPJ do cadastro do cliente do job e a descrição do envio. Só
-- preenche o que está vazio.
do $$
declare
  r      record;
  v_nota uuid;
  v_cnpj text;
begin
  for r in
    select par.id as parcela_id, par.tenant_id, par.envio_id, par.job_id, par.ordem,
           e.descricao_nf,
           regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g') as cnpj
      from public.jobs_envio_faturamento_parcelas par
      join public.jobs_envio_faturamento e on e.id = par.envio_id
      join public.jobs j on j.id = par.job_id
      join public.projetos p on p.id = j.projeto_id
      join public.clientes c on c.id = p.cliente_id
     where par.nota_id is null
     order by par.envio_id, par.ordem
  loop
    v_cnpj := r.cnpj;
    if v_cnpj !~ '^[0-9]{14}$' then
      raise exception 'Backfill da 123: o cliente do job % não tem CNPJ de 14 dígitos.', r.job_id;
    end if;

    insert into public.jobs_envio_faturamento_notas
      (tenant_id, envio_id, job_id, ordem, cnpj, descritivo)
    values
      (r.tenant_id, r.envio_id, r.job_id, r.ordem, v_cnpj, nullif(trim(r.descricao_nf), ''))
    returning id into v_nota;

    update public.jobs_envio_faturamento_parcelas
       set nota_id = v_nota
     where id = r.parcela_id;
  end loop;
end
$$;

alter table public.jobs_envio_faturamento_parcelas
  alter column nota_id set not null;

-- ---------------------------------------------------------------------
-- 3. Anexos da PO
-- ---------------------------------------------------------------------

create table if not exists public.jobs_envio_faturamento_anexos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  envio_id       uuid not null references public.jobs_envio_faturamento(id) on delete cascade,
  job_id         uuid not null references public.jobs(id) on delete cascade,
  path           text not null,
  nome_arquivo   text not null,
  mime_type      text not null,
  tamanho_bytes  bigint not null,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  constraint chk_envio_anexo_tamanho check (tamanho_bytes > 0 and tamanho_bytes <= 10485760),
  constraint chk_envio_anexo_mime check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  constraint chk_envio_anexo_nome check (length(trim(nome_arquivo)) between 1 and 255),
  constraint uniq_envio_anexo_path unique (path)
);

comment on table public.jobs_envio_faturamento_anexos is
  'Decisão 123: arquivos da PO anexados no envio para faturamento. O arquivo mora no bucket envios-faturamento, em {tenant}/{job}/...';

create index if not exists idx_envio_anexo_envio on public.jobs_envio_faturamento_anexos (envio_id);
create index if not exists idx_envio_anexo_job on public.jobs_envio_faturamento_anexos (job_id);
create index if not exists idx_envio_anexo_tenant on public.jobs_envio_faturamento_anexos (tenant_id);

alter table public.jobs_envio_faturamento_anexos enable row level security;

drop policy if exists envio_anexos_select on public.jobs_envio_faturamento_anexos;
create policy envio_anexos_select on public.jobs_envio_faturamento_anexos
  for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists envio_anexos_insert on public.jobs_envio_faturamento_anexos;
create policy envio_anexos_insert on public.jobs_envio_faturamento_anexos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

-- Anexo é registro do envio: sem UPDATE nem DELETE pela API.
grant select, insert on public.jobs_envio_faturamento_anexos to authenticated;
revoke all on public.jobs_envio_faturamento_anexos from anon;

insert into storage.buckets (id, name, public)
values ('envios-faturamento', 'envios-faturamento', false)
on conflict (id) do nothing;

-- O mesmo recorte do bucket das PPs: membro do tenant do primeiro
-- segmento do caminho. DELETE existe para quem desiste de um anexo antes
-- de enviar; depois do envio o registro fica na tabela.
drop policy if exists envios_faturamento_storage_select on storage.objects;
create policy envios_faturamento_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'envios-faturamento' and public.is_tenant_member((split_part(name, '/', 1))::uuid));
drop policy if exists envios_faturamento_storage_insert on storage.objects;
create policy envios_faturamento_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'envios-faturamento' and public.is_tenant_member((split_part(name, '/', 1))::uuid));
drop policy if exists envios_faturamento_storage_delete on storage.objects;
create policy envios_faturamento_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'envios-faturamento' and public.is_tenant_member((split_part(name, '/', 1))::uuid));

-- ---------------------------------------------------------------------
-- 4. Guardas (decisão 117) nas tabelas novas
-- ---------------------------------------------------------------------

create or replace function public.envio_nota_guarda_escrita_direta()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(public.session_role()::text, '') not in ('administrador', 'financeiro') then
      raise exception 'Só o financeiro altera a nota de um envio para faturamento.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- A nota só nasce com o envio, na mesma transação (o mesmo teste da
  -- parcela: `now()` é o início da transação e o default do envio).
  if not exists (
    select 1
      from public.jobs_envio_faturamento e
     where e.id = new.envio_id
       and e.job_id = new.job_id
       and e.tenant_id = new.tenant_id
       and e.created_at = now()
  ) then
    raise exception 'A nota do envio para faturamento só nasce junto do envio.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function public.envio_nota_guarda_escrita_direta() from public, anon;

drop trigger if exists trg_envio_nota_guarda_escrita_direta on public.jobs_envio_faturamento_notas;
create trigger trg_envio_nota_guarda_escrita_direta
  before insert or update on public.jobs_envio_faturamento_notas
  for each row execute function public.envio_nota_guarda_escrita_direta();

create or replace function public.envio_anexo_guarda_escrita_direta()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if not exists (
    select 1
      from public.jobs_envio_faturamento e
     where e.id = new.envio_id
       and e.job_id = new.job_id
       and e.tenant_id = new.tenant_id
       and e.created_at = now()
  ) then
    raise exception 'O anexo do envio para faturamento só nasce junto do envio.'
      using errcode = '42501';
  end if;

  -- O arquivo precisa estar na pasta do job, no tenant do envio.
  if split_part(new.path, '/', 1) <> new.tenant_id::text
     or split_part(new.path, '/', 2) <> new.job_id::text then
    raise exception 'O anexo precisa estar na pasta do job.' using errcode = '42501';
  end if;

  new.created_by := (select auth.uid());
  return new;
end;
$function$;

revoke all on function public.envio_anexo_guarda_escrita_direta() from public, anon;

drop trigger if exists trg_envio_anexo_guarda_escrita_direta on public.jobs_envio_faturamento_anexos;
create trigger trg_envio_anexo_guarda_escrita_direta
  before insert on public.jobs_envio_faturamento_anexos
  for each row execute function public.envio_anexo_guarda_escrita_direta();

-- A parcela nova precisa apontar para uma nota do MESMO envio.
create or replace function public.envio_parcela_nota_do_mesmo_envio()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1
      from public.jobs_envio_faturamento_notas n
     where n.id = new.nota_id
       and n.envio_id = new.envio_id
       and n.job_id = new.job_id
  ) then
    raise exception 'A parcela precisa pertencer a uma nota do mesmo envio.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

revoke all on function public.envio_parcela_nota_do_mesmo_envio() from public, anon;

drop trigger if exists trg_envio_parcela_nota_do_mesmo_envio on public.jobs_envio_faturamento_parcelas;
create trigger trg_envio_parcela_nota_do_mesmo_envio
  before insert or update of nota_id on public.jobs_envio_faturamento_parcelas
  for each row execute function public.envio_parcela_nota_do_mesmo_envio();

-- ---------------------------------------------------------------------
-- 5. A RPC do envio
-- ---------------------------------------------------------------------

create or replace function public.enviar_job_para_faturamento(payload jsonb)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_tenant_id  uuid := (payload->>'tenant_id')::uuid;
  v_job_id     uuid := (payload->>'job_id')::uuid;
  v_envio_id   uuid;
  v_nota_id    uuid;
  v_nota       jsonb;
  v_par        jsonb;
  v_ordem_nota smallint := 0;
  v_ordem_par  smallint := 0;
  v_cnpj_cad   text;
  v_primeira   date;
  v_uid        uuid := (select auth.uid());
begin
  -- O vencimento mais cedo é a "data de faturamento" do envio — no
  -- payload antigo ela vem pronta; no novo, sai das parcelas das notas.
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
    descricao_nf, portal_id, portal_url, enviado_por, mes, valor_save
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
    nullif(payload->>'valor_save', '')::numeric
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

      v_ordem_nota := v_ordem_nota + 1;
      insert into jobs_envio_faturamento_notas
        (tenant_id, envio_id, job_id, ordem, cnpj, cnae_sugerido, descritivo)
      values (
        v_tenant_id, v_envio_id, v_job_id, v_ordem_nota,
        regexp_replace(coalesce(v_nota->>'cnpj', ''), '[^0-9]', '', 'g'),
        nullif(trim(v_nota->>'cnae_sugerido'), ''),
        nullif(trim(v_nota->>'descritivo'), '')
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
    -- Payload antigo (o app que ainda não conhece as notas): cada parcela
    -- vira uma nota, com o CNPJ do cadastro do cliente e a descrição do
    -- envio — o significado que a parcela tinha.
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

  -- Anexos da PO: o arquivo já subiu ao Storage; aqui só o registro.
  if jsonb_typeof(payload->'anexos') = 'array' then
    insert into jobs_envio_faturamento_anexos
      (tenant_id, envio_id, job_id, path, nome_arquivo, mime_type, tamanho_bytes)
    select v_tenant_id, v_envio_id, v_job_id,
           a->>'path', a->>'nome_arquivo', a->>'mime_type', (a->>'tamanho_bytes')::bigint
      from jsonb_array_elements(payload->'anexos') a;
  end if;

  -- Contatos de cobrança revistos no envio (D1): a lista do job passa a
  -- ser esta. Só quando o payload traz a lista — o app antigo não traz.
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
