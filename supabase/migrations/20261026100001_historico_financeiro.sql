-- =============================================================================
-- O histórico da planilha financeira: as tabelas e a carga (decisão 211, A1)
-- =============================================================================
-- A planilha "Fin. Conta Califórnia" guarda o histórico financeiro desde 2014.
-- A decisão 211 o traz para o sistema em tabelas próprias, só de leitura,
-- separadas do que o time lança: job antigo não tem orçamento nem versão
-- aprovada, nota antiga não tem PDF nem CNAE, e lançamentos e contas são de
-- outra frente. O pipeline fora do sistema (`scripts/historico-financeiro`)
-- extrai, padroniza, valida e empacota; esta migration recebe o pacote.
--
-- • `historico_cargas`: um registro por pacote carregado — o período, a versão
--   da planilha (dia e SHA-256), o pacote (nome e SHA-256), o que ele declara
--   (linhas e somas) e o que entrou, quem carregou e a situação:
--   carregando → ativa → substituída ou desfeita; carregando → descartada.
-- • `historico_movimentos`: o extrato de cada conta até o corte, uma linha por
--   linha da planilha, com sinal (o que entra é positivo).
-- • `historico_notas`: as notas emitidas e canceladas.
-- • `historico_jobs`: os jobs das abas de resultado. Cada carga traz todos; os
--   relatórios usam os da carga ativa mais recente.
-- • `historico_rateio_regional`: os percentuais do rateio do TD por ano e
--   empresa, com trimestre e grupo quando a planilha usa uma linha só num
--   trimestre e em certos grupos (a linha 147 da Gerencial 24). O que a
--   planilha divide em partes iguais se decide na A4.
-- • `historico_saldos`: o saldo da planilha no fim de cada mês com movimento,
--   por conta, e o de abertura (o mês antes do período).
--
-- Cada linha aponta para o que existe no sistema (conta, empresa, regional,
-- plano de contas, cliente, marca, serviço e o job, quando há), achado pelo
-- nome ou pelo código que o pacote traz, e guarda o texto da planilha e a aba
-- e a linha de origem. O que não tem par fica só como texto: o histórico não
-- cria cadastro. A conta é a única ligação obrigatória: ela tem de existir.
-- As ligações com cadastros de outros módulos usam `on delete set null`, para
-- o histórico não travar a exclusão de ninguém; o texto continua lá.
--
-- A carga entra por partes, pela tela Financeiro › Cadastros › Histórico da
-- planilha, com a sessão de quem carrega: `historico_iniciar_carga`,
-- `historico_gravar_parte` (até 2.000 linhas, sem repetir a mesma linha da
-- planilha) e `historico_concluir_carga`, que confere as linhas e as somas
-- com o que o pacote declara e, se já houver carga ativa no mesmo período, a
-- substitui. `historico_desfazer_carga` desfaz a carga ativa ou descarta a
-- incompleta. Concluir, desfazer e descartar auditam.
--
-- O corte da decisão 211 (D3) mora nas funções: o histórico vai até
-- 30/09/2026; a partir de 01/10/2026 vale o sistema.
--
-- Acesso: admin e financeiro leem (RLS); a escrita é só pelas funções
-- SECURITY DEFINER, com a trava de papel. GRANT de select para
-- `authenticated`, nada para `anon`.
--
-- Mudança ADITIVA: só tabelas e funções novas. Nenhuma tabela existente muda.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A trava de papel
-- -----------------------------------------------------------------------------
create or replace function public._exige_financeiro_historico(p_tenant_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sessão inválida.';
  end if;
  if not (public.is_tenant_admin(p_tenant_id) or public.is_tenant_financeiro(p_tenant_id)) then
    raise exception 'Só admin ou financeiro carrega o histórico da planilha.'
      using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

revoke all on function public._exige_financeiro_historico(uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2. As cargas
-- -----------------------------------------------------------------------------
create table public.historico_cargas (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  nome              text not null check (length(btrim(nome)) between 1 and 80),
  periodo_de        date not null,
  periodo_ate       date not null,
  -- A versão da planilha: o dia em que foi baixada, o arquivo e o SHA-256 dele.
  planilha_versao   date not null,
  planilha_arquivo  text not null check (length(btrim(planilha_arquivo)) between 1 and 255),
  planilha_sha256   text not null check (planilha_sha256 ~ '^[0-9a-f]{64}$'),
  -- O pacote que a tela enviou.
  pacote_arquivo    text not null check (length(btrim(pacote_arquivo)) between 1 and 255),
  pacote_sha256     text not null check (pacote_sha256 ~ '^[0-9a-f]{64}$'),
  -- O que o pacote declara ({"movimentos": {"linhas": 510, "soma": "1162997.78"}, …})
  -- e o que estava no banco ao concluir ou ao descartar.
  esperado          jsonb not null check (jsonb_typeof(esperado) = 'object'),
  gravado           jsonb not null default '{}'::jsonb,
  situacao          text not null default 'carregando'
                    check (situacao in ('carregando', 'ativa', 'substituida', 'desfeita', 'descartada')),
  criada_por        uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  concluida_em      timestamptz,
  concluida_por     uuid references public.profiles(id),
  -- Desfeita, substituída ou descartada.
  encerrada_em      timestamptz,
  encerrada_por     uuid references public.profiles(id),
  substituida_por   uuid references public.historico_cargas(id),
  constraint chk_historico_cargas_periodo check (periodo_de <= periodo_ate),
  constraint chk_historico_cargas_concluida check ((concluida_em is null) = (concluida_por is null)),
  constraint chk_historico_cargas_encerrada check ((encerrada_em is null) = (encerrada_por is null))
);

comment on table public.historico_cargas is
  'Um registro por pacote do histórico da planilha financeira carregado (decisão 211, A1): período, versão da planilha, o que o pacote declara e o que entrou, quem carregou e a situação. Recarregar o mesmo período substitui a carga ativa dele.';

-- Uma carga em andamento por vez, e uma ativa por período.
create unique index uq_historico_cargas_carregando on public.historico_cargas (tenant_id) where situacao = 'carregando';
create unique index uq_historico_cargas_ativa_periodo on public.historico_cargas (tenant_id, periodo_de, periodo_ate) where situacao = 'ativa';
create index idx_historico_cargas_tenant on public.historico_cargas (tenant_id, situacao, periodo_de);
create index idx_historico_cargas_criada_por on public.historico_cargas (criada_por);
create index idx_historico_cargas_concluida_por on public.historico_cargas (concluida_por) where concluida_por is not null;
create index idx_historico_cargas_encerrada_por on public.historico_cargas (encerrada_por) where encerrada_por is not null;
create index idx_historico_cargas_substituida_por on public.historico_cargas (substituida_por) where substituida_por is not null;


-- -----------------------------------------------------------------------------
-- 3. Os movimentos das contas
-- -----------------------------------------------------------------------------
create table public.historico_movimentos (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete restrict,
  carga_id                uuid not null references public.historico_cargas(id) on delete restrict,
  conta_bancaria_id       uuid not null references public.contas_bancarias(id) on delete restrict,
  data                    date not null,
  -- Com sinal, como no extrato: o que entra é positivo, o que sai é negativo.
  valor                   numeric(14, 2) not null,
  -- O crédito e o débito como a planilha mostra, com o sinal dela: a DRE da
  -- planilha soma o crédito com sinal (o negativo abate uma previsão).
  credito_planilha        numeric(14, 2),
  debito_planilha         numeric(14, 2),
  classe                  text not null check (classe in ('dre', 'transferencia', 'estorno', 'sem classificação')),
  empresa_id              uuid references public.empresas(id) on delete set null,
  -- O nome da empresa no histórico (FitDance, Community e Infloo não têm cadastro).
  empresa_nome            text,
  sigla_planilha          text,
  -- O grupo da DRE da planilha (REC, CO, CF…) e a subconta (Cod).
  grupo                   text,
  cod                     text,
  competencia_trimestre   smallint check (competencia_trimestre between 1 and 4),
  competencia_ano         smallint check (competencia_ano between 2010 and 2030),
  plano_conta_tipo_id     uuid references public.plano_contas_tipos(id) on delete set null,
  plano_conta_subtipo_id  uuid references public.plano_contas_subtipos(id) on delete set null,
  -- O código do de-para ("02.999"), que fica mesmo sem par no plano.
  plano_codigo            text,
  regional_id             uuid references public.regionais(id) on delete set null,
  regional_nome           text,
  -- TD: o lançamento é de todas as regionais e só se rateia no relatório por regional.
  regional_todas          boolean not null default false,
  regional_planilha       text,
  -- O job do histórico (`historico_jobs.chave`), o nome e a coluna onde estava.
  job_chave               text,
  job_nome                text,
  job_coluna              text check (job_coluna in ('job', 'evento')),
  tipo_planilha           text,
  descricao               text,
  fornecedor              text,
  parcela                 text,
  documento               text,
  observacao              text,
  -- Na transferência, a conta que o Tipo nomeia.
  contrapartida           text,
  coluna_jobs             text,
  coluna_evento           text,
  coluna_reg              text,
  coluna_reg_cmh          text,
  dre_extra               text,
  ano_comp                text,
  aba                     text not null,
  linha                   integer not null check (linha > 0),
  -- A impressão digital da E2: a mesma linha da planilha numa versão nova.
  digital                 text not null check (length(digital) between 8 and 64),
  created_at              timestamptz not null default now(),
  constraint uq_historico_movimentos_origem unique (carga_id, aba, linha),
  constraint uq_historico_movimentos_digital unique (carga_id, digital)
);

comment on table public.historico_movimentos is
  'O extrato de cada conta na planilha financeira até 30/09/2026 (decisão 211), uma linha por linha da planilha, com o texto dela e a ligação com conta, empresa, regional e plano de contas. Só de leitura: entra e sai pela carga.';

create index idx_historico_movimentos_conta_data on public.historico_movimentos (conta_bancaria_id, data);
create index idx_historico_movimentos_competencia on public.historico_movimentos (tenant_id, competencia_ano, competencia_trimestre);
create index idx_historico_movimentos_empresa on public.historico_movimentos (empresa_id) where empresa_id is not null;
create index idx_historico_movimentos_tipo on public.historico_movimentos (plano_conta_tipo_id) where plano_conta_tipo_id is not null;
create index idx_historico_movimentos_subtipo on public.historico_movimentos (plano_conta_subtipo_id) where plano_conta_subtipo_id is not null;
create index idx_historico_movimentos_regional on public.historico_movimentos (regional_id) where regional_id is not null;


-- -----------------------------------------------------------------------------
-- 4. As notas
-- -----------------------------------------------------------------------------
create table public.historico_notas (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete restrict,
  carga_id                uuid not null references public.historico_cargas(id) on delete restrict,
  empresa_id              uuid references public.empresas(id) on delete set null,
  empresa_nome            text not null,
  -- Como a empresa foi lida: pelo job, pelo estabelecimento ou pela Obs.
  empresa_por             text,
  -- O CNPJ emissor e a cidade, como a aba de faturamento ("California · Salvador").
  estabelecimento         text not null,
  numero                  text not null,
  situacao                text not null check (situacao in ('emitida', 'cancelada')),
  classe                  text not null check (classe in ('job', 'distribuição de lucro', 'sem job')),
  emissao                 date,
  competencia_trimestre   smallint check (competencia_trimestre between 1 and 4),
  competencia_ano         smallint check (competencia_ano between 2010 and 2030),
  vencimento              date,
  recebimento             date,
  valor                   numeric(14, 2),
  deducao                 numeric(14, 2),
  valor_tributavel        numeric(14, 2),
  iss                     numeric(14, 2),
  pis                     numeric(14, 2),
  cofins                  numeric(14, 2),
  csll                    numeric(14, 2),
  ir                      numeric(14, 2),
  adicional_ir            numeric(14, 2),
  retencoes               numeric(14, 2),
  total_impostos          numeric(14, 2),
  job_chave               text,
  job_nome                text,
  coluna_job              text,
  cliente                 text,
  municipio               text,
  cnae                    text,
  obs                     text,
  observacao              text,
  aba                     text not null,
  linha                   integer not null check (linha > 0),
  created_at              timestamptz not null default now(),
  constraint uq_historico_notas_origem unique (carga_id, aba, linha)
);

comment on table public.historico_notas is
  'As notas fiscais da planilha financeira até 30/09/2026 (decisão 211): emitidas e canceladas, com impostos, recebimento, o job do histórico e a classe (job, distribuição de lucro ou sem job).';

create index idx_historico_notas_emissao on public.historico_notas (tenant_id, emissao);
create index idx_historico_notas_empresa on public.historico_notas (empresa_id) where empresa_id is not null;
create index idx_historico_notas_job on public.historico_notas (carga_id, job_chave) where job_chave is not null;


-- -----------------------------------------------------------------------------
-- 5. Os jobs das abas de resultado
-- -----------------------------------------------------------------------------
create table public.historico_jobs (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete restrict,
  carga_id                uuid not null references public.historico_cargas(id) on delete restrict,
  -- A chave que os movimentos e as notas usam ("evento:NOME DO JOB 1T 2026").
  chave                   text not null check (length(btrim(chave)) between 3 and 160),
  nome                    text not null,
  empresa_id              uuid references public.empresas(id) on delete set null,
  empresa_nome            text not null,
  aba                     text not null,
  linha                   integer not null check (linha > 0),
  ano                     smallint not null check (ano between 2010 and 2030),
  trimestre               text check (trimestre in ('1T', '2T', '3T', '4T')),
  projeto                 text,
  cliente_id              uuid references public.clientes(id) on delete set null,
  cliente_planilha        text,
  marca_id                uuid references public.cliente_produtos(id) on delete set null,
  marca_planilha          text,
  servico_id              uuid references public.categorias_dominio(id) on delete set null,
  servico_planilha        text,
  gp                      text,
  data_inicio             date,
  regional_id             uuid references public.regionais(id) on delete set null,
  regional_nome           text,
  regional_todas          boolean not null default false,
  regional_planilha       text,
  -- Como a regional foi lida: pela planilha, pelos lançamentos ou TD (todas).
  regional_por            text,
  -- "Copa": o marcador dos projetos da Copa, que não é regional.
  marcador                text,
  status_planilha         text,
  codigo_antigo           text,
  -- O job do sistema, quando existe, pelo código.
  job_id                  uuid references public.jobs(id) on delete set null,
  job_codigo              text,
  -- O motivo de o job ficar fora dos relatórios de resultado ("Copa sem lançamento").
  fora_do_resultado       text,
  outras_abas             text,
  created_at              timestamptz not null default now(),
  constraint uq_historico_jobs_chave unique (carga_id, chave)
);

comment on table public.historico_jobs is
  'Os jobs das abas de resultado da planilha financeira (decisão 211), com projeto, cliente, marca, serviço, regional e o job do sistema quando há. Cada carga traz todos; vale o da carga ativa mais recente.';

create index idx_historico_jobs_tenant on public.historico_jobs (tenant_id, ano);
create index idx_historico_jobs_empresa on public.historico_jobs (empresa_id) where empresa_id is not null;
create index idx_historico_jobs_cliente on public.historico_jobs (cliente_id) where cliente_id is not null;
create index idx_historico_jobs_marca on public.historico_jobs (marca_id) where marca_id is not null;
create index idx_historico_jobs_servico on public.historico_jobs (servico_id) where servico_id is not null;
create index idx_historico_jobs_regional on public.historico_jobs (regional_id) where regional_id is not null;
create index idx_historico_jobs_job on public.historico_jobs (job_id) where job_id is not null;


-- -----------------------------------------------------------------------------
-- 6. O rateio do TD
-- -----------------------------------------------------------------------------
create table public.historico_rateio_regional (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete restrict,
  carga_id                uuid not null references public.historico_cargas(id) on delete restrict,
  ano                     smallint not null check (ano between 2010 and 2030),
  -- Nulo: o ano inteiro.
  trimestre               smallint check (trimestre between 1 and 4),
  empresa_id              uuid not null references public.empresas(id) on delete restrict,
  -- Nulo: todos os grupos que a planilha rateia. Com valor, só aquele grupo.
  grupo                   text,
  regional_id             uuid references public.regionais(id) on delete set null,
  -- A regional como a planilha tem (a Urbia, da CMH, não tem cadastro).
  regional_nome           text not null,
  percentual              numeric(7, 4) not null check (percentual between 0 and 100),
  -- A célula de onde o percentual saiu ("Gerencial 24, linha 135").
  origem                  text not null,
  created_at              timestamptz not null default now()
);

comment on table public.historico_rateio_regional is
  'Os percentuais com que a planilha financeira rateia o TD entre as regionais (decisão 211): por ano e empresa, com trimestre e grupo quando a planilha usa a linha só ali. Vale o da carga ativa mais recente; a DRE não rateia, só o relatório por regional.';

create unique index uq_historico_rateio_regional on public.historico_rateio_regional
  (carga_id, ano, coalesce(trimestre, 0), empresa_id, coalesce(grupo, ''), regional_nome);
create index idx_historico_rateio_tenant on public.historico_rateio_regional (tenant_id, ano);
create index idx_historico_rateio_empresa on public.historico_rateio_regional (empresa_id);
create index idx_historico_rateio_regional on public.historico_rateio_regional (regional_id) where regional_id is not null;


-- -----------------------------------------------------------------------------
-- 7. Os saldos da planilha
-- -----------------------------------------------------------------------------
create table public.historico_saldos (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete restrict,
  carga_id                uuid not null references public.historico_cargas(id) on delete restrict,
  conta_bancaria_id       uuid not null references public.contas_bancarias(id) on delete restrict,
  -- O primeiro dia do mês.
  mes                     date not null check (extract(day from mes) = 1),
  -- O saldo da planilha no fim do mês; nulo quando a planilha não o tem.
  saldo_planilha          numeric(14, 2),
  -- O movimento do mês no histórico; nulo no mês de abertura, que fica antes do período.
  movimento               numeric(14, 2),
  abertura                boolean not null default false,
  created_at              timestamptz not null default now(),
  constraint uq_historico_saldos unique (carga_id, conta_bancaria_id, mes),
  constraint chk_historico_saldos_abertura check (not abertura or movimento is null)
);

comment on table public.historico_saldos is
  'O saldo da planilha financeira no fim de cada mês com movimento, por conta, e o de abertura da carga (decisão 211). Serve à Conciliação (saldo contínuo até o saldo inicial do sistema) e à conferência da carga.';

create index idx_historico_saldos_tenant on public.historico_saldos (tenant_id, mes);
create index idx_historico_saldos_conta on public.historico_saldos (conta_bancaria_id, mes);


-- -----------------------------------------------------------------------------
-- 8. RLS e GRANTs: admin e financeiro leem; a escrita é só pelas funções
-- -----------------------------------------------------------------------------
alter table public.historico_cargas enable row level security;
alter table public.historico_movimentos enable row level security;
alter table public.historico_notas enable row level security;
alter table public.historico_jobs enable row level security;
alter table public.historico_rateio_regional enable row level security;
alter table public.historico_saldos enable row level security;

create policy historico_cargas_select on public.historico_cargas
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

create policy historico_movimentos_select on public.historico_movimentos
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

create policy historico_notas_select on public.historico_notas
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

create policy historico_jobs_select on public.historico_jobs
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

create policy historico_rateio_regional_select on public.historico_rateio_regional
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

create policy historico_saldos_select on public.historico_saldos
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

revoke all on public.historico_cargas, public.historico_movimentos, public.historico_notas,
              public.historico_jobs, public.historico_rateio_regional, public.historico_saldos
  from public, anon, authenticated;
grant select on public.historico_cargas, public.historico_movimentos, public.historico_notas,
                public.historico_jobs, public.historico_rateio_regional, public.historico_saldos
  to authenticated;


-- -----------------------------------------------------------------------------
-- 9. Apagar as linhas de cargas (desfazer, descartar, substituir)
-- -----------------------------------------------------------------------------
create or replace function public._historico_apagar_linhas(p_cargas uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.historico_movimentos where carga_id = any(p_cargas);
  delete from public.historico_notas where carga_id = any(p_cargas);
  delete from public.historico_jobs where carga_id = any(p_cargas);
  delete from public.historico_rateio_regional where carga_id = any(p_cargas);
  delete from public.historico_saldos where carga_id = any(p_cargas);
$$;

revoke all on function public._historico_apagar_linhas(uuid[]) from public, anon, authenticated;

-- As linhas de uma carga, por tabela.
create or replace function public._historico_contar_linhas(p_carga_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'rateio', (select count(*) from public.historico_rateio_regional where carga_id = p_carga_id),
    'saldos', (select count(*) from public.historico_saldos where carga_id = p_carga_id),
    'jobs', (select count(*) from public.historico_jobs where carga_id = p_carga_id),
    'notas', (select count(*) from public.historico_notas where carga_id = p_carga_id),
    'movimentos', (select count(*) from public.historico_movimentos where carga_id = p_carga_id));
$$;

revoke all on function public._historico_contar_linhas(uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 10. Começar a carga
-- -----------------------------------------------------------------------------
-- `p_cabecalho`: {carga: {nome, de, ate}, planilha: {versao, arquivo, sha256},
-- pacote: {arquivo, sha256}, esperado: {movimentos: {linhas, soma}, notas:
-- {linhas, soma}, jobs: {linhas}, rateio: {linhas}, saldos: {linhas}}}.
create or replace function public.historico_iniciar_carga(p_tenant_id uuid, p_cabecalho jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public._exige_financeiro_historico(p_tenant_id);
  v_de       date := (p_cabecalho->'carga'->>'de')::date;
  v_ate      date := (p_cabecalho->'carga'->>'ate')::date;
  v_esperado jsonb := p_cabecalho->'esperado';
  v_cruzada  record;
  v_id       uuid;
begin
  if v_de is null or v_ate is null or v_de > v_ate then
    raise exception 'O período da carga é inválido.';
  end if;
  if v_ate > date '2026-09-30' then
    raise exception 'O histórico vai até 30/09/2026: a partir de 01/10/2026 vale o sistema.';
  end if;
  if jsonb_typeof(v_esperado) is distinct from 'object'
     or exists (select 1 from unnest(array['rateio', 'saldos', 'jobs', 'notas', 'movimentos']) t
                 where jsonb_typeof(v_esperado->t->'linhas') is distinct from 'number')
     or v_esperado->'movimentos'->>'soma' is null
     or v_esperado->'notas'->>'soma' is null then
    raise exception 'O pacote não diz quantas linhas traz: gere-o de novo pelo script empacotar.ts.';
  end if;
  if exists (select 1 from public.historico_cargas where tenant_id = p_tenant_id and situacao = 'carregando') then
    raise exception 'Já há uma carga em andamento. Conclua ou descarte essa carga antes de começar outra.';
  end if;
  select nome, periodo_de, periodo_ate into v_cruzada
    from public.historico_cargas
   where tenant_id = p_tenant_id and situacao = 'ativa'
     and periodo_de <= v_ate and periodo_ate >= v_de
     and not (periodo_de = v_de and periodo_ate = v_ate)
   limit 1;
  if found then
    raise exception 'O período cruza o da carga "%" (% a %). Carregue o mesmo período, que a substitui, ou desfaça aquela carga antes.',
      v_cruzada.nome, to_char(v_cruzada.periodo_de, 'DD/MM/YYYY'), to_char(v_cruzada.periodo_ate, 'DD/MM/YYYY');
  end if;

  insert into public.historico_cargas (
    tenant_id, nome, periodo_de, periodo_ate, planilha_versao, planilha_arquivo, planilha_sha256,
    pacote_arquivo, pacote_sha256, esperado, criada_por
  ) values (
    p_tenant_id, btrim(p_cabecalho->'carga'->>'nome'), v_de, v_ate,
    (p_cabecalho->'planilha'->>'versao')::date, p_cabecalho->'planilha'->>'arquivo', p_cabecalho->'planilha'->>'sha256',
    p_cabecalho->'pacote'->>'arquivo', p_cabecalho->'pacote'->>'sha256', v_esperado, v_uid
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.historico_iniciar_carga(uuid, jsonb) from public, anon;
grant execute on function public.historico_iniciar_carga(uuid, jsonb) to authenticated;


-- -----------------------------------------------------------------------------
-- 11. Gravar uma parte
-- -----------------------------------------------------------------------------
-- `p_linhas`: um array de objetos com as colunas de `COLUNAS_DO_PACOTE`
-- (lib/historico-financeiro/pacote.ts). A linha que já entrou (mesma aba e
-- linha da planilha) fica de fora: reenviar uma parte não repete nada.
-- Devolve quantas linhas entraram.
create or replace function public.historico_gravar_parte(p_carga_id uuid, p_tabela text, p_linhas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carga  public.historico_cargas%rowtype;
  v_uid    uuid;
  v_texto  text;
  v_n      integer;
  v_feitas integer;
begin
  -- FOR SHARE: a conclusão (FOR UPDATE) espera a parte que está entrando.
  select * into v_carga from public.historico_cargas where id = p_carga_id for share;
  if not found then raise exception 'Carga não encontrada.'; end if;
  v_uid := public._exige_financeiro_historico(v_carga.tenant_id);
  if v_carga.situacao <> 'carregando' then
    raise exception 'Esta carga não está em andamento.';
  end if;
  if v_carga.criada_por <> v_uid then
    raise exception 'Só quem começou a carga envia as partes dela.';
  end if;
  if jsonb_typeof(p_linhas) is distinct from 'array' then
    raise exception 'A parte não tem linhas.';
  end if;
  v_n := jsonb_array_length(p_linhas);
  if v_n = 0 or v_n > 2000 then
    raise exception 'Cada parte leva de 1 a 2.000 linhas.';
  end if;

  -- A conta é a única ligação obrigatória: o histórico não cria conta.
  if p_tabela in ('movimentos', 'saldos') then
    select r.conta into v_texto
      from jsonb_to_recordset(p_linhas) as r(conta text)
     where not exists (select 1 from public.contas_bancarias c
                        where c.tenant_id = v_carga.tenant_id and c.nome = r.conta)
     limit 1;
    if found then
      raise exception 'A conta "%" não está cadastrada: cadastre a conta antes de carregar o histórico dela.', v_texto;
    end if;
  end if;

  if p_tabela = 'movimentos' then
    if exists (select 1 from jsonb_to_recordset(p_linhas) as r(data date)
                where r.data is null or r.data < v_carga.periodo_de or r.data > v_carga.periodo_ate) then
      raise exception 'Há movimento fora do período da carga (% a %).',
        to_char(v_carga.periodo_de, 'DD/MM/YYYY'), to_char(v_carga.periodo_ate, 'DD/MM/YYYY');
    end if;
    insert into public.historico_movimentos (
      tenant_id, carga_id, conta_bancaria_id, data, valor, credito_planilha, debito_planilha, classe,
      empresa_id, empresa_nome, sigla_planilha, grupo, cod, competencia_trimestre, competencia_ano,
      plano_conta_tipo_id, plano_conta_subtipo_id, plano_codigo,
      regional_id, regional_nome, regional_todas, regional_planilha,
      job_chave, job_nome, job_coluna, tipo_planilha, descricao, fornecedor, parcela, documento, observacao,
      contrapartida, coluna_jobs, coluna_evento, coluna_reg, coluna_reg_cmh, dre_extra, ano_comp, aba, linha, digital
    )
    select v_carga.tenant_id, v_carga.id, c.id, r.data, round(r.valor, 2),
           round(r.credito_planilha, 2), round(r.debito_planilha, 2), r.classe,
           e.id, r.empresa, r.sigla_planilha, r.grupo, r.cod, r.competencia_trimestre, r.competencia_ano,
           pt.id, ps.id, nullif(concat_ws('.', r.plano_tipo, r.plano_subtipo), ''),
           rg.id, r.regional, coalesce(r.regional_todas, false), r.regional_planilha,
           r.job_chave, r.job_nome, r.job_coluna, r.tipo_planilha, r.descricao, r.fornecedor, r.parcela,
           r.documento, r.observacao, r.contrapartida, r.coluna_jobs, r.coluna_evento, r.coluna_reg,
           r.coluna_reg_cmh, r.dre_extra, r.ano_comp, r.aba, r.linha, r.digital
      from jsonb_to_recordset(p_linhas) as r(
             conta text, data date, valor numeric, credito_planilha numeric, debito_planilha numeric, classe text,
             empresa text, sigla_planilha text, grupo text, cod text, competencia_trimestre smallint,
             competencia_ano smallint, plano_tipo text, plano_subtipo text, regional text, regional_todas boolean,
             regional_planilha text, job_chave text, job_nome text, job_coluna text, tipo_planilha text,
             descricao text, fornecedor text, parcela text, documento text, observacao text, contrapartida text,
             coluna_jobs text, coluna_evento text, coluna_reg text, coluna_reg_cmh text, dre_extra text,
             ano_comp text, aba text, linha integer, digital text)
      cross join lateral (select c.id from public.contas_bancarias c
                           where c.tenant_id = v_carga.tenant_id and c.nome = r.conta
                           order by c.created_at limit 1) c
      left join lateral (select e.id from public.empresas e
                          where e.tenant_id = v_carga.tenant_id and coalesce(e.nome_fantasia, e.razao_social) = r.empresa
                          order by e.created_at limit 1) e on true
      left join lateral (select t.id from public.plano_contas_tipos t
                          where t.tenant_id = v_carga.tenant_id and t.codigo = r.plano_tipo
                          order by t.created_at limit 1) pt on true
      left join lateral (select s.id from public.plano_contas_subtipos s
                          where s.tipo_id = pt.id and s.codigo = r.plano_subtipo
                          order by s.created_at limit 1) ps on true
      left join lateral (select g.id from public.regionais g
                          where g.tenant_id = v_carga.tenant_id and g.empresa_id = e.id and g.nome = r.regional
                          order by g.created_at limit 1) rg on true
    on conflict do nothing;

  elsif p_tabela = 'notas' then
    if exists (select 1 from jsonb_to_recordset(p_linhas) as r(emissao date)
                where r.emissao < v_carga.periodo_de or r.emissao > v_carga.periodo_ate) then
      raise exception 'Há nota emitida fora do período da carga (% a %).',
        to_char(v_carga.periodo_de, 'DD/MM/YYYY'), to_char(v_carga.periodo_ate, 'DD/MM/YYYY');
    end if;
    insert into public.historico_notas (
      tenant_id, carga_id, empresa_id, empresa_nome, empresa_por, estabelecimento, numero, situacao, classe,
      emissao, competencia_trimestre, competencia_ano, vencimento, recebimento,
      valor, deducao, valor_tributavel, iss, pis, cofins, csll, ir, adicional_ir, retencoes, total_impostos,
      job_chave, job_nome, coluna_job, cliente, municipio, cnae, obs, observacao, aba, linha
    )
    select v_carga.tenant_id, v_carga.id, e.id, r.empresa, r.empresa_por, r.estabelecimento, r.numero, r.situacao, r.classe,
           r.emissao, r.competencia_trimestre, r.competencia_ano, r.vencimento, r.recebimento,
           round(r.valor, 2), round(r.deducao, 2), round(r.valor_tributavel, 2), round(r.iss, 2), round(r.pis, 2),
           round(r.cofins, 2), round(r.csll, 2), round(r.ir, 2), round(r.adicional_ir, 2), round(r.retencoes, 2),
           round(r.total_impostos, 2), r.job_chave, r.job_nome, r.coluna_job, r.cliente, r.municipio, r.cnae,
           r.obs, r.observacao, r.aba, r.linha
      from jsonb_to_recordset(p_linhas) as r(
             empresa text, empresa_por text, estabelecimento text, numero text, situacao text, classe text,
             emissao date, competencia_trimestre smallint, competencia_ano smallint, vencimento date, recebimento date,
             valor numeric, deducao numeric, valor_tributavel numeric, iss numeric, pis numeric, cofins numeric,
             csll numeric, ir numeric, adicional_ir numeric, retencoes numeric, total_impostos numeric,
             job_chave text, job_nome text, coluna_job text, cliente text, municipio text, cnae text,
             obs text, observacao text, aba text, linha integer)
      left join lateral (select e.id from public.empresas e
                          where e.tenant_id = v_carga.tenant_id and coalesce(e.nome_fantasia, e.razao_social) = r.empresa
                          order by e.created_at limit 1) e on true
    on conflict do nothing;

  elsif p_tabela = 'jobs' then
    insert into public.historico_jobs (
      tenant_id, carga_id, chave, nome, empresa_id, empresa_nome, aba, linha, ano, trimestre, projeto,
      cliente_id, cliente_planilha, marca_id, marca_planilha, servico_id, servico_planilha, gp, data_inicio,
      regional_id, regional_nome, regional_todas, regional_planilha, regional_por, marcador, status_planilha,
      codigo_antigo, job_id, job_codigo, fora_do_resultado, outras_abas
    )
    select v_carga.tenant_id, v_carga.id, r.chave, r.nome, e.id, r.empresa, r.aba, r.linha, r.ano, r.trimestre, r.projeto,
           cl.id, r.cliente_planilha, mc.id, r.marca_planilha, sv.id, r.servico_planilha, r.gp, r.data_inicio,
           rg.id, r.regional, coalesce(r.regional_todas, false), r.regional_planilha, r.regional_por, r.marcador,
           r.status_planilha, r.codigo_antigo, jb.id, r.job_codigo, r.fora_do_resultado, r.outras_abas
      from jsonb_to_recordset(p_linhas) as r(
             chave text, nome text, empresa text, aba text, linha integer, ano smallint, trimestre text, projeto text,
             cliente_sigla text, cliente_planilha text, marca text, marca_planilha text, servico text,
             servico_planilha text, gp text, data_inicio date, regional text, regional_todas boolean,
             regional_planilha text, regional_por text, marcador text, status_planilha text, codigo_antigo text,
             job_codigo text, fora_do_resultado text, outras_abas text)
      left join lateral (select e.id from public.empresas e
                          where e.tenant_id = v_carga.tenant_id and coalesce(e.nome_fantasia, e.razao_social) = r.empresa
                          order by e.created_at limit 1) e on true
      left join lateral (select c.id from public.clientes c
                          where c.tenant_id = v_carga.tenant_id and c.codigo_curto = r.cliente_sigla
                          order by c.created_at limit 1) cl on true
      left join lateral (select p.id from public.cliente_produtos p
                          where p.cliente_id = cl.id and p.nome = r.marca
                          order by p.created_at limit 1) mc on true
      left join lateral (select s.id from public.categorias_dominio s
                          where s.tenant_id = v_carga.tenant_id and s.escopo::text = 'projeto' and s.nome = r.servico
                          order by s.created_at limit 1) sv on true
      left join lateral (select g.id from public.regionais g
                          where g.tenant_id = v_carga.tenant_id and g.empresa_id = e.id and g.nome = r.regional
                          order by g.created_at limit 1) rg on true
      left join lateral (select j.id from public.jobs j
                          where j.tenant_id = v_carga.tenant_id and j.codigo = r.job_codigo
                          order by j.created_at limit 1) jb on true
    on conflict do nothing;

  elsif p_tabela = 'rateio' then
    select r.empresa into v_texto
      from jsonb_to_recordset(p_linhas) as r(empresa text)
     where not exists (select 1 from public.empresas e
                        where e.tenant_id = v_carga.tenant_id and coalesce(e.nome_fantasia, e.razao_social) = r.empresa)
     limit 1;
    if found then
      raise exception 'A empresa "%" do rateio não está cadastrada.', v_texto;
    end if;
    insert into public.historico_rateio_regional (
      tenant_id, carga_id, ano, trimestre, empresa_id, grupo, regional_id, regional_nome, percentual, origem
    )
    select v_carga.tenant_id, v_carga.id, r.ano, r.trimestre, e.id, r.grupo, rg.id, r.regional, r.percentual, r.origem
      from jsonb_to_recordset(p_linhas) as r(
             ano smallint, trimestre smallint, empresa text, grupo text, regional text, percentual numeric, origem text)
      cross join lateral (select e.id from public.empresas e
                           where e.tenant_id = v_carga.tenant_id and coalesce(e.nome_fantasia, e.razao_social) = r.empresa
                           order by e.created_at limit 1) e
      left join lateral (select g.id from public.regionais g
                          where g.tenant_id = v_carga.tenant_id and g.empresa_id = e.id and g.nome = r.regional
                          order by g.created_at limit 1) rg on true
    on conflict do nothing;

  elsif p_tabela = 'saldos' then
    if exists (select 1 from jsonb_to_recordset(p_linhas) as r(mes date)
                where r.mes is null
                   or r.mes < (date_trunc('month', v_carga.periodo_de) - interval '1 month')::date
                   or r.mes > v_carga.periodo_ate) then
      raise exception 'Há saldo fora do período da carga.';
    end if;
    insert into public.historico_saldos (tenant_id, carga_id, conta_bancaria_id, mes, saldo_planilha, movimento, abertura)
    select v_carga.tenant_id, v_carga.id, c.id, r.mes, round(r.saldo_planilha, 2), round(r.movimento, 2),
           coalesce(r.abertura, false)
      from jsonb_to_recordset(p_linhas) as r(conta text, mes date, saldo_planilha numeric, movimento numeric, abertura boolean)
      cross join lateral (select c.id from public.contas_bancarias c
                           where c.tenant_id = v_carga.tenant_id and c.nome = r.conta
                           order by c.created_at limit 1) c
    on conflict do nothing;

  else
    raise exception 'Tabela desconhecida: %.', p_tabela;
  end if;

  get diagnostics v_feitas = row_count;
  return v_feitas;
end;
$$;

revoke all on function public.historico_gravar_parte(uuid, text, jsonb) from public, anon;
grant execute on function public.historico_gravar_parte(uuid, text, jsonb) to authenticated;


-- -----------------------------------------------------------------------------
-- 12. Concluir a carga
-- -----------------------------------------------------------------------------
-- Confere o que está no banco (não o que as partes disseram) contra o que o
-- pacote declara: as linhas de cada tabela e as somas dos movimentos e das
-- notas. A carga ativa do mesmo período é substituída, e as linhas dela saem.
create or replace function public.historico_concluir_carga(p_carga_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carga     public.historico_cargas%rowtype;
  v_uid       uuid;
  v_linhas    jsonb;
  v_tabela    text;
  v_soma      numeric;
  v_antigas   uuid[];
  v_cruzada   record;
begin
  select * into v_carga from public.historico_cargas where id = p_carga_id for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  v_uid := public._exige_financeiro_historico(v_carga.tenant_id);
  if v_carga.situacao <> 'carregando' then
    raise exception 'Esta carga não está em andamento.';
  end if;

  v_linhas := public._historico_contar_linhas(v_carga.id);
  foreach v_tabela in array array['rateio', 'saldos', 'jobs', 'notas', 'movimentos'] loop
    if (v_linhas->>v_tabela)::integer is distinct from (v_carga.esperado->v_tabela->>'linhas')::integer then
      raise exception 'A carga não está completa: % de % linhas de %.',
        v_linhas->>v_tabela, coalesce(v_carga.esperado->v_tabela->>'linhas', '?'), v_tabela;
    end if;
  end loop;
  select coalesce(sum(valor), 0) into v_soma from public.historico_movimentos where carga_id = v_carga.id;
  if v_soma is distinct from (v_carga.esperado->'movimentos'->>'soma')::numeric then
    raise exception 'A soma dos movimentos no banco (%) não bate com a do pacote (%).',
      v_soma, v_carga.esperado->'movimentos'->>'soma';
  end if;
  select coalesce(sum(valor), 0) into v_soma from public.historico_notas where carga_id = v_carga.id;
  if v_soma is distinct from (v_carga.esperado->'notas'->>'soma')::numeric then
    raise exception 'A soma das notas no banco (%) não bate com a do pacote (%).',
      v_soma, v_carga.esperado->'notas'->>'soma';
  end if;

  -- Outra carga ativa pode ter sido concluída com período cruzado depois que esta começou.
  select nome, periodo_de, periodo_ate into v_cruzada
    from public.historico_cargas
   where tenant_id = v_carga.tenant_id and situacao = 'ativa'
     and periodo_de <= v_carga.periodo_ate and periodo_ate >= v_carga.periodo_de
     and not (periodo_de = v_carga.periodo_de and periodo_ate = v_carga.periodo_ate)
   limit 1;
  if found then
    raise exception 'O período cruza o da carga "%" (% a %). Desfaça aquela carga antes de concluir esta.',
      v_cruzada.nome, to_char(v_cruzada.periodo_de, 'DD/MM/YYYY'), to_char(v_cruzada.periodo_ate, 'DD/MM/YYYY');
  end if;

  select coalesce(array_agg(id), '{}') into v_antigas
    from public.historico_cargas
   where tenant_id = v_carga.tenant_id and situacao = 'ativa'
     and periodo_de = v_carga.periodo_de and periodo_ate = v_carga.periodo_ate;
  if cardinality(v_antigas) > 0 then
    perform public._historico_apagar_linhas(v_antigas);
    update public.historico_cargas
       set situacao = 'substituida', encerrada_em = now(), encerrada_por = v_uid, substituida_por = v_carga.id
     where id = any(v_antigas);
  end if;

  update public.historico_cargas
     set situacao = 'ativa', gravado = v_linhas, concluida_em = now(), concluida_por = v_uid
   where id = v_carga.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_carga.tenant_id, 'historico_carga', v_carga.id::text, 'historico.carga_concluida', v_uid,
          jsonb_build_object('nome', v_carga.nome, 'periodo_de', v_carga.periodo_de, 'periodo_ate', v_carga.periodo_ate,
                             'planilha_versao', v_carga.planilha_versao, 'pacote', v_carga.pacote_arquivo,
                             'linhas', v_linhas, 'substituidas', to_jsonb(v_antigas)));

  return jsonb_build_object('linhas', v_linhas, 'substituidas', cardinality(v_antigas));
end;
$$;

revoke all on function public.historico_concluir_carga(uuid) from public, anon;
grant execute on function public.historico_concluir_carga(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 13. Desfazer a carga ativa, ou descartar a incompleta
-- -----------------------------------------------------------------------------
create or replace function public.historico_desfazer_carga(p_carga_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carga     public.historico_cargas%rowtype;
  v_uid       uuid;
  v_linhas    jsonb;
  v_situacao  text;
begin
  select * into v_carga from public.historico_cargas where id = p_carga_id for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  v_uid := public._exige_financeiro_historico(v_carga.tenant_id);
  if v_carga.situacao not in ('ativa', 'carregando') then
    raise exception 'Esta carga já foi encerrada.';
  end if;
  v_situacao := case when v_carga.situacao = 'ativa' then 'desfeita' else 'descartada' end;
  v_linhas := public._historico_contar_linhas(v_carga.id);

  perform public._historico_apagar_linhas(array[v_carga.id]);
  update public.historico_cargas
     set situacao = v_situacao, encerrada_em = now(), encerrada_por = v_uid,
         gravado = case when v_carga.situacao = 'carregando' then v_linhas else gravado end
   where id = v_carga.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_carga.tenant_id, 'historico_carga', v_carga.id::text,
          case when v_situacao = 'desfeita' then 'historico.carga_desfeita' else 'historico.carga_descartada' end, v_uid,
          jsonb_build_object('nome', v_carga.nome, 'periodo_de', v_carga.periodo_de, 'periodo_ate', v_carga.periodo_ate,
                             'linhas_apagadas', v_linhas));

  return jsonb_build_object('situacao', v_situacao, 'linhas_apagadas', v_linhas);
end;
$$;

revoke all on function public.historico_desfazer_carga(uuid) from public, anon;
grant execute on function public.historico_desfazer_carga(uuid) to authenticated;
