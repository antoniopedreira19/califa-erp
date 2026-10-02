-- =============================================================================
-- Módulo fiscal · entrega 1 (02/10/2026): o cadastro de impostos e os dados
-- que alimentam a apuração, registrados a partir de hoje.
--
-- Racional
-- • O desenho do módulo fiscal foi aprovado pelo Tiago em 02/10/2026 (protótipo
--   de 5 rodadas). Esta migration cria a BASE: o cadastro de impostos (regime
--   de cada PJ, CNPJs emissores, CNAEs com subitem da LC 116 e alíquotas com
--   vigência, feriados e parâmetros) e os dados novos que o Faturar, a
--   aprovação da PP e o cadastro do fornecedor passam a registrar. A Apuração
--   e os Impostos a Pagar vêm em entregas seguintes e leem daqui.
-- • Tudo é ADITIVO: tabelas novas e colunas novas, anuláveis, sem backfill. O
--   que já existe continua igual (faturamentos.cnae em texto, por exemplo).
-- • Carga inicial = a planilha "IMPOSTOS Ecossistema California" (abas
--   MATRIZ, SP, FOR, GO MATRIZ e HITLAB). As filiais de São Paulo e Fortaleza
--   entram INATIVAS e SEM CNPJ: o CNPJ delas não está no banco nem na
--   planilha, e não se inventa — o financeiro informa no cadastro e ativa.
-- • Leitura: todo usuário do tenant (o GP escolhe o CNAE sugerido no envio
--   para faturamento). Escrita do cadastro: admin e financeiro. A NF da PP e
--   as retenções previstas só se gravam pela função `registrar_nf_da_pp`.
-- =============================================================================

-- 1. Regime tributário de cada PJ (empresa contábil) ------------------------
create table if not exists public.fiscal_regimes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete restrict,
  empresa_contabil_id uuid not null references public.empresas_contabeis(id) on delete restrict,
  regime              text not null,
  regime_caixa        boolean not null default false,
  vigencia_inicio     date not null,
  vigencia_fim        date,
  observacao          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chk_fiscal_regime check (regime in ('lucro_real', 'lucro_presumido')),
  constraint chk_fiscal_regime_vigencia check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  constraint uq_fiscal_regime unique (empresa_contabil_id, vigencia_inicio)
);
comment on table public.fiscal_regimes is
  'Regime de cada PJ, com vigência (módulo fiscal, 02/10/2026). Lucro presumido pelo caixa = PIS/COFINS/IRPJ/CSLL pelo recebimento.';

-- 2. CNPJs emissores (estabelecimentos: matriz e filiais) ---------------------
create table if not exists public.fiscal_estabelecimentos (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete restrict,
  empresa_contabil_id uuid not null references public.empresas_contabeis(id) on delete restrict,
  nome                text not null,
  cnpj                text,
  papel               text not null,
  municipio           text not null,
  uf                  char(2) not null,
  iss_dia             smallint not null,
  iss_retido_dia      smallint not null,
  iss_regra           text not null default 'prorroga',
  ativo               boolean not null default true,
  ordem               smallint not null default 0,
  observacao          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chk_fiscal_estab_papel check (papel in ('matriz', 'filial')),
  constraint chk_fiscal_estab_cnpj check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  constraint chk_fiscal_estab_ativo_tem_cnpj check (not ativo or cnpj is not null),
  constraint chk_fiscal_estab_dias check (iss_dia between 1 and 31 and iss_retido_dia between 1 and 31),
  constraint chk_fiscal_estab_regra check (iss_regra in ('antecipa', 'prorroga', 'ultimo_util')),
  constraint uq_fiscal_estab_nome unique (tenant_id, nome)
);
create unique index if not exists uq_fiscal_estab_cnpj on public.fiscal_estabelecimentos (tenant_id, cnpj) where cnpj is not null;
comment on table public.fiscal_estabelecimentos is
  'CNPJs que emitem nota (matriz e filiais), com o vencimento do ISS do município (módulo fiscal, 02/10/2026). Os federais da PJ se apuram pela matriz.';

-- 3. CNAEs de cada CNPJ, com subitem da LC 116 e alíquotas com vigência --------
create table if not exists public.fiscal_cnaes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  estabelecimento_id uuid not null references public.fiscal_estabelecimentos(id) on delete restrict,
  codigo             text not null,
  subitem            text,
  descricao          text not null,
  aliquota_iss       numeric(7,4),
  aliquota_pis       numeric(7,4) not null,
  aliquota_cofins    numeric(7,4) not null,
  cumulativo         boolean not null default false,
  vigencia_inicio    date not null,
  vigencia_fim       date,
  ativo              boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint chk_fiscal_cnae_codigo check (codigo ~ '^[0-9]{2}\.[0-9]{2}-[0-9]-[0-9]{2}$'),
  constraint chk_fiscal_cnae_aliquotas check (
    (aliquota_iss is null or (aliquota_iss >= 0 and aliquota_iss < 100))
    and aliquota_pis >= 0 and aliquota_pis < 100
    and aliquota_cofins >= 0 and aliquota_cofins < 100
  ),
  constraint chk_fiscal_cnae_vigencia check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);
create unique index if not exists uq_fiscal_cnae_vigencia
  on public.fiscal_cnaes (estabelecimento_id, codigo, coalesce(subitem, ''), vigencia_inicio);
create index if not exists idx_fiscal_cnaes_estab on public.fiscal_cnaes (estabelecimento_id);
comment on table public.fiscal_cnaes is
  'CNAEs de cada CNPJ emissor com as alíquotas (módulo fiscal, 02/10/2026). subitem = item da LC 116 quando o CNAE se divide (82.30-0-01 · 12.08 / 17.10). cumulativo = PIS/COFINS reduzidos e sem crédito. Alíquota que muda ganha linha nova com vigência; a antiga fecha.';

-- 4. Feriados (dia útil para os vencimentos) ----------------------------------
create table if not exists public.fiscal_feriados (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete restrict,
  data       date not null,
  nome       text not null,
  municipio  text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_fiscal_feriado on public.fiscal_feriados (tenant_id, data, coalesce(municipio, ''));
comment on table public.fiscal_feriados is
  'Feriados que mudam vencimento de imposto: municipio nulo = nacional (Res. CMN 4.880/2020); com municipio = local (módulo fiscal, 02/10/2026).';

-- 5. Parâmetros (alíquotas e limites gerais, com vigência) --------------------
create table if not exists public.fiscal_parametros (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  chave           text not null,
  valor           numeric(14,4) not null,
  descricao       text not null,
  vigencia_inicio date not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_fiscal_parametro unique (tenant_id, chave, vigencia_inicio)
);
comment on table public.fiscal_parametros is
  'Alíquotas e limites gerais do módulo fiscal (CSRF, IRRF, crédito de PIS/COFINS, IRPJ/CSLL, presunção, LC 224), com vigência (02/10/2026).';

-- 6. O que a nota passa a registrar: o CNPJ que emitiu e o CNAE da lista ------
alter table public.faturamentos
  add column if not exists estabelecimento_id uuid references public.fiscal_estabelecimentos(id) on delete restrict,
  add column if not exists fiscal_cnae_id     uuid references public.fiscal_cnaes(id) on delete restrict;
create index if not exists idx_faturamentos_estabelecimento on public.faturamentos (estabelecimento_id);
create index if not exists idx_faturamentos_fiscal_cnae on public.faturamentos (fiscal_cnae_id);
comment on column public.faturamentos.estabelecimento_id is 'CNPJ emissor da nota (módulo fiscal, 02/10/2026). Nulo nas notas anteriores.';
comment on column public.faturamentos.fiscal_cnae_id is 'CNAE da nota, escolhido na lista do CNPJ emissor (módulo fiscal). `cnae` continua com o texto.';

-- 7. A NF do fornecedor na PP, registrada pelo financeiro na aprovação --------
alter table public.pedidos_compra
  add column if not exists nf_numero                     text,
  add column if not exists nf_data_emissao               date,
  add column if not exists nf_valor                      numeric(14,2),
  add column if not exists nf_tomador_estabelecimento_id uuid references public.fiscal_estabelecimentos(id) on delete restrict,
  add column if not exists nf_registrada_por             uuid references public.profiles(id),
  add column if not exists nf_registrada_em              timestamptz,
  add column if not exists credito_pis_cofins_retirado   boolean not null default false,
  add column if not exists credito_pis_cofins_motivo     text;
alter table public.pedidos_compra
  drop constraint if exists chk_pp_nf_valor,
  add constraint chk_pp_nf_valor check (nf_valor is null or nf_valor > 0),
  drop constraint if exists chk_pp_credito_motivo,
  add constraint chk_pp_credito_motivo check (not credito_pis_cofins_retirado or nullif(btrim(credito_pis_cofins_motivo), '') is not null);
create index if not exists idx_pp_nf_tomador on public.pedidos_compra (nf_tomador_estabelecimento_id);
create index if not exists idx_pp_nf_registrada_por on public.pedidos_compra (nf_registrada_por);
comment on column public.pedidos_compra.nf_data_emissao is 'Data de emissão da NF do fornecedor, registrada pelo financeiro na aprovação: define o mês do crédito de PIS/COFINS (módulo fiscal, 02/10/2026).';
comment on column public.pedidos_compra.credito_pis_cofins_retirado is 'O financeiro tirou o crédito de PIS/COFINS desta NF (com motivo). Falso = vale a regra automática.';

-- 8. Retenções na fonte previstas na aprovação da PP (a baixa já chega com elas)
create table if not exists public.pedidos_compra_retencoes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete restrict,
  pedido_compra_id uuid not null references public.pedidos_compra(id) on delete cascade,
  imposto          text not null,
  aliquota         numeric(7,4) not null,
  criado_por       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  constraint chk_pp_retencao_imposto check (imposto in ('ISS', 'PIS', 'COFINS', 'CSLL', 'IRRF')),
  constraint chk_pp_retencao_aliquota check (aliquota > 0 and aliquota < 100),
  constraint uq_pp_retencao unique (pedido_compra_id, imposto)
);
create index if not exists idx_pp_retencoes_tenant on public.pedidos_compra_retencoes (tenant_id);
create index if not exists idx_pp_retencoes_criado_por on public.pedidos_compra_retencoes (criado_por);
comment on table public.pedidos_compra_retencoes is
  'Alíquotas das retenções na fonte decididas na aprovação da PP (módulo fiscal, 02/10/2026). A baixa chega preenchida com elas e grava o que de fato reteve em baixas_retencoes.';

-- 9. Regime tributário do fornecedor -----------------------------------------
alter table public.fornecedores
  add column if not exists regime_tributario           text,
  add column if not exists regime_consultado_em        date,
  add column if not exists declaracao_simples_recebida boolean not null default false,
  add column if not exists declaracao_simples_path     text;
alter table public.fornecedores
  drop constraint if exists chk_fornecedor_regime,
  add constraint chk_fornecedor_regime check (regime_tributario is null or regime_tributario in ('normal', 'simples', 'mei'));
comment on column public.fornecedores.regime_tributario is 'normal (lucro real ou presumido), simples ou mei — da consulta do CNPJ, editável (módulo fiscal, 02/10/2026). Simples/MEI com declaração (IN 459) não sofrem retenção de PIS/COFINS/CSLL e IRRF.';

-- 10. RLS e GRANTs ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['fiscal_regimes', 'fiscal_estabelecimentos', 'fiscal_cnaes', 'fiscal_feriados', 'fiscal_parametros'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (tenant_id in (select public.current_tenant_ids()))',
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_modify', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (tenant_id in (select public.current_tenant_ids())
                and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)))
         with check (tenant_id in (select public.current_tenant_ids())
                and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)))',
      t || '_modify', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end $$;

alter table public.pedidos_compra_retencoes enable row level security;
drop policy if exists pedidos_compra_retencoes_select on public.pedidos_compra_retencoes;
create policy pedidos_compra_retencoes_select on public.pedidos_compra_retencoes
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));
revoke all on table public.pedidos_compra_retencoes from public, anon;
revoke insert, update, delete, truncate, references, trigger on table public.pedidos_compra_retencoes from authenticated;
grant select on table public.pedidos_compra_retencoes to authenticated;

-- 11. updated_at --------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['fiscal_regimes', 'fiscal_estabelecimentos', 'fiscal_cnaes', 'fiscal_parametros'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'trg_' || t || '_updated_at', t);
  end loop;
end $$;

-- 12. A NF da PP e as retenções previstas, na aprovação (admin e financeiro) --
create or replace function public.registrar_nf_da_pp(
  p_pp_id                  uuid,
  p_numero                 text,
  p_data_emissao           date,
  p_valor                  numeric,
  p_tomador_estabelecimento_id uuid,
  p_retencoes              jsonb,
  p_credito_retirado       boolean,
  p_credito_motivo         text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_status text;
  v_item   jsonb;
  v_imp    text;
  v_aliq   numeric;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.';
  end if;

  select tenant_id, status::text into v_tenant, v_status
    from public.pedidos_compra where id = p_pp_id for update;
  if v_tenant is null or v_tenant not in (select public.current_tenant_ids()) then
    raise exception 'PP não encontrada.';
  end if;
  if not (public.is_tenant_admin(v_tenant) or public.is_tenant_financeiro(v_tenant)) then
    raise exception 'Apenas admin ou financeiro registra a nota fiscal da PP.' using errcode = '42501';
  end if;
  if v_status <> 'em_avaliacao' then
    raise exception 'A nota fiscal só se registra com a PP em avaliação.';
  end if;

  if nullif(btrim(p_numero), '') is null then
    raise exception 'Informe o número da NF.';
  end if;
  if p_data_emissao is null then
    raise exception 'Informe a data de emissão da NF.';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'Informe o valor da NF.';
  end if;
  if not exists (
    select 1 from public.fiscal_estabelecimentos e
     where e.id = p_tomador_estabelecimento_id and e.tenant_id = v_tenant and e.ativo
  ) then
    raise exception 'Escolha o CNPJ tomador entre os CNPJs ativos do cadastro de impostos.';
  end if;
  if coalesce(p_credito_retirado, false) and nullif(btrim(p_credito_motivo), '') is null then
    raise exception 'Escolha por que esta nota não gera crédito de PIS/COFINS.';
  end if;

  update public.pedidos_compra
     set nf_numero = btrim(p_numero),
         nf_data_emissao = p_data_emissao,
         nf_valor = round(p_valor, 2),
         nf_tomador_estabelecimento_id = p_tomador_estabelecimento_id,
         nf_registrada_por = v_uid,
         nf_registrada_em = now(),
         credito_pis_cofins_retirado = coalesce(p_credito_retirado, false),
         credito_pis_cofins_motivo = case when coalesce(p_credito_retirado, false) then btrim(p_credito_motivo) else null end
   where id = p_pp_id;

  delete from public.pedidos_compra_retencoes where pedido_compra_id = p_pp_id;
  if p_retencoes is not null and jsonb_typeof(p_retencoes) = 'array' then
    for v_item in select value from jsonb_array_elements(p_retencoes) loop
      v_imp := upper(btrim(v_item->>'imposto'));
      v_aliq := (v_item->>'aliquota')::numeric;
      if v_imp not in ('ISS', 'PIS', 'COFINS', 'CSLL', 'IRRF') then
        raise exception 'Imposto retido inválido: %', v_imp;
      end if;
      if v_aliq is null or v_aliq <= 0 or v_aliq >= 100 then
        raise exception 'Alíquota inválida para %.', v_imp;
      end if;
      insert into public.pedidos_compra_retencoes (tenant_id, pedido_compra_id, imposto, aliquota, criado_por)
      values (v_tenant, p_pp_id, v_imp, v_aliq, v_uid);
    end loop;
  end if;
end;
$$;
revoke all on function public.registrar_nf_da_pp(uuid, text, date, numeric, uuid, jsonb, boolean, text) from public, anon;
grant execute on function public.registrar_nf_da_pp(uuid, text, date, numeric, uuid, jsonb, boolean, text) to authenticated;

-- 13. O CNPJ emissor e o CNAE da nota emitida (admin e financeiro) ------------
create or replace function public.registrar_fiscal_da_nota(
  p_faturamento_id     uuid,
  p_estabelecimento_id uuid,
  p_fiscal_cnae_id     uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.';
  end if;
  select tenant_id into v_tenant from public.faturamentos where id = p_faturamento_id for update;
  if v_tenant is null or v_tenant not in (select public.current_tenant_ids()) then
    raise exception 'Nota não encontrada.';
  end if;
  if not (public.is_tenant_admin(v_tenant) or public.is_tenant_financeiro(v_tenant)) then
    raise exception 'Apenas admin ou financeiro registra o CNPJ e o CNAE da nota.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.fiscal_estabelecimentos e
     where e.id = p_estabelecimento_id and e.tenant_id = v_tenant and e.ativo
  ) then
    raise exception 'Escolha um CNPJ emissor ativo do cadastro de impostos.';
  end if;
  if not exists (
    select 1 from public.fiscal_cnaes c
     where c.id = p_fiscal_cnae_id and c.estabelecimento_id = p_estabelecimento_id and c.ativo
  ) then
    raise exception 'O CNAE escolhido não é do CNPJ emissor.';
  end if;
  update public.faturamentos
     set estabelecimento_id = p_estabelecimento_id,
         fiscal_cnae_id = p_fiscal_cnae_id
   where id = p_faturamento_id;
end;
$$;
revoke all on function public.registrar_fiscal_da_nota(uuid, uuid, uuid) from public, anon;
grant execute on function public.registrar_fiscal_da_nota(uuid, uuid, uuid) to authenticated;

-- 14. Carga inicial (planilha "IMPOSTOS Ecossistema California") -------------
insert into public.fiscal_regimes (tenant_id, empresa_contabil_id, regime, regime_caixa, vigencia_inicio, observacao)
select ec.tenant_id, ec.id, v.regime, v.caixa, date '2026-01-01', v.obs
  from (values
    ('19437976000154', 'lucro_real', false, 'Lucro Real trimestral; federais pela matriz (Salvador).'),
    ('29943648000183', 'lucro_real', false, 'Lucro Real trimestral.'),
    ('04409741000181', 'lucro_presumido', true, 'Lucro Presumido pelo regime de caixa.')
  ) as v(cnpj, regime, caixa, obs)
  join public.empresas_contabeis ec on ec.cnpj = v.cnpj
on conflict (empresa_contabil_id, vigencia_inicio) do nothing;

insert into public.fiscal_estabelecimentos
  (tenant_id, empresa_contabil_id, nome, cnpj, papel, municipio, uf, iss_dia, iss_retido_dia, iss_regra, ativo, ordem, observacao)
select ec.tenant_id, ec.id, v.nome, v.cnpj, v.papel, v.municipio, v.uf, v.dia, v.dia, 'prorroga', v.ativo, v.ordem, v.obs
  from (values
    ('19437976000154', 'California · Salvador',  '19437976000154', 'matriz', 'Salvador',    'BA', 5::smallint,  true,  1::smallint, null),
    ('19437976000154', 'California · São Paulo', null,             'filial', 'São Paulo',   'SP', 10::smallint, false, 2::smallint, 'CNPJ da filial a informar: não está no banco nem na planilha. Ative depois de informar.'),
    ('19437976000154', 'California · Fortaleza', null,             'filial', 'Fortaleza',   'CE', 10::smallint, false, 3::smallint, 'CNPJ da filial a informar: não está no banco nem na planilha. Ative depois de informar.'),
    ('29943648000183', 'GoCrazy · Santo André',  '29943648000183', 'matriz', 'Santo André', 'SP', 20::smallint, true,  4::smallint, 'Dia 20 informado pela planilha; a confirmar com a contabilidade.'),
    ('04409741000181', 'Hitlab · Salvador',      '04409741000181', 'matriz', 'Salvador',    'BA', 5::smallint,  true,  5::smallint, null)
  ) as v(cnpj_pj, nome, cnpj, papel, municipio, uf, dia, ativo, ordem, obs)
  join public.empresas_contabeis ec on ec.cnpj = v.cnpj_pj
on conflict (tenant_id, nome) do nothing;

insert into public.fiscal_cnaes
  (tenant_id, estabelecimento_id, codigo, subitem, descricao, aliquota_iss, aliquota_pis, aliquota_cofins, cumulativo, vigencia_inicio)
select e.tenant_id, e.id, v.codigo, v.subitem, v.descricao, v.iss, v.pis, v.cofins, v.cumulativo, date '2026-01-01'
  from (values
  ('California · Salvador', '58.19-1-00', null, 'Edição de cadastros, listas e de outros produtos gráficos', 2, 1.65, 7.6, false),
  ('California · Salvador', '59.11-1-02', null, 'Produção de filmes para publicidade', 2, 1.65, 7.6, false),
  ('California · Salvador', '59.11-1-99', null, 'Atividades de produção cinematográfica, de vídeos e de programas de televisão não especificadas anteriormente', 2, 1.65, 7.6, false),
  ('California · Salvador', '59.13-8-00', null, 'Distribuição cinematográfica, de vídeo e de programas de televisão', 2, 1.65, 7.6, false),
  ('California · Salvador', '59.20-1-00', null, 'Atividades de gravação de som e de edição de música', 2, 1.65, 7.6, false),
  ('California · Salvador', '62.01-5-01', null, 'Desenvolvimento de programas de computador sob encomenda', 2, 1.65, 7.6, false),
  ('California · Salvador', '62.04-0-00', null, 'Consultoria em tecnologia da informação', 2, 1.65, 7.6, false),
  ('California · Salvador', '73.12-2-00', null, 'Agenciamento de espaços para publicidade, exceto em veículos de comunicação', 2, 1.65, 7.6, false),
  ('California · Salvador', '73.19-0-03', null, 'Marketing direto', 2, 1.65, 7.6, false),
  ('California · Salvador', '73.19-0-04', null, 'Consultoria em publicidade', 2, 1.65, 7.6, false),
  ('California · Salvador', '73.19-0-99', null, 'Outras atividades de publicidade não especificadas anteriormente', 2, 1.65, 7.6, false),
  ('California · Salvador', '74.20-0-01', null, 'Atividades de produção de fotografias, exceto aérea e submarina', 2, 1.65, 7.6, false),
  ('California · Salvador', '74.20-0-02', null, 'Atividades de produção de fotografias aéreas e submarinas', 2, 1.65, 7.6, false),
  ('California · Salvador', '74.20-0-04', null, 'Filmagem de festas e eventos', 2, 1.65, 7.6, false),
  ('California · Salvador', '74.90-1-04', null, 'Atividades de intermediação e agenciamento de serviços e negócios em geral, exceto imobiliários', 2, 1.65, 7.6, false),
  ('California · Salvador', '74.90-1-05', null, 'Agenciamento de profissionais para atividades esportivas, culturais e artísticas', 2, 1.65, 7.6, false),
  ('California · Salvador', '77.39-0-99', null, 'Aluguel de outras máquinas e equipamentos comerciais e industriais não especificados anteriormente, sem operador', 2, 1.65, 7.6, false),
  ('California · Salvador', '82.30-0-01', '12.08', 'Serviços de organização de feiras, congressos, exposições e festas', 2, 0.65, 3, true),
  ('California · Salvador', '82.30-0-01', '17.10', 'Serviços de organização de feiras, congressos, exposições e festas', 2, 1.65, 7.6, false),
  ('California · Salvador', '82.30-0-02', null, 'Casas de festas e eventos', 2, 1.65, 7.6, false),
  ('California · Salvador', '90.01-9-02', null, 'Produção musical', 2, 1.65, 7.6, false),
  ('California · São Paulo', '58.19-1-00', null, 'Edição de cadastros, listas e de outros produtos gráficos', 2, 1.65, 7.6, false),
  ('California · São Paulo', '59.11-1-02', null, 'Produção de filmes para publicidade', 5, 1.65, 7.6, false),
  ('California · São Paulo', '59.11-1-99', null, 'Atividades de produção cinematográfica, de vídeos e de programas de televisão não especificadas anteriormente', 5, 1.65, 7.6, false),
  ('California · São Paulo', '59.13-8-00', null, 'Distribuição cinematográfica, de vídeo e de programas de televisão', 5, 1.65, 7.6, false),
  ('California · São Paulo', '59.20-1-00', null, 'Atividades de gravação de som e de edição de música', 5, 1.65, 7.6, false),
  ('California · São Paulo', '62.01-5-01', null, 'Desenvolvimento de programas de computador sob encomenda', 2.9, 1.65, 7.6, false),
  ('California · São Paulo', '62.04-0-00', null, 'Consultoria em tecnologia da informação', 2.9, 1.65, 7.6, false),
  ('California · São Paulo', '73.12-2-00', null, 'Agenciamento de espaços para publicidade, exceto em veículos de comunicação', 5, 1.65, 7.6, false),
  ('California · São Paulo', '73.19-0-03', null, 'Marketing direto', 5, 1.65, 7.6, false),
  ('California · São Paulo', '73.19-0-04', null, 'Consultoria em publicidade', 5, 1.65, 7.6, false),
  ('California · São Paulo', '73.19-0-99', null, 'Outras atividades de publicidade não especificadas anteriormente', 5, 1.65, 7.6, false),
  ('California · São Paulo', '74.20-0-01', null, 'Atividades de produção de fotografias, exceto aérea e submarina', 5, 1.65, 7.6, false),
  ('California · São Paulo', '74.20-0-02', null, 'Atividades de produção de fotografias aéreas e submarinas', 5, 1.65, 7.6, false),
  ('California · São Paulo', '74.20-0-04', null, 'Filmagem de festas e eventos', 5, 1.65, 7.6, false),
  ('California · São Paulo', '74.90-1-04', null, 'Atividades de intermediação e agenciamento de serviços e negócios em geral, exceto imobiliários', 5, 1.65, 7.6, false),
  ('California · São Paulo', '74.90-1-05', null, 'Agenciamento de profissionais para atividades esportivas, culturais e artísticas', 5, 1.65, 7.6, false),
  ('California · São Paulo', '77.39-0-99', null, 'Aluguel de outras máquinas e equipamentos comerciais e industriais não especificados anteriormente, sem operador', 2, 1.65, 7.6, false),
  ('California · São Paulo', '82.30-0-01', '12.08', 'Serviços de organização de feiras, congressos, exposições e festas', 2.5, 0.65, 3, true),
  ('California · São Paulo', '82.30-0-01', '17.10', 'Serviços de organização de feiras, congressos, exposições e festas', 2.5, 1.65, 7.6, false),
  ('California · São Paulo', '82.30-0-02', null, 'Casas de festas e eventos', 5, 1.65, 7.6, false),
  ('California · São Paulo', '90.01-9-02', null, 'Produção musical', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '59.11-1-02', null, 'Produção de filmes para publicidade', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '59.11-1-99', null, 'Atividades de produção cinematográfica, de vídeos e de programas de televisão não especificadas anteriormente', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '59.13-8-00', null, 'Distribuição cinematográfica, de vídeo e de programas de televisão', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '59.20-1-00', null, 'Atividades de gravação de som e de edição de música', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '73.12-2-00', null, 'Agenciamento de espaços para publicidade, exceto em veículos de comunicação', 3, 1.65, 7.6, false),
  ('California · Fortaleza', '73.19-0-03', null, 'Marketing direto', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '73.19-0-04', null, 'Consultoria em publicidade', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '73.19-0-99', null, 'Outras atividades de publicidade não especificadas anteriormente', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '74.20-0-01', null, 'Atividades de produção de fotografias, exceto aérea e submarina', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '74.20-0-02', null, 'Atividades de produção de fotografias aéreas e submarinas', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '74.20-0-04', null, 'Filmagem de festas e eventos', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '74.90-1-04', null, 'Atividades de intermediação e agenciamento de serviços e negócios em geral, exceto imobiliários', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '74.90-1-05', null, 'Agenciamento de profissionais para atividades esportivas, culturais e artísticas', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '77.39-0-99', null, 'Aluguel de outras máquinas e equipamentos comerciais e industriais não especificados anteriormente, sem operador', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '82.30-0-01', '12.08', 'Serviços de organização de feiras, congressos, exposições e festas', 5, 0.65, 3, true),
  ('California · Fortaleza', '82.30-0-01', '17.10', 'Serviços de organização de feiras, congressos, exposições e festas', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '82.30-0-02', null, 'Casas de festas e eventos', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '90.01-9-02', null, 'Produção musical', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '90.01-9-03', null, 'Produção de espetáculos de dança', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '90.01-9-99', null, 'Artes cênicas, espetáculos e atividades complementares não especificadas anteriormente', 5, 1.65, 7.6, false),
  ('California · Fortaleza', '93.19-1-01', null, 'Produção e promoção de eventos esportivos', 5, 1.65, 7.6, false),
  ('GoCrazy · Santo André', '52.50-8-03', null, 'Agenciamento de cargas, exceto para o transporte marítimo', null, 1.65, 7.6, false),
  ('GoCrazy · Santo André', '59.11-1-99', null, 'Atividades de produção cinematográfica, de vídeos e de programas de televisão não especificadas anteriormente', 2, 1.65, 7.6, false),
  ('GoCrazy · Santo André', '59.12-0-99', null, 'Atividades de pós-produção cinematográfica, de vídeos e de programas de televisão não especificadas anteriormente', 2, 1.65, 7.6, false),
  ('GoCrazy · Santo André', '70.20-4-00', null, 'Atividades de consultoria em gestão empresarial, exceto consultoria técnica específica', 2, 1.65, 7.6, false),
  ('GoCrazy · Santo André', '73.11-4-00', null, 'Agências de publicidade', 2, 1.65, 7.6, false),
  ('GoCrazy · Santo André', '73.19-0-04', null, 'Consultoria em publicidade', 3, 1.65, 7.6, false),
  ('GoCrazy · Santo André', '74.20-0-04', null, 'Filmagem de festas e eventos', 2, 1.65, 7.6, false),
  ('GoCrazy · Santo André', '74.90-1-04', null, 'Atividades de intermediação e agenciamento de serviços e negócios em geral, exceto imobiliários', 2, 1.65, 7.6, false),
  ('GoCrazy · Santo André', '74.90-1-05', null, 'Agenciamento de profissionais para atividades esportivas, culturais e artísticas', 2, 1.65, 7.6, false),
  ('GoCrazy · Santo André', '77.40-3-00', null, 'Gestão de ativos intangíveis não-financeiros', 2, 1.65, 7.6, false),
  ('GoCrazy · Santo André', '82.30-0-01', '12.08', 'Serviços de organização de feiras, congressos, exposições e festas', 5, 0.65, 3, true),
  ('GoCrazy · Santo André', '82.30-0-01', '17.10', 'Serviços de organização de feiras, congressos, exposições e festas', 5, 1.65, 7.6, false),
  ('GoCrazy · Santo André', '90.01-9-02', null, 'Produção musical', 3, 1.65, 7.6, false),
  ('Hitlab · Salvador', '59.20-1-00', null, 'Atividades de gravação de som e de edição de música', 5, 0.65, 3, true),
  ('Hitlab · Salvador', '74.90-1-05', null, 'Agenciamento de profissionais para atividades esportivas, culturais e artísticas', 5, 0.65, 3, true),
  ('Hitlab · Salvador', '79.90-2-00', null, 'Serviços de reservas e outros serviços de turismo não especificados anteriormente', 5, 0.65, 3, true),
  ('Hitlab · Salvador', '90.01-9-99', null, 'Artes cênicas, espetáculos e atividades complementares não especificadas anteriormente', 5, 0.65, 3, true)
  ) as v(estab, codigo, subitem, descricao, iss, pis, cofins, cumulativo)
  join public.fiscal_estabelecimentos e on e.nome = v.estab
on conflict do nothing;

insert into public.fiscal_feriados (tenant_id, data, nome, municipio)
select t.id, v.data::date, v.nome, v.municipio
  from (values
  ('2026-01-01', 'Confraternização Universal', null),
  ('2026-02-16', 'Carnaval', null),
  ('2026-02-17', 'Carnaval', null),
  ('2026-04-03', 'Sexta-feira Santa', null),
  ('2026-04-21', 'Tiradentes', null),
  ('2026-05-01', 'Dia do Trabalho', null),
  ('2026-06-04', 'Corpus Christi', null),
  ('2026-09-07', 'Independência', null),
  ('2026-10-12', 'Nossa Senhora Aparecida', null),
  ('2026-11-02', 'Finados', null),
  ('2026-11-15', 'Proclamação da República', null),
  ('2026-11-20', 'Dia da Consciência Negra', null),
  ('2026-12-25', 'Natal', null),
  ('2026-12-31', 'Sem expediente bancário ao público', null),
  ('2027-01-01', 'Confraternização Universal', null),
  ('2027-02-08', 'Carnaval', null),
  ('2027-02-09', 'Carnaval', null),
  ('2027-03-26', 'Sexta-feira Santa', null),
  ('2027-04-21', 'Tiradentes', null),
  ('2027-05-01', 'Dia do Trabalho', null),
  ('2027-05-27', 'Corpus Christi', null),
  ('2026-06-24', 'São João', 'Salvador'),
  ('2026-07-02', 'Independência da Bahia', 'Salvador'),
  ('2026-12-08', 'Nossa Senhora da Conceição da Praia', 'Salvador'),
  ('2026-01-25', 'Aniversário de São Paulo', 'São Paulo'),
  ('2026-07-09', 'Revolução Constitucionalista', 'São Paulo'),
  ('2026-03-19', 'São José', 'Fortaleza'),
  ('2026-03-25', 'Data Magna do Ceará', 'Fortaleza'),
  ('2026-08-15', 'Nossa Senhora da Assunção', 'Fortaleza'),
  ('2026-07-09', 'Revolução Constitucionalista', 'Santo André')
  ) as v(data, nome, municipio)
  cross join (select distinct tenant_id as id from public.empresas_contabeis) t
on conflict do nothing;

insert into public.fiscal_parametros (tenant_id, chave, valor, descricao, vigencia_inicio)
select t.id, v.chave, v.valor, v.descricao, date '2026-01-01'
  from (values
    ('csrf_pis',                 0.65,    'Retenção de PIS na fonte (DARF 5952)'),
    ('csrf_cofins',              3,       'Retenção de COFINS na fonte (DARF 5952)'),
    ('csrf_csll',                1,       'Retenção de CSLL na fonte (DARF 5952)'),
    ('irrf_servicos',            1.5,     'Retenção de IRRF sobre serviços (DARF 1708)'),
    ('credito_pis',              1.65,    'Crédito de PIS não cumulativo'),
    ('credito_cofins',           7.6,     'Crédito de COFINS não cumulativo'),
    ('irpj',                     15,      'IRPJ'),
    ('irpj_adicional',           10,      'Adicional do IRPJ'),
    ('irpj_adicional_limite_mes', 20000,  'Limite mensal do adicional do IRPJ (R$ 60 mil no trimestre)'),
    ('csll',                     9,       'CSLL'),
    ('presuncao_servicos',       32,      'Presunção do lucro presumido para serviços'),
    ('presuncao_lc224',          35.2,    'Presunção acima do limite da LC 224/2025'),
    ('lc224_limite_trimestre',   1250000, 'Receita no trimestre acima da qual vale a presunção da LC 224/2025'),
    ('pis_cofins_dia',           25,      'Vencimento do PIS e da COFINS (dia do mês seguinte; antecipa em dia não útil)'),
    ('retencoes_dia',            20,      'Vencimento das retenções federais (dia do mês seguinte; antecipa em dia não útil)')
  ) as v(chave, valor, descricao)
  cross join (select distinct tenant_id as id from public.empresas_contabeis) t
on conflict (tenant_id, chave, vigencia_inicio) do nothing;
