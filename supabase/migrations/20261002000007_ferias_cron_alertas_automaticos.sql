-- Motivo: cria 6 jobs no pg_cron que rodam todo dia às 06:00 (horário SP)
-- para gerar notificações automáticas do subsistema de Férias:
--   1. concessivo_liberado: aquisitivo completou 12m, pode agendar.
--   2. concessivo_em_alerta: 60 dias antes do fim do concessivo (F14).
--   3. ferias_vencidas: concessivo acabou com saldo pendente.
--   4. emitir_nf: 5 dias antes do início pra PJ (F15).
--   5. retorno: 1 dia antes do fim do gozo aprovado.
--   6. concluir_lancamento: aprovado com data_fim < hoje vira concluído.
--
-- Também recalcula status dos períodos (em_alerta/vencido) todo dia.
--
-- Referências:
--   - docs/modulos/rh/25-ferias.md §6.3
--   - docs/modulos/rh/26-ferias-modelo-de-dados.md §7
--   - docs/modulos/rh/27-ferias-plano-de-execucao.md S8

-- ===========================================================================
-- Função helper: lista destinatários do colaborador (próprio + líder + RH)
-- ===========================================================================

create or replace function public.fn_destinatarios_ferias(
  p_tenant_id uuid,
  p_colaborador_id uuid,
  p_incluir_colaborador boolean default true,
  p_incluir_lider boolean default true,
  p_incluir_rh boolean default true
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid;
  v_lider_id uuid;
  v_result uuid[] := '{}'::uuid[];
begin
  if p_incluir_colaborador or p_incluir_lider then
    select user_id, lider_id into v_user_id, v_lider_id
      from public.colaboradores where id = p_colaborador_id;
    if p_incluir_colaborador and v_user_id is not null then
      v_result := array_append(v_result, v_user_id);
    end if;
    if p_incluir_lider and v_lider_id is not null then
      v_result := array_append(v_result, v_lider_id);
    end if;
  end if;

  if p_incluir_rh then
    v_result := v_result || array(
      select tm.user_id
        from public.tenant_members tm
       where tm.tenant_id = p_tenant_id
         and tm.status = 'ativo'
         and tm.role in ('administrador', 'rh')
    );
  end if;

  return array(
    select distinct uid
      from unnest(v_result) as uid
     where uid is not null
  );
end;
$$;

-- ===========================================================================
-- Função principal: roda todas as rotinas diárias de férias
-- ===========================================================================

create or replace function public.fn_rotina_diaria_ferias()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
  v_destinatarios uuid[];
begin
  -- 1. CONCESSIVO LIBERADO
  for r in
    select p.id, p.tenant_id, p.colaborador_id, p.numero,
           p.aquisitivo_fim, p.concessivo_fim, c.nome as colab_nome
      from public.colaboradores_ferias_periodos p
      join public.colaboradores c on c.id = p.colaborador_id
     where p.aquisitivo_fim = v_hoje - 1
       and c.status = 'ativo'
  loop
    if exists (
      select 1 from public.colaboradores_ferias_notificacoes
       where periodo_id = r.id and tipo = 'concessivo_liberado'
    ) then
      continue;
    end if;
    perform public.fn_recalcular_status_periodo(r.id);
    v_destinatarios := public.fn_destinatarios_ferias(r.tenant_id, r.colaborador_id);
    if array_length(v_destinatarios, 1) > 0 then
      perform public.fn_criar_notificacao_ferias(
        r.tenant_id,
        'concessivo_liberado'::ferias_notificacao_tipo,
        r.colaborador_id,
        v_destinatarios,
        format('Férias liberadas pra %s', r.colab_nome),
        format(
          'O período #%s (até %s) foi fechado. %s já pode agendar as férias.',
          r.numero, r.aquisitivo_fim, r.colab_nome
        ),
        jsonb_build_object('numero', r.numero),
        null,
        r.id
      );
    end if;
  end loop;

  -- 2. CONCESSIVO EM ALERTA (60 dias antes)
  for r in
    select p.id, p.tenant_id, p.colaborador_id, p.numero,
           p.concessivo_fim, c.nome as colab_nome
      from public.colaboradores_ferias_periodos p
      join public.colaboradores c on c.id = p.colaborador_id
     where p.concessivo_fim - v_hoje = 60
       and p.status in ('apto', 'em_alerta')
       and c.status = 'ativo'
  loop
    if exists (
      select 1 from public.colaboradores_ferias_notificacoes
       where periodo_id = r.id and tipo = 'concessivo_em_alerta'
    ) then
      continue;
    end if;
    perform public.fn_recalcular_status_periodo(r.id);
    v_destinatarios := public.fn_destinatarios_ferias(r.tenant_id, r.colaborador_id);
    if array_length(v_destinatarios, 1) > 0 then
      perform public.fn_criar_notificacao_ferias(
        r.tenant_id,
        'concessivo_em_alerta'::ferias_notificacao_tipo,
        r.colaborador_id,
        v_destinatarios,
        format('Férias de %s vencem em 60 dias', r.colab_nome),
        format(
          'O período aquisitivo #%s de %s precisa ser gozado até %s.',
          r.numero, r.colab_nome, r.concessivo_fim
        ),
        jsonb_build_object('numero', r.numero, 'concessivo_fim', r.concessivo_fim),
        null,
        r.id
      );
    end if;
  end loop;

  -- 3. FÉRIAS VENCIDAS
  for r in
    select p.id, p.tenant_id, p.colaborador_id, p.numero,
           p.concessivo_fim, c.nome as colab_nome
      from public.colaboradores_ferias_periodos p
      join public.colaboradores c on c.id = p.colaborador_id
     where p.concessivo_fim = v_hoje - 1
       and p.status in ('apto', 'em_alerta')
       and c.status = 'ativo'
  loop
    if exists (
      select 1 from public.colaboradores_ferias_notificacoes
       where periodo_id = r.id and tipo = 'ferias_vencidas'
    ) then
      continue;
    end if;
    perform public.fn_recalcular_status_periodo(r.id);
    v_destinatarios := public.fn_destinatarios_ferias(
      r.tenant_id, r.colaborador_id, false, false, true
    );
    if array_length(v_destinatarios, 1) > 0 then
      perform public.fn_criar_notificacao_ferias(
        r.tenant_id,
        'ferias_vencidas'::ferias_notificacao_tipo,
        r.colaborador_id,
        v_destinatarios,
        format('Férias vencidas: %s', r.colab_nome),
        format(
          'O período #%s de %s venceu em %s sem ser gozado. Precisa regularizar.',
          r.numero, r.colab_nome, r.concessivo_fim
        ),
        jsonb_build_object('numero', r.numero),
        null,
        r.id
      );
    end if;
  end loop;

  -- 4. EMITIR NF (PJ, 5 dias antes)
  for r in
    select l.id, l.tenant_id, l.colaborador_id, l.data_inicio, l.dias,
           c.nome as colab_nome, c.user_id
      from public.colaboradores_ferias_lancamentos l
      join public.colaboradores c on c.id = l.colaborador_id
     where l.status = 'aprovado'
       and l.data_inicio - v_hoje = 5
       and c.tipo_contratacao in ('pj', 'clt_recibo')
       and c.status = 'ativo'
  loop
    if exists (
      select 1 from public.colaboradores_ferias_notificacoes
       where lancamento_id = r.id and tipo = 'emitir_nf'
    ) then
      continue;
    end if;
    if r.user_id is null then continue; end if;
    perform public.fn_criar_notificacao_ferias(
      r.tenant_id,
      'emitir_nf'::ferias_notificacao_tipo,
      r.colaborador_id,
      array[r.user_id],
      'Emitir NF antes das férias',
      format(
        'Suas férias começam em %s. Emita a NF da competência atual antes de sair.',
        r.data_inicio
      ),
      jsonb_build_object('data_inicio', r.data_inicio, 'dias', r.dias),
      r.id,
      null
    );
  end loop;

  -- 5. RETORNO (1 dia antes)
  for r in
    select l.id, l.tenant_id, l.colaborador_id, l.data_fim, l.dias,
           c.nome as colab_nome
      from public.colaboradores_ferias_lancamentos l
      join public.colaboradores c on c.id = l.colaborador_id
     where l.status = 'aprovado'
       and l.data_fim - v_hoje = 1
       and c.status = 'ativo'
  loop
    if exists (
      select 1 from public.colaboradores_ferias_notificacoes
       where lancamento_id = r.id and tipo = 'retorno'
    ) then
      continue;
    end if;
    v_destinatarios := public.fn_destinatarios_ferias(
      r.tenant_id, r.colaborador_id, false, true, true
    );
    if array_length(v_destinatarios, 1) > 0 then
      perform public.fn_criar_notificacao_ferias(
        r.tenant_id,
        'retorno'::ferias_notificacao_tipo,
        r.colaborador_id,
        v_destinatarios,
        format('%s volta amanhã de férias', r.colab_nome),
        format('%s retorna em %s.', r.colab_nome, r.data_fim),
        jsonb_build_object('data_fim', r.data_fim),
        r.id,
        null
      );
    end if;
  end loop;

  -- 6. CONCLUIR LANÇAMENTOS
  update public.colaboradores_ferias_lancamentos
     set status = 'concluido'
   where status = 'aprovado'
     and data_fim < v_hoje;

  -- 7. RECALCULAR STATUS DOS PERÍODOS
  for r in
    select p.id
      from public.colaboradores_ferias_periodos p
     where p.status in ('incompleto', 'apto', 'em_alerta')
       and (
         (p.concessivo_fim < v_hoje and p.status in ('apto', 'em_alerta'))
         or (p.concessivo_fim - v_hoje between 0 and 60 and p.status = 'apto')
         or (p.aquisitivo_fim < v_hoje and p.status = 'incompleto')
       )
  loop
    perform public.fn_recalcular_status_periodo(r.id);
  end loop;
end;
$$;

comment on function public.fn_rotina_diaria_ferias is
  'Rotina diária do subsistema de Férias: gera notificações automáticas, conclui lançamentos finalizados e recalcula status de períodos. Idempotente — não duplica notificações já criadas.';

-- Agenda no pg_cron (06:00 horário SP = 09:00 UTC)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ferias_rotina_diaria') then
    perform cron.unschedule('ferias_rotina_diaria');
  end if;
end$$;

select cron.schedule(
  'ferias_rotina_diaria',
  '0 9 * * *',
  $$select public.fn_rotina_diaria_ferias();$$
);
