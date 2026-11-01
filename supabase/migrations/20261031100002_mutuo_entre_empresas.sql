-- =====================================================================
-- Mútuo entre empresas (decisão 230 — Tiago, 31/10/2026)
-- =====================================================================
--
-- Dinheiro que muda de dono: empréstimo entre CNPJs. A transferência recusa
-- esse caso desde a decisão 124 (D4, pendente até aqui). Só entre empresas:
-- pessoa física segue no Tipo EMP da planilha, pelo avulso.
--
-- O mútuo mora em `transferencias_contas`, com `tipo = 'mutuo'` e código
-- MU-00001. É a mesma mecânica (a transferir → transferido, baixa, cancelar,
-- excluir, título em Títulos a Receber, Conciliação), com três diferenças:
--
--   * Tem empresa e plano: cada perna é Tipo 12 · 998 Mútuo interno, com
--     regional vazia (TD, como a planilha). Por isso as pernas têm origem
--     própria (`mutuo_saida`, `mutuo_entrada`) e não saem do fluxo de caixa.
--   * Pode ter uma perna só: com empresa de fora do sistema (`fornecedor_id`,
--     cadastro em Fornecedores), só a nossa conta entra.
--   * Traz o trimestre e o ano do Tipo (`MÚTUO INT 2T 2026`), que é o do mútuo
--     original e não o da data: a devolução herda, e assim (+) e (−) zeram.
--
-- Devolução é um mútuo no sentido contrário, com um saldo por par. O saldo é a
-- soma dos mútuos mais a abertura de 30/09 (`mutuos_saldo_abertura`).
--
-- A conta bancária não pertence a uma empresa (decisão 064), mas a perna
-- precisa de uma. Regra do Tiago de 28/10: California e GoCrazy entram na
-- gerencial Agência California; Hitlab, na Hitlab. Fica no cadastro do CNPJ
-- (`empresas_contabeis.empresa_gerencial_id`).
--
-- IOF (decisão 230, D6): como a planilha, por conta. California junto do mútuo
-- (Tipo 12, abaixo do lucro); GoCrazy em Custo Tributário, regional SS. Entra
-- pela linha do banco, com `mutuos_iof` guardando o mútuo a que se refere, que
-- pode ficar vazio.
--
-- Fora daqui, de propósito: a Apuração do IOF no Fiscal, o cálculo de juros (o
-- campo só informa e não lança nada) e a DRE, que só lê o histórico da planilha.
-- Valores de saldo e o cadastro da empresa de fora não entram neste arquivo:
-- o repositório é público.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------------

alter table public.empresas_contabeis
  add column if not exists empresa_gerencial_id uuid references public.empresas(id) on delete restrict,
  add column if not exists regional_padrao_id uuid references public.regionais(id) on delete restrict,
  add column if not exists iof_do_mutuo_abaixo_do_lucro boolean not null default false;

comment on column public.empresas_contabeis.empresa_gerencial_id is
  'Empresa gerencial dos lançamentos sem documento deste CNPJ, como as pernas do mútuo (decisão 230). GoCrazy não é gerencial: entra na Agência California.';
comment on column public.empresas_contabeis.regional_padrao_id is
  'Regional do que este CNPJ paga sem documento, como o IOF do mútuo. Vazia é TD. GoCrazy é SS, como a planilha.';
comment on column public.empresas_contabeis.iof_do_mutuo_abaixo_do_lucro is
  'IOF do mútuo: true fica junto do mútuo (Tipo 12), false entra em Custo Tributário. Como a planilha faz em cada conta (decisão 230).';

update public.empresas_contabeis ec
   set empresa_gerencial_id = e.id
  from public.empresas e
 where e.tenant_id = ec.tenant_id
   and ec.empresa_gerencial_id is null
   and ((ec.nome_fantasia in ('California', 'GoCrazy') and e.nome_fantasia = 'Agência California')
     or (ec.nome_fantasia = 'Hitlab' and e.nome_fantasia = 'Hitlab'));

update public.empresas_contabeis ec
   set regional_padrao_id = r.id
  from public.regionais r
 where r.tenant_id = ec.tenant_id
   and r.empresa_id = ec.empresa_gerencial_id
   and r.nome = 'SS'
   and ec.nome_fantasia = 'GoCrazy'
   and ec.regional_padrao_id is null;

update public.empresas_contabeis
   set iof_do_mutuo_abaixo_do_lucro = true
 where nome_fantasia = 'California';

alter table public.fornecedores
  add column if not exists empresa_de_fora boolean not null default false;

comment on column public.fornecedores.empresa_de_fora is
  'Empresa que faz mútuo com o grupo sem ter conta no sistema (decisão 230). Aparece nos seletores do mútuo; só a nossa perna é lançada.';

-- Os dois subtipos que o mútuo e o IOF usam: separam do empréstimo de sócio
-- (Tipo 12 · 999) e dos outros impostos.
insert into public.plano_contas_subtipos (tenant_id, tipo_id, codigo, nome)
select t.tenant_id, t.id, '998', 'Mútuo interno'
  from public.plano_contas_tipos t
 where t.codigo = '12'
   and not exists (select 1 from public.plano_contas_subtipos s where s.tipo_id = t.id and s.codigo = '998');

insert into public.plano_contas_subtipos (tenant_id, tipo_id, codigo, nome)
select t.tenant_id, t.id, '007', 'IOF do mútuo'
  from public.plano_contas_tipos t
 where t.codigo = '03'
   and not exists (select 1 from public.plano_contas_subtipos s where s.tipo_id = t.id and s.codigo = '007');

-- ---------------------------------------------------------------------
-- O mútuo
-- ---------------------------------------------------------------------

alter table public.transferencias_contas
  add column if not exists tipo text not null default 'transferencia',
  add column if not exists fornecedor_id uuid references public.fornecedores(id) on delete restrict,
  add column if not exists trimestre smallint,
  add column if not exists ano smallint,
  add column if not exists juros_ao_mes numeric(7,4);

alter table public.transferencias_contas
  alter column conta_origem_id drop not null,
  alter column conta_destino_id drop not null;

alter table public.transferencias_contas
  drop constraint if exists chk_transferencia_tipo,
  drop constraint if exists chk_transferencia_mutuo_coerente;

alter table public.transferencias_contas
  add constraint chk_transferencia_tipo check (tipo in ('transferencia', 'mutuo')),
  add constraint chk_transferencia_mutuo_coerente check (
    (
      tipo = 'transferencia'
      and conta_origem_id is not null
      and conta_destino_id is not null
      and fornecedor_id is null
      and trimestre is null
      and ano is null
      and juros_ao_mes is null
    )
    or (
      tipo = 'mutuo'
      and trimestre is not null
      and trimestre between 1 and 4
      and ano is not null
      and (juros_ao_mes is null or juros_ao_mes > 0)
      and (
        (conta_origem_id is not null and conta_destino_id is not null and fornecedor_id is null)
        or (
          fornecedor_id is not null
          and (conta_origem_id is null) <> (conta_destino_id is null)
        )
      )
    )
  );

comment on column public.transferencias_contas.tipo is
  'transferencia: o dinheiro só muda de conta. mutuo: muda de dono, entre CNPJs (decisão 230).';
comment on column public.transferencias_contas.fornecedor_id is
  'Mútuo com empresa de fora do sistema: só a nossa perna existe, e a outra conta fica vazia.';
comment on column public.transferencias_contas.trimestre is
  'Trimestre do Tipo do mútuo (MÚTUO INT 2T 2026): o do mútuo original, que a devolução herda. Não é o da data.';
comment on column public.transferencias_contas.juros_ao_mes is
  'Juros ao mês em %, opcional. Só informa: nada é lançado até o dinheiro passar pelo banco.';

create index if not exists idx_transferencias_tipo
  on public.transferencias_contas (tenant_id, tipo, status);
create index if not exists idx_transferencias_fornecedor
  on public.transferencias_contas (fornecedor_id) where fornecedor_id is not null;

-- ---------------------------------------------------------------------
-- O saldo de abertura
-- ---------------------------------------------------------------------

create table if not exists public.mutuos_saldo_abertura (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete restrict,
  credor_empresa_contabil_id  uuid not null references public.empresas_contabeis(id) on delete restrict,
  devedor_empresa_contabil_id uuid references public.empresas_contabeis(id) on delete restrict,
  devedor_fornecedor_id       uuid references public.fornecedores(id) on delete restrict,
  valor                       numeric(14,2) not null,
  data_referencia             date not null,
  trimestre                   smallint not null,
  ano                         smallint not null,
  nota                        text,
  juros_ao_mes                numeric(7,4),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint chk_abertura_valor_positivo check (valor > 0),
  constraint chk_abertura_trimestre check (trimestre between 1 and 4),
  constraint chk_abertura_juros check (juros_ao_mes is null or juros_ao_mes > 0),
  constraint chk_abertura_um_devedor check (
    (devedor_empresa_contabil_id is null) <> (devedor_fornecedor_id is null)
  ),
  constraint chk_abertura_credor_nao_e_devedor check (
    devedor_empresa_contabil_id is null or devedor_empresa_contabil_id <> credor_empresa_contabil_id
  )
);

comment on table public.mutuos_saldo_abertura is
  'Quem devia a quem na data de corte, pela planilha (decisão 230). Ponto de partida do saldo: não mexe em DRE, fluxo nem banco.';

create unique index if not exists uniq_abertura_entre_cnpjs
  on public.mutuos_saldo_abertura (tenant_id, credor_empresa_contabil_id, devedor_empresa_contabil_id)
  where devedor_empresa_contabil_id is not null;
create unique index if not exists uniq_abertura_com_empresa_de_fora
  on public.mutuos_saldo_abertura (tenant_id, credor_empresa_contabil_id, devedor_fornecedor_id)
  where devedor_fornecedor_id is not null;
create index if not exists idx_abertura_devedor_empresa
  on public.mutuos_saldo_abertura (devedor_empresa_contabil_id) where devedor_empresa_contabil_id is not null;
create index if not exists idx_abertura_devedor_fornecedor
  on public.mutuos_saldo_abertura (devedor_fornecedor_id) where devedor_fornecedor_id is not null;

drop trigger if exists trg_mutuos_saldo_abertura_updated_at on public.mutuos_saldo_abertura;
create trigger trg_mutuos_saldo_abertura_updated_at
  before update on public.mutuos_saldo_abertura
  for each row execute function public.set_updated_at();

alter table public.mutuos_saldo_abertura enable row level security;

drop policy if exists mutuos_saldo_abertura_select on public.mutuos_saldo_abertura;
create policy mutuos_saldo_abertura_select on public.mutuos_saldo_abertura
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
  );

revoke all on public.mutuos_saldo_abertura from public, anon;
grant select on public.mutuos_saldo_abertura to authenticated;

-- ---------------------------------------------------------------------
-- O IOF lançado pela linha do banco
-- ---------------------------------------------------------------------

create table if not exists public.mutuos_iof (
  lancamento_id          uuid primary key references public.lancamentos_financeiros(id) on delete cascade,
  tenant_id              uuid not null references public.tenants(id) on delete restrict,
  pagador_empresa_contabil_id uuid not null references public.empresas_contabeis(id) on delete restrict,
  com_empresa_contabil_id uuid references public.empresas_contabeis(id) on delete restrict,
  com_fornecedor_id      uuid references public.fornecedores(id) on delete restrict,
  created_at             timestamptz not null default now(),
  constraint chk_mutuos_iof_uma_parte check (
    com_empresa_contabil_id is null or com_fornecedor_id is null
  )
);

comment on table public.mutuos_iof is
  'IOF do mútuo lançado pela linha do banco (decisão 230). A outra parte é opcional: vazia, o IOF é lançado, mas não soma em nenhum mútuo.';

create index if not exists idx_mutuos_iof_tenant on public.mutuos_iof (tenant_id);
create index if not exists idx_mutuos_iof_com_empresa
  on public.mutuos_iof (com_empresa_contabil_id) where com_empresa_contabil_id is not null;
create index if not exists idx_mutuos_iof_com_fornecedor
  on public.mutuos_iof (com_fornecedor_id) where com_fornecedor_id is not null;

alter table public.mutuos_iof enable row level security;

drop policy if exists mutuos_iof_select on public.mutuos_iof;
create policy mutuos_iof_select on public.mutuos_iof
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
  );

revoke all on public.mutuos_iof from public, anon;
grant select on public.mutuos_iof to authenticated;

-- ---------------------------------------------------------------------
-- Lançamentos: a perna do mútuo
-- ---------------------------------------------------------------------
-- Cada CHECK ganha um ramo; os ramos antigos são copiados do banco para não
-- serem redigitados aqui. A perna do mútuo aponta para `transferencia_id`, mas
-- tem empresa e plano.

do $$
declare
  v_def text;
begin
  alter table public.lancamentos_financeiros drop constraint chk_lancamento_sem_empresa_so_transferencia;
  alter table public.lancamentos_financeiros
    add constraint chk_lancamento_sem_empresa_so_transferencia check (
      (
        origem in ('transferencia_saida', 'transferencia_entrada')
        and empresa_id is null
        and plano_conta_tipo_id is null
        and plano_conta_subtipo_id is null
        and transferencia_id is not null
      )
      or (
        origem = 'devolucao_bancaria'
        and empresa_id is null
        and plano_conta_tipo_id is null
        and plano_conta_subtipo_id is null
        and transferencia_id is null
      )
      or (
        origem in ('mutuo_saida', 'mutuo_entrada')
        and empresa_id is not null
        and plano_conta_tipo_id is not null
        and plano_conta_subtipo_id is not null
        and transferencia_id is not null
      )
      or (
        origem not in ('transferencia_saida', 'transferencia_entrada', 'devolucao_bancaria', 'mutuo_saida', 'mutuo_entrada')
        and empresa_id is not null
        and plano_conta_tipo_id is not null
        and plano_conta_subtipo_id is not null
        and transferencia_id is null
      )
    );

  select substring(pg_get_constraintdef(oid) from 7) into v_def
    from pg_constraint
   where conname = 'chk_origem_tem_referencia'
     and conrelid = 'public.lancamentos_financeiros'::regclass;
  alter table public.lancamentos_financeiros drop constraint chk_origem_tem_referencia;
  execute 'alter table public.lancamentos_financeiros add constraint chk_origem_tem_referencia check ('
    || v_def
    || $sql$ OR ((origem = ANY (ARRAY['mutuo_saida'::origem_lancamento, 'mutuo_entrada'::origem_lancamento]))
             AND (pedido_compra_id IS NULL) AND (conta_avulsa_id IS NULL) AND (titulo_receber_id IS NULL)
             AND (desembolso_id IS NULL) AND (pp_verba_devolucao_id IS NULL) AND (fatura_cartao_id IS NULL)
             AND (imposto_a_pagar_id IS NULL) AND (juros_de_lancamento_id IS NULL)))$sql$;

  select substring(pg_get_constraintdef(oid) from 7) into v_def
    from pg_constraint
   where conname = 'chk_origem_contraparte_tem_id'
     and conrelid = 'public.lancamentos_financeiros'::regclass;
  alter table public.lancamentos_financeiros drop constraint chk_origem_contraparte_tem_id;
  execute 'alter table public.lancamentos_financeiros add constraint chk_origem_contraparte_tem_id check ('
    || v_def
    || $sql$ OR ((origem = ANY (ARRAY['mutuo_saida'::origem_lancamento, 'mutuo_entrada'::origem_lancamento]))
             AND (transferencia_id IS NOT NULL)))$sql$;
end;
$$;

-- As duas funções que listam as origens da transferência passam a conhecer as
-- do mútuo. O corpo vem do banco para não ser redigitado aqui.
do $$
declare
  v_def  text;
  v_novo text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = '_cancelamento_da_baixa';
  v_novo := replace(
    v_def,
    $x$when 'transferencia_entrada' then jsonb_build_object('tipo', 'transferencia', 'id', p_l.transferencia_id)$x$,
    $x$when 'transferencia_entrada' then jsonb_build_object('tipo', 'transferencia', 'id', p_l.transferencia_id)
    when 'mutuo_saida' then jsonb_build_object('tipo', 'transferencia', 'id', p_l.transferencia_id)
    when 'mutuo_entrada' then jsonb_build_object('tipo', 'transferencia', 'id', p_l.transferencia_id)$x$
  );
  if v_novo = v_def then raise exception '_cancelamento_da_baixa mudou: revise esta migration.'; end if;
  execute v_novo;

  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'conciliar_linha_pelos_documentos';
  v_novo := replace(
    v_def,
    $x$l.origem in ('transferencia_saida', 'transferencia_entrada')$x$,
    $x$l.origem in ('transferencia_saida', 'transferencia_entrada', 'mutuo_saida', 'mutuo_entrada')$x$
  );
  if v_novo = v_def then raise exception 'conciliar_linha_pelos_documentos mudou: revise esta migration.'; end if;
  execute v_novo;

  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'criar_transferencia';
  v_novo := replace(
    v_def,
    'Entre CNPJs diferentes o dinheiro muda de dono, e esse caso ainda vai ser definido.',
    'Entre CNPJs diferentes é mútuo.'
  );
  if v_novo = v_def then raise exception 'criar_transferencia mudou: revise esta migration.'; end if;
  execute v_novo;
end;
$$;

-- ---------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------

create or replace function public.gerar_codigo_mutuo(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_prox integer;
begin
  perform pg_advisory_xact_lock(hashtext('mutuo_seq_' || p_tenant_id::text));
  select coalesce(max(cast(substring(codigo from '^MU-(\d+)$') as integer)), 0) + 1
    into v_prox
    from public.transferencias_contas
   where tenant_id = p_tenant_id
     and codigo ~ '^MU-\d+$';
  return 'MU-' || lpad(v_prox::text, 5, '0');
end;
$$;

revoke all on function public.gerar_codigo_mutuo(uuid) from public, anon, authenticated;

-- As partes de um mútuo, conferidas. Serve a criar e a corrigir.
create or replace function public._conferir_partes_do_mutuo(
  p_tenant_id uuid,
  p_origem uuid,
  p_destino uuid,
  p_fornecedor uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_o contas_bancarias%rowtype;
  v_d contas_bancarias%rowtype;
begin
  if p_origem is null and p_destino is null then
    raise exception 'Escolha a conta de origem e a de destino.';
  end if;
  if p_fornecedor is null and (p_origem is null or p_destino is null) then
    raise exception 'Escolha a conta de origem e a de destino.';
  end if;
  if p_fornecedor is not null and p_origem is not null and p_destino is not null then
    raise exception 'Com empresa de fora, só uma conta do grupo entra no mútuo.';
  end if;
  if p_origem = p_destino then
    raise exception 'A conta de destino precisa ser diferente da de origem.';
  end if;

  if p_origem is not null then
    select * into v_o from public.contas_bancarias where id = p_origem and tenant_id = p_tenant_id;
    if not found then raise exception 'Escolha a conta de origem.'; end if;
    if v_o.cartao_credito_id is not null then raise exception 'Mútuo é entre contas bancárias, não com o cartão.'; end if;
    if not v_o.ativo then raise exception 'Uma das contas está inativa.'; end if;
    if v_o.empresa_contabil_id is null then raise exception 'A conta % não tem CNPJ no cadastro.', v_o.nome; end if;
  end if;
  if p_destino is not null then
    select * into v_d from public.contas_bancarias where id = p_destino and tenant_id = p_tenant_id;
    if not found then raise exception 'Escolha a conta de destino.'; end if;
    if v_d.cartao_credito_id is not null then raise exception 'Mútuo é entre contas bancárias, não com o cartão.'; end if;
    if not v_d.ativo then raise exception 'Uma das contas está inativa.'; end if;
    if v_d.empresa_contabil_id is null then raise exception 'A conta % não tem CNPJ no cadastro.', v_d.nome; end if;
  end if;
  if p_origem is not null and p_destino is not null
     and v_o.empresa_contabil_id = v_d.empresa_contabil_id then
    raise exception 'Mútuo só entre CNPJs diferentes. No mesmo CNPJ é transferência entre contas.';
  end if;
  if p_fornecedor is not null and not exists (
    select 1 from public.fornecedores
     where id = p_fornecedor and tenant_id = p_tenant_id and empresa_de_fora
  ) then
    raise exception 'Esta empresa não está cadastrada como empresa de fora.';
  end if;
end;
$$;

revoke all on function public._conferir_partes_do_mutuo(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- Efetiva: uma perna por conta do grupo, na data dada. [saída, entrada], com
-- nulo no lado da empresa de fora.
create or replace function public._efetivar_mutuo(
  p_mutuo_id uuid,
  p_data date,
  p_uid uuid
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_m        transferencias_contas%rowtype;
  v_origem   contas_bancarias%rowtype;
  v_destino  contas_bancarias%rowtype;
  v_fora     text;
  v_tipo     uuid;
  v_subtipo  uuid;
  v_desc     text;
  v_empresa  uuid;
  v_saida    uuid;
  v_entrada  uuid;
begin
  select * into v_m from public.transferencias_contas
   where id = p_mutuo_id and tipo = 'mutuo' for update;
  if not found then raise exception 'Mútuo não encontrado.'; end if;
  if v_m.status <> 'a_transferir' then raise exception 'Este mútuo já foi feito.'; end if;
  if p_data is null then raise exception 'Informe a data do mútuo.'; end if;

  if v_m.conta_origem_id is not null then
    select * into v_origem from public.contas_bancarias where id = v_m.conta_origem_id;
    if not v_origem.ativo then raise exception 'Uma das contas está inativa.'; end if;
    if p_data < v_origem.saldo_inicial_data then
      raise exception 'A data do mútuo é anterior à data do saldo inicial de uma das contas.';
    end if;
  end if;
  if v_m.conta_destino_id is not null then
    select * into v_destino from public.contas_bancarias where id = v_m.conta_destino_id;
    if not v_destino.ativo then raise exception 'Uma das contas está inativa.'; end if;
    if p_data < v_destino.saldo_inicial_data then
      raise exception 'A data do mútuo é anterior à data do saldo inicial de uma das contas.';
    end if;
  end if;

  select f.nome into v_fora from public.fornecedores f where f.id = v_m.fornecedor_id;

  select t.id, s.id into v_tipo, v_subtipo
    from public.plano_contas_tipos t
    join public.plano_contas_subtipos s on s.tipo_id = t.id
   where t.tenant_id = v_m.tenant_id and t.codigo = '12' and s.codigo = '998' and s.ativo;
  if v_subtipo is null then raise exception 'O subtipo Mútuo interno não está ativo no plano de contas.'; end if;

  v_desc := 'Mútuo ' || v_m.codigo || ' · '
            || coalesce(v_origem.nome, v_fora) || ' → ' || coalesce(v_destino.nome, v_fora)
            || coalesce(' — ' || nullif(btrim(v_m.descricao), ''), '');

  if v_m.conta_origem_id is not null then
    select ec.empresa_gerencial_id into v_empresa
      from public.empresas_contabeis ec where ec.id = v_origem.empresa_contabil_id;
    if v_empresa is null then raise exception 'O CNPJ da conta % não tem empresa gerencial.', v_origem.nome; end if;

    insert into public.lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor, natureza,
      descricao, plano_conta_tipo_id, plano_conta_subtipo_id, fornecedor_id,
      transferencia_id, origem, criado_por
    ) values (
      v_m.tenant_id, v_empresa, v_origem.id, p_data, v_m.valor, 'saida',
      substring(v_desc, 1, 300), v_tipo, v_subtipo, v_m.fornecedor_id,
      v_m.id, 'mutuo_saida', p_uid
    )
    returning id into v_saida;
  end if;

  if v_m.conta_destino_id is not null then
    select ec.empresa_gerencial_id into v_empresa
      from public.empresas_contabeis ec where ec.id = v_destino.empresa_contabil_id;
    if v_empresa is null then raise exception 'O CNPJ da conta % não tem empresa gerencial.', v_destino.nome; end if;

    insert into public.lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor, natureza,
      descricao, plano_conta_tipo_id, plano_conta_subtipo_id, fornecedor_id,
      transferencia_id, origem, criado_por
    ) values (
      v_m.tenant_id, v_empresa, v_destino.id, p_data, v_m.valor, 'entrada',
      substring(v_desc, 1, 300), v_tipo, v_subtipo, v_m.fornecedor_id,
      v_m.id, 'mutuo_entrada', p_uid
    )
    returning id into v_entrada;
  end if;

  update public.transferencias_contas
     set status = 'transferida', transferida_em = p_data, transferida_por = p_uid
   where id = v_m.id;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_m.tenant_id, 'transferencia_contas', v_m.id::text,
    'mutuo.efetivado', p_uid,
    jsonb_build_object(
      'codigo', v_m.codigo, 'data', p_data, 'valor', v_m.valor,
      'conta_origem_id', v_m.conta_origem_id, 'conta_destino_id', v_m.conta_destino_id,
      'fornecedor_id', v_m.fornecedor_id, 'lancamentos', jsonb_build_array(v_saida, v_entrada)
    )
  );

  return array[v_saida, v_entrada];
end;
$$;

revoke all on function public._efetivar_mutuo(uuid, date, uuid) from public, anon, authenticated;

-- p_dados: conta_origem_id, conta_destino_id, fornecedor_id, valor,
-- data_prevista, descricao, trimestre, ano, juros_ao_mes. p_transferir = true
-- é o "Criar e dar baixa".
create or replace function public.criar_mutuo(
  p_dados jsonb,
  p_transferir boolean
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid     uuid := auth.uid();
  v_tenant  uuid;
  v_origem  uuid := nullif(p_dados->>'conta_origem_id', '')::uuid;
  v_destino uuid := nullif(p_dados->>'conta_destino_id', '')::uuid;
  v_fora    uuid := nullif(p_dados->>'fornecedor_id', '')::uuid;
  v_valor   numeric := round((p_dados->>'valor')::numeric, 2);
  v_data    date := (p_dados->>'data_prevista')::date;
  v_tri     smallint := (p_dados->>'trimestre')::smallint;
  v_ano     smallint := (p_dados->>'ano')::smallint;
  v_juros   numeric := nullif(p_dados->>'juros_ao_mes', '')::numeric;
  v_codigo  text;
  v_id      uuid;
begin
  if v_uid is null then raise exception 'Sessão inválida.'; end if;

  select tenant_id into v_tenant from public.contas_bancarias where id = coalesce(v_origem, v_destino);
  if v_tenant is null then raise exception 'Escolha a conta de origem e a de destino.'; end if;

  if not (public.is_tenant_admin(v_tenant) or public.is_tenant_financeiro(v_tenant)) then
    raise exception 'Apenas admin ou financeiro pode lançar mútuo.' using errcode = '42501';
  end if;

  perform public._conferir_partes_do_mutuo(v_tenant, v_origem, v_destino, v_fora);

  if v_valor is null or v_valor <= 0 then raise exception 'Informe o valor do mútuo.'; end if;
  if v_data is null then raise exception 'Informe a data.'; end if;
  if v_tri is null or v_ano is null then raise exception 'Informe o trimestre do mútuo.'; end if;

  v_codigo := public.gerar_codigo_mutuo(v_tenant);

  insert into public.transferencias_contas (
    tenant_id, codigo, tipo, conta_origem_id, conta_destino_id, fornecedor_id,
    valor, data_prevista, descricao, trimestre, ano, juros_ao_mes, criado_por
  ) values (
    v_tenant, v_codigo, 'mutuo', v_origem, v_destino, v_fora,
    v_valor, v_data, nullif(btrim(coalesce(p_dados->>'descricao', '')), ''),
    v_tri, v_ano, v_juros, v_uid
  )
  returning id into v_id;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_tenant, 'transferencia_contas', v_id::text, 'mutuo.criado', v_uid,
    jsonb_build_object(
      'codigo', v_codigo, 'valor', v_valor, 'data_prevista', v_data,
      'conta_origem_id', v_origem, 'conta_destino_id', v_destino, 'fornecedor_id', v_fora,
      'trimestre', v_tri, 'ano', v_ano, 'ja_transferido', coalesce(p_transferir, false)
    )
  );

  if coalesce(p_transferir, false) then
    perform public._efetivar_mutuo(v_id, v_data, v_uid);
  end if;

  return v_id;
end;
$$;

revoke all on function public.criar_mutuo(jsonb, boolean) from public, anon;
grant execute on function public.criar_mutuo(jsonb, boolean) to authenticated;

-- A baixa do título é a mesma para os dois tipos.
create or replace function public.dar_baixa_transferencia(
  p_transferencia_id uuid,
  p_data date
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tr  transferencias_contas%rowtype;
  v_uid uuid;
begin
  select * into v_tr from public.transferencias_contas where id = p_transferencia_id;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  v_uid := public._baixa_exige_financeiro(v_tr.tenant_id);
  if v_tr.tipo = 'mutuo' then
    return public._efetivar_mutuo(p_transferencia_id, p_data, v_uid);
  end if;
  return public._efetivar_transferencia(p_transferencia_id, p_data, v_uid);
end;
$$;

revoke all on function public.dar_baixa_transferencia(uuid, date) from public, anon;
grant execute on function public.dar_baixa_transferencia(uuid, date) to authenticated;

-- "Lançar mútuo" numa linha do banco: nasce feito, com a data e o valor dela, e
-- liga a linha e, se o extrato da outra conta trouxer o par, a linha do par. Se
-- houver a previsão do mesmo mútuo, é ela que fica baixada: lançar outro
-- contaria o dinheiro duas vezes.
create or replace function public.lancar_mutuo_pela_linha(
  p_dados jsonb,
  p_linha_id uuid,
  p_par_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid      uuid;
  v_linha    extrato_linhas%rowtype;
  v_par      extrato_linhas%rowtype;
  v_origem   uuid := nullif(p_dados->>'conta_origem_id', '')::uuid;
  v_destino  uuid := nullif(p_dados->>'conta_destino_id', '')::uuid;
  v_fora     uuid := nullif(p_dados->>'fornecedor_id', '')::uuid;
  v_id       uuid;
  v_previsto boolean := false;
  v_perna    uuid;
  v_codigo   text;
begin
  v_linha := public._linha_pendente(p_linha_id);
  v_uid := public._exige_financeiro_conciliacao(v_linha.tenant_id);

  if v_linha.valor < 0 and v_origem is distinct from v_linha.conta_bancaria_id then
    raise exception 'Esta linha é uma saída: a conta de origem precisa ser a da linha.';
  end if;
  if v_linha.valor > 0 and v_destino is distinct from v_linha.conta_bancaria_id then
    raise exception 'Esta linha é uma entrada: a conta de destino precisa ser a da linha.';
  end if;

  if p_par_id is not null then
    v_par := public._linha_pendente(p_par_id);
    if v_par.tenant_id <> v_linha.tenant_id or abs(v_par.valor + v_linha.valor) >= 0.005 then
      raise exception 'A linha da outra conta não tem o mesmo valor.';
    end if;
    if v_par.conta_bancaria_id is distinct from coalesce(
      case when v_linha.valor < 0 then v_destino else v_origem end, v_par.conta_bancaria_id
    ) then
      raise exception 'A linha da outra conta não é da conta escolhida.';
    end if;
  end if;

  select id into v_id
    from public.transferencias_contas
   where tenant_id = v_linha.tenant_id
     and tipo = 'mutuo'
     and status = 'a_transferir'
     and conta_origem_id is not distinct from v_origem
     and conta_destino_id is not distinct from v_destino
     and fornecedor_id is not distinct from v_fora
     and valor = abs(v_linha.valor)
   order by data_prevista, created_at
   limit 1
   for update;

  if v_id is not null then
    v_previsto := true;
  else
    v_id := public.criar_mutuo(
      p_dados || jsonb_build_object('valor', abs(v_linha.valor), 'data_prevista', v_linha.data),
      false
    );
  end if;

  perform public._efetivar_mutuo(v_id, v_linha.data, v_uid);

  select l.id into v_perna from public.lancamentos_financeiros l
   where l.transferencia_id = v_id and l.conta_bancaria_id = v_linha.conta_bancaria_id;
  perform public.conciliar_linha(p_linha_id, array[v_perna], 'ligacao', null, null);

  if p_par_id is not null then
    select l.id into v_perna from public.lancamentos_financeiros l
     where l.transferencia_id = v_id and l.conta_bancaria_id = v_par.conta_bancaria_id;
    perform public.conciliar_linha(p_par_id, array[v_perna], 'ligacao', null, null);
  end if;

  select codigo into v_codigo from public.transferencias_contas where id = v_id;
  return jsonb_build_object('id', v_id, 'codigo', v_codigo, 'previsto', v_previsto);
end;
$$;

revoke all on function public.lancar_mutuo_pela_linha(jsonb, uuid, uuid) from public, anon;
grant execute on function public.lancar_mutuo_pela_linha(jsonb, uuid, uuid) to authenticated;

-- Corrigir: o que muda as pernas tira as duas do extrato e lança de novo, e a
-- linha do banco ligada volta a pendente. Só a descrição, o trimestre e os juros
-- não mexem nas pernas.
create or replace function public.corrigir_mutuo(
  p_mutuo_id uuid,
  p_dados jsonb,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid       uuid;
  v_m         transferencias_contas%rowtype;
  v_origem    uuid := nullif(p_dados->>'conta_origem_id', '')::uuid;
  v_destino   uuid := nullif(p_dados->>'conta_destino_id', '')::uuid;
  v_fora      uuid := nullif(p_dados->>'fornecedor_id', '')::uuid;
  v_valor     numeric := round((p_dados->>'valor')::numeric, 2);
  v_data      date := (p_dados->>'data_prevista')::date;
  v_desc      text := nullif(btrim(coalesce(p_dados->>'descricao', '')), '');
  v_muda      boolean;
  v_feito     boolean;
  v_perna     record;
begin
  select * into v_m from public.transferencias_contas
   where id = p_mutuo_id and tipo = 'mutuo' for update;
  if not found then raise exception 'Mútuo não encontrado.'; end if;

  v_uid := public._baixa_exige_financeiro(v_m.tenant_id);

  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Explique o motivo da correção em pelo menos 10 caracteres.';
  end if;
  perform public._conferir_partes_do_mutuo(v_m.tenant_id, v_origem, v_destino, v_fora);
  if v_valor is null or v_valor <= 0 then raise exception 'Informe o valor do mútuo.'; end if;
  if v_data is null then raise exception 'Informe a data.'; end if;

  v_feito := v_m.status = 'transferida';
  v_muda := v_origem is distinct from v_m.conta_origem_id
         or v_destino is distinct from v_m.conta_destino_id
         or v_fora is distinct from v_m.fornecedor_id
         or v_valor <> v_m.valor
         or (v_feito and v_data is distinct from v_m.transferida_em)
         or (not v_feito and v_data is distinct from v_m.data_prevista);

  if v_feito and v_muda then
    for v_perna in
      select l.id from public.lancamentos_financeiros l where l.transferencia_id = p_mutuo_id for update
    loop
      perform public._apagar_lancamento_de_baixa(v_perna.id);
    end loop;
    update public.transferencias_contas
       set status = 'a_transferir', transferida_em = null, transferida_por = null
     where id = p_mutuo_id;
  end if;

  update public.transferencias_contas
     set conta_origem_id = v_origem,
         conta_destino_id = v_destino,
         fornecedor_id = v_fora,
         valor = v_valor,
         data_prevista = v_data,
         descricao = v_desc,
         trimestre = coalesce((p_dados->>'trimestre')::smallint, trimestre),
         ano = coalesce((p_dados->>'ano')::smallint, ano),
         juros_ao_mes = nullif(p_dados->>'juros_ao_mes', '')::numeric
   where id = p_mutuo_id;

  if v_feito and v_muda then
    perform public._efetivar_mutuo(p_mutuo_id, v_data, v_uid);
  elsif v_feito and v_desc is distinct from v_m.descricao then
    update public.lancamentos_financeiros l
       set descricao = substring(
             regexp_replace(l.descricao, ' — .*$', '') || coalesce(' — ' || v_desc, ''), 1, 300)
     where l.transferencia_id = p_mutuo_id;
  end if;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_m.tenant_id, 'transferencia_contas', v_m.id::text, 'mutuo.corrigido', v_uid,
    jsonb_build_object(
      'codigo', v_m.codigo, 'motivo', btrim(p_motivo), 'mexeu_nas_pernas', v_feito and v_muda,
      'de', jsonb_build_object('conta_origem_id', v_m.conta_origem_id, 'conta_destino_id', v_m.conta_destino_id,
                               'fornecedor_id', v_m.fornecedor_id, 'valor', v_m.valor,
                               'data', coalesce(v_m.transferida_em, v_m.data_prevista),
                               'trimestre', v_m.trimestre, 'ano', v_m.ano, 'juros_ao_mes', v_m.juros_ao_mes),
      'para', p_dados
    )
  );
end;
$$;

revoke all on function public.corrigir_mutuo(uuid, jsonb, text) from public, anon;
grant execute on function public.corrigir_mutuo(uuid, jsonb, text) to authenticated;

-- Os juros do saldo de abertura: só informam.
create or replace function public.definir_juros_da_abertura(
  p_abertura_id uuid,
  p_juros_ao_mes numeric
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid;
  v_a   mutuos_saldo_abertura%rowtype;
begin
  select * into v_a from public.mutuos_saldo_abertura where id = p_abertura_id for update;
  if not found then raise exception 'Saldo de abertura não encontrado.'; end if;
  v_uid := public._baixa_exige_financeiro(v_a.tenant_id);
  if p_juros_ao_mes is not null and p_juros_ao_mes <= 0 then
    raise exception 'Informe juros maiores que zero, ou deixe vazio.';
  end if;

  update public.mutuos_saldo_abertura set juros_ao_mes = p_juros_ao_mes where id = p_abertura_id;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_a.tenant_id, 'mutuos_saldo_abertura', v_a.id::text, 'mutuo.juros_da_abertura', v_uid,
    jsonb_build_object('de', v_a.juros_ao_mes, 'para', p_juros_ao_mes)
  );
end;
$$;

revoke all on function public.definir_juros_da_abertura(uuid, numeric) from public, anon;
grant execute on function public.definir_juros_da_abertura(uuid, numeric) to authenticated;

-- O IOF pela linha do banco: lança e concilia. O centro e a regional vêm do CNPJ
-- da conta, como a planilha. Desfazer apaga o lançamento, como o da regra.
create or replace function public.lancar_iof_do_mutuo(
  p_linha_id uuid,
  p_com_empresa_contabil_id uuid default null,
  p_com_fornecedor_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid     uuid;
  v_linha   extrato_linhas%rowtype;
  v_conta   contas_bancarias%rowtype;
  v_ec      empresas_contabeis%rowtype;
  v_cod_t   text;
  v_cod_s   text;
  v_tipo    uuid;
  v_subtipo uuid;
  v_nome    text;
  v_id      uuid;
begin
  v_linha := public._linha_pendente(p_linha_id);
  v_uid := public._exige_financeiro_conciliacao(v_linha.tenant_id);

  if v_linha.valor >= 0 then raise exception 'IOF é uma saída: esta linha é uma entrada.'; end if;
  if p_com_empresa_contabil_id is not null and p_com_fornecedor_id is not null then
    raise exception 'Escolha um mútuo só.';
  end if;

  select * into v_conta from public.contas_bancarias where id = v_linha.conta_bancaria_id;
  select * into v_ec from public.empresas_contabeis where id = v_conta.empresa_contabil_id;
  if v_ec.empresa_gerencial_id is null then
    raise exception 'O CNPJ da conta % não tem empresa gerencial.', v_conta.nome;
  end if;

  if v_ec.iof_do_mutuo_abaixo_do_lucro then
    v_cod_t := '12'; v_cod_s := '998';
  else
    v_cod_t := '03'; v_cod_s := '007';
  end if;
  select t.id, s.id into v_tipo, v_subtipo
    from public.plano_contas_tipos t
    join public.plano_contas_subtipos s on s.tipo_id = t.id
   where t.tenant_id = v_linha.tenant_id and t.codigo = v_cod_t and s.codigo = v_cod_s and s.ativo;
  if v_subtipo is null then raise exception 'O centro de custo do IOF não está ativo no plano de contas.'; end if;

  select coalesce(ec.nome_fantasia, ec.razao_social) into v_nome
    from public.empresas_contabeis ec where ec.id = p_com_empresa_contabil_id;
  if v_nome is null then
    select f.nome into v_nome from public.fornecedores f where f.id = p_com_fornecedor_id;
  end if;

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, regional_id, conta_bancaria_id, data_movimento, valor, natureza,
    descricao, plano_conta_tipo_id, plano_conta_subtipo_id, origem, extrato_linha_id, criado_por
  ) values (
    v_linha.tenant_id, v_ec.empresa_gerencial_id, v_ec.regional_padrao_id, v_linha.conta_bancaria_id,
    v_linha.data, abs(v_linha.valor), 'saida',
    'IOF do mútuo' || coalesce(' com a ' || v_nome, ''),
    v_tipo, v_subtipo, 'manual', v_linha.id, v_uid
  )
  returning id into v_id;

  insert into public.mutuos_iof (
    lancamento_id, tenant_id, pagador_empresa_contabil_id, com_empresa_contabil_id, com_fornecedor_id
  ) values (
    v_id, v_linha.tenant_id, v_ec.id, p_com_empresa_contabil_id, p_com_fornecedor_id
  );

  update public.extrato_linhas
     set conciliada_como = 'regra', conciliada_em = now(), conciliada_por = v_uid,
         desfazer = '{}'::jsonb, grupo = null, resolvida_sozinha = null
   where id = v_linha.id;

  perform public._auditar_extrato(v_linha, 'extrato.iof_do_mutuo', v_uid,
    jsonb_build_object('lancamento', v_id, 'com_empresa_contabil_id', p_com_empresa_contabil_id,
                       'com_fornecedor_id', p_com_fornecedor_id));

  return v_id;
end;
$$;

revoke all on function public.lancar_iof_do_mutuo(uuid, uuid, uuid) from public, anon;
grant execute on function public.lancar_iof_do_mutuo(uuid, uuid, uuid) to authenticated;
