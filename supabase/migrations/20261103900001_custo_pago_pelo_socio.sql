-- Decisão 236 (03/11/2026): o custo pago pelo sócio no realizado do job.
--
-- A Ventura é uma joint venture: parte dos itens dos jobs dela a California
-- paga (PP, como sempre), parte a Robotech paga. O custo da Robotech precisa
-- destrinchar o realizado do item sem virar PP: sem código, sem título, sem
-- passar pelo financeiro.
--
-- 1. `empresas_socio_de_custos`: a marcação de que os jobs de uma empresa
--    gerencial têm um sócio que paga custos, e o nome dele ("Robotech"). É
--    tabela própria, e não coluna em `empresas`, para não mexer no cadastro
--    de outro módulo. Sem policy de escrita: muda só por migration.
-- 2. `jobs_custos_do_socio`: o custo, ligado à linha de realizado do item,
--    com o mesmo trio da planilha (R$ Unit. × QT × D/M), data, quem o sócio
--    pagou (texto livre), comprovante (opcional) e observação.
-- 3. `recalcular_realizado_do_item` passa a somar os custos do sócio às PPs.
--    A quebra R$ Unit. · QT · D/M continua só com UM lançamento no item —
--    agora contando PP e custo do sócio juntos.
--
-- O gatilho de proteção confere o que a tela não garante sozinha: a linha é
-- do job, o job é de empresa com sócio, e o job está aberto (o custo do
-- sócio não tem "a emitir": na pré-abertura ele não entra).

-- 1. A marcação da empresa ----------------------------------------------
create table public.empresas_socio_de_custos (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  socio text not null check (length(btrim(socio)) between 1 and 60),
  created_at timestamptz not null default now()
);

alter table public.empresas_socio_de_custos enable row level security;

create policy empresas_socio_de_custos_select on public.empresas_socio_de_custos
  for select to authenticated
  using (is_tenant_member(tenant_id));

grant select on public.empresas_socio_de_custos to authenticated;
revoke all on public.empresas_socio_de_custos from anon;

-- A Ventura e a Robotech (preenche vazio: a tabela nasce agora).
insert into public.empresas_socio_de_custos (empresa_id, tenant_id, socio)
select e.id, e.tenant_id, 'Robotech'
  from public.empresas e
 where e.nome_fantasia = 'Ventura'
on conflict (empresa_id) do nothing;

-- 2. O custo ------------------------------------------------------------
create table public.jobs_custos_do_socio (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  job_id uuid not null references public.jobs(id) on delete cascade,
  item_realizado_id uuid not null references public.jobs_itens_realizado(id),
  -- O nome do sócio na hora do lançamento (o gatilho preenche).
  socio text not null,
  descricao text not null check (length(btrim(descricao)) between 1 and 300),
  fornecedor_nome text check (fornecedor_nome is null or length(btrim(fornecedor_nome)) between 1 and 200),
  valor_unitario numeric(14,2) not null check (valor_unitario > 0),
  quantidade numeric(12,3) not null check (quantidade > 0),
  dias_meses numeric(12,3) not null check (dias_meses > 0),
  valor numeric(14,2) generated always as (round(valor_unitario * quantidade * dias_meses, 2)) stored,
  data_gasto date not null,
  comprovante_path text,
  comprovante_nome text,
  observacao text check (observacao is null or length(observacao) <= 1000),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint jobs_custos_do_socio_comprovante_inteiro
    check ((comprovante_path is null) = (comprovante_nome is null))
);

create index jobs_custos_do_socio_job_idx on public.jobs_custos_do_socio (job_id);
create index jobs_custos_do_socio_item_idx on public.jobs_custos_do_socio (item_realizado_id);
create index jobs_custos_do_socio_tenant_idx on public.jobs_custos_do_socio (tenant_id);

alter table public.jobs_custos_do_socio enable row level security;

-- Mesmo recorte da linha de realizado: membro do tenant; o freelancer só
-- nos jobs dos projetos dele. Quem pode lançar (o papel que gera PP) a
-- action confere.
create policy jobs_custos_do_socio_select on public.jobs_custos_do_socio
  for select to authenticated
  using (
    is_tenant_member(tenant_id)
    and (
      session_role() <> 'freelancer'::app_role
      or exists (
        select 1 from public.jobs j
         where j.id = jobs_custos_do_socio.job_id
           and is_freelancer_do_projeto(j.projeto_id)
      )
    )
  );

create policy jobs_custos_do_socio_insert on public.jobs_custos_do_socio
  for insert to authenticated
  with check (
    is_tenant_member(tenant_id)
    and (
      session_role() <> 'freelancer'::app_role
      or exists (
        select 1 from public.jobs j
         where j.id = jobs_custos_do_socio.job_id
           and is_freelancer_do_projeto(j.projeto_id)
      )
    )
  );

create policy jobs_custos_do_socio_update on public.jobs_custos_do_socio
  for update to authenticated
  using (
    is_tenant_member(tenant_id)
    and (
      session_role() <> 'freelancer'::app_role
      or exists (
        select 1 from public.jobs j
         where j.id = jobs_custos_do_socio.job_id
           and is_freelancer_do_projeto(j.projeto_id)
      )
    )
  )
  with check (
    is_tenant_member(tenant_id)
    and (
      session_role() <> 'freelancer'::app_role
      or exists (
        select 1 from public.jobs j
         where j.id = jobs_custos_do_socio.job_id
           and is_freelancer_do_projeto(j.projeto_id)
      )
    )
  );

create policy jobs_custos_do_socio_delete on public.jobs_custos_do_socio
  for delete to authenticated
  using (
    is_tenant_member(tenant_id)
    and (
      session_role() <> 'freelancer'::app_role
      or exists (
        select 1 from public.jobs j
         where j.id = jobs_custos_do_socio.job_id
           and is_freelancer_do_projeto(j.projeto_id)
      )
    )
  );

grant select, insert, update, delete on public.jobs_custos_do_socio to authenticated;
revoke all on public.jobs_custos_do_socio from anon;

-- A trava: linha do job, empresa com sócio, job aberto.
create or replace function public.custo_do_socio_confere()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_linha  record;
  v_job    record;
  v_socio  text;
  v_alvo   public.jobs_custos_do_socio;
begin
  if tg_op = 'DELETE' then
    v_alvo := old;
  else
    v_alvo := new;
  end if;

  select j.id, j.tenant_id, j.status, j.empresa_id
    into v_job
    from public.jobs j
   where j.id = v_alvo.job_id;

  if v_job.status not in ('aberto', 'em_producao') then
    raise exception 'O custo do sócio só se lança, edita ou exclui com o job aberto.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  select r.id, r.job_id, r.tenant_id
    into v_linha
    from public.jobs_itens_realizado r
   where r.id = new.item_realizado_id;

  if v_linha.id is null or v_linha.job_id <> new.job_id or v_linha.tenant_id <> new.tenant_id
     or v_job.tenant_id <> new.tenant_id then
    raise exception 'A linha do custo não é deste job.'
      using errcode = 'check_violation';
  end if;

  select s.socio into v_socio
    from public.empresas_socio_de_custos s
   where s.empresa_id = v_job.empresa_id;

  if v_socio is null then
    raise exception 'A empresa deste job não tem sócio que pague custos.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    new.socio := v_socio;
    new.created_at := now();
  else
    -- O custo não muda de job nem de linha, e quem lançou fica.
    new.job_id := old.job_id;
    new.item_realizado_id := old.item_realizado_id;
    new.socio := old.socio;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_custo_do_socio_confere
  before insert or update or delete on public.jobs_custos_do_socio
  for each row execute function public.custo_do_socio_confere();

-- O realizado do item acompanha.
create or replace function public.custo_do_socio_recalcula_realizado()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalcular_realizado_do_item(old.item_realizado_id);
    return old;
  end if;
  perform public.recalcular_realizado_do_item(new.item_realizado_id);
  return new;
end;
$$;

create trigger trg_custo_do_socio_recalcula_realizado
  after insert or delete or update of valor_unitario, quantidade, dias_meses on public.jobs_custos_do_socio
  for each row execute function public.custo_do_socio_recalcula_realizado();

-- 3. O realizado soma os dois -------------------------------------------
create or replace function public.recalcular_realizado_do_item(p_item_realizado_id uuid)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_total       numeric;
  v_qtd         numeric;
  v_unit        numeric;
  v_dm          numeric;
  v_n_pps       integer;
  v_devolvido   numeric;
  v_n_socio     integer;
  v_total_socio numeric;
  v_qtd_socio   numeric;
  v_unit_socio  numeric;
  v_dm_socio    numeric;
begin
  if p_item_realizado_id is null then
    return;
  end if;

  -- Toda PP que existe no item pesa; só o cancelamento tira (11/09/2026).
  select count(*),
         coalesce(sum(valor), 0),
         coalesce(sum(quantidade), 0),
         coalesce(sum(valor_unitario), 0),
         coalesce(sum(dias_meses), 0)
    into v_n_pps, v_total, v_qtd, v_unit, v_dm
    from public.pedidos_compra
   where item_realizado_id = p_item_realizado_id
     and status <> 'cancelada';

  -- Decisão 236: o custo pago pelo sócio (Robotech, nos jobs da Ventura)
  -- entra no realizado ao lado das PPs.
  select count(*),
         coalesce(sum(valor), 0),
         coalesce(sum(quantidade), 0),
         coalesce(sum(valor_unitario), 0),
         coalesce(sum(dias_meses), 0)
    into v_n_socio, v_total_socio, v_qtd_socio, v_unit_socio, v_dm_socio
    from public.jobs_custos_do_socio
   where item_realizado_id = p_item_realizado_id;

  -- Só a prestação APROVADA desconta o saldo (decisão 081): enviada ou
  -- reprovada, ninguém conferiu ainda o que foi gasto.
  select coalesce(sum(pv.valor_devolvido), 0)
    into v_devolvido
    from public.pp_verba_prestacoes pv
    join public.pedidos_compra pp on pp.id = pv.pedido_compra_id
   where pp.item_realizado_id = p_item_realizado_id
     and pp.status <> 'cancelada'
     and pv.status = 'aprovada';

  -- A decomposição (R$ Unit. · QT · D/M) só faz sentido com UM lançamento
  -- no item, PP ou custo do sócio: com dois, somar unitários seria ficção.
  if v_n_pps + v_n_socio <> 1 then
    v_unit := 0;
    v_qtd  := 0;
    v_dm   := 0;
  elsif v_n_socio = 1 then
    v_unit := v_unit_socio;
    v_qtd  := v_qtd_socio;
    v_dm   := v_dm_socio;
  end if;

  update public.jobs_itens_realizado
     set total_realizado          = round(v_total + v_total_socio - v_devolvido, 2),
         quantidade_realizada     = v_qtd,
         dias_meses_realizado     = v_dm,
         valor_unitario_realizado = round(v_unit, 2)
   where id = p_item_realizado_id;
end;
$function$;
