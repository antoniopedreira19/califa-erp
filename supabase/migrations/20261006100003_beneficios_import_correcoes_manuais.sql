-- Migration: correções manuais do import de benefícios (Fase 1.6a).
--
-- Casos cujo nome no CSV não casou com o prefix match normalizado:
--
-- SulAmerica (1 caso):
-- - "Ana Carolina Costa Wdowinki" (CSV) → "Ana Carolina Costa Wdowinski"
--   (banco): typo "Wdowinki" vs "Wdowinski" no CSV original.
--
-- Bradesco Dental (6 casos) — CSV omitiu nomes do meio ou prefixos:
-- - "Ana Cristina Oliveira Pringler" → "Ana Cristina DE Oliveira Pringler"
-- - "Carina Marçal" → "Carina SOUSA Marçal"
-- - "Giovana Marques" → "Giovana RAMOS PACHECO Marques"
-- - "Luciana Linhares" → "Luciana CARVALHO DE ARRUDA Linhares"
-- - "Marcos Correia Junior" → "Marcos Correia DOS SANTOS Junior"
-- - "Rodolfo Medeiros" → "Rodolfo DA SILVA Medeiros Junior"
--
-- Casos SulAmerica que NÃO foram importados por serem ex-colaboradores em rescisão
-- (observação "Descontado em rescisão" no CSV original): Amanda Rabello,
-- Larissa Sampaio, Luan Azevedo, Rafael Perrucho, Uriel Oliveira. A Kika avalia
-- depois se cadastra como colaborador inativo ou mantém só na folha de rescisão.
--
-- Caso Dental que também não foi importado por mesmo motivo: Luan Azevedo.
--
-- Idempotente: ON CONFLICT faz nada quando o vínculo já existe (unique parcial).

-- 1) Ana Carolina Costa Wdowinski (typo do CSV)
insert into public.colaborador_beneficio
  (tenant_id, colaborador_id, beneficio_id, modo_custeio, data_inicio)
select
  (select id from public.tenants where nome='Agência California'),
  c.id,
  (select id from public.beneficios where nome='SulAmerica Especial 100'),
  'rateado'::public.beneficio_modo_custeio,
  coalesce(c.data_admissao, current_date)
from public.colaboradores c
where c.nome = 'Ana Carolina Costa Wdowinski'
  and c.tipo_contratacao != 'socio'
  and c.status = 'ativo'
on conflict (colaborador_id, beneficio_id) where data_fim is null do nothing;

-- 2) 6 vínculos Bradesco Dental com nome mais longo no banco
do $$
declare
  v_tenant uuid := (select id from public.tenants where nome='Agência California');
  v_dental uuid := (select id from public.beneficios where nome='Bradesco Dental');
  v_rec record;
  v_colab_id uuid;
  v_data date;
begin
  for v_rec in
    select *
    from (values
      ('Ana Cristina de Oliveira Pringler', null::text),
      ('Carina Sousa Marçal',
        'Dependente nova inclusão não faturada ainda (do CSV)' || E'\n' ||
        'Dependente(s) na fatura real (precisa cadastrar com CPF + data de nascimento): Camila Oliveira (Namorada)'),
      ('Giovana Ramos Pacheco Marques', null),
      ('Luciana Carvalho de Arruda Linhares', null),
      ('Marcos Correia dos Santos Junior',
        'Dependente(s) na fatura real (precisa cadastrar com CPF + data de nascimento): Larissa (Cônjuge), Dagmar e Marcos Correia (Pai e Mãe)'),
      ('Rodolfo da Silva Medeiros Junior',
        'Valor retroativo 07, 08 e 09/2026 (do CSV)' || E'\n' ||
        'Dependente(s) na fatura real (precisa cadastrar com CPF + data de nascimento): Ana Cristina Medeiros (Mãe)')
    ) as t(nome, obs)
  loop
    select id, data_admissao into v_colab_id, v_data
      from public.colaboradores
     where nome = v_rec.nome
       and tenant_id = v_tenant
       and status = 'ativo'
       and tipo_contratacao != 'socio';
    if v_colab_id is null then
      raise notice '[correcoes] colaborador nao encontrado: %', v_rec.nome;
      continue;
    end if;
    begin
      insert into public.colaborador_beneficio
        (tenant_id, colaborador_id, beneficio_id, modo_custeio, data_inicio, observacao)
        values
        (v_tenant, v_colab_id, v_dental, 'rateado'::public.beneficio_modo_custeio,
         coalesce(v_data, current_date), v_rec.obs);
    exception when unique_violation then
      raise notice '[correcoes] ja existe: %', v_rec.nome;
    end;
    v_colab_id := null;
    v_data := null;
  end loop;
end $$;
