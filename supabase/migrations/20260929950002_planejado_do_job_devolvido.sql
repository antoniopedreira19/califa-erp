-- =====================================================================
-- Decisão 128 (Tiago, 29/09/2026): com o job devolvido pelo financeiro, o
-- planejado da versão aprovada se corrige na tela do orçamento, sem
-- cancelar a aprovação — a aprovação é o acordo com o cliente sobre o
-- ORÇADO, e o planejado é interno. Só os valores das linhas que já
-- existem; incluir ou remover linha passa pelo "Cancelar aprovação".
--
-- O planejado mora em dois lugares: na versão aprovada, que é o que a
-- tela do orçamento mostra, e na cópia do job (`jobs_itens_orcado`), que é
-- o que o financeiro confere e o que o reenvio grava (decisão 099, §11).
-- `editar_planejado_do_job_devolvido` grava os dois numa transação só,
-- para as duas pontas nunca contarem histórias diferentes.
--
-- Recusa, com a mensagem que a tela mostra:
-- - campo fora das três colunas do planejado;
-- - versão que não é a aprovada do job devolvido;
-- - orçamento de serviço Interno (o planejado é o orçado, decisão 105);
-- - linha em save, na versão ou na cópia (o planejado dela é zero).
--
-- `security invoker`: vale a RLS de quem edita, a mesma da planilha.
-- Aditiva: função nova.
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
  if public.orcamento_de_investimento_interno(v_item.orcamento_id) then
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
