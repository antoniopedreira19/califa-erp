-- =====================================================================
-- Decisão 128: conserto da `editar_planejado_do_job_devolvido`
-- (20260929950002).
--
-- A função roda como quem chama (`security invoker`) e consultava o
-- serviço Interno por `orcamento_de_investimento_interno`, que não é
-- executável por `authenticated`. Na primeira edição pela tela o banco
-- respondeu "permission denied for function orcamento_de_investimento_interno"
-- e nada foi gravado. Agora o Interno é lido direto da tabela, que a RLS de
-- quem edita já deixa ler. O resto da função não muda.
-- =====================================================================

create or replace function public.editar_planejado_do_job_devolvido(
  p_item_id uuid,
  p_campo text,
  p_valor numeric
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item   record;
  v_job    record;
  v_copia  record;
begin
  if p_campo not in (
    'valor_unitario_planejado', 'quantidade_planejada', 'dias_meses_planejado'
  ) then
    raise exception 'Com o job devolvido, só o planejado se corrige na versão aprovada.'
      using errcode = '42501';
  end if;
  if p_valor is null or p_valor < 0 then
    raise exception 'Valor inválido.' using errcode = 'check_violation';
  end if;

  select i.id, i.em_save, i.versao_orcamento_id, v.status as versao_status, v.orcamento_id
    into v_item
    from public.versoes_orcamento_itens i
    join public.versoes_orcamento v on v.id = i.versao_orcamento_id
   where i.id = p_item_id;

  if v_item.id is null then
    raise exception 'Item não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_item.versao_status <> 'aprovada' then
    raise exception 'Esta versão não está aprovada.' using errcode = 'check_violation';
  end if;

  select id, status
    into v_job
    from public.jobs
   where orcamento_id = v_item.orcamento_id
     and versao_orcamento_aprovada_id = v_item.versao_orcamento_id
     and status <> 'cancelado';

  if v_job.id is null or v_job.status <> 'rejeitado_financeiro' then
    raise exception 'O planejado da versão aprovada só se corrige enquanto o job está devolvido pelo financeiro.'
      using errcode = '42501';
  end if;
  -- Lido direto, e não por `orcamento_de_investimento_interno`: aquela
  -- função não é executável por `authenticated`, e esta roda como quem
  -- chama.
  if exists (
    select 1
      from public.orcamentos o
      join public.categorias_dominio s on s.id = o.servico_id
     where o.id = v_item.orcamento_id
       and s.investimento_interno
  ) then
    raise exception 'No serviço Interno o planejado é igual ao orçado.'
      using errcode = 'check_violation';
  end if;
  if v_item.em_save then
    raise exception 'Linha em save: o planejado dela é zero.'
      using errcode = 'check_violation';
  end if;

  select id, em_save
    into v_copia
    from public.jobs_itens_orcado
   where job_id = v_job.id
     and item_versao_id = p_item_id;

  if v_copia.id is null then
    raise exception 'Esta linha não está na planilha do job.' using errcode = 'no_data_found';
  end if;
  if v_copia.em_save then
    raise exception 'Esta linha está em save na planilha do job: o planejado dela é zero.'
      using errcode = 'check_violation';
  end if;

  update public.versoes_orcamento_itens
     set valor_unitario_planejado = case when p_campo = 'valor_unitario_planejado' then p_valor else valor_unitario_planejado end,
         quantidade_planejada     = case when p_campo = 'quantidade_planejada' then p_valor else quantidade_planejada end,
         dias_meses_planejado     = case when p_campo = 'dias_meses_planejado' then p_valor else dias_meses_planejado end
   where id = p_item_id;

  update public.jobs_itens_orcado
     set valor_unitario_planejado = case when p_campo = 'valor_unitario_planejado' then p_valor else valor_unitario_planejado end,
         quantidade_planejada     = case when p_campo = 'quantidade_planejada' then p_valor else quantidade_planejada end,
         dias_meses_planejado     = case when p_campo = 'dias_meses_planejado' then p_valor else dias_meses_planejado end
   where id = v_copia.id;
end;
$$;

comment on function public.editar_planejado_do_job_devolvido(uuid, text, numeric) is
  'Decisão 128: com o job devolvido, grava o planejado na versão aprovada e na cópia do job, numa transação só.';

revoke all on function public.editar_planejado_do_job_devolvido(uuid, text, numeric) from public, anon;
grant execute on function public.editar_planejado_do_job_devolvido(uuid, text, numeric) to authenticated;
