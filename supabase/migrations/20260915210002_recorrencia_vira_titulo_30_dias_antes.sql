-- =====================================================================
-- A recorrência vira título 30 dias antes; o que vem depois é previsão
--
-- Decisão do Tiago em 15/09/2026, entre três opções postas com exemplo:
-- "só a próxima é título", "virada do mês" e "30 dias de antecedência".
--
--   - Antes: a rotina diária criava a ocorrência NO PRÓPRIO DIA do
--     vencimento. Até lá a despesa não aparecia em lugar nenhum — nem no
--     contas a pagar, nem como previsão no fluxo de caixa.
--   - Agora: vira título (uma `contas_avulsas` aprovada) quando o
--     vencimento cai em até 30 dias. Na mensal isso dá exatamente um
--     título à frente; a anual não fica um ano aberta; e o título existe
--     antes da janela de pagamento (08 e 20), qualquer que seja o dia.
--   - Além dos 30 dias: previsão na `vw_fluxo_caixa`, CALCULADA NA
--     LEITURA a partir da recorrência — nada gravado (mesmo princípio das
--     decisões 004 e 018). Editar a recorrência muda as previsões na hora;
--     os títulos já criados ficam como nasceram.
--
-- O 30 mora num lugar só: `recorrencia_antecedencia_dias()`.
--
-- ---------------------------------------------------------------------
-- Três ajustes que andam junto
--
-- 1. Recorrência no CARTÃO: a ocorrência grava `data_compra` = dia da
--    cobrança. Sem isso o gatilho `avulsa_entra_na_fatura` escolheria a
--    fatura pelo dia da GERAÇÃO — com a antecedência, 30 dias cedo, na
--    fatura errada.
-- 2. A geração é por recorrência (`materializar_ocorrencias_da_recorrente`)
--    e gera TODAS as ocorrências dentro da janela, não uma por dia. A tela
--    chama `gerar_ocorrencias_da_recorrente` ao criar, editar e reativar,
--    para o título não esperar a rotina das 6h. Ocorrência que já existe
--    naquela data não é gerada de novo.
-- 3. Na rotina diária, cada recorrência roda isolada: uma que falhe não
--    derruba as outras. Recorrência sem rateio não gera nada.
--
-- Chegando à data de fim, a recorrência é desativada sem avançar a
-- `proxima_data` além dela (a versão anterior avançava, contra a
-- `chk_rec_data_fim_ordem`).
-- =====================================================================

create or replace function public.recorrencia_antecedencia_dias()
returns integer
language sql
immutable
as $$ select 30 $$;

comment on function public.recorrencia_antecedencia_dias() is
  'Quantos dias antes do vencimento a ocorrência da recorrência vira título. Antes disso ela é previsão na vw_fluxo_caixa. Decisão de 15/09/2026.';

-- ---------------------------------------------------------------------
-- Geração por recorrência
-- ---------------------------------------------------------------------
create or replace function public.materializar_ocorrencias_da_recorrente(p_recorrente_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t       public.contas_avulsas_recorrentes%rowtype;
  v_limite  date := current_date + public.recorrencia_antecedencia_dias();
  v_geradas integer := 0;
  v_nova_id uuid;
  v_prox    date;
  v_cartao  boolean;
begin
  loop
    select * into v_t
      from public.contas_avulsas_recorrentes
     where id = p_recorrente_id
     for update;

    exit when not found;
    exit when not v_t.ativo;
    exit when v_t.proxima_data > v_limite;

    if v_t.data_fim is not null and v_t.proxima_data > v_t.data_fim then
      update public.contas_avulsas_recorrentes set ativo = false where id = v_t.id;
      exit;
    end if;

    if not exists (
      select 1 from public.contas_avulsas_recorrentes_regionais r where r.recorrente_id = v_t.id
    ) then
      raise exception 'A recorrência % não tem rateio de regional; nenhuma ocorrência foi gerada.', v_t.id;
    end if;

    v_cartao := v_t.forma_pagamento::text = 'cartao_credito' and v_t.cartao_credito_id is not null;

    if not exists (
      select 1
        from public.contas_avulsas a
       where a.recorrente_id = v_t.id
         and coalesce(a.data_compra, a.data_pagamento_primeira) = v_t.proxima_data
    ) then
      insert into public.contas_avulsas (
        tenant_id, empresa_id, descricao, valor, natureza,
        data_prevista_pagamento, data_pagamento, data_pagamento_primeira,
        data_compra, status, aprovada_em, aprovada_por,
        fornecedor_id, cliente_id,
        plano_conta_tipo_id, plano_conta_subtipo_id,
        recorrente_id, criado_por,
        forma_pagamento, cartao_credito_id,
        codigo
      ) values (
        v_t.tenant_id, v_t.empresa_id, v_t.descricao, v_t.valor, 'saida',
        v_t.proxima_data, v_t.proxima_data, v_t.proxima_data,
        case when v_cartao then v_t.proxima_data else null end,
        'aprovada', now(), v_t.criado_por,
        v_t.fornecedor_id, v_t.cliente_id,
        v_t.plano_conta_tipo_id, v_t.plano_conta_subtipo_id,
        v_t.id, v_t.criado_por,
        v_t.forma_pagamento, v_t.cartao_credito_id,
        public.gerar_codigo_avulsa(v_t.tenant_id)
      )
      returning id into v_nova_id;

      insert into public.contas_avulsas_regionais (tenant_id, conta_avulsa_id, regional_id, percentual)
      select v_t.tenant_id, v_nova_id, r.regional_id, r.percentual
        from public.contas_avulsas_recorrentes_regionais r
       where r.recorrente_id = v_t.id;

      insert into public.audit_events (
        tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
      ) values (
        v_t.tenant_id, 'conta_recorrente', v_t.id::text,
        'conta_recorrente.ocorrencia_gerada', null,
        jsonb_build_object(
          'avulsa_id', v_nova_id,
          'data_ocorrencia', v_t.proxima_data,
          'valor', v_t.valor,
          'nasceu_aprovada', true,
          'antecedencia_dias', public.recorrencia_antecedencia_dias(),
          'forma_pagamento', v_t.forma_pagamento,
          'cartao_credito_id', v_t.cartao_credito_id
        )
      );

      v_geradas := v_geradas + 1;
    end if;

    v_prox := public.calcular_proxima_data_recorrencia(v_t);

    if v_t.data_fim is not null and v_prox > v_t.data_fim then
      update public.contas_avulsas_recorrentes set ativo = false where id = v_t.id;
      exit;
    end if;

    update public.contas_avulsas_recorrentes set proxima_data = v_prox where id = v_t.id;
  end loop;

  return v_geradas;
end;
$$;

comment on function public.materializar_ocorrencias_da_recorrente(uuid) is
  'Gera como título (contas_avulsas aprovada) toda ocorrência da recorrência que vence em até recorrencia_antecedencia_dias() dias, copiando o rateio. Não repete data já gerada. Interna: a tela usa gerar_ocorrencias_da_recorrente, a rotina diária usa gerar_ocorrencias_recorrentes.';

-- A tela chama esta, ao criar, editar e reativar.
create or replace function public.gerar_ocorrencias_da_recorrente(p_recorrente_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.contas_avulsas_recorrentes where id = p_recorrente_id;
  if not found then
    raise exception 'Recorrência não encontrada.';
  end if;
  if not public.is_tenant_member(v_tenant) then
    raise exception 'Sem permissão nesta recorrência.';
  end if;
  return public.materializar_ocorrencias_da_recorrente(p_recorrente_id);
end;
$$;

-- A rotina diária (cron das 6h). Mantém nome, assinatura e permissões.
create or replace function public.gerar_ocorrencias_recorrentes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id    uuid;
  v_total integer := 0;
begin
  for v_id in
    select id
      from public.contas_avulsas_recorrentes
     where ativo = true
       and proxima_data <= current_date + public.recorrencia_antecedencia_dias()
     order by tenant_id, proxima_data
  loop
    begin
      v_total := v_total + public.materializar_ocorrencias_da_recorrente(v_id);
    exception when others then
      raise warning 'gerar_ocorrencias_recorrentes: recorrência % não gerada: %', v_id, sqlerrm;
    end;
  end loop;

  return v_total;
end;
$$;

revoke all on function public.materializar_ocorrencias_da_recorrente(uuid) from public, anon, authenticated;
revoke all on function public.gerar_ocorrencias_da_recorrente(uuid) from public, anon;
grant execute on function public.gerar_ocorrencias_da_recorrente(uuid) to authenticated;
revoke all on function public.recorrencia_antecedencia_dias() from public, anon;
grant execute on function public.recorrencia_antecedencia_dias() to authenticated;
-- Chamada pela previsão da view com o papel de quem lê.
grant execute on function public.proxima_fatura_cartao(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- Previsão das ocorrências futuras na vw_fluxo_caixa
--
-- Mesmo método da 20260915150003: parte da definição que está no banco e
-- acrescenta um ramo, em vez de colar a view inteira (outras frentes a
-- redefinem com frequência). Colunas e tipos não mudam, então
-- `create or replace` preserva GRANTs e a `vw_fluxo_caixa_job_totais`.
--
-- O ramo começa na `proxima_data` — a primeira ocorrência que AINDA NÃO
-- virou título —, então previsão e título nunca contam o mesmo dinheiro.
-- Vai até o fim do 12º mês à frente (o maior horizonte da tela) ou até a
-- data de fim. No cartão, a data é o vencimento da fatura, como no título.
-- Previsão que ficou no passado rola para a próxima janela de pagamento,
-- como a curva de desembolso (decisão 018).
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  v_def := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  if position('previsao_recorrente' in v_def) > 0 then
    raise exception 'A vw_fluxo_caixa já tem o ramo previsao_recorrente.';
  end if;
  v_def := regexp_replace(v_def, ';\s*$', '');
  v_def := v_def || $ramo$
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'previsao_recorrente'::text AS origem_tipo,
    t.id AS origem_id,
    t.tenant_id,
    t.empresa_id,
    NULL::uuid AS conta_bancaria_id,
        CASE
            WHEN oc.data_pagamento < CURRENT_DATE THEN fc_proxima_janela_pagamento(CURRENT_DATE)
            ELSE oc.data_pagamento
        END AS data_evento,
    (t.valor * rr.fator)::numeric(14,2) AS valor,
    'saida'::natureza_lancamento AS natureza,
    'Recorrência prevista · '::text || t.descricao AS descricao,
    t.fornecedor_id,
    t.cliente_id,
    NULL::uuid AS job_id,
    'previsao'::text AS classe,
    rr.regional_id,
    NULL::text AS origem_lancamento
   FROM contas_avulsas_recorrentes t
     CROSS JOIN LATERAL ( SELECT o.data_ocorrencia,
                CASE
                    WHEN t.forma_pagamento::text = 'cartao_credito'::text AND t.cartao_credito_id IS NOT NULL
                    THEN proxima_fatura_cartao(t.cartao_credito_id, o.data_ocorrencia)
                    ELSE o.data_ocorrencia
                END AS data_pagamento
           FROM ( SELECT DISTINCT s.data_ocorrencia
                   FROM ( SELECT data_quinzena_do_mes(EXTRACT(year FROM m.m)::integer, EXTRACT(month FROM m.m)::integer, t.dia_do_mes::integer) AS data_ocorrencia
                           FROM generate_series(date_trunc('month', t.proxima_data::timestamp), date_trunc('month', CURRENT_DATE::timestamp) + '1 year'::interval, '1 mon'::interval) m(m)
                          WHERE t.frequencia = 'mensal'::frequencia_recorrencia
                        UNION ALL
                         SELECT data_quinzena_do_mes(EXTRACT(year FROM m.m)::integer, EXTRACT(month FROM m.m)::integer, q.dia::integer) AS data_ocorrencia
                           FROM generate_series(date_trunc('month', t.proxima_data::timestamp), date_trunc('month', CURRENT_DATE::timestamp) + '1 year'::interval, '1 mon'::interval) m(m)
                             CROSS JOIN LATERAL ( VALUES (t.dia_quinzena_1), (t.dia_quinzena_2)) q(dia)
                          WHERE t.frequencia = 'quinzenal'::frequencia_recorrencia
                        UNION ALL
                         SELECT data_quinzena_do_mes(EXTRACT(year FROM y.y)::integer, t.dia_do_ano_mes::integer, t.dia_do_ano_dia::integer) AS data_ocorrencia
                           FROM generate_series(date_trunc('year', t.proxima_data::timestamp), date_trunc('year', CURRENT_DATE::timestamp) + '2 years'::interval, '1 year'::interval) y(y)
                          WHERE t.frequencia = 'anual'::frequencia_recorrencia) s) o
          WHERE o.data_ocorrencia >= t.proxima_data
            AND o.data_ocorrencia <= (date_trunc('month', CURRENT_DATE::timestamp) + '13 mons'::interval - '1 day'::interval)::date
            AND (t.data_fim IS NULL OR o.data_ocorrencia <= t.data_fim)
            AND NOT (EXISTS ( SELECT 1
                   FROM contas_avulsas a
                  WHERE a.recorrente_id = t.id AND COALESCE(a.data_compra, a.data_pagamento_primeira) = o.data_ocorrencia))) oc
     CROSS JOIN LATERAL ( SELECT r.regional_id,
                r.percentual / 100.0 AS fator
           FROM contas_avulsas_recorrentes_regionais r
          WHERE r.recorrente_id = t.id
        UNION ALL
         SELECT NULL::uuid AS regional_id,
                1.0 AS fator
          WHERE NOT (EXISTS ( SELECT 1
                   FROM contas_avulsas_recorrentes_regionais r2
                  WHERE r2.recorrente_id = t.id))) rr
  WHERE t.ativo
$ramo$;
  execute format('create or replace view public.vw_fluxo_caixa as %s', v_def);
end $$;
