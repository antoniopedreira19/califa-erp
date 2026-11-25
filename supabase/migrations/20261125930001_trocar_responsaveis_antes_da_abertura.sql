-- =============================================================================
-- Decisão 176 — ampliação: trocar o GP e o Produtor Responsáveis também
-- antes da abertura (aguardando_abertura, rejeitado_financeiro)
-- (25/11/2026)
-- =============================================================================
--
-- A decisão 176 só liberou a troca em `aberto` e `em_producao`: antes da
-- abertura, o GP tinha que cancelar o envio para abertura e refazer pelo
-- orçamento para trocar quem vai ser o Produtor Responsável do job. Com o
-- job já criado, com código e no mural do financeiro, isso é só clique sem
-- motivo: o financeiro ainda não encostou no job, e a troca pela Equipe não
-- mexe no orçamento nem passa pelo financeiro de qualquer jeito (regra 6 e
-- regra 8 da decisão 176).
--
-- Mudança única: a função `trocar_responsavel_do_job` passa a aceitar
-- também `aguardando_abertura` e `rejeitado_financeiro`. O gatilho
-- `jobs_guarda_troca_de_responsavel` já libera escrita direta nesses dois
-- status (do próprio envio para abertura), então o portão do banco continua
-- coerente: só `encerrado`, `finalizado` e `cancelado` barram.
--
-- Sem mudança de tabela, grant ou RLS.
-- =============================================================================

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
  -- Antes da abertura (aguardando_abertura, rejeitado_financeiro) também
  -- aceita (ampliação de 25/11/2026 à decisão 176): o financeiro ainda não
  -- abriu o job, então a troca pela Equipe economiza o rodeio de cancelar o
  -- envio e refazer pelo orçamento.

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
