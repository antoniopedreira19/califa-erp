-- Migration: Benefícios — função atômica para mudar modo de custeio (S4)
-- Plano: docs/modulos/rh/52-beneficios-plano-de-execucao.md
--
-- "Mudar modo" não é UPDATE: fecha o vínculo atual (data_fim = p_data - 1)
-- e cria um novo vínculo começando em p_data. Transação única para
-- garantir atomicidade e preservar o histórico.
-- SECURITY INVOKER - RLS do chamador vale.

create or replace function public.fn_mudar_modo_custeio_beneficio(
  p_vinculo_id uuid,
  p_novo_modo public.beneficio_modo_custeio,
  p_data_mudanca date default current_date
)
returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_colab uuid;
  v_benef uuid;
  v_tenant uuid;
  v_novo_id uuid;
begin
  select colaborador_id, beneficio_id, tenant_id
    into v_colab, v_benef, v_tenant
    from public.colaborador_beneficio
   where id = p_vinculo_id and data_fim is null;

  if v_colab is null then
    raise exception 'Vínculo não encontrado ou já encerrado (id=%)', p_vinculo_id;
  end if;

  -- Fecha o vinculo atual no dia anterior a mudanca
  update public.colaborador_beneficio
     set data_fim = p_data_mudanca - 1,
         updated_at = now()
   where id = p_vinculo_id;

  -- Abre o vinculo novo com o modo novo
  insert into public.colaborador_beneficio
    (tenant_id, colaborador_id, beneficio_id, modo_custeio, data_inicio)
    values
    (v_tenant, v_colab, v_benef, p_novo_modo, p_data_mudanca)
    returning id into v_novo_id;

  return v_novo_id;
end;
$$;

grant execute on function public.fn_mudar_modo_custeio_beneficio(uuid, public.beneficio_modo_custeio, date)
  to authenticated;

comment on function public.fn_mudar_modo_custeio_beneficio(uuid, public.beneficio_modo_custeio, date) is
  'Encerra o vinculo atual e cria um novo com o novo modo de custeio na mesma transação. Preserva histórico. Trigger de validação de upgrade continua valendo.';
