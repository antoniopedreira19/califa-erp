-- =====================================================================
-- Decisão 087 — quem encerrou, quando, e o job que se finaliza sozinho
-- =====================================================================
-- 1) `jobs.encerrado_em` / `encerrado_por`: o "Ver envio para
--    encerramento" mostra quem enviou e quando. Até aqui isso só existia
--    na auditoria (`job.encerrado`). `finalizado_em` registra o momento em
--    que o job ficou faturado E encerrado.
--
-- 2) `job_esta_faturado(job)`: todo o faturamento do job já saiu em nota.
--    Vale para os dois modelos com a mesma conta:
--      * o que foi enviado para faturamento cobre o faturamento previsto
--        do job (no mensal, a soma dos meses enviados; 5 centavos de folga
--        para o arredondamento da divisão por mês — no JOB-0034 os meses
--        somam R$ 50.105,64 e o job R$ 50.105,63);
--      * nenhuma parcela do envio tem saldo sem nota EMITIDA (piso de um
--        centavo, o mesmo de `lib/data/saldo-a-faturar.ts`).
--    Job sem nada a faturar (faturamento previsto zero — o pago só por
--    save da decisão 028 §11) está faturado por definição.
--
-- 3) O job vira `finalizado` em dois momentos, e só neles:
--      * no ENCERRAMENTO, se já estiver faturado — gatilho BEFORE UPDATE
--        em `jobs`, que troca o `encerrado` pedido por `finalizado`;
--      * na EMISSÃO da nota que zera o saldo de um job encerrado —
--        gatilho AFTER INSERT em `faturamento_itens`, que não mexe na
--        `emitir_faturamento` (alterada hoje pela decisão 086).
--
--    Nota cancelada NÃO devolve o job a `encerrado` (Tiago, 16/09/2026):
--    o envio para faturamento continua o mesmo, e o financeiro emite outra
--    nota em Contas a Receber. Por isso não há gatilho no cancelamento.
--
-- Aditiva: colunas novas nulas, funções e gatilhos novos. Nenhum job está
-- encerrado hoje (conferido em 16/09/2026), então não há o que preencher.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Colunas
-- ---------------------------------------------------------------------
alter table public.jobs
  add column if not exists encerrado_em timestamptz,
  add column if not exists encerrado_por uuid references public.profiles(id) on delete restrict,
  add column if not exists finalizado_em timestamptz;

comment on column public.jobs.encerrado_em is
  'Quando a produção enviou o job para encerramento (decisão 087).';
comment on column public.jobs.encerrado_por is
  'Quem enviou o job para encerramento (decisão 087).';
comment on column public.jobs.finalizado_em is
  'Quando o job ficou faturado e encerrado, e passou a finalizado (decisão 087).';

create index if not exists jobs_encerrado_por_idx
  on public.jobs (encerrado_por)
  where encerrado_por is not null;

-- ---------------------------------------------------------------------
-- 2) Faturado?
-- ---------------------------------------------------------------------
create or replace function public.job_esta_faturado(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with previsto as (
    select coalesce(j.faturamento_previsto, 0) as valor
      from public.jobs j
     where j.id = p_job_id
  ),
  enviado as (
    select coalesce(sum(e.valor_faturado), 0) as valor
      from public.jobs_envio_faturamento e
     where e.job_id = p_job_id
  ),
  saldo as (
    select coalesce(sum(greatest(0, par.valor - coalesce((
             select sum(fi.valor)
               from public.faturamento_itens fi
               join public.faturamentos f on f.id = fi.faturamento_id
              where fi.envio_parcela_id = par.id
                and f.status = 'emitido'
           ), 0))), 0) as valor
      from public.jobs_envio_faturamento_parcelas par
     where par.job_id = p_job_id
  )
  select exists (select 1 from previsto)
     and (select valor from enviado) >= (select valor from previsto) - 0.05
     and (select valor from saldo) <= 0.01;
$$;

comment on function public.job_esta_faturado(uuid) is
  'Todo o faturamento previsto do job foi enviado e está coberto por nota emitida (decisão 087).';

revoke all on function public.job_esta_faturado(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3a) No encerramento
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
     and public.job_esta_faturado(new.id) then
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

drop trigger if exists trg_jobs_finaliza_ao_encerrar on public.jobs;
create trigger trg_jobs_finaliza_ao_encerrar
  before update of status on public.jobs
  for each row
  execute function public.jobs_finaliza_ao_encerrar();

-- ---------------------------------------------------------------------
-- 3b) Na emissão da nota
-- ---------------------------------------------------------------------
create or replace function public.faturamento_item_finaliza_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id    uuid;
  v_tenant_id uuid;
begin
  if new.envio_parcela_id is null then
    return null;
  end if;

  select par.job_id, par.tenant_id
    into v_job_id, v_tenant_id
    from public.jobs_envio_faturamento_parcelas par
   where par.id = new.envio_parcela_id;

  if v_job_id is null
     or not exists (
       select 1 from public.faturamentos f
        where f.id = new.faturamento_id and f.status = 'emitido'
     )
     or not exists (
       select 1 from public.jobs j
        where j.id = v_job_id and j.status = 'encerrado'
     )
     or not public.job_esta_faturado(v_job_id) then
    return null;
  end if;

  update public.jobs
     set status = 'finalizado',
         finalizado_em = now()
   where id = v_job_id
     and status = 'encerrado';

  if found and auth.uid() is not null then
    perform public.log_audit_event(
      'job.finalizado', v_tenant_id, 'job', v_job_id::text,
      jsonb_build_object('momento', 'emissao_da_nota', 'faturamento_id', new.faturamento_id)
    );
  end if;

  return null;
end;
$$;

revoke all on function public.faturamento_item_finaliza_job() from public, anon, authenticated;

drop trigger if exists trg_faturamento_itens_finaliza_job on public.faturamento_itens;
create trigger trg_faturamento_itens_finaliza_job
  after insert on public.faturamento_itens
  for each row
  execute function public.faturamento_item_finaliza_job();
