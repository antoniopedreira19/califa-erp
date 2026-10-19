-- Task 026 — Freelancers (Fase 4, Task 4): histórico de alterações de contrato
--
-- Audit trail detalhado: trigger AFTER UPDATE em freelancer_contratos
-- grava uma linha por campo alterado em freelancer_contrato_historico.
-- Imutável: sem policy de UPDATE/DELETE; só o trigger INSERT.
--
-- Campos auditados estão enumerados dentro da função — adicionar coluna
-- nova em freelancer_contratos NÃO entra automático; é decisão explícita
-- adicionar aqui.

create table if not exists public.freelancer_contrato_historico (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contrato_id uuid not null references public.freelancer_contratos(id) on delete cascade,
  campo text not null,
  valor_anterior text,
  valor_novo text,
  alterado_por uuid references public.profiles(id) on delete set null,
  alterado_em timestamptz not null default now()
);

comment on table public.freelancer_contrato_historico is
  'Audit trail imutável de alterações em freelancer_contratos. Preenchido pelo trigger trg_freelancer_contrato_historico.';

create index if not exists idx_fch_contrato
  on public.freelancer_contrato_historico (contrato_id, alterado_em desc);
create index if not exists idx_fch_tenant
  on public.freelancer_contrato_historico (tenant_id, alterado_em desc);
create index if not exists idx_fch_alterado_por
  on public.freelancer_contrato_historico (alterado_por)
  where alterado_por is not null;

alter table public.freelancer_contrato_historico enable row level security;

create policy fch_select on public.freelancer_contrato_historico
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- Sem policy de INSERT/UPDATE/DELETE: só o trigger (SECURITY DEFINER)
-- escreve. Audit trail imutável.

grant select on public.freelancer_contrato_historico to authenticated;
revoke all on public.freelancer_contrato_historico from anon;

-- ---------- Trigger ----------
create or replace function public.fn_freelancer_contrato_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  -- Quem alterou vem do updated_by (as actions sempre preenchem)
  v_actor := coalesce(new.updated_by, auth.uid());

  -- Compara campo por campo; só grava se é distinto
  if new.nome_job is distinct from old.nome_job then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'nome_job', old.nome_job, new.nome_job, v_actor);
  end if;
  if new.cargo is distinct from old.cargo then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'cargo', old.cargo, new.cargo, v_actor);
  end if;
  if new.tipo is distinct from old.tipo then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'tipo', old.tipo, new.tipo, v_actor);
  end if;
  if new.valor is distinct from old.valor then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'valor', old.valor::text, new.valor::text, v_actor);
  end if;
  if new.data_inicio is distinct from old.data_inicio then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'data_inicio', old.data_inicio::text, new.data_inicio::text, v_actor);
  end if;
  if new.data_termino is distinct from old.data_termino then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'data_termino', old.data_termino::text, new.data_termino::text, v_actor);
  end if;
  if new.cidade is distinct from old.cidade then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'cidade', old.cidade, new.cidade, v_actor);
  end if;
  if new.status_real is distinct from old.status_real then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'status_real', old.status_real::text, new.status_real::text, v_actor);
  end if;
  if new.responsavel_id is distinct from old.responsavel_id then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'responsavel_id', old.responsavel_id::text, new.responsavel_id::text, v_actor);
  end if;
  if new.job_id is distinct from old.job_id then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'job_id', old.job_id::text, new.job_id::text, v_actor);
  end if;
  if new.arquivo_url is distinct from old.arquivo_url then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'arquivo_url', old.arquivo_url, new.arquivo_url, v_actor);
  end if;
  if new.minuta_url is distinct from old.minuta_url then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'minuta_url', old.minuta_url, new.minuta_url, v_actor);
  end if;
  if new.distrato_data_proposta is distinct from old.distrato_data_proposta then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'distrato_data_proposta', old.distrato_data_proposta::text, new.distrato_data_proposta::text, v_actor);
  end if;
  if new.distrato_arquivo_url is distinct from old.distrato_arquivo_url then
    insert into public.freelancer_contrato_historico
      (tenant_id, contrato_id, campo, valor_anterior, valor_novo, alterado_por)
    values (new.tenant_id, new.id, 'distrato_arquivo_url', old.distrato_arquivo_url, new.distrato_arquivo_url, v_actor);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_freelancer_contrato_historico on public.freelancer_contratos;
create trigger trg_freelancer_contrato_historico
  after update on public.freelancer_contratos
  for each row execute function public.fn_freelancer_contrato_historico();
