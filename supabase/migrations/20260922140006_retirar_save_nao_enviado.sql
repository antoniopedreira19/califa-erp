-- =============================================================================
-- Retirar save ou consumo que nunca foi enviado para aprovação (decisão 099)
-- =============================================================================
--
-- Linha de job aberto com save ou consumo e SEM pedido é o legado: marcada
-- antes de existir a aprovação de save (ou no código antigo, entre a
-- 20260922140001 e o deploy). O financeiro já conta essa linha nos números
-- do job. Com as travas de escrita direta ligadas (20260922140003) ela só
-- poderia sair enviando para aprovação e cancelando — dois passos para uma
-- coisa só. Esta RPC retira direto, como errata de save: a linha volta, a
-- errata entra, o job volta para a revisão da abertura e os espelhos mudam
-- na hora (p_totais e p_errata obrigatórios, como em save_retirar).
-- =============================================================================

create or replace function public.save_retirar_nao_enviado(
  p_job_item_orcado_id uuid,
  p_totais jsonb,
  p_errata jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  o        public.jobs_itens_orcado%rowtype;
  v_status public.job_status;
begin
  select * into o from public.jobs_itens_orcado where id = p_job_item_orcado_id for update;
  if not found then
    raise exception 'Linha não encontrada.';
  end if;
  if not public.save_job_visivel(o.job_id) then
    raise exception 'Sem acesso a este job.';
  end if;
  select j.status into v_status from public.jobs j where j.id = o.job_id;
  if v_status not in ('aberto', 'em_producao') then
    raise exception 'Job encerrado não muda o save: os números dele estão congelados.';
  end if;
  if exists (
       select 1 from public.saves_aprovacoes a
        where a.job_item_orcado_id = o.id
          and a.situacao in ('aguardando', 'aprovado', 'recusado')) then
    raise exception 'Esta linha tem pedido de save: use o pop-up de save para cancelar ou retirar.';
  end if;
  if p_totais is null or p_errata is null then
    raise exception 'Retirar save é errata de save e precisa dos números do job.';
  end if;

  perform set_config('app.save_fluxo', 'on', true);
  if o.em_save then
    update public.jobs_itens_orcado set em_save = false where id = o.id;
  elsif exists (select 1 from public.saves_consumos c where c.job_item_orcado_id = o.id) then
    delete from public.saves_consumos where job_item_orcado_id = o.id;
  else
    raise exception 'Esta linha não tem save nem consumo de save.';
  end if;
  perform public.save_registrar_errata(o.id, p_errata);
  perform public.save_gravar_totais(o.job_id, p_totais);
  perform set_config('app.save_fluxo', '', true);
end;
$$;

revoke all on function public.save_retirar_nao_enviado(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_retirar_nao_enviado(uuid, jsonb, jsonb) to authenticated;
