-- Atualização da tabela SulAmerica para a VERSÃO OFICIAL 2026 fornecida pela
-- operadora (planilha BeneficiosAtualizados.xlsx). Supera a migration
-- 20261125920001_beneficios_reajuste_sulamerica_2026_11.sql, que havia sido
-- montada a partir da fatura 11/2026 e ficou defasada: o reajuste da tabela
-- oficial é ~2,38% acima do valor dessa fatura em TODA faixa com amostra
-- (confirmado em 12 faixas diferentes, ratio 1,023797-1,023807).
--
-- Faixas CONFIRMADAS pela planilha oficial (titular, 60% California / 40%
-- colaborador aplicado em cima do valor cheio):
--   SulAmerica Direto:   24-28, 29-33, 34-38, 39-43, 49-53   (5 faixas)
--   SulAmerica Especial: 24-28, 29-33, 34-38, 39-43, 44-48,
--                        49-53, 54-58                         (7 faixas)
--
-- Faixas PROJETADAS pelo ratio 1,0238 (sem titular PJ nessas idades na
-- planilha oficial). A faixa 19-23 Direto projetada bateu exatamente com o
-- valor 500,10 registrado para 2 titulares de 22-23 anos na planilha —
-- validação adicional do ratio:
--   Direto   0-18, 19-23, 44-48, 54-58, 59+
--   Especial 0-18, 19-23, 59+
--
-- Bradesco Dental: Agência California já está em R$ 13,60 (só o Sandbox tem
-- registro antigo com 13,00). Nada a alterar em Dental nesta migration.
--
-- Escopo: apenas tenant Agência California (produção). Sandbox mantém a
-- tabela da fatura 11/2026, para ficar explicito o antes/depois do reajuste.
-- O fechamento aplicado em 11/2026 do Sandbox é desaplicado em seguida,
-- fora desta migration, via rpc desaplicar_fechamento_beneficios.
--
-- Meses 09/2026 e 10/2026 da Agência California já estão fechados; as
-- linhas congelaram valores em beneficio_fechamento_linha. Este UPDATE só
-- afeta cálculo de 11/2026 em diante.

do $$
declare
  v_tenant_id   uuid := 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'; -- Agência California
  v_direto_id   uuid;
  v_especial_id uuid;
  v_ratio       numeric := 1.0238;
begin
  select id into v_direto_id
    from public.beneficios
   where tenant_id = v_tenant_id and nome = 'SulAmerica Direto';

  select id into v_especial_id
    from public.beneficios
   where tenant_id = v_tenant_id and nome = 'SulAmerica Especial';

  if v_direto_id is null or v_especial_id is null then
    raise exception 'beneficios SulAmerica nao encontrados para tenant %', v_tenant_id;
  end if;

  -- SulAmerica Direto — projecao pelo ratio (sem titular nessas idades)
  update public.beneficio_faixas_preco
     set valor = round(valor * v_ratio, 2)
   where beneficio_id = v_direto_id
     and idade_min in (0, 19, 44, 54, 59);

  -- SulAmerica Direto — valores confirmados na planilha oficial
  update public.beneficio_faixas_preco set valor = 620.12  where beneficio_id = v_direto_id and idade_min = 24;
  update public.beneficio_faixas_preco set valor = 688.34  where beneficio_id = v_direto_id and idade_min = 29;
  update public.beneficio_faixas_preco set valor = 736.53  where beneficio_id = v_direto_id and idade_min = 34;
  update public.beneficio_faixas_preco set valor = 854.37  where beneficio_id = v_direto_id and idade_min = 39;
  update public.beneficio_faixas_preco set valor = 1196.98 where beneficio_id = v_direto_id and idade_min = 49;

  -- SulAmerica Especial — projecao pelo ratio (sem titular nessas idades)
  update public.beneficio_faixas_preco
     set valor = round(valor * v_ratio, 2)
   where beneficio_id = v_especial_id
     and idade_min in (0, 19, 59);

  -- SulAmerica Especial — valores confirmados na planilha oficial
  update public.beneficio_faixas_preco set valor = 747.29  where beneficio_id = v_especial_id and idade_min = 24;
  update public.beneficio_faixas_preco set valor = 829.50  where beneficio_id = v_especial_id and idade_min = 29;
  update public.beneficio_faixas_preco set valor = 887.56  where beneficio_id = v_especial_id and idade_min = 34;
  update public.beneficio_faixas_preco set valor = 1029.57 where beneficio_id = v_especial_id and idade_min = 39;
  update public.beneficio_faixas_preco set valor = 1230.75 where beneficio_id = v_especial_id and idade_min = 44;
  update public.beneficio_faixas_preco set valor = 1442.43 where beneficio_id = v_especial_id and idade_min = 49;
  update public.beneficio_faixas_preco set valor = 1717.24 where beneficio_id = v_especial_id and idade_min = 54;
end$$;
