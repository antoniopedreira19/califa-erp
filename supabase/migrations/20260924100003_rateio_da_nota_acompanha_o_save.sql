-- =============================================================================
-- Decisão 102 — o rateio job × save da nota emitida acompanha o save
-- (regra 21 da 099, fechada pelo Tiago em 24/09/2026)
-- =============================================================================
--
-- A nota separa o que é do job do que é save em dois itens
-- (`faturamento_itens.origem_tipo` 'job' e 'save'), pela regra de 26/08:
-- JOB PRIMEIRO, SAVE POR ÚLTIMO. Os títulos da nota, as baixas e o fluxo de
-- caixa não guardam divisão nenhuma: tudo deriva desses itens
-- (`vw_titulo_partes`, `vw_lancamento_origens`, `vw_fluxo_caixa`).
--
-- O save pode mudar depois da nota: gerar save continua possível depois do
-- envio ao faturamento, e retirar um save gerado vale até o encerramento.
-- O total da nota não muda (a linha em save continua na nota); muda quanto
-- dela é do job e quanto é crédito do cliente. Até aqui os itens ficavam
-- como na emissão.
--
-- A regra do Tiago: o rateio se refaz NO MOMENTO em que o save muda, e se
-- o save novo for maior do que falta receber, ele se apropria de parte do
-- que já foi recebido — esse dinheiro passa a ser do save, na data em que
-- entrou. É a mesma lógica que o fluxo de caixa já usa no consumo de save
-- ("o valor passa a ser do job que consome, na data em que o dinheiro
-- entrou", 20260827010006).
--
-- `save_rateio_das_notas(job)` refaz os itens job/save das notas EMITIDAS
-- do job com a mesma conta da fila de faturamento (`vw_faturamento_pendente`):
--
--   * a parte própria de cada parcela do envio é o próprio do envio
--     (mensal: `valor_faturado − valor_save` do mês; senão
--     `faturamento_previsto − faturamento_save_previsto` do job), coberto
--     parcela a parcela na ordem;
--   * dentro da parcela, as notas na ordem de emissão: o job primeiro, até
--     a parte própria da parcela; o resto é save.
--
-- Só os itens 'job' e 'save' DESTE job mudam; o total de cada nota fica
-- igual, e o BV e os outros jobs de uma nota agrupada não são tocados.
-- Nota cancelada fica como está.
--
-- `save_gravar_totais` — por onde passam aprovar, recusar pedido já
-- contado, cancelar e retirar save — chama o rateio depois de regravar os
-- números do job. Pedido que ainda aguarda não muda os números do
-- financeiro, então não mexe em nota.
--
-- Nenhum dado muda nesta migration: não há nota emitida no banco hoje (24/09).
-- =============================================================================

create or replace function public.save_rateio_das_notas(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  par     record;
  n       record;
  v_livre numeric(14,2);
  v_total numeric(14,2);
  v_job   numeric(14,2);
  v_save  numeric(14,2);
  v_notas jsonb := '[]'::jsonb;
  v_tenant uuid;
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

  -- Auditoria só com usuário logado (migration e service role não têm).
  if jsonb_array_length(v_notas) > 0 and (select auth.uid()) is not null then
    perform public.log_audit_event(
      'faturamento.rateio_save_refeito', v_tenant, 'job', p_job_id::text,
      jsonb_build_object('notas', v_notas));
  end if;

  return jsonb_array_length(v_notas);
end;
$$;

revoke all on function public.save_rateio_das_notas(uuid) from public, anon, authenticated;

comment on function public.save_rateio_das_notas(uuid) is
  'Decisão 102: refaz os itens job/save das notas emitidas do job pela regra "job primeiro, save por último", com a mesma conta de vw_faturamento_pendente. Chamada por save_gravar_totais.';

-- `save_gravar_totais` passa a refazer o rateio no fim. A troca é feita
-- sobre a definição atual (20260922140009) e falha se o fim da função não
-- estiver onde se espera.
do $troca$
declare
  v_fn  regprocedure := 'public.save_gravar_totais(uuid,jsonb)'::regprocedure;
  v_def text := pg_get_functiondef('public.save_gravar_totais(uuid,jsonb)'::regprocedure);
  v_de  text := E'\nend;\n$function$';
begin
  if position('save_rateio_das_notas' in v_def) > 0 then
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 then
    raise exception 'Fim esperado não encontrado (ou repetido) em %', v_fn;
  end if;
  execute replace(v_def, v_de,
    E'\n\n  -- Decisão 102: o rateio job × save das notas já emitidas acompanha.\n'
    || E'  perform public.save_rateio_das_notas(p_job_id);' || v_de);
end
$troca$;
