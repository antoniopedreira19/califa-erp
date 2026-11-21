-- RPC `encerrar_pendencias_rescisao`: ao inativar colaborador, limpa
-- tudo que está em andamento (folha mensal, 13º, férias) mas preserva o
-- histórico do que já foi pago. A regra é "não pago = sai, pago = fica".
--
-- Fluxo:
-- 1. folhas_pagamento onde status ∈ {rascunho, enviada, aprovada,
--    pendente_correcao} e competência >= data_encerramento (pelo mês)
--    → vai pra `cancelada_rescisao`. Pega mensal, 13º 1ª/2ª parcela, e
--    linhas de férias ainda não pagas.
-- 2. decimo_terceiro_linhas do ano da rescisão: se nenhuma folha
--    vinculada foi paga, deleta a linha inteira (nunca saiu de rascunho
--    pra alguém). Se alguma foi paga, mantém pra preservar histórico.
-- 3. colaboradores_ferias_periodos em status não terminal → vai pra
--    `pago_rescisao` (status já existente no enum, é literalmente o
--    caso aqui — direito de férias será pago via TRCT na rescisão).
-- 4. colaboradores_ferias_lancamentos em status não terminal → vai pra
--    `cancelado`.
--
-- Retorna contadores pra a action enriquecer a auditoria e mostrar
-- resumo na UI ("3 lançamentos encerrados por rescisão").
--
-- Chamada só pela server action `inativarColaborador` (uso interno);
-- SECURITY INVOKER porque a action já é guard-ada por checarPermissao
-- + RLS na tabela colaboradores.

create or replace function public.encerrar_pendencias_rescisao(
  p_tenant_id uuid,
  p_colaborador_id uuid,
  p_data_encerramento date
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_ano                integer := extract(year from p_data_encerramento)::integer;
  v_mes                integer := extract(month from p_data_encerramento)::integer;
  v_folhas_canceladas  integer := 0;
  v_13_deletadas       integer := 0;
  v_13_preservadas     integer := 0;
  v_ferias_periodos    integer := 0;
  v_ferias_lancamentos integer := 0;
begin
  -- 1. Cancela linhas de folha (qualquer tipo) a partir do mês da rescisão.
  --    Pega status não-terminais (não-paga, não-cancelada anterior).
  --    Competência < rescisão fica intacta por design (histórico).
  update folhas_pagamento f
     set status = 'cancelada_rescisao',
         updated_at = now()
   where f.tenant_id = p_tenant_id
     and f.colaborador_id = p_colaborador_id
     and f.status in ('rascunho','enviada','aprovada','pendente_correcao')
     and (
       f.competencia_ano > v_ano
       or (f.competencia_ano = v_ano and f.competencia_mes >= v_mes)
     );
  get diagnostics v_folhas_canceladas = row_count;

  -- 2. 13º do ano em curso: se nenhuma folha associada foi paga, remove
  --    a linha. Caso parcela 1 já tenha sido efetivamente paga, a linha
  --    fica (histórico), e a parcela 2 já foi cancelada no passo 1.
  with alvo as (
    select l.id
      from decimo_terceiro_linhas l
     where l.tenant_id = p_tenant_id
       and l.colaborador_id = p_colaborador_id
       and l.folha_id in (select id from decimo_terceiro_folhas where tenant_id = p_tenant_id and ano = v_ano)
       and not exists (
         select 1 from folhas_pagamento f
          where f.tenant_id = p_tenant_id
            and f.decimo_terceiro_linha_id = l.id
            and f.status = 'paga'
       )
  ), del as (
    delete from decimo_terceiro_linhas
     where id in (select id from alvo)
    returning 1
  )
  select count(*) into v_13_deletadas from del;

  select count(*) into v_13_preservadas
    from decimo_terceiro_linhas l
    join decimo_terceiro_folhas f on f.id = l.folha_id
   where l.tenant_id = p_tenant_id
     and l.colaborador_id = p_colaborador_id
     and f.ano = v_ano;

  -- 3. Períodos de férias não terminais → pago_rescisao.
  update colaboradores_ferias_periodos
     set status = 'pago_rescisao',
         updated_at = now()
   where tenant_id = p_tenant_id
     and colaborador_id = p_colaborador_id
     and status in ('incompleto','apto','em_alerta','vencido','regularizado','nao_habilitado');
  get diagnostics v_ferias_periodos = row_count;

  -- 4. Lançamentos de férias em andamento → cancelado.
  update colaboradores_ferias_lancamentos
     set status = 'cancelado',
         updated_at = now()
   where tenant_id = p_tenant_id
     and colaborador_id = p_colaborador_id
     and status in (
       'pendente_aprovacao','em_analise','aguardando_financeiro',
       'aprovado','nf_anexada','enviado_financeiro'
     );
  get diagnostics v_ferias_lancamentos = row_count;

  return jsonb_build_object(
    'folhas_canceladas', v_folhas_canceladas,
    'decimo_terceiro_linhas_deletadas', v_13_deletadas,
    'decimo_terceiro_linhas_preservadas', v_13_preservadas,
    'ferias_periodos_encerrados', v_ferias_periodos,
    'ferias_lancamentos_cancelados', v_ferias_lancamentos
  );
end;
$function$;

grant execute on function public.encerrar_pendencias_rescisao(uuid, uuid, date) to authenticated;

-- Endurece gerar_folha_da_competencia: colaborador inativo não entra em
-- folha nova. A folha do mês da rescisão é tratada pela página de
-- rescisão (TRCT), não pelo gerador normal. Antes o filtro deixava
-- passar quem tinha data_encerramento >= primeiro dia da competência,
-- o que recriava a linha pro inativo em qualquer regeneração.

create or replace function public.gerar_folha_da_competencia(p_tenant_id uuid, p_ano integer, p_mes integer)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_primeiro       date := make_date(p_ano, p_mes, 1);
  v_ultimo         date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_criado_por     uuid := (select auth.uid());
  v_candidatos     integer;
  v_criadas        integer := 0;
  v_sem_sal        text[] := '{}';
  v_sem_aloc       text[] := '{}';
  v_sem_rat        text[] := '{}';
  v_descontados    jsonb := '[]'::jsonb;
  v_folha_id       uuid;
  v_dias_ferias    integer;
  v_salario_final  numeric;
  r                record;
begin
  select count(*) into v_candidatos
    from colaboradores c
   where c.tenant_id = p_tenant_id
     and c.tipo_contratacao in ('pj', 'mei', 'clt_recibo')
     and c.data_admissao <= v_ultimo
     and c.status = 'ativo';

  for r in
    select c.id,
           c.nome,
           s.colaborador_id is not null as tem_salario,
           case when c.tipo_contratacao = 'clt_recibo' then s.valor_recibo else s.valor end as salario,
           a.colaborador_id is not null as tem_alocacao,
           a.empresa_id,
           a.regional_id,
           a.usa_rateio_empresa
      from colaboradores c
      left join colaboradores_salarios s
        on s.colaborador_id = c.id and s.tenant_id = p_tenant_id and s.data_fim is null
      left join colaboradores_alocacoes a
        on a.colaborador_id = c.id and a.tenant_id = p_tenant_id and a.data_fim is null
     where c.tenant_id = p_tenant_id
       and c.tipo_contratacao in ('pj', 'mei', 'clt_recibo')
       and c.data_admissao <= v_ultimo
       and c.status = 'ativo'
       and not exists (
         select 1 from folhas_pagamento f
          where f.tenant_id = p_tenant_id
            and f.colaborador_id = c.id
            and f.competencia_ano = p_ano
            and f.competencia_mes = p_mes
            and f.origem = 'california'
            and f.tipo = 'salario'
       )
  loop
    if not r.tem_salario or r.salario is null or r.salario <= 0 then
      v_sem_sal := v_sem_sal || r.nome;
      continue;
    end if;

    if not r.tem_alocacao then
      v_sem_aloc := v_sem_aloc || r.nome;
      continue;
    end if;

    if r.usa_rateio_empresa then
      if not exists (
        select 1 from empresas_rateios_regionais er
         where er.tenant_id = p_tenant_id
           and er.empresa_id = r.empresa_id
           and er.ano_vigencia = p_ano
           and er.percentual > 0
      ) then
        v_sem_rat := v_sem_rat || r.nome;
        continue;
      end if;
    elsif r.regional_id is null then
      v_sem_aloc := v_sem_aloc || r.nome;
      continue;
    end if;

    v_dias_ferias := public.fn_dias_ferias_na_competencia(r.id, p_ano, p_mes);
    if v_dias_ferias > 0 then
      v_salario_final := round(r.salario * (30 - v_dias_ferias) / 30.0, 2);
      v_descontados := v_descontados || jsonb_build_object(
        'nome', r.nome,
        'dias_ferias', v_dias_ferias,
        'salario_original', r.salario,
        'salario_ajustado', v_salario_final
      );
    else
      v_salario_final := r.salario;
    end if;

    insert into folhas_pagamento (
      tenant_id, colaborador_id, competencia_ano, competencia_mes,
      salario_base, status, origem, created_by
    ) values (
      p_tenant_id, r.id, p_ano, p_mes,
      v_salario_final, 'rascunho', 'california', v_criado_por
    )
    returning id into v_folha_id;

    if r.usa_rateio_empresa then
      insert into folhas_pagamento_alocacoes (tenant_id, folha_id, empresa_id, regional_id, percentual)
      select p_tenant_id, v_folha_id, r.empresa_id, er.regional_id, er.percentual
        from empresas_rateios_regionais er
       where er.tenant_id = p_tenant_id
         and er.empresa_id = r.empresa_id
         and er.ano_vigencia = p_ano
         and er.percentual > 0;
    else
      insert into folhas_pagamento_alocacoes (tenant_id, folha_id, empresa_id, regional_id, percentual)
      values (p_tenant_id, v_folha_id, r.empresa_id, r.regional_id, 100);
    end if;

    v_criadas := v_criadas + 1;
  end loop;

  return jsonb_build_object(
    'criadas', v_criadas,
    'ja_existiam', v_candidatos - (v_criadas + cardinality(v_sem_sal) + cardinality(v_sem_aloc) + cardinality(v_sem_rat)),
    'pulados_sem_salario', to_jsonb(v_sem_sal),
    'pulados_sem_alocacao', to_jsonb(v_sem_aloc),
    'pulados_sem_rateio', to_jsonb(v_sem_rat),
    'descontados', v_descontados
  );
end;
$function$;
