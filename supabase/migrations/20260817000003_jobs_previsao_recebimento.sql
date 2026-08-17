-- =====================================================================
-- Previsão de recebimento do job (abertura no financeiro)
--
-- A abertura do job já grava a CURVA DE DESEMBOLSO (`jobs_previsao_custo`):
-- em que datas o custo previsto sai do caixa. Faltava o outro lado da
-- mesma tela — em que datas o dinheiro ENTRA. Esta migration cria
-- `jobs_previsao_recebimento`, espelho exato da tabela de custo, para
-- que o fluxo de caixa tenha entrada e saída nascidas no mesmo momento e
-- com a mesma estrutura.
--
-- Por que agora: o quadro 02a do protótipo "Abertura de Job — Financeiro"
-- coloca "Previsão de recebimento" e "Previsão de custos" como dois cards
-- do mesmo formulário, e a tela de Fluxo de Caixa (plano, Tela 3.4) lista
-- como fonte "previsões da abertura de job (curva de desembolso e
-- previsão de recebimento)". Sem esta tabela, metade dessa fonte não
-- existe.
--
-- Decisões do Tiago (17/08/2026) que esta tabela materializa:
--
--   * A soma das parcelas fecha contra `jobs.faturamento_previsto` — a
--     previsão do que a California recebe do cliente. NÃO contra
--     `valor_total`, que inclui o que o cliente paga direto ao fornecedor
--     (tipos A/D) e nunca passa pelo caixa da California.
--   * "Faturamento previsto" é PREVISÃO. O número definitivo nasce
--     depois, quando a produção envia o job para faturamento
--     (`jobs_envio_faturamento.valor_faturado`) e a NF é emitida.
--   * De maneira análoga ao contas a pagar: quando o faturamento é
--     realizado ele vira TÍTULO A RECEBER e abate esta previsão. O
--     abatimento é leitura (fluxo de caixa / contas a receber), não
--     escrita — nada aqui é apagado quando a NF sai. Esta tabela guarda a
--     previsão original; quem consome é a Tela 3.3 / 3.4.
--
-- Fora desta migration de propósito: qualquer coluna de baixa,
-- conciliação ou vínculo com título. Previsão não é título — o título
-- nasce do faturamento, com tabela própria (`titulos_receber`).
-- =====================================================================

create table if not exists public.jobs_previsao_recebimento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete cascade,
  -- Posição da parcela (01, 02, 03...). A ação regrava a previsão
  -- inteira a cada edição, então a ordem nunca fica com buraco.
  ordem smallint not null,
  data_prevista date not null,
  valor numeric(14, 2) not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- >= 0 e não > 0, mesma razão da curva de custo: quem recusa parcela
  -- zerada é a Server Action, com mensagem legível. No banco, zero é dado
  -- esquisito, não dado corrompido.
  constraint chk_previsao_receb_valor_nao_negativo check (valor >= 0),
  constraint uniq_previsao_receb_job_ordem unique (job_id, ordem)
);

create index if not exists idx_previsao_receb_job
  on public.jobs_previsao_recebimento(job_id);
create index if not exists idx_previsao_receb_tenant
  on public.jobs_previsao_recebimento(tenant_id);
-- Fluxo de caixa lê por janela de data dentro do tenant.
create index if not exists idx_previsao_receb_data
  on public.jobs_previsao_recebimento(tenant_id, data_prevista);

drop trigger if exists trg_jobs_previsao_recebimento_updated_at
  on public.jobs_previsao_recebimento;
create trigger trg_jobs_previsao_recebimento_updated_at
  before update on public.jobs_previsao_recebimento
  for each row execute function public.set_updated_at();

alter table public.jobs_previsao_recebimento enable row level security;

drop policy if exists jobs_previsao_recebimento_select
  on public.jobs_previsao_recebimento;
create policy jobs_previsao_recebimento_select on public.jobs_previsao_recebimento
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists jobs_previsao_recebimento_insert
  on public.jobs_previsao_recebimento;
create policy jobs_previsao_recebimento_insert on public.jobs_previsao_recebimento
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists jobs_previsao_recebimento_update
  on public.jobs_previsao_recebimento;
create policy jobs_previsao_recebimento_update on public.jobs_previsao_recebimento
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- DELETE existe pela mesma razão da curva de custo: a previsão é
-- regravada inteira a cada edição (apaga e reinsere).
drop policy if exists jobs_previsao_recebimento_delete
  on public.jobs_previsao_recebimento;
create policy jobs_previsao_recebimento_delete on public.jobs_previsao_recebimento
  for delete to authenticated
  using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete
  on public.jobs_previsao_recebimento to authenticated;

comment on table public.jobs_previsao_recebimento is
  'Previsão de recebimento do job: em que datas o faturamento previsto entra no caixa. Fecha com jobs.faturamento_previsto na abertura. Alimenta o fluxo de caixa de entrada; é abatida (em leitura) pelos títulos a receber gerados no faturamento.';
comment on column public.jobs_previsao_recebimento.valor is
  'Parcela da previsão. A soma das parcelas do job fecha com jobs.faturamento_previsto no instante da abertura.';
