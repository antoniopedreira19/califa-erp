-- =====================================================================
-- Transferência entre contas (decisão 124, opção A — Tiago, 29/09/2026)
-- =====================================================================
--
-- Dinheiro que só muda de conta: aplicação, resgate, reforço de caixa.
-- Não é receita nem despesa. Regras do Tiago:
--
--   * D16 — vira título em Títulos a Receber, com "Criar" (a transferir)
--     e "Criar e dar baixa" (já transferida). Cancela pelo olho; não tem
--     estorno.
--   * D17.2 — sem empresa, sem regional e sem plano de contas: a conta já
--     diz de qual CNPJ é o dinheiro.
--   * D4 (pendente) — por ora só entre contas do MESMO CNPJ
--     (`empresa_contabil_id`). Entre CNPJs o dinheiro muda de dono; o
--     tratamento fica para depois.
--
-- O impasse, e a saída escolhida (opção A, "no futuro iremos revisar esse
-- fluxo"): todo lançamento era obrigado a ter empresa e plano, e a regra
-- de acesso (RLS) decide quem vê cada linha pela empresa. Aqui:
--
--   * `empresa_id`, `plano_conta_tipo_id` e `plano_conta_subtipo_id`
--     deixam de ser NOT NULL — mas um CHECK amarra: vazios SÓ nas duas
--     origens novas (`transferencia_saida` e `transferencia_entrada`), que
--     por sua vez são obrigadas a apontar para a transferência. Toda outra
--     origem continua exigindo os três, exatamente como antes.
--   * As políticas de `lancamentos_financeiros` ganham um ramo: a linha
--     de transferência (sem empresa) é visível e gravável por
--     administrador e financeiro do tenant. O ramo antigo não muda.
--   * `chk_origem_tem_referencia` e `chk_origem_contraparte_tem_id` ganham
--     o ramo da transferência (sem PP, avulsa, título, desembolso ou verba;
--     com `transferencia_id`). Os ramos antigos são os mesmos.
--
-- Fora do DRE e do fluxo de caixa consolidado: a tela do fluxo filtra as
-- duas origens (código). O extrato da conciliação mostra as duas linhas,
-- uma em cada conta.
--
-- O título mora em `transferencias_contas` — não cabe na conta avulsa,
-- que exige empresa e plano. Escrita só pelas funções abaixo (SECURITY
-- DEFINER, com a régua de admin ou financeiro); leitura pela RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- O título
-- ---------------------------------------------------------------------

create table if not exists public.transferencias_contas (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  codigo            text not null,
  conta_origem_id   uuid not null references public.contas_bancarias(id) on delete restrict,
  conta_destino_id  uuid not null references public.contas_bancarias(id) on delete restrict,
  valor             numeric(14,2) not null,
  data_prevista     date not null,
  descricao         text,
  status            text not null default 'a_transferir',
  transferida_em    date,
  transferida_por   uuid,
  criado_por        uuid not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_transferencia_valor_positivo check (valor > 0),
  constraint chk_transferencia_contas_diferentes check (conta_origem_id <> conta_destino_id),
  constraint chk_transferencia_status check (status in ('a_transferir', 'transferida')),
  constraint chk_transferencia_efetivada_consistente check (
    (status = 'transferida' and transferida_em is not null and transferida_por is not null)
    or (status = 'a_transferir' and transferida_em is null and transferida_por is null)
  ),
  constraint uniq_transferencia_codigo unique (tenant_id, codigo)
);

comment on table public.transferencias_contas is
  'Transferência entre contas do mesmo CNPJ (decisão 124). Título de Títulos a Receber; as duas pernas são lançamentos transferencia_saida e transferencia_entrada, sem empresa e sem plano.';

create index if not exists idx_transferencias_tenant_status
  on public.transferencias_contas (tenant_id, status);
create index if not exists idx_transferencias_conta_origem
  on public.transferencias_contas (conta_origem_id);
create index if not exists idx_transferencias_conta_destino
  on public.transferencias_contas (conta_destino_id);

create trigger trg_transferencias_updated_at
  before update on public.transferencias_contas
  for each row execute function public.set_updated_at();

alter table public.transferencias_contas enable row level security;

create policy transferencias_select on public.transferencias_contas
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
  );

revoke all on public.transferencias_contas from public, anon;
grant select on public.transferencias_contas to authenticated;


-- ---------------------------------------------------------------------
-- Lançamentos: a perna da transferência
-- ---------------------------------------------------------------------

alter table public.lancamentos_financeiros
  add column if not exists transferencia_id uuid
    references public.transferencias_contas(id) on delete restrict;

comment on column public.lancamentos_financeiros.transferencia_id is
  'Transferência entre contas (decisão 124) de que esta linha é uma perna. Só nas origens transferencia_saida e transferencia_entrada, que não têm empresa nem plano.';

create unique index if not exists uniq_transferencia_perna
  on public.lancamentos_financeiros (transferencia_id, origem)
  where transferencia_id is not null;

alter table public.lancamentos_financeiros
  alter column empresa_id drop not null,
  alter column plano_conta_tipo_id drop not null,
  alter column plano_conta_subtipo_id drop not null;

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
      origem not in ('transferencia_saida', 'transferencia_entrada')
      and empresa_id is not null
      and plano_conta_tipo_id is not null
      and plano_conta_subtipo_id is not null
      and transferencia_id is null
    )
  );

-- Os dois CHECKs de origem: mesmos ramos de antes + o da transferência.
alter table public.lancamentos_financeiros drop constraint chk_origem_tem_referencia;
alter table public.lancamentos_financeiros
  add constraint chk_origem_tem_referencia check (
    ((origem = ANY (ARRAY['pp_baixa'::origem_lancamento, 'pp_baixa_estornada'::origem_lancamento, 'pp_estorno'::origem_lancamento])) AND (pedido_compra_id IS NOT NULL) AND (conta_avulsa_id IS NULL) AND (titulo_receber_id IS NULL) AND (desembolso_id IS NULL) AND (pp_verba_devolucao_id IS NULL))
    OR ((origem = ANY (ARRAY['avulsa_baixa'::origem_lancamento, 'avulsa_baixa_estornada'::origem_lancamento, 'avulsa_estorno'::origem_lancamento])) AND (conta_avulsa_id IS NOT NULL) AND (pedido_compra_id IS NULL) AND (titulo_receber_id IS NULL) AND (desembolso_id IS NULL) AND (pp_verba_devolucao_id IS NULL))
    OR ((origem = ANY (ARRAY['titulo_baixa'::origem_lancamento, 'titulo_baixa_estornada'::origem_lancamento, 'titulo_estorno'::origem_lancamento])) AND (titulo_receber_id IS NOT NULL) AND (pedido_compra_id IS NULL) AND (conta_avulsa_id IS NULL) AND (desembolso_id IS NULL) AND (pp_verba_devolucao_id IS NULL))
    OR ((origem = ANY (ARRAY['desembolso_baixa'::origem_lancamento, 'desembolso_baixa_estornada'::origem_lancamento, 'desembolso_estorno'::origem_lancamento])) AND (desembolso_id IS NOT NULL) AND (pedido_compra_id IS NULL) AND (conta_avulsa_id IS NULL) AND (titulo_receber_id IS NULL) AND (pp_verba_devolucao_id IS NULL))
    OR ((origem = ANY (ARRAY['pp_devolucao_verba'::origem_lancamento, 'pp_devolucao_verba_estornada'::origem_lancamento, 'pp_devolucao_verba_estorno'::origem_lancamento])) AND (pp_verba_devolucao_id IS NOT NULL) AND (pedido_compra_id IS NOT NULL) AND (conta_avulsa_id IS NULL) AND (titulo_receber_id IS NULL) AND (desembolso_id IS NULL))
    OR ((origem = ANY (ARRAY['fatura_cartao_baixa'::origem_lancamento, 'fatura_cartao_baixa_estornada'::origem_lancamento, 'fatura_cartao_estorno'::origem_lancamento])) AND (fatura_cartao_id IS NOT NULL) AND (pedido_compra_id IS NULL) AND (conta_avulsa_id IS NULL) AND (titulo_receber_id IS NULL) AND (desembolso_id IS NULL) AND (pp_verba_devolucao_id IS NULL))
    OR ((origem = 'manual'::origem_lancamento) AND (pedido_compra_id IS NULL) AND (conta_avulsa_id IS NULL) AND (titulo_receber_id IS NULL) AND (desembolso_id IS NULL) AND (pp_verba_devolucao_id IS NULL))
    OR ((origem = ANY (ARRAY['transferencia_saida'::origem_lancamento, 'transferencia_entrada'::origem_lancamento])) AND (pedido_compra_id IS NULL) AND (conta_avulsa_id IS NULL) AND (titulo_receber_id IS NULL) AND (desembolso_id IS NULL) AND (pp_verba_devolucao_id IS NULL) AND (fatura_cartao_id IS NULL))
  );

alter table public.lancamentos_financeiros drop constraint chk_origem_contraparte_tem_id;
alter table public.lancamentos_financeiros
  add constraint chk_origem_contraparte_tem_id check (
    ((origem = ANY (ARRAY['pp_baixa'::origem_lancamento, 'pp_baixa_estornada'::origem_lancamento, 'pp_estorno'::origem_lancamento])) AND (pedido_compra_id IS NOT NULL))
    OR ((origem = ANY (ARRAY['avulsa_baixa'::origem_lancamento, 'avulsa_baixa_estornada'::origem_lancamento, 'avulsa_estorno'::origem_lancamento])) AND (conta_avulsa_id IS NOT NULL))
    OR ((origem = ANY (ARRAY['titulo_baixa'::origem_lancamento, 'titulo_baixa_estornada'::origem_lancamento, 'titulo_estorno'::origem_lancamento])) AND (titulo_receber_id IS NOT NULL))
    OR ((origem = ANY (ARRAY['desembolso_baixa'::origem_lancamento, 'desembolso_baixa_estornada'::origem_lancamento, 'desembolso_estorno'::origem_lancamento])) AND (desembolso_id IS NOT NULL))
    OR ((origem = ANY (ARRAY['pp_devolucao_verba'::origem_lancamento, 'pp_devolucao_verba_estornada'::origem_lancamento, 'pp_devolucao_verba_estorno'::origem_lancamento])) AND (pp_verba_devolucao_id IS NOT NULL) AND (pedido_compra_id IS NOT NULL))
    OR ((origem = ANY (ARRAY['fatura_cartao_baixa'::origem_lancamento, 'fatura_cartao_baixa_estornada'::origem_lancamento, 'fatura_cartao_estorno'::origem_lancamento])) AND (fatura_cartao_id IS NOT NULL))
    OR ((origem = 'manual'::origem_lancamento) AND (pedido_compra_id IS NULL) AND (conta_avulsa_id IS NULL) AND (titulo_receber_id IS NULL) AND (desembolso_id IS NULL) AND (pp_verba_devolucao_id IS NULL))
    OR ((origem = ANY (ARRAY['transferencia_saida'::origem_lancamento, 'transferencia_entrada'::origem_lancamento])) AND (transferencia_id IS NOT NULL))
  );

-- Regra de acesso: o ramo antigo, igual, + a linha de transferência.
drop policy lancamentos_select on public.lancamentos_financeiros;
create policy lancamentos_select on public.lancamentos_financeiros
  for select to authenticated
  using (
    (tenant_id in (select current_tenant_ids() as current_tenant_ids))
    and (
      can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
      or (
        empresa_id is null
        and transferencia_id is not null
        and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
      )
    )
  );

drop policy lancamentos_modify on public.lancamentos_financeiros;
create policy lancamentos_modify on public.lancamentos_financeiros
  for all to authenticated
  using (
    (tenant_id in (select current_tenant_ids() as current_tenant_ids))
    and (
      can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
      or (
        empresa_id is null
        and transferencia_id is not null
        and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
      )
    )
  )
  with check (
    (tenant_id in (select current_tenant_ids() as current_tenant_ids))
    and (
      can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
      or (
        empresa_id is null
        and transferencia_id is not null
        and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
      )
    )
  );


-- ---------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------

create or replace function public.gerar_codigo_transferencia(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_prox integer;
begin
  perform pg_advisory_xact_lock(hashtext('transferencia_seq_' || p_tenant_id::text));
  select coalesce(max(cast(substring(codigo from '^TR-(\d+)$') as integer)), 0) + 1
    into v_prox
    from public.transferencias_contas
   where tenant_id = p_tenant_id
     and codigo ~ '^TR-\d+$';
  return 'TR-' || lpad(v_prox::text, 5, '0');
end;
$$;

revoke all on function public.gerar_codigo_transferencia(uuid) from public, anon, authenticated;

-- Efetiva: as duas pernas no extrato, na data dada.
create or replace function public._efetivar_transferencia(
  p_transferencia_id uuid,
  p_data date,
  p_uid uuid
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tr       transferencias_contas%rowtype;
  v_origem   contas_bancarias%rowtype;
  v_destino  contas_bancarias%rowtype;
  v_desc     text;
  v_saida    uuid;
  v_entrada  uuid;
begin
  select * into v_tr from public.transferencias_contas where id = p_transferencia_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if v_tr.status <> 'a_transferir' then
    raise exception 'Esta transferência já foi feita.';
  end if;
  if p_data is null then raise exception 'Informe a data da transferência.'; end if;

  select * into v_origem from public.contas_bancarias where id = v_tr.conta_origem_id;
  select * into v_destino from public.contas_bancarias where id = v_tr.conta_destino_id;
  if not v_origem.ativo or not v_destino.ativo then
    raise exception 'Uma das contas está inativa.';
  end if;
  if p_data < v_origem.saldo_inicial_data or p_data < v_destino.saldo_inicial_data then
    raise exception 'A data da transferência é anterior à data do saldo inicial de uma das contas.';
  end if;

  v_desc := 'Transferência ' || v_tr.codigo || ' · ' || v_origem.nome || ' → ' || v_destino.nome
            || coalesce(' — ' || nullif(btrim(v_tr.descricao), ''), '');

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor, natureza,
    descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    transferencia_id, origem, criado_por
  ) values (
    v_tr.tenant_id, null, v_origem.id, p_data, v_tr.valor, 'saida',
    substring(v_desc, 1, 300), null, null,
    v_tr.id, 'transferencia_saida', p_uid
  )
  returning id into v_saida;

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor, natureza,
    descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    transferencia_id, origem, criado_por
  ) values (
    v_tr.tenant_id, null, v_destino.id, p_data, v_tr.valor, 'entrada',
    substring(v_desc, 1, 300), null, null,
    v_tr.id, 'transferencia_entrada', p_uid
  )
  returning id into v_entrada;

  update public.transferencias_contas
     set status = 'transferida', transferida_em = p_data, transferida_por = p_uid
   where id = v_tr.id;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_tr.tenant_id, 'transferencia_contas', v_tr.id::text,
    'transferencia.efetivada', p_uid,
    jsonb_build_object(
      'codigo', v_tr.codigo, 'data', p_data, 'valor', v_tr.valor,
      'conta_origem_id', v_origem.id, 'conta_destino_id', v_destino.id,
      'lancamentos', jsonb_build_array(v_saida, v_entrada)
    )
  );

  return array[v_saida, v_entrada];
end;
$$;

revoke all on function public._efetivar_transferencia(uuid, date, uuid) from public, anon, authenticated;

-- p_dados: conta_origem_id, conta_destino_id, valor, data_prevista, descricao.
-- p_transferir = true é o "Criar e dar baixa": já nasce transferida, na
-- data prevista.
create or replace function public.criar_transferencia(
  p_dados jsonb,
  p_transferir boolean
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid      uuid := auth.uid();
  v_origem   contas_bancarias%rowtype;
  v_destino  contas_bancarias%rowtype;
  v_valor    numeric := round((p_dados->>'valor')::numeric, 2);
  v_data     date := (p_dados->>'data_prevista')::date;
  v_id       uuid;
  v_codigo   text;
begin
  if v_uid is null then raise exception 'Sessão inválida.'; end if;

  select * into v_origem from public.contas_bancarias where id = (p_dados->>'conta_origem_id')::uuid;
  if not found then raise exception 'Escolha a conta de origem.'; end if;
  select * into v_destino from public.contas_bancarias where id = (p_dados->>'conta_destino_id')::uuid;
  if not found then raise exception 'Escolha a conta de destino.'; end if;

  if not (public.is_tenant_admin(v_origem.tenant_id) or public.is_tenant_financeiro(v_origem.tenant_id)) then
    raise exception 'Apenas admin ou financeiro pode lançar transferência entre contas.'
      using errcode = '42501';
  end if;
  if v_destino.tenant_id <> v_origem.tenant_id then
    raise exception 'Conta de destino de outro tenant.';
  end if;
  if v_origem.id = v_destino.id then
    raise exception 'A conta de destino precisa ser diferente da de origem.';
  end if;
  if v_origem.cartao_credito_id is not null or v_destino.cartao_credito_id is not null then
    raise exception 'Transferência é entre contas bancárias, não com o cartão.';
  end if;
  if not v_origem.ativo or not v_destino.ativo then
    raise exception 'Uma das contas está inativa.';
  end if;
  if v_origem.empresa_contabil_id is distinct from v_destino.empresa_contabil_id then
    raise exception 'Transferência só entre contas do mesmo CNPJ. Entre CNPJs diferentes o dinheiro muda de dono, e esse caso ainda vai ser definido.';
  end if;
  if v_valor is null or v_valor <= 0 then raise exception 'Informe o valor da transferência.'; end if;
  if v_data is null then raise exception 'Informe a data.'; end if;

  v_codigo := public.gerar_codigo_transferencia(v_origem.tenant_id);

  insert into public.transferencias_contas (
    tenant_id, codigo, conta_origem_id, conta_destino_id, valor, data_prevista,
    descricao, criado_por
  ) values (
    v_origem.tenant_id, v_codigo, v_origem.id, v_destino.id, v_valor, v_data,
    nullif(btrim(coalesce(p_dados->>'descricao', '')), ''), v_uid
  )
  returning id into v_id;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_origem.tenant_id, 'transferencia_contas', v_id::text,
    'transferencia.criada', v_uid,
    jsonb_build_object(
      'codigo', v_codigo, 'valor', v_valor, 'data_prevista', v_data,
      'conta_origem_id', v_origem.id, 'conta_destino_id', v_destino.id,
      'ja_transferida', coalesce(p_transferir, false)
    )
  );

  if coalesce(p_transferir, false) then
    perform public._efetivar_transferencia(v_id, v_data, v_uid);
  end if;

  return v_id;
end;
$$;

revoke all on function public.criar_transferencia(jsonb, boolean) from public, anon;
grant execute on function public.criar_transferencia(jsonb, boolean) to authenticated;

-- "Dar baixa" numa transferência que nasceu a transferir.
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
  return public._efetivar_transferencia(p_transferencia_id, p_data, v_uid);
end;
$$;

revoke all on function public.dar_baixa_transferencia(uuid, date) from public, anon;
grant execute on function public.dar_baixa_transferencia(uuid, date) to authenticated;

-- Cancelar (decisão 120, D12): as duas pernas saem do extrato, sem linha
-- nova, e a transferência volta a "a transferir".
create or replace function public.cancelar_baixa_transferencia(
  p_transferencia_id uuid,
  p_motivo text
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid;
  v_tr     transferencias_contas%rowtype;
  v_perna  record;
  v_ids    uuid[] := '{}';
begin
  select * into v_tr from public.transferencias_contas where id = p_transferencia_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;

  v_uid := public._baixa_exige_financeiro(v_tr.tenant_id);

  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Explique o motivo do cancelamento em pelo menos 10 caracteres.';
  end if;
  if v_tr.status <> 'transferida' then
    raise exception 'Esta transferência ainda não foi feita.';
  end if;

  for v_perna in
    select l.id from public.lancamentos_financeiros l
     where l.transferencia_id = p_transferencia_id
     for update
  loop
    perform public._apagar_lancamento_de_baixa(v_perna.id);
    v_ids := v_ids || v_perna.id;
  end loop;

  update public.transferencias_contas
     set status = 'a_transferir', transferida_em = null, transferida_por = null
   where id = p_transferencia_id;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_tr.tenant_id, 'transferencia_contas', v_tr.id::text,
    'transferencia.baixa_cancelada', v_uid,
    jsonb_build_object(
      'codigo', v_tr.codigo, 'motivo', btrim(p_motivo), 'valor', v_tr.valor,
      'data', v_tr.transferida_em, 'lancamentos_apagados', to_jsonb(v_ids)
    )
  );

  return v_ids;
end;
$$;

revoke all on function public.cancelar_baixa_transferencia(uuid, text) from public, anon;
grant execute on function public.cancelar_baixa_transferencia(uuid, text) to authenticated;
