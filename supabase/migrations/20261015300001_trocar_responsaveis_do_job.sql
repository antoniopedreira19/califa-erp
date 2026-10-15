-- =====================================================================
-- Trocar o GP e o Produtor Responsáveis de um job aberto, e o GP de fora
-- do projeto entrando sozinho nos GPs do projeto — decisão 175 (15/10/2026)
--
-- Pedido do Tiago (14/10/2026), com o protótipo "Trocar os responsáveis"
-- aprovado em 15/10/2026 (opções 1A e 2A):
--
--   * o GP ou o administrador (qualquer GP, não só o do job) troca o GP e o
--     Produtor Responsáveis de job aberto, pelo pop-up "Equipe" da decisão
--     174 — sem errata e sem passar pelo financeiro;
--   * o novo GP pode ser qualquer membro ativo com o papel GP ou
--     Administrador; quem ainda não é GP Responsável do projeto passa a ser;
--   * o novo produtor tem o papel Produtor (decisão 168);
--   * a troca do produtor desliga a chave do envio de PP (o gatilho da 174
--     já faz isso);
--   * a troca fica registrada e vira card na Comunicação do job.
--
-- E, na mesma resposta, a regra vale também ANTES do job: o GP do orçamento
-- (Novo orçamento, editor, agregada e envio para abertura) pode ser
-- qualquer GP, e quem vem de fora entra nos GPs Responsáveis do projeto.
-- Isso revisa a regra 3 da decisão 170 (a lista só com os GPs do projeto).
--
-- Tudo aqui é aditivo: uma tabela, três funções e um gatilho. Nenhum dado
-- existente muda. O gatilho novo só barra a escrita DIRETA do GP e do
-- produtor de job já aberto — nenhuma tela grava esses campos depois da
-- abertura desde a 174 (o reenvio da abertura devolvida grava, com o job
-- em `rejeitado_financeiro`, e continua podendo).
-- =====================================================================

-- ---- O registro da troca ----------------------------------------------
-- Cada troca é uma linha: a Comunicação do job monta o card a partir dela,
-- como monta o da errata (nada de texto guardado).
create table if not exists public.jobs_trocas_de_responsavel (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete cascade,
  papel text not null check (papel in ('gp', 'produtor')),
  de_id uuid references public.profiles(id) on delete restrict,
  para_id uuid not null references public.profiles(id) on delete restrict,
  por_id uuid not null references public.profiles(id) on delete restrict,
  em timestamptz not null default now(),
  -- A chave do envio de PP estava ligada e a troca do produtor a desligou.
  chave_desligou boolean not null default false,
  -- O novo GP não era GP Responsável do projeto e passou a ser.
  entrou_nos_gps_do_projeto boolean not null default false
);

comment on table public.jobs_trocas_de_responsavel is
  'Decisão 175: cada troca do GP ou do Produtor Responsável de job aberto. Grava só trocar_responsavel_do_job; a Comunicação do job mostra um card por linha.';

create index if not exists idx_jobs_trocas_de_responsavel_job
  on public.jobs_trocas_de_responsavel (job_id, em);
create index if not exists idx_jobs_trocas_de_responsavel_tenant
  on public.jobs_trocas_de_responsavel (tenant_id);

alter table public.jobs_trocas_de_responsavel enable row level security;

-- Quem vê o job vê as trocas dele: a política de `jobs` decide (o
-- financeiro só vê job aberto, decisão 113; o freelancer, os dele).
drop policy if exists jobs_trocas_de_responsavel_select on public.jobs_trocas_de_responsavel;
create policy jobs_trocas_de_responsavel_select
  on public.jobs_trocas_de_responsavel
  for select
  to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1 from public.jobs j where j.id = jobs_trocas_de_responsavel.job_id
    )
  );

-- Sem política de escrita: só a função grava.
revoke all on public.jobs_trocas_de_responsavel from public, anon;
grant select on public.jobs_trocas_de_responsavel to authenticated;

-- ---- O GP de fora entra nos GPs do projeto -------------------------------
-- Usada no orçamento (criar, editar, envio para abertura) e na troca do GP
-- do job. Devolve `true` quando a pessoa entrou agora. Quem já estava como
-- acréscimo da Equipe (`papel = 'equipe'`) vira GP: a chave da tabela é
-- (projeto, pessoa), e não há política de UPDATE — por isso a função.
create or replace function public.incluir_gp_no_projeto(
  p_projeto_id uuid,
  p_profile_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tenant uuid;
  v_papel text;
  v_nome text;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.';
  end if;

  select tenant_id into v_tenant from public.projetos where id = p_projeto_id;
  if v_tenant is null or not public.is_tenant_member(v_tenant) then
    raise exception 'Projeto não encontrado.';
  end if;

  -- Quem escolhe GP: quem cria e edita orçamento (GP, produtor e
  -- administrador).
  if not exists (
    select 1 from public.tenant_members tm
     where tm.user_id = v_uid and tm.tenant_id = v_tenant and tm.status = 'ativo'
       and tm.role in ('administrador', 'gerente_producao', 'produtor')
  ) then
    raise exception 'Sem permissão para mudar os GPs do projeto.' using errcode = '42501';
  end if;

  -- Só entra quem pode ser GP (decisão 170).
  if not exists (
    select 1
      from public.tenant_members tm
      join public.profiles p on p.id = tm.user_id
     where tm.user_id = p_profile_id and tm.tenant_id = v_tenant
       and tm.status = 'ativo' and p.ativo
       and tm.role in ('gerente_producao', 'administrador')
  ) then
    select nome into v_nome from public.profiles where id = p_profile_id;
    raise exception '% não pode ser GP: no cadastro de usuários, não está ativo com o papel GP.',
      coalesce(v_nome, 'Esta pessoa') using errcode = '42501';
  end if;

  select papel into v_papel
    from public.projeto_responsaveis
   where projeto_id = p_projeto_id and profile_id = p_profile_id;

  if v_papel = 'gp' then
    return false;
  end if;

  if v_papel is not null then
    update public.projeto_responsaveis
       set papel = 'gp'
     where projeto_id = p_projeto_id and profile_id = p_profile_id;
  else
    insert into public.projeto_responsaveis (projeto_id, profile_id, tenant_id, papel)
    values (p_projeto_id, p_profile_id, v_tenant, 'gp');
  end if;
  return true;
end;
$$;

-- ---- A troca ------------------------------------------------------------
create or replace function public.trocar_responsavel_do_job(
  p_job_id uuid,
  p_papel text,
  p_para uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_job record;
  v_de uuid;
  v_nome text;
  v_entrou boolean := false;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.';
  end if;
  if p_papel not in ('gp', 'produtor') then
    raise exception 'Responsável inválido.';
  end if;

  select id, tenant_id, projeto_id, status, responsavel_id, produtor_id, produtor_envia_pp
    into v_job
    from public.jobs
   where id = p_job_id
   for update;
  if not found or not public.is_tenant_member(v_job.tenant_id) then
    raise exception 'Job não encontrado.';
  end if;

  if not (
    public.is_tenant_admin(v_job.tenant_id)
    or exists (
      select 1 from public.tenant_members tm
       where tm.user_id = v_uid and tm.tenant_id = v_job.tenant_id
         and tm.status = 'ativo' and tm.role = 'gerente_producao')
  ) then
    raise exception 'Só o GP ou o administrador troca os responsáveis do job.' using errcode = '42501';
  end if;

  if v_job.status = 'cancelado' then
    raise exception 'Job cancelado não muda mais.';
  end if;
  if v_job.status in ('encerrado', 'finalizado') then
    raise exception 'O job já foi encerrado: os responsáveis não mudam mais.';
  end if;
  if v_job.status not in ('aberto', 'em_producao') then
    raise exception 'Antes da abertura, o GP e o produtor se escolhem no envio para abertura, na tela do orçamento.';
  end if;

  select nome into v_nome from public.profiles where id = p_para;

  if p_papel = 'gp' then
    v_de := v_job.responsavel_id;
    if v_de is not distinct from p_para then
      return;
    end if;
    -- `incluir_gp_no_projeto` confere se a pessoa pode ser GP.
    if v_job.projeto_id is not null then
      v_entrou := public.incluir_gp_no_projeto(v_job.projeto_id, p_para);
    elsif not exists (
      select 1 from public.tenant_members tm join public.profiles p on p.id = tm.user_id
       where tm.user_id = p_para and tm.tenant_id = v_job.tenant_id and tm.status = 'ativo'
         and p.ativo and tm.role in ('gerente_producao', 'administrador')
    ) then
      raise exception '% não pode ser GP: no cadastro de usuários, não está ativo com o papel GP.',
        coalesce(v_nome, 'Esta pessoa') using errcode = '42501';
    end if;
    update public.jobs set responsavel_id = p_para where id = p_job_id;
  else
    v_de := v_job.produtor_id;
    if v_de is not distinct from p_para then
      return;
    end if;
    -- Só o papel Produtor (decisão 168).
    if not exists (
      select 1 from public.tenant_members tm join public.profiles p on p.id = tm.user_id
       where tm.user_id = p_para and tm.tenant_id = v_job.tenant_id and tm.status = 'ativo'
         and p.ativo and tm.role = 'produtor'
    ) then
      raise exception '% não pode ser Produtor Responsável: no cadastro de usuários, não está ativo com o papel Produtor.',
        coalesce(v_nome, 'Esta pessoa') using errcode = '42501';
    end if;
    -- O gatilho `jobs_guarda_envio_do_produtor` desliga a chave (174).
    update public.jobs set produtor_id = p_para where id = p_job_id;
  end if;

  insert into public.jobs_trocas_de_responsavel
    (tenant_id, job_id, papel, de_id, para_id, por_id, chave_desligou, entrou_nos_gps_do_projeto)
  values
    (v_job.tenant_id, p_job_id, p_papel, v_de, p_para, v_uid,
     p_papel = 'produtor' and coalesce(v_job.produtor_envia_pp, false),
     v_entrou);
end;
$$;

-- ---- A escrita direta não troca responsável de job aberto -----------------
-- Desde a 174 nenhuma tela grava o GP e o produtor depois da abertura; a
-- troca é só pela função acima (que roda como dona e passa por aqui).
create or replace function public.jobs_guarda_troca_de_responsavel()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if old.status in ('aguardando_abertura', 'rejeitado_financeiro') then
    return new;
  end if;
  if new.responsavel_id is distinct from old.responsavel_id
     or new.produtor_id is distinct from old.produtor_id then
    raise exception 'O GP e o Produtor Responsáveis do job aberto mudam só pela Equipe do job.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_guarda_troca_de_responsavel on public.jobs;
create trigger trg_jobs_guarda_troca_de_responsavel
  before update on public.jobs
  for each row execute function public.jobs_guarda_troca_de_responsavel();

revoke all on function public.incluir_gp_no_projeto(uuid, uuid) from public, anon;
revoke all on function public.trocar_responsavel_do_job(uuid, text, uuid) from public, anon;
revoke all on function public.jobs_guarda_troca_de_responsavel() from public, anon;
grant execute on function public.incluir_gp_no_projeto(uuid, uuid) to authenticated;
grant execute on function public.trocar_responsavel_do_job(uuid, text, uuid) to authenticated;
