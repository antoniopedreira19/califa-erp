-- Migration: 20260820000004_gerar_ocorrencias_cartao.sql
--
-- Racional: quando o template de recorrência tem forma_pagamento = 'cartao_credito',
-- a ocorrência materializada deve:
--   (1) herdar forma_pagamento e cartao_credito_id do template; e
--   (2) ter data_prevista_pagamento (e data_pagamento) recalculada por
--       proxima_fatura_cartao(template.cartao_credito_id, current_date) no
--       momento da geração — não usar proxima_data do template, que representa
--       o ciclo de disparo do cron, não a data de fechamento da fatura.
--
-- Para outros templates (sem cartão ou com outra forma), comportamento original
-- é preservado integralmente: data_prevista_pagamento = proxima_data do template.
--
-- Implementação: CREATE OR REPLACE FUNCTION (sem DROP, sem ALTER em outras tabelas).
-- Toda a lógica original é mantida; apenas o INSERT em contas_avulsas recebe
-- os dois campos novos e um ramo condicional para calcular v_data_pagamento.
--
-- Ver spec seção 3.4 e ruling do controller (task-8-brief.md).
-- Nome do arquivo: 20260820000004 conforme ruling do controller (executa antes da Task 9 _5).

create or replace function public.gerar_ocorrencias_recorrentes()
returns int
language plpgsql
security definer
as $$
declare
  v_template  public.contas_avulsas_recorrentes%rowtype;
  v_geradas   integer := 0;
  v_nova_id   uuid;
  v_prox_data date;
  v_data_pagamento date;
begin
  for v_template in
    select *
      from public.contas_avulsas_recorrentes
     where ativo = true
       and proxima_data <= current_date
       and (data_fim is null or proxima_data <= data_fim)
     order by tenant_id, proxima_data
  loop
    -- Calcula a data de pagamento:
    -- · Cartão de crédito → data da próxima fatura calculada agora
    --   (não a proxima_data do template, que representa apenas o gatilho do cron).
    -- · Demais formas → proxima_data do template (comportamento original).
    if v_template.forma_pagamento = 'cartao_credito'
       and v_template.cartao_credito_id is not null
    then
      v_data_pagamento := public.proxima_fatura_cartao(
        v_template.cartao_credito_id,
        current_date
      );
    else
      v_data_pagamento := v_template.proxima_data;
    end if;

    insert into public.contas_avulsas (
      tenant_id, empresa_id, descricao, valor, natureza,
      data_prevista_pagamento, data_pagamento, data_pagamento_primeira, status,
      aprovada_em, aprovada_por,
      fornecedor_id, cliente_id, job_id,
      plano_conta_tipo_id, plano_conta_subtipo_id,
      recorrente_id, criado_por,
      forma_pagamento, cartao_credito_id
    ) values (
      v_template.tenant_id, v_template.empresa_id, v_template.descricao,
      v_template.valor, 'saida',
      v_data_pagamento, v_data_pagamento, v_data_pagamento, 'aprovada',
      now(), v_template.criado_por,
      v_template.fornecedor_id, v_template.cliente_id, v_template.job_id,
      v_template.plano_conta_tipo_id, v_template.plano_conta_subtipo_id,
      v_template.id, v_template.criado_por,
      v_template.forma_pagamento, v_template.cartao_credito_id
    )
    returning id into v_nova_id;

    v_geradas := v_geradas + 1;

    -- Copia rateio regional do template para a ocorrência gerada
    insert into public.contas_avulsas_regionais (
      tenant_id, conta_avulsa_id, regional_id, percentual
    )
    select
      v_template.tenant_id, v_nova_id, r.regional_id, r.percentual
      from public.contas_avulsas_recorrentes_regionais r
     where r.recorrente_id = v_template.id;

    -- Avança proxima_data conforme frequência do template
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

    -- Auditoria
    insert into public.audit_events (
      tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
    ) values (
      v_template.tenant_id, 'conta_recorrente', v_template.id::text,
      'conta_recorrente.ocorrencia_gerada', null,
      jsonb_build_object(
        'avulsa_id', v_nova_id,
        'data_movimento', v_data_pagamento,
        'valor', v_template.valor,
        'nasceu_aprovada', true,
        'forma_pagamento', v_template.forma_pagamento,
        'cartao_credito_id', v_template.cartao_credito_id
      )
    );
  end loop;

  return v_geradas;
end;
$$;
