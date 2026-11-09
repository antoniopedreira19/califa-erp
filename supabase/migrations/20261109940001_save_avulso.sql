-- =============================================================================
-- Decisão 247 — Save avulso: o save faturado sem job, crédito do cliente
-- =============================================================================
--
-- O cliente paga agora por um serviço que ainda não tem job. O financeiro
-- emite a nota no Contas a Receber (Faturar → "Save avulso") e o valor vira
-- crédito do cliente, consumido depois nas linhas dos jobs dele — como o
-- saldo de save de um job (decisões 028, 099, 154 e 155). Protótipo
-- aprovado pelo Tiago em 09/11/2026 (https://claude.ai/artifact/9BCJA12mG18xN5rp7fib9P).
--
-- As regras (Tiago, 04 e 09/11/2026):
--   * o crédito é o PRINCIPAL da nota, como o saldo de save de job:
--       crédito = NF × (1 − imposto) ÷ (1 + honorários)
--     com os honorários do cadastro do cliente (editáveis) e a alíquota de
--     imposto escolhida no Faturar;
--   * vale assim que a NF é emitida, sem esperar o recebimento;
--   * qualquer job do mesmo cliente consome;
--   * o consumo pode ser parcial, em várias linhas e vários jobs, até zerar;
--   * o consumo segue o save de hoje: rascunho reserva e não segura saldo
--     (028), a versão aprovada e a linha do job seguram, e o pedido é
--     aprovado com a abertura do job (155);
--   * o save avulso tem nome dado pelo financeiro, e é por ele que aparece.
--
-- O que muda no banco:
--   1. `saves_avulsos`: o crédito, um por nota. Só leitura para o cliente;
--      nasce pela RPC `emitir_faturamento_save_avulso`, junto com a nota,
--      numa transação só.
--   2. Subtipo novo "Save" (001) no 01 · Receita, em cada tenant.
--   3. `saves_consumos.save_avulso_id`: a outra origem possível do consumo.
--      `job_origem_id` deixa de ser obrigatório; exatamente uma das duas
--      origens é preenchida (`chk_save_consumo_uma_origem`).
--   4. `versoes_orcamento.save_consumo_avulso_id`: o orçamento inteiro que
--      consome um save avulso (154), excludente com os outros dois modos.
--   5. As funções do save que liam a origem passam a reconhecer as duas, e
--      os pedidos de aprovação (`saves_aprovacoes.origens`) levam a chave
--      `save_avulso_id` no lugar de `job_origem_id` quando é o caso.
--   6. A nota do save avulso não se cancela depois de consumida.
--
-- O que ficou de fora, de propósito:
--   * A nota sai como AVULSA (item `avulso`, sem origem), e não como item
--     `save`: o item `save` é a parte de save da nota de um JOB, e a
--     `vw_fluxo_caixa`, o rateio da 102 e a rentabilidade da 103 leem o
--     `origem_id` dele como o job de origem. Para o caixa e o DRE ela é uma
--     receita avulsa (01 · Receita · Save).
--   * A receita do save avulso NÃO migra para o job que consome na
--     `vw_job_rentabilidade` nem na `vw_fluxo_caixa` (que fazem isso para o
--     save de job, decisões 028 §4 e 103). As duas views são relatórios de
--     outra frente; mexer nelas pede decisão do Tiago.
-- =============================================================================

-- ----------------------------------------------------------------- 1. tabela
create table if not exists public.saves_avulsos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  faturamento_id        uuid not null unique references public.faturamentos(id) on delete restrict,
  cliente_id            uuid not null references public.clientes(id) on delete restrict,
  empresa_id            uuid references public.empresas(id) on delete restrict,
  nome                  text not null,
  numero_nf             text,
  data_emissao          date,
  valor_nf              numeric(14,2) not null,
  percentual_honorarios numeric(6,2) not null,
  percentual_imposto    numeric(10,6) not null,
  -- O principal da nota: o que o cliente tem a gastar.
  credito               numeric(14,2) generated always as (
    round(valor_nf * (1 - percentual_imposto / 100) / (1 + percentual_honorarios / 100), 2)
  ) stored,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint chk_save_avulso_nome check (char_length(btrim(nome)) > 0),
  constraint chk_save_avulso_valor check (valor_nf > 0),
  constraint chk_save_avulso_honorarios check (percentual_honorarios >= 0 and percentual_honorarios < 1000),
  constraint chk_save_avulso_imposto check (percentual_imposto >= 0 and percentual_imposto < 100)
);

comment on table public.saves_avulsos is
  'Decisão 247: o save avulso, faturado sem job pelo financeiro. O crédito (principal da nota) é do cliente e é consumido nas linhas dos jobs dele, como o saldo de save de um job. Só leitura para o cliente: nasce por emitir_faturamento_save_avulso.';

create index if not exists idx_saves_avulsos_tenant on public.saves_avulsos(tenant_id);
create index if not exists idx_saves_avulsos_cliente on public.saves_avulsos(cliente_id);

alter table public.saves_avulsos enable row level security;

drop policy if exists saves_avulsos_select on public.saves_avulsos;
create policy saves_avulsos_select on public.saves_avulsos
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

revoke all on public.saves_avulsos from anon, public;
grant select on public.saves_avulsos to authenticated;

-- ------------------------------------------------------- 2. subtipo "Save"
insert into public.plano_contas_subtipos (tenant_id, tipo_id, codigo, nome, ativo)
select t.tenant_id, t.id, '001', 'Save', true
  from public.plano_contas_tipos t
 where t.codigo = '01'
   and not exists (
     select 1 from public.plano_contas_subtipos s
      where s.tipo_id = t.id and (s.codigo = '001' or s.nome = 'Save'));

-- ------------------------------------------------- 3. a origem do consumo
alter table public.saves_consumos
  add column if not exists save_avulso_id uuid references public.saves_avulsos(id) on delete restrict;

alter table public.saves_consumos alter column job_origem_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_save_consumo_uma_origem') then
    alter table public.saves_consumos
      add constraint chk_save_consumo_uma_origem
      check ((job_origem_id is null) <> (save_avulso_id is null));
  end if;
end $$;

create index if not exists idx_save_consumo_avulso on public.saves_consumos(save_avulso_id)
  where save_avulso_id is not null;

comment on column public.saves_consumos.save_avulso_id is
  'Decisão 247: o save avulso de onde sai o consumo. Exatamente uma origem por consumo: job_origem_id ou save_avulso_id.';

-- -------------------------------------- 4. o orçamento inteiro que consome
alter table public.versoes_orcamento
  add column if not exists save_consumo_avulso_id uuid references public.saves_avulsos(id) on delete restrict;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_versao_save_um_modo_avulso') then
    alter table public.versoes_orcamento
      add constraint chk_versao_save_um_modo_avulso
      check (save_consumo_avulso_id is null
             or (not save_por_padrao and save_consumo_job_id is null));
  end if;
end $$;

create index if not exists versoes_orcamento_save_consumo_avulso_idx
  on public.versoes_orcamento(save_consumo_avulso_id)
  where save_consumo_avulso_id is not null;

comment on column public.versoes_orcamento.save_consumo_avulso_id is
  'Decisão 247: o save avulso cujo crédito a versão inteira consome (o modo "consumir" da decisão 154). Excludente com save_por_padrao e save_consumo_job_id.';

-- ------------------------------------------------- 5. as contas do saldo

-- A nota do save avulso está emitida? Fora da RLS: quem consome (GP,
-- produtor) não lê `faturamentos`.
create or replace function public.save_avulso_emitido(p_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.saves_avulsos s
      join public.faturamentos f on f.id = s.faturamento_id
     where s.id = p_id and f.status = 'emitido');
$$;

-- O uso do crédito, linha a linha: a mesma conta de `save_uso_linhas`
-- (gravado que segura saldo + pedidos aprovados e aguardando), pela chave
-- do save avulso.
create or replace function public.save_avulso_uso_linhas(p_save_avulso_id uuid)
returns table(job_item_orcado_id uuid, item_versao_id uuid, consumido numeric, usado numeric)
language sql stable security definer
set search_path to 'public'
as $$
  with gravado as (
    select c.job_item_orcado_id, c.item_versao_id, sum(c.valor) as valor
      from public.saves_consumos c
      left join public.jobs_itens_orcado o on o.id = c.job_item_orcado_id
      left join public.jobs j on j.id = o.job_id
     where c.save_avulso_id = p_save_avulso_id
       and (
         (c.job_item_orcado_id is not null and j.status <> 'cancelado')
         or (c.job_item_orcado_id is null
             and c.substituido_em is null
             and exists (
               select 1
                 from public.versoes_orcamento_itens i
                 join public.versoes_orcamento v on v.id = i.versao_orcamento_id
                where i.id = c.item_versao_id
                  and v.status = 'aprovada'))
       )
     group by c.job_item_orcado_id, c.item_versao_id
  ), pedido as (
    select a.job_item_orcado_id,
           sum((e->>'valor')::numeric) filter (where a.situacao = 'aprovado') as aprovado,
           sum((e->>'valor')::numeric) filter (where a.situacao = 'aguardando') as aguardando
      from public.saves_aprovacoes a
      join public.jobs j on j.id = a.job_id
      cross join lateral jsonb_array_elements(a.origens) e
     where a.tipo = 'consome'
       and a.situacao in ('aprovado', 'aguardando')
       and a.job_item_orcado_id is not null
       and j.status <> 'cancelado'
       and (e->>'save_avulso_id')::uuid = p_save_avulso_id
     group by a.job_item_orcado_id
  )
  select coalesce(g.job_item_orcado_id, p.job_item_orcado_id),
         g.item_versao_id,
         (coalesce(p.aprovado, 0))::numeric(14,2),
         (greatest(coalesce(p.aprovado, 0), coalesce(p.aguardando, 0), coalesce(g.valor, 0)))::numeric(14,2)
    from gravado g
    full join pedido p on p.job_item_orcado_id = g.job_item_orcado_id;
$$;

create or replace function public.save_avulso_uso(p_save_avulso_id uuid)
returns table(consumido numeric, usado numeric)
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(sum(u.consumido), 0)::numeric(14,2),
         coalesce(sum(u.usado), 0)::numeric(14,2)
    from public.save_avulso_uso_linhas(p_save_avulso_id) u
   where exists (
     select 1 from public.saves_avulsos s
      where s.id = p_save_avulso_id
        and s.tenant_id in (select public.current_tenant_ids()));
$$;

-- Crédito − o que já segura saldo. Nota cancelada não oferece nada.
create or replace function public.save_avulso_disponivel(p_save_avulso_id uuid)
returns numeric
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select case when public.save_avulso_emitido(p_save_avulso_id) then
           (s.credito - coalesce((select sum(u.usado) from public.save_avulso_uso_linhas(s.id) u), 0))::numeric(14,2)
         else 0::numeric(14,2) end
    from public.saves_avulsos s
   where s.id = p_save_avulso_id;
$$;

create or replace function public.save_avulso_disponivel_para_rascunho(p_save_avulso_id uuid)
returns numeric
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.save_avulso_disponivel(p_save_avulso_id)
   where exists (
     select 1 from public.saves_avulsos s
      where s.id = p_save_avulso_id
        and s.tenant_id in (select public.current_tenant_ids()));
$$;

-- `vw_saves_consumos_firmes` passa a mostrar a origem avulsa (coluna nova
-- no fim: as colunas de antes não mudam).
create or replace view public.vw_saves_consumos_firmes
with (security_invoker = on) as
 SELECT id,
    tenant_id,
    job_origem_id,
    item_versao_id,
    job_item_orcado_id,
    valor,
    substituido_em,
    created_by,
    created_at,
    updated_at,
    ((job_item_orcado_id IS NOT NULL) OR ((substituido_em IS NULL) AND (EXISTS ( SELECT 1
           FROM (versoes_orcamento_itens i
             JOIN versoes_orcamento v ON ((v.id = i.versao_orcamento_id)))
          WHERE ((i.id = c.item_versao_id) AND (v.status = 'aprovada'::versao_orcamento_status)))))) AS firme,
    save_avulso_id
   FROM saves_consumos c;

-- O saldo de cada save avulso, como a `vw_saves_por_job` faz para os jobs.
create or replace view public.vw_saves_avulsos
with (security_invoker = on) as
select s.id,
       s.tenant_id,
       s.cliente_id,
       s.empresa_id,
       s.faturamento_id,
       s.nome,
       s.numero_nf,
       s.data_emissao,
       s.valor_nf,
       s.percentual_honorarios,
       s.percentual_imposto,
       s.credito,
       coalesce(u.consumido, 0)::numeric(14,2) as consumido,
       coalesce(r.reservado, 0)::numeric(14,2) as reservado,
       (coalesce(u.usado, 0) - coalesce(u.consumido, 0))::numeric(14,2) as reservado_aprovacao,
       (s.credito - coalesce(u.usado, 0))::numeric(14,2) as disponivel,
       s.created_at
  from public.saves_avulsos s
  left join lateral public.save_avulso_uso(s.id) u(consumido, usado) on true
  left join lateral (
    select sum(c.valor) as reservado
      from public.vw_saves_consumos_firmes c
     where c.save_avulso_id = s.id and not c.firme
  ) r on true
 where public.save_avulso_emitido(s.id);

comment on view public.vw_saves_avulsos is
  'Decisão 247: o saldo de cada save avulso (nota emitida). disponivel = crédito − o que segura saldo (versão aprovada, linha do job e pedidos); reservado = consumo de rascunho, que avisa e não segura (028).';

grant select on public.vw_saves_avulsos to authenticated;
revoke all on public.vw_saves_avulsos from anon;

-- -------------------------------------------- 6. as origens nos pedidos

-- A forma canônica das origens de um consumo: uma entrada por origem,
-- valores positivos somados, em ordem. Pedido, aprovação e a leitura da
-- linha comparam por igualdade de jsonb, então as três passam por aqui.
create or replace function public.save_normalizar_origens(p_origens jsonb)
returns jsonb
language sql immutable
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'job_origem_id', s.job_origem_id,
             'save_avulso_id', s.save_avulso_id,
             'valor', s.valor))
           order by coalesce(s.job_origem_id, s.save_avulso_id)), '[]'::jsonb)
    from (
      select nullif(x->>'job_origem_id', '')::uuid as job_origem_id,
             nullif(x->>'save_avulso_id', '')::uuid as save_avulso_id,
             sum((x->>'valor')::numeric)::numeric(14,2) as valor
        from jsonb_array_elements(coalesce(p_origens, '[]'::jsonb)) x
       where coalesce((x->>'valor')::numeric, 0) > 0
       group by 1, 2
    ) s;
$$;

create or replace function public.save_origens_da_linha(p_linha_id uuid)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select public.save_normalizar_origens(coalesce(jsonb_agg(
           jsonb_build_object('job_origem_id', c.job_origem_id,
                              'save_avulso_id', c.save_avulso_id,
                              'valor', c.valor)), '[]'::jsonb))
    from public.saves_consumos c
   where c.job_item_orcado_id = p_linha_id;
$$;

create or replace function public.save_reverter_pedido(p_id uuid)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a public.saves_aprovacoes%rowtype;
  e jsonb;
begin
  select * into a from public.saves_aprovacoes where id = p_id;
  if not found or a.job_item_orcado_id is null then
    return;
  end if;

  if a.tipo = 'gera' then
    update public.jobs_itens_orcado
       set em_save = false
     where id = a.job_item_orcado_id
       and em_save;
  else
    delete from public.saves_consumos where job_item_orcado_id = a.job_item_orcado_id;
    for e in select * from jsonb_array_elements(a.origens_antes) loop
      insert into public.saves_consumos (tenant_id, job_origem_id, save_avulso_id, job_item_orcado_id, valor, created_by)
      values (a.tenant_id, nullif(e->>'job_origem_id', '')::uuid, nullif(e->>'save_avulso_id', '')::uuid,
              a.job_item_orcado_id, (e->>'valor')::numeric, (select auth.uid()));
    end loop;
  end if;
end;
$$;

create or replace function public.save_pedir(p_job_item_orcado_id uuid, p_tipo save_aprovacao_tipo, p_origens jsonb, p_numeros jsonb, p_errata jsonb)
returns uuid
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  o            public.jobs_itens_orcado%rowtype;
  v_status     public.job_status;
  v_grupo      text;
  v_origens    jsonb;
  v_antes      jsonb;
  v_valor      numeric(14,2);
  v_substitui  uuid;
  v_errata     uuid;
  v_id         uuid;
  e            jsonb;
begin
  select * into o from public.jobs_itens_orcado where id = p_job_item_orcado_id for update;
  if not found then
    raise exception 'Linha não encontrada.';
  end if;
  if not public.save_job_visivel(o.job_id) then
    raise exception 'Sem acesso a este job.';
  end if;
  if not public.save_pode_mexer_no_job(o.job_id) then
    raise exception 'Apenas o administrador ou um GP muda o save desta linha.';
  end if;
  select j.status into v_status from public.jobs j where j.id = o.job_id;
  if v_status not in ('aberto', 'em_producao') then
    raise exception 'Só um job aberto recebe pedido de save.';
  end if;
  if exists (
       select 1 from public.saves_aprovacoes a
        where a.job_item_orcado_id = o.id and a.situacao = 'aguardando') then
    raise exception 'Esta linha já tem pedido de save aguardando aprovação: cancele o pedido antes de mudar.';
  end if;
  if exists (
       select 1 from public.saves_aprovacoes a
        where a.job_item_orcado_id = o.id and a.situacao = 'recusado') then
    raise exception 'O save desta linha foi recusado: retire-o pelo pop-up antes de fazer um pedido novo.';
  end if;

  select g.nome into v_grupo from public.jobs_grupos g where g.id = o.job_grupo_id;

  perform set_config('app.save_fluxo', 'on', true);

  if p_tipo = 'gera' then
    if o.em_save then
      raise exception 'Esta linha já é save.';
    end if;
    update public.jobs_itens_orcado set em_save = true where id = o.id;
    v_origens := '[]'::jsonb;
    v_antes := '[]'::jsonb;
    v_valor := coalesce(o.total_orcado, 0);
  else
    if o.em_save then
      raise exception 'Uma linha não pode gerar e consumir save ao mesmo tempo.';
    end if;
    if p_origens is null or jsonb_typeof(p_origens) <> 'array' then
      raise exception 'Informe de qual saldo sai o consumo.';
    end if;
    -- Uma entrada por origem (job ou save avulso), só valores positivos.
    v_origens := public.save_normalizar_origens(p_origens);
    if jsonb_array_length(v_origens) = 0 then
      raise exception 'Informe o valor consumido de ao menos um saldo. Para tirar o consumo da linha, use Retirar no pop-up.';
    end if;

    v_antes := public.save_origens_da_linha(o.id);
    if v_antes = v_origens then
      raise exception 'O consumo não mudou.';
    end if;
    select a.id into v_substitui
      from public.saves_aprovacoes a
     where a.job_item_orcado_id = o.id and a.tipo = 'consome' and a.situacao = 'aprovado';

    delete from public.saves_consumos where job_item_orcado_id = o.id;
    for e in select * from jsonb_array_elements(v_origens) loop
      insert into public.saves_consumos (tenant_id, job_origem_id, save_avulso_id, job_item_orcado_id, valor, created_by)
      values (o.tenant_id, nullif(e->>'job_origem_id', '')::uuid, nullif(e->>'save_avulso_id', '')::uuid,
              o.id, (e->>'valor')::numeric, (select auth.uid()));
    end loop;
    select coalesce(sum((x->>'valor')::numeric), 0) into v_valor from jsonb_array_elements(v_origens) x;
  end if;

  v_errata := public.save_registrar_errata(o.id, p_errata);

  insert into public.saves_aprovacoes (
    tenant_id, job_id, job_item_orcado_id, item_descricao, grupo_nome,
    tipo, situacao, momento, valor, origens, origens_antes,
    valor_job_antes, valor_job_depois, faturamento_previsto_antes, faturamento_previsto_depois,
    substitui_id, errata_id, enviado_por
  ) values (
    o.tenant_id, o.job_id, o.id, o.item, v_grupo,
    p_tipo, 'aguardando', 'job_aberto', v_valor, v_origens, v_antes,
    (p_numeros->>'valor_job_antes')::numeric, (p_numeros->>'valor_job_depois')::numeric,
    (p_numeros->>'faturamento_previsto_antes')::numeric, (p_numeros->>'faturamento_previsto_depois')::numeric,
    v_substitui, v_errata, (select auth.uid())
  )
  returning id into v_id;

  perform set_config('app.save_fluxo', '', true);
  return v_id;
end;
$$;

create or replace function public.decidir_pedido_save(p_id uuid, p_decisao text, p_justificativa text, p_totais jsonb, p_revisao text, p_errata jsonb default null::jsonb)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a public.saves_aprovacoes%rowtype;
begin
  select * into a from public.saves_aprovacoes where id = p_id for update;
  if not found then
    raise exception 'Pedido de save não encontrado.';
  end if;
  if not (public.is_tenant_admin(a.tenant_id) or public.is_tenant_financeiro(a.tenant_id)) then
    raise exception 'Só o administrador ou o financeiro aprova ou recusa save.';
  end if;
  if not public.save_job_visivel(a.job_id) then
    raise exception 'Sem acesso ao job deste pedido de save.';
  end if;
  if a.situacao <> 'aguardando' then
    raise exception 'Este pedido de save já foi decidido.';
  end if;
  if a.job_item_orcado_id is null then
    raise exception 'A linha deste pedido de save foi removida: ele não pode ser decidido.';
  end if;
  perform 1 from public.jobs_itens_orcado where id = a.job_item_orcado_id for update;

  perform set_config('app.save_fluxo', 'on', true);

  if p_decisao = 'aprovar' then
    if p_errata is not null then
      raise exception 'Aprovar save não grava errata: a revisão da abertura é o registro.';
    end if;
    if a.tipo = 'gera' and not exists (
         select 1 from public.jobs_itens_orcado o
          where o.id = a.job_item_orcado_id
            and o.em_save
            and abs(coalesce(o.total_orcado, 0) - a.valor) < 0.005) then
      raise exception 'A linha mudou depois do pedido de save: peça à produção para cancelar e enviar de novo.';
    end if;
    if a.tipo = 'consome'
       and public.save_origens_da_linha(a.job_item_orcado_id) <> public.save_normalizar_origens(a.origens) then
      raise exception 'O consumo da linha mudou depois do pedido: peça à produção para cancelar e enviar de novo.';
    end if;
    if a.momento = 'job_aberto' and p_totais is null then
      raise exception 'Totais do job ausentes na aprovação do save.';
    end if;

    if a.substitui_id is not null then
      update public.saves_aprovacoes
         set situacao = 'substituido'
       where id = a.substitui_id
         and situacao = 'aprovado'
         and tipo = 'consome'
         and job_item_orcado_id = a.job_item_orcado_id;
      if not found then
        raise exception 'O consumo aprovado que esta edição substitui não é desta linha.';
      end if;
    end if;
    update public.saves_aprovacoes set situacao = 'aprovado' where id = p_id;
  elsif p_decisao = 'recusar' then
    if char_length(btrim(coalesce(p_justificativa, ''))) < 10 then
      raise exception 'Escreva a justificativa da recusa com pelo menos 10 caracteres.';
    end if;
    -- O financeiro já contava o pedido: recusar muda os números dele, e
    -- isso é errata de save (com os espelhos na hora).
    if a.momento <> 'job_aberto' and (p_totais is null or p_errata is null) then
      raise exception 'Este pedido já contava para o financeiro: recusar é errata de save e precisa dos números do job.';
    end if;
    if a.momento = 'job_aberto' and p_errata is not null then
      raise exception 'Este pedido ainda não contava para o financeiro: recusar não grava errata.';
    end if;
    update public.saves_aprovacoes
       set situacao = 'recusado', justificativa = btrim(p_justificativa)
     where id = p_id;
    perform public.save_reverter_pedido(p_id);
    if p_errata is not null then
      perform public.save_registrar_errata(a.job_item_orcado_id, p_errata);
    end if;
  else
    raise exception 'Decisão inválida.';
  end if;

  perform public.save_gravar_totais(a.job_id, p_totais);
  perform public.save_revisao(a.job_id, p_revisao);
  perform set_config('app.save_fluxo', '', true);
end;
$$;

-- ------------------------------------------- 7. a validação do consumo
create or replace function public.save_consumo_valida()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_total_linha        numeric(14,2);
  v_em_save            boolean;
  v_tenant_linha       uuid;
  v_job_da_linha       uuid;
  v_orcamento_versao   uuid;
  v_versao_aprovada    boolean := false;
  v_ja_consumido       numeric(14,2);
  v_codigo             text;
  v_gerado             numeric(14,2);
  v_usado_outros       numeric(14,2);
  v_da_linha           numeric(14,2);
  v_old_job            uuid;
  v_old_versao         uuid;
  v_cliente_linha      uuid;
  sa                   public.saves_avulsos%rowtype;
begin
  if tg_op = 'UPDATE' then
    v_old_job := old.job_item_orcado_id;
    v_old_versao := old.item_versao_id;
  end if;

  if new.item_versao_id is not null then
    select i.total_orcado, i.em_save, i.tenant_id, v.orcamento_id, (v.status = 'aprovada'), o.cliente_id
      into v_total_linha, v_em_save, v_tenant_linha, v_orcamento_versao, v_versao_aprovada, v_cliente_linha
      from public.versoes_orcamento_itens i
      join public.versoes_orcamento v on v.id = i.versao_orcamento_id
      join public.orcamentos o on o.id = v.orcamento_id
     where i.id = new.item_versao_id;
  else
    select o.total_orcado, o.em_save, o.tenant_id, o.job_id, j.cliente_id
      into v_total_linha, v_em_save, v_tenant_linha, v_job_da_linha, v_cliente_linha
      from public.jobs_itens_orcado o
      join public.jobs j on j.id = o.job_id
     where o.id = new.job_item_orcado_id;
  end if;

  if v_total_linha is null then
    raise exception 'Linha consumidora não encontrada.';
  end if;
  if v_em_save then
    raise exception 'Uma linha não pode gerar e consumir save ao mesmo tempo.';
  end if;
  if new.tenant_id <> v_tenant_linha then
    raise exception 'Tenant do consumo difere do tenant da linha.';
  end if;

  -- O próprio saldo, pelos dois lados: o job da linha, ou o job do orçamento
  -- da versão. Só existe para a origem que é job.
  if new.job_origem_id is not null then
    if v_job_da_linha is not null and v_job_da_linha = new.job_origem_id then
      raise exception 'Um job não pode consumir o próprio saldo de save.';
    end if;
    if v_orcamento_versao is not null and exists (
         select 1 from public.jobs j
          where j.id = new.job_origem_id and j.orcamento_id = v_orcamento_versao) then
      raise exception 'Um job não pode consumir o próprio saldo de save.';
    end if;
  end if;

  select coalesce(sum(c.valor), 0) into v_ja_consumido
    from public.saves_consumos c
   where c.id <> new.id
     and ((new.item_versao_id is not null and c.item_versao_id = new.item_versao_id
           and c.substituido_em is null)
       or (new.job_item_orcado_id is not null and c.job_item_orcado_id = new.job_item_orcado_id));

  if v_ja_consumido + new.valor > v_total_linha + 0.005 then
    raise exception 'O consumo de save (R$ %) passa do orçado da linha (R$ %).',
      public.save_reais(v_ja_consumido + new.valor),
      public.save_reais(v_total_linha);
  end if;

  -- ---- Origem: save avulso (decisão 247) -----------------------------------
  if new.save_avulso_id is not null then
    select * into sa from public.saves_avulsos where id = new.save_avulso_id;
    if not found or sa.tenant_id <> new.tenant_id then
      raise exception 'Save avulso não encontrado.';
    end if;
    if sa.cliente_id is distinct from v_cliente_linha then
      raise exception 'O save avulso “%” é de outro cliente: só os jobs do mesmo cliente o consomem.', sa.nome;
    end if;
    if not public.save_avulso_emitido(sa.id) then
      raise exception 'A nota do save avulso “%” foi cancelada: ele não oferece saldo.', sa.nome;
    end if;

    if new.job_item_orcado_id is not null or v_versao_aprovada then
      -- Serializa quem consome o mesmo crédito.
      perform 1 from public.saves_avulsos where id = sa.id for no key update;

      select coalesce(sum(u.usado), 0) into v_usado_outros
        from public.save_avulso_uso_linhas(sa.id) u
       where (u.job_item_orcado_id is null
              or (u.job_item_orcado_id is distinct from new.job_item_orcado_id
                  and u.job_item_orcado_id is distinct from v_old_job))
         and (u.item_versao_id is null
              or (u.item_versao_id is distinct from new.item_versao_id
                  and u.item_versao_id is distinct from v_old_versao));

      select coalesce(sum(c.valor), 0) + new.valor into v_da_linha
        from public.saves_consumos c
       where c.id <> new.id
         and c.save_avulso_id = sa.id
         and ((new.item_versao_id is not null and c.item_versao_id = new.item_versao_id
               and c.substituido_em is null)
           or (new.job_item_orcado_id is not null and c.job_item_orcado_id = new.job_item_orcado_id));

      if v_usado_outros + v_da_linha > sa.credito + 0.005 then
        raise exception 'O crédito do save avulso “%” é de R$ %, e outras linhas já usam R$ %: não cabe mais R$ %.',
          sa.nome,
          public.save_reais(sa.credito),
          public.save_reais(v_usado_outros),
          public.save_reais(v_da_linha);
      end if;
    end if;

    new.updated_at := now();
    return new;
  end if;

  -- ---- Origem: job (decisões 028 e 099) ------------------------------------
  select j.codigo into v_codigo from public.jobs j where j.id = new.job_origem_id;
  if v_codigo is null then
    raise exception 'Job de origem do save não encontrado.';
  end if;

  -- Saldo: só o que segura saldo (linha do job, ou versão aprovada). O
  -- rascunho reserva e avisa, não impede (decisão 028, nota de 26/08).
  if new.job_item_orcado_id is not null or v_versao_aprovada then
    -- Dois consumos do mesmo saldo ao mesmo tempo passariam os dois: a linha
    -- do job de origem serializa quem consome e quem retira o save.
    perform 1 from public.jobs where id = new.job_origem_id for no key update;

    v_gerado := public.save_gerado_aprovado(new.job_origem_id);

    -- Outras linhas. Na abertura o consumo MUDA de ponta (versão → cópia do
    -- job) por UPDATE: a ponta antiga ainda está na tabela e não é "outra".
    select coalesce(sum(u.usado), 0) into v_usado_outros
      from public.save_uso_linhas(new.job_origem_id) u
     where (u.job_item_orcado_id is null
            or (u.job_item_orcado_id is distinct from new.job_item_orcado_id
                and u.job_item_orcado_id is distinct from v_old_job))
       and (u.item_versao_id is null
            or (u.item_versao_id is distinct from new.item_versao_id
                and u.item_versao_id is distinct from v_old_versao));

    select coalesce(sum(c.valor), 0) + new.valor into v_da_linha
      from public.saves_consumos c
     where c.id <> new.id
       and c.job_origem_id = new.job_origem_id
       and ((new.item_versao_id is not null and c.item_versao_id = new.item_versao_id
             and c.substituido_em is null)
         or (new.job_item_orcado_id is not null and c.job_item_orcado_id = new.job_item_orcado_id));

    if v_usado_outros + v_da_linha > v_gerado + 0.005 then
      raise exception 'O saldo de save aprovado do % é de R$ %, e outras linhas já usam R$ %: não cabe mais R$ %.',
        v_codigo,
        public.save_reais(v_gerado),
        public.save_reais(v_usado_outros),
        public.save_reais(v_da_linha);
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ------------------------------------- 8. o orçamento inteiro (decisão 154)

-- Com o modo ligado, a linha não vira save (o modo "consumir" vale para o
-- job e para o save avulso).
create or replace function public.save_modo_da_versao_na_linha()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_padrao  boolean;
  v_job     uuid;
  v_avulso  uuid;
  v_status  text;
  v_codigo  text;
begin
  select v.save_por_padrao, v.save_consumo_job_id, v.save_consumo_avulso_id, v.status::text
    into v_padrao, v_job, v_avulso, v_status
    from public.versoes_orcamento v
   where v.id = new.versao_orcamento_id;

  if v_status = 'aprovada' then
    return new;
  end if;
  if v_padrao and not new.em_save then
    raise exception 'Este orçamento inteiro gera save: uma linha não sai do save sozinha. Para mudar uma linha só, retire antes o save do orçamento.';
  end if;
  if v_job is not null and new.em_save then
    select codigo into v_codigo from public.jobs where id = v_job;
    raise exception 'Este orçamento inteiro consome o saldo do %: uma linha dele não gera save. Para mudar uma linha só, retire antes o save do orçamento.', v_codigo;
  end if;
  if v_avulso is not null and new.em_save then
    select nome into v_codigo from public.saves_avulsos where id = v_avulso;
    raise exception 'Este orçamento inteiro consome o save avulso “%”: uma linha dele não gera save. Para mudar uma linha só, retire antes o save do orçamento.', v_codigo;
  end if;
  return new;
end;
$$;

-- Com o consumo ligado, o consumo da linha é o orçado dela — do job ou do
-- save avulso do modo.
create or replace function public.save_modo_consumo_acompanha_linha()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_job        uuid;
  v_avulso     uuid;
  v_status     text;
  v_rotulo     text;
  v_antes      numeric(14,2) := 0;
  v_total      numeric(14,2);
  v_disponivel numeric(14,2);
begin
  if tg_op = 'UPDATE' then
    if new.total_orcado is not distinct from old.total_orcado then
      return null;
    end if;
    v_antes := coalesce(old.total_orcado, 0);
  end if;

  select v.save_consumo_job_id, v.save_consumo_avulso_id, v.status::text
    into v_job, v_avulso, v_status
    from public.versoes_orcamento v
   where v.id = new.versao_orcamento_id;
  if (v_job is null and v_avulso is null) or v_status = 'aprovada' or new.em_save then
    return null;
  end if;

  select coalesce(sum(i.total_orcado), 0) into v_total
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = new.versao_orcamento_id;
  if v_job is not null then
    v_disponivel := coalesce(public.save_disponivel_do_job(v_job), 0);
  else
    v_disponivel := coalesce(public.save_avulso_disponivel(v_avulso), 0);
  end if;

  if v_total > v_disponivel + 0.005 then
    if v_job is not null then
      select 'do ' || codigo into v_rotulo from public.jobs where id = v_job;
    else
      select 'do save “' || nome || '”' into v_rotulo from public.saves_avulsos where id = v_avulso;
    end if;
    if tg_op = 'INSERT' then
      raise exception 'Passa do saldo %: restam R$ %, e a linha nova pede R$ %. A linha não foi gravada.',
        v_rotulo,
        public.save_reais(greatest(v_disponivel - (v_total - new.total_orcado), 0)),
        public.save_reais(new.total_orcado);
    end if;
    raise exception 'Passa do saldo %: restam R$ %, e esta mudança pede mais R$ %. O valor não foi gravado.',
      v_rotulo,
      public.save_reais(greatest(v_disponivel - (v_total - new.total_orcado + v_antes), 0)),
      public.save_reais(new.total_orcado - v_antes);
  end if;

  delete from public.saves_consumos
   where item_versao_id = new.id
     and substituido_em is null;
  if new.total_orcado > 0 then
    insert into public.saves_consumos (tenant_id, job_origem_id, save_avulso_id, item_versao_id, valor, created_by)
    values (new.tenant_id, v_job, v_avulso, new.id, new.total_orcado, (select auth.uid()));
  end if;
  return null;
end;
$$;

-- Consumir o saldo de um JOB no orçamento inteiro. Igual à de antes, com
-- duas correções para a origem nova: o consumo de um save avulso também é
-- "consumo de outro saldo" (antes `c.job_origem_id <> p_job_id` era nulo
-- para ele e passava), e o modo avulso que estava ligado é trocado.
create or replace function public.versao_save_consumir_tudo(p_versao_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status        text;
  v_orcamento     uuid;
  v_tenant        uuid;
  v_padrao        boolean;
  v_job_atual     uuid;
  v_avulso_atual  uuid;
  v_cliente       uuid;
  v_job           record;
  v_itens         uuid[];
  v_total         numeric(14,2);
  v_disponivel    numeric(14,2);
  v_linhas        integer;
begin
  select v.status::text, v.orcamento_id, v.tenant_id, v.save_por_padrao, v.save_consumo_job_id,
         v.save_consumo_avulso_id, o.cliente_id
    into v_status, v_orcamento, v_tenant, v_padrao, v_job_atual, v_avulso_atual, v_cliente
    from public.versoes_orcamento v
    join public.orcamentos o on o.id = v.orcamento_id
    join public.projetos p on p.id = o.projeto_id
   where v.id = p_versao_id
   for update of v;
  if not found then
    raise exception 'Versão não encontrada.';
  end if;
  if v_status = 'aprovada' then
    raise exception 'Versão aprovada não permite alterar o save aqui. Use a Errata na Planilha Interna do job.';
  end if;
  -- Direto no serviço: `orcamento_de_investimento_interno` não é liberada
  -- para `authenticated`, e estas funções rodam como quem chama.
  if coalesce((select s.investimento_interno
                 from public.orcamentos o
                 join public.categorias_dominio s on s.id = o.servico_id
                where o.id = v_orcamento), false) then
    raise exception 'O serviço Interno não usa save.';
  end if;
  if v_padrao then
    raise exception 'Este orçamento inteiro gera save. Para consumir o saldo de um job, retire antes todos os saves.';
  end if;

  select j.id, j.codigo, j.status::text as status, j.orcamento_id, j.tenant_id, j.cliente_id
    into v_job
    from public.jobs j
    join public.projetos p on p.id = j.projeto_id
   where j.id = p_job_id;
  if not found then
    raise exception 'Job de origem do save não encontrado.';
  end if;
  if v_job.tenant_id <> v_tenant then
    raise exception 'Job de origem do save não encontrado.';
  end if;
  if v_job.orcamento_id = v_orcamento then
    raise exception 'Um job não pode consumir o próprio saldo de save.';
  end if;
  if v_job.cliente_id is distinct from v_cliente then
    raise exception 'O saldo de save é do cliente: o % é de outro cliente.', v_job.codigo;
  end if;
  if v_job.status in ('rejeitado_financeiro', 'cancelado') then
    raise exception 'O % foi cancelado ou recusado pelo financeiro e não oferece saldo.', v_job.codigo;
  end if;

  select array_agg(i.id) into v_itens
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id
     and i.em_save;
  if v_itens is not null then
    raise exception 'Não dá para consumir o saldo de um job: % save (%). Retire antes esses saves.',
      case when cardinality(v_itens) = 1 then '1 linha gera' else cardinality(v_itens) || ' linhas geram' end,
      public.save_nomes_das_linhas(v_itens);
  end if;

  -- Consumo de OUTRO saldo trava. O do mesmo job é absorvido, e o do saldo
  -- que o orçamento já consumia (job ou save avulso) é trocado.
  select array_agg(distinct i.id) into v_itens
    from public.versoes_orcamento_itens i
    join public.saves_consumos c on c.item_versao_id = i.id and c.substituido_em is null
   where i.versao_orcamento_id = p_versao_id
     and c.job_origem_id is distinct from p_job_id
     and not (v_job_atual is not null and c.job_origem_id is not distinct from v_job_atual)
     and not (v_avulso_atual is not null and c.save_avulso_id is not distinct from v_avulso_atual);
  if v_itens is not null then
    raise exception 'Não dá para consumir o saldo do %: % outro saldo (%). O orçamento inteiro consome de um saldo só; retire antes esses saves.',
      v_job.codigo,
      case when cardinality(v_itens) = 1 then '1 linha já consome' else cardinality(v_itens) || ' linhas já consomem' end,
      public.save_nomes_das_linhas(v_itens);
  end if;

  select coalesce(sum(i.total_orcado), 0) into v_total
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id;
  v_disponivel := coalesce(public.save_disponivel_para_rascunho(p_job_id), 0);
  if v_total > v_disponivel + 0.005 then
    raise exception 'O orçamento soma R$ % e o saldo disponível do % é de R$ %: faltam R$ %. Nada foi gravado.',
      public.save_reais(v_total), v_job.codigo, public.save_reais(v_disponivel),
      public.save_reais(v_total - v_disponivel);
  end if;

  -- O modo antes dos consumos: o gatilho da linha passa a acompanhar.
  update public.versoes_orcamento
     set save_consumo_job_id = p_job_id,
         save_consumo_avulso_id = null
   where id = p_versao_id;

  delete from public.saves_consumos c
   using public.versoes_orcamento_itens i
   where c.item_versao_id = i.id
     and i.versao_orcamento_id = p_versao_id
     and c.substituido_em is null;

  insert into public.saves_consumos (tenant_id, job_origem_id, item_versao_id, valor, created_by)
  select i.tenant_id, p_job_id, i.id, i.total_orcado, (select auth.uid())
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id
     and i.total_orcado > 0;
  get diagnostics v_linhas = row_count;

  return jsonb_build_object(
    'linhas', v_linhas,
    'total', v_total,
    'disponivel', v_disponivel,
    'restante', v_disponivel - v_total,
    'codigo', v_job.codigo
  );
end;
$$;

-- Consumir um SAVE AVULSO no orçamento inteiro (decisão 247).
create or replace function public.versao_save_consumir_avulso(p_versao_id uuid, p_save_avulso_id uuid)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status        text;
  v_orcamento     uuid;
  v_tenant        uuid;
  v_padrao        boolean;
  v_job_atual     uuid;
  v_avulso_atual  uuid;
  v_cliente       uuid;
  sa              public.saves_avulsos%rowtype;
  v_itens         uuid[];
  v_total         numeric(14,2);
  v_disponivel    numeric(14,2);
  v_linhas        integer;
begin
  select v.status::text, v.orcamento_id, v.tenant_id, v.save_por_padrao, v.save_consumo_job_id,
         v.save_consumo_avulso_id, o.cliente_id
    into v_status, v_orcamento, v_tenant, v_padrao, v_job_atual, v_avulso_atual, v_cliente
    from public.versoes_orcamento v
    join public.orcamentos o on o.id = v.orcamento_id
    join public.projetos p on p.id = o.projeto_id
   where v.id = p_versao_id
   for update of v;
  if not found then
    raise exception 'Versão não encontrada.';
  end if;
  if v_status = 'aprovada' then
    raise exception 'Versão aprovada não permite alterar o save aqui. Use a Errata na Planilha Interna do job.';
  end if;
  if coalesce((select s.investimento_interno
                 from public.orcamentos o
                 join public.categorias_dominio s on s.id = o.servico_id
                where o.id = v_orcamento), false) then
    raise exception 'O serviço Interno não usa save.';
  end if;
  if v_padrao then
    raise exception 'Este orçamento inteiro gera save. Para consumir um saldo, retire antes todos os saves.';
  end if;

  select * into sa from public.saves_avulsos where id = p_save_avulso_id;
  if not found or sa.tenant_id <> v_tenant then
    raise exception 'Save avulso não encontrado.';
  end if;
  if sa.cliente_id is distinct from v_cliente then
    raise exception 'O save avulso “%” é de outro cliente.', sa.nome;
  end if;
  if not public.save_avulso_emitido(sa.id) then
    raise exception 'A nota do save avulso “%” foi cancelada: ele não oferece saldo.', sa.nome;
  end if;

  select array_agg(i.id) into v_itens
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id
     and i.em_save;
  if v_itens is not null then
    raise exception 'Não dá para consumir o save avulso: % save (%). Retire antes esses saves.',
      case when cardinality(v_itens) = 1 then '1 linha gera' else cardinality(v_itens) || ' linhas geram' end,
      public.save_nomes_das_linhas(v_itens);
  end if;

  select array_agg(distinct i.id) into v_itens
    from public.versoes_orcamento_itens i
    join public.saves_consumos c on c.item_versao_id = i.id and c.substituido_em is null
   where i.versao_orcamento_id = p_versao_id
     and c.save_avulso_id is distinct from p_save_avulso_id
     and not (v_job_atual is not null and c.job_origem_id is not distinct from v_job_atual)
     and not (v_avulso_atual is not null and c.save_avulso_id is not distinct from v_avulso_atual);
  if v_itens is not null then
    raise exception 'Não dá para consumir o save avulso “%”: % outro saldo (%). O orçamento inteiro consome de um saldo só; retire antes esses saves.',
      sa.nome,
      case when cardinality(v_itens) = 1 then '1 linha já consome' else cardinality(v_itens) || ' linhas já consomem' end,
      public.save_nomes_das_linhas(v_itens);
  end if;

  select coalesce(sum(i.total_orcado), 0) into v_total
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id;
  v_disponivel := coalesce(public.save_avulso_disponivel_para_rascunho(p_save_avulso_id), 0);
  if v_total > v_disponivel + 0.005 then
    raise exception 'O orçamento soma R$ % e o saldo disponível do save “%” é de R$ %: faltam R$ %. Nada foi gravado.',
      public.save_reais(v_total), sa.nome, public.save_reais(v_disponivel),
      public.save_reais(v_total - v_disponivel);
  end if;

  update public.versoes_orcamento
     set save_consumo_avulso_id = p_save_avulso_id,
         save_consumo_job_id = null
   where id = p_versao_id;

  delete from public.saves_consumos c
   using public.versoes_orcamento_itens i
   where c.item_versao_id = i.id
     and i.versao_orcamento_id = p_versao_id
     and c.substituido_em is null;

  insert into public.saves_consumos (tenant_id, save_avulso_id, item_versao_id, valor, created_by)
  select i.tenant_id, p_save_avulso_id, i.id, i.total_orcado, (select auth.uid())
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id
     and i.total_orcado > 0;
  get diagnostics v_linhas = row_count;

  return jsonb_build_object(
    'linhas', v_linhas,
    'total', v_total,
    'disponivel', v_disponivel,
    'restante', v_disponivel - v_total,
    'nome', sa.nome
  );
end;
$$;

create or replace function public.versao_save_retirar_tudo(p_versao_id uuid)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status      text;
  v_consumos    integer;
  v_desmarcadas integer;
begin
  select v.status::text into v_status
    from public.versoes_orcamento v
   where v.id = p_versao_id
   for update;
  if not found then
    raise exception 'Versão não encontrada.';
  end if;
  if v_status = 'aprovada' then
    raise exception 'Versão aprovada não permite alterar o save aqui. Use a Errata na Planilha Interna do job.';
  end if;

  update public.versoes_orcamento
     set save_por_padrao = false,
         save_consumo_job_id = null,
         save_consumo_avulso_id = null
   where id = p_versao_id;

  with apagados as (
    delete from public.saves_consumos c
     using public.versoes_orcamento_itens i
     where c.item_versao_id = i.id
       and i.versao_orcamento_id = p_versao_id
       and c.substituido_em is null
    returning c.item_versao_id
  )
  select count(distinct item_versao_id) into v_consumos from apagados;

  update public.versoes_orcamento_itens
     set em_save = false
   where versao_orcamento_id = p_versao_id
     and em_save;
  get diagnostics v_desmarcadas = row_count;

  return jsonb_build_object('linhas_desmarcadas', v_desmarcadas, 'linhas_sem_consumo', v_consumos);
end;
$$;

-- ------------------------------------------- 9. a nota do save avulso

-- Emite a nota e registra o save avulso numa transação só.
create or replace function public.emitir_faturamento_save_avulso(
  payload jsonb, p_nome text, p_percentual_honorarios numeric, p_percentual_imposto numeric)
returns uuid
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenant   uuid := (payload->>'tenant_id')::uuid;
  v_cliente  uuid := nullif(payload->>'cliente_id', '')::uuid;
  v_subtipo  uuid := nullif(payload->>'plano_conta_subtipo_id', '')::uuid;
  v_id       uuid;
  f          public.faturamentos%rowtype;
begin
  if not (public.is_tenant_admin(v_tenant) or public.is_tenant_financeiro(v_tenant)) then
    raise exception 'Só o administrador ou o financeiro fatura um save avulso.';
  end if;
  if coalesce(payload->>'origem_tipo', '') <> 'avulso' then
    raise exception 'O save avulso é uma nota avulsa.';
  end if;
  if v_cliente is null then
    raise exception 'Escolha o cliente do save avulso.';
  end if;
  if char_length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'Dê um nome ao save avulso.';
  end if;
  if p_percentual_honorarios is null or p_percentual_honorarios < 0 then
    raise exception 'Informe os honorários do save avulso.';
  end if;
  if p_percentual_imposto is null or p_percentual_imposto < 0 or p_percentual_imposto >= 100 then
    raise exception 'Escolha o imposto do save avulso.';
  end if;
  if not exists (
       select 1 from public.plano_contas_subtipos s
         join public.plano_contas_tipos t on t.id = s.tipo_id
        where s.id = v_subtipo and s.tenant_id = v_tenant
          and t.codigo = '01' and s.nome = 'Save') then
    raise exception 'O save avulso sai em 01 · Receita · Save.';
  end if;

  v_id := public.emitir_faturamento(payload);

  select * into f from public.faturamentos where id = v_id;
  insert into public.saves_avulsos (
    tenant_id, faturamento_id, cliente_id, empresa_id, nome, numero_nf, data_emissao,
    valor_nf, percentual_honorarios, percentual_imposto, created_by
  ) values (
    v_tenant, v_id, v_cliente, f.empresa_id, btrim(p_nome), f.numero_nf, f.data_emissao,
    f.valor_total, p_percentual_honorarios, p_percentual_imposto, (select auth.uid())
  );
  return v_id;
end;
$$;

-- A nota do save avulso não se cancela depois de consumida: as linhas que
-- consomem ficariam sem origem.
create or replace function public.save_avulso_trava_cancelamento()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_nome  text;
  v_qtd   integer;
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    select s.nome, count(c.id)
      into v_nome, v_qtd
      from public.saves_avulsos s
      join public.saves_consumos c on c.save_avulso_id = s.id
     where s.faturamento_id = new.id
     group by s.nome;
    if coalesce(v_qtd, 0) > 0 then
      raise exception 'O save avulso “%” desta nota já é consumido em % linha(s) de orçamento ou job. Retire esses consumos antes de cancelar a NF.',
        v_nome, v_qtd;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_save_avulso_trava_cancelamento on public.faturamentos;
create trigger trg_save_avulso_trava_cancelamento
  before update of status on public.faturamentos
  for each row execute function public.save_avulso_trava_cancelamento();

-- ------------------------------------------------------------------ grants
revoke all on function public.save_avulso_emitido(uuid) from public, anon;
revoke all on function public.save_avulso_uso_linhas(uuid) from public, anon, authenticated;
revoke all on function public.save_avulso_uso(uuid) from public, anon;
revoke all on function public.save_avulso_disponivel(uuid) from public, anon, authenticated;
revoke all on function public.save_avulso_disponivel_para_rascunho(uuid) from public, anon;
revoke all on function public.save_normalizar_origens(jsonb) from public, anon;
revoke all on function public.versao_save_consumir_avulso(uuid, uuid) from public, anon;
revoke all on function public.emitir_faturamento_save_avulso(jsonb, text, numeric, numeric) from public, anon;
revoke all on function public.save_avulso_trava_cancelamento() from public, anon, authenticated;

grant execute on function public.save_avulso_emitido(uuid) to authenticated;
grant execute on function public.save_avulso_uso(uuid) to authenticated;
grant execute on function public.save_avulso_disponivel_para_rascunho(uuid) to authenticated;
grant execute on function public.save_normalizar_origens(jsonb) to authenticated;
grant execute on function public.versao_save_consumir_avulso(uuid, uuid) to authenticated;
grant execute on function public.emitir_faturamento_save_avulso(jsonb, text, numeric, numeric) to authenticated;
