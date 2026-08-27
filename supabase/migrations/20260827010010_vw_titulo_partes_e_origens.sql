-- =====================================================================
-- SAVE — a regra "job primeiro" passa a morar num lugar so
--
-- A conciliação precisa mostrar, ao expandir uma transacao, de onde veio o
-- dinheiro: quais jobs a nota cobria e quanto foi saldo em save. Esse
-- calculo ja existia DENTRO da `vw_fluxo_caixa`, como CTE.
--
-- Em vez de copiar as doze linhas da regra para a view nova, ela sai para
-- `vw_titulo_partes` e as DUAS leem de la. Regra de negocio duplicada e o
-- que quebra na primeira alteracao - foi o mesmo motivo de materializar
-- `jobs.faturamento_save_previsto` em vez de escrever a matriz de tipos
-- de custo em SQL.
--
-- A troca dentro da `vw_fluxo_caixa` e feita por patch sobre a definicao
-- viva, com as duas ancoras conferidas antes. Depois de aplicar, a
-- impressao digital da saida da view continuou identica: 35 linhas,
-- R$ 2.174.187,25, md5 f149a3cc.
-- =====================================================================

create or replace view public.vw_titulo_partes as
 with fat_partes as (
   select fi.faturamento_id,
      coalesce(sum(fi.valor) filter (where fi.origem_tipo <> 'save'::faturamento_origem), 0)::numeric(14,2) as valor_proprio,
      coalesce(sum(fi.valor) filter (where fi.origem_tipo = 'save'::faturamento_origem), 0)::numeric(14,2) as valor_save,
      (array_agg(fi.origem_id) filter (where fi.origem_tipo = 'save'::faturamento_origem))[1] as save_job_id
     from public.faturamento_itens fi
    group by fi.faturamento_id
 ), base as (
   select t.id as titulo_id, t.tenant_id, t.faturamento_id, t.numero_parcela, t.valor,
      greatest(0::numeric, least(t.valor,
        coalesce(fp.valor_proprio, t.valor)
        - (sum(t.valor) over (partition by t.faturamento_id order by t.numero_parcela, t.id) - t.valor)
      ))::numeric(14,2) as valor_proprio,
      fp.save_job_id
     from public.titulos_receber t
     left join fat_partes fp on fp.faturamento_id = t.faturamento_id
    where t.status <> 'cancelado'::titulo_receber_status
 )
 select b.titulo_id, b.tenant_id, b.faturamento_id, b.numero_parcela, b.valor,
    b.valor_proprio,
    (b.valor - b.valor_proprio)::numeric(14,2) as valor_save,
    b.save_job_id
   from base b;

alter view public.vw_titulo_partes set (security_invoker = on);
grant select on public.vw_titulo_partes to authenticated;

comment on view public.vw_titulo_partes is
  'JOB PRIMEIRO, DEPOIS O SAVE: como cada titulo de uma nota se divide entre o faturamento proprio do job e o saldo em save. Fonte UNICA dessa regra (decisao 028).';

create or replace view public.vw_lancamento_origens as
 with comp as (
   select fi.faturamento_id,
      case when fi.origem_tipo = 'job'::faturamento_origem then fi.origem_id else null::uuid end as job_id,
      sum(fi.valor) as valor
     from public.faturamento_itens fi
    where fi.origem_tipo <> 'save'::faturamento_origem
    group by 1, 2
 ), tot as (
   select comp.faturamento_id, sum(comp.valor) as total from comp group by comp.faturamento_id
 )
 select l.id as lancamento_id, l.tenant_id, 'job'::text as tipo,
    c.job_id, null::uuid as save_job_id,
    (l.valor * (tp.valor_proprio / nullif(tp.valor, 0::numeric))
             * (c.valor / nullif(tot.total, 0::numeric)))::numeric(14,2) as valor
   from public.lancamentos_financeiros l
     join public.vw_titulo_partes tp on tp.titulo_id = l.titulo_receber_id
     join comp c on c.faturamento_id = tp.faturamento_id
     join tot on tot.faturamento_id = tp.faturamento_id
  where tp.valor_proprio > 0::numeric
union all
 select l.id, l.tenant_id, 'save'::text,
    null::uuid, tp.save_job_id,
    (l.valor * (tp.valor_save / nullif(tp.valor, 0::numeric)))::numeric(14,2)
   from public.lancamentos_financeiros l
     join public.vw_titulo_partes tp on tp.titulo_id = l.titulo_receber_id
  where tp.valor_save > 0::numeric;

alter view public.vw_lancamento_origens set (security_invoker = on);
grant select on public.vw_lancamento_origens to authenticated;

comment on view public.vw_lancamento_origens is
  'De onde vem o dinheiro de uma baixa: uma linha por job coberto pela nota e uma para o saldo em save. E o que a conciliacao mostra ao expandir (decisao 028).';

-- `vw_fluxo_caixa` passa a ler a regra da view extraida, em vez de ter a
-- copia dela num CTE proprio.
do $patch$
declare
  d text; ini int; fim int;
  v_marca text := 'titulo_partes AS (';
  v_fecho text := '), lancamento_job AS (';
begin
  d := pg_get_viewdef('public.vw_fluxo_caixa'::regclass, true);
  ini := position(v_marca in d);
  if ini = 0 then raise exception 'ANCORA titulo_partes NAO ENCONTRADA'; end if;
  fim := position(v_fecho in d);
  if fim = 0 or fim < ini then raise exception 'ANCORA lancamento_job NAO ENCONTRADA'; end if;
  if position('vw_titulo_partes' in d) > 0 then
    raise notice 'vw_fluxo_caixa ja aponta para a view extraida; nada a fazer.';
    return;
  end if;

  d := substring(d from 1 for ini - 1)
       || 'titulo_partes AS ( SELECT tp.titulo_id, tp.faturamento_id, tp.valor, tp.valor_proprio, tp.save_job_id FROM public.vw_titulo_partes tp '
       || substring(d from fim);

  execute 'create or replace view public.vw_fluxo_caixa as ' || d;
end $patch$;
