-- =====================================================================
-- Task 014 — gerar_ocorrencias_recorrentes v2: copia rateio do template
-- Ver spec: docs/superpowers/specs/2026-08-08-rateio-regional-avulsa-design.md
--
-- Delta em relação à v1 (task 013): após INSERT em contas_avulsas, faz
-- INSERT bulk em contas_avulsas_regionais copiando as linhas do template.
-- =====================================================================

create or replace function public.gerar_ocorrencias_recorrentes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template  contas_avulsas_recorrentes%rowtype;
  v_geradas   integer := 0;
  v_nova_id   uuid;
  v_prox_data date;
begin
  for v_template in
    select *
      from public.contas_avulsas_recorrentes
     where ativo = true
       and proxima_data <= current_date
       and (data_fim is null or proxima_data <= data_fim)
     order by tenant_id, proxima_data
  loop
    -- INSERT da instância
    insert into public.contas_avulsas (
      tenant_id, empresa_id, descricao, valor, natureza,
      data_prevista_pagamento, status,
      fornecedor_id, cliente_id, job_id,
      plano_conta_tipo_id, plano_conta_subtipo_id,
      recorrente_id, criado_por
    ) values (
      v_template.tenant_id, v_template.empresa_id, v_template.descricao,
      v_template.valor, 'saida',
      v_template.proxima_data, 'pendente',
      v_template.fornecedor_id, v_template.cliente_id, v_template.job_id,
      v_template.plano_conta_tipo_id, v_template.plano_conta_subtipo_id,
      v_template.id, v_template.criado_por
    )
    returning id into v_nova_id;

    v_geradas := v_geradas + 1;

    -- Copia rateio do template (novo em v2)
    insert into public.contas_avulsas_regionais (
      tenant_id, conta_avulsa_id, regional_id, percentual
    )
    select
      v_template.tenant_id, v_nova_id, r.regional_id, r.percentual
      from public.contas_avulsas_recorrentes_regionais r
     where r.recorrente_id = v_template.id;

    -- Avança proxima_data
    v_prox_data := public.calcular_proxima_data_recorrencia(v_template);

    if v_template.data_fim is not null and v_prox_data > v_template.data_fim then
      update public.contas_avulsas_recorrentes
         set ativo = false, proxima_data = v_prox_data
       where id = v_template.id;
    else
      update public.contas_avulsas_recorrentes
         set proxima_data = v_prox_data
       where id = v_template.id;
    end if;

    -- Audit (mantém INSERT direto pra bypass do auth.uid())
    insert into public.audit_events (
      tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
    ) values (
      v_template.tenant_id, 'conta_recorrente', v_template.id::text,
      'conta_recorrente.ocorrencia_gerada', null,
      jsonb_build_object(
        'avulsa_id', v_nova_id,
        'data_movimento', v_template.proxima_data,
        'valor', v_template.valor
      )
    );
  end loop;

  return v_geradas;
end;
$$;

grant execute on function public.gerar_ocorrencias_recorrentes() to authenticated;
