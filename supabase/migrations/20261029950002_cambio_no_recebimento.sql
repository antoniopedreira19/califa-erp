-- =============================================================================
-- O câmbio fechado no recebimento do job internacional (decisão 229), parte 2
-- =============================================================================
-- Hoje o recebimento antes da NF (decisão 130) é um valor só, em reais, até o
-- saldo a faturar. No internacional isso não fecha: o cliente paga em dólar,
-- o banco credita o bruto pela cotação do dia ("ORPAG ORIGEM EXTERIOR") e
-- debita o IOF à parte ("COBRANÇA DE I.O.F."). A diferença de cotação ou
-- ficava como previsão e parcela em aberto para sempre, ou não cabia no saldo
-- e o crédito do banco ficava sem par. O IOF era lançado pela regra do
-- histórico, sem job.
--
-- Decisões do Tiago (29/10/2026):
-- 1. No internacional, o recebimento antes da NF é o câmbio fechado: valor na
--    moeda, cotação do dia e o bruto em R$, que bate com o crédito do banco.
--    IOF (0,38% sugerido na tela, editável) e tarifa, se houver. Três
--    lançamentos ligados ao recebimento e ao job: a entrada bruta, a saída do
--    IOF e a saída da tarifa (origem `cambio_custo`, parte 1). Cada linha do
--    banco casa com o seu pelo motor de hoje (passo 1, antes da regra).
-- 2. Variação cambial: o teto aceita o convertido mesmo acima do saldo. A
--    diferença para o envio fica NO RECEBIMENTO (`variacao_cambial`), ligada
--    ao job: não é dinheiro, não vira lançamento (todo lançamento tem conta) e
--    não entra no extrato nem no fluxo. O envio fecha pelo convertido: a
--    variação soma no saldo a faturar da nota (fila, Faturar e fluxo), sem
--    previsão sobrando e sem parcela 2. O envio em si fica como a produção o
--    mandou: mexer no `valor_faturado` dele desligaria o "todo o faturamento
--    enviado" do job (`job_faturamento_todo_enviado`).
-- 3. A nota sai pelo convertido; a parcela 1 travada é a nota inteira.
-- 4. Conta nova no plano: 16 · Despesas de câmbio (001 IOF, 002 Tarifa de
--    câmbio), provisória até a revisão dos centros de custo.
-- 5. IOF e tarifa são custo do job: aqui eles nascem com o job. A leitura nos
--    relatórios (Resultado de job, `vw_job_rentabilidade`) entra no trabalho
--    dos relatórios, fora desta migration.
-- 6. Uma vez por nota: o câmbio fecha a nota de uma vez. Pagamento em duas
--    vezes fica para quando aparecer um caso.
--
-- Nada muda para o que já existe: sem câmbio, a variação é zero em todo
-- lugar.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. 16 · Despesas de câmbio
-- ---------------------------------------------------------------------------
insert into public.plano_contas_tipos (tenant_id, codigo, nome, natureza_padrao)
select distinct t.tenant_id, '16', 'Despesas de câmbio', 'saida'::public.natureza_padrao_tipo
  from public.plano_contas_tipos t
 where not exists (
   select 1 from public.plano_contas_tipos x where x.tenant_id = t.tenant_id and x.codigo = '16'
 );

insert into public.plano_contas_subtipos (tenant_id, tipo_id, codigo, nome)
select t.tenant_id, t.id, s.codigo, s.nome
  from public.plano_contas_tipos t
 cross join (values ('001', 'IOF'), ('002', 'Tarifa de câmbio')) as s(codigo, nome)
 where t.codigo = '16'
   and not exists (
     select 1 from public.plano_contas_subtipos x
      where x.tenant_id = t.tenant_id and x.tipo_id = t.id and x.codigo = s.codigo
   );

-- ---------------------------------------------------------------------------
-- 2. O câmbio no recebimento
-- ---------------------------------------------------------------------------
alter table public.recebimentos_antes_nf
  add column if not exists moeda text,
  add column if not exists valor_moeda numeric(14,2),
  add column if not exists cotacao numeric(12,6),
  add column if not exists iof numeric(14,2),
  add column if not exists tarifa numeric(14,2),
  add column if not exists variacao_cambial numeric(14,2),
  add column if not exists iof_lancamento_id uuid references public.lancamentos_financeiros(id) on delete set null,
  add column if not exists tarifa_lancamento_id uuid references public.lancamentos_financeiros(id) on delete set null;

comment on column public.recebimentos_antes_nf.moeda is
  'Decisão 229: a moeda do câmbio (a moeda estrangeira da versão aprovada). Nulo no recebimento em reais.';
comment on column public.recebimentos_antes_nf.valor_moeda is
  'Decisão 229: o valor recebido na moeda estrangeira. O `valor` é o bruto em R$ (valor_moeda × cotação).';
comment on column public.recebimentos_antes_nf.cotacao is
  'Decisão 229: a cotação do câmbio fechado no dia.';
comment on column public.recebimentos_antes_nf.iof is
  'Decisão 229: o IOF do câmbio, lançado à parte (iof_lancamento_id) em 16 · Despesas de câmbio · IOF.';
comment on column public.recebimentos_antes_nf.tarifa is
  'Decisão 229: a tarifa de câmbio, lançada à parte (tarifa_lancamento_id) em 16 · Despesas de câmbio · Tarifa de câmbio.';
comment on column public.recebimentos_antes_nf.variacao_cambial is
  'Decisão 229: o bruto menos o saldo a faturar da nota no momento do câmbio (+ ganho, − perda). Não é dinheiro: soma no saldo a faturar da nota, que fecha pelo convertido.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_recebimento_antes_nf_cambio') then
    alter table public.recebimentos_antes_nf
      add constraint chk_recebimento_antes_nf_cambio check (
        (moeda is null and valor_moeda is null and cotacao is null and iof is null
          and tarifa is null and variacao_cambial is null
          and iof_lancamento_id is null and tarifa_lancamento_id is null)
        or (moeda is not null and valor_moeda > 0 and cotacao > 0 and iof >= 0
          and tarifa >= 0 and variacao_cambial is not null and envio_nota_id is not null)
      );
  end if;
end
$$;

create index if not exists idx_recebimentos_antes_nf_iof_lancamento
  on public.recebimentos_antes_nf (iof_lancamento_id) where iof_lancamento_id is not null;
create index if not exists idx_recebimentos_antes_nf_tarifa_lancamento
  on public.recebimentos_antes_nf (tarifa_lancamento_id) where tarifa_lancamento_id is not null;

-- ---------------------------------------------------------------------------
-- 3. A origem `cambio_custo` nas travas do lançamento (só acrescenta)
-- ---------------------------------------------------------------------------
-- Uma cláusula a mais em cada CHECK: o custo do câmbio tem job e nenhuma das
-- chaves de documento. As demais cláusulas ficam como estão no ar.
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.lancamentos_financeiros'::regclass and conname = 'chk_origem_contraparte_tem_id';
  if position('cambio_custo' in v_def) = 0 then
    execute 'alter table public.lancamentos_financeiros drop constraint chk_origem_contraparte_tem_id';
    execute 'alter table public.lancamentos_financeiros add constraint chk_origem_contraparte_tem_id '
      || 'CHECK (' || substring(v_def from 7)
      || ' OR ((origem = ''cambio_custo''::origem_lancamento) AND (job_id IS NOT NULL)))';
  end if;

  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.lancamentos_financeiros'::regclass and conname = 'chk_origem_tem_referencia';
  if position('cambio_custo' in v_def) = 0 then
    execute 'alter table public.lancamentos_financeiros drop constraint chk_origem_tem_referencia';
    execute 'alter table public.lancamentos_financeiros add constraint chk_origem_tem_referencia '
      || 'CHECK (' || substring(v_def from 7)
      || ' OR ((origem = ''cambio_custo''::origem_lancamento) AND (pedido_compra_id IS NULL)'
      || ' AND (conta_avulsa_id IS NULL) AND (titulo_receber_id IS NULL) AND (desembolso_id IS NULL)'
      || ' AND (pp_verba_devolucao_id IS NULL) AND (fatura_cartao_id IS NULL) AND (transferencia_id IS NULL)'
      || ' AND (imposto_a_pagar_id IS NULL) AND (juros_de_lancamento_id IS NULL)))';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. A variação cambial da parcela do envio
-- ---------------------------------------------------------------------------
-- A variação dos recebimentos vivos da nota (aguardando ou já aplicados
-- numa NF), toda na primeira parcela dela. Zero sem câmbio.
create or replace function public._variacao_cambial_da_parcela(p_parcela_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select sum(r.variacao_cambial)
      from public.jobs_envio_faturamento_parcelas par
      join public.recebimentos_antes_nf r on r.envio_nota_id = par.nota_id
     where par.id = p_parcela_id
       and public.is_tenant_member(par.tenant_id)
       and r.status in ('aguardando', 'aplicado')
       and r.variacao_cambial is not null
       and par.id = (
         select p2.id
           from public.jobs_envio_faturamento_parcelas p2
          where p2.nota_id = par.nota_id
          order by p2.ordem, p2.id
          limit 1
       )
  ), 0)::numeric(14,2);
$function$;

revoke all on function public._variacao_cambial_da_parcela(uuid) from public, anon;
grant execute on function public._variacao_cambial_da_parcela(uuid) to authenticated;

-- O abatido do recebido antes da NF (fluxo de caixa) sobre o saldo com a
-- variação: senão, no câmbio acima do saldo, sobrava previsão.
create or replace function public._antes_nf_abatido_da_parcela(p_parcela_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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

  select coalesce(sum(p2.valor + public._variacao_cambial_da_parcela(p2.id) - coalesce((
           select sum(fi.valor)
             from public.faturamento_itens fi
             join public.faturamentos f on f.id = fi.faturamento_id
            where fi.envio_parcela_id = p2.id and f.status <> 'cancelado'), 0)), 0)
    into v_antes
    from public.jobs_envio_faturamento_parcelas p2
   where p2.nota_id = v_par.nota_id
     and (p2.ordem, p2.id) < (v_par.ordem, v_par.id);

  v_saldo := v_par.valor + public._variacao_cambial_da_parcela(v_par.id) - coalesce((
    select sum(fi.valor)
      from public.faturamento_itens fi
      join public.faturamentos f on f.id = fi.faturamento_id
     where fi.envio_parcela_id = v_par.id and f.status <> 'cancelado'), 0);

  return greatest(0, least(v_saldo, v_recebido - v_antes));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Registrar o câmbio fechado
-- ---------------------------------------------------------------------------
create or replace function public.registrar_recebimento_antes_nf_cambio(
  p_envio_nota_id uuid,
  p_data date,
  p_conta_bancaria_id uuid,
  p_valor_moeda numeric,
  p_cotacao numeric,
  p_bruto numeric,
  p_iof numeric,
  p_tarifa numeric,
  p_tipo_id uuid,
  p_subtipo_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid           uuid;
  v_tenant        uuid;
  v_empresa       uuid;
  v_job           uuid;
  v_cliente       uuid;
  v_codigo        text;
  v_descricao     text;
  v_linhas        integer;
  v_saldo         numeric;
  v_modelo        text;
  v_moeda         text;
  v_bruto         numeric := round(p_bruto, 2);
  v_iof           numeric := round(coalesce(p_iof, 0), 2);
  v_tarifa        numeric := round(coalesce(p_tarifa, 0), 2);
  v_variacao      numeric;
  v_conta         contas_bancarias%rowtype;
  v_subtipo_tipo  uuid;
  v_regional      uuid;
  v_tipo_cambio   uuid;
  v_sub_iof       uuid;
  v_sub_tarifa    uuid;
  v_lancamento    uuid;
  v_lanc_iof      uuid;
  v_lanc_tarifa   uuid;
  v_texto         text;
  v_id            uuid;
begin
  if p_envio_nota_id is null then
    raise exception 'Informe a nota do envio.';
  end if;
  if p_data is null then
    raise exception 'Informe a data do recebimento.';
  end if;

  perform 1 from public.jobs_envio_faturamento_notas where id = p_envio_nota_id for update;

  select (array_agg(v.tenant_id))[1], (array_agg(v.empresa_id))[1], (array_agg(v.job_id))[1],
         (array_agg(v.cliente_id))[1], (array_agg(v.codigo))[1], (array_agg(v.descricao))[1],
         count(*), coalesce(sum(v.saldo), 0)
    into v_tenant, v_empresa, v_job, v_cliente, v_codigo, v_descricao, v_linhas, v_saldo
    from public.vw_faturamento_pendente v
   where v.envio_nota_id = p_envio_nota_id;

  if v_linhas = 0 then
    raise exception 'Esta linha não está mais aguardando faturamento.';
  end if;

  v_uid := public._exige_financeiro_para_baixar(v_tenant);

  if v_empresa is null or v_job is null then
    raise exception 'Esta linha não tem empresa ou job para o recebimento.';
  end if;

  -- Só o job internacional fecha câmbio; a moeda é a da versão aprovada.
  select cd.modelo_planilha::text, nullif(btrim(v.moeda_estrangeira), '')
    into v_modelo, v_moeda
    from public.jobs j
    join public.orcamentos o on o.id = j.orcamento_id
    left join public.categorias_dominio cd on cd.id = o.categoria_id
    left join public.versoes_orcamento v on v.id = j.versao_orcamento_aprovada_id
   where j.id = v_job;
  if v_modelo is distinct from 'internacional' then
    raise exception 'O câmbio fechado é só do job internacional.';
  end if;
  if v_moeda is null then
    raise exception 'A versão aprovada deste job não tem moeda estrangeira.';
  end if;

  -- Uma vez por nota (decisão 229 §6): o câmbio fecha a nota inteira.
  if exists (
    select 1 from public.recebimentos_antes_nf r
     where r.envio_nota_id = p_envio_nota_id and r.status in ('aguardando', 'aplicado')
  ) then
    raise exception 'Esta nota já tem recebimento antes da NF: no internacional, o câmbio fecha a nota de uma vez.';
  end if;

  if p_valor_moeda is null or p_valor_moeda <= 0 then
    raise exception 'Informe o valor recebido em %.', v_moeda;
  end if;
  if p_cotacao is null or p_cotacao <= 0 then
    raise exception 'Informe a cotação do dia.';
  end if;
  if v_bruto is null or v_bruto <= 0 or abs(v_bruto - round(p_valor_moeda * p_cotacao, 2)) > 0.011 then
    raise exception 'O bruto em R$ precisa ser o valor em % vezes a cotação.', v_moeda;
  end if;
  if v_iof < 0 or v_tarifa < 0 then
    raise exception 'O IOF e a tarifa não podem ser negativos.';
  end if;
  if v_iof + v_tarifa >= v_bruto then
    raise exception 'O IOF e a tarifa passam do bruto recebido.';
  end if;

  if p_tipo_id is null or p_subtipo_id is null then
    raise exception 'Selecione o centro de custo do recebimento.';
  end if;
  select tipo_id into v_subtipo_tipo from public.plano_contas_subtipos where id = p_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  select t.id,
         (select s.id from public.plano_contas_subtipos s where s.tipo_id = t.id and s.codigo = '001'),
         (select s.id from public.plano_contas_subtipos s where s.tipo_id = t.id and s.codigo = '002')
    into v_tipo_cambio, v_sub_iof, v_sub_tarifa
    from public.plano_contas_tipos t
   where t.tenant_id = v_tenant and t.codigo = '16';
  if v_tipo_cambio is null or v_sub_iof is null or v_sub_tarifa is null then
    raise exception 'Falta no plano de contas: 16 · Despesas de câmbio (001 IOF, 002 Tarifa de câmbio).';
  end if;

  v_conta := public._conta_da_baixa(p_conta_bancaria_id, v_tenant, p_data, 'recebimento');

  select regional_id into v_regional from public.jobs where id = v_job;

  v_variacao := round(v_bruto - v_saldo, 2);
  v_texto := coalesce(v_codigo || ' · ', '') || substring(coalesce(v_descricao, ''), 1, 120);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    cliente_id, job_id, regional_id, origem, criado_por
  ) values (
    v_tenant, v_empresa, p_conta_bancaria_id, p_data, v_bruto,
    'entrada', 'Recebimento antes da NF · ' || v_texto,
    p_tipo_id, p_subtipo_id,
    v_cliente, v_job, v_regional, 'recebimento_antes_nf', v_uid
  )
  returning id into v_lancamento;

  if v_iof > 0 then
    insert into public.lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      cliente_id, job_id, regional_id, origem, criado_por
    ) values (
      v_tenant, v_empresa, p_conta_bancaria_id, p_data, v_iof,
      'saida', 'IOF do câmbio · ' || v_texto,
      v_tipo_cambio, v_sub_iof,
      v_cliente, v_job, v_regional, 'cambio_custo', v_uid
    )
    returning id into v_lanc_iof;
  end if;

  if v_tarifa > 0 then
    insert into public.lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      cliente_id, job_id, regional_id, origem, criado_por
    ) values (
      v_tenant, v_empresa, p_conta_bancaria_id, p_data, v_tarifa,
      'saida', 'Tarifa de câmbio · ' || v_texto,
      v_tipo_cambio, v_sub_tarifa,
      v_cliente, v_job, v_regional, 'cambio_custo', v_uid
    )
    returning id into v_lanc_tarifa;
  end if;

  insert into public.recebimentos_antes_nf (
    tenant_id, empresa_id, envio_nota_id, job_id, cliente_id,
    lancamento_id, valor, data, conta_bancaria_id, criado_por,
    moeda, valor_moeda, cotacao, iof, tarifa, variacao_cambial,
    iof_lancamento_id, tarifa_lancamento_id
  ) values (
    v_tenant, v_empresa, p_envio_nota_id, v_job, v_cliente,
    v_lancamento, v_bruto, p_data, p_conta_bancaria_id, v_uid,
    v_moeda, round(p_valor_moeda, 2), p_cotacao, v_iof, v_tarifa, v_variacao,
    v_lanc_iof, v_lanc_tarifa
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
      'cambio', true,
      'moeda', v_moeda,
      'valor_moeda', round(p_valor_moeda, 2),
      'cotacao', p_cotacao,
      'valor', v_bruto,
      'iof', v_iof,
      'tarifa', v_tarifa,
      'saldo_antes', v_saldo,
      'variacao_cambial', v_variacao,
      'data', p_data,
      'conta_bancaria_id', p_conta_bancaria_id,
      'lancamento_id', v_lancamento,
      'iof_lancamento_id', v_lanc_iof,
      'tarifa_lancamento_id', v_lanc_tarifa
    )
  );

  return v_id;
end;
$function$;

revoke all on function public.registrar_recebimento_antes_nf_cambio(uuid, date, uuid, numeric, numeric, numeric, numeric, numeric, uuid, uuid) from public, anon;
grant execute on function public.registrar_recebimento_antes_nf_cambio(uuid, date, uuid, numeric, numeric, numeric, numeric, numeric, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Cancelar leva junto o IOF e a tarifa
-- ---------------------------------------------------------------------------
create or replace function public.cancelar_recebimento_antes_nf(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- A variação cambial sai com o status: `_variacao_cambial_da_parcela` só
  -- conta recebimento aguardando ou aplicado (decisão 229).
  update public.recebimentos_antes_nf
     set status = 'cancelado',
         lancamento_id = null,
         iof_lancamento_id = null,
         tarifa_lancamento_id = null,
         cancelado_em = now(),
         cancelado_por = v_uid,
         motivo_cancelamento = btrim(p_motivo)
   where id = p_id;

  -- Os lançamentos saem do extrato, sem linha nova (decisão 120): o bruto e,
  -- no câmbio, o IOF e a tarifa (decisão 229).
  delete from public.lancamentos_financeiros
   where id in (v_rec.lancamento_id, v_rec.iof_lancamento_id, v_rec.tarifa_lancamento_id);

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_rec.tenant_id, 'recebimento_antes_nf', v_rec.id::text,
    'recebimento_antes_nf.cancelado', v_uid,
    jsonb_build_object(
      'motivo', btrim(p_motivo),
      'lancamento_apagado', v_rec.lancamento_id,
      'iof_lancamento_apagado', v_rec.iof_lancamento_id,
      'tarifa_lancamento_apagado', v_rec.tarifa_lancamento_id,
      'valor', v_rec.valor,
      'variacao_cambial', v_rec.variacao_cambial,
      'data', v_rec.data,
      'conta_bancaria_id', v_rec.conta_bancaria_id,
      'job_id', v_rec.job_id
    )
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. A nota pelo convertido: o saldo da parcela soma a variação
-- ---------------------------------------------------------------------------
do $$
declare
  v_src  text;
  v_de   constant text := 'v_saldo := v_par.valor - v_ja;';
  v_para constant text := 'v_saldo := v_par.valor + public._variacao_cambial_da_parcela(v_par.id) - v_ja;';
begin
  select prosrc into v_src
    from pg_proc
   where oid = 'public.emitir_faturamento(jsonb)'::regprocedure;

  if position('_variacao_cambial_da_parcela' in v_src) > 0 then
    return;
  end if;
  if (length(v_src) - length(replace(v_src, v_de, ''))) / length(v_de) <> 1 then
    raise exception 'emitir_faturamento: o trecho do saldo da parcela não está lá uma vez só';
  end if;

  execute format(
    $f$create or replace function public.emitir_faturamento(payload jsonb)
    returns uuid language plpgsql security definer set search_path to 'public'
    as %L$f$, replace(v_src, v_de, v_para));
end
$$;

-- ---------------------------------------------------------------------------
-- 8. A fila do Faturamento com a variação (coluna nova no fim)
-- ---------------------------------------------------------------------------
-- O "Valor" continua o que a produção enviou; o saldo a faturar e as partes
-- própria e de save somam a variação da nota.
create or replace view public.vw_faturamento_pendente as
 WITH parcela_faturada AS (
         SELECT fi.envio_parcela_id,
            sum(fi.valor)::numeric(14,2) AS valor_faturado,
            COALESCE(sum(fi.valor) FILTER (WHERE fi.origem_tipo <> 'save'::faturamento_origem), 0::numeric)::numeric(14,2) AS faturado_proprio,
            COALESCE(sum(fi.valor) FILTER (WHERE fi.origem_tipo = 'save'::faturamento_origem), 0::numeric)::numeric(14,2) AS faturado_save
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE f.status = 'emitido'::faturamento_status AND fi.envio_parcela_id IS NOT NULL
          GROUP BY fi.envio_parcela_id
        ), variacao AS (
         SELECT par.id,
            _variacao_cambial_da_parcela(par.id) AS variacao_cambial
           FROM jobs_envio_faturamento_parcelas par
        ), parcelas AS (
         SELECT par.id,
            par.envio_id,
            par.job_id,
            par.tenant_id,
            par.ordem,
            par.valor AS valor_enviado,
            (par.valor + va.variacao_cambial)::numeric(14,2) AS valor,
            va.variacao_cambial,
            par.data_vencimento,
            count(*) OVER (PARTITION BY par.envio_id)::smallint AS total,
            COALESCE(pf.valor_faturado, 0::numeric)::numeric(14,2) AS ja_faturado,
            COALESCE(pf.faturado_proprio, 0::numeric)::numeric(14,2) AS faturado_proprio,
            COALESCE(pf.faturado_save, 0::numeric)::numeric(14,2) AS faturado_save,
            (GREATEST(0::numeric, LEAST(par.valor,
                CASE
                    WHEN e.mes IS NOT NULL THEN e.valor_faturado - COALESCE(e.valor_save, 0::numeric)
                    ELSE COALESCE(j.faturamento_previsto, 0::numeric) - COALESCE(j.faturamento_save_previsto, 0::numeric)
                END - (sum(par.valor) OVER (PARTITION BY par.envio_id ORDER BY par.ordem, par.id) - par.valor))) + va.variacao_cambial)::numeric(14,2) AS bruto_proprio,
            e.mes,
            par.nota_id,
            n.ordem AS nota_ordem,
            (( SELECT count(*) AS count
                   FROM jobs_envio_faturamento_notas n2
                  WHERE n2.envio_id = par.envio_id))::smallint AS nota_total,
            n.cnpj AS nota_cnpj,
            n.cnae_sugerido AS nota_cnae_sugerido,
            n.descritivo AS nota_descritivo,
            n.tomador_exterior AS nota_tomador_exterior
           FROM jobs_envio_faturamento_parcelas par
             JOIN jobs_envio_faturamento e ON e.id = par.envio_id
             JOIN jobs j ON j.id = par.job_id
             JOIN jobs_envio_faturamento_notas n ON n.id = par.nota_id
             JOIN variacao va ON va.id = par.id
             LEFT JOIN parcela_faturada pf ON pf.envio_parcela_id = par.id
        )
 SELECT 'job'::text AS origem_tipo,
    j.id AS origem_id,
    j.tenant_id,
    j.empresa_id,
    j.codigo,
    j.nome AS descricao,
    j.cliente_id,
    NULL::uuid AS fornecedor_id,
    par.valor_enviado::numeric AS valor_previsto,
    par.ja_faturado AS valor_ja_faturado,
    (par.valor - par.ja_faturado)::numeric(14,2) AS saldo,
    par.data_vencimento AS data_prevista,
    par.id AS envio_parcela_id,
    par.ordem AS parcela_numero,
    par.total AS parcela_total,
    ( SELECT sum(x.valor - x.ja_faturado)::numeric(14,2) AS sum
           FROM parcelas x
          WHERE x.envio_id = par.envio_id AND (x.valor - x.ja_faturado) > 0::numeric) AS saldo_job,
    LEAST(par.valor, par.bruto_proprio) AS valor_proprio_da_parcela,
    (par.valor - LEAST(par.valor, par.bruto_proprio))::numeric(14,2) AS valor_save_da_parcela,
    GREATEST(0::numeric, LEAST(par.valor, par.bruto_proprio) - par.faturado_proprio)::numeric(14,2) AS saldo_proprio,
    GREATEST(0::numeric, par.valor - LEAST(par.valor, par.bruto_proprio) - par.faturado_save)::numeric(14,2) AS saldo_save,
    j.id AS job_id,
    par.mes AS mes_referencia,
    par.nota_id AS envio_nota_id,
    par.nota_ordem,
    par.nota_total,
    par.nota_cnpj AS cnpj_tomador,
    par.nota_cnae_sugerido AS cnae_sugerido,
    par.nota_descritivo AS descritivo_nota,
    pe.nome AS autor_nome,
    ef.enviado_em AS autor_em,
    par.nota_tomador_exterior AS tomador_exterior,
    par.variacao_cambial
   FROM parcelas par
     JOIN jobs j ON j.id = par.job_id
     JOIN projetos p ON p.id = j.projeto_id
     JOIN jobs_envio_faturamento ef ON ef.id = par.envio_id
     LEFT JOIN profiles pe ON pe.id = ef.enviado_por
  WHERE (j.status = ANY (ARRAY['aberto'::job_status, 'encerrado'::job_status, 'finalizado'::job_status])) AND (par.valor - par.ja_faturado) > 0::numeric
UNION ALL
 SELECT 'bv'::text AS origem_tipo,
    bv.id AS origem_id,
    bv.tenant_id,
    NULL::uuid AS empresa_id,
    jbv.codigo,
    'BV — '::text || COALESCE(v.item, jio.item) AS descricao,
    NULL::uuid AS cliente_id,
    bv.fornecedor_id,
    bv.valor AS valor_previsto,
    0::numeric(14,2) AS valor_ja_faturado,
    bv.valor AS saldo,
    bv.prazo_repasse AS data_prevista,
    NULL::uuid AS envio_parcela_id,
    1::smallint AS parcela_numero,
    1::smallint AS parcela_total,
    bv.valor AS saldo_job,
    bv.valor AS valor_proprio_da_parcela,
    0::numeric(14,2) AS valor_save_da_parcela,
    bv.valor AS saldo_proprio,
    0::numeric(14,2) AS saldo_save,
    jio.job_id,
    NULL::date AS mes_referencia,
    NULL::uuid AS envio_nota_id,
    NULL::smallint AS nota_ordem,
    NULL::smallint AS nota_total,
    NULL::text AS cnpj_tomador,
    NULL::text AS cnae_sugerido,
    NULL::text AS descritivo_nota,
    pb.nome AS autor_nome,
    bv.confirmado_em AS autor_em,
    false AS tomador_exterior,
    0::numeric(14,2) AS variacao_cambial
   FROM itens_bv bv
     LEFT JOIN versoes_orcamento_itens v ON v.id = bv.item_versao_id
     LEFT JOIN jobs_itens_orcado jio ON jio.id = bv.job_item_orcado_id
     LEFT JOIN jobs jbv ON jbv.id = jio.job_id
     LEFT JOIN profiles pb ON pb.id = bv.confirmado_por
  WHERE bv.situacao = 'confirmado'::bv_situacao AND NOT (EXISTS ( SELECT 1
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE fi.origem_tipo = 'bv'::faturamento_origem AND fi.origem_id = bv.id AND f.status = 'emitido'::faturamento_status));

-- ---------------------------------------------------------------------------
-- 9. O fluxo de caixa: a previsão do envio fecha pelo convertido
-- ---------------------------------------------------------------------------
-- Na definição no ar (`pg_get_viewdef`), o CTE `envio_saldo` soma a variação
-- ao saldo da parcela e à parte própria. Os dois trechos têm de estar lá uma
-- vez só.
do $$
declare
  v_def   text;
  c_de1   constant text := '(pa.valor - COALESCE(( SELECT sum(fi.valor) AS sum';
  c_para1 constant text := '(pa.valor + _variacao_cambial_da_parcela(pa.id) - COALESCE(( SELECT sum(fi.valor) AS sum';
  c_de2   constant text := '- pa.valor)))))::numeric(14,2) AS bruto_proprio';
  c_para2 constant text := '- pa.valor)))))::numeric(14,2) + _variacao_cambial_da_parcela(pa.id) AS bruto_proprio';
begin
  v_def := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  if position('_variacao_cambial_da_parcela' in v_def) > 0 then
    return;
  end if;
  if (length(v_def) - length(replace(v_def, c_de1, ''))) / length(c_de1) <> 1
     or (length(v_def) - length(replace(v_def, c_de2, ''))) / length(c_de2) <> 1 then
    raise exception 'public.vw_fluxo_caixa: os trechos do envio_saldo não estão lá uma vez só';
  end if;
  v_def := replace(replace(rtrim(v_def, E'; \n'), c_de1, c_para1), c_de2, c_para2);
  execute 'create or replace view public.vw_fluxo_caixa as ' || v_def;
end
$$;
