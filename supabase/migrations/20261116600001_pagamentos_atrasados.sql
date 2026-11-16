-- Decisão 259: pagamentos atrasados em job encerrado ou finalizado.
--
-- Racional (Tiago, 15 e 16/11/2026; protótipo aprovado em 16/11):
--
-- Até aqui, o pagamento que aparecia depois de o job fechar (encerrado ou
-- finalizado, planilha travada) virava um job à parte, "Pagamentos
-- Atrasados", por regional e trimestre. O custo saía do job e do cliente de
-- origem. Agora o custo fica no próprio job, com a competência própria:
--
-- 1. O FINANCEIRO libera (`jobs_pagamentos_atrasados`): job fechado,
--    competência dos novos lançamentos (trimestre e ano) e motivo
--    obrigatório. Uma liberação por vez no job.
-- 2. Com a liberação aberta, a PRODUÇÃO gera PP em qualquer linha do job e
--    cria linha vermelha para custo que o orçamento não tinha. Toda PP e
--    toda linha vermelha criadas assim levam a marca da liberação
--    (`pagamento_atrasado_id`), posta pelo banco: os relatórios filtram os
--    pagamentos atrasados de todos os jobs, a incidência por GP etc.
-- 3. Custo AR só recebe pagamento atrasado se o job ainda não foi faturado
--    (sem envio para faturamento e sem nota emitida): no faturado, o AR não
--    tem mais nota que o cobre.
-- 4. PP de pagamento atrasado nunca é verba de produção (o reembolso pode).
-- 5. Para terminar: a produção conclui (e o financeiro confirma) ou o
--    financeiro conclui sozinho. Com a conclusão pedida, a produção já não
--    lança nada; até o financeiro confirmar, ela pode cancelar a conclusão.
--    PP gerada sem envio, PP a emitir e linha vermelha da liberação sem PP
--    impedem concluir; a PP que já foi ao financeiro segue o fluxo dela.
-- 6. A PP gerada com "Sim, concluir PPs atrasadas" no formulário
--    (`conclui_pagamentos_atrasados`) leva a conclusão junto quando vai ao
--    financeiro, se nada mais estiver pendente.
--
-- A liberação só muda pelas funções desta migration (security definer):
-- `authenticated` lê a tabela, não escreve nela.
--
-- Tudo aditivo: tabela nova, colunas novas nuláveis ou com default, gatilhos
-- e funções novas. Nenhuma linha existente muda.

-- ---------------------------------------------------------------------------
-- 1. A liberação
-- ---------------------------------------------------------------------------
create table if not exists public.jobs_pagamentos_atrasados (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  job_id uuid not null references public.jobs(id) on delete cascade,
  trimestre smallint not null check (trimestre between 1 and 4),
  ano smallint not null check (ano between 2020 and 2100),
  motivo text not null check (btrim(motivo) <> '' and char_length(motivo) <= 500),
  liberado_por uuid not null references public.profiles(id),
  liberado_em timestamptz not null default now(),
  conclusao_pedida_por uuid references public.profiles(id),
  conclusao_pedida_em timestamptz,
  encerrado_por uuid references public.profiles(id),
  encerrado_em timestamptz,
  created_at timestamptz not null default now(),
  constraint jobs_pagamentos_atrasados_conclusao_par
    check ((conclusao_pedida_por is null) = (conclusao_pedida_em is null)),
  constraint jobs_pagamentos_atrasados_encerrado_par
    check ((encerrado_por is null) = (encerrado_em is null))
);

comment on table public.jobs_pagamentos_atrasados is
  'Decisão 259: o financeiro libera pagamentos atrasados num job encerrado ou finalizado (competência e motivo). A produção conclui (o financeiro confirma) ou o financeiro conclui sozinho. Só muda pelas funções liberar_/pedir_conclusao_/cancelar_conclusao_/concluir_pagamentos_atrasados.';
comment on column public.jobs_pagamentos_atrasados.conclusao_pedida_em is
  'A produção concluiu e espera o financeiro confirmar. Enquanto isso, a produção não gera PP nem cria linha neste job.';
comment on column public.jobs_pagamentos_atrasados.encerrado_em is
  'O financeiro concluiu (confirmando a produção ou sozinho): a planilha volta a travar.';

-- Uma liberação não encerrada por job.
create unique index if not exists uq_jobs_pagamentos_atrasados_um_aberto
  on public.jobs_pagamentos_atrasados (job_id)
  where encerrado_em is null;
create index if not exists idx_jobs_pagamentos_atrasados_job
  on public.jobs_pagamentos_atrasados (job_id);
create index if not exists idx_jobs_pagamentos_atrasados_tenant
  on public.jobs_pagamentos_atrasados (tenant_id);

alter table public.jobs_pagamentos_atrasados enable row level security;

drop policy if exists jobs_pagamentos_atrasados_select on public.jobs_pagamentos_atrasados;
create policy jobs_pagamentos_atrasados_select on public.jobs_pagamentos_atrasados
  for select to authenticated
  using (
    is_tenant_member(tenant_id)
    and (
      (select session_role()) <> 'freelancer'::app_role
      or exists (
        select 1 from public.jobs j
         where j.id = jobs_pagamentos_atrasados.job_id
           and is_freelancer_do_projeto(j.projeto_id)
      )
    )
  );

revoke all on public.jobs_pagamentos_atrasados from anon;
revoke all on public.jobs_pagamentos_atrasados from authenticated;
grant select on public.jobs_pagamentos_atrasados to authenticated;

-- ---------------------------------------------------------------------------
-- 2. As marcas
-- ---------------------------------------------------------------------------
alter table public.pedidos_compra
  add column if not exists pagamento_atrasado_id uuid
    references public.jobs_pagamentos_atrasados(id);
alter table public.pedidos_compra
  add column if not exists conclui_pagamentos_atrasados boolean not null default false;
comment on column public.pedidos_compra.pagamento_atrasado_id is
  'Decisão 259: a PP foi gerada num job fechado, na liberação de pagamentos atrasados. Posto pelo gatilho trg_pp_pagamento_atrasado.';
comment on column public.pedidos_compra.conclui_pagamentos_atrasados is
  'Decisão 259: gerada com "Sim, concluir PPs atrasadas". Ao ir ao financeiro, leva a conclusão dos pagamentos atrasados junto.';
create index if not exists idx_pedidos_compra_pagamento_atrasado
  on public.pedidos_compra (pagamento_atrasado_id)
  where pagamento_atrasado_id is not null;

alter table public.pedidos_compra_a_emitir
  add column if not exists conclui_pagamentos_atrasados boolean not null default false;
comment on column public.pedidos_compra_a_emitir.conclui_pagamentos_atrasados is
  'Decisão 259: a resposta "Sim, concluir PPs atrasadas" do formulário, até a PP ser gerada.';

alter table public.jobs_itens_orcado
  add column if not exists pagamento_atrasado_id uuid
    references public.jobs_pagamentos_atrasados(id);
comment on column public.jobs_itens_orcado.pagamento_atrasado_id is
  'Decisão 259: linha vermelha criada num job fechado, na liberação de pagamentos atrasados. Posto pelo gatilho trg_linha_pagamento_atrasado.';
create index if not exists idx_jobs_itens_orcado_pagamento_atrasado
  on public.jobs_itens_orcado (pagamento_atrasado_id)
  where pagamento_atrasado_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Regras
-- ---------------------------------------------------------------------------

-- O job já foi faturado: envio para faturamento (inteiro ou de algum mês),
-- nota emitida que cobre o job, ou o carimbo de tudo enviado.
create or replace function public.job_ja_faturado(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.jobs_envio_faturamento e where e.job_id = p_job_id)
      or exists (
        select 1
          from public.faturamento_itens fi
          join public.faturamentos f on f.id = fi.faturamento_id
         where fi.origem_id = p_job_id
           and f.status = 'emitido'
      )
      or exists (select 1 from public.jobs j where j.id = p_job_id and j.faturamento_enviado_em is not null);
$$;
revoke all on function public.job_ja_faturado(uuid) from public, anon;
grant execute on function public.job_ja_faturado(uuid) to authenticated;

-- O que impede concluir a liberação.
create or replace function public.pendencias_dos_pagamentos_atrasados(p_liberacao_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lib record;
  v_out text[] := '{}';
  v_lista text;
  v_n integer;
begin
  select l.id, l.job_id, l.tenant_id into v_lib
    from public.jobs_pagamentos_atrasados l
   where l.id = p_liberacao_id;
  if not found or not is_tenant_member(v_lib.tenant_id) then
    return v_out;
  end if;

  select count(*), string_agg(p.codigo, ', ' order by p.codigo)
    into v_n, v_lista
    from public.pedidos_compra p
   where p.job_id = v_lib.job_id and p.status = 'gerada';
  if v_n > 0 then
    v_out := v_out || (case when v_n = 1 then '1 PP gerada' else v_n || ' PPs geradas' end
      || ' sem envio ao financeiro (' || v_lista || ')');
  end if;

  select count(*) into v_n
    from public.pedidos_compra_a_emitir a
   where a.job_id = v_lib.job_id and a.excluida_em is null and a.gerada_em is null and a.pp_id is null;
  if v_n > 0 then
    v_out := v_out || (case when v_n = 1 then '1 PP a emitir' else v_n || ' PPs a emitir' end
      || ', salva sem gerar');
  end if;

  select count(*), string_agg(o.item, ', ' order by o.item)
    into v_n, v_lista
    from public.jobs_itens_orcado o
   where o.pagamento_atrasado_id = v_lib.id
     and o.cancelada_em is null
     and not exists (
       select 1
         from public.jobs_itens_realizado r
         join public.pedidos_compra p on p.item_realizado_id = r.id
        where r.job_item_orcado_id = o.id
          and p.status <> 'cancelada'
     );
  if v_n > 0 then
    v_out := v_out || (case when v_n = 1 then '1 linha vermelha' else v_n || ' linhas vermelhas' end
      || ' sem PP (' || v_lista || ')');
  end if;

  return v_out;
end;
$$;
revoke all on function public.pendencias_dos_pagamentos_atrasados(uuid) from public, anon;
grant execute on function public.pendencias_dos_pagamentos_atrasados(uuid) to authenticated;

-- A PP gerada num job fechado leva a marca da liberação aberta; com ela,
-- valem as regras do AR e da verba. Sem liberação aberta o banco não marca
-- nada (a trava do job fechado continua no código, como sempre esteve).
create or replace function public.pp_pagamento_atrasado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status job_status;
  v_lib uuid;
  v_tipo text;
begin
  select j.status into v_status from public.jobs j where j.id = new.job_id;
  if v_status is null or v_status not in ('encerrado', 'finalizado') then
    return new;
  end if;

  select l.id into v_lib
    from public.jobs_pagamentos_atrasados l
   where l.job_id = new.job_id
     and l.encerrado_em is null
     and l.conclusao_pedida_em is null;
  if v_lib is null then
    return new;
  end if;

  if coalesce(new.verba_producao, false) and coalesce(new.tipo_verba::text, '') <> 'reembolso' then
    raise exception 'PP de pagamento atrasado não pode ser verba de produção.';
  end if;

  select o.tipo_custo::text into v_tipo
    from public.jobs_itens_realizado r
    join public.jobs_itens_orcado o on o.id = r.job_item_orcado_id
   where r.id = new.item_realizado_id;
  if v_tipo = 'AR' and public.job_ja_faturado(new.job_id) then
    raise exception 'Custo AR: este job já foi faturado, e o pagamento atrasado de AR só entra em job ainda não faturado.';
  end if;

  new.pagamento_atrasado_id := v_lib;
  return new;
end;
$$;
revoke all on function public.pp_pagamento_atrasado() from public, anon, authenticated;

drop trigger if exists trg_pp_pagamento_atrasado on public.pedidos_compra;
create trigger trg_pp_pagamento_atrasado
  before insert on public.pedidos_compra
  for each row execute function public.pp_pagamento_atrasado();

-- A linha vermelha num job fechado só nasce com a liberação aberta, e leva a
-- marca dela. No job faturado, não entra AR.
create or replace function public.linha_pagamento_atrasado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status job_status;
  v_lib uuid;
begin
  if not coalesce(new.linha_vermelha, false) then
    return new;
  end if;
  select j.status into v_status from public.jobs j where j.id = new.job_id;
  if v_status is null or v_status not in ('encerrado', 'finalizado') then
    return new;
  end if;

  select l.id into v_lib
    from public.jobs_pagamentos_atrasados l
   where l.job_id = new.job_id
     and l.encerrado_em is null
     and l.conclusao_pedida_em is null;
  if v_lib is null then
    raise exception 'Job encerrado: linha vermelha nova só com pagamentos atrasados liberados pelo financeiro.';
  end if;
  if new.tipo_custo::text = 'AR' and public.job_ja_faturado(new.job_id) then
    raise exception 'Custo AR: este job já foi faturado, e o pagamento atrasado de AR só entra em job ainda não faturado.';
  end if;

  new.pagamento_atrasado_id := v_lib;
  return new;
end;
$$;
revoke all on function public.linha_pagamento_atrasado() from public, anon, authenticated;

drop trigger if exists trg_linha_pagamento_atrasado on public.jobs_itens_orcado;
create trigger trg_linha_pagamento_atrasado
  before insert on public.jobs_itens_orcado
  for each row execute function public.linha_pagamento_atrasado();

-- A PP marcada "Sim, concluir PPs atrasadas" leva a conclusão junto quando
-- vai ao financeiro, se nada mais estiver pendente.
create or replace function public.pp_conclui_pagamentos_atrasados()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'em_avaliacao'
     and old.status is distinct from 'em_avaliacao'
     and new.conclui_pagamentos_atrasados
     and new.pagamento_atrasado_id is not null
     and coalesce(array_length(public.pendencias_dos_pagamentos_atrasados(new.pagamento_atrasado_id), 1), 0) = 0
  then
    update public.jobs_pagamentos_atrasados l
       set conclusao_pedida_por = coalesce((select auth.uid()), new.enviada_financeiro_por),
           conclusao_pedida_em = now()
     where l.id = new.pagamento_atrasado_id
       and l.encerrado_em is null
       and l.conclusao_pedida_em is null;
  end if;
  return new;
end;
$$;
revoke all on function public.pp_conclui_pagamentos_atrasados() from public, anon, authenticated;

drop trigger if exists trg_pp_conclui_pagamentos_atrasados on public.pedidos_compra;
create trigger trg_pp_conclui_pagamentos_atrasados
  after update of status on public.pedidos_compra
  for each row execute function public.pp_conclui_pagamentos_atrasados();

-- ---------------------------------------------------------------------------
-- 4. As ações
-- ---------------------------------------------------------------------------

-- O financeiro libera.
create or replace function public.liberar_pagamentos_atrasados(
  p_job_id uuid, p_trimestre integer, p_ano integer, p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job record;
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if coalesce((select public.session_role())::text, '') not in ('administrador', 'financeiro') then
    raise exception 'Só o financeiro ou o administrador libera pagamentos atrasados.';
  end if;
  select j.id, j.tenant_id, j.status into v_job
    from public.jobs j where j.id = p_job_id for update;
  if not found or not is_tenant_member(v_job.tenant_id) then
    raise exception 'Job não encontrado.';
  end if;
  if v_job.status not in ('encerrado', 'finalizado') then
    raise exception 'Os pagamentos atrasados só se liberam em job encerrado ou finalizado.';
  end if;
  if exists (select 1 from public.jobs_pagamentos_atrasados l where l.job_id = p_job_id and l.encerrado_em is null) then
    raise exception 'Este job já tem pagamentos atrasados liberados.';
  end if;
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'Escreva o motivo dos pagamentos atrasados.';
  end if;
  if p_trimestre is null or p_trimestre not between 1 and 4 or p_ano is null or p_ano not between 2020 and 2100 then
    raise exception 'Escolha a competência dos novos lançamentos.';
  end if;

  insert into public.jobs_pagamentos_atrasados (tenant_id, job_id, trimestre, ano, motivo, liberado_por)
  values (v_job.tenant_id, p_job_id, p_trimestre, p_ano, btrim(p_motivo), v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

-- A produção conclui; o financeiro confirma depois.
create or replace function public.pedir_conclusao_dos_pagamentos_atrasados(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lib record;
  v_pend text[];
begin
  if coalesce((select public.session_role())::text, '') not in ('administrador', 'gerente_producao', 'produtor') then
    raise exception 'Só o administrador, o GP ou o produtor conclui os pagamentos atrasados pela produção.';
  end if;
  select l.id, l.tenant_id into v_lib
    from public.jobs_pagamentos_atrasados l
   where l.job_id = p_job_id and l.encerrado_em is null and l.conclusao_pedida_em is null
   for update;
  if not found or not is_tenant_member(v_lib.tenant_id) then
    raise exception 'Não há pagamentos atrasados liberados neste job (ou a conclusão já foi enviada).';
  end if;
  v_pend := public.pendencias_dos_pagamentos_atrasados(v_lib.id);
  if coalesce(array_length(v_pend, 1), 0) > 0 then
    raise exception 'Antes de concluir, resolva: %.', array_to_string(v_pend, '; ');
  end if;
  update public.jobs_pagamentos_atrasados
     set conclusao_pedida_por = (select auth.uid()), conclusao_pedida_em = now()
   where id = v_lib.id;
end;
$$;

-- A produção desiste da conclusão enquanto o financeiro não confirmou.
create or replace function public.cancelar_conclusao_dos_pagamentos_atrasados(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lib record;
begin
  if coalesce((select public.session_role())::text, '') not in ('administrador', 'gerente_producao', 'produtor') then
    raise exception 'Só o administrador, o GP ou o produtor cancela a conclusão.';
  end if;
  select l.id, l.tenant_id into v_lib
    from public.jobs_pagamentos_atrasados l
   where l.job_id = p_job_id and l.encerrado_em is null and l.conclusao_pedida_em is not null
   for update;
  if not found or not is_tenant_member(v_lib.tenant_id) then
    raise exception 'Não há conclusão esperando o financeiro neste job.';
  end if;
  update public.jobs_pagamentos_atrasados
     set conclusao_pedida_por = null, conclusao_pedida_em = null
   where id = v_lib.id;
end;
$$;

-- O financeiro conclui: confirmando a produção ou sozinho. A planilha volta
-- a travar.
create or replace function public.concluir_pagamentos_atrasados(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lib record;
  v_pend text[];
begin
  if coalesce((select public.session_role())::text, '') not in ('administrador', 'financeiro') then
    raise exception 'Só o financeiro ou o administrador conclui os pagamentos atrasados.';
  end if;
  select l.id, l.tenant_id into v_lib
    from public.jobs_pagamentos_atrasados l
   where l.job_id = p_job_id and l.encerrado_em is null
   for update;
  if not found or not is_tenant_member(v_lib.tenant_id) then
    raise exception 'Não há pagamentos atrasados liberados neste job.';
  end if;
  v_pend := public.pendencias_dos_pagamentos_atrasados(v_lib.id);
  if coalesce(array_length(v_pend, 1), 0) > 0 then
    raise exception 'Antes de concluir, resolva: %.', array_to_string(v_pend, '; ');
  end if;
  update public.jobs_pagamentos_atrasados
     set encerrado_por = (select auth.uid()), encerrado_em = now()
   where id = v_lib.id;
end;
$$;

revoke all on function public.liberar_pagamentos_atrasados(uuid, integer, integer, text) from public, anon;
revoke all on function public.pedir_conclusao_dos_pagamentos_atrasados(uuid) from public, anon;
revoke all on function public.cancelar_conclusao_dos_pagamentos_atrasados(uuid) from public, anon;
revoke all on function public.concluir_pagamentos_atrasados(uuid) from public, anon;
grant execute on function public.liberar_pagamentos_atrasados(uuid, integer, integer, text) to authenticated;
grant execute on function public.pedir_conclusao_dos_pagamentos_atrasados(uuid) to authenticated;
grant execute on function public.cancelar_conclusao_dos_pagamentos_atrasados(uuid) to authenticated;
grant execute on function public.concluir_pagamentos_atrasados(uuid) to authenticated;
