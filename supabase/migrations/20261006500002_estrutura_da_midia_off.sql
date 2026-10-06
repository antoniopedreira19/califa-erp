-- =====================================================================
-- Estrutura da planilha de Mídia Off (decisão 147)
--
-- O desenho aprovado pelo Tiago em 06/10/2026 (protótipo "Planilha de
-- Mídia Off", v21) é por MÊS, com a campanha inteira, como o Always On:
-- a régua escolhe o mês, a Campanha empilha os meses. Dentro do mês,
-- um card por MEIO (TV Fechada, Rádio, OOH · Outdoor…), e cada meio tem
-- uma de duas formas de compra:
--   • grade — TV e rádio: inserções por dia do mês;
--   • período — OOH, DOOH e portais: início e fim, quantidade × períodos.
--
-- O modelo reaproveita o do mensal (decisão 078), sem tabela paralela:
--   versoes_orcamento_meses  → os meses da campanha;
--   versoes_orcamento_grupos → um grupo por meio em cada mês (mes_id), com
--                              o meio, a forma e o formato;
--   versoes_orcamento_itens  → uma linha da mídia. O ORÇADO da linha é o
--                              NEGOCIADO: valor_unitario_orcado = unitário
--                              negociado, quantidade_orcada = inserções
--                              (grade) ou quantidade (período),
--                              dias_meses_orcado = 1 (grade) ou períodos.
--                              O veículo vai em fornecedor_id, o programa
--                              ou ponto em `item`, o tipo (A · Direto ou
--                              A · Repasse) em tipo_custo.
-- O job já aponta para o grupo da versão aprovada, e o faturamento do
-- mensal já é por mês: a entrega 2 (o job) parte daqui.
--
-- A CONTA da mídia é outra (veículo = % do negociado; honorários sobre o
-- negociado ou sobre o líquido do veículo; imposto de dentro dos
-- honorários) e mora em código próprio (lib/calculos/midia-off.ts). Aqui
-- ficam só os dois parâmetros que ela pede na versão.
--
-- O VEÍCULO é um fornecedor (é ele que recebe o PI, emite a nota e, no
-- A · Repasse, recebe a PP), com os meios que vende e a praça. Para não
-- mexer em `fornecedores` — tabela de outro módulo —, esses dados ficam
-- numa tabela própria, `veiculos_midia`, uma linha por fornecedor.
--
-- A trava "meses no mesmo trimestre" (decisão 078) deixa de valer para a
-- Mídia Off: a campanha inteira é um orçamento só. Para Fee e Always On
-- nada muda.
--
-- Tudo aditivo: colunas novas nulas ou com padrão, tabela nova, funções
-- novas, e a função do trimestre ganha só a exceção da Mídia Off. Nenhum
-- dado é reescrito.
-- =====================================================================

-- 1) Parâmetros da conta na versão -----------------------------------
alter table public.versoes_orcamento
  add column if not exists percentual_veiculo numeric(6,3) not null default 80,
  add column if not exists base_honorarios text not null default 'negociado';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'versoes_orcamento_percentual_veiculo_valido') then
    alter table public.versoes_orcamento
      add constraint versoes_orcamento_percentual_veiculo_valido
      check (percentual_veiculo >= 0 and percentual_veiculo <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'versoes_orcamento_base_honorarios_valida') then
    alter table public.versoes_orcamento
      add constraint versoes_orcamento_base_honorarios_valida
      check (base_honorarios in ('negociado', 'liquido'));
  end if;
end$$;

comment on column public.versoes_orcamento.percentual_veiculo is
  'Só Mídia Off: parte do negociado que fica com o veículo (nota do veículo), em %. 80 nas planilhas de referência. Decisão 147.';
comment on column public.versoes_orcamento.base_honorarios is
  'Só Mídia Off: sobre o que correm os honorários — ''negociado'' (padrão) ou ''liquido'' (a nota do veículo, como no contrato da AMBEV). Decisão 147.';

-- 2) O meio no grupo --------------------------------------------------
alter table public.versoes_orcamento_grupos
  add column if not exists meio text,
  add column if not exists forma_compra text,
  add column if not exists formato text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'grupos_forma_compra_valida') then
    alter table public.versoes_orcamento_grupos
      add constraint grupos_forma_compra_valida
      check (forma_compra is null or forma_compra in ('grade', 'periodo'));
  end if;
  -- Meio e forma andam juntos: ou o grupo é de mídia (os dois), ou não é.
  if not exists (select 1 from pg_constraint where conname = 'grupos_meio_e_forma_juntos') then
    alter table public.versoes_orcamento_grupos
      add constraint grupos_meio_e_forma_juntos
      check ((meio is null) = (forma_compra is null));
  end if;
end$$;

comment on column public.versoes_orcamento_grupos.meio is
  'Só Mídia Off: o meio do grupo (TV Fechada, Rádio, OOH · Outdoor…). O nome do grupo é "meio · formato", único por mês — meio e formato identificam o meio na versão. Decisão 147.';
comment on column public.versoes_orcamento_grupos.forma_compra is
  'Só Mídia Off: ''grade'' (inserções por dia — TV e rádio) ou ''periodo'' (início e fim, quantidade × períodos). Decisão 147.';
comment on column public.versoes_orcamento_grupos.formato is
  'Só Mídia Off: o formato do meio (Filme 30", 9 x 3 m (lona)…). As linhas novas nascem com ele. Decisão 147.';

-- 3) A linha da mídia -------------------------------------------------
alter table public.versoes_orcamento_itens
  add column if not exists praca text,
  add column if not exists peca text,
  add column if not exists formato text,
  add column if not exists insercoes_por_dia jsonb,
  add column if not exists data_inicio date,
  add column if not exists data_fim date,
  add column if not exists unidade_periodo text,
  add column if not exists valor_unitario_tabela numeric(14,4),
  add column if not exists percentual_desconto numeric(7,4),
  add column if not exists detalhe text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'itens_insercoes_por_dia_objeto') then
    alter table public.versoes_orcamento_itens
      add constraint itens_insercoes_por_dia_objeto
      check (insercoes_por_dia is null or jsonb_typeof(insercoes_por_dia) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'itens_periodo_em_ordem') then
    alter table public.versoes_orcamento_itens
      add constraint itens_periodo_em_ordem
      check (data_inicio is null or data_fim is null or data_fim >= data_inicio);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'itens_valor_tabela_nao_negativo') then
    alter table public.versoes_orcamento_itens
      add constraint itens_valor_tabela_nao_negativo
      check (valor_unitario_tabela is null or valor_unitario_tabela >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'itens_desconto_valido') then
    alter table public.versoes_orcamento_itens
      add constraint itens_desconto_valido
      check (percentual_desconto is null or (percentual_desconto >= 0 and percentual_desconto <= 100));
  end if;
end$$;

comment on column public.versoes_orcamento_itens.praca is 'Só Mídia Off: a praça da linha (Nacional, Belém/PA…). Decisão 147.';
comment on column public.versoes_orcamento_itens.peca is 'Só Mídia Off, grade: a peça (A, B…). Decisão 147.';
comment on column public.versoes_orcamento_itens.formato is 'Só Mídia Off: o formato da linha; nasce com o do meio. Decisão 147.';
comment on column public.versoes_orcamento_itens.insercoes_por_dia is
  'Só Mídia Off, grade: inserções por dia do mês do grupo, {"dia": quantidade}. A quantidade orçada é a soma (trigger). Decisão 147.';
comment on column public.versoes_orcamento_itens.data_inicio is 'Só Mídia Off, período: início da veiculação. A linha é do mês do grupo, não do início. Decisão 147.';
comment on column public.versoes_orcamento_itens.data_fim is 'Só Mídia Off, período: fim da veiculação; pode passar do mês. Decisão 147.';
comment on column public.versoes_orcamento_itens.unidade_periodo is 'Só Mídia Off, período: o que é um período (mês, bissemanas…). Decisão 147.';
comment on column public.versoes_orcamento_itens.valor_unitario_tabela is
  'Só Mídia Off: unitário de tabela do veículo. O negociado (valor_unitario_orcado) é tabela × (1 − desconto), ou digitado. Decisão 147.';
comment on column public.versoes_orcamento_itens.percentual_desconto is 'Só Mídia Off: desconto sobre a tabela, em %. Decisão 147.';
comment on column public.versoes_orcamento_itens.detalhe is
  'Só Mídia Off: dado do veículo que não entra na conta (faces, inserções, impacto, população). Decisão 147.';

-- Na grade, a quantidade orçada é a soma das inserções por dia — no
-- banco, para que nenhuma tela ou importação a deixe divergir. Dispara
-- também quando alguém escreve a quantidade direto: ela volta à soma.
-- O nome (trg_midia_…) roda antes de trg_planejado_espelha_orcado, que
-- então já vê a quantidade certa.
create or replace function public.midia_quantidade_da_grade()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_total numeric := 0;
  v record;
begin
  if new.insercoes_por_dia is null then
    return new;
  end if;
  for v in select key, value from jsonb_each(new.insercoes_por_dia) loop
    if jsonb_typeof(v.value) <> 'number' or (v.value)::text::numeric < 0
       or (v.value)::text::numeric <> trunc((v.value)::text::numeric)
       or v.key !~ '^[0-9]{1,2}$' or v.key::int < 1 or v.key::int > 31 then
      raise exception 'Inserções por dia inválidas: dia %, valor %.', v.key, v.value
        using errcode = 'check_violation';
    end if;
    v_total := v_total + (v.value)::text::numeric;
  end loop;
  new.quantidade_orcada := v_total;
  new.dias_meses_orcado := 1;
  return new;
end;
$$;

drop trigger if exists trg_midia_quantidade_da_grade on public.versoes_orcamento_itens;
create trigger trg_midia_quantidade_da_grade
  before insert or update of insercoes_por_dia, quantidade_orcada, dias_meses_orcado
  on public.versoes_orcamento_itens
  for each row execute function public.midia_quantidade_da_grade();

-- 4) Veículos ---------------------------------------------------------
create table if not exists public.veiculos_midia (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  fornecedor_id uuid not null references public.fornecedores(id) on delete cascade,
  -- Os meios que o veículo vende; o primeiro é o principal.
  meios text[] not null,
  praca text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint veiculos_midia_um_por_fornecedor unique (fornecedor_id),
  constraint veiculos_midia_com_meio check (cardinality(meios) > 0)
);

create index if not exists idx_veiculos_midia_tenant on public.veiculos_midia(tenant_id);

drop trigger if exists trg_veiculos_midia_updated_at on public.veiculos_midia;
create trigger trg_veiculos_midia_updated_at
  before update on public.veiculos_midia
  for each row execute function public.set_updated_at();

alter table public.veiculos_midia enable row level security;

drop policy if exists veiculos_midia_select on public.veiculos_midia;
create policy veiculos_midia_select on public.veiculos_midia
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists veiculos_midia_insert on public.veiculos_midia;
create policy veiculos_midia_insert on public.veiculos_midia
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists veiculos_midia_update on public.veiculos_midia;
create policy veiculos_midia_update on public.veiculos_midia
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists veiculos_midia_delete on public.veiculos_midia;
create policy veiculos_midia_delete on public.veiculos_midia
  for delete to authenticated
  using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.veiculos_midia to authenticated;

comment on table public.veiculos_midia is
  'Fornecedores que são veículos de mídia: os meios que vendem (o primeiro é o principal) e a praça. A lista de veículos da planilha de Mídia Off sai daqui. Decisão 147.';

-- 5) Meses: a campanha inteira na Mídia Off ---------------------------
create or replace function public.versoes_orcamento_meses_mesmo_trimestre()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Mídia Off (decisão 147): um orçamento cobre a campanha inteira, em
  -- quantos meses ela tiver. A trava do trimestre é de Fee e Always On.
  if exists (
    select 1
      from public.versoes_orcamento v
      join public.orcamentos o on o.id = v.orcamento_id
      join public.categorias_dominio c on c.id = o.categoria_id
     where v.id = new.versao_orcamento_id
       and c.modelo_planilha = 'midia_off'
  ) then
    return new;
  end if;

  if exists (
    select 1
      from public.versoes_orcamento_meses m
     where m.versao_orcamento_id = new.versao_orcamento_id
       and m.id <> new.id
       and (extract(year from m.mes) <> extract(year from new.mes)
            or extract(quarter from m.mes) <> extract(quarter from new.mes))
  ) then
    raise exception
      'Os meses de uma versão precisam ficar no mesmo trimestre.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- 6) Funções da planilha ---------------------------------------------
-- Todas SECURITY INVOKER: a RLS e as travas de "só leitura" valem como em
-- qualquer escrita. Status da versão e permissão são conferidos na action.

-- Linha nova, em branco, no fim do meio.
create or replace function public.midia_nova_linha(
  p_grupo_id uuid,
  p_praca text default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  g record;
  v_ordem integer;
  v_id uuid;
  v_mes date;
begin
  select gr.id, gr.tenant_id, gr.versao_orcamento_id, gr.forma_compra, gr.formato, m.mes
    into g
    from versoes_orcamento_grupos gr
    left join versoes_orcamento_meses m on m.id = gr.mes_id
   where gr.id = p_grupo_id;
  if g.id is null or g.forma_compra is null then
    raise exception 'Meio não encontrado.' using errcode = 'no_data_found';
  end if;
  v_mes := g.mes;

  -- A ordem é global na versão (decisão 104): a linha entra logo depois
  -- da última do meio, e as de depois andam uma casa.
  select coalesce(max(ordem), 0) into v_ordem
    from versoes_orcamento_itens where grupo_id = p_grupo_id;
  if v_ordem = 0 then
    select coalesce(max(ordem), 0) into v_ordem
      from versoes_orcamento_itens where versao_orcamento_id = g.versao_orcamento_id;
  else
    update versoes_orcamento_itens
       set ordem = ordem + 1
     where versao_orcamento_id = g.versao_orcamento_id and ordem > v_ordem;
  end if;

  insert into versoes_orcamento_itens (
    tenant_id, versao_orcamento_id, grupo_id, ordem, item, tipo_custo,
    valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
    praca, peca, formato, insercoes_por_dia,
    data_inicio, data_fim, unidade_periodo,
    valor_unitario_tabela, percentual_desconto
  ) values (
    g.tenant_id, g.versao_orcamento_id, p_grupo_id, v_ordem + 1, '', 'A',
    0, 1, 1,
    nullif(trim(coalesce(p_praca, '')), ''),
    case when g.forma_compra = 'grade' then 'A' end,
    g.formato,
    case when g.forma_compra = 'grade' then '{}'::jsonb end,
    case when g.forma_compra = 'periodo' then v_mes end,
    case when g.forma_compra = 'periodo' then (v_mes + interval '1 month' - interval '1 day')::date end,
    case when g.forma_compra = 'periodo' then 'mês' end,
    0, 0
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Meio novo num mês: o meio que já existe no mês com o mesmo meio e
-- formato ganha uma linha; senão o grupo nasce, com uma linha.
create or replace function public.midia_criar_meio(
  p_versao_id uuid,
  p_mes_id uuid,
  p_meio text,
  p_forma text,
  p_formato text,
  p_praca text default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_tenant uuid;
  v_grupo uuid;
  v_formato text := coalesce(nullif(trim(p_formato), ''), '—');
  v_ordem integer;
begin
  select tenant_id into v_tenant
    from versoes_orcamento_meses
   where id = p_mes_id and versao_orcamento_id = p_versao_id;
  if v_tenant is null then
    raise exception 'Mês não encontrado nesta versão.' using errcode = 'no_data_found';
  end if;
  if p_forma not in ('grade', 'periodo') or trim(coalesce(p_meio, '')) = '' then
    raise exception 'Meio inválido.' using errcode = 'check_violation';
  end if;

  select id into v_grupo
    from versoes_orcamento_grupos
   where mes_id = p_mes_id
     and lower(meio) = lower(trim(p_meio))
     and lower(coalesce(formato, '—')) = lower(v_formato);

  if v_grupo is null then
    select coalesce(max(ordem), 0) + 1 into v_ordem
      from versoes_orcamento_grupos where versao_orcamento_id = p_versao_id;
    insert into versoes_orcamento_grupos (
      tenant_id, versao_orcamento_id, nome, ordem, mes_id, meio, forma_compra, formato
    ) values (
      v_tenant, p_versao_id, trim(p_meio) || ' · ' || v_formato, v_ordem, p_mes_id,
      trim(p_meio), p_forma, v_formato
    )
    returning id into v_grupo;
  end if;

  perform public.midia_nova_linha(v_grupo, p_praca);
  return v_grupo;
end;
$$;

-- Editar o meio (lápis do título). Meio igual: só o formato muda, e as
-- linhas que usavam o formato antigo acompanham. Meio diferente: as
-- linhas do meio saem, EM TODOS OS MESES, e cada mês fica com uma linha
-- em branco — a tela pergunta antes ("Trocar o meio?").
create or replace function public.midia_editar_meio(
  p_versao_id uuid,
  p_meio text,
  p_formato text,
  p_meio_novo text,
  p_forma_nova text,
  p_formato_novo text
)
returns integer
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_formato text := coalesce(nullif(trim(p_formato), ''), '—');
  v_formato_novo text := coalesce(nullif(trim(p_formato_novo), ''), '—');
  v_grupos uuid[];
  v_apagadas integer := 0;
  g uuid;
begin
  select array_agg(id) into v_grupos
    from versoes_orcamento_grupos
   where versao_orcamento_id = p_versao_id
     and lower(meio) = lower(trim(p_meio))
     and lower(coalesce(formato, '—')) = lower(v_formato);
  if v_grupos is null then
    raise exception 'Meio não encontrado nesta versão.' using errcode = 'no_data_found';
  end if;
  if p_forma_nova not in ('grade', 'periodo') or trim(coalesce(p_meio_novo, '')) = '' then
    raise exception 'Meio inválido.' using errcode = 'check_violation';
  end if;

  if lower(trim(p_meio_novo)) = lower(trim(p_meio)) then
    update versoes_orcamento_itens
       set formato = v_formato_novo
     where grupo_id = any(v_grupos)
       and lower(coalesce(formato, '—')) = lower(v_formato);
    update versoes_orcamento_grupos
       set formato = v_formato_novo,
           nome = trim(p_meio_novo) || ' · ' || v_formato_novo
     where id = any(v_grupos);
    return 0;
  end if;

  delete from versoes_orcamento_itens where grupo_id = any(v_grupos);
  get diagnostics v_apagadas = row_count;

  update versoes_orcamento_grupos
     set meio = trim(p_meio_novo),
         forma_compra = p_forma_nova,
         formato = v_formato_novo,
         nome = trim(p_meio_novo) || ' · ' || v_formato_novo
   where id = any(v_grupos);

  foreach g in array v_grupos loop
    perform public.midia_nova_linha(g, null);
  end loop;
  return v_apagadas;
end;
$$;

-- Duplicar linha: a cópia entra logo abaixo da original.
create or replace function public.midia_duplicar_linha(p_item_id uuid)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  i record;
  v_id uuid;
begin
  select * into i from versoes_orcamento_itens where id = p_item_id;
  if i.id is null then
    raise exception 'Linha não encontrada.' using errcode = 'no_data_found';
  end if;

  update versoes_orcamento_itens
     set ordem = ordem + 1
   where versao_orcamento_id = i.versao_orcamento_id and ordem > i.ordem;

  insert into versoes_orcamento_itens (
    tenant_id, versao_orcamento_id, grupo_id, ordem, item, tipo_custo, categoria_id,
    valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
    fornecedor_id, observacoes,
    praca, peca, formato, insercoes_por_dia, data_inicio, data_fim, unidade_periodo,
    valor_unitario_tabela, percentual_desconto, detalhe
  ) values (
    i.tenant_id, i.versao_orcamento_id, i.grupo_id, i.ordem + 1, i.item, i.tipo_custo, i.categoria_id,
    i.valor_unitario_orcado, i.quantidade_orcada, i.dias_meses_orcado,
    i.fornecedor_id, i.observacoes,
    i.praca, i.peca, i.formato, i.insercoes_por_dia, i.data_inicio, i.data_fim, i.unidade_periodo,
    i.valor_unitario_tabela, i.percentual_desconto, i.detalhe
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Copiar linhas de outro mês (só para mês vazio, como no mensal). TV e
-- rádio vêm sem inserções — os dias da semana mudam de um mês para o
-- outro, e o PM refaz a grade a cada mês; as linhas por período levam as
-- datas para o mês novo (o dia fica, cortado no fim do mês).
create or replace function public.midia_copiar_mes(
  p_origem_mes_id uuid,
  p_destino_mes_id uuid
)
returns integer
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_versao uuid;
  v_versao_destino uuid;
  v_tenant uuid;
  v_mes_origem date;
  v_mes_destino date;
  v_meses integer;
  v_ordem_grupo integer;
  v_ordem_item integer;
  v_novo uuid;
  v_n integer;
  v_qtd integer := 0;
  g record;
begin
  select versao_orcamento_id, tenant_id, mes into v_versao, v_tenant, v_mes_origem
    from versoes_orcamento_meses where id = p_origem_mes_id;
  select versao_orcamento_id, mes into v_versao_destino, v_mes_destino
    from versoes_orcamento_meses where id = p_destino_mes_id;

  if v_versao is null or v_versao_destino is null then
    raise exception 'Mês não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_versao <> v_versao_destino then
    raise exception 'Os dois meses precisam ser da mesma versão.' using errcode = 'check_violation';
  end if;
  if p_origem_mes_id = p_destino_mes_id then
    raise exception 'Escolha um mês diferente do atual.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from versoes_orcamento_grupos where mes_id = p_destino_mes_id) then
    raise exception 'O mês de destino já tem linhas. Só é possível copiar para um mês vazio.'
      using errcode = 'check_violation';
  end if;

  v_meses := (extract(year from v_mes_destino) * 12 + extract(month from v_mes_destino))::int
           - (extract(year from v_mes_origem) * 12 + extract(month from v_mes_origem))::int;

  select coalesce(max(ordem), 0) into v_ordem_grupo
    from versoes_orcamento_grupos where versao_orcamento_id = v_versao;
  select coalesce(max(ordem), 0) into v_ordem_item
    from versoes_orcamento_itens where versao_orcamento_id = v_versao;

  for g in
    select id, nome, meio, forma_compra, formato
      from versoes_orcamento_grupos
     where mes_id = p_origem_mes_id
     order by ordem
  loop
    v_ordem_grupo := v_ordem_grupo + 1;
    insert into versoes_orcamento_grupos (
      tenant_id, versao_orcamento_id, nome, ordem, mes_id, meio, forma_compra, formato
    ) values (
      v_tenant, v_versao, g.nome, v_ordem_grupo, p_destino_mes_id, g.meio, g.forma_compra, g.formato
    )
    returning id into v_novo;

    insert into versoes_orcamento_itens (
      tenant_id, versao_orcamento_id, grupo_id, ordem, item, tipo_custo, categoria_id,
      valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
      fornecedor_id, observacoes,
      praca, peca, formato, insercoes_por_dia, data_inicio, data_fim, unidade_periodo,
      valor_unitario_tabela, percentual_desconto, detalhe
    )
    select v_tenant, v_versao, v_novo,
           v_ordem_item + row_number() over (order by i.ordem),
           i.item, i.tipo_custo, i.categoria_id,
           i.valor_unitario_orcado, i.quantidade_orcada, i.dias_meses_orcado,
           i.fornecedor_id, i.observacoes,
           i.praca, i.peca, i.formato,
           case when i.insercoes_por_dia is not null then '{}'::jsonb end,
           (i.data_inicio + make_interval(months => v_meses))::date,
           (i.data_fim + make_interval(months => v_meses))::date,
           i.unidade_periodo,
           i.valor_unitario_tabela, i.percentual_desconto, i.detalhe
      from versoes_orcamento_itens i
     where i.grupo_id = g.id;

    get diagnostics v_n = row_count;
    v_ordem_item := v_ordem_item + v_n;
    v_qtd := v_qtd + v_n;
  end loop;

  return v_qtd;
end;
$$;

-- Inserções de várias linhas de uma vez (arrastar sobre os dias e
-- digitar o número): [{"id": "...", "insercoes": {"3": 2, "4": 2}}].
create or replace function public.midia_gravar_insercoes(
  p_versao_id uuid,
  p_linhas jsonb
)
returns integer
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_n integer;
begin
  update versoes_orcamento_itens i
     set insercoes_por_dia = l.insercoes
    from (
      select (x->>'id')::uuid as id, x->'insercoes' as insercoes
        from jsonb_array_elements(p_linhas) x
    ) l
   where i.id = l.id
     and i.versao_orcamento_id = p_versao_id
     and i.insercoes_por_dia is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Funções nascem executáveis por PUBLIC: fecha para todos e abre só para
-- quem está logado.
revoke execute on function public.midia_nova_linha(uuid, text) from public, anon;
revoke execute on function public.midia_criar_meio(uuid, uuid, text, text, text, text) from public, anon;
revoke execute on function public.midia_editar_meio(uuid, text, text, text, text, text) from public, anon;
revoke execute on function public.midia_duplicar_linha(uuid) from public, anon;
revoke execute on function public.midia_copiar_mes(uuid, uuid) from public, anon;
revoke execute on function public.midia_gravar_insercoes(uuid, jsonb) from public, anon;
grant execute on function public.midia_nova_linha(uuid, text) to authenticated;
grant execute on function public.midia_criar_meio(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.midia_editar_meio(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.midia_duplicar_linha(uuid) to authenticated;
grant execute on function public.midia_copiar_mes(uuid, uuid) to authenticated;
grant execute on function public.midia_gravar_insercoes(uuid, jsonb) to authenticated;
