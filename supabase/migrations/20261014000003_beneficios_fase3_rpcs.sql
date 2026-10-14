-- Migration: Benefícios — Fase 3 (RPCs aplicar/desaplicar fechamento)
-- Spec: docs/modulos/rh/54-beneficios-integracao-folha.md §3.5, §3.6
-- Plano: docs/modulos/rh/56-beneficios-fase-3-plano-de-execucao.md (S2)
--
-- Ruling do executor (ver ledger .superpowers/sdd/56-.../progress.md):
-- - Subtipo plano de contas "Benefícios" = codigo '002', não '05.002' como o ADR cita.
-- - Trigger exige rateio em contas_avulsas_regionais; adicionamos beneficios.regional_id
--   e populamos com a regional "Agency" (corporativa) nesta mesma migration.
--
-- 100% aditiva.

begin;

-- =============================================================================
-- 0. Ajuste da unique de Fase 2: permitir N fechamentos reabertos + 1 vigente
-- =============================================================================
--
-- Fase 2 criou unique (tenant_id, ano, mes). Impede reaplicar depois de
-- desaplicar. Mudamos para unique parcial WHERE reaberto_em IS NULL:
-- - 1 fechamento vigente por competência (igual antes).
-- - N fechamentos históricos reabertos (ADR 174 §1.7: preserva histórico).

alter table public.beneficio_fechamento_mensal
  drop constraint uq_fechamento_tenant_competencia;

create unique index uq_fechamento_tenant_competencia_vigente
  on public.beneficio_fechamento_mensal (tenant_id, ano, mes)
  where reaberto_em is null;

-- =============================================================================
-- 1. Nova coluna beneficios.regional_id + seed
-- =============================================================================

alter table public.beneficios
  add column regional_id uuid references public.regionais(id) on delete restrict;

create index idx_beneficios_regional on public.beneficios (regional_id)
  where regional_id is not null;

comment on column public.beneficios.regional_id is
  'Regional usada no rateio da avulsa gerada pelo fechamento mensal (Fase 3). O schema de contas_avulsas exige rateio regional via trigger; para beneficios corporativos (SulAmerica, Bradesco) usamos 100 por cento em uma unica regional. Default no seed = Agency.';

update public.beneficios
set regional_id = 'be58f1de-d2ff-4cd2-aca6-434e696bfba1'::uuid
where ativo = true and regional_id is null;

-- =============================================================================
-- 2. RPC aplicar_fechamento_beneficios
-- =============================================================================

create or replace function public.aplicar_fechamento_beneficios(
  p_tenant_id uuid,
  p_ano int,
  p_mes int
)
returns table (
  fechamento_id uuid,
  qtd_vinculos int,
  total_empresa numeric,
  total_colaborador numeric,
  folha_linhas_afetadas int,
  avulsas jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fechamento_id uuid;
  v_subtipo_id uuid;
  v_tipo_id uuid;
  v_qtd_vinculos int;
  v_total_empresa numeric := 0;
  v_total_colaborador numeric := 0;
  v_folha_linhas_afetadas int := 0;
  v_avulsas jsonb := '[]'::jsonb;
  v_data_venc date;
  v_descricao text;
  v_conta_id uuid;
  r_bad record;
  r_op record;
begin
  -- Precondição 1: permissão
  if not (public.is_tenant_admin(p_tenant_id) or public.is_tenant_rh(p_tenant_id)) then
    raise exception 'permissao_negada';
  end if;

  -- Precondição 2: catálogo completo
  select nome into r_bad
  from public.beneficios
  where ativo = true
    and tenant_id = p_tenant_id
    and (fornecedor_id is null or empresa_id is null or dia_vencimento_fatura is null or regional_id is null)
  limit 1;
  if found then
    raise exception 'catalogo_incompleto: %', r_bad.nome;
  end if;

  -- Precondição 3: não há fechamento vigente pra competência
  if exists (
    select 1 from public.beneficio_fechamento_mensal
    where tenant_id = p_tenant_id and ano = p_ano and mes = p_mes
      and reaberto_em is null
  ) then
    raise exception 'competencia_ja_aplicada';
  end if;

  -- Precondição 4: pelo menos 1 vínculo ativo
  if not exists (
    select 1 from public.colaboradores c
    join public.colaborador_beneficio cb on cb.colaborador_id = c.id
    where c.tenant_id = p_tenant_id
      and cb.data_inicio <= (make_date(p_ano, p_mes, 1) + interval '1 month' - interval '1 day')::date
      and (cb.data_fim is null or cb.data_fim > make_date(p_ano, p_mes, 1))
  ) then
    raise exception 'nenhum_vinculo_ativo';
  end if;

  -- Precondição 5: subtipo plano de contas Benefícios
  select pcs.id, pcs.tipo_id
    into v_subtipo_id, v_tipo_id
    from public.plano_contas_subtipos pcs
    where pcs.codigo = '002'
      and lower(pcs.nome) like '%benef%'
    limit 1;
  if v_subtipo_id is null then
    raise exception 'subtipo_beneficios_nao_encontrado';
  end if;

  -- 1. Insere cabeçalho
  insert into public.beneficio_fechamento_mensal
    (tenant_id, ano, mes, fechado_em, fechado_por, reaberto_em, reaberto_por)
  values (p_tenant_id, p_ano, p_mes, now(), auth.uid(), null, null)
  returning id into v_fechamento_id;

  -- 2. Insere linhas via fn_beneficios_calcular_fechamento (Fase 2)
  insert into public.beneficio_fechamento_linha (
    tenant_id, fechamento_id,
    colaborador_beneficio_id, colaborador_id, beneficio_id,
    beneficio_nome, beneficio_operadora, beneficio_tipo, modo_custeio,
    valor_titular, valor_dependentes_total, valor_integral, valor_empresa, valor_colaborador,
    qtd_dependentes_na_competencia
  )
  select
    p_tenant_id, v_fechamento_id,
    colaborador_beneficio_id, colaborador_id, beneficio_id,
    beneficio_nome, beneficio_operadora, beneficio_tipo, modo_custeio,
    valor_titular, valor_dependentes_total, valor_integral, valor_empresa, valor_colaborador,
    qtd_dependentes_na_competencia
  from public.fn_beneficios_calcular_fechamento(p_tenant_id, p_ano, p_mes);

  select count(*),
         coalesce(sum(l.valor_empresa), 0),
         coalesce(sum(l.valor_colaborador), 0)
    into v_qtd_vinculos, v_total_empresa, v_total_colaborador
    from public.beneficio_fechamento_linha l
   where l.fechamento_id = v_fechamento_id;

  -- 3. Reduz salario_base das linhas PJ (origem='california')
  with desc_por_col as (
    select l.colaborador_id, sum(l.valor_colaborador) as desc_total
    from public.beneficio_fechamento_linha l
    where l.fechamento_id = v_fechamento_id
    group by l.colaborador_id
  )
  update public.folhas_pagamento fp
    set salario_base = fp.salario_base - d.desc_total,
        desconto_beneficios = d.desc_total
    from desc_por_col d
   where fp.colaborador_id = d.colaborador_id
     and fp.competencia_ano = p_ano
     and fp.competencia_mes = p_mes
     and fp.origem = 'california';
  get diagnostics v_folha_linhas_afetadas = row_count;

  -- 4. Cria 1 avulsa por operadora
  for r_op in
    select
      b.fornecedor_id,
      b.empresa_id,
      b.regional_id,
      b.operadora,
      b.dia_vencimento_fatura,
      b.vencimento_mes_seguinte,
      sum(l.valor_integral) as valor_cheio
    from public.beneficio_fechamento_linha l
    join public.beneficios b on b.id = l.beneficio_id
    where l.fechamento_id = v_fechamento_id
    group by b.fornecedor_id, b.empresa_id, b.regional_id, b.operadora,
             b.dia_vencimento_fatura, b.vencimento_mes_seguinte
  loop
    v_data_venc := case
      when r_op.vencimento_mes_seguinte
        then (make_date(p_ano, p_mes, 1) + interval '1 month' + ((r_op.dia_vencimento_fatura - 1) || ' days')::interval)::date
      else make_date(p_ano, p_mes, r_op.dia_vencimento_fatura)
    end;
    v_descricao := format('Beneficios %s - competencia %s/%s',
      r_op.operadora, lpad(p_mes::text, 2, '0'), p_ano);

    v_conta_id := public.criar_conta_avulsa(
      jsonb_build_object(
        'tenant_id', p_tenant_id,
        'empresa_id', r_op.empresa_id,
        'fornecedor_id', r_op.fornecedor_id,
        'descricao', v_descricao,
        'valor', r_op.valor_cheio,
        'data_prevista_pagamento', v_data_venc,
        'natureza', 'saida',
        'plano_conta_tipo_id', v_tipo_id,
        'plano_conta_subtipo_id', v_subtipo_id,
        'beneficio_fechamento_id', v_fechamento_id,
        'competencia', make_date(p_ano, p_mes, 1),
        'criado_por', auth.uid(),
        'status', 'aprovada',
        'aprovada_em', now(),
        'aprovada_por', auth.uid(),
        'parcela_numero', 1,
        'parcela_total', 1
      ),
      jsonb_build_array(
        jsonb_build_object('regional_id', r_op.regional_id, 'percentual', 100)
      )
    );

    v_avulsas := v_avulsas || jsonb_build_object(
      'id', v_conta_id,
      'operadora', r_op.operadora,
      'valor', r_op.valor_cheio
    );
  end loop;

  return query select v_fechamento_id, v_qtd_vinculos, v_total_empresa,
                      v_total_colaborador, v_folha_linhas_afetadas, v_avulsas;
end;
$$;

grant execute on function public.aplicar_fechamento_beneficios(uuid, int, int) to authenticated;

comment on function public.aplicar_fechamento_beneficios is
  'Fase 3: fecha competencia + reduz salario_base PJ + gera 1 avulsa por operadora. SECURITY DEFINER com check interno de permissao (admin/rh). Transacao atomica. ADR 174.';

-- =============================================================================
-- 3. RPC desaplicar_fechamento_beneficios
-- =============================================================================

create or replace function public.desaplicar_fechamento_beneficios(
  p_fechamento_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f public.beneficio_fechamento_mensal%rowtype;
  v_avulsa_paga record;
begin
  select * into v_f
    from public.beneficio_fechamento_mensal
    where id = p_fechamento_id;
  if not found then
    raise exception 'fechamento_nao_encontrado';
  end if;

  if not (public.is_tenant_admin(v_f.tenant_id) or public.is_tenant_rh(v_f.tenant_id)) then
    raise exception 'permissao_negada';
  end if;

  if v_f.reaberto_em is not null then
    raise exception 'ja_reaberto';
  end if;

  -- Trava: alguma avulsa já paga?
  select coalesce(codigo, id::text) as ref
    into v_avulsa_paga
    from public.contas_avulsas
    where beneficio_fechamento_id = p_fechamento_id
      and pago_em is not null
    limit 1;
  if found then
    raise exception 'avulsa_ja_paga: %', v_avulsa_paga.ref;
  end if;

  -- 1. Reverte salario_base nas linhas PJ
  update public.folhas_pagamento
     set salario_base = salario_base + desconto_beneficios,
         desconto_beneficios = 0
   where competencia_ano = v_f.ano
     and competencia_mes = v_f.mes
     and origem = 'california'
     and desconto_beneficios > 0;

  -- 2. Apaga avulsas geradas (sem pago_em, por garantia da trava acima)
  delete from public.contas_avulsas
   where beneficio_fechamento_id = p_fechamento_id;

  -- 3. Apaga linhas do snapshot
  delete from public.beneficio_fechamento_linha
   where fechamento_id = p_fechamento_id;

  -- 4. Marca cabeçalho reaberto
  update public.beneficio_fechamento_mensal
     set reaberto_em = now(),
         reaberto_por = auth.uid()
   where id = p_fechamento_id;
end;
$$;

grant execute on function public.desaplicar_fechamento_beneficios(uuid) to authenticated;

comment on function public.desaplicar_fechamento_beneficios is
  'Fase 3: reverte um fechamento aplicado. Falha se qualquer avulsa foi paga. Reverte salario_base nas PJ, apaga avulsas, apaga linhas do snapshot, marca cabecalho como reaberto. ADR 174.';

commit;
