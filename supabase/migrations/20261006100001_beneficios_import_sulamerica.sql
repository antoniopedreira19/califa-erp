-- Migration: Benefícios — import de titulares SulAmerica (Fase 1.6a)
--
-- Importa vínculos de titulares SulAmerica a partir do CSV da competência
-- atual (SulAmerica.csv). Dependentes NÃO são importados aqui — o CSV
-- original não tem CPF nem data de nascimento dos dependentes, e o modelo
-- exige ambos obrigatórios. Dependentes serão cadastrados depois.
--
-- Regras de resolução:
-- - Match colaborador por lower(unaccent(nome)) prefix (CSV costuma ser
--   mais curto que o banco; evita falsos positivos com nome composto).
-- - tipo_contratacao != 'socio' (B11: sócios fora do subsistema).
-- - status = 'ativo'.
-- - Modo custeio default: 'rateado'. Exceções hardcoded (observação
--   "Custeado pela California" na planilha, confirmado com Daniel):
--     * integral_empresa: 10 pessoas listadas abaixo
--     * integral_empresa_com_upgrade: 2 pessoas (Mariana Lamarão, Thais Palhares)
-- - data_inicio = data_admissao do colaborador (aproximação razoável).
-- - Pulos:
--     * Frederico Soares (CLT, Custeado + Cancelado 30/09) — fora do import
--     * Simone Reesink (externa, não é colaborador) — skip natural
--     * Sócios — filtro tipo_contratacao
-- - Dependentes do CSV: anotados em `observacao` do vínculo para a Kika
--   usar como referência ao cadastrar os deps completos depois.
--
-- Em caso de nome CSV que não casa com nenhum colaborador, RAISE NOTICE.
-- Idempotência: se o vínculo já existe (unique parcial), ON CONFLICT DO NOTHING.

do $$
declare
  v_tenant uuid;
  v_direto uuid;
  v_especial uuid;
  v_total_inseridos int := 0;
  v_total_nao_casou int := 0;
  v_total_com_dep int := 0;
  v_rec record;
  v_colab_id uuid;
  v_data_admissao date;
  v_obs_final text;
begin
  select id into v_tenant from public.tenants where nome = 'Agência California';
  select id into v_direto from public.beneficios where tenant_id = v_tenant and nome = 'SulAmerica Direto Nacional';
  select id into v_especial from public.beneficios where tenant_id = v_tenant and nome = 'SulAmerica Especial 100';

  -- Entrada: (nome_csv, plano, modo, dependente_bruto_do_csv, obs_extra)
  for v_rec in
    select *
    from (values
      ('Álezis Mateus Gomes Miranda',       'direto',   'rateado',                        null::text, null::text),
      ('Aline Heluany Khoury',              'especial', 'rateado',                        null, null),
      ('Amanda de Melo Vitoriano Rabello',  'especial', 'rateado',                        null, 'Descontado em rescisão (nota do CSV original)'),
      ('Ana Carolina Costa Wdowinki',       'especial', 'rateado',                        null, null),
      ('André Luis do Nascimento de Souza', 'especial', 'rateado',                        null, null),
      ('Anne Gabrielle Vieira Madeiro',     'especial', 'rateado',                        null, null),
      ('Barbara Sophia Tank',               'especial', 'rateado',                        null, null),
      ('Bárbara Cândido Pereira de Sousa',  'especial', 'rateado',                        'Bianca Cardozo', null),
      ('Berg Muniz do Nascimento',          'especial', 'rateado',                        null, 'Mudou CNPJ'),
      ('Bianca Barbosa Colares',            'direto',   'rateado',                        null, null),
      ('Bruno de Souza Brito',              'especial', 'rateado',                        'Tércia Natalia Paes', null),
      ('Caio Pablo Soares da Silva',        'direto',   'rateado',                        null, null),
      ('Carina Sousa Marçal',               'especial', 'rateado',                        null, null),
      ('Carolina Dal Sasso Barakat',        'especial', 'rateado',                        null, null),
      ('César Augusto Coletti',             'direto',   'rateado',                        null, null),
      ('Dandara Natividade Góes',           'direto',   'rateado',                        null, null),
      ('Daniel Barreto Pinto',              'especial', 'rateado',                        null, null),
      ('Daniel Jooji Kishida Fukuda',       'especial', 'rateado',                        null, null),
      ('Debora Pereira Brito',              'especial', 'rateado',                        null, null),
      ('Diego Braga da Costa',              'especial', 'rateado',                        null, null),
      ('Douglas Cerqueira Mendes',          'direto',   'rateado',                        null, null),
      ('Duane Pinto Coelho Cartaxo',        'direto',   'rateado',                        null, null),
      ('Eduardo Madureira Lins de Araújo',  'especial', 'rateado',                        null, null),
      ('Eduardo Manoel Costa da Silva',     'especial', 'rateado',                        null, null),
      ('Elaine Silva de Jesus',             'especial', 'rateado',                        null, null),
      ('Erica Laiane Araújo Dos Santos',    'direto',   'rateado',                        'Rafael Araujo', null),
      ('Fabiane Andrade Oiticica',          'especial', 'rateado',                        null, null),
      ('Fabiane Soares dos Santos',         'especial', 'rateado',                        null, null),
      ('Felipe Almeida Berber',             'especial', 'rateado',                        null, null),
      ('Felipe Bispo da Silva',             'direto',   'rateado',                        'Michelle Costa', null),
      ('Felipe Pinto Calasans',             'direto',   'rateado',                        'Dependente da fatura (nome não informado no CSV)', null),
      ('Fernanda Freire de Carvalho Sá',    'especial', 'rateado',                        null, null),
      ('Filippe Sena Buccos',               'especial', 'rateado',                        null, null),
      ('Francisco Jucelio Silva de Araújo', 'especial', 'rateado',                        'Rebeca Alves', null),
      ('Frederico de Salles Gomes e Melo',  'especial', 'rateado',                        null, null),
      ('Gabriel Souza Silva Rocha',         'especial', 'rateado',                        null, null),
      ('Guilherme de Marco Rabaça',         'direto',   'integral_empresa',               null, 'Custeado pela California (do CSV)'),
      ('Gabriela Cavalleiro Singh',         'especial', 'rateado',                        null, null),
      ('Gabriela Fedato Contiero',          'especial', 'rateado',                        'Ramona (nasc. 27/12/2022) e Marcelo (nasc. 14/09/1992)', null),
      ('Gabriela Moreira Barroso',          'especial', 'rateado',                        null, null),
      ('Harrison Silva Lago',               'especial', 'rateado',                        null, null),
      ('Humberto Perazzo de Oliveira Neto', 'especial', 'rateado',                        'Alessandra, Theo e João Lucas', null),
      ('Ícaro Silva Sampaio',               'especial', 'integral_empresa',               null, 'Custeado pela California (do CSV)'),
      ('Ingrid Ariel Silva Alves',          'especial', 'rateado',                        null, null),
      ('Janaína Silva Leal dos Santos',     'especial', 'rateado',                        null, '1º boleto (do CSV)'),
      ('Jaqueline Almeida da Silva',        'direto',   'integral_empresa',               null, 'Custeado pela California — estagiária (do CSV)'),
      ('Jessica Gerber',                    'especial', 'rateado',                        null, null),
      ('João Victor Caetano Sousa',         'direto',   'rateado',                        null, null),
      ('José Mário Dias de Menezes',        'especial', 'rateado',                        null, null),
      ('Júlia Beatriz Michelique',          'especial', 'rateado',                        null, null),
      ('Julia Simas Ferreira de Faria',     'especial', 'rateado',                        null, null),
      ('Kevem Willian Dias Duarte Santos',  'direto',   'rateado',                        null, null),
      ('Larissa Sampaio',                   'especial', 'rateado',                        null, 'Descontado em rescisão (nota do CSV original)'),
      ('Larissa de Avelar Paranhos',        'especial', 'rateado',                        null, null),
      ('Leonardo Augusto Saraiva Tolentino','especial', 'rateado',                        null, null),
      ('Liz Torres de Campos',              'direto',   'integral_empresa',               null, 'Custeado pela California (do CSV)'),
      ('Luan Damascena',                    'especial', 'rateado',                        null, null),
      ('Luan Azevedo Nascimento Ferraz',    'especial', 'rateado',                        null, 'Descontado em rescisão (nota do CSV original)'),
      ('Luana Pimenta Ferreira',            'especial', 'rateado',                        null, null),
      ('Luane Santos de Souza',             'direto',   'integral_empresa',               null, 'Custeado pela California (do CSV)'),
      ('Lucas Fernandes Mano',              'especial', 'rateado',                        null, '1º boleto (do CSV)'),
      ('Lucas Leal Bastos',                 'especial', 'rateado',                        null, null),
      ('Luis Felipe da Silva Regis',        'especial', 'rateado',                        null, null),
      ('Márcio Vieira Silva',               'especial', 'rateado',                        null, null),
      ('Marco Flávio Faria Alvarez',        'especial', 'rateado',                        'Dependentes do CSV (nomes não informados)', null),
      ('Marcos Correia Dos Santos Junior',  'especial', 'rateado',                        'Larissa Candida', null),
      ('Marcos Paulo Gomides Abe',          'especial', 'rateado',                        null, '1º boleto (do CSV)'),
      ('Marcos Vinícius de Souza Santos',   'especial', 'rateado',                        null, null),
      ('Mariana Cristina Dias Martins',     'direto',   'rateado',                        null, null),
      ('Marília Wey',                       'direto',   'integral_empresa',               null, 'Custeado pela California (do CSV)'),
      ('Marina Gordano Miranda',            'especial', 'rateado',                        null, null),
      ('Mariana Cantos Esperança',          'especial', 'rateado',                        null, '1º boleto — plano em alteração de Direto para Especial (do CSV)'),
      ('Mariana Lamarão',                   'especial', 'integral_empresa_com_upgrade',   null, 'Empresa cobre o Direto, colaboradora paga a diferença (do CSV)'),
      ('Mariana Medeiros Braga Lacerda',    'direto',   'rateado',                        null, '1º boleto (do CSV)'),
      ('Marisa Candida da Silva Sousa',     'especial', 'integral_empresa',               null, 'Custeado pela California (do CSV)'),
      ('Martha França de Souza Barreto',    'especial', 'rateado',                        null, null),
      ('Mateus de Souza Ribeiro',           'especial', 'rateado',                        null, null),
      ('Mateus Feitosa de Lima',            'direto',   'rateado',                        null, null),
      ('Matthias',                          'especial', 'rateado',                        'Gustavo, Laura, Luisa', 'Descontar os dependentes sempre em recibo (do CSV)'),
      ('Maurício Campos Scorza',            'especial', 'rateado',                        null, null),
      ('Mina Santana Moura Andrade Lemos',  'especial', 'rateado',                        null, null),
      ('Natalia Cavalcanti Rocha',          'especial', 'rateado',                        null, null),
      ('Nathalia Vilão Frederico',          'direto',   'integral_empresa',               null, 'Custeado pela California (do CSV)'),
      ('Pedro Almeida Tavares',             'especial', 'rateado',                        null, null),
      ('Philipe de Sousa Silverio do Amaral Carneiro', 'especial', 'rateado',             null, null),
      ('Paula Miho Kunieda',                'especial', 'rateado',                        null, null),
      ('Priscilla Oliveira Leitão de Melo', 'especial', 'rateado',                        'Irlan', null),
      ('Rafael Cordeiro Capitão',           'especial', 'rateado',                        null, null),
      ('Rafael Moreno',                     'direto',   'rateado',                        null, null),
      ('Rafael Perrucho Gonçalves',         'especial', 'rateado',                        'Iara e Pedro', 'Descontar os dependentes sempre em recibo (do CSV)'),
      ('Raphael Sestelo de Britto',         'especial', 'rateado',                        null, null),
      ('Saul dos Santos Ferreira',          'direto',   'rateado',                        null, null),
      ('Selma Pereira Paulo de Santana',    'especial', 'integral_empresa',               null, 'Custeado pela California (do CSV)'),
      ('Sofia de Campos Marinho Diniz',     'direto',   'rateado',                        null, null),
      ('Sofia Ísis Dutra Rocha',            'especial', 'rateado',                        null, null),
      ('Solange de Souza Lima',             'direto',   'rateado',                        null, null),
      ('Stephany Judite de Castro',         'especial', 'rateado',                        null, '1º boleto (do CSV)'),
      ('Tatiana Pizii Stefano',             'especial', 'rateado',                        null, null),
      ('Teila Almeida Silva',               'especial', 'rateado',                        null, null),
      ('Thais Batista Mellenberg de Oliveira','especial', 'rateado',                      null, null),
      ('Thais Palhares Cordeiro',           'especial', 'integral_empresa_com_upgrade',   null, 'Empresa cobre o Direto, colaboradora paga a diferença (do CSV)'),
      ('Thamirys Marques da Silva',         'especial', 'rateado',                        null, null),
      ('Thiago Loreto',                     'especial', 'rateado',                        null, null),
      ('Thiago Cabral Montiani',            'especial', 'rateado',                        'Ana Paula', null),
      ('Uriel Oliveira de Souza da Silva',  'especial', 'rateado',                        null, 'Descontado em rescisão (nota do CSV original)'),
      ('Victor Batista Landeiro',           'especial', 'rateado',                        null, null),
      ('Victor Maia Rodrigues da Silva',    'especial', 'rateado',                        null, null),
      ('Victor Oliveira Alves',             'especial', 'rateado',                        null, '1º boleto (do CSV)'),
      ('Victoria Nathalie de Oliveira Cunha','especial', 'rateado',                       null, '1º boleto (do CSV)'),
      ('Wadisgnton da Silva Lopes',         'especial', 'rateado',                        null, 'Descontado em dobro — retroativo 07/2026 (do CSV)'),
      ('Wilson Duarte Brandão Neto',        'especial', 'integral_empresa',               null, 'Custeado pela California (do CSV)'),
      ('Yasmin de Oliveira Feitosa',        'direto',   'integral_empresa',               null, 'Custeado pela California (do CSV)'),
      ('Yohana Menezes Manfredi',           'direto',   'integral_empresa',               null, 'Custeado pela California (do CSV)')
    ) as t(nome_csv, plano, modo, dep_csv, obs_extra)
  loop
    -- Match colaborador por prefixo normalizado (unaccent + lower)
    select c.id, c.data_admissao
      into v_colab_id, v_data_admissao
      from public.colaboradores c
     where c.tenant_id = v_tenant
       and c.status = 'ativo'
       and c.tipo_contratacao != 'socio'
       and lower(unaccent(c.nome)) like lower(unaccent(v_rec.nome_csv)) || '%'
     limit 1;

    if v_colab_id is null then
      raise notice '[sulamerica] NAO CASOU: %', v_rec.nome_csv;
      v_total_nao_casou := v_total_nao_casou + 1;
      continue;
    end if;

    -- Monta observação combinando obs do CSV + nota de dependente faltante
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
          case v_rec.plano when 'direto' then v_direto else v_especial end,
          v_rec.modo::public.beneficio_modo_custeio,
          coalesce(v_data_admissao, current_date),
          v_obs_final
        );
      v_total_inseridos := v_total_inseridos + 1;
    exception
      when unique_violation then
        raise notice '[sulamerica] JA EXISTE: % (vinculo ativo nao duplicado)', v_rec.nome_csv;
    end;

    v_colab_id := null;
    v_data_admissao := null;
  end loop;

  raise notice '=== Import SulAmerica concluído ===';
  raise notice 'Inseridos: %', v_total_inseridos;
  raise notice 'Nao casou: %', v_total_nao_casou;
  raise notice 'Com dependente pendente: %', v_total_com_dep;
end $$;
