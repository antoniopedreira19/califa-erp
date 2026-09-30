-- =====================================================================
-- Recebimento antes da NF (decisão 130, Tiago, 28–29/09/2026)
-- =====================================================================
--
-- O cliente pagou e a nota ainda não saiu. O financeiro registra o
-- recebimento na linha da aba Faturamento — a nota do envio (decisão 123)
-- ou o BV — e o dinheiro entra no extrato na hora, como recebido do
-- cliente (no BV, do fornecedor). Quando a NF daquela linha é emitida, o
-- recebimento vira a PARCELA 1 dela, já quitada, com a data dele: nada
-- entra de novo na conta.
--
-- Respostas do Tiago (29/09): E1 a (preso à nota: cada CNPJ é uma linha,
-- com NF própria), E2 a (só depois do envio para faturamento), E3 a
-- (parcela 1 = o recebido; o resto sai dos vencimentos do envio, abatidos
-- em ordem, na emissão), E4 a (vários recebimentos por nota viram baixas
-- da parcela 1), E5 a (sem retenção), E6 a (cancelar a NF devolve o
-- recebimento para "antes da NF", sem tirar nada do extrato). BV entra
-- também.
--
-- Como fica:
--
-- 1. `recebimentos_antes_nf`: um por recebimento, preso à nota do envio OU
--    ao item de BV, com o lançamento dele. Situação: aguardando → aplicado
--    (na emissão) ou cancelado. As FKs para a nota e o BV são RESTRICT: um
--    envio com dinheiro recebido não some por baixo.
-- 2. O lançamento nasce com a origem nova `recebimento_antes_nf` (migration
--    anterior), com empresa e centro de custo, preso ao job. Os CHECKs de
--    origem da tabela de lançamentos ganham o ramo dele.
-- 3. `registrar_recebimento_antes_nf` e `cancelar_recebimento_antes_nf`
--    (só admin ou financeiro). O valor vai até o saldo a faturar da linha
--    menos o que já foi recebido antes.
-- 4. `emitir_faturamento` aplica os recebimentos das notas (ou do BV) que a
--    nota cobre: a parcela 1 precisa valer a soma deles; os lançamentos
--    viram as baixas dela (origem `titulo_baixa`, empresa da nota) e ela
--    nasce paga.
-- 5. `cancelar_faturamento` desfaz isso antes de conferir as baixas: os
--    lançamentos voltam a `recebimento_antes_nf` e os recebimentos a
--    aguardando (E6). Recusa se a parcela tiver estorno.
-- 6. `cancelar_baixa_lancamento` (decisão 125): a baixa que veio de um
--    recebimento antes da NF desfaz o recebimento junto.
-- 7. `vw_fluxo_caixa`: a previsão da nota do envio desconta o recebido
--    antes, abatido nos vencimentos em ordem — o dinheiro já está no
--    realizado do job, e contaria duas vezes.
--
-- As três funções e a view são editadas pela definição publicada, com cada
-- ponto de inserção conferido para existir UMA vez — o padrão das
-- migrations 20260922140002 e 20260929800002.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------

create table if not exists public.recebimentos_antes_nf (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete restrict,
  empresa_id           uuid not null references public.empresas(id),
  envio_nota_id        uuid references public.jobs_envio_faturamento_notas(id) on delete restrict,
  item_bv_id           uuid references public.itens_bv(id) on delete restrict,
  job_id               uuid references public.jobs(id),
  cliente_id           uuid references public.clientes(id),
  fornecedor_id        uuid references public.fornecedores(id),
  lancamento_id        uuid references public.lancamentos_financeiros(id) on delete restrict,
  valor                numeric(14,2) not null,
  data                 date not null,
  conta_bancaria_id    uuid not null references public.contas_bancarias(id),
  status               text not null default 'aguardando',
  faturamento_id       uuid references public.faturamentos(id),
  titulo_receber_id    uuid references public.titulos_receber(id),
  aplicado_em          timestamptz,
  criado_por           uuid not null references public.profiles(id),
  created_at           timestamptz not null default now(),
  cancelado_por        uuid references public.profiles(id),
  cancelado_em         timestamptz,
  motivo_cancelamento  text,
  constraint chk_recebimento_antes_nf_valor check (valor > 0),
  constraint chk_recebimento_antes_nf_alvo
    check ((envio_nota_id is null) <> (item_bv_id is null)),
  constraint chk_recebimento_antes_nf_status
    check (status in ('aguardando', 'aplicado', 'cancelado')),
  constraint chk_recebimento_antes_nf_estado check (
    (status = 'aguardando' and lancamento_id is not null and faturamento_id is null)
    or (status = 'aplicado' and lancamento_id is not null
        and faturamento_id is not null and titulo_receber_id is not null)
    or (status = 'cancelado' and lancamento_id is null and cancelado_em is not null)
  )
);

comment on table public.recebimentos_antes_nf is
  'Recebimento registrado antes da emissão da NF (decisão 130): preso à nota do envio ou ao BV; vira a parcela 1 da NF na emissão.';

create index if not exists idx_recebimentos_antes_nf_tenant on public.recebimentos_antes_nf (tenant_id, status);
create index if not exists idx_recebimentos_antes_nf_nota on public.recebimentos_antes_nf (envio_nota_id) where envio_nota_id is not null;
create index if not exists idx_recebimentos_antes_nf_bv on public.recebimentos_antes_nf (item_bv_id) where item_bv_id is not null;
create index if not exists idx_recebimentos_antes_nf_lancamento on public.recebimentos_antes_nf (lancamento_id) where lancamento_id is not null;
create index if not exists idx_recebimentos_antes_nf_faturamento on public.recebimentos_antes_nf (faturamento_id) where faturamento_id is not null;
create index if not exists idx_recebimentos_antes_nf_job on public.recebimentos_antes_nf (job_id);

alter table public.recebimentos_antes_nf enable row level security;

drop policy if exists recebimentos_antes_nf_select on public.recebimentos_antes_nf;
create policy recebimentos_antes_nf_select on public.recebimentos_antes_nf
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
  );

revoke all on table public.recebimentos_antes_nf from public, anon;
revoke insert, update, delete, truncate, references, trigger on table public.recebimentos_antes_nf from authenticated;
grant select on table public.recebimentos_antes_nf to authenticated;

-- ---------------------------------------------------------------------
-- 2. Os CHECKs de origem do lançamento ganham o ramo da origem nova
-- ---------------------------------------------------------------------
-- Cada um recebe um ramo a mais no fim da cadeia de OR; o resto fica como
-- está (todas as linhas atuais continuam valendo).

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.lancamentos_financeiros'::regclass
     and conname = 'chk_origem_tem_referencia';
  if v_def is null or right(v_def, 2) <> '))' then
    raise exception 'chk_origem_tem_referencia em formato inesperado: %', v_def;
  end if;
  alter table public.lancamentos_financeiros drop constraint chk_origem_tem_referencia;
  execute 'alter table public.lancamentos_financeiros add constraint chk_origem_tem_referencia '
    || left(v_def, length(v_def) - 2)
    || ' OR ((origem = ''recebimento_antes_nf''::origem_lancamento) AND (pedido_compra_id IS NULL)'
    || ' AND (conta_avulsa_id IS NULL) AND (titulo_receber_id IS NULL) AND (desembolso_id IS NULL)'
    || ' AND (pp_verba_devolucao_id IS NULL) AND (fatura_cartao_id IS NULL) AND (transferencia_id IS NULL))))';

  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.lancamentos_financeiros'::regclass
     and conname = 'chk_origem_contraparte_tem_id';
  if v_def is null or right(v_def, 2) <> '))' then
    raise exception 'chk_origem_contraparte_tem_id em formato inesperado: %', v_def;
  end if;
  alter table public.lancamentos_financeiros drop constraint chk_origem_contraparte_tem_id;
  execute 'alter table public.lancamentos_financeiros add constraint chk_origem_contraparte_tem_id '
    || left(v_def, length(v_def) - 2)
    || ' OR ((origem = ''recebimento_antes_nf''::origem_lancamento) AND (job_id IS NOT NULL))))';
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Registrar e cancelar
-- ---------------------------------------------------------------------

create or replace function public.registrar_recebimento_antes_nf(
  p_envio_nota_id      uuid,
  p_item_bv_id         uuid,
  p_data               date,
  p_conta_bancaria_id  uuid,
  p_valor              numeric,
  p_tipo_id            uuid,
  p_subtipo_id         uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid           uuid;
  v_tenant        uuid;
  v_empresa       uuid;
  v_job           uuid;
  v_cliente       uuid;
  v_fornecedor    uuid;
  v_codigo        text;
  v_descricao     text;
  v_linhas        integer;
  v_saldo         numeric;
  v_ja            numeric;
  v_cabe          numeric;
  v_valor         numeric := round(p_valor, 2);
  v_conta         contas_bancarias%rowtype;
  v_subtipo_tipo  uuid;
  v_regional      uuid;
  v_lancamento    uuid;
  v_id            uuid;
begin
  if (p_envio_nota_id is null) = (p_item_bv_id is null) then
    raise exception 'Informe a nota do envio ou o BV.';
  end if;
  if p_data is null then
    raise exception 'Informe a data do recebimento.';
  end if;

  -- A linha da aba Faturamento: a nota inteira (a soma dos vencimentos
  -- dela) ou o BV. Tranca a nota ou o BV antes de somar, para dois
  -- registros ao mesmo tempo não passarem juntos do saldo.
  if p_envio_nota_id is not null then
    perform 1 from public.jobs_envio_faturamento_notas where id = p_envio_nota_id for update;
  else
    perform 1 from public.itens_bv where id = p_item_bv_id for update;
  end if;

  select (array_agg(v.tenant_id))[1], (array_agg(v.empresa_id))[1], (array_agg(v.job_id))[1],
         (array_agg(v.cliente_id))[1], (array_agg(v.fornecedor_id))[1],
         (array_agg(v.codigo))[1], (array_agg(v.descricao))[1],
         count(*), coalesce(sum(v.saldo), 0)
    into v_tenant, v_empresa, v_job, v_cliente, v_fornecedor, v_codigo, v_descricao,
         v_linhas, v_saldo
    from public.vw_faturamento_pendente v
   where (p_envio_nota_id is not null and v.envio_nota_id = p_envio_nota_id)
      or (p_item_bv_id is not null and v.origem_tipo = 'bv' and v.origem_id = p_item_bv_id);

  if v_linhas = 0 then
    raise exception 'Esta linha não está mais aguardando faturamento.';
  end if;

  v_uid := public._exige_financeiro_para_baixar(v_tenant);

  if v_empresa is null or v_job is null then
    raise exception 'Esta linha não tem empresa ou job para o recebimento.';
  end if;

  select coalesce(sum(r.valor), 0) into v_ja
    from public.recebimentos_antes_nf r
   where r.status = 'aguardando'
     and ((p_envio_nota_id is not null and r.envio_nota_id = p_envio_nota_id)
       or (p_item_bv_id is not null and r.item_bv_id = p_item_bv_id));

  v_cabe := round(v_saldo - v_ja, 2);
  if v_valor is null or v_valor <= 0 then
    raise exception 'Informe o valor recebido.';
  end if;
  if v_valor > v_cabe + 0.004 then
    raise exception 'O valor passa do saldo a faturar (R$ %).',
      translate(to_char(greatest(v_cabe, 0), 'FM999,999,990.00'), ',.', '.,');
  end if;

  if p_tipo_id is null or p_subtipo_id is null then
    raise exception 'Selecione o centro de custo do recebimento.';
  end if;
  select tipo_id into v_subtipo_tipo from public.plano_contas_subtipos where id = p_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  v_conta := public._conta_da_baixa(p_conta_bancaria_id, v_tenant, p_data, 'recebimento');

  select regional_id into v_regional from public.jobs where id = v_job;

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, regional_id,
    origem, criado_por
  ) values (
    v_tenant, v_empresa, p_conta_bancaria_id, p_data, v_valor,
    'entrada',
    'Recebimento antes da NF · ' || coalesce(v_codigo || ' · ', '') || substring(coalesce(v_descricao, ''), 1, 120),
    p_tipo_id, p_subtipo_id,
    v_fornecedor, v_cliente, v_job, v_regional,
    'recebimento_antes_nf', v_uid
  )
  returning id into v_lancamento;

  insert into public.recebimentos_antes_nf (
    tenant_id, empresa_id, envio_nota_id, item_bv_id, job_id, cliente_id, fornecedor_id,
    lancamento_id, valor, data, conta_bancaria_id, criado_por
  ) values (
    v_tenant, v_empresa, p_envio_nota_id, p_item_bv_id, v_job, v_cliente, v_fornecedor,
    v_lancamento, v_valor, p_data, p_conta_bancaria_id, v_uid
  )
  returning id into v_id;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_tenant, 'recebimento_antes_nf', v_id::text,
    'recebimento_antes_nf.registrado', v_uid,
    jsonb_build_object(
      'job_id', v_job,
      'codigo', v_codigo,
      'envio_nota_id', p_envio_nota_id,
      'item_bv_id', p_item_bv_id,
      'valor', v_valor,
      'data', p_data,
      'conta_bancaria_id', p_conta_bancaria_id,
      'lancamento_id', v_lancamento
    )
  );

  return v_id;
end;
$$;

revoke all on function public.registrar_recebimento_antes_nf(uuid, uuid, date, uuid, numeric, uuid, uuid) from public, anon;
grant execute on function public.registrar_recebimento_antes_nf(uuid, uuid, date, uuid, numeric, uuid, uuid) to authenticated;

create or replace function public.cancelar_recebimento_antes_nf(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid  uuid;
  v_rec  recebimentos_antes_nf%rowtype;
begin
  select * into v_rec from public.recebimentos_antes_nf where id = p_id for update;
  if not found then raise exception 'Recebimento não encontrado.'; end if;

  v_uid := public._baixa_exige_financeiro(v_rec.tenant_id);

  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Explique o motivo do cancelamento em pelo menos 10 caracteres.';
  end if;
  if v_rec.status = 'aplicado' then
    raise exception 'Este recebimento já entrou numa nota. Para desfazer, cancele a baixa da parcela 1 em Títulos a Receber.';
  end if;
  if v_rec.status <> 'aguardando' then
    raise exception 'Este recebimento já foi cancelado.';
  end if;

  update public.recebimentos_antes_nf
     set status = 'cancelado',
         lancamento_id = null,
         cancelado_em = now(),
         cancelado_por = v_uid,
         motivo_cancelamento = btrim(p_motivo)
   where id = p_id;

  -- O lançamento sai do extrato, sem linha nova (decisão 120).
  delete from public.lancamentos_financeiros where id = v_rec.lancamento_id;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_rec.tenant_id, 'recebimento_antes_nf', v_rec.id::text,
    'recebimento_antes_nf.cancelado', v_uid,
    jsonb_build_object(
      'motivo', btrim(p_motivo),
      'lancamento_apagado', v_rec.lancamento_id,
      'valor', v_rec.valor,
      'data', v_rec.data,
      'conta_bancaria_id', v_rec.conta_bancaria_id,
      'job_id', v_rec.job_id
    )
  );
end;
$$;

revoke all on function public.cancelar_recebimento_antes_nf(uuid, text) from public, anon;
grant execute on function public.cancelar_recebimento_antes_nf(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4–6. Emissão, cancelamento da NF e cancelamento da baixa
-- ---------------------------------------------------------------------

do $$
declare
  v_src  text;
  v_qtd  integer;
  v_de   text;
begin
  -- ---------- emitir_faturamento ----------
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'emitir_faturamento';

  select count(*) into v_qtd from regexp_matches(v_src, 'v_cnpj_tomador\s+text;\s*\nbegin', 'g');
  if v_qtd <> 1 then
    raise exception 'emitir_faturamento: esperava 1 fim de declarações, achei %.', v_qtd;
  end if;
  v_src := regexp_replace(v_src, '(v_cnpj_tomador\s+text;)(\s*\n)begin',
    E'\\1\n  -- 130: recebimento antes da NF\n'
    || E'  v_antes          recebimentos_antes_nf%rowtype;\n'
    || E'  v_antes_ultimo   recebimentos_antes_nf%rowtype;\n'
    || E'  v_antes_total    numeric(14,2) := 0;\n'
    || E'  v_titulo1        titulos_receber%rowtype;\\2begin');

  v_de := E'\n  return v_faturamento_id;\nend;';
  v_qtd := (length(v_src) - length(replace(v_src, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then
    raise exception 'emitir_faturamento: esperava 1 retorno final, achei %.', v_qtd;
  end if;
  v_src := replace(v_src, v_de, $bloco$

  -- 130: o recebimento antes da NF das notas do envio (ou do BV) que esta
  -- nota cobre vira a parcela 1, já paga. Os lançamentos dele passam a ser
  -- as baixas dela, na empresa da nota; nada entra de novo na conta.
  select coalesce(sum(r.valor), 0)::numeric(14,2) into v_antes_total
    from public.recebimentos_antes_nf r
   where r.tenant_id = v_tenant_id
     and r.status = 'aguardando'
     and (
       r.envio_nota_id in (
         select par.nota_id
           from jsonb_array_elements(v_itens) i
           join public.jobs_envio_faturamento_parcelas par
             on par.id = nullif(i->>'envio_parcela_id', '')::uuid)
       or r.item_bv_id in (
         select nullif(i->>'origem_id', '')::uuid
           from jsonb_array_elements(v_itens) i
          where i->>'origem_tipo' = 'bv')
     );

  if v_antes_total > 0 then
    if v_antes_total > v_valor_total + 0.004 then
      raise exception 'O recebido antes da NF (R$ %) passa do valor desta nota (R$ %).',
        translate(to_char(v_antes_total, 'FM999,999,990.00'), ',.', '.,'),
        translate(to_char(v_valor_total, 'FM999,999,990.00'), ',.', '.,');
    end if;

    select * into v_titulo1
      from public.titulos_receber
     where faturamento_id = v_faturamento_id and numero_parcela = 1;
    if not found or abs(v_titulo1.valor - v_antes_total) > 0.004 then
      raise exception 'A parcela 1 desta nota precisa ser o que foi recebido antes da NF (R$ %).',
        translate(to_char(v_antes_total, 'FM999,999,990.00'), ',.', '.,');
    end if;

    for v_antes in
      select r.*
        from public.recebimentos_antes_nf r
       where r.tenant_id = v_tenant_id
         and r.status = 'aguardando'
         and (
           r.envio_nota_id in (
             select par.nota_id
               from jsonb_array_elements(v_itens) i
               join public.jobs_envio_faturamento_parcelas par
                 on par.id = nullif(i->>'envio_parcela_id', '')::uuid)
           or r.item_bv_id in (
             select nullif(i->>'origem_id', '')::uuid
               from jsonb_array_elements(v_itens) i
              where i->>'origem_tipo' = 'bv')
         )
       order by r.data, r.created_at
         for update
    loop
      update public.lancamentos_financeiros
         set origem = 'titulo_baixa',
             titulo_receber_id = v_titulo1.id,
             empresa_id = v_empresa_id
       where id = v_antes.lancamento_id;

      update public.recebimentos_antes_nf
         set status = 'aplicado',
             faturamento_id = v_faturamento_id,
             titulo_receber_id = v_titulo1.id,
             aplicado_em = now()
       where id = v_antes.id;

      v_antes_ultimo := v_antes;
    end loop;

    update public.titulos_receber
       set status = 'pago',
           pago_em = v_antes_ultimo.data,
           pago_por = (select auth.uid()),
           conta_bancaria_recebimento_id = v_antes_ultimo.conta_bancaria_id,
           lancamento_id = v_antes_ultimo.lancamento_id
     where id = v_titulo1.id;

    -- Como na baixa: todas as parcelas recebidas, o BV da nota está recebido.
    if not exists (
      select 1 from public.titulos_receber
       where faturamento_id = v_faturamento_id and status = 'em_aberto'
    ) then
      update public.itens_bv set situacao = 'recebido'
       where id in (
         select fi.origem_id from public.faturamento_itens fi
          where fi.faturamento_id = v_faturamento_id and fi.origem_tipo = 'bv');
    end if;
  end if;

  return v_faturamento_id;
end;$bloco$);

  execute format(
    'create or replace function public.emitir_faturamento(payload jsonb) returns uuid '
    'language plpgsql security definer set search_path to %L as %L',
    'public', v_src);

  -- ---------- cancelar_faturamento ----------
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cancelar_faturamento';

  select count(*) into v_qtd from regexp_matches(v_src, 'v_bv\s+record;\s*\nbegin', 'g');
  if v_qtd <> 1 then
    raise exception 'cancelar_faturamento: esperava 1 fim de declarações, achei %.', v_qtd;
  end if;
  v_src := regexp_replace(v_src, '(v_bv\s+record;)(\s*\n)begin',
    E'\\1\n  v_antes     recebimentos_antes_nf%rowtype;\\2begin');

  v_de := '  -- Título com qualquer baixa, inteira ou parcial (decisão 125).';
  v_qtd := (length(v_src) - length(replace(v_src, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then
    raise exception 'cancelar_faturamento: esperava 1 conferência de baixas, achei %.', v_qtd;
  end if;
  v_src := replace(v_src, v_de, $bloco$  -- 130 (E6): o recebimento antes da NF volta a esperar a nota, sem sair
  -- do extrato. Com estorno na parcela, não dá para desfazer sozinho.
  if exists (
    select 1
      from public.recebimentos_antes_nf r
      join public.lancamentos_financeiros e on e.estorno_de_lancamento_id = r.lancamento_id
     where r.faturamento_id = p_faturamento_id and r.status = 'aplicado'
  ) then
    raise exception 'A parcela recebida antes da NF tem estorno. Cancele a baixa dela em Títulos a Receber antes de cancelar a NF.';
  end if;

  for v_antes in
    select * from public.recebimentos_antes_nf
     where faturamento_id = p_faturamento_id and status = 'aplicado'
       for update
  loop
    update public.lancamentos_financeiros
       set origem = 'recebimento_antes_nf',
           titulo_receber_id = null,
           empresa_id = v_antes.empresa_id
     where id = v_antes.lancamento_id;

    update public.recebimentos_antes_nf
       set status = 'aguardando',
           faturamento_id = null,
           titulo_receber_id = null,
           aplicado_em = null
     where id = v_antes.id;
  end loop;

  -- A parcela que só tinha o recebimento volta a ficar em aberto, para
  -- ser cancelada com as outras logo abaixo.
  update public.titulos_receber t
     set status = 'em_aberto',
         pago_em = null,
         pago_por = null,
         conta_bancaria_recebimento_id = null,
         lancamento_id = null
   where t.faturamento_id = p_faturamento_id
     and t.status = 'pago'
     and not exists (
       select 1 from public.lancamentos_financeiros l
        where l.titulo_receber_id = t.id and l.origem = 'titulo_baixa'
     );

  -- Título com qualquer baixa, inteira ou parcial (decisão 125).$bloco$);

  execute format(
    'create or replace function public.cancelar_faturamento(p_faturamento_id uuid, p_motivo text, p_cancelado_por uuid) returns void '
    'language plpgsql security definer set search_path to %L as %L',
    'public', v_src);

  -- ---------- cancelar_baixa_lancamento ----------
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cancelar_baixa_lancamento';

  v_de := '  -- Os retidos saem junto, pela FK em cascata.';
  v_qtd := (length(v_src) - length(replace(v_src, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then
    raise exception 'cancelar_baixa_lancamento: esperava 1 ponto de exclusão, achei %.', v_qtd;
  end if;
  v_src := replace(v_src, v_de, $bloco$  -- 130: a baixa que veio de um recebimento antes da NF desfaz o
  -- recebimento junto (o lançamento dele é este).
  update public.recebimentos_antes_nf
     set status = 'cancelado',
         lancamento_id = null,
         cancelado_em = now(),
         cancelado_por = v_uid,
         motivo_cancelamento = btrim(p_motivo)
   where lancamento_id = v_baixa.id;

  -- Os retidos saem junto, pela FK em cascata.$bloco$);

  execute format(
    'create or replace function public.cancelar_baixa_lancamento(p_lancamento_id uuid, p_motivo text) returns uuid '
    'language plpgsql security definer set search_path to %L as %L',
    'public', v_src);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Fluxo de caixa: a previsão da nota desconta o recebido antes
-- ---------------------------------------------------------------------

-- Quanto do recebido antes da NF cai em cada vencimento do envio: o total
-- da nota, abatido nos vencimentos em ordem, até o saldo de cada um.
-- SECURITY DEFINER (a view do fluxo é lida por quem não vê a tabela), mas
-- só responde a membro do tenant.
create or replace function public._antes_nf_abatido_da_parcela(p_parcela_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_par       jobs_envio_faturamento_parcelas%rowtype;
  v_recebido  numeric;
  v_antes     numeric;
  v_saldo     numeric;
begin
  select * into v_par from public.jobs_envio_faturamento_parcelas where id = p_parcela_id;
  if not found or not public.is_tenant_member(v_par.tenant_id) then
    return 0;
  end if;

  select coalesce(sum(r.valor), 0) into v_recebido
    from public.recebimentos_antes_nf r
   where r.envio_nota_id = v_par.nota_id and r.status = 'aguardando';
  if v_recebido <= 0 then
    return 0;
  end if;

  select coalesce(sum(p2.valor - coalesce((
           select sum(fi.valor)
             from public.faturamento_itens fi
             join public.faturamentos f on f.id = fi.faturamento_id
            where fi.envio_parcela_id = p2.id and f.status <> 'cancelado'), 0)), 0)
    into v_antes
    from public.jobs_envio_faturamento_parcelas p2
   where p2.nota_id = v_par.nota_id
     and (p2.ordem, p2.id) < (v_par.ordem, v_par.id);

  v_saldo := v_par.valor - coalesce((
    select sum(fi.valor)
      from public.faturamento_itens fi
      join public.faturamentos f on f.id = fi.faturamento_id
     where fi.envio_parcela_id = v_par.id and f.status <> 'cancelado'), 0);

  return greatest(0, least(v_saldo, v_recebido - v_antes));
end;
$$;

revoke all on function public._antes_nf_abatido_da_parcela(uuid) from public, anon;
grant execute on function public._antes_nf_abatido_da_parcela(uuid) to authenticated;

do $$
declare
  v_def  text;
  v_qtd  integer;
  v_de   text;
begin
  v_def := rtrim(btrim(pg_get_viewdef('public.vw_fluxo_caixa'::regclass)), ';');

  -- O vencimento do envio ganha a coluna do abatido.
  select count(*) into v_qtd from regexp_matches(v_def, 'SELECT pa\.id,(\s+)pa\.tenant_id,', 'g');
  if v_qtd <> 1 then
    raise exception 'vw_fluxo_caixa: esperava 1 início do CTE envio_saldo, achei %.', v_qtd;
  end if;
  v_def := regexp_replace(v_def, 'SELECT pa\.id,(\s+)pa\.tenant_id,',
    'SELECT pa.id,\1public._antes_nf_abatido_da_parcela(pa.id) AS abatido_antes_nf,\1pa.tenant_id,');

  -- A previsão própria do vencimento desconta o abatido.
  v_de := 'LEAST(s.valor, s.bruto_proprio) AS valor,';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then
    raise exception 'vw_fluxo_caixa: esperava 1 previsto de vencimento do envio, achei %.', v_qtd;
  end if;
  v_def := replace(v_def, v_de,
    '(GREATEST((0)::numeric, (LEAST(s.valor, s.bruto_proprio) - s.abatido_antes_nf)))::numeric(14,2) AS valor,');

  v_de := 'WHERE ((LEAST(s.valor, s.bruto_proprio) > (0)::numeric) AND';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then
    raise exception 'vw_fluxo_caixa: esperava 1 filtro de vencimento do envio, achei %.', v_qtd;
  end if;
  v_def := replace(v_def, v_de,
    'WHERE (((LEAST(s.valor, s.bruto_proprio) - s.abatido_antes_nf) > (0)::numeric) AND');

  execute 'create or replace view public.vw_fluxo_caixa as ' || v_def;
end;
$$;
