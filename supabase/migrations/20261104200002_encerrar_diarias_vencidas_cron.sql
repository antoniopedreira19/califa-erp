-- 04/11/2026: encerra automaticamente contratos de diária vencidos.
--
-- Regra de negócio: diária tem natureza finita por definição (acabou o
-- período, acabou o trabalho). Ao contrário de mensal (que pode renovar
-- tacitamente) ou período (escopo variável), diária vencida deve virar
-- `status_real = false` automaticamente — senão fica para sempre no
-- bucket "irregular" só porque o GP esqueceu de encerrar manualmente.
--
-- Escopo: só `tipo='diarias'`. Mensal e período continuam dependendo de
-- encerramento manual pelo RH (via distrato ou edição direta).
--
-- Mecânica:
--   1. Função `fn_encerrar_diarias_vencidas()` seta status_real=false em
--      todas as diárias com data_termino < hoje (BRT) e status_real=true.
--   2. pg_cron roda a função 1x/dia às 05:00 BRT (08:00 UTC).
--   3. Backfill: roda a função UMA vez na própria migration pra fechar as
--      diárias já vencidas (9 contratos de setembro/outubro que apareciam
--      em 'irregular' na view por nunca terem sido encerrados).
--
-- Mudança aditiva. Função é idempotente (rodar de novo não muda nada).
-- Reversão: se precisar reverter, `select cron.unschedule('freelancers_encerrar_diarias_vencidas');`
-- e depois revisar manualmente os contratos que você quer reabrir.

begin;

create or replace function public.fn_encerrar_diarias_vencidas()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_count integer;
begin
  update public.freelancer_contratos
     set status_real = false,
         updated_at = now()
   where tipo = 'diarias'
     and status_real = true
     and data_termino is not null
     and data_termino < v_hoje;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.fn_encerrar_diarias_vencidas is
  'Rotina diária: fecha automaticamente contratos de freelancer tipo=diarias com data_termino < hoje (BRT). Idempotente. Retorna quantidade encerrada na execução.';

-- Agenda no pg_cron (05:00 BRT = 08:00 UTC)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'freelancers_encerrar_diarias_vencidas') then
    perform cron.unschedule('freelancers_encerrar_diarias_vencidas');
  end if;
end$$;

select cron.schedule(
  'freelancers_encerrar_diarias_vencidas',
  '0 8 * * *',
  $$select public.fn_encerrar_diarias_vencidas();$$
);

-- Backfill: roda uma vez agora pra fechar as diárias já vencidas.
select public.fn_encerrar_diarias_vencidas() as encerrados_no_backfill;

commit;
