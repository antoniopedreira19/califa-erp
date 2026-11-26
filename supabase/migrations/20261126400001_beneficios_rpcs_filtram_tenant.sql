-- Migration: desaplicar_fechamento_beneficios + aplicar_fechamento_beneficios filtram tenant_id em todas as queries de folhas_pagamento.
-- Spec: docs/superpowers/specs/2026-11-26-folha-pj-clt-fluxos-independentes-design.md
-- Racional: após MCP check em 2026-11-26 confirmou 2 tenants ativos com dados reais
-- (Agência California d2a02c10... e California Sandbox db9278e5...), ambos com folha PJ
-- na mesma competência 2026-11. A trava `folha_pj_ja_enviada` no desaplicar e o UPDATE de
-- reversão não filtravam por tenant_id — na prática, admin de um tenant poderia:
--   (a) ser bloqueado de desaplicar porque outro tenant tem linha enviada;
--   (b) ter seu salário revertido indevidamente por desaplicar de outro tenant.
-- O aplicar também tinha brecha indireta (UPDATE depende de colaborador_id como bridge).
-- 100% aditiva. CREATE OR REPLACE das 2 funções.

begin;

-- =============================================================================
-- 1. desaplicar_fechamento_beneficios: filtra tenant_id na trava E no UPDATE
-- =============================================================================

create or replace function public.desaplicar_fechamento_beneficios(p_fechamento_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f public.beneficio_fechamento_mensal%rowtype;
  v_avulsa_paga record;
begin
  select * into v_f from public.beneficio_fechamento_mensal where id = p_fechamento_id;
  if not found then raise exception 'fechamento_nao_encontrado'; end if;
  if not (public.is_tenant_admin(v_f.tenant_id) or public.is_tenant_rh(v_f.tenant_id)) then
    raise exception 'permissao_negada';
  end if;
  if v_f.reaberto_em is not null then raise exception 'ja_reaberto'; end if;

  -- Trava: linha PJ desse TENANT já saiu de rascunho.
  if exists (
    select 1 from public.folhas_pagamento
     where tenant_id = v_f.tenant_id
       and competencia_ano = v_f.ano
       and competencia_mes = v_f.mes
       and origem = 'california'
       and status <> 'rascunho'
  ) then
    raise exception 'folha_pj_ja_enviada';
  end if;

  -- Trava existente: avulsa deste fechamento já foi paga.
  select coalesce(codigo, id::text) as ref
    into v_avulsa_paga
    from public.contas_avulsas
    where beneficio_fechamento_id = p_fechamento_id
      and pago_em is not null
    limit 1;
  if found then raise exception 'avulsa_ja_paga: %', v_avulsa_paga.ref; end if;

  -- Reverte salario_base PJ apenas desse tenant.
  update public.folhas_pagamento
     set salario_base = salario_base + desconto_beneficios,
         desconto_beneficios = 0
   where tenant_id = v_f.tenant_id
     and competencia_ano = v_f.ano
     and competencia_mes = v_f.mes
     and origem = 'california'
     and desconto_beneficios > 0;

  -- Apaga avulsas geradas (se houver). beneficio_fechamento_id já é único por tenant via FK.
  delete from public.contas_avulsas where beneficio_fechamento_id = p_fechamento_id;
  -- Apaga linhas do snapshot. Idem.
  delete from public.beneficio_fechamento_linha where fechamento_id = p_fechamento_id;
  -- Marca reaberto.
  update public.beneficio_fechamento_mensal
     set reaberto_em = now(), reaberto_por = auth.uid()
   where id = p_fechamento_id;
end;
$$;

grant execute on function public.desaplicar_fechamento_beneficios(uuid) to authenticated;

-- =============================================================================
-- 2. aplicar_fechamento_beneficios: filtra tenant_id no UPDATE da folha PJ
-- =============================================================================
-- O UPDATE atual depende de colaborador_id como bridge indireto (do snapshot) pra limitar
-- ao tenant. Funciona hoje porque colaborador_id é uuid único, mas a defesa explícita
-- tenant_id = p_tenant_id elimina a dependência indireta e padroniza com desaplicar.

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
  folha_linhas_afetadas int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fechamento_id uuid;
  v_qtd_vinculos int;
  v_total_empresa numeric := 0;
  v_total_colaborador numeric := 0;
  v_folha_linhas_afetadas int := 0;
  r_bad record;
begin
  if not (public.is_tenant_admin(p_tenant_id) or public.is_tenant_rh(p_tenant_id)) then
    raise exception 'permissao_negada';
  end if;

  select nome into r_bad
  from public.beneficios
  where ativo = true
    and tenant_id = p_tenant_id
    and (fornecedor_id is null or empresa_id is null or dia_vencimento_fatura is null or regional_id is null)
  limit 1;
  if found then
    raise exception 'catalogo_incompleto: %', r_bad.nome;
  end if;

  if exists (
    select 1 from public.beneficio_fechamento_mensal
    where tenant_id = p_tenant_id and ano = p_ano and mes = p_mes
      and reaberto_em is null
  ) then
    raise exception 'competencia_ja_aplicada';
  end if;

  if not exists (
    select 1 from public.colaboradores c
    join public.colaborador_beneficio cb on cb.colaborador_id = c.id
    where c.tenant_id = p_tenant_id
      and cb.data_inicio <= (make_date(p_ano, p_mes, 1) + interval '1 month' - interval '1 day')::date
      and (cb.data_fim is null or cb.data_fim > make_date(p_ano, p_mes, 1))
  ) then
    raise exception 'nenhum_vinculo_ativo';
  end if;

  insert into public.beneficio_fechamento_mensal
    (tenant_id, ano, mes, fechado_em, fechado_por, reaberto_em, reaberto_por)
  values (p_tenant_id, p_ano, p_mes, now(), auth.uid(), null, null)
  returning id into v_fechamento_id;

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
   where fp.tenant_id = p_tenant_id
     and fp.colaborador_id = d.colaborador_id
     and fp.competencia_ano = p_ano
     and fp.competencia_mes = p_mes
     and fp.origem = 'california';
  get diagnostics v_folha_linhas_afetadas = row_count;

  return query select v_fechamento_id, v_qtd_vinculos, v_total_empresa,
                      v_total_colaborador, v_folha_linhas_afetadas;
end;
$$;

grant execute on function public.aplicar_fechamento_beneficios(uuid, int, int) to authenticated;

commit;
