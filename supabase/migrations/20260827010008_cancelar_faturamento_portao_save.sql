-- =====================================================================
-- SAVE — nao cancelar nota cujo saldo em save ja foi gasto por job
-- encerrado
--
-- `cancelar_faturamento` ja devolvia o saldo sozinho: tudo que le "ja
-- faturado" filtra `f.status = 'emitido'`, entao cancelar a nota faz o
-- save voltar a existir sem nenhuma linha de codigo a mais.
--
-- O que faltava e o caso em que isso NAO pode acontecer. Se um job
-- consumiu aquele save e ja foi ENCERRADO, cancelar a nota tiraria dele
-- um dinheiro que ja compos a margem de um job que a decisao 008 par.4
-- declara congelado. O portao novo vai ao lado do "Existem N titulos ja
-- baixados", que existe pela mesma razao: nao desfazer o que ja virou
-- historia.
--
-- Job consumidor ABERTO nao trava: ali o cancelamento devolve o saldo e o
-- consumo dele passa a nao caber, o que a trava de saldo do trigger
-- `save_consumo_valida` resolve na proxima escrita.
--
-- Por patch, e com as ancoras conferidas, pelo mesmo motivo da
-- 20260827010007.
-- =====================================================================

do $patch$
declare
  d text;
  v_anchor text := '  update public.titulos_receber
     set status = ''cancelado'',';
  v_novo text;
begin
  d := pg_get_functiondef('public.cancelar_faturamento(uuid, text, uuid)'::regprocedure);

  if position(v_anchor in d) = 0 then
    raise exception 'ANCORA DO CANCELAMENTO NAO ENCONTRADA';
  end if;
  if position('save que já foi consumido' in d) > 0 then
    raise notice 'Portao do save ja aplicado; nada a fazer.';
    return;
  end if;

  v_novo := $novo$  if exists (
    select 1
      from public.faturamento_itens fi
      join public.saves_consumos sc on sc.job_origem_id = fi.origem_id
      join public.jobs_itens_orcado oc on oc.id = sc.job_item_orcado_id
      join public.jobs jc on jc.id = oc.job_id
     where fi.faturamento_id = p_faturamento_id
       and fi.origem_tipo = 'save'
       and jc.status = 'encerrado'
  ) then
    raise exception 'Esta nota carrega saldo em save que já foi consumido por job encerrado. Cancelá-la reescreveria a margem de um job que já está congelado.';
  end if;

$novo$;

  d := replace(d, v_anchor, v_novo || v_anchor);
  execute d;
end $patch$;
