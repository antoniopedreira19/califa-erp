-- =====================================================================
-- Mútuo (decisão 230): o IOF pago até a data de corte
-- =====================================================================
--
-- O bloco da empresa de fora mostra o IOF pago até hoje. O que foi pago até
-- 30/09 está na planilha e não passa pela linha do banco: fica junto do saldo
-- de abertura do par. Daí em diante, soma o que entrar em `mutuos_iof`.
-- =====================================================================

alter table public.mutuos_saldo_abertura
  add column if not exists iof_pago numeric(14,2) not null default 0;

comment on column public.mutuos_saldo_abertura.iof_pago is
  'IOF do mútuo pago até a data de corte, pela planilha. Só informa.';

-- As saídas que formam o saldo da empresa de fora: os juros informados contam
-- desde cada uma, e não desde uma data só.
alter table public.mutuos_saldo_abertura
  add column if not exists saidas jsonb not null default '[]'::jsonb;

comment on column public.mutuos_saldo_abertura.saidas is
  'As saídas que formam o saldo da empresa de fora: [{data, valor}]. Os juros informados contam desde cada uma.';

alter table public.mutuos_saldo_abertura drop column if exists juros_desde;
