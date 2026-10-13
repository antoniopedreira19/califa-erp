-- =====================================================================
-- Cancelamento de job já aberto — decisão 169 (13/10/2026)
--
-- Até aqui ninguém cancelava job aberto pelo sistema (decisão 020): a
-- guarda `jobs_guarda_escrita_direta` recusa `aberto → cancelado`, e o
-- único caso (ANI-1004/26, 09/10/2026) foi feito pelo MCP. Pedido do
-- Tiago, com o protótipo aprovado em 13/10/2026:
--
--   * a PRODUÇÃO pede o cancelamento, com motivo (GP e administrador);
--   * o pedido vai à fila da Abertura de Job, e o FINANCEIRO aprova ou
--     recusa (financeiro e administrador);
--   * aprovado, o job sai do módulo de Jobs (decisão 163) e fica só o
--     orçamento, como "Job cancelado", com o rastro do pedido.
--
-- As quatro respostas que moldam este arquivo (todas as recomendações):
--   1. o botão mora no menu "⋯" do cabeçalho do job (só tela);
--   2. PP gerada, em avaliação ou rejeitada a produção cancela antes, no
--      próprio pop-up (padrão da 143); PP aprovada ou paga TRAVA o pedido;
--   3. com o pedido no financeiro o job fica parado: nada novo nasce nele
--      (PP, envio de PP, errata, save, envio para faturamento, encerramento);
--   4. pede o GP ou o administrador; decide o financeiro ou o administrador.
--
-- Além das PPs, o pedido trava no que o sistema não sabe desfazer — a
-- mesma conferência feita no ANI-1004: envio para faturamento, lançamento
-- financeiro, recebimento antes da NF, desembolso e save (gerado,
-- consumido ou pedido). Quem resolve isso é o financeiro, fora do pedido.
--
-- O que a aprovação faz (`aprovar_cancelamento_do_job`, SECURITY DEFINER —
-- a guarda de status só vale para a escrita como `authenticated`):
--   * `jobs.status` vai a `cancelado`; a revisão da abertura, se pendente,
--     é fechada (o job deixa de existir para o financeiro);
--   * as previsões da abertura FICAM gravadas, como no ANI-1004: o fluxo de
--     caixa e a rentabilidade já ignoram job cancelado. O pedido guarda a
--     foto do que saiu das contas (recebimento, custo e impostos);
--   * o projeto financeiro que fica sem job vivo vai a `ativo = false`;
--   * o orçamento NÃO muda: segue `job_criado` (decisão 163) e a tela o
--     mostra como "Job cancelado".
--
-- Escrita só pelas funções: a tabela não tem policy de INSERT/UPDATE para
-- `authenticated`. Histórico sem DELETE — retirado, recusado e aprovado
-- ficam, com quem e quando. A auditoria (`audit_events`) é gravada pela
-- server action depois de cada função, como nas outras ações do job.
-- =====================================================================

create table if not exists public.jobs_cancelamentos (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id),
  job_id                 uuid not null references public.jobs(id) on delete cascade,
  situacao               text not null default 'pendente'
                           check (situacao in ('pendente', 'retirado', 'recusado', 'aprovado')),
  -- Por que a produção pede.
  motivo                 text not null
                           check (char_length(btrim(motivo)) between 10 and 500),
  solicitado_por         uuid not null references public.profiles(id),
  solicitado_em          timestamptz not null default now(),
  -- A produção desistiu antes da decisão.
  retirado_por           uuid references public.profiles(id),
  retirado_em            timestamptz,
  -- A decisão do financeiro. `justificativa`: obrigatória na recusa (vai à
  -- página do job), opcional na aprovação (a observação do rastro).
  decidido_por           uuid references public.profiles(id),
  decidido_em            timestamptz,
  justificativa          text
                           check (justificativa is null or char_length(btrim(justificativa)) between 1 and 500),
  -- A produção leu a recusa: a faixa sai da página do job.
  aviso_dispensado_por   uuid references public.profiles(id),
  aviso_dispensado_em    timestamptz,
  -- Foto, na aprovação, do que saiu das contas.
  recebimento_previsto   numeric(14,2),
  custo_previsto         numeric(14,2),
  impostos_previstos     numeric(14,2),
  projeto_financeiro_inativado_id uuid references public.projetos_financeiro(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint chk_cancelamento_retirado
    check ((situacao = 'retirado') = (retirado_em is not null)),
  constraint chk_cancelamento_decidido
    check ((situacao in ('recusado', 'aprovado')) = (decidido_em is not null)),
  constraint chk_cancelamento_recusa_justificada
    check (situacao <> 'recusado' or justificativa is not null)
);

-- Um pedido no ar por job.
create unique index if not exists uq_jobs_cancelamentos_um_pendente
  on public.jobs_cancelamentos (job_id)
  where situacao = 'pendente';
create index if not exists idx_jobs_cancelamentos_job
  on public.jobs_cancelamentos (job_id, solicitado_em desc);
-- A fila do financeiro e as listas leem só os pedidos no ar.
create index if not exists idx_jobs_cancelamentos_pendentes
  on public.jobs_cancelamentos (tenant_id)
  where situacao = 'pendente';
create index if not exists idx_jobs_cancelamentos_tenant
  on public.jobs_cancelamentos (tenant_id);
create index if not exists idx_jobs_cancelamentos_solicitado_por
  on public.jobs_cancelamentos (solicitado_por);
create index if not exists idx_jobs_cancelamentos_retirado_por
  on public.jobs_cancelamentos (retirado_por);
create index if not exists idx_jobs_cancelamentos_decidido_por
  on public.jobs_cancelamentos (decidido_por);
create index if not exists idx_jobs_cancelamentos_aviso_por
  on public.jobs_cancelamentos (aviso_dispensado_por);
create index if not exists idx_jobs_cancelamentos_projeto_fin
  on public.jobs_cancelamentos (projeto_financeiro_inativado_id);

alter table public.jobs_cancelamentos enable row level security;

-- Quem vê o job vê o pedido: a produção na página do job, o financeiro na
-- fila. A escrita é só pelas funções abaixo.
drop policy if exists jobs_cancelamentos_select on public.jobs_cancelamentos;
create policy jobs_cancelamentos_select on public.jobs_cancelamentos
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

revoke all on table public.jobs_cancelamentos from public, anon;
grant select on public.jobs_cancelamentos to authenticated;

-- ---- O pedido no ar ----
create or replace function public.job_tem_cancelamento_pendente(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.jobs_cancelamentos c
     where c.job_id = p_job_id
       and c.situacao = 'pendente'
  );
$$;

-- ---- O que trava o cancelamento ----
-- Devolve a primeira trava, em texto para a tela, ou nulo. A mesma conta
-- vale no pedido e de novo na aprovação.
create or replace function public.trava_do_cancelamento_do_job(p_job_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lista text;
begin
  -- Só o job do próprio tenant: a função é SECURITY DEFINER e devolve
  -- códigos de PP.
  if not exists (
    select 1 from public.jobs j
     where j.id = p_job_id and public.is_tenant_member(j.tenant_id)
  ) then
    return null;
  end if;

  select string_agg(pc.codigo, ', ' order by pc.codigo)
    into v_lista
    from public.pedidos_compra pc
   where pc.job_id = p_job_id
     and pc.status = 'pago';
  if v_lista is not null then
    return format('PP já paga (%s): job com pagamento feito não se cancela pelo sistema. Fale com o financeiro.', v_lista);
  end if;

  select string_agg(pc.codigo, ', ' order by pc.codigo)
    into v_lista
    from public.pedidos_compra pc
   where pc.job_id = p_job_id
     and pc.status = 'aprovada';
  if v_lista is not null then
    return format('PP já aprovada pelo financeiro (%s): só ele a reprova. Peça a reprovação antes.', v_lista);
  end if;

  select string_agg(pc.codigo, ', ' order by pc.codigo)
    into v_lista
    from public.pedidos_compra pc
   where pc.job_id = p_job_id
     and pc.status <> 'cancelada';
  if v_lista is not null then
    return format('Antes, cancele as PPs do job (%s).', v_lista);
  end if;

  if exists (select 1 from public.jobs_envio_faturamento e where e.job_id = p_job_id) then
    return 'O job já foi enviado para faturamento: não se cancela pelo sistema. Fale com o financeiro.';
  end if;

  if exists (select 1 from public.lancamentos_financeiros l where l.job_id = p_job_id) then
    return 'Há movimento financeiro lançado neste job: não se cancela pelo sistema. Fale com o financeiro.';
  end if;

  if exists (
    select 1 from public.recebimentos_antes_nf r
     where r.job_id = p_job_id and r.status <> 'cancelado'
  ) then
    return 'Há recebimento antes da nota neste job: não se cancela pelo sistema. Fale com o financeiro.';
  end if;

  if exists (
    select 1 from public.desembolsos d
     where d.job_id = p_job_id and d.status <> 'cancelada'
  ) then
    return 'Há desembolso neste job: não se cancela pelo sistema. Fale com o financeiro.';
  end if;

  if exists (
    select 1 from public.jobs_itens_orcado o
     where o.job_id = p_job_id
       and o.cancelada_em is null
       and (coalesce(o.em_save, false) or coalesce(o.save_consumido, 0) > 0)
  ) or exists (
    select 1 from public.saves_aprovacoes s
     where s.job_id = p_job_id and s.situacao in ('aguardando', 'aprovado')
  ) then
    return 'O job tem save (gerado, consumido ou pedido): não se cancela pelo sistema. Fale com o financeiro.';
  end if;

  return null;
end;
$$;

-- ---- Pedir ----
create or replace function public.solicitar_cancelamento_do_job(p_job_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_job   record;
  v_trava text;
  v_id    uuid;
begin
  if coalesce(public.session_role()::text, '') not in ('administrador', 'gerente_producao') then
    raise exception 'Só o GP ou o administrador pede o cancelamento do job.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Escreva o motivo do cancelamento com pelo menos 10 caracteres.';
  end if;

  select j.id, j.tenant_id, j.status, j.data_abertura_financeiro
    into v_job
    from public.jobs j
   where j.id = p_job_id
   for update;
  if not found or not public.is_tenant_member(v_job.tenant_id) then
    raise exception 'Job não encontrado.';
  end if;
  if v_job.data_abertura_financeiro is null or v_job.status not in ('aberto', 'em_producao') then
    raise exception 'Só job aberto, e ainda não encerrado, tem pedido de cancelamento.';
  end if;
  if public.job_tem_cancelamento_pendente(p_job_id) then
    raise exception 'Este job já tem um pedido de cancelamento no financeiro.';
  end if;

  v_trava := public.trava_do_cancelamento_do_job(p_job_id);
  if v_trava is not null then
    raise exception '%', v_trava;
  end if;

  insert into public.jobs_cancelamentos (tenant_id, job_id, motivo, solicitado_por)
  values (v_job.tenant_id, p_job_id, btrim(p_motivo), v_uid)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---- Retirar (a produção desistiu) ----
create or replace function public.retirar_cancelamento_do_job(p_cancelamento_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c record;
begin
  if coalesce(public.session_role()::text, '') not in ('administrador', 'gerente_producao') then
    raise exception 'Só o GP ou o administrador retira o pedido de cancelamento.' using errcode = '42501';
  end if;
  select c.id, c.tenant_id, c.situacao
    into v_c
    from public.jobs_cancelamentos c
   where c.id = p_cancelamento_id
   for update;
  if not found or not public.is_tenant_member(v_c.tenant_id) then
    raise exception 'Pedido de cancelamento não encontrado.';
  end if;
  if v_c.situacao <> 'pendente' then
    raise exception 'O financeiro já decidiu este pedido. Recarregue a página.';
  end if;
  update public.jobs_cancelamentos
     set situacao = 'retirado',
         retirado_por = (select auth.uid()),
         retirado_em = now(),
         updated_at = now()
   where id = p_cancelamento_id;
end;
$$;

-- ---- Recusar (financeiro) ----
create or replace function public.recusar_cancelamento_do_job(p_cancelamento_id uuid, p_justificativa text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c record;
begin
  if coalesce(public.session_role()::text, '') not in ('administrador', 'financeiro') then
    raise exception 'Só o financeiro decide o pedido de cancelamento.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'Escreva a justificativa com pelo menos 10 caracteres.';
  end if;
  select c.id, c.tenant_id, c.situacao
    into v_c
    from public.jobs_cancelamentos c
   where c.id = p_cancelamento_id
   for update;
  if not found or not public.is_tenant_member(v_c.tenant_id) then
    raise exception 'Pedido de cancelamento não encontrado.';
  end if;
  if v_c.situacao <> 'pendente' then
    raise exception 'Este pedido já foi retirado ou decidido. Recarregue a página.';
  end if;
  update public.jobs_cancelamentos
     set situacao = 'recusado',
         decidido_por = (select auth.uid()),
         decidido_em = now(),
         justificativa = btrim(p_justificativa),
         updated_at = now()
   where id = p_cancelamento_id;
end;
$$;

-- ---- Aprovar (financeiro): o job é cancelado ----
create or replace function public.aprovar_cancelamento_do_job(p_cancelamento_id uuid, p_observacao text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c         record;
  v_job       record;
  v_trava     text;
  v_receb     numeric(14,2);
  v_custo     numeric(14,2);
  v_impostos  numeric(14,2);
  v_pf_inativ uuid;
  v_pf_codigo text;
begin
  if coalesce(public.session_role()::text, '') not in ('administrador', 'financeiro') then
    raise exception 'Só o financeiro decide o pedido de cancelamento.' using errcode = '42501';
  end if;

  select c.id, c.tenant_id, c.job_id, c.situacao
    into v_c
    from public.jobs_cancelamentos c
   where c.id = p_cancelamento_id
   for update;
  if not found or not public.is_tenant_member(v_c.tenant_id) then
    raise exception 'Pedido de cancelamento não encontrado.';
  end if;
  if v_c.situacao <> 'pendente' then
    raise exception 'Este pedido já foi retirado ou decidido. Recarregue a página.';
  end if;

  select j.id, j.codigo, j.status, j.projeto_financeiro_id
    into v_job
    from public.jobs j
   where j.id = v_c.job_id
   for update;
  if v_job.status not in ('aberto', 'em_producao') then
    raise exception 'O job não está mais aberto. Recarregue a página.';
  end if;

  -- O que travava o pedido pode ter surgido depois dele.
  v_trava := public.trava_do_cancelamento_do_job(v_c.job_id);
  if v_trava is not null then
    raise exception '%', v_trava;
  end if;

  select coalesce(sum(valor), 0) into v_receb
    from public.jobs_previsao_recebimento where job_id = v_c.job_id;
  select coalesce(sum(valor), 0) into v_custo
    from public.jobs_previsao_custo where job_id = v_c.job_id;
  select coalesce(sum(valor), 0) into v_impostos
    from public.jobs_previsao_impostos where job_id = v_c.job_id;

  update public.jobs
     set status = 'cancelado',
         abertura_em_revisao = false,
         updated_at = now()
   where id = v_c.job_id;

  -- O projeto financeiro sem outro job vivo sai das listas, como o
  -- ANI-F003/26 no caso de 09/10/2026.
  if v_job.projeto_financeiro_id is not null
     and not exists (
       select 1 from public.jobs j2
        where j2.projeto_financeiro_id = v_job.projeto_financeiro_id
          and j2.id <> v_c.job_id
          and j2.status <> 'cancelado'
     ) then
    update public.projetos_financeiro
       set ativo = false,
           updated_at = now()
     where id = v_job.projeto_financeiro_id
       and ativo = true
    returning id, codigo into v_pf_inativ, v_pf_codigo;
  end if;

  update public.jobs_cancelamentos
     set situacao = 'aprovado',
         decidido_por = (select auth.uid()),
         decidido_em = now(),
         justificativa = nullif(btrim(coalesce(p_observacao, '')), ''),
         recebimento_previsto = v_receb,
         custo_previsto = v_custo,
         impostos_previstos = v_impostos,
         projeto_financeiro_inativado_id = v_pf_inativ,
         updated_at = now()
   where id = p_cancelamento_id;

  return jsonb_build_object(
    'job_id', v_c.job_id,
    'job_codigo', v_job.codigo,
    'recebimento_previsto', v_receb,
    'custo_previsto', v_custo,
    'impostos_previstos', v_impostos,
    'projeto_financeiro_inativado', v_pf_codigo
  );
end;
$$;

-- ---- A produção leu a recusa ----
create or replace function public.dispensar_recusa_do_cancelamento(p_cancelamento_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c record;
begin
  if coalesce(public.session_role()::text, '') not in ('administrador', 'gerente_producao', 'produtor') then
    raise exception 'Seu papel não dispensa este aviso.' using errcode = '42501';
  end if;
  select c.id, c.tenant_id, c.situacao
    into v_c
    from public.jobs_cancelamentos c
   where c.id = p_cancelamento_id
   for update;
  if not found or not public.is_tenant_member(v_c.tenant_id) then
    raise exception 'Pedido de cancelamento não encontrado.';
  end if;
  if v_c.situacao <> 'recusado' then
    raise exception 'Só a recusa tem aviso a dispensar.';
  end if;
  update public.jobs_cancelamentos
     set aviso_dispensado_por = coalesce(aviso_dispensado_por, (select auth.uid())),
         aviso_dispensado_em = coalesce(aviso_dispensado_em, now()),
         updated_at = now()
   where id = p_cancelamento_id;
end;
$$;

-- ---- O job parado enquanto o pedido está no financeiro ----
-- Nada novo nasce no job: PP (e o envio dela), errata (e a pronta), pedido
-- de save, envio para faturamento e encerramento. Cancelar PP, o
-- financeiro reprovar a PP e o próprio cancelamento continuam.
create or replace function public.guarda_job_com_cancelamento_pendente()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job uuid;
begin
  if tg_table_name = 'jobs' then
    if new.status is not distinct from old.status
       or new.status not in ('encerrado', 'finalizado') then
      return new;
    end if;
    v_job := new.id;
  elsif tg_table_name = 'pedidos_compra' and tg_op = 'UPDATE' then
    -- Só o envio (e o reenvio) ao financeiro.
    if not (new.status = 'em_avaliacao' and old.status is distinct from 'em_avaliacao') then
      return new;
    end if;
    v_job := new.job_id;
  else
    v_job := new.job_id;
  end if;

  if public.job_tem_cancelamento_pendente(v_job) then
    raise exception 'Este job tem um pedido de cancelamento no financeiro: nada novo sai dele até a decisão. Para seguir com o job, retire o pedido.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pp_guarda_cancelamento_pendente on public.pedidos_compra;
create trigger trg_pp_guarda_cancelamento_pendente
  before insert or update of status on public.pedidos_compra
  for each row execute function public.guarda_job_com_cancelamento_pendente();

drop trigger if exists trg_errata_guarda_cancelamento_pendente on public.jobs_erratas;
create trigger trg_errata_guarda_cancelamento_pendente
  before insert on public.jobs_erratas
  for each row execute function public.guarda_job_com_cancelamento_pendente();

drop trigger if exists trg_errata_pronta_guarda_cancelamento_pendente on public.jobs_erratas_prontas;
create trigger trg_errata_pronta_guarda_cancelamento_pendente
  before insert on public.jobs_erratas_prontas
  for each row execute function public.guarda_job_com_cancelamento_pendente();

drop trigger if exists trg_save_guarda_cancelamento_pendente on public.saves_aprovacoes;
create trigger trg_save_guarda_cancelamento_pendente
  before insert on public.saves_aprovacoes
  for each row execute function public.guarda_job_com_cancelamento_pendente();

drop trigger if exists trg_envio_fat_guarda_cancelamento_pendente on public.jobs_envio_faturamento;
create trigger trg_envio_fat_guarda_cancelamento_pendente
  before insert on public.jobs_envio_faturamento
  for each row execute function public.guarda_job_com_cancelamento_pendente();

drop trigger if exists trg_job_guarda_cancelamento_pendente on public.jobs;
create trigger trg_job_guarda_cancelamento_pendente
  before update of status on public.jobs
  for each row execute function public.guarda_job_com_cancelamento_pendente();

-- ---- Permissões das funções ----
revoke all on function public.job_tem_cancelamento_pendente(uuid) from public, anon;
revoke all on function public.trava_do_cancelamento_do_job(uuid) from public, anon;
revoke all on function public.solicitar_cancelamento_do_job(uuid, text) from public, anon;
revoke all on function public.retirar_cancelamento_do_job(uuid) from public, anon;
revoke all on function public.recusar_cancelamento_do_job(uuid, text) from public, anon;
revoke all on function public.aprovar_cancelamento_do_job(uuid, text) from public, anon;
revoke all on function public.dispensar_recusa_do_cancelamento(uuid) from public, anon;
revoke all on function public.guarda_job_com_cancelamento_pendente() from public, anon;

grant execute on function public.job_tem_cancelamento_pendente(uuid) to authenticated;
grant execute on function public.trava_do_cancelamento_do_job(uuid) to authenticated;
grant execute on function public.solicitar_cancelamento_do_job(uuid, text) to authenticated;
grant execute on function public.retirar_cancelamento_do_job(uuid) to authenticated;
grant execute on function public.recusar_cancelamento_do_job(uuid, text) to authenticated;
grant execute on function public.aprovar_cancelamento_do_job(uuid, text) to authenticated;
grant execute on function public.dispensar_recusa_do_cancelamento(uuid) to authenticated;

comment on table public.jobs_cancelamentos is
  'Pedido de cancelamento de job JA ABERTO (decisao 169): a producao pede com motivo, o financeiro aprova ou recusa na Abertura de Job. Um pendente por job; retirado, recusado e aprovado ficam como historico. Escrita so pelas funcoes *_cancelamento_do_job.';
comment on column public.jobs_cancelamentos.justificativa is
  'Na recusa, a justificativa do financeiro (obrigatoria, vai a pagina do job). Na aprovacao, a observacao opcional que fica no rastro do orcamento.';
comment on column public.jobs_cancelamentos.recebimento_previsto is
  'Foto, na aprovacao, da soma de jobs_previsao_recebimento: o que saiu do fluxo de caixa. As previsoes ficam gravadas; as views ignoram job cancelado.';
comment on column public.jobs_cancelamentos.projeto_financeiro_inativado_id is
  'O projeto financeiro que a aprovacao deixou inativo por ficar sem job vivo. Nulo quando ele tinha outro job.';
comment on function public.trava_do_cancelamento_do_job(uuid) is
  'Decisao 169: a primeira trava do cancelamento do job (PP paga, aprovada ou viva, envio para faturamento, lancamento, recebimento antes da NF, desembolso, save), em texto para a tela; nulo sem trava.';
