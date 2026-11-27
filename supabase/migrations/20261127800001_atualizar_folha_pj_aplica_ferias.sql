-- Migration: ressincronizar_salarios_pj passa a aplicar pro-rata de férias e
-- preservar o desconto_beneficios já aplicado.
--
-- Comportamento antigo (JS puro em app/(app)/rh/folhas/actions.ts):
--   alvo = salario_contratual
--   UPDATE salario_base = alvo WHERE status='rascunho'
-- → ignora férias; sobrescreve o desconto de benefícios.
--
-- Comportamento novo (RPC):
--   bruto_mes = salario_contratual × (30 - dias_ferias) / 30
--   alvo      = bruto_mes - desconto_beneficios  (preserva benefícios já aplicados)
--   UPDATE salario_base = alvo
-- → aplica férias automaticamente igual ao gerar_folha_da_competencia;
--   preserva benefícios aplicados.
--
-- 100% aditiva; SECURITY INVOKER (roda com RLS do caller — padrão).

begin;

create or replace function public.ressincronizar_salarios_pj(
  p_tenant_id uuid,
  p_ano int,
  p_mes int
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_atualizadas int := 0;
  v_inalteradas int := 0;
  v_puladas text[] := '{}';
  v_recalculadas_ferias int := 0;
  r record;
  v_salario_contratual numeric;
  v_dias_ferias int;
  v_bruto_mes numeric;
  v_alvo numeric;
begin
  for r in
    select f.id,
           f.colaborador_id,
           f.salario_base,
           f.desconto_beneficios,
           c.nome,
           c.tipo_contratacao,
           s.valor,
           s.valor_recibo
      from public.folhas_pagamento f
      join public.colaboradores c on c.id = f.colaborador_id
      left join public.colaboradores_salarios s
        on s.colaborador_id = f.colaborador_id
       and s.tenant_id = f.tenant_id
       and s.data_fim is null
     where f.tenant_id = p_tenant_id
       and f.competencia_ano = p_ano
       and f.competencia_mes = p_mes
       and f.tipo = 'salario'
       and f.origem = 'california'
       and f.status = 'rascunho'
  loop
    if r.valor is null then
      v_puladas := v_puladas || r.nome;
      continue;
    end if;

    -- Salário contratual (CLT-recibo paga só a parte "recibo")
    v_salario_contratual := case
      when r.tipo_contratacao = 'clt_recibo'
        then r.valor - coalesce(r.valor_recibo, r.valor / 2)
      else r.valor
    end;

    -- Férias: aplica pro-rata se há dias de férias no mês
    v_dias_ferias := public.fn_dias_ferias_na_competencia(r.colaborador_id, p_ano, p_mes);
    if v_dias_ferias > 0 then
      v_bruto_mes := round(v_salario_contratual * (30 - v_dias_ferias) / 30.0, 2);
      v_recalculadas_ferias := v_recalculadas_ferias + 1;
    else
      v_bruto_mes := v_salario_contratual;
    end if;

    -- Benefícios: preserva o desconto já aplicado (se houver)
    v_alvo := v_bruto_mes - r.desconto_beneficios;

    if v_alvo = r.salario_base then
      v_inalteradas := v_inalteradas + 1;
    else
      update public.folhas_pagamento
         set salario_base = v_alvo
       where id = r.id;
      v_atualizadas := v_atualizadas + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'atualizadas', v_atualizadas,
    'inalteradas', v_inalteradas,
    'puladas_sem_vigente', to_jsonb(v_puladas),
    'recalculadas_ferias', v_recalculadas_ferias
  );
end;
$$;

grant execute on function public.ressincronizar_salarios_pj(uuid, int, int) to authenticated;

commit;
