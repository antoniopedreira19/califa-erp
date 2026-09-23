-- =====================================================================
-- Previsão de impostos na abertura do job (decisão 100)
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- A abertura do job registrava duas previsões — recebimento (entrada) e
-- custos (saída) — e a "margem prevista" dela era faturamento − custo. A
-- planilha interna, na mesma hora, mostrava o resultado operacional
-- descontando também os IMPOSTOS. No JOB-0036: abertura R$ 69.000,12,
-- planilha R$ 40.681,60 — a diferença é exatamente o imposto da versão
-- aprovada (R$ 28.318,52 = 19,53% sobre R$ 145.000,12).
--
-- Esta migration dá à abertura a terceira previsão: em que datas o imposto
-- sai do caixa, e de qual conta.
--
-- DECISÕES DO TIAGO (22–23/09/2026) QUE ELA MATERIALIZA
--
-- • Tabela própria, espelho de `jobs_previsao_custo` e
--   `jobs_previsao_recebimento` — mesma forma, mesma RLS, mesmo contrato
--   de "regravada inteira a cada edição".
-- • A soma das linhas fecha com o imposto embutido no faturamento
--   previsto (imposto brasileiro + int. taxes no internacional; os custos
--   de transação ficam de fora por ora). Quem confere é a Server Action,
--   relendo o total do banco — como nas outras duas.
-- • A data é escolhida à mão, sem regra de janela: o recolhimento é no
--   mês seguinte ao faturamento, mas a data de recebimento nem sempre é a
--   do faturamento.
-- • Conta própria (`jobs.conta_impostos_id`), como as de recebimento e de
--   pagamento. Obrigatória para abrir quando há imposto — obrigação da
--   Server Action, não do banco: jobs abertos antes desta data não têm a
--   conta, e NOT NULL os deixaria inválidos.
-- • NADA abate esta previsão ainda, e ela NÃO entra na `vw_fluxo_caixa`
--   (decisão do Tiago, 23/09). Virá um módulo fiscal que calcula o tributo
--   a partir do contas a receber e a pagar, transforma em título e dá
--   baixa. Levar a previsão ao fluxo antes disso faria o imposto pago por
--   conta avulsa aparecer duas vezes.
--
-- • A foto do registro (`jobs_aberturas`, decisão 059) passa a guardar a
--   conta, o cronograma e o total de impostos. Fotos anteriores ficam com
--   as três colunas nulas — é o que a tela lê como "registro anterior à
--   previsão de impostos".
--
-- LADO DESTRUTIVO: NENHUM. Uma tabela nova, três colunas novas nulas em
-- `jobs_aberturas` e uma coluna nova nula em `jobs`. Nenhuma linha
-- existente é tocada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A conta dos impostos do job
-- ---------------------------------------------------------------------

alter table public.jobs
  add column if not exists conta_impostos_id uuid
    references public.contas_bancarias(id) on delete restrict;

create index if not exists idx_jobs_conta_impostos
  on public.jobs(conta_impostos_id)
  where conta_impostos_id is not null;

comment on column public.jobs.conta_impostos_id is
  'Conta de onde sai o recolhimento dos impostos do job (decisão 100). Obrigatória na abertura quando há imposto previsto; nula nos jobs abertos antes de 23/09/2026.';

-- ---------------------------------------------------------------------
-- 2. O cronograma de recolhimento
-- ---------------------------------------------------------------------

create table if not exists public.jobs_previsao_impostos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete cascade,
  -- Posição da linha (I01, I02...). A ação regrava a previsão inteira a
  -- cada edição, então a ordem nunca fica com buraco.
  ordem smallint not null,
  data_prevista date not null,
  valor numeric(14, 2) not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- >= 0 pelo mesmo motivo das outras duas previsões: quem recusa linha
  -- zerada é a Server Action, com mensagem legível.
  constraint chk_previsao_impostos_valor_nao_negativo check (valor >= 0),
  constraint uniq_previsao_impostos_job_ordem unique (job_id, ordem)
);

create index if not exists idx_previsao_impostos_job
  on public.jobs_previsao_impostos(job_id);
create index if not exists idx_previsao_impostos_tenant
  on public.jobs_previsao_impostos(tenant_id);
-- O fluxo de caixa (quando o módulo fiscal chegar) lê por data no tenant.
create index if not exists idx_previsao_impostos_data
  on public.jobs_previsao_impostos(tenant_id, data_prevista);

drop trigger if exists trg_jobs_previsao_impostos_updated_at
  on public.jobs_previsao_impostos;
create trigger trg_jobs_previsao_impostos_updated_at
  before update on public.jobs_previsao_impostos
  for each row execute function public.set_updated_at();

alter table public.jobs_previsao_impostos enable row level security;

drop policy if exists jobs_previsao_impostos_select
  on public.jobs_previsao_impostos;
create policy jobs_previsao_impostos_select on public.jobs_previsao_impostos
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists jobs_previsao_impostos_insert
  on public.jobs_previsao_impostos;
create policy jobs_previsao_impostos_insert on public.jobs_previsao_impostos
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists jobs_previsao_impostos_update
  on public.jobs_previsao_impostos;
create policy jobs_previsao_impostos_update on public.jobs_previsao_impostos
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- DELETE pela mesma razão das outras duas: a previsão é regravada inteira
-- a cada edição (apaga e reinsere).
drop policy if exists jobs_previsao_impostos_delete
  on public.jobs_previsao_impostos;
create policy jobs_previsao_impostos_delete on public.jobs_previsao_impostos
  for delete to authenticated
  using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete
  on public.jobs_previsao_impostos to authenticated;

comment on table public.jobs_previsao_impostos is
  'Previsão de recolhimento dos impostos do job (decisão 100): em que datas o imposto embutido no faturamento previsto sai do caixa. Fecha com esse imposto na abertura. Ainda não entra no fluxo de caixa nem é abatida — isso chega com o módulo fiscal.';
comment on column public.jobs_previsao_impostos.valor is
  'Linha do cronograma. A soma do job fecha com o imposto do faturamento previsto (imposto brasileiro + int. taxes) no instante da abertura.';

-- ---------------------------------------------------------------------
-- 3. A foto do registro guarda os impostos
-- ---------------------------------------------------------------------

-- `conta_impostos_id` sem FK, como as outras duas contas da foto: a foto
-- guarda qual conta era, e excluir a conta não pode depender dela.
alter table public.jobs_aberturas
  add column if not exists conta_impostos_id uuid,
  add column if not exists impostos jsonb,
  add column if not exists imposto_previsto numeric(14, 2);

comment on column public.jobs_aberturas.impostos is
  'Cronograma de recolhimento de impostos como estava nesta foto: [{data_prevista, valor}]. Nulo nas fotos anteriores a 23/09/2026 (decisão 100).';
comment on column public.jobs_aberturas.imposto_previsto is
  'Total de impostos previsto nesta foto. Nulo nas fotos anteriores a 23/09/2026 (decisão 100).';
