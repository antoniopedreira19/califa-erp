-- =============================================================================
-- Decisão 265 — o Novo faturamento substitui o envio em todos os contextos
-- =============================================================================
--
-- Regra do Tiago (18/11/2026): "O novo faturamento substitui completamente o
-- envio e faturamento do envio, em todos os contextos." Onde o banco mede o
-- faturamento do job pelo envio do GP (`jobs_envio_faturamento`), a nota do
-- Novo faturamento (`faturamentos.faturado_pelo_financeiro`, itens `job` e
-- `save` do job, sem parcela de envio) passa a contar igual:
--
--   1. `vw_job_rentabilidade` (Relatórios de Rentabilidade e de Faturamento,
--      Impostos da Abertura › Abertos): o faturamento realizado soma as notas
--      do Novo faturamento; o save enviado soma os itens `save` delas; o
--      imposto realizado da Mídia Off conta os meses faturados por elas.
--      Antes, o job faturado pelo financeiro saía "Não Faturado", com R$ 0.
--   2. `vw_fluxo_caixa`: a previsão de recebimento do job só saía quando havia
--      envio. Com o Novo faturamento ela continuava, ao lado dos títulos da
--      nota: o valor entrava duas vezes (R$ 927.741,02 na produção, nos
--      AMB-1042/26, AMB-1058/26 e AMB-1061/26). Agora o que o Novo
--      faturamento cobriu sai da previsão, na ordem das parcelas (no mensal,
--      do mês); o que sobra é o saldo que fica com o financeiro, como o saldo
--      de um envio. A parte própria (sem o save) segue a regra da nota: o job
--      primeiro, o save por último.
--   3. `trava_do_cancelamento_do_job`: o job faturado pelo financeiro não se
--      cancela pelo sistema, como o job enviado para faturamento.
--   4. `save_rateio_das_notas`: quando o save muda depois da nota, o rateio
--      job × save das notas do Novo faturamento (do job inteiro) se refaz
--      como na emissão: o job primeiro, o save até o previsto em save, e o
--      que passar volta ao job. As notas do Novo faturamento por mês (mensal
--      e Mídia Off) ficam como saíram.
--
-- As views são refeitas a partir do texto atual delas, com trocas pontuais
-- (cada trecho tem de aparecer uma vez só, senão a migration para sem mudar
-- nada). As colunas não mudam. A Novo faturamento abaixo do previsto não
-- muda: o resto continua saldo com o financeiro.
-- =============================================================================

create function pg_temp.troca_unica(texto text, antigo text, novo text)
returns text
language plpgsql
as $f$
declare
  n integer := (length(texto) - length(replace(texto, antigo, ''))) / length(antigo);
begin
  if n <> 1 then
    raise exception 'Trecho esperado uma vez, achado % vezes: %', n, left(antigo, 120);
  end if;
  return replace(texto, antigo, novo);
end $f$;

create function pg_temp.troca_regex_unica(texto text, padrao text, novo text)
returns text
language plpgsql
as $f$
declare
  n integer;
begin
  select count(*) into n from regexp_matches(texto, padrao, 'g');
  if n <> 1 then
    raise exception 'Padrão esperado uma vez, achado % vezes: %', n, left(padrao, 120);
  end if;
  return regexp_replace(texto, padrao, novo);
end $f$;

-- ------------------------------------------------------ 1. vw_job_rentabilidade
do $$
declare
  v text := pg_get_viewdef('public.vw_job_rentabilidade'::regclass);
begin
  -- O faturamento realizado (bruto): o envio mais as notas do Novo faturamento.
  v := pg_temp.troca_unica(v,
    'SELECT sum(jobs_envio_faturamento.valor_faturado) AS total',
    $t$SELECT (COALESCE(sum(jobs_envio_faturamento.valor_faturado), (0)::numeric) + COALESCE(( SELECT sum(fin.valor) AS sum
                           FROM (faturamento_itens fin
                             JOIN faturamentos fn ON ((fn.id = fin.faturamento_id)))
                          WHERE (fn.faturado_pelo_financeiro AND (fn.status = 'emitido'::faturamento_status) AND (fin.origem_tipo = ANY (ARRAY['job'::faturamento_origem, 'save'::faturamento_origem])) AND (fin.origem_id = j.id))), (0)::numeric)) AS total$t$);

  -- O save enviado: o do envio mais os itens `save` das notas do Novo faturamento.
  v := pg_temp.troca_unica(v, 'save_enviado AS (', 'save_enviado_envio AS (');
  v := pg_temp.troca_unica(v, '), migrado AS (', $t$), save_enviado AS (
         SELECT x.job_id,
            sum(x.valor) AS valor
           FROM ( SELECT save_enviado_envio.job_id,
                    save_enviado_envio.valor
                   FROM save_enviado_envio
                UNION ALL
                 SELECT fin.origem_id,
                    fin.valor
                   FROM (faturamento_itens fin
                     JOIN faturamentos fn ON ((fn.id = fin.faturamento_id)))
                  WHERE (fn.faturado_pelo_financeiro AND (fn.status = 'emitido'::faturamento_status) AND (fin.origem_tipo = 'save'::faturamento_origem))) x
          GROUP BY x.job_id
        ), migrado AS ($t$);

  -- O imposto realizado da Mídia Off: os meses do envio e os do Novo faturamento.
  v := pg_temp.troca_regex_unica(v,
    'FROM \(jobs_envio_faturamento e(\s+)CROSS JOIN LATERAL \( SELECT sum\(jio\.total_orcado\) AS negociado',
    $t$FROM (( SELECT e0.job_id,
                    e0.mes
                   FROM jobs_envio_faturamento e0
                UNION
                 SELECT fin.origem_id,
                    fn.mes_novo_faturamento
                   FROM (faturamento_itens fin
                     JOIN faturamentos fn ON ((fn.id = fin.faturamento_id)))
                  WHERE (fn.faturado_pelo_financeiro AND (fn.status = 'emitido'::faturamento_status) AND (fin.origem_tipo = ANY (ARRAY['job'::faturamento_origem, 'save'::faturamento_origem])) AND (fn.mes_novo_faturamento IS NOT NULL))) e\1CROSS JOIN LATERAL ( SELECT sum(jio.total_orcado) AS negociado$t$);

  execute 'create or replace view public.vw_job_rentabilidade with (security_invoker = true) as ' || v;
end $$;

-- ------------------------------------------------------------ 2. vw_fluxo_caixa
do $$
declare
  v  text := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  p1 integer := position('previsao_recebimento AS (' in v);
  p2 integer := position('), envio_saldo AS (' in v);
begin
  if p1 = 0 or p2 = 0 or p2 < p1 then
    raise exception 'previsao_recebimento não encontrado em vw_fluxo_caixa';
  end if;
  if position('jobs_previsao_recebimento' in substring(v from p2)) > 0 then
    raise exception 'jobs_previsao_recebimento lido fora de previsao_recebimento: rever a troca';
  end if;

  v := substring(v from 1 for p1 - 1) || $t$previsao_recebimento AS (
         SELECT p.id,
            p.tenant_id,
            p.job_id,
            p.ordem,
            p.data_prevista,
            p.valor,
            p.mes,
            count(*) OVER (PARTITION BY p.job_id) AS total_parcelas,
            (
                CASE
                    WHEN (p.mes IS NOT NULL) THEN GREATEST((0)::numeric, (p.valor - COALESCE(p.valor_save, (0)::numeric)))
                    ELSE GREATEST((0)::numeric, LEAST(p.valor, (GREATEST((0)::numeric, ((COALESCE(j.faturamento_previsto, (0)::numeric) - COALESCE(j.faturamento_save_previsto, (0)::numeric)) - p.coberto)) - (sum(p.valor) OVER (PARTITION BY p.job_id ORDER BY p.data_prevista, p.ordem, p.id) - p.valor))))
                END)::numeric(14,2) AS valor_proprio
           FROM (( SELECT p0.id,
                    p0.tenant_id,
                    p0.job_id,
                    p0.ordem,
                    p0.data_prevista,
                    p0.mes,
                    p0.valor_save,
                    COALESCE(nc.valor, (0)::numeric) AS coberto,
                    (GREATEST((0)::numeric, LEAST(p0.valor, (sum(p0.valor) OVER (PARTITION BY p0.job_id, p0.mes ORDER BY p0.data_prevista, p0.ordem, p0.id) - COALESCE(nc.valor, (0)::numeric)))))::numeric(14,2) AS valor
                   FROM (jobs_previsao_recebimento p0
                     LEFT JOIN ( SELECT fin.origem_id AS job_id,
                            fn.mes_novo_faturamento AS mes,
                            sum(fin.valor) AS valor
                           FROM (faturamento_itens fin
                             JOIN faturamentos fn ON ((fn.id = fin.faturamento_id)))
                          WHERE (fn.faturado_pelo_financeiro AND (fn.status = 'emitido'::faturamento_status) AND (fin.origem_tipo = ANY (ARRAY['job'::faturamento_origem, 'save'::faturamento_origem])))
                          GROUP BY fin.origem_id, fn.mes_novo_faturamento) nc ON (((nc.job_id = p0.job_id) AND (NOT (nc.mes IS DISTINCT FROM p0.mes)))))) p
             JOIN jobs j ON ((j.id = p.job_id)))
        $t$ || substring(v from p2);

  execute 'create or replace view public.vw_fluxo_caixa as ' || v;
end $$;

-- ------------------------------------------------- 3. trava_do_cancelamento_do_job
do $$
declare
  v text := pg_get_functiondef('public.trava_do_cancelamento_do_job(uuid)'::regprocedure);
begin
  v := pg_temp.troca_unica(v,
    $t$return 'O job já foi enviado para faturamento: não se cancela pelo sistema. Fale com o financeiro.';
  end if;$t$,
    $t$return 'O job já foi enviado para faturamento: não se cancela pelo sistema. Fale com o financeiro.';
  end if;

  -- Decisão 265: o Novo faturamento substitui o envio.
  if exists (
    select 1
      from public.faturamentos f
      join public.faturamento_itens fi on fi.faturamento_id = f.id
     where f.faturado_pelo_financeiro
       and f.status = 'emitido'
       and fi.origem_tipo in ('job', 'save')
       and fi.origem_id = p_job_id
  ) then
    return 'O financeiro já faturou este job: não se cancela pelo sistema. Fale com o financeiro.';
  end if;$t$);
  execute v;
end $$;

-- ------------------------------------------------------- 4. save_rateio_das_notas
create or replace function public.save_rateio_das_notas(p_job_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  par     record;
  n       record;
  v_livre numeric(14,2);
  v_total numeric(14,2);
  v_job   numeric(14,2);
  v_save  numeric(14,2);
  v_notas jsonb := '[]'::jsonb;
  v_tenant uuid;
  v_save_livre numeric(14,2);
begin
  for par in
    select x.id, x.tenant_id, x.bruto_proprio
      from (
        select p.id, p.tenant_id, p.envio_id, p.ordem,
               greatest(0::numeric, least(p.valor,
                 case
                   when e.mes is not null
                     then e.valor_faturado - coalesce(e.valor_save, 0)
                   else coalesce(j.faturamento_previsto, 0) - coalesce(j.faturamento_save_previsto, 0)
                 end
                 - (sum(p.valor) over (partition by p.envio_id order by p.ordem, p.id) - p.valor)
               ))::numeric(14,2) as bruto_proprio
          from public.jobs_envio_faturamento_parcelas p
          join public.jobs_envio_faturamento e on e.id = p.envio_id
          join public.jobs j on j.id = p.job_id
         where p.job_id = p_job_id
      ) x
     where exists (
             select 1 from public.faturamento_itens fi
              where fi.envio_parcela_id = x.id)
     order by x.envio_id, x.ordem, x.id
  loop
    v_livre := par.bruto_proprio;
    v_tenant := par.tenant_id;

    for n in
      select f.id as faturamento_id,
             f.numero_nf,
             coalesce(sum(fi.valor) filter (where fi.origem_tipo = 'job'), 0)::numeric(14,2) as v_job,
             coalesce(sum(fi.valor) filter (where fi.origem_tipo = 'save'), 0)::numeric(14,2) as v_save
        from public.faturamento_itens fi
        join public.faturamentos f on f.id = fi.faturamento_id
       where fi.envio_parcela_id = par.id
         and fi.origem_id = p_job_id
         and fi.origem_tipo in ('job', 'save')
         and f.status = 'emitido'
       group by f.id, f.numero_nf, f.emitido_em
       order by f.emitido_em, f.id
    loop
      v_total := n.v_job + n.v_save;
      v_job := least(v_total, v_livre);
      v_save := v_total - v_job;
      v_livre := v_livre - v_job;

      if v_job <> n.v_job or v_save <> n.v_save then
        delete from public.faturamento_itens fi
         where fi.faturamento_id = n.faturamento_id
           and fi.envio_parcela_id = par.id
           and fi.origem_id = p_job_id
           and fi.origem_tipo in ('job', 'save');

        if v_job > 0 then
          insert into public.faturamento_itens
            (tenant_id, faturamento_id, origem_tipo, origem_id, envio_parcela_id, valor)
          values (par.tenant_id, n.faturamento_id, 'job', p_job_id, par.id, v_job);
        end if;
        if v_save > 0 then
          insert into public.faturamento_itens
            (tenant_id, faturamento_id, origem_tipo, origem_id, envio_parcela_id, valor)
          values (par.tenant_id, n.faturamento_id, 'save', p_job_id, par.id, v_save);
        end if;

        v_notas := v_notas || jsonb_build_object(
          'faturamento_id', n.faturamento_id,
          'numero_nf', n.numero_nf,
          'job_antes', n.v_job, 'save_antes', n.v_save,
          'job_depois', v_job, 'save_depois', v_save);
      end if;
    end loop;
  end loop;

  -- Decisão 265: as notas do Novo faturamento do job inteiro (sem mês), na
  -- ordem da emissão, como a emissão divide: o job primeiro, o save até o
  -- previsto em save, e o que passar volta ao job.
  select greatest(0, coalesce(j.faturamento_previsto, 0) - coalesce(j.faturamento_save_previsto, 0))::numeric(14,2),
         greatest(0, coalesce(j.faturamento_save_previsto, 0))::numeric(14,2)
    into v_livre, v_save_livre
    from public.jobs j
   where j.id = p_job_id;

  for n in
    select f.id as faturamento_id,
           f.numero_nf,
           f.tenant_id,
           coalesce(sum(fi.valor) filter (where fi.origem_tipo = 'job'), 0)::numeric(14,2) as v_job,
           coalesce(sum(fi.valor) filter (where fi.origem_tipo = 'save'), 0)::numeric(14,2) as v_save
      from public.faturamento_itens fi
      join public.faturamentos f on f.id = fi.faturamento_id
     where f.faturado_pelo_financeiro
       and f.mes_novo_faturamento is null
       and f.status = 'emitido'
       and fi.envio_parcela_id is null
       and fi.origem_id = p_job_id
       and fi.origem_tipo in ('job', 'save')
     group by f.id, f.numero_nf, f.tenant_id, f.emitido_em
     order by f.emitido_em, f.id
  loop
    v_tenant := n.tenant_id;
    v_total := n.v_job + n.v_save;
    v_job := least(v_total, v_livre);
    v_save := least(v_total - v_job, v_save_livre);
    v_job := v_total - v_save;
    v_livre := greatest(0, v_livre - v_job);
    v_save_livre := v_save_livre - v_save;

    if v_job <> n.v_job or v_save <> n.v_save then
      delete from public.faturamento_itens fi
       where fi.faturamento_id = n.faturamento_id
         and fi.envio_parcela_id is null
         and fi.origem_id = p_job_id
         and fi.origem_tipo in ('job', 'save');

      if v_job > 0 then
        insert into public.faturamento_itens
          (tenant_id, faturamento_id, origem_tipo, origem_id, envio_parcela_id, valor)
        values (n.tenant_id, n.faturamento_id, 'job', p_job_id, null, v_job);
      end if;
      if v_save > 0 then
        insert into public.faturamento_itens
          (tenant_id, faturamento_id, origem_tipo, origem_id, envio_parcela_id, valor)
        values (n.tenant_id, n.faturamento_id, 'save', p_job_id, null, v_save);
      end if;

      v_notas := v_notas || jsonb_build_object(
        'faturamento_id', n.faturamento_id,
        'numero_nf', n.numero_nf,
        'job_antes', n.v_job, 'save_antes', n.v_save,
        'job_depois', v_job, 'save_depois', v_save);
    end if;
  end loop;

  -- Auditoria só com usuário logado (migration e service role não têm).
  if jsonb_array_length(v_notas) > 0 and (select auth.uid()) is not null then
    perform public.log_audit_event(
      'faturamento.rateio_save_refeito', v_tenant, 'job', p_job_id::text,
      jsonb_build_object('notas', v_notas));
  end if;

  return jsonb_array_length(v_notas);
end;
$function$;
