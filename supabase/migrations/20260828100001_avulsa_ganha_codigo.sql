-- A conta avulsa ganha código próprio: AV-00001.
--
-- A coluna Origem da Conciliação mostra de onde cada lançamento veio, e
-- todas as origens tinham identificador menos esta: PP tem `PP-00009`,
-- desembolso tem `DES-00004`, o recebimento é a própria nota. A avulsa
-- tinha só a descrição, que é texto livre — duas avulsas diferentes
-- ficavam indistinguíveis na coluna.
--
-- É a origem que MAIS precisava de código, e não a que menos: a descrição
-- dela é livre justamente porque ela cobre o que não coube em lugar nenhum.
--
-- Aditiva, e sem backfill: `contas_avulsas` está com 0 linhas hoje. Por
-- isso a coluna nasce anulável e o índice único ignora nulo — se um dia
-- aparecer linha antiga sem código, ela não quebra nada.

alter table public.contas_avulsas
  add column if not exists codigo text;

comment on column public.contas_avulsas.codigo is
  'AV-00001. Identificador da avulsa na coluna Origem da Conciliação (28/08/2026). Nulo em linha anterior a esta data.';

-- Mesma forma de `gerar_codigo_pp` e `gerar_codigo_desembolso`: advisory
-- lock por tenant, máximo + 1, cinco dígitos.
create or replace function public.gerar_codigo_avulsa(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prox integer;
begin
  perform pg_advisory_xact_lock(hashtext('avulsa_seq_' || p_tenant_id::text));

  select coalesce(max(cast(substring(codigo from '^AV-(\d+)$') as integer)), 0) + 1
    into v_prox
    from public.contas_avulsas
   where tenant_id = p_tenant_id
     and codigo ~ '^AV-\d+$';

  return 'AV-' || lpad(v_prox::text, 5, '0');
end;
$function$;

-- `revoke` antes do `grant`: o Postgres concede EXECUTE a PUBLIC por padrão
-- em toda função nova, e PUBLIC inclui `anon`. Sem esta linha a função
-- nasceria acessível sem login — contra a regra do projeto (nada para
-- `anon`). Ela é `security definer` e lê `contas_avulsas` por cima da RLS.
revoke execute on function public.gerar_codigo_avulsa(uuid) from public;
grant execute on function public.gerar_codigo_avulsa(uuid) to authenticated;

create unique index if not exists uniq_avulsa_codigo_por_tenant
  on public.contas_avulsas (tenant_id, codigo)
  where codigo is not null;

-- ---------------------------------------------------------------------
-- A ocorrência de recorrência também nasce com código
-- ---------------------------------------------------------------------
-- Ela é criada aqui dentro, e não pela aplicação — sem esta parte, toda
-- assinatura mensal apareceria sem identificador na Conciliação, que é
-- exatamente o caso que motivou a coluna.
--
-- Além do `codigo`, ela ganha `set search_path` — ela é `security definer`
-- e estava sem a guarda, que os advisors do Supabase sinalizam. O corpo já
-- qualifica tudo com `public.`, então o comportamento não muda.

create or replace function public.gerar_ocorrencias_recorrentes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      forma_pagamento, cartao_credito_id,
      codigo
    ) values (
      v_template.tenant_id, v_template.empresa_id, v_template.descricao,
      v_template.valor, 'saida',
      v_data_pagamento, v_data_pagamento, v_data_pagamento, 'aprovada',
      now(), v_template.criado_por,
      v_template.fornecedor_id, v_template.cliente_id, v_template.job_id,
      v_template.plano_conta_tipo_id, v_template.plano_conta_subtipo_id,
      v_template.id, v_template.criado_por,
      v_template.forma_pagamento, v_template.cartao_credito_id,
      public.gerar_codigo_avulsa(v_template.tenant_id)
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
$function$;
