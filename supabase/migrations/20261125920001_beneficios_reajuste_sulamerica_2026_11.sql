-- Reajuste anual SulAmerica aplicado na fatura de 11/2026.
-- Fator médio 1,0692441 (~6,924%) validado faixa a faixa cruzando a idade
-- do titular PJ com o prêmio sem IOF da fatura.
--
-- Faixas CONFIRMADAS pela fatura 11/2026 (prêmio sem IOF do titular rateado,
-- sem dependentes) — cada faixa teve múltiplos pontos batendo com o mesmo
-- valor, exceto 49-53 Direto que teve apenas 1 ponto:
--   SulAmerica Direto: 24-28, 29-33, 34-38, 49-53
--   SulAmerica Especial: 24-28, 29-33, 34-38, 39-43, 44-48
--
-- Faixas PROJETADAS (sem titular PJ nessas idades na fatura), ratio 1,0692441:
--   Direto 0-18, 19-23, 39-43, 44-48, 54-58, 59+
--   Especial 0-18, 19-23, 49-53, 54-58, 59+
-- Reconferir quando aparecer titular dessas idades na próxima fatura.
--
-- Meses 09/2026 e 10/2026 já estão fechados; as linhas congelaram valores em
-- beneficio_fechamento_linha. Este UPDATE só afeta cálculo de 11/2026 em
-- diante.

do $$
declare
  v_tenant_id uuid := 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
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
