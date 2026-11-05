-- Decisão 238 (05/11/2026): a errata não trava mais a PP, e a PP não trava
-- mais a errata. O limite passa a ser a regra do Comitê de Aprovações.
--
-- Até aqui a errata recusava QUALQUER alteração em linha com PP no
-- financeiro (decisão 040 §1), e por isso a decisão 237 travava o envio da
-- PP da linha que estivesse na errata pronta. O Tiago tirou as duas travas:
-- a errata altera a linha com PP, mas não pode deixar o orçado abaixo do que
-- já está em PPs quando a regra "Realizado acima do orçado" do Comitê está
-- ligada. Abaixo das PPs, só o financeiro altera, na tela do job no Financeiro.
--
-- Esta função devolve o que cada linha já tem em PPs — a mesma conta do
-- gatilho `pp_confere_orcado_na_geracao`: PPs fora de cancelada, menos a
-- devolução aprovada da prestação de contas da verba. Definer pelo mesmo
-- motivo da `travas_do_tipo_nas_linhas_do_job`: a RLS de `pedidos_compra`
-- filtra por empresa, e a trava não pode depender do que o usuário enxerga.
--
-- Aditiva: função nova, nada muda em tabela.

create or replace function public.realizado_em_pps_das_linhas_do_job(p_ids uuid[])
 returns table(job_item_orcado_id uuid, em_pps numeric)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select o.id,
         round(
           coalesce((
             select sum(pc.valor)
               from public.jobs_itens_realizado r
               join public.pedidos_compra pc on pc.item_realizado_id = r.id
              where r.job_item_orcado_id = o.id
                and r.tenant_id = o.tenant_id
                and pc.tenant_id = o.tenant_id
                and pc.status <> 'cancelada'
           ), 0)
           - coalesce((
             select sum(pv.valor_devolvido)
               from public.jobs_itens_realizado r
               join public.pedidos_compra pc on pc.item_realizado_id = r.id
               join public.pp_verba_prestacoes pv on pv.pedido_compra_id = pc.id
              where r.job_item_orcado_id = o.id
                and r.tenant_id = o.tenant_id
                and pc.tenant_id = o.tenant_id
                and pc.status <> 'cancelada'
                and pv.status = 'aprovada'
           ), 0),
           2)
    from public.jobs_itens_orcado o
   where o.id = any(p_ids)
     and public.is_tenant_member(o.tenant_id);
$function$;

revoke all on function public.realizado_em_pps_das_linhas_do_job(uuid[]) from public, anon;
grant execute on function public.realizado_em_pps_das_linhas_do_job(uuid[]) to authenticated;

comment on function public.realizado_em_pps_das_linhas_do_job(uuid[]) is
  'O que cada linha do job já tem em PPs (fora de cancelada, menos a devolução aprovada da verba), pela mesma conta de pp_confere_orcado_na_geracao. A errata não deixa o orçado abaixo disso com a regra de PP do Comitê ligada (decisão 238, 05/11/2026).';
