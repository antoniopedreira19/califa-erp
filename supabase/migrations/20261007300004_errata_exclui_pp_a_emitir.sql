-- A errata que cancela a linha apaga a PP a emitir dela (decisão 153).
--
-- Resposta do Tiago em 07/10/2026: "a PP a emitir será apagada no momento
-- da errata. Caso a PP já tenha sido gerada, a errata não poderá ser feita
-- na linha." A segunda metade já vale: `barrarCancelamento`
-- (actions-errata.ts) recusa cancelar linha com qualquer PP no histórico,
-- inclusive a gerada. Faltava a primeira: a linha cancelada não abre mais o
-- painel do item, e a PP a emitir ficaria parada, sem como gerar nem
-- excluir.
--
-- Gatilho, e não mudança em `registrar_errata_do_job`: a errata é de outra
-- entrega (decisão 151) e segue intacta. O gatilho dispara só na passagem
-- de "não cancelada" para "cancelada", na mesma transação da errata, e faz
-- a exclusão lógica de sempre (`excluida_em`, `excluida_por`) — a mesma do
-- botão "Excluir" do painel. A PP a emitir já gerada (`pp_id`) não muda.

create or replace function public._errata_exclui_pp_a_emitir()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.pedidos_compra_a_emitir a
     set excluida_em = now(),
         excluida_por = coalesce(new.cancelada_por, auth.uid()),
         updated_at = now()
    from public.jobs_itens_realizado r
   where r.job_item_orcado_id = new.id
     and a.item_realizado_id = r.id
     and a.pp_id is null
     and a.excluida_em is null;
  return new;
end;
$$;
revoke all on function public._errata_exclui_pp_a_emitir() from public, anon, authenticated;

comment on function public._errata_exclui_pp_a_emitir() is
  'Decisão 153: a errata que cancela a linha (jobs_itens_orcado.cancelada_em) exclui as PPs a emitir dela, como o botão Excluir do painel.';

drop trigger if exists trg_jio_cancelada_exclui_pp_a_emitir on public.jobs_itens_orcado;
create trigger trg_jio_cancelada_exclui_pp_a_emitir
  after update of cancelada_em on public.jobs_itens_orcado
  for each row
  when (old.cancelada_em is null and new.cancelada_em is not null)
  execute function public._errata_exclui_pp_a_emitir();
