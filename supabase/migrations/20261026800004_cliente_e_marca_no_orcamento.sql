-- =====================================================================
-- Cliente e marca passam do projeto para o orçamento
-- (decisão 215, Tiago, 23–26/10/2026)
-- ---------------------------------------------------------------------
-- Um projeto pode ter jobs de clientes diferentes. O formulário do projeto
-- perde Cliente e Marcas; o do orçamento ganha Cliente e Marca, e o job
-- leva os do orçamento dele. Empresa e regionais continuam no projeto.
--
-- 1) `orcamentos.cliente_id` e `orcamentos.produto_id`, preenchidos com o
--    cliente e a marca do projeto em todos os orçamentos que já existem
--    (185 em 26/10: todos têm os dois). Daqui em diante é o orçamento que
--    diz o cliente. Orçamento novo sem cliente recebe o do projeto (a
--    versão anterior do app, no intervalo até a publicação).
--
-- 2) `jobs.cliente_id`: o cliente do orçamento do job, copiado e mantido
--    pelo banco — nasce com o do orçamento e acompanha a troca do cliente
--    do orçamento. É a coluna que faturamento, saves, fluxo de caixa e
--    relatórios leem, no lugar de `projetos.cliente_id`.
--
-- 3) O cliente do orçamento não muda depois que um job dele abriu no
--    financeiro (o job aberto já tem cobrança, nota e save com ele).
--
-- 4) `projetos.cliente_id` deixa de ser obrigatória (resposta do Tiago,
--    26/10: opção 1). Os projetos atuais ficam com o cliente que têm; os
--    novos nascem sem. Nada novo escreve nela; ela sai quando ninguém mais
--    a ler.
--
-- 5) As views e funções que liam o cliente do projeto do job leem
--    `jobs.cliente_id`: vw_job_rentabilidade, vw_saves_por_job,
--    vw_faturamento_pendente, vw_fluxo_caixa, emitir_faturamento,
--    enviar_job_para_faturamento, enviar_lote_para_faturamento e
--    versao_save_consumir_tudo. Com o preenchimento, o resultado de hoje é
--    o mesmo (conferido por hash das quatro views antes e depois).
--
-- Mudança destrutiva só no item 4 (NOT NULL), autorizada pelo Tiago.
-- =====================================================================

-- 1) Cliente e marca do orçamento ------------------------------------
alter table public.orcamentos
  add column if not exists cliente_id uuid references public.clientes(id) on delete restrict,
  add column if not exists produto_id uuid references public.cliente_produtos(id) on delete restrict;

create index if not exists idx_orcamentos_cliente on public.orcamentos(cliente_id);
create index if not exists idx_orcamentos_produto on public.orcamentos(produto_id);

alter table public.orcamentos disable trigger trg_orcamentos_updated_at;
update public.orcamentos o
   set cliente_id = coalesce(o.cliente_id, p.cliente_id),
       produto_id = coalesce(o.produto_id, p.produto_id)
  from public.projetos p
 where p.id = o.projeto_id
   and (o.cliente_id is null or o.produto_id is null);
alter table public.orcamentos enable trigger trg_orcamentos_updated_at;

create or replace function public.orcamento_cliente_do_projeto()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.cliente_id is null or new.produto_id is null then
    select coalesce(new.cliente_id, p.cliente_id),
           coalesce(new.produto_id, case when p.cliente_id = coalesce(new.cliente_id, p.cliente_id) then p.produto_id end)
      into new.cliente_id, new.produto_id
      from public.projetos p
     where p.id = new.projeto_id;
  end if;
  if new.cliente_id is null then
    raise exception 'Escolha o cliente do orçamento.' using errcode = '23502';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_orcamentos_cliente_do_projeto on public.orcamentos;
create trigger trg_orcamentos_cliente_do_projeto
  before insert on public.orcamentos
  for each row execute function public.orcamento_cliente_do_projeto();

alter table public.orcamentos alter column cliente_id set not null;

comment on column public.orcamentos.cliente_id is
  'Cliente do orçamento e do job dele (decisão 215). Substitui projetos.cliente_id.';
comment on column public.orcamentos.produto_id is
  'Marca do orçamento (decisão 215): é a que o job leva no envio.';

-- 2) Cliente do job ---------------------------------------------------
alter table public.jobs
  add column if not exists cliente_id uuid references public.clientes(id) on delete restrict;

create index if not exists idx_jobs_cliente on public.jobs(cliente_id);

alter table public.jobs disable trigger trg_jobs_updated_at;
update public.jobs j
   set cliente_id = o.cliente_id
  from public.orcamentos o
 where o.id = j.orcamento_id
   and j.cliente_id is null;
alter table public.jobs enable trigger trg_jobs_updated_at;

create or replace function public.job_cliente_do_orcamento()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' or new.orcamento_id is distinct from old.orcamento_id
     or new.cliente_id is null then
    select o.cliente_id into new.cliente_id
      from public.orcamentos o
     where o.id = new.orcamento_id;
  elsif new.cliente_id is distinct from old.cliente_id then
    -- O cliente do job é o do orçamento: só muda junto com ele.
    if new.cliente_id is distinct from (
      select o.cliente_id from public.orcamentos o where o.id = new.orcamento_id
    ) then
      raise exception 'O cliente do job vem do orçamento.' using errcode = '42501';
    end if;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_jobs_cliente_do_orcamento on public.jobs;
create trigger trg_jobs_cliente_do_orcamento
  before insert or update on public.jobs
  for each row execute function public.job_cliente_do_orcamento();

alter table public.jobs alter column cliente_id set not null;

comment on column public.jobs.cliente_id is
  'Cliente do job = o do orçamento (decisão 215), mantido pelo banco. É o que faturamento, saves, fluxo e relatórios leem.';

-- 3) O cliente do orçamento acompanha o job, e trava na abertura -----
create or replace function public.orcamento_cliente_segue_para_o_job()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.cliente_id is distinct from old.cliente_id then
    if exists (
      select 1 from public.jobs j
       where j.orcamento_id = new.id
         and j.data_abertura_financeiro is not null
         and j.status <> 'cancelado'
    ) then
      raise exception 'O cliente do orçamento não muda depois que o job abriu no financeiro.'
        using errcode = '42501';
    end if;
    update public.jobs
       set cliente_id = new.cliente_id
     where orcamento_id = new.id
       and cliente_id is distinct from new.cliente_id;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_orcamentos_cliente_segue_para_o_job on public.orcamentos;
create trigger trg_orcamentos_cliente_segue_para_o_job
  after update of cliente_id on public.orcamentos
  for each row execute function public.orcamento_cliente_segue_para_o_job();

-- 4) O projeto sem cliente -------------------------------------------
alter table public.projetos alter column cliente_id drop not null;

comment on column public.projetos.cliente_id is
  'LEGADO (decisão 215, 26/10/2026): o cliente agora é do orçamento (orcamentos.cliente_id) e do job (jobs.cliente_id). Projetos anteriores guardam o cliente que tinham; os novos ficam sem.';

-- 5) Quem lia o cliente do projeto do job passa a ler o do job --------
do $$
declare
  v_def  text;
  v_opts text;
  r record;
begin
  -- Views: troca `p.`/`pj.` (projetos do job) por `j.` e preserva as opções.
  for r in
    select * from (values
      ('vw_job_rentabilidade', '\mp\.cliente_id', 1),
      ('vw_saves_por_job', '\mp\.cliente_id', 1),
      ('vw_faturamento_pendente', '\mp\.cliente_id', 1),
      ('vw_fluxo_caixa', '\mpj\.cliente_id', 5)
    ) as t(nome, padrao, esperado)
  loop
    v_def := regexp_replace(pg_get_viewdef(('public.' || r.nome)::regclass, true), ';\s*$', '');
    if (select count(*) from regexp_matches(v_def, r.padrao, 'g')) <> r.esperado then
      raise exception '% mudou: esperava % ocorrência(s) de %', r.nome, r.esperado, r.padrao;
    end if;
    select array_to_string(c.reloptions, ', ') into v_opts
      from pg_class c where c.oid = ('public.' || r.nome)::regclass;
    execute 'create or replace view public.' || r.nome
      || case when v_opts is null then '' else ' with (' || v_opts || ')' end
      || ' as ' || regexp_replace(v_def, r.padrao, 'j.cliente_id', 'g');
  end loop;

  -- Funções de faturamento: o `p` delas é o projeto do job `j`.
  for r in
    select * from (values
      ('emitir_faturamento', 3),
      ('enviar_job_para_faturamento', 1),
      ('enviar_lote_para_faturamento', 1)
    ) as t(nome, esperado)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.oid = ('public.' || r.nome)::regproc;
    if (select count(*) from regexp_matches(v_def, '\mp\.cliente_id', 'g')) <> r.esperado then
      raise exception '% mudou: esperava % ocorrência(s) de p.cliente_id', r.nome, r.esperado;
    end if;
    execute regexp_replace(v_def, '\mp\.cliente_id', 'j.cliente_id', 'g');
  end loop;

  -- Saves: o cliente da versão vem do orçamento dela; o do job, do job.
  select pg_get_functiondef('public.versao_save_consumir_tudo'::regproc) into v_def;
  if position('v.save_consumo_job_id, p.cliente_id' in v_def) = 0
     or position('j.tenant_id, p.cliente_id' in v_def) = 0 then
    raise exception 'versao_save_consumir_tudo mudou';
  end if;
  v_def := replace(v_def, 'v.save_consumo_job_id, p.cliente_id', 'v.save_consumo_job_id, o.cliente_id');
  v_def := replace(v_def, 'j.tenant_id, p.cliente_id', 'j.tenant_id, j.cliente_id');
  execute v_def;
end
$$;
