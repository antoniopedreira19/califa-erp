-- A fatura do cartão.
--
-- Fatia 3, passo 2 de 4. A fatura NÃO é uma conta: o saldo do cartão é
-- contínuo, e o fechamento é só uma linha de corte para agrupar. A compra
-- feita entre o fechamento e o pagamento já é da fatura seguinte e
-- sobrevive ao pagamento da anterior.
--
-- Por isso a fatura é uma JANELA sobre o razão do cartão: ela agrupa
-- lançamentos que já existem, não os guarda.
--
-- Duas datas do cartão, dois papéis (migration 20260828120001):
--   · FECHAMENTO decide em qual fatura a compra cai → `competencia_fechamento`
--   · VENCIMENTO decide quando ela é paga           → `data_vencimento`

do $$
begin
  if not exists (select 1 from pg_type where typname = 'fatura_cartao_status') then
    create type public.fatura_cartao_status as enum (
      'aberta',    -- ainda recebe compra
      'fechada',   -- passou do fechamento; vira título a pagar
      'paga',
      'cancelada'
    );
  end if;
end
$$;

create table if not exists public.faturas_cartao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  cartao_credito_id uuid not null references public.cartoes_credito (id) on delete cascade,
  codigo text not null,
  -- A linha de corte desta fatura. É ela que define a janela.
  competencia_fechamento date not null,
  data_vencimento date not null,
  status public.fatura_cartao_status not null default 'aberta',
  -- O que o banco cobrou de verdade. Preenchido na conciliação da aba
  -- Cartão; enquanto for nulo, a fatura só conhece a própria soma.
  valor_cobrado numeric,
  fechada_em timestamptz,
  fechada_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

comment on table public.faturas_cartao is
  'Janela sobre o razão do cartão: agrupa os lançamentos entre dois fechamentos. Não guarda saldo — o saldo do cartão é contínuo e mora na conta espelho (28/08/2026).';
comment on column public.faturas_cartao.valor_cobrado is
  'O que o banco cobrou. Informado na conciliação; a diferença para a soma dos lançamentos é o que a aba Cartão pede para resolver.';

create unique index if not exists uniq_fatura_por_cartao_competencia
  on public.faturas_cartao (cartao_credito_id, competencia_fechamento);

create unique index if not exists uniq_fatura_codigo_por_tenant
  on public.faturas_cartao (tenant_id, codigo);

create index if not exists idx_faturas_cartao_abertas
  on public.faturas_cartao (cartao_credito_id, status)
  where status = 'aberta';

alter table public.faturas_cartao enable row level security;

drop policy if exists faturas_cartao_select on public.faturas_cartao;
create policy faturas_cartao_select on public.faturas_cartao
  for select using (is_tenant_member(tenant_id));

drop policy if exists faturas_cartao_insert on public.faturas_cartao;
create policy faturas_cartao_insert on public.faturas_cartao
  for insert with check (is_tenant_member(tenant_id));

drop policy if exists faturas_cartao_update on public.faturas_cartao;
create policy faturas_cartao_update on public.faturas_cartao
  for update using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

drop policy if exists faturas_cartao_delete on public.faturas_cartao;
create policy faturas_cartao_delete on public.faturas_cartao
  for delete using (is_tenant_member(tenant_id));

grant select, insert, update, delete on public.faturas_cartao to authenticated;

-- ---------------------------------------------------------------------
-- O lançamento sabe de que fatura ele é
-- ---------------------------------------------------------------------
-- Vínculo explícito, e não derivado por intervalo de data: é ele que
-- permite MOVER um lançamento de fatura — o "redirecionar pagamento" da
-- aba Cartão, para quando a compra caiu no cartão errado.

alter table public.lancamentos_financeiros
  add column if not exists fatura_cartao_id uuid
    references public.faturas_cartao (id) on delete set null;

create index if not exists idx_lancamentos_fatura_cartao
  on public.lancamentos_financeiros (fatura_cartao_id)
  where fatura_cartao_id is not null;

comment on column public.lancamentos_financeiros.fatura_cartao_id is
  'Fatura em que esta compra caiu. Só em lançamento de conta de cartão. Explícito para permitir remanejar a compra que caiu no cartão ou na fatura errada.';

-- ---------------------------------------------------------------------
-- Código: FC-00001
-- ---------------------------------------------------------------------
-- `FC` e não `FAT`: faturamento já é a NF de saída, e as duas coisas
-- aparecem lado a lado na coluna Origem da Conciliação.

create or replace function public.gerar_codigo_fatura_cartao(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prox integer;
begin
  perform pg_advisory_xact_lock(hashtext('fatura_cartao_seq_' || p_tenant_id::text));

  select coalesce(max(cast(substring(codigo from '^FC-(\d+)$') as integer)), 0) + 1
    into v_prox
    from public.faturas_cartao
   where tenant_id = p_tenant_id
     and codigo ~ '^FC-\d+$';

  return 'FC-' || lpad(v_prox::text, 5, '0');
end;
$function$;

revoke execute on function public.gerar_codigo_fatura_cartao(uuid) from public;
grant execute on function public.gerar_codigo_fatura_cartao(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- A fatura que recebe uma compra, criada sob demanda
-- ---------------------------------------------------------------------
-- Criar sob demanda, e não por cron: a fatura só precisa existir quando
-- alguma compra cai nela. Um cron criaria fatura vazia todo mês para
-- cartão que ninguém usou.

create or replace function public.fatura_aberta_do_cartao(
  p_cartao_id uuid,
  p_data date
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cartao      cartoes_credito%rowtype;
  v_fecha       int;
  v_competencia date;
  v_vencimento  date;
  v_fatura_id   uuid;
  v_ultimo_dia  int;
  v_ano         int;
  v_mes         int;
begin
  select * into v_cartao from cartoes_credito where id = p_cartao_id;
  if not found then raise exception 'Cartão não encontrado: %', p_cartao_id; end if;

  -- Sem fechamento cadastrado, o vencimento faz as vezes de fronteira —
  -- mesma regra de compatibilidade de `proxima_fatura_cartao`.
  v_fecha := coalesce(v_cartao.dia_fechamento_fatura, v_cartao.dia_vencimento_fatura);

  v_ano := extract(year  from p_data);
  v_mes := extract(month from p_data);
  if extract(day from p_data)::int > v_fecha then
    v_mes := v_mes + 1;
  end if;
  v_ano := v_ano + ((v_mes - 1) / 12);
  v_mes := ((v_mes - 1) % 12) + 1;

  v_ultimo_dia := extract(day from
    (date_trunc('month', make_date(v_ano, v_mes, 1)) + interval '1 month - 1 day')::date);
  v_competencia := make_date(v_ano, v_mes, least(v_fecha, v_ultimo_dia));

  v_vencimento := public.proxima_fatura_cartao(p_cartao_id, p_data);

  select id into v_fatura_id
    from faturas_cartao
   where cartao_credito_id = p_cartao_id
     and competencia_fechamento = v_competencia;

  if v_fatura_id is not null then
    return v_fatura_id;
  end if;

  insert into faturas_cartao (
    tenant_id, cartao_credito_id, codigo,
    competencia_fechamento, data_vencimento, status, created_by
  ) values (
    v_cartao.tenant_id, p_cartao_id,
    public.gerar_codigo_fatura_cartao(v_cartao.tenant_id),
    v_competencia, v_vencimento, 'aberta', auth.uid()
  )
  returning id into v_fatura_id;

  return v_fatura_id;
end;
$function$;

revoke execute on function public.fatura_aberta_do_cartao(uuid, date) from public;
grant execute on function public.fatura_aberta_do_cartao(uuid, date) to authenticated;
