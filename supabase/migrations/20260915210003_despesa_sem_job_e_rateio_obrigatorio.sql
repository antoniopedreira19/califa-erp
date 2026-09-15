-- =====================================================================
-- Avulsa e recorrente não têm job, e não existem sem rateio de regional
--
-- Decisão do Tiago em 15/09/2026, revisando a 069: "assim como no caso
-- dos desembolsos, lançamentos avulsos não devem ter job. Tudo do job
-- deverá estar contabilizado em sua planilha, então nada poderá vir por
-- fora." E: "todo lançamento precisa ter uma regional, e se tiver mais de
-- uma, o rateio precisará ser definido no momento de sua criação".
--
-- ⚠️ ORDEM DE APLICAÇÃO. Esta migration só entra DEPOIS de o código que
-- grava despesa e rateio juntos (`20260915210001`) estar no ar. Com o
-- código antigo — despesa numa requisição, rateio em outra — a trava
-- abaixo recusaria toda criação de avulsa e recorrência. É o erro de
-- 08/09 que não se repete.
--
-- ---------------------------------------------------------------------
-- 1. Sem job
--
-- CHECK nas duas tabelas, como o desembolso ganhou em 10/09. As colunas
-- ficam (remover é destrutivo) e vazias. Estavam com 0 linhas.
--
-- 2. Rateio obrigatório
--
-- Constraint triggers ADIADOS para o fim da transação:
--   - no insert da despesa: ela precisa terminar a transação com ao menos
--     uma linha de rateio;
--   - no delete de linha de rateio: a despesa (se ainda existir) não pode
--     terminar a transação sem nenhuma.
-- Excluir a despesa inteira continua valendo: o cascade apaga o rateio e
-- o gatilho vê que a despesa não existe mais.
--
-- Quem já grava as duas coisas numa transação e passa pela trava:
-- `criar_conta_avulsa`, `substituir_rateio_conta_avulsa`,
-- `criar_conta_recorrente`, `substituir_rateio_conta_recorrente`,
-- `parcelar_compra_cartao` (copia o rateio para as parcelas) e
-- `materializar_ocorrencias_da_recorrente` (copia para a ocorrência).
--
-- SECURITY DEFINER nas funções dos gatilhos para enxergar despesa e rateio
-- independentemente da RLS de quem grava.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Sem job
-- ---------------------------------------------------------------------
alter table public.contas_avulsas
  add constraint conta_avulsa_nao_tem_job check (job_id is null);

alter table public.contas_avulsas_recorrentes
  add constraint recorrente_nao_tem_job check (job_id is null);

comment on column public.contas_avulsas.job_id is
  'SEM USO desde 15/09/2026 — barrada pelo CHECK conta_avulsa_nao_tem_job. Tudo do job entra pela planilha do job (PP); a avulsa é despesa sem job e tem a regional pelo rateio (contas_avulsas_regionais). A coluna ficou porque removê-la é destrutivo.';

comment on column public.contas_avulsas_recorrentes.job_id is
  'SEM USO desde 15/09/2026 — barrada pelo CHECK recorrente_nao_tem_job. A recorrência é despesa sem job e tem a regional pelo rateio (contas_avulsas_recorrentes_regionais).';

-- ---------------------------------------------------------------------
-- 2. Rateio obrigatório
-- ---------------------------------------------------------------------
create or replace function public.exige_rateio_conta_avulsa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'contas_avulsas' then
    v_id := new.id;
  else
    v_id := old.conta_avulsa_id;
  end if;

  if exists (select 1 from public.contas_avulsas a where a.id = v_id)
     and not exists (select 1 from public.contas_avulsas_regionais r where r.conta_avulsa_id = v_id) then
    raise exception 'Toda conta avulsa precisa de rateio de regional. Informe ao menos uma regional.'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

create constraint trigger trg_avulsa_exige_rateio
  after insert on public.contas_avulsas
  deferrable initially deferred
  for each row execute function public.exige_rateio_conta_avulsa();

create constraint trigger trg_avulsa_rateio_nao_zera
  after delete on public.contas_avulsas_regionais
  deferrable initially deferred
  for each row execute function public.exige_rateio_conta_avulsa();

create or replace function public.exige_rateio_conta_recorrente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'contas_avulsas_recorrentes' then
    v_id := new.id;
  else
    v_id := old.recorrente_id;
  end if;

  if exists (select 1 from public.contas_avulsas_recorrentes t where t.id = v_id)
     and not exists (select 1 from public.contas_avulsas_recorrentes_regionais r where r.recorrente_id = v_id) then
    raise exception 'Toda recorrência precisa de rateio de regional. Informe ao menos uma regional.'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

create constraint trigger trg_recorrente_exige_rateio
  after insert on public.contas_avulsas_recorrentes
  deferrable initially deferred
  for each row execute function public.exige_rateio_conta_recorrente();

create constraint trigger trg_recorrente_rateio_nao_zera
  after delete on public.contas_avulsas_recorrentes_regionais
  deferrable initially deferred
  for each row execute function public.exige_rateio_conta_recorrente();

-- Funções de gatilho: não são RPC. Gatilho não exige EXECUTE de quem grava.
revoke all on function public.exige_rateio_conta_avulsa() from public, anon, authenticated;
revoke all on function public.exige_rateio_conta_recorrente() from public, anon, authenticated;

comment on function public.exige_rateio_conta_avulsa() is
  'A conta avulsa não termina a transação sem ao menos uma linha em contas_avulsas_regionais. Decisão 069, revisão de 15/09/2026.';
comment on function public.exige_rateio_conta_recorrente() is
  'A recorrência não termina a transação sem ao menos uma linha em contas_avulsas_recorrentes_regionais. Decisão 069, revisão de 15/09/2026.';
