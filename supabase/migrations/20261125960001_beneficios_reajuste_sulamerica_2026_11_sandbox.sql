-- =============================================================================
-- Replica o reajuste SulAmerica 11/2026 no tenant California Sandbox.
--
-- A migration 20261125920001 só aplicou o reajuste no tenant Agência California
-- (produção). O Sandbox ficou com as faixas antigas, o que fazia o cálculo de
-- 11/2026 em diante divergir da fatura real durante testes em ambiente de QA
-- (ex.: Aline 37 anos no Sandbox retornava faixa Especial 34-38 = R$ 810,79
-- em vez de R$ 866,93 da fatura).
--
-- Mesmo fator (1,0692441) e mesmos valores exatos da fatura 11/2026 usados na
-- migration de produção. Ver 20261125920001 para o racional das faixas
-- confirmadas vs. projetadas.
-- =============================================================================

do $$
declare
  v_tenant_id uuid := 'db9278e5-1293-407f-bd33-d71b7061a849';
  v_direto_id uuid;
  v_especial_id uuid;
  v_ratio numeric := 1.0692441;
begin
  select id into v_direto_id   from public.beneficios where tenant_id = v_tenant_id and nome = 'SulAmerica Direto';
  select id into v_especial_id from public.beneficios where tenant_id = v_tenant_id and nome = 'SulAmerica Especial';

  if v_direto_id is null or v_especial_id is null then
    raise exception 'beneficios SulAmerica não encontrados para tenant %', v_tenant_id;
  end if;

  -- Projeção pelo ratio (faixas sem titular PJ confirmado na fatura)
  update public.beneficio_faixas_preco
     set valor = round(valor * v_ratio, 2)
   where beneficio_id = v_direto_id
     and idade_min in (0, 19, 39, 44, 54, 59);

  update public.beneficio_faixas_preco
     set valor = round(valor * v_ratio, 2)
   where beneficio_id = v_especial_id
     and idade_min in (0, 19, 49, 54, 59);

  -- Faixas confirmadas (sobrescrevem com valor exato da fatura)
  update public.beneficio_faixas_preco set valor = 605.70  where beneficio_id = v_direto_id   and idade_min = 24;
  update public.beneficio_faixas_preco set valor = 672.34  where beneficio_id = v_direto_id   and idade_min = 29;
  update public.beneficio_faixas_preco set valor = 719.41  where beneficio_id = v_direto_id   and idade_min = 34;
  update public.beneficio_faixas_preco set valor = 1169.15 where beneficio_id = v_direto_id   and idade_min = 49;

  update public.beneficio_faixas_preco set valor = 729.92  where beneficio_id = v_especial_id and idade_min = 24;
  update public.beneficio_faixas_preco set valor = 810.22  where beneficio_id = v_especial_id and idade_min = 29;
  update public.beneficio_faixas_preco set valor = 866.93  where beneficio_id = v_especial_id and idade_min = 34;
  update public.beneficio_faixas_preco set valor = 1005.64 where beneficio_id = v_especial_id and idade_min = 39;
  update public.beneficio_faixas_preco set valor = 1202.14 where beneficio_id = v_especial_id and idade_min = 44;
end$$;
