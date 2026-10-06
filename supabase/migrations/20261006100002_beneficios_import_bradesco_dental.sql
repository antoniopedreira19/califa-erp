-- Migration: Benefícios — import de titulares Bradesco Dental (Fase 1.6a)
--
-- Mesma lógica do import SulAmerica. Todos modo_custeio='rateado' (que
-- com percentual_empresa_titular=0 do catálogo dental = 100% colaborador).
-- Dependentes anotados em observacao para cadastro posterior.
-- Sócios filtrados por tipo_contratacao != 'socio'.
-- Idempotente via ON CONFLICT (unique parcial em vinculo ativo).

do $$
declare
  v_tenant uuid;
  v_dental uuid;
  v_total_inseridos int := 0;
  v_total_nao_casou int := 0;
  v_total_com_dep int := 0;
  v_rec record;
  v_colab_id uuid;
  v_data_admissao date;
  v_obs_final text;
begin
  select id into v_tenant from public.tenants where nome = 'Agência California';
  select id into v_dental from public.beneficios where tenant_id = v_tenant and nome = 'Bradesco Dental';

  for v_rec in
    select *
    from (values
      ('Aline Heluany Khoury',               null::text, null::text),
      ('Ana Cristina Oliveira Pringler',     null, null),
      ('Barbara Sophia Tank',                null, null),
      ('Carina Marçal',                      'Camila Oliveira (Namorada)', 'Dependente nova inclusão não faturada ainda (do CSV)'),
      ('Caroline Cerqueira Inácio',          'Manuela', null),
      ('Davi Branco Fontinelli',             null, null),
      ('Diego Braga da Costa',               null, null),
      ('Fabiane Andrade Oiticica',           'João Carvalho Abreu (Cônjuge)', null),
      ('Fabiane Soares',                     null, null),
      ('Filippe Sena Buccos',                null, null),
      ('Filipe Silva',                       'Marinalva (Mãe), Gabriela (Irmã), Andrea e Maria Isabela', null),
      ('Gabriela Moreira Barroso',           null, null),
      ('Gabriela Fedato',                    'Marcelo e Ramona', null),
      ('Gabriela Cavalleiro Singh',          null, null),
      ('Giovana Marques',                    null, null),
      ('Harrison Silva Lago',                'Naira Mara (Mãe)', null),
      ('Humberto Perazzo',                   'Alessandra (Cônjuge), Theo e João Lucas (Filhos)', null),
      ('Jose Mario Dias',                    'José Maria e Elisabeth (Pai e Mãe)', null),
      ('Leonardo Augusto',                   'Caroline (Amiga) e Ana Carolina (Irmã)', null),
      ('Luan Damascena',                     null, null),
      ('Luan Azevedo',                       null, 'Descontado em rescisão (do CSV)'),
      ('Luciana Linhares',                   null, null),
      ('Marcos Correia Junior',              'Larissa (Cônjuge), Dagmar e Marcos Correia (Pai e Mãe)', null),
      ('Mariana Cristina',                   null, null),
      ('Mariana Lamarão',                    null, null),
      ('Mariana Medeiros',                   null, null),
      ('Marisa Candida',                     'Mayko (Cônjuge), Lavinia (Filha), Maria (Amiga), Marcos (Cunhado), Luiza e Arthur (Sobrinhos), Vanessa (Irmã), Juliano (Irmão), Lucidalva (Mãe), Thayna (Sobrinha)', null),
      ('Matthias',                           'Laura (Cônjuge), Gustavo e Luisa (Filhos)', null),
      ('Munira',                             'Thomas e Ieda (Mãe e Cônjuge)', null),
      ('Paulo Elianderson Alcântara Pinheiro', null, null),
      ('Paulo Alberto Sobral',               null, null),
      ('Pedro Luan Oliveira Magalhães',      null, null),
      ('Rodolfo Medeiros',                   'Ana Cristina Medeiros (Mãe)', 'Valor retroativo 07, 08 e 09/2026 — R$ 36,39 (do CSV)'),
      ('Ruan Silveira',                      null, null),
      ('Saul dos Santos',                    null, null),
      ('Solange de Souza',                   'Vicente e Carliane (Filhos)', null),
      ('Stephany Judite de Castro',          null, null),
      ('Thais Palhares',                     null, null)
    ) as t(nome_csv, dep_csv, obs_extra)
  loop
    select c.id, c.data_admissao
      into v_colab_id, v_data_admissao
      from public.colaboradores c
     where c.tenant_id = v_tenant
       and c.status = 'ativo'
       and c.tipo_contratacao != 'socio'
       and lower(unaccent(c.nome)) like lower(unaccent(v_rec.nome_csv)) || '%'
     limit 1;

    if v_colab_id is null then
      raise notice '[bradesco-dental] NAO CASOU: %', v_rec.nome_csv;
      v_total_nao_casou := v_total_nao_casou + 1;
      continue;
    end if;

    v_obs_final := v_rec.obs_extra;
    if v_rec.dep_csv is not null then
      v_obs_final := coalesce(v_obs_final || E'\n', '') ||
        'Dependente(s) na fatura real (precisa cadastrar com CPF + data de nascimento): ' || v_rec.dep_csv;
      v_total_com_dep := v_total_com_dep + 1;
    end if;

    begin
      insert into public.colaborador_beneficio
        (tenant_id, colaborador_id, beneficio_id, modo_custeio, data_inicio, observacao)
        values
        (
          v_tenant,
          v_colab_id,
          v_dental,
          'rateado'::public.beneficio_modo_custeio,
          coalesce(v_data_admissao, current_date),
          v_obs_final
        );
      v_total_inseridos := v_total_inseridos + 1;
    exception
      when unique_violation then
        raise notice '[bradesco-dental] JA EXISTE: %', v_rec.nome_csv;
    end;

    v_colab_id := null;
    v_data_admissao := null;
  end loop;

  raise notice '=== Import Bradesco Dental concluido ===';
  raise notice 'Inseridos: %', v_total_inseridos;
  raise notice 'Nao casou: %', v_total_nao_casou;
  raise notice 'Com dependente pendente: %', v_total_com_dep;
end $$;
