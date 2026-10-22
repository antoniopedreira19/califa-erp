-- Decisão 204, revisão aprovada em 21/10/2026: a exceção do acumulado
-- acima do orçado exige administrador na GERAÇÃO e EDIÇÃO, não no envio.
-- Substitui somente o gatilho da entrega anterior; não altera PPs existentes.
-- Rascunhos em pedidos_compra_a_emitir continuam livres. A confirmação de planejado
-- no envio permanece na aplicação. Valores brutos, antes do BV; somente
-- devoluções de verba aprovadas abatem o acumulado.
begin;
drop trigger if exists trg_pp_confere_orcado_no_envio on public.pedidos_compra;
drop function if exists public.pp_confere_orcado_no_envio();

create or replace function public.pp_confere_orcado_na_geracao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orcado numeric;
  v_realizado numeric;
  v_devolvido numeric;
begin
  if new.status = 'cancelada' then return new; end if;
  -- Enviar a PP já gerada não reabre a autorização da geração. A edição
  -- dos valores/âncora, inclusive em chamadas diretas, confere novamente.
  if tg_op = 'UPDATE' and new.status <> 'gerada'
     and old.status <> 'cancelada'
     and new.valor is not distinct from old.valor
     and new.item_realizado_id is not distinct from old.item_realizado_id
     and new.tenant_id is not distinct from old.tenant_id then return new; end if;

  -- Todos os autores (inclusive admin) serializam a escrita na mesma
  -- âncora, antes da soma. Duas PPs concorrentes não podem usar o mesmo
  -- saldo. O recálculo existente também atualiza esta linha.
  perform 1 from public.jobs_itens_realizado
   where id = new.item_realizado_id and tenant_id = new.tenant_id for update;
  select o.total_orcado into v_orcado
    from public.jobs_itens_realizado r
    join public.jobs_itens_orcado o
      on o.id = r.job_item_orcado_id
      or (r.job_item_orcado_id is null and o.item_versao_id = r.item_id and o.job_id = r.job_id)
   where r.id = new.item_realizado_id and r.tenant_id = new.tenant_id
     and o.tenant_id = new.tenant_id;
  if v_orcado is null then
    raise exception 'Não foi possível conferir o orçado do item da PP.';
  end if;
  if public.is_tenant_admin(new.tenant_id) then return new; end if;

  select coalesce(sum(p.valor), 0) + new.valor into v_realizado
    from public.pedidos_compra p
   where p.item_realizado_id = new.item_realizado_id and p.tenant_id = new.tenant_id
     and p.id <> new.id and p.status <> 'cancelada';
  select coalesce(sum(pv.valor_devolvido), 0) into v_devolvido
    from public.pp_verba_prestacoes pv
    join public.pedidos_compra p on p.id = pv.pedido_compra_id
   where p.item_realizado_id = new.item_realizado_id and p.tenant_id = new.tenant_id
     and (p.status <> 'cancelada' or p.id = new.id) and pv.status = 'aprovada';
  if round(v_realizado - v_devolvido, 2) - v_orcado > 0.005 then
    raise exception 'Só o administrador pode gerar ou editar esta PP: o realizado acumulado do item ultrapassa o orçado. Salve a PP a emitir e peça a revisão ao administrador.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.pp_confere_orcado_na_geracao() from public, anon, authenticated;
create or replace trigger trg_pp_confere_orcado_na_geracao
before insert or update of valor, item_realizado_id, tenant_id on public.pedidos_compra
for each row execute function public.pp_confere_orcado_na_geracao();
-- Cancelada -> ativa também é uma nova geração de custo. Separado para
-- não conferir novamente no envio normal (que só muda status).
create or replace trigger trg_pp_confere_orcado_na_reativacao
before update of status on public.pedidos_compra
for each row when (old.status = 'cancelada' and new.status <> 'cancelada')
execute function public.pp_confere_orcado_na_geracao();
commit;
