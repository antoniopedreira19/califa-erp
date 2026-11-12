-- 12/11/2026: RPC SECURITY DEFINER que aprova a solicitação e cria o contrato
-- numa transação única. Substitui o fluxo em duas etapas de actions.ts
-- (UPDATE status='aprovada' + RPC criar_contrato_de_renovacao), que deixava
-- buraco: se a RPC falhasse (timeout, rede, exceção transiente), o status
-- ficava aprovada e o contrato nunca era criado.
--
-- Incidente que motivou: 3 renovações aprovadas em ~15s em 10/11/2026
-- (jobs e freelas distintos); 2 finalizaram OK, a do meio ficou com
-- status='aprovada' e contrato_id=null por horas até ser consertada
-- manualmente em 12/11. A action logou console.error e seguiu
-- (actions.ts:194-198), porque os dois passos não estão numa transação.
--
-- Fix: tudo numa RPC. Postgres garante atomicidade por natureza — ou tudo
-- passa (status=aprovada [+ contrato criado + eventual dispensa→finalizada]),
-- ou nada passa. Não há mais estado zumbi possível.
--
-- Mantém criar_contrato_de_renovacao viva por compatibilidade — nada externo
-- chama ela ainda, mas evitamos quebrar algo não previsto.
--
-- Retorna: contrato_id (null se contratação nova), status_final, finalizada
-- (true quando dispensa aplicou), is_renovacao. A action usa esses flags pra
-- disparar os logAuditEvent corretos.

begin;

create or replace function public.aprovar_solicitacao(
  p_solicitacao_id uuid
)
returns table(
  contrato_id uuid,
  status_final text,
  finalizada boolean,
  is_renovacao boolean
)
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
  v_agora timestamptz := now();
  v_expira_em timestamptz := now() + interval '30 days';
begin
  if v_user_id is null then
    raise exception 'Usuario nao autenticado' using errcode = 'P0001';
  end if;

  -- Lock pessimista: previne aprovação concorrente da mesma solicitação
  select * into v_sol
    from public.freelancer_solicitacoes
   where id = p_solicitacao_id
   for update;
  if not found then
    raise exception 'Solicitacao nao encontrada' using errcode = 'P0002';
  end if;

  -- Permissão em código: admin/rh/financeiro do tenant da solicitação
  if not (
    public.is_tenant_admin(v_sol.tenant_id)
    or public.is_tenant_rh(v_sol.tenant_id)
    or public.is_tenant_financeiro(v_sol.tenant_id)
  ) then
    raise exception 'Sem permissao para aprovar solicitacao'
      using errcode = 'P0006';
  end if;

  -- Precondição: só aprova pendente (idempotência — chamada repetida falha
  -- limpo em vez de duplicar contrato)
  if v_sol.status <> 'pendente' then
    raise exception 'Solicitacao nao esta pendente (atual: %)', v_sol.status
      using errcode = 'P0004';
  end if;

  -- Passo 1: UPDATE do status. Antes era commitado isolado no TS; agora
  -- vive na mesma transação do INSERT do contrato.
  update public.freelancer_solicitacoes
     set status = 'aprovada',
         aprovado_por = v_user_id,
         aprovado_em = v_agora,
         expira_em = v_expira_em,
         updated_at = v_agora
   where id = v_sol.id;

  v_sol.status := 'aprovada';
  v_sol.aprovado_por := v_user_id;
  v_sol.aprovado_em := v_agora;

  -- Contratação nova: para aqui, aguarda o freela preencher o form público
  if v_sol.freelancer_id is null then
    return query select
      null::uuid as contrato_id,
      'aprovada'::text as status_final,
      false as finalizada,
      false as is_renovacao;
    return;
  end if;

  -- === Renovação: cria contrato nesta mesma transação ===

  -- Resolve nome_job sem passar pela RLS de empresa/regional dos jobs.
  -- Prioridade: job de produção -> job interno -> nome_job da solicitação
  -- (legado) -> fallback só pra legados sem job.
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
  -- Idempotente — se já é o mesmo, não faz nada.
  if v_sol.solicitante_id is not null then
    select responsavel_id into v_responsavel_atual
      from public.freelancers
     where id = v_sol.freelancer_id and tenant_id = v_sol.tenant_id;

    if v_responsavel_atual is distinct from v_sol.solicitante_id then
      update public.freelancers
         set responsavel_id = v_sol.solicitante_id,
             updated_by = v_user_id,
             updated_at = v_agora
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
         updated_at = v_agora
   where id = v_sol.id;

  return query select
    v_contrato_id,
    (case when v_dispensa then 'finalizada' else 'aprovada' end)::text as status_final,
    v_dispensa,
    true as is_renovacao;
end;
$$;

comment on function public.aprovar_solicitacao is
  'SECURITY DEFINER: aprova a solicitacao e, se for renovacao, cria o
   contrato na mesma transacao. Elimina a janela entre UPDATE status e
   criacao do contrato que vigorava quando essas duas coisas eram
   executadas em round-trips separados pelo TS. Permissao: admin/rh/
   financeiro do tenant. Retorna contrato_id (null em contratacao nova),
   status_final, finalizada (dispensa de minuta aplicada) e is_renovacao.';

grant execute on function public.aprovar_solicitacao(uuid)
  to authenticated;

commit;
