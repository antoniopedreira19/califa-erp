-- Motivo: ajusta fn_rotina_diaria_ferias pra usar data_limite_gozo nas
-- regras de "concessivo em alerta" (60 dias antes) e "férias vencidas",
-- mantendo coerência com a nova regra operacional (= aquisitivo_fim + 11m).
--
-- Antes: comparava com concessivo_fim.
-- Depois: compara com data_limite_gozo.
-- "Férias vencidas" agora dispara 1 dia depois de data_limite_gozo
-- (não concessivo_fim) — alinhado com o alerta operacional da planilha.

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
  -- 1. CONCESSIVO LIBERADO (aquisitivo fechou ontem)
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

  -- 2. EM ALERTA — 60 dias antes de data_limite_gozo
  for r in
    select p.id, p.tenant_id, p.colaborador_id, p.numero,
           p.data_limite_gozo, c.nome as colab_nome
      from public.colaboradores_ferias_periodos p
      join public.colaboradores c on c.id = p.colaborador_id
     where p.data_limite_gozo - v_hoje = 60
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
        format('Férias de %s precisam ser agendadas', r.colab_nome),
        format(
          'O período aquisitivo #%s de %s precisa começar o gozo até %s (60 dias).',
          r.numero, r.colab_nome, r.data_limite_gozo
        ),
        jsonb_build_object('numero', r.numero, 'data_limite_gozo', r.data_limite_gozo),
        null,
        r.id
      );
    end if;
  end loop;

  -- 3. FÉRIAS VENCIDAS — 1 dia depois de data_limite_gozo
  for r in
    select p.id, p.tenant_id, p.colaborador_id, p.numero,
           p.data_limite_gozo, c.nome as colab_nome
      from public.colaboradores_ferias_periodos p
      join public.colaboradores c on c.id = p.colaborador_id
     where p.data_limite_gozo = v_hoje - 1
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
          'O período #%s de %s passou do limite operacional (%s) sem ser gozado. Precisa regularizar.',
          r.numero, r.colab_nome, r.data_limite_gozo
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
         (p.data_limite_gozo < v_hoje and p.status in ('apto', 'em_alerta'))
         or (p.data_limite_gozo - v_hoje between 0 and 60 and p.status = 'apto')
         or (p.aquisitivo_fim < v_hoje and p.status = 'incompleto')
       )
  loop
    perform public.fn_recalcular_status_periodo(r.id);
  end loop;
end;
$$;
