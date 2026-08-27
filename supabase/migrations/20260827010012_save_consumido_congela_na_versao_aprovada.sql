-- Save: o `save_consumido` da VERSÃO APROVADA não se mexe mais.
--
-- Encontrado no teste ponta a ponta de 27/08/2026.
--
-- O consumo de save nasce apontando para a linha da VERSÃO
-- (`saves_consumos.item_versao_id`) enquanto o orçamento é rascunho. Na
-- abertura ele passa a apontar para a CÓPIA do job
-- (`job_item_orcado_id`) — é de lá que a `vw_fluxo_caixa` migra o
-- dinheiro para quem gastou, e é lá que a errata do job mexe. O CHECK
-- `chk_save_consumo_uma_ponta` obriga exatamente UMA das duas pontas, e
-- por isso a migração apaga `item_versao_id`.
--
-- Sem esta mudança, esse apagamento fazia o trigger recalcular o
-- `save_consumido` da linha da versão como ZERO — e a versão aprovada,
-- que é o registro do que o cliente aprovou, passava a mostrar
-- faturamento previsto cheio, como se nada consumisse save.
--
-- A regra nova é a mesma de `bv_liquido_planejado` (decisão 022): o que
-- a aprovação congela, a vida do job não reescreve. Enquanto a versão é
-- rascunho o recálculo continua igual — é lá que o número se forma.

create or replace function public.save_consumido_recalcula()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_item_versao uuid;
  v_item_job uuid;
  v_versao_aprovada boolean;
begin
  v_item_versao := coalesce(new.item_versao_id, old.item_versao_id);
  v_item_job    := coalesce(new.job_item_orcado_id, old.job_item_orcado_id);

  if v_item_versao is not null then
    -- Versão aprovada é registro congelado: o consumo dela não se
    -- recalcula quando o consumo migra para o job.
    select v.status = 'aprovada'
      into v_versao_aprovada
      from public.versoes_orcamento_itens i
      join public.versoes_orcamento v on v.id = i.versao_orcamento_id
     where i.id = v_item_versao;

    if not coalesce(v_versao_aprovada, false) then
      update public.versoes_orcamento_itens i
         set save_consumido = coalesce((
               select sum(c.valor) from public.saves_consumos c
                where c.item_versao_id = v_item_versao
                  and c.substituido_em is null
             ), 0)
       where i.id = v_item_versao;
    end if;
  end if;

  if v_item_job is not null then
    update public.jobs_itens_orcado o
       set save_consumido = coalesce((
             select sum(c.valor) from public.saves_consumos c
              where c.job_item_orcado_id = v_item_job
            ), 0)
     where o.id = v_item_job;
  end if;

  return null;
end;
$function$;

comment on function public.save_consumido_recalcula is
  'Mantem save_consumido da linha (versao em rascunho e copia do job) a partir de saves_consumos. Versao APROVADA fica congelada: ver docs/decisions/028-save-entre-jobs.md.';
