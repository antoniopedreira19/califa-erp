-- 03/10/2026: desfaz a abertura do job ANI-1001/26 no financeiro e o
-- devolve à produção, como se o financeiro o tivesse devolvido em vez de
-- abrir.
--
-- O orçamento ANI-P002/26-01 (Always On) foi aprovado e enviado com um mês
-- só (outubro), quando deveria cobrir o trimestre inteiro. O financeiro
-- abriu o job em 02/10/2026. Mudar os meses é mudar o orçado, e isso a
-- errata não faz: o caminho é o da decisão 128 (job devolvido -> "Cancelar
-- aprovação" -> orçamento corrigido -> aprovação -> envio com o mesmo
-- código). A GP já combinou com o Tiago; por isso o job volta sem motivo
-- escrito.
--
-- Nenhuma tela desfaz uma abertura (116/117), e a guarda
-- `jobs_guarda_escrita_direta` barra `aberto -> rejeitado_financeiro` para
-- quem está logado. Por isso é uma migration. Ela é destrutiva, e o Tiago
-- pediu em 03/10/2026 ("Você poderia reverter essa ação?").
--
-- O que sai, tudo gravado pela abertura de 02/10:
--   - no job: nome financeiro, projeto do financeiro, as três contas,
--     competência, custo previsto, data e autor da abertura (null, como em
--     todo job ainda não aberto);
--   - previsão de desembolso, de recebimento e de impostos, o rateio de
--     competência e o registro nº 1 da aba Abertura;
--   - o projeto do financeiro criado nessa abertura, que só tinha este
--     job: o gatilho `projeto_financeiro_sem_job_some` (119) o apaga e
--     registra na auditoria.
-- O que fica: código, planilha do job, as 2 PPs geradas (não enviadas ao
-- financeiro), contato de cobrança, orçamento em `job_criado` e a v1
-- aprovada (regra 3 da 057).
--
-- Tudo o que sai vai inteiro no metadata do evento `job.abertura_desfeita`.
-- A migration só age se o job ainda estiver como no levantamento (aberto,
-- sem lançamento, nota, envio ao faturamento, errata, alteração, save ou
-- PP enviada ao financeiro); se não, ela falha e nada é gravado.

do $$
declare
  v_job_id   constant uuid := '0c46e630-6c6b-494b-94a7-a04c0b358f72';
  v_tiago    constant uuid := 'fa61a319-6409-4d02-93c5-8d8be2746673';
  v_job      public.jobs%rowtype;
  v_retrato  jsonb;
begin
  select * into v_job from public.jobs where id = v_job_id for update;

  if not found or v_job.codigo <> 'ANI-1001/26' or v_job.status <> 'aberto' then
    raise exception 'ANI-1001/26 não está mais aberto como no levantamento de 03/10.';
  end if;

  if exists (select 1 from public.lancamentos_financeiros where job_id = v_job_id)
     or exists (select 1 from public.jobs_envio_faturamento where job_id = v_job_id)
     or exists (select 1 from public.jobs_envio_faturamento_notas where job_id = v_job_id)
     or exists (select 1 from public.faturamento_itens where origem_id = v_job_id)
     or exists (select 1 from public.jobs_erratas where job_id = v_job_id)
     or exists (select 1 from public.jobs_alteracoes_financeiro where job_id = v_job_id)
     or exists (select 1 from public.saves_aprovacoes where job_id = v_job_id)
     or exists (select 1 from public.recebimentos_antes_nf where job_id = v_job_id)
     or exists (select 1 from public.desembolsos where job_id = v_job_id)
     or exists (select 1 from public.contas_avulsas where job_id = v_job_id)
     or exists (
       select 1 from public.pedidos_compra
        where job_id = v_job_id
          and (enviada_financeiro_em is not null or status <> 'gerada')
     )
  then
    raise exception 'ANI-1001/26 já tem movimento no financeiro; a abertura não se desfaz por esta migration.';
  end if;

  -- O retrato do que sai, antes de sair.
  v_retrato := jsonb_build_object(
    'job', jsonb_build_object(
      'nome_financeiro', v_job.nome_financeiro,
      'projeto_financeiro_id', v_job.projeto_financeiro_id,
      'projeto_financeiro', (select to_jsonb(pf) from public.projetos_financeiro pf where pf.id = v_job.projeto_financeiro_id),
      'conta_recebimento_id', v_job.conta_recebimento_id,
      'conta_pagamento_id', v_job.conta_pagamento_id,
      'conta_impostos_id', v_job.conta_impostos_id,
      'competencia_trimestre', v_job.competencia_trimestre,
      'competencia_ano', v_job.competencia_ano,
      'custo_previsto_total', v_job.custo_previsto_total,
      'data_abertura_financeiro', v_job.data_abertura_financeiro,
      'aberto_por', v_job.aberto_por
    ),
    'previsao_custo', (select coalesce(jsonb_agg(to_jsonb(x) order by x.ordem), '[]') from public.jobs_previsao_custo x where x.job_id = v_job_id),
    'previsao_recebimento', (select coalesce(jsonb_agg(to_jsonb(x) order by x.ordem), '[]') from public.jobs_previsao_recebimento x where x.job_id = v_job_id),
    'previsao_impostos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.ordem), '[]') from public.jobs_previsao_impostos x where x.job_id = v_job_id),
    'competencias', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.jobs_competencias x where x.job_id = v_job_id),
    'aberturas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.numero), '[]') from public.jobs_aberturas x where x.job_id = v_job_id)
  );

  delete from public.jobs_previsao_custo where job_id = v_job_id;
  delete from public.jobs_previsao_recebimento where job_id = v_job_id;
  delete from public.jobs_previsao_impostos where job_id = v_job_id;
  delete from public.jobs_competencias where job_id = v_job_id;
  delete from public.jobs_aberturas where job_id = v_job_id;

  -- Soltar `projeto_financeiro_id` dispara o gatilho da 119, que apaga o
  -- projeto que ficou sem job e registra `projeto_financeiro.apagado_sem_job`.
  update public.jobs
     set status = 'rejeitado_financeiro',
         motivo_rejeicao = null,
         devolvido_em = now(),
         nome_financeiro = null,
         projeto_financeiro_id = null,
         conta_recebimento_id = null,
         conta_pagamento_id = null,
         conta_impostos_id = null,
         competencia_trimestre = null,
         competencia_ano = null,
         custo_previsto_total = null,
         data_abertura_financeiro = null,
         aberto_por = null
   where id = v_job_id;

  insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
  values (
    v_job.tenant_id, v_tiago, 'job.abertura_desfeita', 'job', v_job_id::text,
    jsonb_build_object(
      'codigo', v_job.codigo,
      'status_de', 'aberto',
      'status_para', 'rejeitado_financeiro',
      'motivo', 'Orçamento Always On aprovado e enviado com um mês só; deveria cobrir o trimestre. Correção pelo "Cancelar aprovação" (decisão 128), combinada com a GP.',
      'removido', v_retrato,
      'origem', 'migration 20261003300001'
    )
  );
end
$$;
