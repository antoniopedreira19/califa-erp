-- =====================================================================
-- Decisão 094 — "Em faturamento" e o Finalizado que vale pelo ENVIO
-- =====================================================================
-- Revê a 087 §3 (Tiago, 20/09/2026). O módulo Jobs deixa de olhar a nota:
-- se o job foi faturado ou não é controle do financeiro — nota cancelada
-- se reemite em Contas a Receber. Para a produção, a ação de faturamento
-- é o ENVIO, que é quando o faturamento está alinhado com o cliente.
--
--   * aberto  + todo o faturamento enviado  -> selo "Em faturamento"
--     (calculado: o status no banco continua `aberto`, e nenhuma trava de
--     `aberto` muda — PP, realizado e BV seguem liberados);
--   * encerrado sem o envio completo        -> "Encerrado" (já existia);
--   * encerrado + todo o faturamento enviado -> `finalizado`.
--
-- "Todo o faturamento enviado" é a primeira metade da conta que a 087 já
-- fazia em `job_esta_faturado`: a soma dos envios cobre o faturamento
-- previsto, com os mesmos 5 centavos de folga (JOB-0034: meses somam
-- R$ 50.105,64, job R$ 50.105,63). No mensal isso só acontece no ÚLTIMO
-- mês enviado. A segunda metade (parcela sem nota emitida) sai.
--
-- Job de faturamento previsto zero (pago só por save, 028 §11): nunca
-- recebe o carimbo — não houve envio, o selo segue "Aberto" — e continua
-- virando `finalizado` direto no encerramento, como na 087.
--
-- 1) `jobs.faturamento_enviado_em`: carimbo de quando o envio ficou
--    completo. É o que as listas leem para o selo, sem embed nem soma.
--    Mantido pelo banco; um PATCH direto na coluna é recalculado.
-- 2) Gatilho em `jobs_envio_faturamento`: carimba e, se o job já estiver
--    encerrado, finaliza. Trava a linha do job (`for update`) — fecha a
--    corrida entre envio e encerramento apontada na revisão da 087.
-- 3) `jobs_finaliza_ao_encerrar` passa a olhar o envio, não a nota.
-- 4) O gatilho da nota (`trg_faturamento_itens_finaliza_job`) sai: com o
--    envio completo o job encerrado já está finalizado antes de qualquer
--    nota. `job_esta_faturado` fica, sem uso pelo módulo Jobs.
--
-- Conferido em 20/09/2026: nenhum job está `encerrado`, então nenhum muda
-- de status aqui. O backfill só preenche o carimbo vazio dos jobs com o
-- envio completo (JOB-0010, JOB-0029, JOB-0033 e os dois finalizados).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Carimbo
-- ---------------------------------------------------------------------
alter table public.jobs
  add column if not exists faturamento_enviado_em timestamptz;

comment on column public.jobs.faturamento_enviado_em is
  'Quando todo o faturamento previsto do job ficou enviado para faturamento (no mensal, o último mês). Mantido por gatilho; nulo = ainda falta enviar, ou job sem faturamento (decisão 094).';

-- ---------------------------------------------------------------------
-- 2) Todo o faturamento enviado?
-- ---------------------------------------------------------------------
create or replace function public.job_faturamento_todo_enviado(
  p_job_id uuid,
  p_previsto numeric
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_previsto, 0) > 0.004
     and coalesce(sum(e.valor_faturado), 0) > 0
     and coalesce(sum(e.valor_faturado), 0) >= coalesce(p_previsto, 0) - 0.05
    from public.jobs_envio_faturamento e
   where e.job_id = p_job_id;
$$;

comment on function public.job_faturamento_todo_enviado(uuid, numeric) is
  'A soma dos envios para faturamento cobre o faturamento previsto do job, com 5 centavos de folga. Falso para job sem faturamento previsto (decisão 094).';

revoke all on function public.job_faturamento_todo_enviado(uuid, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) O carimbo é do banco: recalculado quando o previsto muda (errata) e
--    quando alguém tenta escrever nele direto.
-- ---------------------------------------------------------------------
create or replace function public.jobs_carimba_faturamento_enviado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.job_faturamento_todo_enviado(new.id, new.faturamento_previsto) then
    new.faturamento_enviado_em :=
      coalesce(old.faturamento_enviado_em, new.faturamento_enviado_em, now());
  else
    new.faturamento_enviado_em := null;
  end if;
  return new;
end;
$$;

revoke all on function public.jobs_carimba_faturamento_enviado() from public, anon, authenticated;

drop trigger if exists trg_jobs_carimba_faturamento_enviado on public.jobs;
create trigger trg_jobs_carimba_faturamento_enviado
  before update of faturamento_previsto, faturamento_enviado_em on public.jobs
  for each row
  execute function public.jobs_carimba_faturamento_enviado();

-- ---------------------------------------------------------------------
-- 4) No envio: carimba e, se o job já estava encerrado, finaliza
-- ---------------------------------------------------------------------
create or replace function public.envio_faturamento_marca_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   public.job_status;
  v_previsto numeric;
  v_tenant   uuid;
begin
  select j.status, j.faturamento_previsto, j.tenant_id
    into v_status, v_previsto, v_tenant
    from public.jobs j
   where j.id = new.job_id
     for update;

  if not found
     or not public.job_faturamento_todo_enviado(new.job_id, v_previsto) then
    return null;
  end if;

  -- O gatilho da seção 3 confere o carimbo de novo e preserva o que já
  -- existia.
  if v_status = 'encerrado' then
    update public.jobs
       set faturamento_enviado_em = now(),
           status = 'finalizado',
           finalizado_em = now()
     where id = new.job_id;

    if auth.uid() is not null then
      perform public.log_audit_event(
        'job.finalizado', v_tenant, 'job', new.job_id::text,
        jsonb_build_object('momento', 'envio_para_faturamento', 'envio_id', new.id)
      );
    end if;
  else
    update public.jobs
       set faturamento_enviado_em = now()
     where id = new.job_id;
  end if;

  return null;
end;
$$;

revoke all on function public.envio_faturamento_marca_job() from public, anon, authenticated;

drop trigger if exists trg_envio_faturamento_marca_job on public.jobs_envio_faturamento;
create trigger trg_envio_faturamento_marca_job
  after insert or update of valor_faturado on public.jobs_envio_faturamento
  for each row
  execute function public.envio_faturamento_marca_job();

-- ---------------------------------------------------------------------
-- 5) No encerramento: finaliza se o envio já está completo (ou se o job
--    não tem o que faturar)
-- ---------------------------------------------------------------------
create or replace function public.jobs_finaliza_ao_encerrar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'encerrado'
     and old.status is distinct from 'encerrado'
     and (
       coalesce(new.faturamento_previsto, 0) <= 0.004
       or public.job_faturamento_todo_enviado(new.id, new.faturamento_previsto)
     ) then
    new.status := 'finalizado';
    new.finalizado_em := now();
    if auth.uid() is not null then
      perform public.log_audit_event(
        'job.finalizado', new.tenant_id, 'job', new.id::text,
        jsonb_build_object('momento', 'encerramento')
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.jobs_finaliza_ao_encerrar() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6) A nota deixa de finalizar o job
-- ---------------------------------------------------------------------
drop trigger if exists trg_faturamento_itens_finaliza_job on public.faturamento_itens;
drop function if exists public.faturamento_item_finaliza_job();

comment on function public.job_esta_faturado(uuid) is
  'Todo o faturamento previsto do job foi enviado e está coberto por nota emitida (decisão 087). Desde a decisão 094 não decide mais o status do job.';

-- ---------------------------------------------------------------------
-- 7) Backfill: só preenche o carimbo vazio
-- ---------------------------------------------------------------------
update public.jobs j
   set faturamento_enviado_em = (
         select max(e.enviado_em)
           from public.jobs_envio_faturamento e
          where e.job_id = j.id
       )
 where j.faturamento_enviado_em is null
   and public.job_faturamento_todo_enviado(j.id, j.faturamento_previsto);
