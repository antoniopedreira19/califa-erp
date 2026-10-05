-- Migration: Benefícios — validação de data em fn_mudar_modo_custeio_beneficio
-- Fix do final review: evitar que data_mudanca <= data_inicio do vínculo atual
-- cause erro genérico de chk_vinculo_datas (data_fim < data_inicio).

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
  v_data_inicio_atual date;
  v_novo_id uuid;
begin
  select colaborador_id, beneficio_id, tenant_id, data_inicio
    into v_colab, v_benef, v_tenant, v_data_inicio_atual
    from public.colaborador_beneficio
   where id = p_vinculo_id and data_fim is null;

  if v_colab is null then
    raise exception 'Vinculo nao encontrado ou ja encerrado (id=%)', p_vinculo_id;
  end if;

  if p_data_mudanca <= v_data_inicio_atual then
    raise exception 'Data da mudanca (%) precisa ser posterior ao inicio do vinculo atual (%). Para corrigir um vinculo recem-criado, apague-o e crie outro.',
      p_data_mudanca, v_data_inicio_atual;
  end if;

  update public.colaborador_beneficio
     set data_fim = p_data_mudanca - 1,
         updated_at = now()
   where id = p_vinculo_id;

  insert into public.colaborador_beneficio
    (tenant_id, colaborador_id, beneficio_id, modo_custeio, data_inicio)
    values
    (v_tenant, v_colab, v_benef, p_novo_modo, p_data_mudanca)
    returning id into v_novo_id;

  return v_novo_id;
end;
$$;
