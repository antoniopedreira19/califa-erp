-- =====================================================================
-- O código do job segue sempre a sigla do cliente (revisão da decisão 215,
-- Tiago, 26/10/2026)
-- ---------------------------------------------------------------------
-- Nas palavras do Tiago: "Se o cliente mudar o codigo sempre deve mudar
-- para ficar de acordo com o novo cliente." Isso revê a resposta anterior
-- ("o reenvio mantém o código") e desfaz a migration
-- 20261026800005_codigo_guardado_volta_com_cliente_trocado.
--
-- 1) `codigos_de_job_usados`: o registro dos códigos de job, no molde do
--    de orçamentos e projetos. Até aqui o próximo número saía só dos jobs
--    existentes; com o código trocado no reenvio, o número antigo sumiria
--    de `jobs` e voltaria a ser usado. O gatilho registra todo código que
--    um job recebe (no insert e em cada troca), e o backfill registra os
--    de hoje. O gerador (`lib/codigos/jobs.ts`) passa a ler daqui.
--
-- 2) `reaproveitar_codigo_do_job_devolvido` (decisão 128) volta a recusar
--    o código guardado quando a sigla do job novo é outra: com o cliente
--    trocado, o job segue com o código novo.
--
-- Aditiva: tabela nova, gatilho novo, backfill que só preenche. A RPC volta
-- ao que era antes da 20261026800005.
-- =====================================================================

-- 1) O registro --------------------------------------------------------
create table if not exists public.codigos_de_job_usados (
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  codigo        text not null,
  job_id        uuid references public.jobs(id) on delete set null,
  registrado_em timestamptz not null default now(),
  primary key (tenant_id, codigo)
);

create index if not exists codigos_de_job_usados_job_id_idx
  on public.codigos_de_job_usados(job_id);
create index if not exists codigos_de_job_usados_prefixo_idx
  on public.codigos_de_job_usados(tenant_id, codigo text_pattern_ops);

alter table public.codigos_de_job_usados enable row level security;

drop policy if exists codigos_de_job_usados_select on public.codigos_de_job_usados;
create policy codigos_de_job_usados_select on public.codigos_de_job_usados
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

revoke all on public.codigos_de_job_usados from anon;
grant select on public.codigos_de_job_usados to authenticated;

comment on table public.codigos_de_job_usados is
  'Todo código que um job já teve (revisão da decisão 215). O próximo número de job sai daqui: número não volta a ser usado.';

create or replace function public.registrar_codigo_de_job()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.codigo is not null
     and (tg_op = 'INSERT' or new.codigo is distinct from old.codigo) then
    insert into public.codigos_de_job_usados (tenant_id, codigo, job_id)
    values (new.tenant_id, new.codigo, new.id)
    on conflict (tenant_id, codigo) do nothing;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_jobs_registra_codigo on public.jobs;
create trigger trg_jobs_registra_codigo
  after insert or update of codigo on public.jobs
  for each row execute function public.registrar_codigo_de_job();

insert into public.codigos_de_job_usados (tenant_id, codigo, job_id, registrado_em)
select j.tenant_id, j.codigo, j.id, j.created_at
  from public.jobs j
 where j.codigo is not null
on conflict (tenant_id, codigo) do nothing;

-- 2) A trava da sigla volta na RPC da decisão 128 -----------------------
do $$
declare
  v_def text;
  v_ancora text := E'  select count(*)\n    into v_qtd\n';
  v_trava text := E'  if split_part(v_reserva.codigo, \'-\', 1) <> split_part(v_novo.codigo, \'-\', 1) then\n    raise exception \'O cliente do job mudou: o código reservado não vale mais.\'\n      using errcode = \'check_violation\';\n  end if;\n\n';
begin
  select pg_get_functiondef('public.reaproveitar_codigo_do_job_devolvido'::regproc) into v_def;
  if position('split_part(v_reserva.codigo' in v_def) > 0 then
    return; -- a trava já está lá
  end if;
  if position(v_ancora in v_def) = 0 then
    raise exception 'reaproveitar_codigo_do_job_devolvido mudou: não achei onde recolocar a trava da sigla';
  end if;
  execute replace(v_def, v_ancora, v_trava || v_ancora);
end
$$;
