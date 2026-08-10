-- =====================================================================
-- Task 013 — Fix CRITICAL: cron não avança proxima_data ao desativar
--            template por data_fim
--
-- BUG: branch de desativação fazia
--        set ativo = false, proxima_data = v_prox_data
--      onde v_prox_data > data_fim. Isso violava CHECK
--        chk_rec_data_fim_ordem (data_fim IS NULL OR data_fim >= proxima_data)
--      e abortava a transação inteira do cron.
--
-- FIX: branch de desativação não avança proxima_data.
--      Semanticamente, proxima_data de template desativado deve ficar
--      na última data válida (dia da última ocorrência gerada).
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
    -- Insere instância como avulsa pendente
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

    -- Calcula próxima data conforme frequência
    v_prox_data := public.calcular_proxima_data_recorrencia(v_template);

    -- Atualiza template: se próxima passa da data_fim, desativa SEM
    -- avançar proxima_data (manter na última data válida evita violar
    -- chk_rec_data_fim_ordem: data_fim >= proxima_data).
    if v_template.data_fim is not null and v_prox_data > v_template.data_fim then
      update public.contas_avulsas_recorrentes
         set ativo = false  -- não avança proxima_data
       where id = v_template.id;
    else
      update public.contas_avulsas_recorrentes
         set proxima_data = v_prox_data
       where id = v_template.id;
    end if;

    -- Audit (função SECURITY DEFINER precisa chamar log_audit_event
    -- passando tenant_id explícito pra pular auth.uid())
    insert into public.audit_events (
      tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
    ) values (
      v_template.tenant_id, 'conta_recorrente', v_template.id,
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
