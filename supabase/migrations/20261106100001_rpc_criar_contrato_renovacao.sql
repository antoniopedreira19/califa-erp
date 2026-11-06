-- 06/11/2026: RPC SECURITY DEFINER pra criar contrato quando renovação é
-- aprovada. Substitui a função TS criarContratoDeRenovacao em actions.ts,
-- que fazia INSERT/SELECT diretos e dependia da RLS do usuário que aprova.
--
-- Problema concreto: RH aprovou renovações em lote de freelas em jobs de
-- empresas/regionais a que ela não tem acesso (policy jobs_select filtra
-- por can_access_empresa_regional). O SELECT em jobs retornou null, o
-- INSERT caiu no fallback "Importado (sem job vinculado)". Dois contratos
-- criados em 06/11 com nome errado foram corrigidos à mão.
--
-- Fix: RPC SECURITY DEFINER centraliza tudo (resolve nome do job, migra
-- responsável, cria contrato, finaliza se dispensa, atualiza solicitação)
-- rodando com privilégio de owner. Valida permissão em código:
-- admin/rh/financeiro do tenant OU o próprio solicitante.
--
-- Trigger de histórico (fn_freelancer_contrato_historico) continua
-- disparando normalmente no INSERT, como era antes.
--
-- Retorna: contrato_id + finalizada (true quando dispensa de minuta
-- aplicou — diária curta < 15d). actions.ts usa isso pra logar o audit
-- event correto.

begin;

create or replace function public.criar_contrato_de_renovacao(
  p_solicitacao_id uuid
)
returns table(contrato_id uuid, finalizada boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sol public.freelancer_solicitacoes%rowtype;
  v_user_id uuid := auth.uid();
  v_nome_job text;
  v_origem_sistema text;
  v_responsavel_id uuid;
  v_contrato_id uuid;
  v_dispensa boolean;
  v_responsavel_atual uuid;
begin
  if v_user_id is null then
    raise exception 'Usuario nao autenticado' using errcode = 'P0001';
  end if;

  select * into v_sol
  from public.freelancer_solicitacoes
  where id = p_solicitacao_id
  for update;

  if not found then
    raise exception 'Solicitacao nao encontrada' using errcode = 'P0002';
  end if;

  if v_sol.freelancer_id is null then
    raise exception 'Solicitacao sem freelancer vinculado (nao e renovacao)'
      using errcode = 'P0003';
  end if;

  if v_sol.status <> 'aprovada' then
    raise exception 'Solicitacao precisa estar aprovada (atual: %)',
      v_sol.status using errcode = 'P0004';
  end if;

  if v_sol.contrato_id is not null then
    raise exception 'Solicitacao ja tem contrato vinculado'
      using errcode = 'P0005';
  end if;

  if not (
    public.is_tenant_admin(v_sol.tenant_id)
    or public.is_tenant_rh(v_sol.tenant_id)
    or public.is_tenant_financeiro(v_sol.tenant_id)
    or v_sol.solicitante_id = v_user_id
  ) then
    raise exception 'Sem permissao pra criar contrato desta solicitacao'
      using errcode = 'P0006';
  end if;

  -- Resolve nome_job sem passar pela RLS de empresa/regional dos jobs.
  -- Prioridade: job de produção → job interno → nome_job da solicitação
  -- (legado) → fallback só pra legados sem job.
  if v_sol.job_id is not null then
    select nome into v_nome_job
      from public.jobs
     where id = v_sol.job_id and tenant_id = v_sol.tenant_id;
    v_origem_sistema := 'califa_erp';
  elsif v_sol.job_interno_id is not null then
    select nome into v_nome_job
      from public.freelancer_jobs_internos
     where id = v_sol.job_interno_id and tenant_id = v_sol.tenant_id;
    v_origem_sistema := 'califa_erp';
  else
    v_nome_job := v_sol.nome_job;
    v_origem_sistema := 'ag_california_rh';
  end if;

  if v_nome_job is null then
    v_nome_job := coalesce(v_sol.nome_job, 'Importado (sem job vinculado)');
  end if;

  -- Migra responsável do freela se quem solicitou não é o dono atual.
  -- Ideia: quem pede novo contrato pra freela "parado" assume a pessoa.
  -- Idempotente — se já é o mesmo, não faz nada.
  if v_sol.solicitante_id is not null then
    select responsavel_id into v_responsavel_atual
      from public.freelancers
     where id = v_sol.freelancer_id and tenant_id = v_sol.tenant_id;

    if v_responsavel_atual is distinct from v_sol.solicitante_id then
      update public.freelancers
         set responsavel_id = v_sol.solicitante_id,
             updated_by = v_user_id,
             updated_at = now()
       where id = v_sol.freelancer_id and tenant_id = v_sol.tenant_id;
    end if;
    v_responsavel_id := v_sol.solicitante_id;
  else
    v_responsavel_id := v_responsavel_atual;
  end if;

  -- Cria contrato. A trigger fn_freelancer_contrato_historico dispara
  -- normalmente — SECURITY DEFINER não afeta triggers.
  insert into public.freelancer_contratos (
    tenant_id, freelancer_id, job_id, job_interno_id, responsavel_id,
    nome_job, cargo, tipo, valor,
    data_inicio, data_termino, cidade, observacoes,
    origem_sistema, created_by, updated_by
  ) values (
    v_sol.tenant_id, v_sol.freelancer_id, v_sol.job_id, v_sol.job_interno_id,
    v_responsavel_id, v_nome_job, v_sol.cargo, v_sol.tipo, v_sol.valor,
    v_sol.data_inicio, v_sol.data_termino, v_sol.cidade, v_sol.observacoes,
    v_origem_sistema, v_user_id, v_user_id
  )
  returning id into v_contrato_id;

  -- Dispensa de minuta: diária curta < 15d vai direto pra finalizada.
  v_dispensa := (
    v_sol.tipo = 'diarias'
    and v_sol.data_inicio is not null
    and v_sol.data_termino is not null
    and (v_sol.data_termino - v_sol.data_inicio) < 15
  );

  update public.freelancer_solicitacoes
     set contrato_id = v_contrato_id,
         status = case when v_dispensa then 'finalizada'::freelancer_solicitacao_status
                       else status end,
         updated_at = now()
   where id = v_sol.id;

  return query select v_contrato_id, v_dispensa;
end;
$$;

comment on function public.criar_contrato_de_renovacao is
  'SECURITY DEFINER: cria contrato quando renovação é aprovada. Resolve
   nome do job sem passar pela RLS de empresa/regional, migra responsável,
   insere contrato e atualiza solicitação (incluindo finalizada direto se
   for diária curta com dispensa). Trigger de histórico dispara normalmente.
   Retorna contrato_id + flag finalizada pra caller logar audit certo.';

grant execute on function public.criar_contrato_de_renovacao(uuid)
  to authenticated;

commit;
