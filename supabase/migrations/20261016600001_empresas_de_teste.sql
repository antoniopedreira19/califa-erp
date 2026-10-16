-- Decisão 181 (16/10/2026, pedido do Tiago): as empresas de teste.
--
-- Por quê: o cadastro de impostos só conhecia os três CNPJs reais
-- (California, GoCrazy e Hitlab). Toda PP e toda nota de teste caía num
-- CNPJ real e entrava na Apuração de verdade: em 14/10/2026 as NFs 602, 603
-- e 9001 (TES-1001/26 e TES-1014/26) davam R$ 1.665 de crédito de PIS/COFINS
-- à California e tiravam R$ 19.335 da base do IRPJ/CSLL do 4º trimestre. A
-- "Empresa Teste" existia só como empresa GERENCIAL (regional "Teste").
-- O Tiago não quer a Apuração ignorando testes ("precisaremos fazer
-- testes"): o teste passa a morar em CNPJs de teste.
--
-- O que faz (só acrescenta):
-- 1. `empresas_contabeis.de_teste`: a marca da PJ de teste. Na Apuração, a
--    guia em curso de uma PJ de teste se aprova antes do fechamento, com
--    confirmação (nas PJs reais, só depois do fechamento). Os demonstrativos
--    consolidados vão deixá-la de fora.
-- 2. Duas PJs de teste, com CNPJ fictício (dígitos verificadores válidos,
--    base que não existe):
--    - "Empresa Teste" · 88.888.888/0001-91 · lucro real, como a California,
--      com os CNAEs da California · Salvador;
--    - "Empresa Teste Presumido" · 77.777.777/0001-91 · lucro presumido pelo
--      caixa, como a Hitlab, com os CNAEs da Hitlab · Salvador.
--    Matriz em Salvador-BA, ISS no dia 5 (o de Salvador).
-- 3. Regionais "Teste 2" e "Teste 3" na Empresa Teste gerencial (a "Teste"
--    já existe), para testar o rateio entre regionais. Os 92 membros já têm
--    a Empresa Teste inteira (regional_id nulo em empresa_members) e
--    enxergam as novas sem mais nada.
-- 4. O CNPJ padrão da PP das três regionais de teste é a Empresa Teste.
--
-- Os dados que já existem (projetos TES) mudam na migration seguinte,
-- 20261016600002.

alter table public.empresas_contabeis
  add column if not exists de_teste boolean not null default false;

comment on column public.empresas_contabeis.de_teste is
  'PJ de teste (decisão 181): a guia em curso dela se aprova antes do fechamento, com confirmação; fica fora dos demonstrativos consolidados.';

do $$
declare
  v_tenant uuid;
  v_empresa_teste uuid;
  v_reg_teste uuid;
  v_reg_2 uuid;
  v_reg_3 uuid;
  v_est_california uuid;
  v_est_hitlab uuid;
  v_pj_real uuid;
  v_pj_presumido uuid;
  v_est_real uuid;
  v_est_presumido uuid;
begin
  select id, tenant_id into strict v_empresa_teste, v_tenant
    from public.empresas where nome_fantasia = 'Empresa Teste';
  select id into strict v_reg_teste
    from public.regionais where empresa_id = v_empresa_teste and nome = 'Teste';
  select id into strict v_est_california
    from public.fiscal_estabelecimentos where tenant_id = v_tenant and cnpj = '19437976000154';
  select id into strict v_est_hitlab
    from public.fiscal_estabelecimentos where tenant_id = v_tenant and cnpj = '04409741000181';

  insert into public.empresas_contabeis
    (tenant_id, razao_social, nome_fantasia, cnpj, ativo, de_teste, endereco_cidade, endereco_uf)
  values (v_tenant, 'EMPRESA TESTE LTDA', 'Empresa Teste', '88888888000191', true, true, 'Salvador', 'BA')
  returning id into v_pj_real;

  insert into public.empresas_contabeis
    (tenant_id, razao_social, nome_fantasia, cnpj, ativo, de_teste, endereco_cidade, endereco_uf)
  values (v_tenant, 'EMPRESA TESTE PRESUMIDO LTDA', 'Empresa Teste Presumido', '77777777000191', true, true, 'Salvador', 'BA')
  returning id into v_pj_presumido;

  insert into public.fiscal_estabelecimentos
    (tenant_id, empresa_contabil_id, nome, cnpj, papel, municipio, uf, iss_dia, iss_retido_dia, iss_regra, ativo, ordem, observacao)
  values (v_tenant, v_pj_real, 'Empresa Teste · Salvador', '88888888000191', 'matriz', 'Salvador', 'BA', 5, 5, 'prorroga', true, 90,
          'CNPJ fictício, só para testes (decisão 181).')
  returning id into v_est_real;

  insert into public.fiscal_estabelecimentos
    (tenant_id, empresa_contabil_id, nome, cnpj, papel, municipio, uf, iss_dia, iss_retido_dia, iss_regra, ativo, ordem, observacao)
  values (v_tenant, v_pj_presumido, 'Empresa Teste Presumido · Salvador', '77777777000191', 'matriz', 'Salvador', 'BA', 5, 5, 'prorroga', true, 91,
          'CNPJ fictício, só para testes (decisão 181).')
  returning id into v_est_presumido;

  insert into public.fiscal_regimes (tenant_id, empresa_contabil_id, regime, regime_caixa, vigencia_inicio, observacao)
  values
    (v_tenant, v_pj_real, 'lucro_real', false, '2026-01-01', 'PJ de teste: lucro real, como a California.'),
    (v_tenant, v_pj_presumido, 'lucro_presumido', true, '2026-01-01', 'PJ de teste: lucro presumido pelo caixa, como a Hitlab.');

  insert into public.fiscal_cnaes
    (tenant_id, estabelecimento_id, codigo, subitem, descricao, aliquota_iss, aliquota_pis, aliquota_cofins, cumulativo, vigencia_inicio, vigencia_fim, ativo)
  select tenant_id, v_est_real, codigo, subitem, descricao, aliquota_iss, aliquota_pis, aliquota_cofins, cumulativo, vigencia_inicio, vigencia_fim, ativo
    from public.fiscal_cnaes where estabelecimento_id = v_est_california;

  insert into public.fiscal_cnaes
    (tenant_id, estabelecimento_id, codigo, subitem, descricao, aliquota_iss, aliquota_pis, aliquota_cofins, cumulativo, vigencia_inicio, vigencia_fim, ativo)
  select tenant_id, v_est_presumido, codigo, subitem, descricao, aliquota_iss, aliquota_pis, aliquota_cofins, cumulativo, vigencia_inicio, vigencia_fim, ativo
    from public.fiscal_cnaes where estabelecimento_id = v_est_hitlab;

  insert into public.regionais (tenant_id, nome, ativo, empresa_id, disponivel_em_projetos)
  values (v_tenant, 'Teste 2', true, v_empresa_teste, true)
  returning id into v_reg_2;
  insert into public.regionais (tenant_id, nome, ativo, empresa_id, disponivel_em_projetos)
  values (v_tenant, 'Teste 3', true, v_empresa_teste, true)
  returning id into v_reg_3;

  insert into public.fiscal_cnpj_da_pp_por_regional (regional_id, tenant_id, estabelecimento_id)
  values (v_reg_teste, v_tenant, v_est_real), (v_reg_2, v_tenant, v_est_real), (v_reg_3, v_tenant, v_est_real)
  on conflict (regional_id) do update set estabelecimento_id = excluded.estabelecimento_id, updated_at = now();
end $$;
