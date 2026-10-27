-- =====================================================================
-- Marca, empresa e regional do job no registro do financeiro
-- (decisão 214, Tiago, 16–26/10/2026)
-- ---------------------------------------------------------------------
-- O registro da abertura ganha Empresa | Regional e Cliente | Marca. O
-- cliente é travado; marca, empresa e regional o financeiro confere e pode
-- trocar, e a troca vale para o JOB inteiro (produção e relatórios).
--
-- 1) `jobs.produto_id`: a marca do job. Até aqui a marca do job era só
--    texto (`jobs.produto`, copiado no envio) e os relatórios liam a do
--    PROJETO (`projetos.produto_id`). Backfill com a marca do projeto, que
--    é o que a `vw_job_rentabilidade` já mostrava: nenhum número muda.
--
-- 2) A empresa do job deixa de ser sempre a do projeto (resposta do Tiago,
--    26/10: "Só o job"). O gatilho `enforce_empresa_from_projeto` copiava a
--    empresa do projeto em TODO insert e update do job, e a troca da
--    empresa do projeto reescrevia todos os jobs dele. Agora:
--      * o job nasce com a empresa do projeto (como sempre);
--      * o job que muda de projeto pega a empresa do novo;
--      * fora disso a empresa do job fica como está — e só administrador
--        ou financeiro a troca para uma que não é a do projeto;
--      * a troca da empresa do projeto leva junto só os jobs que ainda não
--        abriram (aguardando abertura ou devolvidos). Job aberto mantém a
--        dele. Os orçamentos seguem como antes.
--    A regional continua presa à empresa (`ck_empresa_bate_regional`).
--
-- 3) `vw_job_rentabilidade.marca_id` lê a marca do job, com a do projeto
--    como reserva. A view alimenta os relatórios de Rentabilidade e de
--    Faturamento; com o backfill, o resultado de hoje é o mesmo.
--
-- Os orçamentos continuam com `enforce_empresa_from_projeto`, sem mudança.
-- =====================================================================

-- 1) A marca do job ---------------------------------------------------
alter table public.jobs
  add column if not exists produto_id uuid references public.cliente_produtos(id) on delete restrict;

create index if not exists idx_jobs_produto on public.jobs(produto_id);

comment on column public.jobs.produto_id is
  'Marca do job (decisão 214). Nasce com a marca do projeto no envio; o financeiro pode trocar no registro da abertura. `jobs.produto` guarda o nome.';

-- Só preenche: job sem marca recebe a do projeto. Sem carimbar
-- `updated_at`: nada no job mudou para quem o usa.
alter table public.jobs disable trigger trg_jobs_updated_at;
update public.jobs j
   set produto_id = p.produto_id
  from public.projetos p
 where p.id = j.projeto_id
   and j.produto_id is null
   and p.produto_id is not null;
alter table public.jobs enable trigger trg_jobs_updated_at;

-- 2) A empresa do job ------------------------------------------------
create or replace function public.empresa_do_job()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_empresa_do_projeto uuid;
  v_papel text;
begin
  select p.empresa_id into v_empresa_do_projeto
    from public.projetos p
   where p.id = new.projeto_id;

  if v_empresa_do_projeto is null then
    raise exception 'projeto % não possui empresa_id', new.projeto_id;
  end if;

  -- O job nasce com a empresa do projeto, e a do projeto novo vem junto
  -- quando ele muda de projeto.
  if tg_op = 'INSERT' or new.projeto_id is distinct from old.projeto_id then
    new.empresa_id := v_empresa_do_projeto;
    return new;
  end if;

  -- A troca para outra empresa que não a do projeto é do financeiro, no
  -- registro da abertura. A cascata do projeto (que põe a empresa do
  -- projeto) passa.
  if new.empresa_id is distinct from old.empresa_id
     and new.empresa_id is distinct from v_empresa_do_projeto
     and current_user = 'authenticated' then
    v_papel := coalesce(public.session_role()::text, '');
    if v_papel not in ('administrador', 'financeiro') then
      raise exception 'Só o financeiro troca a empresa do job.'
        using errcode = '42501';
    end if;
  end if;

  if new.empresa_id is null then
    new.empresa_id := old.empresa_id;
  end if;
  return new;
end
$function$;

comment on function public.empresa_do_job() is
  'Decisão 214: o job nasce com a empresa do projeto; depois, só o financeiro troca. Substitui enforce_empresa_from_projeto em jobs.';

drop trigger if exists trg_jobs_empresa_do_projeto on public.jobs;
create trigger trg_jobs_empresa_do_projeto
  before insert or update on public.jobs
  for each row execute function public.empresa_do_job();

create or replace function public.cascade_empresa_para_filhos()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if NEW.empresa_id is distinct from OLD.empresa_id then
    update public.orcamentos
       set empresa_id = NEW.empresa_id
     where projeto_id = NEW.id
       and empresa_id is distinct from NEW.empresa_id;

    -- Decisão 214: job aberto mantém a empresa que o financeiro registrou.
    update public.jobs
       set empresa_id = NEW.empresa_id
     where projeto_id = NEW.id
       and empresa_id is distinct from NEW.empresa_id
       and status in ('aguardando_abertura', 'rejeitado_financeiro');
  end if;
  return NEW;
end$function$;

-- 3) A marca do job nos relatórios ----------------------------------
do $$
declare
  v_def text;
begin
  v_def := regexp_replace(pg_get_viewdef('public.vw_job_rentabilidade'::regclass, true), ';\s*$', '');
  if position('p.produto_id AS marca_id' in v_def) = 0 then
    raise exception 'vw_job_rentabilidade mudou: marca_id não vem mais de p.produto_id';
  end if;
  execute 'create or replace view public.vw_job_rentabilidade with (security_invoker = true) as '
    || replace(v_def, 'p.produto_id AS marca_id', 'COALESCE(j.produto_id, p.produto_id) AS marca_id');
end
$$;
