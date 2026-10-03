-- =============================================================================
-- Módulo fiscal · entrega 2 (02/10/2026): a base da Apuração e de Impostos a
-- Pagar. Desenho aprovado pelo Tiago no protótipo (30/09 a 02/10/2026); as
-- regras estão na decisão 139 e em
-- docs/superpowers/specs/2026-10-01-modulo-fiscal-pesquisa-tributaria.md.
--
-- Racional
-- • A APURAÇÃO não se grava: as guias (CNPJ × imposto × competência) saem
--   de um cálculo puro sobre as notas, os recebimentos e as NFs de
--   fornecedor (`lib/fiscal/apuracao.ts`). O que se grava é a APROVAÇÃO de
--   cada guia (`fiscal_aprovacoes`): o valor calculado, o valor da guia que
--   a contabilidade mandou (com justificativa quando difere), a memória e o
--   rateio congelados, as cotas do IRPJ/CSLL e as compensações de ISS. Se o
--   cálculo mudar depois (nota registrada atrasada), a tela mostra a
--   diferença e a aprovação complementar entra com `diferenca = true`.
-- • IMPOSTOS A PAGAR (`impostos_a_pagar`): os títulos que a aprovação cria
--   (um por guia; uma por cota no IRPJ/CSLL; o complementar da diferença) e
--   os lançados à mão (avulso). Cada um guarda o rateio entre empresas
--   gerenciais e regionais (`impostos_a_pagar_rateio`), pela participação de
--   cada uma no faturamento (ou no custo, nas retenções).
-- • A BAIXA da guia é uma saída só no banco, mas cada empresa · regional
--   precisa do seu custo (toda saída tem uma empresa, uma regional e um
--   centro de custo — `chk_lancamento_sem_empresa_so_transferencia`). Então
--   a baixa grava um lançamento por parte do rateio, mais um de multa e
--   juros, todos com `imposto_a_pagar_id` e a origem `imposto_baixa`; a
--   conciliação os mostra como UMA linha (o débito do banco) que se abre em
--   sublinhas, como a fatura do cartão. Centro de custo: 03 · Custo
--   Tributário · <imposto> no imposto próprio; 02 · Custo Operacional no
--   repasse das retenções de fornecedor (ISS retido, CSRF, IRRF); 11 ·
--   Despesa com Juros na multa e nos juros (protótipo aprovado).
-- • Os subtipos 03 · ISS / PIS / COFINS / IRPJ / CSLL / Outros impostos
--   entram no plano de contas (hoje só existe "999 · Geral (provisório)").
-- • Cancelar a baixa apaga os lançamentos dela (como as outras baixas,
--   `_apagar_lancamento_de_baixa`) e reabre o título; tudo fica no
--   `audit_events`.
-- • Acesso: só admin e financeiro leem e escrevem (RLS de leitura; escrita
--   só pelas funções SECURITY DEFINER, com a trava de papel). GRANT para
--   `authenticated`, nada para `anon`. Anexos (guia e comprovante) no
--   bucket privado `impostos`, em `<tenant_id>/...`.
-- • Mudança ADITIVA: tabelas, coluna, subtipos, bucket e funções novos. As
--   duas travas de origem de `lancamentos_financeiros` são recriadas a
--   partir da definição atual lida do próprio banco, só com a condição nova
--   da `imposto_baixa` acrescentada (nenhuma regra existente muda).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Plano de contas: os subtipos do imposto próprio
-- -----------------------------------------------------------------------------
insert into public.plano_contas_subtipos (tenant_id, tipo_id, codigo, nome, ativo)
select t.tenant_id, t.id, v.codigo, v.nome, true
  from public.plano_contas_tipos t
  cross join (values
    ('001', 'ISS'),
    ('002', 'PIS'),
    ('003', 'COFINS'),
    ('004', 'IRPJ'),
    ('005', 'CSLL'),
    ('006', 'Outros impostos')
  ) as v(codigo, nome)
 where t.codigo = '03'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Aprovações da apuração
-- -----------------------------------------------------------------------------
create table public.fiscal_aprovacoes (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  chave                 text not null,
  tributo               text not null
                          check (tributo in ('ISS', 'PIS', 'COFINS', 'IRPJ', 'CSLL', 'ISS_RET', 'CSRF', 'IRRF')),
  empresa_contabil_id   uuid not null references public.empresas_contabeis(id) on delete restrict,
  estabelecimento_id    uuid references public.fiscal_estabelecimentos(id) on delete restrict,
  competencia           text not null check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2]|T[1-4])$'),
  periodo               text not null check (periodo in ('mensal', 'trimestral')),
  data                  date not null,
  valor_calculado       numeric(14, 2) not null check (valor_calculado >= 0),
  valor_guia            numeric(14, 2) not null check (valor_guia >= 0),
  justificativa         text,
  diferenca             boolean not null default false,
  compensacoes_usadas   jsonb not null default '[]'::jsonb,
  cotas                 jsonb,
  memoria               jsonb not null default '[]'::jsonb,
  rateio                jsonb not null default '[]'::jsonb,
  guia_path             text,
  aprovada_por          uuid not null references public.profiles(id),
  aprovada_em           timestamptz not null default now(),
  constraint chk_fiscal_aprovacao_justificativa check (
    abs(valor_guia - valor_calculado) < 0.005
    or length(btrim(coalesce(justificativa, ''))) >= 10
  )
);

comment on table public.fiscal_aprovacoes is
  'Aprovação de uma guia da apuração (módulo fiscal, entrega 2): o calculado, o valor da guia da contabilidade, a memória e o rateio congelados. A guia em si é calculada (lib/fiscal/apuracao.ts).';

create unique index uq_fiscal_aprovacao_por_guia
  on public.fiscal_aprovacoes (tenant_id, chave) where not diferenca;
create index idx_fiscal_aprovacoes_competencia on public.fiscal_aprovacoes (tenant_id, competencia);
create index idx_fiscal_aprovacoes_pj on public.fiscal_aprovacoes (empresa_contabil_id);
create index idx_fiscal_aprovacoes_estab on public.fiscal_aprovacoes (estabelecimento_id);
create index idx_fiscal_aprovacoes_autor on public.fiscal_aprovacoes (aprovada_por);

-- -----------------------------------------------------------------------------
-- 3. Impostos a Pagar
-- -----------------------------------------------------------------------------
create table public.impostos_a_pagar (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  aprovacao_id          uuid references public.fiscal_aprovacoes(id) on delete restrict,
  origem                text not null check (origem in ('apuracao', 'diferenca', 'avulso')),
  tributo               text not null
                          check (tributo in ('ISS', 'PIS', 'COFINS', 'IRPJ', 'CSLL', 'ISS_RET', 'CSRF', 'IRRF', 'OUTRO')),
  titulo                text not null check (length(btrim(titulo)) >= 2),
  codigo_receita        text,
  empresa_contabil_id   uuid not null references public.empresas_contabeis(id) on delete restrict,
  estabelecimento_id    uuid references public.fiscal_estabelecimentos(id) on delete restrict,
  competencia           text not null check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2]|T[1-4])$'),
  rotulo_competencia    text not null,
  cota_numero           smallint check (cota_numero between 1 and 3),
  cota_total            smallint check (cota_total between 1 and 3),
  juros_pct             numeric(7, 4),
  descricao             text not null check (length(btrim(descricao)) >= 3),
  vencimento            date not null,
  principal             numeric(14, 2) not null check (principal > 0),
  juros                 numeric(14, 2) not null default 0 check (juros >= 0),
  valor                 numeric(14, 2) not null check (valor > 0),
  status                text not null default 'a_pagar' check (status in ('a_pagar', 'pago')),
  guia_path             text,
  pago_em               date,
  conta_bancaria_id     uuid references public.contas_bancarias(id) on delete restrict,
  multa_juros           numeric(14, 2) not null default 0 check (multa_juros >= 0),
  comprovante_path      text,
  baixado_por           uuid references public.profiles(id),
  baixado_em            timestamptz,
  criado_por            uuid not null references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint chk_imposto_valor_e_principal_mais_juros check (abs(valor - (principal + juros)) < 0.005),
  constraint chk_imposto_origem_aprovacao check ((origem = 'avulso') = (aprovacao_id is null)),
  constraint chk_imposto_cota check ((cota_numero is null) = (cota_total is null)),
  constraint chk_imposto_pago_consistente check (
    (status = 'pago' and pago_em is not null and conta_bancaria_id is not null and comprovante_path is not null)
    or (status = 'a_pagar' and pago_em is null and conta_bancaria_id is null and baixado_em is null)
  )
);

comment on table public.impostos_a_pagar is
  'Títulos de imposto (módulo fiscal, entrega 2): os que a aprovação de uma guia cria e os lançados à mão. A baixa vira lançamentos de origem imposto_baixa, um por parte do rateio.';

create index idx_impostos_a_pagar_lista on public.impostos_a_pagar (tenant_id, status, vencimento);
create index idx_impostos_a_pagar_aprovacao on public.impostos_a_pagar (aprovacao_id);
create index idx_impostos_a_pagar_pj on public.impostos_a_pagar (empresa_contabil_id);
create index idx_impostos_a_pagar_estab on public.impostos_a_pagar (estabelecimento_id);
create index idx_impostos_a_pagar_conta on public.impostos_a_pagar (conta_bancaria_id);

create trigger trg_impostos_a_pagar_updated_at
  before update on public.impostos_a_pagar
  for each row execute function public.set_updated_at();

create table public.impostos_a_pagar_rateio (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  imposto_a_pagar_id    uuid not null references public.impostos_a_pagar(id) on delete cascade,
  empresa_id            uuid not null references public.empresas(id) on delete restrict,
  regional_id           uuid references public.regionais(id) on delete restrict,
  valor                 numeric(14, 2) not null check (valor > 0),
  percentual            numeric(7, 4) not null check (percentual > 0 and percentual <= 100),
  ordem                 smallint not null
);

create index idx_impostos_rateio_titulo on public.impostos_a_pagar_rateio (imposto_a_pagar_id, ordem);
create index idx_impostos_rateio_empresa on public.impostos_a_pagar_rateio (empresa_id);
create index idx_impostos_rateio_regional on public.impostos_a_pagar_rateio (regional_id);

create table public.impostos_a_pagar_correcoes (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  imposto_a_pagar_id    uuid not null references public.impostos_a_pagar(id) on delete cascade,
  de                    numeric(14, 2) not null,
  para                  numeric(14, 2) not null check (para > 0),
  justificativa         text not null check (length(btrim(justificativa)) >= 10),
  anexo_path            text,
  criado_por            uuid not null references public.profiles(id),
  created_at            timestamptz not null default now()
);

create index idx_impostos_correcoes_titulo on public.impostos_a_pagar_correcoes (imposto_a_pagar_id);

-- -----------------------------------------------------------------------------
-- 4. O lançamento da baixa aponta para o título de imposto
-- -----------------------------------------------------------------------------
alter table public.lancamentos_financeiros
  add column imposto_a_pagar_id uuid references public.impostos_a_pagar(id) on delete restrict;

create index idx_lancamentos_imposto_a_pagar
  on public.lancamentos_financeiros (imposto_a_pagar_id)
  where imposto_a_pagar_id is not null;

alter table public.lancamentos_financeiros
  add constraint chk_imposto_a_pagar_so_na_baixa_de_imposto
  check ((origem = 'imposto_baixa'::origem_lancamento) = (imposto_a_pagar_id is not null));

-- As duas travas de origem: lidas do banco e recriadas com a condição nova.
do $$
declare
  v_def   text;
  v_meio  text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.lancamentos_financeiros'::regclass
     and conname = 'chk_origem_contraparte_tem_id';
  if v_def is null or left(v_def, 8) <> 'CHECK ((' or right(v_def, 2) <> '))' then
    raise exception 'Definição inesperada de chk_origem_contraparte_tem_id: %', v_def;
  end if;
  v_meio := substr(v_def, 9, length(v_def) - 10);
  alter table public.lancamentos_financeiros drop constraint chk_origem_contraparte_tem_id;
  execute 'alter table public.lancamentos_financeiros add constraint chk_origem_contraparte_tem_id CHECK (('
    || v_meio
    || ' OR ((origem = ''imposto_baixa''::origem_lancamento) AND (imposto_a_pagar_id IS NOT NULL))))';

  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.lancamentos_financeiros'::regclass
     and conname = 'chk_origem_tem_referencia';
  if v_def is null or left(v_def, 8) <> 'CHECK ((' or right(v_def, 2) <> '))' then
    raise exception 'Definição inesperada de chk_origem_tem_referencia: %', v_def;
  end if;
  v_meio := substr(v_def, 9, length(v_def) - 10);
  alter table public.lancamentos_financeiros drop constraint chk_origem_tem_referencia;
  execute 'alter table public.lancamentos_financeiros add constraint chk_origem_tem_referencia CHECK (('
    || v_meio
    || ' OR ((origem = ''imposto_baixa''::origem_lancamento) AND (imposto_a_pagar_id IS NOT NULL)'
    || ' AND (pedido_compra_id IS NULL) AND (conta_avulsa_id IS NULL) AND (titulo_receber_id IS NULL)'
    || ' AND (desembolso_id IS NULL) AND (pp_verba_devolucao_id IS NULL) AND (fatura_cartao_id IS NULL)'
    || ' AND (transferencia_id IS NULL))))';
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. RLS e GRANTs: só admin e financeiro leem; escrita só pelas funções
-- -----------------------------------------------------------------------------
alter table public.fiscal_aprovacoes enable row level security;
alter table public.impostos_a_pagar enable row level security;
alter table public.impostos_a_pagar_rateio enable row level security;
alter table public.impostos_a_pagar_correcoes enable row level security;

create policy fiscal_aprovacoes_select on public.fiscal_aprovacoes
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

create policy impostos_a_pagar_select on public.impostos_a_pagar
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

create policy impostos_a_pagar_rateio_select on public.impostos_a_pagar_rateio
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

create policy impostos_a_pagar_correcoes_select on public.impostos_a_pagar_correcoes
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

revoke all on public.fiscal_aprovacoes, public.impostos_a_pagar,
              public.impostos_a_pagar_rateio, public.impostos_a_pagar_correcoes
  from anon, public;
grant select on public.fiscal_aprovacoes, public.impostos_a_pagar,
                public.impostos_a_pagar_rateio, public.impostos_a_pagar_correcoes
  to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Funções
-- -----------------------------------------------------------------------------

-- Trava de papel do módulo: admin ou financeiro do tenant.
create or replace function public._exige_financeiro_fiscal(p_tenant_id uuid)
returns uuid
language plpgsql
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
    raise exception 'Apenas admin ou financeiro mexe na apuração e nos impostos.'
      using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Grava o rateio de um título (lista [{empresa_id, regional_id, valor, pct}])
-- e confere que ele fecha com o valor do título.
create or replace function public._imposto_gravar_rateio(
  p_tenant_id uuid,
  p_imposto_id uuid,
  p_valor numeric,
  p_rateio jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item    jsonb;
  v_ordem   smallint := 0;
  v_soma    numeric := 0;
  v_empresa uuid;
  v_regional uuid;
  v_valor   numeric;
begin
  if p_rateio is null or jsonb_typeof(p_rateio) <> 'array' or jsonb_array_length(p_rateio) = 0 then
    raise exception 'O imposto precisa do rateio entre as empresas e regionais.';
  end if;
  for v_item in select value from jsonb_array_elements(p_rateio)
  loop
    v_ordem := v_ordem + 1;
    v_empresa := (v_item->>'empresa_id')::uuid;
    v_regional := nullif(v_item->>'regional_id', '')::uuid;
    v_valor := round((v_item->>'valor')::numeric, 2);
    if not exists (select 1 from public.empresas e where e.id = v_empresa and e.tenant_id = p_tenant_id) then
      raise exception 'Empresa do rateio não encontrada.';
    end if;
    if v_regional is not null and not exists (
      select 1 from public.regionais r
       where r.id = v_regional and r.tenant_id = p_tenant_id and r.empresa_id = v_empresa
    ) then
      raise exception 'A regional do rateio não é desta empresa.';
    end if;
    if v_valor is null or v_valor <= 0 then
      raise exception 'Cada parte do rateio precisa de valor.';
    end if;
    insert into public.impostos_a_pagar_rateio
      (tenant_id, imposto_a_pagar_id, empresa_id, regional_id, valor, percentual, ordem)
    values
      (p_tenant_id, p_imposto_id, v_empresa, v_regional, v_valor,
       least(100, greatest(0.0001, round(v_valor / p_valor * 100, 4))), v_ordem);
    v_soma := v_soma + v_valor;
  end loop;
  if abs(v_soma - p_valor) >= 0.005 then
    raise exception 'O rateio (%) não fecha com o valor do imposto (%).', v_soma, p_valor;
  end if;
end;
$$;

-- Aprova uma guia da apuração e cria os títulos dela.
-- p_titulos: [{origem, cota_numero, cota_total, juros_pct, vencimento,
--              principal, juros, valor, descricao, rateio: [...]}]
create or replace function public.aprovar_guia_fiscal(
  p_tenant_id            uuid,
  p_chave                text,
  p_tributo              text,
  p_empresa_contabil_id  uuid,
  p_estabelecimento_id   uuid,
  p_competencia          text,
  p_periodo              text,
  p_rotulo_competencia   text,
  p_titulo               text,
  p_codigo_receita       text,
  p_valor_calculado      numeric,
  p_valor_guia           numeric,
  p_justificativa        text,
  p_diferenca            boolean,
  p_compensacoes         jsonb,
  p_cotas                jsonb,
  p_memoria              jsonb,
  p_rateio               jsonb,
  p_guia_path            text,
  p_titulos              jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid;
  v_id         uuid;
  v_imposto_id uuid;
  v_t          jsonb;
  v_soma       numeric := 0;
begin
  v_uid := public._exige_financeiro_fiscal(p_tenant_id);

  if not exists (select 1 from public.empresas_contabeis ec where ec.id = p_empresa_contabil_id and ec.tenant_id = p_tenant_id) then
    raise exception 'Empresa contábil não encontrada.';
  end if;
  if p_estabelecimento_id is not null and not exists (
    select 1 from public.fiscal_estabelecimentos fe
     where fe.id = p_estabelecimento_id and fe.tenant_id = p_tenant_id
       and fe.empresa_contabil_id = p_empresa_contabil_id
  ) then
    raise exception 'O CNPJ da guia não é desta empresa contábil.';
  end if;
  if coalesce(p_diferenca, false) then
    if not exists (select 1 from public.fiscal_aprovacoes a
                    where a.tenant_id = p_tenant_id and a.chave = p_chave and not a.diferenca) then
      raise exception 'A diferença só se aprova depois da guia aprovada.';
    end if;
  elsif exists (select 1 from public.fiscal_aprovacoes a
                 where a.tenant_id = p_tenant_id and a.chave = p_chave and not a.diferenca) then
    raise exception 'Esta guia já foi aprovada.';
  end if;
  if p_valor_guia is null or p_valor_guia < 0 then
    raise exception 'Informe o valor da guia.';
  end if;
  if abs(coalesce(p_valor_guia, 0) - coalesce(p_valor_calculado, 0)) >= 0.005
     and length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'O valor da guia é diferente do calculado: explique em pelo menos 10 caracteres.';
  end if;

  insert into public.fiscal_aprovacoes (
    tenant_id, chave, tributo, empresa_contabil_id, estabelecimento_id,
    competencia, periodo, data, valor_calculado, valor_guia, justificativa,
    diferenca, compensacoes_usadas, cotas, memoria, rateio, guia_path, aprovada_por
  ) values (
    p_tenant_id, p_chave, p_tributo, p_empresa_contabil_id, p_estabelecimento_id,
    p_competencia, p_periodo, (now() at time zone 'America/Sao_Paulo')::date,
    round(p_valor_calculado, 2), round(p_valor_guia, 2), nullif(btrim(coalesce(p_justificativa, '')), ''),
    coalesce(p_diferenca, false), coalesce(p_compensacoes, '[]'::jsonb), p_cotas,
    coalesce(p_memoria, '[]'::jsonb), coalesce(p_rateio, '[]'::jsonb), p_guia_path, v_uid
  )
  returning id into v_id;

  for v_t in select value from jsonb_array_elements(coalesce(p_titulos, '[]'::jsonb))
  loop
    insert into public.impostos_a_pagar (
      tenant_id, aprovacao_id, origem, tributo, titulo, codigo_receita,
      empresa_contabil_id, estabelecimento_id, competencia, rotulo_competencia,
      cota_numero, cota_total, juros_pct, descricao, vencimento,
      principal, juros, valor, guia_path, criado_por
    ) values (
      p_tenant_id, v_id,
      case when coalesce(p_diferenca, false) then 'diferenca' else 'apuracao' end,
      p_tributo, p_titulo, p_codigo_receita,
      p_empresa_contabil_id, p_estabelecimento_id, p_competencia, p_rotulo_competencia,
      nullif(v_t->>'cota_numero', '')::smallint, nullif(v_t->>'cota_total', '')::smallint,
      nullif(v_t->>'juros_pct', '')::numeric,
      v_t->>'descricao', (v_t->>'vencimento')::date,
      round((v_t->>'principal')::numeric, 2), round(coalesce((v_t->>'juros')::numeric, 0), 2),
      round((v_t->>'valor')::numeric, 2), p_guia_path, v_uid
    )
    returning id into v_imposto_id;

    perform public._imposto_gravar_rateio(
      p_tenant_id, v_imposto_id, round((v_t->>'valor')::numeric, 2), v_t->'rateio'
    );
    v_soma := v_soma + round((v_t->>'principal')::numeric, 2);
  end loop;

  if abs(v_soma - round(p_valor_guia, 2)) >= 0.005 then
    raise exception 'Os títulos (%) não fecham com o valor da guia (%).', v_soma, p_valor_guia;
  end if;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (
    p_tenant_id, 'fiscal_aprovacao', v_id::text,
    case when coalesce(p_diferenca, false) then 'fiscal.diferenca_aprovada' else 'fiscal.guia_aprovada' end,
    v_uid,
    jsonb_build_object(
      'chave', p_chave, 'tributo', p_tributo, 'competencia', p_competencia,
      'valor_calculado', p_valor_calculado, 'valor_guia', p_valor_guia,
      'justificativa', p_justificativa,
      'titulos', jsonb_array_length(coalesce(p_titulos, '[]'::jsonb))
    )
  );

  return v_id;
end;
$$;

-- Lança um imposto à mão (Impostos a Pagar › Lançamento avulso).
create or replace function public.criar_imposto_avulso(
  p_tenant_id            uuid,
  p_tributo              text,
  p_titulo               text,
  p_codigo_receita       text,
  p_empresa_contabil_id  uuid,
  p_estabelecimento_id   uuid,
  p_competencia          text,
  p_rotulo_competencia   text,
  p_descricao            text,
  p_vencimento           date,
  p_valor                numeric,
  p_rateio               jsonb,
  p_guia_path            text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_id  uuid;
begin
  v_uid := public._exige_financeiro_fiscal(p_tenant_id);
  if not exists (select 1 from public.empresas_contabeis ec where ec.id = p_empresa_contabil_id and ec.tenant_id = p_tenant_id) then
    raise exception 'Empresa contábil não encontrada.';
  end if;
  if p_estabelecimento_id is not null and not exists (
    select 1 from public.fiscal_estabelecimentos fe
     where fe.id = p_estabelecimento_id and fe.tenant_id = p_tenant_id
       and fe.empresa_contabil_id = p_empresa_contabil_id
  ) then
    raise exception 'O CNPJ não é desta empresa contábil.';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'Informe o valor do imposto.';
  end if;
  if p_vencimento is null then
    raise exception 'Informe o vencimento.';
  end if;

  insert into public.impostos_a_pagar (
    tenant_id, aprovacao_id, origem, tributo, titulo, codigo_receita,
    empresa_contabil_id, estabelecimento_id, competencia, rotulo_competencia,
    descricao, vencimento, principal, juros, valor, guia_path, criado_por
  ) values (
    p_tenant_id, null, 'avulso', p_tributo, p_titulo, nullif(btrim(coalesce(p_codigo_receita, '')), ''),
    p_empresa_contabil_id, p_estabelecimento_id, p_competencia, p_rotulo_competencia,
    btrim(p_descricao), p_vencimento, round(p_valor, 2), 0, round(p_valor, 2), p_guia_path, v_uid
  )
  returning id into v_id;

  perform public._imposto_gravar_rateio(p_tenant_id, v_id, round(p_valor, 2), p_rateio);

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (p_tenant_id, 'imposto_a_pagar', v_id::text, 'fiscal.imposto_avulso_criado', v_uid,
          jsonb_build_object('tributo', p_tributo, 'competencia', p_competencia, 'valor', p_valor,
                             'descricao', p_descricao));
  return v_id;
end;
$$;

-- Corrige o valor de um imposto em aberto (a guia da contabilidade veio
-- diferente): grava a correção e reescala o rateio.
create or replace function public.corrigir_imposto(
  p_imposto_id     uuid,
  p_valor          numeric,
  p_justificativa  text,
  p_anexo_path     text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid;
  v_imp   impostos_a_pagar%rowtype;
  v_novo  numeric;
  v_r     record;
  v_acum  numeric := 0;
  v_n     integer;
  v_i     integer := 0;
  v_parte numeric;
begin
  select * into v_imp from public.impostos_a_pagar where id = p_imposto_id for update;
  if not found then raise exception 'Imposto não encontrado.'; end if;
  v_uid := public._exige_financeiro_fiscal(v_imp.tenant_id);
  if v_imp.status <> 'a_pagar' then
    raise exception 'Só se corrige imposto em aberto: cancele a baixa antes.';
  end if;
  v_novo := round(p_valor, 2);
  if v_novo is null or v_novo <= 0 then raise exception 'Informe o valor corrigido.'; end if;
  if v_novo <= v_imp.juros then raise exception 'O valor corrigido precisa ser maior que os juros da cota.'; end if;
  if abs(v_novo - v_imp.valor) < 0.005 then raise exception 'O valor não mudou.'; end if;
  if length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'Explique a correção em pelo menos 10 caracteres.';
  end if;

  insert into public.impostos_a_pagar_correcoes
    (tenant_id, imposto_a_pagar_id, de, para, justificativa, anexo_path, criado_por)
  values (v_imp.tenant_id, v_imp.id, v_imp.valor, v_novo, btrim(p_justificativa), p_anexo_path, v_uid);

  -- Reescala o rateio; a última parte fecha a conta.
  select count(*) into v_n from public.impostos_a_pagar_rateio where imposto_a_pagar_id = v_imp.id;
  for v_r in
    select id, valor from public.impostos_a_pagar_rateio
     where imposto_a_pagar_id = v_imp.id order by ordem
  loop
    v_i := v_i + 1;
    if v_i = v_n then
      v_parte := round(v_novo - v_acum, 2);
    else
      v_parte := round(v_r.valor * v_novo / v_imp.valor, 2);
    end if;
    if v_parte <= 0 then
      raise exception 'O valor corrigido é pequeno demais para o rateio deste imposto.';
    end if;
    update public.impostos_a_pagar_rateio
       set valor = v_parte,
           percentual = least(100, greatest(0.0001, round(v_parte / v_novo * 100, 4)))
     where id = v_r.id;
    v_acum := v_acum + v_parte;
  end loop;

  update public.impostos_a_pagar
     set valor = v_novo,
         principal = v_novo - juros
   where id = v_imp.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_imp.tenant_id, 'imposto_a_pagar', v_imp.id::text, 'fiscal.imposto_corrigido', v_uid,
          jsonb_build_object('de', v_imp.valor, 'para', v_novo, 'justificativa', btrim(p_justificativa)));
  return v_imp.id;
end;
$$;

-- Dá baixa num imposto: um lançamento por parte do rateio (03 no imposto
-- próprio, 02 no repasse das retenções) e um de multa e juros (11).
create or replace function public.baixar_imposto(
  p_imposto_id         uuid,
  p_pago_em            date,
  p_conta_bancaria_id  uuid,
  p_multa_juros        numeric,
  p_guia_path          text,
  p_comprovante_path   text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid;
  v_imp          impostos_a_pagar%rowtype;
  v_conta        contas_bancarias%rowtype;
  v_tipo         uuid;
  v_subtipo      uuid;
  v_tipo_juros   uuid;
  v_sub_juros    uuid;
  v_cod_tipo     text;
  v_cod_subtipo  text;
  v_descricao    text;
  v_r            record;
  v_primeiro     uuid;
  v_id           uuid;
  v_multa        numeric := round(coalesce(p_multa_juros, 0), 2);
  v_guia         text;
  v_maior        record;
begin
  if p_pago_em is null then raise exception 'Informe a data do pagamento.'; end if;

  select * into v_imp from public.impostos_a_pagar where id = p_imposto_id for update;
  if not found then raise exception 'Imposto não encontrado.'; end if;
  v_uid := public._exige_financeiro_para_baixar(v_imp.tenant_id);

  if v_imp.status <> 'a_pagar' then
    raise exception 'Este imposto já está pago.';
  end if;
  if v_multa < 0 then raise exception 'Multa e juros não podem ser negativos.'; end if;
  v_guia := coalesce(nullif(btrim(coalesce(p_guia_path, '')), ''), v_imp.guia_path);
  if v_guia is null then raise exception 'Anexe a guia (DARF ou guia municipal).'; end if;
  if nullif(btrim(coalesce(p_comprovante_path, '')), '') is null then
    raise exception 'Anexe o comprovante de pagamento.';
  end if;

  v_conta := public._conta_da_baixa(p_conta_bancaria_id, v_imp.tenant_id, p_pago_em, 'pagamento');

  if v_imp.tributo in ('ISS_RET', 'CSRF', 'IRRF') then
    v_cod_tipo := '02'; v_cod_subtipo := '999';
  else
    v_cod_tipo := '03';
    v_cod_subtipo := case v_imp.tributo
                       when 'ISS' then '001' when 'PIS' then '002' when 'COFINS' then '003'
                       when 'IRPJ' then '004' when 'CSLL' then '005' else '006' end;
  end if;
  select t.id, s.id into v_tipo, v_subtipo
    from public.plano_contas_tipos t
    join public.plano_contas_subtipos s on s.tipo_id = t.id
   where t.tenant_id = v_imp.tenant_id and t.codigo = v_cod_tipo and s.codigo = v_cod_subtipo;
  if v_subtipo is null then
    raise exception 'O centro de custo do imposto (% · %) não está no plano de contas.', v_cod_tipo, v_cod_subtipo;
  end if;

  v_descricao := coalesce('DARF ' || v_imp.codigo_receita, 'Guia municipal')
                 || ' · ' || v_imp.titulo || ' · ' || v_imp.rotulo_competencia
                 || coalesce(' · cota ' || v_imp.cota_numero || '/' || v_imp.cota_total, '');

  for v_r in
    select * from public.impostos_a_pagar_rateio
     where imposto_a_pagar_id = v_imp.id order by ordem
  loop
    insert into public.lancamentos_financeiros (
      tenant_id, empresa_id, regional_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      origem, imposto_a_pagar_id, criado_por
    ) values (
      v_imp.tenant_id, v_r.empresa_id, v_r.regional_id, p_conta_bancaria_id, p_pago_em, v_r.valor,
      'saida', substring(v_descricao, 1, 240), v_tipo, v_subtipo,
      'imposto_baixa', v_imp.id, v_uid
    )
    returning id into v_id;
    v_primeiro := coalesce(v_primeiro, v_id);
  end loop;
  if v_primeiro is null then
    raise exception 'Este imposto não tem rateio: corrija-o antes de dar baixa.';
  end if;

  if v_multa > 0 then
    select t.id, s.id into v_tipo_juros, v_sub_juros
      from public.plano_contas_tipos t
      join public.plano_contas_subtipos s on s.tipo_id = t.id
     where t.tenant_id = v_imp.tenant_id and t.codigo = '11' and s.codigo = '999';
    if v_sub_juros is null then
      raise exception 'O centro de custo da multa e dos juros (11 · 999) não está no plano de contas.';
    end if;
    -- A multa e os juros são deste pagamento: entram na maior parte do rateio.
    select empresa_id, regional_id into v_maior
      from public.impostos_a_pagar_rateio
     where imposto_a_pagar_id = v_imp.id
     order by valor desc, ordem
     limit 1;
    insert into public.lancamentos_financeiros (
      tenant_id, empresa_id, regional_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      origem, imposto_a_pagar_id, criado_por
    ) values (
      v_imp.tenant_id, v_maior.empresa_id, v_maior.regional_id, p_conta_bancaria_id, p_pago_em, v_multa,
      'saida', substring('Multa e juros · ' || v_descricao, 1, 240), v_tipo_juros, v_sub_juros,
      'imposto_baixa', v_imp.id, v_uid
    );
  end if;

  update public.impostos_a_pagar
     set status = 'pago',
         pago_em = p_pago_em,
         conta_bancaria_id = p_conta_bancaria_id,
         multa_juros = v_multa,
         guia_path = v_guia,
         comprovante_path = btrim(p_comprovante_path),
         baixado_por = v_uid,
         baixado_em = now()
   where id = v_imp.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_imp.tenant_id, 'imposto_a_pagar', v_imp.id::text, 'fiscal.imposto_baixado', v_uid,
          jsonb_build_object('pago_em', p_pago_em, 'conta_bancaria_id', p_conta_bancaria_id,
                             'valor', v_imp.valor, 'multa_juros', v_multa));
  return v_primeiro;
end;
$$;

-- Cancela a baixa de um imposto: apaga os lançamentos dela e reabre o título.
create or replace function public.cancelar_baixa_imposto(
  p_imposto_id  uuid,
  p_motivo      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid;
  v_imp       impostos_a_pagar%rowtype;
  v_l         record;
  v_apagados  jsonb := '[]'::jsonb;
begin
  select * into v_imp from public.impostos_a_pagar where id = p_imposto_id for update;
  if not found then raise exception 'Imposto não encontrado.'; end if;
  v_uid := public._exige_financeiro_para_baixar(v_imp.tenant_id);
  if v_imp.status <> 'pago' then
    raise exception 'Este imposto não tem baixa para cancelar.';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Explique o motivo do cancelamento em pelo menos 10 caracteres.';
  end if;

  for v_l in
    select id, valor, empresa_id, regional_id, data_movimento
      from public.lancamentos_financeiros
     where imposto_a_pagar_id = v_imp.id and estorno_de_lancamento_id is null
     for update
  loop
    v_apagados := v_apagados || jsonb_build_object(
      'id', v_l.id, 'valor', v_l.valor, 'empresa_id', v_l.empresa_id,
      'regional_id', v_l.regional_id, 'data', v_l.data_movimento,
      'estornos', public._apagar_lancamento_de_baixa(v_l.id)
    );
  end loop;

  update public.impostos_a_pagar
     set status = 'a_pagar',
         pago_em = null,
         conta_bancaria_id = null,
         multa_juros = 0,
         comprovante_path = null,
         baixado_por = null,
         baixado_em = null
   where id = v_imp.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_imp.tenant_id, 'imposto_a_pagar', v_imp.id::text, 'fiscal.imposto_baixa_cancelada', v_uid,
          jsonb_build_object('motivo', btrim(p_motivo), 'pago_em', v_imp.pago_em,
                             'conta_bancaria_id', v_imp.conta_bancaria_id,
                             'multa_juros', v_imp.multa_juros, 'lancamentos_apagados', v_apagados));
  return v_imp.id;
end;
$$;

revoke all on function public._exige_financeiro_fiscal(uuid) from public, anon;
revoke all on function public._imposto_gravar_rateio(uuid, uuid, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.aprovar_guia_fiscal(uuid, text, text, uuid, uuid, text, text, text, text, text, numeric, numeric, text, boolean, jsonb, jsonb, jsonb, jsonb, text, jsonb) from public, anon;
revoke all on function public.criar_imposto_avulso(uuid, text, text, text, uuid, uuid, text, text, text, date, numeric, jsonb, text) from public, anon;
revoke all on function public.corrigir_imposto(uuid, numeric, text, text) from public, anon;
revoke all on function public.baixar_imposto(uuid, date, uuid, numeric, text, text) from public, anon;
revoke all on function public.cancelar_baixa_imposto(uuid, text) from public, anon;

grant execute on function public._exige_financeiro_fiscal(uuid) to authenticated;
grant execute on function public.aprovar_guia_fiscal(uuid, text, text, uuid, uuid, text, text, text, text, text, numeric, numeric, text, boolean, jsonb, jsonb, jsonb, jsonb, text, jsonb) to authenticated;
grant execute on function public.criar_imposto_avulso(uuid, text, text, text, uuid, uuid, text, text, text, date, numeric, jsonb, text) to authenticated;
grant execute on function public.corrigir_imposto(uuid, numeric, text, text) to authenticated;
grant execute on function public.baixar_imposto(uuid, date, uuid, numeric, text, text) to authenticated;
grant execute on function public.cancelar_baixa_imposto(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Anexos: guia e comprovante, no bucket privado `impostos`
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('impostos', 'impostos', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy impostos_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'impostos'
         and (public.is_tenant_admin((split_part(name, '/', 1))::uuid)
              or public.is_tenant_financeiro((split_part(name, '/', 1))::uuid)));

create policy impostos_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'impostos'
              and (public.is_tenant_admin((split_part(name, '/', 1))::uuid)
                   or public.is_tenant_financeiro((split_part(name, '/', 1))::uuid)));

create policy impostos_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'impostos'
         and (public.is_tenant_admin((split_part(name, '/', 1))::uuid)
              or public.is_tenant_financeiro((split_part(name, '/', 1))::uuid)));
